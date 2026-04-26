CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"slug" text NOT NULL,
	"price" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"license" "license" DEFAULT 'free' NOT NULL,
	"status" "file_status" DEFAULT 'draft' NOT NULL,
	"visibility" "visibility" DEFAULT 'public' NOT NULL,
	"tags" text[],
	"design_tags" text[],
	"thumbnail_url" text,
	"download_count" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "project_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_user_id_idx" ON "projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "projects_slug_idx" ON "projects" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "project_files_project_id_idx" ON "project_files" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_files_file_id_idx" ON "project_files" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_files_project_file_uniq" ON "project_files" USING btree ("project_id","file_id");--> statement-breakpoint

-- Rename collection_files → collection_items, preserving data, indexes,
-- and the existing file_id FK. Then relax file_id to nullable, add the
-- project_id column + FK, and add the xor CHECK constraint.
ALTER TABLE "collection_files" RENAME TO "collection_items";--> statement-breakpoint
ALTER INDEX "collection_files_collection_id_idx" RENAME TO "collection_items_collection_id_idx";--> statement-breakpoint
ALTER INDEX "collection_files_file_id_idx" RENAME TO "collection_items_file_id_idx";--> statement-breakpoint
ALTER TABLE "collection_items" RENAME CONSTRAINT "collection_files_collection_id_collections_id_fk" TO "collection_items_collection_id_collections_id_fk";--> statement-breakpoint
ALTER TABLE "collection_items" RENAME CONSTRAINT "collection_files_file_id_files_id_fk" TO "collection_items_file_id_files_id_fk";--> statement-breakpoint
ALTER TABLE "collection_items" ALTER COLUMN "file_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_items" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_items_project_id_idx" ON "collection_items" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_target_exactly_one" CHECK (("collection_items"."file_id" IS NOT NULL AND "collection_items"."project_id" IS NULL) OR ("collection_items"."file_id" IS NULL AND "collection_items"."project_id" IS NOT NULL));--> statement-breakpoint

-- Purchases: relax file_id to nullable, add project_id + FK, add xor CHECK.
ALTER TABLE "purchases" ALTER COLUMN "file_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchases_project_id_idx" ON "purchases" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_target_exactly_one" CHECK (("purchases"."file_id" IS NOT NULL AND "purchases"."project_id" IS NULL) OR ("purchases"."file_id" IS NULL AND "purchases"."project_id" IS NOT NULL));
