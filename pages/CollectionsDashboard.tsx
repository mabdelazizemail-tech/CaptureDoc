import React, { useState, useMemo, useRef, useEffect } from 'react';
import { User } from '../services/types';
import { parseInvoicePdf, ParsedInvoice } from '../services/invoicePdfParser';
import { loadInvoices as loadInvoicesRemote, upsertInvoice as upsertInvoiceRemote, deleteInvoices as deleteInvoicesRemote } from '../services/collectionsStorage';

// ─── Types ────────────────────────────────────────────────────────────────────

type InvoiceStatus = 'Draft' | 'Approved' | 'Sent' | 'Cancelled';
type CollectionStatus = 'Not Due' | 'Due' | 'Overdue' | 'Partially Paid' | 'Paid' | 'Disputed';
type PaymentStatus = 'Unpaid' | 'Partial' | 'Paid';
type Screen = 'dashboard' | 'invoice-list' | 'create-invoice' | 'invoice-details' | 'payment-entry';

interface Payment {
  id: string;
  receiptDate: string;
  amountReceived: number;
  paymentMethod: string;
  referenceNo: string;
}

interface Invoice {
  id: string;
  invoiceNo: string;
  customer: string;
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
    collectionStatus: 'Partially Paid',
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
    collectionStatus: 'Not Due',
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
  Disputed: 'bg-purple-900/50 text-purple-300',
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

const balance = (inv: Invoice) => inv.total - totalPaid(inv);

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
  const paid = totalPaid(inv);
  if (paid >= inv.total && inv.total > 0) return 'Paid';
  if (paid > 0) return 'Partially Paid';
  if (inv.collectionStatus === 'Disputed') return 'Disputed';
  if (!inv.invoiceDate) return inv.collectionStatus;
  const now = new Date();
  const dueFrom = new Date(inv.invoiceDate);
  dueFrom.setMonth(dueFrom.getMonth() + 1);
  // Overdue once the dueDate passes, or 2 months after invoiceDate if no dueDate.
  const overdueFrom = inv.dueDate ? new Date(inv.dueDate) : (() => {
    const d = new Date(inv.invoiceDate);
    d.setMonth(d.getMonth() + 2);
    return d;
  })();
  if (now > overdueFrom) return 'Overdue';
  return now >= dueFrom ? 'Due' : 'Not Due';
};

// ─── Tab Bar ──────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: 'dashboard' },
  { id: 'invoice-list', label: 'إصدار الفواتير', icon: 'receipt_long' },
  { id: 'payment-entry', label: 'تسجيل السداد', icon: 'payments' },
] as const;

// ─── Screen: Dashboard ────────────────────────────────────────────────────────

const DashboardScreen: React.FC<{
  invoices: Invoice[];
  onOpen: (inv: Invoice) => void;
}> = ({ invoices, onOpen }) => {
  const sent = invoices.filter(i => i.invoiceStatus === 'Sent');
  const totalSent = sent.reduce((s, i) => s + i.total, 0);
  const totalDue = invoices
    .filter(i => { const s = effectiveCollectionStatus(i); return s === 'Due' || s === 'Overdue'; })
    .reduce((s, i) => s + balance(i), 0);
  const totalOverdue = invoices
    .filter(i => effectiveCollectionStatus(i) === 'Overdue')
    .reduce((s, i) => s + balance(i), 0);
  const totalPaidAmt = invoices
    .filter(i => i.paymentStatus === 'Paid')
    .reduce((s, i) => s + i.total, 0);

  const overdue = invoices.filter(i => effectiveCollectionStatus(i) === 'Overdue');

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'إجمالي المُرسلة', value: totalSent, icon: 'send', color: 'text-blue-400' },
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

      {/* Overdue List */}
      <div className="bg-[#232b3e] rounded-xl border border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-2">
          <span className="material-icons text-red-400 text-lg">warning</span>
          <h3 className="font-semibold text-white">الفواتير المتأخرة</h3>
          <span className="mr-auto bg-red-900/50 text-red-400 text-xs px-2 py-0.5 rounded-full">{overdue.length}</span>
        </div>
        {overdue.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">لا توجد فواتير متأخرة</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs border-b border-gray-700">
                <th className="px-5 py-3 text-right">رقم الفاتورة</th>
                <th className="px-5 py-3 text-right">العميل</th>
                <th className="px-5 py-3 text-right">تاريخ الاستحقاق</th>
                <th className="px-5 py-3 text-right">الرصيد</th>
                <th className="px-5 py-3 text-right">آخر متابعة</th>
                <th className="px-2 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {overdue.map(inv => (
                <tr key={inv.id} className="border-b border-gray-700/50 hover:bg-[#2d3648] transition-colors">
                  <td className="px-5 py-3 text-white font-mono text-xs">{inv.invoiceNo}</td>
                  <td className="px-5 py-3 text-gray-300">{inv.customer}</td>
                  <td className="px-5 py-3 text-red-400">{inv.dueDate}</td>
                  <td className="px-5 py-3 text-white font-semibold">{fmt(balanceInEgp(inv))} EGP</td>
                  <td className="px-5 py-3 text-gray-400">{inv.lastFollowUp || '—'}</td>
                  <td className="px-2 py-3">
                    <button
                      onClick={() => onOpen(inv)}
                      className="text-primary hover:text-blue-300 transition-colors"
                    >
                      <span className="material-icons text-base">open_in_new</span>
                    </button>
                  </td>
                </tr>
              ))}
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

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const filtered = useMemo(() =>
    invoices.filter(inv => {
      const matchSearch =
        inv.invoiceNo.toLowerCase().includes(search.toLowerCase()) ||
        inv.customer.includes(search);
      const matchStatus = filterStatus === 'All' || inv.invoiceStatus === filterStatus;
      return matchSearch && matchStatus;
    }), [invoices, search, filterStatus]);

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
              <th className="px-5 py-3 text-right">رقم الفاتورة</th>
              <th className="px-5 py-3 text-right">العميل</th>
              <th className="px-5 py-3 text-right">تاريخ الفاتورة</th>
              <th className="px-5 py-3 text-right">الاستحقاق</th>
              <th className="px-5 py-3 text-right">الإجمالي</th>
              <th className="px-5 py-3 text-right">حالة الفاتورة</th>
              <th className="px-5 py-3 text-right">حالة التحصيل</th>
              <th className="px-2 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={canDelete ? 9 : 8} className="px-5 py-10 text-center text-gray-500">لا توجد فواتير مطابقة</td>
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
                <td className="px-5 py-3 text-gray-400">{inv.invoiceDate}</td>
                <td className="px-5 py-3 text-gray-400">{inv.dueDate}</td>
                <td className="px-5 py-3 text-white font-semibold">
                  <div>{fmt(totalInEgp(inv))} <span className="text-xs text-gray-400">EGP</span></div>
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
                    return (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${collectionStatusColor[s]}`}>
                        {collectionStatusAr[s]}
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
  invoiceDate: new Date().toISOString().slice(0, 10),
  dueDate: '',
  amount: 0,
  tax: 0,
  total: 0,
  invoiceStatus: 'Sent',
  currency: 'EGP',
  exchangeRate: 0,
});

const CreateInvoiceScreen: React.FC<{
  editing: Invoice | null;
  onSave: (data: Partial<Invoice>) => void;
  onCancel: () => void;
}> = ({ editing, onSave, onCancel }) => {
  const [form, setForm] = useState(() =>
    editing
      ? { invoiceNo: editing.invoiceNo, customer: editing.customer, invoiceDate: editing.invoiceDate, dueDate: editing.dueDate, amount: editing.amount, tax: editing.tax, total: editing.total, invoiceStatus: editing.invoiceStatus, currency: editing.currency || 'EGP', exchangeRate: editing.exchangeRate || 0 }
      : emptyForm()
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [uploadedName, setUploadedName] = useState(editing?.pdfName || '');
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(editing?.pdfData || '');
  const [pdfData, setPdfData] = useState<string>(editing?.pdfData || '');
  const [pdfName, setPdfName] = useState<string>(editing?.pdfName || '');
  const [parseResult, setParseResult] = useState<{ status: 'idle' | 'success' | 'partial' | 'error'; message: string; matchedFields?: string[] }>({ status: 'idle', message: '' });

  // Revoke blob URL on unmount (only blob: URLs — data: URLs don't need revoking)
  useEffect(() => {
    return () => { if (pdfPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(pdfPreviewUrl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k: string, v: string | number) =>
    setForm(f => {
      const next = { ...f, [k]: v };
      if (k === 'amount' || k === 'tax') {
        next.total = Number(next.amount) + Number(next.tax);
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
      <div className="order-1 lg:order-1 max-w-2xl w-full bg-[#232b3e] rounded-xl border border-gray-700 overflow-hidden self-start">
        <div className="px-6 py-4 border-b border-gray-700 flex items-center gap-2">
          <span className="material-icons text-primary">receipt_long</span>
          <h3 className="font-semibold text-white">{editing ? 'تعديل الفاتورة' : 'فاتورة جديدة'}</h3>
        </div>

        {/* PDF Upload Section (hidden when editing) */}
        {!editing && (
          <div className="px-6 pt-5 pb-4 border-b border-gray-700 bg-[#1b2130]/40">
            <div className="flex items-center gap-2 mb-3">
              <span className="material-icons text-primary text-lg">upload_file</span>
              <h4 className="text-sm font-semibold text-white">استيراد فاتورة من PDF</h4>
              <span className="text-xs text-gray-500">(استخراج تلقائي عبر OCR)</span>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleFileUpload}
              className="hidden"
            />

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={parsing}
                className="flex items-center gap-2 bg-primary/20 hover:bg-primary/30 border border-primary/50 text-primary px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {parsing ? (
                  <>
                    <span className="material-icons text-base animate-spin">progress_activity</span>
                    جاري قراءة الفاتورة (OCR)...
                  </>
                ) : (
                  <>
                    <span className="material-icons text-base">cloud_upload</span>
                    اختر ملف PDF
                  </>
                )}
              </button>
              {uploadedName && !parsing && (
                <span className="text-xs text-gray-400 truncate" title={uploadedName}>
                  <span className="material-icons text-xs align-middle ml-1">description</span>
                  {uploadedName}
                </span>
              )}
            </div>

            {parseResult.status !== 'idle' && (
              <div className={`mt-3 flex items-start gap-2 px-3 py-2 rounded-lg border text-xs ${resultStyles[parseResult.status]}`}>
                <span className="material-icons text-base shrink-0">{resultIcons[parseResult.status]}</span>
                <div className="flex-1">
                  <p>{parseResult.message}</p>
                  {parseResult.matchedFields && parseResult.matchedFields.length > 0 && (
                    <p className="mt-1 opacity-80">الحقول: {parseResult.matchedFields.join('، ')}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <Field label="رقم الفاتورة" required>
              <input type="text" value={form.invoiceNo} onChange={e => set('invoiceNo', e.target.value)} required className={inputCls} placeholder="INV-2025-005" />
            </Field>
            <Field label="العميل" required>
              <select
                value={CUSTOMERS.includes(form.customer) ? form.customer : ''}
                onChange={e => set('customer', e.target.value)}
                required
                className={inputCls}
              >
                <option value="">-- اختر العميل --</option>
                {CUSTOMERS.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {form.customer && !CUSTOMERS.includes(form.customer) && (
                <p className="text-xs text-yellow-400 mt-1">
                  <span className="material-icons text-xs align-middle">info</span>
                  {' '}تم استخراج "{form.customer}" من PDF — اختر المطابق من القائمة
                </p>
              )}
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
          </div>

          <div className="bg-[#1b2130] rounded-lg px-5 py-4 flex items-center justify-between">
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
  );
};

// ─── Screen: Invoice Details ──────────────────────────────────────────────────

const InvoiceDetailsScreen: React.FC<{
  invoice: Invoice;
  onEdit: () => void;
  onAddPayment: () => void;
  onUpdateCollection: (data: Pick<Invoice, 'collectionStatus' | 'lastFollowUp' | 'nextFollowUp' | 'notes'>) => void;
  onBack: () => void;
}> = ({ invoice, onEdit, onAddPayment, onUpdateCollection, onBack }) => {
  const [followUp, setFollowUp] = useState({
    collectionStatus: invoice.collectionStatus,
    lastFollowUp: invoice.lastFollowUp,
    nextFollowUp: invoice.nextFollowUp,
    notes: invoice.notes,
  });
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    onUpdateCollection(followUp);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const paid = paidInEgp(invoice);
  const remaining = balanceInEgp(invoice);
  const totalEgp = totalInEgp(invoice);

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Back + Actions */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="flex items-center gap-1 text-gray-400 hover:text-white text-sm transition-colors">
          <span className="material-icons text-base">arrow_forward</span>
          رجوع
        </button>
        <span className="text-gray-600">|</span>
        <span className="text-gray-300 font-mono text-sm">{invoice.invoiceNo}</span>
        <div className="mr-auto flex gap-2">
          {invoice.pdfData && (
            <a
              href={invoice.pdfData}
              target="_blank"
              rel="noopener noreferrer"
              download={invoice.pdfName || `${invoice.invoiceNo}.pdf`}
              className="flex items-center gap-1 bg-[#2d3648] hover:bg-[#3a4458] text-gray-300 px-3 py-2 rounded-lg text-sm transition-colors"
            >
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
        <InfoCell label="تاريخ الفاتورة" value={invoice.invoiceDate} />
        <InfoCell label="تاريخ الاستحقاق" value={invoice.dueDate} />
        <InfoCell label="حالة الفاتورة">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${invoiceStatusColor[invoice.invoiceStatus]}`}>
            {invoiceStatusAr[invoice.invoiceStatus]}
          </span>
        </InfoCell>
      </div>

      {/* Financials */}
      <div className="bg-[#232b3e] rounded-xl border border-gray-700 p-5 grid grid-cols-3 gap-4">
        <InfoCell label="الإجمالي" value={`${fmt(totalEgp)} EGP`} valueClass="text-white font-bold text-lg" />
        <InfoCell label="المحصّل" value={`${fmt(paid)} EGP`} valueClass="text-green-400 font-bold text-lg" />
        <InfoCell label="الرصيد المتبقي" value={`${fmt(remaining)} EGP`} valueClass={remaining > 0 ? 'text-red-400 font-bold text-lg' : 'text-green-400 font-bold text-lg'} />
      </div>

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
                {(Object.keys(collectionStatusAr) as CollectionStatus[]).map(s => (
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
      <div className="bg-[#232b3e] rounded-xl border border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-2">
          <span className="material-icons text-green-400 text-lg">history</span>
          <h3 className="font-semibold text-white">سجل المدفوعات</h3>
        </div>
        {invoice.payments.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">لا توجد مدفوعات مسجّلة</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs border-b border-gray-700 bg-[#1b2130]">
                <th className="px-5 py-3 text-right">تاريخ الاستلام</th>
                <th className="px-5 py-3 text-right">المبلغ</th>
                <th className="px-5 py-3 text-right">طريقة الدفع</th>
                <th className="px-5 py-3 text-right">رقم المرجع</th>
              </tr>
            </thead>
            <tbody>
              {invoice.payments.map(p => (
                <tr key={p.id} className="border-b border-gray-700/50">
                  <td className="px-5 py-3 text-gray-300">{p.receiptDate}</td>
                  <td className="px-5 py-3 text-green-400 font-semibold">{fmt(p.amountReceived)} EGP</td>
                  <td className="px-5 py-3 text-gray-300">{p.paymentMethod}</td>
                  <td className="px-5 py-3 text-gray-400 font-mono text-xs">{p.referenceNo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
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
}> = ({ invoice, invoices, onSelectInvoice, onSave, onCancel }) => {
  const payable = invoices.filter(i => i.paymentStatus !== 'Paid' && i.invoiceStatus !== 'Cancelled' && i.invoiceStatus !== 'Draft');

  const [form, setForm] = useState({
    receiptDate: new Date().toISOString().slice(0, 10),
    amountReceived: '',
    paymentMethod: 'تحويل بنكي',
    referenceNo: '',
  });

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoice) return;
    onSave(invoice.id, {
      receiptDate: form.receiptDate,
      amountReceived: Number(form.amountReceived),
      paymentMethod: form.paymentMethod,
      referenceNo: form.referenceNo,
    });
  };

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
              if (inv) onSelectInvoice(inv);
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
          {/* Invoice summary */}
          <div className="bg-[#1b2130] rounded-lg px-5 py-4 grid grid-cols-3 gap-3 text-sm">
            <InfoCell label="الإجمالي" value={`${fmt(totalInEgp(invoice))} EGP`} />
            <InfoCell label="المحصّل" value={`${fmt(paidInEgp(invoice))} EGP`} valueClass="text-green-400" />
            <InfoCell label="المتبقي" value={`${fmt(balanceInEgp(invoice))} EGP`} valueClass="text-red-400 font-bold" />
          </div>

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
                <Field label="المبلغ المستلم" required>
                  <input
                    type="number"
                    step="any"
                    value={form.amountReceived}
                    onChange={e => set('amountReceived', e.target.value)}
                    min={1}
                    max={Math.ceil(balance(invoice) * 1000) / 1000}
                    required
                    className={inputCls}
                    placeholder="0"
                  />
                </Field>
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

  // Load from Supabase on mount. One-time: if Supabase is empty but this
  // browser has legacy localStorage invoices, push them up so nothing is lost.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let rows = await loadInvoicesRemote<Invoice>();
      if (rows.length === 0) {
        try {
          const raw = localStorage.getItem('collections.invoices.v1');
          if (raw) {
            const legacy = JSON.parse(raw);
            if (Array.isArray(legacy) && legacy.length) {
              await Promise.all(legacy.map((inv: Invoice) => upsertInvoiceRemote(inv)));
              rows = legacy as Invoice[];
              console.log(`[collections] migrated ${legacy.length} invoices from localStorage to Supabase`);
            }
          }
        } catch (e) {
          console.warn('[collections] localStorage migration skipped', e);
        }
      }
      if (cancelled) return;
      const normalized = rows.map(inv =>
        inv.invoiceStatus === 'Draft' || inv.invoiceStatus === 'Approved'
          ? { ...inv, invoiceStatus: 'Sent' as InvoiceStatus }
          : inv
      );
      setInvoices(normalized);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'invoice-list' | 'payment-entry'>('dashboard');
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
        collectionStatus: 'Not Due',
        paymentStatus: 'Unpaid',
        lastFollowUp: '',
        nextFollowUp: '',
        notes: '',
        payments: [],
        ...(data as Omit<Invoice, 'id' | 'payments'>),
      };
      setInvoices(prev => [newInv, ...prev]);
      upsertInvoiceRemote(newInv);
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

  const savePayment = (invoiceId: string, payment: Omit<Payment, 'id'>) => {
    const newPayment: Payment = { ...payment, id: Date.now().toString() };
    let updated: Invoice | null = null;
    setInvoices(prev => prev.map(inv => {
      if (inv.id !== invoiceId) return inv;
      const payments = [...inv.payments, newPayment];
      const paid = payments.reduce((s, p) => s + p.amountReceived, 0);
      const paymentStatus: PaymentStatus = paid >= inv.total ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid';
      const collectionStatus: CollectionStatus = paid >= inv.total ? 'Paid' : 'Partially Paid';
      updated = { ...inv, payments, paymentStatus, collectionStatus };
      return updated;
    }));
    if (updated) upsertInvoiceRemote(updated);
    setPaymentInvoice(null);
    setScreen('dashboard');
    setActiveTab('dashboard');
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
      {/* Module Header */}
      <div className="flex items-center gap-3">
        <span className="material-icons text-primary text-2xl">account_balance</span>
        <div>
          <h2 className="text-xl font-bold text-black">الادارة المالية — التحصيلات</h2>
          <p className="text-gray-500 text-xs">إدارة الفواتير ومتابعة التحصيل وتسجيل المدفوعات</p>
        </div>
      </div>

      {/* Tab Bar — only show when not on detail / create screens */}
      {(screen === 'dashboard' || screen === 'invoice-list' || screen === 'payment-entry') && (
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
          canDelete={user.role === 'super_admin' || user.role === 'power_admin' || (user.username || '').toLowerCase() === 'taher.mohamed@pbkadvisory.com'}
          onDelete={ids => {
            setInvoices(prev => prev.filter(i => !ids.includes(i.id)));
            deleteInvoicesRemote(ids);
          }}
        />
      )}
      {screen === 'create-invoice' && (
        <CreateInvoiceScreen editing={editingInvoice} onSave={saveInvoice} onCancel={goBack} />
      )}
      {screen === 'invoice-details' && selectedInvoice && (
        <InvoiceDetailsScreen
          invoice={selectedInvoice}
          onEdit={goEditInvoice}
          onAddPayment={() => goAddPayment()}
          onUpdateCollection={updateCollection}
          onBack={goBack}
        />
      )}
      {screen === 'payment-entry' && (
        <PaymentEntryScreen
          invoice={paymentInvoice}
          invoices={invoices}
          onSelectInvoice={setPaymentInvoice}
          onSave={savePayment}
          onCancel={() => { setScreen('dashboard'); setActiveTab('dashboard'); }}
        />
      )}
    </div>
  );
};

export default CollectionsDashboard;
