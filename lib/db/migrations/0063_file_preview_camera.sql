-- Owner-chosen preview camera (see files.previewDir* in lib/db/schema.ts).
--
-- Records the angle the file's owner picked when they last pressed
-- "Update preview": a unit direction from the model's centre, plus the
-- fraction of viewport height the model spans. The detail viewer reads
-- it back so a file opens on the angle its author chose, rather than
-- the fixed head-on default.
--
-- All four nullable with no default: NULL means "this file's thumbnail
-- came from the automatic capture", which is the signal for the viewer
-- to keep its own framing. Backfilling a default would erase that
-- distinction.
--
-- Idempotent per the 0039+ convention: the neon-http migrator runs
-- these over HTTP with no wrapping transaction, so a file that fails
-- halfway must be safe to re-apply.
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "preview_dir_x" double precision;
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "preview_dir_y" double precision;
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "preview_dir_z" double precision;
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "preview_framing" double precision;
