CREATE TABLE "design_github_repository" (
	"design_id" text NOT NULL,
	"user_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"default_branch" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "design_github_repository_design_id_user_id_pk" PRIMARY KEY("design_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "github_account" (
	"user_id" text PRIMARY KEY NOT NULL,
	"github_user_id" text NOT NULL,
	"login" text NOT NULL,
	"avatar_url" text,
	"access_token" text NOT NULL,
	"access_token_expires_at" timestamp,
	"refresh_token" text,
	"refresh_token_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_installation" (
	"user_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"target_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"avatar_url" text,
	"repository_selection" text NOT NULL,
	"suspended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_installation_user_id_installation_id_pk" PRIMARY KEY("user_id","installation_id")
);
--> statement-breakpoint
ALTER TABLE "design_chat" ADD COLUMN "github_repository_id" text;--> statement-breakpoint
ALTER TABLE "design_chat" ADD COLUMN "github_repository_full_name" text;--> statement-breakpoint
ALTER TABLE "design_github_repository" ADD CONSTRAINT "design_github_repository_design_fk" FOREIGN KEY ("design_id","user_id") REFERENCES "public"."design"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_github_repository" ADD CONSTRAINT "design_github_repository_installation_fk" FOREIGN KEY ("user_id","installation_id") REFERENCES "public"."github_installation"("user_id","installation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_account" ADD CONSTRAINT "github_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installation" ADD CONSTRAINT "github_installation_user_id_github_account_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."github_account"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_github_repository_repo_idx" ON "design_github_repository" USING btree ("user_id","installation_id","repository_id");--> statement-breakpoint
CREATE INDEX "github_installation_id_idx" ON "github_installation" USING btree ("installation_id");