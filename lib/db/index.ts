import "server-only";

import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle, NeonDatabase } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

// neon-serverless uses a WebSocket transport so we can run real
// interactive transactions — `db.transaction(...)` with
// `pg_advisory_xact_lock` for the reserve-then-charge path in
// lib/mcp/internal/orders.ts, and any future code that needs them.
// The previous neon-http driver *throws* on `db.transaction(...)`.
//
// In Node runtimes (Vercel Node functions, `next dev`) there's no
// global `WebSocket`, so we plug in the `ws` polyfill here. Edge
// runtimes already ship one and don't need this.
neonConfig.webSocketConstructor = ws;

let _db: NeonDatabase<typeof schema> | null = null;
let _pool: Pool | null = null;

export function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("Missing required environment variable: DATABASE_URL");
    }
    // Lazy singleton — the Pool keeps idle connections warm across
    // requests in the same Node instance; Neon reaps stale ones server-
    // side. We don't `pool.end()` on purpose: serverless platforms tear
    // the instance down and there's no shutdown hook to hang it off of.
    _pool = new Pool({ connectionString: url });
    _db = drizzle(_pool, { schema });
  }
  return _db;
}

// Convenience export for most use cases
export const db = new Proxy({} as NeonDatabase<typeof schema>, {
  get(_target, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
