# Pure Studio - Client & Revenue Ledger

A fast, lightweight studio management and invoicing application with PDF generation, client management, and Supabase cloud persistence.

## 🚀 Features

- **Expenses**: record any kind of cost (rent, software, travel, or a type you make up) with an amount, date and a **Paid / Unpaid** status in its own column. Click the status chip to flip it, filter by status or type, and see Total / Paid / Unpaid at the top.
- **Invoicing & Ledger**: Create, manage, and track GST invoices, payments received, and client records — kept separate from a lightweight Cash Dealings ledger.
- **GST done right**: CGST+SGST for in-state, IGST for out-of-state — never all three at once. Invoice numbers auto-increment (no manual entry); cash entries get their own independent sequence.
- **Client-side PDF Generation**: Generates high-contrast, printable A4 GST invoices on-the-fly using `html2pdf.js`, with WhatsApp/Email sharing, at zero cloud storage cost.
- **Cloud Sync & Multi-Device Backup**: Powered by **Supabase** PostgreSQL behind a password-protected API; other devices' changes appear within ~30s (polling), with an optimistic local write so the UI updates instantly even before the network round-trip completes.
- **Offline / Local Storage Fallback**: Works with plain browser storage (no login) when served without the `/api` functions, e.g. a static dev server.

---

## 🔐 Security model

- **Only `public/` is served** (`vercel.json` → `outputDirectory`). SQL, docs, scripts and server code are never reachable by URL; unknown URLs show a plain 404 page.

- The browser **never holds a database key**. All reads/writes go through the app's own `/api` functions on Vercel, which use the Supabase **service-role** key (server-side env var only).
- The Supabase tables have RLS enabled with **no policies** and no grants for `anon`/`authenticated` — the public key can't read or write anything (see [`schema.sql`](./schema.sql)).
- **Sign-in uses Supabase Auth** (email + password, **public sign-ups disabled**). Accounts: one or more **super admins** (the emails in `OWNER_EMAIL`, comma-separated, each with full access) plus optional staff a super admin creates in the app — **3 accounts max in total** by default (`MAX_USERS`; set it equal to the number of super admins for no staff). `/api/auth` checks the password with Supabase on the server, then issues its own signed, `HttpOnly`, `SameSite=Strict` session cookie bound to the browser's device id (`SESSION_HOURS`, default 24h). Supabase tokens never reach the browser.
- **Super admin vs staff:** staff can do everything in the billing app (clients, invoices, cash, business details) but **cannot** manage users or see Security/blocklist — enforced on the server, not just hidden. The super admin adds staff (user ID = email + an initial password they hand over), and can disable, re-enable, reset the password of, or remove them; a disabled/removed/reset user is signed out immediately. Super admin accounts can only be changed in Supabase (and `OWNER_EMAIL` in Vercel).
- **Forgot password:** "Forgot password?" on the sign-in screen emails a reset link (Supabase sends it) to the owner email. The answer is identical for any email, so it can't be used to discover the owner address. **Change password:** Security panel → needs the current password.
- Changing or resetting a password **signs that user out of their other devices** (others are unaffected).
- Rate limiting: 5 wrong passwords per IP *or* per device in 15 min → locked for the rest of the window (also applies to guessing the "current password" when changing it); 20 in 24h → auto-blocked for 24h. IPv6 is tracked per /64.
- Blacklisting: **Security & sign out** (sidebar, or shield icon on mobile) lists recent sign-in attempts, lets you block/unblock an IP or device (permanently or for N hours), and shows auto-blocks. A blocked IP/device is also cut off mid-session.
- Limits to know: a device id is a per-browser random id, so it only stops casual attackers (clearing site data gives a new one) — the IP rules and the rate limits are the real backstop. The per-request limiter (240/min per IP) is in-memory, best effort per serverless instance.
- Login fails closed: if the database or Supabase Auth can't be reached (e.g. paused), nobody can sign in.
- **Rotate your Supabase keys** if an earlier version of this app was ever deployed: its anon key was public. Anyone holding it could attack the Supabase Auth endpoint directly and skip this app's lockout.

---

## 🗄️ Setup (Supabase + Vercel)

1. Create a free project at [supabase.com](https://supabase.com) (or restore a paused one: dashboard → project → **Restore project**).
2. **SQL Editor** → run all of [`schema.sql`](./schema.sql). It is idempotent — re-run it on an existing project to add the security tables **and remove the old open anon policies**.
3. **Authentication → Sign In / Providers → Email:** make sure Email is enabled and turn **OFF "Allow new users to sign up"**.
4. **Authentication → Users → Add user → Create new user:** each **super admin** email + a strong password (12+ chars), tick **Auto Confirm User**. Put all their emails in `OWNER_EMAIL`, separated by commas. Staff (optional) are added later from the app: **Account & security → Users**.
5. **Authentication → URL Configuration:** set **Site URL** to your Vercel URL and add it under **Redirect URLs** (needed for the reset-password email link to come back to the app).
6. Generate the random secrets: `node scripts/setup-auth.js` (prints `SESSION_SECRET` and `CRON_SECRET`).
7. In **Vercel → Project → Settings → Environment Variables** add (see [`.env.example`](./.env.example)): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API), `OWNER_EMAIL`, `SESSION_SECRET`, `CRON_SECRET`, optional `SITE_URL`, `MAX_USERS`. Redeploy.
8. Deploy order for an existing install: **deploy the new code first, then run `schema.sql`** — the old frontend stops working the moment the anon policies are dropped.

Supabase's built-in email sender is rate-limited (a few emails per hour) — plenty for one owner. For reliable delivery set up custom SMTP in Supabase → Authentication → SMTP Settings.

**Local dev:** with a plain static server (`python -m http.server`) there is no `/api`, so the app runs on browser localStorage with no login. To test the real flow use `vercel dev` with the env vars above in a `.env` file.

### Supabase free tier pauses after 7 days of inactivity
[`api/keepalive.js`](./api/keepalive.js) runs daily via Vercel Cron (`vercel.json`) and touches the database so it doesn't pause — it needs `CRON_SECRET` set. If a project is **already paused**: Supabase dashboard → select the project → **Restore project** (data is kept for 90 days after pausing; after that only a backup download is possible). The sidebar badge shows **🔴 Cloud unreachable** while the database can't be reached.

---

## 🌐 Deploy to Vercel

1. Push your repository to GitHub (`https://github.com/luci15/purestudio.git`).
2. Go to [vercel.com](https://vercel.com) and click **Add New > Project**.
3. Select your GitHub repository and click **Deploy**.
4. Add the environment variables from the Setup section above and redeploy.

---

## 📤 Push to GitHub

```bash
git init
git add .
git commit -m "Add Supabase cloud sync, env config, and deployment setup"
git branch -M main
git remote add origin https://github.com/luci15/purestudio.git
git push -u origin main --force
```
