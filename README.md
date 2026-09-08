# Pure Studio - Client & Revenue Ledger

A fast, lightweight studio management and invoicing application with PDF generation, client management, and Supabase cloud persistence.

## 🚀 Features

- **Invoicing & Ledger**: Create, manage, and track GST invoices, payments received, and client records — kept separate from a lightweight Cash Dealings ledger.
- **GST done right**: CGST+SGST for in-state, IGST for out-of-state — never all three at once. Invoice numbers auto-increment (no manual entry); cash entries get their own independent sequence.
- **Client-side PDF Generation**: Generates high-contrast, printable A4 GST invoices on-the-fly using `html2pdf.js`, with WhatsApp/Email sharing, at zero cloud storage cost.
- **Cloud Sync & Multi-Device Backup**: Powered by **Supabase** PostgreSQL with real-time updates across phone and desktop, with an optimistic local write so the UI updates instantly even before the network round-trip completes.
- **Offline / Local Storage Fallback**: Works immediately out of the box with browser storage if Supabase credentials are not provided.

---

## 🗄️ Setting Up Supabase (2 Minutes)

1. Create a free project at [supabase.com](https://supabase.com).
2. Go to **SQL Editor** in your Supabase dashboard and run the queries inside [`schema.sql`](./schema.sql) (includes the `cash_entries` table — re-run this if you set up Supabase before the Cash Dealings feature existed).
3. Copy your **Project URL** and **Anon Public Key** from **Project Settings > API**.
4. Configure credentials in either of two ways:
   - **Local / static hosting**: Open [`config.js`](./config.js) and paste your credentials:
     ```javascript
     window.SUPABASE_CONFIG = {
       url: 'https://your-project.supabase.co',
       anonKey: 'your-anon-key'
     };
     ```
   - **Vercel**: set `SUPABASE_URL` and `SUPABASE_ANON_KEY` as Environment Variables in the Vercel project settings — [`api/config.js`](./api/config.js) serves them to the app at runtime, so `config.js` can stay blank.

---

## 🌐 Deploy to Vercel

1. Push your repository to GitHub (`https://github.com/luci15/purestudio.git`).
2. Go to [vercel.com](https://vercel.com) and click **Add New > Project**.
3. Select your GitHub repository and click **Deploy**.
4. (Optional) In Vercel Project Settings > Environment Variables, you can add `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

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
