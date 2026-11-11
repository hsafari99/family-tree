import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { expect, type Page, test } from '@playwright/test';
import { watchCsp } from '../support/csp';
import { API, PROD_LOCAL, REPO_ROOT } from '../support/env';

/** The dev stack's client ID, from the git-ignored file compose.yml loads. Never printed. */
function configuredClientId(): string | undefined {
  const file = `${REPO_ROOT}.env.development.local`;
  if (PROD_LOCAL || !existsSync(file)) return undefined;
  return parseEnv(readFileSync(file, 'utf8')).GOOGLE_CLIENT_ID || undefined;
}

/** Opens `path` and reports whether the API said Google sign-in is on (the browser asks). */
async function openWithProviders(page: Page, path: string): Promise<boolean> {
  const providers = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/providers'));
  await page.goto(path);
  const res = await providers;
  return res.ok() && (await res.json()).google === true;
}

/**
 * Stops the browser at Google: the authorization request is answered here, so Google's page
 * never loads and nothing is ever typed into it.
 */
async function stopAtGoogle(page: Page): Promise<() => Promise<URL>> {
  let resolve!: (url: URL) => void;
  const reached = new Promise<URL>((r) => (resolve = r));
  await page.route('https://accounts.google.com/**', async (route) => {
    resolve(new URL(route.request().url()));
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Stopped at Google</title>',
    });
  });
  return () => reached;
}

test("@smoke Continue with Google redirects to Google with this app's client, callback and scopes", async ({
  page,
}) => {
  const csp = await watchCsp(page);
  const reachedGoogle = await stopAtGoogle(page);
  const enabled = await openWithProviders(page, '/sign-in?next=%2Faccount');
  test.skip(!enabled, 'Google sign-in is not configured on this stack');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  const url = await reachedGoogle();
  await expect(page).toHaveTitle('Stopped at Google');

  expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  const q = url.searchParams;
  const expectedId = configuredClientId();
  // Compared as a boolean so a failure never prints the ID.
  if (expectedId)
    expect(q.get('client_id') === expectedId, 'client_id is the configured one').toBe(true);
  else expect(/\.apps\.googleusercontent\.com$/.test(q.get('client_id') ?? '')).toBe(true);
  expect(q.get('redirect_uri')).toBe(`${API}/api/auth/callback/google`);
  expect(new Set(q.get('scope')?.split(' '))).toEqual(new Set(['openid', 'email', 'profile']));
  expect(q.get('response_type')).toBe('code');
  expect(q.get('code_challenge_method')).toBe('S256');
  expect(q.get('state')).toBeTruthy();
  expect(await csp.violations()).toEqual([]);
});
