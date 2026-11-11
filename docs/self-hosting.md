# Self-hosting Family Tree

> **Nothing in this document has been run against real services yet.** Phase 7 only prepared the
> files. Everything here was checked on one machine against a local stand-in (Caddy's local CA,
> SeaweedFS instead of R2). Nothing is deployed, published or pushed. Expect to find small
> differences on the first real run, and fix this file when you do.

## 1. What you get

```
Browser ──► Cloudflare Pages (static web app, strict CSP headers)
   │
   ├──► api.family.<domain>  ──► Caddy (TLS) ──► API (Node) ──► Postgres
   │        (your VPS)                                  │
   └──► Cloudflare R2 (private bucket) ◄── presigned URLs, issued by the API
```

- **VPS:** Caddy, the API and Postgres run in Docker Compose (`compose.prod.yml`).
- **Cloudflare Pages:** the web app (static files).
- **Cloudflare R2:** the photos, in a private bucket. The browser fetches them with short-lived
  signed URLs that only the API can issue.
- **Cost:** a Hetzner CX22 is about 4 to 5 euros a month. Pages is free. R2 is free up to 10 GB.

## 2. Try it locally first

`scripts/prod-local.sh` runs the same compose file on this machine only: Caddy uses its own local
CA instead of Let's Encrypt, SeaweedFS stands in for R2, and Caddy serves the web build instead
of Pages. Everything binds to `127.0.0.1` (ports 8080 and 8443). Its generated settings live in
`.prod-local/` (never committed).

| Command                              | What it does                                               |
| ------------------------------------ | ---------------------------------------------------------- |
| `scripts/prod-local.sh up`           | Builds the web app and images, starts, checks health.      |
| `scripts/prod-local.sh down`         | Stops the stack and keeps its data.                        |
| `scripts/prod-local.sh reset`        | Stops it and deletes its volumes.                          |
| `scripts/prod-local.sh backup-test`  | Backs up, wipes, restores and verifies (needs `up` first). |
| `scripts/prod-local.sh compose ARGS` | Any `docker compose` command against this stack.           |

To use it **in a browser** (these steps are manual and need `sudo`):

1. Add `127.0.0.1 family.test api.family.test s3.family.test` to `/etc/hosts`.
2. Trust the local CA. For Chrome on Linux:
   `certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n family-tree-local -i .prod-local/ca/root.crt`
   (remove it later with `certutil -d sql:$HOME/.pki/nssdb -D -n family-tree-local`).
3. Open `https://family.test:8443`.

`pnpm test:e2e:prod-local` runs the smoke test against this stack without any of that.

## 3. Before you start

- A domain whose DNS is on Cloudflare.
- A GitHub account (for the API image).
- An SSH key.
- [`age`](https://github.com/FiloSottile/age) on your own computer.
- Two names under one registrable domain, for example `family.<domain>` (web) and
  `api.family.<domain>` (API). They must share the registrable domain: the session cookies are
  `SameSite=Lax` (spec section 8).

## 4. Cloudflare R2

1. Create two **private** buckets, `family-photos` and `family-backups`. Give neither a public
   access setting or a custom domain. Signed URLs only work on the S3 API endpoint.
2. Create three API tokens:
   - Object Read & Write on `family-photos`, for the app;
   - Object Read & Write on `family-backups`, for the backups;
   - **Object Read only** on `family-photos`, for the nightly mirror (`BACKUP_PHOTOS_*`).
     Recommended: a stolen backup token then cannot change the live photos.
3. On `family-backups`, add a **bucket lock rule** that keeps objects for at least 15 days, so a
   compromised server cannot delete the backups. R2 has no object versioning; on another
   provider, turn versioning on instead.
4. Note the endpoint `https://<account-id>.r2.cloudflarestorage.com`.
5. No CORS configuration is needed: the browser never uploads to the bucket.
6. **Check in a staging bucket first** (these are not verified against R2 yet):
   - a presigned GET works, and an expired one gives 403;
   - `PutObject` without checksums is accepted;
   - `Cache-Control` comes back on GET.

## 5. The age key (on your own computer)

```bash
age-keygen -o family-tree-backup.key
```

Keep the file offline, in two places. **Without it no backup can be restored.** Copy the
`age1...` public key it prints: that is `AGE_RECIPIENT`. The private key never goes on the server
except briefly during a restore.

## 6. The server

1. Create a Hetzner CX22 running Debian 13, with your SSH key.
2. Set `PasswordAuthentication no` in `/etc/ssh/sshd_config`.
3. Firewall: `ufw allow 22/tcp`, `ufw allow 80/tcp`, `ufw allow 443/tcp`, `ufw allow 443/udp`,
   then `ufw enable`.
4. Turn on unattended upgrades (`apt install unattended-upgrades`).
5. Install Docker Engine with the Compose plugin.
6. `git clone <your fork or this repository> /opt/family-tree`.

## 7. Configure

```bash
cd /opt/family-tree
cp .env.production.example .env.production
chmod 600 .env.production
```

Fill in every empty value. Generate each secret with `openssl rand -hex 32`. The comments in
`.env.production.example` explain each variable; in short:

- `API_IMAGE`, `API_DOMAIN`, `ACME_EMAIL`: the image to run, the API's public name, and the
  Let's Encrypt contact.
- `POSTGRES_PASSWORD` (owner role: migrations and backups) and `APP_DB_PASSWORD` (the API's role,
  which has no DDL rights).
- `WEB_ORIGIN`, `AUTH_BASE_URL`, `SESSION_SECRET`.
- `S3_*`: the R2 endpoint (used for both `S3_ENDPOINT` and `S3_PUBLIC_ENDPOINT`), the bucket and
  the read-write token. Signed photo URLs are path-style (`https://<account-id>.r2.cloudflarestorage.com/family-photos/...`),
  so they stay on the one origin the web app's CSP allows. `compose.prod.yml` sets
  `S3_FORCE_PATH_STYLE=true` itself, and the API refuses to start in production with it `false`.
- `AGE_RECIPIENT`, `BACKUP_PHOTOS_*`, `BACKUP_S3_*`, `BACKUP_ROOT`: see "Backups".
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: optional, see "Google sign-in". Leave both blank to
  keep Google sign-in off; the API refuses to start with only one of them.

Never commit it: `.gitignore` covers `.env.production`, and CI runs gitleaks.

## 8. The API image

Either:

- run the **Release API image** workflow (Actions, Run workflow, with a tag like `2026.11.1`). It
  is manual only and pushes `ghcr.io/<you>/family-tree-api:<tag>`. Then set
  `API_IMAGE=ghcr.io/<you>/family-tree-api:<tag>`. If the package is private, `docker login
ghcr.io` on the server first; or
- build on the server: keep `API_IMAGE=family-tree-api:local` and add `--build` to the commands
  below.

## 9. DNS

Create an `A` (and `AAAA`) record from `api.family.<domain>` to the VPS, **DNS only** (grey
cloud), so Caddy can get its certificate.

## 10. Start

```bash
docker compose --env-file .env.production -f compose.prod.yml pull
docker compose --env-file .env.production -f compose.prod.yml up -d
docker compose --env-file .env.production -f compose.prod.yml ps
curl https://api.family.<domain>/api/v1/health
```

`migrate` (a one-shot service) runs first, as the owner role; the API starts after it succeeds.
The health check should answer `{"status":"ok",...}`.

`compose.prod.yml` is standalone on purpose: it is never combined with the development
`compose.yml`, so nothing from development (published database ports, seed data) can leak in.

## 11. The web app on Cloudflare Pages

- **Git integration:** build command
  `pnpm install --frozen-lockfile && pnpm --filter "@family-tree/web..." build`, output directory
  `apps/web/dist`. (The `...` also builds the shared package the web app needs.)
- **Build variables:** `NODE_VERSION=24`, `VITE_API_BASE_URL` (the API's origin) and
  `VITE_PHOTO_ORIGIN` (the R2 endpoint). The build fails without the last two on Pages.
- **Or from your computer**, after a local build with the same variables:
  `pnpm dlx wrangler@4.155.0 pages deploy apps/web/dist --project-name family-tree`.
- Add the custom domain `family.<domain>`.
- `dist/_headers` carries the strict Content-Security-Policy and other headers. There is no
  `404.html`, so Pages serves the app for every path.

## 12. Backups

1. Install the timer:
   ```bash
   sudo cp docker/backup/systemd/family-tree-backup.* /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now family-tree-backup.timer
   ```
2. Run one now to check:
   `docker compose --env-file .env.production -f compose.prod.yml run --rm backup`.

What is kept: the 14 newest database dumps (`BACKUP_KEEP`), and photos changed or deleted in the
last 14 runs. The dump is age-encrypted; the photo mirror is not (the photos are already private
to the bucket). Watch failures with `systemctl status family-tree-backup` and
`journalctl -u family-tree-backup`. Nothing alerts you yet.

## 13. Restore (practise it)

1. `docker compose --env-file .env.production -f compose.prod.yml stop api`
2. Copy the age key to the server for the moment: `/root/age.key`, `chmod 600`.
3. ```bash
   docker compose --env-file .env.production -f compose.prod.yml run --rm \
     -v /root/age.key:/run/age/identity.txt:ro restore restore.sh --force latest
   ```
   (or a dump name from `rclone lsf`). `--force` is needed when the database already has tables;
   without it the script refuses.
4. `shred -u /root/age.key`
5. `docker compose --env-file .env.production -f compose.prod.yml up -d`

Notes:

- The order is the database, then the photos.
- The dump is restored into a scratch database (`family_restore`) and checked there. Only then
  are the databases swapped by renaming, and the old one is dropped once the photos are back. A
  corrupt or wrong dump fails before the live database is touched.
- The database is always called `family` (the grants file names it); don't change `PGDATABASE`.
- Stop the backup timer during a restore (`sudo systemctl stop family-tree-backup.timer`, and
  start it again afterwards).
- The `restore` service is separate from `backup`: only it gets the read-write photo token.
- A database restored to before a deletion can name photos that are already gone. Those cards
  show initials. The orphan sweep removes extra objects a day later.
- Sessions created after the dump are gone, so everyone signs in again.
- `scripts/prod-local.sh backup-test` rehearses all of this locally.

## 14. Upgrades

Set a new `API_IMAGE` tag, then `pull` and `up -d`. Migrations run in `migrate`. After a
`git pull`, rebuild the backup image too (its scripts are baked in):
`docker compose --env-file .env.production -f compose.prod.yml --profile tools build backup`. For a Postgres
minor upgrade, change the image tag in `compose.prod.yml`. A major upgrade means dump and restore.

## 15. Operations

- **Logs:** `docker compose --env-file .env.production -f compose.prod.yml logs api` gives JSON
  with no personal data. Caddy keeps no access log.
- **Health:** `/api/v1/health`.
- **Purge and sweep:** both run inside the API on a timer. To run them by hand:
  `docker compose --env-file .env.production -f compose.prod.yml exec api node dist/trees/purge-cli.js --sweep`.
- **Rate limits** are in memory, which is right for one API instance.
- **Owner continuity:** transfer ownership to a successor you trust (spec section 5).
- **A user with a new or lost phone** moves two-step verification themselves, under **Account →
  Move to a new phone**, with their password and a current or recovery code. 2FA stays on
  throughout, so owners and stewards keep their powers; the API log shows
  `two_factor_move_started`, `two_factor_moved` (other sessions signed out) and
  `two_factor_move_failed`. Wrong codes there count toward the 15-minute 2FA lockout.

## 16. Security checklist

- [ ] Firewall allows only 22, 80, 443.
- [ ] SSH accepts keys only.
- [ ] `.env.production` is mode 600 and not committed.
- [ ] Postgres is not published, and the app role has no DDL rights.
- [ ] The containers drop all Linux capabilities (Caddy keeps only `NET_BIND_SERVICE`, Postgres a
      few it needs to start) and cannot gain privileges; the API, migrate and backup containers
      have read-only filesystems.
- [ ] The R2 tokens are scoped to one bucket each, and the mirror token is read-only.
- [ ] The age private key is offline.
- [ ] Owners and stewards have two-step verification on (the app requires it).
- [ ] If Google sign-in is on: the OAuth client's only redirect URI is the production callback,
      and its secret is only in `.env.production`.
- [ ] gitleaks passes in CI.

## 17. Google sign-in (optional)

Email and password sign-in works on its own. Google sign-in stays off (no button, no provider)
until both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.

### Create the OAuth client

In the [Google Cloud console](https://console.cloud.google.com/), create a project (for example
"Family Tree"), then open **Google Auth Platform**:

1. **Branding:** app name "Family Tree", a support email, the home page
   `https://family.cortextechservices.com`, and `cortextechservices.com` as an authorised domain.
2. **Audience:** user type **External**.
3. **Data access:** add only `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile`.
   These are the only scopes the app asks for. They are non-sensitive, so Google doesn't need to
   review the app before it can be published.
4. **Clients → Create client → Web application.** Under **Authorised redirect URIs** add exactly:

   ```
   https://api.family.cortextechservices.com/api/auth/callback/google
   ```

   No JavaScript origins are needed: the browser never calls Google's APIs itself. Use a separate
   client for development, whose redirect URI is `http://localhost:5173/api/auth/callback/google`
   (README, "Google sign-in (dev)"), so a development secret never works in production.

5. Copy the client ID and the client secret into `.env.production`. Copy the secret when it is
   shown: the console may not show it again (you can add a new secret later).
6. Restart the API and check:

   ```bash
   docker compose --env-file .env.production -f compose.prod.yml up -d api
   curl https://api.family.cortextechservices.com/api/v1/auth/providers   # {"google":true}
   ```

### Testing or In production

The **Audience** page has a publishing status:

- **Testing** (the default): only the **test users** you list there (up to 100 Google accounts)
  can sign in; Google shows anyone else an "Access blocked" page. Add family members' Google
  addresses as test users while you try it out.
- **In production** (**Publish app**): any Google account can sign in. With only the three scopes
  above there is no verification review. Uploading a logo can trigger a brand check by Google.

Sign-up is open either way (spec §5); the publishing status only decides who can use the Google
button.

### How it behaves

- **A new Google user** gets an account named from their Google profile. An invite link opened
  while signed out comes back to the invite after Google, ready to join.
- **No linking by email.** Emails are never verified here, so anyone could have registered someone
  else's address with a password. A Google sign-in whose email already has an account is refused
  with "An account with this email already exists. Sign in with your password, then connect
  Google in Account settings."
- **Connect Google** (Account settings, signed in) asks for the password again, plus an
  authenticator or recovery code when two-step verification is on. The Google address may differ
  from the account's email. **Disconnect Google** asks for the same, and is offered only while
  the account has a password. An account that only uses Google can set a password there first,
  within 10 minutes of a Google sign-in; that signs out its other sessions.
- **Wrong codes on Connect or Disconnect Google are capped by those routes' rate limit** (5
  attempts per 15 minutes), not by the two-step verification lockout, which counts failed
  sign-ins and failed codes when moving to a new phone.
- **Two-step verification still applies.** A user with 2FA who signs in with Google gets no
  session until they enter an authenticator or recovery code, so owners and stewards keep their
  guarantee. Google sign-ins never offer "trust this device": the code is asked every time.
- **Headers and CSP need no change.** "Continue with Google" asks the API for Google's address
  (`connect-src` already allows the API) and then moves the whole page there, which the CSP
  doesn't restrict; nothing is loaded from Google into the app. Google sends the browser back to
  the API's callback as a top-level GET, so the `SameSite=Lax` cookies arrive, and the API
  redirects to the web app. There are no pop-ups, so `Cross-Origin-Opener-Policy: same-origin`
  is fine.
- **Rotating the secret:** add a new secret to the client, put it in `.env.production`, restart
  the API, then delete the old secret.
