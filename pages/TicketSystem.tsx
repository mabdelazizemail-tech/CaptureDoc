
import React, { useState, useEffect } from 'react';
import { User, Ticket, Asset } from '../types';
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
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  
  // Feedback States
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDangerous?: boolean;
  }>({
    isOpen: false, title: '', message: '', onConfirm: () => {}, isDangerous: false
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
    assetId: string;
    description: string;
    priority: Ticket['priority'];
  }>({
    title: '',
    category: 'hardware',
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

  const isSuperAdmin = user.role === 'super_admin' || user.role === 'power_admin';

  const loadData = async () => {
    setLoading(true);
    const fetchedTickets = await StorageService.getTickets(user);
    setTickets(fetchedTickets);

    if (user.role === 'supervisor' && user.projectId) {
        const fetchedAssets = await StorageService.getAssets(user.projectId);
        setAssets(fetchedAssets);
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
      if (isSuperAdmin && tickets.length > 0) {
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
  }, [tickets, isSuperAdmin]);

  const handleCreateTicket = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!user.projectId) {
          showToast('Error: You are not assigned to a project.', 'error');
          return;
      }

      const result = await StorageService.createTicket({
          ...newTicket,
          createdBy: user.id,
          projectId: user.projectId
      });

      if (result.success) {
          setShowCreateModal(false);
          setNewTicket({ title: '', category: 'hardware', assetId: '', description: '', priority: 'medium' });
          showToast('تم إنشاء التذكرة بنجاح');
          loadData();
      } else {
          showToast(`Error: ${result.error}`, 'error');
      }
  };

  const handleStatusChange = async (id: string, newStatus: 'in_progress' | 'solved' | 'closed') => {
      const label = newStatus === 'in_progress' ? 'قيد العمل' : newStatus === 'solved' ? 'تم الحل' : 'مغلق';
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

  const getStatusColor = (status: string) => {
      switch(status) {
          case 'open': return 'bg-red-100 text-red-700';
          case 'in_progress': return 'bg-blue-100 text-blue-700';
          case 'solved': return 'bg-green-100 text-green-700';
          case 'closed': return 'bg-gray-100 text-gray-600';
          default: return 'bg-gray-50';
      }
  };

  const getStatusLabel = (status: string) => {
      switch(status) {
          case 'open': return 'مفتوح';
          case 'in_progress': return 'قيد التنفيذ';
          case 'solved': return 'تم الحل';
          case 'closed': return 'مغلق';
          default: return status;
      }
  };

  const renderSupervisorView = () => {
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
                                      <div className="text-xs text-gray-500 mt-1">حل بواسطة PM في {t.solvedAt ? new Date(t.solvedAt).toLocaleDateString() : ''}</div>
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

  const renderPMView = () => {
      const openTickets = tickets.filter(t => t.status === 'open');
      const inProgressTickets = tickets.filter(t => t.status === 'in_progress');

      return (
          <div className="space-y-6 animate-fade-in-up">
              <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold text-gray-800">لوحة حل المشكلات</h2>
                  <div className="text-sm text-gray-500 bg-white px-3 py-1 rounded shadow-sm">
                      مهمتك: حل التذاكر المفتوحة
                  </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Open Column */}
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                      <h3 className="font-bold text-gray-700 mb-4 flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full bg-red-500"></span> 
                          مفتوح ({openTickets.length})
                      </h3>
                      <div className="space-y-3">
                          {openTickets.map(t => (
                              <div key={t.id} className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                                  <div className="flex justify-between items-start mb-2">
                                      <span className="font-bold text-gray-800">{t.title}</span>
                                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${t.priority === 'critical' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{t.priority}</span>
                                  </div>
                                  <p className="text-xs text-gray-600 mb-3 bg-gray-50 p-2 rounded">{t.description}</p>
                                  <div className="flex justify-between items-center mt-2">
                                      <div className="text-[10px] text-gray-400">بواسطة: {t.creatorName}</div>
                                      <button 
                                        onClick={() => handleStatusChange(t.id, 'in_progress')}
                                        className="bg-blue-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-blue-700"
                                      >
                                          بدء العمل
                                      </button>
                                  </div>
                              </div>
                          ))}
                          {openTickets.length === 0 && <p className="text-center text-gray-400 text-xs py-4">لا توجد تذاكر جديدة</p>}
                      </div>
                  </div>

                  {/* In Progress Column */}
                  <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                      <h3 className="font-bold text-blue-800 mb-4 flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full bg-blue-500 animate-pulse"></span> 
                          قيد التنفيذ ({inProgressTickets.length})
                      </h3>
                      <div className="space-y-3">
                          {inProgressTickets.map(t => (
                              <div key={t.id} className="bg-white p-4 rounded-lg shadow-sm border border-blue-100">
                                  <div className="flex justify-between items-start mb-2">
                                      <span className="font-bold text-gray-800">{t.title}</span>
                                      <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-bold">In Progress</span>
                                  </div>
                                  <div className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                                      <span className="material-icons text-[10px]">inventory_2</span> 
                                      {t.assetName || 'General'}
                                  </div>
                                  <div className="flex justify-end mt-4">
                                      <button 
                                        onClick={() => handleStatusChange(t.id, 'solved')}
                                        className="bg-green-600 text-white px-4 py-1.5 rounded text-xs font-bold hover:bg-green-700 flex items-center gap-1"
                                      >
                                          <span className="material-icons text-sm">check</span>
                                          تم الحل
                                      </button>
                                  </div>
                              </div>
                          ))}
                          {inProgressTickets.length === 0 && <p className="text-center text-blue-300 text-xs py-4">لا يوجد مهام قيد العمل</p>}
                      </div>
                  </div>
              </div>
          </div>
      );
  };

  const renderAdminView = () => {
      return (
          <div className="space-y-6 animate-fade-in-up">
              <h2 className="text-xl font-bold text-gray-800 mb-4">نظرة عامة على الدعم الفني</h2>
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
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-4 bg-gray-50 border-b font-bold text-gray-700">سجل التذاكر الشامل</div>
                  <div className="overflow-x-auto">
                      <table className="w-full text-right text-sm">
                          <thead className="bg-gray-50 text-gray-500 font-bold uppercase">
                              <tr>
                                  <th className="p-3">العنوان</th>
                                  <th className="p-3">المشروع</th>
                                  <th className="p-3">الحالة</th>
                                  <th className="p-3">الأولوية</th>
                                  <th className="p-3">تاريخ الإنشاء</th>
                                  <th className="p-3">المسؤول (PM)</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                              {tickets.map(t => (
                                  <tr key={t.id} className="hover:bg-gray-50">
                                      <td className="p-3 font-bold text-gray-800">{t.title}</td>
                                      <td className="p-3 text-gray-600">{t.projectName}</td>
                                      <td className="p-3"><span className={`px-2 py-1 rounded text-xs font-bold ${getStatusColor(t.status)}`}>{getStatusLabel(t.status)}</span></td>
                                      <td className="p-3 uppercase text-xs font-bold">{t.priority}</td>
                                      <td className="p-3 font-mono text-xs text-gray-500">{new Date(t.createdAt).toLocaleDateString()}</td>
                                      <td className="p-3 text-xs text-gray-500">{t.pmId.substring(0, 8)}...</td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
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

        {user.role === 'supervisor' && renderSupervisorView()}
        {user.role === 'project_manager' && renderPMView()}
        {isSuperAdmin && renderAdminView()}

        {/* Create Ticket Modal (Supervisor Only) */}
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
                                onChange={e => setNewTicket({...newTicket, title: e.target.value})}
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
                                    onChange={e => setNewTicket({...newTicket, category: e.target.value as any})}
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
                                    onChange={e => setNewTicket({...newTicket, priority: e.target.value as any})}
                                >
                                    <option value="low">منخفضة</option>
                                    <option value="medium">متوسطة</option>
                                    <option value="high">عالية</option>
                                    <option value="critical">حرجة</option>
                                </select>
                            </div>
                        </div>
                        
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1">الأصل المرتبط (اختياري)</label>
                            <select 
                                className="w-full p-3 bg-gray-50 border rounded-lg"
                                value={newTicket.assetId}
                                onChange={e => setNewTicket({...newTicket, assetId: e.target.value})}
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
                                onChange={e => setNewTicket({...newTicket, description: e.target.value})}
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
    </div>
  );
};

export default TicketSystem;
