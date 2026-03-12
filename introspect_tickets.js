
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zbvqycapnwrwetunwtqi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpidnF5Y2Fwbndyd2V0dW53dHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4MzQzNDQsImV4cCI6MjA4NDQxMDM0NH0.X4bewSYGuWDlr0VXbRNojg0ARhOTwhd609dshHOM50U';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

(async () => {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/?apikey=${SUPABASE_KEY}`);
        const schema = await res.json();

        if (schema && schema.definitions && schema.definitions.tickets) {
            console.log("Tickets Table Columns:");
            console.log(Object.keys(schema.definitions.tickets.properties));
        } else {
            console.log("Could not retrieve tickets definition.");
        }
    } catch (e) {
        console.error("Unexpected error:", e);
    }
})();
