# Deployment runbook (the author's instance)

> **Nothing here has been done yet.** No domain is pointed anywhere, no bucket exists and no
> server is running. This is the plan for the first deployment, to follow once the author
> decides to go. Each step points to a section of [self-hosting.md](self-hosting.md).

## Names

- Web (Cloudflare Pages): `family.cortextechservices.com`
- API (the VPS): `api.family.cortextechservices.com`
- R2 buckets: `family-photos` and `family-backups`
- Pages project: `family-tree`

## Order

1. R2: buckets, three tokens, the bucket lock (self-hosting section 4).
2. The age key, offline (section 5).
3. The VPS (section 6).
4. `.env.production` (section 7).
5. The image release (section 8).
6. DNS for the API (section 9).
7. `docker compose ... up -d` (section 10).
8. Pages, with its build variables (section 11).
9. The custom domain on Pages.
10. The backup timer, then a practice restore (sections 12 and 13).
11. A browser walkthrough of the manual checklist in the Phase 7 plan.
12. Two-step verification on the author's own owner account.

## Rollback

- **Code:** set `API_IMAGE` back to the previous tag, then `pull` and `up -d`.
- **Data:** restore the last good dump (self-hosting section 13).

## First-deploy checks

- The R2 staging checks: presigned GET, 403 after expiry, `PutObject` without checksums,
  `Cache-Control` on GET.
- Extension privileges: `migrate` creates `pg_trgm` and `unaccent` as the owner role. Confirm with
  `\dx` in `psql`.
- The CSP with the real R2 origin: open the site and check the browser console for violations.
- The CI `e2e` job runs green on the first push (it has never run on GitHub).
- `family_owner` is a superuser (the Postgres image's default). Later, add a non-superuser
  migration role.
