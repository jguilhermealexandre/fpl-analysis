/* ============================================
   EasyFPL — the Matchday panel (bookmakers' odds)

   The Lineup Wizard's third intel tab: this gameweek's fixtures with what the
   betting market thinks will happen in them, and which of your players are in
   each one.

   Why odds belong here and nowhere else on the site. Bookmakers price one round
   at a time, so this can say a great deal about the gameweek you are picking a
   team for and nothing at all about GW+5. The Lineup Wizard is the one screen
   whose entire question is "this week", which makes it the only screen where
   that limitation costs nothing. The Transfer Wizard deliberately does not use
   it: a transfer is a five-gameweek commitment and the market has no opinion
   that far out.

   None of these numbers are quoted by a bookmaker. Nobody prices "clean sheet
   %". They are derived in tools/odds-model.mjs from the two markets that are
   priced on every fixture — 1X2 and over/under 2.5 goals — and committed to
   data/odds.json by .github/workflows/fetch-odds.yml. The derivation is
   deliberately not in the browser: it is the same answer for everyone, so it is
   computed once rather than 610 times a day.

   The model's own clean-sheet number is shown next to the market's rather than
   replaced by it. Across a full round they disagree by about five percentage
   points on average and by as much as fifteen on individual fixtures, which is
   worth seeing rather than silently resolving.

   Prefix bo*. Classic script; the inline onclick= handlers depend on the
   functions staying global.

   DEPENDENCIES: DataCache, DATA_URLS, escHTML (scripts/common.js);
   lineupState, teams, currentGW (the squad page); getCleanSheetProb
   (scripts/transfer-wizard.js) — all optional-guarded.
   ============================================ */

        let boOdds = null;            // parsed data/odds.json, or null until loaded
        let boOddsPromise = null;     // in-flight load, so N callers cause one fetch
        let boOddsError = null;

        /* Loaded once and shared. Absence is a normal state, not an error: the
           feed is written by a scheduled job, so on a fresh deploy — or if
           football-data.co.uk is down — the file simply is not there, and the
           tab has to say so rather than break the wizard around it. */
        function boLoadOdds() {
            if (boOddsPromise) return boOddsPromise;
            const url = (typeof DATA_URLS !== 'undefined' && DATA_URLS.odds) || 'data/odds.json';
            const load = (typeof DataCache !== 'undefined' && DataCache.fetchJSON)
                ? DataCache.fetchJSON(url)
                : fetch(url).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
            boOddsPromise = load
                .then(d => {
                    boOdds = (d && Array.isArray(d.matches)) ? d : null;
                    if (!boOdds) boOddsError = 'the odds feed is present but empty';
                    return boOdds;
                })
                .catch(err => {
                    boOddsError = err && err.message ? err.message : 'could not be loaded';
                    boOdds = null;
                    return null;
                });
            return boOddsPromise;
        }

        // Matches for one gameweek, in kick-off order. Defaults to the earliest
        // gameweek the feed covers, which is the one being picked for.
        function boMatchesForEvent(event) {
            if (!boOdds) return [];
            const target = event != null ? event
                : Math.min.apply(null, boOdds.matches.map(m => m.event));
            return boOdds.matches
                .filter(m => m.event === target)
                .sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)));
        }

        /* One team's view of its own fixture — which is the direction everything
           on this panel is read in. A clean sheet belongs to the team keeping it,
           not to the home side, and getting that backwards would attach the
           opponent's numbers to your defender. */
        function boTeamView(teamId) {
            if (!boOdds) return null;
            const m = boOdds.matches.find(x => x.homeId === teamId || x.awayId === teamId);
            if (!m) return null;
            const isHome = m.homeId === teamId;
            return {
                match: m, isHome,
                opponentId: isHome ? m.awayId : m.homeId,
                opponent: isHome ? m.away : m.home,
                goalsFor: isHome ? m.lambdaHome : m.lambdaAway,
                goalsAgainst: isHome ? m.lambdaAway : m.lambdaHome,
                cleanSheet: isHome ? m.csHome : m.csAway,
                win: isHome ? m.winHome : m.winAway,
                draw: m.draw
            };
        }

        function boPct(v) { return Math.round(v * 100) + '%'; }

        function boKickoff(iso) {
            if (!iso) return '';
            const d = new Date(iso);
            if (isNaN(d)) return '';
            return d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
        }

        // Your squad members in a given fixture, so the panel answers "does this
        // match matter to me" rather than just "what is the market saying".
        function boSquadIn(match) {
            if (typeof lineupState === 'undefined' || !lineupState || !lineupState.squad) return [];
            const xi = new Set((lineupState.xi || []).map(p => p.id));
            return lineupState.squad
                .filter(p => p.teamId === match.homeId || p.teamId === match.awayId)
                .map(p => ({
                    id: p.id, name: p.web_name || p.name, teamId: p.teamId,
                    starting: xi.has(p.id),
                    captain: lineupState.captain === p.id,
                    vice: lineupState.viceCaptain === p.id
                }))
                .sort((a, b) => (b.starting - a.starting) || (b.captain - a.captain));
        }

        function boRenderMatch(m) {
            const mine = boSquadIn(m);
            const total = (m.lambdaHome + m.lambdaAway);

            // The result bar is the de-vigged market, not the reconstruction, so
            // what is drawn is what was actually priced.
            const bar = `<span class="bo-res">
                <i class="bo-res-h" style="width:${(m.market.home * 100).toFixed(1)}%" data-tooltip="${escHTML(m.homeName)} win — ${boPct(m.market.home)}"></i>
                <i class="bo-res-d" style="width:${(m.market.draw * 100).toFixed(1)}%" data-tooltip="Draw — ${boPct(m.market.draw)}"></i>
                <i class="bo-res-a" style="width:${(m.market.away * 100).toFixed(1)}%" data-tooltip="${escHTML(m.awayName)} win — ${boPct(m.market.away)}"></i>
            </span>`;

            const side = (teamId, short, name, goals, cs, isHome) => {
                // The site's own clean-sheet model, side by side with the
                // market's. Where they disagree by a lot is the interesting part.
                let modelCs = null;
                if (typeof getCleanSheetProb === 'function' && typeof teamAnalysis !== 'undefined') {
                    const opp = isHome ? m.awayId : m.homeId;
                    try { modelCs = getCleanSheetProb(teamId, opp, isHome); } catch (e) { modelCs = null; }
                }
                const gap = modelCs != null ? Math.abs(modelCs - cs) : 0;
                const gapCls = gap >= 0.10 ? ' wide' : '';
                return `<div class="bo-side">
                    <div class="bo-side-top"><span class="bo-team">${escHTML(short)}</span>
                        <span class="bo-ha">${isHome ? 'H' : 'A'}</span></div>
                    <div class="bo-metric" data-tooltip="${escHTML(`Goals ${name} are expected to score, implied by the match and over/under prices.`)}">
                        <span class="bo-metric-l">xG</span><b>${goals.toFixed(2)}</b></div>
                    <div class="bo-metric${gapCls}" data-tooltip="${escHTML(
                        `Chance ${name} keep a clean sheet — the market says ${boPct(cs)}` +
                        (modelCs != null ? `, this site's own model says ${boPct(modelCs)}.` : '.'))}">
                        <span class="bo-metric-l">CS</span><b>${boPct(cs)}</b>${modelCs != null
                            ? `<span class="bo-model">vs ${boPct(modelCs)}</span>` : ''}</div>
                </div>`;
            };

            const top = m.scorelines && m.scorelines[0];
            const mineHtml = mine.length
                ? `<div class="bo-mine"><span class="bo-mine-l">Yours</span>${mine.map(p =>
                    `<span class="bo-chip ${p.starting ? 'xi' : 'bench'}" data-tooltip="${escHTML(p.name)} — ${p.starting ? 'in your XI' : 'on your bench'}${p.captain ? ', captain' : p.vice ? ', vice-captain' : ''}">${escHTML(p.name)}${p.captain ? ' (C)' : p.vice ? ' (V)' : ''}</span>`).join('')}</div>`
                : `<div class="bo-mine none">No players of yours in this match.</div>`;

            return `<div class="bo-match${mine.length ? '' : ' bo-dim'}">
                <div class="bo-match-head">
                    <span class="bo-ko">${escHTML(boKickoff(m.kickoff))}</span>
                    <span class="bo-fix">${escHTML(m.homeName)} <em>v</em> ${escHTML(m.awayName)}</span>
                    <span class="bo-goals" data-tooltip="Total goals the market expects in this match.">${total.toFixed(2)}<i>goals</i></span>
                </div>
                ${bar}
                <div class="bo-sides">
                    ${side(m.homeId, m.home, m.homeName, m.lambdaHome, m.csHome, true)}
                    ${side(m.awayId, m.away, m.awayName, m.lambdaAway, m.csAway, false)}
                </div>
                <div class="bo-extras">
                    <span class="bo-ex" data-tooltip="Chance of three or more goals in the match.">Over 2.5 <b>${boPct(m.over25)}</b></span>
                    <span class="bo-ex" data-tooltip="Chance both teams score.">BTTS <b>${boPct(m.bttsYes)}</b></span>
                    ${top ? `<span class="bo-ex" data-tooltip="The single likeliest scoreline, at ${boPct(top.p)}.">Likeliest <b>${top.h}–${top.a}</b></span>` : ''}
                </div>
                ${mineHtml}
            </div>`;
        }

        function renderBOMatchdayPanel() {
            if (!boOdds) {
                boLoadOdds().then(d => { if (d) boRefreshPanel(); });
                return boOddsError
                    ? `<div class="lw-side-empty">Bookmakers' odds are unavailable right now — ${escHTML(boOddsError)}. The rest of the wizard is unaffected; every projection on this page is the site's own model and does not depend on this feed.</div>`
                    : `<div class="lw-side-empty">Loading this gameweek's odds…</div>`;
            }

            const matches = boMatchesForEvent();
            if (!matches.length) {
                return `<div class="lw-side-empty">No priced fixtures for this gameweek yet. Bookmakers price a round at a time, usually from the start of the week.</div>`;
            }

            const gw = matches[0].event;
            const updated = boOdds.metadata && boOdds.metadata.lastUpdated
                ? new Date(boOdds.metadata.lastUpdated) : null;
            const stale = updated ? (Date.now() - updated.getTime()) > 36 * 3600 * 1000 : false;

            return `<div class="bo-panel">
                <div class="bo-head">
                    <span class="bo-title">Matchday odds <span class="bo-gw">GW${gw}</span></span>
                    <span class="bo-src" data-tooltip="Consensus prices across the bookmakers published by football-data.co.uk. Nobody quotes a clean-sheet percentage — these are derived from the 1X2 and over/under 2.5 markets with the bookmaker's margin removed.">
                        ${matches.length} matches${updated ? ` · ${escHTML(updated.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}` : ''}</span>
                </div>
                ${stale ? `<div class="bo-stale">These prices are more than a day old — the odds job has not run since. Treat them as indicative.</div>` : ''}
                <div class="bo-matches">${matches.map(boRenderMatch).join('')}</div>
                <div class="bo-foot">Derived from de-vigged 1X2 and over/under 2.5 prices, fitted to independent Poisson. Odds describe one gameweek only, which is why they appear here and not in the Transfer Wizard. Source: football-data.co.uk.</div>
            </div>`;
        }

        // Repaint once the feed lands, but only if the reader is still looking at
        // this tab — otherwise an async resolve would yank them out of whatever
        // they switched to while it was loading.
        function boRefreshPanel() {
            if (typeof lineupState === 'undefined' || !lineupState) return;
            if (lineupState.intelTab !== 'odds') return;
            if (typeof updateLWContextPanel === 'function') updateLWContextPanel();
        }
