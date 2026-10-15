import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  integer,
} from "drizzle-orm/pg-core";

export const triggerTypeEnum = pgEnum("trigger_type", ["comment", "dm"]);
export const matchModeEnum = pgEnum("match_mode", ["contains", "exact"]);

/** Připojené Instagram účty (multi-account). Token je uložen šifrovaně (AES-256-GCM). */
export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  igUserId: text("ig_user_id").notNull().unique(),
  username: text("username").notNull(),
  accessToken: text("access_token"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  /** AI odpovědi (Gemini) na DM, které nesedí na žádné pravidlo. */
  aiEnabled: boolean("ai_enabled").notNull().default(false),
  aiSystemPrompt: text("ai_system_prompt"),
  /** Pošle se, když AI selže. Prázdné = při chybě se neodpoví nic. */
  aiFallbackText: text("ai_fallback_text"),
  /** Znalostní báze z webu klienta – text stažený crawlerem (lib/knowledge/crawl.ts), jde do kontextu AI. */
  knowledgeUrl: text("knowledge_url"),
  knowledgeText: text("knowledge_text"),
  knowledgeUpdatedAt: timestamp("knowledge_updated_at", { withTimezone: true }),
  /** Kam posílat upozornění na nové leady (e-mail/telefon v DM). Prázdné = neposílat. */
  notifyEmail: text("notify_email"),
  /** Ice breakers – až 4 úvodní otázky v prázdném DM (nastavují se přes messenger_profile). */
  iceBreakers: text("ice_breakers").array().notNull().default([]),
  /** Ruční odpověď člověka v DM pozastaví bota u kontaktu na tolik minut (0 = nepozastavovat). */
  humanPauseMinutes: integer("human_pause_minutes").notNull().default(30),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rules = pgTable(
  "rules",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name").notNull().default(""),
    triggerType: triggerTypeEnum("trigger_type").notNull(),
    keywords: text("keywords").array().notNull().default([]),
    matchMode: matchModeEnum("match_mode").notNull().default("contains"),
    postId: text("post_id"),
    publicReply: text("public_reply"),
    dmText: text("dm_text"),
    dmButtonUrl: text("dm_button_url"),
    dmButtonTitle: text("dm_button_title"),
    /** "Jen krátká zpráva": pravidlo platí jen pro texty s nejvýš tolika slovy (null = bez omezení). */
    maxWords: integer("max_words"),
    /** Při spuštění pravidla (ostrá DM) poslat e-mail na accounts.notify_email. */
    notifyOnMatch: boolean("notify_on_match").notNull().default(false),
    /** Quick replies pod DM odpovědí (max. 13, titulek max. 20 znaků). Payload = text tlačítka. */
    quickReplies: text("quick_replies").array().notNull().default([]),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rules_account_idx").on(t.accountId, t.triggerType, t.active)],
);

/**
 * Log příchozích webhooků i odchozích odpovědí.
 * `dedupKey` je unikátní → slouží zároveň jako idempotence (Meta webhooky doručuje i opakovaně).
 */
export const eventsLog = pgTable(
  "events_log",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").references(() => accounts.id, { onDelete: "set null" }),
    ruleId: integer("rule_id").references(() => rules.id, { onDelete: "set null" }),
    direction: text("direction").$type<"in" | "out">().notNull(),
    kind: text("kind")
      .$type<"comment" | "message" | "public_reply" | "private_reply" | "dm" | "ai_reply" | "lead_notify" | "rule_notify" | "token_refresh" | "token_alert" | "human_reply" | "webhook">()
      .notNull(),
    status: text("status")
      .$type<"received" | "processed" | "ignored" | "pending" | "sent" | "failed" | "skipped">()
      .notNull(),
    dedupKey: text("dedup_key").unique(),
    igObjectId: text("ig_object_id"),
    contactIgId: text("contact_ig_id"),
    /** Mid zprávy, kterou odeslal bot (z odpovědi Send API) – podle něj se echo pozná jako vlastní, ne ruční. */
    igMessageId: text("ig_message_id"),
    text: text("text"),
    detail: text("detail"),
    payload: jsonb("payload"),
    simulated: boolean("simulated").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("events_log_created_idx").on(t.createdAt),
    index("events_log_account_idx").on(t.accountId),
    index("events_log_ig_message_idx").on(t.igMessageId),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    igScopedId: text("ig_scoped_id").notNull(),
    username: text("username"),
    /** Poslední příchozí DM od uživatele – otevírá 24h okno pro standardní zprávy. */
    lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true }),
    /** Ruční převzetí: bot na DM tohoto kontaktu neodpovídá do tohoto času. */
    botPausedUntil: timestamp("bot_paused_until", { withTimezone: true }),
    /** Pauza natrvalo (#stop / Vypnout bota) – platí, dokud se nezruší. */
    botPausedPermanent: boolean("bot_paused_permanent").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("contacts_account_ig_idx").on(t.accountId, t.igScopedId)],
);

export type Account = typeof accounts.$inferSelect;
export type Rule = typeof rules.$inferSelect;
export type NewRule = typeof rules.$inferInsert;
export type EventLog = typeof eventsLog.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
