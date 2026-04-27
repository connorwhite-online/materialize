-- Race-safe dedup for cart_items: collapse any pre-existing duplicates
-- (same user_id + file_asset_id + quote_id) into the oldest row with
-- summed quantities, then enforce uniqueness so the addToCart path's
-- INSERT ... ON CONFLICT DO UPDATE handles double-clicks atomically.

-- Step 1: bump the keeper row's quantity to the group total (capped
-- at 100 to match the application-level limit). Only updates rows
-- that are currently part of a duplicate group. Postgres compares
-- UUIDs by their byte order, so MIN(id) is stable across runs even
-- though the chosen "winner" is effectively random — but for true
-- duplicates the row data is identical, so any keeper works.
UPDATE "cart_items" AS keeper
SET "quantity" = LEAST(100, (
  SELECT SUM("quantity")::int
  FROM "cart_items"
  WHERE "user_id" = keeper."user_id"
    AND "file_asset_id" = keeper."file_asset_id"
    AND "quote_id" = keeper."quote_id"
))
WHERE "id" IN (
  SELECT MIN("id")
  FROM "cart_items"
  GROUP BY "user_id", "file_asset_id", "quote_id"
  HAVING COUNT(*) > 1
);
--> statement-breakpoint

-- Step 2: drop everything that isn't the keeper row in its group.
DELETE FROM "cart_items"
WHERE "id" NOT IN (
  SELECT MIN("id")
  FROM "cart_items"
  GROUP BY "user_id", "file_asset_id", "quote_id"
);
--> statement-breakpoint

-- Step 3: enforce uniqueness going forward.
CREATE UNIQUE INDEX "cart_items_user_file_quote_uniq"
  ON "cart_items" USING btree ("user_id", "file_asset_id", "quote_id");
