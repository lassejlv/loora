CREATE TABLE "design_chat" (
	"id" text NOT NULL,
	"design_id" text NOT NULL,
	"user_id" text NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "design_chat_id_user_id_pk" PRIMARY KEY("id","user_id")
);
--> statement-breakpoint
CREATE TABLE "design_version" (
	"id" text NOT NULL,
	"design_id" text NOT NULL,
	"user_id" text NOT NULL,
	"message" text NOT NULL,
	"shapes" jsonb NOT NULL,
	"added" integer NOT NULL,
	"removed" integer NOT NULL,
	"changed" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "design_version_id_user_id_pk" PRIMARY KEY("id","user_id")
);
--> statement-breakpoint
ALTER TABLE "design_chat" ADD CONSTRAINT "design_chat_design_fk" FOREIGN KEY ("design_id","user_id") REFERENCES "public"."design"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_version" ADD CONSTRAINT "design_version_design_fk" FOREIGN KEY ("design_id","user_id") REFERENCES "public"."design"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "design_chat_design_idx" ON "design_chat" USING btree ("user_id","design_id");--> statement-breakpoint
CREATE INDEX "design_version_design_idx" ON "design_version" USING btree ("user_id","design_id","created_at");