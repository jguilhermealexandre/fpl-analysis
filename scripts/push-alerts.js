/* ============================================
   EasyFPL — push alerts

   The only thing on this site that reaches a manager without him first
   remembering the site exists. That makes it the highest-leverage feature here
   and the only one that can lose a user outright, so the whole file is built
   around restraint rather than reach.

   Three rules it enforces:

     Never a broadcast. Every alert is about the subscriber's own squad, which
     is why the team id is part of the subscription rather than something the
     server looks up later. A notification that would read the same to ten
     thousand people is a notification nobody asked for.

     Never asked cold. The browser prompt is one-shot per origin — a refused
     permission cannot be re-requested, it has to be undone in settings, which
     nobody does. So the prompt is only ever raised from a real click on a
     button that says what it will send, and only once the manager has seen the
     thing it is offering to tell him about.

     Never silent about failure. A subscription can be revoked in OS settings
     or rotated by the push service, and the failure mode is that the manager
     simply stops hearing from us — indistinguishable from us having nothing to
     say. pnState() reports what is actually true, not what we last stored.

   iOS: the Push API exists only for a home-screen install. In a normal Safari
   tab window.PushManager is undefined, so pnState() returns 'needs-install'
   and the caller explains rather than offering a button that cannot work.

   Prefix pn*. Depends on the service worker registered in common.js.
   ============================================ */

        /* The endpoint that stores subscriptions and sends the alerts. Same
           origin, so Cloudflare routes it to the push Worker and no CORS or key
           material ever reaches the browser. */
        const PN_API = '/api/push';

        // Where a subscription is remembered locally. Only ever an optimisation
        // for rendering; the browser is the source of truth.
        const PN_STORE = 'easyfpl_push';

        /* What we will send, and nothing else. Each is a thing that happens to
           your squad and that you would want to be interrupted for — the test
           being whether a manager who saw it at 11pm would be glad rather than
           annoyed. Deliberately short: every addition dilutes the ones already
           here, and the fastest way to lose this channel is to use it. */
        const PN_ALERTS = [
            {
                id: 'deadline',
                label: 'Deadline reminder',
                detail: 'Two hours before the deadline, but only if something in your squad still needs you.',
                default: true
            },
            {
                id: 'squad-news',
                label: 'News on your players',
                detail: 'A starter picks up an injury or a doubt, or your captain is left out.',
                default: true
            },
            {
                id: 'price',
                label: 'Price moves on your squad',
                detail: 'A player you own is close to rising or falling tonight.',
                default: false
            }
        ];

        function pnDefaultPrefs() {
            const out = {};
            PN_ALERTS.forEach(a => { out[a.id] = a.default; });
            return out;
        }

        function pnSupported() {
            return typeof navigator !== 'undefined'
                && 'serviceWorker' in navigator
                && typeof window !== 'undefined'
                && 'PushManager' in window
                && 'Notification' in window;
        }

        /* Whether this looks like an iOS home-screen install.

           navigator.standalone is the only reliable signal Safari gives, and it
           matters because it is the difference between "you can turn this on"
           and "you cannot turn this on here, and here is why". */
        function pnStandalone() {
            if (typeof navigator !== 'undefined' && navigator.standalone === true) return true;
            return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
                && window.matchMedia('(display-mode: standalone)').matches;
        }

        function pnIsIOS() {
            const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
            return /iPad|iPhone|iPod/.test(ua);
        }

        /* What the UI should show. Read from the browser rather than from what
           we stored, because a permission revoked in OS settings leaves our own
           record saying everything is fine. */
        async function pnState() {
            if (!pnSupported()) {
                // On iOS the capability appears only after Add to Home Screen,
                // so the honest answer is "not yet" rather than "never".
                return (pnIsIOS() && !pnStandalone()) ? 'needs-install' : 'unsupported';
            }
            if (Notification.permission === 'denied') return 'blocked';
            try {
                const reg = await navigator.serviceWorker.ready;
                const sub = await reg.pushManager.getSubscription();
                if (sub) return 'on';
            } catch (e) { return 'unsupported'; }
            return Notification.permission === 'granted' ? 'off' : 'available';
        }

        // The applicationServerKey has to be raw bytes; the Worker publishes it
        // base64url, which is the form that survives being pasted into config.
        function pnUrlBase64ToUint8Array(base64) {
            const padded = (base64 + '='.repeat((4 - base64.length % 4) % 4))
                .replace(/-/g, '+').replace(/_/g, '/');
            const raw = atob(padded);
            const out = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
            return out;
        }

        /* Turn alerts on. Must be called from a click.

           Returns { ok, state, reason } rather than throwing, because every
           failure here is one the manager has to be told about in words: a
           refused prompt, a missing key, a push service that would not issue an
           endpoint. Silent failure is the one outcome that is not allowed. */
        async function pnEnable(teamId, prefs) {
            if (!pnSupported()) {
                return { ok: false, state: await pnState(), reason: 'This browser cannot receive alerts.' };
            }
            let permission;
            try {
                permission = await Notification.requestPermission();
            } catch (e) {
                return { ok: false, state: 'available', reason: 'The browser would not show the permission prompt.' };
            }
            if (permission !== 'granted') {
                return {
                    ok: false, state: permission === 'denied' ? 'blocked' : 'available',
                    reason: permission === 'denied'
                        ? 'Notifications are blocked for this site. They have to be turned back on in your browser settings.'
                        : 'No answer given, so nothing was turned on.'
                };
            }

            try {
                const keyRes = await fetch(`${PN_API}/key`);
                if (!keyRes.ok) throw new Error('key unavailable');
                const { publicKey } = await keyRes.json();
                if (!publicKey) throw new Error('key missing');

                const reg = await navigator.serviceWorker.ready;
                const sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: pnUrlBase64ToUint8Array(publicKey)
                });

                const res = await fetch(`${PN_API}/subscribe`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        subscription: sub,
                        teamId: teamId ? String(teamId) : null,
                        prefs: prefs || pnDefaultPrefs()
                    })
                });
                if (!res.ok) throw new Error(`server said ${res.status}`);

                try { localStorage.setItem(PN_STORE, JSON.stringify({ teamId, prefs: prefs || pnDefaultPrefs() })); } catch (e) { /* private mode */ }
                return { ok: true, state: 'on' };
            } catch (err) {
                return { ok: false, state: 'off', reason: `Alerts could not be set up (${err.message}).` };
            }
        }

        async function pnDisable() {
            if (!pnSupported()) return { ok: true, state: 'unsupported' };
            try {
                const reg = await navigator.serviceWorker.ready;
                const sub = await reg.pushManager.getSubscription();
                if (sub) {
                    // Tell the server first: an endpoint we stop being able to
                    // reach is one it would otherwise keep trying forever.
                    await fetch(`${PN_API}/unsubscribe`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ endpoint: sub.endpoint })
                    }).catch(() => {});
                    await sub.unsubscribe();
                }
                try { localStorage.removeItem(PN_STORE); } catch (e) { /* private mode */ }
                return { ok: true, state: 'off' };
            } catch (err) {
                return { ok: false, state: 'on', reason: `Could not turn alerts off (${err.message}).` };
            }
        }

        function pnStoredPrefs() {
            try {
                const raw = JSON.parse(localStorage.getItem(PN_STORE) || 'null');
                return (raw && raw.prefs) || pnDefaultPrefs();
            } catch (e) { return pnDefaultPrefs(); }
        }

        /* The control, as it appears under the readiness bar.

           Offered there rather than as a page-level banner because that is the
           moment it makes sense: the manager has just been shown the things
           that still need him, and this is the offer to be told about them when
           he is not looking. Asking on page load, before any of that, is how a
           permission gets refused permanently. */
        function pnRenderToggle(state) {
            const esc = typeof escHTML === 'function' ? escHTML : (s => String(s == null ? '' : s));
            if (state === 'unsupported') return '';
            if (state === 'needs-install') {
                return `<div class="pn-offer muted">
                    <span class="pn-text">Add EasyFPL to your home screen to get alerts about your squad — iPhone only allows them for installed apps.</span>
                </div>`;
            }
            if (state === 'blocked') {
                return `<div class="pn-offer muted">
                    <span class="pn-text">Alerts are blocked for this site in your browser settings.</span>
                </div>`;
            }
            /* What will actually be sent, listed before it is agreed to.

               PN_ALERTS carried a label and a description for each alert from
               the start and neither ever reached the screen — the offer said
               "team news and a deadline nudge" and left the rest to trust. This
               is the one permission on the site that cannot be asked for twice,
               so being vague about it is expensive: a manager who does not know
               what he is agreeing to is a manager who says no, permanently. */
            const list = (on) => `<ul class="pn-list">${PN_ALERTS.map(a => `
                <li class="pn-item${(on && prefs[a.id] === false) ? ' off' : ''}">
                    <span class="pn-item-l">${esc(a.label)}</span>
                    <span class="pn-item-d">${esc(a.detail)}</span>
                </li>`).join('')}</ul>`;

            const prefs = pnStoredPrefs();

            if (state === 'on') {
                return `<details class="pn-offer on">
                    <summary class="pn-sum">
                        <span class="pn-text">Alerts are on for your squad.</span>
                        <span class="pn-more">What you get</span>
                    </summary>
                    ${list(true)}
                    <button type="button" class="pn-btn ghost" onclick="pnToggleFromUI(false)">Turn off alerts</button>
                </details>`;
            }
            return `<details class="pn-offer">
                <summary class="pn-sum">
                    <span class="pn-text">Get told when something in your squad needs you, even when the site is closed.</span>
                    <span class="pn-more">What you get</span>
                </summary>
                ${list(false)}
                <button type="button" class="pn-btn" onclick="pnToggleFromUI(true)">Turn on alerts</button>
            </details>`;
        }

        // Bound to the buttons above. Re-renders in place so the control always
        // reflects what the browser actually thinks, not what we hoped.
        async function pnToggleFromUI(on) {
            const teamId = (() => {
                try { return localStorage.getItem('fpl_team_id'); } catch (e) { return null; }
            })();
            const result = on ? await pnEnable(teamId, pnStoredPrefs()) : await pnDisable();
            if (!result.ok && result.reason && typeof updateStatus === 'function') {
                updateStatus(result.reason, 'error');
            }
            await pnRefreshToggle();
            return result;
        }

        async function pnRefreshToggle() {
            const el = typeof document !== 'undefined' && document.getElementById('pnToggle');
            if (!el) return;
            el.innerHTML = pnRenderToggle(await pnState());
        }
