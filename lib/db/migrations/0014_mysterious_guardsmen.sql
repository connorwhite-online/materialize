ALTER TABLE "file_photos" ADD COLUMN "kind" text DEFAULT 'creator' NOT NULL;--> statement-breakpoint
CREATE INDEX "file_photos_file_kind_created_idx" ON "file_photos" USING btree ("file_id","kind","created_at");--> statement-breakpoint
ALTER TABLE "file_photos" ADD CONSTRAINT "file_photos_kind_check" CHECK ("file_photos"."kind" IN ('creator', 'make'));