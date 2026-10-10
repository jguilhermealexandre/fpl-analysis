/* ============================================
   EasyFPL — Player Explorer: data loading, tabs, shortlist and the recommendation surfaces

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

        // ============================================
        // GLOBALS
        // ============================================

        let bootstrapData = null;
        let bootstrapElements = {}; // id -> bootstrap element (for availability)
        let playerAnalyses = {};
        let teamFixtures = {};
        let teams = {};
        let teamAnalysis = {};
        let fixtureSwingData = {};
        let seasonStats = {};          // per-club W/D/L, goals, CS — xpBuildSeasonStats()
        let playersDetailData = null;  // players-data.json, under the name the profile card reads
        let currentGameweek = null;
        let currentPhase = 'mid';
        let allAnalyses = [];
        let isPreseason = false; // true until the season's first fixture kicks off — see computeIsPreseason() in scripts/common.js
        let currentPosition = 'RECOMMENDATIONS';

        /* ===== The xP engine's context =====

           scripts/xp-engine.js is the site's one projection, and these are the
           globals it documents as its input contract. This page could not reach
           it for a long time and grew a second model instead; these five lines
           are what that cost.

           teamAnalysis is already built above by this page's own computeTeamScores
           and carries every field the engine reads — attackPower, defensePower,
           their home/away splits and avgConceded. The one field it names
           differently, matchesPlayed, is read only inside the bookmaker-odds
           branch, which is inert here because odds-panel.js is a squad-page
           script. So the projection is the full model, not a degraded one.

           xpPlayersById is the engine-shaped twin of a player, keyed by id. The
           page's own objects nest their season figures and the engine reads them
           flat, so a lookup is cheaper and safer than reshaping either side. */
        let currentGW = 1;
        let allFixtures = [];
        let teamFixtures6 = {};
        let positionAverages = {};
        let xpPlayersById = {};
        let paRunGWs = [];

        /* This page's projection: the shared engine, over the same five-gameweek
           run the transfer recommender decides on.

           Returns null rather than 0 for a player it cannot price at all — one
           with no bootstrap twin, or a run with no fixtures left in it. The cards
           read null as "not enough on record yet" and show a dash, where a 0 would
           read as a confident forecast of nothing.

           It no longer refuses a player for having under 30 minutes, which the
           model this replaced did. That gate existed because the old model could
           not handle a thin sample; regressing rates toward a position baseline
           until the evidence arrives is the first thing the engine does, so the
           number it gives for a fringe player is a real estimate rather than a
           rate wearing one match's clothing. More cards will show a figure. */
        function paXP5(p) {
            const native = xpPlayersById[p && p.id];
            if (!native || !paRunGWs.length) return null;
            return xpOver(native, paRunGWs);
        }

        // Shortlist state (persisted to localStorage)
        let shortlistedPlayerIds = new Set(JSON.parse(localStorage.getItem('fpl_shortlist') || '[]'));

        function saveShortlist() {
            localStorage.setItem('fpl_shortlist', JSON.stringify([...shortlistedPlayerIds]));
            updateShortlistBadge();
        }

        function updateShortlistBadge() {
            // Update the shortlist filter pill badge in the All Players table
            const pill = document.getElementById('shortlistPill-ALL');
            if (pill) {
                const count = shortlistedPlayerIds.size;
                pill.innerHTML = `<span class="dot"></span> <i data-lucide="star" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> Shortlisted${count > 0 ? ' (' + count + ')' : ''}`;
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }
        }

        function toggleShortlist(playerId, event) {
            if (event) { event.stopPropagation(); event.preventDefault(); }
            if (shortlistedPlayerIds.has(playerId)) {
                shortlistedPlayerIds.delete(playerId);
            } else {
                shortlistedPlayerIds.add(playerId);
            }
            saveShortlist();
            // Update all star icons on the page
            document.querySelectorAll(`.shortlist-star[data-player-id="${playerId}"]`).forEach(el => {
                el.classList.toggle('shortlisted', shortlistedPlayerIds.has(playerId));
            });
            // Re-render the All Players table if shortlist filter is active
            if (currentPosition === 'ALL' && tableState.ALL?.filters?.shortlist) {
                refreshTable('ALL');
            }
            updateShortlistBadge();
        }

        function getStarHtml(playerId, extraClass = '') {
            const active = shortlistedPlayerIds.has(playerId) ? 'shortlisted' : '';
            return `<span class="shortlist-star ${active} ${extraClass}" data-player-id="${playerId}" onclick="toggleShortlist(${playerId}, event)" title="Toggle shortlist"><i data-lucide="star" style="width:14px;height:14px;"></i></span>`;
        }

        // Clean stale shortlist IDs on load
        function cleanStaleShortlist() {
            const validIds = new Set(allAnalyses.map(p => p.id));
            let staleRemoved = false;
            shortlistedPlayerIds.forEach(id => {
                if (!validIds.has(id)) { shortlistedPlayerIds.delete(id); staleRemoved = true; }
            });
            if (staleRemoved) saveShortlist();
        }

        // Global filter state
        let globalFilters = {
            availability: true,  // Improvement #4: Default ON — hide injured/suspended (<75% chance)
            starters: false      // Hide players <45 min/game (L5)
        };

        // ============================================
        // TAB NAVIGATION
        // ============================================
        // Hash-to-tab mapping
        const HASH_TO_TAB = {
            'recommendations': 'RECOMMENDATIONS',
            'rising': 'RISING',
            'purple-patch': 'PURPLE_PATCH',
            'charts': 'CHARTS',
            'routes': 'ROUTES',
            'all': 'ALL'
        };
        const TAB_TO_HASH = Object.fromEntries(Object.entries(HASH_TO_TAB).map(([k,v]) => [v,k]));

        function activateTab(tab) {
            document.querySelectorAll('.tabs-container .tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            const pos = tab.dataset.position;
            currentPosition = pos;
            
            document.querySelectorAll('.position-section').forEach(s => s.classList.remove('active'));
            document.getElementById(`section-${pos}`)?.classList.add('active');

            // ALL tab's table breaks out to full-bleed width (see <style> block for why)
            /* No full-bleed switch any more — every tab is the same width. */

            // Give the charts their real dimensions the moment the tab is shown.
            // Deliberately not deferred through requestAnimationFrame: rAF can be
            // throttled to never firing for work scheduled around a just-revealed
            // element, which leaves the canvas stuck at the 0x0 it was built with.
            // The synchronous call forces the layout we need; the timeout covers
            // fonts and scrollbars settling afterwards.
            if (pos === 'CHARTS') { resizeAllCharts(); setTimeout(resizeAllCharts, 80); }

            // Update page subtitle with tab description
            const desc = tab.dataset.desc;
            const subtitleEl = document.getElementById('pageSubtitle');
            if (subtitleEl && desc) {
                subtitleEl.textContent = desc;
            }

            // Show/hide position pills based on tab
            const posPills = document.getElementById('posPills');
            const filterBar = document.getElementById('filterBar');
            if (posPills) {
                const hasPos = tab.dataset.hasPos === 'true';
                /* Routes used to override this, hiding the pills whenever its
                   squad-shaped default view was showing. That view is gone and
                   the tab is one ranked list, so the pills apply there like
                   everywhere else. */
                posPills.classList.toggle('hidden', !hasPos);
                /* The bar itself is retired and permanently hidden — see the
                   comment on #filterBar. Nothing to show or hide here. */
                void filterBar;
            }

            // Show/hide category pills (only on Recommendations, Rising, Purple Patch)
            const catPills = document.getElementById('catPills');
            const catDivider = document.getElementById('catDivider');
            const showCats = ['RECOMMENDATIONS', 'RISING', 'PURPLE_PATCH'].includes(pos);
            if (catPills) catPills.style.display = showCats ? '' : 'none';
            if (catDivider) catDivider.style.display = showCats ? '' : 'none';

            /* pushState, not replace: six tabs sharing one history entry meant
               Back from All Players left the page rather than returning to the
               tab you came from. activateTab is also called by the popstate
               handler below, which must NOT push again — hence the flag. */
            const hash = TAB_TO_HASH[pos];
            if (hash && hash !== window.location.hash.replace('#', '')) {
                if (paRestoringHistory) history.replaceState(null, '', '#' + hash);
                else history.pushState(null, '', '#' + hash);
            }
        }

        /* True only while we are re-applying a tab the browser navigated to,
           so restoring a state does not create a new one. */
        let paRestoringHistory = false;

        window.addEventListener('popstate', () => {
            const tabPos = HASH_TO_TAB[window.location.hash.replace('#', '')] || 'RECOMMENDATIONS';
            const tab = document.querySelector(`.tabs-container .tab[data-position="${tabPos}"]`);
            if (!tab || tab.classList.contains('active')) return;
            paRestoringHistory = true;
            try { activateTab(tab); } finally { paRestoringHistory = false; }
        });

        document.querySelectorAll('.tabs-container .tab').forEach(tab => {
            tab.addEventListener('click', () => activateTab(tab));
        });

        // Activate tab from URL hash on load
        (function() {
            const hash = window.location.hash.replace('#', '');
            const tabPos = HASH_TO_TAB[hash];
            if (tabPos) {
                const tab = document.querySelector(`.tabs-container .tab[data-position="${tabPos}"]`);
                if (tab) activateTab(tab);
            }
        })();

        // ============================================
        // LOADING
        // ============================================
        function showLoading(show) {
            document.getElementById('loadingOverlay').classList.toggle('show', show);
        }
        function updateStatus(msg, type) { console.log(msg); }
        function showCacheInfo() {}

        // ============================================
        // DATA LOADING
        // ============================================
        async function loadData() {
            try {
                showLoading(true);
                
                const [staticData, fixturesData, bootData] = await Promise.all([
                    DataCache.fetchJSON(DATA_URLS.players),
                    DataCache.fetchJSON(DATA_URLS.fixtures).catch(() => []),
                    DataCache.fetchJSON(DATA_URLS.bootstrap).catch(() => null)
                ]);

                if (staticData?.metadata?.lastUpdated && window.updateDataFreshness) window.updateDataFreshness(staticData.metadata.lastUpdated);

                /* Both of these were locals the page kept to itself, and both are
                   read by the shared player profile card (scripts/player-profile.js):
                   playersDetailData for a player's per-gameweek history and last
                   season's totals, bootstrapData for the event list the fixture
                   swing window opens on. Same objects, published under the names
                   the squad page already uses for them. */
                bootstrapData = bootData;
                playersDetailData = staticData;

                // Load bootstrap data for availability info
                if (bootData && bootData.elements) {
                    try {
                        bootData.elements.forEach(el => {
                            bootstrapElements[el.id] = {
                                status: el.status,
                                news: el.news || '',
                                chanceNextRound: el.chance_of_playing_next_round
                            };
                        });
                    } catch (e) {
                        console.warn('Could not parse bootstrap-static.json for availability data:', e);
                    }
                }

                // Build teams
                staticData.teams.forEach(team => {
                    teams[team.id] = {
                        id: team.id,
                        name: team.name,
                        short_name: team.short_name,
                        code: team.code,
                        strength: team.strength
                    };
                });

                // Process fixtures
                processFixtures(fixturesData);

                // Build per-team xG data from player histories
                buildTeamXgData(staticData, fixturesData);

                // Compute team-level scores (attack, defense, form, fixtures) — 3-component xG model
                /* One implementation, in scripts/xp-engine.js. This page used to
                   carry its own, blending xG into attack and defence — measured
                   against the shared one over a season and equivalent, so the
                   cheaper model won. See xpBuildTeamScores. */
                teamAnalysis = xpBuildTeamScores(staticData.teams, fixturesData);

                isPreseason = computeIsPreseason(bootData, fixturesData);

                /* Satisfy the xP engine's contract — see the declarations above.
                   Ordered deliberately: currentGW feeds the position baselines,
                   and teamFixtures6 has to exist before the players are built,
                   because it is what gives each one the opponentId the opponent
                   model reads. Handing it this page's own teamFixtures instead
                   would look fine and quietly degrade every projection to an
                   FDR-only estimate — the same trap compare-report.js documents. */
                const currEvent = (bootData?.events || []).find(e => e.is_current);
                currentGW = currEvent ? currEvent.id : 1;
                allFixtures = fixturesData || [];
                teamFixtures6 = xpBuildTeamFixtures(fixturesData, teams, 8);
                const xpPlayers = xpBuildPlayers(bootData?.elements, teams, teamFixtures6);
                positionAverages = xpBuildPositionAverages(xpPlayers, currentGW);
                xpPlayersById = {};
                xpPlayers.forEach(p => { xpPlayersById[p.id] = p; });
                // Computed once per load: xpPlanGWs re-filters the whole fixture
                // list, and the recommendation tabs ask for the run per player.
                paRunGWs = xpPlanGWs(5);

                // Build a history lookup from players-data.json (current-season per-GW logs, may be empty pre-season)
                const historyById = {};
                (staticData.players || []).forEach(p => { historyById[p.id] = p.history || []; });

                // Process players — source the roster from bootstrap (always complete, 568 players)
                // and merge in current-season history by id when available. This keeps the page
                // working immediately even if players-data.json hasn't caught up yet.
                const analyses = [];
                for (const player of (bootData?.elements || [])) {
                    const history = historyById[player.id] || [];
                    /* One window engine, shared with the profile card — see
                       buildStatWindows() in scripts/compare-report.js. It needs
                       the club and the fixture list, because which five
                       gameweeks "L5" means is a question about the fixtures, not
                       about how many rows this player happens to have. */
                    const windows = buildStatWindows({ id: player.id, teamId: player.team },
                        history, { fixtures: fixturesData, teams });
                    const season = windows.season;
                    const l5 = windows.recent;

                    const playerFixtures = teamFixtures[player.team] || [];
                    let fixtureData = null;

                    if (playerFixtures.length > 0) {
                        const next3 = playerFixtures.slice(0, 3);
                        const next5 = playerFixtures.slice(0, 5);
                        const avgFDR3 = next3.reduce((s, f) => s + f.difficulty, 0) / next3.length;
                        const avgFDR5 = next5.reduce((s, f) => s + f.difficulty, 0) / next5.length;

                        fixtureData = {
                            avgFDR3, avgFDR5, next3, next5,
                            fixtureString: next3.map(f => `${teams[f.opponent]?.short_name || '???'}(${f.isHome ? 'H' : 'A'})`).join(', ')
                        };
                    }

                    // Last season's cumulative stats — still sitting in bootstrap-static.json's
                    // season-total fields until FPL rolls them over for the new season.
                    const lastSeason = {
                        totalPoints: player.total_points || 0,
                        minutes: player.minutes || 0,
                        goals: player.goals_scored || 0,
                        assists: player.assists || 0,
                        cleanSheets: player.clean_sheets || 0,
                        goalsConceded: player.goals_conceded || 0,
                        saves: player.saves || 0,
                        bonus: player.bonus || 0,
                        bps: player.bps || 0,
                        xG: parseFloat(player.expected_goals) || 0,
                        xA: parseFloat(player.expected_assists) || 0,
                        xGI: parseFloat(player.expected_goal_involvements) || 0,
                        ictIndex: parseFloat(player.ict_index) || 0,
                        starts: player.starts || 0
                    };

                    analyses.push({
                        id: player.id,
                        // The photo code, not the element id — playerPhotoSrc()
                        // addresses portraits by it, so v2IdentityHTML() renders
                        // initials for everyone without it.
                        code: player.code,
                        name: player.web_name,
                        fullName: `${player.first_name} ${player.second_name}`,
                        position: player.element_type,
                        team: teams[player.team]?.short_name || '???',
                        teamId: player.team,
                        teamCode: teams[player.team]?.code,
                        price: player.now_cost / 10,
                        form: parseFloat(player.form) || 0,
                        selectedBy: parseFloat(player.selected_by_percent) || 0,
                        totalPoints: player.total_points,
                        season, l5, fixtures: fixtureData,
                        // The window object behind l5, kept so the scouting
                        // report and the profile card share one computation
                        // rather than each building the same five columns.
                        formWindow: windows.window,
                        history,
                        lastSeason,
                        // Availability fields
                        status: player.status || 'a',
                        news: player.news || '',
                        chanceNextRound: player.chance_of_playing_next_round,
                        // Market movement — drives the buy-now / wait signal on rec cards
                        transfersIn: player.transfers_in_event || 0,
                        transfersOut: player.transfers_out_event || 0,
                        costChangeEvent: (player.cost_change_event || 0) / 10,
                        // Published by FPL rather than inferred. 1 = first choice.
                        penaltiesOrder: player.penalties_order || null,
                        cornersOrder: player.corners_and_indirect_freekicks_order || null,
                        freekicksOrder: player.direct_freekicks_order || null,
                        defCon: player.defensive_contribution || 0,
                        defCon90: parseFloat(player.defensive_contribution_per_90) || 0,
                        // Team-level scores
                        teamScores: teamAnalysis[player.team] || null
                    });
                }

                // Preseason: the "All Players" table (createTable) filters on l5.games >= 1 and
                // reads a wide set of l5/season fields. Rather than rewrite its ~40 columns, feed it
                // a last-season-shaped stand-in so the existing table code works unchanged — both
                // "L5" and "Season" columns will show identical last-season totals during preseason,
                // which the season-notice banner above the table explains.
                if (isPreseason) {
                    analyses.forEach(p => { p.season = p.l5 = lastSeasonAsStatsShape(p.lastSeason); });
                }

                allAnalyses = analyses;
                computeSeasonGamesAvailable(analyses);
                currentGameweek = detectCurrentGameweek(analyses);
                currentPhase = getSeasonPhase(currentGameweek);

                // Build fixture swing data (needs currentGameweek)
                buildFixtureSwingData(staticData.teams, fixturesData);
                // Season-to-date results per club, for the profile card's team block.
                seasonStats = xpBuildSeasonStats(staticData.teams, fixturesData);

                // Pre-compute Rising Form and Routes data for cross-wiring into recommendations
                precomputeRisingFormScores(analyses);
                precomputeRoutesData(analyses);
                precomputePurplePatchScores(analyses);

                // Render (recommendations uses rising form + routes data)
                document.getElementById('section-RECOMMENDATIONS').innerHTML = generateRecommendations(analyses);
                document.getElementById('section-CHARTS').innerHTML = generateCharts(analyses);
                document.getElementById('section-RISING').innerHTML = generateRisingForm(analyses);
                document.getElementById('section-PURPLE_PATCH').innerHTML = generatePurplePatch(analyses);
                document.getElementById('section-ROUTES').innerHTML = generateRoutesToPoints(analyses);
                document.getElementById('section-ALL').innerHTML =
                    (isPreseason ? renderSeasonNotice('Showing 2025/26 season totals in the L5 &amp; Season columns — this season’s per-gameweek data isn’t available until GW1.') : '')
                    + createTable('ALL', analyses);

                // Toxic List (hidden by default — revealed via triple-click easter egg)
                const toxicPlayers = generateToxicList(allAnalyses);
                const toxicHtml = `<div id="toxicListContainer" class="toxic-hidden">${renderToxicList(toxicPlayers)}</div>`;
                document.getElementById('section-RECOMMENDATIONS').insertAdjacentHTML('beforeend', toxicHtml);

                // Initialize Lucide icons in dynamically rendered content
                if (typeof lucide !== 'undefined') lucide.createIcons();

                // Clean stale shortlist IDs and update badge
                cleanStaleShortlist();
                updateShortlistBadge();

                showLoading(false);

                /* A link someone was sent with ?player= on it. Last, because it
                   needs the analyses above to look the id up in — a link naming
                   a player this page does not hold does nothing and cleans
                   itself off the URL. */
                if (typeof pdmOpenFromUrl === 'function') pdmOpenFromUrl();
            } catch (error) {
                console.error('Error:', error);
                showLoading(false);
                document.getElementById('section-RECOMMENDATIONS').innerHTML = renderErrorState(
                    'Failed to load player data',
                    'Check your connection and try again.',
                    'loadData'
                );
                initIcons();
            } finally {
                /* Was inside the catch, so the footer only ever rendered on the
                   error path — a successful load left the page with no footer
                   at all. It belongs on both. */
                loadFooter();
            }
        }

        function processFixtures(fixtures) {
            // fixturePlayed(), not !f.finished — see scripts/common.js. This list
            // is every "next N fixtures" on the page: the rec cards' fixture
            // chips, avgFDR3/5, the multi-gameweek xP window and the venue
            // adjustment. Reading the slow flag left a round that had already
            // been played sitting at the front of it, so the venue split was
            // being taken from a match the player had just finished.
            const upcoming = fixtures.filter(f => !fixturePlayed(f) && f.event);
            upcoming.forEach(f => {
                if (!teamFixtures[f.team_h]) teamFixtures[f.team_h] = [];
                teamFixtures[f.team_h].push({ opponent: f.team_a, isHome: true, difficulty: f.team_h_difficulty, event: f.event });
                
                if (!teamFixtures[f.team_a]) teamFixtures[f.team_a] = [];
                teamFixtures[f.team_a].push({ opponent: f.team_h, isHome: false, difficulty: f.team_a_difficulty, event: f.event });
            });
            Object.keys(teamFixtures).forEach(id => teamFixtures[id].sort((a, b) => a.event - b.event));
        }

        // ============================================
        // xG DATA BUILDER (from players-data.json)
        // ============================================




        // ============================================
        // CLEAN SHEET PROBABILITY MODEL (from transfer-wizard)
        // ============================================
        function getCleanSheetProb(teamId, opponentId, isHome) {
            const tp = teamAnalysis[teamId], op = teamAnalysis[opponentId];
            if (!tp || !op) return 0.25;
            let base = isHome ? 0.35 : 0.25;
            // Use venue-adjusted power when available
            const teamDef = isHome ? (tp.defensePowerHome || tp.defensePower) : (tp.defensePowerAway || tp.defensePower);
            const oppAtk = isHome ? (op.attackPowerAway || op.attackPower) : (op.attackPowerHome || op.attackPower);
            base += (teamDef - 50) * 0.003;
            base -= (oppAtk - 50) * 0.0025;
            base += (1.3 - tp.avgConceded) * 0.06;
            return Math.max(0.05, Math.min(0.65, base));
        }

        // ============================================
        // FIXTURE SWING DETECTION (from teams-analysis)
        // ============================================
        /* One implementation, in scripts/xp-engine.js — see xpBuildFixtureSwings.
           The copy that lived here emitted only the two averages, so the swing
           could say "3.7 → 2.7" and not which opponents either number was made
           of; the squad page's copy carried that breakdown and this one did not.
           The window opens on the round being planned rather than the current
           one, for the reason planningGameweek() in scripts/common.js documents. */
        function buildFixtureSwingData(bootTeams, fixturesData) {
            fixtureSwingData = xpBuildFixtureSwings(bootTeams, fixturesData,
                planningGameweek({ events: bootstrapData?.events }, fixturesData));
            console.log('Fixture swings computed:', Object.keys(fixtureSwingData).length, 'teams with swings');
        }

        // ============================================
        // TEAM ANALYSIS SCORES (3-component xG model)
        // ============================================

        // Wraps a player's lastSeason cumulative totals in the same shape
        // buildStatWindows() returns, so preseason code paths that expect a
        // season/l5 object (e.g. the All Players table) can consume last-season
        // data without any changes of their own. `starts` is the closest thing
        // bootstrap carries to an appearance count; games stays 1 because these
        // are cumulative totals with no per-match denominator to divide by.
        function lastSeasonAsStatsShape(lastSeason) {
            const ls = lastSeason || {};
            return {
                games: 1,
                appearances: ls.starts || 0,
                minutes: ls.minutes || 0,
                points: ls.totalPoints || 0,
                goals: ls.goals || 0,
                assists: ls.assists || 0,
                cleanSheets: ls.cleanSheets || 0,
                goalsConceded: ls.goalsConceded || 0,
                saves: ls.saves || 0,
                bonus: ls.bonus || 0,
                bps: ls.bps || 0,
                xG: ls.xG || 0,
                xA: ls.xA || 0,
                xGI: ls.xGI || 0,
                xGC: 0,
                penaltiesSaved: 0,
                penaltiesMissed: 0,
                ict: ls.ictIndex || 0,
                influence: 0,
                creativity: 0,
                threat: 0,
                homeSplit: null,
                awaySplit: null
            };
        }

        function detectCurrentGameweek(analyses) {
            const maxGames = Math.max(...analyses.map(a => a.season?.games || 0));
            return Math.min(38, Math.max(1, maxGames));
        }

        function getSeasonPhase(gw) {
            if (gw <= 10) return 'early';
            if (gw >= 30) return 'late';
            return 'mid';
        }

        // ============================================
        // SHARED ELIGIBILITY LOGIC (Task 3)
        // ============================================
        /**
         * Central eligibility check for player recommendations/captaincy.
         * @param {Object} p - Player analysis object
         * @param {Object} opts - Options to override thresholds
         * @param {boolean} opts.checkAvailability - Enforce availability filter (status + chance >= 75%)
         * @param {boolean} opts.checkStarters - Enforce regular starter filter (>= 45 min/game L5)
         * @param {number} opts.minGames - Minimum L5 games played (default: 3)
         * @returns {boolean}
         */
        // Most games any player has on record. The three-game minimum below is a
        // quality bar, not a rule of the game, and early in a season nobody can
        // meet it — so it is clamped to what the season has actually produced.
        let seasonGamesAvailable = 0;

        // Games on record across the whole season, used to tell "nobody qualifies"
        // apart from "the season is too young for this question".
        let seasonGamesPlayed = 0;

        function computeSeasonGamesAvailable(analyses) {
            seasonGamesAvailable = (analyses || []).reduce((max, a) => Math.max(max, a.l5?.games || 0), 0);
            seasonGamesPlayed = (analyses || []).reduce((max, a) => Math.max(max, a.season?.games || 0), 0);
            return seasonGamesAvailable;
        }

        // Rising Form and Purple Patch both measure a player against their own
        // season baseline, so neither can say anything until that baseline exists.
        // Reporting "no players found" implies we looked; this says we cannot look
        // yet, and when we will be able to.
        /* ===== Demo preview of the two sections the season is too young for =====

           Rising Form and Purple Patch both read a recent window against a season
           baseline, so neither can say anything until there is enough season to be
           a baseline: Rising Form fills in around GW6, Purple Patch around GW9.
           That is the right answer for a manager and a useless one for showing
           somebody what this page does in September.

           In demo mode the thresholds scale to the season that exists rather than
           being fixed. Nothing is invented — the same maths runs over the same real
           history, on a shorter run of it — and each section says so above the
           cards, because a hot streak measured over three games is a weaker claim
           than one measured over ten and must not be presented as the same thing. */
        function demoPreview() {
            return typeof isDemoMode === 'function' && isDemoMode() && seasonGamesPlayed > 0;
        }

        /* The recent window a streak is measured over, when the season is shorter
           than the window itself.

           This is the part relaxing the game thresholds alone does not fix. Purple
           Patch asks whether the last five games beat the player's own season
           average; at GW3 the last five games ARE the season, so the two numbers
           are the same number and the uplift test can never pass. What survives is
           the absolute-elite branch, which is just "who has the most points" in a
           purple costume. Shortening the recent window below the baseline gives the
           comparison two different things to compare again. */
        function demoRecentWindow() {
            return Math.max(2, Math.min(5, seasonGamesPlayed - 1));
        }

        /* Points per game over the window a streak is actually measured on.

           Both sections ask the same question — is this player scoring above his
           own season average? — and both express it as recent PPG against season
           PPG. Rising Form wants recent 15% clear, Purple Patch wants 35%. Neither
           can be true while the recent window still covers the whole season,
           because the two averages are then arithmetically the same number. This
           is the one place that fact is handled, so relaxing a game threshold
           somewhere else can never quietly reintroduce it. */
        // How short a run this preview is working from, said plainly, once.
        function demoPreviewNotice(label, normalFrom) {
            if (!demoPreview()) return '';
            return renderSeasonNotice(
                `<strong>Demo preview.</strong> ${escHTML(label)} normally needs about ${normalFrom} gameweeks of history `
                + `and there ${seasonGamesPlayed === 1 ? 'is' : 'are'} ${seasonGamesPlayed} so far, so it would be empty for `
                + `everyone else until around GW${normalFrom + 1}. The thresholds below are scaled to the season played `
                + `so far. These are real numbers over a very short run — read them as a demonstration of the section, `
                + `not as a verdict on a player.`);
        }

        function seasonTooYoungNotice(requiredSeasonGames, label, explanation) {
            // In a demo the thresholds have already been scaled down, so "needs more
            // of the season" would be describing a rule that is not being applied.
            // An empty position there really is an empty position.
            if (demoPreview()) return null;
            if (seasonGamesPlayed >= requiredSeasonGames) return null;
            const played = seasonGamesPlayed;
            return `<div class="no-players season-young">
                <strong>${escHTML(label)} needs more of the season played.</strong><br>
                ${escHTML(explanation)}
                It needs ${requiredSeasonGames} gameweeks of history and there ${played === 1 ? 'is' : 'are'} ${played} so far,
                so this fills in from around GW${requiredSeasonGames + 1}.
            </div>`;
        }

        function isPlayerEligible(p, opts = {}) {
            const checkAvailability = opts.checkAvailability ?? globalFilters.availability;
            const checkStarters = opts.checkStarters ?? globalFilters.starters;
            // Never ask for more games than exist. At three gameweeks and beyond
            // this is the usual 3 and nothing changes; before that it relaxes to
            // however many have been played, instead of rejecting the entire league
            // and rendering "No players found" in every section on the page.
            const requested = opts.minGames ?? 3;
            const minGames = Math.min(requested, Math.max(seasonGamesAvailable, 1));

            // Must have minimum games
            if ((p.l5?.games || 0) < minGames) return false;

            // Availability filter: exclude injured/suspended/unavailable
            if (checkAvailability) {
                const suspendedOrOut = ['s', 'u', 'n'].includes(p.status);
                if (suspendedOrOut) return false;

                // chance_of_playing_next_round: null means "no news" (treat as available)
                // 0 = will not play, 25 = 25% chance, 50, 75, 100
                const chance = p.chanceNextRound;
                if (chance !== null && chance !== undefined && chance < 75) return false;
            }

            // Regular starters filter: average >= 45 mins/game in L5
            if (checkStarters) {
                const minsPerGame = (p.l5?.minutes || 0) / (p.l5?.games || 1);
                if (minsPerGame < 45) return false;
            }

            return true;
        }

        // (Global filter toggles removed — filters were taking up space without enough utility)

        // ============================================
        // PRE-COMPUTE DATA FOR CROSS-WIRING INTO RECOMMENDATIONS
        // ============================================

        /**
         * Pre-computes rising form scores for all players and stores in window._risingFormScores.
         * This allows calculatePositionScore to reward players with rising momentum.
         */
        /* One engine — risingFormScores() in scripts/form-trend.js.

           This was the only copy, and it lived here, so on Squad Analysis the
           scouting report's rising-form rows were empty for every player. Its
           gates were also silent: six season matches before it says anything,
           which four gameweeks in is every player in the game, and it returned
           early with no record of why — so window._risingFormScores was an empty
           object and every Rising Form Score in the report read 0. */
        function precomputeRisingFormScores(analyses) {
            const rf = risingFormScores(analyses);
            window._risingFormScores = rf.scores;
            // Why the map is empty, for the section that has to render nothing.
            window._risingFormNote = rf.note;
        }

        /**
         * Pre-computes routes-to-points data for all players and stores in window._routesData.
         * This allows calculatePositionScore to reward players with multiple reliable routes.
         */
        /* Route counts for cross-wiring into the recommendation cards.

           This was a third copy of the route rules — its own thresholds, its own
           weights, no defensive contribution, and Creativity counted as a route
           that pays points. routesFor() in scripts/routes-engine.js is the only
           place any of that is decided now. */
        function precomputeRoutesData(analyses) {
            window._routesData = {};
            analyses.filter(p => isPlayerEligible(p, { minGames: 3 })).forEach(p => {
                const rt = routesFor(p);
                if (rt.routeCount >= 2) {
                    window._routesData[p.id] = {
                        routeCount: rt.routeCount, compositeScore: rt.compositeScore
                    };
                }
            });
        }

        // ============================================
        // ROUTES TO POINTS
        // ============================================
        // Per-game rates a player of this position produces on average. Thin
        // samples get regressed toward these so one good afternoon does not read
        // as a season-long rate. Shared by the recommendations xP model and the
        // routes point-source breakdown so the two never disagree.
        const POS_RATE_BASELINE = {
            GK:  { xG: 0.00, xA: 0.01, cs: 0.28, bonus: 0.25, saves: 2.80, gc: 1.35 },
            DEF: { xG: 0.03, xA: 0.04, cs: 0.28, bonus: 0.20, saves: 0.00, gc: 1.35 },
            MID: { xG: 0.08, xA: 0.09, cs: 0.28, bonus: 0.25, saves: 0.00, gc: 1.35 },
            FWD: { xG: 0.15, xA: 0.07, cs: 0.00, bonus: 0.30, saves: 0.00, gc: 1.35 }
        };
        function posRateBaseline(pos) {
            return POS_RATE_BASELINE[pos] || { xG: 0.08, xA: 0.08, cs: 0.25, bonus: 0.25, saves: 0, gc: 1.35 };
        }

        /* The baseline above says every midfielder is the same midfielder until
           proven otherwise, which with one gameweek played is three quarters of
           the projection. It is not true and the market says so: across the pool
           price and FPL's own ep_next correlate at +0.89, a single gameweek's
           xGI/90 at +0.32. Left flat, one goal from a £5.5m player outranked a
           quiet afternoon from a £12.0m one.

           Same exponents and clamp as the squad projection in pitch-snapshot.js,
           fitted from minutes-pooled price deciles. Attacking rates only — clean
           sheets and saves come from the team model, not from what a player cost.
           Scales the prior alone, so it fades out as evidence arrives.

           Carries a pa* prefix because scripts/xp-engine.js owns
           priceQualityMultiplier already, and the two are NOT the same function
           however alike they read. Both compute clamp(pow(price / median, k))
           from identical constants, but they take the median from different
           pools: the engine's comes from positionAverages[pos].medPrice, this
           one from medianPriceForPos(), which falls back to the whole position
           when fewer than five players clear the minutes filter. Same formula,
           different denominator, different answer.

           So this is not a duplicate waiting to be deleted — merging the names
           would silently move every recommendation on this page onto the other
           pool, with nothing to show that it had happened. The prefix is the
           same answer twRecencyWeightedAvg gave to the same problem; see
           ARCHITECTURE.md. It becomes deletable when calculatePositionScore
           does, and not before. */
        const PA_PRICE_PRIOR_K = { GK: 0, DEF: 1.5, MID: 1.5, FWD: 1.0 };
        const PA_PRICE_PRIOR_CLAMP = [0.6, 2.4];
        let _medPriceByPos = null;

        function medianPriceForPos(pos) {
            if (!_medPriceByPos) {
                const pool = typeof allAnalyses !== 'undefined' ? allAnalyses : [];
                // Nothing to measure yet. Return neutral WITHOUT caching, or the
                // empty answer sticks for the life of the page and the prior
                // silently reverts to price-blind.
                if (!pool.length) return 0;
                const built = {};
                const posName = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
                // Match the squad model's filter: enough minutes to be a real option.
                const minMinutes = Math.min(200, Math.max((currentGameweek || 1) - 1, 1) * 60);
                ['GK', 'DEF', 'MID', 'FWD'].forEach(pn => {
                    const of = pool.filter(p => posName[p.position] === pn);
                    let prices = of.filter(p => (p.lastSeason?.minutes || 0) >= minMinutes).map(p => p.price);
                    // Early in a season the minutes bar can empty a position; fall
                    // back to the whole position rather than to no reference at all.
                    if (prices.length < 5) prices = of.map(p => p.price);
                    prices.sort((a, b) => a - b);
                    built[pn] = prices.length ? prices[Math.floor(prices.length / 2)] : 0;
                });
                _medPriceByPos = built;
            }
            return _medPriceByPos[pos] || 0;
        }

        function paPriceQualityMultiplier(price, pos) {
            const k = PA_PRICE_PRIOR_K[pos] || 0;
            if (!k || !price) return 1;
            const med = medianPriceForPos(pos);
            if (!med) return 1;
            const m = Math.pow(price / med, k);
            return Math.max(PA_PRICE_PRIOR_CLAMP[0], Math.min(PA_PRICE_PRIOR_CLAMP[1], m));
        }

        // Preseason fallback: route diversity computed from last season's raw totals
        // instead of the blended L5/season model (which needs current-season data).
        function renderLastSeasonRoutes(analyses) {
            const posMap = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
            const banner = renderSeasonNotice('Routes to Points blends recent and season-long trends, which need this season’s data. Showing last season’s route breakdown instead.');

            const scored = analyses
                .filter(p => p.status === 'a')
                .map(p => {
                    const ls = p.lastSeason || {};
                    const pos = posMap[p.position];
                    const routes = [];
                    if ((ls.goals || 0) >= 3) routes.push({ label: 'Goals', detail: `${ls.goals} last season` });
                    if ((ls.assists || 0) >= 3) routes.push({ label: 'Assists', detail: `${ls.assists} last season` });
                    if ((pos === 'GK' || pos === 'DEF') && (ls.cleanSheets || 0) >= 5) routes.push({ label: 'Clean Sheets', detail: `${ls.cleanSheets} last season` });
                    if ((ls.bonus || 0) >= 8) routes.push({ label: 'Bonus', detail: `${ls.bonus} last season` });
                    return { ...p, routes };
                })
                .filter(p => p.routes.length >= 2)
                .sort((a, b) => (b.lastSeason?.totalPoints || 0) - (a.lastSeason?.totalPoints || 0));

            const posColors = { GK: '#FBBF24', DEF: '#34D399', MID: '#60A5FA', FWD: '#F87171' };
            const cards = scored.slice(0, 24).map((p, i) => `
                <div class="route-card" onclick="openPlayerModal(${p.id})">
                    ${getStarHtml(p.id, 'shortlist-star-card')}
                    <div class="route-card-top">
                        <div class="route-card-rank">${i + 1}</div>
                        <div class="route-card-player">
                            <div class="route-card-name">${escHTML(p.name)}</div>
                            <div class="route-card-meta">
                                <span class="route-pos-badge" style="background: ${posColors[posMap[p.position]]}20; color: ${posColors[posMap[p.position]]}">${posMap[p.position]}</span>
                                ${escHTML(p.team)} &middot; £${p.price.toFixed(1)}m
                            </div>
                        </div>
                        <div class="route-card-score" title="Number of distinct scoring routes last season">
                            <div class="route-score-number">${p.routes.length}</div>
                            <div class="route-score-label">routes</div>
                        </div>
                    </div>
                    <div class="route-card-bars">
                        ${p.routes.map(r => `
                            <div class="route-bar-row" title="${r.label}: ${r.detail}">
                                <span class="route-bar-name">${r.label}</span>
                                <span class="route-bar-detail">${r.detail}</span>
                            </div>
                        `).join('')}
                    </div>
                    <div class="route-card-footer">
                        <span>${p.lastSeason?.totalPoints || 0} pts (25/26)</span>
                    </div>
                </div>
            `).join('');

            return `${banner}<div class="routes-grid">${cards || '<div class="no-players">No players with 2+ last-season routes found</div>'}</div>`;
        }

        function generateRoutesToPoints(analyses) {
            if (isPreseason) {
                return renderLastSeasonRoutes(analyses);
            }
            /* One engine — routesFor() in scripts/routes-engine.js.

               This function used to decide, for itself, which routes exist, what
               each is worth, how strong it is, and where the projected points
               come from. compare-report.js carried a copy of the first half and
               the profile card answered the second half from the real
               projection, so the site held three answers to one question.

               It renders now. Everything it used to compute is the engine's. */
            const scored = analyses
                .filter(p => isPlayerEligible(p, { minGames: 3 }))
                .map(p => {
                    const rt = routesFor(p);
                    const bd = rt.breakdown;
                    return {
                        ...p, pos: rt.pos,
                        routes: rt.routes, signals: rt.signals, routeCount: rt.routeCount,
                        compositeScore: rt.compositeScore,
                        nailedMultiplier: rt.nailedMultiplier,
                        per90: rt.per90, gamesSample: rt.gamesSample, minsPg: rt.minsPg,
                        defConHit: rt.defConHit,
                        /* The point-source bar is the projection broken open, not
                           a second model reconstructed from blended rates — which
                           is what it was, and why defensive contribution was
                           missing from every bar on this page while the engine
                           had been projecting it all along. */
                        pointSources: bd ? bd.sources : [],
                        xpTotal: bd ? bd.total : 0,
                        xpConceded: bd ? bd.conceded : 0
                    };
                })
                .filter(p => p.routeCount >= 2)
                .sort((a, b) => b.compositeScore - a.compositeScore);

            // Split by position
            const byPos = { GK: [], DEF: [], MID: [], FWD: [] };
            scored.forEach(p => byPos[p.pos]?.push(p));

            // Store scored data globally for database view
            window._allRoutesPlayers = scored;

            // The raw view scales each bar against the best in its own position —
            // a keeper's points profile is not comparable to a forward's.
            window._routesPosMax = {};
            ['GK', 'DEF', 'MID', 'FWD'].forEach(k => {
                window._routesPosMax[k] = byPos[k].reduce((m, x) => Math.max(m, x.xpTotal || 0), 0) || 1;
            });

            // Top 15 Squad: 2 GK + 5 DEF + 5 MID + 3 FWD
            const top15Counts = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
            const posConfigs = [
                { pos: 'GK', name: 'Goalkeepers' },
                { pos: 'DEF', name: 'Defenders' },
                { pos: 'MID', name: 'Midfielders' },
                { pos: 'FWD', name: 'Forwards' }
            ];

            /* One list, best first. It used to open on a "Top 15 Squad" —
               two keepers, five defenders, five midfielders, three forwards,
               each position cut to a squad shape and grouped under its own
               subheading. That is a squad builder's view, and this tab is not
               a squad builder: the question here is who has the most ways of
               scoring, which has one answer and reads down a single ranked
               column. The shape also fought the position pills, which had to
               be hidden whenever it was showing.

               void: the per-position caps go with it. */
            void top15Counts; void posConfigs;
            const dbInitial = scored.slice(0, 30);
            const dbHtml = dbInitial.map((p, i) => renderRouteCard(p, i + 1)).join('');
            const hasMore = scored.length > 30;

            return `
              <div class="pa-panel">
                <div class="pa-panel-head">
                    <span class="pa-panel-title">${paIcon('routes')}Routes to points</span>
                    <div class="pa-panel-controls">
                        <div class="pa-filter-pills">${paPositionPills()}</div>
                        <div class="routes-search-wrap">
                            <i data-lucide="search" class="search-icon" style="width:14px;height:14px;"></i>
                            <input type="text" class="routes-search-input" placeholder="Search players..." oninput="filterRoutesDatabase(this.value)">
                        </div>
                        <div class="v2-filter-row-tail">
                            ${v2MenuHTML({
                                key: 'routes-mode', icon: 'chart', label: 'Bars',
                                value: routesMode, onPick: 'switchRoutesMode',
                                options: [
                                    { value: 'prop', label: 'Proportional', note: 'Read one player\u2019s split',
                                      tip: 'Every bar fills the width, so you read the split within one player.' },
                                    { value: 'raw', label: 'Raw stats', note: 'Compare players',
                                      tip: 'Bar length scales against the best player in the same position, so you can compare players.' }
                                ]
                            })}
                            <button class="legend-toggle" onclick="this.classList.toggle('active'); document.getElementById('routesLegend').classList.toggle('show')">
                                <span><i data-lucide="info" style="width:14px;height:14px;display:inline-block;vertical-align:middle;"></i> Legend</span><span class="legend-caret">\u25be</span>
                            </button>
                        </div>
                    </div>
                </div>
                <div class="routes-section mode-${routesMode}" id="routesSection">
                    <div class="legend-panel" id="routesLegend">
                        <span class="legend-panel-item"><span class="legend-panel-dot" style="background:#94A3B8"></span> Appearance</span>
                        <span class="legend-panel-item"><span class="legend-panel-dot" style="background:#F87171"></span> Goals</span>
                        <span class="legend-panel-item"><span class="legend-panel-dot" style="background:#60A5FA"></span> Assists</span>
                        <span class="legend-panel-item"><span class="legend-panel-dot" style="background:#34D399"></span> Clean sheets</span>
                        <span class="legend-panel-item"><span class="legend-panel-dot" style="background:#A78BFA"></span> Saves</span>
                        <span class="legend-panel-item"><span class="legend-panel-dot" style="background:#FBBF24"></span> Bonus</span>
                        <span class="legend-panel-item" style="margin-left:8px;"><i data-lucide="lock" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> = Nailed on</span>
                        <span class="legend-panel-item">${paIcon('goal')} = Penalty taker</span>
                        ${/* Creativity used to be listed here as a route that gets
                              no slice. It is not a route at all any more — it is an
                              ICT component that predicts assists, and assists are
                              already their own route, so counting both paid the
                              same expected points twice. Penalties still are a
                              route and still get no slice, because penalty goals
                              are already inside xG. */''}
                        <span class="legend-panel-item legend-panel-note">Penalties count as a route but get no slice of the bar — penalty goals are already inside xG.</span>
                        <span class="legend-panel-item legend-panel-note">
                            <b>Why the order is not simply the route count.</b> The list is ranked on how much
                            the routes are worth, not how many there are: each one counts for how strong it is
                            multiplied by what that route pays, and the total is then adjusted for how reliably
                            he starts and for the fixtures ahead. Four strong routes beat five weak ones, so a
                            player with fewer routes can sit above one with more.
                        </span>
                    </div>
                    <div class="routes-database-view active">
                        <div class="routes-grid" id="routesDatabaseGrid">${dbHtml}</div>
                        <div class="routes-load-more-wrap" style="text-align:center;margin-top:16px;${hasMore ? '' : 'display:none;'}"><button class="routes-view-btn" style="background:var(--surface-2);border:1px solid var(--border-default);" onclick="loadMoreRoutes()">Load more</button></div>
                    </div>
                </div>
              </div>
            `;
        }

        // Variance only means something once there are scores to take a variance
        // of. The old version left consistency at 0 below five games and mapped
        // that to "Volatile", so one gameweek into a season every single player
        // was labelled boom-or-bust in red.
        function routeReliability(p) {
            const hist = (p.history || []).filter(h => (parseInt(h.minutes, 10) || 0) > 0);
            if (hist.length < 4) {
                return {
                    state: 'unknown', icon: paIcon('ruler'), label: 'Too early to judge', fill: 0,
                    detail: `Variance needs at least four appearances before it says anything. ${hist.length} so far.`
                };
            }
            const pts = hist.slice(-6).map(h => parseFloat(h.total_points) || 0);
            const mean = pts.reduce((s, v) => s + v, 0) / pts.length;
            const sd = Math.sqrt(pts.reduce((s, v) => s + (v - mean) ** 2, 0) / pts.length);
            const score = Math.max(0, Math.min(10, (1 - sd / 6) * 10));
            const detail = `Last ${pts.length} appearances: ${pts.join(', ')} pts — mean ${mean.toFixed(1)}, standard deviation ${sd.toFixed(1)}.`;
            if (score >= 7) return { state: 'reliable', icon: paIcon('shield'), label: 'Reliable returner', fill: score * 10, detail };
            if (score >= 4) return { state: 'mixed', icon: paIcon('scales'), label: 'Mixed', fill: score * 10, detail };
            return { state: 'volatile', icon: paIcon('wave'), label: 'High variance', fill: Math.max(8, score * 10), detail };
        }

        function rpReliabilityMeter(rel) {
            return `<div class="rp-rel rp-rel-${rel.state}" data-tooltip="${escHTML(rel.detail)}">
                <span class="rp-rel-icon">${rel.icon}</span>
                <span class="rp-rel-label">${escHTML(rel.label)}</span>
                <span class="rp-rel-track"><span class="rp-rel-fill" style="width:${rel.fill}%"></span></span>
            </div>`;
        }

        // Thick single stacked bar. Segment widths are the share of expected
        // points; in raw mode the whole bar shrinks against the best player in
        // the same position, so bar length compares players and segment length
        // still reads as points. One geometry, two questions answered.
        function rpStackBar(p) {
            const srcs = p.pointSources || [];
            if (!srcs.length) return '';
            const posMax = (window._routesPosMax && window._routesPosMax[p.pos]) || p.xpTotal || 1;
            const rawFill = Math.max(8, Math.min(100, (p.xpTotal / posMax) * 100));
            const segs = srcs.map(s => {
                const pct = s.share * 100;
                const room = pct >= 14;
                return `<span class="rp-seg" style="width:${pct.toFixed(2)}%;background:${s.color};"
                    data-tooltip="${escHTML(s.label)}: ${s.pts.toFixed(2)} projected points, ${Math.round(pct)}% of the total">
                    ${room ? `<span class="rp-seg-l rp-when-prop">${Math.round(pct)}%</span><span class="rp-seg-l rp-when-raw">${s.pts.toFixed(1)}</span>` : ''}
                </span>`;
            }).join('');
            // A legend on every card, so identity is never carried by colour alone.
            const legend = srcs.map(s => `<span class="rp-key">
                <span class="rp-key-dot" style="background:${s.color}"></span>${escHTML(s.label)}
                <b class="rp-when-prop">${Math.round(s.share * 100)}%</b><b class="rp-when-raw">${s.pts.toFixed(1)}</b></span>`).join('');
            return `<div class="rp-profile">
                <div class="rp-profile-head">
                    <span class="rp-profile-t">Projected next match</span>
                    <span class="rp-xp" data-tooltip="The squad projection's own breakdown for his next fixture — the same model the rest of the site runs on, split by where the points come from. Positive sources only; the deduction for goals conceded and for cards is not a slice of a total it subtracts from.">${p.xpTotal.toFixed(1)}<small>xP</small></span>
                </div>
                <div class="rp-bar" style="--rp-rawfill:${rawFill.toFixed(2)}%">${segs}</div>
                <div class="rp-keys">${legend}</div>
            </div>`;
        }

        function rpMiniPills(p) {
            const r = p.per90 || {};
            /* Defensive contribution reads as a hit rate, not a per-90 average.
               The two points come off a cliff — ten actions pays, nine pays
               nothing — so "8.4 per 90" tells you almost nothing about whether he
               banks it, and "cleared 10+ in 3 of 4" tells you exactly. Shown
               whatever the rate, including 0 of 4, because that is a measurement;
               it is absent only for a keeper, who cannot score it, and for a
               player with too few appearances to divide by. */
            const dc = p.defConHit;
            const dcPill = dc ? [[paIcon('shield'), `${dc.hits}/${dc.n}`,
                `${dc.threshold}+ def. actions`]] : [];
            const pills = p.pos === 'GK'
                ? [[paIcon('gloves'), r.saves.toFixed(1), 'saves/90'], [paIcon('shield'), Math.round((r.cs || 0) * 100) + '%', 'CS rate'], [paIcon('goal'), r.gc.toFixed(1), 'conceded/90'], [paIcon('star'), (r.bonus || 0).toFixed(1), 'bonus/g']]
                : p.pos === 'DEF'
                ? [[paIcon('target'), r.xG.toFixed(2), 'xG/90'], [paIcon('boot'), r.xA.toFixed(2), 'xA/90'], [paIcon('shield'), Math.round((r.cs || 0) * 100) + '%', 'CS rate'], ...dcPill, [paIcon('star'), (r.bonus || 0).toFixed(1), 'bonus/g']]
                : [[paIcon('target'), r.xG.toFixed(2), 'xG/90'], [paIcon('boot'), r.xA.toFixed(2), 'xA/90'], [paIcon('swords'), r.xGI.toFixed(2), 'xGI/90'], ...dcPill, [paIcon('star'), (r.bonus || 0).toFixed(1), 'bonus/g']];
            const thin = (p.gamesSample || 0) < 3;
            const sample = thin ? `<span class="rp-pill rp-pill-sample" data-tooltip="Season is ${p.gamesSample} game${p.gamesSample === 1 ? '' : 's'} old, so these are single results rather than settled rates.">${paIcon('ruler')} ${p.gamesSample}g</span>` : '';
            return `<div class="rp-pills-t">Observed so far</div>
            <div class="rp-pills">${pills.map(([i, v, l]) =>
                `<span class="rp-pill"><span class="rp-pill-i">${i}</span><b>${v}</b><span class="rp-pill-l">${l}</span></span>`).join('')}${sample}</div>`;
        }

        // Routes depend on who you play. A single averaged FDR number hid that.
        function rpFixtureStrip(p) {
            const FDR_WORD = { 1: 'Very easy', 2: 'Easy', 3: 'Average', 4: 'Hard', 5: 'Very hard' };
            const fx = (p.fixtures?.next3 || []).slice(0, 3);
            if (!fx.length) return '<div class="rp-fx"><span class="rp-fx-none">No fixtures scheduled</span></div>';
            return `<div class="rp-fx">${fx.map(f => {
                const opp = (f.opponent && teams[f.opponent]) ? teams[f.opponent].short_name : '???';
                const d = f.difficulty || 3;
                return `<span class="rp-fx-c fdr-${d}" data-tooltip="GW${f.event || '?'}: ${f.isHome ? 'home to' : 'away at'} ${escHTML(opp)} — difficulty ${d} (${FDR_WORD[d]})">
                    <span class="rp-fx-gw">GW${f.event || '?'}</span>
                    <span class="rp-fx-o">${escHTML(opp)}<small>${f.isHome ? 'H' : 'A'}</small></span>
                </span>`;
            }).join('')}</div>`;
        }

        function routeScoutNote(p, rel) {
            /* Keyed on the engine's own keys. These used to say `cs`, and the
               engine says `cleanSheet` — a lookup miss here reads as "undefined"
               in the middle of a sentence, which is how every phrase below would
               have greeted defensive contribution. */
            const named = { goals: 'goal threat', assists: 'chance creation', cleanSheet: 'clean sheets',
                saves: 'save volume', defCon: 'defensive work', bonus: 'bonus points' };
            const src = (p.pointSources || []).filter(s => s.key !== 'appearance').sort((a, b) => b.pts - a.pts);
            if (!src.length) return 'No meaningful attacking or defensive output yet — currently an appearance-points asset only.';
            const top = src[0], second = src[1];
            const topPct = Math.round(top.share * 100);
            const fdrs = (p.fixtures?.next3 || []).map(f => f.difficulty || 3);
            const avgFdr = fdrs.length ? fdrs.reduce((s, v) => s + v, 0) / fdrs.length : 3;

            // Two sources only diversify if they arrive on different afternoons.
            // Clean sheets and bonus land together for a defender, and so do goals
            // and bonus for an attacker — so the route count overstates how
            // independent those profiles really are, and the note should say so.
            // Appearance points are the floor every starter collects. When they are
            // most of the projection, that is the story — not whichever scraps of
            // output happen to rank first.
            const appearance = (p.pointSources || []).find(s => s.key === 'appearance');
            const appShare = appearance ? appearance.share : 0;
            const backLine = (p.pos === 'GK' || p.pos === 'DEF');

            const secondPct = second ? Math.round(second.share * 100) : 0;
            const pair = second ? [top.key, second.key].sort().join('+') : top.key;
            const PAIR_NOTE = {
                'cleanSheet+saves': `Save volume is the cushion here — it pays in exactly the weeks the clean sheet does not arrive, which is what makes a busy keeper worth owning.`,
                'bonus+cleanSheet': `Clean sheets carry ${topPct}% of it, and the bonus largely lands on those same afternoons rather than forming a route of its own.`,
                'bonus+goals': `Goals lead at ${topPct}%, and bonus mostly follows them — fewer genuinely independent routes than the badge suggests.`,
                'assists+goals': `Both halves of the attacking return are live — ${named[top.key]} at ${topPct}%, ${named[second.key]} at ${secondPct}% — which is the most durable shape an attacking profile takes.`,
                'cleanSheet+goals': `${backLine ? 'Dual threat from the back' : 'Two-way profile'}: clean sheets and goal threat are worth ${topPct}% and ${secondPct}%, and they do not depend on each other.`,
                'assists+cleanSheet': `${backLine ? 'Dual threat from the back' : 'Two-way profile'}: clean sheets and chance creation are worth ${topPct}% and ${secondPct}%, and they do not depend on each other.`,
                /* Defensive contribution is the one route that does NOT arrive on
                   the same afternoon as the others. A clean sheet needs ten other
                   players; tackles and interceptions are his alone, and they are
                   paid in the heavy defeats where everything else pays nothing.
                   That is the opposite of the double-counting the notes above
                   warn about, so it is worth saying out loud. */
                'cleanSheet+defCon': `Clean sheets and defensive work at ${topPct}% and ${secondPct}% — and these genuinely are independent: the tackles and interceptions pay in exactly the weeks the clean sheet does not.`,
                'defCon+goals': `Goal threat and defensive work, ${topPct}% and ${secondPct}%. Two sources that land on different afternoons, which is the shape you want.`,
                'assists+defCon': `Chance creation and defensive work, ${topPct}% and ${secondPct}% — box to box, and the two rarely fail in the same week.`,
                'bonus+defCon': `Defensive work is doing the heavy lifting, and it drags the bonus along with it — the same actions feed the BPS, so treat these as closer to one route than two.`
            };

            let lead;
            if (appShare >= 0.45) {
                lead = `Mostly an appearance asset — ${Math.round(appShare * 100)}% of the projection is the points for starting, with ${named[top.key]} the only real output on top.`;
            } else if (topPct >= 55) {
                lead = `One-track profile — ${topPct}% of his expected points ride on ${named[top.key]}, so a dry spell there takes the whole return with it.`;
            } else if (PAIR_NOTE[pair]) {
                lead = PAIR_NOTE[pair];
            } else if (second) {
                lead = `Spread across ${named[top.key]} (${topPct}%) and ${named[second.key]} (${secondPct}%), with no single source able to sink the return on its own.`;
            } else {
                lead = `Points come almost entirely through ${named[top.key]}.`;
            }

            const fixtureClause = avgFdr <= 2.4 ? ' The next three fixtures are kind.'
                : avgFdr >= 3.8 ? ' The next three fixtures are unforgiving.'
                : ' Fixtures over the next three are average.';
            const relClause = rel.state === 'reliable' ? ' He scores at a steady rate.'
                : rel.state === 'volatile' ? ' Returns arrive in bursts rather than every week.'
                : rel.state === 'unknown' ? ` Based on ${p.gamesSample} game${p.gamesSample === 1 ? '' : 's'}, so treat the split as provisional.`
                : '';
            return lead + fixtureClause + relClause;
        }

        function renderRouteCard(p, rank) {
            const rel = routeReliability(p);
            const posColors = { GK: '#FBBF24', DEF: '#34D399', MID: '#60A5FA', FWD: '#F87171' };
            const accent = posColors[p.pos] || '#60A5FA';
            const nailed = p.nailedMultiplier >= 1.15;
            const routeNames = (p.routes || []).map(r => r.name).join(', ');

            /* The same hero Recommendations and Rising Form use, at the same
               size. This card was the only one of the three still on 'mini' —
               a thin strip with the name in it — while its neighbours carried
               the club-coloured header with the portrait, so three grids of
               cards about the same players looked like three different
               products.

               The route count keeps its badge, because that is this card's one
               headline number, and it sits in the body under the hero. */
            const hero = typeof v2PlayerHeroHTML === 'function'
                ? v2PlayerHeroHTML(p, { size: 'compact', sub: p.pos, chip: '#' + rank })
                : '';

            return `
                <div class="rp-card has-hero" style="--rp-accent:${accent};" onclick="openPlayerModal(${p.id})">
                    ${getStarHtml(p.id, 'shortlist-star-card')}
                    ${hero}
                    <div class="rp-body">
                    <div class="rp-head">
                        <div class="rp-badge" data-tooltip="Distinct ways this player scores: ${escHTML(routeNames)}. More routes means less reliance on any one of them.">
                            <span class="rp-badge-star">${paIcon('routes')}</span><b>${p.routeCount}</b><span class="rp-badge-l">routes</span>
                        </div>
                        ${nailed ? `<span class="rp-nailed" data-tooltip="Plays essentially every available minute">${paIcon('lock')} Nailed on</span>` : ''}
                        ${/* Penalty duty, beside the minutes. FPL publishes the
                              order outright — penalties_order, 1 for the first
                              choice — so this is stated rather than inferred from
                              a goals-minus-xG gap the way it once was. It belongs
                              on the card because it changes the floor of every
                              other route he has. */''}
                        ${p.penaltiesOrder != null && p.penaltiesOrder <= 2
                            ? `<span class="rp-pens${p.penaltiesOrder === 1 ? ' is-first' : ''}"
                                data-tooltip="${p.penaltiesOrder === 1
                                    ? 'First-choice penalty taker, as published by FPL.'
                                    : 'Second-choice penalty taker, as published by FPL — he takes them when the first choice is off the pitch.'}">${paIcon('goal')} ${p.penaltiesOrder === 1 ? 'Penalties' : '2nd pens'}</span>`
                            : ''}
                    </div>
                    ${rpReliabilityMeter(rel)}
                    ${rpStackBar(p)}
                    ${rpMiniPills(p)}
                    ${rpFixtureStrip(p)}
                    <p class="rp-note">${escHTML(routeScoutNote(p, rel))}</p>
                    </div>
                </div>
            `;
        }

        // ============================================
        // RECOMMENDATIONS - Position-Specific Logic
        // ============================================
        const POSITIONS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };

        const BUDGET_CAPS = { GK: 5.0, DEF: 5.0, MID: 7.5, FWD: 7.0 };

        function generateRecommendations(analyses) {
            if (isPreseason) {
                return renderLastSeasonRecommendations(analyses);
            }
            /* ALL leads, and is where the page opens. A budget cap is a
               per-position idea — £5.5m is a cheap midfielder and an expensive
               goalkeeper — so the pooled tier has no single cap of its own and
               asks each player's own position for his. */
            const positions = [
                { pos: 'ALL', title: 'Every position', budgetCap: null, metrics: ['xGI','goals','assists','ptsG'], budgetDesc: 'Cheap enough to free money elsewhere', premiumDesc: 'The players worth building around' },
                { pos: 'GK', title: 'Goalkeepers', budgetCap: BUDGET_CAPS.GK, metrics: ['cs','saves','gc','ptsG'], budgetDesc: 'High save count, rotation options', premiumDesc: 'Clean sheet magnets from top defenses' },
                { pos: 'DEF', title: 'Defenders', budgetCap: BUDGET_CAPS.DEF, metrics: ['cs','gc','xGC','ptsG'], budgetDesc: 'Solid CS potential at low cost', premiumDesc: 'Elite defenders + attacking threat' },
                { pos: 'MID', title: 'Midfielders', budgetCap: BUDGET_CAPS.MID, metrics: ['xGI','goals','assists','ptsG'], budgetDesc: 'High xGI relative to price', premiumDesc: 'Elite creators and scorers' },
                { pos: 'FWD', title: 'Forwards', budgetCap: BUDGET_CAPS.FWD, metrics: ['xG','goals','xA','ptsG'], budgetDesc: 'Goal threat on a budget', premiumDesc: 'Premium goal scorers' }
            ];

            const panels = positions.map(cfg =>
                `<div class="sub-tab-panel ${cfg.pos === activeGlobalPosition ? 'active' : ''}" id="rec-panel-${cfg.pos}">${generatePositionRecs(cfg.pos, analyses, cfg)}</div>`
            ).join('');

            /* The "include doubtful players" checkbox is gone. It duplicated
               the availability filter that already governs every other tab on
               this page from the same globalFilters.availability flag, so the
               two controls could disagree about what you were looking at —
               and a recommendation to buy a player who is not fit is not a
               recommendation. Injured and doubtful players are still visible
               where you go to look them up: the All Players table. */
            return `
                <div class="pa-panel">
                    <div class="pa-panel-head">
                        <span class="pa-panel-title">${paIcon('target')}Recommendations</span>
                        <div class="pa-panel-controls">
                            <div class="pa-filter-pills">${paPositionPills()}</div>
                            <div class="v2-filter-row-tail">
                                ${v2MenuHTML({
                                    key: 'rec-tier', icon: 'coins', label: 'Tier',
                                    value: recActiveTier(), onPick: 'setRecTier',
                                    options: [
                                        { value: 'budget', label: 'Budget', note: 'Cheap enough to free money elsewhere' },
                                        { value: 'premium', label: 'Premium', note: 'The players worth building around' },
                                        { value: 'differential', label: 'Differentials', note: 'Under 10% owned' }
                                    ]
                                })}
                                ${v2MenuHTML({
                                    key: 'rec-weight', icon: 'sliders', label: 'Weighting',
                                    value: recFixtureMode, onPick: 'setRecFixtureMode',
                                    options: [
                                        { value: 'balanced', label: 'Balanced', note: 'Form and value lead',
                                          tip: 'Form, underlying numbers and value lead; fixtures are one term among many. This is the standard ranking.' },
                                        { value: 'fixtures', label: 'Fixture-first', note: 'Next three opponents lead',
                                          tip: 'Weights the next three fixtures — opponent strength, venue, clean-sheet odds and whether the run is easing — so a hard run costs a player his place. Same players, same form, re-ranked on who they face.' }
                                    ]
                                })}
                            </div>
                        </div>
                    </div>
                    ${recFixtureMode === 'fixtures' ? renderSeasonNotice(
                        '<strong>Fixture-first.</strong> Ranked with the next three opponents weighted heavily, so form still counts but a hard run pushes a player down. '
                        + 'The fixture blocks on each card are what is doing the work.') : ''}
                    ${panels}
                </div>
            `;
        }

        /* ===== The shared furniture for this page's panels =====
           One title icon set and one row of position pills, so the six tabs
           are the same control in six places rather than six controls. */
        const PA_ICONS = {
            target: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z"/><path d="M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z"/><circle cx="12" cy="12" r="2"/>',
            trending: '<path d="M3 17 9 11l4 4 8-8"/><path d="M14 7h7v7"/>',
            flame: '<path d="M12 22c4 0 7-2.6 7-6.5 0-4-3-6-4.5-9.5C13 9 11 8 11 5 8 7 5 10 5 15.5 5 19.4 8 22 12 22Z"/>',
            routes: '<circle cx="6" cy="19" r="3"/><path d="M9 19h5a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h5"/><circle cx="18" cy="5" r="3"/>',
            chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m7 15 3-4 3 3 5-7"/>',
            table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>',
            lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
            ruler: '<path d="m15 3 6 6L9 21l-6-6Z"/><path d="m8 10 2 2M11 7l2 2M5 13l2 2"/>',
            shield: '<path d="M12 3 5 6v6c0 4.2 2.9 7.9 7 9 4.1-1.1 7-4.8 7-9V6Z"/>',
            scales: '<path d="M12 4v16M7 20h10"/><path d="m5 9 3-5 3 5a3 3 0 0 1-6 0Z"/><path d="m13 9 3-5 3 5a3 3 0 0 1-6 0Z"/>',
            wave: '<path d="M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/><path d="M2 18c2-3 4-3 6 0s4 3 6 0 4-3 6 0"/>',
            gloves: '<path d="M6 21V9a2 2 0 0 1 4 0V4a2 2 0 0 1 4 0v5a2 2 0 0 1 4 0v12Z"/>',
            goal: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/>',
            boot: '<path d="M4 6h5l2 5 6 2a3 3 0 0 1 3 3v2H4Z"/><path d="M4 14h16"/>',
            swords: '<path d="m4 4 9 9-3 3-9-9Z"/><path d="m20 4-9 9 3 3 9-9Z"/><path d="m8 16-4 4M16 16l4 4"/>',
            star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.2-5.4-2.9-5.4 2.9 1-6.2L3.2 9.5l6.1-.9Z"/>',
            skull: '<circle cx="12" cy="10" r="7"/><circle cx="9.5" cy="10" r="1.3"/><circle cx="14.5" cy="10" r="1.3"/><path d="M9 17v3M12 17v4M15 17v3"/>'
        };

        function paIcon(name) {
            const paths = PA_ICONS[name];
            if (!paths) return '';
            return '<svg class="v2-sec-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
                + ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
                + paths + '</svg>';
        }

        /* The same five pills every panel shows. They drive the one global
           position, so switching in Recommendations leaves Routes on the same
           position when you get there — which is the point of it being global. */
        function paPositionPills() {
            const pills = [
                { v: 'ALL', l: 'All', c: '' },
                { v: 'GK', l: 'GK', c: 'pos-gk' },
                { v: 'DEF', l: 'DEF', c: 'pos-def' },
                { v: 'MID', l: 'MID', c: 'pos-mid' },
                { v: 'FWD', l: 'FWD', c: 'pos-fwd' }
            ];
            return pills.map(p =>
                `<button class="pa-filter-pill ${p.c} ${activeGlobalPosition === p.v ? 'active' : ''}"
                    data-pa-pos="${p.v}" onclick="switchGlobalPosition('${p.v}', null)">${p.l}</button>`
            ).join('');
        }

        // Preseason fallback: last season's cumulative top scorers by position, clearly labeled.
        // Not the live momentum-based algorithm above — just a simple reference list, since
        // there's no current-season form/fixture data to power real recommendations yet.
        function renderLastSeasonRecommendations(analyses) {
            const positions = [
                { pos: 'GK', posId: 1, title: 'Goalkeepers' },
                { pos: 'DEF', posId: 2, title: 'Defenders' },
                { pos: 'MID', posId: 3, title: 'Midfielders' },
                { pos: 'FWD', posId: 4, title: 'Forwards' }
            ];
            const active = activeGlobalPosition || 'GK';
            const banner = renderSeasonNotice('Recommendations use this season’s form &amp; fixtures — not available until GW1. Showing last season’s top performers by position instead.');
            const panels = positions.map(({ pos, posId, title }) => {
                const top = analyses
                    .filter(a => a.position === posId && a.status === 'a')
                    .sort((a, b) => (b.lastSeason?.totalPoints || 0) - (a.lastSeason?.totalPoints || 0))
                    .slice(0, 8);
                const cards = top.length > 0
                    ? top.map((p, i) => renderLastSeasonCard(p, i + 1)).join('')
                    : '<div class="no-players">No last-season data found</div>';
                return `<div class="sub-tab-panel ${pos === active ? 'active' : ''}" id="rec-panel-${pos}">
                    <div class="pos-rec-section">
                        <h3 style="font-size:13px;color:var(--text-secondary);margin:8px 0;">${title} — Top Points, 2025/26</h3>
                        <div class="rec-category-panel active">${cards}</div>
                    </div>
                </div>`;
            }).join('');
            return banner + panels;
        }

        function renderLastSeasonCard(p, rank) {
            const ls = p.lastSeason || {};
            const next3 = p.fixtures?.next3 || [];
            const fixChips = next3.slice(0, 3).map(f => {
                const oppName = (f.opponent && teams[f.opponent]) ? teams[f.opponent].short_name : '???';
                const d = f.difficulty || 3;
                const cls = d <= 1 ? 'fdr-1' : d <= 2 ? 'fdr-2' : d <= 3 ? 'fdr-3' : d <= 4 ? 'fdr-4' : 'fdr-5';
                const venue = f.isHome ? 'H' : 'A';
                return `<span class="rec-fix-chip ${cls}"><span class="gw-label">GW${f.event || ''}</span>${escHTML(oppName)} (${venue})</span>`;
            }).join('');
            return `
                <div class="rec-card" style="position:relative;" onclick="openPlayerModal(${p.id})">
                    ${getStarHtml(p.id, 'shortlist-star-card')}
                    <div class="rec-card-top-row">
                        <div class="rec-card-top-left">
                            <div class="rec-card-rank">${rank}</div>
                            <div class="rec-card-main">
                                <div class="rec-card-header">
                                    <div class="rec-card-name">${escHTML(p.name)}</div>
                                    <div class="rec-card-team">${escHTML(p.team)} &middot; £${p.price.toFixed(1)}m</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="rec-card-metrics">
                        <div class="rec-metric"><span class="rec-metric-value">${ls.totalPoints || 0}</span><span class="rec-metric-label">Pts (25/26)</span></div>
                        <div class="rec-metric"><span class="rec-metric-value">${ls.goals || 0}</span><span class="rec-metric-label">Goals</span></div>
                        <div class="rec-metric"><span class="rec-metric-value">${ls.assists || 0}</span><span class="rec-metric-label">Assists</span></div>
                    </div>
                    ${fixChips ? `<div class="rec-fix-row">${fixChips}</div>` : ''}
                </div>
            `;
        }

        /* toggleRecAvailability() went with the checkbox that called it. The
           availability filter it flipped is the page-wide one, and having a
           second control for it here meant Recommendations could be showing
           doubtful players while every other tab was not. */



        function generatePositionRecs(pos, analyses, config) {
            const isAll = pos === 'ALL';
            // Apply shared eligibility check (availability + starters filters)
            const posPlayers = analyses.filter(a =>
                (isAll || POSITIONS[a.position] === pos) && isPlayerEligible(a)
            );

            /* Scores are computed against a player's own position whatever
               the filter says. A goalkeeper's score is built out of saves and
               clean sheets and a forward's out of xG; pooling them under one
               position's formula would rank every goalkeeper last rather than
               ranking them at all. */
            const scoredPlayers = posPlayers.map(p => {
                const own = POSITIONS[p.position];
                return {
                    ...p,
                    score: calculatePositionScore(p, own),
                    displayMetrics: getDisplayMetrics(p, own)
                };
            });

            /* Budget is per position for the same reason: £5.0m buys a first-
               choice goalkeeper and a bench midfielder, so "cheap" has to be
               asked of the player's own position, not of the filter. */
            const capFor = p => (isAll ? getBudgetCap(POSITIONS[p.position]) : config.budgetCap);
            const shown = isAll ? 12 : 7;

            const budgetPlayers = scoredPlayers
                .filter(p => p.price <= capFor(p) && (p.l5.minutes / p.l5.games) >= 60)
                .sort((a, b) => b.score - a.score)
                .slice(0, shown);

            const premiumPlayers = scoredPlayers
                .filter(p => p.price > capFor(p) && (p.l5.minutes / p.l5.games) >= 70)
                .sort((a, b) => b.score - a.score)
                .slice(0, shown);

            // Differentials get an ownership bonus (lower ownership = more differential value)
            const differentials = scoredPlayers
                .filter(p => (p.selectedBy || 0) < 10 && (p.l5.minutes / p.l5.games) >= 60)
                .map(p => ({
                    ...p,
                    score: p.score + (10 - (p.selectedBy || 0)) * 0.3
                }))
                .sort((a, b) => b.score - a.score)
                .slice(0, shown);

            // Default active category preserved per position
            const activeRecCat = window._activeRecCat?.[pos] || 'budget';

            return `
                <div class="pos-rec-section">
                    <div class="rec-category-panel ${activeRecCat === 'budget' ? 'active' : ''}" id="recCat-${pos}-budget">
                        ${budgetPlayers.length > 0 ? recCardList(budgetPlayers, pos, false) : '<div class="no-players">No players found</div>'}
                    </div>
                    <div class="rec-category-panel ${activeRecCat === 'premium' ? 'active' : ''}" id="recCat-${pos}-premium">
                        ${premiumPlayers.length > 0 ? recCardList(premiumPlayers, pos, false) : '<div class="no-players">No players found</div>'}
                    </div>
                    <div class="rec-category-panel ${activeRecCat === 'differential' ? 'active' : ''}" id="recCat-${pos}-differential">
                        ${differentials.length > 0 ? recCardList(differentials, pos, true) : '<div class="no-players">No differentials found</div>'}
                    </div>
                </div>
            `;
        }

        /* ===== Fixture-first mode =====

           The score has always read fixtures, and reading them is not the same as
           being ranked by them. Two findings, both measured rather than assumed.

           First, how much fixtures move a recommendation. Swap a player's next
           three opponents for the three hardest, then the three easiest, hold his
           form fixed, and compare the swing against the spread of scores across
           his position:

             GK   0.62 s.d.    DEF  0.64 s.d.    MID  0.23 s.d.    FWD  0.25 s.d.

           So fixtures decide a defender and barely touch a midfielder. The visible
           consequence was the top six midfielders averaging an avgFDR3 of 3.17
           against a league mean of 3.03 — worse fixtures than average, with the
           fixture blocks printed on the card saying so.

           Second, and the reason the obvious fix does not work: the large fixture
           term does not run on the difficulty rating at all. It runs on this
           site's own opponent-power model, and after three gameweeks that model
           and FPL's published FDR are close to unrelated —

             corr(FDR, opponent attack power)  = 0.19    drives the GK/DEF term
             corr(FDR, opponent defence power) = 0.13    drives the MID/FWD term

           — with the FDR-2 band actually showing HIGHER mean opponent attack
           (42.5) than the FDR-3 band (39.3). Amplifying that term therefore
           optimises something orthogonal to the number on the card, and measuring
           it confirmed the damage: at a 12x boost the recommended defenders went
           from avgFDR3 2.94 to 3.44, further from good fixtures rather than
           nearer. That approach was built, measured, and thrown away.

           So fixture-first adds the difficulty rating itself as its own term,
           weighted 3/2/1 across the next three. REC_FDR_WEIGHT is score points per
           step of difficulty avoided, swept against the outcome that matters —
           the average FDR of what actually gets recommended:

             W      GK      DEF     MID     FWD     names kept from balanced
             0     3.00    2.94    3.17    3.06    6/6  (this is balanced mode)
             14    2.94    2.78    3.17    3.06    5-6/6
             25    2.83    2.78    3.00    2.83    4-5/6
             35    2.83    2.67    3.00    2.83    4-5/6

           25 is the knee: every position at or below its league mean, while four
           to five of the original six survive, so the list is still ranking good
           players by fixture and not ranking anyone with an easy run. Past that,
           the gain is small and the churn is not.

           Midfield only reaches its league average rather than beating it. That is
           the model declining to drop players who are far enough ahead on quality
           to be worth a hard run, which is the right call and worth knowing about.

           Balanced remains the default. This is a lens to switch to, not a
           correction applied to everyone. */
        let recFixtureMode = 'balanced';   // 'balanced' | 'fixtures'

        // Score points per step of FPL difficulty avoided. See the sweep above.
        let REC_FDR_WEIGHT = 25;

        function setRecFixtureMode(mode) {
            const next = mode === 'fixtures' ? 'fixtures' : 'balanced';
            /* Always close first. The re-render below replaces the menu node,
               so a module-level "which menu is open" left pointing at the old
               one makes the next click on the new button read as a second
               click and shut it again. */
            if (typeof v2MenuCloseAll === 'function') v2MenuCloseAll();
            if (next === recFixtureMode) return;
            recFixtureMode = next;
            document.getElementById('section-RECOMMENDATIONS').innerHTML = generateRecommendations(allAnalyses);
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        function calculatePositionScore(p, pos) {
            const games = p.l5?.games || 1;
            const minsPerGame = (p.l5?.minutes || 0) / games;
            // Every per-game rate below is regressed toward the position baseline
            // until there are roughly four matches behind it, exactly as the xP
            // model does. Without it, one clean sheet or one big save haul in an
            // opening fixture drives the whole ranking.
            const recBase = posRateBaseline(pos);
            const evidence = Math.min(1, games / 4);
            const rg = (v, base) => v * evidence + base * (1 - evidence);
            // Improvement #3: Continuous nailed bonus — gradual credit from 60 min (0) to 80 min (5)
            const nailedBonus = Math.min(5, Math.max(0, (minsPerGame - 60) / 4));

            // ── Recency-weighted per-game stats (most recent games count more) ──
            // Points per game is the largest single unregressed term left, and it
            // is where a clean sheet leaks back in: four points on one appearance
            // reads as four points every week. Baselines are what a starting
            // player in each position actually averages.
            // Scaled by price, and only above the appearance floor: everyone who
            // starts banks the same 2 points, so it is the returns on top that a
            // £12.0m player is bought for. Flat, this term was the single largest
            // force ranking a cheap player with one good game above a premium.
            const recPQ = paPriceQualityMultiplier(p.price, pos);
            const REC_PTS_FLAT = { GK: 3.2, DEF: 3.5, MID: 3.6, FWD: 3.6 }[pos] || 3.5;
            const REC_PTS_BASE = 2 + (REC_PTS_FLAT - 2) * recPQ;
            const rwPtsRaw = p.history ? recencyWeightedAvg(p.history, 'total_points') : (p.l5?.points || 0) / games;
            const rwPtsPerGame = rg(rwPtsRaw, REC_PTS_BASE);
            const rwXGraw = p.history ? recencyWeightedAvg(p.history, 'expected_goals') : (p.l5?.xG || 0) / games;
            const rwXAraw = p.history ? recencyWeightedAvg(p.history, 'expected_assists') : (p.l5?.xA || 0) / games;
            const rwBonusRaw = p.history ? recencyWeightedAvg(p.history, 'bonus') : (p.l5?.bonus || 0) / games;
            // Regressed like the rest. Recency weighting over a single gameweek
            // just returns that gameweek.
            const rwXG = rg(rwXGraw, recBase.xG * recPQ);
            const rwXA = rg(rwXAraw, recBase.xA * recPQ);
            // Slower clock than the rates above — bonus is lumpy and BPS is
            // already driven by the returns projected here.
            const recBonusEv = Math.min(1, games / 10);
            const rwBonus = rwBonusRaw * recBonusEv + recBase.bonus * (1 - recBonusEv);
            const rwXGI = rwXG + rwXA;

            const value = rwPtsPerGame / Math.max(p.price, 3.5);

            // Improvement #5: Scale value weight by season phase (GK retains more in late season)
            const valueWeight = currentPhase === 'late' ? (pos === 'GK' ? 8 : 6) : (pos === 'GK' || pos === 'DEF') ? 10 : 12;

            // ── Improvement #1: Multi-GW fixture factor (weighted avg of next 3 fixtures) ──
            const next3 = p.fixtures?.next3 || [];
            const fixtureWeights = [3, 2, 1]; // GW+1 matters most
            let fixtureFactor = 0;
            let venueMultiplier = 1.0;
            
            if (next3.length > 0) {
                let totalWeight = 0;
                let weightedFixture = 0;
                next3.slice(0, 3).forEach((fixture, idx) => {
                    const w = fixtureWeights[idx] || 1;
                    const opp = fixture.opponent;
                    const isHome = fixture.isHome;
                    let ff = 0;
                    if (opp && teamAnalysis[opp]) {
                        // Use venue-adjusted opponent power for more accurate fixture scoring
                        const oppData = teamAnalysis[opp];
                        const oppAttack = isHome ? (oppData.attackPowerAway || oppData.attackPower || 50) : (oppData.attackPowerHome || oppData.attackPower || 50);
                        const oppDefense = isHome ? (oppData.defensePowerAway || oppData.defensePower || 50) : (oppData.defensePowerHome || oppData.defensePower || 50);
                        const relevantOpp = (pos === 'GK' || pos === 'DEF') ? oppAttack : oppDefense;
                        ff = ((50 - relevantOpp) / 50) * 10;
                        if (isHome) ff += 1.5;
                    } else {
                        const fdr = fixture.difficulty || 3;
                        ff = Math.max(-10, (3.5 - fdr) * 8);
                    }
                    weightedFixture += ff * w;
                    totalWeight += w;
                });
                fixtureFactor = totalWeight > 0 ? weightedFixture / totalWeight : 0;
                
                // Home/Away adjustment based on next match venue
                const nextIsHome = next3[0]?.isHome ?? null;
                if (nextIsHome !== null && p.l5) {
                    const split = nextIsHome ? p.l5.homeSplit : p.l5.awaySplit;
                    if (split && split.games >= 2) {
                        const splitPtsPerGame = split.points / split.games;
                        const overallPtsPerGame = (p.l5.points || 0) / games;
                        if (overallPtsPerGame > 0) {
                            venueMultiplier = 0.7 + 0.3 * (splitPtsPerGame / overallPtsPerGame);
                            venueMultiplier = Math.max(0.8, Math.min(1.25, venueMultiplier));
                        }
                    } else {
                        venueMultiplier = nextIsHome ? 1.05 : 0.95;
                    }
                }
            } else {
                const ts_temp = p.teamScores;
                fixtureFactor = ts_temp ? ((ts_temp.fixtureScore - 50) / 50) * 8 : 0;
            }

            // ── Team-level factors (from computeTeamScores) ──
            const ts = p.teamScores;

            // Team form (momentum): range -3 → +3
            const teamFormFactor = ts ? ((ts.formRating - 50) / 50) * 3 : 0;
            // Position-specific team quality factor: range -4 → +4
            const teamQualityFactor = ts
                ? (pos === 'GK' || pos === 'DEF'
                    ? ((ts.defensePower - 50) / 50) * 4
                    : ((ts.attackPower - 50) / 50) * 4)
                : 0;

            // ── CS Probability factor (GK/DEF only) — blended across next 3 fixtures ──
            let csProbFactor = 0;
            if ((pos === 'GK' || pos === 'DEF') && next3.length > 0) {
                let csTotal = 0, csWeightTotal = 0;
                next3.slice(0, 3).forEach((f, idx) => {
                    const w = fixtureWeights[idx] || 1;
                    if (f.opponent) {
                        const prob = getCleanSheetProb(p.teamId, f.opponent, f.isHome);
                        csTotal += prob * w;
                        csWeightTotal += w;
                    }
                });
                if (csWeightTotal > 0) {
                    const avgProb = csTotal / csWeightTotal;
                    csProbFactor = (avgProb - 0.28) * 35; // 28% league avg
                }
            }

            // ── Penalty duty, as published ──
            // FPL states the order outright. This used to infer it from a
            // goals-minus-xG gap, which guesses at a published fact and is noise
            // one gameweek in — and left this ranking disagreeing with the Routes
            // tab about who takes penalties for the same club.
            let penTakerBonus = 0;
            if (pos !== 'GK' && p.penaltiesOrder != null) {
                penTakerBonus = p.penaltiesOrder === 1 ? 6 : p.penaltiesOrder === 2 ? 2 : 0;
            }

            // ── Improvement #6: Rotation risk penalty ──
            let rotationPenalty = 0;
            if (p.teamId && teamFixtures[p.teamId]) {
                // Check if team has a midweek match in the next 2 gameweeks
                const upcomingFixtures = teamFixtures[p.teamId].slice(0, 4);
                const hasCongestion = upcomingFixtures.length >= 3; // 3+ fixtures in short window
                if (hasCongestion && minsPerGame < 85) {
                    rotationPenalty = -2; // rotation risk for non-nailed players
                }
            }

            /* ── Expected points: the anchor ──
               The ranking and the badge on the card now come from the same call.
               They once did not: the ranking used calculateExpectedPoints, a
               one-gameweek model in compare-report.js, while the card displayed
               calculateMultiGWxPts over five. Across 200 players the ratio between
               them ran from 0.0 to 23.9 with a median of 3.7, which put cards on
               screen in an order their own xP badge contradicted.

               Both were then this page's private models, and both are gone. This
               is scripts/xp-engine.js, the same projection behind the squad pitch,
               the captain pick and the transfer deltas — so a player's xP here and
               his xP on the squad page are one number rather than two estimates
               that happen to sit on different screens.

               It also carries real weight. The old term contributed roughly 1-2
               points to scores that ran past 120, so the headline number on the
               card was barely influencing the order it appeared in. */
            const xp5 = paXP5(p) || 0;
            const xPtsFactor = xp5 * 2.5;

            // ── ENHANCEMENT: Fixture swing bonus (from teams-analysis) ──
            // Rewards players whose teams have improving fixture runs (next 3 GWs easier than GW4-6)
            let fixtureSwingBonus = 0;
            if (fixtureSwingData && fixtureSwingData[p.teamId]) {
                const swing = fixtureSwingData[p.teamId];
                if (swing.direction === 'improving') {
                    fixtureSwingBonus = Math.min(3, Math.abs(swing.swing) * 2);
                } else if (swing.direction === 'worsening') {
                    fixtureSwingBonus = -Math.min(3, Math.abs(swing.swing) * 2);
                }
            }

            // ── ENHANCEMENT: Easy run bonus ──
            // Players on teams with very easy upcoming fixtures get extra credit
            let easyRunBonus = 0;
            const avgFdr3 = p.fixtures?.avgFDR3 || 3;
            if (avgFdr3 <= 2.0) easyRunBonus = 3;       // premium easy run
            else if (avgFdr3 <= 2.5) easyRunBonus = 2;   // great easy run
            else if (avgFdr3 <= 2.8) easyRunBonus = 1;   // good easy run

            // ── ENHANCEMENT: Team xG trend bonus (from teams-analysis) ──
            // Rewards players on teams whose underlying xG process is improving
            let xgTrendBonus = 0;
            if (ts) {
                if ((pos === 'MID' || pos === 'FWD') && ts.xgTrend === 'rising') {
                    xgTrendBonus = Math.min(2, (ts.xgTrendDelta || 0) * 3);
                } else if ((pos === 'GK' || pos === 'DEF') && ts.xgcTrend === 'improving') {
                    xgTrendBonus = Math.min(2, (ts.xgcTrendDelta || 0) * 3);
                }
            }

            // ── ENHANCEMENT: Rising Form momentum bonus ──
            // Cross-wires the Rising Form 3-pillar analysis into recommendations
            let risingFormBonus = 0;
            if (window._risingFormScores && window._risingFormScores[p.id]) {
                // Rising Form scores 0-100 since the engine rewrite; this used
                // to multiply a single-digit score by 0.4, which against the new
                // scale would cap every rising player at the same 5.
                risingFormBonus = Math.min(5, window._risingFormScores[p.id] / 20);
            }

            // ── ENHANCEMENT: Purple Patch sustainability bonus ──
            // Cross-wires Purple Patch sustainability engine into recommendations
            // SUSTAINABLE patches get a boost; FADING ones get a penalty
            let purplePatchBonus = 0;
            if (window._purplePatchScores && window._purplePatchScores[p.id]) {
                const pp = window._purplePatchScores[p.id];
                if (pp.verdict === 'SUSTAINABLE') {
                    purplePatchBonus = Math.min(6, pp.score * 0.08);
                } else if (pp.verdict === 'MONITOR') {
                    purplePatchBonus = Math.min(2, pp.score * 0.03);
                } else if (pp.verdict === 'FADING') {
                    purplePatchBonus = -Math.min(3, (100 - pp.score) * 0.04);
                }
            }

            // ── ENHANCEMENT: Routes to Points diversity bonus ──
            // Players with multiple reliable routes to points are inherently more valuable
            let routesDiversityBonus = 0;
            if (window._routesData && window._routesData[p.id]) {
                const rd = window._routesData[p.id];
                if (rd.routeCount >= 3) routesDiversityBonus += rd.routeCount * 0.8;
                routesDiversityBonus += Math.min(3, (rd.compositeScore || 0) * 0.15);
                routesDiversityBonus = Math.min(7, routesDiversityBonus);
            }

            // ── ENHANCEMENT: Reliability & explosiveness bonus ──
            // Rewards consistent returners and high-ceiling players from chart metrics
            let reliabilityBonus = 0;
            if (p.season && p.season.games >= 5 && p.history && p.history.length >= 5) {
                const seasonGames = p.season.games;
                const returns = (p.season.goals || 0) + (p.season.assists || 0) + (p.season.cleanSheets || 0) + (p.season.bonus || 0);
                const reliabilityPct = Math.min(100, (returns / seasonGames) * 100);
                // Count games with 10+ points for explosiveness
                const doubleDigits = p.history.filter(g => (parseFloat(g.total_points) || 0) >= 10).length;
                const explosivenessPct = (doubleDigits / seasonGames) * 100;
                reliabilityBonus = (reliabilityPct - 40) * 0.06 + explosivenessPct * 0.05;
                reliabilityBonus = Math.max(-3, Math.min(3, reliabilityBonus));
            }

            /* Fixture-first: the difficulty rating itself, weighted 3/2/1 over the
               next three, on the same 1-5 scale the fixture blocks on the card
               print. Deliberately NOT an amplification of fixtureFactor above —
               see REC_FDR_WEIGHT for the measurement that ruled that out.

               Home is worth a quarter of a difficulty step. FPL's own ratings are
               venue-blind, so an away trip and a home tie against the same club
               carry the same number, and a quarter-step is the smallest
               adjustment that breaks that tie without inventing a bigger one. */
            let fdrFactor = 0;
            if (recFixtureMode === 'fixtures' && next3.length > 0) {
                let wSum = 0, wTot = 0;
                next3.slice(0, 3).forEach((f, idx) => {
                    const w = fixtureWeights[idx] || 1;
                    wSum += ((f.difficulty || 3) - (f.isHome ? 0.25 : 0)) * w;
                    wTot += w;
                });
                const wFdr = wTot ? wSum / wTot : 3;
                fdrFactor = (3 - wFdr) * REC_FDR_WEIGHT;
            }

            // Sum of all enhancement bonuses
            const enhancementBonus = fixtureSwingBonus + easyRunBonus + xgTrendBonus + risingFormBonus + purplePatchBonus + routesDiversityBonus + reliabilityBonus;

            if (pos === 'GK') {
                // The raw clean-sheet term is gone. A clean sheet was being paid
                // for five times over — here, in csProbFactor, in defScore via
                // xGC, in rwPtsPerGame (a clean sheet IS four points) and again in
                // value, which is those same points per million. Measured on live
                // data that produced a 98.7-point gap between keepers who kept one
                // in a single match and keepers who did not. The forward-looking
                // csProbFactor is the one a recommendation should turn on.
                const savesPerGame = rg((p.l5?.saves || 0) / games, recBase.saves);
                const xGCPerGame = rg((p.l5?.xGC || 0) / games, recBase.gc);
                const defScore = Math.max(0, (2 - xGCPerGame)) * 8;

                return ((savesPerGame * 2) +
                       defScore +
                       (rwPtsPerGame * 3) +
                       (value * valueWeight) +
                       fixtureFactor +
                       fdrFactor +
                       teamQualityFactor +
                       teamFormFactor +
                       csProbFactor +
                       xPtsFactor +
                       rotationPenalty +
                       nailedBonus +
                       enhancementBonus) * venueMultiplier;
            }

            if (pos === 'DEF') {
                // Same removal as GK above — csProbFactor carries the clean sheet.
                const xGCPerGame = rg((p.l5?.xGC || 0) / games, recBase.gc);
                const defScore = Math.max(0, (2 - xGCPerGame)) * 8;

                return (defScore +
                       (rwXGI * 12) +
                       (rwPtsPerGame * 3) +
                       (value * valueWeight) +
                       fixtureFactor +
                       fdrFactor +
                       teamQualityFactor +
                       teamFormFactor +
                       csProbFactor +
                       xPtsFactor +
                       rotationPenalty +
                       penTakerBonus +
                       nailedBonus +
                       enhancementBonus) * venueMultiplier;
            }

            if (pos === 'MID') {
                const csPerGame = rg((p.l5?.cleanSheets || 0) / games, recBase.cs);
                const actualGI = ((p.l5?.goals || 0) + (p.l5?.assists || 0)) / games;
                const overPerf = actualGI - rwXGI;
                const regressionAdj = overPerf > 0 ? overPerf * -3 : overPerf * -2;
                
                return ((rwXGI * 40) +
                       regressionAdj +
                       (csPerGame * 3) +
                       (rwPtsPerGame * 3) +
                       (rwBonus * 2) +
                       (value * valueWeight) +
                       fixtureFactor +
                       fdrFactor +
                       teamQualityFactor +
                       teamFormFactor +
                       xPtsFactor +
                       rotationPenalty +
                       penTakerBonus +
                       nailedBonus +
                       enhancementBonus) * venueMultiplier;
            }

            if (pos === 'FWD') {
                const actualGoals = (p.l5?.goals || 0) / games;
                const overPerf = actualGoals - rwXG;
                // Dampen regression for consistently clinical finishers (15+ season games of outperformance)
                const regrCoeff = (overPerf > 0 && (p.season?.games || 0) >= 15 && ((p.season?.goals || 0) / (p.season?.games || 1)) > ((p.season?.xG || 0) / (p.season?.games || 1))) ? -2 : -4;
                const regressionAdj = overPerf > 0 ? overPerf * regrCoeff : overPerf * -2;
                
                return ((rwXG * 40) +
                       (rwXA * 15) +
                       regressionAdj +
                       (rwPtsPerGame * 3) +
                       (rwBonus * 2) +
                       (value * valueWeight) +
                       fixtureFactor +
                       fdrFactor +
                       teamQualityFactor +
                       teamFormFactor +
                       xPtsFactor +
                       rotationPenalty +
                       penTakerBonus +
                       nailedBonus +
                       enhancementBonus) * venueMultiplier;
            }

            return 0;
        }

        function getDisplayMetrics(p, pos) {
            const games = p.l5?.games || 1;
            
            if (pos === 'GK') {
                return {
                    primary: { label: 'CS', value: p.l5?.cleanSheets || 0 },
                    secondary: { label: 'Saves', value: p.l5?.saves || 0 },
                    tertiary: { label: 'GC', value: p.l5?.goalsConceded || 0, inverse: true }
                };
            }
            
            if (pos === 'DEF') {
                const xGI = (p.l5?.xGI || 0) / games;
                return {
                    primary: { label: 'CS', value: p.l5?.cleanSheets || 0 },
                    secondary: { label: 'GC', value: p.l5?.goalsConceded || 0, inverse: true },
                    tertiary: xGI >= 0.15 ? { label: 'xGI', value: xGI.toFixed(2) } : { label: 'xGC', value: ((p.l5?.xGC || 0) / games).toFixed(1), inverse: true }
                };
            }
            
            if (pos === 'MID') {
                return {
                    primary: { label: 'xGI', value: ((p.l5?.xGI || 0) / games).toFixed(2) },
                    secondary: { label: 'G', value: p.l5?.goals || 0 },
                    tertiary: { label: 'A', value: p.l5?.assists || 0 }
                };
            }
            
            if (pos === 'FWD') {
                return {
                    primary: { label: 'xG', value: ((p.l5?.xG || 0) / games).toFixed(2) },
                    secondary: { label: 'G', value: p.l5?.goals || 0 },
                    tertiary: { label: 'xGI', value: ((p.l5?.xGI || 0) / games).toFixed(2) }
                };
            }
            
            return {};
        }

        function getRecWhyBadge(p, pos) {
            return '';
        }

        // ===== RECOMMENDATION CARDS =====
        // Club colours, used as a tint rather than a fill. A full team-coloured
        // background would put white text on Spurs white and Newcastle black, so
        // the colour becomes a low-opacity wash and an edge instead.
        const REC_TEAM_COLORS = {
            ARS: '#EF0107', AVL: '#95BFE5', BHA: '#0057B8', BOU: '#DA291C', BRE: '#E30613',
            CHE: '#034694', COV: '#78D0F3', CRY: '#1B458F', EVE: '#003399', FUL: '#CC0000',
            HUL: '#F5A12D', IPS: '#3A64A3', LEE: '#FFCD00', LIV: '#C8102E', MCI: '#6CABDD',
            MUN: '#DA291C', NEW: '#41B6E6', NFO: '#DD0000', SUN: '#EB172B', TOT: '#132257'
        };
        function recTeamColor(shortName) { return REC_TEAM_COLORS[shortName] || 'var(--color-primary)'; }

        // How safe the minutes are. A top-ranked player who might not start is the
        // most expensive mistake this page can encourage, so it goes on the card.
        function recMinutesRisk(p) {
            const games = p.l5?.games || 0;
            const mpg = games ? (p.l5.minutes || 0) / games : 0;
            if (p.status === 'i' || p.status === 'u' || p.status === 's') {
                return { cls: 'bad', word: 'Unavailable', detail: (p.news || 'Not expected to feature').split('.')[0] };
            }
            if (p.status === 'd') {
                return { cls: 'warn', word: 'Fitness doubt',
                    detail: (p.news || 'Carrying a knock').split('.')[0] + (p.chanceNextRound != null ? ` — ${p.chanceNextRound}% chance` : '') };
            }
            if (!games) return { cls: 'warn', word: 'No minutes yet', detail: 'Has not played this season' };
            if (mpg >= 80) return { cls: 'good', word: 'Nailed on', detail: `${Math.round(mpg)} mins per appearance` };
            if (mpg >= 60) return { cls: 'good', word: 'Regular starter', detail: `${Math.round(mpg)} mins per appearance` };
            if (mpg >= 30) return { cls: 'warn', word: 'Rotation risk', detail: `Only ${Math.round(mpg)} mins per appearance` };
            return { cls: 'bad', word: 'Fringe player', detail: `${Math.round(mpg)} mins per appearance` };
        }

        // Whether the market is about to move the price. Buying before a rise is
        // free money; buying into a fall is not.
        function recPricePressure(p) {
            const net = (p.transfersIn || 0) - (p.transfersOut || 0);
            if (Math.abs(net) < 1000) return null;
            const owners = Math.max(((p.selectedBy || 0) / 100) * 9500000, 1);
            const velocity = net / owners;
            if (velocity > 0.04) return { cls: 'rise', text: 'Price rising', detail: `${net > 0 ? '+' : ''}${net.toLocaleString()} net transfers in — buying before a rise saves money later.` };
            if (velocity < -0.04) return { cls: 'fall', text: 'Price falling', detail: `${net.toLocaleString()} net transfers out — the price may drop before you need to sell.` };
            return null;
        }

        // The three things doing most of the work in this player's ranking, so the
        // order is auditable rather than asserted.
        function recScoreDrivers(p, pos) {
            const games = p.l5?.games || 1;
            const mpg = (p.l5?.minutes || 0) / games;
            const fdr = p.fixtures?.avgFDR3 ?? 3;
            const ppg = (p.l5?.points || 0) / games;
            const value = ppg / Math.max(p.price, 3.5);
            const xgi90 = (p.l5?.minutes || 0) > 0 ? ((p.l5?.xGI || 0) / p.l5.minutes) * 90 : 0;
            const csRate = games ? (p.l5?.cleanSheets || 0) / games : 0;

            const all = [
                { k: 'Fixtures', v: 3 - fdr, label: `${fdr.toFixed(1)} average difficulty over three` },
                { k: 'Minutes', v: (mpg - 60) / 30, label: `${Math.round(mpg)} mins per appearance` },
                { k: 'Value', v: value - 0.6, label: `${value.toFixed(2)} points per million` },
                { k: 'Returns', v: ppg / 5 - 0.5, label: `${ppg.toFixed(1)} points per game` }
            ];
            if (pos === 'GK' || pos === 'DEF') all.push({ k: 'Clean sheets', v: csRate - 0.25, label: `${Math.round(csRate * 100)}% of games` });
            else all.push({ k: 'Threat', v: xgi90 - 0.35, label: `${xgi90.toFixed(2)} xGI per 90` });

            return all.filter(d => d.v > 0).sort((a, b) => b.v - a.v).slice(0, 3);
        }

        // A sentence a scout would actually say, assembled from the strongest true
        // signals. No claim appears here that is not read off the numbers.
        function buildScoutVerdict(p, pos) {
            const games = p.l5?.games || 0;
            const mpg = games ? (p.l5.minutes || 0) / games : 0;
            const fdr = p.fixtures?.avgFDR3 ?? 3;
            const next3 = (p.fixtures?.next3 || []).slice(0, 3);
            const easy = next3.filter(f => (f.difficulty || 3) <= 2).length;
            const ppg = games ? (p.l5.points || 0) / games : 0;
            const xgi90 = (p.l5?.minutes || 0) > 0 ? ((p.l5.xGI || 0) / p.l5.minutes) * 90 : 0;
            const savesPer = games ? (p.l5.saves || 0) / games : 0;
            const risk = recMinutesRisk(p);
            const bits = [];

            // Lead with what this position is bought for.
            if (pos === 'GK') {
                bits.push(savesPer >= 3.5
                    ? (games >= 3
                        ? `Busy keeper averaging ${savesPer.toFixed(1)} saves a game, which pays even when the clean sheet does not arrive`
                        : `Made ${p.l5.saves} save${(p.l5.saves || 0) === 1 ? '' : 's'} across ${games} game${games === 1 ? '' : 's'} — save points add up behind a busy defence`)
                    : `Keeper at £${p.price.toFixed(1)}m behind a defence conceding ${((p.l5?.goalsConceded || 0) / Math.max(games, 1)).toFixed(1)} a game`);
            } else if (pos === 'DEF') {
                const cs = games ? (p.l5.cleanSheets || 0) / games : 0;
                bits.push(cs >= 0.3
                    ? (games >= 3
                        ? `Clean sheet in ${Math.round(cs * 100)}% of his games so far`
                        : `${p.l5.cleanSheets} clean sheet${(p.l5.cleanSheets || 0) === 1 ? '' : 's'} from ${games} game${games === 1 ? '' : 's'}`)
                    : xgi90 >= 0.25
                        ? `Defender carrying real attacking threat at ${xgi90.toFixed(2)} xGI per 90`
                        : `Budget defender at £${p.price.toFixed(1)}m holding down a starting place`);
            } else {
                bits.push(xgi90 >= 0.5
                    ? `Creating and finishing chances at ${xgi90.toFixed(2)} xGI per 90, elite for the price`
                    : xgi90 >= 0.3
                        ? `Involved in enough at ${xgi90.toFixed(2)} xGI per 90 to justify a place`
                        : `Returning ${ppg.toFixed(1)} points a game at £${p.price.toFixed(1)}m`);
            }

            // Then the fixtures, which is what makes it a move now rather than later.
            if (easy >= 2) bits.push(`with ${easy} of the next three rated easy`);
            else if (fdr >= 3.8) bits.push(`though the next three are hard at ${fdr.toFixed(1)} average difficulty`);
            else bits.push(`into a middling run at ${fdr.toFixed(1)} average difficulty`);

            let verdict = bits.join(', ') + '.';

            // And the caveat, if there is one worth naming.
            if (risk.cls === 'bad') verdict += ` ${risk.word} — ${risk.detail}.`;
            else if (risk.cls === 'warn') verdict += ` Watch the minutes: ${risk.detail.toLowerCase()}.`;
            else if (mpg >= 80) verdict += ` Minutes are secure at ${Math.round(mpg)} a game.`;

            if (games <= 2) verdict += ` Based on ${games} game${games === 1 ? '' : 's'} so far.`;
            return verdict;
        }

        // Points per gameweek as a sparkline. With one round played there is no
        // line to draw, so it says so rather than showing a misleading flat trace.
        function recSparkline(p) {
            const hist = (p.history || []).filter(h => h.round != null).slice(-5);
            if (hist.length < 2) {
                const only = hist[0];
                return `<div class="rec-spark-empty">${only
                    ? `GW${only.round}: <strong>${only.total_points} pts</strong> — one gameweek so far, no trend to read yet`
                    : 'No gameweek history yet'}</div>`;
            }
            const pts = hist.map(h => h.total_points || 0);
            const max = Math.max(...pts, 1), min = Math.min(...pts, 0);
            const range = Math.max(max - min, 1);
            const w = 100, h = 28;
            const step = w / (pts.length - 1);
            const coords = pts.map((v, i) => [i * step, h - ((v - min) / range) * (h - 4) - 2]);
            const line = coords.map((c, i) => `${i ? 'L' : 'M'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');
            const area = `${line} L${w},${h} L0,${h} Z`;
            const trend = pts[pts.length - 1] >= pts[0] ? 'up' : 'down';
            return `<div class="rec-spark ${trend}" data-tooltip="Points in each of the last ${pts.length} gameweeks: ${pts.join(', ')}.">
                <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
                    <path class="rec-spark-area" d="${area}"/><path class="rec-spark-line" d="${line}"/>
                    ${coords.map(c => `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="1.6"/>`).join('')}
                </svg>
                <span class="rec-spark-label">GW${hist[0].round}–${hist[hist.length - 1].round} · ${pts.join(' · ')}</span>
            </div>`;
        }

        // Icon-paired pills. The player's strongest suit is highlighted so the
        // reason to own him is visible before any number is read.
        function recStatPills(p, pos) {
            const games = p.l5?.games || 1;
            const mins = p.l5?.minutes || 0;
            const per90 = v => mins > 0 ? (v / mins) * 90 : 0;
            const ppg = (p.l5?.points || 0) / games;
            const thin = games < 3;
            const csCount = p.l5?.cleanSheets || 0;
            // A percentage needs a denominator worth dividing by. One clean sheet
            // in one game is "1 of 1", not "100%" — the latter reads as a rate.
            const csPill = pct => thin
                ? { v: `${csCount}/${games}`, l: 'clean sheets' }
                : { v: pct + '%', l: 'clean sheets' };
            const pills = [];

            if (pos === 'GK') {
                const sv = per90(p.l5?.saves || 0);
                const csPct = Math.round(((p.l5?.cleanSheets || 0) / games) * 100);
                pills.push({ icon: '', v: sv.toFixed(1), l: 'saves/90', good: sv >= 3.5 });
                pills.push({ icon: '', ...csPill(csPct), good: csPct >= 30 });
                pills.push({ icon: '', v: per90(p.l5?.goalsConceded || 0).toFixed(1), l: 'conceded/90', good: per90(p.l5?.goalsConceded || 0) <= 1.0 });
            } else if (pos === 'DEF') {
                const csPct = Math.round(((p.l5?.cleanSheets || 0) / games) * 100);
                pills.push({ icon: '', ...csPill(csPct), good: csPct >= 30 });
                pills.push({ icon: '', v: per90(p.l5?.xGI || 0).toFixed(2), l: 'xGI/90', good: per90(p.l5?.xGI || 0) >= 0.25 });
                pills.push({ icon: '', v: per90(p.l5?.goalsConceded || 0).toFixed(1), l: 'conceded/90', good: per90(p.l5?.goalsConceded || 0) <= 1.0 });
            } else {
                pills.push({ icon: '', v: per90(p.l5?.xGI || 0).toFixed(2), l: 'xGI/90', good: per90(p.l5?.xGI || 0) >= 0.5 });
                pills.push({ icon: '', v: per90(p.l5?.xG || 0).toFixed(2), l: 'xG/90', good: per90(p.l5?.xG || 0) >= 0.35 });
                pills.push({ icon: 'A', v: per90(p.l5?.xA || 0).toFixed(2), l: 'xA/90', good: per90(p.l5?.xA || 0) >= 0.25 });
            }
            pills.push({ icon: '', v: ppg.toFixed(1), l: 'pts/game', good: ppg >= 5 });

            // Highlighting a rate computed from one game says "this is his level"
            // when it only says "this is what happened once".
            const enoughForClaims = games >= 3;
            const rendered = pills.map(s => `<span class="rec-pill ${s.good && enoughForClaims ? 'standout' : ''}">
                <span class="rec-pill-i">${s.icon}</span><strong>${s.v}</strong><span class="rec-pill-l">${s.l}</span></span>`).join('');
            // One chip stating the sample beats qualifying every label individually.
            return rendered + (enoughForClaims ? '' : `<span class="rec-pill sample" data-tooltip="Season is ${games} game${games === 1 ? '' : 's'} old, so these are single results rather than established rates.">
                <span class="rec-pill-i">${v2Icon('ruler')}</span><strong>${games}</strong><span class="rec-pill-l">game${games === 1 ? '' : 's'} so far</span></span>`);
        }

        // Larger blocks carrying opponent, venue and the difficulty number itself,
        // so the colour is backed by a figure rather than being the only signal.
        function recFixtureHeatmap(p, count) {
            const FDR_WORD = { 1: 'Very easy', 2: 'Easy', 3: 'Average', 4: 'Hard', 5: 'Very hard' };
            const fx = (p.fixtures?.next5 || p.fixtures?.next3 || []).slice(0, count || 3);
            if (!fx.length) return '<div class="rec-fixtures"><span class="rec-fix rec-fix-none">No fixtures scheduled</span></div>';
            return `<div class="rec-fixtures">${fx.map(f => {
                const opp = (f.opponent && teams[f.opponent]) ? teams[f.opponent].short_name : '???';
                const d = f.difficulty || 3;
                return `<span class="rec-fix fdr-${d}" data-tooltip="GW${f.event || '?'}: ${f.isHome ? 'home to' : 'away at'} ${escHTML(opp)} — difficulty ${d} (${FDR_WORD[d]})">
                    <span class="rec-fix-gw">GW${f.event || '?'}</span>
                    <span class="rec-fix-opp">${escHTML(opp)} <span class="rec-fix-ha">${f.isHome ? 'H' : 'A'}</span></span>
                    <span class="rec-fix-fdr">${d}</span>
                </span>`;
            }).join('')}</div>`;
        }

        function renderRecCard(p, rank, pos, isDifferential = false, featured = false) {
            const xPts = paXP5(p);
            const risk = recMinutesRisk(p);
            const price = recPricePressure(p);
            const drivers = recScoreDrivers(p, pos);
            const accent = recTeamColor(p.team);

            const xpBadge = xPts !== null
                ? `<span class="rec-xp" data-tooltip="Projected points across the next five gameweeks, from this player's recent rates, expected minutes and fixtures.">${xPts}<span class="rec-xp-u">xP5</span></span>`
                : `<span class="rec-xp muted" data-tooltip="Not enough minutes on record to project this player yet.">—<span class="rec-xp-u">xP5</span></span>`;

            /* The percentage itself is in the hero. What is worth saying twice
               is not the number but what it means — a bet against the field or
               a risk of not owning him — so the body carries the reading and
               drops the figure. A card that prints "3.2% owned" twice is a
               card that has run out of things to say. */
            const own = p.selectedBy || 0;
            const ownLine = own < 5
                ? `<span class="rec-own diff" data-tooltip="Under 5% owned. Points he scores are points most of the field does not have.">Differential</span>`
                : own > 25
                ? `<span class="rec-own template" data-tooltip="Widely owned. Not owning him is itself a risk — his hauls cost you rank even though you never bought him.">Template</span>`
                : `<span class="rec-own" data-tooltip="Moderately owned — neither a bet against the field nor a hedge with it.">Middling ownership</span>`;

            /* The header is the site's player hero, at card size: the name
               over the club's colour with the portrait standing on the bottom
               edge and the crest beside the club. It is what the player modal
               has always used and what every card here was reinventing badly —
               a small round face beside a line of text, once per page, each a
               bit different. One header, three sizes, in common.js.

               The position rides in it as the sub, since the hero already has
               a line for "who, and for whom". */
            const POS_SHORT = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
            const hero = typeof v2PlayerHeroHTML === 'function'
                ? v2PlayerHeroHTML(p, {
                    size: featured ? 'compact' : 'compact',
                    sub: POS_SHORT[p.position] || '',
                    chip: featured ? 'TOP PICK' : '#' + rank,
                    chipClass: featured ? 'v-star' : ''
                })
                : '';

            return `
                <div class="rec-card-v2 has-hero ${featured ? 'featured' : ''}" style="--rec-accent:${accent};" onclick="openPlayerModal(${p.id})">
                    ${getStarHtml(p.id, 'shortlist-star-card')}
                    ${hero}
                    <div class="rec-body">
                    <div class="rec-head">
                        <div class="rec-id">
                            <span class="rec-own-line">${ownLine}</span>
                        </div>
                        ${xpBadge}
                    </div>

                    <div class="rec-verdict">
                        <span class="rec-verdict-tag">Scout's verdict</span>
                        <p>${escHTML(buildScoutVerdict(p, pos))}</p>
                    </div>

                    <div class="rec-flags">
                        <span class="rec-flag ${risk.cls}" data-tooltip="${escHTML(risk.detail)}">${risk.word}</span>
                        ${price ? `<span class="rec-flag ${price.cls}" data-tooltip="${escHTML(price.detail)}">${price.text}</span>` : ''}
                    </div>

                    <div class="rec-pills">${recStatPills(p, pos)}</div>

                    ${recSparkline(p)}

                    ${recFixtureHeatmap(p, featured ? 5 : 3)}

                    ${drivers.length ? `<div class="rec-drivers">
                        <span class="rec-drivers-l">Ranked here on</span>
                        ${drivers.map(d => `<span class="rec-driver" data-tooltip="${escHTML(d.label)}">${escHTML(d.k)}</span>`).join('')}
                    </div>` : ''}
                    </div>
                </div>`;
        }

        // Rank 1 leads full width; the rest fall into the grid beneath it.
        function recCardList(players, pos, isDiff) {
            if (!players.length) return '';
            const [first, ...rest] = players;
            return renderRecCard(first, 1, pos, isDiff, true)
                + (rest.length ? `<div class="rec-grid">${rest.map((p, i) => renderRecCard(p, i + 2, pos, isDiff, false)).join('')}</div>` : '');
        }

        function getBudgetCap(pos) {
            return BUDGET_CAPS[pos] || 6.0;
        }

        // Track active rec category per position
        window._activeRecCat = { ALL: 'budget', GK: 'budget', DEF: 'budget', MID: 'budget', FWD: 'budget' };

        function switchRecCategory(pos, category) {
            setRecTier(category);
        }

        /* The tier the Recommendations panel is showing. It was three buttons
           repeated inside every position panel plus a fourth copy in the
           retired global filter bar, all writing the same per-position map;
           it is one menu in the panel head now, and one answer for the whole
           tab — you do not want budget forwards and premium defenders at the
           same time, and nothing in the page ever let you see both at once
           anyway. */
        function recActiveTier() {
            return (window._activeRecCat && window._activeRecCat[activeGlobalPosition]) || 'budget';
        }

        function setRecTier(category) {
            ['ALL', 'GK', 'DEF', 'MID', 'FWD'].forEach(pos => {
                window._activeRecCat[pos] = category;
                document.querySelectorAll(`[id^="recCat-${pos}-"]`).forEach(p => p.classList.remove('active'));
                document.getElementById(`recCat-${pos}-${category}`)?.classList.add('active');
            });
            if (typeof v2MenuCloseAll === 'function') v2MenuCloseAll();
            const label = { budget: 'Budget', premium: 'Premium', differential: 'Differentials' }[category] || category;
            const host = document.getElementById('v2menu-rec-tier');
            if (host) {
                const v = host.querySelector('.v2-menu-v');
                if (v) v.textContent = label;
                host.querySelectorAll('.v2-menu-opt').forEach(o =>
                    o.classList.toggle('is-on', (o.getAttribute('onclick') || '').includes(`'${category}'`)));
            }
        }

        function switchGlobalCategory(category) {
            setRecTier(category);
        }

        // ============================================
        // UNIFIED POSITION SWITCHING
        // ============================================
        /* All, not GK. Every one of these tabs opened on goalkeepers — two
           of whom you own — because GK happened to be first in the list, and
           you had to click past it every time to see anything. */
        let activeGlobalPosition = 'ALL';

        function switchGlobalPosition(pos, btn) {
            activeGlobalPosition = pos;
            // Update position pills
            document.querySelectorAll('#posPills .fp-pill').forEach(p => p.classList.remove('active'));
            document.querySelector(`#posPills .fp-pill[data-pos="${pos}"]`)?.classList.add('active');

            /* Each panel draws its own copy of the pills, and they all drive
               this one variable — so every copy is re-marked, not just the one
               that was clicked. Selecting by the position rather than by the
               clicked element is what makes a click in Routes leave
               Recommendations showing the same position when you get there. */
            document.querySelectorAll('.pa-filter-pill').forEach(p =>
                p.classList.toggle('active', p.dataset.paPos === pos));

            // Switch Recommendations panel
            document.querySelectorAll('[id^="rec-panel-"]').forEach(p => p.classList.remove('active'));
            document.getElementById('rec-panel-' + pos)?.classList.add('active');

            // Switch Rising panel
            document.querySelectorAll('[id^="rising-panel-"]').forEach(p => p.classList.remove('active'));
            document.getElementById('rising-panel-' + pos)?.classList.add('active');

            // Switch Purple Patch panel
            document.querySelectorAll('[id^="pp-panel-"]').forEach(p => p.classList.remove('active'));
            document.getElementById('pp-panel-' + pos)?.classList.add('active');

            /* Rising and Purple Patch used to draw their own sub-tab strips.
               They are gone: both now show the same .pa-filter-pills every
               other panel does, and those are re-marked above. */

            // Re-filter Routes database view for this position
            window._routesDbOffset = 30;
            renderRoutesDatabaseView();
        }

        function switchRecTab(pos, btn) {
            switchGlobalPosition(pos);
        }

        function switchRoutesTab(pos, btn) {
            switchGlobalPosition(pos);
        }

        window._routesDbOffset = 30;

        /* Proportional or raw, for the stacked bar on every routes card.
           Module state rather than a class poked onto the section, so the
           menu in the panel head can be built already showing the right
           answer when the tab re-renders. */
        let routesMode = 'prop';

        function getFilteredRoutesPlayers() {
            if (!window._allRoutesPlayers) return [];
            const pos = activeGlobalPosition;
            let players = (pos && pos !== 'ALL')
                ? window._allRoutesPlayers.filter(p => p.pos === pos)
                : window._allRoutesPlayers;
            return players.sort((a, b) => b.compositeScore - a.compositeScore);
        }

        function renderRoutesDatabaseView() {
            const grid = document.getElementById('routesDatabaseGrid');
            if (!grid) return;
            const filtered = getFilteredRoutesPlayers();
            const players = filtered.slice(0, window._routesDbOffset);
            grid.innerHTML = players.map((p, i) => renderRouteCard(p, i + 1)).join('');
            const loadMoreWrap = grid.parentElement?.querySelector('.routes-load-more-wrap');
            if (loadMoreWrap) {
                loadMoreWrap.style.display = window._routesDbOffset < filtered.length ? '' : 'none';
            }
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        function switchRoutesMode(mode) {
            routesMode = mode === 'raw' ? 'raw' : 'prop';
            const sec = document.getElementById('routesSection');
            if (sec) {
                sec.classList.toggle('mode-raw', routesMode === 'raw');
                sec.classList.toggle('mode-prop', routesMode !== 'raw');
            }
            const host = document.getElementById('v2menu-routes-mode');
            if (host) {
                const v = host.querySelector('.v2-menu-v');
                if (v) v.textContent = routesMode === 'raw' ? 'Raw stats' : 'Proportional';
                host.querySelectorAll('.v2-menu-opt').forEach(o =>
                    o.classList.toggle('is-on', (o.getAttribute('onclick') || '').includes(`'${routesMode}'`)));
            }
            if (typeof v2MenuCloseAll === 'function') v2MenuCloseAll();
        }

        function filterRoutesDatabase(query) {
            const grid = document.getElementById('routesDatabaseGrid');
            if (!grid || !window._allRoutesPlayers) return;
            const q = query.trim().toLowerCase();
            const base = getFilteredRoutesPlayers();
            const filtered = q
                ? base.filter(p => p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q))
                : base.slice(0, window._routesDbOffset);
            grid.innerHTML = filtered.map((p, i) => renderRouteCard(p, i + 1)).join('');
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        function loadMoreRoutes() {
            if (!window._allRoutesPlayers) return;
            const filtered = getFilteredRoutesPlayers();
            window._routesDbOffset = Math.min(filtered.length, window._routesDbOffset + 30);
            const grid = document.getElementById('routesDatabaseGrid');
            if (!grid) return;
            const players = filtered.slice(0, window._routesDbOffset);
            grid.innerHTML = players.map((p, i) => renderRouteCard(p, i + 1)).join('');
            // Hide load-more if all shown
            const loadMoreWrap = grid.parentElement?.querySelector('.routes-load-more-wrap');
            if (loadMoreWrap) {
                loadMoreWrap.style.display = window._routesDbOffset >= filtered.length ? 'none' : '';
            }
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        function switchRisingTab(pos, btn) {
            switchGlobalPosition(pos);
        }

        // ============================================
        // RISING FORM — Players Picking Up Form
        // ============================================
        /* Rising Form — one engine, in scripts/form-trend.js.

           This section used to carry its own copy of the model, and the copy had
           drifted far enough to be worth naming. Three of its six pillars could
           not fire at all: they wanted six match rows, or ten matches from a
           club, out of a five-match season, and scored 0 of 667 players between
           them. Its fixture signal compared the next three gameweeks against the
           three AFTER them, so it fired only when the near fixtures were the
           worse of the two — and it carried the heaviest weight in the model.
           The board that produced ranked hard fixtures above kind ones (top ten
           averaging FDR 3.5, bottom ten 2.4) and filled with substitutes,
           because 180 minutes across five matches is 36 a game.

           risingFormRanked() is the whole of it now, shared with the scouting
           report so the two cannot disagree about who is rising. What this
           section still owns is how the cards are drawn. */
        function generateRisingForm(analyses) {
            if (isPreseason) {
                return renderEmptyState(
                    'Rising Form needs this season’s data',
                    'This tracks week-to-week momentum, which isn’t available until gameweeks start being played. Check back after GW1.',
                    'trending-up'
                );
            }
            /* Eligibility, the pillars, and the fixture and ownership weighting
               all live in the engine now. The fixture list travels with the call
               because "how hard is his next match" is a question about fixtures,
               not about the player. */
            const scored = risingFormRanked(analyses, { fixtures: allFixtures });

            // Split by position
            const byPos = { GK: [], DEF: [], MID: [], FWD: [] };
            scored.forEach(p => byPos[p.pos]?.push(p));

            /* ALL first, and pooled from the same scored list rather than
               concatenated per position, so the ordering across positions is
               the ranking rather than four rankings stacked. */
            const posConfigs = [
                { pos: 'ALL', name: 'Every position', players: scored },
                { pos: 'GK', name: 'Goalkeepers', players: byPos.GK },
                { pos: 'DEF', name: 'Defenders', players: byPos.DEF },
                { pos: 'MID', name: 'Midfielders', players: byPos.MID },
                { pos: 'FWD', name: 'Forwards', players: byPos.FWD }
            ];

            const panels = posConfigs.map(cfg => {
                const posPlayers = cfg.players.slice(0, cfg.pos === 'ALL' ? 24 : 15);
                return `
                    <div class="sub-tab-panel ${cfg.pos === activeGlobalPosition ? 'active' : ''}" id="rising-panel-${cfg.pos}">
                        ${posPlayers.length > 0
                            ? `<div class="rising-grid">${posPlayers.map((p, j) => renderRisingCard(p, j + 1)).join('')}</div>`
                            : (seasonTooYoungNotice(5, 'Rising Form',
                                'It compares a player\u2019s last three matches against the ones before them, so it needs five before it can say anything.')
                                || '<div class="no-players">No players currently picking up form at this position</div>')
                        }
                    </div>
                `;
            }).join('');

            return `
              <div class="pa-panel">
                <div class="pa-panel-head">
                    <span class="pa-panel-title">${paIcon('trending')}Rising form</span>
                    <div class="pa-panel-controls">
                        <div class="pa-filter-pills">${paPositionPills()}</div>
                        <!-- The Legend sits in the panel's own control row, beside the
                             position pills, the way Routes to Points has always had it.
                             It used to get a .section-toolbar of its own below the head,
                             which put one button on a line by itself and set this panel's
                             controls a row lower than every other panel on the page. -->
                        <div class="v2-filter-row-tail">
                            <button class="legend-toggle" onclick="this.classList.toggle('active'); document.getElementById('risingLegend').classList.toggle('show')">
                                <span><i data-lucide="info" style="width:14px;height:14px;display:inline-block;vertical-align:middle;"></i> Legend</span><span class="legend-caret">▾</span>
                            </button>
                        </div>
                    </div>
                </div>
                ${demoPreviewNotice('Rising Form', 5)}
                <div class="rising-section">
                    <div class="legend-panel" id="risingLegend">
                        <span class="legend-panel-item"><span class="legend-panel-dot" style="background:#4ADE80"></span> Team Form</span>
                        <span class="legend-panel-item"><span class="legend-panel-dot" style="background:#34D399"></span> xG Trend</span>
                        <span class="legend-panel-item"><span class="legend-panel-dot" style="background:#C084FC"></span> Regression Due</span>
                        <span class="legend-panel-item"><span class="legend-panel-dot" style="background:#60A5FA"></span> Fixture Swing</span>
                        <span class="legend-panel-item"><span class="legend-panel-dot" style="background:#FBBF24"></span> Stats Improving</span>
                        <span class="legend-panel-item"><span class="legend-panel-dot" style="background:#FB923C"></span> Points Trend</span>
                        <span class="legend-panel-item"><span class="legend-panel-dot" style="background:#A78BFA"></span> Minutes Rising</span>
                    </div>
                    ${panels}
                </div>
              </div>
            `;
        }

        function renderRisingCard(p, rank) {
            /* The recent window and the weighted near-term FDR — the two
               numbers the ranking was actually made of. The card used to show a
               five-match average and a flat three-fixture FDR, neither of which
               was what put the player on the board. */
            const rs = (typeof rfSplit === 'function') ? rfSplit(p) : null;
            const ptsPerGame = rs ? rs.ppgRecent.toFixed(1)
                : ((p.l5?.points || 0) / (p.l5?.games || 1)).toFixed(1);
            const fdr = (typeof p.fdrNear === 'number') ? p.fdrNear : (p.fixtures?.avgFDR3 || 3);
            const fdrClass = fdr <= 2 ? 'fdr-1' : fdr <= 2.5 ? 'fdr-2' : fdr <= 3.5 ? 'fdr-3' : fdr <= 4 ? 'fdr-4' : 'fdr-5';
            const posColors = { GK: '#FBBF24', DEF: '#34D399', MID: '#60A5FA', FWD: '#F87171' };

            /* Same header as a recommendation card and as the modal it opens
               — the site's player hero at card size. What used to be here was
               a rank chip, a name, a position pill and a score, each styled by
               this view alone. The rank rides in the hero's chip and the
               signal count keeps its place under it. */
            const hero = typeof v2PlayerHeroHTML === 'function'
                ? v2PlayerHeroHTML(p, { size: 'compact', sub: p.pos, chip: '#' + rank })
                : '';

            /* One line, above the signals, instead of a stacked block and a
               footer. The count and the fixture difficulty are the two things
               that decide whether the card is worth reading, and FDR needs
               saying out loud — it is an initialism the game itself never
               explains. The points-per-game that used to sit bottom-left is
               gone: it is the "Points trending up" signal's own detail, said
               twice on the same card. */
            const signalWord = p.signalCount === 1 ? 'signal' : 'signals';
            return `
                <div class="rising-card has-hero" onclick="openPlayerModal(${p.id})">
                    ${getStarHtml(p.id, 'shortlist-star-card')}
                    ${hero}
                    <div class="rising-body">
                    <div class="rising-meta">
                        <span class="rising-meta-count">${p.signalCount} ${signalWord}</span>
                        <span class="fdr-badge ${fdrClass} rising-meta-fdr"
                              data-tooltip="Fixture Difficulty Rating — how hard his next few matches look, 1 the kindest and 5 the hardest. Weighted towards the nearest game."
                        >FDR ${fdr.toFixed(1)}</span>
                    </div>
                    <div class="rising-signals">
                        ${p.signals.map(s => `
                            <div class="rising-signal">
                                <div class="rising-signal-head">
                                    <span class="rising-signal-icon"><i data-lucide="${s.icon || 'activity'}" style="width:13px;height:13px;"></i></span>
                                    <span class="rising-signal-label">${s.label}</span>
                                </div>
                                <div class="rising-signal-bar">
                                    <div class="rising-signal-bar-fill" style="width: ${Math.min(100, s.strength * 10)}%; background: ${s.color}"></div>
                                </div>
                                <span class="rising-signal-value positive">${s.detail}</span>
                            </div>
                        `).join('')}
                    </div>
                    </div>
                </div>
            `;
        }

        // ============================================
        // PURPLE PATCH DETECTOR
        // ============================================

        /**
         * Detects whether a player is on a "purple patch" — a sustained hot streak.
         * Returns null if not on a patch, or a patch descriptor object.
         */
        /**
         * Calculates a sustainability score (0-100) across 6 transparent dimensions.
         * Each dimension is scored independently so users can see WHY a patch is sustainable or not.
         */
        /**
         * Pre-computes purple patch scores for cross-wiring into recommendations.
         */
        function precomputePurplePatchScores(analyses) {
            window._purplePatchScores = {};
            analyses.forEach(p => {
                const patch = detectPurplePatch(p);
                if (!patch) return;
                const sust = calculateSustainability(p, patch);
                window._purplePatchScores[p.id] = {
                    score: sust.totalScore,
                    verdict: sust.verdict,
                    l5PPG: patch.l5PPG
                };
            });
        }

        function switchPurplePatchTab(pos, btn) {
            switchGlobalPosition(pos);
        }

        /**
         * Generates the Purple Patch tab content.
         */
        function generatePurplePatch(analyses) {
            if (isPreseason) {
                return renderEmptyState(
                    'Purple Patch needs this season’s data',
                    'Hot-streak detection relies on recent-game trends, which don’t exist until gameweeks start being played. Check back after GW1.',
                    'flame'
                );
            }
            const posMap = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };

            const scored = analyses
                .map(p => {
                    const patch = detectPurplePatch(p);
                    if (!patch) return null;
                    const sustainability = calculateSustainability(p, patch);
                    return { ...p, pos: patch.pos, patch, sustainability };
                })
                .filter(Boolean)
                .sort((a, b) => b.sustainability.totalScore - a.sustainability.totalScore);

            const byPos = { GK: [], DEF: [], MID: [], FWD: [] };
            scored.forEach(p => byPos[p.pos]?.push(p));

            const posConfigs = [
                { pos: 'ALL', name: 'Every position', players: scored },
                { pos: 'GK', name: 'Goalkeepers', players: byPos.GK },
                { pos: 'DEF', name: 'Defenders', players: byPos.DEF },
                { pos: 'MID', name: 'Midfielders', players: byPos.MID },
                { pos: 'FWD', name: 'Forwards', players: byPos.FWD }
            ];

            const panels = posConfigs.map(cfg => {
                const posPlayers = cfg.players.slice(0, cfg.pos === 'ALL' ? 24 : 15);
                return `
                    <div class="sub-tab-panel ${cfg.pos === activeGlobalPosition ? 'active' : ''}" id="pp-panel-${cfg.pos}">
                        ${posPlayers.length > 0
                            ? `<div class="pp-grid">${posPlayers.map((p, j) => renderPurplePatchCard(p, j + 1)).join('')}</div>`
                            : (seasonTooYoungNotice(8, 'Purple Patch',
                                'It looks for players scoring well above their own baseline, then rates how sustainable the run is.')
                                || '<div class="no-players">No players currently on a purple patch at this position</div>')
                        }
                    </div>
                `;
            }).join('');

            return `
              <div class="pa-panel">
                <div class="pa-panel-head">
                    <span class="pa-panel-title">${paIcon('flame')}Purple patch</span>
                    <p class="pa-panel-note">Players scoring well above their own baseline, rated on whether the run is backed by process or is about to regress. The score is the sustainability, not the streak.</p>
                    <div class="pa-panel-controls">
                        <div class="pa-filter-pills">${paPositionPills()}</div>
                        <!-- The Legend sits in the panel's own control row, beside the
                             position pills, the way Routes to Points has always had it.
                             It used to get a .section-toolbar of its own below the head,
                             which put one button on a line by itself and set this panel's
                             controls a row lower than every other panel on the page. -->
                        <div class="v2-filter-row-tail">
                            <button class="legend-toggle" onclick="this.classList.toggle('active'); document.getElementById('ppLegend').classList.toggle('show')">
                                <span><i data-lucide="info" style="width:14px;height:14px;display:inline-block;vertical-align:middle;"></i> Legend</span><span class="legend-caret">▾</span>
                            </button>
                        </div>
                    </div>
                </div>
                ${demoPreviewNotice('Purple Patch', 8)}
                <div class="pp-section">
                    <div class="legend-panel" id="ppLegend">
                        <span class="legend-panel-item"><span class="legend-panel-dot" style="background:#A78BFA"></span> xG Alignment (0-25)</span>
                        <span class="legend-panel-item"><span class="legend-panel-dot" style="background:#60A5FA"></span> Underlying Quality (0-20)</span>
                        <span class="legend-panel-item"><span class="legend-panel-dot" style="background:#34D399"></span> Minutes Stability (0-15)</span>
                        <span class="legend-panel-item"><span class="legend-panel-dot" style="background:#FBBF24"></span> Fixture Context (0-15)</span>
                        <span class="legend-panel-item"><span class="legend-panel-dot" style="background:#FB923C"></span> Team Alignment (0-10)</span>
                        <span class="legend-panel-item"><span class="legend-panel-dot" style="background:#F87171"></span> Consistency (0-15)</span>
                    </div>
                    ${panels}
                </div>
              </div>
            `;
        }

        function renderPurplePatchCard(p, rank) {
            const g = p.l5?.games || 1;
            const s = p.sustainability;
            const patch = p.patch;
            const posColors = { GK: '#FBBF24', DEF: '#34D399', MID: '#60A5FA', FWD: '#F87171' };
            const dimColors = {
                xgAlignment: '#A78BFA', quality: '#60A5FA', minutes: '#34D399',
                fixtures: '#FBBF24', team: '#FB923C', consistency: '#F87171'
            };

            // Sparkline: L5 points as small bars
            const history = p.history || [];
            const last5 = history.slice(-5);
            const maxPts = Math.max(...last5.map(g => parseFloat(g.total_points) || 0), 1);
            const sparkline = last5.map(g => {
                const pts = parseFloat(g.total_points) || 0;
                const h = Math.max(4, (pts / maxPts) * 28);
                const opacity = pts >= patch.l5PPG ? '1' : '0.5';
                return `<div class="pp-spark-bar" style="height:${h}px;opacity:${opacity}" title="GW${g.round}: ${pts}pts"></div>`;
            }).join('');

            // Fixture chips (next 3)
            const fixtureChips = (p.fixtures?.next5 || []).slice(0, 3).map(f => {
                const opp = teams[f.opponent]?.short_name || '???';
                const fdrClass = f.difficulty <= 2 ? 'fdr-1' : f.difficulty <= 2.5 ? 'fdr-2' : f.difficulty <= 3.5 ? 'fdr-3' : f.difficulty <= 4 ? 'fdr-4' : 'fdr-5';
                return `<span class="fixture-chip ${fdrClass}">${opp} (${f.isHome ? 'H' : 'A'})</span>`;
            }).join('');

            // Dimension bars
            const dimBars = Object.entries(s.dimensions).map(([key, dim]) => {
                const pct = (dim.score / dim.max) * 100;
                const color = dimColors[key] || '#A78BFA';
                return `
                    <div class="pp-dim-row">
                        <span class="pp-dim-label">${dim.label}</span>
                        <div class="pp-dim-bar">
                            <div class="pp-dim-bar-fill" style="width:${pct}%;background:${color}"></div>
                        </div>
                        <span class="pp-dim-score">${dim.score}/${dim.max}</span>
                    </div>
                `;
            }).join('');

            // Signal pills (top 5)
            const signalPills = s.signals.slice(0, 5).map(sig =>
                `<span class="pp-signal ${sig.positive ? 'pp-signal-pos' : 'pp-signal-neg'}">${sig.text}</span>`
            ).join('');

            const upliftPct = patch.uplift > 0 ? `+${(patch.uplift * 100).toFixed(0)}%` : '';

            // The shared player hero, as on every other card here.
            const hero = typeof v2PlayerHeroHTML === 'function'
                ? v2PlayerHeroHTML(p, { size: 'compact', sub: p.pos, chip: '#' + rank })
                : '';

            return `
                <div class="pp-card has-hero" onclick="openPlayerModal(${p.id})">
                    ${getStarHtml(p.id, 'shortlist-star-card')}
                    ${hero}
                    <div class="pp-body">
                    <div class="pp-card-top">
                        <div class="pp-sparkline">${sparkline}</div>
                    </div>

                    <div class="pp-stats-row">
                        <div class="pp-stat">
                            <span class="pp-stat-value">${patch.l5PPG.toFixed(1)}</span>
                            <span class="pp-stat-label">L5 pts/g</span>
                        </div>
                        <div class="pp-stat">
                            <span class="pp-stat-value">${patch.seasonPPG.toFixed(1)}</span>
                            <span class="pp-stat-label">Season pts/g</span>
                        </div>
                        ${upliftPct ? `<div class="pp-uplift-badge">${upliftPct}</div>` : ''}
                    </div>

                    <div class="pp-gauge-row">
                        <div class="pp-gauge">
                            <div class="pp-gauge-track">
                                <div class="pp-gauge-fill" style="width:${s.totalScore}%;background:${s.verdictColor}"></div>
                            </div>
                            <span class="pp-gauge-score">${s.totalScore}</span>
                        </div>
                        <span class="pp-verdict" style="background:${s.verdictColor}20;color:${s.verdictColor}">${s.verdict}</span>
                    </div>

                    <div class="pp-dimensions">${dimBars}</div>

                    <div class="pp-signals">${signalPills}</div>

                    <div class="pp-fixtures">${fixtureChips}</div>

                    <div class="pp-verdict-text">${s.verdictText}</div>
                    </div>
                </div>
            `;
        }

    
