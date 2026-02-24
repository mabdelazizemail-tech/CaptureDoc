import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabaseClient';
import { User } from '../../services/types';
import * as XLSX from 'xlsx';

interface Employee {
    id: string;
    full_name: string;
    department?: string;
    employee_code?: string;
    basic_salary: number;
    variable_salary: number;
}

interface PayrollEntry {
    id?: string;
    employee_id: string;
    employee_name?: string;
    employee_department?: string;
    employee_code?: string;
    month: string;
    basic_salary: number;
    variable_salary: number;
    overtime_amount: number;
    late_deduction: number;
    net_salary: number;
    status: 'draft' | 'finalized';
}

interface HRPayrollProps {
    user: User;
    selectedProjectId: string;
}

const HRPayroll: React.FC<HRPayrollProps> = ({ user, selectedProjectId }) => {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [payrollData, setPayrollData] = useState<PayrollEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
    const [isSaving, setIsSaving] = useState(false);
    const [isFinalizing, setIsFinalizing] = useState(false);

    const isAdmin = user.role === 'super_admin' || user.role === 'power_admin' || user.role === 'it_specialist' || user.role === 'hr_admin';

    useEffect(() => {
        fetchData();
    }, [selectedMonth, selectedProjectId]);

    const fetchData = async () => {
        setLoading(true);
        try {
            // Fetch active employees
            let empQuery = supabase.from('hr_employees')
                .select('id, full_name, department, employee_code, basic_salary, variable_salary')
                .eq('status', 'active');

            const projectToFilter = (user.role === 'super_admin' || user.role === 'power_admin' || user.role === 'it_specialist' || user.role === 'hr_admin')
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

            // Fetch payroll for selected month
            let payrollQuery = supabase.from('hr_payroll').select('*').eq('month', selectedMonth);
            if (projectToFilter) {
                const empIds = empData?.map(e => e.id) || [];
                payrollQuery = payrollQuery.in('employee_id', empIds);
            }
            const { data: payRecords } = await payrollQuery;

            // Merge: ensure every employee has a payroll entry to edit
            const merged = (empData || []).map((emp) => {
                const record = payRecords?.find(r => r.employee_id === emp.id);
                // basic_salary from hr_employees is authoritative for new records, but use historic basic_salary if finalized/draft exists.
                const basic = record ? parseFloat(record.basic_salary) : emp.basic_salary;
                const overtime = record ? parseFloat(record.overtime_amount) : 0;
                const late = record ? parseFloat(record.late_deduction) : 0;
                // Net = Basic + Variable + Overtime - Late
                const variable = emp.variable_salary || 0;
                const net = record ? parseFloat(record.net_salary) : (basic + variable + overtime - late);

                return {
                    id: record?.id,
                    employee_id: emp.id,
                    employee_name: emp.full_name,
                    employee_department: emp.department,
                    employee_code: emp.employee_code,
                    month: selectedMonth,
                    basic_salary: basic,
                    variable_salary: variable,
                    overtime_amount: overtime,
                    late_deduction: late,
                    net_salary: net,
                    status: record?.status || 'draft'
                } as PayrollEntry;
            });

            setPayrollData(merged);
        } catch (error) {
            console.error("Error fetching payroll:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleAmountChange = (empId: string, field: 'overtime_amount' | 'late_deduction', value: number) => {
        setPayrollData(prev => prev.map(rec => {
            if (rec.employee_id === empId && rec.status === 'draft') {
                const newRec = { ...rec, [field]: value };
                // Recalculate net salary dynamically
                newRec.net_salary = newRec.basic_salary + newRec.variable_salary + newRec.overtime_amount - newRec.late_deduction;
                return newRec;
            }
            return rec;
        }));
    };

    const savePayroll = async (status: 'draft' | 'finalized') => {
        if (status === 'finalized' && !confirm('هل أنت متأكد من اعتماد الرواتب نهائياً؟ لا يمكن التعديل بعد الاعتماد.')) return;

        if (status === 'draft') setIsSaving(true);
        if (status === 'finalized') setIsFinalizing(true);

        try {
            const updates = payrollData.map(rec => ({
                id: rec.id, // Supabase upsert needs id if updating
                employee_id: rec.employee_id,
                month: rec.month,
                basic_salary: rec.basic_salary,
                overtime_amount: rec.overtime_amount,
                late_deduction: rec.late_deduction,
                net_salary: rec.net_salary,
                status: status === 'finalized' ? 'finalized' : rec.status
            }));

            // To upsert properly and avoid duplicate employee_id/month errors on insert-only logic, 
            // since we have an ID on existing ones, we can just upsert by the conflict target (employee_id, month)
            // But if id is undefined, we strip it so Postgres generates it.
            const cleanUpdates = updates.map(u => {
                if (!u.id) delete u.id;
                return u;
            });

            const { error } = await supabase.from('hr_payroll').upsert(cleanUpdates, { onConflict: 'employee_id,month' });

            if (error) throw error;
            alert(`تم ${status === 'finalized' ? 'اعتماد' : 'حفظ'} الرواتب بنجاح`);
            fetchData();
        } catch (error: any) {
            alert('حدث خطأ أثناء الحفظ: ' + error.message);
        } finally {
            setIsSaving(false);
            setIsFinalizing(false);
        }
    };

    const downloadExcel = () => {
        const headers = ['الموظف', 'الرقم الوظيفي', 'القسم', 'الراتب الأساسي', 'البدلات (المتغير)', 'الإضافي', 'الخصم', 'الصافي', 'الحالة'];
        const data = payrollData.map(r => [
            r.employee_name,
            r.employee_code || '-',
            r.employee_department || '-',
            r.basic_salary,
            r.variable_salary,
            r.overtime_amount,
            r.late_deduction,
            r.net_salary,
            r.status === 'finalized' ? 'معتمد' : 'مسودة'
        ]);

        const worksheet = XLSX.utils.aoa_to_sheet([headers, ...data]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, `Payroll_${selectedMonth}`);
        XLSX.writeFile(workbook, `Payroll_${selectedMonth}.xlsx`);
    };

    const totalPayroll = payrollData.reduce((acc, curr) => acc + curr.net_salary, 0);
    const totalOvertime = payrollData.reduce((acc, curr) => acc + curr.overtime_amount, 0);
    const totalDeductions = payrollData.reduce((acc, curr) => acc + curr.late_deduction, 0);

    const allFinalized = payrollData.length > 0 && payrollData.every(r => r.status === 'finalized');

    return (
        <div className="space-y-6 animate-fade-in-up">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-4 rounded-xl shadow-sm border border-gray-100 gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-50 text-green-600 rounded-lg">
                        <span className="material-icons">payments</span>
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">إدارة الرواتب (Payroll)</h2>
                        <p className="text-xs text-gray-500">مراجعة وحساب صافي رواتب الموظفين الشهرية</p>
                    </div>
                </div>

                <div className="flex items-center gap-4 flex-wrap w-full md:w-auto">
                    <input
                        type="month"
                        value={selectedMonth}
                        onChange={(e) => setSelectedMonth(e.target.value)}
                        className="border border-gray-200 rounded-lg px-4 py-2 font-bold text-gray-700 focus:ring-2 focus:ring-primary outline-none"
                    />

                    <button
                        onClick={downloadExcel}
                        className="bg-white border text-gray-600 px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-gray-50 transition shadow-sm"
                        title="تصدير كشف الرواتب"
                    >
                        <span className="material-icons text-sm">download</span>
                        تصدير Excel
                    </button>

                    {isAdmin && (
                        <>
                            <button
                                onClick={() => savePayroll('draft')}
                                disabled={isSaving || allFinalized}
                                className={`bg-gray-100 text-gray-700 px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition shadow-sm ${(isSaving || allFinalized) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-200'}`}
                            >
                                <span className="material-icons text-sm">{isSaving ? 'hourglass_top' : 'save'}</span>
                                مسودة
                            </button>

                            <button
                                onClick={() => savePayroll('finalized')}
                                disabled={isFinalizing || allFinalized || payrollData.length === 0}
                                className={`bg-primary text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition shadow-sm ${(isFinalizing || allFinalized || payrollData.length === 0) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-700'}`}
                            >
                                <span className="material-icons text-sm">{isFinalizing ? 'hourglass_top' : 'verified'}</span>
                                اعتماد نهائي
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4 hover:shadow-md transition-shadow">
                    <div className="p-3 bg-blue-50 text-blue-500 rounded-lg">
                        <span className="material-icons text-3xl">account_balance_wallet</span>
                    </div>
                    <div>
                        <h3 className="text-gray-500 text-sm font-medium">إجمالي صافي الرواتب</h3>
                        <p className="text-2xl font-bold mt-1 text-gray-800">{totalPayroll.toLocaleString('en-US', { minimumFractionDigits: 2 })} EGP</p>
                    </div>
                </div>

                <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4 hover:shadow-md transition-shadow">
                    <div className="p-3 bg-green-50 text-green-500 rounded-lg">
                        <span className="material-icons text-3xl">add_circle</span>
                    </div>
                    <div>
                        <h3 className="text-gray-500 text-sm font-medium">إجمالي الإضافي</h3>
                        <p className="text-2xl font-bold mt-1 text-gray-800">{totalOvertime.toLocaleString('en-US', { minimumFractionDigits: 2 })} EGP</p>
                    </div>
                </div>

                <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4 hover:shadow-md transition-shadow">
                    <div className="p-3 bg-red-50 text-red-500 rounded-lg">
                        <span className="material-icons text-3xl">remove_circle</span>
                    </div>
                    <div>
                        <h3 className="text-gray-500 text-sm font-medium">إجمالي الخصومات</h3>
                        <p className="text-2xl font-bold mt-1 text-gray-800">{totalDeductions.toLocaleString('en-US', { minimumFractionDigits: 2 })} EGP</p>
                    </div>
                </div>
            </div>

            {allFinalized && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-3 shadow-sm font-bold">
                    <span className="material-icons">verified</span>
                    <span>تم اعتماد الرواتب لهذا الشهر بشكل نهائي ولا يمكن تعديلها.</span>
                </div>
            )}

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                {loading ? (
                    <div className="p-20 text-center text-gray-400">
                        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
                        جاري تحميل البيانات...
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-right">
                            <thead className="bg-gray-50 text-gray-600 text-xs border-b">
                                <tr>
                                    <th className="p-4 font-bold">الموظف</th>
                                    <th className="p-4 font-bold text-center">الأساسي</th>
                                    <th className="p-4 font-bold text-center">المتغير</th>
                                    <th className="p-4 font-bold text-center">الإضافي (EGP)</th>
                                    <th className="p-4 font-bold text-center text-red-600">الخصم (EGP)</th>
                                    <th className="p-4 font-bold text-center">الصافي (EGP)</th>
                                    <th className="p-4 font-bold text-center">الحالة</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {payrollData.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="p-8 text-center text-gray-400">لا يوجد موظفين لعرض الرواتب.</td>
                                    </tr>
                                )}
                                {payrollData.map(rec => (
                                    <tr key={rec.employee_id} className="hover:bg-gray-50 transition-colors">
                                        <td className="p-4">
                                            <div className="font-bold text-gray-800 text-sm">{rec.employee_name}</div>
                                            <div className="text-[10px] text-gray-400 font-mono">
                                                {rec.employee_code || '-'} | {rec.employee_department || 'HR'}
                                            </div>
                                        </td>
                                        <td className="p-4 text-center text-sm font-bold text-gray-600">
                                            {rec.basic_salary.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                        </td>
                                        <td className="p-4 text-center text-sm font-bold text-gray-600">
                                            {rec.variable_salary.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                        </td>
                                        <td className="p-4">
                                            <input
                                                type="number"
                                                min="0" step="0.01"
                                                value={rec.overtime_amount}
                                                disabled={rec.status === 'finalized' || !isAdmin}
                                                onChange={(e) => handleAmountChange(rec.employee_id, 'overtime_amount', parseFloat(e.target.value) || 0)}
                                                className={`w-28 mx-auto block p-2 border rounded text-center text-sm focus:ring-1 focus:ring-primary outline-none transition-colors ${rec.overtime_amount > 0 ? 'bg-green-50 text-green-700 border-green-200' : ''} ${rec.status === 'finalized' ? 'bg-gray-100 cursor-not-allowed text-gray-500 border-gray-100' : ''}`}
                                            />
                                        </td>
                                        <td className="p-4">
                                            <input
                                                type="number"
                                                min="0" step="0.01"
                                                value={rec.late_deduction}
                                                disabled={rec.status === 'finalized' || !isAdmin}
                                                onChange={(e) => handleAmountChange(rec.employee_id, 'late_deduction', parseFloat(e.target.value) || 0)}
                                                className={`w-28 mx-auto block p-2 border rounded text-center text-sm text-red-600 focus:ring-1 focus:ring-red-400 outline-none transition-colors ${rec.late_deduction > 0 ? 'bg-red-50 text-red-700 border-red-200' : ''} ${rec.status === 'finalized' ? 'bg-gray-100 cursor-not-allowed text-gray-500 border-gray-100' : ''}`}
                                            />
                                        </td>
                                        <td className="p-4 text-center">
                                            <span className="text-sm font-black text-gray-800">
                                                {rec.net_salary.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                            </span>
                                        </td>
                                        <td className="p-4 text-center">
                                            <span className={`px-2 py-1 flex items-center justify-center gap-1 mx-auto w-fit rounded-full text-[10px] font-black uppercase tracking-wider ${rec.status === 'finalized' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                                                {rec.status === 'finalized' ? <><span className="material-icons text-[12px]">verified</span> معتمد</> : <><span className="material-icons text-[12px]">edit</span> مسودة</>}
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
    );
};

export default HRPayroll;
