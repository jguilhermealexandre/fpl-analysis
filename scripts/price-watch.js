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

        /* ===== Where the price has actually been =====

           The meter above answers "is he about to move". This answers "what has
           he done", which is the question a squad's value is made of and which
           nothing on the site could answer.

           Two sources, because neither is complete on its own. Each gameweek row
           in players-data.json carries `value`, the player's price at that
           gameweek — that is the path. But it stops at the last gameweek played,
           and prices move nightly, so a player who rose since Saturday is
           already dearer than his own last row: De Cuyper reads 45, 46, 47
           across GW1-3 and is 48 today. now_cost is therefore appended as a
           final point rather than trusted to be the last row.

           The start price is `now_cost - cost_change_start`, which the game
           maintains for exactly this purpose and which agrees with the first
           history row where one exists. It is used on its own when a player has
           no history at all — signed mid-season, or the file has not caught up —
           so the headline start-to-now figure survives an empty path.

           Prices are held in tenths of a million throughout and divided once, at
           the edge, so no intermediate rounding can drift. */
        function pwPriceHistory(player, history) {
            if (!player) return null;
            // Every caller builds players through xpBuildPlayers, where `price` is
            // now_cost/10. Back to tenths, so the arithmetic below is integers.
            const nowTenths = Math.round(pwNum(player.price) * 10);
            if (!nowTenths) return null;
            const startTenths = nowTenths - pwNum(player.costChangeStart);

            const points = [];
            (history || []).forEach(row => {
                const v = pwNum(row && row.value);
                const gw = row && row.round;
                if (!v || gw == null) return;
                points.push({ gw: Number(gw), tenths: v });
            });
            points.sort((a, b) => a.gw - b.gw);

            // The live price, as a point of its own — unless the last row is
            // already it, in which case a duplicate would flatten the tail.
            const last = points[points.length - 1];
            if (!last || last.tenths !== nowTenths) {
                points.push({ gw: null, tenths: nowTenths, isNow: true });
            } else {
                last.isNow = true;
            }

            /* Every step the price actually took, which is not the same as one
               per gameweek: most weeks it does not move, and the weeks it does
               are the only ones worth listing. */
            const moves = [];
            let prev = points.length ? points[0].tenths : startTenths;
            if (points.length && points[0].tenths !== startTenths) {
                moves.push({ gw: points[0].gw, from: startTenths, to: points[0].tenths });
                prev = points[0].tenths;
            }
            points.slice(1).forEach(pt => {
                if (pt.tenths !== prev) {
                    moves.push({ gw: pt.gw, from: prev, to: pt.tenths, isNow: !!pt.isNow });
                }
                prev = pt.tenths;
            });

            const all = points.map(p => p.tenths).concat([startTenths]);
            return {
                startTenths,
                nowTenths,
                netTenths: nowTenths - startTenths,
                start: startTenths / 10,
                now: nowTenths / 10,
                net: (nowTenths - startTenths) / 10,
                high: Math.max.apply(null, all) / 10,
                low: Math.min.apply(null, all) / 10,
                rises: moves.filter(m => m.to > m.from).length,
                falls: moves.filter(m => m.to < m.from).length,
                moves,
                /* Always at least two points, so a flat season still draws a
                   line rather than a dot. A point carries either a gameweek or
                   one of the two roles — the season's opening price, and today's
                   — because neither of those is a gameweek and labelling them
                   with one would be a small lie in every tooltip. */
                points: points.length > 1
                    ? points
                    : [{ gw: null, isStart: true, tenths: startTenths }].concat(points)
            };
        }

        // A host page can check the engine loaded before calling it.
        function pwEngineReady() {
            return typeof pwClassify === 'function';
        }

        /* ===== How close a player is to a price change =====

           These came out of transfer-wizard.js, where they had no business
           being: the comment below already says "the same tiers price-watch.js
           uses at the top and bottom, so the two panels cannot describe one
           player differently" — and the squad page reads them on the default
           tab, from the price panel in team-analysis-core.js. One model, one
           file, and the wizard no longer has to be in memory for Squad
           Analysis to say who is about to drop. */
        // ===== TRANSFER MARKET =====
        /* When FPL changes prices.

           It moved for 2026/27. The Premier League's own announcement of the
           Price Change Predictor says the tool indicates who will rise and fall
           "each day at 00:00 UK time"; this used to be hard-coded at 01:30 UTC,
           which is now up to an hour and a half late and, through British
           Summer Time, on the wrong day entirely.

           UK time rather than UTC, so it cannot be a constant: midnight in
           London is 23:00 UTC in summer and 00:00 UTC in winter. */
        const PRICE_LOCK_TZ = 'Europe/London';

        // A player's distance to a price change, as a signed percentage: +100 means
        // on track to rise, -100 on track to drop. This is the same transfer-velocity
        // model behind the pitch badge (net transfers over the current owner base),
        // scaled so the thresholds land at ±100 — NOT FPL's own published figure,
        // which does not exist publicly.
        /* How far along the meter a player is, from FPL's own figure.

           This used to be a model: net transfers over the owner base, times
           five hundred, clamped. It was written before the game published
           anything, and it was left in place after it did — so this page and
           the dashboard answered the same question from different numbers and
           disagreed in public. Ballard sat at −92.5 on the game's meter and
           −11.5 on the model, so the dashboard called him a near-certain drop
           while this page said no squad player was close to one.

           The model was not merely miscalibrated, it was noise. Dividing net
           transfers by a tiny owner base saturates the clamp on a handful of
           moves: Matusiwa, three in and two out at 0.0% ownership, scored a
           maximum +100 rise while the game's meter had him at −90.3.

           price_change_percent is what the official Price Change Predictor is
           built on, so there is nothing left to model. One number, read the
           same way here as in scripts/price-watch.js. */
        function priceThresholdPct(p) {
            const v = p && p.priceProgress;
            return typeof v === 'number' && isFinite(v) ? v : 0;
        }

        /* The same tiers price-watch.js uses at the top and bottom, so the two
           panels cannot describe one player differently. Anything past the line
           is due tonight; PW_CLOSE short of it is a watch item and deliberately
           not a forecast.

           Between those lines this used to say one word — "Safe" — for every
           player, and the meter runs from -100 to +100. So a player 60% of the
           way to a DROP was labelled safe, and so was one 60% of the way to a
           rise, and so was one who had not moved at all. Measured on the live
           feed that is 605 of 659 players sharing a single label: 300 being
           sold, 164 being bought, 141 genuinely still. The one thing an owner
           wants from this column — which way is my player going — was the thing
           it threw away.

           price-watch.js does not disagree with what follows, because it says
           nothing here at all: below PW_CLOSE it returns null and the player is
           simply left out of that panel. The shared vocabulary is the four outer
           tiers, and those are untouched.

           "Drifting" rather than "rising" or "falling" on purpose. The meter is
           progress, not a prediction — the column's own header says so — and a
           player at +30 is not on his way anywhere in particular. Direction is a
           fact about the number; arrival is not. */
        function thresholdState(pct) {
            const due = typeof PW_DUE === 'number' ? PW_DUE : 100;
            const close = typeof PW_CLOSE === 'number' ? PW_CLOSE : 80;
            if (pct >= due) return { cls: 'rise-imminent', text: 'Rises tonight', short: 'Rising' };
            if (pct >= close) return { cls: 'rise', text: 'Climbing', short: 'Climbing' };
            if (pct <= -due) return { cls: 'drop-imminent', text: 'Drops tonight', short: 'Dropping' };
            if (pct <= -close) return { cls: 'drop', text: 'Sliding', short: 'Sliding' };
            /* Zero is its own answer and a common one — a fifth of the league sits
               exactly there. Everything else takes the sign it actually has; no
               dead zone, because any width for one would be invented. */
            if (pct > 0) return { cls: 'drift-up', text: 'Drifting up', short: 'Up' };
            if (pct < 0) return { cls: 'drift-down', text: 'Drifting down', short: 'Down' };
            return { cls: 'stable', text: 'Not moving', short: 'Flat' };
        }

        // How far London is ahead of UTC at a given instant, in milliseconds.
        function londonOffsetMs(at) {
            const parts = {};
            new Intl.DateTimeFormat('en-GB', {
                timeZone: PRICE_LOCK_TZ, hour12: false,
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            }).formatToParts(at).forEach(x => { if (x.type !== 'literal') parts[x.type] = x.value; });
            const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
            const asIfUTC = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
                hour, Number(parts.minute), Number(parts.second));
            return asIfUTC - Math.floor(at.getTime() / 1000) * 1000;
        }

        /* The next midnight in London, as a real instant.

           The offset is recomputed at the target rather than reused from now,
           so the one night a year the clocks change does not move the deadline
           by an hour. */
        function nextPriceLock(now) {
            const at = now != null ? new Date(now) : new Date();
            const wall = new Date(at.getTime() + londonOffsetMs(at));
            const nextMidnightWall = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()) + 86400000;
            const firstGuess = new Date(nextMidnightWall - londonOffsetMs(at));
            return new Date(nextMidnightWall - londonOffsetMs(firstGuess));
        }
