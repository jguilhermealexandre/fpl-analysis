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
     twPreviewPlayer, twBackToSquad, renderTWMarketPane
   ============================================ */

        // How many survivors the Pick step renders. The funnel is meant to hand
        // over a shortlist, not a second list to scroll — but the cap is high
        // enough that a manager who filters nothing still gets a usable market.
        const TWF_MAX_SHOW = 40;

        // Horizons offered by the step-1 selector. Five is the default because it
        // is what the recommender in transfer-engine.js already decides on
        // (TW_HORIZON), and a transfer is a five-week commitment in practice.
        const TWF_HORIZONS = [3, 5, 8];

        const TWF_POS_NAMES = ['', 'Goalkeepers', 'Defenders', 'Midfielders', 'Forwards'];
        const TWF_POS_SHORT = ['', 'GK', 'DEF', 'MID', 'FWD'];

        /* Every filter the funnel holds, in one object. One of these lives on
           each pending transfer — see twfState and twfSeedFilters below for
           which slot owns which, and what a new slot starts out as. */
        function twfDefaultFilters() {
            return {
                view: 'quick',      // quick | custom — see twfRenderQuick
                step: 1,
                horizon: 5,
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

        /* Horizon, sort and which of the two views you are in describe how you
           like to work rather than who you are looking for, so they follow you
           between slots while every actual filter starts clean. Someone who
           prefers the funnel should not have to re-open it for every transfer. */
        let twfViewPrefs = { horizon: 5, sort: 'xp', view: 'quick' };

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
           Step and free-text search always reset — a search for one player is
           never the right starting point for another. */
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
                ? Object.assign({}, prev, { step: 1, search: '' })
                : twfDefaultFilters();
            return Object.assign(base, twfViewPrefs);
        }

        // The gameweeks the whole screen is reasoning over. One horizon drives
        // every number in the pane, so the fixture strip, the projection and the
        // delta can never be describing different stretches of the season.
        function twfGWs() {
            return typeof xpPlanGWs === 'function' ? xpPlanGWs(twfState().horizon) : [];
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

        function twfQualityMetric(p) {
            if (p.position === 1) {
                const s = p.saves || 0, gc = p.goalsConceded || 0;
                return (s + gc) > 0 ? s / (s + gc) : 0;
            }
            return p.minutes > 0 ? (p.xGI / p.minutes) * 90 : 0;
        }

        function twfQualityLabel(pos) {
            return pos === 1 ? 'save %' : 'xGI/90';
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
            return lo / vals.length;
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
                xgTrend: ta.xgTrend || 'stable', xgcTrend: ta.xgcTrend || 'stable',
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
            if (s.minutes === 'likely' && f.pStart < 0.6) return false;

            if (s.form === 'hot' && !(f.formRatio > 1.15 && f.played >= 2)) return false;
            if (s.form === 'cold' && !(f.formRatio < 0.85 && f.played >= 2)) return false;

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
           minutes floor, exactly as the old ⭐ tab did: "how does the player I
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

           The ⭐ source is the case worth spelling out: an empty Favourites list
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
                    return 'You have not starred any players yet — use the ⭐ on the Players Analysis page and they show up here.';
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
            if (typeof renderTWMarketPane === 'function') renderTWMarketPane();
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

            /* Quick picks does no filtering, so none of the funnel's counting
               applies — and every survivor costs a projection, which is the
               expensive part of this screen. Branch before paying for it. */
            if (s.view === 'quick') {
                el.innerHTML = '<div class="twf">' +
                    twfRenderHead(slotIdx, sold, gws, base.length, base.length, base.length) +
                    twfRenderQuick(slot, base, gws, pos, slotIdx, blocked) + '</div>';
                if (typeof lucide !== 'undefined') lucide.createIcons();
                return;
            }

            const clubSet = new Set(s.clubs);

            // Player filters first, so a club row can report how many of its
            // players would actually be offered rather than how many it has.
            const afterChips = base.filter(p => twfPasses(p, s, ctx));
            const afterClubs = clubSet.size
                ? base.filter(p => clubSet.has(p.teamId)) : base;
            const survivors = afterClubs.filter(p => twfPasses(p, s, ctx));

            const head = twfRenderHead(slotIdx, sold, gws, base.length, afterClubs.length, survivors.length);

            el.innerHTML = '<div class="twf">' + head +
                (s.step === 2
                    ? twfRenderPick(slot, survivors, gws, pos, slotIdx, blocked)
                    : twfRenderNarrow(base, afterChips, survivors, gws, pos, blocked, ctx)) +
                '</div>';

            if (typeof lucide !== 'undefined') lucide.createIcons();
            if (s.step === 1 && s.search) twfRestoreSearchFocus();
        }

        function twfRenderHead(slotIdx, sold, gws, nBase, nClubs, nFinal) {
            const s = twfState();
            const budget = twSlotBudget(slotIdx);
            const reserved = twReservedFor(slotIdx);
            const span = gws.length ? `GW${gws[0]}–GW${gws[gws.length - 1]}` : 'no upcoming gameweeks';

            const horizons = TWF_HORIZONS.map(h =>
                `<button class="twf-hz${h === s.horizon ? ' active' : ''}" onclick="twfSetHorizon(${h})"
                    data-tooltip="Judge every club and player over the next ${h} gameweeks.">${h} GW</button>`).join('');

            // The count only ever narrows, so showing all three stages makes it
            // obvious which half of the funnel is doing the cutting.
            const counts = `<span class="twf-count">${nBase}</span>
                <span class="twf-count-arrow">→</span>
                <span class="twf-count${nClubs < nBase ? ' cut' : ''}" data-tooltip="After the club filter">${nClubs}</span>
                <span class="twf-count-arrow">→</span>
                <span class="twf-count final${nFinal < nClubs ? ' cut' : ''}" data-tooltip="After the player filters">${nFinal}</span>`;

            /* Two ways to answer the same question, chosen up front rather than
               inferred. The funnel's own steps and counts describe filtering,
               so they only appear once there is filtering to describe. */
            const views = `<div class="twf-views" role="tablist">
                <button class="twf-view${s.view === 'quick' ? ' active' : ''}" role="tab" aria-selected="${s.view === 'quick'}"
                    onclick="twfSetView('quick')"
                    data-tooltip="The best replacements we can find for ${escHTML(sold.name)}, ranked, with nothing to fill in.">⚡ Quick picks</button>
                <button class="twf-view${s.view === 'custom' ? ' active' : ''}" role="tab" aria-selected="${s.view === 'custom'}"
                    onclick="twfSetView('custom')"
                    data-tooltip="Narrow by fixture run, minutes, form, price, ownership and set pieces, then pick from what survives.">🛠️ Custom search</button>
            </div>`;

            return `<div class="twf-head">
                <div class="twf-head-top">
                    <span class="twf-head-title">Replacements for <strong>${escHTML(sold.name)}</strong></span>
                    <span class="twf-budget" ${reserved > 0 ? `data-tooltip="${escHTML(`£${reserved.toFixed(1)}m of the bank is held back so your other open slots can still be filled.`)}"` : ''}>£${budget.toFixed(1)}m${reserved > 0 ? `<em>£${reserved.toFixed(1)}m reserved</em>` : ''}</span>
                </div>
                <div class="twf-head-bot">
                    ${views}
                    ${s.view === 'custom' ? `<div class="twf-steps">
                        <button class="twf-step${s.step === 1 ? ' active' : ''}" onclick="twfSetStep(1)">1 · Narrow</button>
                        <button class="twf-step${s.step === 2 ? ' active' : ''}" onclick="twfSetStep(2)">2 · Pick</button>
                    </div>
                    <div class="twf-counts" data-tooltip="Players in the pool, after the clubs you chose, after the player filters.">${counts}</div>` : ''}
                    <div class="twf-hzs" data-tooltip="Everything on this screen is judged over ${escHTML(span)}.">${horizons}</div>
                </div>
            </div>`;
        }

        /* ===== Step 1 — Narrow ===== */

        function twfRenderNarrow(base, afterChips, survivors, gws, pos, blocked, ctx) {
            const s = twfState();

            // Club rows count the players that would actually be offered, which
            // means counting them after the chips rather than before.
            const byClub = {};
            afterChips.forEach(p => { byClub[p.teamId] = (byClub[p.teamId] || 0) + 1; });

            const runs = twfAllClubRuns(pos, gws);
            const clubRows = runs.map(r => twfClubRowHTML(r, gws, pos, byClub[r.teamId] || 0, blocked.has(r.teamId))).join('');

            const presets = `
                <button class="twf-preset" onclick="twfClubPreset('easy')" data-tooltip="Select the six clubs with the best run over this horizon, for this position.">Easiest 6 runs</button>
                <button class="twf-preset" onclick="twfClubPreset('swing')" data-tooltip="Select every club whose fixtures get easier partway through.">Improving swings</button>
                <button class="twf-preset" onclick="twfClubPreset('attack')" data-tooltip="Select the eight strongest attacks.">Best attack</button>
                <button class="twf-preset" onclick="twfClubPreset('defence')" data-tooltip="Select the eight strongest defences.">Best defence</button>
                <button class="twf-preset${s.clubs.length ? '' : ' active'}" onclick="twfClubPreset('all')">All clubs</button>`;

            return `<div class="twf-body">
                <div class="twf-section">
                    <div class="twf-section-head">
                        <span class="twf-section-title">The run — whose fixtures do you want to own?</span>
                        <span class="twf-section-sub">${s.clubs.length ? `${s.clubs.length} club${s.clubs.length === 1 ? '' : 's'} selected` : 'every club'}</span>
                    </div>
                    <div class="twf-presets">${presets}</div>
                    <div class="twf-clubs">${clubRows}</div>
                </div>
                ${twfRenderChips(base, survivors, ctx, pos)}
            </div>
            ${twfRenderFooter(survivors.length, pos)}`;
        }

        function twfClubRowHTML(r, gws, pos, count, isBlocked) {
            const s = twfState();
            const on = s.clubs.includes(r.teamId);

            const strip = r.perGW.map(g => {
                if (!g.fixtures.length) {
                    return `<span class="twf-fx blank" data-tooltip="GW${g.gw} — no fixture (blank gameweek)">—</span>`;
                }
                return g.fixtures.map(f => `<span class="twf-fx fdr-${f.difficulty || 3}${g.fixtures.length > 1 ? ' dbl' : ''}"
                    data-tooltip="GW${g.gw} — ${f.isHome ? 'home to' : 'away at'} ${escHTML(f.opponent || '?')}, difficulty ${f.difficulty || 3}">${escHTML((f.opponent || '?').slice(0, 3))}<i>${f.isHome ? 'H' : 'A'}</i></span>`).join('');
            }).join('');

            const swing = r.swing
                ? `<span class="twf-swing ${r.swing.direction}" data-tooltip="${escHTML(`Average difficulty ${r.swing.currentFdr} over the next three, then ${r.swing.futureFdr} from GW${r.swing.swingGW}.`)}">${r.swing.direction === 'improving' ? '↑' : '↓'} ${r.swing.direction === 'improving' ? 'Eases' : 'Hardens'} GW${r.swing.swingGW}</span>`
                : '';

            // Position decides which power rating leads: a defender is bought for
            // his club's defence, a forward for its attack.
            const leadLabel = pos <= 2 ? 'Def' : 'Att';
            const leadVal = pos <= 2 ? r.defence : r.attack;
            const otherLabel = pos <= 2 ? 'Att' : 'Def';
            const otherVal = pos <= 2 ? r.attack : r.defence;

            const trend = (kind) => {
                const t = kind === 'xg' ? r.xgTrend : r.xgcTrend;
                const d = kind === 'xg' ? r.xgDelta : r.xgcDelta;
                if (t === 'stable') return '';
                const good = t === 'rising' || t === 'improving';
                return `<span class="twf-trend ${good ? 'up' : 'down'}" data-tooltip="${escHTML(kind === 'xg'
                    ? `Team xG per game is ${t} — ${d >= 0 ? '+' : ''}${d.toFixed(2)} against its season average.`
                    : `Team xG conceded per game is ${t} — ${d >= 0 ? '+' : ''}${d.toFixed(2)} against its season average.`)}">${kind === 'xg' ? 'xG' : 'xGC'} ${good ? '▲' : '▼'}</span>`;
            };

            const formLetters = (r.last5 || []).slice(-5)
                .map(x => `<i class="twf-r ${x.toLowerCase()}">${x}</i>`).join('');

            const runTip = `${r.name} — ${r.games} match${r.games === 1 ? '' : 'es'} in ${gws.length} gameweeks, ${r.homes} at home` +
                (r.blanks ? `, ${r.blanks} blank${r.blanks === 1 ? '' : 's'}` : '') +
                (r.doubles ? `, ${r.doubles} double${r.doubles === 1 ? '' : 's'}` : '') +
                `. Average difficulty ${r.avgFdr.toFixed(1)}.`;

            return `<div class="twf-club${on ? ' on' : ''}${isBlocked ? ' blocked' : ''}${count ? '' : ' empty'}" onclick="twfToggleClub(${r.teamId})"
                data-tooltip="${escHTML(isBlocked ? `You already hold three players from ${r.name} — sell one before buying a fourth.` : runTip)}">
                <span class="twf-club-check">${on ? '✓' : ''}</span>
                <span class="twf-club-name">${escHTML(r.short)}</span>
                <span class="twf-club-run" data-tooltip="${escHTML(`Run quality ${Math.round(r.runScore)}/100 — opponent strength for a ${TWF_POS_SHORT[pos].toLowerCase()}, venue included, averaged over the ${gws.length} gameweeks. Blanks count as zero, doubles count twice.`)}">
                    <span class="twf-bar"><i style="width:${Math.max(2, Math.min(100, r.runScore))}%"></i></span>
                    <b>${Math.round(r.runScore)}</b>
                </span>
                <span class="twf-fxs">${strip}</span>
                ${swing}
                <span class="twf-club-stats">
                    <span class="twf-ms" data-tooltip="${escHTML(`${leadLabel === 'Def' ? 'Defence' : 'Attack'} power ${leadVal}/100 — ${r.avgGoals.toFixed(1)} scored and ${r.avgConceded.toFixed(1)} conceded per game, clean sheet in ${Math.round(r.csRate * 100)}%.`)}">${leadLabel} <b>${leadVal}</b></span>
                    <span class="twf-ms dim" data-tooltip="${escHTML(`${otherLabel === 'Def' ? 'Defence' : 'Attack'} power ${otherVal}/100.`)}">${otherLabel} <b>${otherVal}</b></span>
                    <span class="twf-ms" data-tooltip="${escHTML(`Team form ${r.form}/100 — W${r.wins} D${r.draws} L${r.losses} in the last five.`)}">Form <b>${r.form}</b></span>
                    ${formLetters ? `<span class="twf-form5">${formLetters}</span>` : ''}
                    ${trend('xg')}${trend('xgc')}
                </span>
                <span class="twf-club-n" data-tooltip="Players from this club who pass your player filters.">${count}</span>
            </div>`;
        }

        /* The player half of step 1. Every chip carries the number that would
           survive if it were the one active in its group, so narrowing is never
           a guess that ends in an empty list. */
        function twfRenderChips(base, survivors, ctx, pos) {
            const s = twfState();
            const clubSet = new Set(s.clubs);
            const scoped = clubSet.size ? base.filter(p => clubSet.has(p.teamId)) : base;
            const countIf = (over) => {
                const merged = Object.assign({}, s, over);
                return scoped.filter(p => twfPasses(p, merged, ctx)).length;
            };

            const group = (title, tip, key, options) => `
                <div class="twf-group">
                    <span class="twf-group-l" ${tip ? `data-tooltip="${escHTML(tip)}"` : ''}>${escHTML(title)}</span>
                    <div class="twf-chips">${options.map(o => {
                        const n = countIf({ [key]: o.v });
                        const active = s[key] === o.v;
                        return `<button class="twf-chip${active ? ' active' : ''}${n === 0 && !active ? ' dead' : ''}"
                            onclick="twfSetFilter('${key}','${o.v}')"
                            ${o.tip ? `data-tooltip="${escHTML(o.tip)}"` : ''}>${escHTML(o.l)}<em>${n}</em></button>`;
                    }).join('')}</div>
                </div>`;

            const outPrice = ctx.outPrice;
            const defconN = countIf({ defcon: !s.defcon });
            const qLabel = twfQualityLabel(pos);

            return `<div class="twf-section">
                <div class="twf-section-head">
                    <span class="twf-section-title">The player — what kind, inside those clubs?</span>
                    <button class="twf-reset" onclick="twfResetFilters()">Reset filters</button>
                </div>

                <div class="twf-searchrow">
                    <input class="twf-search" type="text" placeholder="Search by name…" value="${escHTML(s.search)}" oninput="twfSearch(this.value)">
                    <div class="twf-chips">
                        <button class="twf-chip${s.source === 'all' ? ' active' : ''}" onclick="twfSetFilter('source','all')">All players</button>
                        <button class="twf-chip${s.source === 'favorites' ? ' active' : ''}" onclick="twfSetFilter('source','favorites')"
                            data-tooltip="Only the players you starred on the Players Analysis page. Budget and minutes limits are lifted here so an unaffordable target still shows, marked.">⭐ Favourites</button>
                    </div>
                </div>

                ${group('Minutes', 'How likely he is to start, from his own starts rate and minutes per appearance. The most common reason a transfer fails.', 'minutes', [
                    { v: 'any', l: 'Any' },
                    { v: 'likely', l: 'Likely (60%+)', tip: 'At least a 60% chance of starting.' },
                    { v: 'nailed', l: 'Nailed (80%+)', tip: 'At least an 80% chance of starting.' }
                ])}

                ${group('Form direction', 'Last five appearances against his season average — the direction, not the level.', 'form', [
                    { v: 'any', l: 'Any' },
                    { v: 'hot', l: 'Heating up', tip: 'Scoring at least 15% above his season average over his last five.' },
                    { v: 'cold', l: 'Cooling', tip: 'Scoring at least 15% below his season average — a buy-low candidate if the underlying numbers hold.' }
                ])}

                ${group('Underlying quality', `Percentile within his own position on ${qLabel}. A rate means nothing without knowing what is good for the position.`, 'quality', [
                    { v: 'any', l: 'Any' },
                    { v: 'top25', l: `Top 25% ${qLabel}` },
                    { v: 'top10', l: `Top 10% ${qLabel}` }
                ])}

                ${group('Price', `Measured against the £${outPrice.toFixed(1)}m you get back for ${TWF_POS_SHORT[pos].toLowerCase()} you are selling — the question is the direction of the move, not an absolute band.`, 'price', [
                    { v: 'any', l: 'Any' },
                    { v: 'cheaper', l: 'Cheaper', tip: `Under £${outPrice.toFixed(1)}m — frees money for another slot.` },
                    { v: 'same', l: 'Same money', tip: `Within £0.5m of £${outPrice.toFixed(1)}m.` },
                    { v: 'upgrade', l: 'Upgrade', tip: `Above £${outPrice.toFixed(1)}m — spends into this slot.` }
                ])}

                ${group('Ownership', 'Where he sits against the template, and which way the market is moving.', 'own', [
                    { v: 'any', l: 'Any' },
                    { v: 'template', l: 'Template (>25%)' },
                    { v: 'mid', l: 'Mid (8–25%)' },
                    { v: 'diff', l: 'Differential (<8%)' }
                ])}

                ${group('Set pieces', 'Taken from what FPL publishes, not inferred from a goals-minus-xG gap.', 'setPiece', [
                    { v: 'any', l: 'Any' },
                    { v: 'sp', l: 'On any set piece' },
                    { v: 'pens', l: 'First-choice pens' }
                ])}

                ${group('Availability', 'Fitness flags as published by FPL.', 'avail', [
                    { v: 'fit', l: 'Fit only' },
                    { v: 'all', l: 'Include doubts' }
                ])}

                <div class="twf-group">
                    <span class="twf-group-l" data-tooltip="Tackles, clearances, blocks, interceptions and recoveries, totalled by FPL. Worth 2 points once a per-match threshold is cleared — 10 for defenders, 12 for midfielders.">Defensive contribution</span>
                    <div class="twf-chips">
                        <button class="twf-chip${s.defcon ? ' active' : ''}${defconN === 0 && !s.defcon ? ' dead' : ''}" onclick="twfToggleDefcon()"
                            ${pos === 1 ? 'disabled data-tooltip="Goalkeepers cannot score defensive contribution points."' : ''}>Clears the threshold<em>${defconN}</em></button>
                    </div>
                </div>
            </div>`;
        }

        function twfRenderFooter(n, pos) {
            return `<div class="twf-foot">
                <button class="twf-back" onclick="twBackToSquad()">← Squad</button>
                ${n === 0 ? `<span class="twf-foot-why">${escHTML(twfEmptyReason(pos))}</span>` : ''}
                <button class="twf-go" ${n === 0 ? 'disabled' : ''} onclick="twfSetStep(2)">
                    ${n === 0 ? 'Nothing matches' : `Show ${n} player${n === 1 ? '' : 's'} →`}
                </button>
            </div>`;
        }

        /* ===== Step 2 — Pick ===== */

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
           actually allowed to buy. */
        function twfRenderQuick(slot, base, gws, pos, slotIdx, blocked) {
            const sold = slot.soldPlayer;
            const soldProj = twfProjection(sold, gws);
            const budget = twSlotBudget(slotIdx);

            /* A recommendation you cannot act on is not a quick answer, it is
               another decision. Someone carrying a knock, or a fourth player
               from a club you already have three of, belongs in the funnel
               where the reason can be shown next to him. */
            const eligible = base.filter(p => p.status === 'a' && !blocked.has(p.teamId));
            const scored = eligible.map(p => {
                const proj = twfProjection(p, gws);
                return { p, proj, gain: Math.round((proj.total - soldProj.total) * 10) / 10 };
            }).sort((a, b) => b.proj.total - a.proj.total);

            const shown = scored.slice(0, TWF_QUICK_SHOW);
            const setAside = base.length - eligible.length;

            if (!shown.length) {
                return `<div class="twf-body quick">
                        <div class="twf-empty">${escHTML(twfEmptyReason(pos))}
                            <div><button class="twf-linkbtn" onclick="twfSetView('custom')">Open the custom search</button> to see everyone, with the reason each one is out.</div>
                        </div>
                    </div>
                    <div class="twf-foot"><button class="twf-back" onclick="twBackToSquad()">Squad</button></div>`;
            }

            const cards = shown.map((x, i) =>
                twfCardHTML(x, i, sold, soldProj, gws, pos, budget, false)).join('');

            /* The list is ranked by projection, so if the top of it is still
               behind the player being sold then nothing affordable is an
               upgrade — which is the answer to a question this screen is
               otherwise not able to give: whether to make the transfer at all.
               Left unsaid, six red numbers read as a broken market. */
            const bestGain = shown[0].gain;
            const noUpgrade = bestGain <= 0
                ? `<div class="twf-noupgrade">Nothing you can afford projects better than <strong>${escHTML(sold.name)}</strong> over these gameweeks — the closest is ${bestGain === 0 ? 'level with him' : `${Math.abs(bestGain).toFixed(1)} behind`}. This is a transfer worth not making unless you need the money elsewhere.</div>`
                : '';

            // Never a silent cap: say what was left out and why, so the list
            // does not read as "these are the only players who exist".
            const notes = [];
            if (scored.length > shown.length) {
                notes.push(`Showing the ${shown.length} best of ${scored.length} you can afford.`);
            }
            if (setAside > 0) {
                notes.push(`${setAside} ${setAside === 1 ? 'player is' : 'players are'} set aside as injured, doubtful, or a fourth from a club you already have three of.`);
            }

            return `<div class="twf-body quick">
                <div class="twf-out" data-tooltip="Every card below is priced against this player over the same gameweeks.">
                    <span class="twf-out-l">Selling</span>
                    <span class="twf-out-name">${escHTML(sold.name)}</span>
                    <span class="twf-out-sub">${escHTML(sold.team)} · £${(sold.sellPrice || sold.price).toFixed(1)}m</span>
                    <span class="twf-out-xp">${soldProj.total.toFixed(1)}<i>xP</i></span>
                </div>
                ${noUpgrade}
                ${cards}
                ${notes.length ? `<div class="twf-trimmed">${notes.map(n => escHTML(n)).join(' ')}
                    <button class="twf-linkbtn" onclick="twfSetView('custom')">Search properly</button></div>` : ''}
            </div>
            <div class="twf-foot">
                <button class="twf-back" onclick="twfSetView('custom')">🛠️ Custom search</button>
                <button class="twf-back" onclick="twBackToSquad()">Squad</button>
            </div>`;
        }

        function twfRenderPick(slot, survivors, gws, pos, slotIdx, blocked) {
            const s = twfState();
            const sold = slot.soldPlayer;
            const soldProj = twfProjection(sold, gws);
            const budget = twSlotBudget(slotIdx);

            const scored = survivors.map(p => {
                const proj = twfProjection(p, gws);
                return { p, proj, gain: Math.round((proj.total - soldProj.total) * 10) / 10 };
            });

            const facts = (x) => twfFacts(x.p);
            if (s.sort === 'value') scored.sort((a, b) => (b.proj.total / b.p.price) - (a.proj.total / a.p.price));
            else if (s.sort === 'form') scored.sort((a, b) => facts(b).l5ppg - facts(a).l5ppg);
            else if (s.sort === 'diff') scored.sort((a, b) => a.p.ownership - b.p.ownership);
            else if (s.sort === 'minutes') scored.sort((a, b) => facts(b).pStart - facts(a).pStart);
            else scored.sort((a, b) => b.proj.total - a.proj.total);

            const shown = scored.slice(0, TWF_MAX_SHOW);
            const sorts = [
                { v: 'xp', l: 'Best projection', tip: `Projected points over GW${gws[0]}–GW${gws[gws.length - 1]}.` },
                { v: 'value', l: 'Value', tip: 'Projected points per £m.' },
                { v: 'form', l: 'Form', tip: 'Points per game over his last five appearances.' },
                { v: 'diff', l: 'Differential', tip: 'Lowest ownership first.' },
                { v: 'minutes', l: 'Safest minutes', tip: 'Highest chance of starting first.' }
            ].map(o => `<button class="twf-chip${s.sort === o.v ? ' active' : ''}" onclick="twfSetSort('${o.v}')" data-tooltip="${escHTML(o.tip)}">${escHTML(o.l)}</button>`).join('');

            const cards = shown.length
                ? shown.map((x, i) => twfCardHTML(x, i, sold, soldProj, gws, pos, budget, blocked.has(x.p.teamId))).join('')
                : `<div class="twf-empty">${escHTML(twfEmptyReason(pos))}
                    <div><button class="twf-linkbtn" onclick="twfSetStep(1)">Loosen the filters</button> or <button class="twf-linkbtn" onclick="twfResetFilters()">start over</button>.</div></div>`;

            const trimmed = scored.length > shown.length
                ? `<div class="twf-trimmed">Showing the top ${shown.length} of ${scored.length}. Narrow further to see the rest.</div>` : '';

            return `<div class="twf-body pick">
                <div class="twf-sortrow">
                    <span class="twf-group-l">Sort</span>
                    <div class="twf-chips">${sorts}</div>
                </div>
                <div class="twf-out" data-tooltip="Every card below is priced against this player over the same gameweeks.">
                    <span class="twf-out-l">Selling</span>
                    <span class="twf-out-name">${escHTML(sold.name)}</span>
                    <span class="twf-out-sub">${escHTML(sold.team)} · £${(sold.sellPrice || sold.price).toFixed(1)}m</span>
                    <span class="twf-out-xp">${soldProj.total.toFixed(1)}<i>xP</i></span>
                </div>
                ${cards}${trimmed}
            </div>
            <div class="twf-foot">
                <button class="twf-back" onclick="twfSetStep(1)">← Filters</button>
                <button class="twf-back" onclick="twBackToSquad()">Squad</button>
            </div>`;
        }

        function twfCardHTML(x, i, sold, soldProj, gws, pos, budget, clubFull) {
            const p = x.p, proj = x.proj, f = twfFacts(p);
            const gain = x.gain;
            const cls = gain > 0.3 ? 'up' : gain < -0.3 ? 'down' : 'flat';
            const unafford = p.price > budget + 0.001;

            // Where the points come from. Negative components are risk, not a
            // share of anything, so they get their own line rather than a slice.
            const parts = [
                { k: 'attack', l: 'Attack', c: 'a' },
                { k: 'cleanSheet', l: 'Clean sheets', c: 'c' },
                { k: 'saves', l: 'Saves', c: 's' },
                { k: 'defCon', l: 'Defensive contribution', c: 'd' },
                { k: 'bonus', l: 'Bonus', c: 'b' },
                { k: 'appearance', l: 'Appearances', c: 'p' }
            ].filter(z => (proj.comp[z.k] || 0) > 0.05);
            const positive = parts.reduce((s2, z) => s2 + proj.comp[z.k], 0) || 1;
            const bar = parts.map(z => {
                const pct = (proj.comp[z.k] / positive) * 100;
                return `<i class="twf-seg ${z.c}" style="width:${pct.toFixed(1)}%"
                    data-tooltip="${escHTML(`${z.l} — ${proj.comp[z.k].toFixed(1)} of the ${proj.total.toFixed(1)} projected points, ${Math.round(pct)}%.`)}"></i>`;
            }).join('');
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

            return `<div class="twf-card${unafford || clubFull ? ' unafford' : ''}" onclick="twPreviewPlayer(${p.id})">
                <div class="twf-card-top">
                    <span class="twf-rank">${i + 1}</span>
                    <span class="twf-name">${escHTML(p.name)}</span>${flag}
                    <span class="twf-team">${escHTML(p.team)}</span>
                    ${sp}
                    ${clubFull ? `<span class="twf-block" data-tooltip="You already hold three players from ${escHTML(p.team)}.">CLUB FULL</span>` : ''}
                    ${unafford && !clubFull ? `<span class="twf-block" data-tooltip="£${p.price.toFixed(1)}m is outside the £${budget.toFixed(1)}m this slot has.">OVER BUDGET</span>` : ''}
                    <span class="twf-price">£${p.price.toFixed(1)}m ${typeof priceChangeBadge === 'function' ? priceChangeBadge(p) : ''}</span>
                </div>

                <div class="twf-verdict">
                    <span class="twf-xp" data-tooltip="${escHTML(`Projected ${proj.total.toFixed(1)} points over GW${gws[0]}–GW${gws[gws.length - 1]}, against ${soldProj.total.toFixed(1)} for ${sold.name}.`)}">${proj.total.toFixed(1)}<i>xP</i></span>
                    <span class="twf-gain ${cls}">${gain > 0 ? '+' : ''}${gain.toFixed(1)}<i>vs ${escHTML(sold.name)}</i></span>
                    <span class="twf-bar-wrap" data-tooltip="Where the projection comes from.">${bar}</span>
                    ${risk < -0.15 ? `<span class="twf-risk" data-tooltip="Goals conceded and cards, netted off the projection.">${risk.toFixed(1)}</span>` : ''}
                </div>

                <div class="twf-strip" data-tooltip="Projected points gameweek by gameweek — team quality, opponent, venue, blanks and doubles are all already in these numbers.">${strip}</div>

                <div class="twf-cols">
                    <div class="twf-col">
                        <div class="twf-col-h">Player form</div>
                        <div class="twf-spark">${spark}</div>
                        <div class="twf-kv"><span>Last 5 / season</span><b>${f.l5ppg.toFixed(1)} / ${f.seasonPpg.toFixed(1)}</b>${trend}</div>
                        <div class="twf-kv" data-tooltip="Chance of starting, and the minutes he averages when he does."><span>Starts</span><b>${Math.round(f.pStart * 100)}%</b><span class="twf-dim">${Math.round(f.expMins)}′</span></div>
                        <div class="twf-kv" data-tooltip="Share of his appearances returning 8 or more points, against the share returning 2 or fewer. Ceiling and floor."><span>Hauls / blanks</span><b>${Math.round(f.haulRate * 100)}%</b><span class="twf-dim">${Math.round(f.blankRate * 100)}%</span></div>
                        <div class="twf-kv"><span>Bonus / game</span><b>${f.bonusPerGame.toFixed(1)}</b></div>
                        <div class="twf-kv" data-tooltip="Selected by ${p.ownership.toFixed(1)}% of managers${f.netTransfers ? `, ${f.netTransfers > 0 ? 'in' : 'out'} ${Math.abs(f.netTransfers).toLocaleString()} net this gameweek` : ''}."><span>Owned</span><b>${p.ownership.toFixed(1)}%</b>${f.netTransfers ? `<span class="twf-dim ${f.netTransfers > 0 ? 'up' : 'down'}">${f.netTransfers > 0 ? '↑' : '↓'}${Math.abs(f.netTransfers) >= 1000 ? Math.round(Math.abs(f.netTransfers) / 1000) + 'k' : Math.abs(f.netTransfers)}</span>` : ''}</div>
                        ${posStats}
                    </div>
                    <div class="twf-col">
                        <div class="twf-col-h">${escHTML(run.name)}</div>
                        <div class="twf-kv" data-tooltip="Attack and defence power, 0–100, blending goals scored and conceded with FPL's own strength ratings."><span>Attack / defence</span><b>${run.attack}</b><span class="twf-dim">${run.defence}</span></div>
                        <div class="twf-kv" data-tooltip="Recency-weighted form over the last five: W${run.wins} D${run.draws} L${run.losses}."><span>Team form</span><b>${run.form}</b><span class="twf-form5">${(run.last5 || []).slice(-5).map(z => `<i class="twf-r ${z.toLowerCase()}">${z}</i>`).join('')}</span></div>
                        <div class="twf-kv"><span>Goals for / against</span><b>${run.avgGoals.toFixed(1)}</b><span class="twf-dim">${run.avgConceded.toFixed(1)}</span></div>
                        <div class="twf-kv" data-tooltip="Share of matches with a clean sheet, and with no goal scored."><span>Clean sheets / blanks</span><b>${run.csPercent != null ? run.csPercent + '%' : Math.round(run.csRate * 100) + '%'}</b>${run.ftsPercent != null ? `<span class="twf-dim">${run.ftsPercent}%</span>` : ''}</div>
                        <div class="twf-kv" data-tooltip="Team expected goals and expected goals conceded per game, against their own season averages."><span>xG / xGC trend</span><b class="${run.xgTrend === 'rising' ? 'up' : run.xgTrend === 'falling' ? 'down' : ''}">${escHTML(run.xgTrend)}</b><span class="twf-dim ${run.xgcTrend === 'improving' ? 'up' : run.xgcTrend === 'worsening' ? 'down' : ''}">${escHTML(run.xgcTrend)}</span></div>
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

        function twfSetStep(n) {
            twfState().step = n;
            twfRerender();
        }

        /* Switching view lands you on the funnel's first step rather than
           wherever you last left it, so "Custom search" always opens on the
           filters it is offering to run. */
        function twfSetView(view) {
            const s = twfState();
            s.view = view;
            if (view === 'custom' && s.step !== 2) s.step = 1;
            twfViewPrefs.view = view;
            twfRerender();
        }

        function twfSetHorizon(h) {
            twfState().horizon = h;
            twfViewPrefs.horizon = h;
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
            else if (kind === 'easy') s.clubs = runs.slice(0, 6).map(r => r.teamId);
            else if (kind === 'swing') s.clubs = runs.filter(r => r.swing && r.swing.direction === 'improving').map(r => r.teamId);
            else if (kind === 'attack') s.clubs = [...runs].sort((a, b) => b.attack - a.attack).slice(0, 8).map(r => r.teamId);
            else if (kind === 'defence') s.clubs = [...runs].sort((a, b) => b.defence - a.defence).slice(0, 8).map(r => r.teamId);
            twfRerender();
        }

        function twfSetFilter(key, value) {
            const s = twfState();
            // Clicking the active option again clears it, so a filter never
            // becomes a trap you have to hunt for the "Any" button to escape.
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
            const keep = { step: s.step, horizon: s.horizon, sort: s.sort };
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
