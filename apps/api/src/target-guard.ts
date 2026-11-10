/**
 * Two guards against pointing the wrong process at the wrong data: the integration suites wipe
 * and rewrite data, so they must only ever run against the `_test` database and `-test` bucket,
 * and a real server must never run against them.
 */
const databaseName = (url: string) => new URL(url).pathname.replace(/^\//, '');

export function assertTestTargets(env: { DATABASE_URL: string; S3_BUCKET: string }): void {
  const db = databaseName(env.DATABASE_URL);
  if (!db.endsWith('_test')) {
    throw new Error(
      `Refusing to run the integration tests: the database "${db}" does not end in "_test".`,
    );
  }
  if (!env.S3_BUCKET.endsWith('-test')) {
    throw new Error(
      `Refusing to run the integration tests: the bucket "${env.S3_BUCKET}" does not end in "-test".`,
    );
  }
}

export function assertServerTarget(env: { DATABASE_URL: string; NODE_ENV: string }): void {
  const db = databaseName(env.DATABASE_URL);
  if (db.endsWith('_test') && env.NODE_ENV !== 'test') {
    throw new Error(
      `Refusing to start: the database "${db}" is the test database (it ends in "_test"), ` +
        'but NODE_ENV is not "test".',
    );
  }
}
