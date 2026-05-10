import { supabase } from './supabaseClient';
import type {
  CollectionInvoiceRow,
  CollectionPaymentRow,
  CollectionCreditNoteRow,
} from './financeTypes';

// ─── Adapter types (camelCase used by dashboard UI) ─────────────────────────
// These match the existing interfaces in CollectionsDashboard.tsx exactly,
// so the dashboard code requires zero changes.

interface Payment {
  id: string;
  receiptDate: string;
  amountReceived: number;
  amountReceivedEgp?: number;
  paymentCurrency?: 'EGP' | 'USD';
  paymentMethod: string;
  referenceNo: string;
  notes?: string;
}

interface CreditNote {
  id: string;
  date: string;
  pretaxAmount: number;
  vat: number;
  withholding: number;
  amount: number;
  reason: string;
  referenceNo?: string;
}

interface Invoice {
  id: string;
  invoiceNo: string;
  customer: string;
  projectName?: string;
  invoiceDate: string;
  submissionDate?: string;
  dueDate: string;
  amount: number;
  tax: number;
  total: number;
  invoiceStatus: string;
  collectionStatus: string;
  paymentStatus: string;
  lastFollowUp: string;
  nextFollowUp: string;
  notes: string;
  payments: Payment[];
  pdfData?: string;
  pdfName?: string;
  currency?: 'EGP' | 'USD';
  exchangeRate?: number;
  invoiceType?: string;
  withholdingTax?: number;
  invoiceNotes?: string;
  creditNotes?: CreditNote[];
}

// ─── Row → camelCase converters ─────────────────────────────────────────────

function paymentFromRow(r: CollectionPaymentRow): Payment {
  return {
    id: r.id,
    receiptDate: r.receipt_date,
    amountReceived: r.amount_received,
    amountReceivedEgp: r.amount_received_egp ?? undefined,
    paymentCurrency: r.payment_currency ?? undefined,
    paymentMethod: r.payment_method,
    referenceNo: r.reference_no,
    notes: r.notes ?? undefined,
  };
}

function creditNoteFromRow(r: CollectionCreditNoteRow): CreditNote {
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

function invoiceFromRow(r: CollectionInvoiceRow): Invoice {
  return {
    id: r.id,
    invoiceNo: r.invoice_no,
    customer: r.customer,
    projectName: r.project_name ?? undefined,
    invoiceDate: r.invoice_date ?? '',
    submissionDate: r.submission_date ?? undefined,
    dueDate: r.due_date ?? '',
    amount: r.amount,
    tax: r.tax,
    total: r.total,
    currency: r.currency ?? undefined,
    exchangeRate: r.exchange_rate ?? undefined,
    invoiceType: r.invoice_type ?? undefined,
    invoiceStatus: r.invoice_status,
    collectionStatus: r.collection_status,
    paymentStatus: r.payment_status,
    withholdingTax: r.withholding_tax ?? undefined,
    lastFollowUp: r.last_follow_up ?? '',
    nextFollowUp: r.next_follow_up ?? '',
    notes: r.notes,
    invoiceNotes: r.invoice_notes ?? undefined,
    pdfData: r.pdf_data ?? undefined,
    pdfName: r.pdf_name ?? undefined,
    payments: (r.collection_payments ?? []).map(paymentFromRow),
    creditNotes: (r.collection_credit_notes ?? []).map(creditNoteFromRow),
  };
}

// ─── camelCase → Row converters ─────────────────────────────────────────────

function invoiceToRow(inv: Invoice): Omit<CollectionInvoiceRow, 'created_at' | 'updated_at' | 'collection_payments' | 'collection_credit_notes'> {
  return {
    id: inv.id,
    invoice_no: inv.invoiceNo,
    customer: inv.customer,
    project_name: inv.projectName ?? null,
    invoice_date: inv.invoiceDate || null,
    submission_date: inv.submissionDate ?? null,
    due_date: inv.dueDate || null,
    amount: inv.amount,
    tax: inv.tax,
    total: inv.total,
    currency: inv.currency ?? 'EGP',
    exchange_rate: inv.exchangeRate ?? null,
    invoice_type: inv.invoiceType ?? null,
    invoice_status: inv.invoiceStatus as CollectionInvoiceRow['invoice_status'],
    collection_status: inv.collectionStatus as CollectionInvoiceRow['collection_status'],
    payment_status: inv.paymentStatus as CollectionInvoiceRow['payment_status'],
    withholding_tax: inv.withholdingTax ?? null,
    last_follow_up: inv.lastFollowUp || null,
    next_follow_up: inv.nextFollowUp || null,
    notes: inv.notes,
    invoice_notes: inv.invoiceNotes ?? null,
    pdf_data: inv.pdfData ?? null,
    pdf_name: inv.pdfName ?? null,
  };
}

function paymentToRow(p: Payment, invoiceId: string): Omit<CollectionPaymentRow, 'created_at' | 'updated_at'> {
  return {
    id: p.id,
    invoice_id: invoiceId,
    receipt_date: p.receiptDate,
    amount_received: p.amountReceived,
    amount_received_egp: p.amountReceivedEgp ?? null,
    payment_currency: p.paymentCurrency ?? null,
    payment_method: p.paymentMethod,
    reference_no: p.referenceNo,
    notes: p.notes ?? null,
  };
}

function creditNoteToRow(cn: CreditNote, invoiceId: string): Omit<CollectionCreditNoteRow, 'created_at' | 'updated_at'> {
  return {
    id: cn.id,
    invoice_id: invoiceId,
    date: cn.date,
    pretax_amount: cn.pretaxAmount,
    vat: cn.vat,
    withholding: cn.withholding,
    amount: cn.amount,
    reason: cn.reason,
    reference_no: cn.referenceNo ?? null,
  };
}

// ─── Schema detection (cached) ──────────────────────────────────────────────
// Try relational query first; if it fails (child tables don't exist yet),
// fall back to the old JSONB blob pattern. Result is cached for the session.

let schemaMode: 'relational' | 'jsonb' | null = null;

async function detectSchema(): Promise<'relational' | 'jsonb'> {
  if (schemaMode) return schemaMode;
  const { error } = await supabase
    .from('collections_invoices')
    .select('*, collection_payments(*), collection_credit_notes(*)')
    .limit(1);
  schemaMode = error ? 'jsonb' : 'relational';
  return schemaMode;
}

// ─── JSONB fallback helpers (old schema: { id text, data jsonb, updated_at }) ─

function loadFromJsonb(rows: { data: Invoice }[]): Invoice[] {
  return rows.map((r) => r.data);
}

// ─── Public API (same signatures as before, adapts internally) ──────────────

export async function loadInvoices(): Promise<Invoice[]> {
  const mode = await detectSchema();

  if (mode === 'jsonb') {
    const { data, error } = await supabase
      .from('collections_invoices')
      .select('data')
      .order('updated_at', { ascending: false });
    if (error) { console.error('[collections] load failed:', error); return []; }
    return loadFromJsonb((data ?? []) as { data: Invoice }[]);
  }

  const { data, error } = await supabase
    .from('collections_invoices')
    .select('*, collection_payments(*), collection_credit_notes(*)')
    .order('updated_at', { ascending: false });
  if (error) {
    console.error('[collections] load failed:', error);
    return [];
  }
  return ((data ?? []) as CollectionInvoiceRow[]).map(invoiceFromRow);
}

export async function upsertInvoice(invoice: Invoice): Promise<void> {
  const mode = await detectSchema();

  if (mode === 'jsonb') {
    const { error } = await supabase
      .from('collections_invoices')
      .upsert({ id: invoice.id, data: invoice, updated_at: new Date().toISOString() });
    if (error) console.error('[collections] upsert failed:', error);
    return;
  }

  // 1. Upsert parent row
  const row = invoiceToRow(invoice);
  const { error } = await supabase.from('collections_invoices').upsert(row);
  if (error) { console.error('[collections] upsert failed:', error); return; }

  // 2. Sync payments: delete removed, upsert current
  await supabase.from('collection_payments').delete().eq('invoice_id', invoice.id);
  if (invoice.payments.length > 0) {
    const paymentRows = invoice.payments.map((p) => paymentToRow(p, invoice.id));
    const { error: pErr } = await supabase.from('collection_payments').insert(paymentRows);
    if (pErr) console.error('[collections] payment sync failed:', pErr);
  }

  // 3. Sync credit notes
  const cns = invoice.creditNotes ?? [];
  await supabase.from('collection_credit_notes').delete().eq('invoice_id', invoice.id);
  if (cns.length > 0) {
    const cnRows = cns.map((cn) => creditNoteToRow(cn, invoice.id));
    const { error: cnErr } = await supabase.from('collection_credit_notes').insert(cnRows);
    if (cnErr) console.error('[collections] credit note sync failed:', cnErr);
  }
}

export async function deleteInvoices(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from('collections_invoices').delete().in('id', ids);
  if (error) console.error('[collections] delete failed:', error);
}
