/**
 * The production adapter: Neon's serverless Postgres driver.
 *
 * Neon is plain Postgres -- our migrations are ordinary SQL files and
 * `pg_dump` walks away with everything -- but its driver speaks over
 * WebSocket/HTTP rather than raw TCP, which is what lets it run inside a
 * Cloudflare Worker where TCP sockets are not available.
 *
 * We use Pool rather than the simpler HTTP query function because replacing a
 * schedule's blocks has to be one transaction, and the HTTP interface cannot
 * hold one open.
 */

import { Pool, type PoolClient } from "@neondatabase/serverless";
import type { Database, Sql } from "./sql.ts";

function wrapClient(client: PoolClient, depth: number): Sql {
  return {
    async query<Row>(text: string, params: readonly unknown[] = []) {
      const result = await client.query(text, params as unknown[]);
      return result.rows as Row[];
    },

    async exec(text: string) {
      // No parameters means the simple query protocol, which is the only one
      // that accepts several statements in one round trip.
      await client.query(text);
    },

    async transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
      // Already inside one. Postgres has no real nested transactions, and a
      // savepoint here would only add a way for an inner rollback to leave the
      // outer one looking successful.
      if (depth > 0) return fn(wrapClient(client, depth + 1));

      await client.query("BEGIN");
      try {
        const result = await fn(wrapClient(client, depth + 1));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    },
  };
}

export function createNeonDatabase(connectionString: string): Database {
  const pool = new Pool({ connectionString });

  return {
    async query<Row>(text: string, params: readonly unknown[] = []) {
      const result = await pool.query(text, params as unknown[]);
      return result.rows as Row[];
    },

    async exec(text: string) {
      await pool.query(text);
    },

    async transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        return await wrapClient(client, 0).transaction(fn);
      } finally {
        client.release();
      }
    },

    async close() {
      await pool.end();
    },
  };
}
