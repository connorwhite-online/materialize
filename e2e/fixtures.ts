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
import Stripe from "stripe";
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
 * Insert a creator + paid published file.
 *
 * - `onboarded: false` (default) leaves stripeAccountId null —
 *   the checkout-gate test asserts on "creator hasn't enabled
 *   payouts yet" without needing a real Connect account.
 * - `stripeAccountId` (set) marks the creator as onboarded and
 *   plumbs a real Stripe Connect acct id into the row. Use
 *   `createStripeOnboardedAccount()` to mint one.
 */
export async function createPaidFileFixture(opts?: {
  onboarded?: boolean;
  stripeAccountId?: string;
}): Promise<PaidFileFixture> {
  const db = getDb();
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const creatorId = `e2e_creator_${stamp}_${rand}`;
  const slug = `e2e-paid-${stamp}-${rand}`;

  const onboarded = !!(opts?.onboarded || opts?.stripeAccountId);
  const acctId =
    opts?.stripeAccountId ??
    (opts?.onboarded ? `acct_fake_${rand}` : null);

  await db.insert(schema.users).values({
    id: creatorId,
    username: `e2e_${stamp}_${rand}`,
    displayName: "E2E Test Creator",
    stripeAccountId: acctId,
    stripeOnboardingComplete: onboarded,
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
 *
 * Pass `fixedEmail` for a spec that needs a STABLE address across runs
 * (e.g. one an env-var allow-list references, like
 * `TEXT_TO_CAD_ALLOWED_EMAILS` — see text-to-cad.spec.ts). If a user with
 * that email already exists (a prior run's `afterAll` didn't reach —
 * crashed run, manual interrupt), we reuse it instead of erroring on
 * Clerk's duplicate-email rejection; the password won't match a reused
 * user; unaffected callers use `email_code` sign-in like `library.spec.ts`,
 * which never touches the password.
 */
export async function createClerkTestUser(
  fixedEmail?: string
): Promise<ClerkTestUserFixture> {
  ensureEnv();
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY not set");
  const clerk = createClerkClient({ secretKey });
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  const email = fixedEmail ?? `e2e+clerk_test+${stamp}_${rand}@example.com`;
  // 16-char random password with mixed character classes —
  // satisfies Clerk's default password complexity rules.
  const password = `Te$t${Math.random().toString(36).slice(2, 10)}Aa1!`;
  try {
    const user = await clerk.users.createUser({
      emailAddress: [email],
      password,
    });
    return { userId: user.id, email, password };
  } catch (err) {
    if (!fixedEmail) throw err;
    const existing = await clerk.users.getUserList({
      emailAddress: [fixedEmail],
    });
    const found = existing.data[0];
    if (!found) throw err;
    return { userId: found.id, email: fixedEmail, password };
  }
}

/**
 * Insert / upsert a row in our `users` table for a Clerk user so
 * authed UI flows render correctly. Our app doesn't get a DB row
 * for a Clerk user until they take an action that triggers an
 * upsert (e.g. `setUsername`); tests that need an authed visit
 * to render correctly have to seed the row themselves.
 *
 * Returns the username used so callers can navigate to
 * `/u/<username>` directly.
 */
export async function seedAppUserForClerkId(
  clerkUserId: string,
  opts?: { displayName?: string }
): Promise<{ username: string }> {
  const db = getDb();
  const rand = Math.random().toString(36).slice(2, 8);
  const username = `e2e_authed_${rand}`;
  await db
    .insert(schema.users)
    .values({
      id: clerkUserId,
      username,
      displayName: opts?.displayName ?? "E2E Authed Buyer",
    })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: { username },
    });
  return { username };
}

/**
 * Authed `/` gates on Clerk `currentUser().username`, not our `users.username`
 * row. A seeded app user without this still lands on `/onboarding`.
 */
export async function setClerkUsername(
  clerkUserId: string,
  username: string
): Promise<void> {
  ensureEnv();
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY not set");
  const clerk = createClerkClient({ secretKey });
  await clerk.users.updateUser(clerkUserId, { username });
}

export interface OwnedFileFixture {
  ownerId: string;
  fileId: string;
  slug: string;
  name: string;
}

/**
 * Insert a published, public, owned file for a pre-existing user
 * (e.g. one returned from createClerkTestUser + seedAppUserForClerkId).
 * No Stripe coupling — `price: 0`, free download. Use the paid
 * variant in createPaidFileFixture when you need the purchase path.
 */
export async function createOwnedFileFixture(
  ownerId: string
): Promise<OwnedFileFixture> {
  const db = getDb();
  const rand = Math.random().toString(36).slice(2, 8);
  const slug = `e2e-owned-${rand}`;
  const name = `E2E Owned File ${rand}`;
  const [file] = await db
    .insert(schema.files)
    .values({
      userId: ownerId,
      name,
      slug,
      price: 0,
      currency: "USD",
      status: "published",
      visibility: "public",
    })
    .returning();
  return { ownerId, fileId: file.id, slug, name };
}

export async function deleteOwnedFileFixture(
  fixture: OwnedFileFixture
): Promise<void> {
  const db = getDb();
  await db.delete(schema.files).where(eq(schema.files.id, fixture.fileId));
}

/**
 * Attach a primary asset so `loadLibraryTiles` (authed-home Recent)
 * will include the file. LibraryTab lists files without this; Recent
 * skips rows that have no asset.
 */
export async function attachOwnedFileAsset(
  fileId: string
): Promise<{ fileAssetId: string }> {
  const db = getDb();
  const [asset] = await db
    .insert(schema.fileAssets)
    .values({
      fileId,
      storageKey: `e2e/${fileId}/model.stl`,
      originalFilename: "model.stl",
      format: "stl",
      fileSize: 1024,
    })
    .returning({ id: schema.fileAssets.id });
  return { fileAssetId: asset.id };
}

export async function deleteAppUserRow(userId: string): Promise<void> {
  const db = getDb();
  await db.delete(schema.users).where(eq(schema.users.id, userId));
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

/**
 * Mint a Stripe Connect account that can receive destination
 * charges in the sandbox — equivalent shape to what the prod app
 * Express-onboards a real creator into. The prod path uses
 * `type: "express"`, but Express accounts disallow programmatic
 * TOS acceptance, so for tests we create a platform-controlled
 * account whose destination-charge mechanics are identical.
 *
 * Polls until `capabilities.transfers === "active"` (test-mode
 * trigger addresses clear instantly in practice). Throws if the
 * activation doesn't complete in ~15s.
 *
 * Returns just the account id; tests pair it with
 * `createPaidFileFixture({ stripeAccountId })`. Stripe artifacts
 * are intentionally left in the sandbox after teardown — they're
 * useful for dashboard inspection and cost nothing.
 */
export async function createStripeOnboardedAccount(): Promise<string> {
  ensureEnv();
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY not set");
  if (
    !secretKey.startsWith("sk_test_") &&
    !secretKey.includes("test")
  ) {
    throw new Error("Refusing to mint Connect accounts against a non-test key");
  }
  // Cast to any — the pinned apiVersion isn't in the SDK's union
  // of allowed API versions, and Stripe v22 no longer exports the
  // namespace symbol the wider cast used to land on. Matches the
  // same workaround in scripts/test-payouts-flow.ts.
  const stripe = new Stripe(secretKey, {
    apiVersion: "2025-09-30.clover",
  } as unknown as ConstructorParameters<typeof Stripe>[1]);

  const rand = Math.random().toString(36).slice(2, 8);
  const account = await stripe.accounts.create({
    controller: {
      stripe_dashboard: { type: "none" },
      fees: { payer: "application" },
      losses: { payments: "application" },
      requirement_collection: "application",
    },
    country: "US",
    email: `e2e+${rand}@materialize.test`,
    capabilities: {
      transfers: { requested: true },
      card_payments: { requested: true },
    },
    business_type: "individual",
    business_profile: {
      mcc: "5734",
      url: "https://materialize.cc",
      product_description: "3D printable files",
    },
  });

  await stripe.accounts.update(
    account.id,
    {
      individual: {
        first_name: "E2E",
        last_name: "Creator",
        email: `e2e+${rand}@materialize.test`,
        phone: "+18005550175",
        ssn_last_4: "0000",
        id_number: "000000000",
        dob: { day: 1, month: 1, year: 1990 },
        address: {
          line1: "address_full_match",
          city: "San Francisco",
          state: "CA",
          postal_code: "94103",
          country: "US",
        },
      },
      tos_acceptance: {
        date: Math.floor(Date.now() / 1000),
        ip: "127.0.0.1",
        service_agreement: "full",
      },
    } as Stripe.AccountUpdateParams
  );

  // Poll for capability activation.
  let refreshed = await stripe.accounts.retrieve(account.id);
  for (
    let i = 0;
    i < 30 && refreshed.capabilities?.transfers !== "active";
    i++
  ) {
    await new Promise((r) => setTimeout(r, 500));
    refreshed = await stripe.accounts.retrieve(account.id);
  }
  if (refreshed.capabilities?.transfers !== "active") {
    throw new Error(
      `Stripe Connect transfers capability did not activate; requirements: ${JSON.stringify(
        refreshed.requirements
      )}`
    );
  }
  return account.id;
}
