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

- **Only `public/` is served** (`vercel.json` → `outputDirectory`). SQL, docs and server code are never reachable by URL; unknown URLs show a plain 404 page.
- The browser **never holds a database key**. All reads/writes go through the app's own `/api` functions on Vercel, which use the Supabase **service-role** key (server-side env var only). The tables have RLS on with no policies and no grants for `anon`/`authenticated`, so the public key can't read or write anything (see [`schema.sql`](./schema.sql)).
- **One site password, created on the first visit and then permanent.** The very first visit asks for the `SETUP_CODE` (a phrase only you know, set in Vercel) plus the password you choose. It is stored only as a scrypt hash in the `auth_state` table. After that, setup is closed for good and everyone enters that password.
- A signed, `HttpOnly`, `SameSite=Strict` cookie keeps you signed in (`SESSION_HOURS`, default 24h), bound to the browser's device id. The signing key is derived from the service-role key.
- **Rate limiting:** 5 wrong attempts (password *or* setup code) from one IP or one device in 15 minutes locks that IP/device for the rest of the window; 20 in 24h auto-blocks it for 24h. IPv6 is tracked per /64.
- **Blocking:** **Security & sign out** (sidebar, or the shield icon on mobile) shows recent sign-in attempts and lets you block/unblock an IP or device (forever or for N hours). A blocked IP/device is also cut off mid-session.
- **Forgot the password?** There is no email reset (the password is permanent by design). To start over: Supabase → Table Editor → `auth_state` → delete the row with key `password_hash`. Every old session stops working and the first-time setup screen appears again (it still needs the `SETUP_CODE`).
- Login fails closed: if the database can't be reached (e.g. paused), nobody can sign in.
- Limits to know: a device id is a per-browser random id, so it only stops casual attackers (clearing site data gives a new one) — the IP rules and rate limits are the real backstop. The per-request limiter (240/min per IP) is in-memory, best effort per serverless instance.
- **Rotate your Supabase keys** if an earlier version of this app was ever deployed: its anon key was public.

---

## 🗄️ Setup (Supabase + Vercel)

1. Create a free project at [supabase.com](https://supabase.com) (or restore a paused one: dashboard → project → **Restore project**).
2. **SQL Editor** → run all of [`schema.sql`](./schema.sql). It is idempotent — re-run it on an existing project to add the security tables **and remove the old open anon policies**.
3. In **Vercel → Project → Settings → Environment Variables** add (see [`.env.example`](./.env.example)):
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API → *service_role* / secret key), and `SETUP_CODE` (any long phrase you choose). Optional: `CRON_SECRET` (for the keep-alive job), `SESSION_HOURS`. Redeploy.
4. Open your site. It shows **Create your password**: enter the `SETUP_CODE` and your new password (12+ characters). That's it — from now on the site asks for that password.
5. Deploy order for an existing install: **deploy the new code first, then run `schema.sql`** — the old frontend stops working the moment the anon policies are dropped.

**Local dev:** with a plain static server (`python -m http.server --directory public`) there is no `/api`, so the app runs on browser localStorage with no password. To test the real flow use `vercel dev` with the env vars above in a `.env` file.

### Supabase free tier pauses after 7 days of inactivity
[`api/keepalive.js`](./api/keepalive.js) runs daily via Vercel Cron (`vercel.json`) and touches the database so it doesn't pause — it needs `CRON_SECRET` set. If a project is **already paused**: Supabase dashboard → select the project → **Restore project** (data is kept for 90 days after pausing). The sidebar badge shows **🔴 Cloud unreachable** while the database can't be reached.

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
