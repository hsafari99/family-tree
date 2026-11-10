import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3ServiceException,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PHOTO_URL_TTL_SECONDS } from '@family-tree/shared';
import type { Config } from '../config.js';
import { createS3 } from './s3.js';

/**
 * Signing time is rounded down to this window (decision 7): one window's URLs for an object are
 * identical, so browsers cache them, and each stays valid 10–15 minutes after it is issued.
 */
export const SIGN_WINDOW_MS = 5 * 60_000;
const CACHE_MAX = 20_000;

export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Idempotent: deleting a missing key succeeds. */
  delete(key: string): Promise<void>;
  /** A GET URL for the browser, valid PHOTO_URL_TTL_SECONDS from the start of `now`'s window. */
  signedUrl(key: string, now?: number): Promise<string>;
  /** The object's bytes, or null when the key doesn't exist. For the export (one at a time). */
  get(key: string): Promise<Uint8Array | null>;
  /** Every object under `prefix`, page by page (1,000 per request). For the orphan sweep. */
  list(prefix: string): AsyncGenerator<{ key: string; lastModified: Date }>;
  close(): void;
}

/** `s3` is the API's own client (deps); without it the store creates and owns one. */
export function createObjectStore(config: Config, shared?: S3Client): ObjectStore {
  const Bucket = config.S3_BUCKET;
  const s3 = shared ?? createS3(config);
  // Signing is offline, but the host is part of the signature: sign for the browser's endpoint.
  const signer = createS3(config, config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT);
  const cache = new Map<string, { window: number; url: string }>();
  return {
    async put(key, body, contentType) {
      await s3.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: `private, max-age=${PHOTO_URL_TTL_SECONDS}`,
        }),
      );
    },
    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async signedUrl(key, now = Date.now()) {
      const window = Math.floor(now / SIGN_WINDOW_MS) * SIGN_WINDOW_MS;
      const hit = cache.get(key);
      if (hit?.window === window) return hit.url;
      // Signed into the URL: always an inline WebP, whatever metadata the object carries.
      const command = new GetObjectCommand({
        Bucket,
        Key: key,
        ResponseContentType: 'image/webp',
        ResponseContentDisposition: 'inline',
      });
      const url = await getSignedUrl(signer, command, {
        expiresIn: PHOTO_URL_TTL_SECONDS,
        signingDate: new Date(window),
      });
      if (cache.size >= CACHE_MAX) cache.clear();
      cache.set(key, { window, url });
      return url;
    },
    async get(key) {
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
        return res.Body ? await res.Body.transformToByteArray() : new Uint8Array();
      } catch (err) {
        if (
          err instanceof S3ServiceException &&
          (err.name === 'NoSuchKey' || err.$metadata.httpStatusCode === 404)
        ) {
          return null;
        }
        throw err;
      }
    },
    async *list(prefix) {
      let token: string | undefined;
      do {
        const page = await s3.send(
          new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const o of page.Contents ?? []) {
          if (o.Key) yield { key: o.Key, lastModified: o.LastModified ?? new Date(0) };
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    },
    close() {
      signer.destroy();
      if (!shared) s3.destroy();
    },
  };
}
