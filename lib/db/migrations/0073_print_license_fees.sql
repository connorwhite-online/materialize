-- Charging a paid listing's price when someone prints it without
-- owning it (lib/print/license.ts): the license amount on the order and
-- its items, and the purchase row's link back to the print order plus
-- the creator transfer that paid it out.
--
-- Additive only. Idempotent per the 0039+ convention.
ALTER TABLE "print_orders" ADD COLUMN IF NOT EXISTS "license_fee" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "print_order_items" ADD COLUMN IF NOT EXISTS "license_fee" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "print_order_id" uuid;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "stripe_transfer_id" text;--> statement-breakpoint
ALTER TABLE "purchases" DROP CONSTRAINT IF EXISTS "purchases_print_order_id_print_orders_id_fk";--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_print_order_id_print_orders_id_fk" FOREIGN KEY ("print_order_id") REFERENCES "public"."print_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchases_print_order_id_idx" ON "purchases" USING btree ("print_order_id");
