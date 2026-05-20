-- ============================================================================
-- Data Migration: JSONB blobs → relational rows
-- Run AFTER 20260507_001_create_relational_finance_tables.sql
--
-- Reads from the *_jsonb_backup tables and inserts into the new relational tables.
-- Safe to run multiple times (uses ON CONFLICT DO NOTHING on id).
-- ============================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. COLLECTIONS INVOICES
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO public.collections_invoices (
  id, invoice_no, customer, project_name, invoice_date, submission_date,
  due_date, amount, tax, total, currency, exchange_rate, invoice_type,
  invoice_status, collection_status, payment_status, withholding_tax,
  last_follow_up, next_follow_up, notes, invoice_notes, pdf_data, pdf_name,
  created_at, updated_at
)
SELECT
  (d->>'id')::uuid,
  COALESCE(d->>'invoiceNo', ''),
  COALESCE(d->>'customer', ''),
  d->>'projectName',
  (d->>'invoiceDate')::date,
  (d->>'submissionDate')::date,
  (d->>'dueDate')::date,
  COALESCE((d->>'amount')::numeric, 0),
  COALESCE((d->>'tax')::numeric, 0),
  COALESCE((d->>'total')::numeric, 0),
  COALESCE(d->>'currency', 'EGP'),
  (d->>'exchangeRate')::numeric,
  d->>'invoiceType',
  COALESCE(d->>'invoiceStatus', 'Draft'),
  COALESCE(d->>'collectionStatus', 'Not Due'),
  COALESCE(d->>'paymentStatus', 'Unpaid'),
  (d->>'withholdingTax')::numeric,
  (d->>'lastFollowUp')::date,
  (d->>'nextFollowUp')::date,
  COALESCE(d->>'notes', ''),
  d->>'invoiceNotes',
  d->>'pdfData',
  d->>'pdfName',
  COALESCE(b.updated_at, now()),
  COALESCE(b.updated_at, now())
FROM public.collections_invoices_jsonb_backup b,
     LATERAL (SELECT b.data AS d) sub
ON CONFLICT (id) DO NOTHING;

-- Migrate nested payments
INSERT INTO public.collection_payments (
  id, invoice_id, receipt_date, amount_received, amount_received_egp,
  payment_currency, payment_method, reference_no, notes
)
SELECT
  (p->>'id')::uuid,
  (b.data->>'id')::uuid,
  (p->>'receiptDate')::date,
  COALESCE((p->>'amountReceived')::numeric, 0),
  (p->>'amountReceivedEgp')::numeric,
  p->>'paymentCurrency',
  COALESCE(p->>'paymentMethod', ''),
  COALESCE(p->>'referenceNo', ''),
  p->>'notes'
FROM public.collections_invoices_jsonb_backup b,
     jsonb_array_elements(b.data->'payments') AS p
WHERE b.data->'payments' IS NOT NULL
  AND jsonb_array_length(b.data->'payments') > 0
ON CONFLICT (id) DO NOTHING;

-- Migrate nested credit notes
INSERT INTO public.collection_credit_notes (
  id, invoice_id, date, pretax_amount, vat, withholding, amount, reason, reference_no
)
SELECT
  (cn->>'id')::uuid,
  (b.data->>'id')::uuid,
  (cn->>'date')::date,
  COALESCE((cn->>'pretaxAmount')::numeric, 0),
  COALESCE((cn->>'vat')::numeric, 0),
  COALESCE((cn->>'withholding')::numeric, 0),
  COALESCE((cn->>'amount')::numeric, 0),
  COALESCE(cn->>'reason', ''),
  cn->>'referenceNo'
FROM public.collections_invoices_jsonb_backup b,
     jsonb_array_elements(b.data->'creditNotes') AS cn
WHERE b.data->'creditNotes' IS NOT NULL
  AND jsonb_array_length(b.data->'creditNotes') > 0
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. PAYABLES INVOICES
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO public.payables_invoices (
  id, invoice_no, supplier, cost_center, invoice_date, due_date,
  amount, tax, total, invoice_type, withholding_tax, currency, exchange_rate,
  approval_status, payment_status, ap_status, approved_by, approved_at,
  rejection_reason, has_tax, notes, pdf_data, pdf_name,
  created_at, updated_at
)
SELECT
  (d->>'id')::uuid,
  COALESCE(d->>'invoiceNo', ''),
  COALESCE(d->>'supplier', ''),
  d->>'costCenter',
  (d->>'invoiceDate')::date,
  (d->>'dueDate')::date,
  COALESCE((d->>'amount')::numeric, 0),
  COALESCE((d->>'tax')::numeric, 0),
  COALESCE((d->>'total')::numeric, 0),
  d->>'invoiceType',
  (d->>'withholdingTax')::numeric,
  COALESCE(d->>'currency', 'EGP'),
  (d->>'exchangeRate')::numeric,
  COALESCE(d->>'approvalStatus', 'Draft'),
  COALESCE(d->>'paymentStatus', 'Unpaid'),
  COALESCE(d->>'apStatus', 'Not Due'),
  d->>'approvedBy',
  (d->>'approvedAt')::timestamptz,
  d->>'rejectionReason',
  COALESCE((d->>'hasTax')::boolean, false),
  COALESCE(d->>'notes', ''),
  d->>'pdfData',
  d->>'pdfName',
  COALESCE(b.updated_at, now()),
  COALESCE(b.updated_at, now())
FROM public.payables_invoices_jsonb_backup b,
     LATERAL (SELECT b.data AS d) sub
ON CONFLICT (id) DO NOTHING;

-- Migrate nested supplier payments
INSERT INTO public.payable_payments (
  id, invoice_id, payment_date, amount_paid, payment_currency,
  amount_paid_egp, payment_method, bank_name, reference_no, notes
)
SELECT
  (p->>'id')::uuid,
  (b.data->>'id')::uuid,
  (p->>'paymentDate')::date,
  COALESCE((p->>'amountPaid')::numeric, 0),
  p->>'paymentCurrency',
  (p->>'amountPaidEgp')::numeric,
  COALESCE(p->>'paymentMethod', ''),
  p->>'bankName',
  COALESCE(p->>'referenceNo', ''),
  p->>'notes'
FROM public.payables_invoices_jsonb_backup b,
     jsonb_array_elements(b.data->'payments') AS p
WHERE b.data->'payments' IS NOT NULL
  AND jsonb_array_length(b.data->'payments') > 0
ON CONFLICT (id) DO NOTHING;

-- Migrate nested deduction notes
INSERT INTO public.payable_deductions (
  id, invoice_id, date, pretax_amount, vat, withholding, amount, reason, reference_no
)
SELECT
  (dn->>'id')::uuid,
  (b.data->>'id')::uuid,
  (dn->>'date')::date,
  COALESCE((dn->>'pretaxAmount')::numeric, 0),
  COALESCE((dn->>'vat')::numeric, 0),
  COALESCE((dn->>'withholding')::numeric, 0),
  COALESCE((dn->>'amount')::numeric, 0),
  COALESCE(dn->>'reason', ''),
  dn->>'referenceNo'
FROM public.payables_invoices_jsonb_backup b,
     jsonb_array_elements(b.data->'deductions') AS dn
WHERE b.data->'deductions' IS NOT NULL
  AND jsonb_array_length(b.data->'deductions') > 0
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. JOURNAL ENTRIES
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO public.journal_entries (
  id, journal_number, entry_type, source_module, source_document_no,
  source_document_id, reference_no, entry_date, posting_date, fiscal_period,
  currency, exchange_rate, description, status, auto_generated_flag,
  reversal_of_entry_id, created_by, approved_by, approved_at,
  posted_by, posted_at, created_at, updated_at
)
SELECT
  (d->>'id')::uuid,
  COALESCE(d->>'journal_number', ''),
  COALESCE(d->>'entry_type', 'يدوي'),
  COALESCE(d->>'source_module', 'يدوي'),
  d->>'source_document_no',
  d->>'source_document_id',
  d->>'reference_no',
  COALESCE((d->>'entry_date')::date, CURRENT_DATE),
  (d->>'posting_date')::date,
  d->>'fiscal_period',
  COALESCE(d->>'currency', 'EGP'),
  (d->>'exchange_rate')::numeric,
  COALESCE(d->>'description', ''),
  COALESCE(d->>'status', 'Draft'),
  COALESCE((d->>'auto_generated_flag')::boolean, false),
  CASE WHEN d->>'reversal_of_entry_id' IS NOT NULL AND d->>'reversal_of_entry_id' <> ''
       THEN (d->>'reversal_of_entry_id')::uuid ELSE NULL END,
  COALESCE(d->>'created_by', ''),
  d->>'approved_by',
  (d->>'approved_at')::timestamptz,
  d->>'posted_by',
  (d->>'posted_at')::timestamptz,
  COALESCE((d->>'created_at')::timestamptz, b.updated_at, now()),
  COALESCE(b.updated_at, now())
FROM public.journal_entries_jsonb_backup b,
     LATERAL (SELECT b.data AS d) sub
ON CONFLICT (id) DO NOTHING;

-- Migrate nested lines
INSERT INTO public.journal_entry_lines (
  entry_id, line_no, account_code, account_name, cost_center, branch,
  project, customer_id, supplier_id, line_description, debit_amount,
  credit_amount, tax_code, due_date, reference_1, reference_2
)
SELECT
  (b.data->>'id')::uuid,
  COALESCE((ln->>'line_no')::int, 0),
  COALESCE(ln->>'account_code', ''),
  COALESCE(ln->>'account_name', ''),
  ln->>'cost_center',
  ln->>'branch',
  ln->>'project',
  ln->>'customer_id',
  ln->>'supplier_id',
  COALESCE(ln->>'line_description', ''),
  COALESCE((ln->>'debit_amount')::numeric, 0),
  COALESCE((ln->>'credit_amount')::numeric, 0),
  ln->>'tax_code',
  (ln->>'due_date')::date,
  ln->>'reference_1',
  ln->>'reference_2'
FROM public.journal_entries_jsonb_backup b,
     jsonb_array_elements(b.data->'lines') AS ln
WHERE b.data->'lines' IS NOT NULL
  AND jsonb_array_length(b.data->'lines') > 0;

-- Migrate nested approval history
INSERT INTO public.journal_approval_history (
  id, entry_id, action, performed_by, performed_at, comment
)
SELECT
  (ah->>'id')::uuid,
  (b.data->>'id')::uuid,
  ah->>'action',
  COALESCE(ah->>'performed_by', ''),
  COALESCE((ah->>'performed_at')::timestamptz, now()),
  ah->>'comment'
FROM public.journal_entries_jsonb_backup b,
     jsonb_array_elements(b.data->'approval_history') AS ah
WHERE b.data->'approval_history' IS NOT NULL
  AND jsonb_array_length(b.data->'approval_history') > 0
ON CONFLICT (id) DO NOTHING;

-- Migrate nested attachments
INSERT INTO public.journal_attachments (
  entry_id, name, size
)
SELECT
  (b.data->>'id')::uuid,
  COALESCE(att->>'name', ''),
  COALESCE(att->>'size', '')
FROM public.journal_entries_jsonb_backup b,
     jsonb_array_elements(b.data->'attachments') AS att
WHERE b.data->'attachments' IS NOT NULL
  AND jsonb_array_length(b.data->'attachments') > 0;

COMMIT;
