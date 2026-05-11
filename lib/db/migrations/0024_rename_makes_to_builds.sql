-- Rename "make" → "build" everywhere it surfaces in the database:
--   * file_photos.kind / project_photos.kind row values + CHECK
--   * notifications.type tags
--   * notifications.payload->'makeId' jsonb field
--   * users.email_notification_prefs->'make_on_file' jsonb key
--
-- One-shot rename — nothing dual-writes during the transition because
-- every reader of the old names is updated in the same commit. Order
-- inside the migration matters: we mutate jsonb payloads BEFORE
-- renaming the type tag they're keyed off, so the WHERE clause stays
-- intuitive.

-- 1. file_photos: drop CHECK, migrate rows, re-add CHECK with new set.
ALTER TABLE "file_photos" DROP CONSTRAINT IF EXISTS "file_photos_kind_check";
--> statement-breakpoint
UPDATE "file_photos" SET "kind" = 'build' WHERE "kind" = 'make';
--> statement-breakpoint
ALTER TABLE "file_photos"
  ADD CONSTRAINT "file_photos_kind_check"
  CHECK ("kind" IN ('creator', 'build', 'inline'));
--> statement-breakpoint

-- 2. project_photos: same dance.
ALTER TABLE "project_photos" DROP CONSTRAINT IF EXISTS "project_photos_kind_check";
--> statement-breakpoint
UPDATE "project_photos" SET "kind" = 'build' WHERE "kind" = 'make';
--> statement-breakpoint
ALTER TABLE "project_photos"
  ADD CONSTRAINT "project_photos_kind_check"
  CHECK ("kind" IN ('creator', 'build', 'inline'));
--> statement-breakpoint

-- 3. notifications: rename payload->makeId → payload->buildId BEFORE
--    flipping the type tag, so the WHERE clause is unambiguous about
--    which rows still need it.
UPDATE "notifications"
SET "payload" = ("payload" - 'makeId')
  || jsonb_build_object('buildId', "payload"->'makeId')
WHERE "type" = 'make_on_file' AND "payload" ? 'makeId';
--> statement-breakpoint
UPDATE "notifications" SET "type" = 'build_on_file' WHERE "type" = 'make_on_file';
--> statement-breakpoint

-- 4. users.email_notification_prefs: rename the make_on_file key. A
--    user who had explicitly opted out of make_on_file almost
--    certainly wants the same setting on build_on_file (it's the
--    same event with a new name).
UPDATE "users"
SET "email_notification_prefs" =
  ("email_notification_prefs" - 'make_on_file')
  || jsonb_build_object(
      'build_on_file',
      "email_notification_prefs"->'make_on_file'
    )
WHERE "email_notification_prefs" ? 'make_on_file';
