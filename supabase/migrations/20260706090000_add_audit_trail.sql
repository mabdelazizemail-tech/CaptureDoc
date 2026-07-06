-- AUDIT TRAIL
-- Records every INSERT/UPDATE/DELETE on business tables: what changed,
-- who did it (user id/email/role from the JWT), when (UTC), and where
-- (client IP + user agent from the PostgREST request headers).

CREATE TABLE public.audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  happened_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  table_name text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  record_id text,
  user_id text,
  user_email text,
  user_role text,
  ip_address text,
  user_agent text,
  old_data jsonb,
  new_data jsonb,
  changed_fields text[]
);

CREATE INDEX idx_audit_logs_happened_at ON public.audit_logs (happened_at DESC);
CREATE INDEX idx_audit_logs_table ON public.audit_logs (table_name, happened_at DESC);
CREATE INDEX idx_audit_logs_user ON public.audit_logs (user_id, happened_at DESC);

-- Generic row-level audit trigger
CREATE OR REPLACE FUNCTION public.audit_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid text;
  v_email text;
  v_role text;
  v_headers jsonb;
  v_ip text;
  v_ua text;
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
BEGIN
  v_uid := auth.uid()::text;

  -- Request headers are only present for PostgREST-originated statements
  BEGIN
    v_headers := current_setting('request.headers', true)::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_headers := NULL;
  END;
  IF v_headers IS NOT NULL THEN
    v_ip := COALESCE(v_headers->>'x-forwarded-for', v_headers->>'x-real-ip', v_headers->>'cf-connecting-ip');
    v_ua := v_headers->>'user-agent';
  END IF;

  IF v_uid IS NOT NULL THEN
    SELECT p.email, p.role::text INTO v_email, v_role
    FROM public.profiles p WHERE p.id::text = v_uid;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    SELECT array_agg(n.key) INTO v_changed
    FROM jsonb_each(v_new) AS n(key, value)
    WHERE v_old -> n.key IS DISTINCT FROM n.value;
  ELSE
    v_old := to_jsonb(OLD);
  END IF;

  INSERT INTO public.audit_logs (
    table_name, operation, record_id,
    user_id, user_email, user_role,
    ip_address, user_agent,
    old_data, new_data, changed_fields
  ) VALUES (
    TG_TABLE_NAME, TG_OP, COALESCE(v_new->>'id', v_old->>'id'),
    v_uid, v_email, v_role,
    v_ip, v_ua,
    v_old, v_new, v_changed
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach the trigger to every business table that exists
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    -- HR
    'hr_employees', 'hr_attendance', 'hr_leave_requests', 'hr_leave_balances',
    'hr_payroll', 'hr_kpis', 'hr_project_kpis', 'hr_holidays', 'hr_employee_evaluations',
    -- Core
    'profiles', 'projects', 'operators', 'kpi_logs', 'unlock_requests',
    'assets', 'maintenance_requests', 'tickets', 'operator_settings',
    -- Finance
    'collections_invoices', 'collection_payments', 'collection_credit_notes',
    'payables_invoices', 'payable_payments', 'payable_deductions',
    'journal_entries', 'journal_entry_lines', 'journal_approval_history', 'journal_attachments',
    'receivable_monthly_tasks',
    -- CRM
    'leads', 'contacts', 'companies', 'deals', 'tasks',
    -- Project management
    'pm_site_logs', 'pm_inventory', 'pm_expenses', 'pm_timesheets'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_trigger_row ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER audit_trigger_row AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_trigger()',
        t
      );
    END IF;
  END LOOP;
END;
$$;

-- Only super admins can read the log; nobody can modify it through the API
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admin reads audit logs" ON public.audit_logs
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id::text = auth.uid()::text AND p.role = 'super_admin'
  )
);
