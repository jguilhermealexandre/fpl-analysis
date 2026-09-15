/* ============================================
   EasyFPL — Routes to points, counted once

   Three surfaces carried a list called "Routes to Points" and there were three
   implementations of it: the Routes tab on the players page, a copy of that
   inside compare-report.js labelled "re-use logic from generateRoutesToPoints
   inline", and the profile card, which broke open the projection instead. They
   could disagree about how many ways a player scores, and about which ways.

   Two things were wrong in all of them at once.

   DEFENSIVE CONTRIBUTION WAS MISSING. It is worth two points a match, the
   projection has modelled it since the rule came in (defensiveContributionPoints
   in scripts/xp-engine.js), and it was in none of the route lists and none of
   the point-source bars. For a ball-winning defender it is frequently his most
   reliable source — 35% of defenders in the current feed clear the threshold in
   at least three appearances in ten, which is more dependable than the goal
   route most of them were being credited with.

   CREATIVITY WAS COUNTED AND PAYS NOTHING. It is an ICT index component, not a
   scoring route; a creative midfielder is paid through assists, which is already
   its own route. The old code half-knew this — it excluded creativity from the
   point-source breakdown as "an ICT component that predicts assists rather than
   scoring separately" — and then counted it in routeCount and added
   strength × 1.5 to the composite anyway. It is a signal here: shown, explained,
   not counted.

   WHAT A ROUTE IS. Something that pays FPL points, which this player reaches
   often enough to plan around. Membership, strength, colour and label are
   decided here and nowhere else, so the tab, the report and the card can render
   the same answer three different ways without being able to disagree about it.

   HOW DEFCON IS MEASURED. By hit rate over matches he played, not by a rate per
   90 and not by the projection's own figure. The threshold is a cliff — ten
   defensive actions pays two points and nine pays nothing — so an average is the
   wrong shape of answer: two matches of five and one of fifteen average out to a
   player who never scores it. "Cleared 10+ in 3 of his last 4" is the fact, it
   is checkable against the grid on his card, and it is the same
   rate-over-appearances convention reliability and explosiveness already use.

   Prefix rt*. No DOM. Depends on scripts/xp-engine.js for the projection and the
   published thresholds; degrades to the routes it can still measure without it.
   ============================================ */

        /* The registry. A route's colour and label live here so the bar on a
           route card, the chip on the profile card and the row in the scouting
           report cannot drift apart — they were three separate literals before,
           and "Clean Sheets" / "Clean sheet" / "cs" were the same thing. */
        const RT_ROUTE_META = {
            goals:      { label: 'Goals',                   color: '#F87171' },
            assists:    { label: 'Assists',                 color: '#60A5FA' },
            cleanSheet: { label: 'Clean sheets',            color: '#34D399' },
            defCon:     { label: 'Defensive contribution',  color: '#38BDF8' },
            saves:      { label: 'Saves',                   color: '#A78BFA' },
            bonus:      { label: 'Bonus',                   color: '#FBBF24' },
            penalties:  { label: 'Penalties',               color: '#F472B6' },
            appearance: { label: 'Appearance',              color: '#94A3B8' },
            // Not a route. Kept in the registry so the signal it drives is drawn
            // in the same palette as everything else.
            creativity: { label: 'Creativity',              color: '#FB923C' }
        };

        const RT_POS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };

        /* A rate over matches he actually played.

           The same shape of answer as reliability and explosiveness, and for the
           same reason: FPL writes a gameweek row for an unused substitute, so a
           denominator counting rows is not counting him. Below the minimum there
           is no honest ratio and this returns null rather than a zero — zero is
           an answer, and it must not be the way we spell "not enough football
           yet". */
        const RT_RATE_WINDOW = 10;
        const RT_RATE_MIN = 3;

        function rtRateOverAppearances(history, test, opts) {
            const o = opts || {};
            const played = (history || [])
                .slice(-(o.window || RT_RATE_WINDOW))
                .filter(r => (parseFloat(r.minutes) || 0) > 0);
            if (played.length < (o.min || RT_RATE_MIN)) return null;
            const hits = played.filter(test).length;
            return { rate: hits / played.length, hits, n: played.length };
        }

        /* Defensive actions needed for the two points, per position. Read from
           the engine's own constant so there is one number, not two that agree
           until the rule changes. Goalkeepers are not eligible at all. */
        function rtDefConThreshold(position) {
            const t = (typeof DC_THRESHOLD !== 'undefined' && DC_THRESHOLD)
                ? DC_THRESHOLD[position]
                : ({ 1: Infinity, 2: 10, 3: 12, 4: 12 })[position];
            return (t == null || t === Infinity) ? null : t;
        }

        /* How often he clears it, and whether that is often enough to call a
           route.

           The bar is 30% of appearances — 0.6 points a match at two points a
           time, which is a stronger claim than the goal route asks of a defender
           (0.06 xG a match is 0.36) and stronger than the bonus route asks of
           anyone. It is deliberately not a participation award: measured across
           the feed it admits about a third of defenders and a tenth of
           midfielders, which is roughly who actually does this.

           Forwards are eligible and essentially never qualify — the best in the
           league sits at six defensive actions per 90 against a threshold of
           twelve. The rule is here for the holding forward who does, rather than
           being written out on the strength of this season's sample. */
        const RT_DEFCON_FLOOR = 0.30;
        const RT_DEFCON_CEIL = 0.60;

        /* How often he has cleared it, whatever the answer. Separate from the
           route because the two are different questions: a defender at 15% does
           not have this as a route to plan around, and his card should still be
           able to say 15% rather than leave the reader to assume nothing is
           known. Null only when he is ineligible or has not played enough. */
        function rtDefConHit(player) {
            const threshold = rtDefConThreshold(player.position);
            if (!threshold) return null;
            const hit = rtRateOverAppearances(player.history,
                r => (parseFloat(r.defensive_contribution) || 0) >= threshold);
            return hit ? Object.assign({ threshold }, hit) : null;
        }

        function rtDefConRoute(player) {
            const hit = rtDefConHit(player);
            if (!hit || hit.rate < RT_DEFCON_FLOOR) return null;
            const threshold = hit.threshold;
            return {
                key: 'defCon',
                name: RT_ROUTE_META.defCon.label,
                color: RT_ROUTE_META.defCon.color,
                icon: '<i data-lucide="shield" style="width:14px;height:14px;"></i>',
                strength: Math.min(10, (hit.rate / RT_DEFCON_CEIL) * 10),
                // Two points, every time he clears it.
                ptWeight: (typeof DC_POINTS !== 'undefined' ? DC_POINTS : 2),
                detail: `${threshold}+ in ${hit.hits} of ${hit.n}`,
                hitRate: hit.rate, hits: hit.hits, sample: hit.n, threshold
            };
        }

        /* The engine-shaped twin of a report-shaped player.

           The two pages name their pool differently and neither is the object
           the report carries: buildComparePlayer spreads the original and then
           overwrites .fixtures with entries that have no opponentId, and
           projecting that quietly degrades every opponent term to an FDR-only
           estimate. Same lookup calculateExpectedPoints documents, in one place
           now that two callers need it. */
        function rtEnginePlayer(p) {
            if (!p) return null;
            const pool = typeof allPlayersById !== 'undefined' ? allPlayersById
                : (typeof xpPlayersById !== 'undefined' ? xpPlayersById : null);
            return (pool && pool[p.id]) || null;
        }

        /* Where the projected points actually come from.

           This was a second projection — its own regressed rates, its own price
           prior, its own baselines — sitting next to the real one and disagreeing
           with it. It is the real one broken open now, which is also how defensive
           contribution arrives: the engine has always computed it, the bar just
           never drew it.

           The segments have to be mutually exclusive or the shares mean nothing,
           which still rules out penalties (already inside xG) and creativity (not
           a scoring term at all). Conceded and cards are real and negative; they
           are returned separately rather than drawn as slices of a total they
           subtract from. */
        function rtPointSources(player, nativeOverride) {
            /* The profile card is handed the engine-shaped object already — it is
               built from the squad roster, not reshaped for a report — so it
               passes itself rather than being looked up and degraded. */
            const native = nativeOverride || rtEnginePlayer(player);
            if (!native || typeof projectPlayerPointsDetailed !== 'function') return null;
            const d = projectPlayerPointsDetailed(native);
            if (!d || !(d.total > 0)) return null;

            const seg = (key, pts) => ({ key, label: RT_ROUTE_META[key].label, color: RT_ROUTE_META[key].color, pts });
            // Fixed order — this sequence is what the colour-blindness check was
            // run against. Do not reorder.
            const sources = [
                seg('appearance', d.appearance),
                seg('goals', d.goals != null ? d.goals : d.attack),
                seg('assists', d.assists != null ? d.assists : 0),
                seg('cleanSheet', d.cleanSheet),
                seg('saves', d.saves),
                seg('defCon', d.defCon),
                seg('bonus', d.bonus)
            ].filter(s => s.pts >= 0.05);

            const total = sources.reduce((s, r) => s + r.pts, 0);
            sources.forEach(s => { s.share = total > 0 ? s.pts / total : 0; });
            return { sources, total, conceded: d.conceded || 0, cards: d.cards || 0, projected: d.total };
        }

        /* Every route this player has, and the ones he only nearly has.

           `player` is the report/table shape: l5 and season from
           buildStatWindows, history, fixtures, price, position. */
        function routesFor(player) {
            const pos = RT_POS[player.position] || 'MID';
            const l5Matches = player.l5?.games || 1;
            const seasonMatches = player.season?.games || l5Matches;
            // 60/40 recent against season — five matches is a small sample and
            // the season is the one that holds up.
            const blend = (recent, whole) => (recent / l5Matches) * 0.6 + (whole / seasonMatches) * 0.4;

            const xGpg = blend(player.l5?.xG || 0, player.season?.xG || 0);
            const xApg = blend(player.l5?.xA || 0, player.season?.xA || 0);
            const goalsPg = blend(player.l5?.goals || 0, player.season?.goals || 0);
            const assistsPg = blend(player.l5?.assists || 0, player.season?.assists || 0);
            const csPg = blend(player.l5?.cleanSheets || 0, player.season?.cleanSheets || 0);
            const bonusPg = blend(player.l5?.bonus || 0, player.season?.bonus || 0);
            const savesPg = blend(player.l5?.saves || 0, player.season?.saves || 0);
            const minsPg = blend(player.l5?.minutes || 0, player.season?.minutes || 0);
            const creativityPg = blend(player.l5?.creativity || 0, player.season?.creativity || 0);

            const goalPts = { GK: 6, DEF: 6, MID: 5, FWD: 4 }[pos];
            const csPts = { GK: 4, DEF: 4, MID: 1, FWD: 0 }[pos];
            const goalThresh = { GK: 0.03, DEF: 0.06, MID: 0.12, FWD: 0.15 }[pos];
            const assistThresh = { GK: 0.02, DEF: 0.06, MID: 0.10, FWD: 0.08 }[pos];
            const csThresh = { GK: 0.15, DEF: 0.15, MID: 0.30, FWD: 999 }[pos];
            const bonusThresh = { GK: 0.3, DEF: 0.3, MID: 0.4, FWD: 0.5 }[pos];

            const routes = [];
            const add = (key, icon, strength, detail, ptWeight, extra) => routes.push(Object.assign({
                key, name: RT_ROUTE_META[key].label, color: RT_ROUTE_META[key].color,
                icon, strength: Math.min(10, strength), detail, ptWeight
            }, extra || {}));

            if (xGpg >= goalThresh || goalsPg >= goalThresh * 1.5) {
                const ceiling = pos === 'FWD' ? 0.6 : pos === 'MID' ? 0.5 : 0.3;
                add('goals', '<i data-lucide="circle-dot" style="width:14px;height:14px;"></i>',
                    (xGpg / ceiling) * 10, `${xGpg.toFixed(2)} xG/match`, goalPts);
            }
            if (xApg >= assistThresh || assistsPg >= assistThresh * 1.5) {
                const ceiling = pos === 'MID' ? 0.4 : 0.3;
                add('assists', '<i data-lucide="a-large-small" style="width:14px;height:14px;"></i>',
                    (xApg / ceiling) * 10, `${xApg.toFixed(2)} xA/match`, 3);
            }
            if (csPg >= csThresh) {
                add('cleanSheet', '<i data-lucide="shield-check" style="width:14px;height:14px;"></i>',
                    (csPg / 0.55) * 10, `${(csPg * 100).toFixed(0)}% rate`, csPts);
            }

            // The one that was missing.
            const dc = rtDefConRoute(player);
            if (dc) routes.push(dc);

            if (bonusPg >= bonusThresh) {
                add('bonus', '<i data-lucide="star" style="width:14px;height:14px;"></i>',
                    (bonusPg / 2) * 10, `${bonusPg.toFixed(1)}/match`, 2);
            }
            if (pos === 'GK' && savesPg >= 2) {
                add('saves', '<i data-lucide="hand" style="width:14px;height:14px;"></i>',
                    (savesPg / 5) * 10, `${savesPg.toFixed(1)}/match`, 1.5);
            }
            const penOrder = player.penaltiesOrder;
            if (penOrder != null && penOrder <= 2 && pos !== 'GK') {
                add('penalties', '<i data-lucide="goal" style="width:14px;height:14px;"></i>',
                    penOrder === 1 ? 9 : 5, penOrder === 1 ? 'First choice' : `Order ${penOrder}`,
                    goalPts * 0.76);
            }

            /* Signals are not routes. Creativity predicts assists, and assists
               are already counted above — crediting both pays the same expected
               points twice and calls a one-route player a two-route player. It
               is worth showing and it is worth nothing on its own, so it is
               shown and counted at zero. */
            const signals = [];
            if (creativityPg >= 12 && (pos === 'MID' || pos === 'DEF')) {
                signals.push({
                    key: 'creativity', name: RT_ROUTE_META.creativity.label,
                    color: RT_ROUTE_META.creativity.color,
                    icon: '<i data-lucide="crosshair" style="width:14px;height:14px;"></i>',
                    strength: Math.min(10, (creativityPg / 45) * 10),
                    detail: `${creativityPg.toFixed(0)} crea/match`,
                    note: 'Feeds the assist route rather than scoring on its own'
                });
            }

            const routeCount = routes.length;
            const weightedSum = routes.reduce((s, r) => s + r.strength * (r.ptWeight || 1), 0);

            // Not routes either, but they scale one: a route he reaches from the
            // bench is worth less than the same route started every week.
            const nailedMultiplier = minsPg >= 85 ? 1.15 : minsPg >= 75 ? 1.07 : minsPg >= 60 ? 1.0 : 0.85;
            const fixtureFactor = rtFixtureFactor(player, pos);

            const p90 = v => (minsPg > 0 ? v * (90 / minsPg) : 0);
            const per90 = {
                xG: p90(xGpg), xA: p90(xApg), xGI: p90(xGpg + xApg),
                saves: p90(savesPg), bonus: bonusPg, cs: csPg,
                defCon: p90(blend(player.l5?.defCon || 0, player.season?.defCon || 0)),
                gc: p90(blend(player.l5?.goalsConceded || 0, player.season?.goalsConceded || 0))
            };

            return {
                pos, routes, signals, routeCount,
                compositeScore: weightedSum * nailedMultiplier * fixtureFactor,
                nailedMultiplier, fixtureFactor, per90, minsPg,
                gamesSample: seasonMatches,
                // The rate whether or not it cleared the bar to be a route.
                defConHit: rtDefConHit(player),
                breakdown: rtPointSources(player)
            };
        }

        // How much the next opponent helps or hurts, on the same terms the rest
        // of the page uses. Falls back to FDR when the team model has nothing.
        function rtFixtureFactor(player, pos) {
            const nextFx = player.fixtures?.next3?.[0] || null;
            const ta = (typeof teamAnalysis !== 'undefined' && teamAnalysis) || {};
            if (nextFx && nextFx.opponent && ta[nextFx.opponent]) {
                const o = ta[nextFx.opponent];
                const oppAttack = nextFx.isHome ? (o.attackPowerAway || o.attackPower || 50) : (o.attackPowerHome || o.attackPower || 50);
                const oppDefense = nextFx.isHome ? (o.defensePowerAway || o.defensePower || 50) : (o.defensePowerHome || o.defensePower || 50);
                const relevant = (pos === 'GK' || pos === 'DEF') ? oppAttack : oppDefense;
                let f = 1 + (50 - relevant) * 0.004;
                if (nextFx.isHome) f += 0.04;
                return Math.max(0.75, Math.min(1.3, f));
            }
            const fdr = player.fixtures?.avgFDR3 || 3;
            return Math.max(0.8, Math.min(1.2, (4 - fdr) * 0.15 + 1));
        }
