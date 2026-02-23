import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabaseClient';
import { User } from '../../services/types';
import Toast from '../../components/Toast';
import ConfirmationModal from '../../components/ConfirmationModal';

interface Holiday {
    id: string;
    name: string;
    start_date: string;
    end_date: string;
    type: 'public' | 'company';
    description?: string;
}

interface HRHolidaysProps {
    user: User;
}

const HRHolidays: React.FC<HRHolidaysProps> = ({ user }) => {
    const [holidays, setHolidays] = useState<Holiday[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingHoliday, setEditingHoliday] = useState<Partial<Holiday> | null>(null);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; id: string } | null>(null);

    const isAdmin = user.role === 'super_admin' || user.role === 'power_admin' || user.role === 'it_specialist' || user.role === 'hr_admin';

    useEffect(() => {
        fetchHolidays();
    }, []);

    const fetchHolidays = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('hr_holidays')
            .select('*')
            .order('start_date', { ascending: true });

        if (error) {
            setToast({ message: 'فشل في جلب العطلات', type: 'error' });
        } else {
            setHolidays(data || []);
        }
        setLoading(false);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingHoliday?.name || !editingHoliday?.start_date || !editingHoliday?.end_date) {
            setToast({ message: 'يرجى ملء جميع الحقول المطلوبة', type: 'error' });
            return;
        }

        const payload = {
            name: editingHoliday.name,
            start_date: editingHoliday.start_date,
            end_date: editingHoliday.end_date,
            type: editingHoliday.type || 'public',
            description: editingHoliday.description || ''
        };

        let error;
        if (editingHoliday.id) {
            const { error: err } = await supabase
                .from('hr_holidays')
                .update(payload)
                .eq('id', editingHoliday.id);
            error = err;
        } else {
            const { error: err } = await supabase
                .from('hr_holidays')
                .insert(payload);
            error = err;
        }

        if (error) {
            setToast({ message: 'فشل في حفظ العطلة', type: 'error' });
        } else {
            setToast({ message: 'تم حفظ العطلة بنجاح', type: 'success' });
            setShowModal(false);
            fetchHolidays();
        }
    };

    const handleDelete = async (id: string) => {
        const { error } = await supabase
            .from('hr_holidays')
            .delete()
            .eq('id', id);

        if (error) {
            setToast({ message: 'فشل في حذف العطلة', type: 'error' });
        } else {
            setToast({ message: 'تم حذف العطلة بنجاح', type: 'success' });
            setConfirmModal(null);
            fetchHolidays();
        }
    };

    const openModal = (holiday: Partial<Holiday> | null = null) => {
        setEditingHoliday(holiday || { type: 'public', start_date: new Date().toISOString().split('T')[0], end_date: new Date().toISOString().split('T')[0] });
        setShowModal(true);
    };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-gray-800">العطلات الرسمية والإجازات</h2>
                    <p className="text-gray-500 text-sm mt-1">إدارة العطلات الرسمية والمناسبات الخاصة بالشركة</p>
                </div>
                {isAdmin && (
                    <button
                        onClick={() => openModal()}
                        className="bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 shadow-sm transition-all active:scale-95"
                    >
                        <span className="material-icons text-sm">add</span>
                        إضافة عطلة
                    </button>
                )}
            </div>

            {loading ? (
                <div className="bg-white rounded-2xl p-12 text-center shadow-sm border border-gray-100">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-gray-500">جاري تحميل العطلات...</p>
                </div>
            ) : holidays.length === 0 ? (
                <div className="bg-white rounded-2xl p-16 text-center shadow-sm border border-gray-100">
                    <span className="material-icons text-6xl text-gray-200 mb-4">event_busy</span>
                    <h3 className="text-xl font-bold text-gray-400">لا توجد عطلات مسجلة</h3>
                    <p className="text-gray-400 mt-2">ابدأ بإضافة أول عطلة للمنظومة</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {holidays.map((holiday) => (
                        <div key={holiday.id} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 hover:shadow-md transition-shadow group relative">
                            <div className={`h-2 ${holiday.type === 'public' ? 'bg-indigo-500' : 'bg-orange-500'}`}></div>
                            <div className="p-6">
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <span className={`inline-block px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider mb-2 ${holiday.type === 'public' ? 'bg-indigo-50 text-indigo-600' : 'bg-orange-50 text-orange-600'}`}>
                                            {holiday.type === 'public' ? 'عطلة رسمية' : 'إجازة شركة'}
                                        </span>
                                        <h3 className="text-lg font-bold text-gray-800">{holiday.name}</h3>
                                    </div>
                                    <div className="bg-gray-50 p-2 rounded-xl text-center min-w-[60px]">
                                        <p className="text-[10px] text-gray-400 font-bold uppercase">الأيام</p>
                                        <p className="text-lg font-black text-primary">
                                            {Math.ceil((new Date(holiday.end_date).getTime() - new Date(holiday.start_date).getTime()) / (1000 * 60 * 60 * 24)) + 1}
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-3 mb-6">
                                    <div className="flex items-center gap-3 text-gray-500 text-sm">
                                        <span className="material-icons text-sm text-gray-300">calendar_today</span>
                                        <span>من: {new Date(holiday.start_date).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-gray-500 text-sm">
                                        <span className="material-icons text-sm text-gray-300">event</span>
                                        <span>إلى: {new Date(holiday.end_date).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                                    </div>
                                    {holiday.description && (
                                        <p className="text-gray-400 text-xs mt-4 line-clamp-2 italic">
                                            "{holiday.description}"
                                        </p>
                                    )}
                                </div>

                                {isAdmin && (
                                    <div className="flex gap-2 pt-4 border-t border-gray-50">
                                        <button
                                            onClick={() => openModal(holiday)}
                                            className="flex-1 bg-gray-50 hover:bg-blue-50 hover:text-blue-600 text-gray-600 p-2 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm font-bold"
                                        >
                                            <span className="material-icons text-sm">edit</span>
                                            تعديل
                                        </button>
                                        <button
                                            onClick={() => setConfirmModal({ isOpen: true, id: holiday.id })}
                                            className="flex-1 bg-gray-50 hover:bg-red-50 hover:text-red-600 text-gray-600 p-2 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm font-bold"
                                        >
                                            <span className="material-icons text-sm">delete</span>
                                            حذف
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modal for adding/editing */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-scale-in">
                        <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                            <h3 className="text-xl font-bold text-gray-800">{editingHoliday?.id ? 'تعديل عطلة' : 'إضافة عطلة جديدة'}</h3>
                            <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                                <span className="material-icons">close</span>
                            </button>
                        </div>
                        <form onSubmit={handleSave} className="p-8 space-y-6">
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">اسم العطلة</label>
                                    <input
                                        type="text"
                                        required
                                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                                        placeholder="مثلاً: عيد الفطر"
                                        value={editingHoliday?.name || ''}
                                        onChange={(e) => setEditingHoliday({ ...editingHoliday, name: e.target.value })}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-1">تاريخ البدء</label>
                                        <input
                                            type="date"
                                            required
                                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                                            value={editingHoliday?.start_date || ''}
                                            onChange={(e) => setEditingHoliday({ ...editingHoliday, start_date: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-1">تاريخ الانتهاء</label>
                                        <input
                                            type="date"
                                            required
                                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                                            value={editingHoliday?.end_date || ''}
                                            onChange={(e) => setEditingHoliday({ ...editingHoliday, end_date: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">النوع</label>
                                    <select
                                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all appearance-none bg-white"
                                        value={editingHoliday?.type || 'public'}
                                        onChange={(e) => setEditingHoliday({ ...editingHoliday, type: e.target.value as any })}
                                    >
                                        <option value="public">عطلة رسمية (دولة)</option>
                                        <option value="company">إجازة خاصة بالشركة</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">الوصف (اختياري)</label>
                                    <textarea
                                        rows={3}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all resize-none"
                                        placeholder="تفاصيل إضافية..."
                                        value={editingHoliday?.description || ''}
                                        onChange={(e) => setEditingHoliday({ ...editingHoliday, description: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button
                                    type="submit"
                                    className="flex-1 bg-primary hover:bg-primary-dark text-white py-4 rounded-2xl font-black text-lg shadow-lg shadow-primary/20 transition-all active:scale-95"
                                >
                                    حفظ البيانات
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="flex-1 bg-gray-50 hover:bg-gray-100 text-gray-500 py-4 rounded-2xl font-bold transition-all"
                                >
                                    إلغاء
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {toast && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    onClose={() => setToast(null)}
                />
            )}

            {confirmModal && (
                <ConfirmationModal
                    isOpen={confirmModal.isOpen}
                    title="حذف العطلة"
                    message="هل أنت متأكد من حذف هذه العطلة؟ لا يمكن التراجع عن هذا الإجراء."
                    onConfirm={() => handleDelete(confirmModal.id)}
                    onCancel={() => setConfirmModal(null)}
                    isDangerous
                />
            )}
        </div>
    );
};

export default HRHolidays;
