# IG Bot – vlastní Instagram automatizace

Univerzální multi-account bot ve stylu ManyChat: reaguje na **komentáře** a **přímé zprávy (DM)** podle pravidel s klíčovými slovy – veřejně odpoví pod komentář a pošle soukromou zprávu (volitelně s tlačítkem s odkazem).

**Fáze 3** = AI odpovědi přes Google Gemini na DM, které nesedí na žádné pravidlo – viz [AI odpovědi](#ai-odpovědi-gemini).

**Fáze 1** = kompletní logika, databáze, webhook, administrace a simulátor, **bez napojení na Meta**. Instagram API běží v MOCK režimu (nic se reálně neodesílá). OAuth a reálná volání jsou fáze 2 – viz [checklist](#fáze-2--checklist-napojení-meta-app).

## Stack

- Next.js 16 (App Router, Cache Components) + TypeScript + Tailwind CSS 4
- Drizzle ORM + Postgres (Neon, `@neondatabase/serverless` přes HTTP)
- Deploy: Vercel (Node.js runtime, Fluid Compute)

## Architektura

```
Instagram ──webhook──▶ /api/webhooks/instagram ──(after)──▶ lib/engine ──▶ lib/instagram.ts ──▶ Graph API
                        │ GET  = verifikace (hub.verify_token)    │            (MOCK: jen log)
                        │ POST = ověření X-Hub-Signature-256      │
                        └─ okamžitě 200, zpracování po odpovědi    ▼
                                                              Postgres (events_log, contacts, rules, accounts)
/admin (heslo, cookie) ── CRUD pravidel, účty, log, simulátor ───────┘
```

| Cesta | Popis |
| --- | --- |
| `app/api/webhooks/instagram/route.ts` | Webhook endpoint. GET verifikace, POST ověří podpis HMAC-SHA256 nad raw tělem, vrátí `200 EVENT_RECEIVED` a zpracování spustí přes `after()`. |
| `lib/engine/normalize.ts` | Normalizace textu – lowercase, bez diakritiky, sjednocené mezery; pro exact match i ořez interpunkce/emoji. |
| `lib/engine/match.ts` | Výběr pravidla. Úrovně: přesná shoda klíčového slova > shoda s překlepem > záchytné pravidlo bez klíčových slov (reaguje na vše, ale jen když nic jiného nesedí). V rámci úrovně: pravidlo pro konkrétní post > přesná shoda > obsahuje > delší shodující se klíčové slovo > nejstarší. Tolerance překlepů (jen „obsahuje“): Damerau-Levenshtein (přehození sousedních písmen = 1 překlep) ≤1 pro slova 4–6 znaků, ≤2 pro delší, kratší slova přesně. |
| `lib/engine/window.ts` | 24h okno pro DM, 7denní okno pro private reply na komentář. |
| `lib/engine/process.ts` | Zpracování payloadu: dedup, kontakty, match, akce, log. |
| `lib/ai/gemini.ts` | Volání Gemini REST API (`generateContent`, bez SDK) – timeout 20 s, max. 2 pokusy (jen 429/5xx), minimální thinking, čištění markdownu, max. ~600 znaků. |
| `lib/knowledge/crawl.ts` | Crawler znalostní báze: robots.txt, sitemap.xml (fallback odkazy z homepage), max. 30 stránek, timeout 10 s/stránka, čistý text max. ~60 000 znaků. |
| `lib/notify/detect.ts` | Detekce e-mailu a telefonu (CZ/SK, +420/00420/+421, mezery, pomlčky) v textu DM. |
| `lib/notify/email.ts` | Odeslání e-mailu přes Resend REST API (bez SDK) a šablona upozornění na lead. |
| `lib/ai/prompt.ts` | Výchozí šablona system promptu (Top Profit Design). |
| `lib/instagram.ts` | Wrapper nad Graph API (`replyToComment`, `sendPrivateReply`, `sendDirectMessage` vč. quick replies, `sendSenderAction`, `setIceBreakers`). V MOCK režimu vrací jen popis requestu. |
| `lib/crypto.ts` | AES-256-GCM šifrování access tokenů. |
| `lib/auth.ts`, `proxy.ts` | Ochrana `/admin` – heslo → podepsaná HttpOnly cookie (HMAC, 7 dní). V Next.js 16 se `middleware.ts` jmenuje `proxy.ts`. |
| `lib/db/schema.ts` | Drizzle schéma, migrace v `drizzle/`. |
| `app/admin/` | Administrace (česky): přehled, pravidla, účty, log událostí, simulátor. |

### Datový model

- **accounts** – `ig_user_id`, `username`, `access_token` (šifrovaně), `token_expires_at`, `active`, `ai_enabled`, `ai_system_prompt`, `ai_fallback_text`, `knowledge_url`, `knowledge_text`, `knowledge_updated_at`, `notify_email`, `ice_breakers[]`
- **rules** – `account_id`, `trigger_type` (`comment` \| `dm`), `keywords[]`, `match_mode` (`contains` \| `exact`), `post_id` (volitelné), `public_reply`, `dm_text`, `dm_button_url`, `dm_button_title`, `max_words` (jen krátká zpráva, `null` = vypnuto), `notify_on_match`, `quick_replies[]`, `active`
- **events_log** – příchozí webhooky i odchozí odpovědi: `direction` (in/out), `kind`, `status`, `dedup_key` (unikátní), `detail`, `payload`, `simulated`
- **contacts** – `account_id` + `ig_scoped_id` (unikátní), `username`, `last_interaction_at` (poslední příchozí DM → 24h okno)

### Pravidla chování

- **Dedup / idempotence:** každý příchozí komentář/zpráva má unikátní `dedup_key` (`in:comment:<id>`, `in:message:<mid>`). Meta webhooky doručuje opakovaně – duplikát se nezpracuje. Každá odchozí akce si před odesláním „zabere“ řádek s klíčem `out:<akce>:<id>`, takže se ani při souběhu neodešle dvakrát.
- **Smyčky:** komentáře od vlastního účtu se ignorují. DM echo (`is_echo`) zprávy, kterou poslal bot, se ignoruje; ruční zpráva spustí pauzu (viz Ruční převzetí).
- **24h okno:** odpověď na DM se pošle jen do 24 h od poslední zprávy uživatele (`contacts.last_interaction_at`), jinak se v logu označí jako přeskočená.
- **Private reply:** DM na základě komentáře se posílá jako private reply (`recipient.comment_id`) – max. 1× na komentář a do 7 dní od komentáře. Nevyžaduje otevřené 24h okno.
- **Proměnné:** v textech lze použít `{username}`. Když username chybí, dosadí se prázdný řetězec a uklidí se mezery před interpunkcí („Ahoj {username}! 👋“ → „Ahoj! 👋“).
- **Jen krátká zpráva:** pravidlo může mít `max_words` (např. 3). Delší text pravidlo přeskočí – u DM pak odpoví AI (je-li zapnutá). Emoji a interpunkce se do slov nepočítají. U nových pravidel vypnuto.
- **Quick replies:** DM pravidlo může mít až 13 tlačítek pod odpovědí (`rules.quick_replies`, titulek max. 20 znaků; nové pravidlo má předvyplněno 💰 Ceník, 🛠 Služby, 📁 Reference, 👤 Člověk). Payload = text tlačítka; klik přijde jako zpráva s `quick_reply.payload` a zpracuje se jako běžná DM (pravidla, AI). Instagram je na desktopu nezobrazuje.
- **Ice breakers:** v `/admin/accounts` až 4 úvodní otázky (`accounts.ice_breakers`) → **Uložit a nastavit na Instagramu** (`POST /<ig_id>/messenger_profile`, `platform: instagram`; prázdné = `DELETE`). Klik přijde jako webhook `postback` a zpracuje se jako zpráva s textem otázky. Vyžaduje odběr `messaging_postbacks`. V MOCK režimu se nic neodesílá.
- **Typing:** před odesláním DM odpovědi (pravidlo i AI) bot pošle `sender_action: typing_on` a počká 1–2,5 s podle délky textu (u AI se počítá i doba generování). V simulaci a MOCK režimu se nečeká. Podpora `sender_action` v Instagram API with Instagram Login není v dokumentaci jednoznačná (stránka Sender Actions uvádí `graph.facebook.com`) – když volání selže, jen se zaloguje a odpověď odejde.
- **Tlačítko:** pokud má pravidlo `dm_button_url`, DM se pošle jako button template s `web_url` tlačítkem.

## AI odpovědi (Gemini)

- **Kdy:** příchozí DM, které nesedí na žádné DM pravidlo, a účet má v `/admin/accounts` zapnuté **AI zapnuto**. Klíčová pravidla mají vždy přednost. Na komentáře AI neodpovídá.
- **Kontext:** `ai_system_prompt` účtu, případně **ZNALOSTI O FIRME** z webu (viz níže), pevná pravidla (česky, bez markdownu, max. ~600 znaků) a posledních 6 zpráv konverzace s kontaktem z `events_log` (příchozí DM + odeslané odpovědi).
- **Volání:** `POST https://generativelanguage.googleapis.com/v1beta/models/$GEMINI_MODEL:generateContent`, hlavička `x-goog-api-key`. Timeout 20 s na pokus, max. 2 pokusy (opakuje se jen 429 a 5xx, timeout ne). Přemýšlení je kvůli latenci minimalizované: Gemini 3+ `thinkingConfig.thinkingLevel` (výchozí `low`, nejnižší úroveň u `gemini-3.8-flash`; přepsat jde přes `GEMINI_THINKING_LEVEL`, např. `minimal` u modelů, které ji podporují), Gemini 2.5 Flash `thinkingBudget: 0`. Webhook má `maxDuration = 120`, simulátor 60 s.
- **Pojistky:** 24h okno, dedup (`out:ai_reply:<mid>`), rate limit na kontakt – max. 1 AI odpověď za 10 s a max. 30 za hodinu (přebytečné se v logu označí jako přeskočené).
- **Selhání AI:** pošle se `ai_fallback_text`, nebo – když je prázdný – nic. Vše se loguje do `events_log` jako `ai_reply` s modelem, latencí, počtem pokusů a případnou chybou (`detail` + `payload.ai`).
- **Test:** Simulátor → typ DM → text, který nesedí na pravidlo. Gemini se volá doopravdy, Instagram ne. Volba „Vynutit AI“ otestuje odpověď i u účtu s vypnutou AI.
- **Znalostní báze z webu:** v `/admin/accounts` u účtu zadej URL webu → **Načíst / Obnovit web**. Crawler přečte `robots.txt` (respektuje `Disallow`/`Allow` a jeho `Sitemap:`), vezme URL ze `sitemap.xml` (i sitemap index), a když chybí, odkazy z homepage na stejnou doménu. Stáhne max. 30 stránek (10 s timeout, paralelně, celkem do ~45 s – akce má `maxDuration = 60`), odstraní `nav`, `footer`, `script`, `style` apod., opakované řádky (menu, cookie lišta) bere jen jednou, stránky ve stejném jazyce jako zadaná URL dá dopředu a spojí vše pod nadpisy `## URL — titulek` do max. ~60 000 znaků. Když má účet znalosti, AI odpovídá jen z nich a z promptu, ceny uvádí jen když jsou ve znalostech, a když odpověď nezná, řekne, že se ozve člověk, a požádá o e-mail. Obnova je ruční.
- **Klíč:** zdarma v [Google AI Studio](https://aistudio.google.com/apikey). Free tier má limity požadavků za minutu/den – při překročení vrací 429 a použije se fallback.

## Obnova Instagram tokenů

- **Cron:** `vercel.json` spouští denně v 6:00 UTC `GET /api/cron/refresh-tokens`. Endpoint vyžaduje `Authorization: Bearer $CRON_SECRET` (Vercel ho posílá sám, když je `CRON_SECRET` nastaven v projektu); bez proměnné vrací 500, se špatnou hlavičkou 401.
- **Obnova:** pro každý aktivní účet s tokenem, kterému platnost vyprší do 15 dní (nebo ji neznáme), se zavolá `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=…` (Instagram API with Instagram Login – token musí být starší než 24 h a nevypršelý, nový platí 60 dní). Nový token se uloží šifrovaně spolu s `token_expires_at` (= teď + `expires_in`). Obnova běží doopravdy i v MOCK režimu – nic neodesílá.
- **E-mail (Resend, stejná šablona jako upozornění na leady) na `notify_email` účtu**, když obnova selže, nebo token vyprší do 7 dní. Max. 1× za 20 h na účet a důvod.
- **Chyba tokenu při odesílání odpovědi** (Graph API vrátí `OAuthException`, kód 190): okamžitě e-mail, max. 1× za 6 h na účet. Odesílá se po odpovědích z webhooku (v `after()`).
- **Admin:** v `/admin/accounts` u účtu platnost tokenu, kolik dní zbývá (barevně) a tlačítko **Obnovit teď** (bez e-mailu).
- **Log:** `events_log` – `token_refresh` (obnova OK/selhala) a `token_alert` (e-mail odeslán/přeskočen).
- Logika: `lib/tokens/refresh.ts` (pravidla, bez DB), `lib/tokens/service.ts` (DB, e-maily), `lib/instagram.ts` (`refreshAccessToken`, `isTokenError`).

## Upozornění na leady (e-mail)

- **Kdy:** každá příchozí ostrá DM (simulace ne) na účet s vyplněným **E-mailem pro upozornění** v `/admin/accounts`, která obsahuje e-mail nebo telefon (CZ/SK – `777 123 456`, `+420 777-123-456`, `00420…`, `+421 905 …`, `0905 …`). Platí bez ohledu na to, jestli odpověděla pravidla, AI nebo nikdo.
- **E-mail:** předmět `Nový kontakt z IG: @username` (když username neznáme – DM webhook ho neposílá –, je tam IG scoped ID), zjištěný e-mail/telefon, celá zpráva, posledních 6 zpráv konverzace z `events_log`, čas a odkaz na https://www.instagram.com/direct/inbox/. `Reply-To` = e-mail leadu, pokud ho poslal.
- **Dedup:** max. 1 upozornění na stejný kontakt + hodnotu (řádek `lead_notify` s dedup klíčem `lead_notify:<účet>:<kontakt>:<hodnota>`). Když odeslání selže, klíč se uvolní a zkusí se to při další zprávě se stejným údajem.
- **Nezdržuje odpověď:** upozornění se odesílají až po zpracování všech zpráv z webhooku (po odeslání DM), stále uvnitř `after()`.
- **Bez `RESEND_API_KEY`** se upozornění jen zaloguje (`console.warn` + v Logu událostí jako přeskočené), nic nespadne.
- **Test:** v `/admin/accounts` tlačítko **Poslat testovací e-mail** (pošle ukázkové upozornění). S výchozím odesílatelem `onboarding@resend.dev` Resend doručí jen na e-mail vlastníka Resend účtu – pro jiné adresáty ověřte doménu a nastavte `NOTIFY_FROM`.

## Upozornění na spuštěné pravidlo

- **Nastavení:** v pravidle zaškrtnout **Poslat upozornění e-mailem, když se pravidlo spustí** (`rules.notify_on_match`, výchozí vypnuto). V seznamu pravidel má takové pravidlo štítek **✉ upozornění**. E-mail jde na **E-mail pro upozornění** účtu.
- **Kdy:** ostrá DM (ne simulace), která spustí takové pravidlo – typicky „chci mluvit s člověkem“ nebo záchytné pravidlo „bot nevěděl odpovědět“.
- **E-mail:** předmět `IG – {název pravidla}: @username` (nebo `IG ID …`, když username neznáme), zpráva zákazníka, odpověď bota (nebo proč nic neodeslal), posledních 6 zpráv konverzace, čas, odkaz na Instagram Direct a připomínka **„Slib zákazníkovi: odpověď na IG do 2 dnů.“**
- **Dedup:** max. 1 upozornění za 12 h na kontakt + pravidlo (řádky `rule_notify` v `events_log`), aby záchytné pravidlo nespamovalo.
- **Lead má přednost:** když zpráva obsahuje e-mail/telefon a odejde upozornění na lead, upozornění na pravidlo se už neposílá – na jednu zprávu max. jeden e-mail. (Když byl lead se stejným údajem už ohlášen dřív, pošle se upozornění na pravidlo.)
- **Nezdržuje odpověď:** stejně jako lead – až po odeslání odpovědí, uvnitř `after()`.

## Ruční převzetí konverzace (DM)

- **Jak se pozná ruční odpověď:** každá zpráva odeslaná z účtu (botem i člověkem v aplikaci / Meta Business Suite) přijde jako webhook `messages` s `message.is_echo: true`, `sender.id` = náš účet, `recipient.id` = kontakt. Echo v Instagram API with Instagram Login obsahuje jen `mid`, `text`, `is_echo` – **`app_id` v něm není** (na rozdíl od Messengeru). Bot si proto ukládá `message_id` z odpovědi Send API (`{ recipient_id, message_id }`) do `events_log.ig_message_id`; echo s jiným `mid` = ruční odpověď. Když echo předběhne uložení `mid` (bot kontaktu právě odesílá), počká se až ~8 s; pokud odesílání pořád běží, bere se echo jako botovo.
- **Pauza:** ruční odpověď nastaví `contacts.bot_paused_until = teď + accounts.human_pause_minutes` (výchozí 30, nastavení v `/admin/accounts`, 0 = nepozastavovat). Další ruční odpověď pauzu prodlouží, nikdy nezkrátí.
- **Během pauzy** bot na DM kontaktu nereaguje (pravidla ani AI), příchozí zpráva je v logu „Pauza – odpovídá člověk“. Upozornění e-mailem na leady chodí dál. Komentáře pauza neřeší.
- **Příkazy v ruční zprávě:** `#bot` = pauza se hned zruší, `#stop` = pauza natrvalo (`contacts.bot_paused_permanent`), dokud ji nezrušíte. Hledá se samostatné slovo, na velikosti písmen nezáleží. Zpráva s příkazem se jen zpracuje (do historie pro AI nejde).
- **Log a historie:** ruční zprávy jsou v logu jako **Ruční odpověď** (`human_reply`) a jdou do kontextu AI jako odpovědi účtu.
- **Admin:** `/admin/contacts` – kontakty s pauzou (do kdy / natrvalo) a poslední aktivní kontakty, tlačítka **Zapnout bota** (zruší pauzu) / **Vypnout bota** (pauza natrvalo).
- **Webhook:** vyžaduje odběr pole `message_echoes` (bez něj echo nechodí a ruční převzetí nefunguje).

## Lokální spuštění

```bash
npm install
cp .env.example .env          # doplňte DATABASE_URL, ADMIN_PASSWORD, TOKEN_ENCRYPTION_KEY, …
npm run db:migrate            # vytvoří tabulky v Neonu (případně npm run db:push)
npm run dev                   # http://localhost:3000/admin
```

Pak v administraci: **Účty** → přidat účet ručně (libovolné číselné IG user ID) → **Pravidla** → nové pravidlo → **Simulátor** → odeslat testovací komentář/DM a zkontrolovat, co by bot odeslal. Vše se zapisuje do **Logu událostí**.

| Skript | |
| --- | --- |
| `npm run build` | produkční build |
| `npm test` | unit testy (normalizace, match, okna, podpis, šifrování, AI čištění/kontext) |
| `npm run db:generate` | vygeneruje SQL migraci po změně `lib/db/schema.ts` |
| `npm run db:migrate` | aplikuje migrace |
| `npm run db:studio` | Drizzle Studio |

## Proměnné prostředí

| Proměnná | Povinná | Popis |
| --- | --- | --- |
| `DATABASE_URL` | ano | Neon Postgres connection string |
| `ADMIN_PASSWORD` | ano | heslo do `/admin` |
| `ADMIN_SESSION_SECRET` | ne | tajemství pro podpis session cookie (fallback `ADMIN_PASSWORD`) |
| `TOKEN_ENCRYPTION_KEY` | pro tokeny | klíč pro šifrování access tokenů (`openssl rand -base64 32`), po nasazení neměnit |
| `META_APP_SECRET` | pro webhook | App Secret – ověření `X-Hub-Signature-256` (bez něj POST vrací 500) |
| `META_VERIFY_TOKEN` | pro webhook | verify token pro GET verifikaci webhooku |
| `META_APP_ID` | fáze 2 | Instagram App ID pro OAuth |
| `INSTAGRAM_MOCK` | ne | `true` (výchozí) = nic se neodesílá; reálná volání jen při `false` |
| `INSTAGRAM_GRAPH_API_VERSION` | ne | výchozí `v23.0` |
| `GEMINI_API_KEY` | pro AI | API klíč Google Gemini ([AI Studio](https://aistudio.google.com/apikey)) |
| `GEMINI_MODEL` | ne | model Gemini, výchozí `gemini-2.5-flash` |
| `RESEND_API_KEY` | pro upozornění | API klíč [Resend](https://resend.com/api-keys) |
| `NOTIFY_FROM` | ne | odesílatel upozornění, výchozí `IG Bot <onboarding@resend.dev>` |
| `GEMINI_THINKING_LEVEL` | ne | jen Gemini 3+: úroveň přemýšlení, výchozí `low` (`minimal` jen u modelů, které ji podporují) |

Na Vercelu nastavte stejné proměnné v Project → Settings → Environment Variables (nebo `vercel env add`).

## Fáze 2 – checklist napojení Meta app

Použijeme **Instagram API with Instagram Login** (graph.instagram.com) – nepotřebuje Facebook stránku, účet musí být **Business** nebo **Creator**.

### 1. Meta app
- [ ] [developers.facebook.com](https://developers.facebook.com/apps) → Create app → typ **Business**
- [ ] Přidat produkt **Instagram** → **API setup with Instagram login**
- [ ] Zapsat **Instagram App ID** → `META_APP_ID` a **Instagram App Secret** → `META_APP_SECRET` (pozor: Instagram app secret, ne Facebook app secret – podpisy webhooků pro Instagram Login jsou podepsané jím)
- [ ] App settings → Basic: vyplnit Privacy Policy URL, Terms URL, Data deletion URL, ikonu, kategorii

### 2. Oprávnění (scopes)
- [ ] `instagram_business_basic` – profil, média, ID účtu
- [ ] `instagram_business_manage_comments` – čtení komentářů, veřejné odpovědi, webhook `comments`
- [ ] `instagram_business_manage_messages` – DM, private replies, webhook `messages`
- [ ] V režimu Development fungují jen pro účty přidané jako **Instagram Testers** (App roles → Roles) – tester musí pozvánku přijmout v IG (Nastavení → Aplikace a weby)

### 3. Webhook
- [ ] Nasadit na Vercel (webhook musí být veřejná HTTPS URL)
- [ ] Instagram → API setup → **Configure webhooks**:
  - Callback URL: `https://<domena>/api/webhooks/instagram`
  - Verify token: hodnota `META_VERIFY_TOKEN`
  - Ověřit (Meta pošle GET s `hub.challenge`, endpoint ho vrátí)
- [ ] Přihlásit odběr polí **`comments`**, **`messages`**, **`messaging_postbacks`** (kliky na ice breakers) a **`message_echoes`** (ruční převzetí)
- [ ] Pro každý připojený účet aktivovat odběr: `POST https://graph.instagram.com/v23.0/me/subscribed_apps?subscribed_fields=comments,messages,messaging_postbacks,message_echoes` s jeho tokenem
- [ ] Ověřit podpis: v logu se nesmí objevovat 401 `Invalid signature`

### 4. OAuth flow (Business Login for Instagram)
- [ ] Nastavit **Valid OAuth Redirect URIs** v Meta app (např. `https://<domena>/api/auth/instagram/callback`)
- [ ] Endpoint pro start: redirect na `https://www.instagram.com/oauth/authorize?client_id=…&redirect_uri=…&response_type=code&scope=instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments` (+ `state` proti CSRF)
- [ ] Callback: `code` → short-lived token (`POST https://api.instagram.com/oauth/access_token`)
- [ ] Výměna za long-lived token (60 dní): `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=…&access_token=…`
- [ ] `GET /me?fields=user_id,username` → upsert do `accounts` (token šifrovat přes `lib/crypto.ts`, uložit `token_expires_at`)
- [ ] Cron (Vercel Cron) na obnovu tokenů před expirací: `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=…`
- [ ] Tlačítko „Připojit účet“ v `/admin/accounts`

### 5. Ostrý provoz
- [ ] Otestovat s tester účtem: komentář → veřejná odpověď + private reply; DM → odpověď v 24h okně
- [ ] `INSTAGRAM_MOCK=false` na Vercelu
- [ ] **App Review** pro všechna tři oprávnění (screencast s ukázkou použití) + **Business verification**
- [ ] Přepnout app do režimu **Live**
- [ ] Hlídat rate limity (Graph API i messaging) a chyby v Logu událostí

### Možná rozšíření
- Fronta (Vercel Queues) místo `after()` pro retry a vyšší objemy
- Follow-up sekvence, podmínka „sleduje účet“, postbacky tlačítek, statistiky pravidel
