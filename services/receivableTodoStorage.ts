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
  created_at?: string;
  updated_at?: string;
  created_by?: string;
  updated_by?: string;
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
    return (data || []).map((t: any) => ({
      id: t.id,
      project_id: t.project_id,
      task_type: t.task_type,
      title: t.title,
      task_month: t.task_month,
      task_year: t.task_year,
      due_date: t.due_date,
      assigned_user_id: t.assigned_user_id || undefined,
      status: t.status as ReceivableMonthlyTask['status'],
      notes: t.notes || undefined,
      reminder_status: t.reminder_status as ReceivableMonthlyTask['reminder_status'],
      reminder_sent_at: t.reminder_sent_at || undefined,
      completed_at: t.completed_at || undefined,
      completed_by: t.completed_by || undefined,
      completion_note: t.completion_note || undefined,
      created_at: t.created_at,
      updated_at: t.updated_at,
      created_by: t.created_by || undefined,
      updated_by: t.updated_by || undefined,
    }));
  },

  async upsertMonthlyTask(task: ReceivableMonthlyTask): Promise<void> {
    const mode = await detectTodoSchema();

    if (mode === 'local') {
      const all = getLocalTasks();
      const idx = all.findIndex(t => t.id === task.id);
      const enriched = {
        ...task,
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

    const payload = {
      id: task.id,
      project_id: task.project_id,
      task_type: task.task_type,
      title: task.title,
      task_month: task.task_month,
      task_year: task.task_year,
      due_date: task.due_date,
      assigned_user_id: task.assigned_user_id || null,
      status: task.status,
      notes: task.notes || null,
      reminder_status: task.reminder_status,
      reminder_sent_at: task.reminder_sent_at || null,
      completed_at: task.completed_at || null,
      completed_by: task.completed_by || null,
      completion_note: task.completion_note || null,
      created_by: task.created_by || null,
      updated_by: task.updated_by || null,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase.from('receivable_monthly_tasks').upsert(payload);
    if (error) {
      console.error('[receivable-todo] upsert failed:', error.message);
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
