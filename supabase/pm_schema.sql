-- ==========================================
-- PROJECT MANAGEMENT MODULE SCHEMA
-- ==========================================

-- 1. Extend the projects table
ALTER TABLE public.projects 
  ADD COLUMN IF NOT EXISTS contract_total_volume integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS per_unit_price numeric DEFAULT 0;

-- 2. Site_Logs (Daily entries of volume processed)
CREATE TABLE IF NOT EXISTS public.pm_site_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
    log_date date NOT NULL DEFAULT CURRENT_DATE,
    prep_volume integer DEFAULT 0,
    scan_volume integer DEFAULT 0,
    qc_volume integer DEFAULT 0,
    index_volume integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(project_id, log_date)
);

-- 3. Expenses (Site-specific costs)
CREATE TABLE IF NOT EXISTS public.pm_expenses (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
    expense_date date NOT NULL,
    category text CHECK (category IN ('rent', 'utilities', 'hardware_maintenance', 'other')),
    amount numeric NOT NULL CHECK (amount > 0),
    description text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Timesheets (Integrated with production logs)
CREATE TABLE IF NOT EXISTS public.pm_timesheets (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id uuid REFERENCES public.hr_employees(id) ON DELETE CASCADE,
    project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
    work_date date NOT NULL,
    hours_worked numeric NOT NULL CHECK (hours_worked > 0),
    role_in_project text, -- e.g., 'Prep', 'Scan', 'QC', 'Index'
    volume_processed integer DEFAULT 0, -- Individual contribution
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(employee_id, project_id, work_date)
);

-- 5. Inventory Tracking (Track volume by document type)
CREATE TABLE IF NOT EXISTS public.pm_inventory (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
    document_type text CHECK (document_type IN ('A4', 'Blueprints', 'Bound Books', 'Other')),
    total_volume integer DEFAULT 0,
    processed_volume integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(project_id, document_type)
);

-- ==========================================
-- ROW LEVEL SECURITY
-- ==========================================
ALTER TABLE public.pm_site_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pm_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pm_timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pm_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read access pm_site_logs" ON public.pm_site_logs FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "All access pm_site_logs admins" ON public.pm_site_logs FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id::text = auth.uid()::text AND role IN ('super_admin', 'power_admin', 'project_manager'))
);

CREATE POLICY "Read access pm_expenses" ON public.pm_expenses FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "All access pm_expenses admins" ON public.pm_expenses FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id::text = auth.uid()::text AND role IN ('super_admin', 'power_admin', 'project_manager'))
);

CREATE POLICY "Read access pm_timesheets" ON public.pm_timesheets FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "All access pm_timesheets admins" ON public.pm_timesheets FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id::text = auth.uid()::text AND role IN ('super_admin', 'power_admin', 'project_manager', 'hr_admin'))
);

CREATE POLICY "Read access pm_inventory" ON public.pm_inventory FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "All access pm_inventory admins" ON public.pm_inventory FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id::text = auth.uid()::text AND role IN ('super_admin', 'power_admin', 'project_manager'))
);
