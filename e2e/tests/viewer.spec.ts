import { expect, test } from '@playwright/test';
import { PROD_LOCAL, statePath, WEB } from '../support/env';
import { fixture, treeUrl } from '../support/fixture';
import { card, closeSection, openSection } from '../support/ui';

test.skip(PROD_LOCAL, 'dev stack only');
test.use({ storageState: statePath('viewer.json') });

test('a viewer can look and search, but not change or export (UI and API)', async ({ page }) => {
  await page.goto(treeUrl());
  await expect(page.getByRole('link', { name: 'Members and invites' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tree settings' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Export' })).toHaveCount(0);
  await page.getByRole('group', { name: 'View' }).getByRole('link', { name: 'Full' }).click();
  // The canvas is showing people, yet none of them offers an add button.
  await expect(card(page, 'Leo Hale')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Add a (parent|partner|sibling|child) of / }),
  ).toHaveCount(0);
  await card(page, 'Robert Hale').click();
  await expect(page.getByRole('heading', { name: /^Robert Hale/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit details' })).toHaveCount(0);
  await openSection(page, 'Photos');
  await expect(page.getByText(/Photos use .* of this tree/)).toBeVisible(); // the section is open
  await expect(page.getByText('Add a photo')).toHaveCount(0);
  await closeSection(page);
  await page.getByRole('searchbox', { name: 'Search' }).fill('Margret');
  await expect(
    page
      .getByRole('list', { name: 'Search results' })
      .getByRole('button', { name: /Margaret Hale/ }),
  ).toBeVisible();
  // Nothing relies on hidden buttons (spec §4): the API refuses too.
  const res = await page.request.get(`/api/v1/trees/${fixture().treeId}/export?check=1`, {
    headers: { origin: WEB },
  });
  expect(res.status()).toBe(403);
});
