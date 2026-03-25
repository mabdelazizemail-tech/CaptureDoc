-- Migration: Add vacation balance to hr_update_employee RPC
-- Created at: 2026-03-25 18:20:00

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
  p_status text DEFAULT 'active',
  p_target_volume numeric DEFAULT NULL,
  p_transfer_account_number text DEFAULT NULL,
  p_transfer_account_type text DEFAULT NULL,
  p_annual_leave_balance integer DEFAULT NULL
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
      hire_date, job_title, department, project, basic_salary, variable_salary, target_volume,
      employee_code, address, insurance_number, insurance_date, insurance_salary, status,
      transfer_account_number, transfer_account_type, annual_leave_balance
    ) VALUES (
      p_full_name, p_email, p_phone, p_national_id, p_gender, p_date_of_birth, p_education,
      p_hire_date, p_job_title, p_department, p_project, p_basic_salary, p_variable_salary, p_target_volume,
      p_employee_code, p_address, p_insurance_number, p_insurance_date, p_insurance_salary, p_status,
      p_transfer_account_number, p_transfer_account_type, COALESCE(p_annual_leave_balance, 21)
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
      target_volume = EXCLUDED.target_volume,
      employee_code = EXCLUDED.employee_code,
      address = EXCLUDED.address,
      insurance_number = EXCLUDED.insurance_number,
      insurance_date = EXCLUDED.insurance_date,
      insurance_salary = EXCLUDED.insurance_salary,
      status = EXCLUDED.status,
      transfer_account_number = EXCLUDED.transfer_account_number,
      transfer_account_type = EXCLUDED.transfer_account_type,
      annual_leave_balance = EXCLUDED.annual_leave_balance,
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
      target_volume = p_target_volume,
      employee_code = p_employee_code,
      address = p_address,
      insurance_number = p_insurance_number,
      insurance_date = p_insurance_date,
      insurance_salary = p_insurance_salary,
      status = p_status,
      transfer_account_number = p_transfer_account_number,
      transfer_account_type = p_transfer_account_type,
      annual_leave_balance = COALESCE(p_annual_leave_balance, annual_leave_balance),
      updated_at = timezone('utc'::text, now())
    WHERE id = p_id;
  END IF;
END;
$$;
