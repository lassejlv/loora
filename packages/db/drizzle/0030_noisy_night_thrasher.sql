CREATE TABLE "canvas_transaction" (
	"design_id" text NOT NULL,
	"user_id" text NOT NULL,
	"target_key" text NOT NULL,
	"transaction_id" text NOT NULL,
	"base_revision" integer NOT NULL,
	"revision" integer NOT NULL,
	"transaction" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "canvas_transaction_user_id_design_id_target_key_transaction_id_pk" PRIMARY KEY("user_id","design_id","target_key","transaction_id")
);
--> statement-breakpoint
DROP TABLE "design_pull_request" CASCADE;--> statement-breakpoint
DROP TABLE "design_pull_request_comment" CASCADE;--> statement-breakpoint
ALTER TABLE "design" ADD COLUMN "canvas_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "design" ADD COLUMN "canvas_document" jsonb;--> statement-breakpoint
ALTER TABLE "design" ADD COLUMN "canvas_migration_lease_id" text;--> statement-breakpoint
ALTER TABLE "design" ADD COLUMN "canvas_migration_lease_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "design_draft" ADD COLUMN "canvas_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "design_draft" ADD COLUMN "base_canvas_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "design_draft" ADD COLUMN "base_canvas_document" jsonb;--> statement-breakpoint
ALTER TABLE "design_draft" ADD COLUMN "canvas_document" jsonb;--> statement-breakpoint
ALTER TABLE "design_version" ADD COLUMN "canvas_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "design_version" ADD COLUMN "canvas_document" jsonb;--> statement-breakpoint
ALTER TABLE "canvas_transaction" ADD CONSTRAINT "canvas_transaction_design_fk" FOREIGN KEY ("design_id","user_id") REFERENCES "public"."design"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canvas_transaction_target_revision_idx" ON "canvas_transaction" USING btree ("user_id","design_id","target_key","revision");--> statement-breakpoint
CREATE INDEX "canvas_transaction_created_idx" ON "canvas_transaction" USING btree ("created_at");