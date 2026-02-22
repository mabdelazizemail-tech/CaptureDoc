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
    const { record, action = 'create', newStatus } = await req.json(); // Payload from Database Webhook

    if (!record) {
      throw new Error("Invalid payload: Missing record");
    }

    // Fallback pm_id if passed as pmid or projectid
    const effectivePmId = record.pm_id || record.pmid;

    // 1. Fetch Creator Details
    const { data: creator } = await supabase
      .from("users")
      .select("username, name, role")
      .eq("id", record.created_by)
      .single();

    const creatorName = creator?.name || "A user";
    const isPMCreator = creator?.role === 'project_manager';

    // 2. Fetch IT Specialists from profiles (primary source for new roles) and users (legacy)
    const { data: itUsers } = await supabase.from("users").select("username").eq("role", "it_specialist");
    const { data: itProfiles } = await supabase.from("profiles").select("email, username").eq("role", "it_specialist");

    const allItEmails = [
      ...(itUsers || []).map(u => u.username),
      ...(itProfiles || []).map(p => p.email || p.username)
    ].filter(email => email && email.includes("@"));

    // Deduplicate IT emails
    const itEmails = [...new Set(allItEmails)];

    // 3. Fetch PM Details (if applicable)
    let pmEmail = "";
    if (effectivePmId && !isPMCreator) {
      const { data: pmUser } = await supabase
        .from("users")
        .select("username, name")
        .eq("id", effectivePmId)
        .single();
      if (pmUser && pmUser.username.includes("@")) {
        pmEmail = pmUser.username;
      }
    }

    // Prepare recipients
    const toRecipients = [];

    // IT Specialists are always the primary TO recipients for new technical issues
    if (itEmails.length > 0) {
      toRecipients.push(...itEmails);
    }

    // PM should also be CC'd/notified if a supervisor under them opens it
    if (pmEmail) {
      toRecipients.push(pmEmail);
    }

    // Fallback if no specific TO recipient
    if (toRecipients.length === 0) {
      toRecipients.push(SUPER_ADMIN_EMAIL);
    }

    // Always BCC super admin
    const bccRecipients = [SUPER_ADMIN_EMAIL];

    // 4. Prepare Email Content based on Action
    let emailSubject = `New Ticket Opened: ${record.title}`;
    let emailBody = `
      <h1>New Support Ticket</h1>
      <p>Hello,</p>
      <p>A new <strong>${record.priority}</strong> priority ticket has been opened by <strong>${creatorName}</strong>.</p>
      <p><strong>Ticket Title:</strong> ${record.title}</p>
      <p><strong>Category:</strong> ${record.category}</p>
      <p><strong>Description:</strong> ${record.description}</p>
      <br/>
      <p>Please log in to the dashboard to view and manage this ticket.</p>
    `;

    if (action === 'status_change') {
      const statusLabel = newStatus === 'in_progress' ? 'قيد العمل (In Progress)'
        : newStatus === 'solved' ? 'تم الحل (Solved)'
          : newStatus === 'closed' ? 'مغلق (Closed)'
            : newStatus === 'open' ? 'مفتوح (Open)' : newStatus;

      emailSubject = `Ticket Status Updated: ${record.title}`;
      emailBody = `
         <h1>Ticket Status Update</h1>
         <p>Hello,</p>
         <p>The status of the ticket <strong>"${record.title}"</strong> has been updated to: <strong style="color: #0056b3;">${statusLabel}</strong>.</p>
         <p><strong>Category:</strong> ${record.category}</p>
         <br/>
         <p>Please log in to the dashboard to review the ticket details.</p>
       `;
    }

    // 5. Send Email via Resend
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "notifications@smartkpis.com",
        to: [...new Set(toRecipients)],
        bcc: [...new Set(bccRecipients)],
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