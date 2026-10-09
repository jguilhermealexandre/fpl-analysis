/* ============================================
   EasyFPL — My Team Analysis
   The Gameweek Review: what actually happened to your squad in the round
   just played, as opposed to every other panel on this page, which is about
   the rounds still to come.

   Reads reviewPicksData (the squad as it was submitted for currentGW — NOT
   picksData, which by then has next week's transfers in it), the per-GW
   rows in players-data.json, and the event totals FPL publishes in
   bootstrap-static. Nothing here projects anything.

   Plain classic script like the rest: every function is a global, and the
   inline onclick= handlers depend on that.
   ============================================ */

        // Per-gameweek rows for one player. Returns an array because a double
        // gameweek genuinely has two, and summing them is the caller's job.
        function gwRowsFor(playerId, gw) {
            const rows = (playersDetailData?.players || []).find(p => p.id === playerId)?.history || [];
            return rows.filter(h => h.round === gw);
        }

        // Has this player's team actually played in this gameweek yet? Distinguishes
        // "did not play" from "has not played", which are different sentences.
        function gwFixturePlayed(teamId, gw) {
            const fx = (allFixtures || []).filter(f => f.event === gw &&
                (f.team_h === teamId || f.team_a === teamId));
            return fx.length > 0 && fx.every(f => f.finished_provisional);
        }

        function gwHasStarted(gw) {
            return (allFixtures || []).some(f => f.event === gw && f.finished_provisional);
        }

        /* The fresh source. data/event-live.json is one trimmed copy of
           event/{gw}/live/, rewritten every 15 minutes by refresh-live-data.yml,
           where the per-GW rows inside players-data.json only arrive with the
           four-hourly job that walks 610 element-summary endpoints. A goal scored
           at 16:20 showed up here within a quarter of an hour and in the history
           file some hours later, so this is preferred whenever it covers the
           gameweek being asked about. */
        let eventLiveData = null;
        function setEventLiveData(d) { eventLiveData = d || null; }

        const GWR_LIVE_KEYS = { pts: 'total_points', min: 'minutes', st: 'starts', g: 'goals_scored',
            a: 'assists', b: 'bonus', cs: 'clean_sheets', gc: 'goals_conceded', sv: 'saves',
            ps: 'penalties_saved', pm: 'penalties_missed', og: 'own_goals', yc: 'yellow_cards',
            rc: 'red_cards', bps: 'bps', dc: 'defensive_contribution' };

        // A live row expanded into the same shape a history row has, so both
        // sources can go through one code path below.
        function gwLiveRow(playerId, gw) {
            if (!eventLiveData || eventLiveData.event !== gw) return null;
            const row = eventLiveData.elements?.[playerId] ?? eventLiveData.elements?.[String(playerId)];
            if (!row) return null;
            const out = {};
            Object.keys(GWR_LIVE_KEYS).forEach(k => { out[GWR_LIVE_KEYS[k]] = row[k] || 0; });
            return out;
        }

        // The fixtures a team played in a gameweek, straight from fixtures.json —
        // which the same 15-minute job keeps current, so opponent and scoreline
        // stay in step with the stats above rather than lagging behind them.
        function gwTeamFixtures(teamId, gw) {
            return (allFixtures || [])
                .filter(f => f.event === gw && (f.team_h === teamId || f.team_a === teamId))
                .map(f => {
                    const home = f.team_h === teamId;
                    const oppId = home ? f.team_a : f.team_h;
                    const hasScore = f.team_h_score != null && f.team_a_score != null;
                    return {
                        name: teams[oppId]?.short_name || '?',
                        home,
                        scoreline: hasScore ? `${f.team_h_score}-${f.team_a_score}` : null,
                        result: !hasScore ? null
                            : Math.sign(home ? f.team_h_score - f.team_a_score
                                             : f.team_a_score - f.team_h_score),
                        played: !!f.finished_provisional
                    };
                });
        }

        // Totalled stats for a player's gameweek, or null if there is no row at all.
        function gwPlayerStats(player, gw) {
            const live = gwLiveRow(player.id, gw);
            const rows = live ? [live] : gwRowsFor(player.id, gw);
            if (!rows.length) return null;
            const sum = k => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
            // The live feed carries no opponent, so fixtures.json supplies it for
            // both sources — one way of naming the opponent, not two.
            const opponents = live
                ? gwTeamFixtures(player.teamId, gw)
                : rows.map(r => {
                    const opp = teams[r.opponent_team];
                    const scoreline = (r.team_h_score != null && r.team_a_score != null)
                        ? `${r.team_h_score}-${r.team_a_score}` : null;
                    return {
                        name: opp?.short_name || '?',
                        home: !!r.was_home,
                        scoreline,
                        // Result from this player's perspective.
                        result: scoreline == null ? null
                            : (r.was_home ? Math.sign(r.team_h_score - r.team_a_score)
                                          : Math.sign(r.team_a_score - r.team_h_score))
                    };
                });
            return {
                source: live ? 'live' : 'history',
                points: sum('total_points'), minutes: sum('minutes'), starts: sum('starts'),
                goals: sum('goals_scored'), assists: sum('assists'), bonus: sum('bonus'),
                cleanSheets: sum('clean_sheets'), goalsConceded: sum('goals_conceded'),
                saves: sum('saves'), penaltiesSaved: sum('penalties_saved'),
                penaltiesMissed: sum('penalties_missed'), ownGoals: sum('own_goals'),
                yellow: sum('yellow_cards'), red: sum('red_cards'), bps: sum('bps'),
                defCon: sum('defensive_contribution'),
                xG: sum('expected_goals'), xA: sum('expected_assists'),
                // Counted off the fixtures, not the rows: the live feed already
                // sums both halves of a double into a single row, so rows.length
                // alone would report every double gameweek as a single.
                fixtures: opponents, isDouble: opponents.length > 1 || rows.length > 1
            };
        }

        // The one-line "what he did" used both in the review table and in the
        // player's own AI Report card.
        function gwStatPhrases(player, s) {
            const bits = [];
            if (s.goals) bits.push(`${s.goals} goal${s.goals > 1 ? 's' : ''}`);
            if (s.assists) bits.push(`${s.assists} assist${s.assists > 1 ? 's' : ''}`);
            if (player.position <= 2 && s.cleanSheets) bits.push('clean sheet');
            if (player.position === 1 && s.saves) bits.push(`${s.saves} save${s.saves > 1 ? 's' : ''}`);
            if (s.penaltiesSaved) bits.push(`${s.penaltiesSaved} penalty saved`);
            if (player.position <= 2 && !s.cleanSheets && s.goalsConceded >= 2) bits.push(`${s.goalsConceded} conceded`);
            if (s.bonus) bits.push(`${s.bonus} bonus`);
            if (s.penaltiesMissed) bits.push('penalty missed');
            if (s.ownGoals) bits.push(`${s.ownGoals} own goal${s.ownGoals > 1 ? 's' : ''}`);
            if (s.red) bits.push('sent off');
            else if (s.yellow) bits.push('booked');
            return bits;
        }

        function gwOpponentPhrase(s) {
            return s.fixtures.map(f => {
                const res = f.result === null ? '' : f.result > 0 ? ' (won)' : f.result < 0 ? ' (lost)' : ' (drew)';
                return `${f.home ? 'at home to' : 'away at'} ${escHTML(f.name)}${f.scoreline ? ` ${f.scoreline}` : ''}${res}`;
            }).join(' and ');
        }

        /* Two lines on a player's gameweek, for the inline AI Report card. Every
           other number on that card is season-to-date or a projection, so "what
           did he actually just do" had nowhere to live. */
        function gwPlayerReportLine(player, gw) {
            if (!gw || !player) return '';
            const s = gwPlayerStats(player, gw);
            const played = gwFixturePlayed(player.teamId, gw);

            if (!s || (!s.minutes && !played)) {
                const next = (teamFixtures6?.[player.teamId] || []).find(f => f.event === gw);
                return `<div class="gwr-line pending">GW${gw} — not played yet${next ? `, ${next.isHome ? 'at home to' : 'away at'} ${escHTML(next.opponent || '?')}` : ''}.</div>`;
            }
            if (!s.minutes) {
                return `<div class="gwr-line blank">GW${gw} · 0 pts — did not get on ${gwOpponentPhrase(s)}.</div>`;
            }

            const phrases = gwStatPhrases(player, s);
            const cls = s.points >= 8 ? 'haul' : s.points >= 5 ? 'good' : s.points <= 1 ? 'blank' : '';
            const mins = `${s.minutes} min${s.minutes === 1 ? '' : 's'}${s.starts ? '' : ' off the bench'}`;
            return `<div class="gwr-line ${cls}">
                <strong>GW${gw} · ${s.points} pt${s.points === 1 ? '' : 's'}</strong> — ${mins} ${gwOpponentPhrase(s)}${phrases.length ? `. ${escHTML(phrases.join(', '))}` : ''}.
                ${s.isDouble ? ' <em>Double gameweek.</em>' : ''}
            </div>`;
        }

        // ===== THE REVIEW =====

        /* The squad that played the round, not the squad being planned.

           picksData holds the second of those from the moment a round ends:
           transfers made for the next gameweek are replayed into it so every
           forward-looking panel works on the real team (see
           applyPendingTransfers() in scripts/common.js). Reviewing with it would
           credit last weekend's points to players who were not in the squad when
           they were scored — and blank the ones who were. reviewPicksData is the
           untouched response for currentGW, kept for exactly this. */
        function gwReviewPicks() {
            return (typeof reviewPicksData !== 'undefined' && reviewPicksData) || picksData || null;
        }

        // Only ever the gameweek the review picks describe. Reviewing an earlier
        // round would pair this week's squad with last week's scores.
        function gwReviewTarget() {
            const src = gwReviewPicks();
            if (!src || !src.picks || !currentGW) return null;
            return gwHasStarted(currentGW) ? currentGW : null;
        }

        /* ===== What the week did to your RANK, rather than to your score =====
         *
         * A gameweek score is not a result. Rank moves on the gap between what
         * you got and what the field got, and the field's holding of a player is
         * his effective ownership — the share of teams that own him, counting a
         * captain twice. For one player:
         *
         *     swing = (your multiplier - EO/100) x his points
         *
         * Own a 120% EO player once and his goal LOSES you ground: the average
         * team in that tier had 1.2 of him and you had 1. Captain him and you
         * gain. Do not own him at all and you drop his whole share. That last
         * case is why the sum walks players outside the squad too — the week's
         * biggest rank move is often something you did not have.
         *
         * THREE THINGS KEEP THIS HONEST.
         *
         * It is a SAMPLE. Each tier is four hundred managers, so the resolution
         * is 0.25%. eoFor() marks anything under that `below`, and a player too
         * rare for the sample to see is skipped rather than counted as nought —
         * "no owners" and "fewer than one in four hundred" are different claims.
         *
         * It must be THE SAME GAMEWEEK. data/eo.json carries the event it was
         * sampled for, and ownership moves every week. Explaining GW5 with GW6's
         * ownership would be a true number about the wrong week, which costs as
         * much trust as a false one. If the two disagree this returns null and
         * the section does not render at all.
         *
         * And it is ARITHMETIC, not a projection. His points come from the live
         * feed, your multiplier from your own picks, his EO from the sample.
         * Nothing here is modelled. */
        function gwEoSwings(gw, entries, tier) {
            if (typeof eoReady !== 'function' || !eoReady() || typeof eoFor !== 'function') return null;
            const meta = typeof eoMeta === 'function' ? eoMeta() : null;
            if (!meta || meta.event !== gw) return null;

            const t = tier || (typeof EO_DEFAULT_TIER !== 'undefined' ? EO_DEFAULT_TIER : 'top10k');
            const mine = new Map();
            (entries || []).forEach(e => mine.set(e.player.id, e));

            const read = (playerId) => {
                const v = eoFor(playerId, t);
                return (v && !v.below && typeof v.eo === 'number') ? v : null;
            };

            const rows = [];
            /* Yours first, including those who scored nothing: a blank from a
               player the field was heavily on is a rank GAIN, and that is the
               least intuitive line on the page. */
            mine.forEach((e) => {
                const v = read(e.player.id);
                if (!v) return;
                const mult = e.multiplier || 0;
                rows.push({ player: e.player, points: e.raw, mult, eo: v.eo, owned: true,
                    swing: (mult - v.eo / 100) * e.raw });
            });
            /* Then everyone the sample knows that you did not have, who actually
               scored — a blank you missed moved nobody. */
            const pool = (typeof eoData !== 'undefined' && eoData && eoData.players) || {};
            Object.keys(pool).forEach(key => {
                const id = Number(key);
                if (!Number.isFinite(id) || mine.has(id)) return;
                const player = allPlayersById[id];
                if (!player) return;
                const st = gwPlayerStats(player, gw);
                const pts = st ? st.points : 0;
                if (!pts) return;
                const v = read(id);
                if (!v) return;
                rows.push({ player, points: pts, mult: 0, eo: v.eo, owned: false,
                    swing: -(v.eo / 100) * pts });
            });

            if (!rows.length) return null;
            rows.sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing));
            const net = rows.reduce((sum, x) => sum + x.swing, 0);

            /* Nothing actually moved. A round where every swing rounds to
               nothing — nobody in the sample scored, or your holdings matched
               the field exactly — would otherwise render a section announcing
               "worth +0.0 points of ground" above an empty list. A heading with
               no finding under it reads as something broken rather than as a
               quiet week. */
            const gained = rows.filter(x => x.swing >= 0.05);
            const lost = rows.filter(x => x.swing <= -0.05);
            if (!gained.length && !lost.length) return null;

            const tierMeta = (meta.tiers || []).find(x => x.id === t);
            return {
                tier: t,
                tierLabel: typeof eoTierLabel === 'function' ? eoTierLabel(t) : t,
                sampled: tierMeta ? tierMeta.sampled : null,
                resolution: typeof eoResolution === 'function' ? eoResolution(t) : null,
                net: Math.round(net * 10) / 10,
                gained: gained.slice(0, 3),
                lost: lost.slice(0, 3)
            };
        }

        /* ===== Transfer ROI: what the week's moves actually returned =====
         *
         * ONE ASSUMPTION, AND IT IS ON SCREEN RATHER THAN BURIED HERE. The player
         * sold is credited with the points he scored that weekend, as though he
         * would have kept the same place in the eleven. That is a counterfactual,
         * and it is the only one available: a squad that was not picked has no
         * auto-substitutions, no bench order and no captain to resolve, so there
         * is no honest way to say what your TOTAL would have been. This therefore
         * compares the two PLAYERS, and the copy says exactly that.
         *
         * The hit comes off the sum and not off any single move. Four points are
         * charged to the gameweek; charging them to whichever transfer happened
         * to return least would be a judgement dressed up as arithmetic.
         *
         * Whether the incoming player actually counted is reported separately,
         * because it is knowable and it changes the reading: a 12-point haul on
         * your bench did not win you the week. */
        function gwTransferROI(gw, log, hit, entries) {
            const made = (log || [])
                .filter(t => t && t.event === gw && t.element_in != null && t.element_out != null)
                // Oldest first. Only the display order below depends on it, but a
                // single transfer should read as the transfer it was.
                .sort((a, b) => Date.parse(a.time || 0) - Date.parse(b.time || 0));
            if (!made.length) return null;

            /* NET, NOT CHRONOLOGICAL, and this is the whole difficulty of the
               function.

               A transfer log is a list of edits, not a list of transfers. Replaying
               it pairwise reports every edit, which is wrong twice over: a player
               bought and then sold again before the deadline was never owned, and —
               worse — a player sold and then bought BACK through a different slot
               gets reported as both an arrival and a departure, so his points are
               credited once and charged once against a manager who still owns him.

               The user's real GW4 wildcard is exactly this case. Thirty log rows;
               a pairwise replay made ten moves of them and had Groß arriving for
               +15 and leaving for −14 in the same list. The truth is eight moves:
               ten players went out and came back and belong in neither column.

               So the net sets come from a flow count — +1 for every arrival, −1 for
               every departure — and a round trip cancels to nought by
               construction. */
            const flow = new Map();
            made.forEach(t => {
                flow.set(t.element_in, (flow.get(t.element_in) || 0) + 1);
                flow.set(t.element_out, (flow.get(t.element_out) || 0) - 1);
            });
            const arrivedIds = [], leftIds = [];
            flow.forEach((n, id) => { if (n > 0) arrivedIds.push(id); else if (n < 0) leftIds.push(id); });
            // Every edit undone: a squad that ended the week as it started.
            if (!arrivedIds.length) return null;

            /* Pairing is a presentation choice, and it is made WITHIN POSITION.
               A squad always holds two keepers, five defenders, five midfielders
               and three forwards, so the two net sets necessarily have the same
               shape, and pairing a departing defender with an arriving one is the
               only reading that describes something a manager did. Which defender
               with which is arbitrary; the total does not depend on it.

               Departures go in the order they appear in the log so that an
               ordinary one- or two-transfer week reads as the exact swap it was. */
            const resolve = (ids) => ids.map(id => allPlayersById[id]).filter(Boolean);
            const arrived = resolve(arrivedIds);
            const outOrder = [];
            made.forEach(t => {
                if (flow.get(t.element_out) < 0 && !outOrder.includes(t.element_out)) outOrder.push(t.element_out);
            });
            leftIds.forEach(id => { if (!outOrder.includes(id)) outOrder.push(id); });
            const left = resolve(outOrder);

            const mine = new Map();
            (entries || []).forEach(e => mine.set(e.player.id, e));
            const pointsOf = (p) => { const s = gwPlayerStats(p, gw); return s ? s.points : 0; };

            const pool = arrived.slice();
            const moves = [];
            left.forEach(pOut => {
                let k = pool.findIndex(p => p.position === pOut.position);
                // No arrival in his position left to pair with. Only reachable if
                // FPL has dropped a player out of the pool mid-season, which makes
                // the two sets different sizes; counted below rather than paired
                // with somebody in the wrong position.
                if (k < 0) return;
                const pIn = pool.splice(k, 1)[0];
                const inPts = pointsOf(pIn), outPts = pointsOf(pOut);
                const e = mine.get(pIn.id);
                moves.push({
                    in: pIn, out: pOut, inPts, outPts, delta: inPts - outPts,
                    /* Whether he counted towards your score. Knowable, and it
                       changes the reading: a haul on your bench did not win you
                       the week. null when he is not in the reviewed squad at all. */
                    mult: e ? (e.multiplier || 0) : null,
                    counted: e ? (e.multiplier || 0) > 0 : null
                });
            });
            if (!moves.length) return null;

            const gross = moves.reduce((s, m) => s + m.delta, 0);
            moves.sort((a, b) => b.delta - a.delta);
            return {
                moves, gross, hit: hit || 0, net: gross - (hit || 0),
                /* Net moves this could not score, so the copy can say the list is
                   short rather than letting the lines quietly fail to add up. */
                unscored: Math.max(arrivedIds.length, leftIds.length) - moves.length
            };
        }

        /* ===== Luck: what the model expected of this eleven, against what it got
         * =====
         *
         * A gameweek score is a selection plus a week of variance, and the two ask
         * for opposite responses. A squad that beat its own projection does not
         * need fixing. One that missed it by twenty might not either. Telling them
         * apart needs the projection AS IT STOOD BEFORE THE ROUND, and that is the
         * whole difficulty: scripts/xp-engine.js reads
         * data/bootstrap-static.json, which is overwritten every fifteen minutes,
         * so running it over a played round today answers a different question
         * about a different squad — form, prices, availability and the per-90
         * rates have all moved on.
         *
         * So this reads one thing and has no fallback: data/model-log/gw{N}.json,
         * sealed by tools/snapshot-predictions.mjs inside the twenty-four hours
         * before the deadline and never edited afterwards.
         *
         * WHY NO FALLBACK. Re-projecting the round now and presenting it as the
         * prediction would yield a number for every gameweek, including every one
         * nobody actually predicted — and it would read identically to an honest
         * one. That is worse than silence, because a reader cannot tell the
         * difference. No snapshot, no section.
         *
         * GRADED ON THE ELEVEN THAT WAS SUBMITTED, not on the multipliers that
         * came out of the round. An auto-substitution sets a starter's multiplier
         * to zero, and reading the realised multiplier would therefore delete that
         * player's projection from the expected total — quietly discarding exactly
         * the predictions that failed and flattering every result. The forecast
         * was made about the team the manager submitted, so that is the team it is
         * scored against. */
        function gwSubmittedMultiplier(e, chip) {
            // Bench Boost pays all fifteen; otherwise only the eleven named.
            if (!e.started && chip !== 'bboost') return 0;
            if (!e.isCaptain) return 1;
            return chip === '3xc' ? 3 : 2;
        }

        function gwLuckRating(gw, entries, snap, opts) {
            const o = opts || {};
            /* A part-played round has no expectation to compare against: the xP
               is for every fixture in the week and the points are only for the
               ones that have finished, so the gap would measure the clock. */
            if (!o.complete) return null;
            if (!snap || !Array.isArray(snap.players)) return null;
            if (Number(snap.gw) !== Number(gw)) return null;

            const xpById = new Map();
            snap.players.forEach(r => {
                if (r && r.id != null && typeof r.xp === 'number') xpById.set(Number(r.id), r.xp);
            });
            if (!xpById.size) return null;

            const chip = o.chip || null;
            let expected = 0, actual = 0, missing = 0;
            const rows = [];
            (entries || []).forEach(e => {
                const mult = gwSubmittedMultiplier(e, chip);
                if (!mult) return;
                const xp = xpById.get(e.player.id);
                /* A player the snapshot has no projection for — one the engine
                   could not build at that deadline. Counted and reported, never
                   treated as a projection of zero. */
                if (xp == null) { missing++; return; }
                expected += xp * mult;
                actual += e.raw * mult;
                rows.push({ player: e.player, mult, xp, raw: e.raw, delta: (e.raw - xp) * mult });
            });
            if (!rows.length) return null;

            rows.sort((a, b) => b.delta - a.delta);
            const r1 = (v) => Math.round(v * 10) / 10;
            return {
                expected: r1(expected), actual, delta: r1(actual - expected),
                graded: rows.length, missing,
                takenAt: snap.takenAt || null,
                hoursBefore: snap.hoursBeforeDeadline ?? null,
                over: rows.filter(x => x.delta >= 1).slice(0, 3),
                under: rows.filter(x => x.delta <= -1).slice(-3).reverse()
            };
        }

        function buildGameweekReview() {
            const gw = gwReviewTarget();
            if (!gw) return null;

            const src = gwReviewPicks();
            const ev = (typeof gwEvents !== 'undefined' ? gwEvents : []).find(e => e.id === gw) || {};
            const eh = src.entry_history || {};
            const histRows = managerHistory?.current || [];
            const thisRow = histRows.find(r => r.event === gw) || eh;
            const prevRow = histRows.find(r => r.event === gw - 1) || null;

            const fixtures = (allFixtures || []).filter(f => f.event === gw);
            const done = fixtures.filter(f => f.finished_provisional).length;

            // Every pick, with what it actually returned.
            const entries = src.picks.map(pick => {
                const player = allPlayersById[pick.element];
                if (!player) return null;
                const s = gwPlayerStats(player, gw);
                const raw = s ? s.points : 0;
                return {
                    player, pick, stats: s,
                    started: pick.position <= 11,
                    multiplier: pick.multiplier,
                    raw,
                    scored: raw * (pick.multiplier || 0),
                    isCaptain: !!pick.is_captain,
                    isVice: !!pick.is_vice_captain,
                    played: gwFixturePlayed(player.teamId, gw)
                };
            }).filter(Boolean);

            /* Split on where the player was picked, not on whether he ended up
               counting. Multiplier was doing that job, and it is a different
               question: a starter withdrawn by an auto-sub has a multiplier of
               zero and was never on your bench, while the substitute who
               replaced him has a multiplier of one and was. So the bench listed
               your ghosted starters, "The bench" hid the players who actually
               came off it, and `autoSubbed` below — filtering a
               multiplier === 0 list for multiplier > 0 — could never match
               anything, which is why no auto-substitution was ever reported. */
            const xi = entries.filter(e => e.started);
            const bench = entries.filter(e => !e.started);
            const captain = entries.find(e => e.isCaptain) || null;
            const benchBoost = src.active_chip === 'bboost';

            // What the armband could have returned instead. Only counts players who
            // actually started for you — second-guessing against your own bench is a
            // different and less useful question.
            const capAlternatives = xi.filter(e => !e.isCaptain).sort((a, b) => b.raw - a.raw);
            const bestCapAlt = capAlternatives[0] || null;

            const ranked = [...xi].sort((a, b) => b.scored - a.scored);
            const benchRanked = [...bench].sort((a, b) => b.raw - a.raw);

            const points = thisRow.points != null ? thisRow.points : null;
            const avg = ev.average_entry_score != null ? ev.average_entry_score : null;
            const hit = thisRow.event_transfers_cost || 0;

            return {
                gw, ev, complete: done === fixtures.length, done, total: fixtures.length,
                points, avg, highest: ev.highest_score ?? null, hit, benchBoost,
                transfers: thisRow.event_transfers || 0,
                benchPoints: thisRow.points_on_bench || 0,
                overallRank: thisRow.overall_rank ?? null,
                prevOverallRank: prevRow?.overall_rank ?? null,
                chip: src.active_chip || null,
                entries, xi, bench, captain, bestCapAlt, ranked, benchRanked,
                /* Optional, like everything else that leans on a second source:
                   managerTransferLog is fetched with a .catch in
                   scripts/team-analysis-core.js, and without it this is null and
                   the section does not render. */
                roi: gwTransferROI(gw, typeof managerTransferLog !== 'undefined' ? managerTransferLog : null, hit, entries),
                mostCaptained: ev.most_captained ? allPlayersById[ev.most_captained] : null,
                mostCaptainedStats: ev.most_captained ? gwPlayerStats(allPlayersById[ev.most_captained] || {}, gw) : null,
                topElement: ev.top_element_info || null,
                topElementPlayer: ev.top_element_info ? allPlayersById[ev.top_element_info.id] : null,
                eo: gwEoSwings(gw, entries, null)
            };
        }

        /* ===== JUDGEMENT =====

           A list of what happened is a scorecard. What a manager wants to know is
           whether the calls were right, and a call is not judged by its outcome:
           captaining the highest-projected player in your squad is correct even
           when he blanks, and a punt that comes off was still a punt. Each verdict
           below therefore separates the decision from the result, and only says
           "mistake" where the information needed was available beforehand. */

        function gwCaptainVerdict(r) {
            const c = r.captain;
            if (!c) return null;
            const mult = c.multiplier || 2;
            const alt = r.bestCapAlt;
            const gain = alt ? (c.raw - alt.raw) * mult : 0;
            const fieldCap = r.mostCaptainedStats ? r.mostCaptainedStats.points : null;
            const vsField = fieldCap != null ? (c.raw - fieldCap) * mult : null;

            let tone, verdict, lesson;
            if (!c.played) {
                tone = 'pending'; verdict = 'Still to play.';
                lesson = 'Judgement waits until the fixture is done.';
            } else if (!c.stats || !c.stats.minutes) {
                tone = 'bad';
                verdict = `${escHTML(c.player.name)} did not get on the pitch, so the armband returned nothing.`;
                lesson = 'A captain who might be rotated costs double. Where two picks project close, the one certain to start is worth the smaller projection.';
            } else if (alt && gain >= 0) {
                tone = 'good';
                verdict = `The best armband available to you. ${escHTML(c.player.name)} outscored every other starter${gain > 0 ? ` by ${(gain / mult).toFixed(0)}` : ''}.`;
                lesson = 'Nothing to change — the pick and the outcome agreed.';
            } else if (alt) {
                const missed = Math.abs(gain);
                tone = missed >= 12 ? 'bad' : 'mixed';
                verdict = `${escHTML(alt.player.name)} would have been worth <strong>${missed}</strong> more.`;
                // Was it a defensible call at the time? Ownership is the closest
                // proxy the data offers for what the field expected.
                const capOwn = c.player.ownership, altOwn = alt.player.ownership;
                lesson = (capOwn != null && altOwn != null && capOwn >= altOwn)
                    ? `Defensible in advance — ${escHTML(c.player.name)} was the more owned of the two at ${capOwn.toFixed(0)}% against ${altOwn.toFixed(0)}%, so this was variance rather than a misread.`
                    : `${escHTML(alt.player.name)} was the more popular pick at ${altOwn != null ? altOwn.toFixed(0) : '?'}%, so the field was ahead of you here. Worth asking what made you go the other way.`;
            } else {
                tone = 'mixed'; verdict = 'No alternative to compare against.'; lesson = '';
            }

            return { tone, verdict, lesson, vsField, fieldCap, mult };
        }

        /* Benching is the one decision on this page that is unambiguously
           checkable after the fact: either a bench player outscored a starter in
           the same position or he did not. Auto-subs already rescue the case where
           a starter played no minutes, so those are excluded — they cost nothing. */
        function gwBenchVerdict(r) {
            const misses = [];
            r.bench.forEach(b => {
                if (b.multiplier > 0) return;               // came on as an auto-sub
                if (!b.played || !b.stats) return;
                const beaten = r.xi.filter(e =>
                    e.player.position === b.player.position &&
                    e.played && e.raw < b.raw && (e.stats?.minutes || 0) > 0);
                if (!beaten.length) return;
                const worst = beaten.sort((a, c) => a.raw - c.raw)[0];
                misses.push({ benched: b, starter: worst, swing: b.raw - worst.raw });
            });
            misses.sort((a, b) => b.swing - a.swing);

            const total = r.benchPoints;
            let tone, verdict, lesson;
            if (r.benchBoost) {
                /* Bench Boost pays every bench player, so there is no such thing
                   as a point left behind and nothing here to second-guess. The
                   question becomes whether the chip was worth playing, which is
                   about the size of the return, not the order of the four. */
                const scored = r.bench.reduce((s, e) => s + e.raw, 0);
                tone = scored >= 15 ? 'good' : scored >= 8 ? 'mixed' : 'bad';
                verdict = `Bench Boost turned your bench into <strong>${scored}</strong> extra point${scored === 1 ? '' : 's'}.`;
                lesson = scored >= 15
                    ? 'A good week to have spent it — that is the return the chip is played for.'
                    : 'A thin return for a chip you only get once. Bench Boost wants a round where all four have fixtures and all four are expected to start.';
            } else if (!misses.length) {
                tone = 'good';
                verdict = total > 0
                    ? `Nothing was misplaced. The ${total} point${total === 1 ? '' : 's'} on your bench came from players who could not have replaced a starter in the same position.`
                    : 'Your bench scored nothing, which is exactly what a correct bench looks like.';
                lesson = 'The eleven you picked was the eleven to pick.';
            } else {
                const swing = misses.reduce((s, m) => s + m.swing, 0);
                tone = swing >= 10 ? 'bad' : 'mixed';
                verdict = `<strong>${swing}</strong> point${swing === 1 ? '' : 's'} sat on your bench that a straight swap would have collected.`;
                const worst = misses[0];
                const startProb = typeof expectedMinutesModel === 'function'
                    ? Math.round((expectedMinutesModel(worst.benched.player).pStart || 0) * 100) : null;
                lesson = startProb != null && startProb >= 70
                    ? `${escHTML(worst.benched.player.name)} was ${startProb}% likely to start, so this was a selection call rather than bad luck — the Lineup Wizard would have flagged him.`
                    : `${escHTML(worst.benched.player.name)} was a genuine rotation risk beforehand, so benching him was reasonable even though it cost you.`;
            }
            return { tone, verdict, lesson, misses };
        }

        // Who justified their place and who did not, judged against what could
        // have replaced them rather than against an arbitrary points line.
        function gwSelectionVerdict(r) {
            const played = r.xi.filter(e => e.played && e.stats);
            if (!played.length) return null;
            const blanks = played.filter(e => e.raw <= 2 && (e.stats.minutes || 0) > 0);
            const hauls = played.filter(e => e.raw >= 8);
            const ghosts = r.xi.filter(e => e.played && (!e.stats || !e.stats.minutes));
            return { blanks, hauls, ghosts };
        }

        // ===== RENDERING =====

        function gwrVerdictBlock(title, v) {
            if (!v) return '';
            const icon = v.tone === 'good' ? '' : v.tone === 'bad' ? '' : v.tone === 'pending' ? '⏳' : '';
            return `<div class="gwr-verdict ${v.tone}">
                <div class="gwr-verdict-head">${icon} ${escHTML(title)}</div>
                <div class="gwr-verdict-text">${v.verdict}</div>
                ${v.lesson ? `<div class="gwr-verdict-lesson"><strong>Takeaway:</strong> ${v.lesson}</div>` : ''}
            </div>`;
        }

        function gwrDelta(v, unit) {
            const cls = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
            return `<span class="gwr-delta ${cls}">${v > 0 ? '+' : ''}${v}${unit || ''}</span>`;
        }

        function renderGameweekReview(r) {
            if (!r) return '<div class="detail-section">No gameweek to review yet — this appears once the round has started.</div>';

            const vsAvg = (r.points != null && r.avg != null) ? r.points - r.avg : null;
            const rankMove = (r.overallRank != null && r.prevOverallRank != null)
                ? r.prevOverallRank - r.overallRank : null;

            // ---------- headline ----------
            const headline = `
            <div class="detail-section">
                ${!r.complete ? `<div class="gwr-partial">⏳ ${r.done} of ${r.total} matches played — the numbers below will still move.</div>` : ''}
                <div class="gwr-hero">
                    <div class="gwr-hero-pts">${r.points != null ? r.points : '—'}<span>pts</span></div>
                    <div class="gwr-hero-text">
                        ${vsAvg != null
                            ? `<strong>${vsAvg > 0 ? `${vsAvg} above` : vsAvg < 0 ? `${Math.abs(vsAvg)} below` : 'level with'}</strong> the average manager's ${r.avg}.`
                            : 'Average score not published yet.'}
                        ${r.highest != null ? ` The best score in the game was ${r.highest}.` : ''}
                        ${r.hit > 0 ? ` This includes a <strong>−${r.hit}</strong> point hit.` : ''}
                    </div>
                </div>
                <div class="opt-grid">
                    <div class="opt-stat"><div class="opt-stat-v">${r.points != null ? r.points : '—'}</div>
                        <div class="opt-stat-l" data-tooltip="Your score for the gameweek, after any transfer hit.">Your score</div></div>
                    <div class="opt-stat"><div class="opt-stat-v">${r.avg != null ? r.avg : '—'}</div>
                        <div class="opt-stat-l" data-tooltip="What the average FPL manager scored this gameweek.">Field average</div></div>
                    <div class="opt-stat"><div class="opt-stat-v">${r.benchPoints}</div>
                        <div class="opt-stat-l" data-tooltip="Points scored by players who were on your bench and did not come on.">Left on bench</div></div>
                    <div class="opt-stat"><div class="opt-stat-v">${rankMove != null ? (rankMove > 0 ? '▲' : rankMove < 0 ? '▼' : '–') : '—'}</div>
                        <div class="opt-stat-l" data-tooltip="${rankMove != null ? `Overall rank moved from ${r.prevOverallRank.toLocaleString()} to ${r.overallRank.toLocaleString()}.` : 'Overall rank movement is published once the round settles.'}">${rankMove != null ? Math.abs(rankMove).toLocaleString() : 'Rank'}</div></div>
                </div>
            </div>`;

            // ---------- captaincy ----------
            const capV = gwCaptainVerdict(r);
            let capHtml;
            if (!r.captain) {
                capHtml = '<div class="opt-empty">No captain recorded for this gameweek.</div>';
            } else {
                const c = r.captain;
                const mult = c.multiplier || 2;
                const alt = r.bestCapAlt;
                const regret = alt ? (alt.raw - c.raw) * mult : 0;
                capHtml = `
                    <div class="gwr-cap ${regret > 0 ? 'miss' : 'hit'}">
                        <div class="gwr-cap-main">
                            <span class="gwr-cap-name">${escHTML(c.player.name)}</span>
                            <span class="gwr-cap-pts">${c.raw} × ${mult} = <strong>${c.scored}</strong></span>
                        </div>
                        <div class="gwr-cap-why">
                            ${c.stats && c.stats.minutes
                                ? `${c.stats.minutes} minutes ${gwOpponentPhrase(c.stats)}${gwStatPhrases(c.player, c.stats).length ? `, ${escHTML(gwStatPhrases(c.player, c.stats).join(', '))}` : ''}.`
                                : c.played ? 'Did not get on the pitch.' : 'Has not played yet.'}
                            ${alt && regret > 0
                                ? ` The armband on <strong>${escHTML(alt.player.name)}</strong> (${alt.raw}) would have been worth <strong>${regret}</strong> more.`
                                : alt ? ` Nobody else in your eleven beat him — the best alternative was ${escHTML(alt.player.name)} on ${alt.raw}.` : ''}
                        </div>
                    </div>
                    ${r.mostCaptained ? `<div class="opt-why">The field's most-captained pick was <strong>${escHTML(r.mostCaptained.name)}</strong>${r.mostCaptainedStats ? `, who returned ${r.mostCaptainedStats.points}` : ''}${r.mostCaptained.id === r.captain.player.id ? ' — you were with the crowd.' : ' — you went a different way.'}${capV && capV.vsField != null && r.mostCaptained.id !== r.captain.player.id ? ` That is <strong>${capV.vsField > 0 ? '+' : ''}${capV.vsField}</strong> against the crowd's armband.` : ''}</div>` : ''}
                    ${gwrVerdictBlock('Was the armband right?', capV)}`;
            }

            // ---------- who delivered ----------
            /* `scored` is what a player contributed to your total; `raw` is what
               he scored. For the eleven those are the same number (doubled for
               the captain), so the distinction never mattered — until the same
               renderer was pointed at the bench, where the contribution is zero
               by definition of being benched, and every substitute was reported
               as having scored nothing whatever he did on the day. On the bench
               the honest number is the raw one, marked as not having counted. */
            const row = (e, opts) => {
                const onBench = !!(opts && opts.bench);
                const counted = e.multiplier > 0;
                const shown = onBench ? e.raw : e.scored;
                const s = e.stats;
                const phrases = s ? gwStatPhrases(e.player, s) : [];
                const cls = shown >= 10 ? 'haul' : shown >= 6 ? 'good' : shown <= 1 ? 'blank' : '';
                // A bench player who came on has his points in your total after
                // all, so only the ones that genuinely did not count are greyed.
                const ptsCls = onBench && !counted ? ' uncounted' : '';
                const suffix = e.multiplier > 1 ? `<em>×${e.multiplier}</em>`
                    : onBench && counted ? '<em>came on</em>'
                    : onBench ? '<em>not counted</em>' : '';
                /* The same face-and-crest pair the squad table uses, so a
                   player looks like himself wherever you meet him. */
                const face = typeof v2IdentityHTML === 'function' ? v2IdentityHTML(e.player) : '';
                return `<div class="gwr-row ${cls}${onBench && !counted ? ' bench' : ''}">
                    <span class="position-badge ${POSITION_CONFIG[e.player.position].class}">${POSITION_CONFIG[e.player.position].short}</span>
                    ${face}
                    <span class="gwr-row-name">${e.isCaptain ? `${v2Icon('crown')} ` : e.isVice ? 'V ' : ''}${escHTML(e.player.name)}</span>
                    <span class="gwr-row-opp">${s && s.fixtures.length ? s.fixtures.map(f => `${escHTML(f.name)}${f.home ? ' (H)' : ' (A)'}`).join(', ') : '—'}</span>
                    <span class="gwr-row-mins">${s ? s.minutes : 0}'</span>
                    <span class="gwr-row-detail">${phrases.length ? escHTML(phrases.join(', ')) : (s && s.minutes ? 'no returns' : e.played ? 'did not play' : 'yet to play')}</span>
                    <span class="gwr-row-pts${ptsCls}">${shown}${suffix}</span>
                </div>`;
            };

            const best = r.ranked[0], worst = [...r.ranked].reverse().find(e => e.played);
            const sel = gwSelectionVerdict(r);
            const selV = !sel ? null : {
                tone: sel.ghosts.length ? 'bad' : sel.blanks.length > sel.hauls.length ? 'mixed' : 'good',
                verdict: `${sel.hauls.length} of your eleven returned 8 or more, ${sel.blanks.length} brought back 2 or less${sel.ghosts.length ? `, and ${sel.ghosts.length} did not play at all` : ''}.`,
                lesson: sel.ghosts.length
                    ? `Starting a player who never got on is the costliest kind of blank, because the bench only rescues it if the auto-sub order allows. ${escHTML(sel.ghosts.map(e => e.player.name).join(', '))} — check start probability before locking the eleven.`
                    : sel.blanks.length > sel.hauls.length
                        ? 'More of your starters blanked than hauled. One week is noise; if the same names keep it up, the problem is the pick rather than the luck.'
                        : 'The eleven did what it was picked to do.'
            };
            const deliveredHtml = `
                ${best ? `<div class="opt-why">Your best return was <strong>${escHTML(best.player.name)}</strong> on ${best.scored}${worst && worst.player.id !== best.player.id ? `, and the quietest starter who actually played was <strong>${escHTML(worst.player.name)}</strong> on ${worst.scored}` : ''}.</div>` : ''}
                <!-- Called through an arrow rather than passed to map directly:
                     map hands the index in as the second argument, which is now
                     the options bag. -->
                <div class="gwr-rows">${r.ranked.map(e => row(e)).join('')}</div>
                ${gwrVerdictBlock('Did the eleven justify itself?', selV)}`;

            // ---------- bench ----------
            const benchV = gwBenchVerdict(r);
            const autoSubbed = r.bench.filter(e => e.multiplier > 0);
            const benchScored = r.bench.reduce((s, e) => s + e.raw, 0);
            const benchHtml = `
                <div class="opt-why">
                    ${r.benchBoost
                        ? `Bench Boost was active, so all <strong>${benchScored}</strong> point${benchScored === 1 ? '' : 's'} your bench scored counted towards your total.`
                        : r.benchPoints > 0
                            ? `You left <strong>${r.benchPoints}</strong> point${r.benchPoints === 1 ? '' : 's'} on the bench.`
                            : 'Nothing was wasted on the bench.'}
                    ${autoSubbed.length ? ` ${autoSubbed.length} auto-substitution${autoSubbed.length === 1 ? '' : 's'} came on for you.` : ''}
                </div>
                <div class="gwr-rows">${r.benchRanked.map(e => row(e, { bench: true })).join('')}</div>
                ${benchV.misses.length ? `<div class="gwr-misses">${benchV.misses.map(m =>
                    `<div class="gwr-miss"><strong>${escHTML(m.benched.player.name)}</strong> (${m.benched.raw}) outscored <strong>${escHTML(m.starter.player.name)}</strong> (${m.starter.raw}) in the same position — a swap worth <strong>${m.swing}</strong>.</div>`).join('')}</div>` : ''}
                ${gwrVerdictBlock('Was the bench right?', benchV)}`;

            // ---------- the week in the game ----------
            const fieldHtml = `
                <div class="opt-why">
                    The average manager scored <strong>${r.avg != null ? r.avg : '—'}</strong>${r.highest != null ? ` and the best score in the world was <strong>${r.highest}</strong>` : ''}.
                    ${r.topElementPlayer && r.topElement ? ` The highest-scoring player was <strong>${escHTML(r.topElementPlayer.name)}</strong> on ${r.topElement.points}${r.entries.some(e => e.player.id === r.topElement.id) ? ' — and you owned him.' : ', who you did not own.'}` : ''}
                    ${r.transfers ? ` You made ${r.transfers} transfer${r.transfers === 1 ? '' : 's'}${r.hit ? ` for a ${r.hit}-point hit` : ' for free'}.` : ' You made no transfers.'}
                </div>
                ${(r.ev.chip_plays || []).length ? `<div class="gwr-chips">${r.ev.chip_plays.map(c =>
                    `<span class="gwr-chip"><strong>${(c.num_played || 0).toLocaleString()}</strong> ${escHTML({ bboost: 'Bench Boost', freehit: 'Free Hit', wildcard: 'Wildcard', '3xc': 'Triple Captain' }[c.chip_name] || c.chip_name)}</span>`).join('')}</div>` : ''}`;

            /* The whole review in three or four sentences, because the sections
               above answer "was this call right" one at a time and nobody reads a
               report to assemble the conclusion themselves. Only lines with
               something to say are kept. */
            const learnings = [
                capV && capV.lesson ? { icon: '', tone: capV.tone, text: capV.lesson } : null,
                benchV && benchV.lesson ? { icon: '', tone: benchV.tone, text: benchV.lesson } : null,
                selV && selV.lesson ? { icon: '', tone: selV.tone, text: selV.lesson } : null,
                (r.hit > 0) ? (() => {
                    // A hit is only justified if the players brought in cleared it.
                    const covered = vsAvg != null && vsAvg > 0;
                    return { icon: '', tone: covered ? 'good' : 'bad',
                        text: covered
                            ? `You paid ${r.hit} points for transfers and still finished above the average, so the move carried its own cost.`
                            : `You paid ${r.hit} points for transfers and finished below the average. A hit has to beat what the outgoing player would have scored, not merely bring in someone good.` };
                })() : null,
                (r.benchPoints >= 15 && (!benchV || !benchV.misses.length))
                    ? { icon: '', tone: 'mixed', text: `${r.benchPoints} points sat on your bench legitimately. That much value in reserve every week is a squad-balance question rather than a selection one — a Bench Boost turns it into points.` }
                    : null
            ].filter(Boolean);

            /* Omitted entirely rather than approximated when the sample cannot
               answer for this gameweek — see gwEoSwings. */
            const eo = r.eo;
            const eoRow = (x) => `<div class="gwr-row">
                <span class="gwr-row-name">${escHTML(x.player.name)}</span>
                <span class="gwr-row-opp">${x.owned
                    ? (x.mult === 0 ? 'you benched him' : x.mult === 1 ? 'you had 1x' : `you had ${x.mult}x`)
                    : 'you did not have him'} · field ${x.eo.toFixed(0)}% · ${x.points} pts</span>
                <span class="gwr-row-pts">${x.swing > 0 ? '+' : '\u2212'}${Math.abs(x.swing).toFixed(1)}</span>
            </div>`;
            const eoHtml = !eo ? '' : `
            <div class="detail-section">
                <div class="detail-section-title">${v2Icon('users')} What it did to your rank</div>
                <p class="gwr-line">Your score is what you got; your rank moves on the gap between that and what
                    everyone else got. Against the <b>${escHTML(eo.tierLabel)}</b> this week was worth
                    <b>${eo.net > 0 ? '+' : eo.net < 0 ? '\u2212' : ''}${Math.abs(eo.net).toFixed(1)}</b> points of
                    ground ${eo.net > 0 ? 'gained' : eo.net < 0 ? 'lost' : 'either way'}. A player the field owns
                    more than once over \u2014 effective ownership above 100% \u2014 costs you ground when he scores
                    and gains you ground when he blanks.</p>
                ${eo.gained.length ? `<div class="gwr-rows">${eo.gained.map(eoRow).join('')}</div>` : ''}
                ${eo.lost.length ? `<div class="gwr-rows">${eo.lost.map(eoRow).join('')}</div>` : ''}
                <div class="opt-why">Effective ownership counts starters and doubles captains. Sampled from
                    ${eo.sampled ? `${eo.sampled} managers` : 'a sample'} in GW${escHTML(String(r.gw))}${eo.resolution
                        ? `, so anything under ${eo.resolution}% owned is below what the sample can see and is left out`
                        : ''}.</div>
            </div>`;

            /* Transfer ROI. Null when the transfer log did not load or the week
               had no moves in it — "you made no transfers" is already in the week
               in the game above, and saying it twice under its own heading would
               be padding. */
            const roi = r.roi;
            const roiHtml = !roi ? '' : `
            <div class="detail-section">
                <div class="detail-section-title">${v2Icon('swap')} What the transfers returned</div>
                <p class="gwr-line">${roi.moves.length === 1 ? 'Your move' : `Your ${roi.moves.length} moves`} ${roi.gross === 0 ? 'came out level' : roi.gross > 0 ? `gained <b>${roi.gross}</b> point${Math.abs(roi.gross) === 1 ? '' : 's'}` : `lost <b>${Math.abs(roi.gross)}</b> point${Math.abs(roi.gross) === 1 ? '' : 's'}`} on the players
                    ${roi.moves.length === 1 ? 'he' : 'they'} replaced${roi.hit ? `, and cost <b>${roi.hit}</b> in hits — <b>${roi.net > 0 ? '+' : roi.net < 0 ? '−' : ''}${Math.abs(roi.net)}</b> net` : ''}.</p>
                <div class="gwr-rows">${roi.moves.map(m => `<div class="gwr-row ${m.delta >= 6 ? 'haul' : m.delta > 0 ? 'good' : m.delta < 0 ? 'blank' : ''}">
                    <span class="gwr-row-name">${escHTML(m.in.name)}</span>
                    <span class="gwr-row-opp">in for ${escHTML(m.out.name)} · ${m.inPts} against ${m.outPts}${m.counted === false ? ' · did not count for you' : ''}</span>
                    <span class="gwr-row-pts">${m.delta > 0 ? '+' : m.delta < 0 ? '−' : ''}${Math.abs(m.delta)}</span>
                </div>`).join('')}</div>
                <div class="opt-why">Each line is what the player you bought scored against what the player
                    you sold scored in the same week. It is not the difference to your total: a squad you did
                    not pick has no bench order and no auto-substitutions, so there is no honest way to say
                    what it would have come to.${roi.hit ? ' The hit is charged to the gameweek rather than to any one move.' : ''}</div>
            </div>`;

            /* The luck section is not built here. It needs the sealed snapshot,
               which is a separate file and a separate fetch — see
               gwFillLuckSection(). It lands immediately before this block, so the
               id is the anchor it inserts against. */
            const learningsHtml = `
            <div class="detail-section" id="gwrLearnings">
                <div class="detail-section-title">${v2Icon('cap')} What to take from this week</div>
                ${learnings.length
                    ? `<div class="gwr-learnings">${learnings.map(l =>
                        `<div class="gwr-learning ${l.tone}"><span class="gwr-learning-icon">${l.icon}</span><span>${l.text}</span></div>`).join('')}</div>`
                    : '<div class="opt-empty">Nothing stands out either way — a quiet, correctly played week.</div>'}
                ${!r.complete ? '<div class="opt-why">These read on a part-played round, so they may change once the remaining matches finish.</div>' : ''}
            </div>`;

            return `
            ${headline}
            <div class="detail-section">
                <div class="detail-section-title">${v2Icon('crown')} The armband</div>
                ${capHtml}
            </div>
            <div class="detail-section">
                <div class="detail-section-title">${v2Icon('clipboard')} Who delivered</div>
                ${deliveredHtml}
            </div>
            <div class="detail-section">
                <div class="detail-section-title">${v2Icon('bench')} The bench</div>
                ${benchHtml}
            </div>
            <div class="detail-section">
                <div class="detail-section-title">${v2Icon('globe')} The week in the game</div>
                ${fieldHtml}
            </div>
            ${roiHtml}
            ${eoHtml}
            ${learningsHtml}`;
        }

        /* ===== The luck section, which arrives late or not at all =====

           The sealed prediction is its own file, a couple of hundred kilobytes
           of it, and it is only ever wanted by this one panel. Fetching it with
           the page would charge every visitor for a button most will not press;
           awaiting it before the modal opens would hold the modal shut on a
           request that, for any round sealed before the archive existed, is going
           to 404.

           So the review renders without it and this inserts the section if and
           when there is one to insert. No placeholder and no spinner: a heading
           that may never fill is worse than a section that appears a moment late,
           and for GW1–GW5 there is nothing to wait for — tools/snapshot-
           predictions.mjs was written on 19 September, by which time those
           deadlines had passed, and a snapshot cannot be backfilled. */
        function gwLuckSnapshotURL(gw) {
            const bust = typeof CACHE_BUSTER !== 'undefined' ? `?v=${CACHE_BUSTER}` : '';
            return `/data/model-log/gw${Number(gw)}.json${bust}`;
        }

        function gwRenderLuck(luck, gw) {
            if (!luck) return '';
            const sign = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}`;
            const row = (x) => `<div class="gwr-row ${x.delta > 0 ? 'good' : 'blank'}">
                <span class="gwr-row-name">${escHTML(x.player.name)}</span>
                <span class="gwr-row-opp">projected ${x.xp.toFixed(1)}, scored ${x.raw}${x.mult > 1 ? ` (x${x.mult})` : ''}</span>
                <span class="gwr-row-pts">${sign(Math.round(x.delta * 10) / 10)}</span>
            </div>`;
            return `
            <div class="detail-section">
                <div class="detail-section-title">${v2Icon('chart')} Was it the picks or the week?</div>
                <p class="gwr-line">Before the GW${escHTML(String(gw))} deadline this site projected
                    <b>${luck.expected.toFixed(1)}</b> for the eleven you submitted. It scored
                    <b>${luck.actual}</b> — <b>${sign(luck.delta)}</b> against its own forecast.
                    ${luck.delta > 0
                        ? 'The week went better than the squad was expected to, which is variance rather than a selection to copy.'
                        : luck.delta < 0
                            ? 'The week went worse than the squad was expected to. That is an argument against changing much: the same eleven was projected to do more than it did.'
                            : 'Almost exactly what it was projected to do.'}</p>
                ${luck.over.length ? `<div class="gwr-rows">${luck.over.map(row).join('')}</div>` : ''}
                ${luck.under.length ? `<div class="gwr-rows">${luck.under.map(row).join('')}</div>` : ''}
                <div class="opt-why">Graded against the prediction as it was sealed${luck.hoursBefore != null
                    ? ` ${luck.hoursBefore < 1 ? 'under an hour' : `${Math.round(luck.hoursBefore)} hour${Math.round(luck.hoursBefore) === 1 ? '' : 's'}`} before the deadline` : ''},
                    never re-run afterwards. Measured on the eleven you named and the armband you gave, so
                    auto-substitutions are not in it — a substitute rescues a blank, he was not forecast to.
                    ${luck.graded} of them had a projection${luck.missing ? `; ${luck.missing} did not and ${luck.missing === 1 ? 'is' : 'are'} left out rather than counted as zero` : ''}.</div>
            </div>`;
        }

        async function gwFillLuckSection(r) {
            if (!r || !r.complete || !document.getElementById('gwrLearnings')) return;
            try {
                const url = gwLuckSnapshotURL(r.gw);
                const snap = (typeof DataCache !== 'undefined' && DataCache.fetchJSON)
                    ? await DataCache.fetchJSON(url)
                    : await (await fetch(url)).json();
                const luck = gwLuckRating(r.gw, r.entries, snap,
                    { complete: r.complete, chip: r.chip });
                if (!luck) return;
                /* Re-read rather than reuse the node from above. The five features
                   that share this shell all replace #optReportBody wholesale, so
                   if one of them opened while the fetch was in flight the anchor
                   is gone and this section belongs nowhere. */
                const anchor = document.getElementById('gwrLearnings');
                if (!anchor) return;
                anchor.insertAdjacentHTML('beforebegin', gwRenderLuck(luck, r.gw));
                if (typeof lucide !== 'undefined') lucide.createIcons();
            } catch (err) {
                /* A round with no sealed prediction — every round before the
                   archive existed, and any whose snapshot job failed. Nothing to
                   say and nothing to apologise for; see the comment above. */
            }
        }

        function openGameweekReview() {
            const r = buildGameweekReview();
            optReportShow(`Gameweek ${r ? Number(r.gw) : Number(currentGW)} review`, 'chart',
                renderGameweekReview(r), { modal: true });
            gwFillLuckSection(r);
        }
