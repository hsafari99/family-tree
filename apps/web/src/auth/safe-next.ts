/**
 * A `next` value is only followed when it resolves to a path on this site. Control characters
 * and backslashes are rejected up front: browsers strip tabs and newlines from URLs, so
 * "/\t/evil.example" would otherwise become "//evil.example".
 */
export function safeNext(next: string | null): string {
  // eslint-disable-next-line no-control-regex
  if (!next || !next.startsWith('/') || /[\u0000-\u001F\u007F\\]/.test(next)) return '/';
  try {
    const url = new URL(next, window.location.origin);
    if (url.origin !== window.location.origin) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}
