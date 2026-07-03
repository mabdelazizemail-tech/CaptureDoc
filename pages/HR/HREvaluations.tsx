import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../../services/supabaseClient';
import { User } from '../../services/types';

interface Employee {
    id: string;
    full_name: string;
    email?: string;
    department?: string;
    employee_code?: string;
    project?: string | null;
    basic_salary?: number;
    variable_salary?: number;
}

interface Evaluation {
    id: string;
    employee_id: string;
    evaluator_id: string | null;
    score: number;
    comments: string | null;
    evaluation_date: string;
    created_at: string;
    salary_increase_percent: number | null;
    salary_increase_amount: number | null;
}

interface EvaluationForm {
    employee_id: string;
    score: string;
    salary_increase: string;
    comments: string;
    evaluation_date: string;
}

interface HREvaluationsProps {
    user: User;
    selectedProjectId: string;
}

const NO_PROJECT = 'بدون مشروع';

const today = () => new Date().toISOString().split('T')[0];

const emptyForm = (): EvaluationForm => ({
    employee_id: '',
    score: '',
    salary_increase: '',
    comments: '',
    evaluation_date: today()
});

const HREvaluations: React.FC<HREvaluationsProps> = ({ user, selectedProjectId }) => {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
    const [evaluatorNames, setEvaluatorNames] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [form, setForm] = useState<EvaluationForm>(emptyForm());
    const [editingId, setEditingId] = useState<string | null>(null);
    const [filterEmployee, setFilterEmployee] = useState('all');
    const [projectFilter, setProjectFilter] = useState('all');

    // Bulk evaluation state
    const [bulkSelected, setBulkSelected] = useState<string[]>([]);
    const [bulkScore, setBulkScore] = useState('');
    const [bulkIncrease, setBulkIncrease] = useState('');
    const [bulkComments, setBulkComments] = useState('');
    const [bulkDate, setBulkDate] = useState(today());
    const [bulkSaving, setBulkSaving] = useState(false);

    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const isFullAdmin = user.role === 'super_admin' || user.role === 'power_admin' || user.role === 'it_specialist' || user.role === 'hr_admin';
    const canEvaluate = isFullAdmin || user.role === 'project_manager';

    useEffect(() => {
        fetchData();
    }, [selectedProjectId]);

    useEffect(() => {
        // Selections may reference employees hidden by the new project filter
        setBulkSelected([]);
        setFilterEmployee('all');
    }, [projectFilter]);

    const fetchData = async () => {
        setLoading(true);
        try {
            // Fetch active employees (same project scoping as the KPI screen)
            let empQuery = supabase.from('hr_employees').select('id, full_name, email, department, employee_code, project, basic_salary, variable_salary').eq('status', 'active');

            const projectToFilter = isFullAdmin
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
            const { data: empData } = await empQuery.order('full_name');
            setEmployees(empData || []);

            let evalQuery = supabase.from('hr_employee_evaluations').select('*').order('evaluation_date', { ascending: false });
            if (projectToFilter) {
                evalQuery = evalQuery.in('employee_id', (empData || []).map(e => e.id));
            }
            const { data: evalData, error: evalErr } = await evalQuery;
            if (evalErr) throw evalErr;
            setEvaluations(evalData || []);

            // Resolve evaluator display names
            const evaluatorIds = [...new Set((evalData || []).map(ev => ev.evaluator_id).filter(Boolean))] as string[];
            if (evaluatorIds.length > 0) {
                const { data: profilesData } = await supabase.from('profiles').select('id, name').in('id', evaluatorIds);
                const names: Record<string, string> = {};
                (profilesData || []).forEach(p => { names[p.id] = p.name; });
                setEvaluatorNames(names);
            } else {
                setEvaluatorNames({});
            }
        } catch (error) {
            console.error('Error fetching evaluations:', error);
        } finally {
            setLoading(false);
        }
    };

    const employeeName = (id: string) => employees.find(e => e.id === id)?.full_name || '—';

    // Current salary = basic + variable
    const currentSalaryOf = (emp?: Employee): number | undefined =>
        emp ? (emp.basic_salary || 0) + (emp.variable_salary || 0) : undefined;

    const formatSalary = (salary?: number) =>
        (salary || salary === 0) ? salary.toLocaleString('en-US') : '—';

    // '' -> null (not provided), invalid -> undefined, otherwise the percent
    const parseIncreasePercent = (raw: string): number | null | undefined => {
        if (String(raw).trim() === '') return null;
        const pct = Number(raw);
        if (isNaN(pct) || pct < 0 || pct > 100) return undefined;
        return pct;
    };

    const increaseAmount = (emp: Employee | undefined, pct: number | null): number | null => {
        const salary = currentSalaryOf(emp);
        if (pct === null || salary === undefined) return null;
        return Math.round(salary * pct) / 100;
    };

    // ----- Project grouping -----
    const projectOf = (emp: Employee) => emp.project || NO_PROJECT;

    const projectNames = [...new Set(employees.map(projectOf))].sort((a, b) => a.localeCompare(b, 'ar'));

    const visibleEmployees = projectFilter === 'all'
        ? employees
        : employees.filter(emp => projectOf(emp) === projectFilter);

    const groupedEmployees: [string, Employee[]][] = (() => {
        const groups: Record<string, Employee[]> = {};
        visibleEmployees.forEach(emp => {
            const key = projectOf(emp);
            (groups[key] = groups[key] || []).push(emp);
        });
        return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b, 'ar'));
    })();

    const visibleIds = new Set(visibleEmployees.map(e => e.id));
    const projectEvaluations = projectFilter === 'all'
        ? evaluations
        : evaluations.filter(ev => visibleIds.has(ev.employee_id));
    const visibleEvaluations = filterEmployee === 'all'
        ? projectEvaluations
        : projectEvaluations.filter(ev => ev.employee_id === filterEmployee);

    const averageScore = visibleEvaluations.length > 0
        ? (visibleEvaluations.reduce((sum, ev) => sum + ev.score, 0) / visibleEvaluations.length)
        : null;

    // ----- Single evaluation form -----
    const validateScore = (raw: string): number | null => {
        const score = Number(raw);
        if (!Number.isInteger(score) || score < 1 || score > 100) return null;
        return score;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.employee_id) { alert('يرجى اختيار الموظف'); return; }
        const score = validateScore(form.score);
        if (score === null) { alert('الدرجة يجب أن تكون رقماً صحيحاً بين 1 و 100'); return; }
        if (!form.evaluation_date) { alert('يرجى تحديد تاريخ التقييم'); return; }
        if (form.comments.length > 2000) { alert('الملاحظات طويلة جداً (الحد الأقصى 2000 حرف)'); return; }
        const increasePct = parseIncreasePercent(form.salary_increase);
        if (increasePct === undefined) { alert('نسبة الزيادة يجب أن تكون بين 0 و 100'); return; }

        setIsSaving(true);
        try {
            const emp = employees.find(e => e.id === form.employee_id);
            const payload = {
                employee_id: form.employee_id,
                score,
                comments: form.comments.trim() || null,
                evaluation_date: form.evaluation_date,
                salary_increase_percent: increasePct,
                salary_increase_amount: increaseAmount(emp, increasePct)
            };

            if (editingId) {
                const { error } = await supabase.from('hr_employee_evaluations').update(payload).eq('id', editingId);
                if (error) throw error;
                alert('تم تحديث التقييم بنجاح');
            } else {
                const { error } = await supabase.from('hr_employee_evaluations').insert({ ...payload, evaluator_id: user.id });
                if (error) throw error;
                alert('تم حفظ التقييم بنجاح');
            }
            setForm(emptyForm());
            setEditingId(null);
            fetchData();
        } catch (error: any) {
            alert('حدث خطأ أثناء الحفظ: ' + error.message);
        } finally {
            setIsSaving(false);
        }
    };

    const startEdit = (ev: Evaluation) => {
        setEditingId(ev.id);
        setForm({
            employee_id: ev.employee_id,
            score: String(ev.score),
            salary_increase: ev.salary_increase_percent !== null && ev.salary_increase_percent !== undefined ? String(ev.salary_increase_percent) : '',
            comments: ev.comments || '',
            evaluation_date: ev.evaluation_date
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const cancelEdit = () => {
        setEditingId(null);
        setForm(emptyForm());
    };

    const handleDelete = async (ev: Evaluation) => {
        if (!confirm(`هل أنت متأكد من حذف تقييم ${employeeName(ev.employee_id)} بتاريخ ${ev.evaluation_date}؟`)) return;
        const { error } = await supabase.from('hr_employee_evaluations').delete().eq('id', ev.id);
        if (error) {
            alert('حدث خطأ أثناء الحذف: ' + error.message);
            return;
        }
        fetchData();
    };

    // ----- Bulk evaluation -----
    const toggleBulkEmployee = (id: string) => {
        setBulkSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const toggleBulkProject = (groupEmps: Employee[]) => {
        const ids = groupEmps.map(e => e.id);
        const allSelected = ids.every(id => bulkSelected.includes(id));
        setBulkSelected(prev => allSelected
            ? prev.filter(id => !ids.includes(id))
            : [...new Set([...prev, ...ids])]);
    };

    const handleBulkSubmit = async () => {
        if (bulkSelected.length === 0) { alert('يرجى اختيار موظف واحد على الأقل'); return; }
        const score = validateScore(bulkScore);
        if (score === null) { alert('الدرجة يجب أن تكون رقماً صحيحاً بين 1 و 100'); return; }
        if (!bulkDate) { alert('يرجى تحديد تاريخ التقييم'); return; }
        const increasePct = parseIncreasePercent(bulkIncrease);
        if (increasePct === undefined) { alert('نسبة الزيادة يجب أن تكون بين 0 و 100'); return; }

        setBulkSaving(true);
        try {
            const rows = bulkSelected.map(id => {
                const emp = employees.find(e => e.id === id);
                return {
                    employee_id: id,
                    evaluator_id: user.id,
                    score,
                    comments: bulkComments.trim() || null,
                    evaluation_date: bulkDate,
                    salary_increase_percent: increasePct,
                    salary_increase_amount: increaseAmount(emp, increasePct)
                };
            });
            const { error } = await supabase.from('hr_employee_evaluations').insert(rows);
            if (error) throw error;
            alert(`تم حفظ التقييم الجماعي لعدد ${rows.length} موظف بنجاح`);
            setBulkSelected([]);
            setBulkScore('');
            setBulkIncrease('');
            setBulkComments('');
            fetchData();
        } catch (error: any) {
            alert('حدث خطأ أثناء الحفظ الجماعي: ' + error.message);
        } finally {
            setBulkSaving(false);
        }
    };

    // ----- Excel template & upload -----
    const TEMPLATE_HEADERS = [
        'employee_code', 'full_name', 'email', 'project', 'department', 'job_title',
        'hire_date', 'basic_salary', 'variable_salary', 'current_salary',
        'score', 'salary_increase_percent', 'comments', 'evaluation_date'
    ];

    const downloadTemplate = () => {
        const rows = visibleEmployees.map(emp => [
            emp.employee_code || '',
            emp.full_name,
            emp.email || '',
            emp.project || '',
            emp.department || '',
            '', '',
            emp.basic_salary ?? '',
            emp.variable_salary ?? '',
            currentSalaryOf(emp) ?? '',
            '', '', '', ''
        ]);
        const worksheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...rows]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Evaluations');
        XLSX.writeFile(workbook, `Evaluations_Template_${today()}.xlsx`);
    };

    const formatDateForDB = (val: any): string | null => {
        if (!val) return null;
        // Handle Excel serial dates if they come as numbers
        if (typeof val === 'number') {
            const date = new Date((val - 25569) * 86400 * 1000);
            return date.toISOString().split('T')[0];
        }
        const d = new Date(val);
        if (isNaN(d.getTime())) return null;
        return d.toISOString().split('T')[0];
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data);
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json<any>(worksheet);

            let createdEmployees = 0;
            let skippedRows = 0;
            const errorMessages: string[] = [];
            const evalRows: any[] = [];

            // Local working copy so employees created during this upload are matchable
            const knownEmployees = [...employees];
            const findEmployee = (row: any): Employee | undefined => {
                const email = String(row.email || '').trim().toLowerCase();
                const code = String(row.employee_code || '').trim();
                const name = String(row.full_name || '').trim();
                if (email) {
                    const byEmail = knownEmployees.find(emp => (emp.email || '').toLowerCase() === email);
                    if (byEmail) return byEmail;
                }
                if (code) {
                    const byCode = knownEmployees.find(emp => String(emp.employee_code || '') === code);
                    if (byCode) return byCode;
                }
                if (name) {
                    return knownEmployees.find(emp => emp.full_name.trim() === name);
                }
                return undefined;
            };

            for (const row of jsonData) {
                const rowLabel = String(row.full_name || row.email || row.employee_code || 'صف بدون اسم').trim();
                let emp = findEmployee(row);

                // New employee in the sheet -> add to the database first
                if (!emp) {
                    const basic = parseFloat(row.basic_salary) || 0;
                    if (!row.full_name || !row.email || basic <= 0) {
                        errorMessages.push(`(${rowLabel}): موظف جديد — يجب إدخال (الاسم، البريد الإلكتروني، الراتب الأساسي) لإضافته`);
                        continue;
                    }
                    const { error: empErr } = await supabase.rpc('hr_update_employee', {
                        p_id: null,
                        p_full_name: String(row.full_name).trim(),
                        p_email: String(row.email).trim(),
                        p_employee_code: row.employee_code ? String(row.employee_code) : null,
                        p_hire_date: formatDateForDB(row.hire_date) || today(),
                        p_job_title: row.job_title || null,
                        p_department: row.department || null,
                        p_project: row.project || (projectFilter !== 'all' && projectFilter !== NO_PROJECT ? projectFilter : null),
                        p_basic_salary: basic,
                        p_variable_salary: parseFloat(row.variable_salary) || 0,
                        p_status: 'active'
                    });
                    if (empErr) {
                        errorMessages.push(`(${rowLabel}): فشل إضافة الموظف — ${empErr.message}`);
                        continue;
                    }
                    const { data: newEmp } = await supabase
                        .from('hr_employees')
                        .select('id, full_name, email, department, employee_code, project, basic_salary, variable_salary')
                        .eq('email', String(row.email).trim())
                        .single();
                    if (!newEmp) {
                        errorMessages.push(`(${rowLabel}): تمت الإضافة لكن تعذر العثور على الموظف الجديد`);
                        continue;
                    }
                    emp = newEmp;
                    knownEmployees.push(newEmp);
                    createdEmployees++;
                }

                // Evaluation part is optional per row (a row may only add an employee)
                if (row.score === undefined || row.score === null || String(row.score).trim() === '') {
                    skippedRows++;
                    continue;
                }
                const score = Number(row.score);
                if (!Number.isInteger(score) || score < 1 || score > 100) {
                    errorMessages.push(`(${rowLabel}): الدرجة يجب أن تكون رقماً صحيحاً بين 1 و 100`);
                    continue;
                }
                const rowIncrease = parseIncreasePercent(String(row.salary_increase_percent ?? ''));
                if (rowIncrease === undefined) {
                    errorMessages.push(`(${rowLabel}): نسبة الزيادة يجب أن تكون بين 0 و 100`);
                    continue;
                }
                evalRows.push({
                    employee_id: emp.id,
                    evaluator_id: user.id,
                    score,
                    comments: row.comments ? String(row.comments).trim() : null,
                    evaluation_date: formatDateForDB(row.evaluation_date) || today(),
                    salary_increase_percent: rowIncrease,
                    salary_increase_amount: increaseAmount(emp, rowIncrease)
                });
            }

            let evaluationsAdded = 0;
            if (evalRows.length > 0) {
                const { error: insErr } = await supabase.from('hr_employee_evaluations').insert(evalRows);
                if (insErr) {
                    errorMessages.push(`فشل حفظ التقييمات: ${insErr.message}`);
                } else {
                    evaluationsAdded = evalRows.length;
                }
            }

            let alertMsg = `تم الانتهاء: تقييمات (${evaluationsAdded})، موظفين جدد (${createdEmployees})`;
            if (skippedRows > 0) alertMsg += `، صفوف بدون درجة (${skippedRows})`;
            if (errorMessages.length > 0) {
                alertMsg += `\n\nأخطاء (${errorMessages.length}):\n${errorMessages.slice(0, 10).join('\n')}`;
                if (errorMessages.length > 10) {
                    alertMsg += `\n... والمزيد (${errorMessages.length - 10} أخطاء أخرى)`;
                }
            }
            alert(alertMsg);
            fetchData();
        } catch (err: any) {
            alert('حدث خطأ أثناء رفع الملف: ' + err.message);
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    };

    // ----- Rendering -----
    const scoreBadgeClass = (score: number) => {
        if (score >= 85) return 'bg-green-50 text-green-600';
        if (score >= 70) return 'bg-blue-50 text-blue-600';
        if (score >= 50) return 'bg-orange-50 text-orange-600';
        return 'bg-red-50 text-red-600';
    };

    if (loading) return <div className="p-8 text-center text-gray-500">جاري التحميل...</div>;

    return (
        <div className="space-y-6 animate-fade-in-up">
            {/* Summary cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
                    <div className="p-3 bg-indigo-50 text-indigo-500 rounded-lg">
                        <span className="material-icons text-3xl">grading</span>
                    </div>
                    <div>
                        <h3 className="text-gray-500 text-sm font-medium">عدد التقييمات</h3>
                        <p className="text-2xl font-bold mt-1 text-gray-800">{visibleEvaluations.length}</p>
                    </div>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
                    <div className="p-3 bg-green-50 text-green-500 rounded-lg">
                        <span className="material-icons text-3xl">insights</span>
                    </div>
                    <div>
                        <h3 className="text-gray-500 text-sm font-medium">متوسط الدرجات {filterEmployee !== 'all' ? `— ${employeeName(filterEmployee)}` : ''}</h3>
                        <p className="text-2xl font-bold mt-1 text-gray-800">{averageScore !== null ? `${averageScore.toFixed(1)} / 100` : '—'}</p>
                    </div>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
                    <div className="p-3 bg-blue-50 text-blue-500 rounded-lg">
                        <span className="material-icons text-3xl">badge</span>
                    </div>
                    <div>
                        <h3 className="text-gray-500 text-sm font-medium">الموظفين المعروضين</h3>
                        <p className="text-2xl font-bold mt-1 text-gray-800">{visibleEmployees.length}</p>
                    </div>
                </div>
            </div>

            {/* Toolbar: project filter + Excel actions */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                    <span className="material-icons text-gray-400">business</span>
                    <span className="text-xs font-bold text-gray-500">المشروع:</span>
                    <select
                        className="border rounded-lg px-3 py-1.5 text-xs font-bold text-gray-800 bg-white"
                        value={projectFilter}
                        onChange={(e) => setProjectFilter(e.target.value)}
                    >
                        <option value="all">جميع المشاريع</option>
                        {projectNames.map(name => (
                            <option key={name} value={name}>{name}</option>
                        ))}
                    </select>
                </div>
                {canEvaluate && (
                    <div className="flex items-center gap-2 flex-wrap">
                        <button
                            onClick={downloadTemplate}
                            className="flex items-center gap-2 px-4 py-2 bg-green-50 text-green-600 rounded-lg font-bold text-xs hover:bg-green-100 transition-colors"
                        >
                            <span className="material-icons text-[18px]">download</span>
                            تحميل قالب Excel
                        </button>
                        <label className={`flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg font-bold text-xs hover:bg-blue-100 transition-colors cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                            <input ref={fileInputRef} type="file" hidden accept=".xlsx, .xls, .csv" onChange={handleFileUpload} disabled={uploading} />
                            <span className="material-icons text-[18px]">upload_file</span>
                            {uploading ? 'جاري الرفع...' : 'رفع ملف Excel'}
                        </label>
                    </div>
                )}
            </div>

            {/* Single evaluation form */}
            {canEvaluate && (
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                    <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <span className="material-icons text-primary">{editingId ? 'edit_note' : 'post_add'}</span>
                        {editingId ? 'تعديل التقييم' : 'إضافة تقييم فردي'}
                    </h3>
                    <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1">الموظف *</label>
                            <select
                                className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                                value={form.employee_id}
                                onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                                disabled={!!editingId}
                                required
                            >
                                <option value="">اختر الموظف...</option>
                                {groupedEmployees.map(([project, emps]) => (
                                    <optgroup key={project} label={project}>
                                        {emps.map(emp => (
                                            <option key={emp.id} value={emp.id}>{emp.full_name}{emp.employee_code ? ` (${emp.employee_code})` : ''}</option>
                                        ))}
                                    </optgroup>
                                ))}
                            </select>
                            {form.employee_id && (
                                <p className="text-[11px] text-gray-500 mt-1 flex items-center gap-1">
                                    <span className="material-icons text-[14px] text-gray-400">payments</span>
                                    الراتب الحالي (أساسي + متغير): <span className="font-bold text-gray-700">{formatSalary(currentSalaryOf(employees.find(e => e.id === form.employee_id)))}</span>
                                </p>
                            )}
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1">الدرجة (1 - 100) *</label>
                            <input
                                type="number"
                                min={1}
                                max={100}
                                step={1}
                                className="w-full border rounded-lg px-3 py-2 text-sm"
                                value={form.score}
                                onChange={(e) => setForm({ ...form, score: e.target.value })}
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1">نسبة الزيادة %</label>
                            <input
                                type="number"
                                min={0}
                                max={100}
                                step={0.5}
                                className="w-full border rounded-lg px-3 py-2 text-sm"
                                placeholder="اختياري"
                                value={form.salary_increase}
                                onChange={(e) => setForm({ ...form, salary_increase: e.target.value })}
                            />
                            {(() => {
                                const pct = parseIncreasePercent(form.salary_increase);
                                const emp = employees.find(e => e.id === form.employee_id);
                                if (pct === undefined || pct === null || !emp) return null;
                                const amount = increaseAmount(emp, pct);
                                const salary = currentSalaryOf(emp);
                                if (amount === null || salary === undefined) return null;
                                return (
                                    <p className="text-[11px] text-green-600 mt-1 font-bold">
                                        الزيادة: {formatSalary(amount)} ← الراتب الجديد: {formatSalary(salary + amount)}
                                    </p>
                                );
                            })()}
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1">تاريخ التقييم *</label>
                            <input
                                type="date"
                                className="w-full border rounded-lg px-3 py-2 text-sm"
                                value={form.evaluation_date}
                                onChange={(e) => setForm({ ...form, evaluation_date: e.target.value })}
                                required
                            />
                        </div>
                        <div className="md:col-span-2 lg:col-span-4">
                            <label className="block text-xs font-bold text-gray-500 mb-1">الملاحظات</label>
                            <textarea
                                className="w-full border rounded-lg px-3 py-2 text-sm"
                                rows={3}
                                maxLength={2000}
                                placeholder="ملاحظات المُقيِّم حول الأداء..."
                                value={form.comments}
                                onChange={(e) => setForm({ ...form, comments: e.target.value })}
                            />
                        </div>
                        <div className="flex gap-2 md:col-span-2 lg:col-span-4">
                            <button
                                type="submit"
                                disabled={isSaving}
                                className="px-6 py-2 bg-primary text-white rounded-lg font-bold text-sm shadow-md hover:opacity-90 transition-all disabled:opacity-50 flex items-center gap-2"
                            >
                                <span className="material-icons text-[18px]">save</span>
                                {isSaving ? 'جاري الحفظ...' : (editingId ? 'تحديث التقييم' : 'حفظ التقييم')}
                            </button>
                            {editingId && (
                                <button type="button" onClick={cancelEdit} className="px-4 py-2 border rounded-lg font-bold text-sm text-gray-600 hover:bg-gray-50">
                                    إلغاء
                                </button>
                            )}
                        </div>
                    </form>
                </div>
            )}

            {/* Bulk evaluation */}
            {canEvaluate && (
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                    <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <span className="material-icons text-primary">groups</span>
                        تقييم جماعي
                        {bulkSelected.length > 0 && (
                            <span className="bg-primary/10 text-primary text-xs font-bold px-2 py-0.5 rounded-full">{bulkSelected.length} محدد</span>
                        )}
                    </h3>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Employee checklist grouped by project */}
                        <div className="border rounded-lg overflow-hidden">
                            <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
                                {groupedEmployees.length === 0 && (
                                    <div className="p-6 text-center text-gray-400 text-sm">لا يوجد موظفين</div>
                                )}
                                {groupedEmployees.map(([project, emps]) => {
                                    const allSelected = emps.every(emp => bulkSelected.includes(emp.id));
                                    return (
                                        <div key={project}>
                                            <label className="flex items-center gap-2 px-3 py-2 bg-gray-50 cursor-pointer sticky top-0">
                                                <input
                                                    type="checkbox"
                                                    checked={allSelected}
                                                    onChange={() => toggleBulkProject(emps)}
                                                />
                                                <span className="material-icons text-gray-400 text-[16px]">business</span>
                                                <span className="text-xs font-bold text-gray-700">{project}</span>
                                                <span className="text-[10px] text-gray-400 font-bold">({emps.length})</span>
                                            </label>
                                            {emps.map(emp => (
                                                <label key={emp.id} className="flex items-center gap-2 px-3 py-2 pr-8 hover:bg-gray-50 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={bulkSelected.includes(emp.id)}
                                                        onChange={() => toggleBulkEmployee(emp.id)}
                                                    />
                                                    <span className="text-sm text-gray-800">{emp.full_name}</span>
                                                    {emp.employee_code && <span className="text-[10px] text-gray-400">({emp.employee_code})</span>}
                                                    <span className="text-[10px] text-gray-400 mr-auto">{formatSalary(currentSalaryOf(emp))}</span>
                                                </label>
                                            ))}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Shared score inputs */}
                        <div className="space-y-4">
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">الدرجة (1 - 100) *</label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={100}
                                        step={1}
                                        className="w-full border rounded-lg px-3 py-2 text-sm"
                                        value={bulkScore}
                                        onChange={(e) => setBulkScore(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">نسبة الزيادة %</label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={100}
                                        step={0.5}
                                        className="w-full border rounded-lg px-3 py-2 text-sm"
                                        placeholder="اختياري"
                                        value={bulkIncrease}
                                        onChange={(e) => setBulkIncrease(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">تاريخ التقييم *</label>
                                    <input
                                        type="date"
                                        className="w-full border rounded-lg px-3 py-2 text-sm"
                                        value={bulkDate}
                                        onChange={(e) => setBulkDate(e.target.value)}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">الملاحظات (تطبق على الجميع)</label>
                                <textarea
                                    className="w-full border rounded-lg px-3 py-2 text-sm"
                                    rows={3}
                                    maxLength={2000}
                                    placeholder="ملاحظات مشتركة للموظفين المحددين..."
                                    value={bulkComments}
                                    onChange={(e) => setBulkComments(e.target.value)}
                                />
                            </div>
                            <button
                                onClick={handleBulkSubmit}
                                disabled={bulkSaving || bulkSelected.length === 0}
                                className="px-6 py-2 bg-primary text-white rounded-lg font-bold text-sm shadow-md hover:opacity-90 transition-all disabled:opacity-50 flex items-center gap-2"
                            >
                                <span className="material-icons text-[18px]">done_all</span>
                                {bulkSaving ? 'جاري الحفظ...' : `حفظ التقييم الجماعي (${bulkSelected.length})`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* History */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
                    <h3 className="font-bold text-gray-800 flex items-center gap-2">
                        <span className="material-icons text-primary">history</span>
                        سجل التقييمات
                    </h3>
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-500">الموظف:</span>
                        <select
                            className="border rounded-lg px-3 py-1.5 text-xs font-bold text-gray-800 bg-white"
                            value={filterEmployee}
                            onChange={(e) => setFilterEmployee(e.target.value)}
                        >
                            <option value="all">جميع الموظفين</option>
                            {groupedEmployees.map(([project, emps]) => (
                                <optgroup key={project} label={project}>
                                    {emps.map(emp => (
                                        <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                    </div>
                </div>

                {visibleEvaluations.length === 0 ? (
                    <div className="p-8 text-center text-gray-400 text-sm">لا توجد تقييمات مسجلة</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 text-gray-500 text-xs">
                                <tr>
                                    <th className="p-3 text-right font-bold">الموظف</th>
                                    <th className="p-3 text-right font-bold">المشروع</th>
                                    <th className="p-3 text-right font-bold">الراتب الحالي</th>
                                    <th className="p-3 text-right font-bold">تاريخ التقييم</th>
                                    <th className="p-3 text-center font-bold">الدرجة</th>
                                    <th className="p-3 text-center font-bold">الزيادة</th>
                                    <th className="p-3 text-right font-bold">المُقيِّم</th>
                                    <th className="p-3 text-right font-bold">الملاحظات</th>
                                    {canEvaluate && <th className="p-3 text-center font-bold">إجراءات</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {visibleEvaluations.map(ev => {
                                    const emp = employees.find(e => e.id === ev.employee_id);
                                    return (
                                        <tr key={ev.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                                            <td className="p-3 font-bold text-gray-800">{emp?.full_name || '—'}</td>
                                            <td className="p-3 text-gray-600">{emp ? projectOf(emp) : '—'}</td>
                                            <td className="p-3 text-gray-600">{formatSalary(currentSalaryOf(emp))}</td>
                                            <td className="p-3 text-gray-600">{ev.evaluation_date}</td>
                                            <td className="p-3 text-center">
                                                <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${scoreBadgeClass(ev.score)}`}>
                                                    {ev.score} / 100
                                                </span>
                                            </td>
                                            <td className="p-3 text-center text-gray-600">
                                                {ev.salary_increase_percent !== null && ev.salary_increase_percent !== undefined
                                                    ? (
                                                        <span className="text-green-600 font-bold text-xs">
                                                            {ev.salary_increase_percent}%
                                                            {ev.salary_increase_amount !== null && ev.salary_increase_amount !== undefined ? ` (${formatSalary(ev.salary_increase_amount)})` : ''}
                                                        </span>
                                                    )
                                                    : '—'}
                                            </td>
                                            <td className="p-3 text-gray-600">{ev.evaluator_id ? (evaluatorNames[ev.evaluator_id] || '—') : '—'}</td>
                                            <td className="p-3 text-gray-600 max-w-xs whitespace-pre-wrap">{ev.comments || '—'}</td>
                                            {canEvaluate && (
                                                <td className="p-3 text-center">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <button onClick={() => startEdit(ev)} className="text-blue-500 hover:text-blue-700 p-1 bg-blue-50 rounded transition-colors" title="تعديل">
                                                            <span className="material-icons text-xs">edit</span>
                                                        </button>
                                                        {isFullAdmin && (
                                                            <button onClick={() => handleDelete(ev)} className="text-red-500 hover:text-red-700 p-1 bg-red-50 rounded transition-colors" title="حذف">
                                                                <span className="material-icons text-xs">delete</span>
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default HREvaluations;
