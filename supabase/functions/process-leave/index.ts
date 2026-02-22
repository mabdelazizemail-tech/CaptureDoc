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
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "" // need service role to modify balances securely
        );

        const { requestId, status } = await req.json();

        if (!requestId || !status) {
            throw new Error("Missing required fields: requestId, status");
        }

        if (status !== 'approved' && status !== 'rejected') {
            throw new Error("Invalid status");
        }

        // Get the request
        const { data: request, error: reqError } = await supabaseClient
            .from('hr_leave_requests')
            .select('*')
            .eq('id', requestId)
            .single();

        if (reqError || !request) throw reqError || new Error("Request not found");
        if (request.status !== 'pending') throw new Error("Request already processed");

        if (status === 'approved') {
            const balanceColumn = request.leave_type === 'sick' ? 'sick_balance' : request.leave_type === 'annual' ? 'annual_balance' : null;

            if (balanceColumn) {
                // Get current balance
                const { data: balance, error: balError } = await supabaseClient
                    .from('hr_leave_balances')
                    .select('*')
                    .eq('employee_id', request.employee_id)
                    .single();

                if (balError || !balance) throw balError || new Error("Balance not found");

                if (balance[balanceColumn] < request.total_days) {
                    throw new Error(`Insufficient ${request.leave_type} balance. Available: ${balance[balanceColumn]}, Requested: ${request.total_days}`);
                }

                // Deduct balance
                const { error: updError } = await supabaseClient
                    .from('hr_leave_balances')
                    .update({ [balanceColumn]: balance[balanceColumn] - request.total_days })
                    .eq('employee_id', request.employee_id);

                if (updError) throw updError;
            }
        }

        // Update status
        const { error: updReqError } = await supabaseClient
            .from('hr_leave_requests')
            .update({ status })
            .eq('id', requestId);

        if (updReqError) throw updReqError;

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
