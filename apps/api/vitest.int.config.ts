import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

const fileEnv = parseEnv(readFileSync(new URL('../../.env.development', import.meta.url), 'utf8'));

// Assign before workers start so globalSetup and every test file see the same env.
// File values are defaults, the caller's env wins, and the test-safety overrides always win.
Object.assign(process.env, {
  ...fileEnv,
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? fileEnv.TEST_DATABASE_URL,
  S3_BUCKET: 'family-photos-test',
  LOG_LEVEL: 'silent',
  // The suites sign up thousands of users a day; the ceiling has its own test.
  MAX_SIGNUPS_PER_DAY: '1000000',
});

export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
