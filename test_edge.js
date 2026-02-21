import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zbvqycapnwrwetunwtqi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpidnF5Y2Fwbndyd2V0dW53dHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4MzQzNDQsImV4cCI6MjA4NDQxMDM0NH0.X4bewSYGuWDlr0VXbRNojg0ARhOTwhd609dshHOM50U';

(async () => {
    try {
        const pmId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
        const data = {
            title: "Test notification",
            description: "Just testing the edge function call!",
            priority: "high"
        };
        const res = await fetch(`${SUPABASE_URL}/functions/v1/ticket-notification`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ record: { ...data, pm_id: pmId } })
        });

        const txt = await res.text();
        console.log("Edge function status:", res.status, "body:", txt);
    } catch (e) {
        console.error(e);
    }
})();
