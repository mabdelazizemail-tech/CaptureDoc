import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabaseClient';
import { User } from '../services/types';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Types
interface InternalInvoice {
    id: string;
    invoiceNo: string;
    customer: string;
    invoiceDate: string;
    total: number;
    amount: number; // pretax
    tax: number;
    invoiceStatus: string;
    collectionStatus: string;
    paymentStatus: string;
    pdfData?: string;
    pdfName?: string;
}

interface ETAInvoice {
    uuid: string;
    internalId: string;
    issuerName: string;
    receiverName: string;
    dateTimeIssued: string;
    total: number;
    status: string; // E-Invoice status
}

interface ReconRow {
    invoiceNo: string;
    etaUuid: string;
    invoiceDate: string;
    customer: string;
    internalAmount: number;
    etaAmount: number;
    variance: number;
    submissionStatus: string;
    reconciliationStatus: string;
    collectionStatus: string;
    submissionDate: string;
    internalPdfData?: string;
    internalPdfName?: string;
}

export const EInvoiceReconciliation: React.FC<{ user: User }> = ({ user }) => {
    // API Credentials
    const [etaClientId, setEtaClientId] = useState(localStorage.getItem('eta_client_id') ?? '');
    const [etaClientSec, setEtaClientSec] = useState(localStorage.getItem('eta_client_sec') ?? '');
    const [etaClientSec2, setEtaClientSec2] = useState(localStorage.getItem('eta_client_sec2') ?? '');

    // State
    const [loading, setLoading] = useState(false);
    const [internalInvoices, setInternalInvoices] = useState<InternalInvoice[]>([]);
    const [etaInvoices, setEtaInvoices] = useState<ETAInvoice[]>([]);
    
    // Filters
    const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); });
    const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
    const [filterInvNo, setFilterInvNo] = useState('');
    const [filterCustomer, setFilterCustomer] = useState('');
    const [filterInvStatus, setFilterInvStatus] = useState('all');
    const [filterReconStatus, setFilterReconStatus] = useState('all');
    
    // PDF & Export State
    const [exportModalOpen, setExportModalOpen] = useState(false);
    const [exportFormat, setExportFormat] = useState<'excel' | 'csv' | 'pdf'>('excel');
    const [includePdfs, setIncludePdfs] = useState(false);
    const [exportProgress, setExportProgress] = useState<{ total: number, current: number, status: string, retrieved: number, failed: number, failedList: { id: string, reason: string }[] } | null>(null);

    const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
    const [previewPdfName, setPreviewPdfName] = useState<string>('');
    const [pdfLoading, setPdfLoading] = useState<string>(''); // invoiceNo
    
    // Auth Loader
    useEffect(() => {
        (async () => {
            try {
                const { data } = await supabase.from('operator_settings').select('key, value').eq('operator_id', user.username).in('key', ['eta_client_id', 'eta_client_sec', 'eta_client_sec2']);
                if (data && data.length > 0) {
                    const map: Record<string, string> = Object.fromEntries(data.map(r => [r.key, r.value]));
                    if (map.eta_client_id) setEtaClientId(map.eta_client_id);
                    if (map.eta_client_sec) setEtaClientSec(map.eta_client_sec);
                    if (map.eta_client_sec2) setEtaClientSec2(map.eta_client_sec2);
                }
            } catch { /* ignore */ }
        })();
    }, [user.username]);

    // Data Fetching
    const fetchReconciliationData = async () => {
        setLoading(true);
        try {
            // 1. Fetch Internal using existing abstraction
            const { loadInvoices: loadInvoicesRemote } = await import('../services/collectionsStorage');
            const internalData = await loadInvoicesRemote();
            
            const filteredInternal = internalData.filter(i => {
                if (dateFrom && i.invoiceDate < dateFrom) return false;
                if (dateTo && i.invoiceDate > dateTo) return false;
                return true;
            });
            
            // 2. Fetch ETA
            let etaDocs: ETAInvoice[] = [];
            if (etaClientId && etaClientSec) {
                const call = (secret: string) => fetch('/api/eta-document', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'list-sent', issueDateFrom: dateFrom + 'T00:00:00', issueDateTo: dateTo + 'T23:59:59', clientId: etaClientId, clientSecret: secret })
                }).then(r => r.json());
                
                let etaRes = await call(etaClientSec);
                if (!etaRes.ok && etaClientSec2 && (etaRes.error ?? '').toLowerCase().includes('auth')) {
                    etaRes = await call(etaClientSec2);
                }
                if (etaRes.ok) {
                    etaDocs = (etaRes.invoices || []).map((i: any) => ({
                        ...i,
                        status: i.status || 'Submitted/Exported' // ETA list API doesn't always return full status
                    }));
                }
            }
            
            setInternalInvoices(filteredInternal || []);
            setEtaInvoices(etaDocs);
            
        } catch (err: any) {
            console.error(err);
            alert('Failed to fetch data for reconciliation: ' + (err.message || String(err)));
        } finally {
            setLoading(false);
        }
    };

    // Reconciliation Logic
    const reconciliationRows = useMemo(() => {
        const rows: ReconRow[] = [];
        
        const normalizeInv = (s: string) => (s || '').replace(/\s+/g, '').replace(/^0+/, '').toLowerCase();
        
        // Map ETA by internalId
        const etaMap = new Map<string, ETAInvoice[]>();
        etaInvoices.forEach(eta => {
            const key = normalizeInv(eta.internalId);
            const arr = etaMap.get(key) || [];
            arr.push(eta);
            etaMap.set(key, arr);
        });

        // Map Internal by invoiceNo
        const intMap = new Map<string, InternalInvoice>();
        internalInvoices.forEach(inv => intMap.set(normalizeInv(inv.invoiceNo), inv));

        // Process Internal Invoices
        internalInvoices.forEach(intInv => {
            const key = normalizeInv(intInv.invoiceNo);
            const etas = etaMap.get(key) || [];
            
            if (etas.length === 0) {
                rows.push({
                    invoiceNo: intInv.invoiceNo,
                    etaUuid: '',
                    invoiceDate: intInv.invoiceDate,
                    customer: intInv.customer,
                    internalAmount: intInv.total,
                    etaAmount: 0,
                    variance: intInv.total,
                    submissionStatus: 'Not Submitted',
                    reconciliationStatus: 'Missing from E-Invoice',
                    collectionStatus: intInv.collectionStatus,
                    submissionDate: '',
                    internalPdfData: intInv.pdfData,
                    internalPdfName: intInv.pdfName
                });
            } else {
                etas.forEach((eta, idx) => {
                    const variance = Math.abs(intInv.total - eta.total);
                    rows.push({
                        invoiceNo: intInv.invoiceNo,
                        etaUuid: eta.uuid,
                        invoiceDate: intInv.invoiceDate,
                        customer: intInv.customer,
                        internalAmount: intInv.total,
                        etaAmount: eta.total,
                        variance: variance,
                        submissionStatus: eta.status,
                        reconciliationStatus: etas.length > 1 ? 'Duplicate Invoice' : (variance > 1 ? 'Amount Mismatch' : 'Matched'),
                        collectionStatus: intInv.collectionStatus,
                        submissionDate: eta.dateTimeIssued,
                        internalPdfData: intInv.pdfData,
                        internalPdfName: intInv.pdfName
                    });
                });
            }
        });

        // Process ETA Invoices missing internally
        etaInvoices.forEach(eta => {
            const key = normalizeInv(eta.internalId);
            if (!intMap.has(key)) {
                rows.push({
                    invoiceNo: eta.internalId,
                    etaUuid: eta.uuid,
                    invoiceDate: eta.dateTimeIssued.slice(0, 10),
                    customer: eta.receiverName,
                    internalAmount: 0,
                    etaAmount: eta.total,
                    variance: eta.total,
                    submissionStatus: eta.status,
                    reconciliationStatus: 'Missing from Internal System',
                    collectionStatus: 'Unknown',
                    submissionDate: eta.dateTimeIssued
                });
            }
        });

        return rows.sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate));
    }, [internalInvoices, etaInvoices]);

    // Apply Filters
    const filteredRows = useMemo(() => {
        return reconciliationRows.filter(r => {
            if (filterInvNo && !r.invoiceNo.toLowerCase().includes(filterInvNo.toLowerCase())) return false;
            if (filterCustomer && !r.customer.toLowerCase().includes(filterCustomer.toLowerCase())) return false;
            if (filterInvStatus !== 'all' && r.submissionStatus !== filterInvStatus) return false;
            if (filterReconStatus !== 'all' && r.reconciliationStatus !== filterReconStatus) return false;
            return true;
        });
    }, [reconciliationRows, filterInvNo, filterCustomer, filterInvStatus, filterReconStatus]);

    // Summary Stats
    const stats = useMemo(() => {
        const s = {
            totalInternal: internalInvoices.length,
            totalETA: etaInvoices.length,
            matched: 0,
            missingETA: 0,
            missingInternal: 0,
            discrepancies: 0,
            fullyCollected: 0,
            outstandingAmount: 0
        };
        filteredRows.forEach(r => {
            if (r.reconciliationStatus === 'Matched') s.matched++;
            else if (r.reconciliationStatus === 'Missing from E-Invoice') s.missingETA++;
            else if (r.reconciliationStatus === 'Missing from Internal System') s.missingInternal++;
            else s.discrepancies++;

            if (r.collectionStatus === 'Paid') s.fullyCollected++;
            if (r.collectionStatus !== 'Paid' && r.internalAmount > 0) s.outstandingAmount += r.internalAmount;
        });
        return s;
    }, [filteredRows, internalInvoices, etaInvoices]);

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    // Fetches the ETA printout for a UUID. Falls back to the secondary secret only
    // on auth failures, and retries transient errors (throttling / 5xx / network)
    // with backoff. Throws with the real ETA error instead of silently giving up.
    const fetchEtaPdf = async (uuid: string): Promise<Blob> => {
        const call = async (secret: string) => {
            const r = await fetch('/api/eta-document', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'pdf', uuid, clientId: etaClientId, clientSecret: secret })
            });
            const json = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
            return json as { ok?: boolean; pdf?: string; error?: string };
        };

        let lastError = 'Unknown error';
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                let res = await call(etaClientSec);
                if (!res.ok && etaClientSec2 && (res.error ?? '').toLowerCase().includes('auth')) {
                    res = await call(etaClientSec2);
                }
                if (res.ok && res.pdf) {
                    const bytes = atob(res.pdf);
                    const arr = new Uint8Array(bytes.length);
                    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
                    return new Blob([arr], { type: 'application/pdf' });
                }
                lastError = res.error || 'ETA returned an empty PDF';
                // Auth and not-found errors won't fix themselves on retry
                if (/auth failed|\(40[0134]\)/i.test(lastError)) break;
            } catch (e: any) {
                lastError = e?.message || String(e);
            }
            if (attempt < 3) await sleep(2000 * attempt);
        }
        throw new Error(lastError);
    };

    const pdfFromDataUrl = (dataUrl: string): Blob | null => {
        const parts = dataUrl.split(',');
        if (parts.length !== 2) return null;
        const bytes = atob(parts[1]);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        return new Blob([arr], { type: 'application/pdf' });
    };

    const handleViewPdf = async (row: ReconRow) => {
        setPdfLoading(row.invoiceNo);
        let etaError = '';
        try {
            // Priority 1: ETA PDF
            if (row.etaUuid && etaClientId && etaClientSec) {
                try {
                    const blob = await fetchEtaPdf(row.etaUuid);
                    setPreviewPdfUrl(URL.createObjectURL(blob));
                    setPreviewPdfName(`ETA_${row.invoiceNo}.pdf`);
                    return;
                } catch (e: any) {
                    etaError = e?.message || String(e);
                }
            }

            // Priority 2: Internal PDF
            if (row.internalPdfData) {
                setPreviewPdfUrl(row.internalPdfData);
                setPreviewPdfName(row.internalPdfName || `Internal_${row.invoiceNo}.pdf`);
                return;
            }

            alert(etaError ? 'تعذر جلب ملف PDF من منظومة الفاتورة الإلكترونية: ' + etaError : 'ملف PDF غير متاح لهذه الفاتورة.');
        } finally {
            setPdfLoading('');
        }
    };

    const getRowPdfBlob = async (row: ReconRow): Promise<{ blob: Blob, name: string }> => {
        const safeNo = row.invoiceNo.replace(/[^a-zA-Z0-9_-]/g, '_');
        let etaError = '';
        if (row.etaUuid && etaClientId && etaClientSec) {
            try {
                return { blob: await fetchEtaPdf(row.etaUuid), name: `ETA_${safeNo}.pdf` };
            } catch (e: any) {
                etaError = e?.message || String(e);
            }
        }
        if (row.internalPdfData) {
            const blob = pdfFromDataUrl(row.internalPdfData);
            if (blob) return { blob, name: `Internal_${safeNo}.pdf` };
        }
        if (etaError) throw new Error(etaError);
        throw new Error(row.etaUuid ? 'ملف PDF غير متاح' : 'غير مسجلة على منظومة الفاتورة الإلكترونية ولا يوجد ملف داخلي');
    };

    const executeExport = async () => {
        setExportProgress({ total: filteredRows.length, current: 0, status: 'تجهيز التقرير...', retrieved: 0, failed: 0, failedList: [] });
        
        let reportBlob: Blob | null = null;
        let reportName = `Reconciliation_${new Date().toISOString().slice(0, 10)}`;

        const reportData = filteredRows.map(r => ({
            'Invoice Number': r.invoiceNo,
            'E-Invoice UUID': r.etaUuid,
            'Date': r.invoiceDate,
            'Customer': r.customer,
            'Internal Amount': r.internalAmount,
            'ETA Amount': r.etaAmount,
            'Variance': r.variance,
            'ETA Status': r.submissionStatus,
            'Recon Status': r.reconciliationStatus,
            'Collection Status': r.collectionStatus
        }));

        if (exportFormat === 'excel') {
            const ws = XLSX.utils.json_to_sheet(reportData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Reconciliation');
            const ab = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            reportBlob = new Blob([ab], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            reportName += '.xlsx';
        } else if (exportFormat === 'csv') {
            const ws = XLSX.utils.json_to_sheet(reportData);
            const csv = XLSX.utils.sheet_to_csv(ws);
            reportBlob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8' });
            reportName += '.csv';
        } else if (exportFormat === 'pdf') {
            const doc = new jsPDF({ orientation: 'landscape' });
            doc.addFont('https://fonts.gstatic.com/s/cairo/v20/SLXWc1nY6Hkvalvtsw.woff2', 'Cairo', 'normal');
            doc.setFont('Cairo');
            doc.text('System Audit Report - E-Invoice Reconciliation', 14, 15);
            autoTable(doc, {
                head: [['Invoice No', 'Date', 'Customer', 'Internal Amt', 'ETA Amt', 'Variance', 'Recon Status']],
                body: filteredRows.map(r => [
                    r.invoiceNo, r.invoiceDate, r.customer, r.internalAmount.toString(), r.etaAmount.toString(), r.variance.toString(), r.reconciliationStatus
                ]),
                startY: 20,
            });
            reportBlob = new Blob([doc.output('arraybuffer')], { type: 'application/pdf' });
            reportName += '.pdf';
        }

        if (!includePdfs) {
            saveAs(reportBlob!, reportName);
            setExportProgress(null);
            setExportModalOpen(false);
            return;
        }

        // Include PDFs via ZIP
        const zip = new JSZip();
        zip.file(reportName, reportBlob!);
        
        let manifest = "INVOICE_NO\tETA_UUID\tCUSTOMER\tRECON_STATUS\tPDF_STATUS\tFILENAME_OR_ERROR\n";
        let retrieved = 0;
        let failed = 0;
        let failedList: { id: string, reason: string }[] = [];

        for (let i = 0; i < filteredRows.length; i++) {
            const r = filteredRows[i];
            setExportProgress({ total: filteredRows.length, current: i + 1, status: `جلب PDF لفاتورة ${r.invoiceNo}...`, retrieved, failed, failedList });
            
            try {
                const pdfData = await getRowPdfBlob(r);
                zip.file(`invoices/${pdfData.name}`, pdfData.blob);
                manifest += `${r.invoiceNo}\t${r.etaUuid}\t${r.customer}\t${r.reconciliationStatus}\tSUCCESS\t${pdfData.name}\n`;
                retrieved++;
            } catch (err: any) {
                const reason = err?.message || 'خطأ أثناء الجلب';
                manifest += `${r.invoiceNo}\t${r.etaUuid}\t${r.customer}\t${r.reconciliationStatus}\tERROR\t${reason.replace(/\s+/g, ' ')}\n`;
                failed++;
                failedList.push({ id: r.invoiceNo, reason });
            }
            // Pace ETA requests to stay under its rate limit
            if (r.etaUuid && i < filteredRows.length - 1) await sleep(1000);
        }
        
        zip.file('manifest.txt', manifest);
        
        setExportProgress(prev => prev ? { ...prev, status: 'تجميع الملف المضغوط...' } : null);
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        saveAs(zipBlob, `Export_${new Date().toISOString().slice(0, 10)}.zip`);
        
        setExportProgress(null);
        setExportModalOpen(false);
    };

    const statusColor = (status: string) => {
        switch (status) {
            case 'Matched': return 'bg-green-100 text-green-800';
            case 'Missing from E-Invoice': return 'bg-orange-100 text-orange-800';
            case 'Missing from Internal System': return 'bg-purple-100 text-purple-800';
            case 'Amount Mismatch': return 'bg-red-100 text-red-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    return (
        <div className="space-y-6">
            {/* Filters */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-wrap gap-4 items-end">
                <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">من تاريخ</label>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm" />
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">إلى تاريخ</label>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm" />
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">رقم الفاتورة</label>
                    <input type="text" value={filterInvNo} onChange={e => setFilterInvNo(e.target.value)} placeholder="بحث..." className="border rounded-lg px-3 py-1.5 text-sm" />
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">العميل</label>
                    <input type="text" value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)} placeholder="بحث..." className="border rounded-lg px-3 py-1.5 text-sm" />
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">حالة المطابقة</label>
                    <select value={filterReconStatus} onChange={e => setFilterReconStatus(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm bg-white">
                        <option value="all">الكل</option>
                        <option value="Matched">مطابق</option>
                        <option value="Missing from E-Invoice">مفقود في ETA</option>
                        <option value="Missing from Internal System">مفقود في النظام الداخلي</option>
                        <option value="Amount Mismatch">فرق في القيمة</option>
                    </select>
                </div>
                <button onClick={fetchReconciliationData} disabled={loading} className="bg-primary text-white px-4 py-1.5 rounded-lg text-sm font-bold shadow hover:bg-blue-700 disabled:opacity-50">
                    {loading ? 'جاري التحميل...' : 'تشغيل التقرير'}
                </button>
                <button onClick={() => setExportModalOpen(true)} className="bg-green-600 text-white px-4 py-1.5 rounded-lg text-sm font-bold shadow hover:bg-green-700 ml-auto flex items-center gap-1">
                    <span className="material-icons text-sm">download</span> تصدير التقرير
                </button>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm text-center">
                    <h3 className="text-gray-500 text-xs font-bold mb-1">إجمالي الفواتير (داخلي / ETA)</h3>
                    <p className="text-xl font-bold text-gray-800">{stats.totalInternal} / {stats.totalETA}</p>
                </div>
                <div className="bg-green-50 p-4 rounded-xl border border-green-100 shadow-sm text-center">
                    <h3 className="text-green-700 text-xs font-bold mb-1">مطابق تماماً</h3>
                    <p className="text-xl font-bold text-green-800">{stats.matched}</p>
                </div>
                <div className="bg-red-50 p-4 rounded-xl border border-red-100 shadow-sm text-center">
                    <h3 className="text-red-700 text-xs font-bold mb-1">اختلافات / فروقات</h3>
                    <p className="text-xl font-bold text-red-800">{stats.discrepancies}</p>
                </div>
                <div className="bg-orange-50 p-4 rounded-xl border border-orange-100 shadow-sm text-center">
                    <h3 className="text-orange-700 text-xs font-bold mb-1">مفقود في بوابة الضرائب</h3>
                    <p className="text-xl font-bold text-orange-800">{stats.missingETA}</p>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-right text-sm">
                        <thead className="bg-gray-50 border-b border-gray-100 text-gray-600 font-bold">
                            <tr>
                                <th className="p-3">رقم الفاتورة</th>
                                <th className="p-3">العميل</th>
                                <th className="p-3">التاريخ</th>
                                <th className="p-3">المبلغ الداخلي</th>
                                <th className="p-3">مبلغ ETA</th>
                                <th className="p-3">الفرق</th>
                                <th className="p-3">حالة المطابقة</th>
                                <th className="p-3">حالة التحصيل</th>
                                <th className="p-3 text-center">PDF</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredRows.length === 0 ? (
                                <tr><td colSpan={8} className="p-8 text-center text-gray-400">لا توجد بيانات للعرض</td></tr>
                            ) : filteredRows.map((r, i) => (
                                <tr key={i} className="hover:bg-gray-50">
                                    <td className="p-3 font-mono text-xs">{r.invoiceNo}
                                      {r.etaUuid && <div className="text-[10px] text-gray-400 mt-1">{r.etaUuid.slice(0,18)}...</div>}
                                    </td>
                                    <td className="p-3 font-bold text-gray-700">{r.customer}</td>
                                    <td className="p-3 text-gray-600">{r.invoiceDate}</td>
                                    <td className="p-3 text-blue-600 font-bold">{r.internalAmount.toLocaleString('en-US')}</td>
                                    <td className="p-3 text-indigo-600 font-bold">{r.etaAmount.toLocaleString('en-US')}</td>
                                    <td className={`p-3 font-bold ${r.variance > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                                        {r.variance.toLocaleString('en-US')}
                                    </td>
                                    <td className="p-3">
                                        <span className={`px-2 py-1 rounded text-xs font-bold ${statusColor(r.reconciliationStatus)}`}>
                                            {r.reconciliationStatus}
                                        </span>
                                    </td>
                                    <td className="p-3">
                                        <span className="px-2 py-1 rounded bg-gray-100 text-gray-600 text-xs">
                                            {r.collectionStatus}
                                        </span>
                                    </td>
                                    <td className="p-3 text-center">
                                        <button 
                                            onClick={() => handleViewPdf(r)}
                                            disabled={pdfLoading === r.invoiceNo}
                                            className="text-gray-500 hover:text-red-500 transition-colors disabled:opacity-50"
                                            title="عرض ملف PDF"
                                        >
                                            {pdfLoading === r.invoiceNo ? (
                                                <span className="material-icons animate-spin text-sm">refresh</span>
                                            ) : (
                                                <span className="material-icons text-sm">picture_as_pdf</span>
                                            )}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* PDF Preview Modal */}
            {previewPdfUrl && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl w-full max-w-4xl h-[90vh] flex flex-col shadow-2xl overflow-hidden">
                        <div className="p-4 border-b flex items-center justify-between bg-gray-50">
                            <div className="flex items-center gap-2 text-gray-700">
                                <span className="material-icons text-red-500">picture_as_pdf</span>
                                <h3 className="font-bold">{previewPdfName}</h3>
                            </div>
                            <div className="flex items-center gap-2">
                                <a href={previewPdfUrl} download={previewPdfName} className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors flex items-center" title="تنزيل">
                                    <span className="material-icons">download</span>
                                </a>
                                <button onClick={() => setPreviewPdfUrl(null)} className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors flex items-center" title="إغلاق">
                                    <span className="material-icons">close</span>
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 bg-gray-100 p-4">
                            <iframe src={previewPdfUrl} className="w-full h-full rounded-xl border border-gray-200 shadow-inner" title="PDF Preview"></iframe>
                        </div>
                    </div>
                </div>
            )}

            {/* Export Modal */}
            {exportModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl">
                        <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                            <span className="material-icons text-primary">download</span> تصدير التقرير
                        </h3>
                        
                        <div className="space-y-4 mb-6">
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">تنسيق التقرير</label>
                                <div className="grid grid-cols-3 gap-2">
                                    <button 
                                        onClick={() => setExportFormat('excel')}
                                        className={`py-2 px-3 rounded-lg text-sm font-bold flex flex-col items-center gap-1 border-2 transition-all ${exportFormat === 'excel' ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 hover:border-gray-300 text-gray-600'}`}
                                    >
                                        <span className="material-icons">table_view</span> Excel
                                    </button>
                                    <button 
                                        onClick={() => setExportFormat('csv')}
                                        className={`py-2 px-3 rounded-lg text-sm font-bold flex flex-col items-center gap-1 border-2 transition-all ${exportFormat === 'csv' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-gray-300 text-gray-600'}`}
                                    >
                                        <span className="material-icons">list_alt</span> CSV
                                    </button>
                                    <button 
                                        onClick={() => setExportFormat('pdf')}
                                        className={`py-2 px-3 rounded-lg text-sm font-bold flex flex-col items-center gap-1 border-2 transition-all ${exportFormat === 'pdf' ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-200 hover:border-gray-300 text-gray-600'}`}
                                    >
                                        <span className="material-icons">picture_as_pdf</span> PDF
                                    </button>
                                </div>
                            </div>
                            
                            <div className="border-t pt-4">
                                <label className="flex items-start gap-3 cursor-pointer group p-3 border rounded-xl hover:bg-gray-50 transition-colors">
                                    <div className="pt-0.5">
                                        <input 
                                            type="checkbox" 
                                            checked={includePdfs}
                                            onChange={e => setIncludePdfs(e.target.checked)}
                                            className="w-4 h-4 text-primary rounded border-gray-300 focus:ring-primary"
                                        />
                                    </div>
                                    <div>
                                        <div className="font-bold text-gray-800 text-sm group-hover:text-primary transition-colors">تضمين ملفات PDF للفواتير في التصدير</div>
                                        <div className="text-xs text-gray-500 mt-1">سيتم تجميع التقرير مع ملفات PDF المتاحة في ملف ZIP. قد يستغرق هذا وقتاً أطول.</div>
                                    </div>
                                </label>
                            </div>
                        </div>

                        {exportProgress ? (
                            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-4">
                                <div className="text-sm font-bold text-blue-800 mb-2">{exportProgress.status}</div>
                                <div className="w-full bg-blue-200 rounded-full h-2.5 mb-2">
                                    <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${(exportProgress.current / exportProgress.total) * 100}%` }}></div>
                                </div>
                                <div className="flex justify-between text-xs text-blue-600 font-bold">
                                    <span>{exportProgress.current} / {exportProgress.total}</span>
                                    <span>{Math.round((exportProgress.current / exportProgress.total) * 100)}%</span>
                                </div>
                                {exportProgress.failed > 0 && (
                                    <div className="mt-3 bg-white/50 rounded-lg p-3 border border-red-100">
                                        <div className="text-xs text-red-600 font-bold flex items-center gap-1 mb-2">
                                            <span className="material-icons text-[14px]">warning</span> فشل جلب {exportProgress.failed} ملف
                                        </div>
                                        <div className="max-h-32 overflow-y-auto text-[10px] text-gray-600 font-mono space-y-1 pr-1" dir="ltr">
                                            {exportProgress.failedList?.map((inv, idx) => (
                                                <div key={`${inv.id}-${idx}`} className="bg-white px-2 py-1.5 rounded shadow-sm border border-gray-100 flex items-center justify-between gap-4">
                                                    <span className="font-bold text-gray-700">{inv.id}</span>
                                                    <span className="text-red-500 font-sans truncate text-right" dir="rtl">{inv.reason}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex justify-end gap-3 mt-6">
                                <button onClick={() => setExportModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-bold transition-colors">
                                    إلغاء
                                </button>
                                <button onClick={executeExport} className="px-6 py-2 bg-primary text-white rounded-lg text-sm font-bold shadow-sm hover:bg-blue-700 transition-colors flex items-center gap-2">
                                    <span className="material-icons text-sm">download</span> بدء التصدير ({filteredRows.length})
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
