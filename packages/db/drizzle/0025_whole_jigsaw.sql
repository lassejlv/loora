/*
    Unfortunately in current drizzle-kit version we can't automatically get name for primary key.
    We are working on making it available!

    Meanwhile you can:
        1. Check pk name in your database, by running
            SELECT constraint_name FROM information_schema.table_constraints
            WHERE table_schema = 'public'
                AND table_name = 'ai_generation_lease'
                AND constraint_type = 'PRIMARY KEY';
        2. Uncomment code below and paste pk name manually

    Hope to release this update as soon as possible
*/

ALTER TABLE "ai_generation_lease" DROP CONSTRAINT "ai_generation_lease_pkey";--> statement-breakpoint
ALTER TABLE "ai_generation_lease" ADD CONSTRAINT "ai_generation_lease_user_id_token_pk" PRIMARY KEY("user_id","token");
