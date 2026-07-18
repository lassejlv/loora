CREATE TABLE "design" (
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"shapes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "design_id_user_id_pk" PRIMARY KEY("id","user_id")
);
--> statement-breakpoint
ALTER TABLE "design" ADD CONSTRAINT "design_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_user_id_idx" ON "design" USING btree ("user_id");