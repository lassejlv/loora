CREATE TABLE "published_site" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"design_id" text NOT NULL,
	"page_id" text NOT NULL,
	"handle" text NOT NULL,
	"slug" text NOT NULL,
	"storage_key" text NOT NULL,
	"title" text NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "handle" text;--> statement-breakpoint
ALTER TABLE "published_site" ADD CONSTRAINT "published_site_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_site" ADD CONSTRAINT "published_site_design_fk" FOREIGN KEY ("design_id","user_id") REFERENCES "public"."design"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "published_site_handle_slug_uidx" ON "published_site" USING btree ("handle","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "published_site_design_page_uidx" ON "published_site" USING btree ("design_id","page_id");--> statement-breakpoint
CREATE INDEX "published_site_user_idx" ON "published_site" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "published_site_design_idx" ON "published_site" USING btree ("user_id","design_id");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_handle_unique" UNIQUE("handle");