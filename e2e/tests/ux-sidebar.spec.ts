import { expect, test } from '@playwright/test';
import { PROD_LOCAL, WEB } from '../support/env';
import { card, openTreeSettings, signUpViaUi, startTreeViaUi } from '../support/ui';

test.skip(PROD_LOCAL, 'dev stack only');

// The side panel holds the tree tools (search, generations, the person, tree rows); the view
// switch above the canvas is a pair of links. Its own account and tree.

test('the side panel: search on top, generations below, tags, dialogs and view links', async ({
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

  // With nothing selected the panel still shows: search first, then Generations, then a hint.
  const panel = page.getByRole('complementary', { name: 'Details' });
  const search = panel.getByRole('searchbox', { name: 'Search' });
  const depth = panel.getByLabel('Generations');
  await expect(search).toBeVisible();
  await expect(panel.getByText('Select someone on the tree.')).toBeVisible();
  expect((await search.boundingBox())!.y).toBeLessThan((await depth.boundingBox())!.y);
  await expect(page.getByText('You are the owner of this tree.')).toHaveCount(0);
  await expect(page.getByText(/^Starting person:/)).toHaveCount(0);
  // No sideways scroll, and the canvas ends inside the window.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
  const area = (await page.locator('.canvas-area').boundingBox())!;
  expect(area.y + area.height).toBeLessThanOrEqual(720);

  // Search opens the person; their heading carries the role and starting-person tags.
  await search.fill('Sid');
  await page
    .getByRole('list', { name: 'Search results' })
    .getByRole('button', { name: /Sid Side/ })
    .click();
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
  // In the full view the branch picker takes the slider's place.
  await expect(panel.getByLabel('Generations')).toHaveCount(0);
  await expect(panel.getByLabel('Show the branch of')).toBeVisible();
  await focus.click();
  await expect(page).not.toHaveURL(/view=full/);

  // Tree settings is a row in the panel that opens a dialog (and has a deep link).
  await expect(page.getByLabel('Tree name')).toHaveCount(0);
  const settings = await openTreeSettings(page);
  await expect(page).toHaveURL(/[?&]tab=settings/);
  await expect(settings.getByLabel('Tree name')).toHaveValue(/.+/);
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(settings).toBeHidden();

  // The old relationship URL still works: it opens the dialog.
  await page.goto(`/trees/${treeId}/relationship`);
  await expect(page.getByRole('dialog', { name: 'How are we related?' })).toBeVisible();
});

test('on a phone the panel is a sheet behind a handle, with search and generations inside', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const me = await signUpViaUi(page, 'Pho Owner');
  const treeId = await startTreeViaUi(page, me, { given: 'Pho', surname: 'Ne' });
  await page.goto(`/trees/${treeId}`);
  await expect(card(page, 'Pho Ne')).toBeVisible();
  const panel = page.getByRole('complementary', { name: 'Details' });
  await expect(panel).toBeHidden();
  await page.getByRole('button', { name: 'Show details' }).click();
  await expect(panel.getByRole('searchbox', { name: 'Search' })).toBeVisible();
  await expect(panel.getByLabel('Generations')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
