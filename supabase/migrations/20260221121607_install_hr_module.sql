-- ======================================================================================
-- HR MODULE: EMPLOYEES & DEPARTMENTS
-- ======================================================================================

-- 1. Departments Table
CREATE TABLE IF NOT EXISTS public.departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    manager_id UUID,
    project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Job Titles Table
CREATE TABLE IF NOT EXISTS public.job_titles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Employees Core Table
CREATE TABLE IF NOT EXISTS public.employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Personal Details
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    national_id VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50),
    date_of_birth DATE,
    gender VARCHAR(20),
    marital_status VARCHAR(50),
    address TEXT,
    emergency_contact TEXT,
    
    -- Employment Details
    hire_date DATE NOT NULL,
    employment_type VARCHAR(50) NOT NULL,
    department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
    job_title_id UUID REFERENCES public.job_titles(id) ON DELETE SET NULL,
    manager_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
    work_location VARCHAR(255),
    
    status VARCHAR(50) DEFAULT 'active',
    probation_end_date DATE,
    
    -- User Linking (Optional, if they log into the system)
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Resolve Manager FK for Departments (now that Employees exists)
ALTER TABLE public.departments
DROP CONSTRAINT IF EXISTS fk_dept_manager,
ADD CONSTRAINT fk_dept_manager
FOREIGN KEY (manager_id) REFERENCES public.employees(id) ON DELETE SET NULL;


-- ======================================================================================
-- ROW LEVEL SECURITY (RLS)
-- ======================================================================================

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_titles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

-- Departments RLS
CREATE POLICY "Allow authenticated read for departments" ON public.departments 
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow HR/Admins to mutate departments" ON public.departments 
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.id = auth.uid() 
        AND users.role IN ('super_admin', 'power_admin', 'project_manager')
    )
);

-- Job Titles RLS
CREATE POLICY "Allow authenticated read for job titles" ON public.job_titles 
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow HR/Admins to mutate job titles" ON public.job_titles 
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.id = auth.uid() 
        AND users.role IN ('super_admin', 'power_admin', 'project_manager')
    )
);

-- Employees RLS
-- 1. Everyone can view public employee profiles in their project
CREATE POLICY "Users can view employees in their project" ON public.employees
FOR SELECT USING (
    auth.role() = 'authenticated' AND (
        project_id IN (SELECT project_id FROM public.users WHERE id = auth.uid())
        OR 
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('super_admin', 'power_admin'))
    )
);

-- 2. HR/Admins can mutate all employees in their project
CREATE POLICY "HR/Admins can manage employees" ON public.employees
FOR ALL USING (
    auth.role() = 'authenticated' AND (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role IN ('super_admin', 'power_admin')
        )
        OR
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE users.id = auth.uid() 
            AND users.role = 'project_manager'
            AND users.project_id = employees.project_id
        )
    )
);
