import { expect, type Page, test } from '@playwright/test';
import { PROD_LOCAL, statePath } from '../support/env';
import { treeUrl } from '../support/fixture';
import { card } from '../support/ui';

test.skip(PROD_LOCAL, 'dev stack only');
test.use({ storageState: statePath('owner.json') });

const top = async (page: Page, name: string) => (await card(page, name).boundingBox())!.y;

test('the layout runs in a worker and puts generations in rows', async ({ page }) => {
  const worker = page.waitForEvent('worker');
  await page.goto(treeUrl());
  expect((await worker).url()).toMatch(/worker|elk/i);
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Full' }).click();
  await expect(card(page, 'Margaret Hale')).toBeVisible();
  const [grandmother, father, mother, me] = await Promise.all(
    ['Margaret Hale', 'David Hale', 'Susan Hale', 'Leo Hale'].map((n) => top(page, n)),
  );
  expect(grandmother).toBeLessThan(father!);
  expect(father).toBeLessThan(me!);
  expect(Math.abs(father! - mother!)).toBeLessThan(5); // siblings share a row
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the person panel is a bottom sheet and nothing scrolls sideways', async ({ page }) => {
    await page.goto(treeUrl());
    await card(page, 'Leo Hale').click();
    const heading = page.getByRole('heading', { name: /^Leo Hale/ });
    await expect(heading).toBeVisible();
    expect((await heading.boundingBox())!.y).toBeGreaterThan(844 / 3);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
