ALTER TABLE "accounts" ADD COLUMN "human_pause_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "bot_paused_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "bot_paused_permanent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events_log" ADD COLUMN "ig_message_id" text;--> statement-breakpoint
CREATE INDEX "events_log_ig_message_idx" ON "events_log" USING btree ("ig_message_id");