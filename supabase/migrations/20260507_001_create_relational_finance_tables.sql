-- ============================================================================
-- Migration: JSONB blob → relational tables for finance modules
-- Date: 2026-05-07
-- Modules: Collections (AR), Payables (AP), Journal Entries (GL)
--
-- IMPORTANT: This migration does NOT drop the old JSONB columns/tables.
--            Old tables (collections_invoices, payables_invoices, journal_entries)
--            remain intact as backup until manual verification.
-- ============================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. COLLECTIONS (Accounts Receivable)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Rename old table to preserve as backup
ALTER TABLE IF EXISTS public.collections_invoices
  RENAME TO collections_invoices_jsonb_backup;

CREATE TABLE public.collections_invoices (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no      text        NOT NULL DEFAULT '',
  customer        text        NOT NULL DEFAULT '',
  project_name    text,
  invoice_date    date,
  submission_date date,
  due_date        date,
  amount          numeric(15,2) NOT NULL DEFAULT 0,
  tax             numeric(15,2) NOT NULL DEFAULT 0,
  total           numeric(15,2) NOT NULL DEFAULT 0,
  currency        text        NOT NULL DEFAULT 'EGP' CHECK (currency IN ('EGP','USD')),
  exchange_rate   numeric(10,4),
  invoice_type    text,                           -- 'توريدات' | 'خدمات'
  invoice_status  text        NOT NULL DEFAULT 'Draft'
                              CHECK (invoice_status IN ('Draft','Approved','Sent','Cancelled')),
  collection_status text      NOT NULL DEFAULT 'Not Due'
                              CHECK (collection_status IN ('Not Due','Due','Overdue','Partially Paid','Paid','Disputed')),
  payment_status  text        NOT NULL DEFAULT 'Unpaid'
                              CHECK (payment_status IN ('Unpaid','Partial','Paid')),
  withholding_tax numeric(15,2),
  last_follow_up  date,
  next_follow_up  date,
  notes           text        NOT NULL DEFAULT '',
  invoice_notes   text,
  pdf_data        text,                           -- base64 encoded PDF
  pdf_name        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_collections_invoices_customer     ON public.collections_invoices (customer);
CREATE INDEX idx_collections_invoices_status        ON public.collections_invoices (collection_status);
CREATE INDEX idx_collections_invoices_due_date      ON public.collections_invoices (due_date);
CREATE INDEX idx_collections_invoices_payment_status ON public.collections_invoices (payment_status);
CREATE INDEX idx_collections_invoices_updated_at    ON public.collections_invoices (updated_at DESC);

-- Child: payments on receivable invoices
CREATE TABLE public.collection_payments (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        uuid        NOT NULL REFERENCES public.collections_invoices(id) ON DELETE CASCADE,
  receipt_date      date        NOT NULL,
  amount_received   numeric(15,2) NOT NULL DEFAULT 0,
  amount_received_egp numeric(15,2),
  payment_currency  text        CHECK (payment_currency IN ('EGP','USD')),
  payment_method    text        NOT NULL DEFAULT '',
  reference_no      text        NOT NULL DEFAULT '',
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_collection_payments_invoice ON public.collection_payments (invoice_id);

-- Child: credit notes on receivable invoices
CREATE TABLE public.collection_credit_notes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      uuid        NOT NULL REFERENCES public.collections_invoices(id) ON DELETE CASCADE,
  date            date        NOT NULL,
  pretax_amount   numeric(15,2) NOT NULL DEFAULT 0,
  vat             numeric(15,2) NOT NULL DEFAULT 0,
  withholding     numeric(15,2) NOT NULL DEFAULT 0,
  amount          numeric(15,2) NOT NULL DEFAULT 0,
  reason          text        NOT NULL DEFAULT '',
  reference_no    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_collection_credit_notes_invoice ON public.collection_credit_notes (invoice_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. PAYABLES (Accounts Payable)
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE IF EXISTS public.payables_invoices
  RENAME TO payables_invoices_jsonb_backup;

CREATE TABLE public.payables_invoices (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no        text        NOT NULL DEFAULT '',
  supplier          text        NOT NULL DEFAULT '',
  cost_center       text,
  invoice_date      date,
  due_date          date,
  amount            numeric(15,2) NOT NULL DEFAULT 0,
  tax               numeric(15,2) NOT NULL DEFAULT 0,
  total             numeric(15,2) NOT NULL DEFAULT 0,
  invoice_type      text,                           -- 'توريدات' | 'خدمات' | 'أصول' | 'مصروفات تشغيل'
  withholding_tax   numeric(15,2),
  currency          text        NOT NULL DEFAULT 'EGP' CHECK (currency IN ('EGP','USD')),
  exchange_rate     numeric(10,4),
  approval_status   text        NOT NULL DEFAULT 'Draft'
                                CHECK (approval_status IN ('Draft','Pending','Approved','Rejected')),
  payment_status    text        NOT NULL DEFAULT 'Unpaid'
                                CHECK (payment_status IN ('Unpaid','Partial','Paid')),
  ap_status         text        NOT NULL DEFAULT 'Not Due'
                                CHECK (ap_status IN ('Not Due','Due','Overdue','Partially Paid','Paid','On Hold')),
  approved_by       text,
  approved_at       timestamptz,
  rejection_reason  text,
  has_tax           boolean     DEFAULT false,
  notes             text        NOT NULL DEFAULT '',
  pdf_data          text,
  pdf_name          text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_payables_invoices_status      ON public.payables_invoices (ap_status);
CREATE INDEX idx_payables_invoices_due_date    ON public.payables_invoices (due_date);
CREATE INDEX idx_payables_invoices_supplier    ON public.payables_invoices (supplier);
CREATE INDEX idx_payables_invoices_approval    ON public.payables_invoices (approval_status);
CREATE INDEX idx_payables_invoices_updated_at  ON public.payables_invoices (updated_at DESC);

-- Child: payments on payable invoices
CREATE TABLE public.payable_payments (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        uuid        NOT NULL REFERENCES public.payables_invoices(id) ON DELETE CASCADE,
  payment_date      date        NOT NULL,
  amount_paid       numeric(15,2) NOT NULL DEFAULT 0,
  payment_currency  text        CHECK (payment_currency IN ('EGP','USD')),
  amount_paid_egp   numeric(15,2),
  payment_method    text        NOT NULL DEFAULT '',   -- 'تحويل بنكي' | 'شيك' | 'خصم مباشر' | 'نقدي' | 'أخرى'
  bank_name         text,
  reference_no      text        NOT NULL DEFAULT '',
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_payable_payments_invoice ON public.payable_payments (invoice_id);

-- Child: deduction notes on payable invoices
CREATE TABLE public.payable_deductions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      uuid        NOT NULL REFERENCES public.payables_invoices(id) ON DELETE CASCADE,
  date            date        NOT NULL,
  pretax_amount   numeric(15,2) NOT NULL DEFAULT 0,
  vat             numeric(15,2) NOT NULL DEFAULT 0,
  withholding     numeric(15,2) NOT NULL DEFAULT 0,
  amount          numeric(15,2) NOT NULL DEFAULT 0,
  reason          text        NOT NULL DEFAULT '',
  reference_no    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_payable_deductions_invoice ON public.payable_deductions (invoice_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. JOURNAL ENTRIES (General Ledger)
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE IF EXISTS public.journal_entries
  RENAME TO journal_entries_jsonb_backup;

CREATE TABLE public.journal_entries (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_number        text        NOT NULL DEFAULT '',
  entry_type            text        NOT NULL DEFAULT 'يدوي',
  source_module         text        NOT NULL DEFAULT 'يدوي',
  source_document_no    text,
  source_document_id    text,
  reference_no          text,
  entry_date            date        NOT NULL DEFAULT CURRENT_DATE,
  posting_date          date,
  fiscal_period         text,
  currency              text        NOT NULL DEFAULT 'EGP' CHECK (currency IN ('EGP','USD')),
  exchange_rate         numeric(10,4),
  description           text        NOT NULL DEFAULT '',
  status                text        NOT NULL DEFAULT 'Draft'
                                    CHECK (status IN ('Draft','Pending Approval','Approved','Posted','Reversed','Cancelled')),
  auto_generated_flag   boolean     NOT NULL DEFAULT false,
  reversal_of_entry_id  uuid,
  created_by            text        NOT NULL DEFAULT '',
  approved_by           text,
  approved_at           timestamptz,
  posted_by             text,
  posted_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_journal_entries_entry_date    ON public.journal_entries (entry_date);
CREATE INDEX idx_journal_entries_account_code  ON public.journal_entries (status);
CREATE INDEX idx_journal_entries_reference     ON public.journal_entries (reference_no);
CREATE INDEX idx_journal_entries_source_module ON public.journal_entries (source_module);
CREATE INDEX idx_journal_entries_updated_at    ON public.journal_entries (updated_at DESC);

-- Child: journal entry lines (double-entry ledger rows)
CREATE TABLE public.journal_entry_lines (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id          uuid        NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  line_no           int         NOT NULL,
  account_code      text        NOT NULL DEFAULT '',
  account_name      text        NOT NULL DEFAULT '',
  cost_center       text,
  branch            text,
  project           text,
  customer_id       text,
  supplier_id       text,
  line_description  text        NOT NULL DEFAULT '',
  debit_amount      numeric(15,2) NOT NULL DEFAULT 0,
  credit_amount     numeric(15,2) NOT NULL DEFAULT 0,
  tax_code          text,
  due_date          date,
  reference_1       text,
  reference_2       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_journal_entry_lines_entry        ON public.journal_entry_lines (entry_id);
CREATE INDEX idx_journal_entry_lines_account_code ON public.journal_entry_lines (account_code);

-- Child: approval history
CREATE TABLE public.journal_approval_history (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id        uuid        NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  action          text        NOT NULL CHECK (action IN ('submitted','approved','rejected','posted','reversed')),
  performed_by    text        NOT NULL DEFAULT '',
  performed_at    timestamptz NOT NULL DEFAULT now(),
  comment         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_journal_approval_history_entry ON public.journal_approval_history (entry_id);

-- Child: attachments
CREATE TABLE public.journal_attachments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id        uuid        NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  name            text        NOT NULL DEFAULT '',
  size            text        NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_journal_attachments_entry ON public.journal_attachments (entry_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. ROW LEVEL SECURITY (matching original permissive policies)
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.collections_invoices       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_credit_notes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payables_invoices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payable_payments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payable_deductions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entry_lines        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_approval_history   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_attachments        ENABLE ROW LEVEL SECURITY;

CREATE POLICY "collections_invoices_all"      ON public.collections_invoices     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "collection_payments_all"       ON public.collection_payments      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "collection_credit_notes_all"   ON public.collection_credit_notes  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "payables_invoices_all"         ON public.payables_invoices        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "payable_payments_all"          ON public.payable_payments         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "payable_deductions_all"        ON public.payable_deductions       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "journal_entries_all"           ON public.journal_entries           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "journal_entry_lines_all"       ON public.journal_entry_lines      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "journal_approval_history_all"  ON public.journal_approval_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "journal_attachments_all"       ON public.journal_attachments      FOR ALL USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. updated_at TRIGGER (auto-set on UPDATE)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_collections_invoices_updated_at    BEFORE UPDATE ON public.collections_invoices    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_collection_payments_updated_at     BEFORE UPDATE ON public.collection_payments     FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_collection_credit_notes_updated_at BEFORE UPDATE ON public.collection_credit_notes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_payables_invoices_updated_at       BEFORE UPDATE ON public.payables_invoices       FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_payable_payments_updated_at        BEFORE UPDATE ON public.payable_payments        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_payable_deductions_updated_at      BEFORE UPDATE ON public.payable_deductions      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_journal_entries_updated_at         BEFORE UPDATE ON public.journal_entries          FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_journal_entry_lines_updated_at     BEFORE UPDATE ON public.journal_entry_lines     FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
