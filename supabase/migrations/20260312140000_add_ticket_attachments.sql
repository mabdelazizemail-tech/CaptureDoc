
-- Add attachments column to tickets table
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS attachments TEXT[] DEFAULT '{}';

-- Create a bucket for ticket attachments if it doesn't exist
-- Note: This usually requires superuser or specific permissions, 
-- but you can also do it from the Supabase Dashboard.
INSERT INTO storage.buckets (id, name, public)
SELECT 'ticket-attachments', 'ticket-attachments', true
WHERE NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'ticket-attachments'
);

-- Set up RLS for the bucket (allow authenticated users to upload/view)
CREATE POLICY "Allow authenticated uploads" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'ticket-attachments');

CREATE POLICY "Allow public read access" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'ticket-attachments');
