import { randomUUID } from 'node:crypto';
import { type APIRequestContext, type APIResponse, request } from '@playwright/test';
import { API, PROD_LOCAL, WEB } from './env';
import { rawSecret, totpCode } from './totp';

export interface Account {
  name: string;
  email: string;
  password: string;
}

export const newAccount = (name: string): Account => ({
  name,
  email: `e2e-${randomUUID()}@example.com`,
  password: `E2e-${randomUUID()}`,
});

/** Requests the way the web app makes them: from the web origin, keeping cookies. */
export const apiContext = (storageState?: string) =>
  request.newContext({
    baseURL: API,
    extraHTTPHeaders: { origin: WEB },
    ignoreHTTPSErrors: PROD_LOCAL,
    ...(storageState ? { storageState } : {}),
  });

export async function ok(res: APIResponse, what: string): Promise<APIResponse> {
  if (!res.ok()) throw new Error(`${what}: ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return res;
}

export async function signUp(ctx: APIRequestContext, a: Account) {
  await ok(
    await ctx.post('/api/auth/sign-up/email', {
      data: { name: a.name, email: a.email, password: a.password },
    }),
    'sign-up',
  );
}

/** Turns on 2FA for the signed-in context and returns the raw TOTP secret. */
export async function enableTwoFactor(ctx: APIRequestContext, password: string) {
  const res = await ok(
    await ctx.post('/api/auth/two-factor/enable', { data: { password } }),
    '2FA enable',
  );
  const { totpURI } = (await res.json()) as { totpURI: string };
  const raw = rawSecret(new URL(totpURI).searchParams.get('secret')!);
  await ok(
    await ctx.post('/api/auth/two-factor/verify-totp', { data: { code: await totpCode(raw) } }),
    '2FA verify',
  );
  return raw;
}
