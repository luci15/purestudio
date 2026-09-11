# Build Log

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
