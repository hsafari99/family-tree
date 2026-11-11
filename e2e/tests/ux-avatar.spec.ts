import { expect, test } from '@playwright/test';
import { PROD_LOCAL } from '../support/env';
import { GPS_JPEG, SECRET_MARKER } from '../support/fixtures';
import { signUpViaUi } from '../support/ui';

test.skip(PROD_LOCAL, 'dev stack only');

test('a profile picture: default, upload, see it, replace, remove, default again', async ({
  page,
}) => {
  const ada = await signUpViaUi(page, 'Ada Picture');
  await page.goto('/account/profile');
  const profile = page.getByRole('region', { name: 'Profile' });

  // No picture yet: the initials on a circle, named by the user.
  const avatar = profile.getByRole('img', { name: ada.name });
  await expect(avatar).toHaveText('AP');
  await expect(profile.getByRole('button', { name: 'Remove picture' })).toHaveCount(0);

  await profile.getByLabel('Upload a picture').setInputFiles(GPS_JPEG);
  await expect(profile.getByText('Profile picture added.')).toBeVisible();
  const img = profile.locator('img.avatar');
  await expect(img).toHaveAttribute('alt', ada.name);
  // The stored picture is a re-encoded WebP square without the upload's metadata, and loads.
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(256);
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalHeight)).toBe(256);
  const res = await page.request.get((await img.getAttribute('src'))!);
  expect(res.status()).toBe(200);
  const body = await res.body();
  expect(body.subarray(8, 12).toString('latin1')).toBe('WEBP');
  expect(body.includes(SECRET_MARKER)).toBe(false);

  // The session carries it, so it survives a reload.
  await page.reload();
  await expect(profile.locator('img.avatar')).toBeVisible();
  const first = await profile.locator('img.avatar').getAttribute('src');
  await profile.getByLabel('Replace picture').setInputFiles(GPS_JPEG);
  await expect(profile.getByText('Profile picture replaced.')).toBeVisible();
  await expect(profile.locator('img.avatar')).not.toHaveAttribute('src', first!);
  // The replaced object is gone from storage.
  expect((await page.request.get(first!)).status()).toBe(404);

  const remove = profile.getByRole('button', { name: 'Remove picture' });
  await expect(remove).toHaveAttribute('title', 'Remove picture');
  const box = (await remove.boundingBox())!;
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(24);
  await remove.click();
  await profile.getByRole('button', { name: 'Yes, remove' }).click();
  await expect(profile.getByText('Profile picture removed.')).toBeVisible();
  await expect(profile.locator('img.avatar')).toHaveCount(0);
  await expect(profile.getByRole('img', { name: ada.name })).toHaveText('AP');
  await page.reload();
  await expect(profile.getByRole('img', { name: ada.name })).toHaveText('AP');
});

test('a file that is not an image is refused with a fixed message', async ({ page }) => {
  await signUpViaUi(page, 'Ada Wrongtype');
  await page.goto('/account/profile');
  await page.getByLabel('Upload a picture').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not an image'),
  });
  await expect(page.getByRole('alert')).toHaveText('Use a JPEG, PNG or WebP photo.');
});

test('Profile: details on the left, the picture on the right; stacked picture-first when narrow', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const ada = await signUpViaUi(page, 'Ada Layout');
  await page.goto('/account/profile');
  const profile = page.getByRole('region', { name: 'Profile' });
  const picture = profile.getByRole('img', { name: ada.name });
  const details = profile.locator('dl');
  const upload = profile.locator('label.icon-button');

  const pic = (await picture.boundingBox())!;
  const dl = (await details.boundingBox())!;
  expect(pic.width).toBeGreaterThanOrEqual(128);
  expect(pic.width).toBeLessThanOrEqual(160);
  expect(pic.x).toBeGreaterThanOrEqual(dl.x + dl.width);
  // Compact icon controls under the picture, each at least 24px, with a tooltip.
  const up = (await upload.boundingBox())!;
  expect(up.y).toBeGreaterThan(pic.y + pic.height);
  expect(up.width).toBeGreaterThanOrEqual(24);
  expect(up.height).toBeGreaterThanOrEqual(24);
  await expect(upload).toHaveAttribute('title', 'Upload a picture');
  await page.keyboard.press('Tab');
  await profile.getByLabel('Upload a picture').focus();
  await expect(profile.getByLabel('Upload a picture')).toBeFocused();
  // The hint is smaller than the body text.
  const [hint, body] = await profile
    .locator('.hint')
    .evaluate((el) => [
      parseFloat(getComputedStyle(el).fontSize),
      parseFloat(getComputedStyle(document.body).fontSize),
    ]);
  expect(hint).toBeLessThan(body!);

  await page.setViewportSize({ width: 390, height: 844 });
  const narrowPic = (await picture.boundingBox())!;
  const narrowDl = (await details.boundingBox())!;
  expect(narrowPic.y + narrowPic.height).toBeLessThanOrEqual(narrowDl.y);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  await context.close();
});
