import { expect, type Page, test } from '@playwright/test';
import { PROD_LOCAL, WEB } from '../support/env';
import { card, openSection, signUpViaUi, startTreeViaUi } from '../support/ui';

test.skip(PROD_LOCAL, 'dev stack only');

// UX round 1, batch 4: couples side by side, the collapsible panel, partner order (#14–16).
// Each test uses its own account and tree, never the shared sample tree.

const year = (y: number) => ({ qualifier: 'exact', date1: String(y) });

/** The API, as the signed-in page (its cookies), from the web origin. */
function api(page: Page, treeId: string) {
  const base = `/api/v1/trees/${treeId}`;
  const post = async (path: string, data: object) => {
    const res = await page.request.post(`${base}${path}`, { data, headers: { origin: WEB } });
    expect(res.ok(), `${path}: ${res.status()} ${await res.text()}`).toBe(true);
    return res.status() === 204 ? null : ((await res.json()) as { id: string });
  };
  return {
    root: async () =>
      ((await (await page.request.get(base)).json()) as { tree: { rootPersonId: string } }).tree
        .rootPersonId,
    add: async (
      givenName: string,
      surname: string,
      birth: number | null,
      attach: { to: string; as: string; unionId?: string },
    ) =>
      (await post('/persons', {
        person: { givenName, surname, ...(birth ? { birthDate: year(birth) } : {}) },
        attach,
      }))!.id,
    unions: async (personId: string) =>
      (
        (await (await page.request.get(`${base}/persons/${personId}`)).json()) as {
          relations: { unions: { id: string; partner: { id: string } | null }[] };
        }
      ).relations.unions,
  };
}

async function newTree(page: Page, given: string, surname: string) {
  const me = await signUpViaUi(page, `${given} Owner`);
  const treeId = await startTreeViaUi(page, me, { given, surname });
  await expect(card(page, `${given} ${surname}`)).toBeVisible();
  return { treeId, a: api(page, treeId) };
}

/** Paul + Mary → Ann (1950), Ben (1952), Cat (1954); Ben's wife Xan was born first (1949). */
async function inLawTree(page: Page) {
  const { treeId, a } = await newTree(page, 'Paul', 'Pine');
  const paul = await a.root();
  await a.add('Mary', 'Pine', 1922, { to: paul, as: 'partner' });
  const pm = (await a.unions(paul))[0]!.id;
  await a.add('Ann', 'Pine', 1950, { to: paul, as: 'child', unionId: pm });
  const ben = await a.add('Ben', 'Pine', 1952, { to: paul, as: 'child', unionId: pm });
  await a.add('Cat', 'Pine', 1954, { to: paul, as: 'child', unionId: pm });
  await a.add('Xan', 'Other', 1949, { to: ben, as: 'partner' });
  await page.goto(`/trees/${treeId}?view=full`);
  await expect(card(page, 'Xan Other')).toBeVisible();
  return { treeId, a, ben };
}

const left = async (page: Page, name: string) => (await card(page, name).boundingBox())!.x;
/** Names of the given cards, left to right. */
async function rowOrder(page: Page, names: string[]) {
  const xs = await Promise.all(names.map(async (n) => [n, await left(page, n)] as const));
  return xs.sort((p, q) => p[1] - q[1]).map(([n]) => n);
}
const ROW = ['Ann Pine', 'Ben Pine', 'Cat Pine', 'Xan Other'];

test('partners sit side by side and siblings keep their order', async ({ page }) => {
  await inLawTree(page);
  await expect
    .poll(async () => {
      const order = await rowOrder(page, ROW);
      const [b, x] = [order.indexOf('Ben Pine'), order.indexOf('Xan Other')];
      return {
        neighbours: Math.abs(b - x) === 1,
        siblings: order.filter((n) => n !== 'Xan Other'),
      };
    })
    .toEqual({ neighbours: true, siblings: ['Ann Pine', 'Ben Pine', 'Cat Pine'] });
});

test('the panel is on the left, collapses to a rail, and stays collapsed after a reload', async ({
  page,
}) => {
  await newTree(page, 'Lee', 'Left');
  await card(page, 'Lee Left').click();
  const panel = page.getByRole('complementary', { name: 'Details' });
  const heading = panel.getByRole('heading', { name: /^Lee Left/ });
  await expect(heading).toBeVisible();
  const canvas = page.getByRole('region', { name: 'Family tree view' });
  expect((await panel.boundingBox())!.x).toBeLessThan((await canvas.boundingBox())!.x);
  // No separate Details toggle: the X and the rail do it.
  await expect(page.getByRole('button', { name: 'Details', exact: true })).toHaveCount(0);
  const expand = page.getByRole('button', { name: 'Expand panel' });
  await expect(expand).toHaveCount(0);

  // The X collapses it to a slim rail on the left, with a visible way back.
  const collapse = panel.getByRole('button', { name: 'Collapse panel' });
  await expect(collapse).toHaveAttribute('title', 'Collapse panel');
  await collapse.click();
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/\/people\//);
  await expect(expand).toBeVisible();
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expect(expand).toContainText('LL');
  const rail = (await expand.boundingBox())!;
  expect(rail.width).toBeLessThanOrEqual(48);
  expect(rail.x).toBeLessThan((await canvas.boundingBox())!.x);
  await page.reload();
  await expect(card(page, 'Lee Left')).toBeVisible();
  await expect(panel).toBeHidden();
  await expect(expand).toBeVisible();

  // Expand brings the same person back.
  await expand.click();
  await expect(heading).toBeVisible();
  await expect(page).toHaveURL(/\/people\//);
  await expect(expand).toHaveCount(0);
  await heading.focus();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(expand).toBeVisible();
  // The canvas hint sits above the drawing: it never covers a card or React Flow's controls.
  await page.goto(page.url().replace(/\/people\/.*$/, ''));
  const hint = page.locator('.canvas-hint');
  await expect(hint).toBeVisible();
  const h = (await hint.boundingBox())!;
  for (const el of [page.locator('.react-flow__controls'), card(page, 'Lee Left')]) {
    await expect(el).toBeVisible();
    const b = (await el.boundingBox())!;
    expect(h.y + h.height <= b.y || b.y + b.height <= h.y).toBe(true);
  }
});

test('a section opens in a dialog: Escape closes it, focus returns, and nested Escapes stay inside', async ({
  page,
}) => {
  const { treeId } = await newTree(page, 'Dia', 'Log');
  await page.goto(`/trees/${treeId}`);
  await card(page, 'Dia Log').click();
  const panel = page.getByRole('complementary', { name: 'Details' });
  await expect(panel.getByRole('button', { name: /^Places/ })).toHaveText('Places');
  const row = panel.getByRole('button', { name: /^Relations/ });
  await row.click();
  const dialog = page.getByRole('dialog', { name: 'Relations — Dia Log' });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/[?&]tab=relations/);
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
  // A menu inside handles its own Escape: the dialog stays open.
  await dialog.getByRole('button', { name: 'Add relative' }).click();
  await expect(page.getByRole('menuitem', { name: 'Partner' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'Partner' })).toBeHidden();
  await expect(dialog).toBeVisible();
  // So does a form field (a half-filled form isn't thrown away); the X still closes.
  await dialog.getByRole('button', { name: 'Add relative' }).click();
  await page.getByRole('menuitem', { name: 'Partner' }).click();
  await dialog.getByLabel('First name').fill('Half');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/tab=/);
  await expect(row).toBeFocused();
  // The panel itself stayed open.
  await expect(panel.getByRole('heading', { name: /^Dia Log/ })).toBeVisible();
  // A deep link opens the dialog straight away.
  await page.goto(`${page.url()}?tab=places`);
  await expect(page.getByRole('dialog', { name: 'Places — Dia Log' })).toBeVisible();
});

test('Swap sides on the tree moves Xan to the other side of Ben', async ({ page }) => {
  await inLawTree(page);
  const side = async () =>
    Math.sign((await left(page, 'Xan Other')) - (await left(page, 'Ben Pine')));
  await expect.poll(side).not.toBe(0);
  const before = await side();
  await card(page, 'Ben Pine').click();
  await openSection(page, 'Relations');
  await page
    .getByRole('button', { name: 'More actions for the relationship with Xan Other' })
    .click();
  await page.getByRole('menuitem', { name: 'Swap sides on the tree' }).click();
  await expect(page.getByText('Sides swapped.')).toBeVisible();
  await expect.poll(side).toBe(-before);
});

test('dragging a partner past the other swaps the couple', async ({ page }) => {
  await inLawTree(page);
  const side = async () =>
    Math.sign((await left(page, 'Xan Other')) - (await left(page, 'Ben Pine')));
  await expect.poll(side).not.toBe(0);
  const before = await side();
  // The photo is the card's drag handle (the name button and the "+" buttons don't drag).
  const photo = page
    .locator('.react-flow__node', { has: card(page, 'Xan Other') })
    .locator('.card-photo');
  const xan = (await photo.boundingBox())!;
  const ben = (await card(page, 'Ben Pine').boundingBox())!;
  const y = xan.y + xan.height / 2;
  await page.mouse.move(xan.x + xan.width / 2, y);
  await page.mouse.down();
  const target = ben.x + ben.width / 2 - before * ben.width;
  await page.mouse.move(target, y, { steps: 12 });
  await page.mouse.up();
  await expect.poll(side).toBe(-before);
});

test("Move later flips someone's partners on the canvas", async ({ page }) => {
  const { treeId, a } = await newTree(page, 'David', 'Hub');
  const david = await a.root();
  await a.add('Anna', 'Berg', 1958, { to: david, as: 'partner' });
  await a.add('Laura', 'Chen', 1965, { to: david, as: 'partner' });
  await page.goto(`/trees/${treeId}?view=full`);
  const annaLeft = async () => (await left(page, 'Anna Berg')) < (await left(page, 'Laura Chen'));
  await expect(card(page, 'Laura Chen')).toBeVisible();
  const before = await annaLeft();
  await card(page, 'David Hub').click();
  await openSection(page, 'Relations');
  const menus = page.getByRole('button', { name: /^More actions for the relationship with / });
  await menus.first().click();
  await page.getByRole('menuitem', { name: 'Move later' }).click();
  await expect(page.getByText('Order saved.')).toBeVisible();
  await expect.poll(annaLeft).toBe(!before);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the panel is a bottom sheet that collapses, with no sideways scroll', async ({ page }) => {
    await newTree(page, 'Pho', 'Ne');
    await card(page, 'Pho Ne').click();
    const heading = page.getByRole('heading', { name: /^Pho Ne/ });
    await expect(heading).toBeVisible();
    expect((await heading.boundingBox())!.y).toBeGreaterThan(844 / 3);
    const noSideways = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await noSideways()).toBe(true);
    await page.getByRole('button', { name: 'Collapse panel' }).click();
    await expect(heading).toBeHidden();
    // Collapsed, a small handle at the bottom brings it back.
    const handle = page.getByRole('button', { name: 'Show details' });
    await expect(handle).toBeVisible();
    expect((await handle.boundingBox())!.y).toBeGreaterThan(844 / 2);
    expect(await noSideways()).toBe(true);
    await handle.click();
    await expect(heading).toBeVisible();
    // A section opens full-screen.
    const dialog = await openSection(page, 'Places');
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(389);
    expect(box.height).toBeGreaterThanOrEqual(800);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(await noSideways()).toBe(true);
  });
});

test('a click outside a section dialog closes it; one inside, or on its menu, does not', async ({
  page,
}) => {
  const { treeId } = await newTree(page, 'Out', 'Side');
  await page.goto(`/trees/${treeId}`);
  await card(page, 'Out Side').click();
  const dialog = await openSection(page, 'Relations');
  await dialog.getByRole('heading', { name: 'Parents' }).click();
  await dialog.getByRole('button', { name: 'Add relative' }).click();
  await page.getByRole('menuitem', { name: 'Partner' }).click();
  await expect(dialog).toBeVisible();
  // The backdrop: the top-left corner of the page, well outside the centred dialog.
  await page.mouse.click(5, 5);
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/tab=/);
});
