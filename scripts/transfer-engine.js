/* ============================================
   EasyFPL — the transfer engine

   "Is there a move worth making, or should I hold?" — and the lineup solve
   that question depends on. Shared by the squad page's transfer wizard and
   by the dashboard, which surfaces the single best move as an alert.

   This used to live inside scripts/transfer-wizard.js, so the recommendation
   was only reachable from the page that already had the whole squad loaded.
   The dashboard could flag that a player looked wrong but never propose the
   fix.

   Plain globals in a classic script. No DOM.

   DEPENDENCIES the host page must provide:

     allPlayers                the full pool, shaped as the xP engine expects
     allFixtures               raw fixtures, for the planning window
     currentGW                 number
     projectPlayerPointsForGW  from scripts/xp-engine.js
     minMinutesForCandidate()  optional; defaults to a sane floor

   twBuildRecommendation() reads the squad, bank and free-transfer count from
   the squad page's globals when it can, and takes them as options when it
   cannot — which is how the dashboard uses it without loading that page's
   state.
   ============================================ */

        function solveQuickLineup(squad) {
            const validFormations = [[3,4,3],[3,5,2],[4,3,3],[4,4,2],[4,5,1],[5,3,2],[5,4,1],[5,2,3]];
            const byPos = { 1: [], 2: [], 3: [], 4: [] };
            squad.forEach(p => { if (p.lwScore > -100) byPos[p.pos].push(p); });
            Object.values(byPos).forEach(a => a.sort((a, b) => b.lwScore - a.lwScore));
            let bestFormation = null, bestScore = -Infinity, bestXI = null;
            const formationScores = [];
            for (const [nD, nM, nF] of validFormations) {
                if (byPos[1].length < 1 || byPos[2].length < nD || byPos[3].length < nM || byPos[4].length < nF) continue;
                const xi = [byPos[1][0], ...byPos[2].slice(0, nD), ...byPos[3].slice(0, nM), ...byPos[4].slice(0, nF)];
                const total = xi.reduce((s, p) => s + p.lwScore, 0);
                formationScores.push({ formation: `${nD}-${nM}-${nF}`, total });
                if (total > bestScore) { bestScore = total; bestFormation = `${nD}-${nM}-${nF}`; bestXI = xi; }
            }
            formationScores.sort((a, b) => b.total - a.total);
            if (!bestXI) { const av = squad.filter(p => p.lwScore > -100).sort((a, b) => b.lwScore - a.lwScore); bestXI = av.slice(0, 11); bestFormation = 'N/A'; }
            const xiIds = new Set(bestXI.map(p => p.id));
            const bench = squad.filter(p => !xiIds.has(p.id)).sort((a, b) => { if (a.pos === 1 && b.pos !== 1) return 1; if (b.pos === 1 && a.pos !== 1) return -1; return b.lwScore - a.lwScore; });
            return { xi: bestXI, bench, formation: bestFormation, formationScores };
        }


        // Hosts that do not load squad-table-chart.js still need the candidate
        // minutes floor. Same rule: about half a match per gameweek played,
        // capped, so it does not filter out the entire league in early weeks.
        if (typeof minMinutesForCandidate !== 'function') {
            window.minMinutesForCandidate = function () {
                return Math.min(100, Math.max((typeof currentGW !== 'undefined' ? currentGW : 1) - 1, 1) * 45);
            };
        }

        // The next N gameweeks nobody has kicked off yet. Both players in a
        // comparison are scored over the same weeks, or the delta is meaningless.
        /* Both of these moved into scripts/xp-engine.js so the draft and the
           lineup wizard could reach them too. Kept as thin names here because
           the recommender below reads better with them, but there is only one
           implementation now. The recommender passes TW_HORIZON explicitly —
           it decides over five gameweeks, not the engine's default three. */
        function twPlanGWs(n, fromGW) {
            return typeof xpPlanGWs === 'function' ? xpPlanGWs(n, fromGW) : [];
        }

        function twXPOver(player, gws) {
            return typeof xpOver === 'function' ? xpOver(player, gws) : 0;
        }

        /* ===== "Should I transfer?" =====

           Answers the question a manager actually has on a Tuesday: is there a
           move worth making, or should I hold? Doing nothing is a real option
           here and wins most weeks, which is the point — a recommender that
           always finds a transfer is just a shopping list.

           Every candidate move is priced the same way: total projected points
           over the next five gameweeks for the incoming player minus the same
           figure for the outgoing one, then minus any points hit. Five rather
           than three because a transfer is a five-week commitment in practice —
           you rarely undo it next week — and a three-week window over-rewards
           one kind fixture. */
        const TW_HORIZON = 5;
        // A free transfer has option value: banked, it becomes two next week. So a
        // marginal edge is not a reason to spend one. These are the margins a move
        // has to clear over the whole horizon, not per gameweek.
        const TW_MIN_FREE_GAIN = 3.0;   // spend a free transfer
        const TW_MIN_HIT_GAIN  = 4.0;   // clear the 4-point hit by this much again

        /* How much a squad-analysis Sell verdict is worth when ordering otherwise
           comparable moves. Deliberately well under TW_MIN_FREE_GAIN: it decides
           ties between moves the engine already rates similarly, and can never
           promote one that falls short of the margin a transfer has to clear. */
        const TW_FLAGGED_NUDGE = 0.75;

        /* Free transfers, replayed from a manager's history.

           The official API does not publish the count, so it has to be
           reconstructed: everyone starts on one, each gameweek's transfers are
           deducted, and one is added back afterwards up to the cap. Wildcard and
           Free Hit weeks cost nothing. Lives here so the squad page and the
           dashboard replay it identically rather than each keeping a copy. */
        function twDeriveFreeTransfers(rows, chips, maxFT) {
            if (!rows || !rows.length) return 1;
            const chipByEvent = {};
            (chips || []).forEach(ch => { chipByEvent[ch.event] = ch.name; });
            let ft = 1;
            rows.forEach(row => {
                if (row.event === 1) { ft = 1; return; }
                const chip = chipByEvent[row.event];
                if (chip !== 'wildcard' && chip !== 'freehit') {
                    ft = Math.max(0, ft - (row.event_transfers || 0));
                }
                ft = Math.min(maxFT || 5, ft + 1);
            });
            return ft;
        }

        /* How many free transfers the manager actually has.

           This used to ask getDraftFreeTransfers(currentGW), which answers a
           different question: how many free transfers the DRAFT PLAN would have
           at that gameweek. Two things went wrong with it. Its starting figure
           is a number the user types into the planner, defaulting to 1 rather
           than to anything real. And its gameweek list deliberately excludes
           any gameweek already under way — so currentGW is never in it, the
           loop's early return never fires, and it rolls the count forward one
           per planned gameweek until it hits the cap. With GW1 played it
           returned 5 for everybody, which is why a manager holding a single
           free transfer was offered two moves "within your 5 free transfers"
           and shown no points hit for them.

           deriveFreeTransfers() replays the manager's real transfer history
           from the FPL API, which is the only honest source available — FPL
           does not publish the count directly. */
        function twFreeTransfers() {
            if (typeof deriveFreeTransfers === 'function') {
                const d = deriveFreeTransfers();
                if (d && Number.isFinite(d.count)) return Math.max(0, d.count);
            }
            return 1;
        }

        // Whether that count is replayed from complete history or guessed at.
        function twFreeTransfersExact() {
            if (typeof deriveFreeTransfers === 'function') {
                const d = deriveFreeTransfers();
                return !!(d && d.exact);
            }
            return false;
        }

        // A small, bounded nudge from the team's own recent results — genuinely
        // independent of the player's own regressed per-90 rate (a squad can be
        // hot or cold before an individual's underlying numbers catch up), the
        // same signal findReplacements()/analyzePlayer() already lean on. Kept
        // deliberately small relative to a typical multi-GW xP swing so it can
        // only ever break a close call, never override what the projection
        // itself already says once fixture difficulty and form are folded in.
        //
        // Opt-in (see twXPCached below): the Transfer Wizard's own recommendation
        // card and the dashboard alert already show "X.X xP" numbers built from
        // this same cache without it, and turning it on unconditionally would
        // quietly change those already-shipped figures. GW Draft's recommender
        // asks for it explicitly; everyone else keeps today's behaviour.
        function twTeamContextNudge(player) {
            const ta = typeof teamAnalysis !== 'undefined' ? teamAnalysis[player.teamId] : null;
            if (!ta || !ta.matchesPlayed) return 0;
            const powerField = player.position >= 3 ? ta.attackPower : ta.defensePower;
            let nudge = (ta.formRating - 50) / 50;
            nudge += powerField !== undefined ? (powerField - 50) / 50 : 0;
            nudge += (ta.fixtureScore - 50) / 100;
            return Math.max(-2.5, Math.min(2.5, nudge));
        }

        function twXPCached(player, gws, cache, useTeamContext) {
            if (!player) return 0;
            const key = useTeamContext ? `${player.id}:tc` : player.id;
            if (cache[key] === undefined) {
                cache[key] = twXPOver(player, gws) + (useTeamContext ? twTeamContextNudge(player) : 0);
            }
            return cache[key];
        }

        /* What a squad is actually worth over the window.

           A player's expected points are not the points you receive. Only eleven
           of fifteen score in a normal gameweek, and exactly one goalkeeper plays
           — so a second keeper projecting 23 points instead of 16 adds almost
           nothing, because neither of them was going to play. Scoring transfers on
           the individual delta recommended upgrading bench slots at full value,
           which is how a backup keeper ended up as a +6.7 move.

           The squad is therefore valued the way the pitch values it: pick the best
           eleven by projected points and total them. The bench still counts for
           something — auto-subs cover a starter who does not play, and the reserve
           keeper covers the first — but at a fraction, and least of all for the
           keeper who only appears if the other one is dropped or injured. */
        const TW_BENCH_WEIGHT = 0.12;
        const TW_BENCH_GK_WEIGHT = 0.05;

        function twSquadValue(pool) {
            if (typeof solveQuickLineup !== 'function') {
                // No solver available — fall back to the plain total rather than
                // silently reporting zero for everything.
                return pool.reduce((s, p) => s + p.lwScore, 0);
            }
            const { xi, bench } = solveQuickLineup(pool);
            const xiXP = xi.reduce((s, p) => s + p.lwScore, 0);
            const benchXP = bench.reduce((s, p) =>
                s + p.lwScore * (p.pos === 1 ? TW_BENCH_GK_WEIGHT : TW_BENCH_WEIGHT), 0);
            return xiXP + benchXP;
        }

        // One entry per squad player, reused across every candidate so the lineup
        // solve is the only per-candidate work.
        function twBuildPool(squad, gws, cache, useTeamContext) {
            return squad.map(p => ({
                id: p.id, pos: p.position, lwScore: twXPCached(p, gws, cache, useTeamContext), _ref: p
            }));
        }

        // Best legal replacement for one squad player, or null if nothing beats him.
        // Scored on what the swap does to the squad's total, not to the player's.
        function twBestSwapFor(out, ctx) {
            const budget = (out.sellPrice || out.price) + ctx.bank;
            const outXP = twXPCached(out, ctx.gws, ctx.cache, ctx.useTeamContext);
            const slot = ctx.pool.findIndex(e => e.id === out.id);
            if (slot < 0) return null;

            const trial = ctx.pool.slice();
            let best = null;

            for (const cand of allPlayers) {
                if (cand.position !== out.position) continue;
                if (cand.price > budget) continue;
                if (ctx.ownedIds.has(cand.id)) continue;
                if (cand.status !== 'a' && cand.status !== 'd') continue;
                if (cand.minutes < minMinutesForCandidate()) continue;
                const held = (ctx.clubCount[cand.teamId] || 0) - (cand.teamId === out.teamId ? 1 : 0);
                if (held >= 3) continue;

                const inXP = twXPCached(cand, ctx.gws, ctx.cache, ctx.useTeamContext);
                trial[slot] = { id: cand.id, pos: cand.position, lwScore: inXP, _ref: cand };
                const gain = twSquadValue(trial) - ctx.baseValue;

                if (!best || gain > best.gain) {
                    best = { out, in: cand, gain, outXP, inXP,
                             // Individual delta, kept so the card can explain the
                             // difference between the two figures when they diverge.
                             rawDelta: inXP - outXP,
                             outStarts: ctx.baseXIIds.has(out.id) };
                }
            }
            trial[slot] = ctx.pool[slot];
            return best;
        }

        /* opts lets a host without the squad page's globals supply them:
             { squad, bank, freeTransfers, fromGW, useTeamContext }
           Anything omitted falls back to the squad page's own state (or today,
           for fromGW), so the wizard's existing call site is unaffected. GW
           Draft is the one host that passes fromGW — "project from GW7", not
           from today — and useTeamContext (see twTeamContextNudge above). */
        function twBuildRecommendation(opts) {
            const o = opts || {};
            const gws = twPlanGWs(TW_HORIZON, o.fromGW);
            const squad = (o.squad && o.squad.length) ? o.squad
                : ((typeof selectedPlayers !== 'undefined' && selectedPlayers.length) ? selectedPlayers : []);
            if (!squad.length || !gws.length) return null;

            const clubCount = {};
            squad.forEach(p => { clubCount[p.teamId] = (clubCount[p.teamId] || 0) + 1; });

            const cache = {};
            const pool = twBuildPool(squad, gws, cache, o.useTeamContext);
            const baseXI = typeof solveQuickLineup === 'function' ? solveQuickLineup(pool).xi : pool.slice(0, 11);

            const ctx = {
                gws, useTeamContext: o.useTeamContext,
                bank: (o.bank != null ? o.bank : (typeof getTWBank === 'function' ? getTWBank() : 0)), cache, pool,
                baseValue: twSquadValue(pool),
                baseXIIds: new Set(baseXI.map(p => p.id)),
                ownedIds: new Set(squad.map(p => p.id)),
                clubCount
            };

            /* Ranking, with an optional thumb on the scale for players the squad
               analysis has already flagged.

               The two engines answer different questions and so can disagree
               honestly: a verdict asks "is this player a problem" from form,
               minutes, fixtures and price risk, while the swap search asks "which
               single change adds most to the squad's projected points". A flagged
               player with no affordable upgrade is correctly left alone, and the
               biggest xP gain can sit on a player rated Hold.

               But telling a manager "Sell Gordon" in one column and "transfer out
               Semenyo" in the next, with nothing connecting them, reads as the
               site contradicting itself. o.priorityOutIds lets a host pass the
               flagged ids so that where two moves are within noise of each other,
               the one that resolves a problem the manager has already been shown
               wins. It is a tie-breaker, not an override: TW_FLAGGED_NUDGE is far
               too small to promote a materially worse move, and the gain reported
               on the card is always the real one. */
            const flagged = o.priorityOutIds instanceof Set ? o.priorityOutIds : null;
            const ftNow = o.freeTransfers != null ? o.freeTransfers : twFreeTransfers();
            const cost1 = Math.max(0, 1 - ftNow) * 4;
            const margin1 = cost1 > 0 ? TW_MIN_HIT_GAIN : TW_MIN_FREE_GAIN;
            const clearsBar = m => (m.gain - cost1) >= margin1;

            const byGain = squad.map(p => twBestSwapFor(p, ctx))
                .filter(Boolean)
                .sort((a, b) => b.gain - a.gain);

            /* Promote a flagged player's move only when doing so costs nothing.

               Adding the nudge to the sort key directly looks equivalent and is
               not: a flagged move on 2.6 outranks an unflagged 3.2, becomes the
               only candidate considered, then fails the 3.0 viability margin on
               its real gain — turning a legitimate recommendation into "hold" and
               losing the manager a move they should have been offered. The swap
               is therefore allowed only when the flagged move clears the same bar,
               or when the move it displaces was not going to clear it either. */
            let moves = byGain;
            if (flagged && byGain.length && !flagged.has(byGain[0].out.id)) {
                const top = byGain[0];
                const alt = byGain.find(m => flagged.has(m.out.id) && (top.gain - m.gain) <= TW_FLAGGED_NUDGE);
                if (alt && (clearsBar(alt) || !clearsBar(top))) {
                    moves = [alt].concat(byGain.filter(m => m !== alt));
                }
            }

            // No legal move at all — everything is unaffordable, blocked by the
            // three-per-club limit, or already owned. That is a hold, not a
            // failure, and must not be reported as "no squad loaded".
            if (!moves.length) {
                return { best: { n: 0, moves: [], gross: 0, cost: 0, net: 0 },
                         options: [], moves: [], gws, ft: (o.freeTransfers != null ? o.freeTransfers : twFreeTransfers()),
                         horizon: TW_HORIZON, noLegalMove: true,
                         sample: (typeof seasonGamesPlayed !== 'undefined' ? seasonGamesPlayed : null) };
            }

            const ft = o.freeTransfers != null ? o.freeTransfers : twFreeTransfers();

            /* Every move above was priced on its own against the unchanged squad,
               which is the right way to rank them and the wrong way to combine
               them. Two moves are not independent: if both promote a bench player
               into the same eleven, or both compete for one slot, their separate
               gains double-count the same improvement. Adding them together
               overstates a two-transfer plan and tilts the verdict toward taking
               a hit. The pair also has to be legal as a pair — two swaps that are
               each affordable against the full bank may not be affordable together,
               and two players from the same club can breach the three-per-club
               limit jointly while each looks fine alone. */
            const twApplyMoves = ms => {
                const trial = pool.slice();
                ms.forEach(m => {
                    const slot = trial.findIndex(e => e.id === m.out.id);
                    if (slot >= 0) trial[slot] = { id: m.in.id, pos: m.in.position, lwScore: m.inXP, _ref: m.in };
                });
                return trial;
            };
            const twJointGain = ms => twSquadValue(twApplyMoves(ms)) - ctx.baseValue;
            const twMovesLegal = ms => {
                const raised = ms.reduce((s, m) => s + (m.out.sellPrice || m.out.price), 0);
                const spent = ms.reduce((s, m) => s + m.in.price, 0);
                if (spent > raised + ctx.bank + 1e-9) return false;
                const counts = Object.assign({}, clubCount);
                ms.forEach(m => { counts[m.out.teamId] = (counts[m.out.teamId] || 0) - 1; });
                ms.forEach(m => { counts[m.in.teamId] = (counts[m.in.teamId] || 0) + 1; });
                return Object.keys(counts).every(k => counts[k] <= 3);
            };

            // Option A: one move. Option B: two, on different players — the second
            // is only worth it if it clears its own hit.
            const one = moves[0];
            const two = moves.find(m => m.out.id !== one.out.id && m.in.id !== one.in.id
                && twMovesLegal([one, m]));

            const costFor = n => Math.max(0, n - ft) * 4;
            const options = [
                { n: 0, moves: [], gross: 0, cost: 0, net: 0 },
                { n: 1, moves: [one], gross: one.gain, cost: costFor(1), net: one.gain - costFor(1) }
            ];
            if (two) {
                const gross = twJointGain([one, two]);
                options.push({ n: 2, moves: [one, two], gross, cost: costFor(2), net: gross - costFor(2) });
            }

            // A move must clear its margin, not merely beat zero. Anything unavailable
            // is exempt — a player who cannot play is worth replacing regardless.
            //
            // o.freeTransfersOnly (opts) drops any hit-costing option outright,
            // must-sells aside — for an automated bulk run across several
            // gameweeks at once, nobody reviewed any single one of those hits,
            // so "clears its margin" isn't consent to spend points on it. A
            // manager reviewing one gameweek by hand still sees hit-taking
            // options; this only narrows what an unattended loop is allowed
            // to pick for itself.
            const unavailable = m => m.out.status === 'i' || m.out.status === 'u' || m.out.status === 's';
            const viable = options.filter(opt => {
                if (opt.n === 0) return true;
                if (opt.moves.some(unavailable)) return true;
                if (o.freeTransfersOnly && opt.cost > 0) return false;
                const margin = opt.cost > 0 ? TW_MIN_HIT_GAIN : TW_MIN_FREE_GAIN;
                return opt.net >= margin;
            });

            const best = viable.sort((a, b) => b.net - a.net || a.n - b.n)[0];
            return { best, options, moves: moves.slice(0, 5), gws, ft, horizon: TW_HORIZON,
                     sample: (typeof seasonGamesPlayed !== 'undefined' ? seasonGamesPlayed : null) };
        }


        function twMoveReason(m, gws) {
            const bits = [];
            // When the individual delta and the squad gain diverge, the slot is the
            // reason — say so first, because otherwise the two numbers on the card
            // look like a contradiction.
            //
            // The test has to be proportional. On an absolute ">1 point" test this
            // fired on a move that kept 4.7 of a 6.7-point upgrade and told the
            // manager "most of it never reaches your score" — directly contradicting
            // the +4.7 printed next to it. Below 60% kept, "most is lost" is fair;
            // above it the incoming player is displacing a starter, which is the
            // actual story and worth saying plainly.
            if (m.outStarts === false && m.rawDelta > 0.5) {
                const kept = m.gain / m.rawDelta;
                if (kept < 0.6) {
                    bits.push(m.out.position === 1
                        ? `${m.out.name} is your reserve keeper, so most of that ${m.rawDelta.toFixed(1)}-point upgrade never reaches your score`
                        : `${m.out.name} starts on your bench, so only a fraction of the ${m.rawDelta.toFixed(1)}-point upgrade reaches your score`);
                } else {
                    bits.push(`${m.in.name} is good enough to start ahead of what you have, so this upgrades your XI rather than your bench`);
                }
            }
            if (m.out.status === 'i' || m.out.status === 'u' || m.out.status === 's') {
                bits.push(`${m.out.name} cannot play`);
            } else if (m.out.status === 'd') {
                bits.push(`${m.out.name} is carrying a doubt`);
            }
            // player.fixtures is always "the next N from today" — right for the
            // Transfer Wizard's own call (gws IS the next N from today), but
            // GW Draft passes gws starting at some future gameweek, where that
            // property would silently describe the wrong weeks. Reading
            // teamFixtures6 and filtering to the actual gws list is correct
            // either way.
            const fxFor = player => {
                const all = (typeof teamFixtures6 !== 'undefined' && teamFixtures6[player.teamId]) || player.fixtures || [];
                const forGws = all.filter(f => gws.includes(f.event));
                return (forGws.length ? forGws : all.slice(0, gws.length)).map(f => f.difficulty || 3);
            };
            const outFx = fxFor(m.out);
            const inFx = fxFor(m.in);
            const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 3;
            const outAvg = avg(outFx), inAvg = avg(inFx);
            if (inAvg <= outAvg - 0.4) {
                bits.push(`kinder run ahead (${inAvg.toFixed(1)} against ${outAvg.toFixed(1)} average difficulty)`);
            }
            // Price is context, never a reason on its own. Listed alongside real
            // arguments "frees £6.5m" reads as a benefit, which is how selling a
            // £12.0m midfielder for a £5.5m one came to look like a recommendation
            // with an upside — the freed money buys nothing unless it is spent, and
            // this recommender does not spend it.
            if (!bits.length) bits.push(`projects ${m.gain.toFixed(1)} points better across the window`);
            const priceDiff = m.in.price - (m.out.sellPrice || m.out.price);
            if (priceDiff <= -0.4) bits.push(`banks £${Math.abs(priceDiff).toFixed(1)}m you would still need to spend`);
            else if (priceDiff >= 0.4) bits.push(`costs £${priceDiff.toFixed(1)}m more`);
            return bits.join(' · ');
        }
