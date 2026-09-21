/* ============================================
   EasyFPL — Team xG, aggregated from the matches players actually played

   THE ONE IMPLEMENTATION. There were three, and they disagreed:

     players page   summed the per-gameweek history rows (this one)
     my-team page   summed bootstrap's season totals, in panels-and-tabs.js
     teams page     summed bootstrap's season totals, in its own inline block,
                    asynchronously, with its own fetch of players-data.json

   They are close but not equal, because bootstrap is refreshed every fifteen
   minutes while the per-gameweek history only lands with the four-hourly sweep.
   Mid-round the two feeds are hours apart: measured on GW5 data the gap was
   0.70 xG across twenty clubs, and 5.8% for Sunderland alone.

   WHY THE PER-GAMEWEEK SUM WINS, and it is not a matter of taste. ftTeamTrend()
   derives a club's earlier form by SUBTRACTION — (season total - recent window)
   / the matches left over. That arithmetic is only valid if both terms come from
   the same feed. Mixing them put Sunderland's prior xG at 1.07 a game against a
   true 1.35, a 21% understatement, and every point of that error lands straight
   in the "Team xG rising" delta, which is recent minus prior. A season total
   that is not the sum of its own per-gameweek parts cannot be subtracted from
   them.

   So: one feed, and seasonXg is by construction the sum of perGw. The cost is
   freshness — during a live gameweek this trails bootstrap until the sweep runs,
   which is the correct trade for a number that exists to be differenced.

   seasonXgc is the sum of xGC from matches a player finished (85+ minutes), so
   it is a per-90 figure rather than a per-appearance one.

   Published on `window` as well as in scope: the teams page reads perGw directly
   for its venue splits and recent-match strips, which are its own features and
   are not duplicated anywhere.
   ============================================ */

        // Filled by buildTeamXgData(); read through the two accessors below.
        let teamXgData = {};

        function buildTeamXgData(staticData, fixturesData) {
            const bootTeams = (staticData && staticData.teams) || [];
            /* No per-gameweek history is a real state — the sweep has not run
               yet, or the file failed to load. Every club then has hasPerGwData
               false and getTeamXgWindow returns null, which every caller already
               treats as "cannot be read". Better than half a season of zeroes. */
            const detail = (staticData && staticData.players) || [];
            bootTeams.forEach(t => {
                teamXgData[t.id] = {
                    seasonXg: 0, seasonXa: 0, seasonXgc: 0,
                    seasonGoals: 0, seasonAssists: 0, seasonConceded: 0, seasonGames: 0,
                    perGw: {}, hasPerGwData: false
                };
            });
            const finishedFx = fixturesData.filter(fixturePlayed);
            finishedFx.forEach(f => {
                if (teamXgData[f.team_h]) { teamXgData[f.team_h].seasonGames++; teamXgData[f.team_h].seasonConceded += f.team_a_score || 0; }
                if (teamXgData[f.team_a]) { teamXgData[f.team_a].seasonGames++; teamXgData[f.team_a].seasonConceded += f.team_h_score || 0; }
            });
            detail.forEach(player => {
                const tid = player.team;
                if (!teamXgData[tid]) return;
                (player.history || []).forEach(h => {
                    const gw = h.round;
                    const fk = h.fixture;
                    teamXgData[tid].seasonXg += parseFloat(h.expected_goals) || 0;
                    teamXgData[tid].seasonXa += parseFloat(h.expected_assists) || 0;
                    teamXgData[tid].seasonGoals += h.goals_scored || 0;
                    teamXgData[tid].seasonAssists += h.assists || 0;
                    if (!teamXgData[tid].perGw[gw]) {
                        teamXgData[tid].perGw[gw] = { xG: 0, xA: 0, xGC: 0, goals: 0, assists: 0, conceded: 0, wasHome: null, oppTeam: null, xGC_90min: 0, _fixtures: {} };
                    }
                    const d = teamXgData[tid].perGw[gw];
                    d.xG += parseFloat(h.expected_goals) || 0;
                    d.xA += parseFloat(h.expected_assists) || 0;
                    const tg = h.was_home ? (h.team_h_score || 0) : (h.team_a_score || 0);
                    const tc = h.was_home ? (h.team_a_score || 0) : (h.team_h_score || 0);
                    if (!d._fixtures[fk]) { d._fixtures[fk] = true; d.goals += tg; d.conceded += tc; }
                    d.wasHome = h.was_home; d.oppTeam = h.opponent_team;
                    if (h.minutes >= 85) {
                        const xgc = parseFloat(h.expected_goals_conceded) || 0;
                        const xk = `_xgc_${fk}`;
                        if (!d[xk]) { d[xk] = true; d.xGC_90min += xgc; }
                    }
                });
            });
            bootTeams.forEach(t => {
                const gwKeys = Object.keys(teamXgData[t.id].perGw);
                if (gwKeys.length > 0) {
                    teamXgData[t.id].hasPerGwData = true;
                    teamXgData[t.id].seasonXgc = gwKeys.reduce((sum, gw) => sum + teamXgData[t.id].perGw[gw].xGC_90min, 0);
                }
            });
            // The teams page reads perGw off window for its venue and recent-match
            // strips; everything else goes through the two accessors below.
            if (typeof window !== 'undefined') window.teamXgData = teamXgData;
        }


        function getTeamXgWindow(teamId, windowSize = 6) {
            const data = teamXgData[teamId];
            if (!data || !data.hasPerGwData) return null;
            const gws = Object.keys(data.perGw).map(Number).sort((a, b) => a - b);
            const recentGws = gws.slice(-windowSize);
            if (recentGws.length === 0) return null;
            const n = recentGws.length;
            const totals = recentGws.reduce((acc, gw) => {
                const d = data.perGw[gw];
                acc.xG += d.xG; acc.xA += d.xA; acc.xGC += d.xGC_90min;
                acc.goals += d.goals; acc.conceded += d.conceded;
                return acc;
            }, { xG: 0, xA: 0, xGC: 0, goals: 0, conceded: 0 });
            return {
                games: n, xGpg: totals.xG / n, xGCpg: totals.xGC / n,
                gpg: totals.goals / n, gapg: totals.conceded / n,
                totalXg: totals.xG, totalGoals: totals.goals,
                totalXgc: totals.xGC, totalConceded: totals.conceded
            };
        }


        function getTeamSeasonXg(teamId) {
            const data = teamXgData[teamId];
            if (!data) return null;
            const g = data.seasonGames || 1;
            return {
                games: data.seasonGames, xGpg: data.seasonXg / g, xGCpg: data.seasonXgc / g,
                gpg: data.seasonGoals / g, gapg: data.seasonConceded / g,
                totalXg: data.seasonXg, totalGoals: data.seasonGoals,
                totalXgc: data.seasonXgc, totalConceded: data.seasonConceded
            };
        }
