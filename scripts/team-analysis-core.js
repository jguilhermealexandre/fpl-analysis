/* ============================================
   EasyFPL — My Team Analysis
   Configuration, shared state, utilities, team/fixture/season scoring,
   FPL data loading, the per-player analysis engine, and the squad overview
   and manager panel renderers.

   Extracted from the inline <script> in fpl-my-team-analysis.html.
   These files are plain classic scripts loaded in order, not ES modules:
   every function stays a global, which the inline onclick= handlers
   throughout the markup depend on. Load order is preserved from the
   original file — team-analysis-core.js must come first, since the
   settings IIFE in lineup-wizard.js reads DEFAULT_SETTINGS from it.
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
        let currentGW = 1, selectedPlayers = [], managerData = null, picksData = null, analysisResults = [];
        let isPreseason = false; // true until the season's first fixture kicks off — see computeIsPreseason() in scripts/common.js
        let positionAverages = {};
        let teamAnalysis = {}; // Team analysis scores (attack, defence, form, fixture) keyed by team ID
        let fixtureSwingData = {}; // Fixture swing detection per team
        let seasonStats = {}; // Full-season team stats (W/D/L, GF/GA, CS%, home/away splits)

        let allFixtures = [];     // All fixtures from fixtures.json
        let managerHistory = null; // Manager history from /api/entry/{id}/history/
        let gwEvents = [];        // bootstrap events[] — deadlines, is_current/is_next
        let chipDefinitions = []; // bootstrap chips[] — each chip's start_event/stop_event window
        let maxFreeTransfers = 5; // from game_settings.max_extra_free_transfers + 1

        // Shared state for Draft & analysis
        let playersDetailData = null; // Full players-data.json with per-GW history
        let teamXgData = {};          // Team-level xG aggregated from player history
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
            selectedPlayers: [],   // up to 2 player IDs for context panel
            captain: null,         // captain player ID
            viceCaptain: null,     // vice-captain player ID
            originalXIIds: new Set(),    // original starting XI IDs from FPL
            originalCaptain: null,       // original captain ID
            originalVC: null             // original vice-captain ID
        };
        let transferState = {
            pending: [],           // Array of { soldPlayer, replacement } — up to 5 transfer slots
            activeSlot: -1,        // Index into pending[]
            mode: 'squad',         // 'squad' | 'market' | 'compare' | 'summary'
            candidateCache: {},    // cacheKey -> scored candidates
            marketFilter: { pos: 0, priceRange: 'all' },
            previewPlayer: null    // candidate being previewed in comparison
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

        function showLoading(show, text) {
            document.getElementById('loadingOverlay').classList.toggle('show', show);
            if (text) document.getElementById('loadingText').textContent = text;
        }

        // Position-level baselines. The minutes bar has to scale with the season:
        // a flat 200 matches nobody until GW3, which silently collapsed every
        // position onto one hardcoded fallback — so a goalkeeper was regressed
        // toward the same 0.30 xGI/90 baseline as a striker.
        function computePositionAverages() {
            positionAverages = {};
            const minMinutes = Math.min(200, Math.max(currentGW - 1, 1) * 60);
            // Sensible per-position xGI/90 priors for when there's still no sample.
            const FALLBACK_XGI90 = { 1: 0.01, 2: 0.08, 3: 0.28, 4: 0.45 };
            [1, 2, 3, 4].forEach(pos => {
                const posPlayers = allPlayers.filter(p => p.position === pos && p.minutes >= minMinutes);
                if (posPlayers.length === 0) { positionAverages[pos] = { form: 3, ppg: 3, ppm: 15, xGIPer90: FALLBACK_XGI90[pos] }; return; }
                const avg = (arr, fn) => arr.reduce((s, p) => s + fn(p), 0) / arr.length;
                // Median price for this position, which is the reference point the
                // projection's price-quality prior measures a player against.
                const prices = posPlayers.map(p => p.price).sort((a, b) => a - b);
                positionAverages[pos] = {
                    form: avg(posPlayers, p => p.form),
                    ppg: avg(posPlayers, p => p.ppg),
                    ppm: avg(posPlayers, p => p.points / Math.max(p.price, 1)),
                    xGIPer90: avg(posPlayers, p => p.minutes > 0 ? (p.xGI / p.minutes) * 90 : 0),
                    medPrice: prices[Math.floor(prices.length / 2)] || 0
                };
            });
        }

        // ===== TEAM ANALYSIS SCORES (ported from teams-analysis) =====

        // ===== FIXTURE SWING DETECTION (from teams-analysis) =====
        function buildFixtureSwingData(bootTeams, fixturesData) {
            const fixtureMap = {};
            bootTeams.forEach(t => { fixtureMap[t.id] = {}; });
            fixturesData.forEach(f => {
                if (!f.event) return;
                if (fixtureMap[f.team_h]) {
                    if (!fixtureMap[f.team_h][f.event]) fixtureMap[f.team_h][f.event] = [];
                    fixtureMap[f.team_h][f.event].push({ opponentId: f.team_a, fdr: f.team_h_difficulty || 3, isHome: true, finished: f.finished_provisional });
                }
                if (fixtureMap[f.team_a]) {
                    if (!fixtureMap[f.team_a][f.event]) fixtureMap[f.team_a][f.event] = [];
                    fixtureMap[f.team_a][f.event].push({ opponentId: f.team_h, fdr: f.team_a_difficulty || 3, isHome: false, finished: f.finished_provisional });
                }
            });
            fixtureSwingData = {};
            const gw = currentGW || 1;
            bootTeams.forEach(team => {
                const tfm = fixtureMap[team.id];
                if (!tfm) return;
                const futureGWs = Object.keys(tfm).map(Number).filter(g => g >= gw && tfm[g]?.[0] && !tfm[g][0].finished).sort((a, b) => a - b);
                if (futureGWs.length < 6) return;
                const first3 = futureGWs.slice(0, 3), next3 = futureGWs.slice(3, 6);
                const getAvg = (gws) => gws.reduce((s, g) => { const fx = tfm[g]; return s + (fx?.[0] ? fx[0].fdr : 3); }, 0) / gws.length;
                const avgFirst = getAvg(first3), avgNext = getAvg(next3);
                const swing = avgFirst - avgNext;
                if (Math.abs(swing) > 0.3) {
                    fixtureSwingData[team.id] = { swing, direction: swing > 0 ? 'improving' : 'worsening', currentFdr: avgFirst.toFixed(1), futureFdr: avgNext.toFixed(1), swingGW: futureGWs[3] };
                }
            });
            console.log('Fixture swings:', Object.keys(fixtureSwingData).length, 'teams');
        }

        // ===== SEASON STATS (from teams-analysis, without xG) =====
        function calculateBasicSeasonStats(bootTeams, fixturesData) {
            const stats = {};
            const finishedFixtures = fixturesData.filter(f => f.finished_provisional && f.team_h_score !== null).sort((a, b) => a.event - b.event);
            bootTeams.forEach(t => {
                stats[t.id] = {
                    played: 0, wins: 0, draws: 0, losses: 0, points: 0,
                    goalsFor: 0, goalsAgainst: 0, goalDiff: 0,
                    cleanSheets: 0, failedToScore: 0,
                    homeP: 0, homeW: 0, homeGF: 0, homeGA: 0, homeCS: 0,
                    awayP: 0, awayW: 0, awayGF: 0, awayGA: 0, awayCS: 0,
                    last5Form: []
                };
            });
            const teamHistory = {};
            bootTeams.forEach(t => { teamHistory[t.id] = []; });
            finishedFixtures.forEach(f => {
                [[f.team_h, true], [f.team_a, false]].forEach(([tid, isHome]) => {
                    if (!stats[tid]) return;
                    const gf = isHome ? (f.team_h_score || 0) : (f.team_a_score || 0);
                    const ga = isHome ? (f.team_a_score || 0) : (f.team_h_score || 0);
                    const result = gf > ga ? 'W' : gf === ga ? 'D' : 'L';
                    stats[tid].played++;
                    stats[tid].goalsFor += gf; stats[tid].goalsAgainst += ga;
                    if (result === 'W') stats[tid].wins++;
                    else if (result === 'D') stats[tid].draws++;
                    else stats[tid].losses++;
                    if (ga === 0) stats[tid].cleanSheets++;
                    if (gf === 0) stats[tid].failedToScore++;
                    if (isHome) {
                        stats[tid].homeP++; if (result === 'W') stats[tid].homeW++;
                        stats[tid].homeGF += gf; stats[tid].homeGA += ga;
                        if (ga === 0) stats[tid].homeCS++;
                    } else {
                        stats[tid].awayP++; if (result === 'W') stats[tid].awayW++;
                        stats[tid].awayGF += gf; stats[tid].awayGA += ga;
                        if (ga === 0) stats[tid].awayCS++;
                    }
                    teamHistory[tid].push(result);
                });
            });
            bootTeams.forEach(t => {
                const s = stats[t.id];
                s.last5Form = teamHistory[t.id].slice(-5);
                const p = s.played || 1;
                s.points = s.wins * 3 + s.draws;
                s.goalDiff = s.goalsFor - s.goalsAgainst;
                s.csPercent = Math.round((s.cleanSheets / p) * 100);
                s.ftsPercent = Math.round((s.failedToScore / p) * 100);
                s.gpg = (s.goalsFor / p).toFixed(2);
                s.gapg = (s.goalsAgainst / p).toFixed(2);
            });
            return stats;
        }

        function computeTeamScores(bootTeams, fixturesData) {
            teamAnalysis = {};

            // finished_provisional flips as soon as full time is blown — f.finished stays
            // false until FPL confirms bonus points, which can take a day or more, so a
            // team's very first result of the season wouldn't count here at all otherwise
            // (form/attack/defense would fall back to a neutral baseline for every team,
            // making every player look like their team is "struggling").
            const finishedFixtures = fixturesData
                .filter(f => f.finished_provisional && f.team_h_score !== null)
                .sort((a, b) => a.event - b.event);

            const upcomingFixtures = fixturesData
                .filter(f => !f.finished_provisional && f.event !== null)
                .sort((a, b) => a.event - b.event);

            bootTeams.forEach(team => {
                const teamId = team.id;

                // Past fixtures for this team
                const pastFixtures = finishedFixtures
                    .filter(f => f.team_h === teamId || f.team_a === teamId);
                const last10 = pastFixtures.slice(-10);
                const last5 = pastFixtures.slice(-5);

                // Future fixtures (next 5)
                const futureFixtures = upcomingFixtures
                    .filter(f => f.team_h === teamId || f.team_a === teamId)
                    .slice(0, 5);

                // Compute goals scored/conceded from last 10 games
                let totalScored = 0, totalConceded = 0;
                let homeStats = { goals: 0, conceded: 0, games: 0, cleanSheets: 0 };
                let awayStats = { goals: 0, conceded: 0, games: 0, cleanSheets: 0 };

                last10.forEach(f => {
                    const isHome = f.team_h === teamId;
                    const scored = isHome ? (f.team_h_score || 0) : (f.team_a_score || 0);
                    const conceded = isHome ? (f.team_a_score || 0) : (f.team_h_score || 0);
                    totalScored += scored;
                    totalConceded += conceded;
                    if (isHome) {
                        homeStats.goals += scored; homeStats.conceded += conceded;
                        homeStats.games++; if (conceded === 0) homeStats.cleanSheets++;
                    } else {
                        awayStats.goals += scored; awayStats.conceded += conceded;
                        awayStats.games++; if (conceded === 0) awayStats.cleanSheets++;
                    }
                });

                const gamesPlayed = last10.length || 1;
                const avgGoals = totalScored / gamesPlayed;
                const avgConceded = totalConceded / gamesPlayed;

                // Attack Power (0-100): blend actual goals with FPL strength
                const fplAttackStrength = (team.strength_attack_home + team.strength_attack_away) / 2;
                const fplAttNorm = Math.min(1, Math.max(0, (fplAttackStrength - 900) / 500));
                const goalRate = Math.min(1, avgGoals / 2.0);
                const attackPower = Math.round(Math.min(100, Math.max(0, (goalRate * 0.55 + fplAttNorm * 0.45) * 100)));

                // Defense Power (0-100) - inverted
                const fplDefenseStrength = (team.strength_defence_home + team.strength_defence_away) / 2;
                const fplDefNorm = Math.min(1, Math.max(0, (fplDefenseStrength - 900) / 500));
                const concedeRate = Math.min(1, Math.max(0, 1 - (avgConceded / 2.0)));
                const defensePower = Math.round(Math.min(100, Math.max(0, (concedeRate * 0.55 + fplDefNorm * 0.45) * 100)));

                // Home/Away splits
                const fplAttHomeNorm = Math.min(1, Math.max(0, (team.strength_attack_home - 900) / 500));
                const fplAttAwayNorm = Math.min(1, Math.max(0, (team.strength_attack_away - 900) / 500));
                const fplDefHomeNorm = Math.min(1, Math.max(0, (team.strength_defence_home - 900) / 500));
                const fplDefAwayNorm = Math.min(1, Math.max(0, (team.strength_defence_away - 900) / 500));

                const attackPowerHome = homeStats.games > 0 ? Math.round(Math.min(100, Math.max(0,
                    (Math.min(1, homeStats.goals / homeStats.games / 2.0) * 0.55 + fplAttHomeNorm * 0.45) * 100))) : attackPower;
                const attackPowerAway = awayStats.games > 0 ? Math.round(Math.min(100, Math.max(0,
                    (Math.min(1, awayStats.goals / awayStats.games / 2.0) * 0.55 + fplAttAwayNorm * 0.45) * 100))) : attackPower;
                const defensePowerHome = homeStats.games > 0 ? Math.round(Math.min(100, Math.max(0,
                    (Math.min(1, Math.max(0, 1 - (homeStats.conceded / homeStats.games / 2.0))) * 0.55 + fplDefHomeNorm * 0.45) * 100))) : defensePower;
                const defensePowerAway = awayStats.games > 0 ? Math.round(Math.min(100, Math.max(0,
                    (Math.min(1, Math.max(0, 1 - (awayStats.conceded / awayStats.games / 2.0))) * 0.55 + fplDefAwayNorm * 0.45) * 100))) : defensePower;

                // Form Rating (0-100) - recency-weighted W/D/L from last 5
                const formWeights = [5, 4, 3, 2, 1];
                const reversedResults = [...last5].reverse();
                let weightedPts = 0, weightSum = 0;
                let wins = 0, draws = 0, losses = 0;
                reversedResults.forEach((f, i) => {
                    const isHome = f.team_h === teamId;
                    const scored = isHome ? (f.team_h_score || 0) : (f.team_a_score || 0);
                    const conceded = isHome ? (f.team_a_score || 0) : (f.team_h_score || 0);
                    const result = scored > conceded ? 'W' : scored === conceded ? 'D' : 'L';
                    const pts = result === 'W' ? 3 : result === 'D' ? 1 : 0;
                    weightedPts += pts * formWeights[i];
                    weightSum += formWeights[i];
                    if (result === 'W') wins++; else if (result === 'D') draws++; else losses++;
                });
                // Map weighted points-per-game onto the 0-100 rating so that a team
                // drawing its games lands mid-scale. The old formula scaled the
                // win-ratio straight onto 0-70, which put an all-draws record at 23 —
                // under the 40 "struggling" cut-off — so a single 2-2 draw in GW1 had
                // every player on that team badged as struggling.
                // Anchors: 0.0 ppg -> 10, 1.0 ppg (all draws) -> 50, 3.0 ppg -> 90.
                const weightedPpg = weightSum > 0 ? weightedPts / weightSum : 1;
                const formBase = weightedPpg <= 1
                    ? 10 + weightedPpg * 40
                    : 50 + ((weightedPpg - 1) / 2) * 40;

                // GD bonus from last 5
                const recentGD = last5.reduce((sum, f) => {
                    const isHome = f.team_h === teamId;
                    return sum + (isHome ? (f.team_h_score || 0) : (f.team_a_score || 0))
                                - (isHome ? (f.team_a_score || 0) : (f.team_h_score || 0));
                }, 0);
                const gdBonus = Math.min(10, Math.max(-10, recentGD * 2));

                // Streak bonus
                let streakBonus = 0;
                for (let i = 0; i < reversedResults.length; i++) {
                    const f = reversedResults[i];
                    const isHome = f.team_h === teamId;
                    const scored = isHome ? (f.team_h_score || 0) : (f.team_a_score || 0);
                    const conceded = isHome ? (f.team_a_score || 0) : (f.team_h_score || 0);
                    if (scored > conceded) streakBonus += 3;
                    else if (scored === conceded) streakBonus += 1;
                    else break;
                }
                streakBonus = Math.min(15, streakBonus);

                const formRating = Math.round(Math.min(100, Math.max(0, formBase + gdBonus + streakBonus)));

                // Fixture Score (0-100)
                let totalFdr = 0;
                const futureDetails = futureFixtures.map(f => {
                    const isHome = f.team_h === teamId;
                    const fdr = isHome ? f.team_h_difficulty : f.team_a_difficulty;
                    totalFdr += fdr || 3;
                    return { fdr: fdr || 3, isHome };
                });
                const avgFdr = futureDetails.length > 0 ? totalFdr / futureDetails.length : 3;
                const homeFixCount = futureDetails.filter(f => f.isHome).length;
                const fixtureScore = Math.round(Math.min(100, Math.max(0,
                    ((5 - avgFdr) / 4) * 85 + (homeFixCount / Math.max(1, futureDetails.length)) * 15)));

                // Clean Sheet Rate
                const totalCS = homeStats.cleanSheets + awayStats.cleanSheets;
                const csRate = gamesPlayed > 0 ? totalCS / gamesPlayed : 0;

                // xG trend data (ported from fpl-players-analysis.html's computeTeamScores,
                // so the shared AI Scouting Report's Team Context section has real data here too)
                const seasonXg = getTeamSeasonXg(teamId);
                const recent6Xg = getTeamXgWindow(teamId, 6);
                let xgTrend = 'stable', xgcTrend = 'stable';
                if (recent6Xg && seasonXg && (seasonXg.games || 0) >= 10) {
                    const xgDelta = recent6Xg.xGpg - seasonXg.xGpg;
                    if (xgDelta > 0.25) xgTrend = 'rising';
                    else if (xgDelta < -0.25) xgTrend = 'falling';
                    const xgcDelta = recent6Xg.xGCpg - seasonXg.xGCpg;
                    if (xgcDelta < -0.20) xgcTrend = 'improving';
                    else if (xgcDelta > 0.20) xgcTrend = 'worsening';
                }

                teamAnalysis[teamId] = {
                    attackPower, defensePower, formRating, fixtureScore,
                    attackPowerHome, attackPowerAway, defensePowerHome, defensePowerAway,
                    xgTrend, xgcTrend, xgTrendDelta: recent6Xg && seasonXg ? recent6Xg.xGpg - seasonXg.xGpg : 0,
                    xgcTrendDelta: recent6Xg && seasonXg ? seasonXg.xGCpg - recent6Xg.xGCpg : 0,
                    avgGoals, avgConceded, avgFdr, csRate, totalCS,
                    // Needed to tell a genuine home/away split from the fallback:
                    // *PowerHome/Away silently reuse the overall rating at 0 games.
                    homeGames: homeStats.games, awayGames: awayStats.games,
                    wins, draws, losses, gamesPlayed,
                    // Real count of completed matches. `gamesPlayed` above is
                    // `last10.length || 1`, so it reports 1 even for a team that
                    // hasn't kicked a ball — no good for "do we have data yet?".
                    matchesPlayed: pastFixtures.length,
                    teamName: team.short_name || team.name
                };
            });
            console.log('Team analysis computed for', Object.keys(teamAnalysis).length, 'teams');
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
                const [bootData, fixturesData, playersDataRes] = await Promise.all([
                    DataCache.fetchJSON(DATA_URLS.bootstrap),
                    DataCache.fetchJSON(DATA_URLS.fixtures).catch(() => []),
                    DataCache.fetchJSON(DATA_URLS.players).catch(() => null)
                ]);

                teams = {};
                bootData.teams.forEach(t => { teams[t.id] = t; });
                const currEvent = bootData.events.find(e => e.is_current);
                currentGW = currEvent ? currEvent.id : 1;
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

                // Build players with ALL available data
                allPlayers = bootData.elements.map(p => ({
                    id: p.id, code: p.code, name: p.web_name, fullName: `${p.first_name} ${p.second_name}`,
                    squadNumber: p.squad_number,
                    team: teams[p.team]?.short_name || 'N/A', teamId: p.team,
                    position: p.element_type, price: p.now_cost / 10,
                    form: parseFloat(p.form) || 0, points: p.total_points,
                    ppg: parseFloat(p.points_per_game) || 0,
                    ownership: parseFloat(p.selected_by_percent) || 0,
                    status: p.status, news: p.news, newsAdded: p.news_added || null,
                    chanceNextRound: p.chance_of_playing_next_round,
                    minutes: p.minutes, starts: p.starts || 0,
                    goals: p.goals_scored, assists: p.assists,
                    cleanSheets: p.clean_sheets, goalsConceded: p.goals_conceded || 0,
                    xG: parseFloat(p.expected_goals) || 0, xA: parseFloat(p.expected_assists) || 0,
                    xGI: parseFloat(p.expected_goal_involvements) || 0,
                    xGC: parseFloat(p.expected_goals_conceded) || 0,
                    ictIndex: parseFloat(p.ict_index) || 0,
                    influence: parseFloat(p.influence) || 0,
                    creativity: parseFloat(p.creativity) || 0,
                    threat: parseFloat(p.threat) || 0,
                    bonus: p.bonus, bps: p.bps,
                    yellowCards: p.yellow_cards, redCards: p.red_cards,
                    saves: p.saves || 0,
                    // Defensive contribution — the 25/26 scoring route. Tackles,
                    // clearances/blocks/interceptions and recoveries, totalled by
                    // FPL, worth 2 points once a per-match threshold is cleared.
                    defCon: p.defensive_contribution || 0,
                    defCon90: parseFloat(p.defensive_contribution_per_90) || 0,
                    // Set-piece duty as published, rather than inferred from a
                    // goals-minus-xG gap. 1 = first choice.
                    penaltiesOrder: p.penalties_order || null,
                    cornersOrder: p.corners_and_indirect_freekicks_order || null,
                    freekicksOrder: p.direct_freekicks_order || null,
                    transfersIn: p.transfers_in_event || 0,
                    transfersOut: p.transfers_out_event || 0,
                    transfersInTotal: p.transfers_in || 0,
                    transfersOutTotal: p.transfers_out || 0,
                    costChangeEvent: p.cost_change_event || 0,
                    costChangeStart: p.cost_change_start || 0,
                    epNext: parseFloat(p.ep_next) || 0,
                    dreamteamCount: p.dreamteam_count || 0,
                    valueForm: parseFloat(p.value_form) || 0,
                    valueSeason: parseFloat(p.value_season) || 0,
                    fixtures: teamFixtures[p.team] || []
                }));

                totalFplPlayers = bootData.total_players || 11000000;

                allPlayersById = {};
                allPlayers.forEach(p => allPlayersById[p.id] = p);
                computePositionAverages();

                // Build team xG data before computeTeamScores() — it now reads teamXgData
                // (via getTeamXgWindow/getTeamSeasonXg) to compute xgTrend/xgcTrend per team.
                buildTeamXgData(bootData.elements);
                console.log('[xG] Team xG data built for', Object.keys(teamXgData).length, 'teams');

                computeTeamScores(bootData.teams, fixturesData);
                buildFixtureSwingData(bootData.teams, fixturesData);
                seasonStats = calculateBasicSeasonStats(bootData.teams, fixturesData);

                // Fetch manager + picks + history in parallel
                showLoading(true, `Loading team for GW${currentGW}...`);
                const [mgrRes, picksRes, histRes] = await Promise.all([
                    fetchWithProxy(`https://fantasy.premierleague.com/api/entry/${teamId}/`),
                    fetchWithProxy(`https://fantasy.premierleague.com/api/entry/${teamId}/event/${currentGW}/picks/`),
                    fetchWithProxy(`https://fantasy.premierleague.com/api/entry/${teamId}/history/`)
                ]);
                managerData = await mgrRes.json();
                picksData = await picksRes.json();
                managerHistory = await histRes.json();

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

                localStorage.setItem('fpl_team_id', teamId);
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
                transferState = { pending: [], activeSlot: -1, mode: 'squad', candidateCache: {}, marketFilter: { pos: 0, priceRange: 'all' }, previewPlayer: null };
                document.getElementById('tabBar').classList.add('visible');
                if (window._pendingTab) {
                    const pending = window._pendingTab;
                    switchTab(pending); window._pendingTab = null;
                    // A move handed over from the dashboard loads into the cart
                    // once the squad is real; the wizard renders it from there.
                    try {
                        if (pending === 'transfers' && typeof twApplyDeepLink === 'function') twApplyDeepLink();
                        else if (typeof applySquadDeepLink === 'function') applySquadDeepLink();
                    } catch (e) { console.warn('Deep link ignored:', e.message); }
                }
            } catch (error) {
                console.error('Error loading team:', error);
                const friendly = error.message === 'HTTP 404'
                    ? "We couldn't find a team with that ID — check the number and try again, or try a demo team below."
                    : 'Something went wrong loading your team. Please try again.';
                updateStatus(friendly, 'error');
                document.getElementById('tabBar').classList.remove('visible');
                document.getElementById('landingPage').style.display = '';
            } finally {
                showLoading(false);
            }
        }

        function processFixtures(fixturesData) {
            teamFixtures = {};
            
            const upcoming = fixturesData
                .filter(f => !f.finished_provisional && f.event !== null)
                .sort((a, b) => a.event - b.event);

            Object.keys(teams).forEach(teamId => {
                const tid = parseInt(teamId);
                const teamFix = upcoming
                    .filter(f => f.team_h === tid || f.team_a === tid)
                    .slice(0, 5);

                teamFixtures[tid] = teamFix.map(f => {
                    const isHome = f.team_h === tid;
                    return {
                        opponent: isHome ? teams[f.team_a]?.short_name : teams[f.team_h]?.short_name,
                        opponentId: isHome ? f.team_a : f.team_h,
                        difficulty: isHome ? f.team_h_difficulty : f.team_a_difficulty,
                        isHome: isHome,
                        event: f.event
                    };
                });
            });
        }

        // ===== ENHANCED ANALYSIS ENGINE =====
        function analyzeTeam() {
            if (selectedPlayers.length === 0) { updateStatus('No players loaded', 'error'); return; }
            analysisResults = selectedPlayers.map(player => analyzePlayer(player));
            analysisResults.sort((a, b) => b.sellRating - a.sellRating);
            renderTeamAnalysis();
            updateStatus(`Analysis complete — GW${currentGW}`, 'success');
        }

        /* Form, read honestly on a season that has barely started.

           FPL's `form` is average points over the last 30 days, so one gameweek
           in, it IS that one gameweek. Judged raw, 53% of every player who got
           on the pitch counted as "poor form" — which is not a form reading, it
           is "did not score three points once". A defender who played the full
           ninety and conceded a goal has a form of 2.0 and was charged for it,
           which is how a squad whose players had one quiet Saturday landed on a
           health score in the twenties.

           So regress it, the way every rate in the projection is regressed:
           toward what we already expect of this player, until there is a real
           sample behind it. The prior is his own points per game last season
           where that exists, and the position median where it does not. At four
           games the evidence weight reaches 1 and this returns raw form, so the
           thresholds downstream keep exactly the meaning they always had — they
           simply stop firing before anything has been demonstrated. */
        const FORM_EVIDENCE_GAMES = 4;

        let _lastSeasonById = null;
        function lastSeasonFor(playerId) {
            if (!_lastSeasonById) {
                const rows = playersDetailData && playersDetailData.players;
                // Not loaded yet: answer null WITHOUT caching, or the empty
                // answer sticks for the life of the page and the prior silently
                // reverts to the position median for everyone.
                if (!rows || !rows.length) return null;
                _lastSeasonById = {};
                rows.forEach(r => { if (r.lastSeason) _lastSeasonById[r.id] = r.lastSeason; });
            }
            return _lastSeasonById[playerId] || null;
        }

        function lastSeasonPointsPerGame(player) {
            const ls = lastSeasonFor(player.id);
            if (!ls || !ls.totalPoints) return null;
            const games = ls.starts || (ls.minutes ? ls.minutes / 90 : 0);
            // A handful of cameos is not a prior worth leaning on.
            if (games < 10) return null;
            return ls.totalPoints / games;
        }

        function regressedForm(player, posConfig, gamesPlayed) {
            const raw = isPreseason ? (player.ppg || 0) : (parseFloat(player.form) || 0);
            const prior = lastSeasonPointsPerGame(player);
            const base = prior != null ? prior : posConfig.formMedian;
            const evidence = Math.min(1, Math.max(0, gamesPlayed) / FORM_EVIDENCE_GAMES);
            return raw * evidence + base * (1 - evidence);
        }

        function analyzePlayer(player) {
            // Baseline: average player starts at 40 — dimensions push up (sell) or down (keep)
            let sellRating = 40;
            let reasons = [], concerns = [], positives = [];
            const posAvg = positionAverages[player.position] || { form: 3, ppg: 3, ppm: 15, xGIPer90: 0.3 };
            const posConfig = POSITION_CONFIG[player.position];
            // Preseason: currentGW-1 is 0 and player.form is already reset to 0.0 by FPL —
            // used as-is that's not "no data", it's a uniform false "poor form" flag on every
            // player plus an absurd minutes-per-game (last season's full total / 1). Fall back
            // to last season's real points-per-game and a starts-based games-played estimate.
            const gamesPlayed = isPreseason ? Math.max(player.starts || Math.round(player.minutes / 90), 1) : Math.max(currentGW - 1, 1);
            const minsPerGame = player.minutes / gamesPlayed;
            const effectiveForm = regressedForm(player, posConfig, gamesPlayed);
            // The raw figure is still what the card prints — it is a fact about
            // the matches played. It just no longer drives the judgement.
            const rawForm = isPreseason ? (player.ppg || 0) : (parseFloat(player.form) || 0);
            const isPremium = player.price >= 10.0;
            const isMidPremium = player.price >= 7.5;
            const isBudget = player.price <= 5.5;
            const ta = teamAnalysis[player.teamId]; // Team analysis data

            // Asymmetric sensitivity: penalties amplified in aggressive mode, bonuses dampened (and vice-versa for patient)
            const sensAdj = (raw, ...weights) => {
                const w = weights.reduce((a, b) => a * b, 1);
                const s = raw >= 0 ? userSettings.sellSensitivity : (2 - userSettings.sellSensitivity);
                return raw * s * w;
            };

            // 1. AVAILABILITY (Critical — overrides baseline)
            // Tracked separately as well as added, because the squad health score
            // applies its own availability and form penalties and would otherwise
            // charge for both twice over.
            let availPenalty = 0, formPenaltyApplied = 0;
            if (player.status === 'i' || player.status === 'u' || player.status === 's') {
                availPenalty = sensAdj(40);
                sellRating += availPenalty;
                const statusText = player.status === 'i' ? 'Injured' : player.status === 'u' ? 'Unavailable' : 'Suspended';
                concerns.push({ type: 'critical', title: statusText, text: player.news || 'Check team news for updates' });
                reasons.push(`${statusText} — cannot play`);
            } else if (player.status === 'd') {
                const chance = player.chanceNextRound;
                const penalty = chance !== null ? Math.round((100 - chance) * 0.4) : 22;
                availPenalty = sensAdj(penalty);
                sellRating += availPenalty;
                concerns.push({ type: 'warning', title: 'Doubtful', text: `${chance !== null ? chance + '% chance' : '75% chance'} of playing. ${player.news || ''}` });
                if (penalty >= 18) reasons.push('Significant injury doubt');
            }

            // 2. FORM (Continuous — position-adjusted, asymmetric sensitivity)
            const formDelta = effectiveForm - posConfig.formMedian;
            // Linear: each 1.0 of formDelta = ~10 points; capped at ±30
            const rawFormPenalty = Math.max(-30, Math.min(30, Math.round(-formDelta * 10)));
            const formPenalty = sensAdj(rawFormPenalty, userSettings.formWeight);
            sellRating += formPenalty;
            formPenaltyApplied = formPenalty;

            if (formDelta <= -1.5) {
                concerns.push({ type: 'critical', title: 'Poor Form', text: `Form ${rawForm.toFixed(1)} is well below ${posConfig.short} average of ${posConfig.formMedian} — consider selling before price drops` });
                reasons.push('Form collapsed');
            } else if (formDelta <= -0.5) {
                concerns.push({ type: 'warning', title: 'Below Average Form', text: `Form ${rawForm.toFixed(1)} vs ${posConfig.short} median ${posConfig.formMedian} — monitor next 2 GWs` });
            } else if (formDelta >= 2.5) {
                positives.push({ type: 'positive', title: 'Elite Form', text: `Form ${rawForm.toFixed(1)} — top 5% of ${posConfig.short}s. Strong captain option` });
            } else if (formDelta >= 1.0) {
                positives.push({ type: 'positive', title: 'Good Form', text: `Form ${rawForm.toFixed(1)} — above ${posConfig.short} average, keep starting` });
            }

            // 3. FIXTURES (Continuous — near fixtures weighted more)
            const fixtures = player.fixtures || [];
            let avgFDR = 3;
            if (fixtures.length >= 3) {
                const weights = [3, 2.5, 2, 1.5, 1];
                let totalWeight = 0, weightedSum = 0;
                fixtures.slice(0, 5).forEach((f, i) => {
                    const w = weights[i] || 1;
                    weightedSum += f.difficulty * w;
                    totalWeight += w;
                });
                avgFDR = weightedSum / totalWeight;
            }
            // Linear: FDR 3 is neutral, each 1.0 away = ~14 points
            const rawFixPenalty = Math.max(-22, Math.min(22, Math.round((avgFDR - 3.0) * 14)));
            sellRating += sensAdj(rawFixPenalty, userSettings.fixtureWeight);

            if (avgFDR >= 3.8) {
                concerns.push({ type: 'warning', title: 'Tough Fixtures', text: `Weighted FDR ${avgFDR.toFixed(1)} — difficult run ahead` });
                reasons.push('Brutal fixture run');
            } else if (avgFDR <= 2.5) {
                positives.push({ type: 'positive', title: 'Great Fixtures', text: `Weighted FDR ${avgFDR.toFixed(1)} — fantastic fixture swing` });
            } else if (avgFDR <= 3.0) {
                positives.push({ type: 'positive', title: 'Decent Fixtures', text: `Weighted FDR ${avgFDR.toFixed(1)}` });
            }
            player.avgFDR = avgFDR;

            // 3b. OPPONENT QUALITY (uses team analysis attack/defence power)
            let opponentAdjustment = 0;
            if (fixtures.length >= 3 && Object.keys(teamAnalysis).length > 0) {
                const oppWeights = [3, 2.5, 2, 1.5, 1];
                let oppWeightedScore = 0, oppTotalWeight = 0;
                fixtures.slice(0, 5).forEach((f, i) => {
                    const oppTA = teamAnalysis[f.opponentId];
                    if (!oppTA) return;
                    const w = oppWeights[i] || 1;
                    if (player.position <= 2) {
                        // Defenders: opponent attack power matters (strong attack = harder to keep CS)
                        oppWeightedScore += ((oppTA.attackPower - 50) / 50) * w;
                    } else {
                        // Attackers: opponent defence power matters (strong defence = harder to score)
                        oppWeightedScore += ((oppTA.defensePower - 50) / 50) * w;
                    }
                    oppTotalWeight += w;
                });
                if (oppTotalWeight > 0) {
                    opponentAdjustment = Math.round(Math.max(-10, Math.min(12, (oppWeightedScore / oppTotalWeight) * 8)));
                    sellRating += sensAdj(opponentAdjustment, userSettings.fixtureWeight);

                    if (opponentAdjustment >= 5) {
                        const label = player.position <= 2 ? 'Strong Attacking Opponents' : 'Strong Defensive Opponents';
                        concerns.push({ type: 'warning', title: label, text: `Upcoming opponents have high ${player.position <= 2 ? 'attack' : 'defence'} power — harder to return points` });
                    } else if (opponentAdjustment <= -5) {
                        const label = player.position <= 2 ? 'Weak Attacking Opponents' : 'Weak Defensive Opponents';
                        positives.push({ type: 'positive', title: label, text: `Upcoming opponents are ${player.position <= 2 ? 'weak in attack' : 'leaky at the back'} — favourable matchups` });
                    }
                }
            }

            // 4. MINUTES & ROTATION (Continuous, more aggressive)
            let minsPenalty = 0;
            if (minsPerGame < 20) { minsPenalty = 35; }
            else if (minsPerGame < 60) { minsPenalty = Math.round(32 - (minsPerGame - 20) * (32 / 40)); }
            else if (minsPerGame < 75) { minsPenalty = Math.round(5 - (minsPerGame - 60) * (7 / 15)); }
            else if (minsPerGame >= 85) { minsPenalty = -6; }
            else { minsPenalty = -2; }
            sellRating += sensAdj(minsPenalty);
            player.minsPerGame = minsPerGame;

            if (minsPerGame < 45) {
                concerns.push({ type: 'critical', title: 'Rotation Risk', text: `Only ${minsPerGame.toFixed(0)} mins/game (${player.starts} starts in ${gamesPlayed} GWs) — consider benching or selling` });
                reasons.push('Not starting regularly');
            } else if (minsPerGame < 65) {
                concerns.push({ type: 'warning', title: 'Reduced Minutes', text: `${minsPerGame.toFixed(0)} mins/game — rotation risk, bench for tough fixtures` });
            } else if (minsPerGame >= 85) {
                positives.push({ type: 'positive', title: 'Nailed On', text: `${minsPerGame.toFixed(0)} mins/game — guaranteed starter, no rotation worry` });
            }

            // 5. VALUE FOR MONEY (Continuous — more aggressive, especially for premiums)
            const ppm = player.points / Math.max(player.price, 1);
            const ppmDelta = ppm - posAvg.ppm;
            const ppgDelta = player.ppg - posAvg.ppg;
            player.ppm = ppm;

            // Blend PPM and PPG deltas for a richer value signal
            const valueSignal = (ppmDelta * 0.6) + (ppgDelta * 2.5);
            let rawValuePenalty = Math.max(-15, Math.min(22, Math.round(-valueSignal)));
            if (isPremium) rawValuePenalty = Math.round(rawValuePenalty * userSettings.premiumHarshness * 1.5);
            else if (isMidPremium) rawValuePenalty = Math.round(rawValuePenalty * userSettings.premiumHarshness * 1.2);
            sellRating += sensAdj(rawValuePenalty, userSettings.valueWeight);

            if (isPremium && effectiveForm < posConfig.formMedian) {
                sellRating += sensAdj(5); // Extra premium penalty
                concerns.push({ type: 'critical', title: 'Premium Underperforming', text: `£${player.price.toFixed(1)}m price tag not justified (${ppm.toFixed(1)} pts/£m vs avg ${posAvg.ppm.toFixed(1)}) — sell to free up funds for better options` });
                if (!reasons.length) reasons.push('Premium not delivering');
            } else if (isMidPremium && effectiveForm < posConfig.formMedian - 0.5) {
                concerns.push({ type: 'warning', title: 'Mid-Premium Underperforming', text: `£${player.price.toFixed(1)}m with poor form — downgrade to fund upgrades elsewhere` });
            } else if (ppmDelta > 3) {
                positives.push({ type: 'positive', title: 'Great Value', text: `${ppm.toFixed(1)} pts/£m — well above ${posConfig.short} average (${posAvg.ppm.toFixed(1)})` });
            }

            // 6. xG ANALYSIS (Continuous, wider penalty range)
            if (player.position >= 3 && player.minutes >= 270) {
                const xGIPer90 = (player.xGI / player.minutes) * 90;
                const actualGI = player.goals + player.assists;
                const overperformance = actualGI - player.xGI;
                player.xGIPer90 = xGIPer90;

                // Continuous: xGI/90 below 0.30 is a concern, above 0.50 is great
                const xGPenalty = Math.max(-15, Math.min(18, Math.round((0.35 - xGIPer90) * 35)));
                sellRating += sensAdj(xGPenalty);

                if (xGIPer90 < 0.20) {
                    concerns.push({ type: 'warning', title: 'Low Underlying Stats', text: `${xGIPer90.toFixed(2)} xGI/90 — not creating enough chances` });
                } else if (xGIPer90 < 0.30) {
                    concerns.push({ type: 'info', title: 'Below Average xGI', text: `${xGIPer90.toFixed(2)} xGI/90 — mediocre output` });
                } else if (xGIPer90 >= 0.60) {
                    positives.push({ type: 'positive', title: 'Strong xGI', text: `${xGIPer90.toFixed(2)} xGI/90 — high-quality chances` });
                }

                if (overperformance > 2.0) {
                    sellRating += sensAdj(Math.round(Math.min(12, overperformance * 2.5)));
                    concerns.push({ type: 'warning', title: 'Overperforming xG', text: `${actualGI} G+A vs ${player.xGI.toFixed(1)} xGI — regression risk, consider selling high (+${overperformance.toFixed(1)})` });
                } else if (overperformance < -2.5) {
                    sellRating += sensAdj(-Math.round(Math.min(8, Math.abs(overperformance) * 1.5)));
                    positives.push({ type: 'positive', title: 'Due Returns', text: `${actualGI} G+A vs ${player.xGI.toFixed(1)} xGI — unlucky, due a haul — hold and be patient (${overperformance.toFixed(1)})` });
                }
            } else if (player.position <= 2 && player.minutes >= 270) {
                const csRate = player.cleanSheets / gamesPlayed;
                player.csRate = csRate;
                // Continuous: CS rate below 20% adds penalty, above 35% gives bonus (wider range)
                const csPenalty = Math.max(-10, Math.min(14, Math.round((0.28 - csRate) * 35)));
                sellRating += sensAdj(csPenalty);

                if (csRate >= 0.40) {
                    positives.push({ type: 'positive', title: 'CS Machine', text: `${(csRate * 100).toFixed(0)}% clean sheet rate` });
                } else if (csRate <= 0.18 && !isBudget) {
                    concerns.push({ type: 'warning', title: 'Few Clean Sheets', text: `Only ${(csRate * 100).toFixed(0)}% CS rate — poor defensive returns` });
                }
                player.xGIPer90 = player.position === 1 ? (player.saves / Math.max(player.minutes / 90, 1)) : ((player.xGI / Math.max(player.minutes, 1)) * 90);
            }

            // 7. OWNERSHIP URGENCY (more sensitive)
            if (player.ownership > 20 && sellRating > 45) {
                sellRating += 5;
                concerns.push({ type: 'info', title: 'High Ownership Risk', text: `${player.ownership.toFixed(1)}% owned — price drop risk if others sell` });
            } else if (player.ownership < 8 && sellRating < 30) {
                positives.push({ type: 'positive', title: 'Differential', text: `Only ${player.ownership.toFixed(1)}% owned — great differential pick` });
                sellRating -= 3;
            }

            // 7b. NET TRANSFERS — heavy selling = price drop risk
            const netTransfers = player.transfersIn - player.transfersOut;
            player.netTransfers = netTransfers;
            if (netTransfers < -20000) {
                sellRating += sensAdj(4);
                concerns.push({ type: 'info', title: 'Mass Selling', text: `${(netTransfers / 1000).toFixed(0)}k net transfers — sell now before price drops further` });
            }

            // 8. TEAM CONTEXT (from team analysis — attack, defence, form scoring)
            if (ta) {
                // Team form: poor team form = harder for all players to return
                const teamFormDelta = (ta.formRating - 50) / 50; // -1 to +1
                const teamFormPenalty = Math.round(teamFormDelta * -8); // bad form → +8, good form → -8
                sellRating += sensAdj(teamFormPenalty);

                if (ta.formRating < 30) {
                    concerns.push({ type: 'warning', title: 'Team in Poor Form', text: `${player.team} form rating ${ta.formRating}/100 — team struggling (W${ta.wins} D${ta.draws} L${ta.losses} last 5)` });
                    if (!reasons.length) reasons.push('Team in poor form');
                } else if (ta.formRating >= 70) {
                    positives.push({ type: 'positive', title: 'Team in Great Form', text: `${player.team} form rating ${ta.formRating}/100 — team on fire (W${ta.wins} D${ta.draws} L${ta.losses} last 5)` });
                }

                // Position-specific: attackers benefit from strong team attack
                if (player.position >= 3) {
                    const attDelta = (ta.attackPower - 50) / 50;
                    const teamAttPenalty = Math.round(attDelta * -8);
                    sellRating += sensAdj(teamAttPenalty);

                    if (ta.attackPower < 35) {
                        concerns.push({ type: 'warning', title: 'Weak Team Attack', text: `${player.team} attack power ${ta.attackPower}/100 — limited goal threat (${ta.avgGoals.toFixed(1)} goals/game)` });
                    } else if (ta.attackPower >= 65) {
                        positives.push({ type: 'positive', title: 'Strong Team Attack', text: `${player.team} attack power ${ta.attackPower}/100 — high goal output (${ta.avgGoals.toFixed(1)} goals/game)` });
                    }
                }

                // Position-specific: defenders benefit from strong team defence
                if (player.position <= 2) {
                    const defDelta = (ta.defensePower - 50) / 50;
                    const teamDefPenalty = Math.round(defDelta * -8);
                    sellRating += sensAdj(teamDefPenalty);

                    if (ta.defensePower < 35) {
                        concerns.push({ type: 'warning', title: 'Weak Team Defence', text: `${player.team} defence power ${ta.defensePower}/100 — hard to keep clean sheets (${ta.avgConceded.toFixed(1)} conceded/game)` });
                    } else if (ta.defensePower >= 65) {
                        positives.push({ type: 'positive', title: 'Strong Team Defence', text: `${player.team} defence power ${ta.defensePower}/100 — clean sheet potential (${ta.csRate > 0 ? (ta.csRate * 100).toFixed(0) + '% CS rate' : ''})` });
                    }
                }

                // Team fixture score impacts all players
                if (ta.fixtureScore < 30) {
                    sellRating += sensAdj(4, userSettings.fixtureWeight);
                    concerns.push({ type: 'info', title: 'Poor Team Fixture Score', text: `${player.team} fixture score ${ta.fixtureScore}/100 — tough schedule ahead` });
                } else if (ta.fixtureScore >= 70) {
                    sellRating += sensAdj(-3, userSettings.fixtureWeight);
                    positives.push({ type: 'positive', title: 'Great Team Fixture Score', text: `${player.team} fixture score ${ta.fixtureScore}/100 — favourable run, hold players` });
                }
            }

            sellRating = Math.max(0, Math.min(100, Math.round(sellRating)));

            // VERDICT (tighter thresholds — more active flagging)
            let verdict, verdictReason, recommendation;
            const nextFix = (player.fixtures || [])[0];
            const nextOpp = nextFix ? nextFix.opponent : '';
            const nextGW = nextFix ? nextFix.event : currentGW + 1;

            if (sellRating >= 55) {
                verdict = 'sell';
                verdictReason = reasons[0] || 'Multiple red flags — prioritize transfer';
                const priceRisk = (player.netTransfers || 0) < -10000 ? ' Price drop risk.' : '';
                recommendation = `Transfer out before GW${nextGW}.${priceRisk} ${concerns.length > 0 ? concerns[0].text : ''}`;
            } else if (sellRating >= 38) {
                verdict = 'monitor';
                verdictReason = reasons[0] || 'Some concerns — monitor closely';
                const fixNote = avgFDR <= 2.8 ? ' Fixtures improve soon — hold for now.' : avgFDR >= 3.5 ? ' Tough fixtures ahead — consider selling.' : '';
                recommendation = `Reassess after GW${nextGW}.${fixNote}`;
            } else if (sellRating <= 20 && effectiveForm >= posConfig.formMedian + 1.5 && minsPerGame >= 75) {
                verdict = 'star';
                verdictReason = positives.length > 0 ? positives[0].text : 'Top performer — team cornerstone';
                recommendation = `Captain candidate GW${nextGW}${nextOpp ? ` vs ${nextOpp}` : ''}. Lock in and don't overthink.`;
            } else {
                verdict = 'hold';
                verdictReason = positives.length > 0 ? positives[0].text : 'Performing as expected';
                recommendation = `Keep starting. Reliable performer${avgFDR <= 3.0 ? ' with decent fixtures ahead' : ''}.`;
            }

            const keyMetric = buildKeyMetrics(player, posConfig, minsPerGame, avgFDR, effectiveForm, rawForm);
            return { player, sellRating, verdict, verdictReason, recommendation, concerns, positives, keyMetric,
                availPenalty, formPenalty: formPenaltyApplied, effectiveForm, rawForm, fixtures: fixtures.slice(0, 5) };
        }

        // `form` is what gets printed; `judged` is what decides the colour. Early
        // in a season those differ: the number is real, the verdict on it is not.
        function buildKeyMetrics(player, posConfig, minsPerGame, avgFDR, judgedForm, shownForm) {
            const form = shownForm != null ? shownForm : (isPreseason ? player.ppg : player.form);
            const judged = judgedForm != null ? judgedForm : form;
            const ta = teamAnalysis[player.teamId];
            if (player.position <= 2) {
                return {
                    primary: { label: 'Form', value: form.toFixed(1), status: judged >= posConfig.formMedian + 1 ? 'good' : judged < posConfig.formMedian - 0.5 ? 'bad' : 'warning' },
                    secondary: { label: 'Def', value: ta ? ta.defensePower.toString() : '-', status: ta ? (ta.defensePower >= 60 ? 'good' : ta.defensePower < 40 ? 'bad' : 'warning') : 'neutral' },
                    tertiary: { label: 'FDR', value: avgFDR.toFixed(1), status: avgFDR <= 2.8 ? 'good' : avgFDR >= 3.5 ? 'bad' : 'warning' },
                    quaternary: { label: 'PPG', value: player.ppg.toFixed(1), status: player.ppg >= 5 ? 'good' : player.ppg < 3 ? 'bad' : 'neutral' }
                };
            } else {
                const xGIPer90 = player.xGIPer90 || (player.minutes > 0 ? (player.xGI / player.minutes) * 90 : 0);
                return {
                    primary: { label: 'Form', value: form.toFixed(1), status: judged >= posConfig.formMedian + 1.5 ? 'good' : judged < posConfig.formMedian - 0.5 ? 'bad' : 'warning' },
                    secondary: { label: 'Att', value: ta ? ta.attackPower.toString() : '-', status: ta ? (ta.attackPower >= 60 ? 'good' : ta.attackPower < 40 ? 'bad' : 'warning') : 'neutral' },
                    tertiary: { label: 'xGI/90', value: xGIPer90.toFixed(2), status: xGIPer90 >= 0.50 ? 'good' : xGIPer90 < 0.25 ? 'bad' : 'warning' },
                    quaternary: { label: 'FDR', value: avgFDR.toFixed(1), status: avgFDR <= 2.8 ? 'good' : avgFDR >= 3.5 ? 'bad' : 'warning' }
                };
            }
        }

        // ===== RENDERING =====
        function renderTeamAnalysis() {
            const sells = analysisResults.filter(a => a.verdict === 'sell');
            const monitors = analysisResults.filter(a => a.verdict === 'monitor');
            const stars = analysisResults.filter(a => a.verdict === 'star');
            const holds = analysisResults.filter(a => a.verdict === 'hold');

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

            const teamHealth = Math.max(0, Math.min(100, Math.round(healthScore)));
            const suggestedMoves = buildSuggestedMoves(starters, injuredStarters, doubtfulStarters, capAnalysis);

            let html = '';
            if (isPreseason) html += renderSeasonNotice('Showing 2025/26 form &amp; stats — verdicts will update once GW1 is played.');
            html += renderSquadTickers();
            html += renderTeamOverview(teamHealth, sells, monitors, holds, stars, healthBreakdown, suggestedMoves);
            html += renderSquadFilterBar();
            html += renderSquadChartWidget();
            html += `<div id="sq-table-wrap">${renderSquadTable()}</div>`;

            if (sqChartInstance) { sqChartInstance.destroy(); sqChartInstance = null; }
            document.getElementById('teamDisplay').innerHTML = html;
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
                    downs.push({ cat: 'avail', w: 100, icon: '🚑', text: `${p.name} out${p.news ? ` — ${String(p.news).split('.')[0]}` : ''}` });
                } else if (p.status === 'd') {
                    downs.push({ cat: 'avail', w: 80 + (benched ? 0 : 10), icon: '🩹', text: `${p.name} doubtful${p.chanceNextRound != null ? ` (${p.chanceNextRound}%)` : ''}` });
                }
                if (!benched && form >= 6) ups.push({ cat: 'form', w: 60 + form, icon: '🔥', text: `${p.name} in form (${form.toFixed(1)})` });
                if (!benched && form > 0 && form < 2.5) downs.push({ cat: 'form', w: 50, icon: '❄️', text: `${p.name} cold (${form.toFixed(1)})` });
                if (a.verdict === 'star') ups.push({ cat: 'star', w: 70, icon: '⭐', text: `${p.name} rated a star pick` });
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
                if (swing.direction === 'improving') ups.push({ cat: 'fixture', w: 55, icon: '📅', text: `${label} fixtures ease from GW${swing.swingGW}` });
                else downs.push({ cat: 'fixture', w: 55, icon: '📅', text: `${label} fixtures harden from GW${swing.swingGW}` });
            });

            // Squad-level facts that decide gameweek moves but belong to no single
            // player: the armband, transfers in hand, chips, who is left to play.
            const mgr = typeof buildManagerPanelData === 'function' ? buildManagerPanelData() : null;
            if (mgr) {
                const cap = analysisResults.find(a => a.player.isCaptain);
                if (cap) {
                    const capXP = predictedGWPoints(cap.player);
                    ups.push({ cat: 'captain', w: 75, icon: '👑', text: `${cap.player.name} captained — ${(capXP * 2).toFixed(1)} pts projected` });
                }

                if (mgr.freeTransfers >= 2) {
                    ups.push({ cat: 'transfers', w: 62, icon: '🎟️', text: `${mgr.freeTransfers} free transfers banked${mgr.freeTransfers >= maxFreeTransfers ? ' — at the cap, use one or lose it' : ''}` });
                } else if (mgr.freeTransfers === 0) {
                    downs.push({ cat: 'transfers', w: 62, icon: '🎟️', text: 'No free transfer — any move costs 4 pts' });
                }
                if (mgr.hitCost > 0) downs.push({ cat: 'transfers', w: 72, icon: '💸', text: `−${mgr.hitCost} pts taken on transfers this gameweek` });

                if (mgr.activeChip) {
                    ups.push({ cat: 'chip', w: 90, icon: '🃏', text: `${CHIP_LABELS[mgr.activeChip] || mgr.activeChip} active this gameweek` });
                }

                // Only worth saying while the gameweek is actually running.
                if (mgr.gwLive && mgr.progress && mgr.progress.total) {
                    const pr = mgr.progress;
                    if (pr.toPlay > 0) ups.push({ cat: 'progress', w: 58, icon: '⏱️', text: `${pr.toPlay} of your XI still to play` });
                    if (pr.blank > 0) downs.push({ cat: 'progress', w: 58, icon: '🚫', text: `${pr.blank} starter${pr.blank > 1 ? 's have' : ' has'} no fixture this gameweek` });
                }

                if (mgr.rankDelta != null && Math.abs(mgr.rankDelta) >= 1000) {
                    const climbed = mgr.rankDelta > 0;
                    (climbed ? ups : downs).push({
                        cat: 'rank', w: 54, icon: climbed ? '▲' : '▼',
                        text: `Overall rank ${climbed ? 'up' : 'down'} ${Math.abs(mgr.rankDelta).toLocaleString()} places`
                    });
                }
            }

            // Rotation risk is a squad-wide problem even when no one is injured.
            const shaky = analysisResults.filter(a => !a.player.onBench
                && typeof expectedMinutesModel === 'function'
                && expectedMinutesModel(a.player).pStart < 0.6);
            if (shaky.length) {
                downs.push({ cat: 'rotation', w: 66, icon: '🔄', text: `${shaky.length} starter${shaky.length > 1 ? 's are' : ' is'} a rotation risk (${shaky.slice(0, 2).map(a => a.player.name).join(', ')}${shaky.length > 2 ? '…' : ''})` });
            }

            // Three from one club is a concentration bet worth naming.
            const byTeam = {};
            analysisResults.filter(a => !a.player.onBench).forEach(a => { byTeam[a.player.teamId] = (byTeam[a.player.teamId] || 0) + 1; });
            Object.keys(byTeam).filter(t => byTeam[t] >= 3).forEach(t => {
                const label = (teams[t] && teams[t].short_name) || '';
                downs.push({ cat: 'stacking', w: 52, icon: '🎯', text: `${byTeam[t]} starters from ${label} — your week rides on one result` });
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

            const line = x => {
                const rising = x.pct > 0;
                const near = Math.abs(x.pct) >= 90;
                return {
                    cls: rising ? 'up' : 'down',
                    icon: rising ? '📈' : '📉',
                    text: `${x.p.name} ${rising ? '+' : ''}${Math.round(x.pct)}%${near ? (rising ? ' — rises tonight' : ' — drops tonight') : ''}`
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

        function renderSquadTicker(label, items, tip) {
            if (!items.length) return '';
            const one = it => `<span class="tm-tick ${it.cls}">
                <span class="tm-tick-arrow">${it.icon}</span>
                <span class="tm-tick-name">${escHTML(it.text)}</span>
            </span>`;
            // The run is rendered twice and the track shifted by exactly half, so the
            // wrap-around is invisible. Content scrolls right to left.
            const run = items.map(one).join('<span class="tm-tick-sep">•</span>');
            const secs = (items.length * SQ_TICKER_SEC_PER_ITEM).toFixed(1);
            return `<div class="sq-ticker-row">
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
                "How close your players are to a price change, projected from net transfers against each player's owner base. FPL does not publish its real threshold.");
            return (pulse || market) ? `<div class="sq-tickers">${pulse}${market}</div>` : '';
        }

        function renderTeamOverview(health, sells, monitors, holds, stars, healthBreakdown, suggestedMoves) {
            const circumference = 2 * Math.PI * 54;
            const healthColor = health >= 75 ? 'var(--verdict-hold)' : health >= 50 ? 'var(--verdict-monitor)' : 'var(--verdict-sell)';
            const healthText = health >= 85 ? 'Excellent' : health >= 70 ? 'Good Shape' : health >= 55 ? 'Needs Work' : health >= 40 ? 'Concerning' : 'Overhaul Needed';

            return `
            <div class="team-overview">
                <div class="health-ring-container">
                    <div class="health-ring">
                        <svg viewBox="0 0 120 120">
                            <circle class="health-ring-track" cx="60" cy="60" r="54"/>
                            <circle class="health-ring-fill" id="healthRingFill" cx="60" cy="60" r="54"
                                stroke="${healthColor}" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference}"
                                style="transform:rotate(-90deg);transform-origin:center;"/>
                            <text x="60" y="55" text-anchor="middle" fill="${healthColor}" font-size="30" font-weight="700" font-family="var(--font-mono)">${health}</text>
                            <text x="60" y="72" text-anchor="middle" fill="var(--text-muted)" font-size="10" font-weight="600">HEALTH</text>
                        </svg>
                    </div>
                    <div class="health-sublabel">${healthText}</div>
                    ${healthBreakdown && healthBreakdown.length
                        ? `<div class="health-breakdown">${healthBreakdown.map(b => `${b.count} ${escHTML(b.label)}`).join(' · ')}</div>`
                        : `<div class="health-breakdown">No injuries or fixture red flags</div>`}
                    ${(() => {
                        // Say how much season is behind the number. A score built on
                        // one or two gameweeks is mostly a statement about fixtures
                        // and availability, and should not read as a verdict on the
                        // squad — which is exactly how a single quiet Saturday used
                        // to present itself.
                        const played = Math.max(0, (currentGW || 1) - 1) || (currentGW === 1 ? 1 : 0);
                        return played < 4
                            ? `<div class="health-sample">Based on ${played} gameweek${played === 1 ? '' : 's'} — form is still weighted toward what each player is expected to do, not what he did once.</div>`
                            : '';
                    })()}
                    <div class="insight-moves">
                        <div class="insight-moves-head">Do this week</div>
                        ${renderSuggestedMoves(suggestedMoves || [])}
                    </div>
                    <div class="health-verdict-counts">
                        ${sells.length ? `<span class="hv-count sell">● ${sells.length} Sell</span>` : ''}
                        ${monitors.length ? `<span class="hv-count monitor">● ${monitors.length} Monitor</span>` : ''}
                        ${stars.length ? `<span class="hv-count star">★ ${stars.length} Star</span>` : ''}
                        <span class="hv-count hold">● ${holds.length} Hold</span>
                    </div>
                </div>
                ${renderSnapshotBody()}
                ${renderManagerCard()}
            </div>`;
        }

        // Right-hand column of the squad overview. Reads the managerData/picksData
        // globals directly (both assigned in loadTeamById before analyzeTeam() runs).
        // ===== MANAGER PANEL DATA =====
        // Every figure the panel shows is derived here so the render stays dumb and
        // each derivation can be checked on its own.
        const CHIP_LABELS = { wildcard: 'Wildcard', freehit: 'Free Hit', bboost: 'Bench Boost', '3xc': 'Triple Captain' };
        const CHIP_ICONS  = { wildcard: '🃏', freehit: '🎲', bboost: '🪑', '3xc': '👑' };

        // FPL never exposes how many free transfers you hold, so it has to be
        // replayed from the transfer history: +1 per gameweek, capped, minus the
        // transfers made, and gameweeks played under a Wildcard or Free Hit don't
        // spend anything. GW1 is squad creation, which is unlimited.
        function deriveFreeTransfers() {
            const rows = managerHistory?.current || [];
            if (!rows.length) return { count: 1, exact: false };

            // Replayed by the shared engine so the dashboard cannot drift from this.
            const ft = typeof twDeriveFreeTransfers === 'function'
                ? twDeriveFreeTransfers(rows, managerHistory?.chips, maxFreeTransfers)
                : 1;
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
                out.push({ name: def.name, label: CHIP_LABELS[def.name] || def.name, icon: CHIP_ICONS[def.name] || '🎫', available: !spent });
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
            const currEvent = gwEvents.find(e => e.id === currentGW) || null;
            const gwLive = !!(currEvent && !currEvent.finished);
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
                    out.textContent = 'Locked';
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

            const ftNote = d.transfersMade
                ? `${d.transfersMade} made this GW${d.hitCost ? ` · −${d.hitCost} pts` : ''}`
                : 'No transfers made yet';

            const p = d.progress;
            const progressPct = p.total ? Math.round(((p.played + p.live * 0.5) / p.total) * 100) : 0;

            return `<div class="manager-info">
                <div class="manager-name">
                    <span>${escHTML(d.name)}</span>
                    <span class="mgr-gw">GW${d.gw}${d.gwLive ? ' · <span class="mgr-livedot">LIVE</span>' : ''}</span>
                </div>

                ${d.deadline ? `<div class="mgr-deadline" id="mgrDeadline" data-deadline="${escHTML(d.deadline)}" data-gw="${d.deadlineGW}">
                    <span class="mgr-deadline-label">⏳ GW${d.deadlineGW} deadline</span>
                    <span class="mgr-deadline-value">—</span>
                </div>` : ''}

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
                    <span class="mgr-label">💰 Squad · Bank</span>
                    <span class="mgr-value">£${d.squadValue.toFixed(1)}m <span class="mgr-sep">·</span> £${d.bank.toFixed(1)}m</span>
                </div>

                <div class="mgr-row">
                    <span class="mgr-label">🎟️ Free transfers${d.freeTransfersExact ? '' : '<span class="mgr-est" title="Estimated: FPL does not publish your free-transfer count, so it is replayed from your transfer history.">est</span>'}</span>
                    <span class="mgr-value">${d.freeTransfers}<span class="mgr-sub">${escHTML(ftNote)}</span></span>
                </div>

                <div class="mgr-chips">
                    <div class="mgr-chips-head">🃏 ${activeLabel ? `Active: <strong>${escHTML(activeLabel)}</strong>` : 'No chip active'}</div>
                    <div class="mgr-chips-list">
                        ${d.chips.length ? d.chips.map(ch => `<span class="mgr-chip ${ch.available ? 'avail' : 'used'} ${d.activeChip === ch.name ? 'active' : ''}"
                            title="${escHTML(ch.label)} — ${d.activeChip === ch.name ? 'active this gameweek' : ch.available ? 'available' : 'already used'}">
                            ${ch.icon} ${escHTML(ch.label)}</span>`).join('')
                        : '<span class="mgr-chip used">None available</span>'}
                    </div>
                    ${d.chips.length ? `<div class="mgr-chips-note">${chipsAvail.length} of ${d.chips.length} still available</div>` : ''}
                </div>

                ${p.total ? `<div class="mgr-progress">
                    <div class="mgr-progress-head">
                        <span>⏱️ ${p.played}/${p.total} played</span>
                        <span class="mgr-progress-right">${p.live ? `<span class="mgr-livedot">${p.live} live</span> · ` : ''}${p.toPlay} to play${p.blank ? ` · ${p.blank} blank` : ''}</span>
                    </div>
                    <div class="mgr-progress-bar"><div class="mgr-progress-fill" style="width:${progressPct}%"></div></div>
                </div>` : ''}
            </div>`;
        }

