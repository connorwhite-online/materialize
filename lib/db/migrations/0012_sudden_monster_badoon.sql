ALTER TYPE "public"."license" ADD VALUE 'cc0' BEFORE 'free';--> statement-breakpoint
ALTER TYPE "public"."license" ADD VALUE 'cc_by' BEFORE 'free';--> statement-breakpoint
ALTER TYPE "public"."license" ADD VALUE 'cc_by_sa' BEFORE 'free';--> statement-breakpoint
ALTER TYPE "public"."license" ADD VALUE 'cc_by_nd' BEFORE 'free';--> statement-breakpoint
ALTER TYPE "public"."license" ADD VALUE 'cc_by_nc' BEFORE 'free';--> statement-breakpoint
ALTER TYPE "public"."license" ADD VALUE 'cc_by_nc_sa' BEFORE 'free';--> statement-breakpoint
ALTER TYPE "public"."license" ADD VALUE 'cc_by_nc_nd' BEFORE 'free';--> statement-breakpoint
ALTER TABLE "files" ALTER COLUMN "license" SET DEFAULT 'cc_by';--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "license" SET DEFAULT 'cc_by';--> statement-breakpoint
-- Backfill legacy values to their CC equivalents:
--   free        -> cc0       (was "free for any use" → no rights reserved)
--   personal    -> cc_by_nc  (was "non-commercial only")
--   commercial  -> cc_by     (was "commercial allowed", attribution still expected)
-- Run after the ADD VALUE statements above so the new enum members
-- are visible. neon-http migrator executes each --> statement-breakpoint
-- chunk in its own transaction, so the new values are committed by
-- the time these UPDATEs run.
UPDATE "files" SET "license" = 'cc0' WHERE "license" = 'free';--> statement-breakpoint
UPDATE "files" SET "license" = 'cc_by_nc' WHERE "license" = 'personal';--> statement-breakpoint
UPDATE "files" SET "license" = 'cc_by' WHERE "license" = 'commercial';--> statement-breakpoint
UPDATE "projects" SET "license" = 'cc0' WHERE "license" = 'free';--> statement-breakpoint
UPDATE "projects" SET "license" = 'cc_by_nc' WHERE "license" = 'personal';--> statement-breakpoint
UPDATE "projects" SET "license" = 'cc_by' WHERE "license" = 'commercial';