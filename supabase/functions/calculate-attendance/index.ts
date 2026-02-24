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
            Deno.env.get("SUPABASE_ANON_KEY") ?? "",
            { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
        );

        const { employeeId, date, checkIn, checkOut } = await req.json();

        if (!employeeId || !date) {
            throw new Error("Missing required fields: employeeId, date");
        }

        let lateMinutes = 0;
        let overtimeMinutes = 0;

        const [ciH, ciM] = checkIn ? checkIn.split(':').map(Number) : [0, 0];
        const [coH, coM] = checkOut ? checkOut.split(':').map(Number) : [0, 0];

        // Work start 09:00, Grace 10m -> Late if > 09:10
        if (checkIn) {
            if (ciH > 9 || (ciH === 9 && ciM > 10)) {
                lateMinutes = ((ciH - 9) * 60) + ciM;
            }
        }

        // Work end 17:00 -> Overtime if > 17:00
        if (checkOut) {
            if (coH > 17 || (coH === 17 && coM > 0)) {
                overtimeMinutes = ((coH - 17) * 60) + coM;
            }
        }

        // Upsert or insert logic
        const { data: existing, error: existingError } = await supabaseClient
            .from('hr_attendance')
            .select('id')
            .eq('employee_id', employeeId)
            .eq('date', date)
            .single();

        let resultError;

        if (existing) {
            const { error } = await supabaseClient
                .from('hr_attendance')
                .update({
                    check_in: checkIn || undefined,
                    check_out: checkOut || undefined,
                    late_minutes: lateMinutes,
                    overtime_minutes: overtimeMinutes
                })
                .eq('id', existing.id);
            resultError = error;
        } else {
            const { error } = await supabaseClient
                .from('hr_attendance')
                .insert({
                    employee_id: employeeId,
                    date,
                    check_in: checkIn,
                    check_out: checkOut,
                    late_minutes: lateMinutes,
                    overtime_minutes: overtimeMinutes
                });
            resultError = error;
        }

        if (resultError) throw resultError;

        return new Response(JSON.stringify({ success: true }), {
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
