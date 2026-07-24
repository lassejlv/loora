CREATE TABLE "design_draft" (
	"id" text NOT NULL,
	"design_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"base_shapes" jsonb NOT NULL,
	"shapes" jsonb NOT NULL,
	"base_revision" integer NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"applied_version_id" text,
	"proposed_at" timestamp,
	"applied_at" timestamp,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "design_draft_id_user_id_pk" PRIMARY KEY("id","user_id")
);
--> statement-breakpoint
DROP INDEX "design_chat_design_idx";--> statement-breakpoint
DROP INDEX "design_version_design_idx";--> statement-breakpoint
ALTER TABLE "design" ADD COLUMN IF NOT EXISTS "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "design_chat" ADD COLUMN "draft_id" text;--> statement-breakpoint
ALTER TABLE "design_version" ADD COLUMN "draft_id" text;--> statement-breakpoint
ALTER TABLE "design_draft" ADD CONSTRAINT "design_draft_design_fk" FOREIGN KEY ("design_id","user_id") REFERENCES "public"."design"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_draft_design_idx" ON "design_draft" USING btree ("user_id","design_id","status","updated_at");--> statement-breakpoint
ALTER TABLE "design_chat" ADD CONSTRAINT "design_chat_draft_fk" FOREIGN KEY ("draft_id","user_id") REFERENCES "public"."design_draft"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_version" ADD CONSTRAINT "design_version_draft_fk" FOREIGN KEY ("draft_id","user_id") REFERENCES "public"."design_draft"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_chat_design_idx" ON "design_chat" USING btree ("user_id","design_id","draft_id","updated_at");--> statement-breakpoint
CREATE INDEX "design_version_design_idx" ON "design_version" USING btree ("user_id","design_id","draft_id","created_at");
