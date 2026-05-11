CREATE TABLE "project_photos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "storage_key" text NOT NULL,
  "caption" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "kind" text NOT NULL DEFAULT 'creator',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "project_photos_kind_check"
    CHECK ("kind" IN ('creator', 'make', 'inline'))
);
--> statement-breakpoint
CREATE INDEX "project_photos_project_id_idx"
  ON "project_photos" ("project_id");
--> statement-breakpoint
CREATE INDEX "project_photos_project_kind_created_idx"
  ON "project_photos" ("project_id", "kind", "created_at");
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "cover_photo_id" uuid;
--> statement-breakpoint
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_cover_photo_id_fkey"
  FOREIGN KEY ("cover_photo_id")
  REFERENCES "project_photos"("id")
  ON DELETE SET NULL;
--> statement-breakpoint
-- Widen file_photos kind to permit 'inline' comment-attachment rows.
-- The earlier comment-photo work (addInlineCommentPhoto) inserts
-- kind='inline' but the migration that gated kind in 0014 only
-- allowed 'creator' and 'make', so that path would have failed at
-- runtime. Drop + re-add the constraint with the wider set.
ALTER TABLE "file_photos" DROP CONSTRAINT IF EXISTS "file_photos_kind_check";
--> statement-breakpoint
ALTER TABLE "file_photos"
  ADD CONSTRAINT "file_photos_kind_check"
  CHECK ("kind" IN ('creator', 'make', 'inline'));
