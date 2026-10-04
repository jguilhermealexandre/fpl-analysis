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

            /* A pick whose player is not in the dataset used to vanish without
               trace: map() returned null and filter(Boolean) swept it up, so a
               fifteen-man squad quietly became fourteen and the missing man
               was simply never drawn. The squad is still built without him —
               there is nothing to draw — but the page now says so. */
            const missingPicks = [];
            const squad = picksData.picks.map(pick => {
                const p = allPlayersById[pick.element];
                if (!p) { missingPicks.push(pick.element); return null; }
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
            lineupState.missingPicks = missingPicks;
            lineupState.excluded = new Set();
            lineupState.swapSource = null;
            lineupState.selectedPlayers = [];
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
                    <div class="lw-cc-head">
                        <div class="lw-cc-title">${v2Icon('sliders')} Lineup command centre
                            <span class="lw-cc-gw">GW${planningGW}</span></div>
                        ${lwRenderLayoutSwitch()}
                    </div>

                    <!-- Overview, then the three panels, then the pitch is one
                         of those panels rather than an afterthought. Which of
                         the two arrangements is in force is a class on
                         #lwMain; the markup is identical either way. -->
                    ${lwRenderOverviewRow()}
                    <div class="lw-main is-${lwLayout()}" id="lwMain">
                        <div class="lw-slot-lineup" id="lwLineupPane">${lwRenderLineupPanel()}</div>
                        <div class="lw-slot-cap" id="lwCaptaincyPane">${lwRenderCaptaincy()}</div>
                        <div class="lw-slot-md" id="lwMatchdayPane">${lwRenderMatchday()}</div>
                    </div>

                    <!-- The page as it stood before the redesign, for
                         comparison. Self-contained: see
                         scripts/lineup-wizard-legacy.js. Removing it is
                         deleting that file, its stylesheet block, its manifest
                         entry and these lines. -->
                    <section class="lw-legacy" id="lwLegacySection">
                        <header class="lw-legacy-head">
                            <h3 class="lw-legacy-title">${v2Icon('clock')} Previous version</h3>
                            <span class="lw-legacy-tag">before the redesign</span>
                        </header>
                        <p class="lw-legacy-note">The Lineup Wizard as it was at 92d26c8c, running live against the same squad \u2014 for comparing what the redesign kept against what it dropped. Everything here works; the two versions share the same lineup, so a swap or an armband in one shows in the other.</p>
                        <div id="lwLegacyBody"></div>
                    </section>
                </div>`;
            if (window.lwLegacy) window.lwLegacy.render();
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

            /* The armband, set here rather than only read here.

               It was a badge in the card's corner — the dashboard's treatment,
               correct for a screen you only look at. This screen is the one
               where the armband is chosen, and a separate panel to do it in was
               a second place to look for a decision about a player you are
               already looking at. Two small buttons on the card: the one in
               force is filled, the other is an offer. Starters only, and not
               the keeper, because neither can hold it.

               The bench and the keeper keep the plain badge: it still has to be
               possible to SEE who the captain is from a card that cannot set
               it. */
            const isCap = p.id === lineupState.captain, isVice = p.id === lineupState.viceCaptain;
            let armband = '';
            if (benchIdx == null && p.pos !== 1) {
                armband = `<span class="dp-arm-set" draggable="false" onclick="event.stopPropagation()">
                    <button class="dp-arm${isCap ? ' on-c' : ''}" draggable="false" onclick="event.stopPropagation();setLWCaptain(${p.id})"
                        data-tooltip="${isCap ? `${escHTML(p.web_name)} is your captain — points doubled.` : `Make ${escHTML(p.web_name)} captain`}">C</button>
                    <button class="dp-arm${isVice ? ' on-v' : ''}" draggable="false" onclick="event.stopPropagation();setLWViceCaptain(${p.id})"
                        data-tooltip="${isVice ? `${escHTML(p.web_name)} is your vice-captain.` : `Make ${escHTML(p.web_name)} vice-captain`}">V</button>
                </span>`;
            } else if (isCap) armband = `<span class="dp-cap" data-tooltip="Captain — points doubled.">C</span>`;
            else if (isVice) armband = `<span class="dp-cap" data-tooltip="Vice-captain — takes the armband if the captain does not play.">V</span>`;

            /* What Auto-optimise just did, marked on the thing it did it to.
               The report already knows; it was only ever shown as prose. */
            const rep = lineupState.optimizeReport;
            let moved = '';
            if (rep) {
                if ((rep.promoted || []).some(q => q.id === p.id)) moved = ' is-moved-in';
                else if ((rep.benchedOut || []).some(e => e.player && e.player.id === p.id)) moved = ' is-moved-out';
            }

            let badges = '';
            if (benchIdx != null) badges += `<span class="dp-badge bench" data-tooltip="${benchIdx === 'GK' ? 'Reserve keeper.' : `Substitution order — ${benchIdx} in line.`}">${benchIdx === 'GK' ? 'GK' : 'B' + benchIdx}</span>`;
            if (out) badges += `<span class="dp-badge out" data-tooltip="${escHTML(p.news || 'Unavailable this gameweek')}">OUT</span>`;
            else if (doubt) badges += `<span class="dp-badge doubt" data-tooltip="${escHTML(p.news || 'Fitness doubt')}${p.chanceNextRound != null ? ` — ${p.chanceNextRound}% chance of playing` : ''}">?</span>`;
            else if (rotation) badges += `<span class="dp-badge doubt" data-tooltip="Rotation risk — around ${Math.round(risk.pStart * 100)}% likely to start, based on minutes per appearance.">⟳</span>`;

            const fixChip = fx
                ? `<span class="dp-fix fdr-${fx.difficulty || 3}" data-tooltip="${fx.isHome ? 'Home to' : 'Away at'} ${escHTML(fx.opponent || '?')} — FDR ${fx.difficulty || 3} (${LW_FDR_WORD[fx.difficulty || 3] || 'Average'})">${escHTML(fx.opponent || '?')} <span class="dp-fix-ha">(${fx.isHome ? 'H' : 'A'})</span></span>`
                : `<span class="dp-fix dp-fix-blank" data-tooltip="No fixture this gameweek.">Blank</span>`;

            const cls = ['dp-card', posClass, out ? 'is-out' : '', selected ? 'lw-picked' : '',
                isSwapSrc ? 'swap-selected' : '', isSwapTgt ? 'swap-target' : '', moved.trim()].filter(Boolean).join(' ');

            /* The card the dashboard draws, exactly: face and crest above the
               name, then the projection on a line of its own, then who it
               comes against. This pitch had the number as a pill laid over
               the photo and a coloured stripe along the top of the card —
               enough that the two screens did not read as the same object. */
            const lwIdent = { name: p.web_name, code: p.code, teamId: p.teamId, team: p.team };
            /* Drag to swap, as well as click to swap — the same operation,
               lwSwapPlayers(), reached two ways. The drag is built on pointer
               events rather than HTML5 drag-and-drop, which never fires from a
               touchscreen: this way a finger can do it too, by holding and
               then moving. data-lw-id is how the pointer handler identifies
               whatever card ends up under the cursor. */
            return `<div class="${cls}" onclick="handleLWSwapClick(${p.id})" data-lw-id="${p.id}">
                <div class="dp-badges">${badges}</div>
                ${armband}
                <button class="dp-transfer" draggable="false" onclick="handleLWInfoBtnClick(${p.id}, event)" data-tooltip="View ${escHTML(p.web_name)}'s detail — click a second player to compare them">ℹ</button>
                ${typeof v2IdentityHTML === 'function' ? v2IdentityHTML(lwIdent, 'v2-pid-pitch') : ''}
                <div class="dp-name">${escHTML(p.web_name)}</div>
                <div class="dp-score" data-tooltip="Projected points for ${escHTML(p.web_name)} this gameweek."><b>${xp.toFixed(1)}</b><span class="u">xP</span></div>
                <div class="dp-fixtures">${fixChip}</div>
                ${lwRun.length > 1 ? `<div class="dp-xp-run" data-tooltip="Projected points across GW${lwRun[0]}\u2013GW${lwRun[lwRun.length - 1]} combined \u2014 this is what Auto-optimise ranks the XI on, so a steady run beats one flukey week.">${lwRunXP.toFixed(1)}<span class="dp-xp-run-u">next ${lwRun.length}</span></div>` : ''}
            </div>`;
        }

/* ===== MATCHDAY =====

           The section that decides who starts, so it is built from the round's
           fixtures and your squad — not from the odds feed.

           That distinction is the whole bug it replaces. The old panel was
           sourced from data/odds.json, which prices whatever football-data.co.uk
           had published when the job last ran: for GW5 that is five of the ten
           scheduled fixtures, a fact the feed states about itself
           (coverage: {priced: 5, scheduled: 10, complete: false}). Ten of the
           twenty clubs therefore did not exist as far as this screen was
           concerned, and every player at one of them silently vanished from a
           fifteen-man squad. Nothing was mis-mapped; the spine was simply the
           wrong list.

           Fixtures are the spine now and the odds are a left join on fixtureId.
           A priced match gains a market row; an unpriced one still shows its
           badges, its kickoff and this site's own clean-sheet model, and every
           player in the squad appears exactly once. */
        function lwMatchdayRows() {
            const fixtures = (typeof allFixtures !== 'undefined' && Array.isArray(allFixtures)) ? allFixtures : [];
            const squad = (lineupState && lineupState.squad) || [];
            if (!fixtures.length || !squad.length) return [];

            const xi = new Set((lineupState.xi || []).map(p => p.id));
            const priced = {};
            if (typeof boOdds !== 'undefined' && boOdds && Array.isArray(boOdds.matches)) {
                boOdds.matches.forEach(m => { if (m.fixtureId != null) priced[m.fixtureId] = m; });
            }

            return fixtures
                .filter(f => f.event === planningGW)
                .map(f => {
                    /* Every squad member at either club, starters and bench
                       alike. pickPos orders them the way the squad list does. */
                    const mine = squad
                        .filter(p => p.teamId === f.team_h || p.teamId === f.team_a)
                        .map(p => ({
                            p,
                            starting: xi.has(p.id),
                            captain: lineupState.captain === p.id,
                            vice: lineupState.viceCaptain === p.id,
                            home: p.teamId === f.team_h
                        }))
                        .sort((a, b) => (b.starting - a.starting)
                            || (b.captain - a.captain)
                            || ((a.p.pickPos || 99) - (b.p.pickPos || 99)));
                    return { f, mine, odds: priced[f.id] || null };
                })
                /* A fixture with none of your players is noise on a screen
                   whose only question is which of your players to start. */
                .filter(r => r.mine.length)
                .sort((a, b) => String(a.f.kickoff_time || '').localeCompare(String(b.f.kickoff_time || '')));
        }

        /* The two clean-sheet numbers, named.

           They were drawn as "62% vs 55%" with the explanation in a tooltip, so
           the difference between a bookmaker's price and this site's model was
           invisible to anyone who did not hover. Both are labelled now and the
           section carries a one-line legend; the tooltip still holds the long
           version. */
        function lwCsCell(teamId, oppId, isHome, marketCs) {
            let model = null;
            if (typeof getCleanSheetProb === 'function' && typeof teamAnalysis !== 'undefined') {
                try { model = getCleanSheetProb(teamId, oppId, isHome); } catch (e) { model = null; }
            }
            const pct = v => Math.round(v * 100) + '%';
            if (marketCs == null && model == null) return '';
            const gap = (marketCs != null && model != null) ? Math.abs(model - marketCs) : 0;
            return `<div class="lwm-m lwm-cs${gap >= 0.10 ? ' is-wide' : ''}" data-tooltip="${escHTML(
                'Chance of a clean sheet. '
                + (marketCs != null ? `The betting market prices it at ${pct(marketCs)}. ` : 'The market has not priced this fixture. ')
                + (model != null ? `EasyFPL's own model says ${pct(model)}.` : '')
                + (gap >= 0.10 ? ' They disagree by ten points or more, which is the interesting case.' : ''))}">
                <span class="lwm-m-l">CS</span>
                ${marketCs != null
                    ? `<span class="lwm-cs-n"><em>Mkt</em><b>${pct(marketCs)}</b></span>`
                    : `<span class="lwm-cs-n is-none"><em>Mkt</em><b>—</b></span>`}
                ${model != null
                    ? `<span class="lwm-cs-n is-ours"><em>Ours</em><b>${pct(model)}</b></span>`
                    : ''}
            </div>`;
        }

        function lwCrest(team) {
            if (!team || team.code == null) return '';
            // alt is empty on purpose: the short name sits beside it.
            return `<img class="lwm-crest" width="24" height="24" loading="lazy" alt=""
                onerror="this.remove()"
                src="https://resources.premierleague.com/premierleague/badges/100/t${team.code}.png">`;
        }

        function lwMatchPlayer(m) {
            const p = m.p;
            const pos = lwPosShort(p);
            const out = p.status === 'i' || p.status === 'u' || p.status === 's';
            const doubt = p.status === 'd';
            const arm = m.captain ? '<span class="lwm-arm c" data-tooltip="Captain — points doubled">C</span>'
                : m.vice ? '<span class="lwm-arm v" data-tooltip="Vice-captain">V</span>' : '';
            return `<span class="lwm-p${m.starting ? ' is-xi' : ' is-bench'}${out ? ' is-out' : doubt ? ' is-doubt' : ''}"
                data-tooltip="${escHTML(`${p.web_name} — ${pos}, ${m.starting ? 'in your XI' : 'on your bench'}`
                    + (out ? `. ${p.news || 'Unavailable'}` : doubt ? `. ${p.news || 'Fitness doubt'}` : '')
                    + `. Projected ${(p.gwScore || 0).toFixed(1)} points this gameweek.`)}">
                ${lwFace(p)}
                <span class="lwm-p-n">${escHTML(p.web_name)}</span>
                <span class="lwm-p-pos">${escHTML(pos)}</span>${arm}
                <b class="lwm-p-xp">${(p.gwScore || 0).toFixed(1)}</b>
            </span>`;
        }

        /* One team's side of a priced fixture: what the market expects them to
           score, and what both estimators give them for a clean sheet.

           This was one cramped row with the two clubs' numbers interleaved, so
           "ARS Mkt — Ours 40% LEE Mkt — Ours 31%" ran together as a single
           unreadable line. A column per club is the shape the old odds panel
           used and it was right: the numbers stack under the badge they belong
           to, and nothing has to be read across a divider. */
        function lwTeamSide(team, teamId, oppId, isHome, o) {
            const short = (team && team.short_name) || '?';
            const name = (team && team.name) || short;
            const xg = o ? (isHome ? o.lambdaHome : o.lambdaAway) : null;
            const marketCs = o ? (isHome ? o.csHome : o.csAway) : null;
            return `<div class="lwm-side${isHome ? '' : ' is-away'}">
                <div class="lwm-side-top">
                    <span class="lwm-side-t">${escHTML(short)}</span>
                    <span class="lwm-ha" data-tooltip="${isHome ? 'At home' : 'Away'}">${isHome ? 'H' : 'A'}</span>
                </div>
                <div class="lwm-m" data-tooltip="${escHTML(xg != null
                    ? `Goals ${name} are expected to score, implied by the match and over/under prices.`
                    : 'No market price for this fixture yet, so there is no goal expectation to show.')}">
                    <span class="lwm-m-l">xG</span><b>${xg != null ? xg.toFixed(2) : '—'}</b>
                </div>
                ${lwCsCell(teamId, oppId, isHome, marketCs)}
            </div>`;
        }

        function lwRenderFixture(row) {
            const f = row.f, o = row.odds;
            const tm = (typeof teams !== 'undefined' && teams) || {};
            const home = tm[f.team_h] || {}, away = tm[f.team_a] || {};
            const ko = typeof boKickoff === 'function' ? boKickoff(f.kickoff_time) : '';
            const xiCount = row.mine.filter(m => m.starting).length;
            const pc = v => Math.round(v * 100) + '%';

            const goals = o ? (o.lambdaHome + o.lambdaAway) : null;
            /* Win, draw, lose — as numbers, not only as a bar.

               The bar alone said which way a match leans and refused to say by
               how much, with the percentages hidden in a tooltip that a phone
               has no way to open. A 45/30/25 and a 70/20/10 are the same
               picture and completely different team-selection decisions. The
               bar stays as the shape; the three figures sit under it, each by
               the side it belongs to. */
            const bar = o ? `<div class="lwm-wdl">
                <span class="lwm-res" aria-hidden="true">
                    <i class="lwm-res-h" style="width:${(o.market.home * 100).toFixed(1)}%"></i>
                    <i class="lwm-res-d" style="width:${(o.market.draw * 100).toFixed(1)}%"></i>
                    <i class="lwm-res-a" style="width:${(o.market.away * 100).toFixed(1)}%"></i>
                </span>
                <span class="lwm-wdl-n">
                    <span class="lwm-wdl-i is-h" data-tooltip="${escHTML(`${home.short_name || 'Home'} win, as the market prices it.`)}"><em>${escHTML(home.short_name || 'H')}</em><b>${pc(o.market.home)}</b></span>
                    <span class="lwm-wdl-i is-d" data-tooltip="Draw, as the market prices it."><em>Draw</em><b>${pc(o.market.draw)}</b></span>
                    <span class="lwm-wdl-i is-a" data-tooltip="${escHTML(`${away.short_name || 'Away'} win, as the market prices it.`)}"><em>${escHTML(away.short_name || 'A')}</em><b>${pc(o.market.away)}</b></span>
                </span>
            </div>` : '';

            /* Total goals, over 2.5, both teams to score, and the single
               likeliest scoreline. Four numbers that describe the SHAPE of the
               match rather than who wins it, which is exactly the question a
               defender's owner is asking. */
            const top = o && o.scorelines && o.scorelines[0];
            const extras = o ? `<div class="lwm-ex">
                <span class="lwm-ex-i" data-tooltip="Total goals the market expects in this match."><em>Goals</em><b>${goals.toFixed(2)}</b></span>
                <span class="lwm-ex-i" data-tooltip="Chance of three or more goals in the match."><em>Over 2.5</em><b>${pc(o.over25)}</b></span>
                <span class="lwm-ex-i" data-tooltip="Chance both teams score."><em>BTTS</em><b>${pc(o.bttsYes)}</b></span>
                ${top ? `<span class="lwm-ex-i" data-tooltip="${escHTML(`The single likeliest scoreline, at ${pc(top.p)}.`)}"><em>Likeliest</em><b>${top.h}–${top.a}</b></span>` : ''}
            </div>` : `<div class="lwm-ex is-none" data-tooltip="The betting feed has not priced this fixture, so there is no market line for it. Your players and EasyFPL's own clean-sheet model are unaffected.">Not priced yet — EasyFPL's own numbers only</div>`;

            return `<article class="lwm-fix">
                <header class="lwm-fix-head">
                    <span class="lwm-ko">${escHTML(ko)}</span>
                    <span class="lwm-mine-n" data-tooltip="${escHTML(
                        `${row.mine.length} of your squad play in this match — ${xiCount} in your XI, ${row.mine.length - xiCount} on the bench.`)}">${row.mine.length}<em>yours</em></span>
                </header>
                <div class="lwm-teams">
                    <span class="lwm-team h">${lwCrest(home)}<b>${escHTML(home.short_name || '?')}</b></span>
                    <span class="lwm-v">v</span>
                    <span class="lwm-team a"><b>${escHTML(away.short_name || '?')}</b>${lwCrest(away)}</span>
                </div>
                ${bar}
                <div class="lwm-sides">
                    ${lwTeamSide(home, f.team_h, f.team_a, true, o)}
                    ${lwTeamSide(away, f.team_a, f.team_h, false, o)}
                </div>
                ${extras}
                <div class="lwm-players">${row.mine.map(lwMatchPlayer).join('')}</div>
            </article>`;
        }

        /* What the section says about its own numbers: when the feed last ran,
           whether it is stale, whether the market is actually blended into the
           projections on this page or only shown beside them, and where it all
           comes from. Shown rather than assumed — a blended projection should
           never be a silent one. */
        function lwMatchdayProvenance() {
            if (typeof boOdds === 'undefined' || !boOdds) return '';
            const meta = boOdds.metadata || {};
            const updated = meta.lastUpdated ? new Date(meta.lastUpdated) : null;
            const stale = updated ? (Date.now() - updated.getTime()) > 36 * 3600 * 1000 : false;
            const b = typeof boBlendInfo === 'function' ? boBlendInfo() : { active: false };
            return `${stale ? `<p class="lwm-stale">${v2Icon('warn')} These prices are more than a day old — the odds job has not run since. Treat them as indicative.</p>` : ''}
                <div class="lwm-prov">
                    ${b.active
                        ? `<span class="lwm-blend is-on" data-tooltip="${escHTML(
                            `Every projection on this page for GW${b.event} is ${Math.round(b.weight * 100)}% the market's goal expectations and ${Math.round((1 - b.weight) * 100)}% EasyFPL's own model. The market's share falls as the season gives the model more of its own evidence — currently ${b.matchesPlayed ?? 0} matches played. Later gameweeks are model-only: bookmakers do not price them yet.`)}">Blended into GW${b.event} projections · market weight ${Math.round(b.weight * 100)}%</span>`
                        : `<span class="lwm-blend is-off" data-tooltip="Projections are model-only. The market is blended in only when every fixture in the round is priced, so that no two players are being compared across different estimators.">Shown for reference — not blended into projections</span>`}
                    ${updated ? `<span class="lwm-updated" data-tooltip="${escHTML(`Odds feed last refreshed ${updated.toLocaleString()}.`)}">Odds updated ${escHTML(updated.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}</span>` : ''}
                </div>`;
        }

        function lwRenderMatchday() {
            const rows = lwMatchdayRows();
            if (!rows.length) {
                return `<section class="v2-section lwm"><div class="lw-side-empty">No fixtures this gameweek involve your players.</div></section>`;
            }
            /* Asked for once, here, rather than by the panel that used to own
               this section — the odds only ever enrich these cards now, so a
               feed that never arrives costs the section nothing. */
            if (typeof boOdds !== 'undefined' && !boOdds && typeof boLoadOdds === 'function') {
                boLoadOdds().then(d => { if (d) refreshLWView(); });
            }
            const counted = rows.reduce((s, r) => s + r.mine.length, 0);
            const unpriced = rows.filter(r => !r.odds).length;
            /* .v2-section and .section-header: the panel every other screen on
               the site is built out of, rather than a heading floating over a
               list. */
            return `<section class="v2-section lwm">
                <div class="section-header">
                    <h2>${v2Icon('ball')} Matchday <span class="lwm-gw">GW${planningGW}</span></h2>
                    <span class="lwm-sub">${rows.length} ${rows.length === 1 ? 'fixture' : 'fixtures'} · ${counted} of your ${(lineupState.squad || []).length}</span>
                </div>
                ${lwMatchdayProvenance()}
                <div class="lwm-legend">
                    <span class="lwm-key"><i class="lwm-key-sw is-xi"></i>Starting</span>
                    <span class="lwm-key"><i class="lwm-key-sw is-bench"></i>Bench</span>
                    <span class="lwm-key lwm-key-cs" data-tooltip="Clean sheet chance. Mkt is the betting market's price; Ours is EasyFPL's own model from our fixture and defensive analysis.">
                        CS · <em>Mkt</em> betting market · <em>Ours</em> EasyFPL model</span>
                    <span class="lwm-key" data-tooltip="Goals each side is expected to score, implied by the match and over/under prices.">xG · goals expected, per side</span>
                </div>
                <div class="lwm-list">${rows.map(lwRenderFixture).join('')}</div>
                ${unpriced ? `<p class="lwm-foot">${unpriced} of these ${unpriced === 1 ? 'fixtures has' : 'fixtures have'} no market price yet — bookmakers publish a round in instalments. Your players and EasyFPL's own numbers are shown regardless.</p>` : ''}
                <p class="lwm-foot">Market numbers are derived from de-vigged 1X2 and over/under 2.5 prices, fitted to independent Poisson. Nobody quotes a clean-sheet percentage; those are derived the same way. Odds describe one gameweek only. Source: football-data.co.uk.</p>
            </section>`;
        }

/* ===== CAPTAINCY, COMPACT =====

           One decision, so one column: who wears it, ranked, with the reason
           tied to the match rather than to a stat sheet. The full matrix this
           replaces was five cards wide and competed with Matchday for the eye;
           here it is a narrow list that still answers "why him" in a line.

           Ranked on gwScore because the armband only ever pays out for this
           gameweek — the XI itself is picked on a longer run, which is a
           different question. */
        function lwCaptainReason(p) {
            const fx = (p.fixtures || teamFixtures[p.teamId] || [])[0];
            if (!fx) return 'No fixture this gameweek.';
            const where = fx.isHome ? 'at home to' : 'away at';
            const opp = fx.opponent || 'opponent';
            let market = null;
            if (typeof boOdds !== 'undefined' && boOdds && Array.isArray(boOdds.matches)) {
                const m = boOdds.matches.find(x => x.homeId === p.teamId || x.awayId === p.teamId);
                if (m) {
                    const isHome = m.homeId === p.teamId;
                    const goals = isHome ? m.lambdaHome : m.lambdaAway;
                    market = `market has ${escHTML(isHome ? m.home : m.away)} for ${goals.toFixed(1)} goals`;
                }
            }
            let ctx = null;
            if (typeof teamAnalysis !== 'undefined' && fx.opponentId && teamAnalysis[fx.opponentId]) {
                const opp2 = teamAnalysis[fx.opponentId];
                if (opp2 && typeof opp2.avgConceded === 'number') {
                    ctx = `they concede ${opp2.avgConceded.toFixed(1)} a game`;
                }
            }
            return `${where} ${escHTML(opp)}${market ? ` · ${market}` : ctx ? ` · ${ctx}` : ''}`;
        }

        /* One candidate's row: everything the five-card matrix carried, laid
           out down a list instead of across a grid.

           The matrix was five cards wide and competed with Matchday for the
           eye. The numbers in it were not the problem — a captaincy is decided
           on how dangerous the player is, how leaky the defence he faces is,
           whether he will actually start, and where his points come from — so
           all of them are here. What changed is that they are read down a
           column rather than across five. */
        function lwCaptainRow(p, i, ranks) {
            const fx = (p.fixtures || teamFixtures[p.teamId] || [])[0];
            const ctx = fx && typeof opponentContext === 'function' ? opponentContext(p.teamId, fx, ranks) : null;
            const per90 = typeof regressedPer90 === 'function' ? regressedPer90(p) : { xg90: 0, xa90: 0 };
            const threat = (per90.xg90 || 0) + (per90.xa90 || 0);
            const risk = typeof optMinutesRisk === 'function' ? optMinutesRisk(p) : null;
            const form = isPreseason ? (p.ppg || 0) : (parseFloat(p.form) || 0);
            const isCap = lineupState.captain === p.id, isVC = lineupState.viceCaptain === p.id;

            /* xgcTrend is 'worsening' / 'improving' — a side shipping goals
               lately is a different bet from one whose season xGC merely looks
               bad, and the armband is a one-week call on current form. */
            const oppTA = fx && typeof teamAnalysis !== 'undefined' ? teamAnalysis[fx.opponentId] : null;
            const oppTrend = oppTA && oppTA.xgcTrend === 'worsening' ? 'leaking more lately'
                : oppTA && oppTA.xgcTrend === 'improving' ? 'tightening up lately' : null;
            const oppConceded = ctx && ctx.matches ? ctx.conceded : null;

            // Two bars: how dangerous this player is, and how leaky the defence
            // he faces. High threat into a tight defence is a different bet from
            // a modest one into the league's softest.
            const threatPct = Math.max(4, Math.min(100, (threat / 1.0) * 100));
            const weakPct = ctx && ctx.ranked
                ? Math.max(4, Math.min(100, ((ranks.total - ctx.rank + 1) / ranks.total) * 100)) : null;

            const fixChip = fx
                ? `<span class="dp-fix lw-cap-fdr fdr-${fx.difficulty || 3}" data-tooltip="${escHTML(`${fx.isHome ? 'Home to' : 'Away at'} ${fx.opponent || '?'} — FDR ${fx.difficulty || 3}`)}">${escHTML(fx.opponent || '?')} <span class="dp-fix-ha">(${fx.isHome ? 'H' : 'A'})</span></span>`
                : `<span class="dp-fix dp-fix-blank lw-cap-fdr" data-tooltip="No fixture this gameweek.">Blank</span>`;

            return `<li class="lwc-row${isCap ? ' is-cap' : ''}">
                <span class="lwc-rank">${i + 1}</span>
                ${lwFace(p)}
                <span class="lwc-body">
                    <span class="lwc-name">${escHTML(p.web_name)}<span class="lwc-team">${escHTML(p.team || '')} · ${escHTML(lwPosShort(p))}</span></span>
                    <span class="lwc-why">${lwCaptainReason(p)}</span>
                </span>
                <span class="lwc-xp" data-tooltip="${escHTML(`${p.gwScore.toFixed(1)} projected, doubled with the armband.`)}">${(p.gwScore * 2).toFixed(1)}<em>pts</em></span>
                <span class="lwc-acts">
                    <button class="lwc-btn${isCap ? ' on-c' : ''}" onclick="setLWCaptain(${p.id})" data-tooltip="Give ${escHTML(p.web_name)} the armband">C</button>
                    <button class="lwc-btn${isVC ? ' on-v' : ''}" onclick="setLWViceCaptain(${p.id})" data-tooltip="Make ${escHTML(p.web_name)} vice-captain">VC</button>
                </span>
                <span class="lwc-detail">
                    <span class="lwc-chips">
                        ${fixChip}
                        <span class="lwc-stat" data-tooltip="Form — points per match over the last 30 days."><em>Form</em><b>${form.toFixed(1)}</b></span>
                        <span class="lwc-stat" data-tooltip="Share of FPL managers who own him."><em>Owned</em><b>${p.ownership != null ? p.ownership + '%' : '—'}</b></span>
                        ${risk ? `<span class="lwc-stat is-risk ${escHTML(risk.cls)}" data-tooltip="${escHTML(`${risk.pct}% likely to start — ${risk.word}. A captain who does not play costs you double.`)}"><em>Starts</em><b>${risk.pct}%</b></span>` : ''}
                    </span>
                    <span class="lwc-bars">
                        <span class="lwc-bar-row" data-tooltip="${escHTML(`Expected goal involvements per 90 for ${p.web_name}: ${threat.toFixed(2)}.`)}">
                            <span class="lwc-bar-l">Threat</span>
                            <span class="lwc-bar"><span class="lwc-bar-f is-threat" style="width:${threatPct}%"></span></span>
                            <span class="lwc-bar-v">${threat.toFixed(2)}</span>
                        </span>
                        <span class="lwc-bar-row" data-tooltip="${escHTML(weakPct != null
                            ? `${fx.opponent} are the ${typeof ordinal === 'function' ? ordinal(ctx.rank) : ctx.rank} leakiest defence of ${ctx.total}, conceding ${ctx.conceded.toFixed(1)} per game.`
                            : 'Not enough matches played to rank this opponent yet.')}">
                            <span class="lwc-bar-l">Opponent</span>
                            <span class="lwc-bar">${weakPct != null
                                ? `<span class="lwc-bar-f is-weak" style="width:${weakPct}%"></span>`
                                : '<span class="lwc-bar-na">not yet ranked</span>'}</span>
                            <span class="lwc-bar-v">${weakPct != null ? `${typeof ordinal === 'function' ? ordinal(ctx.rank) : ctx.rank}/${ctx.total}` : '—'}</span>
                        </span>
                    </span>
                    ${(oppTrend || oppConceded != null) ? `<span class="lwc-ctx">${[
                        oppConceded != null ? `${escHTML(fx.opponent || 'Opponent')} concede ${oppConceded.toFixed(1)} a game` : '',
                        oppTrend ? `${escHTML(fx.opponent || 'Opponent')} ${oppTrend}` : ''
                    ].filter(Boolean).join(' · ')}</span>` : ''}
                    ${typeof optBreakdownBar === 'function' ? `<span class="lwc-break" data-tooltip="Where his projected points come from.">${optBreakdownBar(p)}</span>` : ''}
                </span>
            </li>`;
        }

        function lwRenderCaptaincy() {
            /* Selecting players with the ℹ button used to swap the Overview
               tab's body for a comparison. The tab strip is gone, so the
               comparison takes this column instead — it is the narrow one, it
               is where a second opinion belongs, and Matchday on the left stays
               put while you read it. */
            const sel = lineupState.selectedPlayers || [];
            if (sel.length) {
                const body = sel.length === 1 ? renderLWContextSingle(sel[0]) : renderLWContextCompare(sel[0], sel[1]);
                return `<section class="v2-section lwc is-compare">
                    <div class="section-header">
                        <h2>${v2Icon('scales')} ${sel.length === 1 ? 'Player detail' : 'Compare'}</h2>
                        <button class="lwc-clear" onclick="lineupState.selectedPlayers=[];refreshLWView();"
                            data-tooltip="Back to the captaincy list">Close</button>
                    </div>
                    ${body}
                </section>`;
            }

            const ranks = typeof getDefensiveRanks === 'function' ? getDefensiveRanks() : { rank: {}, total: 20 };
            const candidates = (lineupState.xi || []).filter(p => p.pos !== 1)
                .sort((a, b) => b.gwScore - a.gwScore).slice(0, 5);
            if (!candidates.length) {
                return `<section class="v2-section lwc"><div class="lw-side-empty">No outfield players in the XI yet.</div></section>`;
            }
            const lead = candidates.length > 1 ? candidates[0].gwScore - candidates[1].gwScore : 0;
            const picked = (lineupState.squad || []).find(p => p.id === lineupState.captain);
            const topRisk = typeof optMinutesRisk === 'function' ? optMinutesRisk(candidates[0]) : null;
            const verdict = candidates.length < 2
                ? `${escHTML(candidates[0].web_name)} is your only outfield option.`
                : lead > 0.8
                    ? `<strong>${escHTML(candidates[0].web_name)}</strong> is the clear call, ${lead.toFixed(1)} projected points clear of ${escHTML(candidates[1].web_name)} before the armband doubles it.`
                    : `Close call: <strong>${escHTML(candidates[0].web_name)}</strong> leads ${escHTML(candidates[1].web_name)} by only ${lead.toFixed(1)} projected points, so fixture and minutes risk decide it more than projection does.`;

            /* The off-pick line reads by sign. A captained keeper is never in
               the candidate list, so the subtraction can land either way and a
               bare minus sign read as a bug. */
            let off = '';
            if (picked && picked.id !== candidates[0].id) {
                const d = candidates[0].gwScore - picked.gwScore;
                off = `<p class="lwc-off">You have the armband on <strong>${escHTML(picked.web_name)}</strong>, ${Math.abs(d) < 0.05
                    ? `level with ${escHTML(candidates[0].web_name)}.`
                    : d > 0
                        ? `${d.toFixed(1)} projected points behind ${escHTML(candidates[0].web_name)}.`
                        : `${Math.abs(d).toFixed(1)} projected points ahead of ${escHTML(candidates[0].web_name)} — he is outside the outfield list because of his position.`}</p>`;
            }

            return `<section class="v2-section lwc">
                <div class="section-header">
                    <h2>${v2Icon('crown')} Captaincy</h2>
                    <span class="lwc-sub">set it here or on the pitch</span>
                </div>
                <p class="lwc-verdict">${verdict}${topRisk && topRisk.pct < 80 ? ` Worth noting he is only ${topRisk.pct}% likely to start.` : ''}</p>
                ${off}
                <ol class="lwc-list">${candidates.map((p, i) => lwCaptainRow(p, i, ranks)).join('')}</ol>
                <p class="lwc-foot">Ranked on this gameweek alone — the armband only ever pays out once. Threat is expected goal involvements per 90; Opponent is how leaky the defence he faces is, ranked across the league.</p>
            </section>`;
        }

        /* Where the eleven's projected points come from, totalled across the
           XI. Appearance, attack, clean sheet, saves, bonus, defcon — the same
           decomposition the optimiser scores each player on, added up. */
        function lwPointsSources(players) {
            const totals = {};
            players.forEach(p => {
                if (typeof optXpBreakdown !== 'function') return;
                optXpBreakdown(p).parts.forEach(x => { totals[x.key] = (totals[x.key] || 0) + x.v; });
            });
            return Object.keys(totals)
                .map(k => ({ key: k, v: totals[k] }))
                .filter(x => Math.abs(x.v) >= 0.05)
                .sort((a, b) => b.v - a.v);
        }

        function lwSourcesBar(sources) {
            const positive = sources.filter(x => x.v > 0);
            const total = Math.max(0.01, positive.reduce((s, x) => s + x.v, 0));
            const seg = positive.map(x =>
                `<span class="opt-seg opt-seg-${x.key.toLowerCase()}" style="width:${Math.round((x.v / total) * 100)}%"
                    data-tooltip="${escHTML(x.key)}: ${x.v.toFixed(1)} of the eleven's projected points"></span>`).join('');
            return `<div class="opt-bar">${seg}</div>
                <div class="opt-bar-legend">${sources.map(x => `${escHTML(x.key)} <strong>${x.v.toFixed(1)}</strong>`).join(' · ')}</div>`;
        }

        /* What the optimiser changed against the lineup saved on the FPL site,
           named. The strip under the pitch reports the totals; this names every
           player who moved and every armband that changed hands. */
        function lwChangeList() {
            const origIds = lineupState.originalXIIds || new Set();
            const changes = [];
            lineupState.xi.forEach(p => { if (!origIds.has(p.id)) changes.push({ player: p, type: 'promoted', label: 'Promoted to the XI' }); });
            lineupState.bench.forEach(p => { if (origIds.has(p.id)) changes.push({ player: p, type: 'benched', label: 'Moved to the bench' }); });
            if (lineupState.captain !== lineupState.originalCaptain) {
                const c = lineupState.squad.find(p => p.id === lineupState.captain);
                if (c) changes.push({ player: c, type: 'captain', label: 'New captain' });
            }
            if (lineupState.viceCaptain !== lineupState.originalVC) {
                const c = lineupState.squad.find(p => p.id === lineupState.viceCaptain);
                if (c) changes.push({ player: c, type: 'captain', label: 'New vice-captain' });
            }
            return changes;
        }

        function lwRenderChanges() {
            const changes = lwChangeList();
            if (!changes.length) {
                return `<div class="lw-sum-block">
                    <div class="lw-sum-h">${v2Icon('swap')} Changes against your saved lineup</div>
                    <div class="lw-sum-quiet">${v2Icon('check')} Your FPL lineup already matches this one — nothing to change.</div>
                </div>`;
            }
            const posNames = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
            return `<div class="lw-sum-block">
                <div class="lw-sum-h">${v2Icon('swap')} Changes against your saved lineup <span class="lw-sum-n">${changes.length}</span></div>
                <div class="lw-chg-list">${changes.map(c => `<div class="lw-chg-row is-${c.type}">
                    <span class="lw-chg-badge">${c.type === 'promoted' ? '↑ IN' : c.type === 'benched' ? '↓ OUT' : v2Icon('crown')}</span>
                    ${lwFace(c.player)}
                    <span class="lw-chg-name">${escHTML(c.player.web_name)}</span>
                    <span class="lw-chg-meta">${posNames[c.player.pos]} · ${escHTML(c.player.team || '')}</span>
                    <span class="lw-chg-label">${c.label}</span>
                    <span class="lw-chg-xp" data-tooltip="Projected points this gameweek.">${(c.player.gwScore || 0).toFixed(1)}</span>
                </div>`).join('')}</div>
            </div>`;
        }

        /* ===== THE OVERVIEW =====

           Every figure that described the eleven, back in one panel.

           It had been cut to four tiles on the grounds that the rest was true
           but not a decision. That was my call to make and it was not: a tile
           saying "0 flagged" cannot tell you the eleven is three-deep on one
           club, or that half its points are clean sheets against a round of
           away fixtures. The four headline tiles still lead, because they are
           what you scan; everything the old Overview carried sits under them,
           in the order you act on it.

           Everything here is this gameweek alone, except where it says
           otherwise. That matters in one place: the XI is SELECTED on the
           three-gameweek run (see lwScore), so the optimiser can bench a player
           who out-projects a starter this week. lwClosestCall() names the
           reason rather than printing a negative gap that reads as a bug. */
        function lwKpiBox(tone, icon, label, value, sub, tip) {
            return `<div class="sq-kpi"${tip ? ` data-tooltip="${escHTML(tip)}"` : ''}>
                <span class="sq-kpi-icon tone-${tone}">${v2Icon(icon)}</span>
                <span class="sq-kpi-body">
                    <span class="sq-kpi-label">${label}</span>
                    <span class="sq-kpi-value">${value}</span>
                    ${sub ? `<span class="sq-kpi-sub">${sub}</span>` : ''}
                </span>
            </div>`;
        }

        function lwRenderOverviewRow() {
            if (!lineupState.xi.length) return `<div id="lwKpis"></div>`;
            const xi = lineupState.xi, bench = lineupState.bench;
            const total = lwTotalXP();
            const live = lwLiveXP();
            const gain = live == null ? null : total - live;
            const risks = lwRiskList();
            const call = lwClosestCall();
            const origIds = lineupState.originalXIIds || new Set();
            const moves = xi.filter(p => !origIds.has(p.id)).length;

            const gainStr = gain == null ? '—'
                : Math.abs(gain) < 0.05 ? 'level'
                : `${gain > 0 ? '+' : '−'}${Math.abs(gain).toFixed(1)}`;

            /* How dependable the eleven is, and what it is walking into. */
            const starts = xi.map(p => typeof expectedMinutesModel === 'function' ? expectedMinutesModel(p).pStart : 1);
            const nailed = starts.filter(v => v >= 0.8).length;
            const expectedAbsent = starts.reduce((s, v) => s + (1 - v), 0);
            const fdrs = xi.map(p => typeof optFdrFor === 'function' ? optFdrFor(p) : 3);
            const avgFdr = fdrs.length ? fdrs.reduce((s, f) => s + f, 0) / fdrs.length : 3;
            const easyCount = fdrs.filter(f => f <= 2).length;
            const hardCount = fdrs.filter(f => f >= 4).length;

            // Three starters from one club is one result deciding your week.
            const byTeam = {};
            xi.forEach(p => { byTeam[p.teamId] = (byTeam[p.teamId] || 0) + 1; });
            const stacked = Object.keys(byTeam).filter(t => byTeam[t] >= 3)
                .map(t => `${(typeof teams !== 'undefined' && teams[t] ? teams[t].short_name : null) || '???'} (${byTeam[t]})`);

            const sources = lwPointsSources(xi);

            /* The weakest starter against the best substitute — one question,
               asked once. The upgrade is only offered when the shape survives
               it, so the button can never do nothing. */
            const lwRun = typeof xpPlanGWs === 'function' ? xpPlanGWs(XP_PLAN_HORIZON) : [];
            const runUnit = lwRun.length > 1 ? `xP over GW${lwRun[0]}–GW${lwRun[lwRun.length - 1]}` : 'xP';
            const weakest = [...xi].sort((a, b) => a.lwScore - b.lwScore)[0];
            const outfieldBench = bench.filter(p => p.pos !== 1 && !lineupState.excluded.has(p.id));
            const strongestBench = [...outfieldBench].sort((a, b) => b.lwScore - a.lwScore)[0];
            let upgrade = null;
            if (strongestBench && weakest) {
                const candidateXI = xi.filter(p => p.id !== weakest.id).concat([strongestBench]);
                if (isValidLWFormation(candidateXI) && strongestBench.lwScore > weakest.lwScore + 0.05) {
                    upgrade = { out: weakest, in: strongestBench, gain: strongestBench.lwScore - weakest.lwScore };
                }
            }

            return `<section class="v2-section lw-ov" id="lwKpis">
                <div class="section-header">
                    <h2>${v2Icon('target')} Overview <span class="lwm-gw">GW${planningGW}</span></h2>
                    <span class="lwc-sub">${escHTML(lineupState.formation)} · ${moves ? `${moves} change${moves === 1 ? '' : 's'} from your saved lineup` : 'same eleven as your saved lineup'}</span>
                </div>

                ${(lineupState.missingPicks || []).length ? `<p class="lwm-stale">${v2Icon('warn')}
                    ${lineupState.missingPicks.length} of your ${(lineupState.squad || []).length + lineupState.missingPicks.length} picks
                    ${lineupState.missingPicks.length === 1 ? 'is' : 'are'} missing from the player dataset
                    (element ${lineupState.missingPicks.join(', ')}), so ${lineupState.missingPicks.length === 1 ? 'he is' : 'they are'}
                    not on the pitch and not in any total below. This is a data gap, not a lineup you have made.</p>` : ''}

                <div class="lw-kpis">
                    ${lwKpiBox('green', 'target', 'Projected points', total.toFixed(1),
                        escHTML(lineupState.formation), 'Your eleven’s projected points this gameweek, with the captain doubled.')}
                    ${lwKpiBox(gain != null && gain > 0.05 ? 'green' : 'blue', 'swap', 'vs your live team', gainStr,
                        moves ? `${moves} change${moves === 1 ? '' : 's'}` : 'same eleven',
                        'How this eleven compares with the one currently saved on the FPL site, scored the same way.')}
                    ${lwKpiBox(risks.length ? 'amber' : 'blue', 'warn', 'Flagged', String(risks.length),
                        risks.length ? escHTML(risks.slice(0, 2).map(r => r.p.web_name).join(', ')) : 'nobody to check',
                        risks.length ? risks.map(r => `${r.p.web_name} — ${r.why}`).join('\n') : 'No injuries, suspensions or rotation risks in the squad.')}
                    ${call
                        ? lwKpiBox('blue', 'scales', 'Closest call', Math.abs(call.margin) < 0.05 ? 'level' : Math.abs(call.margin).toFixed(1),
                            `${escHTML(call.starter.web_name)} / ${escHTML(call.sub.web_name)}`,
                            `The narrowest gap in the eleven: ${call.starter.web_name} starts, ${call.sub.web_name} does not.`)
                        : lwKpiBox('blue', 'scales', 'Closest call', '—', 'no bench call')}
                </div>

                <!-- How dependable the eleven is, in the three numbers that say
                     so. Smaller than the headline tiles because they qualify
                     them rather than compete with them. -->
                <div class="lw-ov-strip">
                    <span class="lw-ov-s" data-tooltip="Starters at least 80% likely to start, from minutes per appearance and fitness."><em>Nailed on</em><b>${nailed}<i>/11</i></b></span>
                    <span class="lw-ov-s" data-tooltip="Expected number of your eleven who do not start. This is what the bench order insures against."><em>Expected absent</em><b>${expectedAbsent.toFixed(1)}</b></span>
                    <span class="lw-ov-s" data-tooltip="Average fixture difficulty faced by the starting eleven this gameweek."><em>Avg FDR</em><b>${avgFdr.toFixed(1)}</b></span>
                    <span class="lw-ov-s" data-tooltip="Sum of projected points across the eleven starters, before the captain's double."><em>XI xP</em><b>${xi.reduce((s, p) => s + p.gwScore, 0).toFixed(1)}</b></span>
                </div>

                <div class="lw-ov-blocks">
                    ${sources.length ? `<div class="lw-sum-block">
                        <div class="lw-sum-h">${v2Icon('chart')} Where the points come from</div>
                        ${lwSourcesBar(sources)}
                        <div class="lw-sum-note">${escHTML(sources[0].key)} is the largest single source at <strong>${sources[0].v.toFixed(1)}</strong> projected points across the eleven.</div>
                    </div>` : ''}

                    <div class="lw-sum-block">
                        <div class="lw-sum-h">${v2Icon('calendar')} What the eleven face</div>
                        <div class="lw-sum-note">${easyCount} of the eleven face a difficulty-2-or-easier fixture and ${hardCount} face a 4 or harder.
                            ${stacked.length
                                ? `You are stacked on <strong>${escHTML(stacked.join(', '))}</strong> — a strong week for them lifts the whole team, a poor one sinks it.`
                                : 'No club supplies three or more of your starters, so the week is spread across teams.'}</div>
                    </div>

                    ${weakest ? `<div class="lw-sum-block">
                        <div class="lw-sum-h">${v2Icon('scales')} Key player decisions</div>
                        <div class="lw-sum-duo">
                            <div class="lw-sum-duo-i">
                                <div class="lw-sum-duo-l">${v2Icon('down')} Weakest in the XI</div>
                                <div class="lw-sum-name">${lwFace(weakest)}<span class="lw-sum-name-t">${escHTML(weakest.web_name)}</span></div>
                                <div class="lw-sum-xp">${weakest.lwScore.toFixed(1)}</div>
                            </div>
                            <div class="lw-sum-duo-i">
                                <div class="lw-sum-duo-l">${v2Icon('bench')} Strongest on the bench</div>
                                ${strongestBench
                                    ? `<div class="lw-sum-name">${lwFace(strongestBench)}<span class="lw-sum-name-t">${escHTML(strongestBench.web_name)}</span></div>
                                <div class="lw-sum-xp">${strongestBench.lwScore.toFixed(1)}</div>`
                                    : `<div class="lw-sum-name lw-sum-duo-none">None</div>
                                <div class="lw-sum-xp lw-sum-duo-none">—</div>`}
                            </div>
                        </div>
                        <div class="lw-sum-duo-u">${escHTML(runUnit)}</div>
                        <div class="lw-sum-note">${upgrade
                            ? `${escHTML(upgrade.in.web_name)} projects <strong>+${upgrade.gain.toFixed(1)}</strong> more than ${escHTML(upgrade.out.web_name)}, and the shape still works. <button class="lw-sum-apply" onclick="lwApplySwap(${upgrade.out.id}, ${upgrade.in.id})">Make the swap</button>`
                            : !strongestBench
                                ? 'No outfield players on the bench, so there is no swap to make.'
                                : strongestBench.lwScore > weakest.lwScore
                                    ? `${escHTML(strongestBench.web_name)} out-projects ${escHTML(weakest.web_name)}, but no legal formation lets them swap — the shape is what is keeping them out.`
                                    : 'Nothing on the bench beats a starter — this is as good as the eleven gets.'}</div>
                    </div>` : ''}

                    ${risks.length ? `<div class="lw-sum-block">
                        <div class="lw-sum-h">${v2Icon('warn')} Worth checking <span class="lw-sum-n">${risks.length}</span></div>
                        ${risks.map(r => `<div class="lw-sum-flag${r.inXI ? ' is-xi' : ''}">${lwFace(r.p)}<strong>${escHTML(r.p.web_name)}</strong>
                            <span class="lw-sum-flag-w">${escHTML(r.why)}</span>
                            <span class="lw-sum-flag-x">${r.inXI ? 'in your XI' : 'on your bench'}</span></div>`).join('')}
                    </div>` : ''}

                    ${lwRenderChanges()}
                </div>
            </section>`;
        }

/* ===== THE LINEUP PANEL =====

           Auto-optimise lives here rather than in the page header, because it
           changes this and nothing else — and because the result of pressing it
           is two feet away from the button instead of a screen above it. The
           strip underneath reports what it did: the total before, the total
           after, and the gain; the cards it moved are marked on the pitch. */
        function lwRenderOptimiseStrip() {
            const r = lineupState.optimizeReport;
            if (!r) return '';
            const inN = (r.promoted || []).length;
            const outN = (r.benchedOut || []).length;
            if (!inN && !outN && Math.abs(r.gain || 0) < 0.05) {
                return `<div class="lw-opt-strip is-quiet">${v2Icon('check')} Your eleven was already the best available.</div>`;
            }
            const names = list => list.map(q => escHTML(q.web_name)).join(', ');
            return `<div class="lw-opt-strip">
                <span class="lw-opt-xp">
                    <b class="lw-opt-before">${r.beforeXP.toFixed(1)}</b>
                    <i>${v2Icon('up')}</i>
                    <b class="lw-opt-after">${r.afterXP.toFixed(1)}</b>
                    <em class="lw-opt-gain${r.gain > 0 ? ' is-up' : ''}">${r.gain > 0 ? '+' : ''}${r.gain.toFixed(1)} xP</em>
                </span>
                ${inN ? `<span class="lw-opt-mv is-in"><i></i>In: ${names(r.promoted)}</span>` : ''}
                ${outN ? `<span class="lw-opt-mv is-out"><i></i>Out: ${names(r.benchedOut.map(e => e.player))}</span>` : ''}
                <button class="lw-opt-report" onclick="openLineupOptimizeReport()" data-tooltip="The full breakdown of what changed and why">Details</button>
            </div>`;
        }

        function lwRenderLineupPanel() {
            const lwRun = typeof xpPlanGWs === 'function' ? xpPlanGWs(XP_PLAN_HORIZON) : [];
            const optimiseTip = lwRun.length > 1
                ? `Rebuild the legal eleven that projects best across GW${lwRun[0]}–GW${lwRun[lwRun.length - 1]} combined, not just this single week.`
                : 'Rebuild the highest-projecting legal eleven from your available players.';
            return `<section class="v2-section lw-pane-lineup">
                <div class="section-header">
                    <h2>${v2Icon('shirt')} Lineup
                        <span class="lwm-gw" id="lwFormation"
                            data-tooltip="The shape the optimiser settled on for your available players.">${lineupState.formation}</span></h2>
                    <div class="lw-cc-actions">
                        <button class="rc-btn primary" onclick="resetLineupToOptimal()" data-tooltip="${optimiseTip}">${v2Icon('sparkle')} Auto-optimise</button>
                        ${lineupState.undo ? `<button class="rc-btn" onclick="lwUndoOptimise()"
                            data-tooltip="Put back the eleven, bench order and armband you had before Auto-optimise ran.">↩︎ Undo</button>` : ''}
                    </div>
                </div>
                ${lwRenderOptimiseStrip()}
                <div id="lwPitchField">${renderLWPitch()}</div>
            </section>`;
        }

        /* A and C from the layout sketches, as two sets of grid areas over one
           DOM. Nothing re-renders when it changes; only the placement does. */
        function lwLayout() {
            try { return localStorage.getItem('lw_layout') === 'c' ? 'c' : 'a'; } catch (e) { return 'a'; }
        }

        function lwSetLayout(which) {
            try { localStorage.setItem('lw_layout', which); } catch (e) { /* private mode */ }
            const main = document.getElementById('lwMain');
            if (main) main.className = 'lw-main is-' + which;
            document.querySelectorAll('.lw-lay-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.lay === which);
            });
        }

        function lwRenderLayoutSwitch() {
            const cur = lwLayout();
            return `<div class="lw-lay" role="group" aria-label="Layout">
                <span class="lw-lay-l">Layout</span>
                <button class="lw-lay-btn${cur === 'a' ? ' active' : ''}" data-lay="a" onclick="lwSetLayout('a')"
                    data-tooltip="Lineup and Matchday side by side, captaincy as a strip under the lineup">A</button>
                <button class="lw-lay-btn${cur === 'c' ? ' active' : ''}" data-lay="c" onclick="lwSetLayout('c')"
                    data-tooltip="Matchday wide on the left, lineup and captaincy in a sticky right rail">C</button>
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
            lwBindPitchDrag();
            html += `<div class="lw-pitch-hint">${lineupState.swapSource
                ? `Swapping <strong>${escHTML((lineupState.squad.find(p => p.id === lineupState.swapSource) || {}).web_name || '')}</strong> — click another player to complete it, or click them again to cancel.`
                : 'Drag a player onto another to swap them — on a touchscreen, hold a moment first — or click both. <b>C</b> or <b>V</b> on a card sets the armband; ℹ opens the detail, and a second ℹ compares two.'}</div>`;
            return html;
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


                function lwApplySwap(outId, inId) {
            handleLWSwapClick(outId);
            handleLWSwapClick(inId);
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

        /* The swap itself, reached by a click or by a drag.

           It returns what it did rather than silently doing nothing, so the
           two callers can say so: 'swapped', 'same' (you picked the same
           player twice), 'illegal' (the formation would not survive it), or
           'missing'.

           The invariant at the end is deliberate and is not defensive
           decoration. Every arrangement of fifteen players is eleven plus
           four; if a swap ever produced anything else the player who went
           astray would simply stop being drawn, with no error and no way for a
           manager to get him back short of reloading. So the arrays are built
           first, checked, and only then committed. */
        function lwSwapPlayers(srcId, tgtId) {
            if (srcId === tgtId) return 'same';

            const xiIds = new Set(lineupState.xi.map(p => p.id));
            const srcInXI = xiIds.has(srcId);
            const tgtInXI = xiIds.has(tgtId);

            const allPool = [...lineupState.xi, ...lineupState.bench];
            const srcPlayer = allPool.find(p => p.id === srcId);
            const tgtPlayer = allPool.find(p => p.id === tgtId);
            if (!srcPlayer || !tgtPlayer) return 'missing';

            let newXI, newBench;
            if (srcInXI && tgtInXI) {
                /* Both starting. Nothing about the eleven changes, so this is
                   the one case with nothing to commit. */
                return 'same';
            } else if (!srcInXI && !tgtInXI) {
                // Both on the bench: this swaps the substitution order.
                newXI = lineupState.xi.slice();
                newBench = lineupState.bench.slice();
                const si = newBench.findIndex(p => p.id === srcId);
                const ti = newBench.findIndex(p => p.id === tgtId);
                if (si < 0 || ti < 0) return 'missing';
                [newBench[si], newBench[ti]] = [newBench[ti], newBench[si]];
            } else {
                // One starting, one not: the shape has to survive it.
                const xiPlayer = srcInXI ? srcPlayer : tgtPlayer;
                const benchPlayer = srcInXI ? tgtPlayer : srcPlayer;
                newXI = lineupState.xi.map(p => p.id === xiPlayer.id ? benchPlayer : p);
                newBench = lineupState.bench.map(p => p.id === benchPlayer.id ? xiPlayer : p);
                if (!isValidLWFormation(newXI)) return 'illegal';
            }

            const squadN = (lineupState.squad || []).length;
            const ids = new Set([...newXI, ...newBench].map(p => p && p.id));
            if (newXI.length !== 11 || ids.size !== squadN || ids.has(undefined)) {
                // Never commit an arrangement that has lost somebody.
                return 'illegal';
            }

            lineupState.xi = newXI;
            lineupState.bench = newBench;
            lineupState.formation = getFormationString(lineupState.xi);
            return 'swapped';
        }

        function handleLWSwapClick(playerId) {
            // A click that ends a drag is the drag's, not a selection.
            if (lineupState.dragJustEnded) { lineupState.dragJustEnded = false; return; }

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

            const srcId = lineupState.swapSource;
            lineupState.swapSource = null;
            lwSwapPlayers(srcId, playerId);
            refreshLWView();
        }

        /* ===== DRAGGING A PLAYER ONTO ANOTHER =====

           The same swap, reached the way a hand expects to reach it.

           Built on pointer events rather than HTML5 drag-and-drop. That API
           looks like the obvious choice and is the wrong one here: it never
           fires from a touchscreen, so half the people using this page would
           have had a feature they could not reach. Pointer events are one code
           path for a mouse and a finger.

           A mouse starts dragging as soon as it moves a few pixels with the
           button down. A finger has to hold still for a moment first,
           because on a phone a finger that moves is usually scrolling the
           page, and stealing that would be worse than having no drag at all.
           Until a drag actually starts, the pitch scrolls exactly as it did. */
        const LW_DRAG_SLOP = 6;       // px of movement before a mouse drag begins
        const LW_DRAG_HOLD = 180;     // ms a finger must rest before it can drag
        let lwDragBound = false;
        let lwDrag = null;

        function lwBindPitchDrag() {
            if (lwDragBound || typeof document === 'undefined' || !document.addEventListener) return;
            lwDragBound = true;
            document.addEventListener('pointerdown', lwPointerDown, true);
            /* A drag that ends over another card also produces a click. The
               click handler would read it as "select this player for a swap"
               on top of the swap just made, so it is swallowed here. */
            document.addEventListener('click', function (e) {
                if (!lineupState || !lineupState.dragJustEnded) return;
                lineupState.dragJustEnded = false;
                if (e.target.closest && e.target.closest('#lwPitchField .dp-card')) {
                    e.stopPropagation(); e.preventDefault();
                }
            }, true);
        }

        function lwCardAt(x, y) {
            const el = document.elementFromPoint(x, y);
            const card = el && el.closest ? el.closest('#lwPitchField .dp-card[data-lw-id]') : null;
            return card;
        }

        function lwPointerDown(e) {
            if (e.button != null && e.button !== 0) return;
            const t = e.target;
            if (!t || !t.closest) return;
            // The armband and the ℹ are their own controls; a press on them is
            // not the start of a drag.
            if (t.closest('button, .dp-arm-set')) return;
            const card = t.closest('#lwPitchField .dp-card[data-lw-id]');
            if (!card) return;

            lwDrag = {
                id: Number(card.dataset.lwId), card,
                x0: e.clientX, y0: e.clientY, active: false, ready: e.pointerType === 'mouse',
                ghost: null, over: null, pointerId: e.pointerId,
                hold: null
            };
            if (!lwDrag.ready) {
                lwDrag.hold = setTimeout(() => { if (lwDrag) lwDrag.ready = true; }, LW_DRAG_HOLD);
            }
            document.addEventListener('pointermove', lwPointerMove, { passive: false });
            document.addEventListener('pointerup', lwPointerUp, true);
            document.addEventListener('pointercancel', lwPointerCancel, true);
        }

        function lwDragStart() {
            const d = lwDrag;
            d.active = true;
            lineupState.swapSource = null;
            d.card.classList.add('is-dragging');
            const field = document.getElementById('lwPitchField');
            if (field) field.classList.add('is-lw-dragging');
            // Say which drops the formation would survive, before the hand
            // commits — that is the whole advantage of dragging over clicking.
            document.querySelectorAll('#lwPitchField .dp-card[data-lw-id]').forEach(el => {
                const id = Number(el.dataset.lwId);
                if (id === d.id) return;
                el.classList.add(lwSwapWouldWork(d.id, id) ? 'is-drop-ok' : 'is-drop-no');
            });
            // A copy of the card follows the pointer, so what is being moved
            // is visible rather than implied.
            const r = d.card.getBoundingClientRect();
            const ghost = d.card.cloneNode(true);
            ghost.className = d.card.className.replace('is-dragging', '') + ' lw-drag-ghost';
            ghost.style.width = r.width + 'px';
            ghost.style.height = r.height + 'px';
            d.gx = d.x0 - r.left; d.gy = d.y0 - r.top;
            document.body.appendChild(ghost);
            d.ghost = ghost;
            lwGhostTo(d.x0, d.y0);
        }

        function lwGhostTo(x, y) {
            if (!lwDrag || !lwDrag.ghost) return;
            lwDrag.ghost.style.left = (x - lwDrag.gx) + 'px';
            lwDrag.ghost.style.top = (y - lwDrag.gy) + 'px';
        }

        function lwPointerMove(e) {
            const d = lwDrag;
            if (!d) return;
            const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
            if (!d.active) {
                if (!d.ready) {
                    // Still waiting out the hold: a finger that travels is
                    // scrolling, so let it, and give up on the drag.
                    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) lwPointerCancel();
                    return;
                }
                if (Math.abs(dx) < LW_DRAG_SLOP && Math.abs(dy) < LW_DRAG_SLOP) return;
                lwDragStart();
            }
            // Once dragging, the gesture is ours and the page must not scroll.
            if (e.cancelable) e.preventDefault();
            lwGhostTo(e.clientX, e.clientY);
            if (d.ghost) d.ghost.style.visibility = 'hidden';
            const over = lwCardAt(e.clientX, e.clientY);
            if (d.ghost) d.ghost.style.visibility = '';
            if (over === d.over) return;
            if (d.over) d.over.classList.remove('is-drop-over');
            d.over = (over && over !== d.card && lwSwapWouldWork(d.id, Number(over.dataset.lwId))) ? over : null;
            if (d.over) d.over.classList.add('is-drop-over');
        }

        function lwPointerUp(e) {
            const d = lwDrag;
            if (!d) return;
            const wasActive = d.active;
            const target = wasActive ? lwCardAt(e.clientX, e.clientY) : null;
            lwDragTeardown();
            if (!wasActive) return;
            lineupState.dragJustEnded = true;
            if (target && Number(target.dataset.lwId) !== d.id) {
                lwSwapPlayers(d.id, Number(target.dataset.lwId));
            }
            refreshLWView();
        }

        function lwPointerCancel() {
            if (!lwDrag) return;
            const wasActive = lwDrag.active;
            lwDragTeardown();
            if (wasActive) refreshLWView();
        }

        function lwDragTeardown() {
            if (lwDrag && lwDrag.hold) clearTimeout(lwDrag.hold);
            if (lwDrag && lwDrag.ghost && lwDrag.ghost.parentNode) lwDrag.ghost.parentNode.removeChild(lwDrag.ghost);
            lwDrag = null;
            document.removeEventListener('pointermove', lwPointerMove, { passive: false });
            document.removeEventListener('pointerup', lwPointerUp, true);
            document.removeEventListener('pointercancel', lwPointerCancel, true);
            const field = document.getElementById('lwPitchField');
            if (field) field.classList.remove('is-lw-dragging');
            lwClearDragMarks();
        }

        // Whether a swap is legal, without performing it.
        function lwSwapWouldWork(srcId, tgtId) {
            if (srcId === tgtId) return false;
            const xiIds = new Set(lineupState.xi.map(p => p.id));
            const srcInXI = xiIds.has(srcId), tgtInXI = xiIds.has(tgtId);
            if (srcInXI === tgtInXI) return !srcInXI; // two substitutes reorder the bench
            const pool = [...lineupState.xi, ...lineupState.bench];
            const src = pool.find(p => p.id === srcId), tgt = pool.find(p => p.id === tgtId);
            if (!src || !tgt) return false;
            const xiPlayer = srcInXI ? src : tgt, benchPlayer = srcInXI ? tgt : src;
            return isValidLWFormation(lineupState.xi.map(p => p.id === xiPlayer.id ? benchPlayer : p));
        }

        function lwClearDragMarks() {
            document.querySelectorAll('#lwPitchField .dp-card').forEach(el => {
                el.classList.remove('is-dragging', 'is-drop-ok', 'is-drop-no', 'is-drop-over');
            });
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
            /* Each panel repaints whole: the lineup panel carries the pitch
               and the Auto-optimise strip, so it is addressed rather than the
               pitch inside it. */
            const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
            set('lwLineupPane', lwRenderLineupPanel());
            set('lwMatchdayPane', lwRenderMatchday());
            set('lwCaptaincyPane', lwRenderCaptaincy());
            const kpis = document.getElementById('lwKpis');
            if (kpis) kpis.outerHTML = lwRenderOverviewRow();
            // The comparison section reads the same lineup, so it follows every
            // change made in either version. Guarded: it is meant to be removable.
            if (window.lwLegacy) window.lwLegacy.render();
            const f = document.getElementById('lwFormation');
            if (f) f.textContent = lineupState.formation;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        /* Kept because scripts/odds-panel.js calls it when the feed lands, and
           because the compare panel still routes through it. Both main columns
           read the squad, so both are repainted. */
        function updateLWContextPanel() {
            refreshLWView();
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
