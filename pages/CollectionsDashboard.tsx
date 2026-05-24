import React, { useState, useMemo, useRef, useEffect } from 'react';
import { User } from '../services/types';
import { parseInvoicePdf, ParsedInvoice } from '../services/invoicePdfParser';
import { loadInvoices as loadInvoicesRemote, upsertInvoice as upsertInvoiceRemote, deleteInvoices as deleteInvoicesRemote } from '../services/collectionsStorage';
import { supabase } from '../services/supabaseClient';
import { autoPostInvoiceIssuance, autoPostPaymentReceived, autoPostCreditNote } from '../services/journalAutoPost';

// ─── Types ────────────────────────────────────────────────────────────────────

type InvoiceStatus = 'Draft' | 'Approved' | 'Sent' | 'Cancelled';
type CollectionStatus = 'Not Due' | 'Due' | 'Overdue' | 'Partially Paid' | 'Paid' | 'Disputed';
type PaymentStatus = 'Unpaid' | 'Partial' | 'Paid';
type Screen = 'dashboard' | 'invoice-list' | 'create-invoice' | 'invoice-details' | 'payment-entry' | 'history';

interface Payment {
  id: string;
  receiptDate: string;
  amountReceived: number;       // always stored in invoice currency (USD or EGP)
  amountReceivedEgp?: number;   // optional: actual EGP received (set when invoice is USD but payment entered in EGP)
  paymentCurrency?: 'EGP' | 'USD'; // currency the payment was entered in
  paymentMethod: string;
  referenceNo: string;
  notes?: string;
}

interface CreditNote {
  id: string;
  date: string;
  pretaxAmount: number;  // المبلغ قبل الضريبة
  vat: number;           // ضريبة القيمة المضافة 14%
  withholding: number;   // خصم الضريبة التحت حساب
  amount: number;        // الصافي = preтax + vat - withholding
  reason: string;
  referenceNo?: string;
}

interface Invoice {
  id: string;
  invoiceNo: string;
  customer: string;
  projectName?: string;
  invoiceDate: string;
  dueDate: string;
  amount: number;
  tax: number;
  total: number;
  invoiceStatus: InvoiceStatus;
  collectionStatus: CollectionStatus;
  paymentStatus: PaymentStatus;
  lastFollowUp: string;
  nextFollowUp: string;
  notes: string;
  payments: Payment[];
  pdfData?: string;
  pdfName?: string;
  currency?: 'EGP' | 'USD';
  exchangeRate?: number;
  invoiceType?: 'توريدات' | 'خدمات';
  withholdingTax?: number;
  invoiceNotes?: string;
  creditNotes?: CreditNote[];
}

const totalInEgp = (inv: Invoice): number =>
  inv.currency === 'USD' ? inv.total * (inv.exchangeRate || 0) : inv.total;

// ─── Seed Data ────────────────────────────────────────────────────────────────

// Master customer list — shown as dropdown options in the invoice form.
// OCR output is fuzzy-matched against these to pre-select the right option.
const CUSTOMERS: string[] = [
  'زيروكس مصر',
  'خزتلي للخدمات اللوجيستيه',
  'الاهلى للخدمات الطبية',
];

// Strip common Arabic prefixes/noise for fuzzy-matching against CUSTOMERS.
const simplifyArabic = (s: string): string =>
  s
    .normalize('NFKC')
    .replace(/\u0640/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/[ىي]/g, 'ي')
    .replace(/[ةه]/g, 'ه')
    .replace(/^\s*(شركة|شركه|مؤسسة|مؤسسه|مصنع|مكتب)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const matchCustomer = (raw: string): string => {
  if (!raw) return '';
  const needle = simplifyArabic(raw);
  if (!needle) return '';
  // Exact / containment match first
  for (const c of CUSTOMERS) {
    const hay = simplifyArabic(c);
    if (needle === hay || needle.includes(hay) || hay.includes(needle)) return c;
  }
  // Token-overlap fallback: >=50% of tokens in common
  const needleTokens = new Set(needle.split(' ').filter(t => t.length > 1));
  let best = '';
  let bestScore = 0;
  for (const c of CUSTOMERS) {
    const hayTokens = simplifyArabic(c).split(' ').filter(t => t.length > 1);
    const common = hayTokens.filter(t => needleTokens.has(t)).length;
    const score = common / Math.max(hayTokens.length, 1);
    if (score > bestScore && score >= 0.5) {
      bestScore = score;
      best = c;
    }
  }
  return best;
};

const SEED: Invoice[] = [
  {
    id: '1',
    invoiceNo: 'INV-2025-001',
    customer: 'شركة الفجر للمقاولات',
    invoiceDate: '2025-03-01',
    dueDate: '2025-03-31',
    amount: 50000,
    tax: 7500,
    total: 57500,
    invoiceStatus: 'Sent',
    collectionStatus: 'Overdue',
    paymentStatus: 'Unpaid',
    lastFollowUp: '2025-04-10',
    nextFollowUp: '2025-04-20',
    notes: 'تم التواصل مع المحاسب، وعد بالسداد نهاية الشهر.',
    payments: [],
  },
  {
    id: '2',
    invoiceNo: 'INV-2025-002',
    customer: 'مؤسسة النور التجارية',
    invoiceDate: '2025-03-15',
    dueDate: '2025-04-15',
    amount: 32000,
    tax: 4800,
    total: 36800,
    invoiceStatus: 'Sent',
    collectionStatus: 'Overdue',
    paymentStatus: 'Partial',
    lastFollowUp: '2025-04-12',
    nextFollowUp: '2025-04-22',
    notes: 'سدد 15000 EGP، الباقي بعد أسبوع.',
    payments: [
      { id: 'p1', receiptDate: '2025-04-05', amountReceived: 15000, paymentMethod: 'تحويل بنكي', referenceNo: 'TRF-4421' },
    ],
  },
  {
    id: '3',
    invoiceNo: 'INV-2025-003',
    customer: 'شركة رؤية للتقنية',
    invoiceDate: '2025-04-01',
    dueDate: '2025-05-01',
    amount: 18000,
    tax: 2700,
    total: 20700,
    invoiceStatus: 'Approved',
    collectionStatus: 'Overdue',
    paymentStatus: 'Unpaid',
    lastFollowUp: '',
    nextFollowUp: '2025-04-28',
    notes: '',
    payments: [],
  },
  {
    id: '4',
    invoiceNo: 'INV-2025-004',
    customer: 'الشركة الوطنية للخدمات',
    invoiceDate: '2025-02-01',
    dueDate: '2025-03-01',
    amount: 75000,
    tax: 11250,
    total: 86250,
    invoiceStatus: 'Sent',
    collectionStatus: 'Paid',
    paymentStatus: 'Paid',
    lastFollowUp: '2025-03-05',
    nextFollowUp: '',
    notes: 'تم السداد الكامل.',
    payments: [
      { id: 'p2', receiptDate: '2025-03-10', amountReceived: 86250, paymentMethod: 'شيك', referenceNo: 'CHK-8821' },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  n.toLocaleString('en-EG', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

const invoiceStatusColor: Record<InvoiceStatus, string> = {
  Draft: 'bg-gray-700 text-gray-300',
  Approved: 'bg-blue-900/50 text-blue-300',
  Sent: 'bg-indigo-900/50 text-indigo-300',
  Cancelled: 'bg-red-900/40 text-red-400',
};

const invoiceStatusAr: Record<InvoiceStatus, string> = {
  Draft: 'مسودة',
  Approved: 'معتمدة',
  Sent: 'مُرسلة',
  Cancelled: 'ملغاة',
};

const collectionStatusColor: Record<CollectionStatus, string> = {
  'Not Due': 'bg-gray-700 text-gray-300',
  Due: 'bg-yellow-900/50 text-yellow-300',
  Overdue: 'bg-red-900/50 text-red-400',
  'Partially Paid': 'bg-orange-900/50 text-orange-300',
  Paid: 'bg-green-900/50 text-green-400',
  Disputed: 'bg-rose-900/50 text-rose-300',
};

const collectionStatusAr: Record<CollectionStatus, string> = {
  'Not Due': 'لم يحن موعده',
  Due: 'مستحق',
  Overdue: 'متأخر',
  'Partially Paid': 'مدفوع جزئياً',
  Paid: 'مدفوع',
  Disputed: 'متنازع عليه',
};

const paymentStatusAr: Record<PaymentStatus, string> = {
  Unpaid: 'غير مدفوع',
  Partial: 'جزئي',
  Paid: 'مدفوع',
};

const totalPaid = (inv: Invoice) =>
  inv.payments.reduce((s, p) => s + p.amountReceived, 0);

const totalCreditNotes = (inv: Invoice) =>
  (inv.creditNotes ?? []).reduce((s, c) => s + c.amount, 0);

const effectiveTotal = (inv: Invoice) =>
  inv.total - (inv.withholdingTax || 0) - totalCreditNotes(inv);

const balance = (inv: Invoice) => effectiveTotal(inv) - totalPaid(inv);

const balanceInEgp = (inv: Invoice): number => {
  const b = balance(inv);
  return inv.currency === 'USD' ? b * (inv.exchangeRate || 0) : b;
};

const paidInEgp = (inv: Invoice): number => {
  const p = totalPaid(inv);
  return inv.currency === 'USD' ? p * (inv.exchangeRate || 0) : p;
};

// Derived collection status: any invoice whose invoice date is >= 1 month ago
// is considered مستحق (Due), unless it's already been fully or partially paid,
// manually disputed, or is still within the 1-month window.
const effectiveCollectionStatus = (inv: Invoice): CollectionStatus => {
  if (inv.payments.length > 0) return 'Paid';
  return 'Overdue';
};

// ─── Sort Utilities ──────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc';

function cmp(a: any, b: any): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'ar');
}

function applySortDir(v: number, dir: SortDir) { return dir === 'asc' ? v : -v; }

const SortTh: React.FC<{
  label: string;
  col: string;
  sortCol: string | null;
  sortDir: SortDir;
  onSort: (col: string) => void;
  className?: string;
}> = ({ label, col, sortCol, sortDir, onSort, className = 'px-4 py-3 text-right' }) => (
  <th
    className={`${className} cursor-pointer select-none hover:text-gray-300 transition-colors`}
    onClick={() => onSort(col)}
  >
    <span className="inline-flex items-center gap-1">
      {label}
      <span className="text-gray-600 text-[10px]">
        {sortCol === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
      </span>
    </span>
  </th>
);

// ─── Tab Bar ──────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: 'dashboard' },
  { id: 'invoice-list', label: 'إصدار الفواتير', icon: 'receipt_long' },
  { id: 'payment-entry', label: 'تسجيل السداد', icon: 'payments' },
  { id: 'history', label: 'سجل التحصيلات', icon: 'history' },
] as const;

// ─── Screen: Dashboard ────────────────────────────────────────────────────────

const DashboardScreen: React.FC<{
  invoices: Invoice[];
  onOpen: (inv: Invoice) => void;
}> = ({ invoices, onOpen }) => {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDirD, setSortDirD] = useState<SortDir>('asc');

  const handleSortD = (col: string) => {
    setSortDirD(prev => sortCol === col && prev === 'asc' ? 'desc' : 'asc');
    setSortCol(col);
  };

  const sortedInvoices = useMemo(() => {
    if (!sortCol) return invoices;
    return [...invoices].sort((a, b) => {
      let v = 0;
      if (sortCol === 'invoiceNo') v = cmp(a.invoiceNo, b.invoiceNo);
      else if (sortCol === 'customer') v = cmp(a.customer, b.customer);
      else if (sortCol === 'projectName') v = cmp(a.projectName, b.projectName);
      else if (sortCol === 'dueDate') v = cmp(a.dueDate, b.dueDate);
      else if (sortCol === 'invoiceDate') v = cmp(a.invoiceDate, b.invoiceDate);
      else if (sortCol === 'total') v = cmp(totalInEgp(a), totalInEgp(b));
      else if (sortCol === 'paymentDate') {
        const pa = a.payments.length > 0 ? a.payments.sort((x, y) => y.receiptDate.localeCompare(x.receiptDate))[0].receiptDate : '';
        const pb = b.payments.length > 0 ? b.payments.sort((x, y) => y.receiptDate.localeCompare(x.receiptDate))[0].receiptDate : '';
        v = cmp(pa, pb);
      }
      return applySortDir(v, sortDirD);
    });
  }, [invoices, sortCol, sortDirD]);

  const sent = invoices.filter(i => i.invoiceStatus === 'Sent');
  const totalSentEgp = sent.reduce((s, i) => s + totalInEgp(i), 0);
  const totalDue = invoices
    .filter(i => effectiveCollectionStatus(i) === 'Overdue')
    .reduce((s, i) => s + balance(i), 0);
  const totalOverdue = invoices
    .filter(i => effectiveCollectionStatus(i) === 'Overdue')
    .reduce((s, i) => s + balance(i), 0);
  // Sum ALL payments (EGP) across all invoices, including partial payments and USD-converted
  const totalPaidAmt = invoices.reduce((s, i) => s + paidInEgp(i), 0);
  const totalRemaining = totalSentEgp - totalPaidAmt;

  const overdue = invoices.filter(i => effectiveCollectionStatus(i) === 'Overdue');

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* إجمالي المُرسلة — with remaining sub-line */}
        <div className="bg-[#232b3e] rounded-xl p-4 border border-gray-700">
          <div className="flex items-center gap-2 mb-2">
            <span className="material-icons text-lg text-blue-400">send</span>
            <span className="text-gray-400 text-xs">إجمالي المُرسلة</span>
          </div>
          <p className="text-xl font-bold text-white">{fmt(totalSentEgp)}</p>
          <p className="text-gray-500 text-xs">EGP</p>
          <div className="mt-2 pt-2 border-t border-gray-700/60 flex items-center justify-between">
            <span className="text-gray-500 text-xs">المتبقي</span>
            <span className="text-red-400 text-xs font-semibold">{fmt(totalRemaining)} EGP</span>
          </div>
        </div>
        {[
          { label: 'إجمالي المستحق', value: totalDue, icon: 'schedule', color: 'text-yellow-400' },
          { label: 'إجمالي المتأخر', value: totalOverdue, icon: 'warning', color: 'text-red-400' },
          { label: 'إجمالي المحصّل', value: totalPaidAmt, icon: 'check_circle', color: 'text-green-400' },
        ].map(card => (
          <div key={card.label} className="bg-[#232b3e] rounded-xl p-4 border border-gray-700">
            <div className="flex items-center gap-2 mb-2">
              <span className={`material-icons text-lg ${card.color}`}>{card.icon}</span>
              <span className="text-gray-400 text-xs">{card.label}</span>
            </div>
            <p className="text-xl font-bold text-white">{fmt(card.value)}</p>
            <p className="text-gray-500 text-xs">EGP</p>
          </div>
        ))}
      </div>

      {/* All Invoices — coloured status icons */}
      <div className="bg-[#232b3e] rounded-xl border border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-3 flex-wrap">
          <span className="material-icons text-primary text-lg">receipt_long</span>
          <h3 className="font-semibold text-white">جميع الفواتير</h3>
          {/* Legend */}
          <div className="mr-auto flex items-center gap-4 text-xs text-gray-400 flex-wrap">
            <span className="flex items-center gap-1"><span className="material-icons text-red-500" style={{fontSize:'16px'}}>cancel</span>متأخر</span>
            <span className="flex items-center gap-1"><span className="material-icons text-green-400" style={{fontSize:'16px'}}>check_circle</span>مدفوع</span>
          </div>
        </div>
        {invoices.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">لا توجد فواتير مسجّلة</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs border-b border-gray-700 bg-[#1b2130]">
                <th className="px-4 py-3 text-right w-8"></th>
                <SortTh label="رقم الفاتورة" col="invoiceNo" sortCol={sortCol} sortDir={sortDirD} onSort={handleSortD} />
                <SortTh label="العميل" col="customer" sortCol={sortCol} sortDir={sortDirD} onSort={handleSortD} />
                <SortTh label="اسم المشروع" col="projectName" sortCol={sortCol} sortDir={sortDirD} onSort={handleSortD} />
                <SortTh label="تاريخ الفاتورة" col="invoiceDate" sortCol={sortCol} sortDir={sortDirD} onSort={handleSortD} />
                <SortTh label="الاستحقاق" col="dueDate" sortCol={sortCol} sortDir={sortDirD} onSort={handleSortD} />
                <SortTh label="الإجمالي" col="total" sortCol={sortCol} sortDir={sortDirD} onSort={handleSortD} />
                <SortTh label="تاريخ الدفع" col="paymentDate" sortCol={sortCol} sortDir={sortDirD} onSort={handleSortD} />
                <th className="px-2 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {sortedInvoices.map(inv => {
                const cs = effectiveCollectionStatus(inv);
                const { dotIcon, dotCls, rowCls } = cs === 'Paid'
                  ? { dotIcon: 'check_circle', dotCls: 'text-green-400', rowCls: '' }
                  : { dotIcon: 'cancel', dotCls: 'text-red-500', rowCls: 'bg-red-950/10' };
                return (
                  <tr key={inv.id} className={`border-b border-gray-700/50 hover:bg-[#2d3648] transition-colors cursor-pointer ${rowCls}`} onClick={() => onOpen(inv)}>
                    <td className="px-4 py-3 text-center">
                      <span className={`material-icons ${dotCls}`} style={{ fontSize: '20px' }}>{dotIcon}</span>
                    </td>
                    <td className="px-4 py-3 text-white font-mono text-xs">{inv.invoiceNo}</td>
                    <td className="px-4 py-3 text-gray-300">{inv.customer}</td>
                    <td className="px-4 py-3 text-gray-300">{inv.projectName || '—'}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{inv.invoiceDate || '—'}</td>
                    <td className={`px-4 py-3 text-xs font-medium ${cs === 'Overdue' ? 'text-red-400' : 'text-gray-400'}`}>{inv.dueDate || '—'}</td>
                    <td className="px-4 py-3 text-white font-semibold">
                      {fmt(totalInEgp(inv))} EGP
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{inv.payments.length > 0 ? inv.payments.sort((a, b) => b.receiptDate.localeCompare(a.receiptDate))[0].receiptDate : '—'}</td>
                    <td className="px-2 py-3">
                      <span className="material-icons text-gray-500 text-base">open_in_new</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// ─── Screen: Invoice List ─────────────────────────────────────────────────────

const InvoiceListScreen: React.FC<{
  invoices: Invoice[];
  onOpen: (inv: Invoice) => void;
  onNew: () => void;
  canDelete?: boolean;
  onDelete?: (ids: string[]) => void;
}> = ({ invoices, onOpen, onNew, canDelete = false, onDelete }) => {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<InvoiceStatus | 'All'>('All');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDirL, setSortDirL] = useState<SortDir>('asc');

  const handleSortL = (col: string) => {
    setSortDirL(prev => sortCol === col && prev === 'asc' ? 'desc' : 'asc');
    setSortCol(col);
  };

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const filtered = useMemo(() => {
    const base = invoices.filter(inv => {
      const matchSearch =
        inv.invoiceNo.toLowerCase().includes(search.toLowerCase()) ||
        inv.customer.includes(search);
      const matchStatus = filterStatus === 'All' || inv.invoiceStatus === filterStatus;
      return matchSearch && matchStatus;
    });
    if (!sortCol) return base;
    return [...base].sort((a, b) => {
      let v = 0;
      if (sortCol === 'invoiceNo') v = cmp(a.invoiceNo, b.invoiceNo);
      else if (sortCol === 'customer') v = cmp(a.customer, b.customer);
      else if (sortCol === 'projectName') v = cmp(a.projectName, b.projectName);
      else if (sortCol === 'invoiceDate') v = cmp(a.invoiceDate, b.invoiceDate);
      else if (sortCol === 'dueDate') v = cmp(a.dueDate, b.dueDate);
      else if (sortCol === 'total') v = cmp(totalInEgp(a), totalInEgp(b));
      else if (sortCol === 'invoiceStatus') v = cmp(a.invoiceStatus, b.invoiceStatus);
      else if (sortCol === 'collectionStatus') v = cmp(effectiveCollectionStatus(a), effectiveCollectionStatus(b));
      return applySortDir(v, sortDirL);
    });
  }, [invoices, search, filterStatus, sortCol, sortDirL]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1">
          <span className="material-icons absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-lg">search</span>
          <input
            type="text"
            placeholder="بحث برقم الفاتورة أو العميل..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-[#1b2130] border border-gray-700 rounded-lg pr-10 pl-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary"
          />
        </div>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as InvoiceStatus | 'All')}
          className="bg-[#1b2130] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-primary"
        >
          <option value="All">جميع الحالات</option>
          {(Object.keys(invoiceStatusAr) as InvoiceStatus[]).map(s => (
            <option key={s} value={s}>{invoiceStatusAr[s]}</option>
          ))}
        </select>
        <button
          onClick={onNew}
          className="flex items-center gap-2 bg-primary hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
        >
          <span className="material-icons text-base">add</span>
          فاتورة جديدة
        </button>
        {canDelete && selected.size > 0 && (
          <button
            onClick={() => {
              if (window.confirm(`هل أنت متأكد من حذف ${selected.size} فاتورة؟`)) {
                onDelete?.(Array.from(selected));
                setSelected(new Set());
              }
            }}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
          >
            <span className="material-icons text-base">delete</span>
            حذف المحدد ({selected.size})
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-[#232b3e] rounded-xl border border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 text-xs border-b border-gray-700 bg-[#1b2130]">
              {canDelete && (
                <th className="px-3 py-3 text-center w-10">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every(i => selected.has(i.id))}
                    onChange={e => {
                      setSelected(e.target.checked ? new Set(filtered.map(i => i.id)) : new Set());
                    }}
                    className="w-4 h-4 accent-primary cursor-pointer"
                  />
                </th>
              )}
              <SortTh label="رقم الفاتورة" col="invoiceNo" sortCol={sortCol} sortDir={sortDirL} onSort={handleSortL} className="px-5 py-3 text-right" />
              <SortTh label="العميل" col="customer" sortCol={sortCol} sortDir={sortDirL} onSort={handleSortL} className="px-5 py-3 text-right" />
              <SortTh label="اسم المشروع" col="projectName" sortCol={sortCol} sortDir={sortDirL} onSort={handleSortL} className="px-5 py-3 text-right" />
              <SortTh label="تاريخ الفاتورة" col="invoiceDate" sortCol={sortCol} sortDir={sortDirL} onSort={handleSortL} className="px-5 py-3 text-right" />
              <SortTh label="الاستحقاق" col="dueDate" sortCol={sortCol} sortDir={sortDirL} onSort={handleSortL} className="px-5 py-3 text-right" />
              <SortTh label="الإجمالي" col="total" sortCol={sortCol} sortDir={sortDirL} onSort={handleSortL} className="px-5 py-3 text-right" />
              <SortTh label="حالة الفاتورة" col="invoiceStatus" sortCol={sortCol} sortDir={sortDirL} onSort={handleSortL} className="px-5 py-3 text-right" />
              <SortTh label="حالة التحصيل" col="collectionStatus" sortCol={sortCol} sortDir={sortDirL} onSort={handleSortL} className="px-5 py-3 text-right" />
              <th className="px-2 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={canDelete ? 10 : 9} className="px-5 py-10 text-center text-gray-500">لا توجد فواتير مطابقة</td>
              </tr>
            ) : filtered.map(inv => (
              <tr key={inv.id} className="border-b border-gray-700/50 hover:bg-[#2d3648] transition-colors cursor-pointer" onClick={() => onOpen(inv)}>
                {canDelete && (
                  <td className="px-3 py-3 text-center" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(inv.id)}
                      onChange={() => toggleOne(inv.id)}
                      className="w-4 h-4 accent-primary cursor-pointer"
                    />
                  </td>
                )}
                <td className="px-5 py-3 text-white font-mono text-xs">{inv.invoiceNo}</td>
                <td className="px-5 py-3 text-gray-300">{inv.customer}</td>
                <td className="px-5 py-3 text-gray-300">{inv.projectName || '—'}</td>
                <td className="px-5 py-3 text-gray-400">{inv.invoiceDate}</td>
                <td className="px-5 py-3 text-gray-400">{inv.dueDate}</td>
                <td className="px-5 py-3 text-white font-semibold">
                  {(() => {
                    const wh = inv.withholdingTax
                      ? (inv.currency === 'USD' ? inv.withholdingTax * (inv.exchangeRate || 1) : inv.withholdingTax)
                      : 0;
                    const cn = totalCreditNotes(inv);
                    const net = totalInEgp(inv) - wh - cn;
                    const hasDeduction = wh > 0 || cn > 0;
                    return hasDeduction ? (
                      <>
                        <div className="text-xs text-gray-500 line-through font-normal">{fmt(totalInEgp(inv))} EGP</div>
                        <div className="text-green-400">{fmt(net)} <span className="text-xs text-gray-400">EGP</span></div>
                      </>
                    ) : (
                      <div>{fmt(totalInEgp(inv))} <span className="text-xs text-gray-400">EGP</span></div>
                    );
                  })()}
                  {inv.currency === 'USD' && (
                    <div className="text-xs text-gray-500 font-normal">{fmt(inv.total)} USD @ {inv.exchangeRate}</div>
                  )}
                </td>
                <td className="px-5 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${invoiceStatusColor[inv.invoiceStatus]}`}>
                    {invoiceStatusAr[inv.invoiceStatus]}
                  </span>
                </td>
                <td className="px-5 py-3">
                  {(() => {
                    const s = effectiveCollectionStatus(inv);
                    const icon =
                      s === 'Paid' ? { icon: 'check_circle', cls: 'text-green-400', label: collectionStatusAr[s] } :
                      { icon: 'cancel', cls: 'text-red-500', label: collectionStatusAr[s] };
                    return (
                      <span className="flex items-center gap-1.5">
                        <span className={`material-icons text-lg ${icon.cls}`} style={{ fontSize: '18px' }}>{icon.icon}</span>
                        <span className={`text-xs font-medium ${icon.cls}`}>{icon.label}</span>
                      </span>
                    );
                  })()}
                </td>
                <td className="px-2 py-3">
                  <span className="material-icons text-gray-500 text-base">chevron_left</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── Screen: Create / Edit Invoice ────────────────────────────────────────────

const emptyForm = (): Omit<Invoice, 'id' | 'payments' | 'collectionStatus' | 'paymentStatus' | 'lastFollowUp' | 'nextFollowUp' | 'notes'> => ({
  invoiceNo: '',
  customer: '',
  projectName: '',
  invoiceDate: new Date().toISOString().slice(0, 10),
  dueDate: '',
  amount: 0,
  tax: 0,
  total: 0,
  invoiceStatus: 'Sent',
  currency: 'EGP',
  exchangeRate: 0,
  invoiceType: 'توريدات',
  withholdingTax: 0,
  invoiceNotes: '',
});

const CreateInvoiceScreen: React.FC<{
  editing: Invoice | null;
  invoices: Invoice[];
  onSave: (data: Partial<Invoice>) => void;
  onAddCreditNote?: (cn: Omit<CreditNote, 'id'>) => void;
  onCancel: () => void;
  user: User;
}> = ({ editing, invoices, onSave, onAddCreditNote, onCancel, user }) => {
  const [activeTab, setActiveTab] = useState<'invoice' | 'credit-notes'>('invoice');
  const [form, setForm] = useState(() => {
    if (editing) {
      const amt = editing.amount || 0;
      const tax = (editing.tax > 0) ? editing.tax : Math.round(amt * 0.14 * 100) / 100;
      const rate = (editing.invoiceType || 'توريدات') === 'خدمات' ? 0.03 : 0.01;
      return { invoiceNo: editing.invoiceNo, customer: editing.customer, projectName: editing.projectName || '', invoiceDate: editing.invoiceDate, dueDate: editing.dueDate, amount: amt, tax, total: amt + tax, invoiceStatus: editing.invoiceStatus, currency: editing.currency || 'EGP', exchangeRate: editing.exchangeRate || 0, invoiceType: editing.invoiceType || 'توريدات', withholdingTax: editing.withholdingTax > 0 ? editing.withholdingTax : Math.round(amt * rate * 100) / 100, invoiceNotes: editing.invoiceNotes || '' };
    }
    return emptyForm();
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [uploadedName, setUploadedName] = useState(editing?.pdfName || '');
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(editing?.pdfData || '');
  const [pdfData, setPdfData] = useState<string>(editing?.pdfData || '');
  const [pdfName, setPdfName] = useState<string>(editing?.pdfName || '');
  const [parseResult, setParseResult] = useState<{ status: 'idle' | 'success' | 'partial' | 'error'; message: string; matchedFields?: string[] }>({ status: 'idle', message: '' });

  // ── ETA portal import ──────────────────────────────────────────────────────
  interface EtaRow { uuid: string; internalId: string; issuerName: string; receiverName: string; dateTimeIssued: string; netAmount: number; total: number }
  const [etaOpen,       setEtaOpen]       = useState(false);
  const [etaLoading,    setEtaLoading]    = useState(false);
  const [etaError,      setEtaError]      = useState('');
  const [etaRows,       setEtaRows]       = useState<EtaRow[]>([]);
  const [etaNextToken,  setEtaNextToken]  = useState('');
  const [etaTokenStack, setEtaTokenStack] = useState<string[]>([]);
  const [etaTotalCount, setEtaTotalCount] = useState(0);
  const [etaDateFrom,   setEtaDateFrom]   = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); });
  const [etaDateTo,     setEtaDateTo]     = useState(() => new Date().toISOString().slice(0, 10));
  const [etaClientId,   setEtaClientId]   = useState('');
  const [etaClientSec,  setEtaClientSec]  = useState('');
  const [etaClientSec2, setEtaClientSec2] = useState('');
  const [showEtaCreds,  setShowEtaCreds]  = useState(false);
  const [etaImporting,  setEtaImporting]  = useState('');
  const [etaPdfLoading, setEtaPdfLoading] = useState('');
  const [etaPdfPreview, setEtaPdfPreview] = useState<{ uuid: string; name: string; url: string } | null>(null);

  // Sorting state for ETA list
  const [etaSortCol, setEtaSortCol] = useState<string>('dateTimeIssued');
  const [etaSortDir, setEtaSortDir] = useState<SortDir>('desc');

  const handleEtaSort = (col: string) => {
    setEtaSortDir(prev => etaSortCol === col && prev === 'asc' ? 'desc' : 'asc');
    setEtaSortCol(col);
  };

  const sortedEtaRows = useMemo(() => {
    if (!etaSortCol) return etaRows;
    return [...etaRows].sort((a, b) => {
      let v = 0;
      if (etaSortCol === 'internalId') v = cmp(a.internalId, b.internalId);
      else if (etaSortCol === 'receiverName') v = cmp(a.receiverName, b.receiverName);
      else if (etaSortCol === 'dateTimeIssued') v = cmp(a.dateTimeIssued, b.dateTimeIssued);
      else if (etaSortCol === 'total') v = cmp(a.total, b.total);
      return applySortDir(v, etaSortDir);
    });
  }, [etaRows, etaSortCol, etaSortDir]);

  const isImported = (internalId: string) => {
    return invoices.some(inv => inv.invoiceNo === internalId);
  };

  const exportEtaReportCsv = () => {
    const headers = ['رقم الفاتورة', 'العميل', 'التاريخ', 'الإجمالي', 'حالة الاستيراد'];
    const dataRows = sortedEtaRows.map(row => [
      row.internalId,
      row.receiverName,
      row.dateTimeIssued,
      `${row.total.toFixed(2)} EGP`,
      isImported(row.internalId) ? 'مستوردة (Imported)' : 'غير مستوردة (New)'
    ]);
    
    // Add BOM (\uFEFF) for Excel Arabic support
    const csvContent = "\uFEFF" + [headers, ...dataRows].map(r => r.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `تقرير_فواتير_ETA_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const printEtaReport = () => {
    const w = window.open('', '_blank');
    if (!w) { alert('يرجى السماح بالنوافذ المنبثقة لطباعة التقرير.'); return; }
    
    const totalCount = sortedEtaRows.length;
    const importedCount = sortedEtaRows.filter(r => isImported(r.internalId)).length;
    const newCount = totalCount - importedCount;
    const totalValue = sortedEtaRows.reduce((s, r) => s + r.total, 0);

    w.document.write(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8">
        <title>تقرير فواتير بوابة الضرائب المصرية (ETA)</title>
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
        <style>
          body {
            font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
            padding: 30px;
            color: #1e293b;
            background: #fff;
            max-width: 1000px;
            margin: 0 auto;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid #e2e8f0;
            padding-bottom: 15px;
            margin-bottom: 25px;
          }
          .title-section h1 {
            color: #1e3a8a;
            font-size: 22px;
            margin: 0;
            font-weight: 800;
          }
          .title-section p {
            color: #64748b;
            font-size: 13px;
            margin: 5px 0 0 0;
          }
          .stats-grid {
            display: grid;
            grid-template-cols: repeat(4, 1fr);
            gap: 15px;
            margin-bottom: 25px;
          }
          .stat-card {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 10px;
            padding: 15px;
            text-align: center;
          }
          .stat-card h3 {
            margin: 0;
            font-size: 12px;
            color: #64748b;
            font-weight: 600;
          }
          .stat-card p {
            margin: 5px 0 0 0;
            font-size: 18px;
            font-weight: 700;
            color: #0f172a;
          }
          .stat-card.imported p { color: #16a34a; }
          .stat-card.new p { color: #2563eb; }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
            font-size: 13px;
          }
          th, td {
            border: 1px solid #e2e8f0;
            padding: 10px 12px;
            text-align: right;
          }
          th {
            background: #f1f5f9;
            color: #334155;
            font-weight: 700;
          }
          tr:nth-child(even) {
            background: #f8fafc;
          }
          .status {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 600;
          }
          .status.imported {
            background: #dcfce7;
            color: #166534;
          }
          .status.new {
            background: #dbeafe;
            color: #1e40af;
          }
          .footer {
            text-align: center;
            font-size: 11px;
            color: #94a3b8;
            margin-top: 40px;
            border-top: 1px solid #e2e8f0;
            padding-top: 15px;
          }
          @media print {
            body { padding: 0; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="title-section">
            <h1>تقرير فواتير بوابة الضرائب المصرية (ETA)</h1>
            <p>تم إصداره في: ${new Date().toLocaleString('ar-EG')}</p>
          </div>
          <div class="no-print">
            <button onclick="window.print()" style="background: #1e3a8a; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer; font-family: 'Cairo';">طباعة التقرير</button>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <h3>إجمالي الفواتير</h3>
            <p>${totalCount}</p>
          </div>
          <div class="stat-card imported">
            <h3>مستوردة سابقاً</h3>
            <p>${importedCount}</p>
          </div>
          <div class="stat-card new">
            <h3>جديدة (غير مستوردة)</h3>
            <p>${newCount}</p>
          </div>
          <div class="stat-card">
            <h3>القيمة الإجمالية</h3>
            <p>${totalValue.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP</p>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>رقم الفاتورة</th>
              <th>العميل</th>
              <th>التاريخ</th>
              <th style="text-align: left;">الإجمالي</th>
              <th style="text-align: center;">حالة الاستيراد</th>
            </tr>
          </thead>
          <tbody>
            ${sortedEtaRows.map(row => `
              <tr>
                <td style="font-family: monospace; font-weight: bold;">${row.internalId}</td>
                <td>${row.receiverName}</td>
                <td>${row.dateTimeIssued}</td>
                <td style="text-align: left; font-weight: bold;">${row.total.toLocaleString('ar-EG', { minimumFractionDigits: 2 })} EGP</td>
                <td style="text-align: center;">
                  ${isImported(row.internalId) 
                    ? '<span class="status imported">مستوردة</span>' 
                    : '<span class="status new">غير مستوردة</span>'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="footer">
          نظام Capture Flow المالي ومتابعة التحصيلات
        </div>
        <script>
          window.onload = () => {
            setTimeout(() => { window.print(); }, 500);
          }
        </script>
      </body>
      </html>
    `);
    w.document.close();
  };

  // Load ETA credentials: Supabase first (cross-device), fall back to localStorage
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from('operator_settings')
          .select('key, value')
          .eq('operator_id', user.username)
          .in('key', ['eta_client_id', 'eta_client_sec', 'eta_client_sec2']);
        if (!error && data && data.length > 0) {
          const map: Record<string, string> = Object.fromEntries(data.map((r: { key: string; value: string }) => [r.key, r.value]));
          setEtaClientId(map.eta_client_id   ?? '');
          setEtaClientSec(map.eta_client_sec  ?? '');
          setEtaClientSec2(map.eta_client_sec2 ?? '');
          return;
        }
      } catch { /* ignore */ }
      // Fallback: localStorage (works even if table doesn't exist yet)
      setEtaClientId(localStorage.getItem('eta_client_id')   ?? '');
      setEtaClientSec(localStorage.getItem('eta_client_sec')  ?? '');
      setEtaClientSec2(localStorage.getItem('eta_client_sec2') ?? '');
    })();
  }, [user.username]);

  const saveEtaCreds = async () => {
    // Always save to localStorage for instant availability
    localStorage.setItem('eta_client_id',   etaClientId);
    localStorage.setItem('eta_client_sec',  etaClientSec);
    localStorage.setItem('eta_client_sec2', etaClientSec2);
    // Also save to Supabase for cross-device sync (requires operator_settings table)
    try {
      const rows = [
        { operator_id: user.username, key: 'eta_client_id',   value: etaClientId },
        { operator_id: user.username, key: 'eta_client_sec',  value: etaClientSec },
        { operator_id: user.username, key: 'eta_client_sec2', value: etaClientSec2 },
      ];
      await supabase.from('operator_settings').upsert(rows, { onConflict: 'operator_id,key' });
    } catch { /* ignore if table doesn't exist yet */ }
    setShowEtaCreds(false);
  };

  const etaCall = async (body: object): Promise<any> => {
    const call = (secret: string) => fetch('/api/eta-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, clientId: etaClientId, clientSecret: secret }),
    }).then(r => r.json());
    const data = await call(etaClientSec);
    if (!data.ok && etaClientSec2 && (data.error ?? '').toLowerCase().includes('auth')) return call(etaClientSec2);
    return data;
  };

  const fetchEtaList = async (continuationToken = '', resetStack = true) => {
    if (!etaClientId || !etaClientSec) { setShowEtaCreds(true); return; }
    setEtaLoading(true); setEtaError('');
    try {
      const body: any = { action: 'list-sent' };
      if (etaDateFrom) body.issueDateFrom = etaDateFrom + 'T00:00:00';
      if (etaDateTo)   body.issueDateTo   = etaDateTo   + 'T23:59:59';
      if (continuationToken) body.continuationToken = continuationToken;
      const data = await etaCall(body);
      if (!data.ok) throw new Error(data.error ?? 'خطأ في الاتصال بالبوابة');
      setEtaRows(data.invoices ?? []);
      setEtaNextToken(data.continuationToken ?? '');
      setEtaTotalCount(data.totalCount ?? 0);
      if (resetStack) setEtaTokenStack([]);
    } catch (e: any) { setEtaError(e.message); }
    finally { setEtaLoading(false); }
  };

  const etaNextPage = () => { if (!etaNextToken) return; setEtaTokenStack(s => [...s, etaNextToken]); fetchEtaList(etaNextToken, false); };
  const etaPrevPage = () => { const s = [...etaTokenStack]; s.pop(); setEtaTokenStack(s); fetchEtaList(s[s.length - 1] ?? '', false); };

  const importEtaRow = async (row: EtaRow) => {
    if (isImported(row.internalId)) {
      const confirmImport = window.confirm(`الفاتورة رقم "${row.internalId}" تم استيرادها من قبل بالفعل.\nهل تريد بالتأكيد استيرادها مرة أخرى؟`);
      if (!confirmImport) return;
    }
    setEtaImporting(row.uuid);
    try {
      const data = await etaCall({ action: 'get', uuid: row.uuid });
      const inv = data.ok ? data.invoice : null;
      const add30 = (iso: string) => { const d = new Date(iso); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); };
      setForm(f => {
        const amt = inv?.amount > 0 ? inv.amount : row.netAmount > 0 ? row.netAmount : f.amount;
        const tax = inv?.tax > 0 ? inv.tax : Math.round(amt * 0.14 * 100) / 100;
        const total = inv?.total > 0 ? inv.total : row.total > 0 ? row.total : amt + tax;
        const rate = (f.invoiceType === 'خدمات') ? 0.03 : 0.01;
        return {
          ...f,
          invoiceNo:      inv?.invoiceNo   || row.internalId   || f.invoiceNo,
          customer:       inv?.receiver    || row.receiverName  || f.customer,
          invoiceDate:    inv?.invoiceDate || row.dateTimeIssued || f.invoiceDate,
          dueDate:        (inv?.invoiceDate || row.dateTimeIssued) ? add30(inv?.invoiceDate || row.dateTimeIssued) : f.dueDate,
          amount:         amt,
          tax,
          total,
          withholdingTax: Math.round(amt * rate * 100) / 100,
        };
      });
      setEtaOpen(false);
    } catch {
      const add30 = (iso: string) => { const d = new Date(iso); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); };
      setForm(f => {
        const amt = row.netAmount || f.amount;
        const tax = Math.round(amt * 0.14 * 100) / 100;
        const rate = (f.invoiceType === 'خدمات') ? 0.03 : 0.01;
        return { ...f, invoiceNo: row.internalId || f.invoiceNo, invoiceDate: row.dateTimeIssued || f.invoiceDate, dueDate: row.dateTimeIssued ? add30(row.dateTimeIssued) : f.dueDate, amount: amt, tax, total: row.total || amt + tax, withholdingTax: Math.round(amt * rate * 100) / 100 };
      });
      setEtaOpen(false);
    } finally { setEtaImporting(''); }
  };

  const previewEtaPdf = async (row: EtaRow) => {
    if (etaPdfLoading) return;
    setEtaPdfLoading(row.uuid);
    try {
      const data = await etaCall({ action: 'pdf', uuid: row.uuid });
      if (!data.ok || !data.pdf) throw new Error('no pdf');
      const bytes = atob(data.pdf);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
      setEtaPdfPreview({ uuid: row.uuid, name: `${row.internalId || row.uuid}.pdf`, url });
    } catch {
      alert('تعذّر تحميل ملف PDF من بوابة ETA');
    } finally {
      setEtaPdfLoading('');
    }
  };

  // Credit note form (only used when editing)
  const [cnForm, setCnForm] = useState({ date: new Date().toISOString().slice(0, 10), pretaxAmount: '', reason: '', referenceNo: '' });
  const [cnSaved, setCnSaved] = useState(false);
  const setCn = (k: string, v: string) => setCnForm(f => ({ ...f, [k]: v }));

  const whRate = editing?.invoiceType === 'خدمات' ? 0.03 : 0.01;
  const cnPretax = Number(cnForm.pretaxAmount) || 0;
  const cnVat = Math.round(cnPretax * 0.14 * 100) / 100;
  const cnWithholding = Math.round(cnPretax * whRate * 100) / 100;
  const cnNet = Math.round((cnPretax + cnVat - cnWithholding) * 100) / 100;

  const handleCnSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onAddCreditNote || cnPretax <= 0) return;
    onAddCreditNote({
      date: cnForm.date,
      pretaxAmount: cnPretax,
      vat: cnVat,
      withholding: cnWithholding,
      amount: cnNet,
      reason: cnForm.reason,
      referenceNo: cnForm.referenceNo || undefined,
    });
    setCnForm({ date: new Date().toISOString().slice(0, 10), pretaxAmount: '', reason: '', referenceNo: '' });
    setCnSaved(true);
    setTimeout(() => setCnSaved(false), 2000);
  };
  const [cnSortCol, setCnSortCol] = useState<string | null>(null);
  const [cnSortDir, setCnSortDir] = useState<SortDir>('asc');
  const handleCnSort = (col: string) => {
    setCnSortDir(prev => cnSortCol === col && prev === 'asc' ? 'desc' : 'asc');
    setCnSortCol(col);
  };
  const rawCreditNotes = editing?.creditNotes ?? [];
  const creditNotes = cnSortCol
    ? [...rawCreditNotes].sort((a, b) => {
        let v = 0;
        if (cnSortCol === 'date') v = cmp(a.date, b.date);
        else if (cnSortCol === 'pretaxAmount') v = cmp(a.pretaxAmount ?? a.amount, b.pretaxAmount ?? b.amount);
        else if (cnSortCol === 'amount') v = cmp(a.amount, b.amount);
        else if (cnSortCol === 'referenceNo') v = cmp(a.referenceNo, b.referenceNo);
        else if (cnSortCol === 'reason') v = cmp(a.reason, b.reason);
        return applySortDir(v, cnSortDir);
      })
    : rawCreditNotes;
  const creditTotal = creditNotes.reduce((s, c) => s + c.amount, 0);

  // Revoke blob URL on unmount (only blob: URLs — data: URLs don't need revoking)
  useEffect(() => {
    return () => { if (pdfPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(pdfPreviewUrl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k: string, v: string | number) =>
    setForm(f => {
      const next = { ...f, [k]: v };
      if (k === 'amount' || k === 'tax' || k === 'invoiceType') {
        if (k === 'amount') {
          next.tax = Math.round(Number(next.amount) * 0.14 * 100) / 100;
        }
        next.total = Number(next.amount) + Number(next.tax);
        const rate = next.invoiceType === 'خدمات' ? 0.03 : 0.01;
        next.withholdingTax = Math.round(Number(next.amount) * rate * 100) / 100;
      }
      return next;
    });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      setParseResult({ status: 'error', message: 'الرجاء رفع ملف PDF فقط' });
      e.target.value = '';
      return;
    }

    setParsing(true);
    setUploadedName(file.name);
    setPdfName(file.name);
    setParseResult({ status: 'idle', message: '' });

    // Read file as base64 data URL so it can be persisted with the invoice.
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    setPdfData(dataUrl);
    setPdfPreviewUrl(prev => {
      if (prev.startsWith('blob:')) URL.revokeObjectURL(prev);
      return dataUrl;
    });

    try {
      const parsed: ParsedInvoice = await parseInvoicePdf(file);

      // Fuzzy-map the OCR customer against the master CUSTOMERS list so the
      // dropdown can preselect the right option. If no match, fall back to raw.
      const mappedCustomer = matchCustomer(parsed.customer) || parsed.customer;

      // Apply extracted values to form (only non-empty to avoid blanking existing input)
      setForm(f => ({
        ...f,
        invoiceNo: parsed.invoiceNo || f.invoiceNo,
        customer: mappedCustomer || f.customer,
        invoiceDate: parsed.invoiceDate || f.invoiceDate,
        dueDate: parsed.dueDate || f.dueDate,
        amount: parsed.amount || f.amount,
        tax: parsed.tax || f.tax,
        total: parsed.total || (parsed.amount + parsed.tax) || f.total,
      }));

      const matchedKeys = Object.entries(parsed.matched).filter(([, v]) => v).map(([k]) => k);
      const labels: Record<string, string> = {
        invoiceNo: 'رقم الفاتورة',
        customer: 'العميل',
        invoiceDate: 'التاريخ',
        amount: 'المبلغ',
        tax: 'الضريبة',
        total: 'الإجمالي',
      };
      const matchedLabels = matchedKeys.map(k => labels[k]).filter(Boolean);

      if (matchedKeys.length >= 4) {
        setParseResult({ status: 'success', message: `تم استخراج ${matchedKeys.length} حقول تلقائياً`, matchedFields: matchedLabels });
      } else if (matchedKeys.length > 0) {
        setParseResult({ status: 'partial', message: 'تم استخراج بعض الحقول — راجع البيانات', matchedFields: matchedLabels });
      } else {
        setParseResult({ status: 'error', message: 'تعذر استخراج البيانات — قد يكون الملف صورة ممسوحة ضوئياً' });
      }
    } catch (err: any) {
      console.error('PDF parse error:', err);
      setParseResult({ status: 'error', message: `فشل قراءة الملف: ${err?.message || 'خطأ غير معروف'}` });
    } finally {
      setParsing(false);
      e.target.value = '';
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...form,
      amount: Number(form.amount),
      tax: Number(form.tax),
      total: Number(form.total),
      currency: (form.currency as 'EGP' | 'USD') || 'EGP',
      exchangeRate: form.currency === 'USD' ? Number(form.exchangeRate) : undefined,
      invoiceType: form.invoiceType as 'توريدات' | 'خدمات',
      withholdingTax: Number(form.withholdingTax),
      invoiceNotes: form.invoiceNotes || '',
      pdfData: pdfData || undefined,
      pdfName: pdfName || undefined,
    });
  };

  const resultStyles = {
    idle: '',
    success: 'bg-green-900/30 border-green-700 text-green-300',
    partial: 'bg-yellow-900/30 border-yellow-700 text-yellow-300',
    error: 'bg-red-900/30 border-red-700 text-red-300',
  };
  const resultIcons = {
    idle: '',
    success: 'check_circle',
    partial: 'warning',
    error: 'error',
  };

  return (
    <div className="space-y-0">
      {/* Tabs — only shown when editing */}
      {editing && (
        <div className="flex border-b border-gray-700 mb-5">
          <button
            type="button"
            onClick={() => setActiveTab('invoice')}
            className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${activeTab === 'invoice' ? 'border-primary text-primary' : 'border-transparent text-gray-400 hover:text-white'}`}
          >
            <span className="material-icons text-sm align-middle ml-1">receipt_long</span>
            تفاصيل الفاتورة
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('credit-notes')}
            className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${activeTab === 'credit-notes' ? 'border-orange-400 text-orange-400' : 'border-transparent text-gray-400 hover:text-white'}`}
          >
            <span className="material-icons text-sm">remove_circle_outline</span>
            إشعار دائن
            {creditNotes.length > 0 && (
              <span className="bg-orange-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                {creditNotes.length}
              </span>
            )}
          </button>
        </div>
      )}

      {activeTab === 'credit-notes' && editing ? (
        <div className="space-y-5 max-w-2xl">
          {/* Add Credit Note Form */}
          <div className="bg-[#232b3e] rounded-xl border border-orange-700/40 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-2">
              <span className="material-icons text-orange-400 text-lg">remove_circle_outline</span>
              <h3 className="font-semibold text-white">إضافة إشعار دائن</h3>
              <span className="text-xs text-gray-500 mr-1">— {editing.invoiceNo}</span>
            </div>
            <form onSubmit={handleCnSubmit} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="تاريخ الإشعار" required>
                  <input type="date" value={cnForm.date} onChange={e => setCn('date', e.target.value)} required className={inputCls} />
                </Field>
                <Field label="المبلغ قبل الضريبة (EGP)" required>
                  <input type="number" step="any" min={0.01} value={cnForm.pretaxAmount} onChange={e => setCn('pretaxAmount', e.target.value)} required className={inputCls} placeholder="0" />
                </Field>
                <Field label="رقم المرجع">
                  <input type="text" value={cnForm.referenceNo} onChange={e => setCn('referenceNo', e.target.value)} className={inputCls} placeholder="CN-0001" />
                </Field>
              </div>
              <Field label="سبب الإشعار الدائن" required>
                <textarea value={cnForm.reason} onChange={e => setCn('reason', e.target.value)} required rows={2} className={`${inputCls} resize-none`} placeholder="مثال: خصم جزئي، مرتجع بضاعة، تعديل سعر..." />
              </Field>

              {cnPretax > 0 && (
                <div className="bg-[#1b2130] rounded-xl border border-gray-700 overflow-hidden">
                  <div className="px-4 py-2 border-b border-gray-700 bg-[#161d2e]">
                    <span className="text-xs text-gray-400 font-semibold">تفاصيل الإشعار الدائن</span>
                  </div>
                  <div className="divide-y divide-gray-700/50">
                    <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span className="text-gray-400">المبلغ قبل الضريبة</span>
                      <span className="text-white font-medium">{fmt(cnPretax)} EGP</span>
                    </div>
                    <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span className="text-gray-400">ضريبة القيمة المضافة (14%)</span>
                      <span className="text-blue-300 font-medium">+ {fmt(cnVat)} EGP</span>
                    </div>
                    <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span className="text-yellow-400">خصم الضريبة التحت حساب ({editing?.invoiceType === 'خدمات' ? '3%' : '1%'} {editing?.invoiceType ?? 'توريدات'})</span>
                      <span className="text-yellow-300 font-medium">- {fmt(cnWithholding)} EGP</span>
                    </div>
                    <div className="flex items-center justify-between px-4 py-3 bg-[#161d2e]">
                      <span className="text-white font-semibold">صافي الإشعار المخصوم</span>
                      <span className="text-orange-400 font-bold text-lg">{fmt(cnNet)} EGP</span>
                    </div>
                    <div className="flex items-center justify-between px-4 py-3 border-t border-orange-700/30 bg-[#1e1408]">
                      <span className="text-gray-300 text-sm">إجمالي الفاتورة بعد الخصم</span>
                      <span className="text-green-400 font-bold text-lg">{fmt(editing!.total - (editing!.withholdingTax || 0) - creditTotal - cnNet)} EGP</span>
                    </div>
                  </div>
                </div>
              )}

              <button type="submit" className="flex items-center gap-2 bg-orange-700 hover:bg-orange-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors">
                <span className="material-icons text-sm">{cnSaved ? 'check' : 'add'}</span>
                {cnSaved ? 'تم إضافة الإشعار' : 'إضافة الإشعار الدائن'}
              </button>
            </form>
          </div>

          {/* Credit Notes List */}
          <div className="bg-[#232b3e] rounded-xl border border-gray-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-icons text-orange-400 text-lg">list_alt</span>
                <h3 className="font-semibold text-white">الإشعارات الدائنة المسجّلة</h3>
              </div>
              {creditTotal > 0 && (
                <span className="text-orange-300 font-semibold text-sm">إجمالي الخصم: {fmt(creditTotal)} EGP</span>
              )}
            </div>
            {creditNotes.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">لا توجد إشعارات دائنة مسجّلة</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-xs border-b border-gray-700 bg-[#1b2130]">
                    <SortTh label="التاريخ" col="date" sortCol={cnSortCol} sortDir={cnSortDir} onSort={handleCnSort} />
                    <SortTh label="قبل الضريبة" col="pretaxAmount" sortCol={cnSortCol} sortDir={cnSortDir} onSort={handleCnSort} />
                    <th className="px-4 py-3 text-right">VAT 14%</th>
                    <th className="px-4 py-3 text-right">خصم ض.ت.ح</th>
                    <SortTh label="الصافي المخصوم" col="amount" sortCol={cnSortCol} sortDir={cnSortDir} onSort={handleCnSort} />
                    <SortTh label="المرجع" col="referenceNo" sortCol={cnSortCol} sortDir={cnSortDir} onSort={handleCnSort} />
                    <SortTh label="السبب" col="reason" sortCol={cnSortCol} sortDir={cnSortDir} onSort={handleCnSort} />
                  </tr>
                </thead>
                <tbody>
                  {creditNotes.map(cn => (
                    <tr key={cn.id} className="border-b border-gray-700/50">
                      <td className="px-4 py-3 text-gray-300">{cn.date}</td>
                      <td className="px-4 py-3 text-gray-300">{fmt(cn.pretaxAmount ?? cn.amount)} EGP</td>
                      <td className="px-4 py-3 text-blue-300">+ {fmt(cn.vat ?? 0)} EGP</td>
                      <td className="px-4 py-3 text-yellow-300">- {fmt(cn.withholding ?? 0)} EGP</td>
                      <td className="px-4 py-3 text-orange-400 font-semibold">- {fmt(cn.amount)} EGP</td>
                      <td className="px-4 py-3 text-gray-400 font-mono text-xs">{cn.referenceNo || '—'}</td>
                      <td className="px-4 py-3 text-gray-300">{cn.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : (
      <div className={`grid gap-5 ${pdfPreviewUrl ? 'lg:grid-cols-2' : ''}`}>
      {/* PDF Preview — appears on the right in RTL */}
      {pdfPreviewUrl && (
        <div className="order-2 lg:order-2 bg-[#232b3e] rounded-xl border border-gray-700 overflow-hidden flex flex-col min-h-[600px]">
          <div className="px-5 py-3 border-b border-gray-700 flex items-center gap-2 bg-[#1b2130]">
            <span className="material-icons text-primary text-lg">picture_as_pdf</span>
            <h4 className="text-sm font-semibold text-white">معاينة الفاتورة</h4>
            <span className="mr-auto text-xs text-gray-500 truncate max-w-[200px]" title={uploadedName}>{uploadedName}</span>
            <a
              href={pdfPreviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-primary transition-colors"
              title="فتح في نافذة جديدة"
            >
              <span className="material-icons text-base">open_in_new</span>
            </a>
          </div>
          <iframe
            src={pdfPreviewUrl}
            title="PDF Preview"
            className="flex-1 w-full bg-white"
            style={{ minHeight: '600px' }}
          />
        </div>
      )}

      {/* Form */}
      <div className="order-1 lg:order-1 w-full bg-[#232b3e] rounded-xl border border-gray-700 overflow-hidden self-start">
        <div className="px-6 py-4 border-b border-gray-700 flex items-center gap-2">
          <span className="material-icons text-primary">receipt_long</span>
          <h3 className="font-semibold text-white">{editing ? 'تعديل الفاتورة' : 'فاتورة جديدة'}</h3>
        </div>

        {/* ETA Portal Import (hidden when editing) */}
        {!editing && (
          <div className="px-6 pt-4 pb-4 border-b border-gray-700 bg-[#1b2130]/60">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="material-icons text-blue-400 text-lg">cloud_download</span>
                <span className="text-sm font-semibold text-white">استيراد من بوابة ETA</span>
                <span className="text-xs text-gray-500">(الفواتير الصادرة)</span>
              </div>
              <button type="button" onClick={() => { setEtaOpen(o => !o); if (!etaOpen) fetchEtaList(); }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-blue-700/80 hover:bg-blue-600 text-white transition-colors">
                <span className="material-icons text-sm">{etaOpen ? 'expand_less' : 'receipt_long'}</span>
                {etaOpen ? 'إغلاق' : 'عرض الفواتير'}
              </button>
            </div>

            {etaOpen && (
              <div className="mt-3 space-y-3">
                {/* Credentials */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <span className={`material-icons text-sm ${etaClientId ? 'text-green-400' : 'text-gray-500'}`}>{etaClientId ? 'lock' : 'lock_open'}</span>
                    {etaClientId ? 'بيانات الاعتماد محفوظة' : 'لم يتم إدخال بيانات الاعتماد'}
                  </span>
                  <button type="button" onClick={() => setShowEtaCreds(v => !v)}
                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                    <span className="material-icons text-sm">settings</span>
                    {showEtaCreds ? 'إخفاء' : 'إعداد الاعتماد'}
                  </button>
                </div>
                {showEtaCreds && (
                  <div className="bg-[#232b3e] rounded-lg p-3 border border-blue-700/40 space-y-2">
                    <p className="text-xs text-yellow-300/80 bg-yellow-900/20 border border-yellow-700/30 rounded px-2 py-1">
                      Client ID و Client Secret الصادرَين من هيئة الضرائب عند تسجيل نظام ERP — ليست بيانات البوابة
                    </p>
                    <input value={etaClientId} onChange={e => setEtaClientId(e.target.value)} placeholder="Client ID"
                      className="w-full bg-[#1b2130] border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono" />
                    <input value={etaClientSec} onChange={e => setEtaClientSec(e.target.value)} placeholder="Client Secret 1" type="password"
                      className="w-full bg-[#1b2130] border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono" />
                    <input value={etaClientSec2} onChange={e => setEtaClientSec2(e.target.value)} placeholder="Client Secret 2 (احتياطي)" type="password"
                      className="w-full bg-[#1b2130] border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono" />
                    <button type="button" onClick={saveEtaCreds}
                      className="w-full py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-xs transition-colors">حفظ</button>
                  </div>
                )}
                {/* Filters */}
                <div className="space-y-2">
                  <div className="flex gap-1 flex-wrap">
                    {[
                      { label: 'آخر 30 يوم', days: 30 },
                      { label: '3 أشهر',     days: 90 },
                      { label: '6 أشهر',     days: 180 },
                      { label: 'سنة كاملة', days: 365 },
                    ].map(({ label, days }) => {
                      const from = (() => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); })();
                      const to   = new Date().toISOString().slice(0, 10);
                      const active = etaDateFrom === from && etaDateTo === to;
                      return (
                        <button key={days} type="button"
                          onClick={() => { setEtaDateFrom(from); setEtaDateTo(to); }}
                          className={`px-2 py-0.5 rounded text-xs transition-colors border ${active ? 'bg-blue-700 border-blue-500 text-white' : 'bg-[#1b2130] border-gray-700 text-gray-400 hover:border-blue-500 hover:text-white'}`}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex gap-2 flex-wrap items-end">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">من تاريخ</label>
                      <input type="date" value={etaDateFrom} onChange={e => setEtaDateFrom(e.target.value)}
                        className="bg-[#232b3e] border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">إلى تاريخ</label>
                      <input type="date" value={etaDateTo} onChange={e => setEtaDateTo(e.target.value)}
                        className="bg-[#232b3e] border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500" />
                    </div>
                    <button type="button" onClick={() => fetchEtaList()}
                      className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs bg-[#232b3e] border border-gray-600 text-gray-300 hover:text-white hover:border-blue-500 transition-colors">
                      <span className="material-icons text-sm">search</span> بحث
                    </button>
                    {etaRows.length > 0 && (
                      <div className="mr-auto flex gap-2">
                        <button
                          type="button"
                          onClick={exportEtaReportCsv}
                          className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs bg-green-950/40 border border-green-700/60 text-green-300 hover:text-white hover:bg-green-700 transition-colors font-medium"
                        >
                          <span className="material-icons text-sm">file_download</span>
                          تصدير إكسل
                        </button>
                        <button
                          type="button"
                          onClick={printEtaReport}
                          className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs bg-blue-950/40 border border-blue-700/60 text-blue-300 hover:text-white hover:bg-blue-700 transition-colors font-medium"
                        >
                          <span className="material-icons text-sm">print</span>
                          طباعة التقرير
                        </button>
                      </div>
                    )}
                  </div>
                  {(() => { const days = Math.round((new Date(etaDateTo).getTime() - new Date(etaDateFrom).getTime()) / 86_400_000); return days > 30 ? (
                    <p className="text-xs text-yellow-400/80 flex items-center gap-1">
                      <span className="material-icons text-sm">info</span>
                      نطاق {days} يوم — سيتم تقسيمه تلقائياً (قد يستغرق بضع ثوانٍ)
                    </p>
                  ) : null; })()}
                </div>
                {etaLoading && <div className="flex items-center gap-2 text-xs text-gray-400 py-3 justify-center"><span className="material-icons animate-spin text-blue-400 text-sm">refresh</span>جارٍ جلب الفواتير...</div>}
                {etaError && <div className="bg-red-900/30 border border-red-700/40 rounded-lg px-3 py-2 text-xs text-red-300">{etaError}</div>}
                {!etaLoading && etaRows.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-gray-700">
                    <table className="w-full text-xs text-right">
                      <thead className="bg-[#232b3e] text-gray-400">
                        <tr>
                          <SortTh label="رقم الفاتورة" col="internalId" sortCol={etaSortCol} sortDir={etaSortDir} onSort={handleEtaSort} className="px-3 py-2 text-right" />
                          <SortTh label="العميل" col="receiverName" sortCol={etaSortCol} sortDir={etaSortDir} onSort={handleEtaSort} className="px-3 py-2 text-right" />
                          <SortTh label="التاريخ" col="dateTimeIssued" sortCol={etaSortCol} sortDir={etaSortDir} onSort={handleEtaSort} className="px-3 py-2 text-right" />
                          <SortTh label="الإجمالي" col="total" sortCol={etaSortCol} sortDir={etaSortDir} onSort={handleEtaSort} className="px-3 py-2 text-left" />
                          <th className="px-3 py-2 text-center">PDF</th>
                          <th className="px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-700/50">
                        {sortedEtaRows.map(row => (
                          <tr key={row.uuid} className="hover:bg-[#2d3648] transition-colors">
                            <td className="px-3 py-2 text-gray-200 font-mono">{row.internalId}</td>
                            <td className="px-3 py-2 text-gray-300 max-w-[160px] truncate" title={row.receiverName}>{row.receiverName}</td>
                            <td className="px-3 py-2 text-gray-400">{row.dateTimeIssued}</td>
                            <td className="px-3 py-2 text-left text-green-400 font-medium">{row.total.toLocaleString()} EGP</td>
                            <td className="px-3 py-2 text-center">
                              <button
                                type="button"
                                title="معاينة PDF"
                                onClick={() => previewEtaPdf(row)}
                                disabled={etaPdfLoading === row.uuid}
                                className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-orange-700/30 text-orange-400 hover:text-orange-300 transition-colors disabled:opacity-40"
                              >
                                <span className={`material-icons text-base ${etaPdfLoading === row.uuid ? 'animate-spin text-gray-400' : ''}`}>
                                  {etaPdfLoading === row.uuid ? 'refresh' : 'picture_as_pdf'}
                                </span>
                              </button>
                            </td>
                            <td className="px-3 py-2">
                              {isImported(row.internalId) ? (
                                <button
                                  type="button"
                                  onClick={() => importEtaRow(row)}
                                  disabled={etaImporting === row.uuid}
                                  className="flex items-center gap-1 px-2 py-1 rounded bg-green-800/80 hover:bg-green-700 text-white transition-colors disabled:opacity-50 whitespace-nowrap border border-green-500"
                                >
                                  <span className={`material-icons text-xs ${etaImporting === row.uuid ? 'animate-spin' : ''}`}>{etaImporting === row.uuid ? 'refresh' : 'done'}</span>
                                  مستوردة
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => importEtaRow(row)}
                                  disabled={etaImporting === row.uuid}
                                  className="flex items-center gap-1 px-2 py-1 rounded bg-blue-700/70 hover:bg-blue-600 text-white transition-colors disabled:opacity-50 whitespace-nowrap"
                                >
                                  <span className={`material-icons text-xs ${etaImporting === row.uuid ? 'animate-spin' : ''}`}>{etaImporting === row.uuid ? 'refresh' : 'download'}</span>
                                  استيراد
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {!etaLoading && etaRows.length > 0 && (
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{etaTotalCount > 0 ? `${etaTotalCount} فاتورة` : `${etaRows.length} نتيجة`}</span>
                    <div className="flex gap-1">
                      <button type="button" disabled={etaTokenStack.length === 0} onClick={etaPrevPage}
                        className="px-2 py-1 rounded bg-[#232b3e] border border-gray-700 disabled:opacity-40 hover:border-blue-500 transition-colors">‹ السابق</button>
                      <button type="button" disabled={!etaNextToken} onClick={etaNextPage}
                        className="px-2 py-1 rounded bg-[#232b3e] border border-gray-700 disabled:opacity-40 hover:border-blue-500 transition-colors">التالي ›</button>
                    </div>
                  </div>
                )}
                {!etaLoading && !etaError && etaRows.length === 0 && <p className="text-center text-gray-500 text-xs py-3">لا توجد فواتير بهذه المعايير</p>}
              </div>
            )}
          </div>
        )}

        {/* ETA PDF Preview Modal */}
        {etaPdfPreview && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" dir="rtl">
            <div className="bg-[#1b2130] rounded-2xl border border-gray-700 shadow-2xl flex flex-col"
              style={{ width: '90vw', maxWidth: 900, height: '90vh' }}>
              <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-700 flex-shrink-0">
                <span className="material-icons text-orange-400">picture_as_pdf</span>
                <span className="text-sm font-semibold text-gray-200 flex-1 truncate">{etaPdfPreview.name}</span>
                <a
                  href={etaPdfPreview.url}
                  download={etaPdfPreview.name}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-orange-700 hover:bg-orange-600 text-white text-xs transition-colors"
                >
                  <span className="material-icons text-sm">download</span>
                  تحميل
                </a>
                <button
                  type="button"
                  onClick={() => { URL.revokeObjectURL(etaPdfPreview.url); setEtaPdfPreview(null); }}
                  className="flex items-center justify-center w-8 h-8 rounded-lg bg-gray-700 hover:bg-red-900/50 text-gray-400 hover:text-red-400 transition-colors"
                >
                  <span className="material-icons text-base">close</span>
                </button>
              </div>
              <iframe
                src={etaPdfPreview.url}
                title={etaPdfPreview.name}
                className="flex-1 w-full rounded-b-2xl"
                style={{ background: '#fff' }}
              />
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <Field label="رقم الفاتورة" required>
              <input type="text" value={form.invoiceNo} onChange={e => set('invoiceNo', e.target.value)} required className={inputCls} placeholder="INV-2025-005" />
            </Field>
            <Field label="العميل" required>
              <select
                value={form.customer}
                onChange={e => set('customer', e.target.value)}
                required
                className={inputCls}
              >
                <option value="">-- اختر العميل --</option>
                {CUSTOMERS.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
                {form.customer && !CUSTOMERS.includes(form.customer) && (
                  <option value={form.customer}>{form.customer}</option>
                )}
              </select>
              {form.customer && !CUSTOMERS.includes(form.customer) && (
                <p className="text-xs text-yellow-400 mt-1">
                  <span className="material-icons text-xs align-middle">info</span>
                  {' '}"{form.customer}" غير موجود في القائمة — يمكنك الحفظ أو اختيار عميل آخر
                </p>
              )}
            </Field>
            <Field label="اسم المشروع">
              <input type="text" value={form.projectName || ''} onChange={e => set('projectName', e.target.value)} className={inputCls} placeholder="اسم المشروع (اختياري)" />
            </Field>
            <Field label="تاريخ الفاتورة" required>
              <input type="date" value={form.invoiceDate} onChange={e => set('invoiceDate', e.target.value)} required className={inputCls} />
            </Field>
            <Field label="تاريخ الاستحقاق" required>
              <input type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} required className={inputCls} />
            </Field>
            <Field label="العملة" required>
              <select value={form.currency} onChange={e => set('currency', e.target.value)} className={inputCls}>
                <option value="EGP">EGP — جنيه مصري</option>
                <option value="USD">USD — دولار أمريكي</option>
              </select>
            </Field>
            {form.currency === 'USD' && (
              <Field label="سعر الصرف (EGP لكل 1 USD)" required>
                <input type="number" step="any" value={form.exchangeRate} onChange={e => set('exchangeRate', e.target.value)} min={0} required className={inputCls} placeholder="مثال: 48.5" />
              </Field>
            )}
            <Field label={`المبلغ (قبل الضريبة) — ${form.currency}`} required>
              <input type="number" step="any" value={form.amount} onChange={e => set('amount', e.target.value)} min={0} required className={inputCls} />
            </Field>
            <Field label={`الضريبة — ${form.currency}`}>
              <input type="number" step="any" value={form.tax} onChange={e => set('tax', e.target.value)} min={0} className={inputCls} />
            </Field>
            <Field label="نوع الفاتورة" required>
              <select value={form.invoiceType} onChange={e => set('invoiceType', e.target.value)} className={inputCls}>
                <option value="توريدات">توريدات</option>
                <option value="خدمات">خدمات</option>
              </select>
            </Field>
          </div>

          <div className="bg-[#1b2130] rounded-lg px-5 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-sm">الإجمالي شامل الضريبة</span>
              <div className="text-right">
                <div className="text-2xl font-bold text-white">{fmt(form.total)} <span className="text-sm text-gray-400">{form.currency}</span></div>
                {form.currency === 'USD' && Number(form.exchangeRate) > 0 && (
                  <div className="text-sm text-gray-400 mt-1">
                    ≈ {fmt(Number(form.total) * Number(form.exchangeRate))} <span className="text-xs">EGP</span>
                  </div>
                )}
              </div>
            </div>
            {Number(form.amount) > 0 && (
              <>
                <div className="flex items-center justify-between border-t border-gray-700 pt-3">
                  <span className="text-yellow-400 text-sm">
                    خصم الضريبة التحت حساب ({form.invoiceType === 'خدمات' ? '3%' : '1%'} {form.invoiceType})
                  </span>
                  <span className="text-yellow-300 font-semibold">- {fmt(Number(form.withholdingTax))} <span className="text-xs text-gray-400">{form.currency}</span></span>
                </div>
                <div className="flex items-center justify-between border-t border-gray-600 pt-3">
                  <span className="text-white text-sm font-semibold">الصافي بعد الخصم</span>
                  <span className="text-green-400 text-xl font-bold">{fmt(Number(form.total) - Number(form.withholdingTax))} <span className="text-xs text-gray-400">{form.currency}</span></span>
                </div>
              </>
            )}
          </div>

          <Field label="ملاحظات الفاتورة">
            <textarea
              value={form.invoiceNotes || ''}
              onChange={e => set('invoiceNotes', e.target.value)}
              rows={3}
              className={`${inputCls} resize-none`}
              placeholder="أضف ملاحظات على الفاتورة..."
            />
          </Field>

          <Field label="حالة الفاتورة">
            <select value={form.invoiceStatus} onChange={e => set('invoiceStatus', e.target.value)} className={inputCls}>
              <option value="Sent">{invoiceStatusAr.Sent}</option>
              <option value="Cancelled">{invoiceStatusAr.Cancelled}</option>
            </select>
          </Field>

          <div className="flex gap-3 pt-2">
            <button type="submit" className="flex-1 bg-primary hover:bg-blue-700 text-white py-2.5 rounded-lg text-sm font-medium transition-colors">
              {editing ? 'حفظ التعديلات' : 'إنشاء الفاتورة'}
            </button>
            <button type="button" onClick={onCancel} className="px-6 bg-[#1b2130] hover:bg-[#2d3648] text-gray-300 py-2.5 rounded-lg text-sm transition-colors">
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
      )}
    </div>
  );
};

// ─── Payment History Table (with inline editing for admins) ──────────────────

const PaymentHistoryTable: React.FC<{
  invoice: Invoice;
  canEdit?: boolean;
  onUpdatePayment?: (paymentId: string, patch: Partial<Payment>) => void;
  onDeletePayment?: (paymentId: string) => void;
}> = ({ invoice, canEdit, onUpdatePayment, onDeletePayment }) => {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    receiptDate: string;
    inputCurrency: 'EGP' | 'USD';
    amountInput: string;
    paymentMethod: string;
    referenceNo: string;
    notes: string;
  } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const isUSD = invoice.currency === 'USD';
  const rate = invoice.exchangeRate || 1;

  const startEdit = (p: Payment) => {
    // Determine displayed amount: prefer stored paymentCurrency + raw value
    const storedCurrency = p.paymentCurrency || (isUSD ? 'USD' : 'EGP');
    const displayAmount = storedCurrency === 'EGP' && isUSD
      ? p.amountReceivedEgp ?? p.amountReceived * rate
      : p.amountReceived;
    setEditingId(p.id);
    setEditForm({
      receiptDate: p.receiptDate,
      inputCurrency: storedCurrency,
      amountInput: String(displayAmount),
      paymentMethod: p.paymentMethod,
      referenceNo: p.referenceNo,
      notes: p.notes || '',
    });
  };

  const cancelEdit = () => { setEditingId(null); setEditForm(null); };

  const saveEdit = (p: Payment) => {
    if (!editForm || !onUpdatePayment) return;
    const raw = Number(editForm.amountInput) || 0;
    let amountReceived: number;
    let amountReceivedEgp: number | undefined;
    if (isUSD && editForm.inputCurrency === 'EGP') {
      amountReceived = raw / rate;   // store as USD
      amountReceivedEgp = raw;
    } else {
      amountReceived = raw;
      amountReceivedEgp = isUSD ? raw * rate : undefined;
    }
    onUpdatePayment(p.id, {
      receiptDate: editForm.receiptDate,
      amountReceived,
      amountReceivedEgp,
      paymentCurrency: editForm.inputCurrency,
      paymentMethod: editForm.paymentMethod,
      referenceNo: editForm.referenceNo,
      notes: editForm.notes || undefined,
    });
    setSavedId(p.id);
    setTimeout(() => { setSavedId(null); setEditingId(null); setEditForm(null); }, 1200);
  };

  const displayEgp = (p: Payment) =>
    p.amountReceivedEgp ?? (isUSD ? p.amountReceived * rate : p.amountReceived);

  return (
    <div className="bg-[#232b3e] rounded-xl border border-gray-700 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-2">
        <span className="material-icons text-green-400 text-lg">history</span>
        <h3 className="font-semibold text-white">سجل التحصيلات</h3>
        {canEdit && <span className="mr-auto text-xs text-gray-500">انقر ✏️ لتعديل أي دفعة</span>}
      </div>

      {invoice.payments.length === 0 ? (
        <div className="p-8 text-center text-gray-500 text-sm">لا توجد تحصيلات مسجّلة</div>
      ) : (
        <div className="divide-y divide-gray-700/50">
          {invoice.payments.map(p => {
            const isEditing = editingId === p.id && editForm;
            const egpAmt = displayEgp(p);
            const storedCur = p.paymentCurrency || (isUSD ? 'USD' : 'EGP');

            if (isEditing) {
              const previewRaw = Number(editForm.amountInput) || 0;
              const previewEgp = isUSD && editForm.inputCurrency === 'EGP' ? previewRaw : previewRaw * rate;
              const previewUsd = isUSD && editForm.inputCurrency === 'EGP' ? previewRaw / rate : previewRaw;

              return (
                <div key={p.id} className="p-4 bg-[#1e2a3a] border-r-4 border-yellow-500">
                  <p className="text-xs text-yellow-400 font-semibold mb-3 flex items-center gap-1">
                    <span className="material-icons text-sm">edit</span>
                    تعديل التحصيل
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
                    <Field label="تاريخ الاستلام" required>
                      <input type="date" value={editForm.receiptDate}
                        onChange={e => setEditForm(f => f ? { ...f, receiptDate: e.target.value } : f)}
                        className={inputCls} />
                    </Field>

                    <div className="space-y-1.5">
                      <label className="text-xs text-gray-400">
                        المبلغ المحصّل
                        {isUSD && (
                          <span className="mr-2 inline-flex rounded overflow-hidden border border-gray-600 text-xs align-middle">
                            <button type="button"
                              onClick={() => setEditForm(f => f ? { ...f, inputCurrency: 'USD' } : f)}
                              className={`px-2 py-0.5 transition-colors ${editForm.inputCurrency === 'USD' ? 'bg-blue-700 text-white' : 'bg-[#1b2130] text-gray-400 hover:text-white'}`}>USD</button>
                            <button type="button"
                              onClick={() => setEditForm(f => f ? { ...f, inputCurrency: 'EGP' } : f)}
                              className={`px-2 py-0.5 transition-colors ${editForm.inputCurrency === 'EGP' ? 'bg-green-700 text-white' : 'bg-[#1b2130] text-gray-400 hover:text-white'}`}>EGP</button>
                          </span>
                        )}
                      </label>
                      <div className="relative">
                        <input type="number" step="any" min={0.01}
                          value={editForm.amountInput}
                          onChange={e => setEditForm(f => f ? { ...f, amountInput: e.target.value } : f)}
                          className={inputCls} placeholder="0" />
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">
                          {isUSD ? editForm.inputCurrency : 'EGP'}
                        </span>
                      </div>
                      {isUSD && previewRaw > 0 && (
                        <p className="text-xs text-gray-400">
                          {editForm.inputCurrency === 'EGP'
                            ? <>≈ <span className="text-blue-300">{fmt(previewUsd)} USD</span></>
                            : <>≈ <span className="text-green-300">{fmt(previewEgp)} EGP</span></>
                          }
                        </p>
                      )}
                    </div>

                    <Field label="طريقة الدفع">
                      <select value={editForm.paymentMethod}
                        onChange={e => setEditForm(f => f ? { ...f, paymentMethod: e.target.value } : f)}
                        className={inputCls}>
                        {['تحويل بنكي', 'شيك', 'نقداً', 'بطاقة ائتمان', 'أخرى'].map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </Field>

                    <Field label="رقم المرجع">
                      <input type="text" value={editForm.referenceNo}
                        onChange={e => setEditForm(f => f ? { ...f, referenceNo: e.target.value } : f)}
                        className={inputCls} placeholder="TRF-0000" />
                    </Field>

                    <div className="col-span-2">
                      <Field label="ملاحظات">
                        <input type="text" value={editForm.notes}
                          onChange={e => setEditForm(f => f ? { ...f, notes: e.target.value } : f)}
                          className={inputCls} />
                      </Field>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button onClick={() => saveEdit(p)}
                      className="flex items-center gap-1.5 bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm transition-colors">
                      <span className="material-icons text-sm">{savedId === p.id ? 'check' : 'save'}</span>
                      {savedId === p.id ? 'تم الحفظ' : 'حفظ التعديل'}
                    </button>
                    <button onClick={cancelEdit}
                      className="px-4 py-2 bg-[#1b2130] hover:bg-[#2d3648] text-gray-400 rounded-lg text-sm transition-colors">
                      إلغاء
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={p.id} className="flex items-center gap-3 px-5 py-3 hover:bg-[#2d3648] transition-colors group">
                <span className="material-icons text-green-500 text-base shrink-0">payments</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-green-400 font-semibold">{fmt(egpAmt)} EGP</span>
                    {isUSD && (
                      <span className="text-xs text-gray-500">
                        ({fmt(p.amountReceived)} USD @ {rate})
                      </span>
                    )}
                    {storedCur !== (isUSD ? 'USD' : 'EGP') && (
                      <span className="text-xs bg-yellow-900/40 text-yellow-400 px-1.5 py-0.5 rounded">
                        أُدخل بـ {storedCur}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5 flex-wrap">
                    <span>{p.receiptDate}</span>
                    <span>{p.paymentMethod}</span>
                    {p.referenceNo && <span className="font-mono">{p.referenceNo}</span>}
                    {p.notes && <span className="truncate max-w-[200px]">{p.notes}</span>}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1 shrink-0">
                    {onUpdatePayment && (
                      <button onClick={() => startEdit(p)}
                        className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-yellow-400 transition-all">
                        <span className="material-icons text-base">edit</span>
                      </button>
                    )}
                    {onDeletePayment && (
                      confirmDeleteId === p.id ? (
                        <span className="flex items-center gap-1 text-xs">
                          <button onClick={() => { onDeletePayment(p.id); setConfirmDeleteId(null); }}
                            className="text-red-400 hover:text-red-300 font-semibold">حذف</button>
                          <button onClick={() => setConfirmDeleteId(null)}
                            className="text-gray-500 hover:text-gray-300">إلغاء</button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmDeleteId(p.id)}
                          className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all">
                          <span className="material-icons text-base">delete</span>
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── Screen: Invoice Details ──────────────────────────────────────────────────

const InvoiceDetailsScreen: React.FC<{
  invoice: Invoice;
  onEdit: () => void;
  onAddPayment: () => void;
  onUpdateCollection: (data: Pick<Invoice, 'collectionStatus' | 'lastFollowUp' | 'nextFollowUp' | 'notes'>) => void;
  onAddCreditNote: (cn: Omit<CreditNote, 'id'>) => void;
  onBack: () => void;
  canEdit?: boolean;
  onSaveCurrency?: (patch: Pick<Invoice, 'currency' | 'exchangeRate' | 'amount' | 'tax' | 'total' | 'withholdingTax'>) => void;
  onUpdatePayment?: (paymentId: string, patch: Partial<Payment>) => void;
  onDeletePayment?: (paymentId: string) => void;
}> = ({ invoice, onEdit, onAddPayment, onUpdateCollection, onAddCreditNote, onBack, canEdit, onSaveCurrency, onUpdatePayment, onDeletePayment }) => {
  const [detailTab, setDetailTab] = useState<'details' | 'credit-notes'>('details');
  const [followUp, setFollowUp] = useState({
    collectionStatus: invoice.collectionStatus,
    lastFollowUp: invoice.lastFollowUp,
    nextFollowUp: invoice.nextFollowUp,
    notes: invoice.notes,
  });
  const [saved, setSaved] = useState(false);

  // Currency quick-edit state (admin only)
  const [currencyEdit, setCurrencyEdit] = useState({
    currency: invoice.currency || 'EGP',
    exchangeRate: invoice.exchangeRate || 0,
    amount: invoice.amount,
    tax: invoice.tax,
  });
  const [currencySaved, setCurrencySaved] = useState(false);
  const [showCurrencyEdit, setShowCurrencyEdit] = useState(false);

  const ceTotal = Number(currencyEdit.amount) + Number(currencyEdit.tax);
  const whRate = invoice.invoiceType === 'خدمات' ? 0.03 : 0.01;
  const ceWithholding = Math.round(Number(currencyEdit.amount) * whRate * 100) / 100;

  const handleCurrencySave = () => {
    if (!onSaveCurrency) return;
    onSaveCurrency({
      currency: currencyEdit.currency as 'EGP' | 'USD',
      exchangeRate: currencyEdit.currency === 'USD' ? Number(currencyEdit.exchangeRate) : undefined,
      amount: Number(currencyEdit.amount),
      tax: Number(currencyEdit.tax),
      total: ceTotal,
      withholdingTax: ceWithholding,
    });
    setCurrencySaved(true);
    setTimeout(() => { setCurrencySaved(false); setShowCurrencyEdit(false); }, 1500);
  };

  // Credit note form state
  const [cnForm, setCnForm] = useState({ date: new Date().toISOString().slice(0, 10), amount: '', reason: '', referenceNo: '' });
  const [cnSaved, setCnSaved] = useState(false);
  const setCn = (k: string, v: string) => setCnForm(f => ({ ...f, [k]: v }));
  const handleCnSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAddCreditNote({ date: cnForm.date, amount: Number(cnForm.amount), reason: cnForm.reason, referenceNo: cnForm.referenceNo || undefined });
    setCnForm({ date: new Date().toISOString().slice(0, 10), amount: '', reason: '', referenceNo: '' });
    setCnSaved(true);
    setTimeout(() => setCnSaved(false), 2000);
  };

  const handleSave = () => {
    onUpdateCollection(followUp);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const paid = paidInEgp(invoice);
  const totalEgp = totalInEgp(invoice);
  const creditTotal = totalCreditNotes(invoice);
  const effTotal = effectiveTotal(invoice);
  const remaining = balanceInEgp(invoice);

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Back + Actions */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="flex items-center gap-1 text-gray-500 hover:text-gray-900 text-sm transition-colors">
          <span className="material-icons text-base">arrow_forward</span>
          رجوع
        </button>
        <span className="text-gray-600">|</span>
        <span className="text-gray-300 font-mono text-sm">{invoice.invoiceNo}</span>
        <div className="mr-auto flex gap-2">
          {invoice.pdfData && (
            <a href={invoice.pdfData} target="_blank" rel="noopener noreferrer" download={invoice.pdfName || `${invoice.invoiceNo}.pdf`}
              className="flex items-center gap-1 bg-[#2d3648] hover:bg-[#3a4458] text-gray-300 px-3 py-2 rounded-lg text-sm transition-colors">
              <span className="material-icons text-sm">picture_as_pdf</span>
              عرض PDF
            </a>
          )}
          <button onClick={onEdit} className="flex items-center gap-1 bg-[#2d3648] hover:bg-[#3a4458] text-gray-300 px-3 py-2 rounded-lg text-sm transition-colors">
            <span className="material-icons text-sm">edit</span>
            تعديل
          </button>
          {invoice.paymentStatus !== 'Paid' && (
            <button onClick={onAddPayment} className="flex items-center gap-1 bg-green-800 hover:bg-green-700 text-green-200 px-3 py-2 rounded-lg text-sm transition-colors">
              <span className="material-icons text-sm">add</span>
              تسجيل دفعة
            </button>
          )}
        </div>
      </div>

      {/* Invoice Header */}
      <div className="bg-[#232b3e] rounded-xl border border-gray-700 p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
        <InfoCell label="العميل" value={invoice.customer} />
        <InfoCell label="اسم المشروع" value={invoice.projectName || '—'} />
        <InfoCell label="تاريخ الفاتورة" value={invoice.invoiceDate} />
        <InfoCell label="تاريخ الاستحقاق" value={invoice.dueDate} />
        <InfoCell label="حالة الفاتورة">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${invoiceStatusColor[invoice.invoiceStatus]}`}>
            {invoiceStatusAr[invoice.invoiceStatus]}
          </span>
        </InfoCell>
        {invoice.invoiceType && <InfoCell label="نوع الفاتورة" value={invoice.invoiceType} />}
      </div>

      {/* Financials */}
      <div className="bg-[#232b3e] rounded-xl border border-gray-700 p-5 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <InfoCell label="العملة" value={invoice.currency === 'USD' ? `USD @ ${invoice.exchangeRate}` : 'EGP'} />
          <InfoCell label="الإجمالي الأصلي" value={`${fmt(invoice.total)} ${invoice.currency || 'EGP'}`} valueClass="text-white font-bold text-lg" />
          <InfoCell label="الإجمالي بالجنيه" value={`${fmt(totalEgp)} EGP`} valueClass="text-white font-bold text-lg" />
          {creditTotal > 0 && <InfoCell label="إشعارات دائنة" value={`- ${fmt(creditTotal)} EGP`} valueClass="text-orange-400 font-bold text-lg" />}
          <InfoCell label={creditTotal > 0 ? 'الصافي بعد الإشعار' : 'الإجمالي'} value={`${fmt(effTotal)} EGP`} valueClass="text-blue-300 font-bold text-lg" />
          <InfoCell label="المحصّل" value={`${fmt(paid)} EGP`} valueClass="text-green-400 font-bold text-lg" />
          <InfoCell label="الرصيد المتبقي" value={`${fmt(remaining)} EGP`} valueClass={remaining > 0 ? 'text-red-400 font-bold text-lg' : 'text-green-400 font-bold text-lg'} />
        </div>

        {/* Admin: currency quick-edit */}
        {canEdit && onSaveCurrency && (
          <div className="border-t border-gray-700 pt-3">
            {!showCurrencyEdit ? (
              <button
                onClick={() => setShowCurrencyEdit(true)}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-yellow-300 transition-colors"
              >
                <span className="material-icons text-sm">currency_exchange</span>
                تعديل العملة وسعر الصرف
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-yellow-400 flex items-center gap-1">
                  <span className="material-icons text-sm">currency_exchange</span>
                  تعديل العملة وسعر الصرف
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Field label="العملة" required>
                    <select
                      value={currencyEdit.currency}
                      onChange={e => setCurrencyEdit(f => ({ ...f, currency: e.target.value, exchangeRate: 0 }))}
                      className={inputCls}
                    >
                      <option value="EGP">EGP — جنيه مصري</option>
                      <option value="USD">USD — دولار أمريكي</option>
                    </select>
                  </Field>
                  {currencyEdit.currency === 'USD' && (
                    <Field label="سعر الصرف (EGP / USD)" required>
                      <input
                        type="number" step="any" min={0}
                        value={currencyEdit.exchangeRate}
                        onChange={e => setCurrencyEdit(f => ({ ...f, exchangeRate: Number(e.target.value) }))}
                        className={inputCls} placeholder="مثال: 50.5"
                      />
                    </Field>
                  )}
                  <Field label={`المبلغ قبل الضريبة (${currencyEdit.currency})`}>
                    <input
                      type="number" step="any" min={0}
                      value={currencyEdit.amount}
                      onChange={e => setCurrencyEdit(f => ({ ...f, amount: Number(e.target.value) }))}
                      className={inputCls}
                    />
                  </Field>
                  <Field label={`الضريبة (${currencyEdit.currency})`}>
                    <input
                      type="number" step="any" min={0}
                      value={currencyEdit.tax}
                      onChange={e => setCurrencyEdit(f => ({ ...f, tax: Number(e.target.value) }))}
                      className={inputCls}
                    />
                  </Field>
                </div>
                {/* Preview */}
                <div className="bg-[#1b2130] rounded-lg px-4 py-3 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-gray-500 text-xs">الإجمالي</p>
                    <p className="text-white font-bold">{fmt(ceTotal)} {currencyEdit.currency}</p>
                    {currencyEdit.currency === 'USD' && Number(currencyEdit.exchangeRate) > 0 && (
                      <p className="text-gray-400 text-xs">≈ {fmt(ceTotal * Number(currencyEdit.exchangeRate))} EGP</p>
                    )}
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">خصم ض.ت.ح ({invoice.invoiceType === 'خدمات' ? '3%' : '1%'})</p>
                    <p className="text-yellow-300 font-semibold">- {fmt(ceWithholding)} {currencyEdit.currency}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">الصافي</p>
                    <p className="text-green-400 font-bold">{fmt(ceTotal - ceWithholding)} {currencyEdit.currency}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCurrencySave}
                    className="flex items-center gap-1.5 bg-yellow-700 hover:bg-yellow-600 text-white px-4 py-2 rounded-lg text-sm transition-colors"
                  >
                    <span className="material-icons text-sm">{currencySaved ? 'check' : 'save'}</span>
                    {currencySaved ? 'تم الحفظ' : 'حفظ التعديل'}
                  </button>
                  <button
                    onClick={() => { setShowCurrencyEdit(false); setCurrencyEdit({ currency: invoice.currency || 'EGP', exchangeRate: invoice.exchangeRate || 0, amount: invoice.amount, tax: invoice.tax }); }}
                    className="px-4 py-2 bg-[#1b2130] hover:bg-[#2d3648] text-gray-400 rounded-lg text-sm transition-colors"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-700">
        <button
          onClick={() => setDetailTab('details')}
          className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${detailTab === 'details' ? 'border-primary text-primary' : 'border-transparent text-gray-400 hover:text-white'}`}
        >
          <span className="material-icons text-sm align-middle ml-1">receipt_long</span>
          تفاصيل الفاتورة
        </button>
        <button
          onClick={() => setDetailTab('credit-notes')}
          className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-1 ${detailTab === 'credit-notes' ? 'border-orange-400 text-orange-400' : 'border-transparent text-gray-400 hover:text-white'}`}
        >
          <span className="material-icons text-sm align-middle">remove_circle_outline</span>
          إشعار دائن
          {(invoice.creditNotes?.length ?? 0) > 0 && (
            <span className="bg-orange-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
              {invoice.creditNotes!.length}
            </span>
          )}
        </button>
      </div>

      {detailTab === 'details' && (
        <>
          {/* Collection Follow-up */}
          <div className="bg-[#232b3e] rounded-xl border border-gray-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-2">
              <span className="material-icons text-yellow-400 text-lg">follow_the_signs</span>
              <h3 className="font-semibold text-white">متابعة التحصيل</h3>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="حالة التحصيل">
                  <select value={followUp.collectionStatus} onChange={e => setFollowUp(f => ({ ...f, collectionStatus: e.target.value as CollectionStatus }))} className={inputCls}>
                    {(['Overdue', 'Paid'] as CollectionStatus[]).map(s => (
                      <option key={s} value={s}>{collectionStatusAr[s]}</option>
                    ))}
                  </select>
                </Field>
                <Field label="تاريخ آخر متابعة">
                  <input type="date" value={followUp.lastFollowUp} onChange={e => setFollowUp(f => ({ ...f, lastFollowUp: e.target.value }))} className={inputCls} />
                </Field>
                <Field label="تاريخ المتابعة القادمة">
                  <input type="date" value={followUp.nextFollowUp} onChange={e => setFollowUp(f => ({ ...f, nextFollowUp: e.target.value }))} className={inputCls} />
                </Field>
              </div>
              <Field label="ملاحظات المتابعة">
                <textarea value={followUp.notes} onChange={e => setFollowUp(f => ({ ...f, notes: e.target.value }))} rows={3} className={`${inputCls} resize-none`} placeholder="أضف ملاحظات المتابعة هنا..." />
              </Field>
              <button onClick={handleSave} className="flex items-center gap-2 bg-primary hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors">
                <span className="material-icons text-sm">{saved ? 'check' : 'save'}</span>
                {saved ? 'تم الحفظ' : 'حفظ المتابعة'}
              </button>
            </div>
          </div>

          {/* Payment History */}
          <PaymentHistoryTable
            invoice={invoice}
            canEdit={canEdit}
            onUpdatePayment={onUpdatePayment}
            onDeletePayment={onDeletePayment}
          />
        </>
      )}

      {detailTab === 'credit-notes' && (
        <>
          {/* Add Credit Note Form */}
          <div className="bg-[#232b3e] rounded-xl border border-orange-700/40 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-2">
              <span className="material-icons text-orange-400 text-lg">remove_circle_outline</span>
              <h3 className="font-semibold text-white">إضافة إشعار دائن</h3>
            </div>
            <form onSubmit={handleCnSubmit} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="تاريخ الإشعار" required>
                  <input type="date" value={cnForm.date} onChange={e => setCn('date', e.target.value)} required className={inputCls} />
                </Field>
                <Field label="قيمة الإشعار (EGP)" required>
                  <input type="number" step="any" min={0.01} max={effTotal} value={cnForm.amount} onChange={e => setCn('amount', e.target.value)} required className={inputCls} placeholder="0" />
                </Field>
                <Field label="رقم المرجع">
                  <input type="text" value={cnForm.referenceNo} onChange={e => setCn('referenceNo', e.target.value)} className={inputCls} placeholder="CN-0001" />
                </Field>
              </div>
              <Field label="سبب الإشعار الدائن" required>
                <textarea value={cnForm.reason} onChange={e => setCn('reason', e.target.value)} required rows={2} className={`${inputCls} resize-none`} placeholder="مثال: خصم جزئي، مرتجع بضاعة، تعديل سعر..." />
              </Field>
              {cnForm.amount && Number(cnForm.amount) > 0 && (
                <div className="bg-[#1b2130] rounded-lg px-4 py-3 flex items-center justify-between text-sm">
                  <span className="text-gray-400">الصافي بعد هذا الإشعار</span>
                  <span className="text-orange-300 font-bold text-lg">{fmt(effTotal - Number(cnForm.amount))} EGP</span>
                </div>
              )}
              <button type="submit" className="flex items-center gap-2 bg-orange-700 hover:bg-orange-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors">
                <span className="material-icons text-sm">{cnSaved ? 'check' : 'add'}</span>
                {cnSaved ? 'تم إضافة الإشعار' : 'إضافة الإشعار الدائن'}
              </button>
            </form>
          </div>

          {/* Credit Notes History */}
          <div className="bg-[#232b3e] rounded-xl border border-gray-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-icons text-orange-400 text-lg">list_alt</span>
                <h3 className="font-semibold text-white">الإشعارات الدائنة المسجّلة</h3>
              </div>
              {creditTotal > 0 && (
                <span className="text-orange-300 font-semibold text-sm">إجمالي الخصم: {fmt(creditTotal)} EGP</span>
              )}
            </div>
            {(invoice.creditNotes?.length ?? 0) === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">لا توجد إشعارات دائنة مسجّلة</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-xs border-b border-gray-700 bg-[#1b2130]">
                    <th className="px-5 py-3 text-right">التاريخ</th>
                    <th className="px-5 py-3 text-right">القيمة</th>
                    <th className="px-5 py-3 text-right">رقم المرجع</th>
                    <th className="px-5 py-3 text-right">السبب</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.creditNotes!.map(cn => (
                    <tr key={cn.id} className="border-b border-gray-700/50">
                      <td className="px-5 py-3 text-gray-300">{cn.date}</td>
                      <td className="px-5 py-3 text-orange-400 font-semibold">- {fmt(cn.amount)} EGP</td>
                      <td className="px-5 py-3 text-gray-400 font-mono text-xs">{cn.referenceNo || '—'}</td>
                      <td className="px-5 py-3 text-gray-300">{cn.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* PDF Attachment Preview */}
      {invoice.pdfData && (
        <div className="bg-[#232b3e] rounded-xl border border-gray-700 overflow-hidden mt-5">
          <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-3">
            <span className="material-icons text-orange-400 text-base">picture_as_pdf</span>
            <h3 className="font-semibold text-white text-sm">نسخة الفاتورة</h3>
            {invoice.pdfName && <span className="text-gray-500 text-xs mr-auto">{invoice.pdfName}</span>}
          </div>
          <iframe
            src={invoice.pdfData}
            title="نسخة الفاتورة"
            className="w-full"
            style={{ height: '600px', background: '#fff' }}
          />
        </div>
      )}
    </div>
  );
};

// ─── Screen: Payment Entry ────────────────────────────────────────────────────

const PaymentEntryScreen: React.FC<{
  invoice: Invoice | null;
  invoices: Invoice[];
  onSelectInvoice: (inv: Invoice) => void;
  onSave: (invoiceId: string, payment: Omit<Payment, 'id'>) => void;
  onCancel: () => void;
  canEditInvoice?: boolean;
  onEditInvoice?: (inv: Invoice) => void;
  onUpdateCollection?: (inv: Invoice, data: Pick<Invoice, 'collectionStatus' | 'lastFollowUp' | 'nextFollowUp' | 'notes'>) => void;
}> = ({ invoice, invoices, onSelectInvoice, onSave, onCancel, canEditInvoice, onEditInvoice, onUpdateCollection }) => {
  const payable = invoices.filter(i => i.paymentStatus !== 'Paid' && i.invoiceStatus !== 'Cancelled' && i.invoiceStatus !== 'Draft');

  const [form, setForm] = useState({
    receiptDate: new Date().toISOString().slice(0, 10),
    amountReceived: '',
    paymentMethod: 'تحويل بنكي',
    referenceNo: '',
    notes: '',
  });
  // When invoice is USD, allow user to enter in EGP and auto-convert
  const [inputCurrency, setInputCurrency] = useState<'USD' | 'EGP'>('USD');

  // Follow-up / collection status editing
  const [followUp, setFollowUp] = useState<Pick<Invoice, 'collectionStatus' | 'lastFollowUp' | 'nextFollowUp' | 'notes'> | null>(null);
  const [followUpSaved, setFollowUpSaved] = useState(false);

  useEffect(() => {
    if (invoice) {
      setFollowUp({
        collectionStatus: invoice.collectionStatus,
        lastFollowUp: invoice.lastFollowUp,
        nextFollowUp: invoice.nextFollowUp,
        notes: invoice.notes,
      });
    }
  }, [invoice?.id]);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const isUSD = invoice?.currency === 'USD';
  const rate = invoice?.exchangeRate || 1;

  // Amount in the invoice's currency (USD) that will be stored
  const amountInInvoiceCurrency = (): number => {
    const raw = Number(form.amountReceived) || 0;
    if (isUSD && inputCurrency === 'EGP') return raw / rate;
    return raw;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoice) return;
    onSave(invoice.id, {
      receiptDate: form.receiptDate,
      amountReceived: amountInInvoiceCurrency(),
      paymentMethod: form.paymentMethod,
      referenceNo: form.referenceNo,
      notes: form.notes || undefined,
    });
  };

  const amountEgpPreview = isUSD && inputCurrency === 'EGP'
    ? Number(form.amountReceived) || 0
    : (Number(form.amountReceived) || 0) * rate;

  const amountUsdPreview = isUSD && inputCurrency === 'EGP'
    ? (Number(form.amountReceived) || 0) / rate
    : Number(form.amountReceived) || 0;

  const maxInInvoiceCurrency = Math.ceil(balance(invoice ?? { payments: [], total: 0, creditNotes: [] } as any) * 1000) / 1000;

  return (
    <div className="max-w-xl space-y-5">
      {/* Invoice selector */}
      <div className="bg-[#232b3e] rounded-xl border border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-2">
          <span className="material-icons text-primary text-lg">receipt</span>
          <h3 className="font-semibold text-white">اختر الفاتورة</h3>
        </div>
        <div className="p-4">
          <select
            value={invoice?.id ?? ''}
            onChange={e => {
              const inv = payable.find(i => i.id === e.target.value);
              if (inv) {
                onSelectInvoice(inv);
                setInputCurrency(inv.currency === 'USD' ? 'USD' : 'EGP');
              }
            }}
            className={inputCls}
          >
            <option value="">-- اختر فاتورة --</option>
            {payable.map(inv => (
              <option key={inv.id} value={inv.id}>
                {inv.invoiceNo} — {inv.customer} ({fmt(balanceInEgp(inv))} EGP متبقي)
              </option>
            ))}
          </select>
        </div>
      </div>

      {invoice && (
        <>
          {/* Invoice summary + admin edit button */}
          <div className="bg-[#1b2130] rounded-lg px-5 py-4 space-y-3">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <InfoCell label="العميل" value={invoice.customer} />
              <InfoCell label="اسم المشروع" value={invoice.projectName || '—'} />
              <InfoCell label="تاريخ الاستحقاق" value={invoice.dueDate} />
              <InfoCell label="الإجمالي" value={`${fmt(totalInEgp(invoice))} EGP`} />
              <InfoCell label="المحصّل" value={`${fmt(paidInEgp(invoice))} EGP`} valueClass="text-green-400" />
              <InfoCell label="المتبقي" value={`${fmt(balanceInEgp(invoice))} EGP`} valueClass="text-red-400 font-bold" />
            </div>
            {canEditInvoice && onEditInvoice && (
              <div className="pt-1 border-t border-gray-700 flex justify-end">
                <button
                  type="button"
                  onClick={() => onEditInvoice(invoice)}
                  className="flex items-center gap-1.5 bg-[#2d3648] hover:bg-[#3a4458] text-gray-300 px-3 py-1.5 rounded-lg text-xs transition-colors"
                >
                  <span className="material-icons text-sm">edit</span>
                  تعديل بيانات الفاتورة
                </button>
              </div>
            )}
          </div>

          {/* Collection follow-up editing (admin only) */}
          {canEditInvoice && followUp && onUpdateCollection && (
            <div className="bg-[#232b3e] rounded-xl border border-yellow-700/40 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-700 flex items-center gap-2">
                <span className="material-icons text-yellow-400 text-lg">track_changes</span>
                <h3 className="font-semibold text-white text-sm">متابعة التحصيل</h3>
              </div>
              <div className="p-5 grid grid-cols-2 gap-4">
                <Field label="حالة التحصيل">
                  <select
                    value={followUp.collectionStatus}
                    onChange={e => setFollowUp(f => f ? { ...f, collectionStatus: e.target.value as CollectionStatus } : f)}
                    className={inputCls}
                  >
                    {(['Overdue', 'Paid'] as CollectionStatus[]).map(s => (
                      <option key={s} value={s}>{collectionStatusAr[s]}</option>
                    ))}
                  </select>
                </Field>
                <Field label="آخر متابعة">
                  <input type="date" value={followUp.lastFollowUp} onChange={e => setFollowUp(f => f ? { ...f, lastFollowUp: e.target.value } : f)} className={inputCls} />
                </Field>
                <Field label="المتابعة القادمة">
                  <input type="date" value={followUp.nextFollowUp} onChange={e => setFollowUp(f => f ? { ...f, nextFollowUp: e.target.value } : f)} className={inputCls} />
                </Field>
                <div className="col-span-2">
                  <Field label="ملاحظات التحصيل">
                    <textarea
                      value={followUp.notes}
                      onChange={e => setFollowUp(f => f ? { ...f, notes: e.target.value } : f)}
                      rows={2}
                      className={`${inputCls} resize-none`}
                      placeholder="ملاحظات المتابعة..."
                    />
                  </Field>
                </div>
                <div className="col-span-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      if (followUp) {
                        onUpdateCollection(invoice, followUp);
                        setFollowUpSaved(true);
                        setTimeout(() => setFollowUpSaved(false), 2000);
                      }
                    }}
                    className="flex items-center gap-1.5 bg-yellow-700 hover:bg-yellow-600 text-white px-4 py-2 rounded-lg text-sm transition-colors"
                  >
                    <span className="material-icons text-sm">{followUpSaved ? 'check' : 'save'}</span>
                    {followUpSaved ? 'تم الحفظ' : 'حفظ متابعة التحصيل'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Payment form */}
          <div className="bg-[#232b3e] rounded-xl border border-gray-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-2">
              <span className="material-icons text-green-400 text-lg">payments</span>
              <h3 className="font-semibold text-white">تفاصيل الدفعة</h3>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="تاريخ الاستلام" required>
                  <input type="date" value={form.receiptDate} onChange={e => set('receiptDate', e.target.value)} required className={inputCls} />
                </Field>
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-400">
                    المبلغ المستلم
                    {isUSD && (
                      <span className="mr-2 inline-flex rounded overflow-hidden border border-gray-600 text-xs align-middle">
                        <button
                          type="button"
                          onClick={() => setInputCurrency('USD')}
                          className={`px-2 py-0.5 transition-colors ${inputCurrency === 'USD' ? 'bg-blue-700 text-white' : 'bg-[#1b2130] text-gray-400 hover:text-white'}`}
                        >USD</button>
                        <button
                          type="button"
                          onClick={() => setInputCurrency('EGP')}
                          className={`px-2 py-0.5 transition-colors ${inputCurrency === 'EGP' ? 'bg-green-700 text-white' : 'bg-[#1b2130] text-gray-400 hover:text-white'}`}
                        >EGP</button>
                      </span>
                    )}
                    <span className="text-red-400 mr-1">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      value={form.amountReceived}
                      onChange={e => set('amountReceived', e.target.value)}
                      min={0.01}
                      required
                      className={inputCls}
                      placeholder="0"
                    />
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">
                      {isUSD ? inputCurrency : 'EGP'}
                    </span>
                  </div>
                  {isUSD && Number(form.amountReceived) > 0 && (
                    <p className="text-xs text-gray-400">
                      {inputCurrency === 'EGP'
                        ? <>≈ <span className="text-blue-300 font-medium">{fmt(amountUsdPreview)} USD</span> (بسعر صرف {rate})</>
                        : <>≈ <span className="text-green-300 font-medium">{fmt(amountEgpPreview)} EGP</span> (بسعر صرف {rate})</>
                      }
                    </p>
                  )}
                </div>
                <Field label="طريقة الدفع">
                  <select value={form.paymentMethod} onChange={e => set('paymentMethod', e.target.value)} className={inputCls}>
                    {['تحويل بنكي', 'شيك', 'نقداً', 'بطاقة ائتمان', 'أخرى'].map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </Field>
                <Field label="رقم المرجع / الإشعار">
                  <input type="text" value={form.referenceNo} onChange={e => set('referenceNo', e.target.value)} className={inputCls} placeholder="TRF-0000" />
                </Field>
              </div>
              <Field label="ملاحظات السداد">
                <textarea
                  value={form.notes}
                  onChange={e => set('notes', e.target.value)}
                  rows={3}
                  className={`${inputCls} resize-none`}
                  placeholder="أضف ملاحظات على هذه الدفعة..."
                />
              </Field>
              <div className="flex gap-3 pt-1">
                <button type="submit" className="flex-1 bg-green-700 hover:bg-green-600 text-white py-2.5 rounded-lg text-sm font-medium transition-colors">
                  تسجيل الدفعة
                </button>
                <button type="button" onClick={onCancel} className="px-6 bg-[#1b2130] hover:bg-[#2d3648] text-gray-300 py-2.5 rounded-lg text-sm transition-colors">
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
};

// ─── Screen: History ─────────────────────────────────────────────────────────

const HistoryScreen: React.FC<{
  invoices: Invoice[];
  onOpen: (inv: Invoice) => void;
  canEdit?: boolean;
  onDeletePayment?: (invoiceId: string, paymentId: string) => void;
  onEditPayment?: (invoiceId: string, payment: Payment) => void;
}> = ({ invoices, onOpen, canEdit = false, onDeletePayment, onEditPayment }) => {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<CollectionStatus | 'All'>('All');
  const [filterPayment, setFilterPayment] = useState<PaymentStatus | 'All'>('All');
  const [invoiceSortCol, setInvoiceSortCol] = useState<string>('dueDate');
  const [invoiceSortDir, setInvoiceSortDir] = useState<SortDir>('desc');
  const [paymentSortCol, setPaymentSortCol] = useState<string>('receiptDate');
  const [paymentSortDir, setPaymentSortDir] = useState<SortDir>('desc');

  const handleInvoiceSort = (col: string) => {
    setInvoiceSortDir(prev => invoiceSortCol === col && prev === 'asc' ? 'desc' : 'asc');
    setInvoiceSortCol(col);
  };
  const handlePaymentSort = (col: string) => {
    setPaymentSortDir(prev => paymentSortCol === col && prev === 'asc' ? 'desc' : 'asc');
    setPaymentSortCol(col);
  };

  // Flatten all payment events into a single timeline
  const allPayments = useMemo(() => {
    const rows: { inv: Invoice; payment: Payment }[] = [];
    for (const inv of invoices) {
      for (const p of inv.payments) {
        rows.push({ inv, payment: p });
      }
    }
    return rows.sort((a, b) => {
      let v = 0;
      if (paymentSortCol === 'receiptDate') v = cmp(a.payment.receiptDate, b.payment.receiptDate);
      else if (paymentSortCol === 'amount') v = cmp(a.payment.amountReceived, b.payment.amountReceived);
      else if (paymentSortCol === 'customer') v = cmp(a.inv.customer, b.inv.customer);
      else if (paymentSortCol === 'method') v = cmp(a.payment.paymentMethod, b.payment.paymentMethod);
      return applySortDir(v, paymentSortDir);
    });
  }, [invoices, paymentSortCol, paymentSortDir]);

  const filteredInvoices = useMemo(() => {
    const base = invoices.filter(inv => {
      const matchSearch =
        inv.invoiceNo.toLowerCase().includes(search.toLowerCase()) ||
        inv.customer.includes(search) ||
        (inv.projectName || '').includes(search);
      const cs = effectiveCollectionStatus(inv);
      const matchStatus = filterStatus === 'All' || cs === filterStatus;
      const matchPayment = filterPayment === 'All' || inv.paymentStatus === filterPayment;
      return matchSearch && matchStatus && matchPayment;
    });
    return [...base].sort((a, b) => {
      let v = 0;
      if (invoiceSortCol === 'invoiceNo') v = cmp(a.invoiceNo, b.invoiceNo);
      else if (invoiceSortCol === 'customer') v = cmp(a.customer, b.customer);
      else if (invoiceSortCol === 'dueDate') v = cmp(a.dueDate, b.dueDate);
      else if (invoiceSortCol === 'total') v = cmp(totalInEgp(a), totalInEgp(b));
      else if (invoiceSortCol === 'collectionStatus') v = cmp(effectiveCollectionStatus(a), effectiveCollectionStatus(b));
      return applySortDir(v, invoiceSortDir);
    });
  }, [invoices, search, filterStatus, filterPayment, invoiceSortCol, invoiceSortDir]);

  const totalCollected = allPayments.reduce((s, r) => {
    const egp = r.inv.currency === 'USD' ? r.payment.amountReceived * (r.inv.exchangeRate || 1) : r.payment.amountReceived;
    return s + egp;
  }, 0);

  return (
    <div className="space-y-5">
      {/* Summary bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'إجمالي الفواتير', value: invoices.length, unit: 'فاتورة', color: 'text-blue-400', icon: 'receipt_long' },
          { label: 'إجمالي المحصّل', value: fmt(totalCollected), unit: 'EGP', color: 'text-green-400', icon: 'check_circle' },
          { label: 'فواتير مدفوعة', value: invoices.filter(i => i.paymentStatus === 'Paid').length, unit: 'فاتورة', color: 'text-green-400', icon: 'done_all' },
          { label: 'عدد دفعات', value: allPayments.length, unit: 'دفعة', color: 'text-primary', icon: 'payments' },
        ].map(c => (
          <div key={c.label} className="bg-[#232b3e] rounded-xl p-4 border border-gray-700">
            <div className="flex items-center gap-2 mb-1">
              <span className={`material-icons text-lg ${c.color}`}>{c.icon}</span>
              <span className="text-gray-400 text-xs">{c.label}</span>
            </div>
            <p className="text-xl font-bold text-white">{c.value}</p>
            <p className="text-gray-500 text-xs">{c.unit}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <span className="material-icons absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-lg">search</span>
          <input
            type="text"
            placeholder="بحث برقم فاتورة، عميل، أو مشروع..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-[#1b2130] border border-gray-700 rounded-lg pr-10 pl-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary"
          />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as CollectionStatus | 'All')} className="bg-[#1b2130] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-primary">
          <option value="All">كل حالات التحصيل</option>
          {(['Overdue', 'Paid'] as CollectionStatus[]).map(s => (
            <option key={s} value={s}>{collectionStatusAr[s]}</option>
          ))}
        </select>
        <select value={filterPayment} onChange={e => setFilterPayment(e.target.value as PaymentStatus | 'All')} className="bg-[#1b2130] border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-primary">
          <option value="All">كل حالات الدفع</option>
          {(Object.keys(paymentStatusAr) as PaymentStatus[]).map(s => (
            <option key={s} value={s}>{paymentStatusAr[s]}</option>
          ))}
        </select>
      </div>

      {/* Invoice list with payment history */}
      <div className="bg-[#232b3e] rounded-xl border border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-2 flex-wrap">
          <span className="material-icons text-primary text-lg">history</span>
          <h3 className="font-semibold text-white">سجل الفواتير والمدفوعات</h3>
          <span className="mr-auto text-xs text-gray-500">{filteredInvoices.length} فاتورة</span>
          <select
            value={`${invoiceSortCol}:${invoiceSortDir}`}
            onChange={e => { const [col, dir] = e.target.value.split(':'); setInvoiceSortCol(col); setInvoiceSortDir(dir as SortDir); }}
            className="bg-[#1b2130] border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-primary"
          >
            <option value="dueDate:desc">الاستحقاق (الأحدث)</option>
            <option value="dueDate:asc">الاستحقاق (الأقدم)</option>
            <option value="customer:asc">العميل (أ-ي)</option>
            <option value="customer:desc">العميل (ي-أ)</option>
            <option value="total:desc">الإجمالي (الأعلى)</option>
            <option value="total:asc">الإجمالي (الأقل)</option>
            <option value="invoiceNo:asc">رقم الفاتورة</option>
            <option value="collectionStatus:asc">حالة التحصيل</option>
          </select>
        </div>
        {filteredInvoices.length === 0 ? (
          <div className="p-10 text-center text-gray-500 text-sm">لا توجد نتائج مطابقة</div>
        ) : (
          <div className="divide-y divide-gray-700/50">
            {filteredInvoices.map(inv => {
              const cs = effectiveCollectionStatus(inv);
              const paid = paidInEgp(inv);
              const total = totalInEgp(inv);
              const rem = balanceInEgp(inv);
              return (
                <div key={inv.id} className="p-4 hover:bg-[#2d3648] transition-colors">
                  {/* Invoice row */}
                  <div className="flex items-start justify-between gap-3 cursor-pointer" onClick={() => onOpen(inv)}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-mono text-xs">{inv.invoiceNo}</span>
                        {inv.projectName && <span className="text-gray-400 text-xs">— {inv.projectName}</span>}
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${collectionStatusColor[cs]}`}>{collectionStatusAr[cs]}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${inv.paymentStatus === 'Paid' ? 'bg-green-900/50 text-green-400' : inv.paymentStatus === 'Partial' ? 'bg-orange-900/50 text-orange-300' : 'bg-gray-700 text-gray-400'}`}>
                          {paymentStatusAr[inv.paymentStatus]}
                        </span>
                      </div>
                      <p className="text-gray-300 text-sm mt-0.5">{inv.customer}</p>
                      <p className="text-gray-500 text-xs mt-0.5">استحقاق: {inv.dueDate || '—'}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-white font-bold">{fmt(total)} <span className="text-xs text-gray-400">EGP</span></p>
                      <p className="text-green-400 text-sm">محصّل: {fmt(paid)} EGP</p>
                      {rem > 0 && <p className="text-red-400 text-xs">متبقي: {fmt(rem)} EGP</p>}
                    </div>
                  </div>
                  {/* Payment sub-rows */}
                  {inv.payments.length > 0 && (
                    <div className="mt-3 mr-4 border-r-2 border-green-700/40 pr-3 space-y-1.5">
                      {inv.payments.map(p => {
                        const egp = inv.currency === 'USD' ? p.amountReceived * (inv.exchangeRate || 1) : p.amountReceived;
                        return (
                          <div key={p.id} className="flex items-center gap-3 text-xs text-gray-400 group">
                            <span className="material-icons text-green-500 text-sm">payments</span>
                            <span className="text-green-300 font-medium">{fmt(egp)} EGP</span>
                            {inv.currency === 'USD' && <span className="text-gray-500">({fmt(p.amountReceived)} USD)</span>}
                            <span className="text-gray-500">{p.receiptDate}</span>
                            <span>{p.paymentMethod}</span>
                            {p.referenceNo && <span className="font-mono text-gray-500">{p.referenceNo}</span>}
                            {p.notes && <span className="text-gray-500 truncate max-w-[200px]">{p.notes}</span>}
                            {canEdit && (
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity mr-auto">
                                {onEditPayment && (
                                  <button onClick={e => { e.stopPropagation(); onEditPayment(inv.id, p); }}
                                    className="text-gray-500 hover:text-primary transition-colors" title="تعديل">
                                    <span className="material-icons text-sm">edit</span>
                                  </button>
                                )}
                                {onDeletePayment && (
                                  <button onClick={e => { e.stopPropagation(); onDeletePayment(inv.id, p.id); }}
                                    className="text-gray-500 hover:text-red-400 transition-colors" title="حذف">
                                    <span className="material-icons text-sm">delete</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {inv.payments.length === 0 && (
                    <div className="mt-2 mr-4 text-xs text-gray-600 flex items-center gap-1">
                      <span className="material-icons text-xs">radio_button_unchecked</span>
                      لا توجد دفعات مسجّلة
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Payment timeline */}
      {allPayments.length > 0 && (
        <div className="bg-[#232b3e] rounded-xl border border-gray-700 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-2">
            <span className="material-icons text-green-400 text-lg">timeline</span>
            <h3 className="font-semibold text-white">تسلسل زمني للمدفوعات</h3>
            <select
              value={`${paymentSortCol}:${paymentSortDir}`}
              onChange={e => { const [col, dir] = e.target.value.split(':'); setPaymentSortCol(col); setPaymentSortDir(dir as SortDir); }}
              className="mr-auto bg-[#1b2130] border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-primary"
            >
              <option value="receiptDate:desc">التاريخ (الأحدث)</option>
              <option value="receiptDate:asc">التاريخ (الأقدم)</option>
              <option value="amount:desc">المبلغ (الأعلى)</option>
              <option value="amount:asc">المبلغ (الأقل)</option>
              <option value="customer:asc">العميل (أ-ي)</option>
              <option value="method:asc">طريقة الدفع</option>
            </select>
          </div>
          <div className="divide-y divide-gray-700/50">
            {allPayments.map(({ inv, payment }) => {
              const egp = inv.currency === 'USD' ? payment.amountReceived * (inv.exchangeRate || 1) : payment.amountReceived;
              return (
                <div key={payment.id} className="flex items-center gap-4 px-5 py-3 hover:bg-[#2d3648] transition-colors">
                  <div className="text-gray-500 text-xs w-24 shrink-0">{payment.receiptDate}</div>
                  <span className="material-icons text-green-400 text-base shrink-0">payments</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">{fmt(egp)} EGP
                      {inv.currency === 'USD' && <span className="text-xs text-gray-500 mr-1">({fmt(payment.amountReceived)} USD)</span>}
                    </p>
                    <p className="text-gray-400 text-xs truncate">{inv.customer} — {inv.invoiceNo}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-gray-400 text-xs">{payment.paymentMethod}</p>
                    {payment.referenceNo && <p className="text-gray-600 font-mono text-xs">{payment.referenceNo}</p>}
                  </div>
                  <button onClick={() => onOpen(inv)} className="text-gray-500 hover:text-primary transition-colors shrink-0">
                    <span className="material-icons text-base">open_in_new</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Shared UI Atoms ──────────────────────────────────────────────────────────

const inputCls = 'w-full bg-[#1b2130] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary';

const Field: React.FC<{ label: string; required?: boolean; children: React.ReactNode }> = ({ label, required, children }) => (
  <div className="space-y-1.5">
    <label className="text-xs text-gray-400">{label}{required && <span className="text-red-400 mr-1">*</span>}</label>
    {children}
  </div>
);

const InfoCell: React.FC<{ label: string; value?: string; valueClass?: string; children?: React.ReactNode }> = ({ label, value, valueClass = 'text-gray-200', children }) => (
  <div>
    <p className="text-gray-500 text-xs mb-1">{label}</p>
    {children ?? <p className={`text-sm font-medium ${valueClass}`}>{value}</p>}
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

interface CollectionsDashboardProps {
  user: User;
}

const CollectionsDashboard: React.FC<CollectionsDashboardProps> = ({ user }) => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let rows = await loadInvoicesRemote();
        if (rows.length === 0) {
          try {
            const raw = localStorage.getItem('collections.invoices.v1');
            if (raw) {
              const legacy = JSON.parse(raw);
              if (Array.isArray(legacy) && legacy.length) {
                await Promise.all(legacy.map((inv: Invoice) => upsertInvoiceRemote(inv)));
                rows = legacy as Invoice[];
              }
            }
          } catch { /* ignore localStorage errors */ }
        }
        if (cancelled) return;
        const normalized = rows.map(inv =>
          inv.invoiceStatus === 'Draft' || inv.invoiceStatus === 'Approved'
            ? { ...inv, invoiceStatus: 'Sent' as InvoiceStatus }
            : inv
        );
        setInvoices(normalized);
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message || 'فشل الاتصال بقاعدة البيانات');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const [screen, setScreen] = useState<Screen>('dashboard');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'invoice-list' | 'payment-entry' | 'history'>('dashboard');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);

  // ── Navigation helpers ──

  const openInvoice = (inv: Invoice) => {
    setSelectedInvoice(inv);
    setScreen('invoice-details');
  };

  const goCreateInvoice = () => {
    setEditingInvoice(null);
    setScreen('create-invoice');
  };

  const goEditInvoice = () => {
    setEditingInvoice(selectedInvoice);
    setScreen('create-invoice');
  };

  const goAddPayment = (inv?: Invoice) => {
    setPaymentInvoice(inv ?? selectedInvoice);
    setActiveTab('payment-entry');
    setScreen('payment-entry');
  };

  const goBack = () => {
    const target = activeTab === 'invoice-list' ? 'invoice-list' : 'dashboard';
    setScreen(target);
  };

  // ── Data mutations ──

  const saveInvoice = (data: Partial<Invoice>) => {
    if (editingInvoice) {
      const updated = { ...editingInvoice, ...data } as Invoice;
      setInvoices(prev => prev.map(i => i.id === editingInvoice.id ? updated : i));
      setSelectedInvoice(prev => prev ? { ...prev, ...data } : prev);
      upsertInvoiceRemote(updated);
    } else {
      const newInv: Invoice = {
        id: Date.now().toString(),
        collectionStatus: 'Overdue',
        paymentStatus: 'Unpaid',
        lastFollowUp: '',
        nextFollowUp: '',
        notes: '',
        payments: [],
        ...(data as Omit<Invoice, 'id' | 'payments'>),
      };
      setInvoices(prev => [newInv, ...prev]);
      upsertInvoiceRemote(newInv);
      // Auto-generate sales invoice journal entry
      autoPostInvoiceIssuance({
        id: newInv.id,
        invoiceNo: newInv.invoiceNo,
        customer: newInv.customer,
        invoiceDate: newInv.invoiceDate,
        amount: newInv.amount,
        tax: newInv.tax,
        total: newInv.total,
        currency: newInv.currency,
        exchangeRate: newInv.exchangeRate,
        invoiceType: newInv.invoiceType,
        projectName: newInv.projectName,
      }).catch(() => {/* non-blocking */});
    }
    setScreen(activeTab === 'invoice-list' ? 'invoice-list' : 'dashboard');
  };

  const updateCollection = (data: Pick<Invoice, 'collectionStatus' | 'lastFollowUp' | 'nextFollowUp' | 'notes'>) => {
    if (!selectedInvoice) return;
    const updated = { ...selectedInvoice, ...data };
    setInvoices(prev => prev.map(i => i.id === selectedInvoice.id ? updated : i));
    setSelectedInvoice(updated);
    upsertInvoiceRemote(updated);
  };

  const updateCollectionForInvoice = (inv: Invoice, data: Pick<Invoice, 'collectionStatus' | 'lastFollowUp' | 'nextFollowUp' | 'notes'>) => {
    const updated = { ...inv, ...data };
    setInvoices(prev => prev.map(i => i.id === inv.id ? updated : i));
    if (paymentInvoice?.id === inv.id) setPaymentInvoice(updated);
    upsertInvoiceRemote(updated);
  };

  const isAdmin = user.role === 'super_admin' || user.role === 'power_admin' || user.role === 'admin';

  const patchInvoice = (id: string, patch: Partial<Invoice>) => {
    setInvoices(prev => prev.map(i => {
      if (i.id !== id) return i;
      const updated = { ...i, ...patch };
      upsertInvoiceRemote(updated);
      return updated;
    }));
    setSelectedInvoice(prev => prev?.id === id ? { ...prev, ...patch } : prev);
  };

  const deletePayment = (invoiceId: string, paymentId: string) => {
    setInvoices(prev => prev.map(inv => {
      if (inv.id !== invoiceId) return inv;
      const payments = inv.payments.filter(p => p.id !== paymentId);
      const totalPaidAmt = payments.reduce((s, p) => s + p.amountReceived, 0);
      const effTotal = inv.total - (inv.withholdingTax || 0) - (inv.creditNotes || []).reduce((s, c) => s + c.amount, 0);
      const paymentStatus: PaymentStatus = totalPaidAmt >= effTotal ? 'Paid' : totalPaidAmt > 0 ? 'Partial' : 'Unpaid';
      const collectionStatus: CollectionStatus = totalPaidAmt >= effTotal ? 'Paid' : totalPaidAmt > 0 ? 'Overdue' : inv.collectionStatus;
      const updated = { ...inv, payments, paymentStatus, collectionStatus };
      upsertInvoiceRemote(updated);
      return updated;
    }));
    setSelectedInvoice(prev => {
      if (!prev || prev.id !== invoiceId) return prev;
      const payments = prev.payments.filter(p => p.id !== paymentId);
      const totalPaidAmt = payments.reduce((s, p) => s + p.amountReceived, 0);
      const effTotal = prev.total - (prev.withholdingTax || 0) - (prev.creditNotes || []).reduce((s, c) => s + c.amount, 0);
      const paymentStatus: PaymentStatus = totalPaidAmt >= effTotal ? 'Paid' : totalPaidAmt > 0 ? 'Partial' : 'Unpaid';
      const collectionStatus: CollectionStatus = totalPaidAmt >= effTotal ? 'Paid' : totalPaidAmt > 0 ? 'Overdue' : prev.collectionStatus;
      return { ...prev, payments, paymentStatus, collectionStatus };
    });
  };

  const updatePayment = (invoiceId: string, paymentId: string, patch: Partial<Payment>) => {
    setInvoices(prev => prev.map(inv => {
      if (inv.id !== invoiceId) return inv;
      const payments = inv.payments.map(p => p.id === paymentId ? { ...p, ...patch } : p);
      const totalPaidAmt = payments.reduce((s, p) => s + p.amountReceived, 0);
      const effTotal = inv.total - (inv.withholdingTax || 0) - (inv.creditNotes || []).reduce((s, c) => s + c.amount, 0);
      const paymentStatus: PaymentStatus = totalPaidAmt >= effTotal ? 'Paid' : totalPaidAmt > 0 ? 'Partial' : 'Unpaid';
      const collectionStatus: CollectionStatus = totalPaidAmt >= effTotal ? 'Paid' : totalPaidAmt > 0 ? 'Overdue' : inv.collectionStatus;
      const updated = { ...inv, payments, paymentStatus, collectionStatus };
      upsertInvoiceRemote(updated);
      return updated;
    }));
    setSelectedInvoice(prev => {
      if (!prev || prev.id !== invoiceId) return prev;
      const payments = prev.payments.map(p => p.id === paymentId ? { ...p, ...patch } : p);
      const totalPaidAmt = payments.reduce((s, p) => s + p.amountReceived, 0);
      const effTotal = prev.total - (prev.withholdingTax || 0) - (prev.creditNotes || []).reduce((s, c) => s + c.amount, 0);
      const paymentStatus: PaymentStatus = totalPaidAmt >= effTotal ? 'Paid' : totalPaidAmt > 0 ? 'Partial' : 'Unpaid';
      const collectionStatus: CollectionStatus = totalPaidAmt >= effTotal ? 'Paid' : totalPaidAmt > 0 ? 'Overdue' : prev.collectionStatus;
      return { ...prev, payments, paymentStatus, collectionStatus };
    });
  };

  const savePayment = (invoiceId: string, payment: Omit<Payment, 'id'>) => {
    const newPayment: Payment = { ...payment, id: Date.now().toString() };
    let updated: Invoice | null = null;
    setInvoices(prev => prev.map(inv => {
      if (inv.id !== invoiceId) return inv;
      const payments = [...inv.payments, newPayment];
      const paid = payments.reduce((s, p) => s + p.amountReceived, 0);
      const effTotal = inv.total - (inv.withholdingTax || 0) - (inv.creditNotes || []).reduce((s, c) => s + c.amount, 0);
      const paymentStatus: PaymentStatus = paid >= effTotal ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid';
      const collectionStatus: CollectionStatus = paid >= effTotal ? 'Paid' : 'Overdue';
      updated = { ...inv, payments, paymentStatus, collectionStatus };
      return updated;
    }));
    if (updated) {
      upsertInvoiceRemote(updated);
      // Auto-generate customer payment journal entry
      autoPostPaymentReceived(
        { id: updated.id, invoiceNo: updated.invoiceNo, customer: updated.customer, invoiceDate: updated.invoiceDate, amount: updated.amount, tax: updated.tax, total: updated.total, currency: updated.currency, exchangeRate: updated.exchangeRate },
        newPayment
      ).catch(() => {/* non-blocking */});
    }
    setPaymentInvoice(null);
    setScreen('dashboard');
    setActiveTab('dashboard');
  };

  const saveCreditNote = (cn: Omit<CreditNote, 'id'>) => {
    const source = selectedInvoice ?? editingInvoice;
    if (!source) return;
    const newCn: CreditNote = { ...cn, id: Date.now().toString() };
    const creditNotes = [...(source.creditNotes ?? []), newCn];
    const effTot = source.total - creditNotes.reduce((s, c) => s + c.amount, 0);
    const paid = totalPaid(source);
    const paymentStatus: PaymentStatus = paid >= effTot ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid';
    const updated: Invoice = { ...source, creditNotes, paymentStatus };
    setInvoices(prev => prev.map(i => i.id === updated.id ? updated : i));
    if (selectedInvoice) setSelectedInvoice(updated);
    if (editingInvoice) setEditingInvoice(updated);
    upsertInvoiceRemote(updated);
    // Auto-generate credit note journal entry
    autoPostCreditNote(
      { id: source.id, invoiceNo: source.invoiceNo, customer: source.customer, invoiceDate: source.invoiceDate, amount: source.amount, tax: source.tax, total: source.total, currency: source.currency, exchangeRate: source.exchangeRate },
      newCn
    ).catch(() => {/* non-blocking */});
  };

  // ── Tab change ──

  const handleTabChange = (tab: typeof activeTab) => {
    setActiveTab(tab);
    setScreen(tab);
  };

  // ── Render ──

  return (
    <div className="p-4 md:p-6 space-y-5" dir="rtl">
      {loading && (
        <div className="bg-[#1b2130] border border-gray-700 rounded-lg px-4 py-2 text-xs text-gray-400 flex items-center gap-2">
          <span className="material-icons text-sm animate-spin">sync</span>
          جاري تحميل البيانات من الخادم...
        </div>
      )}
      {loadError && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-sm text-red-300 flex items-center gap-2">
          <span className="material-icons text-base shrink-0">error_outline</span>
          <div>
            <p className="font-semibold">تعذّر تحميل البيانات من قاعدة البيانات</p>
            <p className="text-xs text-red-400 mt-0.5">{loadError}</p>
          </div>
        </div>
      )}
      {/* Module Header */}
      <div className="flex items-center gap-3">
        <span className="material-icons text-primary text-2xl">account_balance</span>
        <div>
          <h2 className="text-xl font-bold text-black">الادارة المالية — التحصيلات</h2>
          <p className="text-gray-500 text-xs">إدارة الفواتير ومتابعة التحصيل وتسجيل المدفوعات</p>
        </div>
      </div>

      {/* Tab Bar — only show when not on detail / create screens */}
      {(screen === 'dashboard' || screen === 'invoice-list' || screen === 'payment-entry' || screen === 'history') && (
        <div className="flex gap-1 bg-[#1b2130] p-1 rounded-xl w-fit">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                activeTab === tab.id
                  ? 'bg-primary text-white shadow-md'
                  : 'text-gray-400 hover:text-white hover:bg-[#2d3648]'
              }`}
            >
              <span className="material-icons text-base">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Screen Router */}
      {screen === 'dashboard' && (
        <DashboardScreen invoices={invoices} onOpen={inv => { setActiveTab('invoice-list'); openInvoice(inv); }} />
      )}
      {screen === 'invoice-list' && (
        <InvoiceListScreen
          invoices={invoices}
          onOpen={openInvoice}
          onNew={goCreateInvoice}
          canDelete={user.role === 'super_admin' || user.role === 'power_admin' || user.role === 'admin' || (user.username || '').toLowerCase() === 'taher.mohamed@pbkadvisory.com'}
          onDelete={ids => {
            setInvoices(prev => prev.filter(i => !ids.includes(i.id)));
            deleteInvoicesRemote(ids);
          }}
        />
      )}
      {screen === 'create-invoice' && (
        <CreateInvoiceScreen editing={editingInvoice} invoices={invoices} onSave={saveInvoice} onAddCreditNote={editingInvoice ? saveCreditNote : undefined} onCancel={goBack} user={user} />
      )}
      {screen === 'invoice-details' && selectedInvoice && (
        <InvoiceDetailsScreen
          invoice={selectedInvoice}
          onEdit={goEditInvoice}
          onAddPayment={() => goAddPayment()}
          onUpdateCollection={updateCollection}
          onAddCreditNote={saveCreditNote}
          onBack={goBack}
          canEdit={isAdmin}
          onSaveCurrency={patch => patchInvoice(selectedInvoice.id, patch)}
          onUpdatePayment={(pid, patch) => updatePayment(selectedInvoice.id, pid, patch)}
          onDeletePayment={(pid) => deletePayment(selectedInvoice.id, pid)}
        />
      )}
      {screen === 'payment-entry' && (
        <PaymentEntryScreen
          invoice={paymentInvoice}
          invoices={invoices}
          onSelectInvoice={setPaymentInvoice}
          onSave={savePayment}
          onCancel={() => { setScreen('dashboard'); setActiveTab('dashboard'); }}
          canEditInvoice={isAdmin}
          onEditInvoice={inv => { setEditingInvoice(inv); setScreen('create-invoice'); }}
          onUpdateCollection={updateCollectionForInvoice}
        />
      )}
      {screen === 'history' && (
        <HistoryScreen
          invoices={invoices}
          onOpen={inv => { setActiveTab('invoice-list'); openInvoice(inv); }}
          canEdit={user.role === 'super_admin' || user.role === 'power_admin' || user.role === 'admin' || (user.username || '').toLowerCase() === 'taher.mohamed@pbkadvisory.com'}
          onDeletePayment={deletePayment}
          onEditPayment={(invoiceId, payment) => updatePayment(invoiceId, payment.id, payment)}
        />
      )}
    </div>
  );
};

export default CollectionsDashboard;
