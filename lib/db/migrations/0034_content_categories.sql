ALTER TABLE "collections" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "category" text;--> statement-breakpoint
CREATE INDEX "collections_category_idx" ON "collections" USING btree ("category");--> statement-breakpoint
CREATE INDEX "files_category_idx" ON "files" USING btree ("category");--> statement-breakpoint
CREATE INDEX "projects_category_idx" ON "projects" USING btree ("category");