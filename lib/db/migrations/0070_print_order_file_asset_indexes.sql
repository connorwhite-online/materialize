-- Index the file_asset_id foreign keys on print_orders and
-- print_order_items (see the index lists on printOrders /
-- printOrderItems in lib/db/schema.ts).
--
-- Both columns are read by asset (entitlement + "printed" checks, file
-- activity, the active-order gate on file deletion) and are the child
-- side of an ON DELETE CASCADE from file_assets — without an index every
-- one of those, and every asset delete, is a sequential scan.
--
-- Idempotent per the 0039+ convention.
CREATE INDEX IF NOT EXISTS "print_orders_file_asset_id_idx" ON "print_orders" USING btree ("file_asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "print_order_items_file_asset_id_idx" ON "print_order_items" USING btree ("file_asset_id");
