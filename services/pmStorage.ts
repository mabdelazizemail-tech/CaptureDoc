import { supabase } from './supabaseClient';

export interface PMProject {
    id: string;
    name: string;
    location: string;
    contract_total_volume: number;
    start_date: string | null;
    end_date: string | null;
    per_unit_price: number;
    contract_monthly_volume?: number;
    click_charge?: number;
}

export interface SiteLog {
    id: string;
    project_id: string;
    log_date: string;
    prep_volume: number;
    scan_volume: number;
    qc_volume: number;
    index_volume: number;
}

export interface InventoryTracking {
    id: string;
    project_id: string;
    document_type: string;
    total_volume: number;
    processed_volume: number;
}

export interface Expense {
    id: string;
    project_id: string;
    expense_date: string;
    category: string;
    amount: number;
    description: string;
}

export interface Timesheet {
    id: string;
    employee_id: string;
    project_id: string;
    work_date: string;
    hours_worked: number;
    role_in_project: string;
    volume_processed: number;
    hr_employees?: { full_name: string };
}

export const PMStorageService = {
    async getProjects(): Promise<PMProject[]> {
        const { data, error } = await supabase
            .from('projects')
            .select('*')
            .order('name');
        if (error) {
            console.error('Error fetching PM projects:', error.message);
            return [];
        }
        return data as PMProject[];
    },

    async updateProjectMetrics(projectId: string, updates: Partial<PMProject>): Promise<boolean> {
        const { error } = await supabase
            .from('projects')
            .update(updates)
            .eq('id', projectId);
        if (error) {
            console.error('Error updating project metrics:', error.message);
            return false;
        }
        return true;
    },

    async getSiteLogs(projectId: string): Promise<SiteLog[]> {
        const { data, error } = await supabase
            .from('pm_site_logs')
            .select('*')
            .eq('project_id', projectId)
            .order('log_date', { ascending: false });
        if (error) return [];
        return data as SiteLog[];
    },

    async addSiteLog(log: Omit<SiteLog, 'id'>): Promise<boolean> {
        const { error } = await supabase.from('pm_site_logs').insert(log);
        if (error) {
            console.error('Add Site Log Error:', error);
            return false;
        }
        return true;
    },

    async getInventory(projectId: string): Promise<InventoryTracking[]> {
        const { data, error } = await supabase
            .from('pm_inventory')
            .select('*')
            .eq('project_id', projectId)
            .order('document_type');
        if (error) return [];
        return data as InventoryTracking[];
    },

    async addOrUpdateInventory(inv: Omit<InventoryTracking, 'id'>): Promise<boolean> {
        // Since UNIQUE(project_id, document_type), we can upsert
        const { error } = await supabase.from('pm_inventory').upsert({
            project_id: inv.project_id,
            document_type: inv.document_type,
            total_volume: inv.total_volume,
            processed_volume: inv.processed_volume
        }, { onConflict: 'project_id, document_type' });

        if (error) {
            console.error('Inventory Upsert Error:', error);
            return false;
        }
        return true;
    },

    async getExpenses(projectId: string): Promise<Expense[]> {
        const { data, error } = await supabase
            .from('pm_expenses')
            .select('*')
            .eq('project_id', projectId)
            .order('expense_date', { ascending: false });
        if (error) return [];
        return data as Expense[];
    },

    async addExpense(expense: Omit<Expense, 'id'>): Promise<{ success: boolean; error?: string }> {
        const { error } = await supabase.from('pm_expenses').insert(expense);
        if (error) {
            console.error('Add Expense Error:', error);
            return { success: false, error: error.message };
        }
        return { success: true };
    },

    async getTimesheets(projectId: string): Promise<Timesheet[]> {
        const { data, error } = await supabase
            .from('pm_timesheets')
            .select(`
                *,
                hr_employees(full_name)
            `)
            .eq('project_id', projectId)
            .order('work_date', { ascending: false });
        if (error) return [];
        return data as Timesheet[];
    },

    async getProjectKPIVolume(projectId: string, month: string): Promise<number> {
        const { data, error } = await supabase
            .from('hr_project_kpis')
            .select('volume')
            .eq('project_id', projectId)
            .eq('month', month)
            .single();
        if (error || !data) return 0;
        return data.volume || 0;
    },

    async getTicketExpenses(projectId: string, month: string): Promise<Expense[]> {
        // Fetch all tickets for the project that have a cost
        const { data, error } = await supabase
            .from('tickets')
            .select('id, title, cost, createdat, solvedat, projectid')
            .eq('projectid', projectId)
            .neq('cost', 0)
            .not('cost', 'is', null);

        if (error || !data) return [];

        // Filter in-memory to match either solvedat or createdat against the selected month
        return data
            .filter(t => {
                const date = t.solvedat || t.createdat;
                return date && date.startsWith(month);
            })
            .map(t => ({
                id: t.id,
                project_id: t.projectid,
                expense_date: (t.solvedat || t.createdat).split('T')[0],
                category: 'hardware_maintenance',
                amount: Number(t.cost) || 0,
                description: `[دعم فنى] ${t.title}`
            }));
    }
};
