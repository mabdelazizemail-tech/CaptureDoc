-- Enable RLS for hr_payroll
ALTER TABLE public.hr_payroll ENABLE ROW LEVEL SECURITY;

-- Payroll Policies
DROP POLICY IF EXISTS "Admins can manage payroll" ON public.hr_payroll;
CREATE POLICY "Admins can manage payroll" ON public.hr_payroll 
FOR ALL USING (public.is_hr_admin());

DROP POLICY IF EXISTS "Users can view finalized payroll" ON public.hr_payroll;
CREATE POLICY "Users can view finalized payroll" ON public.hr_payroll 
FOR SELECT USING (status = 'finalized' OR public.is_hr_admin());

DROP POLICY IF EXISTS "Prevent editing finalized payroll" ON public.hr_payroll;
CREATE POLICY "Prevent editing finalized payroll" ON public.hr_payroll 
FOR UPDATE USING (status != 'finalized');
