import { randomUUID } from 'node:crypto';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';

export const WEB_ORIGIN = 'http://localhost:5173';
export const TEST_PASSWORD = 'Correct horse battery1';

/** Minimal cookie jar for app.inject: keeps name=value pairs, drops cookies being cleared. */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  store(res: LightMyRequestResponse): this {
    const raw = res.headers['set-cookie'];
    for (const line of raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]) {
      const [pair = '', ...attrs] = line.split(';').map((s) => s.trim());
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq);
      const cleared = attrs.some((a) => /^max-age=0$/i.test(a)) || pair.slice(eq + 1) === '';
      if (cleared) this.cookies.delete(name);
      else this.cookies.set(name, pair.slice(eq + 1));
    }
    return this;
  }

  has(name: string): boolean {
    return this.cookies.has(name);
  }

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

type Payload = Record<string, unknown>;

/** Sends a request the way the web app does (same origin, JSON) and stores any cookies. */
export async function call(
  app: FastifyInstance,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  {
    jar,
    body,
    headers = {},
  }: {
    jar?: CookieJar;
    body?: Payload;
    /** Overrides; `undefined` removes a default header (e.g. `{ origin: undefined }`). */
    headers?: Record<string, string | undefined>;
  } = {},
): Promise<LightMyRequestResponse> {
  const merged: Record<string, string | undefined> = {
    origin: WEB_ORIGIN,
    ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}),
    ...(jar ? { cookie: jar.header() } : {}),
    ...headers,
  };
  const opts: InjectOptions = {
    method,
    url,
    headers: Object.fromEntries(
      Object.entries(merged).filter((e): e is [string, string] => e[1] !== undefined),
    ),
    ...(method !== 'GET' ? { payload: JSON.stringify(body ?? {}) } : {}),
  };
  const res = await app.inject(opts);
  jar?.store(res);
  return res;
}

export function uniqueEmail(): string {
  return `user-${randomUUID()}@example.com`;
}

export async function signUp(
  app: FastifyInstance,
  { email = uniqueEmail(), password = TEST_PASSWORD, name = 'Test User' } = {},
  headers: Record<string, string> = {},
) {
  const jar = new CookieJar();
  const res = await call(app, 'POST', '/api/auth/sign-up/email', {
    jar,
    body: { email, password, name },
    headers,
  });
  if (res.statusCode !== 200) throw new Error(`sign-up failed: ${res.statusCode} ${res.body}`);
  const userId = res.json().user.id as string;
  return { jar, email, password, userId, res };
}

export async function signIn(app: FastifyInstance, body: { email: string; password: string }) {
  const jar = new CookieJar();
  const res = await call(app, 'POST', '/api/auth/sign-in/email', { jar, body });
  return { jar, res };
}

/** The current TOTP code for a raw secret. */
export function totpNow(rawSecret: string): Promise<string> {
  return createOTP(rawSecret).totp();
}

/** Enables and verifies authenticator 2FA for the signed-in jar. */
export async function enableTwoFactor(app: FastifyInstance, jar: CookieJar, password: string) {
  const res = await call(app, 'POST', '/api/auth/two-factor/enable', { jar, body: { password } });
  if (res.statusCode !== 200) throw new Error(`2fa enable failed: ${res.statusCode} ${res.body}`);
  const { totpURI, backupCodes } = res.json() as { totpURI: string; backupCodes: string[] };
  const secret = new URL(totpURI).searchParams.get('secret');
  if (!secret) throw new Error('totpURI has no secret');
  const rawSecret = new TextDecoder().decode(base32.decode(secret));
  const verify = await call(app, 'POST', '/api/auth/two-factor/verify-totp', {
    jar,
    body: { code: await totpNow(rawSecret) },
  });
  if (verify.statusCode !== 200) {
    throw new Error(`2fa verify failed: ${verify.statusCode} ${verify.body}`);
  }
  return { rawSecret, backupCodes };
}
