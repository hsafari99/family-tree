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

- Web: http://localhost:5173
- API health: http://localhost:3000/api/v1/health

Tests:

```bash
pnpm test             # unit tests (no Docker needed)
pnpm test:int         # integration tests (needs `pnpm dev` or `docker compose up -d postgres s3`)
```

## License

[AGPL-3.0](LICENSE)
