ALTER TABLE "user" ADD COLUMN "preview_access" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "preview_access_requested_at" timestamp;