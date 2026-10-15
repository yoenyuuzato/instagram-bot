import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeEntities, extractLinks, htmlToText, isAllowed, normalizeStartUrl, parseRobots, parseSitemap, prioritizeSameLanguage } from "./crawl";

test("robots.txt: skupina pro *, nejdelší pravidlo vyhrává, wildcardy", () => {
  const r = parseRobots(`
User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /admin
Disallow: /*.pdf$
Allow: /admin/verejne
Sitemap: https://example.cz/sitemap_index.xml
`);
  assert.deepEqual(r.sitemaps, ["https://example.cz/sitemap_index.xml"]);
  assert.ok(isAllowed(r, "https://example.cz/"));
  assert.ok(isAllowed(r, "https://example.cz/sluzby"));
  assert.ok(!isAllowed(r, "https://example.cz/admin/login"));
  assert.ok(isAllowed(r, "https://example.cz/admin/verejne/info"));
  assert.ok(!isAllowed(r, "https://example.cz/cenik.pdf"));
  assert.ok(isAllowed(r, "https://example.cz/cenik.pdf?x=1"));
});

test("robots.txt: Disallow: / pro všechny zakáže vše, prázdný Disallow nic", () => {
  assert.ok(!isAllowed(parseRobots("User-agent: *\nDisallow: /"), "https://example.cz/cokoliv"));
  assert.ok(isAllowed(parseRobots("User-agent: *\nDisallow:"), "https://example.cz/cokoliv"));
  assert.ok(isAllowed(parseRobots(""), "https://example.cz/"));
});

test("htmlToText: bez nav, footer, script, style; entity; preferuje <main>", () => {
  const html = `<html><head><title>T</title><style>.a{}</style></head><body>
    <nav><a href="/">Menu položka</a></nav>
    <header><h1>Tvorba webů na míru</h1></header>
    <p>Stavíme weby v Next.js &amp; řešíme SEO&nbsp;– rychle.</p>
    <ul><li>Design</li><li>Vývoj</li></ul>
    <script>alert("x")</script>
    <footer>© 2026 Patička</footer></body></html>`;
  const t = htmlToText(html);
  assert.ok(t.includes("Tvorba webů na míru"));
  assert.ok(t.includes("Stavíme weby v Next.js & řešíme SEO – rychle."));
  assert.ok(t.includes("- Design\n- Vývoj"));
  for (const bad of ["Menu položka", "alert", ".a{}", "Patička"]) assert.ok(!t.includes(bad), bad);

  const withMain = `<body><aside>Boční panel</aside><main><p>${"Hlavní obsah stránky. ".repeat(15)}</p></main></body>`;
  assert.ok(!htmlToText(withMain).includes("Boční panel"));
  assert.equal(decodeEntities("&#x1F44B; &#269;&quot;"), '👋 č"');
});

test("extractLinks: jen stejná doména, bez assetů, kotev a nofollow", () => {
  const base = normalizeStartUrl("topprofitdesign.cz");
  assert.equal(base.toString(), "https://topprofitdesign.cz/");
  const links = extractLinks(
    `<a href="/sluzby#top">a</a><a href='https://www.topprofitdesign.cz/kontakt?utm_source=ig'>b</a>
     <a href="https://jiny.cz/">c</a><a href="/logo.png">d</a><a href="mailto:x@y.cz">e</a><a rel="nofollow" href="/login">f</a>`,
    base,
  );
  assert.deepEqual(links, ["https://topprofitdesign.cz/sluzby", "https://www.topprofitdesign.cz/kontakt"]);
});

test("parseSitemap: urlset i sitemap index", () => {
  const idx = parseSitemap(`<sitemapindex><sitemap><loc>https://e.cz/page-sitemap.xml</loc></sitemap></sitemapindex>`);
  assert.deepEqual(idx, { pages: [], sitemaps: ["https://e.cz/page-sitemap.xml"] });
  const set = parseSitemap(`<urlset><url><loc> https://e.cz/a </loc></url><url><loc><![CDATA[https://e.cz/b?x=1&amp;y=2]]></loc></url></urlset>`);
  assert.deepEqual(set.pages, ["https://e.cz/a", "https://e.cz/b?x=1&y=2"]);
});

test("prioritizeSameLanguage: jazykové mutace až na konec", () => {
  const urls = ["https://e.cz/en/", "https://e.cz/sluzby/", "https://e.cz/en/services/", "https://e.cz/kontakt/"];
  assert.deepEqual(prioritizeSameLanguage(urls, "https://e.cz/"), [
    "https://e.cz/sluzby/",
    "https://e.cz/kontakt/",
    "https://e.cz/en/",
    "https://e.cz/en/services/",
  ]);
  assert.equal(prioritizeSameLanguage(urls, "https://e.cz/en/")[0], "https://e.cz/en/");
});
