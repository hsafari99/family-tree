# Phase 5 — Graph Endpoint and Family Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The tree page becomes an interactive family canvas. A **focus view** (the default) shows one person and 1–3 family steps around them, and a **full view** shows the whole tree, or one branch when the tree has more than 2,000 people. Layout is automatic (ELK layered, unions as small intermediate nodes, generations in rows). Person cards show initials, name, years and † for the deceased. Cards are keyboard reachable, open the Phase 4 person panel, and carry "+" buttons to add relatives. Every add path runs a **duplicate check** first ("Is this the existing person …?"). The tree page lists **disconnected people**. Siblings can be reordered by dragging (or with buttons), which sets `sibling_order`.

**Architecture:**
- **Pure graph logic in `packages/shared`:**
  - `graph.ts`: the `GET /graph` query and response schemas, limits, and the sibling comparator.
  - `graph-view.ts`: who is in a focus view (`neighbourhood`), who is reachable from the root (`connectedTo`), which unions and links are drawn (`visibleRelations`), and which people have relatives outside the view (`withHiddenRelatives`).
  - `similar.ts`: name normalisation, edit distance and `findSimilar` for the duplicate check (`pg_trgm` replaces the database side in phase 6).
- **API:** a new `graph` route plugin with four routes:
  - `GET /trees/:id/graph`
  - `GET /trees/:id/disconnected`
  - `GET /trees/:id/persons/similar`
  - `POST /trees/:id/unions/:uid/child-order`

  `loadGraphRows()` reads the live skeleton plus display columns in one read-only, repeatable-read transaction. `buildTreeGraph()` picks the people and computes the per-person and per-union `can()` flags in one pass.
- **Web:** a `canvas/` folder:
  - **Pure mapping:** `graph-to-flow.ts` (people and unions to React Flow nodes and edges, with union nodes), `generations.ts` (row per generation) and `elk-graph.ts` (ELK input and output).
  - **Layout engine:** `layout-engine.ts`, ELK in a Web Worker, injectable for tests.
  - **React Flow components:** `PersonNode`, `UnionNode`, `FamilyCanvas`.
  - **Data hook:** `useTreeGraph`.
  - **Tree page:** `TreePage` becomes a toolbar, the canvas and a side panel (a bottom sheet on mobile). It still has the Phase 4 people list, as a fallback under the canvas.

**Tech Stack:** Fastify 5.12.8, Drizzle 0.45.4, Postgres 17, Better Auth 1.7.18, Zod 4.6.7, React 19.3.1, react-router 8.5.1, Vitest 5.1.0, Vite 8.3.6. **New:** `@xyflow/react` **12.12.0** (published 2026-09-24) and `elkjs` **0.12.0** (published 2026-07-17), both in `apps/web` only.

---

## Ground rules (read first)

- **Branch:** create `phase-5-canvas` from `phase-4-people` once Phase 4 is approved and merged. Ask the user if it isn't merged yet; never start on top of uncommitted Phase 4 work.
  - Commit after each task. Never push.
  - Never commit:
    - `.env.production`
    - `graft/`
    - `.ignore`
    - `.claude/settings.local.json`
    - `.vitest/`
- **Dependencies:**
  - Only the two new ones in Task 1, with exact versions. Every package they pull in must have been published at least 14 days before installation; Task 1 checks this.
  - Never add `minimumReleaseAgeExclude`, and never upgrade other dependencies.
  - **Vite stays at 8.3.6** (the dev CPU has no AVX2). Don't add or upgrade any tool with a native binary. `elkjs` is pure JavaScript (GWT output, no dependencies, no install scripts). `@xyflow/react` pulls in d3, zustand and classcat, all pure JavaScript.
- **Running the stack:**
  - The dev stack runs in Docker: `pnpm dev`. Rebuild after Task 1 so the web container installs the new packages.
  - Integration tests need postgres and s3 up: `docker compose up -d --wait postgres s3`.
  - Commands, from the repo root: `pnpm test`, `pnpm test:int`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm build`.
- **Single test files:**
  - API unit: `pnpm --filter @family-tree/api exec vitest run src/path/file.test.ts`
  - API integration: `pnpm --filter @family-tree/api exec vitest run --config vitest.int.config.ts src/path/file.int.test.ts`
  - Web: `pnpm --filter @family-tree/web exec vitest run src/path/file.test.tsx`
  - Shared: `pnpm --filter @family-tree/shared exec vitest run src/file.test.ts`
- **Error handling (unchanged from phase 4):**
  - Only `AppError` messages reach clients.
  - Trees the user can't see return **404**, never 403. Ids of rows in another tree (a focus person, a branch anchor, a union) also return **404**.
  - `FORBIDDEN` is only for a tree the user is a member of.
  - The web UI maps error **codes** to fixed messages and never shows server text.
- **Order inside a route:**
  1. `loadAccess` (outsiders get 404).
  2. Parse the query or body.
  3. Load the target in this tree (404).
  4. `authorize`.
  5. Read or write.
  The child-order write follows the structural-write pattern: transaction, `lockTreeGraph`, then `loadAccess(tx, …)` inside it.
- **Routes:** the new plugin is registered after the rate limiter (see the comment in `app.ts`), with `requireSession` as a preHandler.
- **Browser:** no `window.confirm` / `alert`. Destructive buttons use `ConfirmButton`.
- **User content** is never rendered as HTML. Card text comes from React text nodes only.
- **jsdom and React Flow:**
  - React Flow measures nodes with `ResizeObserver` and reads `DOMMatrixReadOnly`, neither of which jsdom has. Task 10 adds mocks in `src/test/setup.ts`.
  - **Real layout and rendering are not unit-tested in jsdom.** Instead:
    - The graph→nodes/edges and ELK input/output mappings are pure functions with unit tests.
    - The real ELK algorithm runs once in a Node-environment test (`layout.test.ts`, Task 12) to check generations-as-rows and partner adjacency.
    - Component tests use a fake layout engine.
    - The controller's browser walk-through (Task 18) checks the real drawing.
- **Code in this plan** is the intended implementation. If the real code has moved on (names, imports), follow the repo and keep the behaviour. Run Prettier (`pnpm format`) before each commit.

## Decisions taken in this plan (beyond the spec)

1. **Graph query** (`GET /trees/:id/graph`):
   - **Parameters:** `mode=focus|full` (default `focus`), `focus=<personId>` (default: the tree's `root_person_id`, spec §3 "default focus"), `depth=1..3` (default 1) and, in full mode, `branch=<personId>`.
   - **Errors:**
     - A malformed query is `400 VALIDATION`.
     - A focus or branch id that isn't a live person of this tree is `404`.
     - Permission is `tree.view`, so every member can read it.
2. **What "depth" means:** one step is one **close relative**: a parent, child, partner or sibling (spec §6 depth 1). Depth *d* is everyone within *d* steps, breadth first.
   - Depth 2 adds grandparents, grandchildren, aunts and uncles, nieces and nephews, in-laws, step-parents and half-siblings.
   - Siblings are children of the person's own parent unions. A half-sibling through a parent's other union is two steps away.
3. **Which relations are drawn:**
   - A union is drawn when **both** its partners are in the view, or at least one partner **and** at least one of its children are.
   - A parent–child link is drawn when its union is drawn and the child is in the view.
   - A partner who isn't in the view is simply not drawn; the union dot hangs under the visible partner.
   - Each person carries `hiddenRelatives: true` when a close relative is outside the view, and the card shows a "more" marker.
4. **Limits (the performance guard):**
   - **Focus views** return at most `FOCUS_VIEW_MAX = 500` people (nearest first) and set `truncated`.
   - **Full views:** with more than `FULL_VIEW_MAX = 2000` live people (spec §6) and no `branch`, the response is empty with `needsBranch: true`.
   - **Branch views** use the spec §4 branch rule without rule 5 (that rule is about a steward's own additions). They are capped at 2,000 people (`truncated`).
   - **Client:** layout runs in a Web Worker with a 15-second timeout. `onlyRenderVisibleElements` is on from 300 nodes, and the minimap is hidden above 1,500 nodes. Cards simplify by zoom level (full → name and years → dot).
5. **Per-item flags** (one pass, carry-forward from phase 4):
   - Each person has `canAddRelative` = `can(person.add, ends [id])`.
   - Each union has `canEdit` = `can(relation.edit, partners)`.
   - Edit and delete rights for a person still come from `GET /persons/:id` when the panel opens; the canvas doesn't need them.
6. **Consistent snapshot:** `loadGraphRows` reads people, unions and links in one `repeatable read`, `read only` transaction, with the same liveness rules as `loadLiveGraph`.
7. **Disconnected people:**
   - `GET /trees/:id/disconnected` returns `{ persons: PersonSummary[] }`: live people not reachable from `root_person_id` through any union or parent–child link, sorted by surname and then given name.
   - A tree with no root (which shouldn't happen) lists everyone.
   - The web shows a "Disconnected people (N)" toggle in the toolbar only when N > 0 (spec §6).
8. **Duplicate check, phase 5 version:** `GET /trees/:id/persons/similar?givenName=&surname=&birthYear=` returns at most 5 `PersonSummary`. The matching is done in JavaScript over the tree's live people, using `findSimilar` (shared). Phase 6 moves it to `pg_trgm` and keeps the same contract.
   - Names are normalised: Unicode NFKD, accents stripped, lower case, spaces collapsed.
   - Two names are "close" when:
     - they are equal, or
     - one starts with the other (3+ letters), or
     - their edit distance is ≤ 1 (shorter name 4–6 letters) or ≤ 2 (7+ letters).
   - **First name:** it must be close to the candidate's given name or nickname.
   - **Last name** (when one was typed): it must be close to the candidate's surname or maiden name. A candidate with neither passes.
   - **Birth years:** when both are known they must be within 2 years.
   - **Ranking:** an exact first name +2, an exact last name +2, the same year +1, then by name.
9. **Duplicate check in the UI:**
   - **When:** every create path runs it before `createPerson`: `AddRelativeForm` (which the canvas "+" buttons open) and `AddPersonForm`.
   - **The prompt:** "Is this the existing person *Name (years)*?", with a **Yes, use them** button per match and one **No, add a new person** button.
   - **"Yes" in `AddRelativeForm`:** it links the existing person with `addRelative`, using the same role, union and kind.
   - **"Yes" in `AddPersonForm`:** it links them to the chosen "Connect to" person when one was chosen; otherwise it just opens that person.
   - **"No":** it is remembered for the typed name and year, so the next submit creates the person.
   - **A failed check** never blocks adding: the form proceeds to create.
   - **Exclusions:** only the subject person is filtered out. If the match is already related that way, the server's 409 shows "They are already related this way".
10. **URL is the canvas state:**
    - **Path:**
      - `/trees/:id` (nothing selected)
      - `/trees/:id/people/:pid` (person panel)
      - `/trees/:id/people/new`
      - `/trees/:id/unions/:uid` (new: union panel)
    - **Search parameters:** `view=focus|full`, `depth`, `branch`, `focus`, `tab` (phase 4) and `add` (new: which add-relative form to open).
    - **In focus view, the focus is** `focus ?? selected person ?? root`. Clicking a card selects that person, so the view re-centres on them (spec §6).
    - **The union panel** keeps the current focus in `focus=`.
    - **Links inside the panels** keep `view` and `depth`, through `usePersonHref()`.
11. **Union panel:**
    - Clicking a union dot opens `/trees/:id/unions/:uid`, which shows the partners, type, status and dates. Users with `canEdit` get the phase 4 `UnionForm`, moved to its own file.
    - Removing a relationship stays in the person's Relations tab (it needs the delete capability).
12. **Card "+" buttons** (only when `canAddRelative`):
    - The four buttons are parent (top), sibling (left), partner (right) and child (bottom).
    - Each one navigates to the person's panel with `?tab=relations&add=<role>`. The Relations tab opens the phase 4 `AddRelativeForm` for that role, which already asks "which union?" for a child of someone with several partners.
    - Sibling is disabled, with the hint "Add a parent first", when the person has no parents (`hasParents`).
13. **Layout:**
    - **Generations:** `assignGenerations` puts partners in the same row and children one row below their parents. It packs each couple as low as possible (just above its highest child), so a lone parent with no other relatives doesn't float rows above.
    - **ELK settings:** layered, direction DOWN, partitioning on. People go in partition `2g` and unions in `2g+1`, so generations are rows and union dots sit in the thin row between parents and children. Both layering and node placement use network simplex. `considerModelOrder` is `NODES_AND_EDGES`, so `sibling_order` decides left-to-right.
    - **Cycles:** if the rows can't be made consistent (for example someone married to their own descendant), partitioning is turned off and ELK layers the graph itself.
14. **Lines:**
    - Each partner has a line to their union dot, and each child has a line from the union dot (smoothstep edges).
    - Biological is solid, adoptive dashed, step and foster dotted (spec §6).
    - Divorced and separated unions have a grey, dashed ("broken") dot and grey dashed partner lines.
    - The styling is CSS classes on edges (`edge-adoptive`, `edge-ended`, …), not inline styles.
15. **Cards:**
    - **Content:** a silhouette with initials (photos are phase 6), the name, years as `personYears()` with "† " in front when not living, a grey frame when deceased, "You" on the user's own card, and a "focus" ring on the focused card.
    - **Zoom levels:** full card at zoom ≥ 0.55, name and years at ≥ 0.25, a dot below that.
    - **Accessibility:** the whole card face is one `<button>` named "Name, years, deceased, you". The "+" buttons are labelled "Add a parent of Name" and so on.
    - **Keyboard:** Tab walks the cards in tree order. Focusing a card that is off-screen pans it into view.
    - React Flow's own node focus is off, so there are no double tab stops.
16. **Sibling order:**
    - **Endpoint:** `POST /trees/:id/unions/:uid/child-order { childIds }` takes the **complete** list of the union's live children in the new order. A different set is `409 CONFLICT` (the family changed).
    - **Permission:** `relation.edit` with ends = the partners and the children.
    - **What it writes:** `persons.sibling_order = 1..n`, without bumping `version` (it isn't a person field, so it doesn't stale someone's open edit form).
    - **Audit:** a new action `link.reorder` (entity `union`, people = partners and children), shown in History as "Children reordered".
    - **Shared order:** a child of two unions has one `sibling_order`, so reordering in one union can move them in the other. This is accepted.
    - **Reading:** `GET /persons/:id` now returns union children and siblings in sibling order.
    - **On the canvas:** a child card is draggable only when the union is `canEdit`, has 2 or more children, and all of them are in the view. Dropping reorders by x position. Everything else is fixed ("automatic layout only").
    - **Keyboard alternative:** **Move earlier** / **Move later** buttons in the Relations tab.
17. **Page layout:**
    - `Page` gets a `full` width variant for the tree page.
    - The canvas fills the row. The side panel is 400px on the right; under 720px it becomes a bottom sheet with a **Close** button.
    - The phase 4 people list stays, under the canvas in an "All people (N)" disclosure, as a non-visual fallback.
18. **Out of scope** (phase 6): the search box and "How are we related?" (the top bar leaves room for them), and photos on cards.
19. **Dev data:** `pnpm seed <email> --large <N>` adds "Large family (seed)" with N people (100–10,000) to test the 2,000-person rule and layout speed.
20. **Dependency age:** `pnpm-workspace.yaml` gets `minimumReleaseAge: 20160` (14 days, in minutes), so pnpm itself refuses anything newer.
    - This matters: d3-drag, d3-zoom, d3-selection, d3-interpolate, d3-color, d3-dispatch, d3-ease, d3-timer and d3-transition all got new patch releases on 2026-11-03.
    - The setting makes pnpm resolve the previous (2021–2022) versions. Task 1 verifies the lockfile.

## File map

```
pnpm-workspace.yaml                    + minimumReleaseAge: 20160
packages/shared/src/
  graph.ts (+test)                     graph query/response schemas, limits, compareSiblings, childOrderSchema, similarQuerySchema
  graph-view.ts (+test)                kinIndex, neighbourhood, connectedTo, visibleRelations, withHiddenRelatives
  similar.ts (+test)                   normalizeName, editDistance, findSimilar
  people.ts                            + 'link.reorder' audit action
  index.ts                             + exports
apps/api/src/
  trees/graph-rows.ts                  loadGraphRows(): live skeleton + display columns, one snapshot
  trees/graph-view.ts                  buildTreeGraph(): selection + can() flags
  trees/person-view.ts                 children and siblings sorted by sibling order
  routes/graph.ts (+int test)          GET graph, GET disconnected, GET persons/similar, POST child-order
  routes/isolation.int.test.ts         + the four routes
  routes/people-permissions.int.test.ts + graph and child-order rows
  db/seed.ts, db/seed-cli.ts           + seedLargeFamily, --large N
  db/seed.int.test.ts                  + large seed
  app.ts                               register graphRoutes
apps/web/
  package.json                         + @xyflow/react 12.12.0, elkjs 0.12.0
  src/auth/api.ts                      + MESSAGES.layoutFailed
  src/trees/api.ts (+test)             + getGraph, listDisconnected, findSimilar, reorderChildren
  src/trees/format.ts                  + 'link.reorder' label, initials()
  src/test/fake-trees.ts (+test)       + the same in memory, fakeGraph()
  src/test/fake-layout.ts              FakeLayoutEngine
  src/test/setup.ts                    + React Flow jsdom mocks
  src/test/render.tsx                  + LayoutEngineProvider with a fake
  src/canvas/
    graph-to-flow.ts (+test)           TreeGraph -> nodes/edges/families
    generations.ts (+test)             assignGenerations()
    elk-graph.ts (+test)               ELK options, toElkGraph(), applyElkLayout()
    layout.test.ts                     real ELK in Node: rows, partners, sibling order
    layout-engine.ts                   LayoutEngine, createWorkerLayoutEngine()
    LayoutEngineContext.tsx            provider + hook
    canvas-settings.ts (+test)         cardDetail(zoom), canvasSettings(n), isNodeVisible(), orderAfterDrag()
    CanvasActions.tsx                  context: openPerson, addRelative, openUnion, reveal
    PersonCard.tsx (+test)             PersonCardView (pure) + PersonNode (React Flow)
    UnionNode.tsx
    FamilyCanvas.tsx (+test)           React Flow wrapper: fit/centre, reveal on focus, drag-reorder
    useTreeGraph.ts                    fetch -> map -> layout, stale-safe
    params.ts (+test)                  readCanvasParams(), canvasSearch(), usePersonHref()
    CanvasToolbar.tsx                  Focus/Full, depth, branch, Add a person, Disconnected, links
    DisconnectedPeople.tsx
  src/components/Page.tsx              + full variant
  src/pages/TreePage.tsx (+test)       loads tree; renders TreeWorkspace
  src/pages/tree/TreeWorkspace.tsx (+TreeWorkspace.test.tsx)  toolbar + canvas + side panel / bottom sheet
  src/pages/tree/UnionPanel.tsx (+test)
  src/pages/tree/UnionForm.tsx         moved out of RelationsTab.tsx
  src/pages/tree/DuplicatePrompt.tsx (+test), useDuplicateCheck.ts
  src/pages/tree/AddRelativeForm.tsx (+test), AddPersonForm.tsx (+test)   + duplicate check
  src/pages/tree/RelationsTab.tsx      + ?add=, Move earlier/later, usePersonHref
  src/pages/tree/PersonPanel.tsx       tab changes keep the other params
  src/pages/tree/PeopleList.tsx        fallback list (no "arrives later" note), usePersonHref
  src/routes.tsx                       + /trees/:treeId/unions/:unionId
  src/styles.css                       + canvas, cards, edges, toolbar, bottom sheet
README.md                              canvas, duplicate check, disconnected, large seed; limitations
```

---

## Task 1: Dependencies — React Flow and ELK

**Files:**
- Modify: `pnpm-workspace.yaml`, `apps/web/package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Re-check the publish dates** (read-only network):

```bash
pnpm view @xyflow/react time --json | grep -E '"12\.12\.0"'
pnpm view elkjs time --json | grep -E '"0\.12\.0"'
```

  Expected: `12.12.0` is from 2026-09-24 and `0.12.0` from 2026-07-17. `elkjs` 0.12.1 and 0.13.0 (2026-10-28) are too new, so don't use them.

- [ ] **Step 2: Turn on pnpm's own age gate.** Edit `pnpm-workspace.yaml` to:

```yaml
packages:
  - apps/*
  - packages/*
allowBuilds:
  esbuild: true
injectWorkspacePackages: true
# Refuse any package version published less than 14 days ago (minutes). Never add an exclude list.
minimumReleaseAge: 20160
```

- [ ] **Step 3: Install with exact pins:**

```bash
pnpm --filter @family-tree/web add --save-exact @xyflow/react@12.12.0 elkjs@0.12.0
```

  Expected: `apps/web/package.json` dependencies gain `"@xyflow/react": "12.12.0"` and `"elkjs": "0.12.0"`. No other package's version changes (`git diff pnpm-lock.yaml` adds entries only).

  If pnpm 12.18 rejects `minimumReleaseAge`, stop and ask. Don't work around it with `minimumReleaseAgeExclude`.

- [ ] **Step 4: Verify every new lockfile package is old enough** and has no install script. Write `scratchpad/check-ages.mjs` (outside the repo):

```js
// Usage: node check-ages.mjs <repo>/pnpm-lock.yaml [base-ref]  — new packages and their publish dates.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const lock = readFileSync(process.argv[2], 'utf8');
const base = process.argv[3] ?? 'HEAD'; // the commit to compare against
const before = execFileSync('git', ['show', `${base}:pnpm-lock.yaml`], { encoding: 'utf8' });
const keys = (s) => new Set([...s.matchAll(/^  '?(@?[^@\s']+)@([^:'(\s]+)'?:$/gm)].map((m) => `${m[1]}@${m[2]}`));
const old = keys(before);
const cutoff = Date.now() - 14 * 86_400_000;
let bad = 0;
for (const k of keys(lock)) {
  if (old.has(k)) continue;
  const at = k.lastIndexOf('@');
  const [name, version] = [k.slice(0, at), k.slice(at + 1)];
  const time = JSON.parse(execFileSync('pnpm', ['view', name, 'time', '--json'], { encoding: 'utf8' }))[version];
  const scripts = execFileSync('pnpm', ['view', `${name}@${version}`, 'scripts', '--json'], { encoding: 'utf8' }) || '{}';
  const install = /"(pre|post)?install"/.test(scripts);
  const tooNew = Date.parse(time) > cutoff;
  if (tooNew || install) bad++;
  console.log(`${tooNew || install ? 'BAD ' : 'ok  '} ${k} ${time}${install ? ' (install script)' : ''}`);
}
process.exit(bad ? 1 : 0);
```

  Run: `cd /home/hsafari99/Documents/hosseinRepos/family-tree && node <scratchpad>/check-ages.mjs pnpm-lock.yaml`

  Expected: every line starts with `ok`.
  - The d3 packages resolve to 3.0.0 / 3.0.1 / 3.1.0 (2021–2022), not the 2026-11-03 releases.
  - `@xyflow/system` is 0.0.83 (2026-09-24).
  - `zustand` is 4.5.7.
  - If any line says `BAD`, stop and ask.

- [ ] **Step 5: Confirm elkjs is pure JS and ships the worker:**

```bash
ls apps/web/node_modules/elkjs/lib/
```

  Expected: `elk-api.js`, `elk-worker.min.js`, `elk.bundled.js`, `main.js` and `.d.ts` files. There are no `.node` files and no `binding.gyp`.

- [ ] **Step 6: Build and test still pass:**

```bash
pnpm typecheck && pnpm --filter @family-tree/web test && pnpm --filter @family-tree/web build
```

  Expected: all pass, with no "Illegal instruction". Vite is still 8.3.6: `pnpm --filter @family-tree/web exec vite --version`.

- [ ] **Step 7: Commit**

```bash
git add pnpm-workspace.yaml apps/web/package.json pnpm-lock.yaml
git commit -m "build(web): add @xyflow/react 12.12.0 and elkjs 0.12.0; 14-day release age gate"
```

---

## Task 2: Shared — graph schemas, limits, sibling order, reorder audit action

**Files:**
- Create: `packages/shared/src/graph.ts`, `packages/shared/src/graph.test.ts`
- Modify: `packages/shared/src/people.ts` (AUDIT_ACTIONS), `packages/shared/src/index.ts`, `apps/web/src/trees/format.ts` (ACTION_LABEL)

- [ ] **Step 1: Write the failing test** `packages/shared/src/graph.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  childOrderSchema,
  compareSiblings,
  graphQuerySchema,
  similarQuerySchema,
  treeGraphSchema,
} from './graph.js';

const id = '00000000-0000-4000-8000-000000000001';

describe('graphQuerySchema', () => {
  it('defaults to a depth-1 focus view and coerces the depth from the query string', () => {
    expect(graphQuerySchema.parse({})).toEqual({ mode: 'focus', depth: 1 });
    expect(graphQuerySchema.parse({ focus: id, depth: '3' })).toEqual({
      mode: 'focus',
      focus: id,
      depth: 3,
    });
  });
  it('rejects depths outside 1..3, bad modes and bad ids', () => {
    for (const q of [{ depth: '0' }, { depth: '4' }, { depth: 'x' }, { mode: 'all' }, { focus: 'nope' }]) {
      expect(graphQuerySchema.safeParse(q).success).toBe(false);
    }
  });
});

describe('similarQuerySchema', () => {
  it('needs a first name; blank surname is dropped; the year is coerced', () => {
    expect(similarQuerySchema.parse({ givenName: ' Ada ', surname: ' ', birthYear: '1815' })).toEqual({
      givenName: 'Ada',
      birthYear: 1815,
    });
    expect(similarQuerySchema.safeParse({ givenName: '' }).success).toBe(false);
  });
});

describe('childOrderSchema', () => {
  it('needs at least two distinct ids', () => {
    expect(childOrderSchema.safeParse({ childIds: [id] }).success).toBe(false);
    expect(childOrderSchema.safeParse({ childIds: [id, id] }).success).toBe(false);
  });
});

describe('compareSiblings', () => {
  it('orders by sibling order, then birth year, then given name; unknowns last', () => {
    const p = (givenName: string, siblingOrder: number | null, birthYear: number | null) => ({
      givenName,
      siblingOrder,
      birthYear,
    });
    const sorted = [p('C', null, null), p('B', null, 1990), p('A', 2, null), p('Z', 1, 2000), p('D', null, 1980)]
      .sort(compareSiblings)
      .map((x) => x.givenName);
    expect(sorted).toEqual(['Z', 'A', 'D', 'B', 'C']);
  });
});

describe('treeGraphSchema', () => {
  it('accepts an empty needs-branch response', () => {
    expect(
      treeGraphSchema.safeParse({
        mode: 'full',
        focusId: null,
        branchId: null,
        persons: [],
        unions: [],
        links: [],
        total: 2500,
        truncated: false,
        needsBranch: true,
      }).success,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run it; it fails** (`Cannot find module './graph.js'`):
  `pnpm --filter @family-tree/shared exec vitest run src/graph.test.ts`

- [ ] **Step 3: Implement** `packages/shared/src/graph.ts`:

```ts
import { z } from 'zod';
import { fuzzyDateSchema } from './fuzzy-date.js';
import { CHILD_KINDS, UNION_STATUSES, UNION_TYPES } from './people.js';
import { NAME_MAX, personSummarySchema, SEXES } from './trees.js';

export const GRAPH_DEPTH_MAX = 3;
/** Spec §6: above this many people the full view loads by branch. */
export const FULL_VIEW_MAX = 2000;
/** A focus view never returns more people than this, nearest first (decision 4). */
export const FOCUS_VIEW_MAX = 500;
/** Duplicate-check matches returned (decision 8). */
export const SIMILAR_LIMIT = 5;
export const GRAPH_MODES = ['focus', 'full'] as const;
export type GraphMode = (typeof GRAPH_MODES)[number];

/** GET /trees/:id/graph query (decision 1). */
export const graphQuerySchema = z.object({
  mode: z.enum(GRAPH_MODES).default('focus'),
  focus: z.uuid().optional(),
  depth: z.coerce.number().int().min(1).max(GRAPH_DEPTH_MAX).default(1),
  branch: z.uuid().optional(),
});
export type GraphQuery = z.input<typeof graphQuerySchema>;
export type ParsedGraphQuery = z.output<typeof graphQuerySchema>;

export const graphPersonSchema = personSummarySchema.extend({
  sex: z.enum(SEXES),
  siblingOrder: z.number().int().nullable(),
  /** Has at least one recorded parent (anywhere in the tree, not just in this view). */
  hasParents: z.boolean(),
  /** A parent, child, partner or sibling is outside this view. */
  hiddenRelatives: z.boolean(),
  canAddRelative: z.boolean(),
});
export type GraphPerson = z.infer<typeof graphPersonSchema>;

export const graphUnionSchema = z.object({
  id: z.uuid(),
  /** Live partner ids; a partner outside the view is still named here (decision 3). */
  partnerAId: z.uuid().nullable(),
  partnerBId: z.uuid().nullable(),
  type: z.enum(UNION_TYPES),
  status: z.enum(UNION_STATUSES),
  startDate: fuzzyDateSchema.nullable(),
  endDate: fuzzyDateSchema.nullable(),
  /** Live children of the union in the whole tree. */
  childCount: z.number().int(),
  canEdit: z.boolean(),
});
export type GraphUnionView = z.infer<typeof graphUnionSchema>;

export const graphLinkSchema = z.object({
  id: z.uuid(),
  unionId: z.uuid(),
  childId: z.uuid(),
  kind: z.enum(CHILD_KINDS),
});
export type GraphLinkView = z.infer<typeof graphLinkSchema>;

export const treeGraphSchema = z.object({
  mode: z.enum(GRAPH_MODES),
  focusId: z.uuid().nullable(),
  branchId: z.uuid().nullable(),
  persons: z.array(graphPersonSchema),
  unions: z.array(graphUnionSchema),
  links: z.array(graphLinkSchema),
  /** Live people in the whole tree. */
  total: z.number().int(),
  /** The view hit its size limit. */
  truncated: z.boolean(),
  /** Full view of a tree above FULL_VIEW_MAX without a branch: nothing returned. */
  needsBranch: z.boolean(),
});
export type TreeGraph = z.infer<typeof treeGraphSchema>;

/** GET /trees/:id/persons/similar query (decision 8). */
export const similarQuerySchema = z.object({
  givenName: z.string().trim().min(1).max(NAME_MAX),
  surname: z
    .string()
    .trim()
    .max(NAME_MAX)
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  birthYear: z.coerce.number().int().min(1).max(9999).optional(),
});
export type SimilarQuery = z.input<typeof similarQuerySchema>;

/** POST /trees/:id/unions/:uid/child-order: every live child of the union, in the new order. */
export const childOrderSchema = z.object({
  childIds: z
    .array(z.uuid())
    .min(2)
    .max(1000)
    .refine((ids) => new Set(ids).size === ids.length, 'List each child once'),
});

type SiblingKey = { siblingOrder: number | null; birthYear: number | null; givenName: string };
const last = (n: number | null) => n ?? Number.POSITIVE_INFINITY;
/** Left-to-right order of siblings (decision 16): sibling_order, then birth year, then name. */
export function compareSiblings(a: SiblingKey, b: SiblingKey): number {
  return (
    last(a.siblingOrder) - last(b.siblingOrder) ||
    last(a.birthYear) - last(b.birthYear) ||
    a.givenName.localeCompare(b.givenName)
  );
}
```

  Careful: `Infinity - Infinity` is `NaN`, and `NaN || x` falls through to `x`, which is the behaviour we want. The test with two `null` orders covers it.

  **`people.ts`:** add `'link.reorder'` to `AUDIT_ACTIONS`, after `'link.delete'`.

  **`index.ts`:** add `export * from './graph.js';`.

  **`apps/web/src/trees/format.ts`:** add `'link.reorder': 'Children reordered'` to `ACTION_LABEL`. The `Record<AuditAction, string>` type makes this a compile error until you do.

- [ ] **Step 4: Run** `pnpm --filter @family-tree/shared exec vitest run src/graph.test.ts` (PASS), then `pnpm typecheck` (PASS).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/graph.ts packages/shared/src/graph.test.ts packages/shared/src/people.ts packages/shared/src/index.ts apps/web/src/trees/format.ts
git commit -m "feat(shared): graph query and response schemas, limits, sibling order"
```

---

## Task 3: Shared — focus neighbourhood, reachability, visible relations

**Files:**
- Create: `packages/shared/src/graph-view.ts`, `packages/shared/src/graph-view.test.ts`
- Modify: `packages/shared/src/index.ts`

The fixture used here (and, as rows, in Task 5):

```
Gp + Gm ─► Pa
Pa + Ma ─► Olive, Sis
Ma + Step ─► Half
Olive + Sam ─► Kid
Kid + Kp ─► Gk
Lone (no relations)
```

- [ ] **Step 1: Write the failing test** `packages/shared/src/graph-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { LiveGraph } from './family-graph.js';
import {
  connectedTo,
  kinIndex,
  neighbourhood,
  visibleRelations,
  withHiddenRelatives,
} from './graph-view.js';

const P = ['gp', 'gm', 'pa', 'ma', 'olive', 'sis', 'step', 'half', 'sam', 'kid', 'kp', 'gk', 'lone'];
const graph: LiveGraph = {
  persons: P.map((id) => ({ id })),
  unions: [
    { id: 'u-gp', partnerAId: 'gp', partnerBId: 'gm' },
    { id: 'u-pa', partnerAId: 'pa', partnerBId: 'ma' },
    { id: 'u-step', partnerAId: 'ma', partnerBId: 'step' },
    { id: 'u-olive', partnerAId: 'olive', partnerBId: 'sam' },
    { id: 'u-kid', partnerAId: 'kid', partnerBId: 'kp' },
  ],
  parentChild: [
    { id: 'l-pa', unionId: 'u-gp', childId: 'pa' },
    { id: 'l-olive', unionId: 'u-pa', childId: 'olive' },
    { id: 'l-sis', unionId: 'u-pa', childId: 'sis' },
    { id: 'l-half', unionId: 'u-step', childId: 'half' },
    { id: 'l-kid', unionId: 'u-olive', childId: 'kid' },
    { id: 'l-gk', unionId: 'u-kid', childId: 'gk' },
  ],
};
const sorted = (s: Iterable<string>) => [...s].sort();

describe('neighbourhood', () => {
  const kin = kinIndex(graph);
  it('depth 1 is parents, siblings, partners and children (spec §6)', () => {
    expect(sorted(neighbourhood(kin, 'olive', 1, 500).ids)).toEqual(
      sorted(['olive', 'pa', 'ma', 'sis', 'sam', 'kid']),
    );
  });
  it('depth 2 adds grandparents, step-parent, half-sibling, in-law and grandchild', () => {
    expect(sorted(neighbourhood(kin, 'olive', 2, 500).ids)).toEqual(
      sorted(['olive', 'pa', 'ma', 'sis', 'sam', 'kid', 'gp', 'gm', 'step', 'half', 'kp', 'gk']),
    );
  });
  it('never reaches someone with no relations', () => {
    expect(neighbourhood(kin, 'olive', 3, 500).ids.has('lone')).toBe(false);
  });
  it('stops at the limit, nearest first, and says so', () => {
    const n = neighbourhood(kin, 'olive', 3, 4);
    expect(n.ids.size).toBe(4);
    expect(n.truncated).toBe(true);
    expect(n.ids.has('olive')).toBe(true);
    expect([...n.ids].every((id) => ['olive', 'pa', 'ma', 'sis', 'sam', 'kid'].includes(id))).toBe(true);
  });
  it('can be limited to a set (branch view)', () => {
    const within = new Set(['sam', 'kid', 'kp', 'gk']);
    expect(sorted(neighbourhood(kin, 'sam', Infinity, 2000, within).ids)).toEqual(sorted(within));
  });
});

describe('connectedTo', () => {
  it('is everyone reachable from the root through any relation', () => {
    const c = connectedTo(kinIndex(graph), 'olive');
    expect(c.size).toBe(12);
    expect(c.has('lone')).toBe(false);
  });
  it('is empty without a root', () => {
    expect(connectedTo(kinIndex(graph), null).size).toBe(0);
  });
});

describe('visibleRelations', () => {
  it('draws unions with both partners shown, or a partner and a child shown (decision 3)', () => {
    const ids = neighbourhood(kinIndex(graph), 'olive', 1, 500).ids;
    const { unionIds, linkIds } = visibleRelations(graph, ids);
    expect(sorted(unionIds)).toEqual(['u-olive', 'u-pa']);
    expect(sorted(linkIds)).toEqual(['l-kid', 'l-olive', 'l-sis']);
  });
  it('keeps a single-parent union when its child is shown', () => {
    const g: LiveGraph = {
      persons: [{ id: 'mum' }, { id: 'kid' }],
      unions: [{ id: 'u', partnerAId: 'mum', partnerBId: null }],
      parentChild: [{ id: 'l', unionId: 'u', childId: 'kid' }],
    };
    expect(sorted(visibleRelations(g, new Set(['mum', 'kid'])).unionIds)).toEqual(['u']);
    expect(visibleRelations(g, new Set(['mum'])).unionIds.size).toBe(0);
  });
});

describe('withHiddenRelatives', () => {
  it('marks people with a close relative outside the view', () => {
    const kin = kinIndex(graph);
    const ids = neighbourhood(kin, 'olive', 1, 500).ids;
    expect(sorted(withHiddenRelatives(kin, ids))).toEqual(['kid', 'ma', 'pa']);
  });
});
```

- [ ] **Step 2: Run it; it fails** (`pnpm --filter @family-tree/shared exec vitest run src/graph-view.test.ts`).

- [ ] **Step 3: Implement** `packages/shared/src/graph-view.ts`:

```ts
import { type LiveGraph, partnersOf } from './family-graph.js';

/** Close relatives (decision 2): person id -> parents, children, partners and siblings. */
export type KinIndex = ReadonlyMap<string, ReadonlySet<string>>;

export function kinIndex(graph: LiveGraph): KinIndex {
  const kin = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      let s = kin.get(x);
      if (!s) kin.set(x, (s = new Set()));
      s.add(y);
    }
  };
  const unionById = new Map(graph.unions.map((u) => [u.id, u]));
  const kids = new Map<string, string[]>();
  for (const u of graph.unions) {
    if (u.partnerAId !== null && u.partnerBId !== null) link(u.partnerAId, u.partnerBId);
  }
  for (const l of graph.parentChild) {
    const u = unionById.get(l.unionId);
    if (!u) continue;
    for (const p of partnersOf(u)) link(p, l.childId);
    const list = kids.get(l.unionId);
    if (list) list.push(l.childId);
    else kids.set(l.unionId, [l.childId]);
  }
  for (const list of kids.values()) for (const a of list) for (const b of list) link(a, b);
  return kin;
}

export interface Neighbourhood {
  ids: Set<string>;
  truncated: boolean;
}

/**
 * Everyone within `depth` close-relative steps of `startId`, breadth first and nearest first,
 * at most `limit` people. `within` restricts the walk (the branch view).
 */
export function neighbourhood(
  kin: KinIndex,
  startId: string,
  depth: number,
  limit: number,
  within?: ReadonlySet<string>,
): Neighbourhood {
  const ids = new Set([startId]);
  let frontier = [startId];
  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      // Sorted so a truncated view is the same on every request.
      for (const n of [...(kin.get(id) ?? [])].sort()) {
        if (ids.has(n) || (within && !within.has(n))) continue;
        if (ids.size >= limit) return { ids, truncated: true };
        ids.add(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return { ids, truncated: false };
}

/** Everyone reachable from the root through any relation (spec §3 "Disconnected people"). */
export function connectedTo(kin: KinIndex, rootId: string | null): Set<string> {
  if (rootId === null) return new Set();
  return neighbourhood(kin, rootId, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY).ids;
}

/** The unions and links drawn among `ids` (decision 3). */
export function visibleRelations(graph: LiveGraph, ids: ReadonlySet<string>) {
  const childShown = new Set<string>();
  for (const l of graph.parentChild) if (ids.has(l.childId)) childShown.add(l.unionId);
  const unionIds = new Set<string>();
  for (const u of graph.unions) {
    const shown = partnersOf(u).filter((p) => ids.has(p)).length;
    if (shown === 2 || (shown === 1 && childShown.has(u.id))) unionIds.add(u.id);
  }
  const linkIds = new Set<string>();
  for (const l of graph.parentChild) {
    if (unionIds.has(l.unionId) && ids.has(l.childId)) linkIds.add(l.id);
  }
  return { unionIds, linkIds };
}

/** People in `ids` with a close relative outside `ids`. */
export function withHiddenRelatives(kin: KinIndex, ids: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    for (const n of kin.get(id) ?? []) {
      if (!ids.has(n)) {
        out.add(id);
        break;
      }
    }
  }
  return out;
}
```

  Add `export * from './graph-view.js';` to `index.ts`.

- [ ] **Step 4: Run the test; it passes.** Also run the whole shared suite: `pnpm --filter @family-tree/shared test`.

- [ ] **Step 5: Commit** `git commit -m "feat(shared): focus neighbourhood, reachability and visible relations"` (add the two new files and `index.ts`).

---

## Task 4: Shared — similar-name matching for the duplicate check

**Files:**
- Create: `packages/shared/src/similar.ts`, `packages/shared/src/similar.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test** `packages/shared/src/similar.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { editDistance, findSimilar, normalizeName, type SimilarCandidate } from './similar.js';

const c = (id: string, givenName: string, extra: Partial<SimilarCandidate> = {}): SimilarCandidate => ({
  id,
  givenName,
  middleName: null,
  surname: 'Lovelace',
  maidenName: null,
  nickname: null,
  birthYear: null,
  deathYear: null,
  isLiving: true,
  ...extra,
});

describe('normalizeName', () => {
  it('lower-cases, strips accents and collapses spaces', () => {
    expect(normalizeName('  Zoë   ÅSE ')).toBe('zoe ase');
  });
});

describe('editDistance', () => {
  it('counts edits and stops early past the limit', () => {
    expect(editDistance('kitten', 'sitting', 5)).toBe(3);
    expect(editDistance('ada', 'ada', 1)).toBe(0);
    expect(editDistance('abcdef', 'uvwxyz', 1)).toBe(2); // capped at limit + 1
  });
});

describe('findSimilar', () => {
  const people = [
    c('exact', 'Ada', { birthYear: 1815 }),
    c('typo', 'Adah', { birthYear: 1816 }),
    c('far-year', 'Ada', { birthYear: 1830 }),
    c('no-year', 'Ada'),
    c('other-surname', 'Ada', { surname: 'Byron', birthYear: 1815 }),
    c('maiden', 'Ada', { surname: 'King', maidenName: 'Lovelace', birthYear: 1815 }),
    c('nick', 'Augusta', { nickname: 'Ada', birthYear: 1815 }),
    c('other', 'Charles', { birthYear: 1815 }),
  ];
  it('matches close first names, last or maiden names and years within 2', () => {
    const ids = findSimilar(people, { givenName: 'Ada', surname: 'Lovelace', birthYear: 1815 }, 10).map((p) => p.id);
    expect(ids.slice(0, 3).sort()).toEqual(['exact', 'maiden', 'nick']);
    expect(ids).toContain('typo');
    expect(ids).toContain('no-year');
    expect(ids).not.toContain('far-year');
    expect(ids).not.toContain('other-surname');
    expect(ids).not.toContain('other');
  });
  it('ignores accents and case, and limits the result', () => {
    const list = [c('zoe', 'Zoë', { surname: 'Ångström' })];
    expect(findSimilar(list, { givenName: 'zoe', surname: 'angstrom' }, 5)).toHaveLength(1);
    expect(findSimilar(people, { givenName: 'Ada' }, 2)).toHaveLength(2);
  });
  it('treats a short prefix with care: "Al" does not match "Alexander"', () => {
    expect(findSimilar([c('x', 'Alexander')], { givenName: 'Al' }, 5)).toHaveLength(0);
    expect(findSimilar([c('x', 'Alexander')], { givenName: 'Alex' }, 5)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it; it fails.**

- [ ] **Step 3: Implement** `packages/shared/src/similar.ts`:

```ts
/** Phase 5 duplicate check (decision 8). Phase 6 replaces the candidate search with pg_trgm. */

export interface SimilarCandidate {
  id: string;
  givenName: string;
  middleName: string | null;
  surname: string | null;
  maidenName: string | null;
  nickname: string | null;
  birthYear: number | null;
  deathYear: number | null;
  isLiving: boolean;
}
export interface SimilarInput {
  givenName: string;
  surname?: string | undefined;
  birthYear?: number | undefined;
}
export const BIRTH_YEAR_SLACK = 2;

export function normalizeName(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Levenshtein distance, or `limit + 1` as soon as it is certainly above `limit`. */
export function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      row.push(v);
      if (v < best) best = v;
    }
    if (best > limit) return limit + 1;
    prev = row;
  }
  return Math.min(prev[b.length]!, limit + 1);
}

function close(a: string, b: string): boolean {
  if (a === '' || b === '') return false;
  if (a === b) return true;
  const short = Math.min(a.length, b.length);
  if (short >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  const allowed = short >= 7 ? 2 : short >= 4 ? 1 : 0;
  return allowed > 0 && editDistance(a, b, allowed) <= allowed;
}

const names = (...xs: (string | null)[]) =>
  xs.filter((x): x is string => x !== null && x.trim() !== '').map(normalizeName);

/** The best `limit` candidates that could be the person being added, best first. */
export function findSimilar<T extends SimilarCandidate>(
  candidates: readonly T[],
  q: SimilarInput,
  limit: number,
): T[] {
  const given = normalizeName(q.givenName);
  const surname = q.surname ? normalizeName(q.surname) : '';
  const scored: { c: T; score: number }[] = [];
  for (const c of candidates) {
    const givens = names(c.givenName, c.nickname);
    if (!givens.some((g) => close(g, given))) continue;
    const surnames = names(c.surname, c.maidenName);
    if (surname && surnames.length > 0 && !surnames.some((s) => close(s, surname))) continue;
    if (
      q.birthYear !== undefined &&
      c.birthYear !== null &&
      Math.abs(c.birthYear - q.birthYear) > BIRTH_YEAR_SLACK
    ) {
      continue;
    }
    const score =
      (givens.includes(given) ? 2 : 0) +
      (surname && surnames.includes(surname) ? 2 : 0) +
      (q.birthYear !== undefined && c.birthYear === q.birthYear ? 1 : 0);
    scored.push({ c, score });
  }
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.c.surname ?? '').localeCompare(b.c.surname ?? '') ||
        a.c.givenName.localeCompare(b.c.givenName),
    )
    .slice(0, limit)
    .map((s) => s.c);
}
```

  Add `export * from './similar.js';` to `index.ts`.

- [ ] **Step 4: Run the test; it passes.**

- [ ] **Step 5: Commit** `git commit -m "feat(shared): similar-name matching for the duplicate check"`.

---
## Task 5: API — graph rows, view selection and `GET /trees/:id/graph`

**Files:**
- Create: `apps/api/src/trees/graph-rows.ts`, `apps/api/src/trees/graph-view.ts`, `apps/api/src/routes/graph.ts`, `apps/api/src/routes/graph.int.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write the failing integration test** `apps/api/src/routes/graph.int.test.ts`. Use the same boilerplate as `persons.int.test.ts` (config, deps, `buildApp` per test, `call`, helpers).

```ts
import { treeGraphSchema } from '@family-tree/shared';
// ...boilerplate imports and app setup as in persons.int.test.ts...
import { persons } from '../db/schema.js';

/** The Task 3 fixture, around the tree's root "Olive". */
async function setup() {
  const { owner, treeId } = await ownerWithTree(app);
  const root = await db.query.trees.findFirst({ where: (t, { eq: e }) => e(t.id, treeId) });
  const olive = { id: root!.rootPersonId! };
  const [gp, gm, pa, ma, sis, step, half, sam, kid, kp, gk, lone] = await Promise.all(
    ['Gp', 'Gm', 'Pa', 'Ma', 'Sis', 'Step', 'Half', 'Sam', 'Kid', 'Kp', 'Gk', 'Lone'].map((n) =>
      addPerson(db, treeId, n),
    ),
  );
  await family(db, treeId, gp!, gm!, [pa!]);
  const uPa = await family(db, treeId, pa!, ma!, [olive, sis!]);
  await family(db, treeId, ma!, step!, [half!]);
  const uOlive = await family(db, treeId, olive, sam!, [kid!]);
  await family(db, treeId, kid!, kp!, [gk!]);
  const p = { olive, gp, gm, pa, ma, sis, step, half, sam, kid, kp, gk, lone } as Record<string, { id: string }>;
  return { owner, treeId, p, uPa, uOlive };
}
const g = (t: string, qs = '') => `/api/v1/trees/${t}/graph${qs ? `?${qs}` : ''}`;
const namesOf = async (body: unknown, treeId: string) => {
  const parsed = treeGraphSchema.parse(body);
  return parsed.persons.map((x) => x.givenName).sort();
};
```

  Tests:
  1. **Default view:** the owner's `GET graph` (no query) is a depth-1 focus on the root ("Olive", from `ownerWithTree`). Its names are `['Kid', 'Ma', 'Olive', 'Pa', 'Sam', 'Sis']`.
     - `focusId` = root, `mode: 'focus'`, `truncated: false`, `needsBranch: false`, `total: 13`.
     - `unions` are exactly `uPa` and `uOlive`, and `links` are 3.
     - `hiddenRelatives` is true for Pa, Ma and Kid only.
     - The body parses with `treeGraphSchema`.
  2. **Depth 2:** `?focus=<olive>&depth=2` adds Gp, Gm, Step, Half, Kp and Gk, and never Lone.
  3. **Full view:** `?mode=full` returns all 13. `?mode=full&branch=<sam>` returns Sam, Kid, Kp and Gk, with `branchId` = Sam.
  4. **Bad queries:** `?depth=4`, `?depth=0`, `?mode=all` and `?focus=nope` are 400 `VALIDATION`.
  5. **Unknown people:** `?focus=<random uuid>` is 404. So is `?focus=<root of a second tree>` (a second `ownerWithTree`). So is `?mode=full&branch=<a soft-deleted person>`.
  6. **Deleted rows:** after `softDeleteBatch(db, treeId, owner.userId, [sis.id])`, Sis and her link are gone from the depth-1 view.
  7. **Flags by role:**
     - The owner has `canAddRelative: true` everywhere and `canEdit: true` on both unions.
     - A viewer (`addMember(…, 'viewer')`) gets 200, with `canAddRelative` false everywhere and `canEdit` false.
     - A steward: a viewer with 2FA (`userWith2fa`) and `addGrant(…, sam.id, owner.userId)`. In `?mode=full`:
       - `canAddRelative` is true for Sam, Kid, Kp and Gk, and false for Olive and Pa.
       - `canEdit` is true for `uOlive` (Sam is in scope) and false for `uPa`.
  8. **The 2,000 rule:** bulk-insert 2,000 more people in one statement:

     ```ts
     await db.insert(persons).values(Array.from({ length: 2000 }, (_, i) => ({ treeId, givenName: `Bulk ${i}` })));
     ```

     - `?mode=full` gives `needsBranch: true`, `persons: []`, and `total: 2013`.
     - `?mode=full&branch=<sam>` still works.
     - The focus view is unaffected.
  9. **Outsiders:** a signed-in non-member gets 404, and no session gets 401 (the isolation suite repeats this in Task 8).
  10. **Sibling order:** after `db.update(persons).set({ siblingOrder: 2 })` on Olive and `{ siblingOrder: 1 }` on Sis, both carry their `siblingOrder` in the response.

- [ ] **Step 2: Run it; it fails** (404 for the unknown route):
  `pnpm --filter @family-tree/api exec vitest run --config vitest.int.config.ts src/routes/graph.int.test.ts`

- [ ] **Step 3: Implement `apps/api/src/trees/graph-rows.ts`:**

```ts
import type {
  ChildKind,
  FuzzyDate,
  GraphLink,
  GraphUnion,
  PersonSummary,
  Sex,
  UnionStatus,
  UnionType,
} from '@family-tree/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { parentChild, persons, unions } from '../db/schema.js';
import { summaryColumns } from './people.js';

export type GraphPersonRow = PersonSummary & { sex: Sex; siblingOrder: number | null };
export interface GraphUnionRow extends GraphUnion {
  type: UnionType;
  status: UnionStatus;
  startDate: FuzzyDate | null;
  endDate: FuzzyDate | null;
}
export interface GraphLinkRow extends GraphLink {
  kind: ChildKind;
}
/** A LiveGraph (structurally) with the columns the canvas shows. */
export interface GraphRows {
  persons: GraphPersonRow[];
  unions: GraphUnionRow[];
  parentChild: GraphLinkRow[];
}

/**
 * The tree's live people, unions and links in one snapshot (decision 6). Same liveness rules as
 * loadLiveGraph: a partner that isn't live is an empty slot, a union without a live partner is
 * dropped, and so are links whose union or child isn't live.
 */
export function loadGraphRows(db: Db, treeId: string): Promise<GraphRows> {
  return db.transaction(
    async (tx) => {
      const people = await tx
        .select({ ...summaryColumns, sex: persons.sex, siblingOrder: persons.siblingOrder })
        .from(persons)
        .where(and(eq(persons.treeId, treeId), isNull(persons.deletedAt)));
      const live = new Set(people.map((p) => p.id));
      const liveOrNull = (id: string | null) => (id !== null && live.has(id) ? id : null);
      const rawUnions = await tx
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
      const liveUnions = rawUnions
        .map((u) => ({ ...u, partnerAId: liveOrNull(u.partnerAId), partnerBId: liveOrNull(u.partnerBId) }))
        .filter((u) => u.partnerAId !== null || u.partnerBId !== null);
      const unionIds = new Set(liveUnions.map((u) => u.id));
      const links = await tx
        .select({
          id: parentChild.id,
          unionId: parentChild.unionId,
          childId: parentChild.childId,
          kind: parentChild.kind,
        })
        .from(parentChild)
        .where(and(eq(parentChild.treeId, treeId), isNull(parentChild.deletedAt)));
      return {
        persons: people,
        unions: liveUnions,
        parentChild: links.filter((l) => unionIds.has(l.unionId) && live.has(l.childId)),
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
```

  If the Drizzle column types for `startDate`/`endDate` aren't `FuzzyDate | null`, cast in the select mapping, the way `person-view.ts` does.

- [ ] **Step 4: Implement `apps/api/src/trees/graph-view.ts`:**

```ts
import {
  branchOf,
  FOCUS_VIEW_MAX,
  FULL_VIEW_MAX,
  kinIndex,
  neighbourhood,
  type ParsedGraphQuery,
  partnersOf,
  type TreeGraph,
  visibleRelations,
  withHiddenRelatives,
} from '@family-tree/shared';
import { notFound } from '../errors.js';
import { can } from '../permissions/can.js';
import type { Access } from './access.js';
import type { GraphRows } from './graph-rows.js';

/** Picks the people for the requested view and adds the per-item can() flags (decisions 1–5). */
export function buildTreeGraph(rows: GraphRows, access: Access, q: ParsedGraphQuery): TreeGraph {
  const live = new Set(rows.persons.map((p) => p.id));
  const kin = kinIndex(rows);
  let ids: ReadonlySet<string> = new Set();
  let focusId: string | null = null;
  let branchId: string | null = null;
  let truncated = false;
  let needsBranch = false;

  if (q.mode === 'focus') {
    focusId = q.focus ?? access.rootPersonId;
    if (focusId !== null) {
      if (!live.has(focusId)) throw notFound();
      ({ ids, truncated } = neighbourhood(kin, focusId, q.depth, FOCUS_VIEW_MAX));
    }
  } else if (q.branch !== undefined) {
    if (!live.has(q.branch)) throw notFound();
    branchId = q.branch;
    const branch = branchOf(
      {
        persons: rows.persons.map((p) => ({ id: p.id, createdBy: null })),
        unions: rows.unions,
        parentChild: rows.parentChild,
      },
      q.branch,
      null, // rule 5 is about a steward's own additions, not about viewing (decision 4)
    );
    ({ ids, truncated } = neighbourhood(kin, q.branch, Number.POSITIVE_INFINITY, FULL_VIEW_MAX, branch));
  } else if (rows.persons.length > FULL_VIEW_MAX) {
    needsBranch = true;
  } else {
    ids = live;
  }

  const { unionIds, linkIds } = visibleRelations(rows, ids);
  const hidden = withHiddenRelatives(kin, ids);
  const hasParents = new Set(rows.parentChild.map((l) => l.childId));
  const childCount = new Map<string, number>();
  for (const l of rows.parentChild) childCount.set(l.unionId, (childCount.get(l.unionId) ?? 0) + 1);

  return {
    mode: q.mode,
    focusId,
    branchId,
    total: rows.persons.length,
    truncated,
    needsBranch,
    persons: rows.persons
      .filter((p) => ids.has(p.id))
      .map((p) => ({
        ...p,
        hasParents: hasParents.has(p.id),
        hiddenRelatives: hidden.has(p.id),
        canAddRelative: can(access, 'person.add', { kind: 'relation', ends: [p.id] }),
      })),
    unions: rows.unions
      .filter((u) => unionIds.has(u.id))
      .map((u) => ({
        ...u,
        childCount: childCount.get(u.id) ?? 0,
        canEdit: can(access, 'relation.edit', { kind: 'relation', ends: partnersOf(u) }),
      })),
    links: rows.parentChild.filter((l) => linkIds.has(l.id)),
  };
}
```

- [ ] **Step 5: Implement `apps/api/src/routes/graph.ts`** (the next two tasks add more routes to this plugin):

```ts
import { graphQuerySchema } from '@family-tree/shared';
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import { idParam, parseBody } from '../errors.js';
import { TREE } from '../permissions/can.js';
import { authorize, loadAccess } from '../trees/access.js';
import { loadGraphRows } from '../trees/graph-rows.js';
import { buildTreeGraph } from '../trees/graph-view.js';
import type { TreeRouteOptions } from './trees.js';

export const graphRoutes: FastifyPluginAsync<TreeRouteOptions> = async (app, { auth, db }) => {
  app.addHook('preHandler', requireSession(auth));

  /** Everything the canvas needs in one response (spec §7). */
  app.get('/api/v1/trees/:treeId/graph', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'tree.view', TREE);
    const query = parseBody(graphQuerySchema, req.query);
    return buildTreeGraph(await loadGraphRows(db, access.treeId), access, query);
  });
};
```

  In `app.ts`, import `graphRoutes` and register it after `trashRoutes`: `app.register(graphRoutes, { auth, db, config });`.

- [ ] **Step 6: Run the integration test; it passes.** Then `pnpm --filter @family-tree/api typecheck` and `pnpm lint`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/trees/graph-rows.ts apps/api/src/trees/graph-view.ts apps/api/src/routes/graph.ts apps/api/src/routes/graph.int.test.ts apps/api/src/app.ts
git commit -m "feat(api): graph endpoint with focus, full and branch views"
```

---

## Task 6: API — disconnected people and similar people

**Files:**
- Modify: `apps/api/src/routes/graph.ts`, `apps/api/src/routes/graph.int.test.ts`

- [ ] **Step 1: Add failing tests** to `graph.int.test.ts`.

  **`describe('GET disconnected')`:**
  1. With the Task 5 fixture, the owner gets `{ persons: [Lone] }` (a `PersonSummary` shape: id, givenName, middleName, surname, birthYear, deathYear, isLiving and nothing else).
  2. After linking Lone as Sam's partner (`family(db, treeId, sam, lone)`), the list is empty.
  3. Soft-deleting Pa (`softDeleteBatch`) **disconnects** Gp and Gm (their only path was Pa), but not Ma (she is still Olive's parent). The list is Gm, Gp and Lone, in name order.
  4. A viewer gets 200, and an outsider gets 404.

  **`describe('GET persons/similar')`:**
  - **Setup:** add these people with `birthSortYear` set:
    - "Ada Lovelace" b. 1815
    - "Adah Lovelace" b. 1816
    - "Ada Lovelace" b. 1840
    - "Zoë Ångström"
    - "Ada King" with `maidenName: 'Lovelace'` b. 1815
  1. `?givenName=Ada&surname=Lovelace&birthYear=1815` returns, in order, the two exact matches (by surname: King before Lovelace), then Adah. Not the 1840 one. At most 5 results.
  2. `?givenName=zoe&surname=angstrom` finds Zoë.
  3. `?givenName=` (blank) is 400. A missing `givenName` is 400. `birthYear=abc` is 400.
  4. A viewer gets 200, and an outsider gets 404.
  5. The `/persons/similar` path doesn't collide with `GET /persons/:personId`: `GET /persons/<real id>` still works.

- [ ] **Step 2: Run them; they fail** (404).

- [ ] **Step 3: Implement.** Add to `graph.ts`:

```ts
import {
  connectedTo,
  findSimilar,
  kinIndex,
  SIMILAR_LIMIT,
  similarQuerySchema,
  type PersonSummary,
} from '@family-tree/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { persons } from '../db/schema.js';
import { summaryColumns } from '../trees/people.js';

const toSummary = ({ id, givenName, middleName, surname, birthYear, deathYear, isLiving }: PersonSummary): PersonSummary =>
  ({ id, givenName, middleName, surname, birthYear, deathYear, isLiving });
const byName = (a: PersonSummary, b: PersonSummary) =>
  (a.surname ?? '').localeCompare(b.surname ?? '') || a.givenName.localeCompare(b.givenName);

  /** Live people not reachable from the root through any relation (decision 7). */
  app.get('/api/v1/trees/:treeId/disconnected', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'tree.view', TREE);
    const rows = await loadGraphRows(db, access.treeId);
    const reached = connectedTo(kinIndex(rows), access.rootPersonId);
    return { persons: rows.persons.filter((p) => !reached.has(p.id)).map(toSummary).sort(byName) };
  });

  /** The duplicate check (decision 8). */
  app.get('/api/v1/trees/:treeId/persons/similar', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'tree.view', TREE);
    const q = parseBody(similarQuerySchema, req.query);
    const candidates = await db
      .select({ ...summaryColumns, maidenName: persons.maidenName, nickname: persons.nickname })
      .from(persons)
      .where(and(eq(persons.treeId, access.treeId), isNull(persons.deletedAt)));
    return { persons: findSimilar(candidates, q, SIMILAR_LIMIT).map(toSummary) };
  });
```

  - Fastify's router prefers the static `/persons/similar` over `/persons/:personId` across plugins, so registration order doesn't matter. Test 5 proves it.
  - Both responses match `personListSchema` (`{ persons: PersonSummary[] }`), which the web client reuses.

- [ ] **Step 4: Run the file; it passes.**

- [ ] **Step 5: Commit** `git commit -m "feat(api): disconnected people and similar-people endpoints"`.

---

## Task 7: API — reorder children, and sibling order in the person view

**Files:**
- Modify: `apps/api/src/routes/graph.ts`, `apps/api/src/routes/graph.int.test.ts`, `apps/api/src/trees/person-view.ts`, `apps/api/src/routes/persons.int.test.ts`

- [ ] **Step 1: Add failing tests.**

  **`graph.int.test.ts`, `describe('POST child-order')`.** The fixture's `uPa` has the children Olive and Sis.
  1. **Owner:** `POST /unions/<uPa>/child-order { childIds: [sis, olive] }` returns 204.
     - The `persons` rows now have `sibling_order` Sis = 1 and Olive = 2.
     - Their `version` is unchanged.
     - There is one `link.reorder` audit row with `entityType: 'union'`, `entityId: uPa`, `personIds` ⊇ {pa, ma, olive, sis}, `before: { childIds: [olive, sis] }` (the previous order by `compareSiblings`) and `after: { childIds: [sis, olive] }`.
     - `GET persons/<pa>/history` lists the entry.
  2. **Wrong set:**
     - `{ childIds: [sis, gk] }` gives 409 `CONFLICT`, and nothing changes.
     - `{ childIds: [sis] }` gives 400 (fewer than two).
     - `{ childIds: [sis, sis] }` gives 400.
  3. **Bad union:** a union of another tree, or a soft-deleted union, is 404.
  4. **Roles:**
     - A viewer gets 403.
     - A steward on Sam: `uOlive` has only one child, so add a second child with `addPerson` + an insert into `parentChild`. Then reordering `uOlive` is 204, and reordering `uPa` is 403.
     - An outsider gets 404.
  5. **The graph reflects it:** afterwards, `GET graph` shows the new `siblingOrder` values.

  **`persons.int.test.ts`:** after reordering `uPa`'s children to `[sis, olive]` through the route, `GET persons/<pa>`:
  - lists `relations.unions[0].children` as Sis then Olive;
  - lists `GET persons/<olive>` `relations.siblings` in sibling order. Add a third child, "Ann", so there is something to order.

- [ ] **Step 2: Run them; they fail.**

- [ ] **Step 3: Implement the route** in `graph.ts`:

```ts
import { childOrderSchema, compareSiblings, partnersOf } from '@family-tree/shared';
import { inArray } from 'drizzle-orm';
import { conflict, notFound } from '../errors.js';
import { audit } from '../trees/audit.js';
import { loadLiveGraph, lockTreeGraph } from '../trees/graph.js';

  /** Sets sibling_order for every live child of a union (decision 16). */
  app.post('/api/v1/trees/:treeId/unions/:unionId/child-order', async (req, reply) => {
    const treeId = idParam(req.params, 'treeId');
    await loadAccess(db, treeId, req.user!.id); // outsiders: 404 before anything else
    const unionId = idParam(req.params, 'unionId');
    const { childIds } = parseBody(childOrderSchema, req.body);
    await db.transaction(async (tx) => {
      await lockTreeGraph(tx, treeId);
      const access = await loadAccess(tx, treeId, req.user!.id);
      const graph = await loadLiveGraph(tx, treeId);
      const union = graph.unions.find((u) => u.id === unionId);
      if (!union) throw notFound();
      const current = graph.parentChild.filter((l) => l.unionId === unionId).map((l) => l.childId);
      const partners = partnersOf(union);
      authorize(access, 'relation.edit', { kind: 'relation', ends: [...partners, ...current] });
      const same = current.length === childIds.length && childIds.every((id) => current.includes(id));
      if (!same) throw conflict('The children of this relationship changed; reload and try again');
      const before = (
        await tx
          .select({
            id: persons.id,
            givenName: persons.givenName,
            siblingOrder: persons.siblingOrder,
            birthYear: persons.birthSortYear,
          })
          .from(persons)
          .where(and(eq(persons.treeId, treeId), inArray(persons.id, current)))
      )
        .sort(compareSiblings)
        .map((p) => p.id);
      // Not a person-field edit: no version bump, so nobody's open edit form goes stale.
      for (const [i, id] of childIds.entries()) {
        await tx
          .update(persons)
          .set({ siblingOrder: i + 1 })
          .where(and(eq(persons.treeId, treeId), eq(persons.id, id)));
      }
      await audit(tx, access, {
        action: 'link.reorder',
        entityType: 'union',
        entityId: unionId,
        personIds: [...partners, ...childIds],
        before: { childIds: before },
        after: { childIds },
      });
    });
    return reply.code(204).send();
  });
```

  **`trees/person-view.ts`:**
  - Load `siblingOrder` next to the summaries: select `{ ...summaryColumns, siblingOrder: persons.siblingOrder }`.
  - Build `people` (summaries, with `siblingOrder` stripped by destructuring) and `order: Map<id, number | null>` from it.
  - Sort with `compareSiblings({ ...summary, siblingOrder: order.get(id) ?? null })`:
    - each union's `children`, before mapping;
    - `siblings`.
  - The response shape is unchanged.

- [ ] **Step 4: Run** `graph.int.test.ts` and `persons.int.test.ts`. Both pass.

- [ ] **Step 5: Commit** `git commit -m "feat(api): reorder a union's children (sibling_order), sorted relations"`.

---

## Task 8: API — isolation suite and permission matrix

**Files:**
- Modify: `apps/api/src/routes/isolation.int.test.ts`, `apps/api/src/routes/people-permissions.int.test.ts`

- [ ] **Step 1: Extend the isolation suite.**
  - **`routes()`:** append these (`ids.union` already exists):

```ts
  ['GET', `/api/v1/trees/${t}/graph`],
  ['GET', `/api/v1/trees/${t}/graph?mode=full`],
  ['GET', `/api/v1/trees/${t}/graph?focus=${ids.person}&depth=2`],
  ['GET', `/api/v1/trees/${t}/disconnected`],
  ['GET', `/api/v1/trees/${t}/persons/similar?givenName=Intruder`],
  ['POST', `/api/v1/trees/${t}/unions/${ids.union}/child-order`, { childIds: [ids.person, ids.person2] }],
```

  - **`snapshot()`:** add `siblingOrder` to the `persons` projection.
  - **"Tree B authority":** add these sub-cases, each 404, with A's snapshot unchanged:
    - `GET /trees/B/graph?focus=<A person>`
    - `GET /trees/B/graph?mode=full&branch=<A person>`
    - `POST /trees/B/unions/<A union>/child-order`
  - The soft-deleted-tree and 401 tests pick the new routes up automatically.

- [ ] **Step 2: Add rows** to the `people-permissions.int.test.ts` table (Hale shape; Robert + Mary → Dan; George + Greta → Ann). For the reorder rows, give each union a second child in setup.

| Action | owner | editor | viewer | steward | dormant | editor steward |
|---|---|---|---|---|---|---|
| GET graph (full) | 200 | 200 | 200 | 200 | 200 | 200 |
| GET disconnected | 200 | 200 | 200 | 200 | 200 | 200 |
| GET persons/similar | 200 | 200 | 200 | 200 | 200 | 200 |
| child-order Robert+Mary | 204 | 204 | 403 | 204 | 403 | 204 |
| child-order George+Greta | 204 | 204 | 403 | 403 | 403 | 204 |

  Also assert, for the steward, that `GET graph?mode=full` marks Dan `canAddRelative: true` and George `false`. For the dormant steward (no 2FA), both are `false`.

- [ ] **Step 3: Run both files.** Fix any route that answers differently, unless the table contradicts spec §4; if so, stop and ask.

- [ ] **Step 4: Commit** `git commit -m "test(api): isolation and permission matrix for graph, disconnected, similar, child order"`.

---

## Task 9: API — a large sample tree for development

**Files:**
- Modify: `apps/api/src/db/seed.ts`, `apps/api/src/db/seed-cli.ts`, `apps/api/src/db/seed.int.test.ts`

- [ ] **Step 1: Write the failing test** in `seed.int.test.ts`. `seedLargeFamily(db, { people: 120 })` creates a tree named "Large family (seed)" with:
  - exactly 120 live persons;
  - a root;
  - everyone connected to the root: `connectedTo(kinIndex(await loadLiveGraph(db, treeId)), root).size` is 120.

  Calling it twice replaces the tree, as the sample seed does.

- [ ] **Step 2: Implement** `seedLargeFamily` in `seed.ts`:

```ts
export const LARGE_SEED_TREE_NAME = 'Large family (seed)';
const GIVEN = ['Ada', 'Ben', 'Cara', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jun', 'Kai', 'Lea'];
const SURNAMES = ['Hale', 'Moss', 'Reyes', 'Okafor', 'Novak', 'Sato', 'Lund', 'Price'];

/**
 * A deterministic family of `people` persons for performance checks (decision 19): one founding
 * couple, then each person in turn gets a partner (a new person) and 2–3 children, breadth
 * first, until the count is reached.
 */
export async function seedLargeFamily(
  db: Db,
  { ownerUserId, people }: { ownerUserId?: string; people: number },
): Promise<{ treeId: string; rootPersonId: string }> {
  return db.transaction(async (tx) => {
    await tx.delete(trees).where(eq(trees.name, LARGE_SEED_TREE_NAME));
    const [tree] = await tx.insert(trees).values({ name: LARGE_SEED_TREE_NAME }).returning();
    const treeId = tree!.id;
    const ps: (typeof persons.$inferInsert)[] = [];
    const us: (typeof unions.$inferInsert)[] = [];
    const pcs: (typeof parentChild.$inferInsert)[] = [];
    const add = (gen: number, surname: string) => {
      const i = ps.length;
      const birth = { qualifier: 'exact' as const, date1: String(1850 + gen * 28 + (i % 7)) };
      ps.push({
        id: crypto.randomUUID(),
        treeId,
        givenName: GIVEN[i % GIVEN.length]!,
        surname,
        birthDate: birth,
        birthSortYear: sortYear(birth),
        isLiving: gen > 3,
        ...(ownerUserId ? { createdBy: ownerUserId } : {}),
      });
      return { id: ps[i]!.id!, gen, surname };
    };
    const first = add(0, SURNAMES[0]!);
    const queue = [first];
    while (ps.length < people && queue.length > 0) {
      const p = queue.shift()!;
      const partner = add(p.gen, SURNAMES[ps.length % SURNAMES.length]!);
      const unionId = crypto.randomUUID();
      us.push({ id: unionId, treeId, partnerAId: p.id, partnerBId: partner.id });
      for (let k = 0; k < 2 + (ps.length % 2) && ps.length < people; k++) {
        const child = add(p.gen + 1, p.surname);
        pcs.push({ treeId, unionId, childId: child.id });
        queue.push(child);
      }
    }
    // Chunks keep each INSERT well under Postgres's 65,535-parameter limit.
    for (let i = 0; i < ps.length; i += 1000) await tx.insert(persons).values(ps.slice(i, i + 1000));
    for (let i = 0; i < us.length; i += 1000) await tx.insert(unions).values(us.slice(i, i + 1000));
    for (let i = 0; i < pcs.length; i += 1000) await tx.insert(parentChild).values(pcs.slice(i, i + 1000));
    await tx.update(trees).set({ rootPersonId: first.id }).where(eq(trees.id, treeId));
    if (ownerUserId) {
      await tx.insert(treeMembers).values({ treeId, userId: ownerUserId, role: 'owner', personId: first.id });
    }
    return { treeId, rootPersonId: first.id };
  });
}
```

  The `while` condition guards the partner and the inner loop guards each child, so exactly `people` rows are created. The last couple may have no children.

  **`seed-cli.ts`:** accept `pnpm seed [email] [--large N]`.
  - Parse `--large` and its number (100–10,000, otherwise print usage and exit 1).
  - Run `seedLargeFamily` **in addition to** the sample family, and print `Seeded "Large family (seed)" (tree <id>) with N people`.
  - The usage text becomes `Usage: pnpm seed [you@example.com] [--large N]`.

- [ ] **Step 3: Run** `seed.int.test.ts`; it passes. By hand (with the dev stack up), run `pnpm seed --large 2500` once and check that it finishes in a few seconds.

- [ ] **Step 4: Commit** `git commit -m "feat(api): large sample tree seed for canvas performance checks"`.

---
## Task 10: Web — API client, fake, messages, fake layout engine and React Flow test mocks

**Files:**
- Modify: `apps/web/src/trees/api.ts`, `apps/web/src/trees/api.test.ts`, `apps/web/src/test/fake-trees.ts`, `apps/web/src/test/fake-trees.test.ts`, `apps/web/src/auth/api.ts` (MESSAGES), `apps/web/src/test/setup.ts`, `apps/web/src/test/render.tsx`
- Create: `apps/web/src/test/fake-layout.ts`, `apps/web/src/canvas/layout-engine.ts` (the interface only; Task 12 adds the worker engine), `apps/web/src/canvas/LayoutEngineContext.tsx`

- [ ] **Step 1: Write the failing tests** in `trees/api.test.ts` (stub `fetch` as the existing tests do):
  1. **Graph:** `getGraph(t, { mode: 'focus', focus: p, depth: 2 })` GETs `/api/v1/trees/t/graph?mode=focus&focus=p&depth=2` and returns the parsed `TreeGraph`. `getGraph(t, { mode: 'full' })` GETs `…/graph?mode=full`.
  2. **Disconnected:** `listDisconnected(t)` GETs `/api/v1/trees/t/disconnected` and returns the `persons` array.
  3. **Similar:** `findSimilar(t, { givenName: 'Ada', surname: undefined, birthYear: 1815 })` GETs `/api/v1/trees/t/persons/similar?givenName=Ada&birthYear=1815`. Undefined and blank values are left out.
  4. **Reorder:** `reorderChildren(t, u, [a, b])` POSTs `{ childIds: [a, b] }` to `…/unions/u/child-order`. A 409 gives `MESSAGES.itemChanged`.
  5. **Unexpected bodies:** a graph body that doesn't match the schema gives the generic error.

  In `fake-trees.test.ts`:
  - `getGraph` without a seeded graph returns every person of the tree, no unions, and `canAddRelative` equal to `capabilities.editAnywhere`.
  - `findSimilar` finds "Ada Lovelace" for `{ givenName: 'ada' }`.
  - `reorderChildren` updates `siblingOrder` in a seeded graph.

- [ ] **Step 2: Run them; they fail.**

- [ ] **Step 3: Implement.**

  **`auth/api.ts` `MESSAGES`:** add

```ts
  layoutFailed: 'The tree couldn’t be drawn. Try the focus view, or reload the page.',
```

  **`trees/api.ts`:** add these to `TreesApi`, to `TREES_API_METHODS` and to `createTreesApi`:

```ts
  getGraph(treeId: string, query: GraphQuery): Promise<Result<TreeGraph>>;
  listDisconnected(treeId: string): Promise<Result<PersonSummary[]>>;
  findSimilar(treeId: string, query: SimilarQuery): Promise<Result<PersonSummary[]>>;
  reorderChildren(treeId: string, unionId: string, childIds: string[]): Promise<Result<void>>;
```

```ts
/** `?a=1&b=2`, leaving out undefined and blank values; '' when nothing is left. */
function qs(q: Record<string, string | number | undefined>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
}

    // inside createTreesApi:
    getGraph: (id, query) => request('GET', `${t(id)}/graph${qs(query)}`, undefined, treeGraphSchema),
    listDisconnected: (id) =>
      map(request('GET', `${t(id)}/disconnected`, undefined, personListSchema), (d) => d.persons),
    findSimilar: (id, query) =>
      map(
        request('GET', `${t(id)}/persons/similar${qs(query)}`, undefined, personListSchema),
        (d) => d.persons,
      ),
    reorderChildren: (id, u, childIds) =>
      request('POST', `${t(id)}/unions/${enc(u)}/child-order`, { childIds }, undefined, 'session', {
        CONFLICT: MESSAGES.itemChanged,
      }),
```

  **`test/fake-trees.ts`:**
  - **`FakeTree` gains:** `graph?: TreeGraph` and `disconnected: PersonSummary[]` (initialised to `[]` in `addTree`).
  - **New exported helpers:**
    - `fakeGraphPerson(summary, partial?)`: `sex: 'unknown'`, `siblingOrder: null`, `hasParents: false`, `hiddenRelatives: false`, `canAddRelative: true`.
    - `fakeGraph(persons: GraphPerson[], partial?: Partial<TreeGraph>)`: `mode: 'focus'`, `focusId: persons[0]?.id ?? null`, `branchId: null`, no unions or links, `total: persons.length`, `truncated: false`, `needsBranch: false`.
  - **Methods** (each through `enter()`, so `failNext`, `hold` and `callsTo` work):
    - **`getGraph(treeId, query)`:**
      - records `{ treeId, query }`;
      - returns `t.graph` when set;
      - otherwise returns `fakeGraph(t.persons.map((p) => fakeGraphPerson(p, { canAddRelative: t.detail.capabilities.editAnywhere })), { mode: query.mode ?? 'focus', focusId: query.mode === 'full' ? null : (query.focus ?? t.detail.tree.rootPersonId) })`;
      - an unknown tree gives `NOT_FOUND`.
    - **`listDisconnected`:** returns `t.disconnected`.
    - **`findSimilar`:** runs the shared `findSimilar` over `t.persons` (with `maidenName` and `nickname` null) with `SIMILAR_LIMIT`.
    - **`reorderChildren(treeId, unionId, childIds)`:** sets `siblingOrder = index + 1` on those people in `t.graph` (when seeded), and reorders the union's `children` in every `t.people` view that has it.

  **`canvas/layout-engine.ts`** (interface for now):

```ts
import type { ElkNode } from 'elkjs/lib/elk-api.js';

/** Lays out an ELK graph. The browser uses ELK in a Web Worker; tests inject a fake. */
export interface LayoutEngine {
  layout(graph: ElkNode): Promise<ElkNode>;
}
```

  **`canvas/LayoutEngineContext.tsx`:**

```tsx
import { createContext, type ReactNode, useContext } from 'react';
import type { LayoutEngine } from './layout-engine';

const Ctx = createContext<LayoutEngine | null>(null);

export function LayoutEngineProvider({ engine, children }: { engine: LayoutEngine; children: ReactNode }) {
  return <Ctx.Provider value={engine}>{children}</Ctx.Provider>;
}

export function useLayoutEngine(): LayoutEngine {
  const engine = useContext(Ctx);
  if (!engine) throw new Error('useLayoutEngine must be used inside <LayoutEngineProvider>');
  return engine;
}
```

  **`test/fake-layout.ts`:**

```ts
import type { ElkNode } from 'elkjs/lib/elk-api.js';
import type { LayoutEngine } from '../canvas/layout-engine';

/** Places nodes on a grid in input order. `failNext()` makes the next layout reject. */
export class FakeLayoutEngine implements LayoutEngine {
  calls: ElkNode[] = [];
  private failing = false;
  failNext() {
    this.failing = true;
  }
  async layout(graph: ElkNode): Promise<ElkNode> {
    this.calls.push(graph);
    if (this.failing) {
      this.failing = false;
      throw new Error('layout failed');
    }
    return {
      ...graph,
      children: (graph.children ?? []).map((c, i) => ({ ...c, x: (i % 8) * 220, y: Math.floor(i / 8) * 140 })),
    };
  }
}
```

  **`test/render.tsx`:** accept `layout = new FakeLayoutEngine()` and wrap `<AppRoutes />` in `<LayoutEngineProvider engine={layout}>`. Return `layout` with the other utilities.

  **`test/setup.ts`:** append the React Flow jsdom mocks:

```ts
// React Flow measures with ResizeObserver and reads DOMMatrixReadOnly; jsdom has neither.
// (Pattern from the React Flow testing guide.) Real drawing is checked in the browser walk-through.
class ResizeObserverMock {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(target: Element) {
    this.cb(
      [{ target, contentRect: { width: 1000, height: 800 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}
class DOMMatrixReadOnlyMock {
  m22: number;
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
    this.m22 = scale === undefined ? 1 : Number(scale);
  }
}
globalThis.ResizeObserver ??= ResizeObserverMock as unknown as typeof ResizeObserver;
globalThis.DOMMatrixReadOnly ??= DOMMatrixReadOnlyMock as unknown as typeof DOMMatrixReadOnly;
Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: {
    configurable: true,
    get(this: HTMLElement) {
      return parseFloat(this.style.height) || 1;
    },
  },
  offsetWidth: {
    configurable: true,
    get(this: HTMLElement) {
      return parseFloat(this.style.width) || 1;
    },
  },
});
(SVGElement.prototype as unknown as { getBBox(): DOMRect }).getBBox = () =>
  ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;
```

- [ ] **Step 4: Run** `pnpm --filter @family-tree/web test` and `pnpm typecheck`. Everything passes; existing tests are unaffected.

- [ ] **Step 5: Commit** `git commit -m "feat(web): TreesApi graph, disconnected, similar and child-order; layout engine seam; React Flow test mocks"`.

---

## Task 11: Web — generations and graph → nodes/edges mapping (pure)

**Files:**
- Create: `apps/web/src/canvas/test-fixtures.ts`, `apps/web/src/canvas/graph-to-flow.ts`, `apps/web/src/canvas/graph-to-flow.test.ts`, `apps/web/src/canvas/generations.ts`, `apps/web/src/canvas/generations.test.ts`

This is spec §9's "graph-to-layout transformation" unit test.

- [ ] **Step 1: Write the fixture** `canvas/test-fixtures.ts`. It is the seed family: Robert + Margaret (widowed) → David, Susan; David + Anna (divorced) → Emma; David + Laura → Leo, Mia (adoptive); Susan + unknown → Noah.

```ts
import type { GraphLinkView, GraphPerson, GraphUnionView, TreeGraph } from '@family-tree/shared';

export function gp(id: string, givenName: string, birthYear: number | null, extra: Partial<GraphPerson> = {}): GraphPerson {
  return {
    id, givenName, middleName: null, surname: 'Hale', birthYear, deathYear: null, isLiving: true,
    sex: 'unknown', siblingOrder: null, hasParents: false, hiddenRelatives: false, canAddRelative: true,
    ...extra,
  };
}
export function gu(id: string, a: string | null, b: string | null, extra: Partial<GraphUnionView> = {}): GraphUnionView {
  return {
    id, partnerAId: a, partnerBId: b, type: 'marriage', status: 'married', startDate: null, endDate: null,
    childCount: 0, canEdit: true, ...extra,
  };
}
const gl = (id: string, unionId: string, childId: string, kind: GraphLinkView['kind'] = 'biological'): GraphLinkView =>
  ({ id, unionId, childId, kind });

export function haleGraph(o: { leoOrder?: number; miaOrder?: number } = {}): TreeGraph {
  const persons = [
    gp('robert', 'Robert', 1930, { deathYear: 1998, isLiving: false }),
    gp('margaret', 'Margaret', 1932),
    gp('david', 'David', 1956, { hasParents: true }),
    gp('susan', 'Susan', 1959, { hasParents: true }),
    gp('anna', 'Anna', 1958, { surname: 'Berg' }),
    gp('laura', 'Laura', 1965, { surname: 'Chen' }),
    gp('emma', 'Emma', 1985, { hasParents: true }),
    gp('leo', 'Leo', 1994, { hasParents: true, siblingOrder: o.leoOrder ?? null }),
    gp('mia', 'Mia', 1996, { hasParents: true, siblingOrder: o.miaOrder ?? null }),
    gp('noah', 'Noah', 1990, { hasParents: true }),
  ];
  return {
    mode: 'full', focusId: null, branchId: null, total: persons.length, truncated: false, needsBranch: false,
    persons,
    unions: [
      gu('u-rm', 'robert', 'margaret', { status: 'widowed', childCount: 2 }),
      gu('u-da', 'david', 'anna', { status: 'divorced', childCount: 1 }),
      gu('u-dl', 'david', 'laura', { childCount: 2 }),
      gu('u-s', 'susan', null, { type: 'partnership', status: 'partners', childCount: 1 }),
    ],
    links: [
      gl('l-david', 'u-rm', 'david'), gl('l-susan', 'u-rm', 'susan'), gl('l-emma', 'u-da', 'emma'),
      gl('l-leo', 'u-dl', 'leo'), gl('l-mia', 'u-dl', 'mia', 'adoptive'), gl('l-noah', 'u-s', 'noah'),
    ],
  };
}
```

- [ ] **Step 2: Write the failing tests.**

  **`canvas/graph-to-flow.test.ts`:**

```ts
import { describe, expect, it } from 'vitest';
import { CARD_HEIGHT, CARD_WIDTH, graphToFlow, UNION_SIZE } from './graph-to-flow';
import { gp, gu, haleGraph } from './test-fixtures';

const ctx = { focusId: 'leo', meId: 'emma' };

describe('graphToFlow', () => {
  it('makes one card per person and one dot per drawn union, with fixed sizes', () => {
    const { nodes } = graphToFlow(haleGraph(), ctx);
    expect(nodes.filter((n) => n.type === 'person')).toHaveLength(10);
    expect(nodes.filter((n) => n.type === 'union').map((n) => n.id).sort()).toEqual(
      ['u:u-da', 'u:u-dl', 'u:u-rm', 'u:u-s'],
    );
    const card = nodes.find((n) => n.id === 'p:robert')!;
    expect([card.width, card.height]).toEqual([CARD_WIDTH, CARD_HEIGHT]);
    expect(nodes.find((n) => n.id === 'u:u-rm')!.width).toBe(UNION_SIZE);
  });

  it('links partners into the union and the union down to each child, styled by kind and status', () => {
    const { edges } = graphToFlow(haleGraph(), ctx);
    const e = (id: string) => edges.find((x) => x.id === id)!;
    expect(e('partner:u-rm:robert')).toMatchObject({ source: 'p:robert', target: 'u:u-rm', className: 'edge-partner' });
    expect(e('child:l-mia')).toMatchObject({ source: 'u:u-dl', target: 'p:mia', className: 'edge-child edge-adoptive' });
    expect(e('child:l-leo').className).toBe('edge-child edge-biological');
    expect(e('partner:u-da:anna').className).toBe('edge-partner edge-ended');
    expect(edges.filter((x) => x.source === 'p:susan')).toHaveLength(1); // single-parent union
  });

  it('labels union dots and marks ended ones', () => {
    const { nodes } = graphToFlow(haleGraph(), ctx);
    const rm = nodes.find((n) => n.id === 'u:u-rm')!;
    expect(rm.data).toMatchObject({ ended: false, label: 'Relationship of Robert Hale and Margaret Hale (Widowed)' });
    expect(nodes.find((n) => n.id === 'u:u-da')!.data).toMatchObject({ ended: true });
  });

  it('skips a union whose only shown partner has no shown children, and names a hidden partner', () => {
    const lone = { ...haleGraph(), persons: [gp('robert', 'Robert', 1930)], links: [] };
    expect(graphToFlow(lone, ctx).nodes.some((n) => n.type === 'union')).toBe(false);
    const half = {
      ...haleGraph(),
      persons: [gp('robert', 'Robert', 1930), gp('david', 'David', 1956)],
      unions: [gu('u-rm', 'robert', 'margaret')],
      links: [{ id: 'l-david', unionId: 'u-rm', childId: 'david', kind: 'biological' as const }],
    };
    const flow = graphToFlow(half, ctx);
    expect(flow.nodes.find((n) => n.id === 'u:u-rm')!.data).toMatchObject({
      label: 'Relationship of Robert Hale and someone not shown (Married)',
    });
    expect(flow.edges.filter((x) => x.target === 'u:u-rm')).toHaveLength(1);
  });

  it('lists families with children in sibling order', () => {
    expect(graphToFlow(haleGraph(), ctx).families.find((f) => f.id === 'u-dl')).toEqual({
      id: 'u-dl', partnerIds: ['david', 'laura'], childIds: ['leo', 'mia'],
    });
    expect(graphToFlow(haleGraph({ leoOrder: 2, miaOrder: 1 }), ctx).families.find((f) => f.id === 'u-dl')!.childIds)
      .toEqual(['mia', 'leo']);
  });

  it('flags the focus person and the user', () => {
    const { nodes } = graphToFlow(haleGraph(), ctx);
    expect(nodes.find((n) => n.id === 'p:leo')!.data).toMatchObject({ isFocus: true, isMe: false });
    expect(nodes.find((n) => n.id === 'p:emma')!.data).toMatchObject({ isFocus: false, isMe: true });
  });
});
```

  **`canvas/generations.test.ts`:**

```ts
import { describe, expect, it } from 'vitest';
import { assignGenerations } from './generations';
import { graphToFlow } from './graph-to-flow';
import { haleGraph } from './test-fixtures';

describe('assignGenerations', () => {
  it('puts partners in one row and children one row below (in-laws join their partner)', () => {
    const gens = assignGenerations(graphToFlow(haleGraph(), { focusId: null, meId: null }))!;
    expect(Object.fromEntries(gens)).toEqual({
      robert: 0, margaret: 0,
      david: 1, susan: 1, anna: 1, laura: 1,
      emma: 2, leo: 2, mia: 2, noah: 2,
    });
  });

  it('pulls a lone parent down to just above their child', () => {
    // A -> B -> C; C + E; W -> E. W has no parents and would otherwise sit in row 0.
    const gens = assignGenerations({
      personIds: ['a', 'b', 'c', 'e', 'w'],
      families: [
        { id: 'f1', partnerIds: ['a'], childIds: ['b'] },
        { id: 'f2', partnerIds: ['b'], childIds: ['c'] },
        { id: 'f3', partnerIds: ['c', 'e'], childIds: [] },
        { id: 'f4', partnerIds: ['w'], childIds: ['e'] },
      ],
    })!;
    expect(Object.fromEntries(gens)).toEqual({ a: 0, b: 1, c: 2, e: 2, w: 1 });
  });

  it('gives up (null) when rows cannot be consistent', () => {
    // X + Y -> Z, and Z is also X's partner: Z would be in its own parents' row.
    expect(
      assignGenerations({
        personIds: ['x', 'y', 'z'],
        families: [
          { id: 'f1', partnerIds: ['x', 'y'], childIds: ['z'] },
          { id: 'f2', partnerIds: ['x', 'z'], childIds: [] },
        ],
      }),
    ).toBeNull();
  });

  it('handles people with no relations and an empty graph', () => {
    expect(Object.fromEntries(assignGenerations({ personIds: ['a'], families: [] })!)).toEqual({ a: 0 });
    expect(assignGenerations({ personIds: [], families: [] })!.size).toBe(0);
  });
});
```

- [ ] **Step 3: Run them; they fail.**

- [ ] **Step 4: Implement** `canvas/graph-to-flow.ts`:

```ts
import { compareSiblings, type GraphPerson, type GraphUnionView, type TreeGraph } from '@family-tree/shared';
import type { Edge, Node } from '@xyflow/react';
import { personName, UNION_STATUS_LABEL } from '../trees/format';

export const CARD_WIDTH = 184;
export const CARD_HEIGHT = 88;
export const UNION_SIZE = 14;

export type PersonNodeData = {
  person: GraphPerson;
  isFocus: boolean;
  isMe: boolean;
  /** The union whose children this card can be dragged among (Task 17); null when fixed. */
  reorderUnionId: string | null;
};
export type PersonFlowNode = Node<PersonNodeData, 'person'>;
export type UnionNodeData = { union: GraphUnionView; ended: boolean; label: string };
export type UnionFlowNode = Node<UnionNodeData, 'union'>;
export type CanvasNode = PersonFlowNode | UnionFlowNode;
/** A drawn union: its shown partners, and its shown children in sibling order. */
export interface Family {
  id: string;
  partnerIds: string[];
  childIds: string[];
}
export interface Flow {
  nodes: CanvasNode[];
  edges: Edge[];
  families: Family[];
  personIds: string[];
}

export const personNodeId = (id: string) => `p:${id}`;
export const unionNodeId = (id: string) => `u:${id}`;
const ENDED = new Set<string>(['divorced', 'separated']);

/** People and unions -> React Flow nodes and edges, with unions as their own small nodes (spec §6). */
export function graphToFlow(
  graph: TreeGraph,
  { focusId, meId }: { focusId: string | null; meId: string | null },
): Flow {
  const byId = new Map(graph.persons.map((p) => [p.id, p]));
  const persons = [...graph.persons].sort(compareSiblings);
  const nodes: CanvasNode[] = persons.map((person) => ({
    id: personNodeId(person.id),
    type: 'person',
    position: { x: 0, y: 0 },
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    draggable: false,
    data: { person, isFocus: person.id === focusId, isMe: person.id === meId, reorderUnionId: null },
  }));
  const edges: Edge[] = [];
  const families: Family[] = [];
  for (const u of graph.unions) {
    const partnerIds = [u.partnerAId, u.partnerBId].filter(
      (id): id is string => id !== null && byId.has(id),
    );
    const children = graph.links
      .filter((l) => l.unionId === u.id && byId.has(l.childId))
      .sort((a, b) => compareSiblings(byId.get(a.childId)!, byId.get(b.childId)!));
    if (partnerIds.length === 0 || (partnerIds.length < 2 && children.length === 0)) continue;
    const ended = ENDED.has(u.status);
    const names = partnerIds.map((id) => personName(byId.get(id)!));
    if (names.length === 1 && u.partnerAId !== null && u.partnerBId !== null) {
      names.push('someone not shown');
    }
    nodes.push({
      id: unionNodeId(u.id),
      type: 'union',
      position: { x: 0, y: 0 },
      width: UNION_SIZE,
      height: UNION_SIZE,
      draggable: false,
      data: { union: u, ended, label: `Relationship of ${names.join(' and ')} (${UNION_STATUS_LABEL[u.status]})` },
    });
    for (const p of partnerIds) {
      edges.push({
        id: `partner:${u.id}:${p}`,
        source: personNodeId(p),
        target: unionNodeId(u.id),
        type: 'smoothstep',
        className: ended ? 'edge-partner edge-ended' : 'edge-partner',
        selectable: false,
        focusable: false,
      });
    }
    for (const l of children) {
      edges.push({
        id: `child:${l.id}`,
        source: unionNodeId(u.id),
        target: personNodeId(l.childId),
        type: 'smoothstep',
        className: `edge-child edge-${l.kind}`,
        selectable: false,
        focusable: false,
      });
    }
    families.push({ id: u.id, partnerIds, childIds: children.map((l) => l.childId) });
  }
  return { nodes, edges, families, personIds: persons.map((p) => p.id) };
}
```

  **`canvas/generations.ts`:**

```ts
import type { Family } from './graph-to-flow';

export interface GenerationInput {
  personIds: readonly string[];
  families: readonly Family[];
}

/**
 * A row per generation (decision 13): partners share a row, children sit one row below their
 * parents, and each couple is packed as low as possible (just above its highest child).
 * Returns null when no consistent rows exist (someone would be in their own parents' row).
 */
export function assignGenerations({ personIds, families }: GenerationInput): Map<string, number> | null {
  if (personIds.length === 0) return new Map();
  // 1. Couples: everyone joined by a union shares one group (union-find).
  const parent = new Map(personIds.map((id) => [id, id]));
  const find = (x: string): string => {
    const p = parent.get(x)!;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  for (const f of families) {
    for (const p of f.partnerIds.slice(1)) parent.set(find(p), find(f.partnerIds[0]!));
  }
  // 2. Group edges: a family's couple sits above each of its children's groups.
  const below = new Map<string, Set<string>>();
  const above = new Map<string, Set<string>>();
  const link = (m: Map<string, Set<string>>, k: string, v: string) => {
    let s = m.get(k);
    if (!s) m.set(k, (s = new Set()));
    s.add(v);
  };
  for (const f of families) {
    if (f.partnerIds.length === 0) continue;
    const g = find(f.partnerIds[0]!);
    for (const c of f.childIds) {
      const h = find(c);
      if (h === g) return null;
      link(below, g, h);
      link(above, h, g);
    }
  }
  // 3. Topological order (Kahn); leftovers mean a cycle.
  const groups = [...new Set(personIds.map(find))];
  const waiting = new Map(groups.map((g) => [g, above.get(g)?.size ?? 0]));
  const order: string[] = [];
  const queue = groups.filter((g) => waiting.get(g) === 0);
  for (let g = queue.shift(); g !== undefined; g = queue.shift()) {
    order.push(g);
    for (const h of below.get(g) ?? []) {
      const n = waiting.get(h)! - 1;
      waiting.set(h, n);
      if (n === 0) queue.push(h);
    }
  }
  if (order.length !== groups.length) return null;
  // 4. Longest path from the top, then pull each group down to just above its highest child.
  const gen = new Map<string, number>();
  for (const g of order) {
    gen.set(g, Math.max(0, ...[...(above.get(g) ?? [])].map((p) => gen.get(p)! + 1)));
  }
  for (const g of [...order].reverse()) {
    const kids = [...(below.get(g) ?? [])];
    if (kids.length > 0) gen.set(g, Math.min(...kids.map((k) => gen.get(k)!)) - 1);
  }
  const top = Math.min(...gen.values());
  return new Map(personIds.map((id) => [id, gen.get(find(id))! - top]));
}
```

  `Flow` has `personIds` and `families`, so `assignGenerations(flow)` works directly.

- [ ] **Step 5: Run both tests; they pass.**
  `pnpm --filter @family-tree/web exec vitest run src/canvas/graph-to-flow.test.ts src/canvas/generations.test.ts`

- [ ] **Step 6: Commit** `git commit -m "feat(web): graph to nodes and edges with union nodes; generation rows"`.

---

## Task 12: Web — ELK input/output, the worker layout engine, a real-ELK layout test

**Files:**
- Create: `apps/web/src/canvas/elk-graph.ts`, `apps/web/src/canvas/elk-graph.test.ts`, `apps/web/src/canvas/layout.test.ts`
- Modify: `apps/web/src/canvas/layout-engine.ts`, `apps/web/src/App.tsx`

- [ ] **Step 1: Write the failing tests.**

  **`canvas/elk-graph.test.ts`** (pure, jsdom is fine):
  1. **Input:** `toElkGraph(flow, gens)` for `haleGraph()`:
     - The root has `'elk.algorithm': 'layered'`, `'elk.direction': 'DOWN'` and `'elk.partitioning.activate': 'true'`.
     - `p:robert` has partition `'0'`, `u:u-rm` has `'1'`, `p:david` and `p:anna` have `'2'`, `u:u-dl` has `'3'`, and `p:leo` has `'4'`.
     - Each child has `width` and `height` from the node.
     - Each edge is `{ id, sources: [source], targets: [target] }`.
  2. **No rows:** with `gens === null`, there is no `elk.partitioning.activate` and no per-node partitions.
  3. **Output:** `applyElkLayout(nodes, { id: 'root', children: [{ id: 'p:robert', x: 10, y: 20 }] })` sets Robert's position to `{ x: 10, y: 20 }` and leaves the others unchanged.

  **`canvas/layout.test.ts`** (real ELK, in Node):

```ts
// @vitest-environment node
import type { TreeGraph } from '@family-tree/shared';
import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, it } from 'vitest';
import { applyElkLayout, toElkGraph } from './elk-graph';
import { assignGenerations } from './generations';
import { CARD_WIDTH, graphToFlow } from './graph-to-flow';
import { haleGraph } from './test-fixtures';

async function layout(graph: TreeGraph) {
  const flow = graphToFlow(graph, { focusId: null, meId: null });
  const laid = await new ELK().layout(toElkGraph(flow, assignGenerations(flow)));
  const nodes = applyElkLayout(flow.nodes, laid);
  return new Map(nodes.map((n) => [n.id.slice(2), n.position]));
}

describe('ELK layered layout of the seed family', () => {
  it('puts each generation in its own row, in-laws with their partner', async () => {
    const pos = await layout(haleGraph());
    const y = (id: string) => pos.get(id)!.y;
    expect(y('margaret')).toBe(y('robert'));
    for (const id of ['susan', 'anna', 'laura']) expect(y(id)).toBe(y('david'));
    for (const id of ['emma', 'mia', 'noah']) expect(y(id)).toBe(y('leo'));
    expect(y('robert')).toBeLessThan(y('david'));
    expect(y('david')).toBeLessThan(y('leo'));
  });

  it('places each union dot between its partners, below them', async () => {
    const pos = await layout(haleGraph());
    const between = (u: string, a: string, b: string) => {
      const [l, r] = [pos.get(a)!.x, pos.get(b)!.x].sort((m, n) => m - n);
      expect(pos.get(u)!.x).toBeGreaterThanOrEqual(l!);
      expect(pos.get(u)!.x).toBeLessThanOrEqual(r! + CARD_WIDTH);
      expect(pos.get(u)!.y).toBeGreaterThan(pos.get(a)!.y);
    };
    between('u-rm', 'robert', 'margaret');
    between('u-da', 'david', 'anna');
    between('u-dl', 'david', 'laura');
  });

  it('seats a person with two partners between them (spec §6)', async () => {
    const pos = await layout(haleGraph());
    const [a, d, l] = ['anna', 'david', 'laura'].map((id) => pos.get(id)!.x);
    expect((a! < d! && d! < l!) || (l! < d! && d! < a!)).toBe(true);
  });

  it('orders siblings left to right by sibling order', async () => {
    const a = await layout(haleGraph({ leoOrder: 1, miaOrder: 2 }));
    expect(a.get('leo')!.x).toBeLessThan(a.get('mia')!.x);
    const b = await layout(haleGraph({ leoOrder: 2, miaOrder: 1 }));
    expect(b.get('mia')!.x).toBeLessThan(b.get('leo')!.x);
  });
});
```

- [ ] **Step 2: Run them; they fail** (missing module).

- [ ] **Step 3: Implement** `canvas/elk-graph.ts`:

```ts
import type { ElkNode } from 'elkjs/lib/elk-api.js';
import type { CanvasNode, Flow } from './graph-to-flow';

/** ELK layered, top to bottom, generations as partitions (decision 13). */
export const ELK_LAYOUT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  // Model order (sibling_order) breaks ties; crossings still come first.
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.considerModelOrder.crossingCounterNodeInfluence': '0.001',
  'elk.spacing.nodeNode': '32',
  'elk.layered.spacing.nodeNodeBetweenLayers': '28',
  'elk.spacing.componentComponent': '72',
  'elk.separateConnectedComponents': 'true',
};

export function toElkGraph(flow: Flow, generations: ReadonlyMap<string, number> | null): ElkNode {
  const partition = (n: CanvasNode): number | undefined => {
    if (!generations) return undefined;
    if (n.type === 'person') return 2 * (generations.get(n.data.person.id) ?? 0);
    const rows = [n.data.union.partnerAId, n.data.union.partnerBId]
      .map((id) => (id === null ? undefined : generations.get(id)))
      .filter((g): g is number => g !== undefined);
    return 2 * Math.min(...rows) + 1;
  };
  return {
    id: 'root',
    layoutOptions: {
      ...ELK_LAYOUT_OPTIONS,
      ...(generations ? { 'elk.partitioning.activate': 'true' } : {}),
    },
    children: flow.nodes.map((n) => {
      const p = partition(n);
      return {
        id: n.id,
        width: n.width,
        height: n.height,
        ...(p === undefined ? {} : { layoutOptions: { 'elk.partitioning.partition': String(p) } }),
      };
    }),
    edges: flow.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
}

/** Copies ELK's positions onto the React Flow nodes. */
export function applyElkLayout(nodes: CanvasNode[], laidOut: ElkNode): CanvasNode[] {
  const pos = new Map((laidOut.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
  return nodes.map((n) => {
    const p = pos.get(n.id);
    return p ? { ...n, position: p } : n;
  });
}
```

  Union dots always have a shown partner (`graphToFlow` guarantees it), so `Math.min` gets at least one value.

  **If `layout.test.ts` fails**, tune `ELK_LAYOUT_OPTIONS` (the tests are the spec for the configuration), and record what changed in the commit message. Things to try:
  - `'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP'` with `'elk.layered.thoroughness': '20'`;
  - `'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF'`;
  - `'elk.layered.nodePlacement.favorStraightEdges': 'false'`.

  Don't weaken an assertion without asking.

  **`canvas/layout-engine.ts`:** add the browser engine.

```ts
import type { ELK, ElkNode } from 'elkjs/lib/elk-api.js';

export interface LayoutEngine {
  layout(graph: ElkNode): Promise<ElkNode>;
}
export const LAYOUT_TIMEOUT_MS = 15_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('layout timed out')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const inThread = async (): Promise<ELK> => {
  const { default: Elk } = await import('elkjs/lib/elk.bundled.js');
  return new Elk();
};

/**
 * ELK in a Web Worker (decision 4), loaded on first use so the 1.6 MB worker stays out of the
 * main bundle. If the worker can't start at all (blocked or missing), falls back once to ELK on
 * the main thread. A timeout after the worker has worked is just an error.
 */
export function createWorkerLayoutEngine(): LayoutEngine {
  let elk: Promise<ELK> | null = null;
  let workerWorked = false;
  let fellBack = false;
  const start = async (): Promise<ELK> => {
    try {
      const [{ default: Elk }, { default: workerUrl }] = await Promise.all([
        import('elkjs/lib/elk-api.js'),
        import('elkjs/lib/elk-worker.min.js?url'),
      ]);
      return new Elk({ workerUrl });
    } catch {
      fellBack = true;
      return inThread();
    }
  };
  return {
    async layout(graph) {
      elk ??= start();
      const engine = await elk;
      try {
        const out = await withTimeout(engine.layout(graph), LAYOUT_TIMEOUT_MS);
        workerWorked = true;
        return out;
      } catch (err) {
        engine.terminateWorker();
        elk = null;
        if (workerWorked || fellBack) throw err;
        fellBack = true;
        elk = inThread();
        return withTimeout((await elk).layout(graph), LAYOUT_TIMEOUT_MS);
      }
    },
  };
}

/** The one engine the app uses (one worker, shared by every canvas). */
export const browserLayoutEngine: LayoutEngine = createWorkerLayoutEngine();
```

  - **Interop:** `elk-api.js` and `elk.bundled.js` are browserified CommonJS. If `default` is `undefined` at runtime in the browser, use `const Elk = (mod.default ?? mod) as typeof mod.default`.
  - **Typing:** `?url` imports are typed by `vite/client` (already in `tsconfig.json`). `terminateWorker()` is a no-op without a worker.

  **`App.tsx`:** wrap the routes in `<LayoutEngineProvider engine={browserLayoutEngine}>`.

- [ ] **Step 4: Run** `pnpm --filter @family-tree/web exec vitest run src/canvas/elk-graph.test.ts src/canvas/layout.test.ts`. Both pass. The real-ELK file may take a few seconds (the GWT bundle loads once); the 15-second `testTimeout` covers it.

- [ ] **Step 5: Run** `pnpm --filter @family-tree/web build`. The build lists an `elk-worker.min-*.js` asset, and the main chunk does not contain ELK (check that `dist/assets/index-*.js` is not ~1.6 MB bigger than before).

- [ ] **Step 6: Commit** `git commit -m "feat(web): ELK layered layout config and worker engine, tested against real ELK"`.

---

## Task 13: Web — person cards and union dots

**Files:**
- Create: `apps/web/src/canvas/canvas-settings.ts`, `apps/web/src/canvas/canvas-settings.test.ts`, `apps/web/src/canvas/CanvasActions.tsx`, `apps/web/src/canvas/PersonCard.tsx`, `apps/web/src/canvas/PersonCard.test.tsx`, `apps/web/src/canvas/UnionNode.tsx`
- Modify: `apps/web/src/trees/format.ts` (+`initials`), `apps/web/src/trees/format.test.ts`, `apps/web/src/styles.css`

- [ ] **Step 1: Write the failing tests.**

  **`canvas/canvas-settings.test.ts`:**

```ts
import { describe, expect, it } from 'vitest';
import { canvasSettings, cardDetail, isNodeVisible, orderAfterDrag } from './canvas-settings';

describe('canvas settings', () => {
  it('simplifies cards as you zoom out', () => {
    expect([1, 0.55, 0.54, 0.25, 0.24, 0.05].map(cardDetail)).toEqual(
      ['full', 'full', 'compact', 'compact', 'dot', 'dot'],
    );
  });
  it('turns on the performance guard for big views', () => {
    expect(canvasSettings(299)).toEqual({ onlyRenderVisibleElements: false, showMiniMap: true });
    expect(canvasSettings(300).onlyRenderVisibleElements).toBe(true);
    expect(canvasSettings(1501).showMiniMap).toBe(false);
  });
  it('knows when a card is inside the visible pane', () => {
    const pane = { width: 800, height: 600 };
    const size = { width: 184, height: 88 };
    expect(isNodeVisible({ x: 100, y: 100 }, size, { x: 0, y: 0, zoom: 1 }, pane)).toBe(true);
    expect(isNodeVisible({ x: 700, y: 100 }, size, { x: 0, y: 0, zoom: 1 }, pane)).toBe(false);
    expect(isNodeVisible({ x: 700, y: 100 }, size, { x: -400, y: 0, zoom: 1 }, pane)).toBe(true);
  });
  it('orders dragged siblings by x', () => {
    expect(orderAfterDrag(['a', 'b', 'c'], new Map([['a', 300], ['b', 0], ['c', 150]]))).toEqual(['b', 'c', 'a']);
  });
});
```

  **`format.test.ts`:** `initials({ givenName: 'ada', middleName: null, surname: 'lovelace' })` is `'AL'`. `initials({ givenName: 'Zoë', middleName: null, surname: null })` is `'Z'`. An emoji first letter isn't split in half (`[...s][0]`).

  **`canvas/PersonCard.test.tsx`** (renders `PersonCardView`, the pure part; no React Flow):
  1. **Full card:** Robert (deceased, 1930–1998) shows "RH" (with `aria-hidden`), "Robert Hale" and "† 1930–1998".
     - The wrapper has the class `is-deceased`.
     - The open button's accessible name is "Robert Hale, 1930–1998, deceased".
     - Clicking it calls `onOpen`.
  2. **"+" buttons:** with `canAddRelative`, the four buttons are named "Add a parent of Robert Hale", "Add a sibling of Robert Hale", "Add a partner of Robert Hale" and "Add a child of Robert Hale". Clicking "Add a child…" calls `onAdd('child')`.
  3. **Sibling without parents:** with `hasParents: false`, the sibling button is disabled with `title="Add a parent first"`.
  4. **Can't add:** with `canAddRelative: false`, there are no "+" buttons.
  5. **Compact:** no initials and no "+" buttons, but the name and years are there.
  6. **Dot:** only one button, with the same accessible name, and no visible text.
  7. **You and focus:** `isMe` shows "You" and adds ", you" to the name. `isFocus` adds the class `is-focus`. `hiddenRelatives` adds ", more relatives not shown" and a "more" marker.
  8. **No HTML:** a `givenName` of `<b>x</b>` renders literally, and there is no `<b>` element.

- [ ] **Step 2: Run them; they fail.**

- [ ] **Step 3: Implement.**

  **`trees/format.ts`:**

```ts
/** "AL" for Ada Lovelace; the silhouette's initials until photos arrive (phase 6). */
export function initials(p: NameParts): string {
  const first = (s: string | null) => (s ? ([...s.trim()][0] ?? '') : '');
  return (first(p.givenName) + first(p.surname)).toLocaleUpperCase();
}
```

  **`canvas/canvas-settings.ts`:**

```ts
export type CardDetail = 'full' | 'compact' | 'dot';
/** Spec §6: full card, then name and years, then a dot. */
export const cardDetail = (zoom: number): CardDetail =>
  zoom >= 0.55 ? 'full' : zoom >= 0.25 ? 'compact' : 'dot';

export const VISIBLE_ONLY_FROM = 300;
export const MINIMAP_MAX_NODES = 1500;
/** The client half of the performance guard (decision 4). */
export const canvasSettings = (nodeCount: number) => ({
  onlyRenderVisibleElements: nodeCount >= VISIBLE_ONLY_FROM,
  showMiniMap: nodeCount <= MINIMAP_MAX_NODES,
});

type Pt = { x: number; y: number };
type Size = { width: number; height: number };
/** Whether a node at flow position `pos` is wholly inside the pane at this viewport. */
export function isNodeVisible(pos: Pt, size: Size, vp: Pt & { zoom: number }, pane: Size): boolean {
  const left = pos.x * vp.zoom + vp.x;
  const top = pos.y * vp.zoom + vp.y;
  return left >= 0 && top >= 0 && left + size.width * vp.zoom <= pane.width && top + size.height * vp.zoom <= pane.height;
}

/** Children of one union in left-to-right order of their x positions (sibling drag, Task 17). */
export const orderAfterDrag = (childIds: readonly string[], x: ReadonlyMap<string, number>) =>
  [...childIds].sort((a, b) => (x.get(a) ?? 0) - (x.get(b) ?? 0));
```

  **`canvas/CanvasActions.tsx`:**

```tsx
import type { RelativeRole } from '@family-tree/shared';
import { createContext, useContext } from 'react';

/** What a card or dot can do; the canvas supplies `reveal`, the page the rest. */
export interface CanvasActions {
  openPerson(personId: string): void;
  addRelative(personId: string, as: RelativeRole): void;
  openUnion(unionId: string): void;
  /** Pans so the card is on screen (keyboard focus). */
  reveal(personId: string): void;
}
const Ctx = createContext<CanvasActions | null>(null);
export const CanvasActionsProvider = Ctx.Provider;
export function useCanvasActions(): CanvasActions {
  const actions = useContext(Ctx);
  if (!actions) throw new Error('useCanvasActions must be used inside the canvas');
  return actions;
}
```

  **`canvas/PersonCard.tsx`:**

```tsx
import type { GraphPerson, RelativeRole } from '@family-tree/shared';
import { Handle, type NodeProps, Position, type ReactFlowState, useStore } from '@xyflow/react';
import { initials, personName, personYears } from '../trees/format';
import { type CardDetail, cardDetail } from './canvas-settings';
import { useCanvasActions } from './CanvasActions';
import type { PersonFlowNode } from './graph-to-flow';

const ADD: { as: RelativeRole; where: 'top' | 'left' | 'right' | 'bottom'; word: string }[] = [
  { as: 'parent', where: 'top', word: 'parent' },
  { as: 'sibling', where: 'left', word: 'sibling' },
  { as: 'partner', where: 'right', word: 'partner' },
  { as: 'child', where: 'bottom', word: 'child' },
];

export function PersonCardView({
  person,
  detail,
  isFocus,
  isMe,
  onOpen,
  onAdd,
  onFocus,
}: {
  person: GraphPerson;
  detail: CardDetail;
  isFocus: boolean;
  isMe: boolean;
  onOpen: () => void;
  onAdd: (as: RelativeRole) => void;
  onFocus?: () => void;
}) {
  const name = personName(person);
  const years = personYears(person);
  const deceased = !person.isLiving;
  const label = [
    name,
    years,
    deceased && 'deceased',
    isMe && 'you',
    person.hiddenRelatives && 'more relatives not shown',
  ]
    .filter(Boolean)
    .join(', ');
  const cls = ['person-card', `person-card-${detail}`, deceased && 'is-deceased', isFocus && 'is-focus']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} onFocus={onFocus}>
      {detail === 'full' && (
        <span className="card-photo" aria-hidden="true">
          {initials(person)}
        </span>
      )}
      <button type="button" className="card-open nodrag" aria-label={label} onClick={onOpen}>
        {detail !== 'dot' && (
          <>
            <span className="card-name">{name}</span>
            {(years || deceased) && (
              <span className="card-years">
                {deceased && '† '}
                {years}
              </span>
            )}
            {isMe && <span className="card-you">You</span>}
          </>
        )}
      </button>
      {detail !== 'dot' && person.hiddenRelatives && (
        <span className="card-more" aria-hidden="true" title="More relatives not shown">
          …
        </span>
      )}
      {detail === 'full' &&
        person.canAddRelative &&
        ADD.map(({ as, where, word }) => {
          const noParents = as === 'sibling' && !person.hasParents;
          return (
            <button
              key={as}
              type="button"
              className={`card-add card-add-${where} nodrag`}
              aria-label={`Add a ${word} of ${name}`}
              title={noParents ? 'Add a parent first' : `Add a ${word}`}
              disabled={noParents}
              onClick={() => onAdd(as)}
            >
              +
            </button>
          );
        })}
    </div>
  );
}

const detailOf = (s: ReactFlowState) => cardDetail(s.transform[2]);

/** The React Flow node: hidden handles for the edges, plus the card. */
export function PersonNode({ data }: NodeProps<PersonFlowNode>) {
  const detail = useStore(detailOf);
  const actions = useCanvasActions();
  const id = data.person.id;
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} className="card-handle" />
      <PersonCardView
        person={data.person}
        detail={detail}
        isFocus={data.isFocus}
        isMe={data.isMe}
        onOpen={() => actions.openPerson(id)}
        onAdd={(as) => actions.addRelative(id, as)}
        onFocus={() => actions.reveal(id)}
      />
      <Handle type="source" position={Position.Bottom} isConnectable={false} className="card-handle" />
    </>
  );
}
```

  `useStore(detailOf)` re-renders a card only when its detail level changes, not on every zoom frame.

  **`canvas/UnionNode.tsx`:**

```tsx
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { useCanvasActions } from './CanvasActions';
import type { UnionFlowNode } from './graph-to-flow';

/** The small dot between partners (spec §6 "Union node ●"); clicking edits the union. */
export function UnionNode({ data }: NodeProps<UnionFlowNode>) {
  const actions = useCanvasActions();
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} className="card-handle" />
      <button
        type="button"
        className={`union-dot nodrag${data.ended ? ' is-ended' : ''}`}
        aria-label={data.label}
        title={data.label}
        onClick={() => actions.openUnion(data.union.id)}
      />
      <Handle type="source" position={Position.Bottom} isConnectable={false} className="card-handle" />
    </>
  );
}
```

  **`styles.css`:** add these (use the existing colour variables where there are any):

```css
.person-card {
  position: relative;
  box-sizing: border-box;
  width: 184px;
  height: 88px;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.5rem;
  border: 2px solid #4a6fa5;
  border-radius: 10px;
  background: #fff;
}
.person-card.is-deceased { border-color: #9a9a9a; background: #f4f4f4; }
.person-card.is-focus { box-shadow: 0 0 0 3px #f0b429; }
.person-card:focus-within { outline: 3px solid #1d4ed8; outline-offset: 2px; }
.card-photo {
  flex: none; width: 44px; height: 44px; border-radius: 50%;
  display: grid; place-items: center; background: #dfe6ee; color: #34495e; font-weight: 700;
}
.card-open {
  all: unset; cursor: pointer; display: flex; flex-direction: column; min-width: 0; flex: 1;
}
.card-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-years, .card-you { font-size: 0.8rem; color: #555; }
.card-more { position: absolute; right: 6px; bottom: 2px; color: #777; }
.card-add {
  position: absolute; width: 22px; height: 22px; padding: 0; border-radius: 50%;
  font-size: 14px; line-height: 20px; opacity: 0; transition: opacity 0.1s;
}
.person-card:hover .card-add, .person-card:focus-within .card-add { opacity: 1; }
.card-add-top { top: -12px; left: calc(50% - 11px); }
.card-add-bottom { bottom: -12px; left: calc(50% - 11px); }
.card-add-left { left: -12px; top: calc(50% - 11px); }
.card-add-right { right: -12px; top: calc(50% - 11px); }
.person-card-compact { height: 88px; }
.person-card-dot { width: 184px; height: 88px; border-radius: 50%; padding: 0; }
.person-card-dot .card-open { width: 100%; height: 100%; }
.card-handle { opacity: 0; pointer-events: none; }
.union-dot {
  all: unset; display: block; width: 14px; height: 14px; border-radius: 50%;
  background: #4a6fa5; cursor: pointer;
}
.union-dot.is-ended { background: #fff; border: 2px dashed #9a9a9a; box-sizing: border-box; }
.union-dot:focus-visible { outline: 3px solid #1d4ed8; outline-offset: 2px; }
.react-flow__edge.edge-adoptive path { stroke-dasharray: 6 4; }
.react-flow__edge.edge-step path, .react-flow__edge.edge-foster path { stroke-dasharray: 1 4; stroke-linecap: round; }
.react-flow__edge.edge-ended path { stroke: #9a9a9a; stroke-dasharray: 8 6; }
```

  The dot level keeps the node's box (so the layout doesn't change). It draws a rounded shape inside it instead.

- [ ] **Step 4: Run the three test files; they pass.** Then run `pnpm lint` and `pnpm typecheck`.

- [ ] **Step 5: Commit** `git commit -m "feat(web): person cards with zoom levels and add buttons, union dots, edge styles"`.

---

## Task 14: Web — the canvas component and the graph hook

**Files:**
- Create: `apps/web/src/canvas/FamilyCanvas.tsx`, `apps/web/src/canvas/FamilyCanvas.test.tsx`, `apps/web/src/canvas/useTreeGraph.ts`

- [ ] **Step 1: Write the failing tests** `canvas/FamilyCanvas.test.tsx`. Render `FamilyCanvas` with `haleGraph()`, mapped by `graphToFlow`, positioned by `applyElkLayout(flow.nodes, await new FakeLayoutEngine().layout(toElkGraph(flow, null)))`, and with `vi.fn()` actions:
  1. **Cards and dots:** each person has a card button, for example `getByRole('button', { name: 'Robert Hale, 1930–1998, deceased' })`, and each drawn union has its dot ("Relationship of Robert Hale and Margaret Hale (Widowed)").
  2. **Clicks:** clicking Robert's card calls `openPerson('robert')`. Clicking the dot calls `openUnion('u-rm')`. Clicking "Add a child of Laura Chen" calls `addRelative('laura', 'child')`.
  3. **Container:** the container has `aria-label="Family tree"`, and the React Flow controls (zoom in, zoom out, fit view) are present.
  4. **Keyboard:** the card buttons are real `<button type="button">`s. `card.focus()` makes `document.activeElement` that button.
  5. **New layout:** re-rendering with new `nodes` (for example Robert removed) doesn't throw, and the cards update. React Flow's viewport maths isn't meaningful in jsdom; the walk-through checks fitting and centring.

  If React Flow keeps nodes `visibility: hidden` in jsdom despite the mocks, query with `{ hidden: true }` and note it in the test file header.

- [ ] **Step 2: Run them; they fail.**

- [ ] **Step 3: Implement** `canvas/FamilyCanvas.tsx`:

```tsx
import {
  applyNodeChanges,
  Background,
  Controls,
  type Edge,
  MiniMap,
  type NodeChange,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type CanvasActions, CanvasActionsProvider } from './CanvasActions';
import { canvasSettings, isNodeVisible } from './canvas-settings';
import { CARD_HEIGHT, CARD_WIDTH, type CanvasNode, type Family, personNodeId } from './graph-to-flow';
import { PersonNode } from './PersonCard';
import { UnionNode } from './UnionNode';

const NODE_TYPES = { person: PersonNode, union: UnionNode } satisfies NodeTypes;

export interface FamilyCanvasProps {
  nodes: CanvasNode[];
  edges: Edge[];
  families: Family[];
  /** Centred after each layout in focus view; null in full view. */
  focusId: string | null;
  actions: Omit<CanvasActions, 'reveal'>;
  /** Sibling drag (Task 17). */
  onReorder?: (unionId: string, childIds: string[]) => void;
}

export function FamilyCanvas(props: FamilyCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({ nodes, edges, focusId, actions }: FamilyCanvasProps) {
  const flow = useReactFlow<CanvasNode>();
  const pane = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(nodes);
  useEffect(() => setShown(nodes), [nodes]);
  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => setShown((ns) => applyNodeChanges(changes, ns)),
    [],
  );

  // After every new layout: fit, then (focus view) centre on the focus person.
  useEffect(() => {
    if (nodes.length === 0) return;
    void (async () => {
      await flow.fitView({ padding: 0.15, maxZoom: 1.1, duration: 0 });
      const focus = focusId ? nodes.find((n) => n.id === personNodeId(focusId)) : undefined;
      if (focus) {
        await flow.setCenter(focus.position.x + CARD_WIDTH / 2, focus.position.y + CARD_HEIGHT / 2, {
          zoom: flow.getViewport().zoom,
          duration: 0,
        });
      }
    })();
  }, [flow, nodes, focusId]);

  const reveal = useCallback(
    (personId: string) => {
      const node = flow.getNode(personNodeId(personId));
      const el = pane.current;
      if (!node || !el) return;
      const vp = flow.getViewport();
      const size = { width: CARD_WIDTH, height: CARD_HEIGHT };
      if (!isNodeVisible(node.position, size, vp, { width: el.clientWidth, height: el.clientHeight })) {
        void flow.setCenter(node.position.x + CARD_WIDTH / 2, node.position.y + CARD_HEIGHT / 2, {
          zoom: vp.zoom,
          duration: 150,
        });
      }
    },
    [flow],
  );
  const ctx = useMemo(() => ({ ...actions, reveal }), [actions, reveal]);
  const settings = canvasSettings(nodes.length);

  return (
    <CanvasActionsProvider value={ctx}>
      <div className="family-canvas" ref={pane}>
        <ReactFlow<CanvasNode>
          nodes={shown}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          onlyRenderVisibleElements={settings.onlyRenderVisibleElements}
          minZoom={0.05}
          maxZoom={2}
          aria-label="Family tree"
        >
          <Background />
          <Controls showInteractive={false} />
          {settings.showMiniMap && <MiniMap pannable zoomable ariaLabel="Overview of the tree" />}
        </ReactFlow>
      </div>
    </CanvasActionsProvider>
  );
}
```

  **`canvas/useTreeGraph.ts`:**

```ts
import type { GraphQuery, TreeGraph } from '@family-tree/shared';
import type { Edge } from '@xyflow/react';
import { useEffect, useState } from 'react';
import { MESSAGES } from '../auth/api';
import { useTreesApi } from '../trees/TreesApiContext';
import { applyElkLayout, toElkGraph } from './elk-graph';
import { assignGenerations } from './generations';
import { type CanvasNode, type Family, graphToFlow } from './graph-to-flow';
import { useLayoutEngine } from './LayoutEngineContext';

export type TreeGraphState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; graph: TreeGraph; nodes: CanvasNode[]; edges: Edge[]; families: Family[] };

/** Fetches the graph, maps it, lays it out. Stale responses are dropped. */
export function useTreeGraph(
  treeId: string,
  query: GraphQuery,
  ctx: { focusId: string | null; meId: string | null },
  refreshKey: number,
): TreeGraphState {
  const api = useTreesApi();
  const engine = useLayoutEngine();
  const [state, setState] = useState<TreeGraphState>({ status: 'loading' });
  const { mode, focus, depth, branch } = query;
  const { focusId, meId } = ctx;

  useEffect(() => {
    let active = true;
    // Keep showing the old drawing while a refresh loads; only the first load shows "loading".
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    void (async () => {
      const res = await api.getGraph(treeId, { mode, focus, depth, branch });
      if (!active) return;
      if (!res.ok) return setState({ status: 'error', message: res.error.message });
      const flow = graphToFlow(res.data, { focusId, meId });
      try {
        const laid = await engine.layout(toElkGraph(flow, assignGenerations(flow)));
        if (!active) return;
        setState({
          status: 'ready',
          graph: res.data,
          nodes: applyElkLayout(flow.nodes, laid),
          edges: flow.edges,
          families: flow.families,
        });
      } catch {
        if (active) setState({ status: 'error', message: MESSAGES.layoutFailed });
      }
    })();
    return () => {
      active = false;
    };
  }, [api, engine, treeId, mode, focus, depth, branch, focusId, meId, refreshKey]);

  return state;
}
```

- [ ] **Step 4: Run** `pnpm --filter @family-tree/web exec vitest run src/canvas` (all canvas tests). They pass. Then run lint and typecheck.

- [ ] **Step 5: Commit** `git commit -m "feat(web): FamilyCanvas (React Flow) with fit, focus centring, keyboard reveal; useTreeGraph"`.

---
## Task 15: Web — the tree page workspace: toolbar, URL state, side panel, union panel, disconnected people

**Files:**
- Create: `apps/web/src/canvas/params.ts`, `apps/web/src/canvas/params.test.ts`, `apps/web/src/canvas/CanvasToolbar.tsx`, `apps/web/src/canvas/DisconnectedPeople.tsx`, `apps/web/src/pages/tree/TreeWorkspace.tsx`, `apps/web/src/pages/tree/TreeWorkspace.test.tsx`, `apps/web/src/pages/tree/UnionPanel.tsx`, `apps/web/src/pages/tree/UnionPanel.test.tsx`, `apps/web/src/pages/tree/UnionForm.tsx`
- Modify: `apps/web/src/pages/TreePage.tsx`, `apps/web/src/pages/TreePage.test.tsx`, `apps/web/src/routes.tsx`, `apps/web/src/components/Page.tsx`, `apps/web/src/pages/tree/PersonPanel.tsx`, `apps/web/src/pages/tree/RelationsTab.tsx`, `apps/web/src/pages/tree/PeopleList.tsx`, `apps/web/src/styles.css`

- [ ] **Step 1: Write the failing `canvas/params.test.ts`:**

```ts
import { describe, expect, it } from 'vitest';
import { canvasSearch, readCanvasParams } from './params';

const sp = (s: string) => new URLSearchParams(s);

describe('canvas URL parameters', () => {
  it('reads defaults and ignores nonsense', () => {
    expect(readCanvasParams(sp(''))).toEqual({ mode: 'focus', depth: 1, branch: null, focus: null });
    expect(readCanvasParams(sp('view=full&depth=9&branch=b'))).toEqual({ mode: 'full', depth: 1, branch: 'b', focus: null });
    expect(readCanvasParams(sp('depth=3&focus=f')).depth).toBe(3);
  });
  it('applies changes, drops nulls and defaults, keeps the rest', () => {
    expect(canvasSearch(sp('view=full&tab=history'), { tab: null })).toBe('?view=full');
    expect(canvasSearch(sp('depth=2'), { view: 'focus', depth: 1 })).toBe('');
    expect(canvasSearch(sp('depth=2&tab=info'), { tab: 'relations', add: 'child' })).toBe('?depth=2&tab=relations&add=child');
  });
});
```

- [ ] **Step 2: Implement `canvas/params.ts`:**

```ts
import { GRAPH_DEPTH_MAX, type GraphMode } from '@family-tree/shared';
import { useSearchParams } from 'react-router';

export interface CanvasParams {
  mode: GraphMode;
  depth: number;
  branch: string | null;
  focus: string | null;
}

/** Decision 10: the canvas state lives in the URL. The server validates ids. */
export function readCanvasParams(p: URLSearchParams): CanvasParams {
  const depth = Number(p.get('depth'));
  return {
    mode: p.get('view') === 'full' ? 'full' : 'focus',
    depth: Number.isInteger(depth) && depth >= 1 && depth <= GRAPH_DEPTH_MAX ? depth : 1,
    branch: p.get('branch') || null,
    focus: p.get('focus') || null,
  };
}

export type CanvasChange = Partial<
  Record<'view' | 'depth' | 'branch' | 'focus' | 'tab' | 'add', string | number | null>
>;

/** `?…` with `change` applied to `current`; null removes a key, and default values are left out. */
export function canvasSearch(current: URLSearchParams, change: CanvasChange): string {
  const next = new URLSearchParams(current);
  for (const [k, v] of Object.entries(change)) {
    if (v === null || v === undefined || v === '') next.delete(k);
    else next.set(k, String(v));
  }
  if (next.get('view') === 'focus') next.delete('view');
  if (next.get('depth') === '1') next.delete('depth');
  const s = next.toString();
  return s ? `?${s}` : '';
}

/** A link to someone's panel that keeps the current view and depth. */
export function usePersonHref(treeId: string): (personId: string) => string {
  const [params] = useSearchParams();
  return (personId) =>
    `/trees/${treeId}/people/${personId}${canvasSearch(params, { focus: null, tab: null, add: null })}`;
}
```

  Run the params test; it passes.

- [ ] **Step 3: Write the failing `TreeWorkspace.test.tsx`**, using `renderAt` with a `FakeTreesApi` tree whose `graph` is a `haleGraph()` translated to the tree's person ids. A small helper in the test can do that: seed `persons` from `haleGraph().persons` and use the same ids.
  1. **Default view:** `/trees/<id>` calls `getGraph(<id>, { mode: 'focus', focus: <root>, depth: 1 })` and draws the cards. The hint "Select someone on the tree to see their details." shows, and there is no panel.
  2. **Opening a person:**
     - Clicking Robert's card lands on `/trees/<id>/people/robert`. The person panel loads (`getPerson`), and `getGraph` is called again with `focus: 'robert'` (re-centring).
     - **Close** returns to `/trees/<id>?focus=robert`, and the panel is gone.
  3. **Full view:** **Full** (with `aria-pressed`) sets `?view=full` and calls `getGraph` with `{ mode: 'full' }`. The depth slider is hidden and the branch select is shown. Choosing Robert in "Branch" calls `getGraph` with `{ mode: 'full', branch: 'robert' }`.
  4. **Depth:** on **Focus**, changing the "Generations" range to 2 sets `?depth=2` and calls `getGraph` with `depth: 2`.
  5. **Needs a branch:** a graph with `needsBranch: true, total: 2500` shows "This tree has 2,500 people, too many to draw at once. Choose a branch to show." and the branch select. There is no canvas.
  6. **Truncated:** a graph with `truncated: true` shows "Only part of the tree is shown. Pick a branch or use the focus view to see the rest."
  7. **Layout failure:** `layout.failNext()` shows `MESSAGES.layoutFailed`.
  8. **Graph error:** `trees.failNext('getGraph', NOT_FOUND)` shows the message and a "Back to the starting person" link.
  9. **Union panel:** clicking the David + Laura dot lands on `/trees/<id>/unions/u-dl?focus=<root>` and shows `UnionPanel` (Task 15 Step 5).
  10. **Disconnected people:**
      - With `t.disconnected = [lone]`, the toolbar shows **Disconnected people (1)**, collapsed (`aria-expanded="false"`).
      - Clicking it lists Lone as a link to `/trees/<id>/people/<lone>`.
      - With none, the button isn't rendered.
  11. **Fallback list:** the "All people (10)" disclosure contains the people list, with links that keep `?view=full` when it is set.
  12. **Toolbar links:** **Add a person** shows for an editor and is hidden for a viewer. **Trash** shows for the owner only. **Members and invites** always shows.
  13. **Refreshing:** after a save in the person panel (`onChanged`), `getGraph` and `listDisconnected` are called again.

- [ ] **Step 4: Run it; it fails.**

- [ ] **Step 5: Implement.**

  **`components/Page.tsx`:** add `full?: boolean`. It renders `className="card card-full"` and takes precedence over `wide`.

  **`routes.tsx`:** add `/trees/:treeId/unions/:unionId` (inside `RequireAuth`, rendering `<TreePage />`) next to the people routes.

  **`TreePage.tsx`:**
  - Keep the loading of `getTree` and `listPersons`, the error and loading states, the role and steward lines, the starting-person line and `Settings`. Use `<Page title={tree.name} full>`.
  - Replace the `.tree-layout` block and the links paragraph with `<TreeWorkspace treeId detail persons onPersonsChanged={refreshPersons} />`.

  **`pages/tree/UnionForm.tsx`:**
  - Move `UnionForm` out of `RelationsTab.tsx` unchanged, exported.
  - Widen its prop to `union: Pick<Union, 'type' | 'status' | 'startDate' | 'endDate'>`, so a `GraphUnionView` fits.
  - `RelationsTab` imports it from there.

  **`pages/tree/UnionPanel.tsx`:**

```tsx
import type { GraphUnionView, PersonSummary } from '@family-tree/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { FormError } from '../../components/forms';
import { formatFuzzyDate, personName, UNION_STATUS_LABEL, UNION_TYPE_LABEL } from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import { UnionForm } from './UnionForm';

/** Spec §6 "Union node ●": clicking it edits the union's type, status and dates. */
export function UnionPanel({
  treeId,
  union,
  loading,
  persons,
  onChanged,
}: {
  treeId: string;
  union: GraphUnionView | undefined;
  loading: boolean;
  persons: PersonSummary[];
  onChanged: () => void;
}) {
  const api = useTreesApi();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  if (!union) {
    return loading ? (
      <p>Loading…</p>
    ) : (
      <div>
        <p>This relationship isn’t in the current view.</p>
        <p>
          <Link to={`/trees/${treeId}`}>Back to the tree</Link>
        </p>
      </div>
    );
  }
  const nameOf = (id: string | null) => {
    const p = persons.find((x) => x.id === id);
    return p ? personName(p) : 'Unknown partner';
  };
  const from = formatFuzzyDate(union.startDate);
  const to = formatFuzzyDate(union.endDate);
  return (
    <div className="union-panel">
      <h2>
        {nameOf(union.partnerAId)} and {nameOf(union.partnerBId)}
      </h2>
      <p>
        {UNION_TYPE_LABEL[union.type]}, {UNION_STATUS_LABEL[union.status]}
        {from && ` from ${from}`}
        {to && ` to ${to}`}
      </p>
      <FormError>{error}</FormError>
      {saved && (
        <p role="status" className="success">
          Saved
        </p>
      )}
      {union.canEdit &&
        (editing ? (
          <UnionForm
            union={union}
            onCancel={() => setEditing(false)}
            onSubmit={async (input) => {
              const res = await api.updateUnion(treeId, union.id, input);
              if (!res.ok) return setError(res.error.message);
              setError(null);
              setEditing(false);
              setSaved(true);
              onChanged();
            }}
          />
        ) : (
          <button type="button" onClick={() => setEditing(true)}>
            Edit relationship
          </button>
        ))}
    </div>
  );
}
```

  **`UnionPanel.test.tsx`:**
  1. It shows "Robert Hale and Margaret Hale" and "Marriage, Widowed".
  2. **Edit relationship** → status Divorced → **Save relationship** calls `updateUnion(<id>, 'u-rm', { status: 'divorced' })`, shows "Saved" and calls `onChanged`.
  3. `canEdit: false` shows no edit button.
  4. A union that isn't in the view shows the message.

  **`canvas/DisconnectedPeople.tsx`:** a toggle button "Disconnected people (N)" (`aria-expanded`, `aria-controls="disconnected-list"`). Under it:
  - the hint "Not connected to the starting person through any relationship.";
  - a `<ul>` of `Link`s (`hrefOf(id)`) with each person's name and years.

  It renders nothing when the list is empty.

  **`canvas/CanvasToolbar.tsx`** takes these props:
  - `{ treeId, detail, persons, params: CanvasParams, disconnected, hrefOf, onChange(change: CanvasChange) }`

  It renders a `div.canvas-toolbar` with, in order:
  1. **View switch:** a `role="group"` labelled "View", holding two buttons: **Focus** (`aria-pressed`, `onChange({ view: null, branch: null })`) and **Full** (`onChange({ view: 'full', focus: null })`).
  2. **Focus view:** `<label>Generations <input type="range" min="1" max="3" step="1" value={depth} aria-valuetext={`${depth} ${depth === 1 ? 'step' : 'steps'}`} /></label> <output>{depth}</output>`. On change: `onChange({ depth })`.
  3. **Full view:** `<label>Branch <select>`, with "Whole tree" (value '') and then every person by `personName`. On change: `onChange({ branch: value || null })`.
  4. **Add a person** (`Link` to `/trees/:id/people/new` + the current search), when `capabilities.editAnywhere || me.steward.active`.
  5. `<DisconnectedPeople>`.
  6. **Members and invites**, then **Trash** (`manageTree`), then **Your trees** (links, as in phase 4).

  The search box and "How are we related?" are phase 6.

  **`pages/tree/TreeWorkspace.tsx`:**

```tsx
import type { GraphQuery, PersonSummary, RelativeRole, TreeDetail } from '@family-tree/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useMatch, useNavigate, useParams, useSearchParams } from 'react-router';
import { FormError } from '../../components/forms';
import { CanvasToolbar } from '../../canvas/CanvasToolbar';
import { FamilyCanvas } from '../../canvas/FamilyCanvas';
import { type CanvasChange, canvasSearch, readCanvasParams, usePersonHref } from '../../canvas/params';
import { useTreeGraph } from '../../canvas/useTreeGraph';
import { useTreesApi } from '../../trees/TreesApiContext';
import { AddPersonForm } from './AddPersonForm';
import { PeopleList } from './PeopleList';
import { PersonPanel } from './PersonPanel';
import { UnionPanel } from './UnionPanel';

export function TreeWorkspace({
  treeId,
  detail,
  persons,
  onPersonsChanged,
}: {
  treeId: string;
  detail: TreeDetail;
  persons: PersonSummary[];
  onPersonsChanged: () => void;
}) {
  const { personId, unionId } = useParams();
  const newPerson = useMatch('/trees/:treeId/people/new') !== null;
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const api = useTreesApi();
  const hrefOf = usePersonHref(treeId);
  const view = readCanvasParams(params);
  const [refreshKey, setRefreshKey] = useState(0);
  const [disconnected, setDisconnected] = useState<PersonSummary[]>([]);

  // Focus view centres on: an explicit focus, else the selected person, else the root (decision 10).
  const focusId = view.focus ?? personId ?? detail.tree.rootPersonId;
  const query: GraphQuery =
    view.mode === 'full'
      ? { mode: 'full', ...(view.branch ? { branch: view.branch } : {}) }
      : { mode: 'focus', ...(focusId ? { focus: focusId } : {}), depth: view.depth };
  const graph = useTreeGraph(
    treeId,
    query,
    { focusId: view.mode === 'focus' ? focusId : null, meId: detail.me.personId },
    refreshKey,
  );

  useEffect(() => {
    let active = true;
    void api.listDisconnected(treeId).then((r) => {
      if (active && r.ok) setDisconnected(r.data);
    });
    return () => {
      active = false;
    };
  }, [api, treeId, refreshKey]);

  const changed = useCallback(() => {
    setRefreshKey((k) => k + 1);
    onPersonsChanged();
  }, [onPersonsChanged]);
  const go = useCallback(
    (path: string, change: CanvasChange) => void navigate(`${path}${canvasSearch(params, change)}`),
    [navigate, params],
  );
  const base = `/trees/${treeId}`;
  const keepFocus = view.mode === 'focus' ? focusId : null;
  const actions = useMemo(
    () => ({
      openPerson: (id: string) => go(`${base}/people/${id}`, { focus: null, tab: null, add: null }),
      addRelative: (id: string, as: RelativeRole) =>
        go(`${base}/people/${id}`, { focus: null, tab: 'relations', add: as }),
      openUnion: (id: string) => go(`${base}/unions/${id}`, { focus: keepFocus, tab: null, add: null }),
    }),
    [go, base, keepFocus],
  );
  const close = () => go(base, { focus: keepFocus, tab: null, add: null });
  const selected = newPerson || personId !== undefined || unionId !== undefined;
  const ready = graph.status === 'ready' ? graph : null;

  return (
    <>
      <CanvasToolbar
        treeId={treeId}
        detail={detail}
        persons={persons}
        params={view}
        disconnected={disconnected}
        hrefOf={hrefOf}
        onChange={(change) => go(pathname, change)}
      />
      <div className={selected ? 'tree-workspace has-panel' : 'tree-workspace'}>
        <section className="canvas-area" aria-label="Family tree view">
          {graph.status === 'loading' && <p role="status">Drawing the tree…</p>}
          {graph.status === 'error' && (
            <>
              <FormError>{graph.message}</FormError>
              <p>
                <Link to={base}>Back to the starting person</Link>
              </p>
            </>
          )}
          {ready?.graph.needsBranch && (
            <p>
              This tree has {ready.graph.total.toLocaleString('en')} people, too many to draw at once.
              Choose a branch to show.
            </p>
          )}
          {ready?.graph.truncated && (
            <p role="status" className="notice">
              Only part of the tree is shown. Pick a branch or use the focus view to see the rest.
            </p>
          )}
          {ready && !ready.graph.needsBranch && ready.nodes.length === 0 && <p>No one to show yet.</p>}
          {ready && ready.nodes.length > 0 && (
            <FamilyCanvas
              nodes={ready.nodes}
              edges={ready.edges}
              families={ready.families}
              focusId={view.mode === 'focus' ? focusId : null}
              actions={actions}
            />
          )}
        </section>
        {selected ? (
          <aside className="tree-panel" aria-label="Details">
            <p className="panel-close">
              <button type="button" className="secondary" onClick={close}>
                Close
              </button>
            </p>
            {newPerson ? (
              <AddPersonForm treeId={treeId} persons={persons} detail={detail} onCreated={changed} />
            ) : personId ? (
              <PersonPanel
                key={personId}
                treeId={treeId}
                personId={personId}
                persons={persons}
                onChanged={changed}
              />
            ) : (
              <UnionPanel
                key={unionId}
                treeId={treeId}
                union={ready?.graph.unions.find((u) => u.id === unionId)}
                loading={graph.status === 'loading'}
                persons={persons}
                onChanged={changed}
              />
            )}
          </aside>
        ) : (
          <p className="hint canvas-hint">Select someone on the tree to see their details.</p>
        )}
      </div>
      <details className="people-fallback">
        <summary>All people ({persons.length})</summary>
        <PeopleList treeId={treeId} persons={persons} detail={detail} selectedId={personId} />
      </details>
    </>
  );
}
```

  When `needsBranch`, the branch select must be visible. It already is, because `needsBranch` only happens in full view, where the toolbar shows it.

  **`PersonPanel.tsx`:** a tab change must keep the other parameters and drop `add`:

```tsx
        onChange={(id) =>
          setParams(
            (p) => {
              const next = new URLSearchParams(p);
              next.set('tab', id);
              next.delete('add');
              return next;
            },
            { replace: true },
          )
        }
```

  **`RelationsTab.tsx`:** replace each `` `/trees/${treeId}/people/${p.id}` `` with `hrefOf(p.id)` from `usePersonHref(treeId)`.

  **`PeopleList.tsx`:**
  - Drop the "The interactive family tree arrives in a later version." note and the **Add a person** link (it moved to the toolbar).
  - Link with `usePersonHref`.
  - Change the heading to an `h2` "People (N)" inside the disclosure.

  **`styles.css`:**

```css
.card-full { max-width: none; width: 100%; }
.canvas-toolbar { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: center; margin: 0.5rem 0; }
.canvas-toolbar [aria-pressed='true'] { background: #1d4ed8; color: #fff; }
.tree-workspace { display: grid; grid-template-columns: 1fr; gap: 1rem; }
.tree-workspace.has-panel { grid-template-columns: 1fr 400px; }
.canvas-area { position: relative; min-height: 480px; height: calc(100vh - 260px); border: 1px solid #ccd; border-radius: 8px; }
.family-canvas { width: 100%; height: 100%; }
.tree-panel { max-height: calc(100vh - 260px); overflow: auto; }
.panel-close { text-align: right; margin: 0; }
.disconnected { position: relative; }
.disconnected-list {
  position: absolute; z-index: 10; background: #fff; border: 1px solid #ccd; border-radius: 8px;
  padding: 0.5rem 1rem; min-width: 240px; max-height: 50vh; overflow: auto;
}
.people-fallback { margin-top: 1rem; }
@media (max-width: 720px) {
  .tree-workspace.has-panel { grid-template-columns: 1fr; }
  .canvas-area { height: 70vh; }
  /* The side panel becomes a bottom sheet (spec §6). */
  .tree-panel {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; max-height: 65vh;
    background: #fff; border-top-left-radius: 14px; border-top-right-radius: 14px;
    box-shadow: 0 -4px 16px rgb(0 0 0 / 20%); padding: 0.5rem 1rem 1rem;
  }
}
```

  Remove the old `.tree-layout` rules that no longer apply.

  **`TreePage.test.tsx`** and the other phase 4 page tests (`PersonPanel.test.tsx`, `AddPersonForm.test.tsx`, `AddRelativeForm.test.tsx`, `DeletePerson.test.tsx`):
  - Update the selectors only where the markup changed:
    - The people list is now inside "All people (N)". Click its `summary` first if a query fails on visibility.
    - "Add a person" is in the toolbar.
    - "Choose someone from the list" became "Select someone on the tree…".
  - Keep their assertions.

- [ ] **Step 6: Run** all web tests, then `pnpm lint` and `pnpm typecheck`. They pass.

- [ ] **Step 7: Commit** `git commit -m "feat(web): tree page with canvas, focus/full switch, depth, branch, side panel and bottom sheet, union panel, disconnected people"`.

---

## Task 16: Web — adding from the canvas, and the duplicate check

**Files:**
- Create: `apps/web/src/pages/tree/useDuplicateCheck.ts`, `apps/web/src/pages/tree/DuplicatePrompt.tsx`, `apps/web/src/pages/tree/DuplicatePrompt.test.tsx`
- Modify: `apps/web/src/pages/tree/AddRelativeForm.tsx`, `apps/web/src/pages/tree/AddRelativeForm.test.tsx`, `apps/web/src/pages/tree/AddPersonForm.tsx`, `apps/web/src/pages/tree/AddPersonForm.test.tsx`, `apps/web/src/pages/tree/RelationsTab.tsx`, `apps/web/src/pages/tree/PersonPanel.test.tsx`, `apps/web/src/pages/tree/TreeWorkspace.test.tsx`

- [ ] **Step 1: Write the failing tests.**

  **`DuplicatePrompt.test.tsx`:** with two matches, it renders:
  - the heading "Is this someone already in the tree?";
  - per match, "Is this the existing person Ada Lovelace (1815–1852)?" with a **Yes, use them** button (accessible name "Yes, use Ada Lovelace"), which calls `onUse(match)`;
  - one **No, add a new person** button, which calls `onCreateNew`.

  **`AddRelativeForm.test.tsx`** (the fake tree has "Ada Lovelace" b. 1815 and the subject Robert):
  1. **A match:** a new child "Ada" / "Lovelace" / 1815 → **Add** calls `findSimilar` and shows the prompt. `createPerson` is **not** called.
  2. **Yes:** **Yes, use Ada Lovelace** calls `addRelative(robert, { personId: ada, as: 'child', kind: 'biological', unionId })`, then `onDone`.
  3. **No:** **No, add a new person** calls `createPerson` with the typed person. Submitting the same name again doesn't prompt again.
  4. **No match:** a name with no match ("Zed") calls `createPerson` directly, after one `findSimilar` call.
  5. **Check fails:** `failNext('findSimilar', NETWORK)` still creates the person (decision 9).
  6. **Subject excluded:** the subject never appears as a match.
  7. **Changed name:** changing the name after "No" checks again.

  **`AddPersonForm.test.tsx`:**
  1. **Yes, unconnected:** "Ada Lovelace" with no connection → prompt → **Yes** navigates to Ada's panel and calls neither `createPerson` nor `addRelative`.
  2. **Yes, connected:** with "Connect to: Robert, as their child" → **Yes** calls `addRelative(robert, { personId: ada, as: 'child', kind: 'biological' })` and lands on Ada.
  3. **No:** creates as in phase 4.

  **`PersonPanel.test.tsx` / `TreeWorkspace.test.tsx`:**
  1. Opening `/trees/t/people/robert?tab=relations&add=child` shows the Relations tab with the "Add child" form open.
  2. Cancelling removes `add` from the URL.
  3. On the canvas, clicking **Add a child of Laura Chen** lands there with the "Other parent" select preselected to "with David Hale" (the phase 4 rule).
  4. `add=sibling` for someone with no parents opens nothing and shows the "Add a parent first" hint.

- [ ] **Step 2: Run them; they fail.**

- [ ] **Step 3: Implement.**

  **`useDuplicateCheck.ts`:**

```ts
import type { PersonSummary, SimilarQuery } from '@family-tree/shared';
import { useCallback, useState } from 'react';
import { useTreesApi } from '../../trees/TreesApiContext';

/**
 * The duplicate check (spec §6, decision 9). `check` resolves true when it's fine to create:
 * no likely match, the user already said "No, add a new person" for exactly this input, or the
 * check itself failed (it never blocks adding).
 */
export function useDuplicateCheck(treeId: string, excludeIds: readonly string[]) {
  const api = useTreesApi();
  const [matches, setMatches] = useState<PersonSummary[] | null>(null);
  const [confirmedNew, setConfirmedNew] = useState<string | null>(null);

  const check = useCallback(
    async (q: SimilarQuery): Promise<boolean> => {
      const key = JSON.stringify(q);
      if (confirmedNew === key) return true;
      const res = await api.findSimilar(treeId, q);
      if (!res.ok) return true;
      const found = res.data.filter((p) => !excludeIds.includes(p.id));
      if (found.length === 0) return true;
      setMatches(found);
      return false;
    },
    [api, treeId, excludeIds, confirmedNew],
  );
  const confirmNew = (q: SimilarQuery) => {
    setConfirmedNew(JSON.stringify(q));
    setMatches(null);
  };
  return { matches, check, confirmNew, dismiss: () => setMatches(null) };
}

/** The check's query from the quick-add fields. */
export function similarQueryOf(v: { givenName: string; surname: string; birthYear: string }): SimilarQuery {
  const year = Number(v.birthYear.trim());
  return {
    givenName: v.givenName.trim(),
    ...(v.surname.trim() ? { surname: v.surname.trim() } : {}),
    ...(v.birthYear.trim() && Number.isInteger(year) ? { birthYear: year } : {}),
  };
}
```

  **`DuplicatePrompt.tsx`:**

```tsx
import type { PersonSummary } from '@family-tree/shared';
import { useId } from 'react';
import { personName, personYears } from '../../trees/format';

export function DuplicatePrompt({
  matches,
  pending,
  onUse,
  onCreateNew,
}: {
  matches: PersonSummary[];
  pending: boolean;
  onUse: (p: PersonSummary) => void;
  onCreateNew: () => void;
}) {
  const id = useId();
  return (
    <section className="duplicate-check" role="group" aria-labelledby={id}>
      <h3 id={id}>Is this someone already in the tree?</h3>
      <ul>
        {matches.map((p) => {
          const name = personName(p);
          const years = personYears(p);
          return (
            <li key={p.id}>
              Is this the existing person {name}
              {years && ` (${years})`}?{' '}
              <button type="button" aria-label={`Yes, use ${name}`} disabled={pending} onClick={() => onUse(p)}>
                Yes, use them
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="secondary" disabled={pending} onClick={onCreateNew}>
        No, add a new person
      </button>
    </section>
  );
}
```

  **`AddRelativeForm.tsx`:**
  - `const dup = useDuplicateCheck(treeId, useMemo(() => [subject.person.id], [subject.person.id]));`
  - Split the new-person path of `submit` into `createNew()` (the phase 4 code) and a guard:

```ts
    if (mode === 'new') {
      const input = { person: quickPerson(quick), attach: { to: subject.person.id, ...link } };
      const v = validateDeep(createPersonSchema, input);
      if (!v.ok) {
        setPending(false);
        return setErrors(v.errors);
      }
      if (!(await dup.check(similarQueryOf(quick)))) {
        if (alive.current) setPending(false);
        return; // the prompt is showing
      }
      res = await api.createPerson(treeId, input as CreatePersonInput);
    }
```

  - Render `{dup.matches && <DuplicatePrompt … />}` above the submit buttons:
    - `onUse={(p) => void linkExisting(p.id)}`, where `linkExisting` calls `api.addRelative(treeId, subject.person.id, { personId, ...link })` with the same result handling as the existing-person path.
    - `onCreateNew={() => { dup.confirmNew(similarQueryOf(quick)); void submitNow(); }}`. Here `submitNow` re-runs `submit` without an event: make `submit(e?: FormEvent)` call `e?.preventDefault()`.
  - Editing any quick field calls `dup.dismiss()`.

  **`AddPersonForm.tsx`:** the same guard before `createPerson`. Its `linkExisting(p)`:
  - with a `to` connection: `api.addRelative(treeId, to, { personId: p.id, as, kind: 'biological' })`; on success `onCreated()`, then navigate to `/trees/:treeId/people/<p.id>`; `CONFLICT` shows its message;
  - without one: navigate to `/trees/:treeId/people/<p.id>` (nothing is created).

  **`RelationsTab.tsx`:**
  - Read `add` with `useSearchParams`: `const requested = RELATIVE_ROLES.find((r) => r === params.get('add')) ?? null;`.
  - Start `adding` from it. An effect sets `adding` when `requested` changes, ignoring `sibling` when `rel.parents.length === 0`.
  - On cancel or done, delete `add` from the URL (`setParams(..., { replace: true })`, keeping the other keys), as well as clearing `adding`.

- [ ] **Step 4: Run** the web tests, lint and typecheck. They pass.

- [ ] **Step 5: Commit** `git commit -m "feat(web): add relatives from cards; duplicate check before creating a person"`.

---

## Task 17: Web — reordering siblings (drag on the canvas, buttons in Relations)

**Files:**
- Modify: `apps/web/src/canvas/graph-to-flow.ts`, `apps/web/src/canvas/graph-to-flow.test.ts`, `apps/web/src/canvas/canvas-settings.ts`, `apps/web/src/canvas/canvas-settings.test.ts`, `apps/web/src/canvas/FamilyCanvas.tsx`, `apps/web/src/pages/tree/TreeWorkspace.tsx`, `apps/web/src/pages/tree/RelationsTab.tsx`, `apps/web/src/pages/tree/PersonPanel.test.tsx`, `apps/web/src/styles.css`

- [ ] **Step 1: Write the failing tests.**

  **`graph-to-flow.test.ts`:**
  1. In `haleGraph()`, Leo and Mia (`u-dl`, `childCount: 2`, `canEdit`) are `draggable` with `reorderUnionId: 'u-dl'`. David and Susan (`u-rm`) are too. Emma (only child) and Noah are not. Nor are Robert, Margaret, Anna and Laura (no parent union in view).
  2. With `u-dl.canEdit: false`, Leo and Mia are not draggable.
  3. With `u-dl.childCount: 3` (a child not in the view), they are not draggable either.

  **`canvas-settings.test.ts`:** `reorderAfterDrop(families, 'u-dl', new Map([['leo', 400], ['mia', 100]]))` is `['mia', 'leo']`. With the original order it is `null` (nothing to save). An unknown union gives `null`.

  **`PersonPanel.test.tsx`** (Relations tab, David with children Leo and Mia):
  - **Move later** on Leo calls `reorderChildren(<t>, 'u-dl', [mia, leo])`, and then the panel reloads.
  - The first child has no **Move earlier** and the last no **Move later**.
  - A viewer sees neither button.

- [ ] **Step 2: Run them; they fail.**

- [ ] **Step 3: Implement.**

  **`graph-to-flow.ts`:** after building `families`, mark the reorderable children (decision 16):

```ts
  const reorderable = new Map<string, string>(); // child id -> the union they can be dragged in
  for (const u of graph.unions) {
    const fam = families.find((f) => f.id === u.id);
    if (!fam || !u.canEdit || u.childCount < 2 || fam.childIds.length !== u.childCount) continue;
    for (const c of fam.childIds) if (!reorderable.has(c)) reorderable.set(c, u.id);
  }
  for (const n of nodes) {
    if (n.type !== 'person') continue;
    const unionId = reorderable.get(n.data.person.id) ?? null;
    n.data.reorderUnionId = unionId;
    n.draggable = unionId !== null;
    if (unionId) n.className = 'is-reorderable';
  }
```

  **`canvas-settings.ts`:**

```ts
import type { Family } from './graph-to-flow';

/** The new child order after a drop, or null when nothing changed. */
export function reorderAfterDrop(
  families: readonly Family[],
  unionId: string,
  x: ReadonlyMap<string, number>,
): string[] | null {
  const fam = families.find((f) => f.id === unionId);
  if (!fam) return null;
  const next = orderAfterDrag(fam.childIds, x);
  return next.every((id, i) => id === fam.childIds[i]) ? null : next;
}
```

  **`FamilyCanvas.tsx`:** destructure `families` and `onReorder` in `CanvasInner` and add this to `<ReactFlow>`:

```tsx
  const onNodeDragStop = useCallback(
    (_: unknown, node: CanvasNode) => {
      setShown(nodes); // snap back; the next layout puts the card in its new place
      if (node.type !== 'person' || !node.data.reorderUnionId || !onReorder) return;
      const x = new Map(
        flow
          .getNodes()
          .filter((n): n is PersonFlowNode => n.type === 'person')
          .map((n) => [n.data.person.id, n.position.x]),
      );
      const next = reorderAfterDrop(families, node.data.reorderUnionId, x);
      if (next) onReorder(node.data.reorderUnionId, next);
    },
    [flow, families, nodes, onReorder],
  );
  // <ReactFlow … onNodeDragStop={onNodeDragStop} />
```

  - Read the positions from `flow.getNodes()` **before** `setShown(nodes)` takes effect; it is synchronous here because the state update applies on the next render.
  - Keep `nodesDraggable={false}`. Per-node `draggable: true` overrides it.

  **`TreeWorkspace.tsx`:** pass this `onReorder` to `FamilyCanvas`:

```tsx
  const [notice, setNotice] = useState<string | null>(null);
  const onReorder = useCallback(
    async (unionId: string, childIds: string[]) => {
      const res = await api.reorderChildren(treeId, unionId, childIds);
      if (!res.ok) setNotice(res.error.message);
      else setNotice(null);
      changed();
    },
    [api, treeId, changed],
  );
```

  Render `notice` as `<p role="status" className="notice">` above the workspace.

  **`RelationsTab.tsx`:** per union, when `caps.edit` and `u.children.length >= 2`, each child row gets **Move earlier** (not for the first) and **Move later** (not for the last). Each calls

```ts
api.reorderChildren(treeId, u.id, moved(u.children.map((c) => c.person.id), index, ±1))
```

  through `after(res, 'Order saved.')`. `moved` swaps two neighbours. Add `aria-label`s: "Move Leo Hale earlier", "Move Leo Hale later".

  **`styles.css`:** `.react-flow__node.is-reorderable .person-card { cursor: grab; }`.

- [ ] **Step 4: Run** the web tests, lint and typecheck. They pass.

- [ ] **Step 5: Commit** `git commit -m "feat(web): reorder siblings by dragging on the canvas or with Move buttons"`.

---

## Task 18: Verification, docs, browser walk-through, manual checklist

- [ ] **Step 1: README.**
  - **Replace** "Trees, invites and stewards (dev)"'s people list mention with a section "**The family canvas (dev)**":
    - The tree opens in **Focus** view on the starting person, showing parents, siblings, partners and children. **Generations** (1–3) widens it. **Full** shows the whole tree, or a branch for trees above 2,000 people.
    - Click a card to open the person's panel; the view re-centres on them. Click a ● dot to edit a relationship.
    - The "+" buttons on a card add a parent, sibling, partner or child. Every add checks for likely duplicates first ("Is this the existing person …?").
    - Layout is automatic. The only drag is reordering siblings (or use **Move earlier/later** in Relations).
    - **Disconnected people (N)** lists anyone not connected to the starting person.
    - `pnpm seed <email> --large 2500` adds "Large family (seed)" for trying the large-tree behaviour.
  - **"Known limitations":**
    - Remove "no tree canvas yet (phase 5)".
    - Add:
      - The duplicate check is a simple name and year match until search arrives (phase 6).
      - Cards show initials until photos arrive (phase 6).
      - There is no search box or "How are we related?" yet (phase 6).
      - `sibling_order` is per person: a child of two unions has one position.
- [ ] **Step 2: Full checks:**
  - `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm build`
  - Run gitleaks as CI does: `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.24.3 detect --source /repo --no-banner`. It must report no leaks.
  - Record the test counts (shared, API unit, API integration, web).
  - Re-run `node <scratchpad>/check-ages.mjs pnpm-lock.yaml <the commit before Task 1>` (find it with `git log --oneline`). Every new package is still `ok`.
- [ ] **Step 3: Rebuild the dev stack:** `pnpm down && pnpm dev`. The web container installs `@xyflow/react` and `elkjs`. The API log shows "Server listening".
- [ ] **Step 4: Browser walk-through** (the controller does this, not a subagent), with Claude-in-Chrome on http://localhost:5173. Use local test accounts generated in the scratchpad (`scratchpad/totp.mjs` for 2FA codes).
  1. **Setup:** the owner runs `pnpm seed <owner email> --large 2500` and opens "Sample family (seed)".
  2. **Focus view on Leo** (the root): Leo has the focus ring, with David and Laura above and Mia beside him.
     - Mia's line is **dashed** (adoptive).
     - Emma (half-sister) is **not** shown at depth 1.
     - The union dots sit between the partners, in their own thin row.
     - Robert is not shown.
  3. **Depth:**
     - **Generations 2:** Emma, Anna, Robert and Margaret appear. Robert's card has "†" and a grey frame.
     - The David + Anna dot is grey and dashed (divorced), with grey dashed partner lines.
     - David sits **between** Anna and Laura.
  4. **Full view:**
     - All 10 people, in 3 rows. Susan's single-parent union shows one partner line and Noah below.
     - Zoom out: the cards become name and years, then dots. The minimap and the zoom and fit controls work.
     - The network panel shows a request for `elk-worker.min-*.js` (the layout runs in a worker), and there are no console errors.
  5. **Click Robert:**
     - The person panel opens on the right, and the URL is `/people/<robert>`.
     - In focus view, the canvas re-centres on Robert.
     - **Close** returns to the tree with Robert still in focus.
  6. **Union:** click the Robert + Margaret dot. The union panel shows "Marriage, Widowed". Edit the start date (about 1955) and save: "Saved", and the canvas redraws.
  7. **Keyboard:** Tab from the toolbar into the canvas. Each card gets a visible focus outline, and the canvas pans to a card that is off-screen. Enter on a card opens its panel. Tab reaches the "+" buttons, which are named "Add a child of …".
  8. **Add from the canvas, with the duplicate check:**
     - On Susan, click "+" **child**. The Relations tab opens with **Add child**.
     - Type "Noa" / "Hale" and add. The prompt asks "Is this the existing person Noah Hale (b. 1990)?".
     - **Yes, use them** gives "They are already related this way" (Noah is already her child).
     - **No, add a new person** creates Noa, and she appears under Susan's dot.
  9. **Add a person, unconnected:** **Add a person** "Lone Test" with no connection. The toolbar shows **Disconnected people (1)**. Open it, click Lone Test: the focus view shows just them.
  10. **Sibling order:**
      - In full view, drag Mia to the left of Leo and drop. The layout redraws with Mia first.
      - Reload the page: the order holds.
      - David's Relations tab lists Mia first, and History shows "Children reordered".
      - **Move later** on Mia puts her back.
  11. **Large tree:**
      - Open "Large family (seed)". **Full** shows "This tree has 2,500 people, too many to draw at once…".
      - Choose a branch: it draws within a few seconds, and the page stays responsive while it lays out (scroll the panel meanwhile).
      - Focus view at depth 3 is quick.
  12. **Mobile:** resize to 390×844. The toolbar wraps, the canvas fills the width, and opening a person shows a bottom sheet with **Close**.
  13. **Viewer:**
      - Invite the second account as a viewer and sign in as them (private window). They see the canvas without "+" buttons.
      - The union panel has no **Edit relationship**.
      - Cards can't be dragged.
      - `GET /api/v1/trees/<a tree they're not in>/graph` with curl returns 404.
  14. **Console:** no errors. **Network:** no 500s.

  Chrome autofills the user's real saved login on sign-in and sign-up forms. Clear the fields before typing, never submit the user's real credentials, and never repeat test credentials in chat.
- [ ] **Step 5: Commit** any fixes, then `docs: family canvas, duplicate check, disconnected people, large seed`. Hand the user the summary and the manual checklist below, and wait for their result before merging.

**Manual checklist for the author** (about 25 minutes):
1. `pnpm dev`, and wait for "Server listening". Then run `pnpm seed <your email> --large 2500`.
2. Open **Sample family (seed)**. You see Leo in the middle with his parents above and Mia beside him. Mia's line is dashed.
3. Slide **Generations** to 2, then 3. Grandparents, Emma, Anna and Susan appear. Robert has † and a grey card. David and Anna's dot is grey and dashed.
4. Switch to **Full**. You see three rows. Zoom out until the cards turn into names, then dots. Use the minimap.
5. Click **Robert**: his panel opens and the view centres on him. Click the dot between Robert and Margaret and change the status. It saves and redraws.
6. Use only the keyboard: Tab to a card, then press Enter. The panel opens.
7. On **Susan**, press "+" below the card, and add "Noa Hale". It asks whether this is Noah. Answer **No** and she's added. Try again with "Noah Hale" and answer **Yes**: it says they're already related.
8. **Add a person** with no connection. **Disconnected people (1)** appears; open it and click them.
9. In Full view, drag Mia to the left of Leo. The order sticks after a reload, and Mia's History says "Children reordered".
10. Open **Large family (seed)**, then **Full**. It asks for a branch; pick one. It draws in a few seconds without freezing the page.
11. On your phone, or with a narrow window, opening a person shows a bottom sheet.
12. `pnpm test && pnpm test:int`. Everything passes.

---

## Carry-forward notes for later phases

- **Phase 6 (photos, search, relationships):**
  - **Card photos:**
    - `graphPersonSchema` gains `photoThumbUrl: string | null`, a signed URL issued in `buildTreeGraph` after the same `tree.view` check.
    - Keep the URLs short-lived (15 minutes, spec §8), and refetch the graph or the photo when one expires.
    - `PersonCardView` swaps the initials for `<img alt="">` (the name is already in the button label).
    - Don't put photo URLs in ELK input. Layout doesn't depend on them.
  - **Search:**
    - It reuses `similar.ts` only as a fallback. Move `GET /persons/similar` to `pg_trgm` (GIN indexes on all name columns, including `maiden_name` and `nickname`). Keep its response shape and `SIMILAR_LIMIT`, so `useDuplicateCheck` needs no change.
    - Selecting a search result navigates with `usePersonHref` (focus view centres on them).
    - The "branch" filter reuses `branchQuery`, which is the same rule as the full view's branch (`branchOf` with `stewardUserId = null`).
  - **"How are we related?":**
    - BFS over `kinIndex` is **not** right as-is: it treats siblings as one step. For kinship words, build parent/child/partner edges only (`family-graph.ts` `indexGraph` has them).
    - Highlight the path on the canvas with a `highlighted` flag on nodes and edges in `graphToFlow`. Show it in focus view on the "from" person, with the depth raised to fit the path, or in full view.
    - The top bar (`CanvasToolbar`) has room for the search box and the button. Add them before the View group.
  - **The toolbar and messages:** consider moving page text into one message catalog (spec §6 "Language") when phase 6 adds more UI text. Canvas strings are inline today, like the other pages.
- **Phase 7 (export, deploy, E2E):**
  - **CSP for the static site:** the canvas needs
    - `worker-src 'self'` (the ELK worker is a same-origin asset);
    - `style-src 'self' 'unsafe-inline'` (React Flow sets inline `style` attributes for transforms and node sizes; hashes can't cover dynamic values);
    - `img-src 'self' data: blob:` (and the R2/signed-URL origin from phase 6).
    The ELK main-thread fallback (`elk.bundled.js`) needs nothing extra.
  - **E2E (Playwright):** real-browser tests can cover what jsdom can't:
    - rows by generation (compare the cards' bounding boxes);
    - the drag-reorder;
    - the bottom sheet at 390px;
    - the worker request.
    Reuse the Task 18 walk-through steps.
  - **GEDCOM:** export `sibling_order` as the order of `CHIL` lines in each `FAM`.
- **Known trade-offs to revisit:**
  - **Per-request graph:** `loadGraphRows` reads the whole tree on every graph request (it's needed for `hasParents`, `hiddenRelatives`, the branch rule and the 2,000 count). That's fine for families. Profile it at 10k people; a cached per-tree skeleton invalidated on structural writes (they all take `lockTreeGraph`) is the next step.
  - **Depth cost:** focus depth counts siblings as one step, which grows quickly at depth 3 in big families. The 500-person cap guards it.
  - **Drag limits:** sibling drag is disabled when not all of a union's children are in the view, so a focus view at depth 1 can't reorder a grandparent's children.
  - **Layout quality:** ELK layered with partitions is automatic and good for most families. Pedigree collapse (cousin marriage) and remarriage across generations can give long edges. There is no manual override, by design (spec §6).
