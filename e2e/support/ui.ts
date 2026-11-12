import { expect, type Page } from '@playwright/test';
import { type Account, newAccount } from './api';
import { rawSecret, totpCode } from './totp';

/** Signs up through the form (a fresh context, so no browser autofill is involved). */
export async function signUpViaUi(page: Page, name: string, path = '/sign-up'): Promise<Account> {
  const a = newAccount(name);
  await page.goto(path);
  await page.getByLabel('Name', { exact: true }).fill(a.name);
  await page.getByLabel('Email', { exact: true }).fill(a.email);
  await page.getByLabel('Password', { exact: true }).fill(a.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).not.toHaveURL(/\/sign-up/);
  return a;
}

/** Turns on two-step verification where the setup is shown (Start a new tree, or Account). */
export async function enrolTotpViaUi(page: Page, a: Account): Promise<string> {
  await page.getByRole('button', { name: 'Turn on two-step verification' }).click();
  await page.getByLabel('Your password', { exact: true }).fill(a.password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('code.secret')).toBeVisible();
  const secret = (await page.locator('code.secret').textContent())!.replace(/\s+/g, '');
  const raw = rawSecret(secret);
  await page.getByLabel('6-digit code from the app').fill(await totpCode(raw));
  await page.getByRole('button', { name: 'Turn on', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Recovery codes' })).toBeVisible();
  await page.getByRole('button', { name: "I've saved these codes" }).click();
  return raw;
}

/** Starts a tree (2FA first, spec §5) and returns its id once the tree page is open. */
export async function startTreeViaUi(
  page: Page,
  a: Account,
  me: { given: string; surname: string },
) {
  await page.goto('/trees/new');
  await enrolTotpViaUi(page, a);
  await page.getByLabel('Your first name').fill(me.given);
  await page.getByLabel('Your last name').fill(me.surname);
  await page.getByRole('button', { name: 'Start tree' }).click();
  await expect(page).toHaveURL(/\/trees\/[0-9a-f-]{36}/);
  return page.url().match(/\/trees\/([0-9a-f-]{36})/)![1]!;
}

/** A person's card on the canvas: its button's accessible name starts with the full name. */
export const card = (page: Page, fullName: string) =>
  page.getByRole('button', { name: new RegExp(`^${fullName}\\b`) }).first();

/**
 * A relative through a card's "+" button and the quick-add form. `union` picks the "Other parent"
 * or "Which parents" option when the form asks.
 */
export async function addRelative(
  page: Page,
  of: string,
  word: 'parent' | 'partner' | 'sibling' | 'child',
  person: { given: string; surname: string },
  union?: RegExp,
) {
  // The "+" buttons only take clicks while the card is hovered or focused.
  await card(page, of).hover();
  await page.getByRole('button', { name: `Add a ${word} of ${of}` }).click();
  const form = page.getByRole('form', { name: `Add ${word}` });
  await form.getByLabel('First name').fill(person.given);
  await form.getByLabel('Last name').fill(person.surname);
  if (union) {
    const choice = form.getByLabel(/^(Other parent|Which parents)$/);
    const option = (await choice.locator('option').allTextContents()).find((t) => union.test(t));
    if (!option) throw new Error(`no union option matching ${union}`);
    await choice.selectOption({ label: option });
  }
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(card(page, `${person.given} ${person.surname}`)).toBeVisible();
}

export type Section = 'Details' | 'Places' | 'Photos' | 'Relations' | 'History';

/** Opens one of the person panel's sections; it shows in a modal dialog (brief #15). */
export async function openSection(page: Page, section: Section) {
  await page
    .getByRole('complementary', { name: 'Details' })
    .getByRole('button', { name: new RegExp(`^${section}`) })
    .click();
  const dialog = page.getByRole('dialog', { name: new RegExp(`^${section} — `) });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Opens Tree settings (owner only) from the side panel's tree rows; it shows in a dialog. */
export async function openTreeSettings(page: Page) {
  await page
    .getByRole('complementary', { name: 'Details' })
    .getByRole('button', { name: 'Tree settings' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Tree settings' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Closes the open section dialog with its X. */
export async function closeSection(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/**
 * Deletes every photo of `fullName` (the shared sample tree must end as it began). Idempotent, so
 * it is safe before a test, in `afterEach` and on a retry.
 */
export async function clearPhotos(page: Page, fullName: string, treeUrl: string) {
  await page.goto(treeUrl);
  await page.getByRole('group', { name: 'View' }).getByRole('link', { name: 'Full' }).click();
  await card(page, fullName).click();
  await openSection(page, 'Photos');
  await expect(page.getByText(/Photos use .* of this tree/)).toBeVisible();
  // Scoped to the photo list: Tree settings has its own "Delete" button.
  const del = page
    .getByRole('list', { name: /^Photos of / })
    .getByRole('button', { name: 'Delete', exact: true });
  for (let left = await del.count(); left > 0; left--) {
    await del.first().click();
    await page.getByRole('button', { name: 'Delete photo' }).click();
    // The toast can show before the list refreshes; wait for the list itself.
    await expect(del).toHaveCount(left - 1);
  }
  await closeSection(page);
}
