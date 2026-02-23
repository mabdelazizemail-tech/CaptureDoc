-- HR MODULE SCHEMA


-- 2. EMPLOYEES
CREATE TABLE public.hr_employees (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name text NOT NULL,
  email text UNIQUE NOT NULL,
  phone text,
  national_id text,
  employee_code text,
  address text,
  insurance_number text,
  insurance_date date,
  insurance_salary numeric DEFAULT 0,
  gender text CHECK (gender IN ('male', 'female', 'other')),
  date_of_birth date,
  education text,
  hire_date date NOT NULL,
  job_title text,
  department text,
  project text,
  basic_salary numeric NOT NULL CHECK (basic_salary > 0),
  variable_salary numeric DEFAULT 0,
  annual_leave_balance integer DEFAULT 21,
  status text CHECK (status IN ('active', 'inactive')) DEFAULT 'active',
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. ATTENDANCE
CREATE TABLE public.hr_attendance (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id uuid REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  date date NOT NULL,
  check_in time without time zone,
  check_out time without time zone,
  late_minutes integer DEFAULT 0,
  overtime_minutes integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(employee_id, date) -- Business Rule: No duplicated attendance per employee per date
);

-- 4. LEAVE BALANCES
CREATE TABLE public.hr_leave_balances (
  employee_id uuid REFERENCES public.hr_employees(id) ON DELETE CASCADE PRIMARY KEY,
  annual_balance numeric DEFAULT 21,
  sick_balance numeric DEFAULT 10
);

-- Note: Auto-create leave balances when a new active employee is inserted.
CREATE OR REPLACE FUNCTION public.create_leave_balances()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.hr_leave_balances (employee_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_employee_created
  AFTER INSERT ON public.hr_employees
  FOR EACH ROW EXECUTE PROCEDURE public.create_leave_balances();

-- 5. LEAVE REQUESTS
CREATE TABLE public.hr_leave_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id uuid REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  leave_type text CHECK (leave_type IN ('annual', 'sick', 'unpaid')) NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  total_days integer NOT NULL CHECK (total_days > 0),
  status text CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. PAYROLL
CREATE TABLE public.hr_payroll (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id uuid REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  month text NOT NULL, -- Format: YYYY-MM
  basic_salary numeric NOT NULL,
  overtime_amount numeric DEFAULT 0,
  late_deduction numeric DEFAULT 0,
  net_salary numeric NOT NULL,
  status text CHECK (status IN ('draft', 'finalized')) DEFAULT 'draft',
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(employee_id, month) -- Business Rule: Prevent duplicate payroll for same employee/month
);

-- 7. DASHBOARD ENDPOINT (RPC View)
CREATE OR REPLACE FUNCTION get_dashboard_metrics(p_project_id text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_employees INTEGER;
  v_active_employees INTEGER;
  v_attendance_today INTEGER;
  v_on_leave_today INTEGER;
  v_payroll_current NUMERIC;
  current_month TEXT;
  v_project_name TEXT;
BEGIN
  -- Get project name if ID is provided
  IF p_project_id IS NOT NULL AND p_project_id != '' THEN
    SELECT name INTO v_project_name FROM public.projects WHERE id::text = p_project_id OR name = p_project_id LIMIT 1;
  END IF;

  SELECT count(*) INTO v_total_employees FROM public.hr_employees
  WHERE (v_project_name IS NULL OR project = v_project_name OR project = p_project_id);
  
  SELECT count(*) INTO v_active_employees FROM public.hr_employees 
  WHERE status = 'active' AND (v_project_name IS NULL OR project = v_project_name OR project = p_project_id);
  
  SELECT count(*) INTO v_attendance_today FROM public.hr_attendance a
  JOIN public.hr_employees e ON e.id = a.employee_id
  WHERE a.date = CURRENT_DATE AND (v_project_name IS NULL OR e.project = v_project_name OR e.project = p_project_id);
  
  SELECT count(*) INTO v_on_leave_today FROM public.hr_leave_requests l
  JOIN public.hr_employees e ON e.id = l.employee_id
  WHERE l.status = 'approved' AND CURRENT_DATE BETWEEN l.start_date AND l.end_date
  AND (v_project_name IS NULL OR e.project = v_project_name OR e.project = p_project_id);
  
  current_month := to_char(CURRENT_DATE, 'YYYY-MM');
  SELECT COALESCE(sum(p.net_salary), 0) INTO v_payroll_current FROM public.hr_payroll p
  JOIN public.hr_employees e ON e.id = p.employee_id
  WHERE p.month = current_month AND (v_project_name IS NULL OR e.project = v_project_name OR e.project = p_project_id);

  RETURN json_build_object(
    'total_employees', v_total_employees,
    'active_employees', v_active_employees,
    'attendance_today_count', v_attendance_today,
    'employees_on_leave_today', v_on_leave_today,
    'payroll_total_current_month', v_payroll_current,
    'project_filter', COALESCE(v_project_name, 'All')
  );
END;
$$;

-- 8. UPDATE EMPLOYEE (RPC to handle upserting/updating employee data securely)
CREATE OR REPLACE FUNCTION public.hr_update_employee(
  p_id uuid DEFAULT NULL,
  p_full_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_national_id text DEFAULT NULL,
  p_gender text DEFAULT NULL,
  p_date_of_birth date DEFAULT NULL,
  p_education text DEFAULT NULL,
  p_hire_date date DEFAULT NULL,
  p_job_title text DEFAULT NULL,
  p_department text DEFAULT NULL,
  p_project text DEFAULT NULL,
  p_basic_salary numeric DEFAULT NULL,
  p_variable_salary numeric DEFAULT NULL,
  p_employee_code text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_insurance_number text DEFAULT NULL,
  p_insurance_date date DEFAULT NULL,
  p_insurance_salary numeric DEFAULT NULL,
  p_status text DEFAULT 'active'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check if user is HR admin using helper function
  IF NOT public.is_hr_admin() THEN
    RAISE EXCEPTION 'Only system admins can manage employees';
  END IF;

  IF p_id IS NULL THEN
    -- Insert new employee or update if email already exists
    INSERT INTO public.hr_employees (
      full_name, email, phone, national_id, gender, date_of_birth, education,
      hire_date, job_title, department, project, basic_salary, variable_salary,
      employee_code, address, insurance_number, insurance_date, insurance_salary, status
    ) VALUES (
      p_full_name, p_email, p_phone, p_national_id, p_gender, p_date_of_birth, p_education,
      p_hire_date, p_job_title, p_department, p_project, p_basic_salary, p_variable_salary,
      p_employee_code, p_address, p_insurance_number, p_insurance_date, p_insurance_salary, p_status
    )
    ON CONFLICT (email) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      phone = EXCLUDED.phone,
      national_id = EXCLUDED.national_id,
      gender = EXCLUDED.gender,
      date_of_birth = EXCLUDED.date_of_birth,
      education = EXCLUDED.education,
      hire_date = EXCLUDED.hire_date,
      job_title = EXCLUDED.job_title,
      department = EXCLUDED.department,
      project = EXCLUDED.project,
      basic_salary = EXCLUDED.basic_salary,
      variable_salary = EXCLUDED.variable_salary,
      employee_code = EXCLUDED.employee_code,
      address = EXCLUDED.address,
      insurance_number = EXCLUDED.insurance_number,
      insurance_date = EXCLUDED.insurance_date,
      insurance_salary = EXCLUDED.insurance_salary,
      status = EXCLUDED.status,
      updated_at = timezone('utc'::text, now());
  ELSE
    -- Update existing employee
    UPDATE public.hr_employees SET
      full_name = p_full_name,
      email = p_email,
      phone = p_phone,
      national_id = p_national_id,
      gender = p_gender,
      date_of_birth = p_date_of_birth,
      education = p_education,
      hire_date = p_hire_date,
      job_title = p_job_title,
      department = p_department,
      project = p_project,
      basic_salary = p_basic_salary,
      variable_salary = p_variable_salary,
      employee_code = p_employee_code,
      address = p_address,
      insurance_number = p_insurance_number,
      insurance_date = p_insurance_date,
      insurance_salary = p_insurance_salary,
      status = p_status,
      updated_at = timezone('utc'::text, now())
    WHERE id = p_id;
  END IF;
END;
$$;

-- 8.1 APPROVE LEAVE (RPC to handle balance deduction automatically)
CREATE OR REPLACE FUNCTION public.hr_approve_leave(p_leave_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_total_days integer;
    v_employee_id uuid;
    v_balance integer;
    v_status text;
BEGIN
    -- Get request info and lock the row for update
    SELECT total_days, employee_id, status 
    INTO v_total_days, v_employee_id, v_status
    FROM public.hr_leave_requests
    WHERE id = p_leave_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Leave request not found';
    END IF;

    IF v_status != 'pending' THEN
        RAISE EXCEPTION 'Only pending requests can be approved';
    END IF;

    -- Check employee status
    IF NOT EXISTS (SELECT 1 FROM public.hr_employees WHERE id = v_employee_id AND status = 'active') THEN
        RAISE EXCEPTION 'Cannot approve leave for inactive employee';
    END IF;

    -- Get current balance
    SELECT annual_leave_balance INTO v_balance
    FROM public.hr_employees
    WHERE id = v_employee_id
    FOR UPDATE;

    IF v_balance < v_total_days THEN
        RAISE EXCEPTION 'Insufficient leave balance. Remaining: %, Required: %', v_balance, v_total_days;
    END IF;

    -- Update balance
    UPDATE public.hr_employees
    SET annual_leave_balance = annual_leave_balance - v_total_days
    WHERE id = v_employee_id;

    -- Update status
    UPDATE public.hr_leave_requests
    SET status = 'approved'
    WHERE id = p_leave_id;
END;
$$;

-- 8.2 REJECT LEAVE
CREATE OR REPLACE FUNCTION public.hr_reject_leave(p_leave_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.hr_leave_requests
    SET status = 'rejected'
    WHERE id = p_leave_id AND status = 'pending';
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Leave request not found or not in pending status';
    END IF;
END;
$$;

-- 9. DELETE EMPLOYEES (RPC to handle bulk deletion safely)
CREATE OR REPLACE FUNCTION public.hr_delete_employees(p_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.is_hr_admin() THEN
    RAISE EXCEPTION 'Only system admins can delete employees';
  END IF;

  DELETE FROM public.hr_employees WHERE id = ANY(p_ids);
END;
$$;

-- 10. HR KPIs (Performance Tracking)
CREATE TABLE public.hr_kpis (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id uuid REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  month text NOT NULL, -- Format: YYYY-MM
  productivity_score numeric DEFAULT 0 CHECK (productivity_score >= 0 AND productivity_score <= 100),
  quality_score numeric DEFAULT 0 CHECK (quality_score >= 0 AND quality_score <= 100),
  attendance_score numeric DEFAULT 0 CHECK (attendance_score >= 0 AND attendance_score <= 100),
  commitment_score numeric DEFAULT 0 CHECK (commitment_score >= 0 AND commitment_score <= 100),
  notes text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(employee_id, month)
);

-- Enable RLS on core tables
ALTER TABLE public.hr_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_kpis ENABLE ROW LEVEL SECURITY;

-- Policy for hr_employees
CREATE POLICY "Employees access policy" ON public.hr_employees
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    LEFT JOIN public.projects pr ON pr.id = p.project_id
    WHERE p.id = auth.uid() AND (
      p.role IN ('super_admin', 'power_admin', 'it_specialist', 'hr_admin') OR 
      (p.role = 'project_manager' AND (pr.name = hr_employees.project OR p.project_id::text = hr_employees.project))
    )
  )
);

-- Policy for hr_attendance
CREATE POLICY "Attendance access policy" ON public.hr_attendance
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.hr_employees e ON e.id = hr_attendance.employee_id
    LEFT JOIN public.projects pr ON pr.id = p.project_id
    WHERE p.id = auth.uid() AND (
      p.role IN ('super_admin', 'power_admin', 'it_specialist', 'hr_admin') OR 
      (p.role = 'project_manager' AND (pr.name = e.project OR p.project_id::text = e.project))
    )
  )
);

-- Policy for hr_kpis
CREATE POLICY "KPIs access policy" ON public.hr_kpis
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.hr_employees e ON e.id = hr_kpis.employee_id
    LEFT JOIN public.projects pr ON pr.id = p.project_id
    WHERE p.id = auth.uid() AND (
      p.role IN ('super_admin', 'power_admin', 'it_specialist', 'hr_admin') OR 
      (p.role = 'project_manager' AND (pr.name = e.project OR p.project_id::text = e.project))
    )
  )
);


-- 11. HR HOLIDAYS
CREATE TABLE public.hr_holidays (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  type text CHECK (type IN ('public', 'company')) DEFAULT 'public',
  description text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on holidays
ALTER TABLE public.hr_holidays ENABLE ROW LEVEL SECURITY;

-- Policy for hr_holidays
CREATE POLICY "Anyone can view holidays" ON public.hr_holidays
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Admins can manage holidays" ON public.hr_holidays
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('super_admin', 'power_admin', 'it_specialist', 'hr_admin')
  )
);
