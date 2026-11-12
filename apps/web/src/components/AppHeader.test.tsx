import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../auth/api';
import { FakeAuthApi } from '../test/fake-auth';
import { FakeTreesApi } from '../test/fake-trees';
import { renderAt } from '../test/render';

function signedIn(extra: { avatarUrl?: string | null } = {}) {
  const auth = new FakeAuthApi();
  const user = auth.addUser(
    { email: 'ada@example.com', name: 'Ada Lovelace', twoFactorEnabled: true, ...extra },
    { signedIn: true },
  );
  return { auth, user, trees: new FakeTreesApi() };
}

const banner = () => screen.getByRole('banner');
const accountMenu = () => within(banner()).getByRole('button', { name: 'Account menu' });

describe('AppHeader', () => {
  it('signed out, is minimal: the app name and a skip link, no nav or account menu', async () => {
    renderAt('/sign-in');
    await screen.findByRole('heading', { name: 'Sign in' });
    const header = banner();
    expect(within(header).getByRole('link', { name: 'Family Tree' })).toHaveAttribute('href', '/');
    expect(within(header).queryByRole('navigation')).toBeNull();
    expect(within(header).queryByRole('button', { name: 'Account menu' })).toBeNull();
    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(skip).toHaveAttribute('href', '#main');
    // The skip link is the first thing Tab reaches, and its target can take focus.
    expect(document.body.querySelector('a')).toBe(skip);
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main');
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('skip link moves focus to the main content', async () => {
    renderAt('/sign-in');
    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.click(screen.getByRole('link', { name: 'Skip to main content' }));
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('signed in, shows My trees (current on home) and the account menu with the initials', async () => {
    const { auth, trees } = signedIn();
    renderAt('/', { auth, trees });
    await screen.findByRole('heading', { name: /Welcome, Ada/ });
    const nav = within(banner()).getByRole('navigation', { name: 'Main' });
    const myTrees = within(nav).getByRole('link', { name: 'My trees' });
    expect(myTrees).toHaveAttribute('href', '/');
    expect(myTrees).toHaveAttribute('aria-current', 'page');
    expect(within(accountMenu()).getByRole('img', { hidden: true })).toHaveTextContent('AL');
  });

  it("shows the user's picture when they have one", async () => {
    const { auth, trees } = signedIn({ avatarUrl: 'https://s3.test/a.webp' });
    renderAt('/', { auth, trees });
    await screen.findByRole('heading', { name: /Welcome, Ada/ });
    const img = accountMenu().querySelector('img');
    expect(img).toHaveAttribute('src', 'https://s3.test/a.webp');
  });

  it('opens Account from the menu', async () => {
    const { auth, trees } = signedIn();
    const r = renderAt('/', { auth, trees });
    await screen.findByRole('heading', { name: /Welcome, Ada/ });
    fireEvent.click(accountMenu());
    const menu = screen.getByRole('menu', { name: 'Account menu' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((m) => m.textContent),
    ).toEqual(['Account', 'Sign out']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Account' }));
    expect(await screen.findByRole('navigation', { name: 'Account settings' })).toBeVisible();
    expect(r.where()).toBe('/account');
    // My trees is no longer the current page.
    expect(within(banner()).getByRole('link', { name: 'My trees' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('signs out from the menu and lands on sign in with the minimal header', async () => {
    const { auth, trees } = signedIn();
    const r = renderAt('/account', { auth, trees });
    await screen.findByRole('navigation', { name: 'Account settings' });
    fireEvent.click(accountMenu());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(r.where()).toBe('/sign-in');
    expect(within(banner()).queryByRole('button', { name: 'Account menu' })).toBeNull();
    expect(auth.callsTo('signOut')).toHaveLength(1);
  });

  it('shows a sign-out failure', async () => {
    const { auth, trees } = signedIn();
    auth.failNext('signOut', { code: 'NETWORK', message: MESSAGES.network });
    renderAt('/', { auth, trees });
    await screen.findByRole('heading', { name: /Welcome, Ada/ });
    fireEvent.click(accountMenu());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(await within(banner()).findByRole('alert')).toHaveTextContent(MESSAGES.network);
    expect(accountMenu()).toBeInTheDocument();
  });

  it('inside a tree, shows the tree name linking to it, and drops it on leaving', async () => {
    const { auth, trees } = signedIn();
    const id = trees.addTree({ name: 'Hale family' });
    renderAt(`/trees/${id}/members`, { auth, trees });
    const link = await within(banner()).findByRole('link', { name: 'Hale family' });
    expect(link).toHaveAttribute('href', `/trees/${id}`);
    expect(link).not.toHaveAttribute('aria-current');
    fireEvent.click(link);
    await waitFor(() =>
      expect(within(banner()).getByRole('link', { name: 'Hale family' })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    );
    fireEvent.click(within(banner()).getByRole('link', { name: 'My trees' }));
    await screen.findByRole('heading', { name: /Welcome, Ada/ });
    expect(within(banner()).queryByRole('link', { name: 'Hale family' })).toBeNull();
  });

  it('follows a rename in Tree settings', async () => {
    const { auth, trees } = signedIn();
    const id = trees.addTree({ name: 'Hale family' });
    renderAt(`/trees/${id}`, { auth, trees });
    await within(banner()).findByRole('link', { name: 'Hale family' });
    fireEvent.change(screen.getByLabelText('Tree name'), { target: { value: 'Hale clan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await within(banner()).findByRole('link', { name: 'Hale clan' })).toBeInTheDocument();
  });

  it('updates the picture when it changes on the Account page', async () => {
    const { auth, trees, user } = signedIn();
    renderAt('/account/profile', { auth, trees });
    const profile = await screen.findByRole('region', { name: 'Profile' });
    expect(accountMenu().querySelector('img')).toBeNull();
    fireEvent.change(within(profile).getByLabelText('Upload a picture'), {
      target: { files: [new File([new Uint8Array(100)], 'me.png', { type: 'image/png' })] },
    });
    await within(profile).findByText('Profile picture added.');
    expect(accountMenu().querySelector('img')).toHaveAttribute('src', user.avatarUrl!);
  });
});
