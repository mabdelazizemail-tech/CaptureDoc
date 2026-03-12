-- Migration to add contract details to projects and target volume to hr_employees
ALTER TABLE public.projects 
  ADD COLUMN IF NOT EXISTS contract_monthly_volume integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS click_charge numeric DEFAULT 0;

ALTER TABLE public.hr_employees
  ADD COLUMN IF NOT EXISTS target_volume integer DEFAULT 0;

ALTER TABLE public.hr_payroll
  ADD COLUMN IF NOT EXISTS target_achieved integer DEFAULT 0;
