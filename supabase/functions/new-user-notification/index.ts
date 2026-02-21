import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

declare const Deno: any;

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPER_ADMIN_EMAIL = "admin@smartkpis.com"; // Replace with actual admin email or env var

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, name } = await req.json();

    if (!email) {
      throw new Error("Email is required");
    }

    const emailSubject = `New User Registration: ${name || email}`;
    const emailBody = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2 style="color: #007aff;">New User Registration</h2>
        <p>A new user has registered on <strong>Capture Flow</strong>.</p>
        <div style="background: #f9f9f9; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <p style="margin: 5px 0;"><strong>Email:</strong> ${email}</p>
            <p style="margin: 5px 0;"><strong>Name:</strong> ${name || 'N/A'}</p>
            <p style="margin: 5px 0;"><strong>Role:</strong> Supervisor (Default)</p>
            <p style="margin: 5px 0;"><strong>Date:</strong> ${new Date().toLocaleString()}</p>
        </div>
        <p>Please log in to the <a href="https://your-app-url.com">Admin Dashboard</a> to assign them to a project or update their role.</p>
      </div>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "notifications@smartkpis.com",
        to: [SUPER_ADMIN_EMAIL],
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