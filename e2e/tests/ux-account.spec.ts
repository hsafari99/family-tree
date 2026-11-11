import { expect, type Page, test } from '@playwright/test';
import { PROD_LOCAL } from '../support/env';
import { enrolTotpViaUi, signUpViaUi } from '../support/ui';

test.skip(PROD_LOCAL, 'dev stack only');

const nav = (page: Page) => page.getByRole('navigation', { name: 'Account settings' });

test('desktop: the section list sits beside one section, each at its own URL', async ({ page }) => {
  await signUpViaUi(page, 'Ada Settings');

  // No section in the URL: Profile is shown and marked current.
  await page.goto('/account');
  await expect(page.getByRole('heading', { level: 2, name: 'Profile' })).toBeVisible();
  await expect(nav(page).getByRole('link', { name: 'Profile' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.goto('/account/two-step');
  await expect(nav(page)).toBeVisible();
  await expect(nav(page).getByRole('link', { name: 'Two-step verification' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // One short label per item.
  await expect(nav(page).getByRole('link')).toHaveText([
    'Profile',
    'Change password',
    'Two-step verification',
    ...((await nav(page).getByRole('link', { name: 'Google sign-in' }).count()) > 0
      ? ['Google sign-in']
      : []),
    'Delete account',
  ]);
  // The nav names the section: the panel shows no title, and the heading is for screen readers.
  const twoStep = page.getByRole('heading', { level: 2, name: 'Two-step verification' });
  await expect(twoStep).toBeAttached();
  expect(await twoStep.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
  // The mobile back link is hidden beside the list.
  await expect(page.getByRole('link', { name: 'Back to account' })).toBeHidden();

  await nav(page).getByRole('link', { name: 'Change password' }).click();
  await expect(page).toHaveURL(/\/account\/password$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Change password' })).toBeFocused();
  await expect(page.getByLabel('Current password')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Two-step verification' })).toHaveCount(
    0,
  );

  // An unknown section falls back to Profile.
  await page.goto('/account/bogus');
  await expect(page).toHaveURL(/\/account$/);
  await expect(nav(page).getByRole('link', { name: 'Profile' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('icons: one per nav item, a back-home icon link top left, and the Google status', async ({
  page,
}) => {
  await signUpViaUi(page, 'Ada Icons');
  await page.goto('/account');

  await expect(nav(page).getByRole('link', { name: 'Profile' })).toBeVisible();
  const icons = nav(page).getByRole('link').locator('svg[aria-hidden="true"]');
  await expect(icons).toHaveCount(await nav(page).getByRole('link').count());
  const box = (await icons.first().boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(16);
  expect(box.width).toBeLessThanOrEqual(20);

  // Back to home: an icon link above the title, at the card's left, big enough to tap.
  const home = page.getByRole('link', { name: 'Back to home' });
  await expect(home).toHaveAttribute('title', 'Back to home');
  const homeBox = (await home.boundingBox())!;
  const titleBox = (await page.getByRole('heading', { level: 1, name: 'Account' }).boundingBox())!;
  expect(homeBox.y + homeBox.height).toBeLessThanOrEqual(titleBox.y + 1);
  expect(homeBox.x).toBeLessThanOrEqual(titleBox.x);
  expect(homeBox.width).toBeGreaterThanOrEqual(24);
  expect(homeBox.height).toBeGreaterThanOrEqual(24);
  await home.focus();
  await expect(home).toBeFocused();

  // Google's status: words plus an icon, coloured as a warning while not connected.
  const google = nav(page).getByRole('link', { name: 'Google sign-in' });
  if ((await google.count()) > 0) {
    await google.click();
    const status = page.getByText('Not connected', { exact: true });
    await expect(status).toBeVisible();
    await expect(status.locator('svg')).toBeVisible();
    const [color, text] = await status.evaluate((el) => [
      getComputedStyle(el).color,
      getComputedStyle(el.closest('.card')!).color,
    ]);
    expect(color).not.toBe(text);
  }

  await home.click();
  await expect(page).toHaveURL(/\/$/);
});

test('mobile: the list first, then one section with a way back', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await signUpViaUi(page, 'Ada Mobile');
  await page.goto('/account');
  await expect(nav(page)).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Profile' })).toBeHidden();

  // Google is listed only when the stack offers Google sign-in.
  const google = nav(page).getByRole('link', { name: 'Google sign-in' });
  const [target, heading] =
    (await google.count()) > 0
      ? [google, 'Google sign-in']
      : [nav(page).getByRole('link', { name: 'Change password' }), 'Change password'];
  await target.click();
  // The section opens with its content; its heading is for screen readers only.
  const hidden = page.getByRole('heading', { level: 2, name: heading });
  await expect(hidden).toBeAttached();
  expect(await hidden.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('link', { name: 'Back to account' })).toBeVisible();
  await expect(nav(page)).toBeHidden();
  await page.getByRole('link', { name: 'Back to account' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(nav(page)).toBeVisible();
  await context.close();
});

test('the move-to-a-new-phone wizard lives under Two-step verification', async ({ page }) => {
  const ada = await signUpViaUi(page, 'Ada Wizard');
  await page.goto('/account/two-step');
  await enrolTotpViaUi(page, ada);
  const move = page.getByRole('region', { name: 'Move to a new phone' });
  await expect(move.getByRole('button', { name: 'Move to a new phone' })).toBeVisible();

  // Not on the other sections.
  await nav(page).getByRole('link', { name: 'Profile' }).click();
  await expect(page.getByRole('region', { name: 'Move to a new phone' })).toHaveCount(0);
});
