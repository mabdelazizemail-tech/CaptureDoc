import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar, User as UserIcon, KanbanSquare, Check, Plus,
  X, AlertCircle, Trash2,
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

export default function CRMTasks({ user }: { user: User }) {
  const [tasks,    setTasks]    = useState<Task[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals,    setDeals]    = useState<Deal[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState<'All' | 'Pending' | 'Completed'>('All');

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
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-1.5 cursor-pointer transition-colors bg-[var(--primary)] text-white hover:bg-[color-mix(in_oklab,var(--primary)_90%,transparent)] rounded-md px-3 text-xs h-9 font-medium"
        >
          <Plus className="size-4" /> Create Task
        </button>
      </div>

      {/* Table card */}
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
                        className={`size-5 rounded border flex items-center justify-center transition-colors ${
                          done ? 'bg-[var(--primary)] border-[var(--primary)] text-white' : 'border-[var(--border)] hover:border-[var(--primary)]'
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
                        <Link to={`/crm/detail/contact/${task.contact_id}`} className="text-[var(--primary)] hover:underline flex items-center gap-1.5">
                          <UserIcon className="size-3.5" />
                          {task.contact.first_name} {task.contact.last_name}
                        </Link>
                      ) : <span className="text-[var(--muted-foreground)]">—</span>}
                    </td>
                    <td className="py-3 px-3 text-xs">
                      {task.deal ? (
                        <Link to={`/crm/detail/deal/${task.deal_id}`} className="text-[var(--primary)] hover:underline flex items-center gap-1.5">
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
                        className="opacity-0 group-hover:opacity-100 text-[var(--muted-foreground)] hover:text-[var(--destructive)] transition-all"
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
                      className={`size-5 rounded border flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
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
                              className="p-1 rounded-md text-[var(--muted-foreground)] hover:text-[var(--destructive)] hover:bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] transition-colors"
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
