import { Navigate, Route, Routes, useLocation, useParams } from 'react-router';
import { RequireAuth } from './auth/RequireAuth';
import { AppHeader, HeaderTreeProvider } from './components/AppHeader';
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
import { TrashPage } from './pages/TrashPage';
import { TreePage } from './pages/TreePage';
import { VerifyTwoFactorPage } from './pages/VerifyTwoFactorPage';

/**
 * The global header and the route table. App wraps it in a BrowserRouter; tests use a
 * MemoryRouter.
 */
export function AppRoutes() {
  return (
    <HeaderTreeProvider>
      <AppHeader />
      <Routes>
        <Route
          path="/"
          element={
            <RequireAuth>
              <HomePage />
            </RequireAuth>
          }
        />
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
          path="/account/:section"
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
          path="/trees/:treeId/trash"
          element={
            <RequireAuth>
              <TrashPage />
            </RequireAuth>
          }
        />
        <Route
          path="/trees/:treeId/people/new"
          element={
            <RequireAuth>
              <TreePage />
            </RequireAuth>
          }
        />
        <Route
          path="/trees/:treeId/people/:personId"
          element={
            <RequireAuth>
              <TreePage />
            </RequireAuth>
          }
        />
        <Route
          path="/trees/:treeId/unions/:unionId"
          element={
            <RequireAuth>
              <TreePage />
            </RequireAuth>
          }
        />
        <Route path="/trees/:treeId/relationship" element={<RelationshipRedirect />} />
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
    </HeaderTreeProvider>
  );
}

/** The old "How are we related?" page: now a dialog over the tree, keeping From and To. */
function RelationshipRedirect() {
  const { treeId = '' } = useParams();
  const next = new URLSearchParams(useLocation().search);
  next.set('tab', 'related');
  return <Navigate replace to={`/trees/${treeId}?${next}`} />;
}
