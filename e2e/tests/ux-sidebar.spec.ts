import { expect, test } from '@playwright/test';
import { PROD_LOCAL, WEB } from '../support/env';
import { card, openTreeSettings, signUpViaUi, startTreeViaUi } from '../support/ui';

test.skip(PROD_LOCAL, 'dev stack only');

// Above the canvas: the Focus | Full links and the search box, on one row. The side panel holds
// the generations slider, the person and the tree rows. Its own account and tree.

test('the side panel and the bar above the canvas: search, generations, tags, dialogs, views', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const me = await signUpViaUi(page, 'Sid Owner');
  const treeId = await startTreeViaUi(page, me, { given: 'Sid', surname: 'Side' });
  await expect(card(page, 'Sid Side')).toBeVisible();
  const base = `/api/v1/trees/${treeId}`;
  const root = ((await (await page.request.get(base)).json()) as { tree: { rootPersonId: string } })
    .tree.rootPersonId;
  const res = await page.request.post(`${base}/persons`, {
    data: { person: { givenName: 'Kim', surname: 'Side' }, attach: { to: root, as: 'child' } },
    headers: { origin: WEB },
  });
  expect(res.ok()).toBe(true);
  await page.goto(`/trees/${treeId}`);

  // Search sits before Focus | Full above the canvas, on the same row, the group centred.
  const panel = page.getByRole('complementary', { name: 'Details' });
  const search = page.getByRole('searchbox', { name: 'Search' });
  await expect(search).toBeVisible();
  await expect(panel.getByRole('searchbox')).toHaveCount(0);
  const views = (await page.getByRole('group', { name: 'View' }).boundingBox())!;
  const box = (await search.boundingBox())!;
  expect(views.x).toBeGreaterThan(box.x + box.width);
  await expect(search).toHaveAttribute('placeholder', 'Search a person by name');
  const bar = (await page.locator('.canvas-bar').boundingBox())!;
  const left = (await page.locator('.canvas-bar .search-box').boundingBox())!.x - bar.x;
  const right = bar.x + bar.width - (views.x + views.width);
  expect(Math.abs(left - right)).toBeLessThan(4);
  expect(Math.abs(box.y + box.height / 2 - (views.y + views.height / 2))).toBeLessThan(8);
  expect(box.y + box.height).toBeLessThan((await page.locator('.canvas-area').boundingBox())!.y);
  // With nothing selected the panel still shows: Generations first, then a hint.
  const depth = panel.getByLabel('Generations');
  await expect(depth).toBeVisible();
  await expect(panel.getByText('Select someone on the tree.')).toBeVisible();
  await expect(page.getByText('You are the owner of this tree.')).toHaveCount(0);
  await expect(page.getByText(/^Starting person:/)).toHaveCount(0);
  // No sideways scroll, and the canvas ends inside the window.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
  const area = (await page.locator('.canvas-area').boundingBox())!;
  expect(area.y + area.height).toBeLessThanOrEqual(720);

  // Search opens the person; its results float over the canvas, not clipped by it. Their heading
  // carries the role and starting-person tags.
  await search.fill('Sid');
  const results = page.getByRole('list', { name: 'Search results' });
  const hit = results.getByRole('button', { name: /Sid Side/ });
  await expect(hit).toBeVisible();
  const at = (await hit.boundingBox())!;
  expect(
    await page.evaluate(
      ([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('.search-results'),
      [at.x + at.width / 2, at.y + at.height / 2],
    ),
  ).toBe(true);
  await hit.click();
  const heading = panel.getByRole('heading', { level: 2, name: /^Sid Side/ });
  await expect(heading).toHaveAccessibleName(/^Sid Side.* \(Owner\) \(Starting person\)$/);
  const tags = heading.locator('.name-tag');
  await expect(tags).toHaveCount(2);
  const [a, b] = [(await tags.nth(0).boundingBox())!, (await tags.nth(1).boundingBox())!];
  expect(Math.abs(a.y - b.y)).toBeLessThan(2); // one row
  // Someone else has neither.
  await card(page, 'Kim Side').click();
  const kim = panel.getByRole('heading', { level: 2, name: /^Kim Side/ });
  await expect(kim).toBeVisible();
  await expect(kim.locator('.name-tag')).toHaveCount(0);

  // The generations slider changes the URL.
  await depth.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/[?&]depth=2/);

  // How are we related? opens in a dialog with the selected person as To.
  await panel.getByRole('button', { name: 'How are we related?' }).click();
  const dialog = page.getByRole('dialog', { name: 'How are we related?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Kim Side is your child.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(panel.getByRole('button', { name: 'How are we related?' })).toBeFocused();

  // Focus | Full are links that set ?view=, and mark the current one.
  const view = page.getByRole('group', { name: 'View' });
  const full = view.getByRole('link', { name: 'Full' });
  const focus = view.getByRole('link', { name: 'Focus' });
  await expect(focus).toHaveAttribute('aria-current', 'true');
  await full.click();
  await expect(page).toHaveURL(/[?&]view=full/);
  await expect(full).toHaveAttribute('aria-current', 'true');
  await expect(focus).not.toHaveAttribute('aria-current');
  // In the full view there is no slider and, with no branch, nothing in its place.
  await expect(panel.getByLabel('Generations')).toHaveCount(0);
  await expect(panel.getByLabel('Show the branch of')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Show whole tree' })).toHaveCount(0);
  // "Show only this branch" (a link) draws Kim's branch; the × goes back to the whole tree.
  const branchRow = panel.getByRole('link', { name: 'Show only this branch' });
  await expect(branchRow).toHaveAttribute('href', /view=full&branch=/);
  await branchRow.click();
  await expect(page).toHaveURL(/[?&]branch=/);
  await expect(panel.getByText('Showing Kim Side’s branch')).toBeVisible();
  await expect(branchRow).toHaveCount(0);
  await panel.getByRole('button', { name: 'Show whole tree' }).click();
  await expect(page).not.toHaveURL(/branch=/);
  await expect(panel.getByText(/^Showing .* branch$/)).toHaveCount(0);
  await expect(branchRow).toBeFocused();
  await focus.click();
  await expect(page).not.toHaveURL(/view=full/);

  // A picker inside a dialog isn't clipped by it, and its matches overlay what is below them:
  // nothing moves.
  await panel.getByRole('button', { name: 'How are we related?' }).click();
  const rel = page.getByRole('dialog', { name: 'How are we related?' });
  await rel.getByRole('button', { name: 'Change To' }).click();
  const body = rel.locator('.section-dialog-body');
  const height = await body.evaluate((el) => el.scrollHeight);
  await rel.getByLabel('To', { exact: true }).fill('Si');
  const matches = rel.locator('.picker-matches');
  await expect(matches.getByRole('button', { name: /^Sid Side/ })).toBeVisible();
  expect(await matches.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
  expect(await body.evaluate((el) => el.scrollHeight)).toBe(height);
  const relHit = rel.locator('.picker-matches').getByRole('button', { name: /^Sid Side/ });
  await expect(relHit).toBeVisible();
  const hb = (await relHit.boundingBox())!;
  expect(
    await page.evaluate(
      ([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('.picker-matches'),
      [hb.x + hb.width / 2, hb.y + hb.height / 2],
    ),
  ).toBe(true);
  await rel.getByRole('button', { name: 'Close' }).click();
  await expect(rel).toBeHidden();

  // Tree settings is a row in the panel that opens a dialog (and has a deep link).
  await expect(page.getByLabel('Tree name')).toHaveCount(0);
  const settings = await openTreeSettings(page);
  await expect(page).toHaveURL(/[?&]tab=settings/);
  await expect(settings.getByLabel('Tree name', { exact: true })).toHaveValue(/.+/);
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(settings).toBeHidden();

  // The old relationship URL still works: it opens the dialog.
  await page.goto(`/trees/${treeId}/relationship`);
  await expect(page.getByRole('dialog', { name: 'How are we related?' })).toBeVisible();
});

test('on a phone search is above the canvas and the panel is a sheet behind a handle', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const me = await signUpViaUi(page, 'Pho Owner');
  const treeId = await startTreeViaUi(page, me, { given: 'Pho', surname: 'Ne' });
  await page.goto(`/trees/${treeId}`);
  await expect(card(page, 'Pho Ne')).toBeVisible();
  const panel = page.getByRole('complementary', { name: 'Details' });
  await expect(panel).toBeHidden();
  // Search works without opening the sheet.
  await page.getByRole('searchbox', { name: 'Search' }).fill('Pho');
  await expect(
    page.getByRole('list', { name: 'Search results' }).getByRole('button', { name: /Pho Ne/ }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Expand side panel' }).click();
  await expect(panel.getByLabel('Generations')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
