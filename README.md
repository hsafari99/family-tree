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
```

- Web: http://localhost:5173 — open it at `localhost`, not `127.0.0.1`: the API only accepts
  requests from the configured `WEB_ORIGIN` (`http://localhost:5173`).
- API health: http://localhost:3000/api/v1/health
- `pnpm dev` needs registry access only when `pnpm-lock.yaml` changed since the last container
  install; otherwise the `install` service prints `deps up to date` and the stack starts offline.
- The dev containers run as uid 1000 (the image's `node` user), so files they write into the repo
  are owned by a host user with that uid.
- If the `family_test` database is missing (a volume created before it was added), run `docker compose down -v` to recreate the volumes.

Tests:

```bash
pnpm test             # unit tests (no Docker needed)
pnpm test:int         # integration tests (needs `pnpm dev` or `docker compose up -d postgres s3`)
```

## License

[AGPL-3.0](LICENSE)
