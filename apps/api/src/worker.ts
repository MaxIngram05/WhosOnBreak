/**
 * The production entry point: a Cloudflare Worker.
 *
 * Config and the Google key cache live for the life of the isolate. The
 * database pool does not: a Worker may not carry I/O objects from one request
 * into the next, so each request opens its own and closes it after the
 * response has gone, off the critical path.
 */

import { createApp } from "./app.ts";
import { loadConfig, type Config, type RawEnv } from "./config.ts";
import { createNeonDatabase } from "./db/neon.ts";
import { createGoogleVerifier, type GoogleVerifier } from "./auth/google.ts";

let shared: { config: Config; google: GoogleVerifier } | undefined;

function setup(env: RawEnv) {
  if (!shared) {
    const config = loadConfig(env);
    shared = { config, google: createGoogleVerifier(config.googleClientIds) };
  }
  return shared;
}

const app = createApp((c) => {
  const { config, google } = setup(c.env as RawEnv);
  const db = createNeonDatabase(config.databaseUrl);

  return {
    ctx: { config, db, google, now: () => new Date() },
    release: () => c.executionCtx.waitUntil(db.close()),
  };
});

export default app;
