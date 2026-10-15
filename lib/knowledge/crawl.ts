/**
 * Crawler znalostní báze: z webu klienta stáhne až MAX_PAGES stránek (sitemap.xml, fallback odkazy z homepage),
 * respektuje robots.txt a vrátí čistý text spojený do jednoho dokumentu (max MAX_CHARS znaků).
 * Bez závislostí – jednoduché regexové parsování stačí na běžné weby.
 */

export const MAX_PAGES = 30;
export const MAX_CHARS = 60_000;
export const PAGE_TIMEOUT_MS = 10_000;
/** Celkový čas na stahování – server action má maxDuration 60 s. */
const TOTAL_BUDGET_MS = 45_000;
const CONCURRENCY = 6;
const MAX_SITEMAPS = 5;
const MAX_HTML_BYTES = 2_000_000;
const USER_AGENT = "Mozilla/5.0 (compatible; IGBotKnowledge/1.0)";
const BOT_TOKEN = "igbotknowledge";

export type CrawlPage = { url: string; title: string; chars: number };
export type CrawlResult = {
  text: string;
  pages: CrawlPage[];
  /** URL přeskočené kvůli robots.txt, chybě nebo typu obsahu. */
  skipped: { url: string; reason: string }[];
  source: "sitemap" | "homepage";
  truncated: boolean;
};

// --- URL ----------------------------------------------------------------------

export function normalizeStartUrl(input: string): URL {
  const raw = input.trim();
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  url.hash = "";
  return url;
}

const sameSite = (a: URL, b: URL) => a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "");

const ASSET_RE = /\.(?:jpe?g|png|gif|webp|avif|svg|ico|pdf|zip|rar|mp4|webm|mp3|wav|css|js|json|xml|txt|woff2?|ttf|eot|docx?|xlsx?|pptx?)$/i;

function canonical(href: string, base: URL): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!sameSite(u, base) || ASSET_RE.test(u.pathname)) return null;
    u.hash = "";
    // Trackovací parametry pryč, ostatní query necháme (může jít o jinou stránku).
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return null;
  }
}

/** Jazykový prefix cesty (/en/…, /de-at/…), "" = bez prefixu. */
function langPrefix(url: string) {
  return new URL(url).pathname.match(/^\/([a-z]{2}(?:-[a-z]{2})?)(?:\/|$)/i)?.[1].toLowerCase() ?? "";
}

/** Stránky ve stejném jazyce jako start URL dopředu – jinak jazykové mutace zaberou půlku limitu. */
export function prioritizeSameLanguage(urls: string[], start: string) {
  const lang = langPrefix(start);
  return [...urls].sort((a, b) => Number(langPrefix(a) !== lang) - Number(langPrefix(b) !== lang));
}

// --- robots.txt ----------------------------------------------------------------

export type RobotsRules = { allow: string[]; disallow: string[]; sitemaps: string[] };

/** Vybere skupinu pro náš user-agent, jinak pro `*`. */
export function parseRobots(txt: string): RobotsRules {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  const sitemaps: string[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;

  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (key === "user-agent") {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], allow: [], disallow: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" && value) current.allow.push(value);
    if (key === "disallow" && value) current.disallow.push(value);
  }

  const group =
    groups.find((g) => g.agents.some((a) => a !== "*" && BOT_TOKEN.includes(a))) ?? groups.find((g) => g.agents.includes("*"));
  return { allow: group?.allow ?? [], disallow: group?.disallow ?? [], sitemaps };
}

function patternToRegex(pattern: string) {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Nejdelší shodující se pravidlo vyhrává, při shodě délky má přednost Allow (jako Google). */
export function isAllowed(rules: RobotsRules, url: string): boolean {
  const u = new URL(url);
  const path = u.pathname + u.search;
  let best: { len: number; allow: boolean } = { len: -1, allow: true };
  for (const [list, allow] of [
    [rules.disallow, false],
    [rules.allow, true],
  ] as const) {
    for (const p of list) {
      if (!patternToRegex(p).test(path)) continue;
      if (p.length > best.len || (p.length === best.len && allow)) best = { len: p.length, allow };
    }
  }
  return best.allow;
}

// --- HTML → text ----------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  bdquo: "„", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", sbquo: "‚", laquo: "«", raquo: "»",
  copy: "©", reg: "®", trade: "™", euro: "€", times: "×", middot: "·", bull: "•", deg: "°",
};

export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function extractTitle(html: string) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
}

/** Čistý text stránky – bez nav, footer, script, style a dalších neobsahových prvků. */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|canvas|nav|footer|form|select|button)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<head\b[\s\S]*?<\/head\s*>/i, " ");

  // Když má stránka <main>, bereme jen ten (header/sidebar bývají opakovaná navigace).
  const main = s.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i);
  if (main && main[1].replace(/<[^>]+>/g, "").trim().length > 200) s = main[1];

  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/?(p|div|section|article|header|aside|main|h[1-6]|ul|ol|li|tr|table|blockquote|dd|dt|dl|figure|figcaption|address)\b[^>]*>/gi, "\n")
    .replace(/<\/t[dh]\s*>/gi, " | ")
    .replace(/<[^>]+>/g, " ");

  return decodeEntities(s)
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").replace(/\s*\|\s*$/, "").trim())
    .filter((l) => l && l !== "-" && /[\p{L}\p{N}]/u.test(l))
    .join("\n");
}

export function extractLinks(html: string, base: URL): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const href = decodeEntities(m[1] ?? m[2] ?? m[3] ?? "");
    if (/rel\s*=\s*["']?[^"'>]*nofollow/i.test(m[0])) continue;
    const u = canonical(href, base);
    if (u) out.add(u);
  }
  return [...out];
}

/** Vrátí URL stránek i vnořených sitemap (sitemap index). */
export function parseSitemap(xml: string): { pages: string[]; sitemaps: string[] } {
  const locs = (block: string) =>
    [...block.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/gi)].map((m) => decodeEntities(m[1].trim()));
  const sitemaps = [...xml.matchAll(/<sitemap\b[\s\S]*?<\/sitemap>/gi)].flatMap((m) => locs(m[0]));
  const pages = [...xml.matchAll(/<url\b[\s\S]*?<\/url>/gi)].flatMap((m) => locs(m[0]));
  return { pages, sitemaps };
}

// --- Stahování -----------------------------------------------------------------

type Fetched = { ok: true; url: string; body: string; type: string } | { ok: false; reason: string };

async function fetchText(url: string, accept: string): Promise<Fetched> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: accept },
      redirect: "follow",
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const type = res.headers.get("content-type") ?? "";
    const body = (await res.text()).slice(0, MAX_HTML_BYTES);
    return { ok: true, url: res.url || url, body, type };
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, reason: timeout ? `timeout ${PAGE_TIMEOUT_MS / 1000} s` : e instanceof Error ? e.message : String(e) };
  }
}

async function loadRobots(origin: string): Promise<RobotsRules> {
  const r = await fetchText(`${origin}/robots.txt`, "text/plain");
  // Chybějící robots.txt = vše povoleno.
  return r.ok && !/html/i.test(r.type) ? parseRobots(r.body) : { allow: [], disallow: [], sitemaps: [] };
}

async function urlsFromSitemaps(start: URL, robots: RobotsRules): Promise<string[]> {
  const queue = robots.sitemaps.length ? [...robots.sitemaps] : [`${start.origin}/sitemap.xml`];
  const seen = new Set<string>();
  const pages: string[] = [];
  while (queue.length && seen.size < MAX_SITEMAPS && pages.length < MAX_PAGES * 4) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm);
    const r = await fetchText(sm, "application/xml,text/xml");
    if (!r.ok || !/<(urlset|sitemapindex)\b/i.test(r.body)) continue;
    const parsed = parseSitemap(r.body);
    queue.push(...parsed.sitemaps);
    for (const p of parsed.pages) {
      const u = canonical(p, start);
      if (u) pages.push(u);
    }
  }
  return pages;
}

/** Stáhne web a vrátí text pro znalostní bázi. Vyhazuje jen při neplatné URL nebo když nic nestáhne. */
export async function crawlSite(inputUrl: string): Promise<CrawlResult> {
  const started = Date.now();
  const start = normalizeStartUrl(inputUrl);
  const robots = await loadRobots(start.origin);
  const skipped: CrawlResult["skipped"] = [];

  // Homepage stahujeme vždy – je to první stránka a zdroj odkazů pro fallback.
  const startUrl = canonical(start.toString(), start)!;
  let candidates = await urlsFromSitemaps(start, robots);
  const source: CrawlResult["source"] = candidates.length ? "sitemap" : "homepage";

  const fetchedHtml = new Map<string, { title: string; text: string }>();
  const finalUrls = new Set<string>();
  const fetchPage = async (url: string) => {
    if (!isAllowed(robots, url)) return void skipped.push({ url, reason: "zakázáno v robots.txt" });
    const r = await fetchText(url, "text/html,application/xhtml+xml");
    if (!r.ok) return void skipped.push({ url, reason: r.reason });
    if (r.type && !/html/i.test(r.type)) return void skipped.push({ url, reason: `typ ${r.type.split(";")[0]}` });
    const finalUrl = canonical(r.url, start);
    if (!finalUrl) return void skipped.push({ url, reason: "přesměrování mimo web" });
    if (finalUrls.has(finalUrl)) return void skipped.push({ url, reason: "duplicita (přesměrování)" });
    finalUrls.add(finalUrl);
    fetchedHtml.set(url, { title: extractTitle(r.body), text: htmlToText(r.body) });
    return r.body;
  };

  const home = await fetchPage(startUrl);
  if (source === "homepage" && home) candidates = extractLinks(home, start);
  candidates = prioritizeSameLanguage([...new Set(candidates)], startUrl);

  const queue = candidates.filter((u) => u !== startUrl).slice(0, MAX_PAGES - 1);
  const worker = async () => {
    while (queue.length && Date.now() - started < TOTAL_BUDGET_MS) await fetchPage(queue.shift()!);
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  for (const url of queue) skipped.push({ url, reason: "nestihlo se (časový limit)" });

  // Pořadí: homepage, pak podle kandidátů. Řádky opakované na víc stránkách (menu, cookie lišta) bereme jen jednou.
  const order = [startUrl, ...candidates].filter((u, i, a) => a.indexOf(u) === i && fetchedHtml.has(u));
  const seenLines = new Set<string>();
  const pages: CrawlPage[] = [];
  let text = "";
  let truncated = false;
  for (const url of order) {
    const page = fetchedHtml.get(url)!;
    const lines = page.text.split("\n").filter((l) => {
      if (l.length > 3 && seenLines.has(l)) return false;
      seenLines.add(l);
      return true;
    });
    if (!lines.length) continue;
    const section = `## ${url}${page.title ? ` — ${page.title}` : ""}\n${lines.join("\n")}\n\n`;
    if (text.length + section.length > MAX_CHARS) {
      const room = MAX_CHARS - text.length;
      if (room > 500) {
        text += section.slice(0, section.lastIndexOf("\n", room) > 0 ? section.lastIndexOf("\n", room) : room);
        pages.push({ url, title: page.title, chars: lines.join("\n").length });
      }
      truncated = true;
      break;
    }
    text += section;
    pages.push({ url, title: page.title, chars: lines.join("\n").length });
  }

  text = text.trim();
  if (!text) {
    const why = skipped.find((s) => s.url === startUrl)?.reason ?? skipped[0]?.reason ?? "žádný text";
    throw new Error(`Z webu se nepodařilo načíst žádný text (${why}).`);
  }
  return { text, pages, skipped, source, truncated };
}
