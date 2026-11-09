# Family Tree — Design Spec

- **Date:** 2026-11-09
- **Status:** Approved in brainstorming, pending written-spec review
- **Working name:** `family-tree`
- **License:** AGPL-3.0

## 1. Purpose

A self-hostable, open-source web app where families build **one collaborative family graph** together. The creator starts with themselves, adds everyone they know (including in-laws), then shares invite links so relatives complete their own side. The author runs a public instance; anyone can sign up and create their own tree, or self-host.

### Goals
- Grow the tree easily in every direction: up (parents, grandparents), down (children, grandchildren), sideways (partners, siblings).
- Model real families: remarriage, divorce, half-siblings, adoption, step-relations, same-sex couples, unknown parents.
- Each side of the family is maintained by the people who know it (branch stewardship).
- Strict access control. Family data is moderately sensitive and must not leak.
- Cheap to host (about €4–5 a month) and easy to self-host.

### Non-goals (v1)
GEDCOM import, translations/RTL, a map of places, co-owners, free-form card dragging, sending email, DNA, record matching.

## 2. Architecture

```
 Browser (React + React Flow)            Cloudflare Pages
        │  HTTPS, session cookie
        ▼
 Caddy (TLS) ──► Fastify API (TypeScript)    Hetzner VPS, Docker Compose
                     │             │
                PostgreSQL     S3-compatible storage (R2 in prod, MinIO in dev)
```

### Repository layout (monorepo, pnpm workspaces)
- `apps/web` — React + TypeScript + Vite, React Flow for the canvas, `elkjs` for layout.
- `apps/api` — Fastify + TypeScript, Drizzle ORM, Better Auth, sharp.
- `packages/shared` — Zod schemas, shared types, the fuzzy-date utilities, and permission constants.
- `docs/` — specs, plans, and `self-hosting.md`.

### Environments
| | Dev (local) | Prod |
|---|---|---|
| Run | `docker compose up` | `docker compose -f compose.yml -f compose.prod.yml up -d` |
| Services | api (hot reload), web (Vite), postgres, minio | api, postgres, caddy |
| Frontend | Vite dev server | Static build on Cloudflare Pages at `family.cortextechservices.com` |
| API | `localhost` | `api.family.cortextechservices.com` |
| Photos | MinIO, stored in a Docker volume | Cloudflare R2, private bucket |
| Config | `.env.development` (committed, safe values) | `.env.production` (never committed); `.env.production.example` is committed |

- The API validates its config with Zod at startup and refuses to start on missing or invalid values. In prod it rejects dev secrets and `localhost` endpoints.
- A seed script creates a sample family for development.
- Nothing is deployed until the author runs the manual deploy steps.

## 3. Data model

All primary keys are UUIDs. Every tree-scoped table has a `tree_id`. Every soft-deletable table has `deleted_at` and `deletion_batch_id`, and normal queries exclude deleted rows.

| Table | Key columns |
|---|---|
| `users` (and other Better Auth tables) | email, password hash (Argon2id), Google account link, TOTP secret, recovery codes (hashed) |
| `trees` | id, name, `owner_user_id`, created_at, deleted_at |
| `tree_members` | tree_id, user_id, role (`owner` \| `editor` \| `viewer`), `person_id` (the user's own card, nullable), `invited_by` |
| `branch_stewards` | tree_id, user_id, `anchor_person_id`, `granted_by` |
| `persons` | given_name, middle_name, surname, maiden_name, nickname, sex, birth_date, birth_place, death_date, death_place, cause_of_death, is_living, occupation, education, biography, notes, primary_photo_id, sibling_order, version, created_by, updated_by |
| `unions` | partner_a_id (nullable), partner_b_id (nullable), type (`marriage` \| `partnership`), status (`married` \| `partners` \| `divorced` \| `separated` \| `widowed`), start_date, end_date |
| `parent_child` | union_id, child_id, kind (`biological` \| `adoptive` \| `step` \| `foster`) |
| `residences` | person_id, place, from_date, to_date |
| `photos` | person_id, storage_key_full, storage_key_thumb, width, height, bytes, is_primary, uploaded_by |
| `invites` | token_hash, tree_id, role, steward_anchor_person_id (nullable), target_person_id (nullable), created_by, expires_at, used_at, used_by, revoked_at |
| `reset_links` | token_hash, user_id, created_by, expires_at, used_at |
| `deletion_batches` | id, tree_id, deleted_by, root_person_id, mode (`person` \| `descendants`), created_at, restored_at |
| `audit_log` | tree_id, user_id, action, entity_type, entity_id, before (jsonb), after (jsonb), created_at |

### Rules
- **Children belong to unions, never to a single person.** A single known parent is a union with one partner left empty. Half-siblings are children of different unions that share one partner.
- **Fuzzy dates** are stored as `{ qualifier: exact|about|before|after|between, date1, date2?, precision: day|month|year }` plus a derived `sort_year` column used for indexing, sorting and range filters.
- **Places** are free text in v1.
- **Optimistic concurrency.** Updates to a person must send the `version` they edited. A mismatch returns `409 CONFLICT`.
- **Search** uses the `pg_trgm` extension with GIN indexes on the name columns.
- **Tree limits** are set in config: 3 trees per user and 1 GB of photos per tree by default.

## 4. Permissions

### Roles
- **Owner:** exactly one per tree; ownership can be transferred.
- **Editor:** can add and edit anywhere in the tree.
- **Viewer:** read only.
- **Steward:** an extra grant on top of a base role, anchored on a person A.

### Branch of anchor A
1. A.
2. All ancestors of A.
3. All descendants of those ancestors, including A's own descendants.
4. Partners of anyone in 1–3, **unless** that partner has their own parents recorded in the tree. Such a partner belongs to their own side.
5. Any person the steward created.

The branch is computed with a recursive CTE whenever it's needed, so it grows automatically. A person can be in more than one branch.

### Permission matrix

| Action | Owner | Steward (in branch) | Editor | Viewer |
|---|---|---|---|---|
| View tree, search, relationship path | ✅ | ✅ | ✅ | ✅ |
| Add people and relations | ✅ | ✅ | ✅ | ❌ |
| Edit people and relations, upload photos | ✅ | ✅ | ✅ | ❌ |
| Delete people or relations (to Trash) | ✅ | ✅ | ❌ | ❌ |
| Restore from Trash | ✅ | ❌ | ❌ | ❌ |
| Create viewer and editor invites | ✅ | ✅ | ❌ | ❌ |
| Grant stewardship | ✅ | ✅ (anchor inside own branch) | ❌ | ❌ |
| Change or remove members, revoke invites | ✅ | Only people they invited | ❌ | ❌ |
| Empty Trash permanently, delete tree, transfer ownership, export | ✅ | ❌ | ❌ | ❌ |

- Outside their branch, a steward acts with their base role.
- Every API route authorises through a single `can(user, action, target)` function. Nothing relies on the UI hiding buttons.
- Trees the user can't access return **404**, never 403.

### Deletion
- Deleting a person always shows a **preview** first, and the owner or steward chooses:
  - **Just this person:** the person and their union and parent–child links are removed. Relatives stay in the tree and are flagged as disconnected.
  - **This person and their descendants:** also removes descendants, plus partners of those descendants who have no other connection to the tree.
- Every delete is soft and grouped in a `deletion_batch`. The owner restores a whole batch from Trash, or erases it permanently.
- Deleting the whole tree is also soft. It can be restored for 30 days, then a scheduled job purges it, including its photos.

## 5. Authentication and accounts

- Sign in with email and password or with Google, both through Better Auth. Emails are not verified and no email is ever sent; the email address is only a login name.
- **Sign-up is open to anyone.**
- **Invites:**
  - The owner or a steward creates an invite link with a role, an optional steward anchor, and an optional target person ("this is you").
  - The link is sent by the inviter through any channel they choose.
  - Each link is single-use, expires after 7 days by default, is stored hashed, and can be revoked.
  - Opening it leads to sign-up or login, then the user joins the tree as that role and person.
- **2FA (TOTP authenticator app):**
  - Optional for editors and viewers.
  - **Required for owners and stewards.** Owner and steward permissions don't take effect until TOTP is enrolled, and the user is prompted to enrol.
  - Enrolling shows 8 one-time recovery codes, once.
- **Password reset without email:**
  - With TOTP: email plus a current TOTP code, or a recovery code.
  - Without TOTP: the tree owner creates a one-time reset link for the member, valid for 24 hours.
  - All of this is rate-limited, with a lockout after 5 failed attempts.
- **Account deletion** removes the account and its memberships. Person cards the user created stay in the tree. Their own card stays but is unlinked from the login.
- **Owner continuity:** ownership can be transferred, and the docs recommend designating a successor.

## 6. User interface

### Screens
1. **Auth:** sign in, sign up, Google, TOTP enrolment and challenge, recovery codes, password reset. Opening an invite link lands here, then goes straight into the tree.
2. **My trees:** owned and shared trees, and "Start a new tree". Starting a tree asks for the user's own details first and makes that person the root and default focus.
3. **Tree page:**
   - Top bar: search, a Focus/Full switch, a depth slider (1–3), "How are we related?", Members, and Trash (owner only).
   - Canvas with pan, zoom and a minimap.
   - Side panel for the selected person. On mobile it becomes a bottom sheet.
4. **Members:** members and roles, stewards and their anchors, open invites, and "Create invite link".
5. **Trash** (owner): deletion batches, each with Restore and Erase permanently.

### Canvas
- **Focus view (default):** centred on one person, with depth 1 showing parents, siblings, partners and children. The depth slider goes up to 3. Clicking a person re-centres the view.
- **Full view:** the whole accessible tree. Cards simplify by zoom level: full card, then name and years, then a dot. If a tree is too large to load at once, the full view loads it by branch.
- **Layout:** automatic only, using an ELK layered layout with unions as hidden intermediate nodes, so generations sit in rows. The only drag action is reordering siblings, which updates `sibling_order`.
- **Lines:** solid for biological, dashed for adoptive, dotted for step and foster. A divorced or separated union is shown greyed and broken. A person with several partners sits between separate union nodes.
- **Person card:**
  - Photo, or a neutral silhouette with initials when there's none.
  - Name and birth–death years, with † and a grey frame if deceased.
  - "+" buttons for parent (top), partner or sibling (sides) and child (bottom), shown only to users who can add.
  - Adding a child to someone with several partners asks which union the child belongs to, or "unknown other parent".
- **Union node ●:** clicking it edits the union's type, status and dates.

### Adding a person
- Quick-add form: name, sex and approximate birth year. More fields are filled in later in the panel.
- **Duplicate check:** before creating, the app runs a fuzzy match on name and birth year and offers "Is this the existing person …?" so the user can link instead of creating a duplicate.

### Person panel tabs
Info, Places, Photos (upload, crop in the browser, set primary), Relations, and History (from the audit log).

### Search and relationships
- **Search box:** tolerates typos and searches all name fields. Filters: birth/death year range, place, living or deceased, and branch. Each result shows a photo, name, years and relationship to the current user. Selecting one focuses the tree on that person.
- **"How are we related?":** finds the shortest path between two people (breadth-first search over the parent, child and partner edges). It shows the path as English kinship words (for example "your father's sister's husband") and highlights it on the canvas.

### Language
English only. All interface text lives in one message catalog so translations can be added later.

## 7. API

- REST and JSON under `/api/v1`. Zod schemas come from `packages/shared`, and OpenAPI docs are generated from them.
- **Resources:** `trees`, `members`, `stewards`, `invites`, `persons`, `unions`, `parent-child`, `residences`, `photos`, `trash`, `export`, `reset-links`.
- **Main read endpoint:** `GET /trees/:id/graph?focus=<personId>&depth=1..3`, or `?mode=full&branch=`. It returns everything the canvas needs in one response.
- **Other endpoints:**
  - `GET /trees/:id/search?q=&filters`
  - `GET /trees/:id/relationship?from=&to=`
  - `POST /trees/:id/persons/:pid/delete-preview` and `POST .../delete`, where `mode` is `person` or `descendants`
  - `POST /trash/:batchId/restore`
  - `GET /trees/:id/export`, which returns a GEDCOM 5.5.1 file plus a ZIP of photos
- **Error format:** `{ error: { code, message, details? } }`. Codes include `VALIDATION`, `NOT_FOUND`, `FORBIDDEN` (only within a tree the user can see), `CONFLICT`, `RATE_LIMITED` and `QUOTA_EXCEEDED`.

## 8. Security

- **Sessions:** cookies that are `httpOnly`, `Secure` and `SameSite=Lax`. Frontend and API share the registrable domain `cortextechservices.com`. There's a CORS allowlist and an Origin header check on state-changing requests.
- **Passwords:** Argon2id. Login, reset, TOTP and invite redemption are rate-limited with `@fastify/rate-limit`.
- **Authorisation:**
  - UUIDs everywhere, and `can()` is called on every route.
  - Integration tests assert that user X can't read or modify tree Y through any endpoint.
- **Tokens:** invite and reset tokens are 32 random bytes from a secure generator. Only the SHA-256 hash is stored. They're single-use and expire.
- **Browser hardening:**
  - Security headers via `@fastify/helmet`, plus a strict CSP on the frontend.
  - User content is never rendered as HTML; the biography is plain text with line breaks.
- **Photos:**
  - Uploaded through the API with a 10 MB limit. JPEG, PNG and WebP only, checked by magic bytes.
  - Re-encoded with sharp, which strips EXIF and GPS data. Stored as a 1600 px version and a 256 px thumbnail.
  - The bucket is private. Access is through signed URLs valid for 15 minutes, issued after an authorisation check. Photos count towards the per-tree quota.
- **Infrastructure:**
  - PostgreSQL is not exposed publicly, and the database user has least privilege.
  - The firewall allows only ports 22, 80 and 443. SSH is key-only.
- **Secrets:** kept only in `.env.production`.
- **Backups:** a nightly `pg_dump`, encrypted with `age` and uploaded to R2. The last 14 are kept.
- **Logging:** structured logs with pino. No personal data, tokens or passwords appear in logs. The audit log records every change to tree data.

## 9. Testing

Development follows TDD.

- **Unit tests (Vitest):**
  - the permission matrix, cell by cell
  - branch membership
  - fuzzy-date parsing, sorting and `sort_year`
  - relationship pathfinding and kinship wording
  - graph-to-layout transformation
  - delete-preview computation
  - config validation
- **Integration tests:** real PostgreSQL and MinIO in Docker. They cover every endpoint, including cross-tree isolation tests, the invite lifecycle, TOTP and reset flows, quotas and photo processing (the EXIF stripping is verified).
- **End-to-end tests (Playwright):** sign up → create tree → add parents, a partner and children → create an invite → second user joins as steward → steward edits and deletes in their branch → owner previews and restores from Trash.
- **CI (GitHub Actions):** lint, type-check, unit, integration and E2E tests, and Docker image build on every push.

## 10. Deployment

1. CI builds the API image and pushes it to GHCR.
2. On the VPS: `docker compose pull && docker compose up -d`. Migrations run at startup with drizzle-kit, and the health check on `/health` gates readiness.
3. The frontend is deployed with `wrangler pages deploy`.
4. DNS: `family.cortextechservices.com` points to Cloudflare Pages, and `api.family.cortextechservices.com` points to the VPS.
5. `docs/self-hosting.md` documents the same steps for other people.

Estimated cost: Hetzner CX22 at about €4–5 a month. Cloudflare Pages is free, and R2 is free up to 10 GB.

## 11. Future (post-v1)
GEDCOM import, translations (including RTL and the Solar Hijri calendar), a map of places, co-owners, optional free dragging with saved positions, and an optional email provider for notifications.
