/* ============================================
   EasyFPL — My Team Analysis
   The 3-step Lineup Wizard, plus page initialization.

   Extracted from the inline <script> in fpl-my-team-analysis.html.
   These files are plain classic scripts loaded in order, not ES modules:
   every function stays a global, which the inline onclick= handlers
   throughout the markup depend on. Load order is preserved from the
   original file — team-analysis-core.js must come first, since the
   settings IIFE in lineup-wizard.js reads DEFAULT_SETTINGS from it.
   ============================================ */

        // ===== LINEUP WIZARD ENGINE (3-Step Interactive) =====

        function renderInlineLineupWizard() {
            lineupRendered = true;
            const container = document.getElementById('lineupDisplay');
            if (!picksData || !picksData.picks || picksData.picks.length === 0) {
                container.innerHTML = '<div style="text-align:center;padding:60px 20px;"><div style="font-size:48px;margin-bottom:16px;"><i data-lucide="users" style="width:48px;height:48px;"></i></div><div style="font-size:18px;font-weight:600;margin-bottom:8px;">Load Your Team First</div><div style="font-size:14px;color:var(--text-secondary);">Enter your FPL Team ID above to get lineup recommendations.</div></div>';
                if (typeof lucide !== 'undefined') lucide.createIcons();
                return;
            }

            // Build squad with scores
            const squad = picksData.picks.map(pick => {
                const p = allPlayersById[pick.element];
                if (!p) return null;
                const score = computeQuickLineupScore(p);
                return { ...p, pos: p.position, web_name: p.name, pickPos: pick.position, onBench: pick.position > 11, isCaptain: pick.is_captain, isViceCaptain: pick.is_vice_captain, lwScore: score };
            }).filter(Boolean);

            // Initialize lineup state
            lineupState.squad = squad;
            lineupState.excluded = new Set();
            lineupState.swapSource = null;
            lineupState.selectedPlayers = [];
            lineupState.captain = null;
            lineupState.viceCaptain = null;
            lineupState.step = 1;

            // Track originals for comparison
            lineupState.originalXIIds = new Set(squad.filter(p => !p.onBench).map(p => p.id));
            lineupState.originalCaptain = squad.find(p => p.isCaptain)?.id || null;
            lineupState.originalVC = squad.find(p => p.isViceCaptain)?.id || null;

            // Auto-exclude unavailable players
            squad.forEach(p => {
                if (p.status === 'i' || p.status === 'u' || p.status === 's') {
                    lineupState.excluded.add(p.id);
                }
            });

            container.innerHTML = `
                <div class="lw-container">
                    <div class="lw-intro">
                        <span><i data-lucide="wand-2" style="width:20px;height:20px;"></i></span>
                        <div>Build your optimal GW${currentGW} lineup. Review availability, set your best XI, then pick your captain.</div>
                    </div>
                    <div class="lw-steps" id="lwSteps">
                        <button class="lw-step active" onclick="goToLineupStep(1)">
                            <div class="lw-step-num">1</div>
                            <span class="lw-step-label"><i data-lucide="clipboard-check" style="width:12px;height:12px;display:inline;vertical-align:middle;"></i> Squad Review</span>
                        </button>
                        <button class="lw-step disabled" onclick="goToLineupStep(2)">
                            <div class="lw-step-num">2</div>
                            <span class="lw-step-label"><i data-lucide="layout-grid" style="width:12px;height:12px;display:inline;vertical-align:middle;"></i> Set Lineup</span>
                        </button>
                        <button class="lw-step disabled" onclick="goToLineupStep(3)">
                            <div class="lw-step-num">3</div>
                            <span class="lw-step-label"><i data-lucide="crown" style="width:12px;height:12px;display:inline;vertical-align:middle;"></i> Captain & Summary</span>
                        </button>
                    </div>
                    <div class="lw-panel active" id="lwPanel1"></div>
                    <div class="lw-panel" id="lwPanel2"></div>
                    <div class="lw-panel" id="lwPanel3"></div>
                </div>
            `;

            if (typeof lucide !== 'undefined') lucide.createIcons();
            renderLineupStep1();
        }

        // Step navigation
        function goToLineupStep(step) {
            if (step >= 2) {
                const available = lineupState.squad.filter(p => !lineupState.excluded.has(p.id));
                if (available.length < 11) return;
            }
            if (step >= 3 && (!lineupState.xi || lineupState.xi.length < 11)) return;

            lineupState.step = step;

            document.querySelectorAll('.lw-step').forEach((el, i) => {
                el.classList.remove('active', 'completed', 'disabled');
                if (i + 1 === step) el.classList.add('active');
                else if (i + 1 < step) el.classList.add('completed');
                else el.classList.add('disabled');
            });

            document.querySelectorAll('.lw-panel').forEach((el, i) => {
                el.classList.toggle('active', i + 1 === step);
            });

            if (step === 1) renderLineupStep1();
            else if (step === 2) renderLineupStep2();
            else if (step === 3) renderLineupStep3();
        }

        // ── STEP 1: Squad Review ──
        function renderLineupStep1() {
            const panel = document.getElementById('lwPanel1');
            const squad = lineupState.squad;
            const excluded = lineupState.excluded;
            const available = squad.filter(p => !excluded.has(p.id));
            const flagged = squad.filter(p => p.status === 'i' || p.status === 'u' || p.status === 's' || p.status === 'd');

            // Summary bar
            let html = `<div class="lw-summary-bar">
                <div class="lw-summary-item"><div class="lw-summary-label">Available</div><div class="lw-summary-value" style="color:var(--color-success);">${available.length}</div></div>
                <div style="width:1px;height:32px;background:var(--border-default);"></div>
                <div class="lw-summary-item"><div class="lw-summary-label">Excluded</div><div class="lw-summary-value" style="color:${excluded.size > 0 ? 'var(--color-error)' : 'var(--text-muted)'};">${excluded.size}</div></div>
                <div style="width:1px;height:32px;background:var(--border-default);"></div>
                <div class="lw-summary-item"><div class="lw-summary-label">Flagged</div><div class="lw-summary-value" style="color:${flagged.length > 0 ? '#F59E0B' : 'var(--text-muted)'};">${flagged.length}</div></div>
                <div style="flex:1;"></div>
                <div style="font-size:11px;color:var(--text-secondary);">Click a player to toggle availability</div>
            </div>`;

            // Starting XI group
            const starters = squad.filter(p => !p.onBench).sort((a, b) => a.pos - b.pos || b.lwScore - a.lwScore);
            const benchPlayers = squad.filter(p => p.onBench).sort((a, b) => a.pickPos - b.pickPos);

            html += `<div style="margin-bottom:16px;"><div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);font-weight:700;margin-bottom:8px;padding-left:4px;"><i data-lucide="users" style="width:12px;height:12px;display:inline;vertical-align:middle;"></i> Current Starting XI</div>`;
            html += `<div class="lw-squad-grid">`;
            starters.forEach(p => { html += renderLWPlayerCard(p); });
            html += `</div></div>`;

            html += `<div style="margin-bottom:16px;"><div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);font-weight:700;margin-bottom:8px;padding-left:4px;"><i data-lucide="clipboard-list" style="width:12px;height:12px;display:inline;vertical-align:middle;"></i> Bench</div>`;
            html += `<div class="lw-squad-grid">`;
            benchPlayers.forEach(p => { html += renderLWPlayerCard(p); });
            html += `</div></div>`;

            // Action
            html += `<div class="tw-actions">
                <button class="tw-btn tw-btn-primary" onclick="goToLineupStep(2)" ${available.length < 11 ? 'disabled title="Need at least 11 available players"' : ''}>
                    <i data-lucide="wand-2" style="width:14px;height:14px;"></i> Find Best Lineup →
                </button>
            </div>`;

            panel.innerHTML = html;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        function renderLWPlayerCard(p) {
            const isExcluded = lineupState.excluded.has(p.id);
            const posNames = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
            const posColors = { 1: '#D97706', 2: '#059669', 3: '#2563EB', 4: '#DC2626' };
            const fx = p.fixtures || [];
            const nextFx = fx[0];
            const statusIcon = p.status === 'i' ? '🏥' : p.status === 'u' ? '❌' : p.status === 's' ? '🟥' : p.status === 'd' ? '⚠️' : '';

            return `<div class="lw-player-card ${isExcluded ? 'excluded' : 'available'}" onclick="toggleLWExclude(${p.id})">
                <div class="lw-toggle">${isExcluded ? '✗' : '✓'}</div>
                <div style="padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;background:${posColors[p.pos]}22;color:${posColors[p.pos]};">${posNames[p.pos]}</div>
                <div class="lw-info">
                    <div class="lw-name">${statusIcon} ${escHTML(p.web_name)}</div>
                    <div class="lw-meta">
                        <span>${escHTML(p.team)} · £${p.price.toFixed(1)}m</span>
                        ${nextFx ? `<span class="fixture-chip fdr-${nextFx.difficulty}" style="font-size:10px;padding:1px 5px;">${escHTML(nextFx.opponent)}(${nextFx.isHome ? 'H' : 'A'})</span>` : ''}
                        ${p.status === 'd' ? '<span style="color:#F59E0B;font-size:10px;">Doubtful</span>' : ''}
                        ${p.status === 'i' ? '<span style="color:var(--color-error);font-size:10px;">Injured</span>' : ''}
                    </div>
                </div>
                <div class="lw-stats">
                    <div class="lw-stat"><div class="lw-stat-val">${p.form}</div><div class="lw-stat-label">Form</div></div>
                    <div class="lw-stat"><div class="lw-stat-val">${p.ppg.toFixed(1)}</div><div class="lw-stat-label">PPG</div></div>
                    <div class="lw-stat"><div class="lw-stat-val" style="color:${p.lwScore >= 30 ? 'var(--color-success)' : p.lwScore >= 10 ? '#F59E0B' : 'var(--color-error)'}">${p.lwScore}</div><div class="lw-stat-label" title="Lineup Score = EP×3 + Form×2 + (3−FDR)×5 + Home×2 + xGI/90×10 + Minutes bonus + PPG×1.5">Score</div></div>
                </div>
            </div>`;
        }

        function toggleLWExclude(playerId) {
            if (lineupState.excluded.has(playerId)) {
                lineupState.excluded.delete(playerId);
            } else {
                lineupState.excluded.add(playerId);
            }
            renderLineupStep1();
        }

        // ── STEP 2: Set Lineup (Pitch + Swaps) ──
        function renderLineupStep2() {
            const panel = document.getElementById('lwPanel2');
            lineupState.swapSource = null;

            // Recalculate scores excluding unavailable
            const available = lineupState.squad.filter(p => !lineupState.excluded.has(p.id));
            available.forEach(p => { p.lwScore = computeQuickLineupScore(p); });
            // Set excluded players to -100
            lineupState.squad.filter(p => lineupState.excluded.has(p.id)).forEach(p => { p.lwScore = -100; });

            // Solve optimal lineup from available pool
            const solution = solveQuickLineup(available);
            lineupState.xi = [...solution.xi];
            lineupState.bench = [...solution.bench];
            lineupState.formation = solution.formation;

            renderLineupStep2Content();
        }

        function renderLineupStep2Content() {
            const panel = document.getElementById('lwPanel2');
            const xi = lineupState.xi;
            const bench = lineupState.bench;
            const formation = lineupState.formation;
            const totalScore = xi.reduce((s, p) => s + p.lwScore, 0);

            const posNames = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
            const posColors = { 1: '#D97706', 2: '#059669', 3: '#2563EB', 4: '#DC2626' };
            const posClasses = { 1: 'pos-gk', 2: 'pos-def', 3: 'pos-mid', 4: 'pos-fwd' };

            const gk = xi.filter(p => p.pos === 1);
            const defs = xi.filter(p => p.pos === 2).sort((a, b) => b.lwScore - a.lwScore);
            const mids = xi.filter(p => p.pos === 3).sort((a, b) => b.lwScore - a.lwScore);
            const fwds = xi.filter(p => p.pos === 4).sort((a, b) => b.lwScore - a.lwScore);

            // Row renderer
            function renderRow(p, isBench, benchIdx) {
                const fx = p.fixtures?.[0];
                const sc = p.lwScore >= 30 ? 'var(--color-success)' : p.lwScore >= 10 ? '#F59E0B' : 'var(--color-error)';
                const isSwapSrc = lineupState.swapSource === p.id;
                const isSwapTgt = lineupState.swapSource && lineupState.swapSource !== p.id;
                const isSelected = lineupState.selectedPlayers.includes(p.id);
                let cls = 'lw-row';
                if (isBench) cls += ' lw-row-bench';
                if (isSwapSrc) cls += ' lw-row-swap-source';
                else if (isSwapTgt) cls += ' lw-row-swap-target';
                if (isSelected) cls += ' lw-row-selected';

                return `<div class="${cls}" data-player-id="${p.id}" onclick="handleLWRowClick(${p.id})">
                    <button class="lw-row-swap-btn ${isSwapSrc ? 'active' : ''}" onclick="handleLWSwapBtnClick(${p.id}, event)" title="Swap player">↕</button>
                    <div class="lw-row-player">
                        <div class="lw-row-player-name">${benchIdx ? `<span style="color:var(--text-muted);font-size:10px;margin-right:2px;">${benchIdx}.</span>` : ''}${escHTML(p.web_name)}</div>
                        <div class="lw-row-player-team">${escHTML(p.team)}</div>
                    </div>
                    <div class="lw-row-fixture">${fx ? `<span class="fdr-dot fdr-${fx.difficulty}"></span><span>${escHTML(fx.opponent)}</span><span style="font-size:9px;color:var(--text-muted);">${fx.isHome ? 'H' : 'A'}</span>` : '<span style="color:var(--text-muted);">-</span>'}</div>
                    <div class="lw-row-stat">${p.form}</div>
                    <div class="lw-row-stat">${(p.epNext || 0).toFixed(1)}</div>
                    <div class="lw-row-stat" style="color:${sc};font-size:13px;">${p.lwScore}</div>
                </div>`;
            }

            // ── FULL-WIDTH HEADER (above grid so intel and pitch align) ──
            let topBar = '';
            topBar += `<div style="font-size:18px;font-weight:700;font-family:var(--font-display);margin-bottom:4px;"><i data-lucide="layout-grid" style="width:18px;height:18px;display:inline;vertical-align:middle;"></i> Optimal Lineup — GW${currentGW}</div>`;
            topBar += `<div style="display:flex;align-items:center;gap:12px;font-size:13px;color:var(--text-secondary);margin-bottom:16px;flex-wrap:wrap;">
                <span>Formation: <strong style="color:var(--text-primary);">${formation}</strong></span>
                <span>·</span>
                <span>Total Score: <strong style="color:var(--color-success);font-family:var(--font-mono);">${totalScore}</strong></span>
                <span style="flex:1;"></span>
                <button class="tw-btn tw-btn-secondary" style="padding:4px 10px;font-size:11px;" onclick="resetLineupToOptimal()"><i data-lucide="rotate-ccw" style="width:12px;height:12px;"></i> Reset</button>
            </div>`;

            // ── LEFT COLUMN: Lineup ──
            let left = '';

            // Swap hint
            if (lineupState.swapSource) {
                const src = lineupState.squad.find(p => p.id === lineupState.swapSource);
                left += `<div class="lw-swap-hint"><i data-lucide="repeat" style="width:14px;height:14px;display:inline;vertical-align:middle;"></i> Swapping: ${src?.web_name || '?'} — Click ↕ on another player to complete, or click again to cancel</div>`;
            }

            // Compact mini pitch
            left += `<div class="lw-pitch" style="padding:16px 12px;margin-bottom:12px;">`;
            left += `<div class="lw-pitch-row">${fwds.map(p => renderLWPitchPlayer(p, false)).join('')}</div>`;
            left += `<div class="lw-pitch-row">${mids.map(p => renderLWPitchPlayer(p, false)).join('')}</div>`;
            left += `<div class="lw-pitch-row">${defs.map(p => renderLWPitchPlayer(p, false)).join('')}</div>`;
            left += `<div class="lw-pitch-row">${gk.map(p => renderLWPitchPlayer(p, false)).join('')}</div>`;
            left += `</div>`;

            // Column headers
            left += `<div class="lw-col-headers"><span></span><span>Player</span><span>Fixture</span><span>Form</span><span>EP</span><span>Score</span></div>`;

            // Starting XI — grouped by position
            const groups = [
                { pos: 1, label: 'Goalkeeper', players: gk },
                { pos: 2, label: 'Defenders', players: defs },
                { pos: 3, label: 'Midfielders', players: mids },
                { pos: 4, label: 'Forwards', players: fwds }
            ];

            groups.forEach(g => {
                if (g.players.length === 0) return;
                left += `<div class="lw-pos-group">`;
                left += `<div class="lw-pos-header ${posClasses[g.pos]}"><span style="font-size:11px;">${posNames[g.pos]}</span> ${g.label}</div>`;
                g.players.forEach(p => { left += renderRow(p, false); });
                left += `</div>`;
            });

            // Bench group
            if (bench.length > 0) {
                left += `<div class="lw-pos-group" style="margin-top:8px;">`;
                left += `<div class="lw-pos-header pos-bench"><i data-lucide="clipboard-list" style="width:11px;height:11px;display:inline;vertical-align:middle;"></i> Bench</div>`;
                bench.forEach((p, i) => { left += renderRow(p, true, i + 1); });
                left += `</div>`;
            }

            // Actions
            left += `<div class="tw-actions" style="margin-top:16px;">
                <button class="tw-btn tw-btn-back" onclick="goToLineupStep(1)"><i data-lucide="arrow-left" style="width:14px;height:14px;"></i> Back</button>
                <button class="tw-btn tw-btn-primary" onclick="goToLineupStep(3)"><i data-lucide="crown" style="width:14px;height:14px;"></i> Pick Captain →</button>
            </div>`;

            // ── RIGHT COLUMN: Context Panel ──
            let right = renderLWContextPanel();

            // ── Assemble split layout ──
            let html = topBar + `<div class="lw-clipboard-layout">
                <div class="lw-lineup-col">${left}</div>
                <div class="lw-context-col" id="lwContextPanel">${right}</div>
            </div>`;

            panel.innerHTML = html;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        function renderLWPitchPlayer(p, isBench, benchOrder) {
            const posNames = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
            const posColors = { 1: '#D97706', 2: '#059669', 3: '#2563EB', 4: '#DC2626' };
            const bg = { 1: 'rgba(217,119,6,0.2)', 2: 'rgba(5,150,105,0.2)', 3: 'rgba(37,99,235,0.2)', 4: 'rgba(220,38,38,0.2)' };
            const sc = p.lwScore >= 30 ? 'var(--color-success)' : p.lwScore >= 10 ? '#F59E0B' : 'var(--color-error)';
            const fx = p.fixtures?.[0];
            const isSelected = lineupState.selectedPlayers.includes(p.id);

            return `<div class="lw-pitch-player ${isBench ? 'bench' : ''}" onclick="handleLWRowClick(${p.id})" title="${escHTML(p.web_name)} · Score: ${p.lwScore}" style="${isSelected ? 'background:rgba(167,139,250,0.2);box-shadow:0 0 0 2px #A78BFA;border-radius:8px;' : ''}">
                ${benchOrder ? `<div style="position:absolute;top:-4px;right:-4px;width:16px;height:16px;border-radius:50%;background:var(--surface-3);color:var(--text-muted);font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);">${benchOrder}</div>` : ''}
                <div class="lw-pitch-node" style="background:${bg[p.pos]};border:2px solid ${posColors[p.pos]};color:${posColors[p.pos]};">${jerseyNumberLabel(p)}</div>
                <div class="lw-pitch-name">${escHTML(p.web_name)}</div>
                ${fx ? `<div style="display:flex;align-items:center;gap:2px;justify-content:center;"><span class="fdr-dot fdr-${fx.difficulty}" style="width:6px;height:6px;"></span><span style="font-size:8px;color:rgba(255,255,255,0.7);">${escHTML(fx.opponent)}</span></div>` : ''}
                <div class="lw-pitch-score" style="color:${sc};">${p.lwScore}</div>
            </div>`;
        }

        function handleLWSwapClick(playerId) {
            if (!lineupState.swapSource) {
                // First click: select source
                lineupState.swapSource = playerId;
                renderLineupStep2Content();
                return;
            }

            if (lineupState.swapSource === playerId) {
                // Clicked same player: cancel swap
                lineupState.swapSource = null;
                renderLineupStep2Content();
                return;
            }

            // Second click: attempt swap
            const srcId = lineupState.swapSource;
            const tgtId = playerId;
            lineupState.swapSource = null;

            const xiIds = new Set(lineupState.xi.map(p => p.id));
            const benchIds = new Set(lineupState.bench.map(p => p.id));
            const srcInXI = xiIds.has(srcId);
            const tgtInXI = xiIds.has(tgtId);

            // Find player objects
            const allPool = [...lineupState.xi, ...lineupState.bench];
            const srcPlayer = allPool.find(p => p.id === srcId);
            const tgtPlayer = allPool.find(p => p.id === tgtId);
            if (!srcPlayer || !tgtPlayer) return;

            // Perform swap
            let newXI, newBench;
            if (srcInXI && tgtInXI) {
                // Both in XI: just swap positions (no formation change)
                newXI = lineupState.xi;
                newBench = lineupState.bench;
            } else if (!srcInXI && !tgtInXI) {
                // Both on bench: swap bench order
                newXI = lineupState.xi;
                newBench = lineupState.bench;
                const si = newBench.findIndex(p => p.id === srcId);
                const ti = newBench.findIndex(p => p.id === tgtId);
                [newBench[si], newBench[ti]] = [newBench[ti], newBench[si]];
            } else {
                // One in XI, one on bench: validate formation
                const xiPlayer = srcInXI ? srcPlayer : tgtPlayer;
                const benchPlayer = srcInXI ? tgtPlayer : srcPlayer;

                // Build new XI with swap
                newXI = lineupState.xi.map(p => p.id === xiPlayer.id ? benchPlayer : p);
                newBench = lineupState.bench.map(p => p.id === benchPlayer.id ? xiPlayer : p);

                // Check formation validity
                if (!isValidLWFormation(newXI)) {
                    // Invalid swap — revert
                    renderLineupStep2Content();
                    return;
                }
            }

            lineupState.xi = newXI;
            lineupState.bench = newBench;
            lineupState.formation = getFormationString(lineupState.xi);
            renderLineupStep2Content();
        }

        function isValidLWFormation(xi) {
            const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
            xi.forEach(p => { counts[p.pos] = (counts[p.pos] || 0) + 1; });
            if (counts[1] !== 1) return false;
            if (counts[2] < 3 || counts[2] > 5) return false;
            if (counts[3] < 2 || counts[3] > 5) return false;
            if (counts[4] < 1 || counts[4] > 3) return false;
            if (counts[2] + counts[3] + counts[4] !== 10) return false;
            return true;
        }

        function getFormationString(xi) {
            const counts = { 2: 0, 3: 0, 4: 0 };
            xi.forEach(p => { if (p.pos >= 2) counts[p.pos]++; });
            return `${counts[2]}-${counts[3]}-${counts[4]}`;
        }

        function resetLineupToOptimal() {
            const available = lineupState.squad.filter(p => !lineupState.excluded.has(p.id));
            available.forEach(p => { p.lwScore = computeQuickLineupScore(p); });
            const solution = solveQuickLineup(available);
            lineupState.xi = [...solution.xi];
            lineupState.bench = [...solution.bench];
            lineupState.formation = solution.formation;
            lineupState.swapSource = null;
            renderLineupStep2Content();
        }

        // ── STEP 3: Captain & Summary ──
        function renderLineupStep3() {
            const panel = document.getElementById('lwPanel3');
            const xi = lineupState.xi;

            // Auto-pick captain if not set
            if (!lineupState.captain) {
                const candidates = xi.filter(p => p.pos !== 1).sort((a, b) => b.lwScore - a.lwScore);
                lineupState.captain = candidates[0]?.id || xi[0]?.id;
                lineupState.viceCaptain = candidates[1]?.id || xi[1]?.id;
            }

            renderLineupStep3Content();
        }

        function renderLineupStep3Content() {
            const panel = document.getElementById('lwPanel3');
            const xi = lineupState.xi;
            const bench = lineupState.bench;

            // Captain candidates — top outfield players by score
            const capCandidates = xi.filter(p => p.pos !== 1).sort((a, b) => b.lwScore - a.lwScore).slice(0, 5);

            let html = `<div style="font-size:18px;font-weight:700;font-family:var(--font-display);margin-bottom:16px;"><i data-lucide="crown" style="width:18px;height:18px;display:inline;vertical-align:middle;"></i> Captain Selection</div>`;
            html += `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:16px;">Pick your captain (2x points) and vice-captain (backup). Ranked by lineup score.</div>`;

            capCandidates.forEach((p, i) => {
                const isCap = lineupState.captain === p.id;
                const isVC = lineupState.viceCaptain === p.id;
                const posNames = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
                const posColors = { 1: '#D97706', 2: '#059669', 3: '#2563EB', 4: '#DC2626' };
                const fx = p.fixtures?.[0];
                const recent = getPlayerRecentStats(p.id, 5);
                const xgi = recent ? recent.xGIPer90.toFixed(2) : (p.minutes > 0 ? ((p.xGI / p.minutes) * 90).toFixed(2) : '0.00');

                html += `<div class="lw-captain-card ${isCap ? 'selected-captain' : isVC ? 'selected-vc' : ''}">
                    <div class="lw-captain-rank" style="background:${i === 0 ? 'rgba(245,158,11,0.15);color:#F59E0B' : i === 1 ? 'rgba(156,163,175,0.15);color:#9CA3AF' : i === 2 ? 'rgba(217,119,6,0.15);color:#D97706' : 'var(--surface-3);color:var(--text-muted)'}">${i + 1}</div>
                    <div style="padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;background:${posColors[p.pos]}22;color:${posColors[p.pos]};">${posNames[p.pos]}</div>
                    <div class="lw-captain-info">
                        <div class="lw-captain-name">${escHTML(p.web_name)}</div>
                        <div class="lw-captain-meta">
                            <span>${escHTML(p.team)}</span>
                            <span>Form ${p.form}</span>
                            <span>xGI/90 ${xgi}</span>
                            ${fx ? `<span class="fixture-chip fdr-${fx.difficulty}" style="font-size:10px;padding:1px 5px;">${escHTML(fx.opponent)}(${fx.isHome ? 'H' : 'A'})</span>` : ''}
                        </div>
                    </div>
                    <div style="font-family:var(--font-mono);font-weight:700;font-size:14px;color:${p.lwScore >= 30 ? 'var(--color-success)' : 'var(--text-primary)'}">${p.lwScore}</div>
                    <div class="lw-captain-actions">
                        <button class="lw-cap-btn ${isCap ? 'active-c' : ''}" onclick="event.stopPropagation();setLWCaptain(${p.id})">C</button>
                        <button class="lw-cap-btn ${isVC ? 'active-vc' : ''}" onclick="event.stopPropagation();setLWViceCaptain(${p.id})">VC</button>
                    </div>
                </div>`;
            });

            // ── Final Summary ──
            html += `<div style="margin-top:24px;font-size:18px;font-weight:700;font-family:var(--font-display);margin-bottom:16px;"><i data-lucide="check-circle" style="width:18px;height:18px;display:inline;vertical-align:middle;"></i> Recommended Lineup Summary</div>`;

            // Formation + captain display
            const capPlayer = lineupState.squad.find(p => p.id === lineupState.captain);
            const vcPlayer = lineupState.squad.find(p => p.id === lineupState.viceCaptain);
            html += `<div class="lw-final-section">
                <div style="display:flex;gap:24px;flex-wrap:wrap;">
                    <div><span style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Formation</span><div style="font-size:24px;font-weight:700;font-family:var(--font-mono);">${lineupState.formation}</div></div>
                    <div><span style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Captain</span><div style="font-size:16px;font-weight:700;color:#F59E0B;"><i data-lucide="crown" style="width:14px;height:14px;display:inline;vertical-align:middle;"></i> ${capPlayer?.web_name || '-'}</div></div>
                    <div><span style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Vice-Captain</span><div style="font-size:16px;font-weight:700;color:#9CA3AF;">${vcPlayer?.web_name || '-'}</div></div>
                    <div><span style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Total Score</span><div style="font-size:24px;font-weight:700;font-family:var(--font-mono);color:var(--color-success);">${xi.reduce((s, p) => s + p.lwScore, 0)}</div></div>
                </div>
            </div>`;

            // Mini pitch
            const gk = xi.filter(p => p.pos === 1);
            const defs = xi.filter(p => p.pos === 2);
            const mids = xi.filter(p => p.pos === 3);
            const fwds = xi.filter(p => p.pos === 4);

            html += `<div class="lw-pitch" style="margin-bottom:16px;">`;
            html += `<div class="lw-pitch-row">${fwds.map(p => renderLWSummaryPitchPlayer(p)).join('')}</div>`;
            html += `<div class="lw-pitch-row">${mids.map(p => renderLWSummaryPitchPlayer(p)).join('')}</div>`;
            html += `<div class="lw-pitch-row">${defs.map(p => renderLWSummaryPitchPlayer(p)).join('')}</div>`;
            html += `<div class="lw-pitch-row">${gk.map(p => renderLWSummaryPitchPlayer(p)).join('')}</div>`;
            html += `</div>`;

            // Bench
            html += `<div class="lw-bench-section" style="margin-bottom:16px;">`;
            html += `<div class="lw-bench-header"><i data-lucide="clipboard-list" style="width:14px;height:14px;display:inline;vertical-align:middle;"></i> Bench Order</div>`;
            html += `<div class="lw-bench-row">${bench.map((p, i) => {
                const posNames = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
                const posColors = { 1: '#D97706', 2: '#059669', 3: '#2563EB', 4: '#DC2626' };
                return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;min-width:72px;max-width:90px;opacity:0.6;position:relative;">
                    <div style="position:absolute;top:-4px;right:-4px;width:16px;height:16px;border-radius:50%;background:var(--surface-3);color:var(--text-muted);font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);">${i + 1}</div>
                    <div class="lw-pitch-node" style="background:rgba(0,0,0,0.2);border:2px solid ${posColors[p.pos]};color:${posColors[p.pos]};">${jerseyNumberLabel(p)}</div>
                    <div class="lw-pitch-name">${escHTML(p.web_name)}</div>
                </div>`;
            }).join('')}</div>`;
            html += `</div>`;

            // Vs current: show changes
            html += renderLWChanges();

            // Actions
            html += `<div class="tw-actions">
                <button class="tw-btn tw-btn-back" onclick="goToLineupStep(2)"><i data-lucide="arrow-left" style="width:14px;height:14px;"></i> Edit Lineup</button>
                <button class="tw-btn tw-btn-secondary" onclick="goToLineupStep(1)"><i data-lucide="rotate-ccw" style="width:14px;height:14px;"></i> Start Over</button>
            </div>`;

            panel.innerHTML = html;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        function renderLWSummaryPitchPlayer(p) {
            const posNames = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
            const posColors = { 1: '#D97706', 2: '#059669', 3: '#2563EB', 4: '#DC2626' };
            const bg = { 1: 'rgba(217,119,6,0.2)', 2: 'rgba(5,150,105,0.2)', 3: 'rgba(37,99,235,0.2)', 4: 'rgba(220,38,38,0.2)' };
            const isCap = lineupState.captain === p.id;
            const isVC = lineupState.viceCaptain === p.id;

            return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;min-width:72px;max-width:90px;position:relative;">
                ${isCap ? '<div style="position:absolute;top:-6px;right:-2px;font-size:12px;"><i data-lucide="crown" style="width:12px;height:12px;color:#F59E0B;"></i></div>' : ''}
                ${isVC ? '<div style="position:absolute;top:-6px;right:-2px;font-size:10px;color:#9CA3AF;font-weight:700;">VC</div>' : ''}
                <div class="lw-pitch-node" style="background:${bg[p.pos]};border:2px solid ${posColors[p.pos]};color:${posColors[p.pos]};${isCap ? 'box-shadow:0 0 8px rgba(245,158,11,0.5);' : ''}">${jerseyNumberLabel(p)}</div>
                <div class="lw-pitch-name">${escHTML(p.web_name)}</div>
            </div>`;
        }

        function renderLWChanges() {
            const xi = lineupState.xi;
            const xiIds = new Set(xi.map(p => p.id));
            const origIds = lineupState.originalXIIds;
            const changes = [];

            // Players promoted from bench to XI
            xi.forEach(p => {
                if (!origIds.has(p.id)) {
                    changes.push({ player: p, type: 'promoted', label: 'Promoted to XI' });
                }
            });

            // Players moved to bench from XI
            lineupState.bench.forEach(p => {
                if (origIds.has(p.id)) {
                    changes.push({ player: p, type: 'benched', label: 'Moved to bench' });
                }
            });

            // Captain changes
            if (lineupState.captain !== lineupState.originalCaptain) {
                const capP = lineupState.squad.find(p => p.id === lineupState.captain);
                if (capP) changes.push({ player: capP, type: 'captain', label: 'New Captain' });
            }
            if (lineupState.viceCaptain !== lineupState.originalVC) {
                const vcP = lineupState.squad.find(p => p.id === lineupState.viceCaptain);
                if (vcP) changes.push({ player: vcP, type: 'captain', label: 'New Vice-Captain' });
            }

            if (changes.length === 0) {
                return `<div class="lw-final-section"><div class="lw-final-header"><i data-lucide="check-circle" style="width:16px;height:16px;color:var(--color-success);"></i> No Changes</div><div style="font-size:12px;color:var(--text-secondary);">Your current FPL lineup matches the optimal recommendation.</div></div>`;
            }

            let html = `<div class="lw-final-section"><div class="lw-final-header"><i data-lucide="git-compare" style="width:16px;height:16px;color:#A78BFA;"></i> Changes vs Current FPL Lineup (${changes.length})</div>`;
            changes.forEach(c => {
                const posNames = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
                html += `<div class="lw-change-row">
                    <span class="lw-change-badge ${c.type}">${c.type === 'promoted' ? '↑ IN' : c.type === 'benched' ? '↓ OUT' : '👑'}</span>
                    <span style="font-weight:600;">${escHTML(c.player.web_name)}</span>
                    <span style="font-size:11px;color:var(--text-muted);">${posNames[c.player.pos]} · ${escHTML(c.player.team)}</span>
                    <span style="flex:1;"></span>
                    <span style="font-size:11px;color:var(--text-secondary);">${c.label}</span>
                </div>`;
            });
            html += `</div>`;
            return html;
        }

        function setLWCaptain(playerId) {
            if (lineupState.viceCaptain === playerId) lineupState.viceCaptain = lineupState.captain;
            lineupState.captain = playerId;
            renderLineupStep3Content();
        }

        function setLWViceCaptain(playerId) {
            if (lineupState.captain === playerId) lineupState.captain = lineupState.viceCaptain;
            lineupState.viceCaptain = playerId;
            renderLineupStep3Content();
        }

        // Quick lineup scoring — simplified version for inline tab
        function computeQuickLineupScore(p) {
            if (p.status === 'i' || p.status === 'u' || p.status === 's') return -100;
            let score = 0;
            if (p.status === 'd') score -= 20;
            // EP
            score += (p.epNext || 0) * 3;
            // Form (preseason: FPL resets form to 0.0, fall back to last season's PPG —
            // same pattern as analyzePlayer's effectiveForm)
            const effectiveForm = isPreseason ? (p.ppg || 0) : (parseFloat(p.form) || 0);
            score += effectiveForm * 2;
            // Fixtures
            const fx = p.fixtures || [];
            if (fx.length > 0) { score += (3 - fx[0].difficulty) * 5; if (fx[0].isHome) score += 2; }
            // xGI
            const mins = p.minutes || 0;
            if (mins > 200) { const xgi90 = (p.xGI / mins) * 90; score += xgi90 * 10; }
            // Minutes (computePlayerGamesPlayed already handles the preseason case —
            // last season's starts/minutes instead of dividing by 0 completed GWs)
            const mpg = mins / computePlayerGamesPlayed(p);
            if (mpg >= 85) score += 3;
            else if (mpg < 45) score -= 5;
            // PPG — FPL's own points-per-game, already correct pre- and in-season
            score += (p.ppg || 0) * 1.5;
            return Math.round(score);
        }

        function solveQuickLineup(squad) {
            const validFormations = [[3,4,3],[3,5,2],[4,3,3],[4,4,2],[4,5,1],[5,3,2],[5,4,1],[5,2,3]];
            const byPos = { 1: [], 2: [], 3: [], 4: [] };
            squad.forEach(p => { if (p.lwScore > -100) byPos[p.pos].push(p); });
            Object.values(byPos).forEach(a => a.sort((a, b) => b.lwScore - a.lwScore));
            let bestFormation = null, bestScore = -Infinity, bestXI = null;
            const formationScores = [];
            for (const [nD, nM, nF] of validFormations) {
                if (byPos[1].length < 1 || byPos[2].length < nD || byPos[3].length < nM || byPos[4].length < nF) continue;
                const xi = [byPos[1][0], ...byPos[2].slice(0, nD), ...byPos[3].slice(0, nM), ...byPos[4].slice(0, nF)];
                const total = xi.reduce((s, p) => s + p.lwScore, 0);
                formationScores.push({ formation: `${nD}-${nM}-${nF}`, total });
                if (total > bestScore) { bestScore = total; bestFormation = `${nD}-${nM}-${nF}`; bestXI = xi; }
            }
            formationScores.sort((a, b) => b.total - a.total);
            if (!bestXI) { const av = squad.filter(p => p.lwScore > -100).sort((a, b) => b.lwScore - a.lwScore); bestXI = av.slice(0, 11); bestFormation = 'N/A'; }
            const xiIds = new Set(bestXI.map(p => p.id));
            const bench = squad.filter(p => !xiIds.has(p.id)).sort((a, b) => { if (a.pos === 1 && b.pos !== 1) return 1; if (b.pos === 1 && a.pos !== 1) return -1; return b.lwScore - a.lwScore; });
            return { xi: bestXI, bench, formation: bestFormation, formationScores };
        }

        // ── LINEUP WIZARD: Detailed Score Breakdown ──
        function computeQuickLineupScoreDetailed(p) {
            const result = { total: 0, ep: 0, form: 0, fixture: 0, home: 0, xgi: 0, minutes: 0, ppg: 0, doubtful: 0, matchup: 0 };
            if (p.status === 'i' || p.status === 'u' || p.status === 's') { result.total = -100; return result; }
            if (p.status === 'd') result.doubtful = -20;
            result.ep = Math.round((p.epNext || 0) * 3 * 10) / 10;
            // Preseason: FPL resets form to 0.0, fall back to last season's PPG —
            // same pattern as analyzePlayer's effectiveForm
            const effectiveForm = isPreseason ? (p.ppg || 0) : (parseFloat(p.form) || 0);
            result.form = Math.round(effectiveForm * 2 * 10) / 10;
            const fx = p.fixtures || [];
            if (fx.length > 0) { result.fixture = Math.round((3 - fx[0].difficulty) * 5 * 10) / 10; if (fx[0].isHome) result.home = 2; }
            const mins = p.minutes || 0;
            if (mins > 200) { result.xgi = Math.round(((p.xGI / mins) * 90) * 10 * 10) / 10; }
            // computePlayerGamesPlayed already handles the preseason case — last
            // season's starts/minutes instead of dividing by 0 completed GWs
            const mpg = mins / computePlayerGamesPlayed(p);
            if (mpg >= 85) result.minutes = 3;
            else if (mpg < 45) result.minutes = -5;
            // FPL's own points-per-game — already correct pre- and in-season, unlike
            // dividing the raw season total by (currentGW - 1), which blows up to
            // hundreds of "points" during preseason when currentGW - 1 is 0.
            result.ppg = Math.round((p.ppg || 0) * 1.5 * 10) / 10;
            // Team Attack/Defense power vs. the next opponent's respective rating — the
            // explicit team-context matchup factor section 9 asks for, on top of the
            // generic FDR-based `fixture` term above. Same teamAnalysis data already used
            // everywhere else on this page (detail panel, calculateTransferScore, etc.).
            if (fx.length > 0 && fx[0].opponentId && teamAnalysis[fx[0].opponentId]) {
                const opp = teamAnalysis[fx[0].opponentId];
                const relevantOppPower = (p.position <= 2) ? (opp.attackPower || 50) : (opp.defensePower || 50);
                result.matchup = Math.round(((50 - relevantOppPower) / 50) * 6 * 10) / 10;
            }
            result.total = Math.round(result.ep + result.form + result.fixture + result.home + result.xgi + result.minutes + result.ppg + result.doubtful + result.matchup);
            return result;
        }

        // ── LINEUP WIZARD: Context Panel Rendering ──
        function renderLWContextEmpty() {
            return `<div class="lw-ctx-panel">
                <div class="lw-ctx-empty">
                    <div class="lw-ctx-empty-icon"><i data-lucide="mouse-pointer-click" style="width:32px;height:32px;"></i></div>
                    <div style="font-weight:600;margin-bottom:4px;">Player Intel Panel</div>
                    <div>Click any player to view deep stats & score breakdown.<br>Click two to compare side-by-side.</div>
                </div>
            </div>`;
        }

        function renderLWContextPanel() {
            const sel = lineupState.selectedPlayers;
            if (!sel || sel.length === 0) return renderLWContextEmpty();
            if (sel.length === 1) return renderLWContextSingle(sel[0]);
            return renderLWContextCompare(sel[0], sel[1]);
        }

        function renderLWContextSingle(playerId) {
            const p = lineupState.squad.find(x => x.id === playerId);
            if (!p) return renderLWContextEmpty();
            const posNames = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
            const posColors = { 1: '#D97706', 2: '#059669', 3: '#2563EB', 4: '#DC2626' };
            const detailed = computeQuickLineupScoreDetailed(p);
            const ta = teamAnalysis[p.teamId];
            const fx = p.fixtures || [];
            const gamesPlayed = Math.max(currentGW - 1, 1);
            const xGIPer90 = p.minutes > 0 ? ((p.xGI / p.minutes) * 90) : 0;
            const mpg = (p.minutes || 0) / gamesPlayed;

            // Score bar helper
            function scoreBar(label, value, maxVal, color) {
                const pct = Math.min(Math.max(Math.abs(value) / maxVal * 100, 0), 100);
                const isNeg = value < 0;
                return `<div class="lw-ctx-score-row">
                    <div class="lw-ctx-score-label">${label}</div>
                    <div class="lw-ctx-score-bar"><div class="lw-ctx-score-bar-fill" style="width:${pct}%;background:${isNeg ? 'var(--color-error)' : color};"></div></div>
                    <div class="lw-ctx-score-val" style="color:${isNeg ? 'var(--color-error)' : value > 0 ? color : 'var(--text-muted)'}">${value > 0 ? '+' : ''}${value.toFixed(1)}</div>
                </div>`;
            }

            let html = `<div class="lw-ctx-panel">`;
            // Header
            html += `<div class="lw-ctx-header">
                <span style="padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;background:${posColors[p.pos]}22;color:${posColors[p.pos]};">${posNames[p.pos]}</span>
                <div class="lw-ctx-header-name">${escHTML(p.web_name)}</div>
                <span style="font-size:11px;color:var(--text-muted);">${escHTML(p.team)} · £${p.price.toFixed(1)}m</span>
                <button class="lw-ctx-header-close" onclick="lineupState.selectedPlayers=[];updateLWContextPanel();">✕</button>
            </div>`;

            html += `<div class="lw-ctx-body">`;

            // AI Score Breakdown
            html += `<div class="lw-ctx-section">`;
            html += `<div class="lw-ctx-section-title"><i data-lucide="brain" style="width:12px;height:12px;display:inline;vertical-align:middle;"></i> AI Score Breakdown</div>`;
            html += `<div style="text-align:center;margin-bottom:10px;"><span style="font-family:var(--font-mono);font-size:24px;font-weight:700;color:${p.lwScore >= 30 ? 'var(--color-success)' : p.lwScore >= 10 ? '#F59E0B' : 'var(--color-error)'};">${p.lwScore}</span><span style="font-size:11px;color:var(--text-muted);margin-left:4px;">pts</span></div>`;
            html += scoreBar('Exp Pts', detailed.ep, 15, 'var(--color-info)');
            html += scoreBar('Form', detailed.form, 15, '#A78BFA');
            html += scoreBar('Fixture', detailed.fixture, 10, 'var(--color-success)');
            html += scoreBar('Home', detailed.home, 2, '#F59E0B');
            html += scoreBar('xGI/90', detailed.xgi, 10, '#EC4899');
            html += scoreBar('Minutes', detailed.minutes, 5, '#06B6D4');
            html += scoreBar('PPG', detailed.ppg, 10, '#8B5CF6');
            if (detailed.doubtful !== 0) html += scoreBar('Doubtful', detailed.doubtful, 20, 'var(--color-error)');
            html += `</div>`;

            // Next 3 Fixtures
            if (fx.length > 0) {
                html += `<div class="lw-ctx-section">`;
                html += `<div class="lw-ctx-section-title"><i data-lucide="calendar" style="width:12px;height:12px;display:inline;vertical-align:middle;"></i> Next Fixtures</div>`;
                html += `<div class="lw-ctx-fixtures-strip">`;
                fx.slice(0, 5).forEach(f => {
                    html += `<div class="lw-ctx-fixture-chip">
                        <span class="fdr-dot fdr-${f.difficulty}"></span>
                        <span>${escHTML(f.opponent)}</span>
                        <span style="font-size:9px;color:var(--text-muted);">${f.isHome ? 'H' : 'A'}</span>
                    </div>`;
                });
                html += `</div></div>`;
            }

            // Season Stats
            html += `<div class="lw-ctx-section">`;
            html += `<div class="lw-ctx-section-title"><i data-lucide="bar-chart-3" style="width:12px;height:12px;display:inline;vertical-align:middle;"></i> Season Stats</div>`;
            html += `<div class="lw-ctx-stat-grid">`;
            html += `<div class="lw-ctx-stat-box"><div class="lw-ctx-stat-box-val">${p.form}</div><div class="lw-ctx-stat-box-label">Form</div></div>`;
            html += `<div class="lw-ctx-stat-box"><div class="lw-ctx-stat-box-val">${(p.points / gamesPlayed).toFixed(1)}</div><div class="lw-ctx-stat-box-label">PPG</div></div>`;
            html += `<div class="lw-ctx-stat-box"><div class="lw-ctx-stat-box-val">${xGIPer90.toFixed(2)}</div><div class="lw-ctx-stat-box-label">xGI/90</div></div>`;
            if (p.pos >= 3) {
                html += `<div class="lw-ctx-stat-box"><div class="lw-ctx-stat-box-val">${p.goals}</div><div class="lw-ctx-stat-box-label">Goals</div></div>`;
                html += `<div class="lw-ctx-stat-box"><div class="lw-ctx-stat-box-val">${p.assists}</div><div class="lw-ctx-stat-box-label">Assists</div></div>`;
            } else {
                html += `<div class="lw-ctx-stat-box"><div class="lw-ctx-stat-box-val">${p.cleanSheets}</div><div class="lw-ctx-stat-box-label">CS</div></div>`;
                html += `<div class="lw-ctx-stat-box"><div class="lw-ctx-stat-box-val">${p.pos === 1 ? p.saves : p.goals}</div><div class="lw-ctx-stat-box-label">${p.pos === 1 ? 'Saves' : 'Goals'}</div></div>`;
            }
            html += `<div class="lw-ctx-stat-box"><div class="lw-ctx-stat-box-val">${mpg.toFixed(0)}</div><div class="lw-ctx-stat-box-label">Min/G</div></div>`;
            html += `<div class="lw-ctx-stat-box"><div class="lw-ctx-stat-box-val">${p.bonus}</div><div class="lw-ctx-stat-box-label">Bonus</div></div>`;
            html += `<div class="lw-ctx-stat-box"><div class="lw-ctx-stat-box-val">${p.ictIndex.toFixed(0)}</div><div class="lw-ctx-stat-box-label">ICT</div></div>`;
            html += `<div class="lw-ctx-stat-box"><div class="lw-ctx-stat-box-val">${(p.epNext || 0).toFixed(1)}</div><div class="lw-ctx-stat-box-label">EP Next</div></div>`;
            html += `</div></div>`;

            // Team Context
            if (ta) {
                html += `<div class="lw-ctx-section">`;
                html += `<div class="lw-ctx-section-title"><i data-lucide="shield" style="width:12px;height:12px;display:inline;vertical-align:middle;"></i> Team Context — ${escHTML(p.team)}</div>`;
                function pw(v) { return v > 60 ? 'var(--color-success)' : v < 40 ? 'var(--color-error)' : 'var(--text-secondary)'; }
                html += `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">`;
                html += `<div class="lw-ctx-stat-box"><div class="lw-ctx-stat-box-val" style="color:${pw(ta.attackPower)}">${ta.attackPower}</div><div class="lw-ctx-stat-box-label">ATK</div></div>`;
                html += `<div class="lw-ctx-stat-box"><div class="lw-ctx-stat-box-val" style="color:${pw(ta.defensePower)}">${ta.defensePower}</div><div class="lw-ctx-stat-box-label">DEF</div></div>`;
                html += `<div class="lw-ctx-stat-box"><div class="lw-ctx-stat-box-val" style="color:${pw(ta.formRating)}">${ta.formRating}</div><div class="lw-ctx-stat-box-label">Form</div></div>`;
                html += `<div class="lw-ctx-stat-box"><div class="lw-ctx-stat-box-val" style="color:${pw(ta.fixtureScore)}">${ta.fixtureScore}</div><div class="lw-ctx-stat-box-label">Fix</div></div>`;
                html += `</div></div>`;
            }

            // Routes to Points
            html += lwBuildSingleRoutes(p);
            // Rising Form Signals
            html += lwBuildSingleRisingForm(p);
            // Home/Away Splits
            html += lwBuildSingleSplits(p);
            // xG Regression
            html += lwBuildSingleXgRegression(p);

            html += `</div></div>`;
            return html;
        }

        // ── LW Intel: Routes to Points (single) ──
        function lwBuildSingleRoutes(p) {
            const pos = p.pos || p.position;
            const seasonGames = Math.max(currentGW - 1, 1);
            const recent = getPlayerRecentStats(p.id, 5);
            const rg = recent?.games || 1;
            const blend = (rVal, sVal, sDivisor) => ((rVal || 0) / rg) * 0.6 + ((sVal || 0) / sDivisor) * 0.4;
            const xGpg = blend(recent?.xG, p.xG, seasonGames);
            const xApg = blend(recent?.xA, p.xA, seasonGames);
            const goalsPg = blend(recent?.goals, p.goals, seasonGames);
            const csPg = blend(recent?.cs, p.cleanSheets, seasonGames);
            const bonusPg = blend(recent?.bonus, p.bonus, seasonGames);
            const savesPg = pos === 1 ? blend(recent?.saves, p.saves, seasonGames) : 0;
            const goalThresh = { 1: 0.03, 2: 0.06, 3: 0.12, 4: 0.15 }[pos] || 0.1;
            const assistThresh = { 1: 0.02, 2: 0.06, 3: 0.10, 4: 0.08 }[pos] || 0.08;
            const csThresh = { 1: 0.15, 2: 0.15, 3: 0.30, 4: 999 }[pos] || 0.2;
            const bonusThresh = { 1: 0.3, 2: 0.3, 3: 0.4, 4: 0.5 }[pos] || 0.3;
            const routes = [];
            if (xGpg >= goalThresh || goalsPg >= goalThresh * 1.5) { const c = pos === 4 ? 0.6 : pos === 3 ? 0.5 : 0.3; routes.push({ name: 'Goals', str: Math.min(100, (xGpg / c) * 100), detail: xGpg.toFixed(2) + ' xG/g', color: '#F87171' }); }
            if (xApg >= assistThresh) { const c = pos === 3 ? 0.4 : 0.3; routes.push({ name: 'Assists', str: Math.min(100, (xApg / c) * 100), detail: xApg.toFixed(2) + ' xA/g', color: '#60A5FA' }); }
            if (csPg >= csThresh) routes.push({ name: 'Clean Sheets', str: Math.min(100, (csPg / 0.55) * 100), detail: (csPg * 100).toFixed(0) + '% rate', color: '#34D399' });
            if (bonusPg >= bonusThresh) routes.push({ name: 'Bonus', str: Math.min(100, (bonusPg / 2) * 100), detail: bonusPg.toFixed(1) + '/g', color: '#FBBF24' });
            if (pos === 1 && savesPg >= 2) routes.push({ name: 'Saves', str: Math.min(100, (savesPg / 5) * 100), detail: savesPg.toFixed(1) + '/g', color: '#A78BFA' });
            if (routes.length === 0) return '';
            let h = '<div class="lw-ctx-section"><div class="lw-ctx-section-title"><i data-lucide="route" style="width:12px;height:12px;display:inline;vertical-align:middle;"></i> Routes to Points (' + routes.length + ')</div>';
            routes.forEach(r => {
                h += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">' +
                    '<span style="font-size:10px;width:65px;flex-shrink:0;color:var(--text-muted);">' + r.name + '</span>' +
                    '<div style="flex:1;height:6px;background:var(--surface-3);border-radius:3px;overflow:hidden;"><div style="height:100%;width:' + r.str + '%;background:' + r.color + ';border-radius:3px;"></div></div>' +
                    '<span style="font-size:10px;font-family:var(--font-mono);color:var(--text-secondary);width:55px;text-align:right;">' + r.detail + '</span></div>';
            });
            h += '</div>';
            return h;
        }

        // ── LW Intel: Rising Form Signals (single) ──
        function lwBuildSingleRisingForm(p) {
            const ta = teamAnalysis[p.teamId] || {};
            const swing = fixtureSwingData[p.teamId] || {};
            const ss = seasonStats[p.teamId] || {};
            const txg = teamXgData[p.teamId] || {};
            const signals = [];
            if (ta.formRating > 55) signals.push({ label: 'Team in Form', value: (ss.last5 || ta.formRating + ' rating'), positive: true });
            if (txg.recentXgPg && txg.seasonXgPg && txg.recentXgPg > txg.seasonXgPg * 1.05) signals.push({ label: 'xG Rising', value: '+' + ((txg.recentXgPg - txg.seasonXgPg) * 100 / txg.seasonXgPg).toFixed(0) + '%', positive: true });
            if (txg.recentXgcPg && txg.seasonXgcPg && txg.recentXgcPg < txg.seasonXgcPg * 0.95) signals.push({ label: 'xGC Improving', value: ((txg.seasonXgcPg - txg.recentXgcPg) * 100 / txg.seasonXgcPg).toFixed(0) + '%', positive: true });
            if (swing.direction === 'improving') signals.push({ label: 'Fixtures ↑', value: 'Swing +' + (swing.magnitude || ''), positive: true });
            else if (swing.direction === 'worsening') signals.push({ label: 'Fixtures ↓', value: 'Swing -' + (swing.magnitude || ''), positive: false });
            if ((ta.avgFdr || 3) <= 2.5) signals.push({ label: 'Easy Run', value: 'FDR ' + (ta.avgFdr || 3).toFixed(1), positive: true });
            if (signals.length === 0) return '';
            let h = '<div class="lw-ctx-section"><div class="lw-ctx-section-title"><i data-lucide="trending-up" style="width:12px;height:12px;display:inline;vertical-align:middle;"></i> Rising Form Signals</div>';
            signals.forEach(s => {
                h += '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11px;">' +
                    '<span style="color:' + (s.positive ? 'var(--color-success)' : 'var(--color-error)') + ';">' + (s.positive ? '▲' : '▼') + '</span>' +
                    '<span style="font-weight:600;">' + s.label + '</span>' +
                    '<span style="color:var(--text-muted);margin-left:auto;font-family:var(--font-mono);font-size:10px;">' + s.value + '</span></div>';
            });
            h += '</div>';
            return h;
        }

        // ── LW Intel: Home/Away Splits (single) ──
        function lwBuildSingleSplits(p) {
            if (!playersDetailData || !playersDetailData.players) return '';
            const pd = playersDetailData.players.find(x => x.id === p.id);
            if (!pd || !pd.history) return '';
            const played = pd.history.filter(h => h.minutes > 0);
            const home = played.filter(h => h.was_home);
            const away = played.filter(h => !h.was_home);
            if (home.length < 2 && away.length < 2) return '';
            function avg(arr, key) { return arr.length > 0 ? (arr.reduce((s, h) => s + (parseFloat(h[key]) || 0), 0) / arr.length) : 0; }
            const hPts = avg(home, 'total_points'), aPts = avg(away, 'total_points');
            const hXgi = avg(home, 'expected_goal_involvements'), aXgi = avg(away, 'expected_goal_involvements');
            const hBonus = avg(home, 'bonus'), aBonus = avg(away, 'bonus');
            let h = '<div class="lw-ctx-section"><div class="lw-ctx-section-title"><i data-lucide="home" style="width:12px;height:12px;display:inline;vertical-align:middle;"></i> Home vs Away</div>';
            h += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
            h += '<tr style="color:var(--text-muted);"><th style="text-align:left;padding:3px 4px;"></th><th style="padding:3px 4px;">Home (' + home.length + 'g)</th><th style="padding:3px 4px;">Away (' + away.length + 'g)</th></tr>';
            h += '<tr><td style="padding:3px 4px;color:var(--text-muted);">PPG</td><td style="padding:3px 4px;text-align:center;font-family:var(--font-mono);color:' + (hPts > aPts ? 'var(--color-success)' : '') + '">' + hPts.toFixed(1) + '</td><td style="padding:3px 4px;text-align:center;font-family:var(--font-mono);color:' + (aPts > hPts ? 'var(--color-success)' : '') + '">' + aPts.toFixed(1) + '</td></tr>';
            h += '<tr><td style="padding:3px 4px;color:var(--text-muted);">xGI/g</td><td style="padding:3px 4px;text-align:center;font-family:var(--font-mono);">' + hXgi.toFixed(2) + '</td><td style="padding:3px 4px;text-align:center;font-family:var(--font-mono);">' + aXgi.toFixed(2) + '</td></tr>';
            h += '<tr><td style="padding:3px 4px;color:var(--text-muted);">Bonus/g</td><td style="padding:3px 4px;text-align:center;font-family:var(--font-mono);">' + hBonus.toFixed(1) + '</td><td style="padding:3px 4px;text-align:center;font-family:var(--font-mono);">' + aBonus.toFixed(1) + '</td></tr>';
            h += '</table></div>';
            return h;
        }

        // ── LW Intel: xG Regression (single) ──
        function lwBuildSingleXgRegression(p) {
            const goals = p.goals || 0;
            const xG = p.xG || 0;
            const diff = goals - xG;
            if (Math.abs(diff) < 0.5) return '';
            const label = diff > 1 ? 'Overperforming' : diff < -1 ? 'Underperforming' : 'In line';
            const color = diff > 2 ? 'var(--color-warning)' : diff < -2 ? 'var(--color-success)' : 'var(--text-secondary)';
            return '<div class="lw-ctx-section"><div class="lw-ctx-section-title"><i data-lucide="refresh-cw" style="width:12px;height:12px;display:inline;vertical-align:middle;"></i> xG Regression</div>' +
                '<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;"><span>Goals: ' + goals + '</span><span>xG: ' + xG.toFixed(1) + '</span><span style="color:' + color + ';font-weight:600;">' + label + ' (' + (diff >= 0 ? '+' : '') + diff.toFixed(1) + ')</span></div></div>';
        }

        function renderLWContextCompare(id1, id2) {
            const p1 = lineupState.squad.find(x => x.id === id1);
            const p2 = lineupState.squad.find(x => x.id === id2);
            if (!p1 || !p2) return renderLWContextEmpty();
            const posNames = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
            const posColors = { 1: '#D97706', 2: '#059669', 3: '#2563EB', 4: '#DC2626' };
            const d1 = computeQuickLineupScoreDetailed(p1);
            const d2 = computeQuickLineupScoreDetailed(p2);
            const gp = Math.max(currentGW - 1, 1);

            function cmpVal(v1, v2, higher) {
                const b1 = higher ? v1 > v2 : v1 < v2;
                const b2 = higher ? v2 > v1 : v2 < v1;
                const eq = Math.abs(v1 - v2) < 0.01;
                return { c1: eq ? '' : (b1 ? 'better' : 'worse'), c2: eq ? '' : (b2 ? 'better' : 'worse') };
            }

            function statRow(label, v1, v2, fmt, higherBetter) {
                const s1 = typeof fmt === 'function' ? fmt(v1) : v1.toFixed(1);
                const s2 = typeof fmt === 'function' ? fmt(v2) : v2.toFixed(1);
                const { c1, c2 } = cmpVal(v1, v2, higherBetter !== false);
                return `<div class="lw-ctx-compare-stat">
                    <div class="lw-ctx-compare-stat-val ${c1}" style="text-align:right;">${s1}</div>
                    <div class="lw-ctx-compare-stat-label">${label}</div>
                    <div class="lw-ctx-compare-stat-val ${c2}" style="text-align:left;">${s2}</div>
                </div>`;
            }

            let html = `<div class="lw-ctx-panel">`;
            html += `<div class="lw-ctx-header" style="justify-content:space-between;">
                <span style="font-weight:700;font-size:13px;">Side-by-Side Comparison</span>
                <button class="lw-ctx-header-close" onclick="lineupState.selectedPlayers=[];updateLWContextPanel();">✕</button>
            </div>`;

            // Player headers
            html += `<div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--border-subtle);">`;
            [p1, p2].forEach(p => {
                html += `<div style="text-align:center;padding:10px 8px;${p === p1 ? 'border-right:1px solid var(--border-subtle);' : ''}">
                    <span style="padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;background:${posColors[p.pos]}22;color:${posColors[p.pos]};">${posNames[p.pos]}</span>
                    <div style="font-weight:700;font-size:13px;margin-top:4px;">${escHTML(p.web_name)}</div>
                    <div style="font-size:10px;color:var(--text-muted);">${escHTML(p.team)} · £${p.price.toFixed(1)}m</div>
                    <div style="font-family:var(--font-mono);font-size:18px;font-weight:700;margin-top:4px;color:${p.lwScore >= 30 ? 'var(--color-success)' : p.lwScore >= 10 ? '#F59E0B' : 'var(--color-error)'};">${p.lwScore}</div>
                </div>`;
            });
            html += `</div>`;

            // Comparison stats
            html += `<div style="padding:12px 16px;">`;
            html += `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:6px;">Key Metrics</div>`;
            const int = v => Math.round(v).toString();
            html += statRow('Form', parseFloat(p1.form), parseFloat(p2.form), v => v.toFixed(1));
            html += statRow('PPG', p1.points / gp, p2.points / gp, v => v.toFixed(1));
            html += statRow('EP Next', p1.epNext || 0, p2.epNext || 0, v => v.toFixed(1));
            html += statRow('xGI/90', p1.minutes > 0 ? (p1.xGI/p1.minutes)*90 : 0, p2.minutes > 0 ? (p2.xGI/p2.minutes)*90 : 0, v => v.toFixed(2));
            html += statRow('Min/G', (p1.minutes||0)/gp, (p2.minutes||0)/gp, int);
            html += statRow('Bonus', p1.bonus, p2.bonus, int);
            html += statRow('ICT', p1.ictIndex, p2.ictIndex, v => v.toFixed(0));

            // Score factor comparison
            html += `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin:12px 0 6px;">Score Factors</div>`;
            html += statRow('EP', d1.ep, d2.ep, v => v.toFixed(1));
            html += statRow('Form', d1.form, d2.form, v => v.toFixed(1));
            html += statRow('Fixture', d1.fixture, d2.fixture, v => v.toFixed(1));
            html += statRow('xGI', d1.xgi, d2.xgi, v => v.toFixed(1));
            html += statRow('PPG', d1.ppg, d2.ppg, v => v.toFixed(1));
            html += `</div>`;

            // Fixture strips
            html += `<div style="display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--border-subtle);padding:12px 16px;">`;
            [p1, p2].forEach((p, idx) => {
                const pFx = p.fixtures || [];
                html += `<div style="text-align:center;${idx === 0 ? 'border-right:1px solid var(--border-subtle);padding-right:8px;' : 'padding-left:8px;'}">
                    <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px;">Fixtures</div>
                    <div style="display:flex;gap:3px;justify-content:center;flex-wrap:wrap;">`;
                pFx.slice(0, 5).forEach(f => {
                    html += `<span style="display:inline-flex;align-items:center;gap:2px;font-size:10px;font-weight:600;padding:2px 5px;border-radius:4px;background:var(--surface-2);"><span class="fdr-dot fdr-${f.difficulty}"></span>${escHTML(f.opponent)}</span>`;
                });
                html += `</div></div>`;
            });
            html += `</div>`;

            // Routes comparison
            html += lwBuildCompareRoutes(p1, p2);
            // Rising Form comparison
            html += lwBuildCompareRisingForm(p1, p2);
            // Home/Away comparison
            html += lwBuildCompareSplits(p1, p2);
            // xG Regression comparison
            html += lwBuildCompareXgRegression(p1, p2);

            html += `</div>`;
            return html;
        }

        function lwBuildCompareRoutes(p1, p2) {
            const r1 = lwBuildSingleRoutes(p1), r2 = lwBuildSingleRoutes(p2);
            if (!r1 && !r2) return '';
            return '<div style="display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--border-subtle);">' +
                '<div style="padding:12px 12px;border-right:1px solid var(--border-subtle);">' + (r1 || '<div style="font-size:11px;color:var(--text-muted);padding:8px;">No routes</div>') + '</div>' +
                '<div style="padding:12px 12px;">' + (r2 || '<div style="font-size:11px;color:var(--text-muted);padding:8px;">No routes</div>') + '</div></div>';
        }

        function lwBuildCompareRisingForm(p1, p2) {
            const r1 = lwBuildSingleRisingForm(p1), r2 = lwBuildSingleRisingForm(p2);
            if (!r1 && !r2) return '';
            return '<div style="display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--border-subtle);">' +
                '<div style="padding:12px 12px;border-right:1px solid var(--border-subtle);">' + (r1 || '<div style="font-size:11px;color:var(--text-muted);padding:8px;">No signals</div>') + '</div>' +
                '<div style="padding:12px 12px;">' + (r2 || '<div style="font-size:11px;color:var(--text-muted);padding:8px;">No signals</div>') + '</div></div>';
        }

        function lwBuildCompareSplits(p1, p2) {
            const r1 = lwBuildSingleSplits(p1), r2 = lwBuildSingleSplits(p2);
            if (!r1 && !r2) return '';
            return '<div style="display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--border-subtle);">' +
                '<div style="padding:12px 12px;border-right:1px solid var(--border-subtle);">' + (r1 || '<div style="font-size:11px;color:var(--text-muted);padding:8px;">No data</div>') + '</div>' +
                '<div style="padding:12px 12px;">' + (r2 || '<div style="font-size:11px;color:var(--text-muted);padding:8px;">No data</div>') + '</div></div>';
        }

        function lwBuildCompareXgRegression(p1, p2) {
            const r1 = lwBuildSingleXgRegression(p1), r2 = lwBuildSingleXgRegression(p2);
            if (!r1 && !r2) return '';
            return '<div style="display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--border-subtle);">' +
                '<div style="padding:12px 12px;border-right:1px solid var(--border-subtle);">' + (r1 || '<div style="font-size:11px;color:var(--text-muted);padding:8px;">In line</div>') + '</div>' +
                '<div style="padding:12px 12px;">' + (r2 || '<div style="font-size:11px;color:var(--text-muted);padding:8px;">In line</div>') + '</div></div>';
        }

        function updateLWContextPanel() {
            const el = document.getElementById('lwContextPanel');
            if (el) {
                el.innerHTML = renderLWContextPanel();
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }
            // Update row selection highlights
            document.querySelectorAll('.lw-row').forEach(row => {
                const pid = parseInt(row.dataset.playerId);
                row.classList.toggle('lw-row-selected', lineupState.selectedPlayers.includes(pid));
            });
        }

        // ── LINEUP WIZARD: Row Click Handler (separates view from swap) ──
        function handleLWRowClick(playerId) {
            // If in swap mode, delegate to swap handler
            if (lineupState.swapSource) {
                handleLWSwapClick(playerId);
                return;
            }
            // Toggle selection for context panel (max 2)
            const idx = lineupState.selectedPlayers.indexOf(playerId);
            if (idx >= 0) {
                lineupState.selectedPlayers.splice(idx, 1);
            } else if (lineupState.selectedPlayers.length >= 2) {
                lineupState.selectedPlayers.shift();
                lineupState.selectedPlayers.push(playerId);
            } else {
                lineupState.selectedPlayers.push(playerId);
            }
            updateLWContextPanel();
        }

        function handleLWSwapBtnClick(playerId, event) {
            event.stopPropagation();
            handleLWSwapClick(playerId);
        }

        // ===== INITIALIZATION =====
        const DEFAULT_SETTINGS = {
            sellSensitivity: 1.0,
            fixtureWeight: 1.0,
            formWeight: 1.0,
            valueWeight: 1.0,
            minutesThreshold: 60,
            premiumHarshness: 1.0
        };

        // Load saved settings immediately (IIFE)
        (function() {
            const savedSettings = localStorage.getItem('fpl_analysis_settings');
            if (savedSettings) {
                try {
                    const parsed = JSON.parse(savedSettings);
                    userSettings = { ...DEFAULT_SETTINGS, ...parsed };
                    for (const key of Object.keys(DEFAULT_SETTINGS)) {
                        if (typeof userSettings[key] !== 'number' || isNaN(userSettings[key])) {
                            userSettings[key] = DEFAULT_SETTINGS[key];
                        }
                    }
                } catch (e) {
                    console.warn('Invalid saved settings, using defaults');
                    userSettings = { ...DEFAULT_SETTINGS };
                }
            }
            const savedPreset = localStorage.getItem('fpl_active_preset');
            if (savedPreset && ['aggressive','balanced','patient'].includes(savedPreset)) {
                activePreset = savedPreset;
            }
        })();

        function onTeamIdSubmitted(teamId) {
            document.getElementById('teamIdInput').value = teamId;
            loadTeamById();
        }
        function onTeamIdCleared() {
            document.getElementById('teamIdInput').value = '';
        }
