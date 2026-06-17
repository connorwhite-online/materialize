ALTER TABLE "cad_generations" RENAME COLUMN "render_data_url" TO "render_storage_key";--> statement-breakpoint
DROP INDEX "cad_generations_user_id_idx";--> statement-breakpoint
CREATE INDEX "cad_generations_user_created_idx" ON "cad_generations" USING btree ("user_id","created_at");
