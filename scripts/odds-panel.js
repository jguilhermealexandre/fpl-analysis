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

        /* ===== Feeding the market back into the projection =====

           The site's own expected-goals-against and the market's are estimates of
           exactly the same quantity, and both turn it into a clean sheet the same
           way — exp(-xGA). So there is one number to reconcile, not two models.

           Measuring them against each other on a full round found something worth
           acting on. The model's total for the round was almost exactly the
           market's (30.9 goals against 29.5), so its overall level is right. Its
           home/away split was not: home sides were projected to concede 9.99
           where the market said 13.48, away sides 20.94 against 16.01. That is a
           venue effect roughly 1.8 times what the market prices, and it traces to
           expectedGoalsAgainst applying venue three times over — through the
           team's own home/away defensive rating, again through the opponent's
           home/away attacking rating, and once more through an explicit
           venueFactor.

           Rather than hard-code a correction from twenty samples in one round,
           the market is blended in with the weight the rest of this engine
           already uses for evidence: heavy while the model knows little, fading
           as its own sample fills in. At two matches played the market carries
           most of it; by a dozen the model is trusted with most of its own
           judgement. The floor is deliberately not zero — a liquid market prices
           team news, suspensions and motivation that no ratings model sees. */
        const BO_WEIGHT_EARLY = 0.75;
        const BO_WEIGHT_LATE = 0.30;
        const BO_WEIGHT_FULL_EVIDENCE = 12;   // matches played before the floor

        function boMarketWeight(matchesPlayed) {
            const played = Math.max(0, Number(matchesPlayed) || 0);
            const t = Math.min(1, played / BO_WEIGHT_FULL_EVIDENCE);
            return BO_WEIGHT_EARLY + (BO_WEIGHT_LATE - BO_WEIGHT_EARLY) * t;
        }

        /* Injected during the page's data-loading phase rather than fetched when
           the tab is first opened.

           If the feed arrived lazily, the projections rendered before it landed
           would use the model and the ones after it would use the market — on the
           same screen, for the same players. Loading it with bootstrap and
           fixtures means every number in a render pass comes from the same
           inputs. boLoadOdds() remains for anything that opens the panel without
           having gone through that phase. */
        let _boIndex = null;
        let _boPricedRounds = null;

        function boSetOdds(data) {
            boOdds = (data && Array.isArray(data.matches) && data.matches.length) ? data : null;
            if (!boOdds && data) boOddsError = 'the odds feed is present but empty';
            boOddsPromise = Promise.resolve(boOdds);
            _boIndex = null;
            _boPricedRounds = null;
            return boOdds;
        }

        // Keyed by opponent as well as gameweek: in a double gameweek a team has
        // two fixtures in one event, and keying on the event alone would price
        // both of them off whichever was written last.
        function boIndex() {
            if (_boIndex) return _boIndex;
            _boIndex = new Map();
            if (!boOdds) return _boIndex;
            boOdds.matches.forEach(m => {
                _boIndex.set(m.homeId + ':' + m.event + ':' + m.awayId, { xga: m.lambdaAway, xgf: m.lambdaHome });
                _boIndex.set(m.awayId + ':' + m.event + ':' + m.homeId, { xga: m.lambdaHome, xgf: m.lambdaAway });
            });
            return _boIndex;
        }

        /* Only ever applied to a gameweek where every fixture is priced.

           A partially priced round is worse than an unpriced one: eight teams
           would carry market goal expectations and twelve would not, and every
           comparison between a player from one group and a player from the other
           would be measuring the difference between two estimators rather than
           between two footballers. */
        function boRoundFullyPriced(event) {
            if (!boOdds || event == null) return false;
            if (!_boPricedRounds) _boPricedRounds = new Map();
            if (_boPricedRounds.has(event)) return _boPricedRounds.get(event);
            const priced = boOdds.matches.filter(m => m.event === event).length;
            const stated = ((boOdds.metadata && boOdds.metadata.coverage) || [])
                .find(c => c.event === event);
            let ok = false;
            if (priced > 0 && stated && stated.complete) {
                // The feed says the round is complete. Where the page also holds
                // the fixture list, check it — a postponement after the odds were
                // written would make that claim stale.
                ok = (typeof allFixtures !== 'undefined' && Array.isArray(allFixtures) && allFixtures.length)
                    ? allFixtures.filter(f => f.event === event).length === priced
                    : true;
            }
            _boPricedRounds.set(event, ok);
            return ok;
        }

        // The market's expected goals against for one team in one fixture, or
        // null when there is no usable price — which is the normal case for every
        // gameweek except the next one.
        function boMarketXGA(teamId, fixture) {
            if (!boOdds || !fixture || fixture.event == null || fixture.opponentId == null) return null;
            if (!boRoundFullyPriced(fixture.event)) return null;
            const hit = boIndex().get(teamId + ':' + fixture.event + ':' + fixture.opponentId);
            return hit ? hit.xga : null;
        }

        // What the panel reports about itself, so a blended projection is never a
        // silent one.
        function boBlendInfo() {
            if (!boOdds) return { active: false };
            const events = [...new Set(boOdds.matches.map(m => m.event))].sort((a, b) => a - b);
            const event = events[0];
            const played = (typeof teamAnalysis !== 'undefined' && teamAnalysis)
                ? (Object.values(teamAnalysis)[0] || {}).matchesPlayed : null;
            return {
                active: boRoundFullyPriced(event),
                event,
                weight: boMarketWeight(played),
                matchesPlayed: played,
                priced: boOdds.matches.filter(m => m.event === event).length
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
                ${(() => {
                    const b = boBlendInfo();
                    return b.active
                        ? `<div class="bo-blend on" data-tooltip="${escHTML(
                            `Every projection on this page for GW${b.event} is ${Math.round(b.weight * 100)}% the market's goal expectations and ${Math.round((1 - b.weight) * 100)}% this site's model. The market's share falls as the season gives the model more of its own evidence — currently ${b.matchesPlayed ?? 0} matches played. Later gameweeks are model-only: bookmakers do not price them yet.`)}">
                            Blended into GW${b.event} projections · market weight ${Math.round(b.weight * 100)}%</div>`
                        : `<div class="bo-blend off" data-tooltip="Projections are model-only. The market is blended in only when every fixture in the round is priced, so that no two players are being compared across different estimators.">
                            Shown for reference — not blended into projections</div>`;
                })()}
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
