-- Migration to support new salary calculation logic
ALTER TABLE public.hr_payroll
ADD COLUMN IF NOT EXISTS overtime_hours numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS absence_days numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS penalty_days numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS taxes numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS insurance numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS martyrs numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS gross_salary numeric DEFAULT 0;
