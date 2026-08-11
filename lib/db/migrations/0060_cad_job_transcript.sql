-- Flight recorder (lib/cad/transcript.ts): R2 key of the job's full gzipped
-- transcript (cad-transcripts/ prefix) — model prompts/responses, sidecar
-- execs + renders, agentic message log.
-- Idempotent by convention (0039+): safe to re-apply after a partial run.
ALTER TABLE "cad_jobs" ADD COLUMN IF NOT EXISTS "transcript_storage_key" text;
