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
            transferState = { pending: [], activeSlot: -1, mode: 'squad', candidateCache: {}, marketFilter: { pos: 0, priceRange: 'all' }, previewPlayer: null, marketTab: 'ai', browseSearch: '', browseSort: 'score' };
            const container = document.getElementById('transferDisplay');

            container.innerHTML = `
                <div class="tw-container">
                    <div class="tw-intro">
                        <span><i data-lucide="repeat" style="width:20px;height:20px;"></i></span>
                        <div>Build your transfer plan — select players to sell from your squad, then find AI-powered replacements. Up to 5 transfers with live budget tracking.</div>
                    </div>
                    <div id="twBudgetBar"></div>
                    <div class="tw-room-layout">
                        <div class="tw-board-col" id="twBoardCol">
                            <div id="twDraftBoard"></div>
                        </div>
                        <div class="tw-scout-col" id="twScoutCol">
                            <div id="twScoutPanel"></div>
                        </div>
                    </div>
                </div>
            `;
            if (typeof lucide !== 'undefined') lucide.createIcons();
            renderTWBudgetBar();
            renderTWDraftBoard();
            renderTWScoutPanel();
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
            const ft = typeof getDraftFreeTransfers === 'function' ? getDraftFreeTransfers(currentGW) : 1;
            const count = transferState.pending.length;
            return Math.max(0, count - ft) * 4;
        }

        function renderTWBudgetBar() {
            const el = document.getElementById('twBudgetBar');
            if (!el) return;
            const itb = getTWLiveITB();
            const hit = getTWHitCost();
            const ft = typeof getDraftFreeTransfers === 'function' ? getDraftFreeTransfers(currentGW) : 1;
            const count = transferState.pending.length;
            const allFilled = count > 0 && transferState.pending.every(s => s.replacement);
            const hitClass = hit > 0 ? 'danger' : '';
            const itbClass = itb < 0 ? 'danger' : itb < 0.5 ? 'warning' : 'success';

            el.innerHTML = `
                <div class="tw-budget-bar-top">
                    <div class="tw-budget-section">
                        <div class="tw-budget-lbl">Transfers</div>
                        <div class="tw-budget-val">${count} / ${ft} Free</div>
                    </div>
                    <div class="tw-budget-sep"></div>
                    <div class="tw-budget-section">
                        <div class="tw-budget-lbl">Point Hit</div>
                        <div class="tw-budget-val ${hitClass}">${hit > 0 ? '-' : ''}${hit} pts</div>
                    </div>
                    <div class="tw-budget-sep"></div>
                    <div class="tw-budget-section">
                        <div class="tw-budget-lbl">In The Bank</div>
                        <div class="tw-budget-val ${itbClass}">£${itb.toFixed(1)}m</div>
                    </div>
                    <div class="tw-budget-sep"></div>
                    <div class="tw-budget-section">
                        <div class="tw-budget-lbl">Squad Value</div>
                        <div class="tw-budget-val">£${((picksData?.entry_history?.value || 0) / 10).toFixed(1)}m</div>
                    </div>
                    <button class="tw-confirm-btn" ${!allFilled ? 'disabled' : ''} onclick="twShowSummary()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><polyline points="20 6 9 17 4 12"/></svg>
                        View Summary
                    </button>
                </div>
            `;
        }

        function renderTWDraftBoard() {
            const el = document.getElementById('twDraftBoard');
            if (!el) return;
            const maxSlots = 5;
            const pending = transferState.pending;

            let slotsHtml = '';
            if (pending.length === 0) {
                slotsHtml = `<div style="padding:24px 14px;text-align:center;color:var(--text-muted);font-size:12px;">
                    <i data-lucide="arrow-right-left" style="width:24px;height:24px;display:block;margin:0 auto 8px;opacity:0.3;"></i>
                    Select players to sell from your squad →
                </div>`;
            } else {
                for (let i = 0; i < pending.length; i++) {
                    const slot = pending[i];
                    const isActive = transferState.activeSlot === i;
                    const isComplete = !!slot.replacement;
                    const sold = slot.soldPlayer;
                    const posName = ['', 'GKP', 'DEF', 'MID', 'FWD'][sold.position] || '';

                    let inHtml = '';
                    if (isComplete) {
                        const repl = slot.replacement;
                        inHtml = `<div class="tw-slot-in">
                            <div class="tw-slot-in-name">${repl.name}</div>
                            <div class="tw-slot-in-meta">${repl.team} · £${repl.price.toFixed(1)}m</div>
                        </div>`;
                    } else {
                        inHtml = `<div class="tw-slot-in">
                            <div class="tw-slot-in-empty">Click to find replacement</div>
                        </div>`;
                    }

                    slotsHtml += `<div class="tw-slot-card${isActive ? ' active' : ''}${isComplete ? ' complete' : ''}" onclick="twSelectSlot(${i})">
                        <div class="tw-slot-num">${i + 1}</div>
                        <div class="tw-slot-out">
                            <div class="tw-slot-out-name">${sold.name}</div>
                            <div class="tw-slot-out-meta">${posName} · £${(sold.sellPrice || sold.price).toFixed(1)}m</div>
                        </div>
                        <div class="tw-slot-arrow">→</div>
                        ${inHtml}
                        <button class="tw-slot-remove" onclick="event.stopPropagation();twRemoveSlot(${i});" title="Remove transfer">×</button>
                    </div>`;
                }
            }

            const canAdd = pending.length < maxSlots;

            el.innerHTML = `
                <div class="tw-board">
                    <div class="tw-board-header">
                        <i data-lucide="clipboard-list" style="width:14px;height:14px;"></i>
                        Transfer Plan${pending.length > 0 ? ' (' + pending.length + ')' : ''}
                    </div>
                    <div class="tw-board-body">
                        ${slotsHtml}
                        ${canAdd ? `<button class="tw-add-slot" onclick="twAddTransferSlot()">
                            <i data-lucide="plus" style="width:14px;height:14px;"></i> Add Transfer
                        </button>` : ''}
                    </div>
                    ${pending.length > 0 ? `<div class="tw-board-actions">
                        <button class="tw-btn tw-btn-danger" onclick="twClearAll()">
                            <i data-lucide="trash-2" style="width:12px;height:12px;"></i> Clear All
                        </button>
                        <button class="tw-btn tw-btn-secondary" onclick="renderTransferWizard()">
                            <i data-lucide="refresh-cw" style="width:12px;height:12px;"></i> Start Over
                        </button>
                    </div>` : ''}
                </div>
            `;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        function renderTWScoutPanel() {
            const el = document.getElementById('twScoutPanel');
            if (!el) return;
            const mode = transferState.mode;
            if (mode === 'compare' && transferState.previewPlayer && transferState.activeSlot >= 0) {
                renderTWComparison(el);
            } else if (mode === 'market' && transferState.activeSlot >= 0) {
                renderTWMarket(el);
            } else if (mode === 'summary') {
                twRenderSummaryPanel(el);
            } else {
                renderTWSquadPicker(el);
            }
        }

        function renderTWSquadPicker(el) {
            const filledIds = new Set(transferState.pending.filter(s => s.replacement).map(s => s.soldPlayer.id));
            const pendingSellIds = new Set(transferState.pending.filter(s => !s.replacement).map(s => s.soldPlayer.id));
            const totalPending = transferState.pending.length;
            const positions = [
                { type: 1, label: 'Goalkeepers' },
                { type: 2, label: 'Defenders' },
                { type: 3, label: 'Midfielders' },
                { type: 4, label: 'Forwards' }
            ];

            let html = '';
            for (const pos of positions) {
                const players = selectedPlayers.filter(p => p.position === pos.type);
                if (players.length === 0) continue;

                html += '<div class="tw-pos-group"><div class="tw-pos-group-label">' + pos.label + '</div>';
                for (const p of players) {
                    const hasFill = filledIds.has(p.id);
                    const isPending = pendingSellIds.has(p.id);
                    const result = analysisResults?.find(r => r.player?.id === p.id || r.id === p.id);
                    const verdict = result?.verdict || '';
                    const verdictClass = verdict.toLowerCase().replace(/[^a-z]/g, '');

                    const fixes = teamFixtures[p.teamId] || p.fixtures || [];
                    const nextFix = fixes[0];
                    let fixHtml = '';
                    if (nextFix) {
                        fixHtml = '<span class="tw-sr-fixture"><span class="fdr-dot fdr-' + nextFix.difficulty + '"></span>' + nextFix.opponent + '(' + (nextFix.isHome ? 'H' : 'A') + ')</span>';
                    }

                    let rowClass = 'tw-squad-row';
                    if (hasFill) rowClass += ' sold';
                    else if (isPending) rowClass += ' pending-sell';
                    if (p.onBench && !isPending && !hasFill) rowClass += ' on-bench';
                    const canToggle = isPending || (!hasFill && totalPending < 5);

                    html += '<div class="' + rowClass + '"' + (canToggle ? ' onclick="twPickOutPlayer(' + p.id + ')"' : '') + '>' +
                        '<span class="tw-sr-check">' + (isPending ? '✓' : hasFill ? '🔒' : '') + '</span>' +
                        '<span class="tw-sr-pos">' + ['', 'GK', 'DEF', 'MID', 'FWD'][p.position] + '</span>' +
                        '<span class="tw-sr-name">' + p.name + '</span>' +
                        fixHtml +
                        '<span class="tw-sr-pill">£' + (p.sellPrice || p.price).toFixed(1) + 'm</span>' +
                        '<span class="tw-sr-pill">' + (p.form || 0).toFixed(1) + '</span>' +
                        (verdict ? '<span class="tw-sr-verdict ' + verdictClass + '">' + verdict + '</span>' : '') +
                        '</div>';
                }
                html += '</div>';
            }

            const unfilled = transferState.pending.filter(s => !s.replacement).length;
            const footerHtml = '<div class="tw-squad-footer">' +
                '<span class="tw-squad-count">' + totalPending + '/5 selected</span>' +
                '<button class="tw-btn tw-btn-primary" onclick="twStartMarketForSlots()"' + (unfilled === 0 ? ' disabled' : '') + ' style="margin-left:auto;">' +
                '<i data-lucide="search" style="width:12px;height:12px;"></i> Find Replacements' + (unfilled > 0 ? ' (' + unfilled + ')' : '') + '</button>' +
                '</div>';

            el.innerHTML = '<div class="tw-scout">' +
                '<div class="tw-scout-header"><i data-lucide="users" style="width:14px;height:14px;"></i> Your Squad — Tap players to sell</div>' +
                '<div class="tw-scout-body tw-squad-picker">' + html + '</div>' + footerHtml + '</div>';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        function renderTWMarket(el) {
            const slotIdx = transferState.activeSlot;
            if (slotIdx < 0 || !transferState.pending[slotIdx]) {
                renderTWSquadPicker(el);
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

            let candidates;
            if (tab === 'ai') {
                const cacheKey = pos + '_' + maxPrice.toFixed(1);
                if (!transferState.candidateCache[cacheKey]) {
                    transferState.candidateCache[cacheKey] = findTransferCandidates(pos, maxPrice, excludeIds);
                }
                candidates = [...transferState.candidateCache[cacheKey]];
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

            let rowsHtml = '';
            if (display.length === 0) {
                rowsHtml = '<div class="tw-market-empty">' + (tab === 'browse' && transferState.browseSearch ? 'No players match your search' : 'No candidates found within budget') + '</div>';
            } else {
                for (let i = 0; i < display.length; i++) {
                    const c = display[i];
                    const affordable = c.price <= maxPrice;
                    const previewed = transferState.previewPlayer?.id === c.id;
                    const score = c._transferScore || 0;
                    const cols = getStatCols(c);
                    const teamName = c.team || teams[c.teamId]?.short_name || '';
                    const fixes = teamFixtures[c.teamId] || c.fixtures || [];
                    const nextF = fixes[0];
                    const fdrHtml = nextF ? '<span class="fdr-dot fdr-' + nextF.difficulty + '"></span>' + nextF.opponent + '(' + (nextF.isHome ? 'H' : 'A') + ')' : '';

                    let miniStats = '';
                    for (const col of cols) {
                        miniStats += '<span class="tw-market-mini-stat' + statCls(col) + '" title="' + col.label + '">' + col.val + '</span>';
                    }

                    rowsHtml += '<div class="tw-market-row' + (previewed ? ' previewed' : '') + '" onclick="twPreviewPlayer(' + c.id + ')" style="' + (!affordable ? 'opacity:0.4;' : '') + '">' +
                        '<div class="tw-market-rank">' + (i + 1) + '</div>' +
                        '<span class="tw-market-name">' + c.name + '</span>' +
                        '<span style="font-size:10px;color:var(--text-muted);flex-shrink:0;">' + teamName + '</span>' +
                        '<span class="tw-market-price">£' + c.price.toFixed(1) + 'm ' + priceChangeBadge(c) + '</span>' +
                        '<span class="tw-market-stat" style="color:' + ((c.form || 0) >= 5 ? 'var(--color-success)' : 'var(--text-secondary)') + ';">' + (c.form || 0).toFixed(1) + '</span>' +
                        '<span class="tw-market-score" title="AI Score">' + score.toFixed(0) + '</span>' +
                        '<div class="tw-market-row-detail">' + miniStats +
                        (fdrHtml ? '<span class="tw-sr-fixture" style="margin-left:auto;">' + fdrHtml + '</span>' : '') +
                        '</div></div>';
                }
            }

            const tabsHtml = '<div class="tw-market-tabs">' +
                '<button class="tw-market-tab' + (tab === 'ai' ? ' active' : '') + '" onclick="twSwitchMarketTab(\'ai\')">AI Picks</button>' +
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

        function renderTWComparison(el) {
            const slotIdx = transferState.activeSlot;
            const slot = transferState.pending[slotIdx];
            if (!slot || !transferState.previewPlayer) { renderTWMarket(el); return; }

            const sold = slot.soldPlayer;
            const candidate = transferState.previewPlayer;
            const pos = sold.position;
            const posName = ['', 'GK', 'DEF', 'MID', 'FWD'][pos];
            const soldPrice = sold.sellPrice || sold.price;
            const candPrice = candidate.price;
            const itb = getTWLiveITB();
            const affordable = candPrice <= itb + (slot.replacement ? slot.replacement.price : 0);

            // Detailed stats
            const soldRecent = getPlayerRecentStats(sold.id, 5);
            const candRecent = getPlayerRecentStats(candidate.id, 5);
            const soldSeason = getPlayerSeasonPer90(sold);
            const candSeason = getPlayerSeasonPer90(candidate);

            function fmtV(v, dec, suf) { return v == null ? '-' : (dec === 0 ? Math.round(v) : v.toFixed(dec || 1)) + (suf || ''); }
            function compRow(label, lv, rv, higherBetter, lfmt, rfmt) {
                const left = lfmt || fmtV(lv);
                const right = rfmt || fmtV(rv);
                const lB = higherBetter ? lv > rv : lv < rv;
                const rB = higherBetter ? rv > lv : rv < lv;
                return '<div class="tw-compare-stat-row">' +
                    '<div class="tw-compare-stat-val left' + (lB ? ' better' : rB ? ' worse' : '') + '">' + left + '</div>' +
                    '<div class="tw-compare-stat-label">' + label + '</div>' +
                    '<div class="tw-compare-stat-val right' + (rB ? ' better' : lB ? ' worse' : '') + '">' + right + '</div></div>';
            }

            // ── Section 1: Core Stats ──
            let coreHtml = '';
            coreHtml += compRow('Price', soldPrice, candPrice, false, '£' + soldPrice.toFixed(1) + 'm', '£' + candPrice.toFixed(1) + 'm');
            coreHtml += compRow('Form', sold.form || 0, candidate.form || 0, true);
            coreHtml += compRow('PPG', sold.ppg || 0, candidate.ppg || 0, true);
            coreHtml += compRow('Pts (L5)', soldRecent?.points || 0, candRecent?.points || 0, true, fmtV(soldRecent?.points, 0), fmtV(candRecent?.points, 0));
            coreHtml += compRow('Mins/G', soldRecent ? soldRecent.minutes / soldRecent.games : 0, candRecent ? candRecent.minutes / candRecent.games : 0, true, fmtV(soldRecent ? soldRecent.minutes / soldRecent.games : 0, 0), fmtV(candRecent ? candRecent.minutes / candRecent.games : 0, 0));
            coreHtml += compRow('Ownership', sold.ownership || 0, candidate.ownership || 0, false, fmtV(sold.ownership, 1, '%'), fmtV(candidate.ownership, 1, '%'));
            coreHtml += compRow('ICT', parseFloat(sold.ictIndex) || 0, parseFloat(candidate.ictIndex) || 0, true);
            coreHtml += compRow('Transfer Score', calculateTransferScore(sold, pos), calculateTransferScore(candidate, pos), true, fmtV(calculateTransferScore(sold, pos), 0), fmtV(calculateTransferScore(candidate, pos), 0));

            // ── Section 2: Position Stats (Recent + Season + Trend) ──
            const soldPosStats = getPositionStats(sold, soldSeason, soldRecent);
            const candPosStats = getPositionStats(candidate, candSeason, candRecent);
            let posHtml = '';
            for (let i = 0; i < soldPosStats.length; i++) {
                const sp = soldPosStats[i], cp = candPosStats[i];
                const sTrend = getTrend(sp.sVal, sp.rVal, sp.higherBetter);
                const cTrend = getTrend(cp.sVal, cp.rVal, cp.higherBetter);
                const lB = sp.higherBetter ? (sp.rVal || 0) > (cp.rVal || 0) : (sp.rVal || 0) < (cp.rVal || 0);
                const rB = sp.higherBetter ? (cp.rVal || 0) > (sp.rVal || 0) : (cp.rVal || 0) < (sp.rVal || 0);
                posHtml += '<div class="tw-compare-stat-row">' +
                    '<div class="tw-compare-stat-val left' + (lB ? ' better' : rB ? ' worse' : '') + '">' + sp.recent +
                    '<span class="tw-compare-trend ' + sTrend.cls + '">' + sTrend.icon + '</span>' +
                    '<div class="tw-compare-sub">Season: ' + sp.season + '</div></div>' +
                    '<div class="tw-compare-stat-label">' + sp.label + '</div>' +
                    '<div class="tw-compare-stat-val right' + (rB ? ' better' : lB ? ' worse' : '') + '">' + cp.recent +
                    '<span class="tw-compare-trend ' + cTrend.cls + '">' + cTrend.icon + '</span>' +
                    '<div class="tw-compare-sub">Season: ' + cp.season + '</div></div></div>';
            }

            // ── Section 3: Routes to Points ──
            function twComputeRoutes(player) {
                const goalPts = { 1: 6, 2: 6, 3: 5, 4: 4 };
                const csPtsMap = { 1: 4, 2: 4, 3: 1, 4: 0 };
                const seasonGames = Math.max(currentGW - 1, 1);
                const recent = getPlayerRecentStats(player.id, 5);
                const rg = recent?.games || 1;
                const blend = (rVal, sVal, sDivisor) => ((rVal || 0) / rg) * 0.6 + ((sVal || 0) / sDivisor) * 0.4;

                const xGpg = blend(recent?.xG, player.xG, seasonGames);
                const xApg = blend(recent?.xA, player.xA, seasonGames);
                const goalsPg = blend(recent?.goals, player.goals, seasonGames);
                const assistsPg = blend(recent?.assists, player.assists, seasonGames);
                const csPg = blend(recent?.cs, player.cleanSheets, seasonGames);
                const bonusPg = blend(recent?.bonus, player.bonus, seasonGames);
                const savesPg = pos === 1 ? blend(recent?.saves, player.saves, seasonGames) : 0;
                const creativityPg = (player.creativity || 0) / seasonGames;

                const goalThresh = { 1: 0.03, 2: 0.06, 3: 0.12, 4: 0.15 }[pos];
                const assistThresh = { 1: 0.02, 2: 0.06, 3: 0.10, 4: 0.08 }[pos];
                const csThresh = { 1: 0.15, 2: 0.15, 3: 0.30, 4: 999 }[pos];
                const bonusThresh = { 1: 0.3, 2: 0.3, 3: 0.4, 4: 0.5 }[pos];

                const routes = [];
                if (xGpg >= goalThresh || goalsPg >= goalThresh * 1.5) {
                    const ceiling = pos === 4 ? 0.6 : pos === 3 ? 0.5 : 0.3;
                    routes.push({ name: 'Goals', strength: Math.min(10, (xGpg / ceiling) * 10), detail: xGpg.toFixed(2) + ' xG/g', color: '#F87171', ptWeight: goalPts[pos] });
                }
                if (xApg >= assistThresh || assistsPg >= assistThresh * 1.5) {
                    const ceiling = pos === 3 ? 0.4 : 0.3;
                    routes.push({ name: 'Assists', strength: Math.min(10, (xApg / ceiling) * 10), detail: xApg.toFixed(2) + ' xA/g', color: '#60A5FA', ptWeight: 3 });
                }
                if (csPg >= csThresh) {
                    routes.push({ name: 'Clean Sheets', strength: Math.min(10, (csPg / 0.55) * 10), detail: (csPg * 100).toFixed(0) + '% rate', color: '#34D399', ptWeight: csPtsMap[pos] });
                }
                if (bonusPg >= bonusThresh) {
                    routes.push({ name: 'Bonus', strength: Math.min(10, (bonusPg / 2) * 10), detail: bonusPg.toFixed(1) + '/g', color: '#FBBF24', ptWeight: 2 });
                }
                if (pos === 1 && savesPg >= 2) {
                    routes.push({ name: 'Saves', strength: Math.min(10, (savesPg / 5) * 10), detail: savesPg.toFixed(1) + '/g', color: '#A78BFA', ptWeight: 1.5 });
                }
                if (creativityPg >= 12 && (pos === 3 || pos === 2)) {
                    routes.push({ name: 'Creativity', strength: Math.min(10, (creativityPg / 45) * 10), detail: creativityPg.toFixed(0) + ' crea/g', color: '#FB923C', ptWeight: 1.5 });
                }
                const seasonPenGoals = Math.max(0, (player.goals || 0) - (player.xG || 0));
                const penThresholds = { 1: 999, 2: 0.5, 3: 1.0, 4: 1.5 };
                const penAttempts = seasonPenGoals >= (penThresholds[pos] || 1) ? Math.round(seasonPenGoals) : 0;
                if (penAttempts >= 2 && pos !== 1) {
                    routes.push({ name: 'Penalties', strength: Math.min(10, Math.max(3, penAttempts * 2)), detail: penAttempts + ' taken', color: '#F472B6', ptWeight: goalPts[pos] * 0.76 });
                }
                return routes;
            }

            function renderRoutesBars(routes) {
                if (routes.length === 0) return '<div class="tw-routes-none">No qualifying routes</div>';
                const order = { Goals: 0, Assists: 1, 'Clean Sheets': 2, Penalties: 3, Bonus: 4, Saves: 5, Creativity: 6 };
                const sorted = [...routes].sort((a, b) => (order[a.name] ?? 99) - (order[b.name] ?? 99));
                return sorted.map(r =>
                    '<div class="tw-route-bar-row">' +
                    '<span class="tw-route-bar-name">' + r.name + '</span>' +
                    '<div class="tw-route-bar-track"><div class="tw-route-bar-fill" style="width:' + (r.strength * 10) + '%;background:' + r.color + ';"></div></div>' +
                    '<span class="tw-route-bar-detail">' + r.detail + '</span></div>'
                ).join('');
            }

            const soldRoutes = twComputeRoutes(sold);
            const candRoutes = twComputeRoutes(candidate);

            const routesHtml = '<div class="tw-routes-grid">' +
                '<div class="tw-routes-side">' +
                '<div class="tw-routes-player-label" style="color:var(--color-error);">' + sold.name + '</div>' +
                '<div class="tw-route-count">' + soldRoutes.length + '</div><div class="tw-route-count-label">routes</div>' +
                renderRoutesBars(soldRoutes) + '</div>' +
                '<div class="tw-routes-side">' +
                '<div class="tw-routes-player-label" style="color:var(--color-success);">' + candidate.name + '</div>' +
                '<div class="tw-route-count">' + candRoutes.length + '</div><div class="tw-route-count-label">routes</div>' +
                renderRoutesBars(candRoutes) + '</div></div>';

            // ── Section 4: Multi-Metric Trend Charts ──
            const soldPd = playersDetailData?.players?.find(p => p.id === sold.id);
            const candPd = playersDetailData?.players?.find(p => p.id === candidate.id);
            const soldHist = (soldPd?.history || []).filter(h => h.minutes > 0).slice(-8);
            const candHist = (candPd?.history || []).filter(h => h.minutes > 0).slice(-8);
            const hasChart = soldHist.length >= 2 || candHist.length >= 2;

            // Define position-specific chart metrics
            const chartMetrics = {
                1: [ // GK
                    { key: 'total_points', label: 'Points', color: '#FBBF24', per90: false },
                    { key: 'saves', label: 'Saves', color: '#A78BFA', per90: false },
                    { key: 'expected_goals_conceded', label: 'xGC', color: '#F87171', per90: true, lowerBetter: true },
                    { key: 'clean_sheets', label: 'CS', color: '#34D399', per90: false }
                ],
                2: [ // DEF
                    { key: 'total_points', label: 'Points', color: '#FBBF24', per90: false },
                    { key: 'expected_goals_conceded', label: 'xGC', color: '#F87171', per90: true, lowerBetter: true },
                    { key: 'expected_goal_involvements', label: 'xGI', color: '#60A5FA', per90: true },
                    { key: 'clean_sheets', label: 'CS', color: '#34D399', per90: false },
                    { key: 'bonus', label: 'Bonus', color: '#FB923C', per90: false }
                ],
                3: [ // MID
                    { key: 'total_points', label: 'Points', color: '#FBBF24', per90: false },
                    { key: 'expected_goal_involvements', label: 'xGI', color: '#60A5FA', per90: true },
                    { key: 'expected_goals', label: 'xG', color: '#F87171', per90: true },
                    { key: 'expected_assists', label: 'xA', color: '#34D399', per90: true },
                    { key: 'bonus', label: 'Bonus', color: '#FB923C', per90: false }
                ],
                4: [ // FWD
                    { key: 'total_points', label: 'Points', color: '#FBBF24', per90: false },
                    { key: 'expected_goals', label: 'xG', color: '#F87171', per90: true },
                    { key: 'expected_goal_involvements', label: 'xGI', color: '#60A5FA', per90: true },
                    { key: 'goals_scored', label: 'Goals', color: '#34D399', per90: false },
                    { key: 'bonus', label: 'Bonus', color: '#FB923C', per90: false }
                ]
            };

            const metrics = chartMetrics[pos] || chartMetrics[3];

            let chartTabsHtml = '';
            let chartCanvasHtml = '';
            if (hasChart) {
                chartTabsHtml = '<div class="tw-chart-tabs">' +
                    metrics.map((m, i) =>
                        '<button class="tw-chart-tab' + (i === 0 ? ' active' : '') + '" onclick="twSwitchChart(' + i + ')">' + m.label + '</button>'
                    ).join('') + '</div>';
                chartCanvasHtml = '<div class="tw-chart-legend">' +
                    '<span><span class="tw-chart-legend-dot" style="background:#F87171;"></span>' + sold.name + ' (solid)</span>' +
                    '<span><span class="tw-chart-legend-dot" style="background:#60A5FA;"></span>' + candidate.name + ' (dashed)</span></div>' +
                    '<canvas id="twTrendChart" class="tw-chart-canvas" width="460" height="140"></canvas>';
            }

            // ── Section 5: Team Context ──
            const sT = teamAnalysis[sold.teamId] || {};
            const cT = teamAnalysis[candidate.teamId] || {};
            const sXg = getTeamSeasonXg(sold.teamId);
            const cXg = getTeamSeasonXg(candidate.teamId);

            let teamHtml = '';
            teamHtml += compRow('Attack Power', sT.attackPower || 0, cT.attackPower || 0, true);
            teamHtml += compRow('Defense Power', sT.defensePower || 0, cT.defensePower || 0, true);
            teamHtml += compRow('Form Rating', sT.formRating || 0, cT.formRating || 0, true);
            teamHtml += compRow('Fixture Score', sT.fixtureScore || 0, cT.fixtureScore || 0, true);
            teamHtml += compRow('CS Rate', (sT.csRate || 0) * 100, (cT.csRate || 0) * 100, true, fmtV((sT.csRate || 0) * 100, 0, '%'), fmtV((cT.csRate || 0) * 100, 0, '%'));
            teamHtml += compRow('Avg FDR', sT.avgFdr || 0, cT.avgFdr || 0, false);
            if (sXg && cXg) {
                teamHtml += compRow('xG/Game', sXg.xGpg, cXg.xGpg, true);
                teamHtml += compRow('xGC/Game', sXg.xGCpg, cXg.xGCpg, false);
            }
            teamHtml += compRow('Atk Home', sT.attackPowerHome || 0, cT.attackPowerHome || 0, true);
            teamHtml += compRow('Atk Away', sT.attackPowerAway || 0, cT.attackPowerAway || 0, true);
            teamHtml += compRow('Def Home', sT.defensePowerHome || 0, cT.defensePowerHome || 0, true);
            teamHtml += compRow('Def Away', sT.defensePowerAway || 0, cT.defensePowerAway || 0, true);

            // ── Section 6: Fixture Comparison (next 5) ──
            const soldFix = teamFixtures[sold.teamId] || sold.fixtures || [];
            const candFix = teamFixtures[candidate.teamId] || candidate.fixtures || [];
            const maxFix = Math.min(5, Math.max(soldFix.length, candFix.length));
            let fixHtml = '';
            for (let i = 0; i < maxFix; i++) {
                const sf = soldFix[i], cf = candFix[i];
                const sfText = sf ? sf.opponent + '(' + (sf.isHome ? 'H' : 'A') + ')' : '-';
                const sfFdr = sf ? sf.difficulty : 3;
                const cfText = cf ? cf.opponent + '(' + (cf.isHome ? 'H' : 'A') + ')' : '-';
                const cfFdr = cf ? cf.difficulty : 3;
                let sfCs = '', cfCs = '';
                if (sf && sf.opponentId) sfCs = '<div class="tw-compare-sub">CS: ' + (getCleanSheetProb(sold.teamId, sf.opponentId, sf.isHome) * 100).toFixed(0) + '%</div>';
                if (cf && cf.opponentId) cfCs = '<div class="tw-compare-sub">CS: ' + (getCleanSheetProb(candidate.teamId, cf.opponentId, cf.isHome) * 100).toFixed(0) + '%</div>';
                fixHtml += '<div class="tw-compare-stat-row">' +
                    '<div class="tw-compare-stat-val left"><span class="fdr-dot fdr-' + sfFdr + '"></span> ' + sfText + sfCs + '</div>' +
                    '<div class="tw-compare-stat-label">GW' + (currentGW + 1 + i) + '</div>' +
                    '<div class="tw-compare-stat-val right"><span class="fdr-dot fdr-' + cfFdr + '"></span> ' + cfText + cfCs + '</div></div>';
            }

            // ── Assemble ──
            el.innerHTML = '<div class="tw-scout">' +
                '<div class="tw-scout-header"><i data-lucide="git-compare" style="width:14px;height:14px;"></i> Head-to-Head Comparison</div>' +
                '<div class="tw-compare-panel">' +
                '<div class="tw-compare-header">' +
                '<button class="tw-compare-back" onclick="twBackToMarket()"><i data-lucide="arrow-left" style="width:12px;height:12px;"></i> Back</button>' +
                '<button class="tw-compare-pick-btn" onclick="twConfirmPick()" ' + (!affordable ? 'disabled title="Over budget"' : '') + '>' +
                '<i data-lucide="check" style="width:12px;height:12px;display:inline;vertical-align:middle;"></i> Confirm Pick</button></div>' +
                '<div class="tw-compare-grid">' +
                '<div class="tw-compare-col"><div class="tw-compare-player-name" style="color:var(--color-error);">' + sold.name + '</div>' +
                '<div class="tw-compare-player-meta">' + (sold.team || '') + ' · ' + posName + ' · £' + soldPrice.toFixed(1) + 'm</div></div>' +
                '<div class="tw-compare-vs">VS</div>' +
                '<div class="tw-compare-col"><div class="tw-compare-player-name" style="color:var(--color-success);">' + candidate.name + '</div>' +
                '<div class="tw-compare-player-meta">' + (candidate.team || '') + ' · ' + posName + ' · £' + candPrice.toFixed(1) + 'm</div></div></div>' +
                '<div class="tw-compare-section"><div class="tw-compare-section-title"><i data-lucide="bar-chart-2" style="width:12px;height:12px;"></i> Core Stats</div>' +
                '<div class="tw-compare-stats">' + coreHtml + '</div></div>' +
                '<div class="tw-compare-section"><div class="tw-compare-section-title"><i data-lucide="target" style="width:12px;height:12px;"></i> Position Stats (Recent · Season)</div>' +
                '<div class="tw-compare-stats">' + posHtml + '</div></div>' +
                '<div class="tw-compare-section"><div class="tw-compare-section-title"><i data-lucide="route" style="width:12px;height:12px;"></i> Routes to Points</div>' + routesHtml + '</div>' +
                (hasChart ? '<div class="tw-compare-section"><div class="tw-compare-section-title"><i data-lucide="trending-up" style="width:12px;height:12px;"></i> Performance Trends (Last 8 Games)</div>' +
                '<div class="tw-chart-wrap">' + chartTabsHtml + chartCanvasHtml + '</div></div>' : '') +
                '<div class="tw-compare-section"><div class="tw-compare-section-title"><i data-lucide="shield" style="width:12px;height:12px;"></i> Team Context — ' + (sold.team || '') + ' vs ' + (candidate.team || '') + '</div>' +
                '<div class="tw-compare-stats">' + teamHtml + '</div></div>' +
                '<div class="tw-compare-section"><div class="tw-compare-section-title"><i data-lucide="calendar" style="width:12px;height:12px;"></i> Next Fixtures + CS Probability</div>' +
                '<div class="tw-compare-stats">' + fixHtml + '</div></div>' +
                twBuildRisingFormSection(sold, candidate) +
                twBuildHomeSplitsSection(sold, candidate, pos) +
                twBuildXgRegressionSection(sold, candidate) +
                '</div></div>';
            if (typeof lucide !== 'undefined') lucide.createIcons();

            // Store chart data for tab switching
            if (hasChart) {
                window._twChartData = { soldHist, candHist, metrics, soldName: sold.name, candName: candidate.name };
                twDrawTrendChart(0);
            }
        }

        // ── TW: Rising Form Signals Section ──
        function twBuildRisingFormSection(sold, candidate) {
            function getRisingSignals(player) {
                const ta = teamAnalysis[player.teamId] || {};
                const swing = fixtureSwingData[player.teamId] || {};
                const ss = seasonStats[player.teamId] || {};
                const txg = teamXgData[player.teamId] || {};
                const signals = [];
                const l5 = ss.last5 || '';
                if (ta.formRating > 55) signals.push({ label: 'Team in Form', value: l5 || (ta.formRating + ' rating'), positive: true });
                if (txg.recentXgPg && txg.seasonXgPg && txg.recentXgPg > txg.seasonXgPg * 1.05) signals.push({ label: 'xG Rising', value: '+' + ((txg.recentXgPg - txg.seasonXgPg) * 100 / txg.seasonXgPg).toFixed(0) + '% vs season', positive: true });
                if (txg.recentXgcPg && txg.seasonXgcPg && txg.recentXgcPg < txg.seasonXgcPg * 0.95) signals.push({ label: 'xGC Improving', value: ((txg.seasonXgcPg - txg.recentXgcPg) * 100 / txg.seasonXgcPg).toFixed(0) + '% better', positive: true });
                if (swing.direction === 'improving') signals.push({ label: 'Fixtures Improving', value: 'Swing +' + (swing.magnitude || '').toString(), positive: true });
                else if (swing.direction === 'worsening') signals.push({ label: 'Fixtures Worsening', value: 'Swing -' + (swing.magnitude || '').toString(), positive: false });
                const avgFdr = ta.avgFdr || 3;
                if (avgFdr <= 2.5) signals.push({ label: 'Easy Run', value: 'Avg FDR ' + avgFdr.toFixed(1), positive: true });
                return signals;
            }
            const sSig = getRisingSignals(sold), cSig = getRisingSignals(candidate);
            if (sSig.length === 0 && cSig.length === 0) return '';
            function renderSignals(sigs) {
                if (sigs.length === 0) return '<div style="font-size:11px;color:var(--text-muted);padding:4px 0;">No signals</div>';
                return sigs.map(s => '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:11px;">' +
                    '<span style="color:' + (s.positive ? 'var(--color-success)' : 'var(--color-error)') + ';">' + (s.positive ? '▲' : '▼') + '</span>' +
                    '<span style="font-weight:600;">' + s.label + '</span>' +
                    '<span style="color:var(--text-muted);margin-left:auto;font-family:var(--font-mono);font-size:10px;">' + s.value + '</span></div>').join('');
            }
            return '<div class="tw-compare-section"><div class="tw-compare-section-title"><i data-lucide="trending-up" style="width:12px;height:12px;"></i> Rising Form Signals</div>' +
                '<div class="tw-routes-grid"><div class="tw-routes-side"><div class="tw-routes-player-label" style="color:var(--color-error);">' + escHTML(sold.name) + '</div>' + renderSignals(sSig) + '</div>' +
                '<div class="tw-routes-side"><div class="tw-routes-player-label" style="color:var(--color-success);">' + escHTML(candidate.name) + '</div>' + renderSignals(cSig) + '</div></div></div>';
        }

        // ── TW: Home/Away Splits Section ──
        function twBuildHomeSplitsSection(sold, candidate, pos) {
            function getSplits(player) {
                if (!playersDetailData || !playersDetailData.players) return null;
                const pd = playersDetailData.players.find(p => p.id === player.id);
                if (!pd || !pd.history) return null;
                const played = pd.history.filter(h => h.minutes > 0);
                const home = played.filter(h => h.was_home);
                const away = played.filter(h => !h.was_home);
                function agg(games) {
                    if (games.length === 0) return { games: 0, points: 0, xGI: 0, cs: 0, bonus: 0 };
                    return {
                        games: games.length,
                        points: (games.reduce((s, h) => s + h.total_points, 0) / games.length).toFixed(1),
                        xGI: (games.reduce((s, h) => s + (parseFloat(h.expected_goal_involvements) || 0), 0) / games.length).toFixed(2),
                        cs: games.reduce((s, h) => s + (h.clean_sheets || 0), 0),
                        bonus: (games.reduce((s, h) => s + (h.bonus || 0), 0) / games.length).toFixed(1)
                    };
                }
                return { home: agg(home), away: agg(away) };
            }
            const sSplits = getSplits(sold), cSplits = getSplits(candidate);
            if (!sSplits && !cSplits) return '';
            function splitTable(splits, name) {
                if (!splits) return '<div style="font-size:11px;color:var(--text-muted);">' + escHTML(name) + ': Insufficient data</div>';
                return '<div style="margin-bottom:4px;"><div class="tw-routes-player-label">' + escHTML(name) + '</div>' +
                    '<table style="width:100%;font-size:11px;border-collapse:collapse;">' +
                    '<tr style="color:var(--text-muted);"><th style="text-align:left;font-weight:600;padding:3px 4px;"></th><th style="padding:3px 4px;">Home (' + splits.home.games + 'g)</th><th style="padding:3px 4px;">Away (' + splits.away.games + 'g)</th></tr>' +
                    '<tr><td style="padding:3px 4px;color:var(--text-muted);">PPG</td><td style="padding:3px 4px;text-align:center;font-family:var(--font-mono);">' + splits.home.points + '</td><td style="padding:3px 4px;text-align:center;font-family:var(--font-mono);">' + splits.away.points + '</td></tr>' +
                    '<tr><td style="padding:3px 4px;color:var(--text-muted);">xGI/g</td><td style="padding:3px 4px;text-align:center;font-family:var(--font-mono);">' + splits.home.xGI + '</td><td style="padding:3px 4px;text-align:center;font-family:var(--font-mono);">' + splits.away.xGI + '</td></tr>' +
                    '<tr><td style="padding:3px 4px;color:var(--text-muted);">CS</td><td style="padding:3px 4px;text-align:center;font-family:var(--font-mono);">' + splits.home.cs + '</td><td style="padding:3px 4px;text-align:center;font-family:var(--font-mono);">' + splits.away.cs + '</td></tr>' +
                    '<tr><td style="padding:3px 4px;color:var(--text-muted);">Bonus/g</td><td style="padding:3px 4px;text-align:center;font-family:var(--font-mono);">' + splits.home.bonus + '</td><td style="padding:3px 4px;text-align:center;font-family:var(--font-mono);">' + splits.away.bonus + '</td></tr>' +
                    '</table></div>';
            }
            return '<div class="tw-compare-section"><div class="tw-compare-section-title"><i data-lucide="home" style="width:12px;height:12px;"></i> Home vs Away Splits</div>' +
                '<div class="tw-routes-grid">' + '<div class="tw-routes-side">' + splitTable(sSplits, sold.name) + '</div>' +
                '<div class="tw-routes-side">' + splitTable(cSplits, candidate.name) + '</div></div></div>';
        }

        // ── TW: xG Regression Section ──
        function twBuildXgRegressionSection(sold, candidate) {
            function xgRegression(player) {
                const goals = player.goals || 0;
                const xG = player.xG || 0;
                const diff = goals - xG;
                const label = diff > 1 ? 'Overperforming' : diff < -1 ? 'Underperforming' : 'In line';
                const color = diff > 2 ? 'var(--color-warning)' : diff < -2 ? 'var(--color-success)' : 'var(--text-secondary)';
                return { goals, xG, diff, label, color };
            }
            const sR = xgRegression(sold), cR = xgRegression(candidate);
            return '<div class="tw-compare-section"><div class="tw-compare-section-title"><i data-lucide="refresh-cw" style="width:12px;height:12px;"></i> xG Regression Analysis</div>' +
                '<div class="tw-routes-grid"><div class="tw-routes-side">' +
                '<div class="tw-routes-player-label" style="color:var(--color-error);">' + escHTML(sold.name) + '</div>' +
                '<div style="display:flex;justify-content:space-between;font-size:11px;margin-top:4px;"><span>Goals: ' + sR.goals + '</span><span>xG: ' + sR.xG.toFixed(1) + '</span><span style="color:' + sR.color + ';font-weight:600;">' + sR.label + ' (' + (sR.diff >= 0 ? '+' : '') + sR.diff.toFixed(1) + ')</span></div></div>' +
                '<div class="tw-routes-side">' +
                '<div class="tw-routes-player-label" style="color:var(--color-success);">' + escHTML(candidate.name) + '</div>' +
                '<div style="display:flex;justify-content:space-between;font-size:11px;margin-top:4px;"><span>Goals: ' + cR.goals + '</span><span>xG: ' + cR.xG.toFixed(1) + '</span><span style="color:' + cR.color + ';font-weight:600;">' + cR.label + ' (' + (cR.diff >= 0 ? '+' : '') + cR.diff.toFixed(1) + ')</span></div></div></div></div>';
        }

        // ── Chart drawing + tab switching ──
        let _twActiveChart = 0;

        function twSwitchChart(idx) {
            _twActiveChart = idx;
            document.querySelectorAll('.tw-chart-tab').forEach((t, i) => t.classList.toggle('active', i === idx));
            twDrawTrendChart(idx);
        }

        function twDrawTrendChart(metricIdx) {
            const data = window._twChartData;
            if (!data) return;
            const canvas = document.getElementById('twTrendChart');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const dpr = window.devicePixelRatio || 1;
            const w = canvas.clientWidth;
            const h = canvas.clientHeight;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, w, h);

            const metric = data.metrics[metricIdx];
            const key = metric.key;
            const isPer90 = metric.per90;

            function extractVals(hist) {
                return hist.map(g => {
                    const raw = parseFloat(g[key]) || 0;
                    if (isPer90 && g.minutes > 0) return (raw / g.minutes) * 90;
                    return raw;
                });
            }

            const soldVals = extractVals(data.soldHist);
            const candVals = extractVals(data.candHist);
            const allVals = [...soldVals, ...candVals];
            const maxVal = Math.max(0.1, ...allVals) * 1.15;
            const maxLen = Math.max(data.soldHist.length, data.candHist.length);

            const pad = { top: 12, right: 14, bottom: 24, left: 32 };
            const plotW = w - pad.left - pad.right;
            const plotH = h - pad.top - pad.bottom;

            // Grid lines
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 1;
            const gridSteps = 4;
            for (let i = 0; i <= gridSteps; i++) {
                const v = (maxVal / gridSteps) * i;
                const y = pad.top + plotH - (v / maxVal) * plotH;
                ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
                ctx.fillStyle = 'rgba(255,255,255,0.3)';
                ctx.font = '9px monospace';
                ctx.textAlign = 'right';
                ctx.fillText(v < 10 ? v.toFixed(1) : Math.round(v), pad.left - 4, y + 3);
            }

            // GW labels
            const gwLabels = data.soldHist.length >= data.candHist.length ? data.soldHist : data.candHist;
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            gwLabels.forEach((g, i) => {
                const x = pad.left + (maxLen > 1 ? (i / (maxLen - 1)) * plotW : plotW / 2);
                ctx.fillText('GW' + (g.round || ''), x, h - 4);
            });

            function drawLine(vals, hist, color, dashed) {
                if (vals.length < 2) return;
                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.lineJoin = 'round';
                ctx.setLineDash(dashed ? [5, 3] : []);
                vals.forEach((v, i) => {
                    const x = pad.left + (maxLen > 1 ? (i / (maxLen - 1)) * plotW : plotW / 2);
                    const y = pad.top + plotH - (v / maxVal) * plotH;
                    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
                });
                ctx.stroke();
                ctx.setLineDash([]);
                // Dots
                vals.forEach((v, i) => {
                    const x = pad.left + (maxLen > 1 ? (i / (maxLen - 1)) * plotW : plotW / 2);
                    const y = pad.top + plotH - (v / maxVal) * plotH;
                    ctx.beginPath();
                    ctx.arc(x, y, 3, 0, Math.PI * 2);
                    ctx.fillStyle = color;
                    ctx.fill();
                });
            }

            drawLine(soldVals, data.soldHist, '#F87171', false);
            drawLine(candVals, data.candHist, '#60A5FA', true);

            // Y-axis label
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.font = '9px sans-serif';
            ctx.translate(8, pad.top + plotH / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.textAlign = 'center';
            ctx.fillText(metric.label + (isPer90 ? ' /90' : ''), 0, 0);
            ctx.restore();
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

            renderTWBudgetBar();
            renderTWDraftBoard();
            renderTWScoutPanel();
        }

        function twAddTransferSlot() {
            transferState.mode = 'squad';
            transferState.activeSlot = -1;
            transferState.previewPlayer = null;
            renderTWDraftBoard();
            renderTWScoutPanel();
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
            renderTWDraftBoard();
            renderTWScoutPanel();
        }

        function twSelectSlot(idx) {
            if (idx < 0 || idx >= transferState.pending.length) return;
            transferState.activeSlot = idx;
            transferState.mode = 'market';
            transferState.previewPlayer = null;
            renderTWDraftBoard();
            renderTWScoutPanel();
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
            renderTWBudgetBar();
            renderTWDraftBoard();
            renderTWScoutPanel();
        }

        function twPreviewPlayer(playerId) {
            const candidates = Object.values(transferState.candidateCache).flat();
            let candidate = candidates.find(c => c.id === playerId);
            if (!candidate) candidate = allPlayers.find(p => p.id === playerId);
            if (!candidate) return;
            transferState.previewPlayer = candidate;
            transferState.mode = 'compare';
            renderTWScoutPanel();
        }

        function twBackToMarket() {
            transferState.previewPlayer = null;
            transferState.mode = 'market';
            renderTWScoutPanel();
        }

        function twBackToSquad() {
            transferState.mode = 'squad';
            transferState.activeSlot = -1;
            transferState.previewPlayer = null;
            renderTWDraftBoard();
            renderTWScoutPanel();
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

            renderTWBudgetBar();
            renderTWDraftBoard();
            renderTWScoutPanel();
        }

        function twSetMarketFilter(key, value) {
            transferState.marketFilter[key] = value;
            renderTWScoutPanel();
        }

        let twSearchTimeout = null;
        function twSwitchMarketTab(tab) {
            transferState.marketTab = tab;
            transferState.browseSearch = '';
            renderTWScoutPanel();
        }

        function twSearchInput(value) {
            transferState.browseSearch = value;
            clearTimeout(twSearchTimeout);
            twSearchTimeout = setTimeout(() => {
                renderTWScoutPanel();
                const inp = document.querySelector('.tw-market-search');
                if (inp) { inp.focus(); inp.selectionStart = inp.selectionEnd = inp.value.length; }
            }, 250);
        }

        function twSetBrowseSort(sort) {
            transferState.browseSort = sort;
            renderTWScoutPanel();
        }

        function twClearAll() {
            transferState.pending = [];
            transferState.activeSlot = -1;
            transferState.mode = 'squad';
            transferState.candidateCache = {};
            transferState.previewPlayer = null;
            renderTWBudgetBar();
            renderTWDraftBoard();
            renderTWScoutPanel();
        }

        function twShowSummary() {
            if (!transferState.pending.every(s => s.replacement)) return;
            if (transferState.pending.length === 0) return;
            transferState.mode = 'summary';
            renderTWScoutPanel();
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
            renderTWDraftBoard();
            renderTWScoutPanel();
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

            // Compute pressure for all players
            const playersWithPressure = allPlayers.filter(p => p.ownership > 0.5 && p.minutes > 0).map(p => ({
                ...p,
                netTransfers: p.transfersIn - p.transfersOut,
                pressure: getTransferPressure(p),
                priceChangeGW: (p.costChangeEvent || 0) / 10,
                priceChangeSeason: (p.costChangeStart || 0) / 10,
                posName: ['','GK','DEF','MID','FWD'][p.position] || '?',
                posClass: ['','gk','def','mid','fwd'][p.position] || '',
                teamShort: (p.team || '???').substring(0, 3)
            }));

            // Identify squad players
            const squadIds = new Set(selectedPlayers.map(p => p.id));

            // Filter by position + price
            const filterPlayers = (list) => {
                let filtered = tmPosFilter === 'all' ? list : list.filter(p => p.position === parseInt(tmPosFilter));
                if (tmPriceFilter === 'premium') filtered = filtered.filter(p => p.price >= 10);
                else if (tmPriceFilter === 'budget') filtered = filtered.filter(p => p.price < 5);
                return filtered;
            };

            // Summary stats
            const risingCount = playersWithPressure.filter(p => p.priceChangeGW > 0).length;
            const fallingCount = playersWithPressure.filter(p => p.priceChangeGW < 0).length;
            const squadRising = playersWithPressure.filter(p => squadIds.has(p.id) && p.pressure > 0.015).length;
            const squadFalling = playersWithPressure.filter(p => squadIds.has(p.id) && p.pressure < -0.015).length;

            let html = '';

            // ─── Summary Cards ───
            html += `<div class="tm-summary-cards">
                <div class="tm-summary-card accent-green"><div class="tm-sc-value" style="color:var(--color-success);">${risingCount}</div><div class="tm-sc-label">Rose This GW</div></div>
                <div class="tm-summary-card accent-red"><div class="tm-sc-value" style="color:var(--color-error);">${fallingCount}</div><div class="tm-sc-label">Fell This GW</div></div>
                <div class="tm-summary-card accent-green"><div class="tm-sc-value" style="color:var(--color-success);">${squadRising}</div><div class="tm-sc-label">Your Squad Rising</div></div>
                <div class="tm-summary-card accent-red"><div class="tm-sc-value" style="color:var(--color-error);">${squadFalling}</div><div class="tm-sc-label">Your Squad Falling</div></div>
            </div>`;

            // ─── Filter Pills ───
            html += `<div class="tm-pos-filter">
                <button class="tm-pos-btn ${tmPosFilter === 'all' && tmPriceFilter === 'all' ? 'active' : ''}" onclick="tmFilterPos('all')">All</button>
                <button class="tm-pos-btn ${tmPosFilter === '1' ? 'active' : ''}" onclick="tmFilterPos('1')">GK</button>
                <button class="tm-pos-btn ${tmPosFilter === '2' ? 'active' : ''}" onclick="tmFilterPos('2')">DEF</button>
                <button class="tm-pos-btn ${tmPosFilter === '3' ? 'active' : ''}" onclick="tmFilterPos('3')">MID</button>
                <button class="tm-pos-btn ${tmPosFilter === '4' ? 'active' : ''}" onclick="tmFilterPos('4')">FWD</button>
                <span style="width:1px;background:var(--border-default);margin:2px 4px;"></span>
                <button class="tm-pos-btn ${tmPriceFilter === 'premium' ? 'active' : ''}" onclick="tmFilterPrice('premium')">Premium £10m+</button>
                <button class="tm-pos-btn ${tmPriceFilter === 'budget' ? 'active' : ''}" onclick="tmFilterPrice('budget')">Budget &lt;£5m</button>
            </div>`;

            // ─── Bento Grid: Rising + Falling Side-by-Side ───
            const rising = filterPlayers(playersWithPressure.filter(p => p.netTransfers > 0));
            tmSortList(rising, tmRisingSort);
            const risingDisplay = tmShowAllRising ? rising.slice(0, 50) : rising.slice(0, 5);

            const falling = filterPlayers(playersWithPressure.filter(p => p.netTransfers < 0));
            tmSortList(falling, tmFallingSort);
            const fallingDisplay = tmShowAllFalling ? falling.slice(0, 50) : falling.slice(0, 5);

            const risersFallersCols = `<th>Player</th><th>Price</th><th>Own%</th><th>Velocity</th><th>Net Transfers</th><th>Pressure</th>`;

            html += `<div class="tm-bento-grid">`;

            // Left: Rising Players
            html += `<div class="tm-bento-panel">
                <div class="tm-section-header rising-header">
                    <h2 style="color:var(--color-success);"><i data-lucide="trending-up" style="width:16px;height:16px;display:inline;"></i> Rising Players</h2>
                    <span class="tm-section-count green">${rising.length}</span>
                </div>
                <div class="tm-table-wrap">
                <table class="tm-table">
                    <thead><tr>
                        <th onclick="tmSort('rising','name')">Player</th>
                        <th onclick="tmSort('rising','price')">Price</th>
                        <th onclick="tmSort('rising','ownership')">Own%</th>
                        <th onclick="tmSort('rising','netTransfers')">Velocity</th>
                        <th onclick="tmSort('rising','netTransfers')">Net Transfers</th>
                        <th onclick="tmSort('rising','pressure')">Pressure</th>
                    </tr></thead>
                    <tbody>${risingDisplay.map(p => renderTmRow(p, true, squadIds)).join('')}</tbody>
                </table>
                </div>
                ${rising.length > 5 ? `<div style="text-align:center;margin-top:10px;">
                    <button class="tm-view-all-btn" onclick="tmToggleViewAll('rising')">${tmShowAllRising ? 'Show Top 5' : `View All ${rising.length} Risers \u2192`}</button>
                </div>` : ''}
            </div>`;

            // Right: Falling Players
            html += `<div class="tm-bento-panel">
                <div class="tm-section-header falling-header">
                    <h2 style="color:var(--color-error);"><i data-lucide="trending-down" style="width:16px;height:16px;display:inline;"></i> Falling Players</h2>
                    <span class="tm-section-count red">${falling.length}</span>
                </div>
                <div class="tm-table-wrap">
                <table class="tm-table">
                    <thead><tr>
                        <th onclick="tmSort('falling','name')">Player</th>
                        <th onclick="tmSort('falling','price')">Price</th>
                        <th onclick="tmSort('falling','ownership')">Own%</th>
                        <th onclick="tmSort('falling','netTransfers')">Velocity</th>
                        <th onclick="tmSort('falling','netTransfers')">Net Transfers</th>
                        <th onclick="tmSort('falling','pressure')">Pressure</th>
                    </tr></thead>
                    <tbody>${fallingDisplay.map(p => renderTmRow(p, true, squadIds)).join('')}</tbody>
                </table>
                </div>
                ${falling.length > 5 ? `<div style="text-align:center;margin-top:10px;">
                    <button class="tm-view-all-btn" onclick="tmToggleViewAll('falling')">${tmShowAllFalling ? 'Show Top 5' : `View All ${falling.length} Fallers \u2192`}</button>
                </div>` : ''}
            </div>`;

            html += `</div>`; // close .tm-bento-grid

            // ─── Full-Width: Your Squad Price Watch ───
            if (selectedPlayers.length > 0) {
                const squadPressure = playersWithPressure.filter(p => squadIds.has(p.id));
                const filtered = filterPlayers(squadPressure);
                tmSortList(filtered, tmSquadSort);

                html += `<div class="tm-section">
                    <div class="tm-section-header squad-header">
                        <h2><i data-lucide="shield" style="width:16px;height:16px;display:inline;"></i> Your Squad Price Watch</h2>
                        <span class="tm-section-count blue">${filtered.length}</span>
                    </div>
                    <div class="tm-table-wrap">
                    <table class="tm-table">
                        <thead><tr>
                            <th onclick="tmSort('squad','name')">Player</th>
                            <th onclick="tmSort('squad','price')">Price</th>
                            <th onclick="tmSort('squad','netTransfers')">Velocity</th>
                            <th onclick="tmSort('squad','netTransfers')">Net Transfers</th>
                            <th onclick="tmSort('squad','pressure')">Pressure</th>
                        </tr></thead>
                        <tbody>${filtered.map(p => renderTmRow(p, false, squadIds)).join('')}</tbody>
                    </table>
                    </div>
                </div>`;
            }

            container.innerHTML = html;
            if (typeof lucide !== 'undefined') lucide.createIcons();
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

