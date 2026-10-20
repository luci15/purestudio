# Pure Studio — project memory

Knowledge base + work history for this repo. Update after every task. Per-task detail lives in [BUILD_LOG.md](./BUILD_LOG.md).

## Stack (one-liner)
Single `index.html` (inline CSS + JS) + `supabase-adapter.js` (Firestore-like wrapper) + Vercel functions in `api/` + `schema.sql`. No build step, no npm deps for the app. GST billing + Cash Dealings ledger for a Mumbai studio — real client data.

## Architecture (since 2026-10-18)
- Browser → `/api/db` (session cookie) → Supabase REST with **service-role key**. The browser holds no key; the anon key is used server-side only (Supabase Auth calls). Tables: `clients, invoices, settings, cash_entries` (`{id text, data jsonb}`), `auth_attempts`, `blocked_entities`, `auth_state`, `app_users`. RLS on, no policies.
- `api/auth.js` (`?action=session|login|logout|forgot|reset|change`), `api/db.js`, `api/security.js` + `api/users.js` (**super admin only**: block list / staff management), `api/keepalive.js` (daily cron), `api/_lib/core.js` (shared).
- `window.PureStudioAuth` (adapter) = sign-in client; `getPureStudioDb()` returns `null` when `/api` is missing on localhost → local-storage mode, no login (dev only; non-localhost fails closed).
- No realtime socket anymore: each listener polls every 30s, skipping no-op updates.

## Env vars (Vercel)
`SUPABASE_URL`, `SUPABASE_ANON_KEY` (server-only), `SUPABASE_SERVICE_ROLE_KEY`, `OWNER_EMAIL` (one email, or several comma-separated = several super admins), `SESSION_SECRET` (≥32 chars), `CRON_SECRET`, optional `SITE_URL`, `SESSION_HOURS`, `MAX_USERS` (default 3 accounts counting every super admin + staff; = number of super admins → no staff). Secrets: `node scripts/setup-auth.js`. The password lives in **Supabase Auth** (one user, sign-ups OFF).

- **Public vs private:** the site is one URL/one sign-in screen for everyone. Stranger sees only the login card. Business details (bank/UPI/GSTIN/address/terms) live in `api/_lib/default-business.json`, served only to signed-in users via `/api/db {op:'defaults'}`; `index.html` has blanks. Legacy `pure-studio-dashboard.html` + `test_script.js` still contain them but live outside `public/`, so they are no longer served; they remain in git history (keep the repo private).

## FAQ / known answers
- **Supabase free project paused?** Dashboard → project → *Restore project* (data kept 90 days). Prevent: daily Vercel cron `/api/keepalive` (needs `CRON_SECRET`).
- **Forgot password:** sign-in screen → "Forgot password?" → Supabase emails a link (needs Site URL + Redirect URL set in Supabase Auth). **Change password:** Security panel. Both sign every other device out. Emergency: set a new password in Supabase → Authentication → Users, or rotate `SESSION_SECRET` to sign everyone out.
- **Users:** super admin (`OWNER_EMAIL`, only changeable in Supabase) + staff added from *Account & security → Users* (user ID = email, admin sets the initial password). Staff = everything except users/security. Signing in requires being in `app_users` (a bare Supabase Auth user can't). Disable/remove/reset ends that user's sessions immediately.
- **Locked out / IP blocked by mistake:** wait 15 min (rate limit), or delete the row in Supabase table `blocked_entities` (Table Editor). Auto-blocks expire after 24h.
- **Rate-limit rules:** 5 failed logins/15 min per IP *or* device → lock; 20 failed/24h → auto-block 24h. IPv6 per /64. Login fails closed if DB unreachable.
- **Device blacklist caveat:** device id is a random localStorage id — bypassable by clearing site data; IP + rate limits are the real backstop.
- **Deploy order for existing installs:** deploy code first, then run `schema.sql` (it drops the old open anon policies; old frontend breaks after).
- **Testing:** the machine is often memory-starved; headless Chrome gets very slow/crashes. Block fonts/cdnjs in Playwright (`route` abort), use 90s timeouts, `waitUntil:'domcontentloaded'`. Test harness (mock PostgREST + Vercel-style req/res shim) was kept outside the repo.
- `pkill` doesn't exist in this shell — kill node via PowerShell `Get-CimInstance Win32_Process`.

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
