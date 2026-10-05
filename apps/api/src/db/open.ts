/**
 * Opens whatever DATABASE_URL points at. Node only: used by the dev server and
 * the scripts, never by the Worker, which always talks to Neon.
 *
 * - `postgres://...` or `postgresql://...` -- Neon, or any Postgres the Neon
 *   driver can reach.
 * - `pglite` -- an in-memory Postgres, gone when the process exits. Zero setup.
 * - `pglite:<directory>` -- the same, kept on disk between runs.
 */

import type { Database } from "./sql.ts";
import { createNeonDatabase } from "./neon.ts";
import { createPgliteDatabase } from "./pglite.ts";

export function isPgliteUrl(url: string): boolean {
  return url === "pglite" || url.startsWith("pglite:");
}

export async function openDatabase(url: string): Promise<Database> {
  if (isPgliteUrl(url)) {
    const directory = url.slice("pglite:".length);
    return createPgliteDatabase(directory || undefined);
  }
  return createNeonDatabase(url);
}
