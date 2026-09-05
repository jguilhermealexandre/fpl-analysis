/* ============================================
   EasyFPL — trying a player before you buy him

   Squad Analysis could tell you how healthy your team was and what each player
   projected. It could not answer the question those two numbers exist to serve:
   what happens if I bring this player in.

   The Transfer Wizard answers a narrower version — one player against the man
   he replaces, over a horizon. This is the squad-level version: the same health
   score that judges your team, run against the team with him in it. "He is
   better" is an opinion until the same scoring is applied to both.

   Nothing here is a transfer. The trialist never enters selectedPlayers, is
   flagged wherever he appears, and vanishes on a reload — it is a question, not
   a plan. The Wizard is where a plan is made, and a trial that looked like one
   would be a way to think you had made a transfer you had not.

   WHY THE HEALTH SCORE HAD TO MOVE. It was computed inline inside
   renderTeamAnalysis, so it could only ever describe the squad you own.
   computeSquadHealth() in team-analysis-core.js is the same arithmetic, taking
   the results to judge — which is what lets it judge a squad that does not
   exist.

   Prefix tl*. No DOM reads; render functions return strings.

   DEPENDENCIES: analyzePlayer, computeSquadHealth, selectedPlayers (squad
   page); predictedGWPoints (xp-engine.js); escHTML (common.js).
   ============================================ */

        // { in: player, outId: number } — or null, which is the normal state.
        let tlTrial = null;

        function tlActive() { return tlTrial != null; }
        function tlIncoming() { return tlTrial ? tlTrial.in : null; }
        function tlOutgoingId() { return tlTrial ? tlTrial.outId : null; }

        /* The squad as it would be with the trialist in it.

           He carries the outgoing player's pick position so the eleven stays
           the same shape — swapping a starter brings him into the starting
           eleven, swapping a bench player does not. Getting that wrong would
           quietly compare your XI against a twelve-man one. */
        function tlSquadWith(squad, incoming, outId) {
            const base = squad || [];
            if (!incoming || outId == null) return base.slice();
            const out = base.find(p => p.id === outId);
            if (!out) return base.slice();
            return base.map(p => p.id === outId
                ? {
                    ...incoming,
                    pickPosition: out.pickPosition,
                    onBench: out.onBench,
                    isCaptain: out.isCaptain,
                    isViceCaptain: out.isViceCaptain,
                    sellPrice: incoming.price,
                    isTrialist: true
                }
                : p);
        }

        /* What the trial does to the two numbers Squad Analysis leads on.

           Projected points are the starting eleven's, with the captain doubled,
           because that is what a gameweek actually pays. Health is the whole
           squad's, because a bench that cannot cover is a real weakness that an
           XI total cannot see. */
        function tlEvaluate(squad, incoming, outId) {
            if (typeof analyzePlayer !== 'function' || typeof computeSquadHealth !== 'function') return null;
            const before = squad || [];
            /* No incoming player, or an outgoing one who is not in the squad,
               means there is no swap to describe. tlSquadWith returns a copy in
               that case, so comparing the arrays would not catch it — and the
               result would be a confident set of zero deltas for a trial that
               never happened. */
            if (!incoming || !before.some(p => p.id === outId)) return null;
            const after = tlSquadWith(before, incoming, outId);

            const xi = (list) => list.filter(p => p.pickPosition == null || p.pickPosition <= 11);
            const proj = (p) => typeof predictedGWPoints === 'function' ? predictedGWPoints(p) : 0;
            const total = (list) => xi(list).reduce((s, p) => s + proj(p) * (p.isCaptain ? 2 : 1), 0);

            const beforeHealth = computeSquadHealth(before.map(p => analyzePlayer(p)));
            const afterHealth = computeSquadHealth(after.map(p => analyzePlayer(p)));
            const out = before.find(p => p.id === outId) || null;

            const r1 = (v) => Math.round(v * 10) / 10;
            return {
                in: incoming, out, squad: after,
                xp: { before: r1(total(before)), after: r1(total(after)), delta: r1(total(after) - total(before)) },
                health: {
                    before: beforeHealth.health, after: afterHealth.health,
                    delta: afterHealth.health - beforeHealth.health,
                    breakdown: afterHealth.breakdown
                },
                // Whether you could actually do it, which is not the same
                // question as whether you should.
                money: (() => {
                    if (!out) return null;
                    const bank = (typeof picksData !== 'undefined' && picksData
                        && picksData.entry_history ? picksData.entry_history.bank : 0) / 10;
                    const raised = (out.sellPrice != null ? out.sellPrice : out.price) + bank;
                    return { raised: r1(raised), price: incoming.price, affordable: incoming.price <= raised + 0.001 };
                })()
            };
        }

        /* The banner.

           Leads on the two deltas rather than the two totals: nobody opens this
           to find out their squad scores 61, they open it to find out whether
           this player makes it better. */
        function tlRenderBanner(result) {
            if (!result) return '';
            const esc = typeof escHTML === 'function' ? escHTML : (s => String(s == null ? '' : s));
            const sign = (v) => (v > 0 ? '+' : '') + v;
            const tone = (v) => v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat';

            const money = result.money;
            const moneyLine = !money ? ''
                : money.affordable
                    ? `£${money.price.toFixed(1)}m against the £${money.raised.toFixed(1)}m selling ${esc(result.out.name)} would raise.`
                    : `You could not afford him: £${money.price.toFixed(1)}m against £${money.raised.toFixed(1)}m.`;

            return `<div class="tl-banner">
                <div class="tl-head">
                    <span class="tl-tag">Trying</span>
                    <span class="tl-name">${esc(result.in.name)}</span>
                    ${result.out ? `<span class="tl-swap">in place of ${esc(result.out.name)}</span>` : ''}
                    <button type="button" class="tl-clear" onclick="tlClear()">Clear</button>
                </div>
                <div class="tl-deltas">
                    <div class="tl-delta" data-tooltip="Projected points for your starting eleven this gameweek, with the captain doubled — ${result.xp.before} now, ${result.xp.after} with him in.">
                        <span class="tl-delta-l">Starting XI</span>
                        <span class="tl-delta-v ${tone(result.xp.delta)}">${sign(result.xp.delta)} xP</span>
                    </div>
                    <div class="tl-delta" data-tooltip="The same squad health score as above, recalculated with him in the team — ${result.health.before} now, ${result.health.after} with him in.">
                        <span class="tl-delta-l">Squad health</span>
                        <span class="tl-delta-v ${tone(result.health.delta)}">${sign(result.health.delta)}</span>
                    </div>
                </div>
                ${moneyLine ? `<p class="tl-money${money && !money.affordable ? ' bad' : ''}">${esc(moneyLine)}</p>` : ''}
                <p class="tl-note">He is not in your squad — this only changes the numbers on this page.
                   Make it real in the <a href="#transfers">Transfer Wizard</a>.</p>
            </div>`;
        }

        // The badge that appears wherever a trialist is drawn, so he can never
        // be mistaken for somebody you own.
        function tlBadge(player) {
            return (player && player.isTrialist)
                ? `<span class="tl-badge" data-tooltip="On trial — not in your squad. Nothing here has been transferred.">TRIAL</span>`
                : '';
        }

        /* ===== driving it from the page ===== */

        /* Start a trial. The outgoing player defaults to the weakest projected
           player in the same position — the one he would actually displace,
           rather than whoever happens to sit first in the squad. */
        function tlStart(playerId, outId) {
            const incoming = (typeof allPlayers !== 'undefined' ? allPlayers : [])
                .find(p => p.id === Number(playerId));
            if (!incoming) return;
            if (selectedPlayers.some(p => p.id === incoming.id)) {
                if (typeof updateStatus === 'function') {
                    updateStatus(`${incoming.name} is already in your squad`, 'error');
                }
                return;
            }
            let out = outId != null ? selectedPlayers.find(p => p.id === Number(outId)) : null;
            if (!out) {
                /* The weakest STARTER in the position, not the weakest player.

                   Sorting the whole position by projection puts your bench
                   fodder first, so trying a nine-and-a-half-million midfielder
                   proposed swapping him for somebody who was never going to
                   play — and every delta came back as zero, because the eleven
                   had not changed. Nobody trials a premium to replace a bench
                   slot. Falls back to the whole position when the squad has no
                   starter there, which a blank or an injury can produce. */
                const proj = (p) => typeof predictedGWPoints === 'function' ? predictedGWPoints(p) : 0;
                const inPosition = selectedPlayers.filter(p => p.position === incoming.position);
                const starters = inPosition.filter(p => !(p.pickPosition > 11));
                out = (starters.length ? starters : inPosition).sort((a, b) => proj(a) - proj(b))[0];
            }
            if (!out) return;
            tlTrial = { in: incoming, outId: out.id };
            if (typeof renderTeamAnalysis === 'function') renderTeamAnalysis();
        }

        function tlClear() {
            if (!tlTrial) return;
            tlTrial = null;
            if (typeof renderTeamAnalysis === 'function') renderTeamAnalysis();
        }

        // Called by renderTeamAnalysis. Returns the banner, or nothing at all
        // when no trial is running — which is almost always.
        function tlRenderInto() {
            if (!tlTrial || typeof selectedPlayers === 'undefined') return '';
            const result = tlEvaluate(selectedPlayers, tlTrial.in, tlTrial.outId);
            return result ? tlRenderBanner(result) : '';
        }

        /* The control that starts one, offered next to the squad table.

           A datalist rather than a custom dropdown: it is a name search over
           six hundred players, which is exactly what the browser's own control
           already does well on every platform including a phone keyboard. */
        function tlRenderPicker() {
            if (typeof allPlayers === 'undefined' || !allPlayers.length) return '';
            if (tlTrial) return '';
            /* The datalist ships empty. A browser shows every option it holds
               the moment the field is focused, so pre-loading 260 players meant
               clicking the box dropped the entire league over the page before a
               key was pressed. Options are built from what has been typed
               instead, which is also 260 fewer nodes on every render. */
            return `<div class="tl-picker">
                <label class="tl-picker-l" for="tlPick">Try a player</label>
                <input id="tlPick" class="tl-picker-in" list="tlPlayers" placeholder="Search a player you do not own…"
                    oninput="tlSuggest(this)" onchange="tlPickFromInput(this)" autocomplete="off">
                <datalist id="tlPlayers"></datalist>
            </div>`;
        }

        /* Fills the datalist with what the typed text actually matches.
           Two characters is the threshold: one letter matches a couple of
           hundred players, which is the behaviour being fixed. */
        function tlSuggest(el) {
            const list = document.getElementById('tlPlayers');
            if (!list) return;
            const q = String((el && el.value) || '').trim().toLowerCase();
            if (q.length < 2) { list.innerHTML = ''; return; }

            const esc = typeof escHTML === 'function' ? escHTML : (s => String(s == null ? '' : s));
            const owned = new Set((selectedPlayers || []).map(p => p.id));
            const pool = typeof allPlayers !== 'undefined' ? allPlayers : [];
            list.innerHTML = pool
                .filter(p => !owned.has(p.id) && p.status === 'a'
                    && ((p.name || '').toLowerCase().includes(q) || (p.team || '').toLowerCase().includes(q)))
                .sort((a, b) => (b.ownership || 0) - (a.ownership || 0))
                .slice(0, 10)
                .map(p => `<option value="${esc(p.name)} — ${esc(p.team)} £${p.price.toFixed(1)}m" data-id="${p.id}"></option>`)
                .join('');
        }

        // Resolves what was typed back to a player. Matches the rendered label
        // first, then falls back to a plain name so a half-typed entry still works.
        function tlPickFromInput(el) {
            const raw = (el && el.value || '').trim();
            if (!raw) return;
            const name = raw.split(' — ')[0].trim().toLowerCase();
            const owned = new Set((selectedPlayers || []).map(p => p.id));
            const match = (typeof allPlayers !== 'undefined' ? allPlayers : [])
                .filter(p => !owned.has(p.id))
                .find(p => (p.name || '').toLowerCase() === name);
            if (!match) {
                if (typeof updateStatus === 'function') updateStatus(`No player called "${raw}" to try`, 'error');
                return;
            }
            tlStart(match.id);
        }

        /* The analysis the squad table should draw, when a trial is running.

           Returns null the rest of the time, which is the normal case and means
           the table reads analysisResults exactly as it always did. The trial
           never writes to that global: a page that half-believes you own
           somebody is worse than one that does not offer trials at all. */
        function tlDisplayResults() {
            if (!tlTrial || typeof analyzePlayer !== 'function' || typeof selectedPlayers === 'undefined') return null;
            const squad = tlSquadWith(selectedPlayers, tlTrial.in, tlTrial.outId);
            return squad.map(p => analyzePlayer(p));
        }
