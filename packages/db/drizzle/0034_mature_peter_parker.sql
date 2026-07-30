CREATE TABLE "design_share" (
	"id" text PRIMARY KEY NOT NULL,
	"design_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invited_by_user_id" text NOT NULL,
	"user_id" text,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "canvas_transaction" ADD COLUMN "author_user_id" text;--> statement-breakpoint
ALTER TABLE "design" ADD COLUMN "link_access" text DEFAULT 'restricted' NOT NULL;--> statement-breakpoint
ALTER TABLE "design_share" ADD CONSTRAINT "design_share_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_share" ADD CONSTRAINT "design_share_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_share" ADD CONSTRAINT "design_share_design_fk" FOREIGN KEY ("design_id","owner_user_id") REFERENCES "public"."design"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "design_share_design_email_idx" ON "design_share" USING btree ("design_id","owner_user_id","email");--> statement-breakpoint
CREATE INDEX "design_share_email_idx" ON "design_share" USING btree ("email");--> statement-breakpoint
CREATE INDEX "design_share_user_idx" ON "design_share" USING btree ("user_id");