/* ============================================
   EasyFPL — the Transfer Funnel

   The market pane of the Transfer Wizard, rebuilt as a two-step funnel:

     1. NARROW — choose the fixture run you want to own, then the kind of
                 player you want inside it. Both halves are filters, and the
                 header counts the pool down as each one bites.
     2. PICK   — what survived, priced against the player going out, showing
                 the team and player evidence that produced the number.

   It replaces a flat ranked list whose only control was four price bands and
   whose only team context was three fixture-difficulty chips. Everything this
   file puts on screen was already computed on this page and never reached it:
   teamAnalysis (attack/defence power including venue splits, form rating, xG
   and xGC trends), fixtureSwingData (direction, magnitude, pivot gameweek),
   seasonStats, teamFixtures6 and the per-gameweek history inside
   playersDetailData.

   Prefix twf*. Loaded after scripts/transfer-wizard.js. Plain classic script,
   so every function stays a global — the inline onclick= handlers written
   below depend on that, as does renderTWMarket() calling in.

   DEPENDENCIES — globals the squad page already defines by the time the
   wizard can be opened:

     allPlayers, teams, teamAnalysis, teamFixtures6, fixtureSwingData,
     seasonStats, playersDetailData, selectedPlayers, transferState, currentGW,
     escHTML, xpPlanGWs, projectPlayerPointsDetailed, expectedMinutesModel,
     minMinutesForCandidate, priceChangeBadge, getTWShortlistIds,
     twSlotBudget, twReservedFor, twBlockedClubIds, twShortlistBreakdownText,
     twPreviewPlayer, renderTWMarketPane
   ============================================ */

        // How many survivors the Pick step renders. The funnel is meant to hand
        // over a shortlist, not a second list to scroll — but the cap is high
        // enough that a manager who filters nothing still gets a usable market.
        /* Eight, in two columns — a shortlist you can compare rather than a
           page you scroll. The filter bar is how you reach the ninth. */
        const TWF_MAX_SHOW = 8;

        const TWF_POS_NAMES = ['', 'Goalkeepers', 'Defenders', 'Midfielders', 'Forwards'];
        const TWF_POS_SHORT = ['', 'GK', 'DEF', 'MID', 'FWD'];

        /* Every filter the funnel holds, in one object. One of these lives on
           each pending transfer — see twfState and twfSeedFilters below for
           which slot owns which, and what a new slot starts out as. */
        function twfDefaultFilters() {
            return {
                view: 'quick',      // quick | custom — see twfRenderQuick
                clubs: [],          // team ids; empty means every club
                minutes: 'any',     // any | likely | nailed
                form: 'any',        // any | hot | cold
                quality: 'any',     // any | top25 | top10
                price: 'any',       // any | cheaper | same | upgrade
                own: 'any',         // any | template | mid | diff
                setPiece: 'any',    // any | pens | any
                avail: 'fit',       // fit | all
                defcon: false,
                source: 'all',      // all | favorites
                search: '',
                sort: 'xp'          // xp | value | form | diff | minutes
            };
        }

        /* How many replacements Quick picks offers. Small on purpose: this is
           the answer to "who is the obvious swap", and a list you have to scan
           is the thing the funnel is for. */
        const TWF_QUICK_SHOW = 6;

        /* How deep the shortlist goes before the sort is applied to it. Twenty
           four is wide enough that "Differential" and "Value" reach past the
           obvious names, and narrow enough that everything in it is a player
           you would genuinely consider. See twfRenderQuick. */
        const TWF_QUICK_POOL = 24;

        /* Horizon, sort and which of the two views you are in describe how you
           like to work rather than who you are looking for, so they follow you
           between slots while every actual filter starts clean. Someone who
           prefers the funnel should not have to re-open it for every transfer. */
        let twfViewPrefs = { sort: 'xp', view: 'quick' };

        /* Filters belong to the slot, not to the screen.

           They used to live on one transferState.funnel shared by every pending
           transfer. Narrow the market to cheap defenders from improving-fixture
           clubs for your centre-back, then hit Swap on your striker, and you
           were handed a striker list still restricted to those clubs and to a
           price band chosen for somebody else — with the chips at the top
           describing a search you were no longer running.

           That is what "the panel loses context when I select multiple players"
           actually was. Nothing was being lost: the wrong thing was being kept,
           which looks the same from the outside and is the opposite bug. Each
           pending transfer now carries its own funnel, so switching between
           slots restores the search you left there, and a slot that goes away
           takes its filters with it. */
        /* Which cards are showing everything.

           The card carries two levels: what decides the pick — who he is, what
           he projects, and how that projection is spread across the run — and
           then eighteen rows of player and club detail underneath. Both at
           once made six replacements an unreadable wall, and the top half is
           what you actually scan on. The bottom half is a click away, and this
           remembers the clicks so re-rendering the list for a filter keystroke
           does not close a card you just opened. */
        const twfOpenCards = new Set();

        function twfToggleDetail(playerId, ev) {
            if (ev) ev.stopPropagation();
            const card = document.querySelector(`.twf-card[data-pid="${playerId}"]`);
            if (!card) return;
            const open = !card.classList.contains('is-open');
            card.classList.toggle('is-open', open);
            if (open) twfOpenCards.add(playerId); else twfOpenCards.delete(playerId);
            const btn = card.querySelector('.twf-more');
            if (btn) {
                btn.setAttribute('aria-expanded', String(open));
                const label = btn.querySelector('.twf-more-l');
                if (label) label.textContent = open ? 'Less' : 'All the numbers';
            }
        }

        function twfState(slotIdx) {
            const i = slotIdx == null ? transferState.activeSlot : slotIdx;
            const slot = transferState.pending[i];
            /* The summary and comparison panes read filters with no slot
               selected. They get a screen-level object rather than a throw —
               it is only ever read for horizon and sort in that state. */
            if (!slot) {
                if (!transferState.funnel) transferState.funnel = twfDefaultFilters();
                return transferState.funnel;
            }
            if (!slot.funnel) slot.funnel = twfSeedFilters(slot);
            return slot.funnel;
        }

        /* What a slot's filters start out as.

           Two demands pull against each other here. Filling eight slots on a
           wildcard should not mean re-picking the same six clubs eight times,
           which argues for carrying the last search over. But handing a striker
           search the club list and price band chosen for a centre-back is
           exactly the carry-over that read as lost context.

           Position settles it: the same position is the same kind of search and
           inherits, a different one starts clean. The scan runs backwards so it
           picks up the most recent slot of that position rather than the oldest.
           Free-text search always resets — a search for one player is never the
           right starting point for another. */
        function twfSeedFilters(slot) {
            let prev = null;
            for (let i = transferState.pending.length - 1; i >= 0; i--) {
                const other = transferState.pending[i];
                if (other !== slot && other.funnel && other.soldPlayer.position === slot.soldPlayer.position) {
                    prev = other.funnel;
                    break;
                }
            }
            const base = prev
                ? Object.assign({}, prev, { search: '' })
                : twfDefaultFilters();
            /* The horizon used to be seeded here and overridden for a Free
               Hit. It is not a filter any more — twfGWs() decides it, and asks
               twStrategyHorizon() directly — so there is nothing to carry. */
            return Object.assign(base, twfViewPrefs);
        }

        /* The gameweeks the whole screen is reasoning over. One horizon drives
           every number in the pane, so the fixture strip, the projection and the
           delta can never be describing different stretches of the season.

           Five, always, with one exception below. The 3 / 5 / 8 selector is
           gone: five is what the recommender in transfer-engine.js already
           decides on (TW_HORIZON) and what a transfer is in practice, so the
           other two were offering to disagree with the rest of the site about
           the horizon a move is judged over. Three flattered a fixture run that
           turns; eight judged a player on games he might not still be at the
           club for.

           The exception is a Free Hit, where the squad is handed back after one
           gameweek — five gameweeks of fixtures are irrelevant to a team you do
           not keep, so twStrategyHorizon() forces one. That is a fact about the
           chip, not a preference, which is why it survives and the buttons did
           not. */
        const TWF_HORIZON = 5;

        function twfGWs() {
            if (typeof xpPlanGWs !== 'function') return [];
            const forced = typeof twStrategyHorizon === 'function' ? twStrategyHorizon() : null;
            return xpPlanGWs(forced === 1 ? 1 : TWF_HORIZON);
        }

        /* ===== Per-player evidence =====

           getPlayerRecentStats() does a linear find over ~626 players on every
           call, which is fine for one squad row and quadratic for a market of a
           hundred and fifty. Index the history once instead, keyed on the object
           identity of playersDetailData so a data refresh rebuilds it. */
        let _twfHistIndex = null;
        let _twfHistSource = null;

        function twfHistory(playerId) {
            if (_twfHistSource !== playersDetailData) {
                _twfHistIndex = new Map();
                ((playersDetailData && playersDetailData.players) || [])
                    .forEach(p => _twfHistIndex.set(p.id, p.history || []));
                _twfHistSource = playersDetailData;
            }
            return _twfHistIndex.get(playerId) || [];
        }

        // Cheap facts — everything the filters need, and nothing that costs a
        // projection. Memoised for the render pass and dropped whenever the
        // inputs that could move them change.
        let _twfFactCache = new Map();

        function twfFacts(p) {
            const hit = _twfFactCache.get(p.id);
            if (hit) return hit;

            const raw = twfHistory(p.id);
            const played = raw.filter(h => h.minutes > 0);
            const last5 = played.slice(-5);
            const l5ppg = last5.length
                ? last5.reduce((s, h) => s + (h.total_points || 0), 0) / last5.length
                : (p.ppg || 0);
            const seasonPpg = p.ppg || 0;

            // Form direction, not form level. A 5.0 average means something
            // different on the way up than on the way down, and the market card
            // has never been able to tell them apart.
            const formRatio = seasonPpg > 0.5 ? l5ppg / seasonPpg : 1;

            // Ceiling and floor. Two players on the same points per game are
            // different assets if one of them returns a haul every fourth week
            // and the other never breaks six.
            const n = played.length;
            const hauls = played.filter(h => (h.total_points || 0) >= 8).length;
            const blanks = played.filter(h => (h.total_points || 0) <= 2).length;

            const mins = typeof expectedMinutesModel === 'function'
                ? expectedMinutesModel(p) : { pStart: 0, expMins: 0 };

            const per90 = (total) => p.minutes > 0 ? (total / p.minutes) * 90 : 0;

            const facts = {
                played: n,
                l5ppg, seasonPpg, formRatio,
                haulRate: n ? hauls / n : 0,
                blankRate: n ? blanks / n : 0,
                // Raw last six rounds including the ones he did not play, because
                // a zero for being dropped is exactly the signal a manager wants.
                spark: raw.slice(-6).map(h => ({ pts: h.total_points || 0, mins: h.minutes || 0, gw: h.round })),
                pStart: mins.pStart,
                expMins: mins.expMins,
                // FPL publishes these per-90s itself; fall back to our own maths
                // for anyone it has not filled in yet.
                xGI90: p.xGI90 != null ? p.xGI90 : per90(p.xGI),
                xG90: p.xG90 != null ? p.xG90 : per90(p.xG),
                xA90: p.xA90 != null ? p.xA90 : per90(p.xA),
                xGC90: p.xGC90 != null ? p.xGC90 : per90(p.xGC),
                saves90: p.saves90 != null ? p.saves90 : per90(p.saves),
                defCon90: p.defCon90 || 0,
                savePct: (p.saves + p.goalsConceded) > 0
                    ? (p.saves / (p.saves + p.goalsConceded)) * 100 : 0,
                csPct: (p.starts || 0) > 0 ? (p.cleanSheets / p.starts) * 100 : 0,
                bonusPerGame: n ? played.reduce((s, h) => s + (h.bonus || 0), 0) / n : 0,
                netTransfers: (p.transfersIn || 0) - (p.transfersOut || 0)
            };
            _twfFactCache.set(p.id, facts);
            return facts;
        }

        /* Underlying quality as a percentile inside the player's own position.

           A rate on its own says nothing — 0.32 xGI/90 is elite for a defender
           and ordinary for a striker — so the quality filter works in
           percentiles and the chip labels itself with the metric it is actually
           ranking on. The cohort is every player in the position clearing the
           minutes floor, not the budget-filtered pool, so "top 10%" does not
           quietly change meaning when the bank does. */
        let _twfCohortCache = {};

/* What "quality" means depends on what the player is bought for.
 *
 * A defender and a keeper are owned for clean sheets, so the number that
 * describes them is expected goals CONCEDED while they are on the pitch — the
 * shot quality their side faces. A midfielder or forward is owned for returns,
 * so it is expected goal involvements. Judging a centre-back on xGI ranked him
 * against strikers on a stat his job does not produce, which is how a filter
 * called "underlying quality" ended up recommending the wrong defenders.
 *
 * NOTE THE DIRECTION, which is the part that matters. For xGI, higher is
 * better. For xGC, LOWER is better — 0.8 expected goals conceded per 90 is a
 * good defence and 2.0 is a bad one. twfQualityPct() inverts for the positions
 * that use it, so "top 10%" always means the best tenth whichever metric is in
 * play. Without that inversion the filter would have returned the ten per cent
 * of defenders who concede most, labelled as the best. */
        function twfQualityMetric(p) {
            if (p.position <= 2) return p.minutes > 0 ? (p.xGC / p.minutes) * 90 : 0;
            return p.minutes > 0 ? (p.xGI / p.minutes) * 90 : 0;
        }

        // True when a low value is the good one.
        function twfQualityLowerIsBetter(pos) { return pos <= 2; }

        function twfQualityLabel(pos) {
            return twfQualityLowerIsBetter(pos) ? 'xGC/90' : 'xGI/90';
        }

        function twfQualityPct(p) {
            const pos = p.position;
            if (!_twfCohortCache[pos]) {
                const floor = typeof minMinutesForCandidate === 'function' ? minMinutesForCandidate() : 0;
                _twfCohortCache[pos] = allPlayers
                    .filter(x => x.position === pos && x.minutes >= floor)
                    .map(twfQualityMetric)
                    .sort((a, b) => a - b);
            }
            const vals = _twfCohortCache[pos];
            if (!vals.length) return 0.5;
            const v = twfQualityMetric(p);
            let lo = 0, hi = vals.length;
            while (lo < hi) { const mid = (lo + hi) >> 1; if (vals[mid] <= v) lo = mid + 1; else hi = mid; }
            const pct = lo / vals.length;
            // Flip for the metrics where least is best, so every caller can go
            // on reading a high percentile as "good".
            return twfQualityLowerIsBetter(p.position) ? 1 - pct : pct;
        }

        // Anything that can move a cached number. Called before each render.
        function twfInvalidate() {
            _twfFactCache = new Map();
            _twfCohortCache = {};
        }

        /* ===== The club board =====

           How good a run is depends on who is playing it and in what position.
           A defender cares about the opponent's attack; a forward cares about
           the opponent's defence — and both care which of them is at home,
           which is why the venue-split ratings get used here rather than the
           blended one. teamAnalysis has carried attackPowerHome/Away and
           defensePowerHome/Away since it was written and nothing on this page
           had ever read them. */
        function twfFixtureScore(f, pos) {
            const ta = teamAnalysis[f.opponentId];
            let s;
            if (ta) {
                // Our fixture at home is the opponent's away game, so the
                // opponent's away rating is the one that applies.
                const power = pos <= 2
                    ? (f.isHome ? (ta.attackPowerAway != null ? ta.attackPowerAway : ta.attackPower)
                                : (ta.attackPowerHome != null ? ta.attackPowerHome : ta.attackPower))
                    : (f.isHome ? (ta.defensePowerAway != null ? ta.defensePowerAway : ta.defensePower)
                                : (ta.defensePowerHome != null ? ta.defensePowerHome : ta.defensePower));
                s = 100 - (power || 50);
            } else {
                s = ((5 - (f.difficulty || 3)) / 4) * 100;
            }
            return s + (f.isHome ? 6 : -6);
        }

        /* One row of the club board.

           Scored per gameweek rather than per fixture: a blank contributes a
           zero and a double contributes both matches, which is the honest
           arithmetic for "how many points does owning this club's run buy me".
           Averaging over fixtures instead would rate a team with three games in
           five gameweeks the same as one with five. */
        function twfClubRun(teamId, pos, gws) {
            const all = teamFixtures6[teamId] || [];
            const perGW = gws.map(gw => {
                const fixtures = all.filter(f => f.event === gw);
                const score = fixtures.reduce((s, f) => s + twfFixtureScore(f, pos), 0);
                return { gw, fixtures, score };
            });

            const flat = perGW.reduce((a, g) => a.concat(g.fixtures), []);
            const runScore = perGW.length
                ? perGW.reduce((s, g) => s + g.score, 0) / perGW.length : 0;
            const avgFdr = flat.length
                ? flat.reduce((s, f) => s + (f.difficulty || 3), 0) / flat.length : 3;

            const ta = teamAnalysis[teamId] || {};
            const ss = (typeof seasonStats !== 'undefined' && seasonStats[teamId]) || {};
            const swing = (typeof fixtureSwingData !== 'undefined' && fixtureSwingData[teamId]) || null;

            return {
                teamId,
                short: (teams[teamId] && teams[teamId].short_name) || '?',
                name: (teams[teamId] && teams[teamId].name) || '?',
                perGW, runScore, avgFdr,
                homes: flat.filter(f => f.isHome).length,
                games: flat.length,
                blanks: perGW.filter(g => !g.fixtures.length).length,
                doubles: perGW.filter(g => g.fixtures.length > 1).length,
                swing,
                form: ta.formRating != null ? ta.formRating : 50,
                wins: ta.wins || 0, draws: ta.draws || 0, losses: ta.losses || 0,
                attack: ta.attackPower != null ? ta.attackPower : 50,
                defence: ta.defensePower != null ? ta.defensePower : 50,
                attackHome: ta.attackPowerHome, attackAway: ta.attackPowerAway,
                defenceHome: ta.defensePowerHome, defenceAway: ta.defensePowerAway,
                // null when the club has not played enough for a six-match
                // window to be compared against its season. `|| 'stable'` here
                // turned "we cannot tell" back into a claim.
                xgTrend: ta.xgTrend || null, xgcTrend: ta.xgcTrend || null,
                xgDelta: ta.xgTrendDelta || 0, xgcDelta: ta.xgcTrendDelta || 0,
                avgGoals: ta.avgGoals || 0, avgConceded: ta.avgConceded || 0,
                csRate: ta.csRate || 0,
                last5: ss.last5Form || [],
                csPercent: ss.csPercent, ftsPercent: ss.ftsPercent
            };
        }

        function twfAllClubRuns(pos, gws) {
            return Object.keys(teams)
                .map(k => twfClubRun(parseInt(k, 10), pos, gws))
                .sort((a, b) => b.runScore - a.runScore);
        }

        /* ===== The filters =====

           Each is a pure predicate over one player and one settings object, so
           the same code can answer "who survives" and "who would survive if this
           chip were on" — which is where the per-chip counts come from. */
        function twfPasses(p, s, ctx) {
            const f = twfFacts(p);

            // Availability lives here rather than in the base pool so the chip
            // counts move when it is toggled; filtered upstream, "Fit only" and
            // "Include doubts" reported the same number.
            if (s.avail === 'fit' && p.status !== 'a') return false;

            if (s.minutes === 'nailed' && f.pStart < 0.8) return false;

            if (s.form === 'hot' && !(f.formRatio > 1.15 && f.played >= 2)) return false;

            if (s.quality === 'top10' && twfQualityPct(p) < 0.9) return false;
            if (s.quality === 'top25' && twfQualityPct(p) < 0.75) return false;

            if (s.price === 'cheaper' && !(p.price < ctx.outPrice - 0.05)) return false;
            if (s.price === 'same' && Math.abs(p.price - ctx.outPrice) > 0.55) return false;
            if (s.price === 'upgrade' && !(p.price > ctx.outPrice + 0.05)) return false;

            if (s.own === 'template' && !(p.ownership > 25)) return false;
            if (s.own === 'mid' && !(p.ownership >= 8 && p.ownership <= 25)) return false;
            if (s.own === 'diff' && !(p.ownership < 8)) return false;

            if (s.setPiece === 'pens' && p.penaltiesOrder !== 1) return false;
            if (s.setPiece === 'sp' && !(p.penaltiesOrder || p.cornersOrder || p.freekicksOrder)) return false;

            // Defensive contribution is a real scoring route for 25/26 and the
            // projection already pays for it; the threshold is 10 for defenders
            // and 12 for everyone else who can reach it.
            if (s.defcon) {
                const threshold = p.position === 2 ? 10 : 12;
                if (p.position === 1 || f.defCon90 < threshold) return false;
            }

            if (s.search) {
                const q = s.search.toLowerCase();
                if (!p.name.toLowerCase().includes(q) && !(p.fullName || '').toLowerCase().includes(q)) return false;
            }
            return true;
        }

        /* The pool this slot can legally shop from, before any funnel filter.

           The Favourites source deliberately relaxes both the budget and the
           minutes floor, exactly as the old tab did: "how does the player I
           starred compare" is worth answering even when he is unaffordable, and
           the card marks that rather than hiding him. */
        function twfBasePool(slotIdx) {
            const slot = transferState.pending[slotIdx];
            const s = twfState();
            const pos = slot.soldPlayer.position;

            const soldIds = new Set(transferState.pending.map(x => x.soldPlayer.id));
            const boughtIds = new Set(transferState.pending.filter(x => x.replacement).map(x => x.replacement.id));
            const exclude = new Set(selectedPlayers.map(p => p.id).concat([...boughtIds]));
            // Players staged for sale in OTHER slots are back on the market — that
            // is the rule the old list used and it is right, because a staged sale
            // has not happened yet. This slot's own man is the exception: he was
            // ranked first in his own replacement list at "+0.0 vs himself", which
            // reads as a broken row rather than as a subtle piece of logic.
            for (const id of soldIds) exclude.delete(id);
            exclude.add(slot.soldPlayer.id);

            const budget = twSlotBudget(slotIdx);
            const floor = typeof minMinutesForCandidate === 'function' ? minMinutesForCandidate() : 0;
            const shortlist = s.source === 'favorites' ? getTWShortlistIds() : null;

            return allPlayers.filter(p => {
                if (p.position !== pos) return false;
                if (exclude.has(p.id)) return false;
                if (shortlist) return shortlist.has(p.id);
                if (p.price > budget + 0.001) return false;
                if (p.minutes < floor) return false;
                // Both fit and doubtful; twfPasses() narrows to one or the other.
                if (p.status !== 'a' && p.status !== 'd') return false;
                return true;
            });
        }

        /* Why a list came back empty, in the terms that caused it.

           The source is the case worth spelling out: an empty Favourites list
           is otherwise indistinguishable from a broken one, when the real answer
           is usually that the starred players are already in the squad or play
           another position. twShortlistBreakdownText() in transfer-wizard.js
           already writes that sentence — it was built for the tab this funnel
           replaced. */
        function twfEmptyReason(pos) {
            const s = twfState();
            if (s.source === 'favorites') {
                const starred = getTWShortlistIds();
                if (!starred.size) {
                    return 'You have not starred any players yet — use the on the Players Analysis page and they show up here.';
                }
                const shortlisted = allPlayers.filter(p => starred.has(p.id));
                const owned = shortlisted.filter(p => p.position === pos && selectedPlayers.some(q => q.id === p.id));
                const otherPos = shortlisted.filter(p => p.position !== pos);
                const why = twShortlistBreakdownText(owned, otherPos, TWF_POS_NAMES[pos] || 'players');
                return `None of your ${shortlisted.length} starred players can fill this slot. ${why}`;
            }
            if (s.clubs.length) {
                return `No ${(TWF_POS_NAMES[pos] || 'players').toLowerCase()} from the ${s.clubs.length} club${s.clubs.length === 1 ? '' : 's'} you selected pass your player filters.`;
            }
            return 'Nothing in the market passes every filter.';
        }

        /* ===== Rendering =====

           Filters change what the market shows and nothing else, so they repaint
           the market pane alone. Going through renderTWAll() would rebuild the
           budget bar and the whole squad list on every keystroke of the search
           box. */
        function twfRerender() {
            /* Which menu was open, so it can be opened again on the far side.
               renderTWMarketPane() replaces the node the click came from, so
               the open state has to survive as a key rather than as an
               element. */
            const reopen = typeof v2MenuOpen !== 'undefined' ? v2MenuOpen : null;
            if (typeof renderTWMarketPane === 'function') renderTWMarketPane();
            if (reopen && typeof v2MenuReopen === 'function') v2MenuReopen(reopen);
            if (typeof lucide !== 'undefined') lucide.createIcons();
            // No initTooltips() here: it binds delegated listeners once at page
            // load and covers anything rendered afterwards by design.
        }

        function twfRenderMarket(el, slotIdx) {
            twfInvalidate();
            const s = twfState();
            const slot = transferState.pending[slotIdx];
            const sold = slot.soldPlayer;
            const pos = sold.position;
            const gws = twfGWs();
            const ctx = { outPrice: sold.sellPrice || sold.price };

            const base = twfBasePool(slotIdx);
            const blocked = twBlockedClubIds(slotIdx);

            /* Quick picks does no filtering, so none of the funnel's work
               applies — and every survivor costs a projection, which is the
               expensive part of this screen. Branch before paying for it. */
            if (s.view === 'quick') {
                el.innerHTML = '<div class="twf">' +
                    twfRenderHead(slotIdx, sold, gws, twfSortRowHTML()) +
                    twfRenderQuick(slot, base, gws, pos, slotIdx, blocked) + '</div>';
                if (typeof lucide !== 'undefined') lucide.createIcons();
                if (s.search) twfRestoreSearchFocus();
                return;
            }

            const clubSet = new Set(s.clubs);
            const afterClubs = clubSet.size
                ? base.filter(p => clubSet.has(p.teamId)) : base;
            const survivors = afterClubs.filter(p => twfPasses(p, s, ctx));

            el.innerHTML = '<div class="twf">' +
                twfRenderHead(slotIdx, sold, gws, twfFilterBarHTML(base, survivors, ctx, pos, gws)) +
                twfRenderCustom(slot, survivors, gws, pos, slotIdx, blocked, ctx) + '</div>';

            if (typeof lucide !== 'undefined') lucide.createIcons();
            if (s.search) twfRestoreSearchFocus();
        }

        function twfRenderHead(slotIdx, sold, gws, filterBar) {
            const s = twfState();

            /* Two ways to answer the same question, and nothing else in this
               row any more.

               The budget went from beside them. It is a number you cannot act
               on here — the pool is already filtered to what you can afford,
               so a player you cannot buy never appears and the figure was
               answering a question the screen had already answered. The slot
               dropdown below still carries it per transfer.

               The 3 / 5 / 8 gameweek buttons went too. See twfGWs(). */
            const views = `<div class="twf-views" role="tablist">
                <button class="twf-view${s.view === 'quick' ? ' active' : ''}" role="tab" aria-selected="${s.view === 'quick'}"
                    onclick="twfSetView('quick')"
                    data-tooltip="The best replacements we can find for ${escHTML(sold.name)}, ranked, with nothing to fill in.">${v2Icon('bolt')} Quick picks</button>
                <button class="twf-view${s.view === 'custom' ? ' active' : ''}" role="tab" aria-selected="${s.view === 'custom'}"
                    onclick="twfSetView('custom')"
                    data-tooltip="Narrow by fixture run, minutes, form, price, ownership and set pieces, then pick from what survives.">${v2Icon('tools')} Custom search</button>
            </div>`;

            const switcher = typeof twSlotSwitcherHTML === 'function' ? twSlotSwitcherHTML() : '';
            const span = gws.length ? `GW${gws[0]}\u2013GW${gws[gws.length - 1]}` : 'no upcoming gameweeks';

            /* The step keeps its own heading once a player is picked.

               This pane used to replace the whole panel header with its tabs,
               so "Replacements — Pick someone on the left" appeared before you
               chose anyone and vanished the moment you did — the one point at
               which the step's name is worth having on screen. twStepHead() is
               the same header every other step draws, so the title, the hint
               and the way back all stay put; the tabs and the filters are a
               row underneath it. */
            const head = typeof twStepHead === 'function' ? twStepHead({
                icon: 'cart', title: 'Replacements',
                hint: `Replacing ${escHTML(sold.name)}`
            }) : '';

            return head + `<div class="twf-head">
                <div class="twf-head-top">
                    ${views}
                    ${filterBar || ''}
                </div>
                ${/* The gameweek span used to sit on a row of its own under the
                      filters, which gave one short label the same weight as
                      every control above it. It rides the slot switcher when
                      there is one, and otherwise moves to the results heading
                      where the numbers it qualifies actually are. */''}
                ${switcher ? `<div class="twf-head-bot">
                    ${switcher}
                    <span class="twf-span" data-tooltip="Every projection and every fixture run on this screen is judged over these gameweeks.">${escHTML(span)}</span>
                </div>` : ''}
            </div>`;
        }

        /* ===== The run =====

           This was twenty club rows, each carrying a run bar, five fixture
           chips, a swing chip ("COV \u2191 Eases GW31"), three power indices and
           five form letters. It was the most information on any screen in the
           app and it was in the way of the thing it introduced: you had to
           scroll a league table to reach the players.

           The presets are what people actually used, and each one is a claim
           the row grid was only evidence for. They stay, the grid goes, and
           what replaces the evidence is the answer — which clubs the preset
           just chose, by name. */
        /* ===== The filter panel =====

           Nine controls in four shapes wrapped onto three rows: dropdowns,
           segmented pairs, a search box and a count bubble, none of them the
           control this site uses everywhere else for exactly this job.

           The All Players bar had already answered it — one "Filters" button
           opening a panel of labelled groups, each group a row of pills. That
           is the site's filter component, it holds nine groups as easily as
           five, and it collapses the whole thing to a single button with a
           number on it. So Step 2 uses it, down to the same classes.

           Every option stays visible, which is the half the segmented pairs
           got right and the dropdowns got wrong: inside the panel a group
           shows all of its answers at once with the count each would leave,
           so choosing never means opening something to find out what the
           choices are. */

        function twfPick(packed) {
            const i = String(packed).indexOf(':');
            if (i < 0) return;
            const key = packed.slice(0, i), value = packed.slice(i + 1);
            /* The club menu is a value picker and closes on a choice, the way
               every other v2 menu does. The filter panel does not: it holds
               nine groups and you are usually setting several of them, so it
               stays open across the re-render each pick causes. */
            if (key === 'clubs') {
                if (typeof v2MenuCloseAll === 'function') v2MenuCloseAll();
                twfClubPreset(value);
                return;
            }
            twfSetFilter(key, value);
        }

        /* How many filters are away from their default. It goes on the button,
           so a closed panel still says whether anything is narrowing the list —
           without it, a collapsed panel hides the fact that it is doing
           something, which is the one real cost of collapsing it. */
        function twfActiveFilterCount() {
            const s = twfState();
            const d = twfDefaultFilters();
            return ['quality', 'price', 'own', 'setPiece', 'minutes', 'form', 'avail', 'source']
                .filter(k => s[k] !== d[k]).length + (s.defcon ? 1 : 0) + (s.clubs.length ? 1 : 0);
        }

        function twfFilterBarHTML(base, survivors, ctx, pos, gws) {
            const s = twfState();
            const clubSet = new Set(s.clubs);
            const scoped = clubSet.size ? base.filter(p => clubSet.has(p.teamId)) : base;
            const countIf = (over) => {
                const merged = Object.assign({}, s, over);
                return scoped.filter(p => twfPasses(p, merged, ctx)).length;
            };

            /* One group: a label, and every answer as a pill carrying what it
               would leave. The count is the whole reason these are pills rather
               than a <select> — you can compare the cost of four answers without
               taking any of them. */
            const group = (label, key, options, tip) => `
                <div class="apf-group">
                    <span class="v2-menu-label"${tip ? ` data-tooltip="${escHTML(tip)}"` : ''}>${escHTML(label)}</span>
                    <div class="apf-controls">${options.map(o => {
                        /* `cv` is the value this option really holds, where that
                           is not the string the onclick has to carry. Only
                           defcon needs it — it is the one filter kept as a
                           boolean, and comparing `false === 'false'` marked
                           neither of its pills active while counting both of
                           them as ON, because a non-empty string is truthy. */
                        const val = Object.prototype.hasOwnProperty.call(o, 'cv') ? o.cv : o.v;
                        const on = s[key] === val;
                        const n = countIf({ [key]: val });
                        return `<button class="filter-pill compact-pill${on ? ' active' : ''}"
                            onclick="twfPick('${key}:${o.v}')"
                            ${o.tip ? `data-tooltip="${escHTML(o.tip)}"` : ''}>${escHTML(o.l)}<em class="twf-n">${n}</em></button>`;
                    }).join('')}</div>
                </div>`;

            const outPrice = ctx.outPrice;
            const qLabel = twfQualityLabel(pos);
            const active = twfActiveFilterCount();

            const groups = [
                group('Minutes', 'minutes', [
                    { v: 'any', l: 'Any' },
                    { v: 'nailed', l: 'Nailed', tip: 'At least an 80% chance of starting.' }
                ], 'The most common reason a transfer fails.'),
                group('Form', 'form', [
                    { v: 'any', l: 'Any' },
                    { v: 'hot', l: 'Heating up', tip: 'Scoring at least 15% above his season average over his last five.' }
                ], 'The direction over his last five, not the level.'),
                group('Underlying quality', 'quality', [
                    { v: 'any', l: 'Any' },
                    { v: 'top25', l: `Top 25%` },
                    { v: 'top10', l: `Top 10%` }
                ], `Percentile within his own position on ${qLabel}.`),
                group('Price', 'price', [
                    { v: 'any', l: 'Any' },
                    { v: 'cheaper', l: 'Cheaper', tip: `Under \u00a3${outPrice.toFixed(1)}m \u2014 frees money for another slot.` },
                    { v: 'same', l: 'Same money', tip: `Within \u00a30.5m of \u00a3${outPrice.toFixed(1)}m.` },
                    { v: 'upgrade', l: 'Upgrade', tip: `Above \u00a3${outPrice.toFixed(1)}m \u2014 spends into this slot.` }
                ], `Against the \u00a3${outPrice.toFixed(1)}m you get back.`),
                group('Ownership', 'own', [
                    { v: 'any', l: 'Any' },
                    { v: 'template', l: 'Template', tip: 'Over 25% owned.' },
                    { v: 'mid', l: 'Mid', tip: '8\u201325% owned.' },
                    { v: 'diff', l: 'Differential', tip: 'Under 8% owned.' }
                ], 'Where he sits against the template.'),
                group('Set pieces', 'setPiece', [
                    { v: 'any', l: 'Any' },
                    { v: 'sp', l: 'On any' },
                    { v: 'pens', l: 'First-choice pens' }
                ], 'Taken from what FPL publishes, not inferred.'),
                group('Availability', 'avail', [
                    { v: 'fit', l: 'Fit only' },
                    { v: 'all', l: 'Include doubts' }
                ], 'Fitness flags as published by FPL.'),
                group('Shortlist', 'source', [
                    { v: 'all', l: 'All players' },
                    { v: 'favorites', l: 'Favourites', tip: 'The players you starred on the Players Analysis page. Budget and minutes limits are lifted here, so an unaffordable target still shows, marked.' }
                ], 'Everyone, or only the players you starred.'),
                pos === 1 ? '' : group('Defensive contribution', 'defcon', [
                    { v: 'false', cv: false, l: 'Any' },
                    { v: 'true', cv: true, l: 'Clears the threshold' }
                ], 'Tackles, clearances, blocks, interceptions and recoveries. Worth 2 points once a per-match threshold is cleared \u2014 10 for defenders, 12 for midfielders.')
            ].join('');

            const filters = `<div class="v2-menu apf-menu" id="v2menu-twf-filters">
                <button class="apf-menu-btn${active ? ' is-on' : ''}" onclick="v2MenuToggle('twf-filters', event)"
                    aria-expanded="false" aria-haspopup="true"
                    data-tooltip="Minutes, form, quality, price, ownership, set pieces, availability and your shortlist.">
                    ${typeof v2Icon === 'function' ? v2Icon('sliders') : ''}Filters${active ? `<span class="apf-menu-n">${active}</span>` : ''}
                </button>
                <div class="apf-panel" hidden>
                    <!-- The way out, pinned to the top of the panel.

                         It was a link under nine groups, which put it below the
                         fold of a scrolling panel — and the one moment you need
                         it is the moment every group reads 0, because narrowing
                         to nothing is exactly when a reader starts hunting for
                         how to undo it. A dead end whose exit requires scrolling
                         past the thing that caused it is not an exit. -->
                    <div class="twf-panel-head">
                        <span class="twf-panel-h">${survivors.length
                            ? `${survivors.length} player${survivors.length === 1 ? '' : 's'} match`
                            : 'Nothing matches'}</span>
                        ${active ? `<button class="twf-panel-reset" onclick="twfResetFilters()">Clear all</button>` : ''}
                    </div>
                    ${survivors.length ? '' : `<div class="twf-panel-dead">Every count below reads 0 because removing any single filter still leaves nothing \u2014 more than one is doing the cutting.</div>`}
                    ${groups}
                </div>
            </div>`;

            const clubLabel = s.clubs.length
                ? `${s.clubs.length} club${s.clubs.length === 1 ? '' : 's'}`
                : 'All clubs';
            const clubs = `<div class="v2-menu" id="v2menu-twf-clubs">
                <button class="v2-menu-btn${s.clubs.length ? ' is-on' : ''}" onclick="v2MenuToggle('twf-clubs', event)" aria-expanded="false" aria-haspopup="true"
                    data-tooltip="Whose fixtures you want to own over ${escHTML(gws.length ? `GW${gws[0]}\u2013GW${gws[gws.length - 1]}` : 'the gameweeks ahead')}.">
                    ${typeof v2Icon === 'function' ? v2Icon('shield') : ''}Clubs
                    <span class="v2-menu-v">${escHTML(clubLabel)}</span>
                    <span class="v2-menu-caret"></span>
                </button>
                <div class="v2-menu-panel" hidden>
                    <div class="v2-menu-group">
                        <span class="v2-menu-label">Clubs</span>
                        <button class="v2-menu-opt${s.clubs.length ? '' : ' is-on'}" onclick="twfPick('clubs:all')"><span>All clubs</span></button>
                        <button class="v2-menu-opt" onclick="twfPick('clubs:swing')"><span>Improving swings<span class="v2-menu-opt-note">Fixtures get easier partway through</span></span></button>
                        <button class="v2-menu-opt" onclick="twfPick('clubs:attack')"><span>Best attack<span class="v2-menu-opt-note">The eight strongest attacks</span></span></button>
                        <button class="v2-menu-opt" onclick="twfPick('clubs:defence')"><span>Best defence<span class="v2-menu-opt-note">The eight strongest defences</span></span></button>
                    </div>
                </div>
            </div>`;

            /* Named, not counted. "7 clubs selected" is a number you cannot
               check; seven three-letter codes is a claim you can disagree with,
               and each one drops on click. */
            const chosen = s.clubs.length
                ? `<span class="twf-picked">${s.clubs.map(id =>
                    `<button class="twf-picked-club" onclick="twfToggleClub(${id})"
                        data-tooltip="${escHTML(`Drop ${(teams[id] && teams[id].name) || 'this club'} from the selection.`)}">${escHTML((teams[id] && teams[id].short_name) || '?')}<i aria-hidden="true">\u00d7</i></button>`).join('')}</span>`
                : '';

            return `<div class="twf-bar">
                <div class="twf-search-wrap">
                    ${typeof v2Icon === 'function' ? v2Icon('eye') : ''}
                    <input class="twf-search" type="text" placeholder="Search by name\u2026" value="${escHTML(s.search)}" oninput="twfSearch(this.value)">
                </div>
                ${filters}
                ${clubs}
                ${/* The green "N left" pill is gone: the line over the cards
                      already says how many of how many, and two counts in two
                      shapes on one screen is one too many. The Filters button
                      still carries its badge, which answers a different
                      question — how many filters are on, not how many
                      players survived them. */''}
                ${chosen}
            </div>`;
        }

        /* Narrowing and picking used to be two numbered steps with a "Show 13
           players →" button between them, and the counts along the top said
           13 → 13 → 13 whether or not anything had been cut. One screen now:
           the filters are above the players they are filtering, so the effect
           of a chip is the list moving rather than a number changing on a step
           you have to press to leave. */
/* The footer is the reason a list is empty, and nothing else now.
 *
 * It carried a "← Squad" button, which went back to a column that is already
 * on screen beside this one — the squad never left. A control that returns you
 * to something you can see is a control that only takes up room, and the slot
 * dropdown in the header is how you move between transfers. */
        function twfRenderFooter(n, pos) {
            if (n !== 0) return '';
            return `<div class="twf-foot">
                <span class="twf-foot-why">${escHTML(twfEmptyReason(pos))}</span>
            </div>`;
        }


        /* A player's projection over the horizon, broken into the components that
           produced it and the gameweeks it is spread across.

           projectPlayerPointsDetailed() has always returned this breakdown and
           nothing in the app has ever displayed it. Summing it here rather than
           calling projectPlayerPointsForGW() means the per-gameweek strip, the
           component bar and the headline number all come out of one pass — and
           the rounding matches xpOver() exactly, so this card cannot disagree
           with the delta shown anywhere else on the page. */
        function twfProjection(p, gws) {
            const all = teamFixtures6[p.teamId] || [];
            const comp = { appearance: 0, attack: 0, cleanSheet: 0, saves: 0, bonus: 0, defCon: 0, conceded: 0, cards: 0 };
            const perGW = gws.map(gw => {
                const matches = all.filter(f => f.event === gw);
                const immediate = all.length > 0 && all[0].event === gw;
                let sum = 0;
                matches.forEach(f => {
                    const d = projectPlayerPointsDetailed(p, { fixture: f, applyEpFloor: immediate });
                    Object.keys(comp).forEach(k => { comp[k] += d[k] || 0; });
                    sum += d.total;
                });
                return { gw, xp: Math.round(sum * 10) / 10, matches };
            });
            const total = Math.round(perGW.reduce((s, g) => s + g.xp, 0) * 10) / 10;
            return { total, perGW, comp };
        }

        /* The five ways to rank a shortlist. One definition, used by both
           views, so "Value" cannot mean points-per-million on one screen and
           something else on the other. */
        const TWF_SORTS = [
            { v: 'xp', l: 'Best projection', tip: 'Projected points over the horizon above.' },
            { v: 'value', l: 'Value', tip: 'Projected points per £m.' },
            { v: 'form', l: 'Form', tip: 'Points per game over his last five appearances.' },
            { v: 'diff', l: 'Differential', tip: 'Lowest ownership first.' },
            { v: 'minutes', l: 'Safest minutes', tip: 'Highest chance of starting first.' }
        ];

        /* Quick picks' one control, in the same pill as every filter next door
           — it sits on the row Custom search fills with its bar, so the two
           views cannot look like two different screens. */
        function twfSortRowHTML() {
            const s = twfState();
            return `<div class="twf-bar">
                ${v2MenuHTML({
                    key: 'twf-sort', icon: 'sliders', label: 'Sort',
                    value: s.sort, onPick: 'twfSetSort',
                    options: TWF_SORTS.map(o => ({ value: o.v, label: o.l, note: o.tip }))
                })}
            </div>`;
        }

        // Sorts in place and returns the array, so both callers order a list
        // the same way rather than each writing the comparators out again.
        function twfApplySort(scored, sort) {
            const facts = (x) => twfFacts(x.p);
            if (sort === 'value') scored.sort((a, b) => (b.proj.total / b.p.price) - (a.proj.total / a.p.price));
            else if (sort === 'form') scored.sort((a, b) => facts(b).l5ppg - facts(a).l5ppg);
            else if (sort === 'diff') scored.sort((a, b) => a.p.ownership - b.p.ownership);
            else if (sort === 'minutes') scored.sort((a, b) => facts(b).pStart - facts(a).pStart);
            else scored.sort((a, b) => b.proj.total - a.proj.total);
            return scored;
        }

        /* ===== Quick picks =====

           Clicking Swap used to land on the funnel's first step, which asks you
           to choose a fixture run before it will show you a single player. That
           is the right tool when you already have an opinion and the wrong one
           when you just want to know who the obvious replacement is. So this is
           what a swap opens on, and the funnel is one click away for when the
           obvious answer is not good enough.

           No filters are applied and none are offered: the ranking is the whole
           interface. What it does apply are the two things that are constraints
           rather than preferences — what you can afford, and who you are
           actually allowed to buy.

           The sort is applied to a shortlist, not to the whole pool, and that
           is the one thing worth being careful about here. Quick picks filters
           nothing, so ranking every affordable player by lowest ownership would
           answer "who is the most differential" with whoever nobody has heard
           of — a £4.0m third-choice keeper, every time. Taking the strongest
           TWF_QUICK_POOL by projection first and then re-ordering those is what
           a manager means by "the differential one": the most differential of
           the options actually worth having. Best projection is unaffected,
           since ordering a list by the key it was selected on is the same
           list. */
        function twfRenderQuick(slot, base, gws, pos, slotIdx, blocked) {
            const sold = slot.soldPlayer;
            const soldProj = twfProjection(sold, gws);
            const budget = twSlotBudget(slotIdx);

            /* A recommendation you cannot act on is not a quick answer, it is
               another decision. Someone carrying a knock, or a fourth player
               from a club you already have three of, belongs in the funnel
               where the reason can be shown next to him. */
            const s = twfState();
            const eligible = base.filter(p => p.status === 'a' && !blocked.has(p.teamId));
            const scored = eligible.map(p => {
                const proj = twfProjection(p, gws);
                return { p, proj, gain: Math.round((proj.total - soldProj.total) * 10) / 10 };
            }).sort((a, b) => b.proj.total - a.proj.total);

            const shown = twfApplySort(scored.slice(0, TWF_QUICK_POOL), s.sort).slice(0, TWF_QUICK_SHOW);
            const setAside = base.length - eligible.length;

            if (!shown.length) {
                return `<div class="twf-body quick">
                        <div class="twf-empty">${escHTML(twfEmptyReason(pos))}
                            <div><button class="twf-linkbtn" onclick="twfSetView('custom')">Open the custom search</button> to see everyone, with the reason each one is out.</div>
                        </div>
                    </div>
                    `;
            }

            const cards = shown.map((x, i) =>
                twfCardHTML(x, i, sold, soldProj, gws, pos, budget, false)).join('');

            /* The list is ranked by projection, so if the top of it is still
               behind the player being sold then nothing affordable is an
               upgrade — which is the answer to a question this screen is
               otherwise not able to give: whether to make the transfer at all.
               Left unsaid, six red numbers read as a broken market. */
            /* Off the projection ranking rather than off the displayed order:
               "nothing here beats him" is a claim about the best option, and
               under a Differential sort the top card is not it. */
            const bestGain = scored[0].gain;
            const noUpgrade = bestGain <= 0
                ? `<div class="twf-noupgrade">Nothing you can afford projects better than <strong>${escHTML(sold.name)}</strong> over these gameweeks — the closest is ${bestGain === 0 ? 'level with him' : `${Math.abs(bestGain).toFixed(1)} behind`}. This is a transfer worth not making unless you need the money elsewhere.</div>`
                : '';

            /* Never a silent cap: how many of how many you are looking at, and
               over which gameweeks, in the one line Custom search puts in the
               same place. It used to sit under the cards, so the sentence that
               explained the list only arrived after you had finished reading
               it, and the two views said the same thing in two different
               places. What was left out is a tooltip on it rather than a
               second line: it qualifies the count, it is not news of its own. */
            const countLine = shown.length < scored.length
                ? (s.sort === 'xp'
                    ? `Showing the best ${shown.length} of ${scored.length}`
                    : `Showing ${shown.length} of the ${Math.min(TWF_QUICK_POOL, scored.length)} strongest, by ${TWF_SORTS.find(o => o.v === s.sort).l.toLowerCase()}`)
                : `${scored.length} player${scored.length === 1 ? '' : 's'} you can afford`;
            const countTip = `Everyone here is affordable against ${sold.name}.`
                + (setAside > 0
                    ? ` ${setAside} more ${setAside === 1 ? 'is' : 'are'} set aside as injured, doubtful, or a fourth from a club you already have three of.`
                    : '');

            return `<div class="twf-body quick">
                <div class="twf-section-head">
                    <span class="twf-section-sub" data-tooltip="${escHTML(countTip)}">${escHTML(countLine)}<span class="twf-span" data-tooltip="Every projection and every fixture run below is judged over these gameweeks."> \u00b7 ${escHTML(gws.length ? `GW${gws[0]}\u2013GW${gws[gws.length - 1]}` : 'no upcoming gameweeks')}</span></span>
                </div>
                <div class="twf-out" data-tooltip="Every card below is priced against this player over the same gameweeks.">
                    <span class="twf-out-l">Selling</span>
                    <span class="twf-out-name">${escHTML(sold.name)}</span>
                    <span class="twf-out-sub">${escHTML(sold.team)} · £${(sold.sellPrice || sold.price).toFixed(1)}m</span>
                    <span class="twf-out-xp">${soldProj.total.toFixed(1)}<i>xP</i></span>
                </div>
                ${noUpgrade}
                <div class="twf-cards">${cards}</div>
            </div>
            `;
        }

        /* ===== Custom search, on one screen =====

           The filters and the players they filter used to be two numbered steps
           with a "Show 13 players →" button between them. Splitting them meant
           the effect of a chip was a number changing on a step you then had to
           press to leave, which is the slowest possible way to learn that
           "Nailed" cut your list to three.

           Collapsing them into one column was worse, and briefly shipped that
           way: .twf-body is a 640px scroller, so the run presets and eight chip
           groups filled it and the players went below the fold of a scrollbar
           inside the page's own — with the button that used to skip past the
           filters now gone. The filters were in the way and nothing got you
           past them.

           So they are beside each other. Filters on the left, who they leave on
           the right, both on screen from the first pixel, which is what one
           screen was supposed to mean. Below 1100px there is no room for two
           columns, so they stack and the filter column is capped instead — the
           players are never more than a short scroll away.

           No sort control here. It moved to Quick picks, which is where a
           ranked shortlist is the whole answer — this list is ordered by
           projection and narrowed by the chips beside it. */
        function twfRenderCustom(slot, survivors, gws, pos, slotIdx, blocked, ctx) {
            const sold = slot.soldPlayer;
            const soldProj = twfProjection(sold, gws);
            const budget = twSlotBudget(slotIdx);

            const scored = survivors.map(p => {
                const proj = twfProjection(p, gws);
                return { p, proj, gain: Math.round((proj.total - soldProj.total) * 10) / 10 };
            }).sort((a, b) => b.proj.total - a.proj.total);

            /* Eight, in two columns. Forty in one column was a page you
               scrolled rather than a shortlist you compared, and the filters
               above are how you get to the ninth — that is what they are for. */
            const shown = scored.slice(0, TWF_MAX_SHOW);

            const cards = shown.length
                ? shown.map((x, i) => twfCardHTML(x, i, sold, soldProj, gws, pos, budget, blocked.has(x.p.teamId))).join('')
                : `<div class="twf-empty">${escHTML(twfEmptyReason(pos))}
                    <div><button class="twf-linkbtn" onclick="twfResetFilters()">Reset the filters</button> or <button class="twf-linkbtn" onclick="twfSetView('quick')">see the quick picks</button>.</div></div>`;

            // Said once, at the top of the list, rather than twice.
            const trimmed = '';

            return `<div class="twf-body custom">
                <div class="twf-results">
                    ${/* No "Who's left" heading. The cards under it are self-
                          evidently the players that are left, and the line was
                          a title for a list that needs none.

                          What the row does carry is the one thing worth saying:
                          how many of how many you are looking at, and over which
                          gameweeks. That used to be split — "84 players match"
                          up here and "Showing the best 8 of 84" at the very
                          bottom, which is two halves of one sentence a screen
                          apart. One line, top right, and nothing underneath. */''}
                    <div class="twf-section-head">
                        <span class="twf-section-sub">${shown.length < scored.length
                            ? `Showing the best ${shown.length} of ${scored.length}`
                            : `${scored.length} player${scored.length === 1 ? '' : 's'} match${scored.length === 1 ? 'es' : ''}`}<span class="twf-span" data-tooltip="Every projection and every fixture run below is judged over these gameweeks."> \u00b7 ${escHTML(gws.length ? `GW${gws[0]}\u2013GW${gws[gws.length - 1]}` : 'no upcoming gameweeks')}</span></span>
                    </div>
                    <div class="twf-out" data-tooltip="Every card below is priced against this player over the same gameweeks.">
                        <span class="twf-out-l">Selling</span>
                        <span class="twf-out-name">${escHTML(sold.name)}</span>
                        <span class="twf-out-sub">${escHTML(sold.team)} · £${(sold.sellPrice || sold.price).toFixed(1)}m</span>
                        <span class="twf-out-xp">${soldProj.total.toFixed(1)}<i>xP</i></span>
                    </div>
                    <div class="twf-cards">${cards}</div>${trimmed}
                </div>
            </div>
            ${twfRenderFooter(scored.length, pos)}`;
        }

        function twfCardHTML(x, i, sold, soldProj, gws, pos, budget, clubFull) {
            const p = x.p, proj = x.proj, f = twfFacts(p);
            const gain = x.gain;
            const cls = gain > 0.3 ? 'up' : gain < -0.3 ? 'down' : 'flat';
            const unafford = p.price > budget + 0.001;

            /* The stacked colour bar of components is gone. Six segments in
               forty pixels, three of them slivers, and no legend — you could
               see that the projection had parts and not which part was which.
               The numbers behind it are all still here, under "All the
               numbers", where they are labelled. */
            const risk = (proj.comp.conceded || 0) + (proj.comp.cards || 0);

            // Per-gameweek, opponent by opponent. This is the honest version of a
            // difficulty strip: it already contains team quality, opponent
            // quality, venue, blanks and doubles.
            const strip = proj.perGW.map(g => {
                if (!g.matches.length) {
                    return `<span class="twf-gw blank" data-tooltip="GW${g.gw} — blank, no fixture">GW${g.gw}<b>—</b></span>`;
                }
                const labels = g.matches.map(m => `${(m.opponent || '?').slice(0, 3)}${m.isHome ? ' (H)' : ' (A)'}`).join(' + ');
                const fdr = Math.round(g.matches.reduce((s2, m) => s2 + (m.difficulty || 3), 0) / g.matches.length);
                return `<span class="twf-gw fdr-${fdr}" data-tooltip="${escHTML(`GW${g.gw} — ${labels}. Projected ${g.xp.toFixed(1)} points.`)}">GW${g.gw}<b>${g.xp.toFixed(1)}</b></span>`;
            }).join('');

            // Six-round shape. A zero for a benching is signal, so unplayed rounds
            // stay in rather than being filtered out of the picture.
            const peak = Math.max(6, ...f.spark.map(z => z.pts));
            const spark = f.spark.length
                ? f.spark.map(z => `<i class="twf-sp${z.mins === 0 ? ' out' : z.pts >= 8 ? ' haul' : ''}" style="height:${Math.max(8, (z.pts / peak) * 100)}%"
                    data-tooltip="${escHTML(`GW${z.gw}: ${z.pts} point${z.pts === 1 ? '' : 's'}${z.mins === 0 ? ', did not play' : `, ${z.mins} minutes`}`)}"></i>`).join('')
                : '<i class="twf-sp none"></i>';

            const posStats = twfPositionStats(p, f, pos);
            const sp = [
                p.penaltiesOrder === 1 ? '<span class="twf-sp-badge pen" data-tooltip="First-choice penalty taker.">PEN</span>' : '',
                p.penaltiesOrder > 1 ? `<span class="twf-sp-badge" data-tooltip="Number ${p.penaltiesOrder} on penalties.">PEN${p.penaltiesOrder}</span>` : '',
                p.cornersOrder === 1 ? '<span class="twf-sp-badge" data-tooltip="First-choice corner taker.">COR</span>' : '',
                p.freekicksOrder === 1 ? '<span class="twf-sp-badge" data-tooltip="First-choice direct free-kick taker.">FK</span>' : ''
            ].join('');

            const flag = p.status === 'd'
                ? `<span class="twf-flag doubt" data-tooltip="${escHTML(p.news || 'Fitness doubt')}${p.chanceNextRound != null ? escHTML(` — ${p.chanceNextRound}% chance of playing`) : ''}">?</span>`
                : (p.status !== 'a' ? '<span class="twf-flag out" data-tooltip="Unavailable">OUT</span>' : '');

            const run = twfClubRun(p.teamId, pos, gws);
            const swingChip = run.swing
                ? `<span class="twf-swing ${run.swing.direction}" data-tooltip="${escHTML(`Average difficulty ${run.swing.currentFdr} over the next three, then ${run.swing.futureFdr} from GW${run.swing.swingGW}.`)}">${run.swing.direction === 'improving' ? '↑ Eases' : '↓ Hardens'} GW${run.swing.swingGW}</span>` : '';

            const trend = f.formRatio > 1.15 ? '<span class="twf-dir up">▲ heating up</span>'
                : f.formRatio < 0.85 ? '<span class="twf-dir down">▼ cooling</span>'
                : '<span class="twf-dir flat">steady</span>';

            /* The card leads with the player, in his club's colours, the way
               every other card on the site does — same hero as the player
               modal, the pitch and the comparison. The analysis under it is
               unchanged; what it was missing was a face to attach it to. */
            const hero = typeof v2PlayerHeroHTML === 'function'
                ? v2PlayerHeroHTML(p, {
                    size: 'compact',
                    chip: `#${i + 1}`,
                    chipClass: gain > 0.3 ? 'is-up' : gain < -0.3 ? 'is-down' : ''
                })
                : '';

            /* Name, club, price and ownership are on the hero now, so this row
               is only what the hero has no place for: fitness, set pieces, and
               the two reasons a player can be shown but not bought. It renders
               empty more often than not, and collapses when it does. */
            /* Built as a string and tested, not rendered and hidden with
               :empty — the template literal leaves whitespace text nodes
               inside the element, and :empty does not match an element that
               contains whitespace. */
            const topBits = [
                flag,
                sp,
                clubFull ? `<span class="twf-block" data-tooltip="You already hold three players from ${escHTML(p.team)}.">CLUB FULL</span>` : '',
                unafford && !clubFull ? `<span class="twf-block" data-tooltip="£${p.price.toFixed(1)}m is outside the £${budget.toFixed(1)}m this slot has.">OVER BUDGET</span>` : '',
                typeof priceChangeBadge === 'function' ? priceChangeBadge(p) : ''
            ].filter(Boolean).join('');

            const isOpen = twfOpenCards.has(p.id);

            return `<div class="twf-card${unafford || clubFull ? ' unafford' : ''}${isOpen ? ' is-open' : ''}" data-pid="${p.id}" onclick="twPreviewPlayer(${p.id})">
                <div class="twf-hero">${hero}</div>

                <div class="twf-verdict">
                    ${topBits ? `<span class="twf-card-top">${topBits}</span>` : ''}
                    <span class="twf-xp" data-tooltip="${escHTML(`Projected ${proj.total.toFixed(1)} points over GW${gws[0]}–GW${gws[gws.length - 1]}, against ${soldProj.total.toFixed(1)} for ${sold.name}.`)}">${proj.total.toFixed(1)}<i>xP</i></span>
                    <span class="twf-gain ${cls}">${gain > 0 ? '+' : ''}${gain.toFixed(1)}<i>vs ${escHTML(sold.name)}</i></span>
                    ${/* The risk figure used to sit here, unlabelled, beside the
                          gain — two signed numbers side by side, one of them
                          answering a question nobody had asked. For a keeper it
                          is always large and always negative, so on this card it
                          read as the transfer being terrible. It is a component
                          of the projection, so it belongs with the components,
                          labelled. See "Conceded & cards" below. */''}
                </div>

                <div class="twf-strip" data-tooltip="Projected points gameweek by gameweek — team quality, opponent, venue, blanks and doubles are all already in these numbers.">${strip}</div>

                <button class="twf-more" onclick="twfToggleDetail(${p.id}, event)" aria-expanded="${isOpen}"
                    data-tooltip="Form, minutes, hauls, set pieces and the club's own numbers.">
                    <span class="twf-more-l">${isOpen ? 'Less' : 'All the numbers'}</span>
                    <span class="twf-more-c" aria-hidden="true">${v2Icon('down')}</span>
                </button>

                <div class="twf-cols">
                    <div class="twf-col">
                        <div class="twf-col-h">Player form</div>
                        <div class="twf-spark">${spark}</div>
                        <div class="twf-kv"><span>Last 5 / season</span><b>${f.l5ppg.toFixed(1)} / ${f.seasonPpg.toFixed(1)}</b>${trend}</div>
                        <div class="twf-kv" data-tooltip="Chance of starting, and the minutes he averages when he does."><span>Starts</span><b>${Math.round(f.pStart * 100)}%</b><span class="twf-dim">${Math.round(f.expMins)}′</span></div>
                        <div class="twf-kv" data-tooltip="Share of his appearances returning 8 or more points, against the share returning 2 or fewer. Ceiling and floor."><span>Hauls / blanks</span><b>${Math.round(f.haulRate * 100)}%</b><span class="twf-dim">${Math.round(f.blankRate * 100)}%</span></div>
                        <div class="twf-kv"><span>Bonus / game</span><b>${f.bonusPerGame.toFixed(1)}</b></div>
                        ${risk < -0.15 ? `<div class="twf-kv" data-tooltip="Goals conceded and cards, netted off the projection above."><span>Conceded &amp; cards</span><b class="down">${risk.toFixed(1)}</b></div>` : ''}
                        <div class="twf-kv" data-tooltip="Selected by ${p.ownership.toFixed(1)}% of managers${f.netTransfers ? `, ${f.netTransfers > 0 ? 'in' : 'out'} ${Math.abs(f.netTransfers).toLocaleString()} net this gameweek` : ''}."><span>Owned</span><b>${p.ownership.toFixed(1)}%</b>${f.netTransfers ? `<span class="twf-dim ${f.netTransfers > 0 ? 'up' : 'down'}">${f.netTransfers > 0 ? '↑' : '↓'}${Math.abs(f.netTransfers) >= 1000 ? Math.round(Math.abs(f.netTransfers) / 1000) + 'k' : Math.abs(f.netTransfers)}</span>` : ''}</div>
                        ${posStats}
                    </div>
                    <div class="twf-col">
                        <div class="twf-col-h">${escHTML(run.name)}</div>
                        <div class="twf-kv" data-tooltip="Attack and defence power, 0–100, blending goals scored and conceded with FPL's own strength ratings."><span>Attack / defence</span><b>${run.attack}</b><span class="twf-dim">${run.defence}</span></div>
                        <div class="twf-kv" data-tooltip="Recency-weighted form over the last five: W${run.wins} D${run.draws} L${run.losses}."><span>Team form</span><b>${run.form}</b><span class="twf-form5">${(run.last5 || []).slice(-5).map(z => `<i class="twf-r ${z.toLowerCase()}">${z}</i>`).join('')}</span></div>
                        <div class="twf-kv"><span>Goals for / against</span><b>${run.avgGoals.toFixed(1)}</b><span class="twf-dim">${run.avgConceded.toFixed(1)}</span></div>
                        <div class="twf-kv" data-tooltip="Share of matches with a clean sheet, and with no goal scored."><span>Clean sheets / blanks</span><b>${run.csPercent != null ? run.csPercent + '%' : Math.round(run.csRate * 100) + '%'}</b>${run.ftsPercent != null ? `<span class="twf-dim">${run.ftsPercent}%</span>` : ''}</div>
                        ${/* null until the club has played enough for a six-match window to be
      compared against its season. escHTML(null) is an empty string, so
      leaving it unguarded printed a labelled row with nothing in it. */''}
                        <div class="twf-kv" data-tooltip="Team expected goals and expected goals conceded per game, against their own season averages. Needs about ten matches before a six-match window says anything."><span>xG / xGC trend</span>${run.xgTrend || run.xgcTrend
                            ? `<b class="${run.xgTrend === 'rising' ? 'up' : run.xgTrend === 'falling' ? 'down' : ''}">${escHTML(run.xgTrend || '—')}</b><span class="twf-dim ${run.xgcTrend === 'improving' ? 'up' : run.xgcTrend === 'worsening' ? 'down' : ''}">${escHTML(run.xgcTrend || '—')}</span>`
                            : `<b class="twf-dim">not enough games yet</b>`}</div>
                        <div class="twf-kv" data-tooltip="${escHTML(`${run.games} match${run.games === 1 ? '' : 'es'} across ${gws.length} gameweeks, ${run.homes} at home. Average difficulty ${run.avgFdr.toFixed(1)}.`)}"><span>Run</span><b>${run.games} in ${gws.length}</b><span class="twf-dim">${run.homes}H · FDR ${run.avgFdr.toFixed(1)}</span></div>
                        ${swingChip ? `<div class="twf-kv"><span>Swing</span>${swingChip}</div>` : ''}
                    </div>
                </div>
            </div>`;
        }

        // The three rates that actually decide a player in his position, each
        // shown next to where it sits in that position rather than raw.
        function twfPositionStats(p, f, pos) {
            const pct = Math.round(twfQualityPct(p) * 100);
            const rows = [];
            const kv = (label, value, tip) =>
                `<div class="twf-kv" ${tip ? `data-tooltip="${escHTML(tip)}"` : ''}><span>${escHTML(label)}</span><b>${escHTML(value)}</b></div>`;

            if (pos === 1) {
                rows.push(kv('Save %', f.savePct.toFixed(0) + '%', `Saves as a share of shots on target faced. ${pct}th percentile among goalkeepers.`));
                rows.push(kv('Saves / 90', f.saves90.toFixed(1), 'Three saves is one point.'));
                rows.push(kv('xGC / 90', f.xGC90.toFixed(2), 'Expected goals conceded per 90 — the shot quality he faces.'));
                rows.push(kv('Clean sheets', f.csPct.toFixed(0) + '%', 'Share of his starts ending in a clean sheet.'));
            } else if (pos === 2) {
                rows.push(kv('xGC / 90', f.xGC90.toFixed(2), 'Expected goals conceded per 90 while he is on the pitch.'));
                rows.push(kv('Clean sheets', f.csPct.toFixed(0) + '%', 'Share of his starts ending in a clean sheet — four points each.'));
                rows.push(kv('xGI / 90', f.xGI90.toFixed(2), `Expected goal involvements per 90 — where a defender separates from the rest. ${pct}th percentile among defenders.`));
                rows.push(kv('Def. contribution / 90', f.defCon90.toFixed(1), 'Tackles, clearances, blocks, interceptions and recoveries. Ten in a match is worth 2 points.'));
            } else if (pos === 3) {
                rows.push(kv('xGI / 90', f.xGI90.toFixed(2), `Expected goal involvements per 90. ${pct}th percentile among midfielders.`));
                rows.push(kv('xG / 90', f.xG90.toFixed(2), 'Expected goals per 90.'));
                rows.push(kv('xA / 90', f.xA90.toFixed(2), 'Expected assists per 90.'));
                rows.push(kv('Def. contribution / 90', f.defCon90.toFixed(1), 'Twelve in a match is worth 2 points for a midfielder.'));
            } else {
                rows.push(kv('xG / 90', f.xG90.toFixed(2), `Expected goals per 90. ${pct}th percentile among forwards.`));
                rows.push(kv('xGI / 90', f.xGI90.toFixed(2), 'Expected goal involvements per 90.'));
                rows.push(kv('Goals vs xG', `${p.goals} / ${p.xG.toFixed(1)}`,
                    p.goals - p.xG > 1 ? 'Scoring above his expected goals — some of that is finishing, some of it regresses.'
                        : p.goals - p.xG < -1 ? 'Scoring below his expected goals — the chances are there.' : 'Scoring roughly in line with his chances.'));
            }
            return rows.join('');
        }

        /* ===== Actions ===== */

        function twfSetView(view) {
            const s = twfState();
            s.view = view;
            twfViewPrefs.view = view;
            twfRerender();
        }

        function twfToggleClub(teamId) {
            const s = twfState();
            const i = s.clubs.indexOf(teamId);
            if (i >= 0) s.clubs.splice(i, 1); else s.clubs.push(teamId);
            twfRerender();
        }

        function twfClubPreset(kind) {
            const s = twfState();
            const slot = transferState.pending[transferState.activeSlot];
            if (!slot) return;
            const pos = slot.soldPlayer.position;
            const runs = twfAllClubRuns(pos, twfGWs());

            if (kind === 'all') s.clubs = [];
            else if (kind === 'swing') s.clubs = runs.filter(r => r.swing && r.swing.direction === 'improving').map(r => r.teamId);
            else if (kind === 'attack') s.clubs = [...runs].sort((a, b) => b.attack - a.attack).slice(0, 8).map(r => r.teamId);
            else if (kind === 'defence') s.clubs = [...runs].sort((a, b) => b.defence - a.defence).slice(0, 8).map(r => r.teamId);
            twfRerender();
        }

        function twfSetFilter(key, value) {
            const s = twfState();
            /* `defcon` is the one filter held as a boolean, and everything
               reaching this function comes out of an onclick attribute as a
               string. "false" is a non-empty string and therefore truthy, so
               without this the "Any defending" half of its pair turned the
               filter ON. Coerced here rather than at each call site, because
               the call sites are markup. */
            if (key === 'defcon') {
                s.defcon = (value === true || value === 'true');
                twfRerender();
                return;
            }
            // Clicking the active option again clears it, so a filter never
            // becomes a trap you have to hunt for the "Any" button to escape.
            // The segmented pairs name both answers, so there is nothing to
            // escape from and re-picking the chosen half is a no-op for them.
            s[key] = (s[key] === value && value !== 'any' && key !== 'source' && key !== 'avail') ? 'any' : value;
            twfRerender();
        }

        function twfToggleDefcon() {
            const s = twfState();
            s.defcon = !s.defcon;
            twfRerender();
        }

        function twfSetSort(sort) {
            twfState().sort = sort;
            twfViewPrefs.sort = sort;
            twfRerender();
        }

        function twfResetFilters() {
            const s = twfState();
            const keep = { sort: s.sort };
            // In place: the filters may belong to a slot rather than to
            // transferState, and reassigning there would reset the wrong one.
            Object.assign(s, twfDefaultFilters(), keep);
            twfRerender();
        }

        /* Search re-renders the pane, which destroys the input the keystroke came
           from. Debounced so it is not once per character, and the caret is put
           back where it was — the same treatment the old browse tab needed. */
        let _twfSearchTimer = null;
        function twfSearch(value) {
            twfState().search = value;
            clearTimeout(_twfSearchTimer);
            _twfSearchTimer = setTimeout(twfRerender, 220);
        }

        function twfRestoreSearchFocus() {
            const inp = document.querySelector('.twf-search');
            if (!inp || document.activeElement === inp) return;
            inp.focus();
            inp.selectionStart = inp.selectionEnd = inp.value.length;
        }
