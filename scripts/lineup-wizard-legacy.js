/* ============================================
   EasyFPL — the Lineup Wizard AS IT WAS, kept for comparison
   ============================================

   This is the intel panel exactly as it stood at 92d26c8c, the commit before
   the redesign arc began: the Overview tab with its four tiles, the
   points-source bar and the fixture narrative; the Captaincy matrix with its
   threat and opponent bars, its points breakdown and its nailed-on figure; and
   the Matchday tab with the full market panel — win/draw/loss, both clean-sheet
   numbers, over 2.5, the likeliest scorelines.

   It is here so the two versions can be read side by side on one page, and it
   is built to be deleted. Everything lives inside this IIFE and exactly one
   name reaches the page — window.lwLegacy — so:

     - check:globals cannot see a collision, because nothing here is top level;
     - the live version shares no state with it beyond lineupState, which this
       file only reads;
     - removing it is deleting this file, its stylesheet block, the two lines
       in renderLineupCommandCenter() that mount it, and its entry in the page
       manifest. Nothing else refers to it.

   The render functions below are the originals, unedited apart from four
   mechanical changes: the tab state moved from lineupState.intelTab to a local,
   setLWIntelTab became lwLegacy.setTab, updateLWContextPanel became this
   module's own render(), and the odds panel's reload callback points at the
   same render() rather than at boRefreshPanel(), which the live file no longer
   has. Everything else — including every behaviour the new page may have
   dropped — is as it was. */
(function () {
    'use strict';

    let intelTab = 'overview';

    /* Paints into the section renderLineupCommandCenter() mounts. Safe to call
       when the section is not on the page: it simply does nothing. */
    function render() {
        const host = document.getElementById('lwLegacyBody');
        if (!host) return;
        if (typeof lineupState === 'undefined' || !lineupState || !lineupState.xi) return;
        /* Each half is a panel, matching the rest of the site — the old page
           had the pitch sitting loose on the background beside a bordered
           intel panel, which is the inconsistency the panel treatment fixes.
           .lw-intel already draws its own border, so it is the panel on its
           side and only the pitch needs wrapping. */
        host.innerHTML = `<div class="lw-cc-body">
            <section class="v2-section lw-cc-pitch">
                <div class="section-header"><h2>${typeof v2Icon === 'function' ? v2Icon('shirt') : ''} Lineup</h2></div>
                ${typeof renderLWPitch === 'function' ? renderLWPitch() : ''}
            </section>
            <div class="lw-cc-intel">${renderLWIntel()}</div>
        </div>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

            function setTab(tab) {
                intelTab = tab;
                render();
            }

            function renderLWIntel() {
                const tab = intelTab;
                let body;
                if (tab === 'captaincy') body = renderLWCaptaincyMatrix();
                // Bookmakers price one round at a time, so odds can only ever speak
                // about the gameweek being picked — which is exactly this screen's
                // question, and why the tab lives here rather than in the Transfer
                // Wizard. scripts/odds-panel.js loads the feed lazily on first view.
                else if (tab === 'odds') body = typeof renderBOMatchdayPanel === 'function'
                    ? renderBOMatchdayPanel()
                    : '<div class="lw-side-empty">The odds panel is not loaded on this page.</div>';
                else {
                    const sel = lineupState.selectedPlayers;
                    body = !sel.length ? renderLWSummary()
                        : sel.length === 1 ? renderLWContextSingle(sel[0])
                        : renderLWContextCompare(sel[0], sel[1]);
                }
                /* The projected total belongs to the lineup, not to one tab of the
                   panel that discusses it. It was drawn twice from the same
                   lwTotalXP() call - once as a chip in the command-centre header and
                   once as this hero inside the Overview - so one figure appeared in
                   two places on the same screen. Deleting the header chip and leaving
                   the hero where it sat would have hidden the page's headline number
                   behind the Captaincy tab, or behind selecting a player to compare.
                   Above the tabs: one number, one place, true of all three. */
                const heroCap = lineupState.squad.find(p => p.id === lineupState.captain);
                const hero = lineupState.xi.length
                    ? `<div class="lw-sum-hero">
                            <div class="lw-sum-hero-v">${lwTotalXP().toFixed(1)}</div>
                            <div class="lw-sum-hero-l">projected points · ${escHTML(lineupState.formation)}${heroCap ? ` · ${lwFace(heroCap)}${escHTML(heroCap.web_name)} captained` : ''}</div>
                        </div>`
                    : '';
                return `<div class="lw-intel">
                    ${hero}
                    <div class="lw-intel-tabs">
                        <button class="lw-intel-tab ${tab === 'overview' ? 'active' : ''}" onclick="lwLegacy.setTab('overview')">${v2Icon('brain')} Overview</button>
                        <button class="lw-intel-tab ${tab === 'captaincy' ? 'active' : ''}" onclick="lwLegacy.setTab('captaincy')">${v2Icon('crown')} Captaincy</button>
                        <button class="lw-intel-tab ${tab === 'odds' ? 'active' : ''}" onclick="lwLegacy.setTab('odds')" data-tooltip="What the betting market expects from this gameweek's fixtures — goals, clean sheets and results, with the bookmaker's margin removed.">${v2Icon('up')} Matchday</button>
                    </div>
                    <div class="lw-intel-body">${body}</div>
                </div>`;
            }

            // Where a group of players' projected points actually come from, summed.
            // projectPlayerPointsDetailed already splits every projection into
            // appearance/attack/clean sheet/saves/bonus/defcon — the panel just never
            // showed it, so "37.2 projected" arrived with no account of itself.
            function lwPointsSources(players) {
                const totals = {};
                players.forEach(p => {
                    if (typeof optXpBreakdown !== 'function') return;
                    optXpBreakdown(p).parts.forEach(x => { totals[x.key] = (totals[x.key] || 0) + x.v; });
                });
                return Object.keys(totals)
                    .map(k => ({ key: k, v: totals[k] }))
                    .filter(x => Math.abs(x.v) >= 0.05)
                    .sort((a, b) => b.v - a.v);
            }

            function lwSourcesBar(sources) {
                const positive = sources.filter(x => x.v > 0);
                const total = Math.max(0.01, positive.reduce((s, x) => s + x.v, 0));
                const seg = positive.map(x =>
                    `<span class="opt-seg opt-seg-${x.key.toLowerCase()}" style="width:${Math.round((x.v / total) * 100)}%"
                        data-tooltip="${escHTML(x.key)}: ${x.v.toFixed(1)} of the eleven's projected points"></span>`).join('');
                return `<div class="opt-bar">${seg}</div>
                    <div class="opt-bar-legend">${sources.map(x => `${escHTML(x.key)} <strong>${x.v.toFixed(1)}</strong>`).join(' · ')}</div>`;
            }

            // The panel's default state, and the reason the Overview tab is worth
            // landing on: the full standing read on the lineup — what it projects and
            // where that comes from, how nailed it is, what it faces, where it is
            // weakest, and what is sitting on the bench that maybe should not be.
            // This is the analysis the optimisation report used to hold hostage until
            // you pressed Auto-optimise.
            function renderLWSummary() {
                const xi = lineupState.xi, bench = lineupState.bench;
                if (!xi.length) return `<div class="lw-side-empty">Load a squad to see the lineup read.</div>`;
                const lwRun = typeof xpPlanGWs === 'function' ? xpPlanGWs(XP_PLAN_HORIZON) : [];
                const runUnit = lwRun.length > 1 ? `xP · next ${lwRun.length} GWs` : 'xP';

                const sorted = [...xi].sort((a, b) => a.lwScore - b.lwScore);
                const weakest = sorted[0];
                const outfieldBench = bench.filter(p => p.pos !== 1 && !lineupState.excluded.has(p.id));
                const strongestBench = outfieldBench.sort((a, b) => b.lwScore - a.lwScore)[0];

                // Only a real upgrade if the swap keeps the formation legal.
                let upgrade = null;
                if (strongestBench) {
                    const candidateXI = xi.filter(p => p.id !== weakest.id).concat([strongestBench]);
                    if (isValidLWFormation(candidateXI) && strongestBench.lwScore > weakest.lwScore + 0.05) {
                        upgrade = { out: weakest, in: strongestBench, gain: strongestBench.lwScore - weakest.lwScore };
                    }
                }

                const flagged = lineupState.squad.filter(p => p.status === 'i' || p.status === 'u' || p.status === 's' || p.status === 'd');
                const risky = xi.filter(p => typeof expectedMinutesModel === 'function' && expectedMinutesModel(p).pStart < 0.6);

                // How dependable the eleven is, and what it is walking into.
                const starts = xi.map(p => typeof expectedMinutesModel === 'function' ? expectedMinutesModel(p).pStart : 1);
                const nailed = starts.filter(v => v >= 0.8).length;
                const expectedAbsent = starts.reduce((s, v) => s + (1 - v), 0);
                const fdrs = xi.map(p => typeof optFdrFor === 'function' ? optFdrFor(p) : 3);
                const avgFdr = fdrs.length ? fdrs.reduce((s, f) => s + f, 0) / fdrs.length : 3;
                const easyCount = fdrs.filter(f => f <= 2).length;
                const hardCount = fdrs.filter(f => f >= 4).length;

                // Three starters from one club is one result deciding your week.
                const byTeam = {};
                xi.forEach(p => { byTeam[p.teamId] = (byTeam[p.teamId] || 0) + 1; });
                const stacked = Object.keys(byTeam).filter(t => byTeam[t] >= 3)
                    .map(t => `${(typeof teams !== 'undefined' && teams[t] ? teams[t].short_name : null) || '???'} (${byTeam[t]})`);

                const sources = lwPointsSources(xi);

                return `<div class="lw-sum">
                    <div class="opt-grid">
                        <div class="opt-stat"><div class="opt-stat-v">${xi.reduce((s, p) => s + p.gwScore, 0).toFixed(1)}</div>
                            <div class="opt-stat-l" data-tooltip="Sum of projected points across the eleven starters, before the captain's double.">XI xP</div></div>
                        <div class="opt-stat"><div class="opt-stat-v">${nailed}<span class="opt-stat-sub">/11</span></div>
                            <div class="opt-stat-l" data-tooltip="Starters at least 80% likely to start, from minutes per appearance and fitness.">Nailed on</div></div>
                        <div class="opt-stat"><div class="opt-stat-v">${expectedAbsent.toFixed(1)}</div>
                            <div class="opt-stat-l" data-tooltip="Expected number of your eleven who do not start. This is what the bench order insures against.">Expected absent</div></div>
                        <div class="opt-stat"><div class="opt-stat-v">${avgFdr.toFixed(1)}</div>
                            <div class="opt-stat-l" data-tooltip="Average fixture difficulty faced by the starting eleven this gameweek.">Avg FDR</div></div>
                    </div>

                    ${sources.length ? `<div class="lw-sum-block">
                        <div class="lw-sum-h">Where the points come from</div>
                        ${lwSourcesBar(sources)}
                        <div class="lw-sum-note">${escHTML(sources[0].key)} is the largest single source at <strong>${sources[0].v.toFixed(1)}</strong> projected points across the eleven.</div>
                    </div>` : ''}

                    <div class="lw-sum-block">
                        <div class="lw-sum-h">${v2Icon('calendar')} What the eleven face</div>
                        <div class="lw-sum-note">${easyCount} of the eleven face a difficulty-2-or-easier fixture and ${hardCount} face a 4 or harder.
                            ${stacked.length
                                ? `You are stacked on <strong>${escHTML(stacked.join(', '))}</strong> — a strong week for them lifts the whole team, a poor one sinks it.`
                                : 'No club supplies three or more of your starters, so the week is spread across teams.'}</div>
                    </div>

                    <!-- The weakest starter and the best substitute were two cards,
                         and they are one question: is there a swap to make? The code
                         already knew that - the upgrade computed above reads the two
                         of them together - but the panel asked it twice and answered
                         it twice, once per card, so the notes had to hedge around
                         each other ("nothing beats them in a legal formation" beside
                         "out-projects a starter"). Side by side the comparison is the
                         card, and one note can say the whole thing. -->
                    <div class="lw-sum-block">
                        <div class="lw-sum-h">${v2Icon('scales')} Key player decisions</div>
                        <div class="lw-sum-duo">
                            <div class="lw-sum-duo-i">
                                <div class="lw-sum-duo-l">${v2Icon('down')} Weakest in the XI</div>
                                <div class="lw-sum-name">${lwFace(weakest)}<span class="lw-sum-name-t">${escHTML(weakest.web_name)}</span></div>
                                <div class="lw-sum-xp">${weakest.lwScore.toFixed(1)}</div>
                            </div>
                            <div class="lw-sum-duo-i">
                                <div class="lw-sum-duo-l">${v2Icon('bench')} Strongest on the bench</div>
                                ${strongestBench
                                    ? `<div class="lw-sum-name">${lwFace(strongestBench)}<span class="lw-sum-name-t">${escHTML(strongestBench.web_name)}</span></div>
                                <div class="lw-sum-xp">${strongestBench.lwScore.toFixed(1)}</div>`
                                    : `<div class="lw-sum-name lw-sum-duo-none">None</div>
                                <div class="lw-sum-xp lw-sum-duo-none">—</div>`}
                            </div>
                        </div>
                        <div class="lw-sum-duo-u">${runUnit}</div>
                        <div class="lw-sum-note">${upgrade
                            ? `${escHTML(upgrade.in.web_name)} projects <strong>+${upgrade.gain.toFixed(1)}</strong> more than ${escHTML(upgrade.out.web_name)}, and the shape still works. <button class="lw-sum-apply" onclick="lwApplySwap(${upgrade.out.id}, ${upgrade.in.id})">Make the swap</button>`
                            : !strongestBench
                                ? 'No outfield players on the bench, so there is no swap to make.'
                                : strongestBench.lwScore > weakest.lwScore
                                    ? `${escHTML(strongestBench.web_name)} out-projects ${escHTML(weakest.web_name)}, but no legal formation lets them swap — the shape is what is keeping them out.`
                                    : 'Nothing on the bench beats a starter — this is as good as the eleven gets.'}</div>
                    </div>

                    ${(flagged.length || risky.length) ? `<div class="lw-sum-block">
                        <div class="lw-sum-h">Worth checking</div>
                        ${flagged.map(p => `<div class="lw-sum-flag">${lwFace(p)}<strong>${escHTML(p.web_name)}</strong> — ${escHTML((p.news || '').split('.')[0] || (p.status === 'd' ? 'fitness doubt' : 'unavailable'))}${p.chanceNextRound != null ? ` (${p.chanceNextRound}%)` : ''}</div>`).join('')}
                        ${risky.filter(p => !flagged.some(f => f.id === p.id)).map(p => `<div class="lw-sum-flag">${lwFace(p)}<strong>${escHTML(p.web_name)}</strong> — rotation risk, ${Math.round(expectedMinutesModel(p).pStart * 100)}% likely to start</div>`).join('')}
                    </div>` : ''}

                    ${renderLWChanges()}

                    <div class="lw-sum-hintline">Click a player on the pitch to swap them. Use ℹ for their detail, or two ℹs to compare.</div>
                </div>`;
            }

            // Captaincy as a matrix rather than a list: the armband is the biggest call
            // of the week, and "Form 8 · xGI/90 1.12" in grey text does not carry it.
            function renderLWCaptaincyMatrix() {
                const ranks = typeof getDefensiveRanks === 'function' ? getDefensiveRanks() : { rank: {}, total: 20 };
                // The armband only ever pays out for this gameweek, so candidates are
                // ranked on gwScore, not the run score the XI itself was picked on.
                const candidates = lineupState.xi.filter(p => p.pos !== 1)
                    .sort((a, b) => b.gwScore - a.gwScore).slice(0, 5);

                if (!candidates.length) return `<div class="lw-side-empty">No outfield players in the XI yet.</div>`;


                const cards = candidates.map((p, i) => {
                    const fx = (p.fixtures || teamFixtures[p.teamId] || [])[0];
                    const ctx = fx && typeof opponentContext === 'function' ? opponentContext(p.teamId, fx, ranks) : null;
                    const per90 = typeof regressedPer90 === 'function' ? regressedPer90(p) : { xg90: 0, xa90: 0 };
                    const threat = per90.xg90 + per90.xa90;
                    const risk = typeof optMinutesRisk === 'function' ? optMinutesRisk(p) : null;
                    // The opponent's defence is not a fixed quantity — a side shipping
                    // goals lately is a different bet from one whose season xGC merely
                    // looks bad, and the armband is a one-week call on current form.
                    const oppTA = fx && typeof teamAnalysis !== 'undefined' ? teamAnalysis[fx.opponentId] : null;
                    /* xgcTrend is 'worsening' / 'improving' — 'rising' and 'falling'
                       are what xgTrend uses, so both branches here tested for values
                       this field never holds and oppTrend was always null. */
                    const oppTrend = oppTA && oppTA.xgcTrend === 'worsening' ? 'leaking more lately'
                        : oppTA && oppTA.xgcTrend === 'improving' ? 'tightening up lately' : null;
                    /* This line used to read "LIV attack 55/100 away" — the player's
                       OWN team, as an index out of a hundred. Two things wrong with
                       it for an armband call: the quantity that decides a captaincy
                       is the defence he is about to face, not the shirt he wears,
                       and a 0-100 index cannot be checked against anything. It is
                       the opponent, in goals, now. */
                    const oppConceded = ctx && ctx.matches ? ctx.conceded : null;

                    // Two bars: how dangerous this player is, and how leaky the defence
                    // they face. A high threat into a tight defence is a different bet
                    // from a modest one into the league's softest.
                    const threatPct = Math.max(4, Math.min(100, (threat / 1.0) * 100));
                    const weakPct = ctx && ctx.ranked ? Math.max(4, Math.min(100, ((ranks.total - ctx.rank + 1) / ranks.total) * 100)) : null;
                    const form = isPreseason ? (p.ppg || 0) : (parseFloat(p.form) || 0);
                    const isCap = lineupState.captain === p.id, isVC = lineupState.viceCaptain === p.id;

                    /* The armband is a call about a person, and this grid asked you
                       to make it off five surnames. The portrait is the one the
                       pitch card already draws, so the player you are looking at
                       here is recognisably the player you just clicked there. */
                    const capIdent = { name: p.web_name, code: p.code, teamId: p.teamId, team: p.team };
                    return `<div class="lw-cap-card ${isCap ? 'is-cap' : ''}">
                        <div class="lw-cap-rank">${i + 1}</div>
                        ${typeof v2IdentityHTML === 'function' ? v2IdentityHTML(capIdent, 'v2-pid-portrait') : ''}
                        <div class="lw-cap-name">${escHTML(p.web_name)}</div>
                        <div class="lw-cap-team">${escHTML(p.team)} · ${POSITION_CONFIG[p.pos]?.short || ''}</div>
                        ${fx ? `<span class="dp-fix fdr-${fx.difficulty || 3}" data-tooltip="${fx.isHome ? 'Home to' : 'Away at'} ${escHTML(fx.opponent || '?')} — FDR ${fx.difficulty || 3}">${escHTML(fx.opponent || '?')} <span class="dp-fix-ha">(${fx.isHome ? 'H' : 'A'})</span></span>` : ''}
                        <div class="lw-cap-xp" data-tooltip="Projected points with the armband on — ${p.gwScore.toFixed(1)} doubled.">${(p.gwScore * 2).toFixed(1)}<span class="lw-cap-xp-u">pts</span></div>
                        <div class="lw-cap-bars">
                            <div class="lw-cap-bar-row" data-tooltip="Expected goal involvements per 90 for ${escHTML(p.web_name)}: ${threat.toFixed(2)}.">
                                <span class="lw-cap-bar-l">Threat</span>
                                <span class="lw-cap-bar"><span class="lw-cap-bar-f threat" style="width:${threatPct}%"></span></span>
                            </div>
                            <div class="lw-cap-bar-row" data-tooltip="${weakPct != null ? `${escHTML(fx.opponent)} are the ${ordinal(ctx.rank)} leakiest defence of ${ctx.total}, conceding ${ctx.conceded.toFixed(1)} per game.` : 'Not enough matches played to rank this opponent yet.'}">
                                <span class="lw-cap-bar-l">Opponent</span>
                                <span class="lw-cap-bar">${weakPct != null ? `<span class="lw-cap-bar-f weak" style="width:${weakPct}%"></span>` : '<span class="lw-cap-bar-na">not yet ranked</span>'}</span>
                            </div>
                        </div>
                        <div class="lw-cap-meta">Form <strong>${form.toFixed(1)}</strong> · Owned <strong>${p.ownership != null ? p.ownership + '%' : '—'}</strong>${risk ? ` · <span class="opt-risk ${risk.cls}" data-tooltip="${risk.pct}% likely to start — ${risk.word}. A captain who does not play costs you double.">${risk.word} ${risk.pct}%</span>` : ''}</div>
                        ${(oppTrend || oppConceded != null) ? `<div class="lw-cap-ctx">${[
                            oppConceded != null ? `${escHTML(fx.opponent || 'Opponent')} concede ${oppConceded.toFixed(1)} a game` : '',
                            oppTrend ? `${escHTML(fx.opponent || 'Opponent')} ${oppTrend}` : ''
                        ].filter(Boolean).join(' · ')}</div>` : ''}
                        ${typeof optBreakdownBar === 'function' ? `<div class="lw-cap-break">${optBreakdownBar(p)}</div>` : ''}
                        <div class="lw-cap-actions">
                            <button class="lw-cap-btn ${isCap ? 'active-c' : ''}" onclick="setLWCaptain(${p.id})" data-tooltip="Give ${escHTML(p.web_name)} the armband">C</button>
                            <button class="lw-cap-btn ${isVC ? 'active-vc' : ''}" onclick="setLWViceCaptain(${p.id})" data-tooltip="Make ${escHTML(p.web_name)} vice-captain">VC</button>
                        </div>
                    </div>`;
                }).join('');

                // How clear the call is, stated up front. A 0.2-point lead and a
                // 2.0-point lead are the same ordering and completely different
                // decisions, and the grid alone never said which one you were looking at.
                const lead = candidates.length > 1 ? candidates[0].gwScore - candidates[1].gwScore : 0;
                const picked = lineupState.squad.find(p => p.id === lineupState.captain);
                const topRisk = typeof optMinutesRisk === 'function' ? optMinutesRisk(candidates[0]) : null;
                const verdict = lead > 0.8
                    ? `<strong>${escHTML(candidates[0].web_name)}</strong> is the clear call — ${lead.toFixed(1)} projected points clear of ${escHTML(candidates[1].web_name)} before the armband doubles it.`
                    : candidates.length > 1
                        ? `Close call: ${escHTML(candidates[0].web_name)} leads ${escHTML(candidates[1].web_name)} by only <strong>${lead.toFixed(1)}</strong> projected points, so fixture and minutes risk decide it more than projection does.`
                        : `${escHTML(candidates[0].web_name)} is the only outfield option in your XI.`;
                const offPick = picked && picked.id !== candidates[0].id
                    ? `<div class="lw-cap-off">You have the armband on <strong>${escHTML(picked.web_name)}</strong>, ${(candidates[0].gwScore - picked.gwScore).toFixed(1)} projected points behind ${escHTML(candidates[0].web_name)}.</div>`
                    : '';

                return `<div class="lw-cap-matrix">
                    <div class="lw-cap-lead">${verdict}${topRisk && topRisk.pct < 80 ? ` Worth noting they are only ${topRisk.pct}% likely to start.` : ''}</div>
                    ${offPick}
                    <div class="lw-cap-grid">${cards}</div>
                    <div class="lw-cap-foot">Ranked on this gameweek alone — the armband only ever pays out once. The bars set what each player threatens against how leaky the defence they face is.</div>
                </div>`;
            }

            function renderLWChanges() {
                const xi = lineupState.xi;
                const xiIds = new Set(xi.map(p => p.id));
                const origIds = lineupState.originalXIIds;
                const changes = [];

                // Players promoted from bench to XI
                xi.forEach(p => {
                    if (!origIds.has(p.id)) {
                        changes.push({ player: p, type: 'promoted', label: 'Promoted to XI' });
                    }
                });

                // Players moved to bench from XI
                lineupState.bench.forEach(p => {
                    if (origIds.has(p.id)) {
                        changes.push({ player: p, type: 'benched', label: 'Moved to bench' });
                    }
                });

                // Captain changes
                if (lineupState.captain !== lineupState.originalCaptain) {
                    const capP = lineupState.squad.find(p => p.id === lineupState.captain);
                    if (capP) changes.push({ player: capP, type: 'captain', label: 'New Captain' });
                }
                if (lineupState.viceCaptain !== lineupState.originalVC) {
                    const vcP = lineupState.squad.find(p => p.id === lineupState.viceCaptain);
                    if (vcP) changes.push({ player: vcP, type: 'captain', label: 'New Vice-Captain' });
                }

                /* A whole card to report that nothing happened. The Overview above
                   is already a stack of cards, and this one spent a 16px-padded box,
                   its own heading and its own shadow to say "No Changes". One line
                   carries the same information at the weight it is worth. */
                if (changes.length === 0) {
                    return `<div class="lw-sum-quiet">${v2Icon('check')} Your FPL lineup already matches this one — nothing to change.</div>`;
                }

                let html = `<div class="lw-final-section"><div class="lw-final-header"><i data-lucide="git-compare" style="width:16px;height:16px;color:#A78BFA;"></i> Changes vs Current FPL Lineup (${changes.length})</div>`;
                changes.forEach(c => {
                    const posNames = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
                    html += `<div class="lw-change-row">
                        <span class="lw-change-badge ${c.type}">${c.type === 'promoted' ? '↑ IN' : c.type === 'benched' ? '↓ OUT' : v2Icon('crown')}</span>
                        ${lwFace(c.player)}
                        <span style="font-weight:600;">${escHTML(c.player.web_name)}</span>
                        <span style="font-size:11px;color:var(--text-muted);">${posNames[c.player.pos]} · ${escHTML(c.player.team)}</span>
                        <span style="flex:1;"></span>
                        <span style="font-size:11px;color:var(--text-secondary);">${c.label}</span>
                    </div>`;
                });
                html += `</div>`;
                return html;
            }

            function renderBOMatchdayPanel() {
                if (!boOdds) {
                    boLoadOdds().then(d => { if (d) render(); });
                    return boOddsError
                        ? `<div class="lw-side-empty">Bookmakers' odds are unavailable right now — ${escHTML(boOddsError)}. The rest of the wizard is unaffected; every projection on this page is the site's own model and does not depend on this feed.</div>`
                        : `<div class="lw-side-empty">Loading this gameweek's odds…</div>`;
                }

                const matches = boMatchesForEvent();
                if (!matches.length) {
                    return `<div class="lw-side-empty">No priced fixtures for this gameweek yet. Bookmakers price a round at a time, usually from the start of the week.</div>`;
                }

                const gw = matches[0].event;
                const updated = boOdds.metadata && boOdds.metadata.lastUpdated
                    ? new Date(boOdds.metadata.lastUpdated) : null;
                const stale = updated ? (Date.now() - updated.getTime()) > 36 * 3600 * 1000 : false;

                return `<div class="bo-panel">
                    <div class="bo-head">
                        <span class="bo-title">Matchday odds <span class="bo-gw">GW${gw}</span></span>
                        <span class="bo-src" data-tooltip="Consensus prices across the bookmakers published by football-data.co.uk. Nobody quotes a clean-sheet percentage — these are derived from the 1X2 and over/under 2.5 markets with the bookmaker's margin removed.">
                            ${matches.length} matches${updated ? ` · ${escHTML(updated.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}` : ''}</span>
                    </div>
                    ${stale ? `<div class="bo-stale">These prices are more than a day old — the odds job has not run since. Treat them as indicative.</div>` : ''}
                    ${(() => {
                        const b = boBlendInfo();
                        return b.active
                            ? `<div class="bo-blend on" data-tooltip="${escHTML(
                                `Every projection on this page for GW${b.event} is ${Math.round(b.weight * 100)}% the market's goal expectations and ${Math.round((1 - b.weight) * 100)}% this site's model. The market's share falls as the season gives the model more of its own evidence — currently ${b.matchesPlayed ?? 0} matches played. Later gameweeks are model-only: bookmakers do not price them yet.`)}">
                                Blended into GW${b.event} projections · market weight ${Math.round(b.weight * 100)}%</div>`
                            : `<div class="bo-blend off" data-tooltip="Projections are model-only. The market is blended in only when every fixture in the round is priced, so that no two players are being compared across different estimators.">
                                Shown for reference — not blended into projections</div>`;
                    })()}
                    <div class="bo-matches">${matches.map(boRenderMatch).join('')}</div>
                    <div class="bo-foot">Derived from de-vigged 1X2 and over/under 2.5 prices, fitted to independent Poisson. Odds describe one gameweek only, which is why they appear here and not in the Transfer Wizard. Source: football-data.co.uk.</div>
                </div>`;
            }


    window.lwLegacy = { setTab, render };
})();
