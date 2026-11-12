import { expect, test } from '@playwright/test';
import { PROD_LOCAL, statePath } from '../support/env';
import { treeUrl } from '../support/fixture';

test.skip(PROD_LOCAL, 'dev stack only');
test.use({ storageState: statePath('owner.json') });

// The Fan chart and the Illustrated tree (Batch 5), on the shared sample family around Leo Hale.

test('the fan chart shows the parents, opens a grandparent, and adds a parent', async ({
  page,
}) => {
  await page.goto(`${treeUrl()}?view=fan`);
  const fan = page.getByRole('group', { name: 'Fan chart of Leo Hale’s ancestors' });
  await expect(fan).toBeVisible();
  await expect(page.getByRole('link', { name: 'Fan' })).toHaveAttribute('aria-current', 'true');
  await expect(fan.getByRole('button', { name: /^David Hale, .*Father$/ })).toBeVisible();
  await expect(fan.getByRole('button', { name: /^Laura Hale, .*Mother$/ })).toBeVisible();
  await fan.getByRole('button', { name: /^Margaret Hale, .*Grandmother, father’s side$/ }).click();
  await expect(page).toHaveURL(/\/people\/[^/?]+\?view=fan/);
  const panel = page.getByRole('complementary', { name: 'Details' });
  await expect(panel.getByRole('heading', { level: 2, name: /Margaret Hale/ })).toBeVisible();
  // Opening someone keeps the fan on Leo.
  await expect(fan).toBeVisible();
  await fan.getByRole('button', { name: 'Add a parent of Margaret Hale' }).first().click();
  await expect(page.getByRole('form', { name: 'Add parent' })).toBeVisible();
});
