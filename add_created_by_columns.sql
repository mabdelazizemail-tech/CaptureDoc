-- Migration: Add created_by column to leads and deals tables
-- This tracks which CRM user created each record

ALTER TABLE leads ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS created_by TEXT;
