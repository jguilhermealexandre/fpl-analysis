/* ============================================
   EasyFPL — the wildcard builder

   The Transfer Wizard answers "is one move worth making". A wildcard asks a
   different question that none of the existing engines could answer: given the
   whole budget and no cost to changing anything, what fifteen players should I
   own — and what does it cost me to own two premiums instead of one?

   Three plans come back rather than one, split on the axis a manager actually
   argues about: no premium, one premium, two premiums. They are not three
   flavours of the same squad. Each is the best squad the model can build under
   that constraint, and each reports what the constraint cost against the
   unconstrained optimum. "Two premiums is 1.8 points worse over six gameweeks
   and puts 34% of your budget in two players" is the answer to the question;
   three unlabelled squads are not.

   WHAT THE MODEL IS

   Squad value over the window, where a squad is worth what the pitch pays it:

       V = Σ_gw  w_gw × [ Σ_XI xp + max_XI xp + β·Σ_bench xp ]

   Three deliberate choices in there, each of which moves the premium answer:

   1. THE CAPTAIN IS IN THE OBJECTIVE. max_XI adds a second copy of the best
      player that week, because the armband doubles him. Without this term a
      model prices premiums as luxuries and will never recommend one — the
      whole "should I own Haaland" question is largely a captaincy question,
      and a builder that cannot see the armband cannot answer it.

   2. THE ELEVEN IS RE-SOLVED EVERY GAMEWEEK, not once for the window. This is
      what makes a squad that covers a blank beat a squad that looks better in
      aggregate and can only field nine players in the week that matters. It
      also lets the captain change week to week, which is what really happens.

   3. THE WINDOW DECAYS. Six gameweeks, weighted 1.0 down to about 0.66. A
      wildcard is a longer commitment than a transfer — TW_HORIZON is five —
      but gameweek six's fixture difficulty is a guess, and weighting it like
      gameweek one pretends otherwise.

   WHAT FEEDS IT

   Almost everything, through scripts/xp-engine.js, which already folds in
   opponent defensive quality per fixture, venue splits, expected goals against
   blended with the betting market, regressed per-90 rates, the minutes model,
   defensive contribution, saves, bonus and cards. Doubles and blanks come out
   right because projectPlayerPointsForGW handles them.

   Two things it does NOT carry, added here as bounded multipliers rather than
   as new terms in the projection, so they can shade a decision and never drive
   one:

     wcFormMultiplier      player recency. regressedPer90 uses SEASON totals, so
                           a player quiet in August and scoring now reads the
                           same as the reverse. ±12%.
     wcTeamFormMultiplier  team recent results. ±8%.

   The team nudge deliberately reads ONLY formRating, not attackPower or
   fixtureScore, unlike twTeamContextNudge in scripts/transfer-engine.js. Those
   two are already inside the projection — expectedGoalsAgainst and
   fixtureAttackAdj are built from them — so folding them in again would count
   the same evidence twice. Recent results are the part the projection genuinely
   cannot see.

   HOW IT SEARCHES

   Picking fifteen from six hundred under a budget, position quotas and a
   three-per-club cap is a multi-dimensional knapsack. There is no solver in the
   browser and none is needed:

     1. Precompute an xP matrix, player × gameweek, once. Everything downstream
        reads it. Without this the local search re-projects millions of times.
     2. Prune. Status, minutes, then Pareto dominance within each (position,
        club) — provably safe under a three-per-club cap, see wcParetoPrune.
     3. Seed with an exact budget DP per position, convolved over spend across
        the four positions, for each formation and each choice of premium.
     4. Score every seed on the REAL objective, keep the best few, and
        hill-climb only those.

   Step 4 is where the cost is, which is why step 3 produces many cheap seeds
   and step 4 polishes three of them rather than all hundred-odd. The DP is a
   seed, not the answer: a max over the eleven is not separable, so the DP
   optimises a simplified objective and the climb optimises the real one.

   This lands close to optimal, not at it. Given the projections carry far more
   uncertainty than the last fraction of a point, chasing exactness with a real
   solver would be precision the inputs do not deserve — the plans are labelled
   as strong builds, not as the best possible squad.

   Prefix wc*. Plain globals in a classic script. NO DOM — rendering lives in
   scripts/transfer-wizard.js so this file stays testable in node.

   DEPENDENCIES the host page must provide:

     allPlayers                the full pool, shaped as the xP engine expects
     teamAnalysis              for the team-form multiplier
     projectPlayerPointsForGW  scripts/xp-engine.js
     xpPlanGWs                 scripts/xp-engine.js
     computePlayerGamesPlayed  scripts/xp-engine.js
     minMinutesForCandidate    optional; transfer-engine.js installs a fallback
     teams                     optional, for club labels in the report
   ============================================ */

        /* ===== Shape of the problem ===== */

        const WC_QUOTA = { 1: 2, 2: 5, 3: 5, 4: 3 };
        const WC_MAX_PER_CLUB = 3;
        // Same eight the lineup solver uses. Kept as its own copy rather than
        // read from solveQuickLineup's local, which is not exported.
        const WC_FORMATIONS = [[3, 4, 3], [3, 5, 2], [4, 3, 3], [4, 4, 2], [4, 5, 1], [5, 3, 2], [5, 4, 1], [5, 2, 3]];

        const WC_HORIZON = 6;
        // w_gw = WC_DECAY^g. At six gameweeks the last is worth about 0.66 of
        // the first, which is roughly how much more we know about next Saturday
        // than about a fixture five weeks out.
        const WC_DECAY = 0.92;

        // Same weights the transfer engine values a bench at, for the same
        // reason: auto-subs cover a starter who does not play, and the reserve
        // keeper only appears if the first one is dropped or injured.
        const WC_BENCH_WEIGHT = 0.12;
        const WC_BENCH_GK_WEIGHT = 0.05;

        /* ===== Bounded nudges the projection does not carry ===== */

        // Form chasing is a well-known way to lose points, so this is small on
        // purpose: it can break a tie between comparable players and cannot
        // promote a bad one. Strength scales the deviation, the clamp caps it.
        const WC_FORM_STRENGTH = 0.35;
        const WC_FORM_CLAMP = [0.88, 1.12];
        const WC_TEAM_FORM_STRENGTH = 0.08;
        const WC_TEAM_FORM_CLAMP = [0.92, 1.08];

        /* ===== What counts as a premium =====

           Not a hardcoded name. The threshold is a percentile of price among
           attacking players, so the axis follows the season: if the argument
           stops being about Haaland and starts being about someone else, the
           plans follow without a code change.

           Restricted to midfielders and forwards because that is where the
           question lives. A £6.5m defender competes for the same budget, but
           "one premium or two" is not a conversation anyone has about
           defenders, and including them would produce plans that differ on an
           axis nobody asked about.

           The clamp exists because a percentile of a thin early-season pool can
           land anywhere. */
        const WC_PREMIUM_POSITIONS = [3, 4];
        /* The premium tier is the N dearest attackers, not a percentile of
           them. A percentile looks equivalent and is not: the eligible pool
           grows all season as more players clear the minutes floor, so a fixed
           quantile slides steadily down the price list and by spring would be
           calling an £6.5m midfielder a premium. A count does not move. */
        const WC_PREMIUM_COUNT = 8;
        const WC_PREMIUM_CLAMP = [8.0, 11.5];
        // How many premiums are tried as the anchor of a one- or two-premium
        // plan. Every combination is seeded, so this is 5 seeds for the single
        // plan and 10 for the double, times the formations.
        const WC_PREMIUM_AXES = 5;

        /* ===== Search effort =====

           Every one of these trades wall-clock for the last fraction of a
           point. They are set where a mid-range phone finishes inside about a
           second, because a manager will click this button and watch. */

        const WC_LOCAL_PASSES = 5;
        // Seeds carried from the cheap stage into the expensive one, per plan.
        const WC_POLISH_SEEDS = 3;
        /* Candidates whose true objective is evaluated per slot. The pool is
           ordered by the DP's own valuation, and a one-for-one swap cannot
           benefit from a lower-valued player — the money it frees is not spent
           by that move — so the top of that order is exactly the right place to
           look, and the tail is not worth the objective calls. */
        const WC_SWAP_SHORTLIST = 12;
        // Slots tried as the funding side of a sell-down-to-upgrade move.
        const WC_FUNDING_SLOTS = 4;
        const WC_MIN_FUNDING_FREED = 5;   // 0.1m units — below £0.5m it buys nothing

        /* ===== Signals ===== */

        function wcClamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

        /* Player recency, as a multiplier on the whole projection.

           FPL's own `form` is average points over the last thirty days and
           `ppg` is the season average, so their ratio is a recency signal that
           needs no history join and exists for every player. It is applied to
           the total rather than only to the attacking component, which is an
           approximation — appearance points do not really move with form. At a
           ±12% clamp that approximation is worth far less than the code it
           would take to avoid it. */
        function wcFormMultiplier(player) {
            const ppg = player.ppg || 0;
            const form = parseFloat(player.form) || 0;
            // Below about a point a game the ratio is noise over a tiny base.
            if (ppg < 1.5) return 1;
            const games = typeof computePlayerGamesPlayed === 'function'
                ? computePlayerGamesPlayed(player) : 1;
            const evidence = Math.min(1, games / 5);
            const m = 1 + (form / ppg - 1) * WC_FORM_STRENGTH * evidence;
            return wcClamp(m, WC_FORM_CLAMP[0], WC_FORM_CLAMP[1]);
        }

        // Team recent results — and only results. See the header for why
        // attackPower and fixtureScore are deliberately not read here.
        function wcTeamFormMultiplier(player) {
            const ta = (typeof teamAnalysis !== 'undefined' && teamAnalysis)
                ? teamAnalysis[player.teamId] : null;
            if (!ta || !ta.matchesPlayed) return 1;
            const evidence = Math.min(1, ta.matchesPlayed / 5);
            const m = 1 + ((ta.formRating - 50) / 50) * WC_TEAM_FORM_STRENGTH * evidence;
            return wcClamp(m, WC_TEAM_FORM_CLAMP[0], WC_TEAM_FORM_CLAMP[1]);
        }

        // w_gw for a window of n gameweeks.
        function wcWeights(n) {
            const w = new Float64Array(n);
            for (let i = 0; i < n; i++) w[i] = Math.pow(WC_DECAY, i);
            return w;
        }

        /* ===== The pool ===== */

        /* One entry per candidate, carrying his projection for every gameweek
           in the window. `cost` is price in 0.1m units so all budget arithmetic
           is integer — comparing floating-point pounds is how a squad ends up
           £0.0000001 over budget and legal squads get rejected. */
        function wcBuildEntries(players, gws, weights, opts) {
            const o = opts || {};
            const useForm = o.useForm !== false;
            const useTeamForm = o.useTeamForm !== false;
            const out = [];
            for (const p of players) {
                const mult = (useForm ? wcFormMultiplier(p) : 1)
                    * (useTeamForm ? wcTeamFormMultiplier(p) : 1);
                const xp = new Float64Array(gws.length);
                let w = 0;
                for (let g = 0; g < gws.length; g++) {
                    // A blank stays a blank: the multipliers scale, never add,
                    // so a player with no fixture is still worth nothing.
                    xp[g] = projectPlayerPointsForGW(p, gws[g]) * mult;
                    w += weights[g] * xp[g];
                }
                out.push({
                    id: p.id, pos: p.position, teamId: p.teamId,
                    price: p.price, cost: Math.round(p.price * 10),
                    xp, w, ref: p
                });
            }
            return out;
        }

        function wcEligible(player, opts) {
            const o = opts || {};
            if (!player || !player.position) return false;
            if (o.banIds && o.banIds.has(player.id)) return false;
            if (player.status !== 'a' && player.status !== 'd') return false;
            const floor = typeof minMinutesForCandidate === 'function' ? minMinutesForCandidate() : 100;
            if ((player.minutes || 0) < floor) return false;
            return true;
        }

        /* Pareto pruning, within each (position, club).

           A dominates B when A costs no more and projects no less. Swapping B
           for A in any squad keeps the position counts identical, keeps the
           club counts identical because they share a club, costs no more and
           scores no less — so B is only ever needed if the players that
           dominate him are already in the squad. At most WC_MAX_PER_CLUB of
           them can be, so a player dominated by that many is provably never
           required and can be dropped with no loss of optimality.

           Doing this globally rather than per club would be wrong: the swap
           would move a player between clubs and could breach the cap.

           Typically takes six hundred players to about three hundred, which is
           the difference between a local search that finishes in a blink and
           one a manager notices. */
        function wcParetoPrune(entries) {
            const groups = new Map();
            for (const e of entries) {
                const k = e.pos + ':' + e.teamId;
                if (!groups.has(k)) groups.set(k, []);
                groups.get(k).push(e);
            }
            const kept = [];
            for (const g of groups.values()) {
                for (const b of g) {
                    let dominators = 0;
                    for (const a of g) {
                        if (a === b) continue;
                        // No worse on both axes, strictly better on one. The id
                        // tie-break stops two identically priced, identically
                        // projecting players from dominating each other into
                        // mutual deletion.
                        const noWorse = a.cost <= b.cost && a.w >= b.w;
                        const better = a.cost < b.cost || a.w > b.w || a.id < b.id;
                        if (noWorse && better) dominators++;
                    }
                    if (dominators < WC_MAX_PER_CLUB) kept.push(b);
                }
            }
            return kept;
        }

        /* The price at which a midfielder or forward is a premium, this season,
           in this pool. */
        function wcPremiumThreshold(entries, override) {
            if (override != null) return override;
            const prices = entries
                .filter(e => WC_PREMIUM_POSITIONS.indexOf(e.pos) >= 0)
                .map(e => e.price)
                .sort((a, b) => b - a);
            if (!prices.length) return WC_PREMIUM_CLAMP[0];
            const idx = Math.min(prices.length - 1, WC_PREMIUM_COUNT - 1);
            return wcClamp(prices[idx], WC_PREMIUM_CLAMP[0], WC_PREMIUM_CLAMP[1]);
        }

        function wcIsPremium(entry, threshold) {
            return WC_PREMIUM_POSITIONS.indexOf(entry.pos) >= 0 && entry.price >= threshold;
        }

        /* ===== The objective =====

           Everything above exists to make this cheap enough to call tens of
           thousands of times. Hand-rolled insertion sorts rather than
           Array.sort with a comparator: fifteen players is small enough that
           the closure allocation and the comparator calls dominated. */

        function wcSortDescByGW(arr, g) {
            for (let i = 1; i < arr.length; i++) {
                const v = arr[i], key = v.xp[g];
                let j = i - 1;
                while (j >= 0 && arr[j].xp[g] < key) { arr[j + 1] = arr[j]; j--; }
                arr[j + 1] = v;
            }
        }

        /* One gameweek's worth of squad value: the best legal eleven, plus the
           captain's second copy, plus a discounted bench.

           Returns null for a squad that cannot field a legal eleven, which the
           caller treats as -Infinity rather than as zero — a shape that cannot
           be fielded is not a squad worth nothing, it is not a squad. */
        function wcGwValue(squad, g, scratch) {
            const bp1 = scratch[1], bp2 = scratch[2], bp3 = scratch[3], bp4 = scratch[4];
            bp1.length = 0; bp2.length = 0; bp3.length = 0; bp4.length = 0;
            let totalAll = 0;
            for (let i = 0; i < squad.length; i++) {
                const e = squad[i];
                scratch[e.pos].push(e);
                totalAll += e.xp[g];
            }
            if (bp1.length < 2 || bp2.length < 3 || bp3.length < 2 || bp4.length < 1) return null;
            wcSortDescByGW(bp1, g); wcSortDescByGW(bp2, g);
            wcSortDescByGW(bp3, g); wcSortDescByGW(bp4, g);

            let best = -Infinity;
            for (let f = 0; f < WC_FORMATIONS.length; f++) {
                const nD = WC_FORMATIONS[f][0], nM = WC_FORMATIONS[f][1], nF = WC_FORMATIONS[f][2];
                if (bp2.length < nD || bp3.length < nM || bp4.length < nF) continue;
                let s = bp1[0].xp[g];
                for (let i = 0; i < nD; i++) s += bp2[i].xp[g];
                for (let i = 0; i < nM; i++) s += bp3[i].xp[g];
                for (let i = 0; i < nF; i++) s += bp4[i].xp[g];
                if (s > best) best = s;
            }
            if (best === -Infinity) return null;

            /* The captain is the best player in the eleven, and every formation
               plays at least one keeper, three defenders, two midfielders and
               one forward — so the top of each position bucket is always on the
               pitch and the maximum over those four is the maximum over the XI.
               No need to materialise the eleven to find him. */
            let cap = bp1[0].xp[g];
            if (bp2[0].xp[g] > cap) cap = bp2[0].xp[g];
            if (bp3[0].xp[g] > cap) cap = bp3[0].xp[g];
            if (bp4[0].xp[g] > cap) cap = bp4[0].xp[g];

            const benchGk = bp1[1].xp[g];
            const benchOutfield = totalAll - best - benchGk;
            return best + cap + WC_BENCH_WEIGHT * benchOutfield + WC_BENCH_GK_WEIGHT * benchGk;
        }

        function wcObjective(squad, ctx) {
            let total = 0;
            for (let g = 0; g < ctx.n; g++) {
                const v = wcGwValue(squad, g, ctx.scratch);
                if (v === null) return -Infinity;
                total += ctx.weights[g] * v;
            }
            return total;
        }

        /* ===== The seed: an exact budget DP per position =====

           dp[c][b] is the best value obtainable by choosing c players from the
           items processed so far for exactly b tenths of a million.

           The trick that makes the eleven-versus-bench split exact without a
           second dimension: process a position's players in DESCENDING order of
           projected points, and credit the c-th player chosen at full weight if
           c is below the formation's starter count for that position and at the
           bench weight otherwise. Because the pool is sorted, whichever players
           the DP ends up choosing, the ones it credited at full weight really
           are the highest-projecting of them — which is exactly who would
           start. No extra state, and no approximation.

           A bitset records, for each (item, c, b), whether that item was taken
           to reach that state, so the chosen set can be traced back. One bit
           per state rather than one byte because the table is items × counts ×
           budget, which runs to megabytes per position in bytes and to tens of
           kilobytes in bits. */
        function wcPositionTable(ctx, pos, kStart) {
            const key = pos + ':' + kStart;
            if (ctx.tables[key]) return ctx.tables[key];

            const items = ctx.byPos[pos];
            const rows = WC_QUOTA[pos] + 1;
            const cols = ctx.budget + 1;
            const states = rows * cols;
            const benchW = pos === 1 ? WC_BENCH_GK_WEIGHT : WC_BENCH_WEIGHT;

            let prev = new Float64Array(states).fill(-Infinity);
            prev[0] = 0;
            const take = new Uint32Array(Math.ceil(items.length * states / 32));

            for (let i = 0; i < items.length; i++) {
                const it = items[i];
                const cur = prev.slice();
                const limit = cols - it.cost;
                const itemBase = i * states;
                for (let c = 0; c < rows - 1; c++) {
                    const val = it.w * (c < kStart ? 1 : benchW);
                    const from = c * cols, to = (c + 1) * cols + it.cost;
                    for (let b = 0; b < limit; b++) {
                        const base = prev[from + b];
                        if (base === -Infinity) continue;
                        const cand = base + val;
                        if (cand > cur[to + b]) {
                            cur[to + b] = cand;
                            const bit = itemBase + to + b;
                            take[bit >>> 5] |= (1 << (bit & 31));
                        }
                    }
                }
                prev = cur;
            }
            ctx.tables[key] = { items, take, rows, cols, states, dp: prev };
            return ctx.tables[key];
        }

        function wcTakeIsSet(take, bit) {
            return (take[bit >>> 5] & (1 << (bit & 31))) !== 0;
        }

        // The row of a table for a fixed player count, as a spend -> value
        // array, with the first and last reachable spend recorded so the
        // convolution below never walks the unreachable ends.
        function wcTableRow(table, count) {
            const cols = table.cols;
            const row = table.dp.subarray(count * cols, (count + 1) * cols);
            let lo = -1, hi = -1;
            for (let b = 0; b < cols; b++) {
                if (row[b] !== -Infinity) { if (lo < 0) lo = b; hi = b; }
            }
            return { row, lo, hi };
        }

        /* Combine two spend -> value curves. The result at spend s is the best
           split of s between them, and `split` remembers where, so the picks
           can be traced back through the chain of convolutions.

           Walking only lo..hi is what makes this cheap. A position's spend has
           a narrow real range — two keepers are never £40m and never £4m — so
           most of the budget axis is unreachable, and iterating all of it would
           turn a few thousand operations into a few million. */
        function wcConv(a, b, budget) {
            const val = new Float64Array(budget + 1).fill(-Infinity);
            const split = new Int32Array(budget + 1).fill(-1);
            let lo = -1, hi = -1;
            if (a.lo < 0 || b.lo < 0) return { row: val, split, lo, hi };
            for (let s1 = a.lo; s1 <= a.hi; s1++) {
                const v1 = a.row[s1];
                if (v1 === -Infinity) continue;
                const top = Math.min(b.hi, budget - s1);
                for (let s2 = b.lo; s2 <= top; s2++) {
                    const v2 = b.row[s2];
                    if (v2 === -Infinity) continue;
                    const s = s1 + s2, v = v1 + v2;
                    if (v > val[s]) {
                        val[s] = v; split[s] = s1;
                        if (lo < 0 || s < lo) lo = s;
                        if (s > hi) hi = s;
                    }
                }
            }
            return { row: val, split, lo, hi };
        }

        // Trace one position's chosen players back out of its table.
        function wcReconstruct(table, count, spend) {
            const picks = [];
            let c = count, b = spend;
            for (let i = table.items.length - 1; i >= 0 && c > 0; i--) {
                if (wcTakeIsSet(table.take, i * table.states + c * table.cols + b)) {
                    picks.push(table.items[i]);
                    b -= table.items[i].cost;
                    c--;
                }
            }
            return c === 0 ? picks : null;
        }

        /* The best squad the separable model can build for one formation, with
           a set of players forced into it.

           Forced players are assumed to start, which is what makes the
           remaining starter count right. For a premium that is nearly always
           true, and where it is not, the per-gameweek solve in the objective
           puts him on the bench anyway — this only shapes the seed.

           ctx.byPos must not contain any forced player, or the DP is free to
           pick him a second time. wcBuildPlans guarantees that by building the
           plan pool with every premium and every locked player removed. */
        function wcSeed(ctx, formation, forced) {
            const need = { 1: WC_QUOTA[1], 2: WC_QUOTA[2], 3: WC_QUOTA[3], 4: WC_QUOTA[4] };
            const starters = { 1: 1, 2: formation[0], 3: formation[1], 4: formation[2] };
            let budget = ctx.budget;
            for (const f of forced) {
                need[f.pos]--;
                starters[f.pos]--;
                budget -= f.cost;
            }
            if (budget < 0) return null;
            for (const pos of [1, 2, 3, 4]) {
                if (need[pos] < 0) return null;
                if (starters[pos] < 0) starters[pos] = 0;
            }

            const rows = {};
            for (const pos of [1, 2, 3, 4]) {
                const t = wcPositionTable(ctx, pos, starters[pos]);
                rows[pos] = wcTableRow(t, need[pos]);
                if (rows[pos].lo < 0) return null;
            }

            const c12 = wcConv(rows[1], rows[2], budget);
            const c123 = wcConv(c12, rows[3], budget);
            const c1234 = wcConv(c123, rows[4], budget);
            if (c1234.lo < 0) return null;

            // Leftover budget is worth nothing, so take the best spend at or
            // below what we have rather than insisting on spending it all.
            let bestSpend = -1, bestVal = -Infinity;
            for (let s = c1234.lo; s <= c1234.hi && s <= budget; s++) {
                if (c1234.row[s] > bestVal) { bestVal = c1234.row[s]; bestSpend = s; }
            }
            if (bestSpend < 0) return null;

            // Unwind the convolutions back to a spend per position.
            const s123 = c1234.split[bestSpend], s4 = bestSpend - s123;
            const s12 = c123.split[s123], s3 = s123 - s12;
            const s1 = c12.split[s12], s2 = s12 - s1;
            const spends = { 1: s1, 2: s2, 3: s3, 4: s4 };

            const squad = forced.slice();
            for (const pos of [1, 2, 3, 4]) {
                if (need[pos] === 0) continue;
                const picks = wcReconstruct(ctx.tables[pos + ':' + starters[pos]], need[pos], spends[pos]);
                if (!picks) return null;
                for (const p of picks) squad.push(p);
            }
            return squad.length === 15 ? squad : null;
        }

        /* ===== Repair and local search ===== */

        function wcClubCounts(squad) {
            const c = {};
            for (const e of squad) c[e.teamId] = (c[e.teamId] || 0) + 1;
            return c;
        }

        function wcSpend(squad) {
            let s = 0;
            for (const e of squad) s += e.cost;
            return s;
        }

        /* The DP cannot see the three-per-club cap — carrying a count per club
           through the state would multiply it by twenty dimensions. It is
           cheaper to let the seed breach the cap and mend it afterwards,
           because a breach is nearly always one extra player and the mend costs
           one swap.

           Least-valuable-first, and never a pinned player: those are the
           manager's decision, or the plan's premium anchor, and neither is the
           repair's to overrule. */
        function wcRepairClubs(squad, ctx) {
            const owned = new Set(squad.map(e => e.id));
            for (let guard = 0; guard < 20; guard++) {
                const counts = wcClubCounts(squad);
                let worst = null;
                for (const t of Object.keys(counts)) {
                    if (counts[t] > WC_MAX_PER_CLUB && (!worst || counts[t] > counts[worst])) worst = t;
                }
                if (!worst) return squad;

                const spare = ctx.budget - wcSpend(squad);
                const members = squad
                    .map((e, i) => ({ e, i }))
                    .filter(x => String(x.e.teamId) === String(worst) && !ctx.pinned.has(x.e.id))
                    .sort((a, b) => a.e.w - b.e.w);

                let done = false;
                for (const m of members) {
                    let best = null;
                    for (const cand of ctx.byPos[m.e.pos]) {
                        if (owned.has(cand.id)) continue;
                        if (String(cand.teamId) === String(worst)) continue;
                        if ((counts[cand.teamId] || 0) >= WC_MAX_PER_CLUB) continue;
                        if (cand.cost > spare + m.e.cost) continue;
                        if (!best || cand.w > best.w) best = cand;
                    }
                    if (best) {
                        owned.delete(m.e.id); owned.add(best.id);
                        squad[m.i] = best;
                        done = true;
                        break;
                    }
                }
                // Every player at the offending club is pinned, or nothing legal
                // is affordable in their place. Not a squad we can offer.
                if (!done) return null;
            }
            return null;
        }

        // Is putting `cand` in place of `out` a legal squad move?
        function wcSwapLegal(cand, out, counts, spare) {
            if (cand.pos !== out.pos) return false;
            if (cand.id === out.id) return false;
            if (cand.cost > spare + out.cost) return false;
            const held = (counts[cand.teamId] || 0) - (cand.teamId === out.teamId ? 1 : 0);
            return held < WC_MAX_PER_CLUB;
        }

        /* Hill-climb on the real objective.

           Two move types. A one-for-one swap is the workhorse. A funded move —
           sell one player down to afford an upgrade somewhere else — is what
           makes the premium plans work, because a seed rarely arrives with the
           budget distributed the way the true objective wants it. Without them
           the search cannot cross the valley between "fifteen good players" and
           "one great one and fourteen adequate ones", which is precisely the
           trade the whole feature exists to price. */
        function wcImprove(squad, ctx) {
            let cur = squad.slice();
            let curVal = wcObjective(cur, ctx);
            if (curVal === -Infinity) return null;

            let owned = new Set(cur.map(e => e.id));
            let counts = wcClubCounts(cur);
            let spend = wcSpend(cur);
            const resync = () => {
                owned = new Set(cur.map(e => e.id));
                counts = wcClubCounts(cur);
                spend = wcSpend(cur);
            };

            for (let pass = 0; pass < WC_LOCAL_PASSES; pass++) {
                let improved = false;

                // --- one-for-one ---
                for (let i = 0; i < cur.length; i++) {
                    const out = cur[i];
                    if (ctx.pinned.has(out.id)) continue;
                    const spare = ctx.budget - spend;
                    const pool = ctx.byPos[out.pos];
                    let bestCand = null, bestVal = curVal, seen = 0;
                    for (let k = 0; k < pool.length && seen < WC_SWAP_SHORTLIST; k++) {
                        const cand = pool[k];
                        if (owned.has(cand.id)) continue;
                        if (!wcSwapLegal(cand, out, counts, spare)) continue;
                        seen++;
                        cur[i] = cand;
                        const v = wcObjective(cur, ctx);
                        if (v > bestVal) { bestVal = v; bestCand = cand; }
                    }
                    cur[i] = bestCand || out;
                    if (bestCand) { curVal = bestVal; improved = true; resync(); }
                }

                // --- funded moves ---
                /* The cheapest money first: for each slot, the downgrade giving
                   up the least value per 0.1m released. Ranked on the DP's
                   separable valuation, which costs nothing, and only the best
                   few slots get the objective calls. */
                const funders = [];
                for (let j = 0; j < cur.length; j++) {
                    const sell = cur[j];
                    if (ctx.pinned.has(sell.id)) continue;
                    const spare = ctx.budget - spend;
                    let fund = null, ratio = Infinity;
                    for (const cand of ctx.byPos[sell.pos]) {
                        if (owned.has(cand.id)) continue;
                        const freed = sell.cost - cand.cost;
                        if (freed < WC_MIN_FUNDING_FREED) continue;
                        if (!wcSwapLegal(cand, sell, counts, spare)) continue;
                        const r = (sell.w - cand.w) / freed;
                        if (r < ratio) { ratio = r; fund = cand; }
                    }
                    if (fund) funders.push({ j, fund, ratio });
                }
                funders.sort((a, b) => a.ratio - b.ratio);

                for (const f of funders.slice(0, WC_FUNDING_SLOTS)) {
                    /* The list was costed against the squad as it stood before
                       any of these moves landed. An accepted one can have
                       changed the occupant of a later slot, so every move is
                       re-checked against the squad it is actually applied to —
                       a stale entry could otherwise breach the budget or the
                       club cap on its way in. */
                    const restore = cur[f.j];
                    if (owned.has(f.fund.id)) continue;
                    if (!wcSwapLegal(f.fund, restore, counts, ctx.budget - spend)) continue;
                    cur[f.j] = f.fund;
                    if (wcObjective(cur, ctx) === -Infinity) { cur[f.j] = restore; continue; }

                    const owned2 = new Set(cur.map(e => e.id));
                    const counts2 = wcClubCounts(cur);
                    const spare2 = ctx.budget - wcSpend(cur);
                    let bestSlot = -1, bestCand = null, bestVal = curVal;
                    for (let i = 0; i < cur.length; i++) {
                        if (i === f.j || ctx.pinned.has(cur[i].id)) continue;
                        const out = cur[i];
                        const pool = ctx.byPos[out.pos];
                        let seen = 0;
                        for (let k = 0; k < pool.length && seen < WC_SWAP_SHORTLIST; k++) {
                            const cand = pool[k];
                            if (owned2.has(cand.id)) continue;
                            if (!wcSwapLegal(cand, out, counts2, spare2)) continue;
                            seen++;
                            cur[i] = cand;
                            const v = wcObjective(cur, ctx);
                            if (v > bestVal) { bestVal = v; bestSlot = i; bestCand = cand; }
                            cur[i] = out;
                        }
                    }
                    if (bestSlot >= 0) {
                        cur[bestSlot] = bestCand;
                        curVal = bestVal;
                        improved = true;
                        resync();
                    } else {
                        // The downgrade bought nothing worth having. It is only
                        // kept when the upgrade it funded pays for it.
                        cur[f.j] = restore;
                    }
                }

                if (!improved) break;
            }
            return { squad: cur, value: curVal };
        }

        /* ===== Reporting ===== */

        // The eleven, bench and captain a squad would actually field in one
        // gameweek. Same arithmetic as wcGwValue, materialised — that one is
        // hot and returns a number, this one runs a handful of times per plan
        // and returns the detail the screen needs.
        function wcLineupForGW(squad, g) {
            const bp = { 1: [], 2: [], 3: [], 4: [] };
            for (const e of squad) bp[e.pos].push(e);
            for (const pos of [1, 2, 3, 4]) wcSortDescByGW(bp[pos], g);

            let best = -Infinity, shape = null;
            for (const [nD, nM, nF] of WC_FORMATIONS) {
                if (bp[1].length < 1 || bp[2].length < nD || bp[3].length < nM || bp[4].length < nF) continue;
                let s = bp[1][0].xp[g];
                for (let i = 0; i < nD; i++) s += bp[2][i].xp[g];
                for (let i = 0; i < nM; i++) s += bp[3][i].xp[g];
                for (let i = 0; i < nF; i++) s += bp[4][i].xp[g];
                if (s > best) { best = s; shape = [nD, nM, nF]; }
            }
            if (!shape) return null;
            const xi = [bp[1][0]].concat(bp[2].slice(0, shape[0]), bp[3].slice(0, shape[1]), bp[4].slice(0, shape[2]));
            const xiIds = new Set(xi.map(e => e.id));
            const bench = squad.filter(e => !xiIds.has(e.id))
                .sort((a, b) => (a.pos === 1 ? 1 : 0) - (b.pos === 1 ? 1 : 0) || b.xp[g] - a.xp[g]);
            const captain = xi.reduce((m, e) => (e.xp[g] > m.xp[g] ? e : m), xi[0]);
            return {
                formation: `${shape[0]}-${shape[1]}-${shape[2]}`,
                xi, bench, captain,
                points: best + captain.xp[g]
            };
        }

        function wcReport(plan, squad, value, ctx) {
            const spend = wcSpend(squad);
            const counts = wcClubCounts(squad);
            const premiums = squad.filter(e => wcIsPremium(e, ctx.premiumFloor))
                .sort((a, b) => b.w - a.w);
            const now = wcLineupForGW(squad, 0);
            const byGw = [];
            for (let g = 0; g < ctx.n; g++) {
                const l = wcLineupForGW(squad, g);
                byGw.push({
                    gw: ctx.gws[g],
                    points: l ? Math.round(l.points * 10) / 10 : 0,
                    formation: l ? l.formation : null,
                    captain: l ? l.captain.ref.name : null
                });
            }
            const clubs = {};
            for (const t of Object.keys(counts)) {
                const short = (typeof teams !== 'undefined' && teams && teams[t]) ? teams[t].short_name : t;
                clubs[short] = counts[t];
            }
            return {
                id: plan.id, label: plan.label, note: plan.note,
                squad: squad.map(e => e.ref),
                entries: squad,
                premiums: premiums.map(e => e.ref),
                formation: now ? now.formation : null,
                xi: now ? now.xi.map(e => e.ref) : [],
                bench: now ? now.bench.map(e => e.ref) : [],
                captain: now ? now.captain.ref : null,
                spend: Math.round(spend) / 10,
                bankLeft: Math.round(ctx.budget - spend) / 10,
                premiumSpend: premiums.reduce((s, e) => s + e.price, 0),
                premiumSpendPct: spend > 0 ? (premiums.reduce((s, e) => s + e.cost, 0) / spend) * 100 : 0,
                objective: Math.round(value * 10) / 10,
                byGw, clubs,
                changes: ctx.currentIds
                    ? squad.filter(e => !ctx.currentIds.has(e.id)).length
                    : null
            };
        }

        /* ===== The entry point ===== */

        /* Every choice of anchor for a plan wanting `count` premiums. With
           WC_PREMIUM_AXES at five that is five singles or ten pairs — few
           enough to seed all of them and let the objective choose, rather than
           guessing which premium is the right one to build around. */
        function wcPremiumCombos(axes, count) {
            if (count <= 0) return [[]];
            if (count === 1) return axes.map(a => [a]);
            const out = [];
            for (let i = 0; i < axes.length; i++) {
                for (let j = i + 1; j < axes.length; j++) out.push([axes[i], axes[j]]);
            }
            return out;
        }

        const WC_PLANS = [
            { id: 'spread', label: 'No premium', count: 0,
              note: 'Budget spread evenly. No weak links, the strongest bench, and the most room to manoeuvre afterwards.' },
            { id: 'single', label: 'One premium', count: 1,
              note: 'One captaincy anchor, mid-priced everywhere else. The shape most managers land on.' },
            { id: 'double', label: 'Two premiums', count: 2,
              note: 'Two ceiling assets and a thinner supporting cast. Higher variance, and it needs both to deliver.' }
        ];

        /* Seed every formation, score each seed on the real objective, and
           hand back the best few for polishing. Seeds are cheap and the climb
           is not, which is the whole reason the two stages are separate. */
        function wcSeedCandidates(ctx, forced) {
            const seeds = [];
            for (const f of WC_FORMATIONS) {
                const seed = wcSeed(ctx, f, forced);
                if (!seed) continue;
                const fixed = wcRepairClubs(seed, ctx);
                if (!fixed) continue;
                const v = wcObjective(fixed, ctx);
                if (v > -Infinity) seeds.push({ squad: fixed, value: v });
            }
            return seeds;
        }

        function wcPolishBest(seeds, ctx, limit) {
            seeds.sort((a, b) => b.value - a.value);
            let best = null;
            for (const s of seeds.slice(0, limit)) {
                const done = wcImprove(s.squad, ctx);
                if (done && (!best || done.value > best.value)) best = done;
            }
            return best;
        }

        /* opts:
             budget         £m available (squad sell value + bank). Required
                            unless `squad` is given, in which case it is derived.
             squad          current squad, for the budget and the change count
             bank           £m in the bank, used with `squad`
             horizon        gameweeks to plan over; 1 for a Free Hit
             fromGW         plan from this gameweek rather than the next one
             lockIds        Set of player ids that must appear in every plan
             banIds         Set of player ids that must appear in none
             premiumFloor   £m override for what counts as a premium
             useForm        default true
             useTeamForm    default true */
        function wcBuildPlans(opts) {
            const o = opts || {};
            const horizon = o.horizon || WC_HORIZON;
            const gws = typeof xpPlanGWs === 'function' ? xpPlanGWs(horizon, o.fromGW) : [];
            if (!gws.length) return { ok: false, reason: 'no-gameweeks' };

            const bank = o.bank || 0;
            const budgetM = o.budget != null
                ? o.budget
                : (o.squad || []).reduce((s, p) => s + (p.sellPrice || p.price), 0) + bank;
            if (!(budgetM > 0)) return { ok: false, reason: 'no-budget' };

            const weights = wcWeights(gws.length);
            /* A Set or a plain array of ids, either way.

               `instanceof Set` was realm-bound and quietly wrong: a Set built
               in another context — a test sandbox, a worker — is not an
               instance of THIS realm's Set, fails the check, and falls through
               to an empty set. "Lock this player" then becomes a silent no-op,
               which is the worst way for an option to fail. Anything carrying a
               has() is taken as it comes; anything else iterable is copied. */
            const idSet = v => (v && typeof v.has === 'function')
                ? v
                : new Set(Array.isArray(v) ? v : []);
            const lockIds = idSet(o.lockIds);
            const banIds = idSet(o.banIds);

            // A locked player is the manager's decision and skips the
            // eligibility filter — but not the ban list, which is also theirs
            // and which they would have to have set deliberately.
            const pool = (typeof allPlayers !== 'undefined' ? allPlayers : [])
                .filter(p => (lockIds.has(p.id) && !banIds.has(p.id)) || wcEligible(p, { banIds }));
            if (pool.length < 30) return { ok: false, reason: 'thin-pool' };

            const all = wcBuildEntries(pool, gws, weights, o);
            const premiumFloor = wcPremiumThreshold(all, o.premiumFloor);
            const pruned = wcParetoPrune(all);
            // A locked player survives pruning by definition — the manager has
            // already decided, and dropping him would silently ignore that.
            const prunedIds = new Set(pruned.map(e => e.id));
            for (const e of all) if (lockIds.has(e.id) && !prunedIds.has(e.id)) pruned.push(e);

            const budget = Math.round(budgetM * 10);
            const currentIds = o.squad ? new Set(o.squad.map(p => p.id)) : null;

            const makeCtx = (entries, pinned) => {
                const byPos = { 1: [], 2: [], 3: [], 4: [] };
                for (const e of entries) byPos[e.pos].push(e);
                for (const pos of [1, 2, 3, 4]) byPos[pos].sort((a, b) => b.w - a.w);
                return {
                    byPos, budget, gws, weights, n: gws.length,
                    tables: {}, premiumFloor, currentIds, pinned,
                    scratch: { 1: [], 2: [], 3: [], 4: [] }
                };
            };

            const locked = pruned.filter(e => lockIds.has(e.id));

            /* The ceiling: the same search with no premium constraint at all.
               Every plan is reported against this, and that delta is the number
               that turns three squads into an answer. */
            const freeCtx = makeCtx(pruned.filter(e => !lockIds.has(e.id)), lockIds);
            const bestFree = wcPolishBest(wcSeedCandidates(freeCtx, locked), freeCtx, WC_POLISH_SEEDS);
            if (!bestFree) return { ok: false, reason: 'no-legal-squad' };

            /* Plans are built from a pool with every premium AND every locked
               player removed, and put back explicitly as forced picks. Two
               reasons: the DP would otherwise be free to select a forced player
               a second time, and a "one premium" plan could quietly acquire a
               second. */
            const isPrem = e => wcIsPremium(e, premiumFloor);
            const planPool = pruned.filter(e => !isPrem(e) && !lockIds.has(e.id));
            const lockedPremiums = locked.filter(isPrem);
            const lockedRest = locked.filter(e => !isPrem(e));
            const axes = pruned
                .filter(e => isPrem(e) && !lockIds.has(e.id))
                .sort((a, b) => b.w - a.w)
                .slice(0, WC_PREMIUM_AXES);

            const plans = [];
            for (const plan of WC_PLANS) {
                // A locked premium counts toward the target, so a plan asking
                // for fewer premiums than the manager has already locked in is
                // not a plan that can be built.
                const wanted = plan.count - lockedPremiums.length;
                if (wanted < 0 || wanted > axes.length) continue;

                const seeds = [];
                let ctxForPlan = null;
                for (const combo of wcPremiumCombos(axes, wanted)) {
                    const forced = lockedRest.concat(lockedPremiums, combo);
                    const ctx = makeCtx(planPool, new Set(forced.map(e => e.id)));
                    // One table cache per plan would be ideal, but pinned
                    // differs per combo and the tables do not depend on it —
                    // so share them across every combo of this plan.
                    if (ctxForPlan) ctx.tables = ctxForPlan.tables;
                    else ctxForPlan = ctx;
                    for (const s of wcSeedCandidates(ctx, forced)) seeds.push({ ...s, ctx });
                }
                if (!seeds.length) continue;

                seeds.sort((a, b) => b.value - a.value);
                let best = null;
                for (const s of seeds.slice(0, WC_POLISH_SEEDS)) {
                    const done = wcImprove(s.squad, s.ctx);
                    if (done && (!best || done.value > best.value)) {
                        best = { squad: done.squad, value: done.value, ctx: s.ctx };
                    }
                }
                if (best) plans.push(wcReport(plan, best.squad, best.value, best.ctx));
            }
            if (!plans.length) return { ok: false, reason: 'no-legal-squad' };

            /* The ceiling is the best squad the model found, which is not quite
               the same as the best squad that exists — every search here is a
               heuristic. The unconstrained run is the natural candidate, but a
               constrained one can beat it: forcing a premium in narrows the
               search and occasionally lands somewhere the free search's climb
               did not reach. Measured at a tenth of a point in about one run in
               five, which is nothing next to the projections' own error and
               everything to a manager reading "+0.1 versus the best possible".
               Taking the maximum of all of them keeps the number meaning what
               the label says and every delta at or below zero. */
            let ceiling = bestFree.value;
            for (const p of plans) if (p.objective > ceiling) ceiling = p.objective;
            ceiling = Math.round(ceiling * 10) / 10;
            for (const p of plans) p.deltaVsBest = Math.round((p.objective - ceiling) * 10) / 10;

            /* How many premiums the unconstrained best actually holds.

               Usually one or two, in which case a plan matches the ceiling and
               reports a delta of zero. But the free search is free to build a
               three-premium squad, and when it does, every one of the three
               plans reports a loss with nothing on screen explaining what the
               manager is being compared against. Naming the count lets the card
               say "the best squad found uses three premiums" instead of leaving
               three negative numbers to be puzzled over. */
            const ceilingPremiums = bestFree.value >= ceiling - 1e-9
                ? bestFree.squad.filter(e => wcIsPremium(e, premiumFloor)).length
                : (plans.find(p => p.objective === ceiling) || { premiums: [] }).premiums.length;

            /* Three plans sharing fourteen players are one plan printed three
               times. Say so rather than pad the list — the screen promised
               different answers, and a manager who cannot tell them apart will
               assume the model is broken rather than that the premium question
               happens not to matter this week. */
            let distinct = true;
            for (let i = 0; i < plans.length && distinct; i++) {
                for (let j = i + 1; j < plans.length && distinct; j++) {
                    const a = new Set(plans[i].squad.map(p => p.id));
                    if (plans[j].squad.filter(p => a.has(p.id)).length >= 14) distinct = false;
                }
            }

            return {
                ok: true,
                budget: budgetM,
                gws, horizon: gws.length,
                premiumFloor,
                axes: axes.map(e => e.ref),
                poolSize: pruned.length,
                pooledFrom: all.length,
                ceiling, ceilingPremiums,
                plans,
                distinct
            };
        }
