ALTER TABLE "billing_entitlement" ADD COLUMN "subscription_status" text;--> statement-breakpoint
ALTER TABLE "billing_entitlement" ADD COLUMN "trial_start" timestamp;--> statement-breakpoint
ALTER TABLE "billing_entitlement" ADD COLUMN "trial_end" timestamp;