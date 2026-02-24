-- Enable RLS
ALTER TABLE public.hr_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_payroll ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_kpis ENABLE ROW LEVEL SECURITY;

-- Helper Function to determine if user is system admin
CREATE OR REPLACE FUNCTION public.is_hr_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id::text = auth.uid()::text AND role IN ('super_admin', 'power_admin', 'it_specialist', 'hr_admin')
  ) OR (auth.role() = 'anon'); -- Allow master fallback in dev
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Employees Policies
DROP POLICY IF EXISTS "Employees access policy" ON public.hr_employees;
CREATE POLICY "Employees access policy" ON public.hr_employees
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    LEFT JOIN public.projects pr ON pr.id = p.project_id
    WHERE p.id::text = auth.uid()::text AND (
      p.role IN ('super_admin', 'power_admin', 'it_specialist', 'hr_admin') OR 
      (p.role = 'project_manager' AND (pr.name = hr_employees.project OR p.project_id::text = hr_employees.project))
    )
  ) OR (auth.role() = 'anon')
);

-- Attendance Policies
DROP POLICY IF EXISTS "Attendance access policy" ON public.hr_attendance;
CREATE POLICY "Attendance access policy" ON public.hr_attendance
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.hr_employees e ON e.id = hr_attendance.employee_id
    LEFT JOIN public.projects pr ON pr.id = p.project_id
    WHERE p.id::text = auth.uid()::text AND (
      p.role IN ('super_admin', 'power_admin', 'it_specialist', 'hr_admin') OR 
      (p.role = 'project_manager' AND (pr.name = e.project OR p.project_id::text = e.project))
    )
  ) OR (auth.role() = 'anon')
);

-- KPI Policies
DROP POLICY IF EXISTS "KPIs access policy" ON public.hr_kpis;
CREATE POLICY "KPIs access policy" ON public.hr_kpis
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.hr_employees e ON e.id = hr_kpis.employee_id
    LEFT JOIN public.projects pr ON pr.id = p.project_id
    WHERE p.id::text = auth.uid()::text AND (
      p.role IN ('super_admin', 'power_admin', 'it_specialist', 'hr_admin') OR 
      (p.role = 'project_manager' AND (pr.name = e.project OR p.project_id::text = e.project))
    )
  ) OR (auth.role() = 'anon')
);

-- Leave Balances Policies
DROP POLICY IF EXISTS "Admins can manage leave balances" ON public.hr_leave_balances;
CREATE POLICY "Admins can manage leave balances" ON public.hr_leave_balances FOR ALL USING (public.is_hr_admin());
DROP POLICY IF EXISTS "Users can view leave balances" ON public.hr_leave_balances;
CREATE POLICY "Users can view leave balances" ON public.hr_leave_balances FOR SELECT USING (TRUE);

-- Leave Requests Policies
DROP POLICY IF EXISTS "Users can view own leave requests" ON public.hr_leave_requests;
CREATE POLICY "Users can view own leave requests" ON public.hr_leave_requests
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.hr_employees e
    WHERE e.id::text = hr_leave_requests.employee_id::text
    AND (auth.uid()::text = e.id::text OR public.is_hr_admin())
  ) OR (auth.role() = 'anon')
);

DROP POLICY IF EXISTS "Users can create leave requests" ON public.hr_leave_requests;
CREATE POLICY "Users can create leave requests" ON public.hr_leave_requests
FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can manage leave requests" ON public.hr_leave_requests;
CREATE POLICY "Admins can manage leave requests" ON public.hr_leave_requests
FOR ALL USING (public.is_hr_admin());

-- Payroll Policies
DROP POLICY IF EXISTS "Admins can manage payroll" ON public.hr_payroll;
CREATE POLICY "Admins can manage payroll" ON public.hr_payroll FOR ALL USING (public.is_hr_admin());
DROP POLICY IF EXISTS "Users can view finalized payroll" ON public.hr_payroll;
CREATE POLICY "Users can view finalized payroll" ON public.hr_payroll FOR SELECT USING (status = 'finalized' OR public.is_hr_admin());
DROP POLICY IF EXISTS "Prevent editing finalized payroll" ON public.hr_payroll;
CREATE POLICY "Prevent editing finalized payroll" ON public.hr_payroll FOR UPDATE USING (status != 'finalized');
