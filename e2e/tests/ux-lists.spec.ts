import { expect, type Page, test } from '@playwright/test';
import { apiContext, newAccount, ok, signUp } from '../support/api';
import { PROD_LOCAL, WEB } from '../support/env';
import { card, signUpViaUi, startTreeViaUi } from '../support/ui';

test.skip(PROD_LOCAL, 'dev stack only');

// UX round 1, batch 5: the people list, Trash and Members (#17–19).
// Each test uses its own account and tree, never the shared sample tree.

const year = (y: number) => ({ qualifier: 'exact', date1: String(y) });

async function newTree(page: Page, given: string, surname: string) {
  const me = await signUpViaUi(page, `${given} Owner`);
  const treeId = await startTreeViaUi(page, me, { given, surname });
  await expect(card(page, `${given} ${surname}`)).toBeVisible();
  const base = `/api/v1/trees/${treeId}`;
  const root = ((await (await page.request.get(base)).json()) as { tree: { rootPersonId: string } })
    .tree.rootPersonId;
  const add = async (givenName: string, birth: number, to: string, as: string) => {
    const res = await page.request.post(`${base}/persons`, {
      data: { person: { givenName, surname, birthDate: year(birth) }, attach: { to, as } },
      headers: { origin: WEB },
    });
    expect(res.ok(), `add ${givenName}: ${res.status()}`).toBe(true);
    return ((await res.json()) as { id: string }).id;
  };
  return { treeId, root, add, base };
}

test('people list: compact Show on tree buttons that centre the canvas', async ({ page }) => {
  const { treeId, root, add } = await newTree(page, 'Lia', 'List');
  await add('Max', 1980, root, 'child');
  await add('Noa', 1950, root, 'parent');
  await page.goto(`/trees/${treeId}`);
  await page.getByRole('link', { name: 'List of all people' }).click();
  const list = page.getByRole('list', { name: 'People' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  const listWidth = (await list.boundingBox())!.width;
  const buttons = list.getByRole('button', { name: /on tree$/ });
  await expect(buttons).toHaveCount(3);
  for (const b of await buttons.all()) {
    expect((await b.boundingBox())!.width).toBeLessThan(listWidth / 2);
  }
  await list.getByRole('button', { name: 'Show Max List on tree' }).click();
  await expect(page).toHaveURL(/[?&]focus=[0-9a-f-]{36}/);
  await expect(card(page, 'Max List')).toBeVisible();
});

test('trash: compact row buttons, and Restore works', async ({ page }) => {
  const { treeId, root, add } = await newTree(page, 'Tia', 'Trash');
  await add('Una', 1990, root, 'child');
  await page.goto(`/trees/${treeId}`);
  await card(page, 'Una Trash').click();
  await expect(page.getByRole('heading', { name: 'Una Trash' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete…' }).click();
  await page.getByRole('radio', { name: /just this person/i }).check();
  await page.getByRole('button', { name: 'Move to Trash' }).click();
  await page.getByRole('button', { name: 'Yes, move to Trash' }).click();
  await expect(page.getByRole('heading', { name: 'Una Trash' })).toHaveCount(0);

  await page.goto(`/trees/${treeId}/trash`);
  const row = page.locator('ul.row-list > li').filter({ hasText: 'Una Trash' });
  await expect(row).toBeVisible();
  const restore = row.getByRole('button', { name: 'Restore' });
  expect((await restore.boundingBox())!.height).toBeLessThanOrEqual(40);
  const erase = row.getByRole('button', { name: 'Erase permanently' });
  expect((await erase.boundingBox())!.height).toBeLessThanOrEqual(40);
  // The buttons sit on the title's line, to its right, on a desktop.
  const title = (await row.locator('strong').boundingBox())!;
  expect((await restore.boundingBox())!.x).toBeGreaterThan(title.x + title.width);
  await restore.click();
  await expect(page.getByText('Restored.')).toBeVisible();
  await page.goto(`/trees/${treeId}?view=full`);
  await expect(card(page, 'Una Trash')).toBeVisible();
});

/** An owner's tree with two more members: Vic (an editor) and Wes (a viewer and a steward). */
async function membersTree(page: Page) {
  const { treeId, root, add, base } = await newTree(page, 'Mia', 'Member');
  const kid = await add('Kai', 1985, root, 'child');
  const post = async (path: string, data: object) =>
    (await (
      await ok(await page.request.post(`${base}${path}`, { data, headers: { origin: WEB } }), path)
    ).json()) as { token: string };
  const ids: Record<string, string> = {};
  for (const [name, role] of [
    ['Vic Editor', 'editor'],
    ['Wes Viewer', 'viewer'],
  ] as const) {
    const { token } = await post('/invites', { role });
    const ctx = await apiContext();
    try {
      await signUp(ctx, newAccount(name));
      await ok(await ctx.post('/api/v1/invites/accept', { data: { token } }), 'accept');
    } finally {
      await ctx.dispose();
    }
  }
  const { members } = (await (await page.request.get(`${base}/members`)).json()) as {
    members: { userId: string; name: string }[];
  };
  for (const m of members) ids[m.name] = m.userId;
  await ok(
    await page.request.post(`${base}/stewards`, {
      data: { userId: ids['Wes Viewer'], anchorPersonId: kid },
      headers: { origin: WEB },
    }),
    'steward',
  );
  return treeId;
}

const HEADERS = ['Name', 'Role', 'Branch / steward scope', 'Joined', 'Actions'];

test('members at desktop: five headers and aligned columns', async ({ page }) => {
  const treeId = await membersTree(page);
  await page.goto(`/trees/${treeId}/members`);
  const table = page.getByRole('table', { name: /^Members of / });
  await expect(table.getByRole('columnheader')).toHaveText(HEADERS);
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: 'Wes Viewer' })).toContainText(
    'Steward of Kai Member’s branch',
  );
  for (let col = 0; col < HEADERS.length; col++) {
    const head = (await table.getByRole('columnheader').nth(col).boundingBox())!.x;
    for (let r = 0; r < 3; r++) {
      const x = (await rows.nth(r).locator('td').nth(col).boundingBox())!.x;
      expect(Math.abs(x - head), `column ${HEADERS[col]}, row ${r}`).toBeLessThanOrEqual(1);
    }
  }
});

test('members on a phone: no sideways scroll, every cell labelled', async ({ page }) => {
  const treeId = await membersTree(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/trees/${treeId}/members`);
  const table = page.getByRole('table', { name: /^Members of / });
  await expect(table.locator('tbody tr')).toHaveCount(3);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // Each visible cell shows its column's name before its value.
  const labels = await table.locator('tbody td').evaluateAll((tds) =>
    tds
      .filter((td) => getComputedStyle(td).display !== 'none')
      .map((td) => ({
        label: td.getAttribute('data-label'),
        shown: getComputedStyle(td, '::before').content,
      })),
  );
  expect(labels.length).toBeGreaterThanOrEqual(12);
  for (const { label, shown } of labels) {
    expect(HEADERS).toContain(label);
    expect(shown).toBe(`"${label}"`);
  }
});
