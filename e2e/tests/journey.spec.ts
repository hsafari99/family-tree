import { expect, test } from '@playwright/test';
import { PROD_LOCAL } from '../support/env';
import { addRelative, card, enrolTotpViaUi, signUpViaUi, startTreeViaUi } from '../support/ui';

test.skip(PROD_LOCAL, 'dev stack only');

test('spec §9: family, steward invite, steward edits and deletes, owner restores', async ({
  browser,
}) => {
  // 1. Sign up and start a tree (2FA enrolment is part of it).
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  const olive = await signUpViaUi(owner, 'Olive Owner');
  const treeId = await startTreeViaUi(owner, olive, { given: 'Olive', surname: 'Owner' });
  await expect(card(owner, 'Olive Owner')).toBeVisible();

  // 2. Parents, a partner and two children, all from the card "+" buttons.
  await addRelative(owner, 'Olive Owner', 'parent', { given: 'Paul', surname: 'Owner' });
  await addRelative(owner, 'Olive Owner', 'parent', { given: 'Mary', surname: 'Owner' }, /Paul/);
  await addRelative(owner, 'Olive Owner', 'partner', { given: 'Pete', surname: 'Partner' });
  await addRelative(owner, 'Olive Owner', 'child', { given: 'Cleo', surname: 'Owner' }, /Pete/);
  await addRelative(owner, 'Olive Owner', 'child', { given: 'Dan', surname: 'Owner' }, /Pete/);

  // 3. An invite: viewer, steward of Pete. Pete's branch is Pete and his children; Olive has her
  //    own parents, so she and they are outside it (spec §4 rule 4).
  await owner.goto(`/trees/${treeId}/members`);
  await owner.getByRole('radio', { name: 'Can view' }).check();
  await owner.getByLabel('Make them a steward of').selectOption({ label: 'Pete Partner' });
  await owner.getByRole('button', { name: 'Create invite link' }).click();
  const link = await owner.getByLabel('Invite link').inputValue();
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{20,}$/);

  // 4. A second user opens the link, signs up, joins and turns on 2FA (the grant needs it).
  const stewardCtx = await browser.newContext();
  const steward = await stewardCtx.newPage();
  await steward.goto(new URL(link).pathname);
  await steward.getByRole('link', { name: 'Create an account' }).click();
  await expect(steward).toHaveURL(/\/sign-up\?next=/);
  const signUpPath = new URL(steward.url()).pathname + new URL(steward.url()).search;
  const sam = await signUpViaUi(steward, 'Sam Steward', signUpPath);
  await steward.getByRole('button', { name: /^Join / }).click();
  await expect(steward).toHaveURL(new RegExp(`/trees/${treeId}`));
  await expect(steward.getByText(/Turn on two-step verification/)).toBeVisible();
  await steward.goto('/account/two-step');
  await enrolTotpViaUi(steward, sam);
  await steward.goto(`/trees/${treeId}`);
  await expect(steward.getByText(/You look after the branches of: Pete Partner/)).toBeVisible();

  // 5. The steward edits inside the branch, and can't edit outside it.
  await card(steward, 'Cleo Owner').click();
  await steward.getByRole('button', { name: 'Edit details' }).click();
  await steward.getByLabel('Occupation').fill('Architect');
  await steward.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(steward.getByText('Architect')).toBeVisible();
  await steward.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Full' }).click();
  await card(steward, 'Paul Owner').click();
  // The panel is open on Paul (so "no Edit details" means something).
  await expect(steward.getByRole('heading', { name: 'Paul Owner' })).toBeVisible();
  await expect(steward.getByRole('button', { name: 'Edit details' })).toHaveCount(0);

  // 6. The steward adds Eve as Pete's child on his own (so every link is inside the branch), then
  //    deletes her to Trash after the preview. (Dan also has Olive, who is outside the branch.)
  await addRelative(
    steward,
    'Pete Partner',
    'child',
    { given: 'Eve', surname: 'Partner' },
    /Unknown other parent/,
  );
  // Her card sits under the minimap, so open her from Pete's relations in the side panel.
  await steward.getByRole('link', { name: 'Eve Partner' }).click();
  await expect(steward.getByRole('heading', { name: 'Eve Partner' })).toBeVisible();
  await steward.getByRole('button', { name: 'Delete…' }).click();
  await steward.getByRole('radio', { name: /just this person/i }).check();
  await steward.getByRole('button', { name: 'Move to Trash' }).click();
  await steward.getByRole('button', { name: 'Yes, move to Trash' }).click();
  await expect(steward.getByRole('heading', { name: 'Eve Partner' })).toHaveCount(0);

  // 7. The owner sees the batch in Trash, restores it, and Eve is back.
  await owner.goto(`/trees/${treeId}/trash`);
  await expect(owner.getByText(/Eve Partner/)).toBeVisible();
  await owner.getByRole('button', { name: 'Restore' }).first().click();
  await expect(owner.getByText('Restored.')).toBeVisible();
  await owner.goto(`/trees/${treeId}`);
  await owner.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Full' }).click();
  await expect(card(owner, 'Eve Partner')).toBeVisible();
  await card(owner, 'Cleo Owner').click();
  await expect(owner.getByText('Architect')).toBeVisible();

  await ownerCtx.close();
  await stewardCtx.close();
});
