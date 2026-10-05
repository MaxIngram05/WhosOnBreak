/**
 * Applies pending migrations to DATABASE_URL.
 *
 *   npm run migrate
 *
 * Safe to run repeatedly: anything already applied is skipped, and each new
 * file runs in its own transaction.
 */

import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/db/open.ts";
import { applyMigrations, loadMigrations } from "../src/db/migrate.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const db = await openDatabase(url);
try {
  const migrations = await loadMigrations(
    fileURLToPath(new URL("../migrations", import.meta.url)),
  );
  const ran = await applyMigrations(db, migrations);
  console.log(ran.length > 0 ? `Applied: ${ran.join(", ")}` : "Already up to date");
} finally {
  await db.close();
}
