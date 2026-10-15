// Tvary webhook payloadů – Instagram API with Instagram Login (object: "instagram").

export type CommentChangeValue = {
  id: string; // comment id
  text?: string;
  parent_id?: string;
  from?: { id: string; username?: string; self_ig_scoped_id?: string };
  media?: { id: string; media_product_type?: string };
};

export type MessagingEvent = {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    /** Klik na quick reply – payload nastavujeme na text tlačítka. */
    quick_reply?: { payload?: string };
  };
  /** Klik na ice breaker (webhook messaging_postbacks). */
  postback?: { mid?: string; title?: string; payload?: string };
};

export type WebhookPayload = {
  object: string;
  entry: Array<{
    id: string; // IG user id účtu, kterému webhook patří
    time: number;
    changes?: Array<{ field: string; value: CommentChangeValue }>;
    messaging?: MessagingEvent[];
  }>;
};

export type AiInfo = {
  model: string;
  latencyMs: number;
  attempts: number;
  error?: string;
  /** Místo AI odpovědi se poslal fallback text účtu. */
  fallback?: boolean;
};

export type ActionResult = {
  kind: "public_reply" | "private_reply" | "dm" | "ai_reply";
  status: "sent" | "failed" | "skipped";
  text: string;
  detail?: string;
  request?: { method: string; path: string; body: unknown };
  mock?: boolean;
  ai?: AiInfo;
};

export type EventResult = {
  kind: "comment" | "message";
  igObjectId: string;
  accountIgId: string;
  text: string;
  status: "processed" | "ignored" | "duplicate";
  reason?: string;
  ruleId?: number;
  ruleName?: string;
  actions: ActionResult[];
};
