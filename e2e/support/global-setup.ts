import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { type Account, apiContext, enableTwoFactor, newAccount, ok, signUp } from './api';
import { API, PROD_LOCAL, REPO_ROOT, STATE, statePath } from './env';
import { writeFixtures } from './fixtures';

export interface Fixture {
  treeId: string;
  owner: Account & { raw: string };
  viewer: Account;
}

/**
 * The local production stack: Node can't resolve *.family.test (`--host-resolver-rules` only
 * applies to the browser), so curl checks it with --resolve and Caddy's local root (review fix I2).
 */
function healthyViaCurl(): boolean {
  const url = new URL(API);
  try {
    execFileSync(
      'curl',
      [
        '-fsS',
        '-o',
        '/dev/null',
        '--resolve',
        `${url.hostname}:${url.port || 443}:127.0.0.1`,
        '--cacert',
        `${REPO_ROOT}.prod-local/ca/root.crt`,
        `${API}/api/v1/health`,
      ],
      { stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

async function waitForHealth() {
  const ctx = PROD_LOCAL ? null : await apiContext();
  try {
    for (let i = 0; i < 60; i++) {
      const healthy = ctx
        ? (await ctx.get('/api/v1/health').catch(() => null))?.ok()
        : healthyViaCurl();
      if (healthy) return;
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(
      `The API at ${API} isn't healthy. Start the stack first (README, "End-to-end tests").`,
    );
  } finally {
    await ctx?.dispose();
  }
}

/** Fresh accounts every run (decision 15): an owner of the seeded sample family, and a viewer. */
export default async function globalSetup() {
  mkdirSync(STATE, { recursive: true });
  await writeFixtures();
  await waitForHealth(); // curl for the local production stack, Node for dev
  if (PROD_LOCAL) return; // the smoke test signs up itself; production refuses seed data

  const ownerCtx = await apiContext();
  const owner = newAccount('E2E Owner');
  await signUp(ownerCtx, owner);
  const raw = await enableTwoFactor(ownerCtx, owner.password);
  // The sample family, owned by this user: their card is Leo (Phase 6 walkthrough).
  execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'api',
      'pnpm',
      '--filter',
      '@family-tree/api',
      'db:seed',
      owner.email,
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
  const list = (await (await ok(await ownerCtx.get('/api/v1/trees'), 'trees')).json()) as {
    trees: { id: string; name: string }[];
  };
  const tree = list.trees.find((t) => t.name === 'Sample family (seed)');
  if (!tree) throw new Error('the seed did not create "Sample family (seed)"');
  const invite = (await (
    await ok(
      await ownerCtx.post(`/api/v1/trees/${tree.id}/invites`, { data: { role: 'viewer' } }),
      'invite',
    )
  ).json()) as { token: string };
  await ownerCtx.storageState({ path: statePath('owner.json') });

  const viewerCtx = await apiContext();
  const viewer = newAccount('E2E Viewer');
  await signUp(viewerCtx, viewer);
  await ok(
    await viewerCtx.post('/api/v1/invites/accept', { data: { token: invite.token } }),
    'accept',
  );
  await viewerCtx.storageState({ path: statePath('viewer.json') });

  const fixture: Fixture = { treeId: tree.id, owner: { ...owner, raw }, viewer };
  writeFileSync(statePath('fixture.json'), JSON.stringify(fixture), { mode: 0o600 });
  await ownerCtx.dispose();
  await viewerCtx.dispose();
}
