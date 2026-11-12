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
  await page.getByRole('group', { name: 'View' }).getByRole('link', { name: 'Full' }).click();
  await expect(card(page, 'Margaret Hale')).toBeVisible();
  // Layout settles asynchronously, so poll the positions rather than read them once.
  await expect
    .poll(async () => {
      const [grandmother, david, sister, laura, me] = await Promise.all(
        ['Margaret Hale', 'David Hale', 'Susan Hale', 'Laura Hale', 'Leo Hale'].map((n) =>
          top(page, n),
        ),
      );
      return {
        generations: grandmother! < david! && david! < me!,
        siblingsShareARow: Math.abs(david! - sister!) < 5, // David and Susan, Robert's children
        partnersShareARow: Math.abs(david! - laura!) < 5, // David and Laura
      };
    })
    .toEqual({ generations: true, siblingsShareARow: true, partnersShareARow: true });
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
