import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zbvqycapnwrwetunwtqi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpidnF5Y2Fwbndyd2V0dW53dHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4MzQzNDQsImV4cCI6MjA4NDQxMDM0NH0.X4bewSYGuWDlr0VXbRNojg0ARhOTwhd609dshHOM50U';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

(async () => {
    try {
        const payload = {
            title: "Test",
            category: "hardware",
            assetid: "", // testing empty string
            description: "Desc",
            priority: "medium",
            status: 'open',
            created_by: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
            projectid: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
            pmid: ""
        };
        const { error } = await supabase.from('tickets').insert(payload);
        console.log("Insert Result Error:", JSON.stringify(error, null, 2));
    } catch (e) {
        console.error(e);
    }
})();
