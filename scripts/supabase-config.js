// Shared Supabase config for the Season Vault predictions feature.
// Fill in SUPABASE_URL / SUPABASE_ANON_KEY once the project exists (see
// scripts/sql/predictions-schema.sql for the table/policies to create first).
// The anon/publishable key is meant to be public — safe to commit here, it
// has no access beyond what the RLS policies in that SQL file grant it.
//
// Until real values are filled in, both pages fall back gracefully:
// season-vault.js reads data/predictions.json instead, and
// predictions-submit shows a "not configured yet" notice instead of a form.

const SUPABASE_URL = ''; // e.g. 'https://xxxxxxxxxxxx.supabase.co'
const SUPABASE_ANON_KEY = ''; // the "anon" / "public" key, never the service_role key

function isSupabaseConfigured() {
    return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// Thin wrapper over Supabase's PostgREST HTTP API — no supabase-js client
// needed for the handful of calls this feature makes.
async function supabaseRequest(path, options) {
    options = options || {};
    const headers = Object.assign({
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
    }, options.headers || {});
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, Object.assign({}, options, { headers }));
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Supabase ${res.status}: ${body || res.statusText}`);
    }
    if (res.status === 204) return null;
    return res.json();
}
