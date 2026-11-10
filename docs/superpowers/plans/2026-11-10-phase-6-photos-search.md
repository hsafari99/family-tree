# Phase 6 — Photos, Search and Relationships Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People get **photos**: upload from the person panel, with an optional square crop in the browser. The API re-encodes every upload with sharp, which strips EXIF and GPS. It stores a 1600 px version and a 256 px thumbnail in S3 (SeaweedFS in dev, R2 in prod) and serves them through **signed URLs valid for 15 minutes**. Photos count towards a **per-tree quota**. The primary photo shows on canvas cards, in the panel and in search results. The toolbar gets a typo-tolerant **search** (`pg_trgm`) with year, place, living/deceased and branch filters. Each result shows its relationship to you. **"How are we related?"** finds the shortest path between two people, words it in English ("your father’s sister’s husband", "second cousin once removed") and highlights it on the canvas. The duplicate check moves to `pg_trgm` behind the same API.

**Architecture:**
- **Shared (`packages/shared`), pure and unit-tested:**
  - `photos.ts`: limits, sizes, TTL and the response schemas.
  - `kinship.ts`: breadth-first pathfinding over parent, child and partner edges (`kinPathsFrom`, `relationshipPath`), plus the English wording (`kinshipTerm`, `kinshipChain`, `closeRelativeSteps`).
  - `search.ts`: the search and relationship query and response schemas.
- **API:**
  - `storage/objects.ts`: an `ObjectStore` with put, delete and signed GET. The signing client uses `S3_PUBLIC_ENDPOINT`, so dev URLs point at `localhost:8333` while the API itself talks to `s3:8333`.
  - `storage/deletions.ts`: an **outbox** (`storage_deletions`) for objects to delete. Photo delete, Trash erase and the tree purge queue their keys in the same transaction that drops the rows, and delete the objects after commit. The purge job retries failures.
  - `photos/process.ts`: magic-byte sniffing, size, dimension and pixel limits, and the sharp pipeline (auto-orient, strip all metadata, WebP full and thumbnail).
  - `routes/photos.ts`: upload as a raw body, set primary, delete.
  - `trees/search.ts`: the `pg_trgm` search and the trigram candidate query for the duplicate check.
  - `routes/search.ts`: `GET /search` and `GET /relationship`.
  - The graph and person view gain photo URLs.
- **Database (migrations 0005 and 0006):**
  - the `pg_trgm` and `unaccent` extensions, and an immutable `family_unaccent()` wrapper;
  - a generated `persons.search_name` column with a GIN trigram index, plus trigram indexes on the place columns;
  - the `photos` and `storage_deletions` tables.
- **Web:**
  - `PersonPhoto`: an image with an initials fallback, used everywhere.
  - `photos/crop.ts` and `PhotoCropper`.
  - `PhotosTab`, replacing the placeholder.
  - Card thumbnails.
  - `SearchBox` in the toolbar.
  - `RelationshipPanel` on a new `/trees/:id/relationship` route, with a path highlight applied to the laid-out nodes and edges (no re-layout).

**Tech Stack:** Fastify 5.12.8, Drizzle 0.45.4 / drizzle-kit 0.31.11, Postgres 17 (`pg_trgm`, `unaccent`), Better Auth 1.7.18, `@aws-sdk/client-s3` 3.1164.0, Zod 4.6.7, React 19.3.1, react-router 8.5.1, Vitest 5.1.0, Vite 8.3.6, `@xyflow/react` 12.12.0, `elkjs` 0.12.0. **New**, both in `apps/api` only:
- `sharp` **0.35.5** (published 2026-09-27, bundling libvips 8.18.7 via `@img/sharp-libvips-linux-x64` 1.3.4);
- `@aws-sdk/s3-request-presigner` **3.1157.0** (published 2026-10-26).

---

## Ground rules (read first)

- **Branch:** create `phase-6-photos-search` from `phase-5-canvas` once Phase 5 is approved and merged. Ask the user if it isn't merged yet; never start on top of uncommitted Phase 5 work.
  - Commit after each task. Never push.
  - Never commit:
    - `.env.production`
    - `graft/`
    - `.ignore`
    - `.claude/settings.local.json`
    - `.vitest/`
- **Dependencies:**
  - Only the two new ones in Task 1, with exact versions. Every package they pull in must have been published at least 14 days before installation. Task 1 checks this with the Phase 5 age-check script.
  - **Don't commit `minimumReleaseAge`**, and don't pass it on the command line (Phase 5 decision 20: pnpm 12.18 then re-checks the whole existing lockfile and fails).
  - Never add `minimumReleaseAgeExclude`, and never upgrade other dependencies. **Vite stays at 8.3.6.**
  - **sharp is the only native addition.** The dev CPU (Xeon E5-1650 v2, Ivy Bridge) is **x86-64-v2**: it has SSE4.2, POPCNT and AVX, but no AVX2. Task 1 checks that sharp loads and processes images on it, on the host, in the dev container and in the production image. Don't add any other native tool.
- **Running the stack:**
  - The dev stack runs in Docker: `pnpm dev`. Rebuild after Task 1 (`pnpm down && pnpm dev`), so the containers install sharp.
  - Integration tests need postgres and s3 up: `docker compose up -d --wait postgres s3`.
  - Commands, from the repo root: `pnpm test`, `pnpm test:int`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm build`.
- **Single test files:**
  - API unit: `pnpm --filter @family-tree/api exec vitest run src/path/file.test.ts`
  - API integration: `pnpm --filter @family-tree/api exec vitest run --config vitest.int.config.ts src/path/file.int.test.ts`
  - Web: `pnpm --filter @family-tree/web exec vitest run src/path/file.test.tsx`
  - Shared: `pnpm --filter @family-tree/shared exec vitest run src/file.test.ts`
- **Error handling (unchanged):**
  - Only `AppError` messages reach clients.
  - Trees the user can't see return **404**, never 403. Ids of rows in another tree (a person, a photo, a branch anchor, `from`/`to`) also return **404**.
  - `FORBIDDEN` is only for a tree the user is a member of.
  - The web UI maps error **codes** (and, for photos, `details.reason`) to fixed messages, and never shows server text.
- **Order inside a route:**
  1. `loadAccess` (outsiders get 404).
  2. Parse the query or body.
  3. Load the target in this tree (404).
  4. `authorize`.
  5. Read or write.
  The **upload** route does steps 1, 3 and 4 in `onRequest`, before Fastify reads the body (decision 2).
- **Routes:** the new plugins are registered after the rate limiter (see the comment in `app.ts`) and need a session.
- **Secrets and personal data:**
  - Storage keys contain only tree and photo UUIDs, never names or file names.
  - Never log request bodies, image bytes or signed URLs (they are bearer tokens for 15 minutes).
- **Browser:** no `window.confirm` / `alert`. Destructive buttons use `ConfirmButton`. User content is never rendered as HTML.
- **Code in this plan** is the intended implementation. If the real code has moved on (names, imports, Phase 5 components such as `CanvasToolbar`/`BranchPicker`), follow the repo and keep the behaviour. Run Prettier (`pnpm format`) before each commit.

## Decisions taken in this plan (beyond the spec)

1. **Dependencies and the AVX2 finding:**
   - **sharp 0.35.5 and its binaries:**
     - sharp 0.35.5 (2026-09-27) has **no install script**. Its `linux-x64` binaries arrive as optional dependencies: `@img/sharp-linux-x64` 0.35.5 and `@img/sharp-libvips-linux-x64` 1.3.4, which need glibc ≥ 2.28. Bookworm has 2.36.
     - libvips 8.18 uses Highway, which picks SIMD code at run time, so AVX2 paths only run on CPUs that have them.
   - **Checked while writing this plan, on the dev CPU (x86-64-v2, no AVX2):**
     - sharp 0.35.5 loaded and ran the whole pipeline on the host and in `node:24-bookworm-slim`: decode, `withExif`, `autoOrient`, resize, WebP encode and `metadata()`.
     - The output had no EXIF, ICC or XMP.
     - Task 1 repeats this, as a gate, in the real dev and production images.
   - **Fallback, if a future run shows "Illegal instruction":**
     1. Try sharp **0.34.5** (2025-11-06, libvips 1.2.4), the previous minor.
     2. If that fails too, stop and ask. Don't switch to `@img/sharp-wasm32` silently: it is several times slower and needs a different install.
   - **`@aws-sdk/s3-request-presigner` 3.1157.0** (2026-10-26) is the newest release at least 14 days old.
     - Its dependency ranges (`@aws-sdk/signature-v4-multi-region ^3.996.49`, `@smithy/core ^3.37.0`, `@aws-sdk/core ^3.978.6`, …) are all satisfied by versions already in the lockfile.
     - So it adds one lockfile entry and no new transitive packages.
     - The matching 3.1164.0 (2026-11-06) is too new.
   - **No `@fastify/multipart`** (decision 2), and **no `file-type`**: sniffing three formats is a few lines.
2. **Upload transport:**
   - `POST /trees/:id/persons/:pid/photos` takes the image as the **raw request body**, with `Content-Type: image/jpeg|image/png|image/webp`. That's one photo per request, which is all the UI ever sends.
   - A content-type parser registered **only inside the photos plugin** buffers these types up to `bodyLimit` 10 MB.
   - The session, an upload rate limit, `loadAccess`, the live-person lookup and `authorize(person.edit)` all run in **`onRequest`**, before the body is read. So an outsider or a viewer never has 10 MB buffered, and gets 404 or 403, not 413.
   - The body itself must be a `Buffer`. A JSON or text body gets reason `type`.
3. **Validation (spec §8):**
   - The type comes from the **magic bytes**:
     - JPEG: `FF D8 FF`;
     - PNG: the 8-byte signature;
     - WebP: `RIFF….WEBP`.
     The declared `Content-Type` only selects the parser. sharp's detected `format` must also equal the sniffed one.
   - **Limits:**
     - the 10 MB body limit;
     - at most **12,000 px** per side and **50 megapixels**. The header is checked first, and sharp's `limitInputPixels: 50_000_000` stops `metadata()` and decoding of anything larger. That is the decompression-bomb guard.
   - `animated: false` keeps only the first frame of an animated WebP or APNG.
   - `failOn: 'error'` rejects truncated or corrupt files.
   - Each sharp call has a 30-second timeout.
   - At most **2** photos are processed at once per API process (an in-process limiter), to cap memory on a 2-vCPU, 4 GB VPS.
4. **Processing:**
   - `autoOrient` applies the EXIF orientation to the pixels. sharp then writes **no metadata at all**: EXIF (including GPS), XMP and IPTC are dropped, and ICC-tagged images are converted to sRGB.
   - **Full version:** WebP quality 82, fit inside 1600 × 1600, never enlarged.
   - **Thumbnail:** WebP quality 78, 256 × 256 cover, with `position: 'attention'`.
   - Both are re-encoded from the original. The stored `width`/`height` are those of the full version, and `bytes` is full plus thumbnail.
5. **Browser crop (spec §6 "crop in the browser"):**
   - The crop is optional and square: a zoom slider plus drag or arrow keys.
   - The cropped image is drawn on a canvas, at most 1600 px, and sent as JPEG quality 0.92.
   - "Use the whole photo" sends the original file.
   - The server re-encodes either way, so cropping is never a security boundary.
6. **Storage keys and write order:**
   - The keys are `trees/<treeId>/photos/<photoId>/full.webp` and `…/thumb.webp`. The API generates the photo id first.
   - Both objects are written **before** the row is inserted, each with `Cache-Control: private, max-age=900`.
   - If the transaction fails (quota, person deleted meanwhile, cap), the objects are deleted at once, or queued (decision 13) if that delete fails.
   - A crash between the upload and the insert can leave an orphan object. This is accepted and listed as a Phase 7 item (an orphan sweep).
7. **Signed URLs:**
   - Presigned S3 `GetObject` URLs come from `@aws-sdk/s3-request-presigner`, on a **second** `S3Client` whose endpoint is **`S3_PUBLIC_ENDPOINT`** (default: `S3_ENDPOINT`).
     - In dev, the API container talks to `http://s3:8333`, but the browser loads `http://localhost:8333` (compose already binds `127.0.0.1:8333`).
     - In prod both are the R2 endpoint.
   - `expiresIn` is 900 s (spec §8).
   - **Signing time is rounded down to 5-minute windows.** Every URL for an object is then identical within a window, so the browser cache works across graph refetches, and each URL is valid for 10 to 15 minutes after it is issued.
   - An in-memory map caches (key, window) → URL, capped at 20,000 entries. That makes signing 2,000 card thumbnails cheap.
   - The bucket stays **private**. Browsers never get credentials, and `<img>` needs no CORS.
8. **S3 client checksums:** `requestChecksumCalculation` and `responseChecksumValidation` are `'WHEN_REQUIRED'`. Plain SigV4 works with both SeaweedFS and R2, and it avoids the SDK's default CRC32 trailers, which S3-compatible stores handle unevenly. Deletes use `DeleteObject` per key, never `DeleteObjects`, which requires a checksum.
9. **Data model:**
   - `photos` follows spec §3. `id` is set by the API, and the table has a composite `(tree_id, person_id)` FK that cascades.
   - A **partial unique index** allows one `is_primary` per person.
   - **`persons.primary_photo_id` is not added:**
     - `photos.is_primary` is the single source of truth;
     - a column on `persons` would be a person-field write that bumps `version` and staleness, and an FK cycle.
   - Photos have **no `deleted_at`**. They are hidden together with their person (every read joins a live person), like residences. A restored batch shows them again.
10. **Primary photo:**
    - The first photo of a person becomes primary.
    - `POST /photos/:id/primary` moves it.
    - Deleting the primary promotes the newest remaining photo.
11. **Deleting a photo** is **permanent** after the two-click `ConfirmButton`, like a place of residence: the spec's Trash covers people and relations only. It is audited (`photo.delete`).
12. **Permissions:**
    - Upload, set primary and delete need `person.edit` on the photo's person: owner, editor, and a steward with that person in scope (spec §4: "Edit people and relations, upload photos").
    - Seeing photos needs `tree.view`.
    - Viewers get 403, outsiders 404.
13. **Object deletion outbox (`storage_deletions`):**
    - Every path that drops photo rows inserts both keys into `storage_deletions` **in the same transaction**:
      - photo delete;
      - `eraseBatch`, before it deletes the batch's persons;
      - the tree purge, before `delete from trees`.
    - After commit, the route or job deletes those objects and removes the outbox rows.
    - A failed delete stays queued (`attempts + 1`), and the purge job drains the outbox every tick.
    - This settles the Phase 4 carry-forward ("collect keys before the cascade, delete after commit, retry if S3 fails").
14. **Quotas:**
    - **Per tree:** `MAX_PHOTO_BYTES_PER_TREE`, default 1 GiB (spec §3). It counts the stored bytes (full + thumbnail) of **every** photo row of the tree, **including people in Trash**, because their objects still use storage.
      - Erase frees the space.
      - Restore is never blocked by the quota. This replaces the Phase 4 note "a restored batch brings its photos back into the count": they never left it.
      - It is checked before processing (fast fail) and again inside the insert transaction, under the advisory lock `photos:<treeId>`, which serialises every photo write of a tree.
      - Over the limit is `403 QUOTA_EXCEEDED`, like the tree limit.
    - **Per person:** at most 50 photos.
    - **Per user:** 30 uploads per 10 minutes (a rate limit). The spec has no per-user byte quota, so none is added.
15. **Errors for photos:**
    - A rejected file is `400 VALIDATION` with `details: { reason }`. The reason is `type`, `tooLarge`, `dimensions`, `unreadable` or `tooMany`.
    - Fastify's `FST_ERR_CTP_BODY_TOO_LARGE` (413) and `FST_ERR_CTP_INVALID_MEDIA_TYPE` (415) are mapped to the same shape (`tooLarge`, `type`), keeping their status.
    - The web maps each reason to a fixed message.
16. **Audit and History:**
    - New actions: `photo.create` (after: width, height, bytes), `photo.primary` and `photo.delete` (before: width, height, bytes).
    - The entity is `photo`, and `personIds` is the person.
    - `'photo.'` joins `HISTORY_ACTION_PREFIXES`.
    - Audit rows never hold storage keys or URLs.
17. **Where photo URLs appear:**
    - `GraphPerson.photoThumbUrl`, for the primary thumbnail. URLs are attached after `buildTreeGraph`, and never go into ELK input.
    - `PersonView.photos`: primary first, then newest, each with `thumbUrl` and `fullUrl`.
    - `PersonView.photoUsage`: `{ usedBytes, limitBytes }`.
    - `SearchResult.photoThumbUrl`, and the relationship persons.
18. **Search** (`GET /trees/:id/search`, spec §6/§7):
    - **Parameters:**
      - `q`: up to 5 words;
      - `bornFrom`, `bornTo`, `diedFrom`, `diedTo` (on `sort_year`);
      - `place`: a case-insensitive substring of the birth place, death place or any residence;
      - `status`: `living` or `deceased`;
      - `branch`: a person id, using the spec §4 rule without rule 5, the same as the full view's branch (Phase 5 decision 4);
      - `limit`: default 20, maximum 50.
      At least a name or one filter is required.
    - **Names:**
      - A stored generated column `search_name = lower(family_unaccent(given ‖ middle ‖ surname ‖ maiden ‖ nickname))` has a GIN `gin_trgm_ops` index.
      - Each query word must match: `word <% search_name` (with `pg_trgm.word_similarity_threshold = 0.4`, set locally in the query's transaction), or be a substring.
      - Query words are normalised by the same SQL, so "Jose" finds "José".
    - **Ranking:** the sum of `word_similarity` over the words, then surname, given name and id.
    - **Each result:** `PersonSummary`, `photoThumbUrl`, and `relation`:
      - the path from the signed-in user's own card;
      - `[]` for that card itself;
      - `null` when not connected, or when the user has no card.
    - **Rate limit:** 120 per minute per user.
19. **Duplicate check on `pg_trgm`** (the Phase 5 carry-forward):
    - `GET /persons/similar` keeps its contract.
    - The candidate query becomes a trigram prefilter:
      - the given name `<%` `search_name`, at threshold 0.3;
      - the birth year within ±2, or unknown;
      - up to 200 candidates by similarity.
    - `findSimilar` then applies the Phase 5 rules and ranking to them.
20. **Relationship path** (spec §6 "How are we related?"):
    - **The search:** breadth-first over **parent, child and partner** edges, with all four child kinds as parent links (spec §3). Neighbours are visited in a fixed order, parents, then children, then partners, then by id, so the shortest path is deterministic.
    - `GET /trees/:id/relationship?from=&to=` returns `{ steps, persons }`:
      - `steps`: structural `KinStep[]`, `[]` for the same person, `null` when not connected;
      - `persons`: `from`, then each step's person, with sex and thumbnail.
    - Ids that aren't live people of this tree are 404.
    - Permission is `tree.view`. Rate limit: 60 per minute per user.
    - **The words are computed in the browser** with the shared `kinshipTerm` and `kinshipChain`, so interface text stays out of the API.
21. **Kinship wording (English):**
    - **The chain** names each step with a basic word, and a parent step followed by a child step is one sibling: "your father’s sister’s husband".
    - **Gendered words:**
      - father/mother/parent, son/daughter/child, brother/sister/sibling;
      - husband/wife/spouse for a marriage, partner for a partnership;
      - "former …" for a divorced or separated union.
    - **Link kinds:**
      - step: stepfather, stepson;
      - adoptive: adoptive mother, adopted son;
      - foster: foster father, foster son.
      Kinds only change single parent or child words; grandparents and cousins are just grandparents and cousins.
    - **The term** is a single name when English has one:
      - grand-, great-, great-great-, then "3rd great-" ancestors and descendants;
      - brother/sister and half-brother/half-sister (half when the two steps at the turn go through different unions);
      - aunt/uncle, nieces and nephews, with greats;
      - "nth cousin k times removed", and "half first cousin";
      - in-laws: parent-, child- and sibling-in-law, both ways;
      - step-parent, stepchild and step-sibling (a parent's or partner's partner or child);
      - "uncle/aunt by marriage", with greats;
      - "former …" when the partner step on the way has ended.
    - **No term** (`null`): the chain alone describes it, for example "your wife’s mother’s mother".
    - **Other or unknown sex:** neutral words ("parent", "sibling-in-law", "aunt or uncle").
22. **Photos in the UI:**
    - **`PersonPhoto`** renders `<img alt="">`, since the name is already in the surrounding label. When there is no URL, or the image fails (for example an expired URL), it shows the initials. A failure also asks for a refresh, at most once a minute: the workspace refetches the graph, and the panel reloads the person.
    - **Photos tab:**
      - a grid of thumbnails, each opening the full version in a new tab (`rel="noopener noreferrer"`);
      - a "Main photo" badge;
      - **Make main photo**, and **Delete** behind a two-click confirm;
      - **Add a photo**, which opens a file input, then the cropper, then the upload;
      - the usage line "Photos use 12.3 MB of this tree’s 1 GB.".
      Users without `capabilities.edit` see the photos only.
23. **Search box:**
    - It sits in the toolbar before the View group: `role="search"`, an `input type="search"` and a **Filters** disclosure.
    - Typing searches after 250 ms. Stale responses are dropped.
    - Results are a list of buttons: photo, name, years and "Your second cousin" / "You" / "Not connected to you".
    - Choosing one opens that person (`usePersonHref`), and focus view re-centres on them (Phase 5 decision 10).
    - **Esc** closes the results.
24. **"How are we related?":**
    - The toolbar link opens `/trees/:id/relationship?from=<me or root>&to=<selected person>`, in the side panel or bottom sheet.
    - Two person pickers.
    - **The result:**
      - a headline, "Laura Hale is Noah’s aunt by marriage" (or "… is your …" when `from` is your card, or "… is Noah’s mother’s brother’s wife" when there is no term);
      - the chain;
      - the ordered list of people on the path, as links.
    - **Show on the tree:**
      - highlights the people, union dots and lines of the path (`is-path` and `edge-path` classes, applied to the laid-out nodes, so there's no re-layout);
      - switches to focus view on `from`, with the depth set to the path's close-relative steps (`closeRelativeSteps`, which counts a half-sibling as 2, like Phase 5 depth) when that is 3 or less; otherwise to full view.
    - Leaving the route clears the highlight. `from` and `to` are dropped by `usePersonHref` and by **Close**.
25. **Text:**
    - New error messages go into `MESSAGES`.
    - The kinship vocabulary lives in shared `kinship.ts`.
    - Other new UI strings are inline, like the rest of the web app.
    - Moving everything into one message catalog (spec §6) is a carry-forward item.
26. **Dev config:**
    - `.env.development` gains `S3_PUBLIC_ENDPOINT=http://localhost:8333`. The api service in compose keeps overriding only `S3_ENDPOINT`.
    - `.env.production.example` documents `S3_PUBLIC_ENDPOINT` (the R2 endpoint, same as `S3_ENDPOINT`) and `MAX_PHOTO_BYTES_PER_TREE`.
    - In production, `S3_PUBLIC_ENDPOINT` must be https and not local.

## File map

```
apps/api/
  package.json                          + sharp 0.35.5, @aws-sdk/s3-request-presigner 3.1157.0
  drizzle/0005_search_extensions.sql    custom: pg_trgm, unaccent, family_unaccent()
  drizzle/0006_photos_search.sql        generated: photos, storage_deletions, search_name, GIN indexes
  src/config.ts (+test)                 + S3_PUBLIC_ENDPOINT, MAX_PHOTO_BYTES_PER_TREE
  src/storage/s3.ts                     createS3(config, endpoint?), checksums WHEN_REQUIRED
  src/storage/objects.ts (+int test)    ObjectStore: put, delete, signedUrl (windowed, cached)
  src/storage/deletions.ts (+int test)  queueObjectDeletes, queuePhotoObjects, drainStorageDeletions
  src/photos/process.ts (+test)         sniffImageFormat, processPhoto, PhotoRejected
  src/photos/limiter.ts (+test)         limiter(n)
  src/photos/photos.ts                  photoKeys, photoBytesUsed, lockTreePhotos, loadPhotos, toPhoto, signThumbs
  src/routes/photos.ts (+int test)      upload, set primary, delete
  src/trees/search.ts                   searchPersons, similarCandidates
  src/routes/search.ts (+int test)      GET search, GET relationship
  src/routes/graph.ts                   photo URLs on the graph; similar → similarCandidates
  src/trees/graph-rows.ts               + photoThumbKey per person
  src/trees/graph-view.ts               explicit person fields, photoThumbUrl: null; withPhotoUrls()
  src/trees/person-view.ts              + photos, photoUsage
  src/trees/trash.ts                    eraseBatch queues photo objects, returns their keys
  src/trees/purge.ts                    queue photo objects per batch; startPurgeJob drains the outbox
  src/trees/purge-cli.ts                + drain
  src/routes/trash.ts                   drain after erase
  src/routes/persons.ts                 pass storage to loadPersonView
  src/routes/trees.ts                   TreeRouteOptions + storage
  src/auth/session-guard.ts             plain (req, reply) handler type (usable in onRequest)
  src/app.ts                            storage option, photos + search plugins, 413/415 mapping
  src/deps.ts, src/server.ts            storage wiring
  src/db/schema.ts                      photos, storageDeletions, persons.searchName, trigram indexes
  src/db/photos-schema.int.test.ts      new
  src/routes/isolation.int.test.ts      + photo, search and relationship routes; photos in the snapshot
  src/routes/graph.int.test.ts          + photoThumbUrl; similar via pg_trgm
  src/trees/purge.int.test.ts, src/routes/trash.int.test.ts   + photo objects
  test/photo-fixtures.ts                jpegWithExif, png, webp, gif, pngHeaderOnly, SECRET
  test/photo-helpers.ts                 upload(), addPhotoRow(), objectExists()
.env.development, .env.production.example   + S3_PUBLIC_ENDPOINT, MAX_PHOTO_BYTES_PER_TREE
packages/shared/src/
  photos.ts (+test)                     limits, photoSchema, photoUsageSchema, uploadedPhotoSchema
  kinship.ts (+test)                    KinStep, kinPathsFrom, relationshipPath, kinshipTerm, kinshipChain, closeRelativeSteps
  search.ts (+test)                     searchQuerySchema, searchResponseSchema, relationshipQuerySchema, relationshipSchema
  people.ts                             + photo.* audit actions, 'photo' entity, 'photo.' history prefix, PersonView photos
  graph.ts                              + graphPerson.photoThumbUrl
  index.ts                              + exports
apps/web/src/
  auth/api.ts                           + photo, search and relationship messages
  trees/api.ts (+test)                  + raw-body request, uploadPhoto, setPrimaryPhoto, deletePhoto, search, relationship
  trees/format.ts                       + photo audit labels, formatBytes()
  test/fake-trees.ts (+test)            + the same in memory
  test/setup.ts                         + URL.createObjectURL/revokeObjectURL stubs
  components/PersonPhoto.tsx (+test)    img with initials fallback; PhotoRefreshContext
  components/PersonPicker.tsx           extracted from Phase 5's BranchPicker
  photos/crop.ts (+test)                initialCrop, zoomCrop, moveCrop, cropToBlob
  photos/PhotoCropper.tsx
  pages/tree/PhotosTab.tsx (+test)
  pages/tree/PersonPanel.tsx (+test)    Photos tab, header photo
  canvas/PersonCard.tsx (+test)         thumbnail via PersonPhoto, is-path
  canvas/highlight.ts (+test)           pathHighlight, applyHighlight
  canvas/SearchBox.tsx (+test)
  canvas/CanvasToolbar.tsx              + SearchBox, "How are we related?"
  canvas/params.ts (+test)              + from/to keys, dropped by usePersonHref
  canvas/test-fixtures.ts               + photoThumbUrl: null
  pages/tree/RelationshipPanel.tsx (+test)
  pages/tree/TreeWorkspace.tsx (+test)  relationship route, highlight, photo refresh
  routes.tsx                            + /trees/:treeId/relationship
  styles.css                            photos, search, path highlight
README.md                               photos, search, relationships; limitations
```

---

## Task 1: Dependencies — sharp and the S3 presigner, and the CPU check

**Files:**
- Modify: `apps/api/package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Re-check the publish dates** (read-only network):

```bash
pnpm view sharp time --json | grep -E '"0\.35\.5"'
pnpm view @img/sharp-linux-x64 time --json | grep -E '"0\.35\.5"'
pnpm view @img/sharp-libvips-linux-x64 time --json | grep -E '"1\.3\.4"'
pnpm view @aws-sdk/s3-request-presigner time --json | grep -E '"3\.1157\.0"'
pnpm view sharp@0.35.5 scripts --json | grep -E '"(pre|post)?install"' || echo "no install script"
```

  Expected:
  - The three sharp packages are from 2026-09-27, and the presigner from 2026-10-26.
  - The last line prints `no install script`.

  If any date is less than 14 days before today, stop and ask.

- [ ] **Step 2: Install with exact pins:**

```bash
pnpm --filter @family-tree/api add --save-exact sharp@0.35.5 @aws-sdk/s3-request-presigner@3.1157.0
```

  Expected:
  - `apps/api/package.json` dependencies gain `"sharp": "0.35.5"` and `"@aws-sdk/s3-request-presigner": "3.1157.0"`.
  - `git diff pnpm-lock.yaml` only **adds** entries: sharp, `@img/*`, `@img/colour`, `@emnapi/runtime` (for the wasm32 optional package), and the presigner. No existing version changes. `semver` and `detect-libc` reuse the locked versions.
  - `git diff pnpm-workspace.yaml` is empty. sharp needs no `allowBuilds` entry, because it has no install script.
  - If pnpm wrote `minimumReleaseAgeExclude`, or changed any existing version, run `git checkout pnpm-workspace.yaml pnpm-lock.yaml apps/api/package.json`, then stop and ask.

- [ ] **Step 3: Verify every new lockfile package is old enough** and has no install script.
  - Write the Phase 5 script to `<scratchpad>/check-ages.mjs`, outside the repo, if it isn't there. It is verbatim in `docs/superpowers/plans/2026-11-10-phase-5-canvas.md`, Task 1 Step 4.
  - Run: `node <scratchpad>/check-ages.mjs pnpm-lock.yaml`
  - Expected: every line starts with `ok`. That includes:
    - every `@img/sharp-*@0.35.5` and `@img/sharp-libvips-*@1.3.4` (2026-09-27);
    - `@img/colour@1.1.0` (2026-03-01);
    - `@emnapi/runtime@1.11.3` (2026-07-25);
    - `@aws-sdk/s3-request-presigner@3.1157.0` (2026-10-26).
  - If any line says `BAD`, stop and ask. In particular, if the presigner pulled a newer `@smithy/*` or `@aws-sdk/*` instead of the locked one, pin it with an `overrides` entry to the locked version, and say so in the commit.

- [ ] **Step 4: The CPU check on the host** (x86-64-v2, no AVX2). Write `<scratchpad>/sharp-check.mjs`:

```js
// Usage: node sharp-check.mjs <dir that contains node_modules/sharp>
import { createRequire } from 'node:module';
const require = createRequire(`${process.argv[2]}/`);
const sharp = require('sharp');
const exif = { IFD0: { Copyright: 'secret-marker' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' } };
const jpeg = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#c33' } })
  .jpeg().withMetadata({ orientation: 6 }).withExif(exif).toBuffer();
const out = await sharp(jpeg, { autoOrient: true, limitInputPixels: 50e6, failOn: 'error' })
  .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 })
  .toBuffer({ resolveWithObject: true });
const m = await sharp(out.data).metadata();
console.log(JSON.stringify({ vips: sharp.versions.vips, w: out.info.width, h: out.info.height, exif: !!m.exif, icc: !!m.icc, marker: out.data.includes(Buffer.from('secret-marker')) }));
```

  Run: `node <scratchpad>/sharp-check.mjs apps/api`

  Expected: `{"vips":"8.18.7","w":1200,"h":1600,"exif":false,"icc":false,"marker":false}`. The orientation-6 input is rotated, so it is 1200 wide and 1600 high, with no metadata. "Illegal instruction" (exit code 132) means the fallback of decision 1.

- [ ] **Step 5: The same check in the dev container and in the production image:**

```bash
pnpm down && docker compose build && docker compose run --rm install
docker compose run --rm -v <scratchpad>:/s:ro api node /s/sharp-check.mjs /app/apps/api
docker build -f apps/api/Dockerfile -t family-tree-api:phase6 .
docker run --rm -v <scratchpad>:/s:ro family-tree-api:phase6 node /s/sharp-check.mjs /app
```

  Expected: the same JSON line twice. The production image's `pnpm deploy --prod` keeps the `@img/sharp-linux-x64` and `@img/sharp-libvips-linux-x64` folders.

- [ ] **Step 6: Build and test still pass:** `pnpm typecheck && pnpm test && pnpm build`. No "Illegal instruction", and `pnpm --filter @family-tree/web exec vite --version` still prints 8.3.6.

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "build(api): add sharp 0.35.5 and @aws-sdk/s3-request-presigner 3.1157.0"
```

---

## Task 2: Shared — photo limits and schemas, photo audit actions

**Files:**
- Create: `packages/shared/src/photos.ts`, `packages/shared/src/photos.test.ts`
- Modify: `packages/shared/src/people.ts`, `packages/shared/src/index.ts`, `apps/web/src/trees/format.ts`

- [ ] **Step 1: Write the failing `photos.test.ts`:**

```ts
import { describe, expect, it } from 'vitest';
import {
  HISTORY_ACTION_PREFIXES,
  PHOTO_FULL_SIDE,
  PHOTO_MAX_PIXELS,
  PHOTO_THUMB_SIDE,
  PHOTO_UPLOAD_MAX_BYTES,
  PHOTO_URL_TTL_SECONDS,
  photoSchema,
  uploadedPhotoSchema,
} from './index.js';

const photo = {
  id: '00000000-0000-4000-8000-000000000001',
  width: 1600,
  height: 1200,
  bytes: 210_000,
  isPrimary: true,
  createdAt: '2026-11-10T10:00:00.000Z',
  uploadedByName: 'Olive Owner',
  thumbUrl: 'http://localhost:8333/family-photos/trees/t/photos/p/thumb.webp?X-Amz-Expires=900',
  fullUrl: 'http://localhost:8333/family-photos/trees/t/photos/p/full.webp?X-Amz-Expires=900',
};

describe('photo limits (spec §8)', () => {
  it('matches the spec', () => {
    expect(PHOTO_UPLOAD_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect([PHOTO_FULL_SIDE, PHOTO_THUMB_SIDE]).toEqual([1600, 256]);
    expect(PHOTO_URL_TTL_SECONDS).toBe(900);
    expect(PHOTO_MAX_PIXELS).toBe(50_000_000);
  });
  it('parses a photo and an upload response', () => {
    expect(photoSchema.parse(photo)).toEqual(photo);
    expect(
      uploadedPhotoSchema.parse({ photo, usage: { usedBytes: 210_000, limitBytes: 1 } }).usage,
    ).toEqual({ usedBytes: 210_000, limitBytes: 1 });
    expect(photoSchema.safeParse({ ...photo, thumbUrl: undefined }).success).toBe(false);
  });
  it('shows photo changes in History', () => {
    expect(HISTORY_ACTION_PREFIXES).toContain('photo.');
  });
});
```

- [ ] **Step 2: Run it; it fails** (missing exports).

- [ ] **Step 3: Implement `photos.ts`:**

```ts
import { z } from 'zod';

/** Spec §8: at most 10 MB; JPEG, PNG or WebP (the server checks the magic bytes). */
export const PHOTO_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoMediaType = (typeof PHOTO_MEDIA_TYPES)[number];
/** Stored sizes (spec §8): the long side of the full version, and the square thumbnail. */
export const PHOTO_FULL_SIDE = 1600;
export const PHOTO_THUMB_SIDE = 256;
/** Decompression-bomb guard (decision 3): larger images are refused before decoding. */
export const PHOTO_MAX_PIXELS = 50_000_000;
export const PHOTO_MAX_SIDE = 12_000;
export const PHOTOS_PER_PERSON_MAX = 50;
/** Signed photo URLs are valid for 15 minutes (spec §8). */
export const PHOTO_URL_TTL_SECONDS = 15 * 60;
/** Why an upload was refused: `details.reason` of the VALIDATION error (decision 15). */
export const PHOTO_REJECT_REASONS = [
  'type',
  'tooLarge',
  'dimensions',
  'unreadable',
  'tooMany',
] as const;
export type PhotoRejectReason = (typeof PHOTO_REJECT_REASONS)[number];

export const photoSchema = z.object({
  id: z.uuid(),
  /** Of the full version. */
  width: z.number().int(),
  height: z.number().int(),
  /** Stored bytes of both versions: what counts towards the tree's quota. */
  bytes: z.number().int(),
  isPrimary: z.boolean(),
  createdAt: z.string(),
  uploadedByName: z.string().nullable(),
  thumbUrl: z.string(),
  fullUrl: z.string(),
});
export type Photo = z.infer<typeof photoSchema>;

export const photoUsageSchema = z.object({
  usedBytes: z.number().int(),
  limitBytes: z.number().int(),
});
export type PhotoUsage = z.infer<typeof photoUsageSchema>;

export const uploadedPhotoSchema = z.object({ photo: photoSchema, usage: photoUsageSchema });
export type UploadedPhoto = z.infer<typeof uploadedPhotoSchema>;
```

  **`people.ts`:**
  - `HISTORY_ACTION_PREFIXES` gains `'photo.'`.
  - `AUDIT_ACTIONS` gains `'photo.create'`, `'photo.primary'` and `'photo.delete'`, after the residence actions.
  - `AUDIT_ENTITIES` gains `'photo'`.

  **`index.ts`:** `export * from './photos.js';`

  **`apps/web/src/trees/format.ts`:** the `Record<AuditAction, string>` of History labels gains:
  - `'photo.create': 'Photo added'`
  - `'photo.primary': 'Main photo changed'`
  - `'photo.delete': 'Photo removed'`

  Also add `formatBytes()`, used by the Photos tab:

```ts
/** 950 B, 12.3 KB, 4.5 MB, 1 GB: decimal units, one decimal below 100. */
export function formatBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  const digits = i === 0 || v >= 100 || Number.isInteger(v) ? 0 : 1;
  return `${v.toFixed(digits)} ${units[i]}`;
}
```

  Add a small test for it in `apps/web/src/trees/format.test.ts`:
  - `formatBytes(950)` is `'950 B'`.
  - `formatBytes(12_345)` is `'12.3 KB'`.
  - `formatBytes(1_073_741_824)` is `'1.1 GB'`.
  - `formatBytes(1_000_000_000)` is `'1 GB'`.

- [ ] **Step 4: Run** the shared tests, the web format test, and `pnpm typecheck`. They pass.

- [ ] **Step 5: Commit** `feat(shared): photo limits and schemas, photo audit actions`

---

## Task 3: Shared — relationship path and kinship wording

**Files:**
- Create: `packages/shared/src/kinship.ts`, `packages/shared/src/kinship.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing `kinship.test.ts`.** It builds one family, with ids as plain strings (the pure functions don't validate them):

```ts
import { describe, expect, it } from 'vitest';
import {
  closeRelativeSteps,
  type KinGraph,
  kinPathsFrom,
  kinshipChain,
  kinshipTerm,
  nth,
  relationshipPath,
} from './kinship.js';
import type { ChildKind, UnionStatus, UnionType } from './people.js';
import type { Sex } from './trees.js';

function family() {
  const g = {
    persons: [] as { id: string; sex: Sex }[],
    unions: [] as KinGraph['unions'][number][],
    parentChild: [] as KinGraph['parentChild'][number][],
  };
  let n = 0;
  const people = (map: Record<string, Sex>) => {
    for (const [id, sex] of Object.entries(map)) g.persons.push({ id, sex });
  };
  const union = (
    id: string,
    a: string | null,
    b: string | null,
    kids: (string | [string, ChildKind])[] = [],
    type: UnionType = 'marriage',
    status: UnionStatus = 'married',
  ) => {
    g.unions.push({ id, partnerAId: a, partnerBId: b, type, status });
    for (const k of kids) {
      const [childId, kind] = Array.isArray(k) ? k : [k, 'biological' as const];
      g.parentChild.push({ id: `l${++n}`, unionId: id, childId, kind });
    }
  };
  return { g, people, union };
}

// "me" is a woman; her father's family has two generations above, her husband's family one.
const { g, people, union } = family();
people({
  ggp: 'male', gp: 'male', gm: 'female', gpBro: 'male', pc: 'female', sc: 'male', scKid: 'female',
  dad: 'male', mum: 'female', aunt: 'female', auntHus: 'male', cousin: 'male', cw: 'female',
  cKid: 'female', me: 'female', sis: 'female', sisHus: 'male', niece: 'female', nx: 'unknown',
  gniece: 'female', ex: 'female', halfBro: 'male', hbKid: 'male', hus: 'male', hf: 'male',
  hm: 'female', hsis: 'female', hsx: 'other', son: 'male', dil: 'female', grandson: 'male',
  kid2: 'unknown', foster: 'male', stepdad: 'male', sw: 'female', stepsis: 'female', lone: 'male',
});
union('U_gg', 'ggp', null, ['gp', 'gpBro']);
union('U_gb', 'gpBro', null, ['pc']);
union('U_pc', 'pc', null, ['sc']);
union('U_sc', 'sc', null, ['scKid']);
union('U_g', 'gp', 'gm', ['dad', 'aunt']);
union('U_au', 'aunt', 'auntHus', ['cousin']);
union('U_c', 'cousin', 'cw', ['cKid']);
union('U_dm', 'dad', 'mum', ['me', 'sis']);
union('U_dx', 'dad', 'ex', ['halfBro'], 'marriage', 'divorced');
union('U_hb', 'halfBro', null, ['hbKid']);
union('U_sh', 'sis', 'sisHus', ['niece']);
union('U_nx', 'niece', 'nx', ['gniece'], 'partnership', 'partners');
union('U_mh', 'me', 'hus', ['son', ['kid2', 'adoptive'], ['foster', 'foster']]);
union('U_h', 'hf', 'hm', ['hus', 'hsis']);
union('U_hs', 'hsis', 'hsx', [], 'partnership', 'separated');
union('U_sd', 'son', 'dil', ['grandson']);
union('U_ms', 'mum', 'stepdad', [], 'partnership', 'partners');
union('U_ss', 'stepdad', 'sw', ['stepsis']);

const fromMe = kinPathsFrom(g, 'me');

describe('kinship from "me"', () => {
  it.each([
    ['dad', 'father', 'your father'],
    ['sis', 'sister', 'your sister'],
    ['halfBro', 'half-brother', 'your half-brother'],
    ['gp', 'grandfather', 'your father’s father'],
    ['ggp', 'great-grandfather', 'your father’s father’s father'],
    ['aunt', 'aunt', 'your father’s sister'],
    ['auntHus', 'uncle by marriage', 'your father’s sister’s husband'], // spec §6's example
    ['cousin', 'first cousin', 'your father’s sister’s son'],
    ['cKid', 'first cousin once removed', 'your father’s sister’s son’s daughter'],
    ['gpBro', 'great-uncle', 'your father’s father’s brother'],
    ['sc', 'second cousin', 'your father’s father’s brother’s daughter’s son'],
    ['scKid', 'second cousin once removed', 'your father’s father’s brother’s daughter’s son’s daughter'],
    ['niece', 'niece', 'your sister’s daughter'],
    ['gniece', 'great-niece', 'your sister’s daughter’s daughter'],
    ['nx', null, 'your sister’s daughter’s partner'],
    ['sisHus', 'brother-in-law', 'your sister’s husband'],
    ['hus', 'husband', 'your husband'],
    ['hm', 'mother-in-law', 'your husband’s mother'],
    ['hsis', 'sister-in-law', 'your husband’s sister'],
    ['hsx', null, 'your husband’s sister’s former partner'],
    ['son', 'son', 'your son'],
    ['kid2', 'adopted child', 'your adopted child'],
    ['foster', 'foster son', 'your foster son'],
    ['dil', 'daughter-in-law', 'your son’s wife'],
    ['grandson', 'grandson', 'your son’s son'],
    ['stepdad', 'stepfather', 'your mother’s partner'],
    ['stepsis', 'stepsister', 'your mother’s partner’s daughter'],
    ['ex', 'former stepmother', 'your father’s former wife'],
  ])('%s is my %s', (to, term, chain) => {
    const steps = fromMe(to)!;
    expect(kinshipTerm(steps)).toBe(term);
    expect(kinshipChain(steps, 'your')).toBe(chain);
  });

  it('finds no path to an unconnected person, and an empty one to myself', () => {
    expect(fromMe('lone')).toBeNull();
    expect(fromMe('me')).toEqual([]);
    expect(kinshipTerm([])).toBeNull();
  });
});

describe('kinship in other directions', () => {
  it.each([
    ['halfBro', 'me', 'half-sister'],
    ['cKid', 'me', 'first cousin once removed'],
    ['ex', 'me', 'former stepdaughter'],
    ['grandson', 'dad', 'great-grandfather'],
    ['sc', 'dad', 'first cousin once removed'],
    ['son', 'auntHus', 'great-uncle by marriage'],
    ['niece', 'hbKid', 'half first cousin'],
    ['hbKid', 'sis', 'half-aunt'],
  ])('%s → %s is %s', (from, to, term) => {
    expect(kinshipTerm(relationshipPath(g, from, to)!)).toBe(term);
  });

  it('words the chain from someone else’s side', () => {
    expect(kinshipChain(relationshipPath(g, 'son', 'auntHus')!, 'Leo’s')).toBe(
      'Leo’s mother’s father’s sister’s husband',
    );
  });

  it('uses neutral words for other or unknown sex, and numbered greats beyond two', () => {
    const { g: line, people: ps, union: u } = family();
    ps({ a0: 'unknown', a1: 'male', a2: 'unknown', a3: 'male', a4: 'unknown', a5: 'male' });
    for (let i = 1; i <= 5; i++) u(`x${i}`, `a${i}`, null, [`a${i - 1}`]);
    expect(kinshipTerm(relationshipPath(line, 'a0', 'a5')!)).toBe('3rd great-grandfather');
    expect(kinshipTerm(relationshipPath(line, 'a5', 'a0')!)).toBe('3rd great-grandchild');
    expect(kinshipTerm(relationshipPath(line, 'a3', 'a2')!)).toBe('child');
    expect(kinshipTerm(fromMe('nx')!.slice(0, 3))).toBe('niece'); // the path prefix still words
  });

  it('formats ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 111].map(nth).join(' ')).toBe(
      '1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 111th',
    );
  });
});

describe('the path itself', () => {
  it('is a shortest path, deterministic, with union and link ids', () => {
    const steps = fromMe('cousin')!;
    expect(steps.map((s) => s.move)).toEqual(['parent', 'parent', 'child', 'child']);
    expect(steps.map((s) => s.personId)).toEqual(['dad', 'gm', 'aunt', 'cousin']); // gm sorts before gp
    expect(steps[0]).toMatchObject({ unionId: 'U_dm', kind: 'biological', unionType: null });
    expect(fromMe('hus')![0]).toMatchObject({
      move: 'partner',
      unionId: 'U_mh',
      linkId: null,
      unionType: 'marriage',
      unionStatus: 'married',
    });
    expect(relationshipPath(g, 'me', 'cousin')).toEqual(steps);
  });

  it('ignores links to people or unions that are not in the graph', () => {
    const { g: h, people: ps, union: u } = family();
    ps({ a: 'male', b: 'female' });
    u('U', 'a', 'ghost', ['b']);
    expect(relationshipPath(h, 'b', 'a')!.map((s) => s.personId)).toEqual(['a']);
    expect(relationshipPath(h, 'a', 'ghost')).toBeNull();
  });

  it('counts close-relative steps like the focus view (half-siblings are two)', () => {
    expect(closeRelativeSteps(fromMe('sis')!)).toBe(1);
    expect(closeRelativeSteps(fromMe('halfBro')!)).toBe(2);
    expect(closeRelativeSteps(fromMe('auntHus')!)).toBe(3);
    expect(closeRelativeSteps(fromMe('scKid')!)).toBe(6);
  });
});
```

- [ ] **Step 2: Run it; it fails** (no module).

- [ ] **Step 3: Implement `kinship.ts`.** This code was run against the cases above while the plan was written; keep it as it is.

```ts
import { z } from 'zod';
import {
  type ChildKind,
  CHILD_KINDS,
  type UnionStatus,
  UNION_STATUSES,
  type UnionType,
  UNION_TYPES,
} from './people.js';
import { type Sex, SEXES } from './trees.js';

export const KIN_MOVES = ['parent', 'child', 'partner'] as const;
export type KinMove = (typeof KIN_MOVES)[number];

/** One step of a relationship path: from the previous person to `personId` (decision 20). */
export const kinStepSchema = z.object({
  move: z.enum(KIN_MOVES),
  personId: z.uuid(),
  sex: z.enum(SEXES),
  /** parent/child: the union the child belongs to; partner: the couple's union. */
  unionId: z.uuid(),
  /** parent and child moves only. */
  linkId: z.uuid().nullable(),
  kind: z.enum(CHILD_KINDS).nullable(),
  /** partner moves only. */
  unionType: z.enum(UNION_TYPES).nullable(),
  unionStatus: z.enum(UNION_STATUSES).nullable(),
});
export type KinStep = z.infer<typeof kinStepSchema>;

/** What pathfinding needs. The API's GraphRows fits as is; a web TreeGraph with links → parentChild. */
export interface KinGraph {
  persons: readonly { id: string; sex: Sex }[];
  unions: readonly {
    id: string;
    partnerAId: string | null;
    partnerBId: string | null;
    type: UnionType;
    status: UnionStatus;
  }[];
  parentChild: readonly { id: string; unionId: string; childId: string; kind: ChildKind }[];
}

const MOVE_ORDER: Record<KinMove, number> = { parent: 0, child: 1, partner: 2 };

/** Outgoing steps per person: parents first, then children, then partners, each by id. */
function kinEdges(graph: KinGraph): Map<string, KinStep[]> {
  const sex = new Map(graph.persons.map((p) => [p.id, p.sex]));
  const unionById = new Map(graph.unions.map((u) => [u.id, u]));
  const out = new Map<string, KinStep[]>();
  const add = (from: string, step: KinStep) => {
    if (from === step.personId) return;
    const list = out.get(from);
    if (list) list.push(step);
    else out.set(from, [step]);
  };
  for (const l of graph.parentChild) {
    const u = unionById.get(l.unionId);
    const childSex = sex.get(l.childId);
    if (!u || childSex === undefined) continue;
    for (const p of [u.partnerAId, u.partnerBId]) {
      const parentSex = p === null ? undefined : sex.get(p);
      if (p === null || parentSex === undefined) continue;
      const link = { unionId: u.id, linkId: l.id, kind: l.kind, unionType: null, unionStatus: null };
      add(l.childId, { move: 'parent', personId: p, sex: parentSex, ...link });
      add(p, { move: 'child', personId: l.childId, sex: childSex, ...link });
    }
  }
  for (const u of graph.unions) {
    if (u.partnerAId === null || u.partnerBId === null) continue;
    const aSex = sex.get(u.partnerAId);
    const bSex = sex.get(u.partnerBId);
    if (aSex === undefined || bSex === undefined) continue;
    const couple = {
      move: 'partner' as const,
      unionId: u.id,
      linkId: null,
      kind: null,
      unionType: u.type,
      unionStatus: u.status,
    };
    add(u.partnerAId, { ...couple, personId: u.partnerBId, sex: bSex });
    add(u.partnerBId, { ...couple, personId: u.partnerAId, sex: aSex });
  }
  for (const list of out.values()) {
    list.sort(
      (a, b) =>
        MOVE_ORDER[a.move] - MOVE_ORDER[b.move] ||
        (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0),
    );
  }
  return out;
}

/**
 * Shortest paths from `fromId` over parent, child and partner edges, breadth first (spec §6).
 * Returns a lookup: the steps to a person, [] for `fromId` itself, null when not connected.
 */
export function kinPathsFrom(graph: KinGraph, fromId: string): (toId: string) => KinStep[] | null {
  const edges = kinEdges(graph);
  const prev = new Map<string, { from: string; step: KinStep } | null>([[fromId, null]]);
  const queue = [fromId];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const step of edges.get(id) ?? []) {
      if (prev.has(step.personId)) continue;
      prev.set(step.personId, { from: id, step });
      queue.push(step.personId);
    }
  }
  return (toId) => {
    if (!prev.has(toId)) return null;
    const steps: KinStep[] = [];
    for (let at = prev.get(toId); at; at = prev.get(at.from)) steps.unshift(at.step);
    return steps;
  };
}

export const relationshipPath = (graph: KinGraph, fromId: string, toId: string) =>
  kinPathsFrom(graph, fromId)(toId);

// ---- English wording (decision 21). The only place kinship words live. ----

const bySex = (sex: Sex, male: string, female: string, neutral: string) =>
  sex === 'male' ? male : sex === 'female' ? female : neutral;

const ORDINAL_WORDS = [
  'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
];
/** 1st, 2nd, 3rd, 4th, 11th, 21st … */
export function nth(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}
const ordinal = (n: number) => ORDINAL_WORDS[n - 1] ?? nth(n);
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
/** "", "great-", "great-great-", then "3rd great-" … */
const greats = (n: number) => (n <= 0 ? '' : n <= 2 ? 'great-'.repeat(n) : `${nth(n)} great-`);

/** One step, or a sibling: a parent step followed by a child step. */
type Chunk =
  | { kind: 'parent' | 'child' | 'partner'; step: KinStep }
  | { kind: 'sibling'; step: KinStep; half: boolean };

function chunksOf(steps: readonly KinStep[]): Chunk[] {
  const out: Chunk[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const next = steps[i + 1];
    if (s.move === 'parent' && next?.move === 'child') {
      // Children of the same union are full siblings; through different unions, half.
      out.push({ kind: 'sibling', step: next, half: s.unionId !== next.unionId });
      i++;
    } else out.push({ kind: s.move, step: s });
  }
  return out;
}

/** Steps as the focus view counts them (Phase 5 decision 2): a half-sibling is two. */
export const closeRelativeSteps = (steps: readonly KinStep[]) =>
  chunksOf(steps).reduce((n, c) => n + (c.kind === 'sibling' && c.half ? 2 : 1), 0);

function parentWord(s: KinStep): string {
  const base = bySex(s.sex, 'father', 'mother', 'parent');
  if (s.kind === 'step') return bySex(s.sex, 'stepfather', 'stepmother', 'step-parent');
  if (s.kind === 'adoptive') return `adoptive ${base}`;
  if (s.kind === 'foster') return `foster ${base}`;
  return base;
}
function childWord(s: KinStep): string {
  const base = bySex(s.sex, 'son', 'daughter', 'child');
  if (s.kind === 'step') return bySex(s.sex, 'stepson', 'stepdaughter', 'stepchild');
  if (s.kind === 'adoptive') return `adopted ${base}`;
  if (s.kind === 'foster') return `foster ${base}`;
  return base;
}
function partnerWord(s: KinStep): string {
  const base = s.unionType === 'marriage' ? bySex(s.sex, 'husband', 'wife', 'spouse') : 'partner';
  return s.unionStatus === 'divorced' || s.unionStatus === 'separated' ? `former ${base}` : base;
}
function chunkWord(c: Chunk): string {
  switch (c.kind) {
    case 'parent':
      return parentWord(c.step);
    case 'child':
      return childWord(c.step);
    case 'partner':
      return partnerWord(c.step);
    case 'sibling':
      return `${c.half ? 'half-' : ''}${bySex(c.step.sex, 'brother', 'sister', 'sibling')}`;
  }
}

/** "your father’s sister’s husband": the path in everyday words, from `possessive`’s side. */
export function kinshipChain(steps: readonly KinStep[], possessive: string): string {
  return `${possessive} ${chunksOf(steps).map(chunkWord).join('’s ')}`;
}

/** Blood relatives: `up` generations to the common ancestor, then `down` (not both 0). */
function bloodTerm(up: number, down: number, sex: Sex, half: boolean): string {
  const g = (male: string, female: string) => bySex(sex, male, female, `${female} or ${male}`);
  if (down === 0) return `${greats(up - 2)}grand${bySex(sex, 'father', 'mother', 'parent')}`;
  if (up === 0) return `${greats(down - 2)}grand${bySex(sex, 'son', 'daughter', 'child')}`;
  if (up === 1 && down === 1) {
    return `${half ? 'half-' : ''}${bySex(sex, 'brother', 'sister', 'sibling')}`;
  }
  if (down === 1 || up === 1) {
    const n = Math.max(up, down) - 2;
    const word =
      down === 1
        ? g(`${greats(n)}uncle`, `${greats(n)}aunt`)
        : g(`${greats(n)}nephew`, `${greats(n)}niece`);
    return half ? `${n > 0 ? 'half ' : 'half-'}${word}` : word;
  }
  const removed = Math.abs(up - down);
  const cousin = `${ordinal(Math.min(up, down) - 1)} cousin`;
  return `${half ? 'half ' : ''}${cousin}${removed ? ` ${times(removed)} removed` : ''}`;
}

const patternOf = (steps: readonly KinStep[]) =>
  steps.map((s) => (s.move === 'parent' ? 'U' : s.move === 'child' ? 'D' : 'P')).join('');

/**
 * The usual English name for the relationship ("second cousin once removed", "mother-in-law",
 * "uncle by marriage"), or null when English has none and only the chain describes it.
 */
export function kinshipTerm(steps: readonly KinStep[]): string | null {
  const last = steps.at(-1);
  if (!last) return null;
  if (steps.length === 1) return chunkWord({ kind: last.move, step: last });
  const sex = last.sex;
  const pattern = patternOf(steps);
  const blood = pattern.match(/^(U*)(D*)$/);
  if (blood) {
    const up = blood[1]!.length;
    const down = blood[2]!.length;
    const half = up > 0 && down > 0 && steps[up - 1]!.unionId !== steps[up]!.unionId;
    return bloodTerm(up, down, sex, half);
  }
  const term = relationByMarriage(pattern, sex);
  if (term === null) return null;
  // A divorce or separation on the way makes it a former relationship.
  const ended = steps.some(
    (s) => s.move === 'partner' && (s.unionStatus === 'divorced' || s.unionStatus === 'separated'),
  );
  return ended ? `former ${term}` : term;
}

/** In-laws, step-relatives and aunts or uncles by marriage: one partner step on the way. */
function relationByMarriage(pattern: string, sex: Sex): string | null {
  const word = (male: string, female: string, neutral: string) => bySex(sex, male, female, neutral);
  switch (pattern) {
    case 'PU':
      return word('father-in-law', 'mother-in-law', 'parent-in-law');
    case 'DP':
      return word('son-in-law', 'daughter-in-law', 'child-in-law');
    case 'PUD':
    case 'UDP':
      return word('brother-in-law', 'sister-in-law', 'sibling-in-law');
    case 'UP':
      return word('stepfather', 'stepmother', 'step-parent');
    case 'PD':
      return word('stepson', 'stepdaughter', 'stepchild');
    case 'UPD':
      return word('stepbrother', 'stepsister', 'step-sibling');
  }
  const byMarriage = pattern.match(/^(U{2,})DP$/);
  if (byMarriage) {
    const g = greats(byMarriage[1]!.length - 2);
    return `${word(`${g}uncle`, `${g}aunt`, `${g}aunt or ${g}uncle`)} by marriage`;
  }
  return null;
}
```

  Two things to know about this code:
  - A "UP" path (a parent's partner) is always a step-parent. If that partner were also a parent, the one-step path would be shorter, so BFS would have found it instead.
  - The same goes for "PD" (a partner's child) and "UPD" (a step-sibling).

  **`index.ts`:** `export * from './kinship.js';`

- [ ] **Step 4: Run it; it passes.** Run `pnpm --filter @family-tree/shared typecheck` too.

- [ ] **Step 5: Commit** `feat(shared): relationship path (BFS) and English kinship wording`

---

## Task 4: Shared — search and relationship schemas, photos in the person view and graph

**Files:**
- Create: `packages/shared/src/search.ts`, `packages/shared/src/search.test.ts`
- Modify: `packages/shared/src/people.ts`, `packages/shared/src/graph.ts`, `packages/shared/src/index.ts`
- Modify (compile fixes only): `apps/api/src/trees/person-view.ts`, `apps/api/src/trees/graph-view.ts`, `apps/web/src/canvas/test-fixtures.ts`, `apps/web/src/test/fake-trees.ts`

- [ ] **Step 1: Write the failing `search.test.ts`:**

```ts
import { describe, expect, it } from 'vitest';
import { searchQuerySchema } from './search.js';

const ok = (q: Record<string, unknown>) => searchQuerySchema.safeParse(q);

describe('searchQuerySchema (decision 18)', () => {
  it('needs a name or a filter', () => {
    expect(ok({}).success).toBe(false);
    expect(ok({ q: '   ' }).success).toBe(false);
    expect(ok({ q: 'hale' }).success).toBe(true);
    expect(ok({ status: 'deceased' }).success).toBe(true);
    expect(ok({ place: 'Leeds' }).success).toBe(true);
  });
  it('treats blank query-string values as not given', () => {
    expect(searchQuerySchema.parse({ q: 'x', bornFrom: '', status: '', branch: '', place: '' })).toEqual({
      q: 'x',
      limit: 20,
    });
  });
  it('coerces years and limits, and checks ranges', () => {
    expect(searchQuerySchema.parse({ bornFrom: '1900', bornTo: '1950', limit: '5' })).toMatchObject({
      bornFrom: 1900,
      bornTo: 1950,
      limit: 5,
    });
    expect(ok({ bornFrom: 1950, bornTo: 1900 }).success).toBe(false);
    expect(ok({ diedFrom: 2000, diedTo: 1990 }).success).toBe(false);
    expect(ok({ q: 'x', limit: 51 }).success).toBe(false);
    expect(ok({ q: 'x', status: 'zombie' }).success).toBe(false);
    expect(ok({ q: 'x', branch: 'not-a-uuid' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it; it fails.**

- [ ] **Step 3: Implement `search.ts`:**

```ts
import { z } from 'zod';
import { kinStepSchema } from './kinship.js';
import { PLACE_MAX } from './people.js';
import { NAME_MAX, personSummarySchema, SEXES } from './trees.js';

export const SEARCH_LIMIT = 20;
export const SEARCH_LIMIT_MAX = 50;
export const SEARCH_WORDS_MAX = 5;
export const PERSON_STATUSES = ['living', 'deceased'] as const;

const blank = (v: string | undefined) => (v === '' ? undefined : v);
// An empty field in a query string means "not given" (as in similarQuerySchema).
const year = z
  .union([z.literal('').transform(() => undefined), z.coerce.number<number | string>().int().min(1).max(9999)])
  .optional();
const ordered = (a: number | undefined, b: number | undefined) =>
  a === undefined || b === undefined || a <= b;

/** GET /trees/:id/search (decision 18). */
export const searchQuerySchema = z
  .object({
    q: z.string().trim().max(NAME_MAX * 2).optional().transform(blank),
    bornFrom: year,
    bornTo: year,
    diedFrom: year,
    diedTo: year,
    place: z.string().trim().max(PLACE_MAX).optional().transform(blank),
    status: z.union([z.literal('').transform(() => undefined), z.enum(PERSON_STATUSES)]).optional(),
    branch: z.union([z.literal('').transform(() => undefined), z.uuid()]).optional(),
    limit: z.coerce.number<number | string>().int().min(1).max(SEARCH_LIMIT_MAX).default(SEARCH_LIMIT),
  })
  .refine(
    (v) =>
      [v.q, v.bornFrom, v.bornTo, v.diedFrom, v.diedTo, v.place, v.status, v.branch].some(
        (x) => x !== undefined,
      ),
    { message: 'Type a name or choose a filter', path: ['q'] },
  )
  .refine((v) => ordered(v.bornFrom, v.bornTo), { message: 'From must not be after to', path: ['bornTo'] })
  .refine((v) => ordered(v.diedFrom, v.diedTo), { message: 'From must not be after to', path: ['diedTo'] });
export type SearchQuery = z.input<typeof searchQuerySchema>;
export type ParsedSearchQuery = z.output<typeof searchQuerySchema>;

export const searchResultSchema = personSummarySchema.extend({
  photoThumbUrl: z.string().nullable(),
  /** From the signed-in user's own card: [] for that card, null if not connected or no card. */
  relation: z.array(kinStepSchema).nullable(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;
export const searchResponseSchema = z.object({ results: z.array(searchResultSchema) });

/** GET /trees/:id/relationship (decision 20). */
export const relationshipQuerySchema = z.object({ from: z.uuid(), to: z.uuid() });
export const relationshipPersonSchema = personSummarySchema.extend({
  sex: z.enum(SEXES),
  photoThumbUrl: z.string().nullable(),
});
export type RelationshipPerson = z.infer<typeof relationshipPersonSchema>;
export const relationshipSchema = z.object({
  /** [] for the same person, null when not connected. */
  steps: z.array(kinStepSchema).nullable(),
  /** `from`, then each step's person, in path order. */
  persons: z.array(relationshipPersonSchema),
});
export type Relationship = z.infer<typeof relationshipSchema>;
```

  **`people.ts`:** `personViewSchema` gains two fields, after `residences`:
  - `photos: z.array(photoSchema)`, primary first, then newest;
  - `photoUsage: photoUsageSchema`.

  Import them from `./photos.js`. There is no cycle, because `photos.ts` imports only zod.

  **`graph.ts`:** `graphPersonSchema` gains `photoThumbUrl: z.string().nullable()`, with the comment "Signed URL of the primary photo's thumbnail (decision 17)".

  **`index.ts`:** `export * from './search.js';`

  **Compile fixes**, keeping behaviour the same until the real tasks:
  - `apps/api/src/trees/person-view.ts`: return `photos: []` and `photoUsage: { usedBytes: 0, limitBytes: 0 }`. Task 9 fills them in.
  - `apps/api/src/trees/graph-view.ts`: each person gets `photoThumbUrl: null`. Task 10 fills it in.
  - `apps/web/src/canvas/test-fixtures.ts` and every `GraphPerson` the web fake builds: add `photoThumbUrl: null`.
  - Every `PersonView` the web fake builds: add `photos: []` and `photoUsage: { usedBytes: 0, limitBytes: 1_073_741_824 }`.

- [ ] **Step 4: Run** `pnpm typecheck`, `pnpm test` and the API graph/person integration tests. They pass. If an integration test compares whole graph persons or person views with `toEqual`, add the new fields to its expectation.

- [ ] **Step 5: Commit** `feat(shared): search and relationship schemas; photos on person views and graph people`

---
## Task 5: API — config, the object store and signed URLs

**Files:**
- Create: `apps/api/src/storage/objects.ts`, `apps/api/src/storage/objects.int.test.ts`, `apps/api/test/photo-helpers.ts`
- Modify: `apps/api/src/config.ts`, `apps/api/src/config.test.ts`, `apps/api/src/storage/s3.ts`, `apps/api/src/deps.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/src/routes/trees.ts`, `apps/api/test/test-config.ts`, `.env.development`, `.env.production.example`

- [ ] **Step 1: Write the failing config tests** (add to `config.test.ts`, using its existing `base` env helper):
  1. `MAX_PHOTO_BYTES_PER_TREE` defaults to `1_073_741_824`, and `'5000'` parses to `5000`.
  2. `S3_PUBLIC_ENDPOINT` is optional (undefined when absent). `'http://localhost:8333'` parses in development.
  3. **Production** rejects:
     - `S3_PUBLIC_ENDPOINT=http://r2.example.com` ("Must use https in production");
     - `S3_PUBLIC_ENDPOINT=https://localhost:8333` ("Must not point to a local host in production").
     It accepts `https://acc.r2.cloudflarestorage.com`.

- [ ] **Step 2: Implement the config.** In `configSchema`, after `S3_CREATE_BUCKET`:

```ts
    // Where browsers fetch photos from (signed URLs); defaults to S3_ENDPOINT. Differs in dev,
    // where the API reaches SeaweedFS as http://s3:8333 but the browser as http://localhost:8333.
    S3_PUBLIC_ENDPOINT: z.url().optional(),
    // Spec §3: photo storage per tree, in bytes (default 1 GiB).
    MAX_PHOTO_BYTES_PER_TREE: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_099_511_627_776)
      .default(1_073_741_824),
```

  In `superRefine`, check the optional URL like the others:

```ts
    for (const key of ['S3_ENDPOINT', 'S3_PUBLIC_ENDPOINT', 'WEB_ORIGIN', 'AUTH_BASE_URL'] as const) {
      const value = config[key];
      // Field-level errors are already reported; superRefine still runs, so don't throw here.
      if (value === undefined || !URL.canParse(value)) continue;
      const url = new URL(value);
```

  (Keep the rest of the loop body as it is.) Run the config tests; they pass.

- [ ] **Step 3: Env files.**
  - `.env.development` gains `S3_PUBLIC_ENDPOINT=http://localhost:8333`, after `S3_ENDPOINT`.
  - `.env.production.example` gains, after `S3_CREATE_BUCKET`:

```
# Where browsers load photos from (signed URLs, valid 15 minutes). For R2, the same as S3_ENDPOINT.
S3_PUBLIC_ENDPOINT=
# Photo storage per tree in bytes (default 1 GiB).
# MAX_PHOTO_BYTES_PER_TREE=1073741824
```

  - `test/test-config.ts`: add `S3_PUBLIC_ENDPOINT: 'http://localhost:8333'`.

- [ ] **Step 4: `storage/s3.ts`:**

```ts
export function createS3(config: Config, endpoint: string = config.S3_ENDPOINT): S3Client {
  return new S3Client({
    endpoint,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
    // Plain SigV4 works with SeaweedFS and R2; skip the SDK's default CRC32 trailers (decision 8).
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}
```

- [ ] **Step 5: Write the failing `storage/objects.int.test.ts`:**

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../test/test-config.js';
import { loadConfig } from '../config.js';
import { createObjectStore, SIGN_WINDOW_MS } from './objects.js';

const store = createObjectStore(loadConfig());
afterAll(() => store.close());
const key = () => `test/${randomUUID()}/thumb.webp`;
const bytes = new Uint8Array([1, 2, 3, 4, 5]);

describe('ObjectStore against SeaweedFS', () => {
  it('serves a put object through a signed URL, privately cached', async () => {
    const k = key();
    await store.put(k, bytes, 'image/webp');
    const url = await store.signedUrl(k);
    expect(url).toMatch(/^http:\/\/localhost:8333\//);
    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('900');
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('cache-control')).toBe('private, max-age=900');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it('refuses the object without a signature, and with an expired one', async () => {
    const k = key();
    await store.put(k, bytes, 'image/webp');
    const url = new URL(await store.signedUrl(k));
    expect((await fetch(`${url.origin}${url.pathname}`)).status).toBe(403); // the bucket is private
    const old = await store.signedUrl(k, Date.now() - 20 * 60_000);
    expect((await fetch(old)).status).toBe(403);
  });

  it('gives the same URL within a signing window, and a new one in the next', async () => {
    const k = key();
    const t = Math.floor(Date.now() / SIGN_WINDOW_MS) * SIGN_WINDOW_MS + 1000;
    expect(await store.signedUrl(k, t)).toBe(await store.signedUrl(k, t + 60_000));
    expect(await store.signedUrl(k, t)).not.toBe(await store.signedUrl(k, t + SIGN_WINDOW_MS));
  });

  it('signs for the public endpoint while writing through the internal one', async () => {
    const pub = createObjectStore(testConfig({ S3_PUBLIC_ENDPOINT: 'http://127.0.0.1:8333' }));
    try {
      const k = key();
      await pub.put(k, bytes, 'image/webp');
      const url = await pub.signedUrl(k);
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:8333\//);
      expect((await fetch(url)).status).toBe(200);
    } finally {
      pub.close();
    }
  });

  it('deletes idempotently', async () => {
    const k = key();
    await store.put(k, bytes, 'image/webp');
    await store.delete(k);
    await store.delete(k); // already gone: still fine
    expect((await fetch(await store.signedUrl(k))).status).toBe(404);
  });
});
```

  `testConfig` uses the `family-photos-test` bucket, which `global-setup.ts` creates.

  If SeaweedFS 4.00 accepts the **expired** URL (it should answer 403 "Request has expired"):
  - replace that one assertion with a check that `X-Amz-Date` is 20 to 25 minutes old and `X-Amz-Expires` is `900`;
  - add a README limitation ("dev storage doesn't enforce URL expiry; R2 does").

  Don't weaken the unsigned-request assertion.

- [ ] **Step 6: Run it; it fails** (no module).

- [ ] **Step 7: Implement `storage/objects.ts`:**

```ts
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PHOTO_URL_TTL_SECONDS } from '@family-tree/shared';
import type { Config } from '../config.js';
import { createS3 } from './s3.js';

/**
 * Signing time is rounded down to this window (decision 7): one window's URLs for an object are
 * identical, so browsers cache them, and each stays valid 10–15 minutes after it is issued.
 */
export const SIGN_WINDOW_MS = 5 * 60_000;
const CACHE_MAX = 20_000;

export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Idempotent: deleting a missing key succeeds. */
  delete(key: string): Promise<void>;
  /** A GET URL for the browser, valid PHOTO_URL_TTL_SECONDS from the start of `now`'s window. */
  signedUrl(key: string, now?: number): Promise<string>;
  close(): void;
}

/** `s3` is the API's own client (deps); without it the store creates and owns one. */
export function createObjectStore(config: Config, shared?: S3Client): ObjectStore {
  const Bucket = config.S3_BUCKET;
  const s3 = shared ?? createS3(config);
  // Signing is offline, but the host is part of the signature: sign for the browser's endpoint.
  const signer = createS3(config, config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT);
  const cache = new Map<string, { window: number; url: string }>();
  return {
    async put(key, body, contentType) {
      await s3.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: `private, max-age=${PHOTO_URL_TTL_SECONDS}`,
        }),
      );
    },
    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async signedUrl(key, now = Date.now()) {
      const window = Math.floor(now / SIGN_WINDOW_MS) * SIGN_WINDOW_MS;
      const hit = cache.get(key);
      if (hit?.window === window) return hit.url;
      const url = await getSignedUrl(signer, new GetObjectCommand({ Bucket, Key: key }), {
        expiresIn: PHOTO_URL_TTL_SECONDS,
        signingDate: new Date(window),
      });
      if (cache.size >= CACHE_MAX) cache.clear();
      cache.set(key, { window, url });
      return url;
    },
    close() {
      signer.destroy();
      if (!shared) s3.destroy();
    },
  };
}
```

- [ ] **Step 8: Wire it in.**
  - **`deps.ts`:**
    - `const storage = createObjectStore(config, s3);`
    - return `storage`;
    - in `close`, call `storage.close()` before `s3.destroy()`.
  - **`routes/trees.ts`:** `TreeRouteOptions` gains `storage: ObjectStore`.
  - **`app.ts`:**
    - The auth options become `{ auth: Auth; db: Db; storage?: ObjectStore }` (the no-auth branch gains `storage?: undefined`).
    - Inside `buildApp`, before registering the routes:

```ts
  // Tests that don't care about storage get a real store from the config (no network until used).
  const store = auth ? (storage ?? createObjectStore(config)) : undefined;
  if (auth && !storage) app.addHook('onClose', async () => store!.close());
```

      Pass `{ auth, db, config, storage: store! }` to every tree route plugin.

  - **`server.ts`:** `buildApp({ …, storage: deps.storage })`.
  - **`test/photo-helpers.ts`** (used from Task 9 on):

```ts
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/db/client.js';
import { photos } from '../src/db/schema.js';
import type { Deps } from '../src/deps.js';
import { type CookieJar, WEB_ORIGIN } from './auth-helpers.js';

/** Uploads raw image bytes the way the web app does. */
export function upload(
  app: FastifyInstance,
  url: string,
  jar: CookieJar | undefined,
  body: Buffer,
  type = 'image/jpeg',
) {
  return app.inject({
    method: 'POST',
    url,
    headers: { origin: WEB_ORIGIN, 'content-type': type, ...(jar ? { cookie: jar.header() } : {}) },
    payload: body,
  });
}

/** A photo row without objects (for isolation and search tests). */
export async function addPhotoRow(db: Db, treeId: string, personId: string, isPrimary = true) {
  const id = crypto.randomUUID();
  const [row] = await db
    .insert(photos)
    .values({
      id,
      treeId,
      personId,
      storageKeyFull: `trees/${treeId}/photos/${id}/full.webp`,
      storageKeyThumb: `trees/${treeId}/photos/${id}/thumb.webp`,
      width: 10,
      height: 10,
      bytes: 100,
      isPrimary,
    })
    .returning();
  return row!;
}

export async function objectExists(deps: Deps, key: string): Promise<boolean> {
  try {
    await deps.s3.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
    return true;
  } catch {
    return false;
  }
}
```

  (`photos` exists after Task 6. Create this file in Task 6 if the import breaks typecheck now.)

- [ ] **Step 9: Run** the objects test, `config.test.ts`, then `pnpm --filter @family-tree/api typecheck` and `pnpm test:int`. Everything passes.

- [ ] **Step 10: Commit** `feat(api): object store with windowed signed URLs, S3_PUBLIC_ENDPOINT and the photo quota setting`

---

## Task 6: Database — `pg_trgm`, the search column, photos and the deletion outbox

**Files:**
- Create: `apps/api/drizzle/0005_search_extensions.sql` (custom), `apps/api/drizzle/0006_photos_search.sql` (generated), their snapshots and journal entries, `apps/api/src/db/photos-schema.int.test.ts`
- Modify: `apps/api/src/db/schema.ts`

- [ ] **Step 1: The custom migration** for what drizzle-kit can't express:

```bash
pnpm --filter @family-tree/api exec drizzle-kit generate --custom --name search_extensions
```

  Fill the new empty `apps/api/drizzle/0005_search_extensions.sql` with:

```sql
-- Spec §3 search: trigram matching, accent-insensitive. Both extensions ship with Postgres
-- (contrib, present in postgres:17-alpine) and are "trusted", so a database owner can create them.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
-- unaccent() is only STABLE (it reads a dictionary); generated columns and index expressions need
-- IMMUTABLE. Naming the dictionary explicitly makes the result fixed, so the wrapper is safe.
CREATE OR REPLACE FUNCTION family_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
```

- [ ] **Step 2: The schema.** In `schema.ts`:

  **`persons`:** add a column after `siblingOrder`:

```ts
    /** Every name, lower case without accents, for pg_trgm search (decision 18). */
    searchName: text('search_name').generatedAlwaysAs(
      sql`lower(family_unaccent(given_name || ' ' || coalesce(middle_name, '') || ' ' || coalesce(surname, '') || ' ' || coalesce(maiden_name, '') || ' ' || coalesce(nickname, '')))`,
    ),
```

  The column names are written raw on purpose: a generated expression must not be table-qualified. Then add these indexes to the persons table's extras:

```ts
    index('persons_search_name_trgm_idx').using('gin', t.searchName.op('gin_trgm_ops')),
    index('persons_birth_place_trgm_idx').using('gin', t.birthPlace.op('gin_trgm_ops')),
    index('persons_death_place_trgm_idx').using('gin', t.deathPlace.op('gin_trgm_ops')),
```

  **`residences`:** add `index('residences_place_trgm_idx').using('gin', t.place.op('gin_trgm_ops'))`.

  **New tables** (after `residences`):

```ts
/** Spec §3 photos (decision 9). Hidden with their person; the objects live in S3 under the keys. */
export const photos = pgTable(
  'photos',
  {
    /** Set by the API before upload: the storage keys contain it. */
    id: uuid('id').primaryKey(),
    treeId: uuid('tree_id')
      .notNull()
      .references(() => trees.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').notNull(),
    storageKeyFull: text('storage_key_full').notNull(),
    storageKeyThumb: text('storage_key_thumb').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    /** Full plus thumbnail: what counts towards the tree's quota. */
    bytes: integer('bytes').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Cascade: erasing a person (or purging the tree) drops their rows; the outbox has the keys.
    foreignKey({
      name: 'photos_person_fk',
      columns: [t.treeId, t.personId],
      foreignColumns: [persons.treeId, persons.id],
    }).onDelete('cascade'),
    uniqueIndex('photos_one_primary_uq')
      .on(t.personId)
      .where(sql`${t.isPrimary}`),
    index('photos_person_idx').on(t.personId, t.createdAt),
    index('photos_tree_idx').on(t.treeId),
    check('photos_bytes_chk', sql`${t.bytes} > 0 and ${t.width} > 0 and ${t.height} > 0`),
  ],
);

/**
 * Objects to delete from storage (decision 13): written in the transaction that drops the photo
 * rows, removed once the object is gone. No FKs: rows outlive their tree.
 */
export const storageDeletions = pgTable('storage_deletions', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastTriedAt: timestamp('last_tried_at', { withTimezone: true }),
});
```

- [ ] **Step 3: Generate:**

```bash
pnpm --filter @family-tree/api exec drizzle-kit generate --name photos_search
```

  Open `apps/api/drizzle/0006_photos_search.sql` and check:
  - `CREATE TABLE "photos"` and `CREATE TABLE "storage_deletions"`.
  - `ALTER TABLE "persons" ADD COLUMN "search_name" text GENERATED ALWAYS AS (lower(family_unaccent(…))) STORED`.
  - Four `CREATE INDEX … USING gin ("…" gin_trgm_ops)`.
  - The partial unique index (`WHERE "photos"."is_primary"`).
  - The composite FK, created after the table.
  - Nothing touches other tables.

  If drizzle-kit table-qualified the generated expression (`"persons"."given_name"`), edit those references to bare column names.

- [ ] **Step 4: Write `db/photos-schema.int.test.ts`**, in the style of `people-schema.int.test.ts` (`createDeps(loadConfig())`, direct inserts, a fresh tree per test):
  1. **Extensions:** `select extname from pg_extension` includes `pg_trgm` and `unaccent`.
  2. **`search_name`:**
     - A person `José` / middle `María` / `Núñez` / maiden `Pérez` / nickname `Pepe` has `search_name.split(/\s+/).filter(Boolean)` equal to `['jose', 'maria', 'nunez', 'perez', 'pepe']`.
     - Updating `surname` to `Ölund` changes it to contain `olund`.
     - `insert` can't set it: a raw `insert … (search_name) values ('x')` fails with a generated-column error.
  3. **The trigram index is usable:**
     - In a transaction, run `set local enable_seqscan = off`.
     - Then `explain select id from persons where 'jose' <% search_name`.
     - The plan text mentions `persons_search_name_trgm_idx`.
  4. **Photos:**
     - A second `is_primary = true` row for the same person fails (`23505`).
     - A photo whose `person_id` belongs to another tree fails (FK).
     - `bytes = 0` fails the check.
     - Hard-deleting the person removes its photo rows.
     - Deleting the uploading user sets `uploaded_by` to null.
  5. **Outbox:**
     - `insert … on conflict do nothing` of the same key twice leaves one row with `attempts = 0`.
     - Hard-deleting the tree leaves the outbox rows alone.

- [ ] **Step 5: Run it; it passes** (`global-setup.ts` runs the migrations). Then run `pnpm test:int`. Everything passes, because `select()` of persons now includes `searchName`, which no response exposes: `toPersonDetail` and `personFieldsOf` pick fields explicitly.

- [ ] **Step 6: Commit** `feat(db): pg_trgm and unaccent, persons.search_name with trigram indexes, photos and storage_deletions (migrations 0005, 0006)`

---

## Task 7: API — photo processing (sniffing, limits, sharp, EXIF stripping)

**Files:**
- Create: `apps/api/src/photos/process.ts`, `apps/api/src/photos/process.test.ts`, `apps/api/src/photos/limiter.ts`, `apps/api/src/photos/limiter.test.ts`, `apps/api/test/photo-fixtures.ts`

- [ ] **Step 1: Fixtures** — `apps/api/test/photo-fixtures.ts`. They are generated with sharp, so no binary files are committed:

```ts
import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';

/** Written into every EXIF fixture; must never appear in a stored image. */
export const SECRET = 'secret-copyright-marker';
const GPS = {
  GPSLatitudeRef: 'N',
  GPSLatitude: '51/1 30/1 0/1',
  GPSLongitudeRef: 'W',
  GPSLongitude: '0/1 7/1 0/1',
};

const canvas = (width: number, height: number, background = '#3366cc') =>
  sharp({ create: { width, height, channels: 3, background } });

/** A JPEG with camera, copyright and GPS EXIF, optionally with an EXIF orientation. */
export function jpegWithExif({
  width = 400,
  height = 200,
  orientation,
}: { width?: number; height?: number; orientation?: number } = {}) {
  let img = canvas(width, height).jpeg();
  if (orientation) img = img.withMetadata({ orientation });
  return img.withExif({ IFD0: { Copyright: SECRET, Make: 'TestCam' }, IFD3: GPS }).toBuffer();
}
export const png = (w = 300, h = 300) => canvas(w, h, '#cc6633').png().toBuffer();
export const webp = (w = 300, h = 300) => canvas(w, h, '#33cc66').webp().toBuffer();
export const gif = () => canvas(20, 20).gif().toBuffer();

/** A PNG whose header claims width × height but carries no pixels: the decompression-bomb shape. */
export function pngHeaderOnly(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([len, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(0))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
```

- [ ] **Step 2: Write the failing `process.test.ts`:**

```ts
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { gif, jpegWithExif, png, pngHeaderOnly, SECRET, webp } from '../../test/photo-fixtures.js';
import { PhotoRejected, processPhoto, sniffImageFormat } from './process.js';

const rejected = async (p: Promise<unknown>, reason: string) => {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(PhotoRejected);
  expect((err as PhotoRejected).reason).toBe(reason);
};

describe('sniffImageFormat', () => {
  it('reads the magic bytes, not names or headers', async () => {
    expect(sniffImageFormat(await jpegWithExif())).toBe('jpeg');
    expect(sniffImageFormat(await png())).toBe('png');
    expect(sniffImageFormat(await webp())).toBe('webp');
    expect(sniffImageFormat(await gif())).toBeNull();
    expect(sniffImageFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImageFormat(Buffer.from([0xff, 0xd8]))).toBeNull(); // too short
    expect(sniffImageFormat(Buffer.from('RIFF\0\0\0\0WAVE'))).toBeNull();
  });
});

describe('processPhoto (spec §8)', () => {
  it('strips EXIF and GPS: nothing of the original metadata survives', async () => {
    const input = await jpegWithExif();
    expect((await sharp(input).metadata()).exif).toBeDefined(); // the fixture really has it
    const out = await processPhoto(input);
    for (const buf of [out.full, out.thumb]) {
      const m = await sharp(buf).metadata();
      expect(m.format).toBe('webp');
      expect(m.exif).toBeUndefined();
      expect(m.xmp).toBeUndefined();
      expect(m.icc).toBeUndefined();
      expect(buf.includes(Buffer.from(SECRET))).toBe(false);
      expect(buf.includes(Buffer.from('TestCam'))).toBe(false);
    }
  });

  it('applies the EXIF orientation to the pixels', async () => {
    const out = await processPhoto(await jpegWithExif({ width: 400, height: 200, orientation: 6 }));
    expect([out.width, out.height]).toEqual([200, 400]);
    expect((await sharp(out.full).metadata()).orientation).toBeUndefined();
  });

  it('makes a 1600 px full version and a 256 px square thumbnail, never enlarging', async () => {
    const big = await processPhoto(await jpegWithExif({ width: 3200, height: 2400 }));
    expect([big.width, big.height]).toEqual([1600, 1200]);
    const t = await sharp(big.thumb).metadata();
    expect([t.width, t.height]).toEqual([256, 256]);
    const small = await processPhoto(await png(300, 200));
    expect([small.width, small.height]).toEqual([300, 200]);
  });

  it('accepts JPEG, PNG and WebP', async () => {
    for (const input of [await jpegWithExif(), await png(), await webp()]) {
      await expect(processPhoto(input)).resolves.toMatchObject({ width: expect.any(Number) });
    }
  });

  it('refuses other types and disguised files', async () => {
    await rejected(processPhoto(await gif()), 'type');
    await rejected(processPhoto(Buffer.from('just text')), 'type');
    // JPEG magic bytes followed by a PNG body: the decoder disagrees with the sniffed type.
    const disguised = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), await png()]);
    await rejected(processPhoto(disguised), 'unreadable');
  });

  it('refuses decompression bombs before decoding, by the header alone', async () => {
    await rejected(processPhoto(pngHeaderOnly(20_000, 20_000)), 'dimensions'); // 400 MP
    await rejected(processPhoto(pngHeaderOnly(12_001, 100)), 'dimensions'); // a side over 12,000
    await rejected(processPhoto(pngHeaderOnly(7_000, 7_000)), 'unreadable'); // 49 MP: allowed, but no pixels
  });

  it('refuses truncated files', async () => {
    const whole = await jpegWithExif({ width: 800, height: 600 });
    await rejected(processPhoto(whole.subarray(0, whole.length >> 1)), 'unreadable');
  });
});
```

- [ ] **Step 3: Run it; it fails.**

- [ ] **Step 4: Implement `photos/process.ts`:**

```ts
import {
  PHOTO_FULL_SIDE,
  PHOTO_MAX_PIXELS,
  PHOTO_MAX_SIDE,
  PHOTO_THUMB_SIDE,
} from '@family-tree/shared';
import sharp from 'sharp';

// Every upload is a new image: libvips' operation cache would only hold memory.
sharp.cache(false);

export type ImageFormat = 'jpeg' | 'png' | 'webp';

/** The format from the first bytes (spec §8: checked by magic bytes, not name or Content-Type). */
export function sniffImageFormat(b: Uint8Array): ImageFormat | null {
  const at = (offset: number, ...bytes: number[]) => bytes.every((x, i) => b[offset + i] === x);
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return 'jpeg';
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) {
    return 'webp'; // "RIFF" …size… "WEBP"
  }
  return null;
}

export type RejectReason = 'type' | 'dimensions' | 'unreadable';
export class PhotoRejected extends Error {
  override name = 'PhotoRejected';
  constructor(readonly reason: RejectReason) {
    super(`photo rejected: ${reason}`);
  }
}

export interface ProcessedPhoto {
  full: Buffer;
  thumb: Buffer;
  /** Of the full version, after orientation. */
  width: number;
  height: number;
}

const open = (buf: Buffer) =>
  sharp(buf, {
    // libvips refuses larger images in metadata() and when decoding (decision 3).
    limitInputPixels: PHOTO_MAX_PIXELS,
    failOn: 'error',
    animated: false,
    autoOrient: true,
    sequentialRead: true,
  }).timeout({ seconds: 30 });

const reasonOf = (err: unknown): RejectReason =>
  err instanceof Error && /pixel limit/i.test(err.message) ? 'dimensions' : 'unreadable';

/**
 * Re-encodes an upload (decisions 3–4). The output is WebP with no metadata at all: sharp writes
 * no EXIF (so no GPS), XMP or ICC unless asked to, and autoOrient turns the EXIF orientation into
 * pixels first. Type, size and dimensions are checked before any pixels are decoded.
 */
export async function processPhoto(buf: Buffer): Promise<ProcessedPhoto> {
  const format = sniffImageFormat(buf);
  if (!format) throw new PhotoRejected('type');
  let meta: sharp.Metadata;
  try {
    meta = await open(buf).metadata();
  } catch (err) {
    throw new PhotoRejected(reasonOf(err));
  }
  if (meta.format !== format) throw new PhotoRejected('unreadable');
  const { width, height } = meta;
  if (
    !width ||
    !height ||
    width > PHOTO_MAX_SIDE ||
    height > PHOTO_MAX_SIDE ||
    width * height > PHOTO_MAX_PIXELS
  ) {
    throw new PhotoRejected('dimensions');
  }
  try {
    const full = await open(buf)
      .resize({ width: PHOTO_FULL_SIDE, height: PHOTO_FULL_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    const thumb = await open(buf)
      .resize({ width: PHOTO_THUMB_SIDE, height: PHOTO_THUMB_SIDE, fit: 'cover', position: 'attention' })
      .webp({ quality: 78 })
      .toBuffer();
    return { full: full.data, thumb, width: full.info.width, height: full.info.height };
  } catch (err) {
    throw new PhotoRejected(reasonOf(err));
  }
}
```

  The "disguised" case: sharp detects the format from content too. A JPEG header followed by a PNG body is read as a broken JPEG and fails to decode, so it is `unreadable`. A file whose sniffed type and decoder type differ is also `unreadable`, never silently accepted.

- [ ] **Step 5: `photos/limiter.ts`** and its test:

```ts
/** Runs at most `n` jobs at once; the rest wait in order (decision 3). */
export function limiter(n: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(job: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await job();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
```

  `limiter.test.ts`:
  - Start 5 jobs on `limiter(2)`, each awaiting a deferred promise you control.
  - Assert that at most 2 run at a time (track a counter), and that they finish in order.
  - A rejecting job releases its slot.

- [ ] **Step 6: Run both tests; they pass.** sharp runs locally in the unit suite, so `pnpm test` covers it without Docker.

- [ ] **Step 7: Commit** `feat(api): photo processing with magic-byte sniffing, size and pixel limits, EXIF/GPS stripping (verified)`

---

## Task 8: API — the deletion outbox, Trash erase and the tree purge free photo objects

**Files:**
- Create: `apps/api/src/storage/deletions.ts`, `apps/api/src/storage/deletions.int.test.ts`
- Modify: `apps/api/src/trees/purge.ts`, `apps/api/src/trees/purge-cli.ts`, `apps/api/src/trees/purge.int.test.ts`, `apps/api/src/trees/trash.ts`, `apps/api/src/routes/trash.ts`, `apps/api/src/routes/trash.int.test.ts`, `apps/api/src/server.ts`

- [ ] **Step 1: Implement `storage/deletions.ts`:**

```ts
import { asc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import type { Db, Queryable } from '../db/client.js';
import { photos, storageDeletions } from '../db/schema.js';
import { safeError } from '../errors.js';
import type { ObjectStore } from './objects.js';

interface Log {
  error(obj: object, msg: string): void;
}

/** Queues keys for deletion; call inside the transaction that drops their rows (decision 13). */
export async function queueObjectDeletes(db: Queryable, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  await db
    .insert(storageDeletions)
    .values(keys.map((key) => ({ key })))
    .onConflictDoNothing();
}

/** Queues both objects of every photo matching `where`, before a cascade drops the rows. */
export async function queuePhotoObjects(db: Queryable, where: SQL): Promise<string[]> {
  const rows = (await db.execute(sql`
    insert into ${storageDeletions} (key)
    select v.key from ${photos}
      cross join lateral (values (${photos.storageKeyFull}), (${photos.storageKeyThumb})) as v(key)
      where ${where}
    on conflict do nothing
    returning key`)) as unknown as { key: string }[];
  return rows.map((r) => r.key);
}

/**
 * Deletes queued objects, oldest first (or only `keys`), and drops their rows. A failure stays
 * queued with attempts + 1, for the next run. Call after the queueing transaction committed.
 */
export async function drainStorageDeletions(
  db: Db,
  store: ObjectStore,
  { keys, limit = 500, log }: { keys?: readonly string[]; limit?: number; log?: Log } = {},
): Promise<{ deleted: number; failed: number }> {
  if (keys?.length === 0) return { deleted: 0, failed: 0 };
  const rows = await db
    .select({ key: storageDeletions.key })
    .from(storageDeletions)
    .where(keys ? inArray(storageDeletions.key, [...keys]) : undefined)
    .orderBy(asc(storageDeletions.createdAt))
    .limit(limit);
  let deleted = 0;
  let failed = 0;
  for (const { key } of rows) {
    try {
      await store.delete(key);
      await db.delete(storageDeletions).where(eq(storageDeletions.key, key));
      deleted++;
    } catch (err) {
      failed++;
      await db
        .update(storageDeletions)
        .set({ attempts: sql`${storageDeletions.attempts} + 1`, lastTriedAt: sql`now()` })
        .where(eq(storageDeletions.key, key));
      log?.error({ err: safeError(err) }, 'storage delete failed; queued for retry');
    }
  }
  return { deleted, failed };
}
```

  Deletes run one key at a time on purpose. Families have few photos per erase, the purge job keeps draining, and `DeleteObject` needs no checksum (decision 8).

- [ ] **Step 2: Write the failing `storage/deletions.int.test.ts`:**
  1. Put two objects through `deps.storage`, queue both keys, then `drainStorageDeletions(db, deps.storage, { keys })`:
     - the result is `{ deleted: 2, failed: 0 }`;
     - `objectExists` is false for both;
     - the outbox has no rows for them.
  2. **A failing store** (`{ ...deps.storage, delete: () => Promise.reject(new Error('down')) }`):
     - draining a queued key gives `{ deleted: 0, failed: 1 }`;
     - the row stays with `attempts = 1` and `last_tried_at` set;
     - the log spy got one error;
     - a later drain with the real store removes it.
  3. `queuePhotoObjects(db, eq(photos.personId, p.id))` for a person with two photo rows returns their four keys, and queueing again returns `[]` (already queued).
  4. Draining with no `keys` takes the oldest first and respects `limit`.

  Use unique key prefixes per test, and clean up any outbox rows left at the end.

- [ ] **Step 3: Run it; it passes** once Step 1 is in.

- [ ] **Step 4: The purge queues before the cascade.** In `purgeDeletedTrees`, replace the single `delete … where id in (select … for update skip locked)` with:

```ts
      const rows = (await tx.execute(sql`
        select id from ${trees}
        where deleted_at is not null
          and deleted_at < now() - make_interval(days => ${TREE_RESTORE_DAYS})
        order by deleted_at
        limit ${BATCH}
        for update skip locked
      `)) as unknown as { id: string }[];
      const batchIds = rows.map((r) => r.id);
      if (batchIds.length === 0) return [];
      // The rows are locked, so a concurrent restore waits and then finds nothing to restore.
      // Photo objects outlive their rows: queue them before the cascade (decision 13).
      await queuePhotoObjects(tx, inArray(photos.treeId, batchIds));
      await tx.delete(trees).where(inArray(trees.id, batchIds));
      return batchIds;
```

  Update the function's doc comment: "Queues the purged trees' photo objects in the outbox; `drainStorageDeletions` deletes them."

  **`startPurgeJob(db, log, intervalMs, store?)`:** after the purge in each tick, when `store` is given, drain the whole outbox in rounds:

```ts
    current = purgeDeletedTrees(db)
      .then(async ({ ids }) => {
        if (ids.length > 0) log.info({ count: ids.length }, 'purged deleted trees');
        if (!store) return;
        for (;;) {
          const { deleted, failed } = await drainStorageDeletions(db, store, { log });
          if (deleted > 0) log.info({ deleted }, 'deleted stored objects');
          if (deleted + failed < 500 || failed > 0) break; // done, or storage is down: next tick
        }
      })
```

  Keep the `.catch` and `.finally`.
  - **`server.ts`:** pass `deps.storage` as the fourth argument.
  - **`purge-cli.ts`:** build `createObjectStore(config)`, drain after the purge, print `Deleted N stored object(s); M failed and will be retried.`, then close the store.

- [ ] **Step 5: Extend `purge.int.test.ts`:**
  1. **A purged tree's photos are freed:**
     - A tree with a person and one photo, whose two objects are real (put through `deps.storage` under `photoKeys`), is aged 31 days.
     - `purgeDeletedTrees(db)` purges it. The outbox now holds both keys, and the objects still exist.
     - `drainStorageDeletions(db, deps.storage)` deletes them (`objectExists` is false).
  2. **The job drains:**
     - `startPurgeJob(db, log, 60_000, deps.storage)` with an aged tree with a photo: after `stop()`, the objects are gone and the outbox is empty.
     - Without a store (the old call), the keys stay queued.
  3. **A restored tree keeps its photos:** a tree restored before the purge runs keeps its photo rows and objects, and nothing is queued.

- [ ] **Step 6: Erase queues before deleting the batch's persons.** In `eraseBatch`, just before `await tx.delete(persons)…`:

```ts
  // Their photos go with them (FK cascade); queue the objects first (decision 13).
  const objectKeys = ids.length > 0 ? await queuePhotoObjects(tx, inArray(photos.personId, ids)) : [];
```

  - `eraseBatch` returns `Promise<string[]>` (`objectKeys`).
  - In `routes/trash.ts`, the erase handler becomes:

```ts
    const keys = await db.transaction(async (tx) => {
      await lockTreeGraph(tx, treeId);
      const access = await loadAccess(tx, treeId, req.user!.id);
      authorize(access, 'trash.erase', TREE);
      return eraseBatch(tx, access, batchId);
    });
    await drainStorageDeletions(db, storage, { keys, log: req.log });
    return reply.code(204).send();
```

  (Destructure `storage` from the plugin options.)

- [ ] **Step 7: Extend `trash.int.test.ts`:**
  1. **Erase frees photos:**
     - A person with a photo (real objects) is deleted into a batch.
     - The person's photo row still exists, hidden.
     - **Erase permanently** returns 204. The photo row is gone, `objectExists` is false for both keys, and the outbox is empty.
  2. **Restore brings photos back:** after deleting and restoring a person with a photo, `GET /persons/:id` lists the photo again. That test fully works after Task 9; write it now with `it.todo`, and fill it in Task 9.
  3. **Erase with storage down:**
     - Build the app with a store whose `delete` rejects. Erase still answers 204 and the rows are gone.
     - The outbox keeps both keys (`attempts = 1`).
     - A later drain with the real store clears them.

- [ ] **Step 8: Run** `pnpm test:int`. Everything passes.

- [ ] **Step 9: Commit** `feat(api): storage deletion outbox; Trash erase and the tree purge free photo objects`

---

## Task 9: API — upload, set primary, delete; photos in the person view

**Files:**
- Create: `apps/api/src/photos/photos.ts`, `apps/api/src/routes/photos.ts`, `apps/api/src/routes/photos.int.test.ts`
- Modify: `apps/api/src/auth/session-guard.ts`, `apps/api/src/app.ts`, `apps/api/src/trees/person-view.ts`, `apps/api/src/routes/persons.ts`, `apps/api/src/routes/isolation.int.test.ts`, `apps/api/src/routes/trash.int.test.ts`

- [ ] **Step 1: `session-guard.ts`** returns a handler that fits both `preHandler` and `onRequest`:

```ts
import type { FastifyReply, FastifyRequest } from 'fastify';
…
/** Rejects requests without a valid session and exposes the user. Usable as onRequest or preHandler. */
export function requireSession(auth: Auth): (req: FastifyRequest, reply: FastifyReply) => Promise<void> {
```

  The body doesn't change. Run `pnpm --filter @family-tree/api typecheck`; the existing `addHook('preHandler', requireSession(auth))` calls still type-check.

- [ ] **Step 2: `photos/photos.ts`**, the helpers shared by routes, views and search:

```ts
import { type Photo, type PhotoUsage } from '@family-tree/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Queryable, Tx } from '../db/client.js';
import { persons, photos, users } from '../db/schema.js';
import { notFound } from '../errors.js';
import type { ObjectStore } from '../storage/objects.js';

export type PhotoRow = typeof photos.$inferSelect;

/** Storage keys (decision 6): only uuids, never names. */
export const photoKeys = (treeId: string, photoId: string) => ({
  full: `trees/${treeId}/photos/${photoId}/full.webp`,
  thumb: `trees/${treeId}/photos/${photoId}/thumb.webp`,
});

/** Serialises every photo write of a tree: quota, primary and the per-person cap (decision 14). */
export const lockTreePhotos = (tx: Tx, treeId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`photos:${treeId}`}, 0))`);

/** Stored bytes of every photo row of the tree, including people in Trash (decision 14). */
export async function photoBytesUsed(db: Queryable, treeId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<string>`coalesce(sum(${photos.bytes}), 0)::bigint` })
    .from(photos)
    .where(eq(photos.treeId, treeId));
  return Number(r?.n ?? 0);
}

export const photoUsage = async (db: Queryable, treeId: string, limitBytes: number): Promise<PhotoUsage> => ({
  usedBytes: await photoBytesUsed(db, treeId),
  limitBytes,
});

/** A photo of a live person of this tree, or 404. */
export async function requireLivePhoto(db: Queryable, treeId: string, photoId: string) {
  const [row] = await db
    .select({ p: photos })
    .from(photos)
    .innerJoin(persons, and(eq(persons.id, photos.personId), isNull(persons.deletedAt)))
    .where(and(eq(photos.treeId, treeId), eq(photos.id, photoId)));
  if (!row) throw notFound();
  return row.p;
}

export async function toPhoto(
  store: ObjectStore,
  r: PhotoRow & { uploadedByName: string | null },
): Promise<Photo> {
  const [thumbUrl, fullUrl] = await Promise.all([
    store.signedUrl(r.storageKeyThumb),
    store.signedUrl(r.storageKeyFull),
  ]);
  return {
    id: r.id,
    width: r.width,
    height: r.height,
    bytes: r.bytes,
    isPrimary: r.isPrimary,
    createdAt: r.createdAt.toISOString(),
    uploadedByName: r.uploadedByName,
    thumbUrl,
    fullUrl,
  };
}

/** A person's photos for the panel: primary first, then newest. The caller checked the person is live. */
export async function loadPhotos(db: Queryable, store: ObjectStore, treeId: string, personId: string) {
  const rows = await db
    .select({ p: photos, uploadedByName: users.name })
    .from(photos)
    .leftJoin(users, eq(users.id, photos.uploadedBy))
    .where(and(eq(photos.treeId, treeId), eq(photos.personId, personId)))
    .orderBy(desc(photos.isPrimary), desc(photos.createdAt));
  return Promise.all(rows.map((r) => toPhoto(store, { ...r.p, uploadedByName: r.uploadedByName })));
}

/** Signed thumbnail URLs for keys (null stays null), in order. */
export const signThumbs = (store: ObjectStore, keys: readonly (string | null)[]) =>
  Promise.all(keys.map((k) => (k === null ? null : store.signedUrl(k))));
```

- [ ] **Step 3: The person view.**
  - `loadPersonView(db, access, personId, store, limitBytes)` sets:
    - `photos: await loadPhotos(db, store, treeId, personId)`;
    - `photoUsage: await photoUsage(db, treeId, limitBytes)`.
  - `routes/persons.ts` passes `storage` and `config.MAX_PHOTO_BYTES_PER_TREE`.

- [ ] **Step 4: Write the failing `routes/photos.int.test.ts`.**

  **Setup:**
  - `buildApp({ config, checks, auth, db, storage: deps.storage })`;
  - `ownerWithTree`, a person, and the `upload()` helper;
  - `base = /api/v1/trees/<tree>/persons/<person>/photos`.

  **Test cases:**
  1. **Upload, EXIF verified end to end:**
     - The owner uploads `jpegWithExif({ orientation: 6 })` and gets 201 `{ photo, usage }`.
     - `photo.isPrimary` is true, the dimensions are `[200, 400]`, and `bytes > 0`.
     - `usage.usedBytes` equals `photo.bytes`, and `usage.limitBytes` is the config value.
     - Fetching `photo.fullUrl` and `photo.thumbUrl` returns 200 `image/webp`.
     - The fetched bytes have `metadata().exif === undefined` and don't contain `SECRET`.
     - The row's keys match `trees/<tree>/photos/<id>/…`.
  2. **PNG and WebP** are accepted, and the second photo is not primary.
  3. **Rejected files:** each answers 400 `VALIDATION` with `details.reason`, and no row or object is left behind (count the photo rows and the outbox before and after):
     - a GIF sent as `image/jpeg`: `type`;
     - `just text` as `image/png`: `type`;
     - a JSON body `{}`: `type`;
     - `image/gif` as the Content-Type: 415, `type`;
     - `pngHeaderOnly(20000, 20000)`: `dimensions`;
     - a truncated JPEG: `unreadable`;
     - a body of 10 MB + 1 byte (a `Buffer.alloc` with JPEG magic bytes): 413, `tooLarge`.
  4. **Body not read for outsiders and viewers:**
     - A non-member uploading 11 MB gets **404**, not 413.
     - A viewer uploading 11 MB gets **403**, not 413.
     - No session gives 401.
  5. **Permissions:** each case checks upload, then set primary and delete on an existing photo, and nothing changes after a refusal:

     | Who | Result |
     |---|---|
     | Owner | 201 / 204 |
     | Editor | 201 / 204 |
     | Viewer | 403 |
     | Steward (viewer base, 2FA) with the person in scope | 201 / 204 |
     | That steward, on a person outside the branch | 403 |
     | A steward without 2FA | 403 |

  6. **Deleted person:**
     - Uploading to a person in Trash gives 404.
     - Their photos are hidden: set primary and delete give 404.
     - After a restore they show in `GET /persons/:id` again. This fills the `it.todo` from Task 8.
  7. **Set primary:**
     - `POST /trees/:t/photos/:id/primary` makes the second photo primary and the first not, and writes `photo.primary` to History.
     - Doing it again is a no-op 204 with no new audit row.
  8. **Delete:**
     - `DELETE /trees/:t/photos/:id` of the primary promotes the newest remaining one.
     - Both objects are deleted (`objectExists` is false) and the outbox is empty.
     - History has `photo.delete` with before `{ width, height, bytes }`.
     - Deleting the last photo leaves none, and there's no error.
  9. **Quota:**
     - With `testConfig({ MAX_PHOTO_BYTES_PER_TREE: String(photo.bytes + 10) })`, the first upload succeeds, and the second gets 403 `QUOTA_EXCEEDED` with no new row and no objects left.
     - People in Trash still count: delete the person with the photo into Trash, and uploading to another person is still refused.
     - After **erase**, it succeeds.
  10. **Per-person cap:** insert 50 photo rows directly (`addPhotoRow`). The next upload gets 400 `tooMany`, and its objects are removed.
  11. **Concurrency:** two uploads at once to a person with no photos end with exactly one primary.
  12. **Person view:** `GET /persons/:id` has `photos`, primary first, with working signed URLs, and `photoUsage`. A viewer sees the same photos.
  13. **Rate limit:** the 31st upload within 10 minutes by one user gets 429. Use a fresh user; process small PNGs.
  14. **Audit hygiene:** no audit row of the tree contains `storage_key` text, `trees/` or `X-Amz-`.

  Add to `isolation.int.test.ts`:
  - In `setup()`, add a photo row (`addPhotoRow(db, treeId, person.id)`), and `ids.photo`.
  - Add to the snapshot: read `db.select().from(photos).where(eq(photos.treeId, treeId))` as `phs`, and add `photos: by(phs.map((x) => ({ id: x.id, isPrimary: x.isPrimary, personId: x.personId })))`.
  - Add the routes:
    - `['POST', `/api/v1/trees/${t}/persons/${ids.person}/photos`]` (a JSON body: the outsider is refused in `onRequest` before parsing);
    - `['POST', `/api/v1/trees/${t}/photos/${ids.photo}/primary`]`;
    - `['DELETE', `/api/v1/trees/${t}/photos/${ids.photo}`]`.
  - Add `ids.photo` to `aIds` in the "tree B authority" test.

- [ ] **Step 5: Run it; it fails.**

- [ ] **Step 6: Implement `routes/photos.ts`:**

```ts
import { randomUUID } from 'node:crypto';
import {
  PHOTO_MEDIA_TYPES,
  PHOTO_UPLOAD_MAX_BYTES,
  PHOTOS_PER_PERSON_MAX,
  type PhotoRejectReason,
} from '@family-tree/shared';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import { persons, photos } from '../db/schema.js';
import { AppError, idParam, notFound } from '../errors.js';
import {
  lockTreePhotos,
  photoBytesUsed,
  photoKeys,
  requireLivePhoto,
  toPhoto,
} from '../photos/photos.js';
import { limiter } from '../photos/limiter.js';
import { PhotoRejected, processPhoto } from '../photos/process.js';
import { extraLimit } from '../security/limits.js';
import { drainStorageDeletions, queueObjectDeletes } from '../storage/deletions.js';
import { type Access, authorize, loadAccess } from '../trees/access.js';
import { audit } from '../trees/audit.js';
import { isLivePerson, requireLivePerson } from '../trees/people.js';
import type { TreeRouteOptions } from './trees.js';

/** At most two photos decode at once per process (decision 3). */
const photoJobs = limiter(2);

export const photoRejected = (reason: PhotoRejectReason) =>
  new AppError('VALIDATION', 400, 'The photo was not accepted', { reason });
const quotaFull = (limitBytes: number) =>
  new AppError('QUOTA_EXCEEDED', 403, 'This tree has used its photo storage', { limitBytes });

export const photosRoutes: FastifyPluginAsync<TreeRouteOptions> = async (
  app,
  { auth, db, config, storage },
) => {
  // onRequest, not preHandler: the upload route decides who may send a body before it is read.
  app.addHook('onRequest', requireSession(auth));

  // Image bytes are the request body (decision 2). Only this plugin's routes accept these types.
  app.addContentTypeParser(
    [...PHOTO_MEDIA_TYPES],
    { parseAs: 'buffer', bodyLimit: PHOTO_UPLOAD_MAX_BYTES },
    (_req, body, done) => done(null, body),
  );

  /** Removes objects of a failed upload now, or queues them if storage refuses. */
  async function discard(keys: string[], log: FastifyRequest['log']) {
    for (const key of keys) {
      try {
        await storage.delete(key);
      } catch {
        await queueObjectDeletes(db, [key]);
        log.warn('upload cleanup queued an object for later deletion');
      }
    }
  }

  const uploads = new WeakMap<FastifyRequest, { access: Access; personId: string }>();

  app.post(
    '/api/v1/trees/:treeId/persons/:personId/photos',
    {
      bodyLimit: PHOTO_UPLOAD_MAX_BYTES,
      // Who may upload is settled before the body is read: outsiders and viewers are never
      // buffered (decision 2). Runs after the plugin's session hook.
      onRequest: [
        extraLimit(app, { name: 'photo-upload', max: 30, timeWindow: '10 minutes', by: 'user' }),
        async (req) => {
          const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
          const person = await requireLivePerson(db, access.treeId, idParam(req.params, 'personId'));
          authorize(access, 'person.edit', { kind: 'person', personId: person.id });
          uploads.set(req, { access, personId: person.id });
        },
      ],
    },
    async (req, reply) => {
      const { access, personId } = uploads.get(req)!;
      const { treeId } = access;
      if (!Buffer.isBuffer(req.body)) throw photoRejected('type');
      const limitBytes = config.MAX_PHOTO_BYTES_PER_TREE;
      if ((await photoBytesUsed(db, treeId)) >= limitBytes) throw quotaFull(limitBytes);

      let processed;
      try {
        processed = await photoJobs(() => processPhoto(req.body as Buffer));
      } catch (err) {
        if (err instanceof PhotoRejected) throw photoRejected(err.reason);
        throw err;
      }
      const id = randomUUID();
      const keys = photoKeys(treeId, id);
      const bytes = processed.full.length + processed.thumb.length;
      const { width, height } = processed;

      await storage.put(keys.thumb, processed.thumb, 'image/webp');
      try {
        await storage.put(keys.full, processed.full, 'image/webp');
        const { row, used } = await db.transaction(async (tx) => {
          await lockTreePhotos(tx, treeId);
          const [live] = await tx
            .select({ id: persons.id })
            .from(persons)
            .where(isLivePerson(treeId, personId))
            .for('update');
          if (!live) throw notFound();
          const used = await photoBytesUsed(tx, treeId);
          if (used + bytes > limitBytes) throw quotaFull(limitBytes);
          const [stats] = await tx
            .select({
              n: count(),
              primaries: sql<number>`(count(*) filter (where ${photos.isPrimary}))::int`,
            })
            .from(photos)
            .where(eq(photos.personId, personId));
          if ((stats?.n ?? 0) >= PHOTOS_PER_PERSON_MAX) throw photoRejected('tooMany');
          const [row] = await tx
            .insert(photos)
            .values({
              id,
              treeId,
              personId,
              storageKeyFull: keys.full,
              storageKeyThumb: keys.thumb,
              width,
              height,
              bytes,
              isPrimary: (stats?.primaries ?? 0) === 0,
              uploadedBy: req.user!.id,
            })
            .returning();
          await audit(tx, access, {
            action: 'photo.create',
            entityType: 'photo',
            entityId: id,
            personIds: [personId],
            after: { width, height, bytes },
          });
          return { row: row!, used: used + bytes };
        });
        const photo = await toPhoto(storage, { ...row, uploadedByName: req.user!.name });
        return reply.code(201).send({ photo, usage: { usedBytes: used, limitBytes } });
      } catch (err) {
        await discard([keys.thumb, keys.full], req.log);
        throw err;
      }
    },
  );

  app.post('/api/v1/trees/:treeId/photos/:photoId/primary', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const photoId = idParam(req.params, 'photoId');
    await db.transaction(async (tx) => {
      await lockTreePhotos(tx, access.treeId);
      const p = await requireLivePhoto(tx, access.treeId, photoId);
      authorize(access, 'person.edit', { kind: 'person', personId: p.personId });
      if (p.isPrimary) return;
      await tx
        .update(photos)
        .set({ isPrimary: false })
        .where(and(eq(photos.personId, p.personId), eq(photos.isPrimary, true)));
      await tx.update(photos).set({ isPrimary: true }).where(eq(photos.id, p.id));
      await audit(tx, access, {
        action: 'photo.primary',
        entityType: 'photo',
        entityId: p.id,
        personIds: [p.personId],
      });
    });
    return reply.code(204).send();
  });

  app.delete('/api/v1/trees/:treeId/photos/:photoId', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const photoId = idParam(req.params, 'photoId');
    const keys = await db.transaction(async (tx) => {
      await lockTreePhotos(tx, access.treeId);
      const p = await requireLivePhoto(tx, access.treeId, photoId);
      authorize(access, 'person.edit', { kind: 'person', personId: p.personId });
      await tx.delete(photos).where(eq(photos.id, p.id));
      if (p.isPrimary) {
        const [next] = await tx
          .select({ id: photos.id })
          .from(photos)
          .where(eq(photos.personId, p.personId))
          .orderBy(desc(photos.createdAt))
          .limit(1);
        if (next) await tx.update(photos).set({ isPrimary: true }).where(eq(photos.id, next.id));
      }
      const gone = [p.storageKeyFull, p.storageKeyThumb];
      await queueObjectDeletes(tx, gone);
      await audit(tx, access, {
        action: 'photo.delete',
        entityType: 'photo',
        entityId: p.id,
        personIds: [p.personId],
        before: { width: p.width, height: p.height, bytes: p.bytes },
      });
      return gone;
    });
    await drainStorageDeletions(db, storage, { keys, log: req.log });
    return reply.code(204).send();
  });
};
```

  **Notes on this route:**
  - **Errors in `onRequest`:** an error thrown from a route-level `onRequest` hook reaches the app's error handler, just as in a preHandler, so outsiders get 404.
  - **Where `extraLimit` runs:** it is listed before the access hook so that refused requests count. `req.user` is set by the plugin-level hook, which runs first.
  - **Why the keys are rechecked:** the photo route's delete runs `requireLivePhoto` inside the transaction, so a photo of a person deleted meanwhile is 404.

  **`app.ts`:**
  - Register `photosRoutes` after `residencesRoutes`.
  - In `setErrorHandler`, before the generic 4xx branch:

```ts
    // Photo uploads (decision 15): a body over the limit, or a Content-Type no parser accepts.
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return send(413, { code: 'VALIDATION', message: 'The photo was not accepted', details: { reason: 'tooLarge' } });
    }
    if (err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return send(415, { code: 'VALIDATION', message: 'The photo was not accepted', details: { reason: 'type' } });
    }
```

  `FST_ERR_CTP_INVALID_MEDIA_TYPE` can come from any JSON route given an odd Content-Type. A `VALIDATION`/`type` answer there is harmless: it was a 4xx `BAD_REQUEST` before, and the web never sends one.

- [ ] **Step 7: Run** the photo tests, the isolation suite and `pnpm test:int`. Everything passes. Fill in the Task 8 `it.todo` (restore shows the photo again).

- [ ] **Step 8: Commit** `feat(api): photo upload, primary and delete with quotas, per-person cap, permissions and isolation`

---
## Task 10: API — primary photo thumbnails on the graph

**Files:**
- Modify: `apps/api/src/trees/graph-rows.ts`, `apps/api/src/trees/graph-view.ts`, `apps/api/src/routes/graph.ts`, `apps/api/src/routes/graph.int.test.ts`

- [ ] **Step 1: Write the failing tests** (add to `graph.int.test.ts`):
  1. A person with a primary photo row (`addPhotoRow`) has `photoThumbUrl` set:
     - it starts with `config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT`;
     - it contains the row's thumb key and `X-Amz-Expires=900`.
     Everyone else has `null`. A non-primary photo alone gives `null`.
  2. Two graph requests in the same signing window give the **same** URL (cache-friendly, decision 7).
  3. The response has no `photoThumbKey`, and no `storageKey` anywhere: `JSON.stringify(res.json())` doesn't contain `storage_key` or `photoThumbKey`.
  4. `GET /disconnected` and `GET /persons/similar` responses don't contain `photoThumbKey` either.

- [ ] **Step 2: Run them; they fail.**

- [ ] **Step 3: Implement.**

  **`graph-rows.ts`:**
  - `GraphPersonRow` gains `photoThumbKey: string | null`.
  - The people query joins the primary photo:

```ts
      const people = await tx
        .select({
          ...summaryColumns,
          sex: persons.sex,
          siblingOrder: persons.siblingOrder,
          photoThumbKey: photos.storageKeyThumb,
        })
        .from(persons)
        .leftJoin(photos, and(eq(photos.personId, persons.id), eq(photos.isPrimary, true)))
        .where(and(eq(persons.treeId, treeId), isNull(persons.deletedAt)));
```

  **`graph-view.ts`:**
  - `buildTreeGraph` stops spreading the row. It picks the `GraphPerson` fields explicitly and sets `photoThumbUrl: null`:

```ts
      .map(({ photoThumbKey: _key, ...p }) => ({
        ...p,
        photoThumbUrl: null,
        hasParents: hasParents.has(p.id),
        hiddenRelatives: hidden.has(p.id),
        canAddRelative: can(access, 'person.add', { kind: 'relation', ends: [p.id] }),
      })),
```

  - Then add:

```ts
/** Signs the primary thumbnails of the people in the view (decision 17); layout never sees them. */
export async function withPhotoUrls(
  graph: TreeGraph,
  rows: GraphRows,
  store: ObjectStore,
): Promise<TreeGraph> {
  const keyOf = new Map(rows.persons.map((p) => [p.id, p.photoThumbKey]));
  const urls = await signThumbs(store, graph.persons.map((p) => keyOf.get(p.id) ?? null));
  return { ...graph, persons: graph.persons.map((p, i) => ({ ...p, photoThumbUrl: urls[i]! })) };
}
```

  **`routes/graph.ts`:**
  - The graph handler: `const rows = await loadGraphRows(db, access.treeId); return withPhotoUrls(buildTreeGraph(rows, access, query), rows, storage);`
  - `toSummary` already picks fields, so `disconnected` is unchanged.

- [ ] **Step 4: Run** the graph tests and `pnpm test:int`. They pass.

- [ ] **Step 5: Commit** `feat(api): primary photo thumbnails on graph people`

---

## Task 11: API — search with `pg_trgm`, the relationship path, and the duplicate check on trigrams

**Files:**
- Create: `apps/api/src/trees/search.ts`, `apps/api/src/routes/search.ts`, `apps/api/src/routes/search.int.test.ts`
- Modify: `apps/api/src/routes/graph.ts`, `apps/api/src/routes/graph.int.test.ts`, `apps/api/src/app.ts`, `apps/api/src/routes/isolation.int.test.ts`

- [ ] **Step 1: Implement `trees/search.ts`:**

```ts
import { BIRTH_YEAR_SLACK, type ParsedSearchQuery, SEARCH_WORDS_MAX } from '@family-tree/shared';
import { and, asc, between, desc, eq, gte, ilike, isNull, lte, or, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { persons, photos, residences } from '../db/schema.js';
import { branchQuery } from './branch.js';
import { summaryColumns } from './people.js';

/** word_similarity thresholds (decisions 18, 19), set per query with set_config(…, true). */
const SEARCH_THRESHOLD = 0.4;
const SIMILAR_THRESHOLD = 0.3;
/** Trigram candidates handed to findSimilar (decision 19). */
export const SIMILAR_CANDIDATES = 200;

/** The same normalisation as persons.search_name, so "Jose" meets "José". */
const norm = (s: string) => sql`lower(family_unaccent(${s}))`;
/** LIKE metacharacters in user input match literally (Postgres's default escape is \). */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const threshold = (v: number) =>
  sql`select set_config('pg_trgm.word_similarity_threshold', ${String(v)}, true)`;

export const searchWords = (q: string | undefined) =>
  (q ?? '').split(/\s+/).filter(Boolean).slice(0, SEARCH_WORDS_MAX);

/** Live people matching every word and every filter, best first (decision 18). */
export function searchPersons(db: Db, treeId: string, q: ParsedSearchQuery) {
  const words = searchWords(q.q);
  const conds: (SQL | undefined)[] = [eq(persons.treeId, treeId), isNull(persons.deletedAt)];
  for (const w of words) {
    conds.push(
      sql`(${norm(w)} <% ${persons.searchName} or ${persons.searchName} like '%' || ${norm(likeEscape(w))} || '%')`,
    );
  }
  if (q.bornFrom !== undefined) conds.push(gte(persons.birthSortYear, q.bornFrom));
  if (q.bornTo !== undefined) conds.push(lte(persons.birthSortYear, q.bornTo));
  if (q.diedFrom !== undefined) conds.push(gte(persons.deathSortYear, q.diedFrom));
  if (q.diedTo !== undefined) conds.push(lte(persons.deathSortYear, q.diedTo));
  if (q.status) conds.push(eq(persons.isLiving, q.status === 'living'));
  if (q.place) {
    const pattern = `%${likeEscape(q.place)}%`;
    conds.push(
      or(
        ilike(persons.birthPlace, pattern),
        ilike(persons.deathPlace, pattern),
        sql`exists (select 1 from ${residences} where ${residences.personId} = ${persons.id}
          and ${residences.deletedAt} is null and ${residences.place} ilike ${pattern})`,
      ),
    );
  }
  // The spec §4 branch rule, as the full view's branch (no rule 5).
  if (q.branch) conds.push(sql`${persons.id} in (${branchQuery(treeId, q.branch, null)})`);
  const score = words.length
    ? sql`(${sql.join(
        words.map((w) => sql`word_similarity(${norm(w)}, ${persons.searchName})`),
        sql` + `,
      )})`
    : sql`0`;
  return db.transaction(
    async (tx) => {
      await tx.execute(threshold(SEARCH_THRESHOLD));
      return tx
        .select({ ...summaryColumns, photoThumbKey: photos.storageKeyThumb })
        .from(persons)
        .leftJoin(photos, and(eq(photos.personId, persons.id), eq(photos.isPrimary, true)))
        .where(and(...conds))
        .orderBy(desc(score), asc(persons.surname), asc(persons.givenName), asc(persons.id))
        .limit(q.limit);
    },
    { accessMode: 'read only' },
  );
}

/** Trigram candidates for the duplicate check; findSimilar does the final rules (decision 19). */
export function similarCandidates(db: Db, treeId: string, q: { givenName: string; birthYear?: number }) {
  const given = norm(q.givenName);
  return db.transaction(
    async (tx) => {
      await tx.execute(threshold(SIMILAR_THRESHOLD));
      return tx
        .select({ ...summaryColumns, maidenName: persons.maidenName, nickname: persons.nickname })
        .from(persons)
        .where(
          and(
            eq(persons.treeId, treeId),
            isNull(persons.deletedAt),
            sql`${given} <% ${persons.searchName}`,
            q.birthYear === undefined
              ? undefined
              : or(
                  isNull(persons.birthSortYear),
                  between(persons.birthSortYear, q.birthYear - BIRTH_YEAR_SLACK, q.birthYear + BIRTH_YEAR_SLACK),
                ),
          ),
        )
        .orderBy(desc(sql`word_similarity(${given}, ${persons.searchName})`), asc(persons.id))
        .limit(SIMILAR_CANDIDATES);
    },
    { accessMode: 'read only' },
  );
}
```

  **Why `set_config(…, true)` inside a transaction:** the `<%` operator uses the `pg_trgm.word_similarity_threshold` setting, so the GIN index can serve it. The setting is local to the transaction and never leaks to other pool connections.

- [ ] **Step 2: Write the failing `routes/search.int.test.ts`.**

  **Setup:**
  - `seedSampleFamily(db, owner.userId)` makes the owner's card Leo. Check the real export name in `db/seed.ts`.
  - Add extra people: `José Núñez` (nickname `Pepe`), `Robert Smith`, and `100% Real` (for LIKE escaping).
  - A second tree with a `Margaret` in it.

  **Test cases:**
  1. **Typos, accents and every name field:**
     - `q=Margret` finds Margaret Hale.
     - `q=jose` and `q=nunez` find José.
     - `q=pepe` (nickname) finds José.
     - `q=Ellis` (Margaret's maiden name) finds Margaret.
     - `q=hale robert` and `q=robert hale` find Robert Hale before Robert Smith.
     - `q=Rob` (prefix) finds both Roberts.
     - `q=zzzz` finds nothing.
  2. **Ranking:** for `q=Hale`, everyone named Hale comes before anyone else, then by given name.
  3. **Filters** (each alone, then combined):
     - `bornFrom=1950&bornTo=1965` gives David, Susan, Anna and Laura.
     - `diedFrom=2000` gives Margaret (died 2010), not Robert (1998).
     - `status=deceased` gives Robert and Margaret; `status=living` excludes both.
     - `place=leeds` gives Robert (birth place and residence).
     - `place=toronto` gives Robert (death place).
     - `place=100%` doesn't match everything (escaping).
     - `branch=<Susan>` is Susan's branch: her ancestors, their descendants and partners. It includes Noah and excludes nobody of the Hale core. Compare with `branchPersonIds(db, tree, susan, null)`.
     - `q=Hale&status=living&bornFrom=1980` gives Emma, Mia, Leo and Noah.
  4. **Scope:** deleted people and other trees' people never appear (a `Margaret` in tree B, a deleted `Margaret` in tree A).
  5. **Validation and limits:**
     - No `q` and no filter: 400 `VALIDATION`.
     - `bornFrom > bornTo`: 400.
     - `limit=51`: 400.
     - `limit=2` returns 2.
     - The default is 20.
     - A malformed `branch`: 400.
     - A `branch` that is a tree-B person: 404.
  6. **Relation to me:**
     - For the owner (card = Leo):
       - David's `relation` gives `kinshipTerm` `'father'`;
       - Noah's gives `'first cousin'`;
       - Leo's own row has `relation: []`.
     - A disconnected person has `relation: null`.
     - A member without a card gets `relation: null` everywhere.
  7. **Photos:** Margaret with a primary photo row has a signed `photoThumbUrl`; the others have `null`.
  8. **The index is used:** with `set local enable_seqscan = off`, `explain` of the name condition uses `persons_search_name_trgm_idx`. This proves the GIN index serves `<%`; don't assert the planner's choice without that setting.
  9. **Viewer** can search (200). **Rate limit:** the 121st search in a minute by one user gets 429.

  **`GET /relationship`:**
  10. From Leo to Laura gives `steps` `[{ move: 'parent', personId: laura }]`, and `persons` has Leo then Laura, with names, sex and `photoThumbUrl`.
  11. Noah → Laura gives `kinshipTerm` `'aunt by marriage'` and `kinshipChain(steps, 'Noah’s')` `'Noah’s mother’s brother’s wife'`.
  12. Leo → Emma gives `'half-sister'`, and Leo → Mia gives `'sister'` (adoptive: still a sister).
  13. The same person gives `steps: []`. A disconnected person gives `steps: null`, and `persons` is just `from`.
  14. A deleted person, or a person of another tree: 404. A malformed id: 400.
  15. Viewer: 200.

  **The duplicate check** (add to the existing similar tests in `graph.int.test.ts`):
  16. All Phase 5 similar tests still pass unchanged.
  17. New cases:
      - `givenName=Jose&surname=Nunez` finds José Núñez (accents).
      - `givenName=Pepe` finds José through the nickname.
      - A tree with 300 `Anna`s returns at most 5, and still includes the exact birth-year match first.

- [ ] **Step 3: Run it; it fails.**

- [ ] **Step 4: Implement `routes/search.ts`:**

```ts
import {
  type KinStep,
  kinPathsFrom,
  relationshipPath,
  relationshipQuerySchema,
  searchQuerySchema,
} from '@family-tree/shared';
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import { idParam, notFound, parseBody } from '../errors.js';
import { TREE } from '../permissions/can.js';
import { signThumbs } from '../photos/photos.js';
import { extraLimit } from '../security/limits.js';
import { authorize, loadAccess } from '../trees/access.js';
import { loadGraphRows } from '../trees/graph-rows.js';
import { requireLivePerson } from '../trees/people.js';
import { searchPersons } from '../trees/search.js';
import type { TreeRouteOptions } from './trees.js';

export const searchRoutes: FastifyPluginAsync<TreeRouteOptions> = async (app, { auth, db, storage }) => {
  app.addHook('preHandler', requireSession(auth));

  /** Spec §6 search box (decision 18). */
  app.get(
    '/api/v1/trees/:treeId/search',
    { preHandler: extraLimit(app, { name: 'search', max: 120, timeWindow: '1 minute', by: 'user' }) },
    async (req) => {
      const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
      authorize(access, 'tree.view', TREE);
      const q = parseBody(searchQuerySchema, req.query);
      if (q.branch) await requireLivePerson(db, access.treeId, q.branch);
      const rows = await searchPersons(db, access.treeId, q);
      let pathTo: ((id: string) => KinStep[] | null) | null = null;
      if (access.personId && rows.length > 0) {
        const graph = await loadGraphRows(db, access.treeId);
        if (graph.persons.some((p) => p.id === access.personId)) {
          pathTo = kinPathsFrom(graph, access.personId);
        }
      }
      const urls = await signThumbs(storage, rows.map((r) => r.photoThumbKey));
      return {
        results: rows.map(({ photoThumbKey: _key, ...p }, i) => ({
          ...p,
          photoThumbUrl: urls[i]!,
          relation: pathTo ? pathTo(p.id) : null,
        })),
      };
    },
  );

  /** Spec §6 "How are we related?" (decision 20). */
  app.get(
    '/api/v1/trees/:treeId/relationship',
    { preHandler: extraLimit(app, { name: 'relationship', max: 60, timeWindow: '1 minute', by: 'user' }) },
    async (req) => {
      const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
      authorize(access, 'tree.view', TREE);
      const { from, to } = parseBody(relationshipQuerySchema, req.query);
      const rows = await loadGraphRows(db, access.treeId);
      const byId = new Map(rows.persons.map((p) => [p.id, p]));
      if (!byId.has(from) || !byId.has(to)) throw notFound();
      const steps = relationshipPath(rows, from, to);
      const people = [from, ...(steps ?? []).map((s) => s.personId)].map((id) => byId.get(id)!);
      const urls = await signThumbs(storage, people.map((p) => p.photoThumbKey));
      return {
        steps,
        persons: people.map(({ id, givenName, middleName, surname, birthYear, deathYear, isLiving, sex }, i) => ({
          id,
          givenName,
          middleName,
          surname,
          birthYear,
          deathYear,
          isLiving,
          sex,
          photoThumbUrl: urls[i]!,
        })),
      };
    },
  );
};
```

  **Notes:**
  - Malformed `from`/`to` are 400 `VALIDATION` (a query, not a path id). Ids that aren't live people of this tree are 404.
  - Register `searchRoutes` in `app.ts` after `graphRoutes`.

  **The duplicate check** (`routes/graph.ts`): replace the candidate query in `GET /persons/similar`:

```ts
      const q = parseBody(similarQuerySchema, req.query);
      const candidates = await similarCandidates(db, access.treeId, q);
      return { persons: findSimilar(candidates, q, SIMILAR_LIMIT).map(toSummary) };
```

  Update `similar.ts`'s header comment: "pg_trgm supplies the candidates (`similarCandidates`); these rules pick and rank".

- [ ] **Step 5: Isolation and permissions.** In `isolation.int.test.ts` routes, add:
  - `['GET', `/api/v1/trees/${t}/search?q=Anchor`]`
  - `['GET', `/api/v1/trees/${t}/search?q=x&branch=${ids.person}`]`
  - `['GET', `/api/v1/trees/${t}/relationship?from=${ids.person}&to=${ids.person2}`]`

  In the tree-B-authority test, also check two more cases:
  - `GET /trees/<B>/relationship?from=<A person>&to=<B root>` gives 404;
  - `GET /trees/<B>/search?q=x&branch=<A person>` gives 404.

- [ ] **Step 6: Run** the search, graph and isolation tests, then `pnpm test:int`. Everything passes.

- [ ] **Step 7: Commit** `feat(api): pg_trgm search with filters and relation to you, relationship path, duplicate check on trigrams`

---

## Task 12: Web — API client and fake for photos, search and relationships

**Files:**
- Modify: `apps/web/src/trees/api.ts`, `apps/web/src/trees/api.test.ts`, `apps/web/src/auth/api.ts`, `apps/web/src/test/fake-trees.ts`, `apps/web/src/test/fake-trees.test.ts`, `apps/web/src/test/setup.ts`

- [ ] **Step 1: Messages** (`auth/api.ts`, `MESSAGES`):

```ts
  photoType: 'Use a JPEG, PNG or WebP photo.',
  photoTooLarge: 'Photos can be at most 10 MB.',
  photoDimensions: 'This photo has too many pixels. Use one of at most 50 megapixels.',
  photoUnreadable: 'This photo couldn’t be read. Try another file.',
  photoTooMany: 'This person already has 50 photos. Remove one first.',
  photoQuota: 'This tree has used all of its photo storage. Remove some photos first.',
  searchFailed: 'Search isn’t available right now. Try again.',
  noRelationship: 'They aren’t connected in this tree.',
```

- [ ] **Step 2: Write the failing client tests** (`trees/api.test.ts`, in its existing `fetch`-stub style):
  1. **`uploadPhoto(t, p, file)`:**
     - It POSTs `/api/v1/trees/t/persons/p/photos`, with `content-type` the file's type, the `Blob` as the body, and `credentials: 'include'`.
     - A 201 `{ photo, usage }` parses.
  2. **Error mapping:**
     - 400 `{ error: { code: 'VALIDATION', details: { reason: 'dimensions' } } }` gives `MESSAGES.photoDimensions`, and each other reason its message.
     - 413 with reason `tooLarge` gives `photoTooLarge`.
     - 403 `QUOTA_EXCEEDED` gives `photoQuota`, not the tree-limit text.
  3. **The other calls:**
     - `setPrimaryPhoto(t, id)` POSTs `/trees/t/photos/id/primary`.
     - `deletePhoto(t, id)` DELETEs `/trees/t/photos/id`.
  4. **`search(t, { q: 'ann', status: 'living', bornFrom: undefined })`:**
     - It GETs `/trees/t/search?q=ann&status=living` (blank and undefined are left out).
     - It returns `results`.
  5. **`relationship(t, a, b)`** GETs `/trees/t/relationship?from=a&to=b` and parses.
  6. **`TREES_API_METHODS`** includes the five new methods. The `satisfies Record` check enforces it.

- [ ] **Step 3: Implement `trees/api.ts`.**

  **`TreesApi`** gains:

```ts
  uploadPhoto(treeId: string, personId: string, file: Blob): Promise<Result<UploadedPhoto>>;
  setPrimaryPhoto(treeId: string, photoId: string): Promise<Result<void>>;
  deletePhoto(treeId: string, photoId: string): Promise<Result<void>>;
  search(treeId: string, query: SearchQuery): Promise<Result<SearchResult[]>>;
  relationship(treeId: string, from: string, to: string): Promise<Result<Relationship>>;
```

  Add the same keys to `TREES_API_METHODS`.

  **`request`** accepts a `Blob` body and a `reasons` map:

```ts
  async function request<T>(
    method: Method,
    path: string,
    body?: unknown,
    parser?: Parser<T>,
    kind: CallKind = 'session',
    codes?: Partial<Record<string, string>>,
    reasons?: Partial<Record<string, string>>,
  ): Promise<Result<T>> {
    …
        ...(body === undefined
          ? {}
          : body instanceof Blob
            ? { headers: { 'content-type': body.type || 'application/octet-stream' }, body }
            : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    …
    if (!res.ok) {
      const parsed = apiErrorSchema.safeParse(await res.json().catch(() => null));
      const error = toAuthError(res.status, parsed.success ? parsed.data.error.code : undefined, kind);
      const reason = parsed.success
        ? (parsed.data.error.details as { reason?: unknown } | undefined)?.reason
        : undefined;
      const override =
        (typeof reason === 'string' ? reasons?.[reason] : undefined) ?? codes?.[error.code];
      return { ok: false, error: override ? { ...error, message: override } : error };
    }
```

  **The methods:**

```ts
    uploadPhoto: (id, p, file) =>
      request(
        'POST',
        `${t(id)}/persons/${enc(p)}/photos`,
        file,
        uploadedPhotoSchema,
        'session',
        { QUOTA_EXCEEDED: MESSAGES.photoQuota, NOT_FOUND: MESSAGES.personNotFound },
        {
          type: MESSAGES.photoType,
          tooLarge: MESSAGES.photoTooLarge,
          dimensions: MESSAGES.photoDimensions,
          unreadable: MESSAGES.photoUnreadable,
          tooMany: MESSAGES.photoTooMany,
        },
      ),
    setPrimaryPhoto: (id, photoId) =>
      request('POST', `${t(id)}/photos/${enc(photoId)}/primary`, {}, undefined, 'session', {
        NOT_FOUND: MESSAGES.itemGone,
      }),
    deletePhoto: (id, photoId) =>
      request('DELETE', `${t(id)}/photos/${enc(photoId)}`, undefined, undefined, 'session', {
        NOT_FOUND: MESSAGES.itemGone,
      }),
    search: (id, query) =>
      map(
        request('GET', `${t(id)}/search${qs(query as Record<string, string | number | undefined>)}`, undefined, searchResponseSchema),
        (d) => d.results,
      ),
    relationship: (id, from, to) =>
      request('GET', `${t(id)}/relationship${qs({ from, to })}`, undefined, relationshipSchema),
```

- [ ] **Step 4: The fake** (`test/fake-trees.ts`). It follows the real rules closely enough for the component tests:
  - **`FakeTree`** gains:
    - `photoLimit: number` (default 1 GiB);
    - `photoUsed: number`.
    `PersonView.photos` of each `people` entry is the store.
  - **`uploadPhoto`:**
    - It calls `enter('uploadPhoto', { treeId, personId, type: file.type, size: file.size })`, so `failNext` works.
    - A missing person gives NOT_FOUND. A non-editor gives FORBIDDEN.
    - A type outside JPEG, PNG and WebP gives VALIDATION with `photoType`. A size over 10 MB gives `photoTooLarge`.
    - `photoUsed + 50_000 > photoLimit` gives `QUOTA_EXCEEDED` with `photoQuota`.
    - Otherwise it adds `{ id: `ph-${n}`, width: 800, height: 600, bytes: 50_000, isPrimary: <first>, createdAt, uploadedByName: 'You', thumbUrl: `https://photos.test/${id}/thumb`, fullUrl: `…/full` }`.
    - It updates `photoThumbUrl` on the person's entry in `t.graph`, if present.
  - **`setPrimaryPhoto` and `deletePhoto`** mirror the server: delete promotes the newest, and usage goes down.
  - **`search(treeId, query)`:**
    - Filter `t.persons` by:
      - every query word being contained in `normalizeName(personName(p))`;
      - the birth and death year ranges;
      - `status` (`isLiving`).
    - `place` and `branch` are recorded in the call but not filtered. Component tests assert the call.
    - `relation` is `kinPathsFrom({ persons, unions, parentChild: links }, me)(id)` over `t.graph` when it and `detail.me.personId` exist, else `null`.
    - `photoThumbUrl` is taken from `t.graph`.
  - **`relationship(treeId, from, to)`:**
    - It uses `relationshipPath` over `t.graph` the same way.
    - A missing id gives NOT_FOUND.
    - `persons` is mapped from the graph people.
  - **`fake-trees.test.ts`:** upload → primary → delete-promotes; the quota; search filters; and a relationship over `haleGraph()` (Leo → Laura is one parent step).

- [ ] **Step 5: `test/setup.ts`:** jsdom has no object URLs. Add:

```ts
if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:fake';
  URL.revokeObjectURL = () => {};
}
```

- [ ] **Step 6: Run** the web tests, `pnpm lint` and `pnpm typecheck`. They pass.

- [ ] **Step 7: Commit** `feat(web): API client and fake for photos, search and relationships`

---
## Task 13: Web — `PersonPhoto`, the cropper and the Photos tab

**Files:**
- Create: `apps/web/src/components/PersonPhoto.tsx`, `apps/web/src/components/PersonPhoto.test.tsx`, `apps/web/src/photos/crop.ts`, `apps/web/src/photos/crop.test.ts`, `apps/web/src/photos/PhotoCropper.tsx`, `apps/web/src/pages/tree/PhotosTab.tsx`, `apps/web/src/pages/tree/PhotosTab.test.tsx`
- Modify: `apps/web/src/pages/tree/PersonPanel.tsx`, `apps/web/src/pages/tree/PersonPanel.test.tsx`, `apps/web/src/styles.css`

- [ ] **Step 1: Write the failing `photos/crop.test.ts`:**

```ts
import { describe, expect, it } from 'vitest';
import { cropToBlob, initialCrop, moveCrop, zoomCrop } from './crop';

const img = { width: 400, height: 200 };

describe('square crop (decision 5)', () => {
  it('starts with the largest centred square', () => {
    expect(initialCrop(img)).toEqual({ x: 100, y: 0, size: 200 });
    expect(initialCrop({ width: 300, height: 900 })).toEqual({ x: 0, y: 300, size: 300 });
  });
  it('zooms around the centre and stays inside the image', () => {
    expect(zoomCrop(initialCrop(img), img, 2)).toEqual({ x: 150, y: 50, size: 100 });
    expect(zoomCrop({ x: 300, y: 100, size: 100 }, img, 1)).toEqual({ x: 200, y: 0, size: 200 });
    expect(zoomCrop(initialCrop(img), img, 99).size).toBe(50); // at most ZOOM_MAX (4)
  });
  it('moves and clamps', () => {
    expect(moveCrop({ x: 150, y: 50, size: 100 }, img, 30, -10)).toEqual({ x: 180, y: 40, size: 100 });
    expect(moveCrop({ x: 150, y: 50, size: 100 }, img, 999, 999)).toEqual({ x: 300, y: 100, size: 100 });
    expect(moveCrop({ x: 150, y: 50, size: 100 }, img, -999, -999)).toEqual({ x: 0, y: 0, size: 100 });
  });
  it('sends the file unchanged without a crop', async () => {
    const f = new Blob(['x'], { type: 'image/png' });
    expect(await cropToBlob(f, null)).toBe(f);
  });
});
```

- [ ] **Step 2: Implement `photos/crop.ts`:**

```ts
import { PHOTO_FULL_SIDE } from '@family-tree/shared';

export interface Size {
  width: number;
  height: number;
}
/** A square in the image's own pixels (after EXIF orientation, as browsers display it). */
export interface CropBox {
  x: number;
  y: number;
  size: number;
}
export const ZOOM_MAX = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const place = (img: Size, x: number, y: number, size: number): CropBox => ({
  x: Math.round(clamp(x, 0, img.width - size)),
  y: Math.round(clamp(y, 0, img.height - size)),
  size,
});

export function initialCrop(img: Size): CropBox {
  const size = Math.min(img.width, img.height);
  return place(img, (img.width - size) / 2, (img.height - size) / 2, size);
}

/** A square of 1/zoom of the short side, around the same centre. */
export function zoomCrop(box: CropBox, img: Size, zoom: number): CropBox {
  const size = Math.max(1, Math.round(Math.min(img.width, img.height) / clamp(zoom, 1, ZOOM_MAX)));
  return place(img, box.x + box.size / 2 - size / 2, box.y + box.size / 2 - size / 2, size);
}

export const moveCrop = (box: CropBox, img: Size, dx: number, dy: number) =>
  place(img, box.x + dx, box.y + dy, box.size);

/**
 * The crop drawn at most `maxSide` px and encoded as JPEG 0.92; with no box, the file itself.
 * The server re-encodes either way (decision 5), so this only saves upload time.
 */
export async function cropToBlob(file: Blob, box: CropBox | null, maxSide = PHOTO_FULL_SIDE): Promise<Blob> {
  if (!box) return file;
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const side = Math.min(box.size, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.drawImage(bitmap, box.x, box.y, box.size, box.size, 0, 0, side, side);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.92),
    );
  } finally {
    bitmap.close();
  }
}
```

  jsdom has neither `createImageBitmap` nor canvas. Component tests mock `cropToBlob`, and the browser walk-through checks the real drawing.

- [ ] **Step 3: `components/PersonPhoto.tsx`** and its test:

```tsx
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { initials } from '../trees/format';

/** Asked for when a photo fails to load, usually an expired signed URL (decision 22). */
export const PhotoRefreshContext = createContext<() => void>(() => {});

/** A refresh that runs at most once per `ms`. */
export function useThrottled(fn: () => void, ms = 60_000): () => void {
  const last = useRef(0);
  const latest = useRef(fn);
  latest.current = fn;
  return useCallback(() => {
    const now = Date.now();
    if (now - last.current < ms) return;
    last.current = now;
    latest.current();
  }, [ms]);
}

/**
 * A person's photo, or their initials when there is none or it fails to load. `alt` is empty by
 * default: the name is already in the surrounding label.
 */
export function PersonPhoto({
  url,
  person,
  className,
  alt = '',
}: {
  url: string | null;
  person: Parameters<typeof initials>[0];
  className: string;
  alt?: string;
}) {
  const refresh = useContext(PhotoRefreshContext);
  const [failed, setFailed] = useState<string | null>(null);
  if (!url || failed === url) {
    return alt ? (
      <span className={className} role="img" aria-label={alt}>
        {initials(person)}
      </span>
    ) : (
      <span className={className} aria-hidden="true">
        {initials(person)}
      </span>
    );
  }
  return (
    <img
      className={className}
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => {
        setFailed(url);
        refresh();
      }}
    />
  );
}
```

  **`PersonPhoto.test.tsx`:**
  1. Without a URL it shows "AL" for Ada Lovelace (`aria-hidden`).
  2. With a URL it renders an `img` with that `src` and `alt=""`.
  3. `fireEvent.error(img)` swaps to the initials and calls the refresh (from a `PhotoRefreshContext.Provider`) once. A new URL shows the image again.
  4. `useThrottled`, with fake timers: three calls within a minute run `fn` once, and a call after 61 s runs it again.

- [ ] **Step 4: `photos/PhotoCropper.tsx`:**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { type CropBox, initialCrop, moveCrop, type Size, ZOOM_MAX, zoomCrop } from './crop';

const VIEW = 320;
const KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Spec §6 "crop in the browser": a square crop with zoom, drag and arrow keys (decision 5). */
export function PhotoCropper({
  file,
  busy,
  onDone,
  onCancel,
}: {
  file: File;
  busy: boolean;
  onDone: (box: CropBox | null) => void;
  onCancel: () => void;
}) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const [img, setImg] = useState<Size | null>(null);
  const [box, setBox] = useState<CropBox | null>(null);
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const scale = img ? VIEW / Math.max(img.width, img.height) : 1;

  return (
    <div className="cropper">
      <p>Choose the part to keep, or use the whole photo.</p>
      <div
        className="crop-view"
        style={img ? { width: img.width * scale, height: img.height * scale } : undefined}
      >
        <img
          src={url}
          alt="The chosen photo"
          onLoad={(e) => {
            const s = { width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight };
            setImg(s);
            setBox(initialCrop(s));
          }}
        />
        {img && box && (
          <div
            className="crop-box"
            role="group"
            tabIndex={0}
            aria-label="Crop area. Use the arrow keys to move it."
            style={{
              left: box.x * scale,
              top: box.y * scale,
              width: box.size * scale,
              height: box.size * scale,
            }}
            onKeyDown={(e) => {
              const d = KEYS[e.key];
              if (!d) return;
              e.preventDefault();
              const step = Math.max(1, Math.round(box.size / 20));
              setBox(moveCrop(box, img, d[0] * step, d[1] * step));
            }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture?.(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              setBox((b) => b && moveCrop(b, img, (e.clientX - d.x) / scale, (e.clientY - d.y) / scale));
              drag.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
          />
        )}
      </div>
      <label>
        Zoom{' '}
        <input
          type="range"
          min={1}
          max={ZOOM_MAX}
          step={0.1}
          value={zoom}
          disabled={!img}
          onChange={(e) => {
            const z = Number(e.target.value);
            setZoom(z);
            if (img && box) setBox(zoomCrop(box, img, z));
          }}
        />
      </label>
      <p>
        <button type="button" disabled={!box || busy} onClick={() => onDone(box)}>
          Upload this part
        </button>{' '}
        <button type="button" className="secondary" disabled={busy} onClick={() => onDone(null)}>
          Use the whole photo
        </button>{' '}
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </p>
    </div>
  );
}
```

  The positions are inline styles. That's dynamic geometry; the Phase 7 CSP already needs `style-src 'unsafe-inline'` for React Flow.

- [ ] **Step 5: Write the failing `PhotosTab.test.tsx`.**

  **Setup:**
  - `vi.mock('../../photos/crop', async (orig) => ({ ...(await orig()), cropToBlob: vi.fn(async (f: Blob, box: unknown) => (box ? new Blob(['crop'], { type: 'image/jpeg' }) : f)) }))`.
  - `renderAt('/trees/<id>/people/<p>?tab=photos', { trees })` with a fake editor tree.
  - A helper `loadCropper(w, h)`:
    - stubs `naturalWidth` and `naturalHeight` with `Object.defineProperty` on the cropper `img`;
    - then calls `fireEvent.load`.

  **Test cases:**
  1. **Empty:**
     - "No photos yet." shows, and "Photos use 0 B of this tree’s 1.1 GB.".
     - An "Add a photo" file input accepts `image/jpeg,image/png,image/webp`.
  2. **Whole photo:**
     - `userEvent.upload` a 400 × 200 PNG `File`, then `loadCropper(400, 200)`.
     - **Use the whole photo** calls `uploadPhoto(<id>, <p>, <the same File>)`.
     - The page shows "Photo added", one thumbnail link (`target="_blank"`, `rel="noopener noreferrer"`) and the "Main photo" badge.
     - The panel header shows the photo too.
  3. **Cropped:**
     - After `loadCropper(400, 200)`, **Upload this part** calls `cropToBlob(file, { x: 100, y: 0, size: 200 })`, and `uploadPhoto` gets the mocked blob.
     - Pressing ArrowLeft on the "Crop area" group moves it (its `style.left` decreases).
     - Zoom 2 makes it smaller.
  4. **Client checks:** no `uploadPhoto` call in either case.
     - A GIF given through `fireEvent.change(input, { target: { files: [gif] } })`, which bypasses `accept`, shows `MESSAGES.photoType`.
     - A 10 MB + 1 byte JPEG shows `MESSAGES.photoTooLarge`.
  5. **Server errors:**
     - `trees.failNext('uploadPhoto', { code: 'VALIDATION', message: MESSAGES.photoDimensions })` shows that message, and the cropper stays open so the user can cancel.
     - QUOTA shows `MESSAGES.photoQuota`.
  6. **Actions:**
     - With two photos, **Make main photo** on the second calls `setPrimaryPhoto` and moves the badge.
     - **Delete**, then **Delete photo**, calls `deletePhoto` and leaves one.
     - Both refresh the view.
  7. **Viewer:** the photos show with the badge, but there's no "Add a photo", no "Make main photo" and no "Delete".

- [ ] **Step 6: Implement `pages/tree/PhotosTab.tsx`:**

```tsx
import {
  PHOTO_MEDIA_TYPES,
  PHOTO_UPLOAD_MAX_BYTES,
  type PhotoMediaType,
} from '@family-tree/shared';
import { useRef, useState } from 'react';
import { MESSAGES, type Result } from '../../auth/api';
import { ConfirmButton } from '../../components/ConfirmButton';
import { FormError, Success } from '../../components/forms';
import { PersonPhoto } from '../../components/PersonPhoto';
import { type CropBox, cropToBlob } from '../../photos/crop';
import { PhotoCropper } from '../../photos/PhotoCropper';
import { formatBytes, personName } from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import type { TabProps } from './usePersonSave';

export function PhotosTab({ treeId, view, reload, onChanged }: TabProps) {
  const api = useTreesApi();
  const canEdit = view.capabilities.edit;
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const name = personName(view.person);

  const finish = async (message: string) => {
    setDone(message);
    await reload();
    onChanged();
  };

  function choose(f: File | undefined) {
    setError(null);
    setDone(null);
    if (!f) return;
    if (!PHOTO_MEDIA_TYPES.includes(f.type as PhotoMediaType)) return setError(MESSAGES.photoType);
    if (f.size > PHOTO_UPLOAD_MAX_BYTES) return setError(MESSAGES.photoTooLarge);
    setFile(f);
  }

  async function upload(box: CropBox | null) {
    if (!file) return;
    setBusy(true);
    setError(null);
    let body: Blob;
    try {
      body = await cropToBlob(file, box);
    } catch {
      setBusy(false);
      return setError(MESSAGES.photoUnreadable);
    }
    const res = await api.uploadPhoto(treeId, view.person.id, body);
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    setFile(null);
    if (input.current) input.current.value = '';
    await finish('Photo added');
  }

  async function act(call: Promise<Result<void>>, message: string) {
    setBusy(true);
    setError(null);
    const res = await call;
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    await finish(message);
  }

  return (
    <div className="photos-tab">
      <FormError>{error}</FormError>
      {done && <Success>{done}</Success>}
      {view.photos.length === 0 ? (
        <p>No photos yet.</p>
      ) : (
        <ul className="photo-grid" aria-label={`Photos of ${name}`}>
          {view.photos.map((ph, i) => (
            <li key={ph.id} className={ph.isPrimary ? 'photo is-primary' : 'photo'}>
              <a href={ph.fullUrl} target="_blank" rel="noopener noreferrer">
                <PersonPhoto
                  url={ph.thumbUrl}
                  person={view.person}
                  className="photo-thumb"
                  alt={`Photo ${i + 1} of ${name}${ph.isPrimary ? ', main photo' : ''} (opens full size)`}
                />
              </a>
              {ph.isPrimary && <span className="badge">Main photo</span>}
              {canEdit && (
                <p className="photo-actions">
                  {!ph.isPrimary && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void act(api.setPrimaryPhoto(treeId, ph.id), 'Main photo changed')}
                    >
                      Make main photo
                    </button>
                  )}{' '}
                  <ConfirmButton
                    label="Delete"
                    confirmLabel="Delete photo"
                    danger
                    pending={busy}
                    onConfirm={() => void act(api.deletePhoto(treeId, ph.id), 'Photo removed')}
                  />
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="hint">
        Photos use {formatBytes(view.photoUsage.usedBytes)} of this tree’s{' '}
        {formatBytes(view.photoUsage.limitBytes)}.
      </p>
      {canEdit &&
        (file ? (
          <PhotoCropper file={file} busy={busy} onDone={(b) => void upload(b)} onCancel={() => setFile(null)} />
        ) : (
          <p>
            <label className="file-button">
              Add a photo{' '}
              <input
                ref={input}
                type="file"
                accept={PHOTO_MEDIA_TYPES.join(',')}
                onChange={(e) => choose(e.target.files?.[0])}
              />
            </label>{' '}
            <span className="hint">
              JPEG, PNG or WebP, up to 10 MB. Location and camera details are removed.
            </span>
          </p>
        ))}
      {busy && <p role="status">Working…</p>}
    </div>
  );
}
```

  Use the real `Success` component the way `PlacesTab` does. If its props differ, follow `PlacesTab`.

- [ ] **Step 7: `PersonPanel.tsx`:**
  - Replace the placeholder with `{tab === 'photos' && <PhotosTab {...tabProps} />}`.
  - Before the `h2`, add the primary thumbnail: `<PersonPhoto url={view.photos.find((p) => p.isPrimary)?.thumbUrl ?? null} person={p} className="panel-photo" />`.
  - Wrap the panel in `<PhotoRefreshContext.Provider value={refreshPhotos}>`, where `const refreshPhotos = useThrottled(() => void load());`.
  - **`PersonPanel.test.tsx`:**
    - replace the "Photos arrive in a later version." expectation with "No photos yet.";
    - add a case: with a photo, the header shows its `img`.

- [ ] **Step 8: CSS** (`styles.css`):

```css
.panel-photo { width: 72px; height: 72px; border-radius: 50%; object-fit: cover; float: right; display: grid; place-items: center; background: #e5e7eb; font-weight: 600; }
.photo-grid { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 0.75rem; }
.photo-thumb { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; display: grid; place-items: center; background: #e5e7eb; }
.photo.is-primary .photo-thumb { outline: 3px solid #1d4ed8; outline-offset: 2px; }
.badge { display: inline-block; font-size: 0.8rem; background: #dbeafe; color: #1e3a8a; border-radius: 999px; padding: 0 0.5rem; }
.photo-actions { margin: 0.25rem 0 0; display: flex; flex-wrap: wrap; gap: 0.25rem; }
.cropper .crop-view { position: relative; max-width: 100%; touch-action: none; user-select: none; }
.cropper .crop-view img { width: 100%; height: 100%; display: block; }
.crop-box { position: absolute; box-shadow: 0 0 0 9999px rgb(0 0 0 / 45%); outline: 2px solid #fff; cursor: move; }
.crop-box:focus-visible { outline: 3px solid #fbbf24; }
.crop-view { overflow: hidden; }
```

- [ ] **Step 9: Run** the web tests, `pnpm lint` and `pnpm typecheck`. They pass.

- [ ] **Step 10: Commit** `feat(web): Photos tab with browser crop, main photo and delete; panel photo`

---

## Task 14: Web — photos on the canvas cards

**Files:**
- Modify: `apps/web/src/canvas/PersonCard.tsx`, `apps/web/src/canvas/PersonCard.test.tsx`, `apps/web/src/pages/tree/TreeWorkspace.tsx`, `apps/web/src/styles.css`

- [ ] **Step 1: Write the failing card tests** (`PersonCard.test.tsx`):
  1. On a full-detail card, a person with `photoThumbUrl: 'https://photos.test/r/thumb'` renders an `img` with that `src` and `alt=""`. The button's accessible name is unchanged ("Robert Hale, 1930–1998, deceased").
  2. On `fireEvent.error`, the image swaps to the initials.
  3. Without a URL, the initials show as before.
  4. Name-only and dot detail levels render no image.

- [ ] **Step 2: Implement.**
  - In `PersonCardView`, replace the `card-photo` span with `{detail === 'full' && <PersonPhoto url={person.photoThumbUrl} person={person} className="card-photo" />}`.
  - In `TreeWorkspace`, wrap the canvas area in `<PhotoRefreshContext.Provider value={refreshPhotos}>`, where `const refreshPhotos = useThrottled(() => setRefreshKey((k) => k + 1));`. An expired card URL then refetches the graph at most once a minute. The refetch re-runs the layout, which is acceptable at that rate.
  - **CSS:** `img.card-photo { object-fit: cover; padding: 0; }`. The existing `.card-photo` rules (size, circle) keep applying to both the `img` and the initials `span`.

- [ ] **Step 3: Run** the web tests; they pass.

- [ ] **Step 4: Commit** `feat(web): primary photo thumbnails on person cards`

---

## Task 15: Web — the search box

**Files:**
- Create: `apps/web/src/components/PersonPicker.tsx`, `apps/web/src/canvas/SearchBox.tsx`, `apps/web/src/canvas/SearchBox.test.tsx`
- Modify: `apps/web/src/canvas/CanvasToolbar.tsx` (BranchPicker uses PersonPicker), `apps/web/src/styles.css`

- [ ] **Step 1: Extract `components/PersonPicker.tsx`** from Phase 5's `BranchPicker`, and keep `BranchPicker`'s behaviour and tests:

```tsx
import { normalizeName, type PersonSummary } from '@family-tree/shared';
import { useState } from 'react';
import { personName, personYears } from '../trees/format';

/** Type 2+ letters, pick from up to 20 matches; shows the choice with a Clear button. */
export function PersonPicker({
  label,
  persons,
  value,
  onChange,
  clearLabel = 'Clear',
}: {
  label: string;
  persons: PersonSummary[];
  value: string | null;
  onChange: (id: string | null) => void;
  clearLabel?: string;
}) {
  const [text, setText] = useState('');
  const chosen = value ? persons.find((p) => p.id === value) : undefined;
  if (chosen) {
    return (
      <p className="person-picker">
        {label}: <strong>{personName(chosen)}</strong>{' '}
        <button type="button" className="secondary" onClick={() => onChange(null)}>
          {clearLabel}
        </button>
      </p>
    );
  }
  const needle = normalizeName(text);
  const matches =
    needle.length < 2
      ? []
      : persons.filter((p) => normalizeName(personName(p)).includes(needle)).slice(0, 20);
  return (
    <div className="person-picker">
      <label>
        {label}{' '}
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setText('')}
        />
      </label>
      {matches.length > 0 && (
        <ul className="picker-matches">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  setText('');
                  onChange(p.id);
                }}
              >
                {personName(p)} {personYears(p)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

  `BranchPicker` becomes `<PersonPicker label="Show the branch of" clearLabel="Whole tree" … />`. Adjust its text ("Branch: <name>") only if Phase 5's tests require it; they must still pass.

- [ ] **Step 2: Write the failing `SearchBox.test.tsx`.**

  **Setup:**
  - Render via `renderAt('/trees/<id>', { trees })`, with a fake tree whose `graph` is the Hale graph (`haleGraph()` ids) and `me.personId = leo`.
  - Use `vi.useFakeTimers({ shouldAdvanceTime: true })` to control the 250 ms debounce.

  **Test cases:**
  1. **Typing searches once:**
     - Typing "marg" into **Search** calls `search(<id>, { q: 'marg', limit: 20 })` once, after 250 ms, not per keystroke.
     - The status line says "1 person found".
     - The result button shows "Margaret Hale", her years and "Your grandmother". The `relation` comes from the fake's `kinPathsFrom`.
  2. **The relation line:**
     - Leo's own result says "You".
     - A disconnected person says "Not connected to you".
     - With `me.personId = null`, no relation line shows.
  3. **Choosing:**
     - Clicking a result lands on `/trees/<id>/people/<margaret>`, which opens her panel and re-centres the focus view (`getGraph` is called with `focus: margaret`).
     - The results close.
  4. **Esc** clears the box and the results.
  5. **Filters:**
     - **Filters** has `aria-expanded`.
     - Setting Born from 1900 to 1940 and Status **Deceased** sends `{ bornFrom: 1900, bornTo: 1940, status: 'deceased' }` with no `q`.
     - The button reads "Filters (2)".
     - Choosing "In the branch of" Susan adds `branch: <susan>`.
     - **Clear filters** resets them.
  6. **Nothing is sent** when the box is empty with no filters, or when Born from is after Born to. The range error shows "From must not be after to".
  7. **Stale responses:**
     - Use a stub `TreesApi`, given through `TreesApiProvider`, whose first `search` resolves after its second.
     - Only the second result list is shown.
  8. **Errors:** `failNext('search', RATE_LIMITED)` shows `MESSAGES.tooMany`.

- [ ] **Step 3: Implement `canvas/SearchBox.tsx`:**

```tsx
import {
  kinshipChain,
  kinshipTerm,
  type PersonSummary,
  type SearchQuery,
  type SearchResult,
  searchQuerySchema,
} from '@family-tree/shared';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { FormError } from '../components/forms';
import { PersonPhoto } from '../components/PersonPhoto';
import { PersonPicker } from '../components/PersonPicker';
import { personName, personYears } from '../trees/format';
import { useTreesApi } from '../trees/TreesApiContext';
import { usePersonHref } from './params';

interface Filters {
  bornFrom: string;
  bornTo: string;
  diedFrom: string;
  diedTo: string;
  place: string;
  status: '' | 'living' | 'deceased';
  branch: string;
}
const NO_FILTERS: Filters = { bornFrom: '', bornTo: '', diedFrom: '', diedTo: '', place: '', status: '', branch: '' };

/** "Your second cousin", "You", "Not connected to you"; '' when the user has no card. */
export function relationLabel(r: SearchResult, meId: string | null): string {
  if (meId === null) return '';
  if (r.relation === null) return 'Not connected to you';
  if (r.relation.length === 0) return 'You';
  const term = kinshipTerm(r.relation);
  const words = term ? `your ${term}` : kinshipChain(r.relation, 'your');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Spec §6 search box (decision 23). */
export function SearchBox({
  treeId,
  persons,
  meId,
}: {
  treeId: string;
  persons: PersonSummary[];
  meId: string | null;
}) {
  const api = useTreesApi();
  const navigate = useNavigate();
  const hrefOf = usePersonHref(treeId);
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const parsed = searchQuerySchema.safeParse({ q, ...filters });
  const rangeError = parsed.success
    ? null
    : (parsed.error.issues.find((i) => i.path[0] === 'bornTo' || i.path[0] === 'diedTo')?.message ?? null);
  const key = parsed.success ? JSON.stringify(parsed.data) : '';
  const active = Object.values(filters).filter((v) => v !== '').length;

  useEffect(() => {
    const id = ++seq.current;
    if (!key) {
      setResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      const res = await api.search(treeId, JSON.parse(key) as SearchQuery);
      if (id !== seq.current) return; // a newer search started
      if (res.ok) {
        setResults(res.data);
        setError(null);
      } else {
        setResults(null);
        setError(res.error.message);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [api, treeId, key]);

  const set = (k: keyof Filters) => (e: { target: { value: string } }) =>
    setFilters((f) => ({ ...f, [k]: e.target.value }));
  const close = () => {
    setQ('');
    setResults(null);
  };

  return (
    <div className="search-box" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <form role="search" aria-label="Search people" onSubmit={(e) => e.preventDefault()}>
        <label>
          Search{' '}
          <input type="search" value={q} autoComplete="off" onChange={(e) => setQ(e.target.value)} />
        </label>{' '}
        <button
          type="button"
          className="secondary"
          aria-expanded={open}
          aria-controls="search-filters"
          onClick={() => setOpen((v) => !v)}
        >
          Filters{active > 0 && ` (${active})`}
        </button>
      </form>
      {open && (
        <fieldset id="search-filters" className="search-filters">
          <legend>Filters</legend>
          <label>
            Born from <input inputMode="numeric" value={filters.bornFrom} onChange={set('bornFrom')} />
          </label>{' '}
          <label>
            to <input inputMode="numeric" value={filters.bornTo} onChange={set('bornTo')} />
          </label>
          <br />
          <label>
            Died from <input inputMode="numeric" value={filters.diedFrom} onChange={set('diedFrom')} />
          </label>{' '}
          <label>
            to <input inputMode="numeric" value={filters.diedTo} onChange={set('diedTo')} />
          </label>
          <br />
          <label>
            Place <input value={filters.place} onChange={set('place')} />
          </label>{' '}
          <label>
            Status{' '}
            <select value={filters.status} onChange={set('status')}>
              <option value="">Anyone</option>
              <option value="living">Living</option>
              <option value="deceased">Deceased</option>
            </select>
          </label>
          <PersonPicker
            label="In the branch of"
            persons={persons}
            value={filters.branch || null}
            onChange={(id) => setFilters((f) => ({ ...f, branch: id ?? '' }))}
          />
          {rangeError && <FormError>{rangeError}</FormError>}
          <button type="button" className="secondary" onClick={() => setFilters(NO_FILTERS)}>
            Clear filters
          </button>
        </fieldset>
      )}
      <FormError>{error}</FormError>
      {results && (
        <div className="search-results">
          <p role="status">
            {results.length === 0
              ? 'No one found'
              : results.length === 1
                ? '1 person found'
                : `${results.length} people found`}
          </p>
          <ul aria-label="Search results">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="search-result"
                  onClick={() => {
                    close();
                    void navigate(hrefOf(r.id));
                  }}
                >
                  <PersonPhoto url={r.photoThumbUrl} person={r} className="result-photo" />
                  <span className="result-name">{personName(r)}</span>{' '}
                  <span className="result-years">{personYears(r)}</span>{' '}
                  <span className="result-relation">{relationLabel(r, meId)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

  **`CanvasToolbar.tsx`:** render `<SearchBox treeId={treeId} persons={persons} meId={detail.me.personId} />` first, before the View group (the Phase 5 carry-forward).

  **CSS:**

```css
.search-box { position: relative; }
.search-results, .search-filters {
  position: absolute; z-index: 15; background: #fff; border: 1px solid #ccd; border-radius: 8px;
  padding: 0.5rem 0.75rem; min-width: 300px; max-height: 60vh; overflow: auto;
}
.search-results ul { list-style: none; padding: 0; margin: 0; }
.search-result { display: grid; grid-template-columns: 32px 1fr; column-gap: 0.5rem; width: 100%; text-align: left; background: none; color: inherit; border: 0; padding: 0.35rem; }
.search-result:hover, .search-result:focus-visible { background: #eef2ff; }
.result-photo { grid-row: span 3; width: 32px; height: 32px; border-radius: 50%; object-fit: cover; display: grid; place-items: center; background: #e5e7eb; font-size: 0.75rem; }
.result-years, .result-relation { font-size: 0.85rem; color: #4b5563; }
@media (max-width: 720px) { .search-results, .search-filters { left: 0; right: 0; min-width: 0; } }
```

- [ ] **Step 4: Run** the web tests, including the Phase 5 toolbar and workspace tests, plus `pnpm lint` and `pnpm typecheck`. They pass.

- [ ] **Step 5: Commit** `feat(web): search box with typo-tolerant names, filters, photos and relationship to you`

---

## Task 16: Web — "How are we related?" with the path on the canvas

**Files:**
- Create: `apps/web/src/canvas/highlight.ts`, `apps/web/src/canvas/highlight.test.ts`, `apps/web/src/pages/tree/RelationshipPanel.tsx`, `apps/web/src/pages/tree/RelationshipPanel.test.tsx`
- Modify: `apps/web/src/canvas/params.ts`, `apps/web/src/canvas/params.test.ts`, `apps/web/src/canvas/CanvasToolbar.tsx`, `apps/web/src/pages/tree/TreeWorkspace.tsx`, `apps/web/src/pages/tree/TreeWorkspace.test.tsx`, `apps/web/src/routes.tsx`, `apps/web/src/styles.css`

- [ ] **Step 1: Write the failing `highlight.test.ts`.** Build steps with `relationshipPath` over the Hale fixture: `{ persons, unions, parentChild: links }` of `haleGraph()`, then `graphToFlow`.
  1. The path from Leo to Emma:
     - highlights Leo, David and Emma;
     - highlights the David + Laura and David + Anna unions;
     - highlights the edges `child:<leo link>`, `partner:<u-dl>:<david>`, `partner:<u-da>:<david>` and `child:<emma link>`.
  2. A partner step highlights both partner edges of that union.
  3. `applyHighlight` adds `is-path` to the matching nodes' `className` and `edge-path` to the matching edges, keeping their existing classes. Other nodes and edges are the same objects (`toBe`).

- [ ] **Step 2: Implement `canvas/highlight.ts`:**

```ts
import type { KinStep } from '@family-tree/shared';
import type { Edge } from '@xyflow/react';
import type { CanvasNode } from './graph-to-flow';

export interface PathHighlight {
  personIds: ReadonlySet<string>;
  unionIds: ReadonlySet<string>;
  /** graphToFlow edge ids: `partner:<union>:<person>` and `child:<link>`. */
  edgeIds: ReadonlySet<string>;
}

export function pathHighlight(fromId: string, steps: readonly KinStep[]): PathHighlight {
  const personIds = new Set([fromId]);
  const unionIds = new Set<string>();
  const edgeIds = new Set<string>();
  let prev = fromId;
  for (const s of steps) {
    personIds.add(s.personId);
    unionIds.add(s.unionId);
    if (s.move === 'partner') {
      edgeIds.add(`partner:${s.unionId}:${prev}`);
      edgeIds.add(`partner:${s.unionId}:${s.personId}`);
    } else {
      // child → union dot → parent, whichever way the step goes.
      const parent = s.move === 'parent' ? s.personId : prev;
      edgeIds.add(`child:${s.linkId}`);
      edgeIds.add(`partner:${s.unionId}:${parent}`);
    }
    prev = s.personId;
  }
  return { personIds, unionIds, edgeIds };
}

const withClass = (cls: string | undefined, add: string) => (cls ? `${cls} ${add}` : add);

/** Marks the path on laid-out nodes and edges; no re-layout (decision 24). */
export function applyHighlight(nodes: CanvasNode[], edges: Edge[], h: PathHighlight) {
  return {
    nodes: nodes.map((n) => {
      const on =
        n.type === 'person' ? h.personIds.has(n.data.person.id) : h.unionIds.has(n.data.union.id);
      return on ? { ...n, className: withClass(n.className, 'is-path') } : n;
    }),
    edges: edges.map((e) =>
      h.edgeIds.has(e.id) ? { ...e, className: withClass(e.className, 'edge-path'), zIndex: 1 } : e,
    ),
  };
}
```

- [ ] **Step 3: Parameters.**
  - In `params.ts`, `CanvasChange` keys gain `'from' | 'to'`.
  - `usePersonHref` also drops them: `{ focus: null, tab: null, add: null, from: null, to: null }`.
  - Add a `params.test.ts` case: `canvasSearch(sp('from=a&to=b&view=full'), { from: null, to: null })` is `'?view=full'`.

- [ ] **Step 4: Write the failing `RelationshipPanel.test.tsx`.** Use the fake with the Hale graph and `me = leo`.
  1. **Defaults:**
     - `/trees/<id>/relationship?to=<emma>` defaults **From** to "Leo Hale" (your card).
     - It calls `relationship(<id>, leo, emma)` and shows "Emma Hale is your half-sister.".
     - It shows the path list "Leo Hale → David Hale → Emma Hale", with each name a link to their panel.
  2. **From someone else:**
     - `?from=<noah>&to=<laura>` shows "Laura Hale is Noah Hale’s aunt by marriage." and "The path: Noah Hale’s mother’s brother’s wife".
  3. **No term:** a path with no term (for example Leo's wife's grandmother in an extended fixture) shows "X is your wife’s mother’s mother." and no separate path line.
  4. **No path, same person:**
     - A disconnected `to` shows `MESSAGES.noRelationship`.
     - `from = to` shows "That’s the same person.".
  5. **Changing the pickers:** clearing **To** and choosing Mia updates `?to=` (replace) and shows "Mia Hale is your sister.".
  6. **Show on the tree:** calls `onShow(leo, steps)`.
  7. **Errors:** a NOT_FOUND from `relationship` shows the person-not-found message.

- [ ] **Step 5: Implement `pages/tree/RelationshipPanel.tsx`:**

```tsx
import {
  kinshipChain,
  kinshipTerm,
  type KinStep,
  type PersonSummary,
  type Relationship,
  type TreeDetail,
} from '@family-tree/shared';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { MESSAGES } from '../../auth/api';
import { FormError } from '../../components/forms';
import { PersonPhoto } from '../../components/PersonPhoto';
import { PersonPicker } from '../../components/PersonPicker';
import { usePersonHref } from '../../canvas/params';
import { personName } from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';

/** The headline and, when a term exists, the chain under it (decisions 21, 24). */
export function describeRelationship(rel: Relationship, meId: string | null) {
  const first = rel.persons[0]!;
  const last = rel.persons.at(-1)!;
  const steps = rel.steps ?? [];
  const possessive = first.id === meId ? 'your' : `${personName(first)}’s`;
  const term = kinshipTerm(steps);
  const chain = kinshipChain(steps, possessive);
  return term
    ? { headline: `${personName(last)} is ${possessive} ${term}.`, chain }
    : { headline: `${personName(last)} is ${chain}.`, chain: null };
}

type State =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rel: Relationship };

export function RelationshipPanel({
  treeId,
  detail,
  persons,
  onShow,
}: {
  treeId: string;
  detail: TreeDetail;
  persons: PersonSummary[];
  onShow: (fromId: string, steps: KinStep[]) => void;
}) {
  const api = useTreesApi();
  const hrefOf = usePersonHref(treeId);
  const [params, setParams] = useSearchParams();
  const meId = detail.me.personId;
  const from = params.get('from') || meId || detail.tree.rootPersonId;
  const to = params.get('to');
  const [state, setState] = useState<State>({ status: 'idle' });

  const choose = (key: 'from' | 'to') => (id: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (id) next.set(key, id);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    if (!from || !to) return setState({ status: 'idle' });
    let active = true;
    setState({ status: 'loading' });
    void api.relationship(treeId, from, to).then((r) => {
      if (!active) return;
      setState(r.ok ? { status: 'ready', rel: r.data } : { status: 'error', message: r.error.message });
    });
    return () => {
      active = false;
    };
  }, [api, treeId, from, to]);

  return (
    <div className="relationship-panel">
      <h2>How are we related?</h2>
      <PersonPicker label="From" persons={persons} value={from} onChange={choose('from')} clearLabel="Change" />
      <PersonPicker label="To" persons={persons} value={to} onChange={choose('to')} clearLabel="Change" />
      <div aria-live="polite">
        {state.status === 'loading' && <p role="status">Finding the path…</p>}
        {state.status === 'error' && <FormError>{state.message}</FormError>}
        {state.status === 'ready' && <Result rel={state.rel} meId={meId} hrefOf={hrefOf} onShow={onShow} />}
      </div>
    </div>
  );
}

function Result({
  rel,
  meId,
  hrefOf,
  onShow,
}: {
  rel: Relationship;
  meId: string | null;
  hrefOf: (id: string) => string;
  onShow: (fromId: string, steps: KinStep[]) => void;
}) {
  if (rel.steps === null) return <p>{MESSAGES.noRelationship}</p>;
  if (rel.steps.length === 0) return <p>That’s the same person.</p>;
  const { headline, chain } = describeRelationship(rel, meId);
  const steps = rel.steps;
  return (
    <>
      <p className="kin-headline">{headline}</p>
      {chain && <p>The path: {chain}</p>}
      <ol className="kin-path" aria-label="People on the path">
        {rel.persons.map((p) => (
          <li key={p.id}>
            <PersonPhoto url={p.photoThumbUrl} person={p} className="result-photo" />{' '}
            <Link to={hrefOf(p.id)}>{personName(p)}</Link>
          </li>
        ))}
      </ol>
      <button type="button" onClick={() => onShow(rel.persons[0]!.id, steps)}>
        Show on the tree
      </button>
    </>
  );
}
```

  Render the path list visually as "A → B → C" with CSS (`.kin-path li + li::before { content: '→ '; }`). Screen readers get the ordered list.

- [ ] **Step 6: The route and the workspace.**
  - **`routes.tsx`:** add `/trees/:treeId/relationship`, rendering `<TreePage />` inside `RequireAuth`, next to the union route.
  - **`CanvasToolbar.tsx`:** after the SearchBox, add a link **How are we related?**:

```tsx
<Link to={`/trees/${treeId}/relationship${canvasSearch(params, { tab: null, add: null, to: selectedId ?? null })}`}>
  How are we related?
</Link>
```

    The toolbar needs the current search params (`useSearchParams`) and the selected person id (a new `selectedId` prop from the workspace). `from` defaults in the panel.

  - **`TreeWorkspace.tsx`:**

```tsx
  const relationship = useMatch('/trees/:treeId/relationship') !== null;
  const [highlight, setHighlight] = useState<PathHighlight | null>(null);
  useEffect(() => {
    if (!relationship) setHighlight(null);
  }, [relationship]);
  const showPath = useCallback(
    (fromId: string, steps: KinStep[]) => {
      setHighlight(pathHighlight(fromId, steps));
      const n = closeRelativeSteps(steps);
      go(
        pathname,
        n <= GRAPH_DEPTH_MAX
          ? { view: null, branch: null, focus: fromId, depth: Math.max(1, n) }
          : { view: 'full', focus: null },
      );
    },
    [go, pathname],
  );
  const drawn = useMemo(
    () => (ready && highlight ? applyHighlight(ready.nodes, ready.edges, highlight) : ready),
    [ready, highlight],
  );
  const offView =
    highlight !== null &&
    ready !== null &&
    [...highlight.personIds].some((id) => !ready.graph.persons.some((p) => p.id === id));
```

    - `FamilyCanvas` gets `nodes={drawn.nodes}` and `edges={drawn.edges}`.
    - When `offView`, show `<p role="status" className="notice">Part of the path is outside this view. Try the full view.</p>`.
    - `selected` also counts `relationship`. The panel branch renders `<RelationshipPanel treeId detail persons onShow={showPath} />` when `relationship`.
    - `close()` also drops `from` and `to`.
    - In full view, a tree that `needsBranch` keeps its Phase 5 message, and the panel's path list stays usable.

  - **`TreeWorkspace.test.tsx`** additions:
    1. **The toolbar link:** **How are we related?** with Robert selected lands on `/trees/<id>/relationship?to=<robert>`, and the panel shows "Robert Hale is your grandfather.".
    2. **Show on the tree:**
       - It calls `getGraph` with `{ mode: 'focus', focus: leo, depth: 2 }`: Leo → Robert is two close-relative steps.
       - The path's person nodes get `is-path` (query `.react-flow__node.is-path`, as the Phase 5 canvas tests do with the mocks).
    3. **A long path:** with more than 3 steps it switches to `?view=full`.
    4. **Close** clears the highlight and drops `from` and `to` from the URL.

- [ ] **Step 7: CSS:**

```css
.react-flow__node.is-path .person-card { outline: 3px solid #f59e0b; outline-offset: 2px; }
.react-flow__node.is-path .union-dot { background: #f59e0b; }
.react-flow__edge.edge-path path { stroke: #f59e0b; stroke-width: 3; }
.kin-headline { font-size: 1.15rem; font-weight: 600; }
.kin-path { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 0.25rem 0.5rem; align-items: center; }
.kin-path li + li::before { content: '→ '; color: #6b7280; }
```

  Use the union dot's real class from `UnionNode.tsx` if it isn't `.union-dot`. Check that highlighted edges are visible in both normal and `edge-ended` styling.

- [ ] **Step 8: Run** the web tests, `pnpm lint` and `pnpm typecheck`. They pass.

- [ ] **Step 9: Commit** `feat(web): "How are we related?" with kinship wording and the path highlighted on the canvas`

---

## Task 17: Verification, docs, browser walk-through, manual checklist

- [ ] **Step 1: README.**
  - Add a section "**Photos, search and relationships (dev)**":
    - **Photos:** a person's **Photos** tab uploads JPEG, PNG or WebP up to 10 MB, with an optional square crop. The API re-encodes every photo and removes location (GPS) and camera details. It stores a 1600 px version and a 256 px thumbnail in SeaweedFS (dev) or R2 (prod).
    - **Signed URLs:** photos are only served through signed links that expire after 15 minutes. The bucket is private.
    - **Main photo:** **Make main photo** chooses the photo shown on the card. Deleting a photo is permanent (two clicks).
    - **Quota:** each tree has 1 GB of photos by default (`MAX_PHOTO_BYTES_PER_TREE`). Photos of people in Trash still count until the Trash is erased.
    - **Search:** **Search** in the toolbar finds people despite typos and accents, across every name, including maiden names and nicknames. **Filters** narrow by birth and death years, place, living or deceased, and branch. Results show how each person is related to you.
    - **How are we related?** shows the shortest family path between two people in plain English ("your father’s sister’s husband", "second cousin once removed"), and **Show on the tree** highlights it.
    - **Browser photo address:** in dev the browser loads photos from `http://localhost:8333` (`S3_PUBLIC_ENDPOINT`).
  - **"Known limitations":**
    - Remove the phase 6 items: no photos; a simple duplicate check; initials only on cards; no search or "How are we related?".
    - Add:
      - Photos of people in Trash count towards the quota until erased.
      - A crash in the middle of an upload can leave an unused stored file, which a later cleanup will remove (phase 7).
      - Relationship words are English only. Rare relationships fall back to the step-by-step description.
      - If Task 5 found that SeaweedFS doesn't enforce URL expiry, say so here.
- [ ] **Step 2: Full checks:**
  - `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm build`
  - Run gitleaks as CI does: `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.24.3 detect --source /repo --no-banner`. It must report no leaks. Signed URLs in test fixtures contain no real secrets.
  - Run `docker build -f apps/api/Dockerfile -t family-tree-api:phase6 .` and the sharp check from Task 1 Step 5 again.
  - Record the test counts (shared, API unit, API integration, web).
  - Re-run `node <scratchpad>/check-ages.mjs pnpm-lock.yaml <the commit before Task 1>` (find it with `git log --oneline`). Every new package is still `ok`.
- [ ] **Step 3: Rebuild the dev stack:** `pnpm down && pnpm dev`. The API log shows "Server listening", and the migrations 0005 and 0006 ran on the dev database.
- [ ] **Step 4: Test images.** Write `<scratchpad>/gen-photos.mjs` (outside the repo). It uses the repo's sharp through `createRequire(<repo>/apps/api/)`, and writes into `<scratchpad>/photos/`:
  - `gps.jpg`: 2400 × 1800, EXIF orientation 6, GPS, `Make: TestCam`, `Copyright: secret-copyright-marker`;
  - `portrait.png`: 900 × 1200;
  - `huge.jpg`: random noise, 6000 × 4000 at quality 100, which is over 10 MB;
  - `not-really.jpg`: GIF bytes;
  - `fake.png`: the text "hello".

  Run it with `node <scratchpad>/gen-photos.mjs <repo> <scratchpad>/photos`.

- [ ] **Step 5: Browser walk-through** (the controller does this, not a subagent), with Claude-in-Chrome on http://localhost:5173.
  - Use local test accounts generated in the scratchpad (`scratchpad/totp.mjs` for 2FA codes).
  - Upload files with the `file_upload` tool from `<scratchpad>/photos/`.
  1. **Setup:** `pnpm seed <owner email>`, then open "Sample family (seed)". You are Leo.
  2. **Upload with crop:**
     - Open Robert, then **Photos**. It says "No photos yet." and "Photos use 0 B of this tree’s 1.1 GB.".
     - **Add a photo** with `gps.jpg`. The cropper shows the photo **upright** (rotated by its EXIF orientation), with a centred square.
     - Zoom to 1.5, drag the square, then **Upload this part**.
     - "Photo added" shows, with one thumbnail and **Main photo**. The panel header shows it, and so does Robert's card on the canvas after the refresh.
  3. **Privacy checks:**
     - In the network panel, the thumbnail request goes to `http://localhost:8333/family-photos/trees/<tree>/photos/<id>/thumb.webp?X-Amz-…&X-Amz-Expires=900`, with status 200 and `cache-control: private, max-age=900`.
     - Copy the full-size link (the thumbnail's link target) and download it into the scratchpad with `curl -s "<url>" -o <scratchpad>/stored.webp`.
     - Then `node -e` with sharp `metadata()` on it gives `exif: undefined`, and `grep -c secret-copyright-marker <scratchpad>/stored.webp` gives 0.
     - The same URL **without** its query string is 403.
     - Never paste signed URLs into chat.
  4. **Second photo, main photo, delete:**
     - **Add a photo** with `portrait.png` and **Use the whole photo**. It isn't the main photo.
     - **Make main photo** moves the badge, and the card shows the portrait after a refetch (or a re-open).
     - **Delete**, then **Delete photo**, on the main one: the remaining photo becomes main.
     - `curl` of the deleted photo's old URL is 404.
  5. **Refusals:**
     - `huge.jpg` gives "Photos can be at most 10 MB." with no network request.
     - `not-really.jpg` gives "Use a JPEG, PNG or WebP photo." from the server (400, `reason: type`).
     - `fake.png` gives the same.
  6. **Search:**
     - Type "Margret" in **Search**. Margaret Hale appears with "Your grandmother", within about half a second, and no request per keystroke.
     - Click her: the panel opens and the canvas re-centres on her.
     - Type "ellis" (maiden name): Margaret. Type "hale robert": Robert first.
     - **Filters:**
       - Status **Deceased**: Robert and Margaret.
       - Place "toronto": Robert.
       - Born 1980 to 2000: Emma, Mia, Leo and Noah.
       - Born from 2000 to 1980: "From must not be after to" shows, and nothing is sent.
     - **Esc** closes the results.
  7. **How are we related?:**
     - With Emma selected, **How are we related?** shows "Emma Hale is your half-sister." and the path Leo → David → Emma.
     - **Show on the tree** highlights the three cards, the two union dots and the lines between them, in focus view at depth 2.
     - Change **From** to Noah and **To** to Laura: "Laura Hale is Noah Hale’s aunt by marriage." and "The path: Noah Hale’s mother’s brother’s wife".
     - **Show on the tree** switches to focus on Noah at depth 3 and highlights the path.
     - Add a disconnected person "Lone Test". To Lone Test: "They aren’t connected in this tree."
     - **Close** removes the highlight, and the URL loses `from` and `to`.
  8. **Duplicate check** still works: on Susan, "+" child "Noa Hale" asks "Is this the existing person Noah Hale (b. 1988)?".
  9. **Viewer** (a private window, the second account invited as viewer):
     - Photos and card thumbnails show.
     - The Photos tab has no **Add a photo**, **Make main photo** or **Delete**.
     - Search and **How are we related?** work. Their relation lines are empty if the viewer has no card.
  10. **Trash erase frees storage:**
      - Add "Photo Test" with a photo.
      - Delete the person and **Erase permanently** in Trash.
      - `curl` of the photo's old URL is 404, and the usage line on another person's Photos tab goes back down.
  11. **Mobile (390 × 844):**
      - The Photos tab in the bottom sheet shows a 2-column grid.
      - The cropper fits the width, and dragging the square works with touch emulation.
      - Search results span the width.
  12. **Console:** no errors. **Network:** no 500s.

  Chrome autofills the user's real saved login on sign-in and sign-up forms. Clear the fields before typing, never submit the user's real credentials, and never repeat test credentials in chat.
- [ ] **Step 6: Commit** any fixes, then `docs: photos, search and relationships`. Hand the user the summary and the manual checklist below, and wait for their result before merging.

**Manual checklist for the author** (about 25 minutes; have a phone photo with location data on your computer):
1. `pnpm dev`, then wait for "Server listening". Run `pnpm seed <your email>`, then open **Sample family (seed)**.
2. Click **Robert**, then **Photos**, then **Add a photo**, with a photo from your phone. It shows the right way up. Crop it, then **Upload this part**. It appears with **Main photo**, in the panel header and on Robert's card.
3. Open the photo full size (click it). Save it and check its properties in your OS: there is no location, camera or date information.
4. Add a second photo with **Use the whole photo**. Click **Make main photo** on it: the card changes. Delete one (two clicks).
5. Try a file over 10 MB, and a `.gif`: each is refused with a clear message.
6. In **Search**, type a name with a typo ("Margret"). Margaret appears with "Your grandmother". Click her: the tree centres on her.
7. Open **Filters**: **Deceased** shows Robert and Margaret, and the place "Toronto" shows Robert.
8. Select Emma, then **How are we related?**: "Emma Hale is your half-sister.". **Show on the tree** highlights the path.
9. Change **From** to Noah and **To** to Laura: "aunt by marriage", with "Noah Hale’s mother’s brother’s wife".
10. Sign in as a viewer in a private window: you see the photos but can't add or delete them.
11. Delete a person who has a photo, then **Erase permanently** in Trash. The tree's photo usage goes down.
12. `pnpm test && pnpm test:int`. Everything passes.

---

## Carry-forward notes for later phases

- **Phase 7 (export, deploy, E2E):**
  - **CSP for the static site** (add to the Phase 5 list):
    - `img-src 'self' data: blob: <S3_PUBLIC_ENDPOINT origin>`. In prod that is `https://<account>.r2.cloudflarestorage.com`. `blob:` is for the cropper's object URL.
    - `connect-src` needs only the API origin. Uploads go to the API, never straight to S3.
    - The cropper uses only canvas and `createImageBitmap`, so nothing more is needed.
    - The API's helmet defaults don't affect `<img>` loads from R2.
  - **R2 configuration:**
    - A private bucket: no public access and no custom domain. Presigned URLs only work on the S3 API domain.
    - `S3_ENDPOINT` and `S3_PUBLIC_ENDPOINT` are both `https://<account>.r2.cloudflarestorage.com`, with `S3_REGION=auto`.
    - An API token with Object Read & Write, scoped to that bucket only.
    - **Check in staging:**
      - a presigned GET works, and an expired one is 403;
      - `PutObject` without checksums (decision 8) is accepted;
      - `Cache-Control` comes back on GET.
    - R2 CORS isn't needed for `<img>`. Add it only if the web ever `fetch()`es objects.
  - **Backups of objects:**
    - The nightly `pg_dump` doesn't contain photos. Add a bucket backup, for example `rclone sync` from R2 to a second bucket or an `age`-encrypted archive, with retention aligned to the 14 dumps.
    - Document the restore order: database, then objects.
    - A database restored to before a deletion can name objects that are already gone. Those cards fall back to initials; add an admin note.
  - **Orphan sweep:**
    - A scheduled job lists `trees/` prefixes and compares them with `photos` rows and `storage_deletions`.
    - It removes objects older than a day that have no row. That covers a crash between upload and insert (decision 6).
    - It also alerts on `storage_deletions` rows with many attempts.
  - **Export ZIP:**
    - Add `photos/<person>-<n>.webp` from the full versions, streamed with `GetObject` through `ObjectStore`.
    - GEDCOM `OBJE` records point at them, and the primary photo is first.
  - **Production database privileges:**
    - `pg_trgm` and `unaccent` are trusted extensions, so migrations need a role that owns the database, or has `CREATE` on it.
    - If the "least privilege" app role can't create extensions, run migrations as the owner role, and the app as a role without DDL.
  - **E2E (Playwright):**
    - upload with `setInputFiles` (a GPS JPEG), then fetch the stored image through the API's response and assert there's no EXIF;
    - search with a typo;
    - "How are we related?" wording and the highlight;
    - the viewer can't upload.
    Reuse the Task 17 walk-through.
  - **Message catalog (spec §6 "Language"):** Phase 6 added many inline strings, in search, photos and the relationship panel. Move all page text into one catalog. The kinship vocabulary in `kinship.ts` is already centralised, and is the part a translation would replace.
- **Release-age gate (after 2026-11-23):** unchanged from Phase 5. sharp and the presigner are exact pins, and the gate would apply to their next upgrades.
- **Known trade-offs to revisit:**
  - **Search reads the graph:** `GET /search` loads the tree skeleton to word each result's relationship to you. That's fine for families. The Phase 5 cached-skeleton idea would help both.
  - **Signing cache:** it is per process and in memory. With several API instances, each signs on its own. That's harmless.
  - **Quota:** it counts Trash, by design (decision 14). There is no per-user byte quota (the spec has none). The tree owner can see usage on any Photos tab; an owner-only storage page could list the largest photos.
  - **Memory:** two concurrent decodes of up to 50 MP each is about 300 MB peak. Lower the limiter to 1 on smaller VPSs.
  - **The trigram threshold** (0.4 for search, 0.3 for the duplicate prefilter) was chosen from the sample family. Tune it with real data. Very short queries (1–2 letters) rely on the substring match.
