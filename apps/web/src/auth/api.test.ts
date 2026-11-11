import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthApi, googleErrorMessage, MESSAGES, SESSION_EXPIRED, toAuthError } from './api';
import { leavePage } from './leave-page';

const BASE = 'https://api.example.com';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Reply = { status: number; body?: unknown };

/** Stubs fetch with replies in order and returns the mock for inspecting calls. */
function stubFetch(...replies: Reply[]) {
  const mock = vi.fn<typeof fetch>(async () => {
    const next = replies.shift() ?? { status: 500 };
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const urlOf = (call: unknown[]) => {
  const input = call[0] as RequestInfo | URL;
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
};

const user = {
  id: '6f9619ff-8b86-4d11-b42d-00c04fc964ff',
  name: 'Ada',
  email: 'ada@example.com',
  twoFactorEnabled: false,
  requiresTwoFactor: false,
  hasPassword: true,
  googleConnected: false,
};

describe('toAuthError for tree roles', () => {
  it('maps TWO_FACTOR_REQUIRED_FOR_ROLE to a fixed message', () => {
    expect(toAuthError(403, 'TWO_FACTOR_REQUIRED_FOR_ROLE', 'session').message).toBe(
      MESSAGES.twoFactorForRole,
    );
  });
});

describe('toAuthError', () => {
  it('maps a 401 to bad credentials only for sign-in', () => {
    expect(toAuthError(401, undefined, 'signIn').message).toBe(MESSAGES.badCredentials);
    expect(toAuthError(401, undefined, 'public').message).toBe(MESSAGES.checkDetails);
  });

  it('maps a 401 on a session-bound call to an expired session', () => {
    expect(toAuthError(401, undefined, 'session')).toEqual({
      code: SESSION_EXPIRED,
      message: MESSAGES.sessionExpired,
    });
    expect(toAuthError(401, 'UNAUTHORIZED', 'session').code).toBe(SESSION_EXPIRED);
  });

  it('maps a 401 during the 2FA step to an expired sign-in', () => {
    expect(toAuthError(401, undefined, 'challenge').message).toBe(MESSAGES.challengeExpired);
    expect(toAuthError(401, 'INVALID_CODE', 'challenge').message).toBe(MESSAGES.badCode);
  });

  it('maps INVALID_PASSWORD on password-checked calls', () => {
    expect(toAuthError(400, 'INVALID_PASSWORD', 'session').message).toBe(MESSAGES.badPassword);
  });

  it('maps 429 to the rate-limit message', () => {
    expect(toAuthError(429)).toEqual({ code: 'RATE_LIMITED', message: MESSAGES.tooMany });
  });

  it('uses a fixed message for INVALID_RESET', () => {
    expect(toAuthError(400, 'INVALID_RESET')).toEqual({
      code: 'INVALID_RESET',
      message: MESSAGES.invalidReset,
    });
  });

  it('explains the 2FA lockout and the per-challenge limit', () => {
    expect(toAuthError(429, 'ACCOUNT_TEMPORARILY_LOCKED').message).toBe(MESSAGES.locked);
    expect(toAuthError(400, 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE').message).toBe(
      MESSAGES.newChallenge,
    );
  });

  it('never passes through an unmapped 4xx or 5xx', () => {
    expect(toAuthError(400, 'SOMETHING_NEW')).toEqual({
      code: 'SOMETHING_NEW',
      message: MESSAGES.checkDetails,
    });
    expect(toAuthError(500).message).toBe(MESSAGES.unknown);
  });
});

describe('createAuthApi', () => {
  it('getMe returns the user', async () => {
    const fetchMock = stubFetch({ status: 200, body: { user } });
    const api = createAuthApi({ baseUrl: `${BASE}/` });
    await expect(api.getMe()).resolves.toEqual({ ok: true, data: user });
    expect(urlOf(fetchMock.mock.calls[0]!)).toBe(`${BASE}/api/v1/me`);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: 'include' });
  });

  it('getMe returns null on 401', async () => {
    stubFetch({ status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'Sign in' } } });
    await expect(createAuthApi({ baseUrl: BASE }).getMe()).resolves.toEqual({
      ok: true,
      data: null,
    });
  });

  it('reports a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const api = createAuthApi({ baseUrl: BASE });
    await expect(api.getMe()).resolves.toMatchObject({ ok: false, error: { code: 'NETWORK' } });
    await expect(api.signIn({ email: 'a@b.co', password: 'x' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'NETWORK' },
    });
  });

  it('signIn reports when a second factor is required', async () => {
    const fetchMock = stubFetch({
      status: 200,
      body: { twoFactorRedirect: true, twoFactorMethods: ['totp'] },
    });
    const api = createAuthApi({ baseUrl: BASE });
    await expect(api.signIn({ email: 'ada@example.com', password: 'pw' })).resolves.toEqual({
      ok: true,
      data: { twoFactorRequired: true },
    });
    expect(urlOf(fetchMock.mock.calls[0]!)).toBe(`${BASE}/api/auth/sign-in/email`);
  });

  it('signIn without 2FA', async () => {
    stubFetch({ status: 200, body: { redirect: false, user } });
    await expect(
      createAuthApi({ baseUrl: BASE }).signIn({ email: 'ada@example.com', password: 'pw' }),
    ).resolves.toEqual({ ok: true, data: { twoFactorRequired: false } });
  });

  it('signIn maps a wrong password', async () => {
    stubFetch({
      status: 401,
      body: { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
    });
    await expect(
      createAuthApi({ baseUrl: BASE }).signIn({ email: 'ada@example.com', password: 'pw' }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_EMAIL_OR_PASSWORD', message: MESSAGES.badCredentials },
    });
  });

  it('startTwoFactorSetup returns the URI and codes', async () => {
    const backupCodes = Array.from({ length: 8 }, (_, i) => `aaaaa-0000${i}`);
    const fetchMock = stubFetch({
      status: 200,
      body: { method: 'totp', totpURI: 'otpauth://totp/x?secret=ABC', backupCodes },
    });
    await expect(
      createAuthApi({ baseUrl: BASE }).startTwoFactorSetup({ password: 'pw' }),
    ).resolves.toEqual({ ok: true, data: { totpURI: 'otpauth://totp/x?secret=ABC', backupCodes } });
    expect(urlOf(fetchMock.mock.calls[0]!)).toBe(`${BASE}/api/auth/two-factor/enable`);
  });

  it('changePassword revokes other sessions', async () => {
    const fetchMock = stubFetch({ status: 200, body: { user } });
    await createAuthApi({ baseUrl: BASE }).changePassword({
      currentPassword: 'old-password',
      newPassword: 'new-password',
    });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      currentPassword: 'old-password',
      newPassword: 'new-password',
      revokeOtherSessions: true,
    });
  });

  it('resetWithCode posts JSON with credentials', async () => {
    const fetchMock = stubFetch({ status: 204 });
    const input = { email: 'ada@example.com', code: '123456', newPassword: 'new-password' };
    await expect(createAuthApi({ baseUrl: BASE }).resetWithCode(input)).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(urlOf(fetchMock.mock.calls[0]!)).toBe(`${BASE}/api/v1/password-reset/totp`);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify(input),
    });
  });

  it('resetWithLink surfaces INVALID_RESET', async () => {
    stubFetch({
      status: 400,
      body: { error: { code: 'INVALID_RESET', message: 'Email or code is incorrect' } },
    });
    await expect(
      createAuthApi({ baseUrl: BASE }).resetWithLink({
        token: 'x'.repeat(32),
        newPassword: 'new-password',
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_RESET', message: MESSAGES.invalidReset },
    });
  });

  it('reports an expired session from a session-bound call', async () => {
    stubFetch({ status: 401, body: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
    await expect(
      createAuthApi({ baseUrl: BASE }).changePassword({
        currentPassword: 'old-password',
        newPassword: 'new-password',
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: SESSION_EXPIRED, message: MESSAGES.sessionExpired },
    });
  });

  it('does not show raw server text for an unmapped error', async () => {
    stubFetch({ status: 400, body: { code: 'WEIRD', message: 'internal detail leaked' } });
    const res = await createAuthApi({ baseUrl: BASE }).signUp({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'correct-horse',
    });
    expect(res).toEqual({ ok: false, error: { code: 'WEIRD', message: MESSAGES.checkDetails } });
  });

  it('maps a wrong password when turning on 2FA', async () => {
    stubFetch({ status: 400, body: { code: 'INVALID_PASSWORD', message: 'Invalid password' } });
    await expect(
      createAuthApi({ baseUrl: BASE }).startTwoFactorSetup({ password: 'nope' }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_PASSWORD', message: MESSAGES.badPassword },
    });
  });
});

describe('Google', () => {
  const HERE = window.location.origin;
  const GOOGLE_URL = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y';
  const bodyOf = (mock: ReturnType<typeof stubFetch>) =>
    JSON.parse((mock.mock.calls[0]![1] as RequestInit).body as string) as Record<string, unknown>;

  it('getProviders reads which buttons to show', async () => {
    const fetchMock = stubFetch({ status: 200, body: { google: true } });
    await expect(createAuthApi({ baseUrl: BASE }).getProviders()).resolves.toEqual({
      ok: true,
      data: { google: true },
    });
    expect(urlOf(fetchMock.mock.calls[0]!)).toBe(`${BASE}/api/v1/auth/providers`);
  });

  it('getProviders treats a failure as no Google', async () => {
    stubFetch({ status: 500 });
    await expect(createAuthApi({ baseUrl: BASE }).getProviders()).resolves.toEqual({
      ok: true,
      data: { google: false },
    });
  });

  it('startGoogleSignIn sends the return path on this site, then leaves for Google', async () => {
    const leave = vi.spyOn(leavePage, 'to').mockImplementation(() => {});
    const fetchMock = stubFetch({ status: 200, body: { url: GOOGLE_URL, redirect: false } });
    await expect(
      createAuthApi({ baseUrl: BASE }).startGoogleSignIn({ next: '/invite/abc' }),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(urlOf(fetchMock.mock.calls[0]!)).toBe(`${BASE}/api/auth/sign-in/social`);
    expect(bodyOf(fetchMock)).toEqual({
      provider: 'google',
      callbackURL: `${HERE}/invite/abc`,
      errorCallbackURL: `${HERE}/sign-in?next=${encodeURIComponent('/invite/abc')}`,
      disableRedirect: true,
    });
    expect(leave).toHaveBeenCalledWith(GOOGLE_URL);
  });

  it('startGoogleSignIn falls back to / for a return path off this site', async () => {
    vi.spyOn(leavePage, 'to').mockImplementation(() => {});
    const fetchMock = stubFetch({ status: 200, body: { url: GOOGLE_URL, redirect: false } });
    await createAuthApi({ baseUrl: BASE }).startGoogleSignIn({ next: '//evil.example/x' });
    expect(bodyOf(fetchMock)).toMatchObject({
      callbackURL: `${HERE}/`,
      errorCallbackURL: `${HERE}/sign-in`,
    });
  });

  it('never leaves for anywhere but Google', async () => {
    const leave = vi.spyOn(leavePage, 'to').mockImplementation(() => {});
    stubFetch({ status: 200, body: { url: 'https://evil.example/', redirect: false } });
    await expect(
      createAuthApi({ baseUrl: BASE }).startGoogleSignIn({ next: '/' }),
    ).resolves.toEqual({ ok: false, error: { code: 'HTTP_200', message: MESSAGES.unknown } });
    expect(leave).not.toHaveBeenCalled();
  });

  it('connectGoogle re-sends the password and code, and returns to Account settings', async () => {
    const leave = vi.spyOn(leavePage, 'to').mockImplementation(() => {});
    const fetchMock = stubFetch({ status: 200, body: { url: GOOGLE_URL, redirect: false } });
    await expect(
      createAuthApi({ baseUrl: BASE }).connectGoogle({ password: 'pw', code: '123456' }),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(urlOf(fetchMock.mock.calls[0]!)).toBe(`${BASE}/api/auth/link-social`);
    expect(bodyOf(fetchMock)).toEqual({
      provider: 'google',
      password: 'pw',
      code: '123456',
      callbackURL: `${HERE}/account?google=connected`,
      errorCallbackURL: `${HERE}/account`,
      disableRedirect: true,
    });
    expect(leave).toHaveBeenCalledWith(GOOGLE_URL);
  });

  it('connectGoogle maps its refusals to fixed messages', async () => {
    stubFetch({ status: 400, body: { code: 'TWO_FACTOR_CODE_REQUIRED', message: 'x' } });
    await expect(
      createAuthApi({ baseUrl: BASE }).connectGoogle({ password: 'pw' }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'TWO_FACTOR_CODE_REQUIRED', message: MESSAGES.codeRequired },
    });
  });

  it('disconnectGoogle and setPassword use the account routes', async () => {
    const fetchMock = stubFetch(
      { status: 204 },
      {
        status: 409,
        body: { error: { code: 'PASSWORD_REQUIRED_TO_DISCONNECT', message: 'server text' } },
      },
      { status: 204 },
    );
    const api = createAuthApi({ baseUrl: BASE });
    await expect(api.disconnectGoogle({ password: 'pw', code: '123456' })).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(bodyOf(fetchMock)).toEqual({ password: 'pw', code: '123456' });
    await expect(api.disconnectGoogle({ password: 'pw' })).resolves.toEqual({
      ok: false,
      error: {
        code: 'PASSWORD_REQUIRED_TO_DISCONNECT',
        message: MESSAGES.passwordRequiredToDisconnect,
      },
    });
    await expect(api.setPassword({ newPassword: 'a long password' })).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(fetchMock.mock.calls.map(urlOf)).toEqual([
      `${BASE}/api/v1/account/google/disconnect`,
      `${BASE}/api/v1/account/google/disconnect`,
      `${BASE}/api/v1/account/password`,
    ]);
  });

  it('googleErrorMessage maps callback error codes, and nothing else gets through', () => {
    expect(googleErrorMessage('account_not_linked')).toBe(MESSAGES.googleEmailTaken);
    expect(googleErrorMessage('account_already_linked_to_different_user')).toBe(
      MESSAGES.googleLinkedElsewhere,
    );
    expect(googleErrorMessage('access_denied')).toBe(MESSAGES.googleCancelled);
    expect(googleErrorMessage('google_already_connected', 'connect')).toBe(
      MESSAGES.googleAlreadyConnected,
    );
    expect(googleErrorMessage('<script>anything</script>')).toBe(MESSAGES.googleFailed);
    expect(googleErrorMessage(null)).toBeNull();
  });
});

describe('moving 2FA to a new phone', () => {
  const MOVE = `${BASE}/api/v1/account/two-factor/move`;
  const URI = 'otpauth://totp/Family%20Tree:ada%40example.com?secret=JBSWY3DPEHPK3PXP';

  it('starts with the password and a code, and returns the otpauth URI', async () => {
    const fetchMock = stubFetch({ status: 200, body: { totpURI: URI } });
    const input = { password: 'correct-horse', code: '123456' };
    await expect(createAuthApi({ baseUrl: BASE }).startTwoFactorMove(input)).resolves.toEqual({
      ok: true,
      data: { totpURI: URI },
    });
    expect(urlOf(fetchMock.mock.calls[0]!)).toBe(`${MOVE}/start`);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify(input),
    });
  });

  it('refuses a start answer that is not an otpauth URI', async () => {
    stubFetch({ status: 200, body: { totpURI: 'https://evil.example' } });
    const res = await createAuthApi({ baseUrl: BASE }).startTwoFactorMove({ code: '123456' });
    expect(res).toEqual({ ok: false, error: { code: 'HTTP_500', message: MESSAGES.unknown } });
  });

  it('confirms with a code from the new phone and returns the new recovery codes', async () => {
    const fetchMock = stubFetch({ status: 200, body: { backupCodes: ['abcde-12345'] } });
    await expect(
      createAuthApi({ baseUrl: BASE }).confirmTwoFactorMove({ code: '654321' }),
    ).resolves.toEqual({ ok: true, data: { backupCodes: ['abcde-12345'] } });
    expect(urlOf(fetchMock.mock.calls[0]!)).toBe(`${MOVE}/confirm`);
  });

  it('cancels', async () => {
    const fetchMock = stubFetch({ status: 204 });
    await expect(createAuthApi({ baseUrl: BASE }).cancelTwoFactorMove()).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(urlOf(fetchMock.mock.calls[0]!)).toBe(`${MOVE}/cancel`);
  });

  it('maps the move errors to fixed messages, never the server text', async () => {
    const cases: [string, number, string][] = [
      ['MOVE_EXPIRED', 410, MESSAGES.moveExpired],
      ['MOVE_NOT_STARTED', 404, MESSAGES.moveNotStarted],
      ['TWO_FACTOR_NOT_ENABLED', 409, MESSAGES.twoFactorNotEnabled],
      ['ACCOUNT_TEMPORARILY_LOCKED', 429, MESSAGES.locked],
      ['INVALID_CODE', 400, MESSAGES.badCode],
    ];
    for (const [code, status, message] of cases) {
      stubFetch({ status, body: { error: { code, message: 'server detail' } } });
      const res = await createAuthApi({ baseUrl: BASE }).confirmTwoFactorMove({ code: '654321' });
      expect(res).toEqual({ ok: false, error: { code, message } });
    }
  });
});
