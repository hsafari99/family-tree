import { Route, Routes } from 'react-router';
import { RequireAuth } from './auth/RequireAuth';
import { AccountPage } from './pages/AccountPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { HomePage } from './pages/HomePage';
import { InvitePage } from './pages/InvitePage';
import { MembersPage } from './pages/MembersPage';
import { NewTreePage } from './pages/NewTreePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ResetLinkPage } from './pages/ResetLinkPage';
import { SignInPage } from './pages/SignInPage';
import { SignUpPage } from './pages/SignUpPage';
import { TreePage } from './pages/TreePage';
import { VerifyTwoFactorPage } from './pages/VerifyTwoFactorPage';

/** The route table. App wraps it in a BrowserRouter; tests use a MemoryRouter. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/sign-in/verify" element={<VerifyTwoFactorPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset/:token" element={<ResetLinkPage />} />
      <Route
        path="/account"
        element={
          <RequireAuth>
            <AccountPage />
          </RequireAuth>
        }
      />
      <Route
        path="/trees/new"
        element={
          <RequireAuth>
            <NewTreePage />
          </RequireAuth>
        }
      />
      <Route
        path="/trees/:treeId/members"
        element={
          <RequireAuth>
            <MembersPage />
          </RequireAuth>
        }
      />
      <Route
        path="/trees/:treeId"
        element={
          <RequireAuth>
            <TreePage />
          </RequireAuth>
        }
      />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
