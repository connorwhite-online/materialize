-- Studio cost metering + credit ledger substrate (MTR-181,
-- docs/text-to-cad/08-monetization.md). Two additions, both inert by
-- default:
--
--   1. cad_jobs gains `usage` (raw per-job cost signals: model tokens per
--      role, sidecar wall time, fal invocations) + `cost_cents` (cents
--      rollup at the CAD_PRICE_* unit prices in force at job termination;
--      0 while every price defaults to 0). Metering-only — no behavior
--      change.
--   2. cad_credit_ledger: one signed row per credit movement, balance =
--      SUM(delta). No writer runs unless CAD_CREDITS_ENABLED=true (default
--      off). Partial unique indexes are the idempotency rails: one
--      generation debit per job, one print-through refund per print order.
--
-- Hand-written idempotent per the 0039+ convention (each statement safe to
-- re-apply; the neon-http migrator runs them over HTTP with no wrapping
-- transaction).
ALTER TABLE "cad_jobs" ADD COLUMN IF NOT EXISTS "usage" jsonb;--> statement-breakpoint
ALTER TABLE "cad_jobs" ADD COLUMN IF NOT EXISTS "cost_cents" integer;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cad_credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"generation_id" uuid REFERENCES "cad_generations"("id") ON DELETE SET NULL,
	"job_id" uuid REFERENCES "cad_jobs"("id") ON DELETE SET NULL,
	"print_order_id" uuid REFERENCES "print_orders"("id") ON DELETE SET NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cad_credit_ledger_user_created_idx" ON "cad_credit_ledger" ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cad_credit_ledger_generation_debit_uq" ON "cad_credit_ledger" ("job_id") WHERE reason = 'generation';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cad_credit_ledger_print_refund_uq" ON "cad_credit_ledger" ("print_order_id") WHERE reason = 'print_through_refund';
