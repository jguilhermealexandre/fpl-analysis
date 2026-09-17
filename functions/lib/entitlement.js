/* What "premium" means, for code that runs at the edge.
 *
 * This is the same sentence as public.is_premium() in supabase/schema.sql and
 * as auIsPremium() in scripts/auth.js. Three copies of one rule is a bad smell
 * and it is worth saying why they exist rather than pretending otherwise:
 * schema.sql runs in Postgres, auth.js is a classic browser script with no
 * module system, and this is an ES module in a Worker. None of the three can
 * import either of the others.
 *
 * What CAN be shared is a test. tests/entitlement-agrees.test.mjs runs both
 * JavaScript copies over the same table of cases and fails if they ever
 * disagree, which is the only part of "one definition" that was ever really
 * about correctness.
 *
 * The edge used to avoid the duplicate by calling a database function,
 * is_premium_me(), and believing its boolean. That was the cleaner design and
 * it locked a paying account out of the site: the function has to be created
 * by hand in the SQL editor, it had not been, PostgREST answered 404, and the
 * gate — correctly failing closed — refused everyone. A rule this small is not
 * worth a deployment step that can be forgotten. The profiles table and its
 * row-level security policy have existed since the first migration; reading a
 * row needs nothing that is not already there.
 */
export function isPremiumProfile(profile, now) {
    if (!profile || profile.plan !== 'premium') return false;
    // No expiry set means it does not expire. That is what a hand-granted
    // account looks like, and what the Mollie webhook will write for an
    // active subscription between renewals.
    if (!profile.plan_until) return true;
    const until = Date.parse(profile.plan_until);
    const t = typeof now === 'number' ? now : Date.now();
    // An unparseable date is not an entitlement. Date.parse returns NaN and
    // every comparison against NaN is false, but saying so explicitly keeps
    // the intent readable.
    return Number.isFinite(until) && until > t;
}
