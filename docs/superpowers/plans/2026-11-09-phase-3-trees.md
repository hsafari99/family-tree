# Phase 3 — Trees, Members, Invites, Stewards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-in users can start a tree (with 2FA), see their trees, invite relatives by link as viewers, editors or branch stewards, manage members and stewards, transfer ownership, issue reset links, and soft-delete or restore a tree. Every tree route authorises through one `can()` and returns 404 to outsiders.

**Architecture:**
- **Permissions:**
  - A pure `can(actor, action, target)` in the API holds the whole permission matrix from spec §4.
  - Each request loads an `Access` for (tree, user): role, plus effective steward grants with their person-id scopes.
  - Branch scopes come from one recursive SQL CTE (`branchQuery`). A pure TypeScript twin (`branchOf` in `packages/shared`) shares fixtures with it, so a unit suite and an integration suite prove they agree.
- **Routes:** grouped into four Fastify plugins (trees, members, stewards, invites) under the session guard.
- **Web pages:** the web app gets a `TreesApi` (interface plus fetch implementation plus in-memory fake, mirroring `AuthApi`) and these pages:
  - My trees
  - New tree
  - Tree overview (a placeholder until the phase 5 canvas)
  - Members
  - Invite landing
  - Account deletion

**Tech Stack:** Fastify 5.12.8, Drizzle 0.45.4 / drizzle-kit 0.31.11, Postgres 17, Better Auth 1.7.18 (hooks + deleteUser), Zod 4.6.7, React 19.3.1, react-router 8.5.1, Vitest 5.1.0. **No new dependencies.**

---

## Ground rules (read first)

- **Branch:** work on `phase-3-trees`. Commit after each task. Never push. Never commit:
  - `.env.production`
  - `graft/`
  - `.ignore`
  - `.claude/settings.local.json`
  - `.vitest/`
- **Dependencies:** never add `minimumReleaseAgeExclude`, and never upgrade dependencies. The dev CPU has no AVX2, and Vite is pinned to 8.3.6 for that reason.
- **Running the stack:**
  - The dev stack runs in Docker: `pnpm dev`.
  - Integration tests need postgres and s3 up: `docker compose up -d --wait postgres s3`.
  - Commands, from the repo root:
    - `pnpm test`
    - `pnpm test:int`
    - `pnpm lint`
    - `pnpm typecheck`
    - `pnpm format:check`
    - `pnpm build`
- **Single test files:**
  - API unit tests: `pnpm --filter @family-tree/api exec vitest run src/path/file.test.ts`
  - API integration tests: `pnpm --filter @family-tree/api exec vitest run --config vitest.int.config.ts src/path/file.int.test.ts`
  - Web: `pnpm --filter @family-tree/web exec vitest run src/path/file.test.tsx`
  - Shared: `pnpm --filter @family-tree/shared exec vitest run src/file.test.ts`
- **Error handling:**
  - Only `AppError` messages reach clients.
  - Trees the user can't see return **404**, never 403.
  - `FORBIDDEN` (403) is only for a tree the user is a member of.
  - The web UI never shows server text: it maps error **codes** to fixed messages.
- **Routes:** every new route lives in a plugin registered after the rate limiter (see the comment in `app.ts`).
- **Browser:** no `window.confirm` / `alert` in the UI, because it blocks the browser automation used to verify phases. Destructive buttons use an inline two-step confirm.
- **Code in this plan:** it is the intended implementation. If the real code has moved on (names, imports), follow the repo and keep the behaviour. Run Prettier (`pnpm format`) before each commit.

## Decisions taken in this plan (beyond the spec)

1. **Revoking a steward grant** hard-deletes the row. `parent_grant_id … ON DELETE CASCADE` revokes every grant derived from it. (Phase 4's audit log will record grant changes; not in this phase.)
2. **Removing a member** deletes their `tree_members` row. Their grants go with it, through an FK to `tree_members`, along with grants derived from them. Their open invites are revoked.
3. **Re-checking invites at redemption:** an invite is re-authorised when it's redeemed. The creator must still be a member who may issue exactly that invite: `can(creator, 'invite.create', …)`. Otherwise it is invalid. So a steward's open invites stop working when their stewardship is revoked.
4. **Invite tokens** are sent in POST bodies (`/api/v1/invites/preview`, `/api/v1/invites/accept`), never in API URLs, so they don't end up in access logs. The web route `/invite/:token` is protected by the `no-referrer` policy from phase 2.
5. **Member emails** are shown only to the owner. Other members see names and roles.
6. **Owner-issued reset links:**
   - Only for members without 2FA (with 2FA, they reset with their code).
   - Only when every tree the target belongs to is owned by the issuer. This includes soft-deleted trees.
   - The issuer can't target themselves.
   - Error code `RESET_LINK_NOT_ALLOWED`.
7. **Keeping 2FA on:** owners and stewards can't turn 2FA off. A Better Auth `before` hook blocks `/two-factor/disable`. "Holds an owner or steward role" means owning any tree (even a deleted one) or holding any grant. **Moving 2FA to a new device** (re-enrolling) is deferred to phase 7. Until then, an owner who loses their phone signs in with a recovery code.
8. **Account deletion:**
   - Better Auth `deleteUser` is enabled, and a `before` hook requires a password. (Without one, Better Auth would delete any session younger than a day with no check.)
   - `beforeDelete` refuses while the user owns a non-deleted tree.
   - Owning only a soft-deleted tree doesn't block deletion: that tree is left ownerless and the phase 4 purge job removes it.
9. **Tree limit:** `MAX_TREES_PER_USER` (default 3) counts the user's owned, non-deleted trees. A per-user advisory lock stops concurrent creates from slipping past it.
10. **New error codes:** `TWO_FACTOR_REQUIRED`, `INVALID_INVITE` and `RESET_LINK_NOT_ALLOWED`. `QUOTA_EXCEEDED` (already in the list) covers the tree limit.
11. **Ownership transfer:**
    - The target must be a member with 2FA.
    - The old owner becomes an editor.
    - Any grants the new owner held are deleted, because an owner needs none.
12. **Persons list:** `GET /trees/:id/persons` is a minimal read-only list (names and years). The pickers (anchor, "this is you", root person) need it before phase 4 brings person CRUD.
13. **Dev seed:** `pnpm seed [owner-email]` makes that user the owner of the sample family, so branches and stewards can be tried by hand before phase 4.

## File map

```
packages/shared/src/
  api.ts                     + TWO_FACTOR_REQUIRED, INVALID_INVITE, RESET_LINK_NOT_ALLOWED
  auth.ts                    meResponseSchema.user + requiresTwoFactor
  permissions.ts (+test)     ROLES, INVITE_ROLES, ROLE_RANK, TREE_RESTORE_DAYS
  trees.ts (+test)           request schemas and response schemas for trees/members/stewards/invites
  branch.ts (+test)          branchOf(graph, anchorId, stewardUserId): pure branch rule (§4)
  branch-fixtures.ts         graph fixtures + expected branches, shared by unit and int tests
  index.ts                   + exports
apps/api/
  drizzle/0002_tree_access.sql (generated)
  src/
    config.ts (+test)        + MAX_TREES_PER_USER
    errors.ts (+test)        + notFound(), forbidden(), idParam()
    db/client.ts             + Tx, Queryable types
    db/schema.ts             + persons.created_by/updated_by, tree_members, branch_stewards, invites,
                               reset_links.tree_id
    db/tree-access-schema.int.test.ts
    db/seed.ts, seed-cli.ts  + optional owner
    security/tokens.ts       newToken(), hashToken()
    security/limits.ts       perClientLimit(app, …): extracted from password-reset.ts
    permissions/can.ts (+test)        the permission matrix
    trees/branch.ts                   branchQuery / branchPersonIds (recursive CTE)
    trees/branch.int.test.ts          CTE == branchOf on every fixture
    trees/access.ts                   loadAccess(), authorize(), grantCovering()
    trees/access.int.test.ts
    trees/roles.ts                    holdsTwoFactorRole(), ownsLiveTree()
    routes/trees.ts (+int test)       list/create/get/patch/delete/restore + persons list
    routes/members.ts (+int test)     list/change role/remove/transfer/reset-link
    routes/stewards.ts (+int test)    list/grant/revoke
    routes/invites.ts (+int test)     list/create/revoke + public preview/accept
    routes/isolation.int.test.ts      outsider gets 404 on every tree route
    routes/me.ts                      + requiresTwoFactor
    auth/auth.ts                      + hooks (2FA disable guard, delete needs password), deleteUser
    auth/account.int.test.ts          2FA-disable guard, account deletion rules
    auth/reset-links.ts               + treeId
    app.ts                            register the new plugins
  test/auth-helpers.ts                call() supports PATCH/DELETE
  test/tree-helpers.ts                ownerWithTree(), joinAs(), personIn()
apps/web/src/
  trees/api.ts (+test)                TreesApi interface + fetch implementation
  trees/TreesApiContext.tsx           provider + useTreesApi()
  test/fake-trees.ts                  in-memory FakeTreesApi
  test/render.tsx                     renderAt(path, { auth, trees })
  auth/api.ts                         + deleteAccount, new error codes
  components/ConfirmButton.tsx (+test)
  components/Page.tsx                 + wide variant
  pages/HomePage.tsx                  signed in → My trees
  pages/MyTrees.tsx (+test)
  pages/NewTreePage.tsx (+test)
  pages/TreePage.tsx (+test)
  pages/MembersPage.tsx (+test)
  pages/members/*.tsx                 MembersSection, StewardsSection, InvitesSection
  pages/InvitePage.tsx (+test)
  pages/SignInPage.tsx, SignUpPage.tsx  keep ?next= on the links between them (already honoured)
  pages/AccountPage.tsx (+test)       delete account; hide "turn off 2FA" when required
  routes.tsx
README.md                             Trees, invites and stewards (dev)
```

---

## Task 1: Shared — error codes, permission constants, request/response schemas

**Files:**
- Modify: `packages/shared/src/api.ts`, `packages/shared/src/auth.ts`, `packages/shared/src/index.ts`
- Create: `packages/shared/src/permissions.ts`, `packages/shared/src/trees.ts`, `packages/shared/src/trees.test.ts`

- [ ] **Step 1: Write the failing test** `packages/shared/src/trees.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { ROLE_RANK } from './permissions.js';
import {
  createInviteSchema,
  createTreeSchema,
  grantStewardSchema,
  updateTreeSchema,
} from './trees.js';

const uuid = '0b0c8a4e-1f7e-4c1a-9a51-6a2a3c9d0e11';

describe('createTreeSchema', () => {
  it('trims names and defaults sex to unknown', () => {
    const r = createTreeSchema.parse({
      name: '  Hale family ',
      person: { givenName: ' Leo ', surname: ' Hale ' },
    });
    expect(r).toEqual({
      name: 'Hale family',
      person: { givenName: 'Leo', surname: 'Hale', sex: 'unknown' },
    });
  });
  it('turns an empty surname into undefined', () => {
    const r = createTreeSchema.parse({ name: 'x', person: { givenName: 'Leo', surname: '  ' } });
    expect(r.person.surname).toBeUndefined();
  });
  it('rejects an empty tree name, a missing given name and a future birth year', () => {
    expect(createTreeSchema.safeParse({ name: ' ', person: { givenName: 'a' } }).success).toBe(
      false,
    );
    expect(createTreeSchema.safeParse({ name: 'x', person: { givenName: '' } }).success).toBe(
      false,
    );
    const next = new Date().getUTCFullYear() + 1;
    expect(
      createTreeSchema.safeParse({ name: 'x', person: { givenName: 'a', birthYear: next } })
        .success,
    ).toBe(false);
  });
  it('rejects names over 100 characters', () => {
    expect(
      createTreeSchema.safeParse({ name: 'x'.repeat(101), person: { givenName: 'a' } }).success,
    ).toBe(false);
  });
});

describe('updateTreeSchema', () => {
  it('needs at least one field', () => {
    expect(updateTreeSchema.safeParse({}).success).toBe(false);
    expect(updateTreeSchema.safeParse({ name: 'New' }).success).toBe(true);
    expect(updateTreeSchema.safeParse({ rootPersonId: uuid }).success).toBe(true);
  });
});

describe('createInviteSchema', () => {
  it('defaults the optional people to null and refuses the owner role', () => {
    expect(createInviteSchema.parse({ role: 'viewer' })).toEqual({
      role: 'viewer',
      stewardAnchorPersonId: null,
      targetPersonId: null,
    });
    expect(createInviteSchema.safeParse({ role: 'owner' }).success).toBe(false);
  });
});

describe('grantStewardSchema', () => {
  it('needs uuids', () => {
    expect(grantStewardSchema.safeParse({ userId: 'x', anchorPersonId: uuid }).success).toBe(false);
  });
});

describe('ROLE_RANK', () => {
  it('orders viewer < editor < owner', () => {
    expect(ROLE_RANK.viewer).toBeLessThan(ROLE_RANK.editor);
    expect(ROLE_RANK.editor).toBeLessThan(ROLE_RANK.owner);
  });
});
```

- [ ] **Step 2: Run it; it fails** (modules missing).

Run: `pnpm --filter @family-tree/shared exec vitest run src/trees.test.ts`

- [ ] **Step 3: Implement**

`packages/shared/src/permissions.ts`:

```ts
export const ROLES = ['owner', 'editor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** Roles an invite or a role change can give; ownership only moves by transfer. */
export const INVITE_ROLES = ['editor', 'viewer'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

/** Redeeming an invite only ever raises a member's role (spec §5). */
export const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

/** A deleted tree can be restored for this many days, then it is purged (spec §4). */
export const TREE_RESTORE_DAYS = 30;

/** Invite links expire after this many days (spec §5). */
export const INVITE_TTL_DAYS = 7;
```

`packages/shared/src/trees.ts`:

```ts
import { z } from 'zod';
import { INVITE_ROLES, ROLES } from './permissions.js';

export const SEXES = ['female', 'male', 'other', 'unknown'] as const;
export type Sex = (typeof SEXES)[number];

export const NAME_MAX = 100;

const requiredText = (message: string) =>
  z
    .string()
    .trim()
    .min(1, message)
    .max(NAME_MAX, `Use at most ${NAME_MAX} characters`);
/** Optional text: blank becomes undefined. */
const optionalText = z
  .string()
  .trim()
  .max(NAME_MAX, `Use at most ${NAME_MAX} characters`)
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const treeNameSchema = requiredText('Enter a name for the tree');

export const quickPersonSchema = z.object({
  givenName: requiredText('Enter a first name'),
  surname: optionalText,
  sex: z.enum(SEXES).default('unknown'),
  birthYear: z
    .number()
    .int('Enter a whole year')
    .min(1, 'Enter a real year')
    .refine((y) => y <= new Date().getUTCFullYear(), 'That year is in the future')
    .optional(),
});
export type QuickPerson = z.infer<typeof quickPersonSchema>;

export const createTreeSchema = z.object({ name: treeNameSchema, person: quickPersonSchema });
export type CreateTreeInput = z.input<typeof createTreeSchema>;

export const updateTreeSchema = z
  .object({ name: treeNameSchema.optional(), rootPersonId: z.uuid().optional() })
  .refine((v) => v.name !== undefined || v.rootPersonId !== undefined, 'Nothing to change');
export type UpdateTreeInput = z.infer<typeof updateTreeSchema>;

export const roleSchema = z.enum(ROLES);
export const inviteRoleSchema = z.enum(INVITE_ROLES);

export const createInviteSchema = z.object({
  role: inviteRoleSchema,
  stewardAnchorPersonId: z.uuid().nullable().default(null),
  targetPersonId: z.uuid().nullable().default(null),
});
export type CreateInviteInput = z.input<typeof createInviteSchema>;

export const changeRoleSchema = z.object({ role: inviteRoleSchema });
export const transferSchema = z.object({ userId: z.uuid() });
export const grantStewardSchema = z.object({ userId: z.uuid(), anchorPersonId: z.uuid() });
export const inviteTokenSchema = z.object({ token: z.string().min(20).max(200) });

// ---- responses (dates are ISO strings) ----

export const treeSummarySchema = z.object({ id: z.uuid(), name: z.string(), role: roleSchema });
export const deletedTreeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  deletedAt: z.string(),
  restoreUntil: z.string(),
});
export const treeListSchema = z.object({
  trees: z.array(treeSummarySchema),
  deletedTrees: z.array(deletedTreeSchema),
});
export type TreeList = z.infer<typeof treeListSchema>;

export const createdTreeSchema = z.object({ tree: z.object({ id: z.uuid() }) });

export const treeDetailSchema = z.object({
  tree: z.object({ id: z.uuid(), name: z.string(), rootPersonId: z.uuid().nullable() }),
  me: z.object({
    role: roleSchema,
    personId: z.uuid().nullable(),
    steward: z.object({
      grants: z.array(z.object({ id: z.uuid(), anchorPersonId: z.uuid() })),
      /** False while the steward has no 2FA: grants exist but don't apply yet. */
      active: z.boolean(),
    }),
  }),
  capabilities: z.object({
    /** Add and edit anywhere (owner, editor). */
    editAnywhere: z.boolean(),
    /** Rename, change root, delete, transfer, reset links (owner). */
    manageTree: z.boolean(),
    /** Create viewer/editor invites (owner, active steward). */
    invite: z.boolean(),
    grantStewardship: z.boolean(),
  }),
});
export type TreeDetail = z.infer<typeof treeDetailSchema>;

export const personSummarySchema = z.object({
  id: z.uuid(),
  givenName: z.string(),
  middleName: z.string().nullable(),
  surname: z.string().nullable(),
  birthYear: z.number().int().nullable(),
  deathYear: z.number().int().nullable(),
  isLiving: z.boolean(),
});
export type PersonSummary = z.infer<typeof personSummarySchema>;
export const personListSchema = z.object({ persons: z.array(personSummarySchema) });

export const memberSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  role: roleSchema,
  personId: z.uuid().nullable(),
  invitedByUserId: z.uuid().nullable(),
  /** Owner only. */
  email: z.string().optional(),
  /** Owner only: needed to know who can receive ownership or a reset link. */
  twoFactorEnabled: z.boolean().optional(),
});
export type Member = z.infer<typeof memberSchema>;
export const memberListSchema = z.object({ members: z.array(memberSchema) });

export const stewardGrantSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  userName: z.string(),
  anchorPersonId: z.uuid(),
  grantedByUserId: z.uuid().nullable(),
  grantedByName: z.string().nullable(),
  parentGrantId: z.uuid().nullable(),
  active: z.boolean(),
});
export type StewardGrant = z.infer<typeof stewardGrantSchema>;
export const stewardListSchema = z.object({ stewards: z.array(stewardGrantSchema) });
export const createdIdSchema = z.object({ id: z.uuid() });

export const inviteSchema = z.object({
  id: z.uuid(),
  role: inviteRoleSchema,
  stewardAnchorPersonId: z.uuid().nullable(),
  targetPersonId: z.uuid().nullable(),
  createdByUserId: z.uuid(),
  createdByName: z.string(),
  expiresAt: z.string(),
});
export type Invite = z.infer<typeof inviteSchema>;
export const inviteListSchema = z.object({ invites: z.array(inviteSchema) });
export const createdInviteSchema = z.object({
  id: z.uuid(),
  token: z.string(),
  expiresAt: z.string(),
});
export type CreatedInvite = z.infer<typeof createdInviteSchema>;

export const invitePreviewSchema = z.object({
  treeName: z.string(),
  role: inviteRoleSchema,
  inviterName: z.string(),
  steward: z.boolean(),
  targetPersonName: z.string().nullable(),
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;
export const acceptedInviteSchema = z.object({ treeId: z.uuid() });

export const resetLinkCreatedSchema = z.object({ token: z.string(), expiresAt: z.string() });
export type ResetLinkCreated = z.infer<typeof resetLinkCreatedSchema>;
```

In `packages/shared/src/api.ts`, add `'TWO_FACTOR_REQUIRED'`, `'INVALID_INVITE'` and `'RESET_LINK_NOT_ALLOWED'` to `ERROR_CODES`, after `'INVALID_RESET'`.

In `packages/shared/src/auth.ts`, add `requiresTwoFactor: z.boolean()` to `meResponseSchema.user`. It is true when the user owns a tree or holds a steward grant.

In `packages/shared/src/index.ts`, add `export * from './permissions.js';` and `export * from './trees.js';`.

- [ ] **Step 4: Run the shared tests; all pass.** `pnpm --filter @family-tree/shared test`

  `pnpm typecheck` now fails in api and web, which don't yet send `requiresTwoFactor`. To keep the workspace green, also make these minimal edits in this task:
  - `apps/api/src/routes/me.ts`: send `requiresTwoFactor: false` (Task 10 computes it).
  - `apps/web/src/test/fake-auth.ts`: add `requiresTwoFactor: boolean` to `FakeUser` (default `false`) and include it in `getMe`'s result.

  Then run `pnpm typecheck && pnpm test`. Everything passes.

- [ ] **Step 5: Commit** `feat(shared): permission constants, tree/member/invite schemas, new error codes`

---

## Task 2: Shared — the branch rule as a pure function, with shared fixtures

The branch of anchor A (spec §4):
1. A.
2. All ancestors of A.
3. All descendants of those ancestors, including A's own descendants.
4. Partners of anyone in 1–3, unless that partner has parents recorded in the tree.
5. Any person the steward created.

Only live rows count: the graph passed in has deleted rows removed already.

**Files:**
- Create: `packages/shared/src/branch.ts`, `packages/shared/src/branch-fixtures.ts`, `packages/shared/src/branch.test.ts`
- Modify: `packages/shared/src/index.ts`, adding `export * from './branch.js'` and `export * from './branch-fixtures.js'`

- [ ] **Step 1: Write the fixtures** `packages/shared/src/branch-fixtures.ts`. The API's integration test (Task 5) loads these same fixtures into Postgres.

```ts
import type { FamilyGraph } from './branch.js';

export interface BranchCase {
  name: string;
  /** Person keys are short names; the int test maps them to real uuids. */
  graph: FamilyGraph;
  anchor: string;
  steward: string | null;
  expected: string[];
}

/**
 * The Hale family, the same shape as the dev seed (rows created by 'u1' marked):
 *   robert + margaret → david, susan
 *   david + anna (divorced) → emma
 *   david + laura → leo, mia (adoptive)
 *   susan + (unknown) → noah
 *   laura's parents: george + helen → laura
 *   leo + zoe (zoe has no parents recorded)
 *   kim: unconnected, created by u1
 */
const hale: FamilyGraph = {
  persons: [
    'robert',
    'margaret',
    'david',
    'susan',
    'anna',
    'laura',
    'emma',
    'leo',
    'mia',
    'noah',
    'george',
    'helen',
    'zoe',
  ]
    .map((id) => ({ id, createdBy: null as string | null }))
    .concat([{ id: 'kim', createdBy: 'u1' }]),
  unions: [
    { id: 'u_rm', partnerAId: 'robert', partnerBId: 'margaret' },
    { id: 'u_da', partnerAId: 'david', partnerBId: 'anna' },
    { id: 'u_dl', partnerAId: 'david', partnerBId: 'laura' },
    { id: 'u_s', partnerAId: 'susan', partnerBId: null },
    { id: 'u_gh', partnerAId: 'george', partnerBId: 'helen' },
    { id: 'u_lz', partnerAId: 'leo', partnerBId: 'zoe' },
  ],
  parentChild: [
    { unionId: 'u_rm', childId: 'david' },
    { unionId: 'u_rm', childId: 'susan' },
    { unionId: 'u_da', childId: 'emma' },
    { unionId: 'u_dl', childId: 'leo' },
    { unionId: 'u_dl', childId: 'mia' },
    { unionId: 'u_s', childId: 'noah' },
    { unionId: 'u_gh', childId: 'laura' },
  ],
};

const HALE_SIDE = [
  'robert',
  'margaret',
  'david',
  'susan',
  'anna',
  'emma',
  'leo',
  'mia',
  'noah',
  'zoe',
];

export const BRANCH_CASES: BranchCase[] = [
  {
    name: 'anchor on a grandchild covers both parents’ sides (all ancestors count)',
    graph: hale,
    anchor: 'leo',
    steward: null,
    // Leo's ancestors are David, Laura, Robert, Margaret, George and Helen; everyone except
    // Kim (unconnected) descends from or partners with them.
    expected: [...HALE_SIDE, 'laura', 'george', 'helen'],
  },
  {
    name: 'anchor on Laura covers her parents side and her own descendants',
    graph: hale,
    anchor: 'laura',
    steward: null,
    // Laura, her parents, their descendants (Laura, Leo, Mia), and partners without parents:
    // David has parents (excluded), Zoe has none (included).
    expected: ['laura', 'george', 'helen', 'leo', 'mia', 'zoe'],
  },
  {
    name: 'anchor at the top covers everyone below plus parentless partners, not Laura (she has parents)',
    graph: hale,
    anchor: 'robert',
    steward: null,
    expected: HALE_SIDE,
  },
  {
    name: 'a partner without parents is included, but their own other relatives are not',
    graph: hale,
    anchor: 'anna',
    steward: null,
    // Anna has no parents: her ancestors are just Anna; descendants: Emma. Partner David has
    // parents, so he is excluded.
    expected: ['anna', 'emma'],
  },
  {
    name: 'people the steward created are always included',
    graph: hale,
    anchor: 'anna',
    steward: 'u1',
    expected: ['anna', 'emma', 'kim'],
  },
  {
    name: 'an unknown anchor yields only created people',
    graph: hale,
    anchor: 'nobody',
    steward: 'u1',
    expected: ['kim'],
  },
];
```

- [ ] **Step 2: Write the failing test** `packages/shared/src/branch.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { branchOf } from './branch.js';
import { BRANCH_CASES } from './branch-fixtures.js';

describe('branchOf', () => {
  for (const c of BRANCH_CASES) {
    it(c.name, () => {
      expect([...branchOf(c.graph, c.anchor, c.steward)].sort()).toEqual([...c.expected].sort());
    });
  }

  it('terminates on a cycle (bad data must not hang the server)', () => {
    const graph = {
      persons: [
        { id: 'a', createdBy: null },
        { id: 'b', createdBy: null },
      ],
      unions: [
        { id: 'ua', partnerAId: 'a', partnerBId: null },
        { id: 'ub', partnerAId: 'b', partnerBId: null },
      ],
      parentChild: [
        { unionId: 'ua', childId: 'b' },
        { unionId: 'ub', childId: 'a' },
      ],
    };
    expect([...branchOf(graph, 'a', null)].sort()).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 3: Run it; it fails.**

- [ ] **Step 4: Implement** `packages/shared/src/branch.ts`

```ts
export interface FamilyGraph {
  persons: readonly { id: string; createdBy: string | null }[];
  unions: readonly { id: string; partnerAId: string | null; partnerBId: string | null }[];
  parentChild: readonly { unionId: string; childId: string }[];
}

function walk(start: Iterable<string>, next: Map<string, string[]>): Set<string> {
  const seen = new Set(start);
  const queue = [...seen];
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    for (const n of next.get(id) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen;
}

const push = (m: Map<string, string[]>, k: string, v: string) => {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
};

/**
 * The branch of `anchorId` (spec §4). Pure twin of the API's SQL `branchQuery`; both are tested
 * against BRANCH_CASES. `graph` must contain live rows only.
 */
export function branchOf(
  graph: FamilyGraph,
  anchorId: string,
  stewardUserId: string | null,
): Set<string> {
  const live = new Set(graph.persons.map((p) => p.id));
  const unionById = new Map(graph.unions.map((u) => [u.id, u]));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const pc of graph.parentChild) {
    const u = unionById.get(pc.unionId);
    if (!u) continue;
    for (const p of [u.partnerAId, u.partnerBId]) {
      if (p === null) continue;
      push(parents, pc.childId, p);
      push(children, p, pc.childId);
    }
  }

  const ancestors = walk([anchorId], parents);
  const core = new Set([...walk(ancestors, children)].filter((id) => live.has(id)));
  const result = new Set(core);
  for (const u of graph.unions) {
    for (const [self, other] of [
      [u.partnerAId, u.partnerBId],
      [u.partnerBId, u.partnerAId],
    ] as const) {
      if (self !== null && other !== null && core.has(self) && live.has(other)) {
        if (!parents.has(other)) result.add(other);
      }
    }
  }
  if (stewardUserId !== null) {
    for (const p of graph.persons) if (p.createdBy === stewardUserId) result.add(p.id);
  }
  return result;
}
```

- [ ] **Step 5: Run the shared tests; they pass.** `pnpm --filter @family-tree/shared test`

- [ ] **Step 6: Commit** `feat(shared): branch rule as a pure function with shared fixtures`

---

## Task 3: Database — tree access tables (migration 0002)

**Files:**
- Modify: `apps/api/src/db/schema.ts`, `apps/api/src/db/client.ts`
- Generated: `apps/api/drizzle/0002_tree_access.sql`, `apps/api/drizzle/meta/*`
- Create: `apps/api/src/db/tree-access-schema.int.test.ts`

- [ ] **Step 1: Add the types** to `apps/api/src/db/client.ts`

```ts
/** A transaction handle; same query API as Db. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Anything queries can run on: the pool or an open transaction. */
export type Queryable = Db | Tx;
```

- [ ] **Step 2: Schema changes** in `apps/api/src/db/schema.ts`.

  - **persons:** add two columns. They're nullable and keep the person if the user is deleted. Rule 5 of the branch reads `created_by`.

    ```ts
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    ```

    Also add `index('persons_created_by_idx').on(t.treeId, t.createdBy)`.

  - **reset_links:** add the column and replace the "Phase 3 adds tree_id" comment with "Set when a tree owner issued the link; null for the dev CLI":

    ```ts
    treeId: uuid('tree_id').references(() => trees.id, { onDelete: 'cascade' }),
    ```

  - **New tables:** append them at the end of the file. Import `primaryKey` and `type AnyPgColumn` from `drizzle-orm/pg-core`.

```ts
// ---------------------------------------------------------------------------------------------
// Tree access (spec §3, §4).

export const memberRoleEnum = pgEnum('member_role', ['owner', 'editor', 'viewer']);

/** The single source of truth for who may see a tree and in which role. */
export const treeMembers = pgTable(
  'tree_members',
  {
    treeId: uuid('tree_id')
      .notNull()
      .references(() => trees.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull(),
    /** The member's own card in this tree. */
    personId: uuid('person_id'),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...authTimestamps(),
  },
  (t) => [
    primaryKey({ name: 'tree_members_pk', columns: [t.treeId, t.userId] }),
    // Exactly one owner per tree.
    uniqueIndex('tree_members_one_owner_uq')
      .on(t.treeId)
      .where(sql`${t.role} = 'owner'`),
    // A person card belongs to at most one login.
    uniqueIndex('tree_members_person_uq')
      .on(t.treeId, t.personId)
      .where(sql`${t.personId} is not null`),
    // NO ACTION: persons are only soft-deleted; phase 4's permanent erase must unlink first.
    foreignKey({
      name: 'tree_members_person_fk',
      columns: [t.treeId, t.personId],
      foreignColumns: [persons.treeId, persons.id],
    }),
    index('tree_members_user_idx').on(t.userId),
  ],
);

export const branchStewards = pgTable(
  'branch_stewards',
  {
    id: id(),
    treeId: uuid('tree_id').notNull(),
    userId: uuid('user_id').notNull(),
    anchorPersonId: uuid('anchor_person_id').notNull(),
    grantedByUserId: uuid('granted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** The granter's grant this one derives from; null when the owner granted it. */
    parentGrantId: uuid('parent_grant_id').references((): AnyPgColumn => branchStewards.id, {
      onDelete: 'cascade',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A grant only exists while its holder is a member; removing the member removes it.
    foreignKey({
      name: 'branch_stewards_member_fk',
      columns: [t.treeId, t.userId],
      foreignColumns: [treeMembers.treeId, treeMembers.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'branch_stewards_anchor_fk',
      columns: [t.treeId, t.anchorPersonId],
      foreignColumns: [persons.treeId, persons.id],
    }).onDelete('cascade'),
    unique('branch_stewards_user_anchor_uq').on(t.treeId, t.userId, t.anchorPersonId),
    index('branch_stewards_parent_idx').on(t.parentGrantId),
  ],
);

export const invites = pgTable(
  'invites',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    treeId: uuid('tree_id')
      .notNull()
      .references(() => trees.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull(),
    stewardAnchorPersonId: uuid('steward_anchor_person_id'),
    targetPersonId: uuid('target_person_id'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    usedByUserId: uuid('used_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('invites_not_owner', sql`${t.role} <> 'owner'`),
    foreignKey({
      name: 'invites_anchor_fk',
      columns: [t.treeId, t.stewardAnchorPersonId],
      foreignColumns: [persons.treeId, persons.id],
    }),
    foreignKey({
      name: 'invites_target_fk',
      columns: [t.treeId, t.targetPersonId],
      foreignColumns: [persons.treeId, persons.id],
    }),
    index('invites_tree_idx').on(t.treeId),
  ],
);
```

  `authTimestamps` is declared further up the file, in the auth section, so these tables must come after it. `persons` references `users` through a thunk, which is fine at runtime.

- [ ] **Step 3: Generate the migration.** Run `pnpm --filter @family-tree/api exec drizzle-kit generate --name tree_access`.

  Open `apps/api/drizzle/0002_tree_access.sql` and check:
  - The enum, three tables, the columns and the FKs are all there.
  - `branch_stewards_member_fk` comes after the `tree_members` PK. If drizzle orders the statements wrongly, move the `ALTER TABLE … ADD CONSTRAINT` lines to the end of the file.
  - `tree_members_one_owner_uq` has `WHERE "tree_members"."role" = 'owner'`.

- [ ] **Step 4: Write the integration test** `apps/api/src/db/tree-access-schema.int.test.ts`. Use the same structure as `schema.int.test.ts`: `createDeps(loadConfig())` and `afterAll` cleanup.
  - **Setup:** insert two users directly (`db.insert(users)`), a tree and a person.
  - **Test cases** (each asserts a rejected insert with `await expect(…).rejects.toThrow()`, or an accepted one):
    1. A second `owner` row in the same tree is rejected (`tree_members_one_owner_uq`); a second `editor` is fine.
    2. Two members can't claim the same `person_id` in one tree.
    3. A `tree_members.person_id` from another tree is rejected (composite FK).
    4. Deleting a member row deletes their `branch_stewards` rows.
    5. Deleting a grant deletes grants whose `parent_grant_id` points at it, recursively (grant → child → grandchild).
    6. An invite with `role = 'owner'` is rejected (`invites_not_owner`).
    7. Deleting the tree removes members, grants and invites (cascade).
    8. Deleting a user sets `persons.created_by` to null and keeps the person.

- [ ] **Step 5: Run it** and `pnpm test:int`; all pass, including the phase 1 and 2 suites. Migrations run in the global setup.

- [ ] **Step 6: Commit** `feat(db): tree members, branch stewards, invites; persons.created_by; reset_links.tree_id`

---

## Task 4: API — config, error helpers, tokens, shared rate-limit helper

**Files:**
- Modify: `apps/api/src/config.ts`, `apps/api/src/config.test.ts`, `.env.development`, `.env.production.example`, `apps/api/src/errors.ts`, `apps/api/src/errors.test.ts`, `apps/api/src/auth/reset-links.ts`, `apps/api/src/routes/password-reset.ts`, `apps/api/test/auth-helpers.ts`
- Create: `apps/api/src/security/tokens.ts`, `apps/api/src/security/limits.ts`

- [ ] **Step 1: Failing tests.**
  - **`config.test.ts`:**
    - `MAX_TREES_PER_USER` defaults to 3.
    - `'5'` coerces to 5.
    - `0` and `101` are rejected.
  - **`errors.test.ts`:**
    - `idParam({ treeId: 'not-a-uuid' }, 'treeId')` throws an `AppError` with `statusCode` 404 and code `NOT_FOUND`.
    - A valid uuid is returned.
    - `forbidden()` has status 403 and code `FORBIDDEN`.

- [ ] **Step 2: Implement.**

  `config.ts`, inside the object:

  ```ts
  // Spec §3: how many non-deleted trees one user may own.
  MAX_TREES_PER_USER: z.coerce.number().int().min(1).max(100).default(3),
  ```

  Add `MAX_TREES_PER_USER=3` to `.env.development`, and to `.env.production.example` with a comment line above it.

  `errors.ts`:

  ```ts
  export const notFound = () => new AppError('NOT_FOUND', 404, 'Not found');
  export const forbidden = (message = 'You don’t have permission to do that') =>
    new AppError('FORBIDDEN', 403, message);

  /** A uuid route parameter. Anything else is a 404: it can't name a row the user may see. */
  export function idParam(params: unknown, key: string): string {
    const parsed = z.uuid().safeParse((params as Record<string, unknown> | null)?.[key]);
    if (!parsed.success) throw notFound();
    return parsed.data;
  }
  ```

  `security/tokens.ts`:

  ```ts
  import { createHash, randomBytes } from 'node:crypto';

  /** 32 random bytes, URL-safe. Only hashToken(token) is ever stored (spec §8). */
  export const newToken = () => randomBytes(32).toString('base64url');
  export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
  ```

  `auth/reset-links.ts`:
  - Use these helpers, keeping `export const hashResetToken = hashToken` so the existing tests still compile.
  - Add an optional `treeId?: string | null` (default null) to `createResetLink`'s input and insert it.

  `security/limits.ts`: move `clientKey` and the `perIpLimit` logic out of `password-reset.ts` and generalise them:

  ```ts
  import { normalizeIP } from '@fastify/rate-limit';
  import type { FastifyInstance, FastifyRequest } from 'fastify';
  import { AppError } from '../errors.js';

  /** IPv6 collapses to its /64 (as @fastify/rate-limit's default key does). */
  export const clientKey = (req: FastifyRequest) => normalizeIP(req.ip);

  export const rateLimited = () =>
    new AppError('RATE_LIMITED', 429, 'Too many requests, try again later');

  /**
   * A preHandler enforcing an extra limit on top of the global one. Built with createRateLimit,
   * not app.rateLimit: handlers from app.rateLimit share a "limit already ran" flag with the
   * route-level limit, so whichever ran first would silently disable the other.
   * `by` picks the bucket: the client IP (default) or the signed-in user.
   */
  export function extraLimit(
    app: FastifyInstance,
    {
      name,
      max,
      timeWindow,
      by = 'ip',
    }: { name: string; max: number; timeWindow: string; by?: 'ip' | 'user' },
  ) {
    const check = app.createRateLimit({
      max,
      timeWindow,
      keyGenerator: (req) =>
        `${name}:${by === 'user' && req.user ? `u:${req.user.id}` : `ip:${clientKey(req)}`}`,
    });
    return async (req: FastifyRequest) => {
      const result = await check(req);
      if (!result.isAllowed && result.isExceeded) throw rateLimited();
    };
  }
  ```

  In `password-reset.ts`:
  - Replace `perIpLimit(20)` with `extraLimit(app, { name: \`reset-ip:/api/v1/password-reset/totp\`, max: 20, timeWindow: '15 minutes' })`, and do the same for the link route (`max: 10`).
  - The key text changes from `reset-ip:${req.routeOptions.url}:…`. That's fine: buckets only live in memory.
  - Delete the old local helpers and keep `normalisedEmailOrIp` (it now imports `clientKey`).

  `test/auth-helpers.ts`: widen `call`'s method to `'GET' | 'POST' | 'PATCH' | 'DELETE'`. Send the JSON body and content-type for every non-GET method; `body ?? {}` keeps DELETE bodies valid JSON.

- [ ] **Step 3: Run** `pnpm --filter @family-tree/api test` and `pnpm test:int`. Everything passes; the password-reset suite proves the refactor kept the limits.

- [ ] **Step 4: Commit** `refactor(api): token + rate-limit helpers; MAX_TREES_PER_USER; idParam/forbidden`

---

## Task 5: API — branch CTE, proven equal to `branchOf`

**Files:**
- Create: `apps/api/src/trees/branch.ts`, `apps/api/src/trees/branch.int.test.ts`

- [ ] **Step 1: Write the failing integration test** `apps/api/src/trees/branch.int.test.ts`. For each case in `BRANCH_CASES`:
  1. Insert a fresh tree.
  2. Insert one user per distinct `createdBy` value (`u1`), mapped to a real user id.
  3. Insert persons, mapping each key to the generated uuid and setting `createdBy`.
  4. Insert unions and parent_child rows with the mapped ids.
  5. Run `branchPersonIds(db, treeId, mappedAnchor, mappedSteward)`. For `'nobody'`, use `randomUUID()`.
  6. Map the result back to keys, then compare it, sorted, with `expected`.

  Add three more cases that only SQL can check:
  - **Deleted person:** soft-delete Zoe (`deletedAt: new Date()`). The branch of Robert no longer contains `zoe`.
  - **Deleted link:** soft-delete the `parent_child` row (george+helen → laura). Laura now has no recorded parents, so the branch of Robert includes `laura` (as David's parentless partner) and still excludes `george` and `helen`.
  - **Other trees:** a person in another tree with `created_by = u1` is never included.

  Clean up with `db.delete(trees)` in `afterAll`. Users are deleted too.

- [ ] **Step 2: Run it; it fails.**

- [ ] **Step 3: Implement** `apps/api/src/trees/branch.ts`

```ts
import { sql } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';

/**
 * Person ids in the branch of `anchorId` (spec §4), live rows only. Twin of branchOf() in
 * packages/shared; both are tested against BRANCH_CASES.
 *  1–3: the anchor's ancestors and all their descendants, via live parent_child links of live
 *       unions (any kind: biological, adoptive, step, foster);
 *  4:   partners (in live unions) of those people, unless the partner has parents recorded;
 *  5:   live people the steward created.
 * UNION (not UNION ALL) in the recursive parts makes cycles in bad data terminate.
 */
export function branchQuery(treeId: string, anchorId: string, stewardUserId: string | null) {
  return sql`
    with recursive
      parent_edges as (
        select pc.child_id, p.parent_id
        from parent_child pc
        join unions u on u.id = pc.union_id and u.deleted_at is null
        cross join lateral (values (u.partner_a_id), (u.partner_b_id)) as p(parent_id)
        where pc.tree_id = ${treeId} and pc.deleted_at is null and p.parent_id is not null
      ),
      ancestors(id) as (
        select ${anchorId}::uuid
        union
        select pe.parent_id from parent_edges pe join ancestors a on pe.child_id = a.id
      ),
      descendants(id) as (
        select id from ancestors
        union
        select pe.child_id from parent_edges pe join descendants d on pe.parent_id = d.id
      ),
      core as (
        select p.id from persons p join descendants d on d.id = p.id
        where p.tree_id = ${treeId} and p.deleted_at is null
      ),
      partners as (
        select case when u.partner_a_id = c.id then u.partner_b_id else u.partner_a_id end as id
        from unions u join core c on c.id in (u.partner_a_id, u.partner_b_id)
        where u.tree_id = ${treeId} and u.deleted_at is null
      )
    select id from core
    union
    select pt.id from partners pt
      join persons p on p.id = pt.id and p.tree_id = ${treeId} and p.deleted_at is null
      where not exists (select 1 from parent_edges pe where pe.child_id = pt.id)
    union
    select p.id from persons p
      where p.tree_id = ${treeId} and p.deleted_at is null
        and ${stewardUserId}::uuid is not null and p.created_by = ${stewardUserId}::uuid
  `;
}

export async function branchPersonIds(
  db: Queryable,
  treeId: string,
  anchorId: string,
  stewardUserId: string | null,
): Promise<Set<string>> {
  const rows = (await db.execute(branchQuery(treeId, anchorId, stewardUserId))) as unknown as {
    id: string;
  }[];
  return new Set(rows.map((r) => r.id));
}
```

- [ ] **Step 4: Run the test; it passes.** If Postgres rejects the second recursive CTE referencing the first, rewrite `descendants` so its non-recursive term is `select id from ancestors` inside a subquery. The SQL above is valid on Postgres 17; that rewrite is only needed on older versions.

- [ ] **Step 5: Commit** `feat(api): branch CTE matching the shared branch rule`

---

## Task 6: API — `can()`, the permission matrix

**Files:**
- Create: `apps/api/src/permissions/can.ts`, `apps/api/src/permissions/can.test.ts`

- [ ] **Step 1: Write the failing test**. It checks every row of the spec §4 matrix for each actor kind:
  - owner
  - editor
  - viewer
  - an active steward with a viewer base role, inside the scope and outside it
  - an active steward with an editor base role

```ts
import { describe, expect, it } from 'vitest';
import { type Action, type Actor, can, type Targets } from './can.js';

const IN = 'p-in';
const OUT = 'p-out';
const grant = { id: 'g1', anchorPersonId: IN, scope: new Set([IN, 'p-in-2']) };
const owner: Actor = { userId: 'owner', role: 'owner', grants: [] };
const editor: Actor = { userId: 'editor', role: 'editor', grants: [] };
const viewer: Actor = { userId: 'viewer', role: 'viewer', grants: [] };
const steward: Actor = { userId: 'steward', role: 'viewer', grants: [grant] };
const editorSteward: Actor = { userId: 'es', role: 'editor', grants: [grant] };
const TREE = { kind: 'tree' } as const;

type Row = { [A in Action]: [A, Targets[A], [boolean, boolean, boolean, boolean, boolean]] }[Action];
//                                         owner   editor  viewer  steward editorSteward
const ROWS: Row[] = [
  ['tree.view', TREE, [true, true, true, true, true]],
  ['tree.rename', TREE, [true, false, false, false, false]],
  ['tree.changeRoot', TREE, [true, false, false, false, false]],
  ['tree.delete', TREE, [true, false, false, false, false]],
  ['tree.restore', TREE, [true, false, false, false, false]],
  ['tree.transfer', TREE, [true, false, false, false, false]],
  ['tree.export', TREE, [true, false, false, false, false]],
  ['trash.view', TREE, [true, false, false, false, false]],
  ['trash.restore', TREE, [true, false, false, false, false]],
  ['trash.erase', TREE, [true, false, false, false, false]],
  ['members.viewDetails', TREE, [true, false, false, false, false]],
  ['member.resetLink', TREE, [true, false, false, false, false]],
  ['invites.viewAll', TREE, [true, false, false, false, false]],
  ['person.add', { kind: 'relation', ends: [IN] }, [true, true, false, true, true]],
  ['person.add', { kind: 'relation', ends: [OUT] }, [true, true, false, false, true]],
  ['person.add', { kind: 'relation', ends: [] }, [true, true, false, false, true]],
  ['person.edit', { kind: 'person', personId: IN }, [true, true, false, true, true]],
  ['person.edit', { kind: 'person', personId: OUT }, [true, true, false, false, true]],
  ['relation.add', { kind: 'relation', ends: [OUT, IN] }, [true, true, false, true, true]],
  ['relation.edit', { kind: 'relation', ends: [OUT] }, [true, true, false, false, true]],
  ['person.delete', { kind: 'people', personIds: [IN, 'p-in-2'] }, [true, false, false, true, true]],
  ['person.delete', { kind: 'people', personIds: [IN, OUT] }, [true, false, false, false, false]],
  ['person.delete', { kind: 'people', personIds: [] }, [true, false, false, false, false]],
  ['relation.delete', { kind: 'people', personIds: [IN, OUT] }, [true, false, false, false, false]],
  ['relation.delete', { kind: 'people', personIds: [IN] }, [true, false, false, true, true]],
  [
    'invite.create',
    { kind: 'invite', role: 'editor', stewardAnchorPersonId: null, targetPersonId: null },
    [true, false, false, true, true],
  ],
  [
    'invite.create',
    { kind: 'invite', role: 'viewer', stewardAnchorPersonId: IN, targetPersonId: null },
    [true, false, false, true, true],
  ],
  [
    'invite.create',
    { kind: 'invite', role: 'viewer', stewardAnchorPersonId: OUT, targetPersonId: null },
    [true, false, false, false, false],
  ],
  ['steward.grant', { kind: 'anchor', personId: IN }, [true, false, false, true, true]],
  ['steward.grant', { kind: 'anchor', personId: OUT }, [true, false, false, false, false]],
];

const ACTORS = [owner, editor, viewer, steward, editorSteward];

describe('can: permission matrix (spec §4)', () => {
  for (const [action, target, expected] of ROWS) {
    it(`${action} ${JSON.stringify(target)}`, () => {
      expect(ACTORS.map((a) => can(a, action, target as never))).toEqual(expected);
    });
  }
});

describe('can: rules that depend on who made something', () => {
  it('invite.revoke: owner any; a steward with an active grant only their own', () => {
    const t = { kind: 'ownInvite', createdByUserId: 'steward' } as const;
    expect(can(owner, 'invite.revoke', t)).toBe(true);
    expect(can(steward, 'invite.revoke', t)).toBe(true);
    expect(can(editorSteward, 'invite.revoke', t)).toBe(false);
    expect(can(editor, 'invite.revoke', t)).toBe(false);
  });
  it('invite.revoke: a former steward (no active grants) cannot revoke their own invite', () => {
    const former: Actor = { userId: 'steward', role: 'viewer', grants: [] };
    expect(can(former, 'invite.revoke', { kind: 'ownInvite', createdByUserId: 'steward' })).toBe(
      false,
    );
  });
  it('steward.revoke: owner any, a steward only grants they made', () => {
    const mine = { kind: 'grant', grantedByUserId: 'steward' } as const;
    const ownerMade = { kind: 'grant', grantedByUserId: 'owner' } as const;
    expect(can(owner, 'steward.revoke', ownerMade)).toBe(true);
    expect(can(steward, 'steward.revoke', mine)).toBe(true);
    expect(can(steward, 'steward.revoke', ownerMade)).toBe(false);
    // A former owner (now a plain editor after a transfer) can't revoke grants they once made.
    expect(can(editor, 'steward.revoke', { kind: 'grant', grantedByUserId: 'editor' })).toBe(false);
  });
  it('member.changeRole / member.remove: owner any non-owner; steward only people they invited', () => {
    const invitedBySteward = { kind: 'member', role: 'viewer', invitedByUserId: 'steward' } as const;
    const invitedByOwner = { kind: 'member', role: 'editor', invitedByUserId: 'owner' } as const;
    const theOwner = { kind: 'member', role: 'owner', invitedByUserId: null } as const;
    for (const action of ['member.changeRole', 'member.remove'] as const) {
      expect(can(owner, action, invitedByOwner)).toBe(true);
      expect(can(owner, action, theOwner)).toBe(false);
      expect(can(steward, action, invitedBySteward)).toBe(true);
      expect(can(steward, action, invitedByOwner)).toBe(false);
      expect(can(editor, action, invitedBySteward)).toBe(false);
      // A former steward (no grants left) no longer manages the people they invited.
      expect(can({ ...steward, grants: [] }, action, invitedBySteward)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it; it fails.**

- [ ] **Step 3: Implement** `apps/api/src/permissions/can.ts`

```ts
import type { InviteRole, Role } from '@family-tree/shared';

/** An effective steward grant: only loaded for stewards with 2FA (spec §4). */
export interface Grant {
  id: string;
  anchorPersonId: string;
  /** Person ids this grant covers: branch(anchor) ∩ scope of its parent grant. */
  scope: ReadonlySet<string>;
}

export interface Actor {
  userId: string;
  role: Role;
  grants: readonly Grant[];
}

type TreeTarget = { kind: 'tree' };
type RelationTarget = { kind: 'relation'; ends: readonly string[] };
type PeopleTarget = { kind: 'people'; personIds: readonly string[] };
type MemberTarget = { kind: 'member'; role: Role; invitedByUserId: string | null };

/** What each action is checked against. */
export interface Targets {
  'tree.view': TreeTarget;
  'tree.rename': TreeTarget;
  'tree.changeRoot': TreeTarget;
  'tree.delete': TreeTarget;
  'tree.restore': TreeTarget;
  'tree.transfer': TreeTarget;
  'tree.export': TreeTarget;
  'trash.view': TreeTarget;
  'trash.restore': TreeTarget;
  'trash.erase': TreeTarget;
  /** Member emails and 2FA status. */
  'members.viewDetails': TreeTarget;
  'member.resetLink': TreeTarget;
  'invites.viewAll': TreeTarget;
  /** Ends: the people the new person is attached to (empty: added unattached). */
  'person.add': RelationTarget;
  'person.edit': { kind: 'person'; personId: string };
  'relation.add': RelationTarget;
  'relation.edit': RelationTarget;
  /** Every person the delete touches: the preview's people plus the ends of ended relations. */
  'person.delete': PeopleTarget;
  /** Both ends of the relation. */
  'relation.delete': PeopleTarget;
  'invite.create': {
    kind: 'invite';
    role: InviteRole;
    stewardAnchorPersonId: string | null;
    targetPersonId: string | null;
  };
  'invite.revoke': { kind: 'ownInvite'; createdByUserId: string };
  'steward.grant': { kind: 'anchor'; personId: string };
  'steward.revoke': { kind: 'grant'; grantedByUserId: string | null };
  'member.changeRole': MemberTarget;
  'member.remove': MemberTarget;
}
export type Action = keyof Targets;

export const TREE: TreeTarget = { kind: 'tree' };

const isOwner = (a: Actor) => a.role === 'owner';
const editsAnywhere = (a: Actor) => a.role === 'owner' || a.role === 'editor';
const isSteward = (a: Actor) => a.grants.length > 0;
export const inScope = (a: Actor, personId: string) => a.grants.some((g) => g.scope.has(personId));

const ownerOnly = (a: Actor) => isOwner(a);
const addOrEdit = (a: Actor, t: RelationTarget) =>
  editsAnywhere(a) || t.ends.some((e) => inScope(a, e));
const deletePeople = (a: Actor, t: PeopleTarget) =>
  isOwner(a) || (t.personIds.length > 0 && t.personIds.every((p) => inScope(a, p)));
const manageMember = (a: Actor, t: MemberTarget) =>
  t.role !== 'owner' && (isOwner(a) || (isSteward(a) && t.invitedByUserId === a.userId));

const RULES: { [A in Action]: (actor: Actor, target: Targets[A]) => boolean } = {
  'tree.view': () => true,
  'tree.rename': ownerOnly,
  'tree.changeRoot': ownerOnly,
  'tree.delete': ownerOnly,
  'tree.restore': ownerOnly,
  'tree.transfer': ownerOnly,
  'tree.export': ownerOnly,
  'trash.view': ownerOnly,
  'trash.restore': ownerOnly,
  'trash.erase': ownerOnly,
  'members.viewDetails': ownerOnly,
  'member.resetLink': ownerOnly,
  'invites.viewAll': ownerOnly,
  'person.add': addOrEdit,
  'person.edit': (a, t) => editsAnywhere(a) || inScope(a, t.personId),
  'relation.add': addOrEdit,
  'relation.edit': addOrEdit,
  'person.delete': deletePeople,
  'relation.delete': deletePeople,
  'invite.create': (a, t) =>
    isOwner(a) ||
    (isSteward(a) &&
      (t.stewardAnchorPersonId === null || inScope(a, t.stewardAnchorPersonId)) &&
      (t.targetPersonId === null || inScope(a, t.targetPersonId))),
  'invite.revoke': (a, t) => isOwner(a) || (isSteward(a) && t.createdByUserId === a.userId),
  'steward.grant': (a, t) => isOwner(a) || inScope(a, t.personId),
  'steward.revoke': (a, t) => isOwner(a) || (isSteward(a) && t.grantedByUserId === a.userId),
  'member.changeRole': manageMember,
  'member.remove': manageMember,
};

/**
 * The single authorisation check (spec §4). Every tree route calls it; nothing relies on the UI
 * hiding buttons. Outside their branch a steward acts with their base role.
 */
export function can<A extends Action>(actor: Actor, action: A, target: Targets[A]): boolean {
  return RULES[action](actor, target);
}
```

- [ ] **Step 4: Run the tests; they pass.**

- [ ] **Step 5: Commit** `feat(api): can() with the full permission matrix`

---

## Task 7: API — loading access, plus test helpers

**Files:**
- Create: `apps/api/src/trees/access.ts`, `apps/api/src/trees/roles.ts`, `apps/api/src/trees/access.int.test.ts`, `apps/api/test/tree-helpers.ts`

- [ ] **Step 1: Implement** `apps/api/src/trees/access.ts`. Write it first, because the test helpers use its types.

```ts
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { branchStewards, treeMembers, trees, users } from '../db/schema.js';
import { forbidden, notFound } from '../errors.js';
import { type Action, type Actor, can, type Grant, inScope, type Targets } from '../permissions/can.js';
import { branchPersonIds } from './branch.js';

export interface Access extends Actor {
  treeId: string;
  treeName: string;
  rootPersonId: string | null;
  personId: string | null;
  twoFactorEnabled: boolean;
  /** Grants held, including ones not yet effective because 2FA is off. */
  heldGrants: { id: string; anchorPersonId: string }[];
  deletedAt: Date | null;
}

/**
 * The user's access to a tree, or a 404 if they aren't a member or the tree is deleted (pass
 * includeDeleted for the restore route). Steward scopes are computed here: each grant's scope is
 * branch(anchor, grantee) intersected with every ancestor grant's branch (spec §4).
 */
export async function loadAccess(
  db: Queryable,
  treeId: string,
  userId: string,
  { includeDeleted = false } = {},
): Promise<Access> {
  const [row] = await db
    .select({
      treeName: trees.name,
      rootPersonId: trees.rootPersonId,
      deletedAt: trees.deletedAt,
      role: treeMembers.role,
      personId: treeMembers.personId,
      twoFactorEnabled: users.twoFactorEnabled,
    })
    .from(treeMembers)
    .innerJoin(trees, eq(trees.id, treeMembers.treeId))
    .innerJoin(users, eq(users.id, treeMembers.userId))
    .where(
      and(
        eq(treeMembers.treeId, treeId),
        eq(treeMembers.userId, userId),
        includeDeleted ? undefined : isNull(trees.deletedAt),
      ),
    );
  if (!row) throw notFound();

  const held =
    row.role === 'owner'
      ? []
      : await db
          .select({ id: branchStewards.id, anchorPersonId: branchStewards.anchorPersonId })
          .from(branchStewards)
          .where(and(eq(branchStewards.treeId, treeId), eq(branchStewards.userId, userId)));

  const grants: Grant[] = [];
  if (row.twoFactorEnabled && row.deletedAt === null) {
    const branches = new Map<string, Promise<Set<string>>>();
    const branch = (anchor: string, user: string) => {
      const key = `${anchor}:${user}`;
      let p = branches.get(key);
      if (!p) branches.set(key, (p = branchPersonIds(db, treeId, anchor, user)));
      return p;
    };
    for (const g of held) {
      const chain = (await db.execute(sql`
        with recursive chain as (
          select id, user_id, anchor_person_id, parent_grant_id from branch_stewards where id = ${g.id}
          union all
          select b.id, b.user_id, b.anchor_person_id, b.parent_grant_id
          from branch_stewards b join chain c on b.id = c.parent_grant_id
        )
        select user_id, anchor_person_id from chain
      `)) as unknown as { user_id: string; anchor_person_id: string }[];
      let scope: Set<string> | undefined;
      for (const link of chain) {
        const b = await branch(link.anchor_person_id, link.user_id);
        scope = scope ? new Set([...scope].filter((id) => b.has(id))) : b;
      }
      grants.push({ id: g.id, anchorPersonId: g.anchorPersonId, scope: scope ?? new Set() });
    }
  }

  return {
    userId,
    treeId,
    treeName: row.treeName,
    rootPersonId: row.rootPersonId,
    personId: row.personId,
    role: row.role,
    twoFactorEnabled: row.twoFactorEnabled,
    heldGrants: held,
    grants,
    deletedAt: row.deletedAt,
  };
}

/** Throws FORBIDDEN unless can() allows it. */
export function authorize<A extends Action>(access: Access, action: A, target: Targets[A]) {
  if (!can(access, action, target)) throw forbidden();
}

/** The actor's grant whose scope covers `personId`: the parent for a grant they make. */
export function grantCovering(actor: Actor, personId: string): Grant | undefined {
  return actor.grants.find((g) => g.scope.has(personId));
}

export { inScope };
```

  `apps/api/src/trees/roles.ts`:

```ts
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { branchStewards, treeMembers, trees } from '../db/schema.js';

/** Owners (of any tree, even a deleted one) and stewards must keep 2FA on (spec §5). */
export async function holdsTwoFactorRole(db: Queryable, userId: string): Promise<boolean> {
  const [row] = (await db.execute(sql`
    select exists (select 1 from ${treeMembers} where user_id = ${userId} and role = 'owner')
        or exists (select 1 from ${branchStewards} where user_id = ${userId}) as held
  `)) as unknown as { held: boolean }[];
  return row?.held ?? false;
}

/** Account deletion is blocked while the user owns a non-deleted tree (spec §5). */
export async function ownsLiveTree(db: Queryable, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: trees.id })
    .from(treeMembers)
    .innerJoin(trees, eq(trees.id, treeMembers.treeId))
    .where(and(eq(treeMembers.userId, userId), eq(treeMembers.role, 'owner'), isNull(trees.deletedAt)))
    .limit(1);
  return rows.length > 0;
}
```

- [ ] **Step 2: Test helpers** `apps/api/test/tree-helpers.ts`. The route tests use these. `ownerWithTree` goes through the real `POST /api/v1/trees` (Task 8). The others write straight to the DB, so access tests can set up any situation.

```ts
import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/db/client.js';
import { branchStewards, parentChild, persons, treeMembers, unions } from '../src/db/schema.js';
import { call, enableTwoFactor, signUp } from './auth-helpers.js';

export async function userWith2fa(app: FastifyInstance, name = 'Test User') {
  const user = await signUp(app, { name });
  const tf = await enableTwoFactor(app, user.jar, user.password);
  return { ...user, ...tf };
}

/** A user with 2FA who owns a new tree whose root is their own card. */
export async function ownerWithTree(app: FastifyInstance, treeName = 'Test tree') {
  const owner = await userWith2fa(app, 'Owner');
  const res = await call(app, 'POST', '/api/v1/trees', {
    jar: owner.jar,
    body: { name: treeName, person: { givenName: 'Olive', surname: 'Owner' } },
  });
  if (res.statusCode !== 201) throw new Error(`create tree failed: ${res.statusCode} ${res.body}`);
  const treeId = res.json().tree.id as string;
  return { owner, treeId };
}

export async function addPerson(
  db: Db,
  treeId: string,
  givenName: string,
  extra: Partial<typeof persons.$inferInsert> = {},
) {
  const [p] = await db.insert(persons).values({ treeId, givenName, ...extra }).returning();
  return p!;
}

/** A union of a and b (b may be null) with the given children. */
export async function family(
  db: Db,
  treeId: string,
  a: { id: string },
  b: { id: string } | null,
  children: { id: string }[] = [],
) {
  const [u] = await db
    .insert(unions)
    .values({ treeId, partnerAId: a.id, partnerBId: b?.id ?? null })
    .returning();
  for (const c of children) {
    await db.insert(parentChild).values({ treeId, unionId: u!.id, childId: c.id });
  }
  return u!;
}

export async function addMember(
  db: Db,
  treeId: string,
  userId: string,
  role: 'editor' | 'viewer',
  invitedByUserId: string | null = null,
) {
  await db.insert(treeMembers).values({ treeId, userId, role, invitedByUserId });
}

export async function addGrant(
  db: Db,
  treeId: string,
  userId: string,
  anchorPersonId: string,
  grantedByUserId: string | null,
  parentGrantId: string | null = null,
) {
  const [g] = await db
    .insert(branchStewards)
    .values({ treeId, userId, anchorPersonId, grantedByUserId, parentGrantId })
    .returning();
  return g!;
}
```

- [ ] **Step 3: Write the integration test** `apps/api/src/trees/access.int.test.ts`. It inserts users, trees and members directly through the db, since `POST /trees` doesn't exist yet. For signed-up users with 2FA, use `signUp` and `enableTwoFactor` on an app built as in `password-reset.int.test.ts`, then `db.insert(trees)` and `db.insert(treeMembers)`.
  - **Test cases:**
    1. A non-member gets `AppError` 404, and so does a member of a soft-deleted tree.
    2. With `includeDeleted: true`, a member of a soft-deleted tree gets their access.
    3. The owner has `role: 'owner'` and `grants: []`.
    4. A steward without 2FA has one entry in `heldGrants` and none in `grants`.
    5. A steward with 2FA has one grant whose scope matches `branchPersonIds` for the anchor.
    6. A derived grant's scope is the intersection:
       - The parent grant, held by S1, is anchored on Robert and covers the Hale side (not Laura).
       - The child grant is anchored on Laura, granted to S2 with `parentGrantId` = S1's grant.
       - Its scope is branch(Laura) ∩ branch(Robert) = {leo, mia, zoe}. Laura, George and Helen are not in it.
    7. `grantCovering` returns the grant containing a person, or `undefined`.
  - **Fixture:** build the Hale shape with `addPerson` and `family` from `tree-helpers.ts`.

- [ ] **Step 4: Run the test; it passes.**

- [ ] **Step 5: Commit** `feat(api): load tree access with effective steward scopes`

## Task 8: API — tree routes

**Files:**
- Create: `apps/api/src/routes/trees.ts`, `apps/api/src/routes/trees.int.test.ts`
- Modify: `apps/api/src/app.ts` (register the plugin; `meRoutes` gets `db` in Task 12; CORS methods)
- Modify: `apps/api/src/app.test.ts`

- [ ] **Step 0: CORS allows PATCH and DELETE.** `@fastify/cors` defaults `methods` to `GET,HEAD,POST`, which breaks this phase's PATCH/DELETE routes cross-origin in prod (web and API are on different hosts; the dev Vite proxy hides it). In `app.ts` change the registration to `app.register(cors, { origin: [config.WEB_ORIGIN], credentials: true, methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'] })`. Add a unit test in `app.test.ts`: `OPTIONS /api/v1/health` with `origin: <WEB_ORIGIN>` and `access-control-request-method: DELETE` returns 204 and `access-control-allow-methods` contains `DELETE` and `PATCH`. Run it failing first, then passing.

- [ ] **Step 1: Write the failing integration test** `apps/api/src/routes/trees.int.test.ts`.
  - **Setup:** the same as `password-reset.int.test.ts`:
    - `createAuth` with `rateLimitEnabled: false`
    - a new app per test
    - `{ ...loadConfig(), MAX_TREES_PER_USER: 2 }`
  - **Helpers:** `userWith2fa`, `ownerWithTree`, `addPerson` and `addMember` from `test/tree-helpers.ts`; `call` from `test/auth-helpers.ts`.
  - **Test cases:**
    1. **Not signed in:** `POST /api/v1/trees` returns 401. Signed in without 2FA, it returns 403 `TWO_FACTOR_REQUIRED`, and no tree row is created.
    2. **Creating a tree:**
       - It returns 201 `{ tree: { id } }`.
       - `GET /api/v1/trees` lists `{ id, name, role: 'owner' }`.
       - `GET /api/v1/trees/:id` shows the root person and sets `me.personId` to it.
       - All `capabilities` are true.
       - `GET …/persons` returns one person: `givenName` 'Olive', `surname` 'Owner', `birthYear` null.
       - The person row has `created_by` set to the owner.
    3. **Birth year:** creating a tree with `person.birthYear: 1990` stores `birth_date = {qualifier:'exact', date1:'1990'}` and `birth_sort_year = 1990`.
    4. **Validation:** a blank name returns 400 `VALIDATION`, with `details.name` set.
    5. **Tree limit (2):**
       - The third create returns 403 `QUOTA_EXCEEDED`.
       - After the owner soft-deletes one tree, the next create succeeds.
       - Two creates sent at once (`Promise.all`) when one slot is left: exactly one gets 201.
    6. **Renaming and root changes:**
       - The owner's PATCH `{ name }` returns 204, and the new name shows.
       - An editor's PATCH returns 403 `FORBIDDEN`.
       - Changing `rootPersonId` to a person of this tree returns 204.
       - Changing it to a person of another tree, or a soft-deleted person, returns 400 `VALIDATION`.
       - `{}` returns 400.
    7. **Viewer:** `capabilities` are all false, and `me.role` is 'viewer'.
    8. **Deleting:**
       - An editor's DELETE returns 403.
       - The owner's DELETE returns 204.
       - After that, `GET /trees/:id` returns 404 for both the owner and the editor.
       - The owner's `GET /trees` lists it under `deletedTrees`, with `restoreUntil` = `deletedAt` + 30 days. The editor's list has neither entry.
    9. **Restoring:**
       - The owner's `POST …/restore` returns 204, and the tree is visible again.
       - An editor's restore returns 404, because loadAccess with includeDeleted finds them but `can` refuses (403). **Use 404**: an editor must not learn anything about deleted trees, so the route throws `notFound()` for non-owners.
       - With `deleted_at` 31 days ago, restore returns 404.
       - Restoring a tree that isn't deleted returns 204 and changes nothing.
       - Restoring when it would exceed the limit returns 403 `QUOTA_EXCEEDED`.

- [ ] **Step 2: Run it; it fails.**

- [ ] **Step 3: Implement** `apps/api/src/routes/trees.ts`

```ts
import {
  createTreeSchema,
  type FuzzyDate,
  sortYear,
  TREE_RESTORE_DAYS,
  type TreeDetail,
  type TreeList,
  updateTreeSchema,
} from '@family-tree/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Auth } from '../auth/auth.js';
import { requireSession } from '../auth/session-guard.js';
import type { Config } from '../config.js';
import type { Db, Queryable } from '../db/client.js';
import { persons, treeMembers, trees } from '../db/schema.js';
import { AppError, idParam, notFound, parseBody } from '../errors.js';
import { can, TREE } from '../permissions/can.js';
import { authorize, loadAccess } from '../trees/access.js';

export interface TreeRouteOptions {
  auth: Auth;
  db: Db;
  config: Config;
}

const RESTORE_MS = TREE_RESTORE_DAYS * 86_400_000;

async function ownedLiveTreeCount(db: Queryable, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(treeMembers)
    .innerJoin(trees, eq(trees.id, treeMembers.treeId))
    .where(and(eq(treeMembers.userId, userId), eq(treeMembers.role, 'owner'), isNull(trees.deletedAt)));
  return row?.n ?? 0;
}

/** Serialises one user's tree creates and restores, so two at once can't both pass the limit. */
const lockUserTrees = (db: Queryable, userId: string) =>
  db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`trees:${userId}`}, 0))`);

export const treesRoutes: FastifyPluginAsync<TreeRouteOptions> = async (app, { auth, db, config }) => {
  app.addHook('preHandler', requireSession(auth));

  const quotaError = () =>
    new AppError('QUOTA_EXCEEDED', 403, `You can own at most ${config.MAX_TREES_PER_USER} trees`);

  app.get('/api/v1/trees', async (req) => {
    const rows = await db
      .select({ id: trees.id, name: trees.name, role: treeMembers.role, deletedAt: trees.deletedAt })
      .from(treeMembers)
      .innerJoin(trees, eq(trees.id, treeMembers.treeId))
      .where(eq(treeMembers.userId, req.user!.id))
      .orderBy(asc(trees.name));
    const now = Date.now();
    const body: TreeList = { trees: [], deletedTrees: [] };
    for (const r of rows) {
      if (r.deletedAt === null) body.trees.push({ id: r.id, name: r.name, role: r.role });
      else if (r.role === 'owner' && now - r.deletedAt.getTime() < RESTORE_MS) {
        body.deletedTrees.push({
          id: r.id,
          name: r.name,
          deletedAt: r.deletedAt.toISOString(),
          restoreUntil: new Date(r.deletedAt.getTime() + RESTORE_MS).toISOString(),
        });
      }
    }
    return body;
  });

  app.post('/api/v1/trees', async (req, reply) => {
    const { name, person } = parseBody(createTreeSchema, req.body);
    const user = req.user!;
    if (!user.twoFactorEnabled) {
      throw new AppError('TWO_FACTOR_REQUIRED', 403, 'Turn on two-step verification to start a tree');
    }
    const treeId = await db.transaction(async (tx) => {
      await lockUserTrees(tx, user.id);
      if ((await ownedLiveTreeCount(tx, user.id)) >= config.MAX_TREES_PER_USER) throw quotaError();
      const [tree] = await tx.insert(trees).values({ name }).returning({ id: trees.id });
      const birthDate: FuzzyDate | null =
        person.birthYear === undefined
          ? null
          : { qualifier: 'exact', date1: String(person.birthYear).padStart(4, '0') };
      const [root] = await tx
        .insert(persons)
        .values({
          treeId: tree!.id,
          givenName: person.givenName,
          surname: person.surname ?? null,
          sex: person.sex,
          birthDate,
          birthSortYear: birthDate ? sortYear(birthDate) : null,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning({ id: persons.id });
      await tx.update(trees).set({ rootPersonId: root!.id }).where(eq(trees.id, tree!.id));
      await tx
        .insert(treeMembers)
        .values({ treeId: tree!.id, userId: user.id, role: 'owner', personId: root!.id });
      return tree!.id;
    });
    return reply.code(201).send({ tree: { id: treeId } });
  });

  app.get('/api/v1/trees/:treeId', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const body: TreeDetail = {
      tree: { id: access.treeId, name: access.treeName, rootPersonId: access.rootPersonId },
      me: {
        role: access.role,
        personId: access.personId,
        steward: { grants: access.heldGrants, active: access.grants.length > 0 },
      },
      capabilities: {
        editAnywhere: access.role !== 'viewer',
        manageTree: can(access, 'tree.rename', TREE),
        invite: can(access, 'invite.create', {
          kind: 'invite',
          role: 'viewer',
          stewardAnchorPersonId: null,
        }),
        grantStewardship: access.role === 'owner' || access.grants.length > 0,
      },
    };
    return body;
  });

  app.patch('/api/v1/trees/:treeId', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const input = parseBody(updateTreeSchema, req.body);
    if (input.name !== undefined) authorize(access, 'tree.rename', TREE);
    if (input.rootPersonId !== undefined) {
      authorize(access, 'tree.changeRoot', TREE);
      const [p] = await db
        .select({ id: persons.id })
        .from(persons)
        .where(
          and(
            eq(persons.treeId, access.treeId),
            eq(persons.id, input.rootPersonId),
            isNull(persons.deletedAt),
          ),
        );
      if (!p) {
        throw new AppError('VALIDATION', 400, 'Some fields are invalid', {
          rootPersonId: ['Choose a person in this tree'],
        });
      }
    }
    await db
      .update(trees)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.rootPersonId === undefined ? {} : { rootPersonId: input.rootPersonId }),
      })
      .where(eq(trees.id, access.treeId));
    return reply.code(204).send();
  });

  app.delete('/api/v1/trees/:treeId', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'tree.delete', TREE);
    await db.update(trees).set({ deletedAt: sql`now()` }).where(eq(trees.id, access.treeId));
    return reply.code(204).send();
  });

  app.post('/api/v1/trees/:treeId/restore', async (req, reply) => {
    const userId = req.user!.id;
    const access = await loadAccess(db, idParam(req.params, 'treeId'), userId, {
      includeDeleted: true,
    });
    // Non-owners must not learn whether a deleted tree exists: 404, not 403.
    if (!can(access, 'tree.restore', TREE)) throw notFound();
    if (access.deletedAt === null) return reply.code(204).send();
    if (Date.now() - access.deletedAt.getTime() >= RESTORE_MS) throw notFound();
    await db.transaction(async (tx) => {
      await lockUserTrees(tx, userId);
      if ((await ownedLiveTreeCount(tx, userId)) >= config.MAX_TREES_PER_USER) throw quotaError();
      await tx.update(trees).set({ deletedAt: null }).where(eq(trees.id, access.treeId));
    });
    return reply.code(204).send();
  });

  app.get('/api/v1/trees/:treeId/persons', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'tree.view', TREE);
    const rows = await db
      .select({
        id: persons.id,
        givenName: persons.givenName,
        middleName: persons.middleName,
        surname: persons.surname,
        birthYear: persons.birthSortYear,
        deathYear: persons.deathSortYear,
        isLiving: persons.isLiving,
      })
      .from(persons)
      .where(and(eq(persons.treeId, access.treeId), isNull(persons.deletedAt)))
      .orderBy(asc(persons.surname), asc(persons.givenName));
    return { persons: rows };
  });
};
```

  In `app.ts`, inside `if (auth)`, add `app.register(treesRoutes, { auth, db, config });`.

  `req.user.twoFactorEnabled` comes from Better Auth's session lookup, which reads the user row on every request (`cookieCache` is off), so it is current.

- [ ] **Step 4: Run** the test, then `pnpm test:int`. Everything passes.

- [ ] **Step 5: Commit** `feat(api): tree routes: list, create with 2FA and limit, detail, rename/root, delete, restore, persons`

---

## Task 9: API — member routes (list, role, remove, transfer, owner reset links)

**Files:**
- Create: `apps/api/src/routes/members.ts`, `apps/api/src/routes/members.int.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write the failing integration test.**
  - **Setup:** for each test, an owner's tree plus users joined through `addMember`:
    - E, an editor invited by the owner
    - V, a viewer invited by the owner
    - S, a steward: a viewer with 2FA and a grant anchored on the root, made by the owner
    - W, a viewer invited by S (`invitedByUserId = S`)
  - **Test cases:**
    1. **Listing (`GET …/members`):**
       - The owner gets all 5, owner first, with `email` and `twoFactorEnabled`.
       - The editor gets the same list without `email` or `twoFactorEnabled`. Check `'email' in m === false`.
    2. **Changing roles (`PATCH …/members/:W {role:'editor'}`):**
       - S gets 204, and W is now an editor.
       - S changing V returns 403.
       - The owner changing E to viewer returns 204.
       - Changing the owner returns 403.
       - `{role:'owner'}` returns 400.
       - An unknown userId returns 404.
    3. **Removing members (`DELETE …/members/:W`):**
       - S gets 204.
       - The owner removes S: the member row and S's grant are gone, and S's open invite (insert one with `createdByUserId = S`) has `revoked_at` set.
       - E removing V returns 403.
       - Removing the owner returns 403.
    4. **Transferring ownership (`POST …/transfer`):**
       - To E (no 2FA): 403 `TWO_FACTOR_REQUIRED`.
       - To S (2FA): 204. Now S is owner and the old owner is an editor. S's grants are deleted. A grant S had made to S2 before the transfer survives with `parentGrantId` null. The old owner's open invite has `revoked_at` set. Exactly one owner row exists. The old owner's `capabilities.manageTree` is false.
       - To yourself: 400 `VALIDATION`.
       - By an editor: 403.
    5. **Reset links (`POST …/members/:userId/reset-link`), owner only:**
       - For V (no 2FA, only in this tree): 201 `{ token, expiresAt }`. The `reset_links` row has `tree_id` and `created_by_user_id` set, and `POST /api/v1/password-reset/link` with that token works.
       - For S (has 2FA): 403 `RESET_LINK_NOT_ALLOWED`.
       - For V after V also joins a second tree owned by someone else: 403 `RESET_LINK_NOT_ALLOWED`.
       - V also being a member of another tree the same owner owns: 201.
       - For yourself: 403 `RESET_LINK_NOT_ALLOWED`.
       - By an editor: 403 `FORBIDDEN`.
       - The 11th request from the same owner within an hour: 429.

- [ ] **Step 2: Run it; it fails.**

- [ ] **Step 3: Implement** `apps/api/src/routes/members.ts`

```ts
import { changeRoleSchema, type Member, ROLE_RANK, transferSchema } from '@family-tree/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { createResetLink } from '../auth/reset-links.js';
import { requireSession } from '../auth/session-guard.js';
import type { Queryable } from '../db/client.js';
import { branchStewards, invites, treeMembers, users } from '../db/schema.js';
import { AppError, idParam, notFound, parseBody } from '../errors.js';
import { can, TREE } from '../permissions/can.js';
import { extraLimit } from '../security/limits.js';
import { authorize, loadAccess } from '../trees/access.js';
import type { TreeRouteOptions } from './trees.js';

const resetNotAllowed = () =>
  new AppError(
    'RESET_LINK_NOT_ALLOWED',
    403,
    'A reset link can only be issued for a member without two-step verification who belongs only to trees you own',
  );

/** The member row of `userId` in `treeId`, with their 2FA status, or 404. */
async function loadMember(db: Queryable, treeId: string, userId: string) {
  const [m] = await db
    .select({
      userId: treeMembers.userId,
      role: treeMembers.role,
      invitedByUserId: treeMembers.invitedByUserId,
      twoFactorEnabled: users.twoFactorEnabled,
    })
    .from(treeMembers)
    .innerJoin(users, eq(users.id, treeMembers.userId))
    .where(and(eq(treeMembers.treeId, treeId), eq(treeMembers.userId, userId)));
  if (!m) throw notFound();
  return m;
}

export const membersRoutes: FastifyPluginAsync<TreeRouteOptions> = async (app, { auth, db }) => {
  app.addHook('preHandler', requireSession(auth));

  app.get('/api/v1/trees/:treeId/members', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const details = can(access, 'members.viewDetails', TREE);
    const rows = await db
      .select({
        userId: treeMembers.userId,
        name: users.name,
        email: users.email,
        twoFactorEnabled: users.twoFactorEnabled,
        role: treeMembers.role,
        personId: treeMembers.personId,
        invitedByUserId: treeMembers.invitedByUserId,
      })
      .from(treeMembers)
      .innerJoin(users, eq(users.id, treeMembers.userId))
      .where(eq(treeMembers.treeId, access.treeId));
    rows.sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.name.localeCompare(b.name));
    const members: Member[] = rows.map(({ email, twoFactorEnabled, ...m }) =>
      details ? { ...m, email, twoFactorEnabled } : m,
    );
    return { members };
  });

  app.patch('/api/v1/trees/:treeId/members/:userId', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const { role } = parseBody(changeRoleSchema, req.body);
    const target = await loadMember(db, access.treeId, idParam(req.params, 'userId'));
    authorize(access, 'member.changeRole', { kind: 'member', ...target });
    await db
      .update(treeMembers)
      .set({ role })
      .where(and(eq(treeMembers.treeId, access.treeId), eq(treeMembers.userId, target.userId)));
    return reply.code(204).send();
  });

  app.delete('/api/v1/trees/:treeId/members/:userId', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const target = await loadMember(db, access.treeId, idParam(req.params, 'userId'));
    authorize(access, 'member.remove', { kind: 'member', ...target });
    await db.transaction(async (tx) => {
      // Their open invites lose the authority they were made with.
      await tx
        .update(invites)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(invites.treeId, access.treeId),
            eq(invites.createdByUserId, target.userId),
            isNull(invites.usedAt),
            isNull(invites.revokedAt),
          ),
        );
      // Grants go with the member row (FK), and grants derived from them cascade.
      await tx
        .delete(treeMembers)
        .where(and(eq(treeMembers.treeId, access.treeId), eq(treeMembers.userId, target.userId)));
    });
    return reply.code(204).send();
  });

  app.post('/api/v1/trees/:treeId/transfer', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'tree.transfer', TREE);
    const { userId } = parseBody(transferSchema, req.body);
    if (userId === access.userId) {
      throw new AppError('VALIDATION', 400, 'Some fields are invalid', {
        userId: ['Choose another member'],
      });
    }
    const target = await loadMember(db, access.treeId, userId);
    if (!target.twoFactorEnabled) {
      throw new AppError(
        'TWO_FACTOR_REQUIRED',
        403,
        'The new owner needs to turn on two-step verification first',
      );
    }
    await db.transaction(async (tx) => {
      // Grants the new owner made as a steward become owner-made (parent null),
      // so deleting the new owner's own grants below doesn't cascade to them.
      const ownGrants = tx
        .select({ id: branchStewards.id })
        .from(branchStewards)
        .where(and(eq(branchStewards.treeId, access.treeId), eq(branchStewards.userId, userId)));
      await tx
        .update(branchStewards)
        .set({ parentGrantId: null })
        .where(inArray(branchStewards.parentGrantId, ownGrants));
      // The old owner's open invites could no longer be accepted (re-auth fails); revoke them.
      await tx
        .update(invites)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(invites.treeId, access.treeId),
            eq(invites.createdByUserId, access.userId),
            isNull(invites.acceptedAt),
            isNull(invites.revokedAt),
          ),
        );
      // Demote first: the one-owner index is checked row by row.
      await tx
        .update(treeMembers)
        .set({ role: 'editor' })
        .where(and(eq(treeMembers.treeId, access.treeId), eq(treeMembers.userId, access.userId)));
      await tx
        .update(treeMembers)
        .set({ role: 'owner' })
        .where(and(eq(treeMembers.treeId, access.treeId), eq(treeMembers.userId, userId)));
      await tx
        .delete(branchStewards)
        .where(and(eq(branchStewards.treeId, access.treeId), eq(branchStewards.userId, userId)));
    });
    return reply.code(204).send();
  });

  app.post(
    '/api/v1/trees/:treeId/members/:userId/reset-link',
    { preHandler: extraLimit(app, { name: 'reset-link-issue', max: 10, timeWindow: '1 hour', by: 'user' }) },
    async (req, reply) => {
      const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
      authorize(access, 'member.resetLink', TREE);
      const target = await loadMember(db, access.treeId, idParam(req.params, 'userId'));
      if (target.userId === access.userId || target.twoFactorEnabled) throw resetNotAllowed();
      // Spec §5: the target may belong to no tree other than trees this owner owns.
      const foreign = (await db.execute(sql`
        select 1 from ${treeMembers} m
        where m.user_id = ${target.userId}
          and not exists (
            select 1 from ${treeMembers} o
            where o.tree_id = m.tree_id and o.user_id = ${access.userId} and o.role = 'owner'
          )
        limit 1
      `)) as unknown as unknown[];
      if (foreign.length > 0) throw resetNotAllowed();
      const { token, expiresAt } = await createResetLink(db, {
        userId: target.userId,
        createdByUserId: access.userId,
        treeId: access.treeId,
      });
      return reply.code(201).send({ token, expiresAt: expiresAt.toISOString() });
    },
  );
};
```

  The `extraLimit` preHandler runs after the plugin's `requireSession` hook, so `req.user` is set when it builds the key. Register it in `app.ts` as `app.register(membersRoutes, { auth, db, config })`.

- [ ] **Step 4: Run the tests; they pass.**

- [ ] **Step 5: Commit** `feat(api): member routes: list, change role, remove, transfer ownership, owner reset links`

---

## Task 10: API — steward routes

**Files:**
- Create: `apps/api/src/routes/stewards.ts`, `apps/api/src/routes/stewards.int.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write the failing integration test.**
  - **Setup:** the owner's tree is the Hale shape, built with `addPerson` and `family`. The owner's root card counts as one more person; use the Hale persons for anchors. Users:
    - S1, a viewer with 2FA
    - S2, a viewer with 2FA
    - E, an editor
  - **Test cases:**
    1. **Granting:**
       - The owner grants S1 on Robert (`POST …/stewards {userId, anchorPersonId}`): 201 `{id}`, with `parentGrantId` null and `grantedByUserId` = owner.
       - The same grant again: 409 `CONFLICT`.
       - On a person of another tree: 400 `VALIDATION`.
       - To a non-member: 404.
       - To the owner: 400 `VALIDATION`.
       - E granting: 403.
    2. **Derived grants:**
       - S1 grants S2 on Leo, who is inside S1's scope: 201, with `parentGrantId` = S1's grant.
       - S1 granting S2 on George, who is outside: 403.
       - S1 granting themselves on Leo (inside S1's scope, so `authorize` passes first): 400.
    3. **2FA:** S3, a viewer without 2FA, receives a grant from the owner: 201, but `GET …/stewards` shows `active: false`. S3 then granting anyone: 403, because the grant isn't effective without 2FA.
    4. **Listing (`GET …/stewards`):** every member can read it. Rows carry `userName`, `anchorPersonId`, `grantedByName` and `active`.
    5. **Revoking:**
       - S2 revoking S1's grant: 403.
       - S1 revoking the grant they made to S2: 204.
       - The owner revoking S1's grant removes S2's derived grant too (re-grant S2 from S1 first).
       - Revoking an id from another tree: 404.

- [ ] **Step 2: Run it; it fails.**

- [ ] **Step 3: Implement** `apps/api/src/routes/stewards.ts`

```ts
import { grantStewardSchema, type StewardGrant } from '@family-tree/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import { branchStewards, persons, treeMembers, users } from '../db/schema.js';
import { AppError, idParam, notFound, parseBody } from '../errors.js';
import { authorize, grantCovering, loadAccess } from '../trees/access.js';
import type { TreeRouteOptions } from './trees.js';

const invalid = (field: string, message: string) =>
  new AppError('VALIDATION', 400, 'Some fields are invalid', { [field]: [message] });

export const stewardsRoutes: FastifyPluginAsync<TreeRouteOptions> = async (app, { auth, db }) => {
  app.addHook('preHandler', requireSession(auth));

  app.get('/api/v1/trees/:treeId/stewards', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const grantee = alias(users, 'grantee');
    const granter = alias(users, 'granter');
    const rows = await db
      .select({
        id: branchStewards.id,
        userId: branchStewards.userId,
        userName: grantee.name,
        anchorPersonId: branchStewards.anchorPersonId,
        grantedByUserId: branchStewards.grantedByUserId,
        grantedByName: granter.name,
        parentGrantId: branchStewards.parentGrantId,
        active: grantee.twoFactorEnabled,
      })
      .from(branchStewards)
      .innerJoin(grantee, eq(grantee.id, branchStewards.userId))
      .leftJoin(granter, eq(granter.id, branchStewards.grantedByUserId))
      .where(eq(branchStewards.treeId, access.treeId))
      .orderBy(branchStewards.createdAt);
    const stewards: StewardGrant[] = rows;
    return { stewards };
  });

  app.post('/api/v1/trees/:treeId/stewards', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const { userId, anchorPersonId } = parseBody(grantStewardSchema, req.body);
    authorize(access, 'steward.grant', { kind: 'anchor', personId: anchorPersonId });
    if (userId === access.userId) throw invalid('userId', 'Choose another member');
    const [anchor] = await db
      .select({ id: persons.id })
      .from(persons)
      .where(
        and(eq(persons.treeId, access.treeId), eq(persons.id, anchorPersonId), isNull(persons.deletedAt)),
      );
    if (!anchor) throw invalid('anchorPersonId', 'Choose a person in this tree');
    const [member] = await db
      .select({ role: treeMembers.role })
      .from(treeMembers)
      .where(and(eq(treeMembers.treeId, access.treeId), eq(treeMembers.userId, userId)));
    if (!member) throw notFound();
    if (member.role === 'owner') throw invalid('userId', 'The owner already has full access');

    const parentGrantId =
      access.role === 'owner' ? null : (grantCovering(access, anchorPersonId)?.id ?? null);
    const [row] = await db
      .insert(branchStewards)
      .values({
        treeId: access.treeId,
        userId,
        anchorPersonId,
        grantedByUserId: access.userId,
        parentGrantId,
      })
      .onConflictDoNothing()
      .returning({ id: branchStewards.id });
    if (!row) throw new AppError('CONFLICT', 409, 'They already look after this branch');
    return reply.code(201).send({ id: row.id });
  });

  app.delete('/api/v1/trees/:treeId/stewards/:grantId', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const [grant] = await db
      .select({ id: branchStewards.id, grantedByUserId: branchStewards.grantedByUserId })
      .from(branchStewards)
      .where(
        and(
          eq(branchStewards.treeId, access.treeId),
          eq(branchStewards.id, idParam(req.params, 'grantId')),
        ),
      );
    if (!grant) throw notFound();
    authorize(access, 'steward.revoke', { kind: 'grant', grantedByUserId: grant.grantedByUserId });
    // Derived grants cascade through parent_grant_id (spec §4).
    await db.delete(branchStewards).where(eq(branchStewards.id, grant.id));
    return reply.code(204).send();
  });
};
```

  `authorize(…'steward.grant')` already guarantees that a non-owner holds a covering grant, so `grantCovering` never returns undefined for them. The `?? null` only satisfies the type. Register the plugin in `app.ts`.

- [ ] **Step 4: Run the tests; they pass.** **Step 5: Commit** `feat(api): steward routes: list, grant (derived scopes), revoke with cascade`

---

## Task 11: API — invite routes (create, list, revoke, preview, accept)

**Files:**
- Create: `apps/api/src/routes/invites.ts`, `apps/api/src/routes/invites.int.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write the failing integration test.**
  - **Setup:** the owner's tree with the Hale persons; S, a steward with 2FA anchored on Robert; E, an editor.
  - **Test cases:**
    1. **Creating:**
       - The owner creates `{role:'editor'}`: 201 `{ id, token, expiresAt }`, with `expiresAt` 7 days ahead (±1 minute).
       - The DB holds only `sha256(token)`: `token_hash` ≠ token, and `hashToken(token)` matches.
    2. **Who may create:**
       - E creating an invite: 403.
       - S creating `{role:'viewer', stewardAnchorPersonId: Leo}` (inside the scope): 201.
       - S with an anchor of George (outside): 403.
       - S with an anchor of a person from another tree: 403 (not in scope). The owner trying the same: 400 `VALIDATION`.
    3. **Target person:** `targetPersonId` already linked to a member (the owner's own card): 400 `VALIDATION`.
    4. **Listing (`GET …/invites`):**
       - The owner sees all open invites, with `createdByName`.
       - S sees only their own.
       - E: 403.
       - Used, revoked and expired invites are not listed. Expire one by setting `expires_at` in the past.
    5. **Revoking (`DELETE …/invites/:id`):**
       - S revoking the owner's invite: 403.
       - S revoking their own: 204.
       - The owner revoking any invite: 204.
       - Revoking an id from another tree: 404.
    6. **Preview (`POST /api/v1/invites/preview {token}`), no session needed:**
       - Returns `{ treeName, role, inviterName, steward, targetPersonName }`.
       - A bad, used, revoked or expired token, or one for a soft-deleted tree: 400 `INVALID_INVITE`.
       - Without an Origin header: 403 (the origin guard).
       - The 31st preview from one IP within 15 minutes: 429. Use `TRUST_PROXY: 1` and `x-forwarded-for`, as the password-reset test does.
    7. **Accept (`POST /api/v1/invites/accept {token}`):**
       - Without a session: 401.
       - A new user accepts an editor invite with `targetPersonId` set to Emma: 200 `{ treeId }`. They are an editor with `personId` = Emma, `invitedByUserId` = the owner. The invite has `used_at` and `used_by_user_id` set.
       - A second accept of the same token: 400 `INVALID_INVITE`.
    8. **Accepting as an existing member:**
       - An existing viewer accepts an editor invite: they become an editor.
       - An existing editor accepts a viewer invite: they stay an editor, and the invite is used.
       - The owner accepting someone else's invite: they stay the owner, no grant is created, and the invite is used.
    9. **Steward invites:**
       - A steward invite from S, anchored on Leo, creates a grant with `grantedByUserId` = S and `parentGrantId` = S's grant.
       - An owner-made steward invite creates a grant with `parentGrantId` null.
    10. **Authority is re-checked at acceptance:**
        - S creates an invite, then the owner revokes S's grant. Accepting it: 400 `INVALID_INVITE`, and the invite is still unused (the transaction rolled back).
        - The creator accepting their own invite: 400 `INVALID_INVITE`.
    11. **Concurrent accepts:** two accepts of one token sent at once (`Promise.all`, two different users): exactly one succeeds.

- [ ] **Step 2: Run it; it fails.**

- [ ] **Step 3: Implement** `apps/api/src/routes/invites.ts`

```ts
import {
  createInviteSchema,
  INVITE_TTL_DAYS,
  type Invite,
  type InvitePreview,
  inviteTokenSchema,
  ROLE_RANK,
} from '@family-tree/shared';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import type { Queryable } from '../db/client.js';
import { branchStewards, invites, persons, treeMembers, trees, users } from '../db/schema.js';
import { AppError, forbidden, idParam, notFound, parseBody } from '../errors.js';
import { can, TREE } from '../permissions/can.js';
import { extraLimit } from '../security/limits.js';
import { hashToken, newToken } from '../security/tokens.js';
import { authorize, grantCovering, loadAccess } from '../trees/access.js';
import type { TreeRouteOptions } from './trees.js';

const invalidInvite = () =>
  new AppError('INVALID_INVITE', 400, 'This invite link is invalid, expired or already used');
const invalid = (field: string, message: string) =>
  new AppError('VALIDATION', 400, 'Some fields are invalid', { [field]: [message] });

/** Usable: unused, unrevoked, unexpired. */
const usable = () =>
  and(isNull(invites.usedAt), isNull(invites.revokedAt), gt(invites.expiresAt, sql`now()`));

async function livePerson(db: Queryable, treeId: string, personId: string) {
  const [p] = await db
    .select({ id: persons.id, givenName: persons.givenName, surname: persons.surname })
    .from(persons)
    .where(and(eq(persons.treeId, treeId), eq(persons.id, personId), isNull(persons.deletedAt)));
  return p;
}

/** A person card no member has claimed yet. */
async function claimable(db: Queryable, treeId: string, personId: string): Promise<boolean> {
  if (!(await livePerson(db, treeId, personId))) return false;
  const [m] = await db
    .select({ userId: treeMembers.userId })
    .from(treeMembers)
    .where(and(eq(treeMembers.treeId, treeId), eq(treeMembers.personId, personId)));
  return !m;
}

export const invitesRoutes: FastifyPluginAsync<TreeRouteOptions> = async (app, { auth, db }) => {
  const session = requireSession(auth);

  app.get('/api/v1/trees/:treeId/invites', { preHandler: session }, async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const all = can(access, 'invites.viewAll', TREE);
    // Owners see every open invite; active stewards see their own; everyone else is refused.
    if (!all && access.grants.length === 0) throw forbidden();
    const rows = await db
      .select({
        id: invites.id,
        role: invites.role,
        stewardAnchorPersonId: invites.stewardAnchorPersonId,
        targetPersonId: invites.targetPersonId,
        createdByUserId: invites.createdByUserId,
        createdByName: users.name,
        expiresAt: invites.expiresAt,
      })
      .from(invites)
      .innerJoin(users, eq(users.id, invites.createdByUserId))
      .where(
        and(
          eq(invites.treeId, access.treeId),
          usable(),
          all ? undefined : eq(invites.createdByUserId, access.userId),
        ),
      )
      .orderBy(invites.createdAt);
    const list: Invite[] = rows.map((r) => ({
      ...r,
      role: r.role === 'owner' ? 'editor' : r.role, // unreachable: CHECK invites_not_owner
      expiresAt: r.expiresAt.toISOString(),
    }));
    return { invites: list };
  });

  app.post(
    '/api/v1/trees/:treeId/invites',
    { preHandler: [session, extraLimit(app, { name: 'invite-create', max: 30, timeWindow: '1 hour', by: 'user' })] },
    async (req, reply) => {
      const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
      const input = parseBody(createInviteSchema, req.body);
      authorize(access, 'invite.create', { kind: 'invite', ...input });
      if (input.stewardAnchorPersonId && !(await livePerson(db, access.treeId, input.stewardAnchorPersonId))) {
        throw invalid('stewardAnchorPersonId', 'Choose a person in this tree');
      }
      if (input.targetPersonId && !(await claimable(db, access.treeId, input.targetPersonId))) {
        throw invalid('targetPersonId', 'Choose a person in this tree who has no account yet');
      }
      const token = newToken();
      const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
      const [row] = await db
        .insert(invites)
        .values({
          tokenHash: hashToken(token),
          treeId: access.treeId,
          role: input.role,
          stewardAnchorPersonId: input.stewardAnchorPersonId,
          targetPersonId: input.targetPersonId,
          createdByUserId: access.userId,
          expiresAt,
        })
        .returning({ id: invites.id });
      return reply.code(201).send({ id: row!.id, token, expiresAt: expiresAt.toISOString() });
    },
  );

  app.delete('/api/v1/trees/:treeId/invites/:inviteId', { preHandler: session }, async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const [inv] = await db
      .select({ id: invites.id, createdByUserId: invites.createdByUserId })
      .from(invites)
      .where(and(eq(invites.treeId, access.treeId), eq(invites.id, idParam(req.params, 'inviteId'))));
    if (!inv) throw notFound();
    authorize(access, 'invite.revoke', { kind: 'ownInvite', createdByUserId: inv.createdByUserId });
    await db
      .update(invites)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(invites.id, inv.id), isNull(invites.revokedAt), isNull(invites.usedAt)));
    return reply.code(204).send();
  });

  // Public: the landing page shows what the invite is for before sign-up. The token is the secret.
  app.post(
    '/api/v1/invites/preview',
    { preHandler: extraLimit(app, { name: 'invite-preview', max: 30, timeWindow: '15 minutes' }) },
    async (req) => {
      const { token } = parseBody(inviteTokenSchema, req.body);
      const [row] = await db
        .select({
          treeName: trees.name,
          role: invites.role,
          inviterName: users.name,
          steward: sql<boolean>`${invites.stewardAnchorPersonId} is not null`,
          targetGiven: persons.givenName,
          targetSurname: persons.surname,
        })
        .from(invites)
        .innerJoin(trees, and(eq(trees.id, invites.treeId), isNull(trees.deletedAt)))
        .innerJoin(users, eq(users.id, invites.createdByUserId))
        .leftJoin(persons, and(eq(persons.id, invites.targetPersonId), isNull(persons.deletedAt)))
        .where(and(eq(invites.tokenHash, hashToken(token)), usable()));
      if (!row || row.role === 'owner') throw invalidInvite();
      const body: InvitePreview = {
        treeName: row.treeName,
        role: row.role,
        inviterName: row.inviterName,
        steward: row.steward,
        targetPersonName: row.targetGiven
          ? [row.targetGiven, row.targetSurname].filter(Boolean).join(' ')
          : null,
      };
      return body;
    },
  );

  app.post(
    '/api/v1/invites/accept',
    {
      preHandler: [
        extraLimit(app, { name: 'invite-accept', max: 10, timeWindow: '15 minutes' }),
        session,
      ],
    },
    async (req) => {
      const { token } = parseBody(inviteTokenSchema, req.body);
      const userId = req.user!.id;
      const treeId = await db.transaction(async (tx) => {
        // Claim the invite first: of two concurrent accepts, only one gets the row back.
        const [inv] = await tx
          .update(invites)
          .set({ usedAt: sql`now()`, usedByUserId: userId })
          .where(and(eq(invites.tokenHash, hashToken(token)), usable()))
          .returning();
        if (!inv || inv.role === 'owner' || inv.createdByUserId === userId) throw invalidInvite();

        // Re-authorise the creator now (decision 3). loadAccess also 404s a deleted tree.
        const creator = await loadAccess(tx, inv.treeId, inv.createdByUserId).catch(() => null);
        const spec = {
          kind: 'invite' as const,
          role: inv.role,
          stewardAnchorPersonId: inv.stewardAnchorPersonId,
        };
        if (!creator || !can(creator, 'invite.create', spec)) throw invalidInvite();

        // Serialise accepts per tree so two invites targeting the same person can't both
        // pass `claimable` and then hit tree_members_person_uq (a 500).
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'accept:' + inv.treeId}))`);

        const [existing] = await tx
          .select()
          .from(treeMembers)
          .where(and(eq(treeMembers.treeId, inv.treeId), eq(treeMembers.userId, userId)));
        const personId =
          inv.targetPersonId && !existing?.personId && (await claimable(tx, inv.treeId, inv.targetPersonId))
            ? inv.targetPersonId
            : null;
        if (!existing) {
          await tx.insert(treeMembers).values({
            treeId: inv.treeId,
            userId,
            role: inv.role,
            personId,
            invitedByUserId: inv.createdByUserId,
          });
        } else {
          // Only ever raise (spec §5).
          const role = ROLE_RANK[inv.role] > ROLE_RANK[existing.role] ? inv.role : existing.role;
          await tx
            .update(treeMembers)
            .set({ role, ...(personId ? { personId } : {}) })
            .where(and(eq(treeMembers.treeId, inv.treeId), eq(treeMembers.userId, userId)));
        }
        if (inv.stewardAnchorPersonId && existing?.role !== 'owner') {
          await tx
            .insert(branchStewards)
            .values({
              treeId: inv.treeId,
              userId,
              anchorPersonId: inv.stewardAnchorPersonId,
              grantedByUserId: creator.userId,
              parentGrantId:
                creator.role === 'owner'
                  ? null
                  : (grantCovering(creator, inv.stewardAnchorPersonId)?.id ?? null),
            })
            .onConflictDoNothing();
        }
        return inv.treeId;
      });
      return { treeId };
    },
  );
};
```

  **Order of preHandlers on accept:** the limit runs first, so unauthenticated floods are limited too.

  **Registering:** `app.register(invitesRoutes, { auth, db, config })`.


- [ ] **Step 4: Run the tests; they pass.**

- [ ] **Step 5: Commit** `feat(api): invites: create, list, revoke, public preview, accept (re-authorised, raise-only)`

---

## Task 12: API — 2FA required for owners and stewards, account deletion, `/me`

**Files:**
- Modify: `apps/api/src/auth/auth.ts`, `apps/api/src/routes/me.ts`, `apps/api/src/app.ts`
- Create: `apps/api/src/auth/account.int.test.ts`

- [ ] **Step 1: Write the failing integration test** `apps/api/src/auth/account.int.test.ts`. Disable 2FA with `POST /api/auth/two-factor/disable {password}`; delete the account with `POST /api/auth/delete-user {password}`.
  - **Test cases:**
    1. **Owners can't turn 2FA off:** a tree owner's disable returns 403, with body `code` `TWO_FACTOR_REQUIRED_FOR_ROLE`, and `/me` still shows `twoFactorEnabled: true`.
    2. **Neither can stewards:** a member holding a grant gets 403 too. Use a steward who has 2FA enabled (they must, to call disable at all); the hook checks for any `branch_stewards` row, active or not, so it refuses before Better Auth runs.
    3. **Others can:** a plain editor with 2FA gets 200.
    4. **`/me` (`requiresTwoFactor`):**
       - True for an owner and for a grant holder.
       - False for a fresh user.
       - False for the old owner after a transfer, unless they own another tree.
    5. **Deleting needs a password:**
       - Without a password: 400 `PASSWORD_REQUIRED`, and the user still exists.
       - With a wrong password: 400.
    6. **Owners can't delete their account:**
       - An owner of a live tree gets 403 `OWNS_TREES`.
       - After soft-deleting the tree, deletion returns 200. The user row is gone, the tree's owner row is gone, and the persons they created have `created_by` null.
    7. **An editor deletes their account:** 200. Their `tree_members` row and their open invites are gone, and the tree and its persons are untouched.

- [ ] **Step 2: Run it; it fails.**

- [ ] **Step 3: Implement.** In `auth.ts`, import:

```ts
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { holdsTwoFactorRole, ownsLiveTree } from '../trees/roles.js';
```

  Add these to the `betterAuth({...})` options:

```ts
    user: {
      deleteUser: {
        enabled: true,
        // Spec §5: transfer or delete owned trees first.
        beforeDelete: async (user) => {
          if (await ownsLiveTree(db, user.id)) {
            throw APIError.from('FORBIDDEN', {
              code: 'OWNS_TREES',
              message: 'Transfer or delete the trees you own first',
            });
          }
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Without a password Better Auth deletes any session younger than a day unchecked.
        if (ctx.path === '/delete-user') {
          const password = (ctx.body as { password?: unknown } | undefined)?.password;
          if (typeof password !== 'string' || password === '') {
            throw APIError.from('BAD_REQUEST', {
              code: 'PASSWORD_REQUIRED',
              message: 'Enter your password',
            });
          }
        }
        // Spec §5: owners and stewards can't turn 2FA off.
        if (ctx.path === '/two-factor/disable') {
          const session = await getSessionFromCtx(ctx);
          if (session && (await holdsTwoFactorRole(db, session.user.id))) {
            throw APIError.from('FORBIDDEN', {
              code: 'TWO_FACTOR_REQUIRED_FOR_ROLE',
              message: 'Tree owners and branch stewards must keep two-step verification on',
            });
          }
        }
      }),
    },
```

  **Check the types:**
  - If `getSessionFromCtx` isn't exported from `better-auth/api` in 1.7.18, read the session with `ctx.context.internalAdapter` through the session cookie instead. It is exported in 1.7.18, so this is unlikely.
  - Errors thrown from a `before` hook reach the client as `{ code, message }` with that status. The test checks this.

  **`/me`:**
  - `meRoutes` takes `{ auth, db }` and returns `requiresTwoFactor: await holdsTwoFactorRole(db, user.id)`.
  - Update its registration in `app.ts`.

- [ ] **Step 4: Run** `pnpm test:int`. Everything passes, including `auth.int.test.ts`: its 2FA disable test uses a user without trees.

- [ ] **Step 5: Commit** `feat(auth): owners and stewards keep 2FA; account deletion with password, blocked while owning trees`

---

## Task 13: API — cross-tree isolation suite and owner seed

**Files:**
- Create: `apps/api/src/routes/isolation.int.test.ts`
- Modify: `apps/api/src/db/seed.ts`, `apps/api/src/db/seed-cli.ts`, `apps/api/src/db/seed.int.test.ts`, `apps/api/src/auth/reset-link-cli.ts` (comment only)

- [ ] **Step 1: Write the isolation test.** It covers spec §8: "user X can't read or modify tree Y through any endpoint". It passes immediately if Tasks 8–11 are right. If a route fails it, fix that route.

```ts
// Setup (as in the other route tests): tree A with owner A, a member, a grant and an invite;
// outsider X owns their own tree B. X calls every tree route against tree A.
const routes = (t: string, ids: { member: string; grant: string; invite: string; person: string }) =>
  [
    ['GET', `/api/v1/trees/${t}`],
    ['PATCH', `/api/v1/trees/${t}`, { name: 'hijacked' }],
    ['DELETE', `/api/v1/trees/${t}`],
    ['POST', `/api/v1/trees/${t}/restore`],
    ['GET', `/api/v1/trees/${t}/persons`],
    ['GET', `/api/v1/trees/${t}/members`],
    ['PATCH', `/api/v1/trees/${t}/members/${ids.member}`, { role: 'editor' }],
    ['DELETE', `/api/v1/trees/${t}/members/${ids.member}`],
    ['POST', `/api/v1/trees/${t}/transfer`, { userId: ids.member }],
    ['POST', `/api/v1/trees/${t}/members/${ids.member}/reset-link`],
    ['GET', `/api/v1/trees/${t}/stewards`],
    ['POST', `/api/v1/trees/${t}/stewards`, { userId: ids.member, anchorPersonId: ids.person }],
    ['DELETE', `/api/v1/trees/${t}/stewards/${ids.grant}`],
    ['GET', `/api/v1/trees/${t}/invites`],
    ['POST', `/api/v1/trees/${t}/invites`, { role: 'viewer' }],
    ['DELETE', `/api/v1/trees/${t}/invites/${ids.invite}`],
  ] as const;
```

  - **Test cases:**
    1. **Outsider:** every route returns **404** with body code `NOT_FOUND` for X.
    2. **Nothing changed:** after all calls, tree A's name, deleted_at, member count, grant count and open invite count are unchanged.
    3. **Mixed ids:** X calls only the sub-resource routes with **tree B's** id (which X owns) but **tree A's** ids: members PATCH and DELETE, transfer, reset-link, DELETE stewards/:grantId and DELETE invites/:inviteId each return **404**; POST stewards with tree A's member and person returns 404 for the member (a non-member of B) — and with a tree-B member plus tree A's person returns **400 `VALIDATION`**. Don't call tree B's own tree-level routes here (they'd succeed, and DELETE would soft-delete B). Tree A is unchanged.
    4. **Deleted tree:** after owner A soft-deletes tree A, the former member gets 404 on every route except `POST …/restore`, which also returns 404 (non-owner).
    5. **Not signed in:** every route returns 401.
    6. **Malformed ids:** `GET /api/v1/trees/not-a-uuid` returns 404.

- [ ] **Step 2: Owner seed.** Change the signature to `seedSampleFamily(db, { ownerUserId }: { ownerUserId?: string } = {})`. When `ownerUserId` is set:
  - set `createdBy: ownerUserId` on every seeded person
  - insert `tree_members { treeId, userId: ownerUserId, role: 'owner', personId: leo.id }` before returning

  In `seed-cli.ts`:
  - Accept an optional email argument (validate it with `emailSchema`) and look up the user. An unknown email prints `No user with email …` and exits 1.
  - A user without 2FA gets a warning, `Note: owners must have two-step verification; turn it on in Account settings.`, but is still seeded.
  - Print `Seeded "Sample family (seed)" (tree <id>), owned by <email>`.

  Extend `seed.int.test.ts`: seeding with an owner creates exactly one owner row whose `person_id` is Leo, and re-seeding stays idempotent.

  In `reset-link-cli.ts`, replace the "The owner UI that issues these links arrives in phase 3" comment with: "Owners issue these from the Members page; this CLI is for local development."

  README "Local development": document `pnpm seed you@example.com` (the user must have signed up first).

- [ ] **Step 3: Run** `pnpm test:int` and `pnpm lint`. Both pass.

- [ ] **Step 4: Commit** `test(api): cross-tree isolation for every tree route; seed can assign an owner`

---

## Task 14: Web — TreesApi, provider and fake

**Files:**
- Create: `apps/web/src/trees/api.ts`, `apps/web/src/trees/api.test.ts`, `apps/web/src/trees/TreesApiContext.tsx`, `apps/web/src/test/fake-trees.ts`
- Modify: `apps/web/src/auth/api.ts` (messages, codes, `deleteAccount`), `apps/web/src/auth/AuthContext.tsx` (METHODS), `apps/web/src/test/fake-auth.ts`, `apps/web/src/test/render.tsx`, `apps/web/src/App.tsx`

- [ ] **Step 1: Write the failing tests** `apps/web/src/trees/api.test.ts`. Stub `fetch` with `vi.stubGlobal`, as `auth/api.test.ts` does.
  - **Test cases:**
    1. **Listing:** `listTrees()` GETs `/api/v1/trees` with `credentials: 'include'` and returns the parsed body.
    2. **Creating:** `createTree(input)` POSTs JSON with `content-type: application/json` and returns `{ id }` from `{ tree: { id } }`.
    3. **Requests without a body:** `deleteTree(id)` sends DELETE with no body and no content-type; a 204 gives `{ ok: true }`.
    4. **Error codes:** a 403 with `{ error: { code: 'QUOTA_EXCEEDED' } }` gives `{ ok:false, error:{ code:'QUOTA_EXCEEDED', message: MESSAGES.quota } }`, a fixed text. Likewise `TWO_FACTOR_REQUIRED`, `INVALID_INVITE`, `RESET_LINK_NOT_ALLOWED`, `FORBIDDEN` and `NOT_FOUND` each map to their message.
    5. **Session expiry:** a 401 gives the code `SESSION_EXPIRED`.
    6. **Network failure:** `fetch` rejecting gives the code `NETWORK`.
    7. **Unexpected bodies:** a 200 whose body doesn't match the schema gives the generic message (`toAuthError(500)`).
    8. **Path encoding:** ids are put into paths with `encodeURIComponent`.

- [ ] **Step 2: Run them; they fail.**

- [ ] **Step 3: Implement.**

  **`auth/api.ts`:**
  - Add to `MESSAGES`:
    ```ts
    quota: 'You’ve reached the limit of trees you can own',
    twoFactorRequired: 'Two-step verification needs to be on for this',
    twoFactorForRole: 'Tree owners and branch stewards must keep two-step verification on',
    ownsTrees: 'Transfer or delete the trees you own before deleting your account',
    passwordRequired: 'Enter your password',
    invalidInvite: 'This invite link is invalid, expired or already used',
    resetNotAllowed: 'You can only issue a reset link to a member without two-step verification who belongs only to trees you own',
    forbidden: 'You don’t have permission to do that',
    notFound: 'This tree doesn’t exist or you don’t have access to it',
    conflict: 'That already exists',
    ```
  - Map them in `BY_CODE`:
    - `QUOTA_EXCEEDED`
    - `TWO_FACTOR_REQUIRED`
    - `TWO_FACTOR_REQUIRED_FOR_ROLE`
    - `OWNS_TREES`
    - `PASSWORD_REQUIRED`
    - `INVALID_INVITE`
    - `RESET_LINK_NOT_ALLOWED`
    - `FORBIDDEN`
    - `NOT_FOUND`
    - `CONFLICT`
  - Add `deleteAccount(input: { password: string }): Promise<Result<void>>` to `AuthApi`, implemented as `run('session', () => client.deleteUser({ password }), nothing)`. Add it to `METHODS` in `AuthContext.tsx` and to `FakeAuthApi`:
    - With `password` wrong: `badPassword`.
    - When `ownsTrees` is set on the fake user: `OWNS_TREES`.
    - Otherwise: remove the user and sign out.

  **`trees/api.ts`:**

```ts
import {
  acceptedInviteSchema,
  apiErrorSchema,
  type CreateInviteInput,
  type CreatedInvite,
  createdIdSchema,
  createdInviteSchema,
  createdTreeSchema,
  type CreateTreeInput,
  type InvitePreview,
  type Invite,
  inviteListSchema,
  invitePreviewSchema,
  type InviteRole,
  type Member,
  memberListSchema,
  type PersonSummary,
  personListSchema,
  resetLinkCreatedSchema,
  type ResetLinkCreated,
  type StewardGrant,
  stewardListSchema,
  type TreeDetail,
  treeDetailSchema,
  type TreeList,
  treeListSchema,
  type UpdateTreeInput,
} from '@family-tree/shared';
import { MESSAGES, type Result, toAuthError } from '../auth/api';

/** Everything the tree pages need. Tests use FakeTreesApi (test/fake-trees.ts). */
export interface TreesApi {
  listTrees(): Promise<Result<TreeList>>;
  createTree(input: CreateTreeInput): Promise<Result<{ id: string }>>;
  getTree(treeId: string): Promise<Result<TreeDetail>>;
  updateTree(treeId: string, input: UpdateTreeInput): Promise<Result<void>>;
  deleteTree(treeId: string): Promise<Result<void>>;
  restoreTree(treeId: string): Promise<Result<void>>;
  listPersons(treeId: string): Promise<Result<PersonSummary[]>>;
  listMembers(treeId: string): Promise<Result<Member[]>>;
  changeRole(treeId: string, userId: string, role: InviteRole): Promise<Result<void>>;
  removeMember(treeId: string, userId: string): Promise<Result<void>>;
  transferOwnership(treeId: string, userId: string): Promise<Result<void>>;
  createResetLink(treeId: string, userId: string): Promise<Result<ResetLinkCreated>>;
  listStewards(treeId: string): Promise<Result<StewardGrant[]>>;
  grantSteward(treeId: string, input: { userId: string; anchorPersonId: string }): Promise<Result<{ id: string }>>;
  revokeSteward(treeId: string, grantId: string): Promise<Result<void>>;
  listInvites(treeId: string): Promise<Result<Invite[]>>;
  createInvite(treeId: string, input: CreateInviteInput): Promise<Result<CreatedInvite>>;
  revokeInvite(treeId: string, inviteId: string): Promise<Result<void>>;
  previewInvite(token: string): Promise<Result<InvitePreview>>;
  acceptInvite(token: string): Promise<Result<{ treeId: string }>>;
}

/** Every TreesApi method; the Record type makes the compiler flag a missing one. */
export const TREES_API_METHODS = Object.keys({
  listTrees: true, createTree: true, getTree: true, updateTree: true, deleteTree: true,
  restoreTree: true, listPersons: true, listMembers: true, changeRole: true, removeMember: true,
  transferOwnership: true, createResetLink: true, listStewards: true, grantSteward: true,
  revokeSteward: true, listInvites: true, createInvite: true, revokeInvite: true,
  previewInvite: true, acceptInvite: true,
} satisfies Record<keyof TreesApi, true>) as (keyof TreesApi)[];

interface Parser<T> {
  safeParse(v: unknown): { success: true; data: T } | { success: false };
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export function createTreesApi({ baseUrl }: { baseUrl: string }): TreesApi {
  const origin = baseUrl.replace(/\/+$/, '');
  const t = (treeId: string) => `/trees/${encodeURIComponent(treeId)}`;

  async function request<T>(method: Method, path: string, body?: unknown, parser?: Parser<T>): Promise<Result<T>> {
    let res: Response;
    try {
      res = await fetch(`${origin}/api/v1${path}`, {
        method,
        credentials: 'include',
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
    } catch {
      return { ok: false, error: { code: 'NETWORK', message: MESSAGES.network } };
    }
    if (!res.ok) {
      const parsed = apiErrorSchema.safeParse(await res.json().catch(() => null));
      return { ok: false, error: toAuthError(res.status, parsed.success ? parsed.data.error.code : undefined, 'session') };
    }
    if (!parser) return { ok: true, data: undefined as T };
    const parsed = parser.safeParse(await res.json().catch(() => null));
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: toAuthError(500) };
  }
  const map = async <A, B>(r: Promise<Result<A>>, f: (a: A) => B): Promise<Result<B>> => {
    const res = await r;
    return res.ok ? { ok: true, data: f(res.data) } : res;
  };

  return {
    listTrees: () => request('GET', '/trees', undefined, treeListSchema),
    createTree: (input) => map(request('POST', '/trees', input, createdTreeSchema), (d) => d.tree),
    getTree: (id) => request('GET', t(id), undefined, treeDetailSchema),
    updateTree: (id, input) => request('PATCH', t(id), input),
    deleteTree: (id) => request('DELETE', t(id)),
    restoreTree: (id) => request('POST', `${t(id)}/restore`, {}),
    listPersons: (id) => map(request('GET', `${t(id)}/persons`, undefined, personListSchema), (d) => d.persons),
    listMembers: (id) => map(request('GET', `${t(id)}/members`, undefined, memberListSchema), (d) => d.members),
    changeRole: (id, userId, role) => request('PATCH', `${t(id)}/members/${encodeURIComponent(userId)}`, { role }),
    removeMember: (id, userId) => request('DELETE', `${t(id)}/members/${encodeURIComponent(userId)}`),
    transferOwnership: (id, userId) => request('POST', `${t(id)}/transfer`, { userId }),
    createResetLink: (id, userId) =>
      request('POST', `${t(id)}/members/${encodeURIComponent(userId)}/reset-link`, {}, resetLinkCreatedSchema),
    listStewards: (id) => map(request('GET', `${t(id)}/stewards`, undefined, stewardListSchema), (d) => d.stewards),
    grantSteward: (id, input) => request('POST', `${t(id)}/stewards`, input, createdIdSchema),
    revokeSteward: (id, grantId) => request('DELETE', `${t(id)}/stewards/${encodeURIComponent(grantId)}`),
    listInvites: (id) => map(request('GET', `${t(id)}/invites`, undefined, inviteListSchema), (d) => d.invites),
    createInvite: (id, input) => request('POST', `${t(id)}/invites`, input, createdInviteSchema),
    revokeInvite: (id, inviteId) => request('DELETE', `${t(id)}/invites/${encodeURIComponent(inviteId)}`),
    previewInvite: (token) => request('POST', '/invites/preview', { token }, invitePreviewSchema),
    acceptInvite: (token) => request('POST', '/invites/accept', { token }, acceptedInviteSchema),
  };
}
```

  **Preview is a public call:** a 401 there is unexpected, so pass the kind `'public'` for it. Give `request` a `kind` argument that defaults to `'session'`.

  **`trees/TreesApiContext.tsx`:**
  - A `TreesApiProvider({ api, children })` that wraps each method in `TREES_API_METHODS`. A `SESSION_EXPIRED` result calls `useAuth().refresh()`, the same as `watchSession` in `AuthContext.tsx`.
  - Memoise the wrapped object on `[api, refresh]`.
  - `useTreesApi()` throws if it's used outside the provider.

  **`App.tsx`:**
  - Build `createTreesApi({ baseUrl: API_BASE || window.location.origin })` once, the same way as the auth api.
  - Accept an optional `trees` prop for injection.
  - Nest `<TreesApiProvider>` inside `<AuthProvider>`.

  **`test/fake-trees.ts`:** a `FakeTreesApi implements TreesApi`, following `FakeAuthApi`. It needs:
  - **Calls:** a `calls` log, `failNext(method, error)`, and `hold(method)` / `release()`.
  - **State:** in-memory `trees: Map<string, { detail: TreeDetail; persons: PersonSummary[]; members: Member[]; stewards: StewardGrant[]; invites: Invite[] }>` and `deletedTrees`.
  - **Helpers:**
    - `addTree(partial)` returns the id. Its defaults are an owner detail with all capabilities true and one person, "Ada Lovelace".
    - `invitesByToken: Map<string, InvitePreview & { treeId: string }>`.
  - **Methods:** each one mutates that state the way the server would, closely enough for the page tests:
    - `createTree` returns a new id, with `QUOTA_EXCEEDED` after `quotaLeft` reaches 0.
    - `deleteTree` moves the tree to `deletedTrees`.
    - `createInvite` returns the token `fake-token-<n>`.
    - `acceptInvite` returns the tree id, or `INVALID_INVITE`.
    - Unknown ids return a `NOT_FOUND` error with `MESSAGES.notFound`.

  **`test/render.tsx`:**
  - New signature: `renderAt(path, { auth = new FakeAuthApi(), trees = new FakeTreesApi() } = {})`. Wrap `AppRoutes` in `TreesApiProvider` inside `AuthProvider`, and return `{ ...utils, api: auth, trees }`.
  - Update the existing callers: they pass `api` positionally today. A plain search-and-replace of `renderAt(path, api)` to `renderAt(path, { auth: api })` covers them all.

- [ ] **Step 4: Run** `pnpm --filter @family-tree/web test` and `pnpm typecheck`. Both pass, including all the phase 2 page tests.

- [ ] **Step 5: Commit** `feat(web): TreesApi client, provider and in-memory fake`

---

## Task 15: Web — My trees (home) and Start a new tree

**Files:**
- Create: `apps/web/src/pages/MyTrees.tsx`, `apps/web/src/pages/MyTrees.test.tsx`, `apps/web/src/pages/NewTreePage.tsx`, `apps/web/src/pages/NewTreePage.test.tsx`, `apps/web/src/components/ConfirmButton.tsx`, `apps/web/src/components/ConfirmButton.test.tsx`
- Modify: `apps/web/src/pages/HomePage.tsx`, `apps/web/src/routes.tsx`, `apps/web/src/components/Page.tsx`, `apps/web/src/styles.css`

**Behaviour:**
- **Home, signed in:** keeps "Signed in as …", **Account settings** and **Sign out**, and renders `<MyTrees />` under a heading "Your trees".
- **`MyTrees`:**
  - Loads `listTrees()`. While loading it shows "Loading…".
  - On error it shows the error message in `role="alert"`, with a **Try again** button.
  - For each tree, a link to `/trees/:id` with the tree's name, followed by its role: "Owner", "Editor" or "Viewer".
  - With no trees: "You don't have any trees yet."
  - A link **Start a new tree** goes to `/trees/new`.
  - If `deletedTrees` isn't empty, it shows a section "Deleted trees". Each row reads "<name>, can be restored until <date>", with the date from `toLocaleDateString()`, and has a **Restore** button. Restore calls `restoreTree` and reloads the list. A failure shows its message.
- **`/trees/new`** (behind `RequireAuth`), titled "Start a new tree":
  - **Without 2FA:**
    - It explains: "Tree owners must use two-step verification, because they control who can see the family's details. Turn it on to continue."
    - It renders the existing `<TwoFactorSetup enabled={false} onChanged={refresh} />`. Once `refresh` makes `twoFactorEnabled` true, the form appears; no reload is needed.
  - **With 2FA**, a form "About you" with these fields:
    - **Tree name:** defaults to `${surname} family` when the user types a surname, and the user can edit it. Simplest version: if the user hasn't touched the tree name, set it to `${surname} family` whenever surname changes. Required.
    - **Your first name:** required.
    - **Your last name:** optional.
    - **Sex:** a `<select>` with Female, Male, Other, and Prefer not to say (`unknown`, the default).
    - **Birth year:** optional, a number input. Send it as a number; leave it out when blank.
  - **Validation:** with `validate(createTreeSchema, …)`. Field errors use the paths `name`, `person.givenName` and `person.birthYear`. `validate` keys only the first path segment, so it gets a small helper that keys by the joined path. Add `validateDeep` to `components/forms.tsx`, keyed by `issue.path.join('.')`.
  - **Submit:** calls `createTree`. On success it navigates to `/trees/:id`. On error it shows the message in a `FormError`: `QUOTA_EXCEEDED` gives `MESSAGES.quota`, and `TWO_FACTOR_REQUIRED` triggers `refresh()` and shows the message.
- **`ConfirmButton({ label, confirmLabel, onConfirm, pending, danger })`:**
  - The first click shows `confirmLabel` and a **Cancel** button.
  - A second click calls `onConfirm`. Escape or Cancel resets it.
  - Focus moves to the confirm button when it appears.
- **`Page`:** gets an optional `wide` prop (`className="card card-wide"`, max-width 960px) for the tree and members pages.

**Tests:**

- [ ] **Step 1:** `ConfirmButton.test.tsx`:
  - The first click doesn't call `onConfirm`.
  - Confirm calls it once.
  - Cancel restores the label.
  - Escape cancels.
- [ ] **Step 2:** `MyTrees.test.tsx`, using `renderAt('/', { auth, trees })` with a signed-in fake user:
  - It lists trees with their roles, and the links point to `/trees/<id>`.
  - Empty state.
  - A list error shows an alert, and Try again reloads.
  - Clicking Restore on a deleted tree calls `restoreTree`, and the tree moves to the main list.
  - Signed out, the home page shows Sign in and Create an account, and no trees.
- [ ] **Step 3:** `NewTreePage.test.tsx`:
  - A user without 2FA sees the explanation and the "Turn on two-step verification" button, and no form.
  - With 2FA, typing surname "Hale" fills the tree name "Hale family". A manual edit of the tree name is kept when the surname changes again.
  - Submitting an empty first name shows the field error and makes no call.
  - A birth year of 3000 shows "That year is in the future".
  - A valid submit calls `createTree` with `{ name, person: { givenName, surname, sex: 'unknown', birthYear: 1990 } }` and lands on `/trees/<id>`. Assert the tree page heading appears; Task 16 renders it.
  - `QUOTA_EXCEEDED` shows the quota message.
  - Signed out, `/trees/new` redirects to sign-in.
- [ ] **Step 4:** Implement until the tests pass. Add the routes `/trees/new`, then `/trees/:treeId` (Task 16 adds the page; register a placeholder now), both inside `RequireAuth`. Put `/trees/new` before `/trees/:treeId`, although react-router ranks static segments first anyway.
- [ ] **Step 5:** `pnpm --filter @family-tree/web test`, `pnpm lint`, `pnpm typecheck`. **Commit** `feat(web): My trees, start a new tree with the 2FA gate, restore deleted trees`

---

## Task 16: Web — tree overview page

**Files:**
- Create: `apps/web/src/pages/TreePage.tsx`, `apps/web/src/pages/TreePage.test.tsx`
- Modify: `apps/web/src/routes.tsx`

**Behaviour** of `/trees/:treeId` (`RequireAuth`, `Page wide`, titled with the tree name). It loads `getTree` and `listPersons` in parallel.
- **Not found:** `NOT_FOUND` shows `MESSAGES.notFound` and a link "Back to your trees".
- **Header:**
  - "You are the owner / an editor / a viewer of this tree."
  - If `me.steward.grants` is non-empty and `active`: "You look after the branches of: <names of anchors>", with names looked up in the persons list.
  - If the grants aren't active: "You've been made a branch steward. Turn on two-step verification in Account settings to start using it."
- **Root:** "Starting person: <root name>".
- **People:** a section "People (N)" with a list `<ul>`. Each item: full name (given, middle, surname), then years ("1930–1998", "b. 1990", or nothing). The person who is `me.personId` gets " (you)". Note above the list: "The interactive family tree arrives in a later version."
- **Links:** **Members and invites** goes to `/trees/:treeId/members`; **Your trees** goes to `/`.
- **Tree settings** section, shown only when `capabilities.manageTree`:
  - **Rename:** a text field prefilled with the name, and a **Save name** button calling `updateTree({ name })`. Success shows "Saved" and updates the heading.
  - **Starting person:** a `<select>` of persons, with a **Save starting person** button calling `updateTree({ rootPersonId })`.
  - **Delete this tree:** the text "Deleting hides the tree from everyone. You can restore it from Your trees for 30 days." Then a field "Type the tree name to confirm", and a `ConfirmButton` "Delete tree" that is disabled until the text matches the name exactly. On confirm it calls `deleteTree` and navigates to `/`.
- **Shared helper:** put the name and year formatting in `apps/web/src/trees/format.ts` (`personName(p)`, `personYears(p)`), with a small unit test. The members page reuses it.

- [ ] **Step 1:** Tests in `TreePage.test.tsx`, plus `trees/format.test.ts`:
  - It shows the tree name, role line and people with years, and "(you)" on the right person.
  - Viewers and editors don't see Tree settings.
  - The owner renames: `updateTree` is called and the heading changes.
  - The owner changes the starting person.
  - "Delete tree" stays disabled until the exact name is typed. Confirm calls `deleteTree` and lands on home.
  - An unknown tree id shows the not-found message.
  - An inactive steward sees the 2FA notice; an active steward sees their anchors' names.
- [ ] **Step 2:** Implement until the tests pass.
- [ ] **Step 3:** **Commit** `feat(web): tree overview with people list and owner settings`

---

## Task 17: Web — Members page (members, stewards, invites)

**Files:**
- Create: `apps/web/src/pages/MembersPage.tsx`, `apps/web/src/pages/members/MembersSection.tsx`, `apps/web/src/pages/members/StewardsSection.tsx`, `apps/web/src/pages/members/InvitesSection.tsx`, `apps/web/src/pages/MembersPage.test.tsx`
- Modify: `apps/web/src/routes.tsx`

**Behaviour** of `/trees/:treeId/members` (`RequireAuth`, `Page wide`, title "Members of <tree name>"):
- **Loading:** it loads `getTree`, `listPersons`, `listMembers` and `listStewards`. It also loads `listInvites` when `capabilities.invite || capabilities.manageTree`.
- **After every action:** reload the affected list(s). Show action errors in a single `role="alert"` area at the top of the section that failed.
- **MembersSection:** a table with these columns:
  - Name, with " (you)" on the signed-in user.
  - Role.
  - Email, owner view only.
  - Their card (person name, or "—").
  - Actions.

  The actions shown per row:
  - **Role select** (Editor/Viewer): for non-owner rows when the viewer is the owner, or is an active steward and `invitedByUserId === me`. Changing it calls `changeRole`.
  - **Remove** (`ConfirmButton` "Remove" → "Remove from tree"): under the same condition.
  - **Owner only:**
    - **Make owner** (`ConfirmButton` "Make owner" → "Transfer ownership"): only when the row has `twoFactorEnabled`. Otherwise show the hint "Needs two-step verification to become owner". After a transfer, reload `getTree` too: the viewer is now an editor and the owner controls disappear.
    - **Reset link:** only for non-owner rows without `twoFactorEnabled`. It calls `createResetLink` and shows a box:
      - "Send this link to <name> yourself. It works once, for 24 hours."
      - A read-only input with `${window.location.origin}/reset/${token}`.
      - A **Copy** button (`navigator.clipboard.writeText`). In jsdom, mock it; show "Copied" on success.
      - The error `RESET_LINK_NOT_ALLOWED` shows `MESSAGES.resetNotAllowed`.
- **StewardsSection:** heading "Branch stewards", with the explanation "A steward can add, edit and delete people in one branch of the family, and invite relatives to it."
  - **List:** "<user name> looks after <anchor person name>'s branch, granted by <granter or 'someone who left'>". Inactive grants add "(starts when they turn on two-step verification)".
  - **Revoke** (`ConfirmButton`): shown when the viewer is the owner or `grantedByUserId === me`.
  - **Grant form:** shown when `capabilities.grantStewardship`.
    - A member select (non-owner members other than me).
    - A person select: all persons for the owner. For a steward, list all persons too; the server enforces the scope, and a `FORBIDDEN` shows "You can only grant stewardship inside your own branch".
    - A **Make steward** button.
- **InvitesSection**, shown when `capabilities.invite`: heading "Invite someone".
  - **Form:**
    - **Role** radio: "Can view" (viewer, the default) or "Can add and edit" (editor).
    - **Make them a steward of** (optional): a person select, defaulting to "No".
    - **This invite is for** (optional): a select of persons not yet linked to a member.
    - A **Create invite link** button.
  - **On success**, a box:
    - "Send this link to them yourself, by message or email. It works once and expires on <date>."
    - A read-only input with `${window.location.origin}/invite/${token}` and a Copy button.
    - "You won't be able to see this link again."
  - **Open invites list:** role, steward anchor, intended person, created by, expiry, and a **Revoke** `ConfirmButton` (owner: all; steward: own).

- [ ] **Step 1:** Tests in `MembersPage.test.tsx`:
  1. **The owner's view:**
     - It shows emails and role selects for non-owners.
     - Changing a role calls `changeRole(treeId, userId, 'editor')`.
     - Remove asks for confirmation, then calls `removeMember`.
  2. **Make owner:** shown only on 2FA rows. After a transfer, the owner controls disappear because the fake's detail now says editor.
  3. **Reset link:**
     - It shows `http://localhost:3000/reset/<token>`. Use whatever `window.location.origin` jsdom reports.
     - Copy calls `navigator.clipboard.writeText` with that URL.
     - `RESET_LINK_NOT_ALLOWED` shows its message.
  4. **An editor's view:** no role selects, no Remove, no invite form, and no email column.
  5. **An active steward's view:** controls only on rows they invited; the invite form is visible.
  6. **Creating an invite:** submitting with "Can add and edit", a steward anchor and a target calls `createInvite` with the right ids, and shows the `/invite/fake-token-1` link. The open invites list then shows it, and Revoke calls `revokeInvite`.
  7. **Granting stewardship:** calls `grantSteward`, and the list updates. Revoke calls `revokeSteward`.
- [ ] **Step 2:** Implement until the tests pass. Keep each section in its own file, receiving `{ treeId, detail, persons, members, me, reload }` as props.
- [ ] **Step 3:** **Commit** `feat(web): members page: roles, removal, ownership transfer, reset links, stewards, invites`

---

## Task 18: Web — invite landing page, account deletion, keeping 2FA on

**Files:**
- Create: `apps/web/src/pages/InvitePage.tsx`, `apps/web/src/pages/InvitePage.test.tsx`
- Modify: `apps/web/src/routes.tsx`, `apps/web/src/pages/AccountPage.tsx`, `apps/web/src/pages/AccountPage.test.tsx`, `apps/web/src/pages/TwoFactorSetup.tsx`, `apps/web/src/pages/SignInPage.tsx`, `apps/web/src/pages/SignUpPage.tsx`

**Behaviour:**
- **`/invite/:token`** is public and titled "You're invited". It calls `previewInvite(token)`:
  - **Invalid:** `INVALID_INVITE` shows the message and a link "Go to Family Tree" (`/`).
  - **Valid:** it shows these lines:
    - "<inviterName> invited you to <treeName> as a viewer / an editor."
    - If steward: "They'd also like you to look after a branch of the family. That needs two-step verification."
    - If `targetPersonName`: "The invite says you are <targetPersonName> in the tree."
  - **Signed out:** **Sign in** and **Create an account** links, both with `?next=/invite/<token>` encoded.
  - **Signed in:** "Signed in as <name>", and a **Join <treeName>** button calling `acceptInvite`. On success it navigates to `/trees/<treeId>`. On `INVALID_INVITE` it shows the message.
  - **Notes:** the token comes from the URL. The page never logs it and never puts it in another URL except `next`, which stays on this site.
- **Sign-in and sign-up links:** `SignInPage`'s "Create an account" link and `SignUpPage`'s "Sign in" link keep the current `next` value (`?next=${encodeURIComponent(next)}` when `next !== '/'`), so going from the invite to sign-up to sign-in still comes back to the invite.
- **AccountPage:**
  - **When `user.requiresTwoFactor`:** `TwoFactorSetup` hides the **Turn off** action. Pass it a new prop `canDisable={!user.requiresTwoFactor}`. In its place it shows "Tree owners and branch stewards must keep two-step verification on."
  - **New section "Delete account":**
    - The text: "This removes your login and your access to every tree. People you added stay in their trees. If you own a tree, transfer it or delete it first."
    - A password field, and a `ConfirmButton` "Delete my account" → "Delete permanently".
    - On success: `refresh()` (the user becomes null) and navigate to `/`.
    - `OWNS_TREES` shows `MESSAGES.ownsTrees`, and a wrong password shows `MESSAGES.badPassword`.

- [ ] **Step 1:** `InvitePage.test.tsx`:
  - The preview text for a signed-out user, with links whose `next` is the invite path.
  - A signed-in user joins and lands on the tree page.
  - An invalid token shows the message.
  - A steward invite shows the 2FA note.
- [ ] **Step 2:** `AccountPage.test.tsx` additions:
  - With `requiresTwoFactor`, there is no "Turn off" button and the note shows.
  - Delete-account confirmation, then success, ends on home signed out.
  - `OWNS_TREES` shows its message.
  - An empty password shows "Enter your password" with no call.
- [ ] **Step 3:** A sign-in/sign-up test: rendering `/sign-in?next=%2Finvite%2Fabc`, the "Create an account" link's href contains `next=%2Finvite%2Fabc`.
- [ ] **Step 4:** Implement, and run all web tests, lint and typecheck.
- [ ] **Step 5:** **Commit** `feat(web): invite landing page, account deletion, owners and stewards keep 2FA`

---

## Task 19: Verification, docs, browser walk-through, manual checklist

- [ ] **Step 1: README.** Add a section "Trees, invites and stewards (dev)". It explains:
  - Start a tree from Your trees (needs 2FA).
  - Invite links are shown once and you send them yourself.
  - `pnpm seed you@example.com` makes you the owner of the sample family, to try stewards on a real branch.
  - Owner-issued reset links come from the Members page.
  - Add to "Known limitations":
    - moving 2FA to a new device (phase 7)
    - no person editing yet (phase 4)
    - no canvas yet (phase 5)
- [ ] **Step 2: Full checks:**
  - `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm build`
  - Run gitleaks as CI does: `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.24.3 detect --source /repo --no-banner`. It must report no leaks.
  - Record the test counts.
- [ ] **Step 3: Rebuild the dev stack:** `pnpm dev` (migration 0002 runs at API start). Check the API log for "Server listening".
- [ ] **Step 4: Browser walk-through** (the controller does this, not a subagent), with two local test accounts generated in the scratchpad:
  1. **Owner:**
     - Sign up and see "Your trees" empty.
     - On Start a new tree, the 2FA gate shows. Enable 2FA (use `scratchpad/totp.mjs`).
     - Create the tree. The overview shows you as owner, with the root person "(you)".
  2. **Seed:** run `pnpm seed <owner test email>`. "Sample family (seed)" appears in Your trees, and its overview lists 10 people.
  3. **Steward invite:** on Members, create an editor invite with the steward anchor Robert, plus a viewer invite. Copy the editor link.
  4. **Second user:**
     - In a fresh session (sign out first), open the invite link and see the preview.
     - Create an account from there; it returns to the invite. Join, and the tree overview opens.
     - The steward notice asks for 2FA. Enable it, and the anchor shows.
  5. **Steward's view:** the Members page shows controls only on rows they invited.
  6. **Owner, as the first user again:**
     - Issue a reset link to a member without 2FA. The link works once.
     - Revoke the viewer invite. Opening it shows "invalid".
  7. **Tree lifecycle:** rename the tree, change the starting person, delete the tree, restore it from Deleted trees.
  8. **Account deletion:** as the owner, it refuses with "Transfer or delete the trees you own first".
  9. **Isolation by hand:** with curl and the second user's cookie, GET a tree they aren't in. It returns 404.
  10. **Console:** no errors.

  Chrome autofills the user's real saved login on sign-in and sign-up forms. Clear the fields before typing, never submit the user's real credentials, and never repeat test credentials in chat.
- [ ] **Step 5: Commit** any fixes, then `docs: trees, invites and stewards in dev`. Hand the user the summary and the manual checklist below, and wait for their result before merging.

**Manual checklist for the author** (about 20 minutes; have your authenticator app and a second browser or private window ready):
1. `pnpm dev`. Wait for "Server listening".
2. Sign in. Your trees is empty. Click **Start a new tree**:
   - If 2FA is off, you're asked to turn it on first.
   - Fill in your details. You land on the tree page as the owner, with yourself marked "(you)".
3. `pnpm seed <your email>`. "Sample family (seed)" appears under Your trees. Open it: 10 people.
4. On the sample tree → **Members and invites** → Invite someone:
   - Choose "Can add and edit" and make them a steward of **Robert Hale**.
   - Create the link and copy it.
5. In a private window, open the link. You see who invited you and to which tree. **Create an account** (another email), then **Join**, and the tree opens.
   - It says the steward role needs 2FA. Turn it on in Account settings, then come back: it lists Robert's branch.
6. Back in your window, on Members:
   - You see the new member with their email and the steward grant, now active.
   - Change their role to Viewer, then back to Editor.
7. Create a viewer invite, then **Revoke** it. Opening the revoked link in the private window shows "invalid, expired or already used".
8. **Reset link:**
   - Create a third account through a viewer invite, without 2FA.
   - On Members, click **Reset link** for them. Open the link in the private window and set a new password; it works once.
   - **Reset link** isn't offered for the 2FA steward.
9. In the private window (the steward), the Members page shows controls only for people they invited.
10. As owner:
    - Rename the tree and change the starting person.
    - Delete the tree (type its name). It appears under **Deleted trees**. Restore it.
11. Account settings:
    - "Turn off" two-step verification is not offered. It says owners must keep it.
    - **Delete account** refuses while you own trees.
12. `pnpm test && pnpm test:int`. Everything passes.

---

## Carry-forward notes for later phases

- **Phase 4:**
  - Person and relation routes must call `can()` with the targets defined in `permissions/can.ts`:
    - `person.add` ends: the people the new person attaches to.
    - `person.delete`: every person the preview touches, plus the ends of relations it ends.
    - `relation.delete`: both ends.
  - Set `persons.created_by` and `updated_by` on every write.
  - Erasing persons for good must first unlink `tree_members.person_id` and delete any `branch_stewards` and `invites` that reference them. Those FKs are NO ACTION.
  - The purge job hard-deletes trees whose `deleted_at` is more than `TREE_RESTORE_DAYS` ago. That includes ownerless trees left behind by account deletion.
  - The audit log should also record membership, steward and invite changes.
  - The root person still can't be soft-deleted.
- **Phase 5:**
  - The graph endpoint authorises with `tree.view` and returns per-person `canEdit` / `canDelete` flags computed with `can()`, so cards show the right "+" buttons.
  - Replace the overview's people list with the canvas.
- **Phase 6:** the search filter "branch" reuses `branchQuery`.
- **Phase 7:**
  - Re-enrolling 2FA on a new device, needing a current code or a recovery code.
  - Re-check the Better Auth `hooks.before` paths (`/delete-user`, `/two-factor/disable`) on upgrades.
  - Rate limits are in memory.
- **Performance:**
  - `loadAccess` computes each steward grant's scope on every request: one CTE per chain link. That's fine for family-sized trees.
  - If profiling shows it hurting, cache scopes per request or materialise them.
- **Person erase (Phase 4):** it must null `tree_members.person_id` and clear invite anchor/target refs first (NO ACTION FKs). Erasing a grant's anchor cascades and revokes that grant and its derived grants.
- **Ownerless trees (Phase 4):** an owner whose trees are all soft-deleted may delete their account, leaving an ownerless soft-deleted tree. The purge job and restore must not assume an owner exists.
