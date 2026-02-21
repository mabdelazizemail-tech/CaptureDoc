
import React, { useState, useEffect, useCallback } from 'react';
import { User, Operator, KPILog, UnlockRequest, Asset, Ticket } from '../types';
import { StorageService } from '../services/storage';
import { supabase } from '../services/supabaseClient';
import KPISlider from '../components/KPISlider';
import Toast from '../components/Toast';

const SupervisorDashboard: React.FC<{ user: User, activeTab: string }> = ({ user, activeTab }) => {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [logs, setLogs] = useState<KPILog[]>([]);
  const [monthlyLogs, setMonthlyLogs] = useState<KPILog[]>([]);
  const [requests, setRequests] = useState<UnlockRequest[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  
  // Calendar State
  const [currentDate, setCurrentDate] = useState(new Date());

  // Evaluation Data
  const [kpiData, setKpiData] = useState({
    attitude: 5,
    performance: 5,
    quality: 5,
    appearance: 5
  });
  
  // Team Data
  const [teamVolume, setTeamVolume] = useState<number | ''>('');
  const [volumeStatus, setVolumeStatus] = useState<'saved' | 'saving' | 'error' | ''>('');

  const [saveMessage, setSaveMessage] = useState('');
  
  // Global Notification State (Toast)
  const [toast, setToast] = useState<{message: string, type: 'success' | 'error' | 'info'} | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info') => {
      setToast({ message, type });
  };

  // Request Modal State (Unlock)
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestReason, setRequestReason] = useState('');
  const [requestStatus, setRequestStatus] = useState<'' | 'sending' | 'sent' | 'error'>('');

  // Ticket Modal State
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [ticketForm, setTicketForm] = useState({
      title: '',
      category: 'hardware' as Ticket['category'],
      assetId: '',
      description: '',
      priority: 'medium' as Ticket['priority']
  });
  const [ticketStatus, setTicketStatus] = useState<'' | 'sending' | 'success'>('');

  const [effectiveProjectId, setEffectiveProjectId] = useState<string | undefined>(
    user.projectId || localStorage.getItem('current_project_id') || undefined
  );

  // 1. Define Data Fetching Logic (Reusable)
  const fetchData = useCallback(async () => {
      let pid = user.projectId || localStorage.getItem('current_project_id');
      
      if (!pid) {
          try {
              const { data } = await supabase.from('users').select('project_id').eq('id', user.id).maybeSingle();
              if (data && data.project_id) {
                  pid = data.project_id;
                  setEffectiveProjectId(pid);
                  localStorage.setItem('current_project_id', pid);
              }
          } catch (e) { console.error("Error resolving project ID:", e); }
      } else { setEffectiveProjectId(pid); }

      const ops = await StorageService.getOperatorsBySupervisor(user.id);
      const dateStr = new Date().toISOString().split('T')[0];
      const dailyLogs = await StorageService.getLogsByDateAndSupervisor(user.id, dateStr);
      
      // Fetch Team Volume
      const stats = await StorageService.getTeamStats(user.id, dateStr);
      if (stats) setTeamVolume(stats.volume);

      if (pid) {
        const myRequests = await StorageService.getUnlockRequests(pid, user.id);
        setRequests(myRequests.filter(r => r.date === dateStr));
        const myAssets = await StorageService.getAssets(pid);
        setAssets(myAssets);
      }

      setOperators(ops);
      setLogs(dailyLogs);
      setLoading(false);
  }, [user.id, user.projectId]);

  // 2. Initial Fetch
  useEffect(() => { setLoading(true); fetchData(); }, [fetchData]);

  // 3. Realtime Listener
  useEffect(() => {
    const channelNameLogs = `sup-logs-${user.id}-${Date.now()}`;
    const channelNameReqs = `sup-reqs-${user.id}-${Date.now()}`;

    const logChannel = supabase.channel(channelNameLogs).on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'kpi_logs', filter: `supervisor_id=eq.${user.id}` },
        () => { fetchData(); }
    ).subscribe();

    const requestChannel = supabase.channel(channelNameReqs).on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'unlock_requests', filter: `supervisor_id=eq.${user.id}` },
        (payload) => {
          if (payload.new.status === 'approved') {
            showToast(`✅ تمت الموافقة على الطلب: ${payload.new.operator_name}`, 'success');
            fetchData();
          } else if (payload.new.status === 'rejected') {
            showToast(`❌ تم رفض الطلب: ${payload.new.operator_name}`, 'error');
            fetchData();
          }
        }
      ).subscribe();
      
    return () => { 
        supabase.removeChannel(requestChannel);
        supabase.removeChannel(logChannel);
    };
  }, [user.id, fetchData]);

  // Fetch Monthly Data
  useEffect(() => {
    const fetchMonthlyData = async () => {
      if (activeTab === 'dashboard') {
         const mLogs = await StorageService.getLogsByMonth(currentDate.getMonth(), currentDate.getFullYear(), user.id);
         setMonthlyLogs(mLogs);
      }
    };
    fetchMonthlyData();
  }, [currentDate, user.id, activeTab, logs]); 

  const toggleOperator = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
    setSelectedIds(newSet);
    setSaveMessage(''); setRequestStatus(''); setShowRequestModal(false);

    if (newSet.size === 1) {
      const opId = Array.from(newSet)[0];
      const existingLog = logs.find(l => l.operatorId === opId);
      if (existingLog) {
         setKpiData({ 
           attitude: existingLog.attitude, 
           performance: existingLog.performance, 
           quality: existingLog.quality, 
           appearance: existingLog.appearance
         });
      } else { setKpiData({ attitude: 5, performance: 5, quality: 5, appearance: 5 }); }
    } else if (newSet.size > 1 && selectedIds.size === 1) {
      setKpiData({ attitude: 5, performance: 5, quality: 5, appearance: 5 });
    }
    
    if (newSet.size > 0 && window.innerWidth < 1024) { setTimeout(() => { document.getElementById('kpi-form')?.scrollIntoView({ behavior: 'smooth' }); }, 100); }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === operators.length) { setSelectedIds(new Set()); } 
    else { setSelectedIds(new Set(operators.map(o => o.id))); setKpiData({ attitude: 5, performance: 5, quality: 5, appearance: 5 }); setSaveMessage(''); setRequestStatus(''); setShowRequestModal(false); }
  };

  const handleSaveKPI = async () => {
    if (selectedIds.size === 0) return;
    const operatorsToSave = Array.from(selectedIds).filter(id => !logs.some(l => l.operatorId === id));
    if (operatorsToSave.length === 0) { setSaveMessage('تم تقييم الموظفين المحددين مسبقاً لهذا اليوم.'); return; }
    setSaveMessage('جاري الحفظ...');
    const timestamp = Date.now();
    const dateStr = new Date().toISOString().split('T')[0];
    const newLogs: KPILog[] = [];
    const pidToUse = effectiveProjectId || user.projectId || '';

    operatorsToSave.forEach(opId => {
      newLogs.push({ id: `${opId}-${dateStr}`, operatorId: opId, supervisorId: user.id, projectId: pidToUse, date: dateStr, timestamp: timestamp, ...kpiData });
    });

    const result = await StorageService.saveLogs(newLogs);
    if (result.success) {
        setLogs(prev => [...prev, ...newLogs.map(l => ({...l, status: 'pending' as 'pending'}))]); 
        setSaveMessage('تم الحفظ بنجاح (قيد المراجعة)!');
        if (selectedIds.size > 1) setTimeout(() => setSelectedIds(new Set()), 1500);
        setTimeout(() => setSaveMessage(''), 3000);
    } else { setSaveMessage(`فشل الحفظ: ${result.error}`); }
  };

  const handleSaveVolume = async () => {
     if (teamVolume === '' || !effectiveProjectId) return;
     setVolumeStatus('saving');
     const dateStr = new Date().toISOString().split('T')[0];
     const result = await StorageService.saveTeamStats({
        supervisorId: user.id,
        projectId: effectiveProjectId,
        date: dateStr,
        volume: Number(teamVolume)
     });

     if (result.success) {
        setVolumeStatus('saved');
        setTimeout(() => setVolumeStatus(''), 2000);
     } else {
        showToast('Error saving volume: ' + result.error, 'error');
        setVolumeStatus('error');
     }
  };

  const submitUnlockRequest = async () => {
    if (selectedIds.size !== 1) return;
    if (!requestReason.trim() || !effectiveProjectId) return;
    const opId = Array.from(selectedIds)[0];
    const op = operators.find(o => o.id === opId);
    const existingLog = logs.find(l => l.operatorId === opId);
    if (!op) return;
    setRequestStatus('sending');
    try {
        const { success, error } = await StorageService.createUnlockRequest(op.id, op.name, user.id, user.name, effectiveProjectId, requestReason, existingLog?.id);
        if (success) { 
            setRequestStatus('sent'); 
            setSaveMessage('تم إرسال الطلب بنجاح.'); 
            fetchData(); 
            setShowRequestModal(false); 
            setRequestReason(''); 
            showToast('تم إرسال طلب التعديل', 'success');
        } 
        else { 
            setRequestStatus('error'); 
            showToast(`فشل: ${error}`, 'error'); 
        }
    } catch (err: any) { 
        setRequestStatus('error'); 
        showToast(`Error: ${err.message}`, 'error'); 
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveProjectId) return;
    setTicketStatus('sending');
    const result = await StorageService.createTicket({
        ...ticketForm,
        createdBy: user.id,
        projectId: effectiveProjectId
    });
    if (result.success) {
        setTicketStatus('success');
        showToast('تم إرسال التذكرة لمدير المشروع', 'success');
        setTimeout(() => {
            setShowTicketModal(false);
            setTicketForm({ title: '', category: 'hardware', assetId: '', description: '', priority: 'medium' });
            setTicketStatus('');
        }, 1500);
    } else {
        showToast(`Error: ${result.error}`, 'error');
        setTicketStatus('');
    }
  };

  const changeMonth = (offset: number) => { setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1)); };

  const renderCalendar = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay(); 
    const monthNames = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
    
    const calendarDays = [];
    for (let i = 0; i < startingDay; i++) calendarDays.push(<div key={`empty-${i}`} className="h-24 bg-gray-50/50 border border-gray-100/50"></div>);

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dayLogs = monthlyLogs.filter(l => l.date === dateStr);
        const count = dayLogs.length;
        const total = operators.length;
        const isToday = new Date().toISOString().split('T')[0] === dateStr;
        const dayAvg = count > 0 ? (dayLogs.reduce((acc, l) => acc + (l.attitude + l.performance + l.quality + l.appearance) / 4, 0) / count).toFixed(1) : '-';

        calendarDays.push(
            <div key={d} className={`h-24 border border-gray-100 p-2 flex flex-col justify-between transition-colors ${isToday ? 'bg-blue-50 ring-1 ring-blue-200' : 'bg-white'}`}>
                <div className="flex justify-between">
                    <span className={`text-sm font-bold ${isToday ? 'text-blue-600' : 'text-gray-700'}`}>{d}</span>
                    {count > 0 && <span className="text-xs font-bold text-gray-400">{dayAvg} ★</span>}
                </div>
                {count > 0 ? (
                   <div className={`text-xs rounded px-1.5 py-1 flex items-center justify-between ${count >= total ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                       <span className="font-bold">{count}/{total}</span>
                       <span className="material-icons text-sm">{count >= total ? 'check_circle' : 'hourglass_bottom'}</span>
                   </div>
                ) : <div className="h-6"></div>}
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 bg-gray-50 border-b flex justify-between items-center">
                <h3 className="font-bold text-gray-800 flex items-center gap-2"><span className="material-icons text-primary">calendar_month</span> سجل التقييمات</h3>
                <div className="flex gap-2 text-sm font-bold text-gray-600">
                    <button onClick={() => changeMonth(-1)} className="hover:text-primary">ᐸ</button>
                    <span>{monthNames[month]} {year}</span>
                    <button onClick={() => changeMonth(1)} className="hover:text-primary">ᐳ</button>
                </div>
            </div>
            <div className="grid grid-cols-7 text-center bg-gray-100 text-xs font-bold text-gray-500 py-2 border-b">
                <div>الأحد</div><div>الاثنين</div><div>الثلاثاء</div><div>الأربعاء</div><div>الخميس</div><div>الجمعة</div><div>السبت</div>
            </div>
            <div className="grid grid-cols-7 bg-gray-50">{calendarDays}</div>
        </div>
    );
  };

  if (loading) return <div className="flex h-96 items-center justify-center text-primary"><span className="material-icons animate-spin text-4xl">donut_large</span></div>;

  const pendingCount = operators.length - logs.length;

  return (
    <div className="space-y-6 animate-fade-in-up">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      
      {/* Pending Evaluations Banner */}
      {pendingCount > 0 && operators.length > 0 && (
        <div className="bg-amber-50 border-r-4 border-amber-500 p-4 rounded-lg shadow-sm flex items-center gap-4 animate-pulse">
            <div className="bg-amber-100 p-2 rounded-full text-amber-600">
                <span className="material-icons">priority_high</span>
            </div>
            <div>
                <h3 className="font-bold text-amber-800 text-lg">تنبيه: التقييم غير مكتمل</h3>
                <p className="text-amber-700 text-sm">
                    يوجد <span className="font-bold text-amber-900">{pendingCount}</span> موظف لم يتم تقييمهم اليوم. يرجى استكمال التقييم.
                </p>
            </div>
            <button 
                onClick={() => setShowTicketModal(true)}
                className="mr-auto bg-white/50 border border-amber-200 text-amber-800 px-4 py-1 rounded-lg text-sm font-bold hover:bg-white"
            >
                طلب دعم فني
            </button>
        </div>
      )}

      {activeTab === 'kpi' ? (
        <div className="relative animate-fade-in-up">
            {/* Team Volume Input Card */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                            <span className="material-icons text-blue-600">inventory_2</span>
                            إنتاجية الفريق اليومية (Team Volume)
                        </h3>
                        <p className="text-gray-400 text-sm">أدخل إجمالي حجم العمل المنجز للفريق اليوم.</p>
                    </div>
                    <div className="flex items-center gap-2 w-full md:w-auto">
                        <input 
                            type="number" 
                            min="0"
                            placeholder="0"
                            className="flex-1 md:w-48 p-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary outline-none font-bold text-center text-lg"
                            value={teamVolume}
                            onChange={(e) => setTeamVolume(Number(e.target.value))}
                        />
                        <button 
                            onClick={handleSaveVolume}
                            disabled={volumeStatus === 'saving'}
                            className={`px-6 py-3 rounded-lg font-bold text-white transition-all ${volumeStatus === 'saved' ? 'bg-green-500 hover:bg-green-600' : 'bg-primary hover:bg-primary-dark'}`}
                        >
                            {volumeStatus === 'saving' ? <span className="material-icons animate-spin">sync</span> : volumeStatus === 'saved' ? <span className="material-icons">check</span> : 'حفظ'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-auto lg:h-[calc(100vh-200px)]">
                {/* Operator Selection */}
                <div className="lg:col-span-4 bg-white rounded-xl shadow-sm flex flex-col overflow-hidden border border-gray-100 h-96 lg:h-auto">
                    <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <h2 className="font-bold text-gray-700">قائمة الفريق</h2>
                            {pendingCount > 0 && <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">متبقي: {pendingCount}</span>}
                            <button onClick={fetchData} className="p-1 rounded hover:bg-gray-100 text-gray-400"><span className="material-icons text-sm">refresh</span></button>
                        </div>
                        <button onClick={toggleSelectAll} className="text-xs font-bold text-primary hover:bg-blue-50 px-2 py-1 rounded">
                        {selectedIds.size === operators.length ? 'إلغاء الكل' : 'تحديد الكل'}
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {operators.map(op => {
                            const log = logs.find(l => l.operatorId === op.id);
                            const isDone = !!log;
                            const isSelected = selectedIds.has(op.id);
                            let statusIcon = <span className="material-icons text-green-500 text-sm">check_circle</span>;
                            if (isDone) {
                                if (log.status === 'pending') statusIcon = <span className="material-icons text-yellow-500 text-sm">hourglass_empty</span>;
                                else if (log.status === 'rejected') statusIcon = <span className="material-icons text-red-500 text-sm">cancel</span>;
                            }
                            return (
                                <button key={op.id} onClick={() => toggleOperator(op.id)} className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all ${isSelected ? 'bg-blue-50 border-primary shadow-sm' : 'border-transparent hover:bg-gray-50'}`}>
                                    <div className="flex items-center gap-3 w-full">
                                        <div className={`w-5 h-5 rounded border flex items-center justify-center ${isSelected ? 'bg-primary border-primary' : 'border-gray-300 bg-white'}`}>
                                            {isSelected && <span className="material-icons text-white text-sm">check</span>}
                                        </div>
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${isSelected ? 'bg-primary text-white' : 'bg-gray-200 text-gray-600'}`}>
                                            {op.name.charAt(0)}
                                        </div>
                                        <div className="text-right flex-1"><p className={`text-sm font-bold ${isSelected ? 'text-primary' : 'text-gray-800'}`}>{op.name}</p></div>
                                    </div>
                                    {isDone && statusIcon}
                                </button>
                            )
                        })}
                    </div>
                </div>

                {/* Input Form */}
                <div id="kpi-form" className="lg:col-span-8 bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col relative overflow-hidden min-h-[400px]">
                    {selectedIds.size > 0 ? (
                        <>
                            <div className="flex justify-between items-center mb-6 border-b pb-4">
                                <div>
                                    <h2 className="text-xl font-bold text-gray-800">{selectedIds.size === 1 ? operators.find(o => o.id === Array.from(selectedIds)[0])?.name : `تقييم جماعي (${selectedIds.size})`}</h2>
                                    <p className="text-gray-400 text-xs mt-1">{new Date().toLocaleDateString('ar-EG', {weekday: 'long', day: 'numeric', month: 'long'})}</p>
                                </div>
                                {saveMessage && <span className={`font-bold px-3 py-1 rounded text-sm ${saveMessage.includes('فشل') || saveMessage.includes('رفض') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>{saveMessage}</span>}
                            </div>

                            {(() => {
                                let isLocked = false;
                                let pendingRequest = null;
                                if (selectedIds.size === 1) {
                                    const opId = Array.from(selectedIds)[0];
                                    const log = logs.find(l => l.operatorId === opId);
                                    if (log) {
                                        isLocked = true;
                                        pendingRequest = requests.find(r => r.operatorId === opId && r.status === 'pending');
                                    }
                                } else if (selectedIds.size > 1) {
                                    const alreadyDoneCount = Array.from(selectedIds).filter(id => logs.some(l => l.operatorId === id)).length;
                                    if (alreadyDoneCount > 0 && alreadyDoneCount === selectedIds.size) isLocked = true;
                                }

                                if (isLocked) {
                                    return (
                                        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                                            {selectedIds.size === 1 && logs.find(l => l.operatorId === Array.from(selectedIds)[0])?.status === 'pending' ? (
                                                <>
                                                    <div className="bg-yellow-100 p-4 rounded-full mb-4"><span className="material-icons text-4xl text-yellow-600">hourglass_top</span></div>
                                                    <h3 className="text-xl font-bold text-gray-800 mb-2">بانتظار الموافقة</h3>
                                                    <p className="text-gray-500 mb-6 text-sm">تم إرسال التقييم للمراجعة من قبل المدير.</p>
                                                </>
                                            ) : selectedIds.size === 1 && logs.find(l => l.operatorId === Array.from(selectedIds)[0])?.status === 'rejected' ? (
                                                <>
                                                    <div className="bg-red-100 p-4 rounded-full mb-4"><span className="material-icons text-4xl text-red-600">error</span></div>
                                                    <h3 className="text-xl font-bold text-gray-800 mb-2">تم رفض التقييم</h3>
                                                    <p className="text-gray-500 mb-6 text-sm">يرجى تقديم طلب تعديل لإعادة التقييم.</p>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="bg-green-100 p-4 rounded-full mb-4"><span className="material-icons text-4xl text-green-600">verified</span></div>
                                                    <h3 className="text-xl font-bold text-gray-800 mb-2">تم اعتماد التقييم</h3>
                                                    <p className="text-gray-500 mb-6 text-sm">لا يمكن التعديل إلا بموافقة المدير.</p>
                                                </>
                                            )}

                                            {selectedIds.size === 1 && (
                                                pendingRequest ? (
                                                    <div className="bg-yellow-50 text-yellow-700 px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-bold"><span className="material-icons">hourglass_empty</span> الطلب قيد المراجعة...</div>
                                                ) : (
                                                    <button onClick={() => setShowRequestModal(true)} className="bg-white border border-gray-300 text-gray-700 px-6 py-2 rounded-lg font-bold hover:bg-gray-100 flex items-center gap-2">
                                                        <span className="material-icons">lock_open</span> طلب تعديل
                                                    </button>
                                                )
                                            )}
                                        </div>
                                    );
                                } else {
                                    return (
                                        <>
                                            <div className="space-y-4 mb-8 flex-1 overflow-y-auto">
                                                <KPISlider label="السلوك (Attitude)" icon="sentiment_satisfied_alt" value={kpiData.attitude} onChange={v => setKpiData({...kpiData, attitude: v})} colorClass="text-blue-600" />
                                                <KPISlider label="الأداء (Performance)" icon="speed" value={kpiData.performance} onChange={v => setKpiData({...kpiData, performance: v})} colorClass="text-indigo-600" />
                                                <KPISlider label="الجودة (Quality)" icon="verified" value={kpiData.quality} onChange={v => setKpiData({...kpiData, quality: v})} colorClass="text-purple-600" />
                                                <KPISlider label="المظهر (Appearance)" icon="accessibility_new" value={kpiData.appearance} onChange={v => setKpiData({...kpiData, appearance: v})} colorClass="text-pink-600" />
                                            </div>
                                            <button onClick={handleSaveKPI} className="w-full bg-primary text-white py-4 rounded-lg font-bold text-lg hover:bg-primary-dark shadow-lg shadow-blue-500/20">
                                                {selectedIds.size > 1 ? 'حفظ التقييم الجماعي' : 'إرسال للمراجعة'}
                                            </button>
                                        </>
                                    );
                                }
                            })()}
                        </>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-gray-300">
                            <span className="material-icons text-8xl mb-4">checklist_rtl</span>
                            <p className="text-xl">اختر موظفاً للبدء</p>
                            <button 
                                onClick={() => setShowTicketModal(true)}
                                className="mt-8 text-primary font-bold hover:underline flex items-center gap-1"
                            >
                                <span className="material-icons text-sm">support_agent</span> تواجه مشكلة؟ افتح تذكرة دعم
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
      ) : (
        <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between">
                    <div><p className="text-gray-400 text-xs font-bold uppercase mb-1">أعضاء الفريق</p><h3 className="text-4xl font-bold text-gray-800">{operators.length}</h3></div>
                    <div className="h-12 w-12 rounded-full bg-blue-50 flex items-center justify-center text-blue-600"><span className="material-icons">groups</span></div>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between relative overflow-hidden">
                    <div className="z-10"><p className="text-gray-400 text-xs font-bold uppercase mb-1">إنجاز اليوم</p><h3 className="text-4xl font-bold text-gray-800">{logs.length} <span className="text-xl text-gray-400">/ {operators.length}</span></h3></div>
                    <div className="relative h-16 w-16">
                        <svg className="h-full w-full transform -rotate-90" viewBox="0 0 36 36">
                            <path className="text-gray-100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="4" />
                            <path className={`${logs.length === operators.length && operators.length > 0 ? 'text-green-500' : 'text-primary'}`} strokeDasharray={`${operators.length > 0 ? (logs.length / operators.length) * 100 : 0}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="4" />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-gray-600">{operators.length > 0 ? Math.round((logs.length / operators.length) * 100) : 0}%</div>
                    </div>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between group cursor-pointer hover:border-primary transition-colors" onClick={() => setShowTicketModal(true)}>
                    <div><p className="text-gray-400 text-xs font-bold uppercase mb-1">الدعم الفني</p><h3 className="text-lg font-bold text-primary group-hover:scale-105 transition-transform">فتح بلاغ جديد</h3></div>
                    <div className="h-12 w-12 rounded-full bg-orange-50 flex items-center justify-center text-orange-600 group-hover:bg-orange-600 group-hover:text-white transition-colors"><span className="material-icons">confirmation_number</span></div>
                </div>
            </div>

            {renderCalendar()}
            
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-5 border-b border-gray-100 bg-white flex justify-between items-center">
                    <h2 className="text-lg font-bold text-gray-800">حالة الفريق اليومية</h2>
                    <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded text-gray-500">{new Date().toISOString().split('T')[0]}</span>
                    <button onClick={fetchData} className="p-2 rounded-full hover:bg-gray-100 text-gray-400" title="تحديث البيانات"><span className="material-icons">refresh</span></button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-right">
                        <thead className="bg-gray-50 text-gray-500 text-xs font-bold uppercase"><tr><th className="p-4">الاسم</th><th className="p-4">الهاتف</th><th className="p-4">النتيجة</th><th className="p-4">الحالة</th></tr></thead>
                        <tbody className="divide-y divide-gray-50">
                            {operators.map(op => {
                                const log = logs.find(l => l.operatorId === op.id);
                                const isDone = !!log;
                                const score = log ? ((log.attitude + log.performance + log.quality + log.appearance) / 4).toFixed(1) : '-';
                                let statusBadge = <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-400 px-2 py-1 rounded text-xs font-bold">معلق</span>;
                                if (isDone) {
                                    if (log.status === 'pending') statusBadge = <span className="inline-flex items-center gap-1 bg-yellow-100 text-yellow-700 px-2 py-1 rounded text-xs font-bold"><span className="material-icons text-sm">hourglass_empty</span> مراجعة</span>;
                                    else if (log.status === 'rejected') statusBadge = <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 px-2 py-1 rounded text-xs font-bold"><span className="material-icons text-sm">cancel</span> مرفوض</span>;
                                    else statusBadge = <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold"><span className="material-icons text-sm">check</span> معتمد</span>;
                                }
                                return (
                                    <tr key={op.id} className="hover:bg-gray-50">
                                        <td className="p-4 font-bold text-gray-800">{op.name}</td>
                                        <td className="p-4 text-gray-500 font-mono text-xs">{op.phone}</td>
                                        <td className="p-4 font-bold text-primary">{score}</td>
                                        <td className="p-4">{statusBadge}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </>
      )}

      {/* Support Ticket Modal */}
      {showTicketModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-fade-in-up">
                  <div className="flex justify-between items-center mb-6 border-b pb-2">
                      <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                          <span className="material-icons text-primary">confirmation_number</span>
                          فتح تذكرة دعم جديدة
                      </h3>
                      <button onClick={() => setShowTicketModal(false)} className="text-gray-400 hover:text-red-500"><span className="material-icons">close</span></button>
                  </div>
                  
                  {ticketStatus === 'success' ? (
                      <div className="text-center py-8">
                          <span className="material-icons text-6xl text-green-500 mb-4 animate-bounce">check_circle</span>
                          <h4 className="text-xl font-bold text-gray-800">تم إرسال الطلب!</h4>
                          <p className="text-gray-500 mt-2">سيتم إخطار مدير المشروع فوراً.</p>
                      </div>
                  ) : (
                      <form onSubmit={handleCreateTicket} className="space-y-4">
                          <div>
                              <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">عنوان البلاغ</label>
                              <input 
                                  required 
                                  className="w-full p-3 bg-gray-50 border rounded-lg focus:ring-2 focus:ring-primary outline-none" 
                                  placeholder="مثال: عطل في الماسح الضوئي" 
                                  value={ticketForm.title}
                                  onChange={e => setTicketForm({...ticketForm, title: e.target.value})}
                              />
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4">
                              <div>
                                  <label className="block text-xs font-bold text-gray-500 mb-1">الفئة</label>
                                  <select 
                                      className="w-full p-3 bg-gray-50 border rounded-lg"
                                      value={ticketForm.category}
                                      onChange={e => setTicketForm({...ticketForm, category: e.target.value as any})}
                                  >
                                      <option value="hardware">أجهزة (Hardware)</option>
                                      <option value="software">برمجيات (Software)</option>
                                      <option value="tools">أدوات ومستلزمات (Tools)</option>
                                      <option value="network">الشبكة (Network)</option>
                                      <option value="other">أخرى</option>
                                  </select>
                              </div>
                              <div>
                                  <label className="block text-xs font-bold text-gray-500 mb-1">الأولوية</label>
                                  <select 
                                      className="w-full p-3 bg-gray-50 border rounded-lg"
                                      value={ticketForm.priority}
                                      onChange={e => setTicketForm({...ticketForm, priority: e.target.value as any})}
                                  >
                                      <option value="low">منخفضة</option>
                                      <option value="medium">متوسطة</option>
                                      <option value="high">عالية</option>
                                      <option value="critical">حرجة جداً</option>
                                  </select>
                              </div>
                          </div>

                          <div>
                              <label className="block text-xs font-bold text-gray-500 mb-1">الأصل المرتبط (اختياري)</label>
                              <select 
                                  className="w-full p-3 bg-gray-50 border rounded-lg"
                                  value={ticketForm.assetId}
                                  onChange={e => setTicketForm({...ticketForm, assetId: e.target.value})}
                              >
                                  <option value="">-- اختر من أصول الموقع --</option>
                                  {assets.map(a => (
                                      <option key={a.id} value={a.id}>{a.name} ({a.assetTag || a.serialNumber})</option>
                                  ))}
                              </select>
                          </div>

                          <div>
                              <label className="block text-xs font-bold text-gray-500 mb-1">التفاصيل</label>
                              <textarea 
                                  required 
                                  className="w-full p-3 bg-gray-50 border rounded-lg h-24" 
                                  placeholder="اشرح المشكلة بالتفصيل هنا..." 
                                  value={ticketForm.description}
                                  onChange={e => setTicketForm({...ticketForm, description: e.target.value})}
                              ></textarea>
                          </div>

                          <button 
                              type="submit" 
                              disabled={ticketStatus === 'sending'}
                              className="w-full bg-primary text-white py-3.5 rounded-xl font-bold hover:bg-primary-dark transition-all shadow-lg flex justify-center items-center gap-2"
                          >
                              {ticketStatus === 'sending' ? <span className="material-icons animate-spin">sync</span> : <span className="material-icons">send</span>}
                              إرسال الطلب لمدير المشروع
                          </button>
                      </form>
                  )}
              </div>
          </div>
      )}

      {/* Unlock Request Modal */}
      {showRequestModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6">
                  <h3 className="font-bold mb-4">سبب التعديل</h3>
                  <textarea className="w-full border rounded-lg p-3 text-sm" rows={3} value={requestReason} onChange={(e) => setRequestReason(e.target.value)} placeholder="اكتب السبب هنا..."></textarea>
                  <button onClick={submitUnlockRequest} disabled={!requestReason.trim()} className="w-full mt-4 bg-primary text-white py-2 rounded-lg font-bold disabled:bg-gray-300">إرسال الطلب</button>
                  <button onClick={() => setShowRequestModal(false)} className="w-full mt-2 text-gray-400 text-sm">إلغاء</button>
              </div>
          </div>
      )}
    </div>
  );
};

export default SupervisorDashboard;
