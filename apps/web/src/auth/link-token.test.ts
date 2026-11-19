import { afterEach, describe, expect, it } from 'vitest';
import { forgetLinkToken, linkUrl, takeLinkToken } from './link-token';

afterEach(() => {
  forgetLinkToken('invite');
  window.history.replaceState(null, '', '/');
});

describe('link tokens', () => {
  it('builds links with the token after #, never in the path', () => {
    expect(linkUrl('invite', 'abc')).toBe(`${window.location.origin}/invite#abc`);
    expect(linkUrl('reset', 'xyz')).toBe(`${window.location.origin}/reset#xyz`);
  });

  it('takes the token from the fragment, keeps it for this tab and clears the address bar', () => {
    window.history.replaceState(null, '', '/invite#tok-123');
    expect(takeLinkToken('invite', undefined)).toBe('tok-123');
    expect(window.location.pathname).toBe('/invite');
    expect(window.location.hash).toBe('');
    // Back from sign-in at the bare /invite: the token comes from storage.
    expect(takeLinkToken('invite', undefined)).toBe('tok-123');
    forgetLinkToken('invite');
    expect(takeLinkToken('invite', undefined)).toBe('');
  });

  it('still accepts an older link with the token in the path', () => {
    window.history.replaceState(null, '', '/invite/old-tok');
    expect(takeLinkToken('invite', 'old-tok')).toBe('old-tok');
    expect(window.location.pathname).toBe('/invite');
  });
});
