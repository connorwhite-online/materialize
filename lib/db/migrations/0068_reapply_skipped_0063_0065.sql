-- Re-apply 0063, 0064 and 0065, which production never ran.
--
-- Evidence: on 2026-10-08 an insert into "users" failed in production
-- with `column "phone_number" of relation "users" does not exist` (Sentry
-- MATERIALIZE-WEB-PLATFORM-45), so 0064 is missing. The migrator only
-- applies files whose journal `when` is newer than the newest migration
-- it has recorded, and something newer was recorded before these three
-- merged, so they were skipped silently, the same failure as the
-- 2026-10-01 outage. 0063 and 0065 also hold several statements with no
-- breakpoint, which the neon-http migrator rejects, so they cannot have
-- run through it either.
--
-- Every statement is a copy of the original and safe to re-apply, so this
-- is a no-op anywhere they did run. Idempotent per the 0039+ convention.

-- 0063_file_preview_camera
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "preview_dir_x" double precision;
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "preview_dir_y" double precision;
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "preview_dir_z" double precision;
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "preview_framing" double precision;
--> statement-breakpoint
-- 0064_user_phone_number
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_number" text;
--> statement-breakpoint
-- 0065_print_order_is_test. The backfill only touches rows still false
-- inside the pre-launch windows, so a second run changes nothing.
ALTER TABLE "print_orders" ADD COLUMN IF NOT EXISTS "is_test" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "print_orders" SET "is_test" = true
  WHERE "is_test" = false
    AND (
      "created_at" < '2026-09-27T09:00:00Z'
      OR (
        "created_at" < '2026-09-27T16:35:00Z'
        AND "status" NOT IN ('ordered', 'in_production', 'shipped', 'received', 'blocked')
      )
    );
