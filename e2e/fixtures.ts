/**
 * Shared Playwright fixtures backed by direct DB access (Drizzle
 * via the Neon serverless driver). Tests own their own fixtures
 * so a run against an empty DB still passes — and cleans up so
 * we don't accumulate test rows across runs.
 *
 * We bypass `@/lib/db` (which is `server-only`) and instantiate
 * the driver inline; Playwright runs in plain Node and doesn't
 * pretend to be a server component.
 */
import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { createClerkClient } from "@clerk/backend";
import * as schema from "../lib/db/schema";

function ensureEnv() {
  if (process.env.DATABASE_URL) return;
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function getDb() {
  ensureEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = neon(url);
  return drizzle(sql, { schema });
}

export interface PaidFileFixture {
  creatorId: string;
  fileId: string;
  slug: string;
  priceCents: number;
}

/**
 * Insert a creator + paid published file. `stripeOnboardingComplete`
 * defaults to `false` so the checkout-gate test can assert on the
 * "creator hasn't enabled payouts yet" error path without needing
 * a real Stripe Connect account.
 */
export async function createPaidFileFixture(opts?: {
  onboarded?: boolean;
}): Promise<PaidFileFixture> {
  const db = getDb();
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const creatorId = `e2e_creator_${stamp}_${rand}`;
  const slug = `e2e-paid-${stamp}-${rand}`;

  await db.insert(schema.users).values({
    id: creatorId,
    username: `e2e_${stamp}_${rand}`,
    displayName: "E2E Test Creator",
    stripeAccountId: opts?.onboarded ? `acct_fake_${rand}` : null,
    stripeOnboardingComplete: !!opts?.onboarded,
  });

  const [file] = await db
    .insert(schema.files)
    .values({
      userId: creatorId,
      name: `E2E Paid File ${rand}`,
      slug,
      price: 1999, // $19.99
      currency: "USD",
      status: "published",
      visibility: "public",
    })
    .returning();

  return {
    creatorId,
    fileId: file.id,
    slug,
    priceCents: 1999,
  };
}

export async function deletePaidFileFixture(
  fixture: PaidFileFixture
): Promise<void> {
  const db = getDb();
  // Files have ON DELETE CASCADE on their owner, but explicit
  // deletes are safer than relying on cascade order.
  await db.delete(schema.files).where(eq(schema.files.id, fixture.fileId));
  await db.delete(schema.users).where(eq(schema.users.id, fixture.creatorId));
}

export interface ClerkTestUserFixture {
  /** Clerk user id — same value `auth()` returns inside the app. */
  userId: string;
  email: string;
  password: string;
}

/**
 * Create a real Clerk user via the Backend API for a single test
 * run. We use the `+clerk_test` local-part convention which makes
 * the address a Clerk-recognized test email (no real inbox
 * required). Password is randomized per run to avoid any
 * collision with other test users.
 *
 * Pair with `deleteClerkTestUser()` in afterAll so we don't
 * accumulate users in the Clerk dashboard.
 */
export async function createClerkTestUser(): Promise<ClerkTestUserFixture> {
  ensureEnv();
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY not set");
  const clerk = createClerkClient({ secretKey });
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  const email = `e2e+clerk_test+${stamp}_${rand}@example.com`;
  // 16-char random password with mixed character classes —
  // satisfies Clerk's default password complexity rules.
  const password = `Te$t${Math.random().toString(36).slice(2, 10)}Aa1!`;
  const user = await clerk.users.createUser({
    emailAddress: [email],
    password,
  });
  return { userId: user.id, email, password };
}

export async function deleteClerkTestUser(
  fixture: ClerkTestUserFixture
): Promise<void> {
  ensureEnv();
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return;
  const clerk = createClerkClient({ secretKey });
  try {
    await clerk.users.deleteUser(fixture.userId);
  } catch {
    // Best-effort cleanup — if the user is already gone we
    // don't care.
  }
}
