/**
 * Wrapper nad Instagram Graph API (Instagram API with Instagram Login, graph.instagram.com).
 * V MOCK režimu (INSTAGRAM_MOCK != "false") se nic neodesílá – vrací se jen popis requestu.
 */
import { randomUUID } from "node:crypto";
import { env } from "./env";

export type GraphRequest = {
  method: "POST" | "DELETE";
  path: string;
  body: Record<string, unknown>;
};

export type GraphResult = {
  ok: boolean;
  mock: boolean;
  id?: string;
  request: GraphRequest;
  error?: string;
  /** Chyba access tokenu (OAuthException, kód 190) – token vypršel, byl zneplatněn nebo odvolán. */
  tokenError?: boolean;
};

export type GraphError = { message?: string; type?: string; code?: number };

/** Kód 190 = neplatný/vypršelý access token (Graph API vrací typ OAuthException). */
export function isTokenError(err: GraphError | undefined) {
  return err?.code === 190;
}

type Options = { accessToken: string | null; forceMock?: boolean };

export type DmContent = {
  text: string;
  buttonUrl?: string | null;
  buttonTitle?: string | null;
  /** Texty quick reply tlačítek (max. 13, titulek max. 20 znaků); payload = text tlačítka. */
  quickReplies?: string[] | null;
};

export const MAX_QUICK_REPLIES = 13;
export const QUICK_REPLY_MAX_CHARS = 20;

export function quickRepliesPayload(items: string[] | null | undefined) {
  const list = (items ?? []).map((t) => t.trim()).filter(Boolean).slice(0, MAX_QUICK_REPLIES);
  if (!list.length) return undefined;
  return list.map((t) => ({ content_type: "text", title: [...t].slice(0, QUICK_REPLY_MAX_CHARS).join(""), payload: t }));
}

function messagePayload(content: DmContent) {
  const quick_replies = quickRepliesPayload(content.quickReplies);
  return { ...baseMessage(content), ...(quick_replies ? { quick_replies } : {}) };
}

function baseMessage({ text, buttonUrl, buttonTitle }: DmContent) {
  if (!buttonUrl) return { text };
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text,
        buttons: [{ type: "web_url", url: buttonUrl, title: (buttonTitle || "Otevřít").slice(0, 20) }],
      },
    },
  };
}

async function call(req: GraphRequest, opts: Options): Promise<GraphResult> {
  if (opts.forceMock || env.instagramMock) {
    return { ok: true, mock: true, id: `mock_${randomUUID()}`, request: req };
  }
  if (!opts.accessToken) return { ok: false, mock: false, request: req, error: "Účet nemá access token" };

  const url = `https://graph.instagram.com/${env.graphApiVersion}${req.path}`;
  try {
    const res = await fetch(url, {
      method: req.method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.accessToken}` },
      body: JSON.stringify(req.body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      message_id?: string;
      success?: boolean;
      error?: GraphError;
    };
    if (!res.ok) {
      return {
        ok: false,
        mock: false,
        request: req,
        error: data.error?.message ?? `HTTP ${res.status}`,
        ...(isTokenError(data.error) ? { tokenError: true } : {}),
      };
    }
    return { ok: true, mock: false, id: data.id ?? data.message_id ?? (data.success ? "success" : undefined), request: req };
  } catch (e) {
    return { ok: false, mock: false, request: req, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Veřejná odpověď pod komentář. */
export function replyToComment(commentId: string, message: string, opts: Options) {
  return call({ method: "POST", path: `/${commentId}/replies`, body: { message } }, opts);
}

/** Private reply – DM navázaná na komentář (lze 1× na komentář, do 7 dní od komentáře). */
export function sendPrivateReply(igUserId: string, commentId: string, content: DmContent, opts: Options) {
  return call(
    {
      method: "POST",
      path: `/${igUserId}/messages`,
      body: { recipient: { comment_id: commentId }, message: messagePayload(content) },
    },
    opts,
  );
}

/** Standardní DM – jen v 24h okně od poslední zprávy uživatele. */
export function sendDirectMessage(igUserId: string, recipientId: string, content: DmContent, opts: Options) {
  return call(
    {
      method: "POST",
      path: `/${igUserId}/messages`,
      body: { recipient: { id: recipientId }, message: messagePayload(content) },
    },
    opts,
  );
}

/**
 * Indikátor psaní ("…") v konverzaci. Request smí obsahovat jen recipient + sender_action.
 * Podpora v Instagram API with Instagram Login není v dokumentaci jednoznačná – chyba nesmí blokovat odpověď.
 */
export function sendSenderAction(igUserId: string, recipientId: string, action: "typing_on" | "typing_off" | "mark_seen", opts: Options) {
  return call({ method: "POST", path: `/${igUserId}/messages`, body: { recipient: { id: recipientId }, sender_action: action } }, opts);
}

export const MAX_ICE_BREAKERS = 4;

/** Ice breakers (max. 4 otázky) – payload = text otázky, klik přijde jako webhook postback. Prázdný seznam je smaže. */
export function setIceBreakers(igUserId: string, questions: string[], opts: Options) {
  const list = questions.map((q) => q.trim()).filter(Boolean).slice(0, MAX_ICE_BREAKERS);
  if (!list.length) {
    return call({ method: "DELETE", path: `/${igUserId}/messenger_profile`, body: { fields: ["ice_breakers"] } }, opts);
  }
  return call(
    {
      method: "POST",
      path: `/${igUserId}/messenger_profile`,
      body: {
        platform: "instagram",
        ice_breakers: [{ call_to_actions: list.map((question) => ({ question, payload: question })), locale: "default" }],
      },
    },
    opts,
  );
}

export type RefreshResult =
  | { ok: true; accessToken: string; expiresAt: Date }
  | { ok: false; error: string; tokenError?: boolean };

/**
 * Obnova long-lived tokenu (Instagram API with Instagram Login):
 * GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=…
 * Token musí být starý aspoň 24 h a nevypršelý; nový platí 60 dní od obnovy.
 * Volá se vždy doopravdy (i v MOCK režimu) – nic neodesílá, jen prodlužuje platnost.
 */
export async function refreshAccessToken(accessToken: string, now = new Date(), fetchImpl: typeof fetch = fetch): Promise<RefreshResult> {
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", accessToken);
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: GraphError };
    if (!res.ok || data.error) {
      return {
        ok: false,
        error: data.error?.message ?? `HTTP ${res.status}`,
        ...(isTokenError(data.error) ? { tokenError: true } : {}),
      };
    }
    if (!data.access_token || !(Number(data.expires_in) > 0)) return { ok: false, error: "Neplatná odpověď (chybí access_token/expires_in)" };
    return { ok: true, accessToken: data.access_token, expiresAt: new Date(now.getTime() + Number(data.expires_in) * 1000) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
