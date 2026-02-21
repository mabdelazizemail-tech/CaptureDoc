import { supabase } from '../services/supabaseClient';

export const runTest = async () => {
  // Test this in your code:
  const { data } = await supabase.from('unlock_requests').select('*');
  console.log("Total records found:", data?.length);
};
