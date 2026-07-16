-- Hand-written idempotent migration: the Neon HTTP migrator does not wrap
-- statements in a transaction, so every step must tolerate a retry.
CREATE TABLE IF NOT EXISTS "ownership_claim_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raised_by_user_id" text NOT NULL,
	"existing_file_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"file_size" integer NOT NULL,
	"content_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "claim_intent_id" uuid;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "evidence_photo_keys" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ownership_claim_intents" ADD COLUMN IF NOT EXISTS "consumed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ownership_claim_intents" DROP CONSTRAINT IF EXISTS "ownership_claim_intents_raised_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "ownership_claim_intents" ADD CONSTRAINT "ownership_claim_intents_raised_by_user_id_users_id_fk" FOREIGN KEY ("raised_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_claim_intents" DROP CONSTRAINT IF EXISTS "ownership_claim_intents_existing_file_id_files_id_fk";--> statement-breakpoint
ALTER TABLE "ownership_claim_intents" ADD CONSTRAINT "ownership_claim_intents_existing_file_id_files_id_fk" FOREIGN KEY ("existing_file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" DROP CONSTRAINT IF EXISTS "disputes_claim_intent_id_ownership_claim_intents_id_fk";--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_claim_intent_id_ownership_claim_intents_id_fk" FOREIGN KEY ("claim_intent_id") REFERENCES "public"."ownership_claim_intents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ownership_claim_intents_user_idx" ON "ownership_claim_intents" USING btree ("raised_by_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ownership_claim_intents_file_idx" ON "ownership_claim_intents" USING btree ("existing_file_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ownership_claim_intents_expires_idx" ON "ownership_claim_intents" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ownership_claim_intents_active_uniq" ON "ownership_claim_intents" USING btree ("raised_by_user_id", "existing_file_id", "content_hash") WHERE "consumed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "disputes_claim_intent_uniq" ON "disputes" USING btree ("claim_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "disputes_open_file_raiser_uniq" ON "disputes" USING btree ("file_id", "raised_by_user_id") WHERE "status" = 'open' AND "claim_intent_id" IS NOT NULL;
