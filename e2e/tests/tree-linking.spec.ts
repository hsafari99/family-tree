import { expect, type Page, test } from '@playwright/test';
import type { Account } from '../support/api';
import { PROD_LOCAL } from '../support/env';
import { addRelative, card, signUpViaUi, startTreeViaUi } from '../support/ui';

test.skip(PROD_LOCAL, 'dev stack only');

/** Opens an invite link in a fresh page, signs up through it and joins the tree. */
async function joinVia(page: Page, link: string, name: string, treeId: string): Promise<Account> {
  await page.goto(new URL(link).pathname + new URL(link).hash);
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page).toHaveURL(/\/sign-up\?next=/);
  const url = new URL(page.url());
  const account = await signUpViaUi(page, name, url.pathname + url.search);
  await page.getByRole('button', { name: /^Join / }).click();
  await expect(page).toHaveURL(new RegExp(`/trees/${treeId}`));
  return account;
}

test('two trees linked through the person in both: request, accept, unfold, end', async ({
  browser,
}) => {
  // Olive's tree, with her partner Sara.
  const oliveCtx = await browser.newContext();
  const olive = await oliveCtx.newPage();
  const oliveAcc = await signUpViaUi(olive, 'Olive Owner');
  const king = await startTreeViaUi(olive, oliveAcc, { given: 'Olive', surname: 'Owner' });
  await addRelative(olive, 'Olive Owner', 'partner', { given: 'Sara', surname: 'Rahimi' });

  // Sara joins on her own card.
  await card(olive, 'Sara Rahimi').click({ button: 'right' });
  await olive.getByRole('menuitem', { name: 'Invite Sara…' }).click();
  const dialog = olive.getByRole('dialog', { name: 'Invite Sara Rahimi' });
  await dialog.getByRole('radio', { name: 'Can view' }).check();
  await dialog.getByRole('button', { name: 'Create invite link' }).click();
  const link = await dialog.getByLabel('Invite link').inputValue();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const saraCtx = await browser.newContext();
  const sara = await saraCtx.newPage();
  const saraAcc = await joinVia(sara, link, 'Sara Rahimi', king);

  // She starts her own family's tree, with her father in it.
  await startTreeViaUi(sara, saraAcc, { given: 'Sara', surname: 'Rahimi' });
  await addRelative(sara, 'Sara Rahimi', 'parent', { given: 'Dariush', surname: 'Rahimi' });

  // From Olive's tree, Sara asks to link the two. Her own tree's side is accepted already.
  await sara.goto(`/trees/${king}/members`);
  const section = sara.getByRole('region', { name: 'Linked trees' });
  await section.getByRole('button', { name: 'Link with another tree I’m in' }).click();
  await section.getByLabel('Tree to link with').selectOption({ label: 'Rahimi family (1 person)' });
  await section.getByRole('button', { name: 'Send request' }).click();
  await expect(section.getByText(/Waiting for this tree’s owner/)).toBeVisible();

  // Olive sees the request on her Home page and accepts it.
  await olive.goto('/');
  const requests = olive.getByRole('region', { name: 'Link requests' });
  await expect(requests.getByText(/Sara Rahimi wants to link/)).toBeVisible();
  await requests.getByRole('button', { name: 'Accept' }).click();
  await expect(requests.getByText(/Accepted/)).toBeVisible();

  // On Olive's tree, Sara's card unfolds her family: Dariush, view only.
  await olive.goto(`/trees/${king}?view=full`);
  await expect(olive.getByText(/Now linked with the .* tree through Sara Rahimi/)).toBeVisible();
  await olive.getByRole('button', { name: 'Show Rahimi family, 1 person' }).click();
  const dariush = card(olive, 'Dariush Rahimi');
  await expect(dariush).toHaveAccessibleName(/view only/);
  await dariush.click();
  const panel = olive.getByRole('complementary', { name: 'Details' });
  await expect(panel.getByRole('heading', { level: 2, name: /^Dariush Rahimi/ })).toBeVisible();
  await expect(panel.getByText('View only')).toBeVisible();
  await expect(olive.getByRole('button', { name: 'Add a parent of Dariush Rahimi' })).toHaveCount(
    0,
  );

  // Olive ends the link: the other tree is gone from her canvas.
  await olive.goto(`/trees/${king}/members`);
  const linked = olive.getByRole('region', { name: 'Linked trees' });
  await linked.getByRole('button', { name: 'End link' }).click();
  await linked.getByRole('button', { name: /^End the link with / }).click();
  await expect(linked.getByText(/has ended/)).toBeVisible();
  await olive.goto(`/trees/${king}?view=full`);
  await expect(card(olive, 'Sara Rahimi')).toBeVisible();
  await expect(olive.getByRole('button', { name: /^Show .*Rahimi/ })).toHaveCount(0);
  await expect(card(olive, 'Dariush Rahimi')).toHaveCount(0);

  await oliveCtx.close();
  await saraCtx.close();
});
