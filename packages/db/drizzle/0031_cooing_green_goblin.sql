CREATE TABLE "canvas_agent_activity" (
	"id" text NOT NULL,
	"design_id" text NOT NULL,
	"user_id" text NOT NULL,
	"target_key" text NOT NULL,
	"label" text NOT NULL,
	"node_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"phase" text DEFAULT 'working' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "canvas_agent_activity_id_user_id_pk" PRIMARY KEY("id","user_id")
);
--> statement-breakpoint
ALTER TABLE "canvas_agent_activity" ADD CONSTRAINT "canvas_agent_activity_design_fk" FOREIGN KEY ("design_id","user_id") REFERENCES "public"."design"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canvas_agent_activity_target_idx" ON "canvas_agent_activity" USING btree ("user_id","design_id","target_key","expires_at");--> statement-breakpoint
CREATE INDEX "canvas_agent_activity_expires_idx" ON "canvas_agent_activity" USING btree ("expires_at");