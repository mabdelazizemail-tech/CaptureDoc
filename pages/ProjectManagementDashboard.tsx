import React, { useState, useEffect, useMemo } from 'react';
import { User } from '../services/types';
import { supabase } from '../services/supabaseClient';
import { PMStorageService, PMProject, SiteLog, InventoryTracking, Expense, Timesheet } from '../services/pmStorage';
import Tesseract from 'tesseract.js';
import * as pdfjs from 'pdfjs-dist';
import Toast from '../components/Toast';

// @ts-ignore - Vite asset import
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;



declare const Chart: any;

interface PMDashboardProps { user: User; }

interface ProjectFinancials {
    project: PMProject;
    revenue: number;
    actualVolume: number;
    plannedVolume: number;
    achievementPct: number;
    directCost: number;   // expenses
    salaryCost: number;   // payroll net salaries
    ticketCost: number;   // tech tickets
    totalCost: number;
    grossProfit: number;
    grossMargin: number;
    costPerUnit: number;
    revenuePerUnit: number;
    backlogVolume: number;
}

const fmt = (n: number, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n: number) => `${n.toFixed(1)}%`;

const KpiCard: React.FC<{ title: string; value: string; sub?: string; color: string; icon: string }> =
    ({ title, value, sub, color, icon }) => (
        <div className={`bg-gradient-to-br ${color} p-5 rounded-xl border border-white/60 shadow-sm flex justify-between items-center group`}>
            <div>
                <div className="text-gray-600 text-xs font-semibold uppercase tracking-wide mb-1">{title}</div>
                <div className="text-2xl font-bold text-gray-900 group-hover:scale-105 transition-transform">{value}</div>
                {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
            </div>
            <span className="material-icons text-4xl opacity-20">{icon}</span>
        </div>
    );

const ProjectManagementDashboard: React.FC<PMDashboardProps> = ({ user }) => {
    const [projects, setProjects] = useState<PMProject[]>([]);
    const [currentProject, setCurrentProject] = useState<PMProject | null>(null);

    const [siteLogs, setSiteLogs] = useState<SiteLog[]>([]);
    const [inventory, setInventory] = useState<InventoryTracking[]>([]);
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
    const [actualMonthlyAchieved, setActualMonthlyAchieved] = useState<number>(0);
    const [projectFinancials, setProjectFinancials] = useState<ProjectFinancials[]>([]);

    const [loading, setLoading] = useState(false);
    const [tab, setTab] = useState<'executive' | 'overview' | 'logs' | 'inventory' | 'timesheets' | 'expenses'>('executive');
    const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7));

    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
    const [expenseForm, setExpenseForm] = useState({
        amount: '',
        category: 'transportation',
        description: '',
        expense_date: new Date().toISOString().split('T')[0]
    });
    const [savingExpense, setSavingExpense] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [showExpenseModal, setShowExpenseModal] = useState(false);
    const [showManagementMenu, setShowManagementMenu] = useState(false);

    // Monthly Volume Input State
    const [showVolumeModal, setShowVolumeModal] = useState(false);
    const [volumeInput, setVolumeInput] = useState('');
    const [savingVolume, setSavingVolume] = useState(false);

    const isAdmin = user.role === 'super_admin' || user.role === 'power_admin' || user.role === 'project_manager' || user.role === 'it_specialist';





    const chartRef = React.useRef<HTMLCanvasElement>(null);
    const chartInstance = React.useRef<any>(null);
    const gpChartRef = React.useRef<HTMLCanvasElement>(null);
    const gpChartInstance = React.useRef<any>(null);

    const totalContractVolume = currentProject?.contract_total_volume || 0;

    const startDate = currentProject?.start_date ? new Date(currentProject.start_date) : null;
    const endDate = currentProject?.end_date ? new Date(currentProject.end_date) : null;
    const targetDaily = useMemo(() => {
        if (!startDate || !endDate || totalContractVolume === 0) return 0;
        const days = (endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24);
        return days > 0 ? Math.ceil(totalContractVolume / days) : 0;
    }, [startDate, endDate, totalContractVolume]);

    useEffect(() => { loadProjects(); }, [user]);

    useEffect(() => {
        if (tab === 'overview' && siteLogs.length > 0) {
            setTimeout(() => {
                if (!chartRef.current) return;
                if (chartInstance.current) chartInstance.current.destroy();
                const ctx = chartRef.current.getContext('2d');
                const reversedLogs = [...siteLogs].slice(0, 14).reverse();
                chartInstance.current = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: reversedLogs.map(l => l.log_date),
                        datasets: [
                            { label: 'حجم الفهرسة', data: reversedLogs.map(l => l.index_volume), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.15)', fill: true, tension: 0.3 },
                            { label: 'المستهدف اليومي', data: Array(reversedLogs.length).fill(targetDaily), borderColor: '#10b981', borderDash: [5, 5], tension: 0, pointRadius: 0 }
                        ]
                    },
                    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
                });
            }, 100);
        }
        if (tab === 'executive' && projectFinancials.length > 0) {
            setTimeout(() => {
                if (!gpChartRef.current) return;
                if (gpChartInstance.current) gpChartInstance.current.destroy();
                const ctx = gpChartRef.current.getContext('2d');
                const labels = projectFinancials.map(f => f.project.name);
                gpChartInstance.current = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels,
                        datasets: [
                            { label: 'الإيراد', data: projectFinancials.map(f => f.revenue), backgroundColor: 'rgba(59,130,246,0.7)' },
                            { label: 'التكلفة الإجمالية', data: projectFinancials.map(f => f.totalCost), backgroundColor: 'rgba(239,68,68,0.6)' },
                            { label: 'Gross Profit', data: projectFinancials.map(f => f.grossProfit), backgroundColor: 'rgba(16,185,129,0.7)' }
                        ]
                    },
                    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } }, plugins: { legend: { position: 'top' } } }
                });
            }, 100);
        }
        return () => {
            if (chartInstance.current) { chartInstance.current.destroy(); chartInstance.current = null; }
            if (gpChartInstance.current) { gpChartInstance.current.destroy(); gpChartInstance.current = null; }
        };
    }, [tab, siteLogs, targetDaily, projectFinancials]);

    useEffect(() => {
        if (currentProject) loadProjectData(currentProject.id);
        else if (projects.length > 0) loadAllProjectsData();
    }, [currentProject, selectedMonth]);

    const loadProjects = async () => {
        setLoading(true);
        const projs = await PMStorageService.getProjects();
        // Filter out Storage/المخزن project which is used for asset management
        const filtered = projs.filter(p => !p.name.includes('Storage') && !p.name.includes('المخزن'));
        setProjects(filtered);
        if (filtered.length > 0) setCurrentProject(filtered[0]);
        setLoading(false);
    };

    // Fetch net salary cost for a project from hr_payroll
    const fetchPayrollCost = async (projectId: string): Promise<number> => {
        // Get hrproject name to match employees
        const { data: proj } = await supabase.from('projects').select('name').eq('id', projectId).single();
        if (!proj) return 0;
        const { data: empData } = await supabase.from('hr_employees')
            .select('id').or(`project.eq.${proj.name},project.eq.${projectId}`).eq('status', 'active');
        if (!empData || empData.length === 0) return 0;
        const empIds = empData.map(e => e.id);
        const { data: payroll } = await supabase.from('hr_payroll')
            .select('net_salary').eq('month', selectedMonth).in('employee_id', empIds);
        return payroll?.reduce((s, r) => s + parseFloat(r.net_salary || '0'), 0) || 0;
    };

    const buildProjectFinancials = async (
        proj: PMProject,
        logsData: SiteLog[],
        expData: Expense[], // This should be clean expenses
        ticketExps: Expense[], // Separate tickets
        kpiVol: number,
        invData: InventoryTracking[]
    ): Promise<ProjectFinancials> => {
        const salaryCost = await fetchPayrollCost(proj.id);
        const directCost = expData.reduce((s, e) => s + Number(e.amount), 0);
        const ticketCost = ticketExps.reduce((s, t) => s + Number(t.amount), 0);
        const totalCost = salaryCost + directCost + ticketCost;
        const revenue = kpiVol * (proj.click_charge || 0);
        const actualVolume = kpiVol;
        const plannedVolume = proj.contract_monthly_volume || 0;
        const achievementPct = plannedVolume > 0 ? (actualVolume / plannedVolume) * 100 : 0;
        const grossProfit = revenue - totalCost;
        const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
        const costPerUnit = actualVolume > 0 ? totalCost / actualVolume : 0;
        const revenuePerUnit = proj.click_charge || 0;
        // Backlog: inventory total - processed
        const backlogVolume = invData.reduce((s, i) => s + Math.max(0, i.total_volume - i.processed_volume), 0);
        return { project: proj, revenue, actualVolume, plannedVolume, achievementPct, directCost, salaryCost, ticketCost, totalCost, grossProfit, grossMargin, costPerUnit, revenuePerUnit, backlogVolume };
    };

    const loadProjectData = async (projectId: string) => {
        setLoading(true);
        const [logsData, invData, expData, sheetData, kpiVol, ticketExps] = await Promise.all([
            PMStorageService.getSiteLogs(projectId),
            PMStorageService.getInventory(projectId),
            PMStorageService.getExpenses(projectId),
            PMStorageService.getTimesheets(projectId),
            PMStorageService.getProjectKPIVolume(projectId, selectedMonth),
            PMStorageService.getTicketExpenses(projectId, selectedMonth)
        ]);
        const filterByMonth = (date: string) => date && date.startsWith(selectedMonth);
        const filteredLogs = logsData.filter(l => filterByMonth(l.log_date));
        const cleanExpenses = expData.filter(e => filterByMonth(e.expense_date));

        setSiteLogs(filteredLogs);
        setInventory(invData);
        setExpenses([...cleanExpenses, ...ticketExps]); // For list display
        setTimesheets(sheetData.filter(s => filterByMonth(s.work_date)));
        setActualMonthlyAchieved(kpiVol);

        const proj = projects.find(p => p.id === projectId);
        if (proj) {
            const fin = await buildProjectFinancials(proj, filteredLogs, cleanExpenses, ticketExps, kpiVol, invData);
            setProjectFinancials([fin]);
        }
        setLoading(false);
    };

    const loadAllProjectsData = async () => {
        setLoading(true);
        const filterByMonth = (date: string) => date && date.startsWith(selectedMonth);
        const results = await Promise.all(
            projects.map(p => Promise.all([
                PMStorageService.getSiteLogs(p.id),
                PMStorageService.getInventory(p.id),
                PMStorageService.getExpenses(p.id),
                PMStorageService.getTimesheets(p.id),
                PMStorageService.getProjectKPIVolume(p.id, selectedMonth),
                PMStorageService.getTicketExpenses(p.id, selectedMonth)
            ]))
        );
        const allLogs = results.flatMap(r => r[0] as SiteLog[]).filter(l => filterByMonth(l.log_date));
        const allInv = results.flatMap(r => r[1] as InventoryTracking[]);
        const allCleanExp = results.flatMap(r => r[2] as Expense[]).filter(e => filterByMonth(e.expense_date));
        const allTicketExps = results.flatMap(r => r[5] as Expense[]);
        const allSheets = results.flatMap(r => r[3] as Timesheet[]).filter(s => filterByMonth(s.work_date));
        const totalKpi = results.reduce((sum, r) => sum + (r[4] as number), 0);

        setSiteLogs(allLogs);
        setInventory(allInv);
        setExpenses([...allCleanExp, ...allTicketExps]);
        setTimesheets(allSheets);
        setActualMonthlyAchieved(totalKpi);

        const fins = await Promise.all(projects.map((p, i) => {
            const projCleanExp = (results[i][2] as Expense[]).filter(e => filterByMonth(e.expense_date));
            const projTicketExp = results[i][5] as Expense[];
            return buildProjectFinancials(
                p,
                (results[i][0] as SiteLog[]).filter(l => filterByMonth(l.log_date)),
                projCleanExp,
                projTicketExp,
                results[i][4] as number,
                (results[i][1] as InventoryTracking[])
            );
        }));
        setProjectFinancials(fins);
        setLoading(false);
    };

    const handleSaveVolume = async () => {
        if (!currentProject) {
            setToast({ message: 'يرجى اختيار مشروع أولاً', type: 'error' });
            return;
        }
        const vol = parseInt(volumeInput);
        if (isNaN(vol) || vol < 0) {
            setToast({ message: 'يرجى إدخال رقم صحيح', type: 'error' });
            return;
        }
        setSavingVolume(true);
        const result = await PMStorageService.upsertProjectKPIVolume(currentProject.id, selectedMonth, vol);
        if (result.success) {
            setToast({ message: `تم حفظ الحجم المنجز (${vol.toLocaleString()}) بنجاح`, type: 'success' });
            setShowVolumeModal(false);
            setVolumeInput('');
            loadProjectData(currentProject.id);
        } else {
            setToast({ message: `فشل الحفظ: ${result.error}`, type: 'error' });
        }
        setSavingVolume(false);
    };

    const handleAddExpense = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentProject) {
            setToast({ message: 'يرجى اختيار مشروع أولاً', type: 'error' });
            return;
        }
        if (!expenseForm.amount || parseFloat(expenseForm.amount) <= 0) {
            setToast({ message: 'يرجى إدخال مبلغ صحيح', type: 'error' });
            return;
        }

        setSavingExpense(true);
        try {
            const expenseData = {
                project_id: currentProject.id,
                amount: parseFloat(expenseForm.amount),
                category: expenseForm.category,
                description: (expenseForm.description || CATEGORY_LABELS[expenseForm.category]).substring(0, 255),
                expense_date: expenseForm.expense_date
            };
            console.log('Saving expense:', expenseData);
            const result = await PMStorageService.addExpense(expenseData);

            if (result.success) {
                setToast({ message: 'تم إضافة المصروف بنجاح', type: 'success' });
                setExpenseForm({
                    ...expenseForm,
                    amount: '',
                    description: ''
                });
                setShowExpenseModal(false);
                loadProjectData(currentProject.id);
            } else {
                console.error('DB Error:', result.error);
                setToast({ message: `فشل: ${result.error || 'خطأ غير معروف'}`, type: 'error' });
            }
        } catch (err: any) {
            console.error('Expense save error:', err);
            setToast({ message: `خطأ: ${err?.message || 'فشل في إضافة المصروف'}`, type: 'error' });
        }

        setSavingExpense(false);
    };


    const convertPdfToImage = async (file: File): Promise<HTMLCanvasElement> => {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1); // Usually invoices are on the first page

        const viewport = page.getViewport({ scale: 2.5 }); // Higher scale for better OCR accuracy
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        if (!context) throw new Error('Could not get canvas context');

        await page.render({ canvas, canvasContext: context, viewport }).promise;
        return canvas;
    };

    const handleInvoiceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setAnalyzing(true);
        try {
            let imageSource: File | HTMLCanvasElement = file;

            // If it's a PDF, convert it to an image first
            if (file.type === 'application/pdf') {
                imageSource = await convertPdfToImage(file);
            }

            const { data: { text } } = await Tesseract.recognize(imageSource, 'eng+ara');
            console.log("Extracted Text:", text);
            analyzeInvoiceText(text);
            setToast({ message: 'تم تحليل الفاتورة بنجاح', type: 'success' });
        } catch (error) {
            console.error("OCR Error:", error);
            setToast({ message: 'فشل تحليل الملف (تأكد من جودة الصورة/الملف)', type: 'error' });
        } finally {
            setAnalyzing(false);
            // Clear input so same file can be re-uploaded if needed
            e.target.value = '';
        }
    };


    const analyzeInvoiceText = (text: string) => {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const lowerText = text.toLowerCase();

        // 1. Find Total Amount (المبلغ) — look for "Total Amount (EGP)" directly
        let finalAmount = '';

        // Primary: regex to find "Total Amount" (optionally followed by "(EGP)") and grab the number after it
        const totalAmountMatch = text.match(/Total\s*Amount\s*(?:\(?\s*EGP\s*\)?)?\s*[:\s]*\s*([\d,\.]+)/i);
        if (totalAmountMatch && totalAmountMatch[1]) {
            // Remove thousands commas and parse
            finalAmount = totalAmountMatch[1].replace(/,/g, '').trim();
        }

        // Fallback: try other total patterns
        if (!finalAmount) {
            const fallbackPatterns = [
                /(?:Total|إجمالي|المجموع|صافي)\s*[:\s]*\s*([\d,\.]+)/i,
                /([\d,\.]+)\s*(?:EGP|LE|جنيه)/i
            ];
            for (const pattern of fallbackPatterns) {
                const m = text.match(pattern);
                if (m && m[1]) {
                    finalAmount = m[1].replace(/,/g, '').trim();
                    break;
                }
            }
        }


        // 2. Find Description (ملاحظات / وصف) — extract name from "Signed By :"
        let description = '';
        const signedByMatch = text.match(/Signed\s*By\s*:\s*(.+)/i);
        if (signedByMatch && signedByMatch[1]) {
            description = signedByMatch[1].trim();
        }
        // Fallback
        if (!description) {
            description = lines.find(l => /[a-zA-Z\u0600-\u06FF]{3,}/.test(l))?.substring(0, 100) || 'مصروف مشروع';
        }



        // 3. Find Date (التاريخ)
        const dateRegex = /(\d{4}[-/]\d{1,2}[-/]\d{1,2})|(\d{1,2}[-/]\d{1,2}[-/]\d{4})/g;
        const dateMatch = text.match(dateRegex);
        let finalDate = new Date().toISOString().split('T')[0];
        if (dateMatch) {
            const rawDate = dateMatch[0].replace(/\//g, '-');
            const parts = rawDate.split('-');
            if (parts[0].length === 4) finalDate = rawDate;
            else if (parts[2].length === 4) finalDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }

        // 4. Find Category
        let category = 'other';
        if (lowerText.includes('taxi') || lowerText.includes('careem') || lowerText.includes('uber') || lowerText.includes('انتقالات') || lowerText.includes('مواصلات')) {
            category = 'transportation';
        } else if (lowerText.includes('bonus') || lowerText.includes('incentive') || lowerText.includes('حوافز') || lowerText.includes('مكافأة')) {
            category = 'bonus';
        } else if (lowerText.includes('maintenance') || lowerText.includes('repair') || lowerText.includes('صيانة') || lowerText.includes('تصليح')) {
            category = 'hardware_maintenance';
        } else if (lowerText.includes('electric') || lowerText.includes('water') || lowerText.includes('gas') || lowerText.includes('مرافق') || lowerText.includes('كهرباء')) {
            category = 'utilities';
        } else if (lowerText.includes('rent') || lowerText.includes('lease') || lowerText.includes('إيجار')) {
            category = 'rent';
        }

        setExpenseForm(prev => ({
            ...prev,
            amount: finalAmount,
            expense_date: finalDate,
            category: category,
            description: description
        }));
    };





    // ── Derived Stats ──────────────────────────────────────────────
    const totalRevenue = projectFinancials.reduce((s, f) => s + f.revenue, 0);
    const totalCost = projectFinancials.reduce((s, f) => s + f.totalCost, 0);
    const totalSalary = projectFinancials.reduce((s, f) => s + f.salaryCost, 0);
    const totalExpenses = projectFinancials.reduce((s, f) => s + f.directCost, 0);
    const totalTickets = projectFinancials.reduce((s, f) => s + (f.ticketCost || 0), 0);
    const totalGP = totalRevenue - totalCost;
    const totalGM = totalRevenue > 0 ? (totalGP / totalRevenue) * 100 : 0;
    const totalActualVol = projectFinancials.reduce((s, f) => s + f.actualVolume, 0);
    const totalPlannedVol = projectFinancials.reduce((s, f) => s + f.plannedVolume, 0);
    const totalAchievePct = totalPlannedVol > 0 ? (totalActualVol / totalPlannedVol) * 100 : 0;
    const totalBacklog = projectFinancials.reduce((s, f) => s + f.backlogVolume, 0);
    const totalCostPerUnit = totalActualVol > 0 ? totalCost / totalActualVol : 0;

    // Productivity from timesheets
    const totalHours = timesheets.reduce((s, t) => s + t.hours_worked, 0);
    const totalVolTS = timesheets.reduce((s, t) => s + t.volume_processed, 0);
    const outputPerHour = totalHours > 0 ? totalVolTS / totalHours : 0;
    const uniqueEmployees = new Set(timesheets.map(t => t.employee_id)).size;
    const revenuePerEmployee = uniqueEmployees > 0 ? totalRevenue / uniqueEmployees : 0;

    // Backlog
    const prepTotal = siteLogs.reduce((s, l) => s + l.prep_volume, 0);
    const qcTotal = siteLogs.reduce((s, l) => s + l.qc_volume, 0);
    const indexTotal = siteLogs.reduce((s, l) => s + l.index_volume, 0);
    const pendingQC = Math.max(0, prepTotal - qcTotal);
    const pendingIndex = Math.max(0, qcTotal - indexTotal);

    // Expense breakdown
    const expByCategory = expenses.reduce((acc, e) => {
        acc[e.category] = (acc[e.category] || 0) + Number(e.amount);
        return acc;
    }, {} as Record<string, number>);
    const CATEGORY_LABELS: Record<string, string> = {
        rent: 'إيجار',
        utilities: 'مرافق',
        hardware_maintenance: 'صيانة أجهزة',
        transportation: 'انتقالات',
        bonus: 'حوافز/بونص',
        other: 'أخرى'
    };

    // Forecasted GP to end of contract
    const forecastedGP = (() => {
        if (!currentProject) return null;
        const totalVol = currentProject.contract_total_volume || 0;
        const monthlyVol = currentProject.contract_monthly_volume || 0;
        const remainingVol = totalVol - totalActualVol;
        if (monthlyVol === 0) return null;
        const remainingMonths = remainingVol / monthlyVol;
        const gpPerMonth = totalRevenue > 0 ? totalGP : 0;
        return gpPerMonth * remainingMonths;
    })();

    const tabClass = (t: string) =>
        `pb-2 px-1 font-semibold text-sm transition-colors ${tab === t ? 'border-b-2 border-blue-600 text-blue-700' : 'text-gray-500 hover:text-gray-700'}`;

    // ── Render ─────────────────────────────────────────────────────
    return (
        <div className="space-y-6 animate-fade-in" dir="rtl">
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                <div>
                    <h2 className="text-xl font-bold text-gray-800">إدارة ومتابعة المشاريع (PM)</h2>
                    <p className="text-sm text-gray-500">لوحة التحكم الشاملة — مالية، تشغيلية، وإنتاجية</p>
                </div>
                {projects.length > 0 && (
                    <div className="flex items-center gap-3 flex-wrap">
                        {isAdmin && (
                            <div className="relative">
                                <button
                                    onClick={() => setShowManagementMenu(!showManagementMenu)}
                                    className="p-2 bg-gray-50 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2 border border-gray-200"
                                    title="قائمة الإدارة"
                                >
                                    <span className="material-icons text-xl">more_vert</span>
                                    <span className="text-sm font-bold">الإدارة</span>
                                </button>

                                {showManagementMenu && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => setShowManagementMenu(false)}></div>
                                        <div className="absolute left-0 mt-2 w-72 bg-white rounded-xl shadow-2xl border border-gray-100 p-4 z-50 animate-fade-in">
                                            <div className="space-y-4">
                                                <div className="text-xs font-bold text-gray-400 uppercase border-b pb-2">عمليات سريعة</div>
                                                <button
                                                    onClick={() => {
                                                        setShowExpenseModal(true);
                                                        setShowManagementMenu(false);
                                                    }}
                                                    className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold shadow-lg shadow-red-100 transition-all flex items-center justify-center gap-2"
                                                >
                                                    <span className="material-icons text-sm">add</span>
                                                    إضافة مصروف جديد
                                                </button>

                                                <div className="bg-gradient-to-br from-red-50 to-white p-4 rounded-xl border border-red-100">
                                                    <div className="text-[10px] text-gray-400 font-semibold mb-1 uppercase tracking-wider">إجمالي مصروفات الشهر</div>
                                                    <div className="text-xl font-black text-red-700">{fmt(totalExpenses + totalTickets)} EGP</div>
                                                    <div className="text-[10px] text-gray-400 mt-1 truncate">مشروع: {currentProject?.name || 'الكل'}</div>
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
                            className="border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-200 outline-none text-sm font-bold text-gray-700" />

                        <select
                            className="border border-gray-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-200 outline-none w-full md:w-64"
                            value={currentProject?.id || 'all'}
                            onChange={e => {
                                if (e.target.value === 'all') { setCurrentProject(null); }
                                else { const p = projects.find(x => x.id === e.target.value); if (p) setCurrentProject(p); }
                            }}
                        >
                            <option value="all">كل المشاريع</option>
                            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>
                )}
            </div>

            {projects.length === 0 ? (
                <div className="text-center text-gray-500 py-10 bg-white rounded-xl shadow-sm">لا توجد مشاريع متاحة</div>
            ) : loading ? (
                <div className="flex justify-center items-center h-48">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
                </div>
            ) : (
                <>
                    {/* Top KPI Strip */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <KpiCard title="إجمالي الإيرادات" value={`${fmt(totalRevenue, 0)} EGP`} sub={selectedMonth} color="from-emerald-50 to-emerald-100/60" icon="payments" />
                        <KpiCard title="إجمالي التكاليف" value={`${fmt(totalCost, 0)} EGP`} sub={`رواتب ${fmt(totalSalary)} + مصروفات ${fmt(totalExpenses + totalTickets)}`} color="from-red-50 to-red-100/60" icon="account_balance_wallet" />
                        <KpiCard title="Gross Profit" value={`${fmt(totalGP, 0)} EGP`} sub={`Margin: ${pct(totalGM)}`} color={totalGP >= 0 ? 'from-blue-50 to-blue-100/60' : 'from-orange-50 to-orange-100/60'} icon="trending_up" />
                        <KpiCard title="حجم الإنجاز" value={`${fmt(totalActualVol)}`} sub={`${pct(totalAchievePct)} من المستهدف`} color="from-purple-50 to-purple-100/60" icon="fact_check" />
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-6 border-b border-gray-200 overflow-x-auto">
                        <button className={tabClass('executive')} onClick={() => setTab('executive')}>📊 Executive Summary</button>
                        <button className={tabClass('overview')} onClick={() => setTab('overview')}>منحنى الإنتاج</button>
                        <button className={tabClass('inventory')} onClick={() => setTab('inventory')}>المخزون</button>
                        <button className={tabClass('logs')} onClick={() => setTab('logs')}>السجلات اليومية</button>
                        <button className={tabClass('timesheets')} onClick={() => setTab('timesheets')}>كفاءة الموظفين</button>
                        <button className={tabClass('expenses')} onClick={() => setTab('expenses')}>المصروفات</button>
                    </div>

                    {/* ── EXECUTIVE SUMMARY TAB ──────────────────── */}
                    {tab === 'executive' && (
                        <div className="space-y-6">

                            {/* Section 1: Executive KPIs */}
                            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                                <h3 className="text-base font-bold text-gray-700 mb-4 flex items-center gap-2">
                                    <span className="material-icons text-blue-500 text-lg">dashboard</span>
                                    1️⃣ ملخص الإدارة العليا — {selectedMonth}
                                </h3>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                                        <div className="text-xs text-gray-500 font-semibold mb-1">إجمالي الإيرادات</div>
                                        <div className="text-xl font-bold text-emerald-800">{fmt(totalRevenue)} EGP</div>
                                    </div>
                                    <div className="p-4 bg-red-50 rounded-xl border border-red-100">
                                        <div className="text-xs text-gray-500 font-semibold mb-1">إجمالي التكاليف</div>
                                        <div className="text-xl font-bold text-red-800">{fmt(totalCost)} EGP</div>
                                        <div className="text-[10px] text-gray-400 mt-1">رواتب: {fmt(totalSalary)} | مصروفات: {fmt(totalExpenses + totalTickets)}</div>
                                    </div>
                                    <div className={`p-4 rounded-xl border ${totalGP >= 0 ? 'bg-blue-50 border-blue-100' : 'bg-orange-50 border-orange-100'}`}>
                                        <div className="text-xs text-gray-500 font-semibold mb-1">Gross Profit</div>
                                        <div className={`text-xl font-bold ${totalGP >= 0 ? 'text-blue-800' : 'text-orange-700'}`}>{fmt(totalGP)} EGP</div>
                                        <div className="text-xs text-gray-400 mt-1">GM: {pct(totalGM)}</div>
                                    </div>
                                    <div className="p-4 bg-purple-50 rounded-xl border border-purple-100">
                                        <div className="text-xs text-gray-500 font-semibold mb-1">Cost per Unit</div>
                                        <div className="text-xl font-bold text-purple-800">{fmt(totalCostPerUnit, 2)} EGP</div>
                                        <div className="text-xs text-gray-400 mt-1">Revenue/Unit: {fmt(projectFinancials[0]?.revenuePerUnit || 0, 2)}</div>
                                    </div>
                                    <div className="p-4 bg-sky-50 rounded-xl border border-sky-100 relative group">
                                        <div className="text-xs text-gray-500 font-semibold mb-1 flex items-center justify-between">
                                            <span>الحجم الفعلي</span>
                                            {isAdmin && currentProject && (
                                                <button
                                                    onClick={() => { setVolumeInput(String(actualMonthlyAchieved || '')); setShowVolumeModal(true); }}
                                                    className="opacity-0 group-hover:opacity-100 transition-opacity bg-sky-600 text-white rounded-md px-2 py-0.5 text-[10px] font-bold hover:bg-sky-700 flex items-center gap-1"
                                                    title="تعديل الحجم المنجز"
                                                >
                                                    <span className="material-icons text-xs">edit</span> تعديل
                                                </button>
                                            )}
                                        </div>
                                        <div className="text-xl font-bold text-sky-800">{fmt(totalActualVol)}</div>
                                        <div className="text-xs text-gray-400 mt-1">مستهدف: {fmt(totalPlannedVol)} ({pct(totalAchievePct)})</div>
                                    </div>
                                    <div className="p-4 bg-yellow-50 rounded-xl border border-yellow-100">
                                        <div className="text-xs text-gray-500 font-semibold mb-1">Backlog Volume</div>
                                        <div className="text-xl font-bold text-yellow-800">{fmt(totalBacklog)}</div>
                                        <div className="text-xs text-gray-400 mt-1">QC: {fmt(pendingQC)} | Index: {fmt(pendingIndex)}</div>
                                    </div>
                                    <div className="p-4 bg-teal-50 rounded-xl border border-teal-100">
                                        <div className="text-xs text-gray-500 font-semibold mb-1">Revenue per Employee</div>
                                        <div className="text-xl font-bold text-teal-800">{fmt(revenuePerEmployee)} EGP</div>
                                        <div className="text-xs text-gray-400 mt-1">{uniqueEmployees} موظف في السجلات</div>
                                    </div>
                                    <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                                        <div className="text-xs text-gray-500 font-semibold mb-1">Output per Hour</div>
                                        <div className="text-xl font-bold text-indigo-800">{fmt(outputPerHour, 1)}</div>
                                        <div className="text-xs text-gray-400 mt-1">{fmt(totalHours)} ساعة مسجلة</div>
                                    </div>
                                    {forecastedGP !== null && (
                                        <div className="p-4 bg-green-50 rounded-xl border border-green-100 col-span-2">
                                            <div className="text-xs text-gray-500 font-semibold mb-1">🔷 Forecasted Gross Profit (حتى نهاية العقد)</div>
                                            <div className="text-xl font-bold text-green-800">{fmt(forecastedGP)} EGP</div>
                                            <div className="text-xs text-gray-400 mt-1">بناءً على الأداء الشهري الحالي</div>
                                        </div>
                                    )}
                                    <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                                        <div className="text-xs text-gray-500 font-semibold mb-1">عدد المشاريع</div>
                                        <div className="text-xl font-bold text-gray-800">{projects.length}</div>
                                        <div className="text-xs text-gray-400 mt-1">مشروع نشط</div>
                                    </div>
                                    <div className="p-4 bg-pink-50 rounded-xl border border-pink-100">
                                        <div className="text-xs text-gray-500 font-semibold mb-1">SLA Achievement</div>
                                        <div className={`text-xl font-bold ${totalAchievePct >= 90 ? 'text-emerald-700' : totalAchievePct >= 70 ? 'text-yellow-700' : 'text-red-700'}`}>{pct(totalAchievePct)}</div>
                                        <div className="text-xs text-gray-400 mt-1">{totalAchievePct >= 90 ? '✅ ممتاز' : totalAchievePct >= 70 ? '⚠️ مقبول' : '🔴 دون المستهدف'}</div>
                                    </div>
                                </div>
                            </div>

                            {/* Section 2: Project Financial Performance Table */}
                            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                                <h3 className="text-base font-bold text-gray-700 mb-4 flex items-center gap-2">
                                    <span className="material-icons text-purple-500 text-lg">table_chart</span>
                                    2️⃣ الأداء المالي لكل مشروع
                                </h3>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-right text-sm">
                                        <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                                            <tr>
                                                <th className="px-3 py-3">المشروع</th>
                                                <th className="px-3 py-3">الإيراد</th>
                                                <th className="px-3 py-3">تكلفة رواتب</th>
                                                <th className="px-3 py-3">مصروفات</th>
                                                <th className="px-3 py-3">التكلفة الكلية</th>
                                                <th className="px-3 py-3">Gross Profit</th>
                                                <th className="px-3 py-3">GM%</th>
                                                <th className="px-3 py-3">الحجم الفعلي</th>
                                                <th className="px-3 py-3">Achievement%</th>
                                                <th className="px-3 py-3">Cost/Unit</th>
                                                <th className="px-3 py-3">Rev/Unit</th>
                                                <th className="px-3 py-3">Backlog</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {projectFinancials.map(f => (
                                                <tr key={f.project.id} className="border-t hover:bg-gray-50">
                                                    <td className="px-3 py-3 font-semibold text-gray-800">{f.project.name}</td>
                                                    <td className="px-3 py-3 text-emerald-700 font-bold">{fmt(f.revenue)}</td>
                                                    <td className="px-3 py-3 text-orange-600">{fmt(f.salaryCost)}</td>
                                                    <td className="px-3 py-3 text-red-500">{fmt(f.directCost + f.ticketCost)}</td>
                                                    <td className="px-3 py-3 text-red-700 font-bold">{fmt(f.totalCost)}</td>
                                                    <td className={`px-3 py-3 font-bold ${f.grossProfit >= 0 ? 'text-blue-700' : 'text-red-700'}`}>{fmt(f.grossProfit)}</td>
                                                    <td className={`px-3 py-3 font-bold ${f.grossMargin >= 20 ? 'text-emerald-600' : f.grossMargin >= 0 ? 'text-yellow-600' : 'text-red-600'}`}>{pct(f.grossMargin)}</td>
                                                    <td className="px-3 py-3">{fmt(f.actualVolume)}</td>
                                                    <td className="px-3 py-3">
                                                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${f.achievementPct >= 90 ? 'bg-emerald-100 text-emerald-700' : f.achievementPct >= 70 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                                                            {pct(f.achievementPct)}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-3 text-gray-600">{fmt(f.costPerUnit, 2)}</td>
                                                    <td className="px-3 py-3 text-gray-600">{fmt(f.revenuePerUnit, 2)}</td>
                                                    <td className={`px-3 py-3 font-bold ${f.backlogVolume > 1000 ? 'text-red-600' : 'text-gray-700'}`}>{fmt(f.backlogVolume)}</td>
                                                </tr>
                                            ))}
                                            {projectFinancials.length > 1 && (
                                                <tr className="border-t-2 border-gray-400 bg-gray-50 font-bold">
                                                    <td className="px-3 py-3">الإجمالي</td>
                                                    <td className="px-3 py-3 text-emerald-700">{fmt(totalRevenue)}</td>
                                                    <td className="px-3 py-3 text-orange-600">{fmt(totalSalary)}</td>
                                                    <td className="px-3 py-3 text-red-500">{fmt(totalExpenses + totalTickets)}</td>
                                                    <td className="px-3 py-3 text-red-700">{fmt(totalCost)}</td>
                                                    <td className={`px-3 py-3 ${totalGP >= 0 ? 'text-blue-700' : 'text-red-700'}`}>{fmt(totalGP)}</td>
                                                    <td className="px-3 py-3">{pct(totalGM)}</td>
                                                    <td className="px-3 py-3">{fmt(totalActualVol)}</td>
                                                    <td className="px-3 py-3">{pct(totalAchievePct)}</td>
                                                    <td className="px-3 py-3">{fmt(totalCostPerUnit, 2)}</td>
                                                    <td className="px-3 py-3">—</td>
                                                    <td className="px-3 py-3">{fmt(totalBacklog)}</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Section 2b: Revenue vs Cost vs GP Chart */}
                            {projectFinancials.length > 0 && (
                                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                                    <h3 className="text-base font-bold text-gray-700 mb-4">📈 Budget vs Actual — Revenue / Cost / GP Chart</h3>
                                    <div className="h-72"><canvas ref={gpChartRef}></canvas></div>
                                </div>
                            )}

                            {/* Section 3: Operational Performance */}
                            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                                <h3 className="text-base font-bold text-gray-700 mb-4 flex items-center gap-2">
                                    <span className="material-icons text-teal-500 text-lg">speed</span>
                                    3️⃣ الأداء التشغيلي والإنتاجية
                                </h3>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="p-4 bg-teal-50 rounded-xl border border-teal-100">
                                        <div className="text-xs text-gray-500 font-semibold mb-1">Planned Volume</div>
                                        <div className="text-xl font-bold text-teal-800">{fmt(totalPlannedVol)}</div>
                                    </div>
                                    <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                                        <div className="text-xs text-gray-500 font-semibold mb-1">Actual Volume</div>
                                        <div className="text-xl font-bold text-blue-800">{fmt(totalActualVol)}</div>
                                    </div>
                                    <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                                        <div className="text-xs text-gray-500 font-semibold mb-1">Output per Employee (monthly)</div>
                                        <div className="text-xl font-bold text-indigo-800">{uniqueEmployees > 0 ? fmt(totalActualVol / uniqueEmployees) : '—'}</div>
                                    </div>
                                    <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                                        <div className="text-xs text-gray-500 font-semibold mb-1">Output per Hour</div>
                                        <div className="text-xl font-bold text-emerald-800">{fmt(outputPerHour, 1)}</div>
                                        <div className="text-xs text-gray-400 mt-1">من {fmt(totalHours)} ساعة</div>
                                    </div>
                                </div>
                                {/* Progress bars per project */}
                                {projectFinancials.length > 1 && (
                                    <div className="mt-4 space-y-3">
                                        {projectFinancials.map(f => (
                                            <div key={f.project.id}>
                                                <div className="flex justify-between text-xs text-gray-600 mb-1">
                                                    <span className="font-semibold">{f.project.name}</span>
                                                    <span>{fmt(f.actualVolume)} / {fmt(f.plannedVolume)} ({pct(f.achievementPct)})</span>
                                                </div>
                                                <div className="w-full bg-gray-200 rounded-full h-2">
                                                    <div className={`h-2 rounded-full ${f.achievementPct >= 90 ? 'bg-emerald-500' : f.achievementPct >= 70 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                                        style={{ width: `${Math.min(100, f.achievementPct)}%` }}></div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Section 4: Cost Control */}
                            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                                <h3 className="text-base font-bold text-gray-700 mb-4 flex items-center gap-2">
                                    <span className="material-icons text-red-500 text-lg">manage_accounts</span>
                                    4️⃣ Cost Control Dashboard
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <h4 className="text-sm font-semibold text-gray-600 mb-3">تفصيل التكاليف</h4>
                                        <div className="space-y-3">
                                            {/* Salary row */}
                                            <div className="flex justify-between items-center p-3 bg-orange-50 rounded-lg border border-orange-100">
                                                <span className="text-sm font-medium text-gray-700">💰 رواتب الموظفين</span>
                                                <span className="font-bold text-orange-700">{fmt(totalSalary)} EGP</span>
                                            </div>
                                            <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg border border-blue-100">
                                                <span className="text-sm font-medium text-gray-700">🛠️ تذاكر الدعم الفني</span>
                                                <span className="font-bold text-blue-700">{fmt(totalTickets)} EGP</span>
                                            </div>
                                            {Object.entries(expByCategory).map(([cat, amount]) => (
                                                <div key={cat} className="flex justify-between items-center p-3 bg-red-50 rounded-lg border border-red-100">
                                                    <span className="text-sm font-medium text-gray-700">{CATEGORY_LABELS[cat] || cat}</span>
                                                    <span className="font-bold text-red-700">{fmt(amount as number)} EGP</span>
                                                </div>
                                            ))}
                                            <div className="flex justify-between items-center p-3 bg-gray-100 rounded-lg border border-gray-200 font-bold">
                                                <span className="text-sm text-gray-800">الإجمالي</span>
                                                <span className="text-gray-800">{fmt(totalCost)} EGP</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-semibold text-gray-600 mb-3">KPIs المالية</h4>
                                        <div className="space-y-3">
                                            <div className="flex justify-between p-3 bg-blue-50 rounded-lg border border-blue-100">
                                                <span className="text-sm text-gray-700">Cost per Unit</span>
                                                <span className="font-bold text-blue-700">{fmt(totalCostPerUnit, 2)} EGP</span>
                                            </div>
                                            <div className="flex justify-between p-3 bg-emerald-50 rounded-lg border border-emerald-100">
                                                <span className="text-sm text-gray-700">Revenue per Unit</span>
                                                <span className="font-bold text-emerald-700">{projectFinancials.length > 0 ? fmt(projectFinancials[0].revenuePerUnit, 2) : '—'} EGP</span>
                                            </div>
                                            <div className="flex justify-between p-3 bg-purple-50 rounded-lg border border-purple-100">
                                                <span className="text-sm text-gray-700">Contribution Margin / Unit</span>
                                                <span className="font-bold text-purple-700">{projectFinancials.length > 0 ? fmt(projectFinancials[0].revenuePerUnit - totalCostPerUnit, 2) : '—'} EGP</span>
                                            </div>
                                            <div className="flex justify-between p-3 bg-teal-50 rounded-lg border border-teal-100">
                                                <span className="text-sm text-gray-700">Revenue per Employee</span>
                                                <span className="font-bold text-teal-700">{fmt(revenuePerEmployee)} EGP</span>
                                            </div>
                                            <div className="flex justify-between p-3 bg-yellow-50 rounded-lg border border-yellow-100">
                                                <span className="text-sm text-gray-700">Gross Margin %</span>
                                                <span className={`font-bold ${totalGM >= 20 ? 'text-emerald-700' : totalGM >= 0 ? 'text-yellow-700' : 'text-red-700'}`}>{pct(totalGM)}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Section 5: GP Deep Analysis */}
                            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                                <h3 className="text-base font-bold text-gray-700 mb-4 flex items-center gap-2">
                                    <span className="material-icons text-indigo-500 text-lg">analytics</span>
                                    5️⃣ Gross Profit Deep Analysis
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <h4 className="text-sm font-semibold text-gray-600 mb-3">GP by Project</h4>
                                        <div className="space-y-2">
                                            {projectFinancials.map(f => (
                                                <div key={f.project.id} className="flex items-center gap-3">
                                                    <span className="text-xs text-gray-600 w-28 truncate">{f.project.name}</span>
                                                    <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                                                        <div
                                                            className={`h-4 rounded-full flex items-center justify-end pr-2 text-xs font-bold text-white ${f.grossProfit >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                                                            style={{ width: `${totalRevenue > 0 ? Math.min(100, Math.abs(f.grossProfit / totalRevenue) * 100) : 0}%` }}>
                                                        </div>
                                                    </div>
                                                    <span className={`text-xs font-bold w-24 text-left ${f.grossProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmt(f.grossProfit)} EGP</span>
                                                    <span className="text-xs text-gray-500">{pct(f.grossMargin)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-semibold text-gray-600 mb-3">WIP & Forecasting</h4>
                                        <div className="space-y-3">
                                            <div className="p-4 bg-sky-50 rounded-xl border border-sky-100">
                                                <div className="text-xs text-gray-500 font-semibold">🔹 WIP (Work in Progress)</div>
                                                <div className="text-lg font-bold text-sky-800 mt-1">{fmt(pendingIndex)} وحدة</div>
                                                <div className="text-xs text-gray-400">حجم الأعمال المنفذة غير المكتملة (في طور الفهرسة)</div>
                                            </div>
                                            {forecastedGP !== null && (
                                                <div className="p-4 bg-green-50 rounded-xl border border-green-100">
                                                    <div className="text-xs text-gray-500 font-semibold">🔹 Forecasted Gross Profit</div>
                                                    <div className="text-lg font-bold text-green-800 mt-1">{fmt(forecastedGP)} EGP</div>
                                                    <div className="text-xs text-gray-400">متوقع حتى نهاية العقد بناءً على الشهر الحالي</div>
                                                </div>
                                            )}
                                            <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                                                <div className="text-xs text-gray-500 font-semibold">🔹 Break-even Volume (شهرياً)</div>
                                                <div className="text-lg font-bold text-indigo-800 mt-1">
                                                    {projectFinancials[0]?.revenuePerUnit > 0
                                                        ? fmt(totalCost / projectFinancials[0].revenuePerUnit)
                                                        : '—'} وحدة
                                                </div>
                                                <div className="text-xs text-gray-400">الحجم اللازم لتغطية التكاليف الكاملة</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                        </div>
                    )}

                    {/* ── OVERVIEW TAB ──────────────────────────────── */}
                    {tab === 'overview' && (
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <h3 className="text-lg font-bold mb-4 text-gray-700">منحنى الإنتاج الفعلي مقابل المستهدف اليومي</h3>
                            <div className="h-72 w-full">
                                {siteLogs.length > 0 ? <canvas ref={chartRef}></canvas> : <div className="text-gray-400 text-center py-20">لا توجد سجلات لعرض المنحنى</div>}
                            </div>
                        </div>
                    )}

                    {/* ── INVENTORY TAB ──────────────────────────────── */}
                    {tab === 'inventory' && (
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
                            <h3 className="text-lg font-bold mb-4 text-gray-700">تتبع المخزون حسب نوع المستند</h3>
                            <table className="w-full text-right text-sm">
                                <thead className="bg-gray-50 text-gray-500"><tr>
                                    <th className="px-4 py-2">نوع المستند</th><th className="px-4 py-2">الكمية الإجمالية</th>
                                    <th className="px-4 py-2">المعالجة</th><th className="px-4 py-2">المتبقي</th><th className="px-4 py-2">الإنجاز%</th>
                                </tr></thead>
                                <tbody>
                                    {inventory.map(inv => (
                                        <tr key={inv.id} className="border-t hover:bg-gray-50">
                                            <td className="px-4 py-3 font-medium text-gray-800">{inv.document_type}</td>
                                            <td className="px-4 py-3">{inv.total_volume.toLocaleString()}</td>
                                            <td className="px-4 py-3">{inv.processed_volume.toLocaleString()}</td>
                                            <td className="px-4 py-3">{(inv.total_volume - inv.processed_volume).toLocaleString()}</td>
                                            <td className="px-4 py-3 text-emerald-600 font-bold">{Math.round((inv.processed_volume / (inv.total_volume || 1)) * 100)}%</td>
                                        </tr>
                                    ))}
                                    {inventory.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-gray-500">لا توجد بيانات للمخزون</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* ── LOGS TAB ──────────────────────────────── */}
                    {tab === 'logs' && (
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <h3 className="text-lg font-bold mb-4 text-gray-700">سجل الإنجاز اليومي للإنتاج</h3>
                            <table className="w-full text-right text-sm">
                                <thead className="bg-gray-50 text-gray-500"><tr>
                                    <th className="px-4 py-2">التاريخ</th><th className="px-4 py-2">تحضير</th>
                                    <th className="px-4 py-2">مسح</th><th className="px-4 py-2">جودة</th><th className="px-4 py-2">فهرسة</th>
                                </tr></thead>
                                <tbody>
                                    {siteLogs.map(log => (
                                        <tr key={log.id} className="border-t hover:bg-gray-50">
                                            <td className="px-4 py-3 text-gray-700">{log.log_date}</td>
                                            <td className="px-4 py-3">{log.prep_volume.toLocaleString()}</td>
                                            <td className="px-4 py-3">{log.scan_volume.toLocaleString()}</td>
                                            <td className="px-4 py-3">{log.qc_volume.toLocaleString()}</td>
                                            <td className="px-4 py-3">{log.index_volume.toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* ── EXPENSES TAB ──────────────────────────────── */}
                    {tab === 'expenses' && (
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <h3 className="text-lg font-bold mb-4 text-gray-700">المصروفات الخاصة بالموقع — {selectedMonth}</h3>
                            <table className="w-full text-right text-sm">
                                <thead className="bg-gray-50 text-gray-500"><tr>
                                    <th className="px-4 py-2">التاريخ</th><th className="px-4 py-2">الفئة</th>
                                    <th className="px-4 py-2">المبلغ</th><th className="px-4 py-2">الوصف</th>
                                </tr></thead>
                                <tbody>
                                    {expenses.map(exp => (
                                        <tr key={exp.id} className="border-t hover:bg-gray-50">
                                            <td className="px-4 py-3 text-gray-700">{exp.expense_date}</td>
                                            <td className="px-4 py-3 font-medium text-gray-800">{CATEGORY_LABELS[exp.category] || exp.category}</td>
                                            <td className="px-4 py-3 text-red-600 font-bold">{exp.amount.toLocaleString()}</td>
                                            <td className="px-4 py-3 text-gray-500">{exp.description}</td>
                                        </tr>
                                    ))}
                                    {expenses.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-gray-500">لا توجد مصروفات مسجلة</td></tr>}
                                </tbody>
                            </table>
                            <div className="mt-4 pt-4 border-t flex justify-end">
                                <div className="text-lg font-bold">الإجمالي: <span className="text-red-600">{fmt(totalExpenses)} EGP</span></div>
                            </div>
                        </div>
                    )}

                    {/* ── TIMESHEETS TAB ──────────────────────────────── */}
                    {tab === 'timesheets' && (
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <h3 className="text-lg font-bold mb-4 text-gray-700">كفاءة الموظفين — Timesheets</h3>
                            <table className="w-full text-right text-sm">
                                <thead className="bg-gray-50 text-gray-500"><tr>
                                    <th className="px-4 py-2">التاريخ</th><th className="px-4 py-2">الموظف</th>
                                    <th className="px-4 py-2">المهام</th><th className="px-4 py-2">الساعات</th>
                                    <th className="px-4 py-2">الكمية</th><th className="px-4 py-2">معدل/ساعة</th>
                                </tr></thead>
                                <tbody>
                                    {timesheets.map(sheet => (
                                        <tr key={sheet.id} className="border-t hover:bg-gray-50">
                                            <td className="px-4 py-3 text-gray-700">{sheet.work_date}</td>
                                            <td className="px-4 py-3 font-medium text-gray-800">{sheet.hr_employees?.full_name || 'غير محدد'}</td>
                                            <td className="px-4 py-3 text-blue-600 font-semibold">{sheet.role_in_project}</td>
                                            <td className="px-4 py-3">{sheet.hours_worked}</td>
                                            <td className="px-4 py-3 font-bold">{sheet.volume_processed}</td>
                                            <td className="px-4 py-3 text-emerald-600 font-bold">{sheet.hours_worked > 0 ? (sheet.volume_processed / sheet.hours_worked).toFixed(1) : 0}</td>
                                        </tr>
                                    ))}
                                    {timesheets.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-gray-500">لا توجد بيانات</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}

            {/* Expense Modal */}
            {showExpenseModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" dir="rtl">
                    <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
                        <div className="bg-gray-50 px-6 py-4 border-b flex justify-between items-center text-right">
                            <div className="flex items-center gap-2">
                                <span className="material-icons text-red-500">add_card</span>
                                <h3 className="text-xl font-bold text-gray-800">إضافة مصروف جديد</h3>
                            </div>
                            <button
                                onClick={() => setShowExpenseModal(false)}
                                className="text-gray-400 hover:text-red-500 transition-colors"
                            >
                                <span className="material-icons">close</span>
                            </button>
                        </div>

                        <div className="p-6">
                            {/* Invoice Upload & AI Analysis */}
                            <div className="mb-6">
                                <label className="block text-xs font-bold text-gray-500 mb-2">تحميل الفاتورة للتحليل الذكي (AI Analysis)</label>
                                <label className={`flex flex-col items-center justify-center w-full h-28 border-2 border-dashed rounded-xl cursor-pointer transition-all ${analyzing ? 'bg-blue-50 border-blue-300' : 'bg-gray-50 border-gray-300 hover:bg-gray-100 hover:border-gray-400'}`}>
                                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                        {analyzing ? (
                                            <>
                                                <span className="material-icons animate-spin text-blue-500 mb-2">sync</span>
                                                <p className="text-sm text-blue-600 font-bold">جاري تحليل البيانات...</p>
                                            </>
                                        ) : (
                                            <>
                                                <span className="material-icons text-gray-400 text-3xl mb-2">cloud_upload</span>
                                                <p className="text-sm text-gray-500 font-bold">ارفع صورة الفاتورة للتحليل التلقائي</p>
                                                <p className="text-[10px] text-gray-400 mt-1">سيتم استخراج المبلغ والتاريخ والفئة تلقائياً</p>
                                            </>
                                        )}
                                    </div>
                                    <input type="file" className="hidden" accept="image/*,application/pdf" onChange={handleInvoiceUpload} disabled={analyzing} />

                                </label>
                            </div>

                            <form onSubmit={handleAddExpense} className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">المبلغ (EGP)</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            required
                                            placeholder="0.00"
                                            className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-red-200 outline-none font-bold text-lg"
                                            value={expenseForm.amount}
                                            onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">التاريخ</label>
                                        <input
                                            type="date"
                                            required
                                            className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-red-200 outline-none text-sm"
                                            value={expenseForm.expense_date}
                                            onChange={e => setExpenseForm({ ...expenseForm, expense_date: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">فئة المصروف</label>
                                        <select
                                            className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-red-200 outline-none text-sm font-semibold"
                                            value={expenseForm.category}
                                            onChange={e => setExpenseForm({ ...expenseForm, category: e.target.value })}
                                        >
                                            {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
                                                <option key={val} value={val}>{label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">المشروع</label>
                                        <div className="p-2.5 bg-gray-100 border border-gray-200 rounded-lg text-sm font-bold text-gray-600 truncate">
                                            {currentProject?.name || 'اختر مشروعاً'}
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">ملاحظات / وصف</label>
                                    <textarea
                                        className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-red-200 outline-none text-sm h-24"
                                        placeholder="ادخل تفاصيل المصروف هنا..."
                                        value={expenseForm.description}
                                        onChange={e => setExpenseForm({ ...expenseForm, description: e.target.value })}
                                    ></textarea>
                                </div>

                                <div className="flex gap-3 pt-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowExpenseModal(false)}
                                        className="flex-1 py-3 border border-gray-200 text-gray-600 rounded-xl font-bold hover:bg-gray-50 transition-colors"
                                    >
                                        إلغاء
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={savingExpense || !currentProject}
                                        className={`flex-[2] py-3 rounded-xl font-bold text-white shadow-lg transition-all flex items-center justify-center gap-2 ${savingExpense || !currentProject ? 'bg-gray-300' : 'bg-red-600 hover:bg-red-700 ring-4 ring-red-100'}`}
                                    >
                                        {savingExpense ? <span className="material-icons animate-spin">sync</span> : <span className="material-icons">save</span>}
                                        حفظ المصروف
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Monthly Achieved Volume Modal ── */}
            {showVolumeModal && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowVolumeModal(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full animate-fade-in-up" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-gray-100">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-sky-100 rounded-xl flex items-center justify-center">
                                    <span className="material-icons text-sky-600">speed</span>
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-gray-800">تسجيل الحجم المنجز</h3>
                                    <p className="text-xs text-gray-400">{currentProject?.name} — {selectedMonth}</p>
                                </div>
                            </div>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-3 text-center">
                                <div className="bg-gray-50 rounded-lg p-3">
                                    <div className="text-[10px] text-gray-400 font-bold">المستهدف الشهري</div>
                                    <div className="text-lg font-bold text-gray-700">{fmt(currentProject?.contract_monthly_volume || 0)}</div>
                                </div>
                                <div className="bg-sky-50 rounded-lg p-3">
                                    <div className="text-[10px] text-gray-400 font-bold">الحجم الحالي المسجل</div>
                                    <div className="text-lg font-bold text-sky-700">{fmt(actualMonthlyAchieved)}</div>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-2">الحجم المنجز الجديد</label>
                                <div className="relative">
                                    <span className="material-icons absolute right-3 top-3 text-gray-300">description</span>
                                    <input
                                        type="number"
                                        min="0"
                                        className="w-full pl-4 pr-10 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-sky-300 outline-none text-lg font-bold text-gray-800 text-center"
                                        placeholder="أدخل الحجم المنجز..."
                                        value={volumeInput}
                                        onChange={e => setVolumeInput(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                                {volumeInput && currentProject?.contract_monthly_volume && Number(currentProject.contract_monthly_volume) > 0 && (
                                    <div className="mt-2 text-center">
                                        <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                                            (parseInt(volumeInput) / Number(currentProject.contract_monthly_volume)) * 100 >= 90
                                                ? 'bg-emerald-100 text-emerald-700'
                                                : (parseInt(volumeInput) / Number(currentProject.contract_monthly_volume)) * 100 >= 70
                                                    ? 'bg-yellow-100 text-yellow-700'
                                                    : 'bg-red-100 text-red-700'
                                        }`}>
                                            نسبة الإنجاز: {pct((parseInt(volumeInput) / Number(currentProject.contract_monthly_volume)) * 100)}
                                        </span>
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowVolumeModal(false)}
                                    className="flex-1 py-3 border border-gray-200 text-gray-600 rounded-xl font-bold hover:bg-gray-50 transition-colors"
                                >
                                    إلغاء
                                </button>
                                <button
                                    onClick={handleSaveVolume}
                                    disabled={savingVolume || !volumeInput}
                                    className={`flex-[2] py-3 rounded-xl font-bold text-white shadow-lg transition-all flex items-center justify-center gap-2 ${
                                        savingVolume || !volumeInput ? 'bg-gray-300' : 'bg-sky-600 hover:bg-sky-700 ring-4 ring-sky-100'
                                    }`}
                                >
                                    {savingVolume ? <span className="material-icons animate-spin">sync</span> : <span className="material-icons">save</span>}
                                    حفظ الحجم
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProjectManagementDashboard;
