# Family Tree

An open-source, self-hostable web app for building a family tree together with your relatives.
Each side of the family is completed by the people who know it.

> Status: all seven planned phases are built. Two spec items are still open: moving 2FA to a new device (spec §5) and the single message catalog (spec §6). Not deployed yet.

## Local development

Requirements: Docker with Compose v2, Node 24, and pnpm via `corepack enable`.

```bash
pnpm install          # host install, for editor support and running tests
pnpm dev              # starts postgres, s3, api and web in Docker
pnpm seed             # in a second terminal: loads a sample family
pnpm seed you@example.com   # same, owned by that user (sign up first)
```

- Web: http://localhost:5173 — open it at `localhost`, not `127.0.0.1`: the API only accepts
  requests from the configured `WEB_ORIGIN` (`http://localhost:5173`).
- API health: http://localhost:3000/api/v1/health
- `pnpm dev` needs registry access only when `pnpm-lock.yaml` changed since the last container
  install; otherwise the `install` service prints `deps up to date` and the stack starts offline.
- The dev containers run as uid 1000 (the image's `node` user), so files they write into the repo
  are owned by a host user with that uid.
- If the `family_test` database is missing (a volume created before it was added), run `docker compose down -v` to recreate the volumes (this also wipes dev data — run `pnpm seed` again). Do the same if `install` fails with `EACCES` on an old root-owned volume.

Tests:

```bash
pnpm test             # unit tests (no Docker needed)
pnpm test:int         # integration tests (needs `pnpm dev` or `docker compose up -d postgres s3`)
```

## Accounts and two-step verification (dev)

- Create an account at http://localhost:5173/sign-up. No email is ever sent, so there is no verification step.
- Turn on two-step verification under **Account**: scan the QR code with any authenticator app (Google Authenticator, Authy, 1Password…) and save the 8 recovery codes it shows once.
- Forgot your password? Use **Forgot password?** with your email plus a current authenticator code or a recovery code.
- No authenticator? In development, print a one-time reset link (valid 24 hours) with:

  ```bash
  pnpm reset-link you@example.com
  ```

  In a later phase, tree owners will create these links in the app.

## Google sign-in (dev)

Optional; without it the Google button is hidden and everything else works.

1. Create a Google OAuth client of type **Web application** whose authorised redirect URI is
   `http://localhost:5173/api/auth/callback/google` (docs/self-hosting.md, "Google sign-in", has
   the console steps). While the client is in **Testing**, add your Google account as a test user.
2. Put both values in `.env.development.local` (git-ignored; `compose.yml` loads it when present):

   ```bash
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```

3. `docker compose up -d api`. `curl localhost:5173/api/v1/auth/providers` should say
   `{"google":true}`.

How it works:

- **Continue with Google** is on the sign-in and sign-up pages, and on an invite for a signed-out
  visitor; it comes back to where you started (same-site paths only).
- A Google email that already has a password account is **refused, never linked**: emails aren't
  verified, so the address alone proves nothing. Sign in with the password, then **Account →
  Google → Connect Google** (password again, plus a code when 2FA is on). **Disconnect Google** is
  only offered while the account has a password; a Google-only account can **set a password**
  there first, which it also needs before it can turn on two-step verification.
- Two-step verification applies to Google sign-ins too.
- Tests never call Google: integration tests answer Google's token endpoint themselves, and the
  E2E test (`e2e/tests/google.spec.ts`) stops at Google's authorization page. It skips when the
  stack has no Google client.

## Trees, invites and stewards (dev)

- **Start a tree** from _Your trees_. Owners must have two-step verification, so the page asks
  you to turn it on first. Each account can own up to `MAX_TREES_PER_USER` trees (default 3).
- **Invite links** are created on a tree's _Members and invites_ page. A link is shown once; you
  send it yourself through any channel. It is single-use, expires after 7 days, and can make the
  person a viewer or editor, optionally a branch steward, and optionally say which person they are.
- **Try stewards on a real branch:** `pnpm seed you@example.com` makes that account the owner of
  "Sample family (seed)" (10 people), so you can anchor a steward on e.g. Robert Hale.
- **Owner-issued reset links** come from the _Members_ page, for members without 2FA who belong to
  no tree you don't own.
- Deleted trees stay restorable by the owner for 30 days under _Deleted trees_.

## People and Trash (dev)

- Open a tree to see the people list. Click someone to open their panel (Info, Places, Photos,
  Relations, History).
- Add relatives from the Relations tab, or use **Add a person**. Dates can be exact, "about",
  "before", "after" or "between".
- Two people editing the same person at once can't overwrite each other: the second save is
  refused with a "someone else changed this person" message and can reload and retry.
- Deleting moves people or relations to the Trash, after a preview. Only the owner can restore or
  erase permanently. Stewards can delete inside their branch only.
- Trees deleted more than 30 days ago are purged hourly by the API (`TREE_PURGE_INTERVAL_MINUTES`,
  0 turns it off), or at once with `pnpm purge-trees`.

## The family canvas (dev)

- A tree opens in **Focus** view on the starting person: parents, siblings, partners and children.
  **Generations** (1–3) widens it. **Full** shows the whole tree, or one branch for trees above
  2,000 people.
- Click a card to open the person's panel; the view re-centres on them. Click a ● dot to edit a
  relationship.
- The **+** buttons on a card add a parent, sibling, partner or child. Every add first checks for
  likely duplicates ("Is this the existing person …?").
- Layout is automatic. The only drag is reordering siblings (or **Move earlier/later** in
  Relations).
- **Disconnected people (N)** lists anyone not connected to the starting person.
- `pnpm seed -- you@example.com --large 2500` adds "Large family (seed)" to try large trees.

## Photos, search and relationships (dev)

- **Photos:** a person's **Photos** tab uploads JPEG, PNG or WebP up to 10 MB, with an optional
  square crop. The API re-encodes every photo and removes location (GPS) and camera details. It
  stores a 1600 px version and a 256 px thumbnail in SeaweedFS (dev) or R2 (prod).
- **Signed URLs:** photos are only served through signed links that expire after 15 minutes. The
  bucket is private.
- **Main photo:** **Make main photo** chooses the photo shown on the card. Deleting a photo is
  permanent (two clicks).
- **Quota:** each tree has 1 GB of photos by default (`MAX_PHOTO_BYTES_PER_TREE`). Photos of people
  in Trash still count until the Trash is erased.
- **Search:** **Search** in the toolbar finds people despite typos and accents, across every name,
  including maiden names and nicknames. **Filters** narrow by birth and death years, place, living
  or deceased, and branch. Results show how each person is related to you.
- **How are we related?** shows the shortest family path between two people in plain English
  ("your father’s sister’s husband", "second cousin once removed"), and **Show on the tree**
  highlights it.
- **Browser photo address:** in dev the browser loads photos from `http://localhost:8333`
  (`S3_PUBLIC_ENDPOINT`).

## Export (dev)

- The tree owner opens **Tree settings → Export → Download export**. The download is one ZIP
  (`family-tree-YYYY-MM-DD.zip`): `tree.ged` (GEDCOM 5.5.1, UTF-8), `tree.json` (a complete copy of
  the data) and `photos/`.
- It includes details of living relatives, so keep it private. Only the owner can export, up to
  5 times an hour.

## End-to-end tests

Playwright drives a real browser against the dev stack.

1. Start the stack with the limits relaxed: `pnpm down && AUTH_RATE_LIMIT_ENABLED=false pnpm dev`.
   This switch is for development only (the API refuses it in production). It turns off Better
   Auth's sign-in, sign-up and 2FA limits, the invite limiters and the per-IP request cap, because
   the whole suite runs from one address.
2. Once: `pnpm --filter @family-tree/e2e exec playwright install --only-shell chromium`.
3. `pnpm test:e2e` runs the suite. Each run makes fresh accounts and re-seeds "Sample family
   (seed)", replacing any tree of that name in the dev database.
4. For the local production stack: `scripts/prod-local.sh up && pnpm test:e2e:prod-local` (a smoke
   test of TLS, the CSP, 2FA sign-up, a photo and an export).

Failures leave traces and screenshots in `e2e/test-results/`.

## Production and self-hosting

Nothing is deployed yet. The repository contains everything needed to run it: `compose.prod.yml`
(Caddy, the API and Postgres with a least-privilege app role), strict security headers for the
static site, nightly age-encrypted database backups with a photo mirror and a tested restore
(`docker/backup/`), and an orphan-photo sweep. `scripts/prod-local.sh` runs the whole production
stack on this machine only, with a local certificate authority and SeaweedFS standing in for R2;
`scripts/prod-local.sh backup-test` rehearses a backup and restore. See
[docs/self-hosting.md](docs/self-hosting.md) for a deployment of your own and
[docs/deployment.md](docs/deployment.md) for the author's runbook.

## Known limitations

- **Sign-up reveals registered emails.** Sign-up is open, and signing up with an email that
  already has an account fails with 422, so anyone can learn whether an email is registered.
  Sign-up is limited to 10 attempts per hour per IP. This is accepted because the app sends no
  email, so there is no "check your inbox" flow that could hide the difference.
- **Reset-with-code can be held at its limit.** Anyone who knows an email can keep that
  account's reset-with-code route answering 429 (5 attempts per 15 minutes per email). Sign-in is
  unaffected, since reset failures don't count toward the 2FA lockout.
- **Rate limits live in memory.** Both Fastify's and Better Auth's rate-limit counters are kept in
  the API process, so they reset on restart and are not shared between instances. The API is
  meant to run as a single instance; a second one would need a shared store first.
- **Moving 2FA to a new device** isn't available yet; an owner who loses their phone signs in
  with a recovery code.
- **Sibling order is per person:** a child of two unions has one position.
- **Photos in Trash count towards the quota** until the Trash is erased.
- **The upload waiter cap** (8 waiting, then 503) doesn't count request bodies that are still
  being read. Only the per-user limit of 30 uploads per 10 minutes bounds those.
- **A JSON body on the upload route** returns 400 with reason `type`, while other wrong content
  types get 415.
- **Search and the person pickers aren't a full combobox.** Their results are ordinary buttons you
  reach with Tab; there is no arrow-key navigation through the list yet. That is a known
  accessibility gap.
- **Relationship words are English only.** Rare relationships fall back to the step-by-step
  description.
- **Exports have no ZIP64:** about 3.5 GB of photos per tree at most.
- **GEDCOM 5.5.1 has no neutral partner roles or step-child type.** Same-sex couples are written
  as HUSB/WIFE by position, and step children get a note. `tree.json` keeps everything.
- **The export doesn't hide living people.** Only the owner can export.
- **The photo backup mirror isn't encrypted** (the database dump is).
- **E2E needs `AUTH_RATE_LIMIT_ENABLED=false`** on the dev stack.
- **Google sign-in skips the "trust this device" shortcut:** a user with 2FA enters a code on
  every Google sign-in, as with passwords (the app never offers it).
- **Connecting or disconnecting Google isn't in an audit log.** The audit log is per tree; a
  disconnect is only written to the API log (user id, no email).
- **One Google account per user.**

## License

[AGPL-3.0](LICENSE)
