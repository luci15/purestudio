# Pure Studio — project memory

Knowledge base + work history for this repo. Update after every task. Per-task detail lives in [BUILD_LOG.md](./BUILD_LOG.md).

## Stack (one-liner)
Single `index.html` (inline CSS + JS) + `supabase-adapter.js` (Firestore-like wrapper) + Vercel functions in `api/` + `schema.sql`. No build step, no npm deps for the app. GST billing + Cash Dealings ledger for a Mumbai studio — real client data.

## Architecture (password version, 2026-10-30)
- Browser → `/api/db` (session cookie) → Supabase REST with the **service-role key**. The browser holds no key. Tables: `clients, invoices, settings, cash_entries, expenses` (`{id text, data jsonb}`), plus `auth_attempts`, `blocked_entities`, `auth_state`. RLS on, no policies.
- **One site password, permanent.** First visit → "Create your password" (needs `SETUP_CODE` env var + 12+ char password) → scrypt hash stored once in `auth_state` (`password_hash`). No users, no email, no reset flow. Recovery: delete that row in Supabase → setup screen returns (old sessions die).
- `api/auth.js` (`?action=session|setup|login|logout`), `api/db.js`, `api/security.js` (attempt log + block/unblock), `api/keepalive.js` (daily cron), `api/_lib/core.js` (shared). `window.PureStudioAuth` (adapter) is the browser client; `getPureStudioDb()` returns `null` when `/api` is missing on localhost → local-storage mode, no password (dev only; real hosts fail closed).
- Rate limit: 5 wrong password/setup-code attempts per IP *or* device per 15 min → lock; 20 in 24h → auto-block 24h; IPv6 per /64. Login fails closed if DB unreachable. Device id is a localStorage random id (bypassable) — IP + limits are the real backstop.
- Web root is `public/` (only index.html, adapter, logo, 404.html are served). Business details live in `api/_lib/default-business.json` and are only sent to signed-in users.
- No realtime socket: listeners poll every 30s, skipping no-op updates.

## Env vars (Vercel)
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SETUP_CODE`; optional `CRON_SECRET`, `SESSION_HOURS`. (`SUPABASE_ANON_KEY` no longer used.)

## FAQ / known answers
- **Supabase free project paused?** Dashboard → project → *Restore project* (data kept 90 days). Prevent: daily Vercel cron `/api/keepalive` (needs `CRON_SECRET`).
- **Forgot the password:** Supabase Table Editor → `auth_state` → delete the `password_hash` row → visit the site → setup screen (needs `SETUP_CODE`).
- **Locked out / IP blocked by mistake:** wait 15 min, or delete the row in `blocked_entities`. Auto-blocks expire after 24h.
- **Deploy order for existing installs:** deploy code first, then run `schema.sql` (it drops the old open anon policies; the old frontend breaks after).
- **Testing:** the machine is often memory-starved; headless Chrome gets slow. Use jsdom (scratchpad) with a mock PostgREST harness; block fonts/cdnjs in Playwright; `pkill` doesn't exist — kill node via PowerShell `Get-CimInstance Win32_Process`.

## Work done
- 2026-09-07 — client punch list (12 items): auto numbering, payments, WhatsApp/email share, GST fix, cash ledger, etc.
- 2026-09/10 — client sort/filters, Bill/Cash popup, combined GST+Cash totals on Clients tables.
- 2026-10-18 — **Auth + hardening**: password login, signed session cookie, DB locked behind API, IP/device rate-limit + blocklist (+ Security panel), keep-alive cron, removed `/api/config` and `config.js`, security headers in `vercel.json`.
- 2026-10-18 (later) — **Supabase Auth + forgot/change password**: credentials moved to Supabase Auth behind the gateway; reset email flow; password change signs other devices out. API tests 74/74, UI tests 55/55 (mocks).
- 2026-10-18 (later still) — **Super admin + staff (max 3)**: `api/users.js`, `app_users` table, owner-only security/users endpoints, per-user sign-out marker. API 115/115, UI 70/70 (mocks).
- 2026-10-18 (end) — **Business details moved out of public source** (server-only JSON, signed-in users only). API 120/120, UI 73/73.
- 2026-10-18 (end) — **Web root moved to `public/`** (only index.html, adapter, logo, 404.html are served; docs/SQL/scripts/legacy files are not). Sign-in layer waits for business details. Settings edit + cross-device sync verified (mocks). If live site 404s after deploy: Vercel Output Directory must be `public`.
- 2026-10-20 — **Multiple super admins**: `OWNER_EMAIL` comma list; owners can't be edited via app; `MAX_USERS` counts them. Two-owner tests 22/22 + 21/21.
- 2026-10-20 — **Expenses tab** (`expenses` collection; name/type/amount/date/Paid-Unpaid status column, toggle chip, filters). Needs `schema.sql` re-run on Supabase. Local run: `python -m http.server 8080 --directory public`. expenses_test 36/36.
- 2026-10-21 — Dashboard **Expenses — <month>** tile (paid/unpaid split, follows month picker); Expenses filters moved right. Local branch `auth-hardening` only; live `main` doesn't have them yet.
- 2026-10-28 — **Opening balance removed** (live main fcfd34a + local). Dashboard tiles are plain monthly sums; kept dashboard Expenses tile + Expenses filter position. Login work still only on local branch `auth-hardening`.
- 2026-10-30 — **Password version for deploy**: single permanent site password (first-visit setup with `SETUP_CODE`), rate limiting + IP/device blocklist + Security panel; Supabase Auth/staff/email-reset removed. API 89/89.
- 2026-10-30 — Eye (show/hide) button on all password boxes on the sign-in layer. Tests eye 17/17, password flow 35/35.
