/* ============================================
   EasyFPL — My Team Analysis
   GW Draft: squad building, draft transfers, swaps and captaincy,
   localStorage persistence, plan slots, the stats hub, side-by-side plan
   comparison and the manager's notepad.

   Extracted from the inline <script> in fpl-my-team-analysis.html.
   These files are plain classic scripts loaded in order, not ES modules:
   every function stays a global, which the inline onclick= handlers
   throughout the markup depend on. Load order is preserved from the
   original file — team-analysis-core.js must come first, since the
   settings IIFE in lineup-wizard.js reads DEFAULT_SETTINGS from it.
   ============================================ */

        // ===== GW DRAFT =====
        let draftStates = [null, null, null];
        let activeDraftSlot = 0;
        let draftSlotCount = 1;
        let draftSwapSource = null;
        let draftReplacementTarget = null;
        let draftCompareMode = false;
        // 'stats' shows the historical per-90 columns; 'xp' replaces them with a
        // week-by-week projection, which is what a planner is actually for.
        let draftTableView = 'stats';

        function setDraftTableView(view) {
            draftTableView = view;
            renderSquadPlanner();
        }

        function getActiveDraft() { return draftStates[activeDraftSlot]; }

        function initDraft(slotIndex) {
            if (slotIndex === undefined) slotIndex = activeDraftSlot;
            const gwNumbers = [];
            // A gameweek with any match already under way cannot be planned — its
            // deadline has passed. Taking every gameweek with an unfinished fixture
            // put the current one at the head of the plan, where it projected almost
            // nothing because nine of its ten matches were already played.
            const started = new Set(
                allFixtures.filter(f => f.event !== null && (f.started || f.finished_provisional)).map(f => f.event)
            );
            const upcoming = allFixtures
                .filter(f => !f.finished_provisional && f.event !== null && !started.has(f.event))
                .map(f => f.event);
            const uniqueGWs = [...new Set(upcoming)].sort((a, b) => a - b);
            for (let i = 0; i < Math.min(6, uniqueGWs.length); i++) gwNumbers.push(uniqueGWs[i]);
            if (gwNumbers.length === 0) for (let i = currentGW + 1; i <= Math.min(currentGW + 6, 38); i++) gwNumbers.push(i);

            const bank = (picksData?.entry_history?.bank || 0) / 10;

            // Detect used chips from managerHistory (with GW for half-season tracking)
            const usedChipRecords = [];
            if (managerHistory && managerHistory.chips) {
                managerHistory.chips.forEach(c => {
                    if (c.name) usedChipRecords.push({ name: c.name.toLowerCase().replace(/\s+/g, ''), event: c.event || 0 });
                });
            }

            draftStates[slotIndex] = {
                gwNumbers: gwNumbers,
                selectedGW: gwNumbers[0] || null,
                originalSquad: selectedPlayers.map(p => ({ ...p })),
                transfers: {},    // {gw: [{outId, inId, outName, inName, outPrice, inPrice}]}
                chips: {},        // {gw: 'wildcard'|'benchboost'|'freehit'|'triplecaptain'|null}
                lineups: {},      // {gw: [{...playerObj, onBench, isCaptain, isVice}]}
                bank: bank,
                // Start the plan from the manager's real position rather than a
                // flat 1. Falls back to 1 if the history has not loaded yet, which
                // is what this was before.
                startingFT: (typeof deriveFreeTransfers === 'function' ? deriveFreeTransfers().count : 1),
                usedChips: usedChipRecords,
                teamId: localStorage.getItem('fpl_team_id') || '',
                savedAt: null
            };

            // Initialize lineups for each GW (carry-forward model)
            gwNumbers.forEach(gw => {
                draftStates[slotIndex].transfers[gw] = [];
                draftStates[slotIndex].chips[gw] = null;
                draftStates[slotIndex].lineups[gw] = selectedPlayers.map(p => ({ ...p }));
            });

            if (slotIndex === activeDraftSlot) {
                draftSwapSource = null;
                draftReplacementTarget = null;
            }
        }

        function getDraftSquad(gw, slotIndex) {
            const ds = slotIndex !== undefined ? draftStates[slotIndex] : getActiveDraft();
            return ds.lineups[gw] || selectedPlayers.map(p => ({ ...p }));
        }

        function rebuildDraftSquads(slotIndex) {
            const ds = slotIndex !== undefined ? draftStates[slotIndex] : getActiveDraft();
            // Rebuild all squads from original, applying transfers cumulatively
            const gws = ds.gwNumbers;
            let currentSquad = ds.originalSquad.map(p => ({ ...p }));

            // Snapshot current lineup customisations before rebuild
            // (empty on first load / loadDraftSlot — their manual restore still works)
            const savedMods = {};
            gws.forEach(gw => {
                const existing = ds.lineups[gw];
                if (existing && existing.length) {
                    savedMods[gw] = {};
                    existing.forEach(p => {
                        savedMods[gw][p.id] = {
                            onBench: p.onBench,
                            isCaptain: p.isCaptain,
                            isVice: p.isVice,
                            pickPosition: p.pickPosition
                        };
                    });
                }
            });

            // Track cumulative transfers (except free hit GWs)
            let carrySquad = currentSquad.map(p => ({ ...p }));

            gws.forEach(gw => {
                const chip = ds.chips[gw];
                // Build out→in map for this GW so transfer-in players inherit
                // the outgoing player's *customised* slot (not the original one)
                const gwTransfers = ds.transfers[gw] || [];
                const outToIn = {};
                gwTransfers.forEach(t => { outToIn[t.outId] = t.inId; });

                if (chip === 'freehit') {
                    // Free Hit: start from carrySquad but don't update it
                    let fhSquad = carrySquad.map(p => ({ ...p }));
                    // Apply this GW's transfers
                    gwTransfers.forEach(t => {
                        const idx = fhSquad.findIndex(p => p.id === t.outId);
                        if (idx >= 0) {
                            const replacement = allPlayersById[t.inId];
                            if (replacement) {
                                const oldOnBench = fhSquad[idx].onBench;
                                const oldPick = fhSquad[idx].pickPosition;
                                fhSquad[idx] = {
                                    ...replacement,
                                    onBench: oldOnBench,
                                    pickPosition: oldPick,
                                    isCaptain: false,
                                    isVice: false,
                                    sellPrice: replacement.price,
                                    multiplier: 1,
                                    isTransferIn: true,
                                    transferGW: gw
                                };
                            }
                        }
                    });
                    ds.lineups[gw] = fhSquad;
                    // carrySquad unchanged — next GW reverts
                } else {
                    // Normal/Wildcard: apply transfers to carry squad
                    gwTransfers.forEach(t => {
                        const idx = carrySquad.findIndex(p => p.id === t.outId);
                        if (idx >= 0) {
                            const replacement = allPlayersById[t.inId];
                            if (replacement) {
                                const oldOnBench = carrySquad[idx].onBench;
                                const oldPick = carrySquad[idx].pickPosition;
                                carrySquad[idx] = {
                                    ...replacement,
                                    onBench: oldOnBench,
                                    pickPosition: oldPick,
                                    isCaptain: false,
                                    isVice: false,
                                    sellPrice: replacement.price,
                                    multiplier: 1,
                                    isTransferIn: true,
                                    transferGW: gw
                                };
                            }
                        }
                    });
                    ds.lineups[gw] = carrySquad.map(p => ({ ...p }));
                }

                // Restore lineup customisations for surviving players
                const mods = savedMods[gw];
                if (mods) {
                    const lineup = ds.lineups[gw];
                    lineup.forEach(p => {
                        // Direct match — player survived from previous lineup
                        let mod = mods[p.id];
                        // Transfer-in — inherit the outgoing player's customised slot
                        if (!mod && p.isTransferIn) {
                            const outId = Object.keys(outToIn).find(k => Number(outToIn[k]) === p.id);
                            if (outId) mod = mods[Number(outId)];
                        }
                        if (mod) {
                            p.onBench = mod.onBench;
                            p.pickPosition = mod.pickPosition;
                            // Only restore captain/vice for surviving players, not transfer-ins
                            if (mods[p.id]) {
                                p.isCaptain = mod.isCaptain;
                                p.isVice = mod.isVice;
                            }
                        }
                    });
                    // Ensure exactly 1 captain & 1 vice after restore
                    const hasCaptain = lineup.some(p => p.isCaptain);
                    const hasVice = lineup.some(p => p.isVice);
                    if (!hasCaptain) {
                        const starters = lineup.filter(p => !p.onBench).sort((a, b) => (b.price || 0) - (a.price || 0));
                        if (starters.length) starters[0].isCaptain = true;
                    }
                    if (!hasVice) {
                        const starters = lineup.filter(p => !p.onBench && !p.isCaptain).sort((a, b) => (b.price || 0) - (a.price || 0));
                        if (starters.length) starters[0].isVice = true;
                    }
                }
            });
        }

        function getDraftBudget(gw) {
            const ds = getActiveDraft();
            let budget = ds.bank;
            const gws = ds.gwNumbers;
            // Carry squad value changes up to this GW
            let carrySquad = ds.originalSquad.map(p => ({ ...p }));

            for (const g of gws) {
                if (g > gw) break;
                const chip = ds.chips[g];
                const gwTransfers = ds.transfers[g] || [];

                gwTransfers.forEach(t => {
                    // Find sell price of outgoing player in current carry squad
                    const outPlayer = carrySquad.find(p => p.id === t.outId);
                    const sellPrice = outPlayer ? (outPlayer.sellPrice || outPlayer.price) : t.outPrice;
                    budget += sellPrice;
                    budget -= t.inPrice;
                });

                if (chip !== 'freehit') {
                    // Update carry squad
                    gwTransfers.forEach(t => {
                        const idx = carrySquad.findIndex(p => p.id === t.outId);
                        if (idx >= 0) {
                            const replacement = allPlayersById[t.inId];
                            if (replacement) {
                                carrySquad[idx] = { ...replacement, sellPrice: replacement.price };
                            }
                        }
                    });
                }
            }
            return Math.round(budget * 10) / 10;
        }

        function getDraftFreeTransfers(gw) {
            const ds = getActiveDraft();
            if (!ds) return 1;
            const gws = ds.gwNumbers;
            let ft = ds.startingFT;
            // Asking for a gameweek at or before the plan's first means no rollover
            // has happened yet, so the answer is simply the starting figure. Without
            // this the loop never meets its early return, adds one per planned
            // gameweek on the way past, and returns the 5-transfer cap for any
            // gameweek outside the plan — including the current one, which is
            // excluded from gwNumbers by design once its matches are under way.
            if (!gws.length || gw <= gws[0]) return Math.max(0, ft);
            for (const g of gws) {
                if (g === gw) return Math.max(0, ft);
                const chip = ds.chips[g];
                const numTransfers = (ds.transfers[g] || []).length;
                if (chip === 'wildcard' || chip === 'freehit') {
                    // WC/FH: transfers don't cost FTs
                    if (g !== gws[0]) ft = Math.min(ft + 1, 5);
                } else {
                    ft -= numTransfers;
                    if (ft < 0) ft = 0;
                    // Next GW: roll over unused + 1, max 5
                    ft = Math.min(ft + 1, 5);
                }
            }
            return Math.max(0, ft);
        }

        function getDraftHitCost(gw) {
            const ds = getActiveDraft();
            if (!ds) return 0;
            const chip = ds.chips[gw];
            if (chip === 'wildcard' || chip === 'freehit') return 0;
            const numTransfers = (ds.transfers[gw] || []).length;
            const ft = getDraftFreeTransfers(gw);
            const excess = Math.max(0, numTransfers - ft);
            return excess * 4;
        }

        function isDraftChipAvailable(chipName) {
            const ds = getActiveDraft();
            // 2025/26 season: each chip can be used once per half (GW1-19 = first half, GW20-38 = second half)
            const HALF_CUTOFF = 20;
            const draftGW = ds.selectedGW;
            const draftHalf = draftGW >= HALF_CUTOFF ? 2 : 1;

            const mapped = {
                'wildcard': ['wildcard', '2nd_wildcard'],
                'benchboost': ['bboost', 'benchboost'],
                'freehit': ['freehit', 'free_hit'],
                'triplecaptain': ['3xc', 'triplecaptain', 'triple_captain']
            };
            const aliases = mapped[chipName] || [chipName];

            // Check if chip was already used in real FPL in the SAME half
            const usedInSameHalf = ds.usedChips.some(c =>
                aliases.includes(c.name) && (c.event >= HALF_CUTOFF ? 2 : 1) === draftHalf
            );
            if (usedInSameHalf) return false;

            // Check if already assigned to a GW in the same half in draft
            const assignedInSameHalf = Object.entries(ds.chips)
                .filter(([g, c]) => c === chipName && (parseInt(g) >= HALF_CUTOFF ? 2 : 1) === draftHalf)
                .length;

            return assignedInSameHalf === 0;
        }

        function activateDraftChip(chip) {
            const ds = getActiveDraft();
            const gw = ds.selectedGW;
            const currentChip = ds.chips[gw];

            if (currentChip === chip) {
                // Deactivate
                ds.chips[gw] = null;
            } else {
                // Remove from other GW if already assigned
                Object.keys(ds.chips).forEach(g => {
                    if (ds.chips[g] === chip) ds.chips[g] = null;
                });
                ds.chips[gw] = chip;
            }

            // If free hit changed, rebuild squads
            if (chip === 'freehit' || chip === 'wildcard') {
                rebuildDraftSquads();
            }
            saveDraft();
            rerenderDraftView();
        }

        // ===== DRAFT TRANSFER SYSTEM =====
        function openDraftTransferPanel(playerId) {
            const ds = getActiveDraft();
            const gw = ds.selectedGW;
            const squad = getDraftSquad(gw);
            const player = squad.find(p => p.id === playerId) || allPlayersById[playerId];
            if (!player) return;

            draftReplacementTarget = player;
            const posConfig = POSITION_CONFIG[player.position];
            const remainingBudget = getDraftBudget(gw);
            const maxAffordable = remainingBudget + (player.sellPrice || player.price);

            document.getElementById('draftTransferTitle').textContent = player.name;
            document.getElementById('draftTransferMeta').innerHTML = `<span class="position-badge ${posConfig.class}">${posConfig.short}</span> ${escHTML(player.team)} · £${player.price.toFixed(1)}m`;

            let html = '';

            // Current player stats
            const sSt = getPlayerSeasonPer90(player);
            const rSt = getPlayerRecentStats(player.id, 6);
            const posStats = getPositionStats(player, sSt, rSt);

            html += `<div class="detail-section">
                <div class="detail-section-title"><i data-lucide="bar-chart-3" style="width:14px;height:14px;display:inline;vertical-align:middle;"></i> Current Player</div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:8px;">
                    ${posStats.map(s => `<div style="text-align:center;background:var(--surface-0);padding:6px;border-radius:var(--radius-sm);">
                        <div style="font-size:0.6rem;color:var(--text-muted);">${s.label}</div>
                        <div style="font-family:var(--font-mono);font-weight:700;font-size:0.85rem;">${s.season}</div>
                        <div style="font-size:0.6rem;color:var(--text-muted);">L6: ${s.recent}</div>
                    </div>`).join('')}
                </div>
                <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:4px;">Budget: £${maxAffordable.toFixed(1)}m available</div>
                <div class="transfer-section-title">Upcoming Fixtures</div>
                <div class="transfer-fdr-strip">
                    ${(teamFixtures6[player.teamId] || []).slice(0, 6).map(f => `<div class="transfer-fdr-badge fdr-${f.difficulty || 3}">${escHTML(f.opponent)}${f.isHome ? '(H)' : '(A)'}</div>`).join('')}
                </div>
            </div>`;

            // Search
            html += `<div class="detail-section">
                <div class="detail-section-title"><i data-lucide="search" style="width:14px;height:14px;display:inline;vertical-align:middle;"></i> Find Replacement</div>
                <div class="planner-search-wrap">
                    <input type="text" class="planner-search-input" id="draftSearchInput" placeholder="Search ${posConfig.name}s by name..." oninput="filterDraftSearch()" onfocus="filterDraftSearch()">
                    <div class="planner-search-dropdown" id="draftSearchDropdown"></div>
                </div>
            </div>`;

            html += `<div id="draftTransferComparison"></div>`;

            // Quick suggestions — AI-ranked, one click swaps the player in immediately
            // (unlike the manual Search results above, which go through the compare-then-
            // confirm flow via selectDraftReplacement, since these are already AI-vetted).
            const squad2 = getDraftSquad(gw);
            const suggestions = findDraftReplacements(player, squad2, 8);
            if (suggestions.length > 0) {
                html += `<div class="detail-section">
                    <div class="detail-section-title"><i data-lucide="zap" style="width:14px;height:14px;display:inline;vertical-align:middle;"></i> Top Suggestions</div>
                    ${suggestions.map((r, i) => {
                        const nextF = (r.fixtures || [])[0];
                        const fdrHtml = nextF ? `<span class="fdr-dot fdr-${nextF.difficulty}"></span> ${escHTML(nextF.opponent)} (${nextF.isHome ? 'H' : 'A'})` : 'No fixture';
                        return `<div class="tw-market-row" onclick="confirmDraftTransfer(${player.id}, ${r.id})" title="Click to swap in ${escHTML(r.name)}">
                            <div class="tw-market-rank">${i + 1}</div>
                            <span class="tw-market-name">${escHTML(r.name)}</span>
                            <span style="font-size:10px;color:var(--text-muted);flex-shrink:0;">${escHTML(r.team)}</span>
                            <span class="tw-market-price">£${r.price.toFixed(1)}m ${priceChangeBadge(r)}</span>
                            <span class="tw-market-score" title="AI Projected Score">${r._score.toFixed(0)}</span>
                            <div class="tw-market-row-detail">${fdrHtml}</div>
                        </div>`;
                    }).join('')}
                </div>`;
            }

            document.getElementById('draftTransferBody').innerHTML = html;
            if (typeof lucide !== 'undefined') lucide.createIcons();
            document.getElementById('draftTransferOverlay').classList.add('show');
        }

        function closeDraftTransferPanel(event) {
            if (event && event.target !== event.currentTarget) return;
            document.getElementById('draftTransferOverlay').classList.remove('show');
            draftReplacementTarget = null;
        }

        function findDraftReplacements(player, currentSquad, count = 8) {
            const ds = getActiveDraft();
            const gw = ds.selectedGW;
            const maxPrice = getDraftBudget(gw) + (player.sellPrice || player.price);
            const squadIds = new Set(currentSquad.map(p => p.id));
            const candidates = allPlayers.filter(p =>
                p.position === player.position && p.price <= maxPrice && p.id !== player.id &&
                (p.status === 'a' || p.status === 'd') && p.minutes >= minMinutesForCandidate() &&
                !squadIds.has(p.id)
            );

            candidates.forEach(c => {
                const fdr = c.fixtures && c.fixtures.length >= 3
                    ? c.fixtures.slice(0, 3).reduce((s, f) => s + f.difficulty, 0) / 3 : 3;
                const cTA = teamAnalysis[c.teamId];
                let teamBonus = 0;
                if (cTA) {
                    teamBonus += (cTA.formRating - 50) / 25;
                    if (c.position >= 3) teamBonus += (cTA.attackPower - 50) / 25;
                    if (c.position <= 2) teamBonus += (cTA.defensePower - 50) / 25;
                    teamBonus += (cTA.fixtureScore - 50) / 25;
                }
                c._score = (c.form * 3) + (c.ppg * 2.5) + (c.epNext * 2) + ((5 - fdr) * 2.5) + teamBonus + (c.ownership > 15 ? 1 : 0);
            });
            candidates.sort((a, b) => b._score - a._score);
            return candidates.slice(0, count);
        }

        function filterDraftSearch() {
            const input = document.getElementById('draftSearchInput');
            const dropdown = document.getElementById('draftSearchDropdown');
            const query = input.value.trim().toLowerCase();
            if (query.length < 2) { dropdown.classList.remove('show'); return; }

            const pos = draftReplacementTarget?.position;
            const ds = getActiveDraft();
            const gw = ds.selectedGW;
            const maxPrice = getDraftBudget(gw) + (draftReplacementTarget?.sellPrice || draftReplacementTarget?.price || 0);
            const squadIds = new Set(getDraftSquad(gw).map(p => p.id));

            const results = allPlayers
                .filter(p => p.position === pos && p.name.toLowerCase().includes(query) && p.id !== draftReplacementTarget?.id && p.minutes > 0 && p.price <= maxPrice && !squadIds.has(p.id))
                .sort((a, b) => b.form - a.form)
                .slice(0, 12);

            if (results.length === 0) {
                dropdown.innerHTML = '<div class="planner-search-item" style="color:var(--text-muted);">No affordable players found</div>';
            } else {
                dropdown.innerHTML = results.map(p => `<div class="planner-search-item" onclick="selectDraftReplacement(${p.id})">
                    <div><span class="planner-search-item-name">${escHTML(p.name)}</span></div>
                    <span class="planner-search-item-meta">${escHTML(p.team)} · £${p.price.toFixed(1)}m · ${p.form} form</span>
                </div>`).join('');
            }
            dropdown.classList.add('show');
        }

        function selectDraftReplacement(replacementId) {
            const dropdown = document.getElementById('draftSearchDropdown');
            if (dropdown) dropdown.classList.remove('show');

            const current = draftReplacementTarget;
            const replacement = allPlayersById[replacementId];
            if (!current || !replacement) return;

            const cSeason = getPlayerSeasonPer90(current);
            const cRecent = getPlayerRecentStats(current.id, 6);
            const rSeason = getPlayerSeasonPer90(replacement);
            const rRecent = getPlayerRecentStats(replacement.id, 6);
            const cPosStats = getPositionStats(current, cSeason, cRecent);
            const rPosStats = getPositionStats(replacement, rSeason, rRecent);
            const cFix = teamFixtures6[current.teamId] || [];
            const rFix = teamFixtures6[replacement.teamId] || [];

            let html = `<div class="detail-section">
                <div class="detail-section-title">⚔️ Side-by-Side Comparison</div>
                <div class="transfer-vs">
                    <div class="transfer-vs-col">
                        <div class="transfer-vs-label">Current</div>
                        <div class="transfer-vs-name" style="color:var(--color-error);">${escHTML(current.name)}</div>
                        <div class="transfer-vs-meta">${escHTML(current.team)} · £${(current.sellPrice || current.price).toFixed(1)}m</div>
                        <div class="transfer-fdr-strip">${cFix.slice(0, 6).map(f => `<div class="transfer-fdr-badge fdr-${f.difficulty || 3}">${escHTML(f.opponent)}</div>`).join('')}</div>
                    </div>
                    <div class="transfer-vs-col">
                        <div class="transfer-vs-label">Replacement</div>
                        <div class="transfer-vs-name" style="color:var(--color-success);">${escHTML(replacement.name)}</div>
                        <div class="transfer-vs-meta">${escHTML(replacement.team)} · £${replacement.price.toFixed(1)}m</div>
                        <div class="transfer-fdr-strip">${rFix.slice(0, 6).map(f => `<div class="transfer-fdr-badge fdr-${f.difficulty || 3}">${escHTML(f.opponent)}</div>`).join('')}</div>
                    </div>
                </div>

                <div class="transfer-section-title">Season Stats</div>
                <table class="transfer-stat-table">
                    <tr><td class="stat-label">Points</td><td class="stat-val ${current.points > replacement.points ? 'better' : current.points < replacement.points ? 'worse' : ''}">${current.points}</td><td class="stat-val ${replacement.points > current.points ? 'better' : replacement.points < current.points ? 'worse' : ''}">${replacement.points}</td></tr>
                    <tr><td class="stat-label">Form</td><td class="stat-val ${current.form > replacement.form ? 'better' : current.form < replacement.form ? 'worse' : ''}">${current.form.toFixed(1)}</td><td class="stat-val ${replacement.form > current.form ? 'better' : replacement.form < current.form ? 'worse' : ''}">${replacement.form.toFixed(1)}</td></tr>
                    ${cPosStats.map((s, i) => {
                        const rS = rPosStats[i];
                        const cBetter = s.higherBetter ? s.sVal > rS.sVal : s.sVal < rS.sVal;
                        const rBetter = s.higherBetter ? rS.sVal > s.sVal : rS.sVal < s.sVal;
                        return `<tr><td class="stat-label">${s.label}</td><td class="stat-val ${cBetter ? 'better' : rBetter ? 'worse' : ''}">${s.season}</td><td class="stat-val ${rBetter ? 'better' : cBetter ? 'worse' : ''}">${rS.season}</td></tr>`;
                    }).join('')}
                </table>

                <div style="margin-top:12px;">
                    <button class="planner-reset-btn" style="width:100%;padding:10px;font-size:0.85rem;font-weight:700;background:var(--color-success);color:#fff;border-color:var(--color-success);border-radius:var(--radius-md);" onclick="confirmDraftTransfer(${current.id}, ${replacement.id})">
                        ✓ Confirm Transfer: ${escHTML(current.name)} → ${escHTML(replacement.name)}
                    </button>
                </div>
            </div>`;

            document.getElementById('draftTransferComparison').innerHTML = html;
        }

        function confirmDraftTransfer(outId, inId) {
            const ds = getActiveDraft();
            const gw = ds.selectedGW;
            const squad = getDraftSquad(gw);
            const outPlayer = squad.find(p => p.id === outId);
            const inPlayer = allPlayersById[inId];
            if (!outPlayer || !inPlayer) return;

            ds.transfers[gw].push({
                outId: outId,
                inId: inId,
                outName: outPlayer.name,
                inName: inPlayer.name,
                outPrice: outPlayer.sellPrice || outPlayer.price,
                inPrice: inPlayer.price
            });

            rebuildDraftSquads();
            closeDraftTransferPanel();
            saveDraft();
            rerenderDraftView();
        }

        function revertDraftTransfer(gw, transferIndex) {
            getActiveDraft().transfers[gw].splice(transferIndex, 1);
            rebuildDraftSquads();
            saveDraft();
            rerenderDraftView();
        }

        // ===== DRAFT SWAP & CAPTAINCY =====
        function draftCanSwap(sourceId, targetId) {
            const gw = getActiveDraft().selectedGW;
            const lineup = getDraftSquad(gw);
            const source = lineup.find(p => p.id === sourceId);
            const target = lineup.find(p => p.id === targetId);
            if (!source || !target) return false;
            // Both on bench: allow reordering bench priority
            if (source.onBench && target.onBench) return true;
            // Both starters: not supported
            if (!source.onBench && !target.onBench) return false;
            // Starter ↔ bench: validate formation
            const simLineup = lineup.map(p => {
                if (p.id === sourceId) return { ...p, onBench: target.onBench };
                if (p.id === targetId) return { ...p, onBench: source.onBench };
                return p;
            });
            return isValidFormation(simLineup);
        }

        function performDraftSwap(sourceId, targetId) {
            const gw = getActiveDraft().selectedGW;
            const lineup = getDraftSquad(gw);
            const source = lineup.find(p => p.id === sourceId);
            const target = lineup.find(p => p.id === targetId);
            if (!source || !target) return;
            if (source.onBench && target.onBench) {
                // Bench-to-bench: swap pickPosition (auto-sub priority)
                const srcPos = source.pickPosition;
                source.pickPosition = target.pickPosition;
                target.pickPosition = srcPos;
            } else {
                // Starter ↔ bench: swap onBench flag
                const srcBench = source.onBench;
                source.onBench = target.onBench;
                target.onBench = srcBench;
            }
            draftSwapSource = null;
            saveDraft();
            rerenderDraftView();
        }

        function handleDraftPitchClick(playerId) {
            if (draftSwapSource === null) {
                draftSwapSource = playerId;
                rerenderDraftView();
            } else if (draftSwapSource === playerId) {
                draftSwapSource = null;
                rerenderDraftView();
            } else {
                if (draftCanSwap(draftSwapSource, playerId)) {
                    performDraftSwap(draftSwapSource, playerId);
                } else {
                    draftSwapSource = playerId;
                    rerenderDraftView();
                }
            }
        }

        function setDraftCaptain(playerId) {
            const gw = getActiveDraft().selectedGW;
            const lineup = getDraftSquad(gw);
            lineup.forEach(p => {
                if (p.id === playerId) {
                    if (p.isCaptain) {
                        p.isCaptain = false;
                    } else {
                        p.isCaptain = true;
                        p.isVice = false;
                    }
                } else {
                    if (p.isCaptain && lineup.find(x => x.id === playerId)) {
                        p.isCaptain = false;
                    }
                }
            });
            saveDraft();
            rerenderDraftView();
        }

        function setDraftViceCaptain(playerId) {
            const gw = getActiveDraft().selectedGW;
            const lineup = getDraftSquad(gw);
            lineup.forEach(p => {
                if (p.id === playerId) {
                    if (p.isVice) {
                        p.isVice = false;
                    } else {
                        p.isVice = true;
                        p.isCaptain = false;
                    }
                } else {
                    if (p.isVice && lineup.find(x => x.id === playerId)) {
                        p.isVice = false;
                    }
                }
            });
            saveDraft();
            rerenderDraftView();
        }

        // ===== DRAFT localStorage PERSISTENCE =====
        function saveDraft(slotIndex) {
            if (slotIndex === undefined) slotIndex = activeDraftSlot;
            const ds = draftStates[slotIndex];
            if (!ds || !ds.teamId) return;
            const payload = {
                gwNumbers: ds.gwNumbers,
                selectedGW: ds.selectedGW,
                transfers: ds.transfers,
                chips: ds.chips,
                lineups: {},
                bank: ds.bank,
                startingFT: ds.startingFT,
                usedChips: ds.usedChips,
                teamId: ds.teamId,
                savedAt: new Date().toISOString()
            };
            // Store lineups as compact: [{id, onBench, isCaptain, isVice, pickPosition}]
            ds.gwNumbers.forEach(gw => {
                const squad = getDraftSquad(gw, slotIndex);
                payload.lineups[gw] = squad.map(p => ({
                    id: p.id, onBench: p.onBench, isCaptain: p.isCaptain, isVice: p.isVice, pickPosition: p.pickPosition
                }));
            });
            try {
                localStorage.setItem(`fpl_draft_${ds.teamId}_plan${slotIndex}`, JSON.stringify(payload));
                ds.savedAt = payload.savedAt;
                // Save meta
                saveDraftMeta();
            } catch (e) { /* localStorage full */ }
        }

        function saveDraftMeta() {
            const teamId = localStorage.getItem('fpl_team_id') || '';
            if (!teamId) return;
            try {
                localStorage.setItem(`fpl_draft_meta_${teamId}`, JSON.stringify({
                    slotCount: draftSlotCount,
                    activeSlot: activeDraftSlot
                }));
            } catch(e) {}
        }

        function loadDraft() {
            const teamId = localStorage.getItem('fpl_team_id') || '';
            if (!teamId) return false;

            // Load meta
            let meta = null;
            try {
                const rawMeta = localStorage.getItem(`fpl_draft_meta_${teamId}`);
                if (rawMeta) meta = JSON.parse(rawMeta);
            } catch(e) {}

            // Legacy migration: check for old single-draft key
            const legacyRaw = localStorage.getItem(`fpl_draft_${teamId}`);
            if (legacyRaw && !meta) {
                // Migrate old format to Plan 0
                const migrated = loadDraftSlot(0, legacyRaw);
                if (migrated) {
                    try { localStorage.removeItem(`fpl_draft_${teamId}`); } catch(e) {}
                    draftSlotCount = 1;
                    activeDraftSlot = 0;
                    saveDraft(0);
                    saveDraftMeta();
                    return true;
                }
            }

            if (!meta) return false;

            draftSlotCount = Math.max(1, Math.min(3, meta.slotCount || 1));
            activeDraftSlot = Math.max(0, Math.min(draftSlotCount - 1, meta.activeSlot || 0));

            let anyLoaded = false;
            for (let i = 0; i < draftSlotCount; i++) {
                // Initialize this slot if not already done
                if (!draftStates[i]) initDraft(i);
                try {
                    const raw = localStorage.getItem(`fpl_draft_${teamId}_plan${i}`);
                    if (raw && loadDraftSlot(i, raw)) anyLoaded = true;
                } catch(e) {}
            }
            return anyLoaded;
        }

        function loadDraftSlot(slotIndex, rawJson) {
            try {
                const saved = JSON.parse(rawJson);
                const teamId = localStorage.getItem('fpl_team_id') || '';
                if (!saved || saved.teamId !== teamId) return false;

                // Validate saved GWs still make sense
                const currentGWNums = [];
                const upcoming = allFixtures.filter(f => !f.finished_provisional && f.event !== null).map(f => f.event);
                const uniqueGWs = [...new Set(upcoming)].sort((a, b) => a - b);
                for (let i = 0; i < Math.min(6, uniqueGWs.length); i++) currentGWNums.push(uniqueGWs[i]);

                // If GW numbers don't match, saved data is stale
                if (JSON.stringify(currentGWNums) !== JSON.stringify(saved.gwNumbers)) return false;

                const ds = draftStates[slotIndex];
                if (!ds) return false;

                // Restore state
                ds.transfers = saved.transfers || {};
                ds.chips = saved.chips || {};
                ds.startingFT = saved.startingFT || 1;
                ds.savedAt = saved.savedAt;

                // Rebuild squads from transfers
                rebuildDraftSquads(slotIndex);

                // Restore lineup modifications (swap/captain) from saved compact lineups
                ds.gwNumbers.forEach(gw => {
                    const savedLineup = saved.lineups?.[gw];
                    if (!savedLineup) return;
                    const currentLineup = getDraftSquad(gw, slotIndex);
                    savedLineup.forEach(sp => {
                        const player = currentLineup.find(p => p.id === sp.id);
                        if (player) {
                            player.onBench = sp.onBench;
                            player.isCaptain = sp.isCaptain;
                            player.isVice = sp.isVice;
                            if (sp.pickPosition !== undefined) player.pickPosition = sp.pickPosition;
                        }
                    });
                });

                if (saved.selectedGW && ds.gwNumbers.includes(saved.selectedGW)) {
                    ds.selectedGW = saved.selectedGW;
                }

                return true;
            } catch (e) {
                return false;
            }
        }

        function resetDraft() {
            const ds = getActiveDraft();
            if (!ds) return;
            const teamId = ds.teamId;
            try { localStorage.removeItem(`fpl_draft_${teamId}_plan${activeDraftSlot}`); } catch(e) {}
            initDraft(activeDraftSlot);
            draftTabRendered = false;
            renderSquadPlanner();
        }

        // ===== PLAN SLOT MANAGEMENT =====
        function switchDraftSlot(slot) {
            if (slot === activeDraftSlot || slot < 0 || slot >= draftSlotCount) return;
            saveDraft(activeDraftSlot);
            activeDraftSlot = slot;
            draftSwapSource = null;
            draftReplacementTarget = null;
            draftCompareMode = false;
            saveDraftMeta();
            rerenderDraftView();
        }

        function addDraftSlot() {
            if (draftSlotCount >= 3) return;
            const newSlot = draftSlotCount;
            draftSlotCount++;
            initDraft(newSlot);
            saveDraft(activeDraftSlot);
            activeDraftSlot = newSlot;
            draftSwapSource = null;
            draftCompareMode = false;
            saveDraft(newSlot);
            saveDraftMeta();
            rerenderDraftView();
        }

        function duplicateDraftSlot(sourceSlot) {
            if (draftSlotCount >= 3) return;
            const newSlot = draftSlotCount;
            draftSlotCount++;
            initDraft(newSlot);
            // Deep clone the source
            const src = draftStates[sourceSlot];
            const dst = draftStates[newSlot];
            dst.transfers = JSON.parse(JSON.stringify(src.transfers));
            dst.chips = JSON.parse(JSON.stringify(src.chips));
            dst.startingFT = src.startingFT;
            dst.selectedGW = src.selectedGW;
            rebuildDraftSquads(newSlot);
            // Restore lineup mods from source
            dst.gwNumbers.forEach(gw => {
                const srcLineup = getDraftSquad(gw, sourceSlot);
                const dstLineup = getDraftSquad(gw, newSlot);
                srcLineup.forEach(sp => {
                    const p = dstLineup.find(x => x.id === sp.id);
                    if (p) {
                        p.onBench = sp.onBench;
                        p.isCaptain = sp.isCaptain;
                        p.isVice = sp.isVice;
                        p.pickPosition = sp.pickPosition;
                    }
                });
            });
            saveDraft(activeDraftSlot);
            activeDraftSlot = newSlot;
            draftSwapSource = null;
            draftCompareMode = false;
            saveDraft(newSlot);
            saveDraftMeta();
            rerenderDraftView();
        }

        function removeDraftSlot(slot) {
            if (draftSlotCount <= 1) return;
            if (!confirm(`Delete Plan ${slot + 1}? This cannot be undone.`)) return;
            const teamId = localStorage.getItem('fpl_team_id') || '';
            // Remove localStorage for this slot
            try { localStorage.removeItem(`fpl_draft_${teamId}_plan${slot}`); } catch(e) {}
            // Remove notepad keys for this slot
            const ds = draftStates[slot];
            if (ds) {
                ds.gwNumbers.forEach(gw => {
                    try { localStorage.removeItem(`fpl_notes_${teamId}_plan${slot}_gw${gw}`); } catch(e) {}
                });
            }
            // Shift higher slots down
            for (let i = slot; i < draftSlotCount - 1; i++) {
                draftStates[i] = draftStates[i + 1];
                // Re-save shifted slots with new key
                try { localStorage.removeItem(`fpl_draft_${teamId}_plan${i + 1}`); } catch(e) {}
                if (draftStates[i]) saveDraft(i);
            }
            draftStates[draftSlotCount - 1] = null;
            draftSlotCount--;
            if (activeDraftSlot >= draftSlotCount) activeDraftSlot = draftSlotCount - 1;
            draftSwapSource = null;
            draftCompareMode = false;
            saveDraftMeta();
            draftTabRendered = false;
            renderSquadPlanner();
        }

        function toggleDraftCompare() {
            draftCompareMode = !draftCompareMode;
            rerenderDraftView();
        }

        // ===== DRAFT RENDERING =====
        function renderSquadPlanner() {
            draftTabRendered = true;
            const container = document.getElementById('draftDisplay');
            if (!selectedPlayers || selectedPlayers.length === 0) {
                container.innerHTML = '<div class="chip-empty-msg">Load your team to use GW Draft.</div>';
                return;
            }

            // Initialize all active slots
            for (let i = 0; i < Math.max(draftSlotCount, 1); i++) {
                if (!draftStates[i]) initDraft(i);
            }
            const loaded = loadDraft();

            const ds = getActiveDraft();
            let html = '';

            // Plan selector bar
            html += `<div id="draftPlanBar">${renderDraftPlanBar()}</div>`;

            // Compare mode
            html += `<div id="draftCompareArea">${draftCompareMode ? renderDraftComparison() : ''}</div>`;

            // Toolbar
            html += `<div class="draft-toolbar" id="draftToolbar" ${draftCompareMode ? 'style="display:none;"' : ''}>${renderDraftToolbar()}</div>`;

            // Chip selector row
            html += `<div id="draftChipRow" style="margin-bottom:12px;${draftCompareMode ? 'display:none;' : ''}">${renderDraftChipRow()}</div>`;

            // Pitch + retractable strategy sidebar
            const sidebarOpen = localStorage.getItem('fpl_notepad_open') === 'true';
            html += `<div class="planner-layout-wrapper${sidebarOpen ? '' : ' sidebar-collapsed'}" ${draftCompareMode ? 'style="display:none;"' : ''}>`;
            html += `<div class="planner-pitch-wrap" id="draftPitchArea">${renderDraftPitchHTML()}</div>`;
            html += renderDraftSidebar();
            html += `</div>`;

            // ===== STATS HUB — Tabbed Interface =====
            html += `<div class="gw-stats-hub" ${draftCompareMode ? 'style="display:none;"' : ''}>`;
            html += `<div class="hub-tab-nav">`;
            html += `<button class="hub-tab active" data-target="player-tab" onclick="switchHubTab(this)">👤 Player Insights</button>`;
            html += `<button class="hub-tab" data-target="team-tab" onclick="switchHubTab(this)">🛡️ Team Insights</button>`;
            html += `</div>`;

            // Player Insights tab (active by default)
            html += `<div class="hub-panel active" id="player-tab">`;
            const gwNumbers = ds.gwNumbers;

            html += `<div class="dp-table-toolbar">
                <div class="dp-view-toggle" role="group" aria-label="Table view">
                    <button class="dp-view-btn ${draftTableView === 'stats' ? 'active' : ''}" onclick="setDraftTableView('stats')"
                        data-tooltip="What each player has actually done — per-90 rates for the season and the last six gameweeks.">📊 Historical stats</button>
                    <button class="dp-view-btn ${draftTableView === 'xp' ? 'active' : ''}" onclick="setDraftTableView('xp')"
                        data-tooltip="What each player projects for every gameweek in the plan — the quickest way to spot a benching headache.">🎯 Projected xP</button>
                </div>
                <span class="dp-table-hint">${draftTableView === 'stats'
                    ? 'Stat names sit in each position header — keepers and midfielders are judged on different things.'
                    : 'Projected points per gameweek. A dash means that club has no fixture.'}</span>
            </div>`;

            html += `<div class="planner-table-wrap"><table class="planner-table">`;
            html += `<thead id="draftTableHead">${renderDraftTableHead()}</thead>`;
            html += `<tbody id="draftTableBody">${renderDraftTableBody()}</tbody></table></div>`;
            html += `<div id="draftTransferSummary">${renderDraftTransferSummary()}</div>`;
            html += `</div>`;

            // Team Insights tab
            html += `<div class="hub-panel" id="team-tab">`;
            const draftSquad = getDraftSquad(ds.selectedGW);
            const uniqueTeamIds = [...new Set(draftSquad.map(p => p.teamId))].filter(tid => teamFixtures6[tid] && teamFixtures6[tid].length > 0);
            if (uniqueTeamIds.length > 0) {
                html += `<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(320px, 1fr));gap:10px;" id="draftTeamContext">`;
                uniqueTeamIds.forEach(tid => { html += renderTeamContextCard(tid, true); });
                html += `</div>`;
            } else {
                html += `<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:0.85rem;">No fixture data available for your squad's teams.</div>`;
            }
            html += `</div>`;
            html += `</div>`;

            // Save indicator
            if (ds.savedAt) {
                html += `<div class="draft-save-indicator" id="draftSaveIndicator">Plan ${activeDraftSlot + 1} saved: ${new Date(ds.savedAt).toLocaleTimeString()}</div>`;
            }

            container.innerHTML = html;
            if (typeof lucide !== 'undefined') lucide.createIcons();
            if (draftSidebarTab === 'notes') initNotepad();
        }

        function renderDraftPlanBar() {
            let html = `<div class="draft-plan-bar">`;
            html += `<div class="draft-plan-tabs">`;
            for (let i = 0; i < draftSlotCount; i++) {
                const active = i === activeDraftSlot ? 'active' : '';
                const ds = draftStates[i];
                let totalTransfers = 0;
                if (ds) {
                    Object.values(ds.transfers).forEach(arr => { totalTransfers += (arr || []).length; });
                }
                const badge = totalTransfers > 0 ? `<span class="plan-tab-badge">${totalTransfers}T</span>` : '';
                html += `<button class="draft-plan-tab ${active}" onclick="switchDraftSlot(${i})">`;
                html += `Plan ${i + 1}${badge}`;
                if (draftSlotCount > 1) {
                    html += ` <button class="draft-plan-del" onclick="event.stopPropagation();removeDraftSlot(${i})" title="Delete Plan ${i + 1}" aria-label="Delete Plan ${i + 1}">✕</button>`;
                }
                html += `</button>`;
            }
            if (draftSlotCount < 3) {
                html += `<button class="draft-plan-add" onclick="addDraftSlot()" title="Add new plan">+ New Plan</button>`;
            }
            html += `</div>`;

            // Plan actions
            html += `<div class="draft-plan-actions">`;
            if (draftSlotCount < 3) {
                html += `<button class="draft-plan-action-btn" onclick="duplicateDraftSlot(${activeDraftSlot})" title="Duplicate current plan">📋 Duplicate</button>`;
            }
            if (draftSlotCount >= 2) {
                html += `<button class="draft-plan-action-btn" onclick="openPlanComparison()" data-tooltip="Score every plan side by side on projected points, hits, bank and squad differences">⚖️ Compare plans</button>`;
            }
            html += `</div>`;
            html += `</div>`;
            return html;
        }

        // Which gameweeks are doubles for anyone in this squad.
        function draftDgwSet(lineup, gwNumbers) {
            const set = new Set();
            new Set(lineup.map(p => p.teamId)).forEach(tid => {
                const tf = teamFixtures6[tid] || [];
                gwNumbers.forEach(g => { if (tf.filter(f => f.event === g).length > 1) set.add(g); });
            });
            return set;
        }

        /* --- Chip helper.

           Two of the four chips have an exact answer. Bench Boost and Triple
           Captain both score the squad you already own, so their worth in a
           given gameweek is simply the projection with the chip minus the
           projection without it — no assumption required.

           Wildcard and Free Hit replace players, so their value depends on a
           squad that does not exist yet and cannot be measured the same way.
           Free Hit still gets a factual signal, the week your eleven is
           thinnest. Wildcard gets none, which is why it is absent from the
           advice rather than guessed at.

           Every figure is shown against the average of the other weeks in the
           window, not against zero. A Bench Boost is always worth something;
           what decides the week is whether the best one is meaningfully better
           than an ordinary one. */
        const DRAFT_CHIP_STANDOUT = 2.0;

        function draftChipAdvice() {
            if (typeof projectLineupForGW !== 'function') return null;
            const ds = getActiveDraft();
            const gwNumbers = ds.gwNumbers || [];
            if (!gwNumbers.length) return null;

            /* Only reason about gameweeks we actually hold fixtures for. Past
               that horizon "no fixture" means "not loaded yet", not "blank
               gameweek", and treating the two alike would invent blanks. */
            let horizon = 0;
            Object.keys(teamFixtures6 || {}).forEach(tid => {
                (teamFixtures6[tid] || []).forEach(f => { if (f.event > horizon) horizon = f.event; });
            });
            const weeks = gwNumbers.filter(g => g <= horizon);
            if (weeks.length < 2) return null;

            const rows = weeks.map(g => {
                const squad = getDraftSquad(g);
                const counts = {};
                squad.forEach(p => {
                    if (counts[p.teamId] === undefined) {
                        counts[p.teamId] = (teamFixtures6[p.teamId] || []).filter(f => f.event === g).length;
                    }
                });
                const starters = squad.filter(p => !p.onBench);
                const base = projectLineupForGW(squad, g, null);
                return {
                    gw: g,
                    base: base,
                    bb: Math.round((projectLineupForGW(squad, g, 'benchboost') - base) * 10) / 10,
                    tc: Math.round((projectLineupForGW(squad, g, 'triplecaptain') - base) * 10) / 10,
                    playingXI: starters.filter(p => (counts[p.teamId] || 0) > 0).length,
                    doubling: squad.filter(p => (counts[p.teamId] || 0) > 1).length
                };
            });

            // Best week for a chip, and how far clear of the rest it actually is.
            function pick(key) {
                const best = rows.reduce((a, b) => (b[key] > a[key] ? b : a));
                const others = rows.filter(r => r.gw !== best.gw);
                const avg = others.reduce((t, r) => t + r[key], 0) / others.length;
                return { gw: best.gw, value: best[key], edge: Math.round((best[key] - avg) * 10) / 10, doubling: best.doubling };
            }

            const picks = [];
            if (isDraftChipAvailable('benchboost')) {
                const p = pick('bb');
                picks.push({
                    chip: 'benchboost', icon: '📈', gw: p.gw,
                    headline: `GW${p.gw} · your bench projects ${p.value.toFixed(1)} pts`,
                    detail: p.edge >= DRAFT_CHIP_STANDOUT
                        ? `That is ${p.edge.toFixed(1)} clear of an average week in this window${p.doubling ? `, with ${p.doubling} of your squad playing twice` : ''}.`
                        : `Only ${Math.abs(p.edge).toFixed(1)} different from an average week here — no gameweek in this window stands out, so there is no reason to spend it yet.`,
                    strong: p.edge >= DRAFT_CHIP_STANDOUT
                });
            }
            if (isDraftChipAvailable('triplecaptain')) {
                const p = pick('tc');
                picks.push({
                    chip: 'triplecaptain', icon: '👑', gw: p.gw,
                    headline: `GW${p.gw} · the extra captain armband adds ${p.value.toFixed(1)} pts`,
                    detail: p.edge >= DRAFT_CHIP_STANDOUT
                        ? `That is ${p.edge.toFixed(1)} clear of an average week in this window.`
                        : `Within ${Math.abs(p.edge).toFixed(1)} of an average week — worth holding for a fixture or a double that actually separates itself.`,
                    strong: p.edge >= DRAFT_CHIP_STANDOUT
                });
            }
            if (isDraftChipAvailable('freehit')) {
                const worst = rows.reduce((a, b) => (b.playingXI < a.playingXI ? b : (b.playingXI === a.playingXI && b.base < a.base ? b : a)));
                const blank = worst.playingXI < 11;
                picks.push({
                    chip: 'freehit', icon: '⚡', gw: worst.gw,
                    headline: blank
                        ? `GW${worst.gw} · only ${worst.playingXI} of your eleven have a fixture`
                        : `GW${worst.gw} · your thinnest week, projecting ${worst.base.toFixed(1)}`,
                    detail: blank
                        ? `A blank gameweek is what Free Hit exists for — it buys you a full eleven for one week without touching your real squad.`
                        : `All eleven play every week in this window, so this is only your weakest set of fixtures, not a blank. Free Hit is usually worth more saved for one.`,
                    strong: blank
                });
            }
            if (!picks.length) return null;

            const dgwWeeks = rows.filter(r => r.doubling > 0).map(r => r.gw);
            const bgwWeeks = rows.filter(r => r.playingXI < 11).map(r => r.gw);
            return { from: weeks[0], to: weeks[weeks.length - 1], picks: picks, dgwWeeks: dgwWeeks, bgwWeeks: bgwWeeks };
        }

        function renderDraftChipAdvice() {
            let advice = null;
            try { advice = draftChipAdvice(); } catch (e) { advice = null; }
            if (!advice) return '';

            const special = advice.dgwWeeks.length || advice.bgwWeeks.length
                ? [advice.dgwWeeks.length ? `double gameweek${advice.dgwWeeks.length > 1 ? 's' : ''} in GW${advice.dgwWeeks.join(', GW')}` : '',
                   advice.bgwWeeks.length ? `blank${advice.bgwWeeks.length > 1 ? 's' : ''} in GW${advice.bgwWeeks.join(', GW')}` : '']
                    .filter(Boolean).join(' and ')
                : '';

            let html = `<div class="draft-chip-advice">`;
            html += `<div class="draft-chip-advice-head">Best week for each chip <span>GW${advice.from}–${advice.to}</span></div>`;
            advice.picks.forEach(p => {
                html += `<button class="draft-chip-advice-row${p.strong ? ' strong' : ''}" onclick="switchDraftGW(${p.gw})"
                    data-tooltip="${escHTML(p.detail)}">
                    <span class="draft-chip-advice-icon">${p.icon}</span>
                    <span class="draft-chip-advice-text">
                        <strong>${escHTML(p.headline)}</strong>
                        <em>${escHTML(p.detail)}</em>
                    </span>
                </button>`;
            });
            html += special
                ? `<div class="draft-chip-advice-foot">Fixture list shows ${escHTML(special)}.</div>`
                : `<div class="draft-chip-advice-foot">No doubles or blanks are scheduled in this window, so no week is unusually good for a chip. Wildcard is not listed — its value depends on a squad you do not own yet.</div>`;
            html += `</div>`;
            return html;
        }

        const DRAFT_CHIP_SHORT = { wildcard: 'WC', freehit: 'FH', benchboost: 'BB', triplecaptain: 'TC' };
        const DRAFT_CHIP_NAME = { wildcard: 'Wildcard', freehit: 'Free Hit', benchboost: 'Bench Boost', triplecaptain: 'Triple Captain' };

        // The whole plan on one strip. Each node carries the three things that decide
        // a gameweek — transfers against free transfers, any points hit that creates,
        // and the chip — plus what the lineup projects, so the cost of a move is
        // visible next to what it buys.
        function renderDraftTimeline() {
            const ds = getActiveDraft();
            const gwNumbers = ds.gwNumbers;
            const dgw = draftDgwSet(getDraftSquad(ds.selectedGW), gwNumbers);

            let planXP = 0;
            const nodes = gwNumbers.map(g => {
                const ft = getDraftFreeTransfers(g);
                const used = (ds.transfers[g] || []).length;
                const hit = getDraftHitCost(g);
                const chip = ds.chips[g];
                const xp = projectLineupForGW(getDraftSquad(g), g, chip);
                planXP += xp - hit;

                const active = g === ds.selectedGW;
                const cls = ['draft-tl-node', active ? 'active' : '', hit > 0 ? 'has-hit' : '', chip ? 'has-chip' : ''].filter(Boolean).join(' ');

                let badges = '';
                if (chip) badges += `<span class="draft-tl-chip" data-tooltip="${escHTML(DRAFT_CHIP_NAME[chip])} played in GW${g}">${DRAFT_CHIP_SHORT[chip]}</span>`;
                if (dgw.has(g)) badges += `<span class="draft-tl-dgw" data-tooltip="Double gameweek — at least one of your players has two matches.">DGW</span>`;

                return `<button class="${cls}" onclick="switchDraftGW(${g})">
                    <span class="draft-tl-gw">GW${g}${badges}</span>
                    <span class="draft-tl-xp" data-tooltip="Projected points for this gameweek's lineup${hit > 0 ? `, before the ${hit}-point hit` : ''}.">${xp.toFixed(1)}<span class="draft-tl-xp-u">xP</span></span>
                    <span class="draft-tl-ft ${used > ft ? 'over' : ''}" data-tooltip="${used} of ${ft} free transfer${ft === 1 ? '' : 's'} used in GW${g}.">${used}/${ft} FT</span>
                    ${hit > 0 ? `<span class="draft-tl-hit" data-tooltip="${used} transfers against ${ft} free — each extra one costs 4 points.">−${hit} pts</span>` : ''}
                </button>`;
            }).join('<span class="draft-tl-link"></span>');

            const totalHits = gwNumbers.reduce((s, g) => s + getDraftHitCost(g), 0);
            return `<div class="draft-timeline">
                <div class="draft-tl-track">${nodes}</div>
                <div class="draft-tl-summary">
                    <span class="draft-tl-total" data-tooltip="Projected points across all ${gwNumbers.length} planned gameweeks, after deducting every points hit.">
                        Plan total <strong>${planXP.toFixed(1)} pts</strong>
                    </span>
                    ${totalHits > 0 ? `<span class="draft-tl-total-hit" data-tooltip="Total points sacrificed to extra transfers across the plan.">−${totalHits} in hits</span>` : '<span class="draft-tl-total-ok">No hits taken</span>'}
                </div>
            </div>`;
        }

        function renderDraftToolbar() {
            const ds = getActiveDraft();
            const gw = ds.selectedGW;
            const lineup = getDraftSquad(gw);
            const formation = getFormation(lineup);
            const budget = getDraftBudget(gw);
            const ft = getDraftFreeTransfers(gw);
            const hitCost = getDraftHitCost(gw);
            const numTransfers = (ds.transfers[gw] || []).length;

            let html = renderDraftTimeline();

            // Named stat chips rather than a run of abbreviations separated by pipes.
            html += `<div class="draft-stats-row">
                <div class="draft-stat">
                    <span class="draft-stat-label">In the bank</span>
                    <span class="draft-stat-value">£${budget.toFixed(1)}m</span>
                </div>
                <div class="draft-stat">
                    <span class="draft-stat-label">Free transfers</span>
                    <span class="draft-stat-value ${numTransfers > ft ? 'over' : ''}">${numTransfers} <span class="draft-stat-sub">of ${ft} used</span></span>
                </div>
                <div class="draft-stat">
                    <span class="draft-stat-label">Formation</span>
                    <span class="draft-stat-value">${escHTML(formation)}</span>
                </div>
                ${hitCost > 0 ? `<div class="draft-stat hit">
                    <span class="draft-stat-label">Points hit</span>
                    <span class="draft-stat-value">−${hitCost} pts</span>
                </div>` : ''}
                <div class="draft-stat editable">
                    <label class="draft-stat-label" for="draftStartFT" data-tooltip="Free transfers you began this plan with. FPL does not publish this, so set it if the guess is wrong.">Starting FT</label>
                    <input id="draftStartFT" type="number" class="draft-ft-input" value="${ds.startingFT}" min="0" max="5" onchange="updateDraftStartingFT(this.value)">
                </div>
                <button class="draft-action-btn danger" onclick="resetDraft()" data-tooltip="Discard every change in this plan and start again from your current squad.">↩ Reset plan</button>
            </div>`;

            return html;
        }

        function renderDraftChipRow() {
            const ds = getActiveDraft();
            const gw = ds.selectedGW;
            const activeChip = ds.chips[gw];
            const chips = [
                { id: 'wildcard', icon: '♠️', label: 'Wildcard' },
                { id: 'freehit', icon: '⚡', label: 'Free Hit' },
                { id: 'benchboost', icon: '📈', label: 'Bench Boost' },
                { id: 'triplecaptain', icon: '👑', label: 'Triple Captain' }
            ];

            let html = `<div class="draft-chip-bar">`;
            html += `<span class="draft-chip-bar-label">Chips for GW${gw}</span>`;
            html += `<div class="draft-chip-selector">`;
            chips.forEach(ch => {
                const isActive = activeChip === ch.id;
                const available = isDraftChipAvailable(ch.id) || isActive;
                const cls = isActive ? 'active' : (!available ? 'used' : '');
                const tip = isActive ? `Playing ${ch.label} in GW${gw} — click to cancel.`
                    : available ? `Play ${ch.label} in GW${gw}.`
                    : `${ch.label} has already been used this season.`;
                html += `<button class="draft-chip-btn ${cls}" ${available || isActive ? `onclick="activateDraftChip('${ch.id}')"` : 'disabled'}
                    data-tooltip="${escHTML(tip)}" aria-pressed="${isActive}">
                    <span class="draft-chip-icon">${ch.icon}</span>${ch.label}
                </button>`;
            });
            html += `</div></div>`;
            html += renderDraftChipAdvice();
            return html;
        }

        function renderDraftPitchHTML() {
            const ds = getActiveDraft();
            const gw = ds.selectedGW;
            if (!gw) return '';
            const lineup = getDraftSquad(gw);
            const starters = lineup.filter(p => !p.onBench);
            const bench = lineup.filter(p => p.onBench).sort((a, b) => a.pickPosition - b.pickPosition);
            const activeChip = ds.chips[gw];

            const gks = starters.filter(p => p.position === 1);
            const defs = starters.filter(p => p.position === 2);
            const mids = starters.filter(p => p.position === 3);
            const fwds = starters.filter(p => p.position === 4);

            const FDR_WORD = { 1: 'Very easy', 2: 'Easy', 3: 'Average', 4: 'Hard', 5: 'Very hard' };

            // A card rather than a numbered circle: the number in the circle was a
            // shirt number, which tells a manager nothing about whether to play them.
            const renderNode = (p, benchIndex) => {
                const posClass = `pos-${POSITION_CONFIG[p.position]?.class || 'mid'}`;
                const gwFixtures = (teamFixtures6[p.teamId] || []).filter(f => f.event === gw);
                const injured = p.status === 'i' || p.status === 'u';
                const doubtful = p.status === 'd';
                const xp = projectPlayerPointsForGW(p, gw);

                let swapClass = '';
                if (draftSwapSource === p.id) swapClass = 'swap-selected';
                else if (draftSwapSource !== null) swapClass = draftCanSwap(draftSwapSource, p.id) ? 'swap-target' : 'swap-ineligible';

                const fixtureChips = gwFixtures.length
                    ? gwFixtures.map(f => `<span class="dp-fix fdr-${f.difficulty || 3}" data-tooltip="GW${gw}: ${f.isHome ? 'home to' : 'away at'} ${escHTML(f.opponent || '?')} — FDR ${f.difficulty || 3} (${FDR_WORD[f.difficulty || 3] || 'Average'})">${escHTML(f.opponent || '?')} <span class="dp-fix-ha">${f.isHome ? 'H' : 'A'}</span></span>`).join('')
                    : `<span class="dp-fix dp-fix-blank" data-tooltip="${escHTML(p.team)} have no fixture in GW${gw} — this player scores nothing.">Blank</span>`;

                let badges = '';
                if (p.isCaptain) badges += `<span class="dp-badge cap" data-tooltip="Captain — ${activeChip === 'triplecaptain' ? 'points trebled by Triple Captain' : 'points doubled'}.">${activeChip === 'triplecaptain' ? '3×' : 'C'}</span>`;
                else if (p.isVice) badges += `<span class="dp-badge vice" data-tooltip="Vice-captain — takes the armband if the captain does not play.">V</span>`;
                if (p.isTransferIn) badges += `<span class="dp-badge in" data-tooltip="Transferred in for GW${gw} in this plan.">IN</span>`;
                if (benchIndex != null) {
                    const isGk = benchIndex === 'GK';
                    badges += `<span class="dp-badge bench" data-tooltip="${isGk ? 'Reserve keeper — only comes on if your starting keeper does not play.' : `Substitution order — ${benchIndex} in line to come on.`}">${isGk ? 'GK' : 'B' + benchIndex}</span>`;
                }
                if (injured) badges += `<span class="dp-badge out" data-tooltip="${escHTML(p.news || 'Unavailable')}">OUT</span>`;
                else if (doubtful) badges += `<span class="dp-badge doubt" data-tooltip="${escHTML(p.news || 'Fitness doubt')}${p.chanceNextRound != null ? ` (${p.chanceNextRound}% chance of playing)` : ''}">?</span>`;

                return `<div class="dp-card ${posClass} ${swapClass} ${injured ? 'is-out' : ''}" onclick="handleDraftPitchClick(${p.id})">
                    <div class="dp-badges">${badges}</div>
                    <button class="dp-transfer" onclick="event.stopPropagation();openDraftTransferPanel(${p.id})" data-tooltip="Transfer ${escHTML(p.name)} out for GW${gw}">↔</button>
                    <div class="dp-name">${escHTML(p.name)}</div>
                    <div class="dp-meta">${escHTML(p.team)} · £${p.price.toFixed(1)}m</div>
                    <div class="dp-fixtures">${fixtureChips}</div>
                    <div class="dp-xp" data-tooltip="Projected points for ${escHTML(p.name)} in GW${gw}, from expected minutes, the opponent and this player's underlying rates.">${xp.toFixed(1)}<span class="dp-xp-u">xP</span></div>
                </div>`;
            };

            let html = `<div class="dp-pitch-card">`;
            if (activeChip) {
                html += `<div class="draft-chip-overlay">${DRAFT_CHIP_NAME[activeChip].toUpperCase()}</div>`;
            }
            html += `<div class="dp-pitch">`;
            html += `<div class="dp-row">${fwds.map(p => renderNode(p)).join('')}</div>`;
            html += `<div class="dp-row">${mids.map(p => renderNode(p)).join('')}</div>`;
            html += `<div class="dp-row">${defs.map(p => renderNode(p)).join('')}</div>`;
            html += `<div class="dp-row">${gks.map(p => renderNode(p)).join('')}</div>`;
            html += `</div>`;

            let benchCounter = 0;
            html += `<div class="dp-bench">
                <div class="dp-bench-label">${activeChip === 'benchboost' ? 'Bench · boosted, these score too' : 'Bench'}</div>
                <div class="dp-bench-row">${bench.map(p => renderNode(p, p.position === 1 ? 'GK' : ++benchCounter)).join('')}</div>
            </div>`;
            html += `</div>`;

            if (draftSwapSource !== null) {
                const src = lineup.find(p => p.id === draftSwapSource);
                html += `<div class="planner-lineup-hint"><span>👆</span> ${src ? escHTML(src.name) : 'Player'} selected — click an eligible player to swap.</div>`;
            } else {
                html += `<div class="planner-lineup-hint"><span>💡</span> Click a player to swap with the bench or reorder it. Use <strong>↔</strong> to make a transfer.</div>`;
            }
            return html;
        }

        // Bare stat names for a position, without the <abbr> markup the cells use.
        function draftStatNamesFor(pos) {
            const probe = { position: pos };
            return getPositionStats(probe, {}, {}).map(s => {
                const m = /<abbr[^>]*>(.*?)<\/abbr>/.exec(s.label);
                return { text: m ? m[1] : s.label, tip: (/title="([^"]*)"/.exec(s.label) || [])[1] || '' };
            });
        }

        // Separate from the body so switching gameweek can refresh it: the column
        // highlight lives here, and re-rendering only the rows left it stuck on
        // whichever gameweek happened to be selected at first paint.
        function renderDraftTableHead() {
            const ds = getActiveDraft();
            const gwNumbers = ds.gwNumbers;
            const dgwSet = draftDgwSet(getDraftSquad(ds.selectedGW), gwNumbers);

            let html = `<tr><th style="min-width:150px;">Player</th>`;
            if (draftTableView === 'stats') {
                html += `<th colspan="3" class="planner-col-group planner-col-season" data-tooltip="Per-90 rates across the whole season.">Season</th>`;
                html += `<th colspan="3" class="planner-col-group planner-col-recent" data-tooltip="Per-90 rates across the last six gameweeks.">Last 6 GWs</th>`;
            }
            gwNumbers.forEach(gw => {
                const focus = gw === ds.selectedGW ? ' gw-column-focus' : '';
                const dgw = dgwSet.has(gw) ? ' <span class="dp-dgw-tag">DGW</span>' : '';
                html += `<th class="planner-fdr${focus}" data-tooltip="GW${gw}${dgwSet.has(gw) ? ' — double gameweek' : ''}. Click to plan this gameweek.">
                    <button class="dp-gw-head" onclick="switchDraftGW(${gw})">GW${gw}${dgw}</button></th>`;
            });
            html += `<th style="width:34px;" data-tooltip="Swap between the XI and the bench">↕</th>`;
            html += `<th style="width:96px;">Actions</th></tr>`;
            return html;
        }

        function renderDraftTableBody() {
            const ds = getActiveDraft();
            const gw = ds.selectedGW;
            const lineup = getDraftSquad(gw);
            const gwNumbers = ds.gwNumbers;
            const starters = lineup.filter(p => !p.onBench).sort((a, b) => a.position - b.position || a.pickPosition - b.pickPosition);
            const bench = lineup.filter(p => p.onBench).sort((a, b) => a.pickPosition - b.pickPosition);

            const posGroups = [
                { pos: 1, label: 'Goalkeepers' },
                { pos: 2, label: 'Defenders' },
                { pos: 3, label: 'Midfielders' },
                { pos: 4, label: 'Forwards' }
            ];

            const statCols = draftTableView === 'stats' ? 6 : 0;
            const totalCols = 1 + statCols + gwNumbers.length + 1 + 1;

            // The stat names sit in the position header because each position is
            // measured on different stats — a keeper on save percentage, a midfielder
            // on xGI. That is why they could not live in the table header, and why
            // they were being reprinted in all fifteen rows.
            const groupHeader = (label, pos) => {
                let h = `<tr class="planner-pos-header"><td class="dp-group-name" colspan="1">${escHTML(label)}</td>`;
                if (draftTableView === 'stats') {
                    const names = draftStatNamesFor(pos);
                    names.forEach(n => { h += `<td class="dp-group-stat season" data-tooltip="${escHTML(n.tip)} — full season.">${escHTML(n.text)}</td>`; });
                    names.forEach(n => { h += `<td class="dp-group-stat recent" data-tooltip="${escHTML(n.tip)} — last 6 gameweeks.">${escHTML(n.text)}</td>`; });
                }
                h += `<td colspan="${gwNumbers.length + 2}"></td></tr>`;
                return h;
            };

            let html = '';
            posGroups.forEach(({ pos, label }) => {
                const groupPlayers = starters.filter(p => p.position === pos);
                if (groupPlayers.length === 0) return;
                html += groupHeader(label, pos);
                groupPlayers.forEach(p => { html += renderDraftRow(p, gwNumbers, false); });
            });

            if (bench.length > 0) {
                html += `<tr class="planner-pos-header planner-bench-header"><td colspan="${totalCols}">Bench</td></tr>`;
                bench.forEach(p => { html += renderDraftRow(p, gwNumbers, true); });
            }
            return html;
        }

        function renderDraftRow(player, gwNumbers, isBench) {
            const ds = getActiveDraft();
            const fixtures = teamFixtures6[player.teamId] || [];

            let rowSwapClass = '';
            if (draftSwapSource === player.id) rowSwapClass = 'planner-swap-highlight';
            else if (draftSwapSource !== null) rowSwapClass = draftCanSwap(draftSwapSource, player.id) ? 'planner-swap-highlight' : 'planner-swap-ineligible';

            let row = `<tr class="${isBench ? 'bench-row' : ''} ${rowSwapClass}" data-player-id="${player.id}">`;

            const captain = player.isCaptain ? '<span class="planner-captain-badge">C</span> ' : player.isVice ? '<span class="planner-captain-badge">V</span> ' : '';
            const statusIcon = player.status === 'i' ? '🏥 ' : player.status === 'd' ? '⚠️ ' : '';
            const transferBadge = player.isTransferIn ? '<span class="draft-transfer-badge">IN</span>' : '';

            row += `<td><div class="planner-player">
                <div>
                    ${captain}${statusIcon}<span class="planner-player-name" onclick="openDraftTransferPanel(${player.id})">${escHTML(player.name)}</span>${transferBadge}
                    <div><span class="planner-player-team">${escHTML(player.team)}</span> <span class="planner-player-price">£${player.price.toFixed(1)}m</span></div>
                </div>
            </div></td>`;

            if (draftTableView === 'stats') {
                const pSeasonStats = getPlayerSeasonPer90(player);
                const pRecentStats = getPlayerRecentStats(player.id, 6);
                const posStats = getPositionStats(player, pSeasonStats, pRecentStats);
                // Values only — the names are in the group header above.
                posStats.forEach(stat => {
                    row += `<td><span class="planner-stat ${rateStat(stat.sVal, stat.label, player.position)}">${stat.season}</span></td>`;
                });
                posStats.forEach(stat => {
                    const trend = getTrend(stat.sVal, stat.rVal, stat.higherBetter);
                    row += `<td><span class="planner-stat ${rateStat(stat.rVal, stat.label, player.position)}">${stat.recent}${trend.icon ? `<span class="planner-trend ${trend.cls}">${trend.icon}</span>` : ''}</span></td>`;
                });
            }

            gwNumbers.forEach(gw => {
                const focus = gw === ds.selectedGW ? ' gw-column-focus' : '';
                if (draftTableView === 'xp') {
                    const xp = projectPlayerPointsForGW(player, gw);
                    const cls = xp >= 5 ? 'xp-great' : xp >= 3.5 ? 'xp-good' : xp >= 2 ? 'xp-ok' : 'xp-poor';
                    const blank = !fixtures.some(f => f.event === gw);
                    row += `<td class="planner-fdr${focus}"><div class="dp-xp-cell ${blank ? 'xp-blank' : cls}" data-tooltip="${blank ? `${escHTML(player.team)} have no fixture in GW${gw}.` : `Projected ${xp.toFixed(1)} points for ${escHTML(player.name)} in GW${gw}.`}">${blank ? '—' : xp.toFixed(1)}</div></td>`;
                    return;
                }
                const gwFixtures = fixtures.filter(f => f.event === gw);
                if (gwFixtures.length > 1) {
                    row += `<td class="planner-fdr${focus}"><div class="planner-fdr-cell-stack">`;
                    gwFixtures.forEach(fix => {
                        row += `<div class="planner-fdr-cell fdr-${fix.difficulty || 3}"><span class="fdr-opp">${escHTML(fix.opponent || '?')}</span><span class="fdr-ha">${fix.isHome ? 'H' : 'A'}</span></div>`;
                    });
                    row += `</div></td>`;
                } else if (gwFixtures.length === 1) {
                    const fix = gwFixtures[0];
                    row += `<td class="planner-fdr${focus}"><div class="planner-fdr-cell fdr-${fix.difficulty || 3}"><span class="fdr-opp">${escHTML(fix.opponent || '?')}</span><span class="fdr-ha">${fix.isHome ? 'H' : 'A'}</span></div></td>`;
                } else {
                    row += `<td class="planner-fdr${focus}"><div class="planner-fdr-cell" style="background:var(--surface-3);color:var(--text-muted);">-</div></td>`;
                }
            });

            const isSwapSource = draftSwapSource === player.id;
            row += `<td><button class="planner-swap-btn ${isSwapSource ? 'swap-active' : ''}" onclick="handleDraftPitchClick(${player.id})" data-tooltip="Swap ${escHTML(player.name)} between the XI and the bench">↕</button></td>`;

            // Bigger, labelled actions — these were 22px circles.
            row += `<td class="dp-actions"><div class="dp-act-row">`;
            row += `<button class="dp-act" onclick="openDraftTransferPanel(${player.id})" data-tooltip="Transfer ${escHTML(player.name)} out">↔</button>`;
            if (!player.onBench) {
                row += `<button class="dp-act ${player.isCaptain ? 'is-cap' : ''}" onclick="setDraftCaptain(${player.id})" data-tooltip="Make ${escHTML(player.name)} captain — their points are doubled">C</button>`;
                row += `<button class="dp-act ${player.isVice ? 'is-vice' : ''}" onclick="setDraftViceCaptain(${player.id})" data-tooltip="Make ${escHTML(player.name)} vice-captain — takes the armband if the captain does not play">V</button>`;
            }
            row += `</div></td>`;
            row += `</tr>`;
            return row;
        }

        function renderDraftTransferSummary() {
            const ds = getActiveDraft();
            const gw = ds.selectedGW;
            const gwTransfers = ds.transfers[gw] || [];
            if (gwTransfers.length === 0) return '';

            let html = `<div class="draft-transfer-summary">`;
            html += `<div class="draft-transfer-summary-title">🔄 Transfers for GW${gw}</div>`;
            gwTransfers.forEach((t, i) => {
                html += `<div class="draft-transfer-item">
                    <span class="draft-transfer-out">${t.outName} (£${t.outPrice.toFixed(1)}m)</span>
                    <span class="draft-transfer-arrow">→</span>
                    <span class="draft-transfer-in">${t.inName} (£${t.inPrice.toFixed(1)}m)</span>
                    <button class="draft-transfer-revert" onclick="revertDraftTransfer(${gw}, ${i})" title="Undo this transfer" aria-label="Undo transfer of ${t.outName} for ${t.inName}">✕</button>
                </div>`;
            });
            html += `</div>`;
            return html;
        }

        function switchDraftGW(gw) {
            getActiveDraft().selectedGW = gw;
            draftSwapSource = null;
            saveDraft();
            rerenderDraftView();
        }

        function updateDraftStartingFT(val) {
            const v = parseInt(val);
            if (!isNaN(v) && v >= 0 && v <= 5) {
                getActiveDraft().startingFT = v;
                saveDraft();
                rerenderDraftView();
            }
        }

        function rerenderDraftView() {
            const ds = getActiveDraft();

            const planBar = document.getElementById('draftPlanBar');
            if (planBar) planBar.innerHTML = renderDraftPlanBar();

            const compareArea = document.getElementById('draftCompareArea');
            if (compareArea) compareArea.innerHTML = draftCompareMode ? renderDraftComparison() : '';

            const toolbar = document.getElementById('draftToolbar');
            if (toolbar) { toolbar.innerHTML = renderDraftToolbar(); toolbar.style.display = draftCompareMode ? 'none' : ''; }

            const chipRow = document.getElementById('draftChipRow');
            if (chipRow) chipRow.style.display = draftCompareMode ? 'none' : '';
            if (chipRow && !draftCompareMode) chipRow.innerHTML = renderDraftChipRow();

            const pitchArea = document.getElementById('draftPitchArea');
            if (pitchArea) pitchArea.innerHTML = draftCompareMode ? '' : renderDraftPitchHTML();

            const layoutWrapper = pitchArea?.closest('.planner-layout-wrapper');
            if (layoutWrapper) layoutWrapper.style.display = draftCompareMode ? 'none' : '';

            const statsHub = document.querySelector('.gw-stats-hub');
            if (statsHub) statsHub.style.display = draftCompareMode ? 'none' : '';

            const thead = document.getElementById('draftTableHead');
            if (thead && !draftCompareMode) thead.innerHTML = renderDraftTableHead();

            const tbody = document.getElementById('draftTableBody');
            if (tbody && !draftCompareMode) tbody.innerHTML = renderDraftTableBody();

            const summary = document.getElementById('draftTransferSummary');
            if (summary && !draftCompareMode) summary.innerHTML = renderDraftTransferSummary();

            const saveInd = document.getElementById('draftSaveIndicator');
            if (saveInd && ds.savedAt) saveInd.textContent = `Plan ${activeDraftSlot + 1} saved: ${new Date(ds.savedAt).toLocaleTimeString()}`;

            const sideBody = document.getElementById('draftSidebarBody');
            if (sideBody && !draftCompareMode) sideBody.innerHTML = renderDraftSidebarBody();

            if (typeof lucide !== 'undefined') lucide.createIcons();
            if (!draftCompareMode && draftSidebarTab === 'notes') { initNotepad(); loadNotepadNotes(); }
        }

        // ===== SIDE-BY-SIDE PLAN COMPARISON =====
        function renderDraftComparison() {
            if (draftSlotCount < 2) return '';
            // Use first plan's selectedGW as the comparison GW
            const compareGW = getActiveDraft().selectedGW;

            let html = '';

            // GW selector for comparison
            const gwNums = getActiveDraft().gwNumbers;
            html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">`;
            html += `<span style="font-size:0.78rem;font-weight:700;color:var(--text-primary);">Comparing GW:</span>`;
            html += `<div class="draft-gw-pills">`;
            gwNums.forEach(g => {
                const active = g === compareGW ? 'active' : '';
                html += `<button class="draft-gw-pill ${active}" onclick="switchCompareGW(${g})">GW${g}</button>`;
            });
            html += `</div></div>`;

            html += `<div class="draft-compare-wrapper">`;

            for (let i = 0; i < draftSlotCount; i++) {
                const ds = draftStates[i];
                if (!ds) continue;

                const lineup = getDraftSquad(compareGW, i);
                const starters = lineup.filter(p => !p.onBench);
                const bench = lineup.filter(p => p.onBench).sort((a, b) => a.pickPosition - b.pickPosition);
                const formation = getFormation(lineup);
                const activeChip = ds.chips[compareGW];

                const gks = starters.filter(p => p.position === 1);
                const defs = starters.filter(p => p.position === 2);
                const mids = starters.filter(p => p.position === 3);
                const fwds = starters.filter(p => p.position === 4);

                // Calculate budget/FT for this slot
                // Temporarily switch active to compute budget
                const prevSlot = activeDraftSlot;
                activeDraftSlot = i;
                const budget = getDraftBudget(compareGW);
                const ft = getDraftFreeTransfers(compareGW);
                const hitCost = getDraftHitCost(compareGW);
                activeDraftSlot = prevSlot;

                const gwTransfers = ds.transfers[compareGW] || [];

                html += `<div class="draft-compare-col">`;
                html += `<div class="draft-compare-header" style="${i === prevSlot ? 'border:2px solid var(--color-primary);' : ''}">Plan ${i + 1}${i === prevSlot ? ' (active)' : ''}</div>`;
                html += `<div style="text-align:center;font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;">${formation}</div>`;

                // Meta
                html += `<div class="draft-compare-meta">`;
                html += `<span class="draft-compare-meta-item">💰 <strong>£${budget.toFixed(1)}m</strong></span>`;
                html += `<span class="draft-compare-meta-item">🔄 FT: <strong>${ft}</strong></span>`;
                if (hitCost > 0) html += `<span class="draft-compare-meta-item" style="color:var(--color-error);">⚠️ <strong>-${hitCost}pts</strong></span>`;
                if (activeChip) {
                    const chipLabels = { wildcard: 'WC', benchboost: 'BB', freehit: 'FH', triplecaptain: 'TC' };
                    html += `<span class="draft-compare-meta-item" style="color:var(--color-primary);font-weight:700;">${chipLabels[activeChip]}</span>`;
                }
                html += `</div>`;

                // Mini pitch
                const renderMiniNode = (p) => {
                    const posClass = `pos-${POSITION_CONFIG[p.position]?.class || 'mid'}`;
                    const fixtures = teamFixtures6[p.teamId] || [];
                    const gwFixtures = fixtures.filter(f => f.event === compareGW);
                    const injured = p.status === 'i' || p.status === 'u';
                    let node = `<div class="planner-pitch-player" title="${escHTML(p.name)} — ${escHTML(p.team)}">`;
                    node += `<div class="planner-pitch-player-node ${posClass} ${injured ? 'planner-pitch-injured' : ''}" style="position:relative;">`;
                    node += jerseyNumberLabel(p);
                    if (p.isCaptain) node += `<span class="planner-pitch-captain">C</span>`;
                    if (p.isVice) node += `<span class="planner-pitch-captain" style="background:var(--text-muted);color:white;">V</span>`;
                    if (p.isTransferIn) node += `<span class="draft-pitch-new-badge">NEW</span>`;
                    node += `</div>`;
                    if (gwFixtures.length > 1) {
                        node += `<div class="planner-fdr-stack">`;
                        gwFixtures.forEach(fix => {
                            const fdrClass = `fdr-${fix.difficulty || 3}`;
                            node += `<div class="planner-fdr-chip ${fdrClass}">${escHTML(fix.opponent || '?')}<span class="fdr-chip-ha">${fix.isHome ? 'H' : 'A'}</span></div>`;
                        });
                        node += `</div>`;
                    } else if (gwFixtures.length === 1) {
                        const fix = gwFixtures[0];
                        const fdrClass = `fdr-${fix.difficulty || 3}`;
                        node += `<div class="planner-fdr-chip ${fdrClass}">${escHTML(fix.opponent || '?')}<span class="fdr-chip-ha">${fix.isHome ? 'H' : 'A'}</span></div>`;
                    }
                    node += `<div class="planner-pitch-player-name">${escHTML(p.name)}</div>`;
                    node += `</div>`;
                    return node;
                };

                html += `<div class="planner-pitch-container" style="position:relative;">`;
                if (activeChip) {
                    const chipLabels = { wildcard: 'WILDCARD', benchboost: 'BENCH BOOST', freehit: 'FREE HIT', triplecaptain: 'TRIPLE CAPTAIN' };
                    html += `<div class="draft-chip-overlay">${chipLabels[activeChip]}</div>`;
                }
                html += `<div class="planner-pitch-rows">`;
                html += `<div class="planner-pitch-row">${fwds.map(renderMiniNode).join('')}</div>`;
                html += `<div class="planner-pitch-row">${mids.map(renderMiniNode).join('')}</div>`;
                html += `<div class="planner-pitch-row">${defs.map(renderMiniNode).join('')}</div>`;
                html += `<div class="planner-pitch-row">${gks.map(renderMiniNode).join('')}</div>`;
                html += `<div class="planner-pitch-row planner-bench-row">`;
                html += `<div class="planner-bench-tag">Bench</div>`;
                html += bench.map(renderMiniNode).join('');
                html += `</div></div></div>`;

                // Transfers for this GW
                if (gwTransfers.length > 0) {
                    html += `<div class="draft-compare-transfers">`;
                    html += `<div style="font-size:0.7rem;font-weight:700;color:var(--text-primary);margin-bottom:4px;">🔄 Transfers</div>`;
                    gwTransfers.forEach(t => {
                        html += `<div class="draft-compare-transfer-item"><span style="color:var(--color-error);">${t.outName}</span> → <span style="color:var(--color-success);">${t.inName}</span></div>`;
                    });
                    html += `</div>`;
                }

                html += `</div>`;
            }

            html += `</div>`;
            return html;
        }

        function switchCompareGW(gw) {
            // Set the selected GW on ALL plans so comparison stays in sync
            for (let i = 0; i < draftSlotCount; i++) {
                if (draftStates[i]) draftStates[i].selectedGW = gw;
            }
            draftSwapSource = null;
            saveDraft();
            rerenderDraftView();
        }

        function switchHubTab(btn) {
            const nav = btn.closest('.hub-tab-nav');
            const hub = btn.closest('.gw-stats-hub');
            if (!nav || !hub) return;
            nav.querySelectorAll('.hub-tab').forEach(t => t.classList.remove('active'));
            hub.querySelectorAll('.hub-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const panel = hub.querySelector('#' + btn.dataset.target);
            if (panel) panel.classList.add('active');
        }

        // ===== PLAN COMPARISON MODAL =====
        // Scores a whole plan on its own terms. getDraftBudget/FreeTransfers/HitCost
        // all read the ACTIVE slot, so the slot is swapped in around the calculation
        // and restored — cheaper and less error-prone than threading a slot index
        // through four functions that already exist and are already correct.
        function evaluateDraftPlan(slotIndex) {
            const ds = draftStates[slotIndex];
            if (!ds) return null;

            const prevSlot = activeDraftSlot;
            activeDraftSlot = slotIndex;
            let xp = 0, hits = 0, transfers = 0;
            const chipsPlayed = [];
            try {
                ds.gwNumbers.forEach(gw => {
                    const chip = ds.chips[gw];
                    xp += projectLineupForGW(getDraftSquad(gw, slotIndex), gw, chip);
                    hits += getDraftHitCost(gw);
                    transfers += (ds.transfers[gw] || []).length;
                    if (chip) chipsPlayed.push({ gw, chip });
                });
                var finalBank = getDraftBudget(ds.gwNumbers[ds.gwNumbers.length - 1]);
            } finally {
                activeDraftSlot = prevSlot;
            }

            const lastGW = ds.gwNumbers[ds.gwNumbers.length - 1];
            return {
                slot: slotIndex,
                xp: Math.round(xp * 10) / 10,
                hits,
                net: Math.round((xp - hits) * 10) / 10,
                transfers,
                chipsPlayed,
                bank: finalBank,
                finalSquad: getDraftSquad(lastGW, slotIndex),
                gwNumbers: ds.gwNumbers
            };
        }

        function renderPlanComparisonModal() {
            const plans = [];
            for (let i = 0; i < draftSlotCount; i++) {
                const ev = evaluateDraftPlan(i);
                if (ev) plans.push(ev);
            }
            if (plans.length < 2) {
                return `<div class="detail-section">Create a second plan to compare.</div>`;
            }

            const best = plans.reduce((a, b) => (b.net > a.net ? b : a), plans[0]);
            const spread = plans.map(p => p.gwNumbers.length ? `GW${p.gwNumbers[0]}–${p.gwNumbers[p.gwNumbers.length - 1]}` : '')[0];

            // What actually differs: who one plan ends with that another does not.
            const idSets = plans.map(p => new Set(p.finalSquad.map(x => x.id)));
            const differentials = plans.map((p, i) => p.finalSquad
                .filter(pl => idSets.some((s, j) => j !== i && !s.has(pl.id)))
                .map(pl => pl.name));

            const row = (label, tip, cells) => `<tr>
                <th class="dpc-metric" data-tooltip="${escHTML(tip)}">${escHTML(label)}</th>
                ${cells.join('')}
            </tr>`;

            return `
            <div class="detail-section">
                <div class="dpc-lead">Each plan scored over ${escHTML(spread)} using the same projection, after deducting every points hit it takes.</div>
                <div class="dpc-wrap"><table class="dpc-table">
                    <thead><tr><th></th>${plans.map(p => `<th class="${p.slot === best.slot ? 'dpc-best' : ''}">Plan ${p.slot + 1}${p.slot === best.slot ? ' <span class="dpc-crown">best</span>' : ''}</th>`).join('')}</tr></thead>
                    <tbody>
                        ${row('Projected points', 'Total projected points across the planned gameweeks, before hits.',
                            plans.map(p => `<td class="dpc-num">${p.xp.toFixed(1)}</td>`))}
                        ${row('Hits taken', 'Points sacrificed to transfers beyond the free ones.',
                            plans.map(p => `<td class="dpc-num ${p.hits > 0 ? 'bad' : ''}">${p.hits > 0 ? `${p.transfers} transfers · −${p.hits}` : `${p.transfers} transfers · none`}</td>`))}
                        ${row('Net total', 'Projected points after hits — the number that actually decides between these plans.',
                            plans.map(p => `<td class="dpc-num dpc-net ${p.slot === best.slot ? 'best' : ''}">${p.net.toFixed(1)}${p.slot === best.slot ? ' 🟢' : ` <span class="dpc-delta">${(p.net - best.net).toFixed(1)}</span>`}</td>`))}
                        ${row('Bank at the end', 'Money left after the last planned gameweek.',
                            plans.map(p => `<td class="dpc-num">£${p.bank.toFixed(1)}m</td>`))}
                        ${row('Chips played', 'Chips this plan commits, and when.',
                            plans.map(p => `<td>${p.chipsPlayed.length
                                ? p.chipsPlayed.map(cp => `<span class="dpc-chip">${DRAFT_CHIP_SHORT[cp.chip]} GW${cp.gw}</span>`).join(' ')
                                : '<span class="dpc-none">None</span>'}</td>`))}
                        ${row('Only in this plan', 'Players this plan finishes with that the others do not.',
                            plans.map((p, i) => `<td class="dpc-diff">${differentials[i].length
                                ? differentials[i].map(n => `<span class="dpc-player">${escHTML(n)}</span>`).join('')
                                : '<span class="dpc-none">Same squad</span>'}</td>`))}
                    </tbody>
                </table></div>
                <div class="dpc-actions">
                    ${plans.filter(p => p.slot !== activeDraftSlot).map(p =>
                        `<button class="rc-btn" onclick="switchDraftSlot(${p.slot}); closePlanComparison();">Switch to Plan ${p.slot + 1}</button>`).join('')}
                </div>
            </div>`;
        }

        function openPlanComparison() {
            const body = document.getElementById('planCompareBody');
            if (!body) return;
            body.innerHTML = renderPlanComparisonModal();
            document.getElementById('planCompareOverlay').classList.add('show');
        }

        function closePlanComparison(event) {
            if (event && event.target !== event.currentTarget) return;
            const el = document.getElementById('planCompareOverlay');
            if (el) el.classList.remove('show');
        }

        // ===== STRATEGY SIDEBAR: AI COPILOT =====
        let draftSidebarTab = 'copilot';

        function setDraftSidebarTab(tab) {
            draftSidebarTab = tab;
            const panel = document.getElementById('draftSidebarBody');
            if (panel) panel.innerHTML = renderDraftSidebarBody();
            document.querySelectorAll('.dp-side-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
            if (tab === 'notes') initNotepad();
        }

        function toggleDraftSidebar() {
            const wrap = document.querySelector('.planner-layout-wrapper');
            if (!wrap) return;
            const collapsed = wrap.classList.toggle('sidebar-collapsed');
            localStorage.setItem('fpl_notepad_open', collapsed ? 'false' : 'true');
            const btn = document.getElementById('draftSidebarToggle');
            if (btn) {
                btn.innerHTML = collapsed ? '◀' : '▶';
                btn.setAttribute('data-tooltip', collapsed ? 'Open the strategy panel' : 'Collapse the panel and give the pitch the full width');
            }
        }

        // The single transfer that gains the most projected points in this gameweek.
        // Candidates are pre-filtered on FPL's own estimate before anything is
        // projected — running the full model over every player in the game for each
        // of fifteen squad slots would be thousands of projections for no better answer.
        function buildDraftCopilot(gw, limit) {
            const ds = getActiveDraft();
            if (!ds) return [];
            const squad = getDraftSquad(gw);
            const budget = getDraftBudget(gw);
            const squadIds = new Set(squad.map(p => p.id));

            // Squad rules still apply to a suggestion, or it is not a legal move.
            const teamCounts = {};
            squad.forEach(p => { teamCounts[p.teamId] = (teamCounts[p.teamId] || 0) + 1; });

            const poolByPos = {};
            [1, 2, 3, 4].forEach(pos => {
                poolByPos[pos] = allPlayers
                    .filter(p => p.position === pos && !squadIds.has(p.id)
                        && (p.status === 'a' || p.status === 'd')
                        && (p.minutes || 0) >= minMinutesForCandidate())
                    .sort((a, b) => (b.epNext || b.form || 0) - (a.epNext || a.form || 0))
                    .slice(0, 30);
            });

            const best = [];
            squad.forEach(out => {
                const outPrice = out.sellPrice || out.price;
                const outXP = projectPlayerPointsForGW(out, gw);
                let top = null;
                (poolByPos[out.position] || []).forEach(cand => {
                    if (cand.price > budget + outPrice + 0.001) return;
                    // Max three from any one club, counting the player leaving.
                    const after = (teamCounts[cand.teamId] || 0) + (cand.teamId === out.teamId ? 0 : 1);
                    if (after > 3) return;
                    const gain = projectPlayerPointsForGW(cand, gw) - outXP;
                    if (!top || gain > top.gain) top = { out, cand, gain, spend: cand.price - outPrice };
                });
                if (top && top.gain > 0.3) best.push(top);
            });

            best.sort((a, b) => b.gain - a.gain);
            return best.slice(0, limit || 3);
        }

        function renderDraftCopilot() {
            const ds = getActiveDraft();
            const gw = ds.selectedGW;
            const moves = buildDraftCopilot(gw, 3);
            const ft = getDraftFreeTransfers(gw);
            const used = (ds.transfers[gw] || []).length;

            if (!moves.length) {
                return `<div class="dp-side-empty">No transfer improves your GW${gw} projection by more than 0.3 points. Your squad is already well set for this week.</div>`;
            }

            return `<div class="dp-copilot">
                <div class="dp-copilot-note">Ranked by projected points gained in GW${gw}. Each respects your budget and the three-per-club limit.</div>
                ${moves.map((m, i) => {
                    // A move beyond the free ones costs 4, so show the gain net of it.
                    const wouldHit = (used + 1) > ft;
                    const net = m.gain - (wouldHit ? 4 : 0);
                    return `<div class="dp-move">
                        <div class="dp-move-rank">${i + 1}</div>
                        <div class="dp-move-body">
                            <div class="dp-move-players">
                                <span class="dp-move-out">${escHTML(m.out.name)}</span>
                                <span class="dp-move-arrow">→</span>
                                <span class="dp-move-in">${escHTML(m.cand.name)}</span>
                            </div>
                            <div class="dp-move-meta">
                                <span class="dp-move-gain ${net > 0 ? 'good' : 'bad'}" data-tooltip="${m.cand.name} projects ${projectPlayerPointsForGW(m.cand, gw).toFixed(1)} against ${m.out.name}'s ${projectPlayerPointsForGW(m.out, gw).toFixed(1)} in GW${gw}${wouldHit ? ', before the 4-point hit this transfer would cost' : ''}.">+${m.gain.toFixed(1)} xP</span>
                                ${wouldHit ? `<span class="dp-move-hit" data-tooltip="You have ${ft} free transfer${ft === 1 ? '' : 's'} and have used ${used}. This one costs 4 points, leaving ${net.toFixed(1)}.">−4 → ${net > 0 ? '+' : ''}${net.toFixed(1)}</span>` : ''}
                                <span class="dp-move-spend" data-tooltip="${m.spend > 0 ? 'Costs' : 'Frees up'} £${Math.abs(m.spend).toFixed(1)}m of your £${getDraftBudget(gw).toFixed(1)}m budget.">${m.spend > 0 ? '−' : '+'}£${Math.abs(m.spend).toFixed(1)}m</span>
                            </div>
                        </div>
                        <button class="dp-move-apply" onclick="confirmDraftTransfer(${m.out.id}, ${m.cand.id})" data-tooltip="Apply this transfer to GW${gw} of this plan">Apply</button>
                    </div>`;
                }).join('')}
            </div>`;
        }

        function renderDraftSidebarBody() {
            const ds = getActiveDraft();
            if (draftSidebarTab === 'copilot') return renderDraftCopilot();
            return `<div class="dp-notes">
                <div class="dp-notes-head">
                    <span class="notepad-gw-label" id="notepadGwLabel">GW${ds.selectedGW}</span>
                    <span class="notepad-save-status" id="notepadSaveStatus">✓ Saved</span>
                </div>
                <textarea id="fpl-notes-area" placeholder="Transfer targets, chip timing, players to watch…"></textarea>
            </div>`;
        }

        function renderDraftSidebar() {
            const collapsed = localStorage.getItem('fpl_notepad_open') !== 'true';
            return `<button class="dp-side-toggle" id="draftSidebarToggle" onclick="toggleDraftSidebar()"
                        data-tooltip="${collapsed ? 'Open the strategy panel' : 'Collapse the panel and give the pitch the full width'}">${collapsed ? '◀' : '▶'}</button>
                <aside class="dp-sidebar">
                    <div class="dp-side-tabs">
                        <button class="dp-side-tab ${draftSidebarTab === 'copilot' ? 'active' : ''}" data-tab="copilot" onclick="setDraftSidebarTab('copilot')">🤖 AI Copilot</button>
                        <button class="dp-side-tab ${draftSidebarTab === 'notes' ? 'active' : ''}" data-tab="notes" onclick="setDraftSidebarTab('notes')">✏️ Notes</button>
                    </div>
                    <div class="dp-side-body" id="draftSidebarBody">${renderDraftSidebarBody()}</div>
                </aside>`;
        }

        // ===== MANAGER'S NOTEPAD ENGINE =====
        let notepadDebounceTimer = null;

        function toggleNotepad() {
            const panel = document.getElementById('gw-notepad-panel');
            const tab = document.querySelector('.notepad-toggle-tab');
            if (!panel) return;
            const isCollapsed = panel.classList.toggle('collapsed');
            if (tab) tab.classList.toggle('active', !isCollapsed);
            localStorage.setItem('fpl_notepad_open', isCollapsed ? 'false' : 'true');
        }

        function initNotepad() {
            const textarea = document.getElementById('fpl-notes-area');
            if (!textarea) return;
            loadNotepadNotes();
            textarea.addEventListener('input', function() {
                clearTimeout(notepadDebounceTimer);
                notepadDebounceTimer = setTimeout(() => saveNotepadNotes(), 1000);
            });
        }

        function loadNotepadNotes() {
            const textarea = document.getElementById('fpl-notes-area');
            const gwLabel = document.getElementById('notepadGwLabel');
            const ds = getActiveDraft();
            if (!textarea || !ds) return;
            const key = `fpl_notes_${ds.teamId}_plan${activeDraftSlot}_gw${ds.selectedGW}`;
            textarea.value = localStorage.getItem(key) || '';
            if (gwLabel) gwLabel.textContent = `P${activeDraftSlot + 1} · GW${ds.selectedGW}`;
        }

        function saveNotepadNotes() {
            const textarea = document.getElementById('fpl-notes-area');
            const ds = getActiveDraft();
            if (!textarea || !ds) return;
            const key = `fpl_notes_${ds.teamId}_plan${activeDraftSlot}_gw${ds.selectedGW}`;
            localStorage.setItem(key, textarea.value);
            const status = document.getElementById('notepadSaveStatus');
            if (status) {
                status.classList.add('visible');
                setTimeout(() => status.classList.remove('visible'), 2000);
            }
        }

