-- Migration: Transition KPIs and Project Volumes to Daily Basis
-- Renaming 'month' to 'date' and updating unique constraints.

-- 1. Update hr_kpis
ALTER TABLE public.hr_kpis RENAME COLUMN month TO date;

-- Drop old unique constraint (standard naming)
ALTER TABLE public.hr_kpis DROP CONSTRAINT IF EXISTS hr_kpis_employee_id_month_key;

-- Add new unique constraint for employee_id and date
ALTER TABLE public.hr_kpis ADD CONSTRAINT hr_kpis_employee_id_date_key UNIQUE(employee_id, date);

-- 2. Update hr_project_kpis
ALTER TABLE public.hr_project_kpis RENAME COLUMN month TO date;

-- Drop old unique constraint
ALTER TABLE public.hr_project_kpis DROP CONSTRAINT IF EXISTS hr_project_kpis_project_id_month_key;

-- Add new unique constraint for project_id and date
ALTER TABLE public.hr_project_kpis ADD CONSTRAINT hr_project_kpis_project_id_date_key UNIQUE(project_id, date);

-- 3. Update existing data if any (assuming 'YYYY-MM' becomes 'YYYY-MM-01')
-- If 'date' is still text, this is safe. 
-- If we want to change it to DATE type, we should do it now. 
-- The original was TEXT. Let's keep it as TEXT for simplicity or change to DATE.
-- In hr_schema.sql it was 'text NOT NULL'. 
-- Let's change it to DATE type to be more robust.

ALTER TABLE public.hr_kpis ALTER COLUMN date TYPE date USING (
  CASE 
    WHEN date ~ '^\d{4}-\d{2}$' THEN (date || '-01')::date
    ELSE date::date
  END
);

ALTER TABLE public.hr_project_kpis ALTER COLUMN date TYPE date USING (
  CASE 
    WHEN date ~ '^\d{4}-\d{2}$' THEN (date || '-01')::date
    ELSE date::date
  END
);
