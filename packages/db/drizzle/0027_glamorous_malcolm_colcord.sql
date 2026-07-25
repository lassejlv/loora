ALTER TABLE "publish_link" ALTER COLUMN "element_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "design" ADD COLUMN "pages" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "design_draft" ADD COLUMN "base_pages" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "design_draft" ADD COLUMN "pages" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "design_version" ADD COLUMN "pages" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "publish_link" ADD COLUMN "page_id" text;--> statement-breakpoint
ALTER TABLE "publish_link" ADD CONSTRAINT "publish_link_one_target" CHECK (("publish_link"."element_id" is not null) <> ("publish_link"."page_id" is not null));