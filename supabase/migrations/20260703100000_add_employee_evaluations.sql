-- EMPLOYEE EVALUATIONS MODULE
-- Adds per-employee evaluation records scored 1-100 by an evaluator (HR admin or project manager).

CREATE TABLE public.hr_employee_evaluations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  evaluator_id text REFERENCES public.profiles(id) ON DELETE SET NULL,
  score integer NOT NULL CHECK (score >= 1 AND score <= 100),
  comments text,
  evaluation_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX idx_hr_employee_evaluations_employee ON public.hr_employee_evaluations(employee_id, evaluation_date DESC);

-- Keep updated_at current on edits
CREATE OR REPLACE FUNCTION public.hr_evaluations_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_evaluation_updated
  BEFORE UPDATE ON public.hr_employee_evaluations
  FOR EACH ROW EXECUTE PROCEDURE public.hr_evaluations_set_updated_at();

-- Enable RLS
ALTER TABLE public.hr_employee_evaluations ENABLE ROW LEVEL SECURITY;

-- Same access model as hr_kpis: full admins see everything,
-- project managers only reach employees of their own projects.
CREATE POLICY "Evaluations access policy" ON public.hr_employee_evaluations
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.hr_employees e ON e.id = hr_employee_evaluations.employee_id
    WHERE p.id::text = auth.uid()::text AND (
      p.role IN ('super_admin', 'power_admin', 'it_specialist', 'hr_admin') OR
      (p.role = 'project_manager' AND (
        p.project_id::text = e.project OR
        EXISTS (
          SELECT 1 FROM public.projects pr
          WHERE pr.pm_id::text = p.id::text
          AND (pr.name = e.project OR pr.id::text = e.project)
        )
      ))
    )
  )
);
