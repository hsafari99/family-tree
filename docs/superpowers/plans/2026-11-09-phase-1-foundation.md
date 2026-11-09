# Phase 1 — Foundation: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a runnable monorepo where `docker compose up` starts Postgres, S3 storage (SeaweedFS), the API and the web app. The API validates its config, runs migrations for the core genealogy schema at startup and reports `/api/v1/health`. The web page shows that health status, a seed script creates a sample family, and CI runs everything.

**Architecture:** a pnpm workspace with `packages/shared` (Zod schemas and fuzzy dates), `apps/api` (Fastify, Drizzle and postgres-js, AWS S3 SDK) and `apps/web` (React and Vite).
- **Shared code:** `packages/shared` is consumed as TypeScript source in dev and tests through a `development` export condition, and as compiled `dist` in production builds.
- **Containers:** the dev containers bind-mount the repo and keep their own `node_modules` in named volumes.
- **Tests:** unit tests need no infrastructure. Integration tests (`*.int.test.ts`) run against the compose Postgres and S3, using a separate `family_test` database and bucket.

**Tech stack:**
- Node 24 and pnpm 12.18.0 (via corepack)
- TypeScript 6.0.3, Fastify 5.12.8, Drizzle ORM 0.45.4 with drizzle-kit 0.31.11, postgres 4.1.0, Zod 4.6.7, @aws-sdk/client-s3 3.1164.0
- React 19.3.1, Vite 8.3.7, Vitest 5.1.0
- Postgres 17 and SeaweedFS 4.00. MinIO no longer publishes images, so SeaweedFS is the S3-compatible dev store.

**Spec:** `docs/superpowers/specs/2026-11-09-family-tree-design.md`. This plan covers §11 phase 1.

**Deliberately left out of this phase**, with the phase that adds it:
- Auth tables and `created_by`/`updated_by` columns (phases 2–3, once users exist)
- `photos` and `primary_photo_id` (phase 6)
- `deletion_batches` and `deletion_batch_id` (phase 4)
- `pg_trgm` (phase 6)
- the prod compose file and Caddy (phase 7)

**Fuzzy dates:** precision isn't stored as a separate field. It is derived from the length of the partial ISO string: `YYYY` is a year, `YYYY-MM` a month and `YYYY-MM-DD` a day. This is equivalent to the spec's `precision` field.

---

## File map

```
family-tree/
├── package.json                 root scripts, dev tooling, packageManager pin
├── pnpm-workspace.yaml          workspace globs + pnpm settings
├── tsconfig.base.json           shared compiler options (NodeNext, strict, customConditions)
├── eslint.config.js             flat config, typescript-eslint
├── .prettierrc / .prettierignore
├── .editorconfig / .nvmrc / .gitignore
├── .gitleaks.toml               secret-scan config (allowlists dev-only files)
├── LICENSE                      AGPL-3.0 text
├── README.md                    what it is + dev quickstart
├── compose.yml                  dev stack: postgres, s3, install, api, web
├── .env.development             committed, dev-only values
├── .env.production.example      committed, empty placeholders
├── docker/
│   ├── dev.Dockerfile           node:24 image used by install/api/web dev services
│   ├── postgres/init/01-test-db.sql   creates family_test database
│   └── seaweedfs/s3.dev.json    dev S3 credentials
├── .github/workflows/ci.yml     secret scan, lint/type/test/int/build, docker build
├── packages/shared/
│   ├── package.json / tsconfig.json / tsconfig.build.json
│   └── src/
│       ├── index.ts             re-exports
│       ├── fuzzy-date.ts        FuzzyDate schema, precisionOf, sortYear
│       ├── fuzzy-date.test.ts
│       ├── api.ts               healthResponseSchema, apiErrorSchema
│       └── api.test.ts
├── apps/api/
│   ├── package.json / tsconfig.json / tsconfig.build.json
│   ├── vitest.config.ts         unit tests
│   ├── vitest.int.config.ts     integration tests (loads .env.development, test DB)
│   ├── drizzle.config.ts
│   ├── Dockerfile               production image
│   ├── drizzle/                 generated SQL migrations (committed)
│   ├── test/
│   │   ├── global-setup.ts      migrate test DB, ensure test bucket
│   │   └── test-config.ts       valid config object for unit tests
│   └── src/
│       ├── config.ts / config.test.ts
│       ├── app.ts / app.test.ts             buildApp: helmet, cors, error shape, routes
│       ├── routes/health.ts / health.test.ts / health.int.test.ts
│       ├── storage/s3.ts                    createS3, ensureBucket
│       ├── deps.ts                          createDeps(config): db, sql, s3, checks, close
│       ├── server.ts                        entry: config → migrate → bucket → listen
│       └── db/
│           ├── schema.ts                    trees, persons, unions, parent_child, residences
│           ├── schema.int.test.ts
│           ├── client.ts                    createDb
│           ├── migrate.ts                   runMigrations
│           ├── seed.ts / seed.int.test.ts   seedSampleFamily (idempotent)
│           └── seed-cli.ts                  CLI wrapper, refuses in production
└── apps/web/
    ├── package.json / tsconfig.json / vite.config.ts / index.html
    └── src/
        ├── main.tsx / App.tsx / styles.css
        ├── api/client.ts / client.test.ts   getHealth()
        ├── HealthStatus.tsx / HealthStatus.test.tsx
        └── test/setup.ts
```

---

### Task 1: Repository scaffold and tooling

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.editorconfig`, `.nvmrc`, `.gitignore`, `LICENSE`, `README.md`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "family-tree",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@12.18.0",
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "docker compose up --build",
    "down": "docker compose down",
    "seed": "docker compose exec api pnpm --filter @family-tree/api db:seed",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "test:int": "pnpm --filter @family-tree/api test:int",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "eslint": "10.14.0",
    "globals": "17.14.0",
    "prettier": "3.9.10",
    "typescript": "6.0.3",
    "typescript-eslint": "8.72.1"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - apps/*
  - packages/*
injectWorkspacePackages: true
```

(`injectWorkspacePackages` is required for `pnpm deploy` in the production Dockerfile, Task 12.)

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "customConditions": ["development"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "sourceMap": true,
    "noEmit": true
  }
}
```

- [ ] **Step 4: Create lint/format/editor files**

`eslint.config.js`:
```js
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/dist/**', '**/node_modules/**', 'apps/api/drizzle/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
);
```

`.prettierrc`:
```json
{ "singleQuote": true, "semi": true, "printWidth": 100, "trailingComma": "all" }
```

`.prettierignore`:
```
pnpm-lock.yaml
**/dist
apps/api/drizzle
LICENSE
docs/superpowers
```

`.editorconfig`:
```
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true
```

`.nvmrc`:
```
24
```

`.gitignore`:
```
node_modules/
dist/
coverage/
*.log
.DS_Store
.env.production
.env*.local
```

- [ ] **Step 5: Add the AGPL-3.0 license text**

Run: `curl -fsSL https://www.gnu.org/licenses/agpl-3.0.txt -o LICENSE && head -3 LICENSE`
Expected: the output contains `GNU AFFERO GENERAL PUBLIC LICENSE` and `Version 3, 19 November 2007`.

- [ ] **Step 6: Create `README.md`**

````markdown
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
````

- [ ] **Step 7: Install and check that tooling runs**

Run: `corepack enable && pnpm install`
Expected: the install succeeds and `pnpm-lock.yaml` is created. If pnpm reports ignored build scripts (for example `esbuild`), run `pnpm approve-builds` and approve `esbuild`, then re-run `pnpm install`.

Run: `pnpm lint && pnpm format:check`
Expected: both exit 0. Run `pnpm format` first if Prettier flags files.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo with lint, format and AGPL license"
```

---

### Task 2: Shared package and fuzzy dates

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/tsconfig.build.json`, `packages/shared/src/index.ts`, `packages/shared/src/fuzzy-date.ts`
- Test: `packages/shared/src/fuzzy-date.test.ts`

- [ ] **Step 1: Create the package files**

`packages/shared/package.json`:
```json
{
  "name": "@family-tree/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "files": ["dist"],
  "exports": {
    ".": {
      "development": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "zod": "4.6.7" },
  "devDependencies": { "typescript": "6.0.3", "vitest": "5.1.0", "@types/node": "24.19.2" }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src"]
}
```

`packages/shared/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "rootDir": "src",
    "outDir": "dist",
    "customConditions": []
  },
  "exclude": ["src/**/*.test.ts"]
}
```

Run: `pnpm install`
Expected: success.

- [ ] **Step 2: Write the failing tests** in `packages/shared/src/fuzzy-date.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { fuzzyDateSchema, precisionOf, sortYear } from './fuzzy-date.js';

describe('fuzzyDateSchema', () => {
  it.each([
    { qualifier: 'exact', date1: '1948-03-21' },
    { qualifier: 'about', date1: '1920' },
    { qualifier: 'before', date1: '1950-06' },
    { qualifier: 'after', date1: '2001' },
    { qualifier: 'between', date1: '1950', date2: '1955' },
    { qualifier: 'exact', date1: '2024-02-29' },
  ])('accepts %o', (value) => {
    expect(fuzzyDateSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ['bad format', { qualifier: 'exact', date1: '21/03/1948' }],
    ['month 13', { qualifier: 'exact', date1: '1948-13' }],
    ['Feb 30', { qualifier: 'exact', date1: '1948-02-30' }],
    ['Feb 29 on non-leap year', { qualifier: 'exact', date1: '2023-02-29' }],
    ['between without date2', { qualifier: 'between', date1: '1950' }],
    ['between with date2 before date1', { qualifier: 'between', date1: '1955', date2: '1950' }],
    ['date2 on non-between', { qualifier: 'about', date1: '1950', date2: '1955' }],
    ['unknown qualifier', { qualifier: 'circa', date1: '1950' }],
  ])('rejects %s', (_label, value) => {
    expect(fuzzyDateSchema.safeParse(value).success).toBe(false);
  });
});

describe('precisionOf', () => {
  it('derives precision from the string length', () => {
    expect(precisionOf('1920')).toBe('year');
    expect(precisionOf('1920-05')).toBe('month');
    expect(precisionOf('1920-05-17')).toBe('day');
  });
});

describe('sortYear', () => {
  it('uses the year of date1', () => {
    expect(sortYear({ qualifier: 'about', date1: '1920' })).toBe(1920);
    expect(sortYear({ qualifier: 'between', date1: '1950-02', date2: '1955' })).toBe(1950);
    expect(sortYear({ qualifier: 'exact', date1: '0987-01-01' })).toBe(987);
  });
});
```

- [ ] **Step 3: Run the tests and check they fail**

Run: `pnpm --filter @family-tree/shared test`
Expected: FAIL, because `./fuzzy-date.js` can't be resolved.

- [ ] **Step 4: Implement** `packages/shared/src/fuzzy-date.ts`

```ts
import { z } from 'zod';

export const DATE_QUALIFIERS = ['exact', 'about', 'before', 'after', 'between'] as const;
export type DateQualifier = (typeof DATE_QUALIFIERS)[number];
export type DatePrecision = 'year' | 'month' | 'day';

const PARTIAL_DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number) as [number, number?, number?];
  if (month === undefined) return true;
  if (month < 1 || month > 12) return false;
  if (day === undefined) return true;
  const lastDay = new Date(0);
  lastDay.setUTCFullYear(year, month, 0); // day 0 of next month = last day of `month`
  return day >= 1 && day <= lastDay.getUTCDate();
}

const partialDate = z
  .string()
  .regex(PARTIAL_DATE, 'Use YYYY, YYYY-MM or YYYY-MM-DD')
  .refine(isRealCalendarDate, 'Not a real calendar date');

export const fuzzyDateSchema = z
  .object({
    qualifier: z.enum(DATE_QUALIFIERS),
    date1: partialDate,
    date2: partialDate.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.qualifier === 'between') {
      if (value.date2 === undefined) {
        ctx.addIssue({ code: 'custom', path: ['date2'], message: 'date2 is required for "between"' });
      } else if (value.date2 < value.date1) {
        ctx.addIssue({ code: 'custom', path: ['date2'], message: 'date2 must not be before date1' });
      }
    } else if (value.date2 !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['date2'], message: 'date2 is only allowed for "between"' });
    }
  });

export type FuzzyDate = z.infer<typeof fuzzyDateSchema>;

export function precisionOf(partial: string): DatePrecision {
  if (partial.length === 4) return 'year';
  if (partial.length === 7) return 'month';
  return 'day';
}

/** Year used for indexing, sorting and range filters (`*_sort_year` columns). */
export function sortYear(date: FuzzyDate): number {
  return Number(date.date1.slice(0, 4));
}
```

`packages/shared/src/index.ts`:
```ts
export * from './fuzzy-date.js';
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @family-tree/shared test && pnpm --filter @family-tree/shared typecheck`
Expected: all tests PASS, and the typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(shared): fuzzy date schema with precision and sort year"
```

---

### Task 3: Shared API contracts (health and error shape)

**Files:**
- Create: `packages/shared/src/api.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/api.test.ts`

- [ ] **Step 1: Write the failing test** in `packages/shared/src/api.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { apiErrorSchema, healthResponseSchema } from './api.js';

describe('healthResponseSchema', () => {
  it('accepts ok and degraded responses', () => {
    expect(
      healthResponseSchema.parse({ status: 'ok', checks: { db: 'ok', storage: 'ok' } }).status,
    ).toBe('ok');
    expect(
      healthResponseSchema.parse({ status: 'degraded', checks: { db: 'error', storage: 'ok' } })
        .checks.db,
    ).toBe('error');
  });

  it('rejects unknown statuses', () => {
    expect(
      healthResponseSchema.safeParse({ status: 'meh', checks: { db: 'ok', storage: 'ok' } })
        .success,
    ).toBe(false);
  });
});

describe('apiErrorSchema', () => {
  it('accepts the standard error envelope', () => {
    expect(
      apiErrorSchema.parse({ error: { code: 'NOT_FOUND', message: 'Not found' } }).error.code,
    ).toBe('NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm --filter @family-tree/shared test`
Expected: FAIL, because `./api.js` can't be resolved.

- [ ] **Step 3: Implement** `packages/shared/src/api.ts`

```ts
import { z } from 'zod';

export const checkStatusSchema = z.enum(['ok', 'error']);
export type CheckStatus = z.infer<typeof checkStatusSchema>;

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({ db: checkStatusSchema, storage: checkStatusSchema }),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const ERROR_CODES = [
  'VALIDATION',
  'NOT_FOUND',
  'FORBIDDEN',
  'CONFLICT',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'BAD_REQUEST',
  'INTERNAL',
] as const;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
```

Replace `packages/shared/src/index.ts` with:
```ts
export * from './api.js';
export * from './fuzzy-date.js';
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @family-tree/shared test && pnpm --filter @family-tree/shared typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(shared): health response and API error contracts"
```

---

### Task 4: API package and config validation

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/tsconfig.build.json`, `apps/api/vitest.config.ts`, `apps/api/src/config.ts`, `apps/api/test/test-config.ts`
- Test: `apps/api/src/config.test.ts`

- [ ] **Step 1: Create the package files**

`apps/api/package.json`:
```json
{
  "name": "@family-tree/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "files": ["dist", "drizzle"],
  "scripts": {
    "dev": "NODE_OPTIONS=--conditions=development tsx watch src/server.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:int": "vitest run --config vitest.int.config.ts",
    "db:generate": "drizzle-kit generate",
    "db:seed": "NODE_OPTIONS=--conditions=development tsx src/db/seed-cli.ts"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "3.1164.0",
    "@family-tree/shared": "workspace:*",
    "@fastify/cors": "11.4.1",
    "@fastify/helmet": "13.2.0",
    "drizzle-orm": "0.45.4",
    "fastify": "5.12.8",
    "postgres": "4.1.0",
    "zod": "4.6.7"
  },
  "devDependencies": {
    "@types/node": "24.19.2",
    "drizzle-kit": "0.31.11",
    "tsx": "4.23.15",
    "typescript": "6.0.3",
    "vitest": "5.1.0"
  }
}
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "test", "vitest.config.ts", "vitest.int.config.ts", "drizzle.config.ts"]
}
```

`apps/api/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "rootDir": "src", "outDir": "dist", "customConditions": [] },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

`apps/api/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.int.test.ts', '**/node_modules/**', '**/dist/**'],
  },
});
```

Run: `pnpm install && readlink apps/api/node_modules/@family-tree/shared`
Expected: the install succeeds, and `readlink` prints a path pointing to `packages/shared`, meaning it's a symlink. If it prints nothing, it's an injected copy, and dev and test would read stale shared source. In that case remove `injectWorkspacePackages: true` from `pnpm-workspace.yaml`, re-install, and in Task 12 use `pnpm --filter @family-tree/api deploy --legacy --prod /out`.

- [ ] **Step 2: Write the failing tests** in `apps/api/src/config.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const devEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://family:dev-only-pw@localhost:5432/family',
  WEB_ORIGIN: 'http://localhost:5173',
  SESSION_SECRET: 'dev-only-session-secret-change-me-0000000000',
  S3_ENDPOINT: 'http://localhost:8333',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'family-photos',
  S3_ACCESS_KEY_ID: 'dev-only-access-key',
  S3_SECRET_ACCESS_KEY: 'dev-only-secret-key',
  S3_FORCE_PATH_STYLE: 'true',
  S3_CREATE_BUCKET: 'true',
};

const prodEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://family:Str0ngPassw0rd@postgres:5432/family',
  WEB_ORIGIN: 'https://family.cortextechservices.com',
  SESSION_SECRET: 'test-only-prod-like-session-secret-0123456789abcdef',
  S3_ENDPOINT: 'https://0123456789abcdef.r2.cloudflarestorage.com',
  S3_REGION: 'auto',
  S3_BUCKET: 'family-photos',
  S3_ACCESS_KEY_ID: 'AKIAREALKEY',
  S3_SECRET_ACCESS_KEY: 'realsecretvalue',
};

describe('loadConfig', () => {
  it('parses a valid development env and applies defaults and coercion', () => {
    const config = loadConfig({ ...devEnv, PORT: '4000' });
    expect(config.PORT).toBe(4000);
    expect(config.HOST).toBe('0.0.0.0');
    expect(config.S3_FORCE_PATH_STYLE).toBe(true);
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('names the missing variable in the error', () => {
    const env: Record<string, string | undefined> = { ...devEnv };
    delete env.DATABASE_URL;
    expect(() => loadConfig(env)).toThrowError(ConfigError);
    expect(() => loadConfig(env)).toThrowError(/DATABASE_URL/);
  });

  it('rejects a short session secret', () => {
    expect(() => loadConfig({ ...devEnv, SESSION_SECRET: 'short' })).toThrowError(/SESSION_SECRET/);
  });

  it('accepts a valid production env', () => {
    expect(loadConfig(prodEnv).NODE_ENV).toBe('production');
  });

  it('rejects dev-only values in production', () => {
    expect(() =>
      loadConfig({ ...prodEnv, SESSION_SECRET: 'dev-only-session-secret-change-me-0000000000' }),
    ).toThrowError(/SESSION_SECRET/);
  });

  it('rejects http and localhost endpoints in production', () => {
    expect(() => loadConfig({ ...prodEnv, S3_ENDPOINT: 'http://localhost:8333' })).toThrowError(
      /S3_ENDPOINT/,
    );
    expect(() => loadConfig({ ...prodEnv, WEB_ORIGIN: 'http://family.example.com' })).toThrowError(
      /WEB_ORIGIN/,
    );
  });

  it('rejects automatic bucket creation in production', () => {
    expect(() => loadConfig({ ...prodEnv, S3_CREATE_BUCKET: 'true' })).toThrowError(
      /S3_CREATE_BUCKET/,
    );
  });
});
```

- [ ] **Step 3: Run the tests and check they fail**

Run: `pnpm --filter @family-tree/api test`
Expected: FAIL, because `./config.js` can't be resolved.

- [ ] **Step 4: Implement** `apps/api/src/config.ts`

```ts
import { z } from 'zod';

/** Every committed dev value contains this marker so production can refuse it. */
export const DEV_ONLY_MARKER = 'dev-only';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', 's3']);

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().min(1).default('0.0.0.0'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    WEB_ORIGIN: z.url(),
    SESSION_SECRET: z.string().min(32),
    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: bool.default(false),
    S3_CREATE_BUCKET: bool.default(false),
  })
  .superRefine((config, ctx) => {
    if (config.NODE_ENV !== 'production') return;

    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string' && value.includes(DEV_ONLY_MARKER)) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Development value not allowed in production' });
      }
    }
    for (const key of ['S3_ENDPOINT', 'WEB_ORIGIN'] as const) {
      const url = new URL(config[key]);
      if (url.protocol !== 'https:') {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Must use https in production' });
      }
      if (LOCAL_HOSTS.has(url.hostname)) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Must not point to a local host in production' });
      }
    }
    if (config.S3_CREATE_BUCKET) {
      ctx.addIssue({ code: 'custom', path: ['S3_CREATE_BUCKET'], message: 'Must be false in production' });
    }
  });

export type Config = z.infer<typeof configSchema>;

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
```

`apps/api/test/test-config.ts`, used by later unit tests:
```ts
import { loadConfig, type Config } from '../src/config.js';

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://family:dev-only-pw@localhost:5432/family_test',
    WEB_ORIGIN: 'http://localhost:5173',
    SESSION_SECRET: 'dev-only-session-secret-change-me-0000000000',
    S3_ENDPOINT: 'http://localhost:8333',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'family-photos-test',
    S3_ACCESS_KEY_ID: 'dev-only-access-key',
    S3_SECRET_ACCESS_KEY: 'dev-only-secret-key',
    S3_FORCE_PATH_STYLE: 'true',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @family-tree/api test && pnpm --filter @family-tree/api typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): validated config with production safety rules"
```

---

### Task 5: Fastify app, error shape and health route (unit level)

**Files:**
- Create: `apps/api/src/routes/health.ts`, `apps/api/src/app.ts`
- Test: `apps/api/src/routes/health.test.ts`, `apps/api/src/app.test.ts`

- [ ] **Step 1: Write the failing health route tests** in `apps/api/src/routes/health.test.ts`

```ts
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { healthRoutes, type HealthChecks } from './health.js';

const ok = async () => {};
const fail = async () => {
  throw new Error('down');
};
const hang = () => new Promise<void>(() => {});

async function call(checks: HealthChecks) {
  const app = Fastify();
  await app.register(healthRoutes, { checks, timeoutMs: 50 });
  const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
  await app.close();
  return res;
}

describe('GET /api/v1/health', () => {
  it('returns 200 when every check passes', async () => {
    const res = await call({ checkDb: ok, checkStorage: ok });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', checks: { db: 'ok', storage: 'ok' } });
  });

  it('returns 503 and names the failing check without leaking details', async () => {
    const res = await call({ checkDb: fail, checkStorage: ok });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', checks: { db: 'error', storage: 'ok' } });
    expect(res.body).not.toContain('down');
  });

  it('treats a hanging check as an error after the timeout', async () => {
    const res = await call({ checkDb: ok, checkStorage: hang });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.storage).toBe('error');
  });
});
```

- [ ] **Step 2: Write the failing app tests** in `apps/api/src/app.test.ts`

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { testConfig } from '../test/test-config.js';
import { buildApp } from './app.js';

const checks = { checkDb: async () => {}, checkStorage: async () => {} };
let app: ReturnType<typeof buildApp> | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('buildApp', () => {
  it('returns the standard error envelope for unknown routes', async () => {
    app = buildApp({ config: testConfig(), checks });
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  it('sets security headers', async () => {
    app = buildApp({ config: testConfig(), checks });
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('allows CORS only for the configured web origin', async () => {
    app = buildApp({ config: testConfig(), checks });
    const preflight = (origin: string) =>
      app!.inject({
        method: 'OPTIONS',
        url: '/api/v1/health',
        headers: { origin, 'access-control-request-method': 'GET' },
      });
    expect((await preflight('http://localhost:5173')).headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    expect(
      (await preflight('https://evil.example')).headers['access-control-allow-origin'],
    ).toBeUndefined();
  });

  it('hides internal error details behind a generic 500', async () => {
    app = buildApp({ config: testConfig(), checks });
    app.get('/boom', async () => {
      throw new Error('secret stack detail');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  });
});
```

- [ ] **Step 3: Run the tests and check they fail**

Run: `pnpm --filter @family-tree/api test`
Expected: FAIL, because `./health.js` and `./app.js` can't be resolved.

- [ ] **Step 4: Implement** `apps/api/src/routes/health.ts`

```ts
import type { CheckStatus, HealthResponse } from '@family-tree/shared';
import type { FastifyPluginAsync } from 'fastify';

export interface HealthChecks {
  checkDb(): Promise<void>;
  checkStorage(): Promise<void>;
}

async function probe(check: () => Promise<void>, timeoutMs: number): Promise<CheckStatus> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
    return 'ok';
  } catch {
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}

export const healthRoutes: FastifyPluginAsync<{ checks: HealthChecks; timeoutMs?: number }> = async (
  app,
  { checks, timeoutMs = 2000 },
) => {
  app.get('/api/v1/health', async (_req, reply) => {
    const [db, storage] = await Promise.all([
      probe(() => checks.checkDb(), timeoutMs),
      probe(() => checks.checkStorage(), timeoutMs),
    ]);
    const healthy = db === 'ok' && storage === 'ok';
    const body: HealthResponse = { status: healthy ? 'ok' : 'degraded', checks: { db, storage } };
    return reply.code(healthy ? 200 : 503).send(body);
  });
};
```

- [ ] **Step 5: Implement** `apps/api/src/app.ts`

```ts
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { ApiError } from '@family-tree/shared';
import Fastify, { type FastifyError } from 'fastify';
import type { Config } from './config.js';
import { healthRoutes, type HealthChecks } from './routes/health.js';

export interface AppOptions {
  config: Config;
  checks: HealthChecks;
}

export function buildApp({ config, checks }: AppOptions) {
  const app = Fastify({
    logger:
      config.LOG_LEVEL === 'silent'
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: ['req.headers.authorization', 'req.headers.cookie'],
          },
  });

  app.register(helmet);
  app.register(cors, { origin: [config.WEB_ORIGIN], credentials: true });
  app.register(healthRoutes, { checks });

  app.setNotFoundHandler((_req, reply) => {
    const body: ApiError = { error: { code: 'NOT_FOUND', message: 'Not found' } };
    return reply.code(404).send(body);
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err.validation) {
      const body: ApiError = { error: { code: 'VALIDATION', message: err.message } };
      return reply.code(400).send(body);
    }
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) req.log.error(err);
    const body: ApiError =
      status === 500
        ? { error: { code: 'INTERNAL', message: 'Something went wrong' } }
        : { error: { code: 'BAD_REQUEST', message: err.message } };
    return reply.code(status).send(body);
  });

  return app;
}
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @family-tree/api test && pnpm --filter @family-tree/api typecheck`
Expected: PASS. All config, health and app tests are green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(api): fastify app with security headers, CORS, error envelope and health route"
```

---

### Task 6: Dev infrastructure (Postgres and S3 in Docker)

**Files:**
- Create: `compose.yml`, `.env.development`, `docker/postgres/init/01-test-db.sql`, `docker/seaweedfs/s3.dev.json`, `.gitleaks.toml`

- [ ] **Step 1: Create `.env.development`.** It's committed, and every secret-like value contains `dev-only`.

```
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug
DATABASE_URL=postgres://family:dev-only-pw@localhost:5432/family
TEST_DATABASE_URL=postgres://family:dev-only-pw@localhost:5432/family_test
WEB_ORIGIN=http://localhost:5173
SESSION_SECRET=dev-only-session-secret-change-me-0000000000
S3_ENDPOINT=http://localhost:8333
S3_REGION=us-east-1
S3_BUCKET=family-photos
S3_ACCESS_KEY_ID=dev-only-access-key
S3_SECRET_ACCESS_KEY=dev-only-secret-key
S3_FORCE_PATH_STYLE=true
S3_CREATE_BUCKET=true
```

- [ ] **Step 2: Create the infrastructure config files**

`docker/postgres/init/01-test-db.sql`:
```sql
CREATE DATABASE family_test OWNER family;
```

`docker/seaweedfs/s3.dev.json`:
```json
{
  "identities": [
    {
      "name": "dev",
      "credentials": [{ "accessKey": "dev-only-access-key", "secretKey": "dev-only-secret-key" }],
      "actions": ["Admin", "Read", "Write", "List", "Tagging"]
    }
  ]
}
```

`.gitleaks.toml`:
```toml
[extend]
useDefault = true

[allowlist]
description = "Committed development-only values"
paths = ['''^\.env\.development$''', '''^docker/seaweedfs/s3\.dev\.json$''']
```

- [ ] **Step 3: Create `compose.yml`.** For now it has only the infrastructure services. `api` and `web` are added in Task 11.

```yaml
name: family-tree

services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: family
      POSTGRES_PASSWORD: dev-only-pw
      POSTGRES_DB: family
    ports: ['127.0.0.1:5432:5432']
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/postgres/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U family -d family']
      interval: 5s
      timeout: 3s
      retries: 20

  s3:
    image: chrislusf/seaweedfs:4.00
    command: server -s3 -s3.config=/etc/seaweedfs/s3.json -dir=/data -volume.max=10
    ports: ['127.0.0.1:8333:8333']
    volumes:
      - s3data:/data
      - ./docker/seaweedfs/s3.dev.json:/etc/seaweedfs/s3.json:ro
    healthcheck:
      test: ['CMD-SHELL', 'nc -z 127.0.0.1 8333']
      interval: 5s
      timeout: 3s
      retries: 30
      start_period: 10s

volumes:
  pgdata:
  s3data:
```

- [ ] **Step 4: Start and verify**

Run: `docker compose up -d --wait postgres s3 && docker compose ps`
Expected: both services are `healthy`.

Run: `docker compose exec postgres psql -U family -d family -c '\l' | grep family_test`
Expected: one line listing `family_test`.

Run: `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8333/`
Expected: `403`, meaning S3 is up and rejects unsigned requests. If the s3 service never turns healthy because `nc` isn't in the image, change its healthcheck test to `['CMD-SHELL', 'wget -q -O /dev/null http://127.0.0.1:8333/ 2>&1 | grep -q 403']` and re-run.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: dev postgres and seaweedfs S3 via docker compose"
```

---

### Task 7: Database schema, migrations and integration-test harness

**Files:**
- Create: `apps/api/src/db/schema.ts`, `apps/api/src/db/client.ts`, `apps/api/src/db/migrate.ts`, `apps/api/src/storage/s3.ts`, `apps/api/src/deps.ts`, `apps/api/drizzle.config.ts`, `apps/api/vitest.int.config.ts`, `apps/api/test/global-setup.ts`
- Generate: `apps/api/drizzle/0000_init.sql` (plus drizzle `meta/`)
- Test: `apps/api/src/db/schema.int.test.ts`

- [ ] **Step 1: Implement the schema** in `apps/api/src/db/schema.ts`

```ts
import type { FuzzyDate } from '@family-tree/shared';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const sexEnum = pgEnum('sex', ['female', 'male', 'other', 'unknown']);
export const unionTypeEnum = pgEnum('union_type', ['marriage', 'partnership']);
export const unionStatusEnum = pgEnum('union_status', [
  'married',
  'partners',
  'divorced',
  'separated',
  'widowed',
]);
export const parentChildKindEnum = pgEnum('parent_child_kind', [
  'biological',
  'adoptive',
  'step',
  'foster',
]);

const id = () => uuid('id').primaryKey().defaultRandom();
const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
const fuzzyDate = (name: string) => jsonb(name).$type<FuzzyDate>();

export const trees = pgTable('trees', {
  id: id(),
  name: text('name').notNull(),
  rootPersonId: uuid('root_person_id').references((): AnyPgColumn => persons.id),
  ...timestamps(),
});

export const persons = pgTable(
  'persons',
  {
    id: id(),
    treeId: uuid('tree_id')
      .notNull()
      .references(() => trees.id, { onDelete: 'cascade' }),
    givenName: text('given_name').notNull(),
    middleName: text('middle_name'),
    surname: text('surname'),
    maidenName: text('maiden_name'),
    nickname: text('nickname'),
    sex: sexEnum('sex').notNull().default('unknown'),
    birthDate: fuzzyDate('birth_date'),
    birthSortYear: integer('birth_sort_year'),
    birthPlace: text('birth_place'),
    deathDate: fuzzyDate('death_date'),
    deathSortYear: integer('death_sort_year'),
    deathPlace: text('death_place'),
    causeOfDeath: text('cause_of_death'),
    isLiving: boolean('is_living').notNull().default(true),
    occupation: text('occupation'),
    education: text('education'),
    biography: text('biography'),
    notes: text('notes'),
    siblingOrder: integer('sibling_order'),
    version: integer('version').notNull().default(1),
    ...timestamps(),
  },
  (t) => [index('persons_tree_idx').on(t.treeId)],
);

export const unions = pgTable(
  'unions',
  {
    id: id(),
    treeId: uuid('tree_id')
      .notNull()
      .references(() => trees.id, { onDelete: 'cascade' }),
    partnerAId: uuid('partner_a_id').references(() => persons.id, { onDelete: 'cascade' }),
    partnerBId: uuid('partner_b_id').references(() => persons.id, { onDelete: 'cascade' }),
    type: unionTypeEnum('type').notNull().default('marriage'),
    status: unionStatusEnum('status').notNull().default('married'),
    startDate: fuzzyDate('start_date'),
    endDate: fuzzyDate('end_date'),
    ...timestamps(),
  },
  (t) => [
    check('unions_has_partner', sql`${t.partnerAId} is not null or ${t.partnerBId} is not null`),
    index('unions_tree_idx').on(t.treeId),
    index('unions_partner_a_idx').on(t.partnerAId),
    index('unions_partner_b_idx').on(t.partnerBId),
  ],
);

export const parentChild = pgTable(
  'parent_child',
  {
    id: id(),
    treeId: uuid('tree_id')
      .notNull()
      .references(() => trees.id, { onDelete: 'cascade' }),
    unionId: uuid('union_id')
      .notNull()
      .references(() => unions.id, { onDelete: 'cascade' }),
    childId: uuid('child_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    kind: parentChildKindEnum('kind').notNull().default('biological'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('parent_child_union_child_uq').on(t.unionId, t.childId),
    index('parent_child_child_idx').on(t.childId),
  ],
);

export const residences = pgTable(
  'residences',
  {
    id: id(),
    treeId: uuid('tree_id')
      .notNull()
      .references(() => trees.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    place: text('place').notNull(),
    fromDate: fuzzyDate('from_date'),
    toDate: fuzzyDate('to_date'),
    ...timestamps(),
  },
  (t) => [index('residences_person_idx').on(t.personId)],
);
```

- [ ] **Step 2: Create the DB client, migrator, S3 helper and deps**

`apps/api/src/db/client.ts`:
```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export function createDb(url: string) {
  const sql = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzle({ client: sql, schema });
  return { db, sql };
}

export type Db = ReturnType<typeof createDb>['db'];
```

`apps/api/src/db/migrate.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Db } from './client.js';

// src/db/migrate.ts and dist/db/migrate.js both resolve to apps/api/drizzle
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder });
}
```

`apps/api/src/storage/s3.ts`:
```ts
import { CreateBucketCommand, HeadBucketCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import type { Config } from '../config.js';

export function createS3(config: Config): S3Client {
  return new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
  });
}

/** Dev/test only (guarded by S3_CREATE_BUCKET): create the bucket if it does not exist. */
export async function ensureBucket(s3: S3Client, bucket: string): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (err) {
    const missing =
      err instanceof S3ServiceException &&
      (err.$metadata.httpStatusCode === 404 || err.name === 'NotFound' || err.name === 'NoSuchBucket');
    if (!missing) throw err;
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}
```

`apps/api/src/deps.ts`:
```ts
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import type { Config } from './config.js';
import { createDb } from './db/client.js';
import type { HealthChecks } from './routes/health.js';
import { createS3 } from './storage/s3.js';

export function createDeps(config: Config) {
  const { db, sql } = createDb(config.DATABASE_URL);
  const s3 = createS3(config);
  const checks: HealthChecks = {
    checkDb: async () => {
      await sql`select 1`;
    },
    checkStorage: async () => {
      await s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
    },
  };
  return {
    db,
    sql,
    s3,
    checks,
    close: async () => {
      await sql.end({ timeout: 5 });
      s3.destroy();
    },
  };
}

export type Deps = ReturnType<typeof createDeps>;
```

- [ ] **Step 3: Generate the first migration**

`apps/api/drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
```

Run: `pnpm --filter @family-tree/api db:generate --name init`
Expected: this creates `apps/api/drizzle/0000_init.sql` and `apps/api/drizzle/meta/`.

Run: `grep -c 'CREATE TABLE' apps/api/drizzle/0000_init.sql && grep 'unions_has_partner' apps/api/drizzle/0000_init.sql`
Expected: the count is `5`, and the check constraint line is present.

- [ ] **Step 4: Create the integration-test harness**

`apps/api/vitest.int.config.ts`:
```ts
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

const fileEnv = parseEnv(readFileSync(new URL('../../.env.development', import.meta.url), 'utf8'));

// Assign before workers start so globalSetup and every test file see the same env.
Object.assign(process.env, fileEnv, {
  NODE_ENV: 'test',
  DATABASE_URL: fileEnv.TEST_DATABASE_URL,
  S3_BUCKET: 'family-photos-test',
  LOG_LEVEL: 'silent',
});

export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
```

`apps/api/test/global-setup.ts`:
```ts
import { loadConfig } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { createDeps } from '../src/deps.js';
import { ensureBucket } from '../src/storage/s3.js';

export default async function setup() {
  const config = loadConfig();
  const deps = createDeps(config);
  try {
    await runMigrations(deps.db);
    await ensureBucket(deps.s3, config.S3_BUCKET);
  } finally {
    await deps.close();
  }
}
```

- [ ] **Step 5: Write the failing schema integration test** in `apps/api/src/db/schema.int.test.ts`

```ts
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createDeps } from '../deps.js';
import { persons, trees, unions } from './schema.js';

const deps = createDeps(loadConfig());
const { db } = deps;

afterAll(async () => {
  await deps.close();
});

async function newTree() {
  const [tree] = await db.insert(trees).values({ name: `schema-test-${crypto.randomUUID()}` }).returning();
  return tree!;
}

describe('schema constraints', () => {
  it('rejects a union with no partners', async () => {
    const tree = await newTree();
    // Drizzle 0.45 wraps driver errors in DrizzleQueryError; the constraint name is on `cause`.
    await expect(db.insert(unions).values({ treeId: tree.id })).rejects.toMatchObject({
      cause: { constraint_name: 'unions_has_partner' },
    });
    await db.delete(trees).where(eq(trees.id, tree.id));
  });

  it('allows a union with a single known partner', async () => {
    const tree = await newTree();
    const [mum] = await db.insert(persons).values({ treeId: tree.id, givenName: 'Mum' }).returning();
    const [u] = await db.insert(unions).values({ treeId: tree.id, partnerAId: mum!.id }).returning();
    expect(u!.status).toBe('married');
    await db.delete(trees).where(eq(trees.id, tree.id));
  });

  it('cascades a hard tree delete to its people and unions', async () => {
    const tree = await newTree();
    const [p] = await db.insert(persons).values({ treeId: tree.id, givenName: 'Solo' }).returning();
    await db.insert(unions).values({ treeId: tree.id, partnerAId: p!.id });
    await db.delete(trees).where(eq(trees.id, tree.id));
    expect(await db.select().from(persons).where(eq(persons.treeId, tree.id))).toHaveLength(0);
    expect(await db.select().from(unions).where(eq(unions.treeId, tree.id))).toHaveLength(0);
  });

  it('stores fuzzy dates as JSON', async () => {
    const tree = await newTree();
    const [p] = await db
      .insert(persons)
      .values({
        treeId: tree.id,
        givenName: 'Old',
        birthDate: { qualifier: 'about', date1: '1920' },
        birthSortYear: 1920,
      })
      .returning();
    expect(p!.birthDate).toEqual({ qualifier: 'about', date1: '1920' });
    await db.delete(trees).where(eq(trees.id, tree.id));
  });
});
```

- [ ] **Step 6: Run the integration tests**

Run: `docker compose up -d --wait postgres s3 && pnpm test:int`
Expected: all 4 tests PASS. Global setup migrates `family_test` and creates the `family-photos-test` bucket.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(api): core genealogy schema, migrations and integration test harness"
```

---

### Task 8: Server entry point and health integration test

**Files:**
- Create: `apps/api/src/server.ts`
- Test: `apps/api/src/routes/health.int.test.ts`

- [ ] **Step 1: Write the failing integration test** in `apps/api/src/routes/health.int.test.ts`

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDeps } from '../deps.js';

const config = loadConfig();
const deps = createDeps(config);
const app = buildApp({ config, checks: deps.checks });

afterAll(async () => {
  await app.close();
  await deps.close();
});

describe('health against real Postgres and S3', () => {
  it('reports ok for db and storage', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.json()).toEqual({ status: 'ok', checks: { db: 'ok', storage: 'ok' } });
    expect(res.statusCode).toBe(200);
  });

  it('reports storage error for a bucket that does not exist', async () => {
    const broken = createDeps({ ...config, S3_BUCKET: 'bucket-that-does-not-exist' });
    const brokenApp = buildApp({ config, checks: broken.checks });
    const res = await brokenApp.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks).toEqual({ db: 'ok', storage: 'error' });
    await brokenApp.close();
    await broken.close();
  });
});
```

- [ ] **Step 2: Run it.** It should pass straight away, because it exercises code from Tasks 5 and 7 against real infrastructure.

Run: `pnpm test:int`
Expected: PASS, 6 tests in total. A failure here means the real wiring is wrong. Fix it before continuing.

- [ ] **Step 3: Implement** `apps/api/src/server.ts`

```ts
import { buildApp } from './app.js';
import { ConfigError, loadConfig, type Config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { createDeps } from './deps.js';
import { ensureBucket } from './storage/s3.js';

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const deps = createDeps(config);
await runMigrations(deps.db);
if (config.S3_CREATE_BUCKET) await ensureBucket(deps.s3, config.S3_BUCKET);

const app = buildApp({ config, checks: deps.checks });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await deps.close();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: config.HOST });
```

- [ ] **Step 4: Smoke-test the server on the host**

Run: `cd apps/api && node --env-file=../../.env.development --conditions=development --import tsx src/server.ts & sleep 6; curl -s http://localhost:3000/api/v1/health; kill %1; cd ../..`
Expected: `{"status":"ok","checks":{"db":"ok","storage":"ok"}}`.

Run: `cd apps/api && DATABASE_URL= node --env-file=../../.env.development --conditions=development --import tsx src/server.ts; echo "exit=$?"; cd ../..`
Expected: this prints `Invalid configuration:` with a line naming `DATABASE_URL`, then `exit=1`. Node's `--env-file` doesn't override variables already set, so the empty value takes effect.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): server entry with startup migrations and graceful shutdown"
```

---

### Task 9: Seed script with a sample family

**Files:**
- Create: `apps/api/src/db/seed.ts`, `apps/api/src/db/seed-cli.ts`
- Test: `apps/api/src/db/seed.int.test.ts`

The sample family covers each modelling case:

| Person | Notes |
|---|---|
| Robert Hale (1930–1998) + Margaret Hale, née Ellis (about 1932–2010) | Grandparents. Robert has 2 residences. |
| David Hale (1958), Susan Hale (1961) | Their children |
| David + Anna Price (1960) | Divorced. Daughter Emma (1985) |
| David + Laura Hale, née Grant (1962) | Married. Leo (1994, biological), Mia (1990, adoptive) |
| Susan + unknown partner | Single-partner union. Son Noah (1988) |

That's 10 people, 4 unions and 6 parent–child links. Emma and Leo are half-siblings, and the root is Leo.

- [ ] **Step 1: Write the failing test** in `apps/api/src/db/seed.int.test.ts`

```ts
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createDeps } from '../deps.js';
import { parentChild, persons, trees, unions } from './schema.js';
import { SEED_TREE_NAME, seedSampleFamily } from './seed.js';

const deps = createDeps(loadConfig());
const { db } = deps;

afterAll(async () => {
  await db.delete(trees).where(eq(trees.name, SEED_TREE_NAME));
  await deps.close();
});

describe('seedSampleFamily', () => {
  it('creates the sample family and is idempotent', async () => {
    await seedSampleFamily(db);
    const { treeId, rootPersonId } = await seedSampleFamily(db);

    expect(await db.select().from(trees).where(eq(trees.name, SEED_TREE_NAME))).toHaveLength(1);
    expect(await db.select().from(persons).where(eq(persons.treeId, treeId))).toHaveLength(10);
    expect(await db.select().from(unions).where(eq(unions.treeId, treeId))).toHaveLength(4);
    expect(await db.select().from(parentChild).where(eq(parentChild.treeId, treeId))).toHaveLength(6);

    const [tree] = await db.select().from(trees).where(eq(trees.id, treeId));
    const [root] = await db.select().from(persons).where(eq(persons.id, rootPersonId));
    expect(tree!.rootPersonId).toBe(rootPersonId);
    expect(root!.givenName).toBe('Leo');
  });

  it('models half-siblings through two unions that share David', async () => {
    const { treeId } = await seedSampleFamily(db);
    const named = async (givenName: string) =>
      (await db.select().from(persons).where(and(eq(persons.treeId, treeId), eq(persons.givenName, givenName))))[0]!;
    const [david, emma, leo] = [await named('David'), await named('Emma'), await named('Leo')];

    const davidsUnions = await db
      .select()
      .from(unions)
      .where(or(eq(unions.partnerAId, david.id), eq(unions.partnerBId, david.id)));
    expect(davidsUnions.map((u) => u.status).sort()).toEqual(['divorced', 'married']);

    const links = await db
      .select()
      .from(parentChild)
      .where(inArray(parentChild.childId, [emma.id, leo.id]));
    expect(new Set(links.map((l) => l.unionId)).size).toBe(2);
    expect(links.every((l) => davidsUnions.some((u) => u.id === l.unionId))).toBe(true);
  });

  it('includes an adoptive child and a single-partner union', async () => {
    const { treeId } = await seedSampleFamily(db);
    const adoptive = await db
      .select()
      .from(parentChild)
      .where(and(eq(parentChild.treeId, treeId), eq(parentChild.kind, 'adoptive')));
    expect(adoptive).toHaveLength(1);
    const single = await db
      .select()
      .from(unions)
      .where(and(eq(unions.treeId, treeId), isNull(unions.partnerBId)));
    expect(single).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm test:int`
Expected: FAIL, because `./seed.js` can't be resolved.

- [ ] **Step 3: Implement** `apps/api/src/db/seed.ts`

```ts
import { type FuzzyDate, sortYear } from '@family-tree/shared';
import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { parentChild, persons, residences, trees, unions } from './schema.js';

export const SEED_TREE_NAME = 'Sample family (seed)';

type NewPerson = Omit<typeof persons.$inferInsert, 'treeId' | 'birthSortYear' | 'deathSortYear'>;
type UnionStatus = NonNullable<(typeof unions.$inferInsert)['status']>;
type ChildKind = NonNullable<(typeof parentChild.$inferInsert)['kind']>;

const year = (y: number, qualifier: FuzzyDate['qualifier'] = 'exact'): FuzzyDate => ({
  qualifier,
  date1: String(y).padStart(4, '0'),
});

export async function seedSampleFamily(db: Db): Promise<{ treeId: string; rootPersonId: string }> {
  return db.transaction(async (tx) => {
    await tx.delete(trees).where(eq(trees.name, SEED_TREE_NAME));
    const [tree] = await tx.insert(trees).values({ name: SEED_TREE_NAME }).returning();
    if (!tree) throw new Error('Failed to create seed tree');
    const treeId = tree.id;

    const person = async (p: NewPerson) => {
      const [row] = await tx
        .insert(persons)
        .values({
          ...p,
          treeId,
          birthSortYear: p.birthDate ? sortYear(p.birthDate) : null,
          deathSortYear: p.deathDate ? sortYear(p.deathDate) : null,
        })
        .returning();
      if (!row) throw new Error(`Failed to create ${p.givenName}`);
      return row;
    };
    const union = async (
      a: { id: string },
      b: { id: string } | null,
      status: UnionStatus,
      start?: FuzzyDate,
      end?: FuzzyDate,
    ) => {
      const [row] = await tx
        .insert(unions)
        .values({ treeId, partnerAId: a.id, partnerBId: b?.id ?? null, status, startDate: start, endDate: end })
        .returning();
      if (!row) throw new Error('Failed to create union');
      return row;
    };
    const child = (u: { id: string }, c: { id: string }, kind: ChildKind = 'biological') =>
      tx.insert(parentChild).values({ treeId, unionId: u.id, childId: c.id, kind });

    const robert = await person({
      givenName: 'Robert', surname: 'Hale', sex: 'male', isLiving: false,
      birthDate: year(1930), birthPlace: 'Leeds, England',
      deathDate: year(1998), deathPlace: 'Toronto, Canada', causeOfDeath: 'Heart failure',
      occupation: 'Carpenter',
    });
    const margaret = await person({
      givenName: 'Margaret', surname: 'Hale', maidenName: 'Ellis', sex: 'female', isLiving: false,
      birthDate: year(1932, 'about'), deathDate: year(2010),
    });
    const david = await person({ givenName: 'David', surname: 'Hale', sex: 'male', birthDate: year(1958), siblingOrder: 1 });
    const susan = await person({ givenName: 'Susan', surname: 'Hale', sex: 'female', birthDate: year(1961), siblingOrder: 2 });
    const anna = await person({ givenName: 'Anna', surname: 'Price', sex: 'female', birthDate: year(1960) });
    const laura = await person({ givenName: 'Laura', surname: 'Hale', maidenName: 'Grant', sex: 'female', birthDate: year(1962) });
    const emma = await person({ givenName: 'Emma', surname: 'Hale', sex: 'female', birthDate: year(1985) });
    const mia = await person({ givenName: 'Mia', surname: 'Hale', sex: 'female', birthDate: year(1990), siblingOrder: 1 });
    const leo = await person({ givenName: 'Leo', surname: 'Hale', sex: 'male', birthDate: year(1994), siblingOrder: 2 });
    const noah = await person({ givenName: 'Noah', surname: 'Hale', sex: 'male', birthDate: year(1988) });

    const grandparents = await union(robert, margaret, 'widowed', year(1955));
    const davidAnna = await union(david, anna, 'divorced', year(1983), year(1989));
    const davidLaura = await union(david, laura, 'married', year(1992));
    const susanUnknown = await union(susan, null, 'partners');

    await child(grandparents, david);
    await child(grandparents, susan);
    await child(davidAnna, emma);
    await child(davidLaura, leo);
    await child(davidLaura, mia, 'adoptive');
    await child(susanUnknown, noah);

    await tx.insert(residences).values([
      { treeId, personId: robert.id, place: 'Leeds, England', fromDate: year(1930), toDate: year(1960) },
      { treeId, personId: robert.id, place: 'Toronto, Canada', fromDate: year(1960), toDate: year(1998) },
    ]);

    await tx.update(trees).set({ rootPersonId: leo.id }).where(eq(trees.id, treeId));
    return { treeId, rootPersonId: leo.id };
  });
}
```

`apps/api/src/db/seed-cli.ts`:
```ts
import { loadConfig } from '../config.js';
import { createDb } from './client.js';
import { runMigrations } from './migrate.js';
import { SEED_TREE_NAME, seedSampleFamily } from './seed.js';

const config = loadConfig();
if (config.NODE_ENV === 'production') {
  console.error('Refusing to seed sample data in production.');
  process.exit(1);
}

const { db, sql } = createDb(config.DATABASE_URL);
try {
  await runMigrations(db);
  const { treeId } = await seedSampleFamily(db);
  console.log(`Seeded "${SEED_TREE_NAME}" (tree ${treeId})`);
} finally {
  await sql.end();
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm test:int && pnpm --filter @family-tree/api typecheck && pnpm format`
Expected: all integration tests PASS, 9 in total, and the typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): idempotent sample-family seed covering remarriage, half-siblings and adoption"
```

---

### Task 10: Web app with health status

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/styles.css`, `apps/web/src/api/client.ts`, `apps/web/src/HealthStatus.tsx`, `apps/web/src/test/setup.ts`
- Test: `apps/web/src/api/client.test.ts`, `apps/web/src/HealthStatus.test.tsx`

- [ ] **Step 1: Create the package files**

`apps/web/package.json`:
```json
{
  "name": "@family-tree/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@family-tree/shared": "workspace:*",
    "react": "19.3.1",
    "react-dom": "19.3.1"
  },
  "devDependencies": {
    "@testing-library/dom": "10.4.2",
    "@testing-library/jest-dom": "7.0.1",
    "@testing-library/react": "16.3.3",
    "@types/node": "24.19.2",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.3.0",
    "jsdom": "31.0.0",
    "typescript": "6.0.3",
    "vite": "8.3.7",
    "vitest": "5.1.0"
  }
}
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client", "node"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`apps/web/vite.config.ts`:
```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000' },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

`apps/web/src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Family Tree</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Run: `pnpm install`
Expected: success.

- [ ] **Step 2: Write the failing tests**

`apps/web/src/api/client.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHealth } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
});

const respond = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

describe('getHealth', () => {
  it('returns the parsed body for 200', async () => {
    respond(200, { status: 'ok', checks: { db: 'ok', storage: 'ok' } });
    await expect(getHealth()).resolves.toEqual({ status: 'ok', checks: { db: 'ok', storage: 'ok' } });
  });

  it('returns the degraded body for 503 instead of throwing', async () => {
    respond(503, { status: 'degraded', checks: { db: 'error', storage: 'ok' } });
    await expect(getHealth()).resolves.toMatchObject({ status: 'degraded' });
  });

  it('throws on a malformed body', async () => {
    respond(200, { hello: 'world' });
    await expect(getHealth()).rejects.toThrow();
  });
});
```

`apps/web/src/HealthStatus.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HealthStatus } from './HealthStatus';

describe('HealthStatus', () => {
  it('shows a loading state first', () => {
    render(<HealthStatus load={() => new Promise(() => {})} />);
    expect(screen.getByText(/checking/i)).toBeInTheDocument();
  });

  it('shows all systems operational when healthy', async () => {
    render(<HealthStatus load={async () => ({ status: 'ok', checks: { db: 'ok', storage: 'ok' } })} />);
    expect(await screen.findByText('All systems operational')).toBeInTheDocument();
  });

  it('lists each check when degraded', async () => {
    render(
      <HealthStatus load={async () => ({ status: 'degraded', checks: { db: 'ok', storage: 'error' } })} />,
    );
    expect(await screen.findByText('Some services are down')).toBeInTheDocument();
    expect(screen.getByText('Storage: error')).toBeInTheDocument();
    expect(screen.getByText('Database: ok')).toBeInTheDocument();
  });

  it('says when the API is unreachable', async () => {
    render(
      <HealthStatus
        load={async () => {
          throw new Error('network');
        }}
      />,
    );
    expect(await screen.findByText('Cannot reach the API')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the tests and check they fail**

Run: `pnpm --filter @family-tree/web test`
Expected: FAIL, because `./client` and `./HealthStatus` can't be resolved.

- [ ] **Step 4: Implement**

`apps/web/src/api/client.ts`:
```ts
import { type HealthResponse, healthResponseSchema } from '@family-tree/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/api/v1/health`, { credentials: 'include' });
  return healthResponseSchema.parse(await res.json());
}
```

`apps/web/src/HealthStatus.tsx`:
```tsx
import type { HealthResponse } from '@family-tree/shared';
import { useEffect, useState } from 'react';
import { getHealth } from './api/client';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; health: HealthResponse }
  | { kind: 'unreachable' };

const LABELS = { db: 'Database', storage: 'Storage' } as const;

export function HealthStatus({ load = getHealth }: { load?: () => Promise<HealthResponse> }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    load().then(
      (health) => active && setState({ kind: 'ready', health }),
      () => active && setState({ kind: 'unreachable' }),
    );
    return () => {
      active = false;
    };
  }, [load]);

  if (state.kind === 'loading') return <p className="status">Checking services…</p>;
  if (state.kind === 'unreachable') return <p className="status status--bad">Cannot reach the API</p>;

  const { health } = state;
  return (
    <section className={`status ${health.status === 'ok' ? 'status--ok' : 'status--bad'}`}>
      <p>{health.status === 'ok' ? 'All systems operational' : 'Some services are down'}</p>
      <ul>
        {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((key) => (
          <li key={key}>{`${LABELS[key]}: ${health.checks[key]}`}</li>
        ))}
      </ul>
    </section>
  );
}
```

`apps/web/src/App.tsx`:
```tsx
import { HealthStatus } from './HealthStatus';

export function App() {
  return (
    <main className="app">
      <h1>Family Tree</h1>
      <p className="subtitle">Phase 1 — foundation</p>
      <HealthStatus />
    </main>
  );
}
```

`apps/web/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`apps/web/src/styles.css`:
```css
:root {
  color-scheme: light dark;
  font-family: system-ui, sans-serif;
}
body {
  margin: 0;
}
.app {
  max-width: 40rem;
  margin: 4rem auto;
  padding: 0 1rem;
}
.subtitle {
  opacity: 0.7;
}
.status {
  padding: 1rem;
  border-radius: 0.5rem;
  border: 1px solid currentColor;
}
.status--ok {
  color: #1a7f37;
}
.status--bad {
  color: #cf222e;
}
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm format && pnpm --filter @family-tree/web test && pnpm --filter @family-tree/web typecheck && pnpm lint`
Expected: PASS, 7 web tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): app shell showing API health status"
```

---

### Task 11: Full Docker dev stack (api and web in containers)

**Files:**
- Create: `docker/dev.Dockerfile`, `.dockerignore`
- Modify: `compose.yml` (add `install`, `api`, `web` services and volumes)

- [ ] **Step 1: Create `docker/dev.Dockerfile`**

```dockerfile
# Debian (glibc) to match typical dev hosts; later phases add native deps (sharp).
FROM node:24-bookworm-slim
RUN corepack enable
ENV npm_config_store_dir=/pnpm-store CI=true
WORKDIR /app
```

`.dockerignore`:
```
**/node_modules
**/dist
.git
.env.production
```

- [ ] **Step 2: Add the services to `compose.yml`.** Insert these under `services:`, after `s3`:

```yaml
  install:
    build: { context: ., dockerfile: docker/dev.Dockerfile }
    command: pnpm install --frozen-lockfile
    volumes: &app-volumes
      - .:/app
      - nm_root:/app/node_modules
      - nm_api:/app/apps/api/node_modules
      - nm_web:/app/apps/web/node_modules
      - nm_shared:/app/packages/shared/node_modules
      - pnpm_store:/pnpm-store

  api:
    build: { context: ., dockerfile: docker/dev.Dockerfile }
    command: pnpm --filter @family-tree/api dev
    env_file: .env.development
    environment:
      DATABASE_URL: postgres://family:dev-only-pw@postgres:5432/family
      S3_ENDPOINT: http://s3:8333
    ports: ['127.0.0.1:3000:3000']
    volumes: *app-volumes
    depends_on:
      install: { condition: service_completed_successfully }
      postgres: { condition: service_healthy }
      s3: { condition: service_healthy }

  web:
    build: { context: ., dockerfile: docker/dev.Dockerfile }
    command: pnpm --filter @family-tree/web dev --host 0.0.0.0
    environment:
      VITE_API_PROXY_TARGET: http://api:3000
    ports: ['127.0.0.1:5173:5173']
    volumes: *app-volumes
    depends_on:
      install: { condition: service_completed_successfully }
      api: { condition: service_started }
```

Replace the `volumes:` block at the bottom with:
```yaml
volumes:
  pgdata:
  s3data:
  nm_root:
  nm_api:
  nm_web:
  nm_shared:
  pnpm_store:
```

- [ ] **Step 3: Start the whole stack**

Run: `docker compose up --build -d && docker compose ps -a`
Expected: `install` shows `Exited (0)`, `postgres` and `s3` are `healthy`, and `api` and `web` are `running`.

Run: `curl -s http://localhost:3000/api/v1/health && curl -s http://localhost:5173/api/v1/health`
Expected: both print `{"status":"ok","checks":{"db":"ok","storage":"ok"}}`. The second request goes through the Vite proxy.

Run: `pnpm seed`
Expected: `Seeded "Sample family (seed)" (tree <uuid>)`.

Run: `docker compose exec postgres psql -U family -d family -tc "select count(*) from persons"`
Expected: `10`.

- [ ] **Step 4: Check hot reload**

Edit `apps/web/src/App.tsx` and change the subtitle text, then run `curl -s http://localhost:5173/src/App.tsx | grep -c '<new text>'`.
Expected: `1`. Revert the edit afterwards.

Run: `docker compose logs api --tail 20`
Expected: no errors. Saving `apps/api/src/app.ts` with a whitespace change triggers a restart line from tsx watch.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: run api and web in docker dev stack with hot reload"
```

---

### Task 12: Production API image and production env template

**Files:**
- Create: `apps/api/Dockerfile`, `.env.production.example`

- [ ] **Step 1: Create `apps/api/Dockerfile`**

```dockerfile
FROM node:24-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @family-tree/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @family-tree/api... build
RUN pnpm --filter @family-tree/api deploy --prod /out

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

- [ ] **Step 2: Create `.env.production.example`**

```
# Copy to .env.production on the server. Never commit the real file.
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
# Postgres runs in the same compose project; use a long random password.
DATABASE_URL=postgres://family:CHANGE_ME@postgres:5432/family
WEB_ORIGIN=https://family.cortextechservices.com
# 32+ random characters: `openssl rand -base64 48`
SESSION_SECRET=
# Cloudflare R2: https://<account-id>.r2.cloudflarestorage.com
S3_ENDPOINT=
S3_REGION=auto
S3_BUCKET=family-photos
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=false
S3_CREATE_BUCKET=false
```

- [ ] **Step 3: Build the image and check that it refuses bad config**

Run: `docker build -f apps/api/Dockerfile -t family-tree-api:local .`
Expected: the build succeeds. If `pnpm deploy` complains about injected workspace packages, check that `injectWorkspacePackages: true` is in `pnpm-workspace.yaml`.

Run: `docker run --rm --env-file .env.development -e NODE_ENV=production family-tree-api:local; echo "exit=$?"`
Expected: `Invalid configuration:`, with lines naming `SESSION_SECRET`, `S3_ENDPOINT`, `WEB_ORIGIN` and `S3_CREATE_BUCKET`, then `exit=1`.

Run: `docker run --rm family-tree-api:local ls drizzle dist | head`
Expected: the migration files and `server.js` are listed.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(api): production docker image and env template"
```

---

### Task 13: Continuous integration

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  secret-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm format:check
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: docker compose up -d --wait postgres s3
      - run: pnpm test:int
      - run: pnpm build

  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - run: docker build -f apps/api/Dockerfile -t family-tree-api:ci .
```

- [ ] **Step 2: Run CI's checks locally**

Run: `pnpm format && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:int && pnpm build`
Expected: every command exits 0. `pnpm build` builds `shared`, then `api` and `web`.

Run, if gitleaks is installed: `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest detect --source /repo --config /repo/.gitleaks.toml`
Expected: `no leaks found`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "ci: secret scan, lint, typecheck, unit and integration tests, docker build"
```

(The workflow first runs once the repo is pushed to GitHub. Pushing is done with the author, not in this plan.)

---

### Task 14: Phase verification and handoff

- [ ] **Step 1: Start from a clean state**

Run: `docker compose down -v && docker compose up --build -d && pnpm seed`
Expected: the stack comes up from empty volumes, and the seed prints the tree id.

- [ ] **Step 2: Check in the browser.** This is Claude's own check.
  1. Open http://localhost:5173 and confirm it shows "Family Tree", "Phase 1 — foundation" and **"All systems operational"**, with Database: ok and Storage: ok.
  2. Run `docker compose stop s3` and reload the page. It should show **"Some services are down"** and "Storage: error".
  3. Run `docker compose start s3`, wait about 15 seconds and reload. The page is back to operational.
  4. Run `docker compose stop api` and reload. It should show **"Cannot reach the API"**. Then run `docker compose start api`.
  5. Take a screenshot of each state for the report.

- [ ] **Step 3: Give the author this manual test checklist**

```
Phase 1 — what to try yourself (about 10 minutes)

1. cd ~/Documents/hosseinRepos/family-tree && pnpm install && pnpm dev
   → wait until the logs show "Server listening at http://0.0.0.0:3000"
2. Open http://localhost:5173
   → green box: "All systems operational", Database: ok, Storage: ok
3. Open http://localhost:3000/api/v1/health
   → {"status":"ok","checks":{"db":"ok","storage":"ok"}}
4. In a second terminal: pnpm seed
   → Seeded "Sample family (seed)" (tree …)
5. docker compose exec postgres psql -U family -d family -c "select given_name, surname, birth_sort_year from persons order by birth_sort_year"
   → 10 people from Robert (1930) to Leo (1994)
6. docker compose stop s3, then reload the page → red "Some services are down", Storage: error
   docker compose start s3 → back to green after ~15 s
7. Edit apps/web/src/App.tsx (change the subtitle) and save → the browser updates instantly
8. pnpm test && pnpm test:int → all green
9. Photo storage volume check: docker volume ls | grep family-tree
   → family-tree_pgdata and family-tree_s3data (your data persists across restarts)
10. pnpm down to stop (data kept). Use docker compose down -v only to wipe everything.
```

- [ ] **Step 4: Report the results**, with test counts, screenshots and any differences from this plan. Wait for the author's approval before starting phase 2.

---

## Carry-forward notes for later phases (from batch 2 review)

- Replace the 4xx→`BAD_REQUEST` mapping with an `AppError(code, status, message)` class and a status-to-code map before adding `FORBIDDEN`, `CONFLICT` and `RATE_LIMITED` (phases 2–3). Only messages from `AppError` reach clients.
- Set Fastify `trustProxy` when Caddy is in front (phase 7), so `req.ip` is the real client for rate limiting.
- Put `/api/v1/health` under the rate limiter when `@fastify/rate-limit` is added (phase 2).
- The logger's `redact` paths don't match Fastify's default serializers. Revisit them when sessions arrive (phase 2): redact cookies and `set-cookie`, and make sure error logs carry no personal data.
