import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Briefcase, DollarSign, UserPlus, SquareCheckBig,
  ArrowUpRight, ArrowDownRight, Calendar, Ellipsis,
} from 'lucide-react';
import { getLeads, getDeals, getTasks, getContacts, Lead, Deal, Task } from '../../services/crmService';
import { User } from '../../services/types';

interface Props {
  user: User;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}

function fmtCount(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// Days since a date string
function daysSince(dateStr?: string) {
  if (!dateStr) return 999;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

const priorityClass: Record<string, string> = {
  High: 'bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] text-[var(--destructive)] border-[color-mix(in_oklab,var(--destructive)_20%,transparent)]',
  Med:  'bg-[color-mix(in_oklab,var(--warning)_15%,transparent)] text-[var(--warning-foreground)] border-[color-mix(in_oklab,var(--warning)_30%,transparent)]',
  Low:  'bg-[var(--muted)] text-[var(--muted-foreground)] border-[var(--border)]',
};

function taskPriority(task: Task): 'High' | 'Med' | 'Low' {
  if (!task.due_date) return 'Low';
  const days = Math.floor((new Date(task.due_date).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return 'High';
  if (days <= 2) return 'Med';
  return 'Low';
}

function formatTaskTime(task: Task): string {
  if (!task.due_date) return 'No due date';
  const d = new Date(task.due_date);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const taskDay = new Date(d); taskDay.setHours(0, 0, 0, 0);

  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  if (taskDay.getTime() === today.getTime()) return `Today · ${timeStr}`;
  if (taskDay.getTime() === tomorrow.getTime()) return `Tomorrow · ${timeStr}`;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Build 12-week revenue buckets from real deals
function buildRevenueChart(deals: Deal[]) {
  const now = new Date();
  const weeks: { won: number; total: number }[] = Array.from({ length: 12 }, () => ({ won: 0, total: 0 }));

  deals.forEach((d) => {
    const targetDate = d.close_date || d.created_at;
    if (!targetDate) return;
    const weeksAgo = Math.floor((now.getTime() - new Date(targetDate).getTime()) / (7 * 86_400_000));
    const idx = 11 - weeksAgo;
    if (idx < 0 || idx > 11) return;
    weeks[idx].total += d.value || 0;
    if (d.stage === 'Won') weeks[idx].won += d.value || 0;
  });

  return weeks;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function CRMDashboard({ user }: Props) {
  const [leads,  setLeads]   = useState<Lead[]>([]);
  const [deals,  setDeals]   = useState<Deal[]>([]);
  const [tasks,  setTasks]   = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getLeads(), getDeals(), getTasks()])
      .then(([l, d, t]) => {
        setLeads(l);
        setDeals(d);
        setTasks(t);
      })
      .finally(() => setLoading(false));
  }, []);

  // KPI calculations
  const openDeals     = deals.filter((d) => !['Won', 'Lost'].includes(d.stage)).length;
  const closedRevenue = deals.filter((d) => d.stage === 'Won').reduce((s, d) => s + (d.value || 0), 0);
  const newLeads      = leads.filter((l) => l.status === 'New').length;
  const pendingTasks  = tasks.filter((t) => t.status === 'Pending').length;

  // 30 days ago for "new leads" comparison
  const thirtyDaysAgo = Date.now() - 30 * 86_400_000;
  const recentLeads   = leads.filter((l) => l.created_at && new Date(l.created_at).getTime() > thirtyDaysAgo).length;

  // Upcoming tasks (Pending, sorted by due_date, max 6)
  const upcomingTasks = tasks
    .filter((t) => t.status === 'Pending')
    .slice(0, 6);

  // Chart data
  const chartWeeks = buildRevenueChart(deals);
  const maxVal = Math.max(...chartWeeks.map((w) => Math.max(w.won, w.total)), 1);
  const W = 560; const H = 260; const LEFT = 40;
  const xOf = (i: number) => LEFT + i * (W / 11);
  const yOf = (v: number) => H - Math.round((v / maxVal) * (H - 20));

  const wonPoints    = chartWeeks.map((w, i) => `${xOf(i)},${yOf(w.won)}`).join(' ');
  const totalPoints  = chartWeeks.map((w, i) => `${xOf(i)},${yOf(w.total)}`).join(' ');
  const areaPoints   = [
    ...chartWeeks.map((w, i) => `${xOf(i)},${yOf(w.won)}`),
    `${xOf(11)},${H}`, `${LEFT},${H}`,
  ].join(' ');

  const weekLabels = Array.from({ length: 12 }, (_, i) => `Wk ${i + 1}`);

  // Y-axis ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((p) => ({
    pct: p,
    label: maxVal > 0 ? fmt(maxVal * p) : '$0',
  }));

  const displayName = user.name || user.username || 'User';
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const kpis = [
    {
      label: 'Open Deals',
      value: loading ? '—' : fmtCount(openDeals),
      delta: null,
      sub: 'active in pipeline',
      icon: Briefcase,
      up: true,
    },
    {
      label: 'Closed Won (Revenue)',
      value: loading ? '—' : fmt(closedRevenue),
      delta: null,
      sub: 'total won revenue',
      icon: DollarSign,
      up: true,
    },
    {
      label: 'New Leads',
      value: loading ? '—' : fmtCount(newLeads),
      delta: recentLeads > 0 ? `+${recentLeads} in 30d` : null,
      sub: 'awaiting contact',
      icon: UserPlus,
      up: true,
    },
    {
      label: 'Tasks Due',
      value: loading ? '—' : fmtCount(pendingTasks),
      delta: null,
      sub: 'pending tasks',
      icon: SquareCheckBig,
      up: pendingTasks < 10,
    },
  ];

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">

      {/* Page header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome back, <span className="text-[var(--primary)]">{displayName}</span>
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1 flex items-center gap-1.5">
            <Calendar className="size-3.5" aria-hidden="true" />
            {today}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium cursor-pointer transition-colors border border-[var(--border)] bg-[var(--background)] shadow-sm hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)] rounded-md px-3 text-xs h-9">
            This Quarter
          </button>
          <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium cursor-pointer transition-colors bg-[var(--primary)] text-white hover:bg-[color-mix(in_oklab,var(--primary)_90%,transparent)] rounded-md px-3 text-xs h-9">
            New Report
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-xl border bg-[var(--card)] text-[var(--card-foreground)] border-[var(--border)] shadow-sm hover:shadow-md transition-shadow">
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide">
                    {k.label}
                  </div>
                  <div className="size-8 rounded-md bg-[var(--accent)] flex items-center justify-center">
                    <Icon className="size-4 text-[var(--primary)]" aria-hidden="true" />
                  </div>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  {loading ? (
                    <div className="h-7 w-20 rounded bg-[var(--muted)] animate-pulse" />
                  ) : (
                    <div className="text-2xl font-semibold tracking-tight">{k.value}</div>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  {k.delta && (
                    <span className={`inline-flex items-center gap-0.5 font-medium ${k.up ? 'text-[var(--success)]' : 'text-[var(--destructive)]'}`}>
                      {k.up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                      {k.delta}
                    </span>
                  )}
                  <span className="text-[var(--muted-foreground)]">{k.sub}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Chart + Tasks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Revenue Chart */}
        <div className="rounded-xl border bg-[var(--card)] text-[var(--card-foreground)] lg:col-span-2 border-[var(--border)] shadow-sm">
          <div className="p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold">Revenue This Quarter</h2>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  Closed-won revenue vs pipeline value, by week
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
                  <span className="size-2 rounded-full bg-[var(--primary)]" />
                  Won
                </span>
                <span className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
                  <span className="size-2 rounded-full bg-[color-mix(in_oklab,var(--muted-foreground)_40%,transparent)]" />
                  Pipeline
                </span>
              </div>
            </div>

            {loading ? (
              <div className="h-72 flex items-center justify-center">
                <div className="text-sm text-[var(--muted-foreground)] animate-pulse">Loading chart…</div>
              </div>
            ) : (
              <div className="h-72 w-full overflow-hidden">
                <svg viewBox={`0 0 ${W + LEFT + 20} ${H + 20}`} width="100%" height="100%" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="wonGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="oklch(0.546 0.215 262.9)" stopOpacity="0.35" />
                      <stop offset="100%" stopColor="oklch(0.546 0.215 262.9)" stopOpacity="0.02" />
                    </linearGradient>
                  </defs>

                  {/* Grid lines */}
                  {yTicks.map((t) => (
                    <g key={t.pct}>
                      <line
                        x1={LEFT} x2={W + LEFT}
                        y1={yOf(maxVal * t.pct)} y2={yOf(maxVal * t.pct)}
                        stroke="oklch(0.918 0.008 248)" strokeDasharray="3 3" strokeWidth="1"
                      />
                      <text
                        x={LEFT - 6} y={yOf(maxVal * t.pct)}
                        fontSize="9" fill="oklch(0.508 0.025 257)"
                        textAnchor="end" dominantBaseline="middle"
                      >
                        {t.label}
                      </text>
                    </g>
                  ))}

                  {/* Pipeline (dashed) */}
                  {deals.length > 0 && (
                    <polyline
                      points={totalPoints}
                      fill="none"
                      stroke="oklch(0.508 0.025 257)"
                      strokeWidth="1.5"
                      strokeDasharray="4 4"
                      opacity="0.6"
                    />
                  )}

                  {/* Won area fill */}
                  <polygon points={areaPoints} fill="url(#wonGrad)" />

                  {/* Won line */}
                  <polyline
                    points={wonPoints}
                    fill="none"
                    stroke="oklch(0.546 0.215 262.9)"
                    strokeWidth="2"
                  />

                  {/* X-axis labels */}
                  {weekLabels.map((w, i) => (
                    <text
                      key={w}
                      x={xOf(i)} y={H + 16}
                      fontSize="9" fill="oklch(0.508 0.025 257)"
                      textAnchor="middle"
                    >
                      {i % 2 === 0 ? w : ''}
                    </text>
                  ))}
                </svg>
              </div>
            )}

            {/* Empty state for no deals */}
            {!loading && deals.length === 0 && (
              <div className="text-center py-4 text-xs text-[var(--muted-foreground)]">
                No deal data yet.{' '}
                <Link to="/crm/deals" className="text-[var(--primary)] hover:underline">Create your first deal →</Link>
              </div>
            )}
          </div>
        </div>

        {/* Upcoming Tasks */}
        <div className="rounded-xl border bg-[var(--card)] text-[var(--card-foreground)] border-[var(--border)] shadow-sm">
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold">Upcoming Tasks</h2>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  {loading ? '…' : pendingTasks} tasks scheduled
                </p>
              </div>
              <button className="inline-flex items-center justify-center rounded-md cursor-pointer transition-colors hover:bg-[var(--accent)] size-8">
                <Ellipsis className="size-4" aria-hidden="true" />
              </button>
            </div>

            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 rounded-md bg-[var(--muted)] animate-pulse" />
                ))}
              </div>
            ) : upcomingTasks.length === 0 ? (
              <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">
                No pending tasks.{' '}
                <Link to="/crm/tasks" className="text-[var(--primary)] hover:underline">Add one →</Link>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border)] -mx-1">
                {upcomingTasks.map((t) => {
                  const prio = taskPriority(t);
                  return (
                    <li key={t.id} className="flex items-start gap-3 py-2.5 px-1 group hover:bg-[color-mix(in_oklab,var(--secondary)_50%,transparent)] rounded-md transition-colors">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked="false"
                        className="grid place-content-center h-4 w-4 shrink-0 rounded-sm border border-[var(--primary)] shadow cursor-pointer mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium leading-snug truncate">{t.title}</div>
                        <div className="text-xs text-[var(--muted-foreground)] mt-0.5">{formatTaskTime(t)}</div>
                      </div>
                      <div className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-[10px] font-medium shrink-0 ${priorityClass[prio]}`}>
                        {prio}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <Link
              to="/crm/tasks"
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium cursor-pointer transition-colors border border-[var(--border)] bg-[var(--background)] shadow-sm hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)] rounded-md px-3 text-xs w-full mt-4 h-9"
            >
              View all tasks
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}
