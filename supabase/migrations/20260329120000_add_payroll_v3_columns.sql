-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260329120000_add_payroll_v3_columns
-- Adds columns required by HRPayroll v3.0 (BM Salaries formula mapping)
--
-- New columns map to BM Salaries Excel sheet (Mosky):
--   advance        → AL  – employee advance / سلفة
--   absence_value  → X   – Q × W  (daily_wage × absence_days)
--   penalty_value  → Z   – O × Y  (basic_daily × penalty_days)
--   total_deducted → AC  – X + Z  (total attendance deductions)
--   net_before     → AD  – V − AC (gross before statutory deductions)
--   annual_taxable → AH  – (AD − AF − 1666.67) × 12
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.hr_payroll
  ADD COLUMN IF NOT EXISTS advance          numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS absence_value    numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS penalty_value    numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_deducted   numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_before       numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS annual_taxable   numeric(14,2) DEFAULT 0;

-- Backfill net_before for existing finalized rows that already have the
-- component values saved (best-effort; leaves 0 for rows without data)
UPDATE public.hr_payroll
SET
  net_before     = GREATEST(0, gross_salary - COALESCE(total_deducted, 0)),
  annual_taxable = GREATEST(0, (gross_salary - COALESCE(insurance, 0) - 1666.67) * 12)
WHERE net_before = 0 AND gross_salary > 0;
