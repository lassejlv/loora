ALTER TABLE "asset" ALTER COLUMN "data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "storage_key" text;