import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, Link } from 'react-router-dom';
import {
  LayoutGrid, Users, Contact2, Building2, Handshake,
  CalendarCheck, ChevronLeft, Sparkles,
  Bell, Plus, Search, ChevronDown, LogOut, ArrowLeft, X,
} from 'lucide-react';
import './crm.css';
import { User } from '../../services/types';

interface CRMLayoutProps {
  user: User;
  onLogout: () => void;
}

const nav = [
  { label: 'Home', to: '/crm', icon: LayoutGrid, end: true },
  { label: 'Leads', to: '/crm/leads', icon: Users },
  { label: 'Contacts', to: '/crm/contacts', icon: Contact2 },
  { label: 'Accounts', to: '/crm/accounts', icon: Building2 },
  { label: 'Deals', to: '/crm/deals', icon: Handshake },
  { label: 'Activities', to: '/crm/tasks', icon: CalendarCheck },
];

/* ─── Sidebar ─────────────────────────────────────────────────── */
function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside
      className={`sticky top-0 h-screen shrink-0 bg-[var(--sidebar)] text-[var(--sidebar-foreground)] border-r border-[var(--sidebar-border)] flex flex-col transition-[width] duration-200 ${collapsed ? 'w-16' : 'w-60'}`}
    >
      {/* Logo */}
      <div className="h-14 flex items-center gap-2 px-4 border-b border-[var(--sidebar-border)]">
        <div className="size-8 rounded-md bg-[var(--primary)] flex items-center justify-center shrink-0">
          <Sparkles className="size-4 text-white" aria-hidden="true" />
        </div>
        {!collapsed && (
          <div className="font-semibold tracking-tight text-white text-[15px]">
            CaptureCRM
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 h-9 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)] shadow-sm'
                    : 'text-[color-mix(in_oklab,var(--sidebar-foreground)_80%,transparent)] hover:bg-white/5 hover:text-white'
                }`
              }
            >
              <Icon className="size-[18px] shrink-0" aria-hidden="true" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        className="h-10 border-t border-[var(--sidebar-border)] text-xs text-[color-mix(in_oklab,var(--sidebar-foreground)_70%,transparent)] hover:text-white hover:bg-white/5 flex items-center justify-center gap-2"
      >
        <ChevronLeft className={`size-4 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  );
}

/* ─── Header ──────────────────────────────────────────────────── */
function Header({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const displayName = user.name || user.username || 'User';
  const initials = displayName.split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === 'Escape') {
        if (searchOpen) {
          setSearchOpen(false);
          e.stopPropagation();
        } else if (quickAddOpen) {
          setQuickAddOpen(false);
          e.stopPropagation();
        }
      }
    };

    const handleSearchTrigger = () => {
      setSearchOpen(true);
    };

    window.addEventListener('keydown', handler);
    window.addEventListener('crm-search-trigger', handleSearchTrigger);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('crm-search-trigger', handleSearchTrigger);
    };
  }, [searchOpen, quickAddOpen]);


  return (
    <>
      <header className="sticky top-0 z-30 h-14 bg-white border-b border-[var(--border)] flex items-center gap-4 px-6">
        {/* Search trigger */}
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex-1 max-w-2xl mx-auto relative text-left group"
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[var(--muted-foreground)]" aria-hidden="true" />
          <span className="block w-full h-9 pl-9 pr-20 rounded-md border border-[var(--border)] bg-[color-mix(in_oklab,var(--secondary)_40%,transparent)] text-sm text-[var(--muted-foreground)] leading-9 group-hover:bg-white group-hover:border-[color-mix(in_oklab,var(--ring)_40%,transparent)] transition-colors">
            Search leads, contacts, deals…
          </span>
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium text-[var(--muted-foreground)] border border-[var(--border)] rounded px-1.5 py-0.5 bg-white">
            Ctrl + K
          </kbd>
        </button>

        <div className="flex items-center gap-2">
          {/* Quick Add */}
          <button
            onClick={() => setQuickAddOpen(true)}
            className="inline-flex items-center justify-center cursor-pointer transition-colors bg-[var(--primary)] text-white hover:bg-[color-mix(in_oklab,var(--primary)_90%,transparent)] rounded-md px-3 text-xs h-9 gap-1.5 font-medium"
          >
            <Plus className="size-4" aria-hidden="true" />
            Quick Add
            <ChevronDown className="size-3.5 opacity-80" aria-hidden="true" />
          </button>

          {/* Notifications */}
          <button className="inline-flex items-center justify-center rounded-md cursor-pointer transition-colors hover:bg-[var(--accent)] size-9 relative text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
            <Bell className="size-[18px]" aria-hidden="true" />
            <span className="absolute top-2 right-2 size-1.5 rounded-full bg-[var(--destructive)]" />
          </button>

          {/* User avatar dropdown */}
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              type="button"
              className="flex items-center gap-2 pl-1 pr-2 h-9 rounded-md hover:bg-[var(--secondary)] transition-colors"
            >
              <span className="relative flex shrink-0 overflow-hidden rounded-full size-7">
                <span className="flex h-full w-full items-center justify-center rounded-full bg-[var(--primary)] text-white text-xs font-semibold">
                  {initials}
                </span>
              </span>
              <ChevronDown className="size-3.5 text-[var(--muted-foreground)]" aria-hidden="true" />
            </button>

            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                <div className="absolute right-0 mt-2 w-56 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-lg py-1 z-20">
                  <div className="px-4 py-2 border-b border-[var(--border)]">
                    <p className="text-sm font-semibold text-[var(--foreground)]">{displayName}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">{user.role}</p>
                  </div>
                  <Link
                    to="/"
                    onClick={() => { setUserMenuOpen(false); localStorage.setItem('selected_workspace', 'erp'); }}
                    className="flex items-center px-4 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--secondary)] gap-2 transition-colors"
                  >
                    <ArrowLeft className="size-4" />
                    Back to CaptureFlow
                  </Link>
                  <button
                    onClick={() => { setUserMenuOpen(false); onLogout(); }}
                    className="flex items-center w-full text-left px-4 py-2 text-sm text-[var(--destructive)] hover:bg-[color-mix(in_oklab,var(--destructive)_8%,transparent)] gap-2 transition-colors"
                  >
                    <LogOut className="size-4" />
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Global Search Modal */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/50"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-[var(--card)] rounded-xl shadow-xl overflow-hidden border border-[var(--border)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
              <Search className="size-4 shrink-0 text-[var(--muted-foreground)]" />
              <input
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                placeholder="Search leads, contacts, deals…"
                className="flex-1 text-sm bg-transparent outline-none text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
              />

              <button onClick={() => setSearchOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                <X className="size-4" />
              </button>
            </div>
            <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">
              Type to search across your CRM records…
            </div>
          </div>
        </div>
      )}

      {/* Quick Add Modal */}
      {quickAddOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setQuickAddOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-[var(--card)] rounded-xl shadow-xl border border-[var(--border)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-[var(--foreground)] mb-4">Quick Add</h2>
            <div className="grid grid-cols-2 gap-3">
              <Link
                to="/crm/leads"
                onClick={() => setQuickAddOpen(false)}
                className="flex flex-col items-center gap-2 p-4 rounded-lg border border-[var(--border)] hover:bg-[var(--secondary)] transition-colors text-sm font-medium text-[var(--foreground)]"
              >
                <Users className="size-5 text-[var(--primary)]" />
                Lead
              </Link>
              <Link
                to="/crm/deals"
                onClick={() => setQuickAddOpen(false)}
                className="flex flex-col items-center gap-2 p-4 rounded-lg border border-[var(--border)] hover:bg-[var(--secondary)] transition-colors text-sm font-medium text-[var(--foreground)]"
              >
                <Handshake className="size-5 text-[var(--primary)]" />
                Deal
              </Link>
              <Link
                to="/crm/contacts"
                onClick={() => setQuickAddOpen(false)}
                className="flex flex-col items-center gap-2 p-4 rounded-lg border border-[var(--border)] hover:bg-[var(--secondary)] transition-colors text-sm font-medium text-[var(--foreground)]"
              >
                <Contact2 className="size-5 text-[var(--primary)]" />
                Contact
              </Link>
              <Link
                to="/crm/accounts"
                onClick={() => setQuickAddOpen(false)}
                className="flex flex-col items-center gap-2 p-4 rounded-lg border border-[var(--border)] hover:bg-[var(--secondary)] transition-colors text-sm font-medium text-[var(--foreground)]"
              >
                <Building2 className="size-5 text-[var(--primary)]" />
                Account
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function CRMLayout({ user, onLogout }: CRMLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl) {
        const tagName = activeEl.tagName.toLowerCase();
        if (
          tagName === 'input' ||
          tagName === 'textarea' ||
          tagName === 'select' ||
          activeEl.getAttribute('contenteditable') === 'true'
        ) {
          return;
        }
      }

      const key = e.key.toLowerCase();
      if (key === '/') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('crm-search-trigger'));
      } else if (key === 'n') {
        e.preventDefault();
        navigate('/crm/leads?add=true');
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [navigate]);


  return (
    <div dir="ltr" className="min-h-screen w-full flex bg-[var(--background)] crm-scope">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header user={user} onLogout={onLogout} />
        <main className="flex-1 px-6 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
