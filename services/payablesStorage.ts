import { supabase } from './supabaseClient';
import type {
  PayableInvoiceRow,
  PayablePaymentRow,
  PayableDeductionRow,
} from './financeTypes';

// ─── ETA Credentials (unchanged — uses app_settings table) ──────────────────

const SETTINGS_TABLE = 'app_settings';
const ETA_KEYS = ['eta_client_id', 'eta_client_sec', 'eta_client_sec2'] as const;
type EtaCredsKey = typeof ETA_KEYS[number];

export async function loadEtaCreds(): Promise<Record<EtaCredsKey, string>> {
  const { data } = await supabase
    .from(SETTINGS_TABLE)
    .select('key, value')
    .in('key', ETA_KEYS as unknown as string[]);
  const result = { eta_client_id: '', eta_client_sec: '', eta_client_sec2: '' };
  for (const row of data ?? []) result[row.key as EtaCredsKey] = row.value;
  return result;
}

export async function saveEtaCreds(creds: Partial<Record<EtaCredsKey, string>>): Promise<void> {
  const rows = Object.entries(creds).map(([key, value]) => ({
    key,
    value: value ?? '',
    updated_at: new Date().toISOString(),
  }));
  if (!rows.length) return;
  const { error } = await supabase.from(SETTINGS_TABLE).upsert(rows);
  if (error) console.error('[settings] save failed:', error);
}

// ─── Adapter types (camelCase used by PayablesDashboard.tsx) ────────────────

interface SupplierPayment {
  id: string;
  paymentDate: string;
  amountPaid: number;
  paymentCurrency?: 'EGP' | 'USD';
  amountPaidEgp?: number;
  paymentMethod: string;
  bankName?: string;
  referenceNo: string;
  notes?: string;
}

interface DeductionNote {
  id: string;
  date: string;
  pretaxAmount: number;
  vat: number;
  withholding: number;
  amount: number;
  reason: string;
  referenceNo?: string;
}

interface PayableInvoice {
  id: string;
  invoiceNo: string;
  supplier: string;
  costCenter?: string;
  invoiceDate: string;
  dueDate: string;
  amount: number;
  tax: number;
  total: number;
  invoiceType: string;
  withholdingTax?: number;
  approvalStatus: string;
  paymentStatus: string;
  apStatus: string;
  currency: 'EGP' | 'USD';
  exchangeRate?: number;
  payments: SupplierPayment[];
  deductions?: DeductionNote[];
  notes: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
  hasTax?: boolean;
  pdfData?: string;
  pdfName?: string;
  etaSubmissionDate?: string;
}

// ─── Row → camelCase converters ─────────────────────────────────────────────

function paymentFromRow(r: PayablePaymentRow): SupplierPayment {
  return {
    id: r.id,
    paymentDate: r.payment_date,
    amountPaid: r.amount_paid,
    paymentCurrency: r.payment_currency ?? undefined,
    amountPaidEgp: r.amount_paid_egp ?? undefined,
    paymentMethod: r.payment_method,
    bankName: r.bank_name ?? undefined,
    referenceNo: r.reference_no,
    notes: r.notes ?? undefined,
  };
}

function deductionFromRow(r: PayableDeductionRow): DeductionNote {
  return {
    id: r.id,
    date: r.date,
    pretaxAmount: r.pretax_amount,
    vat: r.vat,
    withholding: r.withholding,
    amount: r.amount,
    reason: r.reason,
    referenceNo: r.reference_no ?? undefined,
  };
}

function invoiceFromRow(r: PayableInvoiceRow): PayableInvoice {
  return {
    id: r.id,
    invoiceNo: r.invoice_no,
    supplier: r.supplier,
    costCenter: r.cost_center ?? undefined,
    invoiceDate: r.invoice_date ?? '',
    dueDate: r.due_date ?? '',
    amount: r.amount,
    tax: r.tax,
    total: r.total,
    invoiceType: r.invoice_type ?? '',
    withholdingTax: r.withholding_tax ?? undefined,
    currency: r.currency,
    exchangeRate: r.exchange_rate ?? undefined,
    approvalStatus: r.approval_status,
    paymentStatus: r.payment_status,
    apStatus: r.ap_status,
    approvedBy: r.approved_by ?? undefined,
    approvedAt: r.approved_at ?? undefined,
    rejectionReason: r.rejection_reason ?? undefined,
    hasTax: r.has_tax ?? undefined,
    notes: r.notes,
    pdfData: r.pdf_data ?? undefined,
    pdfName: r.pdf_name ?? undefined,
    etaSubmissionDate: r.eta_submission_date ?? undefined,
    payments: (r.payable_payments ?? []).map(paymentFromRow),
    deductions: (r.payable_deductions ?? []).map(deductionFromRow),
  };
}

// ─── camelCase → Row converters ─────────────────────────────────────────────

function invoiceToRow(inv: PayableInvoice): Omit<PayableInvoiceRow, 'created_at' | 'updated_at' | 'payable_payments' | 'payable_deductions'> {
  return {
    id: inv.id,
    invoice_no: inv.invoiceNo,
    supplier: inv.supplier,
    cost_center: inv.costCenter ?? null,
    invoice_date: inv.invoiceDate || null,
    due_date: inv.dueDate || null,
    amount: inv.amount,
    tax: inv.tax,
    total: inv.total,
    invoice_type: inv.invoiceType || null,
    withholding_tax: inv.withholdingTax ?? null,
    currency: inv.currency,
    exchange_rate: inv.exchangeRate ?? null,
    approval_status: inv.approvalStatus as PayableInvoiceRow['approval_status'],
    payment_status: inv.paymentStatus as PayableInvoiceRow['payment_status'],
    ap_status: inv.apStatus as PayableInvoiceRow['ap_status'],
    approved_by: inv.approvedBy ?? null,
    approved_at: inv.approvedAt ?? null,
    rejection_reason: inv.rejectionReason ?? null,
    has_tax: inv.hasTax ?? false,
    notes: inv.notes,
    pdf_data: inv.pdfData ?? null,
    pdf_name: inv.pdfName ?? null,
    eta_submission_date: inv.etaSubmissionDate ?? null,
  };
}

function paymentToRow(p: SupplierPayment, invoiceId: string): Omit<PayablePaymentRow, 'created_at' | 'updated_at'> {
  return {
    id: p.id,
    invoice_id: invoiceId,
    payment_date: p.paymentDate,
    amount_paid: p.amountPaid,
    payment_currency: p.paymentCurrency ?? null,
    amount_paid_egp: p.amountPaidEgp ?? null,
    payment_method: p.paymentMethod,
    bank_name: p.bankName ?? null,
    reference_no: p.referenceNo,
    notes: p.notes ?? null,
  };
}

function deductionToRow(dn: DeductionNote, invoiceId: string): Omit<PayableDeductionRow, 'created_at' | 'updated_at'> {
  return {
    id: dn.id,
    invoice_id: invoiceId,
    date: dn.date,
    pretax_amount: dn.pretaxAmount,
    vat: dn.vat,
    withholding: dn.withholding,
    amount: dn.amount,
    reason: dn.reason,
    reference_no: dn.referenceNo ?? null,
  };
}

// ─── Schema detection (cached) ──────────────────────────────────────────────

let schemaMode: 'relational' | 'jsonb' | null = null;

async function detectSchema(): Promise<'relational' | 'jsonb'> {
  if (schemaMode) return schemaMode;
  const { error } = await supabase
    .from('payables_invoices')
    .select('*, payable_payments(*), payable_deductions(*)')
    .limit(1);
  schemaMode = error ? 'jsonb' : 'relational';
  return schemaMode;
}

// ─── Public API (same signatures as before) ─────────────────────────────────

export async function loadPayables(): Promise<PayableInvoice[]> {
  const mode = await detectSchema();

  if (mode === 'jsonb') {
    const { data, error } = await supabase
      .from('payables_invoices')
      .select('data')
      .order('updated_at', { ascending: false });
    if (error) { console.error('[payables] load failed:', error); return []; }
    return (data ?? []).map((r: { data: PayableInvoice }) => r.data);
  }

  const { data, error } = await supabase
    .from('payables_invoices')
    .select('*, payable_payments(*), payable_deductions(*)')
    .order('updated_at', { ascending: false });
  if (error) {
    console.error('[payables] load failed:', error);
    return [];
  }
  return ((data ?? []) as PayableInvoiceRow[]).map(invoiceFromRow);
}

export async function upsertPayable(invoice: PayableInvoice): Promise<boolean> {
  const mode = await detectSchema();

  if (mode === 'jsonb') {
    const { error } = await supabase
      .from('payables_invoices')
      .upsert({ id: invoice.id, data: invoice, updated_at: new Date().toISOString() });
    if (error) { console.error('[payables] upsert failed:', error); return false; }
    return true;
  }

  const row = invoiceToRow(invoice);
  const { error } = await supabase.from('payables_invoices').upsert(row);
  if (error) { console.error('[payables] upsert failed:', error); return false; }

  let ok = true;

  // Sync payments
  await supabase.from('payable_payments').delete().eq('invoice_id', invoice.id);
  if (invoice.payments.length > 0) {
    const paymentRows = invoice.payments.map((p) => paymentToRow(p, invoice.id));
    const { error: pErr } = await supabase.from('payable_payments').insert(paymentRows);
    if (pErr) { console.error('[payables] payment sync failed:', pErr); ok = false; }
  }

  // Sync deductions
  const deds = invoice.deductions ?? [];
  await supabase.from('payable_deductions').delete().eq('invoice_id', invoice.id);
  if (deds.length > 0) {
    const dedRows = deds.map((d) => deductionToRow(d, invoice.id));
    const { error: dErr } = await supabase.from('payable_deductions').insert(dedRows);
    if (dErr) { console.error('[payables] deduction sync failed:', dErr); ok = false; }
  }

  return ok;
}

export async function deletePayables(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from('payables_invoices').delete().in('id', ids);
  if (error) console.error('[payables] delete failed:', error);
}
