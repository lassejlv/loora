CREATE TABLE "user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"shortcuts" jsonb DEFAULT '{"overrides":{},"custom":[]}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;