import { defineConfig, devices } from '@playwright/test';
import { PROD_LOCAL, WEB } from './support/env';

export default defineConfig({
  testDir: './tests',
  // One worker, in file order: the tests share one stack, its rate limits and the seeded tree.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  globalSetup: './support/global-setup.ts',
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(PROD_LOCAL
      ? {
          // Caddy's local CA, and *.family.test → 127.0.0.1 without a hosts entry (decision 16).
          ignoreHTTPSErrors: true,
          launchOptions: {
            args: ['--host-resolver-rules=MAP family.test 127.0.0.1, MAP *.family.test 127.0.0.1'],
          },
        }
      : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
