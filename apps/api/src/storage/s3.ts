import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import type { Config } from '../config.js';

export function createS3(config: Config): S3Client {
  return new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
  });
}

/** Dev/test only (guarded by S3_CREATE_BUCKET): create the bucket if it does not exist. */
export async function ensureBucket(s3: S3Client, bucket: string): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (err) {
    const missing =
      err instanceof S3ServiceException &&
      (err.$metadata.httpStatusCode === 404 ||
        err.name === 'NotFound' ||
        err.name === 'NoSuchBucket');
    if (!missing) throw err;
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}
