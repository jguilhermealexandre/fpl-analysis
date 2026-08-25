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
   ============================================ */

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
            const minutesSignal = mpg >= 80 ? 0.92 : mpg >= 60 ? 0.75 : mpg >= 30 ? 0.45 : mpg > 0 ? 0.2 : 0.08;

            // Lean on the starts rate once there are a couple of matches behind it;
            // before that it is one coin flip and minutes are the steadier read.
            const wStarts = Math.min(1, games / 3);
            let pStart = wStarts * startRate + (1 - wStarts) * minutesSignal;
            // A player who starts every week but is routinely hooked early is still
            // a starter; one who has never started is not, whatever his minutes.
            if (starts === 0 && games > 0) pStart = Math.min(pStart, 0.22);
            pStart = Math.max(0.03, Math.min(0.96, pStart));
            pStart *= avail;
            // Starters play most of the match; everyone else gets a cameo.
            const expMins = pStart * 82 + (1 - pStart) * 12;
            return { pStart, expMins, min90: expMins / 90 };
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
            if (player.status === 'i' || player.status === 'u' || player.status === 's') return out;

            const mins = player.minutes || 0;
            const games = computePlayerGamesPlayed(player);
            const { pStart, min90 } = expectedMinutesModel(player);
            out.pStart = pStart;

            // 2 pts for 60+ minutes, 1 otherwise.
            out.appearance = pStart * 2 + (1 - pStart) * 0.5;

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
            if (o.applyEpFloor !== false && player.status !== 'i' && player.status !== 'u' && player.status !== 's') {
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

        // A host page can call this before projecting to confirm the globals the
        // engine reads actually exist, rather than silently producing zeros.
        function xpEngineReady() {
            return typeof positionAverages !== 'undefined' && positionAverages
                && typeof teamAnalysis !== 'undefined' && teamAnalysis
                && typeof computePlayerGamesPlayed === 'function';
        }
