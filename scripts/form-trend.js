/* ============================================
   EasyFPL — Rising form, and knowing when it cannot be read

   A player is "rising" when his recent returns are running ahead of his own
   season, his club is playing better than its season, and his fixtures are
   turning. All three are comparisons of a short window against a longer one,
   which means none of them says anything until the longer one exists.

   WHAT WAS WRONG. The gates were right and their failure was silent. The score
   required six matches this season, so four gameweeks in it returned early for
   every player in the game and window._risingFormScores was an empty object —
   every Rising Form Score in the scouting report read 0, and the Rising Form
   section was blank with no explanation. The team xG pillar required ten and so
   could not fire until GW10. And xpBuildTeamScores defaulted xgTrend/xgcTrend to
   the string 'stable' behind the same ten-game gate, so the report printed
   "stable" as a finding about clubs nobody had measured.

   Zero, blank and "stable" are all answers. None of them is the way to say "not
   enough football has been played yet", which is why this returns `measurable`
   and a sentence saying what is missing rather than a number that looks like a
   reading.

   It was also page-local. precomputeRisingFormScores lived in the players page's
   inline block, so on Squad Analysis the scouting report's rising-form rows were
   empty on every player — the same fault window._routesData had, for the same
   reason. One definition, loaded by both pages.

   Prefix ft*. Reads the page-local team model the report already documents:
   getTeamXgWindow(), getTeamSeasonXg(), teamAnalysis, fixtureSwingData.
   ============================================ */

        /* What each reading needs before it is a reading.

           RECENT and SEASON are about the player: three matches to have a recent
           form at all, six so that "ahead of his season" compares against
           something. TREND is about his club, and is higher because it compares
           a six-match window against the season that contains it — at ten games
           the window is already most of the sample, and below that it is
           comparing a number with itself. */
        const FT_MIN_RECENT = 3;
        const FT_MIN_SEASON = 6;
        const FT_MIN_TREND = 10;
        // Below this the pillars have fired too weakly to call anyone rising.
        const FT_SCORE_FLOOR = 6;

        /* The club's recent xG against its own season, or null with the reason.
           Shared by the player score, the report's signals and the team-context
           card, so all three agree about whether the question can be answered. */
        function ftTeamTrend(teamId) {
            if (typeof getTeamSeasonXg !== 'function' || typeof getTeamXgWindow !== 'function') {
                return { usable: false, played: null, need: FT_MIN_TREND };
            }
            const season = getTeamSeasonXg(teamId);
            const recent = getTeamXgWindow(teamId, 6);
            const played = season ? (season.games || 0) : 0;
            if (!season || !recent || played < FT_MIN_TREND) {
                return { usable: false, played, need: FT_MIN_TREND, season, recent };
            }
            return {
                usable: true, played, need: FT_MIN_TREND, season, recent,
                xgDelta: recent.xGpg - season.xGpg,
                // Conceding less than the season is the improving direction, so
                // this is signed the way the reader expects: positive is better.
                xgcDelta: season.xGCpg - recent.xGCpg
            };
        }

        // "3 of the 6 matches this needs" — one phrasing, so the report and the
        // players page cannot describe the same gap two different ways.
        function ftShortfall(has, need, what) {
            return `${has} of the ${need} ${what} this reading needs`;
        }

        /* Is this player's form rising, and can we tell?

           Returns { measurable, score, signals, note }. When measurable is false
           the score is null rather than 0 — a player nobody can measure has not
           scored zero, and the two must not render the same. */
        function risingFormFor(player) {
            const posMap = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
            const pos = posMap[player.position];
            const isDefPos = (pos === 'GK' || pos === 'DEF');
            const recentGames = player.l5?.games || 0;
            const seasonGames = player.season?.games || 0;

            const blocked = (note) => ({ measurable: false, score: null, signals: [], note });

            if (seasonGames < FT_MIN_SEASON) {
                return blocked(`Rising form compares recent returns against the season, and there is not enough season yet — ${ftShortfall(seasonGames, FT_MIN_SEASON, 'matches')}.`);
            }
            if (recentGames < FT_MIN_RECENT) {
                return blocked(`Not enough recent football to read a trend — ${ftShortfall(recentGames, FT_MIN_RECENT, 'recent matches')}.`);
            }
            if ((player.l5?.minutes || 0) < 180) {
                return blocked('Under 180 minutes in the window — too little pitch time for a trend to mean anything.');
            }
            if (player.status && player.status !== 'a') {
                return blocked('Not currently available, so recent form is not a guide to the next few weeks.');
            }

            // The entry condition: he has to actually be ahead of himself.
            const recentPPG = (player.l5?.points || 0) / (recentGames || 1);
            const seasonPPG = (player.season?.points || 0) / (seasonGames || 1);
            if (recentPPG <= seasonPPG * 1.15) {
                return { measurable: true, score: null, signals: [],
                    note: `Recent returns are not running ahead of his season (${recentPPG.toFixed(1)} against ${seasonPPG.toFixed(1)} per match).` };
            }
            // An attacker whose extra points are not coming from chances is on a
            // run of bonus and clean sheets, which is not the same thing.
            if (pos === 'MID' || pos === 'FWD') {
                const xgi90 = (player.l5?.xGI || 0) / ((player.l5?.minutes || 1) / 90);
                if (xgi90 <= 0.2) {
                    return { measurable: true, score: null, signals: [],
                        note: `Points are up but the chances are not — ${xgi90.toFixed(2)} xGI per 90 in the window.` };
                }
            }

            const signals = [];
            let score = 0;

            // Pillar 1 — the club is playing well.
            const ts = (typeof teamAnalysis !== 'undefined' && teamAnalysis) ? teamAnalysis[player.teamId] : null;
            if (ts && ts.wins != null && ts.matchesPlayed) {
                const ppg = (ts.wins * 3 + ts.draws) / Math.max(1, ts.matchesPlayed);
                if (ppg >= 1.6) {
                    score += Math.min(9, (ppg - 1.6) / 1.4 * 9) * 1.5;
                    signals.push({ label: 'Team winning', color: '#4ADE80',
                        detail: `${ts.wins}W ${ts.draws}D ${ts.losses}L — ${ppg.toFixed(1)} points a game`,
                        strength: Math.min(10, (ppg / 3) * 10) });
                }
            }

            // Pillar 1b — the club's xG is moving, if that can be read yet.
            const trend = ftTeamTrend(player.teamId);
            if (trend.usable) {
                const delta = isDefPos ? trend.xgcDelta : trend.xgDelta;
                if (delta > 0.10) {
                    score += Math.min(10, (delta / 0.6) * 10) * 2;
                    signals.push({
                        label: isDefPos ? 'Team conceding fewer chances' : 'Team creating more chances',
                        color: '#34D399',
                        detail: isDefPos
                            ? `${trend.recent.xGCpg.toFixed(2)} xGC a game over six, against ${trend.season.xGCpg.toFixed(2)} for the season`
                            : `${trend.recent.xGpg.toFixed(2)} xG a game over six, against ${trend.season.xGpg.toFixed(2)} for the season`,
                        strength: Math.min(10, (delta / 0.6) * 10) });
                }
            }

            // Pillar 2 — the fixtures are turning.
            const swing = (typeof fixtureSwingData !== 'undefined' && fixtureSwingData)
                ? fixtureSwingData[player.teamId] : null;
            if (swing && swing.direction === 'improving') {
                score += Math.min(10, Math.abs(swing.swing) * 4) * 2.5;
                signals.push({ label: 'Fixtures improving', color: '#60A5FA',
                    detail: `FDR ${swing.currentFdr} → ${swing.futureFdr}`,
                    strength: Math.min(10, Math.abs(swing.swing) * 4) });
            }
            const avgFdr = player.fixtures?.avgFDR3 || 3;
            if (avgFdr <= 2.5) {
                score += Math.min(8, (3 - avgFdr) * 6) * 1.2;
                signals.push({ label: 'Kind run now', color: '#4ADE80',
                    detail: `FDR ${avgFdr.toFixed(1)} over the next three`,
                    strength: Math.min(10, (3 - avgFdr) * 6) });
            }

            // Pillar 3 — his own points are accelerating inside the window.
            const history = player.history || [];
            const played = history.filter(g => (parseFloat(g.minutes) || 0) > 0);
            if (played.length >= 5) {
                const pts = played.slice(-5).map(g => parseFloat(g.total_points) || 0);
                const recent3 = pts.slice(-3).reduce((s, v) => s + v, 0) / 3;
                const prior2 = pts.slice(0, 2).reduce((s, v) => s + v, 0) / 2;
                if (recent3 > prior2 + 1) {
                    score += Math.min(8, (recent3 - prior2) * 1.5);
                    signals.push({ label: 'Returns accelerating', color: '#FBBF24',
                        detail: `${recent3.toFixed(1)} a game in his last three, against ${prior2.toFixed(1)} before that`,
                        strength: Math.min(10, (recent3 - prior2) * 1.5) });
                }
            }

            if (score < FT_SCORE_FLOOR) {
                return { measurable: true, score: null, signals,
                    note: 'Ahead of his own season, but nothing behind it is moving — no team trend, no fixture swing.' };
            }
            return { measurable: true, score, signals, note: null };
        }

        /* The whole pool, for the players page's Rising Form section and for the
           scouting report's cross-wiring. Carries the reason the map is empty, so
           an empty section can say why instead of looking broken. */
        function risingFormScores(analyses) {
            const out = {};
            let note = null, measurable = 0;
            (analyses || []).forEach(p => {
                const rf = risingFormFor(p);
                if (!rf.measurable && !note) note = rf.note;
                if (rf.measurable) measurable++;
                if (rf.score != null) out[p.id] = rf.score;
            });
            return { scores: out, note: measurable ? null : note, measurable };
        }
