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
    insurance_salary: number;
    target_volume?: number;
    hire_date?: string;
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
    insurance_salary: number;
    overtime_hours: number;
    overtime_amount: number;
    absence_days: number;
    penalty_days: number;
    late_deduction: number;
    taxes: number;
    insurance: number;
    martyrs: number;
    target_achieved: number;
    target_volume: number;
    gross_salary: number;
    net_salary: number;
    status: 'draft' | 'finalized';
    employee_percent?: number;
    hire_date?: string;
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
    const [globalPercent, setGlobalPercent] = useState<number>(100);

    const isAdmin = user.role === 'super_admin' || user.role === 'power_admin' || user.role === 'it_specialist' || user.role === 'hr_admin';

    useEffect(() => {
        fetchData();
    }, [selectedMonth, selectedProjectId]);

    const fetchData = async () => {
        setLoading(true);
        try {
            // Fetch active employees
            let empQuery = supabase.from('hr_employees')
                .select('id, full_name, department, employee_code, basic_salary, variable_salary, insurance_salary, target_volume, project, hire_date')
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

            // Fetch Project KPIs (Volumes)
            const { data: projKpiData } = await supabase.from('hr_project_kpis').select('*').eq('month', selectedMonth);
            const { data: allProjects } = await supabase.from('projects').select('id, name, contract_monthly_volume');

            // Merge: ensure every employee has a payroll entry to edit
            const merged = (empData || []).map((emp) => {
                const record = payRecords?.find(r => r.employee_id === emp.id);
                // basic_salary from hr_employees is authoritative for new records, but use historic basic_salary if finalized/draft exists.
                const basic = record ? parseFloat(record.basic_salary || '0') : parseFloat(emp.basic_salary || '0');
                const variable = parseFloat(emp.variable_salary || '0');
                const insuranceSalary = parseFloat(emp.insurance_salary || '0');

                const entry = {
                    id: record?.id,
                    employee_id: emp.id,
                    employee_name: emp.full_name,
                    employee_department: emp.department,
                    employee_code: emp.employee_code,
                    month: selectedMonth,
                    basic_salary: basic,
                    variable_salary: variable,
                    insurance_salary: insuranceSalary,
                    hire_date: emp.hire_date,
                    target_volume: (() => {
                        const proj = allProjects?.find(p => p.id === emp.project || p.name === emp.project);
                        return proj?.contract_monthly_volume || emp.target_volume || 0;
                    })(),
                    target_achieved: (() => {
                        if (record) {
                            return parseFloat(record.target_achieved || '0');
                        }

                        const projectVolume = (() => {
                            const proj = allProjects?.find(p => p.id === emp.project || p.name === emp.project);
                            const kpi = projKpiData?.find(k => k.project_id === proj?.id);
                            return kpi?.volume || 0;
                        })();
                        return projectVolume;
                    })(),
                    overtime_hours: record ? parseFloat(record.overtime_hours || '0') : 0,
                    absence_days: record ? parseFloat(record.absence_days || '0') : 0,
                    penalty_days: record ? parseFloat(record.penalty_days || '0') : 0,
                    status: record?.status || 'draft'
                } as any;

                // Pass the correct insuranceSalary instead of undefined
                return calculatePayrollRow(entry, basic, variable, insuranceSalary);
            });

            setPayrollData(merged);
        } catch (error) {
            console.error("Error fetching payroll:", error);
        } finally {
            setLoading(false);
        }
    };

    const calculatePayrollRow = (entry: any, rawBasic: number | string, rawVariable: number | string, rawInsuranceSalary: number | string): PayrollEntry => {
        const basic = parseFloat(rawBasic as string) || 0;
        const variable = parseFloat(rawVariable as string) || 0;
        const insuranceSalary = parseFloat(rawInsuranceSalary as string) || 0;

        const hourlyWage = basic / 240;
        const overtimeAmount = (entry.overtime_hours || 0) * hourlyWage;

        // Calculate percentage for variable salary
        let employeePercent = globalPercent;
        if (entry.employee_percent !== undefined) {
            employeePercent = entry.employee_percent;
        } else if (entry.target_volume && entry.target_volume > 0) {
            employeePercent = (entry.target_achieved / entry.target_volume) * 100;
        } else if (entry.id || entry.target_achieved > 0) {
            employeePercent = entry.target_achieved;
        }

        const actualVariable = variable * (employeePercent / 100);

        const grossSalary = basic + actualVariable + overtimeAmount;

        const dailyWage = basic / 30;
        const lateDeduction = ((entry.absence_days || 0) + (entry.penalty_days || 0)) * dailyWage;

        // Calculate insurance strictly from insurance_salary (الاجر التامينى), capped at Egyptian legal limit 12600 EGP
        const cappedInsuranceSalary = Math.min(insuranceSalary > 0 ? insuranceSalary : 0, 12600);
        let insurance = cappedInsuranceSalary * 0.11;

        // New comer grace period: If hired this month and worked less than 15 days, do not deduct insurance for this first month.
        if (entry.hire_date && entry.hire_date.startsWith(entry.month)) {
            const hireYear = parseInt(entry.month.split('-')[0], 10);
            const hireMonth = parseInt(entry.month.split('-')[1], 10);
            const daysInMonth = new Date(hireYear, hireMonth, 0).getDate();
            const hireDay = parseInt(entry.hire_date.split('-')[2], 10);

            const daysWorked = daysInMonth - hireDay + 1;
            if (daysWorked < 15) {
                insurance = 0;
            }
        }

        const taxBase = (grossSalary - lateDeduction - insurance) * 12 - 20000;
        let yearlyTax = 0;
        if (taxBase > 40000) yearlyTax += Math.min(taxBase - 40000, 15000) * 0.10;
        if (taxBase > 55000) yearlyTax += Math.min(taxBase - 55000, 15000) * 0.15;
        if (taxBase > 70000) yearlyTax += Math.min(taxBase - 70000, 130000) * 0.20;
        if (taxBase > 200000) yearlyTax += Math.min(taxBase - 200000, 200000) * 0.225;
        if (taxBase > 400000) yearlyTax += Math.max(taxBase - 400000, 0) * 0.25;

        const taxes = Math.max(0, yearlyTax) / 12;
        const martyrs = grossSalary * 0.0005;
        const netSalary = grossSalary - lateDeduction - insurance - taxes - martyrs;

        return {
            ...entry,
            employee_percent: employeePercent,
            overtime_amount: Math.max(0, overtimeAmount),
            late_deduction: Math.max(0, lateDeduction),
            taxes: Math.max(0, taxes),
            insurance: Math.max(0, insurance),
            martyrs: Math.max(0, martyrs),
            gross_salary: Math.max(0, grossSalary),
            net_salary: Math.max(0, netSalary)
        } as PayrollEntry;
    };

    useEffect(() => {
        if (payrollData.length > 0) {
            setPayrollData(prev => prev.map(rec => {
                if (rec.status === 'draft') {
                    const emp = employees.find(e => e.id === rec.employee_id);
                    return calculatePayrollRow(rec, rec.basic_salary, emp?.variable_salary || 0, emp?.insurance_salary || 0);
                }
                return rec;
            }));
        }
    }, [globalPercent]);

    const handleAmountChange = (empId: string, field: 'overtime_hours' | 'absence_days' | 'penalty_days' | 'target_achieved', value: number) => {
        setPayrollData(prev => prev.map(rec => {
            if (rec.employee_id === empId && rec.status === 'draft') {
                const newRec = { ...rec, [field]: value };
                const emp = employees.find(e => e.id === empId);
                newRec.hire_date = emp?.hire_date || rec.hire_date;
                return calculatePayrollRow(newRec, newRec.basic_salary, emp?.variable_salary || 0, emp?.insurance_salary || 0);
            }
            return rec;
        }));
    };

    const handlePercentChange = (empId: string, percentVal: number) => {
        setPayrollData(prev => prev.map(rec => {
            if (rec.employee_id === empId && rec.status === 'draft') {
                const newRec = { ...rec, employee_percent: percentVal };
                if (newRec.target_volume && newRec.target_volume > 0) {
                    newRec.target_achieved = (percentVal / 100) * newRec.target_volume;
                } else {
                    newRec.target_achieved = percentVal;
                }
                const emp = employees.find(e => e.id === empId);
                newRec.hire_date = emp?.hire_date || rec.hire_date;
                return calculatePayrollRow(newRec, newRec.basic_salary, emp?.variable_salary || 0, emp?.insurance_salary || 0);
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
                employee_id: rec.employee_id,
                month: rec.month,
                basic_salary: rec.basic_salary,
                overtime_hours: rec.overtime_hours,
                overtime_amount: rec.overtime_amount,
                absence_days: rec.absence_days,
                penalty_days: rec.penalty_days,
                late_deduction: rec.late_deduction,
                target_achieved: rec.target_achieved,
                taxes: rec.taxes,
                insurance: rec.insurance,
                martyrs: rec.martyrs,
                gross_salary: rec.gross_salary,
                net_salary: rec.net_salary,
                status: status === 'finalized' ? 'finalized' : rec.status
            }));

            const { error } = await supabase.from('hr_payroll').upsert(updates, { onConflict: 'employee_id,month' });

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
        const headers = ['الموظف', 'الرقم الوظيفي', 'القسم', 'الأساسي', 'نسبة الإنجاز', 'المتغير الفعلي', 'إجمالي الراتب', 'ساعات إضافي', 'قيمة الإضافي', 'أيام غياب', 'أيام جزاء', 'قيمة الخصم', 'تأمين', 'ضرائب', 'الشهداء', 'الصافي', 'الحالة'];
        const data = payrollData.map(r => [
            r.employee_name,
            r.employee_code || '-',
            r.employee_department || '-',
            r.basic_salary,
            `${Math.round(r.employee_percent || globalPercent)}%`,
            r.variable_salary * ((r.employee_percent || globalPercent) / 100),
            r.gross_salary,
            r.overtime_hours,
            r.overtime_amount,
            r.absence_days,
            r.penalty_days,
            r.late_deduction,
            r.insurance,
            r.taxes,
            r.martyrs,
            r.net_salary,
            r.status === 'finalized' ? 'معتمد' : 'مسودة'
        ]);

        const worksheet = XLSX.utils.aoa_to_sheet([headers, ...data]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, `Payroll_${selectedMonth}`);
        XLSX.writeFile(workbook, `Payroll_${selectedMonth}.xlsx`);
    };

    const downloadAdjustmentsTemplate = () => {
        const headers = ['employee_code', 'employee_id', 'employee_name', 'absence_days', 'overtime_hours', 'penalty_days', 'completion_percent'];
        const data = payrollData.map(r => [
            r.employee_code || '',
            r.employee_id || '',
            r.employee_name || '',
            r.absence_days || 0,
            r.overtime_hours || 0,
            r.penalty_days || 0,
            r.employee_percent !== undefined ? Math.round(r.employee_percent) : globalPercent
        ]);
        const worksheet = XLSX.utils.aoa_to_sheet([headers, ...data]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Adjustments');
        XLSX.writeFile(workbook, `Payroll_Adjustments_${selectedMonth}.xlsx`);
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data);
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json<any>(worksheet);

            let successCount = 0;
            let errorCount = 0;
            const updatedData = [...payrollData];

            for (const row of jsonData) {
                const empCode = row.employee_code || row['الرقم الوظيفي'] || row['Employee Code'];
                const empId = row.employee_id || row['ID'] || row['Employee ID'];

                let targetRecIdx = -1;
                if (empCode) {
                    targetRecIdx = updatedData.findIndex(r => String(r.employee_code) === String(empCode));
                }
                if (targetRecIdx === -1 && empId) {
                    targetRecIdx = updatedData.findIndex(r => String(r.employee_id) === String(empId));
                }

                if (targetRecIdx !== -1) {
                    const rec = updatedData[targetRecIdx];
                    if (rec.status !== 'finalized') {
                        const abs = parseFloat(row.absence_days || row['أيام غياب'] || row['Absence Days']) || 0;
                        const ovt = parseFloat(row.overtime_hours || row['ساعات إضافي'] || row['Overtime Hours']) || 0;
                        const pen = parseFloat(row.penalty_days || row['أيام جزاء'] || row['Penalty Days']) || 0;

                        const compPercentRaw = row.completion_percent ?? row['نسبة الإنجاز'] ?? row['Completion Percent'];
                        const compPercent = compPercentRaw !== undefined ? parseFloat(compPercentRaw) : undefined;

                        const newRec = {
                            ...rec,
                            absence_days: abs,
                            overtime_hours: ovt,
                            penalty_days: pen
                        };

                        if (compPercent !== undefined && !isNaN(compPercent)) {
                            newRec.employee_percent = compPercent;
                            if (newRec.target_volume && newRec.target_volume > 0) {
                                newRec.target_achieved = (compPercent / 100) * newRec.target_volume;
                            } else {
                                newRec.target_achieved = compPercent;
                            }
                        }

                        const emp = employees.find(e => e.id === newRec.employee_id);
                        updatedData[targetRecIdx] = calculatePayrollRow(newRec, newRec.basic_salary, emp?.variable_salary || 0, emp?.insurance_salary || 0);
                        successCount++;
                    } else {
                        errorCount++;
                    }
                } else {
                    errorCount++;
                }
            }

            setPayrollData(updatedData);
            alert(`تم رفع الملف: نجاح (${successCount}) موظف. يرجى مراجعة الجدول ثم الضغط على "مسودة" لحفظ التعديلات.`);
        } catch (err: any) {
            alert("حدث خطأ أثناء رفع الملف: " + err.message);
        } finally {
            e.target.value = '';
        }
    };

    const printPayslip = (rec: PayrollEntry) => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert("يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة قسيمة الراتب.");
            return;
        }

        const html = `
            <!DOCTYPE html>
            <html dir="rtl" lang="ar">
            <head>
                <meta charset="utf-8">
                <title>قسيمة راتب - ${rec.employee_name}</title>
                <style>
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; color: #333; max-width: 800px; margin: 0 auto; }
                    .header { text-align: center; border-bottom: 2px solid #2563eb; padding-bottom: 10px; margin-bottom: 20px; }
                    .header h1 { margin: 0; color: #1e3a8a; font-size: 24px; }
                    .header p { margin: 5px 0 0; color: #64748b; font-size: 14px; }
                    .details-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); font-size: 14px; }
                    .details-table th, .details-table td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: right; }
                    .details-table th { background-color: #f8fafc; width: 40%; font-weight: bold; color: #475569; }
                    .footer { margin-top: 30px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px; }
                    .section-title { background: #1e3a8a; color: white; padding: 8px 12px; margin: 0; border-radius: 6px 6px 0 0; font-size: 15px; }
                    .net-salary-box { margin-top: 20px; border: 2px dashed #10b981; background: #ecfdf5; padding: 15px; border-radius: 12px; text-align: center; }
                    @page { size: A4; margin: 10mm; }
                    @media print {
                        body { padding: 0; max-width: 100%; margin: 0; }
                        .details-table { box-shadow: none; margin-bottom: 15px; }
                        .header { padding-bottom: 10px; margin-bottom: 15px; }
                        .net-salary-box { margin-top: 15px; padding: 10px; }
                        .footer { margin-top: 20px; padding-top: 10px; }
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>قسيمة راتب (Payslip)</h1>
                    <p>عن شهر: <strong>${selectedMonth}</strong></p>
                </div>
                
                <div class="section-title">بيانات الموظف الأساسية</div>
                <table class="details-table">
                    <tr><th>اسم الموظف</th><td><strong>${rec.employee_name}</strong></td></tr>
                    <tr><th>الرقم الوظيفي</th><td>${rec.employee_code || '-'}</td></tr>
                    <tr><th>القسم / الإدارة</th><td>${rec.employee_department || '-'}</td></tr>
                </table>

                <div class="section-title">الاستحقاقات (Earnings)</div>
                <table class="details-table">
                    <tr><th>الراتب الأساسي</th><td>${rec.basic_salary.toLocaleString('en-US', { minimumFractionDigits: 2 })} EGP</td></tr>
                    <tr><th>الراتب المتغير (${Math.round(rec.employee_percent || globalPercent)}%)</th><td>${(rec.variable_salary * ((rec.employee_percent || globalPercent) / 100)).toLocaleString('en-US', { minimumFractionDigits: 2 })} EGP</td></tr>
                    <tr><th>قيمة العمل الإضافي (${rec.overtime_hours} ساعة)</th><td>${rec.overtime_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} EGP</td></tr>
                    <tr style="background:#f0fdf4; font-size: 16px;"><th><strong>إجمالي الاستحقاقات</strong></th><td><strong>${rec.gross_salary.toLocaleString('en-US', { minimumFractionDigits: 2 })} EGP</strong></td></tr>
                </table>

                <div class="section-title" style="background: #be123c;">الاستقطاعات (Deductions)</div>
                <table class="details-table">
                    <tr><th>أيام الغياب (${rec.absence_days}) والجزاءات (${rec.penalty_days})</th><td>${rec.late_deduction.toLocaleString('en-US', { minimumFractionDigits: 2 })} EGP</td></tr>
                    <tr><th>التأمينات الاجتماعية</th><td>${rec.insurance.toLocaleString('en-US', { minimumFractionDigits: 2 })} EGP</td></tr>
                    <tr><th>الضرائب</th><td>${rec.taxes.toLocaleString('en-US', { minimumFractionDigits: 2 })} EGP</td></tr>
                    <tr><th>صندوق تكريم الشهداء</th><td>${rec.martyrs.toLocaleString('en-US', { minimumFractionDigits: 2 })} EGP</td></tr>
                    <tr style="background:#fff1f2; font-size: 16px;"><th><strong>إجمالي الاستقطاعات</strong></th><td><strong>${(rec.late_deduction + rec.insurance + rec.taxes + rec.martyrs).toLocaleString('en-US', { minimumFractionDigits: 2 })} EGP</strong></td></tr>
                </table>

                <div class="net-salary-box">
                    <h2 style="margin:0 0 10px; color:#065f46; font-size: 20px;">صافي الراتب المستحق (Net Salary)</h2>
                    <h1 style="margin:0; color:#047857; font-size: 36px;">${rec.net_salary.toLocaleString('en-US', { minimumFractionDigits: 2 })} EGP</h1>
                </div>

                <div class="footer">
                    <p>تم إصدار هذه القسيمة إلكترونياً من نظام Capture Flow ولا تحتاج إلى توقيع.</p>
                </div>
                <script>
                    window.onload = function() { 
                        setTimeout(function() {
                            window.print(); 
                            window.close(); 
                        }, 500);
                    }
                </script>
            </body>
            </html>
        `;

        printWindow.document.write(html);
        printWindow.document.close();
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

                <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto custom-scrollbar pb-1">
                    <input
                        type="month"
                        value={selectedMonth}
                        onChange={(e) => setSelectedMonth(e.target.value)}
                        className="border border-gray-200 rounded-md px-2 py-1 font-bold text-sm text-gray-700 focus:ring-1 focus:ring-primary outline-none shrink-0"
                    />

                    <div className="flex items-center gap-1.5 bg-blue-50 px-2 py-1 rounded-md border border-blue-100 shrink-0 whitespace-nowrap">
                        <span className="text-[11px] font-bold text-blue-600">نسبة الإنجاز:</span>
                        <div className="relative">
                            <input
                                type="number"
                                value={globalPercent}
                                onChange={(e) => setGlobalPercent(parseFloat(e.target.value) || 0)}
                                className="w-16 pl-6 pr-1 py-0.5 border border-blue-200 rounded text-xs font-bold text-blue-800 outline-none focus:ring-1 focus:ring-blue-400"
                                min="0" max="200"
                            />
                            <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-blue-400 font-bold">%</span>
                        </div>
                    </div>

                    <button
                        onClick={downloadExcel}
                        className="bg-white border text-gray-600 px-2 py-1 text-xs rounded-md font-bold flex items-center gap-1.5 hover:bg-gray-50 transition shadow-sm shrink-0 whitespace-nowrap"
                        title="تصدير كشف الرواتب"
                    >
                        <span className="material-icons text-[14px]">download</span>
                        تصدير Excel
                    </button>

                    {isAdmin && (
                        <>
                            <button
                                onClick={downloadAdjustmentsTemplate}
                                className="bg-white border text-blue-600 border-blue-200 px-2 py-1 text-xs rounded-md font-bold flex items-center gap-1.5 hover:bg-blue-50 transition shadow-sm shrink-0 whitespace-nowrap"
                                title="تحميل قالب مؤثرات الرواتب"
                            >
                                <span className="material-icons text-[14px]">file_download</span>
                                قالب المؤثرات
                            </button>

                            <label className="bg-white border text-primary border-primary px-2 py-1 text-xs rounded-md font-bold flex items-center gap-1.5 hover:bg-blue-50 cursor-pointer transition shadow-sm shrink-0 whitespace-nowrap">
                                <span className="material-icons text-[14px]">upload_file</span>
                                رفع مؤثرات
                                <input type="file" hidden accept=".xlsx, .xls, .csv" onChange={handleFileUpload} />
                            </label>

                            <button
                                onClick={() => savePayroll('draft')}
                                disabled={isSaving || allFinalized}
                                className={`bg-gray-100 text-gray-700 px-2 py-1 text-xs rounded-md font-bold flex items-center gap-1.5 transition shadow-sm shrink-0 whitespace-nowrap ${(isSaving || allFinalized) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-200'}`}
                            >
                                <span className="material-icons text-[14px]">{isSaving ? 'hourglass_top' : 'save'}</span>
                                مسودة
                            </button>

                            <button
                                onClick={() => savePayroll('finalized')}
                                disabled={isFinalizing || allFinalized || payrollData.length === 0}
                                className={`bg-primary text-white px-3 py-1 text-xs rounded-md font-bold flex items-center gap-1.5 transition shadow-sm shrink-0 whitespace-nowrap ${(isFinalizing || allFinalized || payrollData.length === 0) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-700'}`}
                            >
                                <span className="material-icons text-[14px]">{isFinalizing ? 'hourglass_top' : 'verified'}</span>
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
                            <thead className="bg-gray-50 text-gray-600 text-[11px] border-b">
                                <tr>
                                    <th className="p-1 px-2 whitespace-nowrap font-bold text-right">الموظف</th>
                                    <th className="p-1 px-2 whitespace-nowrap font-bold text-center">الأساسي</th>
                                    <th className="p-1 px-2 whitespace-nowrap font-bold text-center">نسبة الإنجاز %</th>
                                    <th className="p-1 px-2 whitespace-nowrap font-bold text-center">المتغير الفعلي</th>
                                    <th className="p-1 px-2 whitespace-nowrap font-bold text-center text-green-600">إضافي (س)</th>
                                    <th className="p-1 px-2 whitespace-nowrap font-bold text-center text-red-600">الغياب (ي)</th>
                                    <th className="p-1 px-2 whitespace-nowrap font-bold text-center text-red-600">الجزاءات (ي)</th>
                                    <th className="p-1 px-2 whitespace-nowrap font-bold text-center">تأمين/ضرائب</th>
                                    <th className="p-1 px-2 whitespace-nowrap font-bold text-center text-primary">الصافي (EGP)</th>
                                    <th className="p-1 px-2 whitespace-nowrap font-bold text-center">الحالة</th>
                                    <th className="p-1 px-2 whitespace-nowrap font-bold text-center">الإجراءات</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {payrollData.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="p-8 text-center text-gray-400">لا يوجد موظفين لعرض الرواتب.</td>
                                    </tr>
                                )}
                                {payrollData.map(rec => (
                                    <tr key={rec.employee_id} className="hover:bg-gray-50 transition-colors">
                                        <td className="p-1 px-2 whitespace-nowrap">
                                            <div className="font-bold text-gray-800 text-xs">{rec.employee_name}</div>
                                            <div className="text-[10px] text-gray-400 font-mono">
                                                {rec.employee_code || '-'} | {rec.employee_department?.substring(0, 10) || 'HR'}
                                            </div>
                                        </td>
                                        <td className="p-1 px-2 whitespace-nowrap text-center text-xs font-bold text-gray-600">
                                            {rec.basic_salary.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                        </td>
                                        <td className="p-1 px-2 whitespace-nowrap">
                                            <input
                                                type="number"
                                                min="0" max="999" step="1"
                                                value={rec.employee_percent !== undefined ? Math.round(rec.employee_percent) : globalPercent}
                                                disabled={rec.status === 'finalized' || !isAdmin}
                                                onChange={(e) => handlePercentChange(rec.employee_id, parseFloat(e.target.value) || 0)}
                                                className={`w-14 mx-auto block p-1 border rounded text-center text-xs focus:ring-1 focus:ring-primary outline-none transition-colors ${rec.employee_percent && rec.employee_percent < 100 ? 'text-red-600 border-red-200 bg-red-50' : (rec.employee_percent && rec.employee_percent >= 100 ? 'text-green-600 border-green-200 bg-green-50' : 'text-blue-700 bg-blue-50/50')} ${rec.status === 'finalized' ? 'bg-gray-100 cursor-not-allowed text-gray-500 border-gray-100' : ''}`}
                                            />
                                        </td>
                                        <td className="p-1 px-2 whitespace-nowrap text-center text-xs font-bold text-blue-700 bg-blue-50/30">
                                            {((rec.variable_salary || 0) * ((rec.employee_percent || globalPercent) / 100)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                            <div className="text-[10px] text-blue-400 font-normal">من أصل {(rec.variable_salary || 0).toLocaleString()}</div>
                                        </td>
                                        <td className="p-1 px-2 whitespace-nowrap">
                                            <input
                                                type="number"
                                                min="0" step="0.5"
                                                value={rec.overtime_hours}
                                                disabled={rec.status === 'finalized' || !isAdmin}
                                                onChange={(e) => handleAmountChange(rec.employee_id, 'overtime_hours', parseFloat(e.target.value) || 0)}
                                                className={`w-14 mx-auto block p-1 border rounded text-center text-xs focus:ring-1 focus:ring-primary outline-none transition-colors ${rec.overtime_hours > 0 ? 'bg-green-50 text-green-700 border-green-200' : ''} ${rec.status === 'finalized' ? 'bg-gray-100 cursor-not-allowed text-gray-500 border-gray-100' : ''}`}
                                            />
                                        </td>
                                        <td className="p-1 px-2 whitespace-nowrap">
                                            <input
                                                type="number"
                                                min="0" step="0.5"
                                                value={rec.absence_days}
                                                disabled={rec.status === 'finalized' || !isAdmin}
                                                onChange={(e) => handleAmountChange(rec.employee_id, 'absence_days', parseFloat(e.target.value) || 0)}
                                                className={`w-14 mx-auto block p-1 border rounded text-center text-xs text-red-600 focus:ring-1 focus:ring-red-400 outline-none transition-colors ${rec.absence_days > 0 ? 'bg-red-50 text-red-700 border-red-200' : ''} ${rec.status === 'finalized' ? 'bg-gray-100 cursor-not-allowed text-gray-500 border-gray-100' : ''}`}
                                            />
                                        </td>
                                        <td className="p-1 px-2 whitespace-nowrap">
                                            <input
                                                type="number"
                                                min="0" step="0.5"
                                                value={rec.penalty_days}
                                                disabled={rec.status === 'finalized' || !isAdmin}
                                                onChange={(e) => handleAmountChange(rec.employee_id, 'penalty_days', parseFloat(e.target.value) || 0)}
                                                className={`w-14 mx-auto block p-1 border rounded text-center text-xs text-red-600 focus:ring-1 focus:ring-red-400 outline-none transition-colors ${rec.penalty_days > 0 ? 'bg-orange-50 text-orange-700 border-orange-200' : ''} ${rec.status === 'finalized' ? 'bg-gray-100 cursor-not-allowed text-gray-500 border-gray-100' : ''}`}
                                            />
                                        </td>
                                        <td className="p-1 px-2 whitespace-nowrap text-center text-[10px] text-gray-500">
                                            <div title={`Tax: ${rec.taxes.toFixed(2)}, Martyrs: ${rec.martyrs.toFixed(2)}`}>ت: {rec.insurance.toFixed(1)}</div>
                                            <div>ض: {rec.taxes.toFixed(1)}</div>
                                        </td>
                                        <td className="p-1 px-2 whitespace-nowrap text-center text-sm font-black text-primary bg-blue-50/20">
                                            {rec.net_salary.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                        </td>
                                        <td className="p-1 px-2 whitespace-nowrap text-center">
                                            <span className={`px-2 py-1 flex items-center justify-center gap-1 mx-auto w-fit rounded-full text-[10px] font-black uppercase tracking-wider ${rec.status === 'finalized' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                                                {rec.status === 'finalized' ? <><span className="material-icons text-[12px]">verified</span> معتمد</> : <><span className="material-icons text-[12px]">edit</span> مسودة</>}
                                            </span>
                                        </td>
                                        <td className="p-2 whitespace-nowrap text-center">
                                            <button
                                                onClick={() => printPayslip(rec)}
                                                className="text-gray-400 hover:text-blue-600 p-1.5 rounded hover:bg-blue-50 transition-colors"
                                                title="طباعة القسيمة PDF"
                                            >
                                                <span className="material-icons text-sm">print</span>
                                            </button>
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
