import { render } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import type { NavigateFunction } from 'react-router';
import { vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { AppRoutes } from '../routes';
import { TreesApiProvider } from '../trees/TreesApiContext';
import { FakeAuthApi } from './fake-auth';
import { FakeTreesApi } from './fake-trees';

/** Renders the whole route table at `path` with fake auth and trees APIs. */
export function renderAt(
  path: string,
  {
    auth = new FakeAuthApi(),
    trees = new FakeTreesApi(),
    entries,
  }: { auth?: FakeAuthApi; trees?: FakeTreesApi; entries?: string[] } = {},
) {
  const nav: { current: NavigateFunction | null } = { current: null };
  /** Gives tests the router's navigate, e.g. to go back in history. */
  function NavProbe() {
    nav.current = useNavigate();
    return null;
  }
  // The home page's HealthStatus calls fetch; answer it so tests never hit the network.
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ status: 'ok', checks: { db: 'ok', storage: 'ok' } })),
    ),
  );
  const utils = render(
    <AuthProvider api={auth}>
      <TreesApiProvider api={trees}>
        <MemoryRouter initialEntries={entries ?? [path]}>
          <NavProbe />
          <AppRoutes />
        </MemoryRouter>
      </TreesApiProvider>
    </AuthProvider>,
  );
  return { ...utils, api: auth, trees, navigate: (to: number) => nav.current?.(to) };
}
