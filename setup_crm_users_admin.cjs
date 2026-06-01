/**
 * Uses Supabase's admin REST API to list users and confirm emails.
 * Requires the SERVICE_ROLE key (not the anon key).
 * 
 * HOW TO GET YOUR SERVICE ROLE KEY:
 * 1. Go to https://supabase.com/dashboard
 * 2. Open project "zbvqycapnwrwetunwtqi"
 * 3. Settings → API → Service Role Key (Secret)
 * 4. Paste it below as SERVICE_ROLE_KEY
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://zbvqycapnwrwetunwtqi.supabase.co';

// ⚠️  PASTE YOUR SERVICE ROLE KEY HERE (from Supabase Dashboard > Settings > API):
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_KEY || 'PASTE_SERVICE_ROLE_KEY_HERE';

if (SERVICE_ROLE_KEY === 'PASTE_SERVICE_ROLE_KEY_HERE') {
    console.error('ERROR: Please set SUPABASE_SERVICE_KEY env variable or paste the service role key in the script.');
    process.exit(1);
}

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

const TARGET_USERS = [
    {
        email: 'Menna.Youssif@capture-doc.com',
        password: 'Capture@26',
        name: 'Menna Youssif',
    },
    {
        email: 'hossam.yazal@capture-doc.com',
        password: 'Pass@123',
        name: 'Hossam Yazal',
    }
];

async function run() {
    console.log('=== CRM Admin User Setup Script ===\n');

    // List all auth users
    const { data: usersData, error: listError } = await adminClient.auth.admin.listUsers();
    if (listError) {
        console.error('Failed to list users:', listError.message);
        process.exit(1);
    }

    const existingUsers = usersData?.users || [];
    console.log(`Found ${existingUsers.length} total auth users in Supabase.\n`);

    for (const u of TARGET_USERS) {
        console.log(`--- Processing: ${u.email} ---`);
        
        // Find existing user
        const existing = existingUsers.find(eu => eu.email?.toLowerCase() === u.email.toLowerCase());
        
        if (existing) {
            console.log(`  Found existing user: ID=${existing.id}`);
            console.log(`  Email confirmed: ${existing.email_confirmed_at ? 'YES (' + existing.email_confirmed_at + ')' : 'NO'}`);
            
            // Update: confirm email + set password
            const { data: updated, error: updateErr } = await adminClient.auth.admin.updateUserById(existing.id, {
                email: u.email,
                password: u.password,
                email_confirm: true,
                user_metadata: { full_name: u.name }
            });
            
            if (updateErr) {
                console.log(`  Update failed: ${updateErr.message}`);
            } else {
                console.log(`  Successfully confirmed email and set password.`);
                console.log(`  Email confirmed at: ${updated.user?.email_confirmed_at}`);
            }
        } else {
            console.log(`  User not found. Creating new...`);
            const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
                email: u.email,
                password: u.password,
                email_confirm: true,
                user_metadata: { full_name: u.name }
            });
            
            if (createErr) {
                console.log(`  Create failed: ${createErr.message}`);
                continue;
            }
            
            console.log(`  Created user: ID=${created.user?.id}`);
            existing = created.user;
        }

        // Upsert profile record
        const userId = existing?.id;
        if (userId) {
            const { error: profErr } = await adminClient.from('profiles').upsert({
                id: userId,
                name: u.name,
                email: u.email.toLowerCase(),
                username: u.email.toLowerCase(),
                role: 'supervisor'
            });
            
            if (profErr) {
                console.log(`  Profile upsert failed: ${profErr.message}`);
            } else {
                console.log(`  Profile record ensured in DB.`);
            }
        }
        
        console.log('');
    }

    console.log('=== Done ===');
    console.log('Users can now log in with:');
    console.log('  Menna.Youssif@capture-doc.com / Capture@26 → CRM only');
    console.log('  hossam.yazal@capture-doc.com / Pass@123 → CRM only');
    process.exit(0);
}

run().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
