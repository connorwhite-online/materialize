-- Links a multi-part assembly generation to the Project bundling its part
-- files, so an assembly survives reload instead of collapsing to its primary
-- part. (The other columns a raw `generate` emitted here are already added by
-- 0040/0041 — the drizzle snapshot had drifted — so they're intentionally
-- omitted.)
--
-- Idempotent: this migration shipped earlier on this branch numbered 0042
-- (before the collision with main's 0042_search_trgm_indexes forced the
-- renumber), so preview/prod databases may already have the column + FK. The
-- migrator re-runs it under the new 0043 timestamp, so every statement must be
-- safe to re-apply. IF NOT EXISTS / DROP … IF EXISTS are single plain
-- statements — the neon-http migrator runs each over HTTP and only mis-handles
-- multi-statement DO-blocks, not these (cf. 0042's CREATE … IF NOT EXISTS).
ALTER TABLE "cad_generations" ADD COLUMN IF NOT EXISTS "project_id" uuid;--> statement-breakpoint
ALTER TABLE "cad_generations" DROP CONSTRAINT IF EXISTS "cad_generations_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "cad_generations" ADD CONSTRAINT "cad_generations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
