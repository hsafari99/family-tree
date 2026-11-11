import { expect, test } from '@playwright/test';
import { apiContext, enableTwoFactor, newAccount, ok, signUp } from '../support/api';
import { PROD_LOCAL } from '../support/env';
import { card, enrolTotpViaUi, signUpViaUi } from '../support/ui';

test.skip(PROD_LOCAL, 'dev stack only');

// UX round 1, batch 1: form polish (#1–5) and the death-place fix (#8). Each test uses its own
// account and tree, never the shared sample tree.

test('a password field has a Show password toggle', async ({ page }) => {
  await page.goto('/sign-in');
  const input = page.getByLabel('Password', { exact: true });
  await input.fill('not-a-real-password');
  const toggle = page.getByRole('button', { name: 'Show password' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(input).toHaveAttribute('type', 'text');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveText('Show');
  await toggle.click();
  await expect(input).toHaveAttribute('type', 'password');
});

test('the reset page checks that the two new passwords match', async ({ page }) => {
  // An owner (2FA on) with a tree, and a member without 2FA who can be sent a reset link.
  const ownerCtx = await apiContext();
  const memberCtx = await apiContext();
  try {
    const owner = newAccount('Reset Owner');
    await signUp(ownerCtx, owner);
    await enableTwoFactor(ownerCtx, owner.password);
    const tree = (await (
      await ok(
        await ownerCtx.post('/api/v1/trees', {
          data: { name: 'Reset tree', person: { givenName: 'Reset' } },
        }),
        'tree',
      )
    ).json()) as { tree: { id: string } };
    const treeId = tree.tree.id;
    const invite = (await (
      await ok(
        await ownerCtx.post(`/api/v1/trees/${treeId}/invites`, { data: { role: 'viewer' } }),
        'invite',
      )
    ).json()) as { token: string };
    const member = newAccount('Reset Member');
    await signUp(memberCtx, member);
    await ok(
      await memberCtx.post('/api/v1/invites/accept', { data: { token: invite.token } }),
      'accept',
    );
    const { members } = (await (
      await ok(await ownerCtx.get(`/api/v1/trees/${treeId}/members`), 'members')
    ).json()) as { members: { userId: string; role: string }[] };
    const target = members.find((m) => m.role !== 'owner')!;
    const { token } = (await (
      await ok(
        await ownerCtx.post(`/api/v1/trees/${treeId}/members/${target.userId}/reset-link`, {
          data: {},
        }),
        'reset link',
      )
    ).json()) as { token: string };

    await page.goto(`/reset/${token}`);
    await page.getByLabel('New password', { exact: true }).fill('brand-new-password');
    await page.getByLabel('Repeat new password', { exact: true }).fill('brand-new-passw0rd');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByText('The passwords don’t match')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/reset/${token}$`));
  } finally {
    await ownerCtx.dispose();
    await memberCtx.dispose();
  }
});

test('dates with a calendar and a precision, and a death place on a living person', async ({
  page,
}) => {
  const me = await signUpViaUi(page, 'Dora Dates');
  await page.goto('/trees/new');
  await enrolTotpViaUi(page, me);

  // #3: a select is as tall as a text input.
  const select = await page.getByLabel('Sex').boundingBox();
  const input = await page.getByLabel('Your first name').boundingBox();
  expect(Math.abs(select!.height - input!.height)).toBeLessThanOrEqual(1);

  // #4: "Born" opens on an exact day, with the native calendar.
  await page.getByLabel('Your first name').fill('Dora');
  await page.getByLabel('Your last name').fill('Dates');
  const born = page.getByRole('group', { name: 'Born' });
  await expect(born.getByLabel('Precision')).toHaveValue('day');
  await expect(born.getByLabel('Date')).toHaveAttribute('type', 'date');
  await born.getByLabel('Date').fill('1990-05-01');
  await page.getByRole('button', { name: 'Start tree' }).click();
  await expect(page).toHaveURL(/\/trees\/[0-9a-f-]{36}/);
  await card(page, 'Dora Dates').click();
  await expect(page.getByRole('heading', { name: 'Dora Dates' })).toBeVisible();
  const details = page.locator('.person-panel dl').first();
  await expect(details).toContainText('1 May 1990');
  await expect(details).toContainText('Living');

  // #8: a death place on a living person says what to do, at the field.
  await page.getByRole('tab', { name: 'Places' }).click();
  await page.getByRole('button', { name: 'Edit places' }).click();
  await page.getByLabel('Death place').fill('Leeds');
  await page.getByRole('button', { name: 'Save places' }).click();
  const message =
    'This person is marked as living. To add a death place, tick the box below to mark them as deceased.';
  await expect(page.getByLabel('Death place')).toHaveAccessibleDescription(message);
  await expect(page.getByRole('alert')).toContainText(`Death place: ${message}`);
  await page.getByRole('button', { name: `Death place: ${message}` }).click();
  await expect(page.getByRole('checkbox', { name: 'Mark Dora as deceased' })).toBeFocused();
  await page.getByRole('checkbox', { name: 'Mark Dora as deceased' }).check();
  await page.getByRole('button', { name: 'Save places' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('tab', { name: 'Info' }).click();
  await expect(details).not.toContainText('Living');

  // #4: "Died" at month precision.
  await page.getByRole('button', { name: 'Edit details' }).click();
  const died = page.getByRole('group', { name: 'Died' });
  await died.getByLabel('Precision').selectOption('month');
  await died.getByLabel('Year').fill('2001');
  await died.getByLabel('Month').selectOption({ label: 'March' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(details).toContainText('March 2001');
});

test('home sends a signed-out visitor to sign in, and shows a signed-in user their trees', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  // ?next= still brings a visitor back to the page they asked for.
  await page.goto('/account');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount$/);

  await signUpViaUi(page, 'Home Visitor');
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Your trees' })).toBeVisible();
});
