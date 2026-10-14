# IG Bot – vlastní Instagram automatizace (fáze 1)

Univerzální multi-account bot ve stylu ManyChat: reaguje na **komentáře** a **přímé zprávy (DM)** podle pravidel s klíčovými slovy – veřejně odpoví pod komentář a pošle soukromou zprávu (volitelně s tlačítkem s odkazem).

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
| `lib/engine/match.ts` | Výběr pravidla. Priorita: pravidlo pro konkrétní post > přesná shoda > obsahuje > nejstarší. Pravidlo bez klíčových slov reaguje na vše. |
| `lib/engine/window.ts` | 24h okno pro DM, 7denní okno pro private reply na komentář. |
| `lib/engine/process.ts` | Zpracování payloadu: dedup, kontakty, match, akce, log. |
| `lib/instagram.ts` | Wrapper nad Graph API (`replyToComment`, `sendPrivateReply`, `sendDirectMessage`). V MOCK režimu vrací jen popis requestu. |
| `lib/crypto.ts` | AES-256-GCM šifrování access tokenů. |
| `lib/auth.ts`, `proxy.ts` | Ochrana `/admin` – heslo → podepsaná HttpOnly cookie (HMAC, 7 dní). V Next.js 16 se `middleware.ts` jmenuje `proxy.ts`. |
| `lib/db/schema.ts` | Drizzle schéma, migrace v `drizzle/`. |
| `app/admin/` | Administrace (česky): přehled, pravidla, účty, log událostí, simulátor. |

### Datový model

- **accounts** – `ig_user_id`, `username`, `access_token` (šifrovaně), `token_expires_at`, `active`
- **rules** – `account_id`, `trigger_type` (`comment` \| `dm`), `keywords[]`, `match_mode` (`contains` \| `exact`), `post_id` (volitelné), `public_reply`, `dm_text`, `dm_button_url`, `dm_button_title`, `active`
- **events_log** – příchozí webhooky i odchozí odpovědi: `direction` (in/out), `kind`, `status`, `dedup_key` (unikátní), `detail`, `payload`, `simulated`
- **contacts** – `account_id` + `ig_scoped_id` (unikátní), `username`, `last_interaction_at` (poslední příchozí DM → 24h okno)

### Pravidla chování

- **Dedup / idempotence:** každý příchozí komentář/zpráva má unikátní `dedup_key` (`in:comment:<id>`, `in:message:<mid>`). Meta webhooky doručuje opakovaně – duplikát se nezpracuje. Každá odchozí akce si před odesláním „zabere“ řádek s klíčem `out:<akce>:<id>`, takže se ani při souběhu neodešle dvakrát.
- **Smyčky:** komentáře od vlastního účtu a DM echo (`is_echo`) se ignorují.
- **24h okno:** odpověď na DM se pošle jen do 24 h od poslední zprávy uživatele (`contacts.last_interaction_at`), jinak se v logu označí jako přeskočená.
- **Private reply:** DM na základě komentáře se posílá jako private reply (`recipient.comment_id`) – max. 1× na komentář a do 7 dní od komentáře. Nevyžaduje otevřené 24h okno.
- **Proměnné:** v textech lze použít `{username}`.
- **Tlačítko:** pokud má pravidlo `dm_button_url`, DM se pošle jako button template s `web_url` tlačítkem.

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
| `npm test` | unit testy enginu (normalizace, match, okna, podpis, šifrování) |
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
- [ ] Přihlásit odběr polí **`comments`** a **`messages`** (případně `messaging_postbacks` pro tlačítka)
- [ ] Pro každý připojený účet aktivovat odběr: `POST https://graph.instagram.com/v23.0/me/subscribed_apps?subscribed_fields=comments,messages` s jeho tokenem
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
