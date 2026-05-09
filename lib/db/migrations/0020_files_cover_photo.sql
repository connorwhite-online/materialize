ALTER TABLE "files" ADD COLUMN "cover_photo_id" uuid;
--> statement-breakpoint
ALTER TABLE "files"
  ADD CONSTRAINT "files_cover_photo_id_fkey"
  FOREIGN KEY ("cover_photo_id")
  REFERENCES "file_photos"("id")
  ON DELETE SET NULL;
