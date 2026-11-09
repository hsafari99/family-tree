import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export function createDb(url: string) {
  const sql = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzle({ client: sql, schema });
  return { db, sql };
}

export type Db = ReturnType<typeof createDb>['db'];

/** A transaction handle; same query API as Db. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Anything queries can run on: the pool or an open transaction. */
export type Queryable = Db | Tx;
