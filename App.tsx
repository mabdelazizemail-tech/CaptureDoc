import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import SupervisorDashboard from './pages/SupervisorDashboard';
import AssetDashboard from './pages/AssetDashboard';
import TicketSystem from './pages/TicketSystem';
import HealthCheck from './pages/HealthCheck';
import DatabaseDebugger from './pages/DatabaseDebugger';
import HRDashboard from './pages/HR/HRDashboard';
import ProjectManagementDashboard from './pages/ProjectManagementDashboard';
import CollectionsDashboard from './pages/CollectionsDashboard';
import PayablesDashboard from './pages/PayablesDashboard';
import JournalEntriesDashboard from './pages/JournalEntriesDashboard';
import Sidebar from './components/Sidebar';
import { User } from './services/types';
import { supabase } from './services/supabaseClient';
import CRMModule from './pages/crm';

const FINANCE_ONLY_USERS = ['taher.mohamed@pbkadvisory.com'];
const isFinanceOnly = (u: User | null) =>
  !!u && (
    FINANCE_ONLY_USERS.includes((u.username || '').toLowerCase()) ||
    FINANCE_ONLY_USERS.includes((u.email || '').toLowerCase())
  );

const CRM_ONLY_USERS = ['menna.youssif@capture-doc.com', 'hossam.yazal@capture-doc.com'];
const isCRMOnly = (u: User | null) =>
  !!u && (
    CRM_ONLY_USERS.includes((u.username || '').toLowerCase()) ||
    CRM_ONLY_USERS.includes((u.email || '').toLowerCase())
  );

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'لوحة التحكم',
  '/reports': 'التحليلات والتقارير',
  '/requests': 'الطلبات والإشعارات',
  '/teams': 'إدارة الفرق',
  '/operators': 'إدارة الموظفين',
  '/upload': 'استيراد بيانات',
  '/kpi': 'تقييم الأداء اليومي',
  '/project-management': 'إدارة المشاريع (Project Management)',
  '/structure': 'الهيكل التنظيمي',
  '/approvals': 'المراجعات',
  '/history': 'سجل التقييمات',
  '/sites': 'نظرة عامة للمواقع',
  '/assets': 'إدارة الأصول والصيانة',
  '/tickets': 'نظام التذاكر والدعم الفني',
  '/hr': 'إدارة الموارد البشرية (HR)',
  '/collections': 'التحصيلات',
  '/payables': 'المدفوعات — إدارة حسابات الموردين',
  '/journal-entries': 'القيود المحاسبية — دفتر اليومية العام',
};

function getDefaultRoute(user: User): string {
  if (
    CRM_ONLY_USERS.includes((user.username || '').toLowerCase()) ||
    CRM_ONLY_USERS.includes((user.email || '').toLowerCase())
  ) return '/crm';
  if (
    FINANCE_ONLY_USERS.includes((user.username || '').toLowerCase()) ||
    FINANCE_ONLY_USERS.includes((user.email || '').toLowerCase())
  ) return '/collections';
  if (user.role === 'it_specialist') return '/assets';
  if (user.role === 'hr_admin') return '/hr';
  const isAdmin = user.role === 'super_admin' || user.role === 'power_admin' || user.role === 'project_manager';
  return isAdmin ? '/reports' : '/dashboard';
}

const AppShell: React.FC<{
  user: User;
  onlineUsers: Set<string>;
  onLogout: () => void;
}> = ({ user, onlineUsers, onLogout }) => {
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const pathname = location.pathname;
  const pageTitle = PAGE_TITLES[pathname];
  const isHiddenPage = pathname === '/health-check' || pathname === '/debug';
  const isAdmin = user.role === 'super_admin' || user.role === 'power_admin' || user.role === 'project_manager' || user.role === 'hr_admin';
  const finOnly = isFinanceOnly(user);

  const adminDashEl = <AdminDashboard currentUser={user} onlineUsers={onlineUsers} />;

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar
        user={user}
        onLogout={onLogout}
        isOpen={isSidebarOpen}
        toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
      />

      <div className="flex-1 flex flex-col h-full overflow-hidden w-full relative">
        <header className="bg-white shadow-sm px-4 py-3 flex items-center justify-between md:hidden z-10 sticky top-0">
          <div className="flex flex-col">
            <h1 className="text-xl font-bold text-primary">Capture Flow</h1>
            <span className="text-[10px] text-gray-500 font-bold">(Powered by Capture Doc)</span>
          </div>
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 -ml-2 rounded-lg hover:bg-gray-100 text-gray-600 active:bg-gray-200 transition-colors"
            aria-label="Open menu"
          >
            <span className="material-icons text-2xl">menu</span>
          </button>
        </header>

        <main className="flex-1 overflow-y-auto bg-[#f0f3f6]">
          <div className="max-w-7xl mx-auto p-4 md:p-8 pb-20 md:pb-8">
            {!isHiddenPage && pageTitle && (
              <div className="flex items-center justify-between mb-6 md:mb-8">
                <div>
                  <h1 className="text-2xl font-bold text-gray-800">{pageTitle}</h1>
                  <p className="text-gray-500 text-sm mt-1">
                    {new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </p>
                </div>
              </div>
            )}

            <Routes>
              {/* Admin sub-views rendered by AdminDashboard */}
              <Route path="/dashboard" element={
                finOnly ? <CollectionsDashboard user={user} /> :
                isAdmin ? adminDashEl :
                <SupervisorDashboard user={user} />
              } />
              <Route path="/reports" element={
                finOnly ? <CollectionsDashboard user={user} /> :
                isAdmin ? adminDashEl :
                <SupervisorDashboard user={user} />
              } />
              <Route path="/structure" element={adminDashEl} />
              <Route path="/teams" element={adminDashEl} />
              <Route path="/operators" element={adminDashEl} />
              <Route path="/upload" element={adminDashEl} />
              <Route path="/approvals" element={adminDashEl} />
              <Route path="/history" element={adminDashEl} />
              <Route path="/requests" element={adminDashEl} />
              <Route path="/sites" element={adminDashEl} />

              {/* Supervisor sub-view */}
              <Route path="/kpi" element={<SupervisorDashboard user={user} />} />

              {/* Standalone pages */}
              <Route path="/project-management" element={<ProjectManagementDashboard user={user} />} />
              <Route path="/pm-dashboard" element={<Navigate to="/project-management" replace />} />
              <Route path="/assets" element={<AssetDashboard user={user} />} />
              <Route path="/tickets" element={<TicketSystem user={user} />} />
              <Route path="/hr" element={<HRDashboard user={user} />} />
              <Route path="/collections" element={<CollectionsDashboard user={user} />} />
              <Route path="/payables" element={<PayablesDashboard user={user} />} />
              <Route path="/journal-entries" element={<JournalEntriesDashboard user={user} />} />
              <Route path="/health-check" element={<HealthCheck user={user} />} />
              <Route path="/debug" element={<DatabaseDebugger />} />
              
              {/* Root and catch-all */}
              <Route path="*" element={<Navigate to={getDefaultRoute(user)} replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const navigate = useNavigate();
  const location = useLocation();

  // Redirect to login on logout
  useEffect(() => {
    if (!user && location.pathname !== '/login') {
      navigate('/login', { replace: true });
    }
  }, [user]);

  // Presence Tracking
  useEffect(() => {
    if (user) {
      const channel = supabase.channel('online-users');
      channel
        .on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState();
          const onlineIds = new Set<string>();
          Object.values(state).forEach((presences: any) => {
            presences.forEach((p: any) => {
              if (p.user_id) onlineIds.add(p.user_id);
            });
          });
          setOnlineUsers(onlineIds);
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await channel.track({
              user_id: user.id,
              role: user.role,
              online_at: new Date().toISOString()
            });
          }
        });

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user]);

  const handleLogin = (loggedInUser: User) => {
    setUser(loggedInUser);
  };

  const handleLogout = () => {
    localStorage.removeItem('selected_workspace');
    setUser(null);
    setOnlineUsers(new Set());
  };

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  const selectedWorkspace = localStorage.getItem('selected_workspace');
  const isCrmOnly = isCRMOnly(user);

  if (location.pathname.startsWith('/crm') || selectedWorkspace === 'crm' || isCrmOnly) {
    if (!location.pathname.startsWith('/crm')) {
      return <Navigate to="/crm" replace />;
    }
    return <CRMModule user={user} onLogout={handleLogout} />;
  }

  return <AppShell user={user} onlineUsers={onlineUsers} onLogout={handleLogout} />;
};

export default App;
