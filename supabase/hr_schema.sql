-- 1. HR PROFILES (Users and Roles)
CREATE TABLE public.hr_profiles (
  id uuid REFERENCES auth.users NOT NULL PRIMARY KEY,
  full_name text,
  role text CHECK (role IN ('admin', 'user')) DEFAULT 'user',
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

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
CREATE OR REPLACE FUNCTION get_dashboard_metrics()
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
BEGIN
  SELECT count(*) INTO v_total_employees FROM public.hr_employees;
  SELECT count(*) INTO v_active_employees FROM public.hr_employees WHERE status = 'active';
  
  SELECT count(*) INTO v_attendance_today FROM public.hr_attendance WHERE date = CURRENT_DATE;
  
  SELECT count(*) INTO v_on_leave_today FROM public.hr_leave_requests 
  WHERE status = 'approved' AND CURRENT_DATE BETWEEN start_date AND end_date;
  
  current_month := to_char(CURRENT_DATE, 'YYYY-MM');
  SELECT COALESCE(sum(net_salary), 0) INTO v_payroll_current FROM public.hr_payroll WHERE month = current_month;

  RETURN json_build_object(
    'total_employees', v_total_employees,
    'active_employees', v_active_employees,
    'attendance_today_count', v_attendance_today,
    'employees_on_leave_today', v_on_leave_today,
    'payroll_total_current_month', v_payroll_current
  );
END;
$$;

-- 8. UPDATE EMPLOYEE (RPC to handle upserting/updating employee data securely)
CREATE OR REPLACE FUNCTION public.hr_update_employee(
  p_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_national_id text,
  p_gender text,
  p_date_of_birth date,
  p_education text,
  p_hire_date date,
  p_job_title text,
  p_department text,
  p_project text,
  p_basic_salary numeric,
  p_variable_salary numeric,
  p_employee_code text,
  p_address text,
  p_insurance_number text,
  p_insurance_date date,
  p_insurance_salary numeric,
  p_status text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- We assume standard RLS handles access control, but since it's SECURITY DEFINER,
  -- we might want to manually check if the caller is an admin.
  IF NOT EXISTS (
    SELECT 1 FROM public.hr_profiles
    WHERE id::text = auth.uid()::text AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only HR admins can update employees';
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

-- 9. DELETE EMPLOYEES (RPC to handle bulk deletion safely)
CREATE OR REPLACE FUNCTION public.hr_delete_employees(p_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- We assume standard RLS handles access control, but since it's SECURITY DEFINER,
  -- we might want to manually check if the caller is an admin.
  IF NOT EXISTS (
    SELECT 1 FROM public.hr_profiles
    WHERE id::text = auth.uid()::text AND role = 'admin'
  ) THEN
    -- Fallback to check if they are super_admin in profiles table, just in case
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id::text = auth.uid()::text AND role IN ('super_admin', 'power_admin', 'it_specialist')
    ) THEN
        RAISE EXCEPTION 'Only HR admins can delete employees';
    END IF;
  END IF;

  DELETE FROM public.hr_employees WHERE id = ANY(p_ids);
END;
$$;
