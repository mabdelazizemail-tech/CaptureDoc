const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://zbvqycapnwrwetunwtqi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpidnF5Y2Fwbndyd2V0dW53dHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4MzQzNDQsImV4cCI6MjA4NDQxMDM0NH0.X4bewSYGuWDlr0VXbRNojg0ARhOTwhd609dshHOM50U';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
    console.log('=== CRM User Verification & Creation Script ===\n');

    for (const u of TARGET_USERS) {
        console.log(`\n--- Processing: ${u.email} ---`);

        // Step 1: Try to sign in to see if user exists and password works
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
            email: u.email,
            password: u.password
        });

        if (!signInError && signInData.user) {
            console.log(`SUCCESS - User exists! ID: ${signInData.user.id}`);

            // Check if profile exists
            const { data: profile } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', signInData.user.id)
                .single();

            if (profile) {
                console.log(`   Profile found: name="${profile.name}", role="${profile.role}", email="${profile.email || profile.username}"`);
            } else {
                console.log(`   No profile found. Creating profile...`);
                const { error: insertErr } = await supabase.from('profiles').upsert({
                    id: signInData.user.id,
                    name: u.name,
                    email: u.email,
                    username: u.email.toLowerCase(),
                    role: 'supervisor'
                });
                if (insertErr) {
                    console.log(`   Profile insert failed: ${insertErr.message}`);
                } else {
                    console.log(`   Profile created successfully.`);
                }
            }

            await supabase.auth.signOut();
            continue;
        }

        // Step 2: Try to sign up
        console.log(`   Sign-in failed (${signInError?.message}). Attempting sign up...`);

        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email: u.email,
            password: u.password,
            options: {
                data: {
                    full_name: u.name,
                    role: 'crm_user'
                }
            }
        });

        if (signUpError) {
            if (signUpError.message.toLowerCase().includes('already registered')) {
                console.log(`   User already registered but sign-in failed.`);
                console.log(`   ACTION NEEDED: Reset password in Supabase Dashboard > Auth > Users`);
            } else {
                console.log(`   Sign up failed: ${signUpError.message}`);
            }
        } else {
            const userId = signUpData.user?.id;
            console.log(`   Sign up SUCCESS. User ID: ${userId || 'pending email confirmation'}`);

            if (userId) {
                const { error: profErr } = await supabase.from('profiles').upsert({
                    id: userId,
                    name: u.name,
                    email: u.email,
                    username: u.email.toLowerCase(),
                    role: 'supervisor'
                });
                if (profErr) {
                    console.log(`   Profile upsert failed: ${profErr.message}`);
                } else {
                    console.log(`   Profile upserted successfully.`);
                }
            } else {
                console.log(`   Note: Email confirmation may be required. Check Supabase Dashboard.`);
            }
        }
    }

    console.log('\n=== Done ===');
    console.log('Both users will be restricted to CRM-only access in the app.');
    process.exit(0);
}

run().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
