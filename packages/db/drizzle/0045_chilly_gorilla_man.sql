ALTER TABLE "user" ADD COLUMN "agent_weekly_limit" integer;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "agent_usage_reset_at" timestamp;