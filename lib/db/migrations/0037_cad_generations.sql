CREATE TYPE "public"."cad_generation_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "cad_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"prompt" text NOT NULL,
	"engine" text DEFAULT 'build123d' NOT NULL,
	"source_code" text,
	"parent_generation_id" uuid,
	"file_asset_id" uuid,
	"status" "cad_generation_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"render_data_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cad_generations" ADD CONSTRAINT "cad_generations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cad_generations" ADD CONSTRAINT "cad_generations_file_asset_id_file_assets_id_fk" FOREIGN KEY ("file_asset_id") REFERENCES "public"."file_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cad_generations" ADD CONSTRAINT "cad_generations_parent_fk" FOREIGN KEY ("parent_generation_id") REFERENCES "public"."cad_generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cad_generations_user_id_idx" ON "cad_generations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cad_generations_file_asset_id_idx" ON "cad_generations" USING btree ("file_asset_id");--> statement-breakpoint
CREATE INDEX "cad_generations_parent_idx" ON "cad_generations" USING btree ("parent_generation_id");