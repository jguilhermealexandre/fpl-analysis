/* ============================================
   EasyFPL — My Team Analysis
   The position-grouped squad table, its stat columns and tooltips, the
   shared filter state, and the Visual Analysis scatter widget.

   Extracted from the inline <script> in fpl-my-team-analysis.html.
   These files are plain classic scripts loaded in order, not ES modules:
   every function stays a global, which the inline onclick= handlers
   throughout the markup depend on. Load order is preserved from the
   original file — team-analysis-core.js must come first, since the
   settings IIFE in lineup-wizard.js reads DEFAULT_SETTINGS from it.
   ============================================ */

        // ===== SQUAD TABLE (position-grouped, replaces the old Transfer Analysis /
        // Needs Attention feed / Squad Overview strip sections) =====

        function computePlayerGamesPlayed(player) {
            return isPreseason ? Math.max(player.starts || Math.round(player.minutes / 90), 1) : Math.max(currentGW - 1, 1);
        }

        // Replacement/transfer-candidate lists filter out players who barely play — a
        // fixed 100-minute bar (previously hardcoded at every call site below) is fine
        // once several gameweeks have been played, but during/just after GW1 it's more
        // than a single full match, so it silently filtered out EVERY player and left
        // every candidate list empty. Scale it down early in the season instead: ~45
        // minutes (half a match) per gameweek played so far, capped at the original 100.
        function minMinutesForCandidate() {
            return Math.min(100, Math.max(currentGW - 1, 1) * 45);
        }

        // Position-specific 5-stat set. Columns 1-2 (Form, Next-5 FDR) are shared
        // across all positions; columns 3-5 vary per the spec's table.
        // A raw rate tells a manager nothing on its own — "0.65" only means
        // something next to the knowledge that anything above 0.50 is elite. These
        // turn a number into the judgement, and are the source of the "(Excellent)"
        // qualifiers in the stat tooltips.
        const bandHigh = (v, pairs) => (pairs.find(([t]) => v >= t) || pairs[pairs.length - 1])[1];
        const bandLow  = (v, pairs) => (pairs.find(([t]) => v <= t) || pairs[pairs.length - 1])[1];

        const XGI_BANDS = [[0.50, 'Excellent'], [0.35, 'Strong'], [0.20, 'Decent'], [0, 'Low']];
        const XG_BANDS  = [[0.45, 'Excellent'], [0.30, 'Strong'], [0.15, 'Decent'], [0, 'Low']];
        const XA_BANDS  = [[0.30, 'Excellent'], [0.20, 'Strong'], [0.10, 'Decent'], [0, 'Low']];
        const XGC_BANDS = [[0.90, 'Excellent'], [1.20, 'Solid'], [1.50, 'Average'], [99, 'Leaky']];
        const CS_BANDS  = [[40, 'Excellent'], [25, 'Good'], [15, 'Fair'], [0, 'Poor']];
        const MINS_BANDS = [[80, 'Nailed on'], [60, 'Regular'], [30, 'Rotation risk'], [0, 'Fringe']];
        const FORM_BANDS = [[6, 'Excellent'], [4.5, 'Good'], [3, 'Steady'], [0, 'Poor']];
        const FDR_BANDS = [[2.2, 'Very kind'], [2.8, 'Favourable'], [3.4, 'Average'], [9, 'Tough']];

        function computePlayerStatColumns(player) {
            const gamesPlayed = computePlayerGamesPlayed(player);
            const mins = player.minutes || 0;
            const per90 = val => mins > 0 ? ((val || 0) / mins) * 90 : 0;
            const csPercent = gamesPlayed > 0 ? Math.round(((player.cleanSheets || 0) / gamesPlayed) * 100) : 0;
            const teamName = (teams[player.teamId] && teams[player.teamId].name) || player.team;

            const formValue = isPreseason ? player.ppg : player.form;
            const fdrValue = player.avgFDR || 3;

            const cols = {
                xp: {
                    label: 'xP', value: (typeof predictedGWPoints === 'function' ? predictedGWPoints(player) : 0).toFixed(1),
                    tip: `Projected points for ${teamName}'s next match — the same figure the pitch and the optimiser use. Built from expected minutes, attacking returns, clean-sheet odds, saves, bonus and defensive contribution.`
                },
                form: {
                    label: 'Form', value: (formValue).toFixed(1),
                    tip: isPreseason
                        ? `Points per game last season (${bandHigh(formValue, FORM_BANDS)}). FPL resets form to zero before the season starts, so last year's rate stands in.`
                        : `Average points over the last 30 days (${bandHigh(formValue, FORM_BANDS)}). Above 4.5 is a player in good touch.`
                },
                fdr: {
                    label: 'Nxt5 FDR', value: fdrValue.toFixed(1),
                    tip: `Average Fixture Difficulty over ${teamName}'s next 5 matches: ${fdrValue.toFixed(1)} (${bandLow(fdrValue, FDR_BANDS)}). 1 is the easiest fixture, 5 the hardest.`
                }
            };

            // stat6 is the same for every position — minutes per game is the single
            // biggest availability/rotation signal regardless of role, and nothing else
            // in these columns captures it (they're all rate or underlying stats).
            // stat7 is the position's headline *output* metric, complementing the
            // underlying/expected numbers above it with what actually got returned.
            const minsPerGame = gamesPlayed > 0 ? Math.round(mins / gamesPlayed) : 0;
            cols.stat6 = {
                label: 'Mins/Gm', value: String(minsPerGame),
                tip: `${minsPerGame} minutes per appearance across ${gamesPlayed} ${gamesPlayed === 1 ? 'match' : 'matches'} (${bandHigh(minsPerGame, MINS_BANDS)}). Above 80 is a guaranteed starter; below 60 means real rotation risk.`
            };

            const csTip = `${player.cleanSheets || 0} clean ${(player.cleanSheets || 0) === 1 ? 'sheet' : 'sheets'} in ${gamesPlayed} ${gamesPlayed === 1 ? 'match' : 'matches'} — ${csPercent}% (${bandHigh(csPercent, CS_BANDS)}).`;
            const xgcTip = v => `Expected goals conceded per 90 minutes: ${v.toFixed(2)} (${bandLow(v, XGC_BANDS)}). Lower is better — under 1.00 points to a defence worth owning.`;
            const xgiTip = v => `Expected goals + expected assists per 90 minutes: ${v.toFixed(2)} (${bandHigh(v, XGI_BANDS)}). Above 0.50 is excellent.`;
            const xgTip  = v => `Expected goals per 90 minutes: ${v.toFixed(2)} (${bandHigh(v, XG_BANDS)}). Measures chance quality, not finishing luck.`;
            const xaTip  = v => `Expected assists per 90 minutes: ${v.toFixed(2)} (${bandHigh(v, XA_BANDS)}). Credits the pass regardless of whether it was finished.`;

            if (player.position === 1) { // GK
                const sv = per90(player.saves);
                cols.stat3 = { label: 'CS%', value: `${csPercent}%`, tip: csTip };
                cols.stat4 = { label: 'xGC/90', value: per90(player.xGC).toFixed(2), tip: xgcTip(per90(player.xGC)) };
                cols.stat5 = { label: 'Sv/90', value: sv.toFixed(2), tip: `Saves per 90 minutes: ${sv.toFixed(2)}. Save points are worth having, but a high rate often means a busy defence rather than a good one.` };
                cols.stat7 = { label: 'Saves', value: String(player.saves || 0), tip: `${player.saves || 0} ${(player.saves || 0) === 1 ? 'save' : 'saves'} this season. Every 3 saves is worth 1 point.` };
            } else if (player.position === 2) { // DEF
                cols.stat3 = { label: 'CS%', value: `${csPercent}%`, tip: csTip };
                cols.stat4 = { label: 'xGC/90', value: per90(player.xGC).toFixed(2), tip: xgcTip(per90(player.xGC)) };
                cols.stat5 = { label: 'xGI/90', value: per90(player.xGI).toFixed(2), tip: xgiTip(per90(player.xGI)) };
                // Attacking returns are what separate otherwise-similar defenders.
                cols.stat7 = { label: 'G+A', value: String((player.goals || 0) + (player.assists || 0)), tip: `${player.goals || 0} ${(player.goals || 0) === 1 ? 'goal' : 'goals'} and ${player.assists || 0} ${(player.assists || 0) === 1 ? 'assist' : 'assists'} this season. A defender's goals are worth 6 points each.` };
            } else if (player.position === 3) { // MID
                cols.stat3 = { label: 'xGI/90', value: per90(player.xGI).toFixed(2), tip: xgiTip(per90(player.xGI)) };
                cols.stat4 = { label: 'xG/90', value: per90(player.xG).toFixed(2), tip: xgTip(per90(player.xG)) };
                cols.stat5 = { label: 'xA/90', value: per90(player.xA).toFixed(2), tip: xaTip(per90(player.xA)) };
                cols.stat7 = { label: 'Bonus', value: String(player.bonus || 0), tip: `${player.bonus || 0} bonus points this season, awarded to the top 3 performers in each match.` };
            } else { // FWD
                cols.stat3 = { label: 'Goals', value: String(player.goals || 0), tip: `${player.goals || 0} ${(player.goals || 0) === 1 ? 'goal' : 'goals'} this season, worth 4 points each for a forward.` };
                cols.stat4 = { label: 'xG/90', value: per90(player.xG).toFixed(2), tip: xgTip(per90(player.xG)) };
                cols.stat5 = { label: 'xGI/90', value: per90(player.xGI).toFixed(2), tip: xgiTip(per90(player.xGI)) };
                // Goals already shown above, so assists completes the return picture.
                cols.stat7 = { label: 'Assists', value: String(player.assists || 0), tip: `${player.assists || 0} ${(player.assists || 0) === 1 ? 'assist' : 'assists'} this season, worth 3 points each.` };
            }
            return cols;
        }

        // ===== TOOLTIPS =====
        // Authored as data-tooltip="..." anywhere on the page. A pure-CSS bubble
        // would have been simpler, but the elements that most need explaining sit
        // inside .sq-row-main / .sq-row-team, which are overflow:hidden to truncate
        // long player names — a bubble anchored in there gets clipped. One shared
        // node positioned in viewport coordinates escapes that, and appears
        // instantly rather than after the browser's ~1s title= delay.
        let tooltipNode = null;

        function positionTooltip(target) {
            const r = target.getBoundingClientRect();
            // Measure unconstrained before deciding which side it fits on.
            tooltipNode.style.left = '0px';
            tooltipNode.style.top = '0px';
            const t = tooltipNode.getBoundingClientRect();

            let left = r.left + (r.width / 2) - (t.width / 2);
            left = Math.max(8, Math.min(left, window.innerWidth - t.width - 8));

            let top = r.top - t.height - 8;
            const below = top < 8;                    // no room above — flip under
            if (below) top = r.bottom + 8;

            tooltipNode.classList.toggle('below', below);
            tooltipNode.style.left = `${Math.round(left)}px`;
            tooltipNode.style.top = `${Math.round(top)}px`;
        }

        function hideTooltip() {
            if (tooltipNode) tooltipNode.classList.remove('visible');
        }

        function initTooltips() {
            if (tooltipNode) return;
            tooltipNode = document.createElement('div');
            tooltipNode.className = 'ui-tooltip';
            tooltipNode.setAttribute('role', 'tooltip');
            document.body.appendChild(tooltipNode);

            const show = event => {
                const target = event.target.closest && event.target.closest('[data-tooltip]');
                if (!target) return;
                const text = target.getAttribute('data-tooltip');
                if (!text) return;
                tooltipNode.textContent = text;
                tooltipNode.classList.add('visible');
                positionTooltip(target);
            };
            const maybeHide = event => {
                if (event.target.closest && event.target.closest('[data-tooltip]')) hideTooltip();
            };

            // Delegated, so anything re-rendered later is covered without rebinding.
            document.addEventListener('mouseover', show);
            document.addEventListener('mouseout', maybeHide);
            document.addEventListener('focusin', show);
            document.addEventListener('focusout', maybeHide);
            // Capture phase: the panels and the table scroll in their own containers,
            // and a tooltip left behind would float detached from its element.
            document.addEventListener('scroll', hideTooltip, true);
            window.addEventListener('resize', hideTooltip);
            document.addEventListener('keydown', e => { if (e.key === 'Escape') hideTooltip(); });
        }

        /* Team context, as compact pills.

           These describe the CLUB, not the player, which is why they sit in their
           own bordered group immediately after the club name — reading left to
           right gives "BHA · £4.5m │ In form · Harder GW5+", which parses as
           attributes of Brighton. An earlier version repeated the team code inside
           each pill to make that explicit; three "BHA"s in one square inch cost
           more than the ambiguity did, so the grouping and the tooltips carry it
           instead. Every tooltip names the club in its first three words. */
        function renderTeamBadges(player) {
            const ta = teamAnalysis[player.teamId];
            const teamName = (teams[player.teamId] && teams[player.teamId].name) || player.team;
            const pills = [];

            // ---- form ----
            // Only badge a team once it has actually played; with no completed
            // matches there is no form, and defaulting to a verdict made every
            // yet-to-play side look like it was struggling.
            if (ta && ta.matchesPlayed > 0) {
                const n = ta.matchesPlayed;
                const span = n === 1 ? 'their opening match' : `their last ${Math.min(n, 5)}`;
                const plural = (v, one, many) => `${v} ${v === 1 ? one : (many || one + 's')}`;
                const record = `${plural(ta.wins, 'win')}, ${plural(ta.draws, 'draw')} and ${plural(ta.losses, 'loss', 'losses')}`;
                const scoring = `Scoring ${(ta.avgGoals || 0).toFixed(1)} and conceding ${(ta.avgConceded || 0).toFixed(1)} a game.`;
                // xgTrendDelta is recent expected goals per game minus the season
                // rate, so it says which way the underlying numbers are moving —
                // but it needs a few matches behind it to mean anything.
                const d = ta.xgTrendDelta || 0;
                const trend = n >= 4 && Math.abs(d) >= 0.15
                    ? ` Expected goals are trending ${d > 0 ? 'up' : 'down'} (${d > 0 ? '+' : ''}${d.toFixed(2)} a game on their season rate).`
                    : '';

                let cls, icon, label;
                if (ta.formRating >= 55) { cls = 'good'; icon = '🔥'; label = 'In form'; }
                else if (ta.formRating < 40) { cls = 'bad'; icon = '❄️'; label = 'Cold'; }
                else { cls = 'warning'; icon = '⚖️'; label = 'Average'; }

                pills.push(`<span class="team-form-badge ${cls}" data-tooltip="${escHTML(teamName)} — ${record} in ${span}. ${scoring}${trend}">${icon} ${label}</span>`);
            }

            // ---- fixture swing ----
            const swing = fixtureSwingData[player.teamId];
            if (swing) {
                // swing.direction compares the next three fixtures against the
                // three after them, so it flags the turn before it arrives.
                const easier = swing.direction === 'improving';
                const size = Math.abs(parseFloat(swing.futureFdr) - parseFloat(swing.currentFdr));
                const scale = size >= 1.2 ? 'a big shift' : size >= 0.7 ? 'a clear shift' : 'a slight shift';
                pills.push(`<span class="swing-badge ${swing.direction}" data-tooltip="${escHTML(teamName)}'s fixtures ${easier ? 'ease off' : 'get harder'} from GW${swing.swingGW}: average difficulty ${easier ? 'falls' : 'rises'} from ${swing.currentFdr} across the next three to ${swing.futureFdr} in the three after — ${scale}.${easier ? ' Worth buying into before it turns.' : ' Worth planning an exit.'}">${easier ? '📈' : '📉'} ${easier ? 'Easier' : 'Harder'} GW${swing.swingGW}+</span>`);
            }

            if (!pills.length) return '';
            return `<span class="team-context" data-tooltip="How ${escHTML(teamName)} are doing — club context, not this player's own form">${pills.join('')}</span>`;
        }

        function renderSquadRow(analysis) {
            const { player, verdict, fixtures } = analysis;
            const cols = computePlayerStatColumns(player);
            const FDR_WORDS = { 1: 'Very easy', 2: 'Easy', 3: 'Average', 4: 'Hard', 5: 'Very hard' };
            const fixtureChips = fixtures.slice(0, 5).map(f =>
                `<div class="fixture-chip fdr-${f.difficulty}" data-tooltip="GW${f.event}: ${f.isHome ? 'home to' : 'away at'} ${escHTML(f.opponent)} — FDR ${f.difficulty} (${FDR_WORDS[f.difficulty] || 'Average'})"><span class="fixture-team">${escHTML(f.opponent)}</span></div>`).join('');
            const rowFlagClass = verdict === 'sell' ? 'sq-row-sell' : verdict === 'monitor' ? 'sq-row-monitor' : '';
            // Always emit the slot, even when there's no hazard — a conditionally
            // present icon would shift the badge/name right on flagged rows only,
            // leaving player names unaligned down the column.
            const hazardIcon = `<span class="sq-hazard-slot">${verdict === 'sell'
                ? '<i data-lucide="alert-triangle" class="sq-hazard-icon" title="Flagged: high sell rating"></i>'
                : ''}</span>`;

            return `
            <div class="sq-row ${rowFlagClass} ${player.onBench ? 'sq-row-bench' : ''}" data-player-id="${player.id}" data-compare-row>
                <input type="checkbox" class="compare-checkbox sq-compare-checkbox" data-player-id="${player.id}" onclick="event.stopPropagation()" onchange="onCompareCheckboxChange(${player.id})">
                <div class="sq-row-clickable" onclick="openDetailPanel(${player.id})" title="View player profile">
                    <div class="sq-row-main">
                        ${hazardIcon}
                        <span class="position-badge ${POSITION_CONFIG[player.position].class}">${POSITION_CONFIG[player.position].short}</span>
                        <div class="sq-row-name-block">
                            <div class="sq-row-name">${player.isCaptain ? '👑 ' : ''}${player.isVice ? '🅥 ' : ''}${escHTML(player.name)}${player.onBench ? '<span class="bench-tag">BENCH</span>' : ''}</div>
                            <div class="sq-row-team"><span class="sq-row-club">${escHTML(player.team)} · £${player.price.toFixed(1)}m</span>${priceChangeBadge(player)} ${renderTeamBadges(player)}</div>
                        </div>
                    </div>
                    <div class="sq-row-stats">
                        ${[cols.xp, cols.form, cols.fdr, cols.stat3, cols.stat4, cols.stat5, cols.stat6, cols.stat7]
                            .map(s => `<div class="sq-stat" data-tooltip="${escHTML(s.tip)}"><span class="sq-stat-label">${escHTML(s.label)}</span><span class="sq-stat-value">${escHTML(String(s.value))}</span></div>`).join('')}
                    </div>
                    <div class="sq-row-fixtures" onclick="event.stopPropagation(); openFixturePanel(${player.id})" title="View ${escHTML(player.team)}'s fixture calendar">${fixtureChips}</div>
                </div>
                <button class="sq-transfer-btn" onclick="event.stopPropagation(); openTransferPanel(${player.id})" title="Find replacements" aria-label="Find replacements for ${escHTML(player.name)}">
                    <i data-lucide="repeat" style="width:14px;height:14px;"></i>
                </button>
            </div>`;
        }

        function renderPositionGroup(pos, items) {
            if (!items.length) return '';
            return `
            <div class="sq-position-group">
                <div class="sq-position-header">${POSITION_CONFIG[pos].name}s <span class="sq-position-count">${items.length}</span></div>
                ${items.map(renderSquadRow).join('')}
            </div>`;
        }

        function renderSquadTable() {
            const filtered = getFilteredSquad();
            const groups = [1, 2, 3, 4].map(pos => ({
                pos,
                items: filtered.filter(a => a.player.position === pos)
                    .sort((a, b) => a.player.pickPosition - b.player.pickPosition),
            }));
            return `<div class="sq-table">${groups.map(g => renderPositionGroup(g.pos, g.items)).join('')}</div>`;
        }

        // ===== SHARED FILTER STATE + VISUAL ANALYSIS SCATTER WIDGET (Phase 4) =====
        // The filter bar drives both the table above and the chart below from one
        // shared state, per the spec's "filtering the table re-renders the chart" ask.
        let squadFilterPos = 'all'; // 'all' | 1 | 2 | 3 | 4
        let squadFilterMaxPrice = null;
        // Expanded by default (first visit has no saved preference yet — only an
        // explicit '0' from the user collapsing it before should keep it closed).
        let sqChartExpanded = localStorage.getItem('fpl_charts_expanded') !== '0';
        let sqChartInstance = null;
        let sqChartXMetric = 'xgi90';
        let sqChartYMetric = 'points';
        let sqChartScope = 'squad'; // 'squad' (default) | 'all'
        let sqChartCompareIds = []; // player ids picked by clicking chart points

        // Ready-made axis pairings, surfaced as the "Template" dropdown.
        const SQ_CHART_PRESETS = [
            { label: 'xGI/90 vs Points', x: 'xgi90', y: 'points' },
            { label: 'Value vs Ownership', x: 'value', y: 'ownership' },
            { label: 'Price vs Pts/Game', x: 'price', y: 'ppg' },
            { label: 'Form vs Season Avg', x: 'form', y: 'ppg' },
        ];

        const SQ_POSITION_COLORS = {
            1: { bg: 'rgba(251, 191, 36, 0.8)', border: '#fbbf24' },
            2: { bg: 'rgba(52, 211, 153, 0.8)', border: '#34d399' },
            3: { bg: 'rgba(96, 165, 250, 0.8)', border: '#60a5fa' },
            4: { bg: 'rgba(248, 113, 113, 0.8)', border: '#f87171' },
        };
        const SQ_POSITION_STYLES = { 1: 'circle', 2: 'rect', 3: 'triangle', 4: 'rectRot' };

        // Shared stat catalog for the X/Y metric pickers — any pair is "available for
        // free" since this only ever plots the ~15 squad players (cheap either way).
        // `format` renders a raw metric value for axis ticks/tooltips — keeps each
        // metric's own natural precision (whole counts for points/minutes, % for
        // ownership, currency for price, 2dp for the small per-90 rates) instead of
        // Chart.js's default tick formatting, which shows the same decimal places
        // for every metric regardless of scale (e.g. "0.10, 0.20" for xGI/90).
        const SQ_CHART_METRICS = {
            price: { label: 'Price (£m)', get: p => p.price, format: v => `£${Number(v.toFixed(1))}m` },
            ownership: { label: 'Ownership %', get: p => p.ownership, format: v => `${Number(v.toFixed(1))}%` },
            form: { label: 'Form', get: p => isPreseason ? p.ppg : p.form, format: v => Number(v.toFixed(1)) },
            ppg: { label: 'Pts/Game', get: p => p.ppg, format: v => Number(v.toFixed(1)) },
            points: { label: 'Total Points', get: p => p.points, format: v => Math.round(v) },
            minutes: { label: 'Minutes', get: p => p.minutes, format: v => Math.round(v) },
            xg: { label: 'xG', get: p => p.xG, format: v => Number(v.toFixed(2)) },
            xa: { label: 'xA', get: p => p.xA, format: v => Number(v.toFixed(2)) },
            xgi: { label: 'xGI', get: p => p.xGI, format: v => Number(v.toFixed(2)) },
            xgi90: { label: 'xGI/90', get: p => p.minutes > 0 ? (p.xGI / p.minutes) * 90 : 0, format: v => Number(v.toFixed(2)) },
            xgc: { label: 'xGC', get: p => p.xGC, format: v => Number(v.toFixed(2)) },
            ict: { label: 'ICT Index', get: p => p.ictIndex, format: v => Number(v.toFixed(1)) },
            bonus: { label: 'Bonus', get: p => p.bonus, format: v => Math.round(v) },
            bps: { label: 'BPS', get: p => p.bps, format: v => Math.round(v) },
            goals: { label: 'Goals', get: p => p.goals, format: v => Math.round(v) },
            assists: { label: 'Assists', get: p => p.assists, format: v => Math.round(v) },
            value: { label: 'Value (pts/£m)', get: p => p.price > 0 ? p.points / p.price : 0, format: v => Number(v.toFixed(1)) },
        };

        function getFilteredSquad() {
            return analysisResults.filter(a => {
                if (squadFilterPos !== 'all' && a.player.position !== squadFilterPos) return false;
                if (squadFilterMaxPrice != null && a.player.price > squadFilterMaxPrice) return false;
                return true;
            });
        }

        function renderSquadFilterBar() {
            const positions = [{ v: 'all', l: 'All' }, { v: 1, l: 'GK' }, { v: 2, l: 'DEF' }, { v: 3, l: 'MID' }, { v: 4, l: 'FWD' }];
            return `<div class="sq-filter-bar">
                <div class="sq-filter-pills">
                    ${positions.map(p => `<button class="sq-filter-pill ${squadFilterPos === p.v ? 'active' : ''}" onclick="setSquadFilterPos('${p.v}')">${p.l}</button>`).join('')}
                </div>
                <div class="sq-filter-price">
                    <label for="sq-filter-price-input">Max £</label>
                    <input type="number" id="sq-filter-price-input" step="0.5" min="4" max="15" placeholder="Any" value="${squadFilterMaxPrice ?? ''}" oninput="setSquadFilterMaxPrice(this.value)">
                </div>
            </div>`;
        }

        function rerenderSquadFilteredViews() {
            const tableWrap = document.getElementById('sq-table-wrap');
            if (tableWrap) tableWrap.innerHTML = renderSquadTable();
            if (typeof lucide !== 'undefined') lucide.createIcons();
            updateSquadChart();
        }

        function setSquadFilterPos(pos) {
            squadFilterPos = pos === 'all' ? 'all' : parseInt(pos, 10);
            document.querySelectorAll('.sq-filter-pill').forEach(btn => btn.classList.remove('active'));
            const activeBtn = [...document.querySelectorAll('.sq-filter-pill')].find(btn => btn.textContent === (squadFilterPos === 'all' ? 'All' : POSITION_CONFIG[squadFilterPos].short));
            if (activeBtn) activeBtn.classList.add('active');
            rerenderSquadFilteredViews();
        }

        function setSquadFilterMaxPrice(val) {
            squadFilterMaxPrice = val ? parseFloat(val) : null;
            rerenderSquadFilteredViews();
        }

        function renderSquadChartWidget() {
            // Mark the current metric `selected` directly in the markup so the
            // dropdowns show the right pair immediately on render — not only after
            // initSquadChart() runs and corrects .value in JS (e.g. before Chart.js
            // has finished loading, the <select>s would otherwise default to the
            // first metric in SQ_CHART_METRICS for both axes: "Price (£m)" vs "Price (£m)").
            const metricOptions = selected => Object.keys(SQ_CHART_METRICS)
                .map(k => `<option value="${k}" ${k === selected ? 'selected' : ''}>${SQ_CHART_METRICS[k].label}</option>`).join('');
            return `<div class="sq-chart-widget">
                <div class="sq-chart-header" onclick="toggleSquadChart()">
                    <i data-lucide="bar-chart-3" style="width:16px;height:16px;"></i>
                    <span class="sq-chart-header-title">Visual Analysis</span>
                    <span class="sq-chart-chevron ${sqChartExpanded ? 'open' : ''}" id="sq-chart-chevron"><i data-lucide="chevron-down" style="width:16px;height:16px;"></i></span>
                </div>
                <div class="sq-chart-body-outer ${sqChartExpanded ? 'open' : ''}" id="sq-chart-body">
                    <div class="sq-chart-body-inner">
                        <div class="sq-chart-controls">
                            <label class="sq-chart-field">
                                <span class="sq-chart-field-label">Players</span>
                                <select id="sq-chart-scope-select" onchange="setSquadChartScope(this.value)">
                                    <option value="squad" ${sqChartScope === 'squad' ? 'selected' : ''}>My Squad</option>
                                    <option value="all" ${sqChartScope === 'all' ? 'selected' : ''}>All Players</option>
                                </select>
                            </label>
                            <label class="sq-chart-field">
                                <span class="sq-chart-field-label">Template</span>
                                <select id="sq-chart-preset-select" onchange="applySquadChartPreset(this.value)">
                                    ${SQ_CHART_PRESETS.map((p, i) => `<option value="${i}" ${p.x === sqChartXMetric && p.y === sqChartYMetric ? 'selected' : ''}>${p.label}</option>`).join('')}
                                    <option value="custom" ${SQ_CHART_PRESETS.some(p => p.x === sqChartXMetric && p.y === sqChartYMetric) ? '' : 'selected'}>Custom…</option>
                                </select>
                            </label>
                            <span class="sq-chart-axis-picker">
                                <select id="sq-chart-x-select" onchange="onSquadChartMetricChange()">${metricOptions(sqChartXMetric)}</select>
                                <span>vs</span>
                                <select id="sq-chart-y-select" onchange="onSquadChartMetricChange()">${metricOptions(sqChartYMetric)}</select>
                            </span>
                        </div>
                        <div class="sq-chart-compare-hint" id="sq-chart-compare-hint">Click any two points to compare those players.</div>
                        <div class="sq-chart-canvas-wrap" id="sq-chart-canvas-wrap"><canvas id="sqChartCanvas"></canvas></div>
                    </div>
                </div>
            </div>`;
        }

        // The canvas sits inside a grid-collapse accordion (grid-template-rows 0fr -> 1fr),
        // so immediately after a toggle it still measures zero and Chart.js would lock in
        // that size. Waiting a fixed 320ms for the transition raced with fast toggles and
        // with anything that changed the layout mid-animation. Watching the wrapper starts
        // the chart on the first frame it genuinely has a box, and then keeps it sized.
        let sqChartResizeObserver = null;
        let sqChartLastWidth = 0;

        // Builds the chart if it isn't there, resizes it if it is, and replaces it if
        // the canvas underneath was swapped out by a re-render. Checking the element
        // rather than trusting the order the render and the observer ran in is what
        // makes this safe to call from either.
        function syncSquadChartToWrap() {
            const wrap = document.getElementById('sq-chart-canvas-wrap');
            const canvas = document.getElementById('sqChartCanvas');
            if (!wrap || !canvas) return;

            // Measured here, in one place, on purpose: taking the width as an argument
            // meant the direct call passed a border-box width while the observer passed
            // a content-box one, so the two disagreed by the padding and every first
            // observation looked like a width change.
            const width = Math.round(wrap.getBoundingClientRect().width);

            // A chart still bound to a detached canvas can never draw again.
            if (sqChartInstance && sqChartInstance.canvas !== canvas) {
                sqChartInstance.destroy();
                sqChartInstance = null;
            }
            if (!sqChartInstance) {
                sqChartLastWidth = width;
                initSquadChart();
                return;
            }
            if (width === sqChartLastWidth) return;
            sqChartLastWidth = width;
            sqChartInstance.resize();
        }

        function ensureSquadChart() {
            const wrap = document.getElementById('sq-chart-canvas-wrap');
            if (!wrap) return;

            if (typeof ResizeObserver === 'undefined') {
                if (!sqChartInstance) setTimeout(initSquadChart, 320);
                return;
            }

            // The wrapper's height is fixed in CSS, so it has a real box as soon as
            // it exists — even mid-accordion-transition, where it is only clipped.
            // Building here keeps chart construction out of the observer callback:
            // Chart.js runs its own ResizeObserver for responsive charts, and
            // constructing one from inside a callback is what produces "ResizeObserver
            // loop completed with undelivered notifications".
            const rect = wrap.getBoundingClientRect();
            if (rect.width >= 1 && rect.height >= 1) syncSquadChartToWrap();

            // One observer at a time: re-rendering the squad replaces this element,
            // so the previous observer would otherwise be left watching a detached node.
            if (sqChartResizeObserver) sqChartResizeObserver.disconnect();

            sqChartResizeObserver = new ResizeObserver(entries => {
                const box = entries[0] && entries[0].contentRect;
                if (!box || box.width < 1 || box.height < 1) return;
                // Width only. The wrapper's height is pinned, so reacting to height
                // just fed Chart.js's own canvas sizing back into this observer.
                syncSquadChartToWrap();
            });
            sqChartResizeObserver.observe(wrap);
        }

        function toggleSquadChart() {
            sqChartExpanded = !sqChartExpanded;
            localStorage.setItem('fpl_charts_expanded', sqChartExpanded ? '1' : '0');
            const body = document.getElementById('sq-chart-body');
            const chevron = document.getElementById('sq-chart-chevron');
            if (body) body.classList.toggle('open', sqChartExpanded);
            if (chevron) chevron.classList.toggle('open', sqChartExpanded);
            if (sqChartExpanded) ensureSquadChart();
        }

        function setSquadChartMetrics(xKey, yKey) {
            sqChartXMetric = xKey;
            sqChartYMetric = yKey;
            const xSel = document.getElementById('sq-chart-x-select');
            const ySel = document.getElementById('sq-chart-y-select');
            if (xSel) xSel.value = xKey;
            if (ySel) ySel.value = yKey;
            syncSquadChartPresetSelect();
            updateSquadChart();
        }

        function setSquadChartScope(scope) {
            sqChartScope = scope;
            // Scope change swaps the whole point set, so any half-finished
            // click-to-compare selection no longer refers to what's on screen.
            sqChartCompareIds = [];
            updateSquadChartCompareHint();
            updateSquadChart();
        }

        function applySquadChartPreset(value) {
            const preset = SQ_CHART_PRESETS[Number(value)];
            if (!preset) return; // "Custom…" — leave the axis pickers as-is
            setSquadChartMetrics(preset.x, preset.y);
        }

        // Keeps the preset dropdown honest when the axis pickers are changed
        // directly: if the pair no longer matches a template, show "Custom…".
        function syncSquadChartPresetSelect() {
            const sel = document.getElementById('sq-chart-preset-select');
            if (!sel) return;
            const idx = SQ_CHART_PRESETS.findIndex(p => p.x === sqChartXMetric && p.y === sqChartYMetric);
            sel.value = idx === -1 ? 'custom' : String(idx);
        }

        function updateSquadChartCompareHint() {
            const el = document.getElementById('sq-chart-compare-hint');
            if (!el) return;
            if (!sqChartCompareIds.length) {
                el.textContent = 'Click any two points to compare those players.';
                return;
            }
            const first = allPlayersById[sqChartCompareIds[0]];
            el.textContent = `Selected ${first ? first.name : 'player'} — click another point to compare.`;
        }

        // Chart.js onClick handler: collect two players, then hand off to the
        // page's existing compare modal (same one the table's checkboxes use).
        function onSquadChartPointClick(evt, elements) {
            if (!elements || !elements.length || !sqChartInstance) return;
            const { datasetIndex, index } = elements[0];
            const point = sqChartInstance.data.datasets[datasetIndex]?.data[index];
            if (!point || point.id == null) return;

            if (sqChartCompareIds[0] === point.id) {
                sqChartCompareIds = []; // clicking the same point again deselects
            } else {
                sqChartCompareIds.push(point.id);
            }

            if (sqChartCompareIds.length >= 2) {
                const [a, b] = sqChartCompareIds;
                sqChartCompareIds = [];
                updateSquadChartCompareHint();
                openPairCompare(a, b);
                return;
            }
            updateSquadChartCompareHint();
        }

        function onSquadChartMetricChange() {
            const xSel = document.getElementById('sq-chart-x-select');
            const ySel = document.getElementById('sq-chart-y-select');
            sqChartXMetric = xSel ? xSel.value : sqChartXMetric;
            sqChartYMetric = ySel ? ySel.value : sqChartYMetric;
            syncSquadChartPresetSelect();
            updateSquadChart();
        }

        function buildSquadChartDatasets() {
            const xDef = SQ_CHART_METRICS[sqChartXMetric];
            const yDef = SQ_CHART_METRICS[sqChartYMetric];
            // 'all' plots every FPL player (allPlayers, already loaded for the rest of
            // the page) instead of just the filtered squad — same per-player shape
            // either way (position/team/name plus whatever xDef/yDef.get(p) reads).
            const players = sqChartScope === 'all' ? allPlayers : getFilteredSquad().map(a => a.player);
            return [1, 2, 3, 4].map(pos => ({
                label: POSITION_CONFIG[pos].short,
                data: players.filter(p => p.position === pos).map(p => ({
                    x: xDef.get(p),
                    y: yDef.get(p),
                    id: p.id, // resolves a clicked point back to a player for compare
                    name: p.name,
                    team: p.team,
                })),
                backgroundColor: SQ_POSITION_COLORS[pos].bg,
                borderColor: SQ_POSITION_COLORS[pos].border,
                pointStyle: SQ_POSITION_STYLES[pos],
                pointRadius: 7,
                pointHoverRadius: 11,
            }));
        }

        function initSquadChart(attempt) {
            attempt = attempt || 0;
            const canvas = document.getElementById('sqChartCanvas');
            if (!canvas) return;
            if (typeof Chart === 'undefined') {
                // Chart.js loads via a <script> tag near the end of the document — on a
                // slow connection it can still be mid-download when squad data finishes
                // loading first. Retry briefly instead of silently leaving the widget
                // blank forever.
                if (attempt < 20) setTimeout(() => initSquadChart(attempt + 1), 150);
                return;
            }
            const xSel = document.getElementById('sq-chart-x-select');
            const ySel = document.getElementById('sq-chart-y-select');
            if (xSel) xSel.value = sqChartXMetric;
            if (ySel) ySel.value = sqChartYMetric;

            // applyChartDefaults()/scatterTooltipStyle() (scripts/common.js) are the same
            // theme-aware defaults and tooltip card used by every scatter chart on the
            // Players Analysis Charts tab — reused here rather than re-styled from scratch
            // so this widget renders at the same quality bar.
            if (typeof applyChartDefaults === 'function') applyChartDefaults();
            const tooltipStyle = typeof scatterTooltipStyle === 'function' ? scatterTooltipStyle() : {};

            sqChartInstance = new Chart(canvas.getContext('2d'), {
                type: 'scatter',
                data: { datasets: buildSquadChartDatasets() },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    onClick: onSquadChartPointClick,
                    plugins: {
                        legend: { position: 'top', labels: { color: 'var(--text-secondary)', usePointStyle: true } },
                        tooltip: {
                            ...tooltipStyle,
                            callbacks: {
                                title: ctx => ctx[0]?.raw ? `${ctx[0].raw.name} (${ctx[0].raw.team})` : '',
                                label: ctx => {
                                    const r = ctx.raw;
                                    if (!r) return '';
                                    return [
                                        `${SQ_CHART_METRICS[sqChartXMetric].label}: ${SQ_CHART_METRICS[sqChartXMetric].format(r.x)}`,
                                        `${SQ_CHART_METRICS[sqChartYMetric].label}: ${SQ_CHART_METRICS[sqChartYMetric].format(r.y)}`
                                    ];
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            title: { display: true, text: SQ_CHART_METRICS[sqChartXMetric].label },
                            ticks: { callback: v => SQ_CHART_METRICS[sqChartXMetric].format(v) }
                        },
                        y: {
                            title: { display: true, text: SQ_CHART_METRICS[sqChartYMetric].label },
                            ticks: { callback: v => SQ_CHART_METRICS[sqChartYMetric].format(v) }
                        }
                    }
                }
            });

            // Resizing is handled by the single observer in ensureSquadChart().
        }

        function updateSquadChart() {
            if (!sqChartInstance) return;
            sqChartInstance.data.datasets = buildSquadChartDatasets();
            sqChartInstance.options.scales.x.title.text = SQ_CHART_METRICS[sqChartXMetric].label;
            sqChartInstance.options.scales.y.title.text = SQ_CHART_METRICS[sqChartYMetric].label;
            sqChartInstance.update();
        }

