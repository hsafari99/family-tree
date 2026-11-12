import { expect, type Page, test } from '@playwright/test';
import { PROD_LOCAL } from '../support/env';
import { addRelative, card, openSection, signUpViaUi, startTreeViaUi } from '../support/ui';

test.skip(PROD_LOCAL, 'dev stack only');

// UX round 1, batch 3: relations, parents and places (#7, #9–13). Each test uses its own
// account and tree, never the shared sample tree.

const ROOT = 'Rae Root';

async function newTree(page: Page) {
  const me = await signUpViaUi(page, 'Rel Owner');
  const treeId = await startTreeViaUi(page, me, { given: 'Rae', surname: 'Root' });
  await expect(card(page, ROOT)).toBeVisible();
  return treeId;
}

const dot = (page: Page, label: string | RegExp) =>
  page.getByRole('button', { name: label, includeHidden: true });

async function openPanel(page: Page, name: string, section: 'Relations' | 'Places') {
  await card(page, name).click();
  await expect(page.getByRole('heading', { name: new RegExp(`^${name}`) })).toBeVisible();
  return openSection(page, section);
}

/** Root + partner Pat, and Kid with "Unknown other parent" (a single-parent union of Rae). */
async function coupleAndKid(page: Page) {
  await addRelative(page, ROOT, 'partner', { given: 'Pat', surname: 'Root' });
  await addRelative(page, ROOT, 'child', { given: 'Kid', surname: 'Root' }, /Unknown other parent/);
  await expect(dot(page, /^Relationship of Rae Root \(/)).toHaveCount(1);
}

test('a sibling of someone with no parents shares a parents-unknown dot', async ({ page }) => {
  await newTree(page);
  await addRelative(page, ROOT, 'sibling', { given: 'Sis', surname: 'Root' });
  await expect(dot(page, 'Siblings with unknown parents')).toHaveCount(1);
  const siblings = await openPanel(page, ROOT, 'Relations');
  await expect(siblings.getByRole('link', { name: 'Sis Root' })).toBeVisible();
  await expect(siblings.getByText('Parents unknown')).toBeVisible();
});

test('the second parent joins the first as a couple', async ({ page }) => {
  await newTree(page);
  await addRelative(page, ROOT, 'parent', { given: 'Mum', surname: 'Root' });
  await addRelative(page, ROOT, 'parent', { given: 'Dad', surname: 'Root' }, /^Partner of Mum/);
  await expect(
    dot(page, /^Relationship of (Mum Root and Dad Root|Dad Root and Mum Root)/),
  ).toHaveCount(1);
  await expect(dot(page, /^Relationship of/)).toHaveCount(1);
});

test('both parents in one step make one union', async ({ page }) => {
  await newTree(page);
  await card(page, ROOT).hover();
  await page.getByRole('button', { name: `Add a parent of ${ROOT}` }).click();
  const form = page.getByRole('form', { name: 'Add parent' });
  await form.getByLabel('First name').first().fill('Mum');
  await form.getByLabel('Last name').first().fill('Root');
  await form.getByRole('checkbox', { name: 'Add a second parent too' }).check();
  const second = form.getByRole('group', { name: 'Second parent' });
  await second.getByLabel('First name').fill('Dad');
  await second.getByLabel('Last name').fill('Root');
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(card(page, 'Mum Root')).toBeVisible();
  await expect(card(page, 'Dad Root')).toBeVisible();
  await expect(dot(page, /^Relationship of/)).toHaveCount(1);
});

test('Change parents… moves a child onto the couple', async ({ page }) => {
  await newTree(page);
  await coupleAndKid(page);
  await openPanel(page, 'Kid Root', 'Relations');
  await page.getByRole('button', { name: `More actions for ${ROOT}` }).click();
  await page.getByRole('menuitem', { name: 'Change parents…' }).click();
  const group = page.getByRole('group', { name: 'Move Kid Root to other parents' });
  await group.getByRole('radio', { name: /Rae Root and Pat Root|Pat Root and Rae Root/ }).check();
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByText('Parents changed.')).toBeVisible();
  // The single-parent dot is gone: Kid's line now comes from the couple's dot.
  await expect(dot(page, /^Relationship of Rae Root \(/)).toHaveCount(0);
});

test('dragging a child’s line onto the couple’s dot re-links them', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a pointer gesture');
  await newTree(page);
  await coupleAndKid(page);
  const edge = page.locator('.react-flow__edge[aria-label="Kid Root, child of Rae Root"]');
  const handle = edge.locator('.react-flow__edgeupdater-source');
  const from = (await handle.boundingBox())!;
  const couple = dot(page, /^Relationship of (Rae Root and Pat Root|Pat Root and Rae Root)/);
  const node = page.locator('.react-flow__node-union').filter({ has: couple });
  const target = (await node.locator('.react-flow__handle-bottom').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 15 });
  await page.mouse.up();
  await expect(page.getByText('Parents changed.')).toBeVisible();
  await expect(dot(page, /^Relationship of Rae Root \(/)).toHaveCount(0);
});

test('Places: add, edit from the menu and remove, one form at a time', async ({ page }) => {
  await newTree(page);
  await openPanel(page, ROOT, 'Places');
  await page.getByRole('button', { name: 'Add place' }).click();
  const add = page.getByRole('form', { name: 'Add place' });
  await add.getByLabel('Place').fill('Leeds');
  await add.getByRole('button', { name: 'Add place' }).click();
  const list = page.getByRole('list', { name: 'Places' });
  await expect(list.getByText('Leeds')).toBeVisible();

  await page.getByRole('button', { name: 'Add place' }).click();
  await expect(page.getByRole('form', { name: 'Add place' })).toBeVisible();
  await page.getByRole('button', { name: 'More actions for Leeds' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await expect(page.getByRole('form', { name: 'Add place' })).toHaveCount(0);
  const edit = page.getByRole('form', { name: 'Edit lived here' });
  await expect(edit.getByLabel('Place')).toBeFocused();
  await edit.getByLabel('Place').fill('York');
  await edit.getByRole('button', { name: 'Save place' }).click();
  await expect(list.getByText('York')).toBeVisible();

  await page.getByRole('button', { name: 'More actions for York' }).click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await page.getByRole('button', { name: 'Yes, remove' }).click();
  await expect(page.getByText('No places added yet.')).toBeVisible();
});

test('Add person: Related to … as Partner or spouse draws a union', async ({ page }) => {
  const treeId = await newTree(page);
  await page.goto(`/trees/${treeId}/people/new`);
  await page.getByLabel('First name').fill('Sam');
  await page.getByLabel('Last name').fill('Spouse');
  await page.getByLabel('Related to').selectOption({ label: ROOT });
  await page.getByLabel('Relationship').selectOption({ label: `Partner or spouse of ${ROOT}` });
  await page.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByRole('heading', { name: /^Sam Spouse/ })).toBeVisible();
  await expect(
    dot(page, /^Relationship of (Rae Root and Sam Spouse|Sam Spouse and Rae Root)/),
  ).toHaveCount(1);
});
