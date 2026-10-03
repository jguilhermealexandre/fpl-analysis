/* ============================================
   EasyFPL — My Team Analysis
   The 3-step Lineup Wizard, plus page initialization.

   Extracted from the inline <script> in fpl-my-team-analysis.html.
   These files are plain classic scripts loaded in order, not ES modules:
   every function stays a global, which the inline onclick= handlers
   throughout the markup depend on.

   Four of them are no longer loaded with the page at all — draft-planner,
   transfer-wizard, transfer-funnel and lineup-wizard arrive when their tab is
   first opened, named in #v2TabScripts in the markup. So a name declared in
   one of those four is not there until that click, and anything loaded with
   the page that needs it has had it moved out: the transfer scoring engine and
   the clean-sheet and pressure models to transfer-engine.js, the price
   thresholds to price-watch.js, and the settings drawer, the saved-settings
   bootstrap and the Team ID handlers to team-analysis-core.js.

   What remains order-dependent is only top-level code. team-analysis-core.js
   still comes first: it declares the shared state the rest assign to, and it
   reads the manager's saved settings into userSettings before anything scores
   with them.
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
            // A report from a previous team (or an earlier GW's squad) naming
            // players who may not even be in this one would be actively
            // misleading, not just stale.
            lineupState.optimizeReport = null;

            squad.forEach(p => {
                if (p.status === 'i' || p.status === 'u' || p.status === 's') lineupState.excluded.add(p.id);
            });

            // Fetched now rather than on first click of the Matchday tab: it is
            // one small file, and the tab is then populated the moment it opens.
            if (typeof boLoadOdds === 'function') boLoadOdds();

            solveLWLineup();
            const cap = lineupState.xi.filter(p => p.pos !== 1).sort((a, b) => b.gwScore - a.gwScore);
            lineupState.captain = cap[0]?.id || null;
            lineupState.viceCaptain = cap[1]?.id || null;
            lineupState.undo = null;

            /* A lineup you worked out last night beats one the solver has just
               invented, so a saved arrangement wins over the fresh solve — but
               only if it is for this team and this gameweek, and only if every
               player in it is still in the squad. lsLoad and lsApply enforce
               both; anything else falls through to what was just solved.

               Keyed on planningGW, the round the arrangement is FOR. It was
               keyed on currentGW, the round already played, which inverted the
               store's own expiry rule: an eleven picked on the Tuesday was
               filed under the gameweek behind it and thrown away at the next
               deadline — the exact moment it became the answer. */
            (() => {
                if (typeof lsLoad !== 'function' || typeof planningGW === 'undefined') return;
                let teamId = null;
                try { teamId = localStorage.getItem('fpl_team_id'); } catch (e) { return; }
                if (!teamId) return;
                const saved = lsLoad(teamId, planningGW);
                if (saved) lsApply(lineupState, saved);
            })();

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
            // Kept for the optimization report's "shapes considered" section —
            // otherwise solveQuickLineup's per-formation totals are thrown away.
            lineupState.formationScores = result.formationScores || [];
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
                    <!-- What the lineup IS sits with the title; what you can DO
                         sits on the right. Four chips used to share the right-hand
                         end - a formation, a total and two buttons - drawn with the
                         same border, fill and radius, so a read-only figure and a
                         click target were the same object, and the whole row sat a
                         screen's width from the heading it belonged to. -->
                    <div class="lw-cc-head">
                        <div class="lw-cc-title">${v2Icon('sliders')} Lineup command centre
                            <span class="lw-cc-gw">GW${planningGW}</span>
                            <span class="lw-cc-gw" id="lwFormation"
                                data-tooltip="The shape the optimiser settled on for your available players.">${lineupState.formation}</span></div>
                        <div class="lw-cc-actions">
                            <button class="rc-btn primary" onclick="resetLineupToOptimal()" data-tooltip="${optimiseTip}">${v2Icon('sparkle')} Auto-optimise</button>
                            ${lineupState.undo ? `<button class="rc-btn" onclick="lwUndoOptimise()"
                                data-tooltip="Put back the eleven, bench order and armband you had before Auto-optimise ran.">↩︎ Undo</button>` : ''}
                        </div>
                    </div>
                    ${lineupState.optimizeReport ? `<div class="sq-optimize-summary">${buildOptimizeSummary(lineupState.optimizeReport, 'openLineupOptimizeReport()')}</div>` : ''}
                    <div class="lw-cc-body">
                        <div class="lw-cc-pitch" id="lwPitchPane">${renderLWPitch()}</div>
                        <div class="lw-cc-intel" id="lwIntelPane">${renderLWIntel()}</div>
                    </div>
                </div>`;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        const LW_FDR_WORD = { 1: 'Very easy', 2: 'Easy', 3: 'Average', 4: 'Hard', 5: 'Very hard' };

        /* A squad player's face, small, for the places in the intel panel that
           name somebody in running text. The pitch beside it is nothing but
           faces, so a surname on its own in the panel made you look twice to
           work out which card it was talking about. Squad rows carry web_name
           where the shared avatar expects name. */
        function lwFace(p) {
            if (!p || typeof v2AvatarHTML !== 'function') return '';
            return `<span class="lw-face">${v2AvatarHTML({ name: p.web_name, code: p.code })}</span>`;
        }

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

            /* The armband is its own mark on the card's opposite corner, the
               way the dashboard draws it — not one more chip in the row of
               status flags, where it read as another warning. */
            let armband = '';
            if (p.id === lineupState.captain) armband = `<span class="dp-cap" data-tooltip="Captain — points doubled.">C</span>`;
            else if (p.id === lineupState.viceCaptain) armband = `<span class="dp-cap" data-tooltip="Vice-captain — takes the armband if the captain does not play.">V</span>`;

            let badges = '';
            if (benchIdx != null) badges += `<span class="dp-badge bench" data-tooltip="${benchIdx === 'GK' ? 'Reserve keeper.' : `Substitution order — ${benchIdx} in line.`}">${benchIdx === 'GK' ? 'GK' : 'B' + benchIdx}</span>`;
            if (out) badges += `<span class="dp-badge out" data-tooltip="${escHTML(p.news || 'Unavailable this gameweek')}">OUT</span>`;
            else if (doubt) badges += `<span class="dp-badge doubt" data-tooltip="${escHTML(p.news || 'Fitness doubt')}${p.chanceNextRound != null ? ` — ${p.chanceNextRound}% chance of playing` : ''}">?</span>`;
            else if (rotation) badges += `<span class="dp-badge doubt" data-tooltip="Rotation risk — around ${Math.round(risk.pStart * 100)}% likely to start, based on minutes per appearance.">⟳</span>`;

            const fixChip = fx
                ? `<span class="dp-fix fdr-${fx.difficulty || 3}" data-tooltip="${fx.isHome ? 'Home to' : 'Away at'} ${escHTML(fx.opponent || '?')} — FDR ${fx.difficulty || 3} (${LW_FDR_WORD[fx.difficulty || 3] || 'Average'})">${escHTML(fx.opponent || '?')} <span class="dp-fix-ha">(${fx.isHome ? 'H' : 'A'})</span></span>`
                : `<span class="dp-fix dp-fix-blank" data-tooltip="No fixture this gameweek.">Blank</span>`;

            const cls = ['dp-card', posClass, out ? 'is-out' : '', selected ? 'lw-picked' : '',
                isSwapSrc ? 'swap-selected' : '', isSwapTgt ? 'swap-target' : ''].filter(Boolean).join(' ');

            /* The card the dashboard draws, exactly: face and crest above the
               name, then the projection on a line of its own, then who it
               comes against. This pitch had the number as a pill laid over
               the photo and a coloured stripe along the top of the card —
               enough that the two screens did not read as the same object. */
            const lwIdent = { name: p.web_name, code: p.code, teamId: p.teamId, team: p.team };
            return `<div class="${cls}" onclick="handleLWSwapClick(${p.id})">
                <div class="dp-badges">${badges}</div>
                ${armband}
                <button class="dp-transfer" onclick="handleLWInfoBtnClick(${p.id}, event)" data-tooltip="View ${escHTML(p.web_name)}'s detail — click a second player to compare them">ℹ</button>
                ${typeof v2IdentityHTML === 'function' ? v2IdentityHTML(lwIdent, 'v2-pid-pitch') : ''}
                <div class="dp-name">${escHTML(p.web_name)}</div>
                <div class="dp-score" data-tooltip="Projected points for ${escHTML(p.web_name)} this gameweek."><b>${xp.toFixed(1)}</b><span class="u">xP</span></div>
                <div class="dp-fixtures">${fixChip}</div>
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
            /* The bench closes the pitch card and sits under it, rather than
               being a white panel laid on the grass. Substitutes are not on
               the field; drawing them there was the one thing on this pitch
               that was not true of a real one. */
            html += `</div></div>`;
            html += `<div class="dp-bench"><div class="dp-bench-label">Bench</div>`;
            html += `<div class="dp-bench-row">${bench.map(p => lwCard(p, p.pos === 1 ? 'GK' : ++benchCount)).join('')}</div>`;
            html += `</div>`;
            html += `<div class="lw-pitch-hint">${lineupState.swapSource
                ? `Swapping <strong>${escHTML((lineupState.squad.find(p => p.id === lineupState.swapSource) || {}).web_name || '')}</strong> — click another player to complete it, or click them again to cancel.`
                : 'Click a player to swap them. Use ℹ to view detail, or click a second ℹ to compare two side by side.'}</div>`;
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
            // Bookmakers price one round at a time, so odds can only ever speak
            // about the gameweek being picked — which is exactly this screen's
            // question, and why the tab lives here rather than in the Transfer
            // Wizard. scripts/odds-panel.js loads the feed lazily on first view.
            else if (tab === 'odds') body = typeof renderBOMatchdayPanel === 'function'
                ? renderBOMatchdayPanel()
                : '<div class="lw-side-empty">The odds panel is not loaded on this page.</div>';
            else {
                const sel = lineupState.selectedPlayers;
                body = !sel.length ? renderLWSummary()
                    : sel.length === 1 ? renderLWContextSingle(sel[0])
                    : renderLWContextCompare(sel[0], sel[1]);
            }
            /* The optimiser summary, and why it sits above the tabs rather than
               inside the Overview where it was asked for.

               The projected total belongs to the lineup, not to one tab of the
               panel that discusses it. It was drawn twice from the same
               lwTotalXP() call - once as a chip in the command-centre header and
               once as a hero inside the Overview - so one figure appeared in two
               places on the same screen. Putting it back inside the Overview
               would recreate exactly that, and hide the page's headline number
               behind the Captaincy tab. The other two figures are lineup facts
               too: the gain is over the whole eleven, and a flagged player is
               flagged whichever tab you are reading. One bar, one place, true of
               all three tabs.

               The comparison is the point of the middle figure. A manager does
               not want to know that their eleven projects 55.1; they want to
               know whether it beats the eleven already saved on the FPL site,
               which is the only reason to press Auto-optimise at all. */
            const live = lwLiveXP();
            const total = lwTotalXP();
            const gain = live == null ? null : total - live;
            const flagCount = lwRiskList().length;
            const hero = lineupState.xi.length
                ? `<div class="lw-ovs">
                        <div class="lw-ovs-main">
                            <div class="lw-ovs-v">${total.toFixed(1)}</div>
                            <div class="lw-ovs-l">projected points · ${escHTML(lineupState.formation)}</div>
                        </div>
                        ${gain == null ? '' : `<div class="lw-ovs-item">
                            <div class="lw-ovs-iv ${gain > 0.05 ? 'is-up' : gain < -0.05 ? 'is-down' : 'is-flat'}">${Math.abs(gain) < 0.05 ? 'level' : `${gain > 0 ? '+' : '−'}${Math.abs(gain).toFixed(1)}`}</div>
                            <div class="lw-ovs-il">vs your live FPL team</div>
                        </div>`}
                        <div class="lw-ovs-item">
                            <div class="lw-ovs-iv ${flagCount ? 'is-warn' : ''}">${flagCount}</div>
                            <div class="lw-ovs-il">${flagCount === 1 ? 'flagged player' : 'flagged players'}</div>
                        </div>
                    </div>`
                : '';
            return `<div class="lw-intel">
                ${hero}
                <div class="lw-intel-tabs">
                    <button class="lw-intel-tab ${tab === 'overview' ? 'active' : ''}" onclick="setLWIntelTab('overview')">${v2Icon('brain')} Overview</button>
                    <button class="lw-intel-tab ${tab === 'captaincy' ? 'active' : ''}" onclick="setLWIntelTab('captaincy')">${v2Icon('crown')} Captaincy</button>
                    <button class="lw-intel-tab ${tab === 'odds' ? 'active' : ''}" onclick="setLWIntelTab('odds')" data-tooltip="What the betting market expects from this gameweek's fixtures — goals, clean sheets and results, with the bookmaker's margin removed.">${v2Icon('up')} Matchday</button>
                </div>
                <div class="lw-intel-body">${body}</div>
            </div>`;
        }

/* ===== THE OVERVIEW TAB =====

           This screen answers one question — "is this eleven right, and what do
           I have to do about it?" — and it used to answer five. A stacked bar
           split the eleven's points into appearance/attack/clean sheet/saves/
           bonus/defcon, a paragraph described the fixtures they faced, four
           tiles reported nailed-on count, expected absentees and average FDR,
           and the figures beside the key decision were summed over three
           gameweeks while the headline above them was one. Every one of those
           was true. None of them was a decision.

           What is left is four blocks in the order you act on them: how good
           the eleven is and whether it beats the team you already have, who
           might not play, what the optimiser moved, and the one call it nearly
           got the other way round.

           Everything shown here is this gameweek alone. That is a deliberate
           narrowing and it has one consequence worth knowing: the XI is still
           SELECTED on the three-gameweek run (see the comment on lwScore
           above), because who starts is not a one-week question. So the
           optimiser can bench a player who out-projects a starter this week.
           Rather than print a negative gap and let it read as a bug,
           lwClosestCall() names the reason in the one place it can happen. */

        /* What the manager's saved FPL lineup projects for this gameweek —
           scored exactly the way lwTotalXP() scores the optimiser's, same
           one-week figures and same doubling, so the difference between the two
           is a difference of decisions rather than of method. */
        function lwLiveXP() {
            const ids = lineupState.originalXIIds;
            if (!ids || !ids.size) return null;
            const cap = lineupState.originalCaptain;
            return lineupState.squad
                .filter(p => ids.has(p.id))
                .reduce((s, p) => s + p.gwScore * (p.id === cap ? 2 : 1), 0);
        }

        /* Everyone worth a second look before you submit, most urgent first.

           Two different things are collected here because they cost the same
           thing — a player who does not play — and separating them into two
           cards is what made the old panel feel like a report. A flagged player
           on the bench stays on the list: they are the autosub the eleven is
           leaning on. */
        function lwRiskList() {
            const xiIds = new Set(lineupState.xi.map(p => p.id));
            const seen = new Set();
            const out = [];
            const add = (p, why, inXI) => {
                if (seen.has(p.id)) return;
                seen.add(p.id);
                out.push({ p, why, inXI });
            };

            lineupState.squad.forEach(p => {
                if (p.status !== 'i' && p.status !== 'u' && p.status !== 's' && p.status !== 'd') return;
                const note = (p.news || '').split('.')[0]
                    || (p.status === 'd' ? 'fitness doubt' : 'unavailable');
                add(p, note + (p.chanceNextRound != null ? ` (${p.chanceNextRound}% chance)` : ''), xiIds.has(p.id));
            });

            // Rotation risk only matters for someone you are actually starting.
            lineupState.xi.forEach(p => {
                if (typeof expectedMinutesModel !== 'function') return;
                const pStart = expectedMinutesModel(p).pStart;
                if (pStart < 0.6) add(p, `rotation risk — ${Math.round(pStart * 100)}% likely to start`, true);
            });

            return out.sort((a, b) => (b.inXI ? 1 : 0) - (a.inXI ? 1 : 0));
        }

        /* The tightest call the optimiser made: the starter it trusts least
           against the substitute it rates most, both in this gameweek's points.

           `legal` is whether swapping them leaves a formation FPL would accept.
           Without it the panel offers a button that cannot do anything, which
           is how the old card ended up hedging in prose about shapes. */
        function lwClosestCall() {
            const xi = lineupState.xi;
            const starter = xi.filter(p => p.pos !== 1).sort((a, b) => a.gwScore - b.gwScore)[0];
            const sub = lineupState.bench
                .filter(p => p.pos !== 1 && !lineupState.excluded.has(p.id))
                .sort((a, b) => b.gwScore - a.gwScore)[0];
            if (!starter || !sub) return null;
            const candidate = xi.filter(p => p.id !== starter.id).concat([sub]);
            return {
                starter, sub,
                margin: starter.gwScore - sub.gwScore,
                legal: typeof isValidLWFormation !== 'function' || isValidLWFormation(candidate)
            };
        }

        function lwPosShort(p) {
            return (typeof POSITION_CONFIG !== 'undefined' && POSITION_CONFIG[p.pos] ? POSITION_CONFIG[p.pos].short : '') || '';
        }

        function renderLWSummary() {
            if (!lineupState.xi.length) return `<div class="lw-side-empty">Load a squad to see the lineup read.</div>`;

            const risks = lwRiskList();
            const call = lwClosestCall();

            const risksBlock = risks.length ? `<div class="lw-ov-block is-warn">
                    <div class="lw-ov-h">${v2Icon('warn')} Risks &amp; flags</div>
                    ${risks.map(r => `<div class="lw-ov-risk">
                        ${lwFace(r.p)}
                        <span class="lw-ov-risk-n">${escHTML(r.p.web_name)}</span>
                        <span class="lw-ov-risk-w">${escHTML(r.why)}</span>
                        <span class="lw-ov-risk-where${r.inXI ? ' is-xi' : ''}">${r.inXI ? 'starting' : 'bench'}</span>
                    </div>`).join('')}
                </div>` : `<div class="lw-ov-quiet">${v2Icon('check')} No injuries, suspensions or rotation risks in the squad.</div>`;

            /* The gap, said in points rather than drawn as a bar, and only when
               there is a gap to say. A dead heat is a real answer here — it
               means the shape, not the projection, is making the decision. */
            const callBlock = call ? `<div class="lw-ov-block">
                    <div class="lw-ov-h">${v2Icon('scales')} Closest bench call</div>
                    <div class="lw-ov-call">
                        <div class="lw-ov-call-side${call.margin >= 0 ? ' is-ahead' : ''}">
                            <div class="lw-ov-call-l">Starting</div>
                            <div class="lw-ov-call-n">${lwFace(call.starter)}<span class="lw-ov-call-t">${escHTML(call.starter.web_name)}</span></div>
                            <div class="lw-ov-call-v">${call.starter.gwScore.toFixed(1)}<span class="lw-ov-call-u">xP</span></div>
                        </div>
                        <div class="lw-ov-call-gap" data-tooltip="The gap between them this gameweek, in projected points.">${Math.abs(call.margin) < 0.05 ? 'level' : Math.abs(call.margin).toFixed(1)}</div>
                        <div class="lw-ov-call-side${call.margin < 0 ? ' is-ahead' : ''}">
                            <div class="lw-ov-call-l">On the bench</div>
                            <div class="lw-ov-call-n">${lwFace(call.sub)}<span class="lw-ov-call-t">${escHTML(call.sub.web_name)}</span></div>
                            <div class="lw-ov-call-v">${call.sub.gwScore.toFixed(1)}<span class="lw-ov-call-u">xP</span></div>
                        </div>
                    </div>
                    <div class="lw-ov-note">${
                        Math.abs(call.margin) < 0.05
                            ? `${escHTML(call.starter.web_name)} and ${escHTML(call.sub.web_name)} project the same this gameweek — nothing separates them but the shape.`
                            : call.margin > 0
                                ? `${escHTML(call.starter.web_name)} starts, <strong>${call.margin.toFixed(1)}</strong> projected points ahead of ${escHTML(call.sub.web_name)}. This is the narrowest gap in the eleven.`
                                /* The one place the selection horizon shows through. Saying
                                   so costs a clause and stops the number reading as a fault. */
                                : `${escHTML(call.sub.web_name)} projects <strong>${Math.abs(call.margin).toFixed(1)}</strong> more than ${escHTML(call.starter.web_name)} this gameweek, but is benched on the longer run the eleven is picked over.${
                                    call.legal
                                        ? ` <button class="lw-ov-apply" onclick="lwApplySwap(${call.starter.id}, ${call.sub.id})">Start ${escHTML(call.sub.web_name)} anyway</button>`
                                        : ' No legal formation lets them swap, so the shape is what is keeping them out.'}`
                    }</div>
                </div>` : '';

            return `<div class="lw-ov">
                ${risksBlock}
                ${renderLWChanges()}
                ${callBlock}
                <div class="lw-ov-foot">Every figure on this tab is for this gameweek only. Click a player on the pitch to swap them, or their ℹ for the detail — two of them compare.</div>
            </div>`;
        }

                function lwApplySwap(outId, inId) {
            handleLWSwapClick(outId);
            handleLWSwapClick(inId);
        }

        // Captaincy as a matrix rather than a list: the armband is the biggest call
        // of the week, and "Form 8 · xGI/90 1.12" in grey text does not carry it.
/* ===== THE CAPTAINCY TAB =====

           Five cards, each the size of a playing card, and each carrying a
           six-segment stacked bar of where the points came from, two unlabelled
           progress bars for "Threat" and "Opponent", and a nailed-on percentage.
           At 148px wide none of it could be read, and all of it had to be
           compared five ways. The effect was not information, it was paralysis.

           What decides an armband, in order: how many points he projects
           doubled, who he is playing, how leaky they are, and whether he is in
           form. So that is what a card holds now — the rank, the doubled
           figure, the fixture, the one defensive number that bears on it, form
           and ownership — and nothing else. Ownership stays because the armband
           is a rank decision as much as a points one: 73% owned and 29% owned
           are different bets on the same projection.

           The nailed-on percentage is gone from the cards, where it said 96% on
           four of five and told you nothing. It survives in one place only: the
           insight line, and only below 80%, where it stops being reassurance
           and starts being the reason to pick someone else. A captain who does
           not play costs double. */
        function renderLWCaptaincyMatrix() {
            const ranks = typeof getDefensiveRanks === 'function' ? getDefensiveRanks() : { rank: {}, total: 20 };
            // The armband only ever pays out for this gameweek, so candidates are
            // ranked on gwScore, not the run score the XI itself was picked on.
            const candidates = lineupState.xi.filter(p => p.pos !== 1)
                .sort((a, b) => b.gwScore - a.gwScore).slice(0, 5);

            if (!candidates.length) return `<div class="lw-side-empty">No outfield players in the XI yet.</div>`;

            /* One card may carry a badge, and only if it earns it. The top pick
               is the top pick. A differential is a candidate close enough to
               matter whose ownership is far enough below the leader's that
               captaining him actually moves you in the rankings — both halves
               are required, or every low-owned bench option would be labelled a
               differential regardless of whether it is a real option. */
            const top = candidates[0];
            const differential = candidates.slice(1).find(p =>
                p.ownership != null && top.ownership != null
                && top.ownership - p.ownership >= 20
                && top.gwScore - p.gwScore <= 1.5);

            const cards = candidates.map((p, i) => {
                const fx = (p.fixtures || teamFixtures[p.teamId] || [])[0];
                const ctx = fx && typeof opponentContext === 'function' ? opponentContext(p.teamId, fx, ranks) : null;
                /* The quantity that decides a captaincy is the defence he is
                   about to face, in goals, now — not an index out of a hundred
                   and not his own team's attack. */
                const oppConceded = ctx && ctx.matches ? ctx.conceded : null;
                const form = isPreseason ? (p.ppg || 0) : (parseFloat(p.form) || 0);
                const isCap = lineupState.captain === p.id, isVC = lineupState.viceCaptain === p.id;
                const badge = p.id === top.id ? 'Top pick'
                    : (differential && p.id === differential.id) ? 'Differential' : '';

                /* The armband is a call about a person, and this grid asked you
                   to make it off five surnames. The portrait is the one the
                   pitch card already draws, so the player you are looking at
                   here is recognisably the player you just clicked there. */
                const capIdent = { name: p.web_name, code: p.code, teamId: p.teamId, team: p.team };
                return `<div class="lw-cap-card ${isCap ? 'is-cap' : ''}">
                    <div class="lw-cap-top">
                        <span class="lw-cap-rank">${i + 1}</span>
                        ${badge ? `<span class="lw-cap-badge${p.id === top.id ? ' is-top' : ''}">${escHTML(badge)}</span>` : ''}
                    </div>
                    ${typeof v2IdentityHTML === 'function' ? v2IdentityHTML(capIdent, 'v2-pid-portrait') : ''}
                    <div class="lw-cap-name">${escHTML(p.web_name)}</div>
                    <div class="lw-cap-team">${escHTML(p.team)} · ${lwPosShort(p)}</div>
                    <div class="lw-cap-xp" data-tooltip="Projected points with the armband on — ${p.gwScore.toFixed(1)} doubled.">${(p.gwScore * 2).toFixed(1)}<span class="lw-cap-xp-u">pts</span></div>
                    <div class="lw-cap-rows">
                        ${fx ? `<div class="lw-cap-row">
                            <span class="lw-cap-row-i">${v2Icon('swords')}</span>
                            <span class="lw-cap-row-t">${escHTML(fx.opponent || '?')} <span class="lw-cap-ha">(${fx.isHome ? 'H' : 'A'})</span></span>
                            <span class="dp-fix fdr-${fx.difficulty || 3} lw-cap-fdr" data-tooltip="Fixture difficulty ${fx.difficulty || 3} of 5">${fx.difficulty || 3}</span>
                        </div>` : ''}
                        ${oppConceded != null ? `<div class="lw-cap-row" data-tooltip="${escHTML(fx.opponent || 'They')} have conceded ${ctx.conceded.toFixed(1)} goals a game across ${ctx.matches} ${ctx.matches === 1 ? 'match' : 'matches'}.">
                            <span class="lw-cap-row-i">${v2Icon('shield')}</span>
                            <span class="lw-cap-row-t">${escHTML(fx.opponent || 'Opponent')} concede <strong>${oppConceded.toFixed(1)}</strong>/game</span>
                        </div>` : ''}
                        <div class="lw-cap-row" data-tooltip="FPL form — average points over the last five gameweeks.">
                            <span class="lw-cap-row-i">${v2Icon('trend')}</span>
                            <span class="lw-cap-row-t">Form <strong>${form.toFixed(1)}</strong></span>
                        </div>
                        <div class="lw-cap-row" data-tooltip="Share of all FPL managers who own him. The armband is a rank decision as much as a points one.">
                            <span class="lw-cap-row-i">${v2Icon('users')}</span>
                            <span class="lw-cap-row-t">Owned <strong>${p.ownership != null ? p.ownership + '%' : '—'}</strong></span>
                        </div>
                    </div>
                    <div class="lw-cap-actions">
                        <button class="lw-cap-btn ${isCap ? 'active-c' : ''}" onclick="setLWCaptain(${p.id})" data-tooltip="Give ${escHTML(p.web_name)} the armband">${isCap ? 'Captain' : 'C'}</button>
                        <button class="lw-cap-btn ${isVC ? 'active-vc' : ''}" onclick="setLWViceCaptain(${p.id})" data-tooltip="Make ${escHTML(p.web_name)} vice-captain">${isVC ? 'Vice' : 'VC'}</button>
                    </div>
                </div>`;
            }).join('');

            // How clear the call is, stated up front. A 0.2-point lead and a
            // 2.0-point lead are the same ordering and completely different
            // decisions, and the grid alone never said which one you were looking at.
            const lead = candidates.length > 1 ? candidates[0].gwScore - candidates[1].gwScore : 0;
            const picked = lineupState.squad.find(p => p.id === lineupState.captain);
            const topRisk = typeof optMinutesRisk === 'function' ? optMinutesRisk(candidates[0]) : null;
            const verdict = lead > 0.8
                ? `<strong>${escHTML(candidates[0].web_name)}</strong> is the clear call — ${lead.toFixed(1)} projected points clear of ${escHTML(candidates[1].web_name)} before the armband doubles it.`
                : candidates.length > 1
                    ? `Close call: <strong>${escHTML(candidates[0].web_name)}</strong> leads ${escHTML(candidates[1].web_name)} by only ${lead.toFixed(1)} projected points, so fixture and minutes risk decide it more than projection does.`
                    : `<strong>${escHTML(candidates[0].web_name)}</strong> is the only outfield option in your XI.`;
            /* The armband is on someone other than the model's first choice, which
               is worth saying — but not by assuming they trail it. A captained
               goalkeeper is never in the candidate list above (it filters pos 1),
               so this subtraction can come out negative, and it did: the line
               read "-0.2 projected points behind", which is not a sentence. */
            const offPick = picked && picked.id !== candidates[0].id
                ? `<div class="lw-cap-off">You have the armband on <strong>${escHTML(picked.web_name)}</strong>, ${
                    (() => {
                        const gap = candidates[0].gwScore - picked.gwScore;
                        if (Math.abs(gap) < 0.05) return `level with ${escHTML(candidates[0].web_name)} on projection.`;
                        if (gap > 0) return `${gap.toFixed(1)} projected points behind ${escHTML(candidates[0].web_name)}.`;
                        return `${Math.abs(gap).toFixed(1)} projected points ahead of ${escHTML(candidates[0].web_name)} — goalkeepers are not listed below.`;
                    })()
                }</div>`
                : '';

            return `<div class="lw-cap-matrix">
                <div class="lw-cap-lead">
                    <div class="lw-cap-lead-h">${v2Icon('brain')} What the model makes of it</div>
                    <div class="lw-cap-lead-b">${verdict}${topRisk && topRisk.pct < 80 ? ` Worth noting ${escHTML(candidates[0].web_name)} is only ${topRisk.pct}% likely to start — a captain who does not play costs you double.` : ''}</div>
                </div>
                ${offPick}
                <div class="lw-cap-grid">${cards}</div>
                <div class="lw-cap-foot">Ranked on this gameweek alone — the armband only ever pays out once.</div>
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
            lwRemember();
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


        /* Every change to the eleven goes through here.

           Called after each action rather than on a timer, so what is stored is
           always a decision a manager made rather than a half-finished drag. The
           gameweek is part of the key, so this expires by simply not matching
           once the round rolls over — see scripts/lineup-store.js. */
        function lwRemember() {
            if (typeof lsArrangement !== 'function') return;
            const teamId = (() => { try { return localStorage.getItem('fpl_team_id'); } catch (e) { return null; } })();
            if (!teamId || typeof planningGW === 'undefined') return;
            lsSave(teamId, planningGW, lsArrangement(lineupState));
        }

        /* Put back whatever Auto-optimise replaced.

           The snapshot is taken inside resetLineupToOptimal, which was already
           recording the same shape for its report — it just threw it away
           afterwards. */
        function lwUndoOptimise() {
            if (!lineupState.undo || typeof lsApply !== 'function') return;
            if (!lsApply(lineupState, lineupState.undo)) {
                if (typeof updateStatus === 'function') {
                    updateStatus('That lineup no longer fits your squad, so it cannot be restored', 'error');
                }
                lineupState.undo = null;
                return;
            }
            lineupState.undo = null;
            lineupState.optimizeReport = null;
            lwRemember();
            renderLineupCommandCenter();
            if (typeof updateStatus === 'function') updateStatus('Lineup restored', 'success');
        }

        function resetLineupToOptimal() {
            // Deliberately does NOT recompute lwScore from the heuristic: the cards
            // display lwScore as projected points, so overwriting it with the 0-100
            // ranking score would put "41.0 xP" on a player worth four.
            lineupState.swapSource = null;

            // Snapshot before solving, for the report — same idea as Squad
            // Analysis's runAutoOptimize and GW Draft's Auto-optimise, just
            // scored on this panel's own lwTotalXP() rather than rebuilding it.
            const beforeXI = new Set(lineupState.xi.map(p => p.id));
            const beforeCaptainId = lineupState.captain;
            const beforeViceId = lineupState.viceCaptain;
            const beforeXP = lwTotalXP();
            // The report leads on what changed, so the shape before the solve has
            // to be recorded before solveLWLineup() overwrites it.
            const beforeFormation = lineupState.formation;
            const beforeBenchIds = lineupState.bench.map(p => p.id);
            // The same shape the report is built from, kept so it can be put
            // back rather than only described.
            const restorable = typeof lsArrangement === 'function' ? lsArrangement(lineupState) : null;

            solveLWLineup();
            // Captaincy pays out for this gameweek alone, so it's picked on gwScore
            // even though the XI itself was just chosen on the summed run.
            const cap = lineupState.xi.filter(p => p.pos !== 1).sort((a, b) => b.gwScore - a.gwScore);
            if (!lineupState.xi.some(p => p.id === lineupState.captain)) lineupState.captain = cap[0]?.id || null;
            if (!lineupState.xi.some(p => p.id === lineupState.viceCaptain)) lineupState.viceCaptain = cap[1]?.id || null;

            const afterXP = lwTotalXP();

            // Build the same report Squad Analysis and GW Draft show after their
            // own Auto-Optimize — same shape, fed from this panel's own state
            // instead of the snapshot/draft one.
            const finalXI = [...lineupState.xi].sort((a, b) => b.gwScore - a.gwScore);
            const promotedPool = finalXI.filter(p => !beforeXI.has(p.id)).slice();
            const benchedOut = lineupState.bench.filter(p => beforeXI.has(p.id))
                .sort((a, b) => b.gwScore - a.gwScore)
                .map(p => ({ player: p, detailed: p._detailed || {}, replacedBy: null }));
            benchedOut.forEach(entry => {
                const i = promotedPool.findIndex(q => q.pos === entry.player.pos);
                if (i >= 0) entry.replacedBy = promotedPool.splice(i, 1)[0];
            });
            benchedOut.forEach(entry => {
                if (!entry.replacedBy && promotedPool.length) {
                    entry.replacedBy = promotedPool.shift();
                    entry.shapeChange = true;
                }
            });

            lineupState.optimizeReport = {
                formation: lineupState.formation,
                beforeFormation, beforeBenchIds, beforeViceId,
                beforeXP, afterXP, gain: afterXP - beforeXP,
                /* The armband holder, not the top-projected name in the XI. These
                   diverge: the block above only reassigns the captain when the
                   existing one drops out of the eleven, and finalXI is sorted
                   across all starters including the keeper. Reporting finalXI[0]
                   as "the captain" therefore claimed the armband had moved to
                   someone it had not, and fed the same wrong name to the summary
                   strip. Alternatives are outfield-only for the same reason. */
                captain: lineupState.squad.find(p => p.id === lineupState.captain) || null,
                captainAlternatives: finalXI.filter(p => p.pos !== 1 && p.id !== lineupState.captain).slice(0, 2),
                xi: finalXI,
                benchOrder: lineupState.bench,
                captainShortlist: finalXI.slice(0, 5),
                formationScores: lineupState.formationScores || [],
                viceId: lineupState.viceCaptain,
                // Only wrapped when the player is actually found — buildOptimizeSummary
                // reads previousCaptain.player.id unguarded, so { player: undefined }
                // would throw rather than read as "no previous captain".
                previousCaptain: (beforeCaptainId != null && lineupState.squad.some(p => p.id === beforeCaptainId))
                    ? { player: lineupState.squad.find(p => p.id === beforeCaptainId) } : null,
                benchedOut,
                promoted: finalXI.filter(p => !beforeXI.has(p.id))
            };

            /* Offered only when the solve actually moved something. An undo
               button for a no-op is a button that appears to have failed. */
            const after = typeof lsArrangement === 'function' ? lsArrangement(lineupState) : null;
            lineupState.undo = (restorable && after && typeof lsSame === 'function' && !lsSame(restorable, after))
                ? restorable : null;

            lwRemember();
            renderLineupCommandCenter();
        }

        /* Why the armband moved, or why it did not. Both are answers; only one of
           them used to get said. */
        function lwCaptainChangeSection(r) {
            const now = r.captain;
            const was = r.previousCaptain && r.previousCaptain.player;
            if (!now) return '';
            const alts = r.captainAlternatives || [];
            const lead = alts.length ? now.gwScore - alts[0].gwScore : 0;
            const risk = typeof optMinutesRisk === 'function' ? optMinutesRisk(now) : null;
            const fixture = typeof optFixtureLabel === 'function' ? optFixtureLabel(now) : '';
            const changed = !was || was.id !== now.id;

            const head = changed
                ? `<div class="opt-bench-head">${v2Icon('crown')} Armband moved${was ? ` from <strong>${escHTML(was.web_name || was.name)}</strong>` : ''} to <strong>${escHTML(now.web_name || now.name)}</strong></div>`
                : `<div class="opt-bench-head">${v2Icon('crown')} Armband stayed on <strong>${escHTML(now.web_name || now.name)}</strong></div>`;

            const why = [];
            if (changed && was) {
                const delta = now.gwScore - was.gwScore;
                why.push(`projects ${delta > 0 ? `<strong>+${delta.toFixed(1)}</strong> more` : `${delta.toFixed(1)}`} than ${escHTML(was.web_name || was.name)} this gameweek`);
                if (!lineupState.xi.some(p => p.id === was.id)) why.push(`${escHTML(was.web_name || was.name)} is no longer in the eleven`);
            } else if (!changed) {
                why.push(lead > 0.05
                    ? `still ${lead.toFixed(1)} projected points clear of the next option`
                    : 'still the highest-projecting outfield starter');
            }
            if (fixture && fixture !== '—') why.push(`faces ${escHTML(fixture)}`);
            if (risk) why.push(`${risk.pct}% likely to start`);

            return `<div class="opt-bench-row">
                ${head}
                <div class="opt-bench-why">${why.join(' · ')}</div>
            </div>`;
        }

        /* The Auto-optimise report, rebuilt around the one question it is opened
           to answer: what did this button just do to my team, and why.

           It deliberately does NOT reuse renderOptimizeReportModal() any more.
           That report opens with a full squad outlook, the whole eleven's
           projections and a formation essay — a standing description of the
           lineup, which is now what the Overview and Captaincy tabs carry
           permanently. Repeating it here buried the four rows that actually
           changed under six sections that had not. Squad Analysis and GW Draft
           still use the shared report, where an overview is the point. */
        function renderLWChangeReport(r) {
            if (!r) return '<div class="detail-section">Run Auto-optimise to see what changed.</div>';

            const moved = r.benchedOut || [];
            const capChanged = !!r.captain && (!r.previousCaptain || r.previousCaptain.player.id !== r.captain.id);
            const shapeChanged = r.beforeFormation && r.beforeFormation !== r.formation;
            const benchReordered = (() => {
                const before = r.beforeBenchIds || [];
                const after = (r.benchOrder || []).map(p => p.id);
                if (before.length !== after.length) return true;
                return before.some((id, i) => id !== after[i]);
            })();
            const changeCount = moved.length + (capChanged ? 1 : 0) + (shapeChanged ? 1 : 0);

            const rows = moved.map(b => {
                const p = b.player;
                const inP = b.replacedBy;
                const d = b.detailed || {};
                const risk = typeof optMinutesRisk === 'function' ? optMinutesRisk(p) : null;
                const reasons = [];
                if (inP) {
                    const delta = (inP.gwScore || 0) - (p.gwScore || 0);
                    if (delta > 0.05) reasons.push(`${escHTML(inP.web_name || inP.name)} projects <strong>+${delta.toFixed(1)}</strong> more this gameweek`);
                }
                if (typeof optFdrFor === 'function' && optFdrFor(p) >= 4) reasons.push(`hard fixture, ${escHTML(optFixtureLabel(p))}`);
                if (d.matchup < -1.5) reasons.push('unfavourable team matchup');
                const form = isPreseason ? (p.ppg || 0) : (parseFloat(p.form) || 0);
                if (form < 3) reasons.push(`weak form (${form.toFixed(1)})`);
                if (p.status === 'd') reasons.push(`fitness doubt${p.chanceNextRound != null ? ` (${p.chanceNextRound}%)` : ''}`);
                if (risk && risk.pct < 60) reasons.push(`only ${risk.pct}% likely to start`);
                if (!reasons.length) reasons.push('a higher-projected option was available for the slot');

                return `<div class="opt-bench-row">
                    <div class="opt-bench-head">
                        <span class="lw-chg-out">↓ ${escHTML(p.web_name || p.name)}</span>
                        ${inP ? `<span class="lw-chg-arrow">→</span><span class="lw-chg-in">↑ ${escHTML(inP.web_name || inP.name)}</span>` : ''}
                        ${b.shapeChange ? '<span class="lw-chg-tag">shape change</span>' : ''}
                    </div>
                    <div class="opt-bench-why">${reasons.join(' · ')}</div>
                </div>`;
            }).join('');

            const shapeHtml = shapeChanged ? `<div class="opt-bench-row">
                    <div class="opt-bench-head">${v2Icon('ruler')} Shape changed from <strong>${escHTML(r.beforeFormation)}</strong> to <strong>${escHTML(r.formation)}</strong></div>
                    <div class="opt-bench-why">The eleven above only fits in this shape. ${(r.formationScores || []).length > 1
                        ? `${escHTML(r.formation)} scored ${r.formationScores[0].total.toFixed(1)} against ${r.formationScores[1].total.toFixed(1)} for the next best shape.`
                        : ''}</div>
                </div>` : '';

            const altHtml = (r.formationScores || []).length > 1 ? `
                <div class="opt-alt">
                    <div class="opt-alt-head">Shapes considered</div>
                    ${r.formationScores.slice(0, 4).map((f, i) => `<div class="opt-alt-row ${i === 0 ? 'win' : ''}">
                        <span>${escHTML(f.formation)}</span>
                        <span class="opt-alt-bar"><span style="width:${Math.round((f.total / Math.max(r.formationScores[0].total, 0.01)) * 100)}%"></span></span>
                        <span class="opt-alt-n">${f.total.toFixed(1)}${i === 0 ? '' : ` (−${(r.formationScores[0].total - f.total).toFixed(1)})`}</span>
                    </div>`).join('')}
                </div>` : '';

            const benchHtml = (r.benchOrder || []).length ? `
                <div class="opt-suborder">
                    <div class="opt-suborder-head">Bench order ${benchReordered ? '(reordered)' : '(unchanged)'}</div>
                    ${r.benchOrder.map((p, i) => {
                        const risk = typeof optMinutesRisk === 'function' ? optMinutesRisk(p) : { pct: 0, cls: '' };
                        return `<div class="opt-suborder-row">
                            <span class="opt-suborder-n">${p.pos === 1 || p.position === 1 ? 'GK' : i + 1}</span>
                            <span class="opt-suborder-name">${escHTML(p.web_name || p.name)}</span>
                            <span class="opt-suborder-team">${escHTML(p.team)}</span>
                            <span class="fixture-chip fdr-${typeof optFdrFor === 'function' ? optFdrFor(p) : 3}">${typeof optFixtureLabel === 'function' ? optFixtureLabel(p) : ''}</span>
                            <span class="opt-suborder-xp">${(p.gwScore || 0).toFixed(1)} xP</span>
                            <span class="opt-risk ${risk.cls}">${risk.pct}%</span>
                        </div>`;
                    }).join('')}
                    <div class="opt-why">This order is what decides your auto-substitutions if a starter does not play.</div>
                </div>` : '';

            return `
            <div class="detail-section">
                <div class="opt-headline ${r.gain > 0.05 ? 'gain' : 'flat'}">
                    ${r.gain > 0.05
                        ? `<span class="opt-gain">+${r.gain.toFixed(1)} xP</span><span>from ${changeCount} change${changeCount === 1 ? '' : 's'}</span>`
                        : r.gain < -0.05
                            ? `<span class="opt-gain">${r.gain.toFixed(1)} xP</span><span>this week — the eleven was picked for the strongest run across the weeks ahead, not this one alone</span>`
                            : `<span class="opt-gain">No change</span><span>your lineup was already the best available</span>`}
                    <div class="opt-beforeafter">${r.beforeXP.toFixed(1)} xP before · ${r.afterXP.toFixed(1)} xP after <span class="opt-note">(includes the captain's double)</span></div>
                </div>
            </div>

            <div class="detail-section">
                <div class="detail-section-title">${v2Icon('shuffle')} What changed</div>
                ${changeCount === 0
                    ? '<div class="opt-empty">Nothing moved. Your eleven, shape and armband were already the best available from this squad.</div>'
                    : `${rows}${shapeHtml}${lwCaptainChangeSection(r)}`}
            </div>

            ${shapeChanged ? `<div class="detail-section">
                <div class="detail-section-title">Why this shape</div>
                ${altHtml}
            </div>` : ''}

            <div class="detail-section">
                <div class="detail-section-title">${v2Icon('bench')} Bench</div>
                ${benchHtml}
            </div>

            <div class="detail-section opt-crosslink">
                The full read on the lineup — where its points come from, what it faces and what could go wrong — lives in the
                <strong>Overview</strong> and <strong>Captaincy</strong> tabs, which stay up to date whether or not you optimise.
            </div>`;
        }

        function openLineupOptimizeReport() {
            if (!lineupState.optimizeReport) return;
            v2SetPanelTitle('optReportTitle', `GW${Number(planningGW)} — what Auto-optimise changed`, 'chart');
            document.getElementById('optReportBody').innerHTML = renderLWChangeReport(lineupState.optimizeReport);
            document.getElementById('optReportOverlay').classList.add('show');
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        // ── STEP 3: Captain & Summary ──
        /* The same card the squad and dashboard pitches use: face, club badge,
           armband in the corner. The position was a coloured ring around a
           jersey number; on a pitch the row a player is standing in already
           says his position, and the badge says more than the number did. */
        function renderLWSummaryPitchPlayer(p) {
            const isCap = lineupState.captain === p.id;
            const isVC = lineupState.viceCaptain === p.id;
            const ident = { name: p.web_name, code: p.code, teamId: p.team || p.teamId, team: p.teamShort || p.team_short_name || '' };

            return `<div class="lw-pitch-player${isCap ? ' is-captain' : ''}">
                ${isCap ? '<span class="lw-pitch-arm">C</span>' : ''}
                ${isVC ? '<span class="lw-pitch-arm vice">V</span>' : ''}
                ${typeof v2IdentityHTML === 'function' ? v2IdentityHTML(ident) : ''}
                <div class="lw-pitch-name">${escHTML(p.web_name)}</div>
            </div>`;
        }

/* What the optimiser did to the team the manager actually has, grouped
           by the kind of change rather than listed one player per row.

           Six rows reading "Promoted to XI", "Promoted to XI", "Moved to
           bench"... made the reader do the grouping themselves, and the label
           on each row repeated what its own badge already said. Three lines
           answer it: who came in, who went out, and where the armband ended up.

           The armband line is always shown while there is anything to report.
           It is the most expensive single decision on the screen and "unchanged"
           is a useful thing to be told, not noise. */
        function renderLWChanges() {
            const origIds = lineupState.originalXIIds || new Set();
            const inList = lineupState.xi.filter(p => !origIds.has(p.id));
            const outList = lineupState.bench.filter(p => origIds.has(p.id));
            const cap = lineupState.squad.find(p => p.id === lineupState.captain);
            const vc = lineupState.squad.find(p => p.id === lineupState.viceCaptain);
            const capChanged = lineupState.captain !== lineupState.originalCaptain;
            const vcChanged = lineupState.viceCaptain !== lineupState.originalVC;

            if (!inList.length && !outList.length && !capChanged && !vcChanged) {
                return `<div class="lw-ov-quiet">${v2Icon('check')} Your FPL lineup already matches this one — nothing to change.</div>`;
            }

            const names = list => list
                .map(p => `<span class="lw-ovc-p">${escHTML(p.web_name)}<span class="lw-ovc-pos">${escHTML(lwPosShort(p))}</span></span>`)
                .join('');

            const armband = [
                cap ? `<span class="lw-ovc-p${capChanged ? ' is-new' : ''}">${escHTML(cap.web_name)}<span class="lw-ovc-pos">C</span></span>` : '',
                vc ? `<span class="lw-ovc-p${vcChanged ? ' is-new' : ''}">${escHTML(vc.web_name)}<span class="lw-ovc-pos">VC</span></span>` : ''
            ].filter(Boolean).join('');

            return `<div class="lw-ov-block">
                <div class="lw-ov-h">${v2Icon('swap')} Optimiser changes <span class="lw-ov-h-sub">vs your live FPL team</span></div>
                ${inList.length ? `<div class="lw-ovc-row">
                    <span class="lw-change-badge promoted">In</span>
                    <span class="lw-ovc-list">${names(inList)}</span>
                </div>` : ''}
                ${outList.length ? `<div class="lw-ovc-row">
                    <span class="lw-change-badge benched">Out</span>
                    <span class="lw-ovc-list">${names(outList)}</span>
                </div>` : ''}
                ${armband ? `<div class="lw-ovc-row">
                    <span class="lw-change-badge captain">${v2Icon('crown')}</span>
                    <span class="lw-ovc-list">${armband}</span>
                    ${!capChanged && !vcChanged ? '<span class="lw-ovc-same">unchanged</span>' : ''}
                </div>` : ''}
            </div>`;
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


        // ── LINEUP WIZARD: Context Panel Rendering ──
        function renderLWContextEmpty() {
            return `<div class="lw-ctx-panel">
                <div class="lw-ctx-empty">
                    <div class="lw-ctx-empty-icon"><i data-lucide="mouse-pointer-click" style="width:32px;height:32px;"></i></div>
                    <div style="font-weight:600;margin-bottom:4px;">Player Intel Panel</div>
                    <div>Click a player's ℹ to view deep stats & score breakdown.<br>Click a second ℹ to compare side-by-side.</div>
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

            let html = `<div class="lw-ctx-panel">`;
            // Header
            html += `<div class="lw-ctx-header">
                <span style="padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;background:${posColors[p.pos]}22;color:${posColors[p.pos]};">${posNames[p.pos]}</span>
                <div class="lw-ctx-header-name">${escHTML(p.web_name)}</div>
                <span style="font-size:11px;color:var(--text-muted);">${escHTML(p.team)} · £${p.price.toFixed(1)}m</span>
                <button class="lw-ctx-header-close" onclick="lineupState.selectedPlayers=[];updateLWContextPanel();">✕</button>
            </div>`;

            html += `<div class="lw-ctx-body">`;

            // The same AI report, verdict, key stats, season numbers, routes to
            // points, price watch, team context (with the fixture-swing
            // breakdown) and opponent-form sections the Squad Analysis inline
            // card and the Transfer Wizard compare show — this panel's own
            // header above already covers name/position/price, so the profile's
            // own header is switched off to avoid repeating it.
            const analysis = typeof getPlayerAnalysis === 'function' ? getPlayerAnalysis(p) : null;
            html += analysis && typeof buildPlayerFullProfileHTML === 'function'
                ? buildPlayerFullProfileHTML(p, analysis, { header: false })
                : '';

            // Home/Away Splits and xG Regression are genuinely unique to this
            // panel — player-level splits and goals-vs-xG, neither of which the
            // shared profile above covers — so they stay, appended after it.
            html += lwBuildSingleSplits(p);
            html += lwBuildSingleXgRegression(p);

            html += `</div></div>`;
            return html;
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

            // Full profile per player — same AI report/verdict/key stats/routes/
            // price watch/team context/opponent form as the single-player view
            // above, stacked rather than side by side: this panel is already the
            // narrower 2fr of a 3fr/2fr split with the pitch, so a further 2-up
            // split here would squeeze each player's detail into a sliver.
            [p1, p2].forEach(p => {
                const analysis = typeof getPlayerAnalysis === 'function' ? getPlayerAnalysis(p) : null;
                if (!analysis || typeof buildPlayerFullProfileHTML !== 'function') return;
                html += `<div class="lw-deep-col ${p === p2 ? 'in' : ''}">
                    <div class="lw-deep-col-head ${p === p2 ? 'in' : ''}">${escHTML(p.web_name)}</div>
                    ${buildPlayerFullProfileHTML(p, analysis, { header: false })}
                </div>`;
            });

            // Home/Away comparison
            html += lwBuildCompareSplits(p1, p2);
            // xG Regression comparison
            html += lwBuildCompareXgRegression(p1, p2);

            html += `</div>`;
            return html;
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

        // Repaints the pitch, the formation and the intel pane together, so a
        // swap can never leave the projected total describing the previous lineup.
        function refreshLWView() {
            // Every in-place change ends here — a swap, an armband, a vice — so
            // this is where a decision becomes something that survives a reload.
            lwRemember();
            const pitch = document.getElementById('lwPitchPane');
            if (pitch) pitch.innerHTML = renderLWPitch();
            const f = document.getElementById('lwFormation');
            if (f) f.textContent = lineupState.formation;
            // The total was written here too, into a header chip that no longer
            // exists. It sits above the intel tabs now, and updateLWContextPanel
            // repaints that pane wholesale, so the figure still follows the swap.
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

        // ── LINEUP WIZARD: Info/Compare Button Handler ──
        // A plain click on the card itself now swaps (see lwCard's onclick,
        // matching how the Squad Analysis pitch already lets you swap by just
        // clicking two players — no dedicated button needed for that). This is
        // the ℹ button's handler instead: always toggles compare-select,
        // independent of any swap in progress, so viewing a player's detail
        // never gets swallowed by swap mode the way the old combined handler
        // used to swallow it.
        function handleLWInfoBtnClick(playerId, event) {
            if (event) event.stopPropagation();
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
