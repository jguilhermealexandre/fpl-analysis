/* ============================================
   EasyFPL — My Team Analysis
   The Transfer Wizard: scoring engine, Control Room rendering, actions,
   user settings and the transfer market browser.

   Extracted from the inline <script> in fpl-my-team-analysis.html.
   These files are plain classic scripts loaded in order, not ES modules:
   every function stays a global, which the inline onclick= handlers
   throughout the markup depend on. Load order is preserved from the
   original file — team-analysis-core.js must come first, since the
   settings IIFE in lineup-wizard.js reads DEFAULT_SETTINGS from it.
   ============================================ */

        // ===== TRANSFER WIZARD ENGINE =====

        // The shortlist (the star icon on fpl-players-analysis.html) is authored
        // there, under localStorage key fpl_shortlist — a plain array of player
        // ids. This page never writes it, only reads it, the same read-only
        // relationship index.html's Market Watch widget already has with it.
        function getTWShortlistIds() {
            try {
                const raw = JSON.parse(localStorage.getItem('fpl_shortlist') || '[]');
                // Coerced to numbers deliberately: a Set holding "123" never matches
                // a player id of 123, and the stored array has been written by more
                // than one version of the star control over time.
                return new Set((Array.isArray(raw) ? raw : [])
                    .map(Number).filter(n => Number.isFinite(n)));
            } catch (e) {
                return new Set();
            }
        }

        // Accounts for the starred players this slot cannot offer. An empty
        // Favorites tab is otherwise indistinguishable from a broken one, which is
        // exactly how it read: the two filters below are correct, just invisible.
        function twShortlistBreakdownText(owned, otherPos, posName) {
            const parts = [];
            if (owned.length) {
                parts.push(`${owned.length} ${owned.length === 1 ? 'is' : 'are'} already in your squad (${escHTML(owned.map(p => p.name).join(', '))})`);
            }
            if (otherPos.length) {
                parts.push(`${otherPos.length} ${otherPos.length === 1 ? 'plays' : 'play'} another position — this slot only takes ${escHTML(posName.toLowerCase())}`);
            }
            return parts.length ? parts.join('; ') + '.' : '';
        }

        // Recency-weighted average, Transfer Wizard flavor: pre-filters to played-minutes
        // games before windowing. Named distinctly from the shared recencyWeightedAvg() in
        // scripts/compare-report.js (which windows raw, unfiltered history) to avoid the two
        // same-named function declarations silently overriding each other at global scope.
        function twRecencyWeightedAvg(history, key, n = 5) {
            if (!history || history.length === 0) return 0;
            const played = history.filter(h => h.minutes > 0);
            const window = played.slice(-n);
            if (window.length === 0) return 0;
            const weights = window.map((_, i) => i + 1);
            const wSum = weights.reduce((a, b) => a + b, 0);
            let total = 0;
            window.forEach((h, i) => { total += (parseFloat(h[key]) || 0) * weights[i]; });
            return total / wSum;
        }

        // Clean sheet probability model (ported from lineup wizard)
        /* Drawn rather than typed. The emoji rendered as a different glyph
           at a different weight on every platform — full colour on one, a thin
           outline on another — and could take neither the button's text colour
           nor either theme. */
        const TW_SWAP_ICON = '<svg class="twc-swap-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M16 3h5v5"/><path d="M21 3l-7 7"/>' +
            '<path d="M8 21H3v-5"/><path d="M3 21l7-7"/></svg>';

        function getCleanSheetProb(teamId, opponentId, isHome) {
            const tp = teamAnalysis[teamId], op = teamAnalysis[opponentId];
            if (!tp || !op) return 0.25;
            let base = isHome ? 0.35 : 0.25;
            const teamDef = tp.defensePower || 50;
            const oppAtk = op.attackPower || 50;
            base += (teamDef - 50) * 0.003;
            base -= (oppAtk - 50) * 0.0025;
            const avgLeagueGApg = 1.3;
            base += (avgLeagueGApg - (tp.avgConceded || 1.3)) * 0.04;
            return Math.max(0.05, Math.min(0.65, base));
        }

        // Transfer Score — multi-factor ranking for replacement candidates
        // (Aligned with players-analysis calculatePositionScore for consistent recommendations)
        function calculateTransferScore(player, pos) {
            const posNames = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
            const posName = posNames[pos] || 'MID';

            // Get player history for recency weighting
            const pd = playersDetailData?.players?.find(p => p.id === player.id);
            const history = pd?.history?.filter(h => h.minutes > 0) || [];
            const recent = getPlayerRecentStats(player.id, 5);

            const seasonGames = Math.max(currentGW - 1, 1);
            const recentGames = recent?.games || 1;
            const minsPerGame = recent ? (recent.minutes / recentGames) : (player.minutes / seasonGames);
            const nailedBonus = Math.min(5, Math.max(0, (minsPerGame - 60) / 4));

            // ── Recency-weighted per-game stats (most recent games count more) ──
            const rwPtsPerGame = history.length > 0 ? twRecencyWeightedAvg(history, 'total_points') : (recent ? recent.ppg : player.ppg);
            const rwXGI = history.length > 0 ? twRecencyWeightedAvg(history, 'expected_goal_involvements') : (recent ? recent.xGIPer90 : (player.minutes > 0 ? (player.xGI / player.minutes) * 90 : 0));
            const rwXG = history.length > 0 ? twRecencyWeightedAvg(history, 'expected_goals') : (recent ? recent.xGPer90 : (player.minutes > 0 ? (player.xG / player.minutes) * 90 : 0));
            const rwXA = history.length > 0 ? twRecencyWeightedAvg(history, 'expected_assists') : (recent ? recent.xAPer90 : (player.minutes > 0 ? (player.xA / player.minutes) * 90 : 0));
            const rwBonus = history.length > 0 ? twRecencyWeightedAvg(history, 'bonus') : (recent ? (recent.bonus / recentGames) : (player.bonus / seasonGames));
            const csPerGame = recent ? (recent.cs / recentGames) : (player.cleanSheets / Math.max(player.starts || seasonGames, 1));

            const value = rwPtsPerGame / Math.max(player.price, 3.5);

            // Season phase for value weight adjustment
            const phase = currentGW >= 30 ? 'late' : (currentGW >= 15 ? 'mid' : 'early');
            const valueWeight = phase === 'late' ? (posName === 'GK' ? 8 : 6) : (posName === 'GK' || posName === 'DEF') ? 10 : 12;

            // ── Fixture factor — weighted next 3 fixtures (3/2/1) with opponent quality ──
            const fixtures = player.fixtures || teamFixtures[player.teamId] || [];
            const fixtureWeights = [3, 2, 1];
            let fixtureFactor = 0;
            let venueMultiplier = 1.0;

            if (fixtures.length > 0) {
                let totalWeight = 0, weightedFixture = 0;
                fixtures.slice(0, 3).forEach((f, idx) => {
                    const w = fixtureWeights[idx] || 1;
                    const opp = f.opponentId;
                    const isHome = f.isHome;
                    let ff = 0;
                    if (opp && teamAnalysis[opp]) {
                        const oppAttack = teamAnalysis[opp].attackPower || 50;
                        const oppDefense = teamAnalysis[opp].defensePower || 50;
                        const relevantOpp = (pos <= 2) ? oppAttack : oppDefense;
                        ff = ((50 - relevantOpp) / 50) * 10;
                        if (isHome) ff += 1.5;
                    } else {
                        const fdr = f.difficulty || 3;
                        ff = Math.max(-10, (3.5 - fdr) * 8);
                    }
                    weightedFixture += ff * w;
                    totalWeight += w;
                });
                fixtureFactor = totalWeight > 0 ? weightedFixture / totalWeight : 0;

                // ── Dynamic venue multiplier based on home/away splits ──
                const nextIsHome = fixtures[0]?.isHome ?? null;
                if (nextIsHome !== null && history.length >= 4) {
                    const recentWindow = history.slice(-5);
                    const splitGames = recentWindow.filter(h => h.was_home === nextIsHome);
                    if (splitGames.length >= 2) {
                        const splitPts = splitGames.reduce((s, h) => s + (h.total_points || 0), 0) / splitGames.length;
                        const overallPts = recentWindow.reduce((s, h) => s + (h.total_points || 0), 0) / recentWindow.length;
                        if (overallPts > 0) {
                            venueMultiplier = 0.7 + 0.3 * (splitPts / overallPts);
                            venueMultiplier = Math.max(0.8, Math.min(1.25, venueMultiplier));
                        }
                    } else {
                        venueMultiplier = nextIsHome ? 1.05 : 0.95;
                    }
                } else {
                    venueMultiplier = (fixtures[0]?.isHome) ? 1.05 : 0.95;
                }
            }

            // ── Team context factors ──
            const ta = teamAnalysis[player.teamId];
            let teamFormFactor = 0, teamQualityFactor = 0;
            if (ta) {
                teamFormFactor = ((ta.formRating || 50) - 50) / 50 * 3;
                teamQualityFactor = pos <= 2
                    ? ((ta.defensePower || 50) - 50) / 50 * 4
                    : ((ta.attackPower || 50) - 50) / 50 * 4;
            }

            // ── CS Probability factor (GK/DEF) — weighted across next 3 fixtures ──
            let csProbFactor = 0;
            if (pos <= 2 && fixtures.length > 0) {
                let csTotal = 0, csWeightTotal = 0;
                fixtures.slice(0, 3).forEach((f, idx) => {
                    const w = fixtureWeights[idx] || 1;
                    if (f.opponentId) {
                        const prob = getCleanSheetProb(player.teamId, f.opponentId, f.isHome);
                        csTotal += prob * w;
                        csWeightTotal += w;
                    }
                });
                if (csWeightTotal > 0) {
                    const avgProb = csTotal / csWeightTotal;
                    csProbFactor = (avgProb - 0.28) * 35;
                }
            }

            // ── Advanced penalty taker detection ──
            let penTakerBonus = 0;
            if (pos >= 2) {
                const totalGoals = player.goals || 0;
                const seasonPenGoals = Math.max(0, totalGoals - (player.xG || 0));
                const penMissed = 0; // not available in bootstrap data
                const penThreshold = { DEF: 0.5, MID: 1.0, FWD: 1.5 }[posName] || 1.0;
                const penAttempts = (seasonPenGoals >= penThreshold || penMissed > 0)
                    ? Math.round(seasonPenGoals + penMissed) : 0;
                const penRatio = totalGoals > 0 ? seasonPenGoals / totalGoals : 1;
                if (penAttempts >= 2 && penRatio > 0.25) {
                    penTakerBonus = Math.min(6, penAttempts * 1.5);
                } else if (seasonGames >= 10 && penAttempts >= 1 && penRatio > 0.25) {
                    penTakerBonus = Math.min(4, penAttempts * 1.5);
                }
            }

            // ── Rotation risk penalty ──
            let rotationPenalty = 0;
            if (player.teamId && teamFixtures[player.teamId]) {
                const upcomingFixtures = teamFixtures[player.teamId].slice(0, 4);
                const hasCongestion = upcomingFixtures.length >= 3;
                if (hasCongestion && minsPerGame < 85) {
                    rotationPenalty = -2;
                }
            }

            // ── Enhancement bonuses (inspired by players-analysis calculatePositionScore) ──
            // Rising form: compare L3 ppg vs season ppg
            let risingFormBonus = 0;
            const recentPpg = recent ? recent.ppg : 0;
            const seasonPpg = player.ppg || 0;
            if (seasonPpg > 1) {
                const formRatio = recentPpg / seasonPpg;
                if (formRatio > 1.3) risingFormBonus = 3;
                else if (formRatio > 1.15) risingFormBonus = 1.5;
            }

            // Routes-to-points diversity
            let routeCount = 0;
            if (rwXG > 0.1) routeCount++;
            if (rwXA > 0.1) routeCount++;
            if (rwBonus > 0.3) routeCount++;
            if (pos <= 2 && csPerGame > 0.2) routeCount++;
            const routeBonus = Math.max(0, (routeCount - 1) * 1.5);

            // Reliability (low variance in recent scores)
            let reliabilityBonus = 0;
            if (history.length >= 4) {
                const recentScores = history.slice(-5).map(h => h.total_points || 0);
                const avg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
                if (avg > 3) {
                    const variance = recentScores.reduce((s, v) => s + (v - avg) ** 2, 0) / recentScores.length;
                    reliabilityBonus = Math.max(0, 3 - Math.sqrt(variance) * 0.5);
                }
            }

            const commonBonuses = risingFormBonus + routeBonus + reliabilityBonus;

            // ── Position-specific scoring formulas ──
            if (posName === 'GK') {
                const savesPer90 = recent ? recent.savesPer90 : (player.minutes > 0 ? (player.saves / player.minutes) * 90 : 0);
                const xGCPerGame = recent ? (recent.xGC / recentGames) : (player.minutes > 0 ? (player.xGC / player.minutes) * 90 : 0);
                const defScore = Math.max(0, (2 - xGCPerGame)) * 8;

                return ((csPerGame * 30) +
                       (savesPer90 * 2) +
                       defScore +
                       (rwPtsPerGame * 3) +
                       (value * valueWeight) +
                       fixtureFactor +
                       teamQualityFactor +
                       teamFormFactor +
                       csProbFactor +
                       rotationPenalty +
                       nailedBonus +
                       commonBonuses) * venueMultiplier;
            }

            if (posName === 'DEF') {
                const xGCPerGame = recent ? (recent.xGC / recentGames) : (player.minutes > 0 ? (player.xGC / player.minutes) * 90 : 0);
                const defScore = Math.max(0, (2 - xGCPerGame)) * 8;

                return ((csPerGame * 25) +
                       defScore +
                       (rwXGI * 12) +
                       (rwPtsPerGame * 3) +
                       (value * valueWeight) +
                       fixtureFactor +
                       teamQualityFactor +
                       teamFormFactor +
                       csProbFactor +
                       rotationPenalty +
                       penTakerBonus +
                       nailedBonus +
                       commonBonuses) * venueMultiplier;
            }

            if (posName === 'MID') {
                const actualGI = recent ? ((recent.goals + recent.assists) / recentGames) : 0;
                const overPerf = actualGI - rwXGI;
                const regressionAdj = overPerf > 0 ? overPerf * -3 : overPerf * -2;

                return ((rwXGI * 40) +
                       regressionAdj +
                       (csPerGame * 3) +
                       (rwPtsPerGame * 3) +
                       (rwBonus * 2) +
                       (value * valueWeight) +
                       fixtureFactor +
                       teamQualityFactor +
                       teamFormFactor +
                       rotationPenalty +
                       penTakerBonus +
                       nailedBonus +
                       commonBonuses) * venueMultiplier;
            }

            // FWD
            const actualGoals = recent ? (recent.goals / recentGames) : 0;
            const overPerf = actualGoals - rwXG;
            const regrCoeff = (overPerf > 0 && seasonGames >= 15 && (player.goals / seasonGames) > (player.xG / seasonGames)) ? -2 : -4;
            const regressionAdj = overPerf > 0 ? overPerf * regrCoeff : overPerf * -2;

            return ((rwXG * 40) +
                   (rwXA * 15) +
                   regressionAdj +
                   (rwPtsPerGame * 3) +
                   (rwBonus * 2) +
                   (value * valueWeight) +
                   fixtureFactor +
                   teamQualityFactor +
                   teamFormFactor +
                   rotationPenalty +
                   penTakerBonus +
                   nailedBonus +
                   commonBonuses) * venueMultiplier;
        }

        // Find replacement candidates for a position within budget
        // blockedClubs is optional and only the Control Room market passes it: teams
        // you already hold three of. Filtering here rather than after the slice(0, 30)
        // below matters — a full club can own a lot of the top of the list, and
        // trimming afterwards would silently shorten the recommendations.
        function findTransferCandidates(position, maxPrice, excludeIds, blockedClubs) {
            const candidates = allPlayers.filter(p =>
                p.position === position &&
                p.price <= maxPrice &&
                !excludeIds.has(p.id) &&
                !(blockedClubs && blockedClubs.has(p.teamId)) &&
                (p.status === 'a' || p.status === 'd') &&
                p.minutes >= minMinutesForCandidate()
            );

            /* Ranked on projected points, not on the transfer score.

               calculateTransferScore returns a number in units of its own, and
               every surface that consumes this list then labels the rows with the
               xP engine — so the order and the figure printed on it came out of
               two different models and could contradict each other outright. The
               players page hit the same thing and fixed it there: across 200
               players the ratio between its two models ran from 0.0 to 23.9, which
               put cards on screen in an order their own badge disagreed with.
               buildSuggestedMoves in pitch-snapshot.js is worse off still — it
               says "ranked by xP gained per transfer" and then takes [0] off a
               list that was not, so a better candidate two rows down was never
               even looked at.

               _transferScore is still computed and still on the object. The
               package strategies below blend it against price and ownership on its
               own scale, and the card prints it as a second reading; here it
               breaks ties between candidates that project identically. */
            const runGWs = typeof twRunGWs === 'function' ? twRunGWs() : [];
            const canProject = runGWs.length > 0
                && typeof xpEngineReady === 'function' && xpEngineReady();

            candidates.forEach(c => {
                c._transferScore = calculateTransferScore(c, c.position);
                c._xpRun = canProject ? twXPOver(c, runGWs) : null;
                // Get recent stats for display
                c._recentStats = getPlayerRecentStats(c.id, 5);
            });

            /* No engine, no fixtures left to project, or the globals it reads not
               loaded yet: fall back to the old ordering whole. Sorting everyone by
               an identical zero would be worse than the score this replaces. */
            candidates.sort(canProject
                ? (a, b) => (b._xpRun - a._xpRun) || (b._transferScore - a._transferScore)
                : (a, b) => b._transferScore - a._transferScore);

            return candidates.slice(0, 30); // Top 30 per slot
        }

        // Generate curated transfer packages
        function generateTransferPackages() {
            const sells = transferState.sellPlayers;
            const bank = (picksData?.entry_history?.bank || 0) / 10;
            const totalBudget = sells.reduce((s, p) => s + (p.sellPrice || p.price), 0) + bank;
            transferState.budget = totalBudget;

            // Remaining squad (excluding sold players)
            const sellIds = new Set(sells.map(p => p.id));
            const remainingSquad = twSquad().filter(p => !sellIds.has(p.id));
            const remainingIds = new Set(remainingSquad.map(p => p.id));

            // Count players per team in remaining squad
            const teamCounts = {};
            remainingSquad.forEach(p => { teamCounts[p.teamId] = (teamCounts[p.teamId] || 0) + 1; });

            // Get candidates per slot
            const slotCandidates = sells.map(sold => {
                const cands = findTransferCandidates(sold.position, totalBudget, new Set([...remainingIds, ...sellIds]));
                // Enforce max 3 from same team
                return cands.filter(c => (teamCounts[c.teamId] || 0) < 3);
            });

            // Cache candidates
            transferState.candidateCache = {};
            sells.forEach((sold, i) => { transferState.candidateCache[i] = slotCandidates[i]; });

            // Score the sold player for comparison
            sells.forEach(s => { s._transferScore = calculateTransferScore(s, s.position); });

            const packages = [];

            // Helper: build a package given a strategy function
            function buildPackage(name, icon, description, strategyFn) {
                const picks = [];
                let spent = 0;
                const usedIds = new Set(remainingIds);
                const localTeamCounts = { ...teamCounts };

                for (let i = 0; i < sells.length; i++) {
                    const candidates = slotCandidates[i].filter(c =>
                        !usedIds.has(c.id) && (localTeamCounts[c.teamId] || 0) < 3
                    );
                    const pick = strategyFn(candidates, sells[i], totalBudget - spent, i);
                    if (pick) {
                        picks.push(pick);
                        spent += pick.price;
                        usedIds.add(pick.id);
                        localTeamCounts[pick.teamId] = (localTeamCounts[pick.teamId] || 0) + 1;
                    }
                }

                if (picks.length === sells.length && spent <= totalBudget + 0.01) {
                    const totalScoreDelta = picks.reduce((s, p, i) => s + (p._transferScore - sells[i]._transferScore), 0);
                    packages.push({
                        name, icon, description,
                        picks, sells: [...sells],
                        totalCost: spent,
                        remaining: totalBudget - spent,
                        scoreDelta: totalScoreDelta
                    });
                }
            }

            // 1. Best Overall — highest combined score
            buildPackage('Best Overall', '<i data-lucide="trophy" style="width:14px;height:14px;display:inline;vertical-align:middle;"></i>', 'Maximizes combined transfer score across all slots', (cands, sold, budgetLeft) => {
                const affordable = cands.filter(c => c.price <= budgetLeft);
                return affordable.length > 0 ? affordable[0] : null; // Already sorted by score
            });

            // 2. Value Package — best score/price ratio
            buildPackage('Value Pick', '<i data-lucide="coins" style="width:14px;height:14px;display:inline;vertical-align:middle;"></i>', 'Best points-per-million return, freeing up budget', (cands, sold, budgetLeft) => {
                const affordable = cands.filter(c => c.price <= budgetLeft && c.price <= sold.price);
                affordable.sort((a, b) => (b._transferScore / b.price) - (a._transferScore / a.price));
                return affordable.length > 0 ? affordable[0] : cands.filter(c => c.price <= budgetLeft)[0] || null;
            });

            // 3. Premium Upgrade — spend the most on improving the weakest slot
            buildPackage('Premium Upgrade', '<i data-lucide="crown" style="width:14px;height:14px;display:inline;vertical-align:middle;"></i>', 'Invests heavily in the slot with most room for improvement', (cands, sold, budgetLeft) => {
                const affordable = cands.filter(c => c.price <= budgetLeft);
                // Prefer expensive high-scorers
                affordable.sort((a, b) => (b._transferScore * 0.7 + b.price * 0.3) - (a._transferScore * 0.7 + a.price * 0.3));
                return affordable.length > 0 ? affordable[0] : null;
            });

            // 4. Differential — low-ownership picks
            buildPackage('Differential', '<i data-lucide="target" style="width:14px;height:14px;display:inline;vertical-align:middle;"></i>', 'Under-the-radar picks with <10% ownership', (cands, sold, budgetLeft) => {
                const diffs = cands.filter(c => c.price <= budgetLeft && c.ownership < 10);
                if (diffs.length > 0) {
                    diffs.sort((a, b) => (b._transferScore + (10 - b.ownership) * 0.3) - (a._transferScore + (10 - a.ownership) * 0.3));
                    return diffs[0];
                }
                return cands.filter(c => c.price <= budgetLeft)[0] || null;
            });

            // 5. Form Chasers — highest recent form
            buildPackage('Form Chasers', '<i data-lucide="flame" style="width:14px;height:14px;display:inline;vertical-align:middle;"></i>', 'Players in the hottest recent form regardless of value', (cands, sold, budgetLeft) => {
                const affordable = cands.filter(c => c.price <= budgetLeft);
                affordable.sort((a, b) => b.form - a.form);
                return affordable.length > 0 ? affordable[0] : null;
            });

            // Sort packages by score delta
            packages.sort((a, b) => b.scoreDelta - a.scoreDelta);
            transferState.packages = packages;
            return packages;
        }

        // ===== TRANSFER WIZARD RENDERING (Control Room) =====

        function renderTransferWizard() {
            transferRendered = true;
            /* The plan survives a reload: it is the manager's own working state
               and losing it on refresh is what made the wizard feel throwaway.
               Reloaded here rather than at page load so it is always read
               against the gameweek currently being planned. */
            twPlanLoad();
            if (!draftStates[activeDraftSlot]) {
                initDraft(activeDraftSlot);
                loadDraft();
            }
            // funnel holds every market filter. It is deliberately created once here
            // and never reset when moving between slots: filling eight slots on a
            // wildcard should not mean re-picking the same six clubs eight times.
            transferState = { pending: [], activeSlot: -1, mode: 'squad', candidateCache: {}, previewPlayer: null, strategy: null, wildcard: false, sellMode: false, step: 1, _stepDir: 0, funnel: twfDefaultFilters() };
            const container = document.getElementById('transferDisplay');

            /* Two panes side by side rather than one panel switching between
               squad, market and comparison — the squad you are selling from
               stays visible at every step, which is the whole point of a
               transfer screen. The left pane never leaves; the right one is
               the step, and it is the only thing that animates. */
            container.innerHTML = `
                <div class="tw-container" id="twContainer" data-tw-step="1">
                    <!-- The steps and the plan's running total share a row. They
                         were stacked, which cost a whole band of the screen to
                         four words and three small numbers, and pushed the work
                         itself further down than it needed to be. The rail
                         shrinks to fit; the figures sit at the end of it. -->
                    <div class="tw-topbar">
                        <div id="twRail"></div>
                        <div id="twStats"></div>
                    </div>
                    <div id="twBudgetBar"></div>
                    <div class="twr-panel" id="twRecoPanel">
                        <!-- Question on the left, button on the right, nothing
                             between them. The explanation that used to sit under
                             the question described what the button does, which is
                             a thing to find out by pressing it. -->
                        <div class="twr-head">
                            <div class="twr-title">Should I make a transfer?</div>
                            <button class="twr-run" onclick="twRunRecommendation()">Get recommendation</button>
                        </div>
                        <div id="twRecoBody"></div>
                    </div>
                    <div class="twc-body">
                        <div class="twc-pane" id="twSquadPane"></div>
                        <div class="twc-pane" id="twMarketPane"></div>
                    </div>
                </div>
            `;
            if (typeof lucide !== 'undefined') lucide.createIcons();
            renderTWAll();
        }

        // Wildcard makes every transfer free, so the cap becomes the squad itself.
        /* How many players a plan may hold.
         *
         * It was five for everything that was not a chip, which made Single a
         * plan you could stage five transfers under — and Single's whole
         * description is "one transfer at a time". The cap is the plan's now:
         * one for Single, five for Multi, and a chip lets you rebuild the
         * squad.
         *
         * Deliberately NOT capped at your free transfers. Exceeding them is
         * legal and often right — that is what a hit is for, and the Points
         * hit figure beside the counter prices it. Refusing the sixth transfer
         * because you only have one free would be the wizard inventing a rule
         * the game does not have.
         *
         * Fifteen on a chip is the squad size, which is the real limit: you
         * cannot transfer a player you have already transferred out. */
        const TW_PLAN_CAP = { single: 1, multi: 5, wildcard: 15, freehit: 15 };

        function twMaxTransfers() {
            if (transferState.wildcard) return 15;
            return TW_PLAN_CAP[transferState.strategy] || 5;
        }

        /* ===== How you are transferring =====

           There used to be two independent toggles in two different panels —
           "Play wildcard" in the header and "Sell mode" above the squad —
           each with its own on-state, describing overlapping things. Sell mode
           is what you always want on a wildcard, and a wildcard badge sitting
           next to a "1 free transfer" counter is two claims about the same
           week. Four named plans replace both, so the screen has one answer to
           "what am I doing" instead of a combination to work out.

           The two old booleans are still what the rest of the file reads, and
           are derived here rather than set anywhere else. */
        const TW_STRATEGIES = [
            { id: 'single', label: 'Single', tip: 'One transfer at a time, with hits counted against your free transfers.' },
            { id: 'multi', label: 'Multi', tip: 'Click several players to sell at once and pool their money. Hits still count.' },
            { id: 'wildcard', label: 'Wildcard', tip: 'Unlimited transfers, no points hits. Judged over the next five gameweeks, because you keep the squad.' },
            { id: 'freehit', label: 'Free Hit', tip: 'Unlimited transfers for one gameweek only — the squad reverts afterwards, so everything is judged over that single week.' }
        ];

        /* ===== The five steps =====

           Everything the wizard needs was already on one screen at once: pick
           a plan, pick who leaves, shop, compare, confirm — four panels deep,
           all of it visible from the first second, most of it irrelevant to
           whatever you were actually doing. The work has not changed; what
           changes here is that the screen only ever asks one question, and
           says which of five it is on.

           The step is explicit rather than derived, because two of them share
           a mode: choosing a plan and choosing who leaves are both mode
           'squad', and only the person clicking knows which one they are on.
           Everything below it still reads mode, so nothing else had to move. */
        const TW_STEPS = [
            { n: 1, key: 'plan',    icon: 'sliders', label: 'Plan',    hint: 'How many transfers, and at what cost' },
            { n: 2, key: 'swap',    icon: 'swap',    label: 'Replacements', hint: 'Your squad on the left, who can replace them on the right' },
            { n: 3, key: 'compare', icon: 'scales',  label: 'Compare', hint: 'The two of them, side by side' },
            { n: 4, key: 'confirm', icon: 'check',   label: 'Overview', hint: 'The squad this leaves you with, and what it costs' }
        ];

        /* One header shape for every step: what the step is, a hint, and the
           two ways out of it. Rendered into .twc-panel-head so it can be the
           sticky bar the panel scrolls under. */
        function twStepHead(opts) {
            const o = opts || {};
            const nav = [
                o.back ? `<button class="tw-back" onclick="${o.back.on}"${o.back.tip ? ` data-tooltip="${escHTML(o.back.tip)}"` : ''}>${v2Icon('back')} ${escHTML(o.back.label)}</button>` : '',
                o.extra || '',
                o.next ? `<button class="tw-next"${o.next.disabled ? ' disabled' : ''} onclick="${o.next.on}"${o.next.tip ? ` data-tooltip="${escHTML(o.next.tip)}"` : ''}>${escHTML(o.next.label)} ${v2Icon('next')}</button>` : ''
            ].filter(Boolean).join('');
            return `<div class="twc-panel-head tw-step-head">
                <span class="twc-panel-title">${o.icon ? v2Icon(o.icon) : ''} ${escHTML(o.title || '')}</span>
                ${o.hint ? `<span class="twc-panel-hint">${o.hint}</span>` : ''}
                ${nav ? `<span class="tw-step-nav">${nav}</span>` : ''}
            </div>`;
        }

        function twStep() {
            const n = transferState.step;
            return n >= 1 && n <= TW_STEPS.length ? n : 1;
        }

        /* Direction is what the animation needs: going forward the incoming
           panel arrives from the right, going back it arrives from the left,
           so the movement matches the rail above it rather than contradicting
           it. Set here, read once by the renderer, then cleared. */
        /* ===== A step is a place, so Back goes back one =====
         *
         * The wizard is four screens and Back left the page entirely — you came
         * to Compare from Replacements, pressed Back expecting Replacements,
         * and landed wherever you were before My Team. Each step is a history
         * entry now, on a `step` search parameter: the tab lives in the hash
         * and My Team has its own popstate handler reading it, so a step must
         * not look like a tab change. pushState never reloads, so a search
         * parameter is safe on a hash-routed page.
         *
         * Step 1 carries no parameter. It is where the wizard starts, so the
         * entry you arrived on IS step 1 — pushing one for it would mean two
         * Backs to leave. */
        const TW_URL_PARAM = 'step';

        /* True only while re-applying a step the browser navigated to, so
           restoring one does not push another entry for it. */
        let twRestoringHistory = false;

        function twStepUrl(step) {
            const url = new URL(window.location.href);
            if (step > 1) url.searchParams.set(TW_URL_PARAM, String(step));
            else url.searchParams.delete(TW_URL_PARAM);
            return url.pathname + url.search + url.hash;
        }

        function twGoStep(n, opts) {
            const from = twStep();
            const to = Math.max(1, Math.min(TW_STEPS.length, n));
            transferState.step = to;
            transferState._stepDir = to === from ? 0 : (to > from ? 1 : -1);
            if (to !== from && !twRestoringHistory) {
                try {
                    const next = twStepUrl(to);
                    /* Forwards pushes, backwards replaces. Going back through
                       the rail is the same move as pressing Back, so pushing
                       for it would make the two disagree: one Back would then
                       return you to the step you just left. */
                    if (to > from) history.pushState({ twStep: to }, '', next);
                    else history.replaceState({ twStep: to }, '', next);
                } catch (e) { /* no usable history */ }
            }
            if (!opts || opts.render !== false) renderTWAll();
        }

        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('popstate', () => {
                /* Only while the wizard is the screen in front of you. My Team's
                   own handler runs first and re-applies the tab from the hash;
                   this is registered later, so by the time it runs the right tab
                   is already up. */
                if (typeof transferState === 'undefined' || !transferState) return;
                const pane = document.getElementById('transferDisplay');
                if (!pane || pane.style.display === 'none') return;
                let raw = null;
                try { raw = new URL(window.location.href).searchParams.get(TW_URL_PARAM); } catch (e) { return; }
                const want = raw ? parseInt(raw, 10) : 1;
                if (!want || want === twStep()) return;
                /* A step you never reached is not somewhere to land — Forward
                   into Compare after clearing the plan would render a comparison
                   of nothing. */
                if (typeof twStepReachable === 'function' && !twStepReachable(want)) return;
                twRestoringHistory = true;
                try { twGoStep(want); } finally { twRestoringHistory = false; }
            });
        }

        /* The furthest step this plan has actually reached, so the rail can
           offer a completed step as a way back without offering a step that
           has never been arrived at. A step is behind you only if the state it
           needs exists: there is no going back to Compare with nothing staged. */
        function twStepReachable(n) {
            if (n <= 1) return true;
            if (n === 2) return !!transferState.strategy;
            if (n === 3) return transferState.activeSlot >= 0 && !!transferState.previewPlayer;
            return transferState.pending.length > 0
                && transferState.pending.every(x => x.replacement);
        }

        function twRailGo(n) {
            if (!twStepReachable(n)) return;
            // Each step owns a mode; walking back has to put the mode back too,
            // or the pane renders step 3's market inside step 2's frame.
            if (n <= 2) {
                transferState.previewPlayer = null;
                transferState.mode = transferState.activeSlot >= 0 ? 'market' : 'squad';
            } else if (n === 3) transferState.mode = 'compare';
            else transferState.mode = 'summary';
            twGoStep(n);
        }

        /* Choosing is the answer, so it is also the way on: picking a plan and
           then confirming the pick with a second button asked the same
           question twice. The rail and the plan chip in the toolbar are how
           you come back and change it. */
        function twChoosePlan(strategy) {
            if (!TW_STRATEGIES.some(x => x.id === strategy)) return;
            twSetStrategy(strategy, { render: false });
            twGoStep(2);
        }

        function twSetStrategy(strategy, opts) {
            if (!TW_STRATEGIES.some(x => x.id === strategy)) return;
            /* Read before the write. Everything below this line needs to know
               whether the plan actually changed, and transferState.strategy is
               about to stop being able to answer that. */
            const wasStrategy = transferState.strategy;
            const switched = wasStrategy !== strategy;
            transferState.strategy = strategy;
            // Both chips waive hits and lift the transfer limit; only the
            // horizon tells them apart.
            transferState.wildcard = strategy === 'wildcard' || strategy === 'freehit';
            transferState.sellMode = strategy !== 'single';
            /* The slots start their search again under the new plan.

               This used to be about the horizon: the filters carried one, and a
               window chosen under another plan could not follow a squad into a
               Free Hit. They do not carry one any more — twfGWs() asks
               twStrategyHorizon() live, so the window is already right without
               this line.

               It stays for what is left in there. A price band and a club list
               chosen while spending one free transfer are the wrong starting
               point for a wildcard with the whole budget open, and for a Free
               Hit squad picked on one gameweek's fixtures. Re-seeding is a
               cheap reset of a search you were going to redo anyway. */
            transferState.pending.forEach(s => { s.funnel = null; });

            /* Changing the plan empties it.

               The number of transfers you get and what they cost is the whole
               question step 1 asks, and the players picked under one answer are
               not the players you would pick under another — going from a
               wildcard to a single transfer left five staged swaps against one
               free move, and going the other way kept a single pick that was
               chosen because it was the only one you could afford.

               Only on an actual switch: re-selecting the plan you are already
               on is not a change and must not throw work away. */
            if (switched && transferState.pending.length) {
                transferState.pending = [];
                transferState.activeSlot = -1;
                transferState.previewPlayer = null;
                transferState.candidateCache = {};
                transferState.mode = 'squad';
            }
            if (!opts || opts.render !== false) renderTWAll();
        }

        // The window a strategy reasons over. Everything else is a five-gameweek
        // commitment; a Free Hit is a one-week rental.
        function twStrategyHorizon() {
            return transferState.strategy === 'freehit' ? 1 : 5;
        }

        // Kept so anything still holding the old entry points keeps working.
        function twToggleWildcard() {
            twSetStrategy(transferState.strategy === 'wildcard' ? 'single' : 'wildcard');
        }

        function twToggleSellMode() {
            twSetStrategy(transferState.sellMode ? 'single' : 'multi');
        }

        // Sell every player in a position (or the whole squad) in one action. Pooling
        // budget across six or eight sales one row at a time is the part of a
        // wildcard that actually wastes time.
        function twSellAll(position) {
            const targets = twSquad().filter(p => position ? p.position === position : true);
            targets.forEach(p => {
                if (transferState.pending.length >= twMaxTransfers()) return;
                if (transferState.pending.some(s => s.soldPlayer.id === p.id)) return;
                transferState.pending.push({ soldPlayer: p, replacement: null });
            });
            transferState.candidateCache = {};
            renderTWAll();
        }

        function twClearPending() {
            transferState.pending = [];
            transferState.activeSlot = -1;
            transferState.mode = 'squad';
            transferState.previewPlayer = null;
            transferState.candidateCache = {};
            renderTWAll();
        }

        /* The recommender and its lineup solve moved to scripts/transfer-engine.js
           so the dashboard can propose a move, not just flag a problem. Loaded
           before this file; the functions stay globals, so every call site here
           is unchanged. */

        function twRunRecommendation() {
            const el = document.getElementById('twRecoBody');
            if (!el) return;
            el.innerHTML = '<div class="twr-loading">Pricing every legal transfer over the next five gameweeks…</div>';
            // Yield once so the loading line paints before the sweep blocks.
            setTimeout(() => {
                let r = null;
                try { r = twBuildRecommendation(); }
                catch (e) { el.innerHTML = `<div class="twr-empty">Could not build a recommendation: ${escHTML(e.message)}</div>`; return; }
                if (!r) { el.innerHTML = '<div class="twr-empty">Load a squad first — there is nothing to compare yet.</div>'; return; }
                twLastRecommendation = r;
                el.innerHTML = renderTWRecommendation(r);
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }, 30);
        }

        /* One option for one transfer slot, outlined on its own.
         *
         * The recommender returns one best move per slot and always did, which
         * is why the same squad kept producing the same two names: it is
         * deterministic, and there is exactly one highest-gain swap. What that
         * hides is that the runners-up are usually a different KIND of move
         * rather than a worse one — the same slot spent on a cheaper player who
         * leaves money for next week, or on a dearer one who uses all of it.
         *
         * So each slot now shows three, and the tag says what separates them:
         * the price gap against the recommended option, which is the decision
         * the manager is actually making. Every figure on every card is that
         * option's own — no card shows the recommended move's numbers. */
        function twrOptionCard(a, chosen, gws, bank, slot) {
            /* Local, so the card can be lifted into a test on its own, and
               because nothing else names these. Only the gap-less case reaches
               them — every other option is labelled by its price difference. */
            const TWR_ALT_LABEL = { best: 'Recommended', cheaper: 'Cheaper', pricier: 'Costs more', next: 'Alternative' };
            const isPick = a.in.id === chosen.in.id;
            const gap = Math.round((a.in.price - chosen.in.price) * 10) / 10;
            let label = TWR_ALT_LABEL[a.altKind] || TWR_ALT_LABEL.next;
            if (isPick) label = TWR_ALT_LABEL.best;
            else if (gap < 0) label = `£${Math.abs(gap).toFixed(1)}m cheaper`;
            else if (gap > 0) label = `£${gap.toFixed(1)}m more`;

            let detail = '';
            if (typeof trRationale === 'function' && typeof trRenderCard === 'function') {
                const rat = trRationale(a, { bank });
                detail = rat ? trRenderCard(rat, { header: false }) : '';
            }

            const cls = a.gain >= 0 ? 'pos' : 'neg';
            const sign = a.gain >= 0 ? '+' : '';

            /* Pickable, and it has to look it. The alternatives read as greyed
               out when they were only unselected, so each one is a button in
               its own right: cursor, hover, keyboard, and a footer that says
               what clicking does. The chosen one says it is the chosen one
               instead, because there is nothing to do to it. */
            const pick = isPick
                ? '<span class="twr-opt-state is-on">In your plan</span>'
                : '<span class="twr-opt-state">Use this one</span>';
            const act = isPick ? '' :
                ` role="button" tabindex="0" onclick="twSelectOption(${slot}, ${a.in.id})"`
                + ` onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();twSelectOption(${slot}, ${a.in.id});}"`;

            return `
                <div class="twr-opt${isPick ? ' is-pick' : ''}"${act}>
                    <span class="twr-opt-tag">${escHTML(label)}</span>
                    <div class="twr-move">
                        <span class="twr-out">${escHTML(a.out.name)}<small>£${(a.out.sellPrice || a.out.price).toFixed(1)}m · ${a.outXP.toFixed(1)} xP</small></span>
                        <span class="twr-arrow">→</span>
                        <span class="twr-in">${escHTML(a.in.name)}<small>£${a.in.price.toFixed(1)}m · ${a.inXP.toFixed(1)} xP</small></span>
                        <span class="twr-gain ${cls}">${sign}${a.gain.toFixed(1)}<small>to your XI</small></span>
                    </div>
                    <p class="twr-why">${escHTML(twMoveReason(a, gws))}</p>
                    ${detail ? `<details class="twr-detail" onclick="event.stopPropagation()">
                        <summary>The case for it</summary>
                        ${detail}
                    </details>` : ''}
                    ${pick}
                </div>`;
        }

        /* Choosing one of the three.
         *
         * The headline above the cards is a figure for the whole set, and the
         * set is not additive — so it is recomputed by the engine's own scorer
         * rather than patched by adding this option's gain and subtracting the
         * last one's. r.rescore closes over the pool the sweep was run against,
         * which is the only place that number can honestly come from.
         *
         * A pair that is fine one at a time can be illegal together: each option
         * was priced against the whole bank, and two from the same club can
         * breach the three-per-club limit jointly. So the set is checked before
         * it is accepted, and refused with a reason rather than silently. */
        function twSelectOption(slot, inId) {
            const r = twLastRecommendation;
            if (!r || !r.best || !r.best.moves || !r.best.moves[slot]) return;

            const current = r.best.moves[slot];
            const alt = (current.alts || []).find(a => a.in.id === inId);
            if (!alt || alt.in.id === current.in.id) return;

            const next = r.best.moves.slice();
            // The alternatives belong to the slot, not to whichever option is
            // showing, so they travel across the swap.
            next[slot] = Object.assign({}, alt, { alts: current.alts });

            if (typeof r.legal === 'function' && !r.legal(next)) {
                updateStatus(`${alt.in.name} will not fit alongside the other move — `
                    + 'not enough money, or too many from one club', 'error');
                return;
            }

            r.best.moves = next;
            if (typeof r.rescore === 'function') {
                r.best.gross = Math.round(r.rescore(next) * 10) / 10;
                r.best.net = Math.round((r.best.gross - r.best.cost) * 10) / 10;
            }

            const el = document.getElementById('twRecoBody');
            if (el) {
                el.innerHTML = renderTWRecommendation(r);
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }
            updateStatus(`Swapped in ${alt.in.name} — the plan below is what the button will load`, 'success');
        }

        function renderTWRecommendation(r) {
            const { best, moves, gws, ft, horizon } = r;
            const span = `GW${gws[0]}–GW${gws[gws.length - 1]}`;
            const sampleNote = r.sample != null && r.sample < 4
                ? `<p class="twr-caveat">Based on ${r.sample} gameweek${r.sample === 1 ? '' : 's'} of this season. Projections lean heavily on position baselines this early, so treat a small edge as noise rather than a signal.</p>`
                : '';

            if (best.n === 0) {
                const nearest = moves[0];
                return `
                    <div class="twr-verdict hold">
                        <div class="twr-verdict-icon">${v2Icon('hand')}</div>
                        <div>
                            <div class="twr-verdict-title">Hold — no transfer worth making</div>
                            <div class="twr-verdict-sub">${r.noLegalMove
                                ? `No legal move is available: everything that would improve the squad is either unaffordable or blocked by the three-players-per-club limit.`
                                : `Nothing on the market beats what you already have by enough to justify the move over ${span}.`}</div>
                        </div>
                    </div>
                    ${nearest ? `<div class="twr-nearest">
                        <span class="twr-nearest-l">Closest thing to a move</span>
                        <div class="twr-move">
                            <span class="twr-out">${escHTML(nearest.out.name)}</span>
                            <span class="twr-arrow">→</span>
                            <span class="twr-in">${escHTML(nearest.in.name)}</span>
                            <span class="twr-gain ${nearest.gain > 0 ? 'pos' : 'neg'}">${nearest.gain >= 0 ? '+' : ''}${nearest.gain.toFixed(1)}<small>to your XI</small></span>
                        </div>
                        <p class="twr-nearest-note">
                            ${nearest.gain <= 0
                                ? 'Every option projects worse than the player you would sell.'
                                : (nearest.outStarts === false && nearest.rawDelta - nearest.gain > 1)
                                ? `On paper that is a ${nearest.rawDelta.toFixed(1)}-point upgrade, but ${escHTML(nearest.out.name)} ${nearest.out.position === 1 ? 'is your reserve keeper and barely plays' : 'sits on your bench'} — so only ${nearest.gain.toFixed(1)} of it reaches your score. Not worth a transfer.`
                                : `A ${nearest.gain.toFixed(1)}-point edge across five gameweeks is inside the model's own error bar. Banking the transfer keeps two available next week.`}
                        </p>
                    </div>` : ''}
                    ${sampleNote}`;
            }

            // FPL does not publish your free-transfer count, so it is replayed from
            // your transfer history. Say so when the history is incomplete rather
            // than stating a number the manager may know to be wrong.
            const ftEst = twFreeTransfersExact() ? '' :
                `<span class="twr-est" title="Estimated: FPL does not publish your free-transfer count, so it is replayed from your transfer history.">est</span>`;
            const hitLine = best.cost > 0
                ? `<span class="twr-cost">−${best.cost} for the hit, on ${ft} free transfer${ft === 1 ? '' : 's'}${ftEst}</span>`
                : `<span class="twr-free">within your ${ft} free transfer${ft === 1 ? '' : 's'}${ftEst}</span>`;

            /* The reasoning behind each move, from transfer-rationale.js.

               Two things the one-line reason cannot carry: how the edge is
               spread across 3/5/8 gameweeks — a move that is strong at three
               and flat at eight is renting a fixture run, not buying a player —
               and whether the incoming player is nailed. Both are already
               computed; they simply never reached the card.

               The bank rolls: FPL applies transfers in sequence, so the money
               left after the first move is what the second one has to spend.
               Passing the opening bank to every move would tell the manager he
               can afford a second upgrade he has already spent the money on.

               All of them start closed. Opening the first was meant to show
               that the rest could be opened, but this panel's job is to give an
               answer, and an answer you have to scroll past three paragraphs to
               re-read is not one. */
            let twrBank = getTWBank();

            return `
                <div class="twr-verdict act">
                    <div class="twr-verdict-icon">${best.n === 1 ? v2Icon('swap') : v2Icon('bolt')}</div>
                    <div>
                        <div class="twr-verdict-title">Make ${best.n} transfer${best.n === 1 ? '' : 's'}</div>
                        <div class="twr-verdict-sub">
                            <strong>+${best.net.toFixed(1)} xP</strong> over ${span}
                            (${best.gross.toFixed(1)} gained, ${hitLine})
                        </div>
                    </div>
                </div>
                <div class="twr-slots">
                    ${best.moves.map((m, i) => {
                        const alts = (m.alts && m.alts.length) ? m.alts : [m];
                        /* Every option in this slot is priced against the bank as
                           it stands BEFORE the slot, because they are alternatives
                           to each other rather than a sequence. The bank then rolls
                           on the recommended one, which is the move the button
                           below actually loads. */
                        const bankHere = twrBank;
                        twrBank = Math.round((twrBank + ((m.out.sellPrice || m.out.price) - m.in.price)) * 10) / 10;
                        return `
                        <div class="twr-slot">
                            <div class="twr-slot-h">Transfer ${i + 1} · ${escHTML(m.out.name)} out — ${alts.length} way${alts.length === 1 ? '' : 's'} to spend it</div>
                            <div class="twr-opts">
                                ${alts.map(a => twrOptionCard(a, m, gws, bankHere, i)).join('')}
                            </div>
                        </div>`;
                    }).join('')}
                </div>
                <button class="twr-apply" onclick="twApplyRecommendation()">Load these into the transfer planner</button>
                ${sampleNote}`;
        }

        // Why this move, in the model's own terms rather than a generic blurb.


        // Drop the recommendation into the planner so it can be reviewed and edited
        // rather than applied blind.
        let twLastRecommendation = null;
        function twApplyRecommendation() {
            const r = twLastRecommendation;
            if (!r || !r.best || !r.best.moves.length) return;
            transferState.pending = r.best.moves.map(m => ({ soldPlayer: m.out, replacement: m.in }));
            transferState.activeSlot = -1;
            transferState.mode = 'squad';
            renderTWAll();
            updateStatus(`Loaded ${r.best.moves.length} recommended transfer${r.best.moves.length === 1 ? '' : 's'} — review before confirming`, 'success');
        }

        /* A move handed over from the dashboard.

           The dashboard runs the same recommender and links here as
           #transfers?out=123&in=456 (repeated for a second move). Arriving with
           the move already in the cart is the difference between "here is a
           problem" and "here is the fix, check it and confirm" — without it the
           manager lands on an empty planner and rebuilds by hand what the
           dashboard had already worked out.

           Ids are validated against the actual squad and player pool, so a stale
           or hand-edited link loads nothing rather than something wrong. */
        function twApplyDeepLink() {
            // Read the stash captured at page load, not the live hash: switchTab
            // rewrites the hash to the bare tab name before this runs.
            const qs = window._pendingDeepLink;
            if (!qs) return false;
            window._pendingDeepLink = null;
            const params = new URLSearchParams(qs);
            const outs = params.getAll('out').map(Number).filter(Boolean);
            const ins = params.getAll('in').map(Number).filter(Boolean);
            if (!outs.length || outs.length !== ins.length) return false;

            const pending = [];
            for (let i = 0; i < outs.length; i++) {
                const soldPlayer = (twSquad() || []).find(p => p.id === outs[i]);
                const replacement = (allPlayers || []).find(p => p.id === ins[i]);
                // Both ends must still be real: the squad changes, and players move.
                if (!soldPlayer || !replacement) return false;
                if (soldPlayer.position !== replacement.position) return false;
                pending.push({ soldPlayer, replacement });
            }

            transferState.pending = pending;
            transferState.activeSlot = -1;
            transferState.mode = 'squad';
            renderTWAll();
            updateStatus(`Loaded ${pending.length} suggested transfer${pending.length === 1 ? '' : 's'} from your dashboard — review before confirming`, 'success');
            return true;
        }

        /* ===== The recommender, and the two plans it cannot answer for =====

           A Wildcard or a Free Hit used to swap this panel for a builder that
           produced three whole squads. That screen is gone, at the manager's
           request, along with the model behind it.

           What cannot go with it is the reason the two panels swapped rather
           than stacked: the recommender prices one move at a time against a
           free-transfer count that both chips waive. On the week you are
           rebuilding fifteen players it does not merely give unhelpful advice,
           it gives false advice — "Hold — no transfer worth making" is wrong
           about a squad you are about to replace entirely. So it stays hidden
           on those two plans, which is what it already did. Nothing takes its
           place: the squad, the market and Fill open slots are the tools for
           that week, and an empty strip says less than a wrong answer does. */
        function twSyncRecoPanel() {
            const reco = document.getElementById('twRecoPanel');
            if (reco) reco.hidden = !!transferState.wildcard;
        }

        function renderTWAll() {
            const step = twStep();
            const box = document.getElementById('twContainer');
            if (box) box.dataset.twStep = String(step);
            renderTWRail();
            twSyncRecoPanel();
            renderTWBudgetBar();
            renderTWSquadPane();
            renderTWMarketPane();
            twPlayStepMove();
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        /* The movement between steps.

           Not a view transition: document.startViewTransition replaces the
           live page with a snapshot for the duration, so a CSS transition
           written inside one never runs. This restarts a keyframe animation on
           the pane that changed instead — clearing it, forcing a reflow so the
           browser registers the removal, then putting it back — which is the
           only reliable way to replay an animation on an element that was just
           re-rendered with the same class it had before.

           Only the right pane moves. The squad on the left is the one thing
           that is true at every step, and sliding it in and out would say the
           opposite. */
        function twPlayStepMove() {
            const dir = transferState._stepDir;
            transferState._stepDir = 0;
            if (!dir) return;
            const pane = document.getElementById('twMarketPane');
            if (!pane) return;
            if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
            pane.classList.remove('tw-move-fwd', 'tw-move-back');
            void pane.offsetWidth;
            pane.classList.add(dir > 0 ? 'tw-move-fwd' : 'tw-move-back');
        }

        function renderTWRail() {
            const el = document.getElementById('twRail');
            if (!el) return;
            const cur = twStep();
            const nodes = TW_STEPS.map(st => {
                /* Done is where you have been, not where you can go back to.
                   Confirming a swap clears the compared player, so gating the
                   tick on reachability made step 4 un-tick itself the moment
                   you finished with it — a step you had just completed showing
                   as one you had never reached. */
                const done = st.n < cur;
                const here = st.n === cur;
                const open = twStepReachable(st.n) && st.n !== cur;
                const cls = here ? 'is-here' : done ? 'is-done' : open ? 'is-open' : 'is-todo';
                const clickable = open;
                /* A step you have not reached is not a button. It is rendered
                   as one either way so the rail keeps one shape, and disabled
                   rather than removed so the count of what is left never
                   changes under you. */
                return `<button class="tw-rail-step ${cls}" ${clickable ? '' : 'disabled'}
                    onclick="twRailGo(${st.n})" aria-current="${here ? 'step' : 'false'}"
                    data-tooltip="${escHTML(st.hint)}">
                    <span class="tw-rail-mark">${done ? v2Icon('check') : v2Icon(st.icon)}</span>
                    <span class="tw-rail-text">
                        <span class="tw-rail-n">Step ${st.n}</span>
                        <span class="tw-rail-l">${escHTML(st.label)}</span>
                    </span>
                </button>`;
            }).join('<span class="tw-rail-link" aria-hidden="true"></span>');

            el.innerHTML = `<nav class="tw-rail" aria-label="Transfer steps">${nodes}</nav>`;
        }

        function getTWBank() {
            return (picksData?.entry_history?.bank || 0) / 10;
        }

        function getTWLiveITB() {
            const bank = getTWBank();
            let sellTotal = 0, buyTotal = 0;
            for (const slot of transferState.pending) {
                sellTotal += slot.soldPlayer.sellPrice || slot.soldPlayer.price;
                if (slot.replacement) buyTotal += slot.replacement.price;
            }
            return bank + sellTotal - buyTotal;
        }

        // Players who cannot be bought right now: everyone still in the squad who
        // is not staged for sale, plus everyone already staged as an incoming.
        function twUnbuyableIds() {
            const soldIds = new Set(transferState.pending.map(s => s.soldPlayer.id));
            const ids = new Set();
            for (const p of twSquad()) if (!soldIds.has(p.id)) ids.add(p.id);
            for (const s of transferState.pending) if (s.replacement) ids.add(s.replacement.id);
            return ids;
        }

        // The floor price for filling a slot of this position — the cheapest player
        // who could legally go into it.
        function twCheapestFor(position, unbuyable) {
            let min = Infinity;
            for (const p of allPlayers) {
                if (p.position !== position) continue;
                if (p.status !== 'a' && p.status !== 'd') continue;
                if (unbuyable && unbuyable.has(p.id)) continue;
                if (p.price < min) min = p.price;
            }
            return Number.isFinite(min) ? min : 4.0;
        }

        // Money that must be held back from this slot so the other unfilled slots
        // can still be filled at all.
        function twReservedFor(slotIdx) {
            const unbuyable = twUnbuyableIds();
            let reserved = 0;
            transferState.pending.forEach((s, i) => {
                if (i === slotIdx || s.replacement) return;
                reserved += twCheapestFor(s.soldPlayer.position, unbuyable);
            });
            return reserved;
        }

        /* What one slot can actually spend.

           getTWLiveITB() pools every staged sale, which is the right number for
           the plan as a whole and the wrong one for a single slot. Stage three
           sales worth £21m and the first slot's market would offer a £14m
           striker — affordable on its own, and leaving two slots that could no
           longer be filled by anybody. Each remaining unfilled slot still needs
           a body in it, so the cheapest legal player for each is reserved before
           this slot is told what it has to spend. */
        function twSlotBudget(slotIdx) {
            const slot = transferState.pending[slotIdx];
            if (!slot) return getTWLiveITB();
            const refund = slot.replacement ? slot.replacement.price : 0;
            return Math.max(0, getTWLiveITB() + refund - twReservedFor(slotIdx));
        }

        // FPL's three-per-club rule, evaluated for one transfer slot: how many
        // players from this club you would hold if that slot were empty. The
        // market has to know about this and not only twConfirmPick(), because an
        // AI pick that Confirm then silently refuses reads as a broken button.
        // Mirrors twConfirmPick()'s own counting exactly — players staged for
        // sale do not count, replacements already chosen in other slots do.
        function twClubCountExcludingSlot(teamId, slotIdx) {
            const soldIds = new Set(transferState.pending.map(s => s.soldPlayer.id));
            let n = 0;
            for (const p of twSquad()) {
                if (soldIds.has(p.id)) continue;
                if (p.teamId === teamId) n++;
            }
            for (let i = 0; i < transferState.pending.length; i++) {
                if (i === slotIdx) continue;
                const repl = transferState.pending[i].replacement;
                if (repl && repl.teamId === teamId) n++;
            }
            return n;
        }

        function twClubBlocked(candidate, slotIdx) {
            return twClubCountExcludingSlot(candidate.teamId, slotIdx) >= 3;
        }

        // Every club that is already full for this slot, as a Set of team ids.
        function twBlockedClubIds(slotIdx) {
            const blocked = new Set();
            for (const tid of Object.keys(teams)) {
                const id = parseInt(tid, 10);
                if (twClubCountExcludingSlot(id, slotIdx) >= 3) blocked.add(id);
            }
            return blocked;
        }

        function getTWHitCost() {
            // A wildcard makes every transfer free — showing accumulated hits during
            // one is the single most misleading thing this screen could do.
            if (transferState.wildcard) return 0;
            const ft = twFreeTransfers();
            const count = transferState.pending.length;
            return Math.max(0, count - ft) * 4;
        }

        function renderTWBudgetBar() {
            const el = document.getElementById('twBudgetBar');
            if (!el) return;
            const itb = getTWLiveITB();
            const hit = getTWHitCost();
            const wc = transferState.wildcard;
            const ft = twFreeTransfers();
            const count = transferState.pending.length;
            const max = twMaxTransfers();
            const filled = transferState.pending.filter(s => s.replacement).length;
            const itbClass = itb < 0 ? 'danger' : itb < 0.5 ? 'warning' : 'success';

            /* One row per staged transfer, always on screen. The market pane only
               ever shows the slot you are working on, so with three swaps staged
               the other two were invisible — you could not see the plan you were
               supposedly planning, or which slot the shrinking bank belonged to. */
            const railGWs = twPlanGWs(3);
            const openCount = transferState.pending.filter(s => !s.replacement).length;
            let planGain = 0;
            const rows = transferState.pending.map((s, i) => {
                const out = s.soldPlayer, inP = s.replacement;
                const budget = twSlotBudget(i);
                const posShort = ['', 'GK', 'DEF', 'MID', 'FWD'][out.position];
                let deltaHtml = '';
                if (inP) {
                    const d = twXPOver(inP, railGWs) - twXPOver(out, railGWs);
                    planGain += d;
                    const cls = d > 0.3 ? 'up' : d < -0.3 ? 'down' : 'flat';
                    deltaHtml = `<span class="twc-plan-delta ${cls}" data-tooltip="Projected across the next ${railGWs.length} gameweeks.">${d > 0 ? '+' : ''}${d.toFixed(1)}</span>`;
                } else {
                    deltaHtml = `<span class="twc-plan-delta pending" data-tooltip="£${budget.toFixed(1)}m available for this slot">£${budget.toFixed(1)}m</span>`;
                }
                return `<div class="twc-plan-row ${inP ? 'done' : 'open'} ${i === transferState.activeSlot ? 'active' : ''}" onclick="twSelectSlot(${i})"
                    data-tooltip="${inP ? escHTML(`${out.name} out, ${inP.name} in`) : escHTML(`${out.name} out — pick a replacement`)}">
                    <span class="twc-plan-n">${i + 1}</span>
                    <span class="twc-plan-pos ${posShort.toLowerCase()}">${posShort}</span>
                    <span class="twc-plan-out">${escHTML(out.name)}</span>
                    <span class="twc-plan-arrow">→</span>
                    <span class="twc-plan-in ${inP ? '' : 'empty'}">${inP ? escHTML(inP.name) : 'Choose…'}</span>
                    ${deltaHtml}
                    <button class="twc-plan-x" onclick="event.stopPropagation();twRemoveSlot(${i})" data-tooltip="Remove this transfer">×</button>
                </div>`;
            }).join('');

            const netGain = planGain - hit;

            /* On a chip the per-move deltas stop being the question — you are
               rebuilding a squad against one budget, and eight rows of "+1.4"
               do not tell you whether the eleven that actually play got better,
               or whether the thing is even legal. Only shown for the chips: on
               a single transfer the move card already says all of this, and a
               strip of squad totals beside one swap is noise. */
            let balance = '';
            if (wc && filled > 0 && typeof solveQuickLineup === 'function') {
                const b = twSquadBalance();
                const xiD = b.xiXP - b.oldXiXP;
                const valD = b.value - b.oldValue;
                const cell = (label, value, cls, tip) =>
                    `<div class="twc-bal-cell" data-tooltip="${escHTML(tip)}">
                        <span class="twc-bal-l">${label}</span>
                        <span class="twc-bal-v ${cls}">${value}</span>
                    </div>`;
                balance = `<div class="twc-bal">
                    ${cell('Starting XI', `${xiD >= 0 ? '+' : ''}${xiD.toFixed(1)} xP`,
                        xiD > 0.3 ? 'up' : xiD < -0.3 ? 'down' : '',
                        `Your best legal eleven from the new squad projects ${b.xiXP.toFixed(1)} points next gameweek, against ${b.oldXiXP.toFixed(1)} from the eleven you would field now.`)}
                    ${cell('Bench', `${b.benchXP.toFixed(1)} xP`, '',
                        'What the four players outside that eleven project next gameweek. A bench that scores is cover; a bench that does not is dead money.')}
                    ${cell('Squad value', `£${b.value.toFixed(1)}m`, valD > 0.05 ? 'up' : valD < -0.05 ? 'down' : '',
                        `${valD >= 0 ? 'Up' : 'Down'} £${Math.abs(valD).toFixed(1)}m on the squad you have now.`)}
                    ${cell('In the bank', `£${itb.toFixed(1)}m`, itb < 0 ? 'down' : '',
                        itb < 0 ? 'This plan spends more than you have.' : 'Left over once every transfer in the plan is made.')}
                    ${!b.legal ? `<div class="twc-bal-warn" data-tooltip="A squad must be 2 goalkeepers, 5 defenders, 5 midfielders and 3 forwards.">Not a legal squad yet — ${b.counts[1]}/2 GK, ${b.counts[2]}/5 DEF, ${b.counts[3]}/5 MID, ${b.counts[4]}/3 FWD</div>` : ''}
                    ${b.overStacked.length ? `<div class="twc-bal-warn" data-tooltip="No more than three players from any one club.">Four or more from ${escHTML(b.overStacked.join(', '))}</div>` : ''}
                </div>`;
            }

            const cart = `<div class="twc-plan-head">
                    <span class="twc-plan-title">Your plan</span>
                    <span class="twc-plan-sum ${netGain > 0.3 ? 'up' : netGain < -0.3 ? 'down' : 'flat'}"
                        data-tooltip="Projected points gained across the next ${railGWs.length} gameweeks from the transfers you have filled in${hit > 0 ? `, after the ${hit}-point hit` : ''}.">
                        ${netGain > 0 ? '+' : ''}${netGain.toFixed(1)} pts${hit > 0 ? ` (after −${hit})` : ''}
                    </span>
                    ${openCount ? `<button class="twc-plan-fill" onclick="twFillAllSlots()" data-tooltip="Pick the best affordable replacement for every open slot, sharing the bank across them.">Fill ${openCount} open slot${openCount === 1 ? '' : 's'}</button>` : ''}
                </div>
                ${balance}
                <div class="twc-plan-rows">${rows}</div>`;

            /* The figures ride the step rail; the staged transfers stay
               below it, where there is room for a row per swap. One render,
               two destinations, so they cannot disagree about the bank. */
            const statsEl = document.getElementById('twStats');
            if (statsEl) statsEl.innerHTML = `
                <div class="twc-head">
                    ${/* "5 / 1 free" reads as a limit — five allowed, one of
                          them free — which is the opposite of what it says.
                          It is five staged, of which one is free. The
                          qualifier spells out what the rest cost rather than
                          leaving the reader to find the hit figure beside it
                          and work out that the two are about the same five. */''}
                    <div class="twc-stat">
                        <span class="twc-stat-l">Transfers</span>
                        <span class="twc-stat-v" data-tooltip="${escHTML(wc
                            ? `Your chip lifts the limit: up to 15 transfers this week and no hits.`
                            : count > ft
                                ? `${count} staged. ${ft} of them ${ft === 1 ? 'is' : 'are'} free; the other ${count - ft} cost 4 points each. You may stage up to ${max} under this plan.`
                                : `${count} staged, out of ${ft} free transfer${ft === 1 ? '' : 's'}. You may stage up to ${max} under this plan.`)}">
                            ${count}<span class="twc-unl">${wc
                                ? 'of 15 · no hits'
                                : count > ft
                                    ? `${ft} free · ${count - ft} at \u22124`
                                    : `${ft} free`}</span></span>
                    </div>
                    <div class="twc-stat">
                        <span class="twc-stat-l">Points hit</span>
                        <span class="twc-stat-v ${hit > 0 ? 'danger' : ''}">${wc ? 'Waived' : hit > 0 ? `−${hit} pts` : '0 pts'}</span>
                    </div>
                    <div class="twc-stat">
                        <span class="twc-stat-l">In the bank</span>
                        <span class="twc-stat-v ${itbClass}">£${itb.toFixed(1)}m</span>
                    </div>
                    ${/* Preview squad is gone. Step 4 is the preview — it puts
                          the squad these transfers leave you with on a pitch,
                          with its value and its projection, which is what this
                          button opened early. A button that jumps you to the
                          end of a four-step flow is a second route to the same
                          place, sitting where the running figures should be. */''}
                </div>`;

            el.innerHTML = filled ? `<div class="twc-plan">${cart}</div>` : '';
        }

        /* ===== Step 2's left column · your squad =====

           Choosing who leaves and choosing who replaces them were two steps,
           and the seam between them kept producing dead ends: pressing Clear
           on the market step left you looking at a squad list you could not
           click, because the thing that made it clickable belonged to the
           step before. They are one step now — your squad on the left, the
           market for whoever is selected on the right — so there is no state
           where the squad is on screen and inert.

           Every player is a card, the way the players being replaced already
           were. The ones not in the plan are dimmed rather than hidden: you
           need to see the whole squad to decide which part of it is the
           problem, but only one of them is what the right-hand side is
           currently answering for. */
        /* What the squad column is built from, as one string.

           Clicking a player used to rebuild all fifteen cards — fifteen <img>
           elements destroyed and recreated — when the only thing that had
           actually changed was which card is selected. The faces, names and
           prices are identical before and after; only three classes and one
           line of text differ. So the markup is rebuilt when the squad itself
           changes and updated in place when it does not, which is every click.

           Cheap to compute and compared as a whole: fifteen ids and prices is
           shorter than one of the cards it saves rendering. */
        function twSquadCardsKey() {
            return twSquad().map(p => `${p.id}:${(p.sellPrice || p.price).toFixed(1)}:${p.status || 'a'}`).join('|');
        }
        let twSquadCardsBuilt = null;

        /* The three things a click actually changes, applied to the cards that
           are already on screen. */
        function twUpdateSquadCardStates(el) {
            const slotOf = id => transferState.pending.findIndex(x => x.soldPlayer.id === id);
            const gws = twPlanGWs(3);
            el.querySelectorAll('.tw-sqc').forEach(node => {
                const id = Number(node.dataset.pid);
                const p = twSquad().find(x => x.id === id);
                if (!p) return;
                const i = slotOf(id);
                const picked = i >= 0;
                const slot = picked ? transferState.pending[i] : null;
                const inP = slot && slot.replacement;
                node.classList.toggle('is-picked', picked);
                node.classList.toggle('is-active', picked && i === transferState.activeSlot);
                node.classList.toggle('is-filled', !!inP);
                node.setAttribute('aria-pressed', String(picked));

                /* The remove button belongs to this updater too.

                   The cards are rebuilt only when the squad itself changes, and
                   picking a player does not change the squad — so everything a
                   click affects has to be applied here. Adding the X to the
                   template alone left it never appearing, because no click ever
                   reached the template. */
                const wantsX = picked && transferState.sellMode;
                let x = node.querySelector('.tw-sqc-x');
                if (wantsX && !x) {
                    x = document.createElement('span');
                    x.className = 'tw-sqc-x';
                    x.setAttribute('role', 'button');
                    x.setAttribute('tabindex', '0');
                    x.textContent = '\u00d7';
                    node.insertBefore(x, node.firstChild);
                }
                if (x && !wantsX) { x.remove(); x = null; }
                if (x) {
                    const label = `Take ${p.name} out of the plan`;
                    x.setAttribute('data-tooltip', label);
                    x.setAttribute('aria-label', label);
                    x.onclick = (ev) => { ev.stopPropagation(); twRemoveSlot(slotOf(id)); };
                    x.onkeydown = (ev) => {
                        if (ev.key !== 'Enter' && ev.key !== ' ') return;
                        ev.preventDefault(); ev.stopPropagation(); twRemoveSlot(slotOf(id));
                    };
                }

                const chip = node.querySelector('.pdm-hero-chip');
                if (chip) {
                    chip.classList.toggle('is-blank', !picked);
                    if (picked) chip.textContent = String(i + 1);
                }

                const state = node.querySelector('.tw-outc-open, .tw-outc-in');
                if (state) {
                    if (inP) {
                        state.className = 'tw-outc-in';
                        state.innerHTML = `${v2Icon('check')} ${escHTML(inP.name)}`;
                    } else {
                        state.className = 'tw-outc-open';
                        state.textContent = picked
                            ? 'Choosing a replacement'
                            : `${twXPOver(p, gws).toFixed(1)} xP next ${gws.length}`;
                    }
                }
            });
            /* And the column's own state: with anything in the plan, the rest
               of the squad drops right back so the picked ones read as a set. */
            el.querySelectorAll('.tw-outc-list').forEach(list =>
                list.classList.toggle('has-picks', transferState.pending.length > 0));

            const hint = el.querySelector('.twc-panel-hint');
            if (hint) {
                const n = transferState.pending.length;
                hint.textContent = n
                    ? `${n}${transferState.sellMode ? ` of ${twMaxTransfers()}` : ''} in the plan`
                    : 'Click anyone to replace them';
            }
        }

        function twRenderSquadCards(el) {
            /* Same squad as last time: nothing here needs rebuilding, and
               rebuilding it is what makes the faces blink. */
            const key = twSquadCardsKey();
            if (twSquadCardsBuilt === key && el.querySelector('.tw-sqc')) {
                twUpdateSquadCardStates(el);
                return;
            }
            twSquadCardsBuilt = key;
            const gws = twPlanGWs(3);
            const slotOf = id => transferState.pending.findIndex(x => x.soldPlayer.id === id);
            const positions = [
                { type: 1, label: 'Goalkeepers' }, { type: 2, label: 'Defenders' },
                { type: 3, label: 'Midfielders' }, { type: 4, label: 'Forwards' }
            ];

            let groups = '';
            positions.forEach(pos => {
                const players = twSquad().filter(p => p.position === pos.type);
                if (!players.length) return;
                const cards = players.map(p => {
                    const i = slotOf(p.id);
                    const picked = i >= 0;
                    const slot = picked ? transferState.pending[i] : null;
                    const active = picked && i === transferState.activeSlot;
                    const inP = slot && slot.replacement;
                    const flag = p.status === 'i' || p.status === 'u' || p.status === 's'
                        ? '<span class="tw-sqc-flag out">OUT</span>'
                        : p.status === 'd' ? `<span class="tw-sqc-flag doubt" data-tooltip="${escHTML(p.news || 'Fitness doubt')}">?</span>` : '';
                    /* The X only exists where a plan can hold more than one
                       player. On a single transfer there is nothing to choose
                       between, so clicking another player is how you change your
                       mind and a remove button would be a second way to do the
                       same thing. */
                    const drop = picked && transferState.sellMode
                        ? `<span class="tw-sqc-x" role="button" tabindex="0"
                            onclick="event.stopPropagation(); twRemoveSlot(${i});"
                            onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();twRemoveSlot(${i});}"
                            data-tooltip="${escHTML(`Take ${p.name} out of the plan`)}" aria-label="${escHTML(`Take ${p.name} out of the plan`)}">\u00d7</span>`
                        : '';
                    return `<button class="tw-outc tw-sqc${picked ? ' is-picked' : ''}${active ? ' is-active' : ''}${inP ? ' is-filled' : ''}"
                        data-pid="${p.id}"
                        onclick="twSquadCardClick(${p.id})"
                        aria-pressed="${picked}"
                        ${/* No tooltip on the card. It said "Choosing a
                              replacement for X" or "Move X on" — a caption for
                              something the card already shows, following the
                              cursor across fifteen players. The X keeps its
                              label, because what it does is not written on it. */''}>
                        ${drop}
                        <!-- The rank chip is always in the markup, hidden until the
                             player is in the plan, so selecting one can reveal it
                             rather than having to rebuild the card to add it. -->
                        <span class="tw-outc-hero">${typeof v2PlayerHeroHTML === 'function'
                            ? v2PlayerHeroHTML({ ...p, price: p.sellPrice || p.price },
                                { size: 'compact', chip: picked ? String(i + 1) : '0',
                                  chipClass: picked ? '' : 'is-blank' })
                            : escHTML(p.name)}</span>
                        <span class="tw-outc-foot">
                            ${inP
                                ? `<span class="tw-outc-in">${v2Icon('check')} ${escHTML(inP.name)}</span>`
                                : picked
                                    ? `<span class="tw-outc-open">Choosing a replacement</span>`
                                    : `<span class="tw-outc-open">${twXPOver(p, gws).toFixed(1)} xP next ${gws.length}</span>`}
                            ${flag}
                            <span class="tw-outc-budget">£${(p.sellPrice || p.price).toFixed(1)}m</span>
                        </span>
                    </button>`;
                }).join('');
                groups += `<div class="tw-sqc-group">
                    <div class="twc-group-head"><span>${pos.label}</span></div>
                    <div class="tw-outc-list${transferState.pending.length ? ' has-picks' : ''}">${cards}</div>
                </div>`;
            });

            const picked = transferState.pending.length;
            const open = transferState.pending.filter(x => !x.replacement).length;
            const max = twMaxTransfers();

            /* The way back to the team FPL says you own.
             *
               Confirming here changes this site and not fantasy.premierleague.com
               — the wizard says so in as many words when you confirm — so a
               manager who confirmed a plan to see what it looked like has no way
               to get their real squad back short of transferring everyone
               again. This is that way back. It is offered only when there is
               something to undo, so it is not a button that does nothing for
               most of the people looking at it. */
            const reverting = typeof twPlan !== 'undefined' && twPlan.length;
            const revertBtn = reverting
                ? `<button class="tw-revert" onclick="twRevertToRealSquad()"
                    aria-label="Undo the confirmed transfers"
                    data-tooltip="Put this squad back to the team you actually have on fantasy.premierleague.com. Transfers you confirmed here changed EasyFPL only, and this undoes ${twPlan.length === 1 ? 'the one' : `all ${twPlan.length}`} of them.">${v2Icon('revert')}</button>`
                : '';

            el.innerHTML = `<div class="twc-panel tw-outrail">
                <div class="twc-panel-head">
                    <span class="twc-panel-title">${v2Icon('users')} Your squad</span>
                    <span class="twc-panel-hint">${picked ? `${picked}${transferState.sellMode ? ` of ${max}` : ''} in the plan` : 'Click anyone to replace them'}</span>
                    ${revertBtn}
                </div>
                <div class="twc-panel-body">
                    ${open > 1 ? `<button class="tw-outrail-fill" onclick="twFillAllSlots()" data-tooltip="Pick the best affordable replacement for every open slot, sharing the bank across them.">${v2Icon('bolt')} Fill all ${open} slots</button>` : ''}
                    ${groups}
                </div>
            </div>`;
        }

        /* One click on a squad card.

           Not in the plan yet → put him in and point the market at him. Already
           the one the market is answering for → take him back out. In the plan
           but not the active one → switch the market to him. On Single there is
           only ever one slot, so a new player replaces the pick rather than
           being refused for exceeding a limit of one. */
        function twSquadCardClick(playerId) {
            const i = transferState.pending.findIndex(x => x.soldPlayer.id === playerId);
            if (i >= 0) {
                /* Clicking a player you have already picked moves the market to
                   him — always. It used to drop him from the plan when he was
                   the one already showing, so the same gesture meant "go here"
                   on one card and "undo" on another, and the difference was
                   invisible until it happened. Dropping is the X, which only
                   exists where more than one player can be picked. */
                if (i !== transferState.activeSlot) twSelectSlot(i);
                return;
            }
            if (!transferState.sellMode) {
                transferState.pending = transferState.pending.filter(x => x.replacement);
            }
            twSwapPlayer(playerId);
        }

        function renderTWSquadPane() {
            const el = document.getElementById('twSquadPane');
            if (!el) return;
            /* Step 1 is the plan and nothing else, so there is no squad to
               build there — and building one into a hidden pane is fifteen
               rows of work per render for something nobody sees. */
            if (twStep() === 1) { el.innerHTML = ''; return; }
            /* On the swap step the squad is a column of cards beside the
               market, not a table of rows. */
            if (twStep() === 2) return twRenderSquadCards(el);
            /* The squad is on screen at every step, but it is only a control at
               some of them. On step 1 no plan has been chosen yet, so there is
               no answer to how many players you may move — Swap is shown and
               inert, with the reason on it, rather than removed. */
            const planStep = twStep() === 1;
            const gws = twPlanGWs(3);
            const filledIds = new Set(transferState.pending.filter(s => s.replacement).map(s => s.soldPlayer.id));
            const pendingIds = new Set(transferState.pending.filter(s => !s.replacement).map(s => s.soldPlayer.id));
            const positions = [
                { type: 1, label: 'Goalkeepers' }, { type: 2, label: 'Defenders' },
                { type: 3, label: 'Midfielders' }, { type: 4, label: 'Forwards' }
            ];

            let rows = '';
            positions.forEach(pos => {
                const players = twSquad().filter(p => p.position === pos.type);
                if (!players.length) return;
                rows += `<div class="twc-group">
                    <div class="twc-group-head">
                        <span>${pos.label}</span>
                        ${transferState.sellMode && !planStep ? `<button class="twc-mini" onclick="twSellAll(${pos.type})" data-tooltip="Sell every ${pos.label.toLowerCase().replace(/s$/, '')} at once and pool the money">Sell all</button>` : ''}
                    </div>
                    <div class="twc-rows">`;
                players.forEach(p => {
                    const sold = filledIds.has(p.id), pending = pendingIds.has(p.id);
                    /* Scored over the same three fixtures shown next to it. This
                       column used to run over the recommender's five-gameweek
                       horizon while the chips beside it showed three, so the
                       number and the context under it disagreed. The gain figures
                       in the replacement views still use the full five — that is
                       the horizon the recommendation is actually decided on, and
                       each is labelled with its own span. */
                    const twRun = typeof xpPlanGWs === 'function' ? xpPlanGWs(XP_PLAN_HORIZON) : gws;
                    const xp = twXPOver(p, twRun);
                    // Three fixtures at a glance is the context that decides a sale.
                    const fx = (teamFixtures[p.teamId] || p.fixtures || []).slice(0, 3);
                    const blocks = fx.length
                        ? fx.map(f => `<span class="twc-fdr v2-fdr-${f.difficulty || 3}" data-tooltip="${f.isHome ? 'Home to' : 'Away at'} ${escHTML(f.opponent || '?')} — FDR ${f.difficulty || 3}">${escHTML((f.opponent || '?').slice(0, 3))}</span>`).join('')
                        : '<span class="twc-fdr twc-fdr-none">—</span>';
                    const status = p.status === 'i' || p.status === 'u' || p.status === 's' ? '<span class="twc-flag out">OUT</span>'
                        : p.status === 'd' ? `<span class="twc-flag doubt" data-tooltip="${escHTML(p.news || 'Fitness doubt')}">?</span>` : '';

                    const twPosEdge = typeof v2PosEdgeClass === 'function' ? v2PosEdgeClass(p.position) : '';
                    const twIdent = { name: p.name, code: p.code, teamId: p.teamId, team: p.team };

                    /* The row is the button.

                       There used to be a 70px Swap button on the right of a
                       1200px row, and the row itself was only clickable under
                       a multi plan — so the same list was operated two
                       different ways depending on a setting three steps
                       earlier. Click anywhere on anyone now, under any plan;
                       picked stays lit until you click it again. */
                    const pickable = !planStep && !sold;
                    rows += `<div class="twc-row ${twPosEdge} ${sold ? 'is-sold' : ''} ${pending ? 'is-picked' : ''} ${pickable ? 'is-pickable' : ''}"
                        ${pickable ? `role="button" tabindex="0" aria-pressed="${pending}"
                            onclick="twRowPick(${p.id})"
                            onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();twRowPick(${p.id});}"
                            data-tooltip="${pending ? escHTML(`${p.name} is in the plan — click to take him back out`) : escHTML(`Move ${p.name} on`)}"` : ''}>
                        ${typeof v2IdentityHTML === 'function' ? v2IdentityHTML(twIdent) : ''}
                        <div class="twc-who">
                            <div class="twc-name">${escHTML(p.name)}${status}</div>
                            <div class="twc-sub">${escHTML(p.team)}</div>
                        </div>
                        <div class="twc-price">£${(p.sellPrice || p.price).toFixed(1)}m</div>
                        <div class="twc-fdrs" data-tooltip="Next three fixtures.">${blocks}</div>
                        <div class="twc-xp" data-tooltip="Projected points across GW${twRun[0]}\u2013GW${twRun[twRun.length - 1]} \u2014 the same three fixtures shown beside it.">${xp.toFixed(1)}<span class="twc-xp-u">xP${twRun.length}</span></div>
                        ${sold ? `<span class="twc-swapped">Swapped</span>`
                            : `<span class="twc-mark" aria-hidden="true">${pending ? v2Icon('check') : ''}</span>`}
                    </div>`;
                });
                rows += `</div></div>`;
            });

            /* How the squad this plan would leave you with sits against the
               tier you are competing against. Here rather than on Squad
               Analysis because the only thing you can do about being too
               template is a transfer, and it reads the pending squad — so the
               numbers move as you stage moves rather than describing a team you
               have already stopped looking at. */
            const eoStrip = typeof renderSquadEO === 'function'
                ? renderSquadEO(typeof twBuildPendingSquad === 'function' ? twBuildPendingSquad() : null)
                : '';

            const open = transferState.pending.filter(x => !x.replacement).length;
            el.innerHTML = `<div class="twc-panel">
                ${twStep() === 2
                    ? twStepHead({
                        icon: 'users', title: 'Who is leaving?',
                        hint: escHTML(twOutStepHint()),
                        back: { label: 'Change plan', on: 'twRailGo(1)' },
                        next: { label: `Find replacement${open === 1 ? '' : 's'}`, on: 'twStartMarketForSlots()',
                                disabled: !open, tip: open ? '' : 'Pick at least one player to move on.' }
                    })
                    : `<div class="twc-panel-head">
                        <span class="twc-panel-title">${v2Icon('users')} Your squad</span>
                        ${planStep ? `<span class="twc-panel-hint">Pick a plan first</span>` : ''}
                    </div>`}
                <div class="twc-panel-body">${rows}</div>
                ${eoStrip}
            </div>`;
        }

        /* One entry point for picking someone out, whatever the plan.

           Single used to go straight to the market on the first click, which
           meant the same list behaved differently depending on a choice made
           two steps earlier — and left no way to change your mind without
           coming back. Every plan collects here now; Find replacements is the
           step forward, and it is in the header where every other step's is. */
        function twRowPick(playerId) {
            if (twStep() !== 2) return;

            /* On Single there is nothing to collect. One player is the whole
               answer to "who leaves", so the click is also the step forward —
               stopping to press Find replacements would be asking a question
               that has already been answered. Every other plan takes a set,
               so it stays here until you say the set is complete. */
            if (!transferState.sellMode) {
                const already = transferState.pending.find(x => x.soldPlayer.id === playerId);
                if (already && !already.replacement) {
                    // Clicking the lit row again takes him back out.
                    twPickOutPlayer(playerId);
                    return;
                }
                // A different player replaces an unfilled pick rather than being refused.
                transferState.pending = transferState.pending.filter(x => x.replacement);
                twSwapPlayer(playerId);
                return;
            }

            twPickOutPlayer(playerId);
        }

        // One click: stage the sale and open the market for that position.
        function twSwapPlayer(playerId) {
            const existing = transferState.pending.findIndex(s => s.soldPlayer.id === playerId);
            if (existing < 0) {
                const player = twSquad().find(p => p.id === playerId);
                if (!player) return;
                if (transferState.pending.length >= twMaxTransfers()) {
                    updateStatus(`That is the maximum of ${twMaxTransfers()} transfers`, 'error');
                    return;
                }
                transferState.pending.push({ soldPlayer: player, replacement: null });
            }
            transferState.activeSlot = transferState.pending.findIndex(s => s.soldPlayer.id === playerId);
            transferState.mode = 'market';
            transferState.previewPlayer = null;
            transferState.candidateCache = {};
            twfState().search = '';
            /* Choosing who leaves and choosing who replaces them are one step
               now — the squad is on the left and the market on the right — so
               this only has to name the slot the market is answering for. */
            twGoStep(2);
        }

        function renderTWMarketPane() {
            const el = document.getElementById('twMarketPane');
            if (!el) return;
            const step = twStep();
            if (step === 1) return twRenderPlanStep(el);
            const mode = transferState.mode;
            if (mode === 'compare' && transferState.previewPlayer && transferState.activeSlot >= 0) return renderTWComparison(el);
            if (mode === 'market' && transferState.activeSlot >= 0) return renderTWMarket(el);
            if (mode === 'summary') return twRenderSummaryPanel(el);

            /* Step 2 with nobody selected. The squad is beside this, so the
               only thing missing is the instruction. */
            el.innerHTML = `<div class="twc-panel tw-step-panel">
                ${twStepHead({
                    icon: 'cart', title: 'Replacements',
                    hint: 'Pick someone on the left'
                })}
                <div class="twc-panel-body">
                    <div class="twc-idle">Click any player in your squad and the replacements you can
                    afford for them appear here, ranked, with the reason each one is worth having.</div>
                </div>
            </div>`;
        }

        /* ===== Step 1 · the plan =====

           These four were a row of chips in the toolbar, sized like a filter
           and captioned only by a tooltip, which is a strange way to ask the
           one question that decides everything after it: how many transfers
           you get and what they cost. Four cards that say so instead. */
        const TW_PLAN_COPY = {
            single:   { icon: 'swap',   what: 'One player out, one in.',
                        moves: '1 transfer', cost: 'Free, then −4 each', span: 'Next 5 GWs',
                        when: 'The normal week. Pick the one move that helps most and bank the rest.' },
            multi:    { icon: 'shuffle', what: 'Several players out at once, sharing one bank.',
                        moves: 'Up to 5', cost: '−4 per extra', span: 'Next 5 GWs',
                        when: 'When two problems have to be fixed together, or one sale pays for another.' },
            wildcard: { icon: 'chip',   what: 'Rebuild the whole squad. No hits.',
                        moves: 'Unlimited', cost: 'No hits', span: 'Next 5 GWs',
                        when: 'You keep this squad, so it is judged over a run of fixtures rather than one week.' },
            freehit:  { icon: 'ticket', what: 'A squad for one gameweek, then you get yours back.',
                        moves: 'Unlimited', cost: 'No hits', span: 'This GW only',
                        when: 'A blank or a double. Nothing beyond Sunday counts, so it is scored over one week.' }
        };

        function twRenderPlanStep(el) {
            const chosen = transferState.strategy;
            const ft = twFreeTransfers();

            const cards = TW_STRATEGIES.map(x => {
                const c = TW_PLAN_COPY[x.id] || {};
                const on = chosen === x.id;
                return `<button class="tw-plan${on ? ' is-on' : ''}" onclick="twChoosePlan('${x.id}')"
                    aria-pressed="${on}">
                    <span class="tw-plan-top">
                        <span class="tw-plan-ico">${v2Icon(c.icon || 'swap')}</span>
                        <span class="tw-plan-name">${escHTML(x.label)}</span>
                        <span class="tw-plan-tick">${v2Icon('check')}</span>
                    </span>
                    <span class="tw-plan-what">${escHTML(c.what || '')}</span>
                    <span class="tw-plan-facts">
                        <span class="tw-plan-fact"><em>Transfers</em><b>${escHTML(c.moves || '')}</b></span>
                        <span class="tw-plan-fact"><em>Cost</em><b>${escHTML(c.cost || '')}</b></span>
                        <span class="tw-plan-fact"><em>Judged over</em><b>${escHTML(c.span || '')}</b></span>
                    </span>
                    <span class="tw-plan-when">${escHTML(c.when || '')}</span>
                </button>`;
            }).join('');

            const chosenLabel = chosen ? (TW_STRATEGIES.find(x => x.id === chosen) || {}).label : '';

            el.innerHTML = `<div class="twc-panel tw-step-panel">
                ${twStepHead({
                    icon: 'sliders', title: 'How are you transferring?',
                    hint: `You have ${ft} free transfer${ft === 1 ? '' : 's'} this week`,
                    next: chosen ? { label: 'Start swapping', on: 'twGoStep(2)', tip: `You are on ${chosenLabel}. Pick another card to change it.` } : null
                })}
                <div class="twc-panel-body">
                    <div class="tw-plans">${cards}</div>
                </div>
            </div>`;
        }

        /* ===== Step 2 · who leaves =====

           Step 2's screen is the squad itself, so what used to be a second
           panel beside it is a footer under it: how many you have picked, the
           way back to the plan, and the way on to the market. The picked
           players themselves are already listed in the plan rail above, at
           every step from here on, so they are not repeated. */
        function twOutStepHint() {
            const multi = transferState.sellMode;
            const picked = transferState.pending;
            const open = picked.filter(x => !x.replacement).length;
            const max = twMaxTransfers();
            return picked.length
                ? `${picked.length}${multi ? ` of ${max}` : ''} picked${open ? `, ${open} still ${open === 1 ? 'needs' : 'need'} a replacement` : ''}`
                : multi
                    ? `Click any player to add them \u2014 up to ${max}`
                    : `Hit Swap on whoever you want to move on`;
        }

        /* The market pane.

           The body of this function used to be two hundred lines of flat list:
           three tabs, four price bands, and a ranked table whose only team
           context was three difficulty chips. It is now a two-step funnel in
           scripts/transfer-funnel.js — narrow by fixture run and player type,
           then pick from what survives — and this stays as the entry point so
           renderTWMarketPane() and the comparison view's fall-back call site
           are both unchanged.

           The guard below is the one thing that cannot move into the funnel:
           it runs before the funnel is asked for anything, and a slot that has
           gone away has to send the pane back to the squad rather than render
           against undefined. */
        function renderTWMarket(el) {
            const slotIdx = transferState.activeSlot;
            if (slotIdx < 0 || !transferState.pending[slotIdx]) {
                renderTWSquadPane();
                return;
            }
            twfRenderMarket(el, slotIdx);
        }

        let _twRadarChart = null;
        let _twFdrChart = null;

        /* ===== Both readings, at the axis they belong to =====
         *
         * A radar says which of two shapes is bigger and never says by how
         * much: you read "Form is further out for him" off two lines crossing
         * a web, and then have nowhere to find the numbers. The axis label was
         * the only text on the chart, and it was the least useful thing that
         * could have been there.
         *
         * So each vertex carries both readings — the out player's and the in
         * player's, each in the colour its stroke already uses — with the axis
         * named underneath in the small grey caps every other label on the site
         * uses. Chart.js cannot do this through pointLabels: it paints a label
         * in one colour, and telling the two apart is the entire job here.
         *
         * Drawn on afterDraw so the text sits over the fills rather than under
         * them, and positioned by pushing out along the axis from the centre —
         * the same geometry the scale uses, so it cannot drift out of step with
         * the web it is labelling.
         */
        const TW_RADAR_OUT_PAD = 21;   // px beyond the outer ring
        /* A canvas does not resolve CSS custom properties, so ctx.font cannot
           be given var(--font-display) — it silently falls back to the default
           serif and the numbers come out looking like a different site. The
           family is read off the document once instead, which keeps it honest
           if the token ever changes. */
        function twRadarFont(weight, size) {
            let family = '';
            try { family = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim(); }
            catch (e) { /* no computed style */ }
            return `${weight} ${size}px ${family || 'system-ui, sans-serif'}`;
        }

        function twRadarVertexLabels(cfg) {
            return {
                id: 'twRadarVertexLabels',
                afterDraw(chart) {
                    const scale = chart.scales && chart.scales.r;
                    if (!scale || !cfg || !cfg.labels) return;
                    const ctx = chart.ctx;
                    const n = cfg.labels.length;
                    const radius = scale.drawingArea + TW_RADAR_OUT_PAD;
                    const pct = v => String(Math.round(Math.max(0, Math.min(1, v || 0)) * 100));

                    ctx.save();
                    ctx.textBaseline = 'middle';
                    for (let i = 0; i < n; i++) {
                        const key = cfg.labels[i];
                        /* getPointPosition works in the scale's own angle space,
                           so the first axis points up and the rest follow the
                           web exactly. */
                        const at = scale.getPointPosition(i, radius);
                        /* Which side of the chart the vertex is on decides how
                           the pair is anchored, so nothing runs off the canvas:
                           left-hand vertices hang their text to the left, right-
                           hand ones to the right, and the top and bottom centre.
                           A vertex within a tenth of the middle counts as
                           centred — at five axes that is the one at the top. */
                        const dx = at.x - scale.xCenter;
                        const side = Math.abs(dx) < scale.drawingArea * 0.12 ? 0 : (dx > 0 ? 1 : -1);

                        const av = pct(cfg.a[key]), bv = pct(cfg.b[key]);
                        ctx.font = twRadarFont(700, 13);
                        const wa = ctx.measureText(av).width;
                        const wb = ctx.measureText(bv).width;
                        const gap = 7;
                        const total = wa + gap + wb;
                        const startX = side === 0 ? at.x - total / 2
                            : side > 0 ? at.x
                            : at.x - total;

                        ctx.textAlign = 'left';
                        ctx.fillStyle = cfg.aInk;
                        ctx.fillText(av, startX, at.y - 7);
                        ctx.fillStyle = cfg.bInk;
                        ctx.fillText(bv, startX + wa + gap, at.y - 7);

                        ctx.font = twRadarFont(800, 8.5);
                        ctx.fillStyle = cfg.labelInk;
                        ctx.textAlign = side === 0 ? 'center' : side > 0 ? 'left' : 'right';
                        const lx = side === 0 ? at.x : side > 0 ? startX : startX + total;
                        ctx.fillText(String(key).toUpperCase(), lx, at.y + 8);
                    }
                    ctx.restore();
                }
            };
        }

        // Normalised 0-1 so five different units can share one radar. Each axis is
        // divided by a strong-but-attainable value rather than by the pair's own max,
        // which would make the weaker of two poor players look elite.
        function twRadarAxes(p) {
            const per90 = typeof regressedPer90 === 'function' ? regressedPer90(p) : { xg90: 0, xa90: 0 };
            const mins = typeof expectedMinutesModel === 'function' ? expectedMinutesModel(p) : { pStart: 0 };
            const games = typeof computePlayerGamesPlayed === 'function' ? computePlayerGamesPlayed(p) : 1;
            const form = isPreseason ? (p.ppg || 0) : (parseFloat(p.form) || 0);
            return {
                'Goal threat': Math.min(1, per90.xg90 / 0.6),
                'Assist threat': Math.min(1, per90.xa90 / 0.4),
                'Bonus': Math.min(1, ((p.bonus || 0) / Math.max(games, 1)) / 1.2),
                'Minutes': mins.pStart,
                'Form': Math.min(1, form / 8)
            };
        }

        /* ===== Pairing the two profiles, row for row =====

           The two full profiles were two independent stacks in a two-column
           grid, so each section began wherever the one above it happened to
           end. Season Numbers sat level with Upcoming Fixtures, and the
           columns drifted further apart the further down you read — which is
           the opposite of what a comparison is for.

           Aligning them by INDEX would be wrong, and worse than the drift.
           Concerns and Positives are only emitted when there are any, and the
           sold player's profile carries a recommendation the candidate's does
           not, so the nth section on the left is routinely not the nth on the
           right. Index alignment would line "Concerns" up against "Positives"
           and look deliberate about it.

           So they pair by identity. Each section is keyed on its own title,
           normalised — the trailing count in "Concerns (3)" and everything
           after the dash in "Season Numbers — Attacking" are per-player and
           come off — and one grid row holds the two cells with the same key.
           Row height is the taller of the two, which is what locks the levels.
           A section only one of them has gets a row with a stated blank.

           Read out of the DOM rather than off the string. buildPlayerFullProfileHTML
           returns one block of HTML and splitting that with a regular
           expression would be a parser written badly; the browser has one. */
        function twSectionKey(text) {
            return String(text || '')
                .replace(/\(\d+\)\s*$/, '')      // Concerns (3)
                .split(/[\u2014\u2013]/)[0]        // Season Numbers — Attacking
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();
        }

        /* One profile, flattened into keyed blocks in the order it renders.

           Returns null rather than a partial answer if the shape is not what
           it expects. That guard is the point: if the profile grows a section
           outside a .pd-group, pairing would silently drop it, and a
           comparison quietly missing a section is worse than one whose
           columns do not line up. The caller falls back to the old layout. */
        function twProfileBlocks(html) {
            if (!html || typeof document === 'undefined' || !document.createElement) return null;
            const box = document.createElement('div');
            box.innerHTML = html;
            if (!box.querySelectorAll) return null;

            const blocks = [];
            const groups = box.querySelectorAll('.pd-group');
            if (!groups || !groups.length) return null;

            let counted = 0;
            for (const group of groups) {
                const gTitle = group.querySelector('.pd-group-title');
                if (gTitle) {
                    blocks.push({ key: 'group:' + twSectionKey(gTitle.textContent), html: gTitle.outerHTML, head: true });
                }
                for (const sec of group.querySelectorAll('.detail-section')) {
                    // Only the group's own sections, never one nested inside another.
                    if (sec.parentElement !== group) continue;
                    const t = sec.querySelector('.detail-section-title');
                    blocks.push({ key: 'sec:' + (twSectionKey(t && t.textContent) || String(counted)), html: sec.outerHTML });
                    counted++;
                }
            }

            // Every section the profile produced has to have been placed.
            const total = box.querySelectorAll('.detail-section').length;
            if (counted !== total) return null;
            return blocks;
        }

        function twPairedProfilesHTML(outHTML, inHTML, sold, cand) {
            const a = twProfileBlocks(outHTML);
            const b = twProfileBlocks(inHTML);
            if (!a || !b) return null;

            // Queued per key so a profile carrying the same key twice pairs
            // them in the order they appeared rather than reusing one.
            const right = new Map();
            b.forEach(x => {
                if (!right.has(x.key)) right.set(x.key, []);
                right.get(x.key).push(x);
            });

            const blank = (name) => `<div class="twh-pair-cell is-blank">Nothing under this heading for ${escHTML(name)}.</div>`;
            const cell = (block, side) => `<div class="twh-pair-cell ${side}${block.head ? ' is-head' : ''}">${block.html}</div>`;

            let rows = '';
            for (const left of a) {
                const queue = right.get(left.key);
                const match = queue && queue.length ? queue.shift() : null;
                rows += cell(left, 'out') + (match ? cell(match, 'in') : blank(cand.name));
            }
            // Anything the candidate has that the sold player does not, kept in
            // its own order at the end rather than dropped.
            for (const leftover of b) {
                const queue = right.get(leftover.key);
                if (!queue || !queue.includes(leftover)) continue;
                queue.splice(queue.indexOf(leftover), 1);
                rows += blank(sold.name) + cell(leftover, 'in');
            }

            return `<div class="twh-pair">
                <div class="twh-pair-head out">OUT \u00b7 ${escHTML(sold.name)}</div>
                <div class="twh-pair-head in">IN \u00b7 ${escHTML(cand.name)}</div>
                ${rows}
            </div>`;
        }

        function renderTWComparison(el) {
            const slotIdx = transferState.activeSlot;
            const slot = transferState.pending[slotIdx];
            if (!slot || !transferState.previewPlayer) { renderTWMarket(el); return; }

            const sold = slot.soldPlayer;
            const cand = transferState.previewPlayer;
            const planGWs = twPlanGWs(3);
            const fdrGWs = twPlanGWs(5);
            const soldXP = twXPOver(sold, planGWs);
            const candXP = twXPOver(cand, planGWs);
            const delta = candXP - soldXP;
            const itb = twSlotBudget(slotIdx);
            const reserved = twReservedFor(slotIdx);
            const affordable = cand.price <= itb + 0.001;
            const clubFull = twClubBlocked(cand, slotIdx);
            // Reserved money is not a preference — it is the cheapest body each
            // other open slot needs. Spending it here leaves those slots
            // unfillable, so the way out is to drop a slot, not to overspend.
            const strandsOthers = !affordable && reserved > 0
                && cand.price <= getTWLiveITB() + (slot.replacement ? slot.replacement.price : 0) + 0.001;
            const blockedReason = strandsOthers
                ? `£${reserved.toFixed(1)}m is reserved to fill your other open slots, leaving £${itb.toFixed(1)}m here — remove a slot to free it`
                : !affordable
                    ? `£${cand.price.toFixed(1)}m is outside the £${itb.toFixed(1)}m this slot has`
                    : clubFull
                        ? `You already hold three players from ${escHTML(cand.team || 'that club')}`
                        : '';

            const seasonS = getPlayerSeasonPer90(sold), seasonC = getPlayerSeasonPer90(cand);
            const statsS = getPositionStats(sold, seasonS, getPlayerRecentStats(sold.id, 6));
            const statsC = getPositionStats(cand, seasonC, getPlayerRecentStats(cand.id, 6));

        /* One measure, drawn as a tug of war rather than printed as two numbers
           either side of a label.

           It was seven rows of grey: figure, label, figure, with the better one
           in green. That tells you who wins each line and nothing about by how
           much — 7.5 against 7.2 and 0.32 against 0.65 looked the same, when
           one is a rounding error and the other is double. The bar is split by
           the two values' share of their total, so the size of the difference
           is the size of the difference, and each half is filled in its own
           club's colour, which is how a player is identified everywhere else on
           this site.

           Percentages and prices arrive as strings ("96%", "£6.1m") because the
           same row prints them; parsed back to numbers for the split and shown
           as given. */
            const row = (label, a, b, higherBetter, tip) => {
                const na = parseFloat(String(a).replace(/[^0-9.-]/g, '')) || 0;
                const nb = parseFloat(String(b).replace(/[^0-9.-]/g, '')) || 0;
                const eq = Math.abs(na - nb) < 0.005;
                const aWins = eq ? false : (higherBetter ? na > nb : na < nb);
                /* Share of the pair, floored so a zero still shows a sliver and
                   the row never reads as a single solid bar belonging to nobody.
                   Both zero splits it evenly — there is nothing to separate. */
                const sum = Math.abs(na) + Math.abs(nb);
                const pa = sum > 0 ? Math.max(6, Math.min(94, (Math.abs(na) / sum) * 100)) : 50;
                return `<div class="twh-row${eq ? ' is-level' : aWins ? ' a-wins' : ' b-wins'}"
                    ${tip ? `data-tooltip="${escHTML(tip)}"` : ''}>
                    <div class="twh-a ${aWins ? 'win' : ''}">${a}</div>
                    <div class="twh-bar">
                        <span class="twh-bar-a" style="width:${pa.toFixed(1)}%"></span>
                        <span class="twh-bar-b" style="width:${(100 - pa).toFixed(1)}%"></span>
                        <span class="twh-l">${label}</span>
                    </div>
                    <div class="twh-b ${!eq && !aWins ? 'win' : ''}">${b}</div>
                </div>`;
            };

            const mS = typeof expectedMinutesModel === 'function' ? expectedMinutesModel(sold) : { pStart: 0 };
            const mC = typeof expectedMinutesModel === 'function' ? expectedMinutesModel(cand) : { pStart: 0 };
            const formS = isPreseason ? (sold.ppg || 0) : (parseFloat(sold.form) || 0);
            const formC = isPreseason ? (cand.ppg || 0) : (parseFloat(cand.form) || 0);

            // The bottom line, stated first.
            const verdict = clubFull
                ? { cls: 'bad', text: `You already hold three players from ${escHTML(cand.team || 'that club')}, so ${escHTML(cand.name)} cannot be added — FPL caps it at three. Sell one of them first.` }
                : strandsOthers
                ? { cls: 'bad', text: `${escHTML(cand.name)} fits your total bank but not this slot — £${reserved.toFixed(1)}m is held back to fill your other open transfers, leaving £${itb.toFixed(1)}m here. Drop one of those slots and he becomes affordable.` }
                : !affordable
                ? { cls: 'bad', text: `You cannot afford ${escHTML(cand.name)} — £${cand.price.toFixed(1)}m against £${itb.toFixed(1)}m available.` }
                : delta > 0.3
                    ? { cls: 'good', text: `Recommended. ${escHTML(cand.name)} projects <strong>+${delta.toFixed(1)} points</strong> more than ${escHTML(sold.name)} over the next ${planGWs.length} gameweeks${getTWHitCost() > 0 && !transferState.wildcard ? `, before the ${getTWHitCost()}-point hit this plan carries` : ''}.` }
                    : delta < -0.3
                        ? { cls: 'bad', text: `Not recommended. ${escHTML(cand.name)} projects <strong>${delta.toFixed(1)} points</strong> against ${escHTML(sold.name)} over the next ${planGWs.length} gameweeks.` }
                        : { cls: 'flat', text: `Close call — about ${Math.abs(delta).toFixed(1)} points between them over the next ${planGWs.length} gameweeks. Not worth a hit on projection alone.` };

            let statRows = '';
            for (let i = 0; i < Math.min(statsS.length, statsC.length); i++) {
                const nameMatch = /<abbr[^>]*>(.*?)<\/abbr>/.exec(statsS[i].label);
                const tipMatch = /title="([^"]*)"/.exec(statsS[i].label);
                statRows += row(nameMatch ? nameMatch[1] : statsS[i].label, statsS[i].season, statsC[i].season, statsS[i].higherBetter !== false, tipMatch ? tipMatch[1] : '');
            }

            /* Full-depth profile per player — the same price watch, team
               context, season numbers and opponent-form sections the Squad
               Analysis card shows, reused here so "comparing two players"
               means the same thing everywhere on this page.

               The candidate never had analyzePlayer() run on them, since they
               are not in your squad, so getPlayerAnalysis() runs it fresh.
               Their recommendation box and replacement suggestions are
               squad-decision language — "transfer out before GW6" — which
               makes no sense about someone you are deciding whether to buy, so
               both are off for that side only.

               aiReport is off for both, and that is not a removal: the two
               scouting reports are lifted out and set beside each other above,
               where prose about one player can actually be read against prose
               about the other. Leaving them inside the columns put them a
               screen apart. */
            const hasProfile = typeof buildPlayerFullProfileHTML === 'function' && typeof getPlayerAnalysis === 'function';
            const soldAnalysis = hasProfile ? getPlayerAnalysis(sold) : null;
            const candAnalysis = hasProfile ? getPlayerAnalysis(cand) : null;
            const soldProfile = hasProfile
                ? buildPlayerFullProfileHTML(sold, soldAnalysis, { header: false, aiReport: false, replacements: false, context: 'squad' })
                : '';
            const candProfile = hasProfile
                ? buildPlayerFullProfileHTML(cand, candAnalysis, { header: false, aiReport: false, recommendation: false, replacements: false, context: 'candidate' })
                : '';

            /* The scouting reports, side by side.

               This is the part of the comparison that reads like an argument
               rather than a table, and it is what the manager asked to see
               more of. gwPlayerReportLine adds what each of them did in the
               round just played, which every other number here is too
               aggregated to carry. */
            const scoutCol = (p, analysis, ctxName, tag, tagCls) => {
                if (!analysis || typeof buildPlayerNarrativeReport !== 'function') return '';
                const gwLine = typeof gwPlayerReportLine === 'function' && typeof gwReviewTarget === 'function'
                    ? gwPlayerReportLine(p, gwReviewTarget()) : '';
                return `<div class="twh-scout-col ${tagCls}">
                    <div class="twh-scout-head"><span class="twh-scout-tag ${tagCls}">${tag}</span>${escHTML(p.name)}</div>
                    ${gwLine}
                    <p class="twh-scout-text">${escHTML(buildPlayerNarrativeReport(p, analysis, ctxName))}</p>
                </div>`;
            };
            const scoutOut = scoutCol(sold, soldAnalysis, 'squad', 'Out', 'out');
            const scoutIn = scoutCol(cand, candAnalysis, 'candidate', 'In', 'in');
            const scouting = (scoutOut || scoutIn)
                ? `<div class="twh-scout">
                    <div class="twh-scout-title">${v2Icon('sparkle')} Scout's take on each of them</div>
                    <div class="twh-scout-cols">${scoutOut}${scoutIn}</div>
                </div>`
                : '';

            const blocked = !!blockedReason;
            el.innerHTML = `<div class="twc-panel">
                <!-- "Calafiori vs Guéhi" is what the two cards below say, in
                     their clubs' colours with their faces on them. Saying it
                     again in 13px grey above them is the same sentence twice,
                     and it was crowding the only two controls on this screen
                     that go anywhere. -->
                ${twStepHead({
                    icon: 'scales', title: 'Compare',
                    back: { label: 'Go back to Replacements', on: 'twBackToMarket()', tip: 'Back to the replacement list' },
                    next: { label: `Confirm ${cand.name}`, on: 'twConfirmPick()',
                            disabled: blocked, tip: blockedReason || `Put ${cand.name} in for ${sold.name}.` }
                })}
                ${(() => { const sw = twSlotSwitcherHTML(); return sw ? `<div class="tw-slotsw-row">${sw}</div>` : ''; })()}
                <div class="twc-panel-body">
                    <div class="twh-verdict ${verdict.cls}">
                        <span class="twh-verdict-delta">${delta > 0 ? '▲ +' : delta < 0 ? '▼ ' : '±'}${Math.abs(delta) < 0.05 ? '0.0' : delta.toFixed(1)}</span>
                        <span class="twh-verdict-text">${verdict.text}</span>
                    </div>

                    <!-- The two of them as cards, in their clubs' colours, the
                         same hero the player modal and the rivals page use. Two
                         grey boxes with a name in them was the one place on the
                         site where a player did not look like himself. -->
                    <div class="twh-heads">
                        <div class="twh-head out">${typeof v2PlayerHeroHTML === 'function'
                            ? v2PlayerHeroHTML({ ...sold, price: sold.sellPrice || sold.price },
                                { size: 'compact', chip: 'Out', chipClass: 'is-out' })
                            : ''}</div>
                        <div class="twh-head-vs">vs</div>
                        <div class="twh-head in">${typeof v2PlayerHeroHTML === 'function'
                            ? v2PlayerHeroHTML(cand, { size: 'compact', chip: 'In', chipClass: 'is-in' })
                            : ''}</div>
                    </div>

                    <div class="twh-radar">
                        <div class="twh-radar-keys">
                            <span class="twh-radar-key out"><i></i>${escHTML(sold.name)}</span>
                            <span class="twh-radar-key-vs">vs</span>
                            <span class="twh-radar-key in"><i></i>${escHTML(cand.name)}</span>
                        </div>
                        <div class="twh-chart is-radar"><canvas id="twRadarCanvas"></canvas></div>
                    </div>
                    <div class="twh-chart-note">Each axis is scaled 0\u2013100 against a strong benchmark, not against each other — two weak players do not both look elite.</div>

                    ${/* No club colours on this bar. It was the obvious idea and
                          it fails on the most ordinary pairing there is: half
                          the league wears red, so Brentford against Bournemouth
                          drew two red halves and the split vanished. The clubs
                          are already named and coloured on the two cards
                          directly above. Down here the only question is which
                          side a measure falls, so the colours say out and in —
                          slate for the player leaving, the brand for the one
                          arriving — and they are the same two colours on every
                          row and every comparison. */''}
                    <div class="twh-grid">
                        ${row(`Projected (${planGWs.length} GWs)`, soldXP.toFixed(1), candXP.toFixed(1), true, 'Projected points over the same upcoming gameweeks for both.')}
                        ${row('Form', formS.toFixed(1), formC.toFixed(1), true, isPreseason ? 'Points per game last season.' : 'Average points over the last 30 days.')}
                        ${row('Chance of starting', Math.round(mS.pStart * 100) + '%', Math.round(mC.pStart * 100) + '%', true, 'Likelihood of starting, from minutes per appearance and fitness.')}
                        ${row('Price', '£' + (sold.sellPrice || sold.price).toFixed(1) + 'm', '£' + cand.price.toFixed(1) + 'm', false, 'Selling price against buying price.')}
                        ${statRows}
                    </div>

                    <div class="twh-chart"><canvas id="twFdrCanvas"></canvas></div>
                    <div class="twh-chart-note">Fixture difficulty over the next ${fdrGWs.length} gameweeks — lower is easier. A gap means no fixture.</div>

                    ${scouting}

                    <!-- Everything below is the whole of both player cards —
                         two price histories, two stat blocks, two fixture
                         lists. It spent a while behind a toggle, closed by
                         default, on the theory that it was a wall for anyone
                         who had already decided. But nobody arrives at a
                         comparison having decided — that is what makes it a
                         comparison — and what the toggle actually did was hide
                         the evidence and leave five stat rows standing in for
                         it. Open, and paired heading by heading.

                         The two-column fallback below is what renders if
                         twPairedProfilesHTML cannot account for every section
                         it found. Unaligned is a worse comparison; missing a
                         section is a wrong one. -->
                    ${twPairedProfilesHTML(soldProfile, candProfile, sold, cand) || `
                    <div class="twh-deep">
                        <div class="twh-deep-col out">
                            <div class="twh-deep-col-head out">OUT · ${escHTML(sold.name)}</div>
                            ${soldProfile}
                        </div>
                        <div class="twh-deep-col in">
                            <div class="twh-deep-col-head in">IN · ${escHTML(cand.name)}</div>
                            ${candProfile}
                        </div>
                    </div>`}

                </div>
            </div>`;

            twDrawComparisonCharts(sold, cand, fdrGWs);
        }

        /* Chart.js comes from a CDN, and a CDN is a thing that can be blocked —
           by an extension, a corporate proxy, or a bad minute. Returning early
           left the reserved chart box and its caption on screen as a tall
           empty rectangle explaining a picture that was never drawn. Take both
           away instead: .twh-radar as well as the canvases, since it is the
           panel around the radar and hiding only its contents left a bordered
           box with two name pills and nothing between them. */
        function twHideComparisonCharts() {
            document.querySelectorAll('.twh-radar, .twh-chart, .twh-chart-note').forEach(n => { n.hidden = true; });
        }

        function twDrawComparisonCharts(sold, cand, fdrGWs) {
            /* Chart.js comes from a CDN, and a CDN is a thing that can be
               blocked — by an extension, a corporate proxy, or a bad minute.
               Returning early left the reserved chart box and its caption on
               screen as a tall empty rectangle explaining a picture that was
               never drawn. Take both away instead. */
            if (typeof Chart === 'undefined') {
                /* Ask for it first. Chart.js is fetched on demand now, so the
                   common case here is simply "not yet" rather than "blocked" —
                   and drawing an empty box for a library nobody had requested
                   would be the page giving up before it had tried. */
                if (typeof loadChartJs === 'function') {
                    loadChartJs().then(ok => { if (ok) twDrawComparisonCharts(sold, cand, fdrGWs); else twHideComparisonCharts(); });
                    return;
                }
                twHideComparisonCharts();
                return;
            }
            if (_twRadarChart) { _twRadarChart.destroy(); _twRadarChart = null; }
            if (_twFdrChart) { _twFdrChart.destroy(); _twFdrChart = null; }
            if (typeof applyChartDefaults === 'function') applyChartDefaults();

            const radar = document.getElementById('twRadarCanvas');
            if (radar) {
                const aS = twRadarAxes(sold), aC = twRadarAxes(cand);
                const labels = Object.keys(aS);
                /* Two thin strokes over a faint web, with both readings printed
                   at the axis they belong to.
                 *
                 * The default radar draws a circular grid at full contrast, a
                 * heavy stroke and a 22% fill, and then repeats the two names in
                 * a legend under it — five decorated rings competing with the
                 * two shapes that are the whole point. The shape carries the
                 * comparison and everything else gets out of its way: the web
                 * is a polygon at 8% so it reads as graph paper, the fills drop
                 * to a tint, and the legend is gone because the names are in
                 * the keys above, each beside its own colour.
                 *
                 * The numbers are drawn by twRadarVertexLabels below rather than
                 * by pointLabels. Chart.js paints a point label in one colour,
                 * and the thing worth printing here is two readings that have to
                 * be told apart — which is exactly the colour the strokes
                 * already carry. */
                const ink = (v) => (getComputedStyle(document.documentElement).getPropertyValue(v) || '').trim();
                /* The fill is the stroke at 13%, built from whatever the token
                   currently is — the dark theme's primary is a different green
                   from the light one, and a hard-coded rgba would have been the
                   light green tinting a dark panel. */
                const tint = (hex, alpha) => {
                    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
                    if (!m) return `rgba(0, 220, 130, ${alpha})`;
                    const n = parseInt(m[1], 16);
                    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
                };
                const OUT_INK = '#94A3B8';
                const IN_INK = ink('--color-primary') || '#00DC82';
                /* Not --border-default: at 8% black it is invisible on the
                   panel this sits on, and a radar with no web is five numbers
                   floating around two outlines. A neutral slate at a quarter
                   reads as graph paper on either theme. */
                const GRID_INK = 'rgba(148, 163, 184, .30)';
                const LABEL_INK = ink('--text-muted') || '#6B7280';

                _twRadarChart = new Chart(radar.getContext('2d'), {
                    type: 'radar',
                    data: {
                        labels,
                        datasets: [
                            { label: sold.name, data: labels.map(k => aS[k]), borderColor: OUT_INK,
                              backgroundColor: 'rgba(148,163,184,.13)', pointBackgroundColor: OUT_INK,
                              borderWidth: 1.75, pointRadius: 2.5, pointHoverRadius: 4, pointBorderWidth: 0, tension: 0 },
                            { label: cand.name, data: labels.map(k => aC[k]), borderColor: IN_INK,
                              backgroundColor: tint(IN_INK, 0.13), pointBackgroundColor: IN_INK,
                              borderWidth: 1.75, pointRadius: 2.5, pointHoverRadius: 4, pointBorderWidth: 0, tension: 0 }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        /* Room for the readings, which sit outside the web. */
                        layout: { padding: { top: 34, bottom: 34, left: 52, right: 52 } },
                        scales: {
                            r: {
                                min: 0, max: 1,
                                /* Five rings, not the ten Chart.js picks for a
                                   0-1 axis. Ten on a 300px chart is a moiré the
                                   two shapes have to be read through. */
                                ticks: { display: false, backdropColor: 'transparent', stepSize: 0.2 },
                                grid: { circular: false, color: GRID_INK, lineWidth: 1 },
                                angleLines: { color: GRID_INK, lineWidth: 1 },
                                pointLabels: { display: false }
                            }
                        },
                        plugins: { legend: { display: false }, tooltip: { enabled: false } }
                    },
                    plugins: [twRadarVertexLabels({ labels, a: aS, b: aC, aInk: OUT_INK, bInk: IN_INK, labelInk: LABEL_INK })]
                });
            }

            const fdrEl = document.getElementById('twFdrCanvas');
            if (fdrEl) {
                const fdrFor = (p, gw) => {
                    const f = (teamFixtures6[p.teamId] || []).filter(x => x.event === gw);
                    if (!f.length) return null;
                    return f.reduce((s, x) => s + (x.difficulty || 3), 0) / f.length;
                };
                _twFdrChart = new Chart(fdrEl.getContext('2d'), {
                    type: 'bar',
                    data: {
                        labels: fdrGWs.map(g => 'GW' + g),
                        datasets: [
                            { label: sold.name, data: fdrGWs.map(g => fdrFor(sold, g)), backgroundColor: '#94a3b8' },
                            { label: cand.name, data: fdrGWs.map(g => fdrFor(cand, g)), backgroundColor: 'rgba(0,220,130,.85)' }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        scales: { y: { min: 0, max: 5, ticks: { stepSize: 1, font: { size: 9 } } }, x: { ticks: { font: { size: 9 } } } },
                        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } }
                    }
                });
            }
        }

        // The squad these transfers would actually leave you with. On a wildcard you
        // are eight moves deep and a list of pending swaps stops telling you whether
        // the thing still works — whether it picks a legal eleven, and what it costs.
        function twBuildPendingSquad() {
            const outIds = new Set(transferState.pending.filter(s => s.replacement).map(s => s.soldPlayer.id));
            const kept = twSquad().filter(p => !outIds.has(p.id));
            const incoming = transferState.pending.filter(s => s.replacement).map(s => ({
                ...s.replacement, sellPrice: s.replacement.price, isIncoming: true
            }));
            return kept.concat(incoming);
        }

        function twOpenPreview() {
            const body = document.getElementById('twPreviewBody');
            if (!body) return;
            body.innerHTML = renderTWPreviewModal();
            document.getElementById('twPreviewOverlay').classList.add('show');
        }

        function twClosePreview(event) {
            if (event && event.target !== event.currentTarget) return;
            const el = document.getElementById('twPreviewOverlay');
            if (el) el.classList.remove('show');
        }

        /* The shape of the squad these transfers would leave you with.

           On a wildcard the individual "+2.1 vs the man he replaces" stops
           being the question. You are rebuilding fifteen players against one
           budget, and what matters is whether the eleven that actually play got
           better, whether the bench can cover, and whether the thing is still
           legal. Those are squad facts, and until now they lived only inside
           the preview modal — two clicks away from the screen where the squad
           was being built.

           Shared with that modal rather than recomputed, so the rail and the
           preview can never quote different numbers for the same squad. */
        function twSquadBalance() {
            const squad = twBuildPendingSquad();

            // Pick the best legal eleven from the new squad so the projection is
            // what you would actually field, not the sum of all fifteen.
            // Selection runs on the next-3-GW total rather than this single
            // fixture — a squad remade by several transfers should be judged on
            // the run it sets up, not on which gets lucky this week.
            const pool = squad.map(p => ({ ...p, pos: p.position,
                lwScore: typeof xpNext3 === 'function' ? xpNext3(p) : predictedGWPoints(p) }));
            const solved = typeof solveQuickLineup === 'function' ? solveQuickLineup(pool) : null;
            const xiIds = new Set((solved?.xi || []).map(p => p.id));
            const xi = squad.filter(p => xiIds.has(p.id));
            const bench = squad.filter(p => !xiIds.has(p.id));

            const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
            squad.forEach(p => { counts[p.position] = (counts[p.position] || 0) + 1; });
            const byTeam = {};
            squad.forEach(p => { byTeam[p.teamId] = (byTeam[p.teamId] || 0) + 1; });
            const oldXI = twSquad().filter(p => !p.onBench);

            return {
                squad, xi, bench, counts,
                // The shape that eleven actually plays, for the preview modal.
                formation: solved && solved.formation ? solved.formation : null,
                value: squad.reduce((s, p) => s + p.price, 0),
                oldValue: twSquad().reduce((s, p) => s + p.price, 0),
                xiXP: xi.reduce((s, p) => s + predictedGWPoints(p), 0),
                oldXiXP: oldXI.reduce((s, p) => s + predictedGWPoints(p), 0),
                benchXP: bench.reduce((s, p) => s + predictedGWPoints(p), 0),
                overStacked: Object.keys(byTeam).filter(t => byTeam[t] > 3).map(t => teams[t]?.short_name || '?'),
                legal: counts[1] === 2 && counts[2] === 5 && counts[3] === 5 && counts[4] === 3
            };
        }

        /* ===== Step 4's pitch =====

           The squad these transfers would leave you with, arranged by hand.

           It could not reuse the one on Squad Analysis. That pitch reads
           analysisResults — your CURRENT squad, scored by analyzePlayer() at
           load — and the players you are buying have no entry in it. Reusing
           it would not have thrown; computeProjectedTotalFor() skips ids it
           cannot find, so every incoming player would have been worth exactly
           zero and the total would have looked like a disaster. So this keeps
           its own arrangement over twBuildPendingSquad().

           What it does share is the rule: isValidFormation() decides what is
           legal here and on every other pitch in the app. One definition of a
           legal eleven, or two screens disagree about whether 3-4-3 is a team.

           The armband is deliberately not here. Captaincy is a one-gameweek
           call on a squad you have not bought yet, the Lineup Wizard owns it,
           and a second place to set it is a second answer to the same
           question. */
        let twOvXI = null;          // Set of player ids, or null before the first build
        let twOvBench = [];         // ordered ids — substitute priority
        let twOvPick = null;        // id held mid-swap, or null
        let twOvKey = '';           // the plan this arrangement was built for

        // Which plan the arrangement belongs to. Staging another transfer has to
        // rebuild it, or a player you just sold stays on the pitch.
        function twOvPlanKey() {
            /* The confirmed plan belongs in the key as much as the staged one.
               Without it, confirming empties `pending` and the key goes back to
               the empty string it had before anything was staged — so an
               arrangement built for the old squad was kept over a squad that had
               changed underneath it, and the players who had just arrived were
               not in it. */
            const confirmed = (typeof twPlan !== 'undefined' ? twPlan : [])
                .map(m => `${m.outId}>${m.inId}`).join(',');
            const staged = transferState.pending
                .map(s => `${s.soldPlayer.id}>${s.replacement ? s.replacement.id : '0'}`).join('|');
            return `${confirmed}#${staged}`;
        }

        /* Is the arrangement we are holding a team you could actually field?
         *
           The key above catches the squad changing. This catches everything
           else: an id that is no longer in the squad, a count that is not
           eleven, two keepers. Nothing should be able to produce those — the
           solver picks one keeper and twOvLegal refuses any swap that would
           add a second — but this pitch is the last thing between a bad
           arrangement and a manager reading it as their team, and rebuilding
           from the solver is free. Cheap to check, and it cannot be wrong in
           the direction that matters. */
        function twOvArrangementOK(squad) {
            if (!twOvXI || twOvXI.size !== 11) return false;
            const xi = squad.filter(p => twOvXI.has(p.id));
            if (xi.length !== 11) return false;
            const n = pos => xi.filter(p => p.position === pos).length;
            return n(1) === 1 && n(2) >= 3 && n(3) >= 2 && n(4) >= 1;
        }

        function twOvSyncIfNeeded() {
            const key = twOvPlanKey();
            const squad = twOvSquad();
            if (twOvXI && key === twOvKey && twOvArrangementOK(squad)) return;
            const bal = twSquadBalance();
            twOvXI = new Set(bal.xi.map(p => p.id));
            twOvBench = bal.bench.map(p => p.id);
            twOvPick = null;
            twOvKey = key;
        }

        function twOvSquad() {
            return twBuildPendingSquad();
        }

        function twOvLegal(aId, bId) {
            if (aId == null || bId == null || aId === bId) return false;
            const aIn = twOvXI.has(aId), bIn = twOvXI.has(bId);
            // Both benched: reordering who comes on first is always allowed.
            if (!aIn && !bIn) return true;
            // Both starting: nothing on the pitch would change.
            if (aIn && bIn) return false;
            const simulated = twOvSquad().map(p => ({
                position: p.position,
                onBench: p.id === aId ? aIn : p.id === bId ? bIn : !twOvXI.has(p.id)
            }));
            return typeof isValidFormation === 'function' ? isValidFormation(simulated) : false;
        }

        function twOvClick(playerId) {
            twOvSyncIfNeeded();
            if (twOvPick === null) { twOvPick = playerId; renderTWMarketPane(); return; }
            if (twOvPick === playerId) { twOvPick = null; renderTWMarketPane(); return; }

            const a = twOvPick, b = playerId;
            if (!twOvLegal(a, b)) {
                updateStatus('That swap would leave an illegal formation — a team needs one keeper, three defenders, two midfielders and a forward', 'error');
                twOvPick = null;
                renderTWMarketPane();
                return;
            }

            const aIn = twOvXI.has(a), bIn = twOvXI.has(b);
            if (aIn === bIn) {
                const i = twOvBench.indexOf(a), j = twOvBench.indexOf(b);
                if (i > -1 && j > -1) { const t = twOvBench[i]; twOvBench[i] = twOvBench[j]; twOvBench[j] = t; }
            } else if (aIn) {
                twOvXI.delete(a); twOvXI.add(b);
                twOvBench[twOvBench.indexOf(b)] = a;
            } else {
                twOvXI.delete(b); twOvXI.add(a);
                twOvBench[twOvBench.indexOf(a)] = b;
            }
            twOvPick = null;
            renderTWMarketPane();
        }

        // Back to the eleven the solver picked, for anyone who has moved three
        // players around and wants the model's answer again.
        function twOvReset() {
            twOvXI = null;
            twOvSyncIfNeeded();
            renderTWMarketPane();
        }

        /* Every projection on this pitch is one gameweek, and says so. The
           three-gameweek numbers everywhere else in the wizard are about
           whether a transfer is worth making; this is about which eleven of
           the fifteen you would field, which is a question about Saturday. */
        function twOvRenderPitch() {
            twOvSyncIfNeeded();
            const squad = twOvSquad();
            const byId = new Map(squad.map(p => [p.id, p]));
            const xi = squad.filter(p => twOvXI.has(p.id));
            const bench = twOvBench.map(id => byId.get(id)).filter(Boolean);
            const gw = (twPlanGWs(1)[0]) || currentGW;

            const xiXP = xi.reduce((t, p) => t + predictedGWPoints(p), 0);
            const benchXP = bench.reduce((t, p) => t + predictedGWPoints(p), 0);
            const counts = { 2: 0, 3: 0, 4: 0 };
            xi.forEach(p => { if (counts[p.position] != null) counts[p.position]++; });
            const shape = `${counts[2]}-${counts[3]}-${counts[4]}`;

            const card = (p, benchIdx) => {
                const posClass = `pos-${(typeof V2_POS_CLASS !== 'undefined' && V2_POS_CLASS[p.position]) || 'mid'}`;
                const ident = { name: p.name, code: p.code, teamId: p.teamId, team: p.team };
                const fx = (teamFixtures[p.teamId] || p.fixtures || [])[0];
                const picked = twOvPick === p.id;
                // A held player marks every legal partner, so the second click
                // is never a guess that ends in an error message.
                const target = twOvPick !== null && !picked && twOvLegal(twOvPick, p.id);
                return `<div class="dp-card twov-card ${posClass}${p.isIncoming ? ' twov-in' : ''}${picked ? ' is-picked' : ''}${target ? ' is-target' : ''}"
                    role="button" tabindex="0" aria-pressed="${picked}"
                    onclick="twOvClick(${p.id})"
                    onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();twOvClick(${p.id});}"
                    data-tooltip="${escHTML(picked ? `${p.name} is held — click whoever should change places with him`
                        : twOvPick !== null ? (target ? `Swap with ${byId.get(twOvPick).name}` : `${p.name} cannot change places with ${byId.get(twOvPick).name}`)
                        : `${p.name} — click to move him`)}">
                    ${benchIdx != null ? `<span class="twov-sub">${benchIdx + 1}</span>` : ''}
                    ${p.isIncoming ? '<div class="dp-badges"><span class="dp-badge in">IN</span></div>' : ''}
                    ${typeof v2IdentityHTML === 'function' ? v2IdentityHTML(ident, 'v2-pid-pitch') : ''}
                    <div class="dp-name">${escHTML(p.name)}</div>
                    <div class="dp-score" data-tooltip="Projected points for ${escHTML(p.name)} in GW${gw}."><b>${predictedGWPoints(p).toFixed(1)}</b><span class="u">xP</span></div>
                    <div class="dp-fixtures">${fx
                        ? `<span class="dp-fix fdr-${fx.difficulty || 3}" data-tooltip="${fx.isHome ? 'Home to' : 'Away at'} ${escHTML(fx.opponent || '?')} — FDR ${fx.difficulty || 3}">${escHTML(fx.opponent || '?')} <span class="dp-fix-ha">(${fx.isHome ? 'H' : 'A'})</span></span>`
                        : '<span class="dp-fix dp-fix-blank" data-tooltip="No fixture this gameweek.">Blank</span>'}</div>
                </div>`;
            };
            const rowFor = n => `<div class="dp-row">${xi.filter(p => p.position === n).map(p => card(p, null)).join('')}</div>`;

            /* The three figures as chips and the action as a pill, which is
               how the dashboard states a number beside a way through. Best
               eleven was an .rc-btn, and .rc-btn carries flex: 1 — so in this
               header it stretched into a full-width grey bar that read as a
               section divider rather than as something to press. */
            return `<div class="twov">
                <div class="twov-head">
                    <div class="twov-nums">
                        <span class="twov-num lead" data-tooltip="Projected points for this eleven in GW${gw}. Move anyone and it moves with them.">
                            <b>${xiXP.toFixed(1)}</b><em>xP, this eleven</em></span>
                        <span class="twov-num dim" data-tooltip="What the four outside the eleven project. A bench that scores is cover; one that does not is dead money.">
                            <b>${benchXP.toFixed(1)}</b><em>on the bench</em></span>
                        <span class="twov-num dim" data-tooltip="The shape this eleven plays."><b>${shape}</b><em>shape</em></span>
                    </div>
                    <button class="twov-best" onclick="twOvReset()" data-tooltip="Go back to the strongest legal eleven from this squad.">Best eleven ${v2Icon('refresh')}</button>
                </div>
                <div class="twov-hint">Click a player, then click whoever should change places with him. The armband is set in the Lineup Wizard once the transfers are in.</div>
                <div class="dp-pitch-card"><div class="dp-pitch">
                    ${rowFor(4)}${rowFor(3)}${rowFor(2)}${rowFor(1)}
                </div></div>
                <div class="dp-bench">
                    <div class="dp-bench-label">Bench \u2014 in the order they would come on</div>
                    <div class="dp-bench-row">${bench.map((p, i) => card(p, i)).join('')}</div>
                </div>
            </div>`;
        }

        function renderTWPreviewModal() {
            const gws = twPlanGWs(1);
            const gw = gws[0] || currentGW;

            const bal = twSquadBalance();
            const { squad, xi, bench, counts } = bal;
            const newValue = bal.value, oldValue = bal.oldValue;
            const newXP = bal.xiXP, oldXP = bal.oldXiXP;
            const overStacked = bal.overStacked;
            const squadLegal = bal.legal;
            const hit = getTWHitCost();
            const xpDelta = newXP - oldXP - hit;

            /* The pitch every other screen draws — the dashboard's card,
               face and crest above the name with the projection on its own
               line beneath. This preview was the last place still rendering
               a player as a name over two lines of text on a plain grey
               tile, which made the one screen whose whole job is "what does
               this squad look like" the one that looked like nothing else. */
            const card = p => {
                const posClass = `pos-${(typeof V2_POS_CLASS !== 'undefined' && V2_POS_CLASS[p.position]) || 'mid'}`;
                const ident = { name: p.name, code: p.code, teamId: p.teamId, team: p.team };
                const fx = (teamFixtures[p.teamId] || p.fixtures || [])[0];
                return `<div class="dp-card ${posClass}${p.isIncoming ? ' twp-in-card' : ''}">
                    ${p.isIncoming ? '<div class="dp-badges"><span class="dp-badge in">IN</span></div>' : ''}
                    ${typeof v2IdentityHTML === 'function' ? v2IdentityHTML(ident, 'v2-pid-pitch') : ''}
                    <div class="dp-name">${escHTML(p.name)}</div>
                    <div class="dp-score" data-tooltip="Projected points for ${escHTML(p.name)} in GW${gw}."><b>${predictedGWPoints(p).toFixed(1)}</b><span class="u">xP</span></div>
                    <div class="dp-fixtures">${fx
                        ? `<span class="dp-fix fdr-${fx.difficulty || 3}" data-tooltip="${fx.isHome ? 'Home to' : 'Away at'} ${escHTML(fx.opponent || '?')} — FDR ${fx.difficulty || 3}">${escHTML(fx.opponent || '?')} <span class="dp-fix-ha">(${fx.isHome ? 'H' : 'A'})</span></span>`
                        : '<span class="dp-fix dp-fix-blank" data-tooltip="No fixture this gameweek.">Blank</span>'}</div>
                </div>`;
            };
            const rowFor = n => `<div class="dp-row">${xi.filter(p => p.position === n).map(card).join('')}</div>`;

            return `<div class="detail-section">
                <div class="twp-stats">
                    <div class="twp-stat"><div class="twp-stat-v">${bal.formation || '—'}</div><div class="twp-stat-l" data-tooltip="The best legal shape this squad can field.">Formation</div></div>
                    <div class="twp-stat"><div class="twp-stat-v">£${newValue.toFixed(1)}m</div><div class="twp-stat-l" data-tooltip="Squad value after these transfers. Was £${oldValue.toFixed(1)}m.">Squad value</div></div>
                    <div class="twp-stat"><div class="twp-stat-v">£${getTWLiveITB().toFixed(1)}m</div><div class="twp-stat-l" data-tooltip="Money left over once every pending transfer is paid for.">Bank left</div></div>
                    <div class="twp-stat"><div class="twp-stat-v ${xpDelta > 0 ? 'good' : xpDelta < 0 ? 'bad' : ''}">${xpDelta > 0 ? '+' : ''}${xpDelta.toFixed(1)}</div>
                        <div class="twp-stat-l" data-tooltip="Projected points for the new eleven (${newXP.toFixed(1)}) against your current one (${oldXP.toFixed(1)})${hit > 0 ? `, after the ${hit}-point hit` : ''}.">xP change</div></div>
                </div>

                ${!squadLegal ? `<div class="twp-warn">This is not a legal squad yet — FPL needs 2 keepers, 5 defenders, 5 midfielders and 3 forwards. You have ${counts[1]}/${counts[2]}/${counts[3]}/${counts[4]}.</div>` : ''}
                ${overStacked.length ? `<div class="twp-warn">More than three players from ${escHTML(overStacked.join(', '))} — FPL does not allow it.</div>` : ''}
                ${getTWLiveITB() < 0 ? `<div class="twp-warn">You are £${Math.abs(getTWLiveITB()).toFixed(1)}m over budget.</div>` : ''}

                <div class="dp-pitch-card"><div class="dp-pitch">
                    ${rowFor(4)}${rowFor(3)}${rowFor(2)}${rowFor(1)}
                </div></div>
                <div class="dp-bench">
                    <div class="dp-bench-label">Bench</div>
                    <div class="dp-bench-row">${bench.map(card).join('')}</div>
                </div>
            </div>`;
        }

        // ===== Transfer Control Room — Actions =====

        function twPickOutPlayer(playerId) {
            const player = twSquad().find(p => p.id === playerId);
            if (!player) return;

            const existingIdx = transferState.pending.findIndex(s => s.soldPlayer.id === playerId);
            if (existingIdx >= 0) {
                if (!transferState.pending[existingIdx].replacement) {
                    transferState.pending.splice(existingIdx, 1);
                    transferState.candidateCache = {};
                    if (transferState.activeSlot >= transferState.pending.length) {
                        transferState.activeSlot = Math.max(-1, transferState.pending.length - 1);
                    }
                }
            } else {
                if (transferState.pending.length >= twMaxTransfers()) {
                    updateStatus(`That is the maximum of ${twMaxTransfers()} transfers`, 'error');
                    return;
                }
                transferState.pending.push({ soldPlayer: player, replacement: null });
            }
            renderTWAll();
        }

        function twAddTransferSlot() {
            transferState.mode = 'squad';
            transferState.activeSlot = -1;
            transferState.previewPlayer = null;
            renderTWAll();
        }

        function twStartMarketForSlots() {
            const idx = transferState.pending.findIndex(s => !s.replacement);
            if (idx < 0) return;
            transferState.activeSlot = idx;
            transferState.mode = 'market';
            transferState.previewPlayer = null;
            transferState.candidateCache = {};
            twfState().search = '';
            twGoStep(2);
        }

        /* Which of the staged transfers you are working on.

           The replacement list used to be headed "Replacements for Egan",
           which named the slot but could not change it: switching meant
           scrolling up to the plan cart and clicking a row there. The name is
           gone and this is in its place — the same control, at the point of
           use, on the screen that is actually about that player.

           Single is excluded on purpose. One transfer is one slot, and a
           dropdown offering a choice of one is a control that does nothing. So
           is a plan with only one slot staged under any other chip. */
        /* The "Replacing <name> → <name>" dropdown is gone.

           It was a second list of the transfers you had staged, in a control,
           beside a squad column that was already showing all of them — and it
           described switching between them as picking from a menu when the
           obvious gesture is to click the player. The squad column does the
           whole job now: the ones you picked stand out, clicking one moves the
           market to it, and each carries its own X to drop it.

           Kept as a function returning nothing so the two callers that ask for
           it keep working; they render nothing where it used to be. */
        function twSlotSwitcherHTML() {
            return '';
        }

        function twSlotSwitcherHTMLUnused() {
            if (transferState.strategy === 'single') return '';
            const slots = transferState.pending;
            if (slots.length < 2) return '';
            const gws = twPlanGWs(3);
            const opts = slots.map((slot, i) => {
                const out = slot.soldPlayer, inP = slot.replacement;
                const d = inP ? twXPOver(inP, gws) - twXPOver(out, gws) : null;
                const label = `${out.name} → ${inP ? `${inP.name} (${d > 0 ? '+' : ''}${d.toFixed(1)})` : 'Choose\u2026'}`;
                return `<option value="${i}"${i === transferState.activeSlot ? ' selected' : ''}>${escHTML(label)}</option>`;
            }).join('');
            const open = slots.filter(x => !x.replacement).length;
            return `<label class="tw-slotsw" data-tooltip="Every transfer in this plan. Switching restores the search you left on that one.">
                <span class="tw-slotsw-l">Replacing</span>
                <select class="tw-slotsw-sel" onchange="twSelectSlot(Number(this.value))"
                    aria-label="Which transfer to work on">${opts}</select>
                <span class="tw-slotsw-n">${open ? `${open} still open` : 'all filled'}</span>
            </label>`;
        }

        /* Clicking a row of the plan bar.
         *
         * What that should do depends on where you are and whether the slot is
         * filled. On Compare, with more than one transfer staged, the rows are
         * how you read across the plan — so a filled one switches which pair is
         * being compared rather than throwing you back to the market. Going
         * back to step 2 from there meant the only way to see the other
         * comparison was to re-pick a replacement you had already chosen.
         *
         * An unfilled slot has no comparison to show, so it still goes to the
         * market: that is the one thing left to do with it. */
        function twSelectSlot(idx) {
            if (idx < 0 || idx >= transferState.pending.length) return;
            const slot = transferState.pending[idx];
            if (slot.replacement && twStep() === 3) {
                transferState.activeSlot = idx;
                transferState.mode = 'compare';
                transferState.previewPlayer = slot.replacement;
                renderTWAll();
                return;
            }
            transferState.activeSlot = idx;
            transferState.mode = 'market';
            transferState.previewPlayer = null;
            twGoStep(2);
        }

        /* ===== Back to the squad FPL says you own =====
         *
         * A confirmed plan lives in twPlan and nowhere else — selectedPlayers is
         * left exactly as FPL handed it over — so putting the squad back is
         * dropping the plan, and nothing has to be re-fetched or un-swapped.
         *
         * The staged transfers go too. They name players out of twSquad(), which
         * is about to be a different set, and a slot pointing at somebody who is
         * no longer in the squad is a slot that cannot be filled or removed. */
        function twRevertToRealSquad() {
            const had = (typeof twPlan !== 'undefined' && twPlan.length) || 0;
            if (!had) return;
            if (typeof twConfirmedClear === 'function') twConfirmedClear();
            twPlan = [];
            twConfirmedResult = null;
            transferState.pending = [];
            transferState.activeSlot = -1;
            transferState.previewPlayer = null;
            transferState.candidateCache = {};
            transferState.mode = 'squad';
            twSquadCardsBuilt = null;
            transferRendered = false;
            if (typeof updateStatus === 'function') {
                updateStatus(`${had} confirmed transfer${had === 1 ? '' : 's'} undone \u2014 back to the squad FPL says you own`, 'success');
            }
            /* Steps 3 and 4 are about a plan that no longer exists. Step 2 still
               makes sense on any squad, so a revert made from there stays put. */
            twGoStep(twStep() >= 3 ? 2 : twStep());
        }

        function twRemoveSlot(idx) {
            if (idx < 0 || idx >= transferState.pending.length) return;
            transferState.pending.splice(idx, 1);
            transferState.candidateCache = {};
            if (transferState.activeSlot >= transferState.pending.length) {
                transferState.activeSlot = transferState.pending.length - 1;
            }
            if (transferState.pending.length === 0) {
                transferState.mode = 'squad';
                transferState.activeSlot = -1;
            }
            renderTWAll();
        }

        function twPreviewPlayer(playerId) {
            const candidates = Object.values(transferState.candidateCache).flat();
            let candidate = candidates.find(c => c.id === playerId);
            if (!candidate) candidate = allPlayers.find(p => p.id === playerId);
            if (!candidate) return;
            transferState.previewPlayer = candidate;
            transferState.mode = 'compare';
            twGoStep(3);
        }

        function twBackToMarket() {
            transferState.previewPlayer = null;
            transferState.mode = 'market';
            twGoStep(2);
        }

        function twBackToSquad() {
            transferState.mode = 'squad';
            transferState.activeSlot = -1;
            transferState.previewPlayer = null;
            twGoStep(2);
        }

        function twConfirmPick() {
            const slotIdx = transferState.activeSlot;
            if (slotIdx < 0 || !transferState.previewPlayer) return;
            const candidate = transferState.previewPlayer;
            const slot = transferState.pending[slotIdx];
            const slotBudget = twSlotBudget(slotIdx);
            const reserved = twReservedFor(slotIdx);

            // Every rejection below used to be a bare `return`, which left an
            // enabled button doing nothing at all. Each one now says why.
            if (candidate.position !== slot.soldPlayer.position) {
                updateStatus(`${candidate.name} is a ${['', 'goalkeeper', 'defender', 'midfielder', 'forward'][candidate.position] || 'different position'} — this slot replaces ${slot.soldPlayer.name}`, 'error');
                return;
            }
            if (candidate.price > slotBudget + 0.01) {
                updateStatus(reserved > 0
                    ? `${candidate.name} costs £${candidate.price.toFixed(1)}m but this slot has £${slotBudget.toFixed(1)}m — £${reserved.toFixed(1)}m is reserved to fill your other open slots. Remove one to free it.`
                    : `${candidate.name} costs £${candidate.price.toFixed(1)}m and this slot has £${slotBudget.toFixed(1)}m available`, 'error');
                return;
            }
            if (twClubBlocked(candidate, slotIdx)) {
                updateStatus(`You would have four players from ${candidate.team || 'that club'} — FPL allows three. Sell one of them first.`, 'error');
                return;
            }

            slot.replacement = candidate;
            transferState.previewPlayer = null;
            transferState.candidateCache = {};

            /* Confirming one swap is not the end of the process unless it was
               the last open slot. With another still empty this goes back to
               its market rather than to a summary of a plan with a hole in it;
               with none left the only thing remaining is to confirm the lot. */
            const nextUnfilled = transferState.pending.findIndex(s => !s.replacement);
            if (nextUnfilled >= 0) {
                transferState.activeSlot = nextUnfilled;
                transferState.mode = 'market';
                twGoStep(2);
            } else {
                transferState.mode = 'summary';
                transferState.activeSlot = -1;
                twGoStep(4);
            }
        }

        /* Fill every open slot at once, sharing one bank between them.

           Greedy, and deliberately so: each round scores the best affordable
           candidate for every open slot and commits only the single strongest
           pair, then re-prices the rest. That ordering matters — the money goes
           to the biggest upgrade first rather than to whichever slot happens to
           be at the top of the list. It is safe against stranding because every
           quote comes from twSlotBudget(), which has already reserved the
           cheapest body for each slot still waiting, so no round can spend a
           later slot out of existence.

           xpOver() is uncached and this asks for a few hundred projections per
           round, so the per-player results are memoised for the run. */
        function twFillAllSlots() {
            const gws = twPlanGWs(3);
            const xpCache = new Map();
            const xpOf = p => {
                if (!xpCache.has(p.id)) xpCache.set(p.id, twXPOver(p, gws));
                return xpCache.get(p.id);
            };

            let filled = 0;
            // Bounded by the slot count; the guard is only there so a scoring
            // change can never turn this into an infinite loop.
            for (let round = 0; round < twMaxTransfers() + 1; round++) {
                const open = transferState.pending
                    .map((s, i) => (s.replacement ? -1 : i)).filter(i => i >= 0);
                if (!open.length) break;

                const unbuyable = twUnbuyableIds();
                let best = null;
                for (const i of open) {
                    const out = transferState.pending[i].soldPlayer;
                    const budget = twSlotBudget(i);
                    const blocked = twBlockedClubIds(i);
                    const outXP = xpOf(out);
                    for (const c of allPlayers) {
                        if (c.position !== out.position) continue;
                        if (c.price > budget + 0.001) continue;
                        if (unbuyable.has(c.id)) continue;
                        if (blocked.has(c.teamId)) continue;
                        if (c.status !== 'a' && c.status !== 'd') continue;
                        if (c.minutes < minMinutesForCandidate()) continue;
                        const gain = xpOf(c) - outXP;
                        if (!best || gain > best.gain) best = { slotIdx: i, cand: c, gain };
                    }
                }
                // Nothing legal for any remaining slot — the bank is too thin or
                // every option is club-blocked. Leave them open rather than
                // forcing something through.
                if (!best) break;
                transferState.pending[best.slotIdx].replacement = best.cand;
                filled++;
            }

            transferState.candidateCache = {};
            const stillOpen = transferState.pending.filter(s => !s.replacement).length;
            if (!filled) {
                updateStatus('No affordable replacement found for the open slots — free up funds or drop a slot', 'error');
            } else {
                updateStatus(`Filled ${filled} slot${filled === 1 ? '' : 's'}${stillOpen ? ` — ${stillOpen} still open` : ''}`, 'success');
            }

            /* Land on the first slot still needing attention, or on the
               confirmation once nothing does. It used to fall back to mode
               'squad', which on step 3 is not a screen — the left column kept
               its cards and the right half of the page went blank, with the
               step rail still saying you were choosing replacements you had
               just finished choosing. */
            transferState.previewPlayer = null;
            const nextOpen = transferState.pending.findIndex(s => !s.replacement);
            if (nextOpen >= 0) {
                transferState.activeSlot = nextOpen;
                transferState.mode = 'market';
                twGoStep(2);
            } else {
                transferState.mode = 'summary';
                transferState.activeSlot = -1;
                twGoStep(4);
            }
        }

        function twClearAll() {
            transferState.pending = [];
            transferState.activeSlot = -1;
            transferState.mode = 'squad';
            transferState.candidateCache = {};
            transferState.previewPlayer = null;
            renderTWAll();
        }

        /* ===== Step 5 · confirm =====

           This was a run of inline styles around two numbers that do not mean
           anything outside the engine — a "score" delta of −42.2 with no unit
           and no scale — and it drew its icons with <i data-lucide>
           placeholders, which the library swaps for an <svg> exactly once and
           which therefore vanish the next time the panel re-renders.

           What a confirmation step owes you is the three numbers the decision
           turns on: what it gains, what it costs, and what is left. Then every
           swap as the two players, in their clubs' colours, the way they were
           shown at every step before this one. */
        function twRenderSummaryPanel(el) {
            /* Confirmed already: this is no longer a decision, it is a
               receipt. What changed, what it is worth, and the one thing
               still left to do — which is not on this site. */
            if (twConfirmedResult && !transferState.pending.length) return twRenderConfirmedPanel(el);
            const hit = getTWHitCost();
            const itb = getTWLiveITB();
            const gws = twPlanGWs(3);
            const span = gws.length ? `GW${gws[0]}\u2013GW${gws[gws.length - 1]}` : 'the gameweeks ahead';

            let gain = 0;
            const swaps = transferState.pending.map(slot => {
                const sold = slot.soldPlayer, repl = slot.replacement;
                const d = twXPOver(repl, gws) - twXPOver(sold, gws);
                gain += d;
                const cls = d > 0.3 ? 'up' : d < -0.3 ? 'down' : 'flat';
                const heroOpts = () => ({ size: 'compact' });
                return `<div class="tw-conf-swap">
                    <div class="tw-conf-side out">
                        <span class="tw-conf-tag">Out</span>
                        ${typeof v2PlayerHeroHTML === 'function'
                            ? v2PlayerHeroHTML({ ...sold, price: sold.sellPrice || sold.price }, heroOpts())
                            : escHTML(sold.name)}
                    </div>
                    <div class="tw-conf-mid">
                        <span class="tw-conf-arrow" aria-hidden="true">\u2192</span>
                        <span class="tw-conf-delta ${cls}" data-tooltip="Projected points across ${escHTML(span)}, this player against the one leaving.">${d > 0 ? '+' : ''}${d.toFixed(1)}</span>
                    </div>
                    <div class="tw-conf-side in">
                        <span class="tw-conf-tag is-in">In</span>
                        ${typeof v2PlayerHeroHTML === 'function' ? v2PlayerHeroHTML(repl, heroOpts()) : escHTML(repl.name)}
                    </div>
                </div>`;
            }).join('');

            const net = gain - hit;
            const netCls = net > 0.3 ? 'up' : net < -0.3 ? 'down' : 'flat';

            /* The three figures the whole step turns on, as the bubbles the
               dashboard states a number with rather than three grey boxes in a
               row. Each carries the mark that says what kind of figure it is,
               so "what it costs" reads as a cost without having to be red. */
            const STAT_ICON = { gain: 'trend', cost: 'cash', bank: 'wallet' };
            const stat = (label, value, cls, tip, kind) =>
                `<div class="tw-conf-stat ${cls || ''}" data-tooltip="${escHTML(tip)}">
                    <span class="tw-conf-stat-l">${kind && typeof v2Icon === 'function' ? v2Icon(STAT_ICON[kind]) : ''}${escHTML(label)}</span>
                    <span class="tw-conf-stat-v ${cls || ''}">${value}</span>
                </div>`;

            const n = transferState.pending.length;

            /* Edit and Start over are both gone from this header. Edit went
               back one step, which is what the rail above already does and
               labels with the name of the step it goes back to; Start over
               threw the whole plan away behind a word that sounds like
               navigation. Clear, in the bar above, is the one that discards —
               and it says so. */
            el.innerHTML = `<div class="twc-panel tw-step-panel">
                ${twStepHead({
                    icon: 'check', title: 'Overview',
                    hint: `The squad ${n === 1 ? 'this transfer' : 'these transfers'} leaves you with, judged over ${escHTML(span)}`,
                    next: { label: `Confirm ${n === 1 ? 'transfer' : 'transfers'}`, on: 'twOpenConfirmGuard()',
                            tip: 'Apply these swaps to your squad across EasyFPL.' }
                })}
                <!-- Two columns. What you are changing on the left, what you
                     end up with on the right.

                     The swaps used to be a strip at the bottom, under the pitch
                     — the last thing on a step whose whole subject they are,
                     and the second time they had been shown, because the plan
                     bar above the panel was listing them too. They lead now,
                     with the verdict and the three figures under them, and the
                     squad they produce takes the rest of the width. -->
                <div class="twc-panel-body tw-conf-body">
                    <div class="tw-conf-left">
                        <!-- The figures lead. They were under the swaps, which
                             put the three numbers the step turns on below a
                             list that grows with every transfer — so on a
                             wildcard the answer to "is this worth it" sat eight
                             cards down. What it gains, what it costs and what
                             is left are the verdict; the swaps are the working
                             that produced it. -->
                        <div class="tw-conf-sub">${n === 1 ? 'What this transfer does' : `What these ${n} transfers do`}</div>
                        <div class="tw-conf-net ${netCls}">
                            <span class="tw-conf-net-v">${net > 0 ? '+' : ''}${net.toFixed(1)}</span>
                            <span class="tw-conf-net-t">${net > 0.3
                                ? `Worth making. The plan is ${net.toFixed(1)} points ahead over ${escHTML(span)}${hit > 0 ? ` even after the ${hit}-point hit` : ''}.`
                                : net < -0.3
                                    ? `Not worth it on projection. The plan is ${Math.abs(net).toFixed(1)} points behind over ${escHTML(span)}${hit > 0 ? ` once the ${hit}-point hit is counted` : ''}.`
                                    : `Too close to call over ${escHTML(span)} \u2014 within half a point either way. Something other than projection has to decide it.`}</span>
                        </div>

                        <div class="tw-conf-stats">
                            ${stat('What it gains', `${gain > 0 ? '+' : ''}${gain.toFixed(1)} pts`,
                                gain > 0.3 ? 'up' : gain < -0.3 ? 'down' : '',
                                `Projected points these ${n === 1 ? 'players' : 'swaps'} add across ${span}, before any hit.`, 'gain')}
                            ${stat('What it costs', hit > 0 ? `\u2212${hit} pts` : transferState.wildcard ? 'Waived' : '0 pts',
                                hit > 0 ? 'down' : '',
                                transferState.wildcard
                                    ? 'Your chip waives every hit this week.'
                                    : hit > 0 ? `${n} transfers against ${twFreeTransfers()} free, at 4 points each beyond that.` : 'Inside your free transfers.', 'cost')}
                            ${stat('Left in the bank', `\u00a3${itb.toFixed(1)}m`, itb < 0 ? 'down' : '',
                                itb < 0 ? 'This plan spends more than you have.' : 'What remains once every transfer is made.', 'bank')}
                        </div>

                        <div class="tw-conf-sub">${n === 1 ? 'The transfer' : `The ${n} transfers`}</div>
                        <div class="tw-conf-swaps">${swaps}</div>
                    </div>

                    <div class="tw-conf-right">
                        <div class="tw-conf-sub">Your new squad</div>
                        ${twOvRenderPitch()}
                    </div>
                </div>
            </div>`;
        }

        function twRenderConfirmedPanel(el) {
            const r = twConfirmedResult;
            const gws = twPlanGWs(3);
            const span = gws.length ? `GW${gws[0]}\u2013GW${gws[gws.length - 1]}` : 'the gameweeks ahead';
            const net = r.gain - r.hit;
            const n = r.moves.length;

            const byId = id => allPlayers.find(p => p.id === id);
            const swaps = r.moves.map(m => {
                const inP = byId(m.inId);
                return `<div class="tw-conf-swap">
                    <div class="tw-conf-side out">
                        <span class="tw-conf-tag">Out</span>
                        ${typeof v2PlayerHeroHTML === 'function' && byId(m.outId)
                            ? v2PlayerHeroHTML({ ...byId(m.outId), price: m.outPrice / 10 }, { size: 'compact' })
                            : escHTML(m.outName)}
                    </div>
                    <div class="tw-conf-mid"><span class="tw-conf-arrow" aria-hidden="true">\u2192</span></div>
                    <div class="tw-conf-side in">
                        <span class="tw-conf-tag is-in">In</span>
                        ${typeof v2PlayerHeroHTML === 'function' && inP
                            ? v2PlayerHeroHTML(inP, { size: 'compact' })
                            : escHTML(m.inName)}
                    </div>
                </div>`;
            }).join('');

            const stat = (label, value, cls, tip) =>
                `<div class="tw-conf-stat" data-tooltip="${escHTML(tip)}">
                    <span class="tw-conf-stat-l">${escHTML(label)}</span>
                    <span class="tw-conf-stat-v ${cls || ''}">${value}</span>
                </div>`;

            el.innerHTML = `<div class="twc-panel tw-step-panel">
                ${twStepHead({
                    icon: 'check', title: `${n} transfer${n === 1 ? '' : 's'} applied`,
                    hint: `On EasyFPL \u2014 not yet on FPL`,
                    next: { label: 'Plan another', on: 'renderTransferWizard()', tip: 'Start a new plan from step 1.' }
                })}
                <div class="twc-panel-body">
                    <!-- Something actually happened, so the screen should say
                         so before it starts qualifying it. The warning below
                         is the important half and it stays; this is the half
                         that tells you the thing you pressed worked. -->
                    <div class="tw-done-hero">
                        <span class="tw-done-tick">${v2Icon('check')}</span>
                        <span class="tw-done-words">
                            <strong>${n} transfer${n === 1 ? '' : 's'} applied</strong>
                            <em>${r.moves.map(m => `${escHTML(m.outName)} \u2192 ${escHTML(m.inName)}`).join(' \u00b7 ')}</em>
                        </span>
                        <span class="tw-done-net ${net > 0.3 ? 'up' : net < -0.3 ? 'down' : ''}">
                            ${net > 0 ? '+' : ''}${net.toFixed(1)}<i>pts</i>
                        </span>
                    </div>

                    <!-- The reminder outlives the modal: this is the screen
                         someone will be looking at when they decide whether
                         they have finished, and they have not. -->
                    <div class="tw-done-warn">
                        ${v2Icon('warn')}
                        <span>Your squad on EasyFPL is updated. Your squad on
                        <strong>fantasy.premierleague.com</strong> is not \u2014 make
                        ${n === 1 ? 'this transfer' : 'these transfers'} there before the deadline.</span>
                    </div>

                    <div class="tw-conf-stats">
                        ${stat('Projected gain', `${r.gain > 0 ? '+' : ''}${r.gain.toFixed(1)} pts`,
                            r.gain > 0.3 ? 'up' : r.gain < -0.3 ? 'down' : '',
                            `What these ${n === 1 ? 'players are' : 'swaps are'} worth across ${span}, before any hit.`)}
                        ${stat('Points hit', r.hit > 0 ? `\u2212${r.hit} pts` : '0 pts', r.hit > 0 ? 'down' : '',
                            r.hit > 0 ? 'Charged against your score this gameweek.' : 'Inside your free transfers.')}
                        ${stat('Net', `${net > 0 ? '+' : ''}${net.toFixed(1)} pts`,
                            net > 0.3 ? 'up' : net < -0.3 ? 'down' : '',
                            `The gain once the hit is counted, across ${span}.`)}
                        ${stat('In the bank', `\u00a3${r.bank.toFixed(1)}m`, r.bank < 0 ? 'down' : '',
                            'What is left after these transfers.')}
                    </div>

                    <div class="tw-conf-swaps">${swaps}</div>

                    <div class="tw-done-foot">
                        <a class="tw-back" href="https://fantasy.premierleague.com/transfers" target="_blank" rel="noopener noreferrer">
                            ${v2Icon('globe')} Open FPL transfers
                        </a>
                        <button class="tw-back" onclick="twUndoConfirmed()" data-tooltip="Take these back out of your EasyFPL squad. Use it if you decide not to make them for real.">
                            ${v2Icon('refresh')} Undo on EasyFPL
                        </button>
                    </div>
                </div>
            </div>`;
        }

        /* A confirmed plan is a statement of intent, and intent changes. Undo
           puts the squad back rather than leaving someone to re-transfer the
           player they started with just to cancel a decision. */
        function twUndoConfirmed() {
            /* Nothing to reload: the real squad was never changed, so dropping
               the plan is the whole undo. */
            twConfirmedClear();
            twPlan = [];
            twConfirmedResult = null;
            transferRendered = false;
            updateStatus('Plan cleared \u2014 the wizard is back on your real squad', 'success');
            if (typeof twGoStep === 'function') twGoStep(1);
        }

        /* ===== The wizard's own squad =====

           EasyFPL cannot make a transfer — FPL has no public write API — so a
           swap agreed here is a PLAN, and a plan is not a squad. It used to be
           treated as one: confirming rewrote selectedPlayers and picksData in
           place, which are the page's shared record of the team the manager
           actually owns, so Squad Analysis, the Gameweek Review and every panel
           that reads them started describing a team that exists only on this
           site. Reloading did not clear it either, because applyConfirmedSwaps
           folded the stored plan back in on the way past.

           The plan lives here now. twSquad() is the real squad with the plan
           laid over it, and only the wizard reads it; selectedPlayers is left
           exactly as FPL handed it over. Squad Analysis therefore shows the team
           the manager owns until FPL itself says otherwise — which is the point
           of it — and the wizard still remembers what you were planning, across
           reloads, because the plan is persisted on its own.

           Position, captaincy and bench slot come from the man going out: a
           plan changes who is in the squad, never its shape. */
        let twPlan = [];

        function twPlanLoad() {
            const teamId = (() => { try { return localStorage.getItem('fpl_team_id') || ''; } catch (e) { return ''; } })();
            const rec = typeof twConfirmedRead === 'function' ? twConfirmedRead() : null;
            twPlan = (rec && String(rec.teamId) === String(teamId) && rec.gw === planningGW)
                ? rec.moves.slice() : [];
            return twPlan;
        }

        function twSquad() {
            const base = selectedPlayers || [];
            if (!twPlan.length) return base;
            return base.map(slot => {
                const move = twPlan.find(m => m.outId === slot.id);
                if (!move) return slot;
                const incoming = (allPlayers || []).find(x => x.id === move.inId);
                if (!incoming) return slot;
                return {
                    ...incoming,
                    isCaptain: slot.isCaptain, isVice: slot.isVice,
                    onBench: slot.onBench, pickPosition: slot.pickPosition,
                    multiplier: slot.multiplier,
                    sellPrice: move.inPrice / 10,
                    twPlanned: true
                };
            });
        }

        // What the plan has done to the bank, in millions.
        function twPlanBankDelta() {
            return twPlan.reduce((s, m) => s + (m.outPrice - m.inPrice), 0) / 10;
        }

        /* ===== Confirming =====

           EasyFPL cannot make a transfer. FPL has no public write API, so a
           swap agreed here exists only here until the manager makes it on
           fantasy.premierleague.com as well — and a squad that is right on
           this site and wrong on theirs is worse than no plan, because every
           number on every page would then be describing a team they do not
           own. So confirming says that first, in as many words, and needs it
           acknowledged before it writes anything. */
        /* Read once, dismissed for good if asked. The warning matters the first
           time and becomes noise by the fifth — but it is the only thing telling
           a manager that EasyFPL cannot make the transfer for them, so opting out
           has to be deliberate rather than a click-through. */
        const TW_GUARD_SKIP = 'easyfpl_tw_guard_skip';

        function twGuardSkipped() {
            try { return localStorage.getItem(TW_GUARD_SKIP) === '1'; } catch (e) { return false; }
        }

        function twGuardSkipSet(on) {
            try {
                if (on) localStorage.setItem(TW_GUARD_SKIP, '1');
                else localStorage.removeItem(TW_GUARD_SKIP);
            } catch (e) { /* private mode — the box simply keeps appearing */ }
        }

        function twOpenConfirmGuard() {
            if (!transferState.pending.length) return;
            if (!transferState.pending.every(x => x.replacement)) return;
            // Already acknowledged, permanently. Straight through.
            if (twGuardSkipped()) { twApplyConfirmed(); return; }
            document.getElementById('twConfirmGuard')?.remove();

            const list = transferState.pending.map(x =>
                `<li><b>${escHTML(x.soldPlayer.name)}</b> out, <b>${escHTML(x.replacement.name)}</b> in</li>`).join('');

            document.body.insertAdjacentHTML('beforeend', `
            <div class="modal-overlay v2-modal tw-guard" id="twConfirmGuard" onclick="twCloseConfirmGuard(event)">
                <div class="modal-container" role="dialog" aria-modal="true" aria-labelledby="twGuardTitle">
                    <div class="v2-set-head">
                        <span class="v2-section-title" id="twGuardTitle">${v2Icon('warn')}Make these on FPL too</span>
                        <button class="modal-close" onclick="twCloseConfirmGuard()" aria-label="Close">&times;</button>
                    </div>
                    <div class="v2-set-body">
                        <p class="tw-guard-lead">EasyFPL cannot make transfers for you. Fantasy Premier League
                        has no public way for another site to change your team, so confirming here updates
                        <strong>this site only</strong>.</p>
                        <ul class="tw-guard-list">${list}</ul>
                        <p class="tw-guard-lead">Make the same ${transferState.pending.length === 1 ? 'move' : 'moves'} on
                        <strong>fantasy.premierleague.com</strong> before the deadline. If you do not, your real
                        team is unchanged and everything EasyFPL tells you from here on will be about a squad
                        you do not own.</p>
                        <label class="tw-guard-ack">
                            <input type="checkbox" id="twGuardAck" onchange="twGuardAckChanged(this.checked)">
                            <span>I understand — I will make ${transferState.pending.length === 1 ? 'this transfer' : 'these transfers'} on the FPL site myself.</span>
                        </label>
                        <label class="tw-guard-ack tw-guard-skip">
                            <input type="checkbox" id="twGuardSkip">
                            <span>Do not show this again</span>
                        </label>
                        <div class="tw-guard-actions">
                            <button class="tw-back" onclick="twCloseConfirmGuard()">Cancel</button>
                            <button class="tw-next" id="twGuardGo" disabled onclick="twGuardConfirm()">
                                Apply to my squad ${v2Icon('next')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>`);
            requestAnimationFrame(() => {
                document.getElementById('twConfirmGuard')?.classList.add('open');
                document.body.classList.add('v2-blurred');
            });
        }

        // The opt-out is only honoured alongside the acknowledgement, so it
        // cannot be used to skip reading the thing it is opting out of.
        function twGuardConfirm() {
            const skip = document.getElementById('twGuardSkip');
            if (skip && skip.checked) twGuardSkipSet(true);
            twApplyConfirmed();
        }

        function twGuardAckChanged(on) {
            const go = document.getElementById('twGuardGo');
            if (go) go.disabled = !on;
        }

        function twCloseConfirmGuard(event) {
            if (event && event.target !== event.currentTarget) return;
            const box = document.getElementById('twConfirmGuard');
            if (!box) return;
            box.classList.remove('open');
            document.body.classList.remove('v2-blurred');
            setTimeout(() => box.remove(), 240);
        }

        /* Write the swaps, then show what they left behind.

           Stored in FPL's own units — tenths of a million — because that is
           what picks payloads carry, and what twSquad() converts back when it
           lays the plan over the real squad. */
        function twApplyConfirmed() {
            const moves = transferState.pending.filter(x => x.replacement).map(x => ({
                outId: x.soldPlayer.id,
                inId: x.replacement.id,
                outName: x.soldPlayer.name,
                inName: x.replacement.name,
                outPrice: Math.round((x.soldPlayer.sellPrice || x.soldPlayer.price) * 10),
                inPrice: Math.round(x.replacement.price * 10)
            }));
            if (!moves.length) return;

            const teamId = (() => { try { return localStorage.getItem('fpl_team_id') || ''; } catch (e) { return ''; } })();
            const gws = twPlanGWs(3);
            const gain = transferState.pending.reduce((sum, x) =>
                sum + (twXPOver(x.replacement, gws) - twXPOver(x.soldPlayer, gws)), 0);
            const hit = getTWHitCost();
            const bank = getTWLiveITB();

            /* Merged rather than replaced: confirming a second transfer later
               in the same round must not silently undo the first. A repeat of
               the same outgoing player wins, since it is the newer decision. */
            const held = twConfirmedRead();
            const keep = (held && String(held.teamId) === String(teamId) && held.gw === planningGW)
                ? held.moves.filter(m => !moves.some(n => n.outId === m.outId || n.inId === m.inId))
                : [];
            twConfirmedSave(teamId, planningGW, keep.concat(moves));

            twConfirmedResult = { moves, gain, hit, bank, at: Date.now() };
            twCloseConfirmGuard();

            /* The squad every tab on this page reads. Rebuilt here rather than
               reloaded from the API, which would return the same unchanged
               squad — FPL does not know about any of this. */
            twApplySwapsLocally(moves);

            transferState.pending = [];
            transferState.activeSlot = -1;
            transferState.previewPlayer = null;
            transferState.candidateCache = {};
            transferState.mode = 'summary';
            twGoStep(4);
            updateStatus(`${moves.length} transfer${moves.length === 1 ? '' : 's'} applied on EasyFPL — now make ${moves.length === 1 ? 'it' : 'them'} on the FPL site`, 'success');
        }

        let twConfirmedResult = null;

        /* Swap the players in the page's own state, in the outgoing player's
           slot so the formation, the captaincy and the bench order survive. */
        /* Record the plan. Nothing here touches selectedPlayers or picksData:
           those are the squad FPL says the manager owns, and the wizard is not
           entitled to rewrite them on the strength of an intention. */
        function twApplySwapsLocally(moves) {
            moves.forEach(m => {
                twPlan = twPlan.filter(x => x.outId !== m.outId && x.inId !== m.inId);
                twPlan.push(m);
            });
            transferRendered = false;
        }

        // ===== SETTINGS =====
        function openSettings() {
            // Highlight active preset button
            ['Aggressive','Balanced','Patient'].forEach(name => {
                const btn = document.getElementById('preset' + name);
                btn.classList.toggle('primary', activePreset === name.toLowerCase());
            });
            document.getElementById('settingsOverlay').classList.add('show');
        }

        function closeSettings(event) {
            if (event && event.target !== event.currentTarget) return;
            document.getElementById('settingsOverlay').classList.remove('show');
        }

        /* openHelpOverlay / closeHelpOverlay moved to scripts/common.js.

           They lived here, which only My Team loads, so any other page calling
           them got a ReferenceError — and four pages now have a help drawer of
           their own. */

        function applyPreset(preset) {
            if (preset === 'aggressive') {
                userSettings = { sellSensitivity: 1.3, fixtureWeight: 1.4, formWeight: 1.2, valueWeight: 1.3, minutesThreshold: 70, premiumHarshness: 1.3 };
            } else if (preset === 'balanced') {
                userSettings = { sellSensitivity: 1.0, fixtureWeight: 1.0, formWeight: 1.0, valueWeight: 1.0, minutesThreshold: 60, premiumHarshness: 1.0 };
            } else if (preset === 'patient') {
                userSettings = { sellSensitivity: 0.7, fixtureWeight: 0.6, formWeight: 0.8, valueWeight: 0.8, minutesThreshold: 50, premiumHarshness: 0.7 };
            }

            activePreset = preset;
            localStorage.setItem('fpl_analysis_settings', JSON.stringify(userSettings));
            localStorage.setItem('fpl_active_preset', preset);
            document.querySelectorAll('.strategy-preset-tab').forEach(button => {
                button.classList.toggle('active', button.dataset.strategyPreset === preset);
            });
            closeSettings();
            
            if (twSquad().length > 0) {
                analyzeTeam();
            }

            updateStatus(`${preset.charAt(0).toUpperCase() + preset.slice(1)} settings applied`, 'success');
        }

        // ===== TRANSFER MARKET =====
        /* When FPL changes prices.

           It moved for 2026/27. The Premier League's own announcement of the
           Price Change Predictor says the tool indicates who will rise and fall
           "each day at 00:00 UK time"; this used to be hard-coded at 01:30 UTC,
           which is now up to an hour and a half late and, through British
           Summer Time, on the wrong day entirely.

           UK time rather than UTC, so it cannot be a constant: midnight in
           London is 23:00 UTC in summer and 00:00 UTC in winter. */
        const PRICE_LOCK_TZ = 'Europe/London';

        // A player's distance to a price change, as a signed percentage: +100 means
        // on track to rise, -100 on track to drop. This is the same transfer-velocity
        // model behind the pitch badge (net transfers over the current owner base),
        // scaled so the thresholds land at ±100 — NOT FPL's own published figure,
        // which does not exist publicly.
        /* How far along the meter a player is, from FPL's own figure.

           This used to be a model: net transfers over the owner base, times
           five hundred, clamped. It was written before the game published
           anything, and it was left in place after it did — so this page and
           the dashboard answered the same question from different numbers and
           disagreed in public. Ballard sat at −92.5 on the game's meter and
           −11.5 on the model, so the dashboard called him a near-certain drop
           while this page said no squad player was close to one.

           The model was not merely miscalibrated, it was noise. Dividing net
           transfers by a tiny owner base saturates the clamp on a handful of
           moves: Matusiwa, three in and two out at 0.0% ownership, scored a
           maximum +100 rise while the game's meter had him at −90.3.

           price_change_percent is what the official Price Change Predictor is
           built on, so there is nothing left to model. One number, read the
           same way here as in scripts/price-watch.js. */
        function priceThresholdPct(p) {
            const v = p && p.priceProgress;
            return typeof v === 'number' && isFinite(v) ? v : 0;
        }

        /* The same tiers price-watch.js uses at the top and bottom, so the two
           panels cannot describe one player differently. Anything past the line
           is due tonight; PW_CLOSE short of it is a watch item and deliberately
           not a forecast.

           Between those lines this used to say one word — "Safe" — for every
           player, and the meter runs from -100 to +100. So a player 60% of the
           way to a DROP was labelled safe, and so was one 60% of the way to a
           rise, and so was one who had not moved at all. Measured on the live
           feed that is 605 of 659 players sharing a single label: 300 being
           sold, 164 being bought, 141 genuinely still. The one thing an owner
           wants from this column — which way is my player going — was the thing
           it threw away.

           price-watch.js does not disagree with what follows, because it says
           nothing here at all: below PW_CLOSE it returns null and the player is
           simply left out of that panel. The shared vocabulary is the four outer
           tiers, and those are untouched.

           "Drifting" rather than "rising" or "falling" on purpose. The meter is
           progress, not a prediction — the column's own header says so — and a
           player at +30 is not on his way anywhere in particular. Direction is a
           fact about the number; arrival is not. */
        function thresholdState(pct) {
            const due = typeof PW_DUE === 'number' ? PW_DUE : 100;
            const close = typeof PW_CLOSE === 'number' ? PW_CLOSE : 80;
            if (pct >= due) return { cls: 'rise-imminent', text: 'Rises tonight', short: 'Rising' };
            if (pct >= close) return { cls: 'rise', text: 'Climbing', short: 'Climbing' };
            if (pct <= -due) return { cls: 'drop-imminent', text: 'Drops tonight', short: 'Dropping' };
            if (pct <= -close) return { cls: 'drop', text: 'Sliding', short: 'Sliding' };
            /* Zero is its own answer and a common one — a fifth of the league sits
               exactly there. Everything else takes the sign it actually has; no
               dead zone, because any width for one would be invented. */
            if (pct > 0) return { cls: 'drift-up', text: 'Drifting up', short: 'Up' };
            if (pct < 0) return { cls: 'drift-down', text: 'Drifting down', short: 'Down' };
            return { cls: 'stable', text: 'Not moving', short: 'Flat' };
        }

        const THRESHOLD_TIP = "FPL's own progress meter towards a price change. At 100% the change happens at the next daily update; below that it is how far along he is, not a forecast that he gets there.";

        /* The heading for the meter column, said once above the list.

           It used to be a tooltip on every row — the same four lines of text
           attached to thirty cells, so wherever the cursor rested you got the
           identical explanation and the column itself was never labelled. One
           header names the column and carries the note; the rows underneath say
           nothing but their own number. */
        function renderTmWatchLegend() {
            return `<div class="tm-watch-legend" aria-hidden="true">
                <span>Player</span>
                <span class="tm-watch-legend-thr" data-tooltip="${escHTML(THRESHOLD_TIP)}">
                    Progress to a price change<i>?</i>
                </span>
            </div>`;
        }

        // How far London is ahead of UTC at a given instant, in milliseconds.
        function londonOffsetMs(at) {
            const parts = {};
            new Intl.DateTimeFormat('en-GB', {
                timeZone: PRICE_LOCK_TZ, hour12: false,
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            }).formatToParts(at).forEach(x => { if (x.type !== 'literal') parts[x.type] = x.value; });
            const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
            const asIfUTC = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
                hour, Number(parts.minute), Number(parts.second));
            return asIfUTC - Math.floor(at.getTime() / 1000) * 1000;
        }

        /* The next midnight in London, as a real instant.

           The offset is recomputed at the target rather than reused from now,
           so the one night a year the clocks change does not move the deadline
           by an hour. */
        function nextPriceLock(now) {
            const at = now != null ? new Date(now) : new Date();
            const wall = new Date(at.getTime() + londonOffsetMs(at));
            const nextMidnightWall = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()) + 86400000;
            const firstGuess = new Date(nextMidnightWall - londonOffsetMs(at));
            return new Date(nextMidnightWall - londonOffsetMs(firstGuess));
        }

        // One timer, cleared and restarted on every render, stopping itself once the
        // element it writes into is gone — same pattern as the deadline countdown.
        let priceLockTimer = null;
        function startPriceLockCountdown() {
            if (priceLockTimer) { clearInterval(priceLockTimer); priceLockTimer = null; }
            const tick = () => {
                const el = document.getElementById('tmLockValue');
                if (!el) { clearInterval(priceLockTimer); priceLockTimer = null; return; }
                const diff = nextPriceLock().getTime() - Date.now();
                if (diff <= 0) { el.textContent = 'Any moment'; return; }
                const h = Math.floor(diff / 3600000);
                const m = Math.floor(diff / 60000) % 60;
                const s = Math.floor(diff / 1000) % 60;
                el.textContent = h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`;
                el.parentElement.classList.toggle('urgent', diff < 2 * 3600000);
            };
            tick();
            priceLockTimer = setInterval(tick, 1000);
        }

        /* "Sell before drop" is one decision already made — this player, now,
           before tonight's price change — so it should land on the question
           that is left, which is who replaces him.
         *
           It used to stage the slot and leave you on step 1 looking at the plan
           chooser, with the player picked but nothing showing for him: the
           button had answered "who goes" and then asked you to say it again.
           twSwapPlayer is the same path clicking a squad card takes — stage,
           point the market at the slot, step 2 — so the button arrives exactly
           where the click would have.

           The plan is set first and deliberately. It is a single transfer by
           definition, and choosing a plan clears whatever was staged under the
           old one, so a strategy set after the slot would throw the slot away. */
        function tmSellBeforeDrop(playerId) {
            // Switch first: renderTransferWizard() resets transferState on its first
            // run, so a slot staged beforehand would be wiped before it was drawn.
            switchTab('transfer');
            if (typeof twSetStrategy === 'function' && transferState.strategy !== 'single') {
                twSetStrategy('single');
            }
            twSwapPlayer(playerId);
        }

        function tmSetMarketTab(tab) {
            tmMarketTab = tab;
            transferMarketRendered = false;
            renderTransferMarket();
        }

        let tmMarketTab = 'risers';
        let tmPosFilter = 'all';
        let tmPriceFilter = 'all'; // 'all', 'premium', 'budget'
        let tmSquadSort = { col: 'pressure', asc: false };
        let tmRisingSort = { col: 'netTransfers', asc: false };
        let tmFallingSort = { col: 'netTransfers', asc: true };
        function getTransferPressure(player) {
            const owners = Math.max(totalFplPlayers * (player.ownership / 100), 1);
            const net = player.transfersIn - player.transfersOut;
            return net / owners;
        }

        function getPressureLabel(pressure) {
            if (pressure > 0.04) return { text: 'Hot', cls: 'rise' };
            if (pressure > 0.015) return { text: 'Rising', cls: 'rise' };
            if (pressure < -0.04) return { text: 'Dropping', cls: 'fall' };
            if (pressure < -0.015) return { text: 'Cooling', cls: 'fall' };
            return { text: 'Stable', cls: 'stable' };
        }

        function ownershipRingSVG(pct) {
            const r = 9, cx = 12, cy = 12, sw = 3;
            const circ = 2 * Math.PI * r;
            const offset = circ * (1 - Math.min(pct, 100) / 100);
            const color = pct >= 30 ? 'var(--color-primary)' : pct >= 10 ? 'var(--color-info)' : 'var(--text-muted)';
            return `<svg width="24" height="24" viewBox="0 0 24 24" class="tm-own-ring-svg"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${sw}"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}" stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"/></svg>`;
        }

        function velocityIndicator(netTransfers) {
            const abs = Math.abs(netTransfers);
            if (netTransfers >= 50000) return `<span class="tm-velocity surge">▲▲ <span class="tm-velocity-label">Surge</span></span>`;
            if (netTransfers >= 10000) return `<span class="tm-velocity rising">▲ <span class="tm-velocity-label">Rising</span></span>`;
            if (netTransfers <= -50000) return `<span class="tm-velocity plummeting">▼▼ <span class="tm-velocity-label">Plummet</span></span>`;
            if (netTransfers <= -10000) return `<span class="tm-velocity falling">▼ <span class="tm-velocity-label">Falling</span></span>`;
            return `<span class="tm-velocity steady">— <span class="tm-velocity-label">Steady</span></span>`;
        }

        function renderTransferMarket() {
            transferMarketRendered = true;
            const container = document.getElementById('transferMarketDisplay');

            if (allPlayers.length === 0) {
                container.innerHTML = '<div style="text-align:center;padding:60px 20px;"><div style="font-size:48px;margin-bottom:16px;"><i data-lucide="trending-up" style="width:48px;height:48px;color:var(--color-primary);"></i></div><div style="font-size:18px;font-weight:600;margin-bottom:8px;">Loading Transfer Market...</div><div style="font-size:14px;color:var(--text-secondary);">Data is still loading. Please wait.</div></div>';
                if (typeof lucide !== 'undefined') lucide.createIcons();
                return;
            }

            const playersWithPressure = allPlayers.filter(p => p.ownership > 0.5 && p.minutes > 0).map(p => ({
                ...p,
                netTransfers: p.transfersIn - p.transfersOut,
                pressure: getTransferPressure(p),
                threshold: priceThresholdPct(p),
                priceChangeGW: (p.costChangeEvent || 0) / 10,
                priceChangeSeason: (p.costChangeStart || 0) / 10,
                posName: ['','GK','DEF','MID','FWD'][p.position] || '?',
                posClass: ['','gk','def','mid','fwd'][p.position] || '',
                teamShort: (p.team || '???').substring(0, 3)
            }));

            const squadIds = new Set(twSquad().map(p => p.id));

            const filterPlayers = (list) => {
                let filtered = tmPosFilter === 'all' ? list : list.filter(p => p.position === parseInt(tmPosFilter));
                if (tmPriceFilter === 'premium') filtered = filtered.filter(p => p.price >= 10);
                else if (tmPriceFilter === 'budget') filtered = filtered.filter(p => p.price < 5);
                return filtered;
            };

            let html = '';

            // ─── Ticker: the market moving, squad holdings called out ───
            const tickRisers = playersWithPressure.filter(p => p.threshold > 0).sort((a, b) => b.threshold - a.threshold).slice(0, 5);
            const tickFallers = playersWithPressure.filter(p => p.threshold < 0).sort((a, b) => a.threshold - b.threshold).slice(0, 5);
            const interleaved = [];
            for (let i = 0; i < Math.max(tickRisers.length, tickFallers.length); i++) {
                if (tickRisers[i]) interleaved.push(tickRisers[i]);
                if (tickFallers[i]) interleaved.push(tickFallers[i]);
            }
            if (interleaved.length) {
                const item = p => `<span class="tm-tick ${p.threshold > 0 ? 'up' : 'down'}">
                    <span class="tm-tick-arrow">${p.threshold > 0 ? '' : ''}</span>
                    <span class="tm-tick-name">${escHTML(p.name)}</span>
                    <span class="tm-tick-team">(${escHTML(p.teamShort)})</span>
                    ${squadIds.has(p.id) ? '<span class="tm-tick-squad">SQUAD</span>' : ''}
                    <span class="tm-tick-pct">${p.threshold > 0 ? '+' : ''}${Math.round(p.threshold)}%</span>
                </span>`;
                // The track is rendered twice and translated by exactly half, so the
                // loop point is invisible.
                const run = interleaved.map(item).join('<span class="tm-tick-sep">•</span>');
                html += `<div class="tm-ticker" role="marquee" aria-label="Players closest to a price change">
                    <div class="tm-ticker-track">${run}<span class="tm-tick-sep">•</span>${run}<span class="tm-tick-sep">•</span></div>
                </div>`;
            }

            // ─── Portfolio header: when the market closes, and what it costs you ───
            const squadPlayers = playersWithPressure.filter(p => squadIds.has(p.id));
            /* Was -80 and +90, two arbitrary numbers that matched neither each
               other nor the dashboard. Both now sit on the line itself: a player
               is "on track" when the game's meter says he goes tonight. */
            const dueAt = typeof PW_DUE === 'number' ? PW_DUE : 100;
            const atRisk = squadPlayers.filter(p => p.threshold <= -dueAt);
            const rising = squadPlayers.filter(p => p.threshold >= dueAt);
            const closingToDrop = squadPlayers.filter(p =>
                p.threshold > -dueAt && p.threshold <= -(typeof PW_CLOSE === 'number' ? PW_CLOSE : 80));
            const exposure = atRisk.length * 0.1;

            html += `<div class="tm-portfolio">
                <div class="tm-lock" data-tooltip="FPL changes prices once a night, at 00:00 UK time. The exact minute is not published and drifts by a few, so treat this as close rather than exact.">
                    <span class="tm-lock-label">${v2Icon('stopwatch')} Market closes in</span>
                    <span class="tm-lock-value" id="tmLockValue">—</span>
                    <span class="tm-lock-note">00:00 UK</span>
                </div>
                <div class="tm-exposure">
                    ${atRisk.length
                        ? `<span class="tm-exp-risk" data-tooltip="${escHTML(atRisk.map(p => p.name).join(', '))}"><strong>${atRisk.length}</strong> squad ${atRisk.length === 1 ? 'player' : 'players'} on track to drop <span class="tm-exp-money">−£${exposure.toFixed(1)}m</span></span>`
                        : closingToDrop.length
                            ? `<span class="tm-exp-watch" data-tooltip="${escHTML(closingToDrop.map(p => `${p.name} ${Math.round(Math.abs(p.threshold))}%`).join(', '))}"><strong>${closingToDrop.length}</strong> closing in on a drop, ${closingToDrop.length === 1 ? 'but not there' : 'but none there'} yet</span>`
                            : `<span class="tm-exp-safe">No squad player is close to dropping tonight</span>`}
                    ${rising.length ? `<span class="tm-exp-gain" data-tooltip="${escHTML(rising.map(p => p.name).join(', '))}"><strong>${rising.length}</strong> on track to rise</span>` : ''}
                </div>
            </div>`;

            /* Two columns from here: your own squad on the left, the market on
               the right. Stacked, the market list sat a full screen below the
               squad list, so the comparison the page exists for — is anyone out
               there moving faster than what I already own — needed scrolling
               between the two halves of it. */
            html += `<div class="tm-columns">`;

            // ─── Squad first, ordered by how close each is to a change ───
            if (squadPlayers.length > 0) {
                // Closest to a change first; on a tie the one dropping outranks the
                // one rising, because a drop is the only one of the two that costs
                // money and needs a decision before tonight.
                /* NOT filterPlayers(). The position and price buttons belong to
                   the market panel beside this one, and running your own squad
                   through them made picking "MID" over there silently delete
                   ten men from your price watch — a filter that appears to
                   scope one list quietly reaching into another. Your squad is
                   fifteen players and is always all fifteen. */
                const ordered = squadPlayers.slice().sort((a, b) => {
                    const d = Math.abs(b.threshold) - Math.abs(a.threshold);
                    if (Math.abs(d) > 0.01) return d;
                    return a.threshold - b.threshold;
                });
                html += `<div class="tm-section">
                    <div class="tm-section-header squad-header">
                        <h2><i data-lucide="shield" style="width:16px;height:16px;display:inline;"></i> Your squad price watch</h2>
                        <span class="tm-section-count blue">${ordered.length}</span>
                    </div>
                    <div class="tm-watch-note">Ordered by how close each player is to a price change, not alphabetically — the ones that need a decision tonight sit at the top.</div>
                    ${renderTmWatchLegend()}
                    <div class="tm-watch">${ordered.map(p => renderTmWatchRow(p)).join('')}</div>
                </div>`;
            }

            // ─── Market trends, one segmented panel, squad players removed ───
            const market = playersWithPressure.filter(p => !squadIds.has(p.id));
            const risers = filterPlayers(market.filter(p => p.threshold > 0)).sort((a, b) => b.threshold - a.threshold);
            const fallers = filterPlayers(market.filter(p => p.threshold < 0)).sort((a, b) => a.threshold - b.threshold);
            // Enablers are the cheap players a squad is funded by — worth catching
            // before they rise, since that is the budget disappearing.
            const enablers = filterPlayers(market.filter(p => p.price <= 5.5 && p.threshold > 0)).sort((a, b) => b.threshold - a.threshold);

            const tabs = [
                { key: 'risers', label: 'Hot risers', list: risers },
                { key: 'fallers', label: 'Steep fallers', list: fallers },
                { key: 'enablers', label: 'Budget enablers', list: enablers }
            ];
            const active = tabs.find(t => t.key === tmMarketTab) || tabs[0];
            /* The whole list, always. It used to open on eight with a "View
               all 81" under it, which meant the panel beside your squad was
               showing a tenth of what it had and the button that fixed that
               grew the page by a screen and a half. The column has its own
               height and its own scrollbar now, so the full market fits
               inside it and you reach the rest by scrolling rather than by
               reflowing the document. */
            const display = active.list;

            html += `<div class="tm-section tm-market-col">
                <div class="tm-section-header market-header">
                    <h2><i data-lucide="trending-up" style="width:16px;height:16px;display:inline;"></i> The wider market</h2>
                    <span class="tm-section-count green">${active.list.length}</span>
                </div>
                <div class="tm-watch-note">Players you do not own, sorted by how close each is to a price change. Pick a list, then narrow it by position or price.</div>
                <div class="tm-market-tabs">
                    ${tabs.map(t => `<button class="tm-market-tab ${t.key === active.key ? 'active' : ''}" onclick="tmSetMarketTab('${t.key}')">${t.label} <span class="tm-market-tab-n">${t.list.length}</span></button>`).join('')}
                </div>
                <div class="tm-pos-filter">
                    <button class="tm-pos-btn ${tmPosFilter === 'all' && tmPriceFilter === 'all' ? 'active' : ''}" onclick="tmFilterPos('all')">All</button>
                    <button class="tm-pos-btn pos-gk ${tmPosFilter === '1' ? 'active' : ''}" onclick="tmFilterPos('1')">GK</button>
                    <button class="tm-pos-btn pos-def ${tmPosFilter === '2' ? 'active' : ''}" onclick="tmFilterPos('2')">DEF</button>
                    <button class="tm-pos-btn pos-mid ${tmPosFilter === '3' ? 'active' : ''}" onclick="tmFilterPos('3')">MID</button>
                    <button class="tm-pos-btn pos-fwd ${tmPosFilter === '4' ? 'active' : ''}" onclick="tmFilterPos('4')">FWD</button>
                    <span style="width:1px;background:var(--border-default);margin:2px 4px;"></span>
                    <button class="tm-pos-btn ${tmPriceFilter === 'premium' ? 'active' : ''}" onclick="tmFilterPrice('premium')">Premium £10m+</button>
                    <button class="tm-pos-btn ${tmPriceFilter === 'budget' ? 'active' : ''}" onclick="tmFilterPrice('budget')">Budget &lt;£5m</button>
                </div>
                ${display.length
                    ? `${renderTmWatchLegend()}<div class="tm-watch">${display.map(p => renderTmWatchRow(p, true)).join('')}</div>`
                    : `<div class="tm-market-empty">No players match this filter right now.</div>`}
                <div class="tm-watch-note">Your own players are in the column beside this one rather than repeated here.</div>
            </div>`;

            html += `</div>`;   // .tm-columns

            /* Who the game is actually buying and selling, under the two columns
               rather than above them: the squad watch is the part that needs a
               decision before tonight, and this is the context around it. Built
               from every player rather than playersWithPressure, whose
               ownership > 0.5% and minutes > 0 filters are right for a price
               watch and wrong for a leaderboard — the most-sold player in a
               gameweek is often one who has just stopped playing. */
            html += renderTmTransferBoard(allPlayers.map(p => ({
                ...p,
                posName: ['', 'GK', 'DEF', 'MID', 'FWD'][p.position] || '?',
                teamShort: (p.team || '???').substring(0, 3)
            })), squadIds);

            container.innerHTML = html;
            if (typeof lucide !== 'undefined') lucide.createIcons();
            startPriceLockCountdown();
        }

        // One row shape for both the squad watch and the market lists, so a player
        // reads identically wherever they appear.
        /* ===== Most transferred in and out =====

           The tab could say who was about to change price and not who the game
           was actually buying and selling, which is the first thing the official
           site puts in front of you and the thing every other FPL site leads
           with. They are not the same question: the price meter is net movement
           weighted against an ownership base, so a cheap defender with forty
           thousand buys can sit above a premium with four hundred thousand.

           Three deliberate differences from the panel beside it. This one counts
           the whole game rather than the players you do not own — leaving your
           own squad out of a "most transferred" list would be answering a
           question nobody asked, so squad members appear and are badged. It does
           not filter on ownership or minutes, because a leaderboard that quietly
           drops players is not a leaderboard. And it offers the season alongside
           the gameweek, since "who has been sold all season" and "who is being
           sold this week" are different and both are asked.

           The totals are real sums, not estimates: every transfer is one player
           in and one player out, so summing either column across all players
           gives the number of transfers made, and the two agree to the unit. */
        let tmTransferScope = 'gw';   // 'gw' | 'season'

        function tmSetTransferScope(scope) {
            tmTransferScope = scope === 'season' ? 'season' : 'gw';
            transferMarketRendered = false;
            renderTransferMarket();
        }

        // Start-of-season price against today's, for the row's £4.5 → £4.8 strip.
        // Needs no gameweek history — cost_change_start carries the whole move —
        // so the list stays cheap to build for six hundred players.
        function tmSeasonPriceMove(p) {
            return typeof pwPriceHistory === 'function' ? pwPriceHistory(p, null) : null;
        }

        function renderTmTransferBoard(players, squadIds) {
            const season = tmTransferScope === 'season';
            const inOf = p => (season ? p.transfersInTotal : p.transfersIn) || 0;
            const outOf = p => (season ? p.transfersOutTotal : p.transfersOut) || 0;

            const pool = (players || []).filter(p => inOf(p) > 0 || outOf(p) > 0);
            if (!pool.length) {
                return `<div class="tm-section tm-tb-section">
                    <div class="tm-section-header"><h2>⇄ Most transferred</h2></div>
                    <div class="tm-market-empty">No transfers recorded yet${season ? ' this season' : ' this gameweek'}.</div>
                </div>`;
            }

            const totalIn = pool.reduce((s, p) => s + inOf(p), 0);
            const totalOut = pool.reduce((s, p) => s + outOf(p), 0);
            const bought = pool.slice().sort((a, b) => inOf(b) - inOf(a)).slice(0, 10);
            const sold = pool.slice().sort((a, b) => outOf(b) - outOf(a)).slice(0, 10);
            const topCount = Math.max(inOf(bought[0]) || 0, outOf(sold[0]) || 0, 1);

            const column = (title, icon, cls, list, total, valueOf, otherOf) => `
                <div class="tm-tb-col">
                    <div class="tm-tb-col-head ${cls}">
                        <span class="tm-tb-col-title">${icon} ${escHTML(title)}</span>
                        <span class="tm-tb-col-total">${total.toLocaleString()}<em>total</em></span>
                    </div>
                    <div class="tm-tb-rows">
                        ${list.map((p, i) => renderTmTransferRow(p, i + 1, cls, valueOf(p), otherOf(p), topCount, squadIds, season)).join('')}
                    </div>
                </div>`;

            /* A real section with both columns inside it. The heading, the
               note and the two lists were three loose things stacked on the
               page, so the only edges anywhere near them belonged to the
               columns themselves.

               The period switch sits beside the title rather than out at the
               far right: it is what the whole section is counting, and at
               the other end of a 1200px header it read as page furniture.
               The icon is inline SVG rather than an <i data-lucide>, which
               is only an icon if lucide has loaded and run. */
            return `<section class="v2-section tm-tb-section">
                <div class="section-header tm-tb-head">
                    <h2>${v2Icon('swap')} Most transferred ${season ? 'this season' : 'this gameweek'}</h2>
                    <div class="tm-tb-scope" role="group" aria-label="Transfer period">
                        <button class="tm-tb-scope-btn ${season ? '' : 'active'}" onclick="tmSetTransferScope('gw')">This gameweek</button>
                        <button class="tm-tb-scope-btn ${season ? 'active' : ''}" onclick="tmSetTransferScope('season')">Season</button>
                    </div>
                </div>
                <div class="tm-watch-note">
                    <strong>${totalIn.toLocaleString()}</strong> transfers made ${season ? 'so far this season' : 'ahead of this deadline'} across every FPL manager.
                    Counts are the whole game, your own squad included.
                </div>
                <div class="tm-tb-cols">
                    ${column('Most bought', v2Icon('inbox'), 'in', bought, totalIn, inOf, outOf)}
                    ${column('Most sold', v2Icon('outbox'), 'out', sold, totalOut, outOf, inOf)}
                </div>
            </section>`;
        }

        function renderTmTransferRow(p, rank, cls, value, counter, topCount, squadIds, season) {
            const ident = { name: p.name, code: p.code, teamId: p.teamId, team: p.teamShort };
            // Net over the same period the column is counting, or the two numbers
            // in one row would be measuring different spans of the season.
            const net = season
                ? (p.transfersInTotal || 0) - (p.transfersOutTotal || 0)
                : (p.transfersIn || 0) - (p.transfersOut || 0);
            const period = season ? 'this season' : 'this gameweek';
            const move = tmSeasonPriceMove(p);
            const owned = squadIds && squadIds.has(p.id);
            // The bar is each player against the biggest number in either column,
            // so the two lists are on one scale and can be read against each other.
            const width = Math.max(2, Math.round((value / topCount) * 100));

            /* Where the price has been, in the space of a strip. A player at his
               opening price says so rather than printing the same number twice. */
            const priceStrip = move && move.netTenths !== 0
                ? `<span class="tm-tb-price ${move.netTenths > 0 ? 'up' : 'down'}"
                        data-tooltip="Started the season at £${move.start.toFixed(1)}m and is £${move.now.toFixed(1)}m now.">
                        £${move.start.toFixed(1)}<i>→</i>£${move.now.toFixed(1)}</span>`
                : `<span class="tm-tb-price flat" data-tooltip="Unchanged from his opening price.">£${p.price.toFixed(1)}m</span>`;

            return `<div class="tm-tb-row ${cls}">
                <span class="tm-tb-rank">${rank}</span>
                <div class="tm-tb-ident">
                    ${typeof v2IdentityHTML === 'function' ? v2IdentityHTML(ident) : ''}
                    <div class="tm-tb-info">
                        <div class="tm-tb-name-row">
                            <span class="tm-tb-name">${escHTML(p.name)}</span>
                            ${owned ? '<span class="tm-badge in-squad">SQUAD</span>' : ''}
                        </div>
                        <div class="tm-tb-sub">
                            <span>${escHTML(p.teamShort)}</span>
                            ${priceStrip}
                        </div>
                    </div>
                </div>
                <div class="tm-tb-num">
                    <span class="tm-tb-count">${value.toLocaleString()}</span>
                    <span class="tm-tb-net ${net >= 0 ? 'pos' : 'neg'}"
                        data-tooltip="Transfers in minus transfers out ${period}: ${counter.toLocaleString()} the other way.">
                        net ${net >= 0 ? '+' : '−'}${Math.abs(net).toLocaleString()}</span>
                    <div class="tm-tb-track"><i class="${cls}" style="width:${width}%"></i></div>
                </div>
            </div>`;
        }

        function renderTmWatchRow(p, isMarket) {
            const pct = p.threshold;
            const st = thresholdState(pct);
            const mag = Math.min(100, Math.abs(pct));
            const inSquad = !isMarket;
            const netStr = p.netTransfers > 0 ? `+${p.netTransfers.toLocaleString()}` : p.netTransfers.toLocaleString();

            // The bar grows from the left when a player is climbing and from the
            // right when sliding, so direction reads before the number does.
            const bar = `<div class="tm-thr-track">
                <div class="tm-thr-fill ${st.cls}" style="width:${mag}%"></div>
            </div>`;

            /* The position was a text pill on every row, a column's worth of
               width spent on four letters. It is the coloured edge down the
               left of the row now — same --position-* tokens as the pitch, so
               the two agree — and the club is its badge rather than three
               letters in a circle. */
            const posEdge = typeof v2PosEdgeClass === 'function' ? v2PosEdgeClass(p.position) : '';
            const ident = { name: p.name, code: p.code, teamId: p.teamId, team: p.teamShort };

            return `<div class="tm-watch-row ${st.cls} ${posEdge}">
                <div class="tm-watch-player">
                    ${typeof v2IdentityHTML === 'function' ? v2IdentityHTML(ident) : ''}
                    <div class="tm-player-info">
                        <div class="tm-player-name-row">
                            <span class="tm-player-name">${escHTML(p.name)}</span>
                            ${inSquad ? '<span class="tm-badge in-squad">SQUAD</span>' : ''}
                        </div>
                        <div class="tm-player-sub">
                            <span class="tm-team-name">${escHTML(p.teamShort)}</span>
                            <span class="tm-team-name">£${p.price.toFixed(1)}m</span>
                            <span class="tm-team-name" data-tooltip="Net transfers this gameweek across all FPL managers.">${escHTML(netStr)}</span>
                        </div>
                    </div>
                </div>
                <div class="tm-watch-thr">
                    <div class="tm-thr-head">
                        <span class="tm-thr-pct ${st.cls}">${pct > 0 ? '+' : ''}${Math.round(pct)}%</span>
                        <span class="tm-thr-state ${st.cls}">${st.text}</span>
                    </div>
                    ${bar}
                </div>
                <div class="tm-watch-act">
                    ${inSquad && pct <= -85
                        ? `<button class="tm-sell-btn" onclick="tmSellBeforeDrop(${p.id})">Sell before drop</button>`
                        : ''}
                </div>
            </div>`;
        }

        function renderTmRow(p, showOwnership, squadIds) {
            const pressureLabel = getPressureLabel(p.pressure);
            const pressurePct = Math.min(Math.abs(p.pressure) * 500, 100);
            const isInSquad = squadIds && squadIds.has(p.id);
            const pressureDir = p.pressure >= 0 ? 'rising' : 'falling';
            const pulseClass = pressurePct >= 95 ? ' pulse' : '';
            const pctCls = pressureLabel.cls === 'rise' ? 'rise' : pressureLabel.cls === 'fall' ? 'fall' : 'stable';

            // Consolidated price
            const gwCls = p.priceChangeGW > 0 ? 'up' : p.priceChangeGW < 0 ? 'down' : 'flat';
            const gwSign = p.priceChangeGW > 0 ? '+' : '';
            const seasonSign = p.priceChangeSeason > 0 ? '+' : '';

            // Net transfers
            const netStr = p.netTransfers > 0 ? `+${p.netTransfers.toLocaleString()}` : p.netTransfers.toLocaleString();
            const netCls = p.netTransfers > 0 ? 'positive' : p.netTransfers < 0 ? 'negative' : '';

            return `<tr class="${isInSquad ? 'tm-squad-row' : ''}">
                <td>
                    <div class="tm-player-cell">
                        <div class="tm-player-avatar ${p.posClass}">${p.teamShort}</div>
                        <div class="tm-player-info">
                            <div class="tm-player-name-row">
                                <span class="tm-player-name">${escHTML(p.name)}</span>
                                ${isInSquad ? '<span class="tm-badge in-squad">SQUAD</span>' : ''}
                            </div>
                            <div class="tm-player-sub">
                                <span class="tm-pos-pill ${p.posClass}">${p.posName}</span>
                                <span class="tm-team-name">${escHTML(p.team || '')}</span>
                            </div>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="tm-price-col">
                        <span class="tm-price-main">\u00a3${p.price.toFixed(1)}m${p.priceChangeGW !== 0 ? ` <span class="tm-price-delta ${gwCls}">${gwSign}${p.priceChangeGW.toFixed(1)}</span>` : ''}</span>
                        ${p.priceChangeSeason !== 0 ? `<span class="tm-price-season">Season ${seasonSign}${p.priceChangeSeason.toFixed(1)}</span>` : ''}
                    </div>
                </td>
                ${showOwnership ? `<td><div class="tm-own-cell"><span class="tm-own-ring">${ownershipRingSVG(p.ownership)}</span><span class="tm-own-pct">${p.ownership.toFixed(1)}%</span></div></td>` : ''}
                <td>${velocityIndicator(p.netTransfers)}</td>
                <td><span class="tm-net ${netCls}">${netStr}</span></td>
                <td>
                    <div class="tm-pressure-cell">
                        <span class="tm-heat-pct ${pctCls}">${Math.round(pressurePct)}%</span>
                        <div class="tm-heat-gauge"><div class="tm-heat-fill ${pressureDir}${pulseClass}" style="width:${pressurePct}%;"></div></div>
                        <span class="tm-badge ${pressureLabel.cls}">${pressureLabel.text}</span>
                    </div>
                </td>
            </tr>`;
        }

        function tmFilterPos(pos) {
            tmPosFilter = pos;
            tmPriceFilter = 'all';
            transferMarketRendered = false;
            renderTransferMarket();
        }

        function tmFilterPrice(tier) {
            tmPriceFilter = tmPriceFilter === tier ? 'all' : tier;
            tmPosFilter = 'all';
            transferMarketRendered = false;
            renderTransferMarket();
        }

        function tmSort(section, col) {
            const sortState = section === 'squad' ? tmSquadSort : section === 'rising' ? tmRisingSort : tmFallingSort;
            if (sortState.col === col) {
                sortState.asc = !sortState.asc;
            } else {
                sortState.col = col;
                sortState.asc = col === 'name';
            }
            transferMarketRendered = false;
            renderTransferMarket();
        }

        function tmSortList(list, sortState) {
            const { col, asc } = sortState;
            list.sort((a, b) => {
                let va = a[col], vb = b[col];
                if (col === 'name') { va = va || ''; vb = vb || ''; return asc ? va.localeCompare(vb) : vb.localeCompare(va); }
                va = va || 0; vb = vb || 0;
                return asc ? va - vb : vb - va;
            });
        }

