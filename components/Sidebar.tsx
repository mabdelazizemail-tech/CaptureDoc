import React, { useMemo } from 'react';
import { User, Role } from '../services/types';

interface SidebarProps {
  user: User;
  activePage: string;
  onNavigate: (page: string) => void;
  onLogout: () => void;
  isOpen: boolean;
  toggleSidebar: () => void;
}

interface MenuItem {
  id: string;
  label: string;
  icon: string;
}

const Sidebar: React.FC<SidebarProps> = ({ user, activePage, onNavigate, onLogout, isOpen, toggleSidebar }) => {

  const menuItems = useMemo<MenuItem[]>(() => {
    const commonAdminItems: MenuItem[] = [
      { id: 'dashboard', label: 'لوحة التحكم', icon: 'dashboard' },
      { id: 'reports', label: 'التحليلات', icon: 'analytics' },
      { id: 'hr', label: 'الموارد البشرية', icon: 'badge' },
    ];

    const operationalItems: MenuItem[] = [
      { id: 'structure', label: 'الهيكل التنظيمي', icon: 'account_tree' },
      { id: 'approvals', label: 'المراجعات', icon: 'fact_check' },
      { id: 'history', label: 'سجل التقييمات', icon: 'manage_search' },
      { id: 'requests', label: 'الطلبات', icon: 'notifications_active' },
      { id: 'teams', label: 'قائمة المستخدمين', icon: 'groups' },
      { id: 'operators', label: 'قائمة الموظفين', icon: 'badge' },
      { id: 'assets', label: 'الأصول', icon: 'precision_manufacturing' },
      { id: 'tickets', label: 'الدعم الفني', icon: 'confirmation_number' }, // Added Ticket System
      { id: 'upload', label: 'استيراد بيانات', icon: 'upload_file' },
    ];

    switch (user.role) {
      case 'super_admin':
      case 'power_admin':
        return [
          ...commonAdminItems,
          { id: 'project-management', label: 'إدارة الموارد', icon: 'manage_accounts' },
          ...operationalItems,
          { id: 'health-check', label: 'فحص النظام', icon: 'monitor_heart' },
          { id: 'debug', label: 'DB Debugger', icon: 'pest_control' }
        ];
      case 'project_manager':
        return [
          { id: 'sites', label: 'نظرة عامة للمواقع', icon: 'grid_view' },
          ...commonAdminItems,
          ...operationalItems,
        ];
      case 'supervisor':
        return [
          { id: 'dashboard', label: 'فريقي', icon: 'people' },
          { id: 'kpi', label: 'التقييم', icon: 'assignment' },
          { id: 'assets', label: 'الأصول', icon: 'precision_manufacturing' },
          { id: 'tickets', label: 'الدعم الفني', icon: 'confirmation_number' }, // Added Ticket System
        ];
      case 'it_specialist':
        return [
          { id: 'assets', label: 'إدارة الأصول', icon: 'inventory' },
          { id: 'tickets', label: 'الدعم الفني', icon: 'confirmation_number' },
          { id: 'reports', label: 'التقارير', icon: 'analytics' }
        ];
      default:
        return [];
    }
  }, [user.role]);

  const roleLabel = {
    'super_admin': 'مدير النظام (Super)',
    'power_admin': 'مدير تنفيذي (Power)',
    'project_manager': 'مدير المشروع',
    'supervisor': 'مشرف فريق',
    'it_specialist': 'رئيس الدعم الفني'
  }[user.role] || 'مستخدم';

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-20 md:hidden"
          onClick={toggleSidebar}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`
          fixed top-0 right-0 h-full w-64 bg-[#232b3e] text-gray-300 z-30 transition-transform duration-300 ease-in-out flex flex-col
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
          md:translate-x-0 md:static border-l border-gray-800
        `}
      >
        <div className="h-20 flex flex-col justify-center px-6 bg-[#1b2130] shadow-sm">
          <div className="flex items-center gap-2">
            <span className="material-icons text-primary text-2xl">bar_chart</span>
            <h1 className="text-xl font-bold text-white tracking-wide">Capture Flow</h1>
          </div>
          <div className="text-[10px] text-gray-500 font-medium pr-8 -mt-0.5 tracking-wider">(Powered by Capture Doc)</div>
        </div>

        <div className="px-6 py-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-white font-bold uppercase">
              {user.name.charAt(0)}
            </div>
            <div>
              <p className="text-sm font-bold text-white leading-tight">{user.name}</p>
              <p className="text-xs text-gray-400">{roleLabel}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-1 overflow-y-auto custom-scrollbar">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onNavigate(item.id);
                if (window.innerWidth < 768) toggleSidebar();
              }}
              className={`
                w-full flex items-center space-x-reverse space-x-3 px-4 py-3 rounded-md transition-all duration-200
                ${activePage === item.id
                  ? 'bg-primary text-white shadow-lg shadow-blue-900/50 font-bold'
                  : 'hover:bg-[#2d3648] hover:text-white text-gray-400'}
              `}
            >
              <span className={`material-icons ${activePage === item.id ? 'text-white' : 'text-gray-500'}`}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 bg-[#1b2130]">
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center space-x-reverse space-x-2 px-4 py-2 text-red-400 hover:bg-red-500/10 rounded-md transition-colors text-sm font-medium"
          >
            <span className="material-icons text-lg">logout</span>
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;