-- Add HR Holidays table
CREATE TABLE IF NOT EXISTS public.hr_holidays (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  type text CHECK (type IN ('public', 'company')) DEFAULT 'public',
  description text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.hr_holidays ENABLE ROW LEVEL SECURITY;

-- Policies
DROP POLICY IF EXISTS "Anyone can view holidays" ON public.hr_holidays;
CREATE POLICY "Anyone can view holidays" ON public.hr_holidays
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Admins can manage holidays" ON public.hr_holidays;
CREATE POLICY "Admins can manage holidays" ON public.hr_holidays
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('super_admin', 'power_admin', 'it_specialist')
  )
);
