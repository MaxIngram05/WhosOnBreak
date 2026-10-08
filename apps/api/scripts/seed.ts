/**
 * Puts the sample group and its people into DATABASE_URL.
 *
 *   npm run migrate && npm run seed
 *
 * For a development or preview database. It refuses to run against
 * production, where demo accounts would be real accounts.
 */

import { loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db/open.ts";
import { describeSeed, seed } from "../src/dev/seed.ts";

const config = loadConfig({ ENVIRONMENT: "development", ...process.env });
if (config.environment === "production") {
  console.error("Refusing to seed a production database");
  process.exit(1);
}

const db = await openDatabase(config.databaseUrl);
try {
  console.log(describeSeed(await seed(db, new Date())));
} finally {
  await db.close();
}
