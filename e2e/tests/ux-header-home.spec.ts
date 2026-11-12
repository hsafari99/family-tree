import { expect, type Page, test } from '@playwright/test';
import { PROD_LOCAL, WEB } from '../support/env';
import { GPS_JPEG } from '../support/fixtures';
import { card, signUpViaUi, startTreeViaUi } from '../support/ui';

test.skip(PROD_LOCAL, 'dev stack only');

// UX round 1, batch 6: the global header and the home dashboard.
// Each test uses its own accounts and trees, never the shared sample tree.

const banner = (page: Page) => page.getByRole('banner');
const accountMenu = (page: Page) => banner(page).getByRole('button', { name: 'Account menu' });

async function noSidewaysScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
}

test('signed out: a minimal header and a skip link to the content', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(banner(page).getByRole('link', { name: 'Family Tree' })).toHaveAttribute(
    'href',
    '/',
  );
  await expect(banner(page).getByRole('navigation')).toHaveCount(0);
  await expect(accountMenu(page)).toHaveCount(0);

  // The skip link is hidden until Tab reaches it first; Enter moves focus to the content.
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  expect((await skip.boundingBox())!.y).toBeLessThan(0);
  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  expect((await skip.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
});

test('first visit: welcome, a getting-started guide, and a compact header on a phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signUpViaUi(page, 'Nia Newcomer');
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome, Nia' })).toBeVisible();
  const guide = page.getByRole('region', { name: 'Getting started' });
  await expect(guide.getByRole('listitem')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'Recent activity' })).toHaveCount(0);
  // On a phone the account menu is just the picture (initials here), on one row with My trees.
  // (The trigger is named "Account menu"; its picture is decoration inside it.)
  await expect(accountMenu(page).locator('.avatar')).toHaveText('NN');
  const nav = banner(page).getByRole('link', { name: 'My trees' });
  await expect(nav).toHaveAttribute('aria-current', 'page');
  const [a, b] = [(await nav.boundingBox())!, (await accountMenu(page).boundingBox())!];
  expect(Math.abs(a.y + a.height / 2 - (b.y + b.height / 2))).toBeLessThan(4);
  expect((await banner(page).boundingBox())!.height).toBeLessThan(64);
  await noSidewaysScroll(page);

  await guide.getByRole('link', { name: 'Start a new tree' }).click();
  await expect(page.getByRole('heading', { name: 'Start a new tree' })).toBeVisible();
  await noSidewaysScroll(page);
});

test('home: tree cards, recent activity, and the header inside a tree', async ({ page }) => {
  const me = await signUpViaUi(page, 'Hana Home');
  const treeId = await startTreeViaUi(page, me, { given: 'Hana', surname: 'Home' });
  await expect(card(page, 'Hana Home')).toBeVisible();

  // Inside a tree the header names it; on the tree page that link is the current page.
  const treeName = 'Home family';
  const name = banner(page).getByRole('link', { name: treeName });
  await expect(name).toHaveAttribute('href', `/trees/${treeId}`);
  await expect(name).toHaveAttribute('aria-current', 'page');
  // The page title is for screen readers only: the header shows it.
  await expect(page.getByRole('heading', { level: 1, name: treeName })).toHaveClass(/sr-only/);
  // The canvas still fits the window under the header.
  const area = (await page.locator('.canvas-area').boundingBox())!;
  expect(area.y + area.height).toBeLessThanOrEqual(page.viewportSize()!.height);

  // Members: a back arrow to the tree, and the header still names it.
  await page.getByRole('link', { name: 'Members and invites' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Members and invites' })).toBeVisible();
  await expect(banner(page).getByRole('link', { name: treeName })).not.toHaveAttribute(
    'aria-current',
  );
  await page.getByRole('link', { name: `Back to ${treeName}` }).click();
  await expect(page).toHaveURL(new RegExp(`/trees/${treeId}$`));

  // A change, then home: the card and the activity show it.
  const base = `/api/v1/trees/${treeId}`;
  const added = await page.request.post(`${base}/persons`, {
    data: { person: { givenName: 'Ivo', surname: 'Home' } },
    headers: { origin: WEB },
  });
  expect(added.ok()).toBe(true);
  await banner(page).getByRole('link', { name: 'My trees' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome, Hana' })).toBeVisible();
  await expect(banner(page).getByRole('link', { name: treeName })).toHaveCount(0);
  const tree = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: treeName }) });
  await expect(tree).toContainText('Owner');
  await expect(tree).toContainText('2 people');
  await expect(tree).toContainText(/Updated (just now|1 minute ago)/);
  const activity = page.getByRole('region', { name: 'Recent activity' });
  await expect(activity.getByRole('listitem').first()).toContainText('Added: Ivo Home');
  await expect(activity.getByRole('listitem').first()).toContainText('by Hana Home');

  // The activity links to the person; Open opens the tree.
  await activity.getByRole('link', { name: 'Ivo Home' }).click();
  await expect(page.getByRole('heading', { name: /^Ivo Home/ })).toBeVisible();
  await banner(page).getByRole('link', { name: 'Family Tree' }).click();
  await page.getByRole('link', { name: `Open ${treeName}` }).click();
  await expect(page).toHaveURL(new RegExp(`/trees/${treeId}$`));
  await page.setViewportSize({ width: 390, height: 844 });
  await noSidewaysScroll(page);
});

test('account menu: the picture follows an upload, Account opens, Sign out signs out', async ({
  page,
}) => {
  const me = await signUpViaUi(page, 'Aya Menu');
  await expect(accountMenu(page).locator('img')).toHaveCount(0);
  await accountMenu(page).click();
  const menu = page.getByRole('menu', { name: 'Account menu' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Account', 'Sign out']);
  await expect(menu.getByRole('menuitem', { name: 'Account' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/account$/);

  const profile = page.getByRole('region', { name: 'Profile' });
  await profile.getByLabel('Upload a picture').setInputFiles(GPS_JPEG);
  await expect(profile.getByText('Profile picture added.')).toBeVisible();
  const src = await profile.locator('img.avatar').getAttribute('src');
  await expect(accountMenu(page).locator('img.avatar')).toHaveAttribute('src', src!);
  await expect(accountMenu(page).locator('img.avatar')).toHaveAttribute('alt', me.name);

  await accountMenu(page).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  // Straight to sign in, with no "next" back to this user's page.
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(accountMenu(page)).toHaveCount(0);
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
});
