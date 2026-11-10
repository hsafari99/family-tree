import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('migrate-cli', () => {
  it('refuses the test database outside NODE_ENV=test, before connecting', () => {
    const run = spawnSync(process.execPath, ['--import', 'tsx', 'src/db/migrate-cli.ts'], {
      env: {
        PATH: process.env.PATH,
        NODE_OPTIONS: '--conditions=development',
        MIGRATION_DATABASE_URL: 'postgres://u:p@127.0.0.1:1/family_test',
      },
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/Refusing to start.*family_test/);
  });
});
