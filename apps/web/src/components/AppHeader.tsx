import {
  createContext,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import logoUrl from '../assets/logo.png';
import { Avatar } from './Avatar';
import { MenuButton } from './MenuButton';

export const APP_NAME = 'Family Tree';

interface HeaderTree {
  id: string;
  name: string;
}

const HeaderTreeContext = createContext<{
  tree: HeaderTree | null;
  setTree: (t: HeaderTree | null) => void;
} | null>(null);

/** Holds the tree the current page is about, so the header can name it. */
export function HeaderTreeProvider({ children }: { children: ReactNode }) {
  const [tree, setTree] = useState<HeaderTree | null>(null);
  return (
    <HeaderTreeContext.Provider value={{ tree, setTree }}>{children}</HeaderTreeContext.Provider>
  );
}

/**
 * A tree page calls this with its tree once loaded (null while loading); the header shows the
 * name until the page goes away. A rename shows at once.
 */
export function useHeaderTree(id: string | null, name: string | null) {
  const setTree = useContext(HeaderTreeContext)?.setTree;
  useEffect(() => {
    if (!setTree) return;
    setTree(id && name !== null ? { id, name } : null);
    return () => setTree(null);
  }, [setTree, id, name]);
}

/** The id the skip link jumps to; Page puts it on <main>. */
export const MAIN_ID = 'main';

/**
 * The global header (UX round 1, batch 6): a skip link, the app name (home), the current tree's
 * name, and, when signed in, My trees and the account menu with the user's picture. Signed out
 * (or while the session loads) it is just the app name.
 */
export function AppHeader() {
  const { user, signOut } = useAuth();
  const tree = useContext(HeaderTreeContext)?.tree ?? null;
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const signedIn = user !== null && user !== 'loading';

  // A failed sign-out message belongs to that attempt; another page doesn't keep it.
  useEffect(() => setError(null), [pathname]);

  function skip(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    document.getElementById(MAIN_ID)?.focus();
  }

  async function onSignOut() {
    setError(null);
    setPending(true);
    const res = await signOut();
    setPending(false);
    if (!res.ok) return setError(res.error.message);
    void navigate('/sign-in', { replace: true });
  }

  const treeHref = tree ? `/trees/${tree.id}` : '';
  return (
    <header className="app-header">
      <a className="skip-link" href={`#${MAIN_ID}`} onClick={skip}>
        Skip to main content
      </a>
      <div className="app-header-bar">
        <div className="app-header-place">
          <Link to="/" className="app-name">
            {/* Decorative: the link is named by the app name beside it. */}
            <img className="app-logo" src={logoUrl} alt="" width={57} height={36} />
            <span className="app-name-text">{APP_NAME}</span>
          </Link>
          {tree && (
            <>
              <span className="app-header-sep" aria-hidden="true">
                /
              </span>
              <Link
                to={treeHref}
                className="app-header-tree"
                title={tree.name}
                aria-current={pathname === treeHref ? 'page' : undefined}
              >
                {tree.name}
              </Link>
            </>
          )}
        </div>
        {signedIn && (
          <>
            <nav aria-label="Main" className="app-nav">
              <Link to="/" aria-current={pathname === '/' ? 'page' : undefined}>
                My trees
              </Link>
            </nav>
            <MenuButton
              label="Account menu"
              className="account-trigger"
              text={
                <>
                  <Avatar name={user.name} url={user.avatarUrl} size={32} />
                  <span className="account-trigger-name">{user.name}</span>
                </>
              }
              items={[
                { label: 'Account', onSelect: () => void navigate('/account') },
                { label: 'Sign out', onSelect: () => void onSignOut(), disabled: pending },
              ]}
            />
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="error app-header-error">
          {error}
        </p>
      )}
    </header>
  );
}
