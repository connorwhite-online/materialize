-- Links a multi-part assembly generation to the Project bundling its part
-- files, so an assembly survives reload instead of collapsing to its primary
-- part. (The other columns a raw `generate` emitted here are already added by
-- 0040/0041 — the drizzle snapshot had drifted — so they're intentionally
-- omitted. Plain statements only: the neon-http migrator runs each over HTTP
-- and mis-handles DO-blocks / IF NOT EXISTS.)
ALTER TABLE "cad_generations" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "cad_generations" ADD CONSTRAINT "cad_generations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
