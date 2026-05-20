-- ============================================================================
-- ROLLBACK: Restore original JSONB blob tables
-- Drops all new relational tables and renames backups back to original names.
-- ============================================================================

BEGIN;

-- Drop new tables (child tables first due to FK constraints)
DROP TABLE IF EXISTS public.collection_payments        CASCADE;
DROP TABLE IF EXISTS public.collection_credit_notes    CASCADE;
DROP TABLE IF EXISTS public.payable_payments           CASCADE;
DROP TABLE IF EXISTS public.payable_deductions         CASCADE;
DROP TABLE IF EXISTS public.journal_entry_lines        CASCADE;
DROP TABLE IF EXISTS public.journal_approval_history   CASCADE;
DROP TABLE IF EXISTS public.journal_attachments        CASCADE;
DROP TABLE IF EXISTS public.collections_invoices       CASCADE;
DROP TABLE IF EXISTS public.payables_invoices          CASCADE;
DROP TABLE IF EXISTS public.journal_entries            CASCADE;

-- Restore backup tables to original names
ALTER TABLE IF EXISTS public.collections_invoices_jsonb_backup
  RENAME TO collections_invoices;
ALTER TABLE IF EXISTS public.payables_invoices_jsonb_backup
  RENAME TO payables_invoices;
ALTER TABLE IF EXISTS public.journal_entries_jsonb_backup
  RENAME TO journal_entries;

-- Drop the trigger function if no longer needed
DROP FUNCTION IF EXISTS public.set_updated_at() CASCADE;

COMMIT;
