/* ============================================
   EasyFPL — why a recommended transfer is recommended

   The recommender has always been able to justify itself and has never been
   asked to. twBuildRecommendation() returns a move with its projected gain and
   one sentence from twMoveReason(); everything a manager would want in order to
   disagree with it — how the edge is spread across the horizon, whose fixtures
   are turning, what it does to the bank, whether the incoming player is even
   nailed — is already computed elsewhere on the page and simply never reaches
   the card.

   So this file adds no model. It is a reporting layer over numbers that already
   exist:

     xP over 3/5/8 GWs   xpOver + xpPlanGWs        (xp-engine.js)
     fixture strips      teamFixtures6             (xp-engine.js)
     fixture swing       fixtureSwingData          (team-analysis-core.js)
     price pressure      priceProgress/Projection  (bootstrap, via price-watch)
     minutes security    expectedMinutesModel      (xp-engine.js)
     ownership           player.ownership          (bootstrap)

   The shape thresholds (0.4 and 1.6 on rate8/rate3) are measured rather than
   picked. Over 148 improving moves generated from a real squad and the full
   candidate pool at GW4:

     below 0      26%   gains at three gameweeks and is behind by eight
     0 – 0.4      14%   the edge is nearly all in the near fixtures
     0.4 – 1.6    54%   holds its rate
     above 1.6     6%   genuinely accelerating

   So the labels discriminate: about forty per cent of improving moves are
   fixture plays and six per cent are real upgrades. Note the individual-player
   baseline is 0.89, not 1.0 — every player's projected rate decays a little
   over a longer horizon, because distant fixtures carry more uncertainty. That
   is why the bands are centred where they are and not on 1.0.

   The horizons are 3, 5 and 8 because they answer three different questions and
   frequently disagree: 3 is "does this help now", 5 is the horizon the
   recommender actually decides on (TW_HORIZON), and 8 is "am I buying a player
   or renting a fixture run". A move that is strong at 3 and flat at 8 is a
   fixture play; the reverse is an upgrade. Showing only the middle number hides
   which of the two you are being sold.

   Prefix tr*. Classic script, no DOM work until a render is asked for.

   DEPENDENCIES, all optional-guarded: xpOver, xpPlanGWs, expectedMinutesModel,
   teamFixtures6 (xp-engine.js); fixtureSwingData (team-analysis-core.js);
   escHTML (common.js).
   ============================================ */

        // Three questions, not one. See the header for why these three.
        const TR_HORIZONS = [3, 5, 8];

        function trXPOver(player, n) {
            if (typeof xpOver !== 'function' || typeof xpPlanGWs !== 'function') return null;
            const gws = xpPlanGWs(n);
            if (!gws || !gws.length) return null;
            return { gws, xp: xpOver(player, gws) };
        }

        /* The next few fixtures for a team, as difficulty numbers.
           Blanks are kept as nulls rather than dropped: "no fixture" is the most
           important thing a strip can say and averaging it away is how a blank
           gameweek gets sold as an easy one. */
        function trFixtures(teamId, n) {
            const all = (typeof teamFixtures6 !== 'undefined' && teamFixtures6[teamId]) || [];
            const gws = typeof xpPlanGWs === 'function' ? xpPlanGWs(n) : [];
            return gws.map(gw => {
                const matches = all.filter(f => f.event === gw);
                if (!matches.length) return { gw, difficulty: null, opponent: null, isHome: null, blank: true };
                const m = matches[0];
                return {
                    gw, difficulty: m.difficulty || 3, opponent: m.opponent, isHome: m.isHome,
                    blank: false, double: matches.length > 1
                };
            });
        }

        function trAvgFdr(strip) {
            const played = strip.filter(f => !f.blank);
            if (!played.length) return null;
            return played.reduce((s, f) => s + f.difficulty, 0) / played.length;
        }

        // Minutes security, in the terms a manager uses rather than a probability.
        function trMinutes(player) {
            const m = typeof expectedMinutesModel === 'function' ? expectedMinutesModel(player) : null;
            const pStart = m ? m.pStart : null;
            let label = 'unknown';
            if (pStart != null) {
                label = pStart >= 0.8 ? 'nailed' : pStart >= 0.6 ? 'likely' : 'rotation risk';
            }
            return {
                pStart, label,
                expMins: m ? Math.round(m.expMins) : null,
                status: player.status,
                news: player.news || '',
                // A fitness flag outranks any minutes model: the model is reading
                // history, the flag is the club saying something about Saturday.
                flagged: player.status === 'd' || player.status === 'i' || player.status === 's' || player.status === 'u'
            };
        }

        function trOwnershipBand(own) {
            if (own == null) return 'unknown';
            return own > 25 ? 'template' : own >= 8 ? 'mid' : 'differential';
        }

        function trSwing(teamId) {
            const s = (typeof fixtureSwingData !== 'undefined' && fixtureSwingData[teamId]) || null;
            if (!s) return null;
            return { direction: s.direction, from: s.currentFdr, to: s.futureFdr, gw: s.swingGW };
        }

        /* Everything the card needs, as data.

           Deliberately returns a structure rather than markup so the same
           rationale can be rendered on a card, folded into a tooltip, or
           asserted in a test without going through the DOM. */
        function trRationale(move, opts) {
            if (!move || !move.out || !move.in) return null;
            const o = opts || {};
            const out = move.out, inc = move.in;

            const horizons = TR_HORIZONS.map(n => {
                const a = trXPOver(out, n), b = trXPOver(inc, n);
                if (!a || !b) return { n, outXP: null, inXP: null, delta: null, gws: null };
                return {
                    n, gws: a.gws, outXP: a.xp, inXP: b.xp,
                    delta: Math.round((b.xp - a.xp) * 10) / 10
                };
            }).filter(h => h.gws && h.gws.length);

            const outStrip = trFixtures(out.teamId, 5), inStrip = trFixtures(inc.teamId, 5);
            const sellPrice = out.sellPrice != null ? out.sellPrice : out.price;
            const bank = o.bank != null ? o.bank : 0;

            return {
                out, in: inc,
                horizons,
                /* The shape of the edge, not just its size. A move that gains at
                   three gameweeks and gives it back by eight is renting a fixture
                   run; one that is flat early and strong late is an upgrade being
                   bought at the wrong moment. */
                shape: (() => {
                    const h3 = horizons.find(h => h.n === 3), h8 = horizons.find(h => h.n === 8);
                    if (!h3 || !h8 || h3.delta == null || h8.delta == null) return null;
                    /* Fractions of a negative number do not mean what they look
                       like they mean: at h3 = −2, "keeps 40% of the edge" is
                       satisfied by anything up to −0.8, which is an improving
                       move, and by −5, which is a worsening one. The recommender
                       decides on five gameweeks, so being behind at three is
                       legitimate and has to be classified by direction instead. */
                    /* Rates, not totals. The deltas are cumulative, so a player
                       with a constant weekly edge already shows 8/3 ≈ 2.7x more
                       at eight gameweeks than at three. Comparing the totals
                       therefore calls every ordinary upgrade "long-term" and
                       leaves "steady" to mean an edge that is actually decaying
                       — which is how a genuinely sub-linear move like +4.7 at
                       three against +10.9 at eight came out as long-term.
                       Per gameweek, a constant edge is 1.0 and the thresholds
                       mean what they look like they mean. */
                    const rate3 = h3.delta / h3.n, rate8 = h8.delta / h8.n;
                    if (rate3 > 0) {
                        if (rate8 <= rate3 * 0.4) return 'fixture-run';
                        if (rate8 > rate3 * 1.6) return 'long-term-upgrade';
                        return 'steady';
                    }
                    // Level or behind at three: direction is the only thing a
                    // ratio against zero or a negative can honestly report.
                    if (rate8 > rate3) return 'long-term-upgrade';
                    if (rate8 < rate3) return 'fixture-run';
                    return 'steady';
                })(),
                fixtures: {
                    out: { strip: outStrip, avgFdr: trAvgFdr(outStrip), swing: trSwing(out.teamId) },
                    in: { strip: inStrip, avgFdr: trAvgFdr(inStrip), swing: trSwing(inc.teamId) }
                },
                money: {
                    sellPrice, buyPrice: inc.price,
                    // Negative means the move needs money it does not have.
                    bankAfter: Math.round((bank + sellPrice - inc.price) * 10) / 10,
                    affordable: inc.price <= sellPrice + bank + 0.001,
                    outPriceProgress: out.priceProgress || 0,
                    inPriceProgress: inc.priceProgress || 0
                },
                risk: { out: trMinutes(out), in: trMinutes(inc) },
                ownership: {
                    out: out.ownership, in: inc.ownership,
                    delta: (inc.ownership != null && out.ownership != null)
                        ? Math.round((inc.ownership - out.ownership) * 10) / 10 : null,
                    inBand: trOwnershipBand(inc.ownership),
                    outBand: trOwnershipBand(out.ownership)
                },
                cost: o.hitCost || 0
            };
        }

        /* ===== rendering ===== */

        function trStripHTML(strip) {
            return strip.map(f => f.blank
                ? `<span class="tr-fx blank" data-tooltip="GW${f.gw} — no fixture">—</span>`
                : `<span class="tr-fx fdr-${f.difficulty}${f.double ? ' dbl' : ''}"
                     data-tooltip="${escHTML(`GW${f.gw} — ${f.isHome ? 'home to' : 'away at'} ${f.opponent || '?'}, difficulty ${f.difficulty}`)}"
                   >${escHTML((f.opponent || '?').slice(0, 3))}</span>`).join('');
        }

        function trSwingHTML(swing) {
            if (!swing) return '';
            const better = swing.direction === 'improving';
            return `<span class="tr-swing ${better ? 'up' : 'down'}"
                data-tooltip="${escHTML(`Average difficulty ${swing.from} over the next three, then ${swing.to} from GW${swing.gw}.`)}"
                >${better ? '↑ eases' : '↓ hardens'} GW${swing.gw}</span>`;
        }

        function trRiskHTML(r, who) {
            if (r.flagged) {
                return `<span class="tr-risk bad" data-tooltip="${escHTML(r.news || 'Carrying a fitness flag')}">flagged</span>`;
            }
            const cls = r.label === 'nailed' ? 'good' : r.label === 'likely' ? 'ok' : 'bad';
            return `<span class="tr-risk ${cls}" data-tooltip="${escHTML(
                `${who} starts about ${Math.round((r.pStart || 0) * 100)}% of the time, averaging ${r.expMins}′ when he does.`)}"
                >${escHTML(r.label)}</span>`;
        }

        function trShapeNote(shape, h3, h8) {
            const s = v => (v > 0 ? '+' : '') + v;
            /* Every shape below can be reached with a non-positive near-term
               delta — these are raw player-for-player projections, while the
               recommender chooses on what reaches your XI, so selling a benched
               player with a good run is an ordinary way to get here. The
               wording below assumes a gain, and "good now" printed over −2.0 is
               worse than saying nothing. Handle the sign before the shape. */
            if (h3.delta <= 0) {
                if (h8.delta > 0) {
                    return `It costs you ${Math.abs(h3.delta)} over the next three gameweeks and is ${s(h8.delta)} by eight — you are paying now for a player who is worth more later.`;
                }
                if (h8.delta < h3.delta) {
                    return `The gap widens against you across the horizon (${s(h3.delta)} at three, ${s(h8.delta)} at eight). The projection does not argue for this move on its own; it only makes sense as part of the set above.`;
                }
                return `Nothing to gain at either horizon (${s(h3.delta)} at three, ${s(h8.delta)} at eight). Whatever this move is for, it is not the projection.`;
            }
            /* Both figures are cumulative, so the sentence has to say so —
               "+4.7 at three, +10.9 at eight" looks like acceleration and is in
               fact a slowdown. Naming the weekly rate is what makes the
               difference legible. */
            if (shape === 'fixture-run') {
                return `Most of it is in the next three gameweeks: ${s(h3.delta)} there, against ${s(h8.delta)} across all eight. That is a fixture play — good now, and worth revisiting once the run ends.`;
            }
            if (shape === 'long-term-upgrade') {
                return `The edge builds: ${s(h3.delta)} over three gameweeks and ${s(h8.delta)} over eight, which is more per week later than it is now. That is an upgrade rather than a fixture play, so it does not need to pay off immediately.`;
            }
            // A rate that rounds to 0.0 a gameweek is not worth stating as one.
            const rate = h3.delta / h3.n;
            if (rate < 0.05) {
                return `Much the same either way (${s(h3.delta)} over three gameweeks, ${s(h8.delta)} over eight). The projection is close to neutral on this one.`;
            }
            return `Worth about ${rate.toFixed(1)} a gameweek throughout — ${s(h3.delta)} over three and ${s(h8.delta)} over eight. The gain is not resting on one kind run.`;
        }

        /* The card. Every figure carries the reasoning behind it rather than
           asking the reader to take a single delta on trust.

           opts.header === false drops the out → in line. The recommendation
           panel already draws its own, and two headers stacked read as two
           different moves rather than one explained twice. */
        function trRenderCard(rationale, opts) {
            const r = rationale;
            if (!r) return '';
            const showHeader = !opts || opts.header !== false;
            const h = n => r.horizons.find(x => x.n === n);
            const h3 = h(3), h5 = h(5), h8 = h(8);
            const sign = v => (v > 0 ? '+' : '') + v.toFixed(1);

            const cols = r.horizons.map(x => `
                <div class="tr-h ${x.n === 5 ? 'lead' : ''}" data-tooltip="${escHTML(
                    `${r.in.name} projects ${x.inXP.toFixed(1)} over the next ${x.n} gameweeks against ${r.out.name}'s ${x.outXP.toFixed(1)}.`)}">
                    <span class="tr-h-n">${x.n} GW</span>
                    <span class="tr-h-v ${x.delta > 0 ? 'up' : x.delta < 0 ? 'down' : ''}">${sign(x.delta)}</span>
                </div>`).join('');

            const m = r.money;
            const moneyLine = m.bankAfter >= 0
                ? `£${m.sellPrice.toFixed(1)}m out, £${m.buyPrice.toFixed(1)}m in — £${m.bankAfter.toFixed(1)}m left in the bank.`
                : `£${m.buyPrice.toFixed(1)}m is £${Math.abs(m.bankAfter).toFixed(1)}m more than selling ${escHTML(r.out.name)} raises.`;

            /* Ownership matters for what it does to your rank, not your score,
               so each branch says which way the risk runs rather than leaving
               the reader to work out what a signed percentage point means. */
            const own = r.ownership;
            const ownNames = `${escHTML(r.in.name)} ${own.in}%, ${escHTML(r.out.name)} ${own.out}%`;
            const ownLine = own.delta == null ? ''
                : Math.abs(own.delta) < 1 ? `Owned by much the same share (${ownNames}), so this barely moves you against the field.`
                    : own.delta > 0 ? `${ownNames} — ${own.delta}pp more owned, which follows the field rather than trying to beat it.`
                        : `${ownNames} — ${Math.abs(own.delta)}pp less owned, so it gains rank when it comes off and loses rank when it does not.`;

            return `<div class="tr-card">
                ${showHeader ? `<div class="tr-move">
                    <span class="tr-out">${escHTML(r.out.name)}<small>${escHTML(r.out.team)} · £${m.sellPrice.toFixed(1)}m</small></span>
                    <span class="tr-arrow">→</span>
                    <span class="tr-in">${escHTML(r.in.name)}<small>${escHTML(r.in.team)} · £${m.buyPrice.toFixed(1)}m</small></span>
                </div>` : ''}

                <div class="tr-horizons" data-tooltip="Projected points gained over three, five and eight gameweeks. Five is the horizon the recommendation is decided on.">
                    ${cols}
                </div>
                ${h3 && h8 ? `<p class="tr-shape">${escHTML(trShapeNote(r.shape, h3, h8))}</p>` : ''}

                <div class="tr-row">
                    <span class="tr-label">Fixtures</span>
                    <span class="tr-strips">
                        <span class="tr-side"><em>out</em>${trStripHTML(r.fixtures.out.strip)}${trSwingHTML(r.fixtures.out.swing)}</span>
                        <span class="tr-side"><em>in</em>${trStripHTML(r.fixtures.in.strip)}${trSwingHTML(r.fixtures.in.swing)}</span>
                    </span>
                </div>

                <div class="tr-row">
                    <span class="tr-label">Minutes</span>
                    <span class="tr-vals">${trRiskHTML(r.risk.out, r.out.name)} → ${trRiskHTML(r.risk.in, r.in.name)}</span>
                </div>

                <div class="tr-row">
                    <span class="tr-label">Money</span>
                    <span class="tr-vals ${m.affordable ? '' : 'bad'}">${moneyLine}</span>
                </div>

                ${ownLine ? `<div class="tr-row"><span class="tr-label">Ownership</span><span class="tr-vals">${ownLine}</span></div>` : ''}
                ${r.cost ? `<div class="tr-row"><span class="tr-label">Hit</span><span class="tr-vals bad">−${r.cost} points, already deducted from the figures above.</span></div>` : ''}
            </div>`;
        }
