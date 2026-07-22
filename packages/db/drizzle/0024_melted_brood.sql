CREATE TABLE "publish_egress" (
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "publish_egress_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "publish_egress" ADD CONSTRAINT "publish_egress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;