DROP INDEX "design_chat_design_idx";--> statement-breakpoint
ALTER TABLE "design_chat" ADD COLUMN "title" text DEFAULT 'New chat' NOT NULL;--> statement-breakpoint
CREATE INDEX "design_chat_design_idx" ON "design_chat" USING btree ("user_id","design_id","updated_at");