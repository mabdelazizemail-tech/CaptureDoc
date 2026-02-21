import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zbvqycapnwrwetunwtqi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpidnF5Y2Fwbndyd2V0dW53dHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4MzQzNDQsImV4cCI6MjA4NDQxMDM0NH0.X4bewSYGuWDlr0VXbRNojg0ARhOTwhd609dshHOM50U';

(async () => {
    try {
        const payload = {
            title: "Test undefined",
            category: "hardware",
            description: "Desc",
            id: '99999999-9999-9999-9999-999999999999' // setting ID manually to test if it's the insert
        };
        const res = await fetch(`${SUPABASE_URL}/rest/v1/tickets`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify(payload)
        });
        const text = await res.text();
        console.log("Status:", res.status, "Body:", text);
    } catch (e) {
        console.error(e);
    }
})();
