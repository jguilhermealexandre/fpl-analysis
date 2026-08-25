/* ============================================
   EasyFPL — My Team Analysis
   The interactive pitch and dugout: lineup state, click and drag swapping,
   captaincy, the auto-optimizer and its full decision report.

   Extracted from the inline <script> in fpl-my-team-analysis.html.
   These files are plain classic scripts loaded in order, not ES modules:
   every function stays a global, which the inline onclick= handlers
   throughout the markup depend on. Load order is preserved from the
   original file — team-analysis-core.js must come first, since the
   settings IIFE in lineup-wizard.js reads DEFAULT_SETTINGS from it.
   ============================================ */

        // ===== PHASE 5: INTERACTIVE SQUAD SNAPSHOT (replaces the static pitch) =====
        let snapshotXI = new Set();          // player ids in the projected starting XI
        let snapshotBenchOrder = [];          // ordered player ids, GK-last convention (matches solveQuickLineup)
        let snapshotCaptainId = null;
        let snapshotViceId = null;
        let snapshotSwapSource = null;        // player id mid same-position swap, or null
        let snapshotOptimizeSummary = '';
        let snapshotInitialized = false;

        // Only called from the team-reload flow (new team load / team switch) — NOT on
        // every re-render, so manual swaps/captain choices survive incidental re-renders
        // (e.g. applying a settings preset just re-scores verdicts, it doesn't reset the squad).
        function resetSnapshotState() {
            snapshotXI = new Set();
            snapshotBenchOrder = [];
            snapshotCaptainId = null;
            snapshotViceId = null;
            snapshotSwapSource = null;
            snapshotOptimizeSummary = '';
            snapshotOptimizeReport = null;
            snapshotInitialized = false;
        }

        function initSnapshotIfNeeded() {
            if (snapshotInitialized) return;
            // Don't latch an empty lineup if this runs before the squad is analysed —
            // snapshotInitialized would stay true and freeze the empty state.
            if (!analysisResults.length) return;
            snapshotXI = new Set(analysisResults.filter(a => !a.player.onBench).map(a => a.player.id));
            snapshotBenchOrder = analysisResults.filter(a => a.player.onBench)
                .sort((a, b) => a.player.pickPosition - b.player.pickPosition).map(a => a.player.id);
            const capA = analysisResults.find(a => a.player.isCaptain);
            const viceA = analysisResults.find(a => a.player.isVice);
            snapshotCaptainId = capA ? capA.player.id : null;
            snapshotViceId = viceA ? viceA.player.id : null;
            snapshotInitialized = true;
        }

        function getSquadAnalysisMap() {
            return new Map(analysisResults.map(a => [a.player.id, a]));
        }

        /* The expected-points engine moved to scripts/xp-engine.js so the
           dashboard can use the same projection as everything else. It is loaded
           before this file and its functions remain plain globals, so every call
           site here and in the wizards is unchanged. */

        function computeProjectedTotalFor(xiSet, captainId, viceId, benchOrder) {
            const analysisMap = getSquadAnalysisMap();
            let total = 0;

            xiSet.forEach(id => {
                const a = analysisMap.get(id);
                if (a) total += predictedGWPoints(a.player);
            });

            // 1. Captaincy. The armband only doubles if the captain actually plays;
            //    otherwise it passes to the vice. Weight each by their start odds
            //    rather than assuming the captain always turns out.
            // Only an armband on a player who is actually starting pays out. Without
            // this guard a captain left behind on the bench by a swap still had his
            // points doubled into the total, while his base score was never counted
            // — a figure that matched nothing on the pitch.
            const cap = xiSet.has(captainId) ? analysisMap.get(captainId) : null;
            const vice = xiSet.has(viceId) ? analysisMap.get(viceId) : null;
            if (cap) {
                const capStart = projectPlayerPointsDetailed(cap.player).pStart;
                total += predictedGWPoints(cap.player) * capStart;
                if (vice) {
                    total += predictedGWPoints(vice.player) * (1 - capStart) * projectPlayerPointsDetailed(vice.player).pStart;
                }
            }

            // 2. Auto-subs. When a starter doesn't play, the first eligible bench
            //    player replaces him, so some bench points land in the total. Value
            //    each starter's no-show chance against the best bench cover.
            const benchXP = (benchOrder || [])
                .map(id => analysisMap.get(id))
                .filter(Boolean)
                .map(a => predictedGWPoints(a.player));
            if (benchXP.length) {
                let benchIdx = 0;
                xiSet.forEach(id => {
                    const a = analysisMap.get(id);
                    if (!a || benchIdx >= benchXP.length) return;
                    const pNoShow = 1 - projectPlayerPointsDetailed(a.player).pStart;
                    if (pNoShow <= 0.02) return; // nailed-on starter, no realistic sub
                    total += benchXP[benchIdx] * pNoShow;
                    benchIdx++; // each bench player can only cover one absence
                });
            }

            return Math.round(total * 10) / 10;
        }

        function computeProjectedXIScore() {
            return computeProjectedTotalFor(snapshotXI, snapshotCaptainId, snapshotViceId, snapshotBenchOrder);
        }

        function renderSnapshotBody() {
            initSnapshotIfNeeded();
            const analysisMap = getSquadAnalysisMap();
            const xiAnalyses = [...snapshotXI].map(id => analysisMap.get(id)).filter(Boolean);
            const benchAnalyses = snapshotBenchOrder.map(id => analysisMap.get(id)).filter(Boolean);
            const byPos = pos => xiAnalyses.filter(a => a.player.position === pos);
            const projectedScore = computeProjectedXIScore();

            return `
            <div class="sq-snapshot" id="sq-snapshot-body">
                <div class="sq-snapshot-toolbar">
                    <button class="btn btn-primary sq-optimize-btn" onclick="runAutoOptimize()">✨ Auto-Optimize GW Lineup</button>
                    <div class="gw-toggle" role="group" aria-label="Which gameweek to show">
                        <button class="gw-toggle-btn ${snapshotViewMode === 'current' ? 'active' : ''}"
                            onclick="setSnapshotViewMode('current')"
                            data-tooltip="Points scored in Gameweek ${currentGW}, live while matches are on">📊 GW${currentGW} actual</button>
                        <button class="gw-toggle-btn ${snapshotViewMode === 'next' ? 'active' : ''}"
                            onclick="setSnapshotViewMode('next')"
                            data-tooltip="Projected points and the fixture coming up — what to plan against">🔮 Next GW</button>
                    </div>
                    <div class="sq-snapshot-score">${snapshotViewMode === 'next' ? 'Projected' : 'Projected'} Starting XI Score: <strong>${projectedScore}</strong> pts</div>
                </div>
                ${snapshotOptimizeSummary ? `<div class="sq-optimize-summary">✨ ${snapshotOptimizeSummary}</div>` : ''}
                <div class="pitch-field">
                    <div class="pitch-grass">
                        <div class="pitch-markings" aria-hidden="true">
                            <span class="pm-halfway"></span>
                            <span class="pm-circle"></span>
                            <span class="pm-box pm-box-top"></span>
                            <span class="pm-box-6 pm-box-6-top"></span>
                            <span class="pm-box pm-box-bottom"></span>
                            <span class="pm-box-6 pm-box-6-bottom"></span>
                        </div>
                        <div class="pitch-rows">
                            <div class="pitch-row">${byPos(4).map(a => renderSnapshotCard(a, false)).join('')}</div>
                            <div class="pitch-row">${byPos(3).map(a => renderSnapshotCard(a, false)).join('')}</div>
                            <div class="pitch-row">${byPos(2).map(a => renderSnapshotCard(a, false)).join('')}</div>
                            <div class="pitch-row">${byPos(1).map(a => renderSnapshotCard(a, false)).join('')}</div>
                        </div>
                    </div>
                    <!-- Bench lives inside the field wrapper so it reads as part of
                         the same surface rather than loose circles under it. -->
                    <div class="pitch-dugout">
                        <div class="dugout-label">Dugout · substitutes <span class="dugout-hint">order decides who comes on first</span></div>
                        <div class="dugout-cards">
                            ${benchAnalyses.map(a => {
                                // FPL substitutes in bench order, but a goalkeeper can
                                // only replace a goalkeeper — so his seat is labelled
                                // by role rather than by priority.
                                const isGk = a.player.position === 1;
                                const outfieldBefore = benchAnalyses
                                    .slice(0, benchAnalyses.indexOf(a))
                                    .filter(x => x.player.position !== 1).length;
                                const seat = isGk ? 'GK' : `Sub ${outfieldBefore + 1}`;
                                return `<div class="dugout-seat">
                                    <div class="dugout-seat-label">${seat}</div>
                                    ${renderSnapshotCard(a, true)}
                                </div>`;
                            }).join('')}
                        </div>
                    </div>
                </div>
            </div>`;
        }

        function teamBadgeUrl(teamId) {
            const code = teams[teamId]?.code;
            return code ? `https://resources.premierleague.com/premierleague/badges/50/t${code}.png` : '';
        }

        // A pre-kickoff number is a projection, not a score — showing a bare "2.4 pts"
        // next to a player who hasn't kicked off reads as though he's already scored
        // it. Label the projection as xP, and switch to real points with a LIVE/FT
        // marker once his match is under way.
        /* Which gameweek the pitch is describing.

           'current' answers "how am I doing?" — live or final points against the
           fixture being played. 'next' answers "what should I do?" — projected
           points against the fixture coming up. The page used to infer this from
           whether kick-off had passed, which is right on a Saturday and useless on
           a Tuesday when you are planning. */
        let snapshotViewMode = 'current';

        function setSnapshotViewMode(mode) {
            snapshotViewMode = mode === 'next' ? 'next' : 'current';
            refreshSnapshot();
        }

        // The fixture the card should show, given the mode.
        function snapshotFixtureFor(player) {
            if (snapshotViewMode === 'next') {
                // player.fixtures already excludes anything finished, so the head
                // of that list is the next one to be played.
                return (player.fixtures || [])[0] || null;
            }
            const f = (allFixtures || []).find(x =>
                x.event === currentGW && (x.team_h === player.teamId || x.team_a === player.teamId));
            if (!f) return (player.fixtures || [])[0] || null;
            const isHome = f.team_h === player.teamId;
            return {
                opponent: teams[isHome ? f.team_a : f.team_h]?.short_name || '???',
                isHome,
                difficulty: isHome ? f.team_h_difficulty : f.team_a_difficulty,
                event: f.event
            };
        }

        function getPlayerGwState(player) {
            // Planning mode always shows the projection, whatever the clock says.
            if (snapshotViewMode === 'next') {
                const nf = (player.fixtures || [])[0];
                return {
                    cls: 'xp',
                    value: `${predictedGWPoints(player).toFixed(1)} xP`,
                    note: nf ? `GW${nf.event}` : 'Blank'
                };
            }

            const fixtures = (allFixtures || []).filter(f =>
                f.event === currentGW && (f.team_h === player.teamId || f.team_a === player.teamId));

            if (!fixtures.length) {
                return { cls: 'xp', value: `${predictedGWPoints(player).toFixed(1)} xP`, note: 'Blank GW' };
            }

            const anyStarted = fixtures.some(f => f.started);
            if (!anyStarted) {
                const ko = fixtures[0].kickoff_time ? new Date(fixtures[0].kickoff_time) : null;
                let note = '';
                if (ko && !isNaN(ko)) {
                    const today = new Date();
                    const sameDay = ko.toDateString() === today.toDateString();
                    const time = ko.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    note = sameDay ? `Today ${time}` : ko.toLocaleDateString([], { weekday: 'short' }) + ` ${time}`;
                }
                return { cls: 'xp', value: `${predictedGWPoints(player).toFixed(1)} xP`, note };
            }

            // Match started — report what he's actually scored where we have it.
            const history = (playersDetailData?.players || []).find(x => x.id === player.id)?.history || [];
            const rows = history.filter(h => h.round === currentGW);
            const pts = rows.length ? rows.reduce((s, h) => s + (h.total_points || 0), 0) : null;
            const allDone = fixtures.every(f => f.finished_provisional);
            return {
                cls: allDone ? 'final' : 'live',
                value: pts != null ? `${pts} Pts` : '— Pts',
                note: allDone ? 'FT' : 'LIVE'
            };
        }

        function renderSnapshotCard(a, isBench) {
            const p = a.player;
            const injured = p.status === 'i' || p.status === 'u';
            const isCap = p.id === snapshotCaptainId;
            const isVice = p.id === snapshotViceId;
            const isSwapSelected = snapshotSwapSource === p.id;
            const gw = getPlayerGwState(p);
            const nextFx = snapshotFixtureFor(p);
            const fixtureTag = nextFx
                ? `<span class="pcard-fixture fdr-${nextFx.difficulty || 3}">${escHTML(nextFx.opponent)} <em>${nextFx.isHome ? 'H' : 'A'}</em></span>`
                : `<span class="pcard-fixture fdr-3">No fixture</span>`;

            // Mid-swap, mark every legal destination and dim the rest. Making the
            // formation rule visible is what replaced the instruction text.
            let swapClass = '';
            let swapTitle = 'Click or drag to swap';
            if (snapshotSwapSource !== null) {
                if (isSwapSelected) {
                    swapClass = 'swap-selected';
                    swapTitle = 'Click again to cancel';
                } else if (canSnapshotSwap(snapshotSwapSource, p.id)) {
                    swapClass = 'swap-target';
                    const src = getSquadAnalysisMap().get(snapshotSwapSource);
                    swapTitle = src ? `Swap with ${src.player.name}` : 'Valid swap';
                } else {
                    swapClass = 'swap-blocked';
                    swapTitle = 'Would leave an invalid formation';
                }
            }

            const badge = teamBadgeUrl(p.teamId);
            return `<div class="pcard ${a.verdict} ${isBench ? 'pcard-bench' : ''} ${swapClass} ${injured ? 'pcard-injured' : ''}"
                    draggable="true"
                    onclick="snapshotSwapClick(${p.id})"
                    ondragstart="snapshotDragStart(event, ${p.id})"
                    ondragover="snapshotDragOver(event, ${p.id})"
                    ondrop="snapshotDrop(event, ${p.id})"
                    ondragend="snapshotDragEnd()"
                    title="${escHTML(swapTitle)}">
                ${isCap ? '<span class="pcard-armband cap" title="Captain — points doubled">C</span>'
                        : isVice ? '<span class="pcard-armband vice" title="Vice-captain — takes the armband if the captain does not play">V</span>' : ''}
                <div class="pcard-cv" role="group" aria-label="Set captain or vice">
                    <button class="cv-toggle cap ${isCap ? 'active' : ''}" onclick="event.stopPropagation(); setSnapshotCaptain(${p.id})" title="Make ${escHTML(p.name)} captain">Set C</button>
                    <button class="cv-toggle vice ${isVice ? 'active' : ''}" onclick="event.stopPropagation(); setSnapshotVice(${p.id})" title="Make ${escHTML(p.name)} vice-captain">Set V</button>
                </div>
                <div class="pcard-crest">
                    ${badge ? `<img src="${badge}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
                    <span class="pcard-crest-fallback">${escHTML(p.team)}</span>
                    ${injuryBadge(p)}
                    ${marketBadge(p)}
                </div>
                <div class="pcard-name">${escHTML(p.name)}</div>
                ${fixtureTag}
                <div class="pcard-pts ${gw.cls}">${escHTML(gw.value)}${gw.note ? `<span class="pcard-pts-note">${escHTML(gw.note)}</span>` : ''}</div>
            </div>`;
        }

        function refreshSnapshot() {
            const el = document.getElementById('sq-snapshot-body');
            if (el) el.outerHTML = renderSnapshotBody();
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        // Click-to-swap: first click selects a source player, a second click on a
        // different player in the SAME POSITION performs the swap (XI<->bench or
        // reorders bench), clicking the same player again cancels. Cross-position
        // formation changes are handled separately by Auto-Optimize (solveQuickLineup),
        // so same-position-only here means we never need to re-validate formation legality.
        // Is moving these two players legal? Previously this was "same position
        // only", which blocked plenty of real FPL moves — bringing a forward on for
        // a midfielder is fine as long as the XI still has 1 GK / 3+ DEF / 2+ MID /
        // 1+ FWD. Now the resulting formation is simulated and checked instead, so
        // the pitch can highlight exactly what's droppable.
        function canSnapshotSwap(sourceId, targetId) {
            if (sourceId == null || targetId == null || sourceId === targetId) return false;
            const map = getSquadAnalysisMap();
            const src = map.get(sourceId), tgt = map.get(targetId);
            if (!src || !tgt) return false;

            const srcInXI = snapshotXI.has(sourceId);
            const tgtInXI = snapshotXI.has(targetId);

            // Both benched: reordering the substitute priority is always allowed.
            if (!srcInXI && !tgtInXI) return true;
            // Both starting: nothing would change on the pitch.
            if (srcInXI && tgtInXI) return false;

            // After the swap each of the two changes sides, so its new onBench flag
            // equals whether it was in the XI before (in XI -> now benched, and
            // vice versa). Everyone else keeps their current side.
            const simulated = analysisResults.map(a => ({
                position: a.player.position,
                onBench: a.player.id === sourceId ? srcInXI
                       : a.player.id === targetId ? tgtInXI
                       : !snapshotXI.has(a.player.id)
            }));
            return isValidFormation(simulated);
        }

        // The pitch keeps its own lineup state (snapshotXI / captain / bench order)
        // so what-if swaps stay cheap. Everything else on the page still reads the
        // isCaptain / isVice / onBench flags, so committed changes have to be
        // written back or the two views disagree.
        function syncSnapshotToSquad() {
            selectedPlayers.forEach(p => {
                p.onBench = !snapshotXI.has(p.id);
                p.isCaptain = p.id === snapshotCaptainId;
                p.isVice = p.id === snapshotViceId;
                p.multiplier = p.isCaptain ? 2 : (p.onBench ? 0 : 1);
            });
            // Bench order drives who comes on first for auto-subs.
            snapshotBenchOrder.forEach((id, i) => {
                const p = selectedPlayers.find(q => q.id === id);
                if (p) p.pickPosition = 12 + i;
            });
            analysisResults = selectedPlayers.map(player => analyzePlayer(player));
        }

        function performSnapshotSwap(sourceId, targetId) {
            if (!canSnapshotSwap(sourceId, targetId)) {
                updateStatus('That swap would leave an invalid formation', 'error');
                snapshotSwapSource = null;
                refreshSnapshot();
                return;
            }

            const srcInXI = snapshotXI.has(sourceId);
            const tgtInXI = snapshotXI.has(targetId);
            if (srcInXI === tgtInXI) {
                const i = snapshotBenchOrder.indexOf(sourceId), j = snapshotBenchOrder.indexOf(targetId);
                if (i > -1 && j > -1) {
                    [snapshotBenchOrder[i], snapshotBenchOrder[j]] = [snapshotBenchOrder[j], snapshotBenchOrder[i]];
                }
            } else if (srcInXI) {
                snapshotXI.delete(sourceId); snapshotXI.add(targetId);
                snapshotBenchOrder[snapshotBenchOrder.indexOf(targetId)] = sourceId;
            } else {
                snapshotXI.delete(targetId); snapshotXI.add(sourceId);
                snapshotBenchOrder[snapshotBenchOrder.indexOf(sourceId)] = targetId;
            }
            snapshotSwapSource = null;
            snapshotOptimizeSummary = '';
            snapshotOptimizeReport = null;
            reconcileArmbands();
            syncSnapshotToSquad();
            renderTeamAnalysis();
        }

        function snapshotSwapClick(playerId) {
            if (snapshotSwapSource === null) {
                snapshotSwapSource = playerId;
                refreshSnapshot();
                return;
            }
            const sourceId = snapshotSwapSource;
            if (sourceId === playerId) { snapshotSwapSource = null; refreshSnapshot(); return; }
            performSnapshotSwap(sourceId, playerId);
        }

        // ===== DRAG & DROP =====
        let snapshotDragId = null;

        function snapshotDragStart(event, playerId) {
            snapshotDragId = playerId;
            snapshotSwapSource = playerId; // reuse the same highlight pass as click-to-swap
            try { event.dataTransfer.setData('text/plain', String(playerId)); } catch (e) { /* older browsers */ }
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
            refreshSnapshot();
        }

        function snapshotDragOver(event, playerId) {
            if (snapshotDragId === null || !canSnapshotSwap(snapshotDragId, playerId)) return;
            event.preventDefault(); // only a preventDefault'd dragover accepts a drop
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        }

        function snapshotDrop(event, playerId) {
            event.preventDefault();
            const sourceId = snapshotDragId;
            snapshotDragId = null;
            if (sourceId === null || sourceId === playerId) {
                snapshotSwapSource = null;
                refreshSnapshot();
                return;
            }
            performSnapshotSwap(sourceId, playerId);
        }

        function snapshotDragEnd() {
            if (snapshotDragId === null) return; // a successful drop already tidied up
            snapshotDragId = null;
            snapshotSwapSource = null;
            refreshSnapshot();
        }

        /* The armband has to stay on the pitch.

           Swapping a captain to the bench left snapshotCaptainId pointing at him,
           so the card kept its C and the projection kept paying the armband to
           someone who was no longer in the eleven. Promote the vice if he is
           available, otherwise hand it to the best projected starter, and never
           leave captain and vice as the same player. */
        function reconcileArmbands() {
            const map = getSquadAnalysisMap();
            const inXI = id => id != null && snapshotXI.has(id);
            const bestStarter = exclude => [...snapshotXI]
                .filter(id => id !== exclude)
                .map(id => map.get(id))
                .filter(Boolean)
                .sort((a, b) => predictedGWPoints(b.player) - predictedGWPoints(a.player))[0];

            if (!inXI(snapshotCaptainId)) {
                // Vice steps up if he is starting; otherwise the best available.
                if (inXI(snapshotViceId)) {
                    snapshotCaptainId = snapshotViceId;
                    snapshotViceId = null;
                } else {
                    const pick = bestStarter(null);
                    snapshotCaptainId = pick ? pick.player.id : null;
                }
            }
            if (!inXI(snapshotViceId) || snapshotViceId === snapshotCaptainId) {
                const pick = bestStarter(snapshotCaptainId);
                snapshotViceId = pick ? pick.player.id : null;
            }
        }

        function setSnapshotCaptain(playerId) {
            if (snapshotViceId === playerId) snapshotViceId = null;
            snapshotCaptainId = playerId;
            refreshSnapshot();
        }

        function setSnapshotVice(playerId) {
            if (snapshotCaptainId === playerId) snapshotCaptainId = null;
            snapshotViceId = playerId;
            refreshSnapshot();
        }

        // ✨ Auto-Optimize: reuses the Lineup Wizard's formation-valid solver
        // (solveQuickLineup already only tries real FPL formations — 1 GK, min 3 DEF,
        // min 1 FWD — never a blind top-11-scorers pick), ranking players by the
        // same projected points the cards and the headline score show, so the gain
        // it reports is the change the manager can actually see.
        // Everything the optimizer decided, kept so the report can explain itself
        // rather than just asserting a conclusion.
        let snapshotOptimizeReport = null;

        function describeFormation(players) {
            const n = pos => players.filter(p => p.position === pos).length;
            return `${n(2)}-${n(3)}-${n(4)}`;
        }

        function runAutoOptimize() {
            // Snapshot the lineup as it stood BEFORE optimising, so the xP delta is
            // measured against what the manager actually had, not against itself.
            // Initialise first: measuring against an empty XI reports the whole
            // lineup as the gain and finds nothing to have been dropped.
            initSnapshotIfNeeded();
            const beforeXI = new Set(snapshotXI);
            const beforeCaptainId = snapshotCaptainId;
            const analysisMap = getSquadAnalysisMap();
            // Same maths as the on-screen "Projected Starting XI Score", so the
            // reported gain equals the change the manager can see in that figure.
            const beforeXP = computeProjectedTotalFor(beforeXI, beforeCaptainId, snapshotViceId, snapshotBenchOrder);

            const beforeViceId = snapshotViceId;
            const beforeBenchOrder = [...snapshotBenchOrder];

            // Rank by the same expected points the headline and the report show.
            // computeQuickLineupScoreDetailed stays as the source of the "why"
            // behind each decision, but its heuristic blend (ep x3 + form x2 +
            // fixture x5 + xGI x10 ...) is a different quantity on a different
            // scale — maximising it could, and did, hand back an XI that scored
            // lower on the xP the feature reports as its gain.
            const pool = analysisResults.map(a => {
                const p = a.player;
                const detailed = computeQuickLineupScoreDetailed(p);
                return Object.assign({}, p, {
                    pos: p.position,
                    // solveQuickLineup drops anyone at or below -100; keep that
                    // exclusion for injured/suspended players, whose xP is just 0.
                    lwScore: detailed.total <= -100 ? -1000 : predictedGWPoints(p),
                    _detailed: detailed
                });
            });
            const result = solveQuickLineup(pool);
            snapshotXI = new Set(result.xi.map(p => p.id));
            snapshotBenchOrder = result.bench.map(p => p.id);

            // Rank captaincy by projected points — the thing being maximised — not by
            // the internal ranking score, so the report's numbers match the cards.
            const sortedXI = [...result.xi].sort((a, b) => predictedGWPoints(b) - predictedGWPoints(a));
            snapshotCaptainId = sortedXI[0] ? sortedXI[0].id : null;
            snapshotViceId = sortedXI[1] ? sortedXI[1].id : null;

            let afterXP = computeProjectedTotalFor(snapshotXI, snapshotCaptainId, snapshotViceId, snapshotBenchOrder);

            // Safety net: a feature that promises a gain must never hand back a
            // worse lineup. The XI sum can only improve now that the solver ranks
            // on xP, but the auto-sub term is not part of what it maximises, so
            // put the manager's own lineup back rather than report a loss.
            let keptOriginal = false;
            if (afterXP < beforeXP - 0.05) {
                snapshotXI = beforeXI;
                snapshotBenchOrder = beforeBenchOrder;
                snapshotCaptainId = beforeCaptainId;
                snapshotViceId = beforeViceId;
                afterXP = beforeXP;
                keptOriginal = true;
            }

            // Only players who actually moved from the XI to the bench, each paired
            // 1:1 with a promotion drawn from a shared pool — picking independently
            // let one promoted player be credited as the replacement for two drops.
            const promotedPool = (keptOriginal ? [] : result.xi)
                .filter(p => !beforeXI.has(p.id))
                .sort((x, y) => predictedGWPoints(y) - predictedGWPoints(x));
            const benchedOut = (keptOriginal ? [] : result.bench)
                .filter(p => beforeXI.has(p.id))
                .sort((x, y) => predictedGWPoints(y) - predictedGWPoints(x))
                .map(p => ({ player: p, detailed: p._detailed, replacedBy: null }));

            // Like-for-like swaps first; whatever is left over is a shape change,
            // where a slot in one line became a slot in another.
            benchedOut.forEach(entry => {
                const i = promotedPool.findIndex(q => q.position === entry.player.position);
                if (i >= 0) entry.replacedBy = promotedPool.splice(i, 1)[0];
            });
            benchedOut.forEach(entry => {
                if (!entry.replacedBy && promotedPool.length) {
                    entry.replacedBy = promotedPool.shift();
                    entry.shapeChange = true;
                }
            });

            // On the revert path the report has to describe the lineup actually on
            // the pitch — the manager's own — not the solution that was discarded.
            const finalXI = [...snapshotXI].map(id => analysisMap.get(id)).filter(Boolean).map(a => a.player);
            const finalSorted = keptOriginal
                ? finalXI.sort((a, b) => predictedGWPoints(b) - predictedGWPoints(a))
                : sortedXI;

            snapshotOptimizeReport = {
                formation: keptOriginal ? describeFormation(finalXI) : result.formation,
                beforeXP, afterXP,
                gain: afterXP - beforeXP,
                captain: finalSorted[0] || null,
                captainAlternatives: finalSorted.slice(1, 3),
                // Kept for the full report: the whole XI in xP order, the bench in
                // substitution order, and every shape the solver scored.
                xi: finalSorted,
                benchOrder: snapshotBenchOrder.map(id => (analysisMap.get(id) || {}).player).filter(Boolean),
                captainShortlist: finalSorted.slice(0, 5),
                formationScores: keptOriginal ? [] : (result.formationScores || []),
                viceId: snapshotViceId,
                previousCaptain: beforeCaptainId != null ? analysisMap.get(beforeCaptainId) : null,
                benchedOut,
                promoted: keptOriginal ? [] : result.xi.filter(p => !beforeXI.has(p.id))
            };

            snapshotOptimizeSummary = buildOptimizeSummary(snapshotOptimizeReport);

            // Auto-Optimize applies a lineup rather than previewing one, so push it
            // back onto the squad itself and re-render. Without this the insight
            // sidebar keeps advising the very changes the optimizer just made
            // ("Change captain to X") because it reads the original picks.
            syncSnapshotToSquad();
            renderTeamAnalysis();
            updateStatus(keptOriginal
                ? 'Your lineup was already the strongest available'
                : `Lineup optimized (${result.formation})`, 'success');
        }

        // Leads with the number that answers "was this worth doing?", then names the
        // decisions, then offers the detail behind them — rather than asserting one
        // reason for one player and leaving the rest unexplained.
        function buildOptimizeSummary(report) {
            if (!report) return '';
            const gain = report.gain;
            const headline = gain > 0.05
                ? `AI Lineup Optimized <strong>(Gained +${gain.toFixed(1)} xP)</strong>`
                : `AI Lineup checked — <strong>your XI was already optimal</strong>`;

            const bits = [];
            if (report.captain) {
                const changed = !report.previousCaptain || report.previousCaptain.player.id !== report.captain.id;
                bits.push(`${changed ? 'Captained' : 'Kept the armband on'} ${escHTML(report.captain.name)}.`);
            }
            if (report.benchedOut.length) {
                const all = report.benchedOut.map(b => escHTML(b.player.name));
                const names = all.length > 1
                    ? `${all.slice(0, -1).join(', ')} &amp; ${all[all.length - 1]}`
                    : all[0];
                bits.push(`Benched ${names}.`);
            }

            return `<span class="opt-summary-text">${headline}. ${bits.join(' ')}</span>
                <button class="opt-report-btn" onclick="openOptimizeReport()">📊 View Full Report</button>`;
        }

        // ===== OPTIMIZATION REPORT MODAL =====
        function optFdrFor(player) {
            const fx = (player.fixtures || [])[0];
            return fx ? (fx.difficulty || 3) : 3;
        }

        function optFixtureLabel(player) {
            const fx = (player.fixtures || [])[0];
            return fx ? `${escHTML(fx.opponent)} (${fx.isHome ? 'H' : 'A'})` : '—';
        }

        // Where a player's projected points actually come from. Showing the split
        // is the difference between "trust me, 6.2" and a number you can argue with.
        function optXpBreakdown(p) {
            const d = projectPlayerPointsDetailed(p);
            const parts = [
                { key: 'Mins', v: d.appearance },
                { key: 'Attack', v: d.attack },
                { key: 'CS', v: d.cleanSheet },
                { key: 'Saves', v: d.saves },
                { key: 'Bonus', v: d.bonus },
                // Defensive contribution and cards were both missing here, so the
                // legend did not add up to the xP printed beside it.
                { key: 'DefCon', v: d.defCon },
                { key: 'Conceded', v: d.conceded },
                { key: 'Cards', v: d.cards }
            ].filter(x => Math.abs(x.v) >= 0.05);
            return { detailed: d, parts };
        }

        function optBreakdownBar(p) {
            const { detailed, parts } = optXpBreakdown(p);
            const total = Math.max(0.01, parts.filter(x => x.v > 0).reduce((s, x) => s + x.v, 0));
            const seg = parts.filter(x => x.v > 0).map(x =>
                `<span class="opt-seg opt-seg-${x.key.toLowerCase()}" style="width:${Math.round((x.v / total) * 100)}%"
                    data-tooltip="${x.key}: ${x.v.toFixed(2)} xP"></span>`).join('');
            return `<div class="opt-bar">${seg}</div>
                <div class="opt-bar-legend">${parts.map(x => `${escHTML(x.key)} <strong>${x.v.toFixed(1)}</strong>`).join(' · ')}</div>`;
        }

        // Starter likelihood in words. A 6.0 xP player who might not start is a
        // different proposition from a 6.0 xP nailed-on one.
        function optMinutesRisk(p) {
            const { pStart } = expectedMinutesModel(p);
            const pct = Math.round(pStart * 100);
            const cls = pct >= 80 ? 'great' : pct >= 60 ? 'good' : pct >= 35 ? 'ok' : 'bad';
            const word = pct >= 80 ? 'Nailed' : pct >= 60 ? 'Likely' : pct >= 35 ? 'Rotation risk' : 'Unlikely';
            return { pct, cls, word };
        }

        function optTeamContext(p, ranks) {
            const ta = teamAnalysis[p.teamId];
            const fx = (p.fixtures || teamFixtures[p.teamId] || [])[0];
            const ctx = fx ? opponentContext(p.teamId, fx, ranks) : null;
            return { ta, fx, ctx };
        }

        function renderOptimizeReportModal() {
            const r = snapshotOptimizeReport;
            if (!r) return '<div class="detail-section">Run Auto-Optimize to see a report.</div>';

            const ranks = getDefensiveRanks();
            const xi = (r.xi && r.xi.length) ? r.xi : [...snapshotXI].map(id => (getSquadAnalysisMap().get(id) || {}).player).filter(Boolean);
            const bench = r.benchOrder || [];

            // ---------- 1. Squad outlook: the shape of the whole lineup ----------
            const xiXP = xi.reduce((s, p) => s + predictedGWPoints(p), 0);
            const starts = xi.map(p => expectedMinutesModel(p).pStart);
            const expectedAbsent = starts.reduce((s, v) => s + (1 - v), 0);
            const doubts = xi.filter(p => p.status === 'd');
            const nailed = starts.filter(v => v >= 0.8).length;
            const risky = xi.filter(p => expectedMinutesModel(p).pStart < 0.6);

            const byTeam = {};
            xi.forEach(p => { byTeam[p.teamId] = (byTeam[p.teamId] || 0) + 1; });
            const stacked = Object.keys(byTeam).filter(t => byTeam[t] >= 3)
                .map(t => `${teams[t]?.short_name || '???'} (${byTeam[t]})`);

            const fdrs = xi.map(p => optFdrFor(p));
            const hardCount = fdrs.filter(f => f >= 4).length;
            const easyCount = fdrs.filter(f => f <= 2).length;
            const avgFdr = fdrs.length ? fdrs.reduce((s, f) => s + f, 0) / fdrs.length : 3;

            const outlook = `
            <div class="opt-grid">
                <div class="opt-stat"><div class="opt-stat-v">${xiXP.toFixed(1)}</div><div class="opt-stat-l" data-tooltip="Sum of projected points across the eleven starters, before the captain's double.">XI xP</div></div>
                <div class="opt-stat"><div class="opt-stat-v">${nailed}<span class="opt-stat-sub">/11</span></div><div class="opt-stat-l" data-tooltip="Starters with at least an 80% chance of starting, based on minutes per appearance and fitness.">Nailed on</div></div>
                <div class="opt-stat"><div class="opt-stat-v">${expectedAbsent.toFixed(1)}</div><div class="opt-stat-l" data-tooltip="Expected number of your eleven who do not start. This is what the bench order is insurance against.">Expected absent</div></div>
                <div class="opt-stat"><div class="opt-stat-v">${avgFdr.toFixed(1)}</div><div class="opt-stat-l" data-tooltip="Average fixture difficulty faced by the starting eleven this gameweek.">Avg FDR</div></div>
            </div>
            <div class="opt-why">
                ${easyCount} of the eleven face a difficulty-2-or-easier fixture and ${hardCount} face a 4 or harder.
                ${stacked.length ? `You are stacked on ${escHTML(stacked.join(', '))} — a strong week for them lifts the whole team, a poor one sinks it.` : 'No club supplies three or more of your starters, so the week is spread across teams.'}
                ${doubts.length ? ` <strong>${doubts.length} carry a fitness doubt</strong> (${escHTML(doubts.map(p => p.name).join(', '))}).` : ''}
            </div>`;

            // ---------- 2. Captaincy, with the reasoning behind each candidate ----------
            const shortlist = (r.captainShortlist && r.captainShortlist.length ? r.captainShortlist : [r.captain, ...r.captainAlternatives]).filter(Boolean);
            const capRows = shortlist.map((p, i) => {
                const form = isPreseason ? (p.ppg || 0) : (parseFloat(p.form) || 0);
                const risk = optMinutesRisk(p);
                const { ctx } = optTeamContext(p, ranks);
                const isVice = p.id === r.viceId;
                return `<tr class="${i === 0 ? 'opt-pick' : ''}">
                    <td>${i === 0 ? '👑 ' : isVice ? '🅥 ' : ''}${escHTML(p.name)}${i === 0 ? ' <span class="opt-tag">AI pick</span>' : isVice ? ' <span class="opt-tag vice">Vice</span>' : ''}
                        <div class="opt-cap-sub">${escHTML(p.team)} · ${p.ownership != null ? `${p.ownership}% owned` : ''}${ctx && ctx.ranked ? ` · opponent concedes ${ctx.conceded.toFixed(1)}/game` : ''}</div></td>
                    <td class="opt-num">${predictedGWPoints(p).toFixed(1)}</td>
                    <td class="opt-num">${form.toFixed(1)}</td>
                    <td class="opt-num"><span class="opt-risk ${risk.cls}" data-tooltip="${risk.pct}% likely to start — ${risk.word}.">${risk.pct}%</span></td>
                    <td><span class="fixture-chip fdr-${optFdrFor(p)}">${optFixtureLabel(p)}</span></td>
                </tr>`;
            }).join('');

            const capLead = r.captain && shortlist[1]
                ? (predictedGWPoints(r.captain) - predictedGWPoints(shortlist[1]))
                : 0;
            const capBreakdown = r.captain ? optBreakdownBar(r.captain) : '';
            const capRisk = r.captain ? optMinutesRisk(r.captain) : null;

            // ---------- 3. The starting eleven, each with its points split ----------
            const xiRows = xi.map(p => {
                const risk = optMinutesRisk(p);
                const { ctx } = optTeamContext(p, ranks);
                const isCap = r.captain && p.id === r.captain.id;
                return `<div class="opt-xi-row">
                    <div class="opt-xi-head">
                        <span class="position-badge ${POSITION_CONFIG[p.position].class}">${POSITION_CONFIG[p.position].short}</span>
                        <span class="opt-xi-name">${isCap ? '👑 ' : p.id === r.viceId ? '🅥 ' : ''}${escHTML(p.name)}</span>
                        <span class="opt-xi-team">${escHTML(p.team)}</span>
                        <span class="fixture-chip fdr-${optFdrFor(p)}">${optFixtureLabel(p)}</span>
                        <span class="opt-xi-xp">${predictedGWPoints(p).toFixed(1)}<span class="opt-xi-xp-unit">xP</span></span>
                    </div>
                    <div class="opt-xi-meta">
                        <span class="opt-risk ${risk.cls}" data-tooltip="${risk.pct}% likely to start.">${risk.word} ${risk.pct}%</span>
                        ${ctx && ctx.ranked ? `<span data-tooltip="How leaky this opponent's defence is across the league.">Opponent ${ordinal(ctx.rank)} leakiest</span>` : ''}
                        ${p.status === 'd' ? `<span class="opt-flag">Fitness doubt${p.chanceNextRound != null ? ` (${p.chanceNextRound}%)` : ''}</span>` : ''}
                    </div>
                    ${optBreakdownBar(p)}
                </div>`;
            }).join('');

            // ---------- 4. Bench decisions and the order behind them ----------
            const benchRows = r.benchedOut.length ? r.benchedOut.map(b => {
                const p = b.player;
                const d = b.detailed || {};
                const reasons = [];
                if (d.fixture < -3 || optFdrFor(p) >= 4) reasons.push(`tough fixture vs ${optFixtureLabel(p)}`);
                if (d.matchup < -1.5) reasons.push('unfavourable team matchup');
                const form = isPreseason ? (p.ppg || 0) : (parseFloat(p.form) || 0);
                if (form < 3) reasons.push(`weak form (${form.toFixed(1)})`);
                if (p.status === 'd') reasons.push('fitness doubt');
                const risk = optMinutesRisk(p);
                if (risk.pct < 60) reasons.push(`only ${risk.pct}% likely to start`);
                if (!reasons.length) reasons.push('a higher-projected option was available');
                const swap = b.replacedBy
                    ? ` — ${b.shapeChange ? 'slot given to' : 'replaced by'} <strong>${escHTML(b.replacedBy.name)}</strong> (${predictedGWPoints(b.replacedBy).toFixed(1)} xP${b.shapeChange ? `, ${POS_SHORT_MAP[b.replacedBy.position]}` : ''})`
                    : '';
                return `<div class="opt-bench-row">
                    <div class="opt-bench-head"><strong>${escHTML(p.name)}</strong> (${predictedGWPoints(p).toFixed(1)} xP) benched${swap}</div>
                    <div class="opt-bench-why">${escHTML(reasons.join(' · '))}</div>
                </div>`;
            }).join('') : `<div class="opt-empty">No one was dropped — your starting XI already had the best available players in it.</div>`;

            const benchOrderHtml = bench.length ? `
                <div class="opt-suborder">
                    <div class="opt-suborder-head">Substitution order</div>
                    ${bench.map((p, i) => {
                        const risk = optMinutesRisk(p);
                        return `<div class="opt-suborder-row">
                            <span class="opt-suborder-n">${p.position === 1 ? 'GK' : i + 1}</span>
                            <span class="opt-suborder-name">${escHTML(p.name)}</span>
                            <span class="opt-suborder-team">${escHTML(p.team)}</span>
                            <span class="fixture-chip fdr-${optFdrFor(p)}">${optFixtureLabel(p)}</span>
                            <span class="opt-suborder-xp">${predictedGWPoints(p).toFixed(1)} xP</span>
                            <span class="opt-risk ${risk.cls}">${risk.pct}%</span>
                        </div>`;
                    }).join('')}
                    <div class="opt-why">Around <strong>${expectedAbsent.toFixed(1)}</strong> of your eleven are expected not to start, so the order above is what actually decides your auto-substitutions.</div>
                </div>` : '';

            // ---------- 5. Formation, and the shapes that lost ----------
            const byPos = pos => xi.filter(p => p.position === pos);
            const posXP = pos => byPos(pos).reduce((s, p) => s + predictedGWPoints(p), 0);
            const shape = describeFormation(xi);
            const blocks = [
                { label: 'Defenders', xp: posXP(2), n: byPos(2).length },
                { label: 'Midfielders', xp: posXP(3), n: byPos(3).length },
                { label: 'Forwards', xp: posXP(4), n: byPos(4).length },
            ];
            const totalXP = blocks.reduce((s, b) => s + b.xp, 0);
            const biggest = blocks.reduce((a, b) => (b.xp > a.xp ? b : a), blocks[0]);
            const perSlot = b => (b.n ? b.xp / b.n : 0);
            const bestRate = blocks.reduce((a, b) => (perSlot(b) > perSlot(a) ? b : a), blocks[0]);

            // The runners-up, so the choice reads as a decision rather than a decree.
            const alt = (r.formationScores || []).slice(0, 4);
            const altHtml = alt.length > 1 ? `
                <div class="opt-alt">
                    <div class="opt-alt-head">Shapes considered</div>
                    ${alt.map((f, i) => `<div class="opt-alt-row ${i === 0 ? 'win' : ''}">
                        <span>${escHTML(f.formation)}</span>
                        <span class="opt-alt-bar"><span style="width:${Math.round((f.total / Math.max(alt[0].total, 0.01)) * 100)}%"></span></span>
                        <span class="opt-alt-n">${f.total.toFixed(1)}${i === 0 ? '' : ` (−${(alt[0].total - f.total).toFixed(1)})`}</span>
                    </div>`).join('')}
                </div>` : '';

            // ---------- 6. What could go wrong ----------
            const warnings = [];
            if (capRisk && capRisk.pct < 80) warnings.push(`Your captain is only <strong>${capRisk.pct}%</strong> likely to start — a blank there costs double.`);
            if (risky.length) warnings.push(`<strong>${risky.length}</strong> starter${risky.length > 1 ? 's are' : ' is'} under 60% to start: ${escHTML(risky.map(p => p.name).join(', '))}.`);
            if (hardCount >= 4) warnings.push(`<strong>${hardCount}</strong> of the eleven face a difficulty-4-or-harder fixture.`);
            if (stacked.length) warnings.push(`Three or more starters from ${escHTML(stacked.join(', '))} concentrates your week on one result.`);
            if (bench.filter(p => p.position !== 1).every(p => optMinutesRisk(p).pct < 50)) warnings.push('Your outfield bench is unlikely to start either, so auto-subs may not rescue a blank.');
            const warnHtml = warnings.length
                ? `<ul class="opt-warn">${warnings.map(w => `<li>${w}</li>`).join('')}</ul>`
                : `<div class="opt-empty">Nothing structural to flag — the eleven are fit, spread across clubs, and mostly nailed on.</div>`;

            return `
            <div class="detail-section">
                <div class="opt-headline ${r.gain > 0.05 ? 'gain' : 'flat'}">
                    ${r.gain > 0.05
                        ? `<span class="opt-gain">+${r.gain.toFixed(1)} xP</span><span>projected gain from this optimization</span>`
                        : `<span class="opt-gain">No change</span><span>your lineup was already the best available</span>`}
                    <div class="opt-beforeafter">${r.beforeXP.toFixed(1)} xP before · ${r.afterXP.toFixed(1)} xP after <span class="opt-note">(includes the captain's double)</span></div>
                </div>
            </div>

            <div class="detail-section">
                <div class="detail-section-title">🧭 Squad outlook</div>
                ${outlook}
            </div>

            <div class="detail-section">
                <div class="detail-section-title">👑 Captaincy decision</div>
                <table class="opt-table">
                    <thead><tr><th>Player</th><th class="opt-num">xP</th><th class="opt-num">Form</th><th class="opt-num">Start</th><th>Fixture</th></tr></thead>
                    <tbody>${capRows}</tbody>
                </table>
                ${r.captain ? `<div class="opt-why">${escHTML(r.captain.name)} projects ${capLead > 0.05 ? `<strong>+${capLead.toFixed(1)} xP</strong> more than the next best option` : 'level with the alternatives'}, and the armband doubles it.
                    ${capRisk ? `They are ${capRisk.pct}% likely to start.` : ''}</div>
                    <div class="opt-capbreak"><div class="opt-capbreak-head">Where the captain's points come from</div>${capBreakdown}</div>` : ''}
            </div>

            <div class="detail-section">
                <div class="detail-section-title">📋 Starting eleven</div>
                <div class="opt-why">Each bar splits that player's projection into where the points are expected to come from.</div>
                ${xiRows}
            </div>

            <div class="detail-section">
                <div class="detail-section-title">🔄 Bench decisions</div>
                ${benchRows}
                ${benchOrderHtml}
            </div>

            <div class="detail-section">
                <div class="detail-section-title">📐 Formation check</div>
                <div class="opt-formation">${escHTML(shape)}</div>
                <div class="opt-why">
                    ${blocks.map(b => `${b.label}: <strong>${b.xp.toFixed(1)} xP</strong> from ${b.n}`).join(' · ')}.
                    Playing ${escHTML(shape)} puts the bulk of your projected points in ${escHTML(biggest.label.toLowerCase())}
                    (<strong>${biggest.xp.toFixed(1)}</strong> of ${totalXP.toFixed(1)} xP outfield).
                    ${bestRate !== biggest && bestRate.n
                        ? `Per slot your ${escHTML(bestRate.label.toLowerCase())} pay best, at ${perSlot(bestRate).toFixed(1)} xP each.`
                        : `That is also your best return per slot, at ${perSlot(biggest).toFixed(1)} xP each.`}
                </div>
                ${altHtml}
            </div>

            <div class="detail-section">
                <div class="detail-section-title">⚠️ Risks in this lineup</div>
                ${warnHtml}
            </div>`;
        }

        function openOptimizeReport() {
            document.getElementById('optReportBody').innerHTML = renderOptimizeReportModal();
            document.getElementById('optReportOverlay').classList.add('show');
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        function closeOptimizeReport(event) {
            if (event && event.target !== event.currentTarget) return;
            document.getElementById('optReportOverlay').classList.remove('show');
        }

        // ===== SHARED: open the AI Scouting Report modal for 2+ specific players =====
        // Replaces the current compareList with exactly these players and opens the modal —
        // used by Lineup Optimizer / Transfer Suggestions "Compare"/"Full Scouting Report"
        // buttons, and by the detail panel's "Full Comparison" button.
        function openPairCompare(...ids) {
            const players = ids.map(buildComparePlayer).filter(Boolean);
            if (players.length < 2) return;
            compareList = players.slice(0, MAX_COMPARE);
            updateCompareBar();
            if (typeof onCompareSelectionChange === 'function') onCompareSelectionChange();
            showCompareModal();
        }

        // ===== PHASE 1: LINEUP OPTIMIZER ("11 vs. bench") =====
        const POS_SHORT_MAP = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };

        // Single source of truth for "what will this player score this week", so the
        // bench-swap advice quotes the same xP the player's card shows. These used to
        // diverge — the panel would claim "2.0 xP vs 0.0 xP" for two players whose
        // cards read 3.1 xP and 0.8 xP.
        function projectedScore(player) {
            return predictedGWPoints(player);
        }

        function computeLineupSuggestions() {
            const starters = analysisResults.filter(a => !a.player.onBench);
            const bench = analysisResults.filter(a => a.player.onBench);
            const suggestions = [];

            bench.forEach(benchA => {
                const samePos = starters.filter(a => a.player.position === benchA.player.position);
                if (!samePos.length) return;

                const benchScore = projectedScore(benchA.player);
                let weakest = null, weakestScore = Infinity;
                samePos.forEach(starterA => {
                    const score = projectedScore(starterA.player);
                    if (score < weakestScore) { weakest = starterA; weakestScore = score; }
                });

                if (weakest && benchScore - weakestScore >= 1.0) {
                    suggestions.push({ bench: benchA, starter: weakest, benchScore, starterScore: weakestScore, delta: benchScore - weakestScore });
                }
            });

            suggestions.sort((a, b) => b.delta - a.delta);
            return suggestions.slice(0, 5);
        }

        function lineupSwapReason(s) {
            const b = s.bench.player, st = s.starter.player;
            const parts = [];
            if (st.status === 'i' || st.status === 'u' || st.status === 's') parts.push(`${escHTML(st.name)} is unavailable`);
            else if (st.status === 'd') parts.push(`${escHTML(st.name)} is a doubt`);
            if (b.minsPerGame >= 60 && (b.form || 0) > (st.form || 0) + 0.5) parts.push(`better recent form (${b.form.toFixed(1)} vs ${st.form.toFixed(1)})`);
            if ((b.avgFDR || 3) < (st.avgFDR || 3) - 0.4) parts.push('easier upcoming fixtures');
            if (!parts.length) parts.push(`${s.benchScore.toFixed(1)} projected pts vs ${s.starterScore.toFixed(1)}`);
            return parts.slice(0, 2).join(' — ');
        }

        // Compact version of the old standalone Lineup Optimizer section, folded directly
        // into the health-ring column: an affirmation when the XI is already best, or a
        // couple of tight one-line swap suggestions (capped, not a full card list) otherwise.
        // Curated, ranked list of what to actually DO this week. Deliberately capped:
        // a manager gets one free transfer, so dumping every underperformer (the old
        // "10 Sell" behaviour) isn't advice, it's a data dump. At most two transfers
        // are ever proposed, and everything carries the xP that justifies it.
        const MAX_SUGGESTED_TRANSFERS = 2;
        const MAX_SUGGESTED_MOVES = 4;

        function buildSuggestedMoves(starters, injuredStarters, doubtfulStarters, capAnalysis) {
            const moves = [];
            const bank = (picksData?.entry_history?.bank || 0) / 10;

            // --- 1. Transfers. Unavailable starters first (forced), then the biggest
            // upgrade available within budget. Ranked by xP gained per transfer.
            const transferCandidates = [];
            const seen = new Set();

            const considerForTransfer = (a, forced) => {
                if (seen.has(a.player.id)) return;
                const out = a.player;
                const budget = (out.sellPrice || out.price) + bank;
                const excludeIds = new Set(selectedPlayers.map(p => p.id));
                const best = findTransferCandidates(out.position, budget, excludeIds)[0];
                if (!best) return;
                const gain = predictedGWPoints(best) - predictedGWPoints(out);
                // Forced moves go through even at a small loss — the player can't play.
                if (!forced && gain < 0.8) return;
                seen.add(out.id);
                transferCandidates.push({ out, in: best, gain, forced, budget });
            };

            injuredStarters.forEach(a => considerForTransfer(a, true));
            doubtfulStarters
                .filter(a => (a.player.chanceNextRound ?? 100) <= 50)
                .forEach(a => considerForTransfer(a, true));
            [...starters]
                .filter(a => a.verdict === 'sell' || a.verdict === 'monitor')
                .sort((x, y) => y.sellRating - x.sellRating)
                .forEach(a => considerForTransfer(a, false));

            transferCandidates
                .sort((a, b) => (b.forced - a.forced) || (b.gain - a.gain))
                .slice(0, MAX_SUGGESTED_TRANSFERS)
                .forEach(t => {
                    moves.push({
                        icon: '🔥',
                        kind: 'transfer',
                        urgent: t.forced,
                        title: `${t.forced ? 'Replace' : 'Upgrade'} ${t.out.name}`,
                        detail: `${t.in.name} [${predictedGWPoints(t.in).toFixed(1)} xP] over ${t.out.name} [${predictedGWPoints(t.out).toFixed(1)} xP]`
                            + `${t.gain > 0 ? ` — projected +${t.gain.toFixed(1)} pts` : ''} · budget £${t.budget.toFixed(1)}m`,
                        actionLabel: 'View options',
                        action: `openTransferPanel(${t.out.id})`
                    });
                });

            // --- 2. Captaincy, always paired with the best alternative in the squad.
            if (capAnalysis) {
                const capXP = predictedGWPoints(capAnalysis.player);
                let bestAlt = null, bestAltXP = -Infinity;
                starters.forEach(a => {
                    if (a.player.id === capAnalysis.player.id) return;
                    const xp = predictedGWPoints(a.player);
                    if (xp > bestAltXP) { bestAltXP = xp; bestAlt = a; }
                });
                if (bestAlt && bestAltXP - capXP >= 0.5) {
                    moves.push({
                        icon: '👑',
                        kind: 'captain',
                        urgent: true,
                        title: `Change captain to ${bestAlt.player.name}`,
                        detail: `${bestAlt.player.name} [${bestAltXP.toFixed(1)} xP] is a better captain option than ${capAnalysis.player.name} [${capXP.toFixed(1)} xP] — worth about +${((bestAltXP - capXP)).toFixed(1)} pts once doubled`,
                        actionLabel: 'Compare',
                        action: `openPairCompare(${bestAlt.player.id}, ${capAnalysis.player.id})`
                    });
                }
            }

            // --- 3. Bench swaps, each with the projected delta that justifies it.
            computeLineupSuggestions().slice(0, 2).forEach(s => {
                moves.push({
                    icon: '🔄',
                    kind: 'bench',
                    urgent: false,
                    title: `Start ${s.bench.player.name} over ${s.starter.player.name}`,
                    detail: `Projected +${s.delta.toFixed(1)} pts (${s.benchScore.toFixed(1)} xP vs ${s.starterScore.toFixed(1)} xP)`,
                    actionLabel: 'Compare',
                    action: `openPairCompare(${s.bench.player.id}, ${s.starter.player.id})`
                });
            });

            // --- 4. Risks worth knowing about but with no clean action this week.
            const unactionedDoubts = doubtfulStarters.filter(a => !seen.has(a.player.id));
            if (unactionedDoubts.length) {
                const names = unactionedDoubts.slice(0, 3).map(a => a.player.name).join(', ');
                moves.push({
                    icon: '⚠️',
                    kind: 'risk',
                    urgent: false,
                    title: `${unactionedDoubts.length} fitness doubt${unactionedDoubts.length > 1 ? 's' : ''}`,
                    detail: `${names} — check team news before the deadline`,
                    actionLabel: '',
                    action: ''
                });
            }

            /* --- 5. Template gaps.

               FPL is scored against a global average, so a player owned by most of
               the field is a rank risk whether or not he is a good pick: every
               point he scores moves the average, and not owning him means falling
               behind it.

               This is deliberately NOT called Effective Ownership. Real EO adds
               captaincy and triple-captaincy percentages, and the official API
               publishes neither — there is no captaincy field on a player at all.
               Ownership alone captures most of the risk and is a fact rather than
               an estimate, so that is what it is named after. Exact EO within your
               mini-league, where every pick is knowable, lives on the Rivals page.

               Only the genuinely heavily owned qualify: at a 30% floor there are
               seven such players in the game right now, so this stays a short list
               rather than a second squad. */
            const TEMPLATE_OWNERSHIP_FLOOR = 30;
            if (typeof allPlayers !== 'undefined' && Array.isArray(allPlayers)) {
                const ownedIds = new Set((analysisResults || []).map(a => a.player.id));
                const gaps = allPlayers
                    .filter(p => (p.ownership || 0) >= TEMPLATE_OWNERSHIP_FLOOR
                        && !ownedIds.has(p.id)
                        && p.status === 'a')
                    .sort((a, b) => (b.ownership || 0) - (a.ownership || 0))
                    .slice(0, 2);
                gaps.forEach(p => {
                    const xp = typeof predictedGWPoints === 'function' ? predictedGWPoints(p) : null;
                    /* Compare him against the man he would actually displace —
                       your weakest projected player in the same position —
                       rather than whoever happens to sit first in the squad. */
                    const samePos = (analysisResults || [])
                        .filter(a => a.player.position === p.position)
                        .sort((a, b) => predictedGWPoints(a.player) - predictedGWPoints(b.player));
                    const rival = samePos.length ? samePos[0].player : (analysisResults[0] || {}).player;
                    moves.push({
                        icon: '🌍',
                        kind: 'template',
                        urgent: false,
                        title: `${p.name} is owned by ${(p.ownership || 0).toFixed(0)}% of managers`,
                        detail: xp != null
                            ? `You do not have him. He projects ${xp.toFixed(1)} this gameweek, and every point he scores moves the average you are ranked against.`
                            : `You do not have him, so every point he scores moves the average you are ranked against.`,
                        actionLabel: 'Compare',
                        action: `openPairCompare(${p.id}, ${rival ? rival.id : p.id})`
                    });
                });
            }

            // Urgent first, then the order they were generated (transfer > captain > bench > risk).
            return moves
                .map((m, i) => ({ ...m, _i: i }))
                .sort((a, b) => (b.urgent - a.urgent) || (a._i - b._i))
                .slice(0, MAX_SUGGESTED_MOVES);
        }

        function renderSuggestedMoves(moves) {
            if (!moves.length) {
                return `<div class="insight-move insight-move-clear">
                    <span class="insight-move-icon">✅</span>
                    <div class="insight-move-body"><div class="insight-move-title">No urgent moves</div>
                    <div class="insight-move-detail">Lineup and captain look right for this gameweek.</div></div>
                </div>`;
            }
            return moves.map(m => `
                <div class="insight-move ${m.urgent ? 'urgent' : ''}">
                    <span class="insight-move-icon">${m.icon}</span>
                    <div class="insight-move-body">
                        <div class="insight-move-title">${escHTML(m.title)}</div>
                        <div class="insight-move-detail">${escHTML(m.detail)}</div>
                        ${m.action ? `<button class="insight-move-action" onclick="${m.action}">${escHTML(m.actionLabel)}</button>` : ''}
                    </div>
                </div>`).join('');
        }

        function renderLineupAlert() {
            const suggestions = computeLineupSuggestions();
            if (!suggestions.length) {
                return `<div class="lineup-alert good"><i data-lucide="check-circle" class="icon"></i> Best XI already selected</div>`;
            }
            const rows = suggestions.slice(0, 2).map(s => {
                const b = s.bench.player, st = s.starter.player;
                return `<div class="lineup-alert-row">
                    <span class="lineup-alert-text"><strong>${escHTML(b.name)}</strong> (bench) may outscore <strong>${escHTML(st.name)}</strong></span>
                    <button class="lineup-alert-compare" onclick="openPairCompare(${b.id}, ${st.id})">Compare</button>
                </div>`;
            }).join('');
            return `<div class="lineup-alert warn">
                <div class="lineup-alert-head"><i data-lucide="repeat" class="icon"></i> Lineup check</div>
                ${rows}
            </div>`;
        }

