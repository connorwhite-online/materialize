-- File-identity foundations (docs/text-to-cad/10).
--
-- 1) Backfill: studio-minted files created BEFORE the `source` column existed
--    defaulted to 'upload', so the library's unsaved-draft filter
--    (notUnsavedStudioDraft: source='studio' AND status='draft') can't see
--    them — they squat in the owner's Files grid as thumbnail-less ghosts.
--    Any draft file whose asset a CAD generation points at is a studio mint;
--    re-tag it. Idempotent (second run matches zero rows).
UPDATE "files" SET "source" = 'studio'
WHERE "source" = 'upload' AND "status" = 'draft'
  AND "id" IN (
    SELECT fa."file_id" FROM "file_assets" fa
    JOIN "cad_generations" g ON g."file_asset_id" = fa."id"
    WHERE fa."file_id" IS NOT NULL
  );--> statement-breakpoint

-- 2) Provenance edges: factual, immutable-by-convention derivation pointers.
--    Attribution is provenance, not ownership — recorded from day one so the
--    remix graph exists before the remix feature ships. SET NULL on delete:
--    the derived work outlives its source.
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "derived_from_file_id" uuid;--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT IF EXISTS "files_derived_from_file_id_fk";--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_derived_from_file_id_fk"
  FOREIGN KEY ("derived_from_file_id") REFERENCES "files"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_derived_from_idx" ON "files" ("derived_from_file_id");--> statement-breakpoint
ALTER TABLE "cad_generations" ADD COLUMN IF NOT EXISTS "remix_of_generation_id" uuid;--> statement-breakpoint
ALTER TABLE "cad_generations" DROP CONSTRAINT IF EXISTS "cad_generations_remix_of_fk";--> statement-breakpoint
ALTER TABLE "cad_generations" ADD CONSTRAINT "cad_generations_remix_of_fk"
  FOREIGN KEY ("remix_of_generation_id") REFERENCES "cad_generations"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cad_generations_remix_of_idx" ON "cad_generations" ("remix_of_generation_id");
