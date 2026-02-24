
import { supabase } from './supabaseClient';
import { User, Project, Operator, KPILog, TeamStats, UnlockRequest, SiteSummary, Asset, MaintenanceRequest, Ticket } from './types';

export const StorageService = {
    // ... (All existing methods remain unchanged) ...

    // --- Auth ---
    getUserProfile: async (userId: string): Promise<User | null> => {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (error || !data) return null;

        return {
            id: data.id,
            username: data.username || data.email,
            name: data.name,
            role: data.role,
            teamName: data.team_name,
            projectId: data.project_id,
            reportsTo: data.reports_to
        };
    },

    login: async (username: string, password: string): Promise<User | null> => {
        // Normalize inputs
        const cleanUser = username ? username.trim().toLowerCase() : '';
        const cleanPass = password ? password.trim() : '';

        // 0. Master Fallback (Priority) - Allows access without DB
        if ((cleanUser === 'admin' || cleanUser === 'admin@smartkpis.com') && cleanPass === 'admin') {
            console.log("Logged in via Master Fallback");
            return {
                id: 'master-admin-id',
                username: 'admin',
                name: 'System Administrator',
                role: 'super_admin',
                projectId: undefined
            };
        }

        // Power Admin Fallback
        if (cleanUser === 'power' && cleanPass === 'power') {
            return {
                id: 'power-admin-id',
                username: 'power',
                name: 'Power Administrator',
                role: 'power_admin'
            };
        }

        return null; // For standard users, we now use Supabase Auth in Login.tsx
    },

    // --- Users (Profiles) ---
    getAllProjectManagers: async (): Promise<User[]> => {
        const { data } = await supabase.from('profiles').select('*').eq('role', 'project_manager');
        return (data || []).map((u: any) => ({
            id: u.id,
            username: u.username || u.email,
            name: u.name,
            role: u.role,
            projectId: u.project_id,
            reportsTo: u.reports_to
        }));
    },

    getUsers: async (projectId?: string): Promise<User[]> => {
        let query = supabase.from('profiles').select('*');
        if (projectId && projectId !== 'all') {
            query = query.eq('project_id', projectId);
        }
        const { data, error } = await query;
        if (error) {
            console.error("Error fetching users:", error);
            return [];
        }
        return (data || []).map((u: any) => ({
            id: u.id,
            username: u.username || u.email,
            name: u.name,
            role: u.role,
            teamName: u.team_name,
            projectId: u.project_id,
            reportsTo: u.reports_to
        }));
    },

    saveUser: async (user: User): Promise<{ success: boolean; error?: string }> => {
        const payload = {
            id: user.id,
            name: user.name,
            role: user.role,
            project_id: user.projectId,
            team_name: user.teamName,
            reports_to: user.reportsTo,
            username: user.username,
            email: user.username.includes('@') ? user.username : undefined
        };

        const { error } = await supabase.from('profiles').upsert(payload);
        if (error) return { success: false, error: error.message };
        return { success: true };
    },

    deleteUser: async (id: string): Promise<boolean> => {
        const { error } = await supabase.from('profiles').delete().eq('id', id);
        return !error;
    },

    // --- Projects ---
    getProjects: async (): Promise<Project[]> => {
        const { data } = await supabase.from('projects').select('*');
        return (data || []).map((p: any) => ({
            id: p.id,
            name: p.name,
            location: p.location,
            pmId: p.pm_id,
            createdAt: p.created_at
        }));
    },

    getProjectsByPM: async (pmId: string): Promise<Project[]> => {
        const { data } = await supabase.from('projects').select('*').eq('pm_id', pmId);
        return (data || []).map((p: any) => ({
            id: p.id,
            name: p.name,
            location: p.location,
            pmId: p.pm_id,
            createdAt: p.created_at
        }));
    },

    assignProjectsToPM: async (pmId: string, projectIds: string[]): Promise<boolean> => {
        await supabase.from('projects').update({ pm_id: null }).eq('pm_id', pmId);
        if (projectIds.length > 0) {
            const { error } = await supabase.from('projects').update({ pm_id: pmId }).in('id', projectIds);
            if (error) return false;
        }
        return true;
    },

    createProject: async (name: string, location: string): Promise<Project | null> => {
        const { data, error } = await supabase.from('projects').insert({ name, location }).select().single();
        if (error || !data) return null;
        return { id: data.id, name: data.name, location: data.location, pmId: data.pm_id, createdAt: data.created_at };
    },

    updateProject: async (id: string, name: string, location: string, pmId?: string): Promise<boolean> => {
        const payload: any = { name, location };
        if (pmId) payload.pm_id = pmId;
        const { error } = await supabase.from('projects').update(payload).eq('id', id);
        return !error;
    },

    deleteProject: async (id: string): Promise<boolean> => {
        const { error } = await supabase.from('projects').delete().eq('id', id);
        return !error;
    },

    getPMDashboardSummary: async (pmId: string): Promise<SiteSummary[]> => {
        const projects = await StorageService.getProjectsByPM(pmId);
        const summaries: SiteSummary[] = [];
        for (const p of projects) {
            const { count: supCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('project_id', p.id).eq('role', 'supervisor');
            const { count: reqCount } = await supabase.from('unlock_requests').select('*', { count: 'exact', head: true }).eq('project_id', p.id).eq('status', 'pending');
            const { count: assetCount } = await supabase.from('assets').select('*', { count: 'exact', head: true }).eq('project_id', p.id);
            const { count: maintCount } = await supabase.from('maintenance_requests').select('*', { count: 'exact', head: true }).eq('project_id', p.id).eq('status', 'pending');
            summaries.push({
                projectId: p.id,
                siteName: p.name,
                location: p.location,
                supervisorCount: supCount || 0,
                pendingRequestsCount: reqCount || 0,
                assetsMaintenanceCount: (assetCount || 0) + (maintCount || 0)
            });
        }
        return summaries;
    },

    // --- Operators ---
    getOperators: async (projectId?: string): Promise<Operator[]> => {
        let query = supabase.from('operators').select('*');
        if (projectId && projectId !== 'all') query = query.eq('project_id', projectId);
        const { data } = await query;
        return (data || []).map((o: any) => ({
            id: o.id,
            name: o.name,
            phone: o.phone,
            supervisorId: o.supervisor_id,
            projectId: o.project_id
        }));
    },

    getOperatorsBySupervisor: async (supervisorId: string): Promise<Operator[]> => {
        const { data } = await supabase.from('operators').select('*').eq('supervisor_id', supervisorId);
        return (data || []).map((o: any) => ({
            id: o.id,
            name: o.name,
            phone: o.phone,
            supervisorId: o.supervisor_id,
            projectId: o.project_id
        }));
    },

    saveOperators: async (operators: Operator[]): Promise<void> => {
        const payload = operators.map(o => ({
            id: o.id.includes('op-') ? undefined : o.id,
            name: o.name,
            phone: o.phone,
            supervisor_id: o.supervisorId,
            project_id: o.projectId
        }));
        await supabase.from('operators').upsert(payload);
    },

    updateOperatorsSupervisor: async (operatorIds: string[], supervisorId: string): Promise<void> => {
        await supabase.from('operators').update({ supervisor_id: supervisorId }).in('id', operatorIds);
    },

    deleteOperators: async (ids: string[]): Promise<void> => {
        await supabase.from('operators').delete().in('id', ids);
    },

    // --- Logs (KPI) ---
    getLogs: async (projectId?: string, status?: string): Promise<KPILog[]> => {
        let query = supabase.from('kpi_logs').select('*');
        if (projectId && projectId !== 'all') query = query.eq('project_id', projectId);
        if (status) query = query.eq('status', status);
        const { data } = await query;
        return (data || []).map((l: any) => ({
            id: l.id,
            operatorId: l.operator_id,
            supervisorId: l.supervisor_id,
            projectId: l.project_id,
            date: l.date,
            attitude: l.attitude,
            performance: l.performance,
            quality: l.quality,
            appearance: l.appearance,
            dailyVolume: l.daily_volume,
            status: l.status,
            timestamp: l.timestamp
        }));
    },

    getLogsByDateAndSupervisor: async (date: string, supervisorId: string): Promise<KPILog[]> => {
        const { data } = await supabase.from('kpi_logs').select('*').eq('date', date).eq('supervisor_id', supervisorId);
        return (data || []).map((l: any) => ({
            id: l.id,
            operatorId: l.operator_id,
            supervisorId: l.supervisor_id,
            projectId: l.project_id,
            date: l.date,
            attitude: l.attitude,
            performance: l.performance,
            quality: l.quality,
            appearance: l.appearance,
            dailyVolume: l.daily_volume,
            status: l.status,
            timestamp: l.timestamp
        }));
    },

    getLogsByMonth: async (month: number, year: number, supervisorId: string): Promise<KPILog[]> => {
        const startDate = new Date(year, month, 1).toISOString().split('T')[0];
        const endDate = new Date(year, month + 1, 0).toISOString().split('T')[0];
        const { data } = await supabase.from('kpi_logs').select('*').eq('supervisor_id', supervisorId).gte('date', startDate).lte('date', endDate);
        return (data || []).map((l: any) => ({
            id: l.id,
            operatorId: l.operator_id,
            supervisorId: l.supervisor_id,
            projectId: l.project_id,
            date: l.date,
            attitude: l.attitude,
            performance: l.performance,
            quality: l.quality,
            appearance: l.appearance,
            dailyVolume: l.daily_volume,
            status: l.status,
            timestamp: l.timestamp
        }));
    },

    saveLogs: async (logs: KPILog[]): Promise<{ success: boolean; error?: string }> => {
        const payload = logs.map(l => ({
            id: l.id,
            operator_id: l.operatorId,
            supervisor_id: l.supervisorId,
            project_id: l.projectId,
            date: l.date,
            attitude: l.attitude,
            performance: l.performance,
            quality: l.quality,
            appearance: l.appearance,
            status: 'pending',
            timestamp: l.timestamp
        }));
        const { error } = await supabase.from('kpi_logs').upsert(payload);
        if (error) return { success: false, error: error.message };
        return { success: true };
    },

    updateLogStatus: async (logIds: string[], status: 'approved' | 'rejected'): Promise<boolean> => {
        const { error } = await supabase.from('kpi_logs').update({ status }).in('id', logIds);
        return !error;
    },

    // --- Team Stats ---
    getTeamStats: async (supervisorId: string, date: string): Promise<TeamStats | null> => {
        const { data } = await supabase.from('team_stats').select('*').eq('supervisor_id', supervisorId).eq('date', date).single();
        if (!data) return null;
        return { id: data.id, supervisorId: data.supervisor_id, projectId: data.project_id, date: data.date, volume: data.volume };
    },

    saveTeamStats: async (stats: TeamStats): Promise<{ success: boolean; error?: string }> => {
        const payload = { supervisor_id: stats.supervisorId, project_id: stats.projectId, date: stats.date, volume: stats.volume };
        const { error } = await supabase.from('team_stats').upsert(payload);
        if (error) return { success: false, error: error.message };
        return { success: true };
    },

    // --- Unlock Requests ---
    getUnlockRequests: async (projectId?: string, supervisorId?: string, status?: string): Promise<UnlockRequest[]> => {
        let query = supabase.from('unlock_requests').select('*');
        if (projectId && projectId !== 'all') query = query.eq('project_id', projectId);
        if (supervisorId) query = query.eq('supervisor_id', supervisorId);
        if (status) query = query.eq('status', status);
        const { data } = await query;
        return (data || []).map((r: any) => ({
            id: r.id,
            operatorId: r.operator_id,
            operatorName: r.operator_name,
            supervisorId: r.supervisor_id,
            supervisorName: r.supervisor_name,
            projectId: r.project_id,
            logId: r.log_id,
            date: r.date,
            status: r.status,
            reason: r.reason,
            createdAt: r.created_at
        }));
    },

    createUnlockRequest: async (opId: string, opName: string, supId: string, supName: string, projId: string, reason: string, logId?: string): Promise<{ success: boolean; error?: string }> => {
        const payload = { operator_id: opId, operator_name: opName, supervisor_id: supId, supervisor_name: supName, project_id: projId, log_id: logId, date: new Date().toISOString().split('T')[0], reason, status: 'pending' };
        const { error } = await supabase.from('unlock_requests').insert(payload);
        if (error) return { success: false, error: error.message };
        return { success: true };
    },

    approveUnlockRequest: async (reqId: string, opId: string, date: string, logId?: string): Promise<boolean> => {
        if (logId) { await supabase.from('kpi_logs').delete().eq('id', logId); } else { await supabase.from('kpi_logs').delete().eq('operator_id', opId).eq('date', date); }
        const { error } = await supabase.from('unlock_requests').update({ status: 'approved' }).eq('id', reqId);
        return !error;
    },

    rejectUnlockRequest: async (reqId: string, opId: string, date: string): Promise<{ success: boolean; error?: string }> => {
        const { error } = await supabase.from('unlock_requests').update({ status: 'rejected' }).eq('id', reqId);
        if (error) return { success: false, error: error.message };
        return { success: true };
    },

    // --- Assets ---
    getAssets: async (projectId?: string): Promise<Asset[]> => {
        let query = supabase.from('assets').select('*');
        if (projectId && projectId !== 'all') query = query.eq('project_id', projectId);
        const { data } = await query;
        return (data || []).map((a: any) => ({
            id: a.id,
            assetTag: a.asset_tag,
            name: a.name,
            type: a.type,
            status: a.status,
            serialNumber: a.serial_number,
            macAddress: a.mac_address,
            cpu: a.cpu,
            ram: a.ram,
            storage: a.storage,
            currentCounter: a.current_counter, // Map current_counter
            purchaseDate: a.purchase_date,
            cost: a.cost,
            projectId: a.project_id,
            physicalLocation: a.location,
            assignedUser: a.assigned_user,
            department: a.department,
            lastMaintenanceDate: a.last_maintenance_date,
            imageUrl: a.image_url,
            lastAuditDate: a.last_audit_date,
            auditedBy: a.audited_by
        }));
    },

    getNextAssetTag: async (): Promise<string> => {
        const year = new Date().getFullYear().toString();
        const { data, error } = await supabase.rpc('generate_next_asset_tag', { year_prefix: year });
        if (error) { console.error("Error generating asset tag:", error); return ''; }
        return data as string;
    },

    createAsset: async (asset: Partial<Asset>): Promise<{ success: boolean; error?: string }> => {
        const payload = {
            asset_tag: asset.assetTag,
            name: asset.name,
            type: asset.type,
            status: asset.status,
            serial_number: asset.serialNumber,
            project_id: asset.projectId,
            location: asset.physicalLocation,
            assigned_user: asset.assignedUser,
            department: asset.department,
            purchase_date: asset.purchaseDate,
            cost: asset.cost,
            last_maintenance_date: asset.lastMaintenanceDate,
            cpu: asset.cpu,
            ram: asset.ram,
            storage: asset.storage,
            current_counter: asset.currentCounter // Save current_counter
        };
        const { error } = await supabase.from('assets').insert(payload);
        if (error) return { success: false, error: error.message };
        return { success: true };
    },

    // NEW: Bulk Create with Auto-Tagging
    registerAssetsBulk: async (assets: Partial<Asset>[], projectId: string, userId: string): Promise<{ success: boolean; data?: any[]; error?: string }> => {
        const year = new Date().getFullYear().toString();
        const { data, error } = await supabase.rpc('register_assets_bulk', {
            assets_data: assets,
            year_prefix: year,
            project_id_input: projectId,
            user_id_input: userId
        });

        if (error) {
            console.error("Bulk Registration Error:", error);
            return { success: false, error: error.message };
        }

        return { success: true, data: data };
    },

    updateAsset: async (asset: Asset): Promise<{ success: boolean; error?: string }> => {
        const payload = {
            asset_tag: asset.assetTag,
            name: asset.name,
            type: asset.type,
            status: asset.status,
            serial_number: asset.serialNumber,
            project_id: asset.projectId,
            location: asset.physicalLocation,
            assigned_user: asset.assignedUser,
            department: asset.department,
            purchase_date: asset.purchaseDate,
            cost: asset.cost,
            last_maintenance_date: asset.lastMaintenanceDate,
            cpu: asset.cpu,
            ram: asset.ram,
            storage: asset.storage,
            current_counter: asset.currentCounter // Update current_counter
        };
        const { error } = await supabase.from('assets').update(payload).eq('id', asset.id);
        if (error) return { success: false, error: error.message };
        return { success: true };
    },

    // Legacy Bulk Update
    bulkUpdateAssets: async (assetIds: string[], updates: Partial<Asset>): Promise<{ success: boolean; error?: string }> => {
        try {
            const payload: any = {};
            if (updates.status) payload.status = updates.status;
            if (updates.projectId) payload.project_id = updates.projectId;
            if (updates.lastAuditDate) payload.last_audit_date = updates.lastAuditDate;
            if (updates.auditedBy) payload.audited_by = updates.auditedBy;
            if (updates.assignedUser) payload.assigned_user = updates.assignedUser;
            if (updates.physicalLocation) payload.location = updates.physicalLocation;
            const { error } = await supabase.from('assets').update(payload).in('id', assetIds);
            if (error) return { success: false, error: error.message };
            return { success: true };
        } catch (err: any) { return { success: false, error: err.message }; }
    },

    verifyAsset: async (assetId: string, userId: string): Promise<{ success: boolean; error?: string }> => {
        const { error } = await supabase.from('assets').update({ last_audit_date: new Date().toISOString(), audited_by: userId }).eq('id', assetId);
        if (error) return { success: false, error: error.message };
        return { success: true };
    },

    deleteAssets: async (assetIds: string[]): Promise<{ success: boolean; error?: string }> => {
        try {
            await supabase.from('maintenance_requests').delete().in('asset_id', assetIds);
            await supabase.from('tickets').delete().in('assetid', assetIds);
            const { error } = await supabase.from('assets').delete().in('id', assetIds);
            if (error) return { success: false, error: error.message };
            return { success: true };
        } catch (err: any) { return { success: false, error: err.message }; }
    },

    // --- Maintenance Requests ---
    getMaintenanceRequests: async (projectId?: string, status?: string): Promise<(MaintenanceRequest & { assetName: string, supervisorName: string })[]> => {
        let query = supabase.from('maintenance_requests').select('*, assets(name), profiles!supervisor_id(name)');
        if (projectId && projectId !== 'all') query = query.eq('project_id', projectId);
        if (status) query = query.eq('status', status);
        const { data } = await query;
        return (data || []).map((r: any) => ({
            id: r.id, assetId: r.asset_id, supervisorId: r.supervisor_id, projectId: r.project_id, priority: r.priority, description: r.description, status: r.status, createdAt: r.created_at, assetName: r.assets?.name || 'Unknown', supervisorName: r.profiles?.name || 'Unknown'
        }));
    },

    createMaintenanceRequest: async (request: MaintenanceRequest): Promise<{ success: boolean; error?: string }> => {
        const payload = { asset_id: request.assetId, supervisor_id: request.supervisorId, project_id: request.projectId, priority: request.priority, description: request.description, status: request.status };
        const { error } = await supabase.from('maintenance_requests').insert(payload);
        if (error) return { success: false, error: error.message };
        return { success: true };
    },

    updateMaintenanceRequestStatus: async (id: string, status: 'pending' | 'in_progress' | 'completed'): Promise<boolean> => {
        const { error } = await supabase.from('maintenance_requests').update({ status }).eq('id', id);
        return !error;
    },

    // --- Tickets ---
    getTickets: async (user: User): Promise<Ticket[]> => {
        let query = supabase.from('tickets').select('*');
        if (user.role === 'supervisor') { query = query.eq('created_by', user.id); }
        else if (user.role === 'project_manager') { query = query.or(`created_by.eq.${user.id},pmid.eq.${user.id}`); }

        const { data, error } = await query;
        if (error || !data) {
            console.error("Error fetching tickets:", error);
            return [];
        }

        // Manually fetch related assets and profiles due to missing foreign keys in DB
        const assetIds = [...new Set(data.map((t: any) => t.assetid).filter(Boolean))];
        const profileIds = [...new Set(data.map((t: any) => t.created_by).filter(Boolean))];
        const projectIds = [...new Set(data.map((t: any) => t.projectid).filter(Boolean))];

        let assetsMap: Record<string, string> = {};
        let profilesMap: Record<string, string> = {};
        let projectsMap: Record<string, string> = {};

        if (assetIds.length > 0) {
            const { data: assetsData } = await supabase.from('assets').select('id, name').in('id', assetIds);
            if (assetsData) {
                assetsData.forEach((a: any) => { assetsMap[a.id] = a.name; });
            }
        }

        if (profileIds.length > 0) {
            const { data: profilesData } = await supabase.from('profiles').select('id, name').in('id', profileIds as string[]);
            if (profilesData) {
                profilesData.forEach((p: any) => { profilesMap[p.id] = p.name; });
            }
        }

        if (projectIds.length > 0) {
            const { data: projectsData } = await supabase.from('projects').select('id, name').in('id', projectIds as string[]);
            if (projectsData) {
                projectsData.forEach((p: any) => { projectsMap[p.id] = p.name; });
            }
        }

        return data.map((t: any) => ({
            id: t.id,
            title: t.title,
            category: t.category,
            assetId: t.assetid,
            assetName: assetsMap[t.assetid] || 'Unknown',
            description: t.description,
            priority: t.priority,
            status: t.status,
            createdBy: t.created_by,
            creatorName: profilesMap[t.created_by] || 'Unknown',
            pmId: t.pmid || t.pm_id,
            projectId: t.projectid,
            projectName: projectsMap[t.projectid] || 'Unknown',
            createdAt: t.createdat,
            solvedAt: t.solvedat,
            closedAt: t.closedat,
            cost: t.cost
        }));
    },
    createTicket: async (ticket: Partial<Ticket>): Promise<{ success: boolean; error?: string }> => {
        let pmId = '';
        if (ticket.projectId) {
            const { data } = await supabase.from('projects').select('pm_id').eq('id', ticket.projectId).single();
            if (data) pmId = data.pm_id;
        }

        const payload: any = {
            title: ticket.title,
            category: ticket.category,
            description: ticket.description,
            priority: ticket.priority,
            status: 'open',
            created_by: ticket.createdBy
        };

        if (ticket.projectId) payload.projectid = ticket.projectId;
        if (ticket.assetId) payload.assetid = ticket.assetId;
        if (pmId) payload.pmid = pmId;

        const { data, error } = await supabase.from('tickets').insert(payload).select().single();
        if (error) return { success: false, error: error.message };

        // Send Notification (Replacing broken DB Trigger)
        try {
            // Ensure pm_id is included as expected by the edge function logic if present
            await supabase.functions.invoke('ticket-notification', {
                body: { record: { ...data, pm_id: pmId || undefined } }
            });
        } catch (err) {
            console.error("Failed to invoke edge function:", err);
        }

        return { success: true };
    },

    updateTicketStatus: async (id: string, status: 'open' | 'in_progress' | 'solved' | 'closed', cost?: number): Promise<boolean> => {
        const updates: any = { status };
        if (status === 'solved') {
            updates.solvedat = new Date().toISOString();
            if (cost !== undefined) updates.cost = cost;
        }
        if (status === 'closed') updates.closedat = new Date().toISOString();
        if (status === 'open') {
            updates.solvedat = null;
            updates.closedat = null;
        }

        // 1. Fetch current ticket to get required context for notification
        const { data: ticket } = await supabase.from('tickets').select('*').eq('id', id).single();

        // 2. Perform Update
        const { error } = await supabase.from('tickets').update(updates).eq('id', id);

        if (!error && ticket) {
            // 3. Send Notification Exception
            try {
                await supabase.functions.invoke('ticket-notification', {
                    body: {
                        record: ticket,
                        action: 'status_change',
                        newStatus: status
                    }
                });
            } catch (err) {
                console.error("Failed to invoke edge function for status update:", err);
            }
        }
        return !error;
    },

    updateTicket: async (id: string, updates: Partial<Ticket>): Promise<boolean> => {
        const payload: any = {};
        if (updates.title) payload.title = updates.title;
        if (updates.category) payload.category = updates.category;
        if (updates.priority) payload.priority = updates.priority;
        if (updates.description) payload.description = updates.description;
        if (updates.status) payload.status = updates.status;
        if (updates.cost !== undefined) payload.cost = updates.cost;

        const { error } = await supabase.from('tickets').update(payload).eq('id', id);
        return !error;
    },

    deleteTickets: async (ids: string[]): Promise<boolean> => {
        const { error } = await supabase.from('tickets').delete().in('id', ids);
        return !error;
    }
};
