/* ============================================
   EasyFPL — My Team Analysis
   The Gameweek Review: what actually happened to your squad in the round
   just played, as opposed to every other panel on this page, which is about
   the rounds still to come.

   Reads picksData (the squad as it was submitted for currentGW), the per-GW
   rows in players-data.json, and the event totals FPL publishes in
   bootstrap-static. Nothing here projects anything.

   Plain classic script like the rest: every function is a global, and the
   inline onclick= handlers depend on that.
   ============================================ */

        // Per-gameweek rows for one player. Returns an array because a double
        // gameweek genuinely has two, and summing them is the caller's job.
        function gwRowsFor(playerId, gw) {
            const rows = (playersDetailData?.players || []).find(p => p.id === playerId)?.history || [];
            return rows.filter(h => h.round === gw);
        }

        // Has this player's team actually played in this gameweek yet? Distinguishes
        // "did not play" from "has not played", which are different sentences.
        function gwFixturePlayed(teamId, gw) {
            const fx = (allFixtures || []).filter(f => f.event === gw &&
                (f.team_h === teamId || f.team_a === teamId));
            return fx.length > 0 && fx.every(f => f.finished_provisional);
        }

        function gwHasStarted(gw) {
            return (allFixtures || []).some(f => f.event === gw && f.finished_provisional);
        }

        // Totalled stats for a player's gameweek, or null if there is no row at all.
        function gwPlayerStats(player, gw) {
            const rows = gwRowsFor(player.id, gw);
            if (!rows.length) return null;
            const sum = k => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
            const opponents = rows.map(r => {
                const opp = teams[r.opponent_team];
                const scoreline = (r.team_h_score != null && r.team_a_score != null)
                    ? `${r.team_h_score}-${r.team_a_score}` : null;
                return {
                    name: opp?.short_name || '?',
                    home: !!r.was_home,
                    scoreline,
                    // Result from this player's perspective.
                    result: scoreline == null ? null
                        : (r.was_home ? Math.sign(r.team_h_score - r.team_a_score)
                                      : Math.sign(r.team_a_score - r.team_h_score))
                };
            });
            return {
                points: sum('total_points'), minutes: sum('minutes'), starts: sum('starts'),
                goals: sum('goals_scored'), assists: sum('assists'), bonus: sum('bonus'),
                cleanSheets: sum('clean_sheets'), goalsConceded: sum('goals_conceded'),
                saves: sum('saves'), penaltiesSaved: sum('penalties_saved'),
                penaltiesMissed: sum('penalties_missed'), ownGoals: sum('own_goals'),
                yellow: sum('yellow_cards'), red: sum('red_cards'), bps: sum('bps'),
                defCon: sum('defensive_contribution'),
                xG: sum('expected_goals'), xA: sum('expected_assists'),
                fixtures: opponents, isDouble: rows.length > 1
            };
        }

        // The one-line "what he did" used both in the review table and in the
        // player's own AI Report card.
        function gwStatPhrases(player, s) {
            const bits = [];
            if (s.goals) bits.push(`${s.goals} goal${s.goals > 1 ? 's' : ''}`);
            if (s.assists) bits.push(`${s.assists} assist${s.assists > 1 ? 's' : ''}`);
            if (player.position <= 2 && s.cleanSheets) bits.push('clean sheet');
            if (player.position === 1 && s.saves) bits.push(`${s.saves} save${s.saves > 1 ? 's' : ''}`);
            if (s.penaltiesSaved) bits.push(`${s.penaltiesSaved} penalty saved`);
            if (player.position <= 2 && !s.cleanSheets && s.goalsConceded >= 2) bits.push(`${s.goalsConceded} conceded`);
            if (s.bonus) bits.push(`${s.bonus} bonus`);
            if (s.penaltiesMissed) bits.push('penalty missed');
            if (s.ownGoals) bits.push(`${s.ownGoals} own goal${s.ownGoals > 1 ? 's' : ''}`);
            if (s.red) bits.push('sent off');
            else if (s.yellow) bits.push('booked');
            return bits;
        }

        function gwOpponentPhrase(s) {
            return s.fixtures.map(f => {
                const res = f.result === null ? '' : f.result > 0 ? ' (won)' : f.result < 0 ? ' (lost)' : ' (drew)';
                return `${f.home ? 'at home to' : 'away at'} ${escHTML(f.name)}${f.scoreline ? ` ${f.scoreline}` : ''}${res}`;
            }).join(' and ');
        }

        /* Two lines on a player's gameweek, for the inline AI Report card. Every
           other number on that card is season-to-date or a projection, so "what
           did he actually just do" had nowhere to live. */
        function gwPlayerReportLine(player, gw) {
            if (!gw || !player) return '';
            const s = gwPlayerStats(player, gw);
            const played = gwFixturePlayed(player.teamId, gw);

            if (!s || (!s.minutes && !played)) {
                const next = (teamFixtures6?.[player.teamId] || []).find(f => f.event === gw);
                return `<div class="gwr-line pending">GW${gw} — not played yet${next ? `, ${next.isHome ? 'at home to' : 'away at'} ${escHTML(next.opponent || '?')}` : ''}.</div>`;
            }
            if (!s.minutes) {
                return `<div class="gwr-line blank">GW${gw} · 0 pts — did not get on ${gwOpponentPhrase(s)}.</div>`;
            }

            const phrases = gwStatPhrases(player, s);
            const cls = s.points >= 8 ? 'haul' : s.points >= 5 ? 'good' : s.points <= 1 ? 'blank' : '';
            const mins = `${s.minutes} min${s.minutes === 1 ? '' : 's'}${s.starts ? '' : ' off the bench'}`;
            return `<div class="gwr-line ${cls}">
                <strong>GW${gw} · ${s.points} pt${s.points === 1 ? '' : 's'}</strong> — ${mins} ${gwOpponentPhrase(s)}${phrases.length ? `. ${escHTML(phrases.join(', '))}` : ''}.
                ${s.isDouble ? ' <em>Double gameweek.</em>' : ''}
            </div>`;
        }

        // ===== THE REVIEW =====

        // Only ever the gameweek picksData describes. Reviewing an earlier round
        // would pair this week's squad with last week's scores.
        function gwReviewTarget() {
            if (!picksData || !picksData.picks || !currentGW) return null;
            return gwHasStarted(currentGW) ? currentGW : null;
        }

        function buildGameweekReview() {
            const gw = gwReviewTarget();
            if (!gw) return null;

            const ev = (typeof gwEvents !== 'undefined' ? gwEvents : []).find(e => e.id === gw) || {};
            const eh = picksData.entry_history || {};
            const histRows = managerHistory?.current || [];
            const thisRow = histRows.find(r => r.event === gw) || eh;
            const prevRow = histRows.find(r => r.event === gw - 1) || null;

            const fixtures = (allFixtures || []).filter(f => f.event === gw);
            const done = fixtures.filter(f => f.finished_provisional).length;

            // Every pick, with what it actually returned.
            const entries = picksData.picks.map(pick => {
                const player = allPlayersById[pick.element];
                if (!player) return null;
                const s = gwPlayerStats(player, gw);
                const raw = s ? s.points : 0;
                return {
                    player, pick, stats: s,
                    started: pick.position <= 11,
                    multiplier: pick.multiplier,
                    raw,
                    scored: raw * (pick.multiplier || 0),
                    isCaptain: !!pick.is_captain,
                    isVice: !!pick.is_vice_captain,
                    played: gwFixturePlayed(player.teamId, gw)
                };
            }).filter(Boolean);

            const xi = entries.filter(e => e.multiplier > 0);
            const bench = entries.filter(e => e.multiplier === 0);
            const captain = entries.find(e => e.isCaptain) || null;

            // What the armband could have returned instead. Only counts players who
            // actually started for you — second-guessing against your own bench is a
            // different and less useful question.
            const capAlternatives = xi.filter(e => !e.isCaptain).sort((a, b) => b.raw - a.raw);
            const bestCapAlt = capAlternatives[0] || null;

            const ranked = [...xi].sort((a, b) => b.scored - a.scored);
            const benchRanked = [...bench].sort((a, b) => b.raw - a.raw);

            const points = thisRow.points != null ? thisRow.points : null;
            const avg = ev.average_entry_score != null ? ev.average_entry_score : null;
            const hit = thisRow.event_transfers_cost || 0;

            return {
                gw, ev, complete: done === fixtures.length, done, total: fixtures.length,
                points, avg, highest: ev.highest_score ?? null, hit,
                transfers: thisRow.event_transfers || 0,
                benchPoints: thisRow.points_on_bench || 0,
                overallRank: thisRow.overall_rank ?? null,
                prevOverallRank: prevRow?.overall_rank ?? null,
                entries, xi, bench, captain, bestCapAlt, ranked, benchRanked,
                mostCaptained: ev.most_captained ? allPlayersById[ev.most_captained] : null,
                mostCaptainedStats: ev.most_captained ? gwPlayerStats(allPlayersById[ev.most_captained] || {}, gw) : null,
                topElement: ev.top_element_info || null,
                topElementPlayer: ev.top_element_info ? allPlayersById[ev.top_element_info.id] : null
            };
        }

        // ===== RENDERING =====

        function gwrDelta(v, unit) {
            const cls = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
            return `<span class="gwr-delta ${cls}">${v > 0 ? '+' : ''}${v}${unit || ''}</span>`;
        }

        function renderGameweekReview(r) {
            if (!r) return '<div class="detail-section">No gameweek to review yet — this appears once the round has started.</div>';

            const vsAvg = (r.points != null && r.avg != null) ? r.points - r.avg : null;
            const rankMove = (r.overallRank != null && r.prevOverallRank != null)
                ? r.prevOverallRank - r.overallRank : null;

            // ---------- headline ----------
            const headline = `
            <div class="detail-section">
                ${!r.complete ? `<div class="gwr-partial">⏳ ${r.done} of ${r.total} matches played — the numbers below will still move.</div>` : ''}
                <div class="gwr-hero">
                    <div class="gwr-hero-pts">${r.points != null ? r.points : '—'}<span>pts</span></div>
                    <div class="gwr-hero-text">
                        ${vsAvg != null
                            ? `<strong>${vsAvg > 0 ? `${vsAvg} above` : vsAvg < 0 ? `${Math.abs(vsAvg)} below` : 'level with'}</strong> the average manager's ${r.avg}.`
                            : 'Average score not published yet.'}
                        ${r.highest != null ? ` The best score in the game was ${r.highest}.` : ''}
                        ${r.hit > 0 ? ` This includes a <strong>−${r.hit}</strong> point hit.` : ''}
                    </div>
                </div>
                <div class="opt-grid">
                    <div class="opt-stat"><div class="opt-stat-v">${r.points != null ? r.points : '—'}</div>
                        <div class="opt-stat-l" data-tooltip="Your score for the gameweek, after any transfer hit.">Your score</div></div>
                    <div class="opt-stat"><div class="opt-stat-v">${r.avg != null ? r.avg : '—'}</div>
                        <div class="opt-stat-l" data-tooltip="What the average FPL manager scored this gameweek.">Field average</div></div>
                    <div class="opt-stat"><div class="opt-stat-v">${r.benchPoints}</div>
                        <div class="opt-stat-l" data-tooltip="Points scored by players who were on your bench and did not come on.">Left on bench</div></div>
                    <div class="opt-stat"><div class="opt-stat-v">${rankMove != null ? (rankMove > 0 ? '▲' : rankMove < 0 ? '▼' : '–') : '—'}</div>
                        <div class="opt-stat-l" data-tooltip="${rankMove != null ? `Overall rank moved from ${r.prevOverallRank.toLocaleString()} to ${r.overallRank.toLocaleString()}.` : 'Overall rank movement is published once the round settles.'}">${rankMove != null ? Math.abs(rankMove).toLocaleString() : 'Rank'}</div></div>
                </div>
            </div>`;

            // ---------- captaincy ----------
            let capHtml;
            if (!r.captain) {
                capHtml = '<div class="opt-empty">No captain recorded for this gameweek.</div>';
            } else {
                const c = r.captain;
                const mult = c.multiplier || 2;
                const alt = r.bestCapAlt;
                const regret = alt ? (alt.raw - c.raw) * mult : 0;
                capHtml = `
                    <div class="gwr-cap ${regret > 0 ? 'miss' : 'hit'}">
                        <div class="gwr-cap-main">
                            <span class="gwr-cap-name">👑 ${escHTML(c.player.name)}</span>
                            <span class="gwr-cap-pts">${c.raw} × ${mult} = <strong>${c.scored}</strong></span>
                        </div>
                        <div class="gwr-cap-why">
                            ${c.stats && c.stats.minutes
                                ? `${c.stats.minutes} minutes ${gwOpponentPhrase(c.stats)}${gwStatPhrases(c.player, c.stats).length ? `, ${escHTML(gwStatPhrases(c.player, c.stats).join(', '))}` : ''}.`
                                : c.played ? 'Did not get on the pitch.' : 'Has not played yet.'}
                            ${alt && regret > 0
                                ? ` The armband on <strong>${escHTML(alt.player.name)}</strong> (${alt.raw}) would have been worth <strong>${regret}</strong> more.`
                                : alt ? ` Nobody else in your eleven beat him — the best alternative was ${escHTML(alt.player.name)} on ${alt.raw}.` : ''}
                        </div>
                    </div>
                    ${r.mostCaptained ? `<div class="opt-why">The field's most-captained pick was <strong>${escHTML(r.mostCaptained.name)}</strong>${r.mostCaptainedStats ? `, who returned ${r.mostCaptainedStats.points}` : ''}${r.mostCaptained.id === r.captain.player.id ? ' — you were with the crowd.' : ' — you went a different way.'}</div>` : ''}`;
            }

            // ---------- who delivered ----------
            const row = e => {
                const s = e.stats;
                const phrases = s ? gwStatPhrases(e.player, s) : [];
                const cls = e.scored >= 10 ? 'haul' : e.scored >= 6 ? 'good' : e.scored <= 1 ? 'blank' : '';
                return `<div class="gwr-row ${cls}">
                    <span class="position-badge ${POSITION_CONFIG[e.player.position].class}">${POSITION_CONFIG[e.player.position].short}</span>
                    <span class="gwr-row-name">${e.isCaptain ? '👑 ' : e.isVice ? '🅥 ' : ''}${escHTML(e.player.name)}</span>
                    <span class="gwr-row-opp">${s && s.fixtures.length ? s.fixtures.map(f => `${escHTML(f.name)}${f.home ? ' (H)' : ' (A)'}`).join(', ') : '—'}</span>
                    <span class="gwr-row-mins">${s ? s.minutes : 0}'</span>
                    <span class="gwr-row-detail">${phrases.length ? escHTML(phrases.join(', ')) : (s && s.minutes ? 'no returns' : e.played ? 'did not play' : 'yet to play')}</span>
                    <span class="gwr-row-pts">${e.scored}${e.multiplier > 1 ? `<em>×${e.multiplier}</em>` : ''}</span>
                </div>`;
            };

            const best = r.ranked[0], worst = [...r.ranked].reverse().find(e => e.played);
            const deliveredHtml = `
                ${best ? `<div class="opt-why">Your best return was <strong>${escHTML(best.player.name)}</strong> on ${best.scored}${worst && worst.player.id !== best.player.id ? `, and the quietest starter who actually played was <strong>${escHTML(worst.player.name)}</strong> on ${worst.scored}` : ''}.</div>` : ''}
                <div class="gwr-rows">${r.ranked.map(row).join('')}</div>`;

            // ---------- bench ----------
            const autoSubbed = r.bench.filter(e => e.multiplier > 0);
            const benchHtml = `
                <div class="opt-why">
                    ${r.benchPoints > 0
                        ? `You left <strong>${r.benchPoints}</strong> point${r.benchPoints === 1 ? '' : 's'} on the bench.`
                        : 'Nothing was wasted on the bench.'}
                    ${autoSubbed.length ? ` ${autoSubbed.length} auto-substitution${autoSubbed.length === 1 ? '' : 's'} came on for you.` : ''}
                </div>
                <div class="gwr-rows">${r.benchRanked.map(row).join('')}</div>`;

            // ---------- the week in the game ----------
            const fieldHtml = `
                <div class="opt-why">
                    The average manager scored <strong>${r.avg != null ? r.avg : '—'}</strong>${r.highest != null ? ` and the best score in the world was <strong>${r.highest}</strong>` : ''}.
                    ${r.topElementPlayer && r.topElement ? ` The highest-scoring player was <strong>${escHTML(r.topElementPlayer.name)}</strong> on ${r.topElement.points}${r.entries.some(e => e.player.id === r.topElement.id) ? ' — and you owned him.' : ', who you did not own.'}` : ''}
                    ${r.transfers ? ` You made ${r.transfers} transfer${r.transfers === 1 ? '' : 's'}${r.hit ? ` for a ${r.hit}-point hit` : ' for free'}.` : ' You made no transfers.'}
                </div>
                ${(r.ev.chip_plays || []).length ? `<div class="gwr-chips">${r.ev.chip_plays.map(c =>
                    `<span class="gwr-chip"><strong>${(c.num_played || 0).toLocaleString()}</strong> ${escHTML({ bboost: 'Bench Boost', freehit: 'Free Hit', wildcard: 'Wildcard', '3xc': 'Triple Captain' }[c.chip_name] || c.chip_name)}</span>`).join('')}</div>` : ''}`;

            return `
            ${headline}
            <div class="detail-section">
                <div class="detail-section-title">👑 The armband</div>
                ${capHtml}
            </div>
            <div class="detail-section">
                <div class="detail-section-title">📋 Who delivered</div>
                ${deliveredHtml}
            </div>
            <div class="detail-section">
                <div class="detail-section-title">🪑 The bench</div>
                ${benchHtml}
            </div>
            <div class="detail-section">
                <div class="detail-section-title">🌍 The week in the game</div>
                ${fieldHtml}
            </div>`;
        }

        function openGameweekReview() {
            const r = buildGameweekReview();
            const title = document.getElementById('optReportTitle');
            if (title) title.textContent = `📊 Gameweek ${r ? r.gw : currentGW} review`;
            document.getElementById('optReportBody').innerHTML = renderGameweekReview(r);
            document.getElementById('optReportOverlay').classList.add('show');
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
