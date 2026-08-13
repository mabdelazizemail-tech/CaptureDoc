import React, { useMemo, useState } from 'react';
import { CAPTURE_DOC_LOGO } from './captureDocLogo';

// ─── Types ──────────────────────────────────────────────────────────────────
// A single ledger movement, already normalised to EGP by the caller.
export interface StatementTxn {
  date: string;        // ISO yyyy-mm-dd
  ref: string;         // invoice no / payment or note reference
  description: string; // English label
  debit: number;       // increases the amount owed (EGP)
  credit: number;      // reduces the amount owed (EGP)
}

// An open (still-outstanding) invoice, used for the aging summary.
export interface StatementOpenItem {
  ref: string;
  dueDate: string;     // ISO yyyy-mm-dd (may be empty)
  outstanding: number; // EGP, > 0
}

// One selectable account (a customer or a supplier) with its full history.
export interface StatementAccount {
  name: string;
  txns: StatementTxn[];
  openItems?: StatementOpenItem[];
}

interface Props {
  kind: 'customer' | 'supplier';
  accounts: StatementAccount[];
  onBack: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  n.toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const money = (n: number) => `EGP ${fmt(n)}`;

const fmtDate = (iso: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
};

const fmtLong = (iso: string) => {
  if (!iso) return '—';
  const dt = new Date(`${iso}T00:00:00`);
  return isNaN(dt.getTime())
    ? iso
    : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
};

const today = () => new Date().toISOString().slice(0, 10);

// ─── Component ──────────────────────────────────────────────────────────────
const StatementOfAccount: React.FC<Props> = ({ kind, accounts, onBack }) => {
  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) => a.name.localeCompare(b.name, 'ar')),
    [accounts],
  );

  const [accountName, setAccountName] = useState(sortedAccounts[0]?.name ?? '');
  const account = sortedAccounts.find(a => a.name === accountName) ?? sortedAccounts[0] ?? null;

  // Sensible default range: earliest movement → today.
  const earliest = useMemo(() => {
    const dates = (account?.txns ?? []).map(t => t.date).filter(Boolean).sort();
    return dates[0] ?? today();
  }, [account]);

  const [fromDate, setFromDate] = useState(earliest);
  const [toDate, setToDate]     = useState(today());

  // Reset the range only when the user actually switches account — never on
  // re-render. (Keying off `earliest` alone would clobber a date the user just
  // picked, since the parent rebuilds the accounts array on every render.)
  const lastAccount = React.useRef(accountName);
  React.useEffect(() => {
    if (lastAccount.current !== accountName) {
      lastAccount.current = accountName;
      setFromDate(earliest);
      setToDate(today());
    }
  }, [accountName, earliest]);

  // Ledger for the selected period (with opening balance + running balance).
  const model = useMemo(() => {
    const txns = [...(account?.txns ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    const opening = txns
      .filter(t => t.date < fromDate)
      .reduce((s, t) => s + t.debit - t.credit, 0);
    const inRange = txns.filter(t => t.date >= fromDate && t.date <= toDate);

    let running = opening;
    const rows = inRange.map(t => {
      running += t.debit - t.credit;
      return { ...t, balance: running };
    });

    const totalDebit  = inRange.reduce((s, t) => s + t.debit, 0);
    const totalCredit = inRange.reduce((s, t) => s + t.credit, 0);
    return { opening, rows, totalDebit, totalCredit, closing: running };
  }, [account, fromDate, toDate]);

  // Aging snapshot as of the statement "to" date.
  const aging = useMemo(() => {
    const items = account?.openItems ?? [];
    const totalOpen = items.reduce((s, i) => s + i.outstanding, 0);
    const overdue = items
      .filter(i => i.dueDate && i.dueDate < toDate)
      .reduce((s, i) => s + i.outstanding, 0);
    return { totalOpen, overdue, current: totalOpen - overdue };
  }, [account, toDate]);

  const openLabel = kind === 'customer' ? 'Total open balance' : 'Total payable balance';

  return (
    <div dir="rtl" className="space-y-5">
      {/* Print isolation + paper look (screen-only controls hidden on print) */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #soa-print, #soa-print * { visibility: visible !important; }
          #soa-print { position: absolute; inset: 0; margin: 0; width: 100%;
                       box-shadow: none !important; border: none !important; }
          .soa-no-print { display: none !important; }
          @page { size: A4; margin: 14mm; }
        }
      `}</style>

      {/* ── Controls (not printed) ── */}
      <div className="soa-no-print flex items-center gap-3">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-900 transition-colors">
          <span className="material-icons">arrow_forward</span>
        </button>
        <h2 className="text-lg font-bold text-gray-800">كشف حساب — Statement of Account</h2>
      </div>

      <div className="soa-no-print bg-[#232b3e] rounded-xl border border-gray-700 p-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div className="md:col-span-2">
          <label className="block text-xs text-gray-400 mb-1">{kind === 'customer' ? 'العميل' : 'المورد'}</label>
          <select
            value={accountName}
            onChange={e => setAccountName(e.target.value)}
            className="w-full bg-[#1b2130] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-primary">
            {sortedAccounts.length === 0 && <option value="">لا توجد حسابات</option>}
            {sortedAccounts.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">من تاريخ</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="w-full bg-[#1b2130] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-primary" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">إلى تاريخ</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="w-full bg-[#1b2130] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-primary" />
        </div>
        <div className="md:col-span-4 flex justify-end">
          <button
            onClick={() => window.print()}
            disabled={!account}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            <span className="material-icons text-base">print</span>
            طباعة / حفظ PDF
          </button>
        </div>
      </div>

      {/* ── The printable statement (paper, English only) ── */}
      <div id="soa-print" dir="ltr"
        className="bg-white text-[#1a1a1a] rounded-xl border border-gray-300 shadow-sm mx-auto max-w-[820px] p-8 md:p-10">

        {/* Letterhead: logo left, title + as-of right */}
        <div className="flex items-end justify-between pb-3" style={{ borderBottom: '3px solid #344F21' }}>
          <img src={CAPTURE_DOC_LOGO} alt="Capture Doc" style={{ height: 56, width: 'auto' }} />
          <div className="text-right">
            <div className="text-lg font-bold tracking-wide" style={{ color: '#1d3a5c' }}>STATEMENT OF ACCOUNT</div>
            <div className="text-xs font-semibold mt-1" style={{ color: '#1d3a5c' }}>As of {fmtLong(toDate)}</div>
          </div>
        </div>

        {/* Statement-for card */}
        <div className="mt-6 rounded-lg border px-4 py-3 max-w-[380px]"
             style={{ borderColor: '#d8dee6' }}>
          <div className="text-[11px] font-semibold tracking-[0.14em] text-gray-500">STATEMENT FOR</div>
          <div className="text-lg font-bold mt-0.5" dir="auto">{account?.name ?? '—'}</div>
          <div className="text-xs text-gray-500 mt-1">
            Period: {fmtDate(fromDate)} — {fmtDate(toDate)}
          </div>
        </div>

        {/* KPI cards: total / overdue / current */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg px-4 py-3" style={{ background: '#1d3a5c' }}>
            <div className="text-[11px] font-semibold tracking-[0.12em]" style={{ color: 'rgba(255,255,255,0.72)' }}>
              {openLabel.toUpperCase()}
            </div>
            <div className="text-xl font-bold mt-1 text-white">{money(aging.totalOpen)}</div>
          </div>
          <div className="rounded-lg px-4 py-3" style={{ background: '#fdecec', border: '1px solid #f4cccc' }}>
            <div className="text-[11px] font-semibold tracking-[0.12em]" style={{ color: '#b3403a' }}>OVERDUE</div>
            <div className="text-xl font-bold mt-1" style={{ color: '#a3271f' }}>{money(aging.overdue)}</div>
          </div>
          <div className="rounded-lg px-4 py-3" style={{ background: '#e9f4ec', border: '1px solid #cfe6d6' }}>
            <div className="text-[11px] font-semibold tracking-[0.12em]" style={{ color: '#2c7350' }}>CURRENT / DUE TODAY</div>
            <div className="text-xl font-bold mt-1" style={{ color: '#206F47' }}>{money(aging.current)}</div>
          </div>
        </div>

        {/* Ledger */}
        <table className="w-full mt-7 text-sm border-collapse">
          <thead>
            <tr style={{ background: '#344F21', color: '#fff' }}>
              <th className="text-left  font-semibold px-3 py-2">Date</th>
              <th className="text-left  font-semibold px-3 py-2">Reference</th>
              <th className="text-left  font-semibold px-3 py-2">Description</th>
              <th className="text-right font-semibold px-3 py-2">Debit</th>
              <th className="text-right font-semibold px-3 py-2">Credit</th>
              <th className="text-right font-semibold px-3 py-2">Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ background: '#f3f5f2' }}>
              <td className="px-3 py-2" colSpan={5}><em>Opening balance ({fmtDate(fromDate)})</em></td>
              <td className="px-3 py-2 text-right font-semibold">{fmt(model.opening)}</td>
            </tr>

            {model.rows.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-gray-400" colSpan={6}>
                  No movements in the selected period
                </td>
              </tr>
            )}

            {model.rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #e6e6e6' }}>
                <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.date)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.ref || '—'}</td>
                <td className="px-3 py-2" dir="auto">{r.description}</td>
                <td className="px-3 py-2 text-right">{r.debit ? fmt(r.debit) : '—'}</td>
                <td className="px-3 py-2 text-right">{r.credit ? fmt(r.credit) : '—'}</td>
                <td className="px-3 py-2 text-right font-medium">{fmt(r.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid #344F21' }}>
              <td className="px-3 py-2 font-semibold" colSpan={3}>Totals</td>
              <td className="px-3 py-2 text-right font-semibold">{fmt(model.totalDebit)}</td>
              <td className="px-3 py-2 text-right font-semibold">{fmt(model.totalCredit)}</td>
              <td className="px-3 py-2 text-right font-semibold">{fmt(model.closing)}</td>
            </tr>
          </tfoot>
        </table>

        <p className="mt-4 text-[11px] text-gray-400">
          Amounts shown in EGP. USD invoices are converted at their recorded exchange rate.
        </p>

        {/* Footer band (mirrors the letterhead footer) */}
        <div className="mt-8 pt-2 flex items-center justify-between text-[11px]"
             style={{ borderTop: '1px solid #E1E5EA', color: '#586474' }}>
          <span>Capture Doc&nbsp;&nbsp;|&nbsp;&nbsp;STATEMENT OF ACCOUNT&nbsp;&nbsp;|&nbsp;&nbsp;Confidential</span>
          <span style={{ color: '#206F47', fontWeight: 700 }}>1</span>
        </div>
      </div>
    </div>
  );
};

export default StatementOfAccount;
