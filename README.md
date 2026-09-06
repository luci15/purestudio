# Pure Studio - Client & Revenue Ledger

A fast, lightweight studio management and invoicing application with PDF generation, client management, and Supabase cloud persistence.

## 🚀 Features

- **Invoicing & Ledger**: Create, manage, and track invoices and client records.
- **Client-side PDF Generation**: Generates high-contrast, printable A4 GST invoices on-the-fly using `jsPDF` and `html2pdf.js` with zero cloud storage cost.
- **Cloud Sync & Multi-Device Backup**: Powered by **Supabase** PostgreSQL with real-time updates across phone and desktop.
- **Offline / Local Storage Fallback**: Works immediately out of the box with browser storage if Supabase credentials are not provided.

---

## 🗄️ Setting Up Supabase (2 Minutes)

1. Create a free project at [supabase.com](https://supabase.com).
2. Go to **SQL Editor** in your Supabase dashboard and run the queries inside [`schema.sql`](./schema.sql).
3. Copy your **Project URL** and **Anon Public Key** from **Project Settings > API**.
4. You can configure credentials in either of two ways:
   - **Method A (App UI)**: Click **Business & bank details** in the Pure Studio sidebar, scroll to **Cloud Sync (Supabase)**, paste your URL and Anon Key, and click **Save**.
   - **Method B (`config.js`)**: Open [`config.js`](./config.js) and paste your credentials:
     ```javascript
     window.SUPABASE_CONFIG = {
       url: 'https://your-project.supabase.co',
       anonKey: 'your-anon-key'
     };
     ```

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
