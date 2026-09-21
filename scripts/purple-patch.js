/* ============================================
   EasyFPL — Purple patches, and whether they will hold

   A purple patch is a player scoring well above his own season. The useful
   question is never whether the run happened — the points table says that — but
   whether the process underneath it did: chances taken at the rate chances are
   normally taken, a defence actually keeping the ball out rather than riding
   its luck, minutes that are not about to be rotated away. calculateSustainability
   scores that across six dimensions and says which of them is carrying the run.

   WHY IT MOVED. All of this lived in the players page's inline block, so the AI
   Scouting Report — which runs on two pages — could not reach it, and the squad
   page had no purple-patch reading at all. Same fault window._routesData and
   window._risingFormScores had, and the same fix: one definition, both pages.

   The gates are real and they are strict: four matches in the recent window,
   270 minutes, eight matches of season to compare against. Four gameweeks into
   a season nobody clears the last of those, so purplePatchFor() reports that it
   cannot be read rather than returning nothing and letting the caller render an
   empty box. A blank panel that cannot say why looks broken.

   Prefix pp* for the new entry point; the three functions below keep the names
   they had, because the players page calls them by those names.
   ============================================ */

        // What a run has to clear before it is a run at all. Four matches and 270
        // minutes so it is not one good afternoon, and eight matches of season so
        // there is something to be above.
        const PP_MIN_RECENT = 4, PP_MIN_MINUTES = 270, PP_MIN_SEASON = 8;

        /* Demo mode is a players-page feature and its helpers live there. The
           squad page has neither, and asking for them would be a ReferenceError
           rather than a missing flag — so this answers false where they are
           absent, which is the normal-season path. */
        function ppDemo() {
            return typeof demoPreview === 'function' ? demoPreview() : false;
        }

        function recentPPGForStreak(p) {
            if (ppDemo() && (p.season?.games || 0) <= 5) {
                const recent = (p.history || []).slice(-demoRecentWindow());
                const n = recent.length || 1;
                return {
                    ppg: recent.reduce((s, g) => s + (parseFloat(g.total_points) || 0), 0) / n,
                    games: n
                };
            }
            const g = p.l5?.games || 1;
            return { ppg: (p.l5?.points || 0) / g, games: g };
        }

        /* Recent form against what came BEFORE it, as two disjoint samples.
         *
         * Rising Form used to gate on "last five PPG beats season PPG by 15%".
         * Through GW5 the last five games ARE the season, so that read x > 1.15x
         * and rejected all 610 eligible players — the section was empty by
         * construction, not because nobody was in form. Even later in the season
         * the season average contains the window being compared against it,
         * which flattens the signal all year.
         *
         * Splitting the history instead asks the same question of two samples
         * that share no match, which is the comparison the section's own signals
         * already make (points and minutes both read L3 against the prior two).
         * Returns null when there is not enough season to split, so the caller
         * can say "too young" rather than quietly pass everyone.
         */
        function risingPpgSplit(p, recentN) {
            const n = recentN || 3;
            const rows = (p && p.history) || [];
            // A prior window of one match is a coin toss, not a baseline.
            if (rows.length < n + 2) return null;
            const ppg = rs => rs.reduce((s, g) => s + (parseFloat(g.total_points) || 0), 0) / (rs.length || 1);
            return {
                recent: ppg(rows.slice(-n)),
                prior: ppg(rows.slice(0, -n)),
                recentGames: n,
                priorGames: rows.length - n
            };
        }

        function detectPurplePatch(p) {
            const posMap = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
            const pos = posMap[p.position];
            const l5Games = p.l5?.games || 0;
            const seasonGames = p.season?.games || 0;
            const l5Mins = p.l5?.minutes || 0;

            // Must have played meaningfully: ≥4 L5 games, ≥270 mins, ≥8 season games
            // — scaled to the season played so far in demo mode, see demoPreview().
            const demo = ppDemo();
            const minRecentGames = demo ? Math.min(4, seasonGames) : 4;
            const minRecentMinutes = demo ? 90 * Math.min(3, seasonGames) : 270;
            const minSeasonGames = demo ? Math.min(8, seasonGames) : 8;
            if (l5Games < minRecentGames || l5Mins < minRecentMinutes || seasonGames < minSeasonGames) return null;
            // Must be available
            if (p.status !== 'a') return null;

            // Recent form over the window the streak is measured on — shortened
            // below the season baseline in a demo, or the uplift test below is
            // comparing a number with itself. See recentPPGForStreak().
            const recentForm = recentPPGForStreak(p);
            const recentGames = recentForm.games;
            const l5PPG = recentForm.ppg;
            const seasonPPG = (p.season?.points || 0) / seasonGames;

            // Position-specific minimum PPG thresholds
            const minPPG = { GK: 4.0, DEF: 4.5, MID: 5.0, FWD: 5.0 };

            // Uplift test: L5 PPG ≥ season × 1.35 AND above position minimum
            const upliftPass = l5PPG >= seasonPPG * 1.35 && l5PPG >= (minPPG[pos] || 5.0);
            // Absolute elite test: L5 PPG ≥ 7.0 regardless
            const elitePass = l5PPG >= 7.0;

            if (!upliftPass && !elitePass) return null;

            const uplift = seasonPPG > 0 ? ((l5PPG - seasonPPG) / seasonPPG) : 0;

            return {
                pos,
                uplift,
                l5PPG,
                seasonPPG,
                patchGames: recentGames,
                isElite: elitePass
            };
        }

        function calculateSustainability(p, patch) {
            const history = p.history || [];
            const l5 = history.slice(-5);
            const l5Games = l5.length || 1;
            const seasonGames = p.season?.games || 1;
            const pos = patch.pos;
            const isDefPos = (pos === 'GK' || pos === 'DEF');

            const dimensions = {};
            const signals = [];

            // ── A. xG Alignment (0-25) ──────────────────────────────
            let dimA = 0;
            if (isDefPos) {
                // Defensive: low xGC per game = sustainable CS returns
                const l5xGCpg = l5.reduce((s, g) => s + (parseFloat(g.expected_goals_conceded) || 0), 0) / l5Games;
                const l5GCpg = l5.reduce((s, g) => s + (parseFloat(g.goals_conceded) || 0), 0) / l5Games;
                if (l5xGCpg <= 1.0) dimA += 15;
                else if (l5xGCpg <= 1.3) dimA += 10;
                else dimA += 5;
                // Actual vs expected alignment
                const gcRatio = l5GCpg > 0.01 ? l5xGCpg / l5GCpg : 1;
                if (gcRatio >= 0.8 && gcRatio <= 1.2) { dimA += 10; signals.push({ text: '✓ xGC-aligned clean sheets', positive: true }); }
                else if (gcRatio < 0.8) { dimA += 3; signals.push({ text: 'Conceding less than xGC (lucky)', positive: false }); }
                else { dimA += 6; }
            } else {
                // Attacking: goals/assists vs xG/xA ratio
                const l5Goals = l5.reduce((s, g) => s + (parseFloat(g.goals_scored) || 0), 0);
                const l5xG = l5.reduce((s, g) => s + (parseFloat(g.expected_goals) || 0), 0);
                const l5Assists = l5.reduce((s, g) => s + (parseFloat(g.assists) || 0), 0);
                const l5xA = l5.reduce((s, g) => s + (parseFloat(g.expected_assists) || 0), 0);

                const goalRatio = l5xG > 0.1 ? l5Goals / l5xG : 1;
                const assistRatio = l5xA > 0.1 ? l5Assists / l5xA : 1;

                // Goals alignment (0-13)
                if (goalRatio <= 1.2) { dimA += 13; signals.push({ text: '✓ xG-backed goals', positive: true }); }
                else if (goalRatio <= 1.5) { dimA += 8; }
                else { dimA += 3; signals.push({ text: 'Goals outpacing xG', positive: false }); }

                // Assists alignment (0-12)
                if (assistRatio <= 1.2) { dimA += 12; signals.push({ text: '✓ xA-backed assists', positive: true }); }
                else if (assistRatio <= 1.5) { dimA += 7; }
                else { dimA += 2; signals.push({ text: 'Assists outpacing xA', positive: false }); }
            }
            dimensions.xgAlignment = { score: Math.min(25, dimA), max: 25, label: 'xG Alignment' };

            // ── B. Underlying Quality (0-20) ────────────────────────
            let dimB = 0;
            const l5BPSpg = l5.reduce((s, g) => s + (parseFloat(g.bps) || 0), 0) / l5Games;
            const seasonBPSpg = (p.season?.bps || 0) / seasonGames;

            // BPS trend (0-10)
            if (seasonBPSpg > 0) {
                const bpsRatio = l5BPSpg / seasonBPSpg;
                if (bpsRatio >= 1.15) { dimB += 10; signals.push({ text: '✓ BPS trending up', positive: true }); }
                else if (bpsRatio >= 1.0) dimB += 7;
                else if (bpsRatio >= 0.85) dimB += 4;
                else { dimB += 1; signals.push({ text: 'BPS declining', positive: false }); }
            }

            // ICT position-specific (0-10)
            const l5ICTpg = isDefPos
                ? l5.reduce((s, g) => s + (parseFloat(g.influence) || 0), 0) / l5Games
                : l5.reduce((s, g) => s + (parseFloat(g.threat) || 0), 0) / l5Games;
            const seasonICTpg = isDefPos
                ? (p.season?.influence || 0) / seasonGames
                : (p.season?.threat || 0) / seasonGames;

            if (seasonICTpg > 0) {
                const ictRatio = l5ICTpg / seasonICTpg;
                if (ictRatio >= 1.15) dimB += 10;
                else if (ictRatio >= 1.0) dimB += 7;
                else if (ictRatio >= 0.85) dimB += 4;
                else dimB += 1;
            }
            dimensions.quality = { score: Math.min(20, dimB), max: 20, label: 'Underlying Quality' };

            // ── C. Minutes Stability (0-15) ─────────────────────────
            let dimC = 0;
            const l5AvgMins = l5.reduce((s, g) => s + (parseFloat(g.minutes) || 0), 0) / l5Games;
            const allStarts = l5.every(g => (parseFloat(g.starts) || 0) >= 1);

            if (l5AvgMins >= 85) { dimC = 15; signals.push({ text: '✓ Nailed on', positive: true }); }
            else if (l5AvgMins >= 70) dimC = 10;
            else if (l5AvgMins >= 60) { dimC = 5; signals.push({ text: 'Rotation risk', positive: false }); }
            else { dimC = 0; signals.push({ text: 'Low minutes', positive: false }); }

            if (allStarts && dimC < 15) dimC = Math.min(15, dimC + 3);
            dimensions.minutes = { score: dimC, max: 15, label: 'Minutes Stability' };

            // ── D. Fixture Context (0-15) ───────────────────────────
            let dimD = 0;
            const l5FDR = l5.map(g => {
                const oppTeam = parseInt(g.opponent_team);
                const teamData = teamAnalysis[oppTeam];
                return teamData ? (parseFloat(g.was_home) ? (teamData.attackPowerAway || 50) : (teamData.attackPower || 50)) / 50 * 3 : 3;
            });
            const avgL5FDR = l5FDR.reduce((s, v) => s + v, 0) / l5FDR.length;
            const upcomingFDR = p.fixtures?.avgFDR3 || 3;

            // Did it the hard way? High L5 FDR = sustainable
            if (avgL5FDR >= 3.2) { dimD += 10; signals.push({ text: '✓ Delivered in tough fixtures', positive: true }); }
            else if (avgL5FDR >= 2.8) dimD += 7;
            else if (avgL5FDR >= 2.3) dimD += 4;
            else { dimD += 1; signals.push({ text: 'Soft fixtures inflated', positive: false }); }

            // Upcoming fixtures bonus/penalty
            if (upcomingFDR <= 2.5) dimD += 5;
            else if (upcomingFDR <= 3.0) dimD += 3;
            else if (upcomingFDR >= 4.0 && avgL5FDR < 2.5) { dimD = Math.max(0, dimD - 2); signals.push({ text: 'Hard fixtures ahead', positive: false }); }
            dimensions.fixtures = { score: Math.min(15, dimD), max: 15, label: 'Fixture Context' };

            // ── E. Team Alignment (0-10) ─────────────────────────────
            let dimE = 0;
            const ts = p.teamScores;
            if (ts) {
                if (ts.formRating > 60) {
                    dimE += 8;
                    // Team xG trend bonus
                    const seasonXg = getTeamSeasonXg(p.teamId);
                    const recent6Xg = getTeamXgWindow(p.teamId, 6);
                    if (recent6Xg && seasonXg && seasonXg.games >= 10) {
                        const xgDelta = isDefPos
                            ? (seasonXg.xGCpg - recent6Xg.xGCpg)
                            : (recent6Xg.xGpg - seasonXg.xGpg);
                        if (xgDelta > 0.05) dimE += 2;
                    }
                    signals.push({ text: '✓ Team momentum aligned', positive: true });
                } else if (ts.formRating > 40) {
                    dimE += 5;
                } else {
                    dimE += 3;
                    signals.push({ text: 'Excelling despite poor team form', positive: false });
                }
            } else {
                dimE += 5;
            }
            dimensions.team = { score: Math.min(10, dimE), max: 10, label: 'Team Alignment' };

            // ── F. Consistency Profile (0-15) ────────────────────────
            let dimF = 0;

            // Season PPG baseline (0-6): higher baseline = more sustainable
            if (patch.seasonPPG >= 5.0) dimF += 6;
            else if (patch.seasonPPG >= 4.0) dimF += 4;
            else if (patch.seasonPPG >= 3.0) dimF += 2;

            // L5 points variance (0-5): low std dev = consistent
            const l5Pts = l5.map(g => parseFloat(g.total_points) || 0);
            const l5Mean = l5Pts.reduce((s, v) => s + v, 0) / l5Pts.length;
            const l5Variance = l5Pts.reduce((s, v) => s + (v - l5Mean) ** 2, 0) / l5Pts.length;
            const l5StdDev = Math.sqrt(l5Variance);
            const cv = l5Mean > 0 ? l5StdDev / l5Mean : 1;
            if (cv <= 0.4) { dimF += 5; signals.push({ text: '✓ Consistent returns', positive: true }); }
            else if (cv <= 0.6) dimF += 3;
            else dimF += 1;

            // One-haul detection (0-4): any GW > 40% of L5 total = flag
            const l5Total = l5Pts.reduce((s, v) => s + v, 0);
            const maxGW = Math.max(...l5Pts);
            const oneHaul = l5Total > 0 && maxGW > l5Total * 0.4;
            if (!oneHaul) { dimF += 4; }
            else { signals.push({ text: 'One big haul inflating avg', positive: false }); }

            dimensions.consistency = { score: Math.min(15, dimF), max: 15, label: 'Consistency Profile' };

            // ── Total score & verdict ─────────────────────────────────
            const totalScore = Object.values(dimensions).reduce((s, d) => s + d.score, 0);
            let verdict, verdictColor;
            if (totalScore >= 70) { verdict = 'SUSTAINABLE'; verdictColor = '#4ADE80'; }
            else if (totalScore >= 50) { verdict = 'MONITOR'; verdictColor = '#FBBF24'; }
            else { verdict = 'FADING'; verdictColor = '#F87171'; }

            // Generate verdict text from strongest signals
            const positiveSignals = signals.filter(s => s.positive);
            const negativeSignals = signals.filter(s => !s.positive);
            let verdictText = '';
            if (verdict === 'SUSTAINABLE') {
                verdictText = positiveSignals.length > 0
                    ? `Returns backed by ${positiveSignals.slice(0, 2).map(s => s.text.replace('✓ ', '').toLowerCase()).join(' and ')}. Strong buy at £${p.price.toFixed(1)}m.`
                    : `Solid underlying process supports continued returns at this level.`;
            } else if (verdict === 'MONITOR') {
                verdictText = negativeSignals.length > 0
                    ? `Watch for: ${negativeSignals.slice(0, 2).map(s => s.text.replace(`${v2Icon('warn')} `, '').toLowerCase()).join(', ')}. Hold if owned, wait for more data before buying.`
                    : `Mixed signals — form may persist but sustainability isn't certain.`;
            } else {
                verdictText = negativeSignals.length > 0
                    ? `Regression likely: ${negativeSignals.slice(0, 2).map(s => s.text.replace(`${v2Icon('warn')} `, '').toLowerCase()).join(', ')}. Sell/avoid at £${p.price.toFixed(1)}m.`
                    : `Hot streak not backed by underlying process — expect regression.`;
            }

            return { totalScore, verdict, verdictColor, verdictText, dimensions, signals, oneHaul };
        }

        /* The report's way in: a patch with its sustainability, or the reason
           there is nothing to show. Mirrors risingFormFor() in
           scripts/form-trend.js — `measurable` false means the season is too
           short to ask, which is a different answer from "he is not on a run". */
        function purplePatchFor(player) {
            const seasonGames = player.season?.games || 0;
            const recentGames = player.l5?.games || 0;
            const recentMins = player.l5?.minutes || 0;
            const demo = ppDemo();
            const needSeason = demo ? Math.min(PP_MIN_SEASON, seasonGames) : PP_MIN_SEASON;

            if (seasonGames < needSeason) {
                return { measurable: false, patch: null, sustainability: null,
                    note: `A purple patch is a run measured against a player's own season, and there is not enough season yet — ${seasonGames} of the ${PP_MIN_SEASON} matches this needs.` };
            }
            if (recentGames < (demo ? Math.min(PP_MIN_RECENT, seasonGames) : PP_MIN_RECENT)
                || recentMins < (demo ? 90 * Math.min(3, seasonGames) : PP_MIN_MINUTES)) {
                return { measurable: false, patch: null, sustainability: null,
                    note: 'Not enough recent football to call a run — fewer than four matches or 270 minutes in the window.' };
            }
            if (player.status && player.status !== 'a') {
                return { measurable: false, patch: null, sustainability: null,
                    note: 'Not currently available, so a hot run is not a guide to the next few weeks.' };
            }

            const patch = detectPurplePatch(player);
            if (!patch) {
                return { measurable: true, patch: null, sustainability: null,
                    note: 'Scoring in line with his own season — no run to sustain.' };
            }
            return { measurable: true, patch,
                sustainability: calculateSustainability(player, patch), note: null };
        }
