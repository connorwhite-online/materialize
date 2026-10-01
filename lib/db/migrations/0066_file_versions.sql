-- File versioning (docs/file-versioning.md). Every file_assets row on a
-- file is one immutable version of it; files.current_asset_id picks the
-- live one. Before this, ~every reader took "the first asset row", so a
-- file could only safely hold one asset and the studio re-save had to
-- swap asset rows between files to fake an update.
--
-- Idempotent per the 0039+ convention (neon-http, no wrapping
-- transaction): every statement is safe to re-apply.
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "current_asset_id" uuid;
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "show_version_history" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "file_assets" ADD COLUMN IF NOT EXISTS "version_number" integer;
--> statement-breakpoint
ALTER TABLE "file_assets" ADD COLUMN IF NOT EXISTS "version_note" text;
--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT IF EXISTS "files_current_asset_id_fkey";
--> statement-breakpoint
ALTER TABLE "files"
  ADD CONSTRAINT "files_current_asset_id_fkey"
  FOREIGN KEY ("current_asset_id")
  REFERENCES "file_assets"("id")
  ON DELETE SET NULL;
--> statement-breakpoint
-- Number existing assets per file in creation order. Only unnumbered
-- linked rows are touched; a re-run after a full pass is a no-op.
UPDATE "file_assets" AS fa
  SET "version_number" = numbered.rn
  FROM (
    SELECT "id", row_number() OVER (
      PARTITION BY "file_id" ORDER BY "created_at", "id"
    ) AS rn
    FROM "file_assets"
    WHERE "file_id" IS NOT NULL
  ) AS numbered
  WHERE fa."id" = numbered."id"
    AND fa."version_number" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "file_assets_file_version_uniq"
  ON "file_assets" USING btree ("file_id", "version_number");
--> statement-breakpoint
-- Current = the oldest asset: exactly what the createdAt-ordered readers
-- picked before this migration, so nothing anyone sees changes.
UPDATE "files" AS f
  SET "current_asset_id" = (
    SELECT fa."id" FROM "file_assets" AS fa
    WHERE fa."file_id" = f."id"
    ORDER BY fa."created_at", fa."id"
    LIMIT 1
  )
  WHERE f."current_asset_id" IS NULL
    AND EXISTS (SELECT 1 FROM "file_assets" AS fa WHERE fa."file_id" = f."id");
