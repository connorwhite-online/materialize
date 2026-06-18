ALTER TABLE "cad_generations" ADD COLUMN "rating" text;--> statement-breakpoint
ALTER TABLE "cad_generations" ADD COLUMN "feedback_tags" jsonb;--> statement-breakpoint
ALTER TABLE "cad_generations" ADD COLUMN "feedback_note" text;--> statement-breakpoint
ALTER TABLE "cad_generations" ADD COLUMN "feedback_at" timestamp with time zone;
