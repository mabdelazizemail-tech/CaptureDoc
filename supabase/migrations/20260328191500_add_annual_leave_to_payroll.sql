-- Migration: Add annual leave to payroll and deduct from employee balance
-- Created at: 2026-03-28 19:15:00

-- 1. Add annual_leave column to hr_payroll
ALTER TABLE public.hr_payroll ADD COLUMN IF NOT EXISTS annual_leave integer DEFAULT 0;

-- 2. Create function to process annual leave deduction
CREATE OR REPLACE FUNCTION public.process_annual_leave_deduction()
RETURNS TRIGGER AS $$
DECLARE
  v_diff INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_diff := COALESCE(NEW.annual_leave, 0) - COALESCE(OLD.annual_leave, 0);
  ELSIF TG_OP = 'INSERT' THEN
    v_diff := COALESCE(NEW.annual_leave, 0);
  ELSIF TG_OP = 'DELETE' THEN
    v_diff := -COALESCE(OLD.annual_leave, 0);
  END IF;

  -- Only update if there's a difference and it is non-zero
  IF v_diff <> 0 THEN
    UPDATE public.hr_employees 
    SET annual_leave_balance = COALESCE(annual_leave_balance, 0) - v_diff
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.employee_id ELSE NEW.employee_id END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create trigger on hr_payroll
DROP TRIGGER IF EXISTS on_payroll_annual_leave_change ON public.hr_payroll;
CREATE TRIGGER on_payroll_annual_leave_change
  AFTER INSERT OR DELETE OR UPDATE OF annual_leave ON public.hr_payroll
  FOR EACH ROW EXECUTE PROCEDURE public.process_annual_leave_deduction();
