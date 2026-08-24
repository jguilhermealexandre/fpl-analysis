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

        function getActiveDraft() { return draftStates[activeDraftSlot]; }

        function initDraft(slotIndex) {
            if (slotIndex === undefined) slotIndex = activeDraftSlot;
            const gwNumbers = [];
            const upcoming = allFixtures.filter(f => !f.finished_provisional && f.event !== null).map(f => f.event);
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
                startingFT: 1,
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
                    ${(teamFixtures6[player.teamId] || []).map(f => `<div class="transfer-fdr-badge fdr-${f.difficulty || 3}">${escHTML(f.opponent)}${f.isHome ? '(H)' : '(A)'}</div>`).join('')}
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
                        <div class="transfer-fdr-strip">${cFix.map(f => `<div class="transfer-fdr-badge fdr-${f.difficulty || 3}">${escHTML(f.opponent)}</div>`).join('')}</div>
                    </div>
                    <div class="transfer-vs-col">
                        <div class="transfer-vs-label">Replacement</div>
                        <div class="transfer-vs-name" style="color:var(--color-success);">${escHTML(replacement.name)}</div>
                        <div class="transfer-vs-meta">${escHTML(replacement.team)} · £${replacement.price.toFixed(1)}m</div>
                        <div class="transfer-fdr-strip">${rFix.map(f => `<div class="transfer-fdr-badge fdr-${f.difficulty || 3}">${escHTML(f.opponent)}</div>`).join('')}</div>
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

            // Intro
            html += `<div class="planner-intro"><span>📋</span> Plan your transfers, lineup, and chips for the next gameweeks. Create up to 3 plans to compare different strategies.</div>`;

            // Plan selector bar
            html += `<div id="draftPlanBar">${renderDraftPlanBar()}</div>`;

            // Compare mode
            html += `<div id="draftCompareArea">${draftCompareMode ? renderDraftComparison() : ''}</div>`;

            // Toolbar
            html += `<div class="draft-toolbar" id="draftToolbar" ${draftCompareMode ? 'style="display:none;"' : ''}>${renderDraftToolbar()}</div>`;

            // Chip selector row
            html += `<div id="draftChipRow" style="margin-bottom:12px;${draftCompareMode ? 'display:none;' : ''}">${renderDraftChipRow()}</div>`;

            // Pitch view + Notepad layout wrapper
            const notepadOpen = localStorage.getItem('fpl_notepad_open') === 'true';
            html += `<div class="planner-layout-wrapper" ${draftCompareMode ? 'style="display:none;"' : ''}>`;
            html += `<div class="planner-pitch-wrap" id="draftPitchArea">${renderDraftPitchHTML()}</div>`;
            html += `<button class="notepad-toggle-tab${notepadOpen ? ' active' : ''}" onclick="toggleNotepad()" title="Manager's Notepad" aria-label="Toggle Manager's Notepad"><span class="notepad-tab-icon"><i data-lucide="pen-line" style="width:14px;height:14px;"></i></span>Notes</button>`;
            html += `<aside id="gw-notepad-panel" class="notepad-panel${notepadOpen ? '' : ' collapsed'}">`;
            html += `<div class="notepad-header">`;
            html += `<div class="notepad-header-title"><i data-lucide="notebook-pen" style="width:14px;height:14px;"></i> Manager's Notepad</div>`;
            html += `<span class="notepad-gw-label" id="notepadGwLabel">GW${ds.selectedGW}</span>`;
            html += `<span class="notepad-save-status" id="notepadSaveStatus">✓ Saved</span>`;
            html += `<button class="notepad-close-btn" onclick="toggleNotepad()" title="Close notepad" aria-label="Close notepad">✕</button>`;
            html += `</div>`;
            html += `<div class="notepad-body"><textarea id="fpl-notes-area" placeholder="Jot down your GW plans, transfer targets, captaincy thoughts..."></textarea></div>`;
            html += `</aside>`;
            html += `</div>`;

            // ===== STATS HUB — Tabbed Interface =====
            html += `<div class="gw-stats-hub" ${draftCompareMode ? 'style="display:none;"' : ''}>`;
            html += `<div class="hub-tab-nav">`;
            html += `<button class="hub-tab active" data-target="player-tab" onclick="switchHubTab(this)">👤 Player Insights</button>`;
            html += `<button class="hub-tab" data-target="team-tab" onclick="switchHubTab(this)">🛡️ Team Insights</button>`;
            html += `</div>`;

            // Player Insights tab (active by default)
            html += `<div class="hub-panel active" id="player-tab">`;
            html += `<div class="planner-table-wrap"><table class="planner-table">`;
            const gwNumbers = ds.gwNumbers;
            html += `<thead><tr>`;
            html += `<th rowspan="2" style="min-width:140px;">Player</th>`;
            html += `<th colspan="3" class="planner-col-group planner-col-season" style="border-bottom:1px solid rgba(96,165,250,0.15);" title="Full-season averages">Season</th>`;
            html += `<th colspan="3" class="planner-col-group planner-col-recent" style="border-bottom:1px solid rgba(74,222,128,0.15);" title="Averages over the last 6 gameweeks">Last 6 GWs</th>`;
            // Detect DGWs for table headers
            const headerSquad = getDraftSquad(ds.selectedGW);
            const headerTeamIds = new Set(headerSquad.map(p => p.teamId));
            const headerDgwSet = new Set();
            headerTeamIds.forEach(tid => {
                const tf = teamFixtures6[tid] || [];
                gwNumbers.forEach(g => {
                    if (tf.filter(f => f.event === g).length > 1) headerDgwSet.add(g);
                });
            });
            gwNumbers.forEach(gw => {
                const dgwLabel = headerDgwSet.has(gw) ? ' <span style="font-size:0.5rem;color:var(--color-info);font-weight:700;">DGW</span>' : '';
                html += `<th rowspan="2" class="planner-fdr" title="Fixture Difficulty Rating for GW${gw}${headerDgwSet.has(gw) ? ' (Double Gameweek)' : ''}">GW${gw}${dgwLabel}</th>`;
            });
            html += `<th rowspan="2" style="width:30px;">↕</th>`;
            html += `<th rowspan="2" style="width:40px;">Act</th>`;
            html += `</tr><tr>`;
            html += `<th class="planner-col-season" style="font-size:0.55rem;" title="Season stat 1 (position-specific)">S1</th><th class="planner-col-season" style="font-size:0.55rem;" title="Season stat 2 (position-specific)">S2</th><th class="planner-col-season" style="font-size:0.55rem;" title="Season stat 3 (position-specific)">S3</th>`;
            html += `<th class="planner-col-recent" style="font-size:0.55rem;" title="Last 6 GWs stat 1 (position-specific)">L1</th><th class="planner-col-recent" style="font-size:0.55rem;" title="Last 6 GWs stat 2 (position-specific)">L2</th><th class="planner-col-recent" style="font-size:0.55rem;" title="Last 6 GWs stat 3 (position-specific)">L3</th>`;
            html += `</tr></thead>`;
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
            initNotepad();
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
                html += `<button class="draft-plan-action-btn" onclick="toggleDraftCompare()" title="Compare plans side by side">${draftCompareMode ? '← Back' : '⚖️ Compare Plans'}</button>`;
            }
            html += `</div>`;
            html += `</div>`;
            return html;
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

            let html = '';
            // GW pills
            html += `<div class="draft-gw-pills">`;
            // Detect which GWs are DGWs for any squad player
            const squadTeamIds = new Set(lineup.map(p => p.teamId));
            const dgwSet = new Set();
            squadTeamIds.forEach(tid => {
                const tf = teamFixtures6[tid] || [];
                ds.gwNumbers.forEach(g => {
                    if (tf.filter(f => f.event === g).length > 1) dgwSet.add(g);
                });
            });

            ds.gwNumbers.forEach(g => {
                const active = g === gw ? 'active' : '';
                const gwTransfers = (ds.transfers[g] || []).length;
                const gwChip = ds.chips[g];
                let badges = '';
                if (gwTransfers > 0) badges += `<span class="draft-pill-badge transfer-badge">${gwTransfers}</span>`;
                if (gwChip) {
                    const chipLabels = { wildcard: 'WC', benchboost: 'BB', freehit: 'FH', triplecaptain: 'TC' };
                    badges += `<span class="draft-pill-badge chip-badge">${chipLabels[gwChip] || '?'}</span>`;
                }
                if (dgwSet.has(g)) badges += `<span class="draft-pill-badge dgw-badge">DGW</span>`;
                html += `<button class="draft-gw-pill ${active}" onclick="switchDraftGW(${g})">GW${g}${badges}</button>`;
            });
            html += `</div>`;

            // Formation
            html += `<div class="planner-formation-label">${formation}</div>`;

            // Meta row
            html += `<div class="draft-meta-row">`;
            html += `<div class="draft-meta-item">💰 <abbr title="In The Bank — remaining transfer budget">ITB</abbr>: <strong>£${budget.toFixed(1)}m</strong></div>`;
            html += `<div class="draft-meta-item">🔄 <abbr title="Free Transfers available this gameweek">FT</abbr>: <strong>${ft}</strong> | Used: <strong>${numTransfers}</strong></div>`;
            if (hitCost > 0) {
                html += `<div class="draft-meta-item hit-warning">⚠️ Hit: <strong>-${hitCost}pts</strong></div>`;
            }
            html += `<div class="draft-meta-item" style="font-size:0.7rem;">Starting <abbr title="Free Transfers available at the start of this gameweek">FT</abbr>: <input type="number" class="draft-ft-input" value="${ds.startingFT}" min="0" max="5" onchange="updateDraftStartingFT(this.value)"></div>`;
            html += `</div>`;

            // Actions
            html += `<div class="draft-actions">`;
            html += `<button class="draft-action-btn danger" onclick="resetDraft()" title="Reset all draft changes" aria-label="Reset all draft changes">↩ Reset</button>`;
            html += `</div>`;

            return html;
        }

        function renderDraftChipRow() {
            const ds = getActiveDraft();
            const gw = ds.selectedGW;
            const activeChip = ds.chips[gw];
            const chips = [
                { id: 'wildcard', label: '♠️ Wildcard', short: 'WC' },
                { id: 'freehit', label: '⚡ Free Hit', short: 'FH' },
                { id: 'benchboost', label: '📈 Bench Boost', short: 'BB' },
                { id: 'triplecaptain', label: '👑 Triple Captain', short: 'TC' }
            ];

            let html = `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">`;
            html += `<span style="font-size:0.75rem;color:var(--text-muted);font-weight:600;">Chips:</span>`;
            html += `<div class="draft-chip-selector">`;
            chips.forEach(c => {
                const isActive = activeChip === c.id;
                const available = isDraftChipAvailable(c.id) || isActive;
                const cls = isActive ? 'active' : (!available ? 'used' : '');
                html += `<button class="draft-chip-btn ${cls}" onclick="${available || isActive ? `activateDraftChip('${c.id}')` : ''}" ${!available && !isActive ? 'disabled' : ''}>${c.label}</button>`;
            });
            html += `</div>`;
            if (activeChip) {
                const chipNames = { wildcard: 'Wildcard', freehit: 'Free Hit', benchboost: 'Bench Boost', triplecaptain: 'Triple Captain' };
                html += `<span style="font-size:0.75rem;font-weight:700;color:var(--color-primary);">✓ ${chipNames[activeChip]} active for GW${gw}</span>`;
            }
            html += `</div>`;
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

            const renderNode = (p) => {
                const posClass = `pos-${POSITION_CONFIG[p.position]?.class || 'mid'}`;
                const fixtures = teamFixtures6[p.teamId] || [];
                const gwFixtures = fixtures.filter(f => f.event === gw);
                const injured = p.status === 'i' || p.status === 'u';

                let swapClass = '';
                if (draftSwapSource === p.id) {
                    swapClass = 'swap-selected';
                } else if (draftSwapSource !== null) {
                    swapClass = draftCanSwap(draftSwapSource, p.id) ? 'swap-target' : 'swap-ineligible';
                }

                let node = `<div class="planner-pitch-player ${swapClass}" onclick="handleDraftPitchClick(${p.id})" title="${escHTML(p.name)} — ${POSITION_CONFIG[p.position]?.short || ''} · ${escHTML(p.team)}">`;
                node += `<div class="planner-pitch-player-node ${posClass} ${injured ? 'planner-pitch-injured' : ''}" style="position:relative;">`;
                node += jerseyNumberLabel(p);
                if (p.isCaptain) {
                    if (activeChip === 'triplecaptain') {
                        node += `<span class="planner-pitch-captain" style="background:#8B5CF6;">3×</span>`;
                    } else {
                        node += `<span class="planner-pitch-captain">C</span>`;
                    }
                }
                if (p.isVice) node += `<span class="planner-pitch-captain" style="background:var(--text-muted);color:white;">V</span>`;
                if (p.isTransferIn) node += `<span class="draft-pitch-new-badge">NEW</span>`;
                node += `<button class="draft-pitch-transfer-btn" onclick="event.stopPropagation();openDraftTransferPanel(${p.id})" title="Transfer ${escHTML(p.name)}" aria-label="Transfer ${escHTML(p.name)}">↔</button>`;
                node += `</div>`;
                // FDR chip(s) — handle DGW
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
                } else {
                    node += `<div class="planner-fdr-chip" style="background:var(--surface-3);color:var(--text-muted);">-</div>`;
                }
                node += `<div class="planner-pitch-player-name">${escHTML(p.name)}</div>`;
                node += `</div>`;
                return node;
            };

            let html = `<div class="planner-pitch-container" style="position:relative;">`;
            // Chip overlay
            if (activeChip) {
                const chipLabels = { wildcard: 'WILDCARD', benchboost: 'BENCH BOOST', freehit: 'FREE HIT', triplecaptain: 'TRIPLE CAPTAIN' };
                html += `<div class="draft-chip-overlay">${chipLabels[activeChip]}</div>`;
            }
            html += `<div class="planner-pitch-rows">`;
            html += `<div class="planner-pitch-row">${fwds.map(p => renderNode(p)).join('')}</div>`;
            html += `<div class="planner-pitch-row">${mids.map(p => renderNode(p)).join('')}</div>`;
            html += `<div class="planner-pitch-row">${defs.map(p => renderNode(p)).join('')}</div>`;
            html += `<div class="planner-pitch-row">${gks.map(p => renderNode(p)).join('')}</div>`;
            html += `<div class="planner-pitch-row planner-bench-row">`;
            html += `<div class="planner-bench-tag">${activeChip === 'benchboost' ? 'Bench (Boosted!)' : 'Bench'}</div>`;
            html += bench.map(p => renderNode(p)).join('');
            html += `</div>`;
            html += `</div></div>`;

            // Hint
            if (draftSwapSource !== null) {
                const src = lineup.find(p => p.id === draftSwapSource);
                html += `<div class="planner-lineup-hint"><span>👆</span> ${src ? src.name : 'Player'} selected — click an eligible player to swap.</div>`;
            } else {
                html += `<div class="planner-lineup-hint"><span>💡</span> Click a player to swap with bench or reorder bench priority. Use the <strong>↔</strong> button (hover on pitch, or in table) to make a transfer.</div>`;
            }

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
                { pos: 1, label: 'Goalkeepers', cls: 'pos-gk' },
                { pos: 2, label: 'Defenders', cls: 'pos-def' },
                { pos: 3, label: 'Midfielders', cls: 'pos-mid' },
                { pos: 4, label: 'Forwards', cls: 'pos-fwd' }
            ];

            const totalCols = 1 + 6 + gwNumbers.length + 1 + 1;
            let html = '';
            posGroups.forEach(({ pos, label, cls }) => {
                const groupPlayers = starters.filter(p => p.position === pos);
                if (groupPlayers.length === 0) return;
                html += `<tr class="planner-pos-header ${cls}"><td colspan="${totalCols}">${label}</td></tr>`;
                groupPlayers.forEach(p => { html += renderDraftRow(p, gwNumbers, false); });
            });

            if (bench.length > 0) {
                html += `<tr class="planner-bench-header"><td colspan="${totalCols}">Bench</td></tr>`;
                bench.forEach(p => { html += renderDraftRow(p, gwNumbers, true); });
            }
            return html;
        }

        function renderDraftRow(player, gwNumbers, isBench) {
            const pSeasonStats = getPlayerSeasonPer90(player);
            const pRecentStats = getPlayerRecentStats(player.id, 6);
            const posStats = getPositionStats(player, pSeasonStats, pRecentStats);
            const fixtures = teamFixtures6[player.teamId] || [];

            let rowSwapClass = '';
            if (draftSwapSource === player.id) {
                rowSwapClass = 'planner-swap-highlight';
            } else if (draftSwapSource !== null) {
                rowSwapClass = draftCanSwap(draftSwapSource, player.id) ? 'planner-swap-highlight' : 'planner-swap-ineligible';
            }

            let row = `<tr class="${isBench ? 'bench-row' : ''} ${rowSwapClass}" data-player-id="${player.id}">`;

            // Player name cell
            const captain = player.isCaptain ? '<span class="planner-captain-badge">C</span> ' : player.isVice ? '<span class="planner-captain-badge">©</span> ' : '';
            const statusIcon = player.status === 'i' ? '🏥 ' : player.status === 'd' ? '⚠️ ' : '';
            const transferBadge = player.isTransferIn ? '<span class="draft-transfer-badge">NEW</span>' : '';

            row += `<td><div class="planner-player">
                <div>
                    ${captain}${statusIcon}<span class="planner-player-name" onclick="openDraftTransferPanel(${player.id})">${escHTML(player.name)}</span>${transferBadge}
                    <div><span class="planner-player-team">${escHTML(player.team)}</span> <span class="planner-player-price">£${player.price.toFixed(1)}m</span></div>
                </div>
            </div></td>`;

            // Season stats
            posStats.forEach(stat => {
                const rating = rateStat(stat.sVal, stat.label, player.position);
                row += `<td><div class="planner-stat-group"><span class="planner-stat-label">${stat.label}</span><span class="planner-stat ${rating}">${stat.season}</span></div></td>`;
            });

            // Recent stats with trends
            posStats.forEach(stat => {
                const rating = rateStat(stat.rVal, stat.label, player.position);
                const trend = getTrend(stat.sVal, stat.rVal, stat.higherBetter);
                row += `<td><div class="planner-stat-group"><span class="planner-stat-label">${stat.label}</span><span class="planner-stat ${rating}">${stat.recent}${trend.icon ? `<span class="planner-trend ${trend.cls}">${trend.icon}</span>` : ''}</span></div></td>`;
            });

            // FDR cells
            gwNumbers.forEach(gw => {
                const gwFixtures = fixtures.filter(f => f.event === gw);
                if (gwFixtures.length > 1) {
                    row += `<td class="planner-fdr"><div class="planner-fdr-cell-stack">`;
                    gwFixtures.forEach(fix => {
                        const fdrClass = `fdr-${fix.difficulty || 3}`;
                        row += `<div class="planner-fdr-cell ${fdrClass}"><span class="fdr-opp">${escHTML(fix.opponent || '?')}</span><span class="fdr-ha">${fix.isHome ? 'H' : 'A'}</span></div>`;
                    });
                    row += `</div></td>`;
                } else if (gwFixtures.length === 1) {
                    const fix = gwFixtures[0];
                    const fdrClass = `fdr-${fix.difficulty || 3}`;
                    row += `<td class="planner-fdr"><div class="planner-fdr-cell ${fdrClass}"><span class="fdr-opp">${escHTML(fix.opponent || '?')}</span><span class="fdr-ha">${fix.isHome ? 'H' : 'A'}</span></div></td>`;
                } else {
                    row += `<td class="planner-fdr"><div class="planner-fdr-cell" style="background:var(--surface-3);color:var(--text-muted);">-</div></td>`;
                }
            });

            // Swap button
            const isSwapSource = draftSwapSource === player.id;
            const swapBtnClass = isSwapSource ? 'swap-active' : '';
            row += `<td><button class="planner-swap-btn ${swapBtnClass}" onclick="handleDraftPitchClick(${player.id})" title="Swap between XI and bench" aria-label="Swap ${escHTML(player.name)} between XI and bench">↕</button></td>`;

            // Action buttons (transfer + captain)
            row += `<td style="white-space:nowrap;">`;
            row += `<button class="planner-swap-btn" onclick="openDraftTransferPanel(${player.id})" title="Transfer ${escHTML(player.name)}" aria-label="Transfer ${escHTML(player.name)}" style="font-size:0.6rem;width:22px;height:22px;">↔</button> `;
            if (!player.onBench) {
                row += `<button class="planner-swap-btn" onclick="setDraftCaptain(${player.id})" title="Set as captain" aria-label="Set ${escHTML(player.name)} as captain" style="font-size:0.6rem;width:22px;height:22px;${player.isCaptain ? 'background:var(--color-captain);color:#000;border-color:var(--color-captain);' : ''}">C</button> `;
                row += `<button class="planner-swap-btn" onclick="setDraftViceCaptain(${player.id})" title="Set as vice-captain" aria-label="Set ${escHTML(player.name)} as vice-captain" style="font-size:0.6rem;width:22px;height:22px;${player.isVice ? 'background:var(--text-muted);color:#fff;border-color:var(--text-muted);' : ''}">V</button>`;
            }
            row += `</td>`;

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

            const tbody = document.getElementById('draftTableBody');
            if (tbody && !draftCompareMode) tbody.innerHTML = renderDraftTableBody();

            const summary = document.getElementById('draftTransferSummary');
            if (summary && !draftCompareMode) summary.innerHTML = renderDraftTransferSummary();

            const saveInd = document.getElementById('draftSaveIndicator');
            if (saveInd && ds.savedAt) saveInd.textContent = `Plan ${activeDraftSlot + 1} saved: ${new Date(ds.savedAt).toLocaleTimeString()}`;

            if (typeof lucide !== 'undefined') lucide.createIcons();
            if (!draftCompareMode) loadNotepadNotes();
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

