/* ============================================
   EasyFPL — deadline readiness

   The dashboard already knew what was wrong with a squad. What it could not do
   was tell you when nothing was.

   renderAttentionGrid() built two lists of problems and rendered them. Every
   item was a symptom keyed off a player, which has two consequences. A clean
   squad produced two empty columns — indistinguishable from a page that had not
   finished loading — so the one state a manager most wants before a deadline,
   "you are ready", was the only state the panel could not express. And a whole
   class of mistake never appeared at all, because it is an absence rather than
   a symptom: a fifth free transfer that cannot be banked, a chip set about to
   expire. No player is flagged, so no row was ever created.

   This file turns that list into a checklist. Every check is named, always runs,
   and reports clear or not — so the panel can count, and the count is what makes
   it a thing you come back to rather than a thing you read.

   The check logic is ported from the inline version rather than rewritten, down
   to the wording, because that copy was carefully chosen. What is new is the
   framing around it: the named checks, the summary, and the two absence checks
   at the end that the old shape could not have produced.

   Being here rather than inline in index.html also means it is testable, which
   none of it was.

   Prefix rd*. No DOM access anywhere: rdBuild returns data and rdSummaryHTML
   returns a string, so the caller owns every element on the page.

   DEPENDENCIES, all optional-guarded: expectedMinutesModel (xp-engine.js),
   escHTML (common.js).
   ============================================ */

        /* Every check, in the order a manager works down them. Order is XI first
           because a lineup mistake is unrecoverable after the deadline, while a
           transfer not made is merely an opportunity missed. */
        const RD_CHECKS = [
            { id: 'xi-fit', column: 'xi', label: 'Every starter is available' },
            { id: 'xi-minutes', column: 'xi', label: 'No rotation risk starting' },
            { id: 'vice', column: 'xi', label: 'Vice-captain can take the armband' },
            { id: 'bench', column: 'xi', label: 'Bench can cover a blank' },
            { id: 'captain', column: 'xi', label: 'Armband on your best option' },
            { id: 'transfer', column: 'tx', label: 'Transfer decision made' },
            { id: 'sell', column: 'tx', label: 'No unaddressed sell verdicts' },
            { id: 'free-transfers', column: 'tx', label: 'Free transfers not going to waste' },
            { id: 'chips', column: 'tx', label: 'Chips still in date' }
        ];

        /* FPL runs two chip sets in 2026/27 and the first expires at 13:30 GMT on
           2 January. A chip you were saving is worth nothing the day after, and
           nothing in the game warns you — so the date is hard-coded because it is
           a fixture of the season rather than something derivable from the feed.
           January of whichever season we are currently in: before the turn of the
           year that is next January, after it the set has already gone. */
        const RD_CHIP_DEADLINE_MONTH = 0;   // January
        const RD_CHIP_DEADLINE_DAY = 2;
        const RD_CHIP_DEADLINE_HOUR = 13.5; // 13:30 GMT
        const RD_CHIP_WARN_DAYS = 45;
        const RD_FIRST_HALF_CHIPS = ['wildcard', 'freehit', '3xc', 'bboost'];

        function rdChipDeadline(now) {
            const d = new Date(now);
            const year = d.getUTCMonth() >= 6 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
            return Date.UTC(year, RD_CHIP_DEADLINE_MONTH, RD_CHIP_DEADLINE_DAY,
                Math.floor(RD_CHIP_DEADLINE_HOUR), (RD_CHIP_DEADLINE_HOUR % 1) * 60);
        }

        function rdStartsPct(p) {
            if (typeof expectedMinutesModel !== 'function') return null;
            try {
                const m = expectedMinutesModel(p);
                return m ? Math.round(m.pStart * 100) : null;
            } catch (e) { return null; }
        }

        const rdSquadLink = id => `fpl-my-team-analysis.html#squad?player=${id}`;

        /* Build every check against a squad.

           Returns one entry per RD_CHECKS row, each carrying the rows the panel
           should draw for it. A check with no rows is clear — that is the whole
           point of running them all rather than only collecting problems.

           ctx: { squad, analysisResults, transferRec, captainRec, freeTransfers,
                  maxFreeTransfers, bank, chips, now } */
        function rdBuild(ctx) {
            const c = ctx || {};
            const squad = c.squad || [];
            const analysisResults = c.analysisResults || [];
            const now = c.now != null ? c.now : Date.now();
            const xi = squad.filter(p => p.pickPosition <= 11);
            const out = {};
            const add = (id, row) => { (out[id] = out[id] || []).push(row); };

            // --- xi-fit: a flag on a starter, which is the one thing that cannot
            // be fixed after the deadline has passed.
            xi.forEach(p => {
                if (p.status === 'i' || p.status === 'u' || p.status === 's') {
                    add('xi-fit', { name: p.name, reason: p.news || 'Unavailable — find a replacement', severity: 'sell', href: rdSquadLink(p.id) });
                } else if (p.status === 'd') {
                    const chance = p.chanceNextRound != null ? ` (${p.chanceNextRound}% chance)` : '';
                    add('xi-fit', { name: p.name, reason: (p.news || 'Doubtful') + chance, severity: 'monitor', href: rdSquadLink(p.id) });
                }
            });

            /* --- xi-minutes: expected minutes is the most important variable in
               the model and the one number never shown. A player can be fully fit,
               carry no news, and still be a coin flip to start. */
            xi.filter(p => p.status === 'a').forEach(p => {
                const pct = rdStartsPct(p);
                if (pct == null || pct >= 65) return;
                const mins = typeof expectedMinutesModel === 'function'
                    ? Math.round(expectedMinutesModel(p).expMins) : null;
                add('xi-minutes', {
                    name: p.name,
                    reason: `${pct}% likely to start${mins != null ? `, around ${mins} minutes` : ''} — an auto-sub may be needed`,
                    severity: pct < 40 ? 'sell' : 'monitor',
                    href: rdSquadLink(p.id)
                });
            });

            /* --- vice: the vice only matters when the captain plays nothing at
               all, but that is exactly when it matters most. A doubtful vice
               voids the biggest call of the week. */
            const viceP = squad.find(p => p.isViceCaptain);
            if (viceP) {
                const vp = rdStartsPct(viceP);
                if (viceP.status !== 'a' || (vp != null && vp < 60)) {
                    add('vice', {
                        name: viceP.name,
                        reason: viceP.status !== 'a'
                            ? 'Your vice-captain is carrying a fitness flag — if your captain blanks, the armband may pass to nobody'
                            : `Your vice-captain is only ${vp}% likely to start — the armband passes to him only if your captain plays no minutes`,
                        severity: 'monitor',
                        href: rdSquadLink(viceP.id)
                    });
                }
            }

            /* --- bench: an auto-sub only fires for a bench player who actually
               played, so the first outfield substitute has to be a real
               footballer. And three at the back with no defender in reserve means
               a defensive blank cannot legally be substituted at all. */
            const benchAll = squad.filter(p => p.pickPosition > 11).sort((a, b) => a.pickPosition - b.pickPosition);
            const outfieldSubs = benchAll.filter(p => p.position !== 1);
            if (outfieldSubs.length) {
                const first = outfieldSubs[0];
                const fp = rdStartsPct(first);
                if (first.status !== 'a' || (fp != null && fp < 45)) {
                    add('bench', {
                        name: first.name,
                        reason: `First on your bench but ${first.status !== 'a' ? 'flagged' : `only ${fp}% likely to play`} — an auto-sub cannot use a player who did not feature`,
                        severity: 'monitor',
                        href: 'fpl-my-team-analysis.html#lineup'
                    });
                }
                const startDef = xi.filter(p => p.position === 2).length;
                const benchDef = outfieldSubs.filter(p => p.position === 2).length;
                if (startDef <= 3 && benchDef === 0) {
                    add('bench', {
                        name: 'No defensive cover',
                        reason: `You start ${startDef} defenders with none on the bench — if one blanks, no auto-sub can legally replace him`,
                        severity: 'monitor',
                        href: 'fpl-my-team-analysis.html#lineup'
                    });
                }
            }

            // --- captain: the one row that performs its own action, moving the
            // armband rather than dropping you on a tab to do it by hand.
            const currentCaptain = squad.find(p => p.isCaptain);
            if (c.captainRec && currentCaptain && c.captainRec.name !== currentCaptain.name) {
                const recPlayer = squad.find(x => x.name === c.captainRec.name);
                add('captain', {
                    name: currentCaptain.name,
                    reason: `${c.captainRec.name} projects ${c.captainRec.xP} against ${c.captainRec.opponent} — the highest in your XI`,
                    severity: 'monitor',
                    href: recPlayer ? `fpl-my-team-analysis.html#squad?captain=${recPlayer.id}` : undefined
                });
            }

            /* --- transfer: the recommended move leads its column because it is
               the only row that proposes a fix rather than reporting a symptom.
               A settled Hold counts as clear: deciding not to transfer is a
               decision, and the panel should stop asking about it. */
            const rec = c.transferRec;
            if (rec && rec.best && rec.best.n > 0) {
                const b = rec.best;
                const span = `GW${rec.gws[0]}–GW${rec.gws[rec.gws.length - 1]}`;
                const moves = b.moves || [];
                add('transfer', {
                    name: moves.map(m => `${m.out.name} → ${m.in.name}`).join(', '),
                    reason: `+${b.net.toFixed(1)} xP across ${span}${b.cost > 0 ? `, after a −${b.cost} hit` : ' on a free transfer'}`,
                    severity: 'move',
                    href: 'fpl-my-team-analysis.html#transfers?' + moves.map(m => `out=${m.out.id}&in=${m.in.id}`).join('&')
                });
            }

            /* --- sell: a Sell verdict and the recommended move answer two
               different questions and do not always land on the same name. Left
               unexplained that reads as the page arguing with itself. */
            const recOutIds = new Set(((rec && rec.best && rec.best.moves) || []).map(m => m.out.id));
            const recBlocked = rec && rec.best && rec.best.n === 0;
            squad.forEach((p, i) => {
                const a = analysisResults[i];
                if (!a || a.verdict !== 'sell') return;
                const concern = a.topConcern || 'Rated Sell';
                add('sell', {
                    name: p.name,
                    reason: recOutIds.has(p.id)
                        ? `${concern} — the move above replaces him`
                        : recBlocked
                            ? `${concern}, but no replacement clears the margin yet — holding is still the better play`
                            : `${concern} — not in the recommended move, which gains more elsewhere this week`,
                    severity: 'sell',
                    href: rdSquadLink(p.id)
                });
            });

            /* --- free-transfers: the first check here that is an absence rather
               than a symptom, and the reason this file exists.

               Free transfers roll over, so an unused one is normally banked value
               rather than waste. At the cap it stops rolling: the transfer you do
               not make this week is gone, not saved. Nothing flags a player, so
               the old shape could never have produced this row. */
            const maxFT = c.maxFreeTransfers != null ? c.maxFreeTransfers : 5;
            if (c.freeTransfers != null && c.freeTransfers >= maxFT) {
                add('free-transfers', {
                    name: `${c.freeTransfers} free transfers`,
                    reason: `You are at the maximum, so next week you will still have ${maxFT} — one made now costs nothing and banks nothing if skipped`,
                    severity: 'monitor',
                    href: 'fpl-my-team-analysis.html#transfers'
                });
            }

            /* --- chips: the other absence. Two sets run this season and the first
               expires at 13:30 GMT on 2 January; a chip you were saving is worth
               nothing the day after, and the game gives no warning. */
            const chipDeadline = rdChipDeadline(now);
            const daysLeft = Math.floor((chipDeadline - now) / 86400000);
            if (daysLeft >= 0 && daysLeft <= RD_CHIP_WARN_DAYS) {
                const used = new Set(((c.chips) || [])
                    .filter(x => new Date(x.time || 0).getTime() < chipDeadline)
                    .map(x => x.name));
                const unused = RD_FIRST_HALF_CHIPS.filter(n => !used.has(n));
                if (unused.length) {
                    add('chips', {
                        name: `${unused.length} chip${unused.length === 1 ? '' : 's'} expiring`,
                        reason: `Your first-half ${unused.map(rdChipLabel).join(', ')} expire${unused.length === 1 ? 's' : ''} in ${daysLeft} day${daysLeft === 1 ? '' : 's'} — unused chips do not carry into the second set`,
                        severity: daysLeft <= 14 ? 'sell' : 'monitor',
                        href: 'fpl-my-team-analysis.html#draft'
                    });
                }
            }

            const checks = RD_CHECKS.map(meta => {
                const rows = out[meta.id] || [];
                const urgent = rows.some(r => r.severity === 'sell');
                return {
                    id: meta.id, column: meta.column, label: meta.label, rows,
                    state: rows.length === 0 ? 'clear' : urgent ? 'urgent' : 'warn'
                };
            });

            return { checks, summary: rdSummary(checks) };
        }

        function rdChipLabel(name) {
            return { wildcard: 'Wildcard', freehit: 'Free Hit', '3xc': 'Triple Captain', bboost: 'Bench Boost' }[name] || name;
        }

        function rdSummary(checks) {
            const total = checks.length;
            const clear = checks.filter(x => x.state === 'clear').length;
            return {
                total, clear,
                outstanding: total - clear,
                urgent: checks.filter(x => x.state === 'urgent').length,
                ready: clear === total
            };
        }

        // The rows one column should draw, in check order.
        function rdRows(checks, column) {
            return checks.filter(x => x.column === column).reduce((acc, x) => acc.concat(x.rows), []);
        }

        /* The readiness bar.

           The clock and the checklist used to be separate objects: the hero
           stated the deadline, the grid below it listed problems, and nothing
           joined them. A countdown on its own only states the problem — "two
           hours" is not useful unless you also know whether two hours is enough.
           Together they answer the actual question, which is whether you can
           stop thinking about it. */
        function rdSummaryHTML(summary, deadlineTime, now) {
            const esc = typeof escHTML === 'function' ? escHTML : (s => String(s == null ? '' : s));
            const s = summary;
            const pct = s.total ? Math.round((s.clear / s.total) * 100) : 0;
            const tone = s.ready ? 'ready' : s.urgent ? 'urgent' : 'warn';

            const headline = s.ready
                ? 'Ready for the deadline'
                : `${s.outstanding} thing${s.outstanding === 1 ? '' : 's'} to look at`;
            const sub = s.ready
                ? 'Every check passes. Nothing here needs you.'
                : `${s.clear} of ${s.total} checks clear${s.urgent ? ` · ${s.urgent} urgent` : ''}`;

            /* The countdown is a static string rather than a ticker. There is
               already one live clock on this page and a second, differently
               rounded one beside it reads as a bug rather than as detail. */
            let clock = '';
            const at = deadlineTime ? new Date(deadlineTime).getTime() : null;
            if (at != null && !isNaN(at)) {
                const left = at - (now != null ? now : Date.now());
                if (left <= 0) {
                    clock = '<span class="rd-clock closed">Deadline passed</span>';
                } else {
                    const hrs = Math.floor(left / 3600000);
                    const label = hrs >= 48 ? `${Math.floor(hrs / 24)} days`
                        : hrs >= 1 ? `${hrs}h ${Math.floor((left % 3600000) / 60000)}m`
                            : `${Math.max(1, Math.round(left / 60000))} min`;
                    clock = `<span class="rd-clock${hrs < 3 ? ' soon' : ''}">${esc(label)} to deadline</span>`;
                }
            }

            return `<div class="rd-bar ${tone}">
                <div class="rd-bar-main">
                    <span class="rd-headline">${esc(headline)}</span>
                    <span class="rd-sub">${esc(sub)}</span>
                </div>
                <div class="rd-meter" role="img" aria-label="${esc(`${s.clear} of ${s.total} checks clear`)}">
                    <span class="rd-meter-fill" style="width:${pct}%"></span>
                </div>
                ${clock}
            </div>`;
        }
