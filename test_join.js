import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zbvqycapnwrwetunwtqi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpidnF5Y2Fwbndyd2V0dW53dHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4MzQzNDQsImV4cCI6MjA4NDQxMDM0NH0.X4bewSYGuWDlr0VXbRNojg0ARhOTwhd609dshHOM50U';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

(async () => {
    try {
        const { data, error } = await supabase.from('tickets').select('*, assets(name)').limit(1);
        console.log("Assets Join Result 1:", data, "Error:", error);

        const res2 = await supabase.from('tickets').select('*, assets!tickets_assetid_fkey(name)').limit(1);
        console.log("Assets Join Result 2:", res2.data, "Error 2:", res2.error);

        const res3 = await supabase.from('tickets').select('*, assets!inner(name)').limit(1);
        console.log("Assets Join Result 3:", res3.data, "Error 3:", res3.error);
    } catch (e) {
        console.error(e);
    }
})();
