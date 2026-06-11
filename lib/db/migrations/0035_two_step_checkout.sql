ALTER TYPE "public"."print_order_status" ADD VALUE 'awaiting_production_payment' BEFORE 'ordered';--> statement-breakpoint
ALTER TABLE "print_orders" ADD COLUMN "checkout_model" text DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE "print_orders" ADD COLUMN "bridge_session_id" text;--> statement-breakpoint
ALTER TABLE "print_orders" ADD COLUMN "bridge_session_url" text;--> statement-breakpoint
ALTER TABLE "print_orders" ADD COLUMN "fee_payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "print_orders" ADD COLUMN "fee_authorized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "print_orders" ADD COLUMN "fee_captured_at" timestamp with time zone;