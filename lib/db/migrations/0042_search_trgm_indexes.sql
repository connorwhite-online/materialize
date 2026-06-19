-- Global search (app/api/search) matches with substring ILIKE on
-- files.name / projects.name / collections.name / users.username /
-- users.display_name. Without a trigram index every search is a
-- sequential scan; pg_trgm's gin_trgm_ops GIN index supports both LIKE
-- and ILIKE so these become index scans. IF NOT EXISTS keeps the
-- migration idempotent (safe to re-run / partially applied).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_name_trgm_idx" ON "files" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_name_trgm_idx" ON "projects" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collections_name_trgm_idx" ON "collections" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_username_trgm_idx" ON "users" USING gin ("username" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_display_name_trgm_idx" ON "users" USING gin ("display_name" gin_trgm_ops);
