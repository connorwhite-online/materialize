-- Fixed-window counters for the per-caller rate limits on public,
-- upstream-costly endpoints (quote start/poll, model upload, cart
-- probes, search). See lib/rate-limit/index.ts and rateLimitCounters
-- in lib/db/schema.ts.
--
-- Additive only. Idempotent per the 0039+ convention.
CREATE TABLE IF NOT EXISTS "rate_limit_counters" (
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rate_limit_counters_bucket_window_uq" ON "rate_limit_counters" USING btree ("bucket","window_start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limit_counters_window_idx" ON "rate_limit_counters" USING btree ("window_start");
