import { useState } from 'react';
import { BrowserRouter } from 'react-router';
import { API_BASE } from './api/client';
import { type AuthApi, createAuthApi } from './auth/api';
import { AuthProvider } from './auth/AuthContext';
import { AppRoutes } from './routes';

export function App({ api: injected }: { api?: AuthApi } = {}) {
  // Built once per mount; in dev the API is same-origin through the Vite proxy.
  const [api] = useState(
    () => injected ?? createAuthApi({ baseUrl: API_BASE || window.location.origin }),
  );
  return (
    <AuthProvider api={api}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
