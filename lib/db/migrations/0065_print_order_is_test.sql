-- Sandbox orders flag (see printOrders.isTest in lib/db/schema.ts).
--
-- Production ran on test Stripe keys and mocked CraftCloud until the
-- live switch on 2026-09-27 (~09:00 UTC), and every order from that era
-- sits in the same table as real ones. New orders stamp is_test from
-- isCraftCloudTestOrder(); the backfill marks everything created before
-- the switch. Rows are only hidden from buyer-facing lists, never
-- deleted, so this is reversible with one UPDATE.
--
-- Idempotent per the 0039+ convention.
ALTER TABLE "print_orders" ADD COLUMN IF NOT EXISTS "is_test" boolean DEFAULT false NOT NULL;
UPDATE "print_orders" SET "is_test" = true
  WHERE "created_at" < '2026-09-27T09:00:00Z' AND "is_test" = false;
