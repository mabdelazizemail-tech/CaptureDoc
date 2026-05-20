// ============================================================================
// Shared TypeScript types for relational finance tables
// Maps 1:1 to the PostgreSQL schema in 20260507_001_create_relational_finance_tables.sql
// ============================================================================

// ─── Collections (Accounts Receivable) ──────────────────────────────────────

export type InvoiceStatus = 'Draft' | 'Approved' | 'Sent' | 'Cancelled';
export type CollectionStatus = 'Not Due' | 'Due' | 'Overdue' | 'Partially Paid' | 'Paid' | 'Disputed';
export type PaymentStatus = 'Unpaid' | 'Partial' | 'Paid';
export type Currency = 'EGP' | 'USD';

export interface CollectionPaymentRow {
  id: string;
  invoice_id: string;
  receipt_date: string;
  amount_received: number;
  amount_received_egp: number | null;
  payment_currency: Currency | null;
  payment_method: string;
  reference_no: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CollectionCreditNoteRow {
  id: string;
  invoice_id: string;
  date: string;
  pretax_amount: number;
  vat: number;
  withholding: number;
  amount: number;
  reason: string;
  reference_no: string | null;
  created_at: string;
  updated_at: string;
}

export interface CollectionInvoiceRow {
  id: string;
  invoice_no: string;
  customer: string;
  project_name: string | null;
  invoice_date: string | null;
  submission_date: string | null;
  due_date: string | null;
  amount: number;
  tax: number;
  total: number;
  currency: Currency;
  exchange_rate: number | null;
  invoice_type: string | null;
  invoice_status: InvoiceStatus;
  collection_status: CollectionStatus;
  payment_status: PaymentStatus;
  withholding_tax: number | null;
  last_follow_up: string | null;
  next_follow_up: string | null;
  notes: string;
  invoice_notes: string | null;
  pdf_data: string | null;
  pdf_name: string | null;
  created_at: string;
  updated_at: string;
  // Joined children (populated by storage layer)
  collection_payments?: CollectionPaymentRow[];
  collection_credit_notes?: CollectionCreditNoteRow[];
}

// ─── Payables (Accounts Payable) ────────────────────────────────────────────

export type ApprovalStatus = 'Draft' | 'Pending' | 'Approved' | 'Rejected';
export type APStatus = 'Not Due' | 'Due' | 'Overdue' | 'Partially Paid' | 'Paid' | 'On Hold';
export type PayableInvoiceType = 'توريدات' | 'خدمات' | 'أصول' | 'مصروفات تشغيل';
export type PayablePaymentMethod = 'تحويل بنكي' | 'شيك' | 'خصم مباشر' | 'نقدي' | 'أخرى';

export interface PayablePaymentRow {
  id: string;
  invoice_id: string;
  payment_date: string;
  amount_paid: number;
  payment_currency: Currency | null;
  amount_paid_egp: number | null;
  payment_method: string;
  bank_name: string | null;
  reference_no: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayableDeductionRow {
  id: string;
  invoice_id: string;
  date: string;
  pretax_amount: number;
  vat: number;
  withholding: number;
  amount: number;
  reason: string;
  reference_no: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayableInvoiceRow {
  id: string;
  invoice_no: string;
  supplier: string;
  cost_center: string | null;
  invoice_date: string | null;
  due_date: string | null;
  amount: number;
  tax: number;
  total: number;
  invoice_type: string | null;
  withholding_tax: number | null;
  currency: Currency;
  exchange_rate: number | null;
  approval_status: ApprovalStatus;
  payment_status: PaymentStatus;
  ap_status: APStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  has_tax: boolean;
  notes: string;
  pdf_data: string | null;
  pdf_name: string | null;
  eta_submission_date: string | null;
  created_at: string;
  updated_at: string;
  // Joined children
  payable_payments?: PayablePaymentRow[];
  payable_deductions?: PayableDeductionRow[];
}

// ─── Journal Entries (General Ledger) ───────────────────────────────────────

export type JEStatus = 'Draft' | 'Pending Approval' | 'Approved' | 'Posted' | 'Reversed' | 'Cancelled';
export type JEType =
  | 'يدوي'
  | 'فاتورة مبيعات'
  | 'تحصيل عميل'
  | 'فاتورة مورد'
  | 'سداد مورد'
  | 'إشعار دائن/مدين'
  | 'استحقاق/دفعة مقدمة'
  | 'قيد عكسي'
  | 'أرصدة افتتاحية'
  | 'تسوية نهاية السنة';
export type SourceModule = 'يدوي' | 'التحصيلات' | 'المدفوعات' | 'المحاسبة العامة';

export interface JournalEntryLineRow {
  id: string;
  entry_id: string;
  line_no: number;
  account_code: string;
  account_name: string;
  cost_center: string | null;
  branch: string | null;
  project: string | null;
  customer_id: string | null;
  supplier_id: string | null;
  line_description: string;
  debit_amount: number;
  credit_amount: number;
  tax_code: string | null;
  due_date: string | null;
  reference_1: string | null;
  reference_2: string | null;
  created_at: string;
  updated_at: string;
}

export interface JournalApprovalHistoryRow {
  id: string;
  entry_id: string;
  action: 'submitted' | 'approved' | 'rejected' | 'posted' | 'reversed';
  performed_by: string;
  performed_at: string;
  comment: string | null;
  created_at: string;
}

export interface JournalAttachmentRow {
  id: string;
  entry_id: string;
  name: string;
  size: string;
  created_at: string;
}

export interface JournalEntryRow {
  id: string;
  journal_number: string;
  entry_type: string;
  source_module: string;
  source_document_no: string | null;
  source_document_id: string | null;
  reference_no: string | null;
  entry_date: string;
  posting_date: string | null;
  fiscal_period: string | null;
  currency: Currency;
  exchange_rate: number | null;
  description: string;
  status: JEStatus;
  auto_generated_flag: boolean;
  reversal_of_entry_id: string | null;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  posted_by: string | null;
  posted_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined children
  journal_entry_lines?: JournalEntryLineRow[];
  journal_approval_history?: JournalApprovalHistoryRow[];
  journal_attachments?: JournalAttachmentRow[];
}
