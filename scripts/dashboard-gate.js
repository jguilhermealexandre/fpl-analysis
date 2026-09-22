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
 * somebody in the right place, not about keeping anybody out.
 */
(function () {
    var path = location.pathname;

    /* index.html answers both / and /dashboard. At / it is the landing page
       and there is nothing to gate. */
    if (path.indexOf('/dashboard') !== 0) return;

    /* The ID page itself, which would otherwise redirect to itself forever. */
    if (path === '/dashboard/login') return;

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
