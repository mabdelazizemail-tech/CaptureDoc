import React, { useState, useEffect, useMemo } from 'react';
import { User } from '../services/types';
import { PMStorageService, PMProject, SiteLog, InventoryTracking, Expense, Timesheet } from '../services/pmStorage';
import Toast from '../components/Toast';

declare const Chart: any;

interface PMDashboardProps {
    user: User;
}

const ProjectManagementDashboard: React.FC<PMDashboardProps> = ({ user }) => {
    const [projects, setProjects] = useState<PMProject[]>([]);
    const [currentProject, setCurrentProject] = useState<PMProject | null>(null);

    const [siteLogs, setSiteLogs] = useState<SiteLog[]>([]);
    const [inventory, setInventory] = useState<InventoryTracking[]>([]);
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
    const [actualMonthlyAchieved, setActualMonthlyAchieved] = useState<number>(0);

    const [loading, setLoading] = useState(false);
    const [tab, setTab] = useState<'overview' | 'logs' | 'inventory' | 'timesheets' | 'expenses'>('overview');

    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

    const chartRef = React.useRef<HTMLCanvasElement>(null);
    const chartInstance = React.useRef<any>(null);

    // Variance & Burn-down calculation
    const totalContractVolume = currentProject?.contract_total_volume || 0;
    const processedOverall = inventory.reduce((sum, item) => sum + item.processed_volume, 0) ||
        siteLogs.reduce((sum, log) => sum + (log.index_volume || 0), 0);

    // Variance Tracker (Target vs Actual)
    const startDate = currentProject?.start_date ? new Date(currentProject.start_date) : null;
    const endDate = currentProject?.end_date ? new Date(currentProject.end_date) : null;
    const targetDaily = useMemo(() => {
        if (!startDate || !endDate || totalContractVolume === 0) return 0;
        const days = (endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24);
        return days > 0 ? Math.ceil(totalContractVolume / days) : 0;
    }, [startDate, endDate, totalContractVolume]);

    useEffect(() => {
        loadProjects();
    }, [user]);

    useEffect(() => {
        if (tab === 'overview' && siteLogs.length > 0) {
            setTimeout(() => {
                if (!chartRef.current) return;

                if (chartInstance.current) {
                    chartInstance.current.destroy();
                }

                const ctx = chartRef.current.getContext('2d');
                const reversedLogs = [...siteLogs].slice(0, 7).reverse();

                chartInstance.current = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: reversedLogs.map(l => l.log_date),
                        datasets: [
                            {
                                label: 'حجم المعالجة (الفهرسة)',
                                data: reversedLogs.map(l => l.index_volume),
                                borderColor: '#3b82f6',
                                backgroundColor: 'rgba(59, 130, 246, 0.4)',
                                fill: true,
                                tension: 0.3
                            },
                            {
                                label: 'المستهدف اليومي',
                                data: Array(Math.min(7, reversedLogs.length)).fill(targetDaily),
                                borderColor: '#10b981',
                                borderDash: [5, 5],
                                tension: 0
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: { beginAtZero: true }
                        }
                    }
                });
            }, 100);
        }

        return () => {
            if (chartInstance.current) {
                chartInstance.current.destroy();
                chartInstance.current = null;
            }
        };
    }, [tab, siteLogs, targetDaily]);

    useEffect(() => {
        if (currentProject) {
            loadProjectData(currentProject.id);
        }
    }, [currentProject]);

    const loadProjects = async () => {
        setLoading(true);
        const projs = await PMStorageService.getProjects();
        setProjects(projs);
        if (projs.length > 0) setCurrentProject(projs[0]);
        setLoading(false);
    };

    const loadProjectData = async (projectId: string) => {
        setLoading(true);
        const currentMonthStr = new Date().toISOString().slice(0, 7); // YYYY-MM
        const [logsData, invData, expData, sheetData, kpiVol] = await Promise.all([
            PMStorageService.getSiteLogs(projectId),
            PMStorageService.getInventory(projectId),
            PMStorageService.getExpenses(projectId),
            PMStorageService.getTimesheets(projectId),
            PMStorageService.getProjectKPIVolume(projectId, currentMonthStr)
        ]);
        setSiteLogs(logsData);
        setInventory(invData);
        setExpenses(expData);
        setTimesheets(sheetData);
        setActualMonthlyAchieved(kpiVol);
        setLoading(false);
    };

    const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => setToast({ message, type });


    const actualDailyAvg = siteLogs.length > 0
        ? siteLogs.reduce((sum, log) => sum + (log.index_volume || 0), 0) / siteLogs.length
        : 0;

    // Backlog Analysis Alerts
    const prepTotal = siteLogs.reduce((sum, log) => sum + log.prep_volume, 0);
    const qcTotal = siteLogs.reduce((sum, log) => sum + log.qc_volume, 0);
    const indexTotal = siteLogs.reduce((sum, log) => sum + log.index_volume, 0);
    const pendingQC = prepTotal - qcTotal;
    const pendingIndex = qcTotal - indexTotal;

    return (
        <div className="space-y-6 animate-fade-in" dir="rtl">
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                <div>
                    <h2 className="text-xl font-bold text-gray-800">إدارة ومتابعة المشاريع (PM)</h2>
                    <p className="text-sm text-gray-500">متابعة حجم العمل، المستهدف اليومي، المتأخرات والمصروفات</p>
                </div>
                {projects.length > 0 && (
                    <select
                        className="border-gray-200 border rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary/20 outline-none w-full md:w-64"
                        value={currentProject?.id || ''}
                        onChange={(e) => {
                            const p = projects.find(x => x.id === e.target.value);
                            if (p) setCurrentProject(p);
                        }}
                    >
                        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                )}
            </div>

            {!currentProject ? (
                <div className="text-center text-gray-500 py-10 bg-white rounded-xl shadow-sm">لا توجد مشاريع متاحة</div>
            ) : loading ? (
                <div className="flex justify-center items-center h-48">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
                </div>
            ) : (
                <>
                    {/* Financial Summary */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                        <div className="bg-gradient-to-br from-green-50 to-green-100/50 p-5 rounded-xl border border-green-100/50 shadow-sm flex justify-between items-center group">
                            <div>
                                <div className="text-gray-500 text-sm font-medium mb-1">الإيراد الشهري المتوقع</div>
                                <div className="text-2xl font-bold text-green-900 group-hover:scale-105 transition-transform">
                                    {((currentProject.contract_monthly_volume || 0) * (currentProject.click_charge || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })} EGP
                                </div>
                                <div className="text-xs text-green-600 mt-1">
                                    بناءً على {currentProject.click_charge || 0} EGP للمستند
                                </div>
                            </div>
                            <span className="material-icons text-green-300 text-5xl">request_quote</span>
                        </div>

                        <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 p-5 rounded-xl border border-purple-100/50 shadow-sm flex justify-between items-center group">
                            <div>
                                <div className="text-gray-500 text-sm font-medium mb-1">الحجم الشهري المستهدف</div>
                                <div className="text-2xl font-bold text-purple-900 group-hover:scale-105 transition-transform">
                                    {(currentProject.contract_monthly_volume || 0).toLocaleString()}
                                </div>
                                <div className="text-xs text-purple-600 mt-1">حسب العقد</div>
                            </div>
                            <span className="material-icons text-purple-300 text-5xl">leaderboard</span>
                        </div>

                        <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 p-5 rounded-xl border border-blue-100/50 shadow-sm flex justify-between items-center group relative overflow-hidden">
                            <div className="z-10 relative w-full">
                                <div className="text-gray-500 text-sm font-medium mb-1">المنجز الفعلي (هذا الشهر)</div>
                                <div className="flex items-center gap-3">
                                    <div className="text-2xl font-bold text-blue-900 group-hover:scale-105 transition-transform">
                                        {actualMonthlyAchieved.toLocaleString()}
                                    </div>
                                    <div className="px-2 py-1 bg-white/60 rounded-lg text-sm font-bold text-blue-700 shadow-sm border border-blue-100">
                                        {currentProject.contract_monthly_volume ? ((actualMonthlyAchieved / currentProject.contract_monthly_volume) * 100).toFixed(1) : 0}% محقق
                                    </div>
                                </div>
                                <div className="w-full bg-blue-200/50 rounded-full h-1.5 mt-2">
                                    <div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${Math.min(100, currentProject.contract_monthly_volume ? (actualMonthlyAchieved / currentProject.contract_monthly_volume) * 100 : 0)}%` }}></div>
                                </div>
                            </div>
                            <span className="material-icons text-blue-300/50 text-7xl absolute left-[-10px] bottom-[-10px] transform -rotate-12 z-0">fact_check</span>
                        </div>

                        <div className="bg-gradient-to-br from-orange-50 to-orange-100/50 p-5 rounded-xl border border-orange-100/50 shadow-sm flex justify-between items-center group">
                            <div>
                                <div className="text-gray-500 text-sm font-medium mb-1">تاريخ بدء الإنتاج</div>
                                <div className="text-2xl font-bold text-orange-900 group-hover:scale-105 transition-transform">
                                    {currentProject.start_date ? new Date(currentProject.start_date).toLocaleDateString('ar-EG') : 'غير محدد'}
                                </div>
                                <div className="text-xs text-orange-600 mt-1">موعد الانطلاق</div>
                            </div>
                            <span className="material-icons text-orange-300 text-5xl">calendar_month</span>
                        </div>
                    </div>

                    {/* Production Top Summaries */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                        <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 p-5 rounded-xl border border-blue-100/50 shadow-sm relative overflow-hidden group">
                            <div className="text-gray-500 text-sm font-medium mb-1">الكمية المتعاقد عليها</div>
                            <div className="text-3xl font-bold text-blue-900 group-hover:scale-105 transition-transform">{totalContractVolume.toLocaleString()}</div>
                            <div className="absolute top-0 left-0 w-16 h-16 bg-blue-500/10 rounded-br-full"></div>
                        </div>

                        <div className="bg-gradient-to-br from-indigo-50 to-indigo-100/50 p-5 rounded-xl border border-indigo-100/50 shadow-sm relative overflow-hidden group">
                            <div className="text-gray-500 text-sm font-medium mb-1">المنجز (فعلي)</div>
                            <div className="text-3xl font-bold text-indigo-900 group-hover:scale-105 transition-transform">{processedOverall.toLocaleString()}</div>
                            <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2">
                                <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, (processedOverall / (totalContractVolume || 1)) * 100)}%` }}></div>
                            </div>
                        </div>

                        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 p-5 rounded-xl border border-emerald-100/50 shadow-sm relative overflow-hidden group">
                            <div className="text-gray-500 text-sm font-medium mb-1">المستهدف / الفعلي اليومي</div>
                            <div className="text-2xl font-bold text-emerald-900 group-hover:scale-105 transition-transform">
                                {actualDailyAvg.toFixed(0)} <span className="text-sm font-normal text-gray-500 mx-1">/</span> {targetDaily}
                            </div>
                            <div className="text-xs text-emerald-600 mt-1">Variance Tracker</div>
                        </div>

                        <div className="bg-gradient-to-br from-red-50 to-red-100/50 p-5 rounded-xl border border-red-100/50 shadow-sm relative overflow-hidden group">
                            <div className="text-gray-500 text-sm font-medium mb-1">تنبيهات المتأخرات (Backlog)</div>
                            <div className="flex flex-col text-sm mt-1">
                                <span className={`font-semibold ${pendingQC > targetDaily ? 'text-red-600' : 'text-gray-700'}`}>جودة: {pendingQC.toLocaleString()} انتظار</span>
                                <span className={`font-semibold ${pendingIndex > targetDaily ? 'text-red-600' : 'text-gray-700'}`}>فهرسة: {pendingIndex.toLocaleString()} انتظار</span>
                            </div>
                        </div>
                    </div>

                    {/* Dashboard Navigation Tabs */}
                    <div className="flex border-b border-gray-200 gap-6">
                        <button className={`pb-2 font-medium ${tab === 'overview' ? 'border-b-2 border-primary text-primary' : 'text-gray-500'}`} onClick={() => setTab('overview')}>نظرة عامة والمنحنى</button>
                        <button className={`pb-2 font-medium ${tab === 'inventory' ? 'border-b-2 border-primary text-primary' : 'text-gray-500'}`} onClick={() => setTab('inventory')}>حركة المخزون</button>
                        <button className={`pb-2 font-medium ${tab === 'logs' ? 'border-b-2 border-primary text-primary' : 'text-gray-500'}`} onClick={() => setTab('logs')}>السجلات اليومية</button>
                        <button className={`pb-2 font-medium ${tab === 'timesheets' ? 'border-b-2 border-primary text-primary' : 'text-gray-500'}`} onClick={() => setTab('timesheets')}>كفاءة الموظفين</button>
                        <button className={`pb-2 font-medium ${tab === 'expenses' ? 'border-b-2 border-primary text-primary' : 'text-gray-500'}`} onClick={() => setTab('expenses')}>سجل المصروفات</button>
                    </div>

                    {/* Tab Contents */}
                    {tab === 'overview' && (
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <h3 className="text-lg font-bold mb-4 text-gray-700">منحنى الإنتاج الفعلي مقابل المستهدف اليومي</h3>
                            <div className="h-72 w-full">
                                {siteLogs.length > 0 ? <canvas ref={chartRef}></canvas> : <div className="text-gray-400 text-center py-20">لا توجد سجلات لعرض المنحنى</div>}
                            </div>
                        </div>
                    )}

                    {tab === 'inventory' && (
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
                            <h3 className="text-lg font-bold mb-4 text-gray-700">تتبع المخزون حسب نوع المستند</h3>
                            <table className="w-full text-right text-sm">
                                <thead className="bg-gray-50 text-gray-500">
                                    <tr>
                                        <th className="px-4 py-2">نوع المستند</th>
                                        <th className="px-4 py-2">الكمية الإجمالية</th>
                                        <th className="px-4 py-2">الكمية المعالجة</th>
                                        <th className="px-4 py-2">المتبقي</th>
                                        <th className="px-4 py-2">معدل الإنجاز</th>
                                    </tr>
                                </thead>
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

                    {tab === 'logs' && (
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <h3 className="text-lg font-bold mb-4 text-gray-700">سجل الإنجاز اليومي للإنتاج</h3>
                            <table className="w-full text-right text-sm">
                                <thead className="bg-gray-50 text-gray-500">
                                    <tr>
                                        <th className="px-4 py-2">التاريخ</th>
                                        <th className="px-4 py-2">تحضير (Prep)</th>
                                        <th className="px-4 py-2">مسح (Scan)</th>
                                        <th className="px-4 py-2">جودة (QC)</th>
                                        <th className="px-4 py-2">فهرسة (Index)</th>
                                    </tr>
                                </thead>
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

                    {tab === 'expenses' && (
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <h3 className="text-lg font-bold mb-4 text-gray-700">المصروفات الخاصة بالموقع</h3>
                            <table className="w-full text-right text-sm">
                                <thead className="bg-gray-50 text-gray-500">
                                    <tr>
                                        <th className="px-4 py-2">التاريخ</th>
                                        <th className="px-4 py-2">الفئة</th>
                                        <th className="px-4 py-2">المبلغ (SAR)</th>
                                        <th className="px-4 py-2">الوصف</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {expenses.map(exp => (
                                        <tr key={exp.id} className="border-t hover:bg-gray-50">
                                            <td className="px-4 py-3 text-gray-700">{exp.expense_date}</td>
                                            <td className="px-4 py-3 font-medium text-gray-800">
                                                {exp.category === 'rent' ? 'إيجار' :
                                                    exp.category === 'utilities' ? 'مرافق' :
                                                        exp.category === 'hardware_maintenance' ? 'صيانة أجهزة' : 'أخرى'}
                                            </td>
                                            <td className="px-4 py-3 text-red-600 font-bold">{exp.amount.toLocaleString()}</td>
                                            <td className="px-4 py-3 text-gray-500">{exp.description}</td>
                                        </tr>
                                    ))}
                                    {expenses.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-gray-500">لا توجد مصروفات مسجلة</td></tr>}
                                </tbody>
                            </table>
                            <div className="mt-4 pt-4 border-t flex justify-end">
                                <div className="text-lg font-bold">
                                    الإجمالي: <span className="text-red-600">{expenses.reduce((s, e) => s + Number(e.amount), 0).toLocaleString()} SAR</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {tab === 'timesheets' && (
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <h3 className="text-lg font-bold mb-4 text-gray-700">كفاءة الموظفين وتتبع الإنتاج (Timesheets)</h3>
                            <table className="w-full text-right text-sm">
                                <thead className="bg-gray-50 text-gray-500">
                                    <tr>
                                        <th className="px-4 py-2">التاريخ</th>
                                        <th className="px-4 py-2">الموظف</th>
                                        <th className="px-4 py-2">المهام</th>
                                        <th className="px-4 py-2">ساعات العمل</th>
                                        <th className="px-4 py-2">الكمية المنجزة</th>
                                        <th className="px-4 py-2">المعدل (بالساعة)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {timesheets.map(sheet => (
                                        <tr key={sheet.id} className="border-t hover:bg-gray-50">
                                            <td className="px-4 py-3 text-gray-700">{sheet.work_date}</td>
                                            <td className="px-4 py-3 font-medium text-gray-800">{sheet.hr_employees?.full_name || 'غير محدد'}</td>
                                            <td className="px-4 py-3 text-blue-600 font-semibold">{sheet.role_in_project}</td>
                                            <td className="px-4 py-3 text-gray-700">{sheet.hours_worked}</td>
                                            <td className="px-4 py-3 font-bold">{sheet.volume_processed}</td>
                                            <td className="px-4 py-3 text-emerald-600 font-bold text-center bg-emerald-50 bg-opacity-50">
                                                {sheet.hours_worked > 0 ? (sheet.volume_processed / sheet.hours_worked).toFixed(0) : 0}
                                            </td>
                                        </tr>
                                    ))}
                                    {timesheets.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-gray-500">لا توجد بيانات حضور وإنتاجية للموظفين</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    )}

                </>
            )}
        </div>
    );
};

export default ProjectManagementDashboard;
