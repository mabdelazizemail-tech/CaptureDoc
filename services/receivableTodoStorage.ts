import { supabase } from './supabaseClient';
import type { PMProject } from './pmStorage';

export interface ReceivableMonthlyTask {
  id: string;
  project_id: string;
  task_type: string;
  title: string;
  task_month: number;
  task_year: number;
  due_date: string; // YYYY-MM-DD
  assigned_user_id?: string;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Skipped';
  notes?: string;
  reminder_status: 'Idle' | 'Sent' | 'Overdue Sent';
  reminder_sent_at?: string;
  completed_at?: string;
  completed_by?: string;
  completion_note?: string;
  billing_interval?: 'monthly' | 'quarterly_arrears' | 'quarterly_advance' | 'advance' | 'custom';
  invoice_count?: number;
  created_at?: string;
  updated_at?: string;
  created_by?: string;
  updated_by?: string;
}

// ─── Helpers to encode/decode metadata in notes field (for legacy DB structures) ──
function parseBillingMeta(notes?: string): { interval?: ReceivableMonthlyTask['billing_interval']; count?: number; cleanNotes?: string } {
  if (!notes) return {};
  const match = notes.match(/\[Billing:\s*interval=([^,\s\]]+),\s*count=(\d+)\]/);
  if (match) {
    const interval = match[1] as ReceivableMonthlyTask['billing_interval'];
    const count = parseInt(match[2], 10);
    const cleanNotes = notes.replace(/\[Billing:\s*interval=[^,\s\]]+,\s*count=\d+\]\s*/, '').trim();
    return { interval, count, cleanNotes: cleanNotes || undefined };
  }
  return { cleanNotes: notes };
}

function formatBillingNotes(notes: string | undefined, interval: string | undefined, count: number | undefined): string | undefined {
  const parseRes = parseBillingMeta(notes);
  const cleanNotes = parseRes.cleanNotes || '';
  if (!interval && !count) return notes;
  const metaString = `[Billing: interval=${interval || 'monthly'}, count=${count || 1}]`;
  return cleanNotes ? `${metaString} ${cleanNotes}` : metaString;
}

// ─── Schema detection (cached) ──────────────────────────────────────────────
let todoSchemaMode: 'relational' | 'local' | null = null;

async function detectTodoSchema(): Promise<'relational' | 'local'> {
  if (todoSchemaMode) return todoSchemaMode;
  try {
    const { error } = await supabase
      .from('receivable_monthly_tasks')
      .select('id')
      .limit(1);
    
    todoSchemaMode = error ? 'local' : 'relational';
  } catch {
    todoSchemaMode = 'local';
  }
  return todoSchemaMode;
}

// ─── LocalStorage fallback operations ─────────────────────────────────────────
const LOCAL_STORAGE_KEY = 'receivable_monthly_tasks_fallback';

function getLocalTasks(): ReceivableMonthlyTask[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalTasks(tasks: ReceivableMonthlyTask[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(tasks));
  } catch (err) {
    console.error('Failed to save tasks to local storage:', err);
  }
}

// ─── Public API Service ───────────────────────────────────────────────────────
export const ReceivableTodoService = {
  async loadMonthlyTasks(month: number, year: number): Promise<ReceivableMonthlyTask[]> {
    const mode = await detectTodoSchema();

    if (mode === 'local') {
      const all = getLocalTasks();
      return all.filter(t => t.task_month === month && t.task_year === year);
    }

    const { data, error } = await supabase
      .from('receivable_monthly_tasks')
      .select('*')
      .eq('task_month', month)
      .eq('task_year', year);

    if (error) {
      console.error('[receivable-todo] load failed:', error.message);
      return [];
    }
    return (data || []).map((t: any) => {
      // Robust decoding from notes (in case DB columns aren't updated yet)
      const meta = parseBillingMeta(t.notes);
      return {
        id: t.id,
        project_id: t.project_id,
        task_type: t.task_type,
        title: t.title,
        task_month: t.task_month,
        task_year: t.task_year,
        due_date: t.due_date,
        assigned_user_id: t.assigned_user_id || undefined,
        status: t.status as ReceivableMonthlyTask['status'],
        notes: meta.cleanNotes, // Return clean notes to the UI
        reminder_status: t.reminder_status as ReceivableMonthlyTask['reminder_status'],
        reminder_sent_at: t.reminder_sent_at || undefined,
        completed_at: t.completed_at || undefined,
        completed_by: t.completed_by || undefined,
        completion_note: t.completion_note || undefined,
        billing_interval: t.billing_interval || meta.interval || 'monthly',
        invoice_count: t.invoice_count !== undefined && t.invoice_count !== null ? t.invoice_count : (meta.count || 1),
        created_at: t.created_at,
        updated_at: t.updated_at,
        created_by: t.created_by || undefined,
        updated_by: t.updated_by || undefined,
      };
    });
  },

  async upsertMonthlyTask(task: ReceivableMonthlyTask): Promise<void> {
    const mode = await detectTodoSchema();

    if (mode === 'local') {
      const all = getLocalTasks();
      const idx = all.findIndex(t => t.id === task.id);
      const enriched = {
        ...task,
        billing_interval: task.billing_interval || 'monthly',
        invoice_count: task.invoice_count || 1,
        created_at: task.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      if (idx >= 0) {
        all[idx] = enriched;
      } else {
        all.push(enriched);
      }
      saveLocalTasks(all);
      return;
    }

    const payload: any = {
      id: task.id,
      project_id: task.project_id,
      task_type: task.task_type,
      title: task.title,
      task_month: task.task_month,
      task_year: task.task_year,
      due_date: task.due_date,
      assigned_user_id: task.assigned_user_id || null,
      status: task.status,
      reminder_status: task.reminder_status,
      reminder_sent_at: task.reminder_sent_at || null,
      completed_at: task.completed_at || null,
      completed_by: task.completed_by || null,
      completion_note: task.completion_note || null,
      created_by: task.created_by || null,
      updated_by: task.updated_by || null,
      updated_at: new Date().toISOString()
    };

    // Try upserting with columns
    const payloadWithColumns = {
      ...payload,
      notes: task.notes || null,
      billing_interval: task.billing_interval || 'monthly',
      invoice_count: task.invoice_count || 1
    };

    const { error } = await supabase.from('receivable_monthly_tasks').upsert(payloadWithColumns);
    if (error) {
      // If error is due to missing columns, fall back to encoding in the notes field
      if (error.code === 'PGRST102' || error.message.includes('column') || error.message.includes('does not exist')) {
        console.warn('[receivable-todo] missing columns in DB table, falling back to notes-encoding...');
        const payloadWithEncodedNotes = {
          ...payload,
          notes: formatBillingNotes(task.notes, task.billing_interval, task.invoice_count)
        };
        const { error: fallbackError } = await supabase.from('receivable_monthly_tasks').upsert(payloadWithEncodedNotes);
        if (fallbackError) {
          console.error('[receivable-todo] fallback upsert failed:', fallbackError.message);
        }
      } else {
        console.error('[receivable-todo] upsert failed:', error.message);
      }
    }
  },

  async deleteMonthlyTasks(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const mode = await detectTodoSchema();

    if (mode === 'local') {
      const all = getLocalTasks();
      const filtered = all.filter(t => !ids.includes(t.id));
      saveLocalTasks(filtered);
      return;
    }

    const { error } = await supabase.from('receivable_monthly_tasks').delete().in('id', ids);
    if (error) {
      console.error('[receivable-todo] delete failed:', error.message);
    }
  },

  // ─── Automation Workflow: Generation ──────────────────────────────────────────
  async generateMonthlyTasks(
    month: number,
    year: number,
    projects: PMProject[],
    userId: string
  ): Promise<ReceivableMonthlyTask[]> {
    const existing = await this.loadMonthlyTasks(month, year);
    const existingProjectIds = new Set(existing.map(t => t.project_id));

    // Active project filter matching ProjectManagementDashboard:
    // Name doesn't contain storage terms and not closed (end_date in future or null)
    const activeProjects = projects.filter(p => {
      const isMock = p.name.includes('Storage') || p.name.includes('المخزن');
      if (isMock) return false;
      if (!p.end_date) return true;
      const today = new Date().toISOString().slice(0, 10);
      return p.end_date >= today;
    });

    const generated: ReceivableMonthlyTask[] = [...existing];

    for (const proj of activeProjects) {
      if (existingProjectIds.has(proj.id)) {
        continue;
      }

      // Sensible default due date: 25th of the billing month
      const pad = (n: number) => String(n).padStart(2, '0');
      const dueDate = `${year}-${pad(month)}-25`;

      const newTask: ReceivableMonthlyTask = {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36),
        project_id: proj.id,
        task_type: 'monthly_invoice_reminder',
        title: `إصدار فاتورة - ${proj.name} - شهر ${pad(month)}/${year}`,
        task_month: month,
        task_year: year,
        due_date: dueDate,
        status: 'Pending',
        reminder_status: 'Idle',
        billing_interval: 'monthly',
        invoice_count: 1,
        created_by: userId,
        updated_by: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      await this.upsertMonthlyTask(newTask);
      generated.push(newTask);
    }

    return generated;
  }
};
