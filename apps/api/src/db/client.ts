import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export function createDb(url: string) {
  const sql = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzle({ client: sql, schema });
  return { db, sql };
}

export type Db = ReturnType<typeof createDb>['db'];
