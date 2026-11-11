import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { vi } from 'vitest';
import type { Config } from '../src/config.js';
import { call, CookieJar, WEB_ORIGIN } from './auth-helpers.js';

/** A made-up OAuth client: tests never talk to Google. */
export const TEST_GOOGLE: NonNullable<Config['google']> = {
  clientId: 'test-client-id.apps.googleusercontent.com',
  clientSecret: 'test-only-google-secret',
};

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  email_verified: boolean;
  picture?: string;
}

export function googleProfile(over: Partial<GoogleProfile> = {}): GoogleProfile {
  return {
    sub: `g-${randomUUID()}`,
    email: `google-${randomUUID()}@gmail.com`,
    name: 'Grace Google',
    email_verified: true,
    ...over,
  };
}

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * Better Auth reads the Google profile from the id_token the token endpoint returns (it trusts
 * that response, so the token is not signature-checked); an unsigned token is enough here.
 */
function idToken(profile: GoogleProfile): string {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: 'https://accounts.google.com',
    aud: TEST_GOOGLE.clientId,
    iat: now,
    exp: now + 3600,
    ...profile,
  };
  return `${b64url({ alg: 'RS256', typ: 'JWT', kid: 'test' })}.${b64url(claims)}.c2ln`;
}

const urlOf = (input: string | URL | Request) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/**
 * Answers Google's token endpoint with `profile`, and fails any other request to Google so a
 * test can't reach the real service. Everything else goes to the real fetch.
 */
export function mockGoogle(profile: GoogleProfile) {
  const realFetch = globalThis.fetch;
  const tokenRequests: URLSearchParams[] = [];
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = urlOf(input);
      if (url === GOOGLE_TOKEN_URL) {
        tokenRequests.push(new URLSearchParams(String(init?.body ?? '')));
        return Response.json({
          access_token: 'test-access-token',
          id_token: idToken(profile),
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid email profile',
        });
      }
      if (/^https:\/\/([a-z0-9-]+\.)*(google|googleapis)\.com\//.test(url)) {
        throw new Error(`test tried to reach Google: ${url}`);
      }
      return realFetch(input, init);
    });
  return { tokenRequests, restore: () => spy.mockRestore() };
}

/** Starts a Google sign-in (or, with path /link-social, a link) the way the web app does. */
export async function startGoogle(
  app: FastifyInstance,
  {
    jar = new CookieJar(),
    path = '/api/auth/sign-in/social',
    body = {},
  }: { jar?: CookieJar; path?: string; body?: Record<string, unknown> } = {},
) {
  const res = await call(app, 'POST', path, {
    jar,
    body: {
      provider: 'google',
      callbackURL: `${WEB_ORIGIN}/`,
      errorCallbackURL: `${WEB_ORIGIN}/sign-in`,
      disableRedirect: true,
      ...body,
    },
  });
  const url = res.statusCode === 200 ? (res.json().url as string) : '';
  return { jar, res, url };
}

/** Google sends the browser back to the callback; this plays that step with `profile`. */
export async function finishGoogle(
  app: FastifyInstance,
  jar: CookieJar,
  authorizationUrl: string,
  profile: GoogleProfile,
) {
  const state = new URL(authorizationUrl).searchParams.get('state') ?? '';
  const google = mockGoogle(profile);
  try {
    const res = await call(
      app,
      'GET',
      `/api/auth/callback/google?code=test-code&state=${encodeURIComponent(state)}`,
      // A top-level navigation from Google: no Origin header.
      { jar, headers: { origin: undefined } },
    );
    return { res, location: String(res.headers.location ?? ''), google };
  } finally {
    google.restore();
  }
}

/** Both steps: a full Google round trip for `profile`. */
export async function googleSignIn(
  app: FastifyInstance,
  profile: GoogleProfile,
  options: Parameters<typeof startGoogle>[1] = {},
) {
  const started = await startGoogle(app, options);
  if (started.res.statusCode !== 200) {
    throw new Error(`google start failed: ${started.res.statusCode} ${started.res.body}`);
  }
  const finished = await finishGoogle(app, started.jar, started.url, profile);
  return { jar: started.jar, ...finished };
}
