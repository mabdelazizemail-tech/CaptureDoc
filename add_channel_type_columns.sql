-- Migration: Add channel_type and channel_name columns to deals table
-- Run this in Supabase SQL Editor

ALTER TABLE deals ADD COLUMN IF NOT EXISTS channel_type TEXT DEFAULT 'Direct' CHECK (channel_type IN ('Direct', 'Indirect'));
ALTER TABLE deals ADD COLUMN IF NOT EXISTS channel_name TEXT;
