import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPER_ADMIN_EMAIL = "admin@smartkpis.com"; // Replace with env var or fetch dynamically

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const { record } = await req.json(); // Payload from Database Webhook

    if (!record || !record.pm_id) {
      throw new Error("Invalid payload: Missing record or pm_id");
    }

    // 1. Fetch PM details (Email)
    // Note: Assuming 'users' table has an email column or linking to auth.users
    // For this example, we fetch from public.users and assume username is email or email is stored
    const { data: pmUser, error: pmError } = await supabase
      .from("users")
      .select("username, name") // adjusting to schema, assuming username might be email or mapped
      .eq("id", record.pm_id)
      .single();

    if (pmError || !pmUser) {
      console.error("Error fetching PM:", pmError);
      throw new Error("Project Manager not found");
    }

    // Determine PM Email (Fallback logic if username isn't email)
    const pmEmail = pmUser.username.includes("@") ? pmUser.username : "pm-default@smartkpis.com"; 

    // 2. Prepare Email Content
    const emailSubject = `New Ticket Assigned: ${record.title}`;
    const emailBody = `
      <h1>New Ticket Notification</h1>
      <p>Hello ${pmUser.name},</p>
      <p>A new <strong>${record.priority}</strong> priority ticket has been opened by a supervisor.</p>
      <p><strong>Ticket Title:</strong> ${record.title}</p>
      <p><strong>Description:</strong> ${record.description}</p>
      <br/>
      <p>Please log in to the dashboard to begin resolution.</p>
    `;

    // 3. Send Email via Resend
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "notifications@smartkpis.com",
        to: [pmEmail],
        bcc: [SUPER_ADMIN_EMAIL],
        subject: emailSubject,
        html: emailBody,
      }),
    });

    const data = await res.json();

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error: any) {
    console.error(error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});