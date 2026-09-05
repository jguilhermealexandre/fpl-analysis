/* ============================================
   EasyFPL — Your market

   Who in your squad is rising and who is falling, separated and answerable at a
   glance.

   This exists because the dashboard used to answer it badly, in three ways at
   once, all of them inside the Transfers column.

   The counter disagreed with the list beneath it. "Price moves: 0" sat directly
   above two rows about players 89% and 92% of the way to a change, because the
   counter only tallied full meters while the rows were drawn from anything past
   80%. Both numbers were right by their own definition and the pair of them was
   nonsense to read.

   A rise and a fall looked identical. Both were rendered as the same amber
   "monitor" dot, so the one piece of news that is unambiguously good for a
   manager — a player you own getting more expensive — was styled exactly like
   the one that is bad. Direction is the entire point of a price move, and it
   was the one thing the row did not carry.

   And it shared a column with a different question. "Transfer him, his team's
   defence is weak" and "he is about to cost 0.1 more" are not the same kind of
   fact: one is a judgement about football that reads the same tomorrow, the
   other is a clock that runs out at the next daily update. Interleaved as
   identical rows, neither could be scanned.

   So price moves live here, direction-first, and the Transfers column goes back
   to being about transfers.

   The classification itself is not repeated — scripts/price-watch.js owns it,
   including why there are exactly two tiers and what each is allowed to claim.
   Only full meters count toward the value figure, because only they are certain.

   Prefix mk*. Classic script; no DOM work until a render is asked for.

   DEPENDENCIES: pwMovers, pwLabel, pwDetail (scripts/price-watch.js);
   escHTML (scripts/common.js).
   ============================================ */

        // A price change is always exactly 0.1 in the game.
        const MK_STEP = 0.1;
        /* Rows shown per direction. The pool is your squad and shortlist, so this
           is normally not reached — but a long shortlist during a price-change
           spree would otherwise push the rest of the dashboard off the screen,
           and the counts in the column headings stay honest either way. */
        const MK_MAX_ROWS = 6;

        /* Your squad's movers, split by direction and summarised.

           `players` is the pool to consider — the caller scopes it to the squad
           and shortlist, since a market-wide view is the ticker's job. Returns
           plain data so the summary can be asserted without rendering it. */
        function mkSquadMovers(players) {
            const empty = { risers: [], fallers: [], due: 0, closing: 0, netDue: 0, total: 0 };
            if (typeof pwMovers !== 'function') return empty;
            const m = pwMovers(players || [], 0);
            const risers = m.risers || [], fallers = m.fallers || [];

            const dueRisers = risers.filter(c => c.tier === 'due').length;
            const dueFallers = fallers.filter(c => c.tier === 'due').length;

            return {
                risers, fallers,
                due: dueRisers + dueFallers,
                closing: risers.length + fallers.length - dueRisers - dueFallers,
                /* Only full meters move tonight, so only they are counted. A
                   figure that folded in the "closing in" players would be a
                   forecast dressed as arithmetic — see price-watch.js on why the
                   game's own next-day projection flagged nineteen players to
                   catch four real changes. */
                netDue: Math.round((dueRisers - dueFallers) * MK_STEP * 10) / 10,
                total: risers.length + fallers.length
            };
        }

        function mkRow(c) {
            const rising = c.dir === 'rise';
            const from = c.player.price;
            const to = rising ? from + MK_STEP : from - MK_STEP;
            const pct = Math.min(100, Math.round(Math.abs(c.progress)));
            const label = typeof pwLabel === 'function' ? pwLabel(c) : (pct + '%');
            const detail = typeof pwDetail === 'function' ? pwDetail(c) : '';

            return `<a class="mk-row ${rising ? 'up' : 'down'}${c.tier === 'due' ? ' is-due' : ''}"
                href="fpl-my-team-analysis.html#squad?player=${c.player.id}"
                data-tooltip="${escHTML(`${c.player.name} — ${detail}`)}">
                <span class="mk-arrow" aria-hidden="true">${rising ? '▲' : '▼'}</span>
                <span class="mk-name">${escHTML(c.player.name)}</span>
                <span class="mk-price">£${from.toFixed(1)}<i>→</i>£${to.toFixed(1)}</span>
                <span class="mk-meter" aria-hidden="true"><i style="width:${pct}%"></i></span>
                <span class="mk-tag">${escHTML(label)}</span>
            </a>`;
        }

        function mkColumn(list, rising) {
            const title = rising ? 'Rising' : 'Falling';
            const why = rising
                ? 'Players you own getting more expensive. Good news: your squad value goes up, and selling later costs you nothing.'
                : 'Players you own getting cheaper. Your squad value falls, and you lose money you cannot get back.';
            if (!list.length) {
                return `<div class="mk-col ${rising ? 'up' : 'down'}">
                    <div class="mk-col-head"><span class="mk-col-t">${rising ? '▲' : '▼'} ${title}</span>
                        <span class="mk-col-n">0</span></div>
                    <div class="mk-none">Nobody in your squad is close to a ${rising ? 'rise' : 'drop'}.</div>
                </div>`;
            }
            const shown = list.slice(0, MK_MAX_ROWS);
            const hidden = list.length - shown.length;
            return `<div class="mk-col ${rising ? 'up' : 'down'}">
                <div class="mk-col-head" data-tooltip="${escHTML(why)}">
                    <span class="mk-col-t">${rising ? '▲' : '▼'} ${title}</span>
                    <span class="mk-col-n">${list.length}</span></div>
                ${shown.map(mkRow).join('')}
                ${hidden > 0 ? `<div class="mk-more">+${hidden} more</div>` : ''}
            </div>`;
        }

        function mkRenderPanel(movers) {
            const m = movers;
            if (!m || !m.total) {
                return `<div class="mk-panel">
                    <div class="mk-head"><span class="mk-title">Your market</span>
                        <span class="mk-sub">Nothing in your squad is near a price change.</span></div>
                </div>`;
            }

            /* The headline is deliberately the certain number, with the watch
               list beside it rather than folded into it. */
            const net = m.netDue;
            const netCls = net > 0 ? 'up' : net < 0 ? 'down' : 'flat';
            const netTxt = net > 0 ? `+£${net.toFixed(1)}m` : net < 0 ? `−£${Math.abs(net).toFixed(1)}m` : '£0.0m';

            return `<div class="mk-panel">
                <div class="mk-head">
                    <span class="mk-title">Your market</span>
                    ${m.due
                        ? `<span class="mk-net ${netCls}" data-tooltip="${escHTML(
                            `${m.due} of your players ${m.due === 1 ? 'has' : 'have'} a full meter, so ${m.due === 1 ? 'it changes' : 'they change'} at the next daily update. That is a net ${netTxt} to your squad value. Players merely closing in are not counted here — most of them do not move tonight.`)}">
                            ${netTxt}<em>tonight</em></span>`
                        : `<span class="mk-sub">${m.closing} closing in, none due tonight</span>`}
                    ${m.due && m.closing ? `<span class="mk-sub">${m.closing} more closing in</span>` : ''}
                </div>
                <div class="mk-cols">
                    ${mkColumn(m.risers, true)}
                    ${mkColumn(m.fallers, false)}
                </div>
            </div>`;
        }

        // Renders into a container, hiding it when there is nothing to say.
        function mkRenderInto(players, id) {
            const el = document.getElementById(id || 'v2Market');
            if (!el) return null;
            const movers = mkSquadMovers(players);
            el.innerHTML = mkRenderPanel(movers);
            el.style.display = '';
            if (typeof lucide !== 'undefined') lucide.createIcons();
            return movers;
        }
