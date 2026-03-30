// This is the new mobile-optimized KPI component
// Used only on mobile devices (< 1024px)

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../services/supabaseClient';
import { User } from '../../services/types';

interface KPIEntry {
    employee_id: string;
    employee_name?: string;
    month: string;
    productivity_score: number;
    quality_score: number;
    attendance_score: number;
    commitment_score: number;
    notes: string;
}

interface ProjectKPI {
    project_id: string;
    project_name: string;
    month: string;
    volume: number;
}

interface Employee {
    id: string;
    full_name: string;
    department?: string;
    employee_code?: string;
}

interface HRKPIsMobileProps {
    user: User;
    selectedProjectId: string;
}

// Skeleton Loader Component
const SkeletonLoader: React.FC<{ count?: number }> = ({ count = 3 }) => (
    <div className="space-y-4">
        {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="bg-gray-200 dark:bg-gray-700 rounded-lg h-20 animate-pulse" />
        ))}
    </div>
);

// KPI Card Component
interface KPICardProps {
    entry: KPIEntry;
    employee: Employee | undefined;
    onScoreChange: (empId: string, field: keyof KPIEntry, value: any) => void;
}

const KPICard: React.FC<KPICardProps> = ({ entry, employee, onScoreChange }) => {
    const avg = ((entry.productivity_score + entry.quality_score + entry.attendance_score + entry.commitment_score) / 4).toFixed(1);
    const avgNum = parseFloat(avg);

    const getStatusColor = (score: number) => {
        if (score >= 80) return 'bg-green-50 dark:bg-green-900 border-green-200 dark:border-green-700';
        if (score >= 60) return 'bg-yellow-50 dark:bg-yellow-900 border-yellow-200 dark:border-yellow-700';
        return 'bg-red-50 dark:bg-red-900 border-red-200 dark:border-red-700';
    };

    const getScoreTextColor = (score: number) => {
        if (score >= 80) return 'text-green-700 dark:text-green-300';
        if (score >= 60) return 'text-yellow-700 dark:text-yellow-300';
        return 'text-red-700 dark:text-red-300';
    };

    return (
        <div className={`p-4 md:p-6 rounded-xl border-2 transition-all ${getStatusColor(avgNum)}`}>
            <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-sm md:text-base text-gray-800 dark:text-white truncate">
                        {entry.employee_name}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{employee?.department || 'HR'}</p>
                </div>
                <div className={`flex-shrink-0 text-center px-3 py-1 rounded-full font-black text-sm ${getScoreTextColor(avgNum)}`}>
                    {avg}%
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {[
                    { label: 'إنتاجية', field: 'productivity_score', icon: '⚡' },
                    { label: 'جودة', field: 'quality_score', icon: '✓' },
                    { label: 'التزام', field: 'attendance_score', icon: '📅' },
                    { label: 'التزام سلوك', field: 'commitment_score', icon: '👤' }
                ].map(({ label, field, icon }) => (
                    <div key={field} className="flex flex-col gap-1">
                        <label className="text-[10px] md:text-xs font-bold text-gray-600 dark:text-gray-300">
                            {icon} {label}
                        </label>
                        <input
                            type="number"
                            min="0"
                            max="100"
                            value={entry[field as keyof KPIEntry] || ''}
                            onChange={(e) => onScoreChange(entry.employee_id, field as keyof KPIEntry, parseInt(e.target.value) || 0)}
                            className="w-full px-2 py-2 text-sm font-bold text-center border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        />
                    </div>
                ))}
            </div>

            <textarea
                value={entry.notes}
                onChange={(e) => onScoreChange(entry.employee_id, 'notes', e.target.value)}
                placeholder="ملاحظات..."
                className="w-full px-3 py-2 text-xs md:text-sm border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary outline-none resize-none h-16 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
        </div>
    );
};

// Main Mobile Component
const HRKPIsMobile: React.FC<HRKPIsMobileProps> = ({ user, selectedProjectId }) => {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [kpiData, setKpiData] = useState<KPIEntry[]>([]);
    const [projectKpiData, setProjectKpiData] = useState<ProjectKPI[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
    const [isSaving, setIsSaving] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [darkMode, setDarkMode] = useState(false);
    const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
    const touchStartX = useRef(0);

    useEffect(() => {
        const handleResize = () => {
            setViewMode(window.innerWidth >= 1024 ? 'table' : 'card');
        };
        window.addEventListener('resize', handleResize);
        handleResize();
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        fetchData();
    }, [selectedMonth, selectedProjectId]);

    const fetchData = async () => {
        setLoading(true);
        try {
            let empQuery = supabase.from('hr_employees').select('id, full_name, department, employee_code').eq('status', 'active');

            const projectToFilter = (['super_admin', 'power_admin', 'it_specialist', 'hr_admin', 'project_manager'].includes(user.role))
                ? (selectedProjectId !== 'all' ? selectedProjectId : null)
                : user.projectId;

            if (projectToFilter) {
                const { data: proj } = await supabase.from('projects').select('name').eq('id', projectToFilter).single();
                if (proj) {
                    empQuery = empQuery.or(`project.eq.${proj.name},project.eq.${projectToFilter}`);
                } else {
                    empQuery = empQuery.eq('project', projectToFilter);
                }
            }
            const { data: empData } = await empQuery;
            if (empData) setEmployees(empData);

            let kpiQuery = supabase.from('hr_kpis').select('*').eq('month', selectedMonth);
            if (projectToFilter) {
                const empIds = empData?.map(e => e.id) || [];
                kpiQuery = kpiQuery.in('employee_id', empIds);
            }
            const { data: kpiRecords } = await kpiQuery;

            const merged = (empData || []).map(emp => {
                const record = kpiRecords?.find(r => r.employee_id === emp.id);
                return {
                    employee_id: emp.id,
                    employee_name: emp.full_name,
                    month: selectedMonth,
                    productivity_score: record?.productivity_score || 0,
                    quality_score: record?.quality_score || 0,
                    attendance_score: record?.attendance_score || 0,
                    commitment_score: record?.commitment_score || 0,
                    notes: record?.notes || ''
                };
            });

            setKpiData(merged);

            let projQuery = supabase.from('projects').select('id, name');
            if (projectToFilter && projectToFilter !== 'all') {
                projQuery = projQuery.eq('id', projectToFilter);
            }
            const { data: projData } = await projQuery;

            let projKpiQuery = supabase.from('hr_project_kpis').select('*').eq('month', selectedMonth);
            if (projectToFilter && projectToFilter !== 'all') {
                projKpiQuery = projKpiQuery.eq('project_id', projectToFilter);
            }
            const { data: projKpiRecords } = await projKpiQuery;

            const mergedProjects = (projData || []).map(p => {
                const record = projKpiRecords?.find(r => r.project_id === p.id);
                return {
                    project_id: p.id,
                    project_name: p.name,
                    month: selectedMonth,
                    volume: record?.volume || 0
                };
            });
            setProjectKpiData(mergedProjects);
        } catch (error) {
            console.error("Error fetching KPIs:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleScoreChange = (empId: string, field: keyof KPIEntry, value: any) => {
        setKpiData(prev => prev.map(rec =>
            rec.employee_id === empId ? { ...rec, [field]: value } : rec
        ));
    };

    const saveKPIs = async () => {
        setIsSaving(true);
        try {
            const updates = kpiData.map(rec => ({
                employee_id: rec.employee_id,
                month: rec.month,
                productivity_score: rec.productivity_score,
                quality_score: rec.quality_score,
                attendance_score: rec.attendance_score,
                commitment_score: rec.commitment_score,
                notes: rec.notes
            }));

            const projUpdates = projectKpiData.map(p => ({
                project_id: p.project_id,
                month: p.month,
                volume: p.volume
            }));

            const { error: kpiError } = await supabase.from('hr_kpis').upsert(updates, { onConflict: 'employee_id,month' });
            if (kpiError) throw kpiError;

            if (projUpdates.length > 0) {
                const { error: projError } = await supabase.from('hr_project_kpis').upsert(projUpdates, { onConflict: 'project_id,month' });
                if (projError) throw projError;
            }
            alert('تم حفظ تقييمات الأداء بنجاح');
            fetchData();
        } catch (error: any) {
            alert('حدث خطأ أثناء الحفظ: ' + error.message);
        } finally {
            setIsSaving(false);
        }
    };

    const calculateAverage = (rec: KPIEntry) => {
        return ((rec.productivity_score + rec.quality_score + rec.attendance_score + rec.commitment_score) / 4).toFixed(1);
    };

    const siteAverage = (kpiData.reduce((acc, curr) => acc + parseFloat(calculateAverage(curr)), 0) / (kpiData.length || 1)).toFixed(1);
    const filteredKpiData = kpiData.filter(rec =>
        (rec.employee_name || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
    const topEmployees = [...kpiData].sort((a, b) => parseFloat(calculateAverage(b)) - parseFloat(calculateAverage(a))).slice(0, 3);

    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartX.current = e.touches[0].clientX;
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        const touchEndX = e.changedTouches[0].clientX;
        if (touchStartX.current - touchEndX > 50) {
            setViewMode('table');
        } else if (touchEndX - touchStartX.current > 50) {
            setViewMode('card');
        }
    };

    return (
        <div className={`min-h-screen transition-colors ${darkMode ? 'dark bg-gray-900' : 'bg-gray-50'}`} dir="rtl" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
            {/* Header */}
            <div className={`sticky top-0 z-50 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} border-b shadow-sm`}>
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 md:py-4">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className={`p-2 rounded-lg ${darkMode ? 'bg-purple-900/30 text-purple-400' : 'bg-purple-50 text-purple-600'}`}>
                                <span className="material-icons">analytics</span>
                            </div>
                            <div className="min-w-0">
                                <h1 className={`text-lg md:text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>تقييم الأداء</h1>
                                <p className={`text-xs md:text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>متابعة أداء الموظفين</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                            <button
                                onClick={() => setDarkMode(!darkMode)}
                                className={`p-2 rounded-lg transition-colors ${darkMode ? 'bg-gray-700 text-yellow-400' : 'bg-gray-100 text-gray-600'}`}
                                title="تبديل الوضع الليلي"
                            >
                                <span className="material-icons">{darkMode ? 'light_mode' : 'dark_mode'}</span>
                            </button>
                            <input
                                type="month"
                                value={selectedMonth}
                                onChange={(e) => setSelectedMonth(e.target.value)}
                                className={`px-3 py-2 text-sm border-2 rounded-lg font-bold focus:ring-2 focus:ring-primary outline-none ${
                                    darkMode
                                        ? 'bg-gray-700 border-gray-600 text-white'
                                        : 'bg-white border-gray-300 text-gray-700'
                                }`}
                            />
                            <button
                                onClick={saveKPIs}
                                disabled={isSaving}
                                className="bg-primary text-white px-3 md:px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-blue-700 transition shadow-sm disabled:opacity-50 text-sm md:text-base"
                            >
                                <span className="material-icons text-base">{isSaving ? 'hourglass_top' : 'save'}</span>
                                <span className="hidden sm:inline">حفظ</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-6 space-y-6">
                {/* Summary Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className={`p-6 rounded-xl shadow-sm border-2 ${
                        darkMode
                            ? 'bg-gradient-to-br from-indigo-900 to-purple-900 border-purple-700 text-white'
                            : 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white'
                    }`}>
                        <h3 className={`text-sm font-bold mb-2 ${darkMode ? 'text-indigo-200' : 'text-indigo-100'}`}>متوسط الموقع</h3>
                        <div className="text-3xl md:text-4xl font-black mb-3">{siteAverage}%</div>
                        <div className={`w-full rounded-full h-2 overflow-hidden ${darkMode ? 'bg-white/10' : 'bg-white/20'}`}>
                            <div className="bg-white h-full transition-all duration-1000" style={{ width: `${siteAverage}%` }} />
                        </div>
                    </div>

                    <div className={`p-6 rounded-xl shadow-sm border-2 ${
                        darkMode
                            ? 'bg-gray-800 border-gray-700'
                            : 'bg-white border-gray-200'
                    }`}>
                        <h3 className={`text-sm font-bold mb-4 flex items-center gap-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            <span className="material-icons text-orange-400">workspace_premium</span>
                            أفضل موظف
                        </h3>
                        {topEmployees.length > 0 && (
                            <div>
                                <div className={`font-bold text-lg ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                                    {topEmployees[0]?.employee_name}
                                </div>
                                <div className={`text-2xl font-black ${darkMode ? 'text-yellow-400' : 'text-yellow-600'}`}>
                                    {calculateAverage(topEmployees[0])}%
                                </div>
                            </div>
                        )}
                    </div>

                    <div className={`p-6 rounded-xl shadow-sm border-2 ${
                        darkMode
                            ? 'bg-gray-800 border-gray-700'
                            : 'bg-white border-gray-200'
                    }`}>
                        <h3 className={`text-sm font-bold mb-4 flex items-center gap-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            <span className="material-icons text-blue-500">assignment</span>
                            حجم العمل
                        </h3>
                        <div className={`text-2xl font-black ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                            {projectKpiData.reduce((s, p) => s + p.volume, 0)}
                        </div>
                    </div>
                </div>

                {/* Search */}
                <div className="relative">
                    <span className={`material-icons absolute right-3 top-1/2 -translate-y-1/2 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                        search
                    </span>
                    <input
                        type="text"
                        placeholder="ابحث عن موظف..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className={`w-full pr-10 pl-4 py-3 border-2 rounded-lg font-bold focus:ring-2 focus:ring-primary outline-none transition ${
                            darkMode
                                ? 'bg-gray-800 border-gray-600 text-white placeholder-gray-500'
                                : 'bg-white border-gray-300 text-gray-700 placeholder-gray-500'
                        }`}
                    />
                </div>

                {/* Cards */}
                {loading ? (
                    <SkeletonLoader count={5} />
                ) : filteredKpiData.length === 0 ? (
                    <div className={`p-12 text-center rounded-xl border-2 ${darkMode ? 'bg-gray-800 border-gray-700 text-gray-400' : 'bg-gray-50 border-gray-300 text-gray-500'}`}>
                        <p className="font-bold">لا توجد نتائج</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {filteredKpiData.map(entry => (
                            <KPICard
                                key={entry.employee_id}
                                entry={entry}
                                employee={employees.find(e => e.id === entry.employee_id)}
                                onScoreChange={handleScoreChange}
                            />
                        ))}
                    </div>
                )}

                {/* Project KPIs */}
                {projectKpiData.length > 0 && (
                    <div className={`p-6 rounded-xl shadow-sm border-2 ${
                        darkMode
                            ? 'bg-gray-800 border-gray-700'
                            : 'bg-white border-gray-200'
                    }`}>
                        <h3 className={`text-lg font-bold mb-4 flex items-center gap-2 ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                            <span className="material-icons text-blue-500">assignment</span>
                            حجم العمل للمشاريع
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {projectKpiData.map(p => (
                                <div key={p.project_id} className="flex flex-col gap-2">
                                    <label className={`font-bold text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                        {p.project_name}
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={p.volume || ''}
                                        onChange={(e) => setProjectKpiData(prev => prev.map(rec => rec.project_id === p.project_id ? { ...rec, volume: parseInt(e.target.value) || 0 } : rec))}
                                        className={`w-full px-3 py-2 border-2 rounded-lg font-bold text-sm focus:ring-2 focus:ring-primary outline-none transition ${
                                            darkMode
                                                ? 'bg-gray-700 border-gray-600 text-white'
                                                : 'bg-white border-gray-300 text-gray-700'
                                        }`}
                                        placeholder="حجم العمل"
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="md:hidden h-20" />

            <style>{`
                .touch-target {
                    min-height: 44px;
                    min-width: 44px;
                }
            `}</style>
        </div>
    );
};

export default HRKPIsMobile;
