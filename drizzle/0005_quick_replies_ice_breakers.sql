ALTER TABLE "accounts" ADD COLUMN "ice_breakers" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "rules" ADD COLUMN "quick_replies" text[] DEFAULT '{}' NOT NULL;