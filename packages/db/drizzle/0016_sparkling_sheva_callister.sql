CREATE TABLE "billing_credit_top_up" (
	"polar_order_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"polar_checkout_id" text,
	"polar_customer_id" text NOT NULL,
	"product_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"credit_units" integer NOT NULL,
	"refunded_amount_cents" integer DEFAULT 0 NOT NULL,
	"refunded_credit_units" integer DEFAULT 0 NOT NULL,
	"paid_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "top_up_credit_units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_credit_top_up" ADD CONSTRAINT "billing_credit_top_up_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_credit_top_up_user_paid_idx" ON "billing_credit_top_up" USING btree ("user_id","paid_at");