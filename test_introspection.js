import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zbvqycapnwrwetunwtqi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpidnF5Y2Fwbndyd2V0dW53dHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4MzQzNDQsImV4cCI6MjA4NDQxMDM0NH0.X4bewSYGuWDlr0VXbRNojg0ARhOTwhd609dshHOM50U';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

(async () => {
    try {
        console.log("Verifying connection and listing tables...");

        // Try to fetch from a known table first
        const { data: tickets, error: ticketsError } = await supabase.from('tickets').select('id').limit(1);
        if (ticketsError) {
            console.error("Error fetching from 'tickets':", ticketsError.message);
        } else {
            console.log("Successfully connected and fetched from 'tickets' table.");
        }

        // Use the REST API to get all definitions (this is what test_schema.js does)
        const res = await fetch(`${SUPABASE_URL}/rest/v1/?apikey=${SUPABASE_KEY}`);
        const schema = await res.json();

        if (schema && schema.definitions) {
            const tables = Object.keys(schema.definitions);
            console.log("Found Tables:");
            tables.sort().forEach(t => console.log(` - ${t}`));
        } else {
            console.log("Could not retrieve schema definitions.");
        }

    } catch (e) {
        console.error("Unexpected error:", e);
    }
})();
