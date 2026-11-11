import { expect, type Page, test } from '@playwright/test';
import { apiContext, ok } from '../support/api';
import { PROD_LOCAL } from '../support/env';
import { rawSecret, totpCode } from '../support/totp';
import { enrolTotpViaUi, signUpViaUi } from '../support/ui';

test.skip(PROD_LOCAL, 'dev stack only');

/** The "Two-step verification: On/Off" line at the top of Account settings. */
const twoFactorStatus = (page: Page) =>
  page.locator('dt', { hasText: /^Two-step verification$/ }).locator('+ dd');

/** A password sign-in through the API, finished with `code`; returns the verify response. */
async function signInWithCode(email: string, password: string, code: string) {
  const ctx = await apiContext();
  const signIn = await ok(
    await ctx.post('/api/auth/sign-in/email', { data: { email, password } }),
    'sign-in',
  );
  expect((await signIn.json()).twoFactorRedirect).toBe(true);
  const verify = await ctx.post('/api/auth/two-factor/verify-totp', { data: { code } });
  return { ctx, verify };
}

test('spec §5: move two-step verification to a new phone without turning it off', async ({
  page,
}) => {
  const ada = await signUpViaUi(page, 'Ada Mover');
  await page.goto('/account');
  const oldRaw = await enrolTotpViaUi(page, ada);

  // Signed in somewhere else too, with the old phone.
  const elsewhere = await signInWithCode(ada.email, ada.password, await totpCode(oldRaw));
  expect(elsewhere.verify.ok()).toBe(true);

  // Step 1: confirm it's you with the password and a code from the current phone.
  const move = page.getByRole('region', { name: 'Move to a new phone' });
  await move.getByRole('button', { name: 'Move to a new phone' }).click();
  await expect(move.getByRole('heading', { name: /Step 1 of 3/ })).toBeFocused();
  await move.getByLabel('Your password', { exact: true }).fill(ada.password);
  await move
    .getByLabel('Code from your current phone, or a recovery code')
    .fill(await totpCode(oldRaw));
  await move.getByRole('button', { name: 'Continue' }).click();

  // Step 2: the new phone scans the key; 2FA is still on and the old phone still works meanwhile.
  await expect(move.getByRole('heading', { name: /Step 2 of 3/ })).toBeFocused();
  await expect(move.getByRole('img', { name: /QR code/ })).toBeVisible();
  const newRaw = rawSecret((await move.locator('code.secret').textContent())!.replace(/\s+/g, ''));
  expect(newRaw).not.toBe(oldRaw);
  await expect(twoFactorStatus(page)).toHaveText('On');
  await move.getByLabel('6-digit code from the new phone').fill(await totpCode(newRaw));
  await move.getByRole('button', { name: 'Move to this phone' }).click();

  // Step 3: new recovery codes, shown once.
  await expect(move.getByRole('heading', { name: /Step 3 of 3/ })).toBeFocused();
  await expect(
    move.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem'),
  ).toHaveCount(8);
  await move.getByRole('button', { name: "I've saved these codes" }).click();
  await expect(move.getByRole('status')).toContainText('now uses your new phone');

  // The other session is gone; this one stays.
  expect((await elsewhere.ctx.get('/api/v1/me')).status()).toBe(401);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();

  // The old phone's code no longer signs in.
  const old = await signInWithCode(ada.email, ada.password, await totpCode(oldRaw));
  expect(old.verify.status()).toBe(401);

  // The new phone's code does, through the sign-in pages.
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email', { exact: true }).fill(ada.email);
  await page.getByLabel('Password', { exact: true }).fill(ada.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/sign-in\/verify/);
  await page.getByLabel('6-digit code').fill(await totpCode(newRaw));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
  await page.goto('/account');
  await expect(twoFactorStatus(page)).toHaveText('On');
});
