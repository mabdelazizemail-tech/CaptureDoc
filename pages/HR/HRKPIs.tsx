import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabaseClient';

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

interface Employee {
    id: string;
    full_name: string;
    department?: string;
    employee_code?: string;
}

import { User } from '../../services/types';

interface HRKPIsProps {
    user: User;
}

const HRKPIs: React.FC<HRKPIsProps> = ({ user }) => {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [kpiData, setKpiData] = useState<KPIEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        fetchData();
    }, [selectedMonth]);

    const fetchData = async () => {
        setLoading(true);
        try {
            // Fetch active employees
            let empQuery = supabase.from('hr_employees').select('id, full_name, department, employee_code').eq('status', 'active');
            if (user.role === 'project_manager' && user.projectId) {
                const { data: proj } = await supabase.from('projects').select('name').eq('id', user.projectId).single();
                if (proj) {
                    empQuery = empQuery.or(`project.eq.${proj.name},project.eq.${user.projectId}`);
                } else {
                    empQuery = empQuery.eq('project', user.projectId);
                }
            }
            const { data: empData } = await empQuery;
            if (empData) setEmployees(empData);

            // Fetch KPIs for selected month
            let kpiQuery = supabase.from('hr_kpis').select('*').eq('month', selectedMonth);
            if (user.role === 'project_manager' && user.projectId) {
                const empIds = empData?.map(e => e.id) || [];
                kpiQuery = kpiQuery.in('employee_id', empIds);
            }
            const { data: kpiRecords } = await kpiQuery;

            // Merge: ensure every employee has an entry in local state
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
        } catch (error) {
            console.error("Error fetching KPIs:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleScoreChange = (empId: string, field: keyof KPIEntry, value: any) => {
        setKpiData(prev => prev.map(rec => {
            if (rec.employee_id === empId) {
                return { ...rec, [field]: value };
            }
            return rec;
        }));
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

            const { error } = await supabase.from('hr_kpis').upsert(updates, { onConflict: 'employee_id,month' });

            if (error) throw error;
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

    return (
        <div className="space-y-6 animate-fade-in-up">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-4 rounded-xl shadow-sm border border-gray-100 gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                        <span className="material-icons">analytics</span>
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">تقييم مؤشرات الأداء (KPIs)</h2>
                        <p className="text-xs text-gray-500">متابعة وتقييم أداء الموظفين الشهري</p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <input
                        type="month"
                        value={selectedMonth}
                        onChange={(e) => setSelectedMonth(e.target.value)}
                        className="border border-gray-200 rounded-lg px-4 py-2 font-bold text-gray-700 focus:ring-2 focus:ring-primary outline-none"
                    />
                    <button
                        onClick={saveKPIs}
                        disabled={isSaving}
                        className="bg-primary text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-blue-700 transition shadow-sm disabled:opacity-50"
                    >
                        <span className="material-icons">{isSaving ? 'hourglass_top' : 'save'}</span>
                        حفظ التقييمات
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Stats Summary Area */}
                <div className="lg:col-span-1 space-y-4">
                    <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-6 rounded-2xl text-white shadow-lg">
                        <h4 className="text-indigo-100 text-sm mb-1">متوسط أداء الشركة</h4>
                        <div className="text-4xl font-black mb-4">
                            {(kpiData.reduce((acc, curr) => acc + parseFloat(calculateAverage(curr)), 0) / (kpiData.length || 1)).toFixed(1)}%
                        </div>
                        <div className="w-full bg-white/20 rounded-full h-2 overflow-hidden">
                            <div
                                className="bg-white h-full transition-all duration-1000"
                                style={{ width: `${(kpiData.reduce((acc, curr) => acc + parseFloat(calculateAverage(curr)), 0) / (kpiData.length || 1))}%` }}
                            ></div>
                        </div>
                    </div>

                    <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
                        <h4 className="font-bold text-gray-700 mb-4 flex items-center gap-2 text-sm">
                            <span className="material-icons text-orange-400">workspace_premium</span>
                            أفضل الموظفين أداءً
                        </h4>
                        <div className="space-y-4">
                            {[...kpiData].sort((a, b) => parseFloat(calculateAverage(b)) - parseFloat(calculateAverage(a))).slice(0, 3).map((top, idx) => (
                                <div key={top.employee_id} className="flex items-center justify-between group">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${idx === 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-400'}`}>
                                            #{idx + 1}
                                        </div>
                                        <span className="text-sm font-medium text-gray-600 group-hover:text-primary transition">{top.employee_name}</span>
                                    </div>
                                    <span className="text-xs font-black text-gray-400">{calculateAverage(top)}%</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* KPI Input Table */}
                <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    {loading ? (
                        <div className="p-20 text-center text-gray-400">جاري تحميل البيانات...</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-right">
                                <thead className="bg-gray-50 text-gray-500 text-xs border-b">
                                    <tr>
                                        <th className="p-4 font-bold">الموظف</th>
                                        <th className="p-4 font-bold text-center">الإنتاجية</th>
                                        <th className="p-4 font-bold text-center">الجودة</th>
                                        <th className="p-4 font-bold text-center">الحضور</th>
                                        <th className="p-4 font-bold text-center">الالتزام</th>
                                        <th className="p-4 font-bold text-center">المعدل</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {kpiData.map(rec => (
                                        <tr key={rec.employee_id} className="hover:bg-gray-50 transition-colors">
                                            <td className="p-4">
                                                <div className="font-bold text-gray-800 text-sm">{rec.employee_name}</div>
                                                <div className="text-[10px] text-gray-400">{employees.find(e => e.id === rec.employee_id)?.department || 'HR'}</div>
                                            </td>
                                            <td className="p-4">
                                                <input
                                                    type="number"
                                                    min="0" max="100"
                                                    value={rec.productivity_score}
                                                    onChange={(e) => handleScoreChange(rec.employee_id, 'productivity_score', parseInt(e.target.value) || 0)}
                                                    className="w-16 p-1 border rounded text-center text-xs focus:ring-1 focus:ring-primary"
                                                />
                                            </td>
                                            <td className="p-4">
                                                <input
                                                    type="number"
                                                    min="0" max="100"
                                                    value={rec.quality_score}
                                                    onChange={(e) => handleScoreChange(rec.employee_id, 'quality_score', parseInt(e.target.value) || 0)}
                                                    className="w-16 p-1 border rounded text-center text-xs focus:ring-1 focus:ring-primary"
                                                />
                                            </td>
                                            <td className="p-4">
                                                <input
                                                    type="number"
                                                    min="0" max="100"
                                                    value={rec.attendance_score}
                                                    onChange={(e) => handleScoreChange(rec.employee_id, 'attendance_score', parseInt(e.target.value) || 0)}
                                                    className="w-16 p-1 border rounded text-center text-xs focus:ring-1 focus:ring-primary"
                                                />
                                            </td>
                                            <td className="p-4">
                                                <input
                                                    type="number"
                                                    min="0" max="100"
                                                    value={rec.commitment_score}
                                                    onChange={(e) => handleScoreChange(rec.employee_id, 'commitment_score', parseInt(e.target.value) || 0)}
                                                    className="w-16 p-1 border rounded text-center text-xs focus:ring-1 focus:ring-primary"
                                                />
                                            </td>
                                            <td className="p-4 text-center">
                                                <span className={`px-2 py-1 rounded-full text-[10px] font-black ${parseFloat(calculateAverage(rec)) > 75 ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                                                    {calculateAverage(rec)}%
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default HRKPIs;
