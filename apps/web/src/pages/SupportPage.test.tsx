import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupportConfig } from '../support/config';
import { FakeAuthApi } from '../test/fake-auth';
import { FakeTreesApi } from '../test/fake-trees';
import { renderAt } from '../test/render';

const ALL: SupportConfig = {
  etransferEmail: 'give@example.com',
  paypalUrl: 'https://paypal.me/someone',
  kofiUrl: 'https://ko-fi.com/someone',
};
const ETRANSFER_ONLY: SupportConfig = {
  etransferEmail: 'give@example.com',
  paypalUrl: null,
  kofiUrl: null,
};

function signedIn() {
  const auth = new FakeAuthApi();
  auth.addUser(
    { email: 'ada@example.com', name: 'Ada Lovelace', twoFactorEnabled: true },
    { signedIn: true },
  );
  const trees = new FakeTreesApi();
  trees.addTree({ name: 'Hale family' });
  return { auth, trees };
}

/** Sets the phone breakpoint's answer for matchMedia. */
function phone(narrow: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((q: string) => ({
      matches: q === '(max-width: 720px)' ? narrow : false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

const banner = () => screen.getByRole('banner');

afterEach(() => vi.unstubAllGlobals());

describe('Support', () => {
  it('without any option: no header link, no home line, and /support goes home', async () => {
    const s = signedIn();
    const r = renderAt('/support', s);
    await screen.findByRole('heading', { name: /Welcome, Ada/ });
    expect(r.where()).toBe('/');
    expect(within(banner()).queryByRole('link', { name: /Support/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'support it' })).toBeNull();
  });

  it('desktop: a Support link beside My trees and a line at the end of home', async () => {
    phone(false);
    const s = signedIn();
    renderAt('/', { ...s, support: ALL });
    await screen.findByRole('heading', { name: /Welcome, Ada/ });
    const nav = within(banner()).getByRole('navigation', { name: 'Main' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent?.trim()),
    ).toEqual(['Support', 'My trees']);
    expect(within(nav).getByRole('link', { name: 'Support' })).toHaveAttribute('href', '/support');
    expect(await screen.findByRole('link', { name: 'support it' })).toHaveAttribute(
      'href',
      '/support',
    );
    // Not in the account menu as well.
    fireEvent.click(within(banner()).getByRole('button', { name: 'Account menu' }));
    expect(screen.queryByRole('menuitem', { name: 'Support Family Tree' })).toBeNull();
  });

  it('phone: in the account menu instead of the header bar', async () => {
    phone(true);
    const s = signedIn();
    const r = renderAt('/', { ...s, support: ALL });
    await screen.findByRole('heading', { name: /Welcome, Ada/ });
    expect(within(banner()).queryByRole('link', { name: 'Support' })).toBeNull();
    fireEvent.click(within(banner()).getByRole('button', { name: 'Account menu' }));
    expect(
      within(screen.getByRole('menu'))
        .getAllByRole('menuitem')
        .map((m) => m.textContent),
    ).toEqual(['Account', 'Support Family Tree', 'Sign out']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Support Family Tree' }));
    expect(await screen.findByRole('heading', { name: 'Support Family Tree' })).toBeVisible();
    expect(r.where()).toBe('/support');
  });

  it('shows e-Transfer steps with a copyable email, and opens PayPal and Ko-fi in a new tab', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const s = signedIn();
    renderAt('/support', { ...s, support: ALL });
    const et = await screen.findByRole('region', { name: 'Interac e-Transfer (Canada)' });
    expect(within(et).getAllByRole('listitem')).toHaveLength(3);
    expect(within(et).getByLabelText('e-Transfer email')).toHaveValue('give@example.com');
    fireEvent.click(within(et).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('give@example.com'));
    const online = screen.getByRole('region', { name: 'Online, by card or PayPal' });
    for (const [name, href] of [
      ['Donate with PayPal', ALL.paypalUrl],
      ['Donate on Ko-fi', ALL.kofiUrl],
    ] as const) {
      const a = within(online).getByRole('link', { name });
      expect(a).toHaveAttribute('href', href);
      expect(a).toHaveAttribute('target', '_blank');
      expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('shows only the options that are set', async () => {
    const s = signedIn();
    renderAt('/support', { ...s, support: ETRANSFER_ONLY });
    await screen.findByRole('region', { name: 'Interac e-Transfer (Canada)' });
    expect(screen.queryByRole('region', { name: 'Online, by card or PayPal' })).toBeNull();
  });

  it('is for signed-in users: a visitor is sent to sign in', async () => {
    renderAt('/support', { support: ALL });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
