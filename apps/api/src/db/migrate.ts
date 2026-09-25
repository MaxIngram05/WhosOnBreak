/**
 * The migration runner.
 *
 * Sixty lines, no framework. Migrations are numbered SQL files applied in name
 * order, each inside a transaction, each recorded once. That is the entirety
 * of what a migration tool does for a project this size, and owning it means
 * the schema is never hostage to a tool's opinion about how to represent it.
 *
 * Applying is kept separate from loading so tests can build the same database
 * from the same files without touching a filesystem API a Worker lacks.
 */

import type { Database, Sql } from "./sql.ts";

export interface Migration {
  /** The filename, which is also the sort key and the recorded identity. */
  name: string;
  sql: string;
}

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name        text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
  )
`;

/** Applies whatever has not been applied. Returns the names it ran. */
export async function applyMigrations(
  database: Database,
  migrations: readonly Migration[],
): Promise<string[]> {
  await database.exec(MIGRATIONS_TABLE);

  const applied = new Set(
    (
      await database.query<{ name: string }>("SELECT name FROM schema_migrations")
    ).map((row) => row.name),
  );

  const pending = [...migrations]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((migration) => !applied.has(migration.name));

  const ran: string[] = [];
  for (const migration of pending) {
    // One transaction per migration, so a failure halfway through leaves the
    // database on the last good version rather than somewhere in between.
    await database.transaction(async (tx: Sql) => {
      await tx.exec(migration.sql);
      await tx.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
        migration.name,
      ]);
    });
    ran.push(migration.name);
  }

  return ran;
}

/**
 * Reads the migrations directory. Node only -- imported by the CLI script and
 * by tests, never by the Worker entry point, which has no business migrating
 * anything on a request path.
 */
export async function loadMigrations(directory: string): Promise<Migration[]> {
  const { readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const entries = (await readdir(directory)).filter((name) => name.endsWith(".sql"));
  entries.sort((a, b) => a.localeCompare(b));

  return Promise.all(
    entries.map(async (name) => ({
      name,
      sql: await readFile(join(directory, name), "utf8"),
    })),
  );
}
