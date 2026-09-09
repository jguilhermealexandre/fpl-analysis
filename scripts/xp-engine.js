/* ============================================
   EasyFPL — the expected-points engine

   One projection, shared by every surface that shows an xP figure: the squad
   pitch, the squad table, the lineup optimiser, the gameweek draft, the
   transfer wizard, and the dashboard. It used to live inside
   scripts/pitch-snapshot.js, which meant the dashboard — the one page that
   loads neither the squad scripts nor the squad state — had no access to it
   and showed no projections at all.

   These are plain globals in a classic script, matching the rest of the
   codebase, so every existing caller keeps working unchanged.

   DEPENDENCIES, which the host page must define as globals before calling:

     positionAverages          { [pos]: { xGIPer90, medPrice } }
     teamAnalysis              { [teamId]: { attackPower*, defensePower*, ... } }
     currentGW                 number
     isPreseason               boolean
     computePlayerGamesPlayed  (player) => number
     teamFixtures6             { [teamId]: fixture[] }   — only for
                               projectPlayerPointsForGW / projectLineupForGW;
                               not needed when a fixture is passed explicitly.

   Call xpEngineReady() to check the contract is satisfied before projecting.

   And one dependency that is not a global: THE PLAYER OBJECT ITSELF. Every
   function here reads a specific shape — minutes, starts, xG, xA, bonus, saves,
   status, chanceNextRound, penaltiesOrder, teamId, position, price. That shape
   went undocumented for as long as exactly one file produced it, which is why
   the players page ended up with a second projection rather than this one: it
   had bootstrap-static.json and no way to turn it into a player the engine
   would accept. xpBuildPlayers() below is that mapping, so any page holding the
   bootstrap feed can now satisfy the contract.
   ============================================ */

        /* The position baselines every rate here is regressed toward, and the
           median price the price-quality prior measures against.

           The minutes bar has to scale with the season: a flat 200 matches nobody
           until GW3, which silently collapsed every position onto one hardcoded
           fallback — so a goalkeeper was regressed toward the same 0.30 xGI/90
           baseline as a striker.

           Takes the pool and the gameweek rather than reading globals, so a page
           can build this before it has anything else the engine wants. */
        function xpBuildPositionAverages(players, gw) {
            const out = {};
            const minMinutes = Math.min(200, Math.max((gw || 0) - 1, 1) * 60);
            // Sensible per-position xGI/90 priors for when there's still no sample.
            const FALLBACK_XGI90 = { 1: 0.01, 2: 0.08, 3: 0.28, 4: 0.45 };
            [1, 2, 3, 4].forEach(pos => {
                const posPlayers = (players || []).filter(p => p.position === pos && p.minutes >= minMinutes);
                if (posPlayers.length === 0) { out[pos] = { form: 3, ppg: 3, ppm: 15, xGIPer90: FALLBACK_XGI90[pos] }; return; }
                const avg = (arr, fn) => arr.reduce((s, p) => s + fn(p), 0) / arr.length;
                // Median price for this position, which is the reference point the
                // projection's price-quality prior measures a player against.
                const prices = posPlayers.map(p => p.price).sort((a, b) => a - b);
                out[pos] = {
                    form: avg(posPlayers, p => p.form),
                    ppg: avg(posPlayers, p => p.ppg),
                    ppm: avg(posPlayers, p => p.points / Math.max(p.price, 1)),
                    xGIPer90: avg(posPlayers, p => p.minutes > 0 ? (p.xGI / p.minutes) * 90 : 0),
                    medPrice: prices[Math.floor(prices.length / 2)] || 0
                };
            });
            return out;
        }

        /* How many matches a player's season totals are spread over.

           Lived in squad-table-chart.js, which put a squad-page rendering file on
           the dependency list of every projection on the site. It reads the
           currentGW and isPreseason globals named in the contract above.

           Preseason has no gameweeks to count, so it falls back to the player's
           own starts — or to whole matches' worth of minutes when even that is
           missing — and never returns zero, because every caller divides by it. */
        function computePlayerGamesPlayed(player) {
            return isPreseason
                ? Math.max(player.starts || Math.round(player.minutes / 90), 1)
                : Math.max(currentGW - 1, 1);
        }

        /* One player object, from one FPL `element`, in the shape this engine
           reads. The other half of the contract documented above, and the half
           that was never written down: every field projectPlayerPointsDetailed
           touches originates here.

           It lived inside team-analysis-core.js, which made that file the only
           thing in the codebase able to produce a player the engine understood —
           so a page wanting a projection had to load the entire squad-analysis
           module or write its own model. The players page did the second, and
           that is where calculateMultiGWxPts came from. A builder is what lets
           any page holding bootstrap-static.json satisfy the contract instead.

           teamsById supplies short names, teamFixturesByTeam the upcoming run;
           both are optional and their absence degrades a label, not a
           projection. */
        function xpBuildPlayers(elements, teamsById, teamFixturesByTeam) {
            const teamsMap = teamsById || {};
            const fixturesMap = teamFixturesByTeam || {};
            return (elements || []).map(p => ({
                id: p.id, code: p.code, name: p.web_name, fullName: `${p.first_name} ${p.second_name}`,
                squadNumber: p.squad_number,
                team: teamsMap[p.team]?.short_name || 'N/A', teamId: p.team,
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
                /* FPL publishes its own per-90s and its own within-position
                   ranks. Both were being recomputed from season totals in
                   three places and the ranks were not available at all, which
                   is why every rate on the site was shown raw — 0.32 xGI/90
                   is elite for a defender and ordinary for a striker, and
                   nothing could say which. rank_type is 1 = best within the
                   position; scripts/transfer-funnel.js turns them into
                   percentiles for its quality filter. */
                xG90: p.expected_goals_per_90 != null ? parseFloat(p.expected_goals_per_90) : null,
                xA90: p.expected_assists_per_90 != null ? parseFloat(p.expected_assists_per_90) : null,
                xGI90: p.expected_goal_involvements_per_90 != null ? parseFloat(p.expected_goal_involvements_per_90) : null,
                xGC90: p.expected_goals_conceded_per_90 != null ? parseFloat(p.expected_goals_conceded_per_90) : null,
                saves90: p.saves_per_90 != null ? parseFloat(p.saves_per_90) : null,
                starts90: p.starts_per_90 != null ? parseFloat(p.starts_per_90) : null,
                cs90: p.clean_sheets_per_90 != null ? parseFloat(p.clean_sheets_per_90) : null,
                formRankType: p.form_rank_type || null,
                ppgRankType: p.points_per_game_rank_type || null,
                ictRankType: p.ict_index_rank_type || null,
                threatRankType: p.threat_rank_type || null,
                creativityRankType: p.creativity_rank_type || null,
                ownershipRankType: p.selected_rank_type || null,
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
                /* Official price engine: a 0->100 progress meter toward the
                   next change, the game's own forecast of it for today/+1/+2
                   days, and a lock before which the player cannot move.
                   Read by scripts/price-watch.js. */
                priceProgress: parseFloat(p.price_change_percent) || 0,
                priceProjection: (p.price_change_projections || []).map(x => parseFloat(x.projected_percent) || 0),
                priceLockedUntil: p.price_change_locked_until || null,
                epNext: parseFloat(p.ep_next) || 0,
                dreamteamCount: p.dreamteam_count || 0,
                valueForm: parseFloat(p.value_form) || 0,
                valueSeason: parseFloat(p.value_season) || 0,
                fixtures: fixturesMap[p.team] || []
            }));
        }

        /* Team strength — attack, defence, form and the upcoming fixture run.

           The site had three of these, and they were not merely copies of each
           other. The players page blended 35% xG, 35% goals and 30% FPL strength;
           this one uses goals and strength alone; the dashboard's emitted no
           home/away splits at all, so the projection quietly fell back to the
           unsplit figure there.

           This is the 2-component one, kept because it was measured rather than
           preferred. Run over the 2025/26 season through
           tools/wildcard-backtest.mjs, the xG-blended version moved every team's
           attack rating — one of them by 31 points — and changed the projection
           not at all: Spearman 0.356 against 0.356, Pearson 0.318 against 0.314,
           MAE 2.028 against 2.013, and only 2.4% of same-gameweek player pairs
           ordered differently. Equivalent for the one thing it feeds, so the
           cheaper one wins — no team-xG dependency means no players-data.json
           needed on a page that only wanted team strength.

           The xG helpers survive for the trend LABELS, which are display only and
           which the projection has never read. They are typeof-guarded because
           the dashboard has no team-xG subsystem at all, and a label is not worth
           a ReferenceError.

           Returns rather than assigning, so each page owns its own binding. */
        function xpBuildTeamScores(bootTeams, fixturesData) {
            const ta = {};

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
                const seasonXg = typeof getTeamSeasonXg === 'function' ? getTeamSeasonXg(teamId) : null;
                const recent6Xg = typeof getTeamXgWindow === 'function' ? getTeamXgWindow(teamId, 6) : null;
                let xgTrend = 'stable', xgcTrend = 'stable';
                if (recent6Xg && seasonXg && (seasonXg.games || 0) >= 10) {
                    const xgDelta = recent6Xg.xGpg - seasonXg.xGpg;
                    if (xgDelta > 0.25) xgTrend = 'rising';
                    else if (xgDelta < -0.25) xgTrend = 'falling';
                    const xgcDelta = recent6Xg.xGCpg - seasonXg.xGCpg;
                    if (xgcDelta < -0.20) xgcTrend = 'improving';
                    else if (xgcDelta > 0.20) xgcTrend = 'worsening';
                }

                ta[teamId] = {
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
            console.log('Team analysis computed for', Object.keys(ta).length, 'teams');
            return ta;
        }

        /* Upcoming fixtures per team, keyed by team id — the input
           projectPlayerPointsForGW reads.

           Counted in whole GAMEWEEKS, not fixtures. A double gameweek spends two
           slots on one gameweek, and a gameweek already under way still holds a
           slot of its own, so counting fixtures silently loses coverage off the
           end of the window. Filters on finished_provisional rather than
           finished: a round reports finished_provisional first, and treating it
           as still upcoming leaves settled matches in the planning window.

           Shared so the squad page and the dashboard build the same window. */
        function xpBuildTeamFixtures(fixturesData, teamsById, spanGws) {
            const out = {};
            const span = spanGws || 8;
            const upcoming = (fixturesData || [])
                .filter(f => !f.finished_provisional && f.event !== null)
                .sort((a, b) => a.event - b.event);
            Object.keys(teamsById || {}).forEach(key => {
                const tid = parseInt(key, 10);
                const seen = [];
                out[tid] = upcoming.filter(f => {
                    if (f.team_h !== tid && f.team_a !== tid) return false;
                    if (seen.indexOf(f.event) === -1) {
                        if (seen.length >= span) return false;
                        seen.push(f.event);
                    }
                    return true;
                }).map(f => {
                    const isHome = f.team_h === tid;
                    return {
                        opponent: isHome ? teamsById[f.team_a]?.short_name : teamsById[f.team_h]?.short_name,
                        opponentId: isHome ? f.team_a : f.team_h,
                        difficulty: isHome ? f.team_h_difficulty : f.team_a_difficulty,
                        isHome, event: f.event
                    };
                });
            });
            return out;
        }

        /* Expected FPL points for the coming gameweek, built from the scoring
           rules rather than read off FPL's ep_next. ep_next is heavily regressed
           early in a season — capped at 4.0 across the whole game — so summing it
           produced a Starting XI projection in the low 30s where a real XI scores
           45-60, and left every player bunched between 1.5 and 4.0, which is
           useless for comparing them.

           Returns the component breakdown, so the same numbers can justify
           captaincy and bench-swap advice rather than a second model doing it.

           Goals a team is expected to concede in one specific fixture: both sides
           are expressed as multipliers around the league's ~1.4 goals a game. A
           defence rated 50 is neutral, 100 halves what it concedes, 0 doubles it,
           and the same for the opponent's attack. */
        const LEAGUE_GOALS_PER_TEAM = 1.4;

        function expectedGoalsAgainst(teamId, fixture) {
            const ta = teamAnalysis[teamId];
            const isHome = fixture ? !!fixture.isHome : true;
            const oppId = fixture ? fixture.opponentId : null;
            const opp = oppId != null ? teamAnalysis[oppId] : null;

            // Own defence at this venue, falling back to the overall figure.
            const defPower = ta
                ? (isHome ? (ta.defensePowerHome ?? ta.defensePower) : (ta.defensePowerAway ?? ta.defensePower))
                : 50;
            // The opponent attacks at the opposite venue to ours.
            const attPower = opp
                ? (isHome ? (opp.attackPowerAway ?? opp.attackPower) : (opp.attackPowerHome ?? opp.attackPower))
                : 50;

            // 50 is neutral; each 50 points of rating scales the rate by half.
            const defFactor = Math.max(0.45, Math.min(1.9, 1 - (defPower - 50) / 100));
            const attFactor = Math.max(0.45, Math.min(1.9, 1 + (attPower - 50) / 100));
            // Home sides concede a little less; the split powers carry most of it
            // already, so this is a light touch rather than a full adjustment.
            const venueFactor = isHome ? 0.94 : 1.06;

            let xga = LEAGUE_GOALS_PER_TEAM * defFactor * attFactor * venueFactor;

            // Blend in what the team has actually conceded once there is a sample
            // worth blending — ratings are priors, results are evidence.
            if (ta && ta.matchesPlayed > 0) {
                const w = Math.min(1, ta.matchesPlayed / 6) * 0.5;
                xga = xga * (1 - w) + (ta.avgConceded * (attFactor / 1.0)) * w;
            }
            // No opponent known (a blank, or data missing) — fall back to the
            // fixture rating so the number still moves with difficulty.
            if (!opp && fixture) {
                xga *= 1 + ((fixture.difficulty || 3) - 3) * 0.12;
            }

            /* The betting market's estimate of this same number, where it has
               one — which is the next gameweek and nothing beyond it.

               This is the only place the market enters the projection, and that
               is deliberate: clean sheets and goals-conceded points are both
               derived from xga a few lines below, so correcting it here corrects
               them together and cannot leave the two disagreeing. The weight
               fades as the model's own sample grows, and boMarketXGA returns null
               unless every fixture in the round is priced — see the reasoning in
               scripts/odds-panel.js. Absent the feed, nothing changes. */
            if (typeof boMarketXGA === 'function') {
                const marketXga = boMarketXGA(teamId, fixture);
                if (marketXga != null) {
                    const w = boMarketWeight(ta ? ta.matchesPlayed : 0);
                    xga = xga * (1 - w) + marketXga * w;
                }
            }

            return Math.max(0.25, Math.min(4.0, xga));
        }

        // A clean sheet is simply no goals conceded, so it is the zero bucket of a
        // Poisson at that expected-goals-against.
        function cleanSheetProbFor(teamId, fixtureOrFdr) {
            // Back-compatible: older callers pass a bare FDR number.
            const fixture = (fixtureOrFdr && typeof fixtureOrFdr === 'object')
                ? fixtureOrFdr
                : { isHome: true, opponentId: null, difficulty: fixtureOrFdr || 3 };
            const xga = expectedGoalsAgainst(teamId, fixture);
            return Math.max(0.02, Math.min(0.70, Math.exp(-xga)));
        }

        /* How good we should assume a player is BEFORE we have evidence.

           Regressing everyone toward the flat position average says a £12m
           midfielder and a £5m midfielder are the same player until proven
           otherwise. They are not, and the market knows it: across the pool,
           price and FPL's own ep_next correlate at +0.89, while a single
           gameweek's xGI/90 correlates at +0.32. With one match played the
           prior carries ~80% of every projection, so a price-blind prior meant
           one good game from a cheap player outranked one quiet game from a
           premium — which is exactly how a £12.0m midfielder came to project
           below a £5.5m one.

           Exponents are fitted from the pool itself (minutes-pooled price
           deciles, log-log): DEF 2.2, MID 2.1, FWD 1.1. DEF and MID are held
           back to 1.5 because a one-gameweek fit is not worth trusting at full
           strength; FWD is used as fitted, where the price/xP correlation
           independently peaks. Clamped so neither a £4.0m nor a £15.0m player
           gets an absurd prior.

           This scales the PRIOR only, never the player's observed rate, so it
           fades to nothing as real evidence arrives. */
        const PRICE_PRIOR_K = { 1: 0, 2: 1.5, 3: 1.5, 4: 1.0 };
        const PRICE_PRIOR_CLAMP = [0.6, 2.4];

        function priceQualityMultiplier(player) {
            const k = PRICE_PRIOR_K[player.position] || 0;
            if (!k) return 1;
            const med = (positionAverages[player.position] || {}).medPrice;
            if (!med || !player.price) return 1;
            const m = Math.pow(player.price / med, k);
            return Math.max(PRICE_PRIOR_CLAMP[0], Math.min(PRICE_PRIOR_CLAMP[1], m));
        }

        // Per-90 rates off a one-gameweek sample are wild (one goal = a huge
        // xG/90), so regress them toward the position average until there's
        // roughly five full matches of evidence.
        /* Expected penalty xG per 90 from published spot-kick duty.

           FPL's expected_goals already contains the penalties a player has
           actually taken, so this must only supply what his history cannot: a
           taker newly appointed this season has the job but no penalty xG behind
           him, and the regression toward a position baseline then treats him as
           an ordinary player. Roughly 0.26 penalties are awarded per match across
           both sides, so about 0.13 fall to a given team, and a converted penalty
           is worth about 0.79 xG.

           It goes into the PRIOR only, alongside the price multiplier, so it
           fades out exactly as his own record fills in — which is also what stops
           it double-counting the penalties already inside his xG. */
        const PEN_XG90 = { 1: 0.10, 2: 0.04, 3: 0.00 };

        function penaltyPriorXg90(player) {
            const order = player.penaltiesOrder;
            if (order == null || player.position === 1) return 0;
            return PEN_XG90[order] || 0;
        }

        // Per-90 rates off a one-gameweek sample are wild (one goal = a huge
        // xG/90), so regress them toward the position average until there's
        // roughly five full matches of evidence.
        function regressedPer90(player) {
            const mins = player.minutes || 0;
            const posAvg = positionAverages[player.position] || {};
            const baseXgi = (posAvg.xGIPer90 || 0.25) * priceQualityMultiplier(player);
            // Split open play first: the assist share is what is left of the xGI
            // baseline once shooting is taken out. Penalties are added only after
            // that split, or a spot-kick taker would have the same amount quietly
            // deducted from his expected assists.
            const baseXgOpen = baseXgi * (player.position === 4 ? 0.65 : player.position === 3 ? 0.5 : 0.25);
            const baseXa = Math.max(0, baseXgi - baseXgOpen);
            const baseXg = baseXgOpen + penaltyPriorXg90(player);
            const w = Math.min(1, mins / 450);
            return {
                xg90: w * (mins > 0 ? (player.xG / mins) * 90 : 0) + (1 - w) * baseXg,
                xa90: w * (mins > 0 ? (player.xA / mins) * 90 : 0) + (1 - w) * baseXa
            };
        }

        /* Defensive contribution — the scoring route added for 2025/26.
           FPL totals tackles, clearances/blocks/interceptions and recoveries into
           one figure and pays a flat 2 points once a per-match threshold is met.
           The thresholds below were read off the live endpoint's own explain
           blocks rather than assumed: in Gameweek 1 the highest defender scoring
           nothing had 9 and the lowest scoring 2 points had 10; for midfielders
           the same boundary sits between 11 and 12. Goalkeepers never qualify.

           Leaving this out under-projected every defender and defensive
           midfielder, which mattered because the optimiser picks lineups from
           these numbers. */
        const DC_THRESHOLD = { 1: Infinity, 2: 10, 3: 12, 4: 12 };
        const DC_POINTS = 2;
        // Per-90 baselines used while a player's own sample is thin. These are the
        // measured means across players with 60+ minutes, not estimates — an
        // earlier guess of 5.0 for midfielders under-projected the position by an
        // order of magnitude against what Gameweek 1 actually paid out.
        // Defenders sit at the measured mean of 7.5. Midfielders are nudged from
        // their measured 8.0 to 8.4, which is the value that reproduces the
        // observed 14% threshold hit-rate — counting stats summed from three
        // sources are over-dispersed, so a plain Poisson at the mean understates
        // the tail. Calibrated against hit-rate rather than one week's point
        // total, because a single gameweek's total is a noisy realisation.
        const DC_BASELINE_90 = { 1: 0, 2: 7.5, 3: 8.4, 4: 4.2 };

        function defensiveContributionPoints(player, min90) {
            const threshold = DC_THRESHOLD[player.position];
            if (!threshold || threshold === Infinity || !min90) return 0;

            const mins = player.minutes || 0;
            // Same regression the attacking rates use: a single match of tackles
            // is not a rate, so lean on the position baseline until there is
            // roughly five matches of evidence.
            const w = Math.min(1, mins / 450);
            const own90 = player.defCon90 || (mins > 0 ? ((player.defCon || 0) / mins) * 90 : 0);
            const dc90 = w * own90 + (1 - w) * (DC_BASELINE_90[player.position] || 0);

            const expected = dc90 * min90;
            if (expected <= 0) return 0;

            // Counting events over a match sit close enough to Poisson for this
            // purpose, so the chance of clearing the threshold is the survival
            // function at that count.
            let pBelow = 0, term = Math.exp(-expected);
            for (let k = 0; k < threshold; k++) {
                pBelow += term;
                term *= expected / (k + 1);
            }
            const pHit = Math.max(0, Math.min(1, 1 - pBelow));
            return pHit * DC_POINTS;
        }

        // A harder fixture suppresses attacking returns by the same factor the
        // projection uses, so a per-fixture xGI reads on the projection's terms.
        /* How much a fixture helps or hurts attacking returns.

           The clean-sheet side of this model asks expectedGoalsAgainst() for a
           continuous figure built from venue-split opponent ratings blended with
           what has actually been conceded. The attacking side used to ask only
           FDR: a publisher-assigned integer worth at most ±20%, which put twelve
           different defences — AVL, BHA, BOU, BRE, CRY, EVE, FUL, LEE, NEW, NFO,
           SUN and TOT — in one bucket and multiplied all of them by exactly 1.00.
           The better opponent model was already in the page; the attack side just
           never called it.

           Only the OPPONENT's defensive quality belongs here. The player's own
           per-90 rate already reflects how good his team is at creating chances,
           so folding in his team's attack rating would count it twice. Same
           neutral-50 convention as expectedGoalsAgainst, mirrored: a strong
           defence suppresses, a weak one inflates. Falls back to FDR when the
           opponent is unknown — a blank, or ratings not built yet. */
        function fixtureAttackAdj(fixtureOrFdr) {
            const fixture = (fixtureOrFdr && typeof fixtureOrFdr === 'object') ? fixtureOrFdr : null;
            const fdr = fixture ? (fixture.difficulty || 3) : (fixtureOrFdr || 3);
            const fdrAdj = 1 + (3 - fdr) * 0.10;

            const oppId = fixture ? fixture.opponentId : null;
            const opp = (oppId != null && typeof teamAnalysis !== 'undefined') ? teamAnalysis[oppId] : null;
            if (!opp) return fdrAdj;

            const isHome = !!fixture.isHome;
            // The opponent defends at the opposite venue to ours.
            const oppDef = isHome ? (opp.defensePowerAway ?? opp.defensePower)
                                  : (opp.defensePowerHome ?? opp.defensePower);
            if (oppDef == null) return fdrAdj;

            const defFactor = Math.max(0.5, Math.min(1.6, 1 - (oppDef - 50) / 100));
            // Sides score a little more at home; the player's own rate is a
            // season average across both venues, so this shifts it to this one.
            const venueFactor = isHome ? 1.06 : 0.94;
            return Math.max(0.6, Math.min(1.55, defFactor * venueFactor));
        }

        // Expected share of a start, and the minutes that implies. A player with no
        // minutes yet still gets a small floor rather than zero — reporting 0.00 for
        // every fixture of an unplayed player reads as broken data, not as caution.
        // A season-long minutes-per-start average is a fine prior once there is
        // a real season behind it, but a flat "80 minutes" prior is not — it
        // pulls a nailed-on 90-minute player down toward a generic average
        // regardless of how clear-cut his role actually is, and the effect is
        // largest exactly when it is most visible: early in a season, when
        // every single player who started gameweek 1 blends toward the same
        // number no matter how obviously undroppable each of them looks. Last
        // season's own minutes-per-start is a far better prior than a
        // league-wide guess, when there is enough of it to trust — same
        // 5-appearance-minimum idea lastSeasonPointsPerGame uses for the same
        // reason, just a lower bar since minutes-per-start needs less sample
        // to be reliable than a scoring rate does.
        function lastSeasonMinsPerStart(player) {
            const ls = typeof lastSeasonFor === 'function' ? lastSeasonFor(player.id) : null;
            if (!ls || !ls.starts || ls.starts < 5) return null;
            return Math.min(90, ls.minutes / ls.starts);
        }

        /* The statuses that mean "will not feature", as one list rather than as a
           condition repeated in two places.

           It was repeated in two places, and both were missing 'n' — FPL's code
           for a player not in the squad at all, typically unregistered or out on
           loan. Those players were projected exactly like anyone else. Measured
           over the gameweeks with real team news: 56 player-gameweeks projecting
           2.15 points and returning 0.00, and 2 of the 56 appeared at all.

           A list nobody has to remember to update twice is the actual fix. 'd',
           doubtful, is deliberately absent — that one is a probability, handled by
           `avail` in the minutes model rather than by exclusion. */
        const XP_STATUS_OUT = ['i', 'u', 's', 'n'];

        function xpIsUnavailable(player) {
            return !!player && XP_STATUS_OUT.indexOf(player.status) !== -1;
        }

        function expectedMinutesModel(player) {
            const avail = player.status === 'd'
                ? (player.chanceNextRound != null ? player.chanceNextRound : 50) / 100
                : 1;
            const games = computePlayerGamesPlayed(player);
            const mpg = (player.minutes || 0) / Math.max(games, 1);

            // Minutes alone cannot tell a starter from a substitute: ninety minutes
            // across one start and ninety across three cameos look identical, and
            // the second player is not a 0.92 to start. FPL publishes a starts
            // count, so use the rate directly and let minutes per game refine it.
            const starts = player.starts || 0;
            const startRate = games > 0 ? Math.min(1, starts / games) : 0;
            /* A continuous read of minutes, not a five-step ladder.

               This was `mpg >= 80 ? 0.92 : mpg >= 60 ? 0.75 : ...`, which could not
               tell ninety minutes from eighty-one, or seventy-nine from sixty-one.
               Stacked with the two-point expected-minutes formula below it, the
               whole model collapsed to five possible outputs across the entire
               league — every player on the pitch reading 78' or 70'. Only visible
               once the number was actually put on screen. */
            const minutesSignal = Math.max(0, Math.min(1, (mpg - 8) / 70));

            // Lean on the starts rate once there are a couple of matches behind it;
            // before that it is one coin flip and minutes are the steadier read.
            const wStarts = Math.min(1, games / 3);
            let pStart = wStarts * startRate + (1 - wStarts) * minutesSignal;
            // A player who starts every week but is routinely hooked early is still
            // a starter; one who has never started is not, whatever his minutes.
            if (starts === 0 && games > 0) pStart = Math.min(pStart, 0.22);
            pStart = Math.max(0.03, Math.min(0.96, pStart));
            pStart *= avail;
            /* Minutes when he does start, taken from his own record rather than a
               flat 82 for everybody. A player averaging 65 minutes a start is a
               different asset to one who plays the full ninety, and the previous
               formula treated them identically. Regressed toward a prior while
               the sample is thin, so one early substitution does not brand a
               player as a 60-minute man — last season's own rate when there is
               enough of it to trust (see lastSeasonMinsPerStart above), a flat
               80 only for a player with no usable history at all. */
            const startEvidence = Math.min(1, starts / 3);
            const ownMinsPerStart = starts > 0 ? Math.min(90, (player.minutes || 0) / starts) : 0;
            const priorMinsPerStart = lastSeasonMinsPerStart(player) ?? 80;
            const minsPerStart = starts > 0
                ? ownMinsPerStart * startEvidence + priorMinsPerStart * (1 - startEvidence)
                : priorMinsPerStart;
            /* Not starting is worth twelve minutes off the bench — but only to a
               player who is actually in the squad.

               pStart already has `avail` folded into it, so `1 - pStart` GROWS as
               a player's chance of featuring falls: the less likely he is to play,
               the more bench time this credited him with. Backwards, and it showed.
               Against real team news, doubtful players on a published 1-25% chance
               projected 0.99 points and returned 0.03, with not one of them
               completing an hour. They were not being benched, they were absent.

               `avail - pStart` is the same quantity for a fit player — avail is 1
               and the term is unchanged — and collapses toward zero as availability
               does. It cannot go negative: pStart is clamped to 0.96 before being
               multiplied by avail. */
            const expMins = pStart * minsPerStart + (avail - pStart) * 12;
            return { pStart, avail, expMins, min90: expMins / 90 };
        }

        // opts.fixture projects a specific match instead of the player's next one,
        // which is what lets the draft planner price up GW+3. opts.applyEpFloor is
        // separate because FPL's ep_next is an estimate for the NEXT match only —
        // using it as a floor three gameweeks out would import a number that has
        // nothing to do with the fixture being projected.
        function projectPlayerPointsDetailed(player, opts) {
            const o = opts || {};
            const out = { total: 0, appearance: 0, attack: 0, cleanSheet: 0, saves: 0, bonus: 0, conceded: 0, defCon: 0, cards: 0, pStart: 0 };
            if (!player) return out;
            if (xpIsUnavailable(player)) return out;

            const mins = player.minutes || 0;
            const games = computePlayerGamesPlayed(player);
            const { pStart, avail, min90 } = expectedMinutesModel(player);
            out.pStart = pStart;

            // 2 pts for 60+ minutes, 1 otherwise. The second branch is worth
            // `avail - pStart` rather than `1 - pStart`, for the reason given in
            // expectedMinutesModel: an appearance point needs someone available to
            // appear. Identical for a fit player, where avail is 1.
            out.appearance = pStart * 2 + (avail - pStart) * 0.5;

            const fx = o.fixture !== undefined ? o.fixture : (player.fixtures || [])[0];
            const fdr = fx ? (fx.difficulty || 3) : 3;
            // Pass the fixture, not just its difficulty, so the opponent's own
            // defensive rating drives this rather than a 1-5 integer.
            const attackAdj = fixtureAttackAdj(fx || fdr);

            // Per-90 rates off a one-gameweek sample are wild (one goal = a huge
            // xG/90), so regress them toward the position average until there's
            // roughly five full matches of evidence.
            const { xg90, xa90 } = regressedPer90(player);

            const goalPts = player.position <= 2 ? 6 : player.position === 3 ? 5 : 4;
            out.attack = (xg90 * goalPts + xa90 * 3) * min90 * attackAdj;

            const csProb = cleanSheetProbFor(player.teamId, fx || fdr);
            const xga = expectedGoalsAgainst(player.teamId, fx || { isHome: true, opponentId: null, difficulty: fdr });

            const csPts = player.position <= 2 ? 4 : player.position === 3 ? 1 : 0;
            out.cleanSheet = csProb * csPts * pStart;

            if (player.position === 1) {
                // Regressed like the attacking rates. A keeper with five saves in his
                // opening match is not a five-saves-a-game keeper, and left raw this
                // was the single largest source of over-projection for cheap keepers.
                const wS = Math.min(1, mins / 450);
                const own90 = mins > 0 ? (player.saves / mins) * 90 : 0;
                const saves90 = wS * own90 + (1 - wS) * 2.8;
                out.saves = (saves90 / 3) * min90;
            }
            // -1 per 2 goals conceded. Driven by the same fixture-specific expected
            // goals against as the clean sheet above, so facing the best attack in
            // the division and facing the worst no longer carry the same deduction
            // — previously this was a flat season average whatever the opponent.
            if (player.position <= 2) {
                // Expected conceded given at least one went in.
                const givenConceded = csProb < 0.999 ? (xga / (1 - csProb)) : xga;
                out.conceded = -((givenConceded * (1 - csProb)) / 2) * pStart;
            }

            // Same treatment: three bonus points in one appearance is a result, not
            // a rate. The cap alone let a single big game read as a permanent 1.2.
            //
            // Bonus gets a slower clock than the rates above (ten matches, not
            // five) for two reasons. It is far lumpier — a keeper either takes
            // all three or none, where xG accumulates in fractions. And it is
            // partly double-counted: BPS is driven by the clean sheets, saves,
            // goals and assists this function has already projected, so leaning
            // on past bonus pays a good game twice. Left on the five-match clock,
            // one 3-bonus night made a £4.5m keeper the highest-projecting
            // goalkeeper in the game, ahead of every established No.1.
            const wB = Math.min(1, mins / 900);
            const ownBonus = games > 0 ? (player.bonus || 0) / games : 0;
            const bonusPerGame = wB * ownBonus + (1 - wB) * 0.25;
            out.bonus = Math.min(1.2, bonusPerGame) * pStart;

            out.defCon = defensiveContributionPoints(player, min90);

            /* Cards: -1 a yellow, -3 a red. Previously not modelled at all, which
               quietly over-rated every habitual booking — and those are mostly
               defensive midfielders and centre-backs, exactly the players the new
               defensive-contribution rule now rewards. So the term that pays them
               was in and the term that charges them was missing.

               Lumpy like bonus, so it gets the same slow ten-match clock and the
               same treatment: regress toward what a player in this position picks
               up until there is real evidence. Baselines are per 90, measured from
               the pool and sanity-checked against long-run Premier League rates
               (~0.10-0.20 yellows per 90 outfield, far lower for keepers). Reds
               are too rare to measure from a short sample — roughly fifty a season
               across all clubs is about 0.006 per 90 — so they stay a flat prior. */
            const CARD_BASELINE_90 = {
                1: { y: 0.04, r: 0.004 },
                2: { y: 0.17, r: 0.008 },
                3: { y: 0.16, r: 0.005 },
                4: { y: 0.13, r: 0.005 }
            };
            const cardBase = CARD_BASELINE_90[player.position] || CARD_BASELINE_90[3];
            const wC = Math.min(1, mins / 900);
            const ownY90 = mins > 0 ? ((player.yellowCards || 0) / mins) * 90 : 0;
            const ownR90 = mins > 0 ? ((player.redCards || 0) / mins) * 90 : 0;
            const y90 = wC * ownY90 + (1 - wC) * cardBase.y;
            const r90 = wC * ownR90 + (1 - wC) * cardBase.r;
            out.cards = -(y90 * 1 + r90 * 3) * min90;

            out.total = Math.max(0, out.appearance + out.attack + out.cleanSheet + out.saves + out.bonus + out.conceded + out.defCon + out.cards);

            // With little evidence our own numbers are shaky, and FPL's ep_next
            // encodes things we can't see — a new signing with no minutes yet, a
            // confirmed return, set-piece and penalty duty. So while the sample is
            // thin, treat ep_next as a floor rather than letting a fit, expected
            // starter be projected at almost nothing purely for lack of history.
            // Once there's real evidence (~5 full matches) our model stands alone.
            if (o.applyEpFloor !== false && !xpIsUnavailable(player)) {
                const evidence = Math.min(1, mins / 450);
                const floor = (player.epNext || 0) * (1 - evidence);
                out.total = Math.max(out.total, floor);
            }

            return out;
        }

        // What a player projects for one specific gameweek. A double gameweek sums
        // both matches; a blank returns zero, which is the honest answer — a player
        // with no fixture scores nothing, and averaging them out of the total is how
        // a planner quietly lies about a blank.
        function projectPlayerPointsForGW(player, gw) {
            if (!player) return 0;
            const all = teamFixtures6[player.teamId] || [];
            const matches = all.filter(f => f.event === gw);
            if (!matches.length) return 0;

            // The ep_next floor is only meaningful for the very next fixture.
            const isImmediate = all.length > 0 && all[0].event === gw;
            const total = matches.reduce((sum, fixture) =>
                sum + projectPlayerPointsDetailed(player, { fixture, applyEpFloor: isImmediate }).total, 0);
            return Math.round(total * 10) / 10;
        }

        // Projected total for a lineup in a given gameweek, counting the armband and
        // the chip in play: Bench Boost pays the bench, Triple Captain trebles.
        function projectLineupForGW(lineup, gw, chip) {
            if (!lineup || !lineup.length) return 0;
            let total = 0;
            lineup.forEach(p => {
                const xp = projectPlayerPointsForGW(p, gw);
                if (p.onBench && chip !== 'benchboost') return;
                let mult = 1;
                if (p.isCaptain) mult = chip === 'triplecaptain' ? 3 : 2;
                total += xp * mult;
            });
            return Math.round(total * 10) / 10;
        }

        function predictedGWPoints(p) {
            return Math.round(projectPlayerPointsDetailed(p).total * 10) / 10;
        }

        // Expected total for the gameweek, modelling the two things a plain sum of
        // the XI misses and that real FPL scores always include.
        // Parameterised so the optimizer can score a hypothetical lineup with the
        // exact same maths as the headline figure — otherwise its "before" number
        // disagrees with the score already on screen.

        /* ===== Planning horizon =====

           One gameweek answers "who plays this week"; it cannot answer "who is
           worth owning". A player with a soft run and a player facing three of
           the top four look identical over a single fixture and completely
           different over three, so the multi-gameweek views project across a
           run rather than a match.

           Three is the default because it is roughly how far ahead a squad is
           actually plannable: far enough for a fixture swing to show up, close
           enough that the underlying rates still mean something. The transfer
           recommender deliberately uses a longer five, because committing a
           transfer is a longer-lived decision than picking a lineup — it passes
           its own horizon in rather than taking this default.

           These live here, in the shared engine, so the draft, the wizards and
           the recommender all sum the same per-gameweek projection instead of
           each growing a private one. */
        const XP_PLAN_HORIZON = 3;

        /* The next `n` gameweeks that have not kicked off yet, in order.
           `fromGW` lets the draft ask about a run starting at the gameweek being
           planned rather than at today. */
        function xpPlanGWs(n, fromGW) {
            const fixtures = (typeof allFixtures !== 'undefined' && allFixtures) || [];
            const started = new Set(fixtures
                .filter(f => f.event !== null && (f.started || f.finished_provisional))
                .map(f => f.event));
            const upcoming = [...new Set(fixtures
                .filter(f => f.event !== null && !f.finished_provisional && !started.has(f.event))
                .map(f => f.event))].sort((a, b) => a - b);
            const from = fromGW ? upcoming.filter(g => g >= fromGW) : upcoming;
            return from.slice(0, n === undefined ? XP_PLAN_HORIZON : n);
        }

        /* A player's projected total across a list of gameweeks. Blanks cost
           nothing extra to handle: projectPlayerPointsForGW returns 0 for a
           gameweek the player's team does not play in, and counts both fixtures
           of a double. */
        function xpOver(player, gws) {
            if (!player || !gws || !gws.length) return 0;
            const total = gws.reduce((s, g) => s + projectPlayerPointsForGW(player, g), 0);
            return Math.round(total * 10) / 10;
        }

        // Convenience for the common case: the next three, optionally from a gameweek.
        function xpNext3(player, fromGW) {
            return xpOver(player, xpPlanGWs(XP_PLAN_HORIZON, fromGW));
        }

        // A host page can call this before projecting to confirm the globals the
        // engine reads actually exist, rather than silently producing zeros.
        function xpEngineReady() {
            return typeof positionAverages !== 'undefined' && positionAverages
                && typeof teamAnalysis !== 'undefined' && teamAnalysis
                && typeof computePlayerGamesPlayed === 'function';
        }
