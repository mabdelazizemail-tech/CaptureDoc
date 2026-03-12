import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zbvqycapnwrwetunwtqi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpidnF5Y2Fwbndyd2V0dW53dHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4MzQzNDQsImV4cCI6MjA4NDQxMDM0NH0.X4bewSYGuWDlr0VXbRNojg0ARhOTwhd609dshHOM50U';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testTable(tableName) {
    console.log(`Testing '${tableName}'...`);
    const { data, error } = await supabase.from(tableName).select('*').limit(1);
    if (error) {
        console.log(` - Error: ${error.message} (${error.code})`);
    } else {
        console.log(` - Success! Records found: ${data.length}`);
        if (data.length > 0) {
            console.log(` - Columns: ${Object.keys(data[0]).join(', ')}`);
        }
    }
}

(async () => {
    await testTable('pm_site_logs');
    await testTable('pm_inventory');
    await testTable('pm_timesheets');
    await testTable('pm_expenses');
    await testTable('projects');
})();
