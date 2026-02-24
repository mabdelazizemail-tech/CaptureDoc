import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zbvqycapnwrwetunwtqi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpidnF5Y2Fwbndyd2V0dW53dHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4MzQzNDQsImV4cCI6MjA4NDQxMDM0NH0.X4bewSYGuWDlr0VXbRNojg0ARhOTwhd609dshHOM50U';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

(async () => {
    try {
        const { data, error } = await supabase.rpc('get_trigger_def', {});
        if (error) {
            const { data: d2, error: e2 } = await supabase.from('pg_trigger').select('*');
            console.log("Trigger error:", e2);

            const res = await fetch(`${SUPABASE_URL}/rest/v1/?apikey=${SUPABASE_KEY}`);
            const s = await res.json();

            // we can't query pg_trigger, but maybe we can query pg_proc?
            // probably not via rest...
            console.log("Maybe we have an insert trigger on tickets that calls a web request?");
        }
    } catch (e) {
        console.error(e);
    }
})();
