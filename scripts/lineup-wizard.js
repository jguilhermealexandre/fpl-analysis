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

            const squad = picksData.picks.map(pick => {
                const p = allPlayersById[pick.element];
                if (!p) return null;
                // Two different questions need two different numbers. "What does
                // this player score THIS gameweek" (gwScore) is what the armband
                // doubles and what the headline total reports, because captaincy
                // and a week's score are both one-week decisions. "Who should
                // start" is not — a player with a great match and a blank either
                // side is a worse pick than one who is merely good three times
                // running, so the XI itself is selected on the summed run
                // (lwScore), the same horizon the draft and the transfer
                // recommender already plan against.
                const detailed = computeQuickLineupScoreDetailed(p);
                const gwScore = predictedGWPoints(p);
                const runScore = typeof xpOver === 'function' ? xpOver(p, xpPlanGWs(XP_PLAN_HORIZON)) : gwScore;
                const lwScore = detailed.total <= -100 ? -1000 : runScore;
                return { ...p, pos: p.position, web_name: p.name, pickPos: pick.position,
                    onBench: pick.position > 11, isCaptain: pick.is_captain,
                    isViceCaptain: pick.is_vice_captain, lwScore, gwScore, _detailed: detailed };
            }).filter(Boolean);

            lineupState.squad = squad;
            lineupState.excluded = new Set();
            lineupState.swapSource = null;
            lineupState.selectedPlayers = [];
            lineupState.intelTab = 'overview';
            lineupState.originalXIIds = new Set(squad.filter(p => !p.onBench).map(p => p.id));
            lineupState.originalCaptain = squad.find(p => p.isCaptain)?.id || null;
            lineupState.originalVC = squad.find(p => p.isViceCaptain)?.id || null;

            squad.forEach(p => {
                if (p.status === 'i' || p.status === 'u' || p.status === 's') lineupState.excluded.add(p.id);
            });

            solveLWLineup();
            const cap = lineupState.xi.filter(p => p.pos !== 1).sort((a, b) => b.gwScore - a.gwScore);
            lineupState.captain = cap[0]?.id || null;
            lineupState.viceCaptain = cap[1]?.id || null;

            renderLineupCommandCenter();
        }

        function solveLWLineup() {
            const available = lineupState.squad.filter(p => !lineupState.excluded.has(p.id));
            const result = solveQuickLineup(available.map(p => ({ ...p, pos: p.pos })));
            const xiIds = new Set(result.xi.map(p => p.id));
            lineupState.xi = lineupState.squad.filter(p => xiIds.has(p.id));
            // Bench substitution order is a same-week question — who comes on if a
            // starter blanks THIS gameweek — so it sorts on gwScore, not the run
            // score the XI itself was picked on.
            lineupState.bench = lineupState.squad.filter(p => !xiIds.has(p.id))
                .sort((a, b) => (a.pos === 1 ? 1 : 0) - (b.pos === 1 ? 1 : 0) || b.gwScore - a.gwScore);
            lineupState.formation = result.formation;
        }

        // Total the lineup actually projects THIS gameweek, including the armband.
        // Deliberately gwScore, not lwScore — the XI was chosen on the summed run,
        // but this number has to match "what will my score be Saturday".
        function lwTotalXP() {
            const capId = lineupState.captain;
            return lineupState.xi.reduce((s, p) => s + p.gwScore * (p.id === capId ? 2 : 1), 0);
        }

        function renderLineupCommandCenter() {
            const container = document.getElementById('lineupDisplay');
            const lwRun = typeof xpPlanGWs === 'function' ? xpPlanGWs(XP_PLAN_HORIZON) : [];
            const optimiseTip = lwRun.length > 1
                ? `Rebuild the legal eleven that projects best across GW${lwRun[0]}–GW${lwRun[lwRun.length - 1]} combined, not just this single week.`
                : 'Rebuild the highest-projecting legal eleven from your available players.';
            container.innerHTML = `
                <div class="lw-cc">
                    <div class="lw-cc-head">
                        <div class="lw-cc-title">🎛️ Lineup command centre <span class="lw-cc-gw">GW${currentGW}</span></div>
                        <div class="lw-cc-stats">
                            <span class="lw-cc-stat" data-tooltip="The shape the optimiser settled on for your available players.">
                                <span class="lw-cc-stat-l">Formation</span><span class="lw-cc-stat-v" id="lwFormation">${lineupState.formation}</span></span>
                            <span class="lw-cc-stat" data-tooltip="Projected points for the starting eleven this gameweek, with the captain's points doubled.">
                                <span class="lw-cc-stat-l">Projected</span><span class="lw-cc-stat-v accent" id="lwTotal">${lwTotalXP().toFixed(1)}</span></span>
                        </div>
                        <button class="rc-btn" onclick="resetLineupToOptimal()" data-tooltip="${optimiseTip}">✨ Auto-optimise</button>
                    </div>
                    <div class="lw-cc-body">
                        <div class="lw-cc-pitch" id="lwPitchPane">${renderLWPitch()}</div>
                        <div class="lw-cc-intel" id="lwIntelPane">${renderLWIntel()}</div>
                    </div>
                </div>`;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        const LW_FDR_WORD = { 1: 'Very easy', 2: 'Easy', 3: 'Average', 4: 'Hard', 5: 'Very hard' };

        // The pitch node carries the decision, not a shirt number: who they play,
        // how hard it is, what they project, and anything that might stop them.
        function lwCard(p, benchIdx) {
            const unavailable = p.lwScore <= -100;
            const xp = unavailable ? 0 : p.gwScore;
            /* lwScore (the run total) is what actually decided who is in this XI —
               shown here so the pick explains itself instead of just asserting it. */
            const lwRun = typeof xpPlanGWs === 'function' ? xpPlanGWs(XP_PLAN_HORIZON) : [];
            const lwRunXP = unavailable ? 0 : p.lwScore;
            const fx = (p.fixtures || teamFixtures[p.teamId] || [])[0];
            const posClass = `pos-${POSITION_CONFIG[p.pos]?.class || 'mid'}`;
            const selected = lineupState.selectedPlayers.includes(p.id);
            const isSwapSrc = lineupState.swapSource === p.id;
            const isSwapTgt = lineupState.swapSource && lineupState.swapSource !== p.id;

            const out = p.status === 'i' || p.status === 'u' || p.status === 's';
            const doubt = p.status === 'd';
            const risk = typeof expectedMinutesModel === 'function' ? expectedMinutesModel(p) : { pStart: 1 };
            const rotation = !out && !doubt && risk.pStart < 0.6;

            let badges = '';
            if (p.id === lineupState.captain) badges += `<span class="dp-badge cap" data-tooltip="Captain — points doubled.">C</span>`;
            else if (p.id === lineupState.viceCaptain) badges += `<span class="dp-badge vice" data-tooltip="Vice-captain — takes the armband if the captain does not play.">V</span>`;
            if (benchIdx != null) badges += `<span class="dp-badge bench" data-tooltip="${benchIdx === 'GK' ? 'Reserve keeper.' : `Substitution order — ${benchIdx} in line.`}">${benchIdx === 'GK' ? 'GK' : 'B' + benchIdx}</span>`;
            if (out) badges += `<span class="dp-badge out" data-tooltip="${escHTML(p.news || 'Unavailable this gameweek')}">OUT</span>`;
            else if (doubt) badges += `<span class="dp-badge doubt" data-tooltip="${escHTML(p.news || 'Fitness doubt')}${p.chanceNextRound != null ? ` — ${p.chanceNextRound}% chance of playing` : ''}">?</span>`;
            else if (rotation) badges += `<span class="dp-badge doubt" data-tooltip="Rotation risk — around ${Math.round(risk.pStart * 100)}% likely to start, based on minutes per appearance.">⟳</span>`;

            const fixChip = fx
                ? `<span class="dp-fix fdr-${fx.difficulty || 3}" data-tooltip="${fx.isHome ? 'Home to' : 'Away at'} ${escHTML(fx.opponent || '?')} — FDR ${fx.difficulty || 3} (${LW_FDR_WORD[fx.difficulty || 3] || 'Average'})">${escHTML(fx.opponent || '?')} <span class="dp-fix-ha">${fx.isHome ? 'H' : 'A'}</span></span>`
                : `<span class="dp-fix dp-fix-blank" data-tooltip="No fixture this gameweek.">Blank</span>`;

            const cls = ['dp-card', posClass, out ? 'is-out' : '', selected ? 'lw-picked' : '',
                isSwapSrc ? 'swap-selected' : '', isSwapTgt ? 'swap-target' : ''].filter(Boolean).join(' ');

            return `<div class="${cls}" onclick="handleLWRowClick(${p.id})">
                <div class="dp-badges">${badges}</div>
                <button class="dp-transfer" onclick="handleLWSwapBtnClick(${p.id}, event)" data-tooltip="Swap ${escHTML(p.web_name)} between the XI and the bench">↕</button>
                <div class="dp-name">${escHTML(p.web_name)}</div>
                <div class="dp-meta">${escHTML(p.team)} · £${p.price.toFixed(1)}m</div>
                <div class="dp-fixtures">${fixChip}</div>
                <div class="dp-xp" data-tooltip="Projected points for ${escHTML(p.web_name)} this gameweek.">${xp.toFixed(1)}<span class="dp-xp-u">xP</span></div>
                ${lwRun.length > 1 ? `<div class="dp-xp-run" data-tooltip="Projected points across GW${lwRun[0]}\u2013GW${lwRun[lwRun.length - 1]} combined \u2014 this is what Auto-optimise ranks the XI on, so a steady run beats one flukey week.">${lwRunXP.toFixed(1)}<span class="dp-xp-run-u">next ${lwRun.length}</span></div>` : ''}
            </div>`;
        }

        function renderLWPitch() {
            const xi = lineupState.xi, bench = lineupState.bench;
            const byPos = n => xi.filter(p => p.pos === n).sort((a, b) => b.lwScore - a.lwScore);
            let benchCount = 0;

            let html = `<div class="dp-pitch-card"><div class="dp-pitch">`;
            html += `<div class="dp-row">${byPos(4).map(p => lwCard(p)).join('')}</div>`;
            html += `<div class="dp-row">${byPos(3).map(p => lwCard(p)).join('')}</div>`;
            html += `<div class="dp-row">${byPos(2).map(p => lwCard(p)).join('')}</div>`;
            html += `<div class="dp-row">${byPos(1).map(p => lwCard(p)).join('')}</div>`;
            html += `</div><div class="dp-bench"><div class="dp-bench-label">Bench</div>`;
            html += `<div class="dp-bench-row">${bench.map(p => lwCard(p, p.pos === 1 ? 'GK' : ++benchCount)).join('')}</div>`;
            html += `</div></div>`;
            html += `<div class="lw-pitch-hint">${lineupState.swapSource
                ? `Swapping <strong>${escHTML((lineupState.squad.find(p => p.id === lineupState.swapSource) || {}).web_name || '')}</strong> — click ↕ on another player to complete it.`
                : 'Click a player for their detail. Click a second to compare them side by side. Use ↕ to swap.'}</div>`;
            return html;
        }

        function setLWIntelTab(tab) {
            lineupState.intelTab = tab;
            updateLWContextPanel();
        }

        function renderLWIntel() {
            const tab = lineupState.intelTab || 'overview';
            let body;
            if (tab === 'captaincy') body = renderLWCaptaincyMatrix();
            else {
                const sel = lineupState.selectedPlayers;
                body = !sel.length ? renderLWSummary()
                    : sel.length === 1 ? renderLWContextSingle(sel[0])
                    : renderLWContextCompare(sel[0], sel[1]);
            }
            return `<div class="lw-intel">
                <div class="lw-intel-tabs">
                    <button class="lw-intel-tab ${tab === 'overview' ? 'active' : ''}" onclick="setLWIntelTab('overview')">🧠 Overview</button>
                    <button class="lw-intel-tab ${tab === 'captaincy' ? 'active' : ''}" onclick="setLWIntelTab('captaincy')">👑 Captaincy</button>
                </div>
                <div class="lw-intel-body">${body}</div>
            </div>`;
        }

        // The panel's default state. An empty pane that asks to be clicked wastes
        // the most valuable position on the screen, so it opens with the read on
        // the lineup: what it projects, where it is weakest, and what is sitting
        // on the bench that maybe should not be.
        function renderLWSummary() {
            const xi = lineupState.xi, bench = lineupState.bench;
            if (!xi.length) return `<div class="lw-side-empty">Load a squad to see the lineup read.</div>`;
            const lwRun = typeof xpPlanGWs === 'function' ? xpPlanGWs(XP_PLAN_HORIZON) : [];
            const runUnit = lwRun.length > 1 ? `xP · next ${lwRun.length} GWs` : 'xP';

            const sorted = [...xi].sort((a, b) => a.lwScore - b.lwScore);
            const weakest = sorted[0];
            const outfieldBench = bench.filter(p => p.pos !== 1 && !lineupState.excluded.has(p.id));
            const strongestBench = outfieldBench.sort((a, b) => b.lwScore - a.lwScore)[0];

            // Only a real upgrade if the swap keeps the formation legal.
            let upgrade = null;
            if (strongestBench) {
                const candidateXI = xi.filter(p => p.id !== weakest.id).concat([strongestBench]);
                if (isValidLWFormation(candidateXI) && strongestBench.lwScore > weakest.lwScore + 0.05) {
                    upgrade = { out: weakest, in: strongestBench, gain: strongestBench.lwScore - weakest.lwScore };
                }
            }

            const flagged = lineupState.squad.filter(p => p.status === 'i' || p.status === 'u' || p.status === 's' || p.status === 'd');
            const risky = xi.filter(p => typeof expectedMinutesModel === 'function' && expectedMinutesModel(p).pStart < 0.6);
            const cap = lineupState.squad.find(p => p.id === lineupState.captain);

            return `<div class="lw-sum">
                <div class="lw-sum-hero">
                    <div class="lw-sum-hero-v">${lwTotalXP().toFixed(1)}</div>
                    <div class="lw-sum-hero-l">projected points · ${escHTML(lineupState.formation)}${cap ? ` · ${escHTML(cap.web_name)} captained` : ''}</div>
                </div>

                <div class="lw-sum-block">
                    <div class="lw-sum-h">🔻 Weakest link in the XI</div>
                    <div class="lw-sum-row">
                        <span class="lw-sum-name">${escHTML(weakest.web_name)}</span>
                        <span class="lw-sum-xp">${weakest.lwScore.toFixed(1)} ${runUnit}</span>
                    </div>
                    <div class="lw-sum-note">${upgrade
                        ? `${escHTML(upgrade.in.web_name)} projects <strong>+${upgrade.gain.toFixed(1)}</strong> more and the shape still works. <button class="lw-sum-apply" onclick="lwApplySwap(${upgrade.out.id}, ${upgrade.in.id})">Make the swap</button>`
                        : 'Nothing on the bench beats them in a legal formation — this is as good as the eleven gets.'}</div>
                </div>

                <div class="lw-sum-block">
                    <div class="lw-sum-h">🪑 Strongest player on the bench</div>
                    ${strongestBench ? `<div class="lw-sum-row">
                        <span class="lw-sum-name">${escHTML(strongestBench.web_name)}</span>
                        <span class="lw-sum-xp">${strongestBench.lwScore.toFixed(1)} ${runUnit}</span>
                    </div>
                    <div class="lw-sum-note">${strongestBench.lwScore > weakest.lwScore
                        ? 'Out-projects a starter, so they are the first thing to look at.'
                        : 'Projects below every starter — the bench order is right.'}</div>`
                    : '<div class="lw-sum-note">No outfield players on the bench.</div>'}
                </div>

                ${(flagged.length || risky.length) ? `<div class="lw-sum-block">
                    <div class="lw-sum-h">⚠️ Worth checking</div>
                    ${flagged.map(p => `<div class="lw-sum-flag"><strong>${escHTML(p.web_name)}</strong> — ${escHTML((p.news || '').split('.')[0] || (p.status === 'd' ? 'fitness doubt' : 'unavailable'))}${p.chanceNextRound != null ? ` (${p.chanceNextRound}%)` : ''}</div>`).join('')}
                    ${risky.filter(p => !flagged.some(f => f.id === p.id)).map(p => `<div class="lw-sum-flag"><strong>${escHTML(p.web_name)}</strong> — rotation risk, ${Math.round(expectedMinutesModel(p).pStart * 100)}% likely to start</div>`).join('')}
                </div>` : ''}

                <div class="lw-sum-hintline">Click any player on the pitch for their detail, or two to compare them.</div>
            </div>`;
        }

        function lwApplySwap(outId, inId) {
            handleLWSwapClick(outId);
            handleLWSwapClick(inId);
        }

        // Captaincy as a matrix rather than a list: the armband is the biggest call
        // of the week, and "Form 8 · xGI/90 1.12" in grey text does not carry it.
        function renderLWCaptaincyMatrix() {
            const ranks = typeof getDefensiveRanks === 'function' ? getDefensiveRanks() : { rank: {}, total: 20 };
            // The armband only ever pays out for this gameweek, so candidates are
            // ranked on gwScore, not the run score the XI itself was picked on.
            const candidates = lineupState.xi.filter(p => p.pos !== 1)
                .sort((a, b) => b.gwScore - a.gwScore).slice(0, 3);

            if (!candidates.length) return `<div class="lw-side-empty">No outfield players in the XI yet.</div>`;

            const cards = candidates.map((p, i) => {
                const fx = (p.fixtures || teamFixtures[p.teamId] || [])[0];
                const ctx = fx && typeof opponentContext === 'function' ? opponentContext(p.teamId, fx, ranks) : null;
                const per90 = typeof regressedPer90 === 'function' ? regressedPer90(p) : { xg90: 0, xa90: 0 };
                const threat = per90.xg90 + per90.xa90;

                // Two bars: how dangerous this player is, and how leaky the defence
                // they face. A high threat into a tight defence is a different bet
                // from a modest one into the league's softest.
                const threatPct = Math.max(4, Math.min(100, (threat / 1.0) * 100));
                const weakPct = ctx && ctx.ranked ? Math.max(4, Math.min(100, ((ranks.total - ctx.rank + 1) / ranks.total) * 100)) : null;
                const form = isPreseason ? (p.ppg || 0) : (parseFloat(p.form) || 0);
                const isCap = lineupState.captain === p.id, isVC = lineupState.viceCaptain === p.id;

                return `<div class="lw-cap-card ${isCap ? 'is-cap' : ''}">
                    <div class="lw-cap-rank">${i + 1}</div>
                    <div class="lw-cap-name">${escHTML(p.web_name)}</div>
                    <div class="lw-cap-team">${escHTML(p.team)} · ${POSITION_CONFIG[p.pos]?.short || ''}</div>
                    ${fx ? `<span class="dp-fix fdr-${fx.difficulty || 3}" data-tooltip="${fx.isHome ? 'Home to' : 'Away at'} ${escHTML(fx.opponent || '?')} — FDR ${fx.difficulty || 3}">${escHTML(fx.opponent || '?')} <span class="dp-fix-ha">${fx.isHome ? 'H' : 'A'}</span></span>` : ''}
                    <div class="lw-cap-xp" data-tooltip="Projected points with the armband on — ${p.gwScore.toFixed(1)} doubled.">${(p.gwScore * 2).toFixed(1)}<span class="lw-cap-xp-u">pts</span></div>
                    <div class="lw-cap-bars">
                        <div class="lw-cap-bar-row" data-tooltip="Expected goal involvements per 90 for ${escHTML(p.web_name)}: ${threat.toFixed(2)}.">
                            <span class="lw-cap-bar-l">Threat</span>
                            <span class="lw-cap-bar"><span class="lw-cap-bar-f threat" style="width:${threatPct}%"></span></span>
                        </div>
                        <div class="lw-cap-bar-row" data-tooltip="${weakPct != null ? `${escHTML(fx.opponent)} are the ${ordinal(ctx.rank)} leakiest defence of ${ctx.total}, conceding ${ctx.conceded.toFixed(1)} per game.` : 'Not enough matches played to rank this opponent yet.'}">
                            <span class="lw-cap-bar-l">Opponent</span>
                            <span class="lw-cap-bar">${weakPct != null ? `<span class="lw-cap-bar-f weak" style="width:${weakPct}%"></span>` : '<span class="lw-cap-bar-na">not yet ranked</span>'}</span>
                        </div>
                    </div>
                    <div class="lw-cap-meta">Form <strong>${form.toFixed(1)}</strong> · Owned <strong>${p.ownership != null ? p.ownership + '%' : '—'}</strong></div>
                    <div class="lw-cap-actions">
                        <button class="lw-cap-btn ${isCap ? 'active-c' : ''}" onclick="setLWCaptain(${p.id})" data-tooltip="Give ${escHTML(p.web_name)} the armband">C</button>
                        <button class="lw-cap-btn ${isVC ? 'active-vc' : ''}" onclick="setLWViceCaptain(${p.id})" data-tooltip="Make ${escHTML(p.web_name)} vice-captain">VC</button>
                    </div>
                </div>`;
            }).join('');

            return `<div class="lw-cap-matrix">
                <div class="lw-cap-lead">Ranked by projected points. The bars set what each player threatens against how leaky the defence they face is.</div>
                <div class="lw-cap-grid">${cards}</div>
                ${renderLWChanges()}
            </div>`;
        }

        function toggleLWExclude(playerId) {
            if (lineupState.excluded.has(playerId)) lineupState.excluded.delete(playerId);
            else lineupState.excluded.add(playerId);
            solveLWLineup();
            const cap = lineupState.xi.filter(p => p.pos !== 1).sort((a, b) => b.gwScore - a.gwScore);
            if (lineupState.excluded.has(lineupState.captain) || !lineupState.xi.some(p => p.id === lineupState.captain)) {
                lineupState.captain = cap[0]?.id || null;
            }
            renderLineupCommandCenter();
        }

        function handleLWSwapClick(playerId) {
            if (!lineupState.swapSource) {
                // First click: select source
                lineupState.swapSource = playerId;
                refreshLWView();
                return;
            }

            if (lineupState.swapSource === playerId) {
                // Clicked same player: cancel swap
                lineupState.swapSource = null;
                refreshLWView();
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
                    refreshLWView();
                    return;
                }
            }

            lineupState.xi = newXI;
            lineupState.bench = newBench;
            lineupState.formation = getFormationString(lineupState.xi);
            refreshLWView();
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
            // Deliberately does NOT recompute lwScore from the heuristic: the cards
            // display lwScore as projected points, so overwriting it with the 0-100
            // ranking score would put "41.0 xP" on a player worth four.
            lineupState.swapSource = null;
            solveLWLineup();
            // Captaincy pays out for this gameweek alone, so it's picked on gwScore
            // even though the XI itself was just chosen on the summed run.
            const cap = lineupState.xi.filter(p => p.pos !== 1).sort((a, b) => b.gwScore - a.gwScore);
            if (!lineupState.xi.some(p => p.id === lineupState.captain)) lineupState.captain = cap[0]?.id || null;
            if (!lineupState.xi.some(p => p.id === lineupState.viceCaptain)) lineupState.viceCaptain = cap[1]?.id || null;
            refreshLWView();
        }

        // ── STEP 3: Captain & Summary ──
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
            refreshLWView();
        }

        function setLWViceCaptain(playerId) {
            if (lineupState.captain === playerId) lineupState.captain = lineupState.viceCaptain;
            lineupState.viceCaptain = playerId;
            refreshLWView();
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

        // solveQuickLineup now lives in scripts/transfer-engine.js — the transfer
        // recommender needs it too, and two copies would drift.

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
            html += `<div style="text-align:center;margin-bottom:10px;"><span style="font-family:var(--font-mono);font-size:24px;font-weight:700;color:${p.gwScore >= 30 ? 'var(--color-success)' : p.gwScore >= 10 ? '#F59E0B' : 'var(--color-error)'};">${p.gwScore}</span><span style="font-size:11px;color:var(--text-muted);margin-left:4px;">pts</span></div>`;
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
                    <div style="font-family:var(--font-mono);font-size:18px;font-weight:700;margin-top:4px;color:${p.gwScore >= 30 ? 'var(--color-success)' : p.gwScore >= 10 ? '#F59E0B' : 'var(--color-error)'};">${p.gwScore}</div>
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

        // Repaints the pitch, the header figures and the intel pane together, so a
        // swap can never leave the projected total describing the previous lineup.
        function refreshLWView() {
            const pitch = document.getElementById('lwPitchPane');
            if (pitch) pitch.innerHTML = renderLWPitch();
            const f = document.getElementById('lwFormation');
            if (f) f.textContent = lineupState.formation;
            const t = document.getElementById('lwTotal');
            if (t) t.textContent = lwTotalXP().toFixed(1);
            updateLWContextPanel();
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        function updateLWContextPanel() {
            const el = document.getElementById('lwIntelPane');
            if (el) {
                el.innerHTML = renderLWIntel();
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }
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
