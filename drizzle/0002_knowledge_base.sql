ALTER TABLE "accounts" ADD COLUMN "knowledge_url" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "knowledge_text" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "knowledge_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rules" ADD COLUMN "max_words" integer;