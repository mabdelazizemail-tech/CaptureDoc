import React, { useState, useEffect } from 'react';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import SupervisorDashboard from './pages/SupervisorDashboard';
import AssetDashboard from './pages/AssetDashboard';
import TicketSystem from './pages/TicketSystem';
import HealthCheck from './pages/HealthCheck';
import DatabaseDebugger from './pages/DatabaseDebugger';
import HRDashboard from './pages/HR/HRDashboard';
import Sidebar from './components/Sidebar';
import { User } from './services/types';
import { StorageService } from './services/storage';
import { supabase } from './services/supabaseClient';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [activePage, setActivePage] = useState('reports');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Lifted state for online users presence
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Check for hidden route via query params
    const params = new URLSearchParams(window.location.search);
    if (params.get('page') === 'health-check') {
      setActivePage('health-check');
    } else if (params.get('page') === 'debug') {
      setActivePage('debug');
    }
  }, []);

  // Presence Tracking & Listening (Centralized)
  useEffect(() => {
    if (user) {
      const channel = supabase.channel('online-users');
      channel
        .on('presence', { event: 'sync' }, () => {
          // Synchronize the online users list
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
    console.log("App: handleLogin called with user:", loggedInUser);
    setUser(loggedInUser);

    // Check route again on login, or default to role-based view
    const params = new URLSearchParams(window.location.search);
    if (params.get('page') === 'health-check') {
      setActivePage('health-check');
    } else if (params.get('page') === 'debug') {
      setActivePage('debug');
    } else {
      if (loggedInUser.role === 'it_specialist') {
        setActivePage('assets');
      } else if (loggedInUser.role === 'hr_admin') {
        setActivePage('hr');
      } else {
        const isAdmin = loggedInUser.role === 'super_admin' || loggedInUser.role === 'power_admin' || loggedInUser.role === 'project_manager';
        setActivePage(isAdmin ? 'reports' : 'dashboard');
      }
    }
  };

  const handleLogout = () => {
    setUser(null);
    setActivePage('reports');
    setOnlineUsers(new Set()); // Clear presence on logout
  };

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  const isAdmin = user.role === 'super_admin' || user.role === 'power_admin' || user.role === 'project_manager' || user.role === 'hr_admin';

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar
        user={user}
        activePage={activePage}
        onNavigate={setActivePage}
        onLogout={handleLogout}
        isOpen={isSidebarOpen}
        toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full overflow-hidden w-full relative">
        {/* Header (Mobile Only) */}
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

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto bg-[#f0f3f6]">
          <div className="max-w-7xl mx-auto p-4 md:p-8 pb-20 md:pb-8">
            {activePage !== 'health-check' && activePage !== 'debug' && (
              <div className="flex items-center justify-between mb-6 md:mb-8">
                <div>
                  <h1 className="text-2xl font-bold text-gray-800">
                    {activePage === 'dashboard' && 'لوحة التحكم'}
                    {activePage === 'reports' && 'التحليلات والتقارير'}
                    {activePage === 'requests' && 'الطلبات والإشعارات'}
                    {activePage === 'teams' && 'إدارة الفرق'}
                    {activePage === 'operators' && 'إدارة الموظفين'}
                    {activePage === 'upload' && 'استيراد بيانات'}
                    {activePage === 'kpi' && 'تقييم الأداء اليومي'}
                    {activePage === 'project-management' && 'إدارة الموارد'}
                    {activePage === 'structure' && 'الهيكل التنظيمي'}
                    {activePage === 'approvals' && 'المراجعات'}
                    {activePage === 'history' && 'سجل التقييمات'}
                    {activePage === 'sites' && 'نظرة عامة للمواقع'}
                    {activePage === 'assets' && 'إدارة الأصول والصيانة'}
                    {activePage === 'tickets' && 'نظام التذاكر والدعم الفني'}
                    {activePage === 'hr' && 'إدارة الموارد البشرية (HR)'}
                  </h1>
                  <p className="text-gray-500 text-sm mt-1">
                    {new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </p>
                </div>
              </div>
            )}

            {activePage === 'health-check' ? (
              <HealthCheck user={user} />
            ) : activePage === 'debug' ? (
              <DatabaseDebugger />
            ) : activePage === 'assets' ? (
              <AssetDashboard user={user} />
            ) : activePage === 'tickets' ? (
              <TicketSystem user={user} />
            ) : activePage === 'hr' ? (
              <HRDashboard user={user} />
            ) : isAdmin ? (
              <AdminDashboard activeTab={activePage} currentUser={user} onNavigate={setActivePage} onlineUsers={onlineUsers} />
            ) : (
              <SupervisorDashboard user={user} activeTab={activePage} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;