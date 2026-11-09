import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { AppRoutes } from '../routes';
import { FakeAuthApi } from './fake-auth';

/** Renders the whole route table at `path` with a fake AuthApi. */
export function renderAt(path: string, api = new FakeAuthApi()) {
  // The home page's HealthStatus calls fetch; answer it so tests never hit the network.
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ status: 'ok', checks: { db: 'ok', storage: 'ok' } })),
    ),
  );
  const utils = render(
    <AuthProvider api={api}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AuthProvider>,
  );
  return { ...utils, api };
}
