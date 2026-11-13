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
import type { TreeList } from '@family-tree/shared';
import { useTreesApi } from '../trees/TreesApiContext';
import { Avatar } from './Avatar';
import { ChevronDownIcon } from './icons';
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
    if (id) noteOpened(id);
    setTree(id && name !== null ? { id, name } : null);
    return () => setTree(null);
  }, [setTree, id, name]);
}

const RECENT_KEY = 'ft.recentTrees';
const RECENT_MAX = 50;

/** The trees this browser opened, most recent first (a per-viewer convenience; may be empty). */
function recentTrees(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function noteOpened(id: string) {
  try {
    const next = [id, ...recentTrees().filter((x) => x !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: the switcher just falls back to name order.
  }
}

/** The user's trees for the switcher: most recently opened here first, then by name. */
export function switcherOrder(trees: TreeList['trees'], recent: string[]): TreeList['trees'] {
  const rank = (id: string) => {
    const i = recent.indexOf(id);
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  };
  return [...trees].sort(
    (a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
}

/**
 * The current tree's name in the header. With more than one tree it opens a menu to switch to
 * another (most recently opened first, the current one ticked), All trees and Start a new tree;
 * with one tree it is a plain link to it.
 */
function TreeSwitcher({ tree, current }: { tree: HeaderTree; current: boolean }) {
  const api = useTreesApi();
  const navigate = useNavigate();
  const [trees, setTrees] = useState<TreeList['trees'] | null>(null);

  // Re-read on every tree change, so a tree made or deleted since shows up (or goes).
  useEffect(() => {
    let live = true;
    void api.listTrees().then((r) => {
      if (live && r.ok) setTrees(r.data.trees);
    });
    return () => {
      live = false;
    };
  }, [api, tree.id]);

  const href = `/trees/${tree.id}`;
  if (!trees || trees.length < 2) {
    return (
      <Link
        to={href}
        className="app-header-tree"
        title={tree.name}
        aria-current={current ? 'page' : undefined}
      >
        {tree.name}
      </Link>
    );
  }
  const items = [
    ...switcherOrder(trees, recentTrees()).map((t) => ({
      key: t.id,
      // The header knows the current name first (a rename shows at once).
      label: t.id === tree.id ? tree.name : t.name,
      checked: t.id === tree.id,
      onSelect: () => void navigate(`/trees/${t.id}`),
    })),
    { key: 'all', label: 'All trees', separated: true, onSelect: () => void navigate('/') },
    { key: 'new', label: 'Start a new tree', onSelect: () => void navigate('/trees/new') },
  ];
  return (
    <MenuButton
      // The visible name starts the accessible one (WCAG 2.5.3).
      label={`${tree.name}, switch tree`}
      className="app-header-tree tree-switch"
      text={
        <>
          <span className="tree-switch-name">{tree.name}</span>
          <ChevronDownIcon />
        </>
      }
      items={items}
    />
  );
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
              {signedIn ? (
                <TreeSwitcher tree={tree} current={pathname === treeHref} />
              ) : (
                <Link to={treeHref} className="app-header-tree" title={tree.name}>
                  {tree.name}
                </Link>
              )}
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
