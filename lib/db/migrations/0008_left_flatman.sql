ALTER TYPE "public"."print_order_status" ADD VALUE 'awaiting_agent_approval' BEFORE 'ordered';--> statement-breakpoint
CREATE TABLE "personal_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"scopes" text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "print_orders" ADD COLUMN "initiated_by_token_id" uuid;--> statement-breakpoint
ALTER TABLE "print_orders" ADD COLUMN "agent_name" text;--> statement-breakpoint
ALTER TABLE "print_orders" ADD COLUMN "confirmation_token" text;--> statement-breakpoint
ALTER TABLE "print_orders" ADD COLUMN "confirmation_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "print_orders" ADD COLUMN "agent_idempotency_key" text;--> statement-breakpoint
ALTER TABLE "personal_access_tokens" ADD CONSTRAINT "personal_access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "personal_access_tokens_user_id_idx" ON "personal_access_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_access_tokens_token_hash_uniq" ON "personal_access_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "print_orders_confirmation_token_uniq" ON "print_orders" USING btree ("confirmation_token");--> statement-breakpoint
CREATE UNIQUE INDEX "print_orders_agent_idempotency_uniq" ON "print_orders" USING btree ("user_id","agent_idempotency_key");