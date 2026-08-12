-- Fetched-facts cache (lib/cad/repo-fetch.ts): distilled mechanical fact
-- sheets for prompt-linked URLs (GitHub repos / datasheet PDFs), per user,
-- so repeat generations skip the fetch + distill.
-- Idempotent by convention (0039+): safe to re-apply after a partial run.
CREATE TABLE IF NOT EXISTS "cad_fetched_facts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "source_url" text NOT NULL,
  "facts" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cad_fetched_facts"
    ADD CONSTRAINT "cad_fetched_facts_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cad_fetched_facts_user_url_idx"
  ON "cad_fetched_facts" USING btree ("user_id", "source_url");
