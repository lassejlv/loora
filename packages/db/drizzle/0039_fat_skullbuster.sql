CREATE TABLE "launch_week" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"start_date" text NOT NULL,
	"headline" text NOT NULL,
	"description" text NOT NULL,
	"days" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
