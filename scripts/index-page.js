/* index.html's landing page, and the switch into its other half.
 *
 * 131KB of this was inline in index.html, at the foot of a document that is
 * itself the render-blocking resource on the site's most visited page. Out
 * here it is three things it could not be inline: minified by the same
 * pipeline as every other script, cached on its own for a year behind ?v=,
 * and absent from the bytes the browser has to parse before it can paint.
 *
 * What stayed here is what the landing page runs: the welcome banner, the
 * Team ID form, and activateTeamPage(), which turns this document into a
 * dashboard. The dashboard itself — 124KB of pitch, expected points, tickers
 * and news — moved to index-dashboard.js, which is fetched only once there is
 * a dashboard to draw. The two share one global scope, as everything here
 * does; check:globals reads index.html's script manifest so it still sees
 * them as one page.
 *
 * Loaded in exactly the position the inline block occupied, after
 * sidebar-nav.js. Classic script, not a module: execution order is source
 * order, and the globals it declares are the ones the page's inline onclick=
 * handlers reach for by name.
 */

initIcons();
        loadFooter();

        // ===== FIRST-VISIT WELCOME BANNER =====
        function dismissWelcomeBanner() {
            var el = document.getElementById('welcomeBanner');
            if (el) el.classList.add('hidden');
            try { localStorage.setItem('easyfpl_visited', '1'); } catch(e) {}
        }
        (function() {
            try {
                var visited = localStorage.getItem('easyfpl_visited');
                var hasTeam = localStorage.getItem('fpl_team_id');
                if (!visited && !hasTeam) {
                    var el = document.getElementById('welcomeBanner');
                    if (el) el.classList.remove('hidden');
                    // Mark visited after first view
                    localStorage.setItem('easyfpl_visited', '1');
                }
            } catch(e) {}
        })();

        function onTeamIdSubmitted(teamId) {
            activateTeamPage(teamId);
        }

        function onTeamIdCleared() {
            /* Releases the has-team gate set before first paint. Without this
               the CSS that hides the marketing sections would outlive the team
               it was set for, and a cleared ID would leave an empty dashboard
               with no way back to the form. */
            document.documentElement.classList.remove('has-team');
            document.title = 'EasyFPL \u2014 Free FPL Analysis Tools';
            if (location.pathname === '/dashboard') {
                try { history.replaceState(null, '', '/'); } catch (e) { /* not fatal */ }
            }
            document.getElementById('onboardingCard').classList.remove('hidden');
            document.getElementById('newsStrip').classList.add('hidden');
            document.getElementById('headlinesWidget').classList.add('hidden');
            // Swap hero: show generic, hide personalized
            document.getElementById('heroGeneric').classList.remove('hidden');
            document.getElementById('heroMockup').classList.remove('hidden');
            document.getElementById('heroPersonalized').classList.add('hidden');
            document.querySelector('.hero-banner').classList.remove('hero-logged-in');
            // Show marketing landing sections
            document.getElementById('howItWorks').classList.remove('hidden');
            document.getElementById('trustBar').classList.remove('hidden');
            document.getElementById('featureWizard').classList.remove('hidden');
            document.getElementById('featureMyTeam').classList.remove('hidden');
            document.getElementById('featurePlayers').classList.remove('hidden');
            document.getElementById('featureTeams').classList.remove('hidden');
            document.getElementById('featureRivals').classList.remove('hidden');
            document.getElementById('featureWhat').classList.remove('hidden');
            document.getElementById('featureCompare').classList.remove('hidden');
            document.getElementById('testimonials').classList.remove('hidden');
            /* The deadline countdown belongs to index-dashboard.js, which is
               not on the page until a dashboard is drawn. Anyone who can reach
               this function has drawn one, so the guard is a formality — but
               reading an undeclared binding is a ReferenceError, not undefined,
               and this runs while the page is being put back together. */
            if (typeof deadlineInterval !== 'undefined' && deadlineInterval) {
                clearInterval(deadlineInterval);
                deadlineInterval = null;
            }
        }

        function submitFromOnboarding() {
            const input = document.getElementById('onboardingInput');
            const teamId = input.value.trim();
            if (!teamId || isNaN(teamId)) return;
            saveTeamId(teamId);
            showNavTeamBadge(teamId);
            activateTeamPage(teamId);
        }

        /* Where the visitor was actually trying to go.
         *
         * The squad pages send a signed-out visitor here with ?next= set, so a
         * shared link survives signing in instead of dumping them on the
         * dashboard and leaving them to find their way back.
         *
         * Only a same-origin path is honoured, and it is rebuilt from the
         * parsed URL rather than used as given: taking the parameter at its
         * word would make this an open redirect, where a link to our own
         * domain lands on someone else's. A value like "//evil.example" parses
         * as a host, not a path, and comes back out of this as "/".
         */
        function nextAfterSignIn() {
            try {
                const raw = new URLSearchParams(location.search).get('next');
                if (!raw) return null;
                const url = new URL(raw, location.origin);
                if (url.origin !== location.origin) return null;
                if (!url.pathname.startsWith('/')) return null;
                return url.pathname + url.search + url.hash;
            } catch (e) { return null; }
        }

        function activateTeamPage(teamId) {
            /* Somewhere to be that is not here. Done before the dashboard is
               dressed, because none of that work is worth doing on a page we
               are about to leave. */
            const next = nextAfterSignIn();
            if (next) { location.replace(next); return; }

            /* Mirrors the pre-paint block at the top of <body> for the manager
               who arrives at the landing page and enters an ID: same class,
               same title, same URL, without a reload. */
            document.documentElement.classList.add('has-team');
            /* And the shell, which the pre-paint block does not decide — that
               happens in sidebar-nav.js, once, on load. Someone who arrives
               without a team and then types one into the form at the foot of
               this page was left with the landing header over a dashboard and
               no sidebar at all, until they reloaded. */
            if (typeof v2EnterAppShell === 'function') v2EnterAppShell();
            document.title = 'EasyFPL \u2014 Dashboard';
            if (location.pathname === '/' || location.pathname === '/index.html') {
                try { history.replaceState(null, '', '/dashboard' + location.search + location.hash); } catch (e) { /* not fatal */ }
            }
            const errEl = document.getElementById('onboardingError');
            if (errEl) errEl.classList.add('hidden');
            document.getElementById('onboardingCard').classList.add('hidden');
            var wb = document.getElementById('welcomeBanner');
            if (wb) wb.classList.add('hidden');
            // Swap hero: hide generic, show personalized
            document.getElementById('heroGeneric').classList.add('hidden');
            document.getElementById('heroMockup').classList.add('hidden');
            document.getElementById('heroPersonalized').classList.remove('hidden');
            document.querySelector('.hero-banner').classList.add('hero-logged-in');
            // Hide marketing landing sections
            document.getElementById('howItWorks').classList.add('hidden');
            document.getElementById('trustBar').classList.add('hidden');
            document.getElementById('featureWizard').classList.add('hidden');
            document.getElementById('featureMyTeam').classList.add('hidden');
            document.getElementById('featurePlayers').classList.add('hidden');
            document.getElementById('featureTeams').classList.add('hidden');
            document.getElementById('featureRivals').classList.add('hidden');
            document.getElementById('featureWhat').classList.add('hidden');
            document.getElementById('featureCompare').classList.add('hidden');
            document.getElementById('testimonials').classList.add('hidden');

            /* Everything above is markup this document already carries, so the
               dashboard's shell is on screen now. Everything below needs the
               twelve files listed in the manifest in <head> — expected points,
               odds, the price ticker, readiness — and on a load that began with
               a saved team those have been in flight since before the first
               paint. On a load that began on the landing page this is the
               request for them, and it overlaps the FPL fetch inside
               loadTicker() rather than delaying it. */
            loadDashboardScripts().then(function () { loadTicker(teamId); });
        }

        // ===== SCROLL REVEAL =====
        /* initScrollReveal() in common.js — it used to live here, and the
           feature pages needed the same observer. */
        initScrollReveal();

        // Enter key handlers
        document.getElementById('onboardingInput').addEventListener('keypress', e => {
            if (e.key === 'Enter') submitFromOnboarding();
        });

        // V2: load the shared sidebar partial, then check for a saved team ID.
        loadSidebarNav().then(() => {
            /* Finishing a sign-out that the page they left could not do itself.
               auth.js is not on the squad pages, so v2LogOut() sends whoever
               pressed Log out here with this flag rather than keeping a second
               copy of the cookie names in common.js. Stripped from the address
               bar at once: it is an instruction, not a place. */
            if (new URLSearchParams(location.search).get('signout') === '1') {
                history.replaceState(null, '', location.pathname);
                /* Both, and in this order. auSignOut() reads the session
                   synchronously and has the request in flight before it yields,
                   so clearing straight after it cannot cancel the revocation —
                   and it means the cookie is gone before this frame ends rather
                   than whenever the network answers. Someone who clicks Log in
                   a second later would otherwise navigate away with the old
                   session still sitting there. */
                if (typeof auSignOut === 'function') { auSignOut().catch(() => {}); }
                if (typeof auClearSession === 'function') auClearSession();
                try { sessionStorage.removeItem('easyfpl_signed_in'); } catch (e) { /* private mode */ }
                return;
            }

            const savedTeamId = getSavedTeamId();
            if (savedTeamId) { activateTeamPage(savedTeamId); return; }

            /* Nothing in this browser, but the account may know the squad —
               the case for someone who has just signed in on a second device.

               Only after a sign-in, and only once. It used to run on every
               landing-page load with an empty browser, which cannot tell "first
               time on this device" from "I just deliberately signed out" — and
               answered both by putting the squad back. That is the loop: Log
               out cleared the browser, this read the id off the still-live
               account and put it straight back. Signing in is the event this
               was always for, so signing in is what marks it, and reading the
               mark clears it. */
            let justSignedIn = false;
            try {
                justSignedIn = sessionStorage.getItem('easyfpl_signed_in') === '1';
                if (justSignedIn) sessionStorage.removeItem('easyfpl_signed_in');
            } catch (e) { /* private mode: no mark, so no adoption */ }
            if (!justSignedIn) return;

            adoptTeamIdFromAccount().then(id => { if (id) activateTeamPage(id); });
        });
