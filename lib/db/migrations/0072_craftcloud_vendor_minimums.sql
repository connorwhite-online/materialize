-- Shared cache of CraftCloud vendor minimum order values, so each
-- server instance doesn't create its own disposable probe carts. See
-- lib/craftcloud/vendor-minimums-store.ts.
--
-- Additive only. Idempotent per the 0039+ convention.
CREATE TABLE IF NOT EXISTS "craftcloud_vendor_minimums" (
	"currency" text NOT NULL,
	"vendor_id" text NOT NULL,
	"minimum" double precision NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "craftcloud_vendor_minimums_currency_vendor_uq" ON "craftcloud_vendor_minimums" USING btree ("currency","vendor_id");
