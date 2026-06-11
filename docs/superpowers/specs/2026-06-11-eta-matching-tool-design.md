# أداة مطابقة المشتريات والمبيعات — Design Document

**Date:** 2026-06-11
**Status:** Approved for implementation (autonomous session — user review pending)

## 1. Problem

The user maintains `مطابقة المشتريات والمبيعات.xlsx` by hand: a single RTL table (Table1, A5:T63)
where each row pairs one **purchase invoice line** (supplier side, columns A–I) with the
**sales invoice line** that re-sold the same goods (customer side, columns J–T). The sheet computes:

- Per row: net = qty × price, VAT (14%), total, and quantity difference `T = E − N`.
- Row 4: `SUBTOTAL(9, …)` aggregates per column.
- `J2 = Q4 − H4` (sales VAT − purchase VAT = net VAT position), `R2 = R4 − I4` (gross difference).

Pain points observed in the actual file:

- Manual re-typing of invoices that already exist in Egypt's e-invoicing system (ETA).
- Inconsistent customer spellings (الفشاوي / الفيشاوي / الفيشاوى / احمد حسين عوض مرسى الفيشاوى وشريكه).
- Dates stored as text (`21/4`), composite cells (`33/35`, `=4800+4612`), quantity mismatches
  (2058 vs 2085), unmatched leftovers (purchase-only rows 55–56, sales-only rows 61–63).
- Credit notes tracked as a free-text note (`اشعار دائن`) in column S.

**Goal:** an Arabic-UI tool that pulls real invoices from ETA, auto-matches purchases to sales,
shows the same KPIs the sheet computes, and exports back to the exact same Excel layout.

## 2. Approaches considered

| # | Approach | Pros | Cons |
|---|----------|------|------|
| 1 | Excel VBA add-in | Stays inside Excel | VBA + OAuth/JSON fragile; poor Arabic UI tooling; untestable |
| 2 | Desktop app (Tkinter/PySide) | Native window | Tkinter bidi/RTL rendering is poor; PySide heavy; slower to iterate |
| 3 | **Local web app: FastAPI + SQLite + RTL HTML UI** ✅ | Browser renders Arabic RTL natively; Python handles ETA API + openpyxl; pytest-able; zero hosting (runs on localhost) | Requires Python on the machine (already present: 3.13) |

**Chosen: #3.** One `start.bat` starts the server and opens the browser. No build step (vanilla HTML/JS/CSS).

## 3. Architecture

```
C:\Software\PBK\
  app\
    main.py        FastAPI routes + static file serving
    db.py          SQLite schema, connection, migrations
    excel_io.py    Import existing workbook / export to identical layout
    matching.py    Arabic normalization + auto-match scoring engine
    eta_client.py  ETA identity + Documents API client (token cache, throttling, paging)
  static\
    index.html, app.js, style.css   (RTL Arabic SPA, no framework)
  tests\           pytest suites + ETA JSON fixtures
  data\pbk.db      runtime database (created on first run)
  start.bat        installs deps if missing, starts server, opens browser
  requirements.txt
```

## 4. Data model (SQLite)

- `settings(key TEXT PK, value TEXT)` — `eta_env` (`preprod`/`prod`), `eta_client_id`,
  `eta_client_secret`, `vat_rate` (default `0.14`).
- `purchase_lines(id, invoice_date, invoice_no, supplier, item, qty REAL, unit_price REAL,
  vat REAL, doc_type TEXT default 'i', source TEXT ('manual'|'excel'|'eta'), eta_uuid, eta_line_index,
  UNIQUE(eta_uuid, eta_line_index))` — net/total always derived (qty×price, net+vat), never stored.
- `sale_lines(...same... , customer, internal_ref /* فاتورة ا/رانيا */, note /* اشعار دائن etc */)`.
- `matches(id, purchase_line_id UNIQUE REFERENCES purchase_lines, sale_line_id UNIQUE REFERENCES sale_lines,
  note)` — strictly 1:1, mirroring the sheet's row semantics. Quantity differences are *displayed*,
  not blocked (the sheet's column T exists precisely to track them).

Credit notes (`typeName = 'c'`): imported with **negative** qty/VAT (accounting truth, keeps the
VAT position correct), badged «اشعار دائن» in the UI and written to column S on export.
Debit notes (`'d'`) stay positive, badged «اشعار مدين».

## 5. ETA integration

Verified against https://sdk.invoicing.eta.gov.eg :

- **Token:** `POST {id_base}/connect/token`, `Authorization: Basic base64(client_id:client_secret)`,
  body `grant_type=client_credentials&scope=InvoicingAPI`. Cached ~55 min (expires_in 3600).
  - prod: `https://id.eta.gov.eg` / preprod: `https://id.preprod.eta.gov.eg`
- **List:** `GET {api_base}/api/v1.0/documents/search?submissionDateFrom&submissionDateTo&direction&
  status=Valid&pageSize=100&continuationToken=…` — ≤30-day window per request (tool auto-chunks
  longer ranges), throttle ≥2s between calls, `continuationToken == "EndofResultSet"` ends paging.
  - prod: `https://api.invoicing.eta.gov.eg` / preprod: `https://api.preprod.invoicing.eta.gov.eg`
- **Lines:** `GET {api_base}/api/v1.0/documents/{uuid}/raw` (fallback `/details`) → `document.invoiceLines[]`:
  `description, quantity, unitValue.amountEGP, salesTotal, netTotal, total, taxableItems[{taxType, amount}]`.
  Line VAT = Σ `taxableItems` where `taxType == 'T1'`.
- **Mapping:** `direction=Received` → purchase_lines (issuerName → المورد);
  `direction=Sent` → sale_lines (receiverName → المشتري); `internalId` → invoice no;
  `dateTimeIssued` → date. Sync is idempotent (upsert on `(eta_uuid, line_index)`).
- Credentials live in local SQLite, plaintext, with a visible warning (machine-local tool).

## 6. Auto-matching engine

1. **Normalize** Arabic: strip diacritics/tatweel, unify أ/إ/آ→ا, ى→ي, ة→ه, drop punctuation,
   collapse whitespace (fixes الفشاوي/الفيشاوى class of mismatches for items too).
2. **Score** each unmatched (purchase, sale) pair:
   - Quantity: exact = 50; ≤2% relative diff = 35; ≤10% = 15; >25% = disqualify.
   - Item similarity (difflib on normalized text): 0–30.
   - Date proximity (|Δ| ≤ 60 days, decaying): 0–15. No ordering constraint — the real sheet
     contains sales dated *before* their purchase (rows 51–54).
   - Same doc polarity (both credit / both regular): +5.
3. Greedy best-score assignment, suggestions ≥ 55 shown with score and per-field diffs;
   user confirms one-by-one or «اعتماد الكل». Manual pairing always available.

## 7. Excel I/O

- **Import** (seed from the user's existing file): each Table1 row → purchase line (if A–F present)
  + sale line (if J–O present) + a match when both exist. Text dates (`21/4`) parsed with
  year inference; composite refs kept verbatim as text; `S` → sale note, `L` → internal_ref.
  Derived columns are recomputed, not trusted.
- **Export**: byte-faithful recreation of the template: RTL view, headers row 5 (exact strings,
  including trailing spaces in `الكمية ` / `القيمة المضافة `), Table1 over the data range, row-4
  `SUBTOTAL(9,…)` per column, `J2`/`R2` formulas, per-row formulas for G, I, P, R, T.
  VAT cells (H, Q): written as the **formula** `qty×price×rate` when the stored value equals it
  (±0.005) — i.e. all manual rows — otherwise the authoritative ETA value as a number.
  Number formats copied from the original (`#,##0_);[Red](#,##0)`, dates `mm-dd-yy`).
  Exported file must recalc with **zero formula errors**.

## 8. UI (Arabic, RTL, single page)

Tabs: **لوحة المتابعة** (KPI cards: صافي/ضريبة/إجمالي المشتريات والمبيعات، صافي ضريبة القيمة
المضافة J2، الفرق الإجمالي R2، عدّادات غير المرتبط وفروق الكميات) · **المطابقة** (unmatched
purchases | suggestions with scores | unmatched sales; matched pairs list with unlink) ·
**المشتريات** / **المبيعات** (filterable CRUD tables, source badges يدوي/Excel/ETA) ·
**مزامنة ETA** (date range, direction, progress log) · **الإعدادات** (environment, credentials,
VAT rate, اختبار الاتصال) · header actions: استيراد Excel، تصدير Excel.

System Arabic fonts (Segoe UI/Tahoma) — fully offline UI, no CDN.

## 9. Error handling

- ETA failures surface as Arabic messages with HTTP status + ETA error text; token refreshed on 401 once.
- Sync chunks >30-day ranges; throttles 2.1s; resumable because idempotent.
- Excel import never raises on a bad cell: collects per-row warnings, returns a report
  («تم استيراد 58 صفاً، 3 تحذيرات…»).
- All mutating APIs validate with pydantic; SQLite FK constraints ON.

## 10. Testing

- pytest: normalization + scorer; import of the real workbook (assert line counts and that
  recomputed totals reproduce the sheet's cached values E4/H4/I4/N4/P4/Q4/R4); export → reimport
  round-trip; ETA mapper on fixture JSON (invoice + credit note, T1 + non-T1 taxes).
- Smoke: start uvicorn, Playwright drive: dashboard renders, matching tab lists data, export
  endpoint returns a valid workbook (openpyxl re-open + formula sanity).

## 11. Out of scope (v1)

Document submission to ETA, eReceipts, multi-company, user accounts, DPAPI secret encryption,
N:M match splitting (sheet semantics are 1:1; quantity diffs are surfaced instead).
