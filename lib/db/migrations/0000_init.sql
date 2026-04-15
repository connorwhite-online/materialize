CREATE TYPE "public"."file_format" AS ENUM('stl', 'obj', '3mf', 'step', 'amf');--> statement-breakpoint
CREATE TYPE "public"."file_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."file_unit" AS ENUM('mm', 'cm', 'in');--> statement-breakpoint
CREATE TYPE "public"."license" AS ENUM('free', 'personal', 'commercial');--> statement-breakpoint
CREATE TYPE "public"."print_order_status" AS ENUM('quoting', 'cart_created', 'ordered', 'in_production', 'shipped', 'received', 'blocked', 'refunded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."purchase_status" AS ENUM('pending', 'completed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TABLE "collection_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"tags" text[],
	"visibility" "visibility" DEFAULT 'public' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "file_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid,
	"storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"format" "file_format" NOT NULL,
	"file_unit" "file_unit" DEFAULT 'mm' NOT NULL,
	"file_size" bigint NOT NULL,
	"geometry_data" jsonb,
	"craft_cloud_model_id" text,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"caption" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"slug" text NOT NULL,
	"price" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"license" "license" DEFAULT 'free' NOT NULL,
	"status" "file_status" DEFAULT 'draft' NOT NULL,
	"tags" text[],
	"recommended_material_id" text,
	"design_tags" text[],
	"min_wall_thickness" integer,
	"visibility" "visibility" DEFAULT 'public' NOT NULL,
	"download_count" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"thumbnail_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "print_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"file_asset_id" uuid NOT NULL,
	"craft_cloud_order_id" text,
	"craft_cloud_cart_id" text,
	"stripe_session_id" text,
	"total_price" integer NOT NULL,
	"service_fee" integer NOT NULL,
	"material_subtotal" integer,
	"shipping_subtotal" integer,
	"quantity" integer,
	"material" text,
	"vendor" text,
	"status" "print_order_status" DEFAULT 'quoting' NOT NULL,
	"shipping_address" jsonb,
	"tracking_info" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_id" text NOT NULL,
	"file_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"service_fee" integer NOT NULL,
	"creator_payout" integer NOT NULL,
	"stripe_payment_intent_id" text,
	"status" "purchase_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text,
	"display_name" text,
	"bio" text,
	"avatar_url" text,
	"social_links" jsonb,
	"stripe_account_id" text,
	"stripe_onboarding_complete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "collection_files" ADD CONSTRAINT "collection_files_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_files" ADD CONSTRAINT "collection_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_photos" ADD CONSTRAINT "file_photos_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_photos" ADD CONSTRAINT "file_photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_orders" ADD CONSTRAINT "print_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_orders" ADD CONSTRAINT "print_orders_file_asset_id_file_assets_id_fk" FOREIGN KEY ("file_asset_id") REFERENCES "public"."file_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_files_collection_id_idx" ON "collection_files" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "collection_files_file_id_idx" ON "collection_files" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "collections_user_id_idx" ON "collections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "collections_slug_idx" ON "collections" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "file_assets_file_id_idx" ON "file_assets" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "file_assets_content_hash_idx" ON "file_assets" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "file_photos_file_id_idx" ON "file_photos" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "files_user_id_idx" ON "files" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "files_status_idx" ON "files" USING btree ("status");--> statement-breakpoint
CREATE INDEX "files_slug_idx" ON "files" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "print_orders_user_id_idx" ON "print_orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "purchases_buyer_id_idx" ON "purchases" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "purchases_file_id_idx" ON "purchases" USING btree ("file_id");