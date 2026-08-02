ALTER TABLE "published_site" ADD COLUMN "custom_domain" text;--> statement-breakpoint
ALTER TABLE "published_site" ADD COLUMN "custom_domain_provider_id" text;--> statement-breakpoint
ALTER TABLE "published_site" ADD COLUMN "custom_domain_status" text;--> statement-breakpoint
ALTER TABLE "published_site" ADD COLUMN "custom_domain_records" jsonb;--> statement-breakpoint
ALTER TABLE "published_site" ADD COLUMN "custom_domain_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "published_site" ADD CONSTRAINT "published_site_custom_domain_unique" UNIQUE("custom_domain");