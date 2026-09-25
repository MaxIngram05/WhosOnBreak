/**
 * The test adapter: Postgres compiled to WebAssembly, running in-process.
 *
 * Tests hit a real Postgres -- real constraints, real partial indexes, real
 * error codes -- with no Docker daemon and nothing to install, which matters
 * because the tests have to run on the machine this is being developed on and
 * that machine is Windows.
 *
 * It is not a mock. If a CHECK constraint in the migration is wrong, these
 * tests fail in exactly the way production would.
 */

import { PGlite } from "@electric-sql/pglite";
import type { Database, Sql } from "./sql.ts";

function wrap(client: PGlite, depth: number): Sql {
  return {
    async query<Row>(text: string, params: readonly unknown[] = []) {
      const result = await client.query<Row>(text, params as unknown[]);
      return result.rows;
    },

    async exec(text: string) {
      await client.exec(text);
    },

    async transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
      if (depth > 0) return fn(wrap(client, depth + 1));

      await client.exec("BEGIN");
      try {
        const result = await fn(wrap(client, depth + 1));
        await client.exec("COMMIT");
        return result;
      } catch (error) {
        await client.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

export async function createPgliteDatabase(): Promise<Database> {
  const client = await PGlite.create();
  const sql = wrap(client, 0);

  return {
    query: sql.query,
    exec: sql.exec,
    transaction: sql.transaction,
    async close() {
      await client.close();
    },
  };
}
