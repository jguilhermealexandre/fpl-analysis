/* The two public Supabase values, for code that runs at the edge.
 *
 * Both of these are already in scripts/auth.js and already in every visitor's
 * browser. The project URL is a hostname and the publishable key is designed to
 * be shipped to clients — it carries no authority of its own, which is why row
 * level security exists and why every policy in supabase/schema.sql is written
 * as though the key were public. It is.
 *
 * Constants rather than environment variables, deliberately. An env var that
 * nobody sets is a gate that cannot reach Supabase, and a gate that cannot
 * reach Supabase has to refuse everyone — so the failure mode of a forgotten
 * setting would be the paywall locking out the people who paid. Nothing here
 * is secret, so there is nothing to gain by hiding it and a deploy to lose.
 *
 * WHAT MUST NEVER BE IN THIS FILE, OR ANY FILE
 *
 * The service_role / secret key. It bypasses row level security and column
 * grants entirely, which is precisely what makes it the only thing permitted to
 * write `plan`. It belongs in a Cloudflare environment variable read by the
 * Mollie webhook, and nowhere else — not here, not in a commit, not in a chat.
 */
export const SUPABASE_URL = 'https://qlipcnedxchcsbpihscp.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_RDHHDWaiUEJ3Gf8LOcvevg_VazVsHDu';

/* The cookie scripts/auth.js writes the access token into. Named here so the
   middleware and the browser agree; if this ever diverges the gate stops seeing
   anyone's session and refuses the whole paid site. */
export const ACCESS_COOKIE = 'easyfpl_at';
export const REFRESH_COOKIE = 'easyfpl_rt';
