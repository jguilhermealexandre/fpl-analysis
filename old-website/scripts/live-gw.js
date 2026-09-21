/* ============================================
   EasyFPL — live gameweek

   What a squad is scoring while the matches are actually being played, and
   what the bonus points are likely to be before the game confirms them.

   Plain globals in a classic script, like the rest of the codebase. No DOM
   here — callers render.

   The one genuinely non-obvious piece is projected bonus. During a match the
   official data publishes `bps` continuously but leaves `bonus` at zero until
   the fixture finishes, so a live score read straight off `total_points` is
   short by up to three points a player for every match still in play. The
   bonus is not a guess: it is a deterministic function of the BPS table, so
   it can be computed exactly rather than estimated.
   ============================================ */

        /* Bonus from a fixture's BPS table, following the game's own tie rules:

             - highest BPS takes 3
             - if one player leads, the next takes 2; if that is also unique,
               the third takes 1
             - if two share the lead, both take 3 and the next takes 1
             - if three or more share the lead, they all take 3 and nothing
               further is awarded
             - if two or more share second, they all take 2 and no 1 is given

           Only players who actually appeared are eligible. */
        function liveBonusForFixture(players) {
            const out = {};
            const eligible = (players || []).filter(p => (p.minutes || 0) > 0);
            if (!eligible.length) return out;

            const tiers = [...new Set(eligible.map(p => p.bps || 0))].sort((a, b) => b - a);
            const at = bps => eligible.filter(p => (p.bps || 0) === bps);

            const first = at(tiers[0]);
            first.forEach(p => { out[p.id] = 3; });
            if (first.length >= 3) return out;

            if (first.length === 2) {
                // Two on 3 points already fills the top two places; the next
                // distinct score collects the single remaining point.
                (tiers[1] !== undefined ? at(tiers[1]) : []).forEach(p => { out[p.id] = 1; });
                return out;
            }

            const second = tiers[1] !== undefined ? at(tiers[1]) : [];
            second.forEach(p => { out[p.id] = 2; });
            if (second.length !== 1) return out;   // a shared second consumes the last point

            (tiers[2] !== undefined ? at(tiers[2]) : []).forEach(p => { out[p.id] = 1; });
            return out;
        }

        /* Fetch one gameweek's live element data.

           Returns the per-player stats keyed by id, plus the same players
           grouped by the fixture they appeared in — which is what the bonus
           calculation needs, and which is only available from the `explain`
           blocks rather than the stats themselves. */
        async function liveFetchStats(gw) {
            const res = await fetchWithProxy(`https://fantasy.premierleague.com/api/event/${gw}/live/`);
            const data = await res.json();
            const byId = {}, byFixture = {};
            (data.elements || []).forEach(e => {
                const st = e.stats || {};
                byId[e.id] = st;
                (e.explain || []).forEach(ex => {
                    const fid = ex.fixture;
                    if (fid == null) return;
                    (byFixture[fid] = byFixture[fid] || []).push({
                        id: e.id, bps: st.bps || 0, minutes: st.minutes || 0
                    });
                });
            });
            return { byId, byFixture };
        }

        /* Which fixtures in this gameweek have started but not yet had their
           bonus confirmed. Those are the only ones worth projecting: once a
           fixture is finished the awarded bonus is already inside
           total_points, and projecting it again would double-count. */
        function livePendingBonusFixtures(fixtures, gw) {
            return (fixtures || [])
                .filter(f => f.event === gw && f.started && !f.finished)
                .map(f => f.id);
        }

        function liveIsInPlay(fixtures, gw) {
            return (fixtures || []).some(f => f.event === gw && f.started && !f.finished);
        }

        // Projected bonus per player id, across every fixture still awaiting it.
        function liveProjectedBonus(byFixture, pendingFixtureIds) {
            const out = {};
            (pendingFixtureIds || []).forEach(fid => {
                const awarded = liveBonusForFixture(byFixture[fid]);
                Object.keys(awarded).forEach(pid => { out[pid] = awarded[pid]; });
            });
            return out;
        }

        /* A squad's live score.

           `picks` is the raw picks array, whose `multiplier` already encodes
           captaincy and triple captain, so neither needs special-casing. Bench
           players score only under Bench Boost, where the game sets their
           multiplier to 1 rather than 0 — but older payloads do not always, so
           the chip is honoured explicitly.

           Projected bonus is returned separately rather than folded into the
           total, because it is the one number on the card that is not yet
           real, and a screen that blends the two cannot tell the manager which
           part of their score is safe. */
        function liveSquadScore(picks, byId, projBonus, opts) {
            const o = opts || {};
            const benchBoost = o.activeChip === 'bboost';
            let points = 0, bonus = 0, toPlay = 0, inPlay = 0, finished = 0;

            (picks || []).forEach(pick => {
                const counts = pick.position <= 11 || benchBoost;
                if (!counts) return;
                const mult = benchBoost && pick.position > 11 ? 1 : (pick.multiplier || 1);
                const st = byId[pick.element];
                if (!st) { toPlay++; return; }

                points += (st.total_points || 0) * mult;
                bonus += ((projBonus || {})[pick.element] || 0) * mult;

                if (!st.played && (st.minutes || 0) === 0) toPlay++;
                else if (st.played) finished++;
                else inPlay++;
            });

            return { points, projBonus: bonus, toPlay, inPlay, finished };
        }
