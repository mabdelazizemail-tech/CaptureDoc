import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabaseClient';
import { User } from '../../services/types';
import Toast from '../../components/Toast';
import ConfirmationModal from '../../components/ConfirmationModal';

interface Employee {
    id: string;
    full_name: string;
    annual_leave_balance: number;
    status: string;
}

interface LeaveRequest {
    id: string;
    employee_id: string;
    leave_type: string;
    start_date: string;
    end_date: string;
    total_days: number;
    status: 'pending' | 'approved' | 'rejected';
    created_at: string;
    hr_employees?: {
        full_name: string;
        annual_leave_balance: number;
    };
}

interface HRLeaveProps {
    user: User;
    selectedProjectId: string;
}

const HRLeave: React.FC<HRLeaveProps> = ({ user, selectedProjectId }) => {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [formData, setFormData] = useState({
        employee_id: '',
        start_date: new Date().toISOString().split('T')[0],
        end_date: new Date().toISOString().split('T')[0],
        leave_type: 'annual'
    });
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const isAdmin = user.role === 'super_admin' || user.role === 'power_admin' || user.role === 'it_specialist' || user.role === 'hr_admin';

    useEffect(() => {
        fetchData();
    }, [selectedProjectId]);

    const fetchData = async () => {
        setLoading(true);
        try {
            let empQuery = supabase.from('hr_employees')
                .select('id, full_name, annual_leave_balance, status')
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

            const { data: empData } = await empQuery.order('full_name');
            if (empData) setEmployees(empData);

            // Fetch leave requests
            let leaveQuery = supabase.from('hr_leave_requests')
                .select(`
                    *,
                    hr_employees!inner (
                        full_name,
                        annual_leave_balance,
                        project
                    )
                `);

            if (projectToFilter) {
                // To filter by project implicitly via hr_employees
                const { data: proj } = await supabase.from('projects').select('name').eq('id', projectToFilter).single();
                if (proj) {
                    leaveQuery = leaveQuery.or(`project.eq.${proj.name},project.eq.${projectToFilter}`, { foreignTable: 'hr_employees' });
                } else {
                    leaveQuery = leaveQuery.eq('hr_employees.project', projectToFilter);
                }
            }

            const { data: leaveData } = await leaveQuery.order('created_at', { ascending: false });
            if (leaveData) setLeaveRequests(leaveData as any);
        } catch (error) {
            console.error('Error fetching data:', error);
        }
        setLoading(false);
    };

    const calculateDays = (start: string, end: string) => {
        const d1 = new Date(start);
        const d2 = new Date(end);
        const diffTime = Math.abs(d2.getTime() - d1.getTime());
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.employee_id) return;

        const total_days = calculateDays(formData.start_date, formData.end_date);
        if (total_days <= 0) {
            setToast({ message: 'تاريخ النهاية يجب أن يكون بعد تاريخ البدء', type: 'error' });
            return;
        }

        const selectedEmp = employees.find(e => e.id === formData.employee_id);
        if (selectedEmp && selectedEmp.annual_leave_balance < total_days && formData.leave_type === 'annual') {
            setToast({ message: 'رصيد الموظف غير كافٍ', type: 'error' });
            return;
        }

        setIsSubmitting(true);
        const { error } = await supabase
            .from('hr_leave_requests')
            .insert({
                employee_id: formData.employee_id,
                leave_type: formData.leave_type,
                start_date: formData.start_date,
                end_date: formData.end_date,
                total_days: total_days,
                status: 'pending'
            });

        if (error) {
            setToast({ message: 'فشل في تقديم الطلب', type: 'error' });
        } else {
            setToast({ message: 'تم تقديم طلب الإجازة بنجاح', type: 'success' });
            setShowModal(false);
            fetchData();
        }
        setIsSubmitting(false);
    };

    const handleApprove = async (id: string) => {
        const { error } = await supabase.rpc('hr_approve_leave', { p_leave_id: id });
        if (error) {
            setToast({ message: 'فشل في حفظ الاجازة وتحديث الرصيد', type: 'error' });
        } else {
            setToast({ message: 'تمت الموافقة على الاجازة وتحديث الرصيد', type: 'success' });
            fetchData();
        }
    };

    const handleReject = async (id: string) => {
        const { error } = await supabase.rpc('hr_reject_leave', { p_leave_id: id });
        if (error) {
            setToast({ message: 'فشل في رفض الطلب', type: 'error' });
        } else {
            setToast({ message: 'تم رفض طلب الاجازة', type: 'success' });
            fetchData();
        }
    };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-gray-800">ادارة الاجازات</h2>
                    <p className="text-gray-500 text-sm mt-1">تقديم ومراجعة طلبات الاجازات والتحقق من الأرصدة</p>
                </div>
                <button
                    onClick={() => setShowModal(true)}
                    className="bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 shadow-sm transition-all active:scale-95"
                >
                    <span className="material-icons text-sm">add</span>
                    طلب اجازة جديد
                </button>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-right border-collapse">
                        <thead>
                            <tr className="bg-gray-50 text-gray-400 text-xs uppercase font-bold border-b border-gray-100">
                                <th className="px-6 py-4">الموظف</th>
                                <th className="px-4 py-4 text-center">النوع</th>
                                <th className="px-4 py-4 text-center">بواسطة</th>
                                <th className="px-4 py-4 text-center">إلى</th>
                                <th className="px-4 py-4 text-center">الأيام</th>
                                <th className="px-4 py-4 text-center">الرصيد المتبقي</th>
                                <th className="px-4 py-4 text-center">الحالة</th>
                                <th className="px-6 py-4 text-left">الإجراءات</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 text-sm">
                            {loading ? (
                                <tr>
                                    <td colSpan={8} className="px-6 py-12 text-center text-gray-400">
                                        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2"></div>
                                        جاري التحميل...
                                    </td>
                                </tr>
                            ) : leaveRequests.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="px-6 py-12 text-center text-gray-400">
                                        لا توجد طلبات إجازة حالياً
                                    </td>
                                </tr>
                            ) : (
                                leaveRequests.map((req) => (
                                    <tr key={req.id} className="hover:bg-gray-50 transition-colors group">
                                        <td className="px-6 py-4 font-bold text-gray-800">{req.hr_employees?.full_name}</td>
                                        <td className="px-4 py-4 text-center">
                                            <span className={`px-2 py-1 rounded-lg text-[10px] font-bold ${req.leave_type === 'annual' ? 'bg-blue-50 text-blue-600' : req.leave_type === 'sick' ? 'bg-orange-50 text-orange-600' : 'bg-gray-100 text-gray-500'}`}>
                                                {req.leave_type === 'annual' ? 'سنوية' : req.leave_type === 'sick' ? 'مرضية' : 'بدون راتب'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-4 text-center text-gray-500">{req.start_date}</td>
                                        <td className="px-4 py-4 text-center text-gray-500">{req.end_date}</td>
                                        <td className="px-4 py-4 text-center font-bold">{req.total_days}</td>
                                        <td className="px-4 py-4 text-center text-gray-400">{req.hr_employees?.annual_leave_balance} يوم</td>
                                        <td className="px-4 py-4 text-center">
                                            <span className={`px-2 py-1 rounded-lg text-[10px] font-bold ${req.status === 'approved' ? 'bg-green-100 text-green-700' :
                                                req.status === 'rejected' ? 'bg-red-100 text-red-700' :
                                                    'bg-yellow-100 text-yellow-700'
                                                }`}>
                                                {req.status === 'approved' ? 'مقبول' : req.status === 'rejected' ? 'مرفوض' : 'قيد الانتظار'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            {isAdmin && req.status === 'pending' && (
                                                <div className="flex gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={() => handleApprove(req.id)}
                                                        className="bg-green-500 hover:bg-green-600 text-white p-2 rounded-lg shadow-sm"
                                                        title="موافقة"
                                                    >
                                                        <span className="material-icons text-sm">check</span>
                                                    </button>
                                                    <button
                                                        onClick={() => handleReject(req.id)}
                                                        className="bg-red-500 hover:bg-red-600 text-white p-2 rounded-lg shadow-sm"
                                                        title="رفض"
                                                    >
                                                        <span className="material-icons text-sm">close</span>
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Request Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-scale-in">
                        <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                            <h3 className="text-xl font-bold text-gray-800">طلب اجازة جديد</h3>
                            <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 outline-none">
                                <span className="material-icons">close</span>
                            </button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-8 space-y-6">
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">الموظف</label>
                                    <select
                                        required
                                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all bg-white"
                                        value={formData.employee_id}
                                        onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                                    >
                                        <option value="">اختر موظفاً...</option>
                                        {employees.map(emp => (
                                            <option key={emp.id} value={emp.id}>
                                                {emp.full_name} (الرصيد: {emp.annual_leave_balance})
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">نوع الاجازة</label>
                                    <select
                                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all bg-white"
                                        value={formData.leave_type}
                                        onChange={(e) => setFormData({ ...formData, leave_type: e.target.value })}
                                    >
                                        <option value="annual">سنوية</option>
                                        <option value="sick">مرضية</option>
                                        <option value="unpaid">بدون راتب</option>
                                    </select>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-1">من تاريخ</label>
                                        <input
                                            type="date"
                                            required
                                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                                            value={formData.start_date}
                                            onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-1">إلى تاريخ</label>
                                        <input
                                            type="date"
                                            required
                                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                                            value={formData.end_date}
                                            onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div className={`p-4 rounded-xl flex items-center justify-between ${formData.employee_id && calculateDays(formData.start_date, formData.end_date) > (employees.find(e => e.id === formData.employee_id)?.annual_leave_balance || 0) && formData.leave_type === 'annual'
                                    ? 'bg-red-50 text-red-700'
                                    : 'bg-blue-50 text-blue-700'
                                    }`}>
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold opacity-70">إجمالي الأيام المطلوبة:</span>
                                        <span className="text-xl font-black">
                                            {calculateDays(formData.start_date, formData.end_date)} يوم
                                        </span>
                                    </div>
                                    {formData.employee_id && (
                                        <div className="text-left">
                                            <span className="text-xs font-bold opacity-70 block text-right">الرصيد المتاح:</span>
                                            <span className="text-lg font-bold">
                                                {employees.find(e => e.id === formData.employee_id)?.annual_leave_balance} يوم
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {formData.employee_id && formData.leave_type === 'annual' && calculateDays(formData.start_date, formData.end_date) > (employees.find(e => e.id === formData.employee_id)?.annual_leave_balance || 0) && (
                                    <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-xl border border-red-100 animate-pulse">
                                        <span className="material-icons text-sm">warning</span>
                                        <span className="text-xs font-bold">عذراً، الرصيد المتاح غير كافٍ لهذا الطلب</span>
                                    </div>
                                )}
                            </div>

                            <button
                                type="submit"
                                disabled={isSubmitting || (formData.employee_id && formData.leave_type === 'annual' && calculateDays(formData.start_date, formData.end_date) > (employees.find(e => e.id === formData.employee_id)?.annual_leave_balance || 0))}
                                className={`w-full py-4 rounded-2xl font-black text-lg shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${isSubmitting || (formData.employee_id && formData.leave_type === 'annual' && calculateDays(formData.start_date, formData.end_date) > (employees.find(e => e.id === formData.employee_id)?.annual_leave_balance || 0))
                                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none'
                                    : 'bg-primary hover:bg-primary-dark text-white shadow-primary/20'
                                    }`}
                            >
                                {isSubmitting ? 'جاري الإرسال...' : 'تقديم الطلب'}
                                {!isSubmitting && <span className="material-icons">send</span>}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
        </div>
    );
};

export default HRLeave;
