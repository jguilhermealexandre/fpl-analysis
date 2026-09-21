/* ============================================
   EasyFPL — effective ownership

   Ownership is the number the game publishes and the number this site has
   always used. It answers "is he popular", which is not the question a manager
   has. A season is scored on rank, and rank moves on the difference between
   your squad and everybody else's — so what matters is not how many people own
   a player but how much of the field he carries.

   That is effective ownership. Haaland is owned by 75% of the top 10k and
   captained by 72% of them, so he carries 148% of that field: not owning him
   loses you ground in a week he does nothing, and owning him gains you almost
   nothing when he hauls, because everyone hauled. Isak is owned by 87% of the
   top 10k against 17% of the game at large — the same player is template at the
   sharp end and a differential everywhere else, and plain ownership cannot say
   that.

   This file is a data layer rather than a feature, in the same shape as the
   odds blend: one accessor, consumed wherever ownership was being read before.
   It has no screen of its own.

   It cuts both ways, and the downward half is the less obvious one. Effective
   ownership above plain ownership means captaincy. Below it means the bench:
   Egan is owned by 38% of the top 10k and started by 1% of them, so headcount
   calls him template while the number that decides rank says almost nobody
   actually plays him. Reading the two as interchangeable is how cheap bench
   fodder gets mistaken for a player you have to have.

   Sampled weekly into data/eo.json by tools/fetch-eo.mjs. See that file for the
   method — the short version is that a manager's pick multiplier already
   encodes bench, captain and Triple Captain, so effective ownership over a
   sample is just the mean of it.

   Prefix eo*. No DOM. Callers render.
   ============================================ */

        // Sampled tiers, widest last. Beyond the top 10k, effective ownership
        // converges on plain ownership, which the bootstrap already gives us.
        const EO_TIERS = ['top1k', 'top10k', 'top100k'];

        // What most engaged managers are actually chasing, and so the default
        // field to measure a decision against.
        const EO_DEFAULT_TIER = 'top10k';

        /* Bands for a single player's EO. Deliberately not the same thresholds
           as raw ownership: a 25%-owned player who is never captained moves the
           field far less than a 25%-owned player who is captained by half of
           those who hold him, and the bands have to reflect the load rather
           than the headcount. */
        const EO_TEMPLATE = 45;
        const EO_DIFFERENTIAL = 12;

        let eoData = null;            // parsed data/eo.json, or null until loaded

        function eoSetData(data) {
            eoData = (data && data.players && data.metadata) ? data : null;
            return eoData;
        }

        function eoReady() { return eoData != null; }

        function eoMeta() { return eoData ? eoData.metadata : null; }

        function eoTierLabel(tier) {
            if (tier === 'league') return (eoLeagueData && eoLeagueData.label) || 'Your league';
            const t = eoData && eoData.metadata.tiers.find(x => x.id === tier);
            return t ? t.label : tier;
        }

        /* The smallest ownership the sample can express.

           With four hundred managers a tier, one owner is 0.25%, so anything
           rarer is indistinguishable from nobody. Reporting an absent player as
           a flat 0% would be a stronger claim than the sample supports. */
        function eoResolution(tier) {
            if (tier === 'league') {
                return eoLeagueData && eoLeagueData.sampled
                    ? Math.round((100 / eoLeagueData.sampled) * 100) / 100 : null;
            }
            const t = eoData && eoData.metadata.tiers.find(x => x.id === (tier || EO_DEFAULT_TIER));
            return t && t.sampled ? Math.round((100 / t.sampled) * 100) / 100 : null;
        }

        /* Effective ownership for one player in one tier.

           Returns null when there is no table at all — the caller should fall
           back to plain ownership rather than print a zero. A player who is in
           the table's universe but owned by nobody in the sample comes back as
           zero with `below` set, which is a different and weaker statement. */
        function eoFor(playerId, tier) {
            const t = tier || EO_DEFAULT_TIER;
            /* The league tier is sampled in the browser and held separately, so
               it is available even when the weekly file is not — and absent
               when it has not been sampled yet, whatever the file says. */
            if (t === 'league') {
                if (!eoLeagueData) return null;
                const v = eoLeagueData.players[String(playerId)];
                return v ? { eo: v.eo, own: v.own, cap: v.cap, below: false, tier: t }
                    : { eo: 0, own: 0, cap: 0, below: true, tier: t };
            }
            if (!eoData) return null;
            const row = eoData.players[String(playerId)];
            const v = row && row[t];
            if (v) return { eo: v.eo, own: v.own, cap: v.cap, below: false, tier: t };
            return { eo: 0, own: 0, cap: 0, below: true, tier: t };
        }

        function eoBand(eo) {
            if (eo == null) return 'unknown';
            return eo >= EO_TEMPLATE ? 'template' : eo >= EO_DIFFERENTIAL ? 'mid' : 'differential';
        }

        // How a player reads on screen: "148%", or "under 0.3%" when the sample
        // cannot see him at all.
        function eoText(v) {
            if (!v) return null;
            if (v.below) {
                const res = eoResolution(v.tier);
                return res ? `under ${res}%` : '0%';
            }
            return `${v.eo}%`;
        }

        /* What a transfer does to your exposure.

           The number that matters is not either player's ownership but the
           swing: moving from a 60% EO player to a 10% EO player takes fifty
           points of the field off your team, which gains rank when it works and
           loses it when it does not. */
        function eoSwing(outId, inId, tier) {
            const a = eoFor(outId, tier), b = eoFor(inId, tier);
            if (!a || !b) return null;
            return {
                out: a, in: b,
                delta: Math.round((b.eo - a.eo) * 10) / 10,
                tier: a.tier,
                label: eoTierLabel(a.tier)
            };
        }

        /* How exposed a whole squad is, against the field it is being compared
           to. The sum rather than the mean, because eleven players each carrying
           40% is a different position from eleven each carrying 90% and the mean
           hides the captain's doubled weight. */
        function eoSquadLoad(squad, tier) {
            if (!eoData || !squad || !squad.length) return null;
            const t = tier || EO_DEFAULT_TIER;
            const starters = squad.filter(p => p.pickPosition == null || p.pickPosition <= 11);
            let total = 0, counted = 0;
            starters.forEach(p => {
                const v = eoFor(p.id, t);
                if (!v) return;
                // The captain carries twice, exactly as he does in the sample.
                total += v.eo * (p.isCaptain ? 2 : 1);
                counted++;
            });
            if (!counted) return null;
            return {
                total: Math.round(total * 10) / 10,
                perStarter: Math.round((total / counted) * 10) / 10,
                counted, tier: t, label: eoTierLabel(t)
            };
        }

        /* ===== Your mini-league =====

           The one field that cannot be shipped in a file, because it is
           different for every person who opens the page. It is also the field
           that actually matters to most managers: nobody's season is decided
           against the top 10k, it is decided against about twenty people they
           know.

           Same arithmetic as the committed tiers — the mean pick multiplier —
           but sampled in the browser, from the league standings and then each
           member's picks. About one request per member, so it is capped and
           cached: a league's picks cannot change until the next deadline, which
           makes the gameweek a complete cache key rather than a heuristic. */

        const EO_LEAGUE_MAX = 100;      // two pages of standings
        const EO_LEAGUE_CONCURRENCY = 4;
        const EO_LEAGUE_STORE = 'easyfpl_eo_league';

        let eoLeagueData = null;        // { leagueId, gw, label, sampled, players }

        function eoLeagueKey(leagueId, gw) { return `${EO_LEAGUE_STORE}:${leagueId}:${gw}`; }

        function eoSetLeague(data) {
            eoLeagueData = (data && data.players) ? data : null;
            return eoLeagueData;
        }

        function eoLeagueReady(leagueId, gw) {
            return !!(eoLeagueData && (leagueId == null || eoLeagueData.leagueId === leagueId)
                && (gw == null || eoLeagueData.gw === gw));
        }

        function eoLoadCachedLeague(leagueId, gw) {
            try {
                const raw = JSON.parse(localStorage.getItem(eoLeagueKey(leagueId, gw)) || 'null');
                if (raw && raw.players) return eoSetLeague(raw);
            } catch (e) { /* private mode, or nothing there */ }
            return null;
        }

        /* Sample it. Resolves to the tier data, or null when the league is too
           small to say anything — a league of three tells you nothing about a
           field and would render percentages in thirds. */
        async function eoSampleLeague(leagueId, gw, label) {
            if (leagueId == null || gw == null) return null;
            const cached = eoLoadCachedLeague(leagueId, gw);
            if (cached) return cached;
            if (typeof fetchWithProxy !== 'function') return null;

            const entries = [];
            for (let page = 1; page <= 2 && entries.length < EO_LEAGUE_MAX; page++) {
                let data;
                try {
                    const res = await fetchWithProxy(
                        `https://fantasy.premierleague.com/api/leagues-classic/${leagueId}/standings/?page_standings=${page}`);
                    data = await res.json();
                } catch (e) { break; }
                const rows = (data.standings && data.standings.results) || [];
                if (!rows.length) break;
                rows.forEach(r => { if (entries.length < EO_LEAGUE_MAX) entries.push(r.entry); });
                if (!data.standings.has_next) break;
            }
            // Below this the percentages are coarser than the thing they measure.
            if (entries.length < 4) return null;

            const squads = [];
            let cursor = 0;
            await Promise.all(Array.from({ length: Math.min(EO_LEAGUE_CONCURRENCY, entries.length) }, async () => {
                while (cursor < entries.length) {
                    const id = entries[cursor++];
                    try {
                        const res = await fetchWithProxy(
                            `https://fantasy.premierleague.com/api/entry/${id}/event/${gw}/picks/`);
                        const picks = (await res.json()).picks;
                        if (Array.isArray(picks)) squads.push(picks);
                    } catch (e) { /* one manager missing does not spoil a league */ }
                }
            }));
            if (squads.length < 4) return null;

            const mult = new Map(), owned = new Map(), capt = new Map();
            squads.forEach(picks => picks.forEach(p => {
                mult.set(p.element, (mult.get(p.element) || 0) + p.multiplier);
                owned.set(p.element, (owned.get(p.element) || 0) + 1);
                if (p.is_captain) capt.set(p.element, (capt.get(p.element) || 0) + 1);
            }));

            const n = squads.length, r1 = v => Math.round(v * 10) / 10;
            const players = {};
            for (const [id, total] of mult) {
                players[id] = {
                    eo: r1((total / n) * 100),
                    own: r1(((owned.get(id) || 0) / n) * 100),
                    cap: r1(((capt.get(id) || 0) / n) * 100)
                };
            }

            const out = { leagueId, gw, label: label || 'Your league', sampled: n, players };
            try { localStorage.setItem(eoLeagueKey(leagueId, gw), JSON.stringify(out)); } catch (e) { /* fine */ }
            return eoSetLeague(out);
        }
