/* ============================================
   EasyFPL — price watch

   Who is about to rise or fall, from the official price engine rather than
   from a guess of our own.

   The game publishes a progress meter per player, `price_change_percent`.
   It runs from 0 toward 100 as buyers pile in, or toward -100 as sellers
   leave. When the meter fills, the price moves at the next daily update.
   Two supporting fields come with it: `price_change_projections`, the
   game's own forecast of that meter for today, tomorrow and the day after,
   and `price_change_locked_until`, a timestamp before which the player
   simply cannot move.

   Two things were measured against a real overnight window (the shipped
   data file from 15:45 UTC against a live pull the following afternoon,
   spanning four actual price changes) rather than assumed:

     - A full meter is trustworthy. All three players already at or past
       |100| changed, with no false alarms.

     - The game's own next-day projection is not, on its own, a prediction
       of tonight. It caught all four changes but flagged nineteen players
       to do it. It extrapolates current momentum, and momentum decays
       overnight, so most of those nineteen did not move.

   Hence two tiers, and deliberately different language for each. "Due"
   means the meter is full and the change fires at the next update. "Closing
   in" means exactly that and no more — it is a watch item, not a forecast.
   The copy must never promise tonight for a player in the second tier.

   One field is deliberately unused. `price_change_hourly_rate` looks like it
   should give an ETA, but solving it against the published projections gives
   a conversion constant ranging from 23 to 1120 across the pool — a 50x
   spread, so the two are not on the same scale and any hour count derived
   from it would be invented. The projections carry the forward view instead.

   Plain globals in a classic script, like the rest of the codebase. No DOM
   here — callers render.
   ============================================ */

        // The meter is full: the change happens at the next daily update.
        const PW_DUE = 100;
        // Near the line. A watch item — see the header for why this is not a forecast.
        const PW_CLOSE = 80;

        function pwNum(v) {
            const n = parseFloat(v);
            return isFinite(n) ? n : 0;
        }

        /* A player cannot move while locked, whatever the meter says. In
           practice the game zeroes the meter for these anyway, but the lock is
           the authoritative signal and it costs nothing to honour it. */
        function pwIsLocked(player) {
            const until = player && player.priceLockedUntil;
            if (!until) return false;
            const t = Date.parse(until);
            return isFinite(t) && t > Date.now();
        }

        /* Ambient displays (the market ticker) want movement worth watching;
           alerts want only the near-certain. Same classification, different bar. */
        const PW_TICKER_FLOOR = 20;

        /* null when the player is not worth mentioning — locked, or the meter
           is not far enough along to clear `floor` (default: alert-grade). */
        function pwClassify(player, floor) {
            if (!player || pwIsLocked(player)) return null;

            const progress = pwNum(player.priceProgress);
            if (!progress) return null;

            const proj = player.priceProjection || [];
            const projected = proj.length > 1 ? pwNum(proj[1]) : progress;

            const mag = Math.abs(progress);
            if (mag < (floor === undefined ? PW_CLOSE : floor)) return null;

            return {
                id: player.id,
                player: player,
                dir: progress > 0 ? 'rise' : 'fall',
                tier: mag >= PW_DUE ? 'due' : 'close',
                progress: progress,
                projected: projected
            };
        }

        /* Risers and fallers, each sorted by how far along the meter is.
           `owned` is an optional Set of player ids used to mark your own. */
        function pwMovers(players, limit, floor) {
            const out = { risers: [], fallers: [] };
            (players || []).forEach(p => {
                const c = pwClassify(p, floor);
                if (!c) return;
                (c.dir === 'rise' ? out.risers : out.fallers).push(c);
            });
            const byProgress = (a, b) => Math.abs(b.progress) - Math.abs(a.progress);
            out.risers.sort(byProgress);
            out.fallers.sort(byProgress);
            if (limit) {
                out.risers = out.risers.slice(0, limit);
                out.fallers = out.fallers.slice(0, limit);
            }
            return out;
        }

        // Short label for a classification, e.g. "Rises tonight" / "82% there".
        function pwLabel(c) {
            if (c.tier === 'due') return c.dir === 'rise' ? 'Rise due' : 'Drop due';
            return Math.round(Math.abs(c.progress)) + '% there';
        }

        /* The sentence under the name. Kept in one place so the two tiers can
           never drift into promising the same thing. */
        function pwDetail(c) {
            const dir = c.dir === 'rise' ? 'rise' : 'drop';
            if (c.tier === 'due') {
                return `The meter is full, so this ${dir} happens at the next daily price update.`;
            }
            const proj = Math.round(Math.abs(c.projected));
            const crosses = Math.abs(c.projected) >= PW_DUE;
            return crosses
                ? `${Math.round(Math.abs(c.progress))}% of the way. The game projects ${proj}% by tomorrow, which would cross the line — though most players this close do not move tonight.`
                : `${Math.round(Math.abs(c.progress))}% of the way, and not projected to cross yet.`;
        }

        // A host page can check the engine loaded before calling it.
        function pwEngineReady() {
            return typeof pwClassify === 'function';
        }
