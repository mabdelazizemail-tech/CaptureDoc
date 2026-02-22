-- Enable RLS
ALTER TABLE public.hr_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_payroll ENABLE ROW LEVEL SECURITY;

-- Helper Function to determine if user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.hr_profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Profiles Policies
CREATE POLICY "Users can read own profile" ON public.hr_profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Admins can manage profiles" ON public.hr_profiles FOR ALL USING (public.is_admin());

-- Employees Policies
CREATE POLICY "Users can view active employees" ON public.hr_employees FOR SELECT USING (status = 'active' OR public.is_admin());
CREATE POLICY "Admins can manage employees" ON public.hr_employees FOR ALL USING (public.is_admin());

-- Attendance Policies
CREATE POLICY "Users can view all attendance" ON public.hr_attendance FOR SELECT USING (TRUE);
CREATE POLICY "Admins can manage attendance" ON public.hr_attendance FOR ALL USING (public.is_admin());

-- Leave Balances Policies
CREATE POLICY "Users can view leave balances" ON public.hr_leave_balances FOR SELECT USING (TRUE);
CREATE POLICY "Admins can manage leave balances" ON public.hr_leave_balances FOR ALL USING (public.is_admin());

-- Leave Requests Policies
CREATE POLICY "Users can view leave requests" ON public.hr_leave_requests FOR SELECT USING (TRUE);
CREATE POLICY "Admins can manage leave requests" ON public.hr_leave_requests FOR ALL USING (public.is_admin());

-- Payroll Policies
CREATE POLICY "Users can view finalized payroll" ON public.hr_payroll FOR SELECT USING (status = 'finalized' OR public.is_admin());
CREATE POLICY "Admins can manage payroll" ON public.hr_payroll FOR ALL USING (public.is_admin());
-- Security Rule: Protect payroll from editing after finalization (only allow draft modifications or delete for finalized? Standard is prevent modify if finalized)
CREATE POLICY "Prevent editing finalized payroll" ON public.hr_payroll FOR UPDATE USING (status != 'finalized' OR (SELECT status FROM public.hr_payroll WHERE id = public.hr_payroll.id) != 'finalized');
