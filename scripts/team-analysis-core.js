/* ============================================
   EasyFPL — My Team Analysis
   Configuration, shared state, utilities, team/fixture/season scoring,
   FPL data loading, the per-player analysis engine, and the squad overview
   and manager panel renderers.

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

        // ===== CONFIGURATION =====

        // ===== STATE =====
        let allPlayers = [], allPlayersById = {}, teams = {}, teamFixtures = {};

        function jerseyNumberLabel(player) {
            const number = player?.squadNumber ?? player?.squad_number;
            return number === null || number === undefined || number === '' ? '—' : String(number);
        }

        async function loadPremierLeagueJerseyNumbers(picks, season) {
            const cachedKey = `pl_jersey_numbers_${season}`;
            let jerseyNumbers = {};
            try { jerseyNumbers = JSON.parse(localStorage.getItem(cachedKey) || '{}'); } catch (_) {}

            const teamCodes = [...new Set((picks || []).map(pick => {
                const player = allPlayersById[pick.element];
                return player ? teams[player.teamId]?.code : null;
            }).filter(Boolean))];

            await Promise.all(teamCodes.map(async teamCode => {
                try {
                    const url = `https://sdp-prem-prod.premier-league-prod.pulselive.com/api/v2/competitions/8/seasons/${season}/teams/${teamCode}/squad`;
                    const response = await fetch(url);
                    if (!response.ok) return;
                    const squad = await response.json();
                    (squad.players || []).forEach(player => {
                        if (player.id != null && player.shirtNum != null) jerseyNumbers[String(player.id)] = player.shirtNum;
                    });
                } catch (error) {
                    console.warn(`[Jersey numbers] Could not load team ${teamCode}:`, error);
                }
            }));

            try { localStorage.setItem(cachedKey, JSON.stringify(jerseyNumbers)); } catch (_) {}
            allPlayers.forEach(player => {
                if (player.squadNumber == null && jerseyNumbers[String(player.code)] != null) {
                    player.squadNumber = jerseyNumbers[String(player.code)];
                }
            });
        }
        /* This page needs two gameweeks, and conflating them is what made the
           pitch describe a round that had already been played.

           currentGW is the round the squad BELONGS TO — the one `is_current`
           names, the one the picks endpoint will answer for, the one whose
           points and rank the manager panel reports. It is a fact about the past
           (or the present, mid-round).

           planningGW is the round you are PICKING FOR. The two are the same
           number while a round is locked or under way, and differ for the days
           between its last whistle and the next deadline — which is most of the
           time anyone spends on this page. Anything projected, arranged or
           recommended belongs to planningGW; anything scored belongs to
           currentGW. See planningGameweek() in scripts/common.js. */
        let currentGW = 1, planningGW = 1, selectedPlayers = [], managerData = null, picksData = null, analysisResults = [];
        let isPreseason = false; // true until the season's first fixture kicks off — see computeIsPreseason() in scripts/common.js
        let positionAverages = {};
        let teamAnalysis = {}; // Team analysis scores (attack, defence, form, fixture) keyed by team ID
        let fixtureSwingData = {}; // Fixture swing detection per team
        let seasonStats = {}; // Full-season team stats (W/D/L, GF/GA, CS%, home/away splits)

        let allFixtures = [];     // All fixtures from fixtures.json
        let managerHistory = null; // Manager history from /api/entry/{id}/history/
        /* picksData is the squad being PLANNED — last round's picks with any
           transfers already made for planningGW replayed over them, which is the
           team the manager is actually holding. reviewPicksData is the untouched
           response for currentGW: the eleven that scored the points the Gameweek
           Review reports on. They are the same object whenever planningGW equals
           currentGW, and must not be confused when they are not — reviewing a
           round with a squad assembled after it ended credits the wrong players.
           See applyPendingTransfers() in scripts/common.js. */
        let reviewPicksData = null;
        let pendingTransfers = null; // { gw, moves:[{out,in,slot}], armband } once applied
        /* Every transfer the manager has ever made, from
           /api/entry/{id}/transfers/ — FPL's own record, one row per move with
           the gameweek it was made for. Optional: it is fetched with a .catch,
           and the two features that read it say so rather than guessing. */
        let managerTransferLog = null;
        /* What buildSuggestedMoves() last produced, so the status card's "Do this
           week" and the squad report's "What to do this week" are the same list
           and not two answers to one question. Set in renderTeamAnalysis(). */
        let squadSuggestedMoves = [];
        let gwEvents = [];        // bootstrap events[] — deadlines, is_current/is_next
        let chipDefinitions = []; // bootstrap chips[] — each chip's start_event/stop_event window
        let maxFreeTransfers = 5; // from game_settings.max_extra_free_transfers + 1

        // Shared state for Draft & analysis
        let playersDetailData = null; // Full players-data.json with per-GW history
        // teamXgData is declared and filled by scripts/team-xg.js.
        let teamFixtures6 = {};       // Next 6 fixtures per team (extended from teamFixtures)
        let transferRendered = false;  // Transfer wizard lazy rendering flag
        let lineupState = {
            step: 1,
            squad: [],             // all 15 players with scores
            excluded: new Set(),   // manually excluded player IDs
            xi: [],                // current starting XI
            bench: [],             // current bench
            formation: '',         // current formation string
            swapSource: null,      // player ID selected for swap (first click)
            dragId: null,          // player ID being dragged across the pitch
            dragJustEnded: false,  // a click that closes a drag is the drag's, not a selection
            selectedPlayers: [],   // up to 2 player IDs for context panel
            captain: null,         // captain player ID
            viceCaptain: null,     // vice-captain player ID
            originalXIIds: new Set(),    // original starting XI IDs from FPL
            originalCaptain: null,       // original captain ID
            originalVC: null,            // original vice-captain ID
            optimizeReport: null         // last Auto-optimise report, for the summary line + full report modal
        };
        let transferState = {
            pending: [],           // Array of { soldPlayer, replacement } — up to 5 transfer slots
            activeSlot: -1,        // Index into pending[]
            mode: 'squad',         // 'squad' | 'market' | 'compare' | 'summary'
            candidateCache: {},    // cacheKey -> scored candidates
            previewPlayer: null,   // candidate being previewed in comparison
            funnel: null           // market filters; scripts/transfer-funnel.js owns the shape
        };

        let userSettings = {
            sellSensitivity: 1.0,   // multiplier for sell rating (>1 = aggressive, <1 = patient)
            fixtureWeight: 1.0,     // how much fixtures matter
            formWeight: 1.0,        // how much form matters
            valueWeight: 1.0,       // how much value-for-money matters
            minutesThreshold: 60,   // minutes per game to worry
            premiumHarshness: 1.0   // extra scrutiny on expensive players
        };
        let activePreset = 'balanced';
        let totalFplPlayers = 11000000; // default, updated from bootstrap
        let transferMarketRendered = false;
        let newsRendered = false;

        // ===== UTILITY FUNCTIONS =====

        function updateStatus(message, type = 'info') {
            const status = document.getElementById('status');
            status.textContent = message;
            status.className = 'status ' + type;
        }

        /* ===== A message that goes away =====

           Auto-optimise reported itself as a permanent bar above the pitch, in
           --color-myteam, which is rose — so the one control on this page that
           only ever improves your XI announced itself in the colour everything
           else uses for a problem, and then stayed there until the next render.

           A toast instead: it appears, it can be read, it leaves. It holds
           while the pointer is on it, because the optimise message carries a
           link through to the full report and a message you have to race is
           worse than no message. */
        let sqToastTimer = null;

        function sqToast(html, tone = 'good', ms = 9000) {
            let el = document.getElementById('sqToast');
            if (!el) {
                el = document.createElement('div');
                el.id = 'sqToast';
                el.className = 'sq-toast';
                el.addEventListener('mouseenter', () => clearTimeout(sqToastTimer));
                el.addEventListener('mouseleave', () => { sqToastTimer = setTimeout(sqToastHide, 2500); });
                document.body.appendChild(el);
            }
            el.className = `sq-toast tone-${tone}`;
            el.innerHTML = `<span class="sq-toast-body">${html}</span>`
                + `<button class="sq-toast-x" onclick="sqToastHide()" aria-label="Dismiss">&times;</button>`;
            // Two frames: the element has to exist un-shown before the class
            // that animates it lands, or there is no state to move from.
            requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
            if (typeof lucide !== 'undefined') lucide.createIcons();
            clearTimeout(sqToastTimer);
            sqToastTimer = setTimeout(sqToastHide, ms);
        }

        function sqToastHide() {
            clearTimeout(sqToastTimer);
            const el = document.getElementById('sqToast');
            if (el) el.classList.remove('show');
        }

        function showLoading(show, text) {
            document.getElementById('loadingOverlay').classList.toggle('show', show);
            if (text) document.getElementById('loadingText').textContent = text;
        }

        /* Position-level baselines, built by the engine that consumes them.

           positionAverages is one of the engine's documented inputs and its
           medPrice is the reference the price-quality prior measures against, so
           the construction belongs next to the model rather than in the squad
           page that happened to need it first. */
        function computePositionAverages() {
            positionAverages = xpBuildPositionAverages(allPlayers, currentGW);
        }

        // ===== TEAM ANALYSIS SCORES (ported from teams-analysis) =====

        /* Both of these are xp-engine.js's now — see xpBuildFixtureSwings and
           xpBuildSeasonStats. They were page-local because this was the only page
           that wanted them; the player profile card is shared with the players
           page, and it reads both. The swing detector also picked up a fix in the
           move: a double gameweek's second fixture now counts toward the run's
           difficulty instead of being dropped. */
        function buildFixtureSwingData(bootTeams, fixturesData) {
            fixtureSwingData = xpBuildFixtureSwings(bootTeams, fixturesData, planningGW);
            console.log('Fixture swings:', Object.keys(fixtureSwingData).length, 'teams');
        }


        function computeTeamScores(bootTeams, fixturesData) {
            /* The model moved to scripts/xp-engine.js, alongside the other
               builders for the engine's documented inputs. The name stays because
               this file's load path and the backtest harness both call it, and
               because the global it fills is what every reader on this page
               expects to find. */
            teamAnalysis = xpBuildTeamScores(bootTeams, fixturesData);
        }

        // ===== DATA LOADING =====
        async function loadTeamById() {
            const teamId = document.getElementById('teamIdInput').value.trim();
            if (!teamId || isNaN(teamId)) { updateStatus('Please enter a valid Team ID', 'error'); return; }

            // Hide landing page, show status
            document.getElementById('landingPage').style.display = 'none';
            document.getElementById('status').style.display = '';
            showLoading(true, 'Loading FPL data...');

            try {
                // Load bootstrap + fixtures + players-data in parallel
                // event-live carries this gameweek's per-player stats and is
                // rewritten every 15 minutes, where players-data.json's per-GW
                // history only lands with the four-hourly job. Optional: absent or
                // stale, the Gameweek Review falls back to that history.
                const [bootData, fixturesData, playersDataRes, eventLiveRes, oddsRes, eoRes] = await Promise.all([
                    DataCache.fetchJSON(DATA_URLS.bootstrap),
                    DataCache.fetchJSON(DATA_URLS.fixtures).catch(() => []),
                    DataCache.fetchJSON(DATA_URLS.players).catch(() => null),
                    DataCache.fetchJSON(DATA_URLS.eventLive).catch(() => null),
                    // Optional. Fetched here rather than when the Matchday tab is
                    // opened so that every projection in a render pass is built
                    // from the same inputs — half a screen priced by the market
                    // and half by the model would be worse than neither.
                    DataCache.fetchJSON(DATA_URLS.odds).catch(() => null),
                    // Also optional, and for the same reason: ownership and
                    // effective ownership disagree, so a page that used one in
                    // the transfer card and the other in the squad view would be
                    // arguing with itself.
                    DataCache.fetchJSON(DATA_URLS.eo).catch(() => null)
                ]);
                if (typeof setEventLiveData === 'function') setEventLiveData(eventLiveRes);
                if (typeof boSetOdds === 'function') boSetOdds(oddsRes);
                if (typeof eoSetData === 'function') eoSetData(eoRes);

                teams = {};
                bootData.teams.forEach(t => { teams[t.id] = t; });
                const currEvent = bootData.events.find(e => e.is_current);
                currentGW = currEvent ? currEvent.id : 1;
                // Equal to currentGW until the round's last whistle, one ahead after it.
                planningGW = planningGameweek(bootData, fixturesData);
                gwEvents = bootData.events || [];
                chipDefinitions = bootData.chips || [];
                // The cap on banked transfers is a game setting, not a constant —
                // read it rather than hardcoding the current season's value.
                if (bootData.game_settings?.max_extra_free_transfers != null) {
                    maxFreeTransfers = bootData.game_settings.max_extra_free_transfers + 1;
                }
                isPreseason = computeIsPreseason(bootData, fixturesData);
                allFixtures = fixturesData;
                processFixtures(fixturesData);
                processFixtures6(fixturesData);

                // Store players detail data for per-GW history
                playersDetailData = playersDataRes;
                if (playersDataRes?.metadata?.lastUpdated && window.updateDataFreshness) window.updateDataFreshness(playersDataRes.metadata.lastUpdated);
                console.log('[Players] Players detail data:', playersDetailData ? `${(playersDetailData.players||[]).length} players with history` : 'not available');

                /* Built by the projection engine rather than here.

                   The shape below is the engine's input contract — every field
                   projectPlayerPointsDetailed reads (minutes, starts, xG, xA,
                   bonus, saves, status, chanceNextRound, penaltiesOrder, teamId)
                   comes out of this one mapping, and until it moved, this file was
                   the only place in the codebase that produced it. That is the
                   real reason the projection could not be used on the players
                   page: not the missing <script> tag, but that nothing else could
                   build a player the engine understood. */
                allPlayers = xpBuildPlayers(bootData.elements, teams, teamFixtures);

                totalFplPlayers = bootData.total_players || 11000000;

                allPlayersById = {};
                allPlayers.forEach(p => allPlayersById[p.id] = p);
                computePositionAverages();

                // Build team xG data before computeTeamScores() — it now reads teamXgData
                // (via getTeamXgWindow/getTeamSeasonXg) to compute xgTrend/xgcTrend per team.
                /* Per-gameweek history, not bootstrap season totals: the trend
                   readings derive a club's earlier form by subtracting the recent
                   window from the season, and that only holds if both come from
                   the same feed. See scripts/team-xg.js. */
                buildTeamXgData({ teams: bootData.teams, players: (playersDetailData && playersDetailData.players) || [] }, fixturesData);
                console.log('[xG] Team xG data built for', Object.keys(teamXgData).length, 'teams');

                computeTeamScores(bootData.teams, fixturesData);
                buildFixtureSwingData(bootData.teams, fixturesData);
                seasonStats = xpBuildSeasonStats(bootData.teams, fixturesData);

                // Fetch manager + picks + history in parallel
                showLoading(true, `Loading team for GW${currentGW}...`);
                const [mgrRes, picksRes, histRes, transfersRes] = await Promise.all([
                    fetchWithProxy(`https://fantasy.premierleague.com/api/entry/${teamId}/`),
                    fetchWithProxy(`https://fantasy.premierleague.com/api/entry/${teamId}/event/${currentGW}/picks/`),
                    fetchWithProxy(`https://fantasy.premierleague.com/api/entry/${teamId}/history/`),
                    /* Every transfer the manager has ever made, including the
                       ones for a round that has not kicked off — the only public
                       source for those. Optional: without it the page falls back
                       to the pre-transfer squad, which is what it always showed,
                       so a failure here degrades rather than breaks. */
                    fetchWithProxy(`https://fantasy.premierleague.com/api/entry/${teamId}/transfers/`).catch(() => null)
                ]);
                managerData = await mgrRes.json();
                // The sidebar's account block names the team from this.
                if (typeof v2SetTeamName === 'function') v2SetTeamName(managerData.name);
                picksData = await picksRes.json();
                managerHistory = await histRes.json();
                /* Kept rather than consumed. applyPendingTransfers() below only
                   wants the moves for the round being planned, but the same
                   response is every transfer the manager has ever made — which
                   is the only source for what the round just played cost and
                   returned. The Gameweek Review reads it from here. */
                managerTransferLog = transfersRes ? await transfersRes.json().catch(() => null) : null;

                // Free Hit fix: if FH was active this GW, the picks endpoint returns
                // the temporary FH squad. Load the real squad from the previous GW instead.
                if (picksData.active_chip === 'freehit' && currentGW > 1) {
                    console.log(`[FH] Free Hit detected in GW${currentGW}, loading real squad from GW${currentGW - 1}`);
                    const realPicksRes = await fetchWithProxy(
                        `https://fantasy.premierleague.com/api/entry/${teamId}/event/${currentGW - 1}/picks/`
                    );
                    const realPicksData = await realPicksRes.json();
                    picksData = {
                        ...picksData,
                        picks: realPicksData.picks,
                        entry_history: { ...picksData.entry_history, bank: realPicksData.entry_history?.bank }
                    };
                }

                /* The round just played, kept whole before the planning squad is
                   built on top of it. Only the Gameweek Review reads it. */
                reviewPicksData = picksData;
                pendingTransfers = null;

                /* Transfers the manager has already made for the round being
                   planned. Guarded on planningGW being ahead of currentGW: while
                   they are equal the picks endpoint has the moves in it already,
                   and replaying them would apply every one of them twice. */
                if (planningGW > currentGW) {
                    const nowCost = id => {
                        const el = allPlayersById[id];
                        return el ? Math.round(el.price * 10) : null;
                    };
                    const applied = applyPendingTransfers(picksData, managerTransferLog, planningGW, nowCost);
                    if (applied) {
                        picksData = applied.picksData;
                        pendingTransfers = { gw: applied.gw, moves: applied.moves, armband: applied.armband };
                        console.log(`[Transfers] ${applied.moves.length} move(s) already made for GW${planningGW} applied to the squad`);
                    }
                }

                /* Swaps confirmed in the Transfer Wizard are NOT folded in here.

                   They used to be, and that made this squad a mixture of two
                   different things: the team FPL says you own, plus the team you
                   were thinking about. Every panel downstream — the analysis, the
                   gameweek review, the pitch — then described a squad that exists
                   on this site and nowhere else, and a reload did not clear it
                   because the plan was re-applied on the way past.

                   This is the squad FPL has, and it changes when FPL changes:
                   transfers you have actually made show up through the pending
                   transfer log above, because that is the official record of
                   them. The wizard keeps its own plan — see twPlan in
                   scripts/transfer-wizard.js — and lays it over its own view
                   only. */

                const premierLeagueSeason = new Date(bootData.events?.[0]?.deadline_time || Date.now()).getUTCFullYear();
                await loadPremierLeagueJerseyNumbers(picksData.picks, premierLeagueSeason);

                selectedPlayers = picksData.picks.map(pick => {
                    const player = allPlayersById[pick.element];
                    if (!player) return null;
                    return { ...player, isCaptain: pick.is_captain, isVice: pick.is_vice_captain,
                        onBench: pick.position > 11, pickPosition: pick.position,
                        sellPrice: pick.selling_price / 10, multiplier: pick.multiplier };
                }).filter(p => p !== null);

                // Manager name/rank/points/bank are rendered as the right-hand column
                // of the squad overview (renderManagerCard, called from
                // renderTeamOverview) — analyzeTeam() below runs after managerData and
                // picksData are already assigned, so it reads them straight off those.

                // Through the shared writer, so the account learns it too.
                saveTeamId(teamId);
                showNavTeamBadge(teamId);
                showLoading(true, 'Running analysis...');

                // Clear the previous team's lineup state BEFORE analysing. Running
                // this after analyzeTeam() emptied the snapshot that its own render
                // had just populated: the pitch looked right because the DOM was
                // already built, but snapshotXI was empty until the next re-render
                // re-initialised it, so anything reading the current lineup saw
                // nothing.
                resetSnapshotState();
                analyzeTeam();

                transferRendered = false;
                lineupRendered = false;
                draftTabRendered = false;
                newsRendered = false;
                transferState = { pending: [], activeSlot: -1, mode: 'squad', candidateCache: {}, previewPlayer: null, funnel: null, strategy: 'single', wildcard: false, sellMode: false };
                document.getElementById('tabBar').classList.add('visible');
                if (window._pendingTab) {
                    const pending = window._pendingTab;
                    const opening = switchTab(pending);
                    window._pendingTab = null;
                    /* A move handed over from the dashboard loads into the cart
                       once the squad is real; the wizard renders it from there.

                       On the other side of switchTab's promise, because the
                       tab's script is fetched on arrival now and
                       twApplyDeepLink() is declared in it. Read as a typeof
                       guard this would simply have been false and the link
                       would have been dropped in silence — which is the whole
                       failure mode of guarding a name that is merely late. */
                    Promise.resolve(opening).then(function () {
                        try {
                            if (pending === 'transfers' && typeof twApplyDeepLink === 'function') twApplyDeepLink();
                            else if (typeof applySquadDeepLink === 'function') applySquadDeepLink();
                        } catch (e) { console.warn('Deep link ignored:', e.message); }
                    });
                }
                /* A shared ?player= link. After the squad exists, since this
                   page only holds fifteen and a link naming anybody else should
                   do nothing rather than open an empty card. */
                if (typeof pdmOpenFromUrl === 'function') pdmOpenFromUrl();
            } catch (error) {
                console.error('Error loading team:', error);
                // friendlyFplErrorMessage distinguishes FPL's own post-deadline
                // outage/rate-limit (503/502/504/429, or a bare timeout) from an
                // actually-wrong Team ID — this page never clears the saved ID on
                // failure either way, so a transient hit just means retrying
                // shortly works without retyping anything.
                const friendly = typeof friendlyFplErrorMessage === 'function'
                    ? friendlyFplErrorMessage(error)
                    : (error.message === 'HTTP 404'
                        ? "We couldn't find a team with that ID — check the number and try again, or try a demo team below."
                        : 'Something went wrong loading your team. Please try again.');
                updateStatus(friendly, 'error');
                document.getElementById('tabBar').classList.remove('visible');
                document.getElementById('landingPage').style.display = '';
            } finally {
                showLoading(false);
            }
        }

        /* The next five gameweeks per team — from the shared builder, not a
           local copy.

           This WAS a local copy, and it took the first five FIXTURES rather than
           the first five GAMEWEEKS. The difference is a double gameweek: two
           matches in one round spend two of the five slots, so the window ends a
           round early and the last gameweek drops off the end — silently, since
           a shorter array still renders. It is the Nxt5 FDR column, the fixture
           strips and the hard-run detection that read this.

           The dashboard's copy of the same function was migrated to
           xpBuildTeamFixtures when that bug was found; the page the fix was
           written for kept its own copy. Measured against today's feed the two
           agree for all 20 teams, because no side has a double or a blank inside
           the next five rounds — so this is a latent divergence rather than a
           live one, and it would have surfaced around the winter doubles. */
        function processFixtures(fixturesData) {
            teamFixtures = xpBuildTeamFixtures(fixturesData, teams, 5);
        }

        // ===== ENHANCED ANALYSIS ENGINE =====
        function analyzeTeam() {
            if (selectedPlayers.length === 0) { updateStatus('No players loaded', 'error'); return; }
            analysisResults = selectedPlayers.map(player => analyzePlayer(player));
            analysisResults.sort((a, b) => b.sellRating - a.sellRating);
            renderTeamAnalysis();
            updateStatus(`Analysis complete — GW${planningGW}`, 'success');
        }

        /* analyzePlayer() and the regressed-form prior it reads moved to
           scripts/player-profile.js, with the card that reports their verdict.
           Both pages that draw a player profile run the same judgement now. */

        // ===== RENDERING =====
        /* Where this squad sits against the field it is competing with.

           Rendered by the Transfer Wizard rather than by Squad Analysis. It is a
           squad-level fact, so Squad Analysis looks like the right home — but
           the only thing you can do about being too template is make a transfer,
           and every row here is either a player to buy or one to keep. Sitting
           next to the planner it also updates as moves are staged, which is the
           difference between a diagnosis and a control. A squad that mirrors the top 10k moves with them and
           can only win slowly; one that does not swings both ways.

           The gaps are the actionable half. A player the top 10k own and you do
           not is a position you lose ground on every week he returns, and it is
           the one thing plain ownership genuinely cannot tell you — the game's
           own percentage is diluted across thirteen million teams, most of whom
           are not playing the same game.

           Renders nothing at all when the weekly sample is missing. A partial
           answer here would be read as a complete one. */
        /* Which field the panel is measuring against. Held here rather than in
           eo-layer because it is a view preference, not a fact about the data —
           the layer answers for any tier it is asked about. */
        let eoViewTier = 'top10k';

        function eoSetViewTier(tier) {
            eoViewTier = tier;
            /* The league is the one tier that has to be fetched. Sampling is
               deferred to the click rather than done on load, because it costs
               a request per member of the league and most visits never ask. */
            if (tier === 'league' && typeof eoSampleLeague === 'function'
                && !eoLeagueReady(null, typeof currentGW !== 'undefined' ? currentGW : null)) {
                const info = eoPickLeague();
                if (info) {
                    eoSampleLeague(info.id, currentGW, info.name)
                        .then(() => { if (typeof renderTWSquadPane === 'function') renderTWSquadPane(); })
                        .catch(() => {});
                }
            }
            if (typeof renderTWSquadPane === 'function') renderTWSquadPane();
        }

        /* The league worth comparing against.

           A manager is usually in several: an overall one with millions in it,
           some regional ones, and the handful that actually matter. The
           smallest classic league with more than a few people in it is almost
           always the one with their friends in it, and that is the field they
           care about. */
        function eoPickLeague() {
            const all = (typeof managerData !== 'undefined' && managerData
                && managerData.leagues && managerData.leagues.classic) || [];
            const real = all.filter(l => l.id && (l.rank_count == null || l.rank_count >= 4)
                && (l.rank_count == null || l.rank_count <= 5000));
            if (!real.length) return null;
            real.sort((a, b) => (a.rank_count || 1e9) - (b.rank_count || 1e9));
            return { id: real[0].id, name: real[0].name };
        }

        function renderSquadEO(squad) {
            if (typeof eoReady !== 'function' || !eoReady()) return '';
            /* Defaults to the squad you own, but the Transfer Wizard passes the
               one its pending moves would leave you with — which is the whole
               reason this belongs there rather than on a page where it can only
               ever describe a squad you cannot change from that screen. */
            const sq = squad && squad.length ? squad : selectedPlayers;
            const tier = eoViewTier;
            const pending = tier === 'league' && !eoLeagueReady();
            const load = pending ? null : eoSquadLoad(sq, tier);
            if (!load && !pending) return '';

            const owned = new Set(sq.map(p => p.id));
            const byId = {};
            (allPlayers || []).forEach(p => { byId[p.id] = p; });

            const universe = tier === 'league'
                ? (eoLeagueData ? eoLeagueData.players : {})
                : (eoMeta() ? eoData.players : {});
            const gaps = Object.keys(universe)
                .filter(id => !owned.has(Number(id)) && byId[id])
                .map(id => ({ p: byId[id], v: eoFor(id, tier) }))
                .filter(x => x.v && x.v.eo >= 25)
                .sort((a, b) => b.v.eo - a.v.eo)
                .slice(0, 4);

            const mine = sq
                .filter(p => p.pickPosition == null || p.pickPosition <= 11)
                .map(p => ({ p, v: eoFor(p.id, tier) }))
                .filter(x => x.v)
                .sort((a, b) => a.v.eo - b.v.eo)
                .slice(0, 3);

            const chip = (name, v, cls) =>
                `<span class="eo-chip ${cls}" data-tooltip="${escHTML(
                    v.below ? `Owned by fewer than ${eoResolution(v.tier)}% of this tier.`
                        : `${v.own}% own him and ${v.cap}% captain him, so he carries ${v.eo}% of the field.`)}"
                 >${escHTML(name)}<b>${escHTML(eoText(v))}</b></span>`;

            /* Four fields, because they disagree and the disagreement is the
               point: Isak carries 119% of the top 1k and 83% of the top 100k,
               while Calafiori runs the other way. Your own league is last
               because it is the one that decides your season and the one that
               has to be fetched. */
            const tiers = [
                { id: 'top1k', label: 'Top 1k' },
                { id: 'top10k', label: 'Top 10k' },
                { id: 'top100k', label: 'Top 100k' },
                { id: 'league', label: 'My league' }
            ];
            const picker = `<div class="eo-tiers" role="tablist">${tiers.map(t =>
                `<button class="eo-tier${tier === t.id ? ' active' : ''}" role="tab"
                    aria-selected="${tier === t.id}" onclick="eoSetViewTier('${t.id}')"
                    >${escHTML(t.label)}</button>`).join('')}</div>`;

            if (pending) {
                return `<div class="eo-panel">
                    <div class="eo-head"><span class="eo-title">${v2Icon('users')}Against your league</span></div>
                    ${picker}
                    <p class="eo-note">Working out what your league owns — one look at each manager's team. This is kept until the next deadline, so it only happens once.</p>
                </div>`;
            }

            return `<div class="eo-panel">
                <div class="eo-head">
                    <span class="eo-title">${v2Icon('users')}Against the ${escHTML(load.label.toLowerCase())}</span>
                    <span class="eo-load" data-tooltip="The average share of this tier carried by each of your starters, counting your captain twice. Higher means your team looks more like theirs.">
                        ${load.perStarter}%<em>per starter</em>
                    </span>
                </div>
                ${picker}
                ${gaps.length ? `<div class="eo-row">
                    <span class="eo-row-l" data-tooltip="Players this tier owns that you do not. Every week one of them returns, you lose ground without having done anything wrong.">Not owned</span>
                    <span class="eo-chips">${gaps.map(x => chip(x.p.name, x.v, 'gap')).join('')}</span>
                </div>` : ''}
                ${mine.length ? `<div class="eo-row">
                    <span class="eo-row-l" data-tooltip="Your starters carrying least of this tier. These are what gain you rank when they return and cost you nothing when they blank.">Your differentials</span>
                    <span class="eo-chips">${mine.map(x => chip(x.p.name, x.v, 'diff')).join('')}</span>
                </div>` : ''}
                <p class="eo-note">Sampled from ${escHTML(String(
                    tier === 'league' ? (eoLeagueData ? eoLeagueData.sampled : '?')
                        : (eoMeta().tiers.find(t => t.id === tier) || {}).sampled || '?'))} managers in GW${escHTML(String(
                    tier === 'league' ? (eoLeagueData ? eoLeagueData.gw : '?') : eoMeta().event))}. Effective ownership counts starters and doubles captains, so it sits below plain ownership for anyone the field benches.</p>
            </div>`;
        }

        /* How healthy a squad is, as one number and the reasons behind it.

           Extracted from renderTeamAnalysis so it can be run against a squad
           you do not own. That is the whole point of a trial: "he is better"
           is an opinion until the same scoring that judges your team judges the
           one with him in it. Nothing about the arithmetic changed in the move.

           Takes analysis results rather than players, because every charge here
           is levied against a verdict that analyzePlayer has already reached. */
        function computeSquadHealth(results) {
            const analysisResults = results || [];
            // Read from the verdicts rather than passed in: the bonus below is
            // a fact about this squad, so it has to be counted from this squad.
            const stars = analysisResults.filter(a => a.verdict === 'star');
        // Calculate team health score (multi-factor)
        const starters = analysisResults.filter(a => !a.player.onBench);
        const bench = analysisResults.filter(a => a.player.onBench);
        // sellRating already contains an availability charge (up to +40) and a
        // form charge (up to ±30). The explicit penalties further down charge
        // for both again, so an injured starter was being docked twice — once
        // through the average, once through the subtraction. Strip those two
        // components out of the base so each factor is counted exactly once
        // and the explicit weights below mean what they say.
        const baseQuality = a => 100 - (a.sellRating - (a.availPenalty || 0) - (a.formPenalty || 0));
        const starterAvg = starters.reduce((s, a) => s + baseQuality(a), 0) / Math.max(starters.length, 1);
        const benchAvg = bench.reduce((s, a) => s + baseQuality(a), 0) / Math.max(bench.length, 1);
        // A bench player scores nothing in a normal gameweek, so squad health
        // is overwhelmingly about the eleven who play; the bench counts as
        // cover rather than as a fifth of the answer.
        let healthScore = starterAvg * 0.88 + benchAvg * 0.12;

        // One aggregated breakdown of what's dragging the score down, instead of
        // a scrolling list of individually-phrased warnings that repeated the
        // same underlying problem several ways.
        const injuredStarters = starters.filter(a => a.player.status === 'i' || a.player.status === 'u' || a.player.status === 's');
        const doubtfulStarters = starters.filter(a => a.player.status === 'd');
        const toughFixtureStarters = starters.filter(a => ((a.fixtures || [])[0]?.difficulty || 3) >= 4);
        // Guarded on status 'a' rather than on `!status`. Every player carries a
        // status ('a', 'd', 'i', 's', 'u'), all truthy, so the old negation was
        // never true — this penalty and its breakdown line never once fired.
        // The intent was "out of form and not already counted as unavailable".
        // Reads the regressed form, not the raw figure. On the raw one, 53% of
        // everyone who played counted as out of form after a single gameweek,
        // and eleven starters at -3 apiece is most of a health score.
        const poorFormStarters = starters.filter(a => a.effectiveForm < 2.5 && a.player.status === 'a');

        // Each of these is now the only place its factor is charged.
        healthScore -= injuredStarters.length * 8;
        healthScore -= doubtfulStarters.length * 3;
        healthScore -= poorFormStarters.length * 3;
        healthScore -= Math.min(6, toughFixtureStarters.length * 1.5);

        const capAnalysis = starters.find(a => a.player.isCaptain);
        if (capAnalysis) {
            if (capAnalysis.verdict === 'star') healthScore += 3;
            else if (capAnalysis.verdict === 'sell') healthScore -= 5;
            else if (capAnalysis.verdict === 'monitor') healthScore -= 2;
        }
        if (stars.length >= 3) healthScore += 2;

        const healthBreakdown = [
            { count: injuredStarters.length, label: 'injured' },
            { count: doubtfulStarters.length, label: 'doubtful' },
            { count: toughFixtureStarters.length, label: 'tough fixtures' },
            { count: poorFormStarters.length, label: 'out of form' },
        ].filter(b => b.count > 0);


            /* toughFixtureStarters and poorFormStarters go out with the rest.
               The squad report names the players behind each count, and the
               alternative — re-deriving "tough" and "out of form" at the point
               of writing the sentence — is how a report ends up disagreeing
               with the number it is explaining. One definition, computed here,
               where the score that charges for it is computed. */
            return {
                health: Math.max(0, Math.min(100, Math.round(healthScore))),
                breakdown: healthBreakdown,
                starters, bench, injuredStarters, doubtfulStarters,
                toughFixtureStarters, poorFormStarters, capAnalysis
            };
        }

        function renderTeamAnalysis() {
            const sells = analysisResults.filter(a => a.verdict === 'sell');
            const monitors = analysisResults.filter(a => a.verdict === 'monitor');
            const stars = analysisResults.filter(a => a.verdict === 'star');
            const holds = analysisResults.filter(a => a.verdict === 'hold');

            const { health: teamHealth, starters,
                injuredStarters, doubtfulStarters, capAnalysis } = computeSquadHealth(analysisResults);
            /* Kept as well as passed down. The status card renders these as "Do
               this week"; the squad report behind its button has to answer the
               same question with the same list, and the only way to guarantee
               that is for both to read the one array rather than each deriving
               an answer of its own. Recomputing in the report would also drift:
               it is called on a click, by which time the bank and the squad may
               have moved under it. */
            squadSuggestedMoves = buildSuggestedMoves(starters, injuredStarters, doubtfulStarters, capAnalysis);
            const suggestedMoves = squadSuggestedMoves;

            let html = '';
            if (isPreseason) html += renderSeasonNotice('Showing 2025/26 form &amp; stats — verdicts will update once GW1 is played.');
            html += renderPendingTransfersNotice();
            html += renderSquadTickers();
            html += renderTeamOverview(teamHealth, sells, monitors, holds, stars, suggestedMoves);
            /* A trial sits under the numbers it moves, so before and after are
               read in one glance. The picker that starts one sits in the squad
               panel's own header — see renderSquadFilterBar(). */
            if (typeof tlRenderInto === 'function') html += tlRenderInto();
            /* Filters, the chart button and every position group in one panel.
               They were three stacked boxes with four more inside the last of
               them, so the squad read as seven cards rather than one table with
               sections. The chart's modal is appended outside the panel, since
               it is fixed to the viewport rather than part of the flow. */
            html += `<div class="sq-panel">`;
            html += renderSquadFilterBar();
            html += `<div id="sq-table-wrap">${renderSquadTable()}</div>`;
            html += `</div>`;

            if (sqChartInstance) { sqChartInstance.destroy(); sqChartInstance = null; }
            document.getElementById('teamDisplay').innerHTML = html;
            /* The chart modal is mounted on <body>, not inside this markup —
               see mountSquadChartModal() for why it cannot live here. */
            if (typeof mountSquadChartModal === 'function') mountSquadChartModal();
            if (typeof lucide !== 'undefined') lucide.createIcons();
            startDeadlineCountdown();
            // Observer-driven, same as toggleSquadChart(): the freshly-inserted
            // wrapper starts the chart as soon as it has a real size.
            if (sqChartExpanded) ensureSquadChart();
            if (typeof onCompareSelectionChange === 'function') onCompareSelectionChange();
            document.getElementById('status').style.display = 'none';

            // Animate health ring
            requestAnimationFrame(() => {
                const fill = document.getElementById('healthRingFill');
                if (fill) {
                    const circumference = 2 * Math.PI * 54;
                    const offset = circumference * (1 - teamHealth / 100);
                    fill.style.strokeDashoffset = offset;
                }
            });
        }

        /* Say so when the squad on screen is not the one that played.

           Everything below this line is built from picksData, which for the days
           between a round ending and the next deadline is last round's team with
           the manager's own already-made transfers replayed into it. That is the
           right squad to analyse and the wrong one to leave unexplained: a
           manager who sold a player on Sunday and still sees him in the verdict
           list assumes the page is broken, and one who does not see him assumes
           it read their team live. Naming the moves settles both. */
        function renderPendingTransfersNotice() {
            if (!pendingTransfers || !pendingTransfers.moves.length) return '';
            const nameOf = id => {
                const p = allPlayersById[id];
                return p ? p.name : `Player ${id}`;
            };
            // Inline-styled for the same reason renderSeasonNotice() is: one
            // strip, on one page, not worth a rule in a 7,000-line stylesheet.
            const chip = 'display:inline-block;margin:2px 4px 0 0;padding:1px 7px;border-radius:999px;'
                + 'background:var(--surface-2, rgba(255,255,255,0.06));white-space:nowrap;';
            const moves = pendingTransfers.moves
                .map(m => `<span style="${chip}"><span style="opacity:.65;text-decoration:line-through;">${escHTML(nameOf(m.out))}</span>`
                    + ` → <strong>${escHTML(nameOf(m.in))}</strong></span>`)
                .join('');
            const armband = pendingTransfers.armband
                ? ` Armband moved to ${escHTML(nameOf(pendingTransfers.armband.to))}, as FPL does when a captain is sold.`
                : '';
            const n = pendingTransfers.moves.length;
            return `<div class="season-notice" style="display:flex;align-items:flex-start;gap:8px;padding:10px 14px;margin-bottom:12px;background:var(--color-success-muted, rgba(74,222,128,0.08));border:1px solid var(--color-success, #4ade80);border-radius:10px;font-size:12px;color:var(--text-secondary);">
                <i data-lucide="arrow-left-right" style="width:14px;height:14px;flex-shrink:0;margin-top:2px;color:var(--color-success, #4ade80);"></i>
                <span>Showing your <strong>GW${pendingTransfers.gw}</strong> squad — the ${n} transfer${n === 1 ? '' : 's'} you have already made ${n === 1 ? 'is' : 'are'} included. ${moves}${armband}</span>
            </div>`;
        }

        // Shared by the Squad Snapshot cards below (hoisted out of renderTeamOverview
        // since renderSnapshotCard is a top-level function that needs them too).
        // Transfer pressure itself lives in getTransferPressure() further down —
        // there used to be a second copy here using a hardcoded 11m player count,
        // which never ran, since the later declaration wins for every caller.
        function injuryBadge(p) {
            if (p.status === 'i' || p.status === 'u' || p.status === 's') {
                return `<span class="pitch-injury-badge">OUT</span>`;
            }
            if (p.status === 'd' && p.chanceNextRound != null && p.chanceNextRound < 100) {
                return `<span class="pitch-injury-badge doubt">${p.chanceNextRound}%</span>`;
            }
            return '';
        }
        // Set-piece duty, as published by FPL. Penalties first — a first-choice
        // taker is the single most valuable non-goal attribute in the game — then
        // direct free kicks, then corners. Only first and second choice are shown;
        // beyond that the duty rarely survives a substitution.
        function setPieceBadge(p) {
            const bits = [];
            if (p.penaltiesOrder != null && p.penaltiesOrder <= 2) {
                bits.push(`<span class="sp-badge pen${p.penaltiesOrder === 1 ? ' first' : ''}"
                    data-tooltip="${p.penaltiesOrder === 1 ? 'First-choice penalty taker' : 'Second-choice penalty taker'}">PEN</span>`);
            }
            if (p.freekicksOrder != null && p.freekicksOrder === 1) {
                bits.push(`<span class="sp-badge fk first" data-tooltip="First-choice direct free kicks">FK</span>`);
            }
            if (p.cornersOrder != null && p.cornersOrder === 1) {
                bits.push(`<span class="sp-badge ck first" data-tooltip="First-choice corners and indirect free kicks">CK</span>`);
            }
            return bits.join('');
        }

        function marketBadge(p) {
            const pr = getTransferPressure(p);
            if (pr > 0.015) return `<span class="pitch-market-badge rising">&#9650;</span>`;
            if (pr < -0.015) return `<span class="pitch-market-badge falling">&#9660;</span>`;
            return '';
        }

        // Actual, already-confirmed price move this gameweek (costChangeEvent) — distinct
        // from marketBadge() above, which predicts a LIKELY upcoming change from transfer
        // momentum. Used next to price in the squad table and replacement panels.
        // Momentum reuses getTransferPressure()/getPressureLabel() — the same model
        // and the same thresholds already behind the pitch's market badge and the
        // transfer panel — so the table can't disagree with them about who is
        // rising. Pressure is net transfers over the current owner base: one owned
        // by 300k needs far fewer net buys to move than one owned by 4m, and raw
        // net transfers alone would rank every popular player as "about to rise".
        function priceMomentum(p) {
            const net = (p.transfersIn || 0) - (p.transfersOut || 0);
            // Ignore noise: a few hundred net transfers moves nothing.
            if (Math.abs(net) < 1000) return null;

            const pressure = getTransferPressure(p);
            const { text, cls } = getPressureLabel(pressure);
            if (cls === 'stable') return null;

            return {
                net,
                pressure,
                rising: cls === 'rise',
                // Hot/Dropping sit beyond the second threshold in getPressureLabel.
                strength: Math.abs(pressure) > 0.04 ? 3 : 2,
                label: text
            };
        }

        function priceChangeBadge(p) {
            const change = (p.costChangeEvent || 0) / 10;
            let html = '';

            if (change !== 0) {
                const dir = change > 0 ? 'up' : 'down';
                const arrow = change > 0 ? '▲' : '▼';
                const verb = change > 0 ? 'risen' : 'dropped';
                html += `<span class="price-change-badge ${dir}" title="Price has ${verb} by £${Math.abs(change).toFixed(1)}m this gameweek">${arrow}</span>`;
            }

            // Hollow arrow for what is only projected, so it never reads as a
            // change that has already happened (the solid one above).
            const m = priceMomentum(p);
            if (m) {
                const pct = Math.round(Math.abs(m.pressure) * 100);
                const signed = `${m.net > 0 ? '+' : '−'}${Math.abs(m.net).toLocaleString()}`;
                html += `<span class="price-momentum ${m.rising ? 'rise' : 'fall'} t${m.strength}"
                    title="${m.label} — net ${signed} transfers this gameweek, ${pct}% of its current owners, pointing toward a price ${m.rising ? 'rise' : 'fall'}. FPL doesn't publish the exact threshold, so this is a projection.">${m.rising ? '⇧' : '⇩'}</span>`;
            }

            return html;
        }

        // ===== SQUAD TICKERS =====
        // Two scrolling strips at the top of Squad Analysis: what is going right and
        // wrong with the squad, and where its players sit in the price market. Both
        // are deliberately short — a ticker is a glance, not a report, and past four
        // items it stops being readable before it scrolls away.
        const SQ_TICKER_MAX = 6;
        // Seconds of scroll per item. Duration is derived from the item count rather
        // than fixed, so a six-item strip moves at the same speed as a two-item one
        // instead of crawling because it has more to say.
        const SQ_TICKER_SEC_PER_ITEM = 5.6;

        function buildSquadPulse() {
            const ups = [], downs = [];

            analysisResults.forEach(a => {
                const p = a.player, benched = p.onBench;
                const form = isPreseason ? (p.ppg || 0) : (parseFloat(p.form) || 0);

                if (p.status === 'i' || p.status === 'u' || p.status === 's') {
                    downs.push({ cat: 'avail', w: 100, icon: tickIcon('cross'), text: `${p.name} out${p.news ? ` — ${String(p.news).split('.')[0]}` : ''}` });
                } else if (p.status === 'd') {
                    downs.push({ cat: 'avail', w: 80 + (benched ? 0 : 10), icon: tickIcon('bandage'), text: `${p.name} doubtful${p.chanceNextRound != null ? ` (${p.chanceNextRound}%)` : ''}` });
                }
                if (!benched && form >= 6) ups.push({ cat: 'form', w: 60 + form, icon: tickIcon('flame'), text: `${p.name} in form (${form.toFixed(1)})` });
                if (!benched && form > 0 && form < 2.5) downs.push({ cat: 'form', w: 50, icon: tickIcon('snowflake'), text: `${p.name} cold (${form.toFixed(1)})` });
                if (a.verdict === 'star') ups.push({ cat: 'star', w: 70, icon: tickIcon('sparkle'), text: `${p.name} rated a star pick` });
            });

            // Fixture runs are squad-wide news, so they are reported per club rather
            // than once per player who happens to play for it.
            const seenTeams = new Set();
            analysisResults.forEach(a => {
                const p = a.player;
                if (seenTeams.has(p.teamId)) return;
                seenTeams.add(p.teamId);
                const swing = fixtureSwingData[p.teamId];
                if (!swing) return;
                const label = (teams[p.teamId] && teams[p.teamId].short_name) || p.team;
                if (swing.direction === 'improving') ups.push({ cat: 'fixture', w: 55, icon: tickIcon('calendar'), text: `${label} fixtures ease from GW${swing.swingGW}` });
                else downs.push({ cat: 'fixture', w: 55, icon: tickIcon('calendar'), text: `${label} fixtures harden from GW${swing.swingGW}` });
            });

            // Squad-level facts that decide gameweek moves but belong to no single
            // player: the armband, transfers in hand, chips, who is left to play.
            const mgr = typeof buildManagerPanelData === 'function' ? buildManagerPanelData() : null;
            if (mgr) {
                const cap = analysisResults.find(a => a.player.isCaptain);
                if (cap) {
                    const capXP = predictedGWPoints(cap.player);
                    ups.push({ cat: 'captain', w: 75, icon: tickIcon('crown'), text: `${cap.player.name} captained — ${(capXP * 2).toFixed(1)} pts projected` });
                }

                if (mgr.freeTransfers >= 2) {
                    ups.push({ cat: 'transfers', w: 62, icon: tickIcon('ticket'), text: `${mgr.freeTransfers} free transfers banked${mgr.freeTransfers >= maxFreeTransfers ? ' — at the cap, use one or lose it' : ''}` });
                } else if (mgr.freeTransfers === 0) {
                    downs.push({ cat: 'transfers', w: 62, icon: tickIcon('ticket'), text: 'No free transfer — any move costs 4 pts' });
                }
                if (mgr.hitCost > 0) downs.push({ cat: 'transfers', w: 72, icon: tickIcon('cash'), text: `−${mgr.hitCost} pts taken on transfers this gameweek` });

                if (mgr.activeChip) {
                    ups.push({ cat: 'chip', w: 90, icon: tickIcon('chip'), text: `${CHIP_LABELS[mgr.activeChip] || mgr.activeChip} active this gameweek` });
                }

                // Only worth saying while the gameweek is actually running.
                if (mgr.gwLive && mgr.progress && mgr.progress.total) {
                    const pr = mgr.progress;
                    if (pr.toPlay > 0) ups.push({ cat: 'progress', w: 58, icon: tickIcon('stopwatch'), text: `${pr.toPlay} of your XI still to play` });
                    if (pr.blank > 0) downs.push({ cat: 'progress', w: 58, icon: tickIcon('ban'), text: `${pr.blank} starter${pr.blank > 1 ? 's have' : ' has'} no fixture this gameweek` });
                }

                if (mgr.rankDelta != null && Math.abs(mgr.rankDelta) >= 1000) {
                    const climbed = mgr.rankDelta > 0;
                    (climbed ? ups : downs).push({
                        cat: 'rank', w: 54, icon: tickIcon(climbed ? 'up' : 'down'),
                        text: `Overall rank ${climbed ? 'up' : 'down'} ${Math.abs(mgr.rankDelta).toLocaleString()} places`
                    });
                }
            }

            // Rotation risk is a squad-wide problem even when no one is injured.
            const shaky = analysisResults.filter(a => !a.player.onBench
                && typeof expectedMinutesModel === 'function'
                && expectedMinutesModel(a.player).pStart < 0.6);
            if (shaky.length) {
                downs.push({ cat: 'rotation', w: 66, icon: tickIcon('swap'), text: `${shaky.length} starter${shaky.length > 1 ? 's are' : ' is'} a rotation risk (${shaky.slice(0, 2).map(a => a.player.name).join(', ')}${shaky.length > 2 ? '…' : ''})` });
            }

            // Three from one club is a concentration bet worth naming.
            const byTeam = {};
            analysisResults.filter(a => !a.player.onBench).forEach(a => { byTeam[a.player.teamId] = (byTeam[a.player.teamId] || 0) + 1; });
            Object.keys(byTeam).filter(t => byTeam[t] >= 3).forEach(t => {
                const label = (teams[t] && teams[t].short_name) || '';
                downs.push({ cat: 'stacking', w: 52, icon: tickIcon('crosshair'), text: `${byTeam[t]} starters from ${label} — your week rides on one result` });
            });

            ups.sort((a, b) => b.w - a.w);
            downs.sort((a, b) => b.w - a.w);

            // Alternate so a good week still shows its problems and a bad one still
            // shows something working — taking the top items by weight alone would
            // return six injuries and nothing that was working.
            //
            // The per-category caps matter as much as the weights: three clubs whose
            // fixtures all turn in GW5 produce three near-identical lines that eat
            // half the strip and bury the squad-level news behind them. Availability
            // gets two because individual injuries each need naming; everything else
            // gets one and yields the slot to a different kind of fact.
            const CAT_CAP = { avail: 2 };
            const used = {};
            const out = [];
            const take = (item, cls) => {
                if (!item || out.length >= SQ_TICKER_MAX) return false;
                const cat = item.cat || 'other';
                const cap = CAT_CAP[cat] || 1;
                if ((used[cat] || 0) >= cap) return false;
                used[cat] = (used[cat] || 0) + 1;
                out.push({ ...item, cls });
                return true;
            };

            // Walk both lists in weight order, alternating sides, skipping anything
            // whose category is already spoken for.
            let di = 0, ui = 0;
            while (out.length < SQ_TICKER_MAX && (di < downs.length || ui < ups.length)) {
                const before = out.length;
                while (di < downs.length && !take(downs[di], 'down')) di++;
                if (di < downs.length) di++;
                while (ui < ups.length && !take(ups[ui], 'up')) ui++;
                if (ui < ups.length) ui++;
                if (out.length === before) break;   // nothing left either side can add
            }
            return out;
        }

        function buildSquadMarketPulse() {
            if (typeof priceThresholdPct !== 'function') return [];
            const scored = analysisResults.map(a => ({ p: a.player, pct: priceThresholdPct(a.player) }))
                .filter(x => Math.abs(x.pct) >= 1);
            if (!scored.length) return [];

            const risers = scored.filter(x => x.pct > 0).sort((a, b) => b.pct - a.pct);
            const fallers = scored.filter(x => x.pct < 0).sort((a, b) => a.pct - b.pct);

            /* Direction decides the colour, distance decides how loudly it is
               said. Every part of this used to live inside one `text` string,
               which is why the strip rendered in flat body copy: the up/down
               colour rules key off .tm-tick-pct, and nothing was ever emitting
               one. The tiers come from thresholdState() rather than a number
               invented here, so this strip and the Price Watch panel cannot
               describe the same player two different ways. */
            const line = x => {
                const rising = x.pct > 0;
                const state = typeof thresholdState === 'function' ? thresholdState(x.pct) : null;
                const imminent = !!state && state.cls.indexOf('imminent') > -1;
                return {
                    cls: `${rising ? 'up' : 'down'}${imminent ? ' near' : ''}`,
                    icon: tickIcon(rising ? 'up' : 'down'),
                    text: x.p.name,
                    pct: `${rising ? '+' : '−'}${Math.abs(Math.round(x.pct))}%`,
                    note: state ? state.text : ''
                };
            };

            // The biggest mover each way first, then fill from whichever side has more.
            const out = [];
            if (fallers[0]) out.push(line(fallers[0]));
            if (risers[0]) out.push(line(risers[0]));
            for (let i = 1; out.length < SQ_TICKER_MAX && (i < risers.length || i < fallers.length); i++) {
                if (fallers[i] && out.length < SQ_TICKER_MAX) out.push(line(fallers[i]));
                if (risers[i] && out.length < SQ_TICKER_MAX) out.push(line(risers[i]));
            }
            return out;
        }

        /* The ticker's marks, drawn rather than typed.
           Both strips ran on emoji, which meant twelve vendors' drawing styles
           sitting above a chip row rendered in one consistent stroke. Same
           marks from the site's own icon set, at the ticker's size. */
        function tickIcon(name) {
            return typeof v2Icon === 'function' ? v2Icon(name) : '';
        }

        /* `kind` tags the row so a strip can colour itself. Only the market one
           does: there, up and down mean money moving one way or the other and
           the colour IS the message. The squad strip's up/down are whole
           sentences, and painting those green and red would make a paragraph of
           it while saying nothing the wording does not already. */
        function renderSquadTicker(label, items, tip, kind) {
            if (!items.length) return '';
            const one = it => `<span class="tm-tick ${it.cls}">
                <span class="tm-tick-arrow">${it.icon}</span>
                <span class="tm-tick-name">${escHTML(it.text)}</span>
                ${it.pct ? `<span class="tm-tick-pct">${escHTML(it.pct)}</span>` : ''}
                ${it.note ? `<span class="tm-tick-note">${escHTML(it.note)}</span>` : ''}
            </span>`;
            // The run is rendered twice and the track shifted by exactly half, so the
            // wrap-around is invisible. Content scrolls right to left.
            const run = items.map(one).join('<span class="tm-tick-sep">•</span>');
            const secs = (items.length * SQ_TICKER_SEC_PER_ITEM).toFixed(1);
            return `<div class="sq-ticker-row${kind ? ` sq-ticker-${kind}` : ''}">
                <span class="sq-ticker-label" data-tooltip="${escHTML(tip)}">${escHTML(label)}</span>
                <div class="tm-ticker">
                    <div class="tm-ticker-track" style="animation-duration:${secs}s">${run}<span class="tm-tick-sep">•</span>${run}<span class="tm-tick-sep">•</span></div>
                </div>
            </div>`;
        }

        function renderSquadTickers() {
            const pulse = renderSquadTicker('SQUAD', buildSquadPulse(),
                'The most significant things going right and wrong across your squad this gameweek — availability, form and fixture swings.');
            const market = renderSquadTicker('MARKET', buildSquadMarketPulse(),
                "How close your players are to a price change, on FPL's own progress meter. Green is climbing towards a rise, red is sliding towards a drop; a highlighted item is past the line and changes at tonight's update.",
                'market');
            return (pulse || market) ? `<div class="sq-tickers">${pulse}${market}</div>` : '';
        }

        /* The four figures a manager checks first, as a strip across the top:
           when the deadline is, how the squad is rated, where they rank, and
           what they have to spend. They were spread between a ring in the left
           column and rows two panels away in the right one, so answering "how
           am I doing" meant reading three places.

           Putting them here also frees the left column entirely, which is what
           lets the pitch run at the width it has on the dashboard rather than
           being squeezed into a middle third. */
        function renderSquadKpiStrip(health, healthText, healthColor) {
            const d = buildManagerPanelData();

            /* Each box leads with a tinted icon so the four are told apart
               before a word is read, and the figure is set at 32px — the old
               strip put a 26px number under an uppercase label of almost the
               same weight, so four boxes of grey text read as a caption rather
               than as the page's headline numbers. */
            const box = (tone, icon, label, value, sub, extraClass) => `<div class="sq-kpi ${extraClass || ''}">
                <span class="sq-kpi-icon tone-${tone}">${typeof v2Icon === 'function' ? v2Icon(icon) : ''}</span>
                <span class="sq-kpi-body">
                    <span class="sq-kpi-label">${label}</span>
                    <span class="sq-kpi-value">${value}</span>
                    ${sub ? `<span class="sq-kpi-sub">${sub}</span>` : ''}
                </span>
            </div>`;

            /* Same id and inner class the countdown ticker already writes into,
               so it needs no changes — and the manager card drops its own copy,
               because two elements cannot share the id it looks up. */
            const deadline = d && d.deadline
                ? `<div class="sq-kpi" id="mgrDeadline" data-deadline="${escHTML(d.deadline)}" data-gw="${d.deadlineGW}">
                       <span class="sq-kpi-icon tone-amber">${typeof v2Icon === 'function' ? v2Icon('clock') : ''}</span>
                       <span class="sq-kpi-body">
                           <span class="sq-kpi-label">GW${d.deadlineGW} deadline</span>
                           <span class="sq-kpi-value mgr-deadline-value">—</span>
                           <span class="sq-kpi-sub">until your squad locks</span>
                       </span>
                   </div>`
                : box('amber', 'clock', 'Deadline', '—', 'no upcoming gameweek');

            const rank = d
                ? box('blue', 'trophy', 'Overall rank', fmtRank(d.overallRank), renderRankDelta(d.rankDelta) || 'no change yet')
                : box('blue', 'trophy', 'Overall rank', '—', '');

            const money = d
                ? box('green', 'wallet', 'Squad value', `£${d.squadValue.toFixed(1)}m`, `£${d.bank.toFixed(1)}m in the bank`)
                : box('green', 'wallet', 'Squad value', '—', '');

            /* The number sits inside the ring rather than beside it: the ring
               is the scale for that number and nothing else, and splitting them
               made the box read as two facts instead of one. */
            const r = 30, circumference = 2 * Math.PI * r;
            const pct = Math.max(0, Math.min(100, health)) / 100;
            const healthBox = `<div class="sq-kpi sq-kpi-health">
                <span class="sq-kpi-ring-wrap">
                    <svg class="sq-kpi-ring" viewBox="0 0 72 72" aria-hidden="true">
                        <circle cx="36" cy="36" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="7"/>
                        <circle cx="36" cy="36" r="${r}" fill="none" stroke="${healthColor}" stroke-width="7"
                            stroke-linecap="round"
                            stroke-dasharray="${circumference}"
                            stroke-dashoffset="${circumference * (1 - pct)}"
                            transform="rotate(-90 36 36)"/>
                    </svg>
                    <span class="sq-kpi-ring-num" style="color:${healthColor};">${health}</span>
                </span>
                <span class="sq-kpi-body">
                    <span class="sq-kpi-label">Squad health</span>
                    <span class="sq-kpi-value" style="color:${healthColor};font-size:20px;">${escHTML(healthText)}</span>
                    <span class="sq-kpi-sub">out of 100</span>
                </span>
            </div>`;

            /* Settings stays at the end of the strip. Help does not: it now
               sits beside the page title, where the other four pages put
               theirs, so the ? is in the same place wherever you are rather
               than halfway down one page and nowhere on the rest.

               It was moved into this strip originally because it shared the
               header row with the title and squeezed the tickers below into a
               shorter run. That was a layout problem with two buttons in the
               row; one small circle inside the heading itself does not cause
               it. */
            const tools = `<div class="sq-kpi-tools">
                <button class="sq-kpi-tool" id="settingsBtn" onclick="openSettings()" aria-label="Analysis settings" data-tooltip="Analysis settings">
                    <i data-lucide="settings"></i>
                </button>
            </div>`;

            return `<div class="sq-kpis">${deadline}${healthBox}${rank}${money}${tools}</div>`;
        }

        /* What the squad needs from you, in one box beside the pitch: the
           counts that read the health score, then the moves, then the way into
           the gameweek that has just been played. */
        function renderSquadStatusCard(sells, monitors, holds, stars, suggestedMoves) {
            const reviewGW = typeof gwReviewTarget === 'function' ? gwReviewTarget() : null;
            /* computeProjectedXIScore() is the same pure function the pitch uses,
               called rather than read back off the pitch's markup — the card is
               built before the pitch is in the document, so a DOM read here
               would be null on the first render and one gameweek stale after. */
            const projected = typeof computeProjectedXIScore === 'function' ? computeProjectedXIScore() : null;
            /* The score rides on the heading's own line, the way the manager
               card carries "GW3 · LIVE" beside the name — it is a fact about
               this box rather than a row inside it. */
            return `<div class="sq-status-card">
                <div class="sq-status-head">
                    ${typeof v2Icon === 'function' ? v2Icon('activity') : ''}Squad status
                    ${projected != null ? `<span class="sq-status-score" data-tooltip="Projected points for your starting eleven over the gameweek the pitch is showing.">
                        Projected XI <b>${escHTML(String(projected))}</b><em>pts</em>
                    </span>` : ''}
                </div>

                <!-- "2 doubtful · 4 tough fixtures · 1 out of form" used to sit
                     here. Four numbers with no names against them: you could
                     read it and still not know which two, or what the fixtures
                     were, or whether the out-of-form one was your captain. It
                     is the squad report's opening paragraph now, where each
                     count is followed by the players it counted. -->

                <div class="health-verdict-counts">
                    ${sells.length ? `<span class="hv-count sell">● ${sells.length} Sell</span>` : ''}
                    ${monitors.length ? `<span class="hv-count monitor">● ${monitors.length} Monitor</span>` : ''}
                    ${stars.length ? `<span class="hv-count star">${stars.length} Star</span>` : ''}
                    <span class="hv-count hold">● ${holds.length} Hold</span>
                </div>

                <div class="health-actions">
                    <div class="insight-moves">
                        <div class="insight-moves-head">Do this week</div>
                        ${renderSuggestedMoves(suggestedMoves || [])}
                    </div>
                    ${reviewGW
                        ? `<button class="gwr-open" onclick="openGameweekReview()" data-tooltip="How your squad actually did in GW${reviewGW} — the armband, the bench, who delivered, and how it compares with the field.">${v2Icon('report')}Review Gameweek ${reviewGW}</button>`
                        : ''}
                    <!-- Same class, so it is the same button: a second one of
                         these rather than a new control to learn. Backwards in
                         time above, forwards below. -->
                    <button class="gwr-open" onclick="openSquadReport()" data-tooltip="Every status on this card written out — who is doubtful, who is out of form, who has the hard run, and the reason behind each verdict.">${v2Icon('scales')}Read the squad report</button>
                </div>
            </div>`;
        }

        /* ===== Blanks and doubles =====

           A gameweek is a BLANK for a club with no fixture in it and a DOUBLE
           for one with two. Neither exists when a season is published: all 380
           matches start out one per club per round, and they move when a club's
           league fixture clashes with a cup tie — out of the round it clashed
           with, and back into some later round once the tie is settled. So both
           appear mid-season, and the fixture list is the only record of them.
           There is no published list of affected gameweeks; counting the list is
           what produces one.

           Counted off fixtures.json, the same file every other fixture on this
           page comes from, so this cannot disagree with the run shown beside it.

           ONE THING HERE IS EASY TO GET WRONG. A club with no row in a gameweek
           is only blanking if that gameweek is in the list at all. Keying the
           result on the gameweeks that actually have fixtures means a truncated
           or short file reports fewer gameweeks examined — which the caller can
           say out loud — instead of reporting the entire rest of the season as a
           blank for all twenty clubs. */
        function fixtureLoadByGW(from, to) {
            const out = new Map();            // gw -> Map(teamId -> fixtures)
            (allFixtures || []).forEach(f => {
                const gw = f.event;
                if (gw == null || gw < from || gw > to) return;
                if (!out.has(gw)) out.set(gw, new Map());
                const m = out.get(gw);
                [f.team_h, f.team_a].forEach(t => m.set(t, (m.get(t) || 0) + 1));
            });
            return out;
        }

        /* Which of these players blank and which double, gameweek by gameweek.
           `players` is whatever squad the caller holds; each needs a teamId.
           Returns null when the fixture list says nothing about the window —
           there is a difference between a clean run and no data about one. */
        function squadFixtureLoad(players, from, to) {
            const squad = (players || []).filter(p => p && p.teamId != null);
            if (!squad.length) return null;
            const load = fixtureLoadByGW(from, to);
            if (!load.size) return null;

            const gws = [...load.keys()].sort((a, b) => a - b);
            const blanks = [], doubles = [];
            gws.forEach(gw => {
                const m = load.get(gw);
                const b = squad.filter(p => (m.get(p.teamId) || 0) === 0);
                const d = squad.filter(p => (m.get(p.teamId) || 0) > 1);
                if (b.length) blanks.push({ gw, players: b });
                if (d.length) doubles.push({ gw, players: d });
            });
            return {
                from: gws[0], to: gws[gws.length - 1], examined: gws.length,
                squadSize: squad.length,
                blanks, doubles,
                clean: !blanks.length && !doubles.length
            };
        }

        /* ===== The squad report =====

           The status card is six numbers. This is those six numbers with the
           players behind them, which is the difference between "4 tough
           fixtures" and knowing it is your captain among them.

           EVERY SENTENCE BELOW IS BUILT FROM A VALUE SOMETHING ELSE ALREADY
           COMPUTED. No figure is derived here, no threshold is invented here,
           and nothing is phrased as a likelihood. A synthesis surface is the
           easiest place on a site to write a true-sounding sentence that is not
           checkable, so the rule is that each clause names its own source: the
           form it was judged against, the median it was judged by, the FDR the
           engine weighted, the reason the verdict engine itself gave. If a
           value is absent the clause is dropped rather than defaulted — the one
           exception in the codebase, analyzePlayer's `75% chance` fallback for a
           doubtful player with no published figure, is deliberately not copied.

           Under 10% owned is the differential line, because that is the number
           the players page already shows the user ("Differentials — Under 10%
           owned") and the player card already labels at. There are five
           different thresholds in this codebase (8, 10, 12 on effective
           ownership, 15); this picks the one that is stated on screen rather
           than adding a sixth. */
        const SQR_DIFFERENTIAL_OWNERSHIP = 10;

        /* ONE set of bands for the health score, and one place they live.

           The colour used to break at 75/50 while the wording broke at
           85/70/55/40, so a squad on 72 was labelled "Good Shape" and drawn in
           warning orange at the same time, and one on 52 read "Concerning" in
           the same orange as a 68. Both now come from here.

           It is a function rather than two lines inside renderTeamOverview()
           because there are two readers: the ring above the pitch and the hero
           at the top of the squad report. A second copy would let the same
           number be called two different things on one screen — which is worse
           than either name being wrong, because the reader cannot tell which to
           believe. */
        function sqHealthBand(health) {
            /* A missing score is not a bad score, and every comparison below is
               false for one — so without this the band for NaN comes out
               "Overhaul Needed" in red, which is a confident verdict about a
               number nobody has. The squad report now prints this figure at
               40px, so being loudly wrong is a worse failure than being blank. */
            if (typeof health !== 'number' || !isFinite(health)) {
                return { known: false, text: '', color: 'var(--text-muted)' };
            }
            return {
                known: true,
                text: health >= 85 ? 'Excellent' : health >= 70 ? 'Good Shape'
                    : health >= 55 ? 'Needs Work' : health >= 40 ? 'Concerning' : 'Overhaul Needed',
                color: health >= 70 ? 'var(--verdict-hold)'
                    : health >= 55 ? 'var(--verdict-monitor)' : 'var(--verdict-sell)'
            };
        }

        // "Salah", "Salah and Palmer", "Salah, Palmer and Saka".
        function sqrJoin(parts) {
            if (!parts.length) return '';
            if (parts.length === 1) return parts[0];
            return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
        }

        function sqrPos(player) {
            return POSITION_CONFIG[player.position] || { short: '?', formMedian: null };
        }


        /* Per-gameweek rows for one player, from players-data.json.

           Deliberately not shared with the four other copies of this lookup
           (player-profile.js, pitch-snapshot.js, panels-and-tabs.js and
           gameweek-review.js each have one). Those files load on pages this one
           does not — the players page has player-profile.js and no
           team-analysis-core.js — so a helper defined here and called there is
           the shape of bug that shipped the help drawer with no stylesheet. */
        function sqrHistoryRows(playerId) {
            return (playersDetailData?.players || []).find(p => p.id === playerId)?.history || [];
        }

        /* ===== Two pictures, each next to the sentence it is about =====

           The report is prose, and prose is the right form for a verdict. It is
           the wrong form for a shape: "form 1.8, judged at 2.1 against a MID
           median of 4.0" does not distinguish a player sliding away from one who
           had a single bad week, and those want different decisions. So each
           visual goes under the one claim it illustrates and nowhere else —
           a sparkline under out-of-form, a fixture strip under the hard run.

           Both reuse markup that already exists and is already styled on this
           page: .twf-spark from the transfer funnel's shortlist cards and
           .transfer-fdr-strip from the draft planner's replacement cards. No new
           stylesheet rules, and a player's run looks the same wherever it is
           drawn. */
        const SQR_SPARK_WEEKS = 6;

        function sqrSpark(player) {
            const rows = sqrHistoryRows(player.id).slice(-SQR_SPARK_WEEKS);
            if (!rows.length) return '';
            /* A floor of 6 on the scale, so a run of ones and twos draws as a
               run of ones and twos rather than being stretched to look like a
               haul by the absence of a bigger week beside it. */
            const peak = Math.max(6, ...rows.map(h => h.total_points || 0));
            const bars = rows.map(h => {
                const pts = h.total_points || 0;
                const mins = h.minutes || 0;
                // Blue is a normal week, green a haul, grey a week he did not
                // play — the same three readings the shortlist card uses.
                const cls = mins === 0 ? ' out' : pts >= 8 ? ' haul' : '';
                const what = mins === 0 ? 'did not play' : `${pts} pt${pts === 1 ? '' : 's'}, ${mins} min`;
                return `<i class="twf-sp${cls}" style="height:${Math.max(8, (pts / peak) * 100)}%"
                    data-tooltip="GW${h.round}: ${what}"></i>`;
            }).join('');
            return `<span class="twf-spark" role="img"
                aria-label="Points in his last ${rows.length} gameweeks">${bars}</span>`;
        }

        function sqrFdrStrip(fixtures, teamId) {
            const fx = (fixtures || []).filter(f => f);
            if (!fx.length) return '';
            /* Both venues marked, not just the away ones. The sentence above the
               strip already writes "next up ARS (A)", and a badge that is silent
               for home games asks the reader to infer a convention from an
               absence. A double gameweek renders as two badges on the same round,
               which is the right picture of it. */
            const ranks = getDefensiveRanks();
            return `<span class="transfer-fdr-strip">${fx.map(f => {
                let tip = `GW${f.event ?? '?'}: ${escHTML(f.opponent || '?')} ${f.isHome ? 'at home' : 'away'}`
                    + `, difficulty ${f.difficulty ?? '?'} of 5`;
                // Same measured read as the squad table's own strip, so a fixture
                // does not mean one thing in the table and another in the report.
                const ctx = opponentContext(teamId, f, ranks);
                if (ctx && ctx.ranked) tip += `. They concede ${ctx.conceded.toFixed(1)} a game, ${ordinal(ctx.rank)} leakiest of ${ctx.total}.`;
                return `<span class="transfer-fdr-badge fdr-${f.difficulty || 3}"
                    data-tooltip="${tip}"
                    >${escHTML(f.opponent || '?')} (${f.isHome ? 'H' : 'A'})</span>`;
            }).join('')}</span>`;
        }

        /* How far ahead the blank-and-double scan looks.

           Eight gameweeks, stated in the copy so the window can be checked. FPL
           reschedules a few weeks out rather than months, so a shorter run would
           miss announcements that are already on the list, and a scan to GW38
           would flag a blank for players who will not be in this squad by then.
           Chip windows are the thing this is read for, and eight weeks is about
           as far as a chip is worth planning. */
        const SQR_FIXTURE_HORIZON = 8;

        function buildSquadReport() {
            const results = (typeof analysisResults !== 'undefined' && analysisResults) || [];
            if (!results.length) return null;
            const h = computeSquadHealth(results);
            const starterIds = new Set(h.starters.map(a => a.player.id));
            const squad = h.starters.concat(h.bench).map(a => a.player);

            /* Price moves, from scripts/price-watch.js rather than from a reading
               of our own: that file holds FPL's published meter and the two tiers
               it supports, and a second classification here would let this report
               call a player due on a night the market ticker did not. Everything
               below PW_CLOSE comes back null and is simply not mentioned. */
            const priceMoves = (typeof pwClassify === 'function'
                ? squad.map(p => pwClassify(p, typeof PW_CLOSE === 'number' ? PW_CLOSE : 80))
                : []).filter(Boolean).sort((a, b) => Math.abs(b.progress) - Math.abs(a.progress));

            return {
                squad,
                /* The status card's list, not a second opinion about it — see the
                   comment on squadSuggestedMoves. Defaulted so the report still
                   renders if it is opened before renderTeamAnalysis has run. */
                moves: (typeof squadSuggestedMoves !== 'undefined' && squadSuggestedMoves) || [],
                priceMoves,
                fixtureLoad: typeof squadFixtureLoad === 'function'
                    ? squadFixtureLoad(squad, planningGW, planningGW + SQR_FIXTURE_HORIZON - 1)
                    : null,
                health: h.health,
                starters: h.starters, bench: h.bench, starterIds,
                injured: h.injuredStarters,
                doubtful: h.doubtfulStarters,
                tough: h.toughFixtureStarters,
                poorForm: h.poorFormStarters,
                cap: h.capAnalysis,
                sells: results.filter(a => a.verdict === 'sell'),
                monitors: results.filter(a => a.verdict === 'monitor'),
                stars: results.filter(a => a.verdict === 'star'),
                holds: results.filter(a => a.verdict === 'hold'),
                /* Starters only. A differential you are not playing gains you
                   nothing, so counting the bench in would overstate it. */
                differentials: h.starters.filter(a =>
                    typeof a.player.ownership === 'number'
                    && a.player.ownership < SQR_DIFFERENTIAL_OWNERSHIP)
            };
        }

        function sqrSection(icon, title, accent, rows) {
            if (!rows.length) return '';
            return `<div class="detail-section" data-accent="${accent}">
                <div class="detail-section-title">${v2Icon(icon)} ${escHTML(title)}</div>
                ${rows.join('')}
            </div>`;
        }

        function sqrItem(tone, html) {
            return `<div class="insight-item ${tone}"><div class="insight-text">${html}</div></div>`;
        }

        /* ===== One player, one row =====

           This report was fourteen .insight-item cards: a 3px left edge and a
           paragraph of grey text, all the same size, all the same shape. Every
           fact in it was true and none of it was scannable — you had to read a
           sentence to find out which player it was about, and the number that
           decided the verdict was buried mid-clause.

           So it borrows the Gameweek Review's row instead, which already solves
           this on the next tab across: position badge, face and crest, name,
           then the reason, then the figure that decided it, right-aligned. Same
           component, same page, so a player looks like himself in both — and the
           eye can run down the right-hand column instead of reading prose.

           `sub` is for the one or two findings that genuinely are a sentence.
           .gwr-row-detail is a single line with an ellipsis, so anything longer
           than a few words has to go beneath the row rather than be silently
           cut off in the middle. */
        function sqrRow(o) {
            const p = o.player;
            const cfg = sqrPos(p);
            const face = typeof v2IdentityHTML === 'function' ? v2IdentityHTML(p) : '';
            const tags = [];
            if (p.isCaptain) tags.push('captain');
            if (o.bench) tags.push('bench');
            return `<div class="gwr-row sqr-row ${o.tone || ''}">
                <span class="position-badge ${cfg.class || ''}">${escHTML(cfg.short)}</span>
                ${face}
                <span class="gwr-row-name">${escHTML(p.name)}</span>
                <span class="gwr-row-opp">${escHTML(tags.join(' · '))}</span>
                <span class="gwr-row-detail">${o.detail || ''}</span>
                ${o.viz || ''}
                ${o.right || ''}
            </div>${o.sub ? `<div class="sqr-sub">${o.sub}</div>` : ''}`;
        }

        // The decisive figure, right-aligned — the column the eye runs down.
        function sqrFig(value, unit) {
            return `<span class="gwr-row-pts">${value}${unit ? `<em>${unit}</em>` : ''}</span>`;
        }

        function sqrChip(kind, label) {
            return `<span class="sqr-chip ${kind}">${escHTML(label)}</span>`;
        }

        function renderSquadReport(d) {
            if (!d) return `<p class="gwr-line">No squad loaded yet.</p>`;

            /* ===== The hero =====

               The report used to open on a sentence: "Squad health 72/100. Of
               your 11 starters, 1 is a fitness doubt and 2 face a hard next
               fixture." Every word of that is still here — it is just no longer
               the first thing to read, because a paragraph is a poor answer to
               "how bad is it". The number is the answer, so the number is the
               size of the answer, in the colour its own band gives it.

               Same hero the Gameweek Review opens on, for the same reason. */
            const bits = [];
            if (d.injured.length) bits.push(`${d.injured.length} cannot play`);
            if (d.doubtful.length) bits.push(`${d.doubtful.length} ${d.doubtful.length === 1 ? 'is' : 'are'} a fitness doubt`);
            if (d.tough.length) bits.push(`${d.tough.length} ${d.tough.length === 1 ? 'faces' : 'face'} a hard next fixture`);
            if (d.poorForm.length) bits.push(`${d.poorForm.length} ${d.poorForm.length === 1 ? 'is' : 'are'} out of form`);
            const band = sqHealthBand(d.health);

            /* The four counts that say what to DO, which is what the sections
               below are evidence for. They also carry the counts that used to be
               three separate headings — "Sell (2)", "Monitor (4)", "Star (1)" —
               so those three collapse into one section further down. */
            const stat = (value, label, tip, color) =>
                `<div class="opt-stat"><div class="opt-stat-v"${color ? ` style="color:${color};"` : ''}>${value}</div>
                    <div class="opt-stat-l" data-tooltip="${escHTML(tip)}">${escHTML(label)}</div></div>`;

            let html = `<div class="detail-section" data-accent="report">
                <div class="detail-section-title">${v2Icon('activity')} Where the squad stands</div>
                <div class="gwr-hero">
                    <div class="gwr-hero-pts" style="color:${band.color};">${band.known ? d.health : '—'}<span>/100</span></div>
                    <div class="gwr-hero-text">
                        ${band.known ? `<strong>${escHTML(band.text)}.</strong>` : ''}
                        ${bits.length
                            ? `Of your ${d.starters.length} starters, ${sqrJoin(bits)}.`
                            : `Nothing is flagged against any of your ${d.starters.length} starters — no injuries, no doubts, no hard next fixture, nobody out of form.`}
                        Health reads availability, form and the next fixture; everything in it has already happened.
                    </div>
                </div>
                <div class="opt-grid">
                    ${stat(d.sells.length, 'Sell', 'The numbers argue for moving these on. Each one is listed below with the reason the verdict engine gave.', d.sells.length ? 'var(--verdict-sell)' : '')}
                    ${stat(d.monitors.length, 'Monitor', 'Worth watching rather than acting on this week.', d.monitors.length ? 'var(--verdict-monitor)' : '')}
                    ${stat(d.stars.length, 'Star', 'Performing well enough that selling would be the mistake.', d.stars.length ? 'var(--verdict-star)' : '')}
                    ${stat(d.differentials.length, 'Differentials', `Starters owned by under ${SQR_DIFFERENTIAL_OWNERSHIP}% of managers — where your rank can move away from the field.`)}
                </div>
            </div>`;

            /* Availability. The status word is the same mapping analyzePlayer
               uses, and the chance and the news are FPL's own strings — printed
               only when FPL actually published them. */
            /* FPL writes the percentage into the news string itself — Konsa's
               reads "Unspecified injury - 75% chance of playing" — so adding
               our own chance sentence beside it says the same thing twice in
               one line. The figure is only printed when the news has not
               already printed it, or when there is no news to print. */
            const availBody = (p, prefix) => {
                const news = p.news ? escHTML(p.news) : '';
                const pctAlreadyThere = /\d+\s*%/.test(p.news || '');
                const chance = (p.chanceNextRound != null && !pctAlreadyThere)
                    ? `${p.chanceNextRound}% chance of playing.` : '';
                const body = [prefix, chance, news].filter(Boolean).join(' ');
                return body || 'Flagged, with no detail published.';
            };
            const bench = a => !d.starterIds.has(a.player.id);
            const availRows = [];
            d.injured.forEach(a => {
                const p = a.player;
                const word = p.status === 'i' ? 'Injured' : p.status === 'u' ? 'Unavailable' : 'Suspended';
                availRows.push(sqrRow({
                    player: p, bench: bench(a), tone: 'is-bad',
                    detail: word, right: sqrChip('sell', 'Out'),
                    /* The detail cell is one line with an ellipsis, so FPL's news
                       string goes beneath the row rather than being cut off mid
                       word. It is the one part of this a manager actually needs
                       to read. */
                    sub: availBody(p, '')
                }));
            });
            d.doubtful.forEach(a => {
                availRows.push(sqrRow({
                    player: a.player, bench: bench(a), tone: 'is-warn',
                    detail: 'Fitness doubt', right: sqrChip('monitor', 'Doubt'),
                    sub: availBody(a.player, '')
                }));
            });
            html += sqrSection('warn', 'Availability', 'concerns', availRows);

            /* Form. Both figures, because the card prints the raw one and the
               verdict is reached on the regressed one — showing only the second
               would put a number in the report that disagrees with the number
               on the player's own card for no visible reason. */
            const formRows = d.poorForm.map(a => {
                const cfg = sqrPos(a.player);
                const raw = typeof a.rawForm === 'number' ? a.rawForm : null;
                const eff = typeof a.effectiveForm === 'number' ? a.effectiveForm : null;
                const shown = raw != null && eff != null && Math.abs(raw - eff) >= 0.1
                    ? `form ${raw.toFixed(1)}, judged at ${eff.toFixed(1)} once regressed for matches played`
                    : `form ${(eff != null ? eff : raw).toFixed(1)}`;
                const median = cfg.formMedian != null
                    ? `, against a ${escHTML(cfg.short)} median of ${cfg.formMedian}` : '';
                return sqrRow({
                    player: a.player, bench: bench(a), tone: 'is-warn',
                    /* No detail cell. It carried "FWD median 4.5", which the
                       sub-line underneath already says in the sentence that
                       compares him to it — so the row read "FWD median 4.5 …
                       1.0 form" above "form 1.0, against a FWD median of 4.5".
                       The same two numbers twice in three inches. */
                    /* The shape behind the number. Two players on the same form
                       figure are different problems if one is sliding and the
                       other had a single bad week, and the figure cannot tell
                       them apart — so it sits in its own slot beside it. */
                    viz: sqrSpark(a.player),
                    // The regressed figure, because that is the one the verdict
                    // was reached on. The raw one is in the sub-line below.
                    right: eff != null || raw != null
                        ? sqrFig((eff != null ? eff : raw).toFixed(1), 'form') : '',
                    // Verbatim, lower case and all: it is a continuation of the
                    // row above it, and it is the sentence the player's own card
                    // has to agree with word for word.
                    sub: `${shown}${median}.`
                });
            });
            html += sqrSection('trend', 'Out of form', 'concerns', formRows);

            /* Fixtures. avgFDR is the weighted figure analyzePlayer already put
               on the player — first fixture counts 3, fifth counts 1 — so this
               is the same number the player card shows, not a mean computed
               here that would quietly differ from it. */
            const fixRows = d.tough.map(a => {
                const f = (a.fixtures || [])[0];
                const next = f
                    ? `next up ${escHTML(f.opponent || '???')} ${f.isHome ? '(H)' : '(A)'} at FDR ${f.difficulty}`
                    : '';
                const run = typeof a.player.avgFDR === 'number'
                    ? `weighted FDR ${a.player.avgFDR.toFixed(1)} over his next ${(a.fixtures || []).length}`
                    : '';
                return sqrRow({
                    player: a.player, bench: bench(a), tone: 'is-warn',
                    /* No detail cell either, and for the same reason: it said
                       "MUN (A) next" immediately to the left of a strip whose
                       first badge is MUN (A). */
                    /* The run itself, in the colours the fixture tables use. The
                       figure on the right is the weighted average; the strip is
                       which weeks are the hard ones, which is what decides
                       whether to sell him now or ride it out. */
                    viz: sqrFdrStrip(a.fixtures, a.player.teamId),
                    right: typeof a.player.avgFDR === 'number'
                        ? sqrFig(a.player.avgFDR.toFixed(1), 'FDR') : '',
                    sub: `${[next, run].filter(Boolean).join(', ')}.`
                });
            });
            html += sqrSection('calendar', 'The hard run', 'fixtures', fixRows);

            /* ===== Blanks and doubles =====

               Unlike every other section here, this one speaks even when it has
               found nothing — because "no blanks or doubles are scheduled" is
               itself the answer to a question a manager asks before spending a
               chip, and an absent section would be indistinguishable from a
               broken one. What it must never do is imply that a clean list will
               stay clean: the reason it is clean in October is that the cup
               rounds that empty a gameweek have not been drawn yet.

               Silent only when the fixture list cannot answer at all. */
            const fl = d.fixtureLoad;
            if (fl) {
                const names = (players) => sqrJoin(players.slice(0, 6).map(p => `<b>${escHTML(p.name)}</b>`))
                    + (players.length > 6 ? ` and ${players.length - 6} more` : '');
                const loadRows = [];
                fl.doubles.forEach(x => loadRows.push(sqrItem('positive',
                    `<b>GW${x.gw}</b> is a double for ${x.players.length} of your ${fl.squadSize}: ${names(x.players)}. Two fixtures each, so two chances to score.`)));
                fl.blanks.forEach(x => loadRows.push(sqrItem('critical',
                    `<b>GW${x.gw}</b> is a blank for ${x.players.length} of your ${fl.squadSize}: ${names(x.players)}. No fixture at all, so no points.`)));
                if (fl.clean) {
                    loadRows.push(sqrItem('positive',
                        `Across GW${fl.from}–GW${fl.to} every one of your ${fl.squadSize} players has exactly one fixture every week — no blanks and no doubles on the list yet. Gameweeks empty out when a club's league match clashes with a cup tie, so these appear during the season rather than at the start of it.`));
                }
                html += sqrSection('calendar',
                    fl.clean ? 'Blanks and doubles' : `Blanks and doubles (GW${fl.from}–GW${fl.to})`,
                    'fixtures', loadRows);
            }

            /* ===== The call on each player =====

               One section, not three. "Sell (2)", "Monitor (4)" and "Star (1)"
               were three headings over three lists of the same kind of thing,
               and at one or two rows each the chrome outweighed the content. The
               counts moved into the grid at the top, where they are read at a
               glance, and the verdict itself rides on the row as a chip — so the
               order sell, monitor, star is visible rather than announced.

               The reason is verdictReason, the engine's own sentence for the
               verdict it reached, and not a second explanation composed here
               which could disagree with the chip it is explaining. */
            const CALL = {
                sell: { chip: 'sell', label: 'Sell', tone: 'is-bad' },
                monitor: { chip: 'monitor', label: 'Monitor', tone: 'is-warn' },
                star: { chip: 'star', label: 'Star', tone: 'is-good' }
            };
            const callRows = [...d.sells, ...d.monitors, ...d.stars].map(a => {
                const c = CALL[a.verdict] || CALL.monitor;
                return sqrRow({
                    player: a.player, bench: bench(a), tone: c.tone,
                    right: sqrChip(c.chip, c.label),
                    sub: a.verdictReason ? escHTML(a.verdictReason) : ''
                });
            });
            html += sqrSection('swap', 'The call on each player', 'concerns', callRows);

            /* ===== Price watch =====

               Every word of this comes out of scripts/price-watch.js — the tier,
               the label and the sentence — because that file is where the two
               tiers are defined and the difference between them is the whole
               point. "Due" means the meter is full and the change fires at the
               next daily update. "Closing in" means a player is near the line and
               nothing more: measured over a real overnight window, the game's own
               next-day projection flagged nineteen players to catch four actual
               changes. Writing our own sentence here would be writing one that
               can promise tonight, which that measurement says we cannot.

               The sell list is read for one extra clause and no new judgement.
               A player you are already minded to sell who is about to drop is a
               timing fact, not a new recommendation: the 0.1 goes either way
               depending only on whether the move happens before the update. */
            const sellIds = new Set(d.sells.map(a => a.player.id));
            const priceRows = (d.priceMoves || []).map(c => {
                const falling = c.dir === 'fall';
                const timing = falling && sellIds.has(c.id)
                    ? ` He is on your sell list above, so this is a timing question: moving him before the update keeps the 0.1, moving him after it does not.`
                    : '';
                // Dropped rather than printed as "£undefinedm" — one bad field
                // would otherwise take the whole report down with it.
                const price = typeof c.player.price === 'number' ? `£${c.player.price.toFixed(1)}m` : '';
                return sqrRow({
                    player: c.player,
                    tone: falling ? (c.tier === 'due' ? 'is-bad' : 'is-warn') : 'is-good',
                    detail: price,
                    /* The label and the sentence both come out of
                       scripts/price-watch.js, so the chip can never promise a
                       night the sentence below it does not. */
                    right: sqrChip(falling ? 'sell' : 'hold', pwLabel(c)),
                    sub: `${escHTML(pwDetail(c))}${timing}`
                });
            });
            html += sqrSection('wallet', 'Price watch', 'concerns', priceRows);

            /* Differentials. The threshold is stated on purpose: a count with an
               unstated cut-off is not a fact the reader can check, and this one
               has four rivals in the codebase. */
            // No detail cell: the ownership figure on the right IS the finding,
            // and "owned by the field" next to it said nothing — every player is.
            const diffRows = d.differentials.map(a => sqrRow({
                player: a.player, tone: 'is-good',
                right: sqrFig(a.player.ownership.toFixed(1), '% owned')
            }));
            html += sqrSection('users', 'Differentials', 'positives',
                diffRows.length
                    ? diffRows.concat([`<div class="opt-why">${diffRows.length} of your ${d.starters.length}
                        starters ${diffRows.length === 1 ? 'is' : 'are'} owned by under
                        ${SQR_DIFFERENTIAL_OWNERSHIP}% of managers — that is where your rank can move
                        away from the field, in either direction.</div>`])
                    : [sqrItem('positive', `None of your ${d.starters.length} starters is owned by under ${SQR_DIFFERENTIAL_OWNERSHIP}% — every one of them is a player the field also has.`)]);

            /* ===== What to do this week =====

               The sections above answer one question each. Nobody opens a report
               to assemble the conclusion themselves, so this is the conclusion —
               the same closing block the Gameweek Review ends on, and built the
               same way: only lines with something to act on, every one of them
               derived from a value a section above has already shown.

               Holds live here now. "The remaining 9 players are a hold" was the
               last line of the report and read as an apology for the report; as
               one line of a summary it is simply the good news. */
            const next = [];
            if (d.injured.length) {
                next.push({ tone: 'bad', icon: v2Icon('warn'), text: `${sqrJoin(d.injured.map(a => `<b>${escHTML(a.player.name)}</b>`))} cannot play. A starter who is out scores nothing and the bench only rescues it if the auto-sub order allows, so this is the one thing on the list with a deadline.` });
            }
            const dueDrop = (d.priceMoves || []).filter(c => c.dir === 'fall' && c.tier === 'due' && sellIds.has(c.id));
            if (dueDrop.length) {
                next.push({ tone: 'bad', icon: v2Icon('wallet'), text: `${sqrJoin(dueDrop.map(c => `<b>${escHTML(c.player.name)}</b>`))} ${dueDrop.length === 1 ? 'is' : 'are'} on your sell list and ${dueDrop.length === 1 ? 'drops' : 'drop'} at the next daily update. Moving before it keeps the 0.1.` });
            }
            /* ===== The moves themselves, from the one list that produces them
               =====

               This block used to count verdicts: "1 player the numbers argue for
               moving on". The card two inches behind it was naming two concrete
               upgrades with their xP gains. Both headings say "do this week" and
               they gave different answers, because they were answering different
               questions — the card asks the transfer engine "what is the biggest
               xP gain available at your budget", the report was asking the
               verdict engine "which of my players has something wrong with him".

               A player can be a perfectly good hold and still be the best
               upgrade going, because someone far better is affordable; and he can
               be a sell with no affordable replacement. Both are legitimate, and
               two legitimate answers under one heading is still a bug. So the
               report reads d.moves — the same array the card renders — and the
               verdict counts stay where they belong, as the evidence in the
               sections above.

               Title and detail are the card's own strings, so the two surfaces
               cannot drift into describing one move differently. */
            (d.moves || []).forEach(m => {
                next.push({
                    tone: m.urgent ? 'bad' : 'mixed',
                    icon: m.icon,
                    text: `<b>${escHTML(m.title)}</b> — ${escHTML(m.detail)}`
                });
            });
            const nearBlank = d.fixtureLoad && d.fixtureLoad.blanks[0];
            if (nearBlank) {
                next.push({ tone: 'mixed', icon: v2Icon('calendar'), text: `<b>GW${nearBlank.gw}</b> leaves ${nearBlank.players.length} of your squad without a fixture. That is a chip question rather than a transfer one.` });
            }
            /* The closing reassurance, and it has to add up. "The other 6 players
               are a hold" after a line about one sell implied a squad of seven;
               holds are one of four verdicts and the other two are not nothing.
               Counted against the whole squad, which is the only denominator a
               reader can check. */
            if (d.squad.length) {
                const flagged = d.sells.length + d.monitors.length;
                /* A list rather than a sentence, so there is no verb to agree
                   with a count that can be one: "1 are a straight hold and 0 are
                   performing too well" is what the sentence version produced. */
                next.push({
                    tone: 'good',
                    icon: v2Icon('check'),
                    text: flagged
                        ? `Of your ${d.squad.length} players: <b>${d.holds.length}</b> to hold, <b>${d.stars.length}</b> performing too well to touch, <b>${flagged}</b> carrying a flag.`
                        : `Nothing is flagged against any of your ${d.squad.length} players.`
                });
            }
            html += `<div class="detail-section">
                <div class="detail-section-title">${v2Icon('cap')} What to do this week</div>
                ${next.length
                    ? `<div class="gwr-learnings">${next.map(l =>
                        `<div class="gwr-learning ${l.tone}"><span class="gwr-learning-icon">${l.icon}</span><span>${l.text}</span></div>`).join('')}</div>`
                    : '<div class="opt-empty">Nothing in the numbers argues for a move this week.</div>'}
            </div>`;

            return html;
        }

        /* Reuses the shared report shell, as the Lineup Wizard, the draft planner
           and the gameweek review all do — see optReportShow() in
           scripts/pitch-snapshot.js. Opened as a centred modal rather than the
           520px drawer: the fixture strips and sparklines added to the sections
           above need the width, and at 520px they wrapped. */
        function openSquadReport() {
            optReportShow('Squad report', 'scales', renderSquadReport(buildSquadReport()), { modal: true });
        }

        function renderTeamOverview(health, sells, monitors, holds, stars, suggestedMoves) {
            const { text: healthText, color: healthColor } = sqHealthBand(health);

            return `
            ${renderSquadKpiStrip(health, healthText, healthColor)}
            <div class="team-overview">
                ${renderSnapshotBody()}
                <aside class="sq-side">
                    ${renderSquadStatusCard(sells, monitors, holds, stars, suggestedMoves)}
                    ${renderManagerCard()}
                </aside>
            </div>`;
        }

        // Right-hand column of the squad overview. Reads the managerData/picksData
        // globals directly (both assigned in loadTeamById before analyzeTeam() runs).
        // ===== MANAGER PANEL DATA =====
        // Every figure the panel shows is derived here so the render stays dumb and
        // each derivation can be checked on its own.
        const CHIP_LABELS = { wildcard: 'Wildcard', freehit: 'Free Hit', bboost: 'Bench Boost', '3xc': 'Triple Captain' };
        /* One line mark per chip, in the same stroke as every other icon in this
           panel. They were emoji — a playing card, a die, a chair and a crown —
           which is four pictures from a set the rest of the page does not use,
           drawn differently on every platform.

           Names, not markup. This file is loaded before scripts/common.js, so
           calling v2Icon() while this object is being built runs before the
           function exists — it is resolved at render time instead. */
        const CHIP_ICON_NAMES = { wildcard: 'chip', freehit: 'refresh', bboost: 'boost', '3xc': 'crown' };
        const chipIcon = name => (typeof v2Icon === 'function' ? v2Icon(CHIP_ICON_NAMES[name] || 'chip') : '');

        // FPL never exposes how many free transfers you hold, so it has to be
        // replayed from the transfer history: +1 per gameweek, capped, minus the
        // transfers made, and a gameweek played under a Wildcard or Free Hit
        // leaves the bank exactly as it found it — see twDeriveFreeTransfers for
        // why that is a freeze and not a free week. GW1 is squad creation, which
        // is unlimited.
        function deriveFreeTransfers() {
            const rows = managerHistory?.current || [];
            if (!rows.length) return { count: 1, exact: false };

            // Replayed by the shared engine so the dashboard cannot drift from this.
            let ft = typeof twDeriveFreeTransfers === 'function'
                ? twDeriveFreeTransfers(rows, managerHistory?.chips, maxFreeTransfers)
                : 1;
            /* History gains a row at each DEADLINE, not when the round is
               finally scored — checked against a live account, whose GW5 row was
               already present, on nil points, four hours after that deadline and
               three days before the round ended. So the replay above is current
               as far as the last deadline, and the moves it cannot know about
               are the ones being staged right now for the round being planned.
               Without deducting them the panel offers two free transfers to a
               manager who has just spent both. A Wildcard or Free Hit played for
               that round would make them free again, and neither is visible
               before the deadline, so the count reads low for the one case where
               nothing was spent. */
            const spent = pendingTransfers ? pendingTransfers.moves.length : 0;
            ft = Math.max(0, ft - spent);
            // Only trustworthy if the history covers every gameweek up to now.
            const exact = rows.length >= (currentGW - (rows.some(r => r.event === currentGW) ? 0 : 1));
            return { count: ft, exact };
        }

        // A chip is available if its window covers the upcoming gameweek and the
        // manager hasn't already played that particular one. The windows come from
        // bootstrap (each chip is issued once per half of the season).
        function deriveChipStatus(forGW) {
            const used = managerHistory?.chips || [];
            const seen = {};
            const out = [];
            chipDefinitions.forEach(def => {
                if (forGW < def.start_event || forGW > def.stop_event) return;
                if (seen[def.name]) return;
                seen[def.name] = true;
                const spent = used.some(u => u.name === def.name && u.event >= def.start_event && u.event <= def.stop_event);
                out.push({ name: def.name, label: CHIP_LABELS[def.name] || def.name, icon: chipIcon(def.name), available: !spent });
            });
            return out;
        }

        // How far through the gameweek the starting XI is. Counts each player once
        // even in a double gameweek. Players blanking this gameweek are held apart
        // rather than folded into "played": they never play, so counting them as
        // done overstates progress and counting them as pending never resolves.
        function deriveLiveProgress() {
            const ids = snapshotXI.size ? [...snapshotXI] : selectedPlayers.filter(p => !p.onBench).map(p => p.id);
            const gwFixtures = allFixtures.filter(f => f.event === currentGW);
            let played = 0, live = 0, toPlay = 0, blank = 0;

            ids.forEach(id => {
                const player = selectedPlayers.find(p => p.id === id) || allPlayersById[id];
                if (!player) return;
                const mine = gwFixtures.filter(f => f.team_h === player.teamId || f.team_a === player.teamId);
                if (!mine.length) { blank++; return; }
                if (mine.some(f => f.started && !f.finished_provisional)) live++;
                else if (mine.every(f => f.finished_provisional)) played++;
                else toPlay++;
            });
            return { played, live, toPlay, blank, total: played + live + toPlay };
        }

        function buildManagerPanelData() {
            if (!managerData) return null;

            const rows = managerHistory?.current || [];
            const thisRow = rows.find(r => r.event === currentGW) || rows[rows.length - 1] || null;
            const prevRow = rows.length > 1 ? rows[rows.length - 2] : null;

            // Positive delta = climbed. FPL ranks count upward, so an improvement is
            // a decrease, hence previous minus current.
            const overallRank = managerData.summary_overall_rank ?? thisRow?.overall_rank ?? null;
            const rankDelta = (prevRow && thisRow && prevRow.overall_rank && thisRow.overall_rank)
                ? prevRow.overall_rank - thisRow.overall_rank
                : null;

            // entry_history.value is the whole team including cash — confirmed
            // against the API, where value stays 1000 while bank varies. Subtract
            // the bank to get what the players themselves are worth.
            const bankTenths = picksData?.entry_history?.bank ?? thisRow?.bank ?? 0;
            const valueTenths = picksData?.entry_history?.value ?? thisRow?.value ?? 0;

            const nextEvent = gwEvents.find(e => e.is_next)
                || gwEvents.find(e => e.id === currentGW + 1)
                || null;
            /* In progress means matches are being played, not that FPL has
               finished checking the round. An event's `finished` flips at the
               data check — bonus confirmed across every match — a day or more
               after the last whistle, so this badge read "GW3 · LIVE" all
               Monday for a gameweek that ended on Sunday afternoon.
               First kickoff to final whistle, and steady in between: the gap
               between two kickoffs is still the gameweek in progress, which is
               exactly when "3 of your XI still to play" is worth saying. */
            const gwFixtures = (allFixtures || []).filter(f => f.event === currentGW);
            const gwLive = gwFixtures.some(f => f.started) && !gwFixtures.every(f => f.finished_provisional);
            const deadlineGW = nextEvent ? nextEvent.id : currentGW;

            const ft = deriveFreeTransfers();

            return {
                name: `${managerData.player_first_name || ''} ${managerData.player_last_name || ''}`.trim() || 'Manager',
                teamName: managerData.name || '',
                gw: currentGW,
                gwLive,
                overallRank,
                rankDelta,
                gwRank: thisRow?.rank ?? managerData.summary_event_rank ?? null,
                gwPoints: thisRow?.points ?? managerData.summary_event_points ?? null,
                totalPoints: managerData.summary_overall_points ?? thisRow?.total_points ?? null,
                squadValue: (valueTenths - bankTenths) / 10,
                bank: bankTenths / 10,
                totalValue: valueTenths / 10,
                freeTransfers: ft.count,
                freeTransfersExact: ft.exact,
                transfersMade: thisRow?.event_transfers ?? 0,
                hitCost: thisRow?.event_transfers_cost ?? 0,
                // Moves already made for the round being planned, which no
                // history row covers yet — see applyPendingTransfers().
                pendingCount: pendingTransfers ? pendingTransfers.moves.length : 0,
                pendingGW: pendingTransfers ? pendingTransfers.gw : null,
                activeChip: picksData?.active_chip || null,
                chips: deriveChipStatus(deadlineGW),
                deadline: nextEvent?.deadline_time || null,
                deadlineGW,
                progress: deriveLiveProgress()
            };
        }

        // One timer only: every re-render clears the previous one, and the tick
        // stops itself once the element it writes into is gone.
        let deadlineTimer = null;
        function startDeadlineCountdown() {
            if (deadlineTimer) { clearInterval(deadlineTimer); deadlineTimer = null; }
            const tick = () => {
                const el = document.getElementById('mgrDeadline');
                const out = el && el.querySelector('.mgr-deadline-value');
                if (!out) { clearInterval(deadlineTimer); deadlineTimer = null; return; }

                const diff = new Date(el.dataset.deadline).getTime() - Date.now();
                if (!isFinite(diff)) { out.textContent = '—'; return; }
                if (diff <= 0) {
                    /* LOCKED, in caps, because that is what the dashboard's
                       deadline says and they are the same fact on two pages. */
                    out.textContent = 'LOCKED';
                    el.classList.add('passed');
                    clearInterval(deadlineTimer); deadlineTimer = null;
                    return;
                }
                const days = Math.floor(diff / 86400000);
                const hrs = Math.floor(diff / 3600000) % 24;
                const mins = Math.floor(diff / 60000) % 60;
                const secs = Math.floor(diff / 1000) % 60;
                // Seconds at every scale: the deadline is a hard cut-off, and a
                // figure that only moves once a minute reads as stale near it.
                out.textContent = days > 0 ? `${days}d ${hrs}h ${mins}m ${secs}s`
                    : hrs > 0 ? `${hrs}h ${mins}m ${secs}s`
                    : `${mins}m ${secs}s`;
                el.classList.toggle('urgent', diff < 6 * 3600000);
            };
            tick();
            deadlineTimer = setInterval(tick, 1000);
        }

        function fmtRank(n) { return n == null ? '—' : n.toLocaleString(); }

        function renderRankDelta(delta) {
            if (delta == null || delta === 0) return '';
            const up = delta > 0;
            return `<span class="mgr-delta ${up ? 'up' : 'down'}" title="${up ? 'Climbed' : 'Dropped'} ${Math.abs(delta).toLocaleString()} places since last gameweek">
                ${up ? '▲' : '▼'} ${Math.abs(delta).toLocaleString()}</span>`;
        }

        function renderManagerCard() {
            const d = buildManagerPanelData();
            if (!d) return '<div class="manager-info"></div>';

            const chipsAvail = d.chips.filter(ch => ch.available);
            const activeLabel = d.activeChip ? (CHIP_LABELS[d.activeChip] || d.activeChip) : null;

            /* "No transfers made yet" is the one thing this line must not say to
               a manager who has just made two for the round being planned. Those
               are the ones on their mind, so they lead when they exist. */
            const ftNote = d.pendingCount
                ? `${d.pendingCount} already made for GW${d.pendingGW}`
                : d.transfersMade
                    ? `${d.transfersMade} made this GW${d.hitCost ? ` · −${d.hitCost} pts` : ''}`
                    : 'No transfers made yet';

            const p = d.progress;
            const progressPct = p.total ? Math.round(((p.played + p.live * 0.5) / p.total) * 100) : 0;

            return `<div class="manager-info">
                <div class="manager-name">
                    <span>${escHTML(d.name)}</span>
                    <span class="mgr-gw">GW${d.gw}${d.gwLive ? ' · <span class="mgr-livedot">LIVE</span>' : ''}</span>
                </div>

                <div class="mgr-row">
                    <span class="mgr-label">Overall rank</span>
                    <span class="mgr-value">${fmtRank(d.overallRank)} ${renderRankDelta(d.rankDelta)}</span>
                </div>
                <div class="mgr-row">
                    <span class="mgr-label">GW${d.gw} rank</span>
                    <span class="mgr-value">${fmtRank(d.gwRank)}${d.gwPoints != null ? ` <span class="mgr-sub">${d.gwPoints} pts</span>` : ''}</span>
                </div>
                <div class="mgr-row">
                    <span class="mgr-label">Total points</span>
                    <span class="mgr-value">${fmtRank(d.totalPoints)}</span>
                </div>

                <div class="mgr-row mgr-money">
                    <span class="mgr-label">${v2Icon('wallet')}Squad · Bank</span>
                    <span class="mgr-value">£${d.squadValue.toFixed(1)}m <span class="mgr-sep">·</span> £${d.bank.toFixed(1)}m</span>
                </div>

                <div class="mgr-row">
                    <span class="mgr-label">${v2Icon('ticket')} Free transfers${d.freeTransfersExact ? '' : '<span class="mgr-est" title="Estimated: FPL does not publish your free-transfer count, so it is replayed from your transfer history.">est</span>'}</span>
                    <span class="mgr-value">${d.freeTransfers}<span class="mgr-sub">${escHTML(ftNote)}</span></span>
                </div>

                <div class="mgr-chips">
                    <!-- The count rides on the heading rather than sitting on a
                         line of its own underneath: "4 of 4 still available" was
                         a whole row to say a number the chips beside it already
                         spell out one by one. -->
                    <div class="mgr-chips-head">${v2Icon('chip')}${activeLabel ? `Active: <strong>${escHTML(activeLabel)}</strong>` : 'No chip active'}${d.chips.length ? ` <span class="mgr-chips-count" title="${chipsAvail.length} of ${d.chips.length} chips still available">(${chipsAvail.length}/${d.chips.length})</span>` : ''}</div>
                    <div class="mgr-chips-list">
                        ${d.chips.length ? d.chips.map(ch => `<span class="mgr-chip ${ch.available ? 'avail' : 'used'} ${d.activeChip === ch.name ? 'active' : ''}"
                            title="${escHTML(ch.label)} — ${d.activeChip === ch.name ? 'active this gameweek' : ch.available ? 'available' : 'already used'}">
                            ${ch.icon} ${escHTML(ch.label)}</span>`).join('')
                        : '<span class="mgr-chip used">None available</span>'}
                    </div>
                </div>

                ${p.total ? `<div class="mgr-progress">
                    <div class="mgr-progress-head">
                        <span>${v2Icon('progress')}${p.played}/${p.total} played</span>
                        <span class="mgr-progress-right">${p.live ? `<span class="mgr-livedot">${p.live} live</span> · ` : ''}${p.toPlay} to play${p.blank ? ` · ${p.blank} blank` : ''}</span>
                    </div>
                    <div class="mgr-progress-bar"><div class="mgr-progress-fill" style="width:${progressPct}%"></div></div>
                </div>` : ''}
            </div>`;
        }


        /* ===== The analysis settings drawer =====

           The button that opens this sits in the Squad Analysis KPI strip —
           see renderSquadOverview() above — and its overlay is markup in
           fpl-my-team-analysis.html with onclick="closeSettings(event)" and
           three onclick="applyPreset(...)" buttons on it. All four were
           declared in transfer-wizard.js, so the default tab could not offer
           its own settings without the wizard in memory. */
        // ===== SETTINGS =====
        function openSettings() {
            // Highlight active preset button
            ['Aggressive','Balanced','Patient'].forEach(name => {
                const btn = document.getElementById('preset' + name);
                btn.classList.toggle('primary', activePreset === name.toLowerCase());
            });
            document.getElementById('settingsOverlay').classList.add('show');
        }

        function closeSettings(event) {
            if (event && event.target !== event.currentTarget) return;
            document.getElementById('settingsOverlay').classList.remove('show');
        }

        function applyPreset(preset) {
            if (preset === 'aggressive') {
                userSettings = { sellSensitivity: 1.3, fixtureWeight: 1.4, formWeight: 1.2, valueWeight: 1.3, minutesThreshold: 70, premiumHarshness: 1.3 };
            } else if (preset === 'balanced') {
                userSettings = { sellSensitivity: 1.0, fixtureWeight: 1.0, formWeight: 1.0, valueWeight: 1.0, minutesThreshold: 60, premiumHarshness: 1.0 };
            } else if (preset === 'patient') {
                userSettings = { sellSensitivity: 0.7, fixtureWeight: 0.6, formWeight: 0.8, valueWeight: 0.8, minutesThreshold: 50, premiumHarshness: 0.7 };
            }

            activePreset = preset;
            localStorage.setItem('fpl_analysis_settings', JSON.stringify(userSettings));
            localStorage.setItem('fpl_active_preset', preset);
            document.querySelectorAll('.strategy-preset-tab').forEach(button => {
                button.classList.toggle('active', button.dataset.strategyPreset === preset);
            });
            closeSettings();

            /* twSquad() is the wizard's view of the squad — the real one with
               any planned moves applied — and the wizard is loaded on demand,
               so ask for it only when it is there. Re-scoring the squad FPL
               says you own is the right answer either way; the plan only
               changes which players are in it. */
            const squad = typeof twSquad === 'function' ? twSquad() : (selectedPlayers || []);
            if (squad.length > 0) {
                analyzeTeam();
            }

            updateStatus(`${preset.charAt(0).toUpperCase() + preset.slice(1)} settings applied`, 'success');
        }

        /* ===== Saved settings, read before anything scores with them =====

           This block was the tail of lineup-wizard.js, which is a problem of
           order as much as of placement: it is the only top-level code in that
           file that has to RUN, and it ran near the end of a twenty-file load
           while the analysis engine above had already been reading
           userSettings for most of it. Here it runs before any of that.

           onTeamIdSubmitted/onTeamIdCleared are the page's answer to the Team
           ID pill in the shared header — common.js calls them when an ID is
           entered or cleared, guarded by typeof, so with them in a deferred
           file entering an ID on this page would silently do nothing at all.
           loadTeamById() is declared above. */
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
