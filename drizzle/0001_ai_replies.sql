ALTER TABLE "accounts" ADD COLUMN "ai_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "ai_system_prompt" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "ai_fallback_text" text;