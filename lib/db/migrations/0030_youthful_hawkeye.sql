CREATE TYPE "public"."dispute_status" AS ENUM('open', 'resolved', 'rejected');--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid,
	"project_id" uuid,
	"raised_by_user_id" text NOT NULL,
	"reason" text NOT NULL,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "disputes_target_exactly_one" CHECK (("disputes"."file_id" IS NOT NULL AND "disputes"."project_id" IS NULL) OR ("disputes"."file_id" IS NULL AND "disputes"."project_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "print_orders" ADD COLUMN "refund_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_raised_by_user_id_users_id_fk" FOREIGN KEY ("raised_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disputes_file_id_idx" ON "disputes" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "disputes_project_id_idx" ON "disputes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "disputes_raised_by_idx" ON "disputes" USING btree ("raised_by_user_id");--> statement-breakpoint
CREATE INDEX "disputes_status_idx" ON "disputes" USING btree ("status");