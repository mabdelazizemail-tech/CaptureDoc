-- Add columns if they don't exist
ALTER TABLE public.hr_employees ADD COLUMN IF NOT EXISTS transfer_account_number text;
ALTER TABLE public.hr_employees ADD COLUMN IF NOT EXISTS transfer_account_type text;

-- Update the RPC function
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
  p_transfer_account_type text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.is_hr_admin() THEN
    RAISE EXCEPTION 'Only system admins can manage employees';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.hr_employees (
      full_name, email, phone, national_id, gender, date_of_birth, education,
      hire_date, job_title, department, project, basic_salary, variable_salary, target_volume,
      employee_code, address, insurance_number, insurance_date, insurance_salary, status,
      transfer_account_number, transfer_account_type
    ) VALUES (
      p_full_name, p_email, p_phone, p_national_id, p_gender, p_date_of_birth, p_education,
      p_hire_date, p_job_title, p_department, p_project, p_basic_salary, p_variable_salary, p_target_volume,
      p_employee_code, p_address, p_insurance_number, p_insurance_date, p_insurance_salary, p_status,
      p_transfer_account_number, p_transfer_account_type
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
      updated_at = timezone('utc'::text, now());
  ELSE
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
      updated_at = timezone('utc'::text, now())
    WHERE id = p_id;
  END IF;
END;
$$;

-- Bulk Update Data
UPDATE public.hr_employees SET transfer_account_number = '01115472911', transfer_account_type = 'Dopay' WHERE employee_code = 'SFAMC-X001';
UPDATE public.hr_employees SET transfer_account_number = '01107393744', transfer_account_type = 'Dopay' WHERE employee_code = 'SFAMC-X002';
UPDATE public.hr_employees SET transfer_account_number = '01064319141', transfer_account_type = 'Dopay' WHERE employee_code = 'SFAMC-X003';
UPDATE public.hr_employees SET transfer_account_number = '01116523532', transfer_account_type = 'Dopay' WHERE employee_code = 'SFAMC-X004';
UPDATE public.hr_employees SET transfer_account_number = '01020530322', transfer_account_type = 'Dopay' WHERE employee_code = 'SFAMC-X005';
UPDATE public.hr_employees SET transfer_account_number = '01014654971', transfer_account_type = 'Dopay' WHERE employee_code = 'SFAMC-X006';
UPDATE public.hr_employees SET transfer_account_number = '01030914529', transfer_account_type = 'Dopay' WHERE employee_code = 'SFAMC-X007';
UPDATE public.hr_employees SET transfer_account_number = '5078034899783455', transfer_account_type = 'Dopay' WHERE employee_code = 'SFAMC-X008';
UPDATE public.hr_employees SET transfer_account_number = '01118148200', transfer_account_type = 'Dopay' WHERE employee_code = 'SFAMC-X009';
UPDATE public.hr_employees SET transfer_account_number = '01125373509', transfer_account_type = 'Dopay' WHERE employee_code = 'SFAMC-X010';
UPDATE public.hr_employees SET transfer_account_number = '01153596971', transfer_account_type = 'Dopay' WHERE employee_code = 'SFAMC-X011';
UPDATE public.hr_employees SET transfer_account_number = '01032320091', transfer_account_type = 'Dopay' WHERE employee_code = 'SFAMC-X012';
UPDATE public.hr_employees SET transfer_account_number = 'CASH', transfer_account_type = 'CASH' WHERE employee_code = 'SFAMC-X013';
UPDATE public.hr_employees SET transfer_account_number = 'CASH', transfer_account_type = 'CASH' WHERE employee_code = 'SFAMC-X014';
UPDATE public.hr_employees SET transfer_account_number = 'CASH', transfer_account_type = 'CASH' WHERE employee_code = 'SFAMC-X015';
UPDATE public.hr_employees SET transfer_account_number = 'CASH', transfer_account_type = 'CASH' WHERE employee_code = 'SFAMC-X016';
UPDATE public.hr_employees SET transfer_account_number = 'CASH', transfer_account_type = 'CASH' WHERE employee_code = 'SFAMC-X017';
UPDATE public.hr_employees SET transfer_account_number = 'CASH', transfer_account_type = 'CASH' WHERE employee_code = 'SFAMC-X018';
UPDATE public.hr_employees SET transfer_account_number = 'CASH', transfer_account_type = 'CASH' WHERE employee_code = 'SFAMC-X019';
UPDATE public.hr_employees SET transfer_account_number = 'CASH', transfer_account_type = 'CASH' WHERE employee_code = 'SFAMC-X020';
UPDATE public.hr_employees SET transfer_account_number = 'CASH', transfer_account_type = 'CASH' WHERE employee_code = 'SFAMC-X021';
UPDATE public.hr_employees SET transfer_account_number = 'CASH', transfer_account_type = 'CASH' WHERE employee_code = 'SFAMC-X022';
UPDATE public.hr_employees SET transfer_account_number = 'CASH', transfer_account_type = 'CASH' WHERE employee_code = 'SFAMC-X023';
UPDATE public.hr_employees SET transfer_account_number = 'CASH', transfer_account_type = 'CASH' WHERE employee_code = 'SFAMC-X024';
UPDATE public.hr_employees SET transfer_account_number = 'CASH', transfer_account_type = 'CASH' WHERE employee_code = 'SFAMC-X025';
UPDATE public.hr_employees SET transfer_account_number = 'CASH', transfer_account_type = 'CASH' WHERE employee_code = 'SFAMC-X026';
UPDATE public.hr_employees SET transfer_account_number = '01108210538', transfer_account_type = 'Wallet' WHERE employee_code = 'SFAMC-X027';
UPDATE public.hr_employees SET transfer_account_number = 'CASH', transfer_account_type = 'CASH' WHERE employee_code = 'SFAMC-X028';
UPDATE public.hr_employees SET transfer_account_number = 'CASH', transfer_account_type = 'CASH' WHERE employee_code = 'SFAMC-X029';
