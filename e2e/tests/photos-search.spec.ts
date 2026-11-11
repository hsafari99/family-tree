import { expect, test } from '@playwright/test';
import { PROD_LOCAL, statePath } from '../support/env';
import { treeUrl } from '../support/fixture';
import { GPS_JPEG, SECRET_MARKER } from '../support/fixtures';
import { card, clearPhotos } from '../support/ui';

test.skip(PROD_LOCAL, 'dev stack only');
test.use({ storageState: statePath('owner.json') });

// The photo tests change the shared sample tree: start and finish without Robert's/Margaret's
// photos, whether the test passed, failed or is being retried.
test.beforeEach(async ({ page }) => clearPhotos(page, 'Robert Hale', treeUrl()));
test.afterEach(async ({ page }) => clearPhotos(page, 'Robert Hale', treeUrl()));

test('an uploaded photo is stored without EXIF and shows on the card', async ({ page }) => {
  await page.goto(treeUrl());
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Full' }).click();
  await card(page, 'Robert Hale').click();
  await page.getByRole('tab', { name: 'Photos' }).click();
  await page.locator('input[type="file"]').setInputFiles(GPS_JPEG);
  await page.getByRole('button', { name: 'Use the whole photo' }).click();
  await expect(page.getByText('Photo added')).toBeVisible();

  const thumb = page.getByRole('list', { name: 'Photos of Robert Hale' }).locator('img').first();
  await expect(thumb).toBeVisible();
  const res = await page.request.get((await thumb.getAttribute('src'))!);
  expect(res.status()).toBe(200);
  const body = await res.body();
  expect(body.subarray(0, 4).toString('latin1')).toBe('RIFF');
  expect(body.subarray(8, 12).toString('latin1')).toBe('WEBP');
  for (const marker of [SECRET_MARKER, 'E2ECam', 'Exif']) {
    expect(body.includes(Buffer.from(marker)), marker).toBe(false);
  }
  await expect(
    page.locator('.react-flow__node', { has: card(page, 'Robert Hale') }).locator('img'),
  ).toBeVisible();
});

test('search tolerates a typo and says how each person is related to you', async ({ page }) => {
  await page.goto(treeUrl());
  await page.getByRole('searchbox', { name: 'Search' }).fill('Margret');
  const result = page.getByRole('list', { name: 'Search results' }).getByRole('button', {
    name: /Margaret Hale/,
  });
  await expect(result).toContainText('grandmother');
  await result.click();
  await expect(page.getByRole('heading', { name: /Margaret Hale/ })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search' }).fill('ellis'); // maiden name
  await expect(
    page
      .getByRole('list', { name: 'Search results' })
      .getByRole('button', { name: /Margaret Hale/ }),
  ).toBeVisible();
});

test('"How are we related?" words the path and highlights it', async ({ page }) => {
  await page.goto(treeUrl());
  await page.getByRole('link', { name: 'How are we related?' }).click();
  await page.getByLabel('To', { exact: true }).fill('Emma');
  await page.getByRole('button', { name: /^Emma Hale/ }).click();
  await expect(page.getByText('Emma Hale is your half-sister.')).toBeVisible();
  await page.getByRole('button', { name: 'Show on the tree' }).click();
  await expect.poll(() => page.locator('.is-path').count()).toBeGreaterThanOrEqual(3);
  // Close only collapses the panel (brief #15): the path stays drawn.
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('complementary', { name: 'Details' })).toBeHidden();
  await expect.poll(() => page.locator('.is-path').count()).toBeGreaterThanOrEqual(3);
});
