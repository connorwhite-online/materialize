import fs from "node:fs";
import path from "node:path";
import { clerkSetup } from "@clerk/testing/playwright";

/**
 * Playwright global setup. Loads `.env.local` (the same way the
 * fixture helpers do) so Clerk's testing token can be fetched
 * before any spec runs.
 *
 * Specs that don't need Clerk auth still run fine if Clerk keys
 * aren't present — `clerkSetup()` just no-ops the test-token
 * setup and `clerk.signIn()` will throw at use time. The smoke
 * suite doesn't use Clerk at all.
 */
export default async function globalSetup() {
  if (!process.env.DATABASE_URL || !process.env.CLERK_SECRET_KEY) {
    const envPath = path.resolve(process.cwd(), ".env.local");
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
        if (!match) continue;
        const [, key, rawValue] = match;
        if (process.env[key]) continue;
        process.env[key] = rawValue.replace(/^["']|["']$/g, "");
      }
    }
  }
  if (process.env.CLERK_SECRET_KEY) {
    await clerkSetup();
  }
}
