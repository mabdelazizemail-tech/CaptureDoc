-- Migration: Add created_by column to ALL CRM tables
-- Run this if tables already exist and need the new column

ALTER TABLE leads ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by TEXT;
