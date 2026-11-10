// Seeds and checks the local production stack around a restore (scripts/prod-local.sh
// backup-test). Runs in the api container: node restore-check.mjs seed|verify
// State (a test account and its TOTP secret) goes to /state/state.json, mounted from .prod-local/.
import { readFileSync, writeFileSync } from 'node:fs';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import sharp from 'sharp';

const API = process.env.AUTH_BASE_URL;
const WEB = process.env.WEB_ORIGIN;
const STATE = '/state/state.json';
const cookies = new Map();

async function call(method, path, body, type = 'application/json') {
  const headers = { origin: WEB, cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
  if (body !== undefined) headers['content-type'] = type;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body:
      body === undefined ? undefined : type === 'application/json' ? JSON.stringify(body) : body,
  });
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    const value = pair.slice(i + 1);
    if (value === '' || /max-age=0/i.test(c)) cookies.delete(pair.slice(0, i));
    else cookies.set(pair.slice(0, i), value);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
const totp = (raw) => createOTP(raw).totp();

const mode = process.argv[2];
if (mode === 'seed') {
  const email = `restore-${Date.now()}@family.test`;
  const password = `pw-${crypto.randomUUID()}`;
  await call('POST', '/api/auth/sign-up/email', { email, password, name: 'Restore Test' });
  const { totpURI } = await call('POST', '/api/auth/two-factor/enable', { password });
  const raw = new TextDecoder().decode(base32.decode(new URL(totpURI).searchParams.get('secret')));
  await call('POST', '/api/auth/two-factor/verify-totp', { code: await totp(raw) });
  const { tree } = await call('POST', '/api/v1/trees', {
    name: 'Restore test',
    person: { givenName: 'Rita', surname: 'Restore' },
  });
  const { tree: detail } = await call('GET', `/api/v1/trees/${tree.id}`);
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#c63' } })
    .png()
    .toBuffer();
  await call(
    'POST',
    `/api/v1/trees/${tree.id}/persons/${detail.rootPersonId}/photos`,
    png,
    'image/png',
  );
  writeFileSync(
    STATE,
    JSON.stringify({ email, password, raw, treeId: tree.id, root: detail.rootPersonId }),
    {
      mode: 0o600,
    },
  );
  console.log('seeded: an owner with 2FA, a tree and a photo');
} else if (mode === 'verify') {
  const s = JSON.parse(readFileSync(STATE, 'utf8'));
  const signIn = await call('POST', '/api/auth/sign-in/email', {
    email: s.email,
    password: s.password,
  });
  if (signIn?.twoFactorRedirect)
    await call('POST', '/api/auth/two-factor/verify-totp', { code: await totp(s.raw) });
  const view = await call('GET', `/api/v1/trees/${s.treeId}/persons/${s.root}`);
  const photo = view.photos?.[0];
  if (!photo) throw new Error('the photo row is missing after the restore');
  const img = await fetch(photo.fullUrl);
  if (!img.ok || img.headers.get('content-type') !== 'image/webp') {
    throw new Error(`the photo object is not served after the restore: ${img.status}`);
  }
  console.log('verified: sign-in with 2FA, the tree and its photo survived the restore');
} else {
  console.error('usage: node restore-check.mjs seed|verify');
  process.exit(2);
}
