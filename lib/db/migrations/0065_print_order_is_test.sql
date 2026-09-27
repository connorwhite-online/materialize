-- Sandbox orders flag (see printOrders.isTest in lib/db/schema.ts).
--
-- Production ran on test Stripe keys and mocked CraftCloud until the
-- live switch on 2026-09-27 (~09:00 UTC), and every order from that era
-- sits in the same table as real ones. New orders stamp is_test from
-- isCraftCloudTestOrder(); the backfill marks everything created before
-- the switch, plus the unplaced leftovers from the first live attempts. Rows are only hidden from buyer-facing lists, never
-- deleted, so this is reversible with one UPDATE.
--
-- Idempotent per the 0039+ convention.
ALTER TABLE "print_orders" ADD COLUMN IF NOT EXISTS "is_test" boolean DEFAULT false NOT NULL;
-- Everything from before the switch is sandbox. The failed first live
-- checkout attempts (09:00–16:35 UTC) never became orders either; only
-- rows that actually reached a placed status in that window are real.
UPDATE "print_orders" SET "is_test" = true
  WHERE "is_test" = false
    AND (
      "created_at" < '2026-09-27T09:00:00Z'
      OR (
        "created_at" < '2026-09-27T16:35:00Z'
        AND "status" NOT IN ('ordered', 'in_production', 'shipped', 'received', 'blocked')
      )
    );
