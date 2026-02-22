import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const supabaseClient = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
        );

        const { month } = await req.json(); // Format: YYYY-MM

        if (!month) throw new Error("Month is required (YYYY-MM)");

        // Get all active employees
        const { data: employees, error: empError } = await supabaseClient
            .from('hr_employees')
            .select('id, basic_salary, status')
            .eq('status', 'active');

        if (empError) throw empError;

        // Start payroll transaction per employee
        const payrollEntries = [];

        // For aggregating attendance per employee logically:
        // Get start/end dates
        const startDate = `${month}-01`;
        const lastDay = new Date(parseInt(month.split('-')[0]), parseInt(month.split('-')[1]), 0).getDate();
        const endDate = `${month}-${lastDay}`;

        // Get attendance for the month for all employees to save queries
        const { data: attendanceData, error: attError } = await supabaseClient
            .from('hr_attendance')
            .select('employee_id, late_minutes, overtime_minutes')
            .gte('date', startDate)
            .lte('date', endDate);

        if (attError) throw attError;

        const { data: existingPayroll, error: exisError } = await supabaseClient
            .from('hr_payroll')
            .select('employee_id, status')
            .eq('month', month);

        if (exisError) throw exisError;

        const existingMap = new Map();
        existingPayroll.forEach(p => existingMap.set(p.employee_id, p.status));

        const groupedAttendance = new Map();
        attendanceData.forEach(att => {
            if (!groupedAttendance.has(att.employee_id)) {
                groupedAttendance.set(att.employee_id, { late: 0, overtime: 0 });
            }
            const current = groupedAttendance.get(att.employee_id);
            current.late += att.late_minutes;
            current.overtime += att.overtime_minutes;
        });

        for (const emp of employees) {
            if (existingMap.get(emp.id) === 'finalized') {
                continue; // Skip finalized
            }

            const basicSalary = emp.basic_salary;
            const dailySalary = basicSalary / 30;
            const hourRate = dailySalary / 8;

            const att = groupedAttendance.get(emp.id) || { late: 0, overtime: 0 };

            const overtimeAmount = (att.overtime / 60) * hourRate * 1.5;
            const lateDeduction = (att.late / 60) * hourRate;

            const netSalary = basicSalary + overtimeAmount - lateDeduction;

            payrollEntries.push({
                employee_id: emp.id,
                month,
                basic_salary: basicSalary,
                overtime_amount: Math.max(0, parseFloat(overtimeAmount.toFixed(2))),
                late_deduction: Math.max(0, parseFloat(lateDeduction.toFixed(2))),
                net_salary: Math.max(0, parseFloat(netSalary.toFixed(2))),
                status: 'draft'
            });
        }

        if (payrollEntries.length > 0) {
            // Upsert (insert or update draft)
            const { error: insertError } = await supabaseClient
                .from('hr_payroll')
                .upsert(payrollEntries, { onConflict: 'employee_id, month' });

            if (insertError) throw insertError;
        }

        return new Response(JSON.stringify({ success: true, processed: payrollEntries.length }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
        });
    }
});
