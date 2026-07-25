CREATE TABLE "design_pull_request" (
	"id" text PRIMARY KEY NOT NULL,
	"design_id" text NOT NULL,
	"draft_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"merged_at" timestamp,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_pull_request_comment" (
	"id" text PRIMARY KEY NOT NULL,
	"pull_request_id" text NOT NULL,
	"author_user_id" text,
	"author_name" text NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "design_pull_request" ADD CONSTRAINT "design_pull_request_design_fk" FOREIGN KEY ("design_id","user_id") REFERENCES "public"."design"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_pull_request" ADD CONSTRAINT "design_pull_request_draft_fk" FOREIGN KEY ("draft_id","user_id") REFERENCES "public"."design_draft"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_pull_request_comment" ADD CONSTRAINT "design_pull_request_comment_pull_request_id_design_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."design_pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_pull_request_comment" ADD CONSTRAINT "design_pull_request_comment_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_pull_request_draft_idx" ON "design_pull_request" USING btree ("user_id","design_id","draft_id");--> statement-breakpoint
CREATE INDEX "design_pull_request_comment_idx" ON "design_pull_request_comment" USING btree ("pull_request_id","created_at");