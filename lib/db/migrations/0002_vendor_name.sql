ALTER TABLE "cart_items" ADD COLUMN "vendor_name" text;--> statement-breakpoint
ALTER TABLE "print_order_items" ADD COLUMN "vendor_id" text;--> statement-breakpoint
ALTER TABLE "print_order_items" ADD COLUMN "vendor_name" text;--> statement-breakpoint
ALTER TABLE "print_orders" ADD COLUMN "vendor_name" text;