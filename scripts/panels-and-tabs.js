/* ============================================
   EasyFPL — My Team Analysis
   Side panels (transfer replacements, fixture calendar and rotation,
   player detail), tab switching, the news tab, the AI Scouting Report
   adapter, and the team xG engine.

   Extracted from the inline <script> in fpl-my-team-analysis.html.
   These files are plain classic scripts loaded in order, not ES modules:
   every function stays a global, which the inline onclick= handlers
   throughout the markup depend on. Load order is preserved from the
   original file — team-analysis-core.js must come first, since the
   settings IIFE in lineup-wizard.js reads DEFAULT_SETTINGS from it.
   ============================================ */

        // ===== TRANSFER SIDE PANEL (Phase 3) =====
        // Reuses the same slide-out shell the fixture panel also uses (#detailOverlay/
        // #detailPanel), just populated with transfer-focused content instead — driven
        // by the Transfer
        // Wizard's actual scoring engine (calculateTransferScore via findTransferCandidates),
        // not the lighter findReplacements() formula used by Phase 2's inline quick-list.
        // Hands the pick over to the Transfer Wizard rather than duplicating its
        // budget and team-limit rules here: stage the sale, aim the active slot at
        // it, and open the wizard already showing the comparison.
        function planTransferFromPanel(outId, inId) {
            const out = selectedPlayers.find(p => p.id === outId);
            const candidate = allPlayersById[inId] || allPlayers.find(p => p.id === inId);
            if (!out || !candidate) return;

            closeDetailPanel();
            // Open the wizard BEFORE staging: its first render replaces transferState
            // wholesale, so anything staged ahead of it is silently discarded.
            switchTab('transfer');

            let slotIdx = transferState.pending.findIndex(s => s.soldPlayer.id === outId);
            if (slotIdx < 0) {
                if (transferState.pending.length >= 5) {
                    updateStatus('Your transfer plan already has 5 slots', 'error');
                    return;
                }
                transferState.pending.push({ soldPlayer: out, replacement: null });
                slotIdx = transferState.pending.length - 1;
            }
            transferState.activeSlot = slotIdx;
            transferState.previewPlayer = candidate;
            transferState.mode = 'compare';

            // Staging after the render means these have to be refreshed by hand.
            renderTWAll();
        }

        // The three numbers worth reading at a glance for each position: current
        // form, the metric that position actually gets paid for, and minutes —
        // the rest stays one click away in the comparison rather than crowding
        // every card with seven labelled rows.
        function headlineStatsFor(cols, position) {
            const headline = position === 4 ? cols.stat4 : cols.stat3;   // FWD stat3 is a season total, stat4 the rate
            return [cols.form, headline, cols.stat6];
        }

        function renderFixtureChip(fx) {
            if (!fx) return '<span class="rc-fixture fdr-0">No fixture</span>';
            const words = { 1: 'Very easy', 2: 'Easy', 3: 'Average', 4: 'Hard', 5: 'Very hard' };
            return `<span class="rc-fixture fdr-${fx.difficulty}" data-tooltip="GW${fx.event}: ${fx.isHome ? 'home to' : 'away at'} ${escHTML(fx.opponent)} — FDR ${fx.difficulty} (${words[fx.difficulty] || 'Average'})">${escHTML(fx.opponent)} (${fx.isHome ? 'H' : 'A'})</span>`;
        }

        function openTransferPanel(playerId) {
            const analysis = analysisResults.find(a => a.player.id === playerId);
            if (!analysis) return;
            const { player } = analysis;
            const bank = (picksData?.entry_history?.bank || 0) / 10;
            const sellPrice = player.sellPrice || player.price;
            const maxPrice = sellPrice + bank;
            const excludeIds = new Set(selectedPlayers.map(p => p.id));
            const candidates = findTransferCandidates(player.position, maxPrice, excludeIds).slice(0, 10);

            // computePlayerStatColumns() reads player.avgFDR, which analyzePlayer() only
            // sets for players in YOUR squad — candidates come straight from allPlayers,
            // so derive it here or every candidate would show a flat placeholder 3.0.
            candidates.forEach(c => {
                if (c.avgFDR == null) {
                    const fx = (teamFixtures[c.teamId] || c.fixtures || []).slice(0, 5);
                    c.avgFDR = fx.length
                        ? fx.reduce((s, f) => s + (f.difficulty || 3), 0) / fx.length
                        : 3;
                }
            });

            document.getElementById('detailPanel').dataset.playerId = playerId;
            document.getElementById('detailPlayerName').textContent = `Replace ${player.name}`;
            document.getElementById('detailPlayerMeta').innerHTML = `
                <span class="position-badge ${POSITION_CONFIG[player.position].class}">${POSITION_CONFIG[player.position].short}</span>
                Budget £${maxPrice.toFixed(1)}m (sell £${sellPrice.toFixed(1)}m + bank £${bank.toFixed(1)}m)
            `;

            // The player being replaced, kept on screen as the thing every candidate
            // is being judged against — otherwise the numbers below have no anchor.
            const outCols = computePlayerStatColumns(player);
            const outXP = predictedGWPoints(player);
            const outFixtures = player.fixtures || teamFixtures[player.teamId] || [];

            let html = `
            <div class="tp-benchmark">
                <div class="tp-benchmark-label">Replacing</div>
                <div class="tp-benchmark-main">
                    <span class="tp-benchmark-name">${escHTML(player.name)}</span>
                    <span class="tp-benchmark-team">${escHTML(player.team)}</span>
                    <span class="tp-benchmark-price">£${sellPrice.toFixed(1)}m</span>
                </div>
                <div class="tp-benchmark-stats">
                    <span class="rc-pill" data-tooltip="${escHTML(outCols.form.tip)}">${escHTML(outCols.form.label)} <strong>${escHTML(String(outCols.form.value))}</strong></span>
                    <span class="rc-pill" data-tooltip="Projected points for the upcoming gameweek — the figure every candidate below is compared against.">xP <strong>${outXP.toFixed(1)}</strong></span>
                    ${renderFixtureChip(outFixtures[0])}
                </div>
            </div>

            <div class="detail-section">
                <div class="tp-head">
                    <span class="tp-head-title">⚡ AI-ranked replacements <span class="tp-head-budget">≤ £${maxPrice.toFixed(1)}m</span></span>
                    <span class="tp-head-info" data-tooltip="Ranked by the same engine as the Transfer Wizard: recency-weighted form, fixture-adjusted opponent matchup and team context. Tick players to build an AI Scouting Report.">ℹ️</span>
                </div>`;

            if (!candidates.length) {
                html += `<div class="tw-market-empty">No affordable candidates found at this position right now.</div>`;
            } else {
                html += candidates.map((c, i) => {
                    const teamName = c.team || teams[c.teamId]?.short_name || '';
                    const nextF = (teamFixtures[c.teamId] || c.fixtures || [])[0];
                    const cols = computePlayerStatColumns(c);

                    // Both sides use predictedGWPoints so this delta matches the xP on
                    // the pitch cards and in the optimizer. ep_next regresses toward the
                    // mean and would disagree with every other number on the page.
                    const delta = predictedGWPoints(c) - outXP;
                    const better = delta > 0.05;
                    const worse = delta < -0.05;
                    const deltaCls = better ? 'good' : worse ? 'bad' : 'flat';
                    const deltaText = better ? `▲ +${delta.toFixed(1)}` : worse ? `▼ ${delta.toFixed(1)}` : '±0.0';

                    const pills = headlineStatsFor(cols, c.position)
                        .map(s => `<span class="rc-pill" data-tooltip="${escHTML(s.tip)}">${escHTML(s.label)} <strong>${escHTML(String(s.value))}</strong></span>`).join('');

                    return `<div class="rc-card" data-compare-row>
                        <div class="rc-top">
                            <input type="checkbox" class="compare-checkbox" data-player-id="${c.id}" onclick="event.stopPropagation()" onchange="onCompareCheckboxChange(${c.id})" data-tooltip="Add to the AI Scouting Report">
                            <span class="rc-rank">${i + 1}</span>
                            <span class="rc-name">${escHTML(c.name)}</span>
                            <span class="rc-team">${escHTML(teamName)}</span>
                            <span class="rc-price">£${c.price.toFixed(1)}m ${priceChangeBadge(c)}</span>
                        </div>
                        <div class="rc-mid">
                            <span class="rc-score" data-tooltip="AI Transfer Score — the engine's overall ranking of this candidate for your squad. Higher is better; it is a ranking, not a points prediction.">${(c._transferScore || 0).toFixed(0)} <span class="rc-score-unit">score</span></span>
                            <span class="rc-delta ${deltaCls}" data-tooltip="Projected points for the coming gameweek: ${predictedGWPoints(c).toFixed(1)} xP against ${escHTML(player.name)}'s ${outXP.toFixed(1)} xP.">${deltaText} xP</span>
                            ${renderFixtureChip(nextF)}
                        </div>
                        <div class="rc-pills">${pills}</div>
                        <div class="rc-actions">
                            <button class="rc-btn" onclick="event.stopPropagation(); openPairCompare(${player.id}, ${c.id})">Compare</button>
                            <button class="rc-btn primary" onclick="event.stopPropagation(); planTransferFromPanel(${player.id}, ${c.id})">Plan transfer</button>
                        </div>
                    </div>`;
                }).join('');
            }
            html += `</div>
            <div class="detail-section">
                <button class="btn btn-secondary" style="width:100%;" onclick="closeDetailPanel(); switchTab('transfer');">Build a full transfer plan in Transfer Wizard →</button>
            </div>`;

            document.getElementById('detailBody').innerHTML = html;
            document.getElementById('detailOverlay').classList.add('show');
            if (typeof lucide !== 'undefined') lucide.createIcons();
            // Reflect any already-selected players (and disable the rest once the
            // compare list is full) on the checkboxes we just rendered.
            if (typeof onCompareSelectionChange === 'function') onCompareSelectionChange();
        }

        // ===== FIXTURE / CALENDAR SIDE PANEL =====
        // Same read of the schedule the Teams Analysis calendar gives you — per
        // gameweek opponent, venue and FDR, with blanks and doubles called out —
        // narrowed to the one team, and driven off allFixtures so it isn't capped
        // at the 5 chips the row shows.
        const FIXTURE_PANEL_GWS = 10;

        // ===== FIXTURE PANEL: calendar, rotation and pivot analysis =====
        let fixturePanelPlayerId = null;
        let fixtureCompareTeamId = null;

        // One team's remaining schedule, grouped by gameweek so a GW holding two
        // entries reads as a double and a GW holding none reads as a blank.
        // skipPlayed advances past gameweeks this team has already completed. The
        // comparison and rotation calendars pass false and start from the primary
        // team's first gameweek instead: two teams can be a gameweek apart on
        // whether they have played yet, and lining them up by array position
        // rather than by gameweek would compare different weeks to each other.
        function getTeamFixtureCalendar(teamId, startGW, count, skipPlayed) {
            const byGW = {};
            (allFixtures || []).forEach(f => {
                if (f.event == null || f.finished_provisional) return;
                if (f.team_h !== teamId && f.team_a !== teamId) return;
                const isHome = f.team_h === teamId;
                (byGW[f.event] = byGW[f.event] || []).push({
                    opponentId: isHome ? f.team_a : f.team_h,
                    opponent: teams[isHome ? f.team_a : f.team_h]?.short_name || '???',
                    isHome,
                    difficulty: (isHome ? f.team_h_difficulty : f.team_a_difficulty) || 3
                });
            });
            // Only unfinished fixtures were kept above, so a leading gameweek with
            // nothing in it is one the team has already played — not a blank. Skip
            // those, but keep genuine future blanks, which a manager must see.
            const played = new Set();
            (allFixtures || []).forEach(f => {
                if (f.event == null || !f.finished_provisional) return;
                if (f.team_h === teamId || f.team_a === teamId) played.add(f.event);
            });
            let first = startGW;
            if (skipPlayed !== false) {
                while (first <= 38 && played.has(first) && !byGW[first]) first++;
                if (first > 38) first = startGW;
            }

            const out = [];
            for (let gw = first; gw < first + count && gw <= 38; gw++) {
                out.push({ gw, list: byGW[gw] || [] });
            }
            return out;
        }

        // Mean FDR across a slice. Blanks are skipped rather than scored as 3:
        // a missing match is not an average one, and counting it as average would
        // make a blank run look playable.
        function calendarAvgFdr(cal, from, to) {
            const fx = cal.slice(from, to).flatMap(e => e.list);
            if (!fx.length) return null;
            return fx.reduce((s, f) => s + f.difficulty, 0) / fx.length;
        }

        // How leaky each defence is, ranked across the league. A raw "concedes 1.8"
        // means little until you know whether that is 3rd worst or mid-table, which
        // is the thing that decides whether an opponent is a good one to face.
        function getDefensiveRanks() {
            const ids = Object.keys(teams).map(k => parseInt(k, 10))
                .filter(id => teamAnalysis[id]);
            // Ascending defensive power: rank 1 is the leakiest defence to attack.
            const ordered = ids.slice().sort((a, b) =>
                (teamAnalysis[a].defensePower || 0) - (teamAnalysis[b].defensePower || 0));
            const rank = {};
            ordered.forEach((id, i) => { rank[id] = i + 1; });
            return { rank, total: ordered.length };
        }

        function ordinal(n) {
            const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
            return n + (s[(v - 20) % 10] || s[v] || s[0]);
        }

        // What a given fixture means for the attacking side: how leaky the opponent
        // is, and a rough goal expectation from both teams' rates.
        // Three matches is the point where a per-game rate stops being one result.
        const RATE_MIN_MATCHES = 3;

        function opponentContext(teamId, fx, ranks) {
            if (!fx) return null;
            const oppTA = teamAnalysis[fx.opponentId];
            const myTA = teamAnalysis[teamId];
            if (!oppTA || !oppTA.matchesPlayed) return null;

            const conceded = oppTA.avgConceded || 0;
            // A league rank off one match is noise dressed as insight — a side that
            // shipped four in the opener is not "the leakiest defence in the league".
            const ranked = oppTA.matchesPlayed >= RATE_MIN_MATCHES;
            const myGoals = myTA && myTA.matchesPlayed ? myTA.avgGoals : conceded;
            return {
                conceded,
                matches: oppTA.matchesPlayed,
                ranked,
                rank: ranked ? ranks.rank[fx.opponentId] : null,
                total: ranks.total,
                // Cheap but standard estimator: blend what this attack scores with
                // what that defence concedes, rather than pretending to a Poisson model.
                expGoals: ranked ? (myGoals + conceded) / 2 : null
            };
        }

        function fdrBand(v) {
            if (v == null) return { cls: 'none', word: 'No fixtures' };
            if (v <= 2.2) return { cls: 'great', word: 'Very kind' };
            if (v <= 2.7) return { cls: 'good', word: 'Favourable' };
            if (v <= 3.3) return { cls: 'ok', word: 'Average' };
            if (v <= 3.8) return { cls: 'bad', word: 'Tough' };
            return { cls: 'awful', word: 'Brutal' };
        }

        // What this particular player stands to get from a given fixture. A
        // goalkeeper's schedule is a clean-sheet question; a forward's is a
        // chance-creation one, so the column changes with the position.
        // Takes the fixture itself where the caller has one, so the opponent's own
        // ratings drive both figures — the same input the projection uses. A bare
        // difficulty still works and still falls back to the FDR-only estimate.
        function playerFixtureMetric(player, fixtureOrFdr) {
            const fixture = (fixtureOrFdr && typeof fixtureOrFdr === 'object') ? fixtureOrFdr : null;
            const fdr = fixture ? (fixture.difficulty || 3) : (fixtureOrFdr || 3);
            const ref = fixture || fdr;
            if (player.position <= 2) {
                const pct = Math.round(cleanSheetProbFor(player.teamId, ref) * 100);
                return {
                    value: `${pct}%`,
                    cls: pct >= 35 ? 'great' : pct >= 25 ? 'good' : pct >= 15 ? 'ok' : 'bad',
                    tip: `Estimated ${pct}% chance of a clean sheet, from ${escHTML(player.team)}'s goals conceded and defensive rating against a difficulty-${fdr} opponent.`
                };
            }
            const { xg90, xa90 } = regressedPer90(player);
            const { min90 } = expectedMinutesModel(player);
            const xgi = (xg90 + xa90) * min90 * fixtureAttackAdj(ref);
            return {
                value: xgi.toFixed(2),
                cls: xgi >= 0.55 ? 'great' : xgi >= 0.38 ? 'good' : xgi >= 0.22 ? 'ok' : 'bad',
                tip: `Projected ${xgi.toFixed(2)} expected goal involvements in this match, from ${escHTML(player.name)}'s per-90 rate, expected minutes, and a difficulty-${fdr} opponent.`
            };
        }

        // Which other club's schedule best covers this one's hard weeks. For each
        // gameweek only the easier of the two fixtures counts, since that is the
        // one a rotating manager would actually start.
        function findRotationPartners(teamId, startGW, count, limit) {
            const mine = getTeamFixtureCalendar(teamId, startGW, count);
            const soloAvg = calendarAvgFdr(mine, 0, mine.length);
            const from = mine.length ? mine[0].gw : startGW;
            const out = [];

            Object.keys(teams).forEach(key => {
                const otherId = parseInt(key, 10);
                if (otherId === teamId) return;
                const theirs = getTeamFixtureCalendar(otherId, from, mine.length, false);
                let sum = 0, n = 0;
                mine.forEach((entry, i) => {
                    const a = entry.list[0], b = (theirs[i] || {}).list?.[0];
                    const best = a && b ? Math.min(a.difficulty, b.difficulty) : (a || b || {}).difficulty;
                    if (best != null) { sum += best; n++; }
                });
                if (!n) return;
                out.push({
                    teamId: otherId,
                    short: teams[otherId]?.short_name || '???',
                    name: teams[otherId]?.name || teams[otherId]?.short_name || '???',
                    combined: sum / n,
                    gain: soloAvg != null ? soloAvg - (sum / n) : 0
                });
            });

            out.sort((a, b) => a.combined - b.combined);
            return { soloAvg, partners: out.slice(0, limit || 2) };
        }

        // A pivot is where one schedule turns hard just as the other turns kind —
        // the gameweek to move between them. Compares the three weeks either side.
        function detectPivotWindow(calA, calB) {
            const at = (cal, i) => (cal[i] && cal[i].list[0]) ? cal[i].list[0].difficulty : null;
            const mean = arr => { const v = arr.filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

            for (let i = 2; i <= calA.length - 3; i++) {
                const beforeA = mean([at(calA, i - 2), at(calA, i - 1)]);
                const afterA = mean([at(calA, i), at(calA, i + 1), at(calA, i + 2)]);
                const beforeB = mean([at(calB, i - 2), at(calB, i - 1)]);
                const afterB = mean([at(calB, i), at(calB, i + 1), at(calB, i + 2)]);
                if (beforeA == null || afterA == null || beforeB == null || afterB == null) continue;
                if (afterA - beforeA > 0.5 && beforeB - afterB > 0.5) {
                    return { gw: calA[i].gw, worsening: 'A', improving: 'B' };
                }
                if (afterB - beforeB > 0.5 && beforeA - afterA > 0.5) {
                    return { gw: calA[i].gw, worsening: 'B', improving: 'A' };
                }
            }
            return null;
        }

        function openFixturePanel(playerId) {
            fixturePanelPlayerId = playerId;
            fixtureCompareTeamId = null;
            renderFixturePanel();
            document.getElementById('detailOverlay').classList.add('show');
        }

        function setFixtureCompare(value) {
            fixtureCompareTeamId = value ? parseInt(value, 10) : null;
            renderFixturePanel();
        }

        function autoCompareBestRotation() {
            const analysis = analysisResults.find(a => a.player.id === fixturePanelPlayerId);
            if (!analysis) return;
            const { partners } = findRotationPartners(analysis.player.teamId, currentGW || 1, FIXTURE_PANEL_GWS, 1);
            if (partners.length) {
                fixtureCompareTeamId = partners[0].teamId;
                renderFixturePanel();
            }
        }

        function fxChip(f, opts) {
            if (!f) return `<span class="fx-chip fdr-0">Blank</span>`;
            const o = opts || {};
            let tip = `${f.isHome ? 'Home to' : 'Away at'} ${escHTML(f.opponent)} — FDR ${f.difficulty}.`;
            // The numbers behind the colour: how leaky that defence is, and roughly
            // how many goals this fixture projects.
            const ctx = o.teamId != null && o.ranks ? opponentContext(o.teamId, f, o.ranks) : null;
            if (ctx && ctx.ranked) {
                tip += ` ${escHTML(f.opponent)} concede ${ctx.conceded.toFixed(1)} per game (${ordinal(ctx.rank)} leakiest of ${ctx.total}). Projects around ${ctx.expGoals.toFixed(1)} goals.`;
            } else if (ctx) {
                tip += ` ${escHTML(f.opponent)} have conceded ${Math.round(ctx.conceded * ctx.matches)} in ${ctx.matches} ${ctx.matches === 1 ? 'match' : 'matches'} — too early to rank.`;
            }
            return `<span class="fx-chip fdr-${f.difficulty} ${o.extraClass || ''}"
                data-tooltip="${tip}">${escHTML(f.opponent)} <span class="fx-chip-venue">${f.isHome ? 'H' : 'A'}</span></span>`;
        }

        function renderFixturePanel() {
            const analysis = analysisResults.find(a => a.player.id === fixturePanelPlayerId);
            if (!analysis) return;
            const { player } = analysis;
            const teamId = player.teamId;
            const startGW = currentGW || 1;
            const isDefensive = player.position <= 2;
            const teamName = (teams[teamId] && teams[teamId].name) || player.team;

            const ranks = getDefensiveRanks();
            const ta = teamAnalysis[teamId];

            // The side of the team that actually pays this player: a keeper lives off
            // the defence, a forward off the attack. Home and away are split out
            // because most sides are markedly better at one than the other.
            let ratingStrip = '';
            if (ta && ta.matchesPlayed > 0) {
                const rating = isDefensive ? ta.defensePower : ta.attackPower;
                const rateWord = rating >= 70 ? 'Strong' : rating >= 55 ? 'Solid' : rating >= 40 ? 'Average' : 'Weak';
                const rateCls = rating >= 70 ? 'great' : rating >= 55 ? 'good' : rating >= 40 ? 'ok' : 'bad';
                const perGame = isDefensive ? ta.avgConceded : ta.avgGoals;
                const played = ta.matchesPlayed;
                const enoughToRank = played >= RATE_MIN_MATCHES;

                // The home/away ratings fall back to the overall one when a side
                // hasn't played at that venue yet, so showing them then would invent
                // a split out of two copies of the same number.
                const splitReal = (ta.homeGames || 0) > 0 && (ta.awayGames || 0) > 0;
                const home = isDefensive ? ta.defensePowerHome : ta.attackPowerHome;
                const away = isDefensive ? ta.defensePowerAway : ta.attackPowerAway;

                const tightestRank = ranks.total - ranks.rank[teamId] + 1;
                const totalFor = isDefensive ? Math.round((ta.avgConceded || 0) * played) : Math.round((ta.avgGoals || 0) * played);

                ratingStrip = `<div class="fx-rating">
                    <div class="fx-rating-main">
                        <span class="fx-rating-label">${escHTML(teamName)} ${isDefensive ? 'defence' : 'attack'}</span>
                        <span class="fx-rating-value ${rateCls}" data-tooltip="${isDefensive
                            ? `Defensive rating out of 100, from goals conceded and FPL's own defensive strength.${enoughToRank ? ` ${escHTML(teamName)} rank ${ordinal(tightestRank)} tightest of ${ranks.total}.` : ''}`
                            : `Attacking rating out of 100, from goals scored and FPL's own attacking strength.`}">${rating}</span>
                        <span class="fx-rating-word">${rateWord}</span>
                        <span class="fx-rating-sample">${played} ${played === 1 ? 'match' : 'matches'} played</span>
                    </div>
                    <div class="fx-rating-splits">
                        ${splitReal
                            ? `<span data-tooltip="Rating across the ${ta.homeGames} ${ta.homeGames === 1 ? 'match' : 'matches'} played at home.">Home <strong>${home}</strong></span>
                               <span data-tooltip="Rating across the ${ta.awayGames} ${ta.awayGames === 1 ? 'match' : 'matches'} played away.">Away <strong>${away}</strong></span>`
                            : `<span data-tooltip="A home/away split needs at least one match at each venue; ${escHTML(teamName)} have only played ${(ta.homeGames || 0) > 0 ? 'at home' : 'away'} so far.">Home/away split <strong>—</strong></span>`}
                        <span data-tooltip="${isDefensive ? 'Goals conceded' : 'Goals scored'} across ${played} ${played === 1 ? 'match' : 'matches'}.">${isDefensive ? 'Conceded' : 'Scored'} <strong>${totalFor}</strong>${enoughToRank ? ` <span class="fx-rating-rate">(${(perGame || 0).toFixed(1)}/game)</span>` : ''}</span>
                        ${isDefensive ? `<span data-tooltip="Clean sheets in ${played} ${played === 1 ? 'match' : 'matches'}.">Clean sheets <strong>${ta.totalCS || 0}</strong></span>` : ''}
                    </div>
                </div>`;
            }

            const cal = getTeamFixtureCalendar(teamId, startGW, FIXTURE_PANEL_GWS);
            const near = calendarAvgFdr(cal, 0, 3);
            const long = calendarAvgFdr(cal, 3, cal.length);
            const nearBand = fdrBand(near), longBand = fdrBand(long);

            // Split cards: the next three weeks are a team-selection question, the
            // rest is a transfer-planning one, and averaging them together hides
            // exactly the shift a manager needs to see.
            const splitCards = `
            <div class="fx-split">
                <div class="fx-split-card ${nearBand.cls}">
                    <div class="fx-split-label">Next 3 GWs</div>
                    <div class="fx-split-value">${near != null ? near.toFixed(1) : '—'}</div>
                    <div class="fx-split-word">${nearBand.word}</div>
                </div>
                <div class="fx-split-arrow">→</div>
                <div class="fx-split-card ${longBand.cls}">
                    <div class="fx-split-label">GW${cal[3] ? cal[3].gw : startGW + 3}–${cal[cal.length - 1].gw}</div>
                    <div class="fx-split-value">${long != null ? long.toFixed(1) : '—'}</div>
                    <div class="fx-split-word">${longBand.word}</div>
                </div>
            </div>`;

            // Turn the swing into an instruction. "FDR 2.7 → 3.3" is a fact; what
            // the manager needs is whether to hold, rotate or sell.
            let adviceHtml = '';
            const swingDelta = (near != null && long != null) ? long - near : 0;
            if (near != null && long != null && Math.abs(swingDelta) >= 0.4) {
                const hardening = swingDelta > 0;
                const turnGW = cal[3] ? cal[3].gw : startGW + 3;
                const worstRun = cal.slice(3, 6).flatMap(e => e.list).map(f => f.opponent).filter(Boolean);
                adviceHtml = `<div class="fx-advice ${hardening ? 'bad' : 'good'}">
                    <div class="fx-advice-head">${hardening ? '🔴 Schedule hardens from GW' + turnGW : '🟢 Schedule eases from GW' + turnGW}</div>
                    <div class="fx-advice-body">${hardening
                        ? `Start ${escHTML(player.name)} through GW${turnGW - 1}, then rotate or move them on${worstRun.length ? ` — ${escHTML(worstRun.join(', '))} follow` : ''}.`
                        : `Hold through the tougher opening; ${escHTML(player.name)} becomes a stronger hold from GW${turnGW}.`}</div>
                </div>`;
            }

            const metricHead = isDefensive ? 'Clean sheet' : 'xGI';
            const rows = cal.map(entry => {
                if (!entry.list.length) {
                    return `<div class="fx-row blank">
                        <span class="fx-row-gw">GW${entry.gw}</span>
                        <span class="fx-row-fixtures"><span class="fx-chip fdr-0">Blank gameweek</span></span>
                        <span class="fx-row-metric">—</span>
                    </div>`;
                }
                const chips = entry.list.map(f => fxChip(f, { teamId, ranks })).join('') + (entry.list.length > 1 ? '<span class="fx-double">Double</span>' : '');
                // A double gameweek is two shots at the metric, so take the best
                // fixture's value rather than the first listed.
                const best = entry.list.reduce((a, b) => (b.difficulty < a.difficulty ? b : a));
                const m = playerFixtureMetric(player, best);
                return `<div class="fx-row">
                    <span class="fx-row-gw">GW${entry.gw}</span>
                    <span class="fx-row-fixtures">${chips}</span>
                    <span class="fx-row-metric ${m.cls}" data-tooltip="${escHTML(m.tip)}">${m.value}</span>
                </div>`;
            }).join('');

            // Rotation only makes sense where managers actually rotate: cheap
            // keepers and defenders, whose returns hinge on the clean sheet.
            let rotationHtml = '';
            if (isDefensive) {
                const { soloAvg, partners } = findRotationPartners(teamId, startGW, FIXTURE_PANEL_GWS, 2);
                if (partners.length && soloAvg != null) {
                    rotationHtml = `<div class="detail-section">
                        <div class="detail-section-title">🔄 Best rotation partners</div>
                        <div class="fx-rot-note">Starting whichever has the kinder fixture each week, over the next ${cal.length} gameweeks.</div>
                        ${partners.map(pt => `<div class="fx-rot">
                            <span class="fx-rot-team">${escHTML(pt.name)}</span>
                            <span class="fx-rot-fdr">${pt.combined.toFixed(1)} FDR</span>
                            <span class="fx-rot-gain ${pt.gain > 0.15 ? 'good' : 'flat'}">${pt.gain > 0 ? `−${pt.gain.toFixed(1)} vs ${escHTML(player.team)} alone` : 'No gain'}</span>
                            <button class="rc-btn" onclick="setFixtureCompare(${pt.teamId})">Compare</button>
                        </div>`).join('')}
                    </div>`;
                }
            }

            const teamOptions = Object.keys(teams)
                .map(k => parseInt(k, 10))
                .filter(id => id !== teamId)
                .sort((a, b) => (teams[a].short_name || '').localeCompare(teams[b].short_name || ''))
                .map(id => `<option value="${id}" ${id === fixtureCompareTeamId ? 'selected' : ''}>${escHTML(teams[id].short_name || '')}</option>`)
                .join('');

            let compareHtml = `<div class="detail-section">
                <div class="fx-compare-bar">
                    <label class="fx-compare-label" for="fxCompareSelect">⚔️ Compare calendar with</label>
                    <select id="fxCompareSelect" class="fx-compare-select" onchange="setFixtureCompare(this.value)">
                        <option value="">Select a team…</option>
                        ${teamOptions}
                    </select>
                    <button class="fx-compare-auto" onclick="autoCompareBestRotation()">✨ Best rotation</button>
                </div>`;

            if (fixtureCompareTeamId && teams[fixtureCompareTeamId]) {
                const other = teams[fixtureCompareTeamId];
                const calB = getTeamFixtureCalendar(fixtureCompareTeamId, cal.length ? cal[0].gw : startGW, cal.length, false);
                const soloA = calendarAvgFdr(cal, 0, cal.length);
                const soloB = calendarAvgFdr(calB, 0, calB.length);

                let sum = 0, n = 0;
                const matrixRows = cal.map((entry, i) => {
                    const a = entry.list[0], b = (calB[i] || {}).list?.[0];
                    const best = a && b ? (a.difficulty <= b.difficulty ? 'A' : 'B') : (a ? 'A' : b ? 'B' : null);
                    const bestFdr = a && b ? Math.min(a.difficulty, b.difficulty) : (a || b || {}).difficulty;
                    if (bestFdr != null) { sum += bestFdr; n++; }
                    const pick = best === 'A' ? `${player.team}` : best === 'B' ? other.short_name : '—';
                    return `<div class="fx-matrix-row">
                        <span class="fx-matrix-gw">GW${entry.gw}</span>
                        <span class="fx-matrix-cell ${best === 'A' ? 'win' : ''}">${fxChip(a, { teamId, ranks })}</span>
                        <span class="fx-matrix-cell ${best === 'B' ? 'win' : ''}">${fxChip(b, { teamId: fixtureCompareTeamId, ranks })}</span>
                        <span class="fx-matrix-pick">${best ? `🛡️ ${escHTML(pick)}` : '—'}</span>
                    </div>`;
                }).join('');

                const combined = n ? sum / n : null;
                const saving = (combined != null && soloA != null) ? soloA - combined : 0;
                const pivot = detectPivotWindow(cal, calB);

                compareHtml += `
                <div class="fx-matrix">
                    <div class="fx-matrix-head">
                        <span class="fx-matrix-gw">GW</span>
                        <span class="fx-matrix-cell">${escHTML(player.team)}</span>
                        <span class="fx-matrix-cell">${escHTML(other.short_name || '')}</span>
                        <span class="fx-matrix-pick">Start</span>
                    </div>
                    ${matrixRows}
                </div>
                <div class="fx-combined ${saving > 0.15 ? 'good' : 'flat'}">
                    Rotating gives an effective <strong>${combined != null ? combined.toFixed(1) : '—'} FDR</strong>
                    against ${escHTML(player.team)} alone at <strong>${soloA != null ? soloA.toFixed(1) : '—'}</strong>${
                        soloB != null ? ` and ${escHTML(other.short_name || '')} alone at <strong>${soloB.toFixed(1)}</strong>` : ''}.
                    ${saving > 0.15 ? `<span class="fx-combined-gain">Saves ${saving.toFixed(1)} FDR per gameweek.</span>` : ''}
                </div>
                ${pivot ? `<div class="fx-pivot">🔄 Ideal transfer pivot: <strong>GW${pivot.gw}</strong> — ${escHTML(pivot.worsening === 'A' ? player.team : (other.short_name || ''))}'s run turns hard just as ${escHTML(pivot.improving === 'A' ? player.team : (other.short_name || ''))}'s eases.</div>` : ''}`;
            }
            compareHtml += `</div>`;

            document.getElementById('detailPanel').dataset.playerId = fixturePanelPlayerId;
            document.getElementById('detailPlayerName').textContent = `${teamName} — fixtures`;
            document.getElementById('detailPlayerMeta').innerHTML = `
                <span class="position-badge ${POSITION_CONFIG[player.position].class}">${POSITION_CONFIG[player.position].short}</span>
                ${escHTML(player.name)} · £${player.price.toFixed(1)}m · next ${cal.length} gameweeks
            `;
            document.getElementById('detailBody').innerHTML = `
                <div class="detail-section">
                    <div class="detail-section-title">📊 Near term vs the run ahead</div>
                    ${ratingStrip}
                    ${splitCards}
                    ${adviceHtml}
                </div>
                <div class="detail-section">
                    <div class="detail-section-title">📅 Upcoming matches</div>
                    <div class="fx-row fx-row-head">
                        <span class="fx-row-gw">GW</span>
                        <span class="fx-row-fixtures">Opponent</span>
                        <span class="fx-row-metric" data-tooltip="${isDefensive
                            ? 'Estimated clean-sheet probability for each match — what a defender or keeper is really being picked for.'
                            : 'Projected expected goal involvements for each match, adjusted for the opponent.'}">${metricHead}</span>
                    </div>
                    <div class="fx-list">${rows}</div>
                </div>
                ${rotationHtml}
                ${compareHtml}
                <div class="detail-section">
                    <button class="btn btn-secondary" style="width:100%;" onclick="window.location.href='fpl-teams-analysis.html#calendar'">Open the full league calendar →</button>
                </div>`;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        function toggleSection(sectionId) {
            const section = document.getElementById(sectionId);
            const toggle = document.getElementById(sectionId + '-toggle');
            
            if (section.style.display === 'none') {
                section.style.display = '';
                toggle.classList.remove('open');
                toggle.textContent = '▼';
            } else {
                section.style.display = 'none';
                toggle.classList.add('open');
                toggle.textContent = '▶';
            }
        }

        // ===== TAB SWITCHING =====
        let lineupRendered = false;
        let draftTabRendered = false;
        function switchTab(tab) {
            if (tab === 'squadplanner') tab = 'draft';
            const teamDisplay = document.getElementById('teamDisplay');
            const transferMarketDisplay = document.getElementById('transferMarketDisplay');
            const newsDisplay = document.getElementById('newsDisplay');
            const transferDisplay = document.getElementById('transferDisplay');
            const lineupDisplay = document.getElementById('lineupDisplay');
            const draftDisplay = document.getElementById('draftDisplay');
            const tabTeam = document.getElementById('tabTeam');
            const tabTransfers = document.getElementById('tabTransfers');
            const tabNews = document.getElementById('tabNews');
            const tabTransfer = document.getElementById('tabTransfer');
            const tabLineup = document.getElementById('tabLineup');
            const tabDraft = document.getElementById('tabDraft');

            teamDisplay.style.display = 'none';
            transferMarketDisplay.style.display = 'none';
            newsDisplay.style.display = 'none';
            transferDisplay.style.display = 'none';
            lineupDisplay.style.display = 'none';
            draftDisplay.style.display = 'none';
            tabTeam.classList.remove('active');
            tabTransfers.classList.remove('active');
            tabNews.classList.remove('active');
            tabTransfer.classList.remove('active');
            tabLineup.classList.remove('active');
            tabDraft.classList.remove('active');

            const hashMap = { team: 'squad', transfers: 'transfers', news: 'news', draft: 'draft', transfer: 'transfer', lineup: 'lineup' };
            history.replaceState(null, '', '#' + (hashMap[tab] || tab));

            document.getElementById('settingsBtn').style.display = (tab === 'team') ? '' : 'none';

            // The help overlay documents Squad Analysis only — swapping players on
            // the pitch, the armband buttons, Auto-Optimize, the fixture chips — so
            // it has nothing to say on the other tabs. Hide the button with the same
            // rule as settings, and close the overlay if it is open when you leave.
            const helpBtn = document.getElementById('helpBtn');
            if (helpBtn) helpBtn.style.display = (tab === 'team') ? '' : 'none';
            if (tab !== 'team' && typeof closeHelpOverlay === 'function') closeHelpOverlay();

            if (tab === 'team') {
                teamDisplay.style.display = '';
                tabTeam.classList.add('active');
            } else if (tab === 'transfers') {
                transferMarketDisplay.style.display = '';
                tabTransfers.classList.add('active');
                if (!transferMarketRendered) renderTransferMarket();
            } else if (tab === 'news') {
                newsDisplay.style.display = '';
                tabNews.classList.add('active');
                if (!newsRendered) renderNewsTab();
            } else if (tab === 'transfer') {
                transferDisplay.style.display = '';
                tabTransfer.classList.add('active');
                if (!transferRendered) renderTransferWizard();
            } else if (tab === 'lineup') {
                lineupDisplay.style.display = '';
                tabLineup.classList.add('active');
                if (!lineupRendered) renderInlineLineupWizard();
            } else if (tab === 'draft') {
                draftDisplay.style.display = '';
                tabDraft.classList.add('active');
                if (!draftTabRendered) renderSquadPlanner();
            }
        }

        // Activate tab from hash on load
        (function() {
            const hashToTab = { squad: 'team', transfers: 'transfers', news: 'news', draft: 'draft', squadplanner: 'draft', transfer: 'transfer', lineup: 'lineup' };
            // A deep link carries parameters after the tab name — #transfers?out=1&in=2 —
            // so match on the tab part alone or the lookup misses entirely.
            const raw = window.location.hash.replace('#', '');
            const hash = raw.split('?')[0];
            if (hashToTab[hash]) {
                // Defer until after data loads — store desired tab
                window._pendingTab = hashToTab[hash];
            }
            /* Stash any deep-link parameters NOW. switchTab rewrites the hash to
               the bare tab name via replaceState, so by the time the squad has
               loaded and the transfer wizard runs, anything after the '?' is
               already gone. */
            const qi = raw.indexOf('?');
            if (qi >= 0) window._pendingDeepLink = raw.slice(qi + 1);
        })();

        // ===== NEWS TAB =====
        let externalNewsCache = null;
        let externalNewsFetchedAt = 0;

        function timeAgo(dateStr) {
            if (!dateStr) return '';
            const diff = Date.now() - new Date(dateStr).getTime();
            const mins = Math.floor(diff / 60000);
            if (mins < 1) return 'just now';
            if (mins < 60) return `${mins}m ago`;
            const hrs = Math.floor(mins / 60);
            if (hrs < 24) return `${hrs}h ago`;
            const days = Math.floor(hrs / 24);
            return `${days}d ago`;
        }

        function generateNewsItems(players, squadIds) {
            const items = [];
            const squadSet = new Set(squadIds);
            const posNames = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
            const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

            // INJURY / STATUS news
            players.forEach(p => {
                if (p.news && p.news.trim()) {
                    if (p.newsAdded && new Date(p.newsAdded).getTime() < thirtyDaysAgo) return;
                    const chance = p.chanceNextRound != null ? ` (${p.chanceNextRound}% chance)` : '';
                    items.push({
                        category: 'injury', categoryLabel: 'Injury',
                        headline: `${p.name} — ${p.news}${chance}`,
                        detail: `${p.team} \u00B7 ${posNames[p.position] || ''} \u00B7 \u00A3${p.price.toFixed(1)}m`,
                        player: p, isSquad: squadSet.has(p.id),
                        timestamp: p.newsAdded, sortWeight: squadSet.has(p.id) ? 100 : 50
                    });
                }
            });

            // PRICE CHANGE news
            players.forEach(p => {
                if (p.costChangeEvent !== 0) {
                    const dir = p.costChangeEvent > 0 ? '\u2191' : '\u2193';
                    const abs = Math.abs(p.costChangeEvent / 10).toFixed(1);
                    items.push({
                        category: 'price', categoryLabel: 'Price',
                        headline: `${p.name} ${dir} \u00A3${abs}m this gameweek`,
                        detail: `Now \u00A3${p.price.toFixed(1)}m \u00B7 ${p.team} \u00B7 ${p.ownership}% owned`,
                        player: p, isSquad: squadSet.has(p.id),
                        timestamp: null, sortWeight: squadSet.has(p.id) ? 80 : 30
                    });
                }
            });

            // TRANSFER SURGE news
            const transferThreshold = 50000;
            players.forEach(p => {
                const net = p.transfersIn - p.transfersOut;
                if (Math.abs(net) >= transferThreshold) {
                    const dir = net > 0 ? 'in' : 'out';
                    items.push({
                        category: 'transfer', categoryLabel: 'Transfer',
                        headline: `${p.name} sees ${Math.abs(net).toLocaleString()} net transfers ${dir}`,
                        detail: `${p.transfersIn.toLocaleString()} in / ${p.transfersOut.toLocaleString()} out \u00B7 ${p.team}`,
                        player: p, isSquad: squadSet.has(p.id),
                        timestamp: null, sortWeight: squadSet.has(p.id) ? 70 : 20
                    });
                }
            });

            // Sort: squad items first, then by weight desc
            items.sort((a, b) => b.sortWeight - a.sortWeight);
            return items;
        }

        async function fetchExternalNews() {
            const now = Date.now();
            if (externalNewsCache && (now - externalNewsFetchedAt) < 30 * 60 * 1000) {
                return externalNewsCache;
            }
            const feeds = [
                { url: 'https://feeds.bbci.co.uk/sport/football/premier-league/rss.xml', source: 'BBC Sport', badge: 'bbc' },
                { url: 'https://www.premierleague.com/news.rss', source: 'Premier League', badge: 'pl' },
                { url: 'https://www.skysports.com/rss/12040', source: 'Sky Sports', badge: 'sky' },
                { url: 'https://www.theguardian.com/football/premierleague/rss', source: 'The Guardian', badge: 'guardian' }
            ];
            const items = [];
            for (const feed of feeds) {
                try {
                    const rssUrl = encodeURIComponent(feed.url);
                    const resp = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${rssUrl}`);
                    if (!resp.ok) continue;
                    const data = await resp.json();
                    if (data.status !== 'ok' || !data.items) continue;
                    // PL relevance keywords
                    const plTeams = ['arsenal','aston villa','bournemouth','brentford','brighton','burnley','chelsea','crystal palace','everton','fulham','ipswich','leicester','liverpool','luton','man city','manchester city','man utd','manchester united','newcastle','nott\'m forest','nottingham forest','sheffield','southampton','spurs','tottenham','west ham','wolves','wolverhampton'];
                    const plKeywords = ['premier league','fpl','gameweek','epl','prem','pl table','top four','relegation','var ','offside','penalty','clean sheet'];
                    data.items.slice(0, 12).forEach(article => {
                        const rawDesc = article.description ? article.description.replace(/<[^>]*>/g, '') : '';
                        const textToCheck = ((article.title || '') + ' ' + rawDesc).toLowerCase();
                        const isPL = plTeams.some(t => textToCheck.includes(t)) || plKeywords.some(k => textToCheck.includes(k));
                        if (!isPL) return;
                        items.push({
                            category: 'external', categoryLabel: feed.source,
                            headline: article.title,
                            link: article.link,
                            thumbnail: article.thumbnail || article.enclosure?.link || null,
                            source: feed.source, badge: feed.badge,
                            detail: rawDesc.slice(0, 140) || feed.source,
                            isSquad: false,
                            timestamp: article.pubDate,
                            sortWeight: 5
                        });
                    });
                } catch (e) {
                    console.warn(`Failed to fetch ${feed.source} RSS:`, e);
                }
            }
            externalNewsCache = items;
            externalNewsFetchedAt = now;
            return items;
        }

        async function renderNewsTab() {
            const container = document.getElementById('newsDisplay');
            container.innerHTML = `<div class="news-loading"><div class="spinner spinner-sm"></div> Loading news...</div>`;

            const squadIds = (selectedPlayers || []).map(p => p.id);
            const fplItems = generateNewsItems(allPlayers, squadIds);
            let externalItems = [];
            try { externalItems = await fetchExternalNews(); } catch (e) {}

            // Check external items for squad player mentions
            (selectedPlayers || []).forEach(sp => {
                const nameLower = sp.name.toLowerCase();
                externalItems.forEach(item => {
                    if (!item.isSquad && (item.headline || '').toLowerCase().includes(nameLower)) {
                        item.isSquad = true;
                        item.player = sp;
                        item.sortWeight = 60;
                    }
                });
            });

            // Tag external items with team IDs for team filtering
            const teamNameMap = {};
            Object.values(teams).forEach(t => {
                teamNameMap[t.name.toLowerCase()] = t.id;
                teamNameMap[t.short_name.toLowerCase()] = t.id;
            });
            externalItems.forEach(item => {
                const text = ((item.headline || '') + ' ' + (item.detail || '')).toLowerCase();
                item.matchedTeamIds = [];
                for (const [name, tid] of Object.entries(teamNameMap)) {
                    if (text.includes(name) && !item.matchedTeamIds.includes(tid)) {
                        item.matchedTeamIds.push(tid);
                    }
                }
            });

            const filterCounts = {
                external: externalItems.length,
                squad: fplItems.filter(i => i.isSquad).length,
                all: fplItems.length,
                injury: fplItems.filter(i => i.category === 'injury').length,
                price: fplItems.filter(i => i.category === 'price').length,
                transfer: fplItems.filter(i => i.category === 'transfer').length
            };

            // Team color map (PL team_id → [primary, secondary])
            const TEAM_COLORS = {
                1:['#EF0107','#FFFFFF'],2:['#670E36','#95BFE5'],3:['#0057B8','#FFFFFF'],
                4:['#e30613','#FFFFFF'],5:['#6C1D45','#99D6EA'],6:['#003399','#FFFFFF'],
                7:['#1B458F','#FFFFFF'],8:['#274488','#FFFFFF'],9:['#A7A5A6','#FFFFFF'],
                10:['#003090','#FFD700'],11:['#C8102E','#FFFFFF'],12:['#6CABDD','#1C2C5B'],
                13:['#DA291C','#FBE122'],14:['#241F20','#FFFFFF'],15:['#EE2737','#FFFFFF'],
                16:['#034694','#FFFFFF'],17:['#132257','#FFFFFF'],18:['#7A263A','#FDB913'],
                19:['#D71920','#FFFFFF'],20:['#FBEE23','#1F1F1F']
            };

            const CAT_ICONS = {
                injury: '<svg class="cat-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2v4M8 6h8M5 10h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/><path d="M12 14v4M10 16h4"/></svg>',
                price: '<svg class="cat-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
                transfer: '<svg class="cat-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M16 3l4 4-4 4"/><path d="M20 7H4"/><path d="M8 21l-4-4 4-4"/><path d="M4 17h16"/></svg>',
                external: '<svg class="cat-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8M15 18h-5M18 10h-8"/></svg>',
                squad: '<svg class="cat-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
                all: '<svg class="cat-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>'
            };

            function getNextFixture(player) {
                if (!player || !player.fixtures || !player.fixtures.length) return null;
                const f = player.fixtures[0];
                return f ? `${escHTML(f.opponent)} (${f.isHome ? 'H' : 'A'})` : null;
            }

            function getCTAForCategory(item) {
                const posShort = POSITION_CONFIG[item.player?.position]?.short || '';
                if (item.category === 'injury' && item.player) {
                    const maxPrice = Math.ceil(item.player.price + 0.5);
                    return { label: 'View Replacements', href: `fpl-players-analysis.html#all?pos=${posShort}&max=${maxPrice}` };
                }
                if (item.category === 'price') return { label: 'Price Trends', href: 'fpl-players-analysis.html#all?sort=price' };
                if (item.category === 'transfer') return { label: 'Transfer Trends', href: 'fpl-players-analysis.html#all?sort=transfers' };
                return null;
            }

            function buildGraphic(item) {
                const p = item.player;
                const colors = TEAM_COLORS[p?.teamId] || ['#6366F1','#FFFFFF'];
                const iconSVG = CAT_ICONS[item.category] || CAT_ICONS.external;
                const kitNum = p ? (p.id % 30 + 1) : '';
                const teamName = p ? escHTML(p.team) : '';
                return `<div class="news-card-graphic" style="background:linear-gradient(135deg, ${colors[0]} 0%, ${colors[0]}dd 60%, ${colors[0]}99 100%);color:${colors[1]}">
                    <div class="news-card-graphic-bg" style="background:radial-gradient(circle at 30% 40%,${colors[1]} 0%,transparent 70%)"></div>
                    <div class="news-card-graphic-icon">
                        ${iconSVG}
                        ${kitNum ? `<span class="news-card-graphic-kit">${kitNum}</span>` : ''}
                        ${teamName ? `<span class="news-card-graphic-team">${teamName}</span>` : ''}
                    </div>
                </div>`;
            }

            function buildImageOrGraphic(item) {
                if (item.thumbnail && /^https?:\/\//i.test(item.thumbnail)) {
                    return `<img class="news-card-img" src="${escHTML(item.thumbnail)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">`
                         + `<div class="news-card-graphic" style="display:none;background:linear-gradient(135deg,#1a1a2e,#16213e);color:#e2e8f0;">
                            <div class="news-card-graphic-icon">${CAT_ICONS.external}<span class="news-card-graphic-team">${escHTML(item.source || '')}</span></div>
                          </div>`;
                }
                if (item.player) return buildGraphic(item);
                return `<div class="news-card-graphic" style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#e2e8f0;">
                    <div class="news-card-graphic-icon">${CAT_ICONS[item.category] || CAT_ICONS.external}<span class="news-card-graphic-team">${escHTML(item.source || '')}</span></div>
                </div>`;
            }

            function buildTeamTag(item) {
                const p = item.player;
                if (!p) return '';
                const colors = TEAM_COLORS[p.teamId] || ['#6366F1','#FFFFFF'];
                return `<span class="news-card-team-tag" style="background:${colors[0]}22;color:${colors[0]};border:1px solid ${colors[0]}33;">${escHTML(p.team)}</span>`;
            }

            function buildFooter(item) {
                const p = item.player;
                if (!p) {
                    if (item.link && /^https?:\/\//i.test(item.link)) {
                        return `<div class="news-card-footer">
                            <span class="news-card-stat">${escHTML(item.source || '')}</span>
                            <a class="news-card-cta" href="${escHTML(item.link)}" target="_blank" rel="noopener noreferrer">Read more <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg></a>
                        </div>`;
                    }
                    return '';
                }
                const stats = [];
                stats.push(`<span class="news-card-stat">\u00A3<strong>${p.price.toFixed(1)}m</strong></span>`);
                stats.push(`<span class="news-card-stat"><strong>${p.ownership}%</strong> owned</span>`);
                const nf = getNextFixture(p);
                if (nf) stats.push(`<span class="news-card-stat">Next: <strong>${escHTML(nf)}</strong></span>`);
                const cta = getCTAForCategory(item);
                if (cta) stats.push(`<a class="news-card-cta" href="${escHTML(cta.href)}">${escHTML(cta.label)} <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg></a>`);
                return `<div class="news-card-footer">${stats.join('')}</div>`;
            }

            function renderCard(item, isHero) {
                const badgeCat = item.badge || item.category;
                const badgeLabel = item.badge === 'bbc' ? 'BBC Sport' : item.badge === 'pl' ? 'Premier League' : item.badge === 'sky' ? 'Sky Sports' : item.badge === 'guardian' ? 'The Guardian' : escHTML(item.categoryLabel || item.category);
                const safeHeadline = escHTML(item.headline);
                const safeDetail = escHTML(item.detail || '');
                const isValidLink = item.link && /^https?:\/\//i.test(item.link);
                const headlineHTML = isValidLink
                    ? `<a href="${escHTML(item.link)}" target="_blank" rel="noopener noreferrer" class="news-card-link">${safeHeadline}</a>`
                    : safeHeadline;
                const squadBadge = item.isSquad ? `<span class="news-card-squad-badge">\u26a1 Your Player</span>` : '';
                const squadClass = item.isSquad ? ' is-squad' : '';
                const cardClass = isHero ? `news-card-hero${squadClass}` : `news-card${squadClass}`;
                const media = buildImageOrGraphic(item);
                const teamTag = buildTeamTag(item);
                const catIcon = CAT_ICONS[item.category] || '';
                const footer = buildFooter(item);

                return `<div class="${cardClass}">
                    ${media}
                    <div class="news-card-content">
                        <div class="news-card-top">
                            <span class="news-card-category cat-${escHTML(badgeCat)}">${catIcon}${badgeLabel}</span>
                            ${teamTag}
                            ${squadBadge}
                            ${item.timestamp ? `<span class="news-card-time">${timeAgo(item.timestamp)}</span>` : ''}
                        </div>
                        <div class="news-card-headline">${headlineHTML}</div>
                        <div class="news-card-detail">${safeDetail}</div>
                        ${footer}
                    </div>
                </div>`;
            }

            function renderSection(title, items) {
                if (!items.length) return `<div class="news-section"><div class="news-section-title">${title}</div><div class="news-empty">No news in this category</div></div>`;
                const cards = items.map((item, i) => renderCard(item, i === 0)).join('');
                return `<div class="news-section"><div class="news-section-title">${title}</div><div class="news-grid">${cards}</div></div>`;
            }

            function renderFiltered(primaryFilter, subFilter, teamId) {
                let items = [];
                let sectionTitle = '';

                if (primaryFilter === 'external') {
                    items = [...externalItems];
                    sectionTitle = CAT_ICONS.external + ' External News';
                } else {
                    const scope = primaryFilter === 'squad'
                        ? fplItems.filter(i => i.isSquad)
                        : fplItems;
                    if (subFilter && subFilter !== 'all') {
                        items = scope.filter(i => i.category === subFilter);
                        const subTitles = {
                            injury: CAT_ICONS.injury + ' Injuries & Availability',
                            price: CAT_ICONS.price + ' Price Changes',
                            transfer: CAT_ICONS.transfer + ' Transfer Activity'
                        };
                        sectionTitle = subTitles[subFilter] || subFilter;
                    } else {
                        items = [...scope];
                        sectionTitle = primaryFilter === 'squad'
                            ? CAT_ICONS.squad + ' Your Squad'
                            : CAT_ICONS.all + ' All Players';
                    }
                }

                // Apply team filter
                if (teamId && teamId !== 'all') {
                    const tid = parseInt(teamId);
                    items = items.filter(i => {
                        if (i.player && i.player.teamId === tid) return true;
                        if (i.matchedTeamIds && i.matchedTeamIds.includes(tid)) return true;
                        return false;
                    });
                }

                return renderSection(sectionTitle, items);
            }

            // Build team select options
            const teamOptions = Object.values(teams)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(t => `<option value="${t.id}">${escHTML(t.name)}</option>`)
                .join('');

            const filtersHTML = `<div class="news-filter-group" id="newsFilterGroup">
                <div class="news-filter-top-row">
                    <div class="news-filter-bar" id="newsFilterBar">
                        <button class="news-filter-btn active" data-filter="external"><span class="btn-icon">${CAT_ICONS.external}</span> External <span class="news-count">(${filterCounts.external})</span></button>
                        <button class="news-filter-btn" data-filter="squad"><span class="btn-icon">${CAT_ICONS.squad}</span> Squad <span class="news-count">(${filterCounts.squad})</span></button>
                        <button class="news-filter-btn" data-filter="all"><span class="btn-icon">${CAT_ICONS.all}</span> All <span class="news-count">(${filterCounts.all})</span></button>
                    </div>
                    <select class="news-team-select" id="newsTeamSelect">
                        <option value="all">All Teams</option>
                        ${teamOptions}
                    </select>
                </div>
                <div class="news-filter-bar news-sub-bar" id="newsSubBar" style="display:none">
                    <button class="news-filter-btn active" data-sub="all"><span class="btn-icon">${CAT_ICONS.all}</span> All</button>
                    <button class="news-filter-btn" data-sub="injury"><span class="btn-icon">${CAT_ICONS.injury}</span> Injuries <span class="news-count">(${filterCounts.injury})</span></button>
                    <button class="news-filter-btn" data-sub="price"><span class="btn-icon">${CAT_ICONS.price}</span> Prices <span class="news-count">(${filterCounts.price})</span></button>
                    <button class="news-filter-btn" data-sub="transfer"><span class="btn-icon">${CAT_ICONS.transfer}</span> Transfers <span class="news-count">(${filterCounts.transfer})</span></button>
                </div>
            </div>`;

            container.innerHTML = `<div class="news-container">
                ${filtersHTML}
                <div id="newsContent">${renderFiltered('external', null, 'all')}</div>
            </div>`;

            // Filter state
            let currentPrimary = 'external';
            let currentSub = 'all';

            function updateSubCounts(primary) {
                const scope = primary === 'squad' ? fplItems.filter(i => i.isSquad) : fplItems;
                const subBar = document.getElementById('newsSubBar');
                if (!subBar) return;
                subBar.querySelectorAll('[data-sub]').forEach(btn => {
                    const sub = btn.dataset.sub;
                    if (sub === 'all') return;
                    const count = scope.filter(i => i.category === sub).length;
                    const countEl = btn.querySelector('.news-count');
                    if (countEl) countEl.textContent = `(${count})`;
                });
            }

            function applyFilters() {
                const teamId = document.getElementById('newsTeamSelect').value;
                document.getElementById('newsContent').innerHTML = renderFiltered(currentPrimary, currentSub, teamId);
            }

            // Primary filter click handlers
            container.querySelectorAll('#newsFilterBar .news-filter-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    container.querySelectorAll('#newsFilterBar .news-filter-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    currentPrimary = btn.dataset.filter;
                    const subBar = document.getElementById('newsSubBar');
                    if (currentPrimary === 'external') {
                        subBar.style.display = 'none';
                        currentSub = 'all';
                    } else {
                        subBar.style.display = '';
                        updateSubCounts(currentPrimary);
                        subBar.querySelectorAll('.news-filter-btn').forEach(b => b.classList.remove('active'));
                        subBar.querySelector('[data-sub="all"]').classList.add('active');
                        currentSub = 'all';
                    }
                    applyFilters();
                });
            });

            // Sub filter click handlers
            container.querySelectorAll('#newsSubBar .news-filter-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    container.querySelectorAll('#newsSubBar .news-filter-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    currentSub = btn.dataset.sub;
                    applyFilters();
                });
            });

            // Team select handler
            document.getElementById('newsTeamSelect').addEventListener('change', applyFilters);

            newsRendered = true;
        }

        // ===== PLAYER DETAIL (inline squad-row expansion) =====
        // Where this player's projected points are expected to come from, plus the
        // set-piece duty that used to be crammed onto the pitch card. Every figure
        // is a component the projection already computes — nothing new is modelled
        // here, it is the same total broken open.
        function renderRoutesToPoints(player) {
            if (typeof projectPlayerPointsDetailed !== 'function') return '';
            const d = projectPlayerPointsDetailed(player);
            const total = d.total || 0;
            if (total <= 0) return '';

            const parts = [
                { key: 'appearance', label: 'Appearance', color: '#94A3B8', value: d.appearance },
                { key: 'attack',     label: 'Goals & assists', color: '#F87171', value: d.attack },
                { key: 'cleanSheet', label: 'Clean sheet', color: '#34D399', value: d.cleanSheet },
                { key: 'saves',      label: 'Saves', color: '#A78BFA', value: d.saves },
                { key: 'defCon',     label: 'Defensive contribution', color: '#38BDF8', value: d.defCon },
                { key: 'bonus',      label: 'Bonus', color: '#FBBF24', value: d.bonus }
            ].filter(p => p.value >= 0.05);
            const sum = parts.reduce((s, p) => s + p.value, 0) || 1;

            const duty = [];
            if (player.penaltiesOrder != null && player.penaltiesOrder <= 2) {
                duty.push({ txt: player.penaltiesOrder === 1 ? 'First-choice penalties' : 'Second-choice penalties', tone: player.penaltiesOrder === 1 ? 'prime' : '' });
            }
            if (player.freekicksOrder === 1) duty.push({ txt: 'Direct free kicks', tone: '' });
            if (player.cornersOrder === 1) duty.push({ txt: 'Corners', tone: '' });

            return `<div class="detail-section rtp-section">
                <div class="detail-section-title">Routes to points</div>
                <div class="rtp-head">
                    <span class="rtp-total">${total.toFixed(1)}<small>projected next match</small></span>
                    ${d.conceded < -0.05 ? `<span class="rtp-drag" data-tooltip="Expected deduction for goals conceded">${d.conceded.toFixed(1)} conceded</span>` : ''}
                </div>
                <div class="rtp-bar">
                    ${parts.map(p => `<span class="rtp-seg" style="width:${(p.value / sum * 100).toFixed(1)}%;background:${p.color}"
                        data-tooltip="${p.label}: ${p.value.toFixed(2)} points, ${Math.round(p.value / sum * 100)}% of the projection"></span>`).join('')}
                </div>
                <div class="rtp-keys">
                    ${parts.map(p => `<span class="rtp-key"><span class="rtp-dot" style="background:${p.color}"></span>${p.label}<b>${p.value.toFixed(2)}</b></span>`).join('')}
                </div>
                ${duty.length ? `<div class="rtp-duty">
                    <span class="rtp-duty-label">Set-piece duty</span>
                    ${duty.map(x => `<span class="rtp-duty-chip ${x.tone}">${x.txt}</span>`).join('')}
                </div>` : ''}
            </div>`;
        }

        /* Actions handed over from the dashboard.

           The dashboard runs the same models this page does, so when it flags a
           player it already knows which one and what to do about it. Landing on a
           generic tab and making the manager find the player again throws that
           away — the PRD's whole point about alerts is that clicking one should
           start the action, not just gesture at the right screen.

           Supported, all validated against the loaded squad so a stale link does
           nothing rather than something wrong:

             #squad?player=123     expand that player's inline detail row
             #squad?captain=123    move the armband to him
             #transfers?out=..&in=..   handled by twApplyDeepLink

           Returns true if it consumed the link. */
        function applySquadDeepLink() {
            const qs = window._pendingDeepLink;
            if (!qs) return false;
            const params = new URLSearchParams(qs);

            const capId = parseInt(params.get('captain'), 10);
            if (capId && typeof setSnapshotCaptain === 'function') {
                const target = (analysisResults || []).find(a => a.player.id === capId);
                if (!target) return false;
                window._pendingDeepLink = null;
                setSnapshotCaptain(capId);
                if (typeof updateStatus === 'function') {
                    updateStatus(`Armband moved to ${target.player.name} — review before the deadline`, 'success');
                }
                if (typeof expandSquadRow === 'function') expandSquadRow(capId);
                return true;
            }

            const pid = parseInt(params.get('player'), 10);
            if (pid) {
                if (!(analysisResults || []).some(a => a.player.id === pid)) return false;
                window._pendingDeepLink = null;
                if (typeof expandSquadRow === 'function') expandSquadRow(pid);
                return true;
            }
            return false;
        }

        // "FDR 3.7 → 2.7" is an average of two averages — honest, but it answers
        // "is it easier?" without answering the question that actually matters:
        // easier against whom, and when does it turn? This lays out both windows
        // GW by GW with the actual opponent(s), so the swing explains itself
        // instead of asking to be taken on faith.
        function renderFixtureSwingDetail(swingInfo) {
            if (!swingInfo || !swingInfo.currentFixtures || !swingInfo.futureFixtures) return '';
            const improving = swingInfo.direction === 'improving';
            const color = improving ? 'var(--color-success)' : 'var(--color-error)';
            const bg = improving ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)';
            const border = improving ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)';
            const FDR_WORDS = { 1: 'Very easy', 2: 'Easy', 3: 'Average', 4: 'Hard', 5: 'Very hard' };

            const chip = f => {
                const opp = teams[f.opponentId];
                const name = opp ? (opp.short_name || opp.name) : '?';
                return `<span class="dp-fix fsw-chip fdr-${f.fdr}" data-tooltip="${f.isHome ? 'Home to' : 'Away at'} ${escHTML(name)} — FDR ${f.fdr} (${FDR_WORDS[f.fdr] || 'Average'})">${escHTML(name)} <span class="dp-fix-ha">${f.isHome ? 'H' : 'A'}</span></span>`;
            };
            const gwGroup = fx => `<div class="fsw-gw">
                <span class="fsw-gw-label">GW${fx.gw}</span>
                <div class="fsw-gw-chips">${fx.opponents.length ? fx.opponents.map(chip).join('') : '<span class="dp-fix fsw-chip dp-fix-blank">Blank</span>'}</div>
            </div>`;

            const spanLabel = gws => gws.length ? (gws.length > 1 ? `GW${gws[0].gw}–${gws[gws.length - 1].gw}` : `GW${gws[0].gw}`) : '';

            return `<div class="fsw-panel" style="background:${bg};border:1px solid ${border};">
                <div class="fsw-headline" style="color:${color};">${improving ? '▲' : '▼'} Fixtures ${swingInfo.direction} from GW${swingInfo.swingGW} — average difficulty ${improving ? 'drops' : 'rises'} from ${swingInfo.currentFdr} to ${swingInfo.futureFdr}</div>
                <div class="fsw-rows">
                    <div class="fsw-row">
                        <span class="fsw-row-label">Now <small>${spanLabel(swingInfo.currentFixtures)}</small></span>
                        <div class="fsw-gws">${swingInfo.currentFixtures.map(gwGroup).join('')}</div>
                    </div>
                    <div class="fsw-arrow">→</div>
                    <div class="fsw-row">
                        <span class="fsw-row-label">${improving ? 'Easier' : 'Harder'} from <small>${spanLabel(swingInfo.futureFixtures)}</small></span>
                        <div class="fsw-gws">${swingInfo.futureFixtures.map(gwGroup).join('')}</div>
                    </div>
                </div>
            </div>`;
        }

        // Given a player, the opponent(s) they're about to face \u2014 form, attack,
        // defence and how leaky each is ranked league-wide. "Form of the player"
        // and "form of the team" both exist elsewhere in this panel already; this
        // is the missing third leg, since a hot player facing a rock-bottom
        // defence and the same player facing the league's best are not the same
        // pick even though every one of their own numbers reads identically.
        function renderOpponentSection(player, fixtures) {
            const upcoming = (fixtures || []).slice(0, 3);
            if (!upcoming.length) return '';
            const ranks = typeof getDefensiveRanks === 'function' ? getDefensiveRanks() : { rank: {}, total: 20 };
            const FDR_WORDS = { 1: 'Very easy', 2: 'Easy', 3: 'Average', 4: 'Hard', 5: 'Very hard' };

            const cards = upcoming.map(fx => {
                const oppTA = teamAnalysis[fx.opponentId];
                const ctx = typeof opponentContext === 'function' ? opponentContext(player.teamId, fx, ranks) : null;
                const formWord = oppTA && oppTA.matchesPlayed
                    ? (oppTA.formRating >= 55 ? 'In form' : oppTA.formRating < 40 ? 'Poor form' : 'Average form')
                    : 'No form data yet';
                return `<div class="opp-card">
                    <div class="opp-card-head">
                        <span class="opp-card-name">${fx.isHome ? 'vs' : '@'} ${escHTML(fx.opponent)}</span>
                        <span class="dp-fix fdr-${fx.difficulty || 3}">GW${fx.event} \u00b7 FDR ${fx.difficulty || 3}</span>
                    </div>
                    <div class="opp-card-stats">
                        ${oppTA ? `
                        <span class="opp-stat" data-tooltip="${escHTML(fx.opponent)}'s form rating out of 100">Form <b>${oppTA.formRating}</b></span>
                        <span class="opp-stat" data-tooltip="${escHTML(fx.opponent)}'s attack power out of 100">ATK <b>${oppTA.attackPower}</b></span>
                        <span class="opp-stat" data-tooltip="${escHTML(fx.opponent)}'s defence power out of 100">DEF <b>${oppTA.defensePower}</b></span>` : ''}
                        ${ctx && ctx.ranked ? `<span class="opp-stat" data-tooltip="Concedes ${ctx.conceded.toFixed(1)} a game \u2014 the ${ordinal(ctx.rank)} leakiest defence of ${ctx.total}">Concedes <b>${ctx.conceded.toFixed(1)}</b></span>` : ''}
                    </div>
                    <div class="opp-card-note">${formWord}${FDR_WORDS[fx.difficulty] ? ` \u00b7 ${FDR_WORDS[fx.difficulty]} fixture` : ''}</div>
                </div>`;
            }).join('');

            return `<div class="detail-section">
                <div class="detail-section-title">\u2694\ufe0f Opponent Form \u2014 Next ${upcoming.length}</div>
                <div class="opp-cards">${cards}</div>
            </div>`;
        }

        // Is a price move imminent? The official meter (price-watch.js) is the
        // validated signal; the transfer-momentum heuristic is shown only as a
        // softer fallback when the meter itself has nothing to say yet.
        function renderPriceWatchSection(player) {
            const locked = typeof pwIsLocked === 'function' && pwIsLocked(player);
            const pw = !locked && typeof pwClassify === 'function'
                ? pwClassify(player, typeof PW_TICKER_FLOOR !== 'undefined' ? PW_TICKER_FLOOR : 20)
                : null;
            const mom = typeof priceMomentum === 'function' ? priceMomentum(player) : null;

            let body;
            if (locked) {
                body = `<div class="pw-row"><span class="pw-badge locked">\ud83d\udd12 Locked</span><span class="pw-text">Price changes are locked for this player right now.</span></div>`;
            } else if (pw) {
                const dirWord = pw.dir === 'rise' ? 'Rise' : 'Fall';
                body = `<div class="pw-row">
                    <span class="pw-badge ${pw.dir} ${pw.tier}">${pw.tier === 'due' ? `${dirWord} due` : `${Math.round(Math.abs(pw.progress))}% to ${dirWord.toLowerCase()}`}</span>
                    <span class="pw-text">${escHTML(pwDetail(pw))}</span>
                </div>`;
            } else if (mom) {
                body = `<div class="pw-row">
                    <span class="pw-badge ${mom.rising ? 'rise' : 'fall'} soft">${escHTML(mom.label)}</span>
                    <span class="pw-text">Net ${mom.net > 0 ? '+' : '\u2212'}${Math.abs(mom.net).toLocaleString()} transfers this gameweek \u2014 early momentum, not yet close to a change.</span>
                </div>`;
            } else {
                body = `<div class="pw-row"><span class="pw-badge flat">Stable</span><span class="pw-text">No meaningful price-change signal right now.</span></div>`;
            }

            return `<div class="detail-section">
                <div class="detail-section-title">\ud83d\udcb7 Price Watch</div>
                ${body}
            </div>`;
        }

        // The thorough written verdict the feature asks for: one paragraph that
        // reads player form, team form, the fixture swing, the very next opponent
        // and price momentum together, rather than leaving a manager to cross-
        // reference five separate widgets themselves.
        // `context` swaps only the opening sentence's framing: analyzePlayer's
        // verdict is inherently a squad decision ("hold" / "sell candidate"),
        // which reads as a non-sequitur applied to a transfer target you don't
        // own yet \u2014 nobody is deciding whether to sell a player they're
        // considering buying. Everything after the opener (form, team form,
        // fixture swing, opponent, price) is already ownership-neutral fact,
        // so only the lead needs a second wording.
        function buildPlayerNarrativeReport(player, analysis, context) {
            const { verdict, verdictReason, concerns, positives } = analysis;
            const posConfig = POSITION_CONFIG[player.position];
            const ta = teamAnalysis[player.teamId];
            const swing = fixtureSwingData[player.teamId];
            const fx = (player.fixtures || teamFixtures[player.teamId] || [])[0];
            const oppTA = fx ? teamAnalysis[fx.opponentId] : null;
            const effectiveForm = isPreseason ? (player.ppg || 0) : (parseFloat(player.form) || 0);

            const sentences = [];

            const leads = context === 'candidate' ? {
                star: `${player.name} would be one of the stronger names in this squad`,
                hold: `${player.name} looks like a solid, low-drama pickup`,
                monitor: `${player.name} is a fair option but not without questions`,
                sell: `${player.name}'s underlying signals are weak right now`
            } : {
                star: `${player.name} is one of the stronger assets in this squad right now`,
                hold: `${player.name} looks like a solid, low-drama hold`,
                monitor: `${player.name} is worth keeping an eye on`,
                sell: `${player.name} is flagged as a sell candidate`
            };
            const verdictLead = leads[verdict] || `${player.name}'s outlook is mixed`;
            const reason = verdictReason ? verdictReason.charAt(0).toLowerCase() + verdictReason.slice(1) : '';
            sentences.push(reason ? `${verdictLead} \u2014 ${reason}` : `${verdictLead}.`);

            if (effectiveForm >= 6) sentences.push(`Individually, form is excellent at ${effectiveForm.toFixed(1)} points a game, well clear of the ${posConfig.short} median of ${posConfig.formMedian}.`);
            else if (effectiveForm >= 4) sentences.push(`Form is solid at ${effectiveForm.toFixed(1)}, in line with a dependable ${posConfig.short}.`);
            else if (effectiveForm > 0) sentences.push(`Form is soft at just ${effectiveForm.toFixed(1)}, below the ${posConfig.short} median of ${posConfig.formMedian}.`);

            if (ta && ta.matchesPlayed > 0) {
                const formWord = ta.formRating >= 55 ? 'in good form' : ta.formRating < 40 ? 'out of form' : 'showing average form';
                sentences.push(`${player.team} are ${formWord} coming into this (W${ta.wins} D${ta.draws} L${ta.losses} in their last ${Math.min(ta.matchesPlayed, 5)}).`);
            }

            if (swing) {
                sentences.push(swing.direction === 'improving'
                    ? `Their fixtures ease up from GW${swing.swingGW} (FDR ${swing.currentFdr} \u2192 ${swing.futureFdr}) \u2014 a good moment to be holding or buying in.`
                    : `Their fixtures get tougher from GW${swing.swingGW} (FDR ${swing.currentFdr} \u2192 ${swing.futureFdr}) \u2014 worth planning around.`);
            }

            if (fx && oppTA && oppTA.matchesPlayed) {
                const oppFormWord = oppTA.formRating >= 55 ? 'good form' : oppTA.formRating < 40 ? 'poor form' : 'average form';
                sentences.push(`Next up ${fx.isHome ? 'at home to' : 'away at'} ${fx.opponent}, who are in ${oppFormWord} (FDR ${fx.difficulty || 3}).`);
            }

            const pwLocked = typeof pwIsLocked === 'function' && pwIsLocked(player);
            const pw = !pwLocked && typeof pwClassify === 'function' ? pwClassify(player, 20) : null;
            if (pw) {
                sentences.push(pw.tier === 'due'
                    ? `The price meter is full \u2014 a ${pw.dir === 'rise' ? 'rise' : 'drop'} is due at the next update.`
                    : `The price meter is ${Math.round(Math.abs(pw.progress))}% of the way to a ${pw.dir === 'rise' ? 'rise' : 'drop'}.`);
            } else {
                const mom = typeof priceMomentum === 'function' ? priceMomentum(player) : null;
                if (mom) sentences.push(`Transfer momentum points toward a price ${mom.rising ? 'rise' : 'fall'} (${mom.label.toLowerCase()}), though it isn't close enough yet to call.`);
            }

            if (concerns.length) sentences.push(`${concerns.length} concern${concerns.length > 1 ? 's' : ''} flagged below${positives.length ? `, against ${positives.length} positive${positives.length > 1 ? 's' : ''}.` : '.'}`);
            else if (positives.length) sentences.push(`No concerns flagged, and ${positives.length} positive${positives.length > 1 ? 's' : ''} working in their favour.`);

            return sentences.join(' ');
        }

        // Full player analysis, reusing the cached copy for a squad member or
        // running analyzePlayer() fresh for anyone else (a transfer candidate
        // never seen before). analyzePlayer() reads player.fixtures for its FDR
        // read \u2014 a squad member gets that from the pick-mapping step, a raw
        // allPlayers candidate never has it, so it's patched in first, same
        // fix openTransferPanel already applies for computePlayerStatColumns.
        function getPlayerAnalysis(player) {
            const existing = (analysisResults || []).find(a => a.player.id === player.id);
            if (existing) return existing;
            if (!player.fixtures || !player.fixtures.length) {
                player.fixtures = teamFixtures[player.teamId] || [];
            }
            return analyzePlayer(player);
        }

        // Builds a player's full analytical profile \u2014 AI report, verdict, key
        // stats, season numbers, routes to points, price watch, concerns/
        // positives, upcoming fixtures, team context (incl. fixture swing) and
        // opponent form. Shared by the Squad Analysis inline detail card
        // (buildPlayerDetailHTML below) and the Transfer Wizard's head-to-head
        // compare, so a buy candidate gets exactly the same depth as one of
        // your own XI. `opts`:
        //   header         show the name/team/price strip (default true)
        //   aiReport       show the narrative paragraph (default true)
        //   recommendation show the "Recommendation: ..." box (default true) \u2014
        //                  turn off for a candidate: analyzePlayer's advice is
        //                  squad-decision language ("transfer out before GW6"),
        //                  which is a non-sequitur for a player you don't own
        //   replacements   show "Best Replacement Comparison" (default true) \u2014
        //                  meaningless in a head-to-head, pass false there
        //   context        'squad' (default) or 'candidate' \u2014 only changes the
        //                  AI report's opening sentence and the verdict chip
        function buildPlayerFullProfileHTML(player, analysis, opts) {
            opts = opts || {};
            const showHeader = opts.header !== false;
            const showReport = opts.aiReport !== false;
            const showRecommendation = opts.recommendation !== false;
            const showReplacements = opts.replacements !== false;
            const context = opts.context || 'squad';
            const { verdict, verdictReason, recommendation, concerns, positives, sellRating, fixtures } = analysis;
            const posConfig = POSITION_CONFIG[player.position];
            const gamesPlayed = Math.max(currentGW - 1, 1);
            const minsPerGame = player.minsPerGame || (player.minutes / gamesPlayed);
            const xGIPer90 = player.xGIPer90 || (player.minutes > 0 ? (player.xGI / player.minutes) * 90 : 0);
            const statsScopeLabel = player.position === 1 ? 'Goalkeeping' : player.position === 2 ? 'Defensive' : 'Attacking';
            // "SELL" as a badge on a player you're evaluating to BUY reads as an
            // instruction, not a rating \u2014 candidate mode swaps in strength words.
            const chipLabel = context === 'candidate'
                ? { star: '\u2605 STRONG', hold: 'SOLID', monitor: 'MIXED', sell: 'WEAK' }[verdict] || verdict.toUpperCase()
                : (verdict === 'star' ? '\u2605 STAR' : verdict.toUpperCase());

            let html = '';

            if (showHeader) {
                html += `<div class="pd-header">
                    <span class="position-badge ${posConfig.class}">${posConfig.short}</span>
                    <span class="pd-header-name">${player.isCaptain ? '\ud83d\udc51 ' : ''}${escHTML(player.name)}</span>
                    <span class="pd-header-meta">${escHTML(player.team)} \u00b7 \u00a3${player.price.toFixed(1)}m \u00b7 ${player.ownership.toFixed(1)}% owned</span>
                </div>`;
            }

            if (showReport) {
                // Every other number on this card is season-to-date or a projection,
                // so what the player actually did in the round just played had
                // nowhere to live \u2014 you had to leave the card to find out whether
                // the man you are reading about scored on Saturday.
                const gwLine = typeof gwPlayerReportLine === 'function' && typeof gwReviewTarget === 'function'
                    ? gwPlayerReportLine(player, gwReviewTarget())
                    : '';
                html += `<div class="detail-section pd-report">
                    <div class="detail-section-title">\ud83e\udde0 AI Report</div>
                    ${gwLine}
                    <div class="pd-report-text">${escHTML(buildPlayerNarrativeReport(player, analysis, context))}</div>
                </div>`;
            }

            // ===== PLAYER =====
            html += `<div class="pd-group"><div class="pd-group-title">\ud83d\udc64 Player</div>`;

            html += `<div class="detail-section">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
                    <div class="verdict-chip ${verdict}" style="font-size:13px;padding:6px 14px;">${chipLabel}</div>
                    <div style="font-size:14px;color:var(--text-secondary);flex:1;">${escHTML(verdictReason)}</div>
                </div>
                ${showRecommendation && recommendation ? `<div style="font-size:12px;color:var(--text-secondary);padding:8px 12px;background:rgba(167,139,250,0.06);border-radius:6px;margin-bottom:6px;border-left:3px solid var(--verdict-${verdict});"><strong>Recommendation:</strong> ${escHTML(recommendation)}</div>` : ''}
                <div style="font-size:11px;color:var(--text-muted);">Sell Rating: ${sellRating}/100</div>
            </div>`;

            html += `<div class="detail-section">
                <div class="detail-section-title">\ud83d\udcca Key Statistics <span style="font-weight:400;color:var(--text-muted);font-size:11px;">\u2014 ${statsScopeLabel}</span></div>
                <div class="detail-stats-grid">
                    ${renderDetailStat('Form', player.form.toFixed(1), player.form / 10, player.form >= 5 ? 'var(--verdict-hold)' : player.form < 3 ? 'var(--verdict-sell)' : 'var(--verdict-monitor)', `${posConfig.short} median: ${posConfig.formMedian}`)}
                    ${renderDetailStat('Pts/Game', player.ppg.toFixed(1), player.ppg / 10, player.ppg >= 5 ? 'var(--verdict-hold)' : player.ppg < 3 ? 'var(--verdict-sell)' : 'var(--text-primary)', `Total: ${player.points} pts`)}
                    ${renderDetailStat('Mins/Game', minsPerGame.toFixed(0), minsPerGame / 90, minsPerGame >= 80 ? 'var(--verdict-hold)' : minsPerGame < 60 ? 'var(--verdict-sell)' : 'var(--verdict-monitor)', `${player.starts} starts in ${gamesPlayed} GWs`)}
                    ${renderDetailStat('FDR', (player.avgFDR || 3).toFixed(1), 1 - ((player.avgFDR || 3) - 1) / 4, (player.avgFDR || 3) <= 2.8 ? 'var(--verdict-hold)' : (player.avgFDR || 3) >= 3.5 ? 'var(--verdict-sell)' : 'var(--text-primary)', 'Next 5 weighted avg')}
                    ${player.position >= 3 ? renderDetailStat('xGI/90', xGIPer90.toFixed(2), xGIPer90, xGIPer90 >= 0.5 ? 'var(--verdict-hold)' : xGIPer90 < 0.25 ? 'var(--verdict-sell)' : 'var(--text-primary)', `${player.goals}G ${player.assists}A (${player.xG.toFixed(1)}xG ${player.xA.toFixed(1)}xA)`) : ''}
                    ${renderDetailStat('Value', (player.ppm || 0).toFixed(1) + '/\u00a3m', Math.min((player.ppm || 0) / 30, 1), 'var(--color-info)', `Sell: \u00a3${(player.sellPrice || player.price).toFixed(1)}m`)}
                </div>
            </div>`;

            html += `<div class="detail-section">
                <div class="detail-section-title">\ud83d\udcc8 Season Numbers <span style="font-weight:400;color:var(--text-muted);font-size:11px;">\u2014 ${statsScopeLabel}</span></div>
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
                    ${player.position >= 3 ? `
                        <div class="metric-box"><div class="metric-label">Goals</div><div class="metric-value neutral">${player.goals}</div></div>
                        <div class="metric-box"><div class="metric-label">Assists</div><div class="metric-value neutral">${player.assists}</div></div>
                    ` : `
                        <div class="metric-box"><div class="metric-label">CS</div><div class="metric-value neutral">${player.cleanSheets}</div></div>
                        <div class="metric-box"><div class="metric-label">${player.position === 1 ? 'Saves' : 'Goals'}</div><div class="metric-value neutral">${player.position === 1 ? player.saves : player.goals}</div></div>
                    `}
                    <div class="metric-box"><div class="metric-label">Bonus</div><div class="metric-value neutral">${player.bonus}</div></div>
                    <div class="metric-box"><div class="metric-label">ICT</div><div class="metric-value neutral">${player.ictIndex.toFixed(0)}</div></div>
                </div>
                <div style="margin-top:8px;display:flex;gap:8px;">
                    <div class="metric-box" style="flex:1;"><div class="metric-label">Ownership</div><div class="metric-value neutral">${player.ownership.toFixed(1)}%</div></div>
                    <div class="metric-box" style="flex:1;"><div class="metric-label">Net Transfers</div><div class="metric-value ${(player.netTransfers||0) > 0 ? 'good' : (player.netTransfers||0) < -5000 ? 'bad' : 'neutral'}">${(player.netTransfers||0) > 0 ? '+' : ''}${((player.netTransfers||0) / 1000).toFixed(1)}k</div></div>
                    <div class="metric-box" style="flex:1;"><div class="metric-label">EP Next</div><div class="metric-value ${player.epNext >= 5 ? 'good' : 'neutral'}">${player.epNext.toFixed(1)}</div></div>
                </div>
            </div>`;

            html += renderRoutesToPoints(player);
            html += renderPriceWatchSection(player);

            if (concerns.length > 0) {
                html += `<div class="detail-section">
                    <div class="detail-section-title">\u26a0\ufe0f Concerns (${concerns.length})</div>
                    ${concerns.map(c => `<div class="insight-item ${c.type}">
                        ${c.title ? `<div style="font-size:13px;font-weight:600;margin-bottom:4px;">${escHTML(c.title)}</div>` : ''}
                        <div class="insight-text">${escHTML(c.text)}</div>
                    </div>`).join('')}
                </div>`;
            }

            if (positives.length > 0) {
                html += `<div class="detail-section">
                    <div class="detail-section-title">\u2705 Positives (${positives.length})</div>
                    ${positives.map(p => `<div class="insight-item positive">
                        ${p.title ? `<div style="font-size:13px;font-weight:600;margin-bottom:4px;">${escHTML(p.title)}</div>` : ''}
                        <div class="insight-text">${escHTML(p.text)}</div>
                    </div>`).join('')}
                </div>`;
            }

            if (fixtures.length > 0) {
                html += `<div class="detail-section">
                    <div class="detail-section-title">\ud83d\udcc5 Upcoming Fixtures</div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                        ${fixtures.map(f => `
                            <div class="fixture-chip fdr-${f.difficulty}" style="flex:1;min-width:52px;padding:8px 4px;">
                                <span style="display:block;font-size:9px;color:rgba(255,255,255,0.5);">GW${f.event}</span>
                                <span class="fixture-team">${escHTML(f.opponent)}</span>
                                <span class="fixture-venue">${f.isHome ? 'H' : 'A'}</span>
                            </div>`).join('')}
                    </div>
                </div>`;
            }

            if (showReplacements && (verdict === 'sell' || verdict === 'monitor')) {
                const replacements = findReplacements(player, 5);
                if (replacements.length > 0) {
                    const best = replacements[0];
                    html += `<div class="detail-section">
                        <div class="detail-section-title">\ud83d\udd04 Best Replacement Comparison</div>
                        <table class="comparison-table">
                            <tr><th></th><th>Current</th><th>Replacement</th></tr>
                            <tr><td>Player</td><td class="current">${escHTML(player.name)}</td><td class="replacement">${escHTML(best.name)}</td></tr>
                            <tr class="${best.form > player.form ? 'better' : best.form < player.form ? 'worse' : ''}"><td>Form</td><td class="current">${player.form.toFixed(1)}</td><td class="replacement">${best.form.toFixed(1)}</td></tr>
                            <tr class="${best.ppg > player.ppg ? 'better' : best.ppg < player.ppg ? 'worse' : ''}"><td>PPG</td><td class="current">${player.ppg.toFixed(1)}</td><td class="replacement">${best.ppg.toFixed(1)}</td></tr>
                            <tr class="${(best._fdr || 3) < (player.avgFDR || 3) ? 'better' : ''}"><td>FDR</td><td class="current">${(player.avgFDR || 3).toFixed(1)}</td><td class="replacement">${(best._fdr || 3).toFixed(1)}</td></tr>
                            <tr class="${best.price < player.price ? 'better' : ''}"><td>Price</td><td class="current">\u00a3${player.price.toFixed(1)}m</td><td class="replacement">\u00a3${best.price.toFixed(1)}m</td></tr>
                        </table>
                        <button class="ts-compare-btn" style="margin-top:10px;" onclick="openPairCompare(${player.id}, ${best.id})">Full Comparison <i data-lucide="arrow-right" class="icon"></i></button>
                    </div>`;

                    if (replacements.length > 1) {
                        html += `<div class="detail-section">
                            <div class="detail-section-title">Other Options</div>
                            ${replacements.slice(1).map((r, i) => `
                                <div class="replacement-card">
                                    <div class="replacement-rank">${i + 2}</div>
                                    <div class="replacement-info">
                                        <div class="replacement-name">${escHTML(r.name)}</div>
                                        <div class="replacement-meta">${escHTML(r.team)} \u00b7 \u00a3${r.price.toFixed(1)}m \u00b7 ${r.ownership.toFixed(1)}% owned</div>
                                    </div>
                                    <div class="replacement-stats">
                                        <div class="replacement-primary">${r.form.toFixed(1)}</div>
                                        <div class="replacement-secondary">Form</div>
                                    </div>
                                </div>`).join('')}
                        </div>`;
                    }
                }
            }

            html += `</div>`; // end pd-group Player

            // ===== TEAM =====
            const detailTA = teamAnalysis[player.teamId];
            const detailSS = seasonStats[player.teamId];
            if (detailTA) {
                const swingInfo = fixtureSwingData[player.teamId];
                const swingHtml = renderFixtureSwingDetail(swingInfo);
                html += `<div class="pd-group"><div class="pd-group-title">\ud83c\udfe2 Team \u2014 ${escHTML(player.team)}</div>
                <div class="detail-section">
                    <div class="detail-stats-grid">
                        ${renderDetailStat('Attack', detailTA.attackPower.toString(), detailTA.attackPower / 100, detailTA.attackPower >= 60 ? 'var(--verdict-hold)' : detailTA.attackPower < 40 ? 'var(--verdict-sell)' : 'var(--verdict-monitor)', `${detailTA.avgGoals.toFixed(1)} goals/game`)}
                        ${renderDetailStat('Defence', detailTA.defensePower.toString(), detailTA.defensePower / 100, detailTA.defensePower >= 60 ? 'var(--verdict-hold)' : detailTA.defensePower < 40 ? 'var(--verdict-sell)' : 'var(--verdict-monitor)', `${detailTA.avgConceded.toFixed(1)} conceded/game`)}
                        ${renderDetailStat('Form', detailTA.formRating.toString(), detailTA.formRating / 100, detailTA.formRating >= 60 ? 'var(--verdict-hold)' : detailTA.formRating < 35 ? 'var(--verdict-sell)' : 'var(--verdict-monitor)', `W${detailTA.wins} D${detailTA.draws} L${detailTA.losses} last 5`)}
                        ${renderDetailStat('Fixtures', detailTA.fixtureScore.toString(), detailTA.fixtureScore / 100, detailTA.fixtureScore >= 60 ? 'var(--verdict-hold)' : detailTA.fixtureScore < 35 ? 'var(--verdict-sell)' : 'var(--verdict-monitor)', `Avg FDR ${detailTA.avgFdr.toFixed(1)}`)}
                    </div>
                    ${detailSS ? `
                    <div style="margin-top:10px;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">
                        <div class="metric-box"><div class="metric-label">Season</div><div class="metric-value neutral" style="font-size:11px;">W${detailSS.wins} D${detailSS.draws} L${detailSS.losses}</div></div>
                        <div class="metric-box"><div class="metric-label">GF/GA</div><div class="metric-value ${detailSS.goalDiff > 0 ? 'good' : detailSS.goalDiff < -5 ? 'bad' : 'neutral'}" style="font-size:11px;">${detailSS.goalsFor}/${detailSS.goalsAgainst}</div></div>
                        <div class="metric-box"><div class="metric-label">CS%</div><div class="metric-value ${detailSS.csPercent >= 35 ? 'good' : detailSS.csPercent < 20 ? 'bad' : 'neutral'}">${detailSS.csPercent}%</div></div>
                        <div class="metric-box"><div class="metric-label">Pts</div><div class="metric-value neutral">${detailSS.points}</div></div>
                    </div>
                    <div style="margin-top:6px;display:grid;grid-template-columns:repeat(2,1fr);gap:6px;">
                        <div class="metric-box"><div class="metric-label">\ud83c\udfe0 Home</div><div class="metric-value neutral" style="font-size:10px;">W${detailSS.homeW}/${detailSS.homeP} \u2022 ${detailSS.homeGF}GF ${detailSS.homeGA}GA \u2022 ${detailSS.homeCS}CS</div></div>
                        <div class="metric-box"><div class="metric-label">\u2708\ufe0f Away</div><div class="metric-value neutral" style="font-size:10px;">W${detailSS.awayW}/${detailSS.awayP} \u2022 ${detailSS.awayGF}GF ${detailSS.awayGA}GA \u2022 ${detailSS.awayCS}CS</div></div>
                    </div>
                    ` : ''}
                    ${swingHtml}
                </div>
                </div>`; // end pd-group Team
            }

            // ===== OPPONENTS =====
            const oppSection = renderOpponentSection(player, fixtures);
            if (oppSection) {
                html += `<div class="pd-group"><div class="pd-group-title">\u2694\ufe0f Opponents</div>${oppSection}</div>`;
            }

            return html;
        }

        // Thin wrapper kept for the Squad Analysis inline row \u2014 everything the
        // old right-side panel showed, at the defaults (full header, AI report,
        // recommendation and replacement suggestions all on).
        function buildPlayerDetailHTML(playerId) {
            const analysis = analysisResults.find(a => a.player.id === playerId);
            if (!analysis) return '';
            return buildPlayerFullProfileHTML(analysis.player, analysis);
        }

        function renderDetailStat(label, value, barPct, color, context) {
            const pct = Math.max(0, Math.min(100, barPct * 100));
            return `<div class="detail-stat">
                <div class="detail-stat-label">${label}</div>
                <div class="detail-stat-value" style="color:${color}">${value}</div>
                <div class="detail-stat-bar"><div class="detail-stat-bar-fill" style="width:${pct}%;background:${color}"></div></div>
                ${context ? `<div class="detail-stat-context">${context}</div>` : ''}
            </div>`;
        }

        function closeDetailPanel(event) {
            if (event && event.target !== event.currentTarget) return;
            document.getElementById('detailOverlay').classList.remove('show');
        }

        function findReplacements(player, count = 5) {
            const bank = (picksData?.entry_history?.bank || 0) / 10;
            const maxPrice = (player.sellPrice || player.price) + bank + 0.5;
            const candidates = allPlayers.filter(p =>
                p.position === player.position && p.price <= maxPrice && p.id !== player.id &&
                (p.status === 'a' || p.status === 'd') && p.minutes >= minMinutesForCandidate() &&
                !selectedPlayers.some(sp => sp.id === p.id)
            );

            // Composite scoring — enhanced with team analysis
            candidates.forEach(c => {
                const fdr = c.fixtures.length >= 3
                    ? c.fixtures.slice(0, 3).reduce((s, f) => s + f.difficulty, 0) / 3 : 3;
                const cTA = teamAnalysis[c.teamId];
                let teamBonus = 0;
                if (cTA) {
                    teamBonus += (cTA.formRating - 50) / 25;              // Team form: up to ±2
                    if (c.position >= 3) teamBonus += (cTA.attackPower - 50) / 25;   // Team attack for attackers
                    if (c.position <= 2) teamBonus += (cTA.defensePower - 50) / 25;  // Team defence for defenders
                    teamBonus += (cTA.fixtureScore - 50) / 25;            // Team fixture score
                }
                c._score = (c.form * 3) + (c.ppg * 2.5) + (c.epNext * 2) + ((5 - fdr) * 2.5) + teamBonus + (c.ownership > 15 ? 1 : 0);
                c._fdr = fdr;
            });
            candidates.sort((a, b) => b._score - a._score);
            return candidates.slice(0, count);
        }

        // ===== SHARED AI SCOUTING REPORT — ADAPTER (scripts/compare-report.js) =====
        // Builds a player object shaped the way generateComparisonReport() expects
        // (l5/season windowed stats, history[], structured fixtures, teamScores) from
        // this page's flat allPlayers/playersDetailData pipeline. Works for squad members
        // and findReplacements() candidates alike — both live in the same allPlayers pool.
        function buildComparePlayer(playerId) {
            const base = allPlayersById[playerId];
            if (!base) return null;

            const history = (playersDetailData?.players || []).find(p => p.id === playerId)?.history || [];
            const l5 = calculateStats(history, true);
            const season = calculateStats(history, false);

            // teamFixtures is keyed by numeric team id (base.teamId), not base.team (short name).
            // Each entry's `.opponent` here is the short-name string; the report expects the
            // numeric id instead (it looks opponents up via teams[f.opponent]), so remap to
            // the numeric `.opponentId` — getting this backwards silently blanks fixture chips.
            const rawFixtures = teamFixtures[base.teamId] || [];
            const remap = f => ({ opponent: f.opponentId, difficulty: f.difficulty, isHome: f.isHome, event: f.event });
            const next3 = rawFixtures.slice(0, 3).map(remap);
            const next5 = rawFixtures.slice(0, 5).map(remap);
            const fixtures = next3.length > 0 ? {
                avgFDR3: next3.reduce((s, f) => s + f.difficulty, 0) / next3.length,
                avgFDR5: next5.reduce((s, f) => s + f.difficulty, 0) / next5.length,
                next3, next5,
                fixtureString: next3.map(f => `${teams[f.opponent]?.short_name || '???'}(${f.isHome ? 'H' : 'A'})`).join(', ')
            } : null;

            return {
                ...base,
                selectedBy: base.ownership,
                totalPoints: base.points,
                l5, season, history, fixtures,
                teamScores: teamAnalysis[base.teamId]
            };
        }

        // This page's hook into the shared compare-report.js engine.
        function onCompareCheckboxChange(playerId) {
            const player = buildComparePlayer(playerId);
            if (player) toggleComparePlayer(player);
        }

        // Called by the shared engine after compareList changes. Cheap partial update —
        // syncs checked/disabled state and the .selected-row highlight on every currently
        // rendered compare checkbox, without re-rendering any section's HTML.
        function onCompareSelectionChange() {
            document.querySelectorAll('.compare-checkbox[data-player-id]').forEach(cb => {
                const id = parseInt(cb.dataset.playerId, 10);
                const isSelected = compareList.some(p => p.id === id);
                cb.checked = isSelected;
                cb.disabled = !isSelected && compareList.length >= MAX_COMPARE;
                const row = cb.closest('[data-compare-row]');
                if (row) row.classList.toggle('selected-row', isSelected);
            });
        }

        // ===== TEAM XG ENGINE =====

        // Build team-level xG data from player history (ported from teams-analysis)
        function buildTeamXgData(bootstrapElements) {
            teamXgData = {};
            Object.keys(teams).forEach(tid => {
                teamXgData[tid] = {
                    seasonXg: 0, seasonXa: 0, seasonXgc: 0, seasonGoals: 0, seasonAssists: 0, seasonConceded: 0, seasonGames: 0,
                    perGw: {}, hasPerGwData: false
                };
            });

            // Season-level from bootstrap elements
            (bootstrapElements || []).forEach(p => {
                if (p.minutes > 0 && teamXgData[p.team]) {
                    teamXgData[p.team].seasonXg += parseFloat(p.expected_goals) || 0;
                    teamXgData[p.team].seasonXa += parseFloat(p.expected_assists) || 0;
                    teamXgData[p.team].seasonGoals += p.goals_scored || 0;
                    teamXgData[p.team].seasonAssists += p.assists || 0;
                }
            });

            // Season games + conceded from fixtures
            const finished = allFixtures.filter(f => f.finished_provisional && f.team_h_score !== null);
            finished.forEach(f => {
                if (teamXgData[f.team_h]) { teamXgData[f.team_h].seasonGames++; teamXgData[f.team_h].seasonConceded += f.team_a_score || 0; }
                if (teamXgData[f.team_a]) { teamXgData[f.team_a].seasonGames++; teamXgData[f.team_a].seasonConceded += f.team_h_score || 0; }
            });

            // Per-GW from players-data.json (richer)
            if (playersDetailData && playersDetailData.players) {
                playersDetailData.players.forEach(player => {
                    const tid = player.team;
                    if (!teamXgData[tid]) return;
                    (player.history || []).forEach(h => {
                        const gw = h.round;
                        const fixtureKey = h.fixture;
                        if (!teamXgData[tid].perGw[gw]) {
                            teamXgData[tid].perGw[gw] = { xG: 0, xA: 0, xGC: 0, goals: 0, assists: 0, conceded: 0, wasHome: null, oppTeam: null, xGC_90min: 0, _fixtures: {} };
                        }
                        const d = teamXgData[tid].perGw[gw];
                        d.xG += parseFloat(h.expected_goals) || 0;
                        d.xA += parseFloat(h.expected_assists) || 0;
                        const tGoals = h.was_home ? (h.team_h_score || 0) : (h.team_a_score || 0);
                        const tConceded = h.was_home ? (h.team_a_score || 0) : (h.team_h_score || 0);
                        if (!d._fixtures[fixtureKey]) {
                            d._fixtures[fixtureKey] = true;
                            d.goals += tGoals;
                            d.conceded += tConceded;
                        }
                        d.wasHome = h.was_home;
                        d.oppTeam = h.opponent_team;
                        if (h.minutes >= 85) {
                            const xgc = parseFloat(h.expected_goals_conceded) || 0;
                            const fxKey = `_xgc_${fixtureKey}`;
                            if (!d[fxKey]) { d[fxKey] = true; d.xGC_90min += xgc; }
                        }
                    });
                });

                Object.keys(teamXgData).forEach(tid => {
                    const gwKeys = Object.keys(teamXgData[tid].perGw);
                    if (gwKeys.length > 0) {
                        teamXgData[tid].hasPerGwData = true;
                        teamXgData[tid].seasonXgc = gwKeys.reduce((sum, gw) => sum + teamXgData[tid].perGw[gw].xGC_90min, 0);
                    }
                });
            }
        }

        function getTeamXgWindow(teamId, windowSize = 6) {
            const data = teamXgData[teamId];
            if (!data || !data.hasPerGwData) return null;
            const gws = Object.keys(data.perGw).map(Number).sort((a, b) => a - b);
            const recentGws = gws.slice(-windowSize);
            if (recentGws.length === 0) return null;
            const n = recentGws.length;
            const totals = recentGws.reduce((acc, gw) => {
                const d = data.perGw[gw];
                acc.xG += d.xG; acc.xA += d.xA; acc.xGC += d.xGC_90min;
                acc.goals += d.goals; acc.conceded += d.conceded;
                return acc;
            }, { xG: 0, xA: 0, xGC: 0, goals: 0, conceded: 0 });
            return {
                games: n, xGpg: totals.xG / n, xGCpg: totals.xGC / n,
                gpg: totals.goals / n, gapg: totals.conceded / n,
                totalXg: totals.xG, totalGoals: totals.goals,
                totalXgc: totals.xGC, totalConceded: totals.conceded
            };
        }

        function getTeamSeasonXg(teamId) {
            const data = teamXgData[teamId];
            if (!data) return null;
            const g = data.seasonGames || 1;
            return {
                games: data.seasonGames, xGpg: data.seasonXg / g, xGCpg: data.seasonXgc / g,
                gpg: data.seasonGoals / g, gapg: data.seasonConceded / g,
                totalXg: data.seasonXg, totalGoals: data.seasonGoals,
                totalXgc: data.seasonXgc, totalConceded: data.seasonConceded
            };
        }

        /* Upcoming fixtures per team, kept by GAMEWEEK rather than by fixture count.

           This used to take the next six fixtures. Two things quietly eat those
           six slots. A double gameweek spends two of them on one gameweek. And
           once the current gameweek kicks off it is still "not finished", so it
           holds a slot of its own — while the draft planner, which excludes any
           gameweek already under way, has moved on to plan the six AFTER it.

           The planner's last gameweek then had no fixture stored, and
           projectPlayerPointsForGW returns zero for a gameweek it cannot find —
           so the whole squad projected zero and the gameweek read as a blank.
           Storing eight whole gameweeks leaves headroom over the planner's six
           and the transfer wizard's five. */
        const FIXTURE_GW_SPAN = 8;

        function processFixtures6(fixturesData) {
            // Built by the shared engine, so the dashboard cannot drift from this.
            teamFixtures6 = xpBuildTeamFixtures(fixturesData, teams, FIXTURE_GW_SPAN);
        }

        // Get per-player recent stats from players-data.json history
        function getPlayerRecentStats(playerId, windowSize = 6) {
            if (!playersDetailData || !playersDetailData.players) return null;
            const pd = playersDetailData.players.find(p => p.id === playerId);
            if (!pd || !pd.history) return null;
            const played = pd.history.filter(h => h.minutes > 0);
            const window = played.slice(-windowSize);
            if (window.length === 0) return null;
            const totalMins = window.reduce((s, h) => s + h.minutes, 0);
            if (totalMins === 0) return null;
            const sum = (key) => window.reduce((s, h) => s + (parseFloat(h[key]) || 0), 0);
            const per90 = (val) => totalMins > 0 ? (val / totalMins) * 90 : 0;
            const cs = window.reduce((s, h) => s + (h.clean_sheets || 0), 0);
            const gamesCS = window.filter(h => h.minutes >= 60).length;
            return {
                games: window.length, minutes: totalMins,
                goals: sum('goals_scored'), assists: sum('assists'),
                xG: sum('expected_goals'), xA: sum('expected_assists'),
                xGI: sum('expected_goal_involvements'), xGC: sum('expected_goals_conceded'),
                cs: cs, saves: sum('saves'), bonus: sum('bonus'), bps: sum('bps'),
                points: sum('total_points'),
                xGPer90: per90(sum('expected_goals')),
                xAPer90: per90(sum('expected_assists')),
                xGIPer90: per90(sum('expected_goal_involvements')),
                xGCPer90: per90(sum('expected_goals_conceded')),
                csPercent: gamesCS > 0 ? (cs / gamesCS) * 100 : 0,
                savesPer90: per90(sum('saves')),
                savePct: (() => { const sa = sum('saves'); const gc = sum('goals_conceded'); return (sa + gc) > 0 ? (sa / (sa + gc)) * 100 : 0; })(),
                ppg: window.length > 0 ? sum('total_points') / window.length : 0
            };
        }

        // Get season per-90 stats from bootstrap aggregates
        function getPlayerSeasonPer90(player) {
            const mins = player.minutes || 1;
            const per90 = (val) => (val / mins) * 90;
            const gamesPlayed = Math.max(currentGW - 1, 1);
            const gamesCS = player.starts || Math.round(mins / 90);
            return {
                xGPer90: per90(player.xG), xAPer90: per90(player.xA),
                xGIPer90: per90(player.xGI), xGCPer90: per90(player.xGC),
                csPercent: gamesCS > 0 ? (player.cleanSheets / gamesCS) * 100 : 0,
                savesPer90: per90(player.saves),
                savePct: (player.saves + player.goalsConceded) > 0 ? (player.saves / (player.saves + player.goalsConceded)) * 100 : 0,
                goals: player.goals, assists: player.assists, ppg: player.ppg
            };
        }

        // Get the position-specific stats for a player (3 key stats)
        function getPositionStats(player, seasonStats, recentStats) {
            const pos = player.position;
            const fmt = (v) => v != null ? v.toFixed(2) : '-';
            const fmtPct = (v) => v != null ? v.toFixed(0) + '%' : '-';

            const season = seasonStats || {};
            const recent = recentStats || {};

            if (pos === 1) { // GK
                return [
                    { label: '<abbr title="Save Percentage — saves ÷ shots on target faced">Sv%</abbr>', season: fmtPct(season.savePct), recent: fmtPct(recent.savePct), sVal: season.savePct || 0, rVal: recent.savePct || 0, higherBetter: true },
                    { label: '<abbr title="Expected Goals Conceded per 90 minutes">xGC/90</abbr>', season: fmt(season.xGCPer90), recent: fmt(recent.xGCPer90), sVal: season.xGCPer90 || 0, rVal: recent.xGCPer90 || 0, higherBetter: false },
                    { label: '<abbr title="Clean Sheet Percentage — % of matches with zero goals conceded">CS%</abbr>', season: fmtPct(season.csPercent), recent: fmtPct(recent.csPercent), sVal: season.csPercent || 0, rVal: recent.csPercent || 0, higherBetter: true }
                ];
            } else if (pos === 2) { // DEF
                return [
                    { label: '<abbr title="Expected Goals Conceded per 90 minutes">xGC/90</abbr>', season: fmt(season.xGCPer90), recent: fmt(recent.xGCPer90), sVal: season.xGCPer90 || 0, rVal: recent.xGCPer90 || 0, higherBetter: false },
                    { label: '<abbr title="Clean Sheet Percentage — % of matches with zero goals conceded">CS%</abbr>', season: fmtPct(season.csPercent), recent: fmtPct(recent.csPercent), sVal: season.csPercent || 0, rVal: recent.csPercent || 0, higherBetter: true },
                    { label: '<abbr title="Expected Goal Involvements (xG + xA) per 90 minutes">xGI/90</abbr>', season: fmt(season.xGIPer90), recent: fmt(recent.xGIPer90), sVal: season.xGIPer90 || 0, rVal: recent.xGIPer90 || 0, higherBetter: true }
                ];
            } else if (pos === 3) { // MID
                return [
                    { label: '<abbr title="Expected Goal Involvements (xG + xA) per 90 minutes">xGI/90</abbr>', season: fmt(season.xGIPer90), recent: fmt(recent.xGIPer90), sVal: season.xGIPer90 || 0, rVal: recent.xGIPer90 || 0, higherBetter: true },
                    { label: '<abbr title="Expected Goals per 90 minutes">xG/90</abbr>', season: fmt(season.xGPer90), recent: fmt(recent.xGPer90), sVal: season.xGPer90 || 0, rVal: recent.xGPer90 || 0, higherBetter: true },
                    { label: '<abbr title="Expected Assists per 90 minutes">xA/90</abbr>', season: fmt(season.xAPer90), recent: fmt(recent.xAPer90), sVal: season.xAPer90 || 0, rVal: recent.xAPer90 || 0, higherBetter: true }
                ];
            } else { // FWD
                return [
                    { label: '<abbr title="Expected Goals per 90 minutes">xG/90</abbr>', season: fmt(season.xGPer90), recent: fmt(recent.xGPer90), sVal: season.xGPer90 || 0, rVal: recent.xGPer90 || 0, higherBetter: true },
                    { label: '<abbr title="Expected Goal Involvements (xG + xA) per 90 minutes">xGI/90</abbr>', season: fmt(season.xGIPer90), recent: fmt(recent.xGIPer90), sVal: season.xGIPer90 || 0, rVal: recent.xGIPer90 || 0, higherBetter: true },
                    { label: 'Goals', season: String(season.goals || 0), recent: String(recent.goals || 0), sVal: season.goals || 0, rVal: recent.goals || 0, higherBetter: true }
                ];
            }
        }

        // Determine trend arrow for a stat comparing season to recent
        function getTrend(seasonVal, recentVal, higherBetter) {
            if (seasonVal == null || recentVal == null || seasonVal === 0) return { icon: '', cls: 'flat' };
            const diff = recentVal - seasonVal;
            const pct = Math.abs(diff / (seasonVal || 1));
            if (pct < 0.08) return { icon: '', cls: 'flat' };
            const improving = higherBetter ? diff > 0 : diff < 0;
            return { icon: improving ? '▲' : '▼', cls: improving ? 'up' : 'down' };
        }

        // Rate how good a stat value is (for color coding)
        function rateStat(value, label, position) {
            // Thresholds per stat for "good" / "avg" / "poor"
            const thresholds = {
                'xGI/90': [0.35, 0.2], 'xG/90': [0.3, 0.15], 'xA/90': [0.2, 0.1],
                'xGC/90': [1.0, 1.4], // lower is better
                'CS%': [35, 20], 'Sv%': [70, 60], 'Goals': [6, 3],
                'Saves/90': [3, 2]
            };
            const t = thresholds[label];
            if (!t) return 'avg';
            const lowerBetter = label === 'xGC/90';
            if (lowerBetter) return value <= t[0] ? 'good' : value >= t[1] ? 'poor' : 'avg';
            return value >= t[0] ? 'good' : value <= t[1] ? 'poor' : 'avg';
        }

        function getFormation(lineup) {
            const starters = lineup.filter(p => !p.onBench);
            const def = starters.filter(p => p.position === 2).length;
            const mid = starters.filter(p => p.position === 3).length;
            const fwd = starters.filter(p => p.position === 4).length;
            return `${def}-${mid}-${fwd}`;
        }

        function isValidFormation(lineup) {
            const starters = lineup.filter(p => !p.onBench);
            if (starters.length !== 11) return false;
            const gk = starters.filter(p => p.position === 1).length;
            const def = starters.filter(p => p.position === 2).length;
            const mid = starters.filter(p => p.position === 3).length;
            const fwd = starters.filter(p => p.position === 4).length;
            return gk === 1 && def >= 3 && mid >= 2 && fwd >= 1;
        }

        function renderTeamContextCard(tid, showOpponent) {
            const team = teams[tid];
            if (!team) return '';
            const ta = teamAnalysis[tid];
            const sXg = getTeamSeasonXg(tid);
            const rXg = getTeamXgWindow(tid, 6);
            const ss = seasonStats[tid];

            // Without opponent, render a minimal stat card
            if (!showOpponent) {
                const homeCSPct = ss && ss.homeP > 0 ? Math.round((ss.homeCS / ss.homeP) * 100) : null;
                const awayCSPct = ss && ss.awayP > 0 ? Math.round((ss.awayCS / ss.awayP) * 100) : null;
                function sc(label, value, color) {
                    return `<div style="text-align:center;"><div style="color:var(--text-muted);font-size:0.58rem;text-transform:uppercase;letter-spacing:0.3px;">${label}</div><div style="font-family:var(--font-mono);font-weight:700;font-size:0.78rem;color:${color || 'var(--text-primary)'};">${value}</div></div>`;
                }
                function pw(v) { return v > 60 ? 'var(--color-success)' : v < 40 ? 'var(--color-error)' : 'var(--text-secondary)'; }
                let html = `<div class="h2h-card"><div class="h2h-header"><div class="h2h-header-teams">${team.short_name || team.name}</div></div><div class="h2h-body">`;
                html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:0.72rem;margin-bottom:8px;">`;
                if (ta) { html += sc('ATK', ta.attackPower, pw(ta.attackPower)); html += sc('DEF', ta.defensePower, pw(ta.defensePower)); }
                html += `</div>`;
                if (sXg) { html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:0.72rem;">` + sc('xG/g', sXg.xGpg.toFixed(2), '') + sc('xGC/g', sXg.xGCpg.toFixed(2), '') + `</div>`; }
                html += `</div></div>`;
                return html;
            }

            // H2H matchup card
            const fixtures = teamFixtures6[tid] || [];
            const nextFix = fixtures[0];
            if (!nextFix || !nextFix.opponentId) return '';

            const oppId = nextFix.opponentId;
            const oppTeam = teams[oppId];
            const oppTa = teamAnalysis[oppId];
            const oppSXg = getTeamSeasonXg(oppId);
            const oppRXg = getTeamXgWindow(oppId, 6);
            const oppSS = seasonStats[oppId];
            const isHome = nextFix.isHome;

            // Traffic light grading
            function tl(v) { return v > 60 ? 'green' : v < 40 ? 'red' : 'amber'; }
            function tlInv(v) { return v < 40 ? 'green' : v > 60 ? 'red' : 'amber'; }

            // Power comparison row helper
            function powerRow(label, myVal, oppVal, invertGrade) {
                const myGrade = invertGrade ? tlInv(myVal) : tl(myVal);
                const oppGrade = invertGrade ? tlInv(oppVal) : tl(oppVal);
                const myPct = Math.min(Math.round(myVal), 100);
                const oppPct = Math.min(Math.round(oppVal), 100);
                return `<div class="h2h-power-row">
                    <div class="h2h-power-label">${label}</div>
                    <div class="h2h-power-bar h2h-power-bar-l"><div class="h2h-power-bar-fill h2h-bg-${myGrade}" style="width:${myPct}%;"></div></div>
                    <div class="h2h-power-val h2h-tl-${myGrade}">${myVal}</div>
                    <div class="h2h-vs">v</div>
                    <div class="h2h-power-val h2h-tl-${oppGrade}">${oppVal}</div>
                    <div class="h2h-power-bar h2h-power-bar-r"><div class="h2h-power-bar-fill h2h-bg-${oppGrade}" style="width:${oppPct}%;"></div></div>
                    <div class="h2h-power-label-r">${label}</div>
                </div>`;
            }

            // xG tug-of-war bar helper
            function xgBar(label, myVal, oppVal, lowerIsBetter) {
                const total = myVal + oppVal || 1;
                const myPct = Math.round((myVal / total) * 100);
                const oppPct = 100 - myPct;
                let myColor, oppColor;
                if (lowerIsBetter) {
                    myColor = myVal <= oppVal ? 'var(--color-success)' : 'var(--color-error)';
                    oppColor = oppVal <= myVal ? 'var(--color-success)' : 'var(--color-error)';
                } else {
                    myColor = myVal >= oppVal ? 'var(--color-success)' : 'var(--color-error)';
                    oppColor = oppVal >= myVal ? 'var(--color-success)' : 'var(--color-error)';
                }
                return `<div class="h2h-xg-row">
                    <div class="h2h-xg-labels"><span>${myVal.toFixed(2)}</span><span>${oppVal.toFixed(2)}</span></div>
                    <div class="h2h-xg-bar">
                        <div class="h2h-xg-bar-left" style="width:${myPct}%;background:${myColor};"></div>
                        <div class="h2h-xg-bar-right" style="width:${oppPct}%;background:${oppColor};"></div>
                    </div>
                    <div class="h2h-xg-stat-label">${label}</div>
                </div>`;
            }

            // Generate verdict
            function buildVerdict() {
                const tags = [];
                const lines = [];
                const myAtk = isHome ? (ta?.attackPowerHome || 50) : (ta?.attackPowerAway || 50);
                const myDef = isHome ? (ta?.defensePowerHome || 50) : (ta?.defensePowerAway || 50);
                const oppAtk = isHome ? (oppTa?.attackPowerAway || 50) : (oppTa?.attackPowerHome || 50);
                const oppDef = isHome ? (oppTa?.defensePowerAway || 50) : (oppTa?.defensePowerHome || 50);

                // Attacking assessment
                if (oppDef < 40) {
                    tags.push('<span class="h2h-verdict-tag attacking">ATTACKING</span>');
                    lines.push(`Opponent's ${isHome ? 'away' : 'home'} defence is weak (${oppDef}). Target attackers and captain picks.`);
                } else if (oppDef < 55 && myAtk > 55) {
                    tags.push('<span class="h2h-verdict-tag attacking">ATTACKING</span>');
                    lines.push(`Good attacking fixture. Your ${isHome ? 'home' : 'away'} attack (${myAtk}) should find opportunities.`);
                }

                // Defensive assessment
                if (oppAtk < 40) {
                    tags.push('<span class="h2h-verdict-tag defending">CLEAN SHEET</span>');
                    lines.push(`High clean sheet potential — opponent's ${isHome ? 'away' : 'home'} attack is poor (${oppAtk}).`);
                } else if (oppAtk > 65) {
                    lines.push(`Opponent has strong ${isHome ? 'away' : 'home'} attack (${oppAtk}). Clean sheet unlikely.`);
                }

                // Tricky / tough
                if (oppDef > 65 && oppAtk > 55) {
                    tags.push('<span class="h2h-verdict-tag tough">TOUGH</span>');
                    lines.push('Tough fixture — consider benching weaker assets.');
                } else if (oppDef > 55 && myAtk < 45) {
                    tags.push('<span class="h2h-verdict-tag tricky">TRICKY</span>');
                    lines.push('Your attack may struggle here. Manage expectations.');
                }

                // xG context
                if (sXg && oppSXg) {
                    if (sXg.xGpg > oppSXg.xGCpg * 1.3) {
                        lines.push(`xG advantage: your ${sXg.xGpg.toFixed(2)} xG/g exceeds their ${oppSXg.xGCpg.toFixed(2)} xGC/g.`);
                    }
                }

                if (tags.length === 0 && lines.length === 0) {
                    tags.push('<span class="h2h-verdict-tag tricky">BALANCED</span>');
                    lines.push('Evenly matched fixture. Keep your strongest lineup and avoid unnecessary risks.');
                }

                return `<div class="h2h-verdict">
                    <div class="h2h-verdict-title">💡 FPL Verdict</div>
                    <div class="h2h-verdict-text">${tags.join('')} ${lines.join(' ')}</div>
                </div>`;
            }

            // === Build H2H card ===
            let html = `<div class="h2h-card">`;

            // Header
            const venueClass = isHome ? 'h2h-venue-home' : 'h2h-venue-away';
            const venueText = isHome ? 'HOME' : 'AWAY';
            html += `<div class="h2h-header">
                <div class="h2h-header-teams">⚔️ ${escHTML(team.short_name || team.name)} vs ${escHTML(oppTeam?.short_name || nextFix.opponent)}</div>
                <div class="h2h-header-meta">
                    <span class="h2h-venue ${venueClass}">${venueText}</span>
                    <span class="planner-fdr-cell fdr-${nextFix.difficulty}" style="padding:2px 6px;font-size:0.6rem;"><abbr title="Fixture Difficulty Rating (1=easiest, 5=hardest)">FDR</abbr> ${nextFix.difficulty}</span>
                </div>
            </div>`;

            html += `<div class="h2h-body">`;

            // Power grid — venue-specific
            const myAtkV = isHome ? (ta?.attackPowerHome || 50) : (ta?.attackPowerAway || 50);
            const myDefV = isHome ? (ta?.defensePowerHome || 50) : (ta?.defensePowerAway || 50);
            const oppAtkV = isHome ? (oppTa?.attackPowerAway || 50) : (oppTa?.attackPowerHome || 50);
            const oppDefV = isHome ? (oppTa?.defensePowerAway || 50) : (oppTa?.defensePowerHome || 50);

            html += `<div class="h2h-power-grid">`;
            html += powerRow('ATK', ta?.attackPower || 50, oppTa?.attackPower || 50, false);
            html += powerRow('DEF', ta?.defensePower || 50, oppTa?.defensePower || 50, false);
            html += powerRow(`ATK ${isHome ? '(H)' : '(A)'}`, myAtkV, oppAtkV, false);
            html += powerRow(`DEF ${isHome ? '(H)' : '(A)'}`, myDefV, oppDefV, false);
            html += `</div>`;

            // xG tug-of-war
            if (sXg && oppSXg) {
                html += `<div class="h2h-xg-section">`;
                html += `<div class="h2h-xg-title">⚡ Expected Goals Comparison</div>`;
                html += xgBar('xG per game (season)', sXg.xGpg, oppSXg.xGpg, false);
                html += xgBar('xGC per game (season)', sXg.xGCpg, oppSXg.xGCpg, true);
                if (rXg && oppRXg) {
                    html += xgBar('xG per game (last 6)', rXg.xGpg, oppRXg.xGpg, false);
                    html += xgBar('xGC per game (last 6)', rXg.xGCpg, oppRXg.xGCpg, true);
                }
                html += `</div>`;
            }

            // CS%
            const myCSPct = isHome ? (ss && ss.homeP > 0 ? Math.round((ss.homeCS / ss.homeP) * 100) : null) : (ss && ss.awayP > 0 ? Math.round((ss.awayCS / ss.awayP) * 100) : null);
            const oppCSPct = isHome ? (oppSS && oppSS.awayP > 0 ? Math.round((oppSS.awayCS / oppSS.awayP) * 100) : null) : (oppSS && oppSS.homeP > 0 ? Math.round((oppSS.homeCS / oppSS.homeP) * 100) : null);
            if (myCSPct !== null || oppCSPct !== null) {
                html += `<div class="h2h-cs-row">`;
                html += `<div class="h2h-cs-item"><div class="h2h-cs-label">${escHTML(team.short_name)} CS% (${isHome ? 'H' : 'A'})</div><div class="h2h-cs-val">${myCSPct !== null ? myCSPct + '%' : '-'}</div></div>`;
                html += `<div class="h2h-cs-item"><div class="h2h-cs-label">${escHTML(oppTeam?.short_name || nextFix.opponent)} CS% (${isHome ? 'A' : 'H'})</div><div class="h2h-cs-val">${oppCSPct !== null ? oppCSPct + '%' : '-'}</div></div>`;
                html += `</div>`;
            }

            // Verdict
            html += buildVerdict();

            html += `</div></div>`;
            return html;
        }

