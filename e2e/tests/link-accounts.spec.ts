import { expect, type Page, test } from '@playwright/test';
import { PROD_LOCAL } from '../support/env';
import { addRelative, card, signUpViaUi, startTreeViaUi } from '../support/ui';

test.skip(PROD_LOCAL, 'dev stack only');

/** Opens an invite link in a fresh page, signs up through it and joins the tree. */
async function joinVia(page: Page, link: string, name: string, treeId: string) {
  await page.goto(new URL(link).pathname);
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page).toHaveURL(/\/sign-up\?next=/);
  const url = new URL(page.url());
  await signUpViaUi(page, name, url.pathname + url.search);
  await page.getByRole('button', { name: /^Join / }).click();
  await expect(page).toHaveURL(new RegExp(`/trees/${treeId}`));
}

test('invite from a card, join as that person; "This is me" for an unlinked member', async ({
  browser,
}) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  const olive = await signUpViaUi(owner, 'Olive Owner');
  const treeId = await startTreeViaUi(owner, olive, { given: 'Olive', surname: 'Owner' });
  await addRelative(owner, 'Olive Owner', 'child', { given: 'Cleo', surname: 'Owner' });
  await addRelative(owner, 'Olive Owner', 'child', { given: 'Dan', surname: 'Owner' }, /Unknown/);

  // 1. The owner invites Cleo from her card's menu: steward of her branch by default.
  await card(owner, 'Cleo Owner').click({ button: 'right' });
  await owner.getByRole('menuitem', { name: 'Invite Cleo…' }).click();
  const dialog = owner.getByRole('dialog', { name: 'Invite Cleo Owner' });
  await expect(dialog.getByRole('radio', { name: 'Steward of Cleo’s branch' })).toBeChecked();
  await dialog.getByRole('radio', { name: 'Can add and edit' }).check();
  await dialog.getByRole('button', { name: 'Create invite link' }).click();
  const link = await dialog.getByLabel('Invite link').inputValue();
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{20,}$/);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(
    owner.getByRole('complementary', { name: 'Details' }).getByText('Invite pending'),
  ).toBeVisible();

  // 2. Cleo signs up through the link and lands on her own card, marked as her.
  const cleoCtx = await browser.newContext();
  const cleo = await cleoCtx.newPage();
  await joinVia(cleo, link, 'Cleo Child', treeId);
  await expect(card(cleo, 'Cleo Owner')).toHaveAccessibleName(/, you$/);
  await expect(cleo.getByRole('heading', { level: 2, name: /^Cleo Owner/ })).toBeVisible();
  await expect(cleo.getByText(/Which one is you\?/)).toHaveCount(0);

  // 3. A plain invite: Dan joins with no card, is asked which one he is, and picks his.
  await owner.goto(`/trees/${treeId}/members`);
  await owner.getByRole('radio', { name: 'Can view' }).check();
  await owner.getByRole('button', { name: 'Create invite link' }).click();
  const plain = await owner.getByLabel('Invite link').inputValue();
  const danCtx = await browser.newContext();
  const dan = await danCtx.newPage();
  await joinVia(dan, plain, 'Dan Son', treeId);
  await expect(dan.getByText(/Which one is you\? Open your card/)).toBeVisible();
  await card(dan, 'Dan Owner').click();
  const panel = dan.getByRole('complementary', { name: 'Details' });
  await expect(panel.getByRole('heading', { level: 2, name: /^Dan Owner/ })).toBeVisible();
  await panel.getByRole('button', { name: 'This is me' }).click();
  await dan.getByRole('button', { name: 'Yes, this is me' }).click();
  await expect(card(dan, 'Dan Owner')).toHaveAccessibleName(/, you$/);
  await expect(panel.getByRole('button', { name: 'This is me' })).toHaveCount(0);
  await expect(dan.getByText(/Which one is you\?/)).toHaveCount(0);
  // Cleo's card is someone else's account to Dan.
  await expect(card(dan, 'Cleo Owner')).toHaveAccessibleName(/, linked to Cleo Child$/);

  // 4. The owner sees both links on the members page and on the cards.
  await owner.goto(`/trees/${treeId}/members`);
  const rowOf = (name: string) => owner.getByRole('row').filter({ hasText: name });
  await expect(rowOf('Cleo Child')).toContainText('Card: Cleo Owner');
  await expect(rowOf('Dan Son')).toContainText('Card: Dan Owner');
  await owner.goto(`/trees/${treeId}`);
  await expect(owner.getByRole('img', { name: 'Linked to Dan Son' })).toBeVisible();

  await ownerCtx.close();
  await cleoCtx.close();
  await danCtx.close();
});
