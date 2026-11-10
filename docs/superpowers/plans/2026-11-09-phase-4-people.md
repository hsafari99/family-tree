# Phase 4 — People, Relations, Deletion, Trash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members can add, view and edit people (every field in spec §3, fuzzy dates, places, residences), link them as parents, partners, children and siblings, and edit unions and parent–child links. Owners and stewards delete people and relations to a Trash with a preview. The owner restores or erases Trash batches. Every change goes into an audit log, shown as a person's History. Person edits use optimistic concurrency. A scheduled job purges trees that were soft-deleted more than 30 days ago.

**Architecture:**
- **Pure graph logic in `packages/shared`:** `family-graph.ts` holds ancestor and descendant walks, the cycle check, and the **deletion planner** (`planPersonDeletion`, `planUnionDeletion`, `planLinkDeletion`). The planner turns a live graph into a `DeletionPlan`: the rows to soft-delete, the partner slots to empty, and every person the delete touches (the `can()` target). Unit tests cover it (spec §9 "delete-preview computation").
- **API:**
  - Five new route plugins: `persons`, `relations`, `residences`, `deletion`, `trash`.
  - Each structural write loads the tree's live graph inside a transaction that holds a **per-tree advisory lock** (`lockTreeGraph`). It plans the change, authorises with `can()` against the real ends, then writes.
  - Every write calls `audit()` in the same transaction.
  - Soft deletes go into a `deletion_batches` row. Deleted rows are tagged with `deletion_batch_id`, and emptied partner slots are stored in `deletion_batches.slots`. Restore and erase work on the whole batch.
  - `trees/purge.ts` runs in process every hour (config), and as a CLI.
- **Web:**
  - The tree page becomes a people list plus a **person panel** (tabs: Info, Places, Photos placeholder, Relations, History), an add-person form, and add-relative forms.
  - New pages: a delete preview, and a **Trash** page for the owner.
  - No canvas and no duplicate check (phase 5).

**Tech Stack:** Fastify 5.12.8, Drizzle 0.45.4 / drizzle-kit 0.31.11, Postgres 17, Better Auth 1.7.18, Zod 4.6.7, React 19.3.1, react-router 8.5.1, Vitest 5.1.0. **No new dependencies.**

---

## Ground rules (read first)

- **Branch:** create `phase-4-people` from the merged `phase-3-trees` (ask the user if phase 3 isn't merged yet; never start on top of uncommitted phase 3 work). Commit after each task. Never push. Never commit:
  - `.env.production`
  - `graft/`
  - `.ignore`
  - `.claude/settings.local.json`
  - `.vitest/`
- **Dependencies:**
  - None are needed. If one ever is, pin an exact version that was published at least two weeks ago.
  - Never add `minimumReleaseAgeExclude`, and never upgrade dependencies.
  - Vite stays at **8.3.6**: the dev CPU has no AVX2.
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
  - Trees the user can't see return **404**, never 403. Ids of rows in another tree (person, union, link, residence, batch) also return **404**.
  - `FORBIDDEN` (403) is only for a tree the user is a member of.
  - The web UI never shows server text: it maps error **codes** to fixed messages, and per call it may override the message for a code.
- **Order inside a route:**
  1. `loadAccess` (outsiders get 404).
  2. Load the target row in this tree (404).
  3. Parse the body.
  4. `authorize`.
  5. Write.
  Structural writes (adding people and relatives, deletes, restore, erase, a root change) open the transaction, take `lockTreeGraph`, then call `loadAccess(tx, …)` **inside** it and do steps 2–5 there. That way the steward scope `can()` sees is computed from the same graph the write changes.
- **Validation before authorisation is acceptable:** some routes parse the body, or check that an id is live in the tree, before `authorize`. So a viewer may get `400 VALIDATION` instead of `403` for a malformed request. Members already see this tree's data, so this leaks nothing. Outsiders still always get 404 first, from `loadAccess`.
- **Global lock order** (to avoid deadlocks): (1) the per-tree advisory lock `lockTreeGraph`, (2) the `trees` row, (3) a `deletion_batches` row, (4) `persons` / `unions` / `parent_child` rows. Every transaction that takes more than one of these takes them in this order. Any transaction that touches the `trees` row **and** person rows takes `lockTreeGraph` first: that covers `PATCH /trees/:id` (Task 10), the person delete, restore and erase.
- **Routes:** every new route lives in a plugin registered after the rate limiter (see the comment in `app.ts`), with `requireSession` as a preHandler.
- **Browser:** no `window.confirm` / `alert`, because they block the browser automation used to verify phases. Destructive buttons use `ConfirmButton` (inline two-step).
- **User content** is never rendered as HTML. The biography and notes are plain text with `white-space: pre-line`.
- **Code in this plan:** it is the intended implementation. If the real code has moved on (names, imports), follow the repo and keep the behaviour. Run Prettier (`pnpm format`) before each commit.

## Decisions taken in this plan (beyond the spec)

1. **Optimistic concurrency:**
   - Only `persons` carries `version`, as the spec says.
   - `PATCH …/persons/:id` must send the edited `version` in the **JSON body** (not `If-Match`, which the web client doesn't otherwise use). A mismatch returns `409 CONFLICT`, and the update bumps `version` by 1.
   - Unions, links and residences are last-write-wins. Their forms are tiny and each change is audited.
   - The web client maps `CONFLICT` on this one call to a "someone else changed this person" message.
2. **Batch bookkeeping:**
   - Rows soft-deleted by a batch carry `deletion_batch_id`.
   - Partner slots emptied by a batch are stored as `deletion_batches.slots`, a jsonb array of `{unionId, slot: 'a'|'b', personId}`. Together these are "each changed row and its previous value" (spec §4).
   - `deletion_batch_id` has a composite NO ACTION FK to `deletion_batches(tree_id, id)` (decision 21). Erase deletes the rows first, then the batch.
3. **Residences:**
   - Residences are part of a person's details. Adding, editing and removing them is `person.edit`.
   - Removing one is a hard delete; the audit row keeps the old value.
   - They are not tagged by person batches: they are hidden with their person, and come back when the person is restored. Erasing the person removes them through the FK cascade. `residences.deleted_at` stays unused.
4. **Relation deletes:**
   - Deleting a union also soft-deletes its live child links ("its children's links go with it", as in the person rule). So the `relation.delete` target is the partners **plus** those children.
   - Deleting a parent–child link targets the child plus the union's partners (spec §4).
5. **What a person delete "touches"** (the `person.delete` target and the preview's outside-scope count):
   - The deleted people.
   - Both partners of every union they were in.
   - The children of those unions.
   - The parents on every child link that ends.
   Including the children of an emptied union is stricter than the spec's minimum: those children lose a parent.
6. **"Partners with no other connection"** (descendants mode) means a partner of a deleted descendant who:
   - has no parents recorded, and
   - has no union whose other partner survives (or is empty).
   The rule is applied once (no chaining).
7. **Restore conflicts:** restore is all or nothing, inside one transaction. It fails with `409 CONFLICT` and changes nothing when:
   - a recorded partner slot has been filled by someone else since, or
   - restoring would duplicate a live parent–child link (unique index).
   - restoring would create a parent–child **cycle**. Example: the link kid→dad was deleted, and dad was later added as kid's child. After the rows are revived, the live graph is checked with `hasCycle`.
   A slot whose union no longer exists (erased with another batch) is skipped: there is nothing left to put the person back into.
8. **Erase permanently:**
   - **Before deleting anything:** it nulls `tree_members.person_id`, deletes `invites` whose anchor or target is an erased person, and deletes `branch_stewards` anchored on them, along with grants derived from those. Each removed grant and invite gets an audit row.
   - **Unions outside the batch:** for every union **not** in this batch where an erased person sits in one slot and the other slot holds someone, it empties the erased person's slot. Otherwise the partner FK's `ON DELETE CASCADE` would destroy that union, which may be live. One way to reach this: delete union U(A,B) as b1, delete A as b2, restore b1, then erase b2.
   - **Then:** it hard-deletes the batch's links, unions and people, then the batch row.
   - **Other batches:** rows of other batches that point at an erased person go with it through the FK cascades. Restoring those batches later brings back what remains.
   - **Audit cleanup:** erase also deletes every audit row that describes the erased rows (entity id in the batch) or names an erased person (`person_ids && erased ids`). That way "erase permanently" really removes the data.
9. **Trash URLs** sit under the tree, `/api/v1/trees/:treeId/trash/...` (the spec writes `/trash/:batchId/...`), so `loadAccess` gives outsiders a 404 the same way as on every other route.
10. **Locking:** every structural write takes `pg_advisory_xact_lock('graph:<treeId>')` first (adding people and relatives, deletes, restore, erase), and so does `PATCH /trees/:id`. The person delete then locks the `trees` row `FOR UPDATE` before checking the root person. Because `PATCH /trees` takes the advisory lock before its `persons … FOR SHARE`, the two can't deadlock. They serialise on the advisory lock. See "Global lock order" in the ground rules. Plain person field edits rely on `version` instead.
11. **Adding relatives** (`as` is relative to the subject person):
    - **`partner`:** a new union (subject, relative), `marriage`/`married` unless given.
    - **`child`:**
      - With a `unionId` (one of the subject's unions): the child is linked there.
      - Without one: the child is linked to the subject's **single-parent union**, `partnership`/`partners`, created if missing ("unknown other parent").
    - **`parent`:**
      - With a `unionId`: it fills the empty slot of that parent union of the subject.
      - Without one: if the subject has exactly one parent union with an empty slot, the parent fills it. So adding a mother and then a father makes one couple.
      - Otherwise: a new single-parent union, with the subject as its child.
    - **`sibling`:** the subject must have a parent union (otherwise `VALIDATION` "Add a parent first"). With several, `unionId` is required.
    - **Kind:** `kind` (default `biological`) applies to the new link.
    - **Checks:** a link that would make someone their own ancestor is rejected with `VALIDATION`. A duplicate link is rejected with `CONFLICT`.
12. **No raw `POST /unions` or `POST /parent-child`.**
    - Relations are created through `POST …/persons` (with `attach`) for a new person, or `POST …/persons/:id/relatives` for someone already in the tree.
    - `unions` and `parent-child` have `PATCH` and `…/delete`.
13. **Audit log:**
    - Each row stores `person_ids uuid[]` (GIN-indexed), the people the change concerns. That makes a person's History a single indexed query.
    - History returns the latest 100 entries, limited to `person.*`, `union.*`, `link.*`, `residence.*` and `trash.*` actions. Field-level changes are listed only for `person.update` of that person; other entries show the action only.
    - `member.*`, `steward.*` and `invite.*` rows never set `person_ids`, so they can't reach a viewer through History. Some of that information (invites, emails) is owner-only. A later owner-only activity view can read those rows.
    - Membership, steward, invite and tree changes are audited from this phase on. Account deletion is not: the user row is gone and memberships cascade.
14. **Tree purge:**
    - `purgeDeletedTrees` runs in a single statement, inside a transaction holding `pg_try_advisory_xact_lock('purge-trees')`. It deletes trees with `deleted_at < now() − TREE_RESTORE_DAYS`. A concurrent restore wins, because the row lock makes the `WHERE` re-check.
    - No owner is assumed, so ownerless trees (left by account deletion) go too.
    - It runs in process on API start and then every `TREE_PURGE_INTERVAL_MINUTES` (default 60; `0` turns it off). `pnpm purge-trees` runs it once.
    - Photos are phase 6's concern: `purgeDeletedTrees` returns the purged ids for it.
15. **Living and dead:**
    - A person with a death date, death place or cause of death can't be `isLiving` (`VALIDATION` on `isLiving`).
    - On create, `isLiving` defaults to "no death details given".
    - A death sort year before the birth sort year is rejected.
16. **Quick add** (spec §6): first name, last name, sex and birth year. The birth year is stored as `{qualifier:'exact', date1:'YYYY'}`, so year precision already says "approximate", the same as tree creation.
17. **Text limits:**
    - Names: 100 characters (`NAME_MAX`).
    - Places, occupation, education, cause of death: 200.
    - Biography and notes: 10,000.
    - Blank optional text is stored as `null`.
18. **Deleting the root person** is `400 VALIDATION` `{ personId: ['Choose a new starting person first'] }`. The preview reports it as `blockedByRoot`, so the UI shows a fixed text.
19. **Preview access:**
    - The delete preview is open to anyone who could delete the person at all (`can(person.delete, [person])`: the owner, or a steward with the person in scope). Editors and viewers get 403.
    - A steward's preview may still say `allowed: false` with `outsideScope: N` (spec §4).
20. **Trash in the web app:** reached from the tree page when `capabilities.manageTree` (owner). No new capability flag.
21. **More limits and checks:**
    - At most `RESIDENCES_MAX = 50` residences per person (`VALIDATION`).
    - A union's `endDate` sort year can't be before its `startDate` sort year. This is checked on the merged record in `PATCH /unions` and by `updateUnionSchema` when both are sent.
    - Linking an existing person as `partner` when a live union of that pair already exists gives `409 CONFLICT`.
    - `deletion_batch_id` uses a composite `(tree_id, deletion_batch_id) → deletion_batches(tree_id, id)` FK, so a row can't name another tree's batch. It is NO ACTION: a composite `SET NULL` would also null the NOT NULL `tree_id`. Erase deletes the tagged rows before the batch, and a tree delete removes both in one statement.
    - Removing a member (or transferring ownership) cascades their grants away. Each removed grant, derived ones included, gets a `steward.revoke` audit row with `after: { reason: 'member removed' }`.
22. **Deferred:**
    - "Disconnected people" (`GET /disconnected`) moves to phase 5, with the graph endpoint.
    - The Photos tab is a placeholder until phase 6.

## File map

```
packages/shared/src/
  people.ts (+test)          person/relation/residence/delete inputs, responses, audit actions, trash
  family-graph.ts (+test)    LiveGraph, ancestorsOf/descendantsOf, wouldCycle, deletion planners
  index.ts                   + exports
apps/api/
  drizzle/0003_people.sql (generated)
  src/
    config.ts (+test)        + TREE_PURGE_INTERVAL_MINUTES
    errors.ts (+test)        + invalid(), conflict(), isUniqueViolation()
    db/schema.ts             + deletion_mode enum, deletion_batches, audit_log, deletion_batch_id columns
    db/people-schema.int.test.ts
    trees/graph.ts (+int test)       loadLiveGraph(), lockTreeGraph()
    trees/audit.ts (+test)           audit(), changedFields(), stable()
    trees/people.ts                  person column mapping, summaries, requireLivePerson()
    trees/person-view.ts             loadPersonView(): detail + residences + relations + capabilities
    trees/relation-rows.ts           requireLiveUnion(), requireLiveLink(), unionFieldsOf()
    trees/relatives.ts               relativeEnds(), attachRelative()
    trees/deletion.ts                createBatch(), applyPlan()
    trees/trash.ts                   listTrash(), trashBatchDetail(), restoreBatch(), eraseBatch()
    trees/purge.ts (+int test)       purgeDeletedTrees(), startPurgeJob()
    trees/purge-cli.ts               pnpm purge-trees
    routes/persons.ts (+int test)    get/create/update person, history
    routes/relations.ts (+int test)  add relative, edit union, edit link
    routes/residences.ts (+int test) add/edit/remove residence
    routes/deletion.ts (+int test)   delete preview, delete person, delete union, delete link
    routes/trash.ts (+int test)      list, detail, restore, erase
    routes/audit.int.test.ts         tree/member/steward/invite changes are audited
    routes/people-permissions.int.test.ts  role × action matrix on the new routes
    routes/isolation.int.test.ts     + every new route
    routes/trees.ts, members.ts, stewards.ts, invites.ts   + audit() calls
    server.ts                        start/stop the purge job
    app.ts                           register the new plugins
  test/tree-helpers.ts               + softDeleteBatch(), auditRows()
  package.json                       + purge-trees script
package.json                         + purge-trees (docker compose exec)
apps/web/src/
  auth/api.ts                        + messages
  trees/api.ts (+test)               + person, relation, residence, delete, history, trash methods
  test/fake-trees.ts                 + the same in memory
  trees/format.ts (+test)            + formatFuzzyDate(), labels
  components/FuzzyDateField.tsx (+test)
  components/Tabs.tsx
  pages/TreePage.tsx (+test)         list + panel layout, add-person route, Trash link
  pages/tree/PeopleList.tsx
  pages/tree/PersonPanel.tsx (+test) tabs
  pages/tree/InfoTab.tsx, PlacesTab.tsx, RelationsTab.tsx, HistoryTab.tsx
  pages/tree/AddPersonForm.tsx (+test)
  pages/tree/AddRelativeForm.tsx (+test)
  pages/tree/DeletePerson.tsx (+test)
  pages/TrashPage.tsx (+test)
  routes.tsx                         + /trees/:treeId/people/new, /people/:personId, /trash
  styles.css                         + two-column tree layout, tabs
README.md                            People, Trash and the purge job (dev)
```

---

## Task 1: Shared — person, relation and Trash schemas

**Files:**
- Create: `packages/shared/src/people.ts`, `packages/shared/src/people.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test** `packages/shared/src/people.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  addRelativeSchema,
  createPersonSchema,
  personConsistencyErrors,
  residenceInputSchema,
  updatePersonSchema,
  updateUnionSchema,
} from './people.js';

const year = (y: string) => ({ qualifier: 'exact' as const, date1: y });

describe('createPersonSchema', () => {
  it('fills defaults for a quick add', () => {
    const r = createPersonSchema.parse({ person: { givenName: '  Ada ' } });
    expect(r.person).toMatchObject({
      givenName: 'Ada',
      sex: 'unknown',
      birthDate: null,
      deathDate: null,
      isLiving: true,
    });
    expect(r.attach).toBeUndefined();
  });

  it('turns blank optional text into null', () => {
    const r = createPersonSchema.parse({ person: { givenName: 'Ada', surname: '   ' } });
    expect(r.person.surname).toBeNull();
  });

  it('treats someone with death details as not living unless told otherwise', () => {
    const r = createPersonSchema.parse({ person: { givenName: 'Ada', deathDate: year('1852') } });
    expect(r.person.isLiving).toBe(false);
    const bad = createPersonSchema.safeParse({
      person: { givenName: 'Ada', isLiving: true, causeOfDeath: 'Illness' },
    });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual(['person', 'isLiving']);
  });

  it('rejects a death before the birth', () => {
    const bad = createPersonSchema.safeParse({
      person: { givenName: 'Ada', birthDate: year('1900'), deathDate: year('1850') },
    });
    expect(bad.error?.issues[0]?.path).toEqual(['person', 'deathDate']);
  });

  it('accepts an attach spec with a default kind', () => {
    const to = crypto.randomUUID();
    const r = createPersonSchema.parse({ person: { givenName: 'Kid' }, attach: { to, as: 'child' } });
    expect(r.attach).toEqual({ to, as: 'child', kind: 'biological' });
    expect(
      createPersonSchema.safeParse({ person: { givenName: 'X' }, attach: { to, as: 'cousin' } })
        .success,
    ).toBe(false);
  });

  it('limits long text', () => {
    const r = createPersonSchema.safeParse({
      person: { givenName: 'Ada', biography: 'x'.repeat(10_001) },
    });
    expect(r.success).toBe(false);
  });
});

describe('updatePersonSchema', () => {
  it('needs a version and at least one field', () => {
    expect(updatePersonSchema.safeParse({ surname: 'X' }).success).toBe(false);
    expect(updatePersonSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updatePersonSchema.parse({ version: 3, surname: '' })).toEqual({
      version: 3,
      surname: null,
    });
  });

  it('can clear a date', () => {
    expect(updatePersonSchema.parse({ version: 1, birthDate: null }).birthDate).toBeNull();
  });
});

describe('personConsistencyErrors', () => {
  it('is empty for a consistent person', () => {
    expect(personConsistencyErrors({ isLiving: false, deathDate: year('1990') })).toEqual({});
  });
  it('flags living with a death place', () => {
    expect(personConsistencyErrors({ isLiving: true, deathPlace: 'Paris' })).toHaveProperty(
      'isLiving',
    );
  });
});

describe('relation inputs', () => {
  it('addRelativeSchema needs a person id', () => {
    expect(addRelativeSchema.safeParse({ as: 'partner' }).success).toBe(false);
    const personId = crypto.randomUUID();
    expect(addRelativeSchema.parse({ personId, as: 'partner' })).toEqual({
      personId,
      as: 'partner',
      kind: 'biological',
    });
  });
  it('updateUnionSchema refuses an empty change and an end before the start', () => {
    expect(updateUnionSchema.safeParse({}).success).toBe(false);
    expect(updateUnionSchema.parse({ status: 'divorced' })).toEqual({ status: 'divorced' });
    const bad = updateUnionSchema.safeParse({ startDate: year('1990'), endDate: year('1980') });
    expect(bad.error?.issues[0]?.path).toEqual(['endDate']);
  });
  it('residenceInputSchema needs a place', () => {
    expect(residenceInputSchema.safeParse({ place: ' ' }).success).toBe(false);
    expect(residenceInputSchema.parse({ place: 'Leeds' })).toEqual({
      place: 'Leeds',
      fromDate: null,
      toDate: null,
    });
  });
});
```

- [ ] **Step 2: Run it; it fails** (module not found): `pnpm --filter @family-tree/shared exec vitest run src/people.test.ts`

- [ ] **Step 3: Implement** `packages/shared/src/people.ts`

```ts
import { z } from 'zod';
import { type FuzzyDate, fuzzyDateSchema, sortYear } from './fuzzy-date.js';
import { NAME_MAX, personSummarySchema, SEXES } from './trees.js';

export const PLACE_MAX = 200;
export const LONG_TEXT_MAX = 10_000;
export const HISTORY_LIMIT = 100;
export const RESIDENCES_MAX = 50;
/** History shows only changes to people and their relations (decision 13). */
export const HISTORY_ACTION_PREFIXES = ['person.', 'union.', 'link.', 'residence.', 'trash.'] as const;

export const UNION_TYPES = ['marriage', 'partnership'] as const;
export type UnionType = (typeof UNION_TYPES)[number];
export const UNION_STATUSES = ['married', 'partners', 'divorced', 'separated', 'widowed'] as const;
export type UnionStatus = (typeof UNION_STATUSES)[number];
export const CHILD_KINDS = ['biological', 'adoptive', 'step', 'foster'] as const;
export type ChildKind = (typeof CHILD_KINDS)[number];
/** What the other person becomes, relative to the subject. */
export const RELATIVE_ROLES = ['parent', 'child', 'partner', 'sibling'] as const;
export type RelativeRole = (typeof RELATIVE_ROLES)[number];
export const DELETE_MODES = ['person', 'descendants'] as const;
export type DeleteMode = (typeof DELETE_MODES)[number];
export const BATCH_MODES = ['person', 'descendants', 'relation'] as const;
export type BatchMode = (typeof BATCH_MODES)[number];

const tooLong = (max: number) => `Use at most ${max} characters`;
/** Optional text that can be cleared: blank or null becomes null, absent stays absent. */
const clearable = (max: number) =>
  z
    .string()
    .trim()
    .max(max, tooLong(max))
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v));

const personShape = {
  givenName: z.string().trim().min(1, 'Enter a first name').max(NAME_MAX, tooLong(NAME_MAX)),
  middleName: clearable(NAME_MAX),
  surname: clearable(NAME_MAX),
  maidenName: clearable(NAME_MAX),
  nickname: clearable(NAME_MAX),
  sex: z.enum(SEXES),
  birthDate: fuzzyDateSchema.nullable(),
  birthPlace: clearable(PLACE_MAX),
  deathDate: fuzzyDateSchema.nullable(),
  deathPlace: clearable(PLACE_MAX),
  causeOfDeath: clearable(PLACE_MAX),
  isLiving: z.boolean(),
  occupation: clearable(PLACE_MAX),
  education: clearable(PLACE_MAX),
  biography: clearable(LONG_TEXT_MAX),
  notes: clearable(LONG_TEXT_MAX),
};
export type PersonField = keyof typeof personShape;
/** Every editable person field; equal to the Drizzle property names of `persons`. */
export const PERSON_FIELDS = Object.keys(personShape) as PersonField[];

export interface ConsistencyFields {
  isLiving?: boolean | undefined;
  birthDate?: FuzzyDate | null | undefined;
  deathDate?: FuzzyDate | null | undefined;
  deathPlace?: string | null | undefined;
  causeOfDeath?: string | null | undefined;
}

const hasDeathDetails = (p: ConsistencyFields) =>
  Boolean(p.deathDate || p.deathPlace || p.causeOfDeath);

/** Cross-field rules (decision 15). The API also runs this on the merged record of an update. */
export function personConsistencyErrors(p: ConsistencyFields): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  if (p.isLiving === true && hasDeathDetails(p)) {
    errors.isLiving = ['Someone with death details can’t be marked as living'];
  }
  if (p.birthDate && p.deathDate && sortYear(p.deathDate) < sortYear(p.birthDate)) {
    errors.deathDate = ['Death can’t be before birth'];
  }
  return errors;
}

type IssueSink = { addIssue(issue: { code: 'custom'; path: string[]; message: string }): void };
const addConsistencyIssues = (p: ConsistencyFields, ctx: IssueSink) => {
  for (const [path, messages] of Object.entries(personConsistencyErrors(p))) {
    for (const message of messages) ctx.addIssue({ code: 'custom', path: [path], message });
  }
};

/** A new person. */
export const personFieldsSchema = z
  .object({
    ...personShape,
    sex: personShape.sex.default('unknown'),
    birthDate: personShape.birthDate.default(null),
    deathDate: personShape.deathDate.default(null),
    isLiving: personShape.isLiving.optional(),
  })
  .superRefine(addConsistencyIssues)
  .transform((p) => ({ ...p, isLiving: p.isLiving ?? !hasDeathDetails(p) }));
export type PersonFieldsInput = z.input<typeof personFieldsSchema>;
export type PersonFields = z.output<typeof personFieldsSchema>;

/** A change to a person: the edited version plus any fields (null clears). */
export const updatePersonSchema = z
  .object(personShape)
  .partial()
  .extend({ version: z.number().int().min(1) })
  .refine((v) => PERSON_FIELDS.some((k) => v[k] !== undefined), 'Nothing to change');
export type UpdatePersonInput = z.input<typeof updatePersonSchema>;

const unionChoice = z.object({
  type: z.enum(UNION_TYPES).optional(),
  status: z.enum(UNION_STATUSES).optional(),
});

/** How a relative is attached to a subject person (decision 11). */
export const relativeLinkSchema = z.object({
  as: z.enum(RELATIVE_ROLES),
  /** child: one of the subject's unions; parent: a parent union with an empty slot; sibling: a parent union. */
  unionId: z.uuid().optional(),
  kind: z.enum(CHILD_KINDS).default('biological'),
  /** partner only: the new union's type and status. */
  union: unionChoice.optional(),
});
export type RelativeLink = z.output<typeof relativeLinkSchema>;

export const createPersonSchema = z.object({
  person: personFieldsSchema,
  /** The new person becomes `as` of `to`. */
  attach: relativeLinkSchema.extend({ to: z.uuid() }).optional(),
});
export type CreatePersonInput = z.input<typeof createPersonSchema>;

/** POST …/persons/:subjectId/relatives: the existing `personId` becomes `as` of the subject. */
export const addRelativeSchema = relativeLinkSchema.extend({ personId: z.uuid() });
export type AddRelativeInput = z.input<typeof addRelativeSchema>;

export const updateUnionSchema = z
  .object({
    type: z.enum(UNION_TYPES),
    status: z.enum(UNION_STATUSES),
    startDate: fuzzyDateSchema.nullable(),
    endDate: fuzzyDateSchema.nullable(),
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change')
  .superRefine((v, ctx) => {
    const message = unionDatesError(v);
    if (message) ctx.addIssue({ code: 'custom', path: ['endDate'], message });
  });
export type UpdateUnionInput = z.input<typeof updateUnionSchema>;

/** End before start, compared by sort year (decision 21); the API also runs it on the merged union. */
export function unionDatesError(u: {
  startDate?: FuzzyDate | null | undefined;
  endDate?: FuzzyDate | null | undefined;
}): string | null {
  return u.startDate && u.endDate && sortYear(u.endDate) < sortYear(u.startDate)
    ? 'The end can’t be before the start'
    : null;
}

export const updateParentChildSchema = z.object({ kind: z.enum(CHILD_KINDS) });

export const residenceInputSchema = z.object({
  place: z.string().trim().min(1, 'Enter a place').max(PLACE_MAX, tooLong(PLACE_MAX)),
  fromDate: fuzzyDateSchema.nullable().default(null),
  toDate: fuzzyDateSchema.nullable().default(null),
});
export type ResidenceInput = z.input<typeof residenceInputSchema>;

export const deletePersonSchema = z.object({ mode: z.enum(DELETE_MODES) });

// ---- responses (dates are ISO strings) ----

const text = z.string().nullable();

export const personDetailSchema = z.object({
  id: z.uuid(),
  givenName: z.string(),
  middleName: text,
  surname: text,
  maidenName: text,
  nickname: text,
  sex: z.enum(SEXES),
  birthDate: fuzzyDateSchema.nullable(),
  birthPlace: text,
  deathDate: fuzzyDateSchema.nullable(),
  deathPlace: text,
  causeOfDeath: text,
  isLiving: z.boolean(),
  occupation: text,
  education: text,
  biography: text,
  notes: text,
  version: z.number().int(),
  createdByName: text,
  updatedAt: z.string(),
});
export type PersonDetail = z.infer<typeof personDetailSchema>;

export const residenceSchema = z.object({
  id: z.uuid(),
  place: z.string(),
  fromDate: fuzzyDateSchema.nullable(),
  toDate: fuzzyDateSchema.nullable(),
});
export type Residence = z.infer<typeof residenceSchema>;

const unionHead = z.object({
  id: z.uuid(),
  type: z.enum(UNION_TYPES),
  status: z.enum(UNION_STATUSES),
});

export const personViewSchema = z.object({
  person: personDetailSchema,
  residences: z.array(residenceSchema),
  relations: z.object({
    /** One entry per parent union the person is a child of. */
    parents: z.array(
      z.object({
        linkId: z.uuid(),
        kind: z.enum(CHILD_KINDS),
        union: unionHead,
        parents: z.array(personSummarySchema),
      }),
    ),
    /** The person's own unions, with the partner (null when unknown) and their children. */
    unions: z.array(
      unionHead.extend({
        startDate: fuzzyDateSchema.nullable(),
        endDate: fuzzyDateSchema.nullable(),
        partner: personSummarySchema.nullable(),
        children: z.array(
          z.object({ linkId: z.uuid(), kind: z.enum(CHILD_KINDS), person: personSummarySchema }),
        ),
      }),
    ),
    /** Other children of the person's parent unions. */
    siblings: z.array(
      z.object({ unionId: z.uuid(), kind: z.enum(CHILD_KINDS), person: personSummarySchema }),
    ),
  }),
  capabilities: z.object({
    edit: z.boolean(),
    addRelative: z.boolean(),
    /** May open the delete preview (owner, or steward with the person in scope). */
    delete: z.boolean(),
  }),
});
export type PersonView = z.infer<typeof personViewSchema>;

export const updatedPersonSchema = z.object({ version: z.number().int() });

export const deletePreviewSchema = z.object({
  mode: z.enum(DELETE_MODES),
  people: z.array(personSummarySchema),
  /** Unions that end (removed, or lose this partner). */
  unions: z.number().int(),
  links: z.number().int(),
  /** Touched people outside the actor's scope (0 for the owner). */
  outsideScope: z.number().int(),
  blockedByRoot: z.boolean(),
  allowed: z.boolean(),
});
export type DeletePreview = z.infer<typeof deletePreviewSchema>;
export const batchIdSchema = z.object({ batchId: z.uuid() });

export const AUDIT_ACTIONS = [
  'tree.create',
  'tree.rename',
  'tree.changeRoot',
  'tree.delete',
  'tree.restore',
  'person.create',
  'person.update',
  'person.delete',
  'union.create',
  'union.update',
  'union.delete',
  'link.create',
  'link.update',
  'link.delete',
  'residence.create',
  'residence.update',
  'residence.delete',
  'trash.restore',
  'trash.erase',
  'member.join',
  'member.role',
  'member.remove',
  'ownership.transfer',
  'steward.grant',
  'steward.revoke',
  'invite.create',
  'invite.revoke',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export const AUDIT_ENTITIES = [
  'tree',
  'person',
  'union',
  'link',
  'residence',
  'batch',
  'member',
  'grant',
  'invite',
] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

export const historyEntrySchema = z.object({
  id: z.uuid(),
  action: z.enum(AUDIT_ACTIONS),
  at: z.string(),
  by: z.string().nullable(),
  changes: z.array(z.object({ field: z.string(), before: z.unknown(), after: z.unknown() })),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export const historySchema = z.object({ entries: z.array(historyEntrySchema) });

export const trashRootSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('person'), name: z.string() }),
  z.object({ kind: z.literal('union'), partners: z.array(z.string()) }),
  z.object({ kind: z.literal('link'), child: z.string().nullable(), parents: z.array(z.string()) }),
]);
export type TrashRoot = z.infer<typeof trashRootSchema>;

export const trashBatchSchema = z.object({
  id: z.uuid(),
  mode: z.enum(BATCH_MODES),
  createdAt: z.string(),
  deletedBy: z.string().nullable(),
  root: trashRootSchema,
  people: z.number().int(),
  unions: z.number().int(),
  links: z.number().int(),
});
export type TrashBatch = z.infer<typeof trashBatchSchema>;
export const trashListSchema = z.object({ batches: z.array(trashBatchSchema) });

export const trashBatchDetailSchema = z.object({
  batch: trashBatchSchema,
  people: z.array(personSummarySchema),
  unions: z.array(z.object({ id: z.uuid(), partners: z.array(z.string()) })),
  links: z.array(
    z.object({ id: z.uuid(), child: z.string().nullable(), parents: z.array(z.string()) }),
  ),
  /** Partner slots that restore puts back. */
  slots: z.number().int(),
});
export type TrashBatchDetail = z.infer<typeof trashBatchDetailSchema>;
```

  Add `export * from './people.js';` to `index.ts`.

- [ ] **Step 4: Run the test; it passes.** Then run `pnpm typecheck`.

- [ ] **Step 5: Commit** `feat(shared): person, relation, residence, deletion and trash schemas`

---

## Task 2: Shared — graph walks, cycle check and the deletion planner

**Files:**
- Create: `packages/shared/src/family-graph.ts`, `packages/shared/src/family-graph.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test** `packages/shared/src/family-graph.test.ts`. The recursive `visit` in `hasCycle` is fine at family scale. Generations, not people, set the recursion depth.

```ts
import { describe, expect, it } from 'vitest';
import {
  ancestorsOf,
  descendantsOf,
  hasCycle,
  type LiveGraph,
  planLinkDeletion,
  planPersonDeletion,
  planUnionDeletion,
  wouldCycle,
} from './family-graph.js';

/**
 *   grandpa + grandma (u1) → dad
 *   mgp + (none) (u4) → mum
 *   dad + mum (u2) → kid1, kid2
 *   dad + (none) (u5) → halfkid
 *   kid1 + spouse (u3) → grandkid          spouse: no parents, no other union
 *   kid2 + partner2 (u6); partner2 + outsider (u7)
 */
const g: LiveGraph = {
  persons: [
    'grandpa', 'grandma', 'mgp', 'dad', 'mum', 'kid1', 'kid2', 'halfkid', 'spouse',
    'grandkid', 'partner2', 'outsider',
  ].map((id) => ({ id })),
  unions: [
    { id: 'u1', partnerAId: 'grandpa', partnerBId: 'grandma' },
    { id: 'u2', partnerAId: 'dad', partnerBId: 'mum' },
    { id: 'u3', partnerAId: 'kid1', partnerBId: 'spouse' },
    { id: 'u4', partnerAId: 'mgp', partnerBId: null },
    { id: 'u5', partnerAId: 'dad', partnerBId: null },
    { id: 'u6', partnerAId: 'kid2', partnerBId: 'partner2' },
    { id: 'u7', partnerAId: 'partner2', partnerBId: 'outsider' },
  ],
  parentChild: [
    { id: 'l-dad', unionId: 'u1', childId: 'dad' },
    { id: 'l-mum', unionId: 'u4', childId: 'mum' },
    { id: 'l-kid1', unionId: 'u2', childId: 'kid1' },
    { id: 'l-kid2', unionId: 'u2', childId: 'kid2' },
    { id: 'l-half', unionId: 'u5', childId: 'halfkid' },
    { id: 'l-gk', unionId: 'u3', childId: 'grandkid' },
  ],
};
const sorted = (xs: Iterable<string>) => [...xs].sort();

describe('walks', () => {
  it('finds ancestors and descendants, including the start', () => {
    expect(sorted(ancestorsOf(g, 'grandkid'))).toEqual(
      sorted(['grandkid', 'kid1', 'spouse', 'dad', 'mum', 'grandpa', 'grandma', 'mgp']),
    );
    expect(sorted(descendantsOf(g, 'dad'))).toEqual(
      sorted(['dad', 'kid1', 'kid2', 'halfkid', 'grandkid']),
    );
  });
  it('detects a link that would make someone their own ancestor', () => {
    expect(wouldCycle(g, ['kid1'], ['dad'])).toBe(true);
    expect(wouldCycle(g, ['dad'], ['dad'])).toBe(true);
    expect(wouldCycle(g, ['mum'], ['grandkid'])).toBe(false);
    expect(wouldCycle(g, ['new-person'], ['dad'])).toBe(false);
  });
  it('detects an existing cycle', () => {
    expect(hasCycle(g)).toBe(false);
    const looped: LiveGraph = {
      ...g,
      unions: [...g.unions, { id: 'u9', partnerAId: 'grandkid', partnerBId: null }],
      parentChild: [...g.parentChild, { id: 'l-loop', unionId: 'u9', childId: 'dad' }],
    };
    expect(hasCycle(looped)).toBe(true);
  });
});

describe('planPersonDeletion, just this person', () => {
  it('empties their slot where a partner survives and removes unions left without one', () => {
    const p = planPersonDeletion(g, 'dad', 'person');
    expect(p.personIds).toEqual(['dad']);
    expect(p.slots).toEqual([{ unionId: 'u2', slot: 'a', personId: 'dad' }]);
    expect(p.unionIds).toEqual(['u5']);
    expect(sorted(p.parentChildIds)).toEqual(['l-dad', 'l-half']);
    expect(sorted(p.touchedPersonIds)).toEqual(
      sorted(['dad', 'mum', 'grandpa', 'grandma', 'kid1', 'kid2', 'halfkid']),
    );
  });
  it('keeps the union and children with the surviving partner', () => {
    const p = planPersonDeletion(g, 'grandma', 'person');
    expect(p.slots).toEqual([{ unionId: 'u1', slot: 'b', personId: 'grandma' }]);
    expect(p.unionIds).toEqual([]);
    expect(p.parentChildIds).toEqual([]);
    expect(sorted(p.touchedPersonIds)).toEqual(sorted(['grandma', 'grandpa', 'dad']));
  });
});

describe('planPersonDeletion, with descendants', () => {
  it('takes descendants and partners with no other connection', () => {
    const p = planPersonDeletion(g, 'dad', 'descendants');
    expect(p.personIds[0]).toBe('dad');
    expect(sorted(p.personIds)).toEqual(
      sorted(['dad', 'kid1', 'kid2', 'halfkid', 'grandkid', 'spouse']),
    );
    expect(sorted(p.unionIds)).toEqual(['u3', 'u5']);
    expect(p.slots).toEqual([
      { unionId: 'u2', slot: 'a', personId: 'dad' },
      { unionId: 'u6', slot: 'a', personId: 'kid2' },
    ]);
    expect(sorted(p.parentChildIds)).toEqual(sorted(['l-dad', 'l-kid1', 'l-kid2', 'l-gk', 'l-half']));
    expect(p.touchedPersonIds).toContain('partner2');
    expect(p.touchedPersonIds).not.toContain('outsider');
  });
});

describe('relation plans', () => {
  it('a union takes its child links with it', () => {
    const p = planUnionDeletion(g, 'u2');
    expect(p).toMatchObject({ personIds: [], unionIds: ['u2'], slots: [] });
    expect(sorted(p.parentChildIds)).toEqual(['l-kid1', 'l-kid2']);
    expect(sorted(p.touchedPersonIds)).toEqual(sorted(['dad', 'mum', 'kid1', 'kid2']));
  });
  it('a link touches the child and every parent', () => {
    const p = planLinkDeletion(g, 'l-kid1');
    expect(p).toMatchObject({ personIds: [], unionIds: [], parentChildIds: ['l-kid1'] });
    expect(sorted(p.touchedPersonIds)).toEqual(sorted(['kid1', 'dad', 'mum']));
  });
});
```

- [ ] **Step 2: Run it; it fails.**

- [ ] **Step 3: Implement** `packages/shared/src/family-graph.ts`

```ts
import type { DeleteMode } from './people.js';

/** Live rows only: non-deleted people, unions and links whose union and child are live. */
export interface LiveGraph {
  persons: readonly { id: string }[];
  unions: readonly GraphUnion[];
  parentChild: readonly GraphLink[];
}
export interface GraphUnion {
  id: string;
  partnerAId: string | null;
  partnerBId: string | null;
}
export interface GraphLink {
  id: string;
  unionId: string;
  childId: string;
}

export const partnersOf = (u: GraphUnion): string[] =>
  [u.partnerAId, u.partnerBId].filter((p): p is string => p !== null);

const add = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
};

function indexGraph(graph: LiveGraph) {
  const unionById = new Map(graph.unions.map((u) => [u.id, u]));
  const unionsOf = new Map<string, GraphUnion[]>();
  const linksByUnion = new Map<string, GraphLink[]>();
  const linksByChild = new Map<string, GraphLink[]>();
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const u of graph.unions) for (const p of partnersOf(u)) add(unionsOf, p, u);
  for (const l of graph.parentChild) {
    const u = unionById.get(l.unionId);
    if (!u) continue;
    add(linksByUnion, l.unionId, l);
    add(linksByChild, l.childId, l);
    for (const p of partnersOf(u)) {
      add(children, p, l.childId);
      add(parents, l.childId, p);
    }
  }
  return { unionById, unionsOf, linksByUnion, linksByChild, children, parents };
}

function reach(start: string, next: Map<string, string[]>): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
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

/** `id` and everyone above it, through any kind of parent–child link. */
export const ancestorsOf = (graph: LiveGraph, id: string) => reach(id, indexGraph(graph).parents);
/** `id` and everyone below it. */
export const descendantsOf = (graph: LiveGraph, id: string) =>
  reach(id, indexGraph(graph).children);

/** Whether making every `parentIds` a parent of every `childIds` would make someone their own ancestor. */
export function wouldCycle(graph: LiveGraph, parentIds: string[], childIds: string[]): boolean {
  const { children } = indexGraph(graph);
  return childIds.some((c) => {
    const below = reach(c, children);
    return parentIds.some((p) => below.has(p));
  });
}

/** Whether the live graph contains a parent–child cycle (a restore check, decision 7). */
export function hasCycle(graph: LiveGraph): boolean {
  const { children } = indexGraph(graph);
  const state = new Map<string, 1 | 2>(); // 1 = on the current path, 2 = done
  const visit = (id: string): boolean => {
    state.set(id, 1);
    for (const c of children.get(id) ?? []) {
      const s = state.get(c);
      if (s === 1) return true;
      if (s === undefined && visit(c)) return true;
    }
    state.set(id, 2);
    return false;
  };
  return graph.persons.some((p) => state.get(p.id) === undefined && visit(p.id));
}

export interface DeletionSlot {
  unionId: string;
  slot: 'a' | 'b';
  personId: string;
}

export interface DeletionPlan {
  /** People to soft-delete; for a person delete the target comes first. */
  personIds: string[];
  /** Unions to soft-delete (no partner left, or the deleted relation itself). */
  unionIds: string[];
  parentChildIds: string[];
  /** Partner slots to empty on unions whose other partner survives. */
  slots: DeletionSlot[];
  /** Every person the delete touches: the can() target (decision 5). */
  touchedPersonIds: string[];
}

/** Spec §4 "Deleting a person", as a plan over the live graph. `personId` must be in it. */
export function planPersonDeletion(
  graph: LiveGraph,
  personId: string,
  mode: DeleteMode,
): DeletionPlan {
  const ix = indexGraph(graph);
  const doomed = new Set([personId]);
  if (mode === 'descendants') {
    for (const d of reach(personId, ix.children)) doomed.add(d);
    const otherOf = (u: GraphUnion, self: string) =>
      u.partnerAId === self ? u.partnerBId : u.partnerAId;
    const loners: string[] = [];
    for (const d of doomed) {
      for (const u of ix.unionsOf.get(d) ?? []) {
        const x = otherOf(u, d);
        if (x === null || doomed.has(x) || ix.linksByChild.has(x)) continue;
        const allInside = (ix.unionsOf.get(x) ?? []).every((v) => {
          const o = otherOf(v, x);
          return o !== null && doomed.has(o);
        });
        if (allInside) loners.push(x);
      }
    }
    for (const x of loners) doomed.add(x);
  }

  const unionIds: string[] = [];
  const links = new Set<string>();
  const slots: DeletionSlot[] = [];
  const touched = new Set(doomed);
  for (const u of graph.unions) {
    const a = u.partnerAId !== null && doomed.has(u.partnerAId);
    const b = u.partnerBId !== null && doomed.has(u.partnerBId);
    if (!a && !b) continue;
    for (const p of partnersOf(u)) touched.add(p);
    for (const l of ix.linksByUnion.get(u.id) ?? []) touched.add(l.childId);
    const survivor = (u.partnerAId !== null && !a) || (u.partnerBId !== null && !b);
    if (!survivor) {
      unionIds.push(u.id);
      for (const l of ix.linksByUnion.get(u.id) ?? []) links.add(l.id);
    } else {
      if (a) slots.push({ unionId: u.id, slot: 'a', personId: u.partnerAId! });
      if (b) slots.push({ unionId: u.id, slot: 'b', personId: u.partnerBId! });
    }
  }
  for (const d of doomed) {
    for (const l of ix.linksByChild.get(d) ?? []) {
      links.add(l.id);
      for (const p of partnersOf(ix.unionById.get(l.unionId)!)) touched.add(p);
    }
  }
  const rest = [...doomed].filter((id) => id !== personId).sort();
  return {
    personIds: [personId, ...rest],
    unionIds,
    parentChildIds: [...links],
    slots,
    touchedPersonIds: [...touched],
  };
}

/** Deleting a union also removes its child links (decision 4). */
export function planUnionDeletion(graph: LiveGraph, unionId: string): DeletionPlan {
  const ix = indexGraph(graph);
  const u = ix.unionById.get(unionId);
  if (!u) throw new Error('union is not in the graph');
  const links = ix.linksByUnion.get(unionId) ?? [];
  return {
    personIds: [],
    unionIds: [unionId],
    parentChildIds: links.map((l) => l.id),
    slots: [],
    touchedPersonIds: [...new Set([...partnersOf(u), ...links.map((l) => l.childId)])],
  };
}

export function planLinkDeletion(graph: LiveGraph, linkId: string): DeletionPlan {
  const ix = indexGraph(graph);
  const l = graph.parentChild.find((x) => x.id === linkId);
  if (!l) throw new Error('link is not in the graph');
  return {
    personIds: [],
    unionIds: [],
    parentChildIds: [linkId],
    slots: [],
    touchedPersonIds: [l.childId, ...partnersOf(ix.unionById.get(l.unionId)!)],
  };
}
```

  Add `export * from './family-graph.js';` to `index.ts`. Prettier will reflow the fixture's person list; that's fine.

- [ ] **Step 4: Run the test; it passes.** Then run `pnpm typecheck`.

- [ ] **Step 5: Commit** `feat(shared): graph walks, cycle check and deletion planner`

---

## Task 3: Database — deletion batches, audit log (migration 0003)

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/drizzle/0003_people.sql` (generated), `apps/api/src/db/people-schema.int.test.ts`

- [ ] **Step 1: Edit the schema.** In `schema.ts`:

  **Import:** `type AuditAction, type DeletionSlot` from `@family-tree/shared`, next to `FuzzyDate`.

  **Batch column:** add this column to `persons`, `unions` and `parentChild`, right after `...timestamps()`:

```ts
    /** The Trash batch that soft-deleted this row (spec §4); null while live. */
    deletionBatchId: uuid('deletion_batch_id'),
```

  Then add these to each table's extras. For `persons`:

```ts
    // NO ACTION and composite (decision 21): a row can only name a batch of its own tree. Erase
    // deletes tagged rows before the batch; a tree delete removes both in one statement.
    foreignKey({
      name: 'persons_deletion_batch_fk',
      columns: [t.treeId, t.deletionBatchId],
      foreignColumns: [deletionBatches.treeId, deletionBatches.id],
    }),
    index('persons_deletion_batch_idx').on(t.deletionBatchId),
```

  Add the same as `unions_deletion_batch_fk` / `unions_deletion_batch_idx` and `parent_child_deletion_batch_fk` / `parent_child_deletion_batch_idx`. MATCH SIMPLE means a null `deletion_batch_id` skips the check. `persons` extras already reference tables declared later (as `trees` does with `persons`). If TypeScript reports a cycle, annotate the extras callback's return type as `PgTableExtraConfigValue[]`, the same as `trees`.

  **New section** at the end of the file:

```ts
// ---------------------------------------------------------------------------------------------
// Trash and audit (spec §3, §4, §8).

export const deletionModeEnum = pgEnum('deletion_mode', ['person', 'descendants', 'relation']);

/**
 * One delete operation. Rows it soft-deleted carry its id in deletion_batch_id; partner slots it
 * emptied are listed in `slots`. Restore and erase act on the whole batch. The root ids are plain
 * uuids (no FK): they point into the batch itself and go when it is erased.
 */
export const deletionBatches = pgTable(
  'deletion_batches',
  {
    id: id(),
    treeId: uuid('tree_id')
      .notNull()
      .references(() => trees.id, { onDelete: 'cascade' }),
    deletedByUserId: uuid('deleted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    mode: deletionModeEnum('mode').notNull(),
    rootPersonId: uuid('root_person_id'),
    rootUnionId: uuid('root_union_id'),
    rootParentChildId: uuid('root_parent_child_id'),
    slots: jsonb('slots')
      .$type<DeletionSlot[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    restoredAt: timestamp('restored_at', { withTimezone: true }),
  },
  (t) => [
    // Target of the composite deletion_batch FKs; a UNIQUE constraint so it exists inside CREATE TABLE.
    unique('deletion_batches_tree_id_uq').on(t.treeId, t.id),
    index('deletion_batches_tree_idx').on(t.treeId, t.createdAt),
  ],
);

/** Every change to tree data (spec §8). person_ids: the people it concerns (a person's History). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    treeId: uuid('tree_id')
      .notNull()
      .references(() => trees.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').$type<AuditAction>().notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    personIds: uuid('person_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_tree_created_idx').on(t.treeId, t.createdAt),
    index('audit_log_person_ids_idx').using('gin', t.personIds),
    index('audit_log_entity_idx').on(t.entityId),
  ],
);
```

  `deletionBatches` is declared after `persons`, which is fine: the reference is a thunk, and the `AnyPgColumn` return type breaks the type cycle (the same pattern as `branchStewards.parentGrantId`).

- [ ] **Step 2: Generate the migration.** Run `pnpm --filter @family-tree/api exec drizzle-kit generate --name people`. Open `apps/api/drizzle/0003_people.sql` and check:
  - `CREATE TYPE "deletion_mode"`.
  - Both tables.
  - The three `deletion_batch_id` columns, with composite `(tree_id, deletion_batch_id)` FKs to `deletion_batches_tree_id_uq`, which must be created before them.
  - The GIN index (`USING gin ("person_ids")`).
  - If drizzle emits an FK before the table it references exists, move those `ALTER TABLE … ADD CONSTRAINT` lines to the end of the file.

- [ ] **Step 3: Write the integration test** `apps/api/src/db/people-schema.int.test.ts`. Use the same structure as `tree-access-schema.int.test.ts`: `createDeps(loadConfig())`, direct inserts and `afterAll` cleanup.
  - **Setup:** a user and a tree, with persons A and B and a union (A, B).
  - **Test cases:**
    1. **Batch FK:** with a batch and `persons.deletion_batch_id` set on A, deleting the batch row is rejected (NO ACTION). Clearing A's tag first, then deleting it, works. Tagging A with a batch of **another tree** is rejected (composite FK).
    2. **Slots default:** `slots` defaults to `[]` and round-trips `[{unionId, slot:'a', personId}]`.
    3. **Audit person ids:** an `audit_log` row with `person_ids = [A]` is found by `arrayContains(auditLog.personIds, [A.id])`.
    4. **User deleted:** deleting the user sets `audit_log.user_id` and `deletion_batches.deleted_by_user_id` to null.
    5. **Tree deleted (the purge precondition):** in a tree with a member whose `person_id` is A, an invite anchored on A, a grant anchored on A, a batch and audit rows, `db.delete(trees)` succeeds and leaves no rows behind in any of these tables.

- [ ] **Step 4: Run the test; it passes.** Restart nothing: `global-setup.ts` runs migrations.

- [ ] **Step 5: Commit** `feat(db): deletion batches, audit log and batch columns (migration 0003)`

---

## Task 4: API — error helpers, audit writer, live graph, person mapping

**Files:**
- Modify: `apps/api/src/errors.ts`, `apps/api/src/errors.test.ts`
- Create: `apps/api/src/trees/audit.ts`, `apps/api/src/trees/audit.test.ts`, `apps/api/src/trees/graph.ts`, `apps/api/src/trees/graph.int.test.ts`, `apps/api/src/trees/people.ts`
- Modify: `apps/api/test/tree-helpers.ts`

- [ ] **Step 1: Write the failing unit tests.**

  **`errors.test.ts`:**
  - `invalid('x', 'msg')` is an `AppError` with `VALIDATION`/400 and details `{ x: ['msg'] }`.
  - `conflict('m')` gives 409 `CONFLICT`.
  - `isUniqueViolation` is true for `{ code: '23505' }` nested two `cause`s deep, and false for `{ code: '23503' }` and for a plain `Error`.

  **`trees/audit.test.ts`:**

```ts
import { describe, expect, it } from 'vitest';
import { changedFields, stable } from './audit.js';

describe('changedFields', () => {
  it('returns only the fields that differ', () => {
    expect(
      changedFields({ a: 1, b: 'x', c: null }, { a: 1, b: 'y', c: null }, ['a', 'b', 'c']),
    ).toEqual({ before: { b: 'x' }, after: { b: 'y' } });
  });
  it('ignores jsonb key order and undefined vs null', () => {
    const before = { d: { date1: '1950', qualifier: 'exact' }, e: null };
    const after = { d: { qualifier: 'exact', date1: '1950' }, e: undefined };
    expect(changedFields(before, after, ['d', 'e'])).toBeNull();
  });
});

describe('stable', () => {
  it('sorts object keys recursively', () => {
    expect(stable({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});
```

- [ ] **Step 2: Run them; they fail.**

- [ ] **Step 3: Implement.**

  **`errors.ts`:** add these:

```ts
export const invalid = (field: string, message: string) =>
  new AppError('VALIDATION', 400, 'Some fields are invalid', { [field]: [message] });

export const conflict = (message: string) => new AppError('CONFLICT', 409, message);

/** A Postgres unique violation (23505) anywhere in the cause chain (Drizzle wraps driver errors). */
export function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
    if ((e as { code?: unknown }).code === '23505') return true;
  }
  return false;
}
```

  The local `invalid` helpers in `stewards.ts` and `invites.ts` can switch to this one. That's optional, and must not change behaviour.

  **`trees/audit.ts`:**

```ts
import type { AuditAction, AuditEntity } from '@family-tree/shared';
import type { Queryable } from '../db/client.js';
import { auditLog } from '../db/schema.js';

export interface AuditActor {
  treeId: string;
  userId: string | null;
}

export interface AuditEntry {
  action: AuditAction;
  entityType: AuditEntity;
  entityId: string | null;
  /** The people this change concerns; they see it in their History. */
  personIds?: readonly string[];
  before?: unknown;
  after?: unknown;
}

/** Records one change (spec §8). Always call it inside the transaction that makes the change. */
export async function audit(db: Queryable, actor: AuditActor, e: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    treeId: actor.treeId,
    userId: actor.userId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    personIds: [...new Set(e.personIds ?? [])],
    before: e.before ?? null,
    after: e.after ?? null,
  });
}

/** JSON with object keys sorted, so jsonb values (which Postgres reorders) compare equal. */
export function stable(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, x]) => x !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(',')}}`;
}

/** The fields of `keys` that differ, as { before, after } with only those fields; null if none. */
export function changedFields<K extends string>(
  before: Partial<Record<K, unknown>>,
  after: Partial<Record<K, unknown>>,
  keys: readonly K[],
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of keys) {
    if (stable(before[k] ?? null) !== stable(after[k] ?? null)) {
      b[k] = before[k] ?? null;
      a[k] = after[k] ?? null;
    }
  }
  return Object.keys(a).length > 0 ? { before: b, after: a } : null;
}
```

  **`trees/graph.ts`:**

```ts
import type { LiveGraph } from '@family-tree/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { parentChild, persons, unions } from '../db/schema.js';

/**
 * The tree's live skeleton (ids only), for the planners in packages/shared. A partner that isn't
 * live reads as an empty slot; a union with no live partner, and links whose union or child
 * isn't live, are left out. Fine for family-sized trees (one row per person/union/link).
 */
export async function loadLiveGraph(db: Queryable, treeId: string): Promise<LiveGraph> {
  const people = await db
    .select({ id: persons.id })
    .from(persons)
    .where(and(eq(persons.treeId, treeId), isNull(persons.deletedAt)));
  const live = new Set(people.map((p) => p.id));
  const liveOrNull = (id: string | null) => (id !== null && live.has(id) ? id : null);
  const rawUnions = await db
    .select({ id: unions.id, partnerAId: unions.partnerAId, partnerBId: unions.partnerBId })
    .from(unions)
    .where(and(eq(unions.treeId, treeId), isNull(unions.deletedAt)));
  const liveUnions = rawUnions
    .map((u) => ({ id: u.id, partnerAId: liveOrNull(u.partnerAId), partnerBId: liveOrNull(u.partnerBId) }))
    .filter((u) => u.partnerAId !== null || u.partnerBId !== null);
  const unionIds = new Set(liveUnions.map((u) => u.id));
  const links = await db
    .select({ id: parentChild.id, unionId: parentChild.unionId, childId: parentChild.childId })
    .from(parentChild)
    .where(and(eq(parentChild.treeId, treeId), isNull(parentChild.deletedAt)));
  return {
    persons: people,
    unions: liveUnions,
    parentChild: links.filter((l) => unionIds.has(l.unionId) && live.has(l.childId)),
  };
}

/** Serialises structural changes to one tree (decision 10). Call first inside the transaction. */
export const lockTreeGraph = (db: Queryable, treeId: string) =>
  db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`graph:${treeId}`}, 0))`);
```

  **`trees/people.ts`:**

```ts
import { type FuzzyDate, PERSON_FIELDS, type PersonDetail, type PersonField, sortYear } from '@family-tree/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { persons } from '../db/schema.js';
import { notFound } from '../errors.js';

export type PersonRow = typeof persons.$inferSelect;

/** The columns of a PersonSummary (same shape as GET /persons). */
export const summaryColumns = {
  id: persons.id,
  givenName: persons.givenName,
  middleName: persons.middleName,
  surname: persons.surname,
  birthYear: persons.birthSortYear,
  deathYear: persons.deathSortYear,
  isLiving: persons.isLiving,
};

export const isLivePerson = (treeId: string, personId: string) =>
  and(eq(persons.treeId, treeId), eq(persons.id, personId), isNull(persons.deletedAt));

/** A live person of this tree, or 404. */
export async function requireLivePerson(
  db: Queryable,
  treeId: string,
  personId: string,
): Promise<PersonRow> {
  const [row] = await db.select().from(persons).where(isLivePerson(treeId, personId));
  if (!row) throw notFound();
  return row;
}

/** Column values for the given fields plus the derived sort years; undefined fields are skipped. */
export function personColumns(
  input: Partial<Record<PersonField, unknown>>,
): Partial<typeof persons.$inferInsert> {
  const cols: Record<string, unknown> = {};
  for (const k of PERSON_FIELDS) if (input[k] !== undefined) cols[k] = input[k];
  const birth = input.birthDate as FuzzyDate | null | undefined;
  const death = input.deathDate as FuzzyDate | null | undefined;
  if (birth !== undefined) cols.birthSortYear = birth ? sortYear(birth) : null;
  if (death !== undefined) cols.deathSortYear = death ? sortYear(death) : null;
  return cols as Partial<typeof persons.$inferInsert>;
}

export function personFieldsOf(row: PersonRow): Pick<PersonRow, PersonField> {
  return Object.fromEntries(PERSON_FIELDS.map((k) => [k, row[k]])) as Pick<PersonRow, PersonField>;
}

export function toPersonDetail(row: PersonRow, createdByName: string | null): PersonDetail {
  return {
    id: row.id,
    ...personFieldsOf(row),
    version: row.version,
    createdByName,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Display name for Trash labels ("Ada King Lovelace"). Data, not interface text. */
export const fullName = (p: { givenName: string; middleName: string | null; surname: string | null }) =>
  [p.givenName, p.middleName, p.surname].filter(Boolean).join(' ');
```

  **`test/tree-helpers.ts`:** add these:

```ts
/** Audit rows of a tree, oldest first. */
export async function auditRows(db: Db, treeId: string) {
  return db.select().from(auditLog).where(eq(auditLog.treeId, treeId)).orderBy(asc(auditLog.createdAt));
}
```

  Import `asc` and `eq` from drizzle-orm, and `auditLog` from the schema.

- [ ] **Step 4: Write** `trees/graph.int.test.ts`:
  - **Setup:** persons A, B, C and D, with union U1 (A, B) → C, and union U2 (D, null).
  - **Soft deletes:** soft-delete D (set `deletedAt`) and soft-delete the link to C on a second union U3 (A, null) → C.
  - **Expected `loadLiveGraph`:**
    - It has no D.
    - It has no U2, because its only partner is dead.
    - U1 is present.
    - It has no U3 → C link.
  - **Another tree's rows** never appear.
  - **`lockTreeGraph` blocks:** two transactions on the same tree can't hold it at once. Start tx1 holding the lock, start tx2 and record when it acquires it, then release tx1. tx2's timestamp comes after tx1's commit.

- [ ] **Step 5: Run the unit and integration tests; they pass.** **Commit** `feat(api): audit writer, live graph loader and person mapping helpers`

---

## Task 5: API — person routes (read, create, update with version)

**Files:**
- Create: `apps/api/src/trees/person-view.ts`, `apps/api/src/routes/persons.ts`, `apps/api/src/routes/persons.int.test.ts`
- Modify: `apps/api/src/app.ts`

Routes (the list `GET /trees/:treeId/persons` stays in `trees.ts`):

| Method | Path | Authorises |
|---|---|---|
| GET | `/api/v1/trees/:treeId/persons/:personId` | `tree.view` |
| POST | `/api/v1/trees/:treeId/persons` | `person.add`. Ends: none, or the attach ends (Task 6) |
| PATCH | `/api/v1/trees/:treeId/persons/:personId` | `person.edit` |

- [ ] **Step 1: Write the failing integration test** `apps/api/src/routes/persons.int.test.ts`. Use the same app and deps boilerplate as `stewards.int.test.ts`.

```ts
const url = (t: string, p = '') => `/api/v1/trees/${t}/persons${p ? `/${p}` : ''}`;

describe('person routes', () => {
  it('creates, reads and edits a person with versions and audit rows', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const created = await call(app, 'POST', url(treeId), {
      jar: owner.jar,
      body: { person: { givenName: 'Ada', surname: 'King', birthDate: { qualifier: 'about', date1: '1815' } } },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    const [row] = await db.select().from(persons).where(eq(persons.id, id));
    expect(row).toMatchObject({ createdBy: owner.userId, updatedBy: owner.userId, birthSortYear: 1815, version: 1 });

    const view = await call(app, 'GET', url(treeId, id), { jar: owner.jar });
    expect(view.statusCode).toBe(200);
    expect(view.json()).toMatchObject({
      person: { id, givenName: 'Ada', surname: 'King', version: 1, createdByName: 'Owner', isLiving: true },
      residences: [],
      relations: { parents: [], unions: [], siblings: [] },
      capabilities: { edit: true, addRelative: true, delete: true },
    });

    const edit = await call(app, 'PATCH', url(treeId, id), {
      jar: owner.jar,
      body: { version: 1, surname: 'Lovelace', birthDate: { qualifier: 'exact', date1: '1815-12-10' } },
    });
    expect(edit.statusCode).toBe(200);
    expect(edit.json()).toEqual({ version: 2 });
    const stale = await call(app, 'PATCH', url(treeId, id), {
      jar: owner.jar,
      body: { version: 1, surname: 'Byron' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('CONFLICT');
    const [after] = await db.select().from(persons).where(eq(persons.id, id));
    expect(after).toMatchObject({ surname: 'Lovelace', version: 2 });

    const log = (await auditRows(db, treeId)).filter((r) => r.entityId === id);
    expect(log.map((r) => r.action)).toEqual(['person.create', 'person.update']);
    expect(log[1]).toMatchObject({
      userId: owner.userId,
      personIds: [id],
      before: { surname: 'King', birthDate: { qualifier: 'about', date1: '1815' } },
      after: { surname: 'Lovelace', birthDate: { qualifier: 'exact', date1: '1815-12-10' } },
    });
  });
});
```

  **More cases in the same file:**
  1. **A no-op update** (the same surname again, with the current version) returns the current version, writes nothing and adds no audit row.
  2. **Living with a death date:** `PATCH {version, isLiving: true}` on a person who has a `deathDate` gives 400 `VALIDATION`, with `details.isLiving`.
  3. **Validation:** an empty `givenName` on create gives 400. An unknown `sex` gives 400.
  4. **Wrong ids:**
     - An unknown person id gives 404.
     - A person of another tree, through this tree's URL, gives 404.
     - A soft-deleted person gives 404 on GET and PATCH.
  5. **Attach:** `POST` with `attach: { to: <root>, as: 'child' }` creates the child and a single-parent union of the root. `GET` on the root shows `relations.unions[0]` with `partner: null` and `children[0].person.givenName` set to the new name.
  6. **Viewer:** POST and PATCH give 403 `FORBIDDEN`. GET gives 200, with `capabilities` all false.

- [ ] **Step 2: Run it; it fails** (404s, no routes).

- [ ] **Step 3: Implement** `apps/api/src/trees/person-view.ts`

```ts
import type { PersonSummary, PersonView } from '@family-tree/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { parentChild, persons, residences, unions, users } from '../db/schema.js';
import { notFound } from '../errors.js';
import { can } from '../permissions/can.js';
import type { Access } from './access.js';
import { isLivePerson, summaryColumns, toPersonDetail } from './people.js';

/** Everything the person panel shows. Relations only use live unions, links and people. */
export async function loadPersonView(
  db: Queryable,
  access: Access,
  personId: string,
): Promise<PersonView> {
  const { treeId } = access;
  const [row] = await db
    .select({ p: persons, createdByName: users.name })
    .from(persons)
    .leftJoin(users, eq(users.id, persons.createdBy))
    .where(isLivePerson(treeId, personId));
  if (!row) throw notFound();

  const homes = await db
    .select({
      id: residences.id,
      place: residences.place,
      fromDate: residences.fromDate,
      toDate: residences.toDate,
    })
    .from(residences)
    .where(
      and(eq(residences.treeId, treeId), eq(residences.personId, personId), isNull(residences.deletedAt)),
    )
    .orderBy(asc(residences.createdAt));

  const people = new Map<string, PersonSummary>(
    (
      await db
        .select(summaryColumns)
        .from(persons)
        .where(and(eq(persons.treeId, treeId), isNull(persons.deletedAt)))
    ).map((p) => [p.id, p]),
  );
  const liveUnions = await db
    .select({
      id: unions.id,
      partnerAId: unions.partnerAId,
      partnerBId: unions.partnerBId,
      type: unions.type,
      status: unions.status,
      startDate: unions.startDate,
      endDate: unions.endDate,
    })
    .from(unions)
    .where(and(eq(unions.treeId, treeId), isNull(unions.deletedAt)));
  const unionById = new Map(liveUnions.map((u) => [u.id, u]));
  const links = (
    await db
      .select({
        id: parentChild.id,
        unionId: parentChild.unionId,
        childId: parentChild.childId,
        kind: parentChild.kind,
      })
      .from(parentChild)
      .where(and(eq(parentChild.treeId, treeId), isNull(parentChild.deletedAt)))
  ).filter((l) => unionById.has(l.unionId) && people.has(l.childId));

  const summary = (id: string | null) => (id === null ? null : (people.get(id) ?? null));
  const partnerSummaries = (u: { partnerAId: string | null; partnerBId: string | null }) =>
    [u.partnerAId, u.partnerBId].map(summary).filter((p): p is PersonSummary => p !== null);

  const parents = links
    .filter((l) => l.childId === personId)
    .map((l) => {
      const u = unionById.get(l.unionId)!;
      return {
        linkId: l.id,
        kind: l.kind,
        union: { id: u.id, type: u.type, status: u.status },
        parents: partnerSummaries(u),
      };
    });
  const parentUnionIds = new Set(parents.map((p) => p.union.id));
  const siblings = links
    .filter((l) => parentUnionIds.has(l.unionId) && l.childId !== personId)
    .map((l) => ({ unionId: l.unionId, kind: l.kind, person: people.get(l.childId)! }));
  const own = liveUnions
    .filter((u) => u.partnerAId === personId || u.partnerBId === personId)
    .map((u) => ({
      id: u.id,
      type: u.type,
      status: u.status,
      startDate: u.startDate,
      endDate: u.endDate,
      partner: summary(u.partnerAId === personId ? u.partnerBId : u.partnerAId),
      children: links
        .filter((l) => l.unionId === u.id)
        .map((l) => ({ linkId: l.id, kind: l.kind, person: people.get(l.childId)! })),
    }));

  return {
    person: toPersonDetail(row.p, row.createdByName),
    residences: homes,
    relations: { parents, unions: own, siblings },
    capabilities: {
      edit: can(access, 'person.edit', { kind: 'person', personId }),
      addRelative: can(access, 'person.add', { kind: 'relation', ends: [personId] }),
      delete: can(access, 'person.delete', { kind: 'people', personIds: [personId] }),
    },
  };
}
```

  **`apps/api/src/routes/persons.ts`:**

```ts
import {
  createPersonSchema,
  PERSON_FIELDS,
  personConsistencyErrors,
  updatePersonSchema,
} from '@family-tree/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import { persons } from '../db/schema.js';
import { AppError, conflict, idParam, notFound, parseBody } from '../errors.js';
import { TREE } from '../permissions/can.js';
import { authorize, loadAccess } from '../trees/access.js';
import { audit, changedFields } from '../trees/audit.js';
import { loadLiveGraph, lockTreeGraph } from '../trees/graph.js';
import { personColumns, personFieldsOf, requireLivePerson } from '../trees/people.js';
import { loadPersonView } from '../trees/person-view.js';
import { attachRelative, relativeEnds } from '../trees/relatives.js';
import type { TreeRouteOptions } from './trees.js';

export const personsRoutes: FastifyPluginAsync<TreeRouteOptions> = async (app, { auth, db }) => {
  app.addHook('preHandler', requireSession(auth));

  app.get('/api/v1/trees/:treeId/persons/:personId', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'tree.view', TREE);
    return loadPersonView(db, access, idParam(req.params, 'personId'));
  });

  app.post('/api/v1/trees/:treeId/persons', async (req, reply) => {
    const treeId = idParam(req.params, 'treeId');
    // Outsiders get their 404 before the body is looked at.
    await loadAccess(db, treeId, req.user!.id);
    const { person, attach } = parseBody(createPersonSchema, req.body);
    const id = await db.transaction(async (tx) => {
      await lockTreeGraph(tx, treeId);
      // Re-read inside the lock: the steward scope must match the graph we're about to change.
      const access = await loadAccess(tx, treeId, req.user!.id);
      const graph = await loadLiveGraph(tx, access.treeId);
      const ends = attach ? relativeEnds(graph, attach.to, attach) : [];
      authorize(access, 'person.add', { kind: 'relation', ends });
      const [row] = await tx
        .insert(persons)
        .values({
          treeId: access.treeId,
          ...personColumns(person),
          givenName: person.givenName,
          createdBy: access.userId,
          updatedBy: access.userId,
        })
        .returning();
      await audit(tx, access, {
        action: 'person.create',
        entityType: 'person',
        entityId: row!.id,
        personIds: [row!.id],
        after: personFieldsOf(row!),
      });
      if (attach) await attachRelative(tx, access, graph, attach.to, row!.id, attach);
      return row!.id;
    });
    return reply.code(201).send({ id });
  });

  app.patch('/api/v1/trees/:treeId/persons/:personId', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const current = await requireLivePerson(db, access.treeId, idParam(req.params, 'personId'));
    authorize(access, 'person.edit', { kind: 'person', personId: current.id });
    const { version, ...input } = parseBody(updatePersonSchema, req.body);
    if (version !== current.version) throw staleEdit();
    const before = personFieldsOf(current);
    const merged = { ...before, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
    const errors = personConsistencyErrors(merged);
    if (Object.keys(errors).length > 0) {
      throw new AppError('VALIDATION', 400, 'Some fields are invalid', errors);
    }
    const changes = changedFields(before, merged, PERSON_FIELDS);
    if (!changes) return { version: current.version };
    const next = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(persons)
        .set({
          ...personColumns(changes.after),
          updatedBy: access.userId,
          version: sql`${persons.version} + 1`,
        })
        .where(
          and(
            eq(persons.treeId, access.treeId),
            eq(persons.id, current.id),
            eq(persons.version, version),
            isNull(persons.deletedAt),
          ),
        )
        .returning({ version: persons.version });
      if (!row) {
        // Changed or deleted since we read it.
        const [still] = await tx
          .select({ id: persons.id })
          .from(persons)
          .where(and(eq(persons.id, current.id), isNull(persons.deletedAt)));
        throw still ? staleEdit() : notFound();
      }
      await audit(tx, access, {
        action: 'person.update',
        entityType: 'person',
        entityId: current.id,
        personIds: [current.id],
        ...changes,
      });
      return row.version;
    });
    return { version: next };
  });
};

const staleEdit = () => conflict('This person was changed by someone else; reload and try again');
```

  **Notes on the code above:**
  - `personColumns(changes.after)` writes only the changed fields, plus the sort years when a date changed.
  - Register `personsRoutes` in `app.ts` after `invitesRoutes`.
  - `relativeEnds` and `attachRelative` come in Task 6. For this task, create `trees/relatives.ts` with these two exports and **real** implementations from Task 6 Step 3 if you're doing them together. Otherwise add a temporary stub that only handles `as: 'child'` without `unionId`, and finish it in Task 6. The attach test case needs `child` only.

- [ ] **Step 4: Run the test; it passes.**

- [ ] **Step 5: Commit** `feat(api): person routes: read with relations, create, versioned update, audited`

---

## Task 6: API — adding relatives, editing unions and links

**Files:**
- Create: `apps/api/src/trees/relatives.ts` (complete it), `apps/api/src/trees/relation-rows.ts`, `apps/api/src/routes/relations.ts`, `apps/api/src/routes/relations.int.test.ts`
- Modify: `apps/api/src/app.ts`

| Method | Path | Authorises |
|---|---|---|
| POST | `/api/v1/trees/:treeId/persons/:personId/relatives` | `relation.add`. Ends: subject, relative, partners of the chosen union |
| PATCH | `/api/v1/trees/:treeId/unions/:unionId` | `relation.edit`. Ends: partners |
| PATCH | `/api/v1/trees/:treeId/parent-child/:linkId` | `relation.edit`. Ends: child plus partners |

- [ ] **Step 1: Write the failing integration test** `relations.int.test.ts`. Use `ownerWithTree`, and create people through `POST …/persons` so the audit rows exist. Helper:

```ts
const newPerson = async (jar: CookieJar, treeId: string, givenName: string, attach?: object) => {
  const res = await call(app, 'POST', `/api/v1/trees/${treeId}/persons`, {
    jar,
    body: { person: { givenName }, ...(attach ? { attach } : {}) },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
};
const view = async (jar: CookieJar, treeId: string, id: string) =>
  (await call(app, 'GET', `/api/v1/trees/${treeId}/persons/${id}`, { jar })).json() as PersonView;
```

  **Test cases** (`root` is the owner's own card):
  1. **Partner:** `newPerson('Pat', { to: root, as: 'partner' })` gives a union with `type: 'marriage', status: 'married'`, and the root's view shows `unions[0].partner.givenName === 'Pat'`. With `union: { type: 'partnership', status: 'partners' }`, those values are stored.
  2. **Child with a union:** `newPerson('Kid', { to: root, as: 'child', unionId: <the root+Pat union> })` gives the root's union `children` = [Kid]. Kid's view shows `parents[0].parents` = root and Pat, and the kind is `biological`.
  3. **Child without a union:** two children added without `unionId` both land in **one** single-parent union of the root, and no second union is created.
  4. **Two parents become one couple:**
     - On Kid2, who has no parents, add parent Mum (new).
     - Then add parent Dad (new) without `unionId`: Dad fills Mum's union.
     - Kid2's `parents` has one entry with two parents.
     - A third parent without `unionId` (Kid2's only parent union is now full) creates a new single-parent union for that parent, with Kid2 as its child. Kid2 now has two parent entries.
  5. **Sibling:**
     - On a person with no parents: 400 `VALIDATION`.
     - On Kid: linked into the root+Pat union.
     - On Kid2, who now has two parent unions, without `unionId`: 400. With `unionId`: OK.
  6. **Existing relative** (`POST …/persons/:pid/relatives`):
     - Linking an existing person as child gives 204. The same again gives 409 `CONFLICT`.
     - Linking Kid as the **parent** of root (Kid is root's child) gives 400 `VALIDATION`, the cycle rule.
     - The subject as their own relative gives 400.
     - A person from another tree as `personId` gives 400.
     - An unknown subject gives 404.
  7. **Union edits:** `PATCH unions/:id { status: 'divorced', endDate: {qualifier:'exact', date1:'2001'} }` gives 204. The row is updated, and an audit `union.update` stores only the changed fields.
  8. **Link edits:** `PATCH parent-child/:id { kind: 'adoptive' }` gives 204, with an audit `link.update`.
  9. **Wrong ids:** a union or link of another tree, or a soft-deleted one, gives 404, and no audit row is written.
  9a. **Union dates:** `PATCH unions/:id { endDate: 1960 }` on a union starting in 1970 gives 400 `VALIDATION` (`details.endDate`).
  9b. **Duplicate partners:** linking an existing person as `partner` of someone they already have a live union with gives 409 `CONFLICT`.
  10. **Viewer:** every write gives 403.
  11. **Audit:** each new union or link has a `union.create` / `link.create` row whose `personIds` include the partners and the child.

- [ ] **Step 2: Run it; it fails.**

- [ ] **Step 3: Implement.**

  **`apps/api/src/trees/relation-rows.ts`:**

```ts
import { and, eq, isNull } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { parentChild, persons, unions } from '../db/schema.js';
import { notFound } from '../errors.js';

export type UnionRow = typeof unions.$inferSelect;
const present = (p: string | null): p is string => p !== null;

export async function requireLiveUnion(db: Queryable, treeId: string, unionId: string) {
  const [u] = await db
    .select()
    .from(unions)
    .where(and(eq(unions.treeId, treeId), eq(unions.id, unionId), isNull(unions.deletedAt)));
  if (!u) throw notFound();
  return { ...u, partners: [u.partnerAId, u.partnerBId].filter(present) };
}

/** A live link whose union and child are live too, with the union's partners. */
export async function requireLiveLink(db: Queryable, treeId: string, linkId: string) {
  const [row] = await db
    .select({ link: parentChild, partnerAId: unions.partnerAId, partnerBId: unions.partnerBId })
    .from(parentChild)
    .innerJoin(unions, and(eq(unions.id, parentChild.unionId), isNull(unions.deletedAt)))
    .innerJoin(persons, and(eq(persons.id, parentChild.childId), isNull(persons.deletedAt)))
    .where(
      and(eq(parentChild.treeId, treeId), eq(parentChild.id, linkId), isNull(parentChild.deletedAt)),
    );
  if (!row) throw notFound();
  return { ...row.link, partners: [row.partnerAId, row.partnerBId].filter(present) };
}

export const UNION_EDIT_FIELDS = ['type', 'status', 'startDate', 'endDate'] as const;
export const unionFieldsOf = (u: UnionRow) => ({
  partnerAId: u.partnerAId,
  partnerBId: u.partnerBId,
  type: u.type,
  status: u.status,
  startDate: u.startDate,
  endDate: u.endDate,
});
```

  **`apps/api/src/trees/relatives.ts`:**

```ts
import {
  type ChildKind,
  type GraphUnion,
  type LiveGraph,
  partnersOf,
  type RelativeLink,
  type UnionStatus,
  type UnionType,
  wouldCycle,
} from '@family-tree/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { parentChild, unions } from '../db/schema.js';
import { conflict, invalid } from '../errors.js';
import { audit, type AuditActor } from './audit.js';
import { unionFieldsOf } from './relation-rows.js';

type Spec = Pick<RelativeLink, 'as' | 'unionId' | 'kind' | 'union'>;

const parentUnionsOf = (graph: LiveGraph, childId: string) => {
  const ids = new Set(graph.parentChild.filter((l) => l.childId === childId).map((l) => l.unionId));
  return graph.unions.filter((u) => ids.has(u.id));
};
const childrenOf = (graph: LiveGraph, unionId: string) =>
  graph.parentChild.filter((l) => l.unionId === unionId).map((l) => l.childId);

/** The existing union the new link uses (decision 11), or null when a new union is needed. */
function chooseUnion(graph: LiveGraph, subjectId: string, spec: Spec): GraphUnion | null {
  switch (spec.as) {
    case 'partner':
      return null;
    case 'child': {
      if (spec.unionId) {
        const u = graph.unions.find(
          (x) => x.id === spec.unionId && partnersOf(x).includes(subjectId),
        );
        if (!u) throw invalid('unionId', 'Choose one of their relationships');
        return u;
      }
      return (
        graph.unions.find((u) => {
          const ps = partnersOf(u);
          return ps.length === 1 && ps[0] === subjectId;
        }) ?? null
      );
    }
    case 'parent': {
      const open = parentUnionsOf(graph, subjectId).filter((u) => partnersOf(u).length === 1);
      if (spec.unionId) {
        const u = open.find((x) => x.id === spec.unionId);
        if (!u) throw invalid('unionId', 'Choose parents with a missing partner');
        return u;
      }
      return open.length === 1 ? open[0]! : null;
    }
    case 'sibling': {
      const all = parentUnionsOf(graph, subjectId);
      if (all.length === 0) throw invalid('as', 'Add a parent first');
      if (spec.unionId) {
        const u = all.find((x) => x.id === spec.unionId);
        if (!u) throw invalid('unionId', 'Choose one of their sets of parents');
        return u;
      }
      if (all.length > 1) throw invalid('unionId', 'Choose which parents they share');
      return all[0]!;
    }
  }
}

/** The people a relation of this shape connects: the can() ends for person.add / relation.add. */
export function relativeEnds(graph: LiveGraph, subjectId: string, spec: Spec): string[] {
  if (!graph.persons.some((p) => p.id === subjectId)) {
    throw invalid('to', 'Choose a person in this tree');
  }
  const u = chooseUnion(graph, subjectId, spec);
  return [...new Set([subjectId, ...(u ? partnersOf(u) : [])])];
}

/**
 * Makes `relativeId` (new or existing) the spec.as of `subjectId`. The caller holds
 * lockTreeGraph, loaded `graph` inside the same transaction, and has already authorised.
 */
export async function attachRelative(
  tx: Tx,
  actor: AuditActor,
  graph: LiveGraph,
  subjectId: string,
  relativeId: string,
  spec: Spec,
): Promise<void> {
  const u = chooseUnion(graph, subjectId, spec);
  const noCycle = (parents: string[], children: string[]) => {
    if (wouldCycle(graph, parents, children)) {
      throw invalid('personId', 'That would make someone their own ancestor');
    }
  };
  switch (spec.as) {
    case 'partner': {
      const pair = [subjectId, relativeId];
      if (graph.unions.some((x) => pair.every((id) => partnersOf(x).includes(id)))) {
        throw conflict('They are already partners');
      }
      await createUnion(tx, actor, subjectId, relativeId, spec.union?.type ?? 'marriage', spec.union?.status ?? 'married');
      return;
    }
    case 'child': {
      const parents = u ? partnersOf(u) : [subjectId];
      if (parents.includes(relativeId)) throw invalid('personId', 'A parent can’t also be the child');
      noCycle(parents, [relativeId]);
      const union = u ?? (await createUnion(tx, actor, subjectId, null, 'partnership', 'partners'));
      await createLink(tx, actor, union, relativeId, spec.kind);
      return;
    }
    case 'parent': {
      if (u) {
        if (partnersOf(u).includes(relativeId)) throw conflict('They are already related this way');
        const kids = childrenOf(graph, u.id);
        noCycle([relativeId], kids);
        await fillSlot(tx, actor, u, relativeId, kids);
      } else {
        noCycle([relativeId], [subjectId]);
        const union = await createUnion(tx, actor, relativeId, null, 'partnership', 'partners');
        await createLink(tx, actor, union, subjectId, spec.kind);
      }
      return;
    }
    case 'sibling': {
      const union = u!; // chooseUnion throws when there is no parent union
      noCycle(partnersOf(union), [relativeId]);
      await createLink(tx, actor, union, relativeId, spec.kind);
    }
  }
}

async function createUnion(
  tx: Tx,
  actor: AuditActor,
  a: string,
  b: string | null,
  type: UnionType,
  status: UnionStatus,
): Promise<GraphUnion> {
  const [row] = await tx
    .insert(unions)
    .values({ treeId: actor.treeId, partnerAId: a, partnerBId: b, type, status })
    .returning();
  await audit(tx, actor, {
    action: 'union.create',
    entityType: 'union',
    entityId: row!.id,
    personIds: [a, ...(b ? [b] : [])],
    after: unionFieldsOf(row!),
  });
  return { id: row!.id, partnerAId: a, partnerBId: b };
}

async function createLink(tx: Tx, actor: AuditActor, union: GraphUnion, childId: string, kind: ChildKind) {
  const [row] = await tx
    .insert(parentChild)
    .values({ treeId: actor.treeId, unionId: union.id, childId, kind })
    .onConflictDoNothing()
    .returning({ id: parentChild.id });
  if (!row) throw conflict('They are already related this way');
  await audit(tx, actor, {
    action: 'link.create',
    entityType: 'link',
    entityId: row.id,
    personIds: [childId, ...partnersOf(union)],
    after: { unionId: union.id, childId, kind },
  });
}

/** Puts `personId` into the union's empty slot; CONFLICT if someone filled it meanwhile. */
async function fillSlot(tx: Tx, actor: AuditActor, u: GraphUnion, personId: string, children: string[]) {
  const slot = u.partnerAId === null ? 'partnerAId' : 'partnerBId';
  const [row] = await tx
    .update(unions)
    .set(slot === 'partnerAId' ? { partnerAId: personId } : { partnerBId: personId })
    .where(and(eq(unions.id, u.id), isNull(unions[slot]), isNull(unions.deletedAt)))
    .returning();
  if (!row) throw conflict('Those parents changed; reload and try again');
  await audit(tx, actor, {
    action: 'union.update',
    entityType: 'union',
    entityId: u.id,
    personIds: [...partnersOf(u), personId, ...children],
    before: { [slot]: null },
    after: { [slot]: personId },
  });
}
```

  `onConflictDoNothing()` without a target covers the partial unique index `parent_child_union_child_uq`. In `fillSlot`, the `isNull(unions[slot])` guard matters even after `loadLiveGraph`: the graph shows a deleted partner as an empty slot, but the database must really be empty before we overwrite it.

  **`apps/api/src/routes/relations.ts`:**

```ts
import {
  addRelativeSchema,
  unionDatesError,
  updateParentChildSchema,
  updateUnionSchema,
} from '@family-tree/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import { parentChild, unions } from '../db/schema.js';
import { idParam, invalid, notFound, parseBody } from '../errors.js';
import { authorize, loadAccess } from '../trees/access.js';
import { audit, changedFields } from '../trees/audit.js';
import { loadLiveGraph, lockTreeGraph } from '../trees/graph.js';
import { requireLiveLink, requireLiveUnion, UNION_EDIT_FIELDS } from '../trees/relation-rows.js';
import { attachRelative, relativeEnds } from '../trees/relatives.js';
import type { TreeRouteOptions } from './trees.js';

export const relationsRoutes: FastifyPluginAsync<TreeRouteOptions> = async (app, { auth, db }) => {
  app.addHook('preHandler', requireSession(auth));

  app.post('/api/v1/trees/:treeId/persons/:personId/relatives', async (req, reply) => {
    const treeId = idParam(req.params, 'treeId');
    await loadAccess(db, treeId, req.user!.id); // outsiders: 404 before anything else
    const subjectId = idParam(req.params, 'personId');
    const input = parseBody(addRelativeSchema, req.body);
    await db.transaction(async (tx) => {
      await lockTreeGraph(tx, treeId);
      const access = await loadAccess(tx, treeId, req.user!.id);
      const graph = await loadLiveGraph(tx, treeId);
      const live = (id: string) => graph.persons.some((p) => p.id === id);
      if (!live(subjectId)) throw notFound();
      if (!live(input.personId)) throw invalid('personId', 'Choose a person in this tree');
      if (input.personId === subjectId) throw invalid('personId', 'Choose someone else');
      const ends = [...relativeEnds(graph, subjectId, input), input.personId];
      authorize(access, 'relation.add', { kind: 'relation', ends });
      await attachRelative(tx, access, graph, subjectId, input.personId, input);
    });
    return reply.code(204).send();
  });

  app.patch('/api/v1/trees/:treeId/unions/:unionId', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const u = await requireLiveUnion(db, access.treeId, idParam(req.params, 'unionId'));
    authorize(access, 'relation.edit', { kind: 'relation', ends: u.partners });
    const input = parseBody(updateUnionSchema, req.body);
    // Drop absent keys first: spreading `undefined` over the row would read as "cleared".
    const given = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const merged = { ...u, ...given };
    const datesError = unionDatesError(merged);
    if (datesError) throw invalid('endDate', datesError);
    const changes = changedFields(u, merged, UNION_EDIT_FIELDS);
    if (!changes) return reply.code(204).send();
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(unions)
        .set(changes.after)
        .where(and(eq(unions.treeId, access.treeId), eq(unions.id, u.id), isNull(unions.deletedAt)))
        .returning({ id: unions.id });
      if (!row) throw notFound(); // deleted meanwhile: no write, no audit
      await audit(tx, access, { action: 'union.update', entityType: 'union', entityId: u.id, personIds: u.partners, ...changes });
    });
    return reply.code(204).send();
  });

  app.patch('/api/v1/trees/:treeId/parent-child/:linkId', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const l = await requireLiveLink(db, access.treeId, idParam(req.params, 'linkId'));
    const ends = [l.childId, ...l.partners];
    authorize(access, 'relation.edit', { kind: 'relation', ends });
    const { kind } = parseBody(updateParentChildSchema, req.body);
    if (kind === l.kind) return reply.code(204).send();
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(parentChild)
        .set({ kind })
        .where(and(eq(parentChild.treeId, access.treeId), eq(parentChild.id, l.id), isNull(parentChild.deletedAt)))
        .returning({ id: parentChild.id });
      if (!row) throw notFound();
      await audit(tx, access, { action: 'link.update', entityType: 'link', entityId: l.id, personIds: ends, before: { kind: l.kind }, after: { kind } });
    });
    return reply.code(204).send();
  });
};
```

  `changes.after` holds only keys from `UNION_EDIT_FIELDS`, so it's safe to pass to `.set()`. Cast it to `Partial<typeof unions.$inferInsert>` if TypeScript asks. Register `relationsRoutes` in `app.ts`.

- [ ] **Step 4: Run** `relations.int.test.ts` and `persons.int.test.ts`. Both pass.

- [ ] **Step 5: Commit** `feat(api): add relatives (parent, child, partner, sibling), edit unions and links`

---

## Task 7: API — residences and person History

**Files:**
- Create: `apps/api/src/routes/residences.ts`, `apps/api/src/routes/residences.int.test.ts`
- Modify: `apps/api/src/routes/persons.ts` (add the history route), `apps/api/src/routes/persons.int.test.ts`, `apps/api/src/app.ts`

| Method | Path | Authorises |
|---|---|---|
| POST | `/api/v1/trees/:treeId/persons/:personId/residences` | `person.edit` (that person) |
| PATCH | `/api/v1/trees/:treeId/residences/:residenceId` | `person.edit` (its person) |
| DELETE | `/api/v1/trees/:treeId/residences/:residenceId` | `person.edit` (its person) |
| GET | `/api/v1/trees/:treeId/persons/:personId/history` | `tree.view` |

- [ ] **Step 1: Write the failing tests.**

  **`residences.int.test.ts`:**
  1. **Add:** `{ place: 'Leeds', fromDate: {qualifier:'after', date1:'1950'} }` gives 201 `{id}`. The person view lists it.
  2. **Edit:** PATCH with all three fields gives 204.
  3. **Remove:** DELETE gives 204. The row is gone and the audit has `residence.create`, `residence.update` and `residence.delete`, each with `personIds: [person]`. The delete row's `before` holds the place.
  4. **Wrong ids:** a residence of a soft-deleted person gives 404 for PATCH and DELETE, and a residence of another tree gives 404.
  4a. **Cap:** with 50 residences inserted directly, adding one more gives 400 `VALIDATION`.
  5. **Steward:** with a viewer steward of Robert's branch (Hale shape, as in `stewards.int.test.ts`), adding to Dan gives 201 and adding to George gives 403.

  **`persons.int.test.ts`, History:**
  - After a create, two edits, adding a partner and a residence, `GET …/history` returns entries newest first.
  - The actions are `residence.create`, `union.create`, `person.update`, `person.update` and `person.create`.
  - Each entry has `by: 'Owner'`.
  - `changes` on a `person.update` is `[{ field: 'surname', before: 'King', after: 'Lovelace' }]`. Other entries have `changes: []`.
  - Another person's edits don't appear.
  - Viewers can read History.
  - **No leaks to viewers:** create an invite that targets the person, and a steward grant anchored on them (through the API, after Task 10). A viewer's History of that person contains no `invite.*`, `steward.*` or `member.*` entry. Also insert one such audit row directly, with `person_ids` set to the person, and check the action filter still hides it.

- [ ] **Step 2: Run them; they fail.**

- [ ] **Step 3: Implement.**

  **`routes/residences.ts`:** follow this skeleton, using the same imports as `relations.ts` plus `residences` and `residenceInputSchema`:

```ts
async function requireResidence(db: Queryable, treeId: string, residenceId: string) {
  const [r] = await db
    .select({ r: residences })
    .from(residences)
    .innerJoin(persons, and(eq(persons.id, residences.personId), isNull(persons.deletedAt)))
    .where(and(eq(residences.treeId, treeId), eq(residences.id, residenceId), isNull(residences.deletedAt)));
  if (!r) throw notFound();
  return r.r;
}
const residenceFields = (r: { place: string; fromDate: unknown; toDate: unknown }) => ({
  place: r.place,
  fromDate: r.fromDate,
  toDate: r.toDate,
});
```

  - **POST:**
    1. `requireLivePerson`, then `authorize(access, 'person.edit', { kind: 'person', personId })`.
    2. Parse `residenceInputSchema`.
    3. In a transaction, under a per-person lock (`select … from persons where id = $1 for update`): count the person's residences. At `RESIDENCES_MAX` (50), throw `invalid('place', 'A person can have at most 50 places of residence')`. Otherwise insert, then `audit({ action: 'residence.create', entityType: 'residence', entityId, personIds: [personId], after: residenceFields(row) })`. Reply 201 `{ id }`.
  - **PATCH:** `requireResidence`, `authorize` on `r.personId`, parse `residenceInputSchema` (the full record), then `changedFields(r, input, ['place','fromDate','toDate'])`. Update and audit `residence.update` when something changed. 204.
  - **DELETE:** `requireResidence`, `authorize`, then in a transaction: `db.delete(residences)` and audit `residence.delete` with `before: residenceFields(r)`. 204.

  **History, in `routes/persons.ts`:**

```ts
  app.get('/api/v1/trees/:treeId/persons/:personId/history', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'tree.view', TREE);
    const person = await requireLivePerson(db, access.treeId, idParam(req.params, 'personId'));
    const rows = await db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        entityId: auditLog.entityId,
        before: auditLog.before,
        after: auditLog.after,
        createdAt: auditLog.createdAt,
        by: users.name,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .where(
        and(
          eq(auditLog.treeId, access.treeId),
          arrayContains(auditLog.personIds, [person.id]),
          // Decision 13: only changes to people and relations, never member/steward/invite rows.
          or(...HISTORY_ACTION_PREFIXES.map((prefix) => like(auditLog.action, `${prefix}%`))),
        ),
      )
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(HISTORY_LIMIT);
    const entries: HistoryEntry[] = rows.map((r) => ({
      id: r.id,
      action: r.action,
      at: r.createdAt.toISOString(),
      by: r.by,
      changes:
        r.action === 'person.update' && r.entityId === person.id
          ? Object.keys((r.after ?? {}) as object).map((field) => ({
              field,
              before: (r.before as Record<string, unknown> | null)?.[field] ?? null,
              after: (r.after as Record<string, unknown>)[field],
            }))
          : [],
    }));
    return { entries };
  });
```

  `like` and `or` come from `drizzle-orm`. `arrayContains` comes from `drizzle-orm` and compiles to `person_ids @> $1`, which uses the GIN index. Entries created in the same millisecond tie-break on `id`, which is random. So the test should compare action **sets** for rows written in one transaction, or create them in separate requests (it does).

- [ ] **Step 4: Run the tests; they pass.** Register `residencesRoutes` in `app.ts`.

- [ ] **Step 5: Commit** `feat(api): residences and person history from the audit log`

---

## Task 8: API — delete preview, deleting people and relations

**Files:**
- Create: `apps/api/src/trees/deletion.ts`, `apps/api/src/routes/deletion.ts`, `apps/api/src/routes/deletion.int.test.ts`
- Modify: `apps/api/src/app.ts`

| Method | Path | Authorises |
|---|---|---|
| POST | `/api/v1/trees/:treeId/persons/:personId/delete-preview` `{mode}` | `person.delete` on [person] (decision 19) |
| POST | `/api/v1/trees/:treeId/persons/:personId/delete` `{mode}` | `person.delete` on the plan's `touchedPersonIds` |
| POST | `/api/v1/trees/:treeId/unions/:unionId/delete` | `relation.delete` on partners plus children |
| POST | `/api/v1/trees/:treeId/parent-child/:linkId/delete` | `relation.delete` on the child plus partners |

  Each delete returns 200 `{ batchId }`.

- [ ] **Step 1: Write the failing integration test** `deletion.int.test.ts`.

  **Setup:** the Hale shape, built with `addPerson` and `family` (fixtures, so no audit rows are needed):
  - Robert + Mary → Dan.
  - Dan + Ann → Leo.
  - George + Greta → Ann (Ann has parents, so she's outside Robert's branch).
  - Dan + (none) → Kim.
  - Leo + Zoe (no parents).
  - **Members:** S, a viewer with 2FA and a grant on Robert (`addGrant`), and E, an editor.

  **Test cases:**
  1. **Owner preview, "just this person" for Dan:**
     - `people` = [Dan].
     - `unions` = 2: Dan+Ann loses Dan, and Dan+(none) is removed.
     - `links` = 2: Dan's own link as a child, and Kim's link.
     - `outsideScope: 0`, `blockedByRoot: false`, `allowed: true`.
  2. **Owner deletes Dan (`person`):**
     - 200 `{batchId}`.
     - Dan's `deleted_at` is set, with his `deletion_batch_id`.
     - The Dan+Ann union is live, with Dan's slot null.
     - The Dan+(none) union and Kim's link are soft-deleted in the batch.
     - Dan's link under Robert+Mary is soft-deleted.
     - The batch has `mode: 'person'`, `rootPersonId: Dan`, and `slots: [{ unionId, slot: 'a', personId: Dan }]`.
     - The audit has `person.delete`, with `entityId: batchId` and `personIds` including Ann and Kim.
     - `GET …/persons` no longer lists Dan.
     - Ann's view still shows Leo as her child.
  3. **Descendants preview for Dan:** `people` = Dan, Leo, Kim and Zoe. Zoe comes in as a partner with no other connection. Ann does not, because she has parents.
  4. **Root person:** a preview of the owner's root card gives `blockedByRoot: true` and `allowed: false`. The delete gives 400 `VALIDATION` with `details.personId`.
  5. **Steward:**
     - Preview of Kim: `allowed: true`.
     - Delete of Kim: 200.
     - Preview of Dan: `outsideScope >= 1` (Ann) and `allowed: false`.
     - Delete of Dan: 403 `FORBIDDEN`, and nothing changed (compare a snapshot of `persons.deleted_at` and the union partners).
     - Preview of George (outside the scope): 403.
  6. **Editor:** preview and delete give 403.
  7. **Union delete:** the owner deletes Leo+Zoe. The union is soft-deleted with no slot change, and Leo and Zoe stay live. The batch has `mode: 'relation'` and `rootUnionId`.
  8. **Steward union delete:** S deleting the George+Greta union gives 403.
  9. **Link delete:** the owner deletes Leo's link. The link is soft-deleted, and the batch has `rootParentChildId`.
  10. **Wrong ids:**
      - Deleting an already deleted person gives 404.
      - Deleting a union or link of another tree gives 404.
      - An unknown `mode` gives 400.

- [ ] **Step 2: Run it; it fails.**

- [ ] **Step 3: Implement.**

  **`apps/api/src/trees/deletion.ts`:**

```ts
import type { BatchMode, DeletionPlan, DeletionSlot } from '@family-tree/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { deletionBatches, parentChild, persons, unions } from '../db/schema.js';

export async function createBatch(
  tx: Tx,
  actor: { treeId: string; userId: string },
  v: {
    mode: BatchMode;
    rootPersonId?: string;
    rootUnionId?: string;
    rootParentChildId?: string;
    slots: DeletionSlot[];
  },
): Promise<string> {
  const [row] = await tx
    .insert(deletionBatches)
    .values({
      treeId: actor.treeId,
      deletedByUserId: actor.userId,
      mode: v.mode,
      rootPersonId: v.rootPersonId ?? null,
      rootUnionId: v.rootUnionId ?? null,
      rootParentChildId: v.rootParentChildId ?? null,
      slots: v.slots,
    })
    .returning({ id: deletionBatches.id });
  return row!.id;
}

/** Soft-deletes the plan's rows into the batch and empties its partner slots. */
export async function applyPlan(tx: Tx, treeId: string, batchId: string, plan: DeletionPlan) {
  const mark = { deletedAt: sql`now()`, deletionBatchId: batchId };
  if (plan.personIds.length > 0) {
    await tx
      .update(persons)
      .set(mark)
      .where(and(eq(persons.treeId, treeId), inArray(persons.id, plan.personIds), isNull(persons.deletedAt)));
  }
  if (plan.unionIds.length > 0) {
    await tx
      .update(unions)
      .set(mark)
      .where(and(eq(unions.treeId, treeId), inArray(unions.id, plan.unionIds), isNull(unions.deletedAt)));
  }
  if (plan.parentChildIds.length > 0) {
    await tx
      .update(parentChild)
      .set(mark)
      .where(
        and(eq(parentChild.treeId, treeId), inArray(parentChild.id, plan.parentChildIds), isNull(parentChild.deletedAt)),
      );
  }
  for (const s of plan.slots) {
    await tx
      .update(unions)
      .set(s.slot === 'a' ? { partnerAId: null } : { partnerBId: null })
      .where(and(eq(unions.treeId, treeId), eq(unions.id, s.unionId)));
  }
}
```

  **`apps/api/src/routes/deletion.ts`:**

```ts
import {
  type DeleteMode,
  deletePersonSchema,
  type DeletePreview,
  type DeletionPlan,
  planLinkDeletion,
  planPersonDeletion,
  planUnionDeletion,
} from '@family-tree/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import type { Queryable, Tx } from '../db/client.js';
import { persons, trees } from '../db/schema.js';
import { idParam, invalid, notFound, parseBody } from '../errors.js';
import { can, inScope } from '../permissions/can.js';
import { type Access, authorize, loadAccess } from '../trees/access.js';
import { audit } from '../trees/audit.js';
import { applyPlan, createBatch } from '../trees/deletion.js';
import { loadLiveGraph, lockTreeGraph } from '../trees/graph.js';
import { summaryColumns } from '../trees/people.js';
import type { TreeRouteOptions } from './trees.js';

async function personPlan(db: Queryable, access: Access, personId: string, mode: DeleteMode) {
  const graph = await loadLiveGraph(db, access.treeId);
  if (!graph.persons.some((p) => p.id === personId)) throw notFound();
  authorize(access, 'person.delete', { kind: 'people', personIds: [personId] });
  return planPersonDeletion(graph, personId, mode);
}

async function commit(tx: Tx, access: Access, plan: DeletionPlan, batch: Parameters<typeof createBatch>[2]) {
  const batchId = await createBatch(tx, access, batch);
  await applyPlan(tx, access.treeId, batchId, plan);
  await audit(tx, access, {
    action: batch.mode === 'relation' ? (batch.rootUnionId ? 'union.delete' : 'link.delete') : 'person.delete',
    entityType: 'batch',
    entityId: batchId,
    personIds: plan.touchedPersonIds,
    after: {
      mode: batch.mode,
      people: plan.personIds.length,
      unions: plan.unionIds.length,
      links: plan.parentChildIds.length,
    },
  });
  return batchId;
}

export const deletionRoutes: FastifyPluginAsync<TreeRouteOptions> = async (app, { auth, db }) => {
  app.addHook('preHandler', requireSession(auth));

  app.post('/api/v1/trees/:treeId/persons/:personId/delete-preview', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const personId = idParam(req.params, 'personId');
    const { mode } = parseBody(deletePersonSchema, req.body);
    const plan = await personPlan(db, access, personId, mode);
    const people = await db
      .select(summaryColumns)
      .from(persons)
      .where(and(eq(persons.treeId, access.treeId), inArray(persons.id, plan.personIds)));
    const order = new Map(plan.personIds.map((id, i) => [id, i]));
    people.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const blockedByRoot = access.rootPersonId !== null && plan.personIds.includes(access.rootPersonId);
    const body: DeletePreview = {
      mode,
      people,
      unions: plan.unionIds.length + new Set(plan.slots.map((s) => s.unionId)).size,
      links: plan.parentChildIds.length,
      outsideScope:
        access.role === 'owner' ? 0 : plan.touchedPersonIds.filter((id) => !inScope(access, id)).length,
      blockedByRoot,
      allowed:
        !blockedByRoot && can(access, 'person.delete', { kind: 'people', personIds: plan.touchedPersonIds }),
    };
    return body;
  });

  app.post('/api/v1/trees/:treeId/persons/:personId/delete', async (req) => {
    const treeId = idParam(req.params, 'treeId');
    await loadAccess(db, treeId, req.user!.id); // outsiders: 404 before the body
    const personId = idParam(req.params, 'personId');
    const { mode } = parseBody(deletePersonSchema, req.body);
    const batchId = await db.transaction(async (tx) => {
      await lockTreeGraph(tx, treeId);
      const access = await loadAccess(tx, treeId, req.user!.id);
      // Serialises with a root change (PATCH /trees/:id) and reads the current root.
      const [tree] = await tx
        .select({ rootPersonId: trees.rootPersonId })
        .from(trees)
        .where(eq(trees.id, access.treeId))
        .for('update');
      const plan = await personPlan(tx, access, personId, mode);
      if (tree?.rootPersonId && plan.personIds.includes(tree.rootPersonId)) {
        throw invalid('personId', 'Choose a new starting person first');
      }
      authorize(access, 'person.delete', { kind: 'people', personIds: plan.touchedPersonIds });
      return commit(tx, access, plan, { mode, rootPersonId: personId, slots: plan.slots });
    });
    return { batchId };
  });

  app.post('/api/v1/trees/:treeId/unions/:unionId/delete', async (req) => {
    const treeId = idParam(req.params, 'treeId');
    const unionId = idParam(req.params, 'unionId');
    const batchId = await db.transaction(async (tx) => {
      await lockTreeGraph(tx, treeId);
      const access = await loadAccess(tx, treeId, req.user!.id);
      const graph = await loadLiveGraph(tx, access.treeId);
      if (!graph.unions.some((u) => u.id === unionId)) throw notFound();
      const plan = planUnionDeletion(graph, unionId);
      authorize(access, 'relation.delete', { kind: 'people', personIds: plan.touchedPersonIds });
      return commit(tx, access, plan, { mode: 'relation', rootUnionId: unionId, slots: [] });
    });
    return { batchId };
  });

  app.post('/api/v1/trees/:treeId/parent-child/:linkId/delete', async (req) => {
    const treeId = idParam(req.params, 'treeId');
    const linkId = idParam(req.params, 'linkId');
    const batchId = await db.transaction(async (tx) => {
      await lockTreeGraph(tx, treeId);
      const access = await loadAccess(tx, treeId, req.user!.id);
      const graph = await loadLiveGraph(tx, access.treeId);
      if (!graph.parentChild.some((l) => l.id === linkId)) throw notFound();
      const plan = planLinkDeletion(graph, linkId);
      authorize(access, 'relation.delete', { kind: 'people', personIds: plan.touchedPersonIds });
      return commit(tx, access, plan, { mode: 'relation', rootParentChildId: linkId, slots: [] });
    });
    return { batchId };
  });
};
```

  **Notes on the code above:**
  - `loadLiveGraph` reads by `tree_id`, so another tree's union or link id isn't in the graph and gives a 404.
  - The preview reads the root from `access.rootPersonId`. The delete re-reads it under the lock.
  - **Locks:** the delete routes take `lockTreeGraph` **before** `loadAccess(tx, …)`, so the steward grant scopes come from the same graph the plan is computed on. The advisory lock on a tree id that's not the user's is harmless: `loadAccess` 404s right after. The lock order is advisory lock, then the `trees` row, then rows (ground rules).
  - Register `deletionRoutes` in `app.ts`.

- [ ] **Step 4: Run the test; it passes.** Also re-run `trees/branch.int.test.ts`: the branch CTE must ignore soft-deleted rows. It already filters `deleted_at`, so it needs no change.

- [ ] **Step 5: Commit** `feat(api): delete preview, delete people (person/descendants) and relations into Trash batches`

---

## Task 9: API — Trash: list, detail, restore, erase permanently

**Files:**
- Create: `apps/api/src/trees/trash.ts`, `apps/api/src/routes/trash.ts`, `apps/api/src/routes/trash.int.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/test/tree-helpers.ts`

| Method | Path | Authorises |
|---|---|---|
| GET | `/api/v1/trees/:treeId/trash` | `trash.view` (owner) |
| GET | `/api/v1/trees/:treeId/trash/:batchId` | `trash.view` |
| POST | `/api/v1/trees/:treeId/trash/:batchId/restore` | `trash.restore` |
| DELETE | `/api/v1/trees/:treeId/trash/:batchId` | `trash.erase` |

  The Trash shows unrestored batches only. A restored batch, or one of another tree, gives 404.

- [ ] **Step 1: Write the failing integration test** `trash.int.test.ts`. Use the Hale setup from Task 8 (copy the `setup()` function), and make deletions through the API routes.

  **Test cases:**
  1. **List:**
     - After the owner deletes Dan (`person`) and the Leo+Zoe union, `GET …/trash` lists two batches, newest first.
     - Dan's batch has `root: { kind: 'person', name: 'Dan' }`, `people: 1`, `unions: 1`, `links: 2` and `deletedBy: 'Owner'`.
     - The union batch has `root: { kind: 'union', partners: ['Leo', 'Zoe'] }`.
  2. **Detail:** Dan's batch has `people` = [Dan], the Dan+(none) union with partners `['Dan']`, two links, and `slots: 1`.
  3. **Restore:**
     - `POST …/restore` gives 204.
     - Dan, his union and his links are live again, with `deletion_batch_id` null.
     - The Dan+Ann union has Dan back in slot a.
     - The batch has `restored_at` set and is no longer listed.
     - The audit has `trash.restore`.
     - A second restore gives 404.
  4. **Slot conflict:**
     - Delete Dan, then fill the emptied Dan+Ann slot with a new parent of Leo: `POST …/persons` with `attach: { to: Leo, as: 'parent', unionId: <Dan+Ann> }`.
     - Restore Dan's batch: 409 `CONFLICT`.
     - Dan is still deleted and nothing else changed. Snapshot `persons`, `unions` and `parent_child` (`id`, `deleted_at`, partners) before and after.
  5. **Duplicate-link conflict:**
     - Delete Leo's link (relation batch). Re-link Leo to Dan+Ann with `relatives` `as: 'child'`.
     - Restoring the link batch gives 409, and nothing changed.
  5a. **Cycle on restore:**
      - Delete the link Leo→(Dan+Ann) (relation batch b).
      - Make Dan Leo's child: `POST …/persons/<Leo>/relatives { personId: Dan, as: 'child' }`. That's allowed now that Leo is no longer Dan's child.
      - Restoring b gives 409 `CONFLICT` (`hasCycle`), and nothing changed: the snapshot is equal and b is still listed.
  6. **Order independence:**
     - Delete Ann (`person`): Dan+Ann becomes (Dan, null). Then delete Dan: the union has no partner left, so it's soft-deleted in Dan's batch.
     - Restore Ann's batch first: the union is still hidden (it's in Dan's batch), and Ann's slot is restored on the row.
     - Restore Dan's batch: the union is live with both partners.
  7. **Erase:**
     - Edit Dan once through `PATCH …/persons/<Dan>`, so a `person.update` audit row exists for him.
     - Make Dan a member's card (`tree_members.person_id`).
     - Create an invite with `stewardAnchorPersonId: Dan` and one with `targetPersonId: Dan`, and a grant anchored on Dan with a derived grant under it.
     - Delete Dan and erase his batch (`DELETE …/trash/:id`): 204.
     - The member row still exists with `person_id` null.
     - Both invites and both grants are gone.
     - The persons, unions and links rows of the batch are gone.
     - The batch row is gone.
     - Audit rows with `entityId` Dan (`person.create` etc.) are gone.
     - The audit has `trash.erase`, plus `steward.revoke` ×2 and `invite.revoke` ×2.
  7a. **Erase never destroys a live union:**
      - Delete the union Leo+Zoe as b1. Delete Zoe (`person`) as b2: Zoe's only union is already deleted, so b2 just takes Zoe.
      - Restore b1: the union is live again, still holding Zoe's id, while Zoe is deleted.
      - Erase b2: 204. The Leo+Zoe union row still exists, is live, has Zoe's slot emptied (`partner_b_id` null) and keeps Leo.
      - Without the slot-emptying step the partner FK cascade would have deleted it. Assert the row by id.
  7b. **Erase removes every audit row naming the erased person:** after 7, no `audit_log` row of the tree has Dan's id in `person_ids`. That includes the `union.update` or `link.*` rows that named him.
  8. **Permissions:**
     - The steward S and the editor E get 403 on list, detail, restore and erase.
     - An outsider gets 404 (also covered by isolation).
     - Another tree's batch id gives 404.

- [ ] **Step 2: Run it; it fails.**

- [ ] **Step 3: Implement** `apps/api/src/trees/trash.ts`

```ts
import { hasCycle, type TrashBatch, type TrashBatchDetail, type TrashRoot } from '@family-tree/shared';
import { and, arrayOverlaps, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Queryable, Tx } from '../db/client.js';
import {
  auditLog,
  branchStewards,
  deletionBatches,
  invites,
  parentChild,
  persons,
  treeMembers,
  unions,
  users,
} from '../db/schema.js';
import { conflict, isUniqueViolation, notFound } from '../errors.js';
import { audit, type AuditActor } from './audit.js';
import { loadLiveGraph } from './graph.js';
import { fullName, summaryColumns } from './people.js';

type BatchRow = typeof deletionBatches.$inferSelect;

/** Names of every person row of the tree, deleted or not: Trash labels need deleted people. */
async function nameMap(db: Queryable, treeId: string) {
  const rows = await db
    .select({ id: persons.id, givenName: persons.givenName, middleName: persons.middleName, surname: persons.surname })
    .from(persons)
    .where(eq(persons.treeId, treeId));
  return new Map(rows.map((r) => [r.id, fullName(r)]));
}

const names = (m: Map<string, string>, ids: (string | null)[]) =>
  ids.filter((id): id is string => id !== null && m.has(id)).map((id) => m.get(id)!);

async function rootOf(db: Queryable, b: BatchRow, m: Map<string, string>): Promise<TrashRoot> {
  if (b.rootPersonId) return { kind: 'person', name: m.get(b.rootPersonId) ?? '' };
  if (b.rootUnionId) {
    const [u] = await db.select().from(unions).where(eq(unions.id, b.rootUnionId));
    return { kind: 'union', partners: u ? names(m, [u.partnerAId, u.partnerBId]) : [] };
  }
  const [l] = await db
    .select({ childId: parentChild.childId, a: unions.partnerAId, b: unions.partnerBId })
    .from(parentChild)
    .innerJoin(unions, eq(unions.id, parentChild.unionId))
    .where(eq(parentChild.id, b.rootParentChildId!));
  return {
    kind: 'link',
    child: l ? (m.get(l.childId) ?? null) : null,
    parents: l ? names(m, [l.a, l.b]) : [],
  };
}

const count = (table: typeof persons | typeof unions | typeof parentChild) =>
  sql<number>`(select count(*)::int from ${table} where ${table.deletionBatchId} = ${deletionBatches.id})`;

async function summarise(db: Queryable, treeId: string, where: ReturnType<typeof and>) {
  const rows = await db
    .select({
      batch: deletionBatches,
      deletedBy: users.name,
      people: count(persons),
      unions: count(unions),
      links: count(parentChild),
    })
    .from(deletionBatches)
    .leftJoin(users, eq(users.id, deletionBatches.deletedByUserId))
    .where(where)
    .orderBy(desc(deletionBatches.createdAt));
  const m = await nameMap(db, treeId);
  const out: TrashBatch[] = [];
  for (const r of rows) {
    out.push({
      id: r.batch.id,
      mode: r.batch.mode,
      createdAt: r.batch.createdAt.toISOString(),
      deletedBy: r.deletedBy,
      root: await rootOf(db, r.batch, m),
      people: r.people,
      unions: r.unions,
      links: r.links,
    });
  }
  return { rows: out, names: m };
}

const unrestored = (treeId: string) =>
  and(eq(deletionBatches.treeId, treeId), isNull(deletionBatches.restoredAt));

export async function listTrash(db: Queryable, treeId: string): Promise<TrashBatch[]> {
  return (await summarise(db, treeId, unrestored(treeId))).rows;
}

export async function trashBatchDetail(db: Queryable, treeId: string, batchId: string): Promise<TrashBatchDetail> {
  const { rows, names: m } = await summarise(db, treeId, and(unrestored(treeId), eq(deletionBatches.id, batchId)));
  const batch = rows[0];
  if (!batch) throw notFound();
  const people = await db.select(summaryColumns).from(persons).where(eq(persons.deletionBatchId, batchId));
  const us = await db.select().from(unions).where(eq(unions.deletionBatchId, batchId));
  const ls = await db
    .select({ id: parentChild.id, childId: parentChild.childId, a: unions.partnerAId, b: unions.partnerBId })
    .from(parentChild)
    .innerJoin(unions, eq(unions.id, parentChild.unionId))
    .where(eq(parentChild.deletionBatchId, batchId));
  const [row] = await db.select({ slots: deletionBatches.slots }).from(deletionBatches).where(eq(deletionBatches.id, batchId));
  return {
    batch,
    people,
    unions: us.map((u) => ({ id: u.id, partners: names(m, [u.partnerAId, u.partnerBId]) })),
    links: ls.map((l) => ({ id: l.id, child: m.get(l.childId) ?? null, parents: names(m, [l.a, l.b]) })),
    slots: row?.slots.length ?? 0,
  };
}

/** Locks and returns an unrestored batch of this tree, or 404. The caller took lockTreeGraph first. */
async function lockBatch(tx: Tx, treeId: string, batchId: string) {
  const [b] = await tx
    .select()
    .from(deletionBatches)
    .where(and(unrestored(treeId), eq(deletionBatches.id, batchId)))
    .for('update');
  if (!b) throw notFound();
  return b;
}

const restoreConflict = () =>
  conflict('This can’t be restored because the family has changed since it was deleted');

/** All or nothing (decision 7). The caller holds lockTreeGraph and has authorised. */
export async function restoreBatch(tx: Tx, actor: AuditActor, batchId: string) {
  const { treeId } = actor;
  const b = await lockBatch(tx, treeId, batchId);
  for (const s of b.slots) {
    const [u] = await tx
      .select({ a: unions.partnerAId, b: unions.partnerBId })
      .from(unions)
      .where(and(eq(unions.treeId, treeId), eq(unions.id, s.unionId)))
      .for('update');
    if (!u) continue; // erased with another batch: nothing to put back into
    const current = s.slot === 'a' ? u.a : u.b;
    if (current === s.personId) continue;
    if (current !== null) throw restoreConflict();
    await tx
      .update(unions)
      .set(s.slot === 'a' ? { partnerAId: s.personId } : { partnerBId: s.personId })
      .where(eq(unions.id, s.unionId));
  }
  const clear = { deletedAt: null, deletionBatchId: null };
  let restored: { id: string }[];
  try {
    restored = await tx
      .update(persons)
      .set(clear)
      .where(eq(persons.deletionBatchId, b.id))
      .returning({ id: persons.id });
    await tx.update(unions).set(clear).where(eq(unions.deletionBatchId, b.id));
    await tx.update(parentChild).set(clear).where(eq(parentChild.deletionBatchId, b.id));
  } catch (err) {
    if (isUniqueViolation(err)) throw restoreConflict();
    throw err;
  }
  // A link revived here may close a loop with links added since (decision 7).
  if (hasCycle(await loadLiveGraph(tx, treeId))) throw restoreConflict();
  await tx.update(deletionBatches).set({ restoredAt: sql`now()` }).where(eq(deletionBatches.id, b.id));
  await audit(tx, actor, {
    action: 'trash.restore',
    entityType: 'batch',
    entityId: b.id,
    personIds: [...restored.map((r) => r.id), ...b.slots.map((s) => s.personId)],
    after: { mode: b.mode, people: restored.length },
  });
}

/** Decision 8. The caller holds lockTreeGraph and has authorised. */
export async function eraseBatch(tx: Tx, actor: AuditActor, batchId: string) {
  const { treeId } = actor;
  const b = await lockBatch(tx, treeId, batchId);
  const ids = (await tx.select({ id: persons.id }).from(persons).where(eq(persons.deletionBatchId, b.id))).map((r) => r.id);
  const unionIds = (await tx.select({ id: unions.id }).from(unions).where(eq(unions.deletionBatchId, b.id))).map((r) => r.id);
  const linkIds = (await tx.select({ id: parentChild.id }).from(parentChild).where(eq(parentChild.deletionBatchId, b.id))).map((r) => r.id);

  if (ids.length > 0) {
    // NO ACTION FKs: unlink cards and drop invites that name these people.
    await tx
      .update(treeMembers)
      .set({ personId: null })
      .where(and(eq(treeMembers.treeId, treeId), inArray(treeMembers.personId, ids)));
    const doomedInvites = await tx
      .delete(invites)
      .where(
        and(
          eq(invites.treeId, treeId),
          or(inArray(invites.stewardAnchorPersonId, ids), inArray(invites.targetPersonId, ids)),
        ),
      )
      .returning({ id: invites.id });
    for (const inv of doomedInvites) {
      await audit(tx, actor, { action: 'invite.revoke', entityType: 'invite', entityId: inv.id, after: { reason: 'erased' } });
    }
    // Grants anchored on them, and every grant derived from those.
    const all = await tx
      .select({ id: branchStewards.id, userId: branchStewards.userId, anchorPersonId: branchStewards.anchorPersonId, parentGrantId: branchStewards.parentGrantId })
      .from(branchStewards)
      .where(eq(branchStewards.treeId, treeId));
    const idSet = new Set(ids);
    const gone = new Set(all.filter((g) => idSet.has(g.anchorPersonId)).map((g) => g.id));
    for (let grew = true; grew; ) {
      grew = false;
      for (const g of all) {
        if (g.parentGrantId && gone.has(g.parentGrantId) && !gone.has(g.id)) {
          gone.add(g.id);
          grew = true;
        }
      }
    }
    for (const g of all.filter((x) => gone.has(x.id))) {
      await audit(tx, actor, { action: 'steward.revoke', entityType: 'grant', entityId: g.id, before: { userId: g.userId }, after: { reason: 'erased' } });
    }
    if (gone.size > 0) await tx.delete(branchStewards).where(inArray(branchStewards.id, [...gone]));
  }

  if (ids.length > 0) {
    // Unions outside this batch that still hold an erased person next to someone else (for
    // example a union restored from another batch): empty that slot, or the partner FK's
    // ON DELETE CASCADE would destroy a union that may be live. A union whose only partner is
    // erased goes with them.
    const outside = await tx
      .select({ id: unions.id, a: unions.partnerAId, b: unions.partnerBId, batch: unions.deletionBatchId })
      .from(unions)
      .where(and(eq(unions.treeId, treeId), or(inArray(unions.partnerAId, ids), inArray(unions.partnerBId, ids))));
    const erasedSet = new Set(ids);
    for (const u of outside) {
      if (u.batch === b.id) continue;
      const aGone = u.a !== null && erasedSet.has(u.a);
      const bGone = u.b !== null && erasedSet.has(u.b);
      if (aGone && !bGone && u.b !== null) await tx.update(unions).set({ partnerAId: null }).where(eq(unions.id, u.id));
      if (bGone && !aGone && u.a !== null) await tx.update(unions).set({ partnerBId: null }).where(eq(unions.id, u.id));
    }
  }

  await tx.delete(parentChild).where(eq(parentChild.deletionBatchId, b.id));
  await tx.delete(unions).where(eq(unions.deletionBatchId, b.id));
  // Cascades to their residences and to rows of other batches that still point at them.
  await tx.delete(persons).where(eq(persons.deletionBatchId, b.id));

  const erased = [...ids, ...unionIds, ...linkIds];
  if (erased.length > 0) {
    await tx.delete(auditLog).where(
      and(
        eq(auditLog.treeId, treeId),
        or(
          inArray(auditLog.entityId, erased),
          // Every row that names an erased person (decision 8).
          ids.length > 0 ? arrayOverlaps(auditLog.personIds, ids) : undefined,
        ),
      ),
    );
  }
  await tx.delete(deletionBatches).where(eq(deletionBatches.id, b.id));
  await audit(tx, actor, {
    action: 'trash.erase',
    entityType: 'batch',
    entityId: b.id,
    after: { mode: b.mode, people: ids.length, unions: unionIds.length, links: linkIds.length },
  });
}
```

  **`apps/api/src/routes/trash.ts`:**

```ts
export const trashRoutes: FastifyPluginAsync<TreeRouteOptions> = async (app, { auth, db }) => {
  app.addHook('preHandler', requireSession(auth));
  const base = '/api/v1/trees/:treeId/trash';

  app.get(base, async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'trash.view', TREE);
    return { batches: await listTrash(db, access.treeId) };
  });

  app.get(`${base}/:batchId`, async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'trash.view', TREE);
    return trashBatchDetail(db, access.treeId, idParam(req.params, 'batchId'));
  });

  app.post(`${base}/:batchId/restore`, async (req, reply) => {
    const treeId = idParam(req.params, 'treeId');
    const batchId = idParam(req.params, 'batchId');
    await db.transaction(async (tx) => {
      await lockTreeGraph(tx, treeId);
      const access = await loadAccess(tx, treeId, req.user!.id);
      authorize(access, 'trash.restore', TREE);
      await restoreBatch(tx, access, batchId);
    });
    return reply.code(204).send();
  });

  app.delete(`${base}/:batchId`, async (req, reply) => {
    const treeId = idParam(req.params, 'treeId');
    const batchId = idParam(req.params, 'batchId');
    await db.transaction(async (tx) => {
      await lockTreeGraph(tx, treeId);
      const access = await loadAccess(tx, treeId, req.user!.id);
      authorize(access, 'trash.erase', TREE);
      await eraseBatch(tx, access, batchId);
    });
    return reply.code(204).send();
  });
};
```

  **Notes on the code above:**
  - Add the imports (`TREE`, `authorize`, `loadAccess`, `lockTreeGraph`, `idParam`, `requireSession`, the trash functions), and register `trashRoutes` in `app.ts`.
  - The count subqueries in `summarise` select by `deletion_batch_id`. The detail queries are scoped by batch id only, which is safe because `summarise` already proved the batch belongs to this tree.
  - In `restoreBatch`, an `AppError` thrown inside the transaction rolls everything back, including slots already put back.
  - **`tree-helpers.ts`:** add `softDeleteBatch(db, treeId, userId, personIds)`. It inserts a `person` batch and tags the given people, for isolation snapshots.

- [ ] **Step 4: Run the test; it passes.**

- [ ] **Step 5: Commit** `feat(api): Trash list, preview, all-or-nothing restore, erase permanently`

---

## Task 10: API — audit tree, member, steward and invite changes

**Files:**
- Modify: `apps/api/src/routes/trees.ts`, `members.ts`, `stewards.ts`, `invites.ts`
- Create: `apps/api/src/routes/audit.int.test.ts`

Each change below happens **inside the same transaction** as the write. Where a route writes with a single `db.update`/`db.insert` today, wrap the write in `db.transaction(async (tx) => { …write with tx…; await audit(tx, …) })`. Never put tokens or token hashes in `before`/`after`.

**`personIds` rule (decision 13):** `member.*`, `steward.*` and `invite.*` rows **never** set `personIds`. The anchor and target ids stay in `after`, which only a future owner-only view reads. Only `tree.*` and `person.*` rows below name people.

| Route | Action | Entity | `before` → `after` | `personIds` |
|---|---|---|---|---|
| POST /trees | `tree.create`, then `person.create` | tree / person | — → `{ name }` / the root's fields | [root] for the person row |
| PATCH /trees/:id (name) | `tree.rename` | tree | `{ name: access.treeName }` → `{ name }` | — |
| PATCH /trees/:id (root) | `tree.changeRoot` | tree | `{ rootPersonId: access.rootPersonId }` → `{ rootPersonId }` | old and new root |
| DELETE /trees/:id | `tree.delete` | tree | — | — |
| POST /trees/:id/restore | `tree.restore` | tree | — | — |
| PATCH members/:userId | `member.role` | member (entityId = userId) | `{ role }` → `{ role }` | — |
| DELETE members/:userId | `member.remove` | member | `{ role }` → — | — |
| DELETE members/:userId (grants) | `steward.revoke` for every grant the removal cascades away: the member's own and every grant derived from them. Collect them before the delete, with the same closure walk as `eraseBatch` | grant | `{ userId }` → `{ reason: 'member removed' }` | — |
| POST transfer | `ownership.transfer` | member (the new owner) | `{ ownerUserId: old }` → `{ ownerUserId: new }` | — |
| POST transfer (grants) | `steward.revoke` for each of the new owner's own grants it deletes | grant | `{ userId }` → `{ reason: 'became owner' }` | — |
| POST stewards | `steward.grant` | grant | — → `{ userId, anchorPersonId, parentGrantId }` | — |
| DELETE stewards/:id | `steward.revoke` for the grant **and** each derived grant the cascade removes | grant | `{ userId, anchorPersonId }` → `{ reason: 'revoked' }` | — |
| POST invites | `invite.create` | invite | — → `{ role, stewardAnchorPersonId, targetPersonId }` | — |
| DELETE invites/:id | `invite.revoke` | invite | — | — (only when a row was actually revoked: add `.returning({ id })`) |
| POST invites/accept | `member.join` (actor = the joining user), plus `steward.grant` when a grant row was inserted (add `.returning`) | member / grant | — → `{ role, inviteId, personId }` | — |

**`PATCH /trees/:id` locking (ground rules, "Global lock order"):** inside its transaction, call `await lockTreeGraph(tx, access.treeId)` **first**, before the `persons … FOR SHARE` check and the `trees` update. The person delete takes the advisory lock, then `trees FOR UPDATE`, then updates persons. Without this, `PATCH /trees` (persons FOR SHARE, then update trees) could deadlock with it. `DELETE /trees/:id` and the tree restore touch only the `trees` row, so they need no advisory lock.

  **Notes on the table:**
  - In `POST /trees`, the actor is `{ treeId: tree.id, userId: user.id }`, because there is no `Access` yet.
  - In `stewards` DELETE, extend the select to fetch `userId` and `anchorPersonId`.
  - In `invites/accept`, the actor is `{ treeId: inv.treeId, userId }`.

- [ ] **Step 1: Write the failing test** `audit.int.test.ts`. It's one flow, written with the API only:
  - **The steps:**
    1. Create a tree, rename it, create a second person through `POST …/persons`, and change the root to them.
    2. Create an editor invite with a steward anchor. A second user (with 2FA) accepts it.
    3. Change their role to viewer.
    4. The owner grants them another anchor, then revokes it.
    5. Create and revoke a viewer invite.
    6. Remove the member.
    7. Delete the tree, then restore it.
  - **Expected:** rows written in one transaction share `created_at`, because Postgres `now()` is the transaction start. So group `auditRows(db, treeId)` by `createdAt` (in order), sort the actions inside each group, and compare with `toEqual`:
    ```
    [person.create, tree.create]          create tree (root card)
    [tree.rename]
    [person.create]                       second person via the API
    [tree.changeRoot]
    [invite.create]
    [member.join, steward.grant]          accept (with the invite's anchor)
    [member.role]
    [steward.grant]
    [steward.revoke]
    [invite.create]
    [invite.revoke]
    [member.remove, steward.revoke]       removal cascades the invite's grant away
    [tree.delete]
    [tree.restore]
    ```
  - **Also assert:**
    - `member.join.userId` is the second user.
    - No row's `JSON.stringify(before)` or `JSON.stringify(after)` contains the invite token or its hash.
    - Revoking an already revoked invite adds no second `invite.revoke`.
    - No `member.*`, `steward.*` or `invite.*` row has a non-empty `personIds`.
    - Revoking a grant that has a derived grant writes two `steward.revoke` rows.
  - **No deadlock:** 20 times, fire `PATCH /trees/:id { rootPersonId: P }` and `POST …/persons/P/delete { mode: 'person' }` concurrently (`Promise.all`) on fresh people. Each pair settles with 2xx/4xx, never 500. Postgres reports a deadlock as `40P01`, which surfaces as 500 `INTERNAL`.

- [ ] **Step 2: Run it; it fails.** **Step 3: Implement** the table above. Re-run every existing `routes/*.int.test.ts`: none may break.

- [ ] **Step 4: Commit** `feat(api): audit tree, member, steward and invite changes`

---

## Task 11: API — tree purge job and CLI

**Files:**
- Create: `apps/api/src/trees/purge.ts`, `apps/api/src/trees/purge.int.test.ts`, `apps/api/src/trees/purge-cli.ts`
- Modify: `apps/api/src/config.ts`, `apps/api/src/config.test.ts`, `apps/api/src/server.ts`, `apps/api/package.json`, `package.json`, `.env.production.example`

- [ ] **Step 1: Write the failing tests.**

  **`config.test.ts`:**
  - `TREE_PURGE_INTERVAL_MINUTES` defaults to 60.
  - `'0'` parses to 0.
  - `'-1'` and `'abc'` are rejected.

  **`trees/purge.int.test.ts`** (direct inserts, with `ownerWithTree` for real owners):
  1. **Purged with everything in it:** tree A is soft-deleted 31 days ago (`update trees set deleted_at = now() - interval '31 days'`). It has a member whose `person_id` is set, an invite anchored on a person, a grant, a deletion batch with a tagged person, and audit rows. `purgeDeletedTrees(db)` returns an array that contains A's id. No row of A remains in `trees`, `persons`, `tree_members`, `branch_stewards`, `invites`, `deletion_batches` or `audit_log`.
  2. **Inside the window:** tree B, deleted 29 days ago, is kept.
  3. **Live:** tree C, live, is kept.
  4. **Ownerless:** tree D is ownerless (its owner's `tree_members` row is deleted directly) and deleted 31 days ago. It is purged.
  5. **Concurrent calls:** two `purgeDeletedTrees` calls in parallel both resolve. One returns `[]` (the lock is taken) or both split the work, and the union of their results covers every due tree.
  6. **The job:** `startPurgeJob(db, log, 60_000)` purges a due tree on start (`await vi.waitFor(…)`). The returned stop function clears the interval. `log` is `{ info: vi.fn(), error: vi.fn() }`, and `info` was called with `{ count: n }`.

  Other test files share the database, so assert with `toContain` / `not.toContain` on ids, never on exact lengths.

- [ ] **Step 2: Run them; they fail.**

- [ ] **Step 3: Implement.**

  **`config.ts`:** add this next to `MAX_TREES_PER_USER`:

```ts
    // How often the API purges trees deleted more than TREE_RESTORE_DAYS ago (0 = never).
    TREE_PURGE_INTERVAL_MINUTES: z.coerce.number().int().min(0).max(10_080).default(60),
```

  **`trees/purge.ts`:**

```ts
import { TREE_RESTORE_DAYS } from '@family-tree/shared';
import { and, isNotNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { trees } from '../db/schema.js';
import { safeError } from '../errors.js';

/**
 * Hard-deletes trees soft-deleted more than TREE_RESTORE_DAYS ago, with everything in them
 * (FK cascades), owner or not. Returns the purged ids (phase 6 deletes their photos).
 * One instance at a time: the others get [] while the lock is held. A concurrent restore wins,
 * because the DELETE re-checks deleted_at after waiting for the row lock.
 */
export async function purgeDeletedTrees(db: Db, now = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - TREE_RESTORE_DAYS * 86_400_000);
  return db.transaction(async (tx) => {
    const [lock] = (await tx.execute(
      sql`select pg_try_advisory_xact_lock(hashtextextended('purge-trees', 0)) as ok`,
    )) as unknown as { ok: boolean }[];
    if (!lock?.ok) return [];
    const rows = await tx
      .delete(trees)
      .where(and(isNotNull(trees.deletedAt), lt(trees.deletedAt, cutoff)))
      .returning({ id: trees.id });
    return rows.map((r) => r.id);
  });
}

interface JobLog {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/** Runs the purge now and then every `intervalMs`; returns a stop function. */
export function startPurgeJob(db: Db, log: JobLog, intervalMs: number): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    purgeDeletedTrees(db)
      .then((ids) => {
        if (ids.length > 0) log.info({ count: ids.length }, 'purged deleted trees');
      })
      .catch((err: unknown) => log.error({ err: safeError(err) }, 'tree purge failed'))
      .finally(() => {
        running = false;
      });
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
```

  The restore route refuses at `now − deletedAt >= 30 days`, and the purge deletes at `deletedAt < now − 30 days`. So no tree can be restored and purged at the same instant.

  **`server.ts`:**
  - **Start:** after `deps.attachAuthLogger(…)`:
    ```ts
    const stopPurge =
      config.TREE_PURGE_INTERVAL_MINUTES > 0
        ? startPurgeJob(deps.db, app.log.child({ module: 'purge' }), config.TREE_PURGE_INTERVAL_MINUTES * 60_000)
        : () => {};
    ```
  - **Stop:** call `stopPurge()` first in `shutdown`.

  **`trees/purge-cli.ts`:**
  - It loads the config the same way `reset-link-cli.ts` does, then runs `createDb`, `await purgeDeletedTrees(db)`, prints `Purged N deleted tree(s).` and calls `sql.end()` in `finally`.
  - It may run in production: it only does what the scheduled job does.

  **Scripts:**
  - `apps/api/package.json`:
    - `"purge-trees": "NODE_OPTIONS=--conditions=development tsx src/trees/purge-cli.ts"` (dev, with tsx).
    - `"purge-trees:prod": "node dist/trees/purge-cli.js"`.
  - Root `package.json`: `"purge-trees": "docker compose exec api pnpm --filter @family-tree/api purge-trees"`.
  - **Production image:** `apps/api/Dockerfile` builds with `pnpm --filter @family-tree/api... build` (`tsc -p tsconfig.build.json`, so `src/trees/purge-cli.ts` becomes `dist/trees/purge-cli.js`). It ships `pnpm deploy --prod /out`, which contains `dist/` and the prod dependencies, but no tsx and no pnpm.
  - So in production the one-off command is `docker compose exec api node dist/trees/purge-cli.js`. Usually it isn't needed, because the in-process job runs.
  - Verify it: `pnpm --filter @family-tree/api build && ls apps/api/dist/trees/purge-cli.js`. Phase 7's `self-hosting.md` documents the command. `tsconfig.build.json` must not exclude `*-cli.ts`; check it.

  **`.env.production.example`:** add `# TREE_PURGE_INTERVAL_MINUTES=60   # 0 turns the in-process purge off`.

- [ ] **Step 4: Run the tests; they pass.** Then `pnpm typecheck`.

- [ ] **Step 5: Commit** `feat(api): purge trees deleted more than 30 days ago (in-process job and CLI)`

---

## Task 12: API — isolation suite and the permission matrix for the new routes

**Files:**
- Modify: `apps/api/src/routes/isolation.int.test.ts`
- Create: `apps/api/src/routes/people-permissions.int.test.ts`

- [ ] **Step 1: Extend the isolation suite.**

  **`Ids`:** add `person2`, `union`, `link`, `residence` and `batch`.

  **`setup()`:**
  - Add persons `p2`, `p3` and `p4`, plus `family(db, treeId, person, p2, [p3])` for the union and link.
  - Insert a residence for `person`.
  - Add `softDeleteBatch(db, treeId, owner.userId, [p4.id])` for the batch.

  **`routes()`:** append these:

```ts
  ['GET', `/api/v1/trees/${t}/persons/${ids.person}`],
  ['POST', `/api/v1/trees/${t}/persons`, { person: { givenName: 'Intruder' } }],
  ['PATCH', `/api/v1/trees/${t}/persons/${ids.person}`, { version: 1, surname: 'X' }],
  ['GET', `/api/v1/trees/${t}/persons/${ids.person}/history`],
  ['POST', `/api/v1/trees/${t}/persons/${ids.person}/relatives`, { personId: ids.person2, as: 'partner' }],
  ['POST', `/api/v1/trees/${t}/persons/${ids.person}/residences`, { place: 'X' }],
  ['PATCH', `/api/v1/trees/${t}/residences/${ids.residence}`, { place: 'X' }],
  ['DELETE', `/api/v1/trees/${t}/residences/${ids.residence}`],
  ['PATCH', `/api/v1/trees/${t}/unions/${ids.union}`, { status: 'divorced' }],
  ['POST', `/api/v1/trees/${t}/unions/${ids.union}/delete`],
  ['PATCH', `/api/v1/trees/${t}/parent-child/${ids.link}`, { kind: 'step' }],
  ['POST', `/api/v1/trees/${t}/parent-child/${ids.link}/delete`],
  ['POST', `/api/v1/trees/${t}/persons/${ids.person}/delete-preview`, { mode: 'person' }],
  ['POST', `/api/v1/trees/${t}/persons/${ids.person}/delete`, { mode: 'person' }],
  ['GET', `/api/v1/trees/${t}/trash`],
  ['GET', `/api/v1/trees/${t}/trash/${ids.batch}`],
  ['POST', `/api/v1/trees/${t}/trash/${ids.batch}/restore`],
  ['DELETE', `/api/v1/trees/${t}/trash/${ids.batch}`],
```

  **`snapshot()`:** extend it with:
  - `persons`: id, version, deletedAt, deletionBatchId, surname.
  - `unions`: id, partners, status, deletedAt.
  - `parentChild`: id, kind, deletedAt.
  - `residences`: id, place.
  - `deletionBatches`: id, restoredAt.
  - The audit row count.

  Sort every list by id.

  **"Tree B authority":** add sub-routes that use **tree B's** URL with tree A's ids:
  - Every person, union, link, residence and trash route above, with `t = treeB` and A's ids. Each must give 404.
  - `POST /trees/B/persons` with `attach: { to: <A person>, as: 'child' }`: 400 `VALIDATION`.
  - `POST /trees/B/persons/<B person>/relatives { personId: <A person> }`: 400.
  - A's snapshot is unchanged after all of them.

  **Unchanged tests:** the soft-deleted-tree test and the 401 test cover the new routes automatically, through `routes()`.

- [ ] **Step 2: Write** `people-permissions.int.test.ts`, table-driven with `it.each`. Each row gets a fresh setup.

  **Setup:** the Hale shape from Task 8, with these roles:
  - owner
  - editor
  - viewer
  - **steward:** a viewer with 2FA and a grant on Robert
  - **dormant steward:** a viewer **without** 2FA and a grant on Robert
  - **editor steward:** an editor with 2FA and a grant on Robert

  Expected status codes:

| Action | owner | editor | viewer | steward | dormant | editor steward |
|---|---|---|---|---|---|---|
| POST person, unattached | 201 | 201 | 403 | 403 | 403 | 201 |
| POST person, child of Dan | 201 | 201 | 403 | 201 | 403 | 201 |
| POST person, child of George | 201 | 201 | 403 | 403 | 403 | 201 |
| PATCH Dan | 200 | 200 | 403 | 200 | 403 | 200 |
| PATCH George | 200 | 200 | 403 | 403 | 403 | 200 |
| PATCH union Robert+Mary | 204 | 204 | 403 | 204 | 403 | 204 |
| PATCH union George+Greta | 204 | 204 | 403 | 403 | 403 | 204 |
| POST residence on Dan | 201 | 201 | 403 | 201 | 403 | 201 |
| delete-preview Kim | 200 | 403 | 403 | 200 | 403 | 200 |
| delete Kim | 200 | 403 | 403 | 200 | 403 | 200 |
| delete George | 200 | 403 | 403 | 403 | 403 | 403 |
| delete link Dan+Ann → Leo | 200 | 403 | 403 | 403 | 403 | 403 |
| GET trash | 200 | 403 | 403 | 403 | 403 | 403 |
| restore a batch | 204 | 403 | 403 | 403 | 403 | 403 |

  Setup also creates one batch with `softDeleteBatch` (a scratch person) for the restore row.

  **Steward-created person** (spec §4 rule 5), as one more case:
  - The steward creates "Neo" as a child of Dan, then PATCHes Neo (200).
  - They link an existing **Ann** as Neo's partner. `relation.add` ends are Neo and Ann, and Neo is in scope, so it succeeds: 204.
  - Deleting Neo is then 403, because Ann, the other partner, is outside the scope. Ann has parents, so rule 4 doesn't pull her into the branch. Don't use George or Greta here: they have no parents, so they would join the branch as Neo's partner.

- [ ] **Step 3: Run both files.** Fix any route that answers differently, unless the table above is wrong against spec §4; if so, stop and ask. **Step 4: Commit** `test(api): isolation and permission matrix for people, relations and Trash`

---

## Task 13: Web — API client, messages and fake for people, relations and Trash

**Files:**
- Modify: `apps/web/src/auth/api.ts` (MESSAGES), `apps/web/src/trees/api.ts`, `apps/web/src/trees/api.test.ts`, `apps/web/src/test/fake-trees.ts`, `apps/web/src/test/fake-trees.test.ts`

- [ ] **Step 1: Write the failing tests** in `trees/api.test.ts` (stub `fetch` as the existing tests do):
  1. **Reading a person:** `getPerson(t, p)` GETs `/api/v1/trees/t/persons/p` and returns the parsed `PersonView`.
  2. **Creating a person:** `createPerson(t, input)` POSTs the input and returns `{ id }`.
  3. **Stale edit:** `updatePerson` with a 409 `CONFLICT` body gives `{ code: 'CONFLICT', message: MESSAGES.staleEdit }`, not the generic `MESSAGES.conflict`.
  4. **Restore conflict:** `restoreBatch` with a 409 gives `MESSAGES.restoreConflict`.
  5. **Trash forbidden:** `listTrash` with a 403 gives `MESSAGES.trashOwnerOnly`.
  6. **Delete forbidden:** `deletePerson` with a 403 gives `MESSAGES.deleteNotAllowed`.
  7. **Relation conflict:** `addRelative` with a 409 gives `MESSAGES.alreadyRelated`.
  8. **Deleting a residence:** `deleteResidence` sends DELETE with no body.
  9. **Previewing a delete:** `previewDelete(t, p, 'descendants')` POSTs `{ mode: 'descendants' }` to `…/delete-preview`.
  10. **Unexpected bodies:** a 200 whose body doesn't match the schema gives the generic error.

  In `fake-trees.test.ts`, add round trips:
  - `updatePerson` with the wrong version returns `CONFLICT`.
  - `deletePerson` moves the person to the Trash, and `restoreBatch` brings them back.

- [ ] **Step 2: Run them; they fail.**

- [ ] **Step 3: Implement.**

  **`auth/api.ts` `MESSAGES`:** add these. They are only selected per call, so `BY_CODE` stays unchanged.

```ts
  staleEdit:
    'Someone else changed this person while you were editing. Load the latest version and make your change again.',
  restoreConflict:
    'This can’t be restored because the family has changed since it was deleted. You can erase it instead.',
  alreadyRelated: 'They are already related this way',
  trashOwnerOnly: 'Only the tree owner can open the Trash',
  personNotFound: 'This person doesn’t exist or has been deleted',
  deleteNotAllowed: 'This includes people outside your branch. Ask the owner to delete it.',
  itemChanged: 'That changed in the meantime. Reload and try again.',
```

  **`trees/api.ts`:**
  - Give `request` a last parameter, `codes?: Partial<Record<string, string>>`. After `toAuthError(...)`, if `codes?.[error.code]` is set, replace the message with it.
  - Add these to `TreesApi`, to `TREES_API_METHODS`, and to the returned object:

```ts
  getPerson(treeId: string, personId: string): Promise<Result<PersonView>>;
  createPerson(treeId: string, input: CreatePersonInput): Promise<Result<{ id: string }>>;
  updatePerson(treeId: string, personId: string, input: UpdatePersonInput): Promise<Result<{ version: number }>>;
  addRelative(treeId: string, personId: string, input: AddRelativeInput): Promise<Result<void>>;
  updateUnion(treeId: string, unionId: string, input: UpdateUnionInput): Promise<Result<void>>;
  deleteUnion(treeId: string, unionId: string): Promise<Result<{ batchId: string }>>;
  updateParentChild(treeId: string, linkId: string, input: { kind: ChildKind }): Promise<Result<void>>;
  deleteParentChild(treeId: string, linkId: string): Promise<Result<{ batchId: string }>>;
  addResidence(treeId: string, personId: string, input: ResidenceInput): Promise<Result<{ id: string }>>;
  updateResidence(treeId: string, residenceId: string, input: ResidenceInput): Promise<Result<void>>;
  deleteResidence(treeId: string, residenceId: string): Promise<Result<void>>;
  previewDelete(treeId: string, personId: string, mode: DeleteMode): Promise<Result<DeletePreview>>;
  deletePerson(treeId: string, personId: string, mode: DeleteMode): Promise<Result<{ batchId: string }>>;
  personHistory(treeId: string, personId: string): Promise<Result<HistoryEntry[]>>;
  listTrash(treeId: string): Promise<Result<TrashBatch[]>>;
  getTrashBatch(treeId: string, batchId: string): Promise<Result<TrashBatchDetail>>;
  restoreBatch(treeId: string, batchId: string): Promise<Result<void>>;
  eraseBatch(treeId: string, batchId: string): Promise<Result<void>>;
```

```ts
    // inside createTreesApi, after the existing methods:
    getPerson: (id, p) =>
      request('GET', `${t(id)}/persons/${enc(p)}`, undefined, personViewSchema, 'session', {
        NOT_FOUND: MESSAGES.personNotFound,
      }),
    createPerson: (id, input) =>
      request('POST', `${t(id)}/persons`, input, createdIdSchema, 'session', {
        CONFLICT: MESSAGES.alreadyRelated,
      }),
    updatePerson: (id, p, input) =>
      request('PATCH', `${t(id)}/persons/${enc(p)}`, input, updatedPersonSchema, 'session', {
        CONFLICT: MESSAGES.staleEdit,
      }),
    addRelative: (id, p, input) =>
      request('POST', `${t(id)}/persons/${enc(p)}/relatives`, input, undefined, 'session', {
        CONFLICT: MESSAGES.alreadyRelated,
      }),
    updateUnion: (id, u, input) => request('PATCH', `${t(id)}/unions/${enc(u)}`, input),
    deleteUnion: (id, u) =>
      request('POST', `${t(id)}/unions/${enc(u)}/delete`, {}, batchIdSchema, 'session', {
        FORBIDDEN: MESSAGES.deleteNotAllowed,
      }),
    updateParentChild: (id, l, input) => request('PATCH', `${t(id)}/parent-child/${enc(l)}`, input),
    deleteParentChild: (id, l) =>
      request('POST', `${t(id)}/parent-child/${enc(l)}/delete`, {}, batchIdSchema, 'session', {
        FORBIDDEN: MESSAGES.deleteNotAllowed,
      }),
    addResidence: (id, p, input) =>
      request('POST', `${t(id)}/persons/${enc(p)}/residences`, input, createdIdSchema),
    updateResidence: (id, r, input) => request('PATCH', `${t(id)}/residences/${enc(r)}`, input),
    deleteResidence: (id, r) => request('DELETE', `${t(id)}/residences/${enc(r)}`),
    previewDelete: (id, p, mode) =>
      request('POST', `${t(id)}/persons/${enc(p)}/delete-preview`, { mode }, deletePreviewSchema),
    deletePerson: (id, p, mode) =>
      request('POST', `${t(id)}/persons/${enc(p)}/delete`, { mode }, batchIdSchema, 'session', {
        FORBIDDEN: MESSAGES.deleteNotAllowed,
      }),
    personHistory: (id, p) =>
      map(request('GET', `${t(id)}/persons/${enc(p)}/history`, undefined, historySchema), (d) => d.entries),
    listTrash: (id) =>
      map(
        request('GET', `${t(id)}/trash`, undefined, trashListSchema, 'session', {
          FORBIDDEN: MESSAGES.trashOwnerOnly,
        }),
        (d) => d.batches,
      ),
    getTrashBatch: (id, b) =>
      request('GET', `${t(id)}/trash/${enc(b)}`, undefined, trashBatchDetailSchema, 'session', {
        FORBIDDEN: MESSAGES.trashOwnerOnly,
        NOT_FOUND: MESSAGES.itemGone,
      }),
    restoreBatch: (id, b) =>
      request('POST', `${t(id)}/trash/${enc(b)}/restore`, {}, undefined, 'session', {
        CONFLICT: MESSAGES.restoreConflict,
        NOT_FOUND: MESSAGES.itemGone,
      }),
    eraseBatch: (id, b) =>
      request('DELETE', `${t(id)}/trash/${enc(b)}`, undefined, undefined, 'session', {
        NOT_FOUND: MESSAGES.itemGone,
      }),
```

  **`test/fake-trees.ts`:**
  - **`FakeTree` gains:**
    - `people: Map<string, PersonView>`
    - `history: Map<string, HistoryEntry[]>`
    - `previews: Map<string, DeletePreview>`
    - `trash: TrashBatchDetail[]`
    - `trashPeople: Map<string, PersonSummary[]>` (batch id → the people the batch removed, so restore can put them back)
  - **`addTree`:** initialises these as empty.
  - **New helper `fakePersonView(summary, partial?)`:** a `PersonView` for a summary, with version 1, everything else null or empty, and every capability true.
  - **Methods**, enough for the page tests:
    - **`getPerson`:** returns `people.get(id)`, or a `fakePersonView` built from the summary in `persons`. An unknown id gives `NOT_FOUND` with `MESSAGES.personNotFound`.
    - **`createPerson`:** adds a summary and a view, and returns a new id. `attach` is only recorded in `calls`.
    - **`updatePerson`:**
      - A version that doesn't match the view gives `CONFLICT` with `staleEdit`.
      - Without `capabilities.edit`: `FORBIDDEN`.
      - Otherwise it merges the fields into the view and the summary, bumps the version and returns it.
    - **`addRelative`, `updateUnion`, `updateParentChild`:** record the call and return ok.
    - **`deleteUnion`, `deleteParentChild`:** remove the relation from every view, and push a Trash entry with `mode: 'relation'`.
    - **Residences:** they mutate `view.residences`.
    - **`previewDelete`:** returns `previews.get(personId)`. The default is `{ mode, people: [summary], unions: 0, links: 0, outsideScope: 0, blockedByRoot: personId === rootPersonId, allowed: !blockedByRoot }`.
    - **`deletePerson`:** refuses (`VALIDATION`) when blocked by the root. Otherwise it removes the preview's people from `persons`, saves them in `trashPeople`, pushes a Trash entry, and returns `{ batchId }`.
    - **`personHistory`:** returns `history.get(personId) ?? []`.
    - **`listTrash`, `getTrashBatch`:** `FORBIDDEN` with `trashOwnerOnly` unless `capabilities.manageTree`.
    - **`restoreBatch`:** removes the entry and puts its `trashPeople` back into `persons`.
    - **`eraseBatch`:** removes the entry.
  - **Calls:** every method goes through `enter()`, so `failNext`, `hold` and `callsTo` work.

- [ ] **Step 4: Run** `pnpm --filter @family-tree/web test` and `pnpm typecheck`. Both pass. Existing page tests are unaffected.

- [ ] **Step 5: Commit** `feat(web): TreesApi methods for people, relations, residences, deletion and Trash`

---

## Task 14: Web — fuzzy date field, formatting and labels

**Files:**
- Create: `apps/web/src/components/FuzzyDateField.tsx`, `apps/web/src/components/FuzzyDateField.test.tsx`, `apps/web/src/components/Tabs.tsx`
- Modify: `apps/web/src/trees/format.ts`, `apps/web/src/trees/format.test.ts`

- [ ] **Step 1: Write the failing tests.**

  **`format.test.ts`:**

```ts
it('formats fuzzy dates in English', () => {
  expect(formatFuzzyDate(null)).toBe('');
  expect(formatFuzzyDate({ qualifier: 'exact', date1: '1950' })).toBe('1950');
  expect(formatFuzzyDate({ qualifier: 'about', date1: '1950-03' })).toBe('about March 1950');
  expect(formatFuzzyDate({ qualifier: 'exact', date1: '1950-03-07' })).toBe('7 March 1950');
  expect(formatFuzzyDate({ qualifier: 'before', date1: '0950' })).toBe('before 950');
  expect(formatFuzzyDate({ qualifier: 'between', date1: '1950', date2: '1955' })).toBe(
    'between 1950 and 1955',
  );
});
```

  **`FuzzyDateField.test.tsx`:**
  1. **Shape:** it renders a group labelled by its `label` (for example "Birth date"), with a "How certain" select (Exact, About, Before, After, Between) and a date input.
  2. **Between:** choosing "Between" shows a second input, "and".
  3. **`fromDraft`:**
     - A blank `date1` gives `null`.
     - `{qualifier:'between', date1:'1950', date2:'1955'}` comes out unchanged.
     - The `exact` qualifier drops `date2`.
  4. **Errors:** the `error` prop is rendered and linked with `aria-describedby`.

- [ ] **Step 2: Run them; they fail.**

- [ ] **Step 3: Implement.**

  **`trees/format.ts`:** add these:

```ts
import type { FuzzyDate } from '@family-tree/shared';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function partial(d: string): string {
  const [y, m, day] = d.split('-');
  const year = String(Number(y));
  if (!m) return year;
  const month = MONTHS[Number(m) - 1];
  return day ? `${Number(day)} ${month} ${year}` : `${month} ${year}`;
}

/** "about March 1950", "between 1950 and 1955"; '' for no date. */
export function formatFuzzyDate(d: FuzzyDate | null): string {
  if (!d) return '';
  const one = partial(d.date1);
  switch (d.qualifier) {
    case 'exact':
      return one;
    case 'about':
    case 'before':
    case 'after':
      return `${d.qualifier} ${one}`;
    case 'between':
      return `between ${one} and ${partial(d.date2 ?? d.date1)}`;
  }
}

export const SEX_LABEL = { female: 'Female', male: 'Male', other: 'Other', unknown: 'Not given' } as const;
export const UNION_TYPE_LABEL = { marriage: 'Marriage', partnership: 'Partnership' } as const;
export const UNION_STATUS_LABEL = {
  married: 'Married', partners: 'Partners', divorced: 'Divorced', separated: 'Separated', widowed: 'Widowed',
} as const;
export const CHILD_KIND_LABEL = { biological: 'Biological', adoptive: 'Adopted', step: 'Step', foster: 'Foster' } as const;
export const QUALIFIER_LABEL = { exact: 'Exact', about: 'About', before: 'Before', after: 'After', between: 'Between' } as const;
/** Field names in History. */
export const FIELD_LABEL: Record<string, string> = {
  givenName: 'First name', middleName: 'Middle name', surname: 'Last name', maidenName: 'Maiden name',
  nickname: 'Nickname', sex: 'Sex', birthDate: 'Birth date', birthPlace: 'Birth place',
  deathDate: 'Death date', deathPlace: 'Death place', causeOfDeath: 'Cause of death', isLiving: 'Living',
  occupation: 'Occupation', education: 'Education', biography: 'Biography', notes: 'Notes',
};
/** History entry titles; keyed by AuditAction (the Record type makes a missing one a compile error). */
export const ACTION_LABEL: Record<AuditAction, string> = {
  'tree.create': 'Tree started', 'tree.rename': 'Tree renamed', 'tree.changeRoot': 'Starting person changed',
  'tree.delete': 'Tree deleted', 'tree.restore': 'Tree restored',
  'person.create': 'Added', 'person.update': 'Details changed', 'person.delete': 'Moved to Trash',
  'union.create': 'Relationship added', 'union.update': 'Relationship changed', 'union.delete': 'Relationship removed',
  'link.create': 'Parent and child linked', 'link.update': 'Parent and child link changed', 'link.delete': 'Parent and child link removed',
  'residence.create': 'Place of residence added', 'residence.update': 'Place of residence changed', 'residence.delete': 'Place of residence removed',
  'trash.restore': 'Restored from Trash', 'trash.erase': 'Erased permanently',
  'member.join': 'Joined the tree', 'member.role': 'Role changed', 'member.remove': 'Removed from the tree',
  'ownership.transfer': 'Ownership transferred', 'steward.grant': 'Made a branch steward',
  'steward.revoke': 'Branch stewardship revoked', 'invite.create': 'Invite created', 'invite.revoke': 'Invite revoked',
};
/** A History value as text: dates formatted, booleans as Yes/No, empty as "(empty)". */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(empty)';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object' && v !== null && 'qualifier' in v) return formatFuzzyDate(v as FuzzyDate);
  return String(v);
}
```

  **`components/FuzzyDateField.tsx`:**

```tsx
import { DATE_QUALIFIERS, type DateQualifier, type FuzzyDate } from '@family-tree/shared';
import { useId } from 'react';
import { QUALIFIER_LABEL } from '../trees/format';

export interface FuzzyDraft {
  qualifier: DateQualifier;
  date1: string;
  date2: string;
}
export const toDraft = (d: FuzzyDate | null): FuzzyDraft =>
  d ? { qualifier: d.qualifier, date1: d.date1, date2: d.date2 ?? '' } : { qualifier: 'exact', date1: '', date2: '' };
/** The value to validate with fuzzyDateSchema: null when no date is typed. */
export function fromDraft(d: FuzzyDraft): unknown {
  const date1 = d.date1.trim();
  if (date1 === '') return null;
  return d.qualifier === 'between'
    ? { qualifier: d.qualifier, date1, date2: d.date2.trim() }
    : { qualifier: d.qualifier, date1 };
}

export function FuzzyDateField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: FuzzyDraft;
  onChange: (v: FuzzyDraft) => void;
  error?: string;
}) {
  const id = useId();
  const between = value.qualifier === 'between';
  return (
    <fieldset className="field fuzzy-date" aria-describedby={error ? `${id}-error` : `${id}-hint`}>
      <legend>{label}</legend>
      <p id={`${id}-hint`} className="hint">Year, year and month, or full date: 1950, 1950-03 or 1950-03-07</p>
      <label htmlFor={`${id}-q`}>How certain</label>
      <select
        id={`${id}-q`}
        value={value.qualifier}
        onChange={(e) => onChange({ ...value, qualifier: e.target.value as DateQualifier })}
      >
        {DATE_QUALIFIERS.map((q) => (
          <option key={q} value={q}>{QUALIFIER_LABEL[q]}</option>
        ))}
      </select>
      <label htmlFor={`${id}-1`}>{between ? 'From' : 'Date'}</label>
      <input id={`${id}-1`} inputMode="numeric" value={value.date1} onChange={(e) => onChange({ ...value, date1: e.target.value })} />
      {between && (
        <>
          <label htmlFor={`${id}-2`}>and</label>
          <input id={`${id}-2`} inputMode="numeric" value={value.date2} onChange={(e) => onChange({ ...value, date2: e.target.value })} />
        </>
      )}
      {error && <p id={`${id}-error`} className="field-error">{error}</p>}
    </fieldset>
  );
}
```

  **`components/Tabs.tsx`:**
  - `Tabs({ tabs: {id, label}[], current, onChange })` renders a `role="tablist"` of buttons with `role="tab"`, `aria-selected` and `aria-controls={`panel-${id}`}`.
  - Left and right arrow keys move between tabs.
  - The page renders the active panel itself, as `<div role="tabpanel" id={`panel-${id}`} aria-labelledby=…>`.
  - **Styles** (`styles.css`): `.tabs` is a flex row with an underline on `[aria-selected=true]`, and `.fuzzy-date` is an inline grid.

- [ ] **Step 4: Run the tests; they pass.** **Step 5: Commit** `feat(web): fuzzy date field, date and label formatting, tabs`

---

## Task 15: Web — tree page with people list and person panel (Info, Places, Photos, History)

**Files:**
- Create: `apps/web/src/pages/tree/PeopleList.tsx`, `PersonPanel.tsx`, `PersonPanel.test.tsx`, `InfoTab.tsx`, `PlacesTab.tsx`, `HistoryTab.tsx`
- Modify: `apps/web/src/pages/TreePage.tsx`, `apps/web/src/pages/TreePage.test.tsx`, `apps/web/src/routes.tsx`, `apps/web/src/styles.css`

**Routes** (all inside `RequireAuth`, all rendering `<TreePage />`):
- `/trees/:treeId`
- `/trees/:treeId/people/new` (the add form, Task 16)
- `/trees/:treeId/people/:personId`

`TreePage` uses `useParams().personId` and `useMatch('/trees/:treeId/people/new')`.

**Behaviour:**
- **Layout:**
  - `Page wide` keeps the header lines from phase 3: role, steward notice, starting person.
  - Below them is a two-column `.tree-layout`: the people list on the left (about 280px), the panel on the right. Under 720px it's one column, with the panel first when a person is selected.
  - Tree settings stay at the bottom, unchanged.
- **`PeopleList`:**
  - It shows "People (N)", a short note "The interactive family tree arrives in a later version.", and an `<ul>` of `Link`s to `/trees/:treeId/people/:id`.
  - Each item shows the name, the years, and "(you)".
  - The selected item has `aria-current="page"`.
  - Above the list: an **Add a person** link to `people/new`, shown when `capabilities.editAnywhere || me.steward.active`.
  - Next to Members, the owner (`capabilities.manageTree`) gets a **Trash** link to `/trees/:treeId/trash`.
- **`PersonPanel({ treeId, personId, persons, onChanged })`:**
  - It loads `getPerson`. While loading it shows "Loading…". An error shows its message, with a **Back to the list** link.
  - **Heading** (`h2`): the full name and the years. Under it: the nickname in quotes, and "Maiden name: …" when set.
  - **Tabs:** Info, Places, Photos, Relations, History. The tab lives in `?tab=` (`useSearchParams`), and the default is `info`.
  - **Reloading:** `onChanged()` reloads `listPersons` in `TreePage`, so names update in the list. The panel reloads its own view after every successful save.
- **`InfoTab`:**
  - **Viewing:** a `<dl>` of the filled fields, in this order:
    - Name parts
    - Sex
    - Born (formatted date)
    - Died (formatted date) or "Living"
    - Cause of death
    - Occupation
    - Education
    - Biography and notes, as `<p className="prose">` with `white-space: pre-line`, never HTML
    - "Added by …"
  - **Edit:** when `capabilities.edit`, an **Edit details** button opens a form with:
    - text fields for first, middle, last, maiden and nickname
    - a sex select
    - `FuzzyDateField`s for Born and Died
    - a **Living** checkbox
    - Cause of death, Occupation and Education
    - textareas for Biography and Notes
  - **Validating:**
    1. Build the change with `fromDraft` for the dates.
    2. Validate with `validate(updatePersonSchema, { version, ...fields })`.
    3. Then check `personConsistencyErrors(merged)` on the merged record.
    4. Field errors appear under each field.
  - **Saving:** **Save** calls `updatePerson` with the edited fields and `version`.
    - **Success:** shows "Saved" (`role="status"`), closes the form, reloads, and calls `onChanged`.
    - **`CONFLICT`:** shows `MESSAGES.staleEdit` with a **Load the latest version** button, which reloads the view and resets the form.
    - **Other errors:** their message.
  - **Cancel** closes the form without a call.
  - The **Delete this person** section comes in Task 17; leave a slot for it at the bottom.
- **`PlacesTab`:**
  - **Birth and death places:** the birth place and death place, with an **Edit places** form when `capabilities.edit`. It saves through `updatePerson({ version, birthPlace, deathPlace })`, with the same conflict handling as Info.
  - **"Places lived":** a list of residences, each shown as "place, from–to" using `formatFuzzyDate`. Each row has **Edit** (an inline form: place plus two `FuzzyDateField`s) and **Remove** (a `ConfirmButton` "Remove", then "Yes, remove").
  - **Adding:** an **Add a place** form. It validates with `residenceInputSchema`.
  - **Viewers** see the lists only.
- **Photos tab:** "Photos arrive in a later version."
- **`HistoryTab`:**
  - It loads `personHistory`.
  - Each entry: `ACTION_LABEL[action]`, the date (`toLocaleString()`) and "by <name>" ("by a former member" when null).
  - For `changes`, a nested list "<FIELD_LABEL>: <formatValue(before)> → <formatValue(after)>".
  - Empty: "No changes recorded yet."

**Tests** (`PersonPanel.test.tsx`, using `renderAt('/trees/<id>/people/<pid>', { auth, trees })` with a `fakePersonView` seeded with details):

- [ ] **Step 1: Write the failing tests:**
  1. **Info and tabs:** the panel shows the name, "about 1815" for the birth date, and the biography with line breaks preserved. Assert the text and the `prose` class, and that no HTML is injected: a biography of `<b>x</b>` renders as literal text.
  2. **Editing:** change the surname and save. `updatePerson` is called with `version: 1` and the new surname, "Saved" appears, and the list item in the left column shows the new name.
  3. **Validation:** a death date before the birth shows "Death can’t be before birth" and makes no call. Ticking Living while a death date is set shows the living error.
  4. **Conflict:** with `trees.failNext('updatePerson', { code: 'CONFLICT', message: MESSAGES.staleEdit })`, the message shows. **Load the latest version** calls `getPerson` again.
  5. **Viewer:** a view with `capabilities.edit: false` shows no Edit buttons on Info or Places.
  6. **Places:** add a residence (`addResidence` called, and the row appears), edit it, and remove it after a two-step confirm.
  7. **History:** entries render with action labels and field changes, for example "Last name: King → Lovelace".
  8. **Tab in the URL:** opening `/trees/t/people/p?tab=history` starts on History, and clicking Places updates the URL.
  9. **List:** the `TreePage.test.tsx` additions:
     - List items link to `/trees/<id>/people/<pid>`.
     - The selected one has `aria-current`.
     - "Add a person" is hidden for a viewer.
     - "Trash" appears only for the owner.
     - The phase 3 tests still pass. Update the selectors only where the markup changed.

- [ ] **Step 2: Implement until the tests pass.** Run `pnpm --filter @family-tree/web test`, `pnpm lint` and `pnpm typecheck`.

- [ ] **Step 3: Commit** `feat(web): people list with person panel: info, places, photos placeholder, history`

---

## Task 16: Web — Relations tab, adding relatives and adding a person

**Files:**
- Create: `apps/web/src/pages/tree/RelationsTab.tsx`, `AddRelativeForm.tsx`, `AddRelativeForm.test.tsx`, `AddPersonForm.tsx`, `AddPersonForm.test.tsx`
- Modify: `apps/web/src/pages/tree/PersonPanel.tsx`, `apps/web/src/pages/TreePage.tsx`

**Behaviour:**
- **`RelationsTab`** (data from `view.relations`):
  - **Parents:** one block per parent union, "Parents (<kind label>)", with the parents as links to their panels. An empty slot reads "Unknown parent".
  - **Partners and children:** one block per union.
    - The heading: "<Partner name or Unknown partner>: <type>, <status>", plus the dates when set ("from 1970 to 1985").
    - Under it, the children as links with their kind when it isn't biological ("Mia (Adopted)").
  - **Siblings:** links. When the person has more than one parent union, each sibling is grouped under the parents they share.
  - **Edit controls** (when `capabilities.edit`):
    - Per union, **Edit relationship** opens an inline form: type select, status select, and Start/End `FuzzyDateField`s. It calls `updateUnion` with the changed fields.
    - Per child link and per parent link, a kind `<select>` calls `updateParentChild` on change.
  - **Remove controls** (when `capabilities.delete`):
    - Per union: **Remove relationship** (`ConfirmButton`: "Remove relationship", then "Yes, move to Trash") calls `deleteUnion`.
    - Per link: **Remove link** calls `deleteParentChild`.
    - Afterwards: reload, call `onChanged`, and show "Moved to Trash."
    - `FORBIDDEN` shows `MESSAGES.deleteNotAllowed`. The server decides in the end: these buttons only reflect whether the user may delete anything at all.
  - **Add buttons** (when `capabilities.addRelative`): **Add parent**, **Add partner**, **Add child** and **Add sibling**. Each opens an `AddRelativeForm` with that role.
- **`AddRelativeForm({ treeId, subject: PersonView, as, persons, onDone })`:**
  - **Choice:** a radio pair, **A new person** (default) / **Someone already in the tree**.
  - **New person:** quick fields, the same as tree creation:
    - first name (required)
    - last name (defaults to the subject's surname for `child` and `sibling`)
    - sex
    - birth year
  - **Existing person:** a `<select>` of `persons`, excluding the subject and the people already in this role.
  - **Role-specific fields:**
    - **`child`:** "Other parent" `<select>`, with one option per subject union (`with <partner name>` / `with an unknown partner`) plus **Unknown other parent**, which sends no `unionId`. It defaults to the only union when there is exactly one with a partner. Plus a **Kind** select.
    - **`parent`:** when the subject has a parent union with an empty slot, the option "Join <existing parent>" is preselected. Plus **Kind**.
    - **`sibling`:** "Shared parents" select when there are several parent unions. Plus **Kind**.
    - **`partner`:** type and status selects (Marriage/Married by default).
  - **Submit:**
    - New person: `createPerson({ person: { givenName, surname, sex, birthDate }, attach: { to: subject.id, as, unionId?, kind, union? } })`. The `birthDate` is `{qualifier:'exact', date1: YYYY}` when a year is typed.
    - Existing person: `addRelative(subject.id, { personId, as, unionId?, kind, union? })`.
    - Validation: `validateDeep(createPersonSchema, …)` for the new-person path.
  - **Results:**
    - Success calls `onDone()`: the panel reloads and the list refreshes.
    - `CONFLICT` shows `MESSAGES.alreadyRelated`.
    - `VALIDATION` shows `MESSAGES.checkDetails` at the top. The server's field messages are not shown (code→message rule). The common cases ("Add a parent first", the cycle rule) are prevented in the UI where cheap: **Add sibling** is disabled with the hint "Add a parent first" when `relations.parents` is empty.
  - **Cancel** closes the form.
- **`AddPersonForm`** (the `/trees/:treeId/people/new` route, rendered in the panel column):
  - Titled "Add a person". It has the same quick fields, plus an optional **Connect to** person `<select>`. When one is chosen, an **as their** select appears (parent / child / partner / sibling).
  - When `capabilities.editAnywhere` is false (a steward-only user), **Connect to** is required. The hint says: "Choose someone in your branch to connect them to."
  - **Submit:**
    - It calls `createPerson`, with `attach` when a connection was chosen and no `unionId`, so the server picks the defaults (decision 11).
    - On success it navigates to `/trees/:treeId/people/<newId>` and refreshes the list.
    - A hint under the heading: "You can add more details after saving." Phase 5 adds the duplicate check here.

**Tests:**

- [ ] **Step 1: Write the failing tests.**

  **`AddRelativeForm.test.tsx`:**
  1. **New child:** adding a new child to a subject with one union with Pat preselects "with Pat". Submit calls `createPerson` with `attach: { to, as: 'child', unionId: <u>, kind: 'biological' }`.
  2. **Unknown other parent:** choosing it sends no `unionId`.
  3. **Existing partner:** "Someone already in the tree" with partner role calls `addRelative(subject, { personId, as: 'partner', kind: 'biological', union: { type: 'marriage', status: 'married' } })`.
  4. **Conflict:** `CONFLICT` from `addRelative` shows "They are already related this way".
  5. **Sibling without parents:** the **Add sibling** button is disabled, with the hint.
  6. **Validation:** an empty first name shows the field error and makes no call.

  **`AddPersonForm.test.tsx`:**
  1. **Unattached:** submitting "Ada" with no connection calls `createPerson({ person: { givenName: 'Ada', sex: 'unknown' } })` and lands on the new person's panel.
  2. **Connected:** with "Connect to: Robert, as their child", it sends `attach: { to: robert, as: 'child', kind: 'biological' }`.
  3. **Steward:** for a steward without `editAnywhere`, submitting without a connection shows the hint error and makes no call.
  4. **Birth year:** 1990 is sent as `birthDate: { qualifier: 'exact', date1: '1990' }`.

  **`PersonPanel.test.tsx`, Relations:**
  1. Parents, partners with their children, and siblings render with links.
  2. Editing a union's status calls `updateUnion` with `{ status: 'divorced' }`.
  3. Changing a child's kind calls `updateParentChild`.
  4. Removing a relationship needs two clicks and calls `deleteUnion`.
  5. A viewer sees no edit, remove or add controls.

- [ ] **Step 2: Implement until the tests pass.** Run the web tests, lint and typecheck.

- [ ] **Step 3: Commit** `feat(web): relations tab, add parent/partner/child/sibling, add a person`

---

## Task 17: Web — delete with preview, and the Trash page

**Files:**
- Create: `apps/web/src/pages/tree/DeletePerson.tsx`, `DeletePerson.test.tsx`, `apps/web/src/pages/TrashPage.tsx`, `apps/web/src/pages/TrashPage.test.tsx`
- Modify: `apps/web/src/pages/tree/InfoTab.tsx`, `apps/web/src/routes.tsx`

**Behaviour:**
- **`DeletePerson`** sits at the bottom of the Info tab, when `capabilities.delete`, under a heading "Delete this person".
  - **Opening:** a **Delete…** button reveals the section. A radio group: **Just this person** (default) / **This person and their descendants**. Each change of mode calls `previewDelete(personId, mode)` and shows "Loading preview…" meanwhile.
  - **The preview:**
    - "This moves N people to the Trash:", then a list of names and years (the first 20, then "and N more").
    - Then "N relationships end and N parent–child links are removed." Leave out the parts that are 0.
    - Under it, the fixed text "Relatives stay in the tree. Anyone no longer connected to the starting person will show as disconnected." for `person` mode.
  - **Blocked previews:**
    - `blockedByRoot`: "This includes the tree’s starting person. Choose a new starting person in Tree settings first." with no confirm button.
    - `outsideScope > 0`: "This includes N people outside your branch. Ask the owner to delete it." (spec §4 wording) with no confirm button.
    - Otherwise not `allowed`: `MESSAGES.forbidden`.
  - **Confirming:**
    - When allowed: a `ConfirmButton` "Move to Trash", then "Yes, move to Trash" (danger), calling `deletePerson(personId, mode)`.
    - On success it navigates to `/trees/:treeId` with the router state `{ notice: 'Moved to Trash. The owner can restore it from the Trash.' }`. TreePage shows that once in `role="status"` and refreshes the list.
    - Errors show their message: `FORBIDDEN` → `deleteNotAllowed`.
  - **Cancel** hides the section.
- **`TrashPage`** (`/trees/:treeId/trash`, `RequireAuth`, `Page wide`, titled "Trash"):
  - It loads `getTree` (for the name and the back link) and `listTrash` in parallel.
  - `FORBIDDEN` shows `MESSAGES.trashOwnerOnly` and a link back to the tree. `NOT_FOUND` shows `MESSAGES.notFound`.
  - **Intro:** "Deleted people and relationships stay here until you restore or erase them. Only you, the owner, can see this page."
  - **Empty:** "The Trash is empty."
  - **Each batch** is a list item:
    - **Title, by root:**
      - person: "<name>" ("<name> and their descendants" for `descendants` mode)
      - union: "Relationship between A and B" (or "…of A" with one name)
      - link: "<child> as child of A and B" ("Someone" when the child was erased)
    - **Meta:** "Deleted <toLocaleString()> by <name>" ("by a former member" when null), plus counts: "N people · N relationships · N links", leaving out zeros.
    - **Show details** toggles a detail block loaded with `getTrashBatch`: the list of people (name and years), relationships ("A and B"), links ("C, child of A and B"), and "N partner slots to put back" when `slots > 0`.
    - **Restore** (a plain button, because it isn't destructive) calls `restoreBatch`. On success the row disappears and "Restored." shows. `CONFLICT` shows `MESSAGES.restoreConflict` on that row.
    - **Erase permanently** (`ConfirmButton`, danger: "Erase permanently", then "Yes, erase for good") calls `eraseBatch`. On success the row disappears and "Erased." shows.
  - **Back link:** "Back to <tree name>".

**Tests:**

- [ ] **Step 1: Write the failing tests.**

  **`DeletePerson.test.tsx`:**
  1. **Default preview:** opening Delete loads a `person`-mode preview and lists the person.
  2. **Mode switch:** switching to descendants calls `previewDelete` with `'descendants'` and shows the bigger list (seed `trees.trees.get(id).previews`).
  3. **Outside scope:** a preview with `outsideScope: 2, allowed: false` shows "This includes 2 people outside your branch. Ask the owner to delete it." and no Move to Trash button.
  4. **Root:** a preview with `blockedByRoot` shows the starting-person text and no button.
  5. **Confirm:** confirming calls `deletePerson`, lands on the tree page with the notice, and the person is no longer in the list.
  6. **Without the capability:** no Delete section.

  **`TrashPage.test.tsx`:**
  1. **Labels:** the batches list with the right labels for person, descendants, union and link batches, and with the counts.
  2. **Details:** Show details loads and shows the people.
  3. **Restore:** removes the row and shows "Restored.". The restored person is back in `trees.trees.get(id).persons`.
  4. **Restore conflict:** a `CONFLICT` shows the restore-conflict message, and the row stays.
  5. **Erase:** takes two clicks and removes the row.
  6. **Non-owner:** a non-owner (`manageTree: false`) sees "Only the tree owner can open the Trash".
  7. **Empty:** the empty state.

- [ ] **Step 2: Implement until the tests pass.** Add the route `/trees/:treeId/trash` before `/trees/:treeId` in `routes.tsx` (react-router ranks static segments first anyway).

- [ ] **Step 3: Run all web tests, lint and typecheck.** **Commit** `feat(web): delete person with preview, Trash page with restore and erase`

---

## Task 18: Verification, docs, browser walk-through, manual checklist

- [ ] **Step 1: README.**
  - **Section "People and Trash (dev)":**
    - Open a tree to see the people list. Click someone to open their panel (Info, Places, Photos, Relations, History).
    - Add relatives from the Relations tab, or **Add a person**.
    - Deleting moves to the Trash, with a preview. Only the owner can restore or erase.
    - Trees deleted more than 30 days ago are purged hourly by the API (`TREE_PURGE_INTERVAL_MINUTES`, where 0 turns it off), or at once with `pnpm purge-trees`.
  - **"Known limitations":**
    - Remove "no person editing yet (phase 4)".
    - Add:
      - no duplicate check when adding people, and no canvas (phase 5)
      - no photos (phase 6)
      - disconnected people are not listed separately yet (phase 5)
- [ ] **Step 2: Full checks:**
  - `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm build`
  - Run gitleaks as CI does: `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.24.3 detect --source /repo --no-banner`. It must report no leaks.
  - Record the test counts.
- [ ] **Step 3: Rebuild the dev stack:** `pnpm dev` (migration 0003 runs at API start). The API log shows "Server listening", and **no** "tree purge failed" line.
- [ ] **Step 4: Browser walk-through** (the controller does this, not a subagent), with Claude-in-Chrome on http://localhost:5173, and two local test accounts generated in the scratchpad (`scratchpad/totp.mjs` for 2FA codes):
  1. **Owner setup:** the owner (with 2FA) runs `pnpm seed <owner email>` and opens "Sample family (seed)". There are 10 people in the list.
  2. **Info edits:**
     - Click Robert: the panel shows Info.
     - Edit the occupation and the birth date (About 1925), and save: "Saved".
     - History shows "Details changed" with both fields.
  3. **Places:** add a residence ("Leeds", after 1950). It's listed. Edit it, then remove it with the two-step confirm.
  4. **Relations:**
     - Robert's Relations tab shows his partner and children.
     - **Add child**, as a new person "Test Child" with the other parent Margaret. The new person appears in the list and under the union.
     - **Add parent** on Test Child shows the existing union (no new parents are created).
  5. **Stale edit:** open the same person in two tabs and edit in both. The second save shows the "Someone else changed this person…" message, and **Load the latest version** recovers.
  6. **Delete:**
     - Delete "Test Child": the preview lists one person, then confirm. The notice shows and the person is gone from the list.
     - Delete David with descendants: the preview lists his descendants (and Zoe-like partners, if the seed has them). Cancel.
  7. **Trash:**
     - The owner opens Trash: one batch, "Test Child". Show details, then Restore: Test Child is back in the list.
     - Delete again, then Erase permanently: gone, and not in the Trash.
  8. **Steward:**
     - Invite the second user as an editor steward of Robert (phase 3 flow). As them (with 2FA on):
     - Edit someone in Robert's branch (OK).
     - Delete someone whose partner is outside the branch: the preview says "includes N people outside your branch, ask the owner", and there's no confirm button.
     - The Trash link is not shown, and `/trees/<id>/trash` shows "Only the tree owner can open the Trash".
  9. **Isolation by hand:** with curl and the second user's cookie, `GET /api/v1/trees/<a tree they're not in>/persons/<id>` returns 404.
  10. **Console:** no errors. **Network:** no 500s.

  Chrome autofills the user's real saved login on sign-in and sign-up forms. Clear the fields before typing, never submit the user's real credentials, and never repeat test credentials in chat.
- [ ] **Step 5: Commit** any fixes, then `docs: people, relations, Trash and the purge job in dev`. Hand the user the summary and the manual checklist below, and wait for their result before merging.

**Manual checklist for the author** (about 25 minutes; have your authenticator app and a private window ready):
1. `pnpm dev`. Wait for "Server listening".
2. `pnpm seed <your email>`, then open **Sample family (seed)**.
3. Click **Robert Hale**:
   - On **Info**, change his occupation and birth date ("About", 1925). It says "Saved".
   - **History** lists the change with the old and new values.
4. On **Places**, add "Leeds, after 1950", edit it, then remove it (two clicks).
5. On **Relations**:
   - **Add child**, new person "Test Child", with the other parent Margaret. They appear under Robert and Margaret and in the people list.
   - On Test Child, **Add sibling** links an existing person. A second attempt says "They are already related this way".
6. Open Robert in two tabs, edit in both, and save both. The second says someone else changed him. **Load the latest version** works.
7. On Test Child, **Info → Delete…**:
   - The preview shows one person. **Move to Trash** asks once more, then confirm.
   - You're back on the tree with "Moved to Trash".
8. Try to delete yourself (the starting person): the preview says to choose a new starting person first.
9. **Trash**:
   - Test Child is listed with your name and the time. **Show details**, then **Restore**: they're back.
   - Delete them again, then **Erase permanently** (two clicks): gone for good.
10. **Steward** (private window): invite a second account as an editor steward of Robert, with 2FA on.
    - They can edit Robert's family.
    - Deleting someone married to a person outside Robert's branch is refused with "ask the owner".
    - They don't see Trash.
11. Delete a scratch tree you own. It shows under **Deleted trees**. (The 30-day purge can't be tried by hand quickly; `pnpm test:int` covers it.)
12. `pnpm test && pnpm test:int`. Everything passes.

---

## Carry-forward notes for later phases

- **Phase 5 (graph and canvas):**
  - The graph endpoint authorises with `tree.view`. Per person it returns `canEdit`, `canAddRelative` and `canDelete`, computed exactly as `loadPersonView` does: `can(person.edit)`, `can(person.add, [id])` and `can(person.delete, [id])`. Compute these in one pass, not per card.
  - The card "+" buttons call `createPerson` with `attach` (`as`, `unionId`). "Which union?" for a child of someone with several partners is the `unionId` choice from `AddRelativeForm`. Reuse that form.
  - Clicking a union node edits it with `PATCH /unions/:id` (`updateUnion`).
  - The **duplicate check** goes in front of `createPerson`, in `AddPersonForm` and `AddRelativeForm`. Add `GET /trees/:id/persons/similar?name=&birthYear=`. With `pg_trgm` it belongs in phase 6; in phase 5, use a plain `ILIKE` and year match, or schedule it with the search work.
  - Add `GET /trees/:id/disconnected`, computed from `loadLiveGraph` plus a reachability walk from `rootPersonId`. Add the "Disconnected people" badge.
  - **`sibling_order`:** sibling drag sets `persons.sibling_order`. Add it to `updatePersonSchema`, without a version bump requirement, or use a dedicated route. Decide then.
  - The person panel moves into the canvas side panel / bottom sheet. Keep `PersonPanel` as the component.
  - Replace the people list. Keep it as an accessible fallback list, or remove it.
- **Phase 6 (photos, search, relationships):**
  - **The photos table:** photos belong to a person. A person batch hides them with the person (like residences). Erase must delete their S3 objects **before** the rows go. Use the batch's person ids, before `eraseBatch` deletes persons.
  - **The purge:** `purgeDeletedTrees` returns the purged tree ids. Delete each tree's S3 prefix (for example `trees/<id>/`) after the row is gone. If S3 fails, log it and retry next tick: keep a `purge_pending_objects` list or similar, rather than blocking the DB purge.
  - Photos count towards the per-tree quota. A restored batch brings its photos back into the quota count.
  - Search (`pg_trgm`) covers the name columns, including `maiden_name` and `nickname`. The "branch" filter reuses `branchQuery`.
  - The relationship path uses `loadLiveGraph`, which already treats all four kinds as parent links.
  - Replace the Photos tab placeholder.
- **Phase 7 (export, deploy, E2E):**
  - **GEDCOM:** `FuzzyDate` maps to `ABT`/`BEF`/`AFT`/`BET … AND …`, `residences` to `RESI`, union `status` to `DIV` and similar, and child `kind` to `PEDI` (birth/adopted/foster; step as a note).
  - **E2E:** "steward edits and deletes in their branch → owner previews and restores from Trash" is exactly the Task 18 walk-through; automate it with Playwright.
  - In production the purge job runs inside the API container. With more than one API replica, the advisory lock already keeps runs from overlapping.
  - Consider an owner-only "Tree activity" view over `audit_log` (it's all there), and a retention policy for audit rows.
- **Known trade-offs to revisit:**
  - **Last-write-wins:** unions, links and residences have no `version`.
  - **Erase cascades into other batches:** erasing a batch also removes rows of other batches that point at the erased people. Their restore then brings back less, by design.
  - **Erased union slot:** restore skips a slot whose union was erased elsewhere.
  - **Performance:** `loadLiveGraph` loads the whole tree skeleton per structural write, under a per-tree lock. That's fine for families. Profile it before trees reach 10k people.
