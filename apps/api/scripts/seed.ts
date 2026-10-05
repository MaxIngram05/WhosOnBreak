/**
 * Puts demo data into DATABASE_URL and prints a token for each demo user.
 *
 *   npm run migrate && npm run seed
 *
 * For a development or preview database. It refuses to run against
 * production, where demo accounts would be real accounts.
 */

import { loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db/open.ts";
import { describeSeed, devSession, seed } from "../src/dev/seed.ts";

const config = loadConfig({ ENVIRONMENT: "development", ...process.env });
if (config.environment === "production") {
  console.error("Refusing to seed a production database");
  process.exit(1);
}

const db = await openDatabase(config.databaseUrl);
try {
  const now = new Date();
  const result = await seed(db, now);
  const tokens: Record<string, string> = {};
  for (const [key, user] of Object.entries(result.users)) {
    tokens[key] = (await devSession(db, config, user, now)).accessToken;
  }
  console.log(describeSeed(result, tokens, process.env.API_URL ?? "http://localhost:8787"));
} finally {
  await db.close();
}
