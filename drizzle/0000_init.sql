CREATE TYPE "public"."match_mode" AS ENUM('contains', 'exact');--> statement-breakpoint
CREATE TYPE "public"."trigger_type" AS ENUM('comment', 'dm');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"ig_user_id" text NOT NULL,
	"username" text NOT NULL,
	"access_token" text,
	"token_expires_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_ig_user_id_unique" UNIQUE("ig_user_id")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"ig_scoped_id" text NOT NULL,
	"username" text,
	"last_interaction_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer,
	"rule_id" integer,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"dedup_key" text,
	"ig_object_id" text,
	"contact_ig_id" text,
	"text" text,
	"detail" text,
	"payload" jsonb,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_log_dedup_key_unique" UNIQUE("dedup_key")
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"trigger_type" "trigger_type" NOT NULL,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"match_mode" "match_mode" DEFAULT 'contains' NOT NULL,
	"post_id" text,
	"public_reply" text,
	"dm_text" text,
	"dm_button_url" text,
	"dm_button_title" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events_log" ADD CONSTRAINT "events_log_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events_log" ADD CONSTRAINT "events_log_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_account_ig_idx" ON "contacts" USING btree ("account_id","ig_scoped_id");--> statement-breakpoint
CREATE INDEX "events_log_created_idx" ON "events_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "events_log_account_idx" ON "events_log" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "rules_account_idx" ON "rules" USING btree ("account_id","trigger_type","active");