import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar, User as UserIcon, KanbanSquare, Check, Plus,
  X, AlertCircle, Trash2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import {
  getTasks, updateTaskStatus, createTask, deleteTask,
  getContacts, getDeals, Task, Contact, Deal,
} from '../../services/crmService';
import { User } from '../../services/types';

const PRIORITIES: Task['priority'][] = ['High', 'Medium', 'Low'];

const priorityBadge: Record<string, string> = {
  High:   'bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] text-[var(--destructive)] border-[color-mix(in_oklab,var(--destructive)_20%,transparent)]',
  Medium: 'bg-[color-mix(in_oklab,var(--warning)_15%,transparent)] text-[var(--warning-foreground)] border-[color-mix(in_oklab,var(--warning)_30%,transparent)]',
  Low:    'bg-[var(--muted)] text-[var(--muted-foreground)] border-[var(--border)]',
};

// B-010 fix: only red if actually overdue (past due date)
function dueDateBadge(dueDate?: string, done?: boolean) {
  if (done) return 'bg-[var(--muted)] text-[var(--muted-foreground)]';
  if (!dueDate) return 'bg-[var(--muted)] text-[var(--muted-foreground)]';
  const isOverdue = new Date(dueDate) < new Date();
  return isOverdue
    ? 'bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] text-[var(--destructive)]'
    : 'bg-[var(--accent)] text-[var(--accent-foreground)]';
}

const isSameDay = (d1: Date, d2: Date) =>
  d1.getFullYear() === d2.getFullYear() &&
  d1.getMonth() === d2.getMonth() &&
  d1.getDate() === d2.getDate();

const formatDateStr = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getLocalDateString = (dateStr?: string) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export default function CRMTasks({ user }: { user: User }) {
  const [tasks,    setTasks]    = useState<Task[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals,    setDeals]    = useState<Deal[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState<'All' | 'Pending' | 'Completed'>('All');

  // Calendar View states
  const [viewMode, setViewMode] = useState<'Table' | 'Calendar'>('Calendar');
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<string>(() => formatDateStr(new Date()));

  // Create modal
  const [modalOpen,  setModalOpen]  = useState(false);
  const [title,      setTitle]      = useState('');
  const [dueDate,    setDueDate]    = useState('');
  const [priority,   setPriority]   = useState<Task['priority']>('Medium');
  const [contactId,  setContactId]  = useState('');
  const [dealId,     setDealId]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [saveError,  setSaveError]  = useState<string | null>(null);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    const [t, c, d] = await Promise.all([getTasks(user), getContacts(user), getDeals(user)]);
    setTasks(t); setContacts(c); setDeals(d);
    setLoading(false);
  }

  const toggleStatus = async (task: Task) => {
    const next = task.status === 'Completed' ? 'Pending' : 'Completed';
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: next } : t));
    const ok = await updateTaskStatus(task.id, next);
    if (!ok) fetchAll();
  };

  const handleDelete = async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    await deleteTask(id);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setSaveError(null);
    const { error } = await createTask({
      title: title.trim(),
      due_date:   dueDate || undefined,
      priority:   priority,
      status:     'Pending',
      contact_id: contactId || undefined,
      deal_id:    dealId    || undefined,
      created_by: (user.email || user.username || '').toLowerCase(),
    });
    setSubmitting(false);
    if (error) { setSaveError((error as any).message || 'Failed to save'); return; }
    setModalOpen(false);
    setTitle(''); setDueDate(''); setPriority('Medium'); setContactId(''); setDealId('');
    fetchAll();
  };

  const filtered = tasks.filter((t) => filter === 'All' || t.status === filter);

  const pendingCount   = tasks.filter((t) => t.status === 'Pending').length;
  const completedCount = tasks.filter((t) => t.status === 'Completed').length;

  // Calendar math cells
  const calendarCells = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth(); // 0-indexed
    
    const firstDayOfMonth = new Date(year, month, 1);
    const startDayOfWeek = firstDayOfMonth.getDay(); // 0 = Sunday
    const totalDaysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();
    
    const cells = [];
    const today = new Date();
    
    // Prev Month Padding
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const day = prevMonthDays - i;
      const d = new Date(year, month - 1, day);
      cells.push({
        date: d,
        isCurrentMonth: false,
        isToday: isSameDay(d, today),
        dateStr: formatDateStr(d),
      });
    }
    
    // Current Month Days
    for (let day = 1; day <= totalDaysInMonth; day++) {
      const d = new Date(year, month, day);
      cells.push({
        date: d,
        isCurrentMonth: true,
        isToday: isSameDay(d, today),
        dateStr: formatDateStr(d),
      });
    }
    
    // Next Month Padding (to match standard 6-week grid = 42 cells)
    const remaining = 42 - cells.length;
    for (let day = 1; day <= remaining; day++) {
      const d = new Date(year, month + 1, day);
      cells.push({
        date: d,
        isCurrentMonth: false,
        isToday: isSameDay(d, today),
        dateStr: formatDateStr(d),
      });
    }
    
    return cells;
  }, [currentDate]);

  // Group tasks by local YYYY-MM-DD
  const tasksByDate = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    filtered.forEach((task) => {
      if (task.due_date) {
        const dateStr = getLocalDateString(task.due_date);
        if (!grouped[dateStr]) {
          grouped[dateStr] = [];
        }
        grouped[dateStr].push(task);
      }
    });
    return grouped;
  }, [filtered]);

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Activities</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            {pendingCount} pending · {completedCount} completed
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Segmented View Switcher */}
          <div className="inline-flex items-center bg-[var(--secondary)] border border-[var(--border)] rounded-md p-0.5 shadow-sm">
            <button
              onClick={() => setViewMode('Calendar')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                viewMode === 'Calendar'
                  ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              <Calendar className="size-3.5" />
              Calendar
            </button>
            <button
              onClick={() => setViewMode('Table')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                viewMode === 'Table'
                  ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              <KanbanSquare className="size-3.5" />
              List
            </button>
          </div>

          <button
            onClick={() => {
              setDueDate(selectedDate);
              setModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 cursor-pointer transition-colors bg-[var(--primary)] text-white hover:bg-[color-mix(in_oklab,var(--primary)_90%,transparent)] rounded-md px-3 text-xs h-9 font-medium shadow-sm"
          >
            <Plus className="size-4" /> Create Task
          </button>
        </div>
      </div>

      {/* Table/Calendar card */}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-sm overflow-hidden">
        {/* Filter tabs */}
        <div className="flex items-center gap-1 px-4 py-3 border-b border-[var(--border)]">
          {(['All', 'Pending', 'Completed'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                filter === tab
                  ? 'bg-[var(--primary)] text-white'
                  : 'text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* ─────────────── CALENDAR VIEW ─────────────── */}
        {viewMode === 'Calendar' && (
          <div>
            {/* Monthly Nav Bar */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[color-mix(in_oklab,var(--secondary)_10%,transparent)]">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </h2>
                <span className="text-xs text-[var(--muted-foreground)] px-2 py-0.5 bg-[var(--secondary)] rounded-full font-medium">
                  {filtered.length} tasks matching filters
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    const d = new Date(currentDate);
                    d.setMonth(d.getMonth() - 1);
                    setCurrentDate(d);
                  }}
                  className="p-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--accent)] text-[var(--foreground)] transition-colors cursor-pointer"
                  title="Previous Month"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  onClick={() => {
                    setCurrentDate(new Date());
                    setSelectedDate(formatDateStr(new Date()));
                  }}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--accent)] text-[var(--foreground)] transition-colors cursor-pointer"
                >
                  Today
                </button>
                <button
                  onClick={() => {
                    const d = new Date(currentDate);
                    d.setMonth(d.getMonth() + 1);
                    setCurrentDate(d);
                  }}
                  className="p-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--accent)] text-[var(--foreground)] transition-colors cursor-pointer"
                  title="Next Month"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>

            {/* Desktop Calendar Grid */}
            <div className="hidden md:block">
              {/* Weekday Labels */}
              <div className="grid grid-cols-7 border-b border-[var(--border)] bg-[color-mix(in_oklab,var(--secondary)_30%,transparent)]">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                  <div key={day} className="py-2.5 text-center text-xs font-bold text-[var(--muted-foreground)] uppercase tracking-wider">
                    {day}
                  </div>
                ))}
              </div>
              
              {/* Day cells grid */}
              <div className="grid grid-cols-7 bg-[var(--border)] gap-[1px]">
                {calendarCells.map((cell) => {
                  const dayTasks = tasksByDate[cell.dateStr] || [];
                  const isSelected = selectedDate === cell.dateStr;
                  return (
                    <div
                      key={cell.dateStr}
                      onClick={() => setSelectedDate(cell.dateStr)}
                      className={`min-h-[120px] p-2 bg-[var(--card)] flex flex-col justify-between transition-colors relative group select-none cursor-pointer ${
                        cell.isCurrentMonth ? '' : 'bg-[color-mix(in_oklab,var(--secondary)_10%,transparent)] text-[var(--muted-foreground)]/40'
                      } ${cell.isToday ? 'ring-2 ring-[var(--primary)] ring-inset z-10' : ''} ${
                        isSelected ? 'bg-[color-mix(in_oklab,var(--primary)_5%,transparent)]' : 'hover:bg-[color-mix(in_oklab,var(--secondary)_15%,transparent)]'
                      }`}
                    >
                      {/* Day Header */}
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                          cell.isToday 
                            ? 'bg-[var(--primary)] text-white' 
                            : cell.isCurrentMonth ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)]/40'
                        }`}>
                          {cell.date.getDate()}
                        </span>
                        
                        {/* Quick create plus button on cell hover */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDueDate(cell.dateStr);
                            setModalOpen(true);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--secondary)] text-[var(--primary)] transition-all cursor-pointer"
                          title="Add task for this day"
                        >
                          <Plus className="size-3.5" />
                        </button>
                      </div>
                      
                      {/* Tasks lists */}
                      <div className="flex-1 space-y-1 overflow-y-auto max-h-[85px] custom-scrollbar">
                        {dayTasks.slice(0, 3).map((task) => {
                          const done = task.status === 'Completed';
                          const prio = task.priority || 'Low';
                          return (
                            <div
                              key={task.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleStatus(task);
                              }}
                              className={`px-1.5 py-0.5 text-[10px] font-medium rounded border truncate flex items-center gap-1 transition-all ${priorityBadge[prio]} ${
                                done ? 'opacity-55 line-through decoration-slate-400' : 'hover:scale-[1.02] active:scale-95'
                              }`}
                              title={`${task.title} (${prio}) - Click to toggle status`}
                            >
                              <span className={`size-1.5 rounded-full shrink-0 ${
                                done ? 'bg-slate-400' : prio === 'High' ? 'bg-[var(--destructive)]' : prio === 'Medium' ? 'bg-[var(--warning)]' : 'bg-slate-400'
                              }`} />
                              <span className="truncate flex-1 text-left">{task.title}</span>
                            </div>
                          );
                        })}
                        {dayTasks.length > 3 && (
                          <div className="text-[9px] text-[var(--muted-foreground)] font-medium text-center bg-[var(--secondary)] py-0.5 rounded">
                            + {dayTasks.length - 3} more
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Mobile Calendar Grid & Tasks detail pane */}
            <div className="md:hidden">
              {/* Short weekdays */}
              <div className="grid grid-cols-7 border-b border-[var(--border)] bg-[color-mix(in_oklab,var(--secondary)_30%,transparent)]">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, idx) => (
                  <div key={idx} className="py-2 text-center text-[10px] font-bold text-[var(--muted-foreground)] uppercase">
                    {day}
                  </div>
                ))}
              </div>
              
              {/* Calendar cells (square ratios) */}
              <div className="grid grid-cols-7 bg-[var(--border)] gap-[1px]">
                {calendarCells.map((cell) => {
                  const dayTasks = tasksByDate[cell.dateStr] || [];
                  const isSelected = selectedDate === cell.dateStr;
                  const pendingTasks = dayTasks.filter(t => t.status === 'Pending');
                  const completedTasks = dayTasks.filter(t => t.status === 'Completed');
                  
                  return (
                    <div
                      key={cell.dateStr}
                      onClick={() => setSelectedDate(cell.dateStr)}
                      className={`aspect-square p-1 flex flex-col justify-between bg-[var(--card)] transition-all cursor-pointer relative ${
                        cell.isCurrentMonth ? '' : 'bg-[color-mix(in_oklab,var(--secondary)_10%,transparent)] text-[var(--muted-foreground)]/50'
                      } ${isSelected ? 'ring-2 ring-[var(--primary)] ring-inset z-10 font-bold bg-[color-mix(in_oklab,var(--primary)_8%,transparent)]' : ''}`}
                    >
                      <span className={`text-[11px] size-5 flex items-center justify-center rounded-full mx-auto font-medium ${
                        cell.isToday 
                          ? 'bg-[var(--primary)] text-white font-bold' 
                          : isSelected ? 'text-[var(--primary)]' : cell.isCurrentMonth ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)]/45'
                      }`}>
                        {cell.date.getDate()}
                      </span>
                      
                      {/* Priority Dot indicators */}
                      <div className="flex justify-center gap-0.5 mb-0.5">
                        {pendingTasks.slice(0, 3).map((task) => {
                          const prio = task.priority || 'Low';
                          return (
                            <span
                              key={task.id}
                              className={`size-1 rounded-full ${
                                prio === 'High' ? 'bg-[var(--destructive)]' : prio === 'Medium' ? 'bg-[var(--warning)]' : 'bg-slate-400'
                              }`}
                            />
                          );
                        })}
                        {completedTasks.length > 0 && pendingTasks.length < 3 && (
                          <span className="size-1 rounded-full bg-slate-300" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Tasks details list pane for mobile */}
              <div className="p-4 bg-[color-mix(in_oklab,var(--secondary)_10%,transparent)] border-t border-[var(--border)]">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold text-[var(--muted-foreground)] uppercase tracking-wider">
                    Tasks for {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </h3>
                  <button
                    onClick={() => {
                      setDueDate(selectedDate);
                      setModalOpen(true);
                    }}
                    className="text-xs font-bold text-[var(--primary)] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="size-3" /> Add Task
                  </button>
                </div>
                
                <div className="space-y-2">
                  {(() => {
                    const dayTasks = tasksByDate[selectedDate] || [];
                    if (dayTasks.length === 0) {
                      return (
                        <div className="text-center py-6 text-xs text-[var(--muted-foreground)] bg-[var(--card)] border border-[var(--border)] rounded-md">
                          No activities scheduled for this date.
                        </div>
                      );
                    }
                    return dayTasks.map((task) => {
                      const done = task.status === 'Completed';
                      const prio = task.priority || 'Low';
                      return (
                        <div
                          key={task.id}
                          className={`p-3 bg-[var(--card)] border border-[var(--border)] rounded-md flex items-center justify-between gap-3 shadow-sm transition-colors ${
                            done ? 'opacity-65 bg-[color-mix(in_oklab,var(--secondary)_10%,transparent)]' : ''
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <button
                              onClick={() => toggleStatus(task)}
                              className={`size-5 rounded border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                                done ? 'bg-[var(--primary)] border-[var(--primary)] text-white' : 'border-[var(--border)] hover:border-[var(--primary)] bg-[var(--card)]'
                              }`}
                            >
                              {done && <Check className="size-3" />}
                            </button>
                            <div className="min-w-0">
                              <p className={`text-xs font-semibold truncate ${done ? 'line-through text-[var(--muted-foreground)]' : 'text-[var(--foreground)]'}`}>
                                {task.title}
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className={`inline-flex items-center rounded-md border px-1.5 py-0.2 text-[8px] font-semibold ${priorityBadge[prio]}`}>
                                  {prio}
                                </span>
                                {task.contact && (
                                  <span className="text-[9px] text-[var(--muted-foreground)] truncate max-w-[100px]">
                                    👤 {task.contact.first_name}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => handleDelete(task.id)}
                            className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--destructive)] hover:bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] cursor-pointer"
                            title="Delete task"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─────────────── TABLE VIEW (LIST) ─────────────── */}
        {viewMode === 'Table' && (
          <>
            {/* Desktop Table View */}
            <div className="overflow-x-auto hidden md:block">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[color-mix(in_oklab,var(--secondary)_50%,transparent)] border-b border-[var(--border)]">
                    <th className="w-10 pl-4 py-3" />
                    {['Task Subject', 'Priority', 'Associated Contact', 'Associated Deal', 'Due Date', ''].map((h) => (
                      <th key={h} className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={7} className="py-16 text-center text-sm text-[var(--muted-foreground)]">Loading tasks…</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-16 text-center text-sm text-[var(--muted-foreground)]">
                        No tasks here.{' '}
                        <button onClick={() => setModalOpen(true)} className="text-[var(--primary)] font-medium hover:underline">
                          Create one
                        </button>
                      </td>
                    </tr>
                  ) : filtered.map((task) => {
                    const done = task.status === 'Completed';
                    const prio = task.priority || 'Low';
                    return (
                      <tr
                        key={task.id}
                        className={`border-b border-[var(--border)] transition-colors group hover:bg-[color-mix(in_oklab,var(--secondary)_40%,transparent)] ${done ? 'opacity-60' : ''}`}
                      >
                        {/* Checkbox */}
                        <td className="pl-4 py-3">
                          <button
                            onClick={() => toggleStatus(task)}
                            className={`size-5 rounded border flex items-center justify-center transition-colors cursor-pointer ${
                              done ? 'bg-[var(--primary)] border-[var(--primary)] text-white' : 'border-[var(--border)] hover:border-[var(--primary)] bg-[var(--card)]'
                            }`}
                          >
                            {done && <Check className="size-3" />}
                          </button>
                        </td>
                        <td className={`py-3 px-3 font-medium ${done ? 'line-through text-[var(--muted-foreground)]' : 'text-[var(--foreground)]'}`}>
                          {task.title}
                        </td>
                        <td className="py-3 px-3">
                          <span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-[10px] font-medium ${priorityBadge[prio]}`}>
                            {prio}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-xs">
                          {task.contact ? (
                            <Link to={`/crm/detail/contact/${task.contact_id}`} className="text-[var(--primary)] hover:underline flex items-center gap-1.5 font-medium">
                              <UserIcon className="size-3.5" />
                              {task.contact.first_name} {task.contact.last_name}
                            </Link>
                          ) : <span className="text-[var(--muted-foreground)]">—</span>}
                        </td>
                        <td className="py-3 px-3 text-xs">
                          {task.deal ? (
                            <Link to={`/crm/detail/deal/${task.deal_id}`} className="text-[var(--primary)] hover:underline flex items-center gap-1.5 font-medium">
                              <KanbanSquare className="size-3.5" />
                              {task.deal.name}
                            </Link>
                          ) : <span className="text-[var(--muted-foreground)]">—</span>}
                        </td>
                        <td className="py-3 px-3">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded ${dueDateBadge(task.due_date, done)}`}>
                            <Calendar className="size-3" />
                            {task.due_date ? new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No due date'}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <button
                            onClick={() => handleDelete(task.id)}
                            className="opacity-0 group-hover:opacity-100 text-[var(--muted-foreground)] hover:text-[var(--destructive)] transition-all cursor-pointer"
                            title="Delete task"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List View */}
            <div className="md:hidden divide-y divide-[var(--border)] bg-[var(--card)]">
              {filtered.length === 0 ? (
                <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">
                  No tasks here.{' '}
                  <button onClick={() => setModalOpen(true)} className="text-[var(--primary)] font-medium hover:underline">
                    Create one
                  </button>
                </div>
              ) : (
                filtered.map((task) => {
                  const done = task.status === 'Completed';
                  const prio = task.priority || 'Low';
                  return (
                    <div
                      key={task.id}
                      className={`p-4 transition-colors ${
                        done ? 'opacity-60 bg-[color-mix(in_oklab,var(--secondary)_10%,transparent)]' : 'hover:bg-[color-mix(in_oklab,var(--secondary)_15%,transparent)]'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => toggleStatus(task)}
                          className={`size-5 rounded border flex items-center justify-center shrink-0 mt-0.5 transition-colors cursor-pointer ${
                            done ? 'bg-[var(--primary)] border-[var(--primary)] text-white' : 'border-[var(--border)] hover:border-[var(--primary)] bg-[var(--card)]'
                          }`}
                        >
                          {done && <Check className="size-3" />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-semibold leading-snug ${done ? 'line-through text-[var(--muted-foreground)]' : 'text-[var(--foreground)]'}`}>
                            {task.title}
                          </p>
                          <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs text-[var(--muted-foreground)]">
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Contact</span>
                              <div className="mt-0.5">
                                {task.contact ? (
                                  <Link to={`/crm/detail/contact/${task.contact_id}`} className="text-[var(--primary)] hover:underline font-medium block truncate">
                                    {task.contact.first_name} {task.contact.last_name}
                                  </Link>
                                ) : <span className="text-slate-400">—</span>}
                              </div>
                            </div>
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Deal</span>
                              <div className="mt-0.5">
                                {task.deal ? (
                                  <Link to={`/crm/detail/deal/${task.deal_id}`} className="text-[var(--primary)] hover:underline font-medium block truncate">
                                    {task.deal.name}
                                  </Link>
                                ) : <span className="text-slate-400">—</span>}
                              </div>
                            </div>
                            <div className="col-span-2 mt-2 flex items-center justify-between">
                              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded ${dueDateBadge(task.due_date, done)}`}>
                                <Calendar className="size-3" />
                                {task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No due date'}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-[10px] font-semibold ${priorityBadge[prio]}`}>
                                  {prio}
                                </span>
                                <button
                                  onClick={() => handleDelete(task.id)}
                                  className="p-1 rounded-md text-[var(--muted-foreground)] hover:text-[var(--destructive)] hover:bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] transition-colors cursor-pointer"
                                  title="Delete task"
                                >
                                  <Trash2 className="size-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {/* Create Task Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setModalOpen(false)}>
          <div className="w-full max-w-[480px] bg-[var(--card)] rounded-xl shadow-2xl border border-[var(--border)] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="px-6 pt-5 pb-4 border-b border-[var(--border)] flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold text-[var(--foreground)]">Create Task</h2>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">Schedule a new activity or follow-up</p>
              </div>
              <button onClick={() => setModalOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                <X className="size-5" />
              </button>
            </div>

            {saveError && (
              <div className="mx-6 mt-4 flex items-start gap-2 rounded-md border border-[color-mix(in_oklab,var(--destructive)_30%,transparent)] bg-[color-mix(in_oklab,var(--destructive)_8%,transparent)] px-3 py-2 text-xs text-[var(--destructive)]">
                <AlertCircle className="size-4 mt-0.5 shrink-0" /><span>{saveError}</span>
              </div>
            )}

            <form onSubmit={handleCreate}>
              <div className="px-6 py-5 space-y-4">
                {/* Subject */}
                <div>
                  <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">
                    Task Subject <span className="text-[var(--destructive)]">*</span>
                  </label>
                  <input
                    autoFocus
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Follow up with Acme Corp"
                    className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Due Date */}
                  <div>
                    <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Due Date</label>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                    />
                  </div>

                  {/* Priority */}
                  <div>
                    <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Priority</label>
                    <select
                      value={priority}
                      onChange={(e) => setPriority(e.target.value as Task['priority'])}
                      className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                    >
                      {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                </div>

                {/* Contact */}
                <div>
                  <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Associated Contact</label>
                  <select
                    value={contactId}
                    onChange={(e) => setContactId(e.target.value)}
                    className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                  >
                    <option value="">— None —</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
                    ))}
                  </select>
                </div>

                {/* Deal */}
                <div>
                  <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Associated Deal</label>
                  <select
                    value={dealId}
                    onChange={(e) => setDealId(e.target.value)}
                    className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                  >
                    <option value="">— None —</option>
                    {deals.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-[var(--border)] bg-[color-mix(in_oklab,var(--secondary)_30%,transparent)]">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="inline-flex items-center justify-center border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--accent)] rounded-md px-3 text-xs h-9 cursor-pointer font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !title.trim()}
                  className="inline-flex items-center justify-center bg-[var(--primary)] text-white hover:bg-[color-mix(in_oklab,var(--primary)_90%,transparent)] rounded-md px-3 text-xs h-9 cursor-pointer font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Creating…' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
