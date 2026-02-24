CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(p_project_id text DEFAULT NULL)
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
  IF p_project_id IS NOT NULL AND p_project_id != '' AND p_project_id != 'all' THEN
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
