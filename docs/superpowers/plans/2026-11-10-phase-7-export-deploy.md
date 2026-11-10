# Phase 7 — Export, Production Stack, Backups and End-to-End Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The tree owner can **export** the whole tree as one ZIP: `tree.ged` (GEDCOM 5.5.1, UTF-8), the photos, and `tree.json`, a full JSON copy of the data. The ZIP is streamed, so memory stays bounded. The repository gains everything needed to run the app in production, all **verified on this machine only**:
- a production compose file with Caddy in front of the API;
- Postgres with a least-privilege app role;
- strict security headers for the static site;
- nightly age-encrypted database backups, a photo-bucket mirror, a restore procedure, and a restore test that is actually run;
- a sweep for orphaned photo objects;
- `docs/self-hosting.md` and `docs/deployment.md`;
- the full Playwright end-to-end suite.

**Nothing is deployed, pushed or published.** There are no DNS changes, and no calls to Cloudflare, Hetzner or R2.

**Architecture:**
- **Shared (`packages/shared`):** `export.ts` holds the `tree.json` schema (`exportDataSchema`, format `family-tree-export`, version 1) and the export size limit.
- **API, export:**
  - `export/zip.ts`: a small streaming ZIP writer (no new dependency). It uses `node:zlib` `crc32` and `deflateRawSync`, waits for backpressure, and refuses anything that would need ZIP64.
  - `export/gedcom.ts`: a pure GEDCOM 5.5.1 writer. It covers fuzzy dates (`ABT`/`BEF`/`AFT`/`BET … AND …`), names with maiden names and nicknames, `SEX`, `BIRT`/`DEAT` with `CAUS`, `OCCU`, `EDUC` and `RESI`. Unions become `FAM` records with `MARR`, partnership and separation `EVEN`s, and `DIV`. Child kinds become `PEDI`. `CHIL` lines follow `sibling_order`, and photos become `OBJE` records. Long text uses `CONT`/`CONC`, and `@` is written `@@`.
  - `export/load.ts`: one `REPEATABLE READ`, read-only snapshot of the live tree.
  - `export/write.ts`: streams the photos one at a time from `ObjectStore.get`, then writes the GEDCOM and the JSON.
  - `routes/export.ts`: `GET /trees/:id/export`. Only the owner may call it (`tree.export`). It is limited to 5 per hour per user and 2 at once per process.
- **API, operations:**
  - `db/migrate-cli.ts` and `MIGRATE_ON_START`: production migrates in a one-shot service, as the owner role.
  - `AUTH_RATE_LIMIT_ENABLED`: turned off only for the E2E dev stack. Production refuses it.
  - `storage/sweep.ts`: the orphan sweep, run daily by the purge job and by the CLI.
- **Web:**
  - `security-headers.ts`: one source for the CSP and the other headers. A Vite build plugin renders it into `dist/_headers` for Cloudflare Pages, and into `dist/_headers.caddy` for the local stand-in.
  - An **Export** section in Tree settings.
- **Infrastructure:**
  - `compose.prod.yml`: postgres, migrate, api, caddy, and backup (a `tools` profile).
  - `docker/caddy/`: `Caddyfile`, `Caddyfile.local` and the shared `api.caddy`.
  - `docker/postgres/prod-init/`: the app role and idempotent grants.
  - `docker/backup/`: the image, `backup.sh`, `restore.sh` and systemd units.
  - `compose.prod.local.yml` and `scripts/prod-local.sh`: the production stack on localhost. It uses `*.family.test` names, Caddy's local CA, SeaweedFS behind TLS as a stand-in for R2, and Caddy serving the web build as a stand-in for Pages.
- **E2E (`e2e/`, a new workspace package):**
  - Playwright 1.64.1 with Chromium's headless shell.
  - A global setup that seeds the sample family through the dev stack.
  - The spec §9 journey, plus specs for photos, search, relationships, canvas, export and the viewer.
  - A `@smoke` spec for the local production stack.
- **CI:**
  - An `e2e` job.
  - A **manual** (`workflow_dispatch`) GHCR release workflow that never runs on its own.

**Tech Stack:** Fastify 5.12.8, Drizzle 0.45.4, Postgres 17 (prod image `postgres:17.11-alpine`), Better Auth 1.7.18, `@aws-sdk/client-s3` 3.1164.0, sharp 0.35.5, Zod 4.6.7, React 19.3.1, Vite 8.3.6, Vitest 5.1.0, Node 24 (`zlib.crc32`), Caddy `2.11.6-alpine`, SeaweedFS 4.00 (local only), age 1.3 and rclone 1.75 (Alpine 3.24 packages in the backup image).
- **New:** `@playwright/test` **1.64.1** (published 2026-10-14), with `playwright` and `playwright-core` 1.64.1 (same day). It needs Chromium headless shell 156.0.8078.4 (revision 1248). It lives in `e2e/` only.
- **Reused:** `e2e/` also uses `@better-auth/utils` 0.5.1 and `sharp` 0.35.5, which are already locked, so they add no new lockfile packages.

---

## Ground rules (read first)

- **Branch:** `phase-7-export-deploy`, created from `main` at `6ee85d2` (Phase 6 merged). This plan is its first commit.
  - Commit after each task. **Never push**: not branches, not tags, not images.
  - Never commit:
    - `.env.production`
    - `.prod-local/`
    - `e2e/.state/`, `e2e/test-results/`, `e2e/playwright-report/`
    - `graft/`
    - `.ignore`
    - `.claude/settings.local.json`
    - `.vitest/`
- **Nothing goes public.**
  - Phase 7 produces files and docs only.
  - The production stack runs only on this machine, through `scripts/prod-local.sh`. It binds `127.0.0.1:8080` and `127.0.0.1:8443`, uses Caddy's **local CA** (no ACME), and uses SeaweedFS instead of R2.
  - Never run `wrangler`, never call the Cloudflare, Hetzner or R2 APIs, never change DNS, and never `docker push` or `docker login`.
  - The GHCR workflow is `workflow_dispatch` only. It must not have `push:` or `schedule:` triggers.
- **Dependencies:**
  - The only new ones are in Task 1: `@playwright/test` 1.64.1 with exact pins. Every new lockfile package must be at least 14 days old. Check with `node /tmp/claude-1000/-home-hsafari99-Documents-hosseinRepos/6cfbb749-c0ee-4dd2-8a46-7c605b6d051b/scratchpad/check-ages.mjs pnpm-lock.yaml` (called `<check-ages>` below). It compares against `HEAD` by default, or against a base commit given as the second argument.
  - **Never** add `minimumReleaseAge` or `minimumReleaseAgeExclude`, and never pass them on the command line.
  - Never upgrade existing dependencies. **Vite stays at 8.3.6.**
  - **The dev CPU (Xeon E5-1650 v2, Ivy Bridge) has no AVX2.** The Playwright browser is the only new native binary. Task 1 checks it first, with a **STOP and report BLOCKED** rule. No other native tooling is added. Caddy, rclone and age are Go binaries for baseline x86-64.
  - Container images are pinned to exact tags: `caddy:2.11.6-alpine` (2026-10-04), `postgres:17.11-alpine`, `chrislusf/seaweedfs:4.00`, and `koalaman/shellcheck:v0.10.0` (lint only).
- **Running things:**
  - The dev stack: `pnpm dev`. For E2E, use `AUTH_RATE_LIMIT_ENABLED=false pnpm dev` (decision 15).
  - Integration tests: `docker compose up -d --wait postgres s3`, then `pnpm test:int`. The dev SeaweedFS runs with `-volume.max=100`, so the dev and test buckets both fit. Don't lower it.
  - From the root: `pnpm test`, `pnpm test:int`, `pnpm lint` (the web package has no lint script; always use the root one), `pnpm typecheck`, `pnpm format:check`, `pnpm build`, and `pnpm test:e2e` (new).
- **Single test files.** Always use `rtk proxy pnpm exec vitest`, never plain `pnpm exec vitest`: rtk mangles vitest output.
  - API unit: `rtk proxy pnpm --filter @family-tree/api exec vitest run src/path/file.test.ts`
  - API integration: `rtk proxy pnpm --filter @family-tree/api exec vitest run --config vitest.int.config.ts src/path/file.int.test.ts`
  - Web: `rtk proxy pnpm --filter @family-tree/web exec vitest run src/path/file.test.tsx`
  - Shared: `rtk proxy pnpm --filter @family-tree/shared exec vitest run src/file.test.ts`
  - E2E: `pnpm --filter @family-tree/e2e exec playwright test tests/file.spec.ts`
- **Rules from earlier phases (unchanged):**
  - **Lock order for writes:**
    1. `lockTreeGraph(tx)`
    2. the `trees` row
    3. the batch
    4. the rows
    Call `loadAccess(tx)` after the lock. The export **writes nothing**, so it takes no lock. It reads one `REPEATABLE READ READ ONLY` snapshot instead, calling `loadAccess` inside it (decision 4).
  - **Order inside a route:**
    1. `loadAccess` (outsiders get **404**).
    2. Parse the input.
    3. Load the target.
    4. `authorize` (members without the right get **403 FORBIDDEN**).
    5. Do the work.
  - **Error messages:** only `AppError` messages reach clients. The web maps error **codes** and `details.reason` to fixed messages.
  - **Signed URLs** are issued only after the access check. Never log them.
  - **Browser:**
    - No `window.confirm` or `alert`. Destructive buttons use the two-step `ConfirmButton`.
    - User content is never rendered as HTML.
    - Dark mode uses the `Canvas`/`CanvasText` system-colour tokens already in `styles.css`. New CSS must not hard-code light colours.
  - **Logs:** never log personal data, tokens, passwords, signed URLs or request bodies. Caddy has **no access log** (decision 11).
- **Code in this plan** is the intended implementation. If the real code has moved on (names, imports, component labels), follow the repo and keep the behaviour. This matters most for the E2E locators: before writing a spec, read the components it drives. Run `pnpm format` before each commit.

## Decisions taken in this plan (beyond the spec)

1. **Dependencies and the browser on a CPU without AVX2:**
   - Playwright **1.64.1** (2026-10-14) is the newest release at least 14 days old. 1.65.0 came out on 2026-11-05.
   - `@playwright/test` → `playwright` → `playwright-core`. None of them has an install script, and `fsevents` is an optional macOS-only package.
   - Browsers are **not** downloaded on install. Task 1 runs `playwright install --only-shell chromium`, which fetches only Chrome Headless Shell 156 (revision 1248) into `~/.cache/ms-playwright`.
   - Chrome needs SSE3, not AVX2. While writing this plan, another project's Chrome Headless Shell 145 printed its version on this CPU. Task 1 still runs a real page, a canvas, a worker and WebAssembly as a **gate**.
     - On `Illegal instruction`, exit code 132, or "browser has been closed" at launch: **stop and report BLOCKED.**
     - Don't silently switch to the system Chrome (`channel: 'chrome'`) or to an older Playwright. List those as options in the report.
2. **Export contents (spec §7, plus the JSON):**
   - **The files:**
     - `tree.ged`
     - `tree.json`
     - `photos/I<n>-<k>.webp`: the full 1600 px versions, the primary photo first (`k = 1`). Thumbnails are not included.
   - **What's left out:**
     - Only live data is exported. Trash, the audit log, members, emails, invites and stewards are left out. That is family data, not account data, and other users' emails are not the owner's to export.
     - Storage keys and signed URLs never appear.
   - **Missing objects:** a photo whose object is gone (for example after an old restore) is left out. It gets `file: null` in the JSON and no `OBJE`, and the export still succeeds.
3. **Who may export:** the owner only (spec §4 matrix, `tree.export` in `can.ts`).
   - Editors, viewers and stewards get 403. Outsiders get 404, and the route joins the isolation test.
   - The web shows the section only with `capabilities.manageTree`, which is owner-only. Its doc comment is updated to mention export.
4. **Consistency without locks:**
   - The export reads everything in one `REPEATABLE READ READ ONLY` transaction (as `loadGraphRows` does), with `loadAccess` inside it, then commits before streaming.
   - No advisory lock is held while photos stream, so writers are never blocked.
   - Photos are fetched after the snapshot. One deleted in between is simply missing (decision 2).
5. **Living people:** the spec says nothing about redacting them, and only the owner, who already sees everything, can export. So the export **does not redact living people**.
   - The Export section says plainly that the file contains living relatives' details and should be kept private.
   - A redacting "share" export is a carry-forward item.
6. **GEDCOM 5.5.1 encoding:**
   - **The file format:**
     - `1 CHAR UTF-8`, with a UTF-8 BOM (GEDCOM 5.5.5 recommends it, and Gramps, RootsMagic, Ancestry and MyHeritage accept it).
     - CRLF line endings.
     - Each line has at most 255 bytes, because values are cut at 200 UTF-8 bytes.
     - `@` in values is written `@@`.
     - Multi-line text (biography, notes) uses `CONT` for line breaks and `CONC` for long lines. A split never lands next to a space, inside a code point or inside `@@`.
     - Single-line values (places, occupation, cause of death) collapse whitespace and are cut at 240 bytes with `…`. `tree.json` keeps the full text.
   - **Dates:**
     - `exact`: `12 MAR 1950`, `MAR 1950` or `1950`.
     - `about`: `ABT …`; `before`: `BEF …`; `after`: `AFT …`; `between`: `BET … AND …`.
     - Residence periods are `FROM <date1> TO <date1>` (the qualifier is dropped, because 5.5.1 periods take plain dates).
   - **Names and sex:**
     - `NAME Given Middle /Surname/`, with `GIVN`, `SURN` and `NICK`.
     - A maiden name is a second `NAME` with `2 TYPE maiden`.
     - A `/` inside a name part becomes a space.
     - `SEX` is `F`, `M`, or `U` (for other or unknown).
   - **Events:**
     - `BIRT` and `DEAT` take `DATE`, `PLAC` and (for death) `CAUS`.
     - A deceased person with no details gets `1 DEAT Y`.
     - `OCCU`, `EDUC`, `RESI` (with `PLAC`), and `NOTE` for the biography and for the notes.
   - **Unions** become `FAM` records:
     - A marriage is `MARR`; a partnership is `EVEN` with `TYPE Partnership`. Either is written only when both partners are known or there is a start date, so a "single known parent" union carries no fake marriage. With no date, a marriage is `MARR Y`.
     - Divorced is `DIV` with the end date (or `DIV Y`). Separated is `EVEN` with `TYPE Separation`. Widowed adds nothing, because the death says it.
     - **`HUSB`/`WIFE`:** if exactly one partner is female, she is `WIFE`. Otherwise partner A is `HUSB` and partner B is `WIFE`. A single partner is `WIFE` if female, otherwise `HUSB`. GEDCOM 5.5.1 has no neutral role, and `tree.json` keeps the truth.
     - `CHIL` lines are ordered by `sibling_order`, then birth year, then person order (the Phase 5 carry-forward).
   - **Child kinds:** biological is `PEDI birth`, adoptive is `PEDI adopted`, and foster is `PEDI foster`. 5.5.1 has no step value, so a step child gets `2 NOTE Step-child` (the Phase 4 carry-forward).
   - **Media:** `OBJE` records have `FILE photos/…webp`, `FORM webp` and `TYPE photo`. Each `INDI` links its photos, primary first.
   - **Xrefs:** `@I<n>@`, `@F<n>@` and `@O<n>@`, numbered in snapshot order (`created_at`, then `id`), so the same tree exports the same way. `@U1@` is the submitter: the exporting owner's display name.
   - **The header:** `SOUR FAMILY-TREE`, `GEDC VERS 5.5.1`, `FORM LINEAGE-LINKED`, and `DATE`/`TIME` in UTC.
7. **The ZIP writer:**
   - It is our own small writer (`export/zip.ts`, about 150 lines) instead of `archiver` or `yazl`, so there's no new dependency.
   - **The format:**
     - PKZIP 2.0 local headers with known sizes. There are no data descriptors, because each entry is fully in memory before it's written: one photo (≤ a few MB), or the GEDCOM or JSON.
     - The UTF-8 name flag (bit 11) is set.
     - Text is deflated with `deflateRawSync`. WebP photos are **stored**, since they're already compressed.
     - DOS time is UTC.
   - **Memory and backpressure:** memory is one photo plus the text files. `add()` waits for `drain`, so a slow client slows the reading of photos rather than growing a buffer.
   - **Limits:** more than 65,535 entries, or an offset past 4 GiB, throws `ZipTooLarge`. The route checks first that the live photos' stored bytes (an upper bound) are under **3.5 GB**. Over that, it answers `400 VALIDATION` with `reason: 'tooLarge'`. The default photo quota is 1 GiB, so this only matters for raised quotas. ZIP64 is a carry-forward.
   - **Entry names** must match `[A-Za-z0-9._\-/]`, with no leading `/` and no `.` or `..` segments, so no zip-slip is possible.
8. **Export limits (spec §8, "heavy endpoints"):**
   - **5 exports per hour per user** (`extraLimit`, `by: 'user'`). Over that is `429 RATE_LIMITED`.
   - **2 concurrent exports per API process.** Over that is `503 RATE_LIMITED` with `Retry-After: 30`.
   - The response is `Content-Type: application/zip`, with `Content-Disposition: attachment; filename="family-tree-YYYY-MM-DD.zip"` (ASCII only) and `Cache-Control: no-store`.
   - **Failures:**
     - If the client goes away, the writer stops at the next photo.
     - An S3 error other than a missing object destroys the stream. The client sees a failed download, and the server logs `export failed` with no personal data.
     - A success logs `{ treeId, persons, photos, missing }`.
   - **No audit row:** an export changes nothing (spec §8, "every change").
9. **The web download:**
   - **Download export** `fetch`es the ZIP with credentials, turns it into a blob, then into an object URL, and clicks an `<a download>`.
   - This gives proper error messages (rate limited, too large) instead of a JSON page. Browsers keep large blobs on disk.
   - The file name comes from `Content-Disposition`.
10. **The production layout:**
    - `compose.prod.yml` is **standalone**: `docker compose --env-file .env.production -f compose.prod.yml up -d`. It is not overlaid on `compose.yml` as spec §2 suggests, because the dev services (install, web, SeaweedFS) must never run on the server. The docs say so.
    - **Values:** all of them come from `.env.production` through compose interpolation, and the services list exactly the variables each one gets. So the API never sees the Postgres owner password, and the database URLs are built from the two passwords. Passwords are hex (`openssl rand -hex 32`), so they are URL-safe.
    - **Networks:** `db` is internal (postgres, migrate, api, backup). `edge` has egress (api, caddy, backup). **Postgres publishes no port** (spec §8).
    - **The API container:** read-only root filesystem, `tmpfs /tmp`, `cap_drop: [ALL]`, `no-new-privileges`, and a Node `fetch` health check.
11. **Caddy:**
    - **TLS:** Let's Encrypt for `{$API_DOMAIN}` (spec §2). `request_body max_size 12MB`, a little above the 10 MB photo limit. It removes `Server` and `Via`.
    - **Logging:** no `log` directive, so there is no access log of client IPs or paths (spec §8).
    - **Proxy headers:** Caddy replaces incoming `X-Forwarded-For`, so `TRUST_PROXY=1` stays correct (the Phase 1 carry-forward is already done).
    - **No duplicate headers:** HSTS and the other API security headers come from `@fastify/helmet`, and Caddy doesn't repeat them.
12. **Least privilege in Postgres (spec §8):**
    - **Roles:**
      - `family_owner` is the image's `POSTGRES_USER`. It owns the database and runs migrations. The image makes it a superuser, which is acceptable because the database isn't exposed (a carry-forward item).
      - `family_app` can log in, with `SELECT, INSERT, UPDATE, DELETE` on the tables and `USAGE` on the sequences in `public`, through `ALTER DEFAULT PRIVILEGES FOR ROLE family_owner`. It has no `CREATE`, no access to the `drizzle` schema, and no `TRUNCATE`.
    - **The grants** are in one idempotent file, `docker/postgres/prod-init/20-app-grants.sql`, run at the first start and again by `restore.sh`. Role and database names are fixed (`family`, `family_owner`, `family_app`).
    - **Migrations (spec §10, "migrations run at startup"):** a one-shot `migrate` service runs `node dist/db/migrate-cli.js` with `MIGRATION_DATABASE_URL` (the owner role), and the API waits for it (`service_completed_successfully`).
    - **The API** runs with `MIGRATE_ON_START=false` and the app role. Dev and tests keep migrating on start (the default is `true`).
13. **Security headers for the static site (spec §8 "strict CSP"; the Phase 5 and 6 carry-forwards):**
    - **`Content-Security-Policy`:**
      - `default-src 'none'`
      - `script-src 'self'`
      - `style-src 'self' 'unsafe-inline'` (React Flow's inline style attributes)
      - `img-src 'self' data: blob: <photo origin>`
      - `connect-src 'self' <API origin>`
      - `worker-src 'self'` (the ELK worker)
      - `font-src 'self'`
      - `manifest-src 'self'`
      - `base-uri 'none'`
      - `form-action 'self'`
      - `frame-ancestors 'none'`
      - `object-src 'none'`
    - **Other headers:**
      - `Referrer-Policy: no-referrer`
      - `X-Content-Type-Options: nosniff`
      - `X-Frame-Options: DENY`
      - `Cross-Origin-Opener-Policy: same-origin`
      - a restrictive `Permissions-Policy`
      - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
    - **Caching:** `/assets/*` gets `Cache-Control: public, max-age=31536000, immutable`.
    - **Origins:** they come from `VITE_API_BASE_URL` and the new `VITE_PHOTO_ORIGIN`, at build time.
    - **The build output:**
      - The Vite plugin writes `dist/_headers` (Cloudflare Pages format).
      - With `WEB_HEADERS_CADDY=1`, it also writes `dist/_headers.caddy` for the local stand-in.
      - Without the variables it only warns, so CI and dev builds still work. On Cloudflare Pages (`CF_PAGES=1`), missing variables **fail the build**, so the site can't ship without a CSP.
14. **Backups (spec §8; the Phase 6 carry-forward):**
    - **The database** (`backup.sh`):
      1. `pg_dump -Fc --no-owner --no-privileges` to a temp file.
      2. `pg_restore --list` (the dump must be readable).
      3. Encrypt with `age -r $AGE_RECIPIENT`.
      4. `rclone copyto` to `<BACKUP_ROOT>/db/family-<UTC timestamp>.dump.age`.
      5. Check the uploaded size.
      6. Only then prune to the newest `BACKUP_KEEP` (14).
      A failed dump never uploads anything, and never rotates out a good backup.
    - **Photos:** `rclone sync photos:<bucket> <BACKUP_ROOT>/photos/current --backup-dir <BACKUP_ROOT>/photos/deleted/<timestamp>`. Deleted or changed objects are kept for 14 runs.
      - The photo mirror is **not** age-encrypted. It is a second private bucket inside the same trust boundary as the live, unencrypted photo bucket.
      - The database dump is encrypted because it holds password hashes and every person's details in one file.
    - **The private age key** is never on the server. It is kept offline by the author and mounted only for a restore.
    - **Restore** (`restore.sh`), with the API stopped:
      1. Fetch and decrypt the dump.
      2. Check it with `pg_restore --list`.
      3. `drop database … with (force)`, then `create database … owner family_owner`.
      4. Apply the grants.
      5. `pg_restore --no-owner --no-privileges --exit-on-error --single-transaction`.
      6. Apply the grants again.
      7. `rclone copy` the photos back. This never deletes; the orphan sweep removes extras later.
      The order is **database, then objects** (the Phase 6 carry-forward).
    - **Scheduling:** a systemd timer on the host runs `docker compose … run --rm backup` at 03:15 UTC.
15. **E2E against the dev stack:**
    - **Rate limits:** Better Auth's limits (10 sign-ups an hour, 5 two-factor calls a minute, both per IP) would stop a second run within the hour. So:
      - `AUTH_RATE_LIMIT_ENABLED` defaults to `true`.
      - It may be `false` only outside production; `loadConfig` refuses `false` when `NODE_ENV=production`.
      - `compose.yml` passes it through from the shell, so E2E runs use `AUTH_RATE_LIMIT_ENABLED=false pnpm dev`.
      Fastify's own limits stay on.
    - **The global setup:**
      - creates an owner with 2FA through the API;
      - runs `pnpm seed <email>` in the api container, so the sample family has Leo as the owner's card;
      - invites a viewer, and saves both storage states.
      Each run uses fresh accounts.
    - **The spec §9 journey** goes entirely through the UI.
    - **Execution:** tests run with one worker, serially.
16. **The local production test stack:**
    - **Why `.test` names:** `loadConfig` in production rejects `localhost`, `*.localhost` and `http:`. So the local stack uses `family.test`, `api.family.test` and `s3.family.test` on `127.0.0.1:8443`. That makes the **real production config validation** run unchanged.
    - **Inside Docker,** Caddy has those names as network aliases and listens on 8080 and 8443, so URLs are the same inside and outside the containers. The API trusts Caddy's local root through `NODE_EXTRA_CA_CERTS`, and rclone through `RCLONE_CA_CERT`.
    - **Playwright** maps the names with `--host-resolver-rules` and `ignoreHTTPSErrors`, so it needs no hosts entry.
    - **A human browser** needs one hosts line, plus importing Caddy's root certificate. Both are manual steps in the checklist and the docs. The plan never edits `/etc/hosts`.
    - **Secrets** (random hex, never `dev-only`), an age key pair, the SeaweedFS identities and the backups go in `.prod-local/` (gitignored, `chmod 600`).
17. **The orphan sweep (the Phase 6 carry-forward; the README promised it for phase 7):**
    - It lists `trees/` in the bucket, and deletes objects older than **24 hours** that no `photos` row and no `storage_deletions` row knows.
    - It warns (`stored objects keep failing to delete`) when outbox rows have 10 or more attempts.
    - **When it runs:**
      - The purge job runs it at most once every 24 h (on by default from `server.ts`, off by default in `startPurgeJob` for tests).
      - `purge-cli --sweep` runs it on demand.
    - Listing is an R2 class A operation. Once a day is negligible.
18. **CI:**
    - **The new `e2e` job:**
      - starts the dev stack in Docker with `AUTH_RATE_LIMIT_ENABLED=false`;
      - installs only the headless shell, with `--with-deps`;
      - runs `pnpm test:e2e`;
      - uploads the report on failure.
      It can't be run locally, and its first real run is the author's next push, which is outside this phase. Task 15 checks the YAML.
    - **`release-api.yml`:** `workflow_dispatch` with a `tag` input. It builds `apps/api/Dockerfile` and pushes `ghcr.io/<owner>/family-tree-api:<tag>`. It has no other triggers. This replaces spec §10 step 1's "CI pushes", so nothing is published until the author clicks Run.
19. **Not in this phase (carry-forward):**
    - Moving 2FA to a new device (spec §5; the README said "planned for phase 7"). It is not in §11's Phase 7 list, so the README now says "not available yet", and the item is carried forward with its design note.
    - The message catalog (spec §6).
    - The release-age gate (after 2026-11-23).
    - ZIP64.
    - A redacting share export.
    - Drag-reorder in E2E.

## File map

```
e2e/                                     NEW workspace package @family-tree/e2e
  package.json, tsconfig.json            @playwright/test 1.64.1; @better-auth/utils, sharp (already locked)
  playwright.config.ts                   dev or prod-local target, one worker
  scripts/browser-check.mjs              Task 1 CPU gate
  support/env.ts, api.ts, totp.ts, ui.ts, fixtures.ts, fixture.ts, csp.ts
  support/global-setup.ts                health, fixtures, owner + seed + viewer (dev)
  tests/journey.spec.ts                  spec §9
  tests/photos-search.spec.ts, canvas.spec.ts, export.spec.ts, viewer.spec.ts
  tests/smoke.spec.ts                    @smoke, prod-local only
pnpm-workspace.yaml                      + e2e
package.json                             + test:e2e, test:e2e:prod-local, prod-local
packages/shared/src/export.ts (+test)    exportDataSchema, EXPORT_FORMAT/VERSION, EXPORT_MAX_PHOTO_BYTES
packages/shared/src/index.ts             + export
packages/shared/src/trees.ts             manageTree comment mentions export
apps/api/
  src/export/zip.ts (+test)              ZipWriter, ZipAborted, ZipTooLarge, dosDateTime
  src/export/gedcom.ts (+test)           buildGedcom, gedcomDate, gedcomPartialDate, personXrefs, photoFileName
  src/export/load.ts                     loadExport (snapshot), LoadedExport
  src/export/write.ts                    writeExport, exportFileName
  src/routes/export.ts (+int test)       GET /trees/:id/export
  src/routes/isolation.int.test.ts       + export route
  src/storage/objects.ts (+int test)     + get(), list()
  src/storage/sweep.ts (+int test)       sweepOrphans
  src/trees/purge.ts, purge-cli.ts       daily sweep; --sweep
  src/db/migrate-cli.ts                  production migrations as the owner role
  src/config.ts (+test)                  + MIGRATE_ON_START, AUTH_RATE_LIMIT_ENABLED
  src/auth/auth.ts                       rate limit default from config
  src/server.ts                          MIGRATE_ON_START, sweep interval
  src/app.ts                             exportRoutes, exportConcurrency option
  test/zip-reader.ts                     readZip() for tests
apps/web/
  security-headers.ts (+test)            securityHeaders, pagesHeadersFile, caddyHeadersSnippet
  vite.config.ts                         headers plugin
  tsconfig.json                          + security-headers.ts
  src/trees/api.ts (+test)               exportTree, shared errorFrom()
  src/trees/download.ts (+test)          saveFile, fileNameFrom
  src/test/fake-trees.ts                 exportTree
  src/auth/api.ts                        MESSAGES.exportLimited, exportTooLarge
  src/pages/TreePage.tsx (+test)         ExportSection in Tree settings
compose.yml                              api: AUTH_RATE_LIMIT_ENABLED passthrough
compose.prod.yml                         NEW production stack
compose.prod.local.yml                   NEW local-only overrides
docker/caddy/Caddyfile, Caddyfile.local, api.caddy          NEW
docker/postgres/prod-init/10-app-role.sh, 20-app-grants.sql  NEW
docker/backup/Dockerfile, backup.sh, restore.sh             NEW
docker/backup/systemd/family-tree-backup.service, .timer   NEW
scripts/prod-local.sh                    NEW up | down | reset | compose | backup-test
scripts/restore-check.mjs                NEW seed | verify (runs in the api container)
.env.production.example                  rewritten for compose.prod.yml
.gitignore, .dockerignore, .prettierignore, eslint.config.js   + .prod-local, e2e outputs
.github/workflows/ci.yml                 + e2e job
.github/workflows/release-api.yml        NEW, workflow_dispatch only
docs/self-hosting.md, docs/deployment.md NEW
README.md                                export, production, E2E, limitations
```

---
## Task 1: Dependencies — Playwright, the `e2e` package, and the browser CPU check

**Files:**
- Create: `e2e/package.json`, `e2e/tsconfig.json`, `e2e/scripts/browser-check.mjs`
- Modify: `pnpm-workspace.yaml`, `package.json`, `pnpm-lock.yaml`, `.gitignore`, `.dockerignore`, `.prettierignore`, `eslint.config.js`

- [ ] **Step 1: Re-check the publish dates and install scripts** (read-only network):

```bash
for p in @playwright/test playwright playwright-core; do
  pnpm view "$p" time --json | grep -E '"1\.64\.1"'
  pnpm view "$p@1.64.1" scripts --json | grep -E '"(pre|post)?install"' || echo "$p: no install script"
done
pnpm view playwright@1.64.1 optionalDependencies --json
```

  Expected:
  - All three are from 2026-10-14, and each prints `no install script`.
  - The optional dependency is at most `fsevents` 2.3.2, from 2021.
  - If any date is less than 14 days before today, stop and ask.

- [ ] **Step 2: Add the workspace package.**

  In `pnpm-workspace.yaml`, change the `packages` list to:

```yaml
packages:
  - apps/*
  - packages/*
  - e2e
```

  Create `e2e/package.json`:

```json
{
  "name": "@family-tree/e2e",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "e2e": "playwright test",
    "e2e:prod-local": "E2E_TARGET=prod-local playwright test --grep @smoke",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@better-auth/utils": "0.5.1",
    "@playwright/test": "1.64.1",
    "@types/node": "24.19.2",
    "sharp": "0.35.5",
    "typescript": "6.0.3"
  }
}
```

  There is deliberately no `test` script, so `pnpm -r test` never starts browsers.

  Create `e2e/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node"]
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "test-results", "playwright-report"]
}
```

  Add these scripts to the root `package.json`, after `"test:int"`:

```json
    "test:e2e": "pnpm --filter @family-tree/e2e e2e",
    "test:e2e:prod-local": "pnpm --filter @family-tree/e2e e2e:prod-local",
    "prod-local": "scripts/prod-local.sh",
```

  Append to `.gitignore`:

```
# Phase 7: local production stack and E2E output
/.prod-local/
/e2e/.state/
/e2e/test-results/
/e2e/playwright-report/
```

  Append `.prod-local` and `e2e` to `.dockerignore`. Append `.prod-local`, `e2e/test-results` and `e2e/playwright-report` to `.prettierignore`.

  In `eslint.config.js`, extend the ignores:

```js
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'apps/api/drizzle/**',
      '.prod-local/**',
      'e2e/test-results/**',
      'e2e/playwright-report/**',
    ],
  },
```

- [ ] **Step 3: Install.** Run `pnpm install`.

  Expected:
  - The lockfile gains an `e2e` importer, plus `@playwright/test@1.64.1`, `playwright@1.64.1` and `playwright-core@1.64.1`. `fsevents@2.3.2` is added only if it isn't already locked.
  - `@better-auth/utils`, `sharp`, `@types/node` and `typescript` reuse the locked versions.
  - `git diff pnpm-workspace.yaml` shows only the `- e2e` line. If pnpm wrote `minimumReleaseAgeExclude` or `allowBuilds`, or changed any existing version, run `git checkout pnpm-workspace.yaml pnpm-lock.yaml package.json` and `rm -rf e2e/node_modules`, then stop and ask.

- [ ] **Step 4: Check the ages.** Run `node <check-ages> pnpm-lock.yaml`.
  - Expected: every line starts with `ok`, including the three Playwright packages (2026-10-14).
  - Any `BAD` line: stop and ask.

- [ ] **Step 5: Download the browser.** This is read-only network: it writes only to `~/.cache/ms-playwright`.

```bash
pnpm --filter @family-tree/e2e exec playwright install --only-shell chromium
ls ~/.cache/ms-playwright | grep chromium_headless_shell-1248
```

  Expected: `chromium_headless_shell-1248`. Don't install `--with-deps` locally (it needs sudo). If launching in Step 6 reports missing shared libraries, stop and report the list.

- [ ] **Step 6: The CPU gate.** This CPU has no AVX2. Create `e2e/scripts/browser-check.mjs`:

```js
// Phase 7 Task 1 gate: the Playwright browser must run on this CPU (no AVX2).
// Usage: pnpm --filter @family-tree/e2e exec node scripts/browser-check.mjs
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(
    '<canvas id="c" width="300" height="150"></canvas>' +
      '<script>const x = document.getElementById("c").getContext("2d");' +
      'x.fillStyle = "#c33"; x.fillRect(0, 0, 300, 150);' +
      'x.font = "20px sans-serif"; x.fillStyle = "#fff"; x.fillText("Zoë 🌳", 20, 80);</script>',
  );
  const png = await page.screenshot();
  const result = await page.evaluate(async () => {
    const wasm = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    const worker = await new Promise((resolve) => {
      const src = URL.createObjectURL(new Blob(['postMessage(6 * 7)'], { type: 'text/javascript' }));
      const w = new Worker(src);
      w.onmessage = (e) => resolve(e.data);
    });
    // A little real work for the JIT and the SIMD paths of typed arrays.
    const a = new Float64Array(1_000_000).map((_, i) => Math.sin(i));
    return { wasm, worker, sum: Math.round(a.reduce((s, v) => s + v, 0)) };
  });
  console.log(JSON.stringify({ version: browser.version(), png: png.length > 1000, ...result }));
} finally {
  await browser.close();
}
```

  Run: `pnpm --filter @family-tree/e2e exec node scripts/browser-check.mjs; echo "exit $?"`

  Expected: `{"version":"156.0.8078.4","png":true,"wasm":true,"worker":42,"sum":2}` and `exit 0`. (`sum` is the rounded sum of `sin(i)` for i below one million, so it can differ by a unit between engines. Only `png`, `wasm` and `worker` gate.)

  **STOP and report BLOCKED** (don't commit, and don't try workarounds) if any of these happen:
  - the output or `dmesg` shows `Illegal instruction`, `SIGILL` or `exit 132`;
  - the launch fails with "Target page, context or browser has been closed";
  - the output differs in `png`, `wasm` or `worker`.

  The report should give the exact output, and list the options for the user to choose from:
  - the system Chrome through `channel: 'chrome'` (`/usr/bin/google-chrome` exists);
  - an older Playwright;
  - running E2E only in CI.

- [ ] **Step 7: The rest still builds:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Then `pnpm --filter @family-tree/web exec vite --version` prints `vite/8.3.6`.

- [ ] **Step 8: Commit**

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml e2e/package.json e2e/tsconfig.json \
  e2e/scripts/browser-check.mjs .gitignore .dockerignore .prettierignore eslint.config.js
git commit -m "build(e2e): add the e2e package with @playwright/test 1.64.1 and a browser CPU check"
```

---

## Task 2: Shared — the export data schema

**Files:**
- Create: `packages/shared/src/export.ts`, `packages/shared/src/export.test.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/src/trees.ts` (comment only)

- [ ] **Step 1: Write the failing `export.test.ts`:**

```ts
import { describe, expect, it } from 'vitest';
import {
  EXPORT_FORMAT,
  EXPORT_MAX_PHOTO_BYTES,
  EXPORT_VERSION,
  exportDataSchema,
} from './export.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const sample = {
  format: EXPORT_FORMAT,
  version: EXPORT_VERSION,
  exportedAt: '2026-11-10T09:05:03.000Z',
  tree: { id: id(100), name: 'Owner family', rootPersonId: id(1) },
  persons: [
    {
      id: id(1),
      givenName: 'Olive',
      middleName: null,
      surname: 'Owner',
      maidenName: null,
      nickname: null,
      sex: 'female',
      birthDate: { qualifier: 'about', date1: '1950' },
      birthPlace: 'Toronto',
      deathDate: null,
      deathPlace: null,
      causeOfDeath: null,
      isLiving: true,
      occupation: null,
      education: null,
      biography: null,
      notes: null,
      siblingOrder: null,
    },
  ],
  unions: [
    {
      id: id(10),
      partnerAId: id(1),
      partnerBId: null,
      type: 'marriage',
      status: 'married',
      startDate: null,
      endDate: null,
    },
  ],
  parentChild: [],
  residences: [{ id: id(20), personId: id(1), place: 'Leeds', fromDate: null, toDate: null }],
  photos: [
    {
      id: id(30),
      personId: id(1),
      file: 'photos/I1-1.webp',
      width: 1600,
      height: 1200,
      isPrimary: true,
    },
  ],
};

describe('exportDataSchema', () => {
  it('accepts a complete export unchanged', () => {
    expect(exportDataSchema.parse(sample)).toEqual(sample);
  });

  it('names the format and version', () => {
    expect(EXPORT_FORMAT).toBe('family-tree-export');
    expect(EXPORT_VERSION).toBe(1);
  });

  it('rejects another format or version', () => {
    expect(exportDataSchema.safeParse({ ...sample, format: 'other' }).success).toBe(false);
    expect(exportDataSchema.safeParse({ ...sample, version: 2 }).success).toBe(false);
  });

  it('allows a photo whose stored object was missing', () => {
    const missing = { ...sample, photos: [{ ...sample.photos[0]!, file: null }] };
    expect(exportDataSchema.safeParse(missing).success).toBe(true);
  });

  it('rejects invalid fuzzy dates and unknown child kinds', () => {
    const badDate = {
      ...sample,
      persons: [{ ...sample.persons[0]!, birthDate: { qualifier: 'between', date1: '1950' } }],
    };
    expect(exportDataSchema.safeParse(badDate).success).toBe(false);
    const badKind = {
      ...sample,
      parentChild: [{ id: id(40), unionId: id(10), childId: id(1), kind: 'godchild' }],
    };
    expect(exportDataSchema.safeParse(badKind).success).toBe(false);
  });

  it('keeps photo bytes well under the 4 GiB ZIP limit', () => {
    expect(EXPORT_MAX_PHOTO_BYTES).toBeLessThan(2 ** 32 - 256 * 2 ** 20);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails:** `rtk proxy pnpm --filter @family-tree/shared exec vitest run src/export.test.ts`.
  Expected: FAIL, "Cannot find module './export.js'".

- [ ] **Step 3: Write `packages/shared/src/export.ts`:**

```ts
import { z } from 'zod';
import { fuzzyDateSchema } from './fuzzy-date.js';
import { CHILD_KINDS, UNION_STATUSES, UNION_TYPES } from './people.js';
import { SEXES } from './trees.js';

/** `tree.json` in the export ZIP (spec §7 + Phase 7 decision 2): the live tree, nothing else. */
export const EXPORT_FORMAT = 'family-tree-export';
export const EXPORT_VERSION = 1;
/**
 * The writer has no ZIP64 (decision 7): above this many stored photo bytes (an upper bound: full
 * plus thumbnail) the export is refused instead of failing half-way.
 */
export const EXPORT_MAX_PHOTO_BYTES = 3_500_000_000;

const text = z.string().nullable();
const date = fuzzyDateSchema.nullable();

export const exportDataSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.iso.datetime(),
  tree: z.object({ id: z.uuid(), name: z.string(), rootPersonId: z.uuid().nullable() }),
  persons: z.array(
    z.object({
      id: z.uuid(),
      givenName: z.string(),
      middleName: text,
      surname: text,
      maidenName: text,
      nickname: text,
      sex: z.enum(SEXES),
      birthDate: date,
      birthPlace: text,
      deathDate: date,
      deathPlace: text,
      causeOfDeath: text,
      isLiving: z.boolean(),
      occupation: text,
      education: text,
      biography: text,
      notes: text,
      siblingOrder: z.number().int().nullable(),
    }),
  ),
  unions: z.array(
    z.object({
      id: z.uuid(),
      partnerAId: z.uuid().nullable(),
      partnerBId: z.uuid().nullable(),
      type: z.enum(UNION_TYPES),
      status: z.enum(UNION_STATUSES),
      startDate: date,
      endDate: date,
    }),
  ),
  parentChild: z.array(
    z.object({ id: z.uuid(), unionId: z.uuid(), childId: z.uuid(), kind: z.enum(CHILD_KINDS) }),
  ),
  residences: z.array(
    z.object({ id: z.uuid(), personId: z.uuid(), place: z.string(), fromDate: date, toDate: date }),
  ),
  photos: z.array(
    z.object({
      id: z.uuid(),
      personId: z.uuid(),
      /** Path inside the ZIP, or null when the stored object was missing at export time. */
      file: z.string().nullable(),
      width: z.number().int(),
      height: z.number().int(),
      isPrimary: z.boolean(),
    }),
  ),
});
export type ExportData = z.infer<typeof exportDataSchema>;
export type ExportPerson = ExportData['persons'][number];
```

  Add `export * from './export.js';` to `packages/shared/src/index.ts`.

  In `trees.ts`, change the `manageTree` comment to `/** Rename, change root, delete, transfer, reset links, export (owner). */`.

- [ ] **Step 4: Run it to make sure it passes,** then run `pnpm --filter @family-tree/shared typecheck`.
  Expected: 6 tests pass. `export.ts` is the last module `index.ts` loads, so it imports `fuzzy-date`, `people` and `trees` after they are initialised; there's no cycle.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/export.ts packages/shared/src/export.test.ts packages/shared/src/index.ts packages/shared/src/trees.ts
git commit -m "feat(shared): the tree.json export schema"
```

---

## Task 3: API — the streaming ZIP writer

**Files:**
- Create: `apps/api/src/export/zip.ts`, `apps/api/src/export/zip.test.ts`, `apps/api/test/zip-reader.ts`

- [ ] **Step 1: Write the test-only reader, `apps/api/test/zip-reader.ts`.** It is shared by the API tests and by `e2e/`.

```ts
import { crc32, inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  data: Buffer;
  /** 0 = stored, 8 = deflated. */
  method: number;
  flags: number;
}

/** Reads a whole ZIP from its central directory and checks every entry's size and CRC-32. */
export function readZip(buf: Buffer): ZipEntry[] {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('zip: no end of central directory');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: bad central header');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (buf.readUInt32LE(offset) !== 0x04034b50) throw new Error(`zip: bad local header (${name})`);
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const raw = buf.subarray(start, start + compressed);
    const data =
      method === 8 ? inflateRawSync(raw) : method === 0 ? Buffer.from(raw) : undefined;
    if (!data) throw new Error(`zip: unsupported method ${method} (${name})`);
    if (data.length !== size || crc32(data) !== crc) throw new Error(`zip: bad data (${name})`);
    out.push({ name, data, method, flags });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
```

- [ ] **Step 2: Write the failing `apps/api/src/export/zip.test.ts`:**

```ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readZip } from '../../test/zip-reader.js';
import { dosDateTime, ZipAborted, ZipWriter } from './zip.js';

const NOW = new Date('2026-11-10T09:05:03Z');

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

async function sampleZip() {
  const zip = new ZipWriter(NOW);
  const out = collect(zip.stream); // read while writing: add() waits for the reader
  const text = Buffer.from('0 HEAD\r\n1 CHAR UTF-8\r\n'.repeat(200), 'utf8');
  const photo = Buffer.from(Array.from({ length: 100_000 }, (_, i) => (i * 7919) % 251));
  await zip.add('tree.ged', text, { compress: true });
  await zip.add('photos/I1-1.webp', photo);
  await zip.add('tree.json', Buffer.from('{"name":"Zoë 🌳"}', 'utf8'), { compress: true });
  await zip.finish();
  return { buf: await out, text, photo };
}

function hasUnzip(): boolean {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('dosDateTime', () => {
  it('packs UTC date and time with 2-second resolution', () => {
    expect(dosDateTime(NOW)).toEqual({
      date: (46 << 9) | (11 << 5) | 10,
      time: (9 << 11) | (5 << 5) | 1,
    });
  });

  it('writes dates before 1980 as 1980-01-01', () => {
    expect(dosDateTime(new Date('1970-06-15T00:00:00Z')).date).toBe((0 << 9) | (1 << 5) | 1);
  });
});

describe('ZipWriter', () => {
  it('round-trips stored and deflated entries with UTF-8 names flagged', async () => {
    const { buf, text, photo } = await sampleZip();
    const entries = readZip(buf);
    expect(entries.map((e) => e.name)).toEqual(['tree.ged', 'photos/I1-1.webp', 'tree.json']);
    expect(entries[0]!.method).toBe(8);
    expect(entries[0]!.data.equals(text)).toBe(true);
    expect(entries[1]!.method).toBe(0);
    expect(entries[1]!.data.equals(photo)).toBe(true);
    expect(entries[2]!.data.toString('utf8')).toBe('{"name":"Zoë 🌳"}');
    for (const e of entries) expect(e.flags & 0x0800).toBe(0x0800);
    expect(buf.length).toBeLessThan(text.length + photo.length); // the text compressed
  });

  it.skipIf(!hasUnzip())('is accepted by unzip -t', async () => {
    const { buf } = await sampleZip();
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    try {
      writeFileSync(join(dir, 'a.zip'), buf);
      const out = execFileSync('unzip', ['-t', join(dir, 'a.zip')], { encoding: 'utf8' });
      expect(out).toMatch(/No errors detected/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses unsafe and duplicate names', async () => {
    const zip = new ZipWriter(NOW);
    zip.stream.resume();
    for (const bad of ['/etc/passwd', '../x', 'a/../b', 'a\\b', 'a b', '', 'photos/./x']) {
      await expect(zip.add(bad, Buffer.from('x'))).rejects.toThrow(/unsafe entry name/);
    }
    await zip.add('ok.txt', Buffer.from('x'));
    await expect(zip.add('ok.txt', Buffer.from('y'))).rejects.toThrow(/duplicate entry/);
  });

  it('waits for the reader (backpressure) and continues once it reads', async () => {
    const zip = new ZipWriter(NOW);
    let done = false;
    const p = zip.add('big.bin', Buffer.alloc(5_000_000)).then(() => {
      done = true;
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(done).toBe(false);
    zip.stream.resume();
    await p;
    expect(done).toBe(true);
  });

  it('rejects with ZipAborted when destroyed while waiting, and on every later add', async () => {
    const zip = new ZipWriter(NOW);
    const p = zip.add('big.bin', Buffer.alloc(5_000_000));
    zip.abort();
    await expect(p).rejects.toBeInstanceOf(ZipAborted);
    await expect(zip.add('more.bin', Buffer.from('x'))).rejects.toBeInstanceOf(ZipAborted);
  });
});
```

- [ ] **Step 3: Run it to make sure it fails:** `rtk proxy pnpm --filter @family-tree/api exec vitest run src/export/zip.test.ts`.
  Expected: FAIL, "Cannot find module './zip.js'".

- [ ] **Step 4: Write `apps/api/src/export/zip.ts`:**

```ts
import { PassThrough } from 'node:stream';
import { crc32, deflateRawSync } from 'node:zlib';

/** The stream was destroyed (the client went away, or the export failed) before the end. */
export class ZipAborted extends Error {
  override name = 'ZipAborted';
}

/** The archive would need ZIP64 (over 4 GiB or 65,535 entries), which this writer doesn't do. */
export class ZipTooLarge extends Error {
  override name = 'ZipTooLarge';
}

const MAX_U32 = 0xffff_ffff;
const MAX_ENTRIES = 0xffff;
const UTF8_NAMES = 0x0800;
const VERSION = 20; // PKZIP 2.0: deflate
const MADE_BY_UNIX = (3 << 8) | VERSION;
const FILE_MODE = 0o100644;
// Plain relative paths only: no leading "/", no "." or ".." segment, no backslash or space.
const SAFE_NAME = /^(?!\/)(?!(?:.*\/)?\.\.?(?:\/|$))[A-Za-z0-9._\-/]+$/;

interface Central {
  name: Buffer;
  crc: number;
  method: number;
  compressed: number;
  size: number;
  offset: number;
}

/** MS-DOS date and time (UTC: ZIP has no time zone), 2-second resolution, 1980–2107. */
export function dosDateTime(d: Date): { date: number; time: number } {
  const y = d.getUTCFullYear();
  if (y < 1980) return { date: (0 << 9) | (1 << 5) | 1, time: 0 };
  const year = Math.min(y, 2107);
  return {
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
  };
}

/**
 * A streaming ZIP writer (decision 7). Each entry is in memory when added (one photo, or the
 * GEDCOM/JSON), so headers carry the real sizes and CRC and no data descriptors are needed.
 * `add` resolves once the reader has taken the bytes, so memory stays at about one entry.
 */
export class ZipWriter {
  /** Pipe this to the response. */
  readonly stream = new PassThrough();
  private offset = 0;
  private readonly entries: Central[] = [];
  private readonly names = new Set<string>();
  private readonly stamp: { date: number; time: number };
  private finished = false;

  constructor(now: Date = new Date()) {
    this.stamp = dosDateTime(now);
  }

  /** Text compresses well (`compress: true`); WebP photos are stored as they are. */
  async add(name: string, data: Uint8Array, { compress = false } = {}): Promise<void> {
    if (this.stream.destroyed) throw new ZipAborted('zip stream closed');
    if (this.finished) throw new Error('zip: already finished');
    if (!SAFE_NAME.test(name)) throw new Error(`zip: unsafe entry name ${JSON.stringify(name)}`);
    if (this.names.has(name)) throw new Error(`zip: duplicate entry ${name}`);
    if (this.entries.length >= MAX_ENTRIES) throw new ZipTooLarge('too many entries');
    const body = compress ? deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const offset = this.offset;
    if (offset + 30 + nameBuf.length + body.length > MAX_U32) {
      throw new ZipTooLarge('archive over 4 GiB');
    }
    const method = compress ? 8 : 0;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(VERSION, 4);
    h.writeUInt16LE(UTF8_NAMES, 6);
    h.writeUInt16LE(method, 8);
    h.writeUInt16LE(this.stamp.time, 10);
    h.writeUInt16LE(this.stamp.date, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(body.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(nameBuf.length, 26);
    h.writeUInt16LE(0, 28);
    this.names.add(name);
    this.entries.push({
      name: nameBuf,
      crc,
      method,
      compressed: body.length,
      size: data.length,
      offset,
    });
    await this.write(h);
    await this.write(nameBuf);
    await this.write(body);
  }

  /** Writes the central directory and ends the stream. */
  async finish(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    const start = this.offset;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(MADE_BY_UNIX, 4);
      c.writeUInt16LE(VERSION, 6);
      c.writeUInt16LE(UTF8_NAMES, 8);
      c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(this.stamp.time, 12);
      c.writeUInt16LE(this.stamp.date, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.compressed, 20);
      c.writeUInt32LE(e.size, 24);
      c.writeUInt16LE(e.name.length, 28);
      // extra (30), comment (32), disk (34) and internal attributes (36) stay 0
      c.writeUInt32LE((FILE_MODE << 16) >>> 0, 38);
      c.writeUInt32LE(e.offset, 42);
      await this.write(c);
      await this.write(e.name);
    }
    const size = this.offset - start;
    if (this.offset + 22 > MAX_U32) throw new ZipTooLarge('archive over 4 GiB');
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(start, 16);
    await this.write(end);
    this.stream.end();
  }

  /** Stops the archive: the reader sees an error or a premature end, never a valid file. */
  abort(err?: Error): void {
    this.stream.destroy(err);
  }

  private write(chunk: Uint8Array): Promise<void> {
    if (this.stream.destroyed) return Promise.reject(new ZipAborted('zip stream closed'));
    this.offset += chunk.length;
    if (this.stream.write(chunk)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const done = (err?: Error) => {
        this.stream.off('drain', onDrain);
        this.stream.off('close', onClose);
        if (err) reject(err);
        else resolve();
      };
      const onDrain = () => done();
      const onClose = () => done(new ZipAborted('zip stream closed'));
      this.stream.on('drain', onDrain);
      this.stream.on('close', onClose);
    });
  }
}
```

- [ ] **Step 5: Run it to make sure it passes.** Expected: 7 tests pass (the `unzip -t` one runs, since `/usr/bin/unzip` exists).
  - If `abort()` while waiting doesn't reject: check that `destroy()` emits `close` (it does, asynchronously). Don't add timers.
  - If `abort()` with an error makes vitest report an unhandled `error` event, keep `abort()` without an argument in tests. The route passes an error, and Fastify handles it.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/export/zip.ts apps/api/src/export/zip.test.ts apps/api/test/zip-reader.ts
git commit -m "feat(api): a streaming ZIP writer with backpressure and safe names"
```

---

## Task 4: API — the GEDCOM 5.5.1 writer

**Files:**
- Create: `apps/api/src/export/gedcom.ts`, `apps/api/src/export/gedcom.test.ts`

- [ ] **Step 1: Write the failing `gedcom.test.ts`:**

```ts
import type { ExportData, ExportPerson, FuzzyDate } from '@family-tree/shared';
import { describe, expect, it } from 'vitest';
import { buildGedcom, gedcomDate, personXrefs, photoFileName } from './gedcom.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-11-10T09:05:03Z');
const opts = { exporterName: 'Olive Owner', now: NOW };
const exact = (date1: string): FuzzyDate => ({ qualifier: 'exact', date1 });

function person(n: number, over: Partial<ExportPerson>): ExportPerson {
  return {
    id: id(n),
    givenName: 'X',
    middleName: null,
    surname: null,
    maidenName: null,
    nickname: null,
    sex: 'unknown',
    birthDate: null,
    birthPlace: null,
    deathDate: null,
    deathPlace: null,
    causeOfDeath: null,
    isLiving: true,
    occupation: null,
    education: null,
    biography: null,
    notes: null,
    siblingOrder: null,
    ...over,
  };
}

function sample(): ExportData {
  return {
    format: 'family-tree-export',
    version: 1,
    exportedAt: NOW.toISOString(),
    tree: { id: id(100), name: 'Owner family', rootPersonId: id(1) },
    persons: [
      person(1, {
        givenName: 'Olive',
        middleName: 'Ann',
        surname: 'Owner',
        maidenName: 'Smith',
        nickname: 'Liv',
        sex: 'female',
        birthDate: exact('1950-03-12'),
        birthPlace: 'Toronto, Canada',
      }),
      person(2, {
        givenName: 'Bob',
        surname: 'Owner',
        sex: 'male',
        birthDate: { qualifier: 'about', date1: '1948' },
        deathDate: { qualifier: 'between', date1: '2010', date2: '2012' },
        deathPlace: 'Leeds',
        causeOfDeath: 'Heart failure',
        isLiving: false,
        occupation: 'Teacher',
        biography: 'Line one\nLine two',
      }),
      person(3, {
        givenName: 'Cleo',
        surname: 'Owner',
        sex: 'female',
        birthDate: exact('1975-06'),
        siblingOrder: 2,
      }),
      person(4, {
        givenName: 'Dan',
        surname: 'Owner',
        sex: 'male',
        siblingOrder: 1,
        notes: 'Email: dan@example.com',
      }),
      person(5, { givenName: 'Eve', sex: 'other', isLiving: false }),
    ],
    unions: [
      {
        id: id(11),
        partnerAId: id(1),
        partnerBId: id(2),
        type: 'marriage',
        status: 'divorced',
        startDate: exact('1972-06-01'),
        endDate: exact('1990'),
      },
      {
        id: id(12),
        partnerAId: id(2),
        partnerBId: null,
        type: 'marriage',
        status: 'married',
        startDate: null,
        endDate: null,
      },
    ],
    parentChild: [
      { id: id(21), unionId: id(11), childId: id(3), kind: 'biological' },
      { id: id(22), unionId: id(11), childId: id(4), kind: 'adoptive' },
      { id: id(23), unionId: id(12), childId: id(5), kind: 'step' },
    ],
    residences: [
      {
        id: id(31),
        personId: id(1),
        place: 'Leeds',
        fromDate: exact('1970'),
        toDate: { qualifier: 'about', date1: '1980' },
      },
    ],
    photos: [
      { id: id(41), personId: id(1), file: 'photos/I1-1.webp', width: 10, height: 10, isPrimary: true },
      { id: id(42), personId: id(1), file: 'photos/I1-2.webp', width: 10, height: 10, isPrimary: false },
      { id: id(43), personId: id(2), file: null, width: 10, height: 10, isPrimary: true },
    ],
  };
}

const EXPECTED = [
  '0 HEAD',
  '1 SOUR FAMILY-TREE',
  '2 VERS 1',
  '2 NAME Family Tree',
  '1 DATE 10 NOV 2026',
  '2 TIME 09:05:03',
  '1 SUBM @U1@',
  '1 FILE tree.ged',
  '1 GEDC',
  '2 VERS 5.5.1',
  '2 FORM LINEAGE-LINKED',
  '1 CHAR UTF-8',
  '0 @U1@ SUBM',
  '1 NAME Olive Owner',
  '0 @I1@ INDI',
  '1 NAME Olive Ann /Owner/',
  '2 GIVN Olive Ann',
  '2 SURN Owner',
  '2 NICK Liv',
  '1 NAME Olive Ann /Smith/',
  '2 GIVN Olive Ann',
  '2 SURN Smith',
  '2 TYPE maiden',
  '1 SEX F',
  '1 BIRT',
  '2 DATE 12 MAR 1950',
  '2 PLAC Toronto, Canada',
  '1 RESI',
  '2 DATE FROM 1970 TO 1980',
  '2 PLAC Leeds',
  '1 FAMS @F1@',
  '1 OBJE @O1@',
  '1 OBJE @O2@',
  '0 @I2@ INDI',
  '1 NAME Bob /Owner/',
  '2 GIVN Bob',
  '2 SURN Owner',
  '1 SEX M',
  '1 BIRT',
  '2 DATE ABT 1948',
  '1 DEAT',
  '2 DATE BET 2010 AND 2012',
  '2 PLAC Leeds',
  '2 CAUS Heart failure',
  '1 OCCU Teacher',
  '1 FAMS @F1@',
  '1 FAMS @F2@',
  '1 NOTE Line one',
  '2 CONT Line two',
  '0 @I3@ INDI',
  '1 NAME Cleo /Owner/',
  '2 GIVN Cleo',
  '2 SURN Owner',
  '1 SEX F',
  '1 BIRT',
  '2 DATE JUN 1975',
  '1 FAMC @F1@',
  '2 PEDI birth',
  '0 @I4@ INDI',
  '1 NAME Dan /Owner/',
  '2 GIVN Dan',
  '2 SURN Owner',
  '1 SEX M',
  '1 FAMC @F1@',
  '2 PEDI adopted',
  '1 NOTE Email: dan@@example.com',
  '0 @I5@ INDI',
  '1 NAME Eve',
  '2 GIVN Eve',
  '1 SEX U',
  '1 DEAT Y',
  '1 FAMC @F2@',
  '2 NOTE Step-child',
  '0 @F1@ FAM',
  '1 MARR',
  '2 DATE 1 JUN 1972',
  '1 DIV',
  '2 DATE 1990',
  '1 HUSB @I2@',
  '1 WIFE @I1@',
  '1 CHIL @I4@',
  '1 CHIL @I3@',
  '0 @F2@ FAM',
  '1 HUSB @I2@',
  '1 CHIL @I5@',
  '0 @O1@ OBJE',
  '1 FILE photos/I1-1.webp',
  '2 FORM webp',
  '3 TYPE photo',
  '0 @O2@ OBJE',
  '1 FILE photos/I1-2.webp',
  '2 FORM webp',
  '3 TYPE photo',
  '0 TRLR',
];

const linesOf = (ged: string) => ged.replace(/^﻿/, '').split('\r\n').slice(0, -1);

/** Joins a NOTE back together: CONT is a line break, CONC continues the same line. */
function noteText(lines: string[], start: number): string {
  let text = lines[start]!.replace(/^1 NOTE ?/, '');
  for (let i = start + 1; lines[i]?.startsWith('2 CON'); i++) {
    const [, tag, value = ''] = /^2 (CONT|CONC) ?(.*)$/.exec(lines[i]!)!;
    text += tag === 'CONT' ? `\n${value}` : value;
  }
  return text.replaceAll('@@', '@');
}

describe('gedcomDate', () => {
  it.each([
    [exact('1950'), '1950'],
    [exact('1950-03'), 'MAR 1950'],
    [exact('1950-03-02'), '2 MAR 1950'],
    [{ qualifier: 'about', date1: '1950-12' } as FuzzyDate, 'ABT DEC 1950'],
    [{ qualifier: 'before', date1: '1901' } as FuzzyDate, 'BEF 1901'],
    [{ qualifier: 'after', date1: '0950' } as FuzzyDate, 'AFT 950'],
    [{ qualifier: 'between', date1: '1950-06', date2: '1951' } as FuzzyDate, 'BET JUN 1950 AND 1951'],
  ])('%j → %s', (date, expected) => {
    expect(gedcomDate(date)).toBe(expected);
  });
});

describe('buildGedcom', () => {
  it('writes the whole sample tree exactly, UTF-8 with a BOM and CRLF', () => {
    const ged = buildGedcom(sample(), opts);
    expect(ged.startsWith('﻿0 HEAD\r\n')).toBe(true);
    expect(ged.endsWith('0 TRLR\r\n')).toBe(true);
    expect(ged).not.toMatch(/[^\r]\n/);
    expect(linesOf(ged)).toEqual(EXPECTED);
  });

  it('is deterministic', () => {
    expect(buildGedcom(sample(), opts)).toBe(buildGedcom(sample(), opts));
  });

  it('splits long notes with CONC under 255 bytes, never next to a space or inside @@', () => {
    for (const bio of [
      'a'.repeat(450),
      'word '.repeat(120),
      'Zoë 🌳 Núñez — ü '.repeat(40),
      '@'.repeat(301),
      'mail me@x.org '.repeat(50),
    ]) {
      const data = sample();
      data.persons[0] = { ...data.persons[0]!, biography: bio };
      const lines = linesOf(buildGedcom(data, opts));
      for (const l of lines) expect(Buffer.byteLength(l, 'utf8')).toBeLessThanOrEqual(255);
      const start = lines.findIndex((l) => l.startsWith('1 NOTE'));
      expect(noteText(lines, start)).toBe(bio);
      for (let i = start + 1; lines[i]?.startsWith('2 CONC'); i++) {
        const prev = lines[i - 1]!;
        expect(prev.endsWith(' ')).toBe(false);
        expect(lines[i]!.slice('2 CONC '.length).startsWith(' ')).toBe(false);
        // An odd run of @ at a line end would be half of an escaped "@@".
        expect((/@+$/.exec(prev)?.[0].length ?? 0) % 2).toBe(0);
      }
    }
  });

  it('keeps blank lines in notes as empty CONT lines', () => {
    const data = sample();
    data.persons[3] = { ...data.persons[3]!, notes: 'one\n\nthree\r\nfour' };
    const lines = linesOf(buildGedcom(data, opts));
    const at = lines.indexOf('1 NOTE one');
    expect(lines.slice(at, at + 4)).toEqual(['1 NOTE one', '2 CONT', '2 CONT three', '2 CONT four']);
  });

  it('flattens and shortens single-line values, and keeps slashes out of names', () => {
    const data = sample();
    data.persons[0] = {
      ...data.persons[0]!,
      givenName: 'Anne/Marie',
      birthPlace: `Long\nplace ${'x'.repeat(300)}`,
    };
    const lines = linesOf(buildGedcom(data, opts));
    expect(lines).toContain('1 NAME Anne Marie Ann /Owner/');
    const plac = lines.find((l) => l.startsWith('2 PLAC Long place '))!;
    expect(Buffer.byteLength(plac.slice('2 PLAC '.length), 'utf8')).toBeLessThanOrEqual(240);
    expect(plac.endsWith('…')).toBe(true);
  });

  it('assigns HUSB and WIFE by sex, positionally otherwise', () => {
    const data = sample();
    const p = (n: number) => data.persons[n - 1]!;
    const fam = (a: string | null, b: string | null) => {
      data.unions = [{ ...data.unions[0]!, partnerAId: a, partnerBId: b }];
      data.parentChild = [];
      return linesOf(buildGedcom(data, opts)).filter((l) => /^1 (HUSB|WIFE)/.test(l));
    };
    expect(fam(p(1).id, p(3).id)).toEqual(['1 HUSB @I1@', '1 WIFE @I3@']); // two women
    expect(fam(p(2).id, p(4).id)).toEqual(['1 HUSB @I2@', '1 WIFE @I4@']); // two men
    expect(fam(p(1).id, p(2).id)).toEqual(['1 HUSB @I2@', '1 WIFE @I1@']);
    expect(fam(p(1).id, null)).toEqual(['1 WIFE @I1@']);
    expect(fam(null, p(5).id)).toEqual(['1 HUSB @I5@']);
  });

  it('writes partnerships and separations as typed EVENs', () => {
    const data = sample();
    data.unions = [
      {
        ...data.unions[0]!,
        type: 'partnership',
        status: 'separated',
        startDate: { qualifier: 'after', date1: '1990' },
        endDate: exact('1995'),
      },
    ];
    const lines = linesOf(buildGedcom(data, opts));
    const at = lines.indexOf('0 @F1@ FAM');
    expect(lines.slice(at + 1, at + 7)).toEqual([
      '1 EVEN',
      '2 TYPE Partnership',
      '2 DATE AFT 1990',
      '1 EVEN',
      '2 TYPE Separation',
      '2 DATE 1995',
    ]);
  });

  it('marks undated marriages and divorces with Y', () => {
    const data = sample();
    data.unions = [{ ...data.unions[0]!, startDate: null, endDate: null }];
    const lines = linesOf(buildGedcom(data, opts));
    expect(lines).toContain('1 MARR Y');
    expect(lines).toContain('1 DIV Y');
  });

  it('names photo files after the person xref', () => {
    const xrefs = personXrefs(sample().persons);
    expect(xrefs.get(id(2))).toBe('@I2@');
    expect(photoFileName('@I2@', 3)).toBe('photos/I2-3.webp');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails:** `rtk proxy pnpm --filter @family-tree/api exec vitest run src/export/gedcom.test.ts`.
  Expected: FAIL, "Cannot find module './gedcom.js'".

- [ ] **Step 3: Write `apps/api/src/export/gedcom.ts`:**

```ts
import {
  type ChildKind,
  type ExportData,
  type ExportPerson,
  type FuzzyDate,
  sortYear,
} from '@family-tree/shared';

/**
 * GEDCOM 5.5.1 (spec §7) from an export snapshot (decision 6). Pure: same data, same bytes.
 * UTF-8 with a BOM, CRLF, at most 255 bytes per line.
 */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const SEX: Record<ExportPerson['sex'], string> = { female: 'F', male: 'M', other: 'U', unknown: 'U' };
const PEDI: Record<ChildKind, string | null> = {
  biological: 'birth',
  adoptive: 'adopted',
  foster: 'foster',
  step: null, // 5.5.1 has no step value: written as a NOTE instead
};
/** Continuation chunks stay under 255 bytes per line with room for "2 CONC ". */
const CHUNK_BYTES = 200;
/** Single-line values are cut here (with "…"); tree.json keeps the full text. */
const VALUE_BYTES = 240;

/** "1950", "MAR 1950" or "2 MAR 1950" from YYYY, YYYY-MM or YYYY-MM-DD. */
export function gedcomPartialDate(partial: string): string {
  const [y, m, d] = partial.split('-');
  const year = String(Number(y));
  if (!m) return year;
  const month = MONTHS[Number(m) - 1]!;
  return d ? `${Number(d)} ${month} ${year}` : `${month} ${year}`;
}

export function gedcomDate(date: FuzzyDate): string {
  const d1 = gedcomPartialDate(date.date1);
  switch (date.qualifier) {
    case 'exact':
      return d1;
    case 'about':
      return `ABT ${d1}`;
    case 'before':
      return `BEF ${d1}`;
    case 'after':
      return `AFT ${d1}`;
    case 'between':
      return `BET ${d1} AND ${gedcomPartialDate(date.date2 ?? date.date1)}`;
  }
}

/** Residence periods take plain dates in 5.5.1, so the qualifier is dropped (decision 6). */
function datePeriod(from: FuzzyDate | null, to: FuzzyDate | null): string | null {
  const parts = [
    from ? `FROM ${gedcomPartialDate(from.date1)}` : '',
    to ? `TO ${gedcomPartialDate(to.date1)}` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

export function personXrefs(persons: readonly { id: string }[]): Map<string, string> {
  return new Map(persons.map((p, i) => [p.id, `@I${i + 1}@`]));
}

/** "photos/I3-1.webp": the person's xref and the photo's position (primary first). */
export const photoFileName = (personXref: string, n: number) =>
  `photos/${personXref.slice(1, -1)}-${n}.webp`;

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

function line(level: number, tag: string, value?: string, xref?: string): string {
  return `${level}${xref ? ` ${xref}` : ''} ${tag}${value ? ` ${value}` : ''}`;
}

/** One line of text, whitespace collapsed, "@" escaped, cut at VALUE_BYTES with "…". */
function oneLine(value: string): string {
  const atoms = Array.from(value.replace(/\s+/g, ' ').trim(), (c) => (c === '@' ? '@@' : c));
  const total = atoms.reduce((n, a) => n + bytes(a), 0);
  if (total <= VALUE_BYTES) return atoms.join('');
  let out = '';
  let size = 0;
  for (const a of atoms) {
    if (size + bytes(a) + bytes('…') > VALUE_BYTES) break;
    out += a;
    size += bytes(a);
  }
  return `${out}…`;
}

const namePart = (s: string) => oneLine(s.replaceAll('/', ' '));

/**
 * Splits one paragraph into chunks of at most CHUNK_BYTES. Each escaped "@@" is one atom, so it
 * is never split. A split moves back until neither side is a space (readers trim them); with no
 * such point it falls back to the byte limit.
 */
function chunks(paragraph: string): string[] {
  const atoms = Array.from(paragraph, (c) => (c === '@' ? '@@' : c));
  const out: string[] = [];
  let start = 0;
  while (start < atoms.length) {
    let end = start;
    let size = 0;
    while (end < atoms.length && size + bytes(atoms[end]!) <= CHUNK_BYTES) {
      size += bytes(atoms[end]!);
      end++;
    }
    if (end < atoms.length) {
      let e = end;
      while (e > start + 1 && (atoms[e - 1] === ' ' || atoms[e] === ' ')) e--;
      if (e > start + 1) end = e;
    }
    out.push(atoms.slice(start, end).join(''));
    start = end;
  }
  return out.length > 0 ? out : [''];
}

/** A text value over several lines: line breaks become CONT, long lines continue with CONC. */
function textLines(level: number, tag: string, text: string): string[] {
  const out: string[] = [];
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((paragraph, i) => {
      chunks(paragraph).forEach((c, j) => {
        if (i === 0 && j === 0) out.push(line(level, tag, c));
        else out.push(line(level + 1, j === 0 ? 'CONT' : 'CONC', c));
      });
    });
  return out;
}

/** HUSB/WIFE (decision 6): by sex when exactly one partner is female, positionally otherwise. */
function roles(a: ExportPerson | null, b: ExportPerson | null) {
  if (a && b) {
    if (a.sex === 'female' && b.sex !== 'female') return { husb: b, wife: a };
    return { husb: a, wife: b };
  }
  const only = a ?? b;
  return only?.sex === 'female' ? { husb: null, wife: only } : { husb: only, wife: null };
}

function append<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export interface GedcomOptions {
  /** The SUBM record's name: the exporting owner. */
  exporterName: string;
  now: Date;
}

export function buildGedcom(data: ExportData, { exporterName, now }: GedcomOptions): string {
  const out: string[] = [];
  const add = (level: number, tag: string, value?: string, xref?: string) =>
    out.push(line(level, tag, value, xref));

  const indi = personXrefs(data.persons);
  const fam = new Map(data.unions.map((u, i) => [u.id, `@F${i + 1}@`]));
  const shown = data.photos.filter((p) => p.file !== null);
  const obje = new Map(shown.map((p, i) => [p.id, `@O${i + 1}@`]));
  const byId = new Map(data.persons.map((p) => [p.id, p]));
  const order = new Map(data.persons.map((p, i) => [p.id, i]));

  const famc = new Map<string, { unionId: string; kind: ChildKind }[]>();
  for (const l of data.parentChild) append(famc, l.childId, l);
  const fams = new Map<string, string[]>();
  for (const u of data.unions) {
    for (const pid of [u.partnerAId, u.partnerBId]) if (pid) append(fams, pid, u.id);
  }
  const photosOf = new Map<string, string[]>();
  for (const p of shown) append(photosOf, p.personId, p.id);
  const homes = new Map<string, ExportData['residences']>();
  for (const r of data.residences) append(homes, r.personId, r);
  const kids = new Map<string, ExportPerson[]>();
  for (const l of data.parentChild) append(kids, l.unionId, byId.get(l.childId)!);

  // Header (5.5.1 order: SOUR, DATE, SUBM, FILE, GEDC, CHAR) and the submitter.
  const iso = now.toISOString();
  add(0, 'HEAD');
  add(1, 'SOUR', 'FAMILY-TREE');
  add(2, 'VERS', '1');
  add(2, 'NAME', 'Family Tree');
  add(1, 'DATE', gedcomPartialDate(iso.slice(0, 10)));
  add(2, 'TIME', iso.slice(11, 19));
  add(1, 'SUBM', '@U1@');
  add(1, 'FILE', 'tree.ged');
  add(1, 'GEDC');
  add(2, 'VERS', '5.5.1');
  add(2, 'FORM', 'LINEAGE-LINKED');
  add(1, 'CHAR', 'UTF-8');
  add(0, 'SUBM', undefined, '@U1@');
  add(1, 'NAME', oneLine(exporterName) || 'Unknown');

  const event = (
    tag: 'BIRT' | 'DEAT',
    date: FuzzyDate | null,
    place: string | null,
    cause: string | null = null,
  ) => {
    if (!date && !place && !cause) {
      if (tag === 'DEAT') add(1, 'DEAT', 'Y');
      return;
    }
    add(1, tag);
    if (date) add(2, 'DATE', gedcomDate(date));
    if (place) add(2, 'PLAC', oneLine(place));
    if (cause) add(2, 'CAUS', oneLine(cause));
  };
  const name = (given: string, surname: string | null) => {
    add(1, 'NAME', surname ? `${given} /${namePart(surname)}/` : given);
    add(2, 'GIVN', given);
    if (surname) add(2, 'SURN', namePart(surname));
  };

  // Individuals (5.5.1 order: NAME, SEX, events, attributes, FAMC, FAMS, OBJE, NOTE).
  for (const p of data.persons) {
    add(0, 'INDI', undefined, indi.get(p.id));
    const given = [p.givenName, p.middleName]
      .filter((s): s is string => !!s)
      .map(namePart)
      .join(' ');
    name(given, p.surname);
    if (p.nickname) add(2, 'NICK', oneLine(p.nickname));
    if (p.maidenName) {
      name(given, p.maidenName);
      add(2, 'TYPE', 'maiden');
    }
    add(1, 'SEX', SEX[p.sex]);
    event('BIRT', p.birthDate, p.birthPlace);
    if (!p.isLiving || p.deathDate || p.deathPlace || p.causeOfDeath) {
      event('DEAT', p.deathDate, p.deathPlace, p.causeOfDeath);
    }
    if (p.occupation) add(1, 'OCCU', oneLine(p.occupation));
    if (p.education) add(1, 'EDUC', oneLine(p.education));
    for (const r of homes.get(p.id) ?? []) {
      add(1, 'RESI');
      const period = datePeriod(r.fromDate, r.toDate);
      if (period) add(2, 'DATE', period);
      add(2, 'PLAC', oneLine(r.place));
    }
    for (const l of famc.get(p.id) ?? []) {
      add(1, 'FAMC', fam.get(l.unionId));
      const pedi = PEDI[l.kind];
      if (pedi) add(2, 'PEDI', pedi);
      else add(2, 'NOTE', 'Step-child');
    }
    for (const u of fams.get(p.id) ?? []) add(1, 'FAMS', fam.get(u));
    for (const ph of photosOf.get(p.id) ?? []) add(1, 'OBJE', obje.get(ph));
    if (p.biography) out.push(...textLines(1, 'NOTE', p.biography));
    if (p.notes) out.push(...textLines(1, 'NOTE', p.notes));
  }

  // Families (5.5.1 order: events, HUSB, WIFE, CHIL).
  const birthYear = (p: ExportPerson) =>
    p.birthDate ? sortYear(p.birthDate) : Number.POSITIVE_INFINITY;
  const childOrder = (a: ExportPerson, b: ExportPerson) =>
    (a.siblingOrder ?? Number.POSITIVE_INFINITY) - (b.siblingOrder ?? Number.POSITIVE_INFINITY) ||
    birthYear(a) - birthYear(b) ||
    order.get(a.id)! - order.get(b.id)!;
  for (const u of data.unions) {
    add(0, 'FAM', undefined, fam.get(u.id));
    const a = u.partnerAId ? (byId.get(u.partnerAId) ?? null) : null;
    const b = u.partnerBId ? (byId.get(u.partnerBId) ?? null) : null;
    // A single known parent is a union too: no marriage is invented for it.
    if ((a && b) || u.startDate) {
      if (u.type === 'marriage') add(1, 'MARR', u.startDate ? undefined : 'Y');
      else {
        add(1, 'EVEN');
        add(2, 'TYPE', 'Partnership');
      }
      if (u.startDate) add(2, 'DATE', gedcomDate(u.startDate));
    }
    if (u.status === 'divorced') {
      add(1, 'DIV', u.endDate ? undefined : 'Y');
      if (u.endDate) add(2, 'DATE', gedcomDate(u.endDate));
    } else if (u.status === 'separated') {
      add(1, 'EVEN');
      add(2, 'TYPE', 'Separation');
      if (u.endDate) add(2, 'DATE', gedcomDate(u.endDate));
    }
    const { husb, wife } = roles(a, b);
    if (husb) add(1, 'HUSB', indi.get(husb.id));
    if (wife) add(1, 'WIFE', indi.get(wife.id));
    for (const k of [...(kids.get(u.id) ?? [])].sort(childOrder)) add(1, 'CHIL', indi.get(k.id));
  }

  // Media: the photos that made it into the ZIP, in export order.
  for (const ph of shown) {
    add(0, 'OBJE', undefined, obje.get(ph.id));
    add(1, 'FILE', ph.file!);
    add(2, 'FORM', 'webp');
    add(3, 'TYPE', 'photo');
  }
  add(0, 'TRLR');
  return `﻿${out.join('\r\n')}\r\n`;
}
```

  Notes for the implementer:
  - `Infinity - Infinity` is `NaN`, which `||` treats as "equal", so a missing sibling order falls through to the next key. That is intended.
  - An empty paragraph is written as `2 CONT` with no trailing space (`line()` drops empty values). That is valid 5.5.1.
  - **The space rule:** only a run of spaces longer than a chunk has no split point away from a space; then the code falls back to the byte limit. None of the five sample strings has such a run.

- [ ] **Step 4: Run it to make sure it passes.**
  - Expected: 15 tests pass (7 `gedcomDate` cases and 8 `buildGedcom`/xref tests).
  - If the exact sample differs, fix the code, not `EXPECTED`. Each line of `EXPECTED` follows decision 6. The one exception: if you find a real 5.5.1 rule the sample breaks, fix both and say so in the commit.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/export/gedcom.ts apps/api/src/export/gedcom.test.ts
git commit -m "feat(api): GEDCOM 5.5.1 writer (dates, names, events, unions, child kinds, media)"
```

---

## Task 5: API — `GET /trees/:id/export`

**Files:**
- Create: `apps/api/src/export/load.ts`, `apps/api/src/export/write.ts`, `apps/api/src/routes/export.ts`, `apps/api/src/routes/export.int.test.ts`
- Modify: `apps/api/src/storage/objects.ts`, `apps/api/src/storage/objects.int.test.ts`, `apps/api/src/app.ts`, `apps/api/src/routes/isolation.int.test.ts`

- [ ] **Step 1: Write the failing store tests.** Append to `objects.int.test.ts`, inside the `describe`:

```ts
  it('gets an object back, and null for a missing key', async () => {
    const k = key();
    await store.put(k, bytes, 'image/webp');
    expect(await store.get(k)).toEqual(bytes);
    expect(await store.get(`test/${randomUUID()}/missing.webp`)).toBeNull();
  });

  it('lists objects under a prefix with their modification time', async () => {
    const prefix = `test/${randomUUID()}/`;
    await store.put(`${prefix}a.webp`, bytes, 'image/webp');
    await store.put(`${prefix}b/c.webp`, bytes, 'image/webp');
    const listed = [];
    for await (const o of store.list(prefix)) listed.push(o);
    expect(listed.map((o) => o.key).sort()).toEqual([`${prefix}a.webp`, `${prefix}b/c.webp`]);
    for (const o of listed) expect(Date.now() - o.lastModified.getTime()).toBeLessThan(60_000);
  });
```

  Run: `rtk proxy pnpm --filter @family-tree/api exec vitest run --config vitest.int.config.ts src/storage/objects.int.test.ts`. Expected: FAIL, `store.get is not a function`.

- [ ] **Step 2: Extend `ObjectStore`** in `storage/objects.ts`:
  - Add `ListObjectsV2Command` and `S3ServiceException` to the `@aws-sdk/client-s3` import.
  - Add these members to the interface:

```ts
  /** The object's bytes, or null when the key doesn't exist. For the export (one at a time). */
  get(key: string): Promise<Uint8Array | null>;
  /** Every object under `prefix`, page by page (1,000 per request). For the orphan sweep. */
  list(prefix: string): AsyncGenerator<{ key: string; lastModified: Date }>;
```

  Then add these to the returned object:

```ts
    async get(key) {
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
        return res.Body ? await res.Body.transformToByteArray() : new Uint8Array();
      } catch (err) {
        if (
          err instanceof S3ServiceException &&
          (err.name === 'NoSuchKey' || err.$metadata.httpStatusCode === 404)
        ) {
          return null;
        }
        throw err;
      }
    },
    async *list(prefix) {
      let token: string | undefined;
      do {
        const page = await s3.send(
          new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const o of page.Contents ?? []) {
          if (o.Key) yield { key: o.Key, lastModified: o.LastModified ?? new Date(0) };
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    },
```

  Run the store tests: they pass. Run `pnpm --filter @family-tree/api typecheck`. Any test fake that implements `ObjectStore` by hand now fails to compile: add `get: async () => null` and `async *list() {}` to it. Spreads of `deps.storage` are fine.

- [ ] **Step 3: Write the failing `routes/export.int.test.ts`:**

```ts
import { exportDataSchema } from '@family-tree/shared';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, signUp } from '../../test/auth-helpers.js';
import { jpegWithExif, SECRET } from '../../test/photo-fixtures.js';
import { addPhotoRow, upload } from '../../test/photo-helpers.js';
import {
  addMember,
  addPerson,
  family,
  ownerWithTree,
  softDeleteBatch,
} from '../../test/tree-helpers.js';
import { readZip } from '../../test/zip-reader.js';
import { buildApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { loadConfig } from '../config.js';
import { parentChild, persons, photos, residences, trees } from '../db/schema.js';
import { createDeps } from '../deps.js';

const config = loadConfig();
const deps = createDeps(config);
const { db } = deps;
const auth = createAuth({ config, db, rateLimitEnabled: false });

let app: ReturnType<typeof buildApp>;
beforeEach(() => {
  app = buildApp({ config, checks: deps.checks, auth, db, storage: deps.storage });
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await deps.close();
});

const url = (t: string) => `/api/v1/trees/${t}/export`;
const rootOf = async (treeId: string) =>
  (await db.select({ r: trees.rootPersonId }).from(trees).where(eq(trees.id, treeId)))[0]!.r!;

async function exportOf(jar: unknown, treeId: string) {
  const res = await call(app, 'GET', url(treeId), { jar: jar as never });
  expect(res.statusCode, res.statusCode === 200 ? '' : res.body).toBe(200);
  const files = new Map(readZip(res.rawPayload).map((f) => [f.name, f]));
  const ged = files.get('tree.ged')!.data.toString('utf8');
  const json = exportDataSchema.parse(JSON.parse(files.get('tree.json')!.data.toString('utf8')));
  return { res, files, ged, json };
}

describe('GET export', () => {
  it('streams a ZIP with tree.ged, tree.json and the full photos', async () => {
    const { owner, treeId } = await ownerWithTree(app, 'Export tree');
    const root = await rootOf(treeId);
    await db
      .update(persons)
      .set({ birthDate: { qualifier: 'about', date1: '1950' }, birthPlace: 'São Paulo' })
      .where(eq(persons.id, root));
    const partner = await addPerson(db, treeId, 'Zoë', { surname: 'Núñez', sex: 'female' });
    const child = await addPerson(db, treeId, 'Kid', { surname: 'Owner' });
    const u = await family(db, treeId, { id: root }, partner, [child]);
    await db.update(parentChild).set({ kind: 'adoptive' }).where(eq(parentChild.unionId, u.id));
    await db.insert(residences).values({ treeId, personId: root, place: 'Leeds' });
    const up = await upload(
      app,
      `/api/v1/trees/${treeId}/persons/${root}/photos`,
      owner.jar,
      await jpegWithExif(),
    );
    expect(up.statusCode).toBe(201);

    const { res, files, ged, json } = await exportOf(owner.jar, treeId);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="family-tree-\d{4}-\d{2}-\d{2}\.zip"$/,
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect([...files.keys()].sort()).toEqual(['photos/I1-1.webp', 'tree.ged', 'tree.json']);

    expect(ged.startsWith('﻿0 HEAD\r\n')).toBe(true);
    expect(ged).toContain('\r\n1 CHAR UTF-8\r\n');
    expect(ged).toContain('\r\n2 DATE ABT 1950\r\n2 PLAC São Paulo\r\n');
    expect(ged).toContain('\r\n1 NAME Zoë /Núñez/\r\n');
    expect(ged).toContain('\r\n2 PEDI adopted\r\n');
    expect(ged).toContain('\r\n1 OBJE @O1@\r\n');
    expect(ged).toContain('\r\n1 FILE photos/I1-1.webp\r\n');
    expect(ged.endsWith('\r\n0 TRLR\r\n')).toBe(true);
    expect(files.get('tree.ged')!.method).toBe(8);

    expect(json.tree.id).toBe(treeId);
    expect(json.persons.map((p) => p.givenName)).toEqual(['Olive', 'Zoë', 'Kid']);
    expect(json.residences.map((r) => r.place)).toEqual(['Leeds']);
    expect(json.photos).toEqual([
      expect.objectContaining({ personId: root, file: 'photos/I1-1.webp', isPrimary: true }),
    ]);
    expect(JSON.stringify(json)).not.toMatch(/trees\/|X-Amz|webp\?/); // no keys or URLs

    // The stored, re-encoded photo byte for byte, stored uncompressed; no upload EXIF survives.
    const [row] = await db.select().from(photos).where(eq(photos.treeId, treeId));
    const stored = await deps.storage.get(row!.storageKeyFull);
    const exported = files.get('photos/I1-1.webp')!;
    expect(exported.method).toBe(0);
    expect(exported.data.equals(Buffer.from(stored!))).toBe(true);
    expect(exported.data.includes(Buffer.from(SECRET))).toBe(false);
  });

  it('leaves out Trash, and photos whose stored object is gone', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const root = await rootOf(treeId);
    const gone = await addPerson(db, treeId, 'Gone');
    await addPhotoRow(db, treeId, gone.id);
    await softDeleteBatch(db, treeId, owner.userId, [gone.id]);
    await addPhotoRow(db, treeId, root); // a row without an object
    const { files, ged, json } = await exportOf(owner.jar, treeId);
    expect([...files.keys()].sort()).toEqual(['tree.ged', 'tree.json']);
    expect(json.persons.map((p) => p.givenName)).toEqual(['Olive']);
    expect(json.photos).toEqual([expect.objectContaining({ personId: root, file: null })]);
    expect(ged).not.toContain('OBJE');
    expect(ged).not.toContain('Gone');
  });

  it('is for the owner only: members get 403, outsiders 404, no session 401', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const editor = await signUp(app, { name: 'Ed' });
    const viewer = await signUp(app, { name: 'Vi' });
    await addMember(db, treeId, editor.userId, 'editor', owner.userId);
    await addMember(db, treeId, viewer.userId, 'viewer', owner.userId);
    const outsider = await signUp(app, { name: 'Out' });
    for (const [jar, status, code] of [
      [editor.jar, 403, 'FORBIDDEN'],
      [viewer.jar, 403, 'FORBIDDEN'],
      [outsider.jar, 404, 'NOT_FOUND'],
    ] as const) {
      const res = await call(app, 'GET', url(treeId), { jar });
      expect(res.statusCode).toBe(status);
      expect(res.json().error.code).toBe(code);
    }
    expect((await call(app, 'GET', url(treeId))).statusCode).toBe(401);
  });

  it('allows 5 exports an hour per user', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    for (let i = 0; i < 5; i++) {
      expect((await call(app, 'GET', url(treeId), { jar: owner.jar })).statusCode).toBe(200);
    }
    const res = await call(app, 'GET', url(treeId), { jar: owner.jar });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMITED');
  });

  it('answers 503 when every export slot is busy, after the access check', async () => {
    await app.close();
    app = buildApp({
      config,
      checks: deps.checks,
      auth,
      db,
      storage: deps.storage,
      exportConcurrency: 0,
    });
    const { owner, treeId } = await ownerWithTree(app);
    const res = await call(app, 'GET', url(treeId), { jar: owner.jar });
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('30');
    expect(res.json().error.code).toBe('RATE_LIMITED');
    const outsider = await signUp(app, { name: 'Out' });
    expect((await call(app, 'GET', url(treeId), { jar: outsider.jar })).statusCode).toBe(404);
  });
});
```

  Run: `rtk proxy pnpm --filter @family-tree/api exec vitest run --config vitest.int.config.ts src/routes/export.int.test.ts`. Expected: FAIL, 404 for every request (the route doesn't exist yet), and a type error on `exportConcurrency`.

- [ ] **Step 4: Write `export/load.ts`:**

```ts
import { EXPORT_FORMAT, EXPORT_VERSION, type ExportData } from '@family-tree/shared';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { parentChild, persons, photos, residences, trees, unions } from '../db/schema.js';

export interface LoadedExport {
  /** Every photo has `file: null` here; writeExport fills in the ones it wrote. */
  data: ExportData;
  /** Photo id → storage key of the full version. Never written into the export. */
  photoKeys: Map<string, string>;
  /** Stored bytes (full + thumbnail) of the exported photos: an upper bound for the ZIP. */
  photoBytes: number;
}

/**
 * The live tree in a stable order (created_at, id), with the same "live" rules as the graph: a
 * partner who isn't live is an empty slot, a union with no live partner is left out, and so are
 * links, residences and photos of people who aren't live. Call inside one snapshot transaction
 * after the access check (decision 4).
 */
export async function loadExport(db: Queryable, treeId: string, now: Date): Promise<LoadedExport> {
  const [tree] = await db
    .select({ id: trees.id, name: trees.name, rootPersonId: trees.rootPersonId })
    .from(trees)
    .where(eq(trees.id, treeId));
  if (!tree) throw new Error('loadExport: the tree vanished inside the snapshot');

  const people = await db
    .select({
      id: persons.id,
      givenName: persons.givenName,
      middleName: persons.middleName,
      surname: persons.surname,
      maidenName: persons.maidenName,
      nickname: persons.nickname,
      sex: persons.sex,
      birthDate: persons.birthDate,
      birthPlace: persons.birthPlace,
      deathDate: persons.deathDate,
      deathPlace: persons.deathPlace,
      causeOfDeath: persons.causeOfDeath,
      isLiving: persons.isLiving,
      occupation: persons.occupation,
      education: persons.education,
      biography: persons.biography,
      notes: persons.notes,
      siblingOrder: persons.siblingOrder,
    })
    .from(persons)
    .where(and(eq(persons.treeId, treeId), isNull(persons.deletedAt)))
    .orderBy(asc(persons.createdAt), asc(persons.id));
  const live = new Set(people.map((p) => p.id));
  const liveOrNull = (pid: string | null) => (pid !== null && live.has(pid) ? pid : null);

  const unionRows = await db
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
    .where(and(eq(unions.treeId, treeId), isNull(unions.deletedAt)))
    .orderBy(asc(unions.createdAt), asc(unions.id));
  const liveUnions = unionRows
    .map((u) => ({
      ...u,
      partnerAId: liveOrNull(u.partnerAId),
      partnerBId: liveOrNull(u.partnerBId),
    }))
    .filter((u) => u.partnerAId !== null || u.partnerBId !== null);
  const unionIds = new Set(liveUnions.map((u) => u.id));

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
      .orderBy(asc(parentChild.createdAt), asc(parentChild.id))
  ).filter((l) => unionIds.has(l.unionId) && live.has(l.childId));

  const places = (
    await db
      .select({
        id: residences.id,
        personId: residences.personId,
        place: residences.place,
        fromDate: residences.fromDate,
        toDate: residences.toDate,
      })
      .from(residences)
      .where(eq(residences.treeId, treeId))
      .orderBy(asc(residences.createdAt), asc(residences.id))
  ).filter((r) => live.has(r.personId));

  // Primary photos first, then oldest: per person that numbers the primary 1 (decision 2).
  const photoRows = (
    await db
      .select({
        id: photos.id,
        personId: photos.personId,
        key: photos.storageKeyFull,
        width: photos.width,
        height: photos.height,
        isPrimary: photos.isPrimary,
        bytes: photos.bytes,
      })
      .from(photos)
      .where(eq(photos.treeId, treeId))
      .orderBy(desc(photos.isPrimary), asc(photos.createdAt), asc(photos.id))
  ).filter((p) => live.has(p.personId));

  return {
    data: {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: now.toISOString(),
      tree: { ...tree, rootPersonId: liveOrNull(tree.rootPersonId) },
      persons: people,
      unions: liveUnions,
      parentChild: links,
      residences: places,
      photos: photoRows.map((p) => ({
        id: p.id,
        personId: p.personId,
        file: null,
        width: p.width,
        height: p.height,
        isPrimary: p.isPrimary,
      })),
    },
    photoKeys: new Map(photoRows.map((p) => [p.id, p.key])),
    photoBytes: photoRows.reduce((n, p) => n + p.bytes, 0),
  };
}
```

- [ ] **Step 5: Write `export/write.ts`:**

```ts
import type { ExportData } from '@family-tree/shared';
import type { ObjectStore } from '../storage/objects.js';
import { buildGedcom, personXrefs, photoFileName } from './gedcom.js';
import type { LoadedExport } from './load.js';
import type { ZipWriter } from './zip.js';

/** ASCII only, so Content-Disposition needs no encoding. */
export const exportFileName = (now: Date) => `family-tree-${now.toISOString().slice(0, 10)}.zip`;

/**
 * Writes the archive: the photos first, one in memory at a time, then tree.ged and tree.json,
 * which name only the photos that were really written (a missing object gets `file: null`).
 */
export async function writeExport(
  zip: ZipWriter,
  loaded: LoadedExport,
  store: ObjectStore,
  { exporterName, now }: { exporterName: string; now: Date },
): Promise<{ photos: number; missing: number }> {
  const xrefs = personXrefs(loaded.data.persons);
  const perPerson = new Map<string, number>();
  const written: ExportData['photos'] = [];
  let missing = 0;
  for (const photo of loaded.data.photos) {
    const body = await store.get(loaded.photoKeys.get(photo.id)!);
    if (body === null) {
      missing++;
      written.push({ ...photo, file: null });
      continue;
    }
    const n = (perPerson.get(photo.personId) ?? 0) + 1;
    perPerson.set(photo.personId, n);
    const file = photoFileName(xrefs.get(photo.personId)!, n);
    await zip.add(file, body);
    written.push({ ...photo, file });
  }
  const data: ExportData = { ...loaded.data, photos: written };
  await zip.add('tree.ged', Buffer.from(buildGedcom(data, { exporterName, now }), 'utf8'), {
    compress: true,
  });
  await zip.add('tree.json', Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8'), {
    compress: true,
  });
  await zip.finish();
  return { photos: written.length - missing, missing };
}
```

- [ ] **Step 6: Write `routes/export.ts`:**

```ts
import { EXPORT_MAX_PHOTO_BYTES } from '@family-tree/shared';
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import { AppError, idParam, safeError } from '../errors.js';
import { loadExport } from '../export/load.js';
import { exportFileName, writeExport } from '../export/write.js';
import { ZipAborted, ZipWriter } from '../export/zip.js';
import { TREE } from '../permissions/can.js';
import { extraLimit } from '../security/limits.js';
import { authorize, loadAccess } from '../trees/access.js';
import type { TreeRouteOptions } from './trees.js';

/** Exports streaming at once in one API process (decision 8). */
export const EXPORT_CONCURRENCY = 2;

const busy = () => new AppError('RATE_LIMITED', 503, 'Exports are busy, try again in a minute');
const tooLarge = () =>
  new AppError('VALIDATION', 400, 'This tree is too large to export as one file', {
    reason: 'tooLarge',
  });

export const exportRoutes: FastifyPluginAsync<
  TreeRouteOptions & { exportConcurrency?: number }
> = async (app, { auth, db, storage, exportConcurrency = EXPORT_CONCURRENCY }) => {
  app.addHook('preHandler', requireSession(auth));
  let active = 0;

  /** Spec §7: one ZIP with tree.ged (GEDCOM 5.5.1), tree.json and photos/ (decisions 2–8). */
  app.get(
    '/api/v1/trees/:treeId/export',
    {
      preHandler: extraLimit(app, { name: 'export', max: 5, timeWindow: '1 hour', by: 'user' }),
    },
    async (req, reply) => {
      const treeId = idParam(req.params, 'treeId');
      const now = new Date();
      let held = false;
      const release = () => {
        if (held) {
          held = false;
          active--;
        }
      };
      try {
        const loaded = await db.transaction(
          async (tx) => {
            const access = await loadAccess(tx, treeId, req.user!.id);
            authorize(access, 'tree.export', TREE);
            if (active >= exportConcurrency) {
              void reply.header('retry-after', '30');
              throw busy();
            }
            active++;
            held = true;
            return loadExport(tx, access.treeId, now);
          },
          { isolationLevel: 'repeatable read', accessMode: 'read only' },
        );
        if (loaded.photoBytes > EXPORT_MAX_PHOTO_BYTES) throw tooLarge();

        const zip = new ZipWriter(now);
        zip.stream.once('close', release);
        void writeExport(zip, loaded, storage, { exporterName: req.user!.name, now })
          .then(({ photos, missing }) =>
            req.log.info(
              { treeId, persons: loaded.data.persons.length, photos, missing },
              'tree exported',
            ),
          )
          .catch((err: unknown) => {
            if (err instanceof ZipAborted) req.log.info({ treeId }, 'export stopped: client left');
            else req.log.error({ err: safeError(err), treeId }, 'export failed');
            zip.abort(new Error('export failed'));
          })
          .finally(release);
        return reply
          .header('content-type', 'application/zip')
          .header('content-disposition', `attachment; filename="${exportFileName(now)}"`)
          .header('cache-control', 'no-store')
          .send(zip.stream);
      } catch (err) {
        release();
        throw err;
      }
    },
  );
};
```

- [ ] **Step 7: Wire it in `app.ts`:**
  - Import `exportRoutes`.
  - Add to `AppOptions`: `/** Exports at once (default 2); tests pass 0 to check the busy answer. */ exportConcurrency?: number;`.
  - Destructure it in `buildApp`.
  - Register it after `searchRoutes`:

```ts
    app.register(exportRoutes, {
      auth,
      db,
      config,
      storage: store!,
      ...(exportConcurrency !== undefined ? { exportConcurrency } : {}),
    });
```

- [ ] **Step 8: Add the route to the isolation test.** In `isolation.int.test.ts`, after the relationship route, add: `['GET', \`/api/v1/trees/${t}/export\`],`.

- [ ] **Step 9: Run the export, isolation and objects integration tests, then the whole API suite:**

```bash
docker compose up -d --wait postgres s3
rtk proxy pnpm --filter @family-tree/api exec vitest run --config vitest.int.config.ts src/routes/export.int.test.ts src/routes/isolation.int.test.ts src/storage/objects.int.test.ts
pnpm --filter @family-tree/api test && pnpm test:int && pnpm --filter @family-tree/api typecheck
```

  Expected: everything passes, including 5 new export tests and 2 new store tests. If the isolation test's export call returns 429 in the "deleted tree" case, check the per-user counter: each user calls the route at most twice there, so it shouldn't. Don't raise the limit.

- [ ] **Step 10: Check the archive with independent readers** (a scratch check, not committed).
  1. Temporarily add one line to the first export test, after `exportOf`: `if (process.env.EXPORT_ZIP_OUT) writeFileSync(process.env.EXPORT_ZIP_OUT, res.rawPayload);` (import `writeFileSync` from `node:fs`).
  2. Run that test with `EXPORT_ZIP_OUT=<scratchpad>/export.zip`.
  3. Then:

```bash
unzip -t <scratchpad>/export.zip
python3 -I -c "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip(), sorted(i.filename for i in z.infolist()))" <scratchpad>/export.zip
```

  Expected: `No errors detected`, then `None ['photos/I1-1.webp', 'tree.ged', 'tree.json']`.

  Remove the temporary line (`git diff` must not show it) and delete the scratch ZIP.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/export/load.ts apps/api/src/export/write.ts apps/api/src/routes/export.ts \
  apps/api/src/routes/export.int.test.ts apps/api/src/storage/objects.ts \
  apps/api/src/storage/objects.int.test.ts apps/api/src/app.ts apps/api/src/routes/isolation.int.test.ts
git commit -m "feat(api): owner-only streaming ZIP export with GEDCOM, JSON and photos"
```

---
## Task 6: Web — Export in Tree settings

**Files:**
- Create: `apps/web/src/trees/download.ts`, `apps/web/src/trees/download.test.ts`
- Modify: `apps/web/src/auth/api.ts` (`MESSAGES`), `apps/web/src/trees/api.ts`, `apps/web/src/trees/api.test.ts`, `apps/web/src/test/fake-trees.ts`, `apps/web/src/pages/TreePage.tsx`, `apps/web/src/pages/TreePage.test.tsx`

- [ ] **Step 1: Write the failing `download.test.ts`:**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileNameFrom, saveFile } from './download';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('fileNameFrom', () => {
  it('reads a plain quoted file name', () => {
    expect(fileNameFrom('attachment; filename="family-tree-2026-11-10.zip"')).toBe(
      'family-tree-2026-11-10.zip',
    );
  });

  it('falls back for a missing or unusual name', () => {
    expect(fileNameFrom(null)).toBe('family-tree-export.zip');
    expect(fileNameFrom('attachment; filename="../../x y.zip"')).toBe('family-tree-export.zip');
  });
});

describe('saveFile', () => {
  it('clicks a temporary download link and revokes the URL a minute later', () => {
    vi.useFakeTimers();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const seen: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      seen.push({ href: this.href, download: this.download });
    });
    saveFile(new Blob(['PK']), 't.zip');
    expect(create).toHaveBeenCalledOnce();
    expect(seen).toEqual([{ href: 'blob:export', download: 't.zip' }]);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith('blob:export');
  });
});
```

  Run: `rtk proxy pnpm --filter @family-tree/web exec vitest run src/trees/download.test.ts`. Expected: FAIL, the module is missing.

- [ ] **Step 2: Write `apps/web/src/trees/download.ts`:**

```ts
/** The file name from `Content-Disposition: attachment; filename="…"`, or a safe default. */
export function fileNameFrom(header: string | null): string {
  const match = header?.match(/filename="([A-Za-z0-9._-]+)"/);
  return match?.[1] ?? 'family-tree-export.zip';
}

/** Saves a blob through a temporary object URL and a download link (decision 9). */
export function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  // The download has started by then; keeping the URL longer would hold the blob in memory.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
```

  Run the test: it passes.

- [ ] **Step 3: Write the failing API client tests.** Append to `apps/web/src/trees/api.test.ts`, and import `MESSAGES` from `../auth/api` and `createTreesApi` if the file doesn't already:

```ts
describe('exportTree', () => {
  afterEach(() => vi.unstubAllGlobals());
  const api = createTreesApi({ baseUrl: 'https://api.example.com' });

  it('returns the ZIP and its file name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new Uint8Array([0x50, 0x4b]), {
            status: 200,
            headers: {
              'content-type': 'application/zip',
              'content-disposition': 'attachment; filename="family-tree-2026-11-10.zip"',
            },
          }),
      ),
    );
    const res = await api.exportTree('t1');
    expect(fetch).toHaveBeenCalledWith('https://api.example.com/api/v1/trees/t1/export', {
      credentials: 'include',
    });
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.fileName).toBe('family-tree-2026-11-10.zip');
    expect((await res.data.blob.arrayBuffer()).byteLength).toBe(2);
  });

  it.each([
    [429, 'RATE_LIMITED', undefined, MESSAGES.exportLimited],
    [503, 'RATE_LIMITED', undefined, MESSAGES.exportLimited],
    [400, 'VALIDATION', { reason: 'tooLarge' }, MESSAGES.exportTooLarge],
  ])('maps %i %s to a fixed message', async (status, code, details, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { code, message: 'server text', ...(details ? { details } : {}) } },
          { status },
        ),
      ),
    );
    expect(await api.exportTree('t1')).toEqual({
      ok: false,
      error: expect.objectContaining({ code, message }),
    });
  });
});
```

  Run: `rtk proxy pnpm --filter @family-tree/web exec vitest run src/trees/api.test.ts`. Expected: FAIL, `exportTree` is not a function.

- [ ] **Step 4: Implement the client.**

  In `auth/api.ts`, add to `MESSAGES`:

```ts
  exportLimited: 'This tree was exported several times just now. Try again in a little while.',
  exportTooLarge: 'This tree has too many photos to export as one file.',
```

  In `trees/api.ts`:
  - Add `exportTree(treeId: string): Promise<Result<{ blob: Blob; fileName: string }>>;` to `TreesApi`, and `exportTree: true,` to `TREES_API_METHODS`.
  - Import `fileNameFrom` from `./download`.
  - **Extract the error mapping.** Move the `!res.ok` branch of `request` into a function inside `createTreesApi`, so the export uses the same mapping:

```ts
  /** An API error response as a fixed message (codes and reasons map to MESSAGES). */
  async function errorFrom(
    res: Response,
    kind: CallKind,
    codes?: Partial<Record<string, string>>,
    reasons?: Partial<Record<string, string>>,
  ): Promise<AuthError> {
    const parsed = apiErrorSchema.safeParse(await res.json().catch(() => null));
    const error = toAuthError(res.status, parsed.success ? parsed.data.error.code : undefined, kind);
    const reason = parsed.success
      ? (parsed.data.error.details as { reason?: unknown } | undefined)?.reason
      : undefined;
    const override =
      (typeof reason === 'string' ? reasons?.[reason] : undefined) ?? codes?.[error.code];
    return override ? { ...error, message: override } : error;
  }
```

  - In `request`, replace the old branch with `if (!res.ok) return { ok: false, error: await errorFrom(res, kind, codes, reasons) };`. Import `AuthError` as a type if it isn't already.
  - Add the method to the returned object:

```ts
    exportTree: async (treeId) => {
      let res: Response;
      try {
        res = await fetch(`${origin}/api/v1${t(treeId)}/export`, { credentials: 'include' });
      } catch {
        return { ok: false, error: { code: 'NETWORK', message: MESSAGES.network } };
      }
      if (!res.ok) {
        return {
          ok: false,
          error: await errorFrom(
            res,
            'session',
            { RATE_LIMITED: MESSAGES.exportLimited },
            { tooLarge: MESSAGES.exportTooLarge },
          ),
        };
      }
      try {
        const blob = await res.blob();
        return { ok: true, data: { blob, fileName: fileNameFrom(res.headers.get('content-disposition')) } };
      } catch {
        return { ok: false, error: { code: 'NETWORK', message: MESSAGES.network } };
      }
    },
```

  In `test/fake-trees.ts`, add:

```ts
  async exportTree(treeId: string) {
    const forced = await this.enter('exportTree', treeId);
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t) return notFound();
    if (!t.detail.capabilities.manageTree) return forbidden();
    return ok({
      blob: new Blob(['PK'], { type: 'application/zip' }),
      fileName: 'family-tree-2026-11-10.zip',
    });
  }
```

  Run the API client tests and the fake's own test (`src/test/fake-trees.test.ts`, which checks `TREES_API_METHODS`). Both pass.

- [ ] **Step 5: Write the failing page tests.** Add `vi` to the vitest import in `TreePage.test.tsx`, then:

```tsx
  it('lets the owner download the export', async () => {
    const s = setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderAt(`/trees/${s.id}`, s);
    const section = await screen.findByRole('region', { name: 'Export' });
    expect(section).toHaveTextContent('living relatives');
    s.trees.hold('exportTree');
    fireEvent.click(within(section).getByRole('button', { name: 'Download export' }));
    expect(
      await within(section).findByRole('button', { name: 'Preparing export…' }),
    ).toBeDisabled();
    s.trees.release();
    expect(await within(section).findByText('Your export has downloaded.')).toBeInTheDocument();
    expect(s.trees.callsTo('exportTree')).toEqual([s.id]);
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it('shows a fixed message when the export is refused', async () => {
    const s = setup();
    s.trees.failNext('exportTree', { code: 'RATE_LIMITED', message: MESSAGES.exportLimited });
    renderAt(`/trees/${s.id}`, s);
    const section = await screen.findByRole('region', { name: 'Export' });
    fireEvent.click(within(section).getByRole('button', { name: 'Download export' }));
    expect(await within(section).findByText(MESSAGES.exportLimited)).toBeInTheDocument();
  });

  it('has no Export for viewers and editors', async () => {
    const s = setup({ role: 'viewer', detail: { capabilities: viewerCaps } });
    renderAt(`/trees/${s.id}`, s);
    expect(await screen.findByText('You are a viewer of this tree.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Export' })).not.toBeInTheDocument();
  });
```

  Run: `rtk proxy pnpm --filter @family-tree/web exec vitest run src/pages/TreePage.test.tsx`. Expected: the 2 owner tests fail (there is no Export region yet).

- [ ] **Step 6: Add `ExportSection` to `TreePage.tsx`.** Render `<ExportSection treeId={treeId} />` inside `Settings`, just before `<h3>Delete this tree</h3>`. Import `saveFile` from `../trees/download`.

```tsx
/** Owner only (spec §4): the whole tree as one ZIP (decisions 2, 5, 9). */
function ExportSection({ treeId }: { treeId: string }) {
  const api = useTreesApi();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function run() {
    setError(null);
    setDone(false);
    setPending(true);
    const res = await api.exportTree(treeId);
    setPending(false);
    if (!res.ok) return setError(res.error.message);
    saveFile(res.data.blob, res.data.fileName);
    setDone(true);
  }

  return (
    <section aria-labelledby="export-heading">
      <h3 id="export-heading">Export</h3>
      <p>
        Download everything in this tree as one ZIP file: <code>tree.ged</code> (GEDCOM, which most
        family-tree programs can open), the photos, and <code>tree.json</code> (a complete copy of
        the data). It includes details of living relatives, so keep it private.
      </p>
      <FormError>{error}</FormError>
      {done && (
        <p role="status" className="success">
          Your export has downloaded.
        </p>
      )}
      <button type="button" disabled={pending} onClick={() => void run()}>
        {pending ? 'Preparing export…' : 'Download export'}
      </button>
    </section>
  );
}
```

  No new CSS: the section reuses the existing button, `success` and `FormError` styles, so dark mode (`Canvas`/`CanvasText`) is unchanged.

- [ ] **Step 7: Run the web suite:** `pnpm --filter @family-tree/web test && pnpm --filter @family-tree/web typecheck && pnpm lint`. All pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/trees/download.ts apps/web/src/trees/download.test.ts apps/web/src/auth/api.ts \
  apps/web/src/trees/api.ts apps/web/src/trees/api.test.ts apps/web/src/test/fake-trees.ts \
  apps/web/src/pages/TreePage.tsx apps/web/src/pages/TreePage.test.tsx
git commit -m "feat(web): owner-only Export in tree settings"
```

---

## Task 7: API — production configuration: the migration CLI, `MIGRATE_ON_START` and `AUTH_RATE_LIMIT_ENABLED`

**Files:**
- Create: `apps/api/src/db/migrate-cli.ts`, `apps/api/src/auth/auth-rate-limit-off.int.test.ts`
- Modify: `apps/api/src/config.ts`, `apps/api/src/config.test.ts`, `apps/api/src/auth/auth.ts`, `apps/api/src/server.ts`, `apps/api/package.json`, `compose.yml`

- [ ] **Step 1: Write the failing config tests.** Append to `config.test.ts`, inside `describe('loadConfig')`:

```ts
  it('migrates on start and keeps the auth rate limits on by default', () => {
    const config = loadConfig(devEnv);
    expect(config.MIGRATE_ON_START).toBe(true);
    expect(config.AUTH_RATE_LIMIT_ENABLED).toBe(true);
  });

  it('lets development turn the auth rate limits off (for E2E)', () => {
    expect(loadConfig({ ...devEnv, AUTH_RATE_LIMIT_ENABLED: 'false' }).AUTH_RATE_LIMIT_ENABLED).toBe(
      false,
    );
  });

  it('refuses auth rate limits off in production, and accepts MIGRATE_ON_START=false', () => {
    expect(() => loadConfig({ ...prodEnv, AUTH_RATE_LIMIT_ENABLED: 'false' })).toThrowError(
      /AUTH_RATE_LIMIT_ENABLED/,
    );
    expect(loadConfig({ ...prodEnv, MIGRATE_ON_START: 'false' }).MIGRATE_ON_START).toBe(false);
  });
```

  Run: `rtk proxy pnpm --filter @family-tree/api exec vitest run src/config.test.ts`. Expected: 3 failures (the properties are `undefined`).

- [ ] **Step 2: Implement the config.** In `configSchema`'s object, after `TREE_PURGE_INTERVAL_MINUTES`:

```ts
    // Spec §10: migrations run at startup. Production runs them in the one-shot `migrate`
    // service as the owner role, so the API itself runs as a role without DDL rights.
    MIGRATE_ON_START: bool.default(true),
    // Better Auth's sign-in, sign-up and 2FA limits. Only the E2E dev stack turns them off.
    AUTH_RATE_LIMIT_ENABLED: bool.default(true),
```

  In `superRefine`, next to the `S3_CREATE_BUCKET` check:

```ts
    if (!config.AUTH_RATE_LIMIT_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_RATE_LIMIT_ENABLED'],
        message: 'Must be true in production',
      });
    }
```

  Run the config tests: they pass.

- [ ] **Step 3: Write the failing integration test,** `auth/auth-rate-limit-off.int.test.ts`. It has to be its own file, because the memory store is shared within a file.

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { call, signUp } from '../../test/auth-helpers.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDeps } from '../deps.js';
import { createAuth } from './auth.js';

const config = loadConfig({ ...process.env, AUTH_RATE_LIMIT_ENABLED: 'false' });
const deps = createDeps(config);
const auth = createAuth({ config, db: deps.db }); // no explicit rateLimitEnabled: from config
const app = buildApp({ config, checks: deps.checks, auth, db: deps.db });

afterAll(async () => {
  await app.close();
  await deps.close();
});

describe('AUTH_RATE_LIMIT_ENABLED=false', () => {
  it('lets more than 5 failed sign-ins through (E2E only; production refuses it)', async () => {
    const { email } = await signUp(app);
    for (let i = 0; i < 7; i++) {
      const res = await call(app, 'POST', '/api/auth/sign-in/email', {
        body: { email, password: 'not the password' },
      });
      expect(res.statusCode).toBe(401);
    }
  });
});
```

  Run it. Expected: FAIL, the 6th attempt is 429.

- [ ] **Step 4: Use the config default in `createAuth`.**
  - In `AuthOptions`, update the comment: `/** Tests can force Better Auth's own rate limiter on or off; default: AUTH_RATE_LIMIT_ENABLED. */`.
  - Remove the `= true` default from the destructuring.
  - Set `enabled: rateLimitEnabled ?? config.AUTH_RATE_LIMIT_ENABLED,`.

  Run the new test and `auth-rate-limit.int.test.ts`. Both pass: the old test uses the default config, which is `true`.

- [ ] **Step 5: Add `db/migrate-cli.ts`:**

```ts
// Production: runs the migrations once, as the database owner role, before the API starts (the
// compose.prod.yml `migrate` service, decision 12). Dev and tests migrate on API start instead.
// Usage: MIGRATION_DATABASE_URL=postgres://family_owner:…@postgres:5432/family node dist/db/migrate-cli.js
import { z } from 'zod';
import { createDb } from './client.js';
import { runMigrations } from './migrate.js';

const parsed = z
  .object({ MIGRATION_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }) })
  .safeParse(process.env);
if (!parsed.success) {
  console.error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}
const { db, sql } = createDb(parsed.data.MIGRATION_DATABASE_URL);
try {
  await runMigrations(db);
  console.log('Migrations are up to date.');
} finally {
  await sql.end({ timeout: 5 });
}
```

  In `apps/api/package.json`, add the script `"db:migrate:prod": "node dist/db/migrate-cli.js"`.

  In `server.ts`, replace `await runMigrations(deps.db);` with:

```ts
// Production migrates in the one-shot `migrate` service as the owner role (decision 12).
if (config.MIGRATE_ON_START) await runMigrations(deps.db);
```

- [ ] **Step 6: Pass the switch through in dev compose.** In `compose.yml`, add this under `api.environment`:

```yaml
      # E2E only: `AUTH_RATE_LIMIT_ENABLED=false pnpm dev` (Phase 7 decision 15).
      AUTH_RATE_LIMIT_ENABLED: ${AUTH_RATE_LIMIT_ENABLED:-true}
```

- [ ] **Step 7: Check that the CLI runs against the dev database.**

```bash
pnpm --filter @family-tree/api build
MIGRATION_DATABASE_URL=postgres://family:dev-only-pw@localhost:5432/family node apps/api/dist/db/migrate-cli.js
node apps/api/dist/db/migrate-cli.js; echo "exit $?"
```

  Expected: `Migrations are up to date.`, then `Invalid configuration: … MIGRATION_DATABASE_URL` with `exit 1`.

- [ ] **Step 8: Run the checks,** `pnpm --filter @family-tree/api test && pnpm test:int && pnpm typecheck`, then commit:

```bash
git add apps/api/src/db/migrate-cli.ts apps/api/src/auth/auth-rate-limit-off.int.test.ts \
  apps/api/src/config.ts apps/api/src/config.test.ts apps/api/src/auth/auth.ts \
  apps/api/src/server.ts apps/api/package.json compose.yml
git commit -m "feat(api): migrate CLI, MIGRATE_ON_START and a dev-only auth rate-limit switch"
```

---

## Task 8: API — the orphan sweep

**Files:**
- Create: `apps/api/src/storage/sweep.ts`, `apps/api/src/storage/sweep.int.test.ts`
- Modify: `apps/api/src/trees/purge.ts`, `apps/api/src/trees/purge-cli.ts`, `apps/api/src/server.ts`

- [ ] **Step 1: Write the failing `sweep.int.test.ts`:**

```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { addPhotoRow, objectExists } from '../../test/photo-helpers.js';
import { loadConfig } from '../config.js';
import { persons, storageDeletions, trees } from '../db/schema.js';
import { createDeps } from '../deps.js';
import { queueObjectDeletes } from './deletions.js';
import { sweepOrphans } from './sweep.js';

const config = loadConfig();
const deps = createDeps(config);
const { db, storage } = deps;
afterAll(async () => {
  await deps.close();
});

const DAY = 86_400_000;
const bytes = new Uint8Array([1, 2, 3]);

async function setup() {
  const [tree] = await db.insert(trees).values({ name: 'Sweep test' }).returning();
  const [p] = await db.insert(persons).values({ treeId: tree!.id, givenName: 'P' }).returning();
  const prefix = `trees/${tree!.id}/`;
  const kept = await addPhotoRow(db, tree!.id, p!.id);
  for (const k of [kept.storageKeyFull, kept.storageKeyThumb]) {
    await storage.put(k, bytes, 'image/webp');
  }
  const orphan = `${prefix}photos/${randomUUID()}/full.webp`;
  await storage.put(orphan, bytes, 'image/webp');
  const queued = `${prefix}photos/${randomUUID()}/thumb.webp`;
  await storage.put(queued, bytes, 'image/webp');
  await queueObjectDeletes(db, [queued]);
  return { prefix, kept, orphan, queued };
}

describe('sweepOrphans', () => {
  it('deletes only objects older than a day that no row knows', async () => {
    const s = await setup();
    // Fresh objects are never orphans: an upload writes them before its row (Phase 6 decision 6).
    expect(await sweepOrphans(db, storage, { prefix: s.prefix })).toMatchObject({
      scanned: 4,
      deleted: 0,
    });
    const later = await sweepOrphans(db, storage, { prefix: s.prefix, now: Date.now() + 2 * DAY });
    expect(later).toMatchObject({ scanned: 4, deleted: 1 });
    expect(await objectExists(deps, s.orphan)).toBe(false);
    expect(await objectExists(deps, s.kept.storageKeyFull)).toBe(true);
    expect(await objectExists(deps, s.kept.storageKeyThumb)).toBe(true);
    expect(await objectExists(deps, s.queued)).toBe(true); // the outbox owns it
  });

  it('warns about queued deletions that keep failing', async () => {
    const key = `trees/${randomUUID()}/photos/${randomUUID()}/full.webp`;
    await db.insert(storageDeletions).values({ key, attempts: 12 });
    const log = { warn: vi.fn() };
    try {
      const r = await sweepOrphans(db, storage, { prefix: `trees/${randomUUID()}/`, log });
      expect(r.stuck).toBeGreaterThanOrEqual(1);
      expect(log.warn).toHaveBeenCalledWith(
        { count: r.stuck },
        'stored objects keep failing to delete',
      );
    } finally {
      await db.delete(storageDeletions).where(eq(storageDeletions.key, key));
    }
  });
});
```

  Run: `rtk proxy pnpm --filter @family-tree/api exec vitest run --config vitest.int.config.ts src/storage/sweep.int.test.ts`. Expected: FAIL, the module is missing.

- [ ] **Step 2: Write `storage/sweep.ts`:**

```ts
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import type { ObjectStore } from './objects.js';

/** Younger objects may belong to an upload whose row isn't committed yet (decision 17). */
export const ORPHAN_MIN_AGE_MS = 24 * 3_600_000;
/** Outbox rows with this many failed attempts are reported. */
export const STUCK_ATTEMPTS = 10;

/**
 * Deletes stored objects under `prefix` that are older than `minAgeMs` and known to no photos
 * row and no storage_deletions row (the outbox deletes those itself). Covers a crash between
 * upload and insert, and a database restored to before some uploads. Reports stuck outbox rows.
 */
export async function sweepOrphans(
  db: Db,
  store: ObjectStore,
  {
    prefix = 'trees/',
    now = Date.now(),
    minAgeMs = ORPHAN_MIN_AGE_MS,
    log,
  }: {
    prefix?: string;
    now?: number;
    minAgeMs?: number;
    log?: { warn?(obj: object, msg: string): void };
  } = {},
): Promise<{ scanned: number; deleted: number; stuck: number }> {
  const known = new Set(
    (
      (await db.execute(sql`
        select storage_key_full as k from photos
        union all select storage_key_thumb from photos
        union all select key from storage_deletions`)) as unknown as { k: string }[]
    ).map((r) => r.k),
  );
  let scanned = 0;
  let deleted = 0;
  for await (const o of store.list(prefix)) {
    scanned++;
    if (known.has(o.key) || now - o.lastModified.getTime() < minAgeMs) continue;
    await store.delete(o.key);
    deleted++;
  }
  const [row] = (await db.execute(
    sql`select count(*)::int as n from storage_deletions where attempts >= ${STUCK_ATTEMPTS}`,
  )) as unknown as { n: number }[];
  const stuck = row?.n ?? 0;
  if (stuck > 0) log?.warn?.({ count: stuck }, 'stored objects keep failing to delete');
  return { scanned, deleted, stuck };
}
```

  Run the sweep test: it passes.

- [ ] **Step 3: Run it from the purge job (at most once a day) and from the CLI.**

  In `purge.ts`:
  - Add `warn?(obj: object, msg: string): void;` to `JobLog`.
  - Change the signature to `startPurgeJob(db, log, intervalMs, store?, { sweepEveryMs = 0 }: { sweepEveryMs?: number } = {})`.
  - Add `let lastSweep = 0;` before `tick`.
  - Inside the `.then` after the drain loop, add:

```ts
        // The orphan sweep lists the whole bucket, so it runs at most once per sweepEveryMs.
        if (sweepEveryMs > 0 && Date.now() - lastSweep >= sweepEveryMs) {
          lastSweep = Date.now();
          const { deleted } = await sweepOrphans(db, store, { log });
          if (deleted > 0) log.info({ deleted }, 'removed orphaned stored objects');
        }
```

  Import `sweepOrphans`. The existing tests pass `{ info, error }` loggers and no options, so nothing changes for them.

  In `server.ts`, pass `deps.storage, { sweepEveryMs: 86_400_000 }` to `startPurgeJob`.

  In `purge-cli.ts`, after the drain loop:

```ts
  if (process.argv.slice(2).includes('--sweep')) {
    const r = await sweepOrphans(db, store, {
      log: { warn: (obj, msg) => console.warn(msg, obj) },
    });
    console.log(
      `Checked ${r.scanned} stored object(s); removed ${r.deleted} orphan(s).` +
        (r.stuck > 0 ? ` ${r.stuck} queued deletion(s) keep failing.` : ''),
    );
  }
```

  Update its header comment to `Dev: pnpm purge-trees [--sweep]. Production: node dist/trees/purge-cli.js [--sweep]`.

- [ ] **Step 4: Run the checks.**

```bash
pnpm --filter @family-tree/api typecheck && pnpm test:int
pnpm dev   # in another terminal, if it isn't running
pnpm purge-trees --sweep
```

  Expected:
  - All integration tests pass.
  - The CLI prints `Purged …`, `Deleted …`, then `Checked N stored object(s); removed 0 orphan(s).`. N is the dev bucket's object count, and an old orphan would also be removed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/storage/sweep.ts apps/api/src/storage/sweep.int.test.ts \
  apps/api/src/trees/purge.ts apps/api/src/trees/purge-cli.ts apps/api/src/server.ts
git commit -m "feat(api): daily sweep of orphaned photo objects, and a stuck-outbox warning"
```

---

## Task 9: Web — security headers for the static site

**Files:**
- Create: `apps/web/security-headers.ts`, `apps/web/security-headers.test.ts`
- Modify: `apps/web/vite.config.ts`, `apps/web/tsconfig.json`

- [ ] **Step 1: Write the failing `apps/web/security-headers.test.ts`:**

```ts
import { describe, expect, it } from 'vitest';
import { caddyHeadersSnippet, pagesHeadersFile, securityHeaders } from './security-headers';

const origins = {
  apiOrigin: 'https://api.family.example.com',
  photoOrigin: 'https://abc.r2.cloudflarestorage.com',
};

describe('securityHeaders', () => {
  it('builds a strict CSP around the API and photo origins', () => {
    const csp = securityHeaders(origins)['Content-Security-Policy']!;
    const directives = Object.fromEntries(
      csp.split('; ').map((d) => {
        const [name, ...values] = d.split(' ');
        return [name, values.join(' ')];
      }),
    );
    expect(directives).toEqual({
      'default-src': "'none'",
      'script-src': "'self'",
      'style-src': "'self' 'unsafe-inline'",
      'img-src': "'self' data: blob: https://abc.r2.cloudflarestorage.com",
      'connect-src': "'self' https://api.family.example.com",
      'worker-src': "'self'",
      'font-src': "'self'",
      'manifest-src': "'self'",
      'base-uri': "'none'",
      'form-action': "'self'",
      'frame-ancestors': "'none'",
      'object-src': "'none'",
    });
    expect(csp).not.toMatch(/unsafe-eval|\*/);
  });

  it('sets the other hardening headers', () => {
    const h = securityHeaders(origins);
    expect(h).toMatchObject({
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    });
    expect(h['Permissions-Policy']).toContain('camera=()');
  });

  it('accepts a trailing slash or a port, and refuses paths and http', () => {
    const csp = securityHeaders({
      apiOrigin: 'https://api.family.test:8443/',
      photoOrigin: 'https://s3.family.test:8443',
    })['Content-Security-Policy'];
    expect(csp).toContain("connect-src 'self' https://api.family.test:8443;");
    expect(() => securityHeaders({ ...origins, apiOrigin: 'https://api.example.com/v1' })).toThrow(
      /VITE_API_BASE_URL/,
    );
    expect(() => securityHeaders({ ...origins, photoOrigin: 'http://r2.example.com' })).toThrow(
      /VITE_PHOTO_ORIGIN/,
    );
  });
});

describe('pagesHeadersFile', () => {
  it('renders the Cloudflare Pages _headers format, with immutable assets', () => {
    expect(pagesHeadersFile({ A: '1', 'B-C': 'x y' })).toBe(
      '/*\n  A: 1\n  B-C: x y\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n',
    );
  });
});

describe('caddyHeadersSnippet', () => {
  it('renders a Caddy header block with quoted values', () => {
    expect(caddyHeadersSnippet({ A: 'it\'s "q"' })).toBe(
      'header {\n\tA "it\'s \\"q\\""\n}\n@assets path /assets/*\n' +
        'header @assets Cache-Control "public, max-age=31536000, immutable"\n',
    );
  });
});
```

  Run: `rtk proxy pnpm --filter @family-tree/web exec vitest run security-headers.test.ts`. Expected: FAIL, the module is missing.

- [ ] **Step 2: Write `apps/web/security-headers.ts`:**

```ts
/**
 * Response headers for the static site (spec §8 "strict CSP on the frontend"; decision 13): one
 * source for Cloudflare Pages (`dist/_headers`) and the local stand-in (`dist/_headers.caddy`).
 */
export interface SiteOrigins {
  /** VITE_API_BASE_URL: fetches and uploads go here (Phase 6: never straight to storage). */
  apiOrigin: string;
  /** VITE_PHOTO_ORIGIN: where signed photo URLs point (R2's S3 endpoint in production). */
  photoOrigin: string;
}

export const IMMUTABLE = 'public, max-age=31536000, immutable';

function httpsOrigin(value: string, name: string): string {
  const url = URL.canParse(value) ? new URL(value) : null;
  if (!url || url.protocol !== 'https:' || value.replace(/\/+$/, '') !== url.origin) {
    throw new Error(`${name} must be an https origin like https://api.example.com`);
  }
  return url.origin;
}

export function securityHeaders({ apiOrigin, photoOrigin }: SiteOrigins): Record<string, string> {
  const api = httpsOrigin(apiOrigin, 'VITE_API_BASE_URL');
  const photos = httpsOrigin(photoOrigin, 'VITE_PHOTO_ORIGIN');
  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    // React Flow sets inline style attributes (transforms, sizes); hashes can't cover them.
    "style-src 'self' 'unsafe-inline'",
    // data: for the QR code, blob: for the cropper's preview.
    `img-src 'self' data: blob: ${photos}`,
    `connect-src 'self' ${api}`,
    // The ELK layout worker is a same-origin asset.
    "worker-src 'self'",
    "font-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
  return {
    'Content-Security-Policy': csp,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  };
}

/** Cloudflare Pages `_headers`: every path, plus long caching for hashed assets. */
export function pagesHeadersFile(headers: Record<string, string>): string {
  return [
    '/*',
    ...Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`),
    '/assets/*',
    `  Cache-Control: ${IMMUTABLE}`,
    '',
  ].join('\n');
}

/** The same headers as Caddy directives, imported by docker/caddy/Caddyfile.local. */
export function caddyHeadersSnippet(headers: Record<string, string>): string {
  const q = (v: string) => `"${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  return [
    'header {',
    ...Object.entries(headers).map(([k, v]) => `\t${k} ${q(v)}`),
    '}',
    '@assets path /assets/*',
    `header @assets Cache-Control ${q(IMMUTABLE)}`,
    '',
  ].join('\n');
}
```

  Add `"security-headers.ts"` to `include` in `apps/web/tsconfig.json`: `["src", "vite.config.ts", "security-headers.ts"]`.

  Run the test: 6 tests pass.

- [ ] **Step 3: Emit the files at build time.** In `apps/web/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { caddyHeadersSnippet, pagesHeadersFile, securityHeaders } from './security-headers';

/** dist/_headers (Cloudflare Pages), and dist/_headers.caddy for the local stack (decision 13). */
function siteHeaders(): Plugin {
  return {
    name: 'family-tree-site-headers',
    apply: 'build',
    generateBundle() {
      const apiOrigin = process.env.VITE_API_BASE_URL;
      const photoOrigin = process.env.VITE_PHOTO_ORIGIN;
      if (!apiOrigin || !photoOrigin) {
        const msg =
          'VITE_API_BASE_URL and VITE_PHOTO_ORIGIN are not set, so no _headers file was written ' +
          '(fine for dev and CI builds, never for a deployment)';
        // Cloudflare Pages sets CF_PAGES=1: a deployment must not ship without its CSP.
        if (process.env.CF_PAGES === '1') this.error(msg);
        this.warn(msg);
        return;
      }
      const headers = securityHeaders({ apiOrigin, photoOrigin });
      this.emitFile({ type: 'asset', fileName: '_headers', source: pagesHeadersFile(headers) });
      if (process.env.WEB_HEADERS_CADDY === '1') {
        this.emitFile({
          type: 'asset',
          fileName: '_headers.caddy',
          source: caddyHeadersSnippet(headers),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), siteHeaders()],
  // …server and test unchanged
});
```

- [ ] **Step 4: Check the three build modes,** and that the build has no inline script and a same-origin worker:

```bash
pnpm --filter @family-tree/web build 2>&1 | grep -c 'no _headers file'    # 1 (a warning)
test ! -e apps/web/dist/_headers && echo "no headers: ok"
VITE_API_BASE_URL=https://api.family.test:8443 VITE_PHOTO_ORIGIN=https://s3.family.test:8443 \
  WEB_HEADERS_CADDY=1 pnpm --filter @family-tree/web build
head -3 apps/web/dist/_headers && head -2 apps/web/dist/_headers.caddy
grep -c '<script>' apps/web/dist/index.html                                 # 0
ls apps/web/dist/assets | grep -iE 'worker|elk'                             # the worker chunk
CF_PAGES=1 pnpm --filter @family-tree/web build; echo "exit $?"             # non-zero, the message
```

  Expected:
  - `_headers` starts with `/*` and `  Content-Security-Policy: default-src 'none'; …`, and `_headers.caddy` starts with `header {`.
  - `index.html` has no inline `<script>`.
  - The ELK worker is a file under `assets/`.
  - The `CF_PAGES=1` build fails.

  **If the worker is inlined as a `blob:` or `data:` URL:** add `blob:` to `worker-src` and its test, and note why in the commit. The local smoke test in Task 15 confirms the CSP in a real browser.

- [ ] **Step 5: Run the web tests, typecheck and lint,** then commit:

```bash
git add apps/web/security-headers.ts apps/web/security-headers.test.ts apps/web/vite.config.ts apps/web/tsconfig.json
git commit -m "feat(web): strict CSP and security headers for Cloudflare Pages and the local stack"
```

---

## Task 10: The production compose file, Caddy, Postgres roles and `.env.production.example`

**Files:**
- Create: `compose.prod.yml`, `docker/caddy/Caddyfile`, `docker/caddy/api.caddy`, `docker/postgres/prod-init/10-app-role.sh`, `docker/postgres/prod-init/20-app-grants.sql`
- Modify: `.env.production.example`

- [ ] **Step 1: The Postgres roles.**

  Create `docker/postgres/prod-init/10-app-role.sh` and `chmod 0755` it:

```sh
#!/bin/sh
# First start only (docker-entrypoint-initdb.d): the login role the API uses (decision 12).
# POSTGRES_USER (family_owner) owns the database and runs migrations and backups.
set -eu
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE family_app LOGIN PASSWORD :'app_password';
SQL
```

  Create `docker/postgres/prod-init/20-app-grants.sql`:

```sql
-- Least privilege for the API (spec §8, decision 12). Idempotent: runs at the first start
-- (docker-entrypoint-initdb.d) and again after every restore (docker/backup/restore.sh).
REVOKE ALL ON DATABASE family FROM PUBLIC;
GRANT CONNECT ON DATABASE family TO family_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO family_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO family_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO family_app;
-- Tables the migrations create later (as family_owner) get the same rights automatically.
ALTER DEFAULT PRIVILEGES FOR ROLE family_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO family_app;
ALTER DEFAULT PRIVILEGES FOR ROLE family_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO family_app;
```

- [ ] **Step 2: Caddy.**

  Create `docker/caddy/api.caddy`:

```
# The API site, shared by Caddyfile (production) and Caddyfile.local. No `log` directive: Caddy
# keeps no access log, so client IPs and paths are never written (spec §8, decision 11).
request_body {
	max_size 12MB
}
header {
	-Server
	-Via
}
reverse_proxy api:3000
```

  Create `docker/caddy/Caddyfile`:

```
# Production (compose.prod.yml): Caddy terminates TLS for the API with a Let's Encrypt
# certificate. The web app is on Cloudflare Pages, not here (spec §2).
{
	email {$ACME_EMAIL}
}

{$API_DOMAIN} {
	import /etc/caddy/api.caddy
}
```

- [ ] **Step 3: Create `compose.prod.yml`:**

```yaml
# Production stack (spec §2, §10; decisions 10–12). Standalone, never combined with compose.yml.
#   docker compose --env-file .env.production -f compose.prod.yml up -d
# Every value comes from .env.production (never committed; see .env.production.example). Each
# service lists exactly the variables it gets, so the API never sees the owner password.
name: family-tree-prod

services:
  postgres:
    image: postgres:17.11-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: family_owner
      POSTGRES_DB: family
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env.production}
      APP_DB_PASSWORD: ${APP_DB_PASSWORD:?set APP_DB_PASSWORD in .env.production}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/postgres/prod-init:/docker-entrypoint-initdb.d:ro
    networks: [db]
    shm_size: 128mb
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U family_owner -d family']
      interval: 5s
      timeout: 3s
      retries: 30

  # One-shot: migrations as the owner role, before the API starts (spec §10, decision 12).
  migrate:
    image: ${API_IMAGE:-family-tree-api:local}
    build: { context: ., dockerfile: apps/api/Dockerfile }
    command: ['node', 'dist/db/migrate-cli.js']
    restart: 'no'
    environment:
      MIGRATION_DATABASE_URL: postgres://family_owner:${POSTGRES_PASSWORD}@postgres:5432/family
    networks: [db]
    depends_on:
      postgres: { condition: service_healthy }

  api:
    image: ${API_IMAGE:-family-tree-api:local}
    build: { context: ., dockerfile: apps/api/Dockerfile }
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: '3000'
      LOG_LEVEL: ${LOG_LEVEL:-info}
      DATABASE_URL: postgres://family_app:${APP_DB_PASSWORD}@postgres:5432/family
      MIGRATE_ON_START: 'false'
      WEB_ORIGIN: ${WEB_ORIGIN:?set WEB_ORIGIN}
      AUTH_BASE_URL: ${AUTH_BASE_URL:?set AUTH_BASE_URL}
      # Caddy is the single trusted hop (Phase 1 carry-forward).
      TRUST_PROXY: '1'
      SESSION_SECRET: ${SESSION_SECRET:?set SESSION_SECRET}
      S3_ENDPOINT: ${S3_ENDPOINT:?set S3_ENDPOINT}
      S3_PUBLIC_ENDPOINT: ${S3_PUBLIC_ENDPOINT:?set S3_PUBLIC_ENDPOINT}
      S3_REGION: ${S3_REGION:-auto}
      S3_BUCKET: ${S3_BUCKET:?set S3_BUCKET}
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID:?set S3_ACCESS_KEY_ID}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY:?set S3_SECRET_ACCESS_KEY}
      S3_FORCE_PATH_STYLE: ${S3_FORCE_PATH_STYLE:-false}
      S3_CREATE_BUCKET: 'false'
      MAX_TREES_PER_USER: ${MAX_TREES_PER_USER:-3}
      MAX_PHOTO_BYTES_PER_TREE: ${MAX_PHOTO_BYTES_PER_TREE:-1073741824}
      TREE_PURGE_INTERVAL_MINUTES: ${TREE_PURGE_INTERVAL_MINUTES:-60}
    networks: [db, edge]
    depends_on:
      migrate: { condition: service_completed_successfully }
    read_only: true
    tmpfs: [/tmp]
    cap_drop: [ALL]
    security_opt: ['no-new-privileges:true']
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "fetch('http://127.0.0.1:3000/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s

  caddy:
    image: caddy:2.11.6-alpine
    restart: unless-stopped
    environment:
      API_DOMAIN: ${API_DOMAIN:?set API_DOMAIN}
      ACME_EMAIL: ${ACME_EMAIL:?set ACME_EMAIL}
    ports: ['80:80', '443:443', '443:443/udp']
    volumes:
      - ./docker/caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - ./docker/caddy/api.caddy:/etc/caddy/api.caddy:ro
      - caddy_data:/data
      - caddy_config:/config
    networks: [edge]

  # Nightly backup and restores (decision 14). Not started by `up`; run it:
  #   docker compose --env-file .env.production -f compose.prod.yml run --rm backup
  #   … run --rm -v /path/to/age-identity.txt:/run/age/identity.txt:ro backup restore.sh latest
  backup:
    image: family-tree-backup:local
    build: { context: ., dockerfile: docker/backup/Dockerfile }
    profiles: [tools]
    environment:
      PGHOST: postgres
      PGUSER: family_owner
      PGDATABASE: family
      PGPASSWORD: ${POSTGRES_PASSWORD}
      AGE_RECIPIENT: ${AGE_RECIPIENT:-}
      BACKUP_ROOT: ${BACKUP_ROOT:-backup:family-backups}
      BACKUP_KEEP: ${BACKUP_KEEP:-14}
      S3_BUCKET: ${S3_BUCKET}
      RCLONE_S3_NO_CHECK_BUCKET: 'true'
      RCLONE_CONFIG_PHOTOS_TYPE: s3
      RCLONE_CONFIG_PHOTOS_PROVIDER: ${RCLONE_S3_PROVIDER:-Cloudflare}
      RCLONE_CONFIG_PHOTOS_ENDPOINT: ${S3_ENDPOINT}
      RCLONE_CONFIG_PHOTOS_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID}
      RCLONE_CONFIG_PHOTOS_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY}
      RCLONE_CONFIG_BACKUP_TYPE: s3
      RCLONE_CONFIG_BACKUP_PROVIDER: ${RCLONE_S3_PROVIDER:-Cloudflare}
      RCLONE_CONFIG_BACKUP_ENDPOINT: ${BACKUP_S3_ENDPOINT:-}
      RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID: ${BACKUP_S3_ACCESS_KEY_ID:-}
      RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY: ${BACKUP_S3_SECRET_ACCESS_KEY:-}
    volumes:
      - ./docker/postgres/prod-init:/grants:ro
    networks: [db, edge]
    depends_on:
      postgres: { condition: service_healthy }

networks:
  # Postgres has no published port and no route out (spec §8).
  db: { internal: true }
  edge: {}

volumes:
  pgdata:
  caddy_data:
  caddy_config:
```

- [ ] **Step 4: Rewrite `.env.production.example`:**

```
# Settings for compose.prod.yml (docs/self-hosting.md). Copy to .env.production on the server,
# fill in every empty value, chmod 600 it, and never commit it.
#   docker compose --env-file .env.production -f compose.prod.yml up -d
# Generate secrets with: openssl rand -hex 32   (hex is safe inside database URLs)

# --- Image and the public API address ----------------------------------------------------------
# Built by the manual "Release API image" workflow, e.g. ghcr.io/<owner>/family-tree-api:<tag>.
# family-tree-api:local builds from this checkout instead.
API_IMAGE=family-tree-api:local
API_DOMAIN=api.family.cortextechservices.com
# Let's Encrypt account email (expiry notices only).
ACME_EMAIL=

# --- Database (Postgres in this compose project; never published) ------------------------------
# Owner role: migrations and backups only.
POSTGRES_PASSWORD=
# App role: what the API connects as (no DDL rights).
APP_DB_PASSWORD=

# --- API ---------------------------------------------------------------------------------------
LOG_LEVEL=info
WEB_ORIGIN=https://family.cortextechservices.com
AUTH_BASE_URL=https://api.family.cortextechservices.com
SESSION_SECRET=

# --- Photos: a private Cloudflare R2 bucket ----------------------------------------------------
# https://<account-id>.r2.cloudflarestorage.com, for both: signed URLs only work there.
S3_ENDPOINT=
S3_PUBLIC_ENDPOINT=
S3_REGION=auto
S3_BUCKET=family-photos
# An R2 API token with Object Read & Write on this bucket only.
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=false

# --- Limits (defaults shown) -------------------------------------------------------------------
# MAX_TREES_PER_USER=3
# MAX_PHOTO_BYTES_PER_TREE=1073741824
# TREE_PURGE_INTERVAL_MINUTES=60

# --- Backups (docker/backup; docs/self-hosting.md "Backups") -----------------------------------
# age public key (age1…). The private key stays offline, never on this server.
AGE_RECIPIENT=
# A second private bucket, with its own token scoped to it.
BACKUP_S3_ENDPOINT=
BACKUP_S3_ACCESS_KEY_ID=
BACKUP_S3_SECRET_ACCESS_KEY=
BACKUP_ROOT=backup:family-backups
# BACKUP_KEEP=14

# --- The web app reads none of this: set these as Cloudflare Pages *build* variables ----------
# VITE_API_BASE_URL=https://api.family.cortextechservices.com
# VITE_PHOTO_ORIGIN=https://<account-id>.r2.cloudflarestorage.com
```

- [ ] **Step 5: Validate the files without starting anything.**

```bash
# Compose: a throwaway env with dummy values, outside the repo.
sed -e 's/^\(POSTGRES_PASSWORD\|APP_DB_PASSWORD\|SESSION_SECRET\)=$/\1=0123456789abcdef0123456789abcdef/' \
    -e 's/^ACME_EMAIL=$/ACME_EMAIL=a@example.com/' \
    -e 's#^\(S3_ENDPOINT\|S3_PUBLIC_ENDPOINT\)=$#\1=https://acc.r2.cloudflarestorage.com#' \
    -e 's/^\(S3_ACCESS_KEY_ID\|S3_SECRET_ACCESS_KEY\)=$/\1=x/' \
    .env.production.example > <scratchpad>/prod.env
docker compose --env-file <scratchpad>/prod.env -f compose.prod.yml config --quiet && echo "compose ok"
docker compose --env-file <scratchpad>/prod.env -f compose.prod.yml config | grep -A3 'ports:'
docker compose --env-file <scratchpad>/prod.env -f compose.prod.yml config api | grep -c POSTGRES_PASSWORD   # 0
# Caddy (no certificates are requested by validate).
docker run --rm -v "$PWD/docker/caddy:/etc/caddy:ro" -e API_DOMAIN=api.example.com -e ACME_EMAIL=a@example.com \
  caddy:2.11.6-alpine caddy validate --config /etc/caddy/Caddyfile
# Shell.
docker run --rm -v "$PWD:/mnt:ro" koalaman/shellcheck:v0.10.0 /mnt/docker/postgres/prod-init/10-app-role.sh
rm <scratchpad>/prod.env
```

  Expected:
  - `compose ok`.
  - The only `ports:` are Caddy's 80, 443 and 443/udp.
  - `0`: the API's environment has no owner password.
  - `Valid configuration`.
  - shellcheck prints nothing.

  The real run is in Task 11.

- [ ] **Step 6: Commit**

```bash
git add compose.prod.yml docker/caddy/Caddyfile docker/caddy/api.caddy \
  docker/postgres/prod-init/10-app-role.sh docker/postgres/prod-init/20-app-grants.sql .env.production.example
git commit -m "feat(deploy): production compose with Caddy, a migrate step and a least-privilege app role"
```

---
## Task 11: The production stack on localhost

**Files:**
- Create: `compose.prod.local.yml`, `docker/caddy/Caddyfile.local`, `scripts/prod-local.sh`

- [ ] **Step 1: Create `docker/caddy/Caddyfile.local`:**

```
# Local test of the production stack only (compose.prod.local.yml, decision 16). Certificates come
# from Caddy's own local CA; nothing is requested from Let's Encrypt. Inside Docker the same names
# and ports work, because Caddy has the names as network aliases and listens on 8080/8443.
{
	local_certs
	skip_install_trust
	http_port 8080
	https_port 8443
}

api.family.test {
	import /etc/caddy/api.caddy
}

# Stands in for Cloudflare Pages: the built web app, with the headers it would get there.
family.test {
	root * /srv/web
	import /srv/web/_headers.caddy
	try_files {path} /index.html
	file_server
}

# Stands in for R2: SeaweedFS behind TLS, so the API's production config (https, not local) holds.
s3.family.test {
	request_body {
		max_size 12MB
	}
	reverse_proxy s3:8333
}
```

- [ ] **Step 2: Create `compose.prod.local.yml`:**

```yaml
# Local-only overrides for testing compose.prod.yml on this machine (decision 16). Never use on a
# server. Use it through scripts/prod-local.sh, which writes the secrets into .prod-local/.
services:
  # Stands in for R2.
  s3:
    image: chrislusf/seaweedfs:4.00
    command: server -s3 -s3.config=/etc/seaweedfs/s3.json -dir=/data -volume.max=100 -master.volumeSizeLimitMB=64
    volumes:
      - s3data:/data
      - ./.prod-local/s3.json:/etc/seaweedfs/s3.json:ro
    networks: [edge]
    healthcheck:
      test: ['CMD-SHELL', 'nc -z 127.0.0.1 8333']
      interval: 5s
      timeout: 3s
      retries: 30
      start_period: 10s

  caddy:
    # Loopback only, and Caddy's local CA (docker/caddy/Caddyfile.local).
    ports: !override ['127.0.0.1:8080:8080', '127.0.0.1:8443:8443']
    volumes:
      - ./docker/caddy/Caddyfile.local:/etc/caddy/Caddyfile:ro
      - ./apps/web/dist:/srv/web:ro
    networks:
      edge:
        aliases: [family.test, api.family.test, s3.family.test]
    depends_on:
      s3: { condition: service_healthy }
    healthcheck:
      test: ['CMD', 'test', '-f', '/data/caddy/pki/authorities/local/root.crt']
      interval: 2s
      timeout: 2s
      retries: 60

  api:
    environment:
      # Trust Caddy's local CA for https://s3.family.test:8443 (the stand-in for R2).
      NODE_EXTRA_CA_CERTS: /caddy-data/caddy/pki/authorities/local/root.crt
    volumes:
      - caddy_data:/caddy-data:ro
    depends_on:
      caddy: { condition: service_healthy }

volumes:
  s3data:
```

- [ ] **Step 3: Create `scripts/prod-local.sh`** and `chmod 0755` it:

```bash
#!/usr/bin/env bash
# The production stack (compose.prod.yml) on this machine only, for testing (decision 16):
# Caddy's local CA instead of Let's Encrypt, SeaweedFS behind TLS instead of R2, and Caddy serving
# the web build instead of Cloudflare Pages. Ports bind 127.0.0.1 only; nothing leaves the machine.
#   scripts/prod-local.sh up             build the web app and the images, start, check health
#   scripts/prod-local.sh down           stop (keeps data)
#   scripts/prod-local.sh reset          stop and delete the stack's volumes (keeps .prod-local/)
#   scripts/prod-local.sh compose ARGS   any docker compose command against this stack
#   scripts/prod-local.sh backup-test    back up, wipe, restore and verify (docker/backup)
set -euo pipefail
cd "$(dirname "$0")/.."

DIR=.prod-local
PROJECT=family-tree-prod-local
WEB=https://family.test:8443
API=https://api.family.test:8443
S3=https://s3.family.test:8443
export LOCAL_UID LOCAL_GID
LOCAL_UID="$(id -u)"
LOCAL_GID="$(id -g)"
COMPOSE=(docker compose --env-file "$DIR/env" -p "$PROJECT" -f compose.prod.yml -f compose.prod.local.yml)
CURL=(curl -fsS --cacert "$DIR/caddy-root.crt"
  --resolve family.test:8443:127.0.0.1 --resolve api.family.test:8443:127.0.0.1
  --resolve s3.family.test:8443:127.0.0.1)

hex() { openssl rand -hex "${1:-32}"; }

init() {
  [ -f "$DIR/env" ] && return 0
  mkdir -p "$DIR"
  chmod 700 "$DIR"
  local key secret
  key="local$(hex 8)"
  secret="$(hex)"
  cat > "$DIR/s3.json" <<JSON
{
  "identities": [
    {
      "name": "local",
      "credentials": [{ "accessKey": "$key", "secretKey": "$secret" }],
      "actions": ["Admin", "Read", "Write", "List", "Tagging"]
    }
  ]
}
JSON
  cat > "$DIR/env" <<ENV
# Generated by scripts/prod-local.sh for the local production test only. Never use it elsewhere.
API_IMAGE=family-tree-api:local
API_DOMAIN=api.family.test
ACME_EMAIL=local@family.test
POSTGRES_PASSWORD=$(hex)
APP_DB_PASSWORD=$(hex)
LOG_LEVEL=info
WEB_ORIGIN=$WEB
AUTH_BASE_URL=$API
SESSION_SECRET=$(hex)
S3_ENDPOINT=$S3
S3_PUBLIC_ENDPOINT=$S3
S3_REGION=us-east-1
S3_BUCKET=family-photos
S3_ACCESS_KEY_ID=$key
S3_SECRET_ACCESS_KEY=$secret
S3_FORCE_PATH_STYLE=true
AGE_RECIPIENT=
BACKUP_ROOT=backup:/backups
RCLONE_S3_PROVIDER=Other
ENV
  chmod 600 "$DIR/env" "$DIR/s3.json"
  echo "Created $DIR/ with fresh secrets for this local test stack"
}

wait_for() { # wait_for <what> <command…>: up to 3 minutes
  local what=$1
  shift
  for _ in $(seq 1 90); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "Timed out waiting for $what" >&2
  return 1
}

build_web() {
  echo "Building the web app for $WEB"
  VITE_API_BASE_URL="$API" VITE_PHOTO_ORIGIN="$S3" WEB_HEADERS_CADDY=1 \
    pnpm --filter @family-tree/web build
}

buckets() {
  wait_for "SeaweedFS" "${COMPOSE[@]}" exec -T s3 nc -z 127.0.0.1 8333
  # An existing bucket is fine: weed shell reports it and carries on.
  echo "s3.bucket.create -name family-photos" \
    | "${COMPOSE[@]}" exec -T s3 weed shell -master=localhost:9333 >/dev/null || true
}

edge_up() { # postgres, the stand-in for R2, and Caddy with its CA
  "${COMPOSE[@]}" up -d postgres s3 caddy
  buckets
  wait_for "Caddy's local CA" "${COMPOSE[@]}" exec -T caddy test -f /data/caddy/pki/authorities/local/root.crt
  "${COMPOSE[@]}" cp caddy:/data/caddy/pki/authorities/local/root.crt "$DIR/caddy-root.crt" >/dev/null
  wait_for "Postgres" "${COMPOSE[@]}" exec -T postgres pg_isready -U family_owner -d family
}

start() {
  [ -f apps/web/dist/_headers.caddy ] || build_web
  edge_up
  "${COMPOSE[@]}" up -d --build
  wait_for "the API over TLS" "${CURL[@]}" "$API/api/v1/health"
}

up() {
  init
  build_web
  start
  "${CURL[@]}" "$API/api/v1/health"
  echo
  echo "Up: $WEB (API $API). To use a browser, see docs/self-hosting.md, \"Try it locally first\"."
}

case "${1:-}" in
  up) up ;;
  down) "${COMPOSE[@]}" down ;;
  reset) "${COMPOSE[@]}" down -v ;;
  compose)
    shift
    "${COMPOSE[@]}" "$@"
    ;;
  *)
    sed -n '2,9p' "$0"
    exit 2
    ;;
esac
```

  Lint it: `docker run --rm -v "$PWD:/mnt:ro" koalaman/shellcheck:v0.10.0 /mnt/scripts/prod-local.sh` prints nothing.

- [ ] **Step 4: Start it.** Run `scripts/prod-local.sh up`. It takes a few minutes the first time: it builds the web app, the API image and the containers.

  Expected: the last lines are `{"status":"ok","checks":{"db":"ok","storage":"ok"}}` and `Up: https://family.test:8443 …`.
  - If `migrate` fails, read `scripts/prod-local.sh compose logs migrate`.
  - If the API exits, read `compose logs api`: a config error names the variable.
  - If storage is `error`, the bucket or the CA trust is wrong. Check `compose exec -T api node -e "fetch('https://s3.family.test:8443').then(r=>console.log(r.status))"`.

- [ ] **Step 5: Verify the stack.** Use `C=(curl -sS --cacert .prod-local/caddy-root.crt --resolve family.test:8443:127.0.0.1 --resolve api.family.test:8443:127.0.0.1)` and `P="scripts/prod-local.sh compose"`. Record each result.

  1. **Services.**
     - Run `$P ps -a --format '{{.Service}} {{.State}} {{.Health}}'`. Postgres, s3, caddy and api are `running healthy`, and migrate is `exited`.
     - Run `$P logs migrate`. It shows `Migrations are up to date.`
  2. **Only Caddy is published, and only on loopback.**
     - Run `docker ps --filter label=com.docker.compose.project=family-tree-prod-local --format '{{.Names}} {{.Ports}}'`.
     - Caddy shows `127.0.0.1:8080->8080/tcp, 127.0.0.1:8443->8443/tcp`. Postgres and the API show no host ports.
  3. **API headers through TLS.**
     - Run `"${C[@]}" -D - -o /dev/null https://api.family.test:8443/api/v1/health | tr -d '\r'`.
     - The output includes `strict-transport-security` and `x-content-type-options: nosniff` (helmet), and no `server:` or `via:` line.
  4. **Web headers and the SPA fallback.**
     - Run `"${C[@]}" -D - -o /dev/null https://family.test:8443/trees/anything | tr -d '\r'`. It returns 200 `text/html`, and `content-security-policy` contains `connect-src 'self' https://api.family.test:8443` and `img-src 'self' data: blob: https://s3.family.test:8443`. It also has `x-frame-options: DENY`.
     - An `/assets/<file>.js` (name from `ls apps/web/dist/assets`) has `cache-control: public, max-age=31536000, immutable`.
  5. **HTTP redirects to HTTPS.**
     - Run `curl -sI --resolve api.family.test:8080:127.0.0.1 http://api.family.test:8080/api/v1/health`. It returns 308 with `location: https://api.family.test:8443/api/v1/health`.
     - If Caddy leaves out the `:8443`, note it: production uses 443.
  6. **Least privilege.** Each command must fail exactly as shown, except the first, which works.
     - `$P exec -T postgres psql -U family_app -d family -Atc 'select count(*) from persons'` prints a number.
     - `$P exec -T postgres psql -U family_app -d family -c 'create table x (i int)'` fails with `permission denied for schema public`.
     - `$P exec -T postgres psql -U family_app -d family -c 'select * from drizzle.__drizzle_migrations'` fails with `permission denied for schema drizzle`.
     - `$P exec -T postgres psql -U family_app -d family -c 'create extension if not exists pgcrypto'` fails with `permission denied to create extension` or `for database family`.
  7. **API container hardening.**
     - `$P exec -T api sh -c 'touch /app/x'` fails with `Read-only file system`.
     - `$P exec -T api env | grep -c POSTGRES` prints `0`.
  8. **Production config refusals.** Each command exits 1 with the quoted message:
     - `$P run --rm --no-deps -e AUTH_RATE_LIMIT_ENABLED=false api` fails with `AUTH_RATE_LIMIT_ENABLED: Must be true in production`.
     - `$P run --rm --no-deps -e SESSION_SECRET=dev-only-session-secret-change-me-0000000000 api` fails with `Development or placeholder value not allowed in production`.
     - `$P run --rm --no-deps -e S3_ENDPOINT=http://localhost:8333 api` fails with `Must use https in production`.

  Leave the stack up for Task 12, or run `scripts/prod-local.sh down`.

- [ ] **Step 6: Commit**

```bash
git add compose.prod.local.yml docker/caddy/Caddyfile.local scripts/prod-local.sh
git commit -m "feat(deploy): run the production stack on localhost with Caddy's local CA"
```

---

## Task 12: Backups — the image, backup and restore scripts, timers, and a real restore test

**Files:**
- Create: `docker/backup/Dockerfile`, `docker/backup/backup.sh`, `docker/backup/restore.sh`, `docker/backup/systemd/family-tree-backup.service`, `docker/backup/systemd/family-tree-backup.timer`, `scripts/restore-check.mjs`
- Modify: `compose.prod.local.yml`, `scripts/prod-local.sh`

- [ ] **Step 1: Create `docker/backup/Dockerfile`:**

```dockerfile
# Backups and restores (spec §8, decision 14): pg_dump/pg_restore 17, age and rclone (Go, no AVX2).
FROM postgres:17.11-alpine
RUN apk add --no-cache age rclone
COPY docker/backup/backup.sh docker/backup/restore.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/restore.sh
USER postgres
WORKDIR /tmp
ENTRYPOINT []
CMD ["backup.sh"]
```

- [ ] **Step 2: Create `docker/backup/backup.sh`:**

```sh
#!/bin/sh
# Nightly backup (spec §8, decision 14): an age-encrypted pg_dump, then a mirror of the photos.
# The host timer runs: docker compose --env-file .env.production -f compose.prod.yml run --rm backup
# A failed dump uploads nothing and never rotates out a good backup.
set -eu
: "${AGE_RECIPIENT:?AGE_RECIPIENT (the age public key) is required}"
: "${BACKUP_ROOT:?}" "${S3_BUCKET:?}"
keep="${BACKUP_KEEP:-14}"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
name="family-${ts}.dump.age"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "backup: dumping the database"
pg_dump --format=custom --no-owner --no-privileges --file="$tmp/db.dump"
pg_restore --list "$tmp/db.dump" >/dev/null
age --encrypt --recipient "$AGE_RECIPIENT" --output "$tmp/db.dump.age" "$tmp/db.dump"
rm -f "$tmp/db.dump"
rclone copyto "$tmp/db.dump.age" "${BACKUP_ROOT}/db/${name}"
local_size="$(wc -c < "$tmp/db.dump.age" | tr -d ' ')"
remote_size="$(rclone size --json "${BACKUP_ROOT}/db/${name}" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')"
if [ "$remote_size" != "$local_size" ]; then
  echo "backup: uploaded dump has ${remote_size:-no} bytes, expected ${local_size}" >&2
  exit 1
fi
echo "backup: stored db/${name} (${local_size} bytes)"

# Only after a good upload: keep the newest $keep dumps.
{ rclone lsf --files-only "${BACKUP_ROOT}/db/" 2>/dev/null || true; } \
  | grep -E '^family-[0-9]{8}T[0-9]{6}Z\.dump\.age$' | sort -r | awk -v keep="$keep" 'NR > keep' \
  | while read -r old; do
      rclone deletefile "${BACKUP_ROOT}/db/${old}"
      echo "backup: removed db/${old}"
    done

echo "backup: mirroring photos"
rclone sync "photos:${S3_BUCKET}" "${BACKUP_ROOT}/photos/current" \
  --backup-dir "${BACKUP_ROOT}/photos/deleted/${ts}"
{ rclone lsf --dirs-only "${BACKUP_ROOT}/photos/deleted/" 2>/dev/null || true; } \
  | sort -r | awk -v keep="$keep" 'NR > keep' \
  | while read -r old; do
      rclone purge "${BACKUP_ROOT}/photos/deleted/${old%/}"
      echo "backup: removed photos/deleted/${old%/}"
    done
echo "backup: done"
```

- [ ] **Step 3: Create `docker/backup/restore.sh`:**

```sh
#!/bin/sh
# Restore (decision 14): the database first, then the photos. Stop the API first, then:
#   docker compose --env-file .env.production -f compose.prod.yml run --rm \
#     -v /secure/age-identity.txt:/run/age/identity.txt:ro backup restore.sh latest
# and start the stack again with `up -d`. Replaces the whole database; copies photos back
# without deleting any (the orphan sweep removes leftovers after a day).
set -eu
: "${BACKUP_ROOT:?}" "${S3_BUCKET:?}" "${PGUSER:?}"
identity="${AGE_IDENTITY_FILE:-/run/age/identity.txt}"
want="${1:-}"
db="${PGDATABASE:-family}"
[ -n "$want" ] || { echo "usage: restore.sh <dump file name | latest>" >&2; exit 2; }
[ -r "$identity" ] || { echo "restore: no age identity at $identity (mount it read-only)" >&2; exit 2; }
if [ "$want" = latest ]; then
  want="$(rclone lsf --files-only "${BACKUP_ROOT}/db/" \
    | grep -E '^family-[0-9]{8}T[0-9]{6}Z\.dump\.age$' | sort -r | head -n 1)"
fi
[ -n "$want" ] || { echo "restore: no dumps under ${BACKUP_ROOT}/db/" >&2; exit 1; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "restore: fetching db/${want}"
rclone copyto "${BACKUP_ROOT}/db/${want}" "$tmp/db.dump.age"
age --decrypt --identity "$identity" --output "$tmp/db.dump" "$tmp/db.dump.age"
pg_restore --list "$tmp/db.dump" >/dev/null

echo "restore: recreating database ${db}"
psql -v ON_ERROR_STOP=1 -q -d postgres \
  -c "DROP DATABASE IF EXISTS \"${db}\" WITH (FORCE)" \
  -c "CREATE DATABASE \"${db}\" OWNER \"${PGUSER}\""
psql -v ON_ERROR_STOP=1 -q -d "$db" -f /grants/20-app-grants.sql
pg_restore --no-owner --no-privileges --exit-on-error --single-transaction -d "$db" "$tmp/db.dump"
psql -v ON_ERROR_STOP=1 -q -d "$db" -f /grants/20-app-grants.sql

echo "restore: copying photos back"
rclone copy "${BACKUP_ROOT}/photos/current" "photos:${S3_BUCKET}"
echo "restore: done (${want}). Start the stack again."
```

  `chmod 0755` both scripts, and lint them: `docker run --rm -v "$PWD:/mnt:ro" koalaman/shellcheck:v0.10.0 -s sh /mnt/docker/backup/backup.sh /mnt/docker/backup/restore.sh`. It prints nothing.

- [ ] **Step 4: The systemd units.**

  Create `docker/backup/systemd/family-tree-backup.service`:

```ini
# Nightly backup (docs/self-hosting.md "Backups"). Install on the server:
#   sudo cp docker/backup/systemd/family-tree-backup.* /etc/systemd/system/
#   sudo systemctl daemon-reload && sudo systemctl enable --now family-tree-backup.timer
[Unit]
Description=Family Tree backup (database dump and photo mirror)
Wants=network-online.target
After=docker.service network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/family-tree
ExecStart=/usr/bin/docker compose --env-file .env.production -f compose.prod.yml run --rm backup
```

  Create `docker/backup/systemd/family-tree-backup.timer`:

```ini
[Unit]
Description=Run the Family Tree backup every night

[Timer]
OnCalendar=*-*-* 03:15:00 UTC
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
```

  Check them with `systemd-analyze verify docker/backup/systemd/family-tree-backup.timer` if it's available. Ignore warnings about `/opt/family-tree` not existing on this machine.

- [ ] **Step 5: The local backup target.** Append to `compose.prod.local.yml` under `services:`:

```yaml
  backup:
    # Runs as the host user so it can write .prod-local/backups and read the local age key.
    user: '${LOCAL_UID:-1000}:${LOCAL_GID:-1000}'
    environment:
      RCLONE_CA_CERT: /caddy-data/caddy/pki/authorities/local/root.crt
      # A local folder instead of a second bucket; it survives `prod-local.sh reset`.
      RCLONE_CONFIG_BACKUP_TYPE: local
    volumes:
      - caddy_data:/caddy-data:ro
      - ./.prod-local/backups:/backups
      # Local test only. In production the private key is never on the server (decision 14).
      - ./.prod-local/age/identity.txt:/run/age/identity.txt:ro
```

- [ ] **Step 6: Create `scripts/restore-check.mjs`.** It runs inside the API container, so it uses the image's own Node, sharp and `@better-auth/utils`.

```js
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
    body: body === undefined ? undefined : type === 'application/json' ? JSON.stringify(body) : body,
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
  await call('POST', `/api/v1/trees/${tree.id}/persons/${detail.rootPersonId}/photos`, png, 'image/png');
  writeFileSync(STATE, JSON.stringify({ email, password, raw, treeId: tree.id, root: detail.rootPersonId }), {
    mode: 0o600,
  });
  console.log('seeded: an owner with 2FA, a tree and a photo');
} else if (mode === 'verify') {
  const s = JSON.parse(readFileSync(STATE, 'utf8'));
  const signIn = await call('POST', '/api/auth/sign-in/email', { email: s.email, password: s.password });
  if (signIn?.twoFactorRedirect) await call('POST', '/api/auth/two-factor/verify-totp', { code: await totp(s.raw) });
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
```

  Check the response shapes against the routes: `POST /trees` returns `{ tree }` (Phase 3), `GET /trees/:id` returns `TreeDetail` (`{ tree, me, capabilities }`), and the person view has `photos[].fullUrl` (Phase 6). If one differs, follow the route.

- [ ] **Step 7: Add the age key and `backup-test` to `scripts/prod-local.sh`.** Add these functions before the `case`:

```bash
age_key() { # a local age key pair; its public half goes into .prod-local/env
  if [ -s "$DIR/age/identity.txt" ]; then return 0; fi
  mkdir -p "$DIR/age" "$DIR/backups" "$DIR/state"
  chmod 700 "$DIR/age"
  "${COMPOSE[@]}" --profile tools build backup
  docker run --rm --entrypoint age-keygen family-tree-backup:local > "$DIR/age/identity.txt" 2>/dev/null
  chmod 600 "$DIR/age/identity.txt"
  local recipient
  recipient="$(sed -n 's/^# public key: //p' "$DIR/age/identity.txt")"
  sed -i "s/^AGE_RECIPIENT=.*/AGE_RECIPIENT=$recipient/" "$DIR/env"
}

counts() {
  "${COMPOSE[@]}" exec -T postgres psql -U family_owner -d family -Atc \
    "select (select count(*) from users) || ' users, ' || (select count(*) from persons) \
     || ' persons, ' || (select count(*) from photos) || ' photos'"
}

check() { # restore-check.mjs seed|verify inside the api container
  "${COMPOSE[@]}" run --rm --no-deps --user "$LOCAL_UID:$LOCAL_GID" \
    -v "$PWD/scripts/restore-check.mjs:/app/restore-check.mjs:ro" -v "$PWD/$DIR/state:/state" \
    api node restore-check.mjs "$1"
}

backup_test() {
  init
  age_key
  start
  check seed
  local before latest
  before="$(counts)"
  echo "Before: $before"
  "${COMPOSE[@]}" run --rm backup
  latest="$(find "$DIR/backups/db" -name 'family-*.dump.age' | sort | tail -n 1)"
  head -c 21 "$latest" | grep -q '^age-encryption.org/v1' || { echo "FAIL: dump is not age-encrypted" >&2; exit 1; }
  if grep -qa 'Restore test' "$latest"; then echo "FAIL: dump has plain text" >&2; exit 1; fi
  echo "Wiping the database and photo volumes"
  "${COMPOSE[@]}" down
  docker volume rm "${PROJECT}_pgdata" "${PROJECT}_s3data" >/dev/null
  edge_up
  "${COMPOSE[@]}" run --rm backup restore.sh latest
  "${COMPOSE[@]}" up -d
  wait_for "the API over TLS" "${CURL[@]}" "$API/api/v1/health"
  local after
  after="$(counts)"
  echo "After:  $after"
  [ "$after" = "$before" ] || { echo "FAIL: counts differ" >&2; exit 1; }
  check verify
  echo "Retention: three more backups with BACKUP_KEEP=2"
  for _ in 1 2 3; do "${COMPOSE[@]}" run --rm -e BACKUP_KEEP=2 backup >/dev/null; sleep 1; done
  [ "$(find "$DIR/backups/db" -name 'family-*.dump.age' | wc -l)" -eq 2 ] || { echo "FAIL: retention" >&2; exit 1; }
  echo "PASS: backup, wipe, restore and retention"
}
```

  Add `backup-test) backup_test ;;` to the `case`. Then re-run shellcheck on the script.

- [ ] **Step 8: Run the restore test.** Run `scripts/prod-local.sh backup-test`. It takes about 3–5 minutes.

  Expected, in this order:
  1. `seeded: …`
  2. `Before: N users, M persons, 1 photos`. The counts include the earlier runs' data.
  3. `backup: stored db/family-…dump.age (… bytes)`
  4. `backup: mirroring photos`, then `backup: done`
  5. `Wiping …`
  6. `restore: fetching …`, then `restore: done`
  7. `After:` with the same counts
  8. `verified: …`
  9. `PASS: backup, wipe, restore and retention`

  **Failure-path checks** (manual, then undo):
  - **No recipient:** `scripts/prod-local.sh compose run --rm -e AGE_RECIPIENT= backup` exits non-zero with `AGE_RECIPIENT … is required`, and `ls .prod-local/backups/db` gains nothing.
  - **Wrong password:** `… run --rm -e PGPASSWORD=wrong backup` fails at `pg_dump`, uploads nothing, and removes nothing.
  - **No key:** `… run --rm -v /dev/null:/run/age/identity.txt:ro backup restore.sh latest` fails at `age --decrypt` before touching the database. Then check: `scripts/prod-local.sh compose exec -T postgres psql -U family_owner -d family -Atc 'select count(*) from persons'` still works.

- [ ] **Step 9: Commit**

```bash
git add docker/backup compose.prod.local.yml scripts/prod-local.sh scripts/restore-check.mjs
git commit -m "feat(deploy): encrypted database backups, photo mirror, restore, and a tested restore"
```

---

## Task 13: E2E — configuration, global setup, helpers and the spec §9 journey

**Files:**
- Create: `e2e/playwright.config.ts`, `e2e/support/env.ts`, `e2e/support/totp.ts`, `e2e/support/api.ts`, `e2e/support/fixtures.ts`, `e2e/support/ui.ts`, `e2e/support/global-setup.ts`, `e2e/tests/journey.spec.ts`

**Before writing:** read the components this drives, so the locators match:
- `SignUpPage`, `NewTreePage`, `TwoFactorSetup`, `AccountPage`;
- `PersonCard` (card `aria-label`, and "+" buttons named `Add a <word> of <name>`);
- `AddRelativeForm` (`aria-label="Add <as>"`, with "Other parent" and "Which parents" selects);
- `InvitesSection` (the `Invite link` read-only input), `InvitePage`;
- `InfoTab` ("Edit details"), `DeletePerson` ("Delete…", "What to delete", "Move to Trash" → "Yes, move to Trash"), `TrashPage` ("Restore").
If a label differs from the code below, use the real one and keep the step.

- [ ] **Step 1: Write `e2e/support/env.ts`:**

```ts
/** Which stack the tests drive (decisions 15, 16). */
export const PROD_LOCAL = process.env.E2E_TARGET === 'prod-local';
export const WEB =
  process.env.E2E_BASE_URL ?? (PROD_LOCAL ? 'https://family.test:8443' : 'http://localhost:5173');
/** The API origin. In dev the Vite proxy serves it on the web origin. */
export const API =
  process.env.E2E_API_URL ?? (PROD_LOCAL ? 'https://api.family.test:8443' : WEB);
export const STATE = new URL('../.state/', import.meta.url).pathname;
export const statePath = (name: string) => `${STATE}${name}`;
export const REPO_ROOT = new URL('../../', import.meta.url).pathname;
```

- [ ] **Step 2: Write `e2e/support/totp.ts`, `api.ts` and `fixtures.ts`:**

```ts
// e2e/support/totp.ts
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';

/** The raw secret from the base32 text the app shows (or a totpURI's `secret`). */
export const rawSecret = (b32: string) => new TextDecoder().decode(base32.decode(b32));
export const totpCode = (raw: string) => createOTP(raw).totp();
```

```ts
// e2e/support/api.ts
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
```

```ts
// e2e/support/fixtures.ts
import { existsSync } from 'node:fs';
import sharp from 'sharp';
import { statePath } from './env';

/** Hidden in the test photo's EXIF; the stored photo must not contain it (spec §8). */
export const SECRET_MARKER = 'e2e-secret-marker';
export const GPS_JPEG = statePath('gps.jpg');

/** A JPEG with camera, copyright and GPS EXIF, written once into e2e/.state/. */
export async function writeFixtures() {
  if (existsSync(GPS_JPEG)) return;
  await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#7a5' } })
    .jpeg()
    .withExif({
      IFD0: { Copyright: SECRET_MARKER, Make: 'E2ECam' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '51/1 30/1 0/1',
        GPSLongitudeRef: 'W',
        GPSLongitude: '0/1 7/1 0/1',
      },
    })
    .toFile(GPS_JPEG);
}
```

- [ ] **Step 3: Write `e2e/support/ui.ts`:**

```ts
import { expect, type Page } from '@playwright/test';
import { type Account, newAccount } from './api';
import { rawSecret, totpCode } from './totp';

/** Signs up through the form (a fresh context, so no browser autofill is involved). */
export async function signUpViaUi(page: Page, name: string, path = '/sign-up'): Promise<Account> {
  const a = newAccount(name);
  await page.goto(path);
  await page.getByLabel('Name', { exact: true }).fill(a.name);
  await page.getByLabel('Email', { exact: true }).fill(a.email);
  await page.getByLabel('Password', { exact: true }).fill(a.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).not.toHaveURL(/\/sign-up/);
  return a;
}

/** Turns on two-step verification where the setup is shown (Start a new tree, or Account). */
export async function enrolTotpViaUi(page: Page, a: Account): Promise<string> {
  await page.getByRole('button', { name: 'Turn on two-step verification' }).click();
  await page.getByLabel('Your password').fill(a.password);
  await page.getByRole('button', { name: 'Continue' }).click();
  const secret = (await page.locator('code.secret').textContent())!.replace(/\s+/g, '');
  const raw = rawSecret(secret);
  await page.getByLabel('6-digit code from the app').fill(await totpCode(raw));
  await page.getByRole('button', { name: 'Turn on', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Recovery codes' })).toBeVisible();
  await page.getByRole('button', { name: "I've saved these codes" }).click();
  return raw;
}

/** Starts a tree (2FA first, spec §5) and returns its id once the tree page is open. */
export async function startTreeViaUi(page: Page, a: Account, me: { given: string; surname: string }) {
  await page.goto('/trees/new');
  await enrolTotpViaUi(page, a);
  await page.getByLabel('Your first name').fill(me.given);
  await page.getByLabel('Your last name').fill(me.surname);
  await page.getByRole('button', { name: 'Start tree' }).click();
  await expect(page).toHaveURL(/\/trees\/[0-9a-f-]{36}/);
  return page.url().match(/\/trees\/([0-9a-f-]{36})/)![1]!;
}

/** A person's card on the canvas: its button's accessible name starts with the full name. */
export const card = (page: Page, fullName: string) =>
  page.getByRole('button', { name: new RegExp(`^${fullName}\\b`) }).first();

/**
 * A relative through a card's "+" button and the quick-add form. `union` picks the "Other parent"
 * or "Which parents" option when the form asks.
 */
export async function addRelative(
  page: Page,
  of: string,
  word: 'parent' | 'partner' | 'sibling' | 'child',
  person: { given: string; surname: string },
  union?: RegExp,
) {
  await page.getByRole('button', { name: `Add a ${word} of ${of}` }).click();
  const form = page.getByRole('form', { name: `Add ${word}` });
  await form.getByLabel('First name').fill(person.given);
  await form.getByLabel('Last name').fill(person.surname);
  if (union) {
    const choice = form.getByLabel(/^(Other parent|Which parents)$/);
    const option = (await choice.locator('option').allTextContents()).find((t) => union.test(t));
    if (!option) throw new Error(`no union option matching ${union}`);
    await choice.selectOption({ label: option });
  }
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(card(page, `${person.given} ${person.surname}`)).toBeVisible();
}
```

  If the duplicate check ("Is this the existing person …?") appears, the names are too close to an existing person. Pick a different name; don't click through it.

- [ ] **Step 4: Write `e2e/support/global-setup.ts`.** It uses `execFileSync` (no shell) to run the seed in the dev api container.

```ts
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

async function waitForHealth() {
  const ctx = await apiContext();
  try {
    for (let i = 0; i < 60; i++) {
      const res = await ctx.get('/api/v1/health').catch(() => null);
      if (res?.ok()) return;
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`The API at ${API} isn't healthy. Start the stack first (README, "End-to-end tests").`);
  } finally {
    await ctx.dispose();
  }
}

/** Fresh accounts every run (decision 15): an owner of the seeded sample family, and a viewer. */
export default async function globalSetup() {
  mkdirSync(STATE, { recursive: true });
  await waitForHealth();
  await writeFixtures();
  if (PROD_LOCAL) return; // the smoke test signs up itself; production refuses seed data

  const ownerCtx = await apiContext();
  const owner = newAccount('E2E Owner');
  await signUp(ownerCtx, owner);
  const raw = await enableTwoFactor(ownerCtx, owner.password);
  // The sample family, owned by this user: their card is Leo (Phase 6 walkthrough).
  execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'api', 'pnpm', '--filter', '@family-tree/api', 'db:seed', owner.email],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
  const list = (await (await ok(await ownerCtx.get('/api/v1/trees'), 'trees')).json()) as {
    trees: { id: string; name: string }[];
  };
  const tree = list.trees.find((t) => t.name === 'Sample family (seed)');
  if (!tree) throw new Error('the seed did not create "Sample family (seed)"');
  const invite = (await (
    await ok(await ownerCtx.post(`/api/v1/trees/${tree.id}/invites`, { data: { role: 'viewer' } }), 'invite')
  ).json()) as { token: string };
  await ownerCtx.storageState({ path: statePath('owner.json') });

  const viewerCtx = await apiContext();
  const viewer = newAccount('E2E Viewer');
  await signUp(viewerCtx, viewer);
  await ok(await viewerCtx.post('/api/v1/invites/accept', { data: { token: invite.token } }), 'accept');
  await viewerCtx.storageState({ path: statePath('viewer.json') });

  const fixture: Fixture = { treeId: tree.id, owner: { ...owner, raw }, viewer };
  writeFileSync(statePath('fixture.json'), JSON.stringify(fixture), { mode: 0o600 });
  await ownerCtx.dispose();
  await viewerCtx.dispose();
}
```

- [ ] **Step 5: Write `e2e/playwright.config.ts`:**

```ts
import { defineConfig, devices } from '@playwright/test';
import { PROD_LOCAL, WEB } from './support/env';

export default defineConfig({
  testDir: './tests',
  // One worker, in file order: the tests share one stack, its rate limits and the seeded tree.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  globalSetup: './support/global-setup.ts',
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(PROD_LOCAL
      ? {
          // Caddy's local CA, and *.family.test → 127.0.0.1 without a hosts entry (decision 16).
          ignoreHTTPSErrors: true,
          launchOptions: {
            args: ['--host-resolver-rules=MAP family.test 127.0.0.1, MAP *.family.test 127.0.0.1'],
          },
        }
      : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

- [ ] **Step 6: Write the journey, `e2e/tests/journey.spec.ts`** (spec §9: sign up → create tree → add parents, a partner and children → create an invite → a second user joins as steward → the steward edits and deletes in their branch → the owner previews and restores from Trash):

```ts
import { expect, test } from '@playwright/test';
import { PROD_LOCAL } from '../support/env';
import { addRelative, card, enrolTotpViaUi, signUpViaUi, startTreeViaUi } from '../support/ui';

test.skip(PROD_LOCAL, 'dev stack only');

test('spec §9: family, steward invite, steward edits and deletes, owner restores', async ({
  browser,
}) => {
  // 1. Sign up and start a tree (2FA enrolment is part of it).
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  const olive = await signUpViaUi(owner, 'Olive Owner');
  const treeId = await startTreeViaUi(owner, olive, { given: 'Olive', surname: 'Owner' });
  await expect(card(owner, 'Olive Owner')).toBeVisible();

  // 2. Parents, a partner and two children, all from the card "+" buttons.
  await addRelative(owner, 'Olive Owner', 'parent', { given: 'Paul', surname: 'Owner' });
  await addRelative(owner, 'Olive Owner', 'parent', { given: 'Mary', surname: 'Owner' }, /Paul/);
  await addRelative(owner, 'Olive Owner', 'partner', { given: 'Pete', surname: 'Partner' });
  await addRelative(owner, 'Olive Owner', 'child', { given: 'Cleo', surname: 'Owner' }, /Pete/);
  await addRelative(owner, 'Olive Owner', 'child', { given: 'Dan', surname: 'Owner' }, /Pete/);

  // 3. An invite: viewer, steward of Pete. Pete's branch is Pete and his children; Olive has her
  //    own parents, so she and they are outside it (spec §4 rule 4).
  await owner.goto(`/trees/${treeId}/members`);
  await owner.getByRole('radio', { name: 'Viewer' }).check();
  await owner.getByLabel('Make them a steward of').selectOption({ label: 'Pete Partner' });
  await owner.getByRole('button', { name: 'Create invite link' }).click();
  const link = await owner.getByLabel('Invite link').inputValue();
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{20,}$/);

  // 4. A second user opens the link, signs up, joins and turns on 2FA (the grant needs it).
  const stewardCtx = await browser.newContext();
  const steward = await stewardCtx.newPage();
  await steward.goto(new URL(link).pathname);
  await steward.getByRole('link', { name: 'Create an account' }).click();
  const sam = await signUpViaUi(steward, 'Sam Steward', new URL(steward.url()).pathname + new URL(steward.url()).search);
  await steward.getByRole('button', { name: /^Join / }).click();
  await expect(steward).toHaveURL(new RegExp(`/trees/${treeId}`));
  await expect(steward.getByText(/Turn on two-step verification/)).toBeVisible();
  await steward.goto('/account');
  await enrolTotpViaUi(steward, sam);
  await steward.goto(`/trees/${treeId}`);
  await expect(steward.getByText(/You look after the branches of: Pete Partner/)).toBeVisible();

  // 5. The steward edits inside the branch, and can't edit outside it.
  await card(steward, 'Cleo Owner').click();
  await steward.getByRole('button', { name: 'Edit details' }).click();
  await steward.getByLabel('Occupation').fill('Architect');
  await steward.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(steward.getByText('Architect')).toBeVisible();
  await card(steward, 'Paul Owner').click();
  await expect(steward.getByRole('button', { name: 'Edit details' })).toHaveCount(0);

  // 6. The steward deletes Dan (in the branch) to Trash, after the preview.
  await card(steward, 'Dan Owner').click();
  await steward.getByRole('button', { name: 'Delete…' }).click();
  await steward.getByRole('radio', { name: /just this person/i }).check();
  await steward.getByRole('button', { name: 'Move to Trash' }).click();
  await steward.getByRole('button', { name: 'Yes, move to Trash' }).click();
  await expect(card(steward, 'Dan Owner')).toHaveCount(0);

  // 7. The owner sees the batch in Trash, restores it, and Dan is back.
  await owner.goto(`/trees/${treeId}/trash`);
  await expect(owner.getByText(/Dan Owner/)).toBeVisible();
  await owner.getByRole('button', { name: 'Restore' }).first().click();
  await owner.goto(`/trees/${treeId}`);
  await expect(card(owner, 'Dan Owner')).toBeVisible();
  await card(owner, 'Cleo Owner').click();
  await expect(owner.getByText('Architect')).toBeVisible();

  await ownerCtx.close();
  await stewardCtx.close();
});
```

  Notes:
  - The sign-up page after "Create an account" carries `?next=…`, so `signUpViaUi` is given that path to keep it.
  - "Preview" in spec §9 is the delete preview, which the steward's "Delete…" shows before "Move to Trash", and the Trash list that the owner sees before restoring. If the Trash page needs a batch opened before **Restore**, open it.

- [ ] **Step 7: Run it** against the dev stack with the auth rate limits off:

```bash
pnpm down && AUTH_RATE_LIMIT_ENABLED=false pnpm dev    # terminal 1; wait for "Server listening"
pnpm --filter @family-tree/e2e exec playwright test tests/journey.spec.ts   # terminal 2
```

  Expected: `1 passed`.
  - On a locator failure, open the trace (`pnpm --filter @family-tree/e2e exec playwright show-trace test-results/…/trace.zip`, or read the screenshot). Fix the locator from the component, not by loosening the assertion.
  - Run it 3 times in a row to check it isn't flaky. It must pass each time with fresh accounts.

- [ ] **Step 8: Typecheck and lint:** `pnpm typecheck && pnpm lint`. Then commit:

```bash
git add e2e/playwright.config.ts e2e/support e2e/tests/journey.spec.ts
git commit -m "test(e2e): Playwright setup and the spec §9 journey"
```

---
## Task 14: E2E — photos, search, relationships, canvas, export and the viewer

**Files:**
- Create: `e2e/support/fixture.ts`, `e2e/tests/canvas.spec.ts`, `e2e/tests/export.spec.ts`, `e2e/tests/photos-search.spec.ts`, `e2e/tests/viewer.spec.ts`

**Before writing:** read `PhotosTab`, `PhotoCropper`, `SearchBox`, `RelationshipPanel`, `CanvasToolbar` (the View group and "Full"), the panel/bottom-sheet markup in `TreeWorkspace`, and `highlight.ts` (`is-path`). These run on the seeded sample family:
- the owner's card is Leo;
- Emma is Leo's half-sister (through David);
- Margaret Hale (maiden name Ellis) is a grandmother;
- Robert Hale is deceased, born in Toronto.

They come from the Phase 6 walkthrough.

- [ ] **Step 1: Write `e2e/support/fixture.ts`:**

```ts
import { readFileSync } from 'node:fs';
import { statePath } from './env';
import type { Fixture } from './global-setup';

/** What the global setup created for this run (call inside a test, not at import time). */
export const fixture = (): Fixture => JSON.parse(readFileSync(statePath('fixture.json'), 'utf8'));
export const treeUrl = () => `/trees/${fixture().treeId}`;
```

- [ ] **Step 2: Write `e2e/tests/photos-search.spec.ts`:**

```ts
import { expect, test } from '@playwright/test';
import { PROD_LOCAL, statePath } from '../support/env';
import { GPS_JPEG, SECRET_MARKER } from '../support/fixtures';
import { treeUrl } from '../support/fixture';
import { card } from '../support/ui';

test.skip(PROD_LOCAL, 'dev stack only');
test.use({ storageState: statePath('owner.json') });

test('an uploaded photo is stored without EXIF and shows on the card', async ({ page }) => {
  await page.goto(treeUrl());
  await card(page, 'Robert Hale').click();
  await page.getByRole('tab', { name: 'Photos' }).click();
  await page.locator('input[type="file"]').setInputFiles(GPS_JPEG);
  await page.getByRole('button', { name: 'Use the whole photo' }).click();
  await expect(page.getByText('Photo added')).toBeVisible();

  const thumb = page.getByRole('tabpanel').locator('img').first();
  await expect(thumb).toBeVisible();
  const res = await page.request.get((await thumb.getAttribute('src'))!);
  expect(res.status()).toBe(200);
  const body = await res.body();
  expect(body.subarray(0, 4).toString('latin1')).toBe('RIFF');
  expect(body.subarray(8, 12).toString('latin1')).toBe('WEBP');
  for (const marker of [SECRET_MARKER, 'E2ECam', 'Exif']) {
    expect(body.includes(Buffer.from(marker)), marker).toBe(false);
  }
  const node = page.locator('.react-flow__node', { has: card(page, 'Robert Hale') });
  await expect(node.locator('img')).toBeVisible();
});

test('search tolerates a typo and says how each person is related to you', async ({ page }) => {
  await page.goto(treeUrl());
  await page.getByRole('searchbox').fill('Margret');
  const result = page.getByRole('button', { name: /Margaret Hale/ });
  await expect(result).toContainText('Your grandmother');
  await result.click();
  await expect(page.getByRole('heading', { name: /Margaret Hale/ })).toBeVisible();
  await page.getByRole('searchbox').fill('ellis'); // maiden name
  await expect(page.getByRole('button', { name: /Margaret Hale/ })).toBeVisible();
});

test('"How are we related?" words the path and highlights it', async ({ page }) => {
  await page.goto(treeUrl());
  await card(page, 'Emma Hale').click();
  await page.getByRole('link', { name: 'How are we related?' }).click();
  await expect(page.getByText('Emma Hale is your half-sister.')).toBeVisible();
  await page.getByRole('button', { name: 'Show on the tree' }).click();
  await expect.poll(() => page.locator('.is-path').count()).toBeGreaterThanOrEqual(3);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.is-path')).toHaveCount(0);
});
```

- [ ] **Step 3: Write `e2e/tests/canvas.spec.ts`:**

```ts
import { expect, test } from '@playwright/test';
import { PROD_LOCAL, statePath } from '../support/env';
import { treeUrl } from '../support/fixture';
import { card } from '../support/ui';

test.skip(PROD_LOCAL, 'dev stack only');
test.use({ storageState: statePath('owner.json') });

const top = async (page: import('@playwright/test').Page, name: string) =>
  (await card(page, name).boundingBox())!.y;

test('the layout runs in a worker and puts generations in rows', async ({ page }) => {
  const worker = page.waitForEvent('worker');
  await page.goto(treeUrl());
  expect((await worker).url()).toMatch(/worker|elk/i);
  await page.getByRole('group', { name: 'View' }).getByText('Full', { exact: true }).click();
  await expect(card(page, 'Margaret Hale')).toBeVisible();
  const [grandmother, father, mother, me] = await Promise.all(
    ['Margaret Hale', 'David Hale', 'Susan Hale', 'Leo Hale'].map((n) => top(page, n)),
  );
  expect(grandmother).toBeLessThan(father);
  expect(father).toBeLessThan(me);
  expect(Math.abs(father - mother)).toBeLessThan(5); // partners share a row
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the person panel is a bottom sheet and nothing scrolls sideways', async ({ page }) => {
    await page.goto(treeUrl());
    await card(page, 'Leo Hale').click();
    const heading = page.getByRole('heading', { name: /^Leo Hale/ });
    await expect(heading).toBeVisible();
    expect((await heading.boundingBox())!.y).toBeGreaterThan(844 / 3);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
```

  If the seed has a different surname for Susan, use the name from `apps/api/src/db/seed.ts`. If the toolbar's Full control is a radio or a toggle button, match its role.

- [ ] **Step 4: Write `e2e/tests/export.spec.ts`.** It reuses the API's test reader, `apps/api/test/zip-reader.ts`, which imports only `node:zlib`.

```ts
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { readZip } from '../../apps/api/test/zip-reader';
import { PROD_LOCAL, statePath } from '../support/env';
import { treeUrl } from '../support/fixture';

test.skip(PROD_LOCAL, 'dev stack only');
test.use({ storageState: statePath('owner.json') });

test('the owner downloads one ZIP with GEDCOM 5.5.1, JSON and photos', async ({ page }) => {
  await page.goto(treeUrl());
  const section = page.getByRole('region', { name: 'Export' });
  const download = page.waitForEvent('download');
  await section.getByRole('button', { name: 'Download export' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^family-tree-\d{4}-\d{2}-\d{2}\.zip$/);
  const entries = readZip(readFileSync((await file.path())!));
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  expect([...byName.keys()]).toEqual(expect.arrayContaining(['tree.ged', 'tree.json']));
  for (const name of byName.keys()) expect(name).toMatch(/^(tree\.(ged|json)|photos\/I\d+-\d+\.webp)$/);

  const ged = byName.get('tree.ged')!.toString('utf8');
  expect(ged.startsWith('﻿0 HEAD\r\n')).toBe(true);
  expect(ged).toContain('\r\n2 VERS 5.5.1\r\n');
  expect(ged).toContain('\r\n1 CHAR UTF-8\r\n');
  expect(ged).toContain('\r\n2 SURN Ellis\r\n2 TYPE maiden\r\n');
  expect(ged.endsWith('\r\n0 TRLR\r\n')).toBe(true);

  const json = JSON.parse(byName.get('tree.json')!.toString('utf8'));
  expect(json).toMatchObject({ format: 'family-tree-export', version: 1 });
  expect(json.persons.length).toBeGreaterThanOrEqual(10);
  await expect(section.getByText('Your export has downloaded.')).toBeVisible();
});
```

  Check the `2 SURN Ellis` / `2 TYPE maiden` line pair against the seed's Margaret. If her maiden name is stored in another field, assert her `NAME` line instead.

- [ ] **Step 5: Write `e2e/tests/viewer.spec.ts`:**

```ts
import { expect, test } from '@playwright/test';
import { PROD_LOCAL, statePath, WEB } from '../support/env';
import { treeUrl } from '../support/fixture';
import { card } from '../support/ui';

test.skip(PROD_LOCAL, 'dev stack only');
test.use({ storageState: statePath('viewer.json') });

test('a viewer can look and search, but not change or export (UI and API)', async ({ page }) => {
  await page.goto(treeUrl());
  await expect(page.getByText('You are a viewer of this tree.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tree settings' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Export' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Add a (parent|partner|sibling|child) of / })).toHaveCount(0);
  await card(page, 'Robert Hale').click();
  await expect(page.getByRole('button', { name: 'Edit details' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Photos' }).click();
  await expect(page.getByRole('button', { name: 'Add a photo' })).toHaveCount(0);
  await page.getByRole('searchbox').fill('Margret');
  await expect(page.getByRole('button', { name: /Margaret Hale/ })).toBeVisible();
  // Nothing relies on hidden buttons (spec §4): the API refuses too.
  const res = await page.request.get(`/api/v1${treeUrl()}/export`, {
    headers: { origin: WEB },
  });
  expect(res.status()).toBe(403);
});
```

- [ ] **Step 6: Run the whole suite** against `AUTH_RATE_LIMIT_ENABLED=false pnpm dev`: `pnpm test:e2e`.
  - Expected: 8 passed (the journey, 3 photo/search/relationship tests, 2 canvas tests, export and viewer) and 1 skipped (the smoke test).
  - Run it twice more. It passes each time, because global setup makes fresh accounts.

- [ ] **Step 7: Typecheck, lint and commit:**

```bash
pnpm typecheck && pnpm lint
git add e2e/support/fixture.ts e2e/tests
git commit -m "test(e2e): photos, search, relationships, canvas, export and viewer"
```

---

## Task 15: E2E against the local production stack; the CI job; the manual release workflow

**Files:**
- Create: `e2e/support/csp.ts`, `e2e/tests/smoke.spec.ts`, `.github/workflows/release-api.yml`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write `e2e/support/csp.ts`:**

```ts
import type { Page } from '@playwright/test';

/** Collects CSP violations: `securitypolicyviolation` events and console reports. */
export async function watchCsp(page: Page) {
  const logged: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) logged.push(m.text());
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  return {
    async violations(): Promise<string[]> {
      const seen = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
      return [...logged, ...seen];
    },
  };
}
```

- [ ] **Step 2: Write `e2e/tests/smoke.spec.ts`:**

```ts
import { expect, test } from '@playwright/test';
import { watchCsp } from '../support/csp';
import { API, PROD_LOCAL } from '../support/env';
import { GPS_JPEG } from '../support/fixtures';
import { card, signUpViaUi, startTreeViaUi } from '../support/ui';

test.skip(!PROD_LOCAL, 'runs against the local production stack: pnpm test:e2e:prod-local');

test('@smoke the production stack: TLS, CSP, 2FA sign-up, a photo, export', async ({ page }) => {
  const csp = await watchCsp(page);
  const first = await page.goto('/');
  const headers = first!.headers();
  expect(headers['content-security-policy']).toContain(`connect-src 'self' ${API}`);
  expect(headers['x-frame-options']).toBe('DENY');

  const me = await signUpViaUi(page, 'Smoke Owner');
  await startTreeViaUi(page, me, { given: 'Sam', surname: 'Smoke' });
  await card(page, 'Sam Smoke').click();
  await page.getByRole('tab', { name: 'Photos' }).click();
  await page.locator('input[type="file"]').setInputFiles(GPS_JPEG);
  await page.getByRole('button', { name: 'Use the whole photo' }).click();
  await expect(page.getByText('Photo added')).toBeVisible();
  const img = page.getByRole('tabpanel').locator('img').first();
  await expect(img).toBeVisible();
  expect(await img.getAttribute('src')).toMatch(/^https:\/\/s3\.family\.test:8443\//);
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);

  const download = page.waitForEvent('download');
  await page.getByRole('region', { name: 'Export' }).getByRole('button', { name: 'Download export' }).click();
  expect((await download).suggestedFilename()).toMatch(/^family-tree-.*\.zip$/);

  expect(await csp.violations()).toEqual([]);
});
```

- [ ] **Step 3: Run it against the local production stack.** The dev stack can stay up: the ports differ.

```bash
scripts/prod-local.sh up
pnpm test:e2e:prod-local
```

  Expected: `1 passed`, with no CSP violations.
  - If a violation is reported, fix the header source (`security-headers.ts`) and its test, not the test's expectation.
  - Rebuild with `scripts/prod-local.sh up` (it rebuilds the web app).
  - If sign-in cookies don't reach the API, check `WEB_ORIGIN`/`AUTH_BASE_URL` in `.prod-local/env`, and that `family.test` and `api.family.test` are same-site. They are: both have the registrable domain `family.test`.

  Then run `scripts/prod-local.sh down`.

- [ ] **Step 4: Add the `e2e` job** to `.github/workflows/ci.yml`, after `docker`:

```yaml
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @family-tree/e2e exec playwright install --with-deps --only-shell chromium
      # The dev stack in Docker, with Better Auth's limits off for E2E only (decision 15).
      - run: docker compose up -d --build --wait postgres s3
      - run: docker compose up -d --build api web
        env:
          AUTH_RATE_LIMIT_ENABLED: 'false'
      - run: pnpm test:e2e
        env:
          CI: 'true'
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: |
            e2e/playwright-report
            e2e/test-results
          retention-days: 7
      - if: always()
        run: docker compose logs --tail 200 api; docker compose down -v
```

- [ ] **Step 5: Create `.github/workflows/release-api.yml`.** It is manual only (decision 18): it has no `push`, `schedule` or `pull_request` triggers.

```yaml
name: Release API image

# Manual only: nothing is published until the author runs this from the Actions tab.
on:
  workflow_dispatch:
    inputs:
      tag:
        description: Image tag (for example 2026.11.1)
        required: true
        type: string

permissions:
  contents: read
  packages: write

jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: apps/api/Dockerfile
          push: true
          tags: ghcr.io/${{ github.repository_owner }}/family-tree-api:${{ inputs.tag }}
```

- [ ] **Step 6: Check the workflow files** (nothing runs remotely):

```bash
python3 -I -c "import sys,yaml; [yaml.safe_load(open(f)) for f in sys.argv[1:]]; print('yaml ok')" \
  .github/workflows/ci.yml .github/workflows/release-api.yml
grep -nE '^\s*(push|schedule|pull_request):' .github/workflows/release-api.yml || echo "manual only: ok"
```

  Expected: `yaml ok`, then `manual only: ok`. If PyYAML isn't installed, use `pnpm exec prettier --check .github/workflows/*.yml`, which parses the YAML.

  The CI `e2e` job's first real run is the author's next push. Say so in the final report.

- [ ] **Step 7: Commit**

```bash
git add e2e/support/csp.ts e2e/tests/smoke.spec.ts .github/workflows/ci.yml .github/workflows/release-api.yml
git commit -m "test(e2e): smoke test on the local production stack; CI e2e job; manual image release"
```

---

## Task 16: Docs — `docs/self-hosting.md` and `docs/deployment.md`

**Files:**
- Create: `docs/self-hosting.md`, `docs/deployment.md`

Write plain, numbered steps with exact commands. Use the repo's real file names. Don't include secrets, real account ids or the author's email. Say at the top of both files that **nothing in them has been run against real services yet** (Phase 7 only prepared them).

- [ ] **Step 1: `docs/self-hosting.md`** (generic: for anyone running their own instance). Sections, in order:
  1. **What you get:**
     - the architecture diagram from spec §2;
     - cost (a Hetzner CX22 at about €4–5 a month, Cloudflare Pages free, R2 free up to 10 GB);
     - what runs where: the API, Postgres and Caddy on the VPS, the web app on Pages, photos in R2.
  2. **Try it locally first:**
     - `scripts/prod-local.sh up`, `down`, `reset` and `backup-test`, and what each stands in for (decision 16).
     - **For a browser:**
       - add `127.0.0.1 family.test api.family.test s3.family.test` to `/etc/hosts` (manual, sudo);
       - import `.prod-local/caddy-root.crt` into the browser's certificate authorities. For Chrome on Linux: `certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n family-tree-local -i .prod-local/caddy-root.crt`, removed later with `-D -n family-tree-local`;
       - open `https://family.test:8443`.
     - `pnpm test:e2e:prod-local` runs the smoke test without any of that.
  3. **Before you start:**
     - a domain on Cloudflare DNS;
     - a GitHub account (for the image);
     - an SSH key;
     - `age` on your own computer;
     - choose names: `family.<domain>` for the web, `api.family.<domain>` for the API. The two must share a registrable domain, for the `SameSite=Lax` cookies (spec §8).
  4. **Cloudflare R2:**
     - Create the private `family-photos` bucket and a `family-backups` bucket, with no public access and no custom domain. Presigned URLs only work on the S3 API endpoint.
     - Create two API tokens, each with Object Read & Write and scoped to one bucket.
     - Note the endpoint `https://<account-id>.r2.cloudflarestorage.com`.
     - No CORS is needed (Phase 6 carry-forward).
     - **Check in a staging bucket first** (the Phase 6 carry-forward):
       - a presigned GET works, and an expired one gives 403;
       - `PutObject` without checksums is accepted;
       - `Cache-Control` comes back on GET.
  5. **The age key, on your own computer:**
     - `age-keygen -o family-tree-backup.key`;
     - keep it offline, in two places, because without it no backup can be restored;
     - copy the `age1…` public key for `AGE_RECIPIENT`.
  6. **The server:**
     - **Setup:**
       - a Hetzner CX22 running Debian 13;
       - SSH key only (`PasswordAuthentication no`);
       - `ufw allow 22,80,443/tcp` and `443/udp`, then `ufw enable` (spec §8);
       - unattended-upgrades;
       - Docker Engine with the Compose plugin.
     - `git clone` the repo to `/opt/family-tree`.
  7. **Configure:**
     - `cp .env.production.example .env.production`, `chmod 600 .env.production`, and fill it in. Generate each secret with `openssl rand -hex 32`. Explain every variable; the example's comments are the source.
     - Never commit it: `.gitignore` covers it, and CI runs gitleaks.
  8. **The API image:**
     - Run the **Release API image** workflow (Actions → Run workflow, with a tag), then set `API_IMAGE=ghcr.io/<you>/family-tree-api:<tag>`.
     - Or build on the server with `API_IMAGE=family-tree-api:local`.
  9. **DNS:** an `A`/`AAAA` record from `api.family.<domain>` to the VPS, DNS only (grey cloud), so Caddy can get its certificate (spec §10 step 4).
  10. **Start:**
      - `docker compose --env-file .env.production -f compose.prod.yml pull`, then `up -d`.
      - `migrate` runs first. Check `docker compose … ps`, and that `curl https://api.family.<domain>/api/v1/health` gives `{"status":"ok",…}`.
      - Say why the file is standalone (decision 10).
  11. **The web app on Cloudflare Pages:**
      - **Git integration:** build command `pnpm install --frozen-lockfile && pnpm --filter @family-tree/web build`, output `apps/web/dist`.
      - **Build variables:** `NODE_VERSION=24`, `VITE_API_BASE_URL`, and `VITE_PHOTO_ORIGIN` (the R2 endpoint). The build fails without the last two on Pages (decision 13).
      - **Or `wrangler`, from your computer:** `pnpm dlx wrangler@4.155.0 pages deploy apps/web/dist --project-name family-tree` (pinned, 2026-10-28), after a local build with the same variables.
      - Add the custom domain `family.<domain>`.
      - `dist/_headers` carries the CSP. There's no `404.html`, so Pages serves the app for every path.
  12. **Backups:**
      - Install the timer (the commands in `docker/backup/systemd/family-tree-backup.service`), and run one now with `docker compose … run --rm backup`.
      - What's kept: the 14 newest dumps, and photos changed or deleted in the last 14 runs.
      - The dump is encrypted, and the photo mirror isn't (decision 14).
      - Watch failures with `systemctl status family-tree-backup` and `journalctl -u family-tree-backup`.
  13. **Restore (practise it):**
      1. `docker compose … stop api`.
      2. Copy the key to the server temporarily (`/root/age.key`, `chmod 600`).
      3. `docker compose … run --rm -v /root/age.key:/run/age/identity.txt:ro backup restore.sh latest` (or a dump name from `rclone lsf`).
      4. `shred -u /root/age.key`.
      5. `docker compose … up -d`.
      **Notes:**
      - The order is the database, then the photos.
      - A database restored to before a deletion can name photos that are already gone. Those cards show initials. The orphan sweep removes extra objects a day later.
      - Sessions created after the dump are gone, so everyone signs in again.
  14. **Upgrades:**
      - Set a new `API_IMAGE` tag, then `pull` and `up -d`. Migrations run in `migrate`.
      - Postgres minor upgrades: change the image tag.
      - Major upgrades: dump and restore.
  15. **Operations:**
      - **Logs:** `docker compose … logs api` gives pino JSON with no personal data. Caddy keeps no access log.
      - **Health:** `/api/v1/health`.
      - **Purge and sweep:** the purge and orphan sweep run inside the API. Run them by hand with `docker compose … exec api node dist/trees/purge-cli.js --sweep`.
      - **Rate limits** are in memory, for a single API instance.
      - **Owner continuity:** transfer ownership to a successor (spec §5).
  16. **The security checklist:**
      - the firewall;
      - SSH keys only;
      - `.env.production` is mode 600;
      - Postgres isn't published, and the app role has no DDL;
      - the R2 tokens are scoped;
      - the age key is offline;
      - 2FA for owners;
      - gitleaks in CI.
- [ ] **Step 2: `docs/deployment.md`** (the author's own instance, short). It's a numbered runbook that points to the self-hosting sections:
  - **Domains:** `family.cortextechservices.com` (Pages) and `api.family.cortextechservices.com` (the VPS).
  - **Names:** the bucket names `family-photos` and `family-backups`, and the Pages project `family-tree`.
  - **Order:**
    1. R2
    2. the age key
    3. the VPS
    4. `.env.production`
    5. the image release
    6. DNS for the API
    7. `compose up`
    8. Pages with its variables
    9. the custom domain
    10. the backup timer and a practice restore
    11. a browser walkthrough of the manual checklist below
    12. 2FA on the author's own owner account
  - **Rollback:** the previous `API_IMAGE` tag, then `up -d`. For data, restore the last dump.
  - **The first-deploy checks from the carry-forwards:**
    - the R2 staging checks;
    - the extension privileges: `pg_trgm` and `unaccent` are created by `migrate` as the owner;
    - CSP with the real R2 origin;
    - the CI `e2e` job green on the first push.
- [ ] **Step 3: Check the commands.** Every command in both docs must exist in the repo or be a standard tool. Grep each script name, compose service and npm script you mention. `pnpm format` formats the Markdown.
- [ ] **Step 4: Commit**

```bash
git add docs/self-hosting.md docs/deployment.md
git commit -m "docs: self-hosting and the deployment runbook"
```

---

## Task 17: Verification, README, browser walkthrough and the manual checklist

- [ ] **Step 1: README.**
  - Change the status line to `> Status: v1 feature-complete (phase 7). Not deployed yet.`
  - **Add "Export (dev)":**
    - the owner's **Tree settings → Export → Download export**;
    - what is in the ZIP (`tree.ged` GEDCOM 5.5.1 UTF-8, `tree.json`, `photos/`);
    - it includes living relatives' details;
    - 5 exports an hour.
  - **Add "End-to-end tests":**
    1. Run `pnpm down && AUTH_RATE_LIMIT_ENABLED=false pnpm dev`. Explain why: Better Auth's limits, dev only, and production refuses it.
    2. Run `pnpm --filter @family-tree/e2e exec playwright install --only-shell chromium` once.
    3. Run `pnpm test:e2e`, and for the production stack `scripts/prod-local.sh up && pnpm test:e2e:prod-local`.
    Failures leave traces in `e2e/test-results/`.
  - **Add "Production and self-hosting":** one paragraph, with links to `docs/self-hosting.md` and `docs/deployment.md`, `scripts/prod-local.sh`, and the backups.
  - **"Known limitations":**
    - **Change** the "Moving 2FA to a new device" item to "isn't available yet; an owner who loses their phone signs in with a recovery code".
    - **Remove** the orphan-object item (the sweep now handles it).
    - **Add:**
      - Exports have no ZIP64: about 3.5 GB of photos per tree at most.
      - GEDCOM 5.5.1 has no neutral partner roles or step-child type. Same-sex couples are written as HUSB/WIFE by position, and step children get a note. `tree.json` keeps everything.
      - The export doesn't hide living people. Only the owner can export.
      - The photo backup mirror isn't encrypted (the database dump is).
      - E2E needs `AUTH_RATE_LIMIT_ENABLED=false` on the dev stack.
- [ ] **Step 2: The full checks:**

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm build
docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.24.3 detect --source /repo --no-banner
docker build -f apps/api/Dockerfile -t family-tree-api:phase7 .
docker run --rm -v "$PWD:/mnt:ro" koalaman/shellcheck:v0.10.0 /mnt/scripts/prod-local.sh
docker run --rm -v "$PWD:/mnt:ro" koalaman/shellcheck:v0.10.0 -s sh /mnt/docker/backup/backup.sh /mnt/docker/backup/restore.sh /mnt/docker/postgres/prod-init/10-app-role.sh
node <check-ages> pnpm-lock.yaml 6ee85d2
pnpm --filter @family-tree/web exec vite --version
pnpm --filter @family-tree/e2e exec node scripts/browser-check.mjs
```

  Expected:
  - Everything passes.
  - gitleaks reports `no leaks found`. If it flags a value in `.prod-local/`, check that the directory is gitignored: gitleaks scans history, not ignored files, so a hit means something was committed by mistake. Stop.
  - Every check-ages line is `ok` (only the Playwright packages are new).
  - Vite is `8.3.6`.
  - The browser check prints the same JSON as in Task 1.
  - Record the test counts (shared, API unit, API integration, web, and E2E).
- [ ] **Step 3: E2E, both targets.** Run `AUTH_RATE_LIMIT_ENABLED=false pnpm dev`, then `pnpm test:e2e`: 8 passed, 1 skipped. Then run `scripts/prod-local.sh up && pnpm test:e2e:prod-local && scripts/prod-local.sh backup-test`: 1 passed, then `PASS: …`. Finish with `scripts/prod-local.sh down`.
- [ ] **Step 4: Browser walkthrough.** The **controller** does this, not a subagent, with Claude-in-Chrome on the dev stack at http://localhost:5173.
  - Use local test accounts from the scratchpad (`scratchpad/totp.mjs` for codes).
  - Chrome autofills the user's real saved login: clear the fields before typing, never submit the user's real credentials, and never repeat test credentials in chat.
  - Never paste signed URLs into chat.
  1. **Setup:** sign up an owner with 2FA, run `pnpm seed <owner email>`, and open "Sample family (seed)".
  2. **Export:**
     - Tree settings shows an **Export** section with the living-relatives warning.
     - **Download export** shows "Preparing export…", then "Your export has downloaded.". A `family-tree-YYYY-MM-DD.zip` appears in Downloads.
     - `unzip -l` lists `tree.ged`, `tree.json` and `photos/` if any person has photos. `head -c 300 tree.ged` shows the BOM and `0 HEAD`, `1 SOUR FAMILY-TREE`, …
     - Open `tree.ged` in a text editor: Margaret has `2 TYPE maiden`, Robert's death has its date and place, and the union lines (`MARR`, `DIV`, `CHIL`) match the canvas.
  3. **Limits:** download five more times within the hour. The sixth shows "This tree was exported several times just now. Try again in a little while." There's no JSON page and no console error.
  4. **Viewer** (the second account, in a private window): there's no Tree settings and no Export section. Opening `http://localhost:5173/api/v1/trees/<id>/export` in that window shows a 403 JSON error.
  5. **Dark mode** (emulate `prefers-color-scheme: dark` in DevTools): the Export section is readable, with no hard-coded light colours.
  6. **Mobile (390 × 844):** the Export section and its button fit the width.
  7. **Console:** no errors. **Network:** no 500s. The export request is a single `GET …/export` with `200 application/zip`.
  8. **Optional, the local production stack in a browser.** Only if the user has added the hosts line and imported `.prod-local/caddy-root.crt` (docs/self-hosting.md, "Try it locally first"):
     - open https://family.test:8443, sign up, upload a photo and export;
     - DevTools shows no CSP violations;
     - the response headers of `/` include the CSP.
     If the user hasn't set this up, skip it and rely on the `@smoke` run.
- [ ] **Step 5: Commit** any fixes, then `docs: phase 7 README (export, production, E2E)`. Hand the user the summary and the manual checklist below, and wait for their result before merging.

**The manual checklist for the author** (about 40 minutes; nothing here touches real Cloudflare, Hetzner or R2):
1. `pnpm dev`, then `pnpm seed <your email>`, then open **Sample family (seed)**.
2. **Tree settings → Export → Download export.** Unzip the file: `tree.ged`, `tree.json` and `photos/` are there.
3. Import `tree.ged` into a GEDCOM program you trust (for example Gramps: Family Trees → Import). The people, their parents and partners, their dates (including "about" and "between"), the places, the cause of death and the photos appear. Accents in names look right.
4. Sign in as a viewer or editor in a private window. There is no Export.
5. Run `scripts/prod-local.sh up`. It ends with `{"status":"ok",…}`.
6. Optional: add `127.0.0.1 family.test api.family.test s3.family.test` to `/etc/hosts` and import `.prod-local/caddy-root.crt` into your browser. Open https://family.test:8443, sign up, start a tree with 2FA, add a photo and export. Remove the hosts line and the certificate afterwards.
7. Run `pnpm test:e2e:prod-local`: `1 passed`.
8. Run `scripts/prod-local.sh backup-test`: it ends with `PASS: backup, wipe, restore and retention`. Check that `.prod-local/backups/db/` holds `.dump.age` files, and that `head -c 30` of one shows `age-encryption.org/v1`.
9. Run `scripts/prod-local.sh down`.
10. Run `AUTH_RATE_LIMIT_ENABLED=false pnpm dev`, then `pnpm test:e2e`: 8 passed, 1 skipped.
11. Read `docs/self-hosting.md` and `docs/deployment.md` end to end. Every step makes sense for your own deploy, and nothing has been deployed yet.
12. Run `pnpm test && pnpm test:int`. Everything passes.

---

## Carry-forward notes (after Phase 7)

- **The first real deployment (the author, manually, following `docs/deployment.md`):**
  - **The R2 checks** in staging (Phase 6):
    - a presigned GET, and 403 when it has expired;
    - `PutObject` without checksums;
    - `Cache-Control` on GET.
  - **The CSP with the real R2 origin:** open the site and check DevTools for violations.
  - **The CI `e2e` job:** first green run on push. Its dev containers write as uid 1000 into a runner checkout owned by uid 1001. If that fails, run the stack with `user:` overrides or `chmod` the checkout in the job.
  - **Extension privileges:** `migrate` creates `pg_trgm` and `unaccent` as `family_owner`. Confirm on the server: `\dx` in psql.
  - **`family_owner` is a superuser** (the image's `POSTGRES_USER`). Later, create a non-superuser owner role for migrations, and keep the superuser for maintenance only.
  - **Backups:** alert on a failed `family-tree-backup.service`, with `OnFailure=` and a notifier, once an email or push provider exists. Consider a second provider or region for `family-backups`.
- **From spec §5, not done:** moving 2FA to a new device.
  - The design: re-enrol from Account, which needs a current TOTP code or a recovery code.
  - Implementation: Better Auth's `twoFactor.enable` while enabled, after a verified code, then the new secret's first code. Owners and stewards still can't disable it.
  - The README says it isn't available yet.
- **Message catalog (spec §6):** still inline strings (Phases 5–7). Move them all into one catalog before adding translations. The kinship words are already in `kinship.ts`.
- **The release-age gate (after 2026-11-23):** unchanged from Phase 5. Playwright is an exact pin too.
- **The export:**
  - ZIP64, if quotas grow past about 3.5 GB of photos per tree.
  - A "share" export that redacts living people (names only, no dates or places, no photos), for sending to outside researchers.
  - GEDCOM 7.0 (it has `FAMC.PEDI STEP`-like values and neutral roles), once importers support it widely.
  - GEDCOM import (spec §12) can read `tree.json` losslessly (`EXPORT_VERSION` 1).
- **E2E gaps:**
  - sibling drag-reorder;
  - steward grant chains (a steward granting a steward);
  - account deletion;
  - the owner reset link.
  The Playwright helpers make these cheap to add.
- **Known trade-offs:**
  - **The export reads the whole live tree** in one snapshot, and streams photos one at a time. That's fine for families. With very large trees, a time limit per export may be needed.
  - **The sweep lists the whole bucket** daily. At about 100k objects that is 100 list calls a day, which is negligible on R2's free tier.
  - **Local stand-ins:** SeaweedFS behind Caddy imitates R2's protocol, not its behaviour. Expiry enforcement and checksum handling are verified only by the R2 staging checks above.
