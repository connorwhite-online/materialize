-- Search route (app/api/search/route.ts) runs ilike '%pattern%' on five
-- columns (files.name, projects.name, collections.name, users.username,
-- users.displayName). Two-sided wildcards can't use a plain btree index,
-- so without trigram indexes those queries are sequential scans and get
-- linearly slower as the tables grow.
--
-- pg_trgm + GIN indexes with gin_trgm_ops accelerate ilike-with-wildcards
-- by computing trigram (3-char-substring) sets at write time and using
-- them to prune the candidate set at read time. The trade is a modest
-- write-time cost on inserts/updates and ~10-30% storage overhead per
-- indexed column, in exchange for ilike going from O(N) to O(log N)
-- + the result-set cost.
--
-- IF NOT EXISTS on every statement so re-running the migration is safe
-- (e.g. if the extension already exists on the database).

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "files_name_trgm_idx"
  ON "files" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "projects_name_trgm_idx"
  ON "projects" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "collections_name_trgm_idx"
  ON "collections" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "users_username_trgm_idx"
  ON "users" USING gin ("username" gin_trgm_ops);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "users_display_name_trgm_idx"
  ON "users" USING gin ("display_name" gin_trgm_ops);
