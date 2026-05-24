-- ============================================================================
-- SQL DDL for Receivable Monthly To-Do List Module
-- Appends table structure and RLS policies for receivable_monthly_tasks
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.receivable_monthly_tasks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  task_type text DEFAULT 'monthly_invoice_reminder' NOT NULL,
  title text NOT NULL,
  task_month integer NOT NULL,
  task_year integer NOT NULL,
  due_date date NOT NULL,
  assigned_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text DEFAULT 'Pending' NOT NULL, -- 'Pending' | 'In Progress' | 'Completed' | 'Skipped'
  notes text,
  reminder_status text DEFAULT 'Idle' NOT NULL, -- 'Idle' | 'Sent' | 'Overdue Sent'
  reminder_sent_at timestamptz,
  completed_at timestamptz,
  completed_by text, -- Username of completion operator
  completion_note text,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  created_by text,
  updated_by text,
  
  -- Prevent duplicate monthly invoice reminders for the same project in the same month/year
  CONSTRAINT unique_project_monthly_invoice_task UNIQUE (project_id, task_type, task_month, task_year)
);

-- Indexing for high-performance monthly dashboard queries
CREATE INDEX IF NOT EXISTS idx_receivable_monthly_tasks_month_year 
  ON public.receivable_monthly_tasks(task_year, task_month);

CREATE INDEX IF NOT EXISTS idx_receivable_monthly_tasks_project_id 
  ON public.receivable_monthly_tasks(project_id);

-- Enable Row Level Security (RLS)
ALTER TABLE public.receivable_monthly_tasks ENABLE ROW LEVEL SECURITY;

-- Setup basic public policies
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'receivable_monthly_tasks' AND policyname = 'Enable read access for all authenticated users'
    ) THEN
        CREATE POLICY "Enable read access for all authenticated users" 
          ON public.receivable_monthly_tasks
          FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'receivable_monthly_tasks' AND policyname = 'Enable insert for authenticated users'
    ) THEN
        CREATE POLICY "Enable insert for authenticated users" 
          ON public.receivable_monthly_tasks
          FOR INSERT TO authenticated WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'receivable_monthly_tasks' AND policyname = 'Enable update for authenticated users'
    ) THEN
        CREATE POLICY "Enable update for authenticated users" 
          ON public.receivable_monthly_tasks
          FOR UPDATE TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'receivable_monthly_tasks' AND policyname = 'Enable delete for authenticated users'
    ) THEN
        CREATE POLICY "Enable delete for authenticated users" 
          ON public.receivable_monthly_tasks
          FOR DELETE TO authenticated USING (true);
    END IF;
END
$$;
