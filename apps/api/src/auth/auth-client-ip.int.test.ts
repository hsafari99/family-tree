import { afterAll, describe, expect, it } from 'vitest';
import { call, signUp } from '../../test/auth-helpers.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDeps } from '../deps.js';
import { createAuth } from './auth.js';
import { CLIENT_IP_HEADER } from './fastify-adapter.js';

// Own file: Better Auth's memory rate-limit store is shared by every instance in a file.
// One trusted proxy hop, as in production behind Caddy.
const config = { ...loadConfig(), TRUST_PROXY: 1 };
const deps = createDeps(config);
const auth = createAuth({ config, db: deps.db });
const app = buildApp({ config, checks: deps.checks, auth, db: deps.db });

afterAll(async () => {
  await app.close();
  await deps.close();
});

describe('client IP reaching Better Auth behind one trusted proxy', () => {
  it('rate-limits each client IP separately', async () => {
    const { email } = await signUp(app, {}, { 'x-forwarded-for': '192.0.2.1' });
    const attempt = (ip: string) =>
      call(app, 'POST', '/api/auth/sign-in/email', {
        body: { email, password: 'Not the password1' },
        headers: { 'x-forwarded-for': ip },
      });
    // 6 attempts in a minute, but 3 from each of 2 IPs: under the limit of 5 per IP.
    for (const ip of ['198.51.100.1', '198.51.100.2', '198.51.100.1', '198.51.100.2']) {
      expect((await attempt(ip)).statusCode).toBe(401);
    }
    expect((await attempt('198.51.100.1')).statusCode).toBe(401);
    expect((await attempt('198.51.100.2')).statusCode).toBe(401);
  });

  it(`ignores a client-sent ${CLIENT_IP_HEADER} header`, async () => {
    const { email } = await signUp(app, {}, { 'x-forwarded-for': '192.0.2.2' });
    const attempt = (i: number) =>
      call(app, 'POST', '/api/auth/sign-in/email', {
        body: { email, password: 'Not the password1' },
        headers: { 'x-forwarded-for': '203.0.113.50', [CLIENT_IP_HEADER]: `10.0.0.${i}` },
      });
    for (let i = 0; i < 5; i++) expect((await attempt(i)).statusCode).toBe(401);
    expect((await attempt(99)).statusCode).toBe(429);
  });
});
