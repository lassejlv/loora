CREATE TABLE "ai_generation_lease" (
	"user_id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"acquired_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_entitlement" (
	"user_id" text PRIMARY KEY NOT NULL,
	"polar_customer_id" text,
	"polar_subscription_id" text,
	"product_id" text,
	"plan" text,
	"access_granted" boolean DEFAULT false NOT NULL,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"meter_balance" integer DEFAULT 0 NOT NULL,
	"credited_units" integer DEFAULT 0 NOT NULL,
	"consumed_units" integer DEFAULT 0 NOT NULL,
	"last_event_at" timestamp,
	"synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "credit_units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "polar_reported_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "polar_report_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_generation_lease" ADD CONSTRAINT "ai_generation_lease_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_entitlement" ADD CONSTRAINT "billing_entitlement_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "preview_access";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "preview_access_requested_at";