/* ============================================
   EasyFPL — Shared AI Scouting Report / Compare Engine
   Used by fpl-players-analysis.html (All Players table) and
   fpl-my-team-analysis.html (Squad Analysis). Fully deterministic —
   no API calls, everything here is stats + template logic.

   Callers must have these in scope before this script runs:
     - globals: teams, teamAnalysis, fixtureSwingData, Chart (CDN), lucide
     - functions: escHTML() (scripts/common.js), getCleanSheetProb(),
       getTeamXgWindow(), getTeamSeasonXg() (page-local)
     - optional (safe if absent): window._risingFormScores, window._routesData,
       window._teamBank

   Each host page defines its own onCompareCheckboxChange(playerId) that
   resolves a full player object (see buildComparePlayer() on My Team,
   or the tableData.ALL lookup on the Players page) and calls
   toggleComparePlayer(player) below. Each page may also define
   onCompareSelectionChange() to refresh its own UI after the list changes;
   this file has no page-specific DOM assumptions beyond #compareBar/
   #compareCount/#comparePlayersList/#compareModal/#compareModalContent.
   ============================================ */

let compareList = [];
const MAX_COMPARE = 5;
let reportRadarChart = null;

// ============================================
// COMPARE LIST STATE
// ============================================
function toggleComparePlayer(player) {
    if (!player) return;
    const idx = compareList.findIndex(p => p.id === player.id);
    if (idx > -1) {
        compareList.splice(idx, 1);
    } else if (compareList.length < MAX_COMPARE) {
        compareList.push(player);
    }
    updateCompareBar();
    if (typeof onCompareSelectionChange === 'function') onCompareSelectionChange();
}

function removeFromCompare(playerId) {
    compareList = compareList.filter(p => p.id !== playerId);
    updateCompareBar();
    if (typeof onCompareSelectionChange === 'function') onCompareSelectionChange();
}

function clearCompare() {
    compareList = [];
    updateCompareBar();
    if (typeof onCompareSelectionChange === 'function') onCompareSelectionChange();
}

function updateCompareBar() {
    const bar = document.getElementById('compareBar');
    const count = document.getElementById('compareCount');
    const list = document.getElementById('comparePlayersList');

    if (!bar) return;

    if (compareList.length > 0) {
        bar.classList.add('show');
        count.textContent = compareList.length;
        list.innerHTML = compareList.map(p => `
            <div class="compare-player-chip">
                <span>${escHTML(p.name)}</span>
                <button onclick="removeFromCompare(${p.id})">×</button>
            </div>
        `).join('');
    } else {
        bar.classList.remove('show');
    }
}

// ============================================
// AI SCOUTING REPORT — DATA ENGINE
// ============================================
        /* The windowed totals every table and every report row on this site is
           built from — and the ONLY place they are counted.

           This used to slice the player's own history: `history.slice(-5)`, the
           last five ROWS. The profile card counts the last five ROUNDS from the
           fixture list. They agree while every club plays every week and every
           player has a row for every fixture, and they stop agreeing the moment
           either is untrue — which it already is:

             · A club with a blank has fewer rows, so slice(-5) reaches back a
               sixth gameweek to fill the window. Two players in the same
               comparison were being measured over different five gameweeks,
               both labelled L5.
             · 107 of the 658 players in the current feed have fewer rows than
               their club has played, so the denominator under "per game" was a
               different number for them than for their team-mates.
             · FPL writes a zeroed row the moment a fixture is scheduled. A round
               still in flight therefore gave everyone whose match had not kicked
               off yet an extra game of nothing: Leeds had played every minute of
               three matches and read 68 mins/g — "rotation risk" — because of a
               fourth that starts this evening.

           None of that is a rounding difference. One window, counted once, in
           scripts/player-profile.js; this reshapes it into the flat totals the
           tables want and adds the home/away split only this file consumes.

           `games` is matches the club PLAYED in the window — the denominator for
           anything per-game. `appearances` is how many of them he was on the
           pitch for. They are different questions and both are carried, because
           one standing in for the other is what "116 mins/game" was. */
        function buildStatWindows(player, history, opts) {
            const o = opts || {};
            if (!history || !history.length) return { recent: null, season: null, window: null };

            const fixtures = o.fixtures || (typeof allFixtures !== 'undefined' && allFixtures) || [];
            const teamsById = o.teams || (typeof teams !== 'undefined' && teams) || {};
            const w = (typeof pfFormWindow === 'function')
                ? pfFormWindow(player, history, fixtures, teamsById, { window: o.window || 5 })
                : null;

            /* No window means no fixture has been played yet — preseason, or a
               fixture list that has not loaded. Falling back to the whole
               history keeps the tables populated rather than emptying them, and
               it is honest: everything he has is everything there is. */
            if (!w) {
                const all = pfSum(history.map(pfMatchStats));
                const apps = history.filter(r => (parseFloat(r.minutes) || 0) > 0).length;
                const shape = statsShape(all, history.length, apps, null);
                return { recent: shape, season: shape, window: null };
            }

            return {
                recent: statsShape(w.totals, w.matches, w.appearances, splitsFrom(w)),
                season: statsShape(w.season, w.seasonMatches || w.seasonGames, w.seasonGames, null),
                window: w
            };
        }

        /* The window's totals, flattened into the shape the tables index by
           name. Every figure is a field FPL publishes, summed — big chances and
           key passes are not among them and nothing stands in for them, which is
           why three fields that were xG and xA multiplied by 0.8, 2 and 5 and
           given another stat's name are not here either. */
        function statsShape(t, matches, appearances, splits) {
            return {
                games: matches, appearances,
                minutes: t.minutes, points: t.points,
                goals: t.goals, assists: t.assists, gi: t.gi,
                xG: t.xG, xA: t.xA, xGI: t.xGI,
                cleanSheets: t.cleanSheets, goalsConceded: t.goalsConceded, xGC: t.xGC,
                saves: t.saves, penaltiesSaved: t.penaltiesSaved, penaltiesMissed: t.penaltiesMissed,
                bonus: t.bonus, bps: t.bps,
                ict: t.ict, influence: t.influence, creativity: t.creativity, threat: t.threat,
                defCon: t.defCon,
                homeSplit: splits ? splits.home : null,
                awaySplit: splits ? splits.away : null
            };
        }

        /* Home and away, from the window's own columns. The venue comes from the
           fixture rather than the row's was_home flag, so a fixture he has no row
           for still lands on the right side of the split. */
        function splitsFrom(w) {
            const side = home => {
                const cols = w.columns.filter(c =>
                    (c.state === 'played' || c.state === 'dnp') && !!c.isHome === home);
                if (!cols.length) return null;
                const t = pfSum(cols.map(c => c.stats));
                return {
                    games: cols.length, points: t.points, xGI: t.xGI, xG: t.xG, xA: t.xA,
                    cleanSheets: t.cleanSheets, saves: t.saves, bonus: t.bonus, minutes: t.minutes
                };
            };
            return { home: side(true), away: side(false) };
        }

        function recencyWeightedAvg(history, key, n = 5) {
            if (!history || history.length === 0) return 0;
            const games = history.slice(-n);
            // weights: oldest=1, newest=n (left-to-right in the slice)
            const weights = games.map((_, i) => i + 1);
            const totalWeight = weights.reduce((s, w) => s + w, 0);
            const weightedSum = games.reduce((s, g, i) => s + (parseFloat(g[key]) || 0) * weights[i], 0);
            return weightedSum / totalWeight;
        }

        /* Expected points for the next match.

           This used to carry a projection of its own that agreed with neither
           page, and it regressed nothing at all: every rate was the raw
           recency-weighted figure, so one gameweek into a season a keeper's
           single three-bonus night read as three bonus points every week where
           the squad model — same keeper, same page — said 0.53. Compare could
           contradict the very card the user opened it from.

           So it delegates. It used to delegate to two different models depending
           on which page asked, which was the best available answer while the
           players page had a projection of its own; both pages now load
           scripts/xp-engine.js, so there is one model and the only difference is
           where the engine-shaped player is looked up. */
        function calculateExpectedPoints(p, pos) {
            /* Both lookups exist because the two pages name their engine-shaped
               pool differently — allPlayersById is the squad page's whole roster,
               xpPlayersById the players page's bootstrap twins.

               Either way it is the NATIVE object that gets projected, never the
               report-shaped one: buildComparePlayer spreads the original and then
               overwrites .fixtures with entries carrying `opponent` but no
               `opponentId`, and projecting that quietly degrades the opponent
               model to an FDR-only estimate. */
            if (typeof predictedGWPoints === 'function') {
                const pool = typeof allPlayersById !== 'undefined' ? allPlayersById
                    : (typeof xpPlayersById !== 'undefined' ? xpPlayersById : null);
                const native = pool ? pool[p.id] : null;
                if (native) return predictedGWPoints(native);
            }
            // Neither could answer — a blank gameweek, or too little history to
            // project from. Fall back to what he has actually averaged, which is
            // what this function's own caller does when it throws.
            const games = p.l5?.games || p.season?.games || 0;
            const pts = (p.l5?.points != null ? p.l5.points : p.season?.points) || 0;
            return games > 0 ? Math.max(0, pts / games) : 0;
        }

        function generateComparisonReport(players) {
            const posMap = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
            return players.map(p => {
                const pos = posMap[p.position];
                /* Matches his club played, not his appearances and not rows in
                   the feed. Per appearance would flatter a man who only turns up
                   half the time — what he gives you is what he gives you across
                   the weeks you own him — and rows in the feed counted fixtures
                   that had not kicked off. The table says "per match" now, in so
                   many words, because "/G" was doing duty for all three. */
                const l5Matches = p.l5?.games || 1;
                const seasonMatches = p.season?.games || 1;
                const ptsPerGame = (p.l5?.points || 0) / l5Matches;
                const minsPerGame = (p.l5?.minutes || 0) / l5Matches;
                const xgiPerGame = (p.l5?.xGI || 0) / l5Matches;
                const xgPerGame = (p.l5?.xG || 0) / l5Matches;
                const xaPerGame = (p.l5?.xA || 0) / l5Matches;
                const bonusPerGame = (p.l5?.bonus || 0) / l5Matches;
                const savesPerGame = (p.l5?.saves || 0) / l5Matches;
                const csPerGame = (p.l5?.cleanSheets || 0) / l5Matches;
                const valueScore = ptsPerGame / (p.price || 1);
                const appearanceLabel = p.l5?.appearances == null ? null
                    : `${p.l5.appearances} of ${p.l5.games}`;

                /* Reliability and explosiveness — how often he returns, how often
                   he hauls.

                   Both were guarded on `history.length >= 5` and set to 0 when the
                   guard failed. Four gameweeks into a season that is every player
                   in the game, and the table printed "0%" for all of them — which
                   reads as "never returns", a measurement, rather than "not enough
                   football yet". Zero is an answer; it must not be the way we spell
                   "we do not know".

                   Counted over matches he actually PLAYED, not rows in the feed:
                   FPL writes a row for an unused substitute, and a rate whose
                   denominator counts weeks he was injured is not a rate about him.
                   Below PLAYED_MIN there is no honest ratio, and both come back
                   null so the row can say so. */
                const RELIABILITY_WINDOW = 10, PLAYED_MIN = 3;
                let reliability = null, explosiveness = null, reliabilityGames = 0;
                if (p.history && p.history.length) {
                    const played = p.history.slice(-RELIABILITY_WINDOW)
                        .filter(g => (parseFloat(g.minutes) || 0) > 0);
                    reliabilityGames = played.length;
                    if (played.length >= PLAYED_MIN) {
                        const returns = played.filter(g => (parseFloat(g.total_points) || 0) >= 2).length;
                        const hauls = played.filter(g => (parseFloat(g.total_points) || 0) >= 10).length;
                        reliability = (returns / played.length) * 100;
                        explosiveness = (hauls / played.length) * 100;
                    }
                }

                // Consistency (stdDev). Null rather than a stand-in figure when
                // there is nothing to measure — see the note on reliability above.
                let consistency = null;
                if (p.history && p.history.length >= 5) {
                    const last5 = p.history.slice(-5);
                    const pts = last5.map(g => parseFloat(g.total_points) || 0);
                    const mean = pts.reduce((s, v) => s + v, 0) / pts.length;
                    const variance = pts.reduce((s, v) => s + (v - mean) ** 2, 0) / pts.length;
                    consistency = Math.max(0, Math.min(10, (1 - Math.sqrt(variance) / 6) * 10));
                }

                // Expected Points
                let xPts = 0;
                try { xPts = calculateExpectedPoints(p, pos); } catch (e) { xPts = ptsPerGame; }

                // CS Probability (GK/DEF)
                let csProb = 0;
                if ((pos === 'GK' || pos === 'DEF') && p.fixtures?.next3?.[0]) {
                    const nf = p.fixtures.next3[0];
                    try { csProb = getCleanSheetProb(p.teamId, nf.opponent, nf.isHome); } catch (e) {}
                }

                // Team context
                const ts = p.teamScores || {};
                const swing = fixtureSwingData[p.teamId] || null;

                /* One engine — scripts/form-trend.js. The score was read from
                   window._risingFormScores, which only the players page ever
                   populates, so on Squad Analysis every player's rising form was
                   0 and the section was empty with nothing to say about why. The
                   signals below it were a second copy of the same pillars,
                   computed here, which could and did disagree with the score
                   sitting beside them.

                   `score` is null rather than 0 when it cannot be read: a player
                   nobody can measure has not scored zero. */
                const rf = (typeof risingFormFor === 'function') ? risingFormFor(p)
                    : { measurable: false, score: null, signals: [], note: null };
                const risingScore = rf.score;
                const risingSignals = rf.signals;
                const risingNote = rf.note;

                /* One engine — scripts/routes-engine.js. This file carried a copy
                   of the players page's route logic, with its own thresholds and
                   its own idea of which routes exist, and the two had already
                   parted company: the copy had no defensive contribution, no
                   penalty route, and a clean-sheet bar that ignored position.

                   The count used to be read from window._routesData, which only
                   the players page ever populates — so the squad page showed a
                   dash for every player. It is computed here now, on whichever
                   page is asking. */
                const rt = (typeof routesFor === 'function') ? routesFor(p) : null;
                const routes = rt ? rt.routes : [];
                const routeSignals = rt ? rt.signals : [];
                const routesData = rt
                    ? { routeCount: rt.routeCount, compositeScore: rt.compositeScore }
                    : ((window._routesData && window._routesData[p.id]) || null);


                // Home/away splits
                const homeSplit = p.l5?.homeSplit || null;
                const awaySplit = p.l5?.awaySplit || null;

                // xG regression
                const seasonGoals = p.season?.goals || 0;
                const seasonXgVal = p.season?.xG || 0;
                const xgOverperf = seasonGoals - seasonXgVal;

                return {
                    ...p, pos, ptsPerGame, minsPerGame, xgiPerGame, xgPerGame, xaPerGame,
                    bonusPerGame, savesPerGame, csPerGame, valueScore, appearanceLabel,
                    reliability, explosiveness,
                    consistency, xPts, csProb, ts, swing, risingScore, routesData, routes, routeSignals,
                    risingSignals, risingNote, homeSplit, awaySplit, xgOverperf, seasonGoals, seasonXgVal
                };
            });
        }

        /* Everyone who tops a category, not whoever sorted first.

           Each pick used `[...].sort(...)[0]`, so two players on an identical
           score handed the award to whichever the sort happened to leave in
           front — an arbitrary winner presented as a finding. A dead heat is
           reported as one: both names, or a count once there are more than two.

           `score` is the same expression the category ranks on, and ties are
           compared on a rounded value so two figures that differ in the seventh
           decimal are not called a winner and a loser. */
        const PICK_EPS = 1e-6;

        function pickWinners(reportData, score) {
            const scored = reportData.map(p => ({ p, s: score(p) }))
                .filter(x => typeof x.s === 'number' && isFinite(x.s));
            if (!scored.length) return null;
            const top = Math.max(...scored.map(x => x.s));
            const winners = scored.filter(x => Math.abs(x.s - top) <= PICK_EPS).map(x => x.p);
            const runnerUp = scored.filter(x => Math.abs(x.s - top) > PICK_EPS)
                .sort((a, b) => b.s - a.s)[0];
            return {
                winners,
                ids: winners.map(p => p.id),
                // Two names read fine; past that a count is kinder than a list.
                label: winners.length === 1 ? winners[0].name
                    : winners.length === 2 ? `${winners[0].name} and ${winners[1].name}`
                    : `${winners.length} players`,
                tied: winners.length > 1,
                first: winners[0],
                runnerUp: runnerUp ? runnerUp.p : null
            };
        }

        function generateSituationalPicks(reportData) {
            const picks = [];
            if (reportData.length < 2) return picks;

            // Best Value — highest pts/match per £m
            const value = pickWinners(reportData, p => p.valueScore);
            if (value) {
                const bv = value.first;
                const runner = value.runnerUp;
                picks.push({
                    category: 'Best Value', cssClass: 'pick-value', icon: '',
                    winner: value.label, winnerIds: value.ids, tied: value.tied,
                    reason: `${bv.ptsPerGame.toFixed(1)} pts/match at £${bv.price.toFixed(1)}m — ${bv.valueScore.toFixed(2)} pts per £m`
                        + (value.tied ? ' — level on value' : (runner && runner.valueScore > 0
                            ? `, ${((bv.valueScore - runner.valueScore) / runner.valueScore * 100).toFixed(0)}% better value than ${runner.name}` : ''))
                });
            }

            // Best Ceiling — explosiveness + routes + xGI
            const ceiling = pickWinners(reportData, p =>
                (p.explosiveness || 0) * 0.4 + (p.routesData?.routeCount || 0) * 8 + p.xgiPerGame * 20);
            if (ceiling) {
                const bc = ceiling.first;
                picks.push({
                    category: 'Best Ceiling', cssClass: 'pick-ceiling', icon: '',
                    winner: ceiling.label, winnerIds: ceiling.ids, tied: ceiling.tied,
                    reason: [
                        bc.explosiveness == null ? null : `${bc.explosiveness.toFixed(0)}% explosive rate`,
                        bc.routesData ? `${bc.routesData.routeCount || 0} routes to points` : null,
                        `${bc.xgiPerGame.toFixed(2)} xGI/match`
                    ].filter(Boolean).join(', ') + (ceiling.tied ? ' — level' : '')
                });
            }

            // Best Safety — reliability + nailed + consistency
            const safety = pickWinners(reportData, p =>
                (p.reliability || 0) * 0.5 + p.minsPerGame * 0.3 + (p.consistency || 0) * 2);
            if (safety) {
                const bs = safety.first;
                picks.push({
                    category: 'Best Safety', cssClass: 'pick-safety', icon: '',
                    winner: safety.label, winnerIds: safety.ids, tied: safety.tied,
                    reason: `${bs.reliability == null ? 'no return rate yet' : `${bs.reliability.toFixed(0)}% return rate`}, `
                        + `${bs.minsPerGame.toFixed(0)} mins per match`
                        + (safety.tied ? ' — level on safety' : ' — the most consistent and nailed-on pick')
                });
            }

            // Best Fixtures — FDR + swing + home games. Lower is better, so the
            // score is negated: pickWinners always takes the maximum.
            const fixtureScore = p => {
                const fdr = p.fixtures?.avgFDR3 || 3;
                const swing = (p.swing?.direction === 'improving') ? Math.abs(p.swing.swing) : 0;
                const home = (p.fixtures?.next5 || []).filter(f => f.isHome).length;
                return -(fdr - swing * 0.3 - home * 0.1);
            };
            const fixturesPick = pickWinners(reportData, fixtureScore);
            if (fixturesPick) {
                const bf = fixturesPick.first;
                const bfFdr = bf.fixtures?.avgFDR3 || 3;
                const bfHome = (bf.fixtures?.next5 || []).filter(f => f.isHome).length;
                picks.push({
                    category: 'Best Fixtures', cssClass: 'pick-fixtures', icon: '',
                    winner: fixturesPick.label, winnerIds: fixturesPick.ids, tied: fixturesPick.tied,
                    reason: `FDR ${bfFdr.toFixed(1)} next 3 with ${bfHome}/5 home games`
                        + (bf.swing?.direction === 'improving' ? ' — fixtures improving' : '')
                        + (fixturesPick.tied ? ' — the same run for each' : '')
                });
            }

            // Best Form — rising form + L5 trend
            const formPick = pickWinners(reportData, p =>
                (p.risingScore || 0) * 2 + p.ptsPerGame * 3 + (p.form || 0));
            if (formPick) {
                const bfm = formPick.first;
                picks.push({
                    category: 'Best Form', cssClass: 'pick-form', icon: '',
                    winner: formPick.label, winnerIds: formPick.ids, tied: formPick.tied,
                    reason: `${bfm.ptsPerGame.toFixed(1)} pts/match recently`
                        + (bfm.risingScore > 0 ? ` with rising form score of ${bfm.risingScore.toFixed(0)}` : '')
                        + ` — ${bfm.form.toFixed(1)} FPL form`
                        + (formPick.tied ? ' — level' : '')
                });
            }

            return picks;
        }

        function generatePlayerNarrative(player, allReportData) {
            const pos = player.pos;
            const others = allReportData.filter(p => p.id !== player.id);
            const isDefPos = (pos === 'GK' || pos === 'DEF');

            // Overall verdict
            let verdictParts = [];
            if (player.ptsPerGame >= 6) verdictParts.push('premium output');
            else if (player.ptsPerGame >= 4) verdictParts.push('solid output');
            else verdictParts.push('modest output');

            if (player.explosiveness >= 30) verdictParts.push('high ceiling');
            if (player.reliability >= 70) verdictParts.push('consistent returns');
            if ((player.fixtures?.avgFDR3 || 3) <= 2.5) verdictParts.push('excellent fixtures');
            else if ((player.fixtures?.avgFDR3 || 3) >= 4) verdictParts.push('tough fixtures ahead');
            if (player.risingScore != null && player.risingScore >= 10) verdictParts.push('form on the rise');

            const verdict = verdictParts.length > 0
                ? `${verdictParts[0].charAt(0).toUpperCase() + verdictParts[0].slice(1)} player with ${verdictParts.slice(1).join(', ')}.`
                : 'Average profile across metrics.';

            // Strengths
            const strengths = [];
            const routeCount = player.routesData ? player.routesData.routeCount : null;
            if (routeCount >= 3) strengths.push(`${routeCount} routes to points — multi-dimensional scorer`);
            else if (routeCount >= 2) strengths.push(`${routeCount} routes to points`);

            if (player.valueScore > 0.8) strengths.push(`Strong value at £${player.price.toFixed(1)}m (${player.valueScore.toFixed(2)} pts/£m)`);
            if (player.minsPerGame >= 85) strengths.push('Nailed-on starter — 85+ minutes of every match his club plays');
            if (player.reliability >= 70) strengths.push(`${player.reliability.toFixed(0)}% return rate — rarely blanks`);
            if (player.explosiveness >= 30) strengths.push(`${player.explosiveness.toFixed(0)}% explosive — frequent hauls`);

            if (isDefPos && player.csProb >= 0.35) strengths.push(`${(player.csProb * 100).toFixed(0)}% CS probability next GW`);
            if (!isDefPos && player.xgiPerGame >= 0.5) strengths.push(`Elite ${player.xgiPerGame.toFixed(2)} xGI/match`);

            if (player.ts?.formRating > 60) strengths.push(`Team in strong form (${player.ts.formRating.toFixed(0)}/100)`);
            if (player.swing?.direction === 'improving') strengths.push(`Fixture swing improving — FDR ${player.swing.currentFdr} → ${player.swing.futureFdr}`);

            // Concerns
            const concerns = [];
            if ((player.fixtures?.avgFDR3 || 3) >= 4) concerns.push(`Tough fixtures (FDR ${(player.fixtures?.avgFDR3 || 3).toFixed(1)}) — short-term ceiling limited`);
            /* The count as well as the rate. "41 minutes per match" is true of a
               man rotated through every one of them and of a man who arrived
               halfway through the window and has started both since — and the
               advice for those two is opposite. The appearance count is what
               tells them apart, so it is said rather than left implied. */
            if (player.minsPerGame < 70 && player.minsPerGame > 0) {
                const apps = player.l5?.appearances, matches = player.l5?.games;
                concerns.push(`Rotation risk — ${player.minsPerGame.toFixed(0)} minutes per match his club played`
                    + (apps != null && matches ? ` (started or came on in ${apps} of ${matches})` : ''));
            }
            if (player.xgOverperf > 2) concerns.push(`Overperforming xG by ${player.xgOverperf.toFixed(1)} goals — regression risk`);
            /* `null < 4` is true, so an unmeasured player would have been called
               volatile — the concern has to test that we measured it at all. */
            if (player.consistency != null && player.consistency < 4) concerns.push('Volatile returns — high variance in recent points');
            if (player.swing?.direction === 'worsening') concerns.push(`Fixtures worsening — FDR ${player.swing.currentFdr} → ${player.swing.futureFdr}`);
            if (player.ts?.formRating < 40) concerns.push(`Team struggling (form ${player.ts?.formRating?.toFixed(0) || '?'}/100)`);

            // Comparative edges
            const edges = [];
            for (const other of others) {
                const ptsDiff = player.ptsPerGame - other.ptsPerGame;
                const priceDiff = player.price - other.price;
                if (Math.abs(ptsDiff) >= 0.5) {
                    if (ptsDiff > 0 && priceDiff <= 0) {
                        edges.push(`Outscores ${other.name} by ${ptsDiff.toFixed(1)} pts/match and is £${Math.abs(priceDiff).toFixed(1)}m cheaper`);
                    } else if (ptsDiff > 0 && priceDiff > 0) {
                        edges.push(`${ptsDiff.toFixed(1)} pts/match more than ${other.name} but costs £${priceDiff.toFixed(1)}m extra`);
                    } else if (ptsDiff < 0 && priceDiff < 0) {
                        edges.push(`£${Math.abs(priceDiff).toFixed(1)}m cheaper than ${other.name} despite only ${Math.abs(ptsDiff).toFixed(1)} pts/match less`);
                    }
                }
            }

            return { verdict, strengths: strengths.slice(0, 5), concerns: concerns.slice(0, 4), edges: edges.slice(0, 2) };
        }

        function getRadarAxes(reportData) {
            // Normalize each axis 0-100 relative to compared set
            const normalize = (values) => {
                const max = Math.max(...values, 0.001);
                return values.map(v => Math.round((v / max) * 100));
            };

            const formVals = reportData.map(p => p.ptsPerGame);
            const valueVals = reportData.map(p => p.valueScore);
            const ceilingVals = reportData.map(p => (p.explosiveness || 0) + (p.routesData?.routeCount || 0) * 5);
            const safetyVals = reportData.map(p => (p.reliability || 0) * 0.7 + (p.consistency || 0) * 3);
            const fixtureVals = reportData.map(p => Math.max(0, (5 - (p.fixtures?.avgFDR3 || 3)) * 25));
            const routeVals = reportData.map(p => (p.routesData?.compositeScore || 0));

            return {
                labels: ['Form', 'Value', 'Ceiling', 'Safety', 'Fixtures', 'Routes'],
                datasets: reportData.map((p, i) => ({
                    label: p.name,
                    data: [
                        normalize(formVals)[i],
                        normalize(valueVals)[i],
                        normalize(ceilingVals)[i],
                        normalize(safetyVals)[i],
                        normalize(fixtureVals)[i],
                        normalize(routeVals)[i]
                    ]
                }))
            };
        }

        function getBudgetContext(player) {
            const teamId = localStorage.getItem('fpl_team_id') || null;
            if (!teamId) return null;
            // Check if team bank data is available from window context
            const bank = window._teamBank ?? null;
            if (bank === null) return { type: 'neutral', text: `£${player.price.toFixed(1)}m` };
            const remaining = bank - player.price;
            if (remaining >= 0) return { type: 'fit', text: `Fits budget — £${remaining.toFixed(1)}m remaining` };
            return { type: 'over', text: `£${Math.abs(remaining).toFixed(1)}m over budget` };
        }

        function showCompareModal() {
            if (compareList.length < 2) {
                alert('Please select at least 2 players to compare');
                return;
            }

            const modal = document.getElementById('compareModal');
            const content = document.getElementById('compareModalContent');
            const container = modal.querySelector('.compare-modal-container');
            container.classList.add('report-mode');

            const posMap = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
            const radarColors = ['rgba(74,222,128,0.8)', 'rgba(96,165,250,0.8)', 'rgba(251,191,36,0.8)', 'rgba(248,113,113,0.8)', 'rgba(168,85,247,0.8)'];
            const radarBgColors = ['rgba(74,222,128,0.15)', 'rgba(96,165,250,0.15)', 'rgba(251,191,36,0.15)', 'rgba(248,113,113,0.15)', 'rgba(168,85,247,0.15)'];

            // Generate report data
            const reportData = generateComparisonReport(compareList);
            const picks = generateSituationalPicks(reportData);
            const radarAxes = getRadarAxes(reportData);

            // Determine stat groups based on positions present
            const hasGK = reportData.some(p => p.pos === 'GK');
            const hasDEF = reportData.some(p => p.pos === 'DEF' || p.pos === 'GK');
            const hasAttacker = reportData.some(p => p.pos === 'MID' || p.pos === 'FWD');

            // Build enhanced stat rows
            /* Recent form, from the shared builder in scripts/player-profile.js
               — the same window and the same five-per-position stats the profile
               card draws, so the two cannot disagree about a player. Totals only
               here: the match-by-match grid is five columns wide and this table
               already carries up to five players across. */
            /* The window object itself, carried from wherever p.l5 was built so
               the prose below and the totals in the table are one computation
               rather than two of the same thing. pfWindowFor() stays as the
               fallback for an adapter that hands over l5 without it. */
            reportData.forEach(p => {
                p._form = p.formWindow
                    || ((typeof pfWindowFor === 'function') ? pfWindowFor(p) : null);
            });
            const formWindow = reportData.map(p => p._form).find(Boolean) || null;

            const getValue = (obj, path) => path.split('.').reduce((o, k) => (o || {})[k], obj);

        /* Every player who holds the best figure, not the first one listed.

           This returned `vals.indexOf(target)`, so two players on an identical FDR
           left one cell green and the other plain — the table asserting a
           difference the numbers do not contain. A draw is a draw, and both
           columns say so. */
            const findBestIdxs = (key, lower = false) => {
                const vals = reportData.map(p => {
                    const v = getValue(p, key);
                    return typeof v === 'number' && isFinite(v) ? v : null;
                });
                const filtered = vals.filter(v => v !== null);
                if (!filtered.length) return new Set();
                const target = lower ? Math.min(...filtered) : Math.max(...filtered);
                const hits = new Set();
                vals.forEach((v, i) => { if (v === target) hits.add(i); });
                // Everyone level is nobody ahead, so nothing is highlighted.
                return hits.size === reportData.length ? new Set() : hits;
            };

            let statRows = [];
            // Overview
            statRows.push({ group: 'Overview' });
            statRows.push({ label: 'Price', key: 'price', fmt: v => `£${v?.toFixed(1) || '?'}m`, lower: true });
            statRows.push({ label: 'Ownership', key: 'selectedBy', fmt: v => `${v?.toFixed(1) || '?'}%` });
            statRows.push({ label: 'Form', key: 'form', fmt: v => v?.toFixed(1) || '-' });
            statRows.push({ label: 'Total Pts', key: 'totalPoints' });
            statRows.push({ label: 'xPts (Next GW)', key: 'xPts', fmt: v => v?.toFixed(1) || '-' });

            /* Rates, with the denominator in the label. Every one of these is
               divided by matches the player's CLUB played in the window — not by
               his appearances, and not by rows in his history. Which of the three
               it was used to depend on where you looked. */
            statRows.push({ group: 'Recent Form' });
            statRows.push({ label: 'Pts/Match', key: 'ptsPerGame', fmt: v => v?.toFixed(1) || '-' });
            statRows.push({ label: 'Mins/Match', key: 'minsPerGame', fmt: v => v?.toFixed(0) || '-' });
            /* Both halves, because the denominator is not the same for everyone
               in the table: the window is five gameweeks, and how many matches
               that is depends on whether his club blanked, doubled, or has one
               still to kick off. A string on purpose — there is no "best" number
               of fixtures to have had, so nothing here goes green. */
            statRows.push({ label: 'Played', key: 'appearanceLabel', fmt: v => v || '—' });
            /* Labelled with the window they are actually measured over. They sat
               under a "Recent Form (L5)" heading while being counted over the last
               ten, which is a second thing the table was quietly getting wrong. */
            statRows.push({ label: 'Reliability (L10)', key: 'reliability',
                fmt: v => v == null ? '—' : `${v.toFixed(0)}%` });
            statRows.push({ label: 'Explosiveness (L10)', key: 'explosiveness',
                fmt: v => v == null ? '—' : `${v.toFixed(0)}%` });

            /* The raw totals that used to sit in these groups — Goals (L5),
               Assists (L5), Clean Sheets (L5), Goals Conceded, Saves (L5),
               Bonus (L5) — are the position block further down, now that l5 and
               the card's window are the same count. Two rows of the same figure
               under two labels invites the reader to look for a difference. */
            if (hasAttacker) {
                statRows.push({ group: 'Attacking' });
                statRows.push({ label: 'xGI/Match', key: 'xgiPerGame', fmt: v => v?.toFixed(2) || '-' });
                statRows.push({ label: 'xG/Match', key: 'xgPerGame', fmt: v => v?.toFixed(2) || '-' });
            }

            if (hasDEF) {
                statRows.push({ group: 'Defensive' });
                statRows.push({ label: 'CS Prob (Next)', key: 'csProb', fmt: v => v > 0 ? `${(v * 100).toFixed(0)}%` : '-' });
            }

            if (hasGK) {
                statRows.push({ group: 'Goalkeeping' });
                statRows.push({ label: 'Saves/Match', key: 'savesPerGame', fmt: v => v?.toFixed(1) || '-' });
            }

            // Bonus & Value
            statRows.push({ group: 'Value & Fixtures' });
            statRows.push({ label: 'Value Score', key: 'valueScore', fmt: v => v?.toFixed(2) || '-' });
            statRows.push({ label: 'FDR (Next 3)', key: 'fixtures.avgFDR3', fmt: v => v?.toFixed(1) || '-', lower: true });

            /* Position-specific where it can be. Comparing a keeper with a
               forward has no five stats in common worth tabulating, so a mixed
               selection falls back to the figures that mean the same thing in
               any shirt rather than showing saves against a striker. */
            if (formWindow) {
                const positions = new Set(reportData.map(p => p.position).filter(Boolean));
                const formStats = (positions.size === 1 && typeof pfStatsFor === 'function')
                    ? pfStatsFor([...positions][0])
                    : [{ key: 'goals', label: 'Goals' }, { key: 'assists', label: 'Assists' },
                        { key: 'xGI', label: 'xGI', dp: 1 }, { key: 'bonus', label: 'Bonus' }];
                /* Read off l5, which IS the window these labels name — the same
                   object the profile card totals. It used to read _form.totals
                   while the rows above read l5, so the table carried both
                   windows at once and a blank gameweek made them disagree in
                   public. */
                /* The window is the same five gameweeks for everyone, but how
                   many matches that is depends on the club — a blank, a double
                   or a fixture still to come moves it. One player's count as the
                   heading over five columns would be a claim about the other
                   four, so it is only said when they agree. */
                const wins = reportData.map(p => p._form).filter(Boolean);
                const agree = wins.every(w => w.matches === wins[0].matches);
                statRows.push({ group: (agree && typeof pfWindowLabel === 'function')
                    ? pfWindowLabel(formWindow)
                    : `Last ${formWindow.rounds.length} gameweeks` });
                statRows.push({ label: 'Pts', key: 'l5.points', fmt: v => v == null ? '-' : String(Math.round(v)) });
                statRows.push({ label: 'Mins', key: 'l5.minutes', fmt: v => v == null ? '-' : String(Math.round(v)) });
                formStats.forEach(st => statRows.push({
                    label: st.label, key: `l5.${st.key}`, lower: !!st.invert,
                    fmt: v => v == null ? '-' : (typeof pfNum === 'function' ? pfNum(v, st.dp) : String(v))
                }));
            }

            // Rising Form & Routes
            statRows.push({ group: 'AI Insights' });
            /* Null when the season is too short to compare a recent window
               against, which is a different thing from a player who scored zero
               on it — so it renders as a dash rather than as a 0. */
            statRows.push({ label: 'Rising Form Score', key: 'risingScore',
                fmt: v => v == null ? '\u2014' : v.toFixed(0) });
            // `v || '0'` printed a zero for a page that never computed routes at
            // all, which is a claim about the player rather than about the page.
            statRows.push({ label: 'Routes to Points', key: 'routesData.routeCount',
                fmt: v => v == null ? '—' : String(v) });
            statRows.push({ label: 'Routes Score', key: 'routesData.compositeScore', fmt: v => v > 0 ? v.toFixed(1) : '-' });

            const statsTableHtml = statRows.map(row => {
                if (row.group) return `<tr class="group-header"><td colspan="${reportData.length + 1}">${row.group}</td></tr>`;
                const best = findBestIdxs(row.key, row.lower);
                return `<tr>${[`<td>${row.label}</td>`].concat(reportData.map((p, i) => {
                    const val = getValue(p, row.key);
                    const formatted = row.fmt ? row.fmt(val) : (val ?? '-');
                    return `<td class="${best.has(i) && reportData.length > 1 ? 'best-val' : ''}">${formatted}</td>`;
                })).join('')}</tr>`;
            }).join('');

            /* The reading, per player, in both windows. Prose rather than table
               cells because that is what it is — a sentence about whether the
               returns match the chances — and because pfVsExpected() is allowed
               to say the sample is too thin, which is not a number. */
            const formReadHtml = !formWindow ? '' : reportData.map(p => {
                const w = p._form;
                if (!w || typeof pfExpectedPairs !== 'function') return '';
                const pairs = pfExpectedPairs(p.position);
                if (!pairs.length) return '';
                const reads = pairs.map(pr => {
                    const l5 = pfVsExpected(w.totals[pr.key], w.totals[pr.expected], pr);
                    const se = pfVsExpected(w.season[pr.key], w.season[pr.expected], pr);
                    return `<div class="pf-read t-${l5.tone}"><em>${escHTML(pr.label)} · last ${w.rounds.length}</em> ${escHTML(l5.text)}</div>
                            <div class="pf-read t-${se.tone}"><em>${escHTML(pr.label)} · season</em> ${escHTML(se.text)}</div>`;
                }).join('');
                return `<div class="pf-verdict"><div class="pf-verdict-head">${escHTML(p.name)}</div>${reads}</div>`;
            }).join('');

            // Build picks HTML
            const picksHtml = picks.map(pick => `
                <div class="report-pick-card ${pick.cssClass}">
                    <div class="report-pick-category"><span>${pick.icon}</span> ${pick.category}</div>
                    <div class="report-pick-winner">${pick.winner}</div>
                    <div class="report-pick-reason">${pick.reason}</div>
                </div>
            `).join('');

            // Build player profile cards
            const profilesHtml = reportData.map(p => {
                const narrative = generatePlayerNarrative(p, reportData);
                const budget = getBudgetContext(p);
                const pickBadges = picks.filter(pk => (pk.winnerIds || []).includes(p.id)).map(pk => `<span class="report-badge report-badge-pick">${pk.icon} ${pk.category}</span>`).join('');

                const fixtureChips = (p.fixtures?.next5 || []).slice(0, 5).map(f => {
                    const opp = teams[f.opponent]?.short_name || '???';
                    const fdrClass = f.difficulty <= 2 ? 'fdr-1' : f.difficulty <= 2.5 ? 'fdr-2' : f.difficulty <= 3.5 ? 'fdr-3' : f.difficulty <= 4 ? 'fdr-4' : 'fdr-5';
                    return `<div class="report-fixture-chip ${fdrClass}"><span>${opp}</span><span class="venue">${f.isHome ? 'H' : 'A'}</span></div>`;
                }).join('');

                const strengthsHtml = narrative.strengths.length > 0 ? `<ul class="report-strengths">${narrative.strengths.map(s => `<li>${s}</li>`).join('')}</ul>` : '';
                const concernsHtml = narrative.concerns.length > 0 ? `<ul class="report-concerns">${narrative.concerns.map(c => `<li>${c}</li>`).join('')}</ul>` : '';
                const edgesHtml = narrative.edges.length > 0 ? narrative.edges.map(e => `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;font-style:italic;">↔ ${e}</div>`).join('') : '';

                let budgetHtml = '';
                if (budget) {
                    const cls = budget.type === 'fit' ? 'report-budget-fit' : budget.type === 'over' ? 'report-budget-over' : 'report-budget-neutral';
                    budgetHtml = `<div class="report-budget-line ${cls}">${budget.type === 'fit' ? '✓' : budget.type === 'over' ? '✗' : '£'} ${budget.text}</div>`;
                }

                return `
                    <div class="report-player-card">
                        <div class="report-player-card-header">
                            <div class="report-player-avatar pos-${p.pos}">${p.name.split(' ').map(n => n[0]).join('').slice(0, 2)}</div>
                            <div class="report-player-info">
                                <h4>${escHTML(p.name)}</h4>
                                <div class="meta">${escHTML(p.team)} · ${p.pos} · £${p.price.toFixed(1)}m · ${p.selectedBy.toFixed(1)}% owned</div>
                            </div>
                            <div class="report-player-badges">${pickBadges}</div>
                        </div>
                        <div class="report-narrative">
                            <div class="report-verdict">${narrative.verdict}</div>
                            ${strengthsHtml}
                            ${concernsHtml}
                            ${edgesHtml}
                        </div>
                        <div class="report-fixture-strip">${fixtureChips}</div>
                        ${budgetHtml}
                    </div>
                `;
            }).join('');

            // Build routes comparison
            /* Ordered by key rather than by display name — the names are the
               engine's now, and a lookup keyed on the rendered string silently
               sends anything it does not recognise to the bottom. That is how
               Defensive contribution would have arrived: below Saves, on a
               defender, under a heading about where his points come from. */
            const ROUTE_ORDER = ['goals', 'assists', 'cleanSheet', 'defCon', 'saves', 'bonus', 'penalties'];
            const bar = (r, muted) => `
                    <div class="report-route-bar${muted ? ' report-route-signal' : ''}"${muted ? ` data-tooltip="${escHTML(r.note || '')}"` : ''}>
                        <div class="report-route-label">${escHTML(r.name)}</div>
                        <div class="report-route-track"><div class="report-route-fill" style="width:${r.strength * 10}%;background:${r.color};"></div></div>
                        <div class="report-route-value">${escHTML(r.detail)}</div>
                    </div>`;
            const routesHtml = reportData.map(p => {
                const rs = [...p.routes].sort((a, b) =>
                    (ROUTE_ORDER.indexOf(a.key) + 1 || 99) - (ROUTE_ORDER.indexOf(b.key) + 1 || 99));
                const sig = (p.routeSignals || []);
                if (!rs.length && !sig.length) return `<div class="report-routes-player"><div class="report-routes-player-name">${escHTML(p.name)}</div><div style="font-size:11px;color:var(--text-muted);">No qualifying routes</div></div>`;
                // Signals sit under the routes, dimmed, and are not in the count.
                const body = rs.map(r => bar(r, false)).join('')
                    + (sig.length ? `<div class="report-route-signal-head">Not a scoring route</div>` + sig.map(r => bar(r, true)).join('') : '');
                return `<div class="report-routes-player"><div class="report-routes-player-name">${escHTML(p.name)} <span style="color:var(--text-muted);font-weight:400;">(${rs.length} route${rs.length === 1 ? '' : 's'})</span></div>${body}</div>`;
            }).join('');

            /* Rising form, and why it is blank when it is.

               "No rising form signals detected" was printed in three different
               situations that mean three different things: the season is too
               short to compare a recent window against at all, he is available
               and measured and simply not rising, and the pillars fired too
               weakly to call it. The first is about the calendar and the other
               two are about the player, and a reader cannot act on the same
               sentence for all three. risingFormFor() returns the reason. */
            const risingHtml = reportData.map(p => {
                if (p.risingSignals.length === 0) {
                    const why = p.risingNote || 'Nothing in his recent form, his club or his fixtures is trending up.';
                    return `<div class="report-routes-player">
                        <div class="report-routes-player-name">${escHTML(p.name)}</div>
                        <div class="report-rising-none">${escHTML(why)}</div>
                    </div>`;
                }
                const signals = p.risingSignals.map(s => `
                    <div class="report-signal-row">
                        <div class="report-signal-icon" style="background:${s.color}20;color:${s.color};">▲</div>
                        <div class="report-signal-info">
                            <div class="report-signal-label">${s.label}</div>
                            <div class="report-signal-detail">${s.detail}</div>
                        </div>
                        <div class="report-signal-bar"><div class="report-signal-fill" style="width:${s.strength * 10}%;background:${s.color};"></div></div>
                    </div>
                `).join('');
                // Signals can fire without the score clearing its floor; "score: 0"
                // for a player showing two green bars reads as a contradiction.
                const score = p.risingScore == null
                    ? 'not enough season to score yet'
                    : `score: ${p.risingScore.toFixed(0)}`;
                return `<div class="report-routes-player"><div class="report-routes-player-name">${escHTML(p.name)} <span style="color:var(--text-muted);font-weight:400;">(${score})</span></div>${signals}</div>`;
            }).join('');

            /* Team context, in the units the numbers are measured in.

               This was four 0-100 indices — Attack Power, Defense Power, Form
               Rating, Fixture Score — and two trend words. An index is a ranking
               dressed as a measurement: "Attack Power 72" cannot be checked
               against anything, does not say whether 72 is one goal a game or
               three, and is not comparable to the 72 next to it if the two were
               scaled off different pools. Teams Rankings went to real quantities
               for the same reason; this follows it.

               Every figure below is counted rather than scored. Where a reading
               needs more football than has been played, it says so — the trend
               rows used to print "stable", which is a finding, for clubs that had
               never been measured at all. */
            const teamContextHtml = reportData.map(p => {
                const ts = p.ts || {};
                const teamName = teams[p.teamId]?.name || p.team;
                const played = ts.matchesPlayed || 0;
                const xg = (typeof getTeamSeasonXg === 'function') ? getTeamSeasonXg(p.teamId) : null;
                const trend = (typeof ftTeamTrend === 'function') ? ftTeamTrend(p.teamId) : { usable: false };

                const row = (label, value, tone, tip) => `
                    <div class="report-team-stat"${tip ? ` data-tooltip="${escHTML(tip)}"` : ''}>
                        <span class="report-team-stat-label">${label}</span>
                        <span class="report-team-stat-value"${tone ? ` style="color:${tone}"` : ''}>${value}</span>
                    </div>`;
                const num = (v, dp) => (typeof v === 'number' && isFinite(v)) ? v.toFixed(dp) : '—';

                if (!played) {
                    return `<div class="report-team-card">
                        <div class="report-team-card-name">${escHTML(p.name)} — ${escHTML(teamName)}</div>
                        <div class="report-team-none">No matches played yet this season.</div>
                    </div>`;
                }

                const ppg = (ts.wins * 3 + ts.draws) / played;
                const trendRow = trend.usable
                    ? row('xG trend (last 6)',
                        `${trend.xgDelta >= 0 ? '+' : ''}${num(trend.xgDelta, 2)} xG · ${trend.xgcDelta >= 0 ? '+' : ''}${num(trend.xgcDelta, 2)} xGC`,
                        (trend.xgDelta > 0.1 || trend.xgcDelta > 0.1) ? 'var(--color-success)'
                            : (trend.xgDelta < -0.1 || trend.xgcDelta < -0.1) ? 'var(--color-error)' : null,
                        'Their last six matches against their own season average. Positive is more chances created and fewer conceded.')
                    : row('xG trend (last 6)', '—', null,
                        `A six-match window only says something against a longer season — ${teamName} have played ${played} of the ${trend.need || 10} matches this needs.`);

                return `
                    <div class="report-team-card">
                        <div class="report-team-card-name">${escHTML(p.name)} — ${escHTML(teamName)}</div>
                        ${row('Record', `${ts.wins}W ${ts.draws}D ${ts.losses}L`, null, `${num(ppg, 2)} league points a game from ${played} match${played === 1 ? '' : 'es'}`)}
                        ${row('Scored', `${num(ts.avgGoals, 1)} a game`, null, 'Goals scored per match played')}
                        ${row('Conceded', `${num(ts.avgConceded, 1)} a game`, null, 'Goals conceded per match played')}
                        ${row('Chances', xg ? `${num(xg.xGpg, 2)} xG · ${num(xg.xGCpg, 2)} xGC` : '—', null,
                            'Expected goals created and conceded per match — what the chances were worth, before finishing')}
                        ${row('Clean sheets', `${ts.totalCS || 0} in ${played}`, null, 'Matches they have kept a clean sheet')}
                        ${row('Next 5 FDR', num(ts.avgFdr, 1),
                            ts.avgFdr <= 2.5 ? 'var(--color-success)' : ts.avgFdr >= 3.8 ? 'var(--color-error)' : null,
                            'Average fixture difficulty over their next five')}
                        ${trendRow}
                    </div>
                `;
            }).join('');

            // Build home/away splits collapsible
            const buildSplitRow = (label, home, away, key, fmt) => {
                const hv = home ? (fmt ? fmt(home[key]) : home[key]) : '-';
                const av = away ? (fmt ? fmt(away[key]) : away[key]) : '-';
                return `<td>${label}</td><td>${hv}</td><td>${av}</td>`;
            };
            const splitsHtml = reportData.map(p => {
                const h = p.homeSplit;
                const a = p.awaySplit;
                if (!h && !a) return `<div class="report-routes-player"><div class="report-routes-player-name">${escHTML(p.name)}</div><div style="font-size:11px;color:var(--text-muted);">Insufficient home/away data</div></div>`;
                return `
                    <div class="report-routes-player">
                        <div class="report-routes-player-name">${escHTML(p.name)}</div>
                        <table class="report-splits-table">
                            <tr><th></th><th>Home (${h?.games || 0}g)</th><th>Away (${a?.games || 0}g)</th></tr>
                            <tr>${buildSplitRow('Points', h, a, 'points', v => (v || 0).toFixed(0))}</tr>
                            <tr>${buildSplitRow('xGI', h, a, 'xGI', v => (v || 0).toFixed(2))}</tr>
                            <tr>${buildSplitRow('CS', h, a, 'cleanSheets', v => (v || 0).toFixed(0))}</tr>
                            <tr>${buildSplitRow('Bonus', h, a, 'bonus', v => (v || 0).toFixed(0))}</tr>
                        </table>
                    </div>
                `;
            }).join('');

            // xG regression analysis
            const regressionHtml = reportData.map(p => {
                const overperf = p.xgOverperf;
                const label = overperf > 1 ? 'Overperforming' : overperf < -1 ? 'Underperforming' : 'In line';
                const color = overperf > 2 ? 'var(--color-warning)' : overperf < -2 ? 'var(--color-success)' : 'var(--text-secondary)';
                return `
                    <div class="report-routes-player">
                        <div class="report-routes-player-name">${escHTML(p.name)}</div>
                        <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px;">
                            <span>Goals: ${p.seasonGoals}</span>
                            <span>xG: ${p.seasonXgVal.toFixed(1)}</span>
                            <span style="color:${color};font-weight:600;">${label} (${overperf >= 0 ? '+' : ''}${overperf.toFixed(1)})</span>
                        </div>
                    </div>
                `;
            }).join('');

            // Build fixture comparison
            const fixtureCompHtml = reportData.map(p => {
                const chips = (p.fixtures?.next5 || []).slice(0, 6).map(f => {
                    const opp = teams[f.opponent]?.short_name || '???';
                    const fdrClass = f.difficulty <= 2 ? 'fdr-1' : f.difficulty <= 2.5 ? 'fdr-2' : f.difficulty <= 3.5 ? 'fdr-3' : f.difficulty <= 4 ? 'fdr-4' : 'fdr-5';
                    const oppTs = teamAnalysis[f.opponent] || {};
                    const tooltip = (p.pos === 'GK' || p.pos === 'DEF') ? `ATK ${oppTs.attackPower?.toFixed(0) || '?'}` : `DEF ${oppTs.defensePower?.toFixed(0) || '?'}`;
                    return `<div class="report-fixture-chip ${fdrClass}" title="${tooltip}"><span>${opp}</span><span class="venue">${f.isHome ? 'H' : 'A'}</span></div>`;
                }).join('');
                return `<div style="margin-bottom:8px;"><span style="font-size:12px;font-weight:600;margin-right:8px;">${escHTML(p.name)}</span><span style="font-size:10px;color:var(--text-muted);">FDR ${(p.fixtures?.avgFDR3 || 3).toFixed(1)}</span><div class="report-fixture-strip" style="margin-top:4px;">${chips}</div></div>`;
            }).join('');

            // Assemble full report
            content.innerHTML = `
                <div class="comparison-report">
                    <!-- Header -->
                    <div class="report-header">
                        <div class="report-header-icon"><i data-lucide="brain" style="width:22px;height:22px;"></i></div>
                        <div class="report-header-text">
                            <h3>AI Scouting Report</h3>
                            <p>Comparing ${reportData.length} ${reportData.length > 1 && reportData.every(p => p.pos === reportData[0].pos) ? reportData[0].pos + 's' : 'players'} across ${picks.length} dimensions</p>
                        </div>
                    </div>

                    <!-- Situational Picks -->
                    <div class="report-picks-row">${picksHtml}</div>

                    <!-- Radar + Stats Dashboard -->
                    <div class="report-dashboard">
                        <div class="report-radar-container">
                            <h4>Player Profile Overlay</h4>
                            <div class="report-radar-canvas-wrap"><canvas id="reportRadarCanvas"></canvas></div>
                            <div class="report-radar-legend">
                                ${reportData.map((p, i) => `<div class="report-radar-legend-item"><div class="report-radar-legend-dot" style="background:${radarColors[i]}"></div>${escHTML(p.name)}</div>`).join('')}
                            </div>
                        </div>
                        <div class="report-stats-container">
                            <h4>Key Metrics Comparison</h4>
                            <table class="report-stats-table">
                                <thead><tr><th></th>${reportData.map(p => `<th>${escHTML(p.name)}</th>`).join('')}</tr></thead>
                                <tbody>${statsTableHtml}</tbody>
                            </table>
                        </div>
                    </div>

                    ${formReadHtml ? `<div class="report-form-read">
                        <h4>Actual against expected</h4>
                        <div class="pf-verdicts">${formReadHtml}</div>
                    </div>` : ''}

                    <!-- Player Profile Cards -->
                    <div class="report-profiles">${profilesHtml}</div>

                    <!-- Routes to Points Comparison -->
                    <div class="report-routes-section">
                        <h4>Routes to Points Comparison</h4>
                        <div class="report-routes-grid">${routesHtml}</div>
                    </div>

                    <!-- Fixture Comparison -->
                    <div class="report-collapsible open">
                        <div class="report-collapsible-header" onclick="this.parentElement.classList.toggle('open')">
                            <h4><i data-lucide="calendar" style="width:14px;height:14px;"></i> Fixture Comparison (Next 5)</h4>
                            <span class="report-collapsible-caret">▾</span>
                        </div>
                        <div class="report-collapsible-body"><div class="report-collapsible-content">${fixtureCompHtml}</div></div>
                    </div>

                    <!-- Deep Analysis: Rising Form -->
                    <div class="report-collapsible open">
                        <div class="report-collapsible-header" onclick="this.parentElement.classList.toggle('open')">
                            <h4><i data-lucide="trending-up" style="width:14px;height:14px;"></i> Rising Form Signals</h4>
                            <span class="report-collapsible-caret">▾</span>
                        </div>
                        <div class="report-collapsible-body"><div class="report-collapsible-content"><div class="report-routes-grid">${risingHtml}</div></div></div>
                    </div>

                    <!-- Deep Analysis: Team Context -->
                    <div class="report-collapsible open">
                        <div class="report-collapsible-header" onclick="this.parentElement.classList.toggle('open')">
                            <h4><i data-lucide="shield" style="width:14px;height:14px;"></i> Team Context Comparison</h4>
                            <span class="report-collapsible-caret">▾</span>
                        </div>
                        <div class="report-collapsible-body"><div class="report-collapsible-content"><div class="report-team-grid">${teamContextHtml}</div></div></div>
                    </div>

                    <!-- Deep Analysis: Home/Away Splits -->
                    <div class="report-collapsible open">
                        <div class="report-collapsible-header" onclick="this.parentElement.classList.toggle('open')">
                            <h4><i data-lucide="home" style="width:14px;height:14px;"></i> Home vs Away Splits</h4>
                            <span class="report-collapsible-caret">▾</span>
                        </div>
                        <div class="report-collapsible-body"><div class="report-collapsible-content"><div class="report-routes-grid">${splitsHtml}</div></div></div>
                    </div>

                    <!-- Deep Analysis: xG Regression -->
                    <div class="report-collapsible open">
                        <div class="report-collapsible-header" onclick="this.parentElement.classList.toggle('open')">
                            <h4><i data-lucide="refresh-cw" style="width:14px;height:14px;"></i> xG Regression Analysis</h4>
                            <span class="report-collapsible-caret">▾</span>
                        </div>
                        <div class="report-collapsible-body"><div class="report-collapsible-content"><div class="report-routes-grid">${regressionHtml}</div></div></div>
                    </div>
                </div>
            `;

            document.body.style.overflow = 'hidden';
            content.scrollTop = 0;
            requestAnimationFrame(() => { modal.classList.add('show'); });

            // Render radar chart
            setTimeout(() => {
                const canvas = document.getElementById('reportRadarCanvas');
                if (!canvas || typeof Chart === 'undefined') return;
                if (reportRadarChart) { reportRadarChart.destroy(); reportRadarChart = null; }
                reportRadarChart = new Chart(canvas.getContext('2d'), {
                    type: 'radar',
                    data: {
                        labels: radarAxes.labels,
                        datasets: radarAxes.datasets.map((ds, i) => ({
                            label: ds.label,
                            data: ds.data,
                            borderColor: radarColors[i],
                            backgroundColor: radarBgColors[i],
                            borderWidth: 2,
                            pointRadius: 3,
                            pointBackgroundColor: radarColors[i]
                        }))
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                            r: {
                                beginAtZero: true,
                                max: 100,
                                ticks: { display: false, stepSize: 25 },
                                grid: { color: 'rgba(255,255,255,0.06)' },
                                angleLines: { color: 'rgba(255,255,255,0.08)' },
                                pointLabels: {
                                    color: 'rgba(255,255,255,0.6)',
                                    font: { size: 11, family: "'Space Grotesk', sans-serif" }
                                }
                            }
                        }
                    }
                });
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }, 50);
        }

        function closeCompareModal() {
            const modal = document.getElementById('compareModal');
            if (!modal) return;
            modal.classList.remove('show');
            document.body.style.overflow = '';
            const container = modal.querySelector('.compare-modal-container');
            if (container) container.classList.remove('report-mode');
            if (reportRadarChart) { reportRadarChart.destroy(); reportRadarChart = null; }
        }
