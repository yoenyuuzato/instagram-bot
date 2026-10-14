/**
 * Wrapper nad Instagram Graph API (Instagram API with Instagram Login, graph.instagram.com).
 * V MOCK režimu (INSTAGRAM_MOCK != "false") se nic neodesílá – vrací se jen popis requestu.
 */
import { randomUUID } from "node:crypto";
import { env } from "./env";

export type GraphRequest = {
  method: "POST";
  path: string;
  body: Record<string, unknown>;
};

export type GraphResult = {
  ok: boolean;
  mock: boolean;
  id?: string;
  request: GraphRequest;
  error?: string;
};

type Options = { accessToken: string | null; forceMock?: boolean };

export type DmContent = { text: string; buttonUrl?: string | null; buttonTitle?: string | null };

function messagePayload({ text, buttonUrl, buttonTitle }: DmContent) {
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
    const data = (await res.json().catch(() => ({}))) as { id?: string; message_id?: string; error?: { message?: string } };
    if (!res.ok) return { ok: false, mock: false, request: req, error: data.error?.message ?? `HTTP ${res.status}` };
    return { ok: true, mock: false, id: data.id ?? data.message_id, request: req };
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
