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
        function calculateStats(history, last5 = false) {
            const games = last5 ? history.slice(-5) : history;
            if (games.length === 0) return null;
            const sum = (arr, key) => arr.reduce((acc, g) => acc + (parseFloat(g[key]) || 0), 0);

            // Home/away splits for L5 (used by next-match scoring)
            const homeGames = games.filter(g => g.was_home);
            const awayGames = games.filter(g => !g.was_home);
            const homeSplit = homeGames.length > 0 ? {
                games: homeGames.length,
                points: sum(homeGames, 'total_points'),
                xGI: sum(homeGames, 'expected_goal_involvements'),
                xG: sum(homeGames, 'expected_goals'),
                xA: sum(homeGames, 'expected_assists'),
                cleanSheets: sum(homeGames, 'clean_sheets'),
                saves: sum(homeGames, 'saves'),
                bonus: sum(homeGames, 'bonus'),
                minutes: sum(homeGames, 'minutes')
            } : null;
            const awaySplit = awayGames.length > 0 ? {
                games: awayGames.length,
                points: sum(awayGames, 'total_points'),
                xGI: sum(awayGames, 'expected_goal_involvements'),
                xG: sum(awayGames, 'expected_goals'),
                xA: sum(awayGames, 'expected_assists'),
                cleanSheets: sum(awayGames, 'clean_sheets'),
                saves: sum(awayGames, 'saves'),
                bonus: sum(awayGames, 'bonus'),
                minutes: sum(awayGames, 'minutes')
            } : null;

            return {
                games: games.length,
                minutes: sum(games, 'minutes'),
                points: sum(games, 'total_points'),
                goals: sum(games, 'goals_scored'),
                assists: sum(games, 'assists'),
                cleanSheets: sum(games, 'clean_sheets'),
                goalsConceded: sum(games, 'goals_conceded'),
                saves: sum(games, 'saves'),
                bonus: sum(games, 'bonus'),
                bps: sum(games, 'bps'),
                xG: sum(games, 'expected_goals'),
                xA: sum(games, 'expected_assists'),
                xGI: sum(games, 'expected_goal_involvements'),
                xGC: sum(games, 'expected_goals_conceded'),
                penaltiesSaved: sum(games, 'penalties_saved'),
                penaltiesMissed: sum(games, 'penalties_missed'),
                bigChancesCreated: sum(games, 'big_chances_created') || null,
                _bigChancesCreatedEst: !sum(games, 'big_chances_created') ? Math.round(sum(games, 'expected_assists') * 2) : null,
                bigChancesMissed: sum(games, 'big_chances_missed') || null,
                _bigChancesMissedEst: !sum(games, 'big_chances_missed') ? Math.round(sum(games, 'expected_goals') * 0.8) : null,
                keyPasses: sum(games, 'key_passes') || null,
                _keyPassesEst: !sum(games, 'key_passes') ? Math.round(sum(games, 'expected_assists') * 5) : null,
                ict: sum(games, 'ict_index'),
                influence: sum(games, 'influence'),
                creativity: sum(games, 'creativity'),
                threat: sum(games, 'threat'),
                homeSplit,
                awaySplit
            };
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

           Both pages that load this file already own an audited projection.
           This used to carry a third that agreed with neither, and it regressed
           nothing at all: every rate was the raw recency-weighted figure, so one
           gameweek into a season a keeper's single three-bonus night read as
           three bonus points every week where the squad model — same keeper,
           same page — said 0.53. Compare could contradict the very card the
           user opened it from.

           So it delegates instead. Each page gets the model it already uses
           everywhere else, and the two agree by construction rather than by
           being kept in step by hand. */
        function calculateExpectedPoints(p, pos) {
            // Squad page. buildComparePlayer spreads the native player object and
            // then overwrites .fixtures with a report-shaped copy whose entries
            // carry `opponent` but no `opponentId` — so project the ORIGINAL, or
            // the opponent model quietly degrades to an FDR-only estimate.
            if (typeof predictedGWPoints === 'function' && typeof allPlayersById !== 'undefined') {
                const native = allPlayersById[p.id];
                if (native) return predictedGWPoints(native);
            }
            // Players page: its own model, asked for the single next gameweek.
            if (typeof calculateMultiGWxPts === 'function') {
                const xp = calculateMultiGWxPts(p, pos, 1);
                if (xp != null && Number.isFinite(xp)) return xp;
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
                const l5Games = p.l5?.games || 1;
                const seasonGames = p.season?.games || 1;
                const ptsPerGame = (p.l5?.points || 0) / l5Games;
                const minsPerGame = (p.l5?.minutes || 0) / l5Games;
                const xgiPerGame = (p.l5?.xGI || 0) / l5Games;
                const xgPerGame = (p.l5?.xG || 0) / l5Games;
                const xaPerGame = (p.l5?.xA || 0) / l5Games;
                const bonusPerGame = (p.l5?.bonus || 0) / l5Games;
                const savesPerGame = (p.l5?.saves || 0) / l5Games;
                const csPerGame = (p.l5?.cleanSheets || 0) / l5Games;
                const valueScore = ptsPerGame / (p.price || 1);

                // Reliability & Explosiveness
                let reliability = 0, explosiveness = 0;
                if (p.history && p.history.length >= 5) {
                    const last10 = p.history.slice(-10);
                    const returnGames = last10.filter(g => (parseFloat(g.total_points) || 0) >= 2).length;
                    const explosiveGames = last10.filter(g => (parseFloat(g.total_points) || 0) >= 10).length;
                    reliability = (returnGames / last10.length) * 100;
                    explosiveness = (explosiveGames / last10.length) * 100;
                }

                // Consistency (stdDev)
                let consistency = 5;
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

                // Rising form score
                const risingScore = (window._risingFormScores && window._risingFormScores[p.id]) || 0;

                // Routes data
                const routesData = (window._routesData && window._routesData[p.id]) || { routeCount: 0, compositeScore: 0 };

                // Compute route details for this player (re-use logic from generateRoutesToPoints inline)
                let routes = [];
                try {
                    const g5 = p.l5?.games || 1;
                    const gS = p.season?.games || g5;
                    const blend = (l5v, sv) => (l5v / g5) * 0.6 + (sv / gS) * 0.4;
                    const xGpg = blend(p.l5?.xG || 0, p.season?.xG || 0);
                    const xApg = blend(p.l5?.xA || 0, p.season?.xA || 0);
                    const cPg = blend(p.l5?.cleanSheets || 0, p.season?.cleanSheets || 0);
                    const bPg = blend(p.l5?.bonus || 0, p.season?.bonus || 0);
                    const sPg = blend(p.l5?.saves || 0, p.season?.saves || 0);
                    const crPg = blend(p.l5?.creativity || 0, p.season?.creativity || 0);
                    const goalPtsMap = { GK: 6, DEF: 6, MID: 5, FWD: 4 };
                    const goalThresh = { GK: 0.03, DEF: 0.06, MID: 0.12, FWD: 0.15 }[pos];
                    const assistThresh = { GK: 0.02, DEF: 0.06, MID: 0.10, FWD: 0.08 }[pos];

                    if (xGpg >= goalThresh) {
                        const ceil = pos === 'FWD' ? 0.6 : pos === 'MID' ? 0.5 : 0.3;
                        routes.push({ name: 'Goals', strength: Math.min(10, (xGpg / ceil) * 10), detail: `${xGpg.toFixed(2)} xG/g`, color: '#F87171' });
                    }
                    if (xApg >= assistThresh) {
                        const ceil = pos === 'MID' ? 0.4 : 0.3;
                        routes.push({ name: 'Assists', strength: Math.min(10, (xApg / ceil) * 10), detail: `${xApg.toFixed(2)} xA/g`, color: '#60A5FA' });
                    }
                    if (cPg >= 0.15 && pos !== 'FWD') {
                        routes.push({ name: 'Clean Sheets', strength: Math.min(10, (cPg / 0.55) * 10), detail: `${(cPg * 100).toFixed(0)}%`, color: '#34D399' });
                    }
                    if (bPg >= 0.3) {
                        routes.push({ name: 'Bonus', strength: Math.min(10, (bPg / 2) * 10), detail: `${bPg.toFixed(1)}/g`, color: '#FBBF24' });
                    }
                    if (pos === 'GK' && sPg >= 2) {
                        routes.push({ name: 'Saves', strength: Math.min(10, (sPg / 5) * 10), detail: `${sPg.toFixed(1)}/g`, color: '#A78BFA' });
                    }
                    if (crPg >= 12 && (pos === 'MID' || pos === 'DEF')) {
                        routes.push({ name: 'Creativity', strength: Math.min(10, (crPg / 45) * 10), detail: `${crPg.toFixed(0)} crea/g`, color: '#FB923C' });
                    }
                } catch (e) {}

                // Rising form signals (re-compute for this player)
                let risingSignals = [];
                try {
                    const isDefPos = (pos === 'GK' || pos === 'DEF');
                    if (ts && ts.formRating > 55) {
                        risingSignals.push({ label: 'Team in form', detail: `${ts.wins || '?'}W ${ts.draws || '?'}D ${ts.losses || '?'}L (L5)`, strength: Math.min(10, ((ts.formRating - 55) / 45) * 9), color: '#4ADE80' });
                    }
                    const recent6Xg = getTeamXgWindow(p.teamId, 6);
                    const seasonXg = getTeamSeasonXg(p.teamId);
                    if (recent6Xg && seasonXg && seasonXg.games >= 10) {
                        if (isDefPos) {
                            const delta = seasonXg.xGCpg - recent6Xg.xGCpg;
                            if (delta > 0.10) risingSignals.push({ label: 'Team xGC improving', detail: `${recent6Xg.xGCpg.toFixed(2)} vs ${seasonXg.xGCpg.toFixed(2)} xGC/g`, strength: Math.min(10, (delta / 0.6) * 10), color: '#34D399' });
                        } else {
                            const delta = recent6Xg.xGpg - seasonXg.xGpg;
                            if (delta > 0.10) risingSignals.push({ label: 'Team xG rising', detail: `${recent6Xg.xGpg.toFixed(2)} vs ${seasonXg.xGpg.toFixed(2)} xG/g`, strength: Math.min(10, (delta / 0.6) * 10), color: '#34D399' });
                        }
                    }
                    if (swing && swing.direction === 'improving') {
                        risingSignals.push({ label: 'Fixtures improving', detail: `FDR ${swing.currentFdr} → ${swing.futureFdr}`, strength: Math.min(10, Math.abs(swing.swing) * 4), color: '#60A5FA' });
                    }
                    const avgFdr = p.fixtures?.avgFDR3 || 3;
                    if (avgFdr <= 2.5) {
                        risingSignals.push({ label: 'Easy run now', detail: `FDR ${avgFdr.toFixed(1)}`, strength: Math.min(10, (3 - avgFdr) * 6 * 1.5), color: '#4ADE80' });
                    }
                } catch (e) {}

                // Home/away splits
                const homeSplit = p.l5?.homeSplit || null;
                const awaySplit = p.l5?.awaySplit || null;

                // xG regression
                const seasonGoals = p.season?.goals || 0;
                const seasonXgVal = p.season?.xG || 0;
                const xgOverperf = seasonGoals - seasonXgVal;

                return {
                    ...p, pos, ptsPerGame, minsPerGame, xgiPerGame, xgPerGame, xaPerGame,
                    bonusPerGame, savesPerGame, csPerGame, valueScore, reliability, explosiveness,
                    consistency, xPts, csProb, ts, swing, risingScore, routesData, routes,
                    risingSignals, homeSplit, awaySplit, xgOverperf, seasonGoals, seasonXgVal
                };
            });
        }

        function generateSituationalPicks(reportData) {
            const picks = [];
            if (reportData.length < 2) return picks;

            // Best Value — highest pts/g per £m
            const byValue = [...reportData].sort((a, b) => b.valueScore - a.valueScore);
            const bestValue = byValue[0];
            picks.push({
                category: 'Best Value', cssClass: 'pick-value', icon: '💰',
                winner: bestValue.name, winnerId: bestValue.id,
                reason: `${bestValue.ptsPerGame.toFixed(1)} pts/g at just £${bestValue.price.toFixed(1)}m — ${bestValue.valueScore.toFixed(2)} pts per £m${byValue[1] ? `, ${((bestValue.valueScore - byValue[1].valueScore) / byValue[1].valueScore * 100).toFixed(0)}% better value than ${byValue[1].name}` : ''}`
            });

            // Best Ceiling — explosiveness + routes + xGI
            const byCeiling = [...reportData].sort((a, b) => {
                const sa = a.explosiveness * 0.4 + (a.routesData.routeCount || 0) * 8 + a.xgiPerGame * 20;
                const sb = b.explosiveness * 0.4 + (b.routesData.routeCount || 0) * 8 + b.xgiPerGame * 20;
                return sb - sa;
            });
            const bestCeiling = byCeiling[0];
            picks.push({
                category: 'Best Ceiling', cssClass: 'pick-ceiling', icon: '🚀',
                winner: bestCeiling.name, winnerId: bestCeiling.id,
                reason: `${bestCeiling.explosiveness.toFixed(0)}% explosive rate with ${bestCeiling.routesData.routeCount || 0} routes to points and ${bestCeiling.xgiPerGame.toFixed(2)} xGI/g`
            });

            // Best Safety — reliability + nailed + consistency
            const bySafety = [...reportData].sort((a, b) => {
                const sa = a.reliability * 0.5 + a.minsPerGame * 0.3 + a.consistency * 2;
                const sb = b.reliability * 0.5 + b.minsPerGame * 0.3 + b.consistency * 2;
                return sb - sa;
            });
            const bestSafety = bySafety[0];
            picks.push({
                category: 'Best Safety', cssClass: 'pick-safety', icon: '🛡️',
                winner: bestSafety.name, winnerId: bestSafety.id,
                reason: `${bestSafety.reliability.toFixed(0)}% return rate, ${bestSafety.minsPerGame.toFixed(0)} mins/g — the most consistent and nailed-on pick`
            });

            // Best Fixtures — FDR + swing + home games
            const byFixtures = [...reportData].sort((a, b) => {
                const fdrA = a.fixtures?.avgFDR3 || 3;
                const fdrB = b.fixtures?.avgFDR3 || 3;
                const swingA = (a.swing?.direction === 'improving') ? Math.abs(a.swing.swing) : 0;
                const swingB = (b.swing?.direction === 'improving') ? Math.abs(b.swing.swing) : 0;
                const homeA = (a.fixtures?.next5 || []).filter(f => f.isHome).length;
                const homeB = (b.fixtures?.next5 || []).filter(f => f.isHome).length;
                return (fdrA - swingA * 0.3 - homeA * 0.1) - (fdrB - swingB * 0.3 - homeB * 0.1);
            });
            const bestFixtures = byFixtures[0];
            const bfFdr = bestFixtures.fixtures?.avgFDR3 || 3;
            const bfHome = (bestFixtures.fixtures?.next5 || []).filter(f => f.isHome).length;
            picks.push({
                category: 'Best Fixtures', cssClass: 'pick-fixtures', icon: '📅',
                winner: bestFixtures.name, winnerId: bestFixtures.id,
                reason: `FDR ${bfFdr.toFixed(1)} next 3 with ${bfHome}/5 home games${bestFixtures.swing?.direction === 'improving' ? ' — fixtures improving' : ''}`
            });

            // Best Form — rising form + L5 trend
            const byForm = [...reportData].sort((a, b) => {
                const sa = a.risingScore * 2 + a.ptsPerGame * 3 + (a.form || 0);
                const sb = b.risingScore * 2 + b.ptsPerGame * 3 + (b.form || 0);
                return sb - sa;
            });
            const bestForm = byForm[0];
            picks.push({
                category: 'Best Form', cssClass: 'pick-form', icon: '📈',
                winner: bestForm.name, winnerId: bestForm.id,
                reason: `${bestForm.ptsPerGame.toFixed(1)} pts/g recently${bestForm.risingScore > 0 ? ` with rising form score of ${bestForm.risingScore.toFixed(0)}` : ''} — ${bestForm.form.toFixed(1)} FPL form`
            });

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
            if (player.risingScore >= 10) verdictParts.push('form on the rise');

            const verdict = verdictParts.length > 0
                ? `${verdictParts[0].charAt(0).toUpperCase() + verdictParts[0].slice(1)} player with ${verdictParts.slice(1).join(', ')}.`
                : 'Average profile across metrics.';

            // Strengths
            const strengths = [];
            if (player.routesData.routeCount >= 3) strengths.push(`${player.routesData.routeCount} routes to points — multi-dimensional scorer`);
            else if (player.routesData.routeCount >= 2) strengths.push(`${player.routesData.routeCount} routes to points`);

            if (player.valueScore > 0.8) strengths.push(`Strong value at £${player.price.toFixed(1)}m (${player.valueScore.toFixed(2)} pts/£m)`);
            if (player.minsPerGame >= 85) strengths.push('Nailed-on starter with 85+ mins/g');
            if (player.reliability >= 70) strengths.push(`${player.reliability.toFixed(0)}% return rate — rarely blanks`);
            if (player.explosiveness >= 30) strengths.push(`${player.explosiveness.toFixed(0)}% explosive — frequent hauls`);

            if (isDefPos && player.csProb >= 0.35) strengths.push(`${(player.csProb * 100).toFixed(0)}% CS probability next GW`);
            if (!isDefPos && player.xgiPerGame >= 0.5) strengths.push(`Elite ${player.xgiPerGame.toFixed(2)} xGI/g`);

            if (player.ts?.formRating > 60) strengths.push(`Team in strong form (${player.ts.formRating.toFixed(0)}/100)`);
            if (player.swing?.direction === 'improving') strengths.push(`Fixture swing improving — FDR ${player.swing.currentFdr} → ${player.swing.futureFdr}`);

            // Concerns
            const concerns = [];
            if ((player.fixtures?.avgFDR3 || 3) >= 4) concerns.push(`Tough fixtures (FDR ${(player.fixtures?.avgFDR3 || 3).toFixed(1)}) — short-term ceiling limited`);
            if (player.minsPerGame < 70 && player.minsPerGame > 0) concerns.push(`Rotation risk — only ${player.minsPerGame.toFixed(0)} mins/g`);
            if (player.xgOverperf > 2) concerns.push(`Overperforming xG by ${player.xgOverperf.toFixed(1)} goals — regression risk`);
            if (player.consistency < 4) concerns.push('Volatile returns — high variance in recent points');
            if (player.swing?.direction === 'worsening') concerns.push(`Fixtures worsening — FDR ${player.swing.currentFdr} → ${player.swing.futureFdr}`);
            if (player.ts?.formRating < 40) concerns.push(`Team struggling (form ${player.ts?.formRating?.toFixed(0) || '?'}/100)`);

            // Comparative edges
            const edges = [];
            for (const other of others) {
                const ptsDiff = player.ptsPerGame - other.ptsPerGame;
                const priceDiff = player.price - other.price;
                if (Math.abs(ptsDiff) >= 0.5) {
                    if (ptsDiff > 0 && priceDiff <= 0) {
                        edges.push(`Outscores ${other.name} by ${ptsDiff.toFixed(1)} pts/g and is £${Math.abs(priceDiff).toFixed(1)}m cheaper`);
                    } else if (ptsDiff > 0 && priceDiff > 0) {
                        edges.push(`${ptsDiff.toFixed(1)} pts/g more than ${other.name} but costs £${priceDiff.toFixed(1)}m extra`);
                    } else if (ptsDiff < 0 && priceDiff < 0) {
                        edges.push(`£${Math.abs(priceDiff).toFixed(1)}m cheaper than ${other.name} despite only ${Math.abs(ptsDiff).toFixed(1)} pts/g less`);
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
            const ceilingVals = reportData.map(p => p.explosiveness + (p.routesData.routeCount || 0) * 5);
            const safetyVals = reportData.map(p => p.reliability * 0.7 + p.consistency * 3);
            const fixtureVals = reportData.map(p => Math.max(0, (5 - (p.fixtures?.avgFDR3 || 3)) * 25));
            const routeVals = reportData.map(p => (p.routesData.compositeScore || 0));

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
            const getValue = (obj, path) => path.split('.').reduce((o, k) => (o || {})[k], obj);
            const lowerIsBetter = new Set(['l5.goalsConceded', 'l5.xGC', 'fdr', 'price']);

            const findBestIdx = (key, lower = false) => {
                const vals = reportData.map(p => {
                    const v = getValue(p, key);
                    return typeof v === 'number' ? v : null;
                });
                if (vals.every(v => v === null)) return -1;
                const filtered = vals.filter(v => v !== null);
                const target = lower ? Math.min(...filtered) : Math.max(...filtered);
                return vals.indexOf(target);
            };

            let statRows = [];
            // Overview
            statRows.push({ group: 'Overview' });
            statRows.push({ label: 'Price', key: 'price', fmt: v => `£${v?.toFixed(1) || '?'}m`, lower: true });
            statRows.push({ label: 'Ownership', key: 'selectedBy', fmt: v => `${v?.toFixed(1) || '?'}%` });
            statRows.push({ label: 'Form', key: 'form', fmt: v => v?.toFixed(1) || '-' });
            statRows.push({ label: 'Total Pts', key: 'totalPoints' });
            statRows.push({ label: 'xPts (Next GW)', key: 'xPts', fmt: v => v?.toFixed(1) || '-' });

            // Recent
            statRows.push({ group: 'Recent Form (L5)' });
            statRows.push({ label: 'Pts/G', key: 'ptsPerGame', fmt: v => v?.toFixed(1) || '-' });
            statRows.push({ label: 'Mins/G', key: 'minsPerGame', fmt: v => v?.toFixed(0) || '-' });
            statRows.push({ label: 'Reliability', key: 'reliability', fmt: v => `${v?.toFixed(0) || '?'}%` });
            statRows.push({ label: 'Explosiveness', key: 'explosiveness', fmt: v => `${v?.toFixed(0) || '?'}%` });

            // Attacking
            if (hasAttacker) {
                statRows.push({ group: 'Attacking' });
                statRows.push({ label: 'Goals (L5)', key: 'l5.goals' });
                statRows.push({ label: 'Assists (L5)', key: 'l5.assists' });
                statRows.push({ label: 'xGI/G', key: 'xgiPerGame', fmt: v => v?.toFixed(2) || '-' });
                statRows.push({ label: 'xG/G', key: 'xgPerGame', fmt: v => v?.toFixed(2) || '-' });
            }

            // Defensive
            if (hasDEF) {
                statRows.push({ group: 'Defensive' });
                statRows.push({ label: 'Clean Sheets (L5)', key: 'l5.cleanSheets' });
                statRows.push({ label: 'Goals Conceded', key: 'l5.goalsConceded', lower: true });
                statRows.push({ label: 'CS Prob (Next)', key: 'csProb', fmt: v => v > 0 ? `${(v * 100).toFixed(0)}%` : '-' });
            }

            if (hasGK) {
                statRows.push({ group: 'Goalkeeping' });
                statRows.push({ label: 'Saves (L5)', key: 'l5.saves' });
                statRows.push({ label: 'Saves/G', key: 'savesPerGame', fmt: v => v?.toFixed(1) || '-' });
            }

            // Bonus & Value
            statRows.push({ group: 'Bonus & Value' });
            statRows.push({ label: 'Bonus (L5)', key: 'l5.bonus' });
            statRows.push({ label: 'Value Score', key: 'valueScore', fmt: v => v?.toFixed(2) || '-' });
            statRows.push({ label: 'FDR (Next 3)', key: 'fixtures.avgFDR3', fmt: v => v?.toFixed(1) || '-', lower: true });

            // Rising Form & Routes
            statRows.push({ group: 'AI Insights' });
            statRows.push({ label: 'Rising Form Score', key: 'risingScore', fmt: v => v > 0 ? v.toFixed(0) : '-' });
            statRows.push({ label: 'Routes to Points', key: 'routesData.routeCount', fmt: v => v || '0' });
            statRows.push({ label: 'Routes Score', key: 'routesData.compositeScore', fmt: v => v > 0 ? v.toFixed(1) : '-' });

            const statsTableHtml = statRows.map(row => {
                if (row.group) return `<tr class="group-header"><td colspan="${reportData.length + 1}">${row.group}</td></tr>`;
                const bestIdx = findBestIdx(row.key, row.lower);
                return `<tr>${[`<td>${row.label}</td>`].concat(reportData.map((p, i) => {
                    const val = getValue(p, row.key);
                    const formatted = row.fmt ? row.fmt(val) : (val ?? '-');
                    return `<td class="${i === bestIdx && reportData.length > 1 ? 'best-val' : ''}">${formatted}</td>`;
                })).join('')}</tr>`;
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
                const pickBadges = picks.filter(pk => pk.winnerId === p.id).map(pk => `<span class="report-badge report-badge-pick">${pk.icon} ${pk.category}</span>`).join('');

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
            const routesHtml = reportData.map(p => {
                if (p.routes.length === 0) return `<div class="report-routes-player"><div class="report-routes-player-name">${escHTML(p.name)}</div><div style="font-size:11px;color:var(--text-muted);">No qualifying routes</div></div>`;
                const bars = p.routes.sort((a, b) => {
                    const order = { Goals: 0, Assists: 1, 'Clean Sheets': 2, Bonus: 3, Saves: 4, Creativity: 5 };
                    return (order[a.name] ?? 99) - (order[b.name] ?? 99);
                }).map(r => `
                    <div class="report-route-bar">
                        <div class="report-route-label">${r.name}</div>
                        <div class="report-route-track"><div class="report-route-fill" style="width:${r.strength * 10}%;background:${r.color};"></div></div>
                        <div class="report-route-value">${r.detail}</div>
                    </div>
                `).join('');
                return `<div class="report-routes-player"><div class="report-routes-player-name">${escHTML(p.name)} <span style="color:var(--text-muted);font-weight:400;">(${p.routes.length} routes)</span></div>${bars}</div>`;
            }).join('');

            // Build rising form collapsible
            const risingHtml = reportData.map(p => {
                if (p.risingSignals.length === 0) return `<div class="report-routes-player"><div class="report-routes-player-name">${escHTML(p.name)}</div><div style="font-size:11px;color:var(--text-muted);">No rising form signals detected</div></div>`;
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
                return `<div class="report-routes-player"><div class="report-routes-player-name">${escHTML(p.name)} <span style="color:var(--text-muted);font-weight:400;">(score: ${p.risingScore > 0 ? p.risingScore.toFixed(0) : '0'})</span></div>${signals}</div>`;
            }).join('');

            // Build team context collapsible
            const teamContextHtml = reportData.map(p => {
                const ts = p.ts || {};
                const teamName = teams[p.teamId]?.name || p.team;
                return `
                    <div class="report-team-card">
                        <div class="report-team-card-name">${escHTML(p.name)} — ${escHTML(teamName)}</div>
                        <div class="report-team-stat"><span class="report-team-stat-label">Attack Power</span><span class="report-team-stat-value">${ts.attackPower?.toFixed(0) || '?'}</span></div>
                        <div class="report-team-stat"><span class="report-team-stat-label">Defense Power</span><span class="report-team-stat-value">${ts.defensePower?.toFixed(0) || '?'}</span></div>
                        <div class="report-team-stat"><span class="report-team-stat-label">Form Rating</span><span class="report-team-stat-value">${ts.formRating?.toFixed(0) || '?'}</span></div>
                        <div class="report-team-stat"><span class="report-team-stat-label">Fixture Score</span><span class="report-team-stat-value">${ts.fixtureScore?.toFixed(0) || '?'}</span></div>
                        <div class="report-team-stat"><span class="report-team-stat-label">xG Trend</span><span class="report-team-stat-value" style="color:${ts.xgTrend === 'rising' ? 'var(--color-success)' : ts.xgTrend === 'falling' ? 'var(--color-error)' : 'var(--text-muted)'}">${ts.xgTrend || 'stable'}</span></div>
                        <div class="report-team-stat"><span class="report-team-stat-label">xGC Trend</span><span class="report-team-stat-value" style="color:${ts.xgcTrend === 'improving' ? 'var(--color-success)' : ts.xgcTrend === 'worsening' ? 'var(--color-error)' : 'var(--text-muted)'}">${ts.xgcTrend || 'stable'}</span></div>
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
