-- Migration: Upgrade payroll engine with absence code 233, stop-salary flag, working days
-- Created at: 2026-03-29 07:10:00

-- 1. Add absence_233 (Stop Salary / غياب جزاء إيقاف)
ALTER TABLE public.hr_payroll
  ADD COLUMN IF NOT EXISTS absence_233 numeric(5,2) DEFAULT 0;

-- 2. Add stop_salary_flag boolean
ALTER TABLE public.hr_payroll
  ADD COLUMN IF NOT EXISTS stop_salary_flag boolean DEFAULT false;

-- 3. Add weighted_absence (derived metric, stored for audit)
ALTER TABLE public.hr_payroll
  ADD COLUMN IF NOT EXISTS weighted_absence numeric(5,2) DEFAULT 0;

-- 4. Add working_days (actual working days in the month, default 30)
ALTER TABLE public.hr_payroll
  ADD COLUMN IF NOT EXISTS working_days integer DEFAULT 30;

-- 5. Add audit columns
ALTER TABLE public.hr_payroll
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS rule_version text DEFAULT '2.0',
  ADD COLUMN IF NOT EXISTS flags text[] DEFAULT '{}';

-- 6. Comments for clarity
COMMENT ON COLUMN public.hr_payroll.absence_233    IS 'Stop-salary disciplinary absence days (Code 233)';
COMMENT ON COLUMN public.hr_payroll.stop_salary_flag IS 'TRUE when absence_233 > 0 — triggers full salary stop review';
COMMENT ON COLUMN public.hr_payroll.weighted_absence IS 'absence_days * 2, used as a trigger metric for penalty rules';
COMMENT ON COLUMN public.hr_payroll.working_days    IS 'Actual working / calendar days used for daily-rate calculation';
COMMENT ON COLUMN public.hr_payroll.processed_at   IS 'Timestamp when payroll row was last recalculated';
COMMENT ON COLUMN public.hr_payroll.rule_version    IS 'Version of the RULES_CONFIG applied when this row was saved';
COMMENT ON COLUMN public.hr_payroll.flags           IS 'Array of active policy flags, e.g. STOP_SALARY, EXCESS_ABSENCE';
