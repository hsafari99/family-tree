# Family Tree

An open-source, self-hostable web app for building a family tree together with your relatives.
Each side of the family is completed by the people who know it.

> Status: early development (phase 1 — foundation).

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
- **Moving 2FA to a new device** isn't possible yet (planned for phase 7). An owner who loses
  their phone signs in with a recovery code.
- **Sibling order is per person:** a child of two unions has one position.
- **Photos in Trash count towards the quota** until the Trash is erased.
- **An API crash between storing a photo and committing** leaves an orphan object that the
  deletion outbox doesn't track. A cleanup sweep for these is planned for phase 7.
- **The upload waiter cap** (8 waiting, then 503) doesn't count request bodies that are still
  being read. Only the per-user limit of 30 uploads per 10 minutes bounds those.
- **A JSON body on the upload route** returns 400 with reason `type`, while other wrong content
  types get 415.
- **Relationship words are English only.** Rare relationships fall back to the step-by-step
  description.

## License

[AGPL-3.0](LICENSE)
