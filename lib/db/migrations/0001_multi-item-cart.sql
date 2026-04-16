CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"file_asset_id" uuid NOT NULL,
	"quote_id" text NOT NULL,
	"vendor_id" text NOT NULL,
	"material_config_id" text NOT NULL,
	"shipping_id" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"material_price" integer NOT NULL,
	"shipping_price" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"country_code" text DEFAULT 'US' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "print_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"print_order_id" uuid NOT NULL,
	"file_asset_id" uuid NOT NULL,
	"quote_id" text NOT NULL,
	"material_config_id" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"material_subtotal" integer NOT NULL,
	"shipping_subtotal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "print_orders" ALTER COLUMN "file_asset_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_file_asset_id_file_assets_id_fk" FOREIGN KEY ("file_asset_id") REFERENCES "public"."file_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_order_items" ADD CONSTRAINT "print_order_items_print_order_id_print_orders_id_fk" FOREIGN KEY ("print_order_id") REFERENCES "public"."print_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_order_items" ADD CONSTRAINT "print_order_items_file_asset_id_file_assets_id_fk" FOREIGN KEY ("file_asset_id") REFERENCES "public"."file_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cart_items_user_id_idx" ON "cart_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cart_items_user_vendor_idx" ON "cart_items" USING btree ("user_id","vendor_id");--> statement-breakpoint
CREATE INDEX "print_order_items_order_id_idx" ON "print_order_items" USING btree ("print_order_id");