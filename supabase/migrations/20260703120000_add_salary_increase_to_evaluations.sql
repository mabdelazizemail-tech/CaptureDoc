-- Add salary increase recorded with each evaluation.
-- Percent is what the evaluator enters; amount is the computed increase
-- snapshotted from the employee's current salary (basic + variable) at save time.

ALTER TABLE public.hr_employee_evaluations
  ADD COLUMN salary_increase_percent numeric CHECK (salary_increase_percent >= 0 AND salary_increase_percent <= 100),
  ADD COLUMN salary_increase_amount numeric CHECK (salary_increase_amount >= 0);
