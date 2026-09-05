/* ============================================
   EasyFPL — what happened while you were away

   A notification centre is not push. Push is a transport for when the site is
   closed; this is the record, and it is the more useful half — it works with no
   permission granted, no server deployed, and no browser support required.
   Anything the Worker eventually sends is one of these events taking a second
   route to the same person.

   Everything here is a diff. The site already ships the state: player status
   and news in bootstrap, live minutes and goals in event-live, prices in
   price-watch. What it never did was remember what any of that looked like the
   last time you were on the page, so "your captain picked up a knock on
   Thursday" was information the site held and could not tell you. A compact
   snapshot in localStorage, compared on load, is the whole mechanism.

   WHAT GOES HERE AND WHAT GOES TO PUSH. The two are not the same list, and
   treating them as one is how a notification channel gets turned off:

     The feed answers "what happened while I was away". It is pull — it costs
     the reader nothing to have twenty items in it, because they chose to look.

     Push answers "something needs you now". It is interrupt, and the budget is
     roughly one a day before it becomes a thing to be silenced.

   So live scoring belongs here in volume and almost never there. A goal in the
   62nd minute is interesting; it is not actionable, because there is nothing
   you can do about your team until the next deadline. The things that reach
   push are the ones that change what you should do: a starter flagged before a
   deadline, the deadline itself with something outstanding.

   RESOLUTION. Live data is refreshed every fifteen minutes during the match
   window by .github/workflows/refresh-live-data.yml. Events are therefore
   accurate but not instant, and the wording avoids implying otherwise — "has
   scored", never "just scored".

   Prefix nt*. No DOM reads; render functions return strings.
   ============================================ */

        const NT_STORE = 'easyfpl_feed';

        // Enough to cover a fortnight of gameweeks without turning localStorage
        // into a season archive. The Season Vault is where history lives.
        const NT_MAX_EVENTS = 60;
        const NT_MAX_AGE_DAYS = 14;

        /* A player's contribution, as one line rather than a stream.

           The alternative — an event per goal, per assist, per bonus change —
           produces a dozen entries for one good afternoon from one player, and
           bonus in particular is provisional and moves repeatedly. One event
           per player per gameweek, rewritten as the numbers change, says the
           same thing and stays readable. */
        function ntLiveSummary(st) {
            const bits = [];
            if (st.g) bits.push(`${st.g} goal${st.g > 1 ? 's' : ''}`);
            if (st.a) bits.push(`${st.a} assist${st.a > 1 ? 's' : ''}`);
            if (st.cs) bits.push('clean sheet');
            if (st.sv >= 3) bits.push(`${st.sv} saves`);
            if (st.b) bits.push(`${st.b} bonus`);
            if (st.rc) bits.push('red card');
            else if (st.yc) bits.push('booked');
            // "yet" is a promise, and at full time there is nothing left to
            // promise. A player on 90 minutes with nothing to show is done.
            if (!bits.length) {
                bits.push(!st.min ? 'yet to feature' : st.min >= 90 ? 'no returns' : 'no returns yet');
            }
            return bits.join(', ');
        }

        // Only the fields a diff can turn into a sentence. Keeping the snapshot
        // narrow is what lets it live in localStorage next to everything else.
        function ntSnapshot(squad, live, phase, gw) {
            const status = {}, stats = {};
            (squad || []).forEach(p => {
                status[p.id] = p.status || 'a';
                const st = live && live[p.id];
                if (st) {
                    stats[p.id] = {
                        pts: st.pts || 0, min: st.min || 0, g: st.g || 0, a: st.a || 0,
                        b: st.b || 0, cs: st.cs || 0, yc: st.yc || 0, rc: st.rc || 0, sv: st.sv || 0
                    };
                }
            });
            return { status, stats, phase: phase || null, gw: gw || null };
        }

        const NT_STATUS_WORD = {
            i: 'is injured', s: 'is suspended', u: 'is unavailable', d: 'is a doubt', a: 'is fit again'
        };

        /* Every event the current state implies that the previous one did not.

           ctx: { squad, live, phase, gw, now, prev }  — prev is a snapshot from
           ntSnapshot(), or null on a first visit. A first visit deliberately
           produces nothing: a feed that opens with forty things that happened
           before you ever arrived is noise pretending to be history. */
        function ntCollect(ctx) {
            const c = ctx || {};
            const squad = c.squad || [];
            const live = c.live || {};
            const now = c.now != null ? c.now : Date.now();
            const gw = c.gw;
            const prev = c.prev;
            const out = [];
            if (!prev) return out;

            const byId = {};
            squad.forEach(p => { byId[p.id] = p; });

            // --- availability, which is the one thing here that is actionable
            Object.keys(byId).forEach(id => {
                const p = byId[id];
                const was = prev.status ? prev.status[id] : undefined;
                const is = p.status || 'a';
                if (was === undefined || was === is) return;
                const better = is === 'a';
                out.push({
                    id: `news-${gw}-${id}-${is}`,
                    kind: 'squad-news',
                    tone: better ? 'good' : 'bad',
                    title: p.name,
                    body: `${p.name} ${NT_STATUS_WORD[is] || 'has a news update'}${p.news ? ` — ${p.news}` : ''}`,
                    at: now,
                    href: `fpl-my-team-analysis.html#squad?player=${p.id}`
                });
            });

            // --- what your players did, one line each, rewritten as it changes
            Object.keys(live).forEach(id => {
                const p = byId[id];
                if (!p) return;
                const st = live[id];
                const was = prev.stats ? prev.stats[id] : null;
                const changed = !was || ['pts', 'min', 'g', 'a', 'b', 'cs', 'yc', 'rc', 'sv']
                    .some(k => (was[k] || 0) !== (st[k] || 0));
                if (!changed) return;
                const pts = st.pts || 0;
                out.push({
                    id: `live-${gw}-${id}`,
                    kind: 'live',
                    tone: st.rc ? 'bad' : pts >= 6 ? 'good' : 'info',
                    title: `${p.name} — ${pts} point${pts === 1 ? '' : 's'}`,
                    body: `${ntLiveSummary(st)}${st.min ? ` · ${st.min}'` : ''}`,
                    at: now,
                    href: 'index.html'
                });
            });

            /* --- the gameweek turning over. Time-based rather than a diff of
               anything a player did, and the only events that fire when nothing
               about your squad has changed at all. */
            if (prev.phase && c.phase && prev.phase !== c.phase) {
                const moved = { locked: {
                    tone: 'info', title: `GW${gw} is locked`,
                    body: 'Your team is set. Nothing can change until the matches finish.'
                }, live: {
                    tone: 'info', title: `GW${gw} is under way`,
                    body: 'Matches have kicked off. Scores here update every fifteen minutes.'
                }, upcoming: {
                    tone: 'info', title: `GW${gw} is done`,
                    body: 'Every match has finished. Time to plan the next one.'
                } }[c.phase];
                if (moved) {
                    out.push({ id: `phase-${gw}-${c.phase}`, kind: 'phase', at: now, href: 'index.html', ...moved });
                }
            }

            return out;
        }

        /* Fold new events into the stored log.

           Matching on id rather than appending: a live line for one player is
           rewritten in place as his afternoon goes on, and its timestamp moves
           with it so it counts as unread again. Twelve separate entries for one
           hat-trick would be the alternative. */
        function ntMerge(existing, incoming, now) {
            const byId = new Map((existing || []).map(e => [e.id, e]));
            (incoming || []).forEach(e => { byId.set(e.id, e); });
            const cutoff = (now != null ? now : Date.now()) - NT_MAX_AGE_DAYS * 86400000;
            return [...byId.values()]
                .filter(e => e.at >= cutoff)
                .sort((a, b) => b.at - a.at)
                .slice(0, NT_MAX_EVENTS);
        }

        function ntLoad() {
            try {
                const raw = JSON.parse(localStorage.getItem(NT_STORE) || 'null');
                if (!raw || !Array.isArray(raw.events)) return { events: [], lastSeen: 0, snapshot: null };
                return { events: raw.events, lastSeen: raw.lastSeen || 0, snapshot: raw.snapshot || null };
            } catch (e) { return { events: [], lastSeen: 0, snapshot: null }; }
        }

        function ntSave(state) {
            try { localStorage.setItem(NT_STORE, JSON.stringify(state)); } catch (e) { /* private mode */ }
            return state;
        }

        // A function declaration rather than a const arrow, like everything else
        // here: those are the ones that become real globals, so another script
        // can ask how many are unread without going through the renderer.
        function ntUnread(events, lastSeen) {
            return (events || []).filter(e => e.at > (lastSeen || 0)).length;
        }

        /* Run one pass: diff, merge, persist. Returns the state to render.
           The snapshot is always written, even when nothing came of it, so the
           next visit compares against what was actually on screen this time. */
        function ntUpdate(ctx) {
            const state = ntLoad();
            const now = ctx && ctx.now != null ? ctx.now : Date.now();
            const events = ntCollect({ ...ctx, now, prev: state.snapshot });
            const merged = ntMerge(state.events, events, now);
            const next = {
                events: merged,
                lastSeen: state.lastSeen,
                snapshot: ntSnapshot(ctx.squad, ctx.live, ctx.phase, ctx.gw)
            };
            ntSave(next);
            return { ...next, unread: ntUnread(merged, state.lastSeen), fresh: events.length };
        }

        // Called when the panel is opened, not when the page loads: a feed that
        // marks itself read on render is one you can miss by blinking.
        function ntMarkSeen(now) {
            const state = ntLoad();
            state.lastSeen = now != null ? now : Date.now();
            ntSave(state);
            return state;
        }

        /* ===== rendering ===== */

        function ntAgo(at, now) {
            const secs = Math.max(0, Math.round(((now != null ? now : Date.now()) - at) / 1000));
            if (secs < 90) return 'just now';
            const mins = Math.round(secs / 60);
            if (mins < 60) return `${mins} min ago`;
            const hrs = Math.round(mins / 60);
            if (hrs < 24) return `${hrs}h ago`;
            const days = Math.round(hrs / 24);
            return `${days} day${days === 1 ? '' : 's'} ago`;
        }

        function ntBellHTML(unread) {
            const n = unread || 0;
            return `<button type="button" class="nt-bell${n ? ' has-new' : ''}" onclick="ntTogglePanel()"
                aria-label="${n ? `${n} new since your last visit` : 'Nothing new'}" aria-expanded="false">
                <span class="nt-bell-icon" aria-hidden="true">🔔</span>
                ${n ? `<span class="nt-badge">${n > 9 ? '9+' : n}</span>` : ''}
            </button>`;
        }

        function ntPanelHTML(events, lastSeen, now) {
            const esc = typeof escHTML === 'function' ? escHTML : (s => String(s == null ? '' : s));
            if (!events || !events.length) {
                return `<div class="nt-panel">
                    <div class="nt-head">Activity</div>
                    <p class="nt-empty">Nothing yet. Once you have been here a couple of times, this is where
                       news on your players, what they scored, and the gameweek turning over will show up.</p>
                </div>`;
            }
            const row = (e) => `<a class="nt-row ${esc(e.tone || 'info')}" href="${esc(e.href || 'index.html')}">
                <span class="nt-row-title">${esc(e.title)}</span>
                <span class="nt-row-body">${esc(e.body)}</span>
                <span class="nt-row-when">${esc(ntAgo(e.at, now))}</span>
            </a>`;

            const fresh = events.filter(e => e.at > (lastSeen || 0));
            const older = events.filter(e => e.at <= (lastSeen || 0));

            /* Split rather than a single list with dots against some of them.
               "Since your last visit" is the question this panel exists to
               answer, so it is a heading rather than a decoration. */
            return `<div class="nt-panel">
                <div class="nt-head">Activity</div>
                ${fresh.length ? `<div class="nt-group">
                    <span class="nt-group-l">Since your last visit</span>
                    ${fresh.map(row).join('')}
                </div>` : '<p class="nt-empty">Nothing new since you were last here.</p>'}
                ${older.length ? `<div class="nt-group">
                    <span class="nt-group-l">Earlier</span>
                    ${older.map(row).join('')}
                </div>` : ''}
            </div>`;
        }

        /* ===== the control on the page =====

           Kept apart from the model above so everything that decides what an
           event is stays testable without a DOM. */

        function ntRenderInto(ctx) {
            const host = document.getElementById('ntCentre');
            if (!host) return null;
            const state = ntUpdate(ctx);
            host.innerHTML = ntBellHTML(state.unread)
                + `<div class="nt-drop" id="ntDrop" hidden>${ntPanelHTML(state.events, state.lastSeen)}</div>`;
            return state;
        }

        function ntTogglePanel() {
            const drop = document.getElementById('ntDrop');
            const bell = document.querySelector('.nt-bell');
            if (!drop) return;
            const opening = drop.hidden;
            drop.hidden = !opening;
            if (bell) bell.setAttribute('aria-expanded', String(opening));
            if (!opening) return;

            /* Marked read on open, and the panel is re-rendered from the state
               as it was before that — so the "since your last visit" grouping
               you opened it to read does not vanish as you read it. */
            const before = ntLoad();
            drop.innerHTML = ntPanelHTML(before.events, before.lastSeen);
            ntMarkSeen();
            const badge = document.querySelector('.nt-badge');
            if (badge) badge.remove();
            if (bell) bell.classList.remove('has-new');
        }

        // Clicking away closes it. Registered once, on the document, because the
        // bell itself is re-rendered on every dashboard pass.
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            document.addEventListener('click', (ev) => {
                const host = document.getElementById('ntCentre');
                const drop = document.getElementById('ntDrop');
                if (!host || !drop || drop.hidden) return;
                if (!host.contains(ev.target)) {
                    drop.hidden = true;
                    const bell = document.querySelector('.nt-bell');
                    if (bell) bell.setAttribute('aria-expanded', 'false');
                }
            });
        }
