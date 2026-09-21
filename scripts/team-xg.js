/* ============================================
   EasyFPL — Team xG, aggregated from the matches players actually played

   Lifted out of the players page's inline block so it can be run outside a
   browser. tools/snapshot-predictions.mjs needs exactly this to archive what
   Rising Form said at a deadline, and a model whose inputs only exist inside one
   HTML file cannot be graded afterwards.

   NOT the only implementation on the site, and the difference matters:
   scripts/panels-and-tabs.js builds seasonXg from bootstrap's season totals for
   anyone with minutes, while this sums the per-gameweek history rows. They give
   different numbers. Only the my-team page loads that one and only the players
   page loads this one, so nothing reads both — but they should be one function,
   and are not yet.

   seasonXgc is the sum of xGC from matches a player finished (85+ minutes), so
   it is a per-90 figure rather than a per-appearance one.
   ============================================ */

        // Filled by buildTeamXgData(); read through the two accessors below.
        let teamXgData = {};

        function buildTeamXgData(staticData, fixturesData) {
            const bootTeams = staticData.teams;
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
            (staticData.players || []).forEach(player => {
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
            console.log('\ud83c\udfaf Team xG data built for', bootTeams.length, 'teams');
        }


        function getTeamXgWindow(teamId, windowSize) {
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
