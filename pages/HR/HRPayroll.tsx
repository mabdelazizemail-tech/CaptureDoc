import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabaseClient';
import { User } from '../../services/types';
import * as XLSX from 'xlsx';

// ─── Employee from DB ─────────────────────────────────────────────────────────
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
    national_id?: string;
    transfer_account_number?: string;
    transfer_account_type?: string;
}

// ─── Fixed policy constants (BM Salaries sheet) ───────────────────────────────
// AE = 7000/1.3  → used when employee's insurance_salary is not set
const INSURANCE_BASE_DEFAULT  = 7000 / 1.3;        // ~5384.62 EGP
// AG = 20000 ج/سنة ÷ 12
const PERSONAL_EXEMPTION_MONTHLY = 20000 / 12;     // 1666.67 EGP
const RULE_VERSION = '3.0';

// ─── PayrollEntry ─────────────────────────────────────────────────────────────
interface PayrollEntry {
    id?: string;
    employee_id: string;
    employee_name?: string;
    employee_department?: string;
    employee_code?: string;
    month: string;
    // from employee profile
    basic_salary: number;         // H
    variable_salary: number;      // I  (Total Target)
    insurance_salary: number;     // AE base
    // ── 3 user inputs ────────────────────────────────────────────────────────
    overtime_hours: number;       // S  – Overtime Number of hours
    absence_days: number;         // W  – Absence days
    penalty_days: number;         // Y  – Penalty Days
    // ── all calculated ───────────────────────────────────────────────────────
    target_value: number;         // L  = I × K (K=1)
    basic_daily: number;          // O  = H / 30
    target_daily: number;         // P  = L / 30
    daily_wage: number;           // Q  = O + P
    hourly_rate: number;          // R  = O / 8
    overtime_amount: number;      // T  = R × S
    gross_salary: number;         // V  = H + L + T
    absence_value: number;        // X  = Q × W
    penalty_value: number;        // Z  = O × Y
    total_deducted: number;       // AC = X + Z
    net_before: number;           // AD = V − AC
    insurance: number;            // AF = AE × 0.11
    annual_taxable: number;       // AH = (AD − AF − 1666.67) × 12
    taxes: number;                // AI / 12
    martyrs: number;              // AJ = AD × 0.0005
    net_salary: number;           // AM = AK − AL  (AK = AD−AF−AI−AJ, AL = advance)
    advance: number;              // AL – advance deduction
    // target achievement (kept for variable-rate support)
    employee_percent?: number;
    target_achieved: number;
    target_volume: number;
    // meta
    status: 'draft' | 'finalized';
    hire_date?: string;
    national_id?: string;
    transfer_account_number?: string;
    transfer_account_type?: string;
    annual_leave: number;
    flags?: string[];
}

interface HRPayrollProps {
    user: User;
    selectedProjectId: string;
}

const HRPayroll: React.FC<HRPayrollProps> = ({ user, selectedProjectId }) => {
    const [employees,   setEmployees]   = useState<Employee[]>([]);
    const [payrollData, setPayrollData] = useState<PayrollEntry[]>([]);
    const [loading,     setLoading]     = useState(true);
    const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
    const [isSaving,      setIsSaving]      = useState(false);
    const [isFinalizing,  setIsFinalizing]  = useState(false);
    const [globalPercent, setGlobalPercent] = useState<number>(100);
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({ key: 'employee_code', direction: 'asc' });
    const [searchTerm, setSearchTerm] = useState('');

    const isAdmin = ['super_admin','power_admin','it_specialist','hr_admin'].includes(user.role);

    useEffect(() => { fetchData(); }, [selectedMonth, selectedProjectId]);

    // ── Fetch ─────────────────────────────────────────────────────────────────
    const fetchData = async () => {
        setLoading(true);
        try {
            let empQuery = supabase.from('hr_employees')
                .select('id, full_name, national_id, department, employee_code, basic_salary, variable_salary, insurance_salary, target_volume, project, hire_date, transfer_account_number, transfer_account_type')
                .eq('status', 'active');

            const projectToFilter = (['super_admin','power_admin','it_specialist','hr_admin','project_manager'].includes(user.role))
                ? (selectedProjectId !== 'all' ? selectedProjectId : null)
                : user.projectId;

            if (projectToFilter) {
                const { data: proj } = await supabase.from('projects').select('name').eq('id', projectToFilter).single();
                if (proj) empQuery = empQuery.or(`project.eq.${proj.name},project.eq.${projectToFilter}`);
                else       empQuery = empQuery.eq('project', projectToFilter);
            }

            const { data: empData } = await empQuery;
            if (empData) setEmployees(empData);

            let payrollQuery = supabase.from('hr_payroll').select('*').eq('month', selectedMonth);
            if (projectToFilter) {
                const empIds = empData?.map(e => e.id) || [];
                payrollQuery = payrollQuery.in('employee_id', empIds);
            }
            const { data: payRecords } = await payrollQuery;

            // KPI volumes
            const startDate = `${selectedMonth}-01`;
            const nextM = new Date(selectedMonth + '-01'); nextM.setMonth(nextM.getMonth() + 1);
            const endDate = nextM.toISOString().slice(0, 10);
            const { data: projKpiDataRaw } = await supabase.from('hr_project_kpis')
                .select('*').gte('date', startDate).lt('date', endDate) as { data: { project_id: string; volume: number; date: string }[] | null };
            const projKpiData = Array.from(
                (projKpiDataRaw || []).reduce((acc, curr) => {
                    const ex = acc.get(curr.project_id) || { project_id: curr.project_id, volume: 0 };
                    ex.volume += curr.volume || 0;
                    acc.set(curr.project_id, ex);
                    return acc;
                }, new Map<string, { project_id: string; volume: number }>()).values()
            );
            const { data: allProjects } = await supabase.from('projects').select('id, name, contract_monthly_volume');

            const merged = (empData || []).map(emp => {
                const record = payRecords?.find(r => r.employee_id === emp.id);
                // If payroll record exists (draft/finalized), lock to saved data. Otherwise, use employee master data.
                const basic    = record ? parseFloat(record.basic_salary || '0') : parseFloat(emp.basic_salary || '0');
                const variable = record ? parseFloat(record.variable_salary || '0') : parseFloat(emp.variable_salary || '0');
                const insSal   = record ? parseFloat(record.insurance_salary || '0') : parseFloat(emp.insurance_salary || '0');

                const targetVol = (() => {
                    const proj = allProjects?.find(p => p.id === emp.project || p.name === emp.project);
                    return proj?.contract_monthly_volume || emp.target_volume || 0;
                })();
                const targetAch = Math.round((() => {
                    if (record) return parseFloat(record.target_achieved || '0');
                    const proj = allProjects?.find(p => p.id === emp.project || p.name === emp.project);
                    const kpi  = projKpiData?.find(k => k.project_id === proj?.id);
                    return kpi?.volume || 0;
                })());

                const entry: any = {
                    id:               record?.id,
                    employee_id:      emp.id,
                    employee_name:    emp.full_name,
                    employee_department: emp.department,
                    employee_code:    emp.employee_code,
                    month:            selectedMonth,
                    basic_salary:     basic,
                    variable_salary:  variable,
                    insurance_salary: insSal,
                    hire_date:        emp.hire_date,
                    national_id:      emp.national_id,
                    transfer_account_number: emp.transfer_account_number,
                    transfer_account_type:   emp.transfer_account_type,
                    // 3 inputs
                    overtime_hours: record ? parseFloat(record.overtime_hours || '0') : 0,
                    absence_days:   record ? parseFloat(record.absence_days   || '0') : 0,
                    penalty_days:   record ? parseFloat(record.penalty_days   || '0') : 0,
                    // misc
                    advance:        record ? parseFloat(record.advance        || '0') : 0,
                    annual_leave:   record ? parseInt(record.annual_leave     || '0') : 0,
                    target_achieved: targetAch,
                    target_volume:   targetVol,
                    status: record?.status || 'draft',
                    // placeholders (filled by calculatePayrollRow)
                    target_value: 0, basic_daily: 0, target_daily: 0, daily_wage: 0,
                    hourly_rate: 0, overtime_amount: 0, gross_salary: 0,
                    absence_value: 0, penalty_value: 0, total_deducted: 0,
                    net_before: 0, insurance: 0, annual_taxable: 0, taxes: 0,
                    martyrs: 0, net_salary: 0, flags: [],
                };
                return calculatePayrollRow(entry, basic, variable, insSal);
            });

            merged.sort((a, b) => (a.employee_code || '').localeCompare(b.employee_code || '', undefined, { numeric: true, sensitivity: 'base' }));
            setPayrollData(merged);
        } catch (err) {
            console.error('Error fetching payroll:', err);
        } finally {
            setLoading(false);
        }
    };

    // ── Core calculation — exact BM Salaries formulas ────────────────────────
    const calculatePayrollRow = (entry: any, rawBasic: number | string, rawVariable: number | string, rawInsuranceSalary: number | string): PayrollEntry => {
        const basic    = parseFloat(rawBasic as string)           || 0;  // H
        const variable = parseFloat(rawVariable as string)        || 0;  // I
        const insSalDB = parseFloat(rawInsuranceSalary as string) || 0;

        // Target rate K — always driven by الهدف % spinner (globalPercent),
        // unless the user has set a per-employee override via handlePercentChange.
        let pct = globalPercent;
        if (entry.employee_percent !== undefined) pct = entry.employee_percent;

        // L = I × K  (K defaults to 1 → percent/100)
        const targetValue  = variable * (pct / 100);                          // L
        // O = H / 30
        const basicDaily   = basic / 30;                                       // O
        // P = L / 30
        const targetDaily  = targetValue / 30;                                 // P
        // Q = O + P
        const dailyWage    = basicDaily + targetDaily;                         // Q
        // R = O / 8
        const hourlyRate   = basicDaily / 8;                                   // R
        // T = R × S
        const overtimeAmt  = hourlyRate * (entry.overtime_hours || 0);         // T
        // V = H + L + T  (bonus & salary-diff = 0 unless extended)
        const gross        = basic + targetValue + overtimeAmt;                // V

        // X = Q × W
        const absenceVal   = dailyWage * (entry.absence_days || 0);            // X
        // Z = O × Y
        const penaltyVal   = basicDaily * (entry.penalty_days || 0);           // Z
        // AC = X + Z  (target-days deduction = 0)
        const totalDed     = absenceVal + penaltyVal;                          // AC
        // AD = V − AC
        const netBefore    = Math.max(0, gross - totalDed);                    // AD

        // AE = employee's insurance_salary or fixed 7000/1.3
        const insBase      = insSalDB > 0 ? insSalDB : INSURANCE_BASE_DEFAULT; // AE
        // AF = AE × 0.11
        let insurance      = insBase * 0.11;                                   // AF
        // Newcomer grace: hired this month & < 15 days worked → no insurance
        if (entry.hire_date && entry.hire_date.startsWith(entry.month)) {
            const [yr, mo] = entry.month.split('-').map(Number);
            const daysInM  = new Date(yr, mo, 0).getDate();
            const hireDay  = parseInt(entry.hire_date.split('-')[2], 10);
            if (daysInM - hireDay + 1 < 15) insurance = 0;
        }

        // AH = (AD − AF − AG) × 12
        const annualTaxable = (netBefore - insurance - PERSONAL_EXEMPTION_MONTHLY) * 12; // AH

        // AI = tax brackets on AH, divided by 12
        let yearlyTax = 0;
        if (annualTaxable > 40000)   yearlyTax += Math.min(annualTaxable -  40000,  15000) * 0.10;
        if (annualTaxable > 55000)   yearlyTax += Math.min(annualTaxable -  55000,  15000) * 0.15;
        if (annualTaxable > 70000)   yearlyTax += Math.min(annualTaxable -  70000, 130000) * 0.20;
        if (annualTaxable > 200000)  yearlyTax += Math.min(annualTaxable - 200000, 200000) * 0.225;
        if (annualTaxable > 400000)  yearlyTax += Math.min(annualTaxable - 400000, 800000) * 0.25;
        if (annualTaxable > 1200000) yearlyTax += (annualTaxable - 1200000) * 0.275;
        const taxes    = Math.max(0, yearlyTax) / 12;                          // AI/12

        // AJ = AD × 0.0005
        const martyrs  = netBefore * 0.0005;                                   // AJ
        // AK = AD − AF − AI − AJ
        const netSalary = netBefore - insurance - taxes - martyrs;             // AK
        // AM = AK − AL
        const advance   = entry.advance || 0;
        const finalNet  = netSalary - advance;                                 // AM

        const flags: string[] = [];
        if ((entry.absence_days || 0) > 0) flags.push('ABSENT');
        if ((entry.penalty_days || 0) > 0) flags.push('PENALTY');

        return {
            ...entry,
            employee_percent:  pct,
            target_value:      targetValue,
            basic_daily:       basicDaily,
            target_daily:      targetDaily,
            daily_wage:        dailyWage,
            hourly_rate:       hourlyRate,
            overtime_amount:   Math.max(0, overtimeAmt),
            gross_salary:      Math.max(0, gross),
            absence_value:     Math.max(0, absenceVal),
            penalty_value:     Math.max(0, penaltyVal),
            total_deducted:    Math.max(0, totalDed),
            net_before:        netBefore,
            insurance:         Math.max(0, insurance),
            annual_taxable:    Math.max(0, annualTaxable),
            taxes:             Math.max(0, taxes),
            martyrs:           Math.max(0, martyrs),
            net_salary:        Math.max(0, finalNet),
            advance,
            flags,
        } as PayrollEntry;
    };

    // re-calc when global percent changes
    useEffect(() => {
        if (payrollData.length > 0) {
            setPayrollData(prev => prev.map(rec => {
                if (rec.status !== 'draft') return rec;
                // Use locked salary if record was saved (rec.id exists), otherwise use employee master data
                return calculatePayrollRow({ ...rec, employee_percent: undefined }, rec.basic_salary, rec.variable_salary, rec.insurance_salary);
            }));
        }
    }, [globalPercent]);

    // ── Input change handler (only 3 fields) ─────────────────────────────────
    const handleInputChange = (empId: string, field: 'overtime_hours' | 'absence_days' | 'penalty_days' | 'advance' | 'annual_leave', value: number) => {
        setPayrollData(prev => prev.map(rec => {
            if (rec.employee_id !== empId || rec.status === 'finalized') return rec;
            const newRec = { ...rec, [field]: value };
            // Use locked salary from payroll record (if exists), otherwise from employee master data
            return calculatePayrollRow(newRec, rec.basic_salary, rec.variable_salary, rec.insurance_salary);
        }));
    };

    const handlePercentChange = (empId: string, percentVal: number) => {
        setPayrollData(prev => prev.map(rec => {
            if (rec.employee_id !== empId || rec.status === 'finalized') return rec;
            const newRec = { ...rec, employee_percent: percentVal };
            if (newRec.target_volume > 0)
                newRec.target_achieved = Math.round((percentVal / 100) * newRec.target_volume);
            else
                newRec.target_achieved = Math.round(percentVal);
            // Use locked salary from payroll record (if exists), otherwise from employee master data
            return calculatePayrollRow(newRec, rec.basic_salary, rec.variable_salary, rec.insurance_salary);
        }));
    };

    // ── Save ──────────────────────────────────────────────────────────────────
    const savePayroll = async (status: 'draft' | 'finalized') => {
        if (status === 'finalized' && !confirm('هل أنت متأكد من اعتماد الرواتب نهائياً؟ لا يمكن التعديل بعد الاعتماد.')) return;
        if (status === 'draft')     setIsSaving(true);
        if (status === 'finalized') setIsFinalizing(true);
        try {
            const updates = payrollData.map(rec => ({
                employee_id:    rec.employee_id,
                month:          rec.month,
                basic_salary:   rec.basic_salary,
                overtime_hours: rec.overtime_hours,
                overtime_amount:rec.overtime_amount,
                absence_days:   rec.absence_days,
                absence_value:  rec.absence_value,
                penalty_days:   rec.penalty_days,
                penalty_value:  rec.penalty_value,
                total_deducted: rec.total_deducted,
                net_before:     rec.net_before,
                advance:        rec.advance,
                annual_leave:   rec.annual_leave,
                target_achieved:Math.round(rec.target_achieved || 0),
                gross_salary:   rec.gross_salary,
                insurance:      rec.insurance,
                taxes:          rec.taxes,
                martyrs:        rec.martyrs,
                net_salary:     rec.net_salary,
                flags:          rec.flags || [],
                status:         status === 'finalized' ? 'finalized' : rec.status,
                processed_at:   new Date().toISOString(),
                rule_version:   RULE_VERSION,
            }));
            const { error } = await supabase.from('hr_payroll').upsert(updates, { onConflict: 'employee_id,month' });
            if (error) throw error;
            alert(`تم ${status === 'finalized' ? 'اعتماد' : 'حفظ'} الرواتب بنجاح`);
            fetchData();
        } catch (err: any) {
            alert('حدث خطأ أثناء الحفظ: ' + err.message);
        } finally {
            setIsSaving(false);
            setIsFinalizing(false);
        }
    };

    // ── Excel export ──────────────────────────────────────────────────────────
    const downloadExcel = () => {
        const fmt = (n: number) => Math.round(n * 100) / 100;
        const headers = [
            'الموظف','الرقم القومي','الرقم الوظيفي','القسم','نوع الحساب','رقم الحساب',
            'الأساسي (H)','المتغير (L)','ساعات إضافي (S)','قيمة الإضافي (T)','إجمالي (V)',
            'أيام غياب (W)','خصم غياب (X)','أيام جزاء (Y)','خصم جزاء (Z)',
            'إجمالي خصم (AC)','صافي قبل (AD)','تأمين (AF)','ضرائب (AI)','شهداء (AJ)',
            'سلفة (AL)','الصافي (AM)','الحالة',
        ];
        const data = payrollData.map(r => [
            r.employee_name, r.national_id||'-', r.employee_code||'-', r.employee_department||'-',
            r.transfer_account_type||'-', r.transfer_account_number||'-',
            fmt(r.basic_salary), fmt(r.target_value), r.overtime_hours, fmt(r.overtime_amount),
            fmt(r.gross_salary), r.absence_days, fmt(r.absence_value),
            r.penalty_days, fmt(r.penalty_value), fmt(r.total_deducted), fmt(r.net_before),
            fmt(r.insurance), fmt(r.taxes), fmt(r.martyrs),
            fmt(r.advance), fmt(r.net_salary),
            r.status === 'finalized' ? 'معتمد' : 'مسودة',
        ]);
        const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `Payroll_${selectedMonth}`);
        XLSX.writeFile(wb, `Payroll_${selectedMonth}.xlsx`);
    };

    // ── Template download ─────────────────────────────────────────────────────
    const downloadTemplate = () => {
        const headers = ['employee_code','employee_id','employee_name','overtime_hours','absence_days','penalty_days','advance'];
        const data = payrollData.map(r => [
            r.employee_code||'', r.employee_id, r.employee_name||'',
            r.overtime_hours, r.absence_days, r.penalty_days, r.advance||0,
        ]);
        const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
        ws['!cols'] = [{ wch:14 },{ wch:36 },{ wch:30 },{ wch:16 },{ wch:14 },{ wch:14 },{ wch:12 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Template');
        XLSX.writeFile(wb, `Payroll_Template_${selectedMonth}.xlsx`);
    };

    // ── File upload ───────────────────────────────────────────────────────────
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const buf = await file.arrayBuffer();
            const wb  = XLSX.read(buf);
            const ws  = wb.Sheets[wb.SheetNames[0]];
            const rawRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

            // Detect attendance sheet (has "employee name" in col C within first 20 rows)
            let attendanceHeaderRow = -1;
            for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
                if (rawRows[i] && String(rawRows[i][2] || '').toLowerCase().includes('employee name')) {
                    attendanceHeaderRow = i; break;
                }
            }

            let successCount = 0, errorCount = 0;
            const updatedData = [...payrollData];

            if (attendanceHeaderRow !== -1) {
                // Attendance sheet: columns after date range
                // AS(44)=OT hours, AL(37)=Absent, AU(46)=Penalty days
                for (let i = attendanceHeaderRow + 1; i < rawRows.length; i++) {
                    const row = rawRows[i];
                    if (!row || row[2] == null || typeof row[0] !== 'number') continue;
                    const empName     = String(row[2] || '').trim();
                    const overtimeH   = parseFloat(row[44]) || 0;
                    const absentDays  = parseFloat(row[37]) || 0;
                    const penaltyDays = parseFloat(row[46]) || 0;
                    const idx = updatedData.findIndex(r =>
                        (r.employee_name || '').toLowerCase() === empName.toLowerCase() ||
                        (r.employee_name || '').toLowerCase().split(' ')[0] === empName.toLowerCase().split(' ')[0]
                    );
                    if (idx !== -1 && updatedData[idx].status !== 'finalized') {
                        const emp = employees.find(e => e.id === updatedData[idx].employee_id);
                        updatedData[idx] = calculatePayrollRow(
                            { ...updatedData[idx], overtime_hours: overtimeH, absence_days: absentDays, penalty_days: penaltyDays },
                            updatedData[idx].basic_salary, emp?.variable_salary || 0, emp?.insurance_salary || 0
                        );
                        successCount++;
                    } else { errorCount++; }
                }
            } else {
                // Simple template format
                const jsonData = XLSX.utils.sheet_to_json<any>(ws);
                for (const row of jsonData) {
                    const empCode = row.employee_code || row['الرقم الوظيفي'];
                    const empId   = row.employee_id   || row['ID'];
                    let idx = empCode ? updatedData.findIndex(r => String(r.employee_code) === String(empCode)) : -1;
                    if (idx === -1 && empId) idx = updatedData.findIndex(r => String(r.employee_id) === String(empId));
                    if (idx !== -1 && updatedData[idx].status !== 'finalized') {
                        const ovt  = parseFloat(row.overtime_hours || row['ساعات إضافي']   || 0);
                        const abs  = parseFloat(row.absence_days   || row['أيام غياب']     || 0);
                        const pen  = parseFloat(row.penalty_days   || row['أيام جزاء']     || 0);
                        const adv  = parseFloat(row.advance        || row['سلفة']           || updatedData[idx].advance);
                        const emp  = employees.find(e => e.id === updatedData[idx].employee_id);
                        updatedData[idx] = calculatePayrollRow(
                            { ...updatedData[idx], overtime_hours: ovt, absence_days: abs, penalty_days: pen, advance: adv },
                            updatedData[idx].basic_salary, emp?.variable_salary || 0, emp?.insurance_salary || 0
                        );
                        successCount++;
                    } else { errorCount++; }
                }
            }
            setPayrollData(updatedData);
            alert(`تم رفع الملف: نجاح (${successCount})، فشل/تخطي (${errorCount}).\nيرجى الضغط على "مسودة" لحفظ التعديلات.`);
        } catch (err: any) {
            alert('حدث خطأ أثناء رفع الملف: ' + err.message);
        } finally { e.target.value = ''; }
    };

    // ── Print payslip ─────────────────────────────────────────────────────────
    const printPayslip = (rec: PayrollEntry) => {
        const w = window.open('', '_blank');
        if (!w) { alert('يرجى السماح بالنوافذ المنبثقة لطباعة قسيمة الراتب.'); return; }
        const fmt2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2 });
        w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head>
<meta charset="utf-8"><title>قسيمة راتب – ${rec.employee_name}</title>
<style>
  body{font-family:'Segoe UI',Tahoma,sans-serif;padding:20px;color:#333;max-width:760px;margin:0 auto}
  h1{color:#1e3a8a;font-size:22px;margin:0}
  .hdr{text-align:center;border-bottom:2px solid #2563eb;padding-bottom:10px;margin-bottom:18px}
  table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px}
  th,td{border:1px solid #e2e8f0;padding:7px 11px;text-align:right}
  th{background:#f8fafc;width:45%;font-weight:700;color:#475569}
  .sec{background:#1e3a8a;color:#fff;padding:7px 11px;border-radius:6px 6px 0 0;font-size:14px;margin:0}
  .sec.red{background:#be123c}
  .net{border:2px dashed #10b981;background:#ecfdf5;padding:14px;border-radius:10px;text-align:center;margin-top:16px}
  .sub{font-size:11px;color:#64748b}
  @page{size:A4;margin:10mm}
  @media print{body{padding:0;max-width:100%}}
</style></head><body>
<div class="hdr"><h1>قسيمة راتب (Payslip)</h1><p class="sub">شهر: <strong>${selectedMonth}</strong></p></div>

<p class="sec">بيانات الموظف</p>
<table>
  <tr><th>الاسم</th><td><strong>${rec.employee_name}</strong></td></tr>
  <tr><th>الرقم الوظيفي</th><td>${rec.employee_code||'-'}</td></tr>
  <tr><th>القسم</th><td>${rec.employee_department||'-'}</td></tr>
</table>

<p class="sec">الاستحقاقات</p>
<table>
  <tr><th>الراتب الأساسي (H)</th><td>${fmt2(rec.basic_salary)} EGP</td></tr>
  <tr><th>راتب الهدف / المتغير (L = I×K)</th><td>${fmt2(rec.target_value)} EGP</td></tr>
  <tr><th>إضافي — ${rec.overtime_hours} ساعة × ${fmt2(rec.hourly_rate)} (T = R×S)</th><td>${fmt2(rec.overtime_amount)} EGP</td></tr>
  <tr style="background:#f0fdf4"><th><strong>إجمالي الاستحقاقات (V)</strong></th><td><strong>${fmt2(rec.gross_salary)} EGP</strong></td></tr>
</table>

<p class="sec red">الاستقطاعات</p>
<table>
  ${rec.absence_days > 0 ? `<tr><th>خصم غياب — ${rec.absence_days} يوم × ${fmt2(rec.daily_wage)} (X = Q×W)</th><td>${fmt2(rec.absence_value)} EGP</td></tr>` : ''}
  ${rec.penalty_days > 0 ? `<tr><th>خصم جزاء — ${rec.penalty_days} يوم × ${fmt2(rec.basic_daily)} (Z = O×Y)</th><td>${fmt2(rec.penalty_value)} EGP</td></tr>` : ''}
  ${rec.total_deducted > 0 ? `<tr style="background:#fff1f2"><th><strong>إجمالي خصم الغياب والجزاء (AC)</strong></th><td><strong>${fmt2(rec.total_deducted)} EGP</strong></td></tr>` : ''}
  <tr style="background:#f0fdf4"><th><strong>الصافي قبل الاستقطاعات (AD)</strong></th><td><strong>${fmt2(rec.net_before)} EGP</strong></td></tr>
  <tr><th>التأمينات الاجتماعية (AF = AE×0.11)</th><td>${fmt2(rec.insurance)} EGP</td></tr>
  <tr><th>الضرائب (AI) — الوعاء السنوي ${fmt2(rec.annual_taxable)} EGP</th><td>${fmt2(rec.taxes)} EGP</td></tr>
  <tr><th>صندوق الشهداء (AJ = AD×0.0005)</th><td>${fmt2(rec.martyrs)} EGP</td></tr>
  ${rec.advance > 0 ? `<tr><th>سلفة (AL)</th><td>${fmt2(rec.advance)} EGP</td></tr>` : ''}
  <tr style="background:#fff1f2"><th><strong>إجمالي الاستقطاعات</strong></th><td><strong>${fmt2(rec.insurance + rec.taxes + rec.martyrs + rec.total_deducted + rec.advance)} EGP</strong></td></tr>
</table>

<div class="net">
  <p style="margin:0 0 8px;color:#065f46;font-size:18px">صافي الراتب المستحق (AM)</p>
  <p style="margin:0;color:#047857;font-size:34px;font-weight:900">${fmt2(rec.net_salary)} EGP</p>
</div>
<p style="text-align:center;font-size:11px;color:#94a3b8;margin-top:18px">تم إصداره إلكترونياً من نظام Capture Flow</p>
<script>window.onload=()=>{setTimeout(()=>{window.print();window.close()},400)}</script>
</body></html>`);
        w.document.close();
    };

    // ── Sort / filter ─────────────────────────────────────────────────────────
    const handleSort = (key: string) => {
        setSortConfig(prev => ({ key, direction: prev?.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
    };
    const getSortedData = () => {
        let items = [...payrollData];
        if (searchTerm) {
            const lc = searchTerm.toLowerCase();
            items = items.filter(r => (r.employee_name||'').toLowerCase().includes(lc) || (r.employee_code||'').toLowerCase().includes(lc));
        }
        if (!sortConfig) return items;
        return items.sort((a, b) => {
            const av = (a as any)[sortConfig.key] ?? '';
            const bv = (b as any)[sortConfig.key] ?? '';
            if (typeof av === 'number' && typeof bv === 'number')
                return sortConfig.direction === 'asc' ? av - bv : bv - av;
            return sortConfig.direction === 'asc'
                ? String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
                : String(bv).localeCompare(String(av), undefined, { numeric: true, sensitivity: 'base' });
        });
    };

    // ── Totals ────────────────────────────────────────────────────────────────
    const totalNet       = payrollData.reduce((s, r) => s + r.net_salary,    0);
    const totalOT        = payrollData.reduce((s, r) => s + r.overtime_amount, 0);
    const totalDeductions = payrollData.reduce((s, r) => s + r.total_deducted, 0);
    const allFinalized   = payrollData.length > 0 && payrollData.every(r => r.status === 'finalized');

    // ── Helper ────────────────────────────────────────────────────────────────
    const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

    // ═════════════════════════════════════════════════════════════════════════
    return (
        <div className="space-y-6 animate-fade-in-up">

            {/* ── Top bar ── */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-4 rounded-xl shadow-sm border border-gray-100 gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-50 text-green-600 rounded-lg">
                        <span className="material-icons">payments</span>
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">إدارة الرواتب (Payroll)</h2>
                        <p className="text-xs text-gray-500">الإضافي • الغياب • الجزاء — كل شيء محسوب تلقائياً</p>
                    </div>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                    <input type="month" value={selectedMonth}
                        onChange={e => setSelectedMonth(e.target.value)}
                        className="border border-gray-200 rounded-md px-1.5 py-1 font-bold text-xs text-gray-700 focus:ring-1 focus:ring-primary outline-none" />

                    <div className="relative">
                        <span className="material-icons absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-[14px]">search</span>
                        <input type="text" placeholder="بحث..." value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="pr-7 pl-2 py-1 border border-gray-200 rounded-md text-xs font-bold text-gray-700 focus:ring-1 focus:ring-primary outline-none w-32"
                            dir="rtl" />
                    </div>

                    {/* Global target % */}
                    <div className="flex items-center gap-1 bg-blue-50 px-1.5 py-1 rounded-md border border-blue-100">
                        <span className="text-[10px] font-bold text-blue-600">هدف %</span>
                        <input type="number" value={globalPercent}
                            onChange={e => setGlobalPercent(parseFloat(e.target.value) || 0)}
                            className="w-12 py-0.5 border border-blue-200 rounded text-[10px] font-bold text-blue-800 outline-none text-center"
                            min="0" max="200" />
                    </div>

                    <button onClick={downloadExcel}
                        className="bg-white border text-gray-600 px-1.5 py-1 text-[10px] rounded-md font-bold flex items-center gap-1 hover:bg-gray-50 shadow-sm">
                        <span className="material-icons text-[14px]">download</span>Excel
                    </button>

                    {isAdmin && (<>
                        <button onClick={downloadTemplate}
                            className="bg-white border text-blue-600 border-blue-200 px-1.5 py-1 text-[10px] rounded-md font-bold flex items-center gap-1 hover:bg-blue-50 shadow-sm">
                            <span className="material-icons text-[14px]">description</span>القالب
                        </button>

                        <label className="bg-white border text-primary border-primary px-1.5 py-1 text-[10px] rounded-md font-bold flex items-center gap-1 hover:bg-blue-50 cursor-pointer shadow-sm">
                            <span className="material-icons text-[14px]">upload</span>رفع
                            <input type="file" hidden accept=".xlsx,.xls,.csv" onChange={handleFileUpload} />
                        </label>

                        <button onClick={() => savePayroll('draft')} disabled={isSaving || allFinalized}
                            className={`bg-gray-100 text-gray-700 px-1.5 py-1 text-[10px] rounded-md font-bold flex items-center gap-1 shadow-sm ${isSaving||allFinalized?'opacity-50 cursor-not-allowed':'hover:bg-gray-200'}`}>
                            <span className="material-icons text-[14px]">{isSaving?'hourglass_top':'save'}</span>مسودة
                        </button>

                        <button onClick={() => savePayroll('finalized')} disabled={isFinalizing || allFinalized || !payrollData.length}
                            className={`bg-primary text-white px-2 py-1 text-[10px] rounded-md font-bold flex items-center gap-1 shadow-sm ${isFinalizing||allFinalized||!payrollData.length?'opacity-50 cursor-not-allowed':'hover:bg-blue-700'}`}>
                            <span className="material-icons text-[14px]">{isFinalizing?'hourglass_top':'verified'}</span>اعتماد
                        </button>
                    </>)}
                </div>
            </div>

            {/* ── KPI cards ── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                    { label:'إجمالي صافي الرواتب', value: totalNet,        icon:'account_balance_wallet', color:'blue'  },
                    { label:'إجمالي قيمة الإضافي',  value: totalOT,        icon:'add_circle',             color:'green' },
                    { label:'إجمالي خصومات الغياب', value: totalDeductions, icon:'remove_circle',          color:'red'   },
                ].map(c => (
                    <div key={c.label} className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4 hover:shadow-md transition-shadow">
                        <div className={`p-3 bg-${c.color}-50 text-${c.color}-500 rounded-lg`}>
                            <span className="material-icons text-3xl">{c.icon}</span>
                        </div>
                        <div>
                            <h3 className="text-gray-500 text-sm font-medium">{c.label}</h3>
                            <p className="text-2xl font-bold mt-1 text-gray-800">{c.value.toLocaleString('en-US',{minimumFractionDigits:2})} EGP</p>
                        </div>
                    </div>
                ))}
            </div>

            {allFinalized && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-3 shadow-sm font-bold">
                    <span className="material-icons">verified</span>
                    <span>تم اعتماد الرواتب لهذا الشهر بشكل نهائي ولا يمكن تعديلها.</span>
                </div>
            )}

            {/* ── Table ── */}
            {loading ? (
                <div className="p-20 text-center text-gray-400 bg-white rounded-xl shadow-sm border border-gray-100">
                    <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
                    جاري تحميل البيانات...
                </div>
            ) : (
                <div className="border border-gray-100 rounded-xl shadow-inner bg-white overflow-hidden" dir="rtl">
                    <div className="overflow-x-auto overflow-y-auto max-h-[70vh] custom-scrollbar">
                        <table className="text-right border-separate border-spacing-0" style={{ tableLayout:'fixed', minWidth:'980px', width:'100%' }}>
                            <colgroup>
                                <col style={{width:'155px'}} />{/* name */}
                                <col style={{width:'68px'}}  />{/* code */}
                                <col style={{width:'80px'}}  />{/* basic */}
                                <col style={{width:'80px'}}  />{/* target */}
                                {/* 3 inputs */}
                                <col style={{width:'70px'}}  />{/* OT hrs */}
                                <col style={{width:'70px'}}  />{/* absence */}
                                <col style={{width:'70px'}}  />{/* penalty */}
                                {/* results */}
                                <col style={{width:'80px'}}  />{/* gross */}
                                <col style={{width:'80px'}}  />{/* deducted */}
                                <col style={{width:'80px'}}  />{/* ins+tax */}
                                <col style={{width:'95px'}}  />{/* net */}
                                <col style={{width:'58px'}}  />{/* status */}
                                <col style={{width:'38px'}}  />{/* print */}
                            </colgroup>

                            {/* ── sticky header ── */}
                            <thead className="sticky top-0 z-20 text-[9px] uppercase tracking-wider select-none">
                                {/* group row */}
                                <tr>
                                    <th colSpan={2} className="p-1.5 text-center bg-[#1e3a5f] text-white border-b border-[#2d5080]">الموظف</th>
                                    <th colSpan={2} className="p-1.5 text-center bg-[#334155] text-white border-b border-[#475569]">الراتب الثابت</th>
                                    <th colSpan={3} className="p-1.5 text-center bg-[#0e7490] text-white border-b border-[#0c6270] font-black text-[10px]">
                                        ✏️ مدخلات الشهر
                                    </th>
                                    <th colSpan={4} className="p-1.5 text-center bg-[#15803d] text-white border-b border-[#166534]">محسوب تلقائياً</th>
                                    <th colSpan={2} className="p-1.5 text-center bg-[#1e3a5f] text-white border-b border-[#2d5080]">إجراء</th>
                                </tr>
                                {/* column names */}
                                <tr className="bg-[#f8fafc] text-gray-600 font-extrabold border-b border-gray-200">
                                    <th className="p-2 text-right cursor-pointer hover:bg-gray-100" onClick={() => handleSort('employee_name')}>
                                        الموظف <span className="material-icons text-[10px] align-middle opacity-30">swap_vert</span>
                                    </th>
                                    <th className="p-2 text-center cursor-pointer hover:bg-gray-100" onClick={() => handleSort('employee_code')}>كود</th>
                                    <th className="p-2 text-center bg-slate-50 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('basic_salary')}>أساسي</th>
                                    <th className="p-2 text-center bg-slate-50">متغير</th>
                                    {/* 3 inputs — highlighted headers */}
                                    <th className="p-2 text-center bg-cyan-100 text-cyan-900 border-r border-cyan-200">
                                        <div>ساعات</div><div className="text-[8px] font-normal opacity-70">إضافي (S)</div>
                                    </th>
                                    <th className="p-2 text-center bg-red-100 text-red-800 border-r border-red-200">
                                        <div>غياب</div><div className="text-[8px] font-normal opacity-70">أيام (W)</div>
                                    </th>
                                    <th className="p-2 text-center bg-orange-100 text-orange-800 border-r border-orange-200">
                                        <div>جزاء</div><div className="text-[8px] font-normal opacity-70">أيام (Y)</div>
                                    </th>
                                    {/* results */}
                                    <th className="p-2 text-center bg-green-50 text-green-800 border-r border-green-200">إجمالي (V)</th>
                                    <th className="p-2 text-center bg-red-50 text-red-700">خصم (AC)</th>
                                    <th className="p-2 text-center bg-gray-50 text-gray-600">
                                        <div>ت/ض/ش</div><div className="text-[8px] font-normal opacity-70">(AF+AI+AJ)</div>
                                    </th>
                                    <th className="p-2 text-center bg-primary/10 text-primary cursor-pointer hover:bg-primary/20" onClick={() => handleSort('net_salary')}>
                                        الصافي (AM) <span className="material-icons text-[10px] align-middle opacity-30">swap_vert</span>
                                    </th>
                                    <th className="p-2 text-center">حالة</th>
                                    <th className="p-2 text-center"></th>
                                </tr>
                            </thead>

                            <tbody>
                                {payrollData.length === 0 && (
                                    <tr><td colSpan={13} className="p-16 text-center text-gray-400">لا يوجد موظفين.</td></tr>
                                )}
                                {getSortedData().map(rec => {
                                    const dis = rec.status === 'finalized' || !isAdmin;
                                    const inpCls = (extra = '') =>
                                        `w-full text-center block p-1 rounded border text-[11px] font-bold outline-none focus:ring-1 ${dis ? 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed' : extra}`;
                                    return (
                                        <tr key={rec.employee_id} className="hover:bg-blue-50/30 transition-colors group">
                                            {/* name */}
                                            <td className="p-1.5 px-2 border-b border-gray-50">
                                                <div className="font-extrabold text-[10px] text-gray-800 truncate">{rec.employee_name}</div>
                                                <div className="text-[9px] text-gray-400">{rec.employee_department || '-'}</div>
                                            </td>
                                            {/* code */}
                                            <td className="p-1.5 text-center border-b border-gray-50">
                                                <span className="bg-gray-50 border border-gray-200 px-1 rounded font-mono text-[9px] text-gray-500">{rec.employee_code||'-'}</span>
                                            </td>
                                            {/* basic */}
                                            <td className="p-1.5 text-center border-b border-gray-50 text-[10px] font-bold text-slate-700 bg-slate-50/30">
                                                {fmt(rec.basic_salary)}
                                            </td>
                                            {/* target */}
                                            <td className="p-1.5 text-center border-b border-gray-50 bg-slate-50/30">
                                                <div className="text-[10px] font-bold text-blue-700">{fmt(rec.target_value)}</div>
                                                <div className="text-[8px] text-gray-400">{Math.round(rec.employee_percent || 100)}%</div>
                                            </td>

                                            {/* ── INPUT 1: Overtime hours (S) ── */}
                                            <td className="p-1 border-b border-cyan-100 bg-cyan-50/40">
                                                <input type="number" min="0" value={rec.overtime_hours} disabled={dis}
                                                    onChange={e => handleInputChange(rec.employee_id, 'overtime_hours', parseFloat(e.target.value)||0)}
                                                    className={inpCls('border-cyan-200 focus:ring-cyan-300 text-cyan-800 bg-white')} />
                                                {rec.overtime_amount > 0 && (
                                                    <div className="text-[8px] text-cyan-600 text-center mt-0.5">{fmt(rec.overtime_amount)} ج</div>
                                                )}
                                            </td>

                                            {/* ── INPUT 2: Absence days (W) ── */}
                                            <td className="p-1 border-b border-red-100 bg-red-50/30">
                                                <input type="number" min="0" value={rec.absence_days} disabled={dis}
                                                    onChange={e => handleInputChange(rec.employee_id, 'absence_days', parseFloat(e.target.value)||0)}
                                                    className={inpCls(`border-red-200 focus:ring-red-300 ${rec.absence_days>0?'text-red-700 bg-red-50':'text-gray-700 bg-white'}`)} />
                                                {rec.absence_value > 0 && (
                                                    <div className="text-[8px] text-red-500 text-center mt-0.5">−{fmt(rec.absence_value)} ج</div>
                                                )}
                                            </td>

                                            {/* ── INPUT 3: Penalty days (Y) ── */}
                                            <td className="p-1 border-b border-orange-100 bg-orange-50/30">
                                                <input type="number" min="0" value={rec.penalty_days} disabled={dis}
                                                    onChange={e => handleInputChange(rec.employee_id, 'penalty_days', parseFloat(e.target.value)||0)}
                                                    className={inpCls(`border-orange-200 focus:ring-orange-300 ${rec.penalty_days>0?'text-orange-700 bg-orange-50':'text-gray-700 bg-white'}`)} />
                                                {rec.penalty_value > 0 && (
                                                    <div className="text-[8px] text-orange-500 text-center mt-0.5">−{fmt(rec.penalty_value)} ج</div>
                                                )}
                                            </td>

                                            {/* Gross (V) */}
                                            <td className="p-1.5 text-center border-b border-gray-50 bg-green-50/30">
                                                <div className="text-[10px] font-bold text-green-800">{fmt(rec.gross_salary)}</div>
                                            </td>

                                            {/* Total deducted (AC) */}
                                            <td className="p-1.5 text-center border-b border-gray-50 bg-red-50/20">
                                                <div className={`text-[10px] font-bold ${rec.total_deducted>0?'text-red-700':'text-gray-300'}`}>
                                                    {rec.total_deducted > 0 ? `−${fmt(rec.total_deducted)}` : '—'}
                                                </div>
                                                {rec.net_before !== rec.gross_salary && (
                                                    <div className="text-[8px] text-gray-400">{fmt(rec.net_before)}</div>
                                                )}
                                            </td>

                                            {/* Insurance + Tax + Martyrs */}
                                            <td className="p-1.5 text-center border-b border-gray-50 text-[8px] text-gray-500 leading-snug">
                                                <div>ت: {fmt(rec.insurance)}</div>
                                                <div>ض: {fmt(rec.taxes)}</div>
                                                <div>ش: {fmt(rec.martyrs)}</div>
                                            </td>

                                            {/* Net (AM) — primary */}
                                            <td className="p-1.5 text-center border-b border-gray-50 bg-primary/5">
                                                <div className="text-[12px] font-black text-primary">{fmt(rec.net_salary)}</div>
                                                <div className="text-[8px] text-gray-400">EGP</div>
                                            </td>

                                            {/* Status */}
                                            <td className="p-1.5 text-center border-b border-gray-50">
                                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-black ${rec.status==='finalized'?'bg-green-600 text-white':'bg-amber-100 text-amber-700'}`}>
                                                    {rec.status==='finalized'?'✓ معتمد':'مسودة'}
                                                </span>
                                            </td>

                                            {/* Print */}
                                            <td className="p-1.5 text-center border-b border-gray-50">
                                                <button onClick={() => printPayslip(rec)} title="طباعة قسيمة" className="text-gray-300 hover:text-primary transition-colors">
                                                    <span className="material-icons text-[18px]">print</span>
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
        </div>
    );
};

export default HRPayroll;
