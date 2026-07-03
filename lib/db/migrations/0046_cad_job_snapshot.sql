-- Live build preview for the studio (docs/text-to-cad/03): the latest
-- in-progress render rides a dedicated column so cadJobs.progress stays
-- append-only (SSE cursor) and per-exec images never enter the jsonb log.
ALTER TABLE "cad_jobs" ADD COLUMN IF NOT EXISTS "last_snapshot" text;--> statement-breakpoint
ALTER TABLE "cad_jobs" ADD COLUMN IF NOT EXISTS "snapshot_step" integer DEFAULT 0 NOT NULL;
