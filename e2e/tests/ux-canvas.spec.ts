import { expect, type Page, test } from '@playwright/test';
import { PROD_LOCAL, WEB } from '../support/env';
import { card, signUpViaUi, startTreeViaUi } from '../support/ui';

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

test('the panel is on the left, collapses, and stays collapsed after a reload', async ({
  page,
}) => {
  await newTree(page, 'Lee', 'Left');
  await card(page, 'Lee Left').click();
  const panel = page.getByRole('complementary', { name: 'Details' });
  await expect(panel.getByRole('heading', { name: /^Lee Left/ })).toBeVisible();
  const canvas = page.getByRole('region', { name: 'Family tree view' });
  expect((await panel.boundingBox())!.x).toBeLessThan((await canvas.boundingBox())!.x);
  const toggle = page.getByRole('button', { name: 'Details', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/\/people\//);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(card(page, 'Lee Left')).toBeVisible();
  await expect(panel).toBeHidden();

  await toggle.click();
  await expect(panel.getByRole('heading', { name: /^Lee Left/ })).toBeVisible();
  await panel.getByRole('heading', { name: /^Lee Left/ }).focus();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
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

test('Swap sides on the tree moves Xan to the other side of Ben', async ({ page }) => {
  await inLawTree(page);
  const side = async () =>
    Math.sign((await left(page, 'Xan Other')) - (await left(page, 'Ben Pine')));
  await expect.poll(side).not.toBe(0);
  const before = await side();
  await card(page, 'Ben Pine').click();
  await page.getByRole('tab', { name: 'Relations' }).click();
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
  await page.getByRole('tab', { name: 'Relations' }).click();
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
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(heading).toBeHidden();
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    await expect(heading).toBeVisible();
    expect(await noSideways()).toBe(true);
  });
});
