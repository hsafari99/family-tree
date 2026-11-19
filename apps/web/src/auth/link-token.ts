/**
 * Invite and reset links carry their secret after `#` (`/invite#<token>`). Browsers never send
 * the fragment to a server, so it stays out of hosting logs and analytics. Older links put it in
 * the path (`/invite/<token>`); they still work until they expire.
 *
 * On arrival the token is moved into sessionStorage (this tab only) and the address bar is reset
 * to the bare path, so it isn't left in history either. Sign-in and Google sign-in then come back
 * to the bare path and the token is read from storage.
 */
const KEY = (kind: LinkKind) => `ft-${kind}-token`;
export type LinkKind = 'invite' | 'reset';

function stored(kind: LinkKind): string {
  try {
    return sessionStorage.getItem(KEY(kind)) ?? '';
  } catch {
    return '';
  }
}

/** The link's token, from the path parameter, the fragment or this tab's storage. */
export function takeLinkToken(kind: LinkKind, pathToken: string | undefined): string {
  const fromUrl = pathToken || decodeURIComponent(window.location.hash.slice(1));
  if (!fromUrl) return stored(kind);
  try {
    sessionStorage.setItem(KEY(kind), fromUrl);
  } catch {
    // Storage blocked: the token still works for this page view.
  }
  window.history.replaceState(window.history.state, '', `/${kind}`);
  return fromUrl;
}

export function forgetLinkToken(kind: LinkKind): void {
  try {
    sessionStorage.removeItem(KEY(kind));
  } catch {
    // Nothing stored.
  }
}

/** The link to hand out. */
export const linkUrl = (kind: LinkKind, token: string) =>
  `${window.location.origin}/${kind}#${encodeURIComponent(token)}`;
