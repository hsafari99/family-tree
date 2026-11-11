import { expect, type Page, test } from '@playwright/test';
import { watchCsp } from '../support/csp';
import { API } from '../support/env';

/**
 * The client ID the stack should use, when the runner knows it: CI sets E2E_GOOGLE_CLIENT_ID to
 * the same made-up value it gives the API, and then the test must run, never skip. Locally it is
 * unset and only the ID's shape is checked.
 */
const EXPECTED_CLIENT_ID = process.env.E2E_GOOGLE_CLIENT_ID || undefined;

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
  if (EXPECTED_CLIENT_ID) expect(enabled, 'the API has the Google client CI gave it').toBe(true);
  test.skip(!enabled, 'Google sign-in is not configured on this stack');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  const url = await reachedGoogle();
  await expect(page).toHaveTitle('Stopped at Google');

  expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  const q = url.searchParams;
  const expectedId = EXPECTED_CLIENT_ID;
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
