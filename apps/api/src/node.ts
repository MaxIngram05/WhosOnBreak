/**
 * The local development server: the same app as the Worker, on Node.
 *
 *   DATABASE_URL=pglite SEED=1 npm run dev
 *
 * gives a fully working API with demo data and no database to install.
 * Pointed at a real DATABASE_URL instead, it is a way to poke at Neon from a
 * laptop. Production never runs this file.
 */

import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createGoogleVerifier } from "./auth/google.ts";
import { isPgliteUrl, openDatabase } from "./db/open.ts";
import { applyMigrations, loadMigrations } from "./db/migrate.ts";
import { describeSeed, devSession, seed } from "./dev/seed.ts";
import { memoryRateLimiter } from "./http/rate-limit.ts";

const config = loadConfig({ ENVIRONMENT: "development", ...process.env });
const db = await openDatabase(config.databaseUrl);
const port = Number(process.env.PORT ?? 8787);

// An in-process database starts empty every time, so it is migrated on boot.
// A real one is migrated deliberately, with `npm run migrate`.
if (isPgliteUrl(config.databaseUrl)) {
  const migrations = await loadMigrations(
    fileURLToPath(new URL("../migrations", import.meta.url)),
  );
  await applyMigrations(db, migrations);
}

if (process.env.SEED === "1") {
  const now = new Date();
  const result = await seed(db, now);
  const tokens: Record<string, string> = {};
  for (const [key, user] of Object.entries(result.users)) {
    tokens[key] = (await devSession(db, config, user, now)).accessToken;
  }
  console.log(describeSeed(result, tokens, `http://localhost:${port}`));
}

const google = createGoogleVerifier(config.googleClientIds);
// One process, so an in-memory limiter is exact here.
const rateLimiter = memoryRateLimiter();
const app = createApp(() => ({
  ctx: { config, db, google, rateLimiter, now: () => new Date() },
}));

// 0.0.0.0 so a phone on the same Wi-Fi can reach the dev server.
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`WhosOnBreak API listening on http://localhost:${info.port}`);
});
