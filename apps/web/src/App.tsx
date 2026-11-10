import { useState } from 'react';
import { BrowserRouter } from 'react-router';
import { API_BASE } from './api/client';
import { type AuthApi, createAuthApi } from './auth/api';
import { browserLayoutEngine } from './canvas/layout-engine';
import { LayoutEngineProvider } from './canvas/LayoutEngineContext';
import { AuthProvider } from './auth/AuthContext';
import { AppRoutes } from './routes';
import { createTreesApi, type TreesApi } from './trees/api';
import { TreesApiProvider } from './trees/TreesApiContext';

export function App({
  api: injected,
  trees: injectedTrees,
}: { api?: AuthApi; trees?: TreesApi } = {}) {
  // Built once per mount; in dev the API is same-origin through the Vite proxy.
  const [api] = useState(
    () => injected ?? createAuthApi({ baseUrl: API_BASE || window.location.origin }),
  );
  const [trees] = useState(
    () => injectedTrees ?? createTreesApi({ baseUrl: API_BASE || window.location.origin }),
  );
  return (
    <AuthProvider api={api}>
      <TreesApiProvider api={trees}>
        <BrowserRouter>
          <LayoutEngineProvider engine={browserLayoutEngine}>
            <AppRoutes />
          </LayoutEngineProvider>
        </BrowserRouter>
      </TreesApiProvider>
    </AuthProvider>
  );
}
