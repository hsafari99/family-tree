import { render } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import type { NavigateFunction } from 'react-router';
import { vi } from 'vitest';
import { LayoutEngineProvider } from '../canvas/LayoutEngineContext';
import { AuthProvider } from '../auth/AuthContext';
import { AppRoutes } from '../routes';
import { TreesApiProvider } from '../trees/TreesApiContext';
import { FakeAuthApi } from './fake-auth';
import { FakeLayoutEngine } from './fake-layout';
import { FakeTreesApi } from './fake-trees';

/** Renders the whole route table at `path` with fake auth and trees APIs. */
export function renderAt(
  path: string,
  {
    auth = new FakeAuthApi(),
    trees = new FakeTreesApi(),
    layout = new FakeLayoutEngine(),
    entries,
  }: {
    auth?: FakeAuthApi;
    trees?: FakeTreesApi;
    layout?: FakeLayoutEngine;
    entries?: string[];
  } = {},
) {
  const nav: { current: NavigateFunction | null; where: string } = { current: null, where: '' };
  /** Gives tests the router's navigate (e.g. to go back in history) and the current URL. */
  function NavProbe() {
    nav.current = useNavigate();
    const l = useLocation();
    nav.where = l.pathname + l.search;
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
          <LayoutEngineProvider engine={layout}>
            <AppRoutes />
          </LayoutEngineProvider>
        </MemoryRouter>
      </TreesApiProvider>
    </AuthProvider>,
  );
  return {
    ...utils,
    api: auth,
    trees,
    layout,
    navigate: (to: number) => nav.current?.(to),
    /** The router's current path and query. */
    where: () => nav.where,
  };
}
