import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { FakeAuthApi } from '../test/fake-auth';
import { renderAt } from '../test/render';
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

  it('renders the page for a signed-in user', async () => {
    renderAt('/account', signedInApi());
    expect(await screen.findByRole('heading', { name: 'Account' })).toBeInTheDocument();
  });
});

describe('safeNext', () => {
  it.each([
    ['/account', '/account'],
    ['/a?b=c', '/a?b=c'],
    [null, '/'],
    ['', '/'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['javascript:alert(1)', '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});

describe('routes', () => {
  it('shows a 404 page for unknown paths', async () => {
    renderAt('/nope');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('home shows sign-in and sign-up links when signed out', async () => {
    renderAt('/');
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/sign-in',
    );
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/sign-up',
    );
    expect(await screen.findByText('All systems operational')).toBeInTheDocument();
  });

  it('home greets a signed-in user and signs out', async () => {
    renderAt('/', signedInApi());
    expect(await screen.findByText('Signed in as Ada')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });
});
