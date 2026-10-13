/* ============================================
   EasyFPL — Player Explorer: the charts and the player detail modal

   Extracted from the inline <script> in fpl-players-analysis.html, which was
   300 KB of file carrying 292 KB of JavaScript — 97% of it. Inline code is
   the one shape the build cannot help: `npm run build` only minifies
   scripts/, so none of this was minified; it re-downloaded with the markup on
   every visit instead of being cached on its own; check:min never compared it;
   and eslint saw it only through the shallower inline pass.

   It is also what keeps 'unsafe-inline' in the CSP. _headers says so in as many
   words, and this page was the largest single reason.

   Moved verbatim and left at the same position in the document, because the
   order is load-bearing: a classic <script src> blocks and executes exactly
   where it sits, so this file runs before the engine scripts below it, as the
   inline block did. Nothing was reformatted; the diff is a move.

   One global scope, like every other file here — the functions stay globals
   because the onclick= handlers throughout the markup depend on them.
   ============================================ */

        // buildStatWindows / recencyWeightedAvg / calculateExpectedPoints / generateComparisonReport /
        // generateSituationalPicks / generatePlayerNarrative / getRadarAxes / getBudgetContext /
        // showCompareModal / closeCompareModal / reportRadarChart / compareList / MAX_COMPARE /
        // toggleComparePlayer / removeFromCompare / clearCompare / updateCompareBar now live in
        // scripts/compare-report.js (shared with My Team's Squad Analysis).

        // ============================================
        // CHART EXPAND MODAL
        // ============================================
        let expandedChartInstance = null;
        
        // Metrics offered in the expanded view. Keys match the fields computed in
        // generateCharts, so no accessor can drift from what the small charts use.
        const SCATTER_METRICS = [
            { key: 'price',            label: 'Price (£m)' },
            { key: 'ptsPerGame',       label: 'Points per game (L5)' },
            { key: 'seasonPtsPerGame', label: 'Points per game (season)' },
            { key: 'xPts',             label: 'Expected points' },
            { key: 'xgiPerGame',       label: 'xGI per game' },
            { key: 'xgPerGame',        label: 'xG per game' },
            { key: 'xaPerGame',        label: 'xA per game' },
            { key: 'actualGI',         label: 'Actual G+A per game' },
            { key: 'ownership',        label: 'Ownership (%)' },
            { key: 'valueScore',       label: 'Points per £m' },
            { key: 'bonusPerGame',     label: 'Bonus per game' },
            { key: 'minutesPerGame',   label: 'Minutes per game' },
            { key: 'xgcPerGame',       label: 'xGC per game' },
            { key: 'csPerGame',        label: 'Clean sheet rate' },
            { key: 'savesPerGame',     label: 'Saves per game' },
            { key: 'reliabilityPct',   label: 'Reliability (%)' },
            { key: 'explosivenessPct', label: 'Explosiveness (%)' }
        ];

        let expandedChartKey = null;

        function fillMetricSelect(el, selected) {
            if (!el) return;
            el.innerHTML = SCATTER_METRICS.map(m =>
                `<option value="${m.key}"${m.key === selected ? ' selected' : ''}>${escHTML(m.label)}</option>`).join('');
        }

        // Reads the axis titles off the source chart so the pickers open on the
        // metrics that chart is already showing rather than on an arbitrary pair.
        function guessMetricFromTitle(title) {
            if (!title) return null;
            const t = String(title).toLowerCase();
            const hit = SCATTER_METRICS.find(m => m.label.toLowerCase() === t);
            if (hit) return hit.key;
            if (t.includes('price')) return 'price';
            if (t.includes('xgi')) return 'xgiPerGame';
            if (t.includes('ownership')) return 'ownership';
            if (t.includes('expected')) return 'xPts';
            if (t.includes('actual')) return 'actualGI';
            if (t.includes('points')) return 'ptsPerGame';
            return null;
        }

        function rebuildExpandedChart() {
            const args = [];
            /* Chart.js is fetched on demand now (loadChartJs in common.js), so
               "not defined" is the ordinary first case rather than a failure.
               Ask for it and come back. */
            if (typeof Chart === 'undefined') {
                if (typeof loadChartJs === 'function') loadChartJs().then(ok => { if (ok) rebuildExpandedChart(...args); });
                return;
            }
            const canvas = document.getElementById('expandedChart');
            const xSel = document.getElementById('expandX');
            const ySel = document.getElementById('expandY');
            const pool = (chartData && chartData.players) || [];
            if (!canvas || !xSel || !ySel || !pool.length) return;

            const xKey = xSel.value, yKey = ySel.value;
            const xMeta = SCATTER_METRICS.find(m => m.key === xKey) || SCATTER_METRICS[0];
            const yMeta = SCATTER_METRICS.find(m => m.key === yKey) || SCATTER_METRICS[1];

            if (expandedChartInstance) { expandedChartInstance.destroy(); expandedChartInstance = null; }
            registerScatterPlugins();
            const ct = getChartTheme();

            const datasets = ['GK', 'DEF', 'MID', 'FWD'].map(pos => ({
                label: pos,
                position: pos,
                data: pool.filter(p => p.pos === pos).map(p => {
                    const x = parseFloat(p[xKey]), y = parseFloat(p[yKey]);
                    return Number.isFinite(x) && Number.isFinite(y) ? { ...p, x, y } : null;
                }).filter(Boolean),
                backgroundColor: POSITION_COLORS[pos].bg,
                borderColor: POSITION_COLORS[pos].border,
                pointStyle: POSITION_STYLES[pos],
                pointRadius: cx => (shortlistedPlayerIds.has(cx.raw?.id) ? 10 : 7),
                pointHoverRadius: cx => (shortlistedPlayerIds.has(cx.raw?.id) ? 14 : 11),
                pointBorderWidth: cx => (shortlistedPlayerIds.has(cx.raw?.id) ? 2 : 1),
                hidden: !activePositionFilters[pos]
            }));

            // The expanded canvas borrows the source chart's quadrant labels.
            canvas.dataset.quadKey = expandedChartKey ? `${expandedChartKey}Chart` : '';

            expandedChartInstance = new Chart(canvas.getContext('2d'), {
                type: 'scatter',
                data: { datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    onHover: (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
                    onClick: (evt, els, chart) => {
                        if (!els.length) return;
                        const raw = chart.data.datasets[els[0].datasetIndex].data[els[0].index];
                        if (raw && raw.id != null && typeof openPlayerModal === 'function') openPlayerModal(raw.id);
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: false, position: 'nearest', external: scatterTooltipHandler }
                    },
                    scales: {
                        x: { grid: { color: ct.grid }, ticks: { color: ct.text, font: { size: 12 } },
                             title: { display: true, text: xMeta.label, color: ct.text } },
                        y: { grid: { color: ct.grid }, ticks: { color: ct.text, font: { size: 12 } },
                             title: { display: true, text: yMeta.label, color: ct.text } }
                    }
                }
            });
        }

        function expandChart(chartKey, title, subtitle) {
            const modal = document.getElementById('chartModal');
            const titleEl = document.getElementById('chartModalTitle');
            const subtitleEl = document.getElementById('chartModalSubtitle');
            const canvas = document.getElementById('expandedChart');
            const playersGrid = document.getElementById('chartPlayersGrid');
            
            if (!modal || !canvas) return;
            
            titleEl.textContent = title;
            subtitleEl.textContent = subtitle;
            
            // Destroy previous instance if exists
            if (expandedChartInstance) {
                expandedChartInstance.destroy();
                expandedChartInstance = null;
            }
            
            // Get the original chart instance
            const originalChart = chartInstances[chartKey];
            if (!originalChart) return;
            
            // Clone the chart configuration
            const config = {
                type: originalChart.config.type,
                data: JSON.parse(JSON.stringify(originalChart.config.data)),
                options: {
                    ...JSON.parse(JSON.stringify(originalChart.config.options)),
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(13, 17, 23, 0.95)',
                            titleColor: '#4ade80',
                            bodyColor: 'rgba(255,255,255,0.87)',
                            borderColor: 'rgba(255,255,255,0.1)',
                            borderWidth: 1,
                            padding: 16,
                            displayColors: true,
                            titleFont: { size: 14, weight: 'bold' },
                            bodyFont: { size: 13 },
                            callbacks: {
                                title: ctx => {
                                    const raw = ctx[0]?.raw;
                                    if (raw?.name) return `${raw.name} (${raw.team})`;
                                    return '';
                                },
                                label: ctx => {
                                    const p = ctx.raw;
                                    if (!p || !p.name) return '';
                                    return [
                                        `Position: ${p.pos}`,
                                        `Price: £${p.price?.toFixed(1)}m`,
                                        `Pts/G: ${p.ptsPerGame?.toFixed(1)}`,
                                        `xGI/G: ${p.xgiPerGame?.toFixed(2)}`,
                                        `Ownership: ${p.ownership?.toFixed(1)}%`
                                    ];
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { color: 'rgba(255,255,255,0.08)' },
                            ticks: { color: 'rgba(255,255,255,0.7)', font: { size: 12 } },
                            title: originalChart.config.options?.scales?.x?.title || { display: false }
                        },
                        y: {
                            grid: { color: 'rgba(255,255,255,0.08)' },
                            ticks: { color: 'rgba(255,255,255,0.7)', font: { size: 12 } },
                            title: originalChart.config.options?.scales?.y?.title || { display: false }
                        }
                    }
                }
            };
            
            // Make points larger in expanded view
            if (config.data.datasets) {
                config.data.datasets.forEach(ds => {
                    if (ds.pointRadius) ds.pointRadius = 8;
                    if (ds.pointHoverRadius) ds.pointHoverRadius = 12;
                });
            }
            
            // Show modal first so canvas has dimensions
            modal.classList.add('show');

            expandedChartKey = chartKey;
            const srcScales = originalChart.config.options?.scales || {};
            fillMetricSelect(document.getElementById('expandX'),
                guessMetricFromTitle(srcScales.x?.title?.text) || 'price');
            fillMetricSelect(document.getElementById('expandY'),
                guessMetricFromTitle(srcScales.y?.title?.text) || 'ptsPerGame');

            // Built from the metric pickers rather than cloned, so changing an
            // axis rebuilds from the same code path that drew it the first time.
            setTimeout(() => {
                rebuildExpandedChart();
                populateChartPlayers(chartKey, playersGrid);
            }, 50);
        }
        
        function populateChartPlayers(chartKey, container) {
            const players = chartData.players || [];
            if (!players.length) {
                container.innerHTML = '<div style="color: var(--text-muted); padding: 20px;">No player data available</div>';
                return;
            }

            // Chart-specific config: sorting, stat display, panel title/subtitle, and reason generator
            const chartConfig = {
                priceVsPoints: {
                    title: 'Best Value Picks',
                    subtitle: 'Highest points per million spent',
                    sort: (a, b) => b.valueScore - a.valueScore,
                    statValue: p => p.valueScore.toFixed(2),
                    statLabel: 'Val',
                    reason: p => `${p.ptsPerGame.toFixed(1)} pts/g at just £${p.price.toFixed(1)}m — ${p.valueScore >= 1 ? 'elite' : 'strong'} value for money`
                },
                xgiVsActual: {
                    title: 'Overperforming xGI',
                    subtitle: 'Players outscoring their expected stats',
                    sort: (a, b) => (b.actualGI - b.xgiPerGame) - (a.actualGI - a.xgiPerGame),
                    statValue: p => '+' + (p.actualGI - p.xgiPerGame).toFixed(2),
                    statLabel: 'Over',
                    reason: p => {
                        const delta = p.actualGI - p.xgiPerGame;
                        return delta > 0.3 ? `Massively overperforming xGI — ${p.actualGI.toFixed(2)} actual vs ${p.xgiPerGame.toFixed(2)} expected. May regress`
                            : delta > 0.1 ? `Clinical finisher — beating xGI by ${delta.toFixed(2)} per game`
                            : `Slightly above expected — sustainable performance`;
                    }
                },
                xPtsVsActual: {
                    title: 'Lucky / Unlucky Players',
                    subtitle: 'Actual points vs expected from underlying stats',
                    sort: (a, b) => (b.actualPts - b.xPts) - (a.actualPts - a.xPts),
                    statValue: p => { const d = p.actualPts - p.xPts; return (d >= 0 ? '+' : '') + d.toFixed(1); },
                    statLabel: 'Δ Pts',
                    reason: p => {
                        const delta = p.actualPts - p.xPts;
                        return delta > 1 ? `Overperforming expected points by ${delta.toFixed(1)} — bonus, set pieces, or clinical finishing`
                            : delta < -1 ? `Underperforming by ${Math.abs(delta).toFixed(1)} pts — due a correction upward`
                            : `Performing close to expected levels`;
                    }
                },
                ownershipVsForm: {
                    title: 'Top Differentials',
                    subtitle: 'Under-owned players with strong form',
                    filter: p => p.ownership < 10,
                    sort: (a, b) => b.ptsPerGame - a.ptsPerGame,
                    statValue: p => p.ownership.toFixed(1) + '%',
                    statLabel: 'Own',
                    reason: p => `Just ${p.ownership.toFixed(1)}% owned but delivering ${p.ptsPerGame.toFixed(1)} pts/g — genuine differential`
                },
                bonusMagnet: {
                    title: 'Bonus Point Magnets',
                    subtitle: 'Consistently earning bonus points',
                    sort: (a, b) => b.bonusPerGame - a.bonusPerGame,
                    statValue: p => p.bonusPerGame.toFixed(1),
                    statLabel: 'Bon/G',
                    reason: p => `Averaging ${p.bonusPerGame.toFixed(1)} bonus per game (${(p.l5?.bps || 0) / (p.l5?.games || 1) >= 25 ? 'elite' : 'strong'} BPS accumulator)`
                },
                formVsSeason: {
                    title: 'Rising Form',
                    subtitle: 'Players improving vs their season average',
                    sort: (a, b) => (b.ptsPerGame - b.seasonPtsPerGame) - (a.ptsPerGame - a.seasonPtsPerGame),
                    statValue: p => { const d = p.ptsPerGame - p.seasonPtsPerGame; return (d >= 0 ? '+' : '') + d.toFixed(1); },
                    statLabel: 'Δ Form',
                    reason: p => {
                        const delta = p.ptsPerGame - p.seasonPtsPerGame;
                        return delta > 2 ? `Huge form surge — L5 average ${p.ptsPerGame.toFixed(1)} vs season ${p.seasonPtsPerGame.toFixed(1)}. Get in now`
                            : delta > 0.5 ? `Trending upward — recent form exceeding season baseline`
                            : `Consistent performer with steady output`;
                    }
                },
                xgcVsCS: {
                    title: 'Best Defensive Assets',
                    subtitle: 'Low xGC + high clean sheet rate',
                    filter: p => p.pos === 'GK' || p.pos === 'DEF',
                    sort: (a, b) => b.csPerGame - a.csPerGame,
                    statValue: p => (p.csPerGame * 100).toFixed(0) + '%',
                    statLabel: 'CS%',
                    reason: p => `${(p.csPerGame * 100).toFixed(0)}% CS rate with ${p.xgcPerGame.toFixed(2)} xGC/g — ${p.xgcPerGame < 1 ? 'elite defense' : 'solid wall'}`
                },
                defAttacking: {
                    title: 'Attacking Defenders',
                    subtitle: 'Defenders with goal involvement threat',
                    filter: p => p.pos === 'DEF',
                    sort: (a, b) => b.xgiPerGame - a.xgiPerGame,
                    statValue: p => p.xgiPerGame.toFixed(2),
                    statLabel: 'xGI/Match',
                    reason: p => `${p.xgiPerGame.toFixed(2)} xGI per match — attacking wingback/centre-back with set piece threat`
                },
                /* Ranked on the hit rate rather than actions per 90: the per-90
                   figure is the input, and what a manager is buying is how often
                   the two points actually arrive. */
                defCon: {
                    title: 'Defensive Contribution',
                    subtitle: 'How often the defensive-contribution points land',
                    filter: p => (p.pos === 'DEF' || p.pos === 'MID') && p.defConHit,
                    sort: (a, b) => b.defConHit.rate - a.defConHit.rate,
                    statValue: p => Math.round(p.defConHit.rate * 100) + '%',
                    statLabel: 'hit rate',
                    reason: p => `Cleared ${p.defConHit.threshold}+ defensive actions in ${p.defConHit.hits} of ${p.defConHit.n} appearances — ${(p.defConHit.rate * 2).toFixed(1)} pts a match`
                },
                gkSaves: {
                    title: 'Save Point Machines',
                    subtitle: 'Goalkeepers with highest save rates',
                    filter: p => p.pos === 'GK',
                    sort: (a, b) => b.savesPerGame - a.savesPerGame,
                    statValue: p => p.savesPerGame?.toFixed(1) || '-',
                    statLabel: 'Sav/G',
                    reason: p => `${p.savesPerGame?.toFixed(1)} saves/g — busy keeper behind a porous defense = save point gold`
                },
                reliability: {
                    title: 'Most Reliable Assets',
                    subtitle: 'Consistent returns + explosive ceiling',
                    sort: (a, b) => (b.reliabilityPct + b.explosivenessPct) - (a.reliabilityPct + a.explosivenessPct),
                    statValue: p => (p.reliabilityPct + p.explosivenessPct).toFixed(0),
                    statLabel: 'Score',
                    reason: p => `${p.reliabilityPct.toFixed(0)}% reliability + ${p.explosivenessPct.toFixed(0)}% explosiveness — ${p.reliabilityPct > 60 ? 'set and forget' : 'high ceiling play'}`
                },
                valueVsOwnership: {
                    title: 'Hidden Gems',
                    subtitle: 'Great value at low ownership',
                    filter: p => p.ownership < 15,
                    sort: (a, b) => b.valueScore - a.valueScore,
                    statValue: p => p.valueScore.toFixed(2),
                    statLabel: 'Val',
                    reason: p => `${p.valueScore.toFixed(2)} value score at only ${p.ownership.toFixed(1)}% owned — under the radar`
                }
            };

            const config = chartConfig[chartKey] || {
                title: 'Top Performers',
                subtitle: 'Best recent points output',
                sort: (a, b) => b.ptsPerGame - a.ptsPerGame,
                statValue: p => p.ptsPerGame.toFixed(1),
                statLabel: 'Pts/G',
                reason: p => `Averaging ${p.ptsPerGame.toFixed(1)} points per game in the last 5`
            };

            // Update panel header
            const titleEl = document.getElementById('chartPlayersTitle');
            const subtitleEl = document.getElementById('chartPlayersSubtitle');
            if (titleEl) titleEl.textContent = config.title;
            if (subtitleEl) subtitleEl.textContent = config.subtitle;

            let filtered = config.filter ? players.filter(config.filter) : [...players];
            filtered.sort(config.sort);
            const top = filtered.slice(0, 10);

            const posColors = { GK: '#fbbf24', DEF: '#34d399', MID: '#60a5fa', FWD: '#f87171' };

            container.innerHTML = top.map((p, i) => {
                const sv = config.statValue(p);
                const reason = config.reason(p);
                return `
                    <div class="chart-player-card">
                        <div class="chart-player-rank">${i + 1}</div>
                        <div class="chart-player-info">
                            <div class="chart-player-name-row">
                                <span class="chart-player-name">${escHTML(p.name)}</span>
                                <span class="chart-player-pos-badge" style="background: ${posColors[p.pos]}20; color: ${posColors[p.pos]}">${p.pos}</span>
                            </div>
                            <div class="chart-player-meta">${escHTML(p.team)} · £${p.price.toFixed(1)}m · ${p.ownership.toFixed(1)}% owned</div>
                            <div class="chart-player-reason">${reason}</div>
                        </div>
                        <div class="chart-player-stat-badge">
                            <div class="chart-player-stat-value">${sv}</div>
                            <div class="chart-player-stat-label">${config.statLabel}</div>
                        </div>
                    </div>
                `;
            }).join('');
        }
        
        function closeChartModal() {
            const modal = document.getElementById('chartModal');
            modal?.classList.remove('show');
            
            // Destroy chart instance when closing
            if (expandedChartInstance) {
                expandedChartInstance.destroy();
                expandedChartInstance = null;
            }
        }

        // ============================================
        // PLAYER DETAIL MODAL — the trend charts this page contributes to
        // the shared profile card. See scripts/player-profile.js.
        // ============================================
        let playerModalCharts = [];
        let currentPlayerData = null;
        let currentPlayerTab = 'season';
        
        
        // Find player by ID across all positions
        function findPlayerById(playerId, position) {
            // First check the specified position in tableData
            if (position && tableData[position]) {
                const player = tableData[position].find(p => p.id === playerId);
                if (player) return player;
            }
            // Search all positions in tableData
            for (const pos of ['GK', 'DEF', 'MID', 'FWD']) {
                if (tableData[pos]) {
                    const player = tableData[pos].find(p => p.id === playerId);
                    if (player) return player;
                }
            }
            // Fallback to allAnalyses (for rec/route card clicks before tables load)
            return allAnalyses.find(p => p.id === playerId) || null;
        }
        
        /* ===== What this page adds to the shared card =====

           scripts/player-profile.js draws the profile; these three hooks are
           where the players page puts back the one thing it had that the squad
           page never did — a Chart.js trend per metric, gameweek by gameweek.
           Everything else the old modal showed (name, price, ownership, five
           tiles, the fixture strip) the shared card already says, and says more
           of, so it is not rebuilt here.

           The player handed in is the projection engine's shape. The history
           these charts plot lives on this page's own analyses, so it is looked
           up by id rather than threaded through. */
        function pdmPageSections(player) {
            const rich = findPlayerById(player.id);
            // Cleared rather than left holding the last player opened, or the tab
            // buttons would redraw someone else's season into an empty card.
            currentPlayerData = null;
            if (!rich || !(rich.history || []).length) return '';
            currentPlayerData = rich;
            currentPlayerTab = 'season';
            // Wrapped in a pd-group so it reads as a fourth band of the card,
            // beside Player / Team / Opponents, rather than a loose panel below.
            // v2Icon, not an emoji: this card's other group titles are drawn
            // marks now, and one picture from a different set would show.
            return `<div class="pd-group"><div class="pd-group-title">${v2Icon('report')} Gameweek by gameweek</div>
                <div class="detail-section" data-accent="trends" data-wide>
                    <div class="player-modal-tabs">
                        <button class="player-modal-tab active" onclick="switchPlayerTab('season')">Season Trend</button>
                        <button class="player-modal-tab" onclick="switchPlayerTab('last5')">Last 5 Games</button>
                    </div>
                    <div class="player-charts-grid" id="playerChartsGrid"></div>
                </div>
            </div>`;
        }

        // Charts need their canvases in the document, which is what this hook is
        // for — it runs after the modal's markup has been inserted.
        function pdmAfterRender(player) {
            if (!currentPlayerData || currentPlayerData.id !== player.id) return;
            const posMap = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
            createPlayerTrendCharts(currentPlayerData, posMap[player.position], 'season');
        }

        // A Chart.js instance holds a canvas and its own resize listener; the
        // modal's markup is thrown away on close, so they have to go with it.
        function pdmOnClose() {
            playerModalCharts.forEach(c => c.destroy());
            playerModalCharts = [];
            currentPlayerData = null;
        }
        
        function switchPlayerTab(tab) {
            currentPlayerTab = tab;
            
            document.querySelectorAll('.player-modal-tab').forEach(t => {
                t.classList.toggle('active', t.textContent.toLowerCase().includes(tab === 'season' ? 'season' : 'last'));
            });
            
            if (currentPlayerData) {
                const posMap = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
                const pos = posMap[currentPlayerData.position];
                createPlayerTrendCharts(currentPlayerData, pos, tab);
            }
        }
        
        function createPlayerTrendCharts(player, pos, mode) {
            const args = [player, pos, mode];
            /* Chart.js is fetched on demand now (loadChartJs in common.js), so
               "not defined" is the ordinary first case rather than a failure.
               Ask for it and come back. */
            if (typeof Chart === 'undefined') {
                if (typeof loadChartJs === 'function') loadChartJs().then(ok => { if (ok) createPlayerTrendCharts(...args); });
                return;
            }
            // Destroy existing charts
            playerModalCharts.forEach(c => c.destroy());
            playerModalCharts = [];
            
            const container = document.getElementById('playerChartsGrid');
            const history = player.history || [];

            if (history.length === 0) {
                const ls = player.lastSeason;
                container.innerHTML = renderEmptyState(
                    'No gameweek data yet this season',
                    ls
                        ? `Trend charts need this season's per-gameweek data, not available until GW1. Last season (2025/26): ${ls.totalPoints || 0} pts, ${ls.goals || 0} goals, ${ls.assists || 0} assists.`
                        : 'Trend charts need this season’s per-gameweek data, which isn’t available until GW1.',
                    'bar-chart-3'
                );
                return;
            }

            let chartHistory = history;

            // Limit based on mode
            if (mode === 'last5') {
                chartHistory = chartHistory.slice(-5);
            }
            
            // Define metrics based on position
            let metrics = [];
            
            if (pos === 'GK') {
                metrics = [
                    { key: 'total_points', label: 'Points', color: '#4ade80' },
                    { key: 'minutes', label: 'Minutes', color: '#60a5fa' },
                    { key: 'saves', label: 'Saves', color: '#fbbf24' },
                    { key: 'clean_sheets', label: 'Clean Sheets', color: '#34d399' }
                ];
            } else if (pos === 'DEF') {
                metrics = [
                    { key: 'total_points', label: 'Points', color: '#4ade80' },
                    { key: 'minutes', label: 'Minutes', color: '#60a5fa' },
                    { key: 'clean_sheets', label: 'Clean Sheets', color: '#34d399' },
                    { key: 'expected_goal_involvements', label: 'xGI', color: '#a855f7' }
                ];
            } else if (pos === 'MID') {
                metrics = [
                    { key: 'total_points', label: 'Points', color: '#4ade80' },
                    { key: 'minutes', label: 'Minutes', color: '#60a5fa' },
                    { key: 'expected_goal_involvements', label: 'xGI', color: '#a855f7' },
                    { key: 'goals_scored', label: 'Goals + Assists', color: '#f59e0b', combine: 'assists' }
                ];
            } else { // FWD
                metrics = [
                    { key: 'total_points', label: 'Points', color: '#4ade80' },
                    { key: 'minutes', label: 'Minutes', color: '#60a5fa' },
                    { key: 'expected_goals', label: 'xG', color: '#f87171' },
                    { key: 'goals_scored', label: 'Goals', color: '#fbbf24' }
                ];
            }
            
            // Create chart cards
            container.innerHTML = metrics.map((m, i) => `
                <div class="player-chart-card">
                    <div class="player-chart-title">${m.label}</div>
                    <div class="player-chart-container">
                        <canvas id="playerChart${i}"></canvas>
                    </div>
                </div>
            `).join('');
            
            // Create charts
            metrics.forEach((m, i) => {
                const canvas = document.getElementById(`playerChart${i}`);
                if (!canvas) return;
                
                const labels = chartHistory.map((h, idx) => mode === 'last5' ? `GW${idx + 1}` : `GW${h.round || idx + 1}`);
                let data = chartHistory.map(h => {
                    let val = h[m.key] || 0;
                    if (m.combine) {
                        val += h[m.combine] || 0;
                    }
                    return val;
                });
                
                const chart = new Chart(canvas.getContext('2d'), {
                    type: 'line',
                    data: {
                        labels,
                        datasets: [{
                            data,
                            borderColor: m.color,
                            backgroundColor: m.color + '20',
                            fill: true,
                            tension: 0.3,
                            pointRadius: mode === 'last5' ? 6 : 3,
                            pointHoverRadius: 8,
                            borderWidth: 2
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                backgroundColor: 'rgba(13, 17, 23, 0.95)',
                                titleColor: m.color,
                                bodyColor: '#fff',
                                padding: 10,
                                displayColors: false
                            }
                        },
                        scales: {
                            x: {
                                grid: { color: 'rgba(255,255,255,0.05)' },
                                ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 10 } }
                            },
                            y: {
                                grid: { color: 'rgba(255,255,255,0.05)' },
                                ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 10 } },
                                beginAtZero: true
                            }
                        }
                    }
                });
                
                playerModalCharts.push(chart);
            });
        }
        
        
        // Close modals with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeChartModal();
                closeCompareModal();
                closePlayerModal();
            }
        });

        // Close dropdowns when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.column-selector')) {
                document.querySelectorAll('.column-dropdown').forEach(d => d.classList.remove('show'));
            }
        });

        // ============================================
        // CHARTS - Full implementation
        // ============================================
        let chartInstances = {};
        let chartData = {};
        let activePositionFilters = { GK: true, DEF: true, MID: true, FWD: true };
        
        const POSITION_COLORS = {
            'GK': { bg: 'rgba(251, 191, 36, 0.8)', border: '#fbbf24' },
            'DEF': { bg: 'rgba(52, 211, 153, 0.8)', border: '#34d399' },
            'MID': { bg: 'rgba(96, 165, 250, 0.8)', border: '#60a5fa' },
            'FWD': { bg: 'rgba(248, 113, 113, 0.8)', border: '#f87171' }
        };
        
        /* One shape, four colours.
           Four marker shapes meant a scatter asked you to hold both a shape
           key and a colour key while reading it, and at 5px a triangle and a
           rotated square are barely distinguishable anyway — so the shape was
           carrying almost no information for all the effort it cost. The
           colours are the site's --position-* tokens and already say which
           position; the marker's only job is to be a point. */
        const POSITION_STYLES = { 'GK': 'circle', 'DEF': 'circle', 'MID': 'circle', 'FWD': 'circle' };

        // ============================================
        // SCATTER QUADRANTS
        // Which corner means what differs per chart — on price-vs-points the
        // cheap-and-productive corner is the prize, while on xGI-vs-actual the
        // same corner means a player is outscoring his chances and due to cool
        // off. So the labels and the tone are declared per chart rather than
        // assumed from position.
        // ============================================
        const QUAD_TONE = {
            good:   { fill: 'rgba(52, 211, 153, 0.07)',  text: 'rgba(16, 185, 129, 0.85)' },
            bad:    { fill: 'rgba(248, 113, 113, 0.07)', text: 'rgba(239, 68, 68, 0.85)' },
            watch:  { fill: 'rgba(96, 165, 250, 0.07)',  text: 'rgba(59, 130, 246, 0.85)' },
            muted:  { fill: 'rgba(148, 163, 184, 0.06)', text: 'rgba(100, 116, 139, 0.8)' }
        };

        // tl / tr / bl / br, each: label + tone.
        const CHART_QUADRANTS = {
            priceVsPointsChart: {
                tl: ['Value gems', 'good'], tr: ['Elite premiums', 'watch'],
                bl: ['Low priority', 'muted'], br: ['Overpriced', 'bad']
            },
            xgiVsActualChart: {
                tl: ['Outscoring chances', 'bad'], tr: ['Elite output', 'good'],
                bl: ['Low involvement', 'muted'], br: ['Returns owed', 'watch']
            },
            xPtsVsActualChart: {
                tl: ['Riding luck', 'bad'], tr: ['Delivering', 'good'],
                bl: ['Quiet', 'muted'], br: ['Underperforming', 'watch']
            },
            formVsSeasonChart: {
                tl: ['Form spike', 'watch'], tr: ['Consistently good', 'good'],
                bl: ['Cold', 'muted'], br: ['Form dropping', 'bad']
            },
            xgcVsCSChart: {
                tl: ['Solid defence', 'good'], tr: ['Riding luck', 'watch'],
                bl: ['Leaky', 'bad'], br: ['Unlucky defence', 'watch']
            },
            defAttackingChart: {
                tl: ['Creator', 'watch'], tr: ['Dual threat', 'good'],
                bl: ['No attacking threat', 'muted'], br: ['Scorer', 'watch']
            },
            /* Bottom-right is the quadrant worth naming: high per-90 and a low
               hit rate means he is doing the work and finishing just short of the
               threshold, which is the profile that turns into points on the day
               his side spends ninety minutes defending. */
            defConChart: {
                tl: ['Efficient', 'good'], tr: ['Banks it weekly', 'good'],
                bl: ['Not a route', 'muted'], br: ['Falls just short', 'watch']
            },
            gkSavesChart: {
                tl: ['Busy keeper', 'watch'], tr: ['Save points + sheets', 'good'],
                bl: ['Quiet', 'muted'], br: ['Behind a good defence', 'good']
            },
            reliabilityChart: {
                tl: ['Steady returner', 'good'], tr: ['Reliable + explosive', 'good'],
                bl: ['Avoid', 'muted'], br: ['Boom or bust', 'watch']
            },
            bonusMagnetChart: {
                tl: ['Bonus magnet', 'good'], tr: ['Points + bonus', 'good'],
                bl: ['Low priority', 'muted'], br: ['Points, no bonus', 'watch']
            },
            ownershipVsFormChart: {
                tl: ['In form, under-owned', 'good'], tr: ['Template picks', 'watch'],
                bl: ['Ignore', 'muted'], br: ['Owned, out of form', 'bad']
            },
            valueVsOwnershipChart: {
                tl: ['Under-owned value', 'good'], tr: ['Popular value', 'watch'],
                bl: ['Poor value', 'muted'], br: ['Owned, poor value', 'bad']
            }
        };

        const median = arr => {
            if (!arr.length) return null;
            const s = [...arr].sort((a, b) => a - b);
            const m = Math.floor(s.length / 2);
            return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
        };

        // Collect every currently-visible scatter point. Trend lines carry no
        // .position, so they never influence the split.
        function visibleScatterPoints(chart) {
            const out = [];
            chart.data.datasets.forEach((ds, i) => {
                if (!ds.position) return;
                const meta = chart.getDatasetMeta(i);
                if (ds.hidden || meta.hidden) return;
                (ds.data || []).forEach(pt => {
                    if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) out.push(pt);
                });
            });
            return out;
        }

        function chartQuadrantConfig(chart) {
            const key = chart.canvas?.dataset?.quadKey || chart.canvas?.id;
            return CHART_QUADRANTS[key] || null;
        }

        // Which quadrant a point sits in, given the current split.
        function quadrantForPoint(chart, pt) {
            const cfg = chartQuadrantConfig(chart);
            if (!cfg) return null;
            const pts = visibleScatterPoints(chart);
            if (pts.length < 8) return null;
            const mx = median(pts.map(p => p.x)), my = median(pts.map(p => p.y));
            const key = (pt.y >= my ? 't' : 'b') + (pt.x >= mx ? 'r' : 'l');
            return cfg[key] ? { label: cfg[key][0], tone: cfg[key][1] } : null;
        }

        // Splits on the median of what is plotted rather than on a fixed value,
        // so the bands stay meaningful when the position filters change the pool.
        const quadrantBandsPlugin = {
            id: 'quadrantBands',
            beforeDatasetsDraw(chart) {
                const cfg = chartQuadrantConfig(chart);
                if (!cfg) return;
                const area = chart.chartArea;
                const sx = chart.scales.x, sy = chart.scales.y;
                if (!area || !sx || !sy) return;
                const pts = visibleScatterPoints(chart);
                if (pts.length < 8) return;

                const mx = sx.getPixelForValue(median(pts.map(p => p.x)));
                const my = sy.getPixelForValue(median(pts.map(p => p.y)));
                if (!Number.isFinite(mx) || !Number.isFinite(my)) return;
                const cx = Math.min(Math.max(mx, area.left), area.right);
                const cy = Math.min(Math.max(my, area.top), area.bottom);

                const ctx = chart.ctx;
                ctx.save();
                const boxes = [
                    ['tl', area.left, area.top, cx - area.left, cy - area.top,      'left',  'top'],
                    ['tr', cx, area.top, area.right - cx, cy - area.top,            'right', 'top'],
                    ['bl', area.left, cy, cx - area.left, area.bottom - cy,         'left',  'bottom'],
                    ['br', cx, cy, area.right - cx, area.bottom - cy,               'right', 'bottom']
                ];
                boxes.forEach(([k, x, y, w, h, hAlign, vAlign]) => {
                    const q = cfg[k];
                    if (!q || w <= 2 || h <= 2) return;
                    const tone = QUAD_TONE[q[1]] || QUAD_TONE.muted;
                    ctx.fillStyle = tone.fill;
                    ctx.fillRect(x, y, w, h);
                    // Label tucked into the outer corner, out of the data's way.
                    if (w > 92 && h > 34) {
                        ctx.fillStyle = tone.text;
                        ctx.font = '600 10px Inter, system-ui, sans-serif';
                        ctx.textAlign = hAlign;
                        ctx.textBaseline = vAlign;
                        const px = hAlign === 'left' ? x + 8 : x + w - 8;
                        const py = vAlign === 'top' ? y + 7 : y + h - 7;
                        ctx.fillText(q[0].toUpperCase(), px, py);
                    }
                });
                // The split itself.
                ctx.strokeStyle = 'rgba(128, 128, 128, 0.22)';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(cx, area.top); ctx.lineTo(cx, area.bottom);
                ctx.moveTo(area.left, cy); ctx.lineTo(area.right, cy);
                ctx.stroke();
                ctx.restore();
            }
        };

        // A shortlisted player gets a ring drawn behind him so he is findable in
        // a cloud of three hundred dots.
        const shortlistRingPlugin = {
            id: 'shortlistRings',
            afterDatasetsDraw(chart) {
                if (!shortlistedPlayerIds || !shortlistedPlayerIds.size) return;
                const ctx = chart.ctx;
                ctx.save();
                chart.data.datasets.forEach((ds, i) => {
                    if (!ds.position) return;
                    const meta = chart.getDatasetMeta(i);
                    if (ds.hidden || meta.hidden) return;
                    (meta.data || []).forEach((el, j) => {
                        const raw = ds.data[j];
                        if (!raw || !shortlistedPlayerIds.has(raw.id)) return;
                        ctx.beginPath();
                        ctx.arc(el.x, el.y, 11, 0, Math.PI * 2);
                        ctx.strokeStyle = 'rgba(251, 191, 36, 0.95)';
                        ctx.lineWidth = 2;
                        ctx.stroke();
                        ctx.beginPath();
                        ctx.arc(el.x, el.y, 14, 0, Math.PI * 2);
                        ctx.strokeStyle = 'rgba(251, 191, 36, 0.3)';
                        ctx.lineWidth = 3;
                        ctx.stroke();
                    });
                });
                ctx.restore();
            }
        };

        // Chart.js is loaded at the bottom of the page, after this script block,
        // so registering at parse time silently does nothing. Register on first
        // use instead.
        let scatterPluginsRegistered = false;
        function registerScatterPlugins() {
            if (scatterPluginsRegistered || typeof Chart === 'undefined') return;
            Chart.register(quadrantBandsPlugin, shortlistRingPlugin);
            scatterPluginsRegistered = true;
        }

        // ---- rich hover card ----
        function scatterTooltipEl() {
            let el = document.getElementById('scatterTip');
            if (!el) {
                el = document.createElement('div');
                el.id = 'scatterTip';
                el.className = 'scatter-tip';
                document.body.appendChild(el);
            }
            return el;
        }

        function scatterTooltipHandler(context) {
            const { chart, tooltip } = context;
            const el = scatterTooltipEl();
            if (!tooltip || tooltip.opacity === 0) { el.classList.remove('show'); return; }
            const dp = tooltip.dataPoints && tooltip.dataPoints[0];
            const p = dp && dp.raw;
            if (!p || !p.name) { el.classList.remove('show'); return; }

            const xLabel = chart.options?.scales?.x?.title?.text || 'X';
            const yLabel = chart.options?.scales?.y?.title?.text || 'Y';
            const quad = quadrantForPoint(chart, p);
            const starred = shortlistedPlayerIds.has(p.id);
            const accent = (POSITION_COLORS[p.pos] || {}).border || '#60a5fa';

            el.innerHTML = `
                <div class="stip-head" style="--stip-accent:${accent}">
                    <div>
                        <div class="stip-name">${escHTML(p.name)}${starred ? ` <span class="stip-star">${v2Icon('star')}</span>` : ''}</div>
                        <div class="stip-sub"><span class="stip-pos">${escHTML(p.pos || '')}</span>${escHTML(p.team || '')} · £${(p.price || 0).toFixed(1)}m · ${(p.ownership || 0).toFixed(1)}% owned</div>
                    </div>
                </div>
                <div class="stip-metrics">
                    <div class="stip-metric"><span>${escHTML(xLabel)}</span><b>${Number(p.x).toFixed(2)}</b></div>
                    <div class="stip-metric"><span>${escHTML(yLabel)}</span><b>${Number(p.y).toFixed(2)}</b></div>
                </div>
                ${quad ? `<div class="stip-verdict stip-${quad.tone}">${escHTML(quad.label)}</div>` : ''}
                ${starred ? '<div class="stip-note">On your shortlist</div>' : ''}
                <div class="stip-cta">Click to open player</div>`;

            const box = chart.canvas.getBoundingClientRect();
            el.classList.add('show');
            // Keep the card on screen when the point is near an edge.
            const w = el.offsetWidth, h = el.offsetHeight;
            let left = box.left + window.scrollX + tooltip.caretX + 14;
            let top = box.top + window.scrollY + tooltip.caretY - h / 2;
            if (left + w > window.scrollX + document.documentElement.clientWidth - 8) {
                left = box.left + window.scrollX + tooltip.caretX - w - 14;
            }
            top = Math.max(window.scrollY + 8, top);
            el.style.left = left + 'px';
            el.style.top = top + 'px';
        }

        function generateCharts(analyses) {
            if (isPreseason) {
                const banner = renderSeasonNotice('Form &amp; trend charts need this season’s game-by-game data, which isn’t available until GW1. Showing last season’s top scorers instead.');
                requestAnimationFrame(() => createLastSeasonChart(analyses));
                return `${banner}
                    <div class="chart-category pa-panel">
                        <h3 class="chart-category-title pa-panel-title"><i data-lucide="trending-up" style="width:18px;height:18px;display:inline-block;vertical-align:middle;"></i> Top Points — 2025/26 Season</h3>
                        <div class="chart-card" style="height:520px;">
                            <div class="chart-container" style="height:480px;"><canvas id="lastSeasonPointsChart"></canvas></div>
                        </div>
                    </div>`;
            }
            const positionMap = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };

            // Every scatter here plots a per-game rate, so a player needs at least
            // one appearance to place. The gate used to demand three recent games
            // AND five season games, which one gameweek into a season excludes all
            // 609 players — and because Chart.js still draws the axes and the
            // hard-coded trend lines, the result looked like a working chart with
            // no players rather than like a broken filter.
            const chartMinGames = Math.min(3, Math.max(seasonGamesPlayed, 1));
            const validPlayers = analyses
                .filter(p => p.l5 && p.season && (p.l5.games || 0) >= chartMinGames && (p.l5.minutes || 0) > 0)
                .map(p => {
                    const pos = positionMap[p.position];
                    const l5Games = p.l5.games;
                    const seasonGames = p.season.games;
                    
                    // Basic stats
                    const ptsPerGame = p.l5.points / l5Games;
                    const xgiPerGame = p.l5.xGI / l5Games;
                    const xgPerGame = (p.l5.xG || 0) / l5Games;
                    const xaPerGame = (p.l5.xA || 0) / l5Games;
                    const xgcPerGame = (p.l5.xGC || 0) / l5Games;
                    const csPerGame = (p.l5.cleanSheets || 0) / l5Games;
                    const gcPerGame = (p.l5.goalsConceded || 0) / l5Games;
                    const savesPerGame = (p.l5.saves || 0) / l5Games;
                    
                    // Reliability & Explosiveness — use actual history data
                    const gamesWithReturn = p.season.goals + p.season.assists + p.season.cleanSheets + p.season.bonus;
                    const reliabilityPct = Math.min(100, (gamesWithReturn / seasonGames) * 100);
                    // Count actual 10+ point games from history
                    const doubleDigitGames = (p.history || []).filter(g => (parseFloat(g.total_points) || 0) >= 10).length;
                    const explosivenessPct = seasonGames > 0 ? (doubleDigitGames / seasonGames) * 100 : 0;
                    
                    return {
                        ...p,
                        pos,
                        ptsPerGame,
                        xgiPerGame,
                        xgPerGame,
                        xaPerGame,
                        xgcPerGame,
                        csPerGame,
                        gcPerGame,
                        savesPerGame,
                        actualGI: (p.l5.goals + p.l5.assists) / l5Games,
                        minutesPerGame: p.l5.minutes / l5Games,
                        bonusPerGame: (p.l5.bonus || 0) / l5Games,
                        ownership: p.selectedBy || 0,
                        valueScore: ptsPerGame / p.price,
                        xPts: calculateExpectedPoints(p, pos),
                        actualPts: ptsPerGame,
                        seasonPtsPerGame: p.season.points / seasonGames,
                        reliabilityPct,
                        explosivenessPct,
                        // Estimated touches in box (based on xGI)
                        /* "Est. Touches in Box" used to be here, plotted as the
                           x-axis of the defensive chart below. It was
                           xGI/game × 15 plus a per-position constant — FPL has
                           never published touches, in the box or anywhere else,
                           and there is no such field in bootstrap-static or in
                           any of the gameweek rows. It was xGI wearing another
                           stat's name, so the chart was xGI against xGI with a
                           straight line through it.

                           Defensive contribution is a real published field and
                           the real answer to what that panel was asking. */
                        defConHit: (typeof rtDefConHit === 'function') ? rtDefConHit(p) : null,
                        defCon90: p.defCon90 || 0,
                        // For GK chart
                        totalSaves: p.l5.saves || 0,
                        totalxGC: p.l5.xGC || 0
                    };
                });
            
            chartData.players = validPlayers;

            const html = `
                <div class="charts-section">
                    <!-- The tab's own head, in the shape every other tab on
                         this page uses: title, a line saying what the tab is
                         for, then the control row. The position filters used
                         to be four dotted chips in a bar of their own above
                         the first group, with a small-caps "POSITIONS" label
                         and a bare "Reset" link — three idioms this page uses
                         nowhere else, for a control that does the same job as
                         the pills on Rising Form and Routes to Points. They
                         are those pills now, multi-select as they were, and
                         the reset is the page's own clear-filters button. -->
                    <div class="pa-panel pa-panel-head-only">
                        <div class="pa-panel-head">
                            <span class="pa-panel-title">${paIcon('chart')}Charts</span>
                            <p class="pa-panel-sub">Every player with a game this season, plotted against the players he is competing with. Click a point to open him; click a chart to fill the screen with it.</p>
                            <div class="pa-panel-controls">
                                <div class="pa-filter-pills">
                                    ${['GK', 'DEF', 'MID', 'FWD'].map(pos => `
                                        <button class="pa-filter-pill pos-${pos.toLowerCase()} active" id="chartChip-${pos}" onclick="toggleChartChip('${pos}', this)">${pos}</button>
                                    `).join('')}
                                </div>
                                <div class="v2-filter-row-tail">
                                    <button class="apf-clear" onclick="resetPositionFilters()">Reset</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Original Value & Form Charts -->
                    <div class="chart-category pa-panel">
                        <div class="pa-panel-head">
                            <h3 class="chart-category-title pa-panel-title"><i data-lucide="coins" style="width:18px;height:18px;display:inline-block;vertical-align:middle;"></i> Value & Form Analysis</h3>
                            <p class="pa-panel-sub">What a player costs against what he returns, and what his underlying numbers say he should have returned.</p>
                        </div>
                        <div class="charts-grid">
                            <div class="chart-card" onclick="expandChart('priceVsPoints', 'Price vs Points/Game', 'Above line = Great value | Below = Overpriced')">
                                <div class="chart-expand-hint"><i data-lucide="maximize-2" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> Fullscreen</div>
                                <div class="chart-title"><i data-lucide="coins" style="width:16px;height:16px;display:inline-block;vertical-align:middle;"></i> Price vs Points/Game</div>
                                <div class="chart-subtitle">Above line = Great value | Below = Overpriced</div>
                                <div class="chart-container"><canvas id="priceVsPointsChart"></canvas></div>
                            </div>
                            
                            <div class="chart-card" onclick="expandChart('xgiVsActual', 'xGI vs Actual G+A', 'Below line = Due returns | Above = May regress')">
                                <div class="chart-expand-hint"><i data-lucide="maximize-2" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> Fullscreen</div>
                                <div class="chart-title"><i data-lucide="crosshair" style="width:16px;height:16px;display:inline-block;vertical-align:middle;"></i> xGI vs Actual G+A</div>
                                <div class="chart-subtitle">Below line = Due returns | Above = May regress</div>
                                <div class="chart-container"><canvas id="xgiVsActualChart"></canvas></div>
                            </div>
                            
                            <div class="chart-card" onclick="expandChart('xPtsVsActual', 'Expected vs Actual Points', 'Find lucky/unlucky players based on underlying stats')">
                                <div class="chart-expand-hint"><i data-lucide="maximize-2" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> Fullscreen</div>
                                <div class="chart-title"><i data-lucide="trending-up" style="width:16px;height:16px;display:inline-block;vertical-align:middle;"></i> Expected vs Actual Points</div>
                                <div class="chart-subtitle">Find lucky/unlucky players based on underlying stats</div>
                                <div class="chart-container"><canvas id="xPtsVsActualChart"></canvas></div>
                            </div>
                            
                            <div class="chart-card" onclick="expandChart('formVsSeason', 'L5 Form vs Season Average', 'Above line = Improving | Below = Declining')">
                                <div class="chart-expand-hint"><i data-lucide="maximize-2" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> Fullscreen</div>
                                <div class="chart-title"><i data-lucide="bar-chart-3" style="width:16px;height:16px;display:inline-block;vertical-align:middle;"></i> L5 Form vs Season Average</div>
                                <div class="chart-subtitle">Above line = Improving | Below = Declining</div>
                                <div class="chart-container"><canvas id="formVsSeasonChart"></canvas></div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Defensive Analysis -->
                    <div class="chart-category pa-panel">
                        <div class="pa-panel-head">
                            <h3 class="chart-category-title pa-panel-title"><i data-lucide="shield-check" style="width:18px;height:18px;display:inline-block;vertical-align:middle;"></i> Defensive Analysis</h3>
                            <p class="pa-panel-sub">Clean sheet hunters and the defenders who also threaten at the other end.</p>
                        </div>
                        <div class="charts-grid">
                            <div class="chart-card" onclick="expandChart('xgcVsCS', 'xGC vs Clean Sheets', 'Bottom-Left = Elite | Top-Right = Overperforming (sell)')">
                                <div class="chart-expand-hint"><i data-lucide="maximize-2" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> Fullscreen</div>
                                <div class="chart-title"><i data-lucide="shield" style="width:16px;height:16px;display:inline-block;vertical-align:middle;"></i> xGC vs Clean Sheets</div>
                                <div class="chart-subtitle">Bottom-Left = Elite | Top-Right = Overperforming (sell)</div>
                                <div class="chart-container"><canvas id="xgcVsCSChart"></canvas></div>
                            </div>
                            
                            <div class="chart-card" onclick="expandChart('defAttacking', 'Attacking Defenders (xG vs xA)', 'Top-Right = threat from both sides of the ball')">
                                <div class="chart-expand-hint"><i data-lucide="maximize-2" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> Fullscreen</div>
                                <div class="chart-title"><i data-lucide="swords" style="width:16px;height:16px;display:inline-block;vertical-align:middle;"></i> Attacking Defenders (xG vs xA)</div>
                                <div class="chart-subtitle">Right = scores them, Top = creates them, Top-Right = both</div>
                                <div class="chart-container"><canvas id="defAttackingChart"></canvas></div>
                            </div>

                            <div class="chart-card" onclick="expandChart('defCon', 'Defensive Contribution', 'Right = does the work, Top = actually banks the 2 points')">
                                <div class="chart-expand-hint"><i data-lucide="maximize-2" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> Fullscreen</div>
                                <div class="chart-title"><i data-lucide="shield" style="width:16px;height:16px;display:inline-block;vertical-align:middle;"></i> Defensive Contribution</div>
                                <div class="chart-subtitle">Threshold is a cliff — 10+ actions for a defender, 12+ for a midfielder</div>
                                <div class="chart-container"><canvas id="defConChart"></canvas></div>
                            </div>
                            
                            <div class="chart-card" onclick="expandChart('gkSaves', 'GK: Saves vs xGC', 'Top-Right = Save point magnets (busy keepers)')">
                                <div class="chart-expand-hint"><i data-lucide="maximize-2" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> Fullscreen</div>
                                <div class="chart-title"><i data-lucide="hand" style="width:16px;height:16px;display:inline-block;vertical-align:middle;"></i> GK: Saves vs xGC</div>
                                <div class="chart-subtitle">Top-Right = Save point magnets (busy keepers)</div>
                                <div class="chart-container"><canvas id="gkSavesChart"></canvas></div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Captaincy & Ceiling -->
                    <div class="chart-category pa-panel">
                        <div class="pa-panel-head">
                            <h3 class="chart-category-title pa-panel-title"><i data-lucide="crown" style="width:18px;height:18px;display:inline-block;vertical-align:middle;"></i> Captaincy & Ceiling</h3>
                            <p class="pa-panel-sub">Who has the haul in him — the ceiling that decides an armband, not the average.</p>
                        </div>
                        <div class="charts-grid">
                            <div class="chart-card" onclick="expandChart('reliability', 'Reliability vs Explosiveness', 'Top-Right = PERMACAPTAINS | Top-Left = Ceiling plays')">
                                <div class="chart-expand-hint"><i data-lucide="maximize-2" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> Fullscreen</div>
                                <div class="chart-title"><i data-lucide="crosshair" style="width:16px;height:16px;display:inline-block;vertical-align:middle;"></i> Reliability vs Explosiveness</div>
                                <div class="chart-subtitle">Top-Right = PERMACAPTAINS | Top-Left = Ceiling plays</div>
                                <div class="chart-container"><canvas id="reliabilityChart"></canvas></div>
                            </div>
                            
                            <div class="chart-card" onclick="expandChart('bonusMagnet', 'Bonus Magnets', 'Players who consistently earn bonus points')">
                                <div class="chart-expand-hint"><i data-lucide="maximize-2" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> Fullscreen</div>
                                <div class="chart-title"><i data-lucide="trophy" style="width:16px;height:16px;display:inline-block;vertical-align:middle;"></i> Bonus Magnets</div>
                                <div class="chart-subtitle">Players who consistently earn bonus points</div>
                                <div class="chart-container"><canvas id="bonusMagnetChart"></canvas></div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Differentials & Meta -->
                    <div class="chart-category pa-panel">
                        <div class="pa-panel-head">
                            <h3 class="chart-category-title pa-panel-title"><i data-lucide="gem" style="width:18px;height:18px;display:inline-block;vertical-align:middle;"></i> Differentials & Meta</h3>
                            <p class="pa-panel-sub">Returns the field has not bought yet, and the template picks you are measured against.</p>
                        </div>
                        <div class="charts-grid">
                            <div class="chart-card" onclick="expandChart('ownershipVsForm', 'Ownership vs Form', 'Top-Left = DIFFERENTIALS | Bottom-Right = Template')">
                                <div class="chart-expand-hint"><i data-lucide="maximize-2" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> Fullscreen</div>
                                <div class="chart-title"><i data-lucide="gem" style="width:16px;height:16px;display:inline-block;vertical-align:middle;"></i> Ownership vs Form</div>
                                <div class="chart-subtitle">Top-Left = DIFFERENTIALS | Bottom-Right = Template</div>
                                <div class="chart-container"><canvas id="ownershipVsFormChart"></canvas></div>
                            </div>
                            
                            <div class="chart-card" onclick="expandChart('valueVsOwnership', 'Value vs Ownership', 'Top-Left = Hidden gems | Bottom-Right = Overhyped')">
                                <div class="chart-expand-hint"><i data-lucide="maximize-2" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> Fullscreen</div>
                                <div class="chart-title"><i data-lucide="trending-up" style="width:16px;height:16px;display:inline-block;vertical-align:middle;"></i> Value vs Ownership</div>
                                <div class="chart-subtitle">Top-Left = Hidden gems | Bottom-Right = Overhyped</div>
                                <div class="chart-container"><canvas id="valueVsOwnershipChart"></canvas></div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Position Distribution -->
                    <div class="chart-category pa-panel">
                        <div class="pa-panel-head">
                            <h3 class="chart-category-title pa-panel-title"><i data-lucide="bar-chart-3" style="width:18px;height:18px;display:inline-block;vertical-align:middle;"></i> Position Analysis</h3>
                            <p class="pa-panel-sub">How each position scores its points, so a price is read against the right benchmark.</p>
                        </div>
                        <div class="charts-grid">
                            <div class="chart-card" onclick="expandChart('positionDist', 'Points by Position', 'Where should you invest your budget?')">
                                <div class="chart-expand-hint"><i data-lucide="maximize-2" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> Fullscreen</div>
                                <div class="chart-title"><i data-lucide="trending-up" style="width:16px;height:16px;display:inline-block;vertical-align:middle;"></i> Points by Position</div>
                                <div class="chart-subtitle">Where should you invest your budget?</div>
                                <div class="chart-container"><canvas id="positionDistChart"></canvas></div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            // Create charts after DOM update
            // Built synchronously after the markup is in the DOM. The tab is still
            // hidden at this point so the canvases start at zero, which is what
            // resizeAllCharts() on tab activation exists to correct.
            setTimeout(() => createAllCharts(validPlayers), 0);
            
            return html;
        }
        
        /**
         * Multi-GW xPts — sums fixture-adjusted expected points across the next N gameweeks.
         * Uses per-fixture opponent modifiers for a holistic forward view.
         */
        /* Defensive contribution — the 2025/26 scoring route.

           Same model the squad projection uses, so a player's expected points do
           not depend on which page you are looking at. FPL totals tackles,
           clearances/blocks/interceptions and recoveries and pays a flat 2 points
           past a per-match threshold: 10 for defenders, 12 for midfielders and
           forwards, never for goalkeepers. Thresholds were read off the live
           endpoint's explain blocks rather than assumed. */
        const REC_DC_THRESHOLD = { GK: null, DEF: 10, MID: 12, FWD: 12 };
        const REC_DC_BASELINE_90 = { GK: 0, DEF: 7.5, MID: 8.4, FWD: 4.2 };

        function recDefConPoints(p, pos, minsPerGame) {
            const threshold = REC_DC_THRESHOLD[pos];
            if (!threshold || !minsPerGame) return 0;
            const totalMins = p.l5?.minutes || 0;
            // Regressed toward the position baseline like every other rate here.
            const w = Math.min(1, totalMins / 450);
            const own90 = p.defCon90 || (totalMins > 0 ? ((p.defCon || 0) / totalMins) * 90 : 0);
            const dc90 = w * own90 + (1 - w) * (REC_DC_BASELINE_90[pos] || 0);
            const expected = dc90 * Math.min(1, minsPerGame / 90);
            if (expected <= 0) return 0;
            let pBelow = 0, term = Math.exp(-expected);
            for (let k = 0; k < threshold; k++) { pBelow += term; term *= expected / (k + 1); }
            return Math.max(0, Math.min(1, 1 - pBelow)) * 2;
        }

        function togglePositionFilter(pos) {
            activePositionFilters[pos] = !activePositionFilters[pos];
            updateAllCharts();
        }

        function toggleChartChip(pos, el) {
            activePositionFilters[pos] = !activePositionFilters[pos];
            if (activePositionFilters[pos]) {
                el.classList.add('active');
            } else {
                el.classList.remove('active');
            }
            updateAllCharts();
        }
        
        function resetPositionFilters() {
            ['GK', 'DEF', 'MID', 'FWD'].forEach(pos => {
                activePositionFilters[pos] = true;
                const chip = document.getElementById(`chartChip-${pos}`);
                if (chip) chip.classList.add('active');
            });
            updateAllCharts();
        }
        
        // Charts are created from a rAF right after innerHTML, while the Charts
        // tab is still display:none — Chart.js measures the container at zero and
        // keeps that size until something tells it otherwise.
        function resizeAllCharts() {
            Object.keys(chartInstances).forEach(k => {
                const ch = chartInstances[k];
                if (ch && typeof ch.resize === 'function') { ch.resize(); ch.update('none'); }
            });
        }

        function updateAllCharts() {
            Object.keys(chartInstances).forEach(key => {
                const chart = chartInstances[key];
                if (chart?.data?.datasets) {
                    chart.data.datasets.forEach(ds => {
                        if (ds.position) ds.hidden = !activePositionFilters[ds.position];
                    });
                    chart.update();
                }
            });
        }
        
        function createLastSeasonChart(analyses) {
            const args = [analyses];
            /* Chart.js is fetched on demand now (loadChartJs in common.js), so
               "not defined" is the ordinary first case rather than a failure.
               Ask for it and come back. */
            if (typeof Chart === 'undefined') {
                if (typeof loadChartJs === 'function') loadChartJs().then(ok => { if (ok) createLastSeasonChart(...args); });
                return;
            }
            applyChartDefaults();
            const positionMap = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
            const top = analyses
                .filter(p => p.status === 'a' && (p.lastSeason?.totalPoints || 0) > 0)
                .sort((a, b) => b.lastSeason.totalPoints - a.lastSeason.totalPoints)
                .slice(0, 15);

            const ctx = document.getElementById('lastSeasonPointsChart')?.getContext('2d');
            if (!ctx) return;
            if (chartInstances.lastSeasonPoints) chartInstances.lastSeasonPoints.destroy();

            const ct = getChartTheme();
            chartInstances.lastSeasonPoints = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: top.map(p => p.name),
                    datasets: [{
                        data: top.map(p => p.lastSeason.totalPoints),
                        backgroundColor: top.map(p => POSITION_COLORS[positionMap[p.position]].bg),
                        borderColor: top.map(p => POSITION_COLORS[positionMap[p.position]].border),
                        borderWidth: 1
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: c => `${c.raw} pts (2025/26)`
                            }
                        }
                    },
                    scales: {
                        x: { beginAtZero: true, grid: { color: ct.grid }, ticks: { color: ct.text }, title: { display: true, text: 'Total Points (2025/26)', color: ct.text } },
                        y: { grid: { color: ct.grid }, ticks: { color: ct.text, font: { size: 11 } } }
                    }
                }
            });
        }

        function createAllCharts(players) {
            const args = [players];
            /* Chart.js is fetched on demand now (loadChartJs in common.js), so
               "not defined" is the ordinary first case rather than a failure.
               Ask for it and come back. */
            if (typeof Chart === 'undefined') {
                if (typeof loadChartJs === 'function') loadChartJs().then(ok => { if (ok) createAllCharts(...args); });
                return;
            }
            if (!players || !players.length) {
                const host = document.getElementById('section-CHARTS');
                const grid = host && host.querySelector('.charts-grid, .chart-category');
                if (grid && !host.querySelector('.charts-empty')) {
                    host.insertAdjacentHTML('afterbegin',
                        `<div class="charts-empty no-players season-young">No player has enough minutes yet to place on these charts. `
                        + `They plot per-game rates, so they fill in once players have appearances behind them.</div>`);
                }
                return;
            }
            applyChartDefaults();
            registerScatterPlugins();
            // Axis colours came from hard-coded white, which is invisible against
            // the light theme. getChartTheme() is what the rest of the page uses.
            const ct = getChartTheme();
            const baseOptions = {
                responsive: true,
                maintainAspectRatio: false,
                onHover: (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
                onClick: (evt, els, chart) => {
                    if (!els.length) return;
                    const ds = chart.data.datasets[els[0].datasetIndex];
                    const raw = ds && ds.data[els[0].index];
                    if (raw && raw.id != null && typeof openPlayerModal === 'function') openPlayerModal(raw.id);
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: false,
                        position: 'nearest',
                        external: scatterTooltipHandler
                    }
                },
                scales: {
                    x: { grid: { color: ct.grid }, ticks: { color: ct.text, font: { size: 10 } } },
                    y: { grid: { color: ct.grid }, ticks: { color: ct.text, font: { size: 10 } } }
                }
            };
            
            const createPositionDatasets = (data, xKey, yKey, includeGK = false) => {
                const positions = includeGK ? ['GK', 'DEF', 'MID', 'FWD'] : ['DEF', 'MID', 'FWD'];
                return positions.map(pos => ({
                    label: pos,
                    position: pos,
                    // `...p` last would let any stray x/y on the player object
                    // overwrite the coordinates, and a non-finite value silently
                    // drops the whole dataset, so both are handled explicitly.
                    data: data.filter(p => p.pos === pos).map(p => {
                        const x = parseFloat(typeof xKey === 'function' ? xKey(p) : p[xKey]);
                        const y = parseFloat(typeof yKey === 'function' ? yKey(p) : p[yKey]);
                        return Number.isFinite(x) && Number.isFinite(y) ? { ...p, x, y } : null;
                    }).filter(Boolean),
                    backgroundColor: POSITION_COLORS[pos].bg,
                    borderColor: POSITION_COLORS[pos].border,
                    pointStyle: POSITION_STYLES[pos],
                    pointRadius: cx => (shortlistedPlayerIds.has(cx.raw?.id) ? 8 : 5),
                    pointHoverRadius: cx => (shortlistedPlayerIds.has(cx.raw?.id) ? 12 : 9),
                    pointBorderWidth: cx => (shortlistedPlayerIds.has(cx.raw?.id) ? 2 : 1),
                    hidden: !activePositionFilters[pos]
                }));
            };
            
            // 1. Price vs Points
            const ctx1 = document.getElementById('priceVsPointsChart')?.getContext('2d');
            if (ctx1) {
                chartInstances.priceVsPoints = new Chart(ctx1, {
                    type: 'scatter',
                    data: {
                        datasets: [
                            { label: 'Value Line', data: [{x: 4, y: 2}, {x: 15, y: 8}], type: 'line', borderColor: 'rgba(74, 222, 128, 0.3)', borderWidth: 2, borderDash: [5, 5], pointRadius: 0, fill: false },
                            ...createPositionDatasets(players, 'price', 'ptsPerGame')
                        ]
                    },
                    options: { ...baseOptions, scales: { x: { ...baseOptions.scales.x, title: { display: true, text: 'Price (£m)', color: ct.text } }, y: { ...baseOptions.scales.y, title: { display: true, text: 'Points/Game (L5)', color: ct.text }, min: 0 } } }
                });
            }
            
            // 2. xGI vs Actual
            const ctx2 = document.getElementById('xgiVsActualChart')?.getContext('2d');
            if (ctx2) {
                chartInstances.xgiVsActual = new Chart(ctx2, {
                    type: 'scatter',
                    data: {
                        datasets: [
                            { label: 'Expected Line', data: [{x: 0, y: 0}, {x: 1.2, y: 1.2}], type: 'line', borderColor: 'rgba(74, 222, 128, 0.4)', borderWidth: 2, borderDash: [5, 5], pointRadius: 0, fill: false },
                            ...createPositionDatasets(players, 'xgiPerGame', 'actualGI')
                        ]
                    },
                    options: { ...baseOptions, scales: { x: { ...baseOptions.scales.x, title: { display: true, text: 'xGI per Game', color: ct.text }, min: 0 }, y: { ...baseOptions.scales.y, title: { display: true, text: 'Actual G+A per Game', color: ct.text }, min: 0 } } }
                });
            }
            
            // 3. xPts vs Actual
            const ctx3 = document.getElementById('xPtsVsActualChart')?.getContext('2d');
            if (ctx3) {
                chartInstances.xPtsVsActual = new Chart(ctx3, {
                    type: 'scatter',
                    data: {
                        datasets: [
                            { label: 'Expected Line', data: [{x: 1, y: 1}, {x: 10, y: 10}], type: 'line', borderColor: 'rgba(74, 222, 128, 0.4)', borderWidth: 2, borderDash: [5, 5], pointRadius: 0, fill: false },
                            ...createPositionDatasets(players, 'xPts', 'actualPts', true)
                        ]
                    },
                    options: { ...baseOptions, scales: { x: { ...baseOptions.scales.x, title: { display: true, text: 'Expected Points/Game', color: ct.text }, min: 0 }, y: { ...baseOptions.scales.y, title: { display: true, text: 'Actual Points/Game', color: ct.text }, min: 0 } } }
                });
            }
            
            // 4. Form vs Season
            const ctx4 = document.getElementById('formVsSeasonChart')?.getContext('2d');
            if (ctx4) {
                chartInstances.formVsSeason = new Chart(ctx4, {
                    type: 'scatter',
                    data: {
                        datasets: [
                            { label: 'No Change', data: [{x: 0, y: 0}, {x: 10, y: 10}], type: 'line', borderColor: 'rgba(6, 182, 212, 0.4)', borderWidth: 2, borderDash: [5, 5], pointRadius: 0, fill: false },
                            ...createPositionDatasets(players, 'seasonPtsPerGame', 'ptsPerGame', true)
                        ]
                    },
                    options: { ...baseOptions, scales: { x: { ...baseOptions.scales.x, title: { display: true, text: 'Season Avg Pts/Game', color: ct.text }, min: 0 }, y: { ...baseOptions.scales.y, title: { display: true, text: 'L5 Pts/Game', color: ct.text }, min: 0 } } }
                });
            }
            
            // ============================================
            // DEFENSIVE ANALYSIS CHARTS
            // ============================================
            
            // 5. xGC vs Clean Sheets (DEF + GK only)
            const ctx5 = document.getElementById('xgcVsCSChart')?.getContext('2d');
            if (ctx5) {
                const defGkPlayers = players.filter(p => p.pos === 'GK' || p.pos === 'DEF');
                chartInstances.xgcVsCS = new Chart(ctx5, {
                    type: 'scatter',
                    data: {
                        datasets: [
                            { label: 'Trend', data: [{x: 0, y: 1}, {x: 2, y: 0}], type: 'line', borderColor: 'rgba(52, 211, 153, 0.3)', borderWidth: 2, borderDash: [5, 5], pointRadius: 0, fill: false },
                            ...['GK', 'DEF'].map(pos => ({
                                label: pos,
                                position: pos,
                                data: defGkPlayers.filter(p => p.pos === pos).map(p => ({
                                    x: p.xgcPerGame,
                                    y: p.csPerGame,
                                    ...p
                                })),
                                backgroundColor: POSITION_COLORS[pos].bg,
                                borderColor: POSITION_COLORS[pos].border,
                                pointStyle: POSITION_STYLES[pos],
                                pointRadius: 6,
                                pointHoverRadius: 10,
                                hidden: !activePositionFilters[pos]
                            }))
                        ]
                    },
                    options: { 
                        ...baseOptions, 
                        scales: { 
                            x: { ...baseOptions.scales.x, title: { display: true, text: 'xGC per Game', color: ct.text }, min: 0 }, 
                            y: { ...baseOptions.scales.y, title: { display: true, text: 'CS per Game', color: ct.text }, min: 0, max: 1 } 
                        },
                        plugins: {
                            ...baseOptions.plugins,
                            tooltip: {
                                ...baseOptions.plugins.tooltip,
                                callbacks: {
                                    title: ctx => ctx[0]?.raw ? `${ctx[0].raw.name} (${ctx[0].raw.team})` : '',
                                    label: ctx => {
                                        const p = ctx.raw;
                                        if (!p) return '';
                                        return [
                                            `xGC/G: ${p.xgcPerGame?.toFixed(2)}`,
                                            `CS/G: ${p.csPerGame?.toFixed(2)}`,
                                            `GC/G: ${p.gcPerGame?.toFixed(2)}`,
                                            `Price: £${p.price?.toFixed(1)}m`
                                        ];
                                    }
                                }
                            }
                        }
                    }
                });
            }
            
            /* 6. Attacking defenders — the two halves of xGI, both real.

               The x-axis was "Est. Touches in Box", which was xGI/game × 15 plus
               a per-position constant. FPL publishes no touch data of any kind,
               so this plotted xGI against a rescaling of xGI: a straight line,
               drawn at a 45-degree angle, that could only ever say what the
               y-axis had already said.

               Splitting xGI into its own components is the honest version of the
               same question and a more useful one — a centre-back who scores from
               corners and a wing-back who crosses have the same xGI and are not
               the same asset. */
            const ctx6 = document.getElementById('defAttackingChart')?.getContext('2d');
            if (ctx6) {
                const defPlayers = players.filter(p => p.pos === 'DEF');
                chartInstances.defAttacking = new Chart(ctx6, {
                    type: 'scatter',
                    data: {
                        datasets: [{
                            label: 'DEF',
                            position: 'DEF',
                            data: defPlayers.map(p => ({
                                x: p.xgPerGame,
                                y: p.xaPerGame,
                                ...p
                            })),
                            backgroundColor: POSITION_COLORS['DEF'].bg,
                            borderColor: POSITION_COLORS['DEF'].border,
                            pointStyle: 'rect',
                            pointRadius: 7,
                            pointHoverRadius: 11
                        }]
                    },
                    options: {
                        ...baseOptions,
                        scales: {
                            x: { ...baseOptions.scales.x, title: { display: true, text: 'xG per Match', color: ct.text }, min: 0 },
                            y: { ...baseOptions.scales.y, title: { display: true, text: 'xA per Match', color: ct.text }, min: 0 }
                        },
                        plugins: {
                            ...baseOptions.plugins,
                            tooltip: {
                                ...baseOptions.plugins.tooltip,
                                callbacks: {
                                    title: ctx => ctx[0]?.raw ? `${ctx[0].raw.name} (${ctx[0].raw.team})` : '',
                                    label: ctx => {
                                        const p = ctx.raw;
                                        if (!p) return '';
                                        return [
                                            `xG/Match: ${p.xgPerGame?.toFixed(2)}`,
                                            `xA/Match: ${p.xaPerGame?.toFixed(2)}`,
                                            `xGI/Match: ${p.xgiPerGame?.toFixed(2)}`,
                                            `CS/Match: ${p.csPerGame?.toFixed(2)}`,
                                            `Price: £${p.price?.toFixed(1)}m`
                                        ];
                                    }
                                }
                            }
                        }
                    }
                });
            }

            /* 6b. Defensive contribution — how often the two points actually land.

               Two axes that are genuinely different questions. The x-axis is the
               rate: how much defensive work he gets through per 90. The y-axis is
               what FPL pays for it, which is NOT a rescaling of the same number,
               because the reward is a cliff — ten actions for a defender, twelve
               for a midfielder, and nothing at all below. A man averaging nine
               and a half clears it about half the time; a man averaging fifteen
               clears it every week. Where a dot sits above or below the line its
               per-90 would predict is the whole point of plotting both.

               Only players with at least three appearances are here, because
               below that a hit rate is one match's luck with a denominator. */
            const ctxDC = document.getElementById('defConChart')?.getContext('2d');
            if (ctxDC) {
                const dcSet = pos => ({
                    label: pos,
                    position: pos,
                    data: players.filter(p => p.pos === pos && p.defConHit).map(p => ({
                        x: p.defCon90,
                        y: p.defConHit.rate * 100,
                        ...p
                    })),
                    backgroundColor: POSITION_COLORS[pos].bg,
                    borderColor: POSITION_COLORS[pos].border,
                    pointStyle: pos === 'DEF' ? 'rect' : 'circle',
                    pointRadius: 7,
                    pointHoverRadius: 11
                });
                chartInstances.defCon = new Chart(ctxDC, {
                    type: 'scatter',
                    data: { datasets: [dcSet('DEF'), dcSet('MID')] },
                    options: {
                        ...baseOptions,
                        scales: {
                            x: { ...baseOptions.scales.x, title: { display: true, text: 'Defensive actions per 90', color: ct.text }, min: 0 },
                            y: { ...baseOptions.scales.y, title: { display: true, text: '% of matches that paid the 2 pts', color: ct.text }, min: 0, max: 100 }
                        },
                        plugins: {
                            ...baseOptions.plugins,
                            legend: { display: true, labels: { color: ct.text, usePointStyle: true, boxWidth: 8 } },
                            tooltip: {
                                ...baseOptions.plugins.tooltip,
                                callbacks: {
                                    title: ctx => ctx[0]?.raw ? `${ctx[0].raw.name} (${ctx[0].raw.team})` : '',
                                    label: ctx => {
                                        const p = ctx.raw;
                                        if (!p || !p.defConHit) return '';
                                        const d = p.defConHit;
                                        return [
                                            `Cleared ${d.threshold}+ in ${d.hits} of ${d.n} appearances`,
                                            `Defensive actions/90: ${(p.defCon90 || 0).toFixed(1)}`,
                                            `Worth ${(d.rate * 2).toFixed(1)} pts per match played`,
                                            `Price: £${p.price?.toFixed(1)}m`
                                        ];
                                    }
                                }
                            }
                        }
                    }
                });
            }
            
            // 7. GK Saves vs xGC
            const ctx7 = document.getElementById('gkSavesChart')?.getContext('2d');
            if (ctx7) {
                const gkPlayers = players.filter(p => p.pos === 'GK');
                chartInstances.gkSaves = new Chart(ctx7, {
                    type: 'scatter',
                    data: {
                        datasets: [{
                            label: 'GK',
                            position: 'GK',
                            data: gkPlayers.map(p => ({
                                x: p.totalxGC,
                                y: p.totalSaves,
                                ...p
                            })),
                            backgroundColor: POSITION_COLORS['GK'].bg,
                            borderColor: POSITION_COLORS['GK'].border,
                            pointStyle: 'circle',
                            pointRadius: 8,
                            pointHoverRadius: 12
                        }]
                    },
                    options: { 
                        ...baseOptions, 
                        scales: { 
                            x: { ...baseOptions.scales.x, title: { display: true, text: 'Total xGC (L5)', color: ct.text }, min: 0 }, 
                            y: { ...baseOptions.scales.y, title: { display: true, text: 'Total Saves (L5)', color: ct.text }, min: 0 } 
                        },
                        plugins: {
                            ...baseOptions.plugins,
                            tooltip: {
                                ...baseOptions.plugins.tooltip,
                                callbacks: {
                                    title: ctx => ctx[0]?.raw ? `${ctx[0].raw.name} (${ctx[0].raw.team})` : '',
                                    label: ctx => {
                                        const p = ctx.raw;
                                        if (!p) return '';
                                        return [
                                            `Saves: ${p.totalSaves}`,
                                            `xGC: ${p.totalxGC?.toFixed(1)}`,
                                            `CS: ${p.l5?.cleanSheets || 0}`,
                                            `Saves/G: ${p.savesPerGame?.toFixed(1)}`,
                                            `Price: £${p.price?.toFixed(1)}m`
                                        ];
                                    }
                                }
                            }
                        }
                    }
                });
            }
            
            // ============================================
            // CAPTAINCY & CEILING CHARTS
            // ============================================
            
            // 8. Reliability vs Explosiveness
            const ctx8 = document.getElementById('reliabilityChart')?.getContext('2d');
            if (ctx8) {
                chartInstances.reliability = new Chart(ctx8, {
                    type: 'scatter',
                    data: {
                        datasets: [
                            { label: 'Quadrant', data: [{x: 50, y: 0}, {x: 50, y: 50}], type: 'line', borderColor: 'rgba(245, 158, 11, 0.3)', borderWidth: 2, borderDash: [5, 5], pointRadius: 0, fill: false },
                            { label: 'Quadrant2', data: [{x: 0, y: 15}, {x: 100, y: 15}], type: 'line', borderColor: 'rgba(245, 158, 11, 0.3)', borderWidth: 2, borderDash: [5, 5], pointRadius: 0, fill: false },
                            ...createPositionDatasets(players, 'reliabilityPct', 'explosivenessPct', true)
                        ]
                    },
                    options: { 
                        ...baseOptions, 
                        scales: { 
                            x: { ...baseOptions.scales.x, title: { display: true, text: '% Games with Return (Reliability)', color: ct.text }, min: 0, max: 100 }, 
                            y: { ...baseOptions.scales.y, title: { display: true, text: '% Games with 10+ pts (Explosiveness)', color: ct.text }, min: 0 } 
                        }
                    }
                });
            }
            
            // 9. Bonus Magnets (existing)
            const ctx9 = document.getElementById('bonusMagnetChart')?.getContext('2d');
            if (ctx9) {
                chartInstances.bonusMagnet = new Chart(ctx9, {
                    type: 'scatter',
                    data: { datasets: createPositionDatasets(players, 'ptsPerGame', 'bonusPerGame', true) },
                    options: { ...baseOptions, scales: { x: { ...baseOptions.scales.x, title: { display: true, text: 'Points/Game (L5)', color: ct.text }, min: 0 }, y: { ...baseOptions.scales.y, title: { display: true, text: 'Bonus Points/Game', color: ct.text }, min: 0 } } }
                });
            }
            
            // ============================================
            // DIFFERENTIALS & META CHARTS
            // ============================================
            
            // 10. Ownership vs Form (existing)
            const ctx10 = document.getElementById('ownershipVsFormChart')?.getContext('2d');
            if (ctx10) {
                chartInstances.ownershipVsForm = new Chart(ctx10, {
                    type: 'scatter',
                    data: {
                        datasets: [
                            { label: 'Own Threshold', data: [{x: 10, y: 0}, {x: 10, y: 12}], type: 'line', borderColor: 'rgba(168, 85, 247, 0.3)', borderWidth: 2, borderDash: [5, 5], pointRadius: 0, fill: false },
                            { label: 'Form Threshold', data: [{x: 0, y: 4}, {x: 60, y: 4}], type: 'line', borderColor: 'rgba(168, 85, 247, 0.3)', borderWidth: 2, borderDash: [5, 5], pointRadius: 0, fill: false },
                            ...createPositionDatasets(players, 'ownership', 'ptsPerGame', true)
                        ]
                    },
                    options: { ...baseOptions, scales: { x: { ...baseOptions.scales.x, title: { display: true, text: 'Ownership %', color: ct.text } }, y: { ...baseOptions.scales.y, title: { display: true, text: 'Points/Game (L5)', color: ct.text }, min: 0 } } }
                });
            }
            
            // 11. Value vs Ownership
            const ctx11 = document.getElementById('valueVsOwnershipChart')?.getContext('2d');
            if (ctx11) {
                chartInstances.valueVsOwnership = new Chart(ctx11, {
                    type: 'scatter',
                    data: {
                        datasets: [
                            { label: 'Ownership Line', data: [{x: 0, y: 0.5}, {x: 60, y: 0.5}], type: 'line', borderColor: 'rgba(236, 72, 153, 0.3)', borderWidth: 2, borderDash: [5, 5], pointRadius: 0, fill: false },
                            ...createPositionDatasets(players, 'ownership', 'valueScore', true)
                        ]
                    },
                    options: { 
                        ...baseOptions, 
                        scales: { 
                            x: { ...baseOptions.scales.x, title: { display: true, text: 'Ownership %', color: ct.text } }, 
                            y: { ...baseOptions.scales.y, title: { display: true, text: 'Value (Pts/G ÷ Price)', color: ct.text }, min: 0 } 
                        },
                        plugins: {
                            ...baseOptions.plugins,
                            tooltip: {
                                ...baseOptions.plugins.tooltip,
                                callbacks: {
                                    title: ctx => ctx[0]?.raw ? `${ctx[0].raw.name} (${ctx[0].raw.team})` : '',
                                    label: ctx => {
                                        const p = ctx.raw;
                                        if (!p) return '';
                                        return [
                                            `Value: ${p.valueScore?.toFixed(2)}`,
                                            `Ownership: ${p.ownership?.toFixed(1)}%`,
                                            `Pts/G: ${p.ptsPerGame?.toFixed(1)}`,
                                            `Price: £${p.price?.toFixed(1)}m`
                                        ];
                                    }
                                }
                            }
                        }
                    }
                });
            }
            
            // ============================================
            // POSITION DISTRIBUTION
            // ============================================
            
            // 12. Position Distribution (existing)
            const ctx12 = document.getElementById('positionDistChart')?.getContext('2d');
            if (ctx12) {
                const posStats = ['GK', 'DEF', 'MID', 'FWD'].map(pos => {
                    const pp = players.filter(p => p.pos === pos);
                    const pts = pp.map(p => p.ptsPerGame).sort((a, b) => a - b);
                    return {
                        avg: pts.length ? pts.reduce((a, b) => a + b, 0) / pts.length : 0,
                        max: pts.length ? Math.max(...pts) : 0,
                        top5: pts.length >= 5 ? pts.slice(-5).reduce((a, b) => a + b, 0) / 5 : 0
                    };
                });
                
                chartInstances.positionDist = new Chart(ctx12, {
                    type: 'bar',
                    data: {
                        labels: ['GK', 'DEF', 'MID', 'FWD'],
                        datasets: [
                            { label: 'Average', data: posStats.map(p => p.avg), backgroundColor: 'rgba(255,255,255,0.3)', borderColor: 'rgba(255,255,255,0.5)', borderWidth: 1 },
                            { label: 'Top 5 Avg', data: posStats.map(p => p.top5), backgroundColor: 'rgba(74, 222, 128, 0.6)', borderColor: '#4ade80', borderWidth: 1 },
                            { label: 'Best', data: posStats.map(p => p.max), backgroundColor: 'rgba(251, 191, 36, 0.6)', borderColor: '#fbbf24', borderWidth: 1 }
                        ]
                    },
                    options: { ...baseOptions, plugins: { ...baseOptions.plugins, legend: { display: true, labels: { color: ct.text, font: { size: 10 } } } }, scales: { x: baseOptions.scales.x, y: { ...baseOptions.scales.y, title: { display: true, text: 'Pts/Game (L5)', color: ct.text } } } }
                });
            }
        }

        // ============================================
        // TOXIC LIST (Anti-Recommendations)
        // ============================================
        const TOXIC_OWNERSHIP_THRESHOLD = 15.0;
        const TOXIC_FORM_THRESHOLD = 2.5;
        const TOXIC_FDR_THRESHOLD = 3.5;
        const TOXIC_MAX_PLAYERS = 5;

        function generateToxicList(allPlayers, userSquad = []) {
            const userSquadSet = new Set(userSquad);
            const toxicPlayers = [];

            for (const p of allPlayers) {
                if (p.selectedBy < TOXIC_OWNERSHIP_THRESHOLD) continue;

                const reasons = [];

                // Terrible form
                if (p.form < TOXIC_FORM_THRESHOLD) {
                    reasons.push(`Avg form: ${p.form.toFixed(1)}`);
                }

                // Brutal upcoming fixtures
                if (p.fixtures && p.fixtures.avgFDR3 > TOXIC_FDR_THRESHOLD) {
                    reasons.push(`Brutal next 3 GWs (${p.fixtures.avgFDR3.toFixed(1)})`);
                }

                // Tactically dropped: 0 mins last GW but not injured/suspended
                if (p.history && p.history.length > 0) {
                    const lastGw = p.history[p.history.length - 1];
                    if (lastGw.minutes === 0 && p.status === 'a') {
                        reasons.push('Dropped — 0 mins last GW');
                    }
                }

                if (reasons.length > 0) {
                    toxicPlayers.push({
                        id: p.id,
                        name: p.name,
                        position: p.position,
                        team: p.team,
                        selectedBy: p.selectedBy,
                        form: p.form,
                        reasons,
                        inSquad: userSquadSet.has(p.id)
                    });
                }
            }

            toxicPlayers.sort((a, b) => b.selectedBy - a.selectedBy);
            return toxicPlayers.slice(0, TOXIC_MAX_PLAYERS);
        }

        function renderToxicList(toxicPlayers) {
            if (toxicPlayers.length === 0) {
                return `<div class="toxic-assets-card">
                    <div class="toxic-header">
                        <div class="toxic-header-title">${paIcon('skull')} The Toxic List</div>
                        <div class="toxic-header-subtitle">Highly-owned traps you need to sell.</div>
                    </div>
                    <div class="toxic-empty">
                        <div class="toxic-empty-icon">${paIcon('shield')}</div>
                        <div>All clear — no major ownership traps detected right now.</div>
                    </div>
                </div>`;
            }

            const posClass = { GK: 'gk', DEF: 'def', MID: 'mid', FWD: 'fwd' };
            const rows = toxicPlayers.map((p, i) => {
                /* The red circle each reason used to start with is now a dot
                   the badge draws, so the marker is a colour token rather than
                   a character that renders differently on every platform. */
                const warnings = p.reasons.map(r =>
                    `<span class="toxic-warning-badge"><span class="toxic-dot"></span>${escHTML(r)}</span>`
                ).join('');
                const pc = posClass[p.position] || 'mid';
                return `<div class="toxic-row">
                    <div class="toxic-rank">${i + 1}</div>
                    <div class="toxic-player-info">
                        <div class="toxic-player-name">${escHTML(p.name)}</div>
                        <div class="toxic-player-meta">
                            <span class="player-pos ${pc}">${p.position}</span>
                            <span>${escHTML(p.team)}</span>
                        </div>
                    </div>
                    <span class="badge-toxic">${p.selectedBy.toFixed(1)}% Owned</span>
                    <div class="toxic-warnings">${warnings}</div>
                </div>`;
            }).join('');

            return `<div class="toxic-assets-card">
                <div class="toxic-header">
                    <div class="toxic-header-title">${paIcon('skull')} The Toxic List</div>
                    <div class="toxic-header-subtitle">Highly-owned traps you need to sell.</div>
                </div>
                <div class="toxic-list">${rows}</div>
            </div>`;
        }

        // Triple-click easter egg on page title
        (function initToxicEasterEgg() {
            const title = document.querySelector('.page-title');
            if (!title) return;
            let clickCount = 0;
            let clickTimer = null;
            title.style.cursor = 'default';
            title.addEventListener('click', function () {
                clickCount++;
                if (clickTimer) clearTimeout(clickTimer);
                if (clickCount >= 3) {
                    clickCount = 0;
                    const container = document.getElementById('toxicListContainer');
                    if (container) {
                        const isHidden = container.classList.toggle('toxic-hidden');
                        // Flash title red briefly
                        title.style.transition = 'color 0.2s';
                        title.style.color = isHidden ? '' : '#EF4444';
                        if (!isHidden) {
                            // Re-trigger animation
                            const card = container.querySelector('.toxic-assets-card');
                            if (card) {
                                card.style.animation = 'none';
                                card.offsetHeight; // force reflow
                                card.style.animation = '';
                            }
                        } else {
                            setTimeout(() => { title.style.color = ''; }, 400);
                        }
                    }
                } else {
                    clickTimer = setTimeout(() => { clickCount = 0; }, 600);
                }
            });
        })();

        // ============================================
        // INIT
        // ============================================
        document.addEventListener('DOMContentLoaded', loadData);
    
