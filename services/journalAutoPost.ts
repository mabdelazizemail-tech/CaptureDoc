/**
 * journalAutoPost.ts
 * Auto-generates double-entry journal entries from Receivables and Payables events.
 * Called directly from CollectionsDashboard and PayablesDashboard at mutation points.
 */

import { upsertJournalEntry } from './journalStorage';

// ─── Minimal types (mirrored from dashboard files) ─────────────────────────

export interface AutoPostInvoice {
  id: string;
  invoiceNo: string;
  customer: string;
  invoiceDate: string;
  amount: number;      // pre-tax
  tax: number;
  total: number;
  currency?: 'EGP' | 'USD';
  exchangeRate?: number;
  invoiceType?: string;
  projectName?: string;
}

export interface AutoPostPayment {
  id: string;
  receiptDate: string;
  amountReceived: number;
  paymentMethod: string;
  referenceNo: string;
}

export interface AutoPostCreditNote {
  id: string;
  date: string;
  pretaxAmount: number;
  vat: number;
  amount: number;
  reason: string;
  referenceNo?: string;
}

export interface AutoPostSupplierInvoice {
  id: string;
  invoiceNo: string;
  supplier: string;
  invoiceDate: string;
  amount: number;   // pre-tax
  tax: number;
  total: number;
  currency?: 'EGP' | 'USD';
  exchangeRate?: number;
  invoiceType?: string;
}

export interface AutoPostSupplierPayment {
  id: string;
  paymentDate: string;
  amountPaid: number;
  paymentMethod: string;
  referenceNo: string;
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

const yearMonth = (dateStr: string) => {
  const d = new Date(dateStr || Date.now());
  return `FY${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const bankAccountForMethod = (method: string): { code: string; name: string } => {
  if (method.includes('بنك') || method.includes('تحويل') || method.includes('Transfer') || method.includes('Bank'))
    return { code: '1120', name: 'البنك الأهلي المصري' };
  if (method.includes('نقد') || method.includes('Cash'))
    return { code: '1110', name: 'الصندوق' };
  return { code: '1120', name: 'البنك الأهلي المصري' };
};

const nextJENumber = (): string => {
  const year = new Date().getFullYear();
  const seq = String(Date.now()).slice(-5);
  return `JE-${year}-AUTO-${seq}`;
};

const buildEntry = (overrides: Partial<ReturnType<typeof baseEntry>>) => ({
  ...baseEntry(),
  ...overrides,
});

function baseEntry() {
  const now = new Date().toISOString();
  return {
    id: uid(),
    journal_number: nextJENumber(),
    entry_type: 'يدوي',
    source_module: 'يدوي',
    source_document_no: '',
    source_document_id: '',
    reference_no: '',
    entry_date: now.split('T')[0],
    posting_date: now.split('T')[0],
    fiscal_period: yearMonth(now.split('T')[0]),
    currency: 'EGP' as 'EGP' | 'USD',
    exchange_rate: undefined as number | undefined,
    description: '',
    status: 'Posted' as const,
    auto_generated_flag: true,
    created_by: 'النظام',
    created_at: now,
    approved_by: 'النظام',
    approved_at: now,
    posted_by: 'النظام',
    posted_at: now,
    lines: [] as {
      line_no: number;
      account_code: string;
      account_name: string;
      line_description: string;
      debit_amount: number;
      credit_amount: number;
      cost_center?: string;
    }[],
    approval_history: [
      { id: uid(), action: 'submitted' as const, performed_by: 'النظام', performed_at: now },
      { id: uid(), action: 'approved' as const, performed_by: 'النظام', performed_at: now },
      { id: uid(), action: 'posted' as const, performed_by: 'النظام', performed_at: now },
    ],
    attachments: [] as { name: string; size: string }[],
  };
}

// ─── 1. Sales Invoice Posted ─────────────────────────────────────────────────
//   Dr Accounts Receivable    (total)
//   Cr Revenue                (amount pre-tax)
//   Cr Tax Payable            (tax)  — only if tax > 0

export async function autoPostInvoiceIssuance(inv: AutoPostInvoice): Promise<void> {
  const lines: ReturnType<typeof buildEntry>['lines'] = [
    {
      line_no: 1,
      account_code: '1210',
      account_name: 'مديونية العملاء المحليين',
      line_description: `مديونية ${inv.customer} — ${inv.invoiceNo}`,
      debit_amount: inv.total,
      credit_amount: 0,
    },
    {
      line_no: 2,
      account_code: '4110',
      account_name: 'إيرادات الخدمات',
      line_description: `إيراد ${inv.invoiceType ?? 'خدمات'} — ${inv.invoiceNo}`,
      debit_amount: 0,
      credit_amount: inv.amount,
    },
  ];

  if (inv.tax > 0) {
    lines.push({
      line_no: 3,
      account_code: '2210',
      account_name: 'ضريبة المبيعات المستحقة',
      line_description: `ضريبة القيمة المضافة — ${inv.invoiceNo}`,
      debit_amount: 0,
      credit_amount: inv.tax,
    });
  }

  const entry = buildEntry({
    entry_type: 'فاتورة مبيعات',
    source_module: 'التحصيلات',
    source_document_no: inv.invoiceNo,
    source_document_id: inv.id,
    reference_no: inv.invoiceNo,
    entry_date: inv.invoiceDate,
    posting_date: inv.invoiceDate,
    fiscal_period: yearMonth(inv.invoiceDate),
    currency: (inv.currency ?? 'EGP') as 'EGP' | 'USD',
    exchange_rate: inv.currency === 'USD' ? inv.exchangeRate : undefined,
    description: `قيد فاتورة مبيعات — ${inv.customer} — ${inv.invoiceNo}${inv.projectName ? ` (${inv.projectName})` : ''}`,
    lines,
  });

  await upsertJournalEntry(entry as unknown as { id: string });
}

// ─── 2. Customer Payment Received ────────────────────────────────────────────
//   Dr Cash / Bank            (amountReceived)
//   Cr Accounts Receivable    (amountReceived)

export async function autoPostPaymentReceived(
  inv: AutoPostInvoice,
  payment: AutoPostPayment
): Promise<void> {
  const bank = bankAccountForMethod(payment.paymentMethod);
  const entry = buildEntry({
    entry_type: 'تحصيل عميل',
    source_module: 'التحصيلات',
    source_document_no: payment.referenceNo || inv.invoiceNo,
    source_document_id: payment.id,
    reference_no: payment.referenceNo,
    entry_date: payment.receiptDate,
    posting_date: payment.receiptDate,
    fiscal_period: yearMonth(payment.receiptDate),
    currency: (inv.currency ?? 'EGP') as 'EGP' | 'USD',
    description: `قيد تحصيل دفعة — ${inv.customer} — ${inv.invoiceNo} (${payment.paymentMethod})`,
    lines: [
      {
        line_no: 1,
        account_code: bank.code,
        account_name: bank.name,
        line_description: `تحصيل من ${inv.customer} — ${payment.referenceNo || inv.invoiceNo}`,
        debit_amount: payment.amountReceived,
        credit_amount: 0,
      },
      {
        line_no: 2,
        account_code: '1210',
        account_name: 'مديونية العملاء المحليين',
        line_description: `تسوية مديونية ${inv.customer} — ${inv.invoiceNo}`,
        debit_amount: 0,
        credit_amount: payment.amountReceived,
      },
    ],
  });

  await upsertJournalEntry(entry as unknown as { id: string });
}

// ─── 3. Sales Credit Note ─────────────────────────────────────────────────────
//   Dr Revenue / Sales Returns   (pretaxAmount)
//   Dr Tax Adjustment            (vat)           — if vat > 0
//   Cr Accounts Receivable       (amount net)

export async function autoPostCreditNote(
  inv: AutoPostInvoice,
  cn: AutoPostCreditNote
): Promise<void> {
  const lines: ReturnType<typeof buildEntry>['lines'] = [
    {
      line_no: 1,
      account_code: '5700',
      account_name: 'مردودات المبيعات',
      line_description: `مردود — ${cn.reason} — ${inv.invoiceNo}`,
      debit_amount: cn.pretaxAmount,
      credit_amount: 0,
    },
  ];

  if (cn.vat > 0) {
    lines.push({
      line_no: 2,
      account_code: '2210',
      account_name: 'ضريبة المبيعات المستحقة',
      line_description: `تسوية ضريبة إشعار دائن — ${inv.invoiceNo}`,
      debit_amount: cn.vat,
      credit_amount: 0,
    });
  }

  lines.push({
    line_no: lines.length + 1,
    account_code: '1210',
    account_name: 'مديونية العملاء المحليين',
    line_description: `تخفيض مديونية ${inv.customer} — ${inv.invoiceNo}`,
    debit_amount: 0,
    credit_amount: cn.amount,
  });

  const entry = buildEntry({
    entry_type: 'إشعار دائن/مدين',
    source_module: 'التحصيلات',
    source_document_no: cn.referenceNo || inv.invoiceNo,
    source_document_id: cn.id,
    reference_no: cn.referenceNo,
    entry_date: cn.date,
    posting_date: cn.date,
    fiscal_period: yearMonth(cn.date),
    currency: (inv.currency ?? 'EGP') as 'EGP' | 'USD',
    description: `قيد إشعار دائن — ${inv.customer} — ${cn.reason}`,
    lines,
  });

  await upsertJournalEntry(entry as unknown as { id: string });
}

// ─── 4. Supplier Invoice Approved/Posted ─────────────────────────────────────
//   Dr Expense / Inventory       (amount pre-tax)
//   Dr Recoverable VAT           (tax)            — if tax > 0
//   Cr Accounts Payable          (total)

export async function autoPostSupplierInvoice(inv: AutoPostSupplierInvoice): Promise<void> {
  const expenseAccount = inv.invoiceType === 'أصول'
    ? { code: '1500', name: 'الأصول الثابتة' }
    : inv.invoiceType === 'توريدات'
    ? { code: '1300', name: 'المخزون' }
    : { code: '5600', name: 'مصروفات تشغيلية أخرى' };

  const lines: ReturnType<typeof buildEntry>['lines'] = [
    {
      line_no: 1,
      account_code: expenseAccount.code,
      account_name: expenseAccount.name,
      line_description: `${inv.invoiceType ?? 'مصروف'} — ${inv.supplier} — ${inv.invoiceNo}`,
      debit_amount: inv.amount,
      credit_amount: 0,
    },
  ];

  if (inv.tax > 0) {
    lines.push({
      line_no: 2,
      account_code: '1400',
      account_name: 'ضريبة القيمة المضافة القابلة للاسترداد',
      line_description: `ضريبة القيمة المضافة — ${inv.invoiceNo}`,
      debit_amount: inv.tax,
      credit_amount: 0,
    });
  }

  lines.push({
    line_no: lines.length + 1,
    account_code: '2110',
    account_name: 'مستحقات الموردين المحليين',
    line_description: `مستحقات ${inv.supplier} — ${inv.invoiceNo}`,
    debit_amount: 0,
    credit_amount: inv.total,
  });

  const entry = buildEntry({
    entry_type: 'فاتورة مورد',
    source_module: 'المدفوعات',
    source_document_no: inv.invoiceNo,
    source_document_id: inv.id,
    reference_no: inv.invoiceNo,
    entry_date: inv.invoiceDate,
    posting_date: inv.invoiceDate,
    fiscal_period: yearMonth(inv.invoiceDate),
    currency: (inv.currency ?? 'EGP') as 'EGP' | 'USD',
    exchange_rate: inv.currency === 'USD' ? inv.exchangeRate : undefined,
    description: `قيد فاتورة مورد — ${inv.supplier} — ${inv.invoiceNo}`,
    lines,
  });

  await upsertJournalEntry(entry as unknown as { id: string });
}

// ─── 5. Supplier Payment Made ─────────────────────────────────────────────────
//   Dr Accounts Payable        (amountPaid)
//   Cr Cash / Bank             (amountPaid)

export async function autoPostSupplierPayment(
  inv: AutoPostSupplierInvoice,
  payment: AutoPostSupplierPayment
): Promise<void> {
  const bank = bankAccountForMethod(payment.paymentMethod);
  const entry = buildEntry({
    entry_type: 'سداد مورد',
    source_module: 'المدفوعات',
    source_document_no: payment.referenceNo || inv.invoiceNo,
    source_document_id: payment.id,
    reference_no: payment.referenceNo,
    entry_date: payment.paymentDate,
    posting_date: payment.paymentDate,
    fiscal_period: yearMonth(payment.paymentDate),
    currency: (inv.currency ?? 'EGP') as 'EGP' | 'USD',
    description: `قيد سداد مورد — ${inv.supplier} — ${inv.invoiceNo} (${payment.paymentMethod})`,
    lines: [
      {
        line_no: 1,
        account_code: '2110',
        account_name: 'مستحقات الموردين المحليين',
        line_description: `تسوية مستحقات ${inv.supplier} — ${inv.invoiceNo}`,
        debit_amount: payment.amountPaid,
        credit_amount: 0,
      },
      {
        line_no: 2,
        account_code: bank.code,
        account_name: bank.name,
        line_description: `سداد لـ ${inv.supplier} — ${payment.referenceNo || inv.invoiceNo}`,
        debit_amount: 0,
        credit_amount: payment.amountPaid,
      },
    ],
  });

  await upsertJournalEntry(entry as unknown as { id: string });
}
