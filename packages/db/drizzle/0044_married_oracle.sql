CREATE TABLE "assistant_message" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"thread_id" text NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_thread" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"design_id" text NOT NULL,
	"draft_id" text,
	"title" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chatgpt_account" (
	"user_id" text PRIMARY KEY NOT NULL,
	"chatgpt_user_id" text NOT NULL,
	"chatgpt_account_id" text,
	"email" text,
	"name" text,
	"avatar_url" text,
	"plan_type" text,
	"access_token" text NOT NULL,
	"access_token_expires_at" timestamp,
	"refresh_token" text,
	"api_key" text,
	"api_key_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_message" ADD CONSTRAINT "assistant_message_thread_id_assistant_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."assistant_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_thread" ADD CONSTRAINT "assistant_thread_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatgpt_account" ADD CONSTRAINT "chatgpt_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_message_thread_idx" ON "assistant_message" USING btree ("thread_id","seq");--> statement-breakpoint
CREATE INDEX "assistant_thread_target_idx" ON "assistant_thread" USING btree ("user_id","design_id","updated_at");