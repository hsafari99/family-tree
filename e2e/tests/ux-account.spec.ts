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
  await expect(nav(page).getByRole('link', { name: /^Profile/ })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.goto('/account/two-step');
  await expect(nav(page)).toBeVisible();
  await expect(nav(page).getByRole('link', { name: /Two-step verification/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(nav(page).getByRole('link', { name: /Two-step verification/ })).toContainText(
    '2FA off',
  );
  // Beside the nav the section's name isn't repeated on screen; the heading stays for
  // screen readers.
  const twoStep = page.getByRole('heading', { level: 2, name: 'Two-step verification' });
  await expect(twoStep).toBeAttached();
  expect(await twoStep.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
  // The mobile back link is hidden beside the list.
  await expect(page.getByRole('link', { name: 'Back to account' })).toBeHidden();

  await nav(page)
    .getByRole('link', { name: /^Password/ })
    .click();
  await expect(page).toHaveURL(/\/account\/password$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Password' })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Two-step verification' })).toHaveCount(
    0,
  );

  // An unknown section falls back to Profile.
  await page.goto('/account/bogus');
  await expect(page).toHaveURL(/\/account$/);
  await expect(nav(page).getByRole('link', { name: /^Profile/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('mobile: the list first, then one section with a way back', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await signUpViaUi(page, 'Ada Mobile');
  await page.goto('/account');
  await expect(nav(page)).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Profile' })).toBeHidden();

  // Google is listed only when the stack offers Google sign-in.
  const google = nav(page).getByRole('link', { name: /^Google/ });
  const [target, heading] =
    (await google.count()) > 0
      ? [google, 'Google']
      : [nav(page).getByRole('link', { name: /^Password/ }), 'Password'];
  await target.click();
  // With the nav hidden, the section's own heading is shown.
  const shown = page.getByRole('heading', { level: 2, name: heading });
  await expect(shown).toBeVisible();
  expect(await shown.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(1);
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
  await expect(nav(page).getByRole('link', { name: /Two-step verification/ })).toContainText(
    '2FA on',
  );
  const move = page.getByRole('region', { name: 'Move to a new phone' });
  await expect(move.getByRole('button', { name: 'Move to a new phone' })).toBeVisible();

  // Not on the other sections.
  await nav(page)
    .getByRole('link', { name: /^Profile/ })
    .click();
  await expect(page.getByRole('region', { name: 'Move to a new phone' })).toHaveCount(0);
});
