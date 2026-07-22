CREATE TABLE "publish_link" (
	"id" text PRIMARY KEY NOT NULL,
	"design_id" text NOT NULL,
	"user_id" text NOT NULL,
	"element_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "publish_link" ADD CONSTRAINT "publish_link_design_fk" FOREIGN KEY ("design_id","user_id") REFERENCES "public"."design"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publish_link_design_idx" ON "publish_link" USING btree ("user_id","design_id");