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
            const remainingSquad = selectedPlayers.filter(p => !sellIds.has(p.id));
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
                    <div id="twRail"></div>
                    <div id="twBudgetBar"></div>
                    <div class="twr-panel" id="twRecoPanel">
                        <div class="twr-head">
                            <div>
                                <div class="twr-title">Should I make a transfer?</div>
                                <div class="twr-sub">Prices every legal move over the next five gameweeks by what it adds to your starting eleven — including the option of doing nothing.</div>
                            </div>
                            <button class="twr-run" onclick="twRunRecommendation()">Get recommendation</button>
                        </div>
                        <div id="twRecoBody"></div>
                    </div>
                    <!-- Swapped in for the panel above on a Wildcard or Free Hit;
                         see wcSyncPanels(). One question on screen at a time. -->
                    <div class="twr-panel" id="wcPanel" hidden>
                        <div class="twr-head">
                            <div>
                                <div class="twr-title">Build my wildcard</div>
                                <div class="twr-sub" id="wcSub"></div>
                            </div>
                            <button class="twr-run" onclick="wcRunBuilder()">Build three squads</button>
                        </div>
                        <div id="wcBody"></div>
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
        function twMaxTransfers() { return transferState.wildcard ? 15 : 5; }

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
            { n: 1, key: 'plan',    icon: 'sliders', label: 'Plan',        hint: 'How many transfers, and at what cost' },
            { n: 2, key: 'out',     icon: 'outbox',  label: 'Who leaves',  hint: 'Pick the players you want to move on' },
            { n: 3, key: 'find',    icon: 'cart',    label: 'Replacements', hint: 'Quick picks, or search on your own terms' },
            { n: 4, key: 'compare', icon: 'scales',  label: 'Compare',     hint: 'The two of them, side by side' },
            { n: 5, key: 'confirm', icon: 'check',   label: 'Confirm',     hint: 'What the plan costs and what it buys' }
        ];

        /* One header shape for every step: what the step is, a hint, and the
           two ways out of it. Rendered into .twc-panel-head so it can be the
           sticky bar the panel scrolls under. */
        function twStepHead(opts) {
            const o = opts || {};
            const nav = [
                o.back ? `<button class="tw-back" onclick="${o.back.on}"${o.back.tip ? ` data-tooltip="${escHTML(o.back.tip)}"` : ''}>${v2Icon('up')} ${escHTML(o.back.label)}</button>` : '',
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
            return n >= 1 && n <= 5 ? n : 1;
        }

        /* Direction is what the animation needs: going forward the incoming
           panel arrives from the right, going back it arrives from the left,
           so the movement matches the rail above it rather than contradicting
           it. Set here, read once by the renderer, then cleared. */
        function twGoStep(n, opts) {
            const from = twStep();
            const to = Math.max(1, Math.min(5, n));
            transferState.step = to;
            transferState._stepDir = to === from ? 0 : (to > from ? 1 : -1);
            if (!opts || opts.render !== false) renderTWAll();
        }

        /* The furthest step this plan has actually reached, so the rail can
           offer a completed step as a way back without offering a step that
           has never been arrived at. A step is behind you only if the state it
           needs exists: there is no going back to Compare with nothing staged. */
        function twStepReachable(n) {
            if (n <= 1) return true;
            if (n === 2) return !!transferState.strategy;
            if (n === 3) return transferState.pending.length > 0;
            if (n === 4) return transferState.activeSlot >= 0 && !!transferState.previewPlayer;
            return transferState.pending.length > 0
                && transferState.pending.every(x => x.replacement);
        }

        function twRailGo(n) {
            if (!twStepReachable(n)) return;
            // Each step owns a mode; walking back has to put the mode back too,
            // or the pane renders step 3's market inside step 2's frame.
            if (n <= 2) { transferState.mode = 'squad'; transferState.previewPlayer = null; }
            else if (n === 3) { transferState.mode = 'market'; transferState.previewPlayer = null; }
            else if (n === 4) transferState.mode = 'compare';
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
            transferState.strategy = strategy;
            // Both chips waive hits and lift the transfer limit; only the
            // horizon tells them apart.
            transferState.wildcard = strategy === 'wildcard' || strategy === 'freehit';
            transferState.sellMode = strategy !== 'single';
            /* A Free Hit squad is judged over the one gameweek you keep it, so
               a horizon chosen under another plan cannot carry into it — five
               gameweeks of fixtures are irrelevant to a team you give back on
               Sunday. Clearing each slot's filters re-seeds them at the right
               window on the next read. */
            transferState.pending.forEach(s => { s.funnel = null; });
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
            const targets = selectedPlayers.filter(p => position ? p.position === position : true);
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

               Only the first is open. The rest are one click away, because
               three of these stacked is a wall of text in a panel whose job is
               to give an answer. */
            let twrBank = getTWBank();
            const detailFor = (m) => {
                if (typeof trRationale !== 'function') return '';
                const rat = trRationale(m, { bank: twrBank });
                twrBank = Math.round((twrBank + ((m.out.sellPrice || m.out.price) - m.in.price)) * 10) / 10;
                return rat ? trRenderCard(rat, { header: false }) : '';
            };

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
                <div class="twr-moves">
                    ${best.moves.map((m, i) => {
                        const detail = detailFor(m);
                        return `
                        <div class="twr-move-card">
                            <div class="twr-move">
                                <span class="twr-out">${escHTML(m.out.name)}<small>£${(m.out.sellPrice || m.out.price).toFixed(1)}m · ${m.outXP.toFixed(1)} xP</small></span>
                                <span class="twr-arrow">→</span>
                                <span class="twr-in">${escHTML(m.in.name)}<small>£${m.in.price.toFixed(1)}m · ${m.inXP.toFixed(1)} xP</small></span>
                                <span class="twr-gain pos">+${m.gain.toFixed(1)}<small>to your XI</small></span>
                            </div>
                            <p class="twr-why">${escHTML(twMoveReason(m, gws))}</p>
                            ${detail ? `<details class="twr-detail"${i === 0 ? ' open' : ''}>
                                <summary>The case for it</summary>
                                ${detail}
                            </details>` : ''}
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
                const soldPlayer = (selectedPlayers || []).find(p => p.id === outs[i]);
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

        /* ===== The wildcard builder's screen =====

           The model is in scripts/wildcard-builder.js; everything here is
           rendering and the hand-off into the pending list.

           On a wildcard the recommender above is answering the wrong question.
           It prices one move at a time against a free-transfer count that a
           wildcard waives, so "hold — no transfer worth making" is not merely
           unhelpful on the week you are rebuilding fifteen players, it is
           false. The two panels therefore swap rather than stack: pick Wildcard
           or Free Hit and the question on screen becomes the one you are
           actually asking. */

        let wcLastResult = null;

        // Show the panel that matches the plan. Called from renderTWAll, which
        // runs on every interaction — so it only ever toggles visibility and
        // never rewrites a body, or a result would vanish on the next click.
        function wcSyncPanels() {
            const wc = !!transferState.wildcard;
            const reco = document.getElementById('twRecoPanel');
            const panel = document.getElementById('wcPanel');
            if (reco) reco.hidden = wc;
            if (panel) panel.hidden = !wc;
            const sub = document.getElementById('wcSub');
            if (sub) {
                sub.textContent = transferState.strategy === 'freehit'
                    ? 'Three squads for the single gameweek you keep this one, split on how many premiums you carry — and what each choice costs against the best squad found.'
                    : 'Three squads for the next six gameweeks, split on how many premiums you carry — and what each choice costs against the best squad found.';
            }
        }

        function wcRunBuilder() {
            const el = document.getElementById('wcBody');
            if (!el) return;
            if (typeof wcBuildPlans !== 'function') {
                el.innerHTML = '<div class="twr-empty">The wildcard builder did not load.</div>';
                return;
            }
            if (!selectedPlayers || !selectedPlayers.length) {
                el.innerHTML = '<div class="twr-empty">Load a squad first — the budget comes from what your players are worth plus your bank.</div>';
                return;
            }
            el.innerHTML = '<div class="twr-loading">Building three squads and pricing each against the best one found…</div>';
            // Yield once so the loading line paints before the search blocks.
            setTimeout(() => {
                let r = null;
                try {
                    r = wcBuildPlans({
                        squad: selectedPlayers,
                        bank: getTWBank(),
                        horizon: transferState.strategy === 'freehit' ? 1 : undefined
                    });
                } catch (e) {
                    if (typeof reportError === 'function') reportError(e, 'wcRunBuilder');
                    el.innerHTML = `<div class="twr-empty">Could not build a wildcard: ${escHTML(e.message)}</div>`;
                    return;
                }
                if (!r || !r.ok) {
                    const why = {
                        'no-gameweeks': 'There are no upcoming gameweeks left to plan for.',
                        'no-budget': 'Your squad and bank do not add up to a budget yet.',
                        'thin-pool': 'Too few players have enough minutes to build a squad from.',
                        'no-legal-squad': 'No legal fifteen fits that budget.'
                    }[r && r.reason] || 'Something went wrong building the squads.';
                    el.innerHTML = `<div class="twr-empty">${escHTML(why)}</div>`;
                    return;
                }
                wcLastResult = r;
                el.innerHTML = wcRenderPlans(r);
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }, 30);
        }

        function wcRenderPlans(r) {
            const span = `GW${r.gws[0]}${r.gws.length > 1 ? `–GW${r.gws[r.gws.length - 1]}` : ''}`;
            const premiumNames = r.axes.slice(0, 3).map(p => p.name).join(', ');

            /* The unconstrained best can hold three premiums, in which case no
               plan reaches the ceiling and all three deltas are negative with
               nothing on screen saying why. */
            const ceilingNote = r.ceilingPremiums > 2
                ? ` The best squad found actually carries ${r.ceilingPremiums} premiums, which is why none of the three below reaches it.`
                : '';

            /* What the backtest actually licenses this screen to claim.

               tools/wildcard-backtest.mjs rebuilt a wildcard at thirteen points
               of the 2025/26 season and totalled what the fifteen really
               returned. The premium ladder held: the two-premium squad beat the
               no-premium one in 11 of 13, by an average of 26.9 points against
               the 25.9 the model predicted. So the direction and the typical
               size are earned.

               What is NOT earned is precision on any single wildcard. The gap's
               standard deviation across those thirteen was 30 — larger than the
               gap itself — and the size the model predicted had no relationship
               to the size that arrived (r = -0.09). Saying "-9.1" and stopping
               invites a manager to read it as a forecast for their six
               gameweeks, which is the one thing the evidence says it is not. */
            const head = `<div class="wc-intro">
                <p>Each squad is the best the model can build while holding exactly that many premiums —
                   anyone at £${r.premiumFloor.toFixed(1)}m or more up front, which today means ${escHTML(premiumNames)} and a few others.
                   Scored over ${span} on what your eleven projects, plus the captain again, plus a discounted bench.${escHTML(ceilingNote)}</p>
                <p class="twr-caveat">Backtested across the 2025/26 season, carrying two premiums beat carrying none in 11 wildcards out of 13,
                   by an average of 27 points over six gameweeks — almost exactly what the model predicted. It went the other way in the other two.
                   Treat the gaps below as what the choice is worth on average, not as what it will be worth for you this time.</p>
                ${!r.distinct ? `<p class="twr-caveat">These plans came back nearly identical, which means the premium question barely matters this week — not that the model is confused.</p>` : ''}
            </div>`;

            return head + `<div class="wc-cards">${r.plans.map((p, i) => wcRenderPlanCard(p, i, r)).join('')}</div>`;
        }

        function wcRenderPlanCard(p, idx, r) {
            const POS = ['', 'GK', 'DEF', 'MID', 'FWD'];
            const isBest = p.deltaVsBest === 0;
            const premiumIds = new Set(p.premiums.map(x => x.id));

            const line = pos => {
                const men = p.squad.filter(x => x.position === pos).sort((a, b) => b.price - a.price);
                return `<div class="wc-line">
                    <span class="wc-line-l ${POS[pos].toLowerCase()}">${POS[pos]}</span>
                    <span class="wc-line-men">${men.map(x =>
                        `<span class="wc-man${premiumIds.has(x.id) ? ' prem' : ''}" data-tooltip="${escHTML(`${x.name} · ${x.team} · £${x.price.toFixed(1)}m`)}">${escHTML(x.name)}<small>${x.price.toFixed(1)}</small></span>`
                    ).join('')}</span>
                </div>`;
            };

            const cell = (label, value, tip, cls) => `<div class="wc-metric" data-tooltip="${escHTML(tip)}">
                <span class="wc-metric-v ${cls || ''}">${escHTML(value)}</span>
                <span class="wc-metric-l">${escHTML(label)}</span>
            </div>`;

            // Only the players who actually change become transfers. Selling all
            // fifteen and buying eleven of them back is the same squad and four
            // pointless rows in the plan rail.
            const changes = p.changes == null ? p.squad.length : p.changes;

            return `<div class="wc-card${isBest ? ' best' : ''}">
                <div class="wc-card-head">
                    <div>
                        <div class="wc-card-title">${escHTML(p.label)}${isBest ? '<span class="wc-best">best found</span>' : ''}</div>
                        <div class="wc-card-note">${escHTML(p.note)}</div>
                    </div>
                    <div class="wc-card-score" data-tooltip="${escHTML(`Projected over the window, counting the captain and a discounted bench. The best squad found scores ${r.ceiling}.${isBest ? '' : ` Backtested over the 2025/26 season this gap was right on average — but it swung by about 30 points either way from one wildcard to the next, so read it as the long-run expectation rather than a forecast for your six gameweeks.`}`)}">
                        <span class="wc-card-obj">${p.objective.toFixed(1)}</span>
                        <span class="wc-card-delta ${p.deltaVsBest === 0 ? 'even' : 'down'}">${p.deltaVsBest === 0 ? 'the best found' : `${p.deltaVsBest.toFixed(1)} vs best`}</span>
                    </div>
                </div>

                <div class="wc-metrics">
                    ${cell('In premiums', p.premiums.length ? `${p.premiumSpendPct.toFixed(0)}%` : '—',
                        p.premiums.length
                            ? `£${p.premiumSpend.toFixed(1)}m of £${p.spend.toFixed(1)}m spent on ${p.premiums.map(x => x.name).join(' and ')}.`
                            : 'No player at or above the premium price. The budget is spread across the fifteen.',
                        p.premiumSpendPct > 30 ? 'warn' : '')}
                    ${cell('Left in bank', `£${p.bankLeft.toFixed(1)}m`,
                        p.bankLeft > 1.5
                            ? `Nothing this plan is allowed to buy is worth the £${p.bankLeft.toFixed(1)}m still sitting there — with the premiums excluded, the money has nowhere useful to go.`
                            : 'What is left once the fifteen are paid for.',
                        p.bankLeft > 1.5 ? 'warn' : '')}
                    ${cell('Transfers', String(changes),
                        `${changes} of your current fifteen would change. The rest you already own and would keep.`)}
                    ${cell('Shape', p.formation || '—', `The best legal eleven this squad fields in GW${r.gws[0]}, captaining ${p.captain ? p.captain.name : 'its best player'}.`)}
                </div>

                <div class="wc-lines">${line(1)}${line(2)}${line(3)}${line(4)}</div>

                <div class="wc-gws">
                    ${p.byGw.map(g => `<span class="wc-gw" data-tooltip="${escHTML(`Projected ${g.points} with ${g.captain} captained, in a ${g.formation}.`)}">
                        <small>GW${g.gw}</small>${g.points.toFixed(0)}</span>`).join('')}
                </div>

                <button class="twr-apply" onclick="wcApplyPlan(${idx})"
                    data-tooltip="Stage the ${changes} transfers this squad needs. Nothing is submitted — you review them in the plan below first.">Stage these ${changes} transfers</button>
            </div>`;
        }

        /* Turn a plan into pending transfers.

           Only the difference is staged. A plan that keeps eleven of your
           current players is eleven players you do not transfer, and selling
           the whole squad to buy most of it back would fill the plan rail with
           rows that change nothing. Outgoing and incoming are paired by
           position, which always works out: both squads are 2/5/5/3, so the
           players leaving and arriving match position for position. */
        function wcApplyPlan(idx) {
            const plan = wcLastResult && wcLastResult.plans[idx];
            if (!plan) return;

            const targetIds = new Set(plan.squad.map(p => p.id));
            const haveIds = new Set(selectedPlayers.map(p => p.id));
            const outByPos = { 1: [], 2: [], 3: [], 4: [] };
            const inByPos = { 1: [], 2: [], 3: [], 4: [] };
            selectedPlayers.filter(p => !targetIds.has(p.id)).forEach(p => outByPos[p.position].push(p));
            plan.squad.filter(p => !haveIds.has(p.id)).forEach(p => inByPos[p.position].push(p));

            /* Both squads are 2/5/5/3, so the players leaving and arriving
               match position for position and the pairing is exact. If they do
               not — a half-loaded squad is the way that happens — the loop
               below would quietly drop whoever it could not pair and stage a
               plan that builds a different squad to the one on the card. Refuse
               instead: a wrong squad staged silently is worse than no squad. */
            const paired = [1, 2, 3, 4].every(pos => outByPos[pos].length === inByPos[pos].length);
            if (!paired) {
                updateStatus('That squad cannot be staged against the team currently loaded — reload your team and build again', 'error');
                return;
            }

            const pending = [];
            for (const pos of [1, 2, 3, 4]) {
                outByPos[pos].forEach((out, i) => pending.push({ soldPlayer: out, replacement: inByPos[pos][i] }));
            }
            if (!pending.length) {
                updateStatus('That squad is the one you already have — nothing to transfer', 'info');
                return;
            }

            transferState.pending = pending;
            transferState.activeSlot = -1;
            transferState.mode = 'squad';
            transferState.candidateCache = {};
            transferState.previewPlayer = null;
            renderTWAll();
            updateStatus(`Staged ${pending.length} transfer${pending.length === 1 ? '' : 's'} from the ${plan.label.toLowerCase()} squad — review before confirming`, 'success');
        }

        function renderTWAll() {
            const step = twStep();
            const box = document.getElementById('twContainer');
            if (box) box.dataset.twStep = String(step);
            renderTWRail();
            wcSyncPanels();
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
            for (const p of selectedPlayers) if (!soldIds.has(p.id)) ids.add(p.id);
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
            for (const p of selectedPlayers) {
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
            const strategy = transferState.strategy || 'single';
            const ft = twFreeTransfers();
            const count = transferState.pending.length;
            const filled = transferState.pending.filter(s => s.replacement).length;
            const allFilled = count > 0 && filled === count;
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

            el.innerHTML = `
                <div class="twc-head">
                    <!-- The plan is step 1's question and it has been answered by
                         the time this bar is on screen. Four chips here as well
                         would be the same choice offered twice, in two places,
                         with no way to tell which one is the real control. It
                         reports instead, and sends you back to step 1 to change. -->
                    <button class="twc-plan-chip" onclick="twRailGo(1)"
                        data-tooltip="${escHTML(((TW_STRATEGIES.find(x => x.id === strategy) || {}).tip) || '')} Click to change plan.">
                        <span class="twc-plan-chip-l">Plan</span>
                        <span class="twc-plan-chip-v">${escHTML((TW_STRATEGIES.find(x => x.id === strategy) || {}).label || 'Single')}</span>
                    </button>
                    <div class="twc-stat">
                        <span class="twc-stat-l">Transfers</span>
                        <span class="twc-stat-v">${count}${wc ? ` <span class="twc-unl">of 15 · unlimited</span>` : ` / ${ft} free`}</span>
                    </div>
                    <div class="twc-stat">
                        <span class="twc-stat-l">Points hit</span>
                        <span class="twc-stat-v ${hit > 0 ? 'danger' : ''}">${wc ? 'Waived' : hit > 0 ? `−${hit} pts` : '0 pts'}</span>
                    </div>
                    <div class="twc-stat">
                        <span class="twc-stat-l">In the bank</span>
                        <span class="twc-stat-v ${itbClass}">£${itb.toFixed(1)}m</span>
                    </div>
                    <div class="twc-actions">
                        ${count ? `<button class="rc-btn" onclick="twOpenPreview()" data-tooltip="See the squad these transfers would leave you with, on a pitch, with its value and projection.">Preview squad</button>` : ''}
                        ${count ? `<button class="rc-btn" onclick="twClearPending()" data-tooltip="Discard every pending transfer">Clear</button>` : ''}
                        <button class="rc-btn primary" ${!allFilled ? 'disabled' : ''} onclick="twShowSummary()" data-tooltip="${allFilled ? 'Review the finished plan' : 'Every transfer needs a replacement before you can review'}">Summary →</button>
                    </div>
                </div>
                ${filled ? `<div class="twc-plan">${cart}</div>` : ''}`;
        }

        /* ===== Step 3's left column · who you are replacing =====

           Which player the market on the right belongs to used to be findable
           only in a 24px-tall plan row saying "Tzolakis → Choose…", and
           switching between two open swaps meant hitting the right one of
           those. They are cards here, in their clubs' colours, the one being
           worked on outlined — the same card the market shows on the other
           side, so a swap is two of the same object rather than a line of
           text pointing at a list. */
        function twRenderOutRail(el) {
            const gws = twPlanGWs(3);
            const cards = transferState.pending.map((slot, i) => {
                const o = slot.soldPlayer;
                const active = i === transferState.activeSlot;
                const budget = twSlotBudget(i);
                const inP = slot.replacement;
                return `<button class="tw-outc${active ? ' is-active' : ''}${inP ? ' is-filled' : ''}"
                    onclick="twSelectSlot(${i})"
                    data-tooltip="${inP ? escHTML(`${o.name} out, ${inP.name} in — click to pick someone else`) : escHTML(`Show replacements for ${o.name}`)}">
                    <span class="tw-outc-hero">${typeof v2PlayerHeroHTML === 'function'
                        ? v2PlayerHeroHTML({ ...o, price: o.sellPrice || o.price },
                            { size: 'compact', chip: String(i + 1) })
                        : escHTML(o.name)}</span>
                    <span class="tw-outc-foot">
                        ${inP
                            ? `<span class="tw-outc-in">${v2Icon('check')} ${escHTML(inP.name)}</span>`
                            : `<span class="tw-outc-open">Needs a replacement</span>`}
                        <span class="tw-outc-budget">£${budget.toFixed(1)}m</span>
                    </span>
                    <span class="tw-outc-xp" data-tooltip="What ${escHTML(o.name)} projects over the next ${gws.length} gameweeks.">${twXPOver(o, gws).toFixed(1)}<i>xP</i></span>
                </button>`;
            }).join('');

            const open = transferState.pending.filter(x => !x.replacement).length;

            el.innerHTML = `<div class="twc-panel tw-outrail">
                <div class="twc-panel-head">
                    <span class="twc-panel-title">${v2Icon('outbox')} Swapping out</span>
                    <span class="twc-panel-hint">${transferState.pending.length} ${transferState.pending.length === 1 ? 'player' : 'players'}</span>
                </div>
                <div class="twc-panel-body">
                    <div class="tw-outc-list">${cards}</div>
                    ${open > 1 ? `<button class="tw-outrail-fill" onclick="twFillAllSlots()" data-tooltip="Pick the best affordable replacement for every open slot, sharing the bank across them.">${v2Icon('bolt')} Fill all ${open} slots</button>` : ''}
                    <button class="tw-outrail-add" onclick="twRailGo(2)" data-tooltip="Go back to your squad and pick someone else to move on.">${v2Icon('up')} Change who is leaving</button>
                    ${open > 1 ? `<div class="tw-outrail-note">Or pick any of them to choose one at a time.</div>` : ''}
                </div>
            </div>`;
        }

        function renderTWSquadPane() {
            const el = document.getElementById('twSquadPane');
            if (!el) return;
            /* On step 3 this column stops being the squad and becomes the
               players you are replacing, beside the market that replaces them. */
            if (twStep() === 3 && transferState.pending.length) return twRenderOutRail(el);
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
                const players = selectedPlayers.filter(p => p.position === pos.type);
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
                const player = selectedPlayers.find(p => p.id === playerId);
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
            /* Swap is a decision on Single — there is nothing else to collect,
               so it carries you to the replacements. Under a plan that takes
               several players it is one of a set, and the step stays where the
               set is being built until you say you are done. */
            twGoStep(transferState.sellMode ? 2 : 3);
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
            /* Step 2 is the squad pane's screen; this one is not on it. */
            el.innerHTML = '';
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
                    next: chosen ? { label: 'Who leaves', on: 'twGoStep(2)', tip: `You are on ${chosenLabel}. Pick another card to change it.` } : null
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

            const row = (label, a, b, higherBetter, tip) => {
                const na = parseFloat(String(a).replace('%', '')) || 0;
                const nb = parseFloat(String(b).replace('%', '')) || 0;
                const eq = Math.abs(na - nb) < 0.005;
                const aWins = eq ? false : (higherBetter ? na > nb : na < nb);
                return `<div class="twh-row">
                    <div class="twh-a ${aWins ? 'win' : ''}">${a}</div>
                    <div class="twh-l" ${tip ? `data-tooltip="${escHTML(tip)}"` : ''}>${label}</div>
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

            // Full-depth profile per player — the same AI report, price watch,
            // team context and opponent-form sections the Squad Analysis inline
            // card shows, reused here so "comparing two players" means the same
            // thing everywhere on this page instead of this one screen falling
            // back to five raw stat rows. The candidate never had analyzePlayer()
            // run on them (they're not in your squad), so getPlayerAnalysis()
            // runs it fresh; their recommendation box and replacement suggestions
            // are squad-decision language ("transfer out before GW6") that makes
            // no sense for someone you're evaluating to buy, so both are switched
            // off for that side only.
            const soldProfile = typeof buildPlayerFullProfileHTML === 'function' && typeof getPlayerAnalysis === 'function'
                ? buildPlayerFullProfileHTML(sold, getPlayerAnalysis(sold), { header: false, replacements: false, context: 'squad' })
                : '';
            const candProfile = typeof buildPlayerFullProfileHTML === 'function' && typeof getPlayerAnalysis === 'function'
                ? buildPlayerFullProfileHTML(cand, getPlayerAnalysis(cand), { header: false, recommendation: false, replacements: false, context: 'candidate' })
                : '';

            const blocked = !!blockedReason;
            el.innerHTML = `<div class="twc-panel">
                ${twStepHead({
                    icon: 'scales', title: `${sold.name} vs ${cand.name}`,
                    back: { label: 'Replacements', on: 'twBackToMarket()', tip: 'Back to the replacement list' },
                    next: { label: `Confirm ${cand.name}`, on: 'twConfirmPick()',
                            disabled: blocked, tip: blockedReason || `Put ${cand.name} in for ${sold.name}.` }
                })}
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

                    <div class="twh-chart"><canvas id="twRadarCanvas"></canvas></div>
                    <div class="twh-chart-note">Each axis is scaled against a strong benchmark, not against each other — two weak players do not both look elite.</div>

                    <div class="twh-grid">
                        ${row(`Projected (${planGWs.length} GWs)`, soldXP.toFixed(1), candXP.toFixed(1), true, 'Projected points over the same upcoming gameweeks for both.')}
                        ${row('Form', formS.toFixed(1), formC.toFixed(1), true, isPreseason ? 'Points per game last season.' : 'Average points over the last 30 days.')}
                        ${row('Chance of starting', Math.round(mS.pStart * 100) + '%', Math.round(mC.pStart * 100) + '%', true, 'Likelihood of starting, from minutes per appearance and fitness.')}
                        ${row('Price', '£' + (sold.sellPrice || sold.price).toFixed(1) + 'm', '£' + cand.price.toFixed(1) + 'm', false, 'Selling price against buying price.')}
                        ${statRows}
                    </div>

                    <div class="twh-chart"><canvas id="twFdrCanvas"></canvas></div>
                    <div class="twh-chart-note">Fixture difficulty over the next ${fdrGWs.length} gameweeks — lower is easier. A gap means no fixture.</div>

                    <div class="twh-deep-label">Full profile</div>
                    <div class="twh-deep">
                        <div class="twh-deep-col out">
                            <div class="twh-deep-col-head out">OUT · ${escHTML(sold.name)}</div>
                            ${soldProfile}
                        </div>
                        <div class="twh-deep-col in">
                            <div class="twh-deep-col-head in">IN · ${escHTML(cand.name)}</div>
                            ${candProfile}
                        </div>
                    </div>

                </div>
            </div>`;

            twDrawComparisonCharts(sold, cand, fdrGWs);
        }

        function twDrawComparisonCharts(sold, cand, fdrGWs) {
            /* Chart.js comes from a CDN, and a CDN is a thing that can be
               blocked — by an extension, a corporate proxy, or a bad minute.
               Returning early left the reserved chart box and its caption on
               screen as a tall empty rectangle explaining a picture that was
               never drawn. Take both away instead. */
            if (typeof Chart === 'undefined') {
                document.querySelectorAll('.twh-chart, .twh-chart-note').forEach(n => { n.hidden = true; });
                return;
            }
            if (_twRadarChart) { _twRadarChart.destroy(); _twRadarChart = null; }
            if (_twFdrChart) { _twFdrChart.destroy(); _twFdrChart = null; }
            if (typeof applyChartDefaults === 'function') applyChartDefaults();

            const radar = document.getElementById('twRadarCanvas');
            if (radar) {
                const aS = twRadarAxes(sold), aC = twRadarAxes(cand);
                const labels = Object.keys(aS);
                _twRadarChart = new Chart(radar.getContext('2d'), {
                    type: 'radar',
                    data: {
                        labels,
                        datasets: [
                            { label: sold.name, data: labels.map(k => aS[k]), borderColor: '#94a3b8', backgroundColor: 'rgba(148,163,184,.22)', pointBackgroundColor: '#94a3b8' },
                            { label: cand.name, data: labels.map(k => aC[k]), borderColor: 'var(--color-primary)', backgroundColor: 'rgba(0,220,130,.22)', pointBackgroundColor: 'var(--color-primary)' }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        scales: { r: { min: 0, max: 1, ticks: { display: false }, pointLabels: { font: { size: 10 } } } },
                        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } }
                    }
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
            const kept = selectedPlayers.filter(p => !outIds.has(p.id));
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
            const oldXI = selectedPlayers.filter(p => !p.onBench);

            return {
                squad, xi, bench, counts,
                // The shape that eleven actually plays, for the preview modal.
                formation: solved && solved.formation ? solved.formation : null,
                value: squad.reduce((s, p) => s + p.price, 0),
                oldValue: selectedPlayers.reduce((s, p) => s + p.price, 0),
                xiXP: xi.reduce((s, p) => s + predictedGWPoints(p), 0),
                oldXiXP: oldXI.reduce((s, p) => s + predictedGWPoints(p), 0),
                benchXP: bench.reduce((s, p) => s + predictedGWPoints(p), 0),
                overStacked: Object.keys(byTeam).filter(t => byTeam[t] > 3).map(t => teams[t]?.short_name || '?'),
                legal: counts[1] === 2 && counts[2] === 5 && counts[3] === 5 && counts[4] === 3
            };
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

            const card = p => `<div class="twp-card ${p.isIncoming ? 'in' : ''}">
                <div class="twp-card-name">${escHTML(p.name)}${p.isIncoming ? '<span class="twp-in">IN</span>' : ''}</div>
                <div class="twp-card-sub">${escHTML(p.team)} · £${p.price.toFixed(1)}m</div>
                <div class="twp-card-xp">${predictedGWPoints(p).toFixed(1)}<span class="twp-u">xP</span></div>
            </div>`;
            const rowFor = n => `<div class="twp-row">${xi.filter(p => p.position === n).map(card).join('')}</div>`;

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

                <div class="twp-pitch">${rowFor(4)}${rowFor(3)}${rowFor(2)}${rowFor(1)}
                    <div class="twp-bench"><div class="twp-bench-l">Bench</div><div class="twp-row">${bench.map(card).join('')}</div></div>
                </div>
            </div>`;
        }

        // ===== Transfer Control Room — Actions =====

        function twPickOutPlayer(playerId) {
            const player = selectedPlayers.find(p => p.id === playerId);
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
            twGoStep(3);
        }

        function twSelectSlot(idx) {
            if (idx < 0 || idx >= transferState.pending.length) return;
            transferState.activeSlot = idx;
            transferState.mode = 'market';
            transferState.previewPlayer = null;
            twGoStep(3);
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
            twGoStep(4);
        }

        function twBackToMarket() {
            transferState.previewPlayer = null;
            transferState.mode = 'market';
            twGoStep(3);
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
                twGoStep(3);
            } else {
                transferState.mode = 'summary';
                transferState.activeSlot = -1;
                twGoStep(5);
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
                twGoStep(3);
            } else {
                transferState.mode = 'summary';
                transferState.activeSlot = -1;
                twGoStep(5);
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

        function twShowSummary() {
            if (!transferState.pending.every(s => s.replacement)) return;
            if (transferState.pending.length === 0) return;
            transferState.mode = 'summary';
            twGoStep(5);
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

            const stat = (label, value, cls, tip) =>
                `<div class="tw-conf-stat" data-tooltip="${escHTML(tip)}">
                    <span class="tw-conf-stat-l">${escHTML(label)}</span>
                    <span class="tw-conf-stat-v ${cls || ''}">${value}</span>
                </div>`;

            const n = transferState.pending.length;

            el.innerHTML = `<div class="twc-panel tw-step-panel">
                ${twStepHead({
                    icon: 'check', title: `Confirm your ${n === 1 ? 'transfer' : 'transfers'}`,
                    hint: `Judged over ${escHTML(span)}`,
                    back: { label: 'Edit', on: 'twBackFromSummary()' },
                    extra: `<button class="tw-back" onclick="renderTransferWizard()" data-tooltip="Clear the plan and go back to step 1.">${v2Icon('refresh')} Start over</button>`,
                    next: { label: `Confirm ${n === 1 ? 'transfer' : 'transfers'}`, on: 'twOpenConfirmGuard()',
                            tip: 'Apply these swaps to your squad across EasyFPL.' }
                })}
                <div class="twc-panel-body">
                    <div class="tw-conf-stats">
                        ${stat('What it gains', `${gain > 0 ? '+' : ''}${gain.toFixed(1)} pts`,
                            gain > 0.3 ? 'up' : gain < -0.3 ? 'down' : '',
                            `Projected points these ${n === 1 ? 'players' : 'swaps'} add across ${span}, before any hit.`)}
                        ${stat('What it costs', hit > 0 ? `\u2212${hit} pts` : transferState.wildcard ? 'Waived' : '0 pts',
                            hit > 0 ? 'down' : '',
                            transferState.wildcard
                                ? 'Your chip waives every hit this week.'
                                : hit > 0 ? `${n} transfers against ${twFreeTransfers()} free, at 4 points each beyond that.` : 'Inside your free transfers.')}
                        ${stat('Left in the bank', `\u00a3${itb.toFixed(1)}m`, itb < 0 ? 'down' : '',
                            itb < 0 ? 'This plan spends more than you have.' : 'What remains once every transfer is made.')}
                    </div>

                    <div class="tw-conf-net ${netCls}">
                        <span class="tw-conf-net-v">${net > 0 ? '+' : ''}${net.toFixed(1)}</span>
                        <span class="tw-conf-net-t">${net > 0.3
                            ? `Worth making. The plan is ${net.toFixed(1)} points ahead over ${escHTML(span)}${hit > 0 ? ` even after the ${hit}-point hit` : ''}.`
                            : net < -0.3
                                ? `Not worth it on projection. The plan is ${Math.abs(net).toFixed(1)} points behind over ${escHTML(span)}${hit > 0 ? ` once the ${hit}-point hit is counted` : ''}.`
                                : `Too close to call over ${escHTML(span)} \u2014 within half a point either way. Something other than projection has to decide it.`}</span>
                    </div>

                    <div class="tw-conf-swaps">${swaps}</div>

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
            twConfirmedClear();
            twConfirmedResult = null;
            updateStatus('Transfers taken back out of your EasyFPL squad \u2014 reloading your real one', 'success');
            if (typeof loadTeamById === 'function') { loadTeamById(); return; }
            location.reload();
        }

        /* ===== Confirming =====

           EasyFPL cannot make a transfer. FPL has no public write API, so a
           swap agreed here exists only here until the manager makes it on
           fantasy.premierleague.com as well — and a squad that is right on
           this site and wrong on theirs is worse than no plan, because every
           number on every page would then be describing a team they do not
           own. So confirming says that first, in as many words, and needs it
           acknowledged before it writes anything. */
        function twOpenConfirmGuard() {
            if (!transferState.pending.length) return;
            if (!transferState.pending.every(x => x.replacement)) return;
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
                        <div class="tw-guard-actions">
                            <button class="tw-back" onclick="twCloseConfirmGuard()">Cancel</button>
                            <button class="tw-next" id="twGuardGo" disabled onclick="twApplyConfirmed()">
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
           what picks payloads carry and applyConfirmedSwaps() folds these
           straight into one. */
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
            twGoStep(5);
            updateStatus(`${moves.length} transfer${moves.length === 1 ? '' : 's'} applied on EasyFPL — now make ${moves.length === 1 ? 'it' : 'them'} on the FPL site`, 'success');
        }

        let twConfirmedResult = null;

        /* Swap the players in the page's own state, in the outgoing player's
           slot so the formation, the captaincy and the bench order survive. */
        function twApplySwapsLocally(moves) {
            moves.forEach(m => {
                const idx = selectedPlayers.findIndex(p => p.id === m.outId);
                if (idx < 0) return;
                const incoming = allPlayers.find(p => p.id === m.inId);
                if (!incoming) return;
                const slot = selectedPlayers[idx];
                selectedPlayers[idx] = {
                    ...incoming,
                    isCaptain: slot.isCaptain, isVice: slot.isVice,
                    onBench: slot.onBench, pickPosition: slot.pickPosition,
                    multiplier: slot.multiplier,
                    sellPrice: m.inPrice / 10
                };
                if (picksData && Array.isArray(picksData.picks)) {
                    const pk = picksData.picks.find(x => x.element === m.outId);
                    if (pk) { pk.element = m.inId; pk.selling_price = m.inPrice; pk.purchase_price = m.inPrice; }
                    if (picksData.entry_history) {
                        picksData.entry_history.bank += m.outPrice - m.inPrice;
                    }
                }
            });

            // Every tab is built from selectedPlayers, so all of them are stale.
            if (typeof analyzeTeam === 'function') analyzeTeam();
            transferRendered = false;
            lineupRendered = false;
            draftTabRendered = false;
        }

        function twBackFromSummary() {
            transferState.mode = 'squad';
            transferState.activeSlot = -1;
            renderTWAll();
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
            
            if (selectedPlayers.length > 0) {
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

        /* The same tiers price-watch.js uses, so the two panels cannot describe
           one player differently. Anything past the line is due tonight; PW_CLOSE
           short of it is a watch item and deliberately not a forecast. */
        function thresholdState(pct) {
            const due = typeof PW_DUE === 'number' ? PW_DUE : 100;
            const close = typeof PW_CLOSE === 'number' ? PW_CLOSE : 80;
            if (pct >= due) return { cls: 'rise-imminent', text: 'Rises tonight', short: 'Rising' };
            if (pct >= close) return { cls: 'rise', text: 'Climbing', short: 'Climbing' };
            if (pct <= -due) return { cls: 'drop-imminent', text: 'Drops tonight', short: 'Dropping' };
            if (pct <= -close) return { cls: 'drop', text: 'Sliding', short: 'Sliding' };
            return { cls: 'stable', text: 'Safe', short: 'Safe' };
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

        function tmSellBeforeDrop(playerId) {
            // Switch first: renderTransferWizard() resets transferState on its first
            // run, so a slot staged beforehand would be wiped before it was drawn.
            switchTab('transfer');
            twPickOutPlayer(playerId);
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
        let tmShowAllRising = false;
        let tmShowAllFalling = false;

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

        function tmToggleViewAll(section) {
            if (section === 'rising') tmShowAllRising = !tmShowAllRising;
            else if (section === 'falling') tmShowAllFalling = !tmShowAllFalling;
            transferMarketRendered = false;
            renderTransferMarket();
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

            const squadIds = new Set(selectedPlayers.map(p => p.id));

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
                const ordered = filterPlayers(squadPlayers.slice()).sort((a, b) => {
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
            const showAll = active.key === 'fallers' ? tmShowAllFalling : tmShowAllRising;
            const display = showAll ? active.list.slice(0, 50) : active.list.slice(0, 8);

            html += `<div class="tm-section">
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
                ${active.list.length > 8 ? `<div style="text-align:center;margin-top:10px;">
                    <button class="tm-view-all-btn" onclick="tmToggleViewAll('${active.key === 'fallers' ? 'falling' : 'rising'}')">${showAll ? 'Show top 8' : `View all ${active.list.length} →`}</button>
                </div>` : ''}
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

