const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://zbvqycapnwrwetunwtqi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpidnF5Y2Fwbndyd2V0dW53dHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4MzQzNDQsImV4cCI6MjA4NDQxMDM0NH0.X4bewSYGuWDlr0VXbRNojg0ARhOTwhd609dshHOM50U';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkMetrics() {
    console.log("Empty args:", await supabase.rpc('get_dashboard_metrics'));
    console.log("null args:", await supabase.rpc('get_dashboard_metrics', { p_project_id: null }));
    console.log("all args:", await supabase.rpc('get_dashboard_metrics', { p_project_id: 'all' }));
    const { data: emps, count } = await supabase.from('hr_employees').select('*', { count: 'exact' });
    console.log('Employees total:', count, emps?.length);
    console.log(emps);
}
checkMetrics();
