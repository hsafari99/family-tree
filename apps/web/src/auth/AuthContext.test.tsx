import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { FakeAuthApi } from '../test/fake-auth';
import { renderAt } from '../test/render';
import { MESSAGES, SESSION_EXPIRED } from './api';
import { AuthProvider, useAuth } from './AuthContext';
import { RequireAuth, safeNext } from './RequireAuth';

function Probe() {
  const { user, signOut } = useAuth();
  return (
    <div>
      <p>{user === 'loading' ? 'loading' : user ? `user:${user.name}` : 'signed out'}</p>
      <button type="button" onClick={() => void signOut()}>
        out
      </button>
    </div>
  );
}

function signedInApi() {
  const api = new FakeAuthApi();
  api.addUser({ email: 'ada@example.com', name: 'Ada' }, { signedIn: true });
  return api;
}

describe('AuthProvider', () => {
  it('loads the user on mount', async () => {
    render(
      <AuthProvider api={signedInApi()}>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByText('loading')).toBeInTheDocument();
    expect(await screen.findByText('user:Ada')).toBeInTheDocument();
  });

  it('is signed out when there is no session', async () => {
    render(
      <AuthProvider api={new FakeAuthApi()}>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText('signed out')).toBeInTheDocument();
  });

  it('signOut clears the user', async () => {
    const api = signedInApi();
    render(
      <AuthProvider api={api}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('user:Ada');
    fireEvent.click(screen.getByRole('button', { name: 'out' }));
    expect(await screen.findByText('signed out')).toBeInTheDocument();
    expect(api.current).toBeNull();
  });
});

function ShowLocation() {
  const location = useLocation();
  return <p>at:{`${location.pathname}${location.search}`}</p>;
}

describe('AuthProvider error handling', () => {
  it('keeps the signed-in user when a refresh fails for a transient reason', async () => {
    const api = signedInApi();
    function RefreshButton() {
      const { refresh, loadError } = useAuth();
      return (
        <>
          <button type="button" onClick={() => void refresh()}>
            refresh
          </button>
          {loadError && <p>error:{loadError.code}</p>}
        </>
      );
    }
    render(
      <AuthProvider api={api}>
        <Probe />
        <RefreshButton />
      </AuthProvider>,
    );
    await screen.findByText('user:Ada');
    api.failNext('getMe', { code: 'NETWORK', message: MESSAGES.network });
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));
    expect(await screen.findByText('error:NETWORK')).toBeInTheDocument();
    expect(screen.getByText('user:Ada')).toBeInTheDocument();
  });

  it('signs the user out when the server says there is no session', async () => {
    const api = signedInApi();
    function Refresh() {
      const { refresh } = useAuth();
      return (
        <button type="button" onClick={() => void refresh()}>
          refresh
        </button>
      );
    }
    render(
      <AuthProvider api={api}>
        <Probe />
        <Refresh />
      </AuthProvider>,
    );
    await screen.findByText('user:Ada');
    api.current = null;
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));
    expect(await screen.findByText('signed out')).toBeInTheDocument();
  });

  it('re-reads the session when a call reports it expired, and sends the user to sign in', async () => {
    const api = signedInApi();
    renderAt('/account', { auth: api });
    await screen.findByRole('heading', { name: 'Account' });
    // The session ended on the server.
    api.current = null;
    api.failNext('changePassword', { code: SESSION_EXPIRED, message: MESSAGES.sessionExpired });
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'Correct-horse1' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'Brand-new-password1' },
    });
    fireEvent.change(screen.getByLabelText('Repeat new password'), {
      target: { value: 'Brand-new-password1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('when the server cannot be reached, home goes to sign in, which says so', async () => {
    const api = new FakeAuthApi();
    api.failNext('getMe', { code: 'NETWORK', message: MESSAGES.network });
    renderAt('/', { auth: api });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText('Can’t reach the server right now')).toBeInTheDocument();
  });
});

describe('RequireAuth', () => {
  it('redirects to sign-in with the path to come back to', async () => {
    render(
      <AuthProvider api={new FakeAuthApi()}>
        <MemoryRouter initialEntries={['/account?tab=2fa']}>
          <Routes>
            <Route
              path="/account"
              element={
                <RequireAuth>
                  <p>secret</p>
                </RequireAuth>
              }
            />
            <Route path="/sign-in" element={<ShowLocation />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );
    expect(
      await screen.findByText(`at:/sign-in?next=${encodeURIComponent('/account?tab=2fa')}`),
    ).toBeInTheDocument();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });

  it('sends a signed-out visitor from home to plain sign-in (home is the default next)', async () => {
    render(
      <AuthProvider api={new FakeAuthApi()}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route
              path="/"
              element={
                <RequireAuth>
                  <p>secret</p>
                </RequireAuth>
              }
            />
            <Route path="/sign-in" element={<ShowLocation />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );
    expect(await screen.findByText('at:/sign-in')).toBeInTheDocument();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });

  it('renders the page for a signed-in user', async () => {
    renderAt('/account', { auth: signedInApi() });
    expect(await screen.findByRole('heading', { name: 'Account' })).toBeInTheDocument();
  });
});

describe('safeNext', () => {
  it('a tab-split protocol-relative URL never leaves the site', () => {
    // What `?next=/%09/evil.example` decodes to.
    expect(new URL(safeNext('/\t/evil.example'), window.location.origin).origin).toBe(
      window.location.origin,
    );
  });

  it.each([
    ['/account', '/account'],
    ['/a?b=c', '/a?b=c'],
    [null, '/'],
    ['', '/'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['javascript:alert(1)', '/'],
    ['/\t/evil.example', '/'],
    ['/\n/evil.example', '/'],
    ['/\r\n/evil.example', '/'],
    ['/\t\\evil.example', '/'],
    ['/\\evil.example', '/'],
    ['/%5Cevil.example', '/%5Cevil.example'],
    ['//evil.example/x', '/'],
    ['/account#two-factor', '/account#two-factor'],
  ])('%s → %s', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});

describe('routes', () => {
  it('shows a 404 page for unknown paths', async () => {
    renderAt('/nope');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('home sends a signed-out visitor to sign in, with no flash of the home page', async () => {
    renderAt('/');
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('Your trees')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/sign-up',
    );
  });

  it('home greets a signed-in user and signs out to sign in', async () => {
    renderAt('/', { auth: signedInApi() });
    expect(await screen.findByText('Signed in as Ada')).toBeInTheDocument();
    expect(await screen.findByText('All systems operational')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('sign-in with ?next= still goes back there once signed in', async () => {
    renderAt(`/sign-in?next=${encodeURIComponent('/account')}`, { auth: signedInApi() });
    expect(await screen.findByRole('heading', { name: 'Account' })).toBeInTheDocument();
  });
});
