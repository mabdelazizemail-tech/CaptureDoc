
import React, { useState, useEffect, useRef } from 'react';
import { User, Operator, KPILog, Project, Role, UnlockRequest, SiteSummary, Asset, MaintenanceRequest, Ticket } from '../services/types';
import { StorageService } from '../services/storage';
import { supabase } from '../services/supabaseClient';
import Toast from '../components/Toast';
import ConfirmationModal from '../components/ConfirmationModal';

// Declare Chart.js type
declare const Chart: any;

interface AdminDashboardProps {
    activeTab: string;
    currentUser: User;
    onNavigate: (tab: string) => void;
    onlineUsers: Set<string>;
}

const ALL_PROJECTS_OPTION: Project = {
    id: 'all',
    name: 'كل المشاريع',
    location: 'نظرة عامة',
    createdAt: new Date().toISOString()
};

const AdminDashboard: React.FC<AdminDashboardProps> = ({ activeTab, currentUser, onNavigate, onlineUsers }) => {
    // Global State
    const [projects, setProjects] = useState<Project[]>([]);
    const [currentProject, setCurrentProject] = useState<Project | null>(null);
    const [loading, setLoading] = useState(false);

    // PM Multi-Site State
    const [siteSummaries, setSiteSummaries] = useState<SiteSummary[]>([]);

    // Project Data State
    const [supervisors, setSupervisors] = useState<User[]>([]);
    const [projectManagers, setProjectManagers] = useState<User[]>([]);
    const [itSpecialists, setItSpecialists] = useState<User[]>([]);
    const [hrAdmins, setHrAdmins] = useState<User[]>([]);
    const [allProjectManagers, setAllProjectManagers] = useState<User[]>([]);
    const [projectUsers, setProjectUsers] = useState<User[]>([]);
    const [operators, setOperators] = useState<Operator[]>([]);
    const [assets, setAssets] = useState<Asset[]>([]);
    const [logs, setLogs] = useState<KPILog[]>([]);
    const [pendingLogs, setPendingLogs] = useState<KPILog[]>([]);
    const [unlockRequests, setUnlockRequests] = useState<UnlockRequest[]>([]);
    const [maintenanceRequests, setMaintenanceRequests] = useState<(MaintenanceRequest & { assetName: string, supervisorName: string })[]>([]);
    const [openTickets, setOpenTickets] = useState<Ticket[]>([]);

    // UI State - Modern Feedback
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

    const confirmAction = (message: string, onConfirm: () => void, isDangerous = false, title = 'تأكيد الإجراء') => {
        setConfirmModal({ isOpen: true, message, title, onConfirm, isDangerous });
    };

    const closeConfirmModal = () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
    };

    // Tombstone Ref to prevent race conditions
    const processedIdsRef = useRef<Set<string>>(new Set());

    // UI State
    const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
    const [showProjectModal, setShowProjectModal] = useState(false);
    const [newProjectData, setNewProjectData] = useState({ name: '', location: '' });
    const [showProjectSettingsModal, setShowProjectSettingsModal] = useState(false);
    const [editProjectData, setEditProjectData] = useState({ name: '', location: '', pmId: '' });

    // Bulk Upload State
    const [csvContent, setCsvContent] = useState('');
    const [selectedSupervisor, setSelectedSupervisor] = useState('');
    const [uploadStatus, setUploadStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null);

    // --- NEW STATES FOR RESOURCE MANAGEMENT ---
    const [showUserModal, setShowUserModal] = useState(false);
    const [showAssignPMModal, setShowAssignPMModal] = useState(false); // New Modal State
    const [selectedAssignPM, setSelectedAssignPM] = useState(''); // Selected PM ID for assignment
    const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());
    const [showOpModal, setShowOpModal] = useState(false);
    const [opForm, setOpForm] = useState({ id: '', name: '', phone: '', supervisorId: '' });

    // User Management
    const [userSearchTerm, setUserSearchTerm] = useState('');
    const [userRoleFilter, setUserRoleFilter] = useState<'all' | 'project_manager' | 'supervisor' | 'it_specialist' | 'hr_admin'>('all');

    // Lookup for User Management
    const [allRegisteredProfiles, setAllRegisteredProfiles] = useState<User[]>([]);
    const [linkedUserId, setLinkedUserId] = useState<string | null>(null);

    // User Management Form Data
    const [newSupervisor, setNewSupervisor] = useState({
        name: '', teamName: '', username: '', password: '', role: 'supervisor' as Role, reportsTo: '', targetProjectId: '', targetProjectIds: [] as string[]
    });
    const [editingSupervisor, setEditingSupervisor] = useState<User | null>(null);

    // Operator Management (Bulk)
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
    const [targetSupId, setTargetSupId] = useState('');

    // History Filter State
    const [historyFilterDate, setHistoryFilterDate] = useState<string>('');
    const [historyFilterSupervisor, setHistoryFilterSupervisor] = useState<string>('');

    // Request Processing State
    const [processingId, setProcessingId] = useState<string | null>(null);

    // Chart Refs
    const trendChartRef = useRef<HTMLCanvasElement>(null);
    const teamChartRef = useRef<HTMLCanvasElement>(null);
    const categoryChartRef = useRef<HTMLCanvasElement>(null);
    const distributionChartRef = useRef<HTMLCanvasElement>(null);

    const chartInstances = useRef<{ [key: string]: any }>({});

    const currentProjectRef = useRef(currentProject);
    useEffect(() => { currentProjectRef.current = currentProject; }, [currentProject]);

    const isSuperAdmin = currentUser.role === 'super_admin' || currentUser.role === 'power_admin';
    const isItSpecialist = currentUser.role === 'it_specialist';
    const isHrAdmin = currentUser.role === 'hr_admin';

    // Defines who can create/switch projects globally
    const canManageProjects = isSuperAdmin || isItSpecialist || isHrAdmin;

    // 1. Initial Load
    useEffect(() => {
        const init = async () => {
            setLoading(true);
            const allPMs = await StorageService.getAllProjectManagers();
            setAllProjectManagers(allPMs);

            if (canManageProjects) {
                const projs = await StorageService.getProjects();
                setProjects(projs);
                setCurrentProject(ALL_PROJECTS_OPTION);
            } else if (currentUser.role === 'project_manager') {
                const summaries = await StorageService.getPMDashboardSummary(currentUser.id);
                setSiteSummaries(summaries);
                const projs = await StorageService.getProjectsByPM(currentUser.id);
                setProjects(projs);
                if (currentUser.projectId) {
                    const myProj = projs.find(p => p.id === currentUser.projectId);
                    if (myProj) setCurrentProject(myProj);
                }
            } else if (currentUser.projectId) {
                const projs = await StorageService.getProjects();
                const myProj = projs.find(p => p.id === currentUser.projectId);
                if (myProj) setCurrentProject(myProj);
            }
            setLoading(false);
        };
        init();
    }, [currentUser, canManageProjects]);

    // 2. Data Load
    useEffect(() => {
        if (currentProject) {
            loadProjectData(currentProject.id);
        } else {
            setSupervisors([]);
            setProjectManagers([]);
            setItSpecialists([]);
            setProjectUsers([]);
            setOperators([]);
            setAssets([]);
            setLogs([]);
            setPendingLogs([]);
            setUnlockRequests([]);
            setMaintenanceRequests([]);
        }
    }, [currentProject, allProjectManagers]);

    // 3. Realtime Subscriptions
    useEffect(() => {
        if (!currentProject) return;

        const projectId = currentProject.id;
        const filter = projectId === 'all' ? undefined : `project_id=eq.${projectId}`;
        const channelName = `admin-dashboard-${projectId}-${Date.now()}`;

        const dbChannel = supabase.channel(channelName)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'unlock_requests', filter: filter }, (payload) => {
                if (currentProjectRef.current) fetchRequestsOnly(currentProjectRef.current.id);
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_requests', filter: filter }, (payload) => {
                if (currentProjectRef.current) fetchMaintenanceOnly(currentProjectRef.current.id);
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'kpi_logs', filter: filter }, (payload) => {
                if (currentProjectRef.current) {
                    fetchLogsOnly(currentProjectRef.current.id);
                    fetchPendingLogs(currentProjectRef.current.id);
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(dbChannel);
        };
    }, [currentProject?.id]);

    const fetchRequestsOnly = async (project_id: string) => {
        const queryId = project_id === 'all' ? undefined : project_id;
        const pendingReqs = await StorageService.getUnlockRequests(queryId, undefined, 'pending');
        const safeReqs = pendingReqs.filter(r => !processedIdsRef.current.has(r.id));
        setUnlockRequests(safeReqs);
    };

    const fetchMaintenanceOnly = async (projectId: string) => {
        const queryId = projectId === 'all' ? undefined : projectId;
        const reqs = await StorageService.getMaintenanceRequests(queryId, 'pending');
        setMaintenanceRequests(reqs);
    };

    const fetchTicketsOnly = async () => {
        // getTickets internally scopes to currentUser's project/company
        const tickets = await StorageService.getTickets(currentUser);
        setOpenTickets(tickets.filter(t => t.status === 'open'));
    };

    const fetchLogsOnly = async (projectId: string) => {
        const queryId = projectId === 'all' ? undefined : projectId;
        const lgs = await StorageService.getLogs(queryId);
        setLogs(lgs);
    };

    const fetchPendingLogs = async (projectId: string) => {
        const queryId = projectId === 'all' ? undefined : projectId;
        const lgs = await StorageService.getLogs(queryId, 'pending');
        setPendingLogs(lgs);
    };

    const loadProjectData = async (projectId: string) => {
        setLoading(true);
        const queryId = projectId === 'all' ? undefined : projectId;

        const users = await StorageService.getUsers(queryId);
        const ops = await StorageService.getOperators(queryId);
        const assts = await StorageService.getAssets(queryId); // Fetch Assets
        const lgs = await StorageService.getLogs(queryId);

        await fetchRequestsOnly(projectId);
        await fetchMaintenanceOnly(projectId);
        await fetchTicketsOnly();
        await fetchPendingLogs(projectId);

        // Categorize Users
        let pms = users.filter(u => u.role === 'project_manager');
        const sups = users.filter(u => u.role === 'supervisor');
        const its = users.filter(u => u.role === 'it_specialist');
        const hrs = users.filter(u => u.role === 'hr_admin');

        // If viewing a specific project, ensure the assigned PM is visible even if their profile is global?
        // Actually StorageService.getUsers(pid) handles getting users for that project.
        // Logic below merges PMs if not found, to be safe.
        if (projectId !== 'all') {
            const proj = projects.find(p => p.id === projectId) || (currentProject?.id === projectId ? currentProject : null);
            if (proj && proj.pmId) {
                const assignedPM = allProjectManagers.find(u => u.id === proj.pmId);
                if (assignedPM && !pms.some(p => p.id === assignedPM.id)) {
                    pms.push(assignedPM);
                }
            }
        }

        setSupervisors(sups);
        setProjectManagers(pms);
        setItSpecialists(its);
        setHrAdmins(hrs);
        setProjectUsers([...sups, ...pms, ...its, ...hrs]);
        setOperators(ops);
        setAssets(assts);
        setLogs(lgs);
        setLoading(false);
        setSelectedIds(new Set());
    };

    // 5. Charts
    useEffect(() => {
        if ((activeTab === 'reports' || activeTab === 'dashboard') && logs.length > 0 && !loading) {
            initCharts();
        }
        return () => {
            Object.values(chartInstances.current).forEach((chart: any) => chart.destroy());
        };
    }, [activeTab, logs, loading, supervisors]);

    const initCharts = () => {
        // ... [Chart initialization code remains identical] ...
        const destroyChart = (key: string) => {
            if (chartInstances.current[key]) {
                chartInstances.current[key].destroy();
                delete chartInstances.current[key];
            }
        };
        const chartLogs = logs.filter(l => l.status === 'approved' || !l.status);

        // Trend
        if (trendChartRef.current) {
            destroyChart('trend');
            const ctx = trendChartRef.current.getContext('2d');
            const dailyData: Record<string, { sum: number; count: number }> = {};
            const sortedLogs = [...chartLogs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            sortedLogs.forEach(log => {
                const date = log.date.substring(5);
                if (!dailyData[date]) dailyData[date] = { sum: 0, count: 0 };
                const avg = (log.attitude + log.performance + log.quality + log.appearance) / 4;
                dailyData[date].sum += avg;
                dailyData[date].count += 1;
            });
            const labels = Object.keys(dailyData);
            const dataPoints = labels.map(d => (dailyData[d].sum / dailyData[d].count).toFixed(2));
            chartInstances.current['trend'] = new Chart(ctx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'متوسط الأداء اليومي',
                        data: dataPoints,
                        borderColor: '#007aff',
                        backgroundColor: (context: any) => {
                            const ctx = context.chart.ctx;
                            const gradient = ctx.createLinearGradient(0, 0, 0, 400);
                            gradient.addColorStop(0, 'rgba(0, 122, 255, 0.5)');
                            gradient.addColorStop(1, 'rgba(0, 122, 255, 0.0)');
                            return gradient;
                        },
                        fill: true,
                        tension: 0.4,
                        pointRadius: 3,
                        borderWidth: 2
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 10, grid: { borderDash: [4, 4], color: '#f0f0f0' } }, x: { grid: { display: false } } } }
            });
        }
        // Team
        if (teamChartRef.current && supervisors.length > 0) {
            destroyChart('team');
            const ctx = teamChartRef.current.getContext('2d');
            const supStats = supervisors.map(sup => {
                const supLogs = chartLogs.filter(l => l.supervisorId === sup.id);
                if (supLogs.length === 0) return { name: sup.name, avg: 0 };
                const totalScore = supLogs.reduce((acc, l) => acc + (l.attitude + l.performance + l.quality + l.appearance) / 4, 0);
                return { name: sup.name, avg: totalScore / supLogs.length };
            }).sort((a, b) => b.avg - a.avg);
            chartInstances.current['team'] = new Chart(ctx, {
                type: 'bar',
                data: { labels: supStats.map(s => s.name), datasets: [{ label: 'متوسط أداء الفريق', data: supStats.map(s => s.avg.toFixed(2)), backgroundColor: '#3b82f6', borderRadius: 6, barThickness: 20 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 10, grid: { display: false } }, x: { grid: { display: false } } } }
            });
        }
        // Category
        if (categoryChartRef.current) {
            destroyChart('category');
            const ctx = categoryChartRef.current.getContext('2d');
            const totals = chartLogs.reduce((acc, l) => ({
                attitude: acc.attitude + l.attitude, performance: acc.performance + l.performance, quality: acc.quality + l.quality, appearance: acc.appearance + l.appearance
            }), { attitude: 0, performance: 0, quality: 0, appearance: 0 });
            const count = chartLogs.length || 1;
            chartInstances.current['category'] = new Chart(ctx, {
                type: 'radar',
                data: { labels: ['السلوك', 'الأداء', 'الجودة', 'المظهر'], datasets: [{ label: 'نقاط القوة', data: [(totals.attitude / count).toFixed(2), (totals.performance / count).toFixed(2), (totals.quality / count).toFixed(2), (totals.appearance / count).toFixed(2)], backgroundColor: 'rgba(139, 92, 246, 0.2)', borderColor: '#8b5cf6', pointBackgroundColor: '#8b5cf6', pointBorderColor: '#fff' }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { r: { angleLines: { color: '#e5e7eb' }, grid: { color: '#e5e7eb' }, suggestedMin: 0, suggestedMax: 10, pointLabels: { font: { size: 12, family: 'Cairo' } } } } }
            });
        }
        // Distribution
        if (distributionChartRef.current) {
            destroyChart('dist');
            const ctx = distributionChartRef.current.getContext('2d');
            const dist = { excellent: 0, good: 0, fair: 0, poor: 0 };
            chartLogs.forEach(l => {
                const avg = (l.attitude + l.performance + l.quality + l.appearance) / 4;
                if (avg >= 9) dist.excellent++; else if (avg >= 7) dist.good++; else if (avg >= 5) dist.fair++; else dist.poor++;
            });
            chartInstances.current['dist'] = new Chart(ctx, {
                type: 'doughnut',
                data: { labels: ['ممتاز (9-10)', 'جيد (7-8.9)', 'متوسط (5-6.9)', 'ضعيف (<5)'], datasets: [{ data: [dist.excellent, dist.good, dist.fair, dist.poor], backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#ef4444'], borderWidth: 0, hoverOffset: 4 }] },
                options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'bottom', labels: { font: { family: 'Cairo', size: 10 }, boxWidth: 10 } } } }
            });
        }
    };

    // Stats
    const getStats = () => {
        // ... [Same stats logic] ...
        const approvedLogs = logs.filter(l => l.status === 'approved' || !l.status);
        if (approvedLogs.length === 0) return { avg: 0, total: 0, active: 0, trend: 0 };
        const totalScore = approvedLogs.reduce((acc, l) => acc + (l.attitude + l.performance + l.quality + l.appearance) / 4, 0);
        const avg = totalScore / approvedLogs.length;
        const now = new Date();
        const thisMonth = now.getMonth();
        const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
        const thisMonthLogs = approvedLogs.filter(l => new Date(l.date).getMonth() === thisMonth);
        const lastMonthLogs = approvedLogs.filter(l => new Date(l.date).getMonth() === lastMonth);
        const thisMonthAvg = thisMonthLogs.length ? thisMonthLogs.reduce((acc, l) => acc + (l.attitude + l.performance + l.quality + l.appearance) / 4, 0) / thisMonthLogs.length : 0;
        const lastMonthAvg = lastMonthLogs.length ? lastMonthLogs.reduce((acc, l) => acc + (l.attitude + l.performance + l.quality + l.appearance) / 4, 0) / lastMonthLogs.length : 0;
        const trend = lastMonthAvg === 0 ? 0 : ((thisMonthAvg - lastMonthAvg) / lastMonthAvg) * 100;
        return { avg: avg.toFixed(1), total: approvedLogs.length, active: new Set(approvedLogs.map(l => l.operatorId)).size, trend: trend.toFixed(1) };
    };

    const getTopPerformers = () => {
        // ... [Same top performers logic] ...
        const approvedLogs = logs.filter(l => l.status === 'approved' || !l.status);
        const opStats: Record<string, { name: string, sum: number, count: number }> = {};
        approvedLogs.forEach(l => {
            if (!opStats[l.operatorId]) {
                const op = operators.find(o => o.id === l.operatorId);
                opStats[l.operatorId] = { name: op?.name || 'Unknown', sum: 0, count: 0 };
            }
            const avg = (l.attitude + l.performance + l.quality + l.appearance) / 4;
            opStats[l.operatorId].sum += avg;
            opStats[l.operatorId].count += 1;
        });
        return Object.values(opStats).map(s => ({ name: s.name, avg: s.sum / s.count })).sort((a, b) => b.avg - a.avg).slice(0, 5);
    };
    const stats = getStats();
    const topPerformers = getTopPerformers();

    const filteredHistoryLogs = logs.filter(log => {
        const isApproved = log.status === 'approved' || !log.status;
        const matchesDate = historyFilterDate ? log.date === historyFilterDate : true;
        const matchesSup = historyFilterSupervisor ? log.supervisorId === historyFilterSupervisor : true;
        return isApproved && matchesDate && matchesSup;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // --- Handlers ---
    const handleSiteSelect = (summary: SiteSummary) => {
        const proj = projects.find(p => p.id === summary.projectId);
        if (proj) { setCurrentProject(proj); onNavigate('dashboard'); }
    };

    const handleReviewLog = async (logId: string, status: 'approved' | 'rejected') => {
        setProcessingId(logId);
        const success = await StorageService.updateLogStatus([logId], status);
        if (success) {
            if (currentProject) { fetchPendingLogs(currentProject.id); fetchLogsOnly(currentProject.id); }
            showToast(`تم ${status === 'approved' ? 'قبول' : 'رفض'} التقييم`, status === 'approved' ? 'success' : 'info');
        } else {
            showToast('فشل في تحديث الحالة', 'error');
        }
        setProcessingId(null);
    };

    const handleBulkApprove = async () => {
        if (pendingLogs.length === 0) return;
        confirmAction(
            `موافقة على جميع السجلات المعلقة (${pendingLogs.length})؟`,
            async () => {
                setProcessingId('bulk');
                const ids = pendingLogs.map(l => l.id);
                const success = await StorageService.updateLogStatus(ids, 'approved');
                if (success) {
                    if (currentProject) { fetchPendingLogs(currentProject.id); fetchLogsOnly(currentProject.id); }
                    showToast('تمت الموافقة الجماعية بنجاح');
                } else {
                    showToast('فشل في الموافقة الجماعية', 'error');
                }
                setProcessingId(null);
                closeConfirmModal();
            }
        );
    };

    const handleApproveUnlock = async (req: UnlockRequest) => {
        if (processingId) return;
        confirmAction(
            `هل أنت متأكد من فتح التقييم للموظف ${req.operatorName}؟ سيتم حذف التقييم الحالي للسماح بإدخال جديد.`,
            async () => {
                setProcessingId(req.id);
                processedIdsRef.current.add(req.id);
                setUnlockRequests(prev => prev.filter(r => r.id !== req.id));
                const success = await StorageService.approveUnlockRequest(req.id, req.operatorId, req.date, req.logId);
                if (success) {
                    if (currentProject) fetchLogsOnly(currentProject.id);
                    showToast('تمت الموافقة على الطلب وحذف التقييم القديم');
                }
                else {
                    processedIdsRef.current.delete(req.id);
                    if (currentProject) fetchRequestsOnly(currentProject.id);
                    showToast('حدث خطأ أثناء الموافقة على الطلب', 'error');
                }
                setProcessingId(null);
                closeConfirmModal();
            },
            true // dangerous action (deletes log)
        );
    };

    const handleRejectUnlock = async (req: UnlockRequest) => {
        if (processingId) return;
        confirmAction(
            'هل أنت متأكد من رفض هذا الطلب؟',
            async () => {
                setProcessingId(req.id);
                processedIdsRef.current.add(req.id);
                setUnlockRequests(prev => prev.filter(r => r.id !== req.id));
                const result = await StorageService.rejectUnlockRequest(req.id, req.operatorId, req.date);
                if (!result.success) {
                    processedIdsRef.current.delete(req.id);
                    if (currentProject) fetchRequestsOnly(currentProject.id);
                    showToast(`حدث خطأ: ${result.error}`, 'error');
                } else {
                    showToast('تم رفض الطلب', 'info');
                }
                setProcessingId(null);
                closeConfirmModal();
            },
            true
        );
    };

    const handleAcknowledgeMaintenance = async (req: MaintenanceRequest) => {
        if (processingId) return;
        setProcessingId(req.id!);

        const success = await StorageService.updateMaintenanceRequestStatus(req.id!, 'in_progress');
        if (success) {
            if (currentProject) fetchMaintenanceOnly(currentProject.id);
            showToast('تم استلام الطلب وتغيير الحالة إلى قيد التنفيذ');
        } else {
            showToast('فشل في تحديث حالة الطلب', 'error');
        }
        setProcessingId(null);
    };

    const handleCreateProject = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newProjectData.name || !newProjectData.location) return;
        const proj = await StorageService.createProject(newProjectData.name, newProjectData.location);
        if (proj) {
            setProjects([...projects, proj]);
            setCurrentProject(proj);
            setShowProjectModal(false);
            setNewProjectData({ name: '', location: '' });
            showToast('تم إنشاء المشروع بنجاح');
        } else {
            showToast("حدث خطأ أثناء إنشاء المشروع.", 'error');
        }
    };

    const handleUpdateProject = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentProject || !editProjectData.name) return;
        const success = await StorageService.updateProject(currentProject.id, editProjectData.name, editProjectData.location, editProjectData.pmId);
        if (success) {
            const updatedProj = { ...currentProject, ...editProjectData };
            setProjects(projects.map(p => p.id === currentProject.id ? updatedProj : p));
            setCurrentProject(updatedProj);
            setShowProjectSettingsModal(false);
            showToast('تم تحديث بيانات المشروع بنجاح');
        } else { showToast('حدث خطأ أثناء تحديث المشروع', 'error'); }
    };

    const handleDeleteProject = async () => {
        if (!currentProject) return;
        confirmAction(
            `تحذير هام: سيتم حذف مشروع "${currentProject.name}" وجميع البيانات المرتبطة به. هل أنت متأكد؟`,
            async () => {
                const success = await StorageService.deleteProject(currentProject.id);
                if (success) {
                    const remainingProjects = projects.filter(p => p.id !== currentProject.id);
                    setProjects(remainingProjects);
                    setCurrentProject(remainingProjects.length > 0 ? remainingProjects[0] : null);
                    setShowProjectSettingsModal(false);
                    showToast('تم حذف المشروع بنجاح');
                } else {
                    showToast('حدث خطأ أثناء حذف المشروع.', 'error');
                }
                closeConfirmModal();
            },
            true
        );
    };

    const openProjectSettings = () => {
        if (currentProject) {
            setEditProjectData({ name: currentProject.name, location: currentProject.location, pmId: currentProject.pmId || '' });
            setShowProjectSettingsModal(true);
        }
    };

    // --- Supervisor / User Actions ---
    const startEditUser = async (user: User) => {
        const targetPid = user.projectId || (currentProject?.id === 'all' ? '' : currentProject?.id) || '';

        // Load all available registered profiles for lookup when modal opens
        const allProfiles = await StorageService.getUsers('all');
        setAllRegisteredProfiles(allProfiles);

        // Determine initial assigned projects for PM
        let assignedProjects: string[] = [];
        if (user.role === 'project_manager' && user.id) {
            // Find projects where pmId matches user.id
            assignedProjects = projects.filter(p => p.pmId === user.id).map(p => p.id);
        }

        // Check if user object is empty (creation mode)
        if (!user.id) {
            setEditingSupervisor(null);
            setLinkedUserId(null);
            // Default role based on context if needed, otherwise supervisor
            const defaultRole = newSupervisor.role || 'supervisor';
            setNewSupervisor({ name: '', teamName: '', username: '', password: '', role: defaultRole, reportsTo: '', targetProjectId: targetPid, targetProjectIds: [] });
        } else {
            setEditingSupervisor(user);
            setLinkedUserId(null); // Editing existing logic assumes user is already linked/created
            setNewSupervisor({
                name: user.name || '', // Safety check
                teamName: user.teamName || '',
                username: user.username,
                password: user.password || '',
                role: user.role,
                reportsTo: user.reportsTo || '',
                targetProjectId: targetPid,
                targetProjectIds: assignedProjects
            });
        }
        setShowUserModal(true);
    };

    const handleCloseUserModal = () => {
        setShowUserModal(false);
        setEditingSupervisor(null);
        setLinkedUserId(null);
        setNewSupervisor({ name: '', teamName: '', username: '', password: '', role: 'supervisor' as Role, reportsTo: '', targetProjectId: '', targetProjectIds: [] });
    };

    const handleLinkUserSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const selectedId = e.target.value;
        if (!selectedId) {
            setLinkedUserId(null);
            setNewSupervisor(prev => ({ ...prev, name: '', username: '' }));
            return;
        }

        const user = allRegisteredProfiles.find(u => u.id === selectedId);
        if (user) {
            setLinkedUserId(user.id);
            setNewSupervisor(prev => ({
                ...prev,
                name: user.name || '',
                username: user.username || '',
                role: user.role // Optional: inherit role or let admin change it
            }));
        }
    };

    const toggleTargetProject = (projectId: string) => {
        setNewSupervisor(prev => {
            const current = new Set(prev.targetProjectIds);
            if (current.has(projectId)) current.delete(projectId);
            else current.add(projectId);
            return { ...prev, targetProjectIds: Array.from(current) };
        });
    };

    const handleSaveUser = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newSupervisor.name || !newSupervisor.username) return;

        if (canManageProjects && !newSupervisor.targetProjectId && newSupervisor.role !== 'it_specialist' && newSupervisor.role !== 'project_manager' && newSupervisor.role !== 'hr_admin') {
            showToast('يجب اختيار المشروع.', 'error');
            return;
        }

        // Check Team Name for Supervisors
        if (newSupervisor.role === 'supervisor' && !newSupervisor.teamName) {
            showToast('يجب إدخال اسم الفريق للمشرف.', 'error');
            return;
        }

        let userRole = newSupervisor.role;
        if (currentUser.role === 'project_manager') {
            if (userRole !== 'supervisor' && userRole !== 'it_specialist') {
                userRole = 'supervisor';
            }
        } else if (!canManageProjects) {
            userRole = 'supervisor';
        }

        let finalProjectId = newSupervisor.targetProjectId;

        // For PMs, we don't strictly require a single 'projectId' if they manage multiple.
        // However, the schema might expect one. We can set it to null or the first one.
        if (userRole === 'project_manager') {
            finalProjectId = newSupervisor.targetProjectIds.length > 0 ? newSupervisor.targetProjectIds[0] : '';
        } else if (userRole === 'it_specialist' || userRole === 'hr_admin') {
            finalProjectId = '';
        } else {
            if (!finalProjectId && currentProject && currentProject.id !== 'all') {
                finalProjectId = currentProject.id;
            }

            if (!finalProjectId) {
                showToast('حدث خطأ: لم يتم تحديد المشروع.', 'error');
                return;
            }
        }

        // Determine ID:
        // 1. If linking an existing Auth User -> Use that ID (linkedUserId)
        // 2. If editing existing user -> Use editingSupervisor.id
        // 3. If new Ghost User -> Generate 'u-...'
        let id = linkedUserId;
        if (!id && editingSupervisor) id = editingSupervisor.id;
        if (!id) id = `u-${Date.now()}`;

        const user: User = {
            id: id!,
            ...newSupervisor,
            role: userRole,
            projectId: finalProjectId || undefined,
            teamName: userRole === 'supervisor' ? newSupervisor.teamName : undefined,
            reportsTo: userRole === 'supervisor' ? newSupervisor.reportsTo : undefined
        };

        const result = await StorageService.saveUser(user);

        if (result.success) {
            // If PM, update project assignments
            if (userRole === 'project_manager') {
                await StorageService.assignProjectsToPM(user.id, newSupervisor.targetProjectIds);
                // Refresh projects list to reflect new PM assignments
                const projs = await StorageService.getProjects();
                setProjects(projs);
            }

            handleCloseUserModal();
            loadProjectData(currentProject ? currentProject.id : 'all');

            const roleLabels = {
                'supervisor': 'المشرف',
                'project_manager': 'مدير المشروع',
                'it_specialist': 'أخصائي IT',
                'hr_admin': 'مسؤول الموارد البشرية',
                'power_admin': 'مدير تنفيذي'
            };
            const roleLabel = roleLabels[userRole] || 'المستخدم';

            showToast(editingSupervisor ? 'تم تحديث بيانات المستخدم بنجاح' : `تم إضافة ${roleLabel} بنجاح`);
        } else {
            showToast('خطأ في الحفظ: ' + result.error, 'error');
        }
    };

    const handleDeleteSupervisor = async (id: string) => {
        if (!currentProject) return;
        confirmAction(
            'هل أنت متأكد من حذف هذا المستخدم؟',
            async () => {
                await StorageService.deleteUser(id);
                if (editingSupervisor && editingSupervisor.id === id) {
                    handleCloseUserModal();
                }
                loadProjectData(currentProject.id);
                showToast('تم حذف المستخدم', 'info');
                closeConfirmModal();
            },
            true
        );
    };

    // --- Assign PM Logic ---
    const handleAssignExistingPM = async () => {
        if (!currentProject || !selectedAssignPM) return;
        const success = await StorageService.updateProject(currentProject.id, currentProject.name, currentProject.location, selectedAssignPM);
        if (success) {
            const updatedProj = { ...currentProject, pmId: selectedAssignPM };
            setProjects(projects.map(p => p.id === currentProject.id ? updatedProj : p));
            setCurrentProject(updatedProj);
            setShowAssignPMModal(false);
            loadProjectData(currentProject.id);
            showToast('تم تعيين مدير المشروع بنجاح');
        } else {
            showToast('فشل تعيين المدير', 'error');
        }
    };

    // --- Operator Actions (Single) ---
    const toggleTeam = (supId: string) => {
        const newSet = new Set(expandedTeams);
        if (newSet.has(supId)) newSet.delete(supId); else newSet.add(supId);
        setExpandedTeams(newSet);
    };

    const openOpModal = (op: Operator | null, supId: string = '') => {
        if (op) {
            setOpForm({ id: op.id, name: op.name, phone: op.phone, supervisorId: op.supervisorId });
        } else {
            setOpForm({ id: `op-${Date.now()}`, name: '', phone: '', supervisorId: supId });
        }
        setShowOpModal(true);
    };

    const saveOperator = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!opForm.name || !currentProject) return;

        await StorageService.saveOperators([{
            id: opForm.id,
            name: opForm.name,
            phone: opForm.phone,
            supervisorId: opForm.supervisorId,
            projectId: currentProject.id
        }]);

        setShowOpModal(false);
        loadProjectData(currentProject.id);
        showToast('تم حفظ بيانات الموظف');
    };

    // --- Bulk Actions ---
    const handleBulkUpload = async () => {
        if (!currentProject || !selectedSupervisor || !csvContent.trim()) { setUploadStatus({ type: 'error', msg: 'بيانات ناقصة' }); return; }
        try {
            setUploadStatus({ type: 'success', msg: 'جاري الرفع...' });
            const lines = csvContent.trim().split('\n');
            const newOperators: Operator[] = lines.map(line => {
                const [id, name, phone] = line.split(',').map(s => s.trim());
                if (!id || !name) throw new Error('تنسيق غير صحيح');
                return { id, name, phone: phone || '', supervisorId: selectedSupervisor, projectId: currentProject.id };
            });
            await StorageService.saveOperators(newOperators);
            setCsvContent('');
            setUploadStatus({ type: 'success', msg: `تم إضافة ${newOperators.length} موظف بنجاح` });
            showToast(`تم إضافة ${newOperators.length} موظف`, 'success');
            loadProjectData(currentProject.id);
        } catch (err) { setUploadStatus({ type: 'error', msg: 'خطأ في تنسيق الملف' }); }
    };

    const handleBulkMove = async () => {
        if (!targetSupId || selectedIds.size === 0 || !currentProject) return;
        await StorageService.updateOperatorsSupervisor(Array.from(selectedIds), targetSupId);
        setIsMoveModalOpen(false);
        setTargetSupId('');
        loadProjectData(currentProject.id);
        showToast(`تم نقل ${selectedIds.size} موظف بنجاح`);
    };

    const handleBulkDelete = async () => {
        if (selectedIds.size === 0 || !currentProject) return;
        confirmAction(
            `هل أنت متأكد من حذف ${selectedIds.size} موظف؟`,
            async () => {
                await StorageService.deleteOperators(Array.from(selectedIds));
                loadProjectData(currentProject.id);
                setSelectedIds(new Set());
                showToast('تم حذف الموظفين بنجاح', 'info');
                closeConfirmModal();
            },
            true
        );
    };

    const toggleSelectAll = (filteredOps: Operator[]) => {
        setSelectedIds(selectedIds.size === filteredOps.length && filteredOps.length > 0 ? new Set() : new Set(filteredOps.map(op => op.id)));
    };

    const toggleSelect = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
        setSelectedIds(newSet);
    };

    // --- Render Sections ---

    const renderHeader = () => {
        // ... [Original renderHeader code] ...
        if (activeTab === 'sites' && currentUser.role === 'project_manager') {
            return (
                <div className="mb-8 flex justify-between items-center bg-white p-5 rounded-xl shadow-sm border border-gray-100">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800">نظرة عامة للمواقع</h1>
                        <p className="text-gray-500 text-sm mt-1">مرحباً {currentUser.name}، لديك {siteSummaries.length} موقع تحت إدارتك.</p>
                    </div>
                </div>
            );
        }

        if (!currentProject) return null;
        const pendingCount = unlockRequests.filter(r => r.status === 'pending').length;
        const maintenanceCount = maintenanceRequests.length;
        const ticketsCount = openTickets.length;
        const totalNotifications = pendingCount + maintenanceCount + ticketsCount;
        const pendingReviewCount = pendingLogs.length;

        return (
            <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-5 rounded-xl shadow-sm border border-gray-100 relative">
                <div className="flex items-center gap-4 w-full md:w-auto">
                    {currentUser.role === 'project_manager' && (
                        <button
                            onClick={() => { setCurrentProject(null); onNavigate('sites'); }}
                            className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                            title="العودة للمواقع"
                        >
                            <span className="material-icons">arrow_forward</span>
                        </button>
                    )}

                    <div className="flex items-center gap-2 text-sm text-gray-600">
                        <span className="material-icons text-gray-400">domain</span>
                        <span className="font-bold text-gray-800 text-lg">{currentProject.name}</span>
                        <span className="bg-gray-100 text-gray-500 text-xs px-2 py-1 rounded-full">{currentProject.location}</span>
                    </div>

                    <div className="relative flex gap-2">
                        {pendingReviewCount > 0 && (
                            <button onClick={() => onNavigate('approvals')} className="p-2 rounded-full bg-orange-50 text-orange-600 hover:bg-orange-100 relative">
                                <span className="material-icons text-2xl">fact_check</span>
                                <span className="absolute top-1 right-1 w-5 h-5 bg-orange-500 text-white text-xs font-bold rounded-full flex items-center justify-center border-2 border-white animate-pulse">{pendingReviewCount}</span>
                            </button>
                        )}
                        <button onClick={() => { if (currentProject) { fetchRequestsOnly(currentProject.id); fetchMaintenanceOnly(currentProject.id); fetchTicketsOnly(); } setIsNotificationsOpen(true); }} className={`relative p-2 rounded-full transition-colors ${isNotificationsOpen ? 'bg-blue-50 text-primary' : 'text-gray-400 hover:text-primary hover:bg-gray-50'}`}>
                            <span className="material-icons text-2xl">notifications</span>
                            {totalNotifications > 0 && <span className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center border-2 border-white animate-bounce">{totalNotifications}</span>}
                        </button>
                        <button onClick={() => loadProjectData(currentProject.id)} className="p-2 rounded-full text-gray-400 hover:text-primary hover:bg-gray-50 transition-colors"><span className="material-icons text-2xl">refresh</span></button>
                    </div>
                </div>

                {canManageProjects && (
                    <div className="flex items-center gap-2 w-full md:w-auto mt-4 md:mt-0">
                        <div className="relative flex-1 md:w-64">
                            <select className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg cursor-pointer focus:ring-2 focus:ring-primary outline-none text-sm font-bold text-gray-700" value={currentProject.id} onChange={(e) => { if (e.target.value === 'all') setCurrentProject(ALL_PROJECTS_OPTION); else { const p = projects.find(proj => proj.id === e.target.value); if (p) setCurrentProject(p); } }}>
                                <option value="all">كل المشاريع</option>
                                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                            <span className="material-icons absolute left-3 top-2.5 text-gray-400 pointer-events-none">expand_more</span>
                        </div>
                        {currentProject.id !== 'all' && (
                            <button onClick={openProjectSettings} className="p-2 bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-200 border border-gray-200"><span className="material-icons">settings</span></button>
                        )}
                        <button onClick={() => setShowProjectModal(true)} className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"><span className="material-icons">add</span></button>
                    </div>
                )}
            </div>
        );
    };

    // ... (Notification Sidebar) ...
    const renderNotificationSidebar = () => {
        // ... logic remains same ...
        const visibleRequests = unlockRequests.filter(req => req.status === 'pending');

        return (
            <>
                {isNotificationsOpen && <div className="fixed inset-0 bg-black/30 z-40 backdrop-blur-sm" onClick={() => setIsNotificationsOpen(false)} />}
                <div className={`fixed inset-y-0 right-0 w-80 sm:w-96 bg-white shadow-2xl z-50 transform transition-transform duration-300 ${isNotificationsOpen ? 'translate-x-0' : 'translate-x-full'}`}>
                    <div className="h-full flex flex-col">
                        <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
                            <h3 className="font-bold text-gray-800 flex items-center gap-2"><span className="material-icons text-primary">notifications_active</span> الإشعارات</h3>
                            <button onClick={() => setIsNotificationsOpen(false)} className="text-gray-400 hover:text-red-500"><span className="material-icons">close</span></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            {/* Maintenance Section */}
                            {maintenanceRequests.length > 0 && (
                                <div className="mb-6">
                                    <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">طلبات الصيانة ({maintenanceRequests.length})</h4>
                                    <div className="space-y-3">
                                        {maintenanceRequests.map(req => (
                                            <div key={req.id} className="bg-white border-l-4 border-l-red-500 border rounded-r-lg p-3 shadow-sm">
                                                <div className="flex justify-between items-start mb-2">
                                                    <div className="font-bold text-gray-800 flex items-center gap-2">
                                                        <span className="material-icons text-red-500 text-sm">build</span>
                                                        {req.assetName}
                                                    </div>
                                                    <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${req.priority === 'critical' ? 'bg-red-600 text-white' : req.priority === 'high' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'}`}>
                                                        {req.priority}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-gray-600 mb-2 italic bg-gray-50 p-2 rounded">"{req.description}"</p>
                                                <div className="flex justify-between items-center mt-2">
                                                    <div className="text-[10px] text-gray-400">بواسطة: {req.supervisorName}</div>
                                                    <button
                                                        onClick={() => handleAcknowledgeMaintenance(req)}
                                                        disabled={processingId === req.id}
                                                        className="text-xs bg-blue-50 text-blue-600 px-3 py-1 rounded hover:bg-blue-100 font-bold"
                                                    >
                                                        استلام
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Unlock Requests Section */}
                            {visibleRequests.length > 0 && (
                                <div>
                                    <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">طلبات إعادة التقييم ({visibleRequests.length})</h4>
                                    <div className="space-y-3">
                                        {visibleRequests.map(req => (
                                            <div key={req.id} className="bg-white border rounded-lg p-4 shadow-sm">
                                                <div className="flex justify-between mb-2">
                                                    <div className="font-bold">{req.operatorName}</div>
                                                    <span className="text-xs bg-gray-100 px-2 py-1 rounded">{req.date}</span>
                                                </div>
                                                <div className="text-xs text-gray-500 mb-2">المشرف: {req.supervisorName}</div>
                                                <div className="bg-gray-50 p-2 rounded text-xs text-gray-600 italic mb-3">"{req.reason}"</div>
                                                <div className="flex gap-2">
                                                    <button onClick={() => handleApproveUnlock(req)} disabled={processingId === req.id} className="flex-1 bg-green-500 text-white py-1.5 rounded text-xs font-bold hover:bg-green-600">موافقة</button>
                                                    <button onClick={() => handleRejectUnlock(req)} disabled={processingId === req.id} className="flex-1 border text-gray-600 py-1.5 rounded text-xs font-bold hover:bg-gray-50">رفض</button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Tickets Section */}
                            {openTickets.length > 0 && (
                                <div className="mb-6">
                                    <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">تذاكر الدعم الجديدة ({openTickets.length})</h4>
                                    <div className="space-y-3">
                                        {openTickets.map(req => (
                                            <div key={req.id} className="bg-white border-l-4 border-l-blue-500 border rounded-r-lg p-3 shadow-sm">
                                                <div className="flex justify-between items-start mb-2">
                                                    <div className="font-bold text-gray-800 flex items-center gap-2">
                                                        <span className="material-icons text-blue-500 text-sm">support_agent</span>
                                                        {req.title}
                                                    </div>
                                                    <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${req.priority === 'critical' ? 'bg-red-600 text-white' : req.priority === 'high' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'}`}>
                                                        {req.priority}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-gray-600 mb-2 italic bg-gray-50 p-2 rounded">"{req.description}"</p>
                                                <div className="flex justify-between items-center mt-2">
                                                    <div className="text-[10px] text-gray-400">بواسطة: {req.creatorName}</div>
                                                    <button
                                                        onClick={() => { setIsNotificationsOpen(false); onNavigate('tickets'); }}
                                                        className="text-xs bg-blue-50 text-blue-600 px-3 py-1 rounded hover:bg-blue-100 font-bold"
                                                    >
                                                        التفاصيل
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {visibleRequests.length === 0 && maintenanceRequests.length === 0 && openTickets.length === 0 && (
                                <div className="text-center text-gray-400 mt-10">
                                    <span className="material-icons text-4xl mb-2 opacity-20">notifications_off</span>
                                    <p>لا توجد إشعارات جديدة</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </>
        );
    };

    // ... (Org Chart & Render Logic remains mostly same, just wrapping in <> and adding Modals at bottom) ...
    const renderOrgChart = () => {
        // ... logic unchanged ...
        const unassignedSupervisors = supervisors.filter(s => !s.reportsTo);
        const pmTree = projectManagers.map(pm => {
            const directReports = supervisors.filter(s => s.reportsTo === pm.id);
            return { ...pm, children: directReports };
        });

        return (
            <div className="space-y-12 pb-12">
                {pmTree.map(pm => (
                    <div key={pm.id} className="flex flex-col items-center animate-fade-in-up">
                        <div className="mb-8 relative">
                            <div className="bg-purple-600 text-white p-4 rounded-xl shadow-lg w-64 text-center z-10 relative">
                                <div className="font-bold text-lg">{pm.name}</div>
                                <div className="text-xs opacity-75 uppercase tracking-wider">Project Manager</div>
                            </div>
                            {pm.children.length > 0 && (
                                <div className="absolute top-full left-1/2 w-0.5 h-8 bg-gray-300 -translate-x-1/2"></div>
                            )}
                        </div>
                        {pm.children.length > 0 && (
                            <div className="flex flex-wrap justify-center gap-8 relative">
                                {pm.children.length > 1 && (
                                    <div className="absolute -top-8 left-0 right-0 h-0.5 bg-gray-300 mx-auto" style={{ width: `calc(100% - ${16}rem)` }}></div>
                                )}

                                {pm.children.map((sup, idx) => {
                                    const myOperators = operators.filter(op => op.supervisorId === sup.id);
                                    return (
                                        <div key={sup.id} className="flex flex-col items-center relative">
                                            <div className="absolute -top-8 w-0.5 h-8 bg-gray-300"></div>
                                            <div className="bg-white border-t-4 border-blue-500 p-4 rounded-lg shadow-sm w-60 mb-4 text-center">
                                                <div className="font-bold text-gray-800">{sup.name}</div>
                                                <div className="text-xs text-gray-500 uppercase">{sup.teamName || 'Team Lead'}</div>
                                                <div className="mt-2 text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded inline-block">
                                                    {myOperators.length} Members
                                                </div>
                                            </div>
                                            {myOperators.length > 0 && (
                                                <div className="w-56 bg-gray-50 rounded-lg border border-gray-100 p-2 space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
                                                    {myOperators.map(op => (
                                                        <div key={op.id} className="text-xs text-gray-600 flex items-center gap-2 bg-white p-1.5 rounded border border-gray-100">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-gray-300"></span>
                                                            <span className="truncate">{op.name}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ))}
                {/* Unassigned Section Logic Omitted for brevity but assumed present */}
            </div>
        );
    };

    return (
        <>
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
            <ConfirmationModal
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                onConfirm={confirmModal.onConfirm}
                onCancel={closeConfirmModal}
                isDangerous={confirmModal.isDangerous}
            />

            {/* ... [Project Modals Code omitted for brevity, unchanged] ... */}
            {showProjectModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
                        <h3 className="text-xl font-bold mb-4">مشروع جديد</h3>
                        <form onSubmit={handleCreateProject} className="space-y-4">
                            <input type="text" className="w-full p-3 bg-gray-50 border rounded-lg" required value={newProjectData.name} onChange={e => setNewProjectData({ ...newProjectData, name: e.target.value })} placeholder="اسم المشروع" />
                            <input type="text" className="w-full p-3 bg-gray-50 border rounded-lg" required value={newProjectData.location} onChange={e => setNewProjectData({ ...newProjectData, location: e.target.value })} placeholder="الموقع" />
                            <button type="submit" className="w-full bg-primary text-white py-3 rounded-lg font-bold">إنشاء</button>
                        </form>
                        <button onClick={() => setShowProjectModal(false)} className="mt-4 text-gray-400 text-sm w-full text-center">إلغاء</button>
                    </div>
                </div>
            )}

            {showProjectSettingsModal && currentProject && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
                        <h3 className="text-xl font-bold mb-4">إعدادات المشروع</h3>
                        <form onSubmit={handleUpdateProject} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">اسم المشروع</label>
                                <input type="text" className="w-full p-3 bg-gray-50 border rounded-lg" required value={editProjectData.name} onChange={e => setEditProjectData({ ...editProjectData, name: e.target.value })} />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">الموقع</label>
                                <input type="text" className="w-full p-3 bg-gray-50 border rounded-lg" required value={editProjectData.location} onChange={e => setEditProjectData({ ...editProjectData, location: e.target.value })} />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">مدير المشروع (Project Manager)</label>
                                <select
                                    className="w-full p-3 bg-gray-50 border rounded-lg"
                                    value={editProjectData.pmId}
                                    onChange={e => setEditProjectData({ ...editProjectData, pmId: e.target.value })}
                                >
                                    <option value="">-- غير محدد --</option>
                                    {allProjectManagers.map(pm => (
                                        <option key={pm.id} value={pm.id}>{pm.name}</option>
                                    ))}
                                </select>
                            </div>

                            <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold">حفظ</button>
                            <button type="button" onClick={handleDeleteProject} className="w-full bg-red-50 text-red-600 py-3 rounded-lg font-bold">حذف المشروع</button>
                        </form>
                        <button onClick={() => setShowProjectSettingsModal(false)} className="mt-4 text-gray-400 text-sm w-full text-center">إلغاء</button>
                    </div>
                </div>
            )}

            {/* ASSIGN PM MODAL */}
            {showAssignPMModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6 animate-fade-in-up">
                        <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                            <span className="material-icons text-blue-600">manage_accounts</span>
                            تعيين مدير مشروع
                        </h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-2">اختر مدير من القائمة</label>
                                <select
                                    className="w-full p-3 bg-gray-50 border rounded-lg"
                                    value={selectedAssignPM}
                                    onChange={(e) => setSelectedAssignPM(e.target.value)}
                                >
                                    <option value="">-- اختر --</option>
                                    {allProjectManagers.map(pm => (
                                        <option key={pm.id} value={pm.id}>{pm.name}</option>
                                    ))}
                                </select>
                            </div>
                            <button
                                onClick={handleAssignExistingPM}
                                disabled={!selectedAssignPM}
                                className="w-full bg-primary text-white py-3 rounded-lg font-bold disabled:bg-gray-300"
                            >
                                حفظ التعيين
                            </button>
                            <button
                                onClick={() => { setShowAssignPMModal(false); setNewSupervisor({ ...newSupervisor, role: 'project_manager' }); startEditUser({} as any); }}
                                className="w-full bg-white border border-gray-300 text-gray-700 py-2 rounded-lg font-bold hover:bg-gray-50"
                            >
                                إضافة مدير جديد
                            </button>
                            <button onClick={() => setShowAssignPMModal(false)} className="mt-4 text-gray-400 text-sm w-full text-center">إلغاء</button>
                        </div>
                    </div>
                </div>
            )}

            {/* GLOBAL USER MODAL (Add/Edit PMs, Supervisors, IT Specs) */}
            {showUserModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 animate-fade-in-up overflow-y-auto max-h-[90vh]">
                        <div className="flex justify-between items-center mb-6 border-b pb-2">
                            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                                <span className="material-icons text-primary">{editingSupervisor ? 'edit' : 'person_add'}</span>
                                {editingSupervisor ? 'تعديل مستخدم' : 'مستخدم جديد'}
                            </h3>
                            <button onClick={handleCloseUserModal} className="text-gray-400 hover:text-red-500"><span className="material-icons">close</span></button>
                        </div>

                        <form onSubmit={handleSaveUser} className="space-y-4">
                            {/* EXISTING USER LOOKUP SECTION */}
                            {!editingSupervisor && (
                                <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 mb-4">
                                    <label className="block text-xs font-bold text-blue-800 mb-2 flex items-center gap-1">
                                        <span className="material-icons text-sm">search</span>
                                        بحث عن مستخدم مسجل (Link to Existing User)
                                    </label>
                                    <select
                                        className="w-full p-2 border rounded text-sm bg-white focus:ring-2 focus:ring-blue-400 outline-none"
                                        onChange={handleLinkUserSelect}
                                        defaultValue=""
                                    >
                                        <option value="">-- اختر مستخدم لربطه --</option>
                                        {allRegisteredProfiles
                                            .filter(u => !u.projectId || u.projectId === 'null') // Suggest unassigned users first
                                            .concat(allRegisteredProfiles.filter(u => u.projectId)) // Then others
                                            .map(u => (
                                                <option key={u.id} value={u.id}>
                                                    {u.username} ({u.name}) {u.projectId ? '- Assigned' : '- New'}
                                                </option>
                                            ))}
                                    </select>
                                    <p className="text-[10px] text-blue-600 mt-1">
                                        اختر مستخدم مسجل مسبقاً لتعيين دور ومشروع له.
                                    </p>
                                </div>
                            )}

                            {/* Form fields logic */}
                            {canManageProjects && (
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">المشروع</label>
                                    {newSupervisor.role === 'project_manager' ? (
                                        <div className="border rounded-lg p-2 max-h-40 overflow-y-auto bg-gray-50">
                                            <div className="text-xs text-gray-400 mb-2">اختر مشروع واحد أو أكثر (لإدارة عدة مواقع)</div>
                                            {projects.map(p => (
                                                <div key={p.id} className="flex items-center gap-2 mb-2 last:mb-0">
                                                    <input
                                                        type="checkbox"
                                                        id={`proj-${p.id}`}
                                                        className="w-4 h-4 rounded text-primary"
                                                        checked={newSupervisor.targetProjectIds.includes(p.id)}
                                                        onChange={() => toggleTargetProject(p.id)}
                                                        disabled={!!editingSupervisor?.id && currentProject?.id !== 'all'}
                                                    />
                                                    <label htmlFor={`proj-${p.id}`} className="text-sm text-gray-700 cursor-pointer select-none">
                                                        {p.name} {p.pmId && p.pmId !== editingSupervisor?.id ? <span className="text-xs text-orange-500">(لديه مدير بالفعل)</span> : ''}
                                                    </label>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <select
                                            className="w-full p-3 bg-gray-50 border rounded-lg outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-200 disabled:text-gray-500"
                                            value={newSupervisor.targetProjectId}
                                            onChange={(e) => setNewSupervisor({ ...newSupervisor, targetProjectId: e.target.value })}
                                            required={currentProject?.id === 'all' && newSupervisor.role !== 'it_specialist' && newSupervisor.role !== 'hr_admin'}
                                            disabled={(!!editingSupervisor?.id && currentProject?.id !== 'all') || newSupervisor.role === 'it_specialist' || newSupervisor.role === 'hr_admin'}
                                        >
                                            <option value="">{(newSupervisor.role === 'it_specialist' || newSupervisor.role === 'hr_admin') ? 'كل المشاريع (Global)' : '-- اختر المشروع --'}</option>
                                            {projects.map(p => (
                                                <option key={p.id} value={p.id}>{p.name}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                            )}

                            {(canManageProjects || currentUser.role === 'project_manager') && (
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">الدور الوظيفي</label>
                                    <select
                                        className="w-full p-3 bg-gray-50 border rounded-lg outline-none focus:ring-2 focus:ring-primary"
                                        value={newSupervisor.role}
                                        onChange={(e) => setNewSupervisor({ ...newSupervisor, role: e.target.value as Role })}
                                    >
                                        <option value="supervisor">مشرف فريق</option>
                                        {isSuperAdmin && <option value="project_manager">مدير مشروع</option>}
                                        <option value="it_specialist">أخصائي تكنولوجيا المعلومات</option>
                                        {(isSuperAdmin || currentUser.role === 'hr_admin') && <option value="hr_admin">مسؤول الموارد البشرية</option>}
                                    </select>
                                </div>
                            )}
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">الاسم الكامل</label>
                                <input type="text" className="w-full p-3 bg-gray-50 border rounded-lg outline-none focus:ring-2 focus:ring-primary" value={newSupervisor.name} onChange={e => setNewSupervisor({ ...newSupervisor, name: e.target.value })} required />
                            </div>

                            {newSupervisor.role === 'supervisor' && (
                                <>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">اسم الفريق (مطلوب للمشرفين)</label>
                                        <input type="text" className="w-full p-3 bg-gray-50 border rounded-lg outline-none focus:ring-2 focus:ring-primary" value={newSupervisor.teamName} onChange={e => setNewSupervisor({ ...newSupervisor, teamName: e.target.value })} required placeholder="مثال: الفريق الأول - الفترة الصباحية" />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">المدير المباشر (Reports To)</label>
                                        <select
                                            className="w-full p-3 bg-gray-50 border rounded-lg outline-none focus:ring-2 focus:ring-primary"
                                            value={newSupervisor.reportsTo || ''}
                                            onChange={(e) => setNewSupervisor({ ...newSupervisor, reportsTo: e.target.value })}
                                        >
                                            <option value="">-- اختر مدير المشروع --</option>
                                            {allProjectManagers
                                                .filter(pm => !newSupervisor.targetProjectId || pm.projectId === newSupervisor.targetProjectId)
                                                .map(pm => (
                                                    <option key={pm.id} value={pm.id}>{pm.name}</option>
                                                ))}
                                        </select>
                                        {newSupervisor.targetProjectId && allProjectManagers.filter(pm => pm.projectId === newSupervisor.targetProjectId).length === 0 && (
                                            <p className="text-[10px] text-orange-600 mt-1">لا يوجد مدير مشروع معين لهذا المشروع. يرجى تعيين مدير مشروع أولاً.</p>
                                        )}
                                    </div>
                                </>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">اسم المستخدم / البريد</label>
                                    <input
                                        type="text"
                                        className="w-full p-3 bg-gray-50 border rounded-lg outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-200 disabled:text-gray-500"
                                        value={newSupervisor.username}
                                        onChange={e => setNewSupervisor({ ...newSupervisor, username: e.target.value })}
                                        required
                                        disabled={!!linkedUserId}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">كلمة المرور</label>
                                    <input
                                        type="password"
                                        className="w-full p-3 bg-gray-50 border rounded-lg outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-200"
                                        value={linkedUserId ? '********' : newSupervisor.password}
                                        onChange={e => !linkedUserId && setNewSupervisor({ ...newSupervisor, password: e.target.value })}
                                        required={!editingSupervisor && !linkedUserId}
                                        disabled={!!linkedUserId}
                                        placeholder={editingSupervisor || linkedUserId ? (linkedUserId ? "يدار بواسطة المستخدم" : "ترك فارغاً للإبقاء") : ""}
                                    />
                                </div>
                            </div>

                            <button type="submit" className="w-full bg-primary text-white py-3 rounded-lg font-bold shadow-lg shadow-blue-500/20 hover:bg-primary-dark transition-colors mt-4">
                                {editingSupervisor ? 'حفظ التغييرات' : 'إضافة / ربط المستخدم'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* OPERATOR MODAL (Add/Edit Operators) */}
            {showOpModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6 animate-fade-in-up">
                        <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                            <span className="material-icons text-primary">badge</span>
                            {opForm.id.startsWith('op-') && !opForm.name ? 'موظف جديد' : 'تعديل موظف'}
                        </h3>
                        <form onSubmit={saveOperator} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">الاسم</label>
                                <input className="w-full p-2 border rounded bg-gray-50" value={opForm.name} onChange={e => setOpForm({ ...opForm, name: e.target.value })} required />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">رقم الهاتف</label>
                                <input className="w-full p-2 border rounded bg-gray-50" value={opForm.phone} onChange={e => setOpForm({ ...opForm, phone: e.target.value })} />
                            </div>

                            <div className="flex gap-2 mt-4">
                                <button type="submit" className="flex-1 bg-primary text-white py-2 rounded font-bold">حفظ</button>
                                <button type="button" onClick={() => setShowOpModal(false)} className="flex-1 bg-gray-100 text-gray-600 py-2 rounded font-bold">إلغاء</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {isMoveModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6">
                        <h3 className="font-bold mb-4">نقل {selectedIds.size} موظف</h3>
                        <select className="w-full p-3 bg-gray-50 border rounded-lg mb-4" value={targetSupId} onChange={(e) => setTargetSupId(e.target.value)}>
                            <option value="">-- اختر مشرف --</option>
                            {supervisors.filter(s => s.role === 'supervisor').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        <button onClick={handleBulkMove} disabled={!targetSupId} className="w-full bg-primary text-white py-3 rounded-lg font-bold disabled:bg-gray-300">نقل</button>
                        <button onClick={() => setIsMoveModalOpen(false)} className="mt-4 text-gray-400 text-sm w-full text-center">إلغاء</button>
                    </div>
                </div>
            )}

            {renderNotificationSidebar()}

            {/* ... [Rest of the render code for tabs like Dashboard, Reports, Structure, etc. unchanged] ... */}
            {loading && !currentProject && activeTab !== 'sites' ? (
                <div className="flex justify-center p-10"><span className="material-icons animate-spin text-4xl text-primary">donut_large</span></div>
            ) : activeTab === 'sites' ? (
                <>
                    {renderHeader()}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-fade-in-up">
                        {siteSummaries.map(site => (
                            <div
                                key={site.projectId}
                                onClick={() => handleSiteSelect(site)}
                                className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-lg transition-all cursor-pointer group"
                            >
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <h3 className="text-xl font-bold text-gray-800 group-hover:text-primary transition-colors">{site.siteName}</h3>
                                        <div className="flex items-center gap-1 text-gray-500 text-sm mt-1">
                                            <span className="material-icons text-sm">location_on</span>
                                            {site.location}
                                        </div>
                                    </div>
                                    <div className="p-2 bg-gray-50 rounded-full group-hover:bg-blue-50 transition-colors">
                                        <span className="material-icons text-gray-400 group-hover:text-primary">arrow_forward</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-2 mt-6">
                                    <div className="text-center p-2 rounded bg-blue-50 border border-blue-100">
                                        <span className="material-icons text-blue-500 text-xl mb-1">groups</span>
                                        <div className="font-bold text-gray-800 text-lg">{site.supervisorCount}</div>
                                        <div className="text-[10px] text-gray-500">Supervisors</div>
                                    </div>
                                    <div className="text-center p-2 rounded bg-orange-50 border border-orange-100 relative">
                                        <span className="material-icons text-orange-500 text-xl mb-1">lock_open</span>
                                        {site.pendingRequestsCount > 0 && <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full animate-ping"></span>}
                                        <div className="font-bold text-gray-800 text-lg">{site.pendingRequestsCount}</div>
                                        <div className="text-[10px] text-gray-500">Requests</div>
                                    </div>
                                    <div className="text-center p-2 rounded bg-purple-50 border border-purple-100">
                                        <span className="material-icons text-purple-500 text-xl mb-1">build</span>
                                        <div className="font-bold text-gray-800 text-lg">{site.assetsMaintenanceCount}</div>
                                        <div className="text-[10px] text-gray-500">Assets</div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            ) : !currentProject ? (
                <div className="flex flex-col items-center justify-center h-96 bg-white rounded-xl shadow-sm border p-8 text-center">
                    <span className="material-icons text-5xl text-gray-300 mb-4">domain_disabled</span>
                    <h2 className="text-2xl font-bold text-gray-800">لا يوجد مشروع</h2>
                    {canManageProjects && <button onClick={() => setShowProjectModal(true)} className="mt-4 bg-primary text-white px-6 py-2 rounded-lg font-bold">مشروع جديد</button>}
                </div>
            ) : (
                <>
                    {renderHeader()}

                    {/* ... [Dashboards, Structure Tabs] ... */}
                    {(activeTab === 'dashboard' || activeTab === 'reports') && (
                        <div className="space-y-6 animate-fade-in-up">
                            {/* ... [Charts Code] ... */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="p-2 rounded-lg bg-blue-50 text-blue-600"><span className="material-icons">analytics</span></div>
                                        <span className={`text-xs font-bold px-2 py-1 rounded-full flex items-center ${Number(stats.trend) >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                            {Number(stats.trend) >= 0 ? '▲' : '▼'} {Math.abs(Number(stats.trend))}%
                                        </span>
                                    </div>
                                    <h3 className="text-3xl font-bold text-gray-800 mb-1">{stats.avg}</h3>
                                    <p className="text-gray-400 text-xs font-bold">المتوسط العام</p>
                                </div>
                                {/* ... other stats ... */}
                                <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="p-2 rounded-lg bg-purple-50 text-purple-600"><span className="material-icons">assignment_turned_in</span></div>
                                    </div>
                                    <h3 className="text-3xl font-bold text-gray-800 mb-1">{stats.total}</h3>
                                    <p className="text-gray-400 text-xs font-bold">إجمالي التقييمات (Approved)</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                                    <div className="flex justify-between items-center mb-6">
                                        <h3 className="font-bold text-gray-800 text-lg">تحليل الأداء الزمني</h3>
                                    </div>
                                    <div className="h-72 w-full"><canvas ref={trendChartRef}></canvas></div>
                                </div>
                                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center">
                                    <h3 className="font-bold text-gray-800 text-lg w-full text-right mb-4">توزيع التقييمات</h3>
                                    <div className="h-56 w-full relative">
                                        <canvas ref={distributionChartRef}></canvas>
                                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                            <span className="text-3xl font-bold text-gray-800">{stats.avg}</span>
                                            <span className="text-xs text-gray-400">Avg Score</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'structure' && (
                        <div className="animate-fade-in-up">
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                                    <span className="material-icons text-purple-600">account_tree</span>
                                    الهيكل التنظيمي للمشروع
                                </h2>
                                <div className="text-sm text-gray-500 bg-white px-3 py-1 rounded shadow-sm">
                                    {currentProject.name}
                                </div>
                            </div>
                            <div className="overflow-x-auto pb-4">
                                <div className="min-w-[800px] flex justify-center">
                                    {renderOrgChart()}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ... [Other tabs omitted for brevity but presumed present] ... */}
                    {activeTab === 'teams' && (
                        <div className="grid grid-cols-1 gap-6 animate-fade-in-up">
                            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                                <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
                                    <div>
                                        <h2 className="text-lg font-bold text-gray-800">إدارة المستخدمين (User Management)</h2>
                                        <p className="text-xs text-gray-500">عرض، إنشاء، وتعديل المدراء والمشرفين.</p>
                                    </div>
                                    <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                                        {/* Role Filter */}
                                        <div className="relative">
                                            <select
                                                className="pl-8 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-bold text-gray-700 outline-none focus:ring-2 focus:ring-primary appearance-none"
                                                value={userRoleFilter}
                                                onChange={(e) => setUserRoleFilter(e.target.value as any)}
                                            >
                                                <option value="all">كل الأدوار</option>
                                                <option value="project_manager">مدراء مشاريع</option>
                                                <option value="supervisor">مشرفين</option>
                                                <option value="it_specialist">أخصائيين IT</option>
                                                <option value="hr_admin">مسؤول الموارد البشرية</option>
                                            </select>
                                            <span className="material-icons absolute left-2 top-2 text-gray-400 text-sm pointer-events-none">filter_list</span>
                                        </div>

                                        {/* Search */}
                                        <div className="relative">
                                            <input
                                                type="text"
                                                placeholder="بحث بالاسم..."
                                                className="pl-8 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-primary w-full sm:w-48"
                                                value={userSearchTerm}
                                                onChange={(e) => setUserSearchTerm(e.target.value)}
                                            />
                                            <span className="material-icons absolute left-2 top-2 text-gray-400 text-sm">search</span>
                                        </div>

                                        <button onClick={() => { setNewSupervisor({ ...newSupervisor, role: 'supervisor' }); startEditUser({} as any); }} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 shadow-sm whitespace-nowrap">
                                            <span className="material-icons text-sm">add</span> إضافة مستخدم
                                        </button>
                                    </div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-right text-sm">
                                        <thead className="bg-gray-50 text-gray-500 font-bold uppercase rounded-lg">
                                            <tr>
                                                <th className="p-4 rounded-r-lg">الاسم</th>
                                                <th className="p-4">الدور</th>
                                                <th className="p-4">الفريق / التقارير</th>
                                                {currentProject.id === 'all' && <th className="p-4">المشروع</th>}
                                                <th className="p-4 text-center rounded-l-lg">إجراء</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {supervisors.concat(projectManagers).concat(itSpecialists).concat(hrAdmins)
                                                .filter(u => {
                                                    // FIXED: NULL SAFETY CHECK FOR USER NAME
                                                    const userName = u.name || '';
                                                    const matchesSearch = userName.toLowerCase().includes(userSearchTerm.toLowerCase());
                                                    const matchesRole = userRoleFilter === 'all' || u.role === userRoleFilter;
                                                    return matchesSearch && matchesRole;
                                                })
                                                .sort((a, b) => a.role.localeCompare(b.role))
                                                .map(u => (
                                                    <tr key={u.id} className="hover:bg-gray-50">
                                                        <td className="p-4 font-bold text-gray-800 flex items-center gap-2">
                                                            <div className="relative">
                                                                <div className={`h-3 w-3 rounded-full ${onlineUsers.has(u.id) ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`}></div>
                                                            </div>
                                                            {u.name || <span className="text-gray-400 italic">Unknown</span>}
                                                        </td>
                                                        <td className="p-4">
                                                            <span className={`px-2 py-1 rounded text-xs ${u.role === 'project_manager' ? 'bg-purple-100 text-purple-700' : u.role === 'it_specialist' ? 'bg-cyan-100 text-cyan-700' : u.role === 'hr_admin' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                                                                {u.role === 'project_manager' ? 'مدير مشروع' : u.role === 'it_specialist' ? 'أخصائي IT' : u.role === 'hr_admin' ? 'مسؤول الموارد البشرية' : 'مشرف'}
                                                            </span>
                                                        </td>
                                                        <td className="p-4 text-gray-600">
                                                            {u.role === 'supervisor' ? (
                                                                <div className="flex flex-col">
                                                                    <span className="font-bold">{u.teamName}</span>
                                                                    {u.reportsTo && <span className="text-xs text-gray-400">يدير بواسطة: {allProjectManagers.find(pm => pm.id === u.reportsTo)?.name || 'غير محدد'}</span>}
                                                                </div>
                                                            ) : (
                                                                <span className="text-gray-400">-</span>
                                                            )}
                                                        </td>
                                                        {currentProject.id === 'all' && (
                                                            <td className="p-4 text-gray-600">
                                                                {projects.find(p => p.id === u.projectId)?.name || 'غير محدد (Global)'}
                                                            </td>
                                                        )}
                                                        <td className="p-4 flex justify-center gap-2">
                                                            <button onClick={() => startEditUser(u)} className={`p-2 rounded text-orange-500 bg-orange-50 hover:bg-orange-100`} title="تعديل"><span className="material-icons text-sm">edit</span></button>
                                                            <button onClick={() => handleDeleteSupervisor(u.id)} className={`p-2 rounded text-red-500 bg-red-50 hover:bg-red-100`} title="حذف"><span className="material-icons text-sm">delete</span></button>
                                                        </td>
                                                    </tr>
                                                ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ... [Operators Tab] ... */}
                    {(activeTab === 'operators' || activeTab === 'upload') && (
                        <div className="space-y-6 animate-fade-in-up">
                            {/* ... [Upload UI] ... */}
                            {/* List Section */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                                <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
                                    <h2 className="text-lg font-bold text-gray-800">قائمة الموظفين ({operators.length})</h2>
                                    <div className="flex gap-2 w-full md:w-auto">
                                        <input type="text" placeholder="بحث بالاسم..." className="flex-1 border p-2 rounded-lg bg-gray-50 outline-none focus:ring-1 focus:ring-primary" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                                        {selectedIds.size > 0 && currentProject.id !== 'all' && (
                                            <button onClick={handleBulkDelete} className="px-4 bg-red-50 text-red-600 rounded-lg font-bold text-sm">حذف</button>
                                        )}
                                    </div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-right text-sm">
                                        <thead className="bg-gray-50 text-gray-500 font-bold uppercase rounded-lg">
                                            <tr>
                                                <th className="p-4 w-10 text-center"><input type="checkbox" disabled={currentProject.id === 'all'} className="w-4 h-4 rounded text-primary" onChange={() => toggleSelectAll(operators.filter(o => o.name.includes(searchTerm)))} /></th>
                                                <th className="p-4">الاسم</th>
                                                <th className="p-4">المشرف</th>
                                                <th className="p-4">الهاتف</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {operators.filter(o => o.name.includes(searchTerm)).map(op => (
                                                <tr key={op.id} className={`hover:bg-gray-50 ${selectedIds.has(op.id) ? 'bg-blue-50' : ''}`}>
                                                    <td className="p-4 text-center"><input type="checkbox" disabled={currentProject.id === 'all'} className="w-4 h-4 rounded text-primary" checked={selectedIds.has(op.id)} onChange={() => toggleSelect(op.id)} /></td>
                                                    <td className="p-4 font-bold text-gray-800">{op.name}</td>
                                                    <td className="p-4 text-gray-600">{supervisors.find(s => s.id === op.supervisorId)?.name}</td>
                                                    <td className="p-4 font-mono text-gray-500">{op.phone}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
        </>
    );
};

export default AdminDashboard;
