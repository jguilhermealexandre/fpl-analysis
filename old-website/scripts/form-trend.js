/* ============================================
   EasyFPL — Rising form: a player worth buying before everyone else does

   The question this answers is narrow, and it is worth stating exactly, because
   the old model answered a different one without saying so: WHO IS TRENDING UP,
   IS ACTUALLY PICKABLE IN THE NEXT MATCH OR TWO, AND HAS NOT ALREADY BEEN BOUGHT
   BY EVERYONE. Three clauses. A run of form nobody can use is a statistic; a
   good player at 45% ownership is not a find.

   WHAT WAS WRONG, measured against the real GW5 data rather than guessed at:

   1. Three of the six pillars could not fire at all. "Stats improving" needed
      six match rows when the season had five. "Team xG trend" and "regression
      due" needed a club to have played ten. Every player in the game scored
      0/667 on all three — not rarely, never. Half the model's weight (62 of a
      possible 130) was unreachable, so what remained was team form and
      fixtures: a club ranking wearing player names. Fifteen of the top twenty
      came from four clubs.

   2. The fixture signal was inverted. It compared the next three gameweeks with
      the three AFTER them and fired when the later window was kinder — which
      means it required the near fixtures to be worse, and it carried the
      heaviest weight in the model (x2.5). Every "Fixtures improving" flag on
      the board pointed at GW9 or later while the section claimed to be about
      the next week or two. The result was measurable: the top ten by score
      averaged FDR 3.5 over their next three, the bottom ten 2.4. The model
      ranked bad fixtures above good ones.

   3. Minutes were a gate, not a judgement. 180 minutes across five matches is
      36 a game, so a substitute cleared it, and "More minutes" then paid a
      bonus for rising from a low base — it fired for 22 players averaging 62
      minutes a game. Rotation risks were being promoted for being rotation
      risks.

   4. Ownership was absent. Nothing separated a 15%-owned midfielder from a
      0.3%-owned one, though only one of them is a find.

   HOW IT WORKS NOW. Every window is disjoint — a recent run against the matches
   before it, never against a season that contains it. Eligibility asks whether
   he is a starter today, not whether he once played enough minutes. The pillars
   are player-first and team-second, because a whole club arriving at once was
   the old failure. Then two multipliers: near-term fixtures, weighted so the
   next match counts most, and ownership, so a differential outranks a player
   the field already owns.

   WHAT THIS DOES NOT CLAIM. Ranking on GW1-4 and scoring against GW5 showed no
   points edge over the eligible pool for either the old model or this one — one
   gameweek and twenty players is far too small to measure that, and neither
   result should be read as evidence either way. What is verified is structural:
   the pillars fire, the fixture term points the right way, the minutes floor is
   real. Whether the ranking predicts points is a question for the snapshot and
   grading pipeline once it has ten to fifteen rounds behind it.

   Prefix rf* for the engine, ft* for the two helpers other files already call.
   Reads the page-local team model: getTeamXgWindow(), getTeamSeasonXg(),
   teamAnalysis, allFixtures.
   ============================================ */

        /* The recent window, and the least that can sit behind it. Three and two
           is the whole of it: three matches so one afternoon is not a trend, two
           behind them so "ahead of himself" compares two samples that share no
           match. Five rows total, which is also why the section can be read at
           all this early. */
        const RF_RECENT = 3;
        const RF_PRIOR = 2;

        /* A starter, now. The old 180-minutes-across-five gate let a 36-minute
           substitute through and the board filled with them. */
        const RF_MIN_MPG = 60;
        const RF_MIN_STARTS = 2;

        // A return has to be a return. With a prior window near zero, any
        // positive number is a 15% rise, which is how a blank run became "form".
        const RF_MIN_PPG = 3.0;
        const RF_UPLIFT = 1.15;

        // Before this a club's xG split is one match against one match.
        const RF_TEAM_MIN = 4;

        // Below this the pillars have fired too weakly to call anyone rising.
        const RF_SCORE_FLOOR = 8;
        const RF_MIN_SIGNALS = 2;

        /* Names the rest of the site already calls. FT_MIN_TREND was ten, which
           is what kept the team-xG pillar dark for the first ten gameweeks of
           every season; the window is disjoint now, so it does not need a season
           long enough to dilute itself. */
        const FT_MIN_RECENT = RF_RECENT;
        const FT_MIN_SEASON = RF_RECENT + RF_PRIOR;
        const FT_MIN_TREND = RF_TEAM_MIN;

        // "3 of the 5 matches this reading needs" — one phrasing, so the report
        // and the players page cannot describe the same gap two different ways.
        function ftShortfall(has, need, what) {
            return `${has} of the ${need} ${what} this reading needs`;
        }

        const RF_POS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };

        function rfNum(row, key) { return parseFloat(row && row[key]) || 0; }

        /* A player's recent matches against the ones before them.

           Nothing here compares a window with a season that contains it. That
           error is what made the old entry condition `l5PPG > seasonPPG * 1.15`
           unsatisfiable through GW5 — the last five games WERE the season, so it
           asked x > 1.15x and rejected all 610 eligible players. */
        function rfSplit(player, recentN) {
            const n = recentN || RF_RECENT;
            const rows = (player && player.history) || [];
            if (rows.length < n + RF_PRIOR) return null;
            const recent = rows.slice(-n), prior = rows.slice(0, -n);
            const avg = (rs, k) => rs.reduce((s, r) => s + rfNum(r, k), 0) / (rs.length || 1);
            const sum = (rs, k) => rs.reduce((s, r) => s + rfNum(r, k), 0);
            return {
                recent, prior, recentGames: n, priorGames: prior.length,
                ppgRecent: avg(recent, 'total_points'), ppgPrior: avg(prior, 'total_points'),
                mpgRecent: avg(recent, 'minutes'), mpgPrior: avg(prior, 'minutes'),
                minutesRecent: sum(recent, 'minutes'),
                xgiRecent: sum(recent, 'expected_goal_involvements'),
                startsRecent: recent.filter(r => rfNum(r, 'starts') >= 1).length
            };
        }

        function rfPerGame(rows, keys) {
            const out = {};
            keys.forEach(k => { out[k] = rows.reduce((s, r) => s + rfNum(r, k), 0) / (rows.length || 1); });
            return out;
        }

        /* Which numbers actually pay this position. xGC counts downward for the
           people paid to keep it out, which is what `invert` means. */
        const RF_METRICS = {
            GK: [{ k: 'expected_goals_conceded', w: 3, invert: true, label: 'xGC' },
                 { k: 'saves', w: 2, label: 'Saves' }],
            DEF: [{ k: 'expected_goals_conceded', w: 2.5, invert: true, label: 'xGC' },
                  { k: 'expected_goal_involvements', w: 2, label: 'xGI' },
                  { k: 'bps', w: 1, label: 'BPS' }],
            MID: [{ k: 'expected_goal_involvements', w: 3, label: 'xGI' },
                  { k: 'creativity', w: 1.5, label: 'Creativity' },
                  { k: 'threat', w: 1.5, label: 'Threat' }],
            FWD: [{ k: 'expected_goals', w: 3, label: 'xG' },
                  { k: 'expected_assists', w: 1.5, label: 'xA' },
                  { k: 'threat', w: 1.5, label: 'Threat' }]
        };

        /* The club's recent xG against the matches before it, or null with the
           reason. Disjoint, so it can be read from four matches instead of ten —
           the old version compared a six-match window against the season that
           contained it, which is why it needed a season long enough for the
           overlap not to matter, and why it never fired before GW10. */
        function ftTeamTrend(teamId, recentN) {
            if (typeof getTeamSeasonXg !== 'function' || typeof getTeamXgWindow !== 'function') {
                return { usable: false, played: null, need: RF_TEAM_MIN };
            }
            const n = recentN || RF_RECENT;
            const season = getTeamSeasonXg(teamId);
            const played = season ? (season.games || 0) : 0;
            if (!season || played < RF_TEAM_MIN) {
                return { usable: false, played, need: RF_TEAM_MIN, season };
            }
            const recent = getTeamXgWindow(teamId, n);
            if (!recent) return { usable: false, played, need: RF_TEAM_MIN, season };
            const priorGames = played - recent.games;
            if (priorGames < RF_PRIOR) {
                return { usable: false, played, need: RF_TEAM_MIN, season, recent };
            }
            const xgPrior = (season.totalXg - recent.totalXg) / priorGames;
            const xgcPrior = (season.totalXgc - recent.totalXgc) / priorGames;
            return {
                usable: true, played, need: RF_TEAM_MIN, season, recent,
                recentGames: recent.games, priorGames,
                xgRecent: recent.xGpg, xgPrior,
                xgcRecent: recent.xGCpg, xgcPrior,
                xgDelta: recent.xGpg - xgPrior,
                // Conceding fewer is the improving direction, so this is signed
                // the way the reader expects: positive is better.
                xgcDelta: xgcPrior - recent.xGCpg
            };
        }

        /* What his club has just played, so "fixtures easing" is a turn rather
           than a label. FDR comes off the fixture itself, which carries it for
           finished matches as well as future ones. */
        function rfRecentFdr(teamId, ctx) {
            const fixtures = (ctx && ctx.fixtures)
                || (typeof allFixtures !== 'undefined' ? allFixtures : null);
            if (!fixtures || !fixtures.length) return null;
            const mine = fixtures
                .filter(f => f.finished_provisional && (f.team_h === teamId || f.team_a === teamId))
                .sort((a, b) => (a.event || 0) - (b.event || 0))
                .slice(-RF_RECENT);
            if (mine.length < RF_PRIOR) return null;
            const total = mine.reduce((s, f) =>
                s + ((f.team_h === teamId ? f.team_h_difficulty : f.team_a_difficulty) || 3), 0);
            return total / mine.length;
        }

        /* The next three, weighted so the match in front of him counts most.

           A flat average over three is the wrong shape for a section about the
           next week or two: it lets a kind GW+3 excuse a brutal GW+1, which is
           precisely the trade a manager making one transfer cannot take. */
        function rfFixtureOutlook(player, ctx) {
            const next = (player && player.fixtures && player.fixtures.next3) || [];
            if (!next.length) return null;
            const weights = [3, 2, 1];
            let num = 0, den = 0;
            next.slice(0, 3).forEach((f, i) => {
                const w = weights[i] || 1;
                num += (f.difficulty || 3) * w;
                den += w;
            });
            const fdrNear = den ? num / den : 3;
            const fdrPast = rfRecentFdr(player.teamId, ctx);
            return {
                fdrNear, fdrPast,
                turn: fdrPast == null ? null : fdrPast - fdrNear,
                next: next.slice(0, 3)
            };
        }

        /* Fixtures as a multiplier rather than a bonus.

           A bonus can only ever promote, which is how a player with FDR 4.0 in
           front of him sat above one with 2.3: the hard run simply earned
           nothing instead of costing anything. Neutral at 3. */
        function rfFixtureFactor(fdrNear) {
            const f = (typeof fdrNear === 'number' && isFinite(fdrNear)) ? fdrNear : 3;
            return Math.max(0.55, Math.min(1.35, 1.6 - 0.2 * f));
        }

        /* The differential tilt. Modest on purpose — being unowned is a reason
           to look, not a reason to buy, and a multiplier this size reorders the
           board without inventing a case for anyone.

           Unknown ownership is neutral, not maximal: absent data must not read
           as "nobody owns him". */
        function rfOwnershipFactor(ownership) {
            const own = Number(ownership);
            if (!isFinite(own)) return 1;
            return Math.max(0.80, Math.min(1.25, 1.25 - 0.012 * own));
        }

        /* Can this player be read, and is he worth reading? Returns null when he
           passes, or the sentence saying why not. */
        function rfBlocked(player, split) {
            const pos = RF_POS[player.position];
            if (!split) {
                const rows = (player.history || []).length;
                return `Rising form compares a recent run against the matches before it, and there is not enough season yet — ${ftShortfall(rows, RF_RECENT + RF_PRIOR, 'matches')}.`;
            }
            if (split.mpgRecent < RF_MIN_MPG) {
                return `Not playing enough to be worth buying — ${split.mpgRecent.toFixed(0)} minutes a game across his last ${split.recentGames}.`;
            }
            if (split.startsRecent < RF_MIN_STARTS) {
                return `Started ${split.startsRecent} of his last ${split.recentGames} — too close to a rotation risk to call a trend.`;
            }
            if (split.ppgRecent < RF_MIN_PPG) {
                return `Returns are up but still small — ${split.ppgRecent.toFixed(1)} points a game across his last ${split.recentGames}.`;
            }
            if (split.ppgRecent <= split.ppgPrior * RF_UPLIFT) {
                return `Not running ahead of himself (${split.ppgRecent.toFixed(1)} against ${split.ppgPrior.toFixed(1)} per match before that).`;
            }
            if (pos === 'MID' || pos === 'FWD') {
                const xgi90 = split.xgiRecent / ((split.minutesRecent || 1) / 90);
                if (xgi90 <= 0.2) {
                    return `Points are up but the chances are not — ${xgi90.toFixed(2)} xGI per 90 in the window.`;
                }
            }
            return null;
        }

        /* The pillars. Player's own numbers first and heaviest; his club second
           and lighter, because team-level terms are what made the old board four
           clubs deep. */
        /* Each signal names an icon rather than carrying its markup. The
           version of this that lived in the page put `<i data-lucide=...>`
           strings inside the model, which is how a data engine ends up owning a
           rendering detail — and how the section broke when the engine moved out
           and the tag came with it. */
        function rfPillars(player, split, ctx) {
            const pos = RF_POS[player.position];
            const isDefPos = (pos === 'GK' || pos === 'DEF');
            const signals = [];
            let score = 0;

            /* 1 — his points are accelerating.

               Halved when one match is most of the window. Three games is a
               short enough sample that a single haul carries the average on its
               own — 2, 1 and 17 reads as 6.7 a game, which is a real number and
               a misleading one. The run is not dismissed, because the pillar
               below asks whether the chances were there too; it just stops
               being worth as much as three even returns. Same rule purple-patch
               applies over five, at the share a three-match window needs. */
            const ptsGap = split.ppgRecent - split.ppgPrior;
            if (ptsGap > 1) {
                const pts = split.recent.map(r => rfNum(r, 'total_points'));
                const total = pts.reduce((s, v) => s + v, 0);
                const oneHaul = total > 0 && Math.max.apply(null, pts) > total * 0.6;
                const v = Math.min(14, ptsGap * 2.2) * (oneHaul ? 0.5 : 1);
                score += v;
                signals.push({ label: 'Points trending up', icon: 'flame', color: '#FB923C',
                    detail: oneHaul
                        ? `${split.ppgPrior.toFixed(1)} → ${split.ppgRecent.toFixed(1)} pts/g, on one big score`
                        : `${split.ppgPrior.toFixed(1)} → ${split.ppgRecent.toFixed(1)} pts/g`,
                    strength: Math.min(10, v) });
            }

            // 2 — and the numbers underneath them are too. Same disjoint split,
            // so this fires from five matches instead of needing six.
            const metrics = RF_METRICS[pos] || RF_METRICS.MID;
            const keys = metrics.map(m => m.k);
            const now = rfPerGame(split.recent, keys);
            const before = rfPerGame(split.prior, keys);
            let uplift = 0;
            const parts = [];
            metrics.forEach(m => {
                const base = before[m.k] || 0;
                const val = now[m.k] || 0;
                if (base <= 0.01) return;               // nothing to be a rise above
                const pct = m.invert ? (base - val) / base : (val - base) / base;
                if (pct > 0) {
                    uplift += pct * m.w * 4;
                    if (pct > 0.10) parts.push(`${m.label} +${(pct * 100).toFixed(0)}%`);
                }
            });
            if (uplift > 0) {
                const v = Math.min(18, uplift);
                score += v;
                if (parts.length) {
                    signals.push({ label: 'Stats improving', icon: 'zap', color: '#FBBF24',
                        detail: parts.slice(0, 2).join(', '), strength: Math.min(10, v) });
                }
            }

            // 3 — minutes. The level first: a trend off a low base is a
            // substitute having a good week, not a player worth buying.
            if (split.mpgRecent >= RF_MIN_MPG) {
                score += Math.min(6, ((split.mpgRecent - RF_MIN_MPG) / 30) * 6);
                if (split.mpgRecent > split.mpgPrior + 10) {
                    const v = Math.min(6, ((split.mpgRecent - split.mpgPrior) / 25) * 6);
                    score += v;
                    signals.push({ label: 'More minutes', icon: 'clock', color: '#A78BFA',
                        detail: `${split.mpgPrior.toFixed(0)} → ${split.mpgRecent.toFixed(0)} mpg`,
                        strength: Math.min(10, v) });
                }
            }

            // 4 — his club is winning. Deliberately light.
            const ts = player.teamScores
                || ((typeof teamAnalysis !== 'undefined' && teamAnalysis) ? teamAnalysis[player.teamId] : null);
            if (ts && ts.formRating > 55) {
                const v = Math.min(8, ((ts.formRating - 55) / 45) * 8) * 0.8;
                score += v;
                signals.push({ label: 'Team in form', icon: 'trending-up', color: '#4ADE80',
                    detail: `${ts.wins}W ${ts.draws}D ${ts.losses}L`,
                    strength: Math.min(10, v) });
            }

            // 5 — and creating (or conceding) at a different rate than before.
            const trend = ftTeamTrend(player.teamId);
            if (trend.usable) {
                const delta = isDefPos ? trend.xgcDelta : trend.xgDelta;
                if (delta > 0.10) {
                    const v = Math.min(10, (delta / 0.5) * 10);
                    score += v;
                    signals.push({
                        label: isDefPos ? 'Team xGC improving' : 'Team xG rising',
                        icon: isDefPos ? 'shield-check' : 'circle-dot',
                        color: '#34D399',
                        // The sample is named because at this stage it is small.
                        detail: isDefPos
                            ? `${trend.xgcRecent.toFixed(2)} xGC/g over ${trend.recentGames}, against ${trend.xgcPrior.toFixed(2)} over ${trend.priorGames}`
                            : `${trend.xgRecent.toFixed(2)} xG/g over ${trend.recentGames}, against ${trend.xgPrior.toFixed(2)} over ${trend.priorGames}`,
                        strength: Math.min(10, v) });
                }
            }

            // 6 — the club is due a correction. Scaled to matches played, so the
            // bar is not a fixed number of goals that only a long season reaches.
            const seasonXg = (typeof getTeamSeasonXg === 'function') ? getTeamSeasonXg(player.teamId) : null;
            if (seasonXg && seasonXg.games >= RF_TEAM_MIN) {
                const gap = isDefPos
                    ? (seasonXg.totalConceded - seasonXg.totalXgc)
                    : (seasonXg.totalXg - seasonXg.totalGoals);
                if (gap > seasonXg.games * 0.3) {
                    const v = Math.min(8, (gap / (seasonXg.games * 0.6)) * 8) * 0.8;
                    score += v;
                    signals.push({
                        label: isDefPos ? 'CS regression due' : 'Goals regression due',
                        icon: 'refresh-cw',
                        color: '#C084FC',
                        detail: isDefPos
                            ? `${seasonXg.totalConceded} conceded against ${seasonXg.totalXgc.toFixed(1)} xGC in ${seasonXg.games}`
                            : `${seasonXg.totalGoals} scored against ${seasonXg.totalXg.toFixed(1)} xG in ${seasonXg.games}`,
                        strength: Math.min(10, v) });
                }
            }

            // 7 — the fixtures have turned, measured against what he has just
            // had rather than against a window three gameweeks further out.
            const outlook = rfFixtureOutlook(player, ctx);
            if (outlook && outlook.turn != null && outlook.turn > 0.3) {
                const v = Math.min(8, outlook.turn * 4);
                score += v;
                signals.push({ label: 'Fixtures easing', icon: 'calendar', color: '#60A5FA',
                    detail: `FDR ${outlook.fdrPast.toFixed(1)} behind him, ${outlook.fdrNear.toFixed(1)} in front`,
                    strength: Math.min(10, v) });
            } else if (outlook && outlook.fdrNear <= 2.5) {
                const v = Math.min(6, (3 - outlook.fdrNear) * 5);
                score += v;
                signals.push({ label: 'Kind run now', icon: 'circle-check', color: '#4ADE80',
                    detail: `FDR ${outlook.fdrNear.toFixed(1)} over the next three`,
                    strength: Math.min(10, v) });
            }

            return { score, signals, outlook };
        }

        /* Is this player's form rising, and can we tell?

           Returns { measurable, score, signals, note, ... }. When measurable is
           false the score is null rather than 0 — a player nobody can measure has
           not scored zero, and the two must not render the same. */
        function rfEvaluate(player, ctx) {
            const blocked = (note) => ({ measurable: false, score: null, signals: [], note });
            if (!player) return blocked('No player to read.');

            /* Availability first, and as a hard block rather than a reading.
               Whether a man who is injured was in form is answerable and beside
               the point: this section is about the next match or two, and for
               him there is not one to describe. */
            if (player.status && player.status !== 'a') {
                return blocked('Not currently available, so recent form is not a guide to the next few weeks.');
            }
            /* A flagged doubt is not a player to plan a transfer around, however
               well he has been playing. FPL publishes the percentage; anything
               it has not flagged comes back null and passes. */
            if (player.chanceNextRound != null && player.chanceNextRound < 75) {
                return blocked(`Carrying a doubt — ${player.chanceNextRound}% to play, which is not a transfer to plan around.`);
            }

            const split = rfSplit(player);
            const why = rfBlocked(player, split);
            if (why) {
                // "Not enough season yet" is a different answer from "he is not
                // on a run", and only the first is unmeasurable.
                return split ? { measurable: true, score: null, signals: [], note: why } : blocked(why);
            }

            const { score: raw, signals, outlook } = rfPillars(player, split, ctx);

            const fixtureFactor = rfFixtureFactor(outlook ? outlook.fdrNear : 3);
            const ownershipFactor = rfOwnershipFactor(player.selectedBy);
            const score = Math.min(100, raw * fixtureFactor * ownershipFactor);

            /* Shown rather than folded in silently: a reader looking at a
               0.3%-owned defender above a 20%-owned one deserves to see which
               term put him there. */
            const own = Number(player.selectedBy);
            if (isFinite(own) && own <= 5) {
                signals.push({ label: 'Under the radar', icon: 'eye-off', color: '#F472B6',
                    detail: `${own.toFixed(1)}% owned`, strength: Math.min(10, (5 - own) * 2) });
            }

            if (signals.length < RF_MIN_SIGNALS || score < RF_SCORE_FLOOR) {
                return { measurable: true, score: null, signals,
                    note: 'Ahead of his own recent run, but not enough is moving behind it to call him rising.' };
            }
            return {
                measurable: true, score, signals, note: null,
                split, fixtureFactor, ownershipFactor,
                fdrNear: outlook ? outlook.fdrNear : null
            };
        }

        // The name the scouting report and the players page already call.
        function risingFormFor(player) { return rfEvaluate(player); }

        /* The whole pool, for the players page's Rising Form section and for the
           scouting report's cross-wiring. Carries the reason the map is empty, so
           an empty section can say why instead of looking broken. */
        function risingFormScores(analyses) {
            const out = {};
            let note = null, measurable = 0;
            (analyses || []).forEach(p => {
                const rf = rfEvaluate(p);
                if (!rf.measurable && !note) note = rf.note;
                if (rf.measurable) measurable++;
                if (rf.score != null) out[p.id] = rf.score;
            });
            return { scores: out, note: measurable ? null : note, measurable };
        }

        /* The pool, ranked, for the section that draws cards. One call so the
           section and the scouting report cannot disagree about who is rising. */
        function risingFormRanked(analyses, ctx) {
            const rows = [];
            (analyses || []).forEach(p => {
                const rf = rfEvaluate(p, ctx);
                if (rf.score == null) return;
                rows.push(Object.assign({}, p, {
                    pos: RF_POS[p.position],
                    signals: rf.signals,
                    signalCount: rf.signals.length,
                    risingScore: rf.score,
                    fdrNear: rf.fdrNear
                }));
            });
            return rows.sort((a, b) => b.risingScore - a.risingScore);
        }
