CREATE TABLE "webhook_events_processed" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "webhook_events_processed_processed_at_idx" ON "webhook_events_processed" USING btree ("processed_at");