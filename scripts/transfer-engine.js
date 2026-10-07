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
            /* Nothing legal fits — a squad short of bodies in some position,
               which happens mid-plan and on a part-filled draft. The fallback
               still has to field a team rather than the eleven best names: the
               old one took the top eleven by score outright, and with two
               keepers scoring well that is two keepers on the pitch. One
               keeper, then the best of the rest. */
            if (!bestXI) {
                const av = squad.filter(p => p.lwScore > -100).sort((a, b) => b.lwScore - a.lwScore);
                const keeper = av.find(p => p.pos === 1);
                const outfield = av.filter(p => p.pos !== 1);
                bestXI = (keeper ? [keeper] : []).concat(outfield.slice(0, keeper ? 10 : 11));
                bestFormation = 'N/A';
            }
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

        /* How much better a goalkeeper swap has to be before it is offered.
         *
         * THIS IS A STATED PREFERENCE, NOT A MODELLING CORRECTION, and it is
         * worth being exact about that because the obvious justification is
         * false. The tempting story is "the model keeps picking keepers because
         * they are all the same, so noise clears the margin there more easily
         * than a real upgrade does in attack". Measured on GW6 data, over the
         * five-gameweek horizon this engine uses, the points-per-game spread
         * between the 10th and 90th percentile of PLAYING keepers is 21.0
         * points — against 20.0 for midfielders and 21.5 for defenders. Keepers
         * are not interchangeable and that story does not survive contact with
         * the data.
         *
         * What IS structural is the price band. Playing keepers cost £4.5m to
         * £6.1m, a standard deviation of £0.42; midfielders span £4.5m to
         * £11.9m and forwards £5.5m to £15.6m. So a keeper transfer moves no
         * money — it cannot free funds for an upgrade elsewhere and it cannot
         * concentrate them — and the market prices the position so flatly that
         * £4.7m Tzolakis outscores £6.1m Raya. The transfer buys a different
         * keeper and nothing else.
         *
         * The rest of the reason is that managers do not make this move, which
         * is the site owner's call about the product rather than something to
         * be derived. Set at the same size as TW_MIN_FREE_GAIN, so a keeper
         * swap has to be worth about twice what an outfield one does: harder to
         * recommend, which is what was asked, rather than never recommended.
         *
         * Waived entirely when the outgoing keeper is not available — an injury
         * or a suspension is not a reluctant transfer. A keeper who has simply
         * lost his place needs no special case: the engine already projects him
         * near zero over the horizon, so the gain on replacing him clears even
         * the raised bar on its own. */
        const TW_GK_FRICTION = 3.0;

        function twMoveFriction(m) {
            if (!m || !m.out || m.out.position !== 1) return 0;
            if (m.out.status !== 'a') return 0;
            return TW_GK_FRICTION;
        }

        /* Can this player be recommended at all — one answer, four surfaces.
         *
         * The four places that offer a replacement disagreed about doubts.
         * twScanSwaps and findTransferCandidates accepted status 'd' outright,
         * findDraftReplacements did too, and the Transfer Wizard's quick picks
         * refused every 'd' — so a doubtful player was a valid recommendation on
         * step 1 and invisible one click later, with nothing on screen to
         * explain the difference.
         *
         * Neither extreme is right. A 75%-to-play player with a good run is a
         * transfer managers make; a 25% one is not a plan. So the rule is the
         * threshold the site already uses for exactly this judgement —
         * rfEvaluate() in scripts/form-trend.js blocks Rising Form at
         * chanceNextRound < 75 with the reasoning that a flagged doubt "is not a
         * transfer to plan around". Same number here rather than a fifth
         * opinion.
         *
         * A doubt FPL has not quantified (chanceNextRound null) passes: the flag
         * without a figure is how FPL marks a knock it has no update on, and
         * refusing those would drop players who are fit.
         *
         * Minutes are deliberately NOT here. The funnel replaced its floor with
         * a user-facing Minutes chip and the engine still uses a floor, and
         * those differ for a reason a reader can see — a control they set
         * against a default they did not. This is only the part that differed
         * for no reason. */
        const TW_DOUBT_FLOOR = 75;

        function twPlayerAvailable(p) {
            if (!p) return false;
            if (p.status === 'a') return true;
            if (p.status !== 'd') return false;
            return p.chanceNextRound == null || p.chanceNextRound >= TW_DOUBT_FLOOR;
        }

        /* ===== The site's own signals, as an input to who to buy =====
         *
         * The recommender priced every candidate on projected points and
         * nothing else. Rising Form and Purple Patch are computed on this same
         * page, shown on two others, and were not consulted — so the site could
         * put a player in its Rising Form section and ignore him when choosing
         * a transfer, which reads as the two halves not talking to each other.
         *
         * BOUNDED, AND ONLY ON THE RANKING. This never touches gain, gross or
         * net: those are the engine's real projection and are what the card
         * prints. A signal can tip a close call between two candidates; it
         * cannot manufacture a recommendation, because the margin a move has to
         * clear is tested against the unadjusted figure. TW_SIGNAL_MAX is set
         * at half TW_MIN_FREE_GAIN deliberately — large enough to reorder two
         * similar candidates over a five-gameweek horizon, too small to promote
         * one that is materially worse, and smaller than TW_GK_FRICTION so it
         * can never cancel the goalkeeper brake.
         *
         * Both scores are 0-100 at source. A player measurable on only one of
         * them is averaged over the one, rather than halved for the silence of
         * the other — "no purple patch yet" is a statement about the calendar
         * four gameweeks into a season, not about the player.
         *
         * NOT the players page's calculatePositionScore. That ranks who is
         * worth buying in a position and price tier; this asks what swapping
         * one player for another gains over five gameweeks. Different
         * questions, and forcing them together would make that page worse. It
         * also lives in an inline block on fpl-players-analysis.html and is
         * unreachable from here, which is a symptom of the same thing. */
        const TW_SIGNAL_MAX = 1.5;

        /* Built once per recommendation, never per candidate.
         *
         * Rising Form reads player.history — the raw per-gameweek rows — and
         * Purple Patch reads the l5/season windows that buildStatWindows()
         * derives from them. Both are cheap for one player and ruinous done
         * inside twScanSwaps, which evaluates hundreds of candidates for each
         * of fifteen squad players. So the pool is walked once here and the
         * result is a lookup.
         *
         * The history index is a Map rather than the .find() the rest of this
         * file uses on playersDetailData.players: that is a linear scan per
         * candidate, and doing it once per pool instead is the difference
         * between hundreds of thousands of comparisons and six hundred. */
        function twBuildSignalMap(players) {
            const out = new Map();
            const rows = (typeof playersDetailData !== 'undefined' && playersDetailData
                && playersDetailData.players) || [];
            if (!rows.length) return out;

            const histById = new Map();
            rows.forEach(r => histById.set(r.id, (r.history || [])));

            (players || []).forEach(p => {
                const history = histById.get(p.id);
                if (!history || !history.length) return;

                /* A copy with the history and the windows attached. The pool
                   objects come from xpBuildPlayers and carry neither, and
                   mutating them would leak a shape the rest of the page does
                   not expect onto every player in the game. */
                const subject = Object.assign({}, p, { history });
                if (typeof buildStatWindows === 'function') {
                    const w = buildStatWindows(subject, history);
                    if (w) { subject.l5 = w.recent; subject.season = w.season; }
                }

                let rising = null, patch = null, labels = [];
                if (typeof risingFormFor === 'function') {
                    try {
                        const rf = risingFormFor(subject);
                        if (rf && rf.score != null) {
                            rising = rf.score;
                            (rf.signals || []).forEach(s => labels.push(s.label || s.name || 'rising'));
                        }
                    } catch (e) { /* a signal that throws is a signal we do not have */ }
                }
                if (typeof purplePatchFor === 'function') {
                    try {
                        const pp = purplePatchFor(subject);
                        if (pp && pp.patch && pp.sustainability
                            && typeof pp.sustainability.totalScore === 'number') {
                            patch = pp.sustainability.totalScore;
                            labels.push(`purple patch · ${pp.sustainability.verdict || 'run'}`);
                        }
                    } catch (e) { /* as above */ }
                }

                if (rising != null || patch != null) {
                    out.set(p.id, { rising, patch, labels });
                }
            });
            return out;
        }

        // What the signals are worth to an incoming player, in points, bounded.
        function twMoveBoost(m, signals) {
            if (!signals || !m || !m.in) return 0;
            const s = typeof signals.get === 'function' ? signals.get(m.in.id) : null;
            if (!s) return 0;
            const clamp01 = v => Math.max(0, Math.min(1, v / 100));
            const parts = [];
            if (s.rising != null) parts.push(clamp01(s.rising));
            if (s.patch != null) parts.push(clamp01(s.patch));
            if (!parts.length) return 0;
            return (parts.reduce((a, b) => a + b, 0) / parts.length) * TW_SIGNAL_MAX;
        }

        /* The most transfers a single recommendation will ever propose.

           Not a judgement about football — it is the point past which this stops
           being a transfer recommendation and starts being a wildcard draft,
           which is a different screen. The real ceiling in practice is the
           per-move margin below: a fifth move has to add three points of its own
           on top of the four before it, and almost nothing does. */
        const TW_MAX_PLAN = 5;

        /* How much a squad-analysis Sell verdict is worth when ordering otherwise
           comparable moves. Deliberately well under TW_MIN_FREE_GAIN: it decides
           ties between moves the engine already rates similarly, and can never
           promote one that falls short of the margin a transfer has to clear. */
        const TW_FLAGGED_NUDGE = 0.75;

        /* The gameweeks a replacement candidate is priced over, in one place.

           findTransferCandidates ranks on this run, the Replace panel prints a
           delta over it, and buildSuggestedMoves gates on it with
           TW_MIN_FREE_GAIN. They have to be the same weeks. Ranking over one
           horizon and judging over another only moves a disagreement rather than
           ending one, and a list whose order contradicts the number printed on
           its own rows is exactly what this run exists to prevent. */
        function twRunGWs() {
            return typeof twPlanGWs === 'function' ? twPlanGWs(TW_HORIZON) : [];
        }

        /* Free transfers, replayed from a manager's history.

           The official API does not publish the count, so it has to be
           reconstructed: everyone starts on one, each gameweek's transfers are
           deducted, and one is added back at that gameweek's deadline up to the
           cap. Lives here so the squad page and the dashboard replay it
           identically rather than each keeping a copy.

           A WILDCARD OR FREE HIT WEEK FREEZES THE BANK — it does not roll it on.

           This read one too high for any season with a transfer chip in it, and
           the report came from a real account: wildcard in GW4, four free
           transfers on the official site, five here. Five is what you get by
           treating a chip week as an ordinary week that happens to spend
           nothing, which is what this did — it skipped the deduction but still
           added the +1.

           The chip does not merely make that week's transfers free, it IS that
           week's free transfer. So the bank comes out of the week untouched:
           nothing spent, nothing earned. The Premier League's own wording is
           "you'll keep hold of any banked free transfers ... come the following
           gameweek" — keep, not keep and add. Their worked example uses a
           manager already at the cap of five, where freezing and adding give
           the same five, so it settles nothing on its own; the account above
           is below the cap, which is where the two models part. Reproducing
           its real figure is what picked between them.

           Do not "fix" this back by moving the +1 out of the branch again
           without a below-cap count from the official site to justify it. */
        function twDeriveFreeTransfers(rows, chips, maxFT) {
            if (!rows || !rows.length) return 1;
            const chipByEvent = {};
            (chips || []).forEach(ch => { chipByEvent[ch.event] = ch.name; });
            let ft = 1;
            rows.forEach(row => {
                if (row.event === 1) { ft = 1; return; }
                const chip = chipByEvent[row.event];
                if (chip === 'wildcard' || chip === 'freehit') return;   // frozen
                ft = Math.min(maxFT || 5, Math.max(0, ft - (row.event_transfers || 0)) + 1);
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

        /* Projected points, and nothing else.
         *
         * The team-context nudge used to be added here, which meant it was
         * inside lwScore, inside twSquadValue, and therefore inside the gain,
         * gross and net figures the card prints as "xP". On GW Draft, which is
         * the one surface that asks for the nudge, the number labelled xP was
         * xP plus up to 2.5 points of something else.
         *
         * The nudge's own comment gave that away as the reason it stayed
         * opt-in — turning it on everywhere "would quietly change those
         * already-shipped figures". The answer to that is not to keep it off
         * three surfaces, it is to stop it touching figures at all. It is a
         * ranking adjustment now, applied alongside the goalkeeper friction and
         * the Rising Form boost in the one place selections are weighed, so
         * every surface reports pure xP and the nudge can be consistent.
         *
         * The cache key loses its :tc variant with it: there is only one
         * projection for a player over a window now. */
        function twXPCached(player, gws, cache) {
            if (!player) return 0;
            if (cache[player.id] === undefined) {
                cache[player.id] = twXPOver(player, gws);
            }
            return cache[player.id];
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
        function twBuildPool(squad, gws, cache) {
            return squad.map(p => ({
                id: p.id, pos: p.position, lwScore: twXPCached(p, gws, cache), _ref: p
            }));
        }

        /* How many scored candidates to keep per squad player.

           Only the ranking needs all of them; the alternatives offered on the
           card come from the good end of the list, and thirty is far more than
           three diverse options can ever need. The cap is a memory bound, not a
           quality one — the sweep below scores every legal candidate either way,
           because that is the expensive part and it has already happened. */
        const TW_SCAN_KEEP = 30;

        /* Every legal replacement for one squad player, best first.
           Scored on what the swap does to the squad's total, not to the player's. */
        function twScanSwaps(out, ctx) {
            const budget = (out.sellPrice || out.price) + ctx.bank;
            const outXP = twXPCached(out, ctx.gws, ctx.cache);
            const slot = ctx.pool.findIndex(e => e.id === out.id);
            if (slot < 0) return [];

            const trial = ctx.pool.slice();
            const found = [];

            for (const cand of allPlayers) {
                if (cand.position !== out.position) continue;
                if (cand.price > budget) continue;
                if (ctx.ownedIds.has(cand.id)) continue;
                // One rule for doubts across all four surfaces — see twPlayerAvailable.
                if (!twPlayerAvailable(cand)) continue;
                if (cand.minutes < minMinutesForCandidate()) continue;
                const held = (ctx.clubCount[cand.teamId] || 0) - (cand.teamId === out.teamId ? 1 : 0);
                if (held >= 3) continue;

                const inXP = twXPCached(cand, ctx.gws, ctx.cache);
                trial[slot] = { id: cand.id, pos: cand.position, lwScore: inXP, _ref: cand };
                const gain = twSquadValue(trial) - ctx.baseValue;

                found.push({ out, in: cand, gain, outXP, inXP,
                             // Individual delta, kept so the card can explain the
                             // difference between the two figures when they diverge.
                             rawDelta: inXP - outXP,
                             outStarts: ctx.baseXIIds.has(out.id) });
            }
            trial[slot] = ctx.pool[slot];
            return found.sort((a, b) => b.gain - a.gain).slice(0, TW_SCAN_KEEP);
        }

        // Best legal replacement for one squad player, or null if there is none.
        function twBestSwapFor(out, ctx) {
            return twScanSwaps(out, ctx)[0] || null;
        }

        /* Three ways to use the same slot, rather than one answer three times.
         *
         * The recommender is deterministic and always was: it keeps the single
         * highest-gain replacement for each player, so the same squad against the
         * same data returns the same move every time. That is correct — there is
         * one best move and picking a worse one at random to look lively would be
         * dishonest — but it is not the whole truth, because the second and third
         * best are usually a different KIND of move rather than a worse one.
         *
         * So the alternatives are chosen by what they do to the bank, which is
         * the choice a manager is actually making. The best move sets the
         * reference price; one option spends meaningfully less than it and one
         * meaningfully more, each the strongest of its band. A player who frees
         * £2m for next week and a player who spends the lot are genuinely
         * different plans, and ranking them on gain alone hides that.
         *
         * Every option is real and legal — same filters, same scoring, same
         * squad-total maths. The gain printed on each is its own. */
        function twDiversifySwaps(all, k) {
            /* Local, so the function can be lifted into a test on its own — and
               it is used nowhere else. A gap smaller than this is the same move
               at the same money, not a cheaper way to spend the slot. */
            const PRICE_STEP = 0.5;
            if (!all || !all.length) return [];
            const want = k == null ? 3 : k;
            const top = all[0];
            const picks = [Object.assign({ altKind: 'best' }, top)];
            const used = new Set([top.in.id]);

            const take = (kind, found) => {
                if (!found || used.has(found.in.id) || picks.length >= want) return;
                picks.push(Object.assign({ altKind: kind }, found));
                used.add(found.in.id);
            };
            // `all` is sorted by gain, so the first match in a band is the best of it.
            take('cheaper', all.find(c => c.in.price <= top.in.price - PRICE_STEP));
            take('pricier', all.find(c => c.in.price >= top.in.price + PRICE_STEP));
            for (const c of all) {
                if (picks.length >= want) break;
                take('next', c);
            }
            return picks.slice(0, want);
        }

        function twAltSwapsFor(out, ctx, k) {
            return twDiversifySwaps(twScanSwaps(out, ctx), k);
        }

        /* HOW MANY TRANSFERS, as a function of its inputs.
         *
         * Lifted out of twBuildRecommendation so the one decision a manager
         * actually argues with can be tested without a squad, a projection
         * engine or a lineup solver. Everything it needs to know about the world
         * arrives as two callbacks: jointGain(moves) prices a set, legal(moves)
         * says whether the set is affordable and inside the three-per-club
         * limit. Both are closures over the pool in the caller.
         *
         * WHAT IT USED TO DO, and why a manager with four free transfers was
         * told to make two every single week. The option set was hard-coded to
         * one move and two — the best, and the best second on a different
         * player. With four banked, costFor(1) and costFor(2) are both zero; the
         * joint gain of a pair is never less than the better half alone; and
         * both options were measured against the same flat 3.0 margin, which the
         * first move had already covered. So the second move only had to add
         * something rather than nothing, and n = 2 won by construction rather
         * than by being right.
         *
         * Raising the ceiling alone would only move the problem up — the same
         * arithmetic recommends four. Two things fix it together:
         *
         *   THE CHAIN is greedy on the real joint gain. Each step asks which
         *   remaining move adds most to the package as a whole, not which has
         *   the best solo gain, because solo gains double-count: two moves that
         *   each promote the same bench player into the eleven both claim that
         *   improvement. Greedy rather than exhaustive — the full search is
         *   every subset of fifteen, on every render — and step one is pinned to
         *   the move the caller's ranking already chose, so the flagged-verdict
         *   tie-break above survives untouched.
         *
         *   THE MARGIN is per step. Every move is judged on what IT adds, net of
         *   what IT costs: three points for a free transfer, four for one taking
         *   a hit, on top of the four-point hit itself. The chain stops at the
         *   first step that cannot clear its own bar, because every later step is
         *   built on top of it. A squad with one obvious move and three marginal
         *   ones returns one move, which is what four free transfers should
         *   usually produce.
         *
         * Unavailable players stay exempt, per step rather than per package: one
         * injured starter must not wave three speculative moves through behind
         * him, which is what the old `moves.some(unavailable)` did.
         *
         * Returns the whole chain plus how far down it is worth going, so the
         * caller can hand every option to the card and still know which one the
         * verdict is. */
        function twPlanChain(moves, o) {
            const opts = o || {};
            const ft = opts.ft || 0;
            const jointGain = opts.jointGain;
            const legal = opts.legal || (() => true);
            /* Injectable so a test can state the friction it is testing rather
               than import the live constant and assert against whatever it
               happens to be this week. */
            const friction = opts.friction || (typeof twMoveFriction === 'function' ? twMoveFriction : () => 0);
            /* Ranking only. Deliberately absent from the margin test below: a
               signal reorders two similar candidates, it does not lower the bar
               a transfer has to clear. See TW_SIGNAL_MAX. */
            const boost = opts.boost || (() => 0);
            const costFor = n => Math.max(0, n - ft) * 4;
            const maxN = Math.min(opts.maxPlan || TW_MAX_PLAN, Math.max(2, ft + 1));

            const chain = [];
            const usedOut = new Set(), usedIn = new Set();
            let prevGross = 0;

            for (let n = 1; n <= maxN; n++) {
                const base = chain.length ? chain[chain.length - 1].moves : [];
                const consider = n === 1 ? moves.slice(0, 1) : moves;
                let pick = null, pickGross = -Infinity, pickRank = -Infinity;
                for (const m of consider) {
                    if (usedOut.has(m.out.id) || usedIn.has(m.in.id)) continue;
                    const trial = base.concat([m]);
                    if (!legal(trial)) continue;
                    const gross = jointGain(trial);
                    // Ranked on the gain less the move's own reluctance, so the
                    // same friction that orders step one orders the rest.
                    const rank = gross - friction(m) + boost(m);
                    if (rank > pickRank) { pickRank = rank; pickGross = gross; pick = m; }
                }
                if (!pick) break;
                usedOut.add(pick.out.id);
                usedIn.add(pick.in.id);
                const cost = costFor(n);
                chain.push({
                    n, moves: base.concat([pick]), gross: pickGross, cost,
                    net: pickGross - cost,
                    // What this move alone added, and what it alone cost.
                    step: pick, stepGain: pickGross - prevGross, stepCost: cost - costFor(n - 1)
                });
                prevGross = pickGross;
            }

            const unavailable = m => m.out.status === 'i' || m.out.status === 'u' || m.out.status === 's';
            let depth = 0;
            for (const opt of chain) {
                if (!unavailable(opt.step)) {
                    if (opts.freeTransfersOnly && opt.stepCost > 0) break;
                    const margin = opt.stepCost > 0 ? TW_MIN_HIT_GAIN : TW_MIN_FREE_GAIN;
                    // Plus whatever this move costs in reluctance — a keeper
                    // swap has to be worth about twice an outfield one.
                    if (opt.stepGain - opt.stepCost - friction(opt.step) < margin) break;
                }
                depth = opt.n;
            }
            return { chain, depth };
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
            /* Once, before any scanning. See twBuildSignalMap. */
            const signals = twBuildSignalMap(typeof allPlayers !== 'undefined' ? allPlayers : []);
            const signalBoost = m => twMoveBoost(m, signals);
            const pool = twBuildPool(squad, gws, cache);
            const baseXI = typeof solveQuickLineup === 'function' ? solveQuickLineup(pool).xi : pool.slice(0, 11);

            const ctx = {
                gws,
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
            const clearsBar = m => (m.gain - cost1 - twMoveFriction(m)) >= margin1;

            /* Ranked on what each move is worth less what it costs in
               reluctance, so a keeper swap only reaches the top of the list by
               beating the best outfield move outright rather than by a point.
               See twMoveFriction: this is the same penalty the margin applies,
               and applying it here as well is what stops the pinned first step
               being a keeper the viability test would then refuse — which would
               have returned "hold" while a perfectly good outfield move sat two
               rows down. */
            /* Everything that moves a selection without moving a projection,
               in one expression: the keeper brake, the site's own signals, and
               the team-context nudge the draft asks for. The nudge is a delta
               because it used to be added to both ends inside the projection,
               so the gain already netted the two — in minus out is the faithful
               translation, and it leaves gain itself pure xP. */
            const teamCtx = o.useTeamContext
                ? m => twTeamContextNudge(m.in) - twTeamContextNudge(m.out)
                : () => 0;
            const rankOf = m => m.gain - twMoveFriction(m) + signalBoost(m) + teamCtx(m);
            const byGain = squad.map(p => twBestSwapFor(p, ctx))
                .filter(Boolean)
                .sort((a, b) => rankOf(b) - rankOf(a));

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

            // See twPlanChain: how many transfers, and why this used to always
            // answer two for a manager holding four.
            const { chain, depth } = twPlanChain(moves, {
                ft, jointGain: twJointGain, legal: twMovesLegal,
                boost: m => signalBoost(m) + teamCtx(m),
                freeTransfersOnly: o.freeTransfersOnly
            });

            const options = [{ n: 0, moves: [], gross: 0, cost: 0, net: 0 }].concat(chain);

            /* `depth` is how far down the chain is worth going — each move
               clearing its own margin, with unavailable players exempt. The
               rule lives in twPlanChain; what belongs here is why one of its
               inputs exists.

               o.freeTransfersOnly drops any hit-taking step outright, must-sells
               aside. For an automated bulk run across several gameweeks at once,
               nobody reviewed any single one of those hits, so "clears its
               margin" is not consent to spend points on it. A manager reviewing
               one gameweek by hand still sees hit-taking options; this only
               narrows what an unattended loop may pick for itself.

               Everything below `depth` still travels in `options`, so the card
               can offer a bigger plan it did not recommend. */
            const viable = [options[0]].concat(chain.slice(0, depth));

            const best = viable.sort((a, b) => b.net - a.net || a.n - b.n)[0];

            /* The alternatives for each slot that made the cut, attached only
               now — scanning is the expensive half of this function and there is
               no sense doing it for moves the verdict discarded. alts[0] is the
               move itself, because both come off the top of the same scan. */
            if (best && best.moves.length) {
                best.moves.forEach(m => {
                    m.alts = twAltSwapsFor(m.out, ctx, 3);
                    /* Which of the site's own signals fired on the incoming
                       player, so the card can show its working. A thumb on the
                       scale nobody can see is indistinguishable from a bug. */
                    const s = signals.get(m.in.id);
                    m.inSignals = s ? s.labels.slice(0, 3) : [];
                    m.inSignalBoost = Math.round(signalBoost(m) * 100) / 100;
                });
            }

            /* Handed out so the card can let a manager pick a different option
               without the headline going stale.
             *
             * Two moves are not independent — if both promote a bench player
             * into the same eleven their separate gains double-count the same
             * improvement — so a swapped option cannot simply have its own gain
             * added. Re-scoring is the only honest answer, and it needs the
             * pool and the base value that only exist in this closure. Handing
             * the closures out costs nothing and means the number on screen is
             * always the one the engine would have produced for that set.
             *
             * legality travels with it for the same reason: two options that
             * are each affordable against the full bank may not be affordable
             * together, and two from the same club can breach the three-per-club
             * limit jointly while each looks fine alone. */
            return { best, options, moves: moves.slice(0, 5), gws, ft, horizon: TW_HORIZON,
                     rescore: twJointGain, legal: twMovesLegal,
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

        /* ===== Scoring a swap, and the three models behind it =====

           Lifted out of transfer-wizard.js for exactly the reason the rest of
           this file was: Squad Analysis scores with all of it on the default
           tab. pitch-snapshot.js ranks the Replace panel with
           findTransferCandidates(), panels-and-tabs.js prices the shortlist
           with it, team-analysis-core.js draws the momentum panel from
           getTransferPressure(), and compare-report.js asks
           getCleanSheetProb() for every defender it compares. None of it is
           the wizard's, and leaving it there is what kept 133KB of wizard on
           the critical path of a screen it has nothing to do with.

           The dashboard loads this file and calls none of these six, so the
           dependency note at the top still describes what twBuildRecommendation()
           needs; these six additionally want teamAnalysis, userSettings and
           isPreseason, which only the squad page provides. */
        // Recency-weighted average, Transfer Wizard flavor: pre-filters to played-minutes
        // games before windowing. Named distinctly from the shared recencyWeightedAvg() in
        // scripts/compare-report.js (which windows raw, unfiltered history) to avoid the two
        // same-named function declarations silently overriding each other at global scope.
        function twRecencyWeightedAvg(history, key, n = 5) {
            if (!history || history.length === 0) return 0;
            const played = history.filter(h => h.minutes > 0);
            const window = played.slice(-n);
            if (window.length === 0) return 0;
            const weights = window.map((_, i) => i + 1);
            const wSum = weights.reduce((a, b) => a + b, 0);
            let total = 0;
            window.forEach((h, i) => { total += (parseFloat(h[key]) || 0) * weights[i]; });
            return total / wSum;
        }

        function getCleanSheetProb(teamId, opponentId, isHome) {
            const tp = teamAnalysis[teamId], op = teamAnalysis[opponentId];
            if (!tp || !op) return 0.25;
            let base = isHome ? 0.35 : 0.25;
            const teamDef = tp.defensePower || 50;
            const oppAtk = op.attackPower || 50;
            base += (teamDef - 50) * 0.003;
            base -= (oppAtk - 50) * 0.0025;
            const avgLeagueGApg = 1.3;
            base += (avgLeagueGApg - (tp.avgConceded || 1.3)) * 0.04;
            return Math.max(0.05, Math.min(0.65, base));
        }

        // Transfer Score — multi-factor ranking for replacement candidates
        // (Aligned with players-analysis calculatePositionScore for consistent recommendations)
        function calculateTransferScore(player, pos) {
            const posNames = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
            const posName = posNames[pos] || 'MID';

            // Get player history for recency weighting
            const pd = playersDetailData?.players?.find(p => p.id === player.id);
            const history = pd?.history?.filter(h => h.minutes > 0) || [];
            const recent = getPlayerRecentStats(player.id, 5);

            const seasonGames = Math.max(currentGW - 1, 1);
            const recentGames = recent?.games || 1;
            const minsPerGame = recent ? (recent.minutes / recentGames) : (player.minutes / seasonGames);
            const nailedBonus = Math.min(5, Math.max(0, (minsPerGame - 60) / 4));

            // ── Recency-weighted per-game stats (most recent games count more) ──
            const rwPtsPerGame = history.length > 0 ? twRecencyWeightedAvg(history, 'total_points') : (recent ? recent.ppg : player.ppg);
            const rwXGI = history.length > 0 ? twRecencyWeightedAvg(history, 'expected_goal_involvements') : (recent ? recent.xGIPer90 : (player.minutes > 0 ? (player.xGI / player.minutes) * 90 : 0));
            const rwXG = history.length > 0 ? twRecencyWeightedAvg(history, 'expected_goals') : (recent ? recent.xGPer90 : (player.minutes > 0 ? (player.xG / player.minutes) * 90 : 0));
            const rwXA = history.length > 0 ? twRecencyWeightedAvg(history, 'expected_assists') : (recent ? recent.xAPer90 : (player.minutes > 0 ? (player.xA / player.minutes) * 90 : 0));
            const rwBonus = history.length > 0 ? twRecencyWeightedAvg(history, 'bonus') : (recent ? (recent.bonus / recentGames) : (player.bonus / seasonGames));
            const csPerGame = recent ? (recent.cs / recentGames) : (player.cleanSheets / Math.max(player.starts || seasonGames, 1));

            const value = rwPtsPerGame / Math.max(player.price, 3.5);

            // Season phase for value weight adjustment
            const phase = currentGW >= 30 ? 'late' : (currentGW >= 15 ? 'mid' : 'early');
            const valueWeight = phase === 'late' ? (posName === 'GK' ? 8 : 6) : (posName === 'GK' || posName === 'DEF') ? 10 : 12;

            // ── Fixture factor — weighted next 3 fixtures (3/2/1) with opponent quality ──
            const fixtures = player.fixtures || teamFixtures[player.teamId] || [];
            const fixtureWeights = [3, 2, 1];
            let fixtureFactor = 0;
            let venueMultiplier = 1.0;

            if (fixtures.length > 0) {
                let totalWeight = 0, weightedFixture = 0;
                fixtures.slice(0, 3).forEach((f, idx) => {
                    const w = fixtureWeights[idx] || 1;
                    const opp = f.opponentId;
                    const isHome = f.isHome;
                    let ff = 0;
                    if (opp && teamAnalysis[opp]) {
                        const oppAttack = teamAnalysis[opp].attackPower || 50;
                        const oppDefense = teamAnalysis[opp].defensePower || 50;
                        const relevantOpp = (pos <= 2) ? oppAttack : oppDefense;
                        ff = ((50 - relevantOpp) / 50) * 10;
                        if (isHome) ff += 1.5;
                    } else {
                        const fdr = f.difficulty || 3;
                        ff = Math.max(-10, (3.5 - fdr) * 8);
                    }
                    weightedFixture += ff * w;
                    totalWeight += w;
                });
                fixtureFactor = totalWeight > 0 ? weightedFixture / totalWeight : 0;

                // ── Dynamic venue multiplier based on home/away splits ──
                const nextIsHome = fixtures[0]?.isHome ?? null;
                if (nextIsHome !== null && history.length >= 4) {
                    const recentWindow = history.slice(-5);
                    const splitGames = recentWindow.filter(h => h.was_home === nextIsHome);
                    if (splitGames.length >= 2) {
                        const splitPts = splitGames.reduce((s, h) => s + (h.total_points || 0), 0) / splitGames.length;
                        const overallPts = recentWindow.reduce((s, h) => s + (h.total_points || 0), 0) / recentWindow.length;
                        if (overallPts > 0) {
                            venueMultiplier = 0.7 + 0.3 * (splitPts / overallPts);
                            venueMultiplier = Math.max(0.8, Math.min(1.25, venueMultiplier));
                        }
                    } else {
                        venueMultiplier = nextIsHome ? 1.05 : 0.95;
                    }
                } else {
                    venueMultiplier = (fixtures[0]?.isHome) ? 1.05 : 0.95;
                }
            }

            // ── Team context factors ──
            const ta = teamAnalysis[player.teamId];
            let teamFormFactor = 0, teamQualityFactor = 0;
            if (ta) {
                teamFormFactor = ((ta.formRating || 50) - 50) / 50 * 3;
                teamQualityFactor = pos <= 2
                    ? ((ta.defensePower || 50) - 50) / 50 * 4
                    : ((ta.attackPower || 50) - 50) / 50 * 4;
            }

            // ── CS Probability factor (GK/DEF) — weighted across next 3 fixtures ──
            let csProbFactor = 0;
            if (pos <= 2 && fixtures.length > 0) {
                let csTotal = 0, csWeightTotal = 0;
                fixtures.slice(0, 3).forEach((f, idx) => {
                    const w = fixtureWeights[idx] || 1;
                    if (f.opponentId) {
                        const prob = getCleanSheetProb(player.teamId, f.opponentId, f.isHome);
                        csTotal += prob * w;
                        csWeightTotal += w;
                    }
                });
                if (csWeightTotal > 0) {
                    const avgProb = csTotal / csWeightTotal;
                    csProbFactor = (avgProb - 0.28) * 35;
                }
            }

            // ── Advanced penalty taker detection ──
            let penTakerBonus = 0;
            if (pos >= 2) {
                const totalGoals = player.goals || 0;
                const seasonPenGoals = Math.max(0, totalGoals - (player.xG || 0));
                const penMissed = 0; // not available in bootstrap data
                const penThreshold = { DEF: 0.5, MID: 1.0, FWD: 1.5 }[posName] || 1.0;
                const penAttempts = (seasonPenGoals >= penThreshold || penMissed > 0)
                    ? Math.round(seasonPenGoals + penMissed) : 0;
                const penRatio = totalGoals > 0 ? seasonPenGoals / totalGoals : 1;
                if (penAttempts >= 2 && penRatio > 0.25) {
                    penTakerBonus = Math.min(6, penAttempts * 1.5);
                } else if (seasonGames >= 10 && penAttempts >= 1 && penRatio > 0.25) {
                    penTakerBonus = Math.min(4, penAttempts * 1.5);
                }
            }

            // ── Rotation risk penalty ──
            let rotationPenalty = 0;
            if (player.teamId && teamFixtures[player.teamId]) {
                const upcomingFixtures = teamFixtures[player.teamId].slice(0, 4);
                const hasCongestion = upcomingFixtures.length >= 3;
                if (hasCongestion && minsPerGame < 85) {
                    rotationPenalty = -2;
                }
            }

            // ── Enhancement bonuses (inspired by players-analysis calculatePositionScore) ──
            // Rising form: compare L3 ppg vs season ppg
            let risingFormBonus = 0;
            const recentPpg = recent ? recent.ppg : 0;
            const seasonPpg = player.ppg || 0;
            if (seasonPpg > 1) {
                const formRatio = recentPpg / seasonPpg;
                if (formRatio > 1.3) risingFormBonus = 3;
                else if (formRatio > 1.15) risingFormBonus = 1.5;
            }

            // Routes-to-points diversity
            let routeCount = 0;
            if (rwXG > 0.1) routeCount++;
            if (rwXA > 0.1) routeCount++;
            if (rwBonus > 0.3) routeCount++;
            if (pos <= 2 && csPerGame > 0.2) routeCount++;
            const routeBonus = Math.max(0, (routeCount - 1) * 1.5);

            // Reliability (low variance in recent scores)
            let reliabilityBonus = 0;
            if (history.length >= 4) {
                const recentScores = history.slice(-5).map(h => h.total_points || 0);
                const avg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
                if (avg > 3) {
                    const variance = recentScores.reduce((s, v) => s + (v - avg) ** 2, 0) / recentScores.length;
                    reliabilityBonus = Math.max(0, 3 - Math.sqrt(variance) * 0.5);
                }
            }

            const commonBonuses = risingFormBonus + routeBonus + reliabilityBonus;

            // ── Position-specific scoring formulas ──
            if (posName === 'GK') {
                const savesPer90 = recent ? recent.savesPer90 : (player.minutes > 0 ? (player.saves / player.minutes) * 90 : 0);
                const xGCPerGame = recent ? (recent.xGC / recentGames) : (player.minutes > 0 ? (player.xGC / player.minutes) * 90 : 0);
                const defScore = Math.max(0, (2 - xGCPerGame)) * 8;

                return ((csPerGame * 30) +
                       (savesPer90 * 2) +
                       defScore +
                       (rwPtsPerGame * 3) +
                       (value * valueWeight) +
                       fixtureFactor +
                       teamQualityFactor +
                       teamFormFactor +
                       csProbFactor +
                       rotationPenalty +
                       nailedBonus +
                       commonBonuses) * venueMultiplier;
            }

            if (posName === 'DEF') {
                const xGCPerGame = recent ? (recent.xGC / recentGames) : (player.minutes > 0 ? (player.xGC / player.minutes) * 90 : 0);
                const defScore = Math.max(0, (2 - xGCPerGame)) * 8;

                return ((csPerGame * 25) +
                       defScore +
                       (rwXGI * 12) +
                       (rwPtsPerGame * 3) +
                       (value * valueWeight) +
                       fixtureFactor +
                       teamQualityFactor +
                       teamFormFactor +
                       csProbFactor +
                       rotationPenalty +
                       penTakerBonus +
                       nailedBonus +
                       commonBonuses) * venueMultiplier;
            }

            if (posName === 'MID') {
                const actualGI = recent ? ((recent.goals + recent.assists) / recentGames) : 0;
                const overPerf = actualGI - rwXGI;
                const regressionAdj = overPerf > 0 ? overPerf * -3 : overPerf * -2;

                return ((rwXGI * 40) +
                       regressionAdj +
                       (csPerGame * 3) +
                       (rwPtsPerGame * 3) +
                       (rwBonus * 2) +
                       (value * valueWeight) +
                       fixtureFactor +
                       teamQualityFactor +
                       teamFormFactor +
                       rotationPenalty +
                       penTakerBonus +
                       nailedBonus +
                       commonBonuses) * venueMultiplier;
            }

            // FWD
            const actualGoals = recent ? (recent.goals / recentGames) : 0;
            const overPerf = actualGoals - rwXG;
            const regrCoeff = (overPerf > 0 && seasonGames >= 15 && (player.goals / seasonGames) > (player.xG / seasonGames)) ? -2 : -4;
            const regressionAdj = overPerf > 0 ? overPerf * regrCoeff : overPerf * -2;

            return ((rwXG * 40) +
                   (rwXA * 15) +
                   regressionAdj +
                   (rwPtsPerGame * 3) +
                   (rwBonus * 2) +
                   (value * valueWeight) +
                   fixtureFactor +
                   teamQualityFactor +
                   teamFormFactor +
                   rotationPenalty +
                   penTakerBonus +
                   nailedBonus +
                   commonBonuses) * venueMultiplier;
        }

        // Find replacement candidates for a position within budget
        // blockedClubs is optional and only the Control Room market passes it: teams
        // you already hold three of. Filtering here rather than after the slice(0, 30)
        // below matters — a full club can own a lot of the top of the list, and
        // trimming afterwards would silently shorten the recommendations.
        function findTransferCandidates(position, maxPrice, excludeIds, blockedClubs) {
            const candidates = allPlayers.filter(p =>
                p.position === position &&
                p.price <= maxPrice &&
                !excludeIds.has(p.id) &&
                !(blockedClubs && blockedClubs.has(p.teamId)) &&
                twPlayerAvailable(p) &&
                p.minutes >= minMinutesForCandidate()
            );

            /* Ranked on projected points, not on the transfer score.

               calculateTransferScore returns a number in units of its own, and
               every surface that consumes this list then labels the rows with the
               xP engine — so the order and the figure printed on it came out of
               two different models and could contradict each other outright. The
               players page hit the same thing and fixed it there: across 200
               players the ratio between its two models ran from 0.0 to 23.9, which
               put cards on screen in an order their own badge disagreed with.
               buildSuggestedMoves in pitch-snapshot.js used to be worse off
               still — it said "ranked by xP gained per transfer" and then took
               [0] off a list that was not, so a better candidate two rows down
               was never looked at. THAT IS FIXED: it prices over twRunGWs()
               with twXPOver and gates on TW_MIN_FREE_GAIN, and this list is
               ordered by _xpRun, so [0] is now the best projected candidate and
               the sentence is true. Kept as history because the shape of the
               mistake — a comment asserting an order the code did not produce —
               is the one this file keeps making.

               _transferScore is still computed and still on the object. The
               package strategies below blend it against price and ownership on its
               own scale, and the card prints it as a second reading; here it
               breaks ties between candidates that project identically. */
            const runGWs = typeof twRunGWs === 'function' ? twRunGWs() : [];
            const canProject = runGWs.length > 0
                && typeof xpEngineReady === 'function' && xpEngineReady();

            candidates.forEach(c => {
                c._transferScore = calculateTransferScore(c, c.position);
                c._xpRun = canProject ? twXPOver(c, runGWs) : null;
                // Get recent stats for display
                c._recentStats = getPlayerRecentStats(c.id, 5);
            });

            /* No engine, no fixtures left to project, or the globals it reads not
               loaded yet: fall back to the old ordering whole. Sorting everyone by
               an identical zero would be worse than the score this replaces. */
            candidates.sort(canProject
                ? (a, b) => (b._xpRun - a._xpRun) || (b._transferScore - a._transferScore)
                : (a, b) => b._transferScore - a._transferScore);

            return candidates.slice(0, 30); // Top 30 per slot
        }

        function getTransferPressure(player) {
            const owners = Math.max(totalFplPlayers * (player.ownership / 100), 1);
            const net = player.transfersIn - player.transfersOut;
            return net / owners;
        }

        function getPressureLabel(pressure) {
            if (pressure > 0.04) return { text: 'Hot', cls: 'rise' };
            if (pressure > 0.015) return { text: 'Rising', cls: 'rise' };
            if (pressure < -0.04) return { text: 'Dropping', cls: 'fall' };
            if (pressure < -0.015) return { text: 'Cooling', cls: 'fall' };
            return { text: 'Stable', cls: 'stable' };
        }

        /* ===== The number solveQuickLineup() above sorts on =====

           solveQuickLineup() picks an XI by p.lwScore; this is what produces
           it, and it was in lineup-wizard.js — so the two halves of one
           calculation sat in different files, and the half Squad Analysis
           needs was in the half that only the Lineup Wizard tab loads.
           pitch-snapshot.js calls it for every player on the default tab. */
        // ── LINEUP WIZARD: Detailed Score Breakdown ──
        function computeQuickLineupScoreDetailed(p) {
            const result = { total: 0, ep: 0, form: 0, fixture: 0, home: 0, xgi: 0, minutes: 0, ppg: 0, doubtful: 0, matchup: 0 };
            if (p.status === 'i' || p.status === 'u' || p.status === 's') { result.total = -100; return result; }
            if (p.status === 'd') result.doubtful = -20;
            result.ep = Math.round((p.epNext || 0) * 3 * 10) / 10;
            // Preseason: FPL resets form to 0.0, fall back to last season's PPG —
            // same pattern as analyzePlayer's effectiveForm
            const effectiveForm = isPreseason ? (p.ppg || 0) : (parseFloat(p.form) || 0);
            result.form = Math.round(effectiveForm * 2 * 10) / 10;
            const fx = p.fixtures || [];
            if (fx.length > 0) { result.fixture = Math.round((3 - fx[0].difficulty) * 5 * 10) / 10; if (fx[0].isHome) result.home = 2; }
            const mins = p.minutes || 0;
            if (mins > 200) { result.xgi = Math.round(((p.xGI / mins) * 90) * 10 * 10) / 10; }
            // computePlayerGamesPlayed already handles the preseason case — last
            // season's starts/minutes instead of dividing by 0 completed GWs
            const mpg = mins / computePlayerGamesPlayed(p);
            if (mpg >= 85) result.minutes = 3;
            else if (mpg < 45) result.minutes = -5;
            // FPL's own points-per-game — already correct pre- and in-season, unlike
            // dividing the raw season total by (currentGW - 1), which blows up to
            // hundreds of "points" during preseason when currentGW - 1 is 0.
            result.ppg = Math.round((p.ppg || 0) * 1.5 * 10) / 10;
            // Team Attack/Defense power vs. the next opponent's respective rating — the
            // explicit team-context matchup factor section 9 asks for, on top of the
            // generic FDR-based `fixture` term above. Same teamAnalysis data already used
            // everywhere else on this page (detail panel, calculateTransferScore, etc.).
            if (fx.length > 0 && fx[0].opponentId && teamAnalysis[fx[0].opponentId]) {
                const opp = teamAnalysis[fx[0].opponentId];
                const relevantOppPower = (p.position <= 2) ? (opp.attackPower || 50) : (opp.defensePower || 50);
                result.matchup = Math.round(((50 - relevantOppPower) / 50) * 6 * 10) / 10;
            }
            result.total = Math.round(result.ep + result.form + result.fixture + result.home + result.xgi + result.minutes + result.ppg + result.doubtful + result.matchup);
            return result;
        }
