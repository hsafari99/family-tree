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
import { ToastProvider } from '../components/Toast';
import type { SupportConfig } from '../support/config';
import { SupportProvider } from '../support/SupportContext';

const NO_SUPPORT: SupportConfig = {
  etransferEmail: null,
  paypalUrl: null,
  kofiUrl: null,
  bmacUrl: null,
};

/** Renders the whole route table at `path` with fake auth and trees APIs. */
export function renderAt(
  path: string,
  {
    auth = new FakeAuthApi(),
    trees = new FakeTreesApi(),
    layout = new FakeLayoutEngine(),
    entries,
    toasts = false,
    support = NO_SUPPORT,
  }: {
    auth?: FakeAuthApi;
    trees?: FakeTreesApi;
    layout?: FakeLayoutEngine;
    entries?: string[];
    /** Shows toasts, as the app does (off by default, so their text doesn't double a page's). */
    toasts?: boolean;
    /** The build's support options (none by default, as in a build without them). */
    support?: SupportConfig;
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
  // Answer any stray fetch, so tests never hit the network.
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ status: 'ok', checks: { db: 'ok', storage: 'ok' } })),
    ),
  );
  const utils = render(
    <SupportProvider value={support}>
      <AuthProvider api={auth}>
        <TreesApiProvider api={trees}>
          <MemoryRouter initialEntries={entries ?? [path]}>
            <NavProbe />
            <LayoutEngineProvider engine={layout}>
              {toasts ? (
                <ToastProvider>
                  <AppRoutes />
                </ToastProvider>
              ) : (
                <AppRoutes />
              )}
            </LayoutEngineProvider>
          </MemoryRouter>
        </TreesApiProvider>
      </AuthProvider>
    </SupportProvider>,
  );
  return {
    ...utils,
    api: auth,
    trees,
    layout,
    navigate: (to: number | string) =>
      typeof to === 'number' ? nav.current?.(to) : nav.current?.(to),
    /** The router's current path and query. */
    where: () => nav.where,
  };
}
