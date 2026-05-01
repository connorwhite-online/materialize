-- Listing flag columns. Written when a deferred fingerprint pass
-- detects a cross-user geometry-hash collision after the listing has
-- already been published. The server action that detects the
-- collision flips status -> archived and writes flagged_reason +
-- flagged_at + flagged_against_file_id together.
--
-- We do not foreign-key flagged_against_file_id to files.id because
-- the cited listing might be deleted later and we want the audit
-- trail to survive (the dispute / takedown work later will resolve
-- "the file we flagged against is gone" gracefully).
ALTER TABLE "files"
  ADD COLUMN "flagged_reason" text,
  ADD COLUMN "flagged_at" timestamp with time zone,
  ADD COLUMN "flagged_against_file_id" uuid;
--> statement-breakpoint
CREATE INDEX "files_flagged_at_idx"
  ON "files" USING btree ("flagged_at");
