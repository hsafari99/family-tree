import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../test/test-config.js';
import { loadConfig } from '../config.js';
import { createObjectStore, SIGN_WINDOW_MS } from './objects.js';

const store = createObjectStore(loadConfig());
afterAll(() => store.close());
const key = () => `test/${randomUUID()}/thumb.webp`;
const bytes = new Uint8Array([1, 2, 3, 4, 5]);

describe('ObjectStore against SeaweedFS', () => {
  it('serves a put object through a signed URL, privately cached', async () => {
    const k = key();
    await store.put(k, bytes, 'image/webp');
    const url = await store.signedUrl(k);
    expect(url).toMatch(/^http:\/\/localhost:8333\//);
    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('900');
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('cache-control')).toBe('private, max-age=900');
    // SeaweedFS appends a filename to the signed disposition; R2 echoes it as signed.
    expect(res.headers.get('content-disposition')).toMatch(/^inline/);
    expect(new URL(url).searchParams.get('response-content-disposition')).toBe('inline');
    expect(new URL(url).searchParams.get('response-content-type')).toBe('image/webp');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it('refuses the object without a signature, and with an expired one', async () => {
    const k = key();
    await store.put(k, bytes, 'image/webp');
    const url = new URL(await store.signedUrl(k));
    expect((await fetch(`${url.origin}${url.pathname}`)).status).toBe(403); // the bucket is private
    const old = await store.signedUrl(k, Date.now() - 20 * 60_000);
    expect((await fetch(old)).status).toBe(403);
  });

  it('gives the same URL within a signing window, and a new one in the next', async () => {
    const k = key();
    const t = Math.floor(Date.now() / SIGN_WINDOW_MS) * SIGN_WINDOW_MS + 1000;
    expect(await store.signedUrl(k, t)).toBe(await store.signedUrl(k, t + 60_000));
    expect(await store.signedUrl(k, t)).not.toBe(await store.signedUrl(k, t + SIGN_WINDOW_MS));
  });

  it('signs for the public endpoint while writing through the internal one', async () => {
    const pub = createObjectStore(testConfig({ S3_PUBLIC_ENDPOINT: 'http://127.0.0.1:8333' }));
    try {
      const k = key();
      await pub.put(k, bytes, 'image/webp');
      const url = await pub.signedUrl(k);
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:8333\//);
      expect((await fetch(url)).status).toBe(200);
    } finally {
      pub.close();
    }
  });

  it('deletes idempotently', async () => {
    const k = key();
    await store.put(k, bytes, 'image/webp');
    await store.delete(k);
    await store.delete(k); // already gone: still fine
    expect((await fetch(await store.signedUrl(k))).status).toBe(404);
  });
});
