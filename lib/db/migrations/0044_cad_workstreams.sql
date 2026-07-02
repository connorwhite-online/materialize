-- Text-to-CAD workstream foundation (MTR-175/178/179/180/174):
-- background job rows (cad_jobs), first-class threads (cad_threads),
-- new cad_generations columns (thread_id, remeshed, brief,
-- aesthetic_dims, topo_storage_key), and files.source so studio drafts
-- stay out of the library until promoted (docs/text-to-cad/02 + 05).
--
-- Hand-written in the idempotent 0043 style: single plain guarded
-- statements only (IF NOT EXISTS / DROP … IF EXISTS), no DO-blocks —
-- the neon-http migrator runs each statement over HTTP without a
-- wrapping transaction, so a partially applied run must be safe to
-- re-apply. The one unguardable statement is CREATE TYPE (Postgres has
-- no CREATE TYPE IF NOT EXISTS); the DROP TYPE IF EXISTS before it
-- recovers the partial-failure re-run because it executes before
-- anything depends on the type. (Residual edge: a re-run after FULL
-- application — journal insert failed — errors at the DROP because
-- cad_jobs.status then depends on the type; plain CREATE TYPE would
-- fail identically there, so the guard is strictly no worse.)
--
-- Circular FK note: cad_threads.root/active_generation_id reference
-- cad_generations while cad_generations.thread_id references
-- cad_threads. Both tables are created bare first; every cross-FK is
-- added via ALTER afterwards, so statement order never dangles.
DROP TYPE IF EXISTS "public"."cad_job_status";--> statement-breakpoint
CREATE TYPE "public"."cad_job_status" AS ENUM('queued', 'running', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cad_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation_id" uuid NOT NULL,
	"status" "cad_job_status" DEFAULT 'queued' NOT NULL,
	"progress" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"cancel_requested_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cad_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"root_generation_id" uuid,
	"active_generation_id" uuid,
	"saved_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "cad_generations" ADD COLUMN IF NOT EXISTS "thread_id" uuid;--> statement-breakpoint
ALTER TABLE "cad_generations" ADD COLUMN IF NOT EXISTS "remeshed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cad_generations" ADD COLUMN IF NOT EXISTS "brief" jsonb;--> statement-breakpoint
ALTER TABLE "cad_generations" ADD COLUMN IF NOT EXISTS "aesthetic_dims" jsonb;--> statement-breakpoint
ALTER TABLE "cad_generations" ADD COLUMN IF NOT EXISTS "topo_storage_key" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "cad_jobs" DROP CONSTRAINT IF EXISTS "cad_jobs_generation_id_cad_generations_id_fk";--> statement-breakpoint
ALTER TABLE "cad_jobs" ADD CONSTRAINT "cad_jobs_generation_id_cad_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."cad_generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cad_threads" DROP CONSTRAINT IF EXISTS "cad_threads_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "cad_threads" ADD CONSTRAINT "cad_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cad_threads" DROP CONSTRAINT IF EXISTS "cad_threads_root_generation_id_cad_generations_id_fk";--> statement-breakpoint
ALTER TABLE "cad_threads" ADD CONSTRAINT "cad_threads_root_generation_id_cad_generations_id_fk" FOREIGN KEY ("root_generation_id") REFERENCES "public"."cad_generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cad_threads" DROP CONSTRAINT IF EXISTS "cad_threads_active_generation_id_cad_generations_id_fk";--> statement-breakpoint
ALTER TABLE "cad_threads" ADD CONSTRAINT "cad_threads_active_generation_id_cad_generations_id_fk" FOREIGN KEY ("active_generation_id") REFERENCES "public"."cad_generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cad_threads" DROP CONSTRAINT IF EXISTS "cad_threads_saved_file_id_files_id_fk";--> statement-breakpoint
ALTER TABLE "cad_threads" ADD CONSTRAINT "cad_threads_saved_file_id_files_id_fk" FOREIGN KEY ("saved_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cad_generations" DROP CONSTRAINT IF EXISTS "cad_generations_thread_id_cad_threads_id_fk";--> statement-breakpoint
ALTER TABLE "cad_generations" ADD CONSTRAINT "cad_generations_thread_id_cad_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."cad_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cad_jobs_generation_id_idx" ON "cad_jobs" USING btree ("generation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cad_jobs_status_created_idx" ON "cad_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cad_threads_user_updated_idx" ON "cad_threads" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cad_generations_thread_id_idx" ON "cad_generations" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_source_status_idx" ON "files" USING btree ("source","status");
