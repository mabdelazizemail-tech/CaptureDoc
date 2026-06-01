import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { User, Project } from '../services/types';
import { StorageService } from '../services/storage';
import {
  loadPayables,
  upsertPayable,
  deletePayables,
} from '../services/payablesStorage';
import { parsePayableInvoicePdf, ParsedPayableInvoice } from '../services/invoicePdfParser';
import { supabase } from '../services/supabaseClient';
import { autoPostSupplierInvoice, autoPostSupplierPayment } from '../services/journalAutoPost';

// ─── Types ────────────────────────────────────────────────────────────────────

type ApprovalStatus = 'Draft' | 'Pending' | 'Approved' | 'Rejected';
type PaymentStatus  = 'Unpaid' | 'Partial' | 'Paid';
type APStatus       = 'Not Due' | 'Due' | 'Overdue' | 'Partially Paid' | 'Paid' | 'On Hold';
type InvoiceType    = 'توريدات' | 'خدمات' | 'أصول' | 'مصروفات تشغيل';
type Screen         = 'dashboard' | 'invoice-list' | 'create-invoice' | 'invoice-details' | 'payment-entry' | 'history';
type SortDir        = 'asc' | 'desc';

interface SupplierPayment {
  id: string;
  paymentDate: string;
  amountPaid: number;
  paymentCurrency?: 'EGP' | 'USD';
  amountPaidEgp?: number;
  paymentMethod: 'تحويل بنكي' | 'شيك' | 'خصم مباشر' | 'نقدي' | 'أخرى';
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
  invoiceType: InvoiceType;
  withholdingTax?: number;
  approvalStatus: ApprovalStatus;
  paymentStatus: PaymentStatus;
  apStatus: APStatus;
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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function b64ToBlobUrl(base64: string): string {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
}

const fmt = (n: number) =>
  n.toLocaleString('en-EG', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const totalInEgp = (inv: PayableInvoice): number =>
  inv.currency === 'USD' ? inv.total * (inv.exchangeRate || 0) : inv.total;

const totalPaid = (inv: PayableInvoice) =>
  inv.payments.reduce((s, p) => s + p.amountPaid, 0);

const totalDeductions = (inv: PayableInvoice) =>
  (inv.deductions ?? []).reduce((s, d) => s + d.amount, 0);

const effectiveTotal = (inv: PayableInvoice) =>
  inv.total - totalDeductions(inv);

const balance = (inv: PayableInvoice) => effectiveTotal(inv) - totalPaid(inv);

const balanceInEgp = (inv: PayableInvoice): number => {
  const b = balance(inv);
  return inv.currency === 'USD' ? b * (inv.exchangeRate || 0) : b;
};

const paidInEgp = (inv: PayableInvoice): number => {
  const p = totalPaid(inv);
  return inv.currency === 'USD' ? p * (inv.exchangeRate || 0) : p;
};

const effectiveAPStatus = (inv: PayableInvoice): APStatus => {
  const paid = totalPaid(inv);
  const eff = effectiveTotal(inv);
  if (paid >= eff && eff > 0) return 'Paid';
  if (paid > 0) return 'Partially Paid';
  if (inv.apStatus === 'On Hold') return 'On Hold';
  if (!inv.dueDate) return inv.apStatus;
  const now = new Date();
  const due = new Date(inv.dueDate);
  const dueFrom = new Date(inv.invoiceDate);
  dueFrom.setMonth(dueFrom.getMonth() + 1);
  if (now > due) return 'Overdue';
  return now >= dueFrom ? 'Due' : 'Not Due';
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

// ─── Status Maps ──────────────────────────────────────────────────────────────

const approvalColor: Record<ApprovalStatus, string> = {
  Draft:    'bg-gray-700 text-gray-300',
  Pending:  'bg-red-900/50 text-red-400',
  Approved: 'bg-blue-900/50 text-blue-300',
  Rejected: 'bg-red-900/40 text-red-400',
};
const approvalAr: Record<ApprovalStatus, string> = {
  Draft:    'مسودة',
  Pending:  'طلب اعتماد',
  Approved: 'معتمدة',
  Rejected: 'مرفوضة',
};

const apStatusColor: Record<APStatus, string> = {
  'Not Due':        'bg-gray-700 text-gray-300',
  'Due':            'bg-yellow-900/50 text-yellow-300',
  'Overdue':        'bg-red-900/50 text-red-400',
  'Partially Paid': 'bg-orange-900/50 text-orange-300',
  'Paid':           'bg-green-900/50 text-green-400',
  'On Hold':        'bg-cyan-900/50 text-cyan-300',
};
const apStatusAr: Record<APStatus, string> = {
  'Not Due':        'لم يحن موعده',
  'Due':            'مستحق السداد',
  'Overdue':        'متأخر السداد',
  'Partially Paid': 'مدفوع جزئياً',
  'Paid':           'مسدّد',
  'On Hold':        'موقوف',
};

const paymentStatusAr: Record<PaymentStatus, string> = {
  Unpaid:  'غير مدفوع',
  Partial: 'جزئي',
  Paid:    'مدفوع',
};

// ─── Sort Helpers ─────────────────────────────────────────────────────────────

function cmp(a: any, b: any): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'ar');
}
function applyDir(v: number, dir: SortDir) { return dir === 'asc' ? v : -v; }

const SortTh: React.FC<{
  label: string; col: string; sortCol: string | null;
  sortDir: SortDir; onSort: (c: string) => void; className?: string;
}> = ({ label, col, sortCol, sortDir, onSort, className = 'px-4 py-3 text-right' }) => (
  <th className={`${className} cursor-pointer select-none hover:text-gray-300 transition-colors`}
      onClick={() => onSort(col)}>
    <span className="inline-flex items-center gap-1">
      {label}
      <span className="text-gray-600 text-[10px]">
        {sortCol === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
      </span>
    </span>
  </th>
);

// ─── Seed Data ────────────────────────────────────────────────────────────────

const SUPPLIERS: string[] = [
  'لينك داتا سنتر لتداول البيانات',
  'محمد احمد محمد الخطيب زيروكس دوت كوم',
  'محمد محمود احمد وشريكيه الشركة المصرية للانظمة المبتكرة',
  'كلود تيم للاستشارات',
  'اوبن تكست للاستشارات',
  'رافت رسمى فرج جندى',
  'هيثم صلاح الدين عبد الحافظ قاسم كليك للتوريدات',
  'محمد جمال عبدالناصر رويال للتوريدات العموميه والخدمات',
  'على سعيد حسن محمد زرينه',
  'احمد علي عبدالقادر علي',
  'بسام اسماعيل عبدالفتاح بدر مكتبه بسام',
  'هايبر وان للتجارة',
  'انسايت تكنولوجى',
  'اوكتين سولوشنز للتصميم وانتاج البرامج',
  'شيماء شعبان طه مصطفي الاهليه',
  'المصرية لخدمات المستندات',
  'بن اليمنى عبدالمعبود',
  'كرم عارف حمادي ابراهيم',
  'سمارت فورس للخدمات الرقميه',
  'طارق احمد عثمان ديجيتال شوب سامسونج',
  'منار مراد عوض الله برايم واى للتوريدات العامه ونقل الموظفين',
  'احمد نبيشي فرج الجالي مكتبه الطيب للتوريدات العموميه',
];


const SEED: PayableInvoice[] = [
  {
    id: 's1',
    invoiceNo: 'PUR-2025-001',
    supplier: 'شركة الدلتا للتوريدات',
    costCenter: 'مشروع القاهرة',
    invoiceDate: '2025-03-01',
    dueDate: '2025-03-31',
    amount: 42000,
    tax: 5880,
    total: 47880,
    hasTax: true,
    invoiceType: 'توريدات',
    withholdingTax: 1260,
    approvalStatus: 'Approved',
    paymentStatus: 'Unpaid',
    apStatus: 'Overdue',
    currency: 'EGP',
    payments: [],
    notes: 'توريدات مواد خام — بانتظار إذن الصرف.',
  },
  {
    id: 's2',
    invoiceNo: 'PUR-2025-002',
    supplier: 'مؤسسة النيل للخدمات',
    costCenter: 'الإدارة العامة',
    invoiceDate: '2025-03-15',
    dueDate: '2025-04-15',
    amount: 28000,
    tax: 3920,
    total: 31920,
    hasTax: true,
    invoiceType: 'خدمات',
    approvalStatus: 'Approved',
    paymentStatus: 'Partial',
    apStatus: 'Partially Paid',
    currency: 'EGP',
    payments: [
      { id: 'pp1', paymentDate: '2025-04-05', amountPaid: 15000, paymentMethod: 'تحويل بنكي', bankName: 'بنك مصر', referenceNo: 'TRF-9910' },
    ],
    notes: 'دفعة أولى تمت — الباقي في نهاية أبريل.',
  },
  {
    id: 's3',
    invoiceNo: 'PUR-2025-003',
    supplier: 'شركة تك مصر لتقنية المعلومات',
    costCenter: 'قسم تقنية المعلومات',
    invoiceDate: '2025-04-01',
    dueDate: '2025-05-01',
    amount: 55000,
    tax: 7700,
    total: 62700,
    hasTax: true,
    invoiceType: 'أصول',
    approvalStatus: 'Pending',
    paymentStatus: 'Unpaid',
    apStatus: 'Not Due',
    currency: 'EGP',
    payments: [],
    notes: 'بانتظار اعتماد المدير المالي.',
  },
  {
    id: 's4',
    invoiceNo: 'PUR-2025-004',
    supplier: 'المجموعة العربية للمقاولات',
    costCenter: 'مشروع الإسكندرية',
    invoiceDate: '2025-02-01',
    dueDate: '2025-03-01',
    amount: 120000,
    tax: 16800,
    total: 136800,
    hasTax: true,
    invoiceType: 'مصروفات تشغيل',
    approvalStatus: 'Approved',
    paymentStatus: 'Paid',
    apStatus: 'Paid',
    currency: 'EGP',
    payments: [
      { id: 'pp2', paymentDate: '2025-03-05', amountPaid: 136800, paymentMethod: 'شيك', referenceNo: 'CHK-2241' },
    ],
    notes: 'تم السداد الكامل.',
  },
  {
    id: 's5',
    invoiceNo: 'PUR-2025-005',
    supplier: 'شركة الأمل للصيانة والتشغيل',
    costCenter: 'مشروع القاهرة',
    invoiceDate: '2025-04-10',
    dueDate: '2025-05-10',
    amount: 18000,
    tax: 2520,
    total: 20520,
    hasTax: true,
    invoiceType: 'خدمات',
    approvalStatus: 'Draft',
    paymentStatus: 'Unpaid',
    apStatus: 'Not Due',
    currency: 'EGP',
    payments: [],
    notes: '',
  },
];

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'dashboard',     label: 'لوحة التحكم',      icon: 'dashboard' },
  { id: 'invoice-list',  label: 'فواتير الموردين',   icon: 'receipt_long' },
  { id: 'payment-entry', label: 'تنفيذ الدفع',       icon: 'payments' },
  { id: 'history',       label: 'سجل المدفوعات',     icon: 'history' },
] as const;

// ─── KPI Card ─────────────────────────────────────────────────────────────────

const KPICard: React.FC<{
  icon: string; iconColor: string; label: string;
  value: string; sub?: string; subColor?: string; border?: string;
}> = ({ icon, iconColor, label, value, sub, subColor = 'text-gray-500', border = 'border-gray-700' }) => (
  <div className={`bg-[#232b3e] rounded-xl p-4 border ${border}`}>
    <div className="flex items-center gap-2 mb-2">
      <span className={`material-icons text-lg ${iconColor}`}>{icon}</span>
      <span className="text-gray-400 text-xs">{label}</span>
    </div>
    <p className="text-xl font-bold text-white">{value}</p>
    <p className="text-gray-500 text-xs">EGP</p>
    {sub && (
      <div className={`mt-2 pt-2 border-t border-gray-700/60 text-xs font-semibold ${subColor}`}>{sub}</div>
    )}
  </div>
);

// ─── Screen: Dashboard ────────────────────────────────────────────────────────

const DashboardScreen: React.FC<{
  invoices: PayableInvoice[];
  onOpen: (inv: PayableInvoice) => void;
}> = ({ invoices, onOpen }) => {
  const [sortCol, setSortCol] = useState<string | null>('dueDate');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (col: string) => {
    setSortDir(p => sortCol === col && p === 'asc' ? 'desc' : 'asc');
    setSortCol(col);
  };

  const approved   = invoices.filter(i => i.approvalStatus === 'Approved');
  const totalOblig = approved.reduce((s, i) => s + totalInEgp(i), 0);
  const totalDue   = invoices.filter(i => { const s = effectiveAPStatus(i); return s === 'Due' || s === 'Overdue'; })
                             .reduce((s, i) => s + balanceInEgp(i), 0);
  const totalOver  = invoices.filter(i => effectiveAPStatus(i) === 'Overdue')
                             .reduce((s, i) => s + balanceInEgp(i), 0);
  const totalPaidAmt = invoices.reduce((s, i) => s + paidInEgp(i), 0);
  const pending    = invoices.filter(i => i.approvalStatus === 'Pending').length;

  // Next 7 days due
  const next7 = (() => {
    const now = new Date(); const end = new Date(); end.setDate(end.getDate() + 7);
    return invoices
      .filter(i => { const d = new Date(i.dueDate); return d >= now && d <= end && effectiveAPStatus(i) !== 'Paid'; })
      .reduce((s, i) => s + balanceInEgp(i), 0);
  })();

  const overdue = invoices
    .filter(i => effectiveAPStatus(i) === 'Overdue')
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  const sortedAll = useMemo(() => {
    if (!sortCol) return invoices;
    return [...invoices].sort((a, b) => {
      let v = 0;
      if (sortCol === 'invoiceNo')  v = cmp(a.invoiceNo, b.invoiceNo);
      else if (sortCol === 'supplier')   v = cmp(a.supplier, b.supplier);
      else if (sortCol === 'costCenter') v = cmp(a.costCenter, b.costCenter);
      else if (sortCol === 'dueDate')    v = cmp(a.dueDate, b.dueDate);
      else if (sortCol === 'balance')    v = cmp(balanceInEgp(a), balanceInEgp(b));
      return applyDir(v, sortDir);
    });
  }, [invoices, sortCol, sortDir]);

  return (
    <div className="space-y-6" dir="rtl">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <KPICard icon="account_balance_wallet" iconColor="text-blue-400"
          label="إجمالي الالتزامات المعتمدة" value={fmt(totalOblig)}
          sub={`متبقي: ${fmt(totalOblig - totalPaidAmt)} EGP`} subColor="text-red-400"
          border="border-blue-800/40"
        />
        <KPICard icon="schedule" iconColor="text-yellow-400"
          label="مستحق السداد" value={fmt(totalDue)}
          border="border-yellow-800/30"
        />
        <KPICard icon="warning" iconColor="text-red-400"
          label="متأخر السداد" value={fmt(totalOver)}
          border="border-red-800/30"
        />
        <KPICard icon="check_circle" iconColor="text-green-400"
          label="إجمالي المدفوع" value={fmt(totalPaidAmt)}
          border="border-green-800/30"
        />
        <div className="bg-[#232b3e] rounded-xl p-4 border border-cyan-800/30">
          <div className="flex items-center gap-2 mb-2">
            <span className="material-icons text-lg text-cyan-400">event_upcoming</span>
            <span className="text-gray-400 text-xs">مستحق خلال 7 أيام</span>
          </div>
          <p className="text-xl font-bold text-white">{fmt(next7)}</p>
          <p className="text-gray-500 text-xs">EGP</p>
          {pending > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-700/60 text-xs font-semibold text-yellow-400">
              {pending} فاتورة بانتظار الاعتماد
            </div>
          )}
        </div>
      </div>

      {/* Overdue Obligations */}
      {overdue.length > 0 && (
        <div className="bg-[#232b3e] rounded-xl border border-red-800/40 overflow-hidden">
          <div className="px-5 py-4 border-b border-red-800/30 flex items-center gap-3">
            <span className="material-icons text-red-400">warning</span>
            <h3 className="font-semibold text-white">الالتزامات المتأخرة</h3>
            <span className="mr-auto bg-red-900/50 text-red-300 text-xs px-2 py-0.5 rounded-full">{overdue.length} فاتورة</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-gray-300">
              <thead className="text-xs text-gray-500 border-b border-gray-700 bg-[#1b2130]">
                <tr>
                  <SortTh label="رقم الفاتورة" col="invoiceNo" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="المورد"        col="supplier"  sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="تاريخ الاستحقاق" col="dueDate" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="الرصيد المتبقي" col="balance" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <th className="px-4 py-3 text-right">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {overdue.map(inv => {
                  const days = Math.floor((Date.now() - new Date(inv.dueDate).getTime()) / 86400000);
                  return (
                    <tr key={inv.id} className="hover:bg-[#2d3648] transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-white">{inv.invoiceNo}</td>
                      <td className="px-4 py-3 font-medium text-white">{inv.supplier}</td>
                      <td className="px-4 py-3">
                        <div className="text-red-400 text-xs font-semibold">{inv.dueDate}</div>
                        <div className="text-red-400 text-[10px]">متأخر {days} يوم</div>
                      </td>
                      <td className="px-4 py-3 font-bold text-red-400">{fmt(balanceInEgp(inv))} EGP</td>
                      <td className="px-4 py-3">
                        <button onClick={() => onOpen(inv)}
                          className="text-xs text-primary hover:text-blue-300 transition-colors">
                          عرض التفاصيل
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* All Invoices Summary */}
      <div className="bg-[#232b3e] rounded-xl border border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-3 flex-wrap">
          <span className="material-icons text-primary">receipt_long</span>
          <h3 className="font-semibold text-white">جميع فواتير الموردين</h3>
          <div className="mr-auto flex items-center gap-3 text-xs text-gray-400 flex-wrap">
            {(['Not Due','Due','Overdue','Partially Paid','Paid','On Hold'] as APStatus[]).map(s => (
              <span key={s} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${apStatusColor[s]}`}>
                {apStatusAr[s]}
              </span>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-gray-300">
            <thead className="text-xs text-gray-500 border-b border-gray-700 bg-[#1b2130]">
              <tr>
                <SortTh label="رقم الفاتورة"     col="invoiceNo"  sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="المورد"            col="supplier"   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="مركز التكلفة"     col="costCenter" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="تاريخ الاستحقاق"  col="dueDate"    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="الإجمالي"          col="balance"    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 text-right">الاعتماد</th>
                <th className="px-4 py-3 text-right">حالة الدفع</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {sortedAll.map(inv => {
                const aps = effectiveAPStatus(inv);
                return (
                  <tr key={inv.id}
                      className="hover:bg-[#2d3648] transition-colors cursor-pointer"
                      onClick={() => onOpen(inv)}>
                    <td className="px-4 py-3 font-mono text-xs text-white">{inv.invoiceNo}</td>
                    <td className="px-4 py-3 font-medium text-white">{inv.supplier}</td>
                    <td className="px-4 py-3 text-gray-200 text-xs">{inv.costCenter || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-200">{inv.dueDate || '—'}</td>
                    <td className="px-4 py-3 font-semibold text-white">{fmt(balanceInEgp(inv))} <span className="text-gray-400 font-normal">EGP</span></td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium ${approvalColor[inv.approvalStatus]}`}>
                        {inv.approvalStatus === 'Pending' && <span className="material-icons text-[13px]">pending_actions</span>}
                        {approvalAr[inv.approvalStatus]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full font-medium ${apStatusColor[aps]}`}>
                        {apStatusAr[aps]}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {sortedAll.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-500">لا توجد فواتير</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ─── Screen: Invoice List ─────────────────────────────────────────────────────

const InvoiceListScreen: React.FC<{
  invoices: PayableInvoice[];
  onOpen: (inv: PayableInvoice) => void;
  onCreate: () => void;
  onDelete: (ids: string[]) => void;
  onEdit: (inv: PayableInvoice) => void;
  onRequestApproval: (ids: string[]) => void;
  canDelete: boolean;
}> = ({ invoices, onOpen, onCreate, onDelete, onEdit, onRequestApproval, canDelete }) => {
  const [search, setSearch]               = useState('');
  const [filterStatus, setFilterStatus]   = useState<APStatus | 'all'>('all');
  const [filterApproval, setFilterApproval] = useState<ApprovalStatus | 'all'>('all');
  const [filterType, setFilterType]       = useState<InvoiceType | 'all'>('all');
  const [selected, setSelected]           = useState<Set<string>>(new Set());
  const [sortCol, setSortCol]             = useState<string | null>('dueDate');
  const [sortDir, setSortDir]             = useState<SortDir>('asc');

  const handleSort = (col: string) => {
    setSortDir(p => sortCol === col && p === 'asc' ? 'desc' : 'asc');
    setSortCol(col);
  };

  const filtered = useMemo(() => {
    let list = invoices;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(i =>
        i.invoiceNo.toLowerCase().includes(q) ||
        i.supplier.toLowerCase().includes(q) ||
        (i.costCenter || '').toLowerCase().includes(q)
      );
    }
    if (filterStatus !== 'all') list = list.filter(i => effectiveAPStatus(i) === filterStatus);
    if (filterApproval !== 'all') list = list.filter(i => i.approvalStatus === filterApproval);
    if (filterType !== 'all') list = list.filter(i => i.invoiceType === filterType);
    return list;
  }, [invoices, search, filterStatus, filterApproval, filterType]);

  const sorted = useMemo(() => {
    if (!sortCol) return filtered;
    return [...filtered].sort((a, b) => {
      let v = 0;
      if (sortCol === 'invoiceNo')  v = cmp(a.invoiceNo, b.invoiceNo);
      else if (sortCol === 'supplier')  v = cmp(a.supplier, b.supplier);
      else if (sortCol === 'invoiceDate') v = cmp(a.invoiceDate, b.invoiceDate);
      else if (sortCol === 'dueDate')    v = cmp(a.dueDate, b.dueDate);
      else if (sortCol === 'total')      v = cmp(totalInEgp(a), totalInEgp(b));
      else if (sortCol === 'balance')    v = cmp(balanceInEgp(a), balanceInEgp(b));
      return applyDir(v, sortDir);
    });
  }, [filtered, sortCol, sortDir]);

  const unpaidSorted = sorted.filter(i => effectiveAPStatus(i) !== 'Paid');
  const allChecked = unpaidSorted.length > 0 && unpaidSorted.every(i => selected.has(i.id));
  const toggleAll  = () => setSelected(allChecked ? new Set() : new Set(unpaidSorted.map(i => i.id)));
  const toggle     = (id: string) => setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectedUnpaidNonPending = sorted.filter(i =>
    selected.has(i.id) && effectiveAPStatus(i) !== 'Paid' && i.approvalStatus !== 'Pending' && i.approvalStatus !== 'Approved'
  );

  return (
    <div className="space-y-4" dir="rtl">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <span className="material-icons absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-lg">search</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="بحث برقم الفاتورة أو اسم المورد..."
            className="w-full bg-[#1b2130] border border-gray-700 rounded-lg py-2 pr-10 pl-4 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-primary" />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}
          className="bg-[#1b2130] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-primary">
          <option value="all">كل الحالات</option>
          {(['Not Due','Due','Overdue','Partially Paid','Paid','On Hold'] as APStatus[]).map(s =>
            <option key={s} value={s}>{apStatusAr[s]}</option>
          )}
        </select>
        <select value={filterApproval} onChange={e => setFilterApproval(e.target.value as any)}
          className="bg-[#1b2130] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-primary">
          <option value="all">كل مستويات الاعتماد</option>
          {(['Draft','Pending','Approved','Rejected'] as ApprovalStatus[]).map(s =>
            <option key={s} value={s}>{approvalAr[s]}</option>
          )}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value as any)}
          className="bg-[#1b2130] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-primary">
          <option value="all">كل الأنواع</option>
          {(['توريدات','خدمات','أصول','مصروفات تشغيل'] as InvoiceType[]).map(t =>
            <option key={t} value={t}>{t}</option>
          )}
        </select>
        {selected.size > 0 && selectedUnpaidNonPending.length > 0 && (
          <button onClick={() => { onRequestApproval(selectedUnpaidNonPending.map(i => i.id)); setSelected(new Set()); }}
            className="flex items-center gap-1 px-3 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors">
            <span className="material-icons text-base">approval</span>
            طلب اعتماد ({selectedUnpaidNonPending.length})
          </button>
        )}
        {canDelete && selected.size > 0 && (
          <button onClick={() => { onDelete([...selected]); setSelected(new Set()); }}
            className="flex items-center gap-1 px-3 py-2 text-sm bg-red-900/40 text-red-400 rounded-lg hover:bg-red-900/60 transition-colors">
            <span className="material-icons text-base">delete</span>
            حذف ({selected.size})
          </button>
        )}
        <button onClick={onCreate}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm rounded-lg hover:bg-primary-dark transition-colors mr-auto">
          <span className="material-icons text-base">add</span>
          فاتورة جديدة
        </button>
      </div>

      {/* Table */}
      <div className="bg-[#232b3e] rounded-xl border border-gray-700 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-700 flex items-center gap-2 text-sm text-gray-400">
          <span className="material-icons text-primary text-base">receipt_long</span>
          <span>{filtered.length} فاتورة</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-gray-300">
            <thead className="text-xs text-gray-500 border-b border-gray-700 bg-[#1b2130]">
              <tr>
                <th className="px-4 py-3">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll}
                    className="w-4 h-4 accent-primary" />
                </th>
                <SortTh label="رقم الفاتورة"     col="invoiceNo"   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="المورد"            col="supplier"    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="النوع"             col="type"        sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="تاريخ الفاتورة"   col="invoiceDate" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="تاريخ الاستحقاق"  col="dueDate"     sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="الإجمالي"          col="total"       sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="الرصيد المتبقي"   col="balance"     sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 text-right">الاعتماد</th>
                <th className="px-4 py-3 text-right">حالة الدفع</th>
                {canDelete && <th className="px-4 py-3 text-right">إجراءات</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {sorted.map(inv => {
                const aps = effectiveAPStatus(inv);
                return (
                  <tr key={inv.id}
                      className={`transition-colors cursor-pointer ${inv.approvalStatus === 'Pending' ? 'bg-red-900/20 hover:bg-red-900/30' : 'hover:bg-[#2d3648]'}`}
                      onClick={() => onOpen(inv)}>
                    <td className="px-4 py-3" onClick={e => { e.stopPropagation(); if (aps !== 'Paid') toggle(inv.id); }}>
                      <input type="checkbox" checked={selected.has(inv.id)} onChange={() => {}}
                        disabled={aps === 'Paid'}
                        className="w-4 h-4 accent-primary disabled:opacity-30" />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-white">{inv.invoiceNo}</td>
                    <td className="px-4 py-3 font-medium text-white">{inv.supplier}</td>
                    <td className="px-4 py-3 text-xs text-gray-200">{inv.invoiceType}</td>
                    <td className="px-4 py-3 text-xs text-gray-200">{inv.invoiceDate}</td>
                    <td className="px-4 py-3 text-xs text-gray-200">{inv.dueDate}</td>
                    <td className="px-4 py-3 font-semibold text-white">{fmt(totalInEgp(inv))} <span className="text-gray-400 font-normal text-xs">EGP</span></td>
                    <td className="px-4 py-3 font-semibold text-white">{fmt(balanceInEgp(inv))} <span className="text-gray-400 font-normal text-xs">EGP</span></td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium ${approvalColor[inv.approvalStatus]}`}>
                        {inv.approvalStatus === 'Pending' && <span className="material-icons text-[13px]">pending_actions</span>}
                        {approvalAr[inv.approvalStatus]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full font-medium ${apStatusColor[aps]}`}>
                        {apStatusAr[aps]}
                      </span>
                    </td>
                    {canDelete && (
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <button onClick={() => onEdit(inv)} title="تعديل"
                          className="text-gray-400 hover:text-primary transition-colors">
                          <span className="material-icons text-base">edit</span>
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr><td colSpan={canDelete ? 11 : 10} className="px-4 py-10 text-center text-gray-500">لا توجد نتائج مطابقة</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ─── Screen: Create / Edit Invoice ────────────────────────────────────────────

const blankInvoice = (): PayableInvoice => ({
  id: uid(),
  invoiceNo: '',
  supplier: '',
  costCenter: '',
  invoiceDate: new Date().toISOString().slice(0, 10),
  dueDate: '',
  amount: 0,
  tax: 0,
  total: 0,
  invoiceType: 'خدمات',
  withholdingTax: 0,
  approvalStatus: 'Draft',
  paymentStatus: 'Unpaid',
  apStatus: 'Not Due',
  currency: 'EGP',
  payments: [],
  notes: '',
});

const CreateInvoiceScreen: React.FC<{
  initial: PayableInvoice | null;
  projects: Project[];
  invoices: PayableInvoice[];
  user: User;
  onSave: (inv: PayableInvoice) => void;
  onCancel: () => void;
  onRefresh?: () => Promise<void>;
}> = ({ initial, onSave, onCancel, projects, invoices, user, onRefresh }) => {
  const [form, setForm]   = useState<PayableInvoice>(initial ?? blankInvoice());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pdfParsing, setPdfParsing] = useState(false);
  const [pdfStatus, setPdfStatus] = useState<{ ok: boolean; message: string; fields: string[] } | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(
    initial?.pdfData ? b64ToBlobUrl(initial.pdfData) : null
  );

  // ETA import state
  interface EtaRow { uuid: string; internalId: string; issuerName: string; issuerId: string; dateTimeIssued: string; netAmount: number; total: number; status: string }
  const [selectedEtaUuids, setSelectedEtaUuids] = useState<Set<string>>(new Set());
  const [etaOpen,       setEtaOpen]       = useState(false);
  const [etaLoading,    setEtaLoading]    = useState(false);
  const [etaError,      setEtaError]      = useState('');
  const [etaRows,       setEtaRows]       = useState<EtaRow[]>([]);
  const [etaNextToken,  setEtaNextToken]  = useState('');
  const [etaTokenStack, setEtaTokenStack] = useState<string[]>([]); // for back navigation
  const [etaTotalCount, setEtaTotalCount] = useState(0);
  const [etaDateFrom,   setEtaDateFrom]   = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); });
  const [etaDateTo,     setEtaDateTo]     = useState(() => new Date().toISOString().slice(0, 10));
  const [etaClientId,   setEtaClientId]   = useState('');
  const [etaClientSec,  setEtaClientSec]  = useState('');
  const [etaClientSec2, setEtaClientSec2] = useState('');
  const [showEtaCreds,  setShowEtaCreds]  = useState(false);
  const [etaImporting,  setEtaImporting]  = useState('');
  const [directUuid,    setDirectUuid]    = useState('');
  const [etaPdfLoading, setEtaPdfLoading] = useState('');
  const [etaPdfPreview, setEtaPdfPreview] = useState<{ uuid: string; name: string; url: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from('operator_settings')
          .select('key, value')
          .eq('operator_id', user.username)
          .in('key', ['eta_client_id', 'eta_client_sec', 'eta_client_sec2']);
        if (data && data.length > 0) {
          const map: Record<string, string> = {};
          data.forEach((r: any) => { map[r.key] = r.value; });
          setEtaClientId(map.eta_client_id ?? '');
          setEtaClientSec(map.eta_client_sec ?? '');
          setEtaClientSec2(map.eta_client_sec2 ?? '');
          return;
        }
      } catch { /* ignore */ }
      setEtaClientId(localStorage.getItem('eta_client_id')   ?? '');
      setEtaClientSec(localStorage.getItem('eta_client_sec')  ?? '');
      setEtaClientSec2(localStorage.getItem('eta_client_sec2') ?? '');
    })();
  }, [user.username]);

  const saveEtaCreds = async () => {
    localStorage.setItem('eta_client_id',   etaClientId);
    localStorage.setItem('eta_client_sec',  etaClientSec);
    localStorage.setItem('eta_client_sec2', etaClientSec2);
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

  // Try Secret 1; on auth failure retry with Secret 2
  const etaFetch = async (body: object): Promise<any> => {
    const call = (secret: string) => fetch('/api/eta-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, clientId: etaClientId, clientSecret: secret }),
    }).then(r => r.json());
    const data = await call(etaClientSec);
    if (!data.ok && etaClientSec2 && (data.error ?? '').toLowerCase().includes('auth')) {
      return call(etaClientSec2);
    }
    return data;
  };

  const fetchEtaList = async (continuationToken = '', resetStack = true) => {
    if (!etaClientId || !etaClientSec) { setShowEtaCreds(true); return; }
    setEtaLoading(true);
    setEtaError('');
    try {
      const body: any = { action: 'list' };
      if (etaDateFrom) body.issueDateFrom = etaDateFrom + 'T00:00:00';
      if (etaDateTo)   body.issueDateTo   = etaDateTo   + 'T23:59:59';
      if (continuationToken) body.continuationToken = continuationToken;
      const data = await etaFetch(body);
      if (!data.ok) throw new Error(data.error ?? 'خطأ في الاتصال بالبوابة');
      setEtaRows(data.invoices ?? []);
      setEtaNextToken(data.continuationToken ?? '');
      setEtaTotalCount(data.totalCount ?? 0);
      if (resetStack) setEtaTokenStack([]);
    } catch (e: any) {
      setEtaError(e.message);
    } finally {
      setEtaLoading(false);
    }
  };

  const etaNextPage = () => {
    if (!etaNextToken) return;
    setEtaTokenStack(s => [...s, etaNextToken]);
    fetchEtaList(etaNextToken, false);
  };
  const etaPrevPage = () => {
    const stack = [...etaTokenStack];
    stack.pop();
    const prev = stack[stack.length - 1] ?? '';
    setEtaTokenStack(stack);
    fetchEtaList(prev, false);
  };

  const importEtaInvoice = async (row: EtaRow) => {
    // Check if invoice already imported (only if internalId is present)
    if (row.internalId) {
      const alreadyImported = invoices.some(inv => inv.invoiceNo === row.internalId);
      if (alreadyImported) {
        const proceed = window.confirm(`تنبيه: الفاتورة رقم (${row.internalId}) مستوردة بالفعل سابقاً!\nهل أنت متأكد من رغبتك في استيرادها مرة أخرى؟`);
        if (!proceed) return;
      }
    }

    setEtaImporting(row.uuid);
    try {
      // Fetch full document + PDF in parallel
      const [data, pdfData] = await Promise.allSettled([
        etaFetch({ action: 'get', uuid: row.uuid }),
        etaFetch({ action: 'pdf', uuid: row.uuid }),
      ]);

      const inv = data.status === 'fulfilled' && data.value.ok ? data.value.invoice : null;
      const pdfBase64: string | null =
        pdfData.status === 'fulfilled' && pdfData.value.ok ? pdfData.value.pdf : null;

      // Duplicate checking for direct import (where internalId was not originally present)
      if (inv && !row.internalId) {
        const alreadyImported = invoices.some(i => i.invoiceNo === inv.invoiceNo);
        if (alreadyImported) {
          const proceed = window.confirm(`تنبيه: الفاتورة رقم (${inv.invoiceNo}) مستوردة بالفعل سابقاً!\nهل أنت متأكد من رغبتك في استيرادها مرة أخرى؟`);
          if (!proceed) {
            setEtaImporting('');
            return;
          }
        }
      }

      const addDays30 = (iso: string) => { const d = new Date(iso); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); };
      const pdfName = `${inv?.invoiceNo || row.internalId || row.uuid}.pdf`;

      setForm(prev => ({
        ...prev,
        invoiceNo:   inv?.invoiceNo   || row.internalId      || prev.invoiceNo,
        supplier:    inv?.supplier    || row.issuerName       || prev.supplier,
        invoiceDate: inv?.invoiceDate || row.dateTimeIssued   || prev.invoiceDate,
        dueDate:     inv?.invoiceDate ? addDays30(inv.invoiceDate) : row.dateTimeIssued ? addDays30(row.dateTimeIssued) : prev.dueDate,
        amount:      inv?.amount > 0  ? inv.amount  : row.netAmount > 0 ? row.netAmount : prev.amount,
        tax:         inv?.tax    > 0  ? inv.tax     : prev.tax,
        hasTax:      inv?.tax    > 0  ? true         : prev.hasTax,
        total:       inv?.total  > 0  ? inv.total   : row.total > 0 ? row.total : prev.total,
        ...(pdfBase64 ? { pdfData: pdfBase64, pdfName } : {}),
      }));

      if (pdfBase64) {
        setPdfPreviewUrl(b64ToBlobUrl(pdfBase64));
        setPdfStatus({ ok: true, message: 'تم استيراد الفاتورة مع نسخة PDF من بوابة ETA', fields: [] });
      }

      setEtaOpen(false);
    } catch {
      // fall back to search-row data only
      const addDays30 = (iso: string) => { const d = new Date(iso); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); };
      setForm(prev => ({
        ...prev,
        invoiceNo:   row.internalId     || prev.invoiceNo,
        supplier:    row.issuerName     || prev.supplier,
        invoiceDate: row.dateTimeIssued || prev.invoiceDate,
        dueDate:     row.dateTimeIssued ? addDays30(row.dateTimeIssued) : prev.dueDate,
        amount:      row.netAmount > 0  ? row.netAmount : prev.amount,
        total:       row.total     > 0  ? row.total     : prev.total,
      }));
      setEtaOpen(false);
    } finally {
      setEtaImporting('');
    }
  };

  const handleDirectEtaImport = async () => {
    if (!directUuid.trim()) return;
    const match = directUuid.match(/([A-Z0-9]{26})/i);
    if (!match) {
      alert('الرجاء إدخال معرف صحيح يتكون من 26 حرفاً ورقماً، أو رابط الفاتورة الكامل من البوابة.');
      return;
    }
    const uuid = match[1].toUpperCase();
    const dummyRow: EtaRow = {
      uuid,
      internalId: '',
      issuerName: '',
      issuerId: '',
      dateTimeIssued: '',
      netAmount: 0,
      total: 0,
      status: 'Valid'
    };
    await importEtaInvoice(dummyRow);
    setDirectUuid('');
  };

  const bulkImportEtaInvoices = async () => {
    const selectedRows = etaRows.filter(r => selectedEtaUuids.has(r.uuid));
    if (selectedRows.length === 0) return;

    // Check duplicates
    const duplicates = selectedRows.filter(row => invoices.some(inv => inv.invoiceNo === row.internalId));
    let rowsToImport = selectedRows;
    
    if (duplicates.length > 0) {
      const dupNos = duplicates.map(d => d.internalId).join(', ');
      const proceed = window.confirm(`تنبيه: الفواتير التالية مستوردة بالفعل سابقاً:\n(${dupNos})\n\nهل تريد تخطي الفواتير المكررة واستيراد الفواتير الجديدة فقط؟\n\nاضغط "موافق" لتخطي المكرر واستيراد الجديد.\nاضغط "إلغاء" لإلغاء العملية بالكامل.`);
      if (!proceed) return;
      // Filter out duplicates
      rowsToImport = selectedRows.filter(row => !invoices.some(inv => inv.invoiceNo === row.internalId));
      if (rowsToImport.length === 0) {
        alert('جميع الفواتير المحددة مكررة ومستوردة بالفعل سابقاً!');
        return;
      }
    }

    setEtaLoading(true);
    setEtaError('');
    
    let successCount = 0;
    try {
      for (let i = 0; i < rowsToImport.length; i++) {
        const row = rowsToImport[i];
        setEtaImporting(`bulk-${i + 1}-of-${rowsToImport.length}`);
        
        let pdfBase64: string | null = null;
        let invDetails: any = null;
        
        try {
          // Fetch full document + PDF in parallel
          const [dataRes, pdfRes] = await Promise.allSettled([
            etaFetch({ action: 'get', uuid: row.uuid }),
            etaFetch({ action: 'pdf', uuid: row.uuid }),
          ]);
          
          if (dataRes.status === 'fulfilled' && dataRes.value.ok) {
            invDetails = dataRes.value.invoice;
          }
          if (pdfRes.status === 'fulfilled' && pdfRes.value.ok) {
            pdfBase64 = pdfRes.value.pdf;
          }
        } catch (err) {
          console.error("Failed to fetch full ETA details/PDF:", err);
        }

        const addDays30 = (iso: string) => { 
          const d = new Date(iso); 
          d.setDate(d.getDate() + 30); 
          return d.toISOString().slice(0, 10); 
        };

        const newPayable: PayableInvoice = {
          id: uid(),
          invoiceNo: invDetails?.invoiceNo || row.internalId || `ETA-${row.uuid.slice(0, 8)}`,
          supplier: invDetails?.supplier || row.issuerName || 'مورد غير معروف',
          costCenter: 'الإدارة العامة',
          invoiceDate: invDetails?.invoiceDate || row.dateTimeIssued || new Date().toISOString().slice(0, 10),
          dueDate: invDetails?.invoiceDate ? addDays30(invDetails.invoiceDate) : row.dateTimeIssued ? addDays30(row.dateTimeIssued) : new Date().toISOString().slice(0, 10),
          amount: invDetails?.amount > 0 ? invDetails.amount : row.netAmount > 0 ? row.netAmount : 0,
          tax: invDetails?.tax > 0 ? invDetails.tax : 0,
          hasTax: invDetails?.tax > 0 ? true : false,
          total: invDetails?.total > 0 ? invDetails.total : row.total > 0 ? row.total : 0,
          invoiceType: 'خدمات',
          approvalStatus: 'Pending',
          paymentStatus: 'Unpaid',
          apStatus: 'Not Due',
          currency: 'EGP',
          payments: [],
          notes: 'تم استيرادها تلقائياً بالكامل من بوابة الضرائب المصرية (ETA)',
          ...(pdfBase64 ? { pdfData: pdfBase64, pdfName: `${row.internalId || row.uuid}.pdf` } : {}),
        };

        await upsertPayable(newPayable);
        successCount++;
      }

      alert(`تم استيراد ${successCount} فاتورة بنجاح وحفظها كطلبات اعتماد!`);
      if (onRefresh) {
        await onRefresh();
      }
    } catch (err: any) {
      setEtaError(`حدث خطأ أثناء الاستيراد الجماعي: ${err.message}`);
    } finally {
      setEtaImporting('');
      setEtaLoading(false);
      setSelectedEtaUuids(new Set());
      setEtaOpen(false);
    }
  };

  const previewEtaPdf = async (row: EtaRow) => {
    if (etaPdfLoading) return;
    setEtaPdfLoading(row.uuid);
    try {
      const data = await etaFetch({ action: 'pdf', uuid: row.uuid });
      if (!data.ok || !data.pdf) throw new Error('no pdf');
      setEtaPdfPreview({
        uuid: row.uuid,
        name: `${row.internalId || row.uuid}.pdf`,
        url:  b64ToBlobUrl(data.pdf),
      });
    } catch {
      alert('تعذّر تحميل ملف PDF من بوابة ETA');
    } finally {
      setEtaPdfLoading('');
    }
  };

  const set = <K extends keyof PayableInvoice>(k: K, v: PayableInvoice[K]) =>
    setForm(p => ({ ...p, [k]: v }));

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfParsing(true);
    setPdfStatus(null);
    try {
      // Store file as base64 for persistence and preview
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]); // strip data URL prefix
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setForm(prev => ({ ...prev, pdfData: base64, pdfName: file.name }));
      setPdfPreviewUrl(b64ToBlobUrl(base64));

      const result: ParsedPayableInvoice = await parsePayableInvoicePdf(file);
      const filled: string[] = [];
      setForm(prev => {
        const next = { ...prev };
        if (result.matched.invoiceNo && result.invoiceNo)   { next.invoiceNo   = result.invoiceNo;   filled.push('رقم الفاتورة'); }
        if (result.matched.supplier  && result.supplier)    { next.supplier    = result.supplier;    filled.push('المورد'); }
        if (result.matched.invoiceDate && result.invoiceDate){ next.invoiceDate = result.invoiceDate; filled.push('تاريخ الفاتورة'); }
        if (result.matched.dueDate   && result.dueDate)     { next.dueDate     = result.dueDate;     filled.push('تاريخ الاستحقاق'); }
        if (result.matched.amount    && result.amount > 0)  { next.amount      = result.amount;      filled.push('المبلغ'); }
        if (result.matched.tax && result.tax > 0) { next.hasTax = true; filled.push('الضريبة'); }
        if (result.matched.withholdingTax && result.withholdingTax > 0) { next.withholdingTax = result.withholdingTax; filled.push('خصم تحت الحساب'); }
        return next;
      });
      const matchedCount = Object.values(result.matched).filter(Boolean).length;
      setPdfStatus({
        ok: matchedCount > 0,
        message: matchedCount > 0 ? `تم استخراج ${matchedCount} حقل تلقائياً` : 'لم يتم التعرف على بيانات الفاتورة',
        fields: filled,
      });
    } catch (err) {
      setPdfStatus({ ok: false, message: 'فشل قراءة الملف — تأكد أن الملف PDF صالح', fields: [] });
    } finally {
      setPdfParsing(false);
      e.target.value = '';
    }
  };

  const [taxManual, setTaxManual] = useState(false);

  // Auto-calculate tax + total
  useEffect(() => {
    const autoTax = form.hasTax ? form.amount * 0.14 : 0;
    const tax = taxManual ? form.tax : parseFloat(autoTax.toFixed(2));
    const wht = form.withholdingTax ?? 0;
    const total = form.amount + tax - wht;
    setForm(p => ({ ...p, ...(taxManual ? {} : { tax }), total: parseFloat(total.toFixed(2)) }));
  }, [form.amount, form.withholdingTax, form.hasTax, taxManual, form.tax]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.invoiceNo.trim())  e.invoiceNo = 'مطلوب';
    if (!form.supplier.trim())   e.supplier  = 'مطلوب';
    if (!form.invoiceDate)       e.invoiceDate = 'مطلوب';
    if (!form.dueDate)           e.dueDate   = 'مطلوب';
    if (form.amount <= 0)        e.amount    = 'يجب أن يكون المبلغ أكبر من صفر';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const Field: React.FC<{ label: string; error?: string; children: React.ReactNode; className?: string }> =
    ({ label, error, children, className = '' }) => (
      <div className={className}>
        <label className="block text-xs text-gray-400 mb-1">{label}</label>
        {children}
        {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
      </div>
    );

  const inputCls = (err?: string) =>
    `w-full bg-[#1b2130] border ${err ? 'border-red-500' : 'border-gray-700'} rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-primary`;

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center gap-3">
        <button onClick={onCancel} className="text-gray-500 hover:text-gray-900 transition-colors">
          <span className="material-icons">arrow_forward</span>
        </button>
        <h2 className="text-lg font-bold text-gray-800">
          {initial ? 'تعديل فاتورة مورد' : 'إضافة فاتورة مورد جديدة'}
        </h2>
      </div>

      {/* ETA Portal Import */}
      <div className="bg-[#232b3e] rounded-xl border border-dashed border-blue-700/50 p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="material-icons text-blue-400 text-xl">cloud_download</span>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-300">استيراد من بوابة الفاتورة الإلكترونية (ETA)</p>
            <p className="text-xs text-gray-500 mt-0.5">استعراض الفواتير المستلمة على بوابة هيئة الضرائب واستيرادها مباشرةً</p>
          </div>
          <button
            type="button"
            onClick={() => { setEtaOpen(o => !o); if (!etaOpen) fetchEtaList(); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-blue-700 hover:bg-blue-600 text-white transition-colors"
          >
            <span className="material-icons text-base">{etaOpen ? 'expand_less' : 'receipt_long'}</span>
            {etaOpen ? 'إغلاق' : 'عرض الفواتير المستلمة'}
          </button>
        </div>

        {etaOpen && (
          <div className="mt-4 space-y-3">
            {/* Credentials */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <span className="material-icons text-sm text-green-400">{etaClientId ? 'lock' : 'lock_open'}</span>
                {etaClientId ? 'بيانات الاعتماد محفوظة' : 'لم يتم إدخال بيانات الاعتماد بعد'}
              </span>
              <button type="button" onClick={() => setShowEtaCreds(v => !v)}
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                <span className="material-icons text-sm">settings</span>
                {showEtaCreds ? 'إخفاء' : 'إعداد بيانات الاعتماد'}
              </button>
            </div>
            {showEtaCreds && (
              <div className="bg-[#1b2130] rounded-lg p-3 border border-blue-700/40 space-y-3">
                <div className="flex items-start gap-2 bg-yellow-900/30 border border-yellow-700/40 rounded-lg px-3 py-2">
                  <span className="material-icons text-yellow-400 text-sm mt-0.5">info</span>
                  <div className="text-xs text-yellow-200 space-y-1">
                    <p className="font-semibold">هذه ليست بيانات تسجيل الدخول للبوابة</p>
                    <p className="text-yellow-300/80">
                      تحتاج إلى <strong>Client ID</strong> و<strong>Client Secret</strong> الخاصة بنظام ERP — يتم إصدارها من هيئة الضرائب عند تسجيل نظامك.
                      <br />
                      للحصول عليها: تواصل مع الدعم الفني لـ ETA أو مزود خدمة ERP المعتمد.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <input value={etaClientId} onChange={e => setEtaClientId(e.target.value)}
                    placeholder="Client ID"
                    className="w-full bg-[#232b3e] border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono" />
                  <input value={etaClientSec} onChange={e => setEtaClientSec(e.target.value)}
                    placeholder="Client Secret 1 (الرئيسي)" type="password"
                    className="w-full bg-[#232b3e] border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono" />
                  <p className="text-xs text-gray-600">Client Secret 2 — احتياطي إذا انتهت صلاحية الأول</p>
                  <input value={etaClientSec2} onChange={e => setEtaClientSec2(e.target.value)}
                    placeholder="Client Secret 2 (احتياطي)" type="password"
                    className="w-full bg-[#232b3e] border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono" />
                </div>
                <button type="button" onClick={saveEtaCreds}
                  className="px-4 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-sm transition-colors w-full">
                  حفظ بيانات الاعتماد
                </button>
                <p className="text-xs text-gray-500">تُحفظ محلياً في المتصفح فقط ولا تُخزَّن على أي خادم</p>
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
                      className={`px-2 py-1 rounded text-xs transition-colors border ${active ? 'bg-blue-700 border-blue-500 text-white' : 'bg-[#1b2130] border-gray-700 text-gray-400 hover:border-blue-500 hover:text-white'}`}>
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2 flex-wrap items-end justify-between w-full">
                <div className="flex gap-2 flex-wrap items-end">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">من تاريخ</label>
                    <input type="date" value={etaDateFrom} onChange={e => setEtaDateFrom(e.target.value)}
                      className="bg-[#1b2130] border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">إلى تاريخ</label>
                    <input type="date" value={etaDateTo} onChange={e => setEtaDateTo(e.target.value)}
                      className="bg-[#1b2130] border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-blue-500" />
                  </div>
                  <button type="button" onClick={() => fetchEtaList()}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-[#1b2130] border border-gray-600 text-gray-300 hover:text-white hover:border-blue-500 transition-colors">
                    <span className="material-icons text-base">search</span> بحث
                  </button>
                </div>

                {selectedEtaUuids.size > 0 && (
                  <button
                    type="button"
                    onClick={bulkImportEtaInvoices}
                    disabled={etaImporting !== ''}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm bg-green-700 hover:bg-green-600 text-white transition-colors mr-auto font-medium"
                  >
                    <span className="material-icons text-base">cloud_download</span>
                    {etaImporting.startsWith('bulk-') ? `جاري استيراد (${etaImporting.replace('bulk-', '').replace('-of-', ' من ')})` : `استيراد الفواتير المحددة (${selectedEtaUuids.size})`}
                  </button>
                )}
              </div>
              {(() => { const days = Math.round((new Date(etaDateTo).getTime() - new Date(etaDateFrom).getTime()) / 86_400_000); return days > 30 ? (
                <p className="text-xs text-yellow-400/80 flex items-center gap-1">
                  <span className="material-icons text-sm">info</span>
                  نطاق {days} يوم — سيتم تقسيمه تلقائياً لعدة طلبات (قد يستغرق بضع ثوانٍ)
                </p>
              ) : null; })()}
            </div>

            {/* Direct Import */}
            <div className="bg-[#1b2130]/50 border border-gray-700/60 rounded-lg p-3 space-y-2">
              <label className="block text-xs font-semibold text-gray-400">
                استيراد مباشر برابط الفاتورة أو المعرف (UUID)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="ضع رابط الفاتورة من بوابة الضرائب أو المعرف الطويل (UUID) هنا..."
                  value={directUuid}
                  onChange={e => setDirectUuid(e.target.value)}
                  className="flex-1 bg-[#1b2130] border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono"
                />
                <button
                  type="button"
                  onClick={handleDirectEtaImport}
                  disabled={!directUuid.trim() || etaImporting !== ''}
                  className="flex items-center gap-1 px-4 py-1.5 rounded-lg text-xs bg-blue-700 hover:bg-blue-600 text-white transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  <span className="material-icons text-sm">download</span>
                  استيراد مباشر
                </button>
              </div>
            </div>

            {/* Status */}
            {etaLoading && (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-4 justify-center">
                <span className="material-icons animate-spin text-blue-400">refresh</span>
                جارٍ جلب الفواتير من بوابة ETA...
              </div>
            )}
            {etaError && (
              <div className="bg-red-900/30 border border-red-700/40 rounded-lg px-3 py-2 text-xs text-red-300 flex items-start gap-2">
                <span className="material-icons text-sm mt-0.5">error_outline</span>
                <span>{etaError}</span>
              </div>
            )}

            {/* Table */}
            {!etaLoading && etaRows.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-gray-700">
                <table className="w-full text-xs text-right">
                  <thead className="bg-[#1b2130] text-gray-400">
                    <tr>
                      <th className="px-3 py-2 text-center w-10">
                        <input
                          type="checkbox"
                          checked={etaRows.length > 0 && etaRows.every(r => selectedEtaUuids.has(r.uuid))}
                          onChange={e => {
                            setSelectedEtaUuids(e.target.checked ? new Set(etaRows.map(r => r.uuid)) : new Set());
                          }}
                          className="w-4 h-4 accent-primary cursor-pointer"
                        />
                      </th>
                      <th className="px-3 py-2">رقم الفاتورة</th>
                      <th className="px-3 py-2">المورد</th>
                      <th className="px-3 py-2">التاريخ</th>
                      <th className="px-3 py-2 text-left">الإجمالي</th>
                      <th className="px-3 py-2 text-center">PDF</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/50">
                    {etaRows.map(row => (
                      <tr key={row.uuid} className="hover:bg-[#2d3648] transition-colors">
                        <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedEtaUuids.has(row.uuid)}
                            onChange={() => {
                              setSelectedEtaUuids(prev => {
                                const next = new Set(prev);
                                if (next.has(row.uuid)) next.delete(row.uuid);
                                else next.add(row.uuid);
                                return next;
                              });
                            }}
                            className="w-4 h-4 accent-primary cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2 text-gray-200 font-mono">{row.internalId}</td>
                        <td className="px-3 py-2 text-gray-300 max-w-[180px] truncate" title={row.issuerName}>{row.issuerName}</td>
                        <td className="px-3 py-2 text-gray-400">{row.dateTimeIssued}</td>
                        <td className="px-3 py-2 text-left text-green-400 font-medium">{fmt(row.total)} EGP</td>
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
                          <button type="button" onClick={() => importEtaInvoice(row)}
                            disabled={etaImporting === row.uuid}
                            className="flex items-center gap-1 px-2 py-1 rounded bg-blue-700/70 hover:bg-blue-600 text-white transition-colors whitespace-nowrap disabled:opacity-50">
                            <span className={`material-icons text-xs ${etaImporting === row.uuid ? 'animate-spin' : ''}`}>
                              {etaImporting === row.uuid ? 'refresh' : 'download'}
                            </span>
                            {etaImporting === row.uuid ? '...' : 'استيراد'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {!etaLoading && etaRows.length > 0 && (
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{etaTotalCount > 0 ? `${etaTotalCount} فاتورة مستلمة` : `${etaRows.length} نتيجة`}</span>
                <div className="flex gap-1">
                  <button type="button" disabled={etaTokenStack.length === 0} onClick={etaPrevPage}
                    className="px-2 py-1 rounded bg-[#1b2130] border border-gray-700 disabled:opacity-40 hover:border-blue-500 transition-colors">‹ السابق</button>
                  <button type="button" disabled={!etaNextToken} onClick={etaNextPage}
                    className="px-2 py-1 rounded bg-[#1b2130] border border-gray-700 disabled:opacity-40 hover:border-blue-500 transition-colors">التالي ›</button>
                </div>
              </div>
            )}

            {!etaLoading && !etaError && etaRows.length === 0 && (
              <p className="text-center text-gray-500 text-xs py-4">لا توجد فواتير مستلمة بهذه المعايير</p>
            )}
          </div>
        )}
      </div>

      {/* ETA PDF Preview Modal */}
      {etaPdfPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" dir="rtl">
          <div className="bg-[#1b2130] rounded-2xl border border-gray-700 shadow-2xl flex flex-col"
            style={{ width: '90vw', maxWidth: 900, height: '90vh' }}>
            {/* Header */}
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
                onClick={() => setEtaPdfPreview(null)}
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-gray-700 hover:bg-red-900/50 text-gray-400 hover:text-red-400 transition-colors"
              >
                <span className="material-icons text-base">close</span>
              </button>
            </div>
            {/* PDF iframe */}
            <iframe
              src={etaPdfPreview.url}
              title={etaPdfPreview.name}
              className="flex-1 w-full rounded-b-2xl"
              style={{ background: '#fff' }}
            />
          </div>
        </div>
      )}

      <div className="bg-[#232b3e] rounded-xl border border-gray-700 p-6 space-y-6">
        {/* Basic Info */}
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-4 flex items-center gap-2">
            <span className="material-icons text-base text-primary">info</span>
            بيانات الفاتورة
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <Field label="رقم الفاتورة *" error={errors.invoiceNo}>
              <input value={form.invoiceNo} onChange={e => set('invoiceNo', e.target.value)}
                className={inputCls(errors.invoiceNo)} placeholder="PUR-2025-001" />
            </Field>
            <Field label="المورد *" error={errors.supplier}>
              <input list="suppliers-list" value={form.supplier} onChange={e => set('supplier', e.target.value)}
                className={inputCls(errors.supplier)} placeholder="اختر من القائمة أو اكتب اسم مورد جديد" />
              <datalist id="suppliers-list">
                {SUPPLIERS.map(s => <option key={s} value={s} />)}
              </datalist>
              <p className="text-gray-500 text-[11px] mt-1 flex items-center gap-1">
                <span className="material-icons text-[13px]">info</span>
                يمكنك كتابة اسم مورد جديد غير موجود في القائمة
              </p>
            </Field>
            <div>
              <label className="block text-xs text-gray-400 mb-1">مركز التكلفة (المشروع)</label>
              <input list="cc-list" value={form.costCenter || ''} onChange={e => set('costCenter', e.target.value)}
                className={inputCls()} placeholder="اختر مشروعاً أو اكتب..." />
              <datalist id="cc-list">
                <option value="الإدارة العامة" />
                {projects.map(p => <option key={p.id} value={p.name} />)}
              </datalist>
            </div>
            <Field label="نوع الفاتورة">
              <select value={form.invoiceType} onChange={e => set('invoiceType', e.target.value as InvoiceType)}
                className={inputCls()}>
                {(['توريدات','خدمات','أصول','مصروفات تشغيل'] as InvoiceType[]).map(t =>
                  <option key={t} value={t}>{t}</option>
                )}
              </select>
            </Field>
            <Field label="تاريخ الفاتورة *" error={errors.invoiceDate}>
              <input type="date" value={form.invoiceDate} onChange={e => set('invoiceDate', e.target.value)}
                className={inputCls(errors.invoiceDate)} />
            </Field>
            <Field label="تاريخ الاستحقاق *" error={errors.dueDate}>
              <input type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)}
                className={inputCls(errors.dueDate)} />
            </Field>
          </div>
        </div>

        {/* Financial */}
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-4 flex items-center gap-2">
            <span className="material-icons text-base text-primary">attach_money</span>
            البيانات المالية
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <Field label="العملة">
              <select value={form.currency} onChange={e => set('currency', e.target.value as 'EGP' | 'USD')}
                className={inputCls()}>
                <option value="EGP">جنيه مصري (EGP)</option>
                <option value="USD">دولار أمريكي (USD)</option>
              </select>
            </Field>
            {form.currency === 'USD' && (
              <Field label="سعر الصرف (USD → EGP)">
                <input type="number" min="0" value={form.exchangeRate ?? ''} onChange={e => set('exchangeRate', parseFloat(e.target.value) || 0)}
                  className={inputCls()} placeholder="مثال: 50.5" />
              </Field>
            )}
            <Field label="المبلغ قبل الضريبة *" error={errors.amount}>
              <input type="number" min="0" value={form.amount || ''} onChange={e => set('amount', parseFloat(e.target.value) || 0)}
                className={inputCls(errors.amount)} placeholder="0.00" />
            </Field>
            <Field label="ضريبة القيمة المضافة 14%">
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 cursor-pointer select-none whitespace-nowrap">
                  <input type="checkbox" checked={!!form.hasTax} onChange={e => { set('hasTax', e.target.checked); setTaxManual(false); }}
                    className="accent-primary w-4 h-4" />
                  <span className="text-xs text-gray-400">تشمل ضريبة</span>
                </label>
                <input type="number" min="0" value={form.tax} onChange={e => { setTaxManual(true); set('tax', parseFloat(e.target.value) || 0); }}
                  className={`${inputCls()} flex-1`} />
              </div>
            </Field>
            <Field label="خصم الضريبة تحت الحساب">
              <input type="number" min="0" value={form.withholdingTax ?? ''} onChange={e => set('withholdingTax', parseFloat(e.target.value) || 0)}
                className={inputCls()} placeholder="0.00" />
            </Field>
            <Field label="الإجمالي الصافي">
              <input type="number" value={form.total} readOnly className={`${inputCls()} opacity-60 cursor-not-allowed font-bold text-white`} />
            </Field>
          </div>
        </div>

        {/* Approval & Notes */}
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-4 flex items-center gap-2">
            <span className="material-icons text-base text-primary">approval</span>
            الاعتماد والملاحظات
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="حالة الاعتماد">
              <select value={form.approvalStatus} onChange={e => set('approvalStatus', e.target.value as ApprovalStatus)}
                className={inputCls()}>
                {(['Draft','Pending','Approved','Rejected'] as ApprovalStatus[]).map(s =>
                  <option key={s} value={s}>{approvalAr[s]}</option>
                )}
              </select>
            </Field>
            {form.approvalStatus === 'Approved' && (
              <Field label="اعتمدها">
                <input value={form.approvedBy || ''} onChange={e => set('approvedBy', e.target.value)}
                  className={inputCls()} placeholder="اسم المعتمد" />
              </Field>
            )}
            {form.approvalStatus === 'Rejected' && (
              <Field label="سبب الرفض">
                <input value={form.rejectionReason || ''} onChange={e => set('rejectionReason', e.target.value)}
                  className={inputCls()} placeholder="سبب الرفض" />
              </Field>
            )}
            <Field label="ملاحظات" className="md:col-span-2">
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
                rows={3} className={`${inputCls()} resize-none`} placeholder="أي ملاحظات إضافية..." />
            </Field>
          </div>
        </div>
      </div>

      {/* PDF Upload & Preview */}
      <div className="bg-[#232b3e] rounded-xl border border-gray-700 p-6 space-y-4">
        <h3 className="text-sm font-semibold text-gray-400 flex items-center gap-2">
          <span className="material-icons text-base text-orange-400">picture_as_pdf</span>
          ملف الفاتورة (PDF)
        </h3>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 cursor-pointer transition-colors">
            <span className="material-icons text-base">upload_file</span>
            {form.pdfData ? 'تغيير الملف' : 'رفع ملف PDF'}
            <input type="file" accept=".pdf" className="hidden" onChange={handlePdfUpload} />
          </label>
          {pdfParsing && <span className="text-xs text-blue-400 animate-pulse">جاري قراءة الملف...</span>}
          {pdfStatus && (
            <span className={`text-xs ${pdfStatus.ok ? 'text-green-400' : 'text-red-400'}`}>
              {pdfStatus.message}{pdfStatus.fields.length > 0 && ` (${pdfStatus.fields.join('، ')})`}
            </span>
          )}
          {form.pdfName && <span className="text-xs text-gray-500">{form.pdfName}</span>}
          {form.pdfData && (
            <button type="button" onClick={() => { setForm(p => ({ ...p, pdfData: undefined, pdfName: undefined })); setPdfPreviewUrl(null); }}
              className="text-xs text-red-400 hover:text-red-300 transition-colors">حذف الملف</button>
          )}
        </div>
        {pdfPreviewUrl && (
          <iframe src={pdfPreviewUrl} title="PDF Preview" className="w-full rounded-lg border border-gray-700" style={{ height: 500, background: '#fff' }} />
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3 justify-start">
        <button onClick={() => { if (validate()) onSave(form); }}
          className="flex items-center gap-2 px-6 py-2.5 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors text-sm font-medium">
          <span className="material-icons text-base">save</span>
          حفظ الفاتورة
        </button>
        <button onClick={onCancel}
          className="px-6 py-2.5 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors text-sm">
          إلغاء
        </button>
      </div>
    </div>
  );
};

// ─── Screen: Invoice Details ──────────────────────────────────────────────────

const InvoiceDetailsScreen: React.FC<{
  inv: PayableInvoice;
  onBack: () => void;
  onEdit: () => void;
  onPay: () => void;
  onSave: (inv: PayableInvoice) => void;
  canApprove: boolean;
}> = ({ inv, onBack, onEdit, onPay, onSave, canApprove }) => {
  const aps   = effectiveAPStatus(inv);
  const bal   = balance(inv);
  const paid  = totalPaid(inv);
  const eff   = effectiveTotal(inv);

  const handleApprove = () => onSave({ ...inv, approvalStatus: 'Approved', approvedAt: new Date().toISOString() });
  const handleReject  = () => {
    const reason = window.prompt('سبب الرفض:');
    if (reason !== null) onSave({ ...inv, approvalStatus: 'Rejected', rejectionReason: reason });
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-start gap-3 flex-wrap">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-900 transition-colors mt-1">
          <span className="material-icons">arrow_forward</span>
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-lg font-bold text-gray-800">{inv.invoiceNo}</h2>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${approvalColor[inv.approvalStatus]}`}>
              {approvalAr[inv.approvalStatus]}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${apStatusColor[aps]}`}>
              {apStatusAr[aps]}
            </span>
          </div>
          <p className="text-gray-400 text-sm mt-1">{inv.supplier} {inv.costCenter ? `— ${inv.costCenter}` : ''}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canApprove && inv.approvalStatus === 'Pending' && (
            <>
              <button onClick={handleApprove}
                className="flex items-center gap-1 px-3 py-2 text-sm bg-green-900/40 text-green-400 rounded-lg hover:bg-green-900/60 transition-colors">
                <span className="material-icons text-base">check_circle</span>
                اعتماد
              </button>
              <button onClick={handleReject}
                className="flex items-center gap-1 px-3 py-2 text-sm bg-red-900/40 text-red-400 rounded-lg hover:bg-red-900/60 transition-colors">
                <span className="material-icons text-base">cancel</span>
                رفض
              </button>
            </>
          )}
          {inv.approvalStatus === 'Approved' && aps !== 'Paid' && (
            <button onClick={onPay}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm rounded-lg hover:bg-primary-dark transition-colors">
              <span className="material-icons text-base">payments</span>
              تنفيذ دفع
            </button>
          )}
          <button onClick={onEdit}
            className="flex items-center gap-1 px-3 py-2 text-sm bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors">
            <span className="material-icons text-base">edit</span>
            تعديل
          </button>
        </div>
      </div>

      {/* Financial Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-[#232b3e] rounded-xl p-4 border border-gray-700">
          <p className="text-gray-400 text-xs mb-1">الإجمالي الصافي</p>
          <p className="text-xl font-bold text-white">{fmt(eff)}</p>
          <p className="text-gray-500 text-xs">{inv.currency}</p>
        </div>
        <div className="bg-[#232b3e] rounded-xl p-4 border border-gray-700">
          <p className="text-gray-400 text-xs mb-1">المدفوع</p>
          <p className="text-xl font-bold text-green-400">{fmt(paid)}</p>
          <p className="text-gray-500 text-xs">{inv.currency}</p>
        </div>
        <div className="bg-[#232b3e] rounded-xl p-4 border border-gray-700">
          <p className="text-gray-400 text-xs mb-1">الرصيد المتبقي</p>
          <p className={`text-xl font-bold ${bal > 0 ? 'text-red-400' : 'text-green-400'}`}>{fmt(bal)}</p>
          <p className="text-gray-500 text-xs">{inv.currency}</p>
        </div>
        <div className="bg-[#232b3e] rounded-xl p-4 border border-gray-700">
          <p className="text-gray-400 text-xs mb-1">تاريخ الاستحقاق</p>
          <p className={`text-base font-bold ${aps === 'Overdue' ? 'text-red-400' : 'text-white'}`}>{inv.dueDate || '—'}</p>
          {aps === 'Overdue' && (
            <p className="text-red-500 text-xs">
              متأخر {Math.floor((Date.now() - new Date(inv.dueDate).getTime()) / 86400000)} يوم
            </p>
          )}
        </div>
      </div>

      {/* Details Grid */}
      <div className="bg-[#232b3e] rounded-xl border border-gray-700 p-5">
        <h3 className="text-sm font-semibold text-gray-400 mb-4 flex items-center gap-2">
          <span className="material-icons text-base text-primary">description</span>
          تفاصيل الفاتورة
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 text-sm">
          {[
            { label: 'رقم الفاتورة',        value: inv.invoiceNo },
            { label: 'المورد',               value: inv.supplier },
            { label: 'مركز التكلفة',         value: inv.costCenter || '—' },
            { label: 'نوع الفاتورة',         value: inv.invoiceType },
            { label: 'تاريخ الفاتورة',       value: inv.invoiceDate },
            { label: 'العملة',               value: inv.currency },
            { label: 'المبلغ قبل الضريبة',   value: `${fmt(inv.amount)} ${inv.currency}` },
            { label: 'ضريبة القيمة المضافة', value: `${fmt(inv.tax)} ${inv.currency}` },
            { label: 'خصم ضريبة تحت الحساب', value: inv.withholdingTax ? `${fmt(inv.withholdingTax)} ${inv.currency}` : '—' },
            { label: 'الإجمالي',             value: `${fmt(inv.total)} ${inv.currency}` },
          ].map(row => (
            <div key={row.label}>
              <p className="text-gray-500 text-xs">{row.label}</p>
              <p className="text-white font-medium mt-0.5">{row.value}</p>
            </div>
          ))}
        </div>
        {inv.notes && (
          <div className="mt-4 pt-4 border-t border-gray-700">
            <p className="text-gray-500 text-xs mb-1">ملاحظات</p>
            <p className="text-gray-300 text-sm">{inv.notes}</p>
          </div>
        )}
        {inv.approvalStatus === 'Approved' && inv.approvedBy && (
          <div className="mt-4 pt-4 border-t border-gray-700 flex items-center gap-2 text-sm">
            <span className="material-icons text-green-400 text-base">verified</span>
            <span className="text-gray-400">اعتمدها:</span>
            <span className="text-green-400 font-medium">{inv.approvedBy}</span>
            {inv.approvedAt && <span className="text-gray-500 text-xs">{new Date(inv.approvedAt).toLocaleDateString('ar-EG')}</span>}
          </div>
        )}
        {inv.approvalStatus === 'Rejected' && inv.rejectionReason && (
          <div className="mt-4 pt-4 border-t border-gray-700 flex items-center gap-2 text-sm">
            <span className="material-icons text-red-400 text-base">cancel</span>
            <span className="text-gray-400">سبب الرفض:</span>
            <span className="text-red-400">{inv.rejectionReason}</span>
          </div>
        )}
      </div>

      {/* PDF Attachment Preview */}
      {inv.pdfData && (
        <div className="bg-[#232b3e] rounded-xl border border-gray-700 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-3">
            <span className="material-icons text-orange-400 text-base">picture_as_pdf</span>
            <h3 className="font-semibold text-white text-sm">نسخة الفاتورة</h3>
            {inv.pdfName && <span className="text-gray-500 text-xs mr-auto">{inv.pdfName}</span>}
          </div>
          <iframe
            src={b64ToBlobUrl(inv.pdfData!)}
            title="نسخة الفاتورة"
            className="w-full"
            style={{ height: '600px', background: '#fff' }}
          />
        </div>
      )}

      {/* Payment History */}
      <div className="bg-[#232b3e] rounded-xl border border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-3">
          <span className="material-icons text-green-400 text-base">payments</span>
          <h3 className="font-semibold text-white text-sm">سجل المدفوعات</h3>
          <span className="text-gray-500 text-xs mr-auto">{inv.payments.length} دفعة</span>
        </div>
        {inv.payments.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-gray-300">
              <thead className="text-xs text-gray-500 border-b border-gray-700 bg-[#1b2130]">
                <tr>
                  <th className="px-4 py-3 text-right">تاريخ الدفع</th>
                  <th className="px-4 py-3 text-right">المبلغ المدفوع</th>
                  <th className="px-4 py-3 text-right">طريقة الدفع</th>
                  <th className="px-4 py-3 text-right">البنك</th>
                  <th className="px-4 py-3 text-right">المرجع</th>
                  <th className="px-4 py-3 text-right">ملاحظات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {inv.payments.map(p => (
                  <tr key={p.id} className="hover:bg-[#2d3648] transition-colors">
                    <td className="px-4 py-3 text-xs text-gray-200">{p.paymentDate}</td>
                    <td className="px-4 py-3 font-semibold text-green-400">{fmt(p.amountPaid)} <span className="text-gray-400 font-normal">{inv.currency}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-200">{p.paymentMethod}</td>
                    <td className="px-4 py-3 text-xs text-gray-200">{p.bankName || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-200">{p.referenceNo}</td>
                    <td className="px-4 py-3 text-xs text-gray-200">{p.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-5 py-8 text-center text-gray-500 text-sm">لا توجد مدفوعات مسجلة</div>
        )}
      </div>
    </div>
  );
};

// ─── Screen: Payment Entry ────────────────────────────────────────────────────

const PaymentEntryScreen: React.FC<{
  invoices: PayableInvoice[];
  selectedInvoice: PayableInvoice | null;
  onSave: (inv: PayableInvoice) => void;
  onBack: () => void;
}> = ({ invoices, selectedInvoice: initSelected, onSave, onBack }) => {
  const payable = invoices.filter(i => i.approvalStatus === 'Approved' && effectiveAPStatus(i) !== 'Paid');
  const [inv, setInv]           = useState<PayableInvoice | null>(initSelected ?? payable[0] ?? null);
  const [payDate, setPayDate]   = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount]     = useState('');
  const [method, setMethod]     = useState<SupplierPayment['paymentMethod']>('تحويل بنكي');
  const [bank, setBank]         = useState('');
  const [ref, setRef]           = useState('');
  const [notes, setNotes]       = useState('');
  const [saved, setSaved]       = useState(false);
  const [err, setErr]           = useState('');

  const bal = inv ? balance(inv) : 0;

  const handleSubmit = () => {
    if (!inv) return;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setErr('أدخل مبلغاً صحيحاً'); return; }
    if (amt > bal + 0.01) { setErr(`المبلغ (${fmt(amt)}) يتجاوز الرصيد المتبقي (${fmt(bal)})`); return; }
    if (!ref.trim()) { setErr('رقم المرجع مطلوب'); return; }
    setErr('');
    const payment: SupplierPayment = {
      id: uid(), paymentDate: payDate, amountPaid: amt,
      paymentMethod: method, bankName: bank || undefined, referenceNo: ref, notes: notes || undefined,
    };
    const newPayments = [...inv.payments, payment];
    const newPaid = newPayments.reduce((s, p) => s + p.amountPaid, 0);
    const newEff  = effectiveTotal(inv);
    const newPS: PaymentStatus = newPaid >= newEff ? 'Paid' : 'Partial';
    const newAPS: APStatus     = newPaid >= newEff ? 'Paid' : 'Partially Paid';
    const updated: PayableInvoice = { ...inv, payments: newPayments, paymentStatus: newPS, apStatus: newAPS };
    onSave(updated);
    setInv(updated);
    setSaved(true);
    setAmount(''); setRef(''); setBank(''); setNotes('');
    setTimeout(() => setSaved(false), 3000);
  };

  const inputCls = 'w-full bg-[#1b2130] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-primary';

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-900 transition-colors">
          <span className="material-icons">arrow_forward</span>
        </button>
        <h2 className="text-lg font-bold text-gray-800">تنفيذ دفع للمورد</h2>
      </div>

      {saved && (
        <div className="flex items-center gap-2 px-4 py-3 bg-green-900/40 border border-green-700/50 rounded-lg text-green-400 text-sm">
          <span className="material-icons text-base">check_circle</span>
          تم تسجيل الدفعة بنجاح
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Select Invoice */}
        <div className="xl:col-span-1 space-y-4">
          <div className="bg-[#232b3e] rounded-xl border border-gray-700 p-5">
            <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
              <span className="material-icons text-base text-primary">receipt</span>
              اختر الفاتورة
            </h3>
            <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
              {payable.length === 0 && (
                <p className="text-gray-500 text-sm text-center py-4">لا توجد فواتير معتمدة بانتظار الدفع</p>
              )}
              {payable.map(i => {
                const b = balance(i);
                const aps = effectiveAPStatus(i);
                return (
                  <button key={i.id}
                    onClick={() => setInv(i)}
                    className={`w-full text-right p-3 rounded-lg border transition-colors ${
                      inv?.id === i.id ? 'border-primary bg-primary/10' : 'border-gray-700 hover:border-gray-500 bg-[#1b2130]'
                    }`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-white text-xs font-semibold">{i.invoiceNo}</p>
                        <p className="text-gray-200 text-[11px]">{i.supplier}</p>
                      </div>
                      <div className="text-left">
                        <p className="text-white text-xs font-bold">{fmt(b)} EGP</p>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${apStatusColor[aps]}`}>{apStatusAr[aps]}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Payment Form */}
        <div className="xl:col-span-2">
          <div className="bg-[#232b3e] rounded-xl border border-gray-700 p-5 space-y-4">
            <h3 className="text-sm font-semibold text-gray-400 flex items-center gap-2">
              <span className="material-icons text-base text-primary">payments</span>
              تفاصيل الدفعة
            </h3>

            {inv && (
              <div className="grid grid-cols-3 gap-3 p-3 bg-[#1b2130] rounded-lg text-xs">
                <div><p className="text-gray-500">الفاتورة</p><p className="text-white font-medium">{inv.invoiceNo}</p></div>
                <div><p className="text-gray-500">الإجمالي</p><p className="text-white font-medium">{fmt(effectiveTotal(inv))} EGP</p></div>
                <div><p className="text-gray-500">الرصيد المتبقي</p><p className="text-red-400 font-bold">{fmt(bal)} EGP</p></div>
              </div>
            )}

            {err && (
              <div className="flex items-center gap-2 text-red-400 text-xs bg-red-900/20 px-3 py-2 rounded-lg">
                <span className="material-icons text-sm">error</span>{err}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">تاريخ الدفع</label>
                <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">المبلغ المدفوع *</label>
                <input type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)}
                  className={inputCls} placeholder="0.00" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">طريقة الدفع</label>
                <select value={method} onChange={e => setMethod(e.target.value as any)} className={inputCls}>
                  {['تحويل بنكي','شيك','خصم مباشر','نقدي','أخرى'].map(m =>
                    <option key={m} value={m}>{m}</option>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">اسم البنك</label>
                <input value={bank} onChange={e => setBank(e.target.value)} className={inputCls} placeholder="بنك مصر، QNB، ..." />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">رقم المرجع / الشيك *</label>
                <input value={ref} onChange={e => setRef(e.target.value)} className={inputCls} placeholder="TRF-XXXX أو CHK-XXXX" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">ملاحظات</label>
                <input value={notes} onChange={e => setNotes(e.target.value)} className={inputCls} placeholder="اختياري" />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={handleSubmit} disabled={!inv}
                className="flex items-center gap-2 px-6 py-2.5 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                <span className="material-icons text-base">send</span>
                تأكيد الدفع
              </button>
              <button onClick={onBack}
                className="px-4 py-2.5 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors text-sm">
                رجوع
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Screen: History ──────────────────────────────────────────────────────────

type FlatPayment = SupplierPayment & { invoiceId: string; invoiceNo: string; supplier: string; currency: string };

const HistoryScreen: React.FC<{
  invoices: PayableInvoice[];
  canEdit: boolean;
  onDeletePayment: (invoiceId: string, paymentId: string) => void;
  onEditPayment: (invoiceId: string, payment: SupplierPayment) => void;
}> = ({ invoices, canEdit, onDeletePayment, onEditPayment }) => {
  const [sortCol, setSortCol]         = useState<string | null>('paymentDate');
  const [sortDir, setSortDir]         = useState<SortDir>('desc');
  const [search, setSearch]           = useState('');
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const [editTarget, setEditTarget]   = useState<FlatPayment | null>(null);
  const [editForm, setEditForm]       = useState<Partial<SupplierPayment>>({});

  const handleSort = (col: string) => {
    setSortDir(p => sortCol === col && p === 'asc' ? 'desc' : 'asc');
    setSortCol(col);
  };

  const allPayments = useMemo<FlatPayment[]>(() => {
    const rows: FlatPayment[] = [];
    for (const inv of invoices) {
      for (const p of inv.payments) {
        rows.push({ ...p, invoiceId: inv.id, invoiceNo: inv.invoiceNo, supplier: inv.supplier, currency: inv.currency });
      }
    }
    return rows;
  }, [invoices]);

  const filtered = useMemo(() => {
    if (!search) return allPayments;
    const q = search.toLowerCase();
    return allPayments.filter(r =>
      r.invoiceNo.toLowerCase().includes(q) ||
      r.supplier.toLowerCase().includes(q) ||
      r.referenceNo.toLowerCase().includes(q)
    );
  }, [allPayments, search]);

  const sorted = useMemo(() => {
    if (!sortCol) return filtered;
    return [...filtered].sort((a, b) => {
      let v = 0;
      if (sortCol === 'paymentDate') v = cmp(a.paymentDate, b.paymentDate);
      else if (sortCol === 'amountPaid')  v = cmp(a.amountPaid, b.amountPaid);
      else if (sortCol === 'supplier')    v = cmp(a.supplier, b.supplier);
      return applyDir(v, sortDir);
    });
  }, [filtered, sortCol, sortDir]);

  const totalPaidAll  = filtered.reduce((s, r) => s + r.amountPaid, 0);
  const allChecked    = sorted.length > 0 && sorted.every(r => selected.has(r.id));
  const toggleAll     = () => setSelected(allChecked ? new Set() : new Set(sorted.map(r => r.id)));
  const toggle        = (id: string) => setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const openEdit = (r: FlatPayment) => {
    setEditTarget(r);
    setEditForm({ paymentDate: r.paymentDate, amountPaid: r.amountPaid, paymentMethod: r.paymentMethod, bankName: r.bankName, referenceNo: r.referenceNo, notes: r.notes });
  };
  const saveEdit = () => {
    if (!editTarget) return;
    onEditPayment(editTarget.invoiceId, { ...editTarget, ...editForm } as SupplierPayment);
    setEditTarget(null);
  };

  const bulkDelete = () => {
    const toDelete = sorted.filter(r => selected.has(r.id));
    for (const r of toDelete) onDeletePayment(r.invoiceId, r.id);
    setSelected(new Set());
  };

  const inputCls = 'w-full bg-[#1b2130] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-primary';

  return (
    <div className="space-y-4" dir="rtl">
      {/* Edit Payment Modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" dir="rtl">
          <div className="bg-[#232b3e] rounded-xl border border-gray-600 p-6 w-full max-w-lg shadow-2xl space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <span className="material-icons text-primary">edit</span>
              <h3 className="text-white font-semibold">تعديل دفعة — {editTarget.invoiceNo}</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">تاريخ الدفع</label>
                <input type="date" value={editForm.paymentDate || ''} onChange={e => setEditForm(p => ({ ...p, paymentDate: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">المبلغ المدفوع</label>
                <input type="number" min="0" value={editForm.amountPaid ?? ''} onChange={e => setEditForm(p => ({ ...p, amountPaid: parseFloat(e.target.value) || 0 }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">طريقة الدفع</label>
                <select value={editForm.paymentMethod || 'تحويل بنكي'} onChange={e => setEditForm(p => ({ ...p, paymentMethod: e.target.value as any }))} className={inputCls}>
                  {['تحويل بنكي','شيك','خصم مباشر','نقدي','أخرى'].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">البنك</label>
                <input value={editForm.bankName || ''} onChange={e => setEditForm(p => ({ ...p, bankName: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">رقم المرجع</label>
                <input value={editForm.referenceNo || ''} onChange={e => setEditForm(p => ({ ...p, referenceNo: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">ملاحظات</label>
                <input value={editForm.notes || ''} onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={saveEdit} className="flex items-center gap-2 px-5 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark text-sm font-medium">
                <span className="material-icons text-base">save</span>حفظ التعديلات
              </button>
              <button onClick={() => setEditTarget(null)} className="px-5 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 text-sm">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <span className="material-icons absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-lg">search</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="بحث في سجل المدفوعات..."
            className="w-full bg-[#1b2130] border border-gray-700 rounded-lg py-2 pr-10 pl-4 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-primary" />
        </div>
        {canEdit && selected.size > 0 && (
          <button onClick={bulkDelete}
            className="flex items-center gap-1 px-3 py-2 text-sm bg-red-900/40 text-red-400 rounded-lg hover:bg-red-900/60 transition-colors">
            <span className="material-icons text-base">delete</span>حذف ({selected.size})
          </button>
        )}
        <div className="bg-[#232b3e] rounded-lg px-4 py-2 border border-gray-700 text-sm">
          <span className="text-gray-400">إجمالي المدفوعات: </span>
          <span className="text-green-400 font-bold">{fmt(totalPaidAll)} EGP</span>
        </div>
      </div>

      <div className="bg-[#232b3e] rounded-xl border border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-3">
          <span className="material-icons text-primary text-base">history</span>
          <h3 className="font-semibold text-white text-sm">سجل جميع المدفوعات</h3>
          <span className="text-gray-500 text-xs mr-auto">{sorted.length} سجل</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-gray-300">
            <thead className="text-xs text-gray-500 border-b border-gray-700 bg-[#1b2130]">
              <tr>
                {canEdit && (
                  <th className="px-4 py-3">
                    <input type="checkbox" checked={allChecked} onChange={toggleAll} className="w-4 h-4 accent-primary" />
                  </th>
                )}
                <SortTh label="تاريخ الدفع"    col="paymentDate" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="رقم الفاتورة"   col="invoiceNo"   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="المورد"          col="supplier"    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="المبلغ المدفوع"  col="amountPaid"  sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 text-right">طريقة الدفع</th>
                <th className="px-4 py-3 text-right">البنك</th>
                <th className="px-4 py-3 text-right">المرجع</th>
                <th className="px-4 py-3 text-right">ملاحظات</th>
                {canEdit && <th className="px-4 py-3 text-right">إجراءات</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {sorted.map(r => (
                <tr key={r.id} className="hover:bg-[#2d3648] transition-colors">
                  {canEdit && (
                    <td className="px-4 py-3" onClick={e => { e.stopPropagation(); toggle(r.id); }}>
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => {}} className="w-4 h-4 accent-primary cursor-pointer" />
                    </td>
                  )}
                  <td className="px-4 py-3 text-xs text-gray-200">{r.paymentDate}</td>
                  <td className="px-4 py-3 font-mono text-xs text-white">{r.invoiceNo}</td>
                  <td className="px-4 py-3 font-medium text-white">{r.supplier}</td>
                  <td className="px-4 py-3 font-bold text-green-400">{fmt(r.amountPaid)} <span className="text-gray-400 font-normal">{r.currency}</span></td>
                  <td className="px-4 py-3 text-xs text-gray-200">{r.paymentMethod}</td>
                  <td className="px-4 py-3 text-xs text-gray-200">{r.bankName || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-200">{r.referenceNo}</td>
                  <td className="px-4 py-3 text-xs text-gray-200">{r.notes || '—'}</td>
                  {canEdit && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => openEdit(r)} title="تعديل"
                          className="text-gray-400 hover:text-primary transition-colors">
                          <span className="material-icons text-base">edit</span>
                        </button>
                        <button onClick={() => onDeletePayment(r.invoiceId, r.id)} title="حذف"
                          className="text-gray-400 hover:text-red-400 transition-colors">
                          <span className="material-icons text-base">delete</span>
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={canEdit ? 10 : 8} className="px-4 py-10 text-center text-gray-500">لا توجد مدفوعات مسجلة</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const PayablesDashboard: React.FC<{ user: User }> = ({ user }) => {
  const [invoices, setInvoices]       = useState<PayableInvoice[]>([]);
  const [projects, setProjects]       = useState<Project[]>([]);
  const [loading, setLoading]         = useState(true);
  const [screen, setScreen]           = useState<Screen>('dashboard');
  const [activeTab, setActiveTab]     = useState<'dashboard' | 'invoice-list' | 'payment-entry' | 'history'>('dashboard');
  const [selectedInv, setSelectedInv] = useState<PayableInvoice | null>(null);
  const [editInv, setEditInv]         = useState<PayableInvoice | null>(null);
  const [payFor, setPayFor]           = useState<PayableInvoice | null>(null);

  const isFinanceUser = ['taher.mohamed@pbkadvisory.com'].includes((user.username || '').toLowerCase());
  const canDelete  = isFinanceUser || ['super_admin', 'power_admin', 'admin'].includes(user.role);
  const canApprove = ['super_admin', 'power_admin', 'admin'].includes(user.role);

  // Load from Supabase
  useEffect(() => {
    (async () => {
      const [remote, allProjects] = await Promise.all([
        loadPayables(),
        StorageService.getProjects(),
      ]);
      setInvoices(remote.length > 0 ? remote : []);
      setProjects(allProjects);
      setLoading(false);
    })();
  }, []);

  const persist = async (updated: PayableInvoice[]) => {
    setInvoices(updated);
    for (const inv of updated) await upsertPayable(inv);
  };

  const handleSave = async (inv: PayableInvoice) => {
    const idx = invoices.findIndex(i => i.id === inv.id);
    const prev = idx >= 0 ? invoices[idx] : null;
    const updated = idx >= 0
      ? invoices.map(i => i.id === inv.id ? inv : i)
      : [...invoices, inv];
    await persist(updated);

    // Auto-post supplier invoice JE when approval status transitions to Approved
    const wasApproved = prev?.approvalStatus === 'Approved';
    if (inv.approvalStatus === 'Approved' && !wasApproved) {
      autoPostSupplierInvoice({
        id: inv.id,
        invoiceNo: inv.invoiceNo,
        supplier: inv.supplier,
        invoiceDate: inv.invoiceDate,
        amount: inv.amount,
        tax: inv.tax,
        total: inv.total,
        currency: inv.currency,
        exchangeRate: inv.exchangeRate,
        invoiceType: inv.invoiceType,
      }).catch(() => {/* non-blocking */});
    }

    // Auto-post supplier payment JE when a new payment is added
    const prevPaymentCount = prev?.payments.length ?? 0;
    if (inv.payments.length > prevPaymentCount) {
      const newPayment = inv.payments[inv.payments.length - 1];
      autoPostSupplierPayment(
        { id: inv.id, invoiceNo: inv.invoiceNo, supplier: inv.supplier, invoiceDate: inv.invoiceDate, amount: inv.amount, tax: inv.tax, total: inv.total, currency: inv.currency, exchangeRate: inv.exchangeRate },
        { id: newPayment.id, paymentDate: newPayment.paymentDate, amountPaid: newPayment.amountPaid, paymentMethod: newPayment.paymentMethod, referenceNo: newPayment.referenceNo }
      ).catch(() => {/* non-blocking */});
    }

    setScreen(activeTab === 'invoice-list' ? 'invoice-list' : 'dashboard');
    setEditInv(null);
  };

  const handleRequestApproval = async (ids: string[]) => {
    const updated = invoices.map(inv =>
      ids.includes(inv.id) ? { ...inv, approvalStatus: 'Pending' as ApprovalStatus } : inv
    );
    await persist(updated);
  };

  const handleDelete = async (ids: string[]) => {
    const updated = invoices.filter(i => !ids.includes(i.id));
    setInvoices(updated);
    await deletePayables(ids);
  };

  const recalcStatus = (inv: PayableInvoice): PayableInvoice => {
    const paid = inv.payments.reduce((s, p) => s + p.amountPaid, 0);
    const eff  = inv.total - (inv.deductions ?? []).reduce((s, d) => s + d.amount, 0);
    const ps: PaymentStatus = paid >= eff && eff > 0 ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid';
    const aps: APStatus     = paid >= eff && eff > 0 ? 'Paid' : paid > 0 ? 'Partially Paid' : inv.apStatus;
    return { ...inv, paymentStatus: ps, apStatus: aps };
  };

  const handleDeletePayment = async (invoiceId: string, paymentId: string) => {
    const updated = invoices.map(inv => {
      if (inv.id !== invoiceId) return inv;
      const next = recalcStatus({ ...inv, payments: inv.payments.filter(p => p.id !== paymentId) });
      upsertPayable(next);
      return next;
    });
    setInvoices(updated);
  };

  const handleEditPayment = async (invoiceId: string, payment: SupplierPayment) => {
    const updated = invoices.map(inv => {
      if (inv.id !== invoiceId) return inv;
      const next = recalcStatus({ ...inv, payments: inv.payments.map(p => p.id === payment.id ? payment : p) });
      upsertPayable(next);
      return next;
    });
    setInvoices(updated);
  };

  const openDetails = (inv: PayableInvoice) => {
    setSelectedInv(inv);
    setScreen('invoice-details');
  };

  const openEdit = (inv: PayableInvoice | null) => {
    setEditInv(inv);
    setScreen('create-invoice');
  };

  const openPayment = (inv: PayableInvoice | null) => {
    setPayFor(inv);
    setScreen('payment-entry');
    setActiveTab('payment-entry');
  };

  const handleTabChange = (tab: typeof activeTab) => {
    setActiveTab(tab);
    setScreen(tab);
    setSelectedInv(null);
    setEditInv(null);
    setPayFor(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" dir="rtl">
        <span className="material-icons text-primary animate-spin text-3xl">refresh</span>
        <span className="text-gray-400 text-sm mr-3">جارٍ تحميل بيانات المدفوعات...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* Module Header */}
      <div className="flex items-center gap-3">
        <span className="material-icons text-primary text-2xl">account_balance</span>
        <div>
          <h2 className="text-xl font-bold text-black">الادارة المالية — المدفوعات</h2>
          <p className="text-gray-500 text-xs">إدارة فواتير الموردين ومتابعة المدفوعات وحسابات الدائنين</p>
        </div>
      </div>

      {/* Tab Bar — hidden when inside sub-screens */}
      {(screen === 'dashboard' || screen === 'invoice-list' || screen === 'payment-entry' || screen === 'history') && (
        <div className="flex gap-1 bg-[#232b3e] rounded-xl p-1.5 border border-gray-700 w-fit">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => handleTabChange(tab.id as typeof activeTab)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all duration-200 ${
                activeTab === tab.id
                  ? 'bg-primary text-white shadow font-semibold'
                  : 'text-gray-400 hover:text-white hover:bg-[#2d3648]'
              }`}>
              <span className="material-icons text-base">{tab.icon}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Screen Router */}
      {screen === 'dashboard' && (
        <DashboardScreen invoices={invoices} onOpen={openDetails} />
      )}
      {screen === 'invoice-list' && (
        <InvoiceListScreen
          invoices={invoices}
          onOpen={openDetails}
          onCreate={() => openEdit(null)}
          onDelete={handleDelete}
          onEdit={inv => openEdit(inv)}
          onRequestApproval={handleRequestApproval}
          canDelete={canDelete}
        />
      )}
      {screen === 'create-invoice' && (
        <CreateInvoiceScreen
          initial={editInv}
          projects={projects}
          invoices={invoices}
          user={user}
          onSave={handleSave}
          onCancel={() => setScreen(activeTab)}
          onRefresh={async () => {
            const remote = await loadPayables();
            setInvoices(remote.length > 0 ? remote : []);
          }}
        />
      )}
      {screen === 'invoice-details' && selectedInv && (
        <InvoiceDetailsScreen
          inv={invoices.find(i => i.id === selectedInv.id) ?? selectedInv}
          onBack={() => setScreen(activeTab)}
          onEdit={() => openEdit(selectedInv)}
          onPay={() => openPayment(selectedInv)}
          onSave={handleSave}
          canApprove={canApprove}
        />
      )}
      {screen === 'payment-entry' && (
        <PaymentEntryScreen
          invoices={invoices}
          selectedInvoice={payFor}
          onSave={handleSave}
          onBack={() => { setScreen('dashboard'); setActiveTab('dashboard'); }}
        />
      )}
      {screen === 'history' && (
        <HistoryScreen
          invoices={invoices}
          canEdit={canDelete}
          onDeletePayment={handleDeletePayment}
          onEditPayment={handleEditPayment}
        />
      )}
    </div>
  );
};

export default PayablesDashboard;
