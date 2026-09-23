/* The door to /dashboard/.
 *
 * Loaded synchronously in <head> on the app's pages and nowhere else, because
 * it has to decide before the page paints: a dashboard that draws itself and
 * then jumps to a sign-in screen has already shown somebody a product they had
 * not asked for, and flickered while doing it.
 *
 * The rule is the whole file. Under /dashboard/ you need a saved Team ID. With
 * one, nothing happens and the page carries on. Without one you go to the ID
 * page, carrying where you were headed so it can put you back there.
 *
 * A file rather than an inline copy in seven <head>s: the gate is the site's
 * one access rule, and seven copies is seven chances for it to stop being one
 * rule. It is deliberately dependency-free — common.js has not loaded yet.
 *
 * Not a security boundary, and not pretending to be one. Every byte this site
 * serves is public and a Team ID is a public number; this is about landing
 * somebody in the right place, not about keeping anybody out. What does keep
 * these pages out of search is the noindex on each of them, which
 * tests/dashboard-gate.test.mjs holds to the same list as this file.
 */
(function () {
    var path = location.pathname.replace(/\/+$/, '') || '/';

    /* Where the app is.
     *
     * /dashboard is the obvious half. /squad-analysis is the other one and it
     * was missed: _redirects serves it from fpl-my-team-analysis.html at 200,
     * so the deepest page in the product — the whole squad, the wizards, the
     * draft planner — opened for anyone who typed that URL, with no Team ID
     * and no gate, because this file only ever looked at the first character
     * of the path. Both spellings are the app; the list says so rather than a
     * prefix test that only knew about one of them. */
    var APP = ['/dashboard', '/squad-analysis'];
    var inApp = false;
    for (var i = 0; i < APP.length; i++) {
        if (path === APP[i] || path.indexOf(APP[i] + '/') === 0) { inApp = true; break; }
    }
    if (!inApp) return;

    /* Pages that belong in the app but do not need a squad.
     *
     * The ID page itself, which would otherwise redirect to itself forever;
     * and the two free reads. The Scout's Desk and the News Hub are written
     * for everybody — asking for a Team ID before letting somebody read this
     * week's article is asking for something the article does not use. They
     * live under /dashboard/ because that is where they belong in the
     * product, not because they are behind anything. */
    var OPEN = ['/dashboard/login', '/dashboard/scouts-desk', '/dashboard/news'];
    if (OPEN.indexOf(path) !== -1) return;

    /* A path under /dashboard/ that is not one of the app's pages.
     *
     * _redirects answers everything under here with index.html at 200, which
     * it has to: the named rules cover the URLs we link and not the ones a
     * trailing slash, a shared link or a typo produce, and without the
     * catch-all those are no page at all. The cost is that /dashboard/nonsense
     * comes back as the home screen — a real page, with real content, at a URL
     * that means nothing, which is the shape of a soft 404 and is how a
     * crawler ends up indexing twenty copies of the dashboard.
     *
     * So the list of what exists lives here instead, and anything else is sent
     * to the 404 page. tests/dashboard-gate.test.mjs holds this list to the
     * 200 rewrites in _redirects, in both directions, so a route added there
     * and forgotten here fails the build rather than becoming unreachable. */
    var KNOWN = ['/dashboard', '/dashboard/my-team', '/dashboard/squad', '/dashboard/players',
        '/dashboard/teams', '/dashboard/rivals', '/dashboard/premium'];
    if (path.indexOf('/dashboard') === 0
        && OPEN.indexOf(path) === -1 && KNOWN.indexOf(path) === -1) {
        location.replace('/404.html');
        return;
    }

    var id = null;
    try { id = localStorage.getItem('fpl_team_id'); } catch (e) {
        /* Private mode, or storage blocked. Treated as "no id": the ID page
           says what is wrong far better than a dashboard with no squad in it. */
    }
    if (id) return;

    /* Where they were going, so the ID page can finish the journey instead of
       dropping them on the home screen. Same-path only — it is read back off a
       query string, and an absolute URL there is somebody else's redirect. */
    var next = path + location.search + location.hash;
    location.replace('/dashboard/login?next=' + encodeURIComponent(next));
})();
