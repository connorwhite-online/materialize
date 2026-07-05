-- Interactive specification (MTR-191): the harness can pause mid-generation to
-- ask the user a multiple-choice question, then resume with the answer.
--
-- Two additions on the resumable-job machinery (MTR-175):
--   1. a new NON-terminal `awaiting_input` cad_job_status the executor sits in
--      while a `question` progress event awaits its answer;
--   2. a `answers` jsonb (questionId -> chosen optionId) written by
--      POST /api/cad/jobs/[jobId]/answer and polled by the executor — the same
--      single-writer model as cancel_requested_at.
--
-- Hand-written idempotent per the 0039+ convention (each statement safe to
-- re-apply; the neon-http migrator runs them over HTTP with no wrapping
-- transaction — ALTER TYPE ... ADD VALUE therefore runs standalone, as it must).
ALTER TYPE "public"."cad_job_status" ADD VALUE IF NOT EXISTS 'awaiting_input' BEFORE 'done';--> statement-breakpoint
ALTER TABLE "cad_jobs" ADD COLUMN IF NOT EXISTS "answers" jsonb DEFAULT '{}'::jsonb NOT NULL;
