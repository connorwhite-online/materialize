ALTER TYPE "public"."print_order_status" ADD VALUE 'auto_approved' BEFORE 'ordered';--> statement-breakpoint
CREATE TABLE "token_spending_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" uuid NOT NULL,
	"print_order_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"charged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personal_access_tokens" ADD COLUMN "spending_policy" jsonb;--> statement-breakpoint
ALTER TABLE "print_orders" ADD COLUMN "auto_approved_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "default_payment_method" text;--> statement-breakpoint
ALTER TABLE "token_spending_ledger" ADD CONSTRAINT "token_spending_ledger_token_id_personal_access_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."personal_access_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_spending_ledger" ADD CONSTRAINT "token_spending_ledger_print_order_id_print_orders_id_fk" FOREIGN KEY ("print_order_id") REFERENCES "public"."print_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "token_spending_ledger_token_id_charged_at_idx" ON "token_spending_ledger" USING btree ("token_id","charged_at");