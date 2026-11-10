import { expect, test } from '@playwright/test';
import { watchCsp } from '../support/csp';
import { API, PROD_LOCAL } from '../support/env';
import { GPS_JPEG } from '../support/fixtures';
import { card, signUpViaUi, startTreeViaUi } from '../support/ui';

test.skip(!PROD_LOCAL, 'runs against the local production stack: pnpm test:e2e:prod-local');

test('@smoke the production stack: TLS, CSP, 2FA sign-up, a photo, export', async ({ page }) => {
  const csp = await watchCsp(page);
  const first = await page.goto('/');
  const headers = first!.headers();
  expect(headers['content-security-policy']).toContain(`connect-src 'self' ${API}`);
  expect(headers['x-frame-options']).toBe('DENY');

  const me = await signUpViaUi(page, 'Smoke Owner');
  await startTreeViaUi(page, me, { given: 'Sam', surname: 'Smoke' });
  await card(page, 'Sam Smoke').click();
  await page.getByRole('tab', { name: 'Photos' }).click();
  await page.locator('input[type="file"]').setInputFiles(GPS_JPEG);
  await page.getByRole('button', { name: 'Use the whole photo' }).click();
  await expect(page.getByText('Photo added')).toBeVisible();
  const img = page.getByRole('list', { name: 'Photos of Sam Smoke' }).locator('img').first();
  await expect(img).toBeVisible();
  expect(await img.getAttribute('src')).toMatch(/^https:\/\/s3\.family\.test:8443\//);
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);

  const download = page.waitForEvent('download');
  await page
    .getByRole('region', { name: 'Export' })
    .getByRole('button', { name: 'Download export' })
    .click();
  // The date-based name proves CORS exposes Content-Disposition; the fallback name would not match.
  expect((await download).suggestedFilename()).toMatch(/^family-tree-\d{4}-\d{2}-\d{2}\.zip$/);

  expect(await csp.violations()).toEqual([]);
});
