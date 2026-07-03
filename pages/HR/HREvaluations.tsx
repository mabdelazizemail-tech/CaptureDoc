import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabaseClient';
import { User } from '../../services/types';

interface Employee {
    id: string;
    full_name: string;
    department?: string;
    employee_code?: string;
}

interface Evaluation {
    id: string;
    employee_id: string;
    evaluator_id: string | null;
    score: number;
    comments: string | null;
    evaluation_date: string;
    created_at: string;
}

interface EvaluationForm {
    employee_id: string;
    score: string;
    comments: string;
    evaluation_date: string;
}

interface HREvaluationsProps {
    user: User;
    selectedProjectId: string;
}

const emptyForm = (): EvaluationForm => ({
    employee_id: '',
    score: '',
    comments: '',
    evaluation_date: new Date().toISOString().split('T')[0]
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

    const isFullAdmin = user.role === 'super_admin' || user.role === 'power_admin' || user.role === 'it_specialist' || user.role === 'hr_admin';
    const canEvaluate = isFullAdmin || user.role === 'project_manager';

    useEffect(() => {
        fetchData();
    }, [selectedProjectId]);

    const fetchData = async () => {
        setLoading(true);
        try {
            // Fetch active employees (same project scoping as the KPI screen)
            let empQuery = supabase.from('hr_employees').select('id, full_name, department, employee_code').eq('status', 'active');

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

    const validateForm = (): string | null => {
        if (!form.employee_id) return 'يرجى اختيار الموظف';
        const score = Number(form.score);
        if (!Number.isInteger(score) || score < 1 || score > 100) return 'الدرجة يجب أن تكون رقماً صحيحاً بين 1 و 100';
        if (!form.evaluation_date) return 'يرجى تحديد تاريخ التقييم';
        if (form.comments.length > 2000) return 'الملاحظات طويلة جداً (الحد الأقصى 2000 حرف)';
        return null;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const validationError = validateForm();
        if (validationError) {
            alert(validationError);
            return;
        }

        setIsSaving(true);
        try {
            const payload = {
                employee_id: form.employee_id,
                score: Number(form.score),
                comments: form.comments.trim() || null,
                evaluation_date: form.evaluation_date
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

    const scoreBadgeClass = (score: number) => {
        if (score >= 85) return 'bg-green-50 text-green-600';
        if (score >= 70) return 'bg-blue-50 text-blue-600';
        if (score >= 50) return 'bg-orange-50 text-orange-600';
        return 'bg-red-50 text-red-600';
    };

    const visibleEvaluations = filterEmployee === 'all'
        ? evaluations
        : evaluations.filter(ev => ev.employee_id === filterEmployee);

    const averageScore = visibleEvaluations.length > 0
        ? (visibleEvaluations.reduce((sum, ev) => sum + ev.score, 0) / visibleEvaluations.length)
        : null;

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
                        <h3 className="text-gray-500 text-sm font-medium">الموظفين النشطين</h3>
                        <p className="text-2xl font-bold mt-1 text-gray-800">{employees.length}</p>
                    </div>
                </div>
            </div>

            {/* Evaluation form */}
            {canEvaluate && (
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                    <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <span className="material-icons text-primary">{editingId ? 'edit_note' : 'post_add'}</span>
                        {editingId ? 'تعديل التقييم' : 'إضافة تقييم جديد'}
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
                                {employees.map(emp => (
                                    <option key={emp.id} value={emp.id}>{emp.full_name}{emp.employee_code ? ` (${emp.employee_code})` : ''}</option>
                                ))}
                            </select>
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
                            {employees.map(emp => (
                                <option key={emp.id} value={emp.id}>{emp.full_name}</option>
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
                                    <th className="p-3 text-right font-bold">تاريخ التقييم</th>
                                    <th className="p-3 text-center font-bold">الدرجة</th>
                                    <th className="p-3 text-right font-bold">المُقيِّم</th>
                                    <th className="p-3 text-right font-bold">الملاحظات</th>
                                    {canEvaluate && <th className="p-3 text-center font-bold">إجراءات</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {visibleEvaluations.map(ev => (
                                    <tr key={ev.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                                        <td className="p-3 font-bold text-gray-800">{employeeName(ev.employee_id)}</td>
                                        <td className="p-3 text-gray-600">{ev.evaluation_date}</td>
                                        <td className="p-3 text-center">
                                            <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${scoreBadgeClass(ev.score)}`}>
                                                {ev.score} / 100
                                            </span>
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
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default HREvaluations;
