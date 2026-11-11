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
  // A modal confirm: Esc closes it with focus back on the trash button, nothing removed.
  const sectionTop = (await profile.boundingBox())!.y;
  await remove.click();
  const dialog = page.getByRole('dialog', { name: 'Remove profile picture?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  // It doesn't push the page about.
  expect((await profile.boundingBox())!.y).toBe(sectionTop);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(remove).toBeFocused();
  await expect(profile.locator('img.avatar')).toBeVisible();
  await remove.click();
  await dialog.getByRole('button', { name: 'Remove' }).click();
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
  await profile.getByLabel('Upload a picture').setInputFiles(GPS_JPEG);
  await expect(profile.getByText('Profile picture added.')).toBeVisible();
  await expect(profile.getByRole('button', { name: 'Remove picture' })).toBeVisible();
  const picture = profile.getByRole('img', { name: ada.name });
  await expect
    .poll(() => picture.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
    .toBeTruthy();
  const details = profile.locator('dl');
  const upload = profile.locator('label.link-button');

  const pic = (await picture.boundingBox())!;
  const dl = (await details.boundingBox())!;
  // Large and square, its top level with the name and email.
  expect(pic.width).toBeGreaterThanOrEqual(160);
  expect(pic.width).toBeLessThanOrEqual(200);
  expect(Math.abs(pic.height - pic.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(pic.y - dl.y)).toBeLessThanOrEqual(2);
  expect(pic.x).toBeGreaterThanOrEqual(dl.x + dl.width);
  await expect(upload.locator('svg')).toBeVisible();
  // Compact controls under the picture (not over it), then the hint, all inside the column.
  const column = (await profile.locator('.profile-picture').boundingBox())!;
  const up = (await upload.boundingBox())!;
  const hint = (await profile.locator('.profile-picture .hint').boundingBox())!;
  expect(up.y).toBeGreaterThanOrEqual(pic.y + pic.height);
  expect(up.height).toBeGreaterThanOrEqual(24);
  expect(hint.y).toBeGreaterThanOrEqual(up.y + up.height);
  for (const b of [pic, up, hint]) {
    expect(b.x).toBeGreaterThanOrEqual(column.x - 1);
    expect(b.x + b.width).toBeLessThanOrEqual(column.x + column.width + 1);
  }
  expect(column.x).toBeGreaterThanOrEqual(dl.x + dl.width);
  await expect(upload).toHaveAttribute('title', 'Replace picture');
  await profile.getByLabel('Replace picture').focus();
  await expect(profile.getByLabel('Replace picture')).toBeFocused();
  // The hint is smaller than the body text.
  const [hintSize, body] = await profile
    .locator('.profile-picture .hint')
    .evaluate((el) => [
      parseFloat(getComputedStyle(el).fontSize),
      parseFloat(getComputedStyle(document.body).fontSize),
    ]);
  expect(hintSize).toBeLessThan(body!);

  await page.screenshot({ path: test.info().outputPath('profile-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const narrowPic = (await picture.boundingBox())!;
  const narrowDl = (await details.boundingBox())!;
  expect(narrowPic.y + narrowPic.height).toBeLessThanOrEqual(narrowDl.y);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath('profile-narrow.png'), fullPage: true });
  await context.close();
});
