# Build Log

## 2026-09-11 — "Total sales" on Clients now includes cash

The Clients tab table and the Dashboard's "All-time sales by client" table were
both still GST-invoice-only for their "Total sales" figure, so a client with only
a cash entry (no GST invoice) showed ₹0.00 there even though the client drawer
already showed the cash amount correctly. Both tables now show the combined
GST+Cash total as the headline figure, with a small "GST ₹X · Cash ₹Y" breakdown
line underneath whenever a client has any cash sales (so nothing is silently
merged — the split is always visible). The invoice-count column is relabeled
"GST invoices" for clarity since it doesn't include cash entries. The sort filter
now sorts by this same combined total. Verified: a client with only a ₹650 cash
entry now shows "₹650.00 / GST ₹0.00 · Cash ₹650.00" instead of ₹0.00, on both
tables.

## 2026-09-11 — Revenue summary in the client card

The client drawer (opened by tapping a client) now has a "Revenue summary" section
with three figures side by side — GST sales, Cash sales, and Combined total — plus a
new "Cash history" list beneath the existing "Invoice history" (both clickable to
open that document's preview), and a "+ New cash entry" quick-action button next to
"+ New invoice". The main Clients table's "Total sales" column is unchanged
(GST-only), matching the dashboard's existing convention of never silently merging
GST and cash figures. Verified with Playwright: a client with one ₹1,180 GST invoice
and one ₹500 cash entry shows GST ₹1,180.00 / Cash ₹500.00 / Combined ₹1,680.00, with
both history lists present.

## 2026-09-11 — Link Cash Dealings to the shared client list

Cash entry's "Client name" is now a search/select combobox, same as the GST invoice
form: pick an existing client (their phone auto-fills if on file) or type a new name
and use "+ Add ... as a new client" to create it on the spot — it then shows up in
the Clients tab like any other client. Saving is blocked until a client is actually
resolved (selected or created), matching the invoice form's behavior exactly. Cash
entries now store `clientId` alongside the existing `clientName`/`clientPhone`;
editing an older cash entry that predates this (no `clientId` on record) auto-matches
it to an existing client by exact name if one exists. Cash amounts still do NOT
count toward a client's GST "Total sales" figure — only the client identity is
shared, not the revenue totals. Verified with Playwright: existing-client selection
(no duplicate, phone autofill), new-client creation (added to Clients list), and the
submit-blocked-until-resolved guard.

## 2026-09-11 — Remove the floating "+" button on mobile

Removed the mobile-only floating action button and its "New invoice / Add client /
New cash entry" popup sheet entirely (not just hidden — the button, the sheet markup,
and all its JS wiring). It was redundant: every tab already has its own "+" button
(Clients, Invoices, Cash), and "+ New invoice" now offers the Bill/Cash choice itself.
Verified the FAB and sheet are gone from the DOM and that the per-tab add buttons
still work correctly on a mobile viewport.

## 2026-09-11 — Bill/Cash choice popup on "+ New invoice"

Clicking "+ New invoice" (Dashboard or the Invoices tab) now first shows a small
popup asking "GST / Bill Invoice" or "Cash Entry", instead of going straight to the
GST invoice form. Picking either opens the right form; Cancel or Escape dismisses it,
backdrop click does not (consistent with the other forms). The mobile FAB menu was
left as-is since it already separates "New invoice" and "New cash entry" as distinct
options. Verified with Playwright (popup shows on both buttons, each choice opens the
correct form, cancel/backdrop behavior correct).

## 2026-09-09 — Cash invoice total label + auto-preview on save

- Cash Invoice's grand total was mislabeled "Amount Received" (a payment-tracking term
  that doesn't apply to cash entries) — renamed to "Invoice Value" to match the GST
  invoice's own terminology.
- Saving a GST invoice or a cash entry (add or edit) now automatically opens its
  Print/Download/WhatsApp/Email preview right after the form closes, instead of just
  returning to the list. Closing the preview leaves the normal "+ New invoice"/"+ New
  cash entry" buttons usable as before. Verified with Playwright.

## 2026-09-09 — Cash Invoice document

Cash Dealings entries can now be previewed/printed/downloaded/shared exactly like a
GST invoice, using the same paper layout — except the header reads **"Cash Invoice"**
instead of "Tax Invoice", there's no CGST/SGST/IGST breakdown or bank/payment details
section (cash has neither), "BILL TO" becomes "RECEIVED FROM" with just name + phone
(matching what's actually collected for cash), and a footer note clarifies it isn't a
GST tax invoice. Reused the exact same overlay, Print/Download PDF/WhatsApp/Email
buttons, and the business's logo/letterhead — the preview code now branches on
`previewKind` ('invoice' | 'cash') instead of being invoice-only. Verified with a
Playwright run (title, cash number, client name/phone, amount, and absence of any
GST rows all present) plus a regression pass confirming the GST invoice preview is
unaffected.

Also hoisted the ~370KB inline base64 logo fallback out of `openPreview` into a
shared `getLogoHtml()` so it isn't duplicated a second time for the new cash preview.

## 2026-09-09 — Save reliability + modal UX fixes

Reported: editing an existing invoice doesn't save; a deleted client/invoice reappears
after a refresh ("maybe supabase is not catching it"); the invoice/client form closes
if you click outside it instead of only via Cancel.

- **Modal backdrop click removed** on the client, invoice, cash entry, and settings
  forms — they now only close via Cancel (or the drawer's own X). Preview stays
  click-outside-to-close since it holds no unsaved input. Verified with Playwright.
- **Root cause of the save/delete bugs**: `supabase-adapter.js`'s cloud-fetch merge
  logic used "does this id exist in the cloud response" to decide what to keep. If a
  write or delete hadn't fully round-tripped yet (or failed) by the time the next
  cloud fetch ran (a realtime event, or the initial load), that fetch's stale server
  state silently overwrote the correct local one — an edit would look saved for a
  moment then quietly revert, and a deleted row could reappear.
  Fixed by tracking pending writes/deletes per collection (persisted to
  `localStorage`, not just in memory) that always win over a cloud fetch until the
  Supabase call actually confirms; confirmed pending writes/deletes are opportunistically
  retried on every later cloud fetch. Also fixed `update()` uploading only the partial
  patch to Supabase (which — since `upsert` replaces the whole jsonb column — was
  silently wiping fields like `createdAt` that weren't part of the edit).
  Verified the merge logic in isolation (can't reach the user's live Supabase project
  from here) and ran a full add/edit/delete/refresh regression against the
  local-storage backend — all still correct.
- Save/delete failures now surface a "kept locally, will retry" banner instead of
  failing silently (via a `purestudio:sync-error` event from the adapter).

## 2026-09-07 — Client dev-brief punch list (12 items)

Source: `Pure_Studio_Billing_Software_Changes - Changes Required.pdf`. Verified with an
automated Playwright smoke test against a local server (add client, create an interstate
invoice, record a payment, create a cash entry, check dashboard KPIs) — no console errors,
all flows confirmed working.

| # | Item | Status | Notes |
|---|------|--------|-------|
| 01 | Automatic invoice numbering | Done | `nextInvoiceNumber()` — max existing number in the current FY + 1, falls back to a configurable "starts at" setting (Settings → Invoice numbering) only when there's no prior invoice that FY. Field is read-only by default (pencil icon to override). |
| 02 | Advance / partial payment tracking | Done | Invoices now carry a `payments[]` array (date, amount, note). Amount Received / Balance Due / Payment Status (Paid / Partially Paid / Pending / Overdue) are derived everywhere — invoice list, client drawer, preview, PDF. Replaced the old free-choice status dropdown. |
| 03 | WhatsApp / Email invoice sharing | Done | Preview toolbar has WhatsApp/Email buttons. Uses the Web Share API with the actual PDF file when the browser supports it (`navigator.canShare({files})`); otherwise downloads the PDF and opens a prefilled `wa.me`/`mailto:` compose window (browsers can't auto-attach a file to either from a webpage — that's a platform limit, not something to fake). |
| 04 | GST calculation (CGST+SGST **or** IGST) | Fixed — real bug | `computeTotals()` was applying CGST+SGST *and* IGST together for interstate invoices (triple tax). Now CGST/SGST are forced to 0 when "Other State" is selected. Fixed in the calculator, the on-screen summary, the printable invoice, and the PDF. Also fixed the CGST/SGST form fields not actually hiding for interstate invoices (see the `[hidden]` bug below). |
| 05 | "New client not saving" | Fixed — real bug | Root cause: the Supabase adapter only refreshed the UI after its own realtime round-trip, so a save could silently look like nothing happened if the postgres_changes event was slow/missed. `supabase-adapter.js` now notifies listeners immediately from the local optimistic copy on every add/set/update/delete (same pattern the local-storage fallback already used), and merges rather than overwrites on the next cloud fetch so a pending write is never wiped. Save failures also now surface a banner instead of failing silently. |
| 06 | White theme only | Done | Removed the dark-mode CSS blocks (`prefers-color-scheme`, `[data-theme="dark"]`) entirely — the app is light-only now regardless of OS setting. |
| 07 | Cash Dealings — separate section | Done | New "Cash Dealings" tab (desktop sidebar, mobile bottom nav, quick-add sheet). |
| 08 | Cash invoice numbering | Done | Independent `CASH-0001…` sequence (`nextCashNumber()`), configurable start number in Settings, never touches the GST invoice sequence. |
| 09 | Cash — no GST | Done | Cash entries have no tax fields at all — just client name, phone, date, description, amount. |
| 10 | Cash — client name + phone only | Done | Cash entry form only requires those two fields (no GSTIN, no address, not tied to the GST client list). |
| 11 | Cash history — separate view | Done | Own table/tab, own search, never mixed with GST invoice history. |
| 12 | Monthly revenue — separate Cash vs Billing | Done | Dashboard now shows three KPI tiles for the selected month: "GST Billing", "Cash Dealings", and an explicitly-labeled "Combined Total" — never silently merged. |

### Other things fixed along the way
- **`[hidden]` attribute was not hiding anything.** `.field-row{display:grid}` (and similarly-specific rules elsewhere) silently beat the browser's default `[hidden]{display:none}`, so the IGST field row was likely visible even on ordinary in-state invoices. Added a global `[hidden]{display:none !important;}` rule.
- Removed ~120 lines of dead code: an old jsPDF/autotable-based PDF generator that nothing called anymore (PDF export now goes through `html2pdf` rendering the actual invoice paper HTML), plus its two now-unused `<script>` tags.
- `init()` was calling `getPureStudioDb()` twice on every page load (a redundant `||` chain), doubling the `/api/config` network request. Simplified to one call.
- `README.md` referenced an in-app "Cloud Sync (Supabase)" settings UI that a previous change had already removed — corrected the setup instructions to match what's actually in the app, and documented the new `cash_entries` table in `schema.sql`.

### Files touched
`index.html`, `supabase-adapter.js`, `schema.sql`, `README.md`.

### Follow-ups for the business owner (not code changes)
- If Supabase is already set up, re-run `schema.sql` — it now also creates the `cash_entries` table (needed for items 07–11).
- The WhatsApp/Email buttons attach the real PDF automatically only on browsers/devices that support the Web Share API with files (most modern mobile browsers); elsewhere they download the PDF and open the compose window for a manual attach — that split is a browser security limit, not a bug.

## 2026-10-18 — Sign-in, rate limiting, IP/device blocklist, anti-pause keep-alive

Request: free Supabase project got paused from inactivity; add password protection with
sign-in, rate limiting, and IP/device blacklisting.

**Root problem found:** the old setup shipped the Supabase anon key to every visitor (`/api/config`)
and the tables had `using (true)` policies — anyone with the site URL could read/write all client,
GST and bank data. A login screen alone would have been cosmetic, so the database is now only
reachable through the app's own API.

| Area | What changed |
|------|--------------|
| Auth | `api/auth.js` — owner login (`APP_USERNAME` + scrypt `APP_PASSWORD_HASH`), HMAC-signed `HttpOnly; SameSite=Strict` session cookie bound to the browser's device id, 24h default (`SESSION_HOURS`). Constant-time checks; scrypt runs even for a wrong username. |
| Data gateway | `api/db.js` — whitelisted tables, ops `select/get/upsert/delete`, id/data validation, ids URL-encoded (filter-injection tested). Uses service-role key server-side only. |
| Rate limit | 5 failed logins per IP **and** per device per 15 min → locked (429 + `Retry-After`, countdown on the button); in-memory 20/min login burst cap and 240/min API cap per IP. IPv6 collapsed to /64. Login **fails closed** if the limit store is unreachable. |
| Blacklist | `blocked_entities` table; 20 failures/24h → auto-block 24h; manual block/unblock (permanent or N hours) from **Security & sign out** panel with attempt log; blocked IP/device is cut off even mid-session; can't block your own IP/device. |
| DB lockdown | `schema.sql` (idempotent): RLS on, old anon policies dropped, `revoke all` from `anon, authenticated`; new `auth_attempts`, `blocked_entities`. |
| Anti-pause | `api/keepalive.js` daily Vercel cron (`vercel.json`) pings the DB and prunes logs >30d / expired blocks; needs `CRON_SECRET`. Sidebar badge now shows 🔴 "Cloud unreachable" when the DB can't be reached. |
| Client | `supabase-adapter.js`: supabase-js CDN dependency removed; same optimistic-write + pending-queue behaviour, now over `/api/db`; realtime replaced by 30s polling that skips no-op updates. `index.html`: full-screen sign-in layer, session-expiry re-prompt, sign-out (wipes cached data), Security panel, hostile strings escaped. |
| Removed | `api/config.js` (public key endpoint), `config.js`. |
| Hardening | `vercel.json` security headers (X-Frame-Options, nosniff, Referrer-Policy); `.vercelignore` keeps docs/SQL/scripts off the public site. |
| Tooling | `scripts/setup-auth.js` prints `APP_PASSWORD_HASH`, `SESSION_SECRET`, `CRON_SECRET`. |

### Verification
Run against the real handlers with an in-memory mock of Supabase REST (no access to the live project):
- **API suite — 47/47:** 401 without session, per-IP / per-device lock, lock survives IP or device change, correct password rejected while locked, cookie flags, cookie replay from another device rejected, tampered cookie rejected, internal tables unreachable via `/api/db`, filter-injection id doesn't widen a delete, manual + auto block, block cuts off a live session, IPv6 /64 keying, keepalive auth, DB down → 503 and login fails closed, only the service key reaches Supabase.
- **UI suite (real `index.html` + adapter in jsdom) — 39/39:** gate before data, wrong-password message, login, add client persists server-side, pending queue drains, security panel block/unblock/self-block refusal, XSS-escaped log, reload keeps session, expiry mid-use → prompt → re-login → pending edit syncs, sign-out wipes cache, lockout countdown, unconfigured-server message, non-localhost + unreachable API fails closed, plain static server still falls back to local mode.
- Visual check: the sign-in screen was screenshotted in real Chrome (renders, covers the app). The rest of the UI flow could not be driven in Chrome — the machine was out of memory and even the unmodified old page hung — so the Security panel and mobile top bar layout were not eyeballed. Nothing was run against the live Supabase/Vercel deployment.

### Owner follow-ups (not code)
1. **Restore the paused project:** Supabase dashboard → project → *Restore project* (kept 90 days after pausing).
2. `node scripts/setup-auth.js`, add env vars in Vercel (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_USERNAME`, `APP_PASSWORD_HASH`, `SESSION_SECRET`, `CRON_SECRET`), redeploy.
3. **Then** run the new `schema.sql` (drops the open anon policies — old frontend breaks after that).
4. Consider rotating the anon key / project API keys: the old one was public.
5. Rate limits/blocks apply per IP/device; device id is bypassable by clearing site data — IP rules are the backstop.

### Addendum (same day) — forgot password + Supabase Auth

Request: "give forgot password option, or can we use some auth here?"

- Credentials moved from env vars (`APP_USERNAME`/`APP_PASSWORD_HASH`) to **Supabase Auth** (one owner user, sign-ups disabled). `/api/auth` still sits in front: rate limit, IP/device blocklist and the app's own session cookie are unchanged; Supabase tokens stay server-side.
- New actions in `api/auth.js`: `forgot` (identical 200 for any email; only the owner email triggers Supabase's reset mail; 3/10 min per IP), `reset` (recovery token from the emailed link + new password, owner-only), `change` (needs session + current password; guessing it counts toward the lockout).
- Password change/reset writes a "sessions valid after" marker (`auth_state` table) → **all other sessions end** (≤30s on other instances); the device that changed it keeps working via a fresh cookie.
- UI: email field, "Forgot password?" → request form, reset form opened by the emailed link (token scrubbed from the URL), expired-link message, "Change password" section in the Security panel.
- Env vars now: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (server-only), `SUPABASE_SERVICE_ROLE_KEY`, `OWNER_EMAIL`, `SESSION_SECRET`, `CRON_SECRET`, optional `SITE_URL`, `SESSION_HOURS`. `scripts/setup-auth.js` now only prints the random secrets.
- Verification (mock Supabase REST + mock GoTrue): **API suite 74/74**, **UI suite 55/55** (jsdom, real page + handlers). Not tested against real Supabase Auth or a real email — the mock stands in for GoTrue's documented endpoints (`/token?grant_type=password`, `/recover`, `/user`, `/admin/users/:id`).
- New owner steps: in Supabase turn off sign-ups, add the owner user (auto-confirm), set Site URL + Redirect URL, add `OWNER_EMAIL` and `SUPABASE_ANON_KEY` in Vercel. **Rotate the keys** (old anon key was public and can now target Supabase Auth directly, bypassing the app's lockout).

### Addendum 2 (same day) — super admin + staff accounts (max 3)

Request: only 1–3 users, created by a super admin (no public sign-up); asked how big companies do it.
Chosen: staff = everything except admin; no audit log / 2-step (kept simple).

- **Model:** super admin = `OWNER_EMAIL` (lives only in Supabase Auth). Staff = Supabase Auth user + row in new `app_users` table (`email, role='staff', active`). Anyone in Supabase Auth who is **not** in `app_users` cannot sign in. `MAX_USERS` (default 3) caps total accounts.
- **`api/users.js` (super admin only):** create (email + initial password, auto-confirmed), disable/enable, set password, remove (also deletes the Supabase Auth user). Create is rolled back in Supabase Auth if the table insert fails.
- **Enforcement on the server:** `requireSession(req, res, 'owner')` gates `/api/users` and `/api/security`; staff get 403. Staff keep full access to `/api/db` (clients, invoices, cash, business details, deletes).
- **Per-user sign-out marker** (`auth_state` key `valid_after:<email>`) replaces the global one: changing/resetting your password, or the admin disabling/removing/resetting you, ends only that user's sessions.
- **UI:** "Account & security" (all users: who you are, change password, sign out); Users, block list and sign-in log only for the super admin.
- **Tests (mock Supabase REST + Auth):** API 115/115, UI 70/70 — incl. staff 403s on admin endpoints, cap enforcement (and no stray Supabase user created when refused), ghost Supabase user can't sign in, disable cuts off a live session, admin password reset kills sessions, owner can't be edited/removed, freed slot reusable, staff can forgot/change password without affecting the owner.
- **Owner steps:** re-run `schema.sql` (adds `app_users`); optional `MAX_USERS`; add staff from the app after first sign-in.

### Addendum 3 (same day) — what a stranger sees; business details no longer public

Question: staff log in via the main page — what do other visitors see?
- Everyone (staff, super admin, strangers) uses the **same URL and the same sign-in screen**; the role only changes what appears after sign-in.
- A stranger gets the sign-in card only — no data, no keys. Audit found one leak: the public `index.html` hard-coded the studio's bank account no., IFSC, UPI id, GSTIN, addresses, phone and email, readable via "View source".
- Fix: those fields moved to `api/_lib/default-business.json` (server-only) and are returned by `/api/db {op:'defaults'}` to signed-in users only; the public file keeps blanks. `.vercelignore` also lists `pure-studio-dashboard.html`.
- **Still exposed:** `pure-studio-dashboard.html` and `test_script.js` (old copies of the app) still contain the same details and are served as static files until deleted. Git history also still contains them — keep the repo private.
- Local-only mode (static dev server, no `/api`) now shows blank business details by design; fill them in Settings.
- Tests: API 120/120, UI 73/73 (incl. anonymous 401, no secrets in served files, staff + super admin receive details after sign-in).

### Addendum 4 (same day) — guessing URLs; only `public/` is served; settings edit + sync verified

Questions: what does someone see if they change the URL slug? Are GSTIN/business details shown after sign-in, editable and synced?
- **Web root is now `public/`** (`vercel.json` → `"outputDirectory": "public"`): `index.html`, `supabase-adapter.js`, logo, `404.html`. Everything else in the repo (`schema.sql`, README, BUILD_LOG, memory.md, scripts, `.env.example`, legacy `pure-studio-dashboard.html`, `test_script.js`) is no longer reachable by URL, so the two legacy files with bank details are no longer served and did not need deleting. `api/` stays at the repo root as serverless functions (`api/_lib` is not routable).
- Any unknown path → plain 404 page ("This page doesn't exist" + "Go to sign in"), no stack/path info. `/api/*` without a session → 401 JSON; GET on `/api/db` → 405; `/api/users` & `/api/security` need the super admin (staff → 403).
- Unauthenticated `/api` calls now answer 401 "Not signed in" even without the device header (previously 400).
- **Bug fixed:** the sign-in layer was dismissed before the server-held business details finished loading, so Settings could briefly be opened empty (and saved blank). It now stays until the details are in.
- **Business details:** shown in Settings after sign-in (server defaults), editable by super admin and staff, saved to `settings/business` in the database, and picked up by other devices by polling (≤30s; measured 29s) and on reload. Untouched fields persist.
- Tests: API 150/150 (adds 20+ guessed-URL checks, anon 401/405s), UI suite extended with edit → server row → second device sync → reload.
- Untested on real Vercel: the `outputDirectory` change. If the live site 404s everywhere after deploy, check Project Settings → Build & Output → Output Directory is `public` (or empty so `vercel.json` applies).

### Addendum 5 — several super admins (no staff required)

Request: no staff for now, but two people with super-admin access.
- `OWNER_EMAIL` now accepts a comma-separated list; every listed email is a full super admin (Users, Security/blocklist, business details, everything). Each is created by hand in Supabase Authentication → Users (auto-confirm); nothing else changes for them (own password, forgot/change password, per-user sign-out).
- Neither super admin can be disabled, removed or re-created as staff through the app; only Supabase + `OWNER_EMAIL` change them.
- `MAX_USERS` counts super admins + staff. With two super admins the default (3) leaves 1 staff slot; `MAX_USERS=2` = no staff possible.
- Also fixed: Supabase Auth calls no longer send a new-style `sb_publishable_` key in the `Authorization` header (only legacy JWT keys do).
- Tests: new two-super-admin suite 22/22 (cap 3) and 21/21 (`MAX_USERS=2`); full API suite 150/150 re-run; UI suite re-run (see below).

## 2026-10-20 — Expenses tab

Request: an Expenses section where any kind of expense can be created, named, given a type, and shown as Paid or Unpaid in a column; run it locally.

- New **Expenses** tab (sidebar + mobile bottom bar). Fields: name, **type** (free text with suggestions: Rent, Salaries, Software, Travel, Utilities, Marketing, Equipment, Taxes, Other + every type already used), amount, date, **status Paid/Unpaid**, optional notes.
- Table columns: Date · Expense · Type · Amount · **Status** · actions. The Status chip is a button: click to flip Paid ⇄ Unpaid. Edit and delete (with confirm) per row.
- Top tiles: Total / Paid / Unpaid for whatever is currently filtered. Filters: search (name, type, notes), status, type. Typing a type that already exists in a different case reuses the existing spelling (no "rent"/"Rent" duplicates).
- Storage: new `expenses` collection (`{id, data}`) — works in local-storage mode and through the signed-in API. Server: `expenses` added to the table whitelist; `schema.sql` creates it with RLS on / no public grants → **re-run `schema.sql` on Supabase before using Expenses on the live site**.
- Not wired into the Dashboard revenue tiles or any profit figure (not requested).
- Tests: `expenses_test.js` 36/36 (local mode, reload persistence, signed-in save + second-device view); API 150/150 and UI suite re-run clean. Pixel layout checked in real Chrome (screenshots).
- Local run: `python -m http.server 8080 --directory public` → http://127.0.0.1:8080 (no login in local mode; data lives in that browser's localStorage).

## 2026-10-21 — Dashboard: monthly Expenses tile; Expenses filters moved right

- Dashboard (main page) has a new **Expenses — <month>** tile right after Combined Total: total of that month's expenses, with a "₹x paid · ₹y unpaid" split (or "No expenses this month"). It follows the Month picker and updates when expenses are added, edited, toggled Paid/Unpaid or deleted.
- Revenue tiles are untouched; expenses are *not* subtracted from Combined Total (no profit figure was requested).
- Expenses page: the status/type filter boxes now sit on the right next to the "n expenses" count.
- Tests: dashboard_expenses 14/14 (month isolation, picker, toggle/edit/delete sync, reload); layout checked in real Chrome. Local only — not pushed (live `main` has neither change yet).

### Correction (same day) - existing October entries now count
Opening amount + every invoice/cash entry dated in October (already saved or added later); the creation-time cut-off was removed. Pushed to main as 717f5f4.


## 2026-10-28 - Removed the October opening balance
Opening amounts and the this-month boxes on the Invoices/Cash pages removed (dashboard tiles are plain sums again); dashboard Expenses tile and Expenses filter position kept. Pushed to main as fcfd34a.

## 2026-10-30 — Password protection, first-time setup, permanent password (for deploy)

Request: ship the password security with rate limiting; ask for the password on first use and make it the permanent password.

- **Design change:** the earlier Supabase-Auth / email / staff / super-admin version (kept on local branch history) was replaced by a single site password. No emails, no staff, no reset-by-email — the password is permanent.
- **First visit** shows "Create your password": `SETUP_CODE` (env var only the owner knows — prevents a stranger from claiming the password first) + new password (12+ chars, typed twice). Stored as an scrypt hash in `auth_state` (`password_hash`), insert-only so the first writer wins; setup is then closed. Race-tested: of two simultaneous setups exactly one wins.
- **Login:** password only. Wrong setup codes and wrong passwords both count toward the lockout: 5 per IP/device per 15 min → locked with a countdown; 20 in 24h → auto-block 24h; IPv6 per /64. Security panel kept (attempt log, block/unblock IP or device; blocked IPs are cut off mid-session).
- Sessions: HttpOnly, SameSite=Strict, bound to the device and to the current password (deleting the stored password and re-running setup signs everyone out). Signing key derived from the service-role key — no `SESSION_SECRET` to configure.
- Recovery without email: delete the `password_hash` row in Supabase `auth_state`.
- Removed: Supabase Auth use, `OWNER_EMAIL`, `MAX_USERS`, staff accounts, forgot/change password, `api/users.js`, `scripts/setup-auth.js`, `app_users` table.
- Env vars to set in Vercel: `SUPABASE_URL` (already there), `SUPABASE_SERVICE_ROLE_KEY`, `SETUP_CODE` (+ optional `CRON_SECRET`, `SESSION_HOURS`). `SUPABASE_ANON_KEY` is no longer used. Then run `schema.sql`.
- Tests (simulated browser + mock database): API 89/89; UI suite in `pw_ui_test` (see end-of-session summary).

## 2026-10-30 — Show/hide eye on the password boxes

- Every password box on the sign-in layer (login password, setup code, new password, repeat password) has an eye button: click to show what you typed, click again to hide it. Focus returns to the box; the typed value is never touched; the button is `type=button` so it can't submit the form.
- Boxes are hidden again whenever the screen switches between login and setup (including when the session expires and the screen comes back). A failed attempt clears the typed values but keeps your show/hide choice.
- Accessible: `aria-pressed`, "Show password" / "Hide password" label and tooltip, keyboard focus ring.
- Tests: eye 17/17; the full password flow suite 35/35 still passes; checked in real Chrome.
