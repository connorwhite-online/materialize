-- Remediation for preview databases that may have applied the first 0050
-- revision before its evidence-lifecycle hardening landed.
ALTER TABLE "disputes" DROP CONSTRAINT IF EXISTS "disputes_claim_intent_id_ownership_claim_intents_id_fk";--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_claim_intent_id_ownership_claim_intents_id_fk" FOREIGN KEY ("claim_intent_id") REFERENCES "public"."ownership_claim_intents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "disputes_open_file_raiser_uniq" ON "disputes" USING btree ("file_id", "raised_by_user_id") WHERE "status" = 'open';
