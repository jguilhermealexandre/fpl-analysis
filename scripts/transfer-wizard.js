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
                return new Set(JSON.parse(localStorage.getItem('fpl_shortlist') || '[]'));
            } catch (e) {
                return new Set();
            }
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
        function findTransferCandidates(position, maxPrice, excludeIds) {
            const candidates = allPlayers.filter(p =>
                p.position === position &&
                p.price <= maxPrice &&
                !excludeIds.has(p.id) &&
                (p.status === 'a' || p.status === 'd') &&
                p.minutes >= minMinutesForCandidate()
            );

            // Score each candidate
            candidates.forEach(c => {
                c._transferScore = calculateTransferScore(c, c.position);
                // Get recent stats for display
                c._recentStats = getPlayerRecentStats(c.id, 5);
            });

            candidates.sort((a, b) => b._transferScore - a._transferScore);
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
            transferState = { pending: [], activeSlot: -1, mode: 'squad', candidateCache: {}, marketFilter: { pos: 0, priceRange: 'all' }, previewPlayer: null, marketTab: 'ai', browseSearch: '', browseSort: 'score', wildcard: false, sellMode: false };
            const container = document.getElementById('transferDisplay');

            // Two panes side by side rather than one panel switching between squad,
            // market and comparison — the squad you are selling from stays visible
            // while you shop, which is the whole point of a transfer screen.
            container.innerHTML = `
                <div class="tw-container">
                    <div id="twBudgetBar"></div>
                    <div class="twr-panel">
                        <div class="twr-head">
                            <div>
                                <div class="twr-title">Should I make a transfer?</div>
                                <div class="twr-sub">Prices every legal move over the next five gameweeks by what it adds to your starting eleven — including the option of doing nothing.</div>
                            </div>
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
        function twMaxTransfers() { return transferState.wildcard ? 15 : 5; }

        function twToggleWildcard() {
            transferState.wildcard = !transferState.wildcard;
            renderTWAll();
        }

        function twToggleSellMode() {
            transferState.sellMode = !transferState.sellMode;
            renderTWAll();
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
                        <div class="twr-verdict-icon">✋</div>
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

            return `
                <div class="twr-verdict act">
                    <div class="twr-verdict-icon">${best.n === 1 ? '🔁' : '⚡'}</div>
                    <div>
                        <div class="twr-verdict-title">Make ${best.n} transfer${best.n === 1 ? '' : 's'}</div>
                        <div class="twr-verdict-sub">
                            <strong>+${best.net.toFixed(1)} xP</strong> over ${span}
                            (${best.gross.toFixed(1)} gained, ${hitLine})
                        </div>
                    </div>
                </div>
                <div class="twr-moves">
                    ${best.moves.map(m => `
                        <div class="twr-move-card">
                            <div class="twr-move">
                                <span class="twr-out">${escHTML(m.out.name)}<small>£${(m.out.sellPrice || m.out.price).toFixed(1)}m · ${m.outXP.toFixed(1)} xP</small></span>
                                <span class="twr-arrow">→</span>
                                <span class="twr-in">${escHTML(m.in.name)}<small>£${m.in.price.toFixed(1)}m · ${m.inXP.toFixed(1)} xP</small></span>
                                <span class="twr-gain pos">+${m.gain.toFixed(1)}<small>to your XI</small></span>
                            </div>
                            <p class="twr-why">${escHTML(twMoveReason(m, gws))}</p>
                        </div>`).join('')}
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

        function renderTWAll() {
            renderTWBudgetBar();
            renderTWSquadPane();
            renderTWMarketPane();
            if (typeof lucide !== 'undefined') lucide.createIcons();
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
            const filled = transferState.pending.filter(s => s.replacement).length;
            const allFilled = count > 0 && filled === count;
            const itbClass = itb < 0 ? 'danger' : itb < 0.5 ? 'warning' : 'success';

            const cart = transferState.pending.map((s, i) => `<span class="twc-chip ${s.replacement ? 'done' : ''} ${i === transferState.activeSlot ? 'active' : ''}" onclick="twSelectSlot(${i})"
                data-tooltip="${s.replacement ? `${escHTML(s.soldPlayer.name)} out, ${escHTML(s.replacement.name)} in` : `${escHTML(s.soldPlayer.name)} out — no replacement chosen yet`}">
                ${escHTML(s.soldPlayer.name)}${s.replacement ? ` → ${escHTML(s.replacement.name)}` : ' → ?'}
                <button class="twc-chip-x" onclick="event.stopPropagation();twRemoveSlot(${i})" data-tooltip="Remove this transfer">×</button>
            </span>`).join('');

            el.innerHTML = `
                <div class="twc-head">
                    <button class="twc-wc ${wc ? 'on' : ''}" onclick="twToggleWildcard()" aria-pressed="${wc}"
                        data-tooltip="${wc ? 'Wildcard on — every transfer is free and the limit is your whole squad. Click to turn it off.' : 'Plan a wildcard: unlimited transfers, no points hits.'}">
                        🃏 ${wc ? 'Wildcard on' : 'Play wildcard'}
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
                        ${count ? `<button class="rc-btn" onclick="twOpenPreview()" data-tooltip="See the squad these transfers would leave you with, on a pitch, with its value and projection.">👁️ Preview squad</button>` : ''}
                        ${count ? `<button class="rc-btn" onclick="twClearPending()" data-tooltip="Discard every pending transfer">Clear</button>` : ''}
                        <button class="rc-btn primary" ${!allFilled ? 'disabled' : ''} onclick="twShowSummary()" data-tooltip="${allFilled ? 'Review the finished plan' : 'Every transfer needs a replacement before you can review'}">Summary →</button>
                    </div>
                </div>
                ${count ? `<div class="twc-cart">${cart}</div>` : ''}`;
        }

        function renderTWSquadPane() {
            const el = document.getElementById('twSquadPane');
            if (!el) return;
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
                        ${transferState.sellMode ? `<button class="twc-mini" onclick="twSellAll(${pos.type})" data-tooltip="Sell every ${pos.label.toLowerCase().replace(/s$/, '')} at once and pool the money">Sell all</button>` : ''}
                    </div>`;
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
                        ? fx.map(f => `<span class="twc-fdr fdr-${f.difficulty || 3}" data-tooltip="${f.isHome ? 'Home to' : 'Away at'} ${escHTML(f.opponent || '?')} — FDR ${f.difficulty || 3}">${escHTML((f.opponent || '?').slice(0, 3))}</span>`).join('')
                        : '<span class="twc-fdr twc-fdr-none">—</span>';
                    const status = p.status === 'i' || p.status === 'u' || p.status === 's' ? '<span class="twc-flag out">OUT</span>'
                        : p.status === 'd' ? `<span class="twc-flag doubt" data-tooltip="${escHTML(p.news || 'Fitness doubt')}">?</span>` : '';

                    rows += `<div class="twc-row ${sold ? 'is-sold' : ''} ${pending ? 'is-pending' : ''} ${transferState.sellMode ? 'sell-mode' : ''}"
                        ${transferState.sellMode && !sold ? `onclick="twPickOutPlayer(${p.id})"` : ''}>
                        <span class="twc-pos ${['', 'gk', 'def', 'mid', 'fwd'][p.position]}">${['', 'GK', 'DEF', 'MID', 'FWD'][p.position]}</span>
                        <div class="twc-who">
                            <div class="twc-name">${escHTML(p.name)}${status}</div>
                            <div class="twc-sub">${escHTML(p.team)} · £${(p.sellPrice || p.price).toFixed(1)}m</div>
                        </div>
                        <div class="twc-fdrs" data-tooltip="Next three fixtures.">${blocks}</div>
                        <div class="twc-xp" data-tooltip="Projected points across GW${twRun[0]}\u2013GW${twRun[twRun.length - 1]} \u2014 the same three fixtures shown beside it.">${xp.toFixed(1)}<span class="twc-xp-u">xP${twRun.length}</span></div>
                        ${sold ? `<span class="twc-swapped">Swapped</span>`
                            : `<button class="twc-swap ${pending ? 'active' : ''}" onclick="event.stopPropagation();twSwapPlayer(${p.id})"
                                data-tooltip="${pending ? 'Find a replacement for ' + escHTML(p.name) : 'Sell ' + escHTML(p.name) + ' and open the market for their position'}">🔄 ${pending ? 'Find' : 'Swap'}</button>`}
                    </div>`;
                });
                rows += `</div>`;
            });

            el.innerHTML = `<div class="twc-panel">
                <div class="twc-panel-head">
                    <span class="twc-panel-title">👥 Your squad</span>
                    <button class="twc-mini ${transferState.sellMode ? 'on' : ''}" onclick="twToggleSellMode()"
                        data-tooltip="${transferState.sellMode ? 'Back to single swaps' : 'Click players to sell several at once and pool their money — useful on a wildcard'}">🗑️ ${transferState.sellMode ? 'Sell mode on' : 'Sell mode'}</button>
                </div>
                <div class="twc-panel-body">${rows}</div>
            </div>`;
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
            transferState.marketTab = 'ai';
            renderTWAll();
        }

        function renderTWMarketPane() {
            const el = document.getElementById('twMarketPane');
            if (!el) return;
            const mode = transferState.mode;
            if (mode === 'compare' && transferState.previewPlayer && transferState.activeSlot >= 0) return renderTWComparison(el);
            if (mode === 'market' && transferState.activeSlot >= 0) return renderTWMarket(el);
            if (mode === 'summary') return twRenderSummaryPanel(el);
            el.innerHTML = `<div class="twc-panel"><div class="twc-panel-head"><span class="twc-panel-title">🛒 Market</span></div>
                <div class="twc-idle">Hit <strong>🔄 Swap</strong> on any player and their replacements appear here, already filtered to their position and what you can afford.</div></div>`;
        }

        function renderTWMarket(el) {
            const slotIdx = transferState.activeSlot;
            if (slotIdx < 0 || !transferState.pending[slotIdx]) {
                renderTWSquadPane();
                return;
            }

            const slot = transferState.pending[slotIdx];
            const sold = slot.soldPlayer;
            const pos = sold.position;
            const itb = getTWLiveITB();
            let maxPrice = itb;
            if (slot.replacement) maxPrice += slot.replacement.price;

            const soldIds = new Set(transferState.pending.map(s => s.soldPlayer.id));
            const boughtIds = new Set(transferState.pending.filter(s => s.replacement).map(s => s.replacement.id));
            const excludeIds = new Set([...selectedPlayers.map(p => p.id), ...boughtIds]);
            for (const id of soldIds) excludeIds.delete(id);

            const tab = transferState.marketTab || 'ai';
            const priceFilter = transferState.marketFilter.priceRange;
            const posName = ['', 'Goalkeepers', 'Defenders', 'Midfielders', 'Forwards'][pos];

            // Computed unconditionally (not just inside the branch below) so the
            // tab button itself can show how many of this position are shortlisted,
            // even while a different tab is the one actually showing.
            const shortlistIds = getTWShortlistIds();
            const shortlistCountForPos = allPlayers.filter(p =>
                shortlistIds.has(p.id) && p.position === pos && !excludeIds.has(p.id)).length;

            let candidates;
            if (tab === 'ai') {
                const cacheKey = pos + '_' + maxPrice.toFixed(1);
                if (!transferState.candidateCache[cacheKey]) {
                    transferState.candidateCache[cacheKey] = findTransferCandidates(pos, maxPrice, excludeIds);
                }
                candidates = [...transferState.candidateCache[cacheKey]];
            } else if (tab === 'favorites') {
                // Deliberately not filtered by maxPrice, unlike AI/Browse — the
                // point of this tab is "how does the player I've starred compare",
                // which is a question worth answering even when he's currently
                // unaffordable. The existing unafford styling below already marks
                // that case rather than hiding it.
                candidates = allPlayers.filter(p =>
                    shortlistIds.has(p.id) && p.position === pos && !excludeIds.has(p.id));
                candidates.forEach(c => {
                    if (c._transferScore == null) c._transferScore = calculateTransferScore(c, c.position);
                    if (!c._recentStats) c._recentStats = getPlayerRecentStats(c.id, 5);
                });
                candidates.sort((a, b) => (b._transferScore || 0) - (a._transferScore || 0));
            } else {
                const query = (transferState.browseSearch || '').toLowerCase();
                candidates = allPlayers.filter(p =>
                    p.position === pos &&
                    p.price <= maxPrice &&
                    !excludeIds.has(p.id) &&
                    (p.status === 'a' || p.status === 'd') &&
                    p.minutes >= 50 &&
                    (!query || p.name.toLowerCase().includes(query))
                );
                candidates.forEach(c => {
                    if (c._transferScore == null) c._transferScore = calculateTransferScore(c, c.position);
                    if (!c._recentStats) c._recentStats = getPlayerRecentStats(c.id, 5);
                });
                const sortBy = transferState.browseSort || 'score';
                if (sortBy === 'price') candidates.sort((a, b) => b.price - a.price);
                else if (sortBy === 'form') candidates.sort((a, b) => (b.form || 0) - (a.form || 0));
                else if (sortBy === 'ppg') candidates.sort((a, b) => (b.ppg || 0) - (a.ppg || 0));
                else candidates.sort((a, b) => (b._transferScore || 0) - (a._transferScore || 0));
            }

            if (priceFilter === 'budget') candidates = candidates.filter(c => c.price <= 6);
            else if (priceFilter === 'mid') candidates = candidates.filter(c => c.price > 6 && c.price <= 9);
            else if (priceFilter === 'premium') candidates = candidates.filter(c => c.price > 9);

            const display = candidates.slice(0, tab === 'ai' ? 15 : 50);

            // Position-specific stat columns
            function getStatCols(p) {
                const rs = p._recentStats || getPlayerRecentStats(p.id, 5);
                const ss = getPlayerSeasonPer90(p);
                const fmt = (v) => v != null ? v.toFixed(2) : '-';
                const fPct = (v) => v != null ? v.toFixed(0) + '%' : '-';
                if (pos === 1) return [
                    { label: 'Sv%', val: fPct(rs?.savePct ?? ss.savePct), raw: rs?.savePct ?? ss.savePct ?? 0, lb: false },
                    { label: 'CS%', val: fPct(rs?.csPercent ?? ss.csPercent), raw: rs?.csPercent ?? ss.csPercent ?? 0, lb: false },
                    { label: 'xGC/90', val: fmt(rs?.xGCPer90 ?? ss.xGCPer90), raw: rs?.xGCPer90 ?? ss.xGCPer90 ?? 0, lb: true }
                ];
                if (pos === 2) return [
                    { label: 'CS%', val: fPct(rs?.csPercent ?? ss.csPercent), raw: rs?.csPercent ?? ss.csPercent ?? 0, lb: false },
                    { label: 'xGI/90', val: fmt(rs?.xGIPer90 ?? ss.xGIPer90), raw: rs?.xGIPer90 ?? ss.xGIPer90 ?? 0, lb: false },
                    { label: 'xGC/90', val: fmt(rs?.xGCPer90 ?? ss.xGCPer90), raw: rs?.xGCPer90 ?? ss.xGCPer90 ?? 0, lb: true }
                ];
                if (pos === 3) return [
                    { label: 'xGI/90', val: fmt(rs?.xGIPer90 ?? ss.xGIPer90), raw: rs?.xGIPer90 ?? ss.xGIPer90 ?? 0, lb: false },
                    { label: 'xG/90', val: fmt(rs?.xGPer90 ?? ss.xGPer90), raw: rs?.xGPer90 ?? ss.xGPer90 ?? 0, lb: false },
                    { label: 'xA/90', val: fmt(rs?.xAPer90 ?? ss.xAPer90), raw: rs?.xAPer90 ?? ss.xAPer90 ?? 0, lb: false }
                ];
                return [
                    { label: 'xG/90', val: fmt(rs?.xGPer90 ?? ss.xGPer90), raw: rs?.xGPer90 ?? ss.xGPer90 ?? 0, lb: false },
                    { label: 'xGI/90', val: fmt(rs?.xGIPer90 ?? ss.xGIPer90), raw: rs?.xGIPer90 ?? ss.xGIPer90 ?? 0, lb: false },
                    { label: 'Goals', val: String(rs?.goals ?? p.goals ?? 0), raw: rs?.goals ?? p.goals ?? 0, lb: false }
                ];
            }

            function statCls(col) {
                const t = { 'Sv%': [70, 60], 'CS%': [35, 20], 'xGC/90': [1.0, 1.4], 'xGI/90': [0.35, 0.2], 'xG/90': [0.3, 0.15], 'xA/90': [0.2, 0.1], 'Goals': [6, 3] }[col.label];
                if (!t) return '';
                if (col.lb) return col.raw <= t[0] ? ' good' : col.raw >= t[1] ? ' poor' : '';
                return col.raw >= t[0] ? ' good' : col.raw <= t[1] ? ' poor' : '';
            }

            // Every candidate is priced against the player being sold, over the same
            // gameweeks, so "is this an upgrade" is answered on the card rather than
            // left as an exercise for the reader.
            const planGWs = twPlanGWs(3);
            const soldXP = twXPOver(slot.soldPlayer, planGWs);

            let rowsHtml = '';
            if (display.length === 0) {
                const emptyMsg = tab === 'browse' && transferState.browseSearch
                    ? 'No players match your search'
                    : tab === 'favorites'
                        ? (shortlistIds.size === 0
                            ? 'You haven\'t shortlisted any players yet — star players on the Players Analysis page to see them here.'
                            : `None of your shortlisted ${posName.toLowerCase()} are available for this slot — they may already be in your squad or staged elsewhere in this plan.`)
                        : 'No candidates found within budget';
                rowsHtml = '<div class="tw-market-empty">' + emptyMsg + '</div>';
            } else {
                for (let i = 0; i < display.length; i++) {
                    const c = display[i];
                    const affordable = c.price <= maxPrice;
                    const previewed = transferState.previewPlayer?.id === c.id;
                    const score = c._transferScore || 0;
                    const cols = getStatCols(c);
                    const teamName = c.team || teams[c.teamId]?.short_name || '';
                    const fixes = teamFixtures[c.teamId] || c.fixtures || [];

                    const gain = twXPOver(c, planGWs) - soldXP;
                    const gainCls = gain > 0.3 ? 'up' : gain < -0.3 ? 'down' : 'flat';
                    const gainTxt = gain > 0.3 ? `▲ +${gain.toFixed(1)}` : gain < -0.3 ? `▼ ${gain.toFixed(1)}` : '±0.0';

                    const fdrBlocks = fixes.slice(0, 3).map(f =>
                        `<span class="twc-fdr fdr-${f.difficulty || 3}" data-tooltip="${f.isHome ? 'Home to' : 'Away at'} ${escHTML(f.opponent || '?')} — FDR ${f.difficulty || 3}">${escHTML((f.opponent || '?').slice(0, 3))}</span>`).join('');

                    // Labelled stats — the old row printed bare numbers with nothing
                    // saying which was which.
                    const stats = cols.map(col => `<span class="twc-cstat" data-tooltip="${escHTML(col.label)}">
                        <span class="twc-cstat-l">${escHTML(col.label)}</span><span class="twc-cstat-v">${escHTML(String(col.val))}</span></span>`).join('');

                    rowsHtml += `<div class="twc-card ${previewed ? 'previewed' : ''} ${!affordable ? 'unafford' : ''}" onclick="twPreviewPlayer(${c.id})">
                        <div class="twc-card-top">
                            <span class="twc-card-rank">${i + 1}</span>
                            <span class="twc-card-name">${escHTML(c.name)}</span>
                            <span class="twc-card-team">${escHTML(teamName)}</span>
                            <span class="twc-card-price">£${c.price.toFixed(1)}m ${priceChangeBadge(c)}</span>
                        </div>
                        <div class="twc-card-mid">
                            <span class="twc-delta ${gainCls}" data-tooltip="Projected over the next ${planGWs.length} gameweeks: ${escHTML(c.name)} ${twXPOver(c, planGWs).toFixed(1)} against ${escHTML(slot.soldPlayer.name)} ${soldXP.toFixed(1)}.">${gainTxt} xP</span>
                            <span class="twc-score" data-tooltip="AI transfer score — the engine's overall ranking for your squad. A ranking, not a points prediction.">${score.toFixed(0)}</span>
                            <span class="twc-fdrs">${fdrBlocks}</span>
                        </div>
                        <div class="twc-card-stats">${stats}</div>
                    </div>`;
                }
            }

            const tabsHtml = '<div class="tw-market-tabs">' +
                '<button class="tw-market-tab' + (tab === 'ai' ? ' active' : '') + '" onclick="twSwitchMarketTab(\'ai\')">AI Picks</button>' +
                '<button class="tw-market-tab' + (tab === 'favorites' ? ' active' : '') + '" onclick="twSwitchMarketTab(\'favorites\')" data-tooltip="Players you\'ve starred on the Players Analysis page, compared against ' + escHTML(sold.name) + ' the same way as any other candidate.">⭐ Favorites' + (shortlistCountForPos ? ' (' + shortlistCountForPos + ')' : '') + '</button>' +
                '<button class="tw-market-tab' + (tab === 'browse' ? ' active' : '') + '" onclick="twSwitchMarketTab(\'browse\')">Browse All</button></div>';

            const searchHtml = tab === 'browse' ? '<input class="tw-market-search" type="text" placeholder="Search by name..." value="' + (transferState.browseSearch || '').replace(/"/g, '&quot;') + '" oninput="twSearchInput(this.value)">' : '';

            const sortBy = transferState.browseSort || 'score';
            const sortHtml = tab === 'browse' ? '<div class="tw-market-sort">' +
                '<button class="tw-filter-pill' + (sortBy === 'score' ? ' active' : '') + '" onclick="twSetBrowseSort(\'score\')">Score</button>' +
                '<button class="tw-filter-pill' + (sortBy === 'price' ? ' active' : '') + '" onclick="twSetBrowseSort(\'price\')">Price</button>' +
                '<button class="tw-filter-pill' + (sortBy === 'form' ? ' active' : '') + '" onclick="twSetBrowseSort(\'form\')">Form</button>' +
                '<button class="tw-filter-pill' + (sortBy === 'ppg' ? ' active' : '') + '" onclick="twSetBrowseSort(\'ppg\')">PPG</button></div>' : '';

            el.innerHTML = '<div class="tw-scout">' +
                '<div class="tw-scout-header"><i data-lucide="search" style="width:14px;height:14px;"></i> Replacements for ' + sold.name +
                '<span style="margin-left:auto;font-size:10px;font-weight:600;color:var(--text-muted);font-family:var(--font-mono);">Budget: £' + maxPrice.toFixed(1) + 'm</span></div>' +
                tabsHtml + searchHtml + sortHtml +
                '<div class="tw-market-header"><span class="tw-market-title">' + posName + '</span>' +
                '<div class="tw-market-filters">' +
                '<button class="tw-filter-pill' + (priceFilter === 'all' ? ' active' : '') + '" onclick="twSetMarketFilter(\'priceRange\',\'all\')">All</button>' +
                '<button class="tw-filter-pill' + (priceFilter === 'budget' ? ' active' : '') + '" onclick="twSetMarketFilter(\'priceRange\',\'budget\')">≤£6m</button>' +
                '<button class="tw-filter-pill' + (priceFilter === 'mid' ? ' active' : '') + '" onclick="twSetMarketFilter(\'priceRange\',\'mid\')">£6-9m</button>' +
                '<button class="tw-filter-pill' + (priceFilter === 'premium' ? ' active' : '') + '" onclick="twSetMarketFilter(\'priceRange\',\'premium\')">≥£9m</button>' +
                '</div></div>' +
                '<div id="twMarketList" class="tw-scout-body tw-market-list">' + rowsHtml + '</div>' +
                '<div style="padding:8px 14px;"><button class="tw-btn tw-btn-secondary" onclick="twBackToSquad()" style="width:100%;"><i data-lucide="arrow-left" style="width:12px;height:12px;"></i> Back to Squad</button></div>' +
                '</div>';
            if (typeof lucide !== 'undefined') lucide.createIcons();
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
            const itb = getTWLiveITB() + (slot.replacement ? slot.replacement.price : 0);
            const affordable = cand.price <= itb + 0.001;

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
            const verdict = !affordable
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

            el.innerHTML = `<div class="twc-panel">
                <div class="twc-panel-head">
                    <button class="twc-mini" onclick="twBackToMarket()" data-tooltip="Back to the replacement list">← Market</button>
                    <span class="twc-panel-title">⚖️ ${escHTML(sold.name)} vs ${escHTML(cand.name)}</span>
                </div>
                <div class="twc-panel-body">
                    <div class="twh-verdict ${verdict.cls}">
                        <span class="twh-verdict-delta">${delta > 0 ? '▲ +' : delta < 0 ? '▼ ' : '±'}${Math.abs(delta) < 0.05 ? '0.0' : delta.toFixed(1)}</span>
                        <span class="twh-verdict-text">${verdict.text}</span>
                    </div>

                    <div class="twh-heads">
                        <div class="twh-head out"><div class="twh-head-name">${escHTML(sold.name)}</div><div class="twh-head-sub">${escHTML(sold.team)} · £${(sold.sellPrice || sold.price).toFixed(1)}m · out</div></div>
                        <div class="twh-head-vs">vs</div>
                        <div class="twh-head in"><div class="twh-head-name">${escHTML(cand.name)}</div><div class="twh-head-sub">${escHTML(cand.team)} · £${cand.price.toFixed(1)}m · in</div></div>
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

                    <div class="twh-actions">
                        <button class="rc-btn" onclick="twBackToMarket()">← Back</button>
                        <button class="rc-btn primary" ${!affordable ? 'disabled' : ''} onclick="twConfirmPick()"
                            data-tooltip="${affordable ? 'Add this transfer to the plan' : 'Outside your budget'}">Confirm ${escHTML(cand.name)} →</button>
                    </div>
                </div>
            </div>`;

            twDrawComparisonCharts(sold, cand, fdrGWs);
        }

        function twDrawComparisonCharts(sold, cand, fdrGWs) {
            if (typeof Chart === 'undefined') return;
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

        function renderTWPreviewModal() {
            const squad = twBuildPendingSquad();
            const gws = twPlanGWs(1);
            const gw = gws[0] || currentGW;

            // Pick the best legal eleven from the new squad so the projection is what
            // you would actually field, not the sum of all fifteen. Selection runs on
            // the next-3-GW total rather than this single fixture — a squad remade by
            // several transfers should be judged on the run it sets up, not on which
            // gets lucky with this week's fixture alone.
            const pool = squad.map(p => ({ ...p, pos: p.position,
                lwScore: typeof xpNext3 === 'function' ? xpNext3(p) : predictedGWPoints(p) }));
            const solved = typeof solveQuickLineup === 'function' ? solveQuickLineup(pool) : null;
            const xiIds = new Set((solved?.xi || []).map(p => p.id));
            const xi = squad.filter(p => xiIds.has(p.id));
            const bench = squad.filter(p => !xiIds.has(p.id));

            const newValue = squad.reduce((s, p) => s + p.price, 0);
            const oldValue = selectedPlayers.reduce((s, p) => s + p.price, 0);
            const newXP = xi.reduce((s, p) => s + predictedGWPoints(p), 0);
            const oldXI = selectedPlayers.filter(p => !p.onBench);
            const oldXP = oldXI.reduce((s, p) => s + predictedGWPoints(p), 0);
            const hit = getTWHitCost();
            const xpDelta = newXP - oldXP - hit;

            const byTeam = {};
            squad.forEach(p => { byTeam[p.teamId] = (byTeam[p.teamId] || 0) + 1; });
            const overStacked = Object.keys(byTeam).filter(t => byTeam[t] > 3).map(t => teams[t]?.short_name || '?');

            const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
            squad.forEach(p => { counts[p.position] = (counts[p.position] || 0) + 1; });
            const squadLegal = counts[1] === 2 && counts[2] === 5 && counts[3] === 5 && counts[4] === 3;

            const card = p => `<div class="twp-card ${p.isIncoming ? 'in' : ''}">
                <div class="twp-card-name">${escHTML(p.name)}${p.isIncoming ? '<span class="twp-in">IN</span>' : ''}</div>
                <div class="twp-card-sub">${escHTML(p.team)} · £${p.price.toFixed(1)}m</div>
                <div class="twp-card-xp">${predictedGWPoints(p).toFixed(1)}<span class="twp-u">xP</span></div>
            </div>`;
            const rowFor = n => `<div class="twp-row">${xi.filter(p => p.position === n).map(card).join('')}</div>`;

            return `<div class="detail-section">
                <div class="twp-stats">
                    <div class="twp-stat"><div class="twp-stat-v">${(solved?.formation) || '—'}</div><div class="twp-stat-l" data-tooltip="The best legal shape this squad can field.">Formation</div></div>
                    <div class="twp-stat"><div class="twp-stat-v">£${newValue.toFixed(1)}m</div><div class="twp-stat-l" data-tooltip="Squad value after these transfers. Was £${oldValue.toFixed(1)}m.">Squad value</div></div>
                    <div class="twp-stat"><div class="twp-stat-v">£${getTWLiveITB().toFixed(1)}m</div><div class="twp-stat-l" data-tooltip="Money left over once every pending transfer is paid for.">Bank left</div></div>
                    <div class="twp-stat"><div class="twp-stat-v ${xpDelta > 0 ? 'good' : xpDelta < 0 ? 'bad' : ''}">${xpDelta > 0 ? '+' : ''}${xpDelta.toFixed(1)}</div>
                        <div class="twp-stat-l" data-tooltip="Projected points for the new eleven (${newXP.toFixed(1)}) against your current one (${oldXP.toFixed(1)})${hit > 0 ? `, after the ${hit}-point hit` : ''}.">xP change</div></div>
                </div>

                ${!squadLegal ? `<div class="twp-warn">⚠️ This is not a legal squad yet — FPL needs 2 keepers, 5 defenders, 5 midfielders and 3 forwards. You have ${counts[1]}/${counts[2]}/${counts[3]}/${counts[4]}.</div>` : ''}
                ${overStacked.length ? `<div class="twp-warn">⚠️ More than three players from ${escHTML(overStacked.join(', '))} — FPL does not allow it.</div>` : ''}
                ${getTWLiveITB() < 0 ? `<div class="twp-warn">⚠️ You are £${Math.abs(getTWLiveITB()).toFixed(1)}m over budget.</div>` : ''}

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
                if (transferState.pending.length >= 5) return;
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
            transferState.marketTab = 'ai';
            transferState.browseSearch = '';
            renderTWAll();
        }

        function twSelectSlot(idx) {
            if (idx < 0 || idx >= transferState.pending.length) return;
            transferState.activeSlot = idx;
            transferState.mode = 'market';
            transferState.previewPlayer = null;
            renderTWAll();
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
            renderTWAll();
        }

        function twBackToMarket() {
            transferState.previewPlayer = null;
            transferState.mode = 'market';
            renderTWAll();
        }

        function twBackToSquad() {
            transferState.mode = 'squad';
            transferState.activeSlot = -1;
            transferState.previewPlayer = null;
            renderTWAll();
        }

        function twConfirmPick() {
            const slotIdx = transferState.activeSlot;
            if (slotIdx < 0 || !transferState.previewPlayer) return;
            const candidate = transferState.previewPlayer;
            const slot = transferState.pending[slotIdx];
            const itb = getTWLiveITB();
            const extraBudget = slot.replacement ? slot.replacement.price : 0;
            if (candidate.price > itb + extraBudget + 0.01) return;

            // Team count check (max 3 per team)
            const soldIds = new Set(transferState.pending.map(s => s.soldPlayer.id));
            const teamCounts = {};
            for (const p of selectedPlayers) {
                if (soldIds.has(p.id)) continue;
                teamCounts[p.teamId] = (teamCounts[p.teamId] || 0) + 1;
            }
            for (let i = 0; i < transferState.pending.length; i++) {
                if (i === slotIdx) continue;
                const repl = transferState.pending[i].replacement;
                if (repl) teamCounts[repl.teamId] = (teamCounts[repl.teamId] || 0) + 1;
            }
            if ((teamCounts[candidate.teamId] || 0) >= 3) return;

            slot.replacement = candidate;
            transferState.previewPlayer = null;
            transferState.candidateCache = {};

            // Auto-advance to next unfilled slot
            const nextUnfilled = transferState.pending.findIndex(s => !s.replacement);
            if (nextUnfilled >= 0) {
                transferState.activeSlot = nextUnfilled;
                transferState.mode = 'market';
            } else {
                transferState.mode = 'squad';
                transferState.activeSlot = -1;
            }
            renderTWAll();
        }

        function twSetMarketFilter(key, value) {
            transferState.marketFilter[key] = value;
            renderTWAll();
        }

        let twSearchTimeout = null;
        function twSwitchMarketTab(tab) {
            transferState.marketTab = tab;
            transferState.browseSearch = '';
            renderTWAll();
        }

        function twSearchInput(value) {
            transferState.browseSearch = value;
            clearTimeout(twSearchTimeout);
            twSearchTimeout = setTimeout(() => {
                renderTWAll();
                const inp = document.querySelector('.tw-market-search');
                if (inp) { inp.focus(); inp.selectionStart = inp.selectionEnd = inp.value.length; }
            }, 250);
        }

        function twSetBrowseSort(sort) {
            transferState.browseSort = sort;
            renderTWAll();
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
            renderTWAll();
        }

        function twRenderSummaryPanel(el) {
            const hit = getTWHitCost();
            const itb = getTWLiveITB();
            let transfersHtml = '';
            let totalScoreBefore = 0, totalScoreAfter = 0;

            for (const slot of transferState.pending) {
                const sold = slot.soldPlayer;
                const repl = slot.replacement;
                const posName = ['', 'GK', 'DEF', 'MID', 'FWD'][sold.position];
                const soldScore = calculateTransferScore(sold, sold.position);
                const replScore = calculateTransferScore(repl, repl.position);
                totalScoreBefore += soldScore;
                totalScoreAfter += replScore;

                transfersHtml += '<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--surface-2);border-radius:var(--radius-md);">' +
                    '<span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;background:var(--surface-3);color:var(--text-muted);">' + posName + '</span>' +
                    '<div style="flex:1;min-width:0;"><div style="font-weight:600;font-size:12px;color:var(--color-error);">' + sold.name +
                    ' <span style="font-weight:400;color:var(--text-muted);font-size:10px;">' + sold.team + ' · £' + (sold.sellPrice || sold.price).toFixed(1) + 'm</span></div></div>' +
                    '<div style="color:var(--text-muted);font-size:16px;flex-shrink:0;">→</div>' +
                    '<div style="flex:1;min-width:0;"><div style="font-weight:600;font-size:12px;color:var(--color-success);">' + repl.name +
                    ' <span style="font-weight:400;color:var(--text-muted);font-size:10px;">' + repl.team + ' · £' + repl.price.toFixed(1) + 'm</span></div></div>' +
                    '</div>';
            }

            const scoreDelta = totalScoreAfter - totalScoreBefore;
            const deltaStyle = scoreDelta >= 0 ? 'color:var(--color-success)' : 'color:var(--color-error)';
            const deltaBg = scoreDelta >= 0 ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)';

            el.innerHTML = '<div class="tw-scout">' +
                '<div class="tw-scout-header"><i data-lucide="check-circle" style="width:14px;height:14px;"></i> Transfer Summary</div>' +
                '<div style="padding:16px;">' +
                '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;">' +
                '<div style="text-align:center;padding:10px;background:var(--surface-2);border-radius:var(--radius-md);">' +
                '<div style="font-size:10px;text-transform:uppercase;color:var(--text-muted);font-weight:600;">Transfers</div>' +
                '<div style="font-size:18px;font-weight:700;font-family:var(--font-mono);">' + transferState.pending.length + '</div></div>' +
                '<div style="text-align:center;padding:10px;background:var(--surface-2);border-radius:var(--radius-md);">' +
                '<div style="font-size:10px;text-transform:uppercase;color:var(--text-muted);font-weight:600;">Hit Cost</div>' +
                '<div style="font-size:18px;font-weight:700;font-family:var(--font-mono);' + (hit > 0 ? 'color:var(--color-error)' : '') + '">' + (hit > 0 ? '-' : '') + hit + ' pts</div></div>' +
                '<div style="text-align:center;padding:10px;background:var(--surface-2);border-radius:var(--radius-md);">' +
                '<div style="font-size:10px;text-transform:uppercase;color:var(--text-muted);font-weight:600;">Remaining ITB</div>' +
                '<div style="font-size:18px;font-weight:700;font-family:var(--font-mono);' + (itb < 0 ? 'color:var(--color-error)' : 'color:var(--color-success)') + '">£' + itb.toFixed(1) + 'm</div></div>' +
                '</div>' +
                '<div style="font-weight:700;font-size:13px;margin-bottom:8px;display:flex;align-items:center;gap:8px;">Transfers ' +
                '<span style="font-family:var(--font-mono);font-size:12px;padding:2px 8px;border-radius:var(--radius-sm);' + deltaStyle + ';background:' + deltaBg + ';">' +
                (scoreDelta >= 0 ? '+' : '') + scoreDelta.toFixed(1) + ' score</span></div>' +
                '<div style="display:flex;flex-direction:column;gap:8px;">' + transfersHtml + '</div>' +
                '<div style="margin-top:16px;display:flex;gap:8px;">' +
                '<button class="tw-btn tw-btn-secondary" onclick="twBackFromSummary()"><i data-lucide="arrow-left" style="width:12px;height:12px;"></i> Edit Transfers</button>' +
                '<button class="tw-btn tw-btn-secondary" onclick="renderTransferWizard()"><i data-lucide="refresh-cw" style="width:12px;height:12px;"></i> Start Over</button>' +
                '</div></div></div>';
            if (typeof lucide !== 'undefined') lucide.createIcons();
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

        function openHelpOverlay() {
            document.getElementById('helpOverlay').classList.add('show');
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        function closeHelpOverlay(event) {
            // Only dismiss on a click of the backdrop itself, not the panel inside it.
            if (event && event.target !== event.currentTarget) return;
            document.getElementById('helpOverlay').classList.remove('show');
        }

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
        // FPL applies price changes once a night, at roughly 01:30 UTC. The exact
        // minute is not published and does drift, so everything built on this is
        // labelled as an estimate rather than a countdown to a known event.
        const PRICE_LOCK_UTC_HOUR = 1;
        const PRICE_LOCK_UTC_MIN = 30;

        // A player's distance to a price change, as a signed percentage: +100 means
        // on track to rise, -100 on track to drop. This is the same transfer-velocity
        // model behind the pitch badge (net transfers over the current owner base),
        // scaled so the thresholds land at ±100 — NOT FPL's own published figure,
        // which does not exist publicly.
        function priceThresholdPct(p) {
            const raw = getTransferPressure(p) * 500;
            return Math.max(-100, Math.min(100, raw));
        }

        function thresholdState(pct) {
            if (pct >= 90) return { cls: 'rise-imminent', text: 'Rises tonight', short: 'Rising' };
            if (pct >= 50) return { cls: 'rise', text: 'Climbing', short: 'Climbing' };
            if (pct <= -80) return { cls: 'drop-imminent', text: 'Drops tonight', short: 'Dropping' };
            if (pct <= -50) return { cls: 'drop', text: 'Sliding', short: 'Sliding' };
            return { cls: 'stable', text: 'Safe', short: 'Safe' };
        }

        const THRESHOLD_TIP = "Projected from net transfers measured against the player's current owner base. FPL does not publish its price-change threshold, so this is a model of it, not the real number.";

        function nextPriceLock() {
            const now = new Date();
            const lock = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
                PRICE_LOCK_UTC_HOUR, PRICE_LOCK_UTC_MIN, 0));
            if (lock.getTime() <= now.getTime()) lock.setUTCDate(lock.getUTCDate() + 1);
            return lock;
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
                    <span class="tm-tick-arrow">${p.threshold > 0 ? '📈' : '📉'}</span>
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
            const atRisk = squadPlayers.filter(p => p.threshold <= -80);
            const rising = squadPlayers.filter(p => p.threshold >= 90);
            const exposure = atRisk.length * 0.1;

            html += `<div class="tm-portfolio">
                <div class="tm-lock" data-tooltip="FPL changes prices once a night, at roughly 01:30 UTC. The exact minute is not published and drifts, so treat this as an estimate.">
                    <span class="tm-lock-label">⏱️ Market closes in</span>
                    <span class="tm-lock-value" id="tmLockValue">—</span>
                    <span class="tm-lock-note">est. 01:30 UTC</span>
                </div>
                <div class="tm-exposure">
                    ${atRisk.length
                        ? `<span class="tm-exp-risk" data-tooltip="${escHTML(atRisk.map(p => p.name).join(', '))}">🚨 <strong>${atRisk.length}</strong> squad ${atRisk.length === 1 ? 'player' : 'players'} on track to drop <span class="tm-exp-money">−£${exposure.toFixed(1)}m</span></span>`
                        : `<span class="tm-exp-safe">✅ No squad player is close to dropping tonight</span>`}
                    ${rising.length ? `<span class="tm-exp-gain" data-tooltip="${escHTML(rising.map(p => p.name).join(', '))}">📈 <strong>${rising.length}</strong> on track to rise</span>` : ''}
                </div>
            </div>`;

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
                { key: 'risers', label: '🔥 Hot risers', list: risers },
                { key: 'fallers', label: '📉 Steep fallers', list: fallers },
                { key: 'enablers', label: '🎯 Budget enablers', list: enablers }
            ];
            const active = tabs.find(t => t.key === tmMarketTab) || tabs[0];
            const showAll = active.key === 'fallers' ? tmShowAllFalling : tmShowAllRising;
            const display = showAll ? active.list.slice(0, 50) : active.list.slice(0, 8);

            html += `<div class="tm-section">
                <div class="tm-market-tabs">
                    ${tabs.map(t => `<button class="tm-market-tab ${t.key === active.key ? 'active' : ''}" onclick="tmSetMarketTab('${t.key}')">${t.label} <span class="tm-market-tab-n">${t.list.length}</span></button>`).join('')}
                </div>
                <div class="tm-pos-filter">
                    <button class="tm-pos-btn ${tmPosFilter === 'all' && tmPriceFilter === 'all' ? 'active' : ''}" onclick="tmFilterPos('all')">All</button>
                    <button class="tm-pos-btn ${tmPosFilter === '1' ? 'active' : ''}" onclick="tmFilterPos('1')">GK</button>
                    <button class="tm-pos-btn ${tmPosFilter === '2' ? 'active' : ''}" onclick="tmFilterPos('2')">DEF</button>
                    <button class="tm-pos-btn ${tmPosFilter === '3' ? 'active' : ''}" onclick="tmFilterPos('3')">MID</button>
                    <button class="tm-pos-btn ${tmPosFilter === '4' ? 'active' : ''}" onclick="tmFilterPos('4')">FWD</button>
                    <span style="width:1px;background:var(--border-default);margin:2px 4px;"></span>
                    <button class="tm-pos-btn ${tmPriceFilter === 'premium' ? 'active' : ''}" onclick="tmFilterPrice('premium')">Premium £10m+</button>
                    <button class="tm-pos-btn ${tmPriceFilter === 'budget' ? 'active' : ''}" onclick="tmFilterPrice('budget')">Budget &lt;£5m</button>
                </div>
                ${display.length
                    ? `<div class="tm-watch">${display.map(p => renderTmWatchRow(p, true)).join('')}</div>`
                    : `<div class="tm-market-empty">No players match this filter right now.</div>`}
                ${active.list.length > 8 ? `<div style="text-align:center;margin-top:10px;">
                    <button class="tm-view-all-btn" onclick="tmToggleViewAll('${active.key === 'fallers' ? 'falling' : 'rising'}')">${showAll ? 'Show top 8' : `View all ${active.list.length} →`}</button>
                </div>` : ''}
                <div class="tm-watch-note">Your own players are listed above rather than repeated here.</div>
            </div>`;

            container.innerHTML = html;
            if (typeof lucide !== 'undefined') lucide.createIcons();
            startPriceLockCountdown();
        }

        // One row shape for both the squad watch and the market lists, so a player
        // reads identically wherever they appear.
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

            return `<div class="tm-watch-row ${st.cls}">
                <div class="tm-watch-player">
                    <div class="tm-player-avatar ${p.posClass}">${escHTML(p.teamShort)}</div>
                    <div class="tm-player-info">
                        <div class="tm-player-name-row">
                            <span class="tm-player-name">${escHTML(p.name)}</span>
                            ${inSquad ? '<span class="tm-badge in-squad">SQUAD</span>' : ''}
                        </div>
                        <div class="tm-player-sub">
                            <span class="tm-pos-pill ${p.posClass}">${p.posName}</span>
                            <span class="tm-team-name">£${p.price.toFixed(1)}m</span>
                            <span class="tm-team-name" data-tooltip="Net transfers this gameweek across all FPL managers.">${escHTML(netStr)}</span>
                        </div>
                    </div>
                </div>
                <div class="tm-watch-thr" data-tooltip="${escHTML(THRESHOLD_TIP)}">
                    <div class="tm-thr-head">
                        <span class="tm-thr-pct ${st.cls}">${pct > 0 ? '+' : ''}${Math.round(pct)}%</span>
                        <span class="tm-thr-state ${st.cls}">${st.text}</span>
                    </div>
                    ${bar}
                </div>
                <div class="tm-watch-act">
                    ${inSquad && pct <= -85
                        ? `<button class="tm-sell-btn" onclick="tmSellBeforeDrop(${p.id})">⚡ Sell before drop</button>`
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

