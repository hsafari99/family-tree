import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthApi, MESSAGES, toAuthError } from './api';

const BASE = 'https://api.example.com';

afterEach(() => {
  vi.unstubAllGlobals();
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
};

describe('toAuthError', () => {
  it('maps 401 to the bad-credentials message', () => {
    expect(toAuthError(401).message).toBe(MESSAGES.badCredentials);
  });

  it('maps 429 to the rate-limit message', () => {
    expect(toAuthError(429)).toEqual({ code: 'RATE_LIMITED', message: MESSAGES.tooMany });
  });

  it('keeps the INVALID_RESET message', () => {
    expect(toAuthError(400, 'INVALID_RESET', 'Email or code is incorrect')).toEqual({
      code: 'INVALID_RESET',
      message: 'Email or code is incorrect',
    });
  });

  it('explains the 2FA lockout and the per-challenge limit', () => {
    expect(toAuthError(429, 'ACCOUNT_TEMPORARILY_LOCKED').message).toBe(MESSAGES.locked);
    expect(toAuthError(400, 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE').message).toBe(
      MESSAGES.newChallenge,
    );
  });

  it('hides server errors behind a generic message', () => {
    expect(toAuthError(500, undefined, 'stack trace').message).toBe(MESSAGES.unknown);
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
      error: { code: 'INVALID_RESET', message: 'Email or code is incorrect' },
    });
  });
});
