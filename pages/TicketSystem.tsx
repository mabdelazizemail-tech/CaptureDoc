
import React, { useState, useEffect } from 'react';
import { User, Ticket, Asset } from '../services/types';
import { StorageService } from '../services/storage';
import { supabase } from '../services/supabaseClient';
import Toast from '../components/Toast';
import ConfirmationModal from '../components/ConfirmationModal';

interface TicketSystemProps {
    user: User;
}

const TicketSystem: React.FC<TicketSystemProps> = ({ user }) => {
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [assets, setAssets] = useState<Asset[]>([]);
    const [pmProjects, setPmProjects] = useState<{ id: string, name: string }[]>([]);
    const [loading, setLoading] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [solveModal, setSolveModal] = useState<{ isOpen: boolean, ticketId: string, cost: string }>({ isOpen: false, ticketId: '', cost: '' });

    // Admin States
    const [selectedTickets, setSelectedTickets] = useState<string[]>([]);
    const [editModal, setEditModal] = useState<{ isOpen: boolean, ticket: Ticket | null }>({ isOpen: false, ticket: null });

    // Feedback States
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
        isDangerous?: boolean;
    }>({
        isOpen: false, title: '', message: '', onConfirm: () => { }, isDangerous: false
    });

    const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
        setToast({ message, type });
    };

    const confirmAction = (message: string, onConfirm: () => void, isDangerous = false) => {
        setConfirmModal({ isOpen: true, message, title: 'تأكيد الإجراء', onConfirm, isDangerous });
    };

    const closeConfirmModal = () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
    };

    // Form State
    const [newTicket, setNewTicket] = useState<{
        title: string;
        category: Ticket['category'];
        projectId: string; // explicitly requested for PM
        assetId: string;
        description: string;
        priority: Ticket['priority'];
    }>({
        title: '',
        category: 'hardware',
        projectId: '',
        assetId: '',
        description: '',
        priority: 'medium'
    });

    // Metrics for Admin
    const [metrics, setMetrics] = useState({
        avgTime: '0h',
        total: 0,
        open: 0
    });

    const isSuperAdmin = ['super_admin', 'power_admin'].includes(user.role);

    const loadData = async () => {
        setLoading(true);
        const fetchedTickets = await StorageService.getTickets(user);
        setTickets(fetchedTickets);

        if (user.role === 'supervisor' && user.projectId) {
            const fetchedAssets = await StorageService.getAssets(user.projectId);
            setAssets(fetchedAssets);
        } else if (user.role === 'project_manager') {
            const projects = await StorageService.getProjectsByPM(user.id);
            setPmProjects(projects.map(p => ({ id: p.id, name: p.name })));
            // Note: PM Assets will load dynamically once they select a specific project in the dropdown UI.
        }

        setLoading(false);
    };

    useEffect(() => {
        loadData();
        const channel = supabase.channel(`tickets-${user.id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
                loadData();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user]);

    useEffect(() => {
        if ((isSuperAdmin || user.role === 'it_specialist') && tickets.length > 0) {
            const solvedTickets = tickets.filter(t => t.status === 'solved' || t.status === 'closed');
            let totalTimeMs = 0;
            let count = 0;

            solvedTickets.forEach(t => {
                if (t.solvedAt && t.createdAt) {
                    totalTimeMs += new Date(t.solvedAt).getTime() - new Date(t.createdAt).getTime();
                    count++;
                }
            });

            const avgHours = count > 0 ? (totalTimeMs / count / (1000 * 60 * 60)).toFixed(1) : '0';

            setMetrics({
                avgTime: `${avgHours} hrs`,
                total: tickets.length,
                open: tickets.filter(t => t.status === 'open').length
            });
        }
    }, [tickets, isSuperAdmin, user.role]);

    const handleCreateTicket = async (e: React.FormEvent) => {
        e.preventDefault();

        const projectIdToUse = user.role === 'project_manager' ? newTicket.projectId : user.projectId;

        if (!projectIdToUse) {
            showToast('Error: You are not assigned to a project or did not select one.', 'error');
            return;
        }

        const result = await StorageService.createTicket({
            ...newTicket,
            createdBy: user.id,
            projectId: projectIdToUse
        });

        if (result.success) {
            setShowCreateModal(false);
            setNewTicket({ ...newTicket, title: '', category: 'hardware', assetId: '', description: '', priority: 'medium' });
            showToast('تم إنشاء التذكرة بنجاح');
            loadData();
        } else {
            showToast(`Error: ${result.error}`, 'error');
        }
    };

    const handleStatusChange = async (id: string, newStatus: 'in_progress' | 'solved' | 'closed' | 'open') => {
        if (newStatus === 'solved') {
            setSolveModal({ isOpen: true, ticketId: id, cost: '' });
            return;
        }

        const label = newStatus === 'in_progress' ? 'قيد العمل' : newStatus === 'open' ? 'مفتوح' : 'مغلق';
        confirmAction(
            `تغيير حالة التذكرة إلى ${label}؟`,
            async () => {
                const success = await StorageService.updateTicketStatus(id, newStatus);
                if (success) {
                    loadData();
                    showToast('تم تحديث الحالة');
                }
                else {
                    showToast('Failed to update status', 'error');
                }
                closeConfirmModal();
            }
        );
    };

    const handleSolveSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const success = await StorageService.updateTicketStatus(solveModal.ticketId, 'solved', Number(solveModal.cost) || 0);
        if (success) {
            loadData();
            showToast('تم حل التذكرة وتسجيل التكلفة بنجاح');
        } else {
            showToast('Failed to update ticket', 'error');
        }
        setSolveModal({ isOpen: false, ticketId: '', cost: '' });
    };

    // Admin Bulk Actions
    const toggleTicketSelection = (id: string) => {
        setSelectedTickets(prev => prev.includes(id) ? prev.filter(tId => tId !== id) : [...prev, id]);
    };

    const handleBulkDelete = () => {
        if (selectedTickets.length === 0) return;
        confirmAction(`هل أنت متأكد من حذف ${selectedTickets.length} تذاكر بشكل نهائي؟`, async () => {
            const success = await StorageService.deleteTickets(selectedTickets);
            if (success) {
                showToast('تم حذف التذاكر بنجاح');
                setSelectedTickets([]);
                loadData();
            } else {
                showToast('فشل في حذف التذاكر', 'error');
            }
            closeConfirmModal();
        }, true);
    };

    const handleBulkOpen = () => {
        if (selectedTickets.length === 0) return;
        confirmAction(`هل أنت متأكد من إعادة فتح ${selectedTickets.length} تذاكر؟`, async () => {
            let allSuccess = true;
            for (const id of selectedTickets) {
                const res = await StorageService.updateTicketStatus(id, 'open');
                if (!res) allSuccess = false;
            }
            if (allSuccess) {
                showToast('تم إعادة فتح التذاكر بنجاح');
                setSelectedTickets([]);
                loadData();
            } else {
                showToast('حدث خطأ أثناء إعادة الفتح', 'error');
            }
            closeConfirmModal();
        });
    };

    const handleEditSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editModal.ticket) return;
        const success = await StorageService.updateTicket(editModal.ticket.id, {
            title: editModal.ticket.title,
            category: editModal.ticket.category,
            priority: editModal.ticket.priority,
            cost: editModal.ticket.cost
        });
        if (success) {
            showToast('تم تحديث التذكرة بنجاح');
            setEditModal({ isOpen: false, ticket: null });
            loadData();
        } else {
            showToast('خطأ أثناء التحديث', 'error');
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'open': return 'bg-red-100 text-red-700';
            case 'in_progress': return 'bg-blue-100 text-blue-700';
            case 'solved': return 'bg-green-100 text-green-700';
            case 'closed': return 'bg-gray-100 text-gray-600';
            default: return 'bg-gray-50';
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'open': return 'مفتوح';
            case 'in_progress': return 'قيد التنفيذ';
            case 'solved': return 'تم الحل';
            case 'closed': return 'مغلق';
            default: return status;
        }
    };

    const renderCreatorView = () => {
        const myOpenTickets = tickets.filter(t => t.status !== 'closed');
        const ticketsToVerify = tickets.filter(t => t.status === 'solved');

        return (
            <div className="space-y-6 animate-fade-in-up">
                <div className="flex justify-between items-center bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">نظام التذاكر</h2>
                        <p className="text-gray-500 text-sm">إدارة المشاكل التقنية والبلاغات</p>
                    </div>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="bg-primary text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-primary-dark"
                    >
                        <span className="material-icons">add</span> تذكرة جديدة
                    </button>
                </div>

                {ticketsToVerify.length > 0 && (
                    <div className="bg-green-50 border border-green-200 rounded-xl p-6">
                        <h3 className="font-bold text-green-800 flex items-center gap-2 mb-4">
                            <span className="material-icons">fact_check</span> تذاكر بانتظار إغلاقك (تم الحل)
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {ticketsToVerify.map(t => (
                                <div key={t.id} className="bg-white p-4 rounded-lg shadow-sm border border-green-100 flex justify-between items-center">
                                    <div>
                                        <div className="font-bold text-gray-800">{t.title}</div>
                                        <div className="text-xs text-gray-500 mt-1">تم إرسال الحل للتحقق في {t.solvedAt ? new Date(t.solvedAt).toLocaleDateString() : ''}</div>
                                    </div>
                                    <button
                                        onClick={() => handleStatusChange(t.id, 'closed')}
                                        className="bg-green-600 text-white px-3 py-1.5 rounded text-sm font-bold hover:bg-green-700"
                                    >
                                        إغلاق التذكرة
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 gap-4">
                    {myOpenTickets.map(t => (
                        <div key={t.id} className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${getStatusColor(t.status)}`}>{getStatusLabel(t.status)}</span>
                                    <span className="font-bold text-gray-800 text-lg">{t.title}</span>
                                </div>
                                <p className="text-gray-600 text-sm mb-2">{t.description}</p>
                                <div className="flex gap-4 text-xs text-gray-400">
                                    <span className="flex items-center gap-1"><span className="material-icons text-xs">category</span> {t.category}</span>
                                    <span className="flex items-center gap-1"><span className="material-icons text-xs">inventory_2</span> {t.assetName || 'بدون أصل'}</span>
                                    <span className="flex items-center gap-1"><span className="material-icons text-xs">calendar_today</span> {new Date(t.createdAt).toLocaleDateString()}</span>
                                </div>
                            </div>
                            {t.status === 'in_progress' && (
                                <div className="bg-blue-50 text-blue-600 px-3 py-1 rounded text-xs font-bold animate-pulse">
                                    جاري العمل عليها...
                                </div>
                            )}
                        </div>
                    ))}
                    {myOpenTickets.length === 0 && (
                        <div className="text-center py-10 text-gray-400 bg-white rounded-xl border border-dashed">
                            لا توجد تذاكر مفتوحة
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderSupportDashboard = () => {
        const openTickets = tickets.filter(t => t.status === 'open');
        const inProgressTickets = tickets.filter(t => t.status === 'in_progress');

        return (
            <div className="space-y-6 animate-fade-in-up">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800">لوحة تحكم الدعم الفني</h2>
                        <p className="text-sm text-gray-500">نظرة شاملة ومتابعة فورية للحالات</p>
                    </div>
                    {(isSuperAdmin || user.role === 'it_specialist') && (
                        <div className="flex items-center gap-2 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100">
                            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
                            <span className="text-xs font-bold text-blue-700">تحديث تلقائي مفعل</span>
                        </div>
                    )}
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                        <div className="text-gray-500 text-xs font-bold uppercase">إجمالي التذاكر</div>
                        <div className="text-3xl font-bold text-gray-800 mt-1">{metrics.total}</div>
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                        <div className="text-gray-500 text-xs font-bold uppercase">متوسط وقت الحل</div>
                        <div className="text-3xl font-bold text-blue-600 mt-1">{metrics.avgTime}</div>
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                        <div className="text-gray-500 text-xs font-bold uppercase">تذاكر مفتوحة</div>
                        <div className="text-3xl font-bold text-red-600 mt-1">{metrics.open}</div>
                    </div>
                </div>

                {/* Kanban Task Board */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Open Column */}
                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                        <h3 className="font-bold text-gray-700 mb-4 flex items-center gap-2 border-b pb-2">
                            <span className="w-3 h-3 rounded-full bg-red-500"></span>
                            تذاكر مفتوحة ({openTickets.length})
                        </h3>
                        <div className="space-y-3">
                            {openTickets.map(t => (
                                <div key={t.id} className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 group hover:border-red-200 transition-all">
                                    <div className="flex justify-between items-start mb-2">
                                        <span className="font-bold text-gray-800">{t.title}</span>
                                        <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${t.priority === 'critical' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{t.priority}</span>
                                    </div>
                                    <p className="text-xs text-gray-600 mb-3 line-clamp-2">{t.description}</p>
                                    <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-50">
                                        <div className="text-[10px] text-gray-400 flex items-center gap-1">
                                            <span className="material-icons text-[12px]">person</span>
                                            {t.creatorName}
                                        </div>
                                        {user.role === 'it_specialist' && (
                                            <button
                                                onClick={() => handleStatusChange(t.id, 'in_progress')}
                                                className="bg-blue-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-blue-700 shadow-sm"
                                            >
                                                بدء العمل
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {openTickets.length === 0 && <p className="text-center text-gray-400 text-xs py-10 italic">لا توجد تذاكر جديدة بانتظار العمل</p>}
                        </div>
                    </div>

                    {/* In Progress Column */}
                    <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100">
                        <h3 className="font-bold text-blue-800 mb-4 flex items-center gap-2 border-b border-blue-100 pb-2">
                            <span className="w-3 h-3 rounded-full bg-blue-500 animate-pulse"></span>
                            قيد التنفيذ ({inProgressTickets.length})
                        </h3>
                        <div className="space-y-3">
                            {inProgressTickets.map(t => (
                                <div key={t.id} className="bg-white p-4 rounded-lg shadow-sm border border-blue-100 hover:border-blue-300 transition-all">
                                    <div className="flex justify-between items-start mb-2">
                                        <span className="font-bold text-gray-800">{t.title}</span>
                                        <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-bold">In Progress</span>
                                    </div>
                                    <div className="text-xs text-gray-500 mb-3 flex items-center gap-1">
                                        <span className="material-icons text-[12px] text-blue-400">inventory_2</span>
                                        {t.assetName || 'بدون أصل مرتبط'}
                                    </div>
                                    <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-50">
                                        <div className="text-[10px] text-gray-400">{new Date(t.createdAt).toLocaleDateString()}</div>
                                        {user.role === 'it_specialist' && (
                                            <button
                                                onClick={() => handleStatusChange(t.id, 'solved')}
                                                className="bg-green-600 text-white px-4 py-1.5 rounded text-xs font-bold hover:bg-green-700 flex items-center gap-1 shadow-sm"
                                            >
                                                <span className="material-icons text-sm">check_circle</span>
                                                إغلاق التذكرة
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {inProgressTickets.length === 0 && <p className="text-center text-blue-300 text-xs py-10 italic">لا توجد مهام جارية حالياً</p>}
                        </div>
                    </div>
                </div>

                {/* List View / History Log */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mt-8">
                    <div className="p-4 bg-gray-50 border-b flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <span className="material-icons text-gray-500">list_alt</span>
                            <span className="font-bold text-gray-700">سجل التذاكر التفصيلي</span>
                        </div>
                        {isSuperAdmin && selectedTickets.length > 0 && (
                            <div className="flex gap-2 animate-fade-in">
                                <button onClick={handleBulkOpen} className="bg-blue-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-blue-700 flex items-center gap-1">
                                    <span className="material-icons text-sm">refresh</span> إعادة فتح ({selectedTickets.length})
                                </button>
                                <button onClick={handleBulkDelete} className="bg-red-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-red-700 flex items-center gap-1">
                                    <span className="material-icons text-sm">delete</span> حذف نهائي ({selectedTickets.length})
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-right text-sm">
                            <thead className="bg-gray-50 text-gray-500 font-bold uppercase border-b">
                                <tr>
                                    {isSuperAdmin && (
                                        <th className="p-3 w-10">
                                            <input
                                                type="checkbox"
                                                className="rounded border-gray-300 text-primary focus:ring-primary"
                                                checked={selectedTickets.length === tickets.length && tickets.length > 0}
                                                onChange={e => setSelectedTickets(e.target.checked ? tickets.map(t => t.id) : [])}
                                            />
                                        </th>
                                    )}
                                    <th className="p-4">العنوان</th>
                                    <th className="p-4">المشروع</th>
                                    <th className="p-4 text-center">الحالة</th>
                                    <th className="p-4 text-center">الأولوية</th>
                                    <th className="p-4">التكلفة</th>
                                    <th className="p-4">التاريخ</th>
                                    <th className="p-4">الإجراء</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {tickets.map(t => (
                                    <tr key={t.id} className={`hover:bg-blue-50/30 transition-colors ${selectedTickets.includes(t.id) ? 'bg-blue-50/50' : ''}`}>
                                        {isSuperAdmin && (
                                            <td className="p-3 text-center">
                                                <input
                                                    type="checkbox"
                                                    className="rounded border-gray-300 text-primary focus:ring-primary"
                                                    checked={selectedTickets.includes(t.id)}
                                                    onChange={() => toggleTicketSelection(t.id)}
                                                />
                                            </td>
                                        )}
                                        <td className="p-4 font-bold text-gray-800">{t.title}</td>
                                        <td className="p-4 text-gray-600">{t.projectName}</td>
                                        <td className="p-4 text-center">
                                            <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${getStatusColor(t.status)}`}>
                                                {getStatusLabel(t.status)}
                                            </span>
                                        </td>
                                        <td className="p-4 text-center">
                                            <span className="text-[10px] font-bold text-gray-500 uppercase">{t.priority}</span>
                                        </td>
                                        <td className="p-4 font-mono font-bold text-red-600">
                                            {t.cost !== null && t.cost !== undefined ? `$${t.cost}` : '-'}
                                        </td>
                                        <td className="p-4 font-mono text-xs text-gray-400">
                                            {new Date(t.createdAt).toLocaleDateString()}
                                        </td>
                                        <td className="p-4">
                                            {isSuperAdmin ? (
                                                <button
                                                    onClick={() => setEditModal({ isOpen: true, ticket: t })}
                                                    className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                                                    title="تعديل"
                                                >
                                                    <span className="material-icons text-sm">edit</span>
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => showToast(`التفاصيل: ${t.description}`, 'info')}
                                                    className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg"
                                                >
                                                    <span className="material-icons text-sm">visibility</span>
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {tickets.length === 0 && (
                            <div className="py-20 text-center text-gray-400 italic">
                                لا توجد سجلات تذاكر حالياً
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="max-w-6xl mx-auto">
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
            <ConfirmationModal
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                onConfirm={confirmModal.onConfirm}
                onCancel={closeConfirmModal}
                isDangerous={confirmModal.isDangerous}
            />

            {(user.role === 'supervisor' || user.role === 'project_manager') && renderCreatorView()}
            {(user.role === 'it_specialist' || isSuperAdmin) && renderSupportDashboard()}

            {/* Create Ticket Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-fade-in-up">
                        <div className="flex justify-between items-center mb-6 border-b pb-2">
                            <h3 className="font-bold text-lg text-gray-800">إنشاء تذكرة جديدة</h3>
                            <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-red-500"><span className="material-icons">close</span></button>
                        </div>
                        <form onSubmit={handleCreateTicket} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">عنوان المشكلة</label>
                                <input
                                    className="w-full p-3 bg-gray-50 border rounded-lg outline-none focus:ring-2 focus:ring-primary"
                                    value={newTicket.title}
                                    onChange={e => setNewTicket({ ...newTicket, title: e.target.value })}
                                    required
                                    placeholder="مثال: تعطل الطابعة الرئيسية"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">الفئة</label>
                                    <select
                                        className="w-full p-3 bg-gray-50 border rounded-lg"
                                        value={newTicket.category}
                                        onChange={e => setNewTicket({ ...newTicket, category: e.target.value as any })}
                                    >
                                        <option value="hardware">أجهزة (Hardware)</option>
                                        <option value="software">برمجيات (Software)</option>
                                        <option value="tools">أدوات ومستلزمات (Tools)</option>
                                        <option value="network">شبكة (Network)</option>
                                        <option value="facility">مرافق (Facility)</option>
                                        <option value="other">أخرى</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">الأولوية</label>
                                    <select
                                        className="w-full p-3 bg-gray-50 border rounded-lg"
                                        value={newTicket.priority}
                                        onChange={e => setNewTicket({ ...newTicket, priority: e.target.value as any })}
                                    >
                                        <option value="low">منخفضة</option>
                                        <option value="medium">متوسطة</option>
                                        <option value="high">عالية</option>
                                        <option value="critical">حرجة</option>
                                    </select>
                                </div>
                            </div>

                            {user.role === 'project_manager' && (
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">المشروع المرتبط <span className="text-red-500">*</span></label>
                                    <select
                                        className="w-full p-3 bg-gray-50 border rounded-lg"
                                        value={newTicket.projectId}
                                        onChange={async (e) => {
                                            const pid = e.target.value;
                                            setNewTicket({ ...newTicket, projectId: pid, assetId: '' });
                                            if (pid) {
                                                const fetchedAssets = await StorageService.getAssets(pid);
                                                setAssets(fetchedAssets);
                                            } else {
                                                setAssets([]);
                                            }
                                        }}
                                        required
                                    >
                                        <option value="">-- اختر المشروع --</option>
                                        {pmProjects.map(p => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">الأصل المرتبط (اختياري)</label>
                                <select
                                    className="w-full p-3 bg-gray-50 border rounded-lg"
                                    value={newTicket.assetId}
                                    onChange={e => setNewTicket({ ...newTicket, assetId: e.target.value })}
                                >
                                    <option value="">-- اختر --</option>
                                    {assets.map(a => (
                                        <option key={a.id} value={a.id}>{a.name} ({a.serialNumber})</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">التفاصيل</label>
                                <textarea
                                    className="w-full p-3 bg-gray-50 border rounded-lg h-24"
                                    value={newTicket.description}
                                    onChange={e => setNewTicket({ ...newTicket, description: e.target.value })}
                                    required
                                    placeholder="وصف دقيق للمشكلة..."
                                ></textarea>
                            </div>

                            <button
                                type="submit"
                                className="w-full bg-primary text-white py-3 rounded-lg font-bold hover:bg-primary-dark transition-colors"
                            >
                                إرسال التذكرة
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Solve Ticket Modal for IT */}
            {solveModal.isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 animate-fade-in-up">
                        <div className="flex justify-between items-center mb-6 border-b pb-2">
                            <h3 className="font-bold text-lg text-gray-800">تأكيد حل المشكلة</h3>
                            <button onClick={() => setSolveModal({ isOpen: false, ticketId: '', cost: '' })} className="text-gray-400 hover:text-red-500"><span className="material-icons">close</span></button>
                        </div>
                        <form onSubmit={handleSolveSubmit} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">التكلفة الإجمالية للحفظ (داخلي وغير مرئي للمستخدم)</label>
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-400 font-bold">$</span>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        className="w-full p-3 bg-gray-50 border rounded-lg outline-none focus:ring-2 focus:ring-primary font-mono text-left"
                                        value={solveModal.cost}
                                        onChange={e => setSolveModal({ ...solveModal, cost: e.target.value })}
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>
                            <button
                                type="submit"
                                className="w-full bg-green-600 text-white py-3 rounded-lg font-bold hover:bg-green-700 transition-colors flex justify-center items-center gap-2"
                            >
                                <span className="material-icons">check_circle</span> تأكيد وإرسال
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Admin Edit Modal */}
            {editModal.isOpen && editModal.ticket && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-fade-in-up">
                        <div className="flex justify-between items-center mb-6 border-b pb-2">
                            <h3 className="font-bold text-lg text-gray-800">تعديل التذكرة للمشرفين</h3>
                            <button onClick={() => setEditModal({ isOpen: false, ticket: null })} className="text-gray-400 hover:text-red-500"><span className="material-icons">close</span></button>
                        </div>
                        <form onSubmit={handleEditSubmit} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">عنوان المشكلة</label>
                                <input
                                    className="w-full p-3 bg-gray-50 border rounded-lg outline-none focus:ring-2 focus:ring-primary"
                                    value={editModal.ticket.title}
                                    onChange={e => setEditModal({ ...editModal, ticket: { ...editModal.ticket!, title: e.target.value } })}
                                    required
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">الفئة</label>
                                    <select
                                        className="w-full p-3 bg-gray-50 border rounded-lg"
                                        value={editModal.ticket.category}
                                        onChange={e => setEditModal({ ...editModal, ticket: { ...editModal.ticket!, category: e.target.value as any } })}
                                    >
                                        <option value="hardware">أجهزة (Hardware)</option>
                                        <option value="software">برمجيات (Software)</option>
                                        <option value="tools">أدوات ومستلزمات (Tools)</option>
                                        <option value="network">شبكة (Network)</option>
                                        <option value="facility">مرافق (Facility)</option>
                                        <option value="other">أخرى</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">الأولوية</label>
                                    <select
                                        className="w-full p-3 bg-gray-50 border rounded-lg"
                                        value={editModal.ticket.priority}
                                        onChange={e => setEditModal({ ...editModal, ticket: { ...editModal.ticket!, priority: e.target.value as any } })}
                                    >
                                        <option value="low">منخفضة</option>
                                        <option value="medium">متوسطة</option>
                                        <option value="high">عالية</option>
                                        <option value="critical">حرجة</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">التكلفة ($)</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    className="w-full p-3 bg-gray-50 border rounded-lg outline-none"
                                    value={editModal.ticket.cost ?? ''}
                                    onChange={e => setEditModal({ ...editModal, ticket: { ...editModal.ticket!, cost: e.target.value ? Number(e.target.value) : undefined } })}
                                />
                            </div>
                            <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 transition-colors">
                                حفظ التعديلات
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TicketSystem;
