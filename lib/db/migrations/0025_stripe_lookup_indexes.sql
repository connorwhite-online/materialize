-- Stripe webhook lookups by external id were full table scans:
--   * `handleListingPurchase` / `handleListingRefund` find a row by
--     `stripe_payment_intent_id` only (the dedup key for the listing
--     purchase flow).
--   * The `account.updated` webhook reconciles
--     `stripe_onboarding_complete` by matching `stripe_account_id`.
--
-- Without indexes these scans grow linearly with the table; both
-- tables are written by Stripe webhooks so this is a hot path. Adding
-- plain btree indexes on each. Not UNIQUE — the schema treats both
-- columns as nullable and the application enforces uniqueness, so
-- a partial-unique guard would be the next step rather than this one.

CREATE INDEX IF NOT EXISTS "purchases_stripe_payment_intent_idx"
  ON "purchases" USING btree ("stripe_payment_intent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_stripe_account_id_idx"
  ON "users" USING btree ("stripe_account_id");
