-- Migration: Add hr_payroll_overrides table for admin-editable KPI totals
-- Allows admins to override the computed "إجمالي صافي الرواتب" with a custom value.

CREATE TABLE IF NOT EXISTS public.hr_payroll_overrides (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  month text NOT NULL,                        -- Format: YYYY-MM
  total_net_override numeric,                 -- Override for إجمالي صافي الرواتب
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(project_id, month)
);

ALTER TABLE public.hr_payroll_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Payroll overrides admin access" ON public.hr_payroll_overrides
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id::text = auth.uid()::text
    AND p.role IN ('super_admin','power_admin','it_specialist','hr_admin')
  )
);
