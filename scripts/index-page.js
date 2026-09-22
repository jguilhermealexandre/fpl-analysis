/* The landing page and dashboard's own script.
 *
 * 131KB of this was inline in index.html, at the foot of a document that is
 * itself the render-blocking resource on the site's most visited page. Out
 * here it is three things it could not be inline: minified by the same
 * pipeline as every other script, cached on its own for a year behind ?v=,
 * and absent from the 178KB the browser had to parse before it could paint.
 *
 * Loaded in exactly the position the inline block occupied, after
 * sidebar-nav.js. Classic script, not a module, like everything else here:
 * execution order is source order, and the globals it declares are the ones
 * the page's inline onclick= handlers reach for by name.
 */

initIcons();
        loadFooter();

        // ===== FIRST-VISIT WELCOME BANNER =====
        function dismissWelcomeBanner() {
            var el = document.getElementById('welcomeBanner');
            if (el) el.classList.add('hidden');
            try { localStorage.setItem('easyfpl_visited', '1'); } catch(e) {}
        }
        (function() {
            try {
                var visited = localStorage.getItem('easyfpl_visited');
                var hasTeam = localStorage.getItem('fpl_team_id');
                if (!visited && !hasTeam) {
                    var el = document.getElementById('welcomeBanner');
                    if (el) el.classList.remove('hidden');
                    // Mark visited after first view
                    localStorage.setItem('easyfpl_visited', '1');
                }
            } catch(e) {}
        })();

        function onTeamIdSubmitted(teamId) {
            activateTeamPage(teamId);
        }

        function onTeamIdCleared() {
            /* Releases the has-team gate set before first paint. Without this
               the CSS that hides the marketing sections would outlive the team
               it was set for, and a cleared ID would leave an empty dashboard
               with no way back to the form. */
            document.documentElement.classList.remove('has-team');
            document.title = 'EasyFPL \u2014 Free FPL Analysis Tools';
            if (location.pathname === '/dashboard') {
                try { history.replaceState(null, '', '/'); } catch (e) { /* not fatal */ }
            }
            document.getElementById('onboardingCard').classList.remove('hidden');
            document.getElementById('newsStrip').classList.add('hidden');
            document.getElementById('headlinesWidget').classList.add('hidden');
            // Swap hero: show generic, hide personalized
            document.getElementById('heroGeneric').classList.remove('hidden');
            document.getElementById('heroMockup').classList.remove('hidden');
            document.getElementById('heroPersonalized').classList.add('hidden');
            document.querySelector('.hero-banner').classList.remove('hero-logged-in');
            // Show marketing landing sections
            document.getElementById('howItWorks').classList.remove('hidden');
            document.getElementById('trustBar').classList.remove('hidden');
            document.getElementById('featureWizard').classList.remove('hidden');
            document.getElementById('featureMyTeam').classList.remove('hidden');
            document.getElementById('featurePlayers').classList.remove('hidden');
            document.getElementById('featureTeams').classList.remove('hidden');
            document.getElementById('featureRivals').classList.remove('hidden');
            document.getElementById('featureWhat').classList.remove('hidden');
            document.getElementById('featureCompare').classList.remove('hidden');
            document.getElementById('testimonials').classList.remove('hidden');
            if (deadlineInterval) { clearInterval(deadlineInterval); deadlineInterval = null; }
        }

        function submitFromOnboarding() {
            const input = document.getElementById('onboardingInput');
            const teamId = input.value.trim();
            if (!teamId || isNaN(teamId)) return;
            saveTeamId(teamId);
            showNavTeamBadge(teamId);
            activateTeamPage(teamId);
        }

        /* Where the visitor was actually trying to go.
         *
         * The squad pages send a signed-out visitor here with ?next= set, so a
         * shared link survives signing in instead of dumping them on the
         * dashboard and leaving them to find their way back.
         *
         * Only a same-origin path is honoured, and it is rebuilt from the
         * parsed URL rather than used as given: taking the parameter at its
         * word would make this an open redirect, where a link to our own
         * domain lands on someone else's. A value like "//evil.example" parses
         * as a host, not a path, and comes back out of this as "/".
         */
        function nextAfterSignIn() {
            try {
                const raw = new URLSearchParams(location.search).get('next');
                if (!raw) return null;
                const url = new URL(raw, location.origin);
                if (url.origin !== location.origin) return null;
                if (!url.pathname.startsWith('/')) return null;
                return url.pathname + url.search + url.hash;
            } catch (e) { return null; }
        }

        function activateTeamPage(teamId) {
            /* Somewhere to be that is not here. Done before the dashboard is
               dressed, because none of that work is worth doing on a page we
               are about to leave. */
            const next = nextAfterSignIn();
            if (next) { location.replace(next); return; }

            /* Mirrors the pre-paint block at the top of <body> for the manager
               who arrives at the landing page and enters an ID: same class,
               same title, same URL, without a reload. */
            document.documentElement.classList.add('has-team');
            /* And the shell, which the pre-paint block does not decide — that
               happens in sidebar-nav.js, once, on load. Someone who arrives
               without a team and then types one into the form at the foot of
               this page was left with the landing header over a dashboard and
               no sidebar at all, until they reloaded. */
            if (typeof v2EnterAppShell === 'function') v2EnterAppShell();
            document.title = 'EasyFPL \u2014 Dashboard';
            if (location.pathname === '/' || location.pathname === '/index.html') {
                try { history.replaceState(null, '', '/dashboard' + location.search + location.hash); } catch (e) { /* not fatal */ }
            }
            const errEl = document.getElementById('onboardingError');
            if (errEl) errEl.classList.add('hidden');
            document.getElementById('onboardingCard').classList.add('hidden');
            var wb = document.getElementById('welcomeBanner');
            if (wb) wb.classList.add('hidden');
            // Swap hero: hide generic, show personalized
            document.getElementById('heroGeneric').classList.add('hidden');
            document.getElementById('heroMockup').classList.add('hidden');
            document.getElementById('heroPersonalized').classList.remove('hidden');
            document.querySelector('.hero-banner').classList.add('hero-logged-in');
            // Hide marketing landing sections
            document.getElementById('howItWorks').classList.add('hidden');
            document.getElementById('trustBar').classList.add('hidden');
            document.getElementById('featureWizard').classList.add('hidden');
            document.getElementById('featureMyTeam').classList.add('hidden');
            document.getElementById('featurePlayers').classList.add('hidden');
            document.getElementById('featureTeams').classList.add('hidden');
            document.getElementById('featureRivals').classList.add('hidden');
            document.getElementById('featureWhat').classList.add('hidden');
            document.getElementById('featureCompare').classList.add('hidden');
            document.getElementById('testimonials').classList.add('hidden');
            loadTicker(teamId);
        }

        // ===== ANALYSIS ENGINE (ported from fpl-my-team-analysis) =====
        function computePositionAverages(allPlayers, currentGW) {
            const posAvg = {};
            // The bar was a flat 200 minutes. One gameweek into a season nobody has
            // played more than 90, so every position fell through to the hardcoded
            // fallback below and the whole dashboard scored players against dummy
            // averages. Scale it with the season instead, as the squad page does.
            const minMinutes = Math.min(200, Math.max(currentGW - 1, 1) * 60);
            [1, 2, 3, 4].forEach(pos => {
                const pp = allPlayers.filter(p => p.position === pos && p.minutes >= minMinutes);
                if (pp.length === 0) { posAvg[pos] = { form: 3, ppg: 3, ppm: 15, xGIPer90: 0.3, medPrice: 0 }; return; }
                const avg = (arr, fn) => arr.reduce((s, p) => s + fn(p), 0) / arr.length;
                const prices = pp.map(p => p.price).sort((x, y) => x - y);
                posAvg[pos] = {
                    form: avg(pp, p => p.form),
                    ppg: avg(pp, p => p.ppg),
                    ppm: avg(pp, p => p.points / Math.max(p.price, 1)),
                    xGIPer90: avg(pp, p => p.minutes > 0 ? (p.xGI / p.minutes) * 90 : 0),
                    // Reference point for the engine's price-quality prior.
                    medPrice: prices[Math.floor(prices.length / 2)] || 0
                };
            });
            return posAvg;
        }


        function processFixtures(fixturesData, teams) {
            // Was its own copy, counting fixtures and filtering on `finished`
            // rather than `finished_provisional` — the same two bugs already
            // fixed in the shared builder. Five gameweeks is what the fixture
            // strips on this page display.
            return xpBuildTeamFixtures(fixturesData, teams, 5);
        }

        function analyzePlayerForTicker(player, posAvg, teamAnalysis, currentGW, settings) {
            let sellRating = 40;
            let topConcern = '';
            const posConfig = POSITION_CONFIG[player.position];
            const gamesPlayed = Math.max(currentGW - 1, 1);
            const minsPerGame = player.minutes / gamesPlayed;
            const isPremium = player.price >= 10.0;
            const isMidPremium = player.price >= 7.5;
            const ta = teamAnalysis[player.teamId];

            // Asymmetric sensitivity: penalties amplified in aggressive mode, bonuses dampened (and vice-versa for patient)
            const sensAdj = (raw, ...weights) => {
                const w = weights.reduce((a, b) => a * b, 1);
                const s = raw >= 0 ? settings.sellSensitivity : (2 - settings.sellSensitivity);
                return raw * s * w;
            };

            // 1. AVAILABILITY
            if (player.status === 'i' || player.status === 'u' || player.status === 's') {
                sellRating += sensAdj(40);
                const statusText = player.status === 'i' ? 'Injured' : player.status === 'u' ? 'Unavailable' : 'Suspended';
                topConcern = statusText;
            } else if (player.status === 'd') {
                const chance = player.chanceNextRound;
                const penalty = chance !== null ? Math.round((100 - chance) * 0.4) : 22;
                sellRating += sensAdj(penalty);
                topConcern = 'Doubtful';
            }

            // 2. FORM
            // FPL's form is average points over the last 30 days, so one gameweek
            // into a season it IS that one gameweek. Judged raw it flagged roughly
            // half the league as out of form after a single round. Regress it
            // toward the position median on the same evidence weight the squad
            // page uses, reaching the raw figure at four matches — so the
            // thresholds below keep their meaning and stop firing before anything
            // has been shown.
            const formEvidence = Math.min(1, gamesPlayed / 4);
            const effectiveForm = player.form * formEvidence + posConfig.formMedian * (1 - formEvidence);
            const formDelta = effectiveForm - posConfig.formMedian;
            const rawFormPenalty = Math.max(-30, Math.min(30, Math.round(-formDelta * 10)));
            sellRating += sensAdj(rawFormPenalty, settings.formWeight);
            // Say the number, not a label. "Poor Form" makes the manager work out
            // what it means; "1.0 pts/gm vs 3.5 average" is the actual argument.
            // Form only gets to be the headline concern once there is enough of a
            // season to diagnose it. Below three matches the regressed reading sits
            // near the median for everyone, so a marginal delta would crowd out the
            // fixture, minutes and availability reasons that are actually driving
            // the rating — and tell the manager the wrong thing to act on.
            const formDiagnosable = gamesPlayed >= 3;
            if (formDiagnosable && !topConcern && formDelta <= -1.5) topConcern = `Scoring ${player.form.toFixed(1)}/gm against a ${posConfig.formMedian} ${posConfig.short} average`;
            else if (formDiagnosable && !topConcern && formDelta <= -0.5) topConcern = `Below the ${posConfig.short} average at ${player.form.toFixed(1)} pts/gm`;

            // 3. FIXTURES
            const fixtures = player.fixtures || [];
            let avgFDR = 3;
            if (fixtures.length >= 3) {
                const weights = [3, 2.5, 2, 1.5, 1];
                let tw = 0, ws = 0;
                fixtures.slice(0, 5).forEach((f, i) => { const w = weights[i] || 1; ws += f.difficulty * w; tw += w; });
                avgFDR = ws / tw;
            }
            const rawFixPenalty = Math.max(-22, Math.min(22, Math.round((avgFDR - 3.0) * 14)));
            sellRating += sensAdj(rawFixPenalty, settings.fixtureWeight);
            if (!topConcern && avgFDR >= 3.8) topConcern = `Average fixture difficulty ${avgFDR.toFixed(1)} over the next five`;

            // 3b. OPPONENT QUALITY
            if (fixtures.length >= 3 && Object.keys(teamAnalysis).length > 0) {
                const oppWeights = [3, 2.5, 2, 1.5, 1];
                let oppWS = 0, oppTW = 0;
                fixtures.slice(0, 5).forEach((f, i) => {
                    const oppTA = teamAnalysis[f.opponentId]; if (!oppTA) return;
                    const w = oppWeights[i] || 1;
                    oppWS += ((player.position <= 2 ? (oppTA.attackPower - 50) : (oppTA.defensePower - 50)) / 50) * w;
                    oppTW += w;
                });
                if (oppTW > 0) { sellRating += sensAdj(Math.round(Math.max(-10, Math.min(12, (oppWS / oppTW) * 8))), settings.fixtureWeight); }
            }

            // 4. MINUTES & ROTATION
            let minsPenalty = 0;
            if (minsPerGame < 20) minsPenalty = 35;
            else if (minsPerGame < 60) minsPenalty = Math.round(32 - (minsPerGame - 20) * (32 / 40));
            else if (minsPerGame < 75) minsPenalty = Math.round(5 - (minsPerGame - 60) * (7 / 15));
            else if (minsPerGame >= 85) minsPenalty = -6;
            else minsPenalty = -2;
            sellRating += sensAdj(minsPenalty);
            if (!topConcern && minsPerGame < 45) topConcern = `Averaging ${Math.round(minsPerGame)} minutes a game — heavy rotation risk`;
            else if (!topConcern && minsPerGame < 65) topConcern = `Averaging ${Math.round(minsPerGame)} minutes a game`;

            // 5. VALUE FOR MONEY
            const pAvg = posAvg[player.position] || { form: 3, ppg: 3, ppm: 15 };
            const ppm = player.points / Math.max(player.price, 1);
            const ppmDelta = ppm - pAvg.ppm;
            const ppgDelta = player.ppg - pAvg.ppg;
            const valueSignal = (ppmDelta * 0.6) + (ppgDelta * 2.5);
            let rawValuePenalty = Math.max(-15, Math.min(22, Math.round(-valueSignal)));
            if (isPremium) rawValuePenalty = Math.round(rawValuePenalty * settings.premiumHarshness);
            else if (isMidPremium) rawValuePenalty = Math.round(rawValuePenalty * 1.2);
            sellRating += sensAdj(rawValuePenalty, settings.valueWeight);
            if (isPremium && player.form < posConfig.formMedian) {
                sellRating += sensAdj(5);
                if (!topConcern) topConcern = 'Premium Underperforming';
            }

            // 6. xG ANALYSIS
            if (player.position >= 3 && player.minutes >= 270) {
                const xGIPer90 = (player.xGI / player.minutes) * 90;
                const xGPenalty = Math.max(-15, Math.min(18, Math.round((0.35 - xGIPer90) * 35)));
                sellRating += sensAdj(xGPenalty);
                if (!topConcern && xGIPer90 < 0.20) topConcern = 'Low xGI';
                const actualGI = player.goals + player.assists;
                const overperf = actualGI - player.xGI;
                if (overperf > 2.0) { sellRating += sensAdj(Math.round(Math.min(12, overperf * 2.5))); if (!topConcern) topConcern = 'Overperforming xG'; }
            } else if (player.position <= 2 && player.minutes >= 270) {
                const csRate = player.cleanSheets / gamesPlayed;
                const csPenalty = Math.max(-10, Math.min(14, Math.round((0.28 - csRate) * 35)));
                sellRating += sensAdj(csPenalty);
                if (!topConcern && csRate <= 0.18 && player.price > 5.5) topConcern = 'Few Clean Sheets';
            }

            // 7. OWNERSHIP URGENCY
            if (player.ownership > 20 && sellRating > 45) { sellRating += sensAdj(5); }
            const netTransfers = player.transfersIn - player.transfersOut;
            if (netTransfers < -20000) { sellRating += sensAdj(4); }

            // 8. TEAM CONTEXT
            if (ta) {
                const teamFormDelta = (ta.formRating - 50) / 50;
                sellRating += sensAdj(Math.round(teamFormDelta * -8));
                // Same guard as player form: a club that lost its opening match
                // scores 0/100 here, and on one result that is the sample talking.
                // Four of eight alerts were this line before it was gated.
                if (formDiagnosable && !topConcern && ta.formRating < 30) {
                    topConcern = `${player.team} form rating ${ta.formRating}/100 — the club is struggling, not just the player`;
                }
                if (player.position >= 3) { sellRating += sensAdj(Math.round(((ta.attackPower - 50) / 50) * -8)); if (!topConcern && ta.attackPower < 35) topConcern = 'Weak Team Attack'; }
                if (player.position <= 2) { sellRating += sensAdj(Math.round(((ta.defensePower - 50) / 50) * -8)); if (!topConcern && ta.defensePower < 35) topConcern = 'Weak Team Defence'; }
                if (ta.fixtureScore < 30) { sellRating += sensAdj(4, settings.fixtureWeight); if (!topConcern) topConcern = 'Tough Team Fixtures'; }
            }

            sellRating = Math.max(0, Math.min(100, Math.round(sellRating)));

            let verdict;
            if (sellRating >= 55) verdict = 'sell';
            else if (sellRating >= 38) verdict = 'monitor';
            else if (sellRating <= 20 && effectiveForm >= posConfig.formMedian + 1.5 && minsPerGame >= 75) verdict = 'star';
            else verdict = 'hold';

            return { name: player.name, verdict, sellRating, topConcern };
        }

        // ===== TICKER RENDERING =====
        // ===== STATUS STRIP: deadline hero + GW points / rank / league / value =====
        function renderStatusStrip({ live, teamName, currentGW, rank, totalPoints, gwPoints, gwRank, bank, squadValue, rankDelta,
                                     pointsDiff, deadlineTime, deadlineGW, leagueInfo }) {
            const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
            /* A name you set in Settings is the one you want to see, so it
               wins over the one FPL holds — that is the whole point of being
               able to set it, and the sidebar has honoured it all along
               while the heading above it still said the other thing. */
            el('heroTeamName', (typeof v2AccountName === 'function' ? v2AccountName() : '') || teamName || 'My Team');
            // Left as a fallback for the moment before mdInit() runs; matchday.js
            // owns this element from then on and keeps it ticking.
            if (typeof mdCtx === 'undefined' || !mdCtx) el('heroGwBadge', 'GW' + currentGW);

            // ===== DEADLINE HERO CARD =====
            const heroEl = document.getElementById('v2DeadlineHero');
            if (deadlineTime) {
                const dlDate = new Date(deadlineTime);
                const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
                const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                const dlDay = dayNames[dlDate.getUTCDay()];
                const dlDateNum = dlDate.getUTCDate();
                const dlMonth = monthNames[dlDate.getUTCMonth()];
                const dlHour = String(dlDate.getUTCHours()).padStart(2, '0');
                const dlMin = String(dlDate.getUTCMinutes()).padStart(2, '0');
                heroEl.innerHTML = `
                    <div class="v2-dlh-top">
                        <span class="v2-dlh-label">GW${deadlineGW} Deadline</span>
                        <span class="v2-dlh-date">${dlDay} ${dlDateNum} ${dlMonth} · ${dlHour}:${dlMin} UTC</span>
                    </div>
                    <div class="v2-dlh-countdown" id="v2DeadlineCountdown">Loading…</div>`;
                if (deadlineInterval) clearInterval(deadlineInterval);
                function updateCountdown() {
                    const now = Date.now();
                    const diff = dlDate.getTime() - now;
                    const cdEl = document.getElementById('v2DeadlineCountdown');
                    if (!cdEl) return;
                    if (diff <= 0) { cdEl.textContent = 'LOCKED'; heroEl.className = 'v2-deadline-hero dl-urgent'; return; }
                    const days = Math.floor(diff / 86400000);
                    const hrs = Math.floor((diff % 86400000) / 3600000);
                    const mins = Math.floor((diff % 3600000) / 60000);
                    const secs = Math.floor((diff % 60000) / 1000);
                    let text = '';
                    if (days > 0) text = `${days}d ${hrs}h ${mins}m ${secs}s`;
                    else if (hrs > 0) text = `${hrs}h ${mins}m ${secs}s`;
                    else text = `${mins}m ${secs}s`;
                    cdEl.textContent = text;
                    heroEl.className = 'v2-deadline-hero' + (diff < 7200000 ? ' dl-urgent' : diff < 86400000 ? ' dl-soon' : '');
                }
                updateCountdown();
                deadlineInterval = setInterval(updateCountdown, 1000);
            } else {
                heroEl.className = 'v2-deadline-hero';
                heroEl.innerHTML = `
                    <div class="v2-dlh-top"><span class="v2-dlh-label">Deadline</span></div>
                    <div class="v2-dlh-countdown" style="font-size:20px;color:var(--text-muted);">No upcoming deadline</div>`;
            }

            // ===== STATUS STACK =====
            const diffSign = pointsDiff >= 0 ? '+' : '';

            let rankDeltaHtml = '';
            if (rankDelta !== null) {
                if (rankDelta > 0) rankDeltaHtml = `<span class="v2-stat-delta up"><i data-lucide="trending-up" class="icon"></i>${Math.abs(rankDelta).toLocaleString()}</span>`;
                else if (rankDelta < 0) rankDeltaHtml = `<span class="v2-stat-delta down"><i data-lucide="trending-down" class="icon"></i>${Math.abs(rankDelta).toLocaleString()}</span>`;
                else rankDeltaHtml = `<span class="v2-stat-delta flat">— No change</span>`;
            } else {
                rankDeltaHtml = `<span class="v2-stat-delta flat">NEW</span>`;
            }

            let stackHtml = '';
            if (live) {
                /* Bonus is kept out of the headline number. It is the one figure
                   here that is not yet real — the game has not confirmed it — and
                   a total that silently blends confirmed and projected points
                   cannot tell the manager which part of their score is safe. */
                const confirmed = live.points;
                const withBonus = live.points + live.projBonus;
                const vsAvg = live.average ? withBonus - live.average : null;
                const played = live.finished + live.inPlay;
                stackHtml += `<div class="v2-stat-card v2-live-card">
                    <div>
                        <div class="v2-stat-label">
                            <span class="v2-live-dot" aria-hidden="true"></span> GW${currentGW} Live
                        </div>
                        <div class="v2-stat-value">${confirmed}${live.projBonus > 0
                            ? `<span class="v2-live-bonus" title="Projected bonus from the BPS table. Not yet confirmed by the game.">+${live.projBonus} bonus</span>`
                            : ''}</div>
                        <div class="v2-stat-sub">
                            ${live.toPlay > 0
                                ? `${live.toPlay} player${live.toPlay === 1 ? '' : 's'} still to play`
                                : 'All players have featured'}${live.inPlay > 0 ? ` · ${live.inPlay} on the pitch` : ''}
                        </div>
                        ${vsAvg !== null ? `<div class="v2-stat-sub">
                            <span class="${vsAvg >= 0 ? 'v2-live-up' : 'v2-live-down'}">
                                ${vsAvg >= 0 ? '▲' : '▼'} ${Math.abs(vsAvg)} ${vsAvg >= 0 ? 'above' : 'below'} the gameweek average
                            </span> (${live.average})
                        </div>` : ''}
                        ${live.projBonus > 0 ? `<div class="v2-stat-sub v2-live-note">
                            ${withBonus} with projected bonus included
                        </div>` : ''}
                    </div>
                </div>`;
            } else {
                stackHtml += `<div class="v2-stat-card">
                    <div>
                        <div class="v2-stat-label"><i data-lucide="zap" class="icon"></i> GW${currentGW} Points</div>
                        <div class="v2-stat-value">${gwPoints}</div>
                        ${gwRank ? `<div class="v2-stat-sub">GW rank: ${gwRank.toLocaleString()}</div>` : ''}
                    </div>
                </div>`;
            }
            stackHtml += `<div class="v2-stat-card">
                <div>
                    <div class="v2-stat-label"><i data-lucide="trophy" class="icon"></i> Overall Rank</div>
                    <div class="v2-stat-value">${rank ? rank.toLocaleString() : '-'}</div>
                    <div class="v2-stat-sub">${totalPoints ? totalPoints.toLocaleString() : '-'} pts · ${diffSign}${pointsDiff} vs avg</div>
                </div>
                ${rankDeltaHtml}
            </div>`;
            stackHtml += `<div id="v2LeagueSlot"></div>`;
            stackHtml += `<div class="v2-stat-card v2-stat-card--minor">
                <div>
                    <div class="v2-stat-label"><i data-lucide="wallet" class="icon"></i> Squad Value</div>
                    <div class="v2-stat-value">£${squadValue.toFixed(1)}m</div>
                </div>
                <div class="v2-stat-sub">£${bank}m ITB</div>
            </div>`;
            document.getElementById('v2StatusStack').innerHTML = stackHtml;
            renderLeagueSlot(leagueInfo);

            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        // ===== MINI-LEAGUE CARD =====
        function renderLeagueSlot(leagueInfo) {
            const slot = document.getElementById('v2LeagueSlot');
            if (!slot) return;
            const esc = t => String(t == null ? '' : t)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            if (!leagueInfo) {
                if (localStorage.getItem('fpl_league_prompt_dismissed') === '1') { slot.innerHTML = ''; return; }
                slot.innerHTML = `<div class="v2-league-prompt" id="v2LeaguePrompt">
                    <span class="v2-league-prompt-text"><i data-lucide="trophy" class="icon"></i> Track a mini-league to compare against friends</span>
                    <div class="v2-league-prompt-actions">
                        <a href="/dashboard/rivals">Add league →</a>
                        <button type="button" class="v2-league-prompt-dismiss" onclick="dismissLeaguePrompt()" aria-label="Dismiss"><i data-lucide="x" class="icon"></i></button>
                    </div>
                </div>`;
                if (typeof lucide !== 'undefined') lucide.createIcons();
                return;
            }
            let deltaHtml = '';
            if (leagueInfo.lastRank != null && leagueInfo.lastRank > 0) {
                const d = leagueInfo.lastRank - leagueInfo.rank;
                if (d > 0) deltaHtml = `<span class="v2-stat-delta up"><i data-lucide="trending-up" class="icon"></i>${d}</span>`;
                else if (d < 0) deltaHtml = `<span class="v2-stat-delta down"><i data-lucide="trending-down" class="icon"></i>${Math.abs(d)}</span>`;
                else deltaHtml = `<span class="v2-stat-delta flat">—</span>`;
            }
            slot.innerHTML = `<a href="/dashboard/rivals" class="v2-league-card">
                <div>
                    <div class="v2-league-name"><i data-lucide="trophy" class="icon"></i> ${esc(leagueInfo.name)}</div>
                    <div class="v2-league-rank">#${leagueInfo.rank ? leagueInfo.rank.toLocaleString() : '-'}</div>
                    <div class="v2-league-gap" id="v2LeagueGap">Loading gap to 1st…</div>
                </div>
                ${deltaHtml}
            </a>`;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        function dismissLeaguePrompt() {
            localStorage.setItem('fpl_league_prompt_dismissed', '1');
            const el = document.getElementById('v2LeaguePrompt');
            if (el) el.remove();
        }

        async function loadLeagueGap(leagueId, teamId, ownTotalFallback) {
            try {
                const res = await fetchWithProxy(`https://fantasy.premierleague.com/api/leagues-classic/${leagueId}/standings/`);
                if (!res.ok) return;
                const data = await res.json();
                const results = (data.standings && data.standings.results) || [];
                const leader = results[0];
                const gapEl = document.getElementById('v2LeagueGap');
                if (!gapEl || !leader) return;
                const own = results.find(r => String(r.entry) === String(teamId));
                const ownTotal = own ? own.total : ownTotalFallback;
                const gap = leader.total - ownTotal;
                gapEl.textContent = gap <= 0 ? 'Leading the league!' : `${gap.toLocaleString()} pts behind 1st`;
            } catch (e) {
                const gapEl = document.getElementById('v2LeagueGap');
                if (gapEl) gapEl.textContent = '';
            }
        }

        // ===== NEEDS YOUR ATTENTION =====
        /* The two columns list problems, which is useful and, on a week with no
           problems, empty. "Lineup looks good" told a manager nothing about the
           gameweek they were about to play. Each column now opens with the state
           of that side of the team — what the eleven projects, who has the
           armband, what is in the bank, when the deadline is — and keeps the
           alerts underneath. */
        /* The latest Scout's Desk pieces.

           Three cards from the same archive the Scout's Desk page reads, newest
           first, with the gameweek debrief pulled to the front when there is one
           — it is written for the round just played and is the most relevant
           thing on the site the morning after a gameweek. The archive is
           optional: a missing index is a section that does not render, not an
           error, because nothing else on this page depends on it. */
        async function renderDeskFeed() {
            const el = document.getElementById('v2Desk');
            if (!el) return;
            const esc = t => String(t == null ? '' : t)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

            let idx = [];
            try {
                // The same five-minute buster this page's other data fetches use.
                idx = await fetch('/data/articles/index.json?v=' + Math.floor(Date.now() / 300000))
                    .then(r => r.ok ? r.json() : []);
            } catch (e) { return; }
            if (!Array.isArray(idx) || !idx.length) return;

            /* Newest gameweek first, and the debrief first WITHIN a gameweek.
             *
             * This used to promote every Gameweek Debrief above everything
             * else, then sort by gameweek — so the three cards were the GW4,
             * GW3 and GW2 debriefs, and a piece published for GW5 sat fifth
             * and never appeared. The panel silently aged: the newer the
             * article, the less likely it was to be shown.
             *
             * The intent in the old comment was singular — "the gameweek
             * debrief" — meaning the CURRENT one, which is the most relevant
             * thing on the site the morning after a round. That still holds
             * here: once GW5's debrief exists it is GW5 and a debrief, so it
             * leads. Until then the newest piece does, which is the whole
             * point of a "latest" panel. */
            const debriefFirst = [...idx].sort((a, b) => {
                const byGW = (b.gw || 0) - (a.gw || 0);
                if (byGW) return byGW;
                return (b.category === 'Gameweek Debrief') - (a.category === 'Gameweek Debrief');
            }).slice(0, 3);

            /* Same shell as Latest news above it — a panel with an icon in its
               heading and the green pill through to the full archive — because
               it is the same kind of block: a few of something, with a way to
               the rest. Two panels of headlines built two different ways sat
               badly one above the other. */
            el.innerHTML = `<div class="v2-desk-panel">
                <div class="v2-desk-head-row">
                    <span class="v2-desk-title">${typeof v2Icon === 'function' ? v2Icon('news') : ''}From the Scout's Desk</span>
                    <a class="v2-desk-more" href="/dashboard/scouts-desk">All articles <i data-lucide="arrow-right" class="icon"></i></a>
                </div>
                <div class="v2-desk-grid">
                    ${/* Picture down the left, words on the right. The article's
                          own generated artwork, in its text-free form: the
                          headline is already printed beside it, and repeating it
                          inside the image would say the same thing twice in two
                          type sizes. */''}
                    ${debriefFirst.map(a => `<a class="v2-desk-card" href="articles/${encodeURIComponent(a.slug)}.html">
                        ${typeof sdArtwork === 'function' ? `<span class="v2-desk-art">${sdArtwork(a, 'thumb')}</span>` : ''}
                        <span class="v2-desk-text">
                            <span class="v2-desk-kicker">${esc(a.category || 'Scout\u2019s Desk')}${a.gw ? ` \u00b7 GW${a.gw}` : ''}</span>
                            <span class="v2-desk-headline">${esc(a.title)}</span>
                            <span class="v2-desk-meta">${a.readTime ? `${a.readTime} min read` : ''}${a.words ? ` \u00b7 ${Number(a.words).toLocaleString()} words` : ''}</span>
                        </span>
                    </a>`).join('')}
                </div>
            </div>`;
            el.style.display = '';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        /* The deadline readiness bar, in the Overview panel.

           This used to render a second thing as well: a full-width "Needs Your
           Attention" grid below the pitch, two columns of the same checks with
           a strip of stat cells over each. The bar already names every check
           and says which of them are clear, so the rows underneath were the
           same answer a second time.

           The stat cells went with it. The projected XI score and the armband
           are on the pitch, the bank and the countdown are in this panel, and
           the deadline is in the hero above — but bench cover, starters at
           risk and rated sells had no second home, so those three are gone
           rather than moved. The checks behind them are untouched: rdBuild
           still runs all of them and the bar still names every one. */
        function renderReadiness({ transferRec, squad, analysisResults, captainRec,
                                   freeTransfers, maxFreeTransfers, bank, chips,
                                   deadlineTime }) {
            const rdSlot = document.getElementById('v2Readiness');
            if (!rdSlot) return;

            const built = rdBuild({
                squad, analysisResults, transferRec, captainRec,
                freeTransfers, maxFreeTransfers, bank, chips
            });
            rdSlot.innerHTML = rdSummaryHTML(built.summary, deadlineTime, Date.now(), built.checks);
            /* The bar itself carries no data-lucide icons, but other panels
               rendered in this same pass do and this is where they were being
               initialised. Kept for that reason rather than for this one. */
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        // ===== PITCH / FORMATION VIEW =====
        async function loadDashboardJerseyNumbers({ bootData, picks, playersById, teams }) {
            const season = new Date(bootData.events?.[0]?.deadline_time || Date.now()).getUTCFullYear();
            const cacheKey = `pl_jersey_numbers_${season}`;
            let jerseyNumbers = {};
            try { jerseyNumbers = JSON.parse(localStorage.getItem(cacheKey) || '{}'); } catch (_) {}

            const teamCodes = [...new Set((picks || []).map(pick => {
                const player = playersById[pick.element];
                return player ? teams[player.teamId]?.code : null;
            }).filter(Boolean))];

            await Promise.all(teamCodes.map(async teamCode => {
                try {
                    const url = `https://sdp-prem-prod.premier-league-prod.pulselive.com/api/v2/competitions/8/seasons/${season}/teams/${teamCode}/squad`;
                    const response = await fetch(url);
                    if (!response.ok) return;
                    const data = await response.json();
                    (data.players || []).forEach(player => {
                        if (player.id != null && player.shirtNum != null) jerseyNumbers[String(player.id)] = player.shirtNum;
                    });
                } catch (error) {
                    console.warn(`[Dashboard jerseys] Could not load team ${teamCode}:`, error);
                }
            }));

            try { localStorage.setItem(cacheKey, JSON.stringify(jerseyNumbers)); } catch (_) {}
            return jerseyNumbers;
        }

        /* The snapshot answers "how is my team doing" before a deadline and
           "how did my team do" after one, and those are different questions
           with different numbers. Everything below the squad is what tells the
           two apart: the gameweek being played, its fixtures, and whoever has
           already scored in it. All optional — without them the pitch falls
           back to the projection it has always shown. */
        function renderPitchView({ squad, analysisResults, currentGW, fixtures, teams, eventLive, liveById }) {
            const wrap = document.getElementById('v2PitchWrap');
            if (!squad || !squad.length) { wrap.innerHTML = ''; return; }
            const esc = t => String(t == null ? '' : t)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            const verdictMap = {};
            analysisResults.forEach((a, i) => { if (squad[i]) verdictMap[squad[i].id] = a; });

            /* "B.Fernandes" -> BF, "Haaland" -> H. FPL's web_name is already the
               short display name, so its own punctuation is the word boundary. */

            const starters = squad.filter(p => p.pickPosition <= 11).sort((a, b) => a.pickPosition - b.pickPosition);
            const bench = squad.filter(p => p.pickPosition >= 12).sort((a, b) => a.pickPosition - b.pickPosition);

            const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
            starters.forEach(p => { if (counts[p.position] !== undefined) counts[p.position]++; });
            const formationStr = `${counts[2]}-${counts[3]}-${counts[4]}`;

            // Rotation-adjusted xP from the shared engine — the same projection the
            // squad page, the wizards and the draft planner use. Falls back to a dash
            // rather than a fabricated number if the engine has no state to work with.
            const xpOf = p => {
                if (typeof projectPlayerPointsDetailed !== 'function'
                    || typeof xpEngineReady !== 'function' || !xpEngineReady()) return null;
                const fx = (p.fixtures || [])[0] || null;
                try { return projectPlayerPointsDetailed(p, { fixture: fx }).total; }
                catch (e) { return null; }
            };
            const xpById = {};
            squad.forEach(p => { xpById[p.id] = xpOf(p); });

            /* What this gameweek has actually produced, for the players who have
               produced anything yet.

               Before kick-off a projection is the only number available. After
               it, the projection is beside the point: the player has a real
               score and real minutes, and a card still reading "4.6 xP · 72'"
               beside a man who has played 90 and scored 2 is not a forecast, it
               is a contradiction. Two sources, freshest first — the live
               endpoint the status strip already fetched while matches are on,
               then the committed event-live.json once nothing is in play and
               that fetch no longer runs. */
            const gwFixturesOf = p => (fixtures || []).filter(f =>
                f.event === currentGW && (f.team_h === p.teamId || f.team_a === p.teamId));

            /* event-live.json omits anyone who did not feature, so "we have data
               for this gameweek" has to be judged on the file rather than on the
               row: an unused substitute really did score zero, and falling back
               to his projection would put points on the card he never had. */
            const liveCovers = !!(eventLive && eventLive.event === currentGW && eventLive.elements);
            function actualOf(p) {
                const fxs = gwFixturesOf(p);
                // A blank gameweek, or a fixture that has not kicked off: there
                // is nothing yet, so the projection still stands.
                if (!fxs.length || !fxs.some(f => f.started)) return null;
                const done = fxs.every(f => f.finished_provisional);
                if (liveById && liveById[p.id]) {
                    const st = liveById[p.id];
                    return { pts: st.total_points || 0, mins: st.minutes || 0, done };
                }
                if (liveCovers) {
                    const e = eventLive.elements[p.id] || {};
                    return { pts: e.pts || 0, mins: e.min || 0, done };
                }
                return null;
            }
            const actualById = {};
            squad.forEach(p => { actualById[p.id] = actualOf(p); });

            // The armband marker follows the highest projection in the XI, which is
            // the question the dashboard is actually answering. The real captain is
            // still shown, so a disagreement is visible rather than hidden.
            let bestCapId = null, bestCapXp = -Infinity;
            squad.filter(p => p.pickPosition <= 11).forEach(p => {
                const v = xpById[p.id];
                if (v != null && v > bestCapXp) { bestCapXp = v; bestCapId = p.id; }
            });

            function pitchToken(p) {
                const a = verdictMap[p.id];
                const verdict = a ? a.verdict : 'hold';
                const ringClass = verdict === 'sell' ? ' verdict-ring-sell' : verdict === 'monitor' ? ' verdict-ring-monitor' : '';
                let badge = '';
                if (p.isCaptain) badge = '<span class="v2-pitch-token-badge">C</span>';
                else if (p.isViceCaptain) badge = '<span class="v2-pitch-token-badge">V</span>';
                let statusIcon = '';
                if (p.status === 'i' || p.status === 'u' || p.status === 's') {
                    statusIcon = '<i data-lucide="circle-x" class="v2-pitch-token-status icon" style="width:11px;height:11px;"></i>';
                } else if (p.status === 'd') {
                    statusIcon = '<i data-lucide="alert-triangle" class="v2-pitch-token-status icon" style="width:11px;height:11px;color:#FBBF24;"></i>';
                }
                // Verdict is carried by a ring colour, which is invisible to a red-green
                // colour deficiency. Give it a shape and a word too.
                let verdictMark = '';
                if (verdict === 'sell') verdictMark = '<span class="v2-pitch-token-flag sell" title="Rated Sell">▼</span>';
                else if (verdict === 'monitor') verdictMark = '<span class="v2-pitch-token-flag monitor" title="Monitor">●</span>';

                const xp = xpById[p.id];
                const act = actualById[p.id];
                /* p.fixtures excludes anything already finished, so its head is
                   the fixture coming up — right for a projection and wrong for
                   a score. A card reporting what a player did has to name the
                   opponent he did it against. */
                const fx = (p.fixtures || [])[0];
                const oppTxt = act
                    ? gwFixturesOf(p).map(f => {
                        const home = f.team_h === p.teamId;
                        return `${esc((teams || {})[home ? f.team_a : f.team_h]?.short_name || '?')}${home ? ' (H)' : ' (A)'}`;
                      }).join(' · ')
                    : (fx ? `${esc(fx.opponent || '?')}${fx.isHome ? ' (H)' : ' (A)'}` : 'Blank');
                // The star marks who to captain, which is a question about the
                // next match — so it goes away once the card is reporting the
                // last one instead of predicting anything.
                const isBestCap = p.id === bestCapId && !act;
                const posLabel = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }[p.position] || '';
                // Expected minutes belongs next to the projection it scales: an xP
                // built on a 40% chance of starting means something different to
                // the same number from a nailed-on starter.
                let mins = null, minsTxt = '';
                if (!act && typeof expectedMinutesModel === 'function') {
                    try { mins = expectedMinutesModel(p); } catch (e) { mins = null; }
                    if (mins) minsTxt = ` · ${Math.round(mins.pStart * 100)}% to start, ~${Math.round(mins.expMins)} mins`;
                }
                const tip = act
                    ? `${esc(p.name)} — ${act.pts} point${act.pts === 1 ? '' : 's'} in ${act.mins} minute${act.mins === 1 ? '' : 's'} against ${oppTxt}, GW${currentGW}${act.done ? '' : ' (still in play)'}`
                    : xp != null
                    ? `${esc(p.name)} — ${xp.toFixed(1)} projected points against ${oppTxt}${minsTxt}${isBestCap ? '. Highest projection in your XI.' : ''}`
                    : `${esc(p.name)} — ${posLabel}${minsTxt}`;
                /* The face is the card. It used to be a 30px disc sharing a
                   row with a 20px club badge, so the pair of them was narrower
                   than the name underneath and the photo — the one thing here
                   you can recognise without reading — was the smallest thing on
                   the card. Face and badge sit side by side at a size worth
                   looking at, and the projection gets a line of its own beneath
                   rather than a pill half over the photo: it and the fixture
                   are the two things you actually read across an XI. */
                return `<div class="v2-pitch-token${ringClass}" title="${tip}">
                  <div class="v2-pitch-token-flags">${verdictMark}${statusIcon}</div>
                  ${typeof v2IdentityHTML === 'function' ? v2IdentityHTML(p, 'v2-pid-pitch') : ''}
                  ${badge}
                    <span class="v2-pitch-token-name">${esc(p.name)}${isBestCap ? `<span class="v2-pitch-token-star" title="Highest projected points in your XI">${v2Icon('star')}</span>` : ''}</span>
                    <span class="v2-pitch-token-score${act ? ` actual${act.done ? '' : ' live'}` : ''}">${act
                        ? `<b>${act.pts}</b><span class="u">pts</span>`
                        : xp != null
                        ? `<b>${xp.toFixed(1)}</b><span class="u">xP</span>`
                        : `<b class="pos">${posLabel}</b>`}</span>
                    <span class="v2-pitch-token-opp">${oppTxt}${
                        /* Expected minutes ride with the fixture now that the
                           projection has moved onto the portrait. They belong
                           together either way: both are about the match, and an
                           xP built on a 40% chance of starting means something
                           different to the same number from a nailed-on one.

                           Once his match is under way they stop being expected
                           and become the minutes he has played, which is the
                           same swap the score above makes for the same reason. */
                        act
                            ? `<span class="v2-pitch-token-mins">${act.mins}'</span>`
                            : mins != null
                            ? `<span class="v2-pitch-token-mins${mins.pStart < 0.65 ? ' risk' : ''}">${Math.round(mins.expMins)}'</span>`
                            : ''
                      }</span>
                </div>`;
            }

            // Rows top-to-bottom: forwards, midfielders, defenders, goalkeeper (attack up top, keeper near own goal)
            const rowTops = [15, 38, 61, 84];   // centre lines, see .v2-pitch-row
            const rowOrder = [4, 3, 2, 1];
            let pitchHtml = '';
            rowOrder.forEach((pos, idx) => {
                const group = starters.filter(p => p.position === pos);
                if (!group.length) return;
                pitchHtml += `<div class="v2-pitch-row" style="top:${rowTops[idx]}%;">${group.map(pitchToken).join('')}</div>`;
            });

            let benchHtml = '<span class="v2-pitch-bench-label">Bench</span>';
            bench.forEach(p => { benchHtml += pitchToken(p); });

            /* The pill over the pitch has to be the same kind of number as the
               cards under it. It stays a projection until every starter has
               kicked off — a half-played XI is the one case where a total of
               either kind misleads, and the live score in the status strip
               above already covers that moment — and then becomes the score.

               Multipliers, so it agrees with the total FPL is showing this
               manager. Auto-subs are the game's to apply and are not replayed
               here, so a starter who blanked still counts as the zero he
               scored until the bench formally replaces him. */
            const xiPlayers = squad.filter(p => p.pickPosition <= 11);
            const xiXp = xiPlayers.reduce((t, p) => t + (xpById[p.id] || 0), 0);
            const xiAllStarted = xiPlayers.length > 0 && xiPlayers.every(p => actualById[p.id]);
            const xiSettled = xiAllStarted && xiPlayers.every(p => actualById[p.id].done);
            const xiActualPts = xiAllStarted
                ? xiPlayers.reduce((t, p) => t + actualById[p.id].pts * (p.multiplier || 1), 0)
                : 0;
            const xiXpLabel = xiAllStarted
                ? `${xiActualPts} pts`
                : (xiXp > 0 ? `${xiXp.toFixed(1)} xP` : '');
            const xiTotalClass = xiAllStarted ? ` actual${xiSettled ? '' : ' live'}` : '';
            const xiTotalTip = xiAllStarted
                ? `What your starting XI has scored in GW${currentGW}, captain included${xiSettled ? '' : ' — matches are still in play'}. Auto-substitutions are not applied here.`
                : "Sum of your starting XI's projected points";

            /* The whole snapshot is the way into the deep analysis. It is an <a>
               rather than a click handler so it behaves like a link: keyboard
               focusable, middle-clickable, and readable by a screen reader.

               On a phone a full-bleed link over a tall element hijacks scrolling —
               a drag that starts on the pitch reads as a tap. Below 768px the
               overlay link is therefore disabled by CSS and the explicit button
               below carries the navigation instead. */
            wrap.innerHTML = `
                <div class="v2-pitch-header">
                    <!-- An inline SVG, not an <i data-lucide> placeholder.

                         The placeholder only becomes an icon if lucide has
                         loaded and run, and this one was rendering as nothing
                         — so the panel beside "Overview" had a bare
                         title where its neighbour had an icon. Every other
                         section title on the site draws its own mark; this one
                         does now too, and cannot silently lose it. -->
                    <span class="v2-pitch-title v2-section-title"><svg class="v2-sec-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.4 3.5 16 2a4 4 0 0 1-8 0L3.6 3.5a2 2 0 0 0-1.3 2.2l.6 3.5a1 1 0 0 0 1 .8H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.1a1 1 0 0 0 1-.8l.6-3.5a2 2 0 0 0-1.3-2.2z"/></svg>Squad Snapshot</span>
                    <span class="v2-pitch-head-right">
                        ${xiXpLabel ? `<span class="v2-pitch-xitotal${xiTotalClass}" title="${esc(xiTotalTip)}">${xiXpLabel}</span>` : ''}
                        <span class="v2-pitch-formation">${formationStr}</span>
                        <a class="v2-pitch-more" href="/dashboard/my-team">Full squad analysis <i data-lucide="arrow-right" class="icon"></i></a>
                    </span>
                </div>
                <div class="v2-pitch-stage">
                    <div class="v2-pitch">${pitchHtml}</div>
                    <div class="v2-pitch-bench">${benchHtml}</div>
                </div>`;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        // ===== EXTERNAL NEWS =====
        let externalNewsCache = null, externalNewsFetchedAt = 0;
        const DEAD_HEADLINES = ['find out more here','read more','click here','learn more','watch now','full story'];
        function isValidHeadline(title) {
            if (!title || title.trim().length < 10) return false;
            const lower = title.trim().toLowerCase();
            return !DEAD_HEADLINES.some(d => lower === d || lower.startsWith(d));
        }
        async function fetchExternalNews() {
            const now = Date.now();
            if (externalNewsCache && (now - externalNewsFetchedAt) < 30 * 60 * 1000) {
                return externalNewsCache;
            }
            const feeds = [
                { url: 'https://feeds.bbci.co.uk/sport/football/premier-league/rss.xml', source: 'BBC Sport', badge: 'bbc' },
                { url: 'https://www.skysports.com/rss/12040', source: 'Sky Sports', badge: 'sky' },
                { url: 'https://www.theguardian.com/football/premierleague/rss', source: 'The Guardian', badge: 'guardian' }
            ];
            const plTeams = ['arsenal','aston villa','bournemouth','brentford','brighton','burnley','chelsea','crystal palace','everton','fulham','ipswich','leicester','liverpool','luton','man city','manchester city','man utd','manchester united','newcastle','nott\'m forest','nottingham forest','sheffield','southampton','spurs','tottenham','west ham','wolves','wolverhampton'];
            const plKeywords = ['premier league','fpl','gameweek','epl','prem','pl table','top four','relegation','var ','offside','penalty','clean sheet'];
            const oneDayAgo = now - 24 * 60 * 60 * 1000;
            const items = [];
            /* One story, once. Two of the feeds are the same publisher at two
               URLs, and a publisher that syndicates to another can put the same
               link in both — a duplicated card reads as a duplicated story. */
            const seenLinks = new Set();

            /* The Premier League's own articles, from the file the scheduled
               job writes (see .github/workflows/fetch-pl-news.yml).
               premierleague.com sends no CORS headers, so this is the only way
               the browser can have them at all. */
            try {
                const plRes = await fetch('/data/pl-news.json?v=' + Math.floor(Date.now() / 300000));
                if (plRes.ok) {
                    const pl = await plRes.json();
                    (pl.items || []).forEach(a => {
                        if (!a.link || seenLinks.has(a.link)) return;
                        seenLinks.add(a.link);
                        items.push({
                            category: 'external', categoryLabel: 'Premier League',
                            headline: a.title,
                            link: a.link,
                            thumbnail: a.image || null,
                            source: 'Premier League', badge: 'pl',
                            detail: a.summary || 'Premier League',
                            isSquad: false,
                            timestamp: a.published,
                            sortWeight: 5
                        });
                    });
                }
            } catch (e) { /* three other feeds remain; a missing file is not an error */ }

            /* BBC, Sky and the Guardian from the file the same job writes,
               before the live proxy is asked for them.

               This is why the Guardian's cards on this panel had no picture
               while the same stories on the News Hub did: the Hub reads this
               file and the dashboard went straight to api.rss2json.com. That
               proxy decides for itself which namespaced elements to map, and
               the Guardian is the casualty — its items carry no <enclosure>
               and no <media:thumbnail>, only a stack of <media:content>, and
               its description is plain text, so nothing that arrives through
               the proxy looks like an image. Reading the XML server-side puts
               the picture back, and both screens now read the same file.

               A feed that answers from the file is not asked for again below,
               so a failed job is a panel with fewer pictures rather than one
               with no news. */
            const servedFromFile = new Set();
            try {
                const nfRes = await fetch('/data/news-feeds.json?v=' + Math.floor(Date.now() / 300000));
                if (nfRes.ok) {
                    const nf = await nfRes.json();
                    (nf.feeds || []).forEach(f => {
                        const kept = (f.items || []).filter(a =>
                            a.link && !seenLinks.has(a.link) && isValidHeadline(a.title));
                        if (!kept.length) return;
                        servedFromFile.add(f.badge);
                        kept.slice(0, 12).forEach(a => {
                            if (a.published && new Date(a.published).getTime() < oneDayAgo) return;
                            seenLinks.add(a.link);
                            items.push({
                                cat: 'external',
                                text: `${a.title} — ${f.source}`,
                                headline: a.title,
                                link: a.link,
                                thumbnail: a.image || null,
                                source: f.source,
                                badge: f.badge,
                                timestamp: a.published,
                                isSquad: false,
                                weight: 20
                            });
                        });
                    });
                }
            } catch (e) { /* the proxy below still covers all three */ }

            for (const feed of feeds) {
                if (servedFromFile.has(feed.badge)) continue;
                try {
                    const rssUrl = encodeURIComponent(feed.url);
                    const resp = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${rssUrl}`);
                    if (!resp.ok) continue;
                    const data = await resp.json();
                    if (data.status !== 'ok' || !data.items) continue;
                    data.items.slice(0, 12).forEach(article => {
                        if (!isValidHeadline(article.title)) return;
                        if (article.pubDate && new Date(article.pubDate).getTime() < oneDayAgo) return;
                        const rawDesc = article.description ? article.description.replace(/<[^>]*>/g, '') : '';
                        const textToCheck = ((article.title || '') + ' ' + rawDesc).toLowerCase();
                        const isPL = plTeams.some(t => textToCheck.includes(t)) || plKeywords.some(k => textToCheck.includes(k));
                        if (!isPL) return;
                        if (article.link && seenLinks.has(article.link)) return;
                        if (article.link) seenLinks.add(article.link);
                        items.push({
                            cat: 'external',
                            text: `${article.title} — ${feed.source}`,
                            headline: article.title,
                            link: article.link,
                            thumbnail: newsThumbnail(article, feed.source),
                            source: feed.source,
                            badge: feed.badge,
                            timestamp: article.pubDate,
                            isSquad: false,
                            weight: 20
                        });
                    });
                } catch (e) {
                    console.warn(`Failed to fetch ${feed.source} RSS:`, e);
                }
            }
            items.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
            externalNewsCache = items;
            externalNewsFetchedAt = now;
            return items;
        }

        /* ===== NEWS PREVIEW =====
           Four headlines from the same four RSS feeds the News page reads,
           through the same fetchExternalNews() below, so the dashboard and
           /news never disagree about what is new — plus the injuries, from the
           same builder the News Hub uses. It is a preview and says so: four
           cards and a way through to the rest.

           There were three filter tabs here and they are gone with the word
           list and the name matching that backed them. Filtering four cards is
           not filtering, it is emptying: "Your squad" matched headlines against
           player and club names and usually found nothing, which left the panel
           showing a "nothing under this filter" message on a page that had news
           to show. The News Hub is one click away and is where a filter has
           enough to work on. */
        let v2NewsItems = [];

        /* What a news card shows when there is no picture.

           Two feeds publish items with no image at all, and any image can 404
           or be blocked by the time it is asked for. This card had no answer to
           either: no thumbnail rendered an empty box, and a failed one called
           this.remove() and left the same empty box. The highlights list four
           hundred lines down already had a proper fallback — a panel in the
           source's colour with a newspaper mark — so this is that, hoisted to
           where both can use it rather than written twice.

           Defined beside the card that needs it, not inside the other
           renderer's closure, which is why it could not be reached from here
           before. */
        const V2_NEWS_MARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8M15 18h-5M18 10h-8"/></svg>';
        const V2_NEWS_COLORS = { bbc: '#BB1D1D', pl: '#38006A', sky: '#0062B2', guardian: '#05517E' };

        function v2NewsFallback(badge) {
            const c = V2_NEWS_COLORS[badge] || '#6366F1';
            return `<span class="v2-news-fallback" style="background:${c}">${V2_NEWS_MARK}</span>`;
        }

        /* An injury story's picture.
         *
         * Two of the four cards in this panel are injuries — injuryFeedFrom()
         * mingles them in — and an injury story has no photograph: the Premier
         * League's table carries none and the club article's own image is not
         * ours to lift. So both of them fell through to the generic newspaper
         * mark above, in the same indigo, which is indistinguishable from a
         * picture that failed to load. Beside two real photographs it reads as
         * the panel being broken, and that is exactly what it was reported as.
         *
         * The News Hub already answers this: the crest, on the club's colour.
         * It says whose news this is before the headline is read, which is the
         * job the photo does on every other card. Same answer here, off the
         * shared CLUB_COLOURS — which is keyed by the permanent club code
         * rather than by the FPL team id, so it cannot dress one club in
         * another's colours the day a new season renumbers them. */
        function v2NewsCrest(item) {
            const pair = (typeof CLUB_COLOURS !== 'undefined' && CLUB_COLOURS[item.clubCode])
                || ['#6366F1', '#FFFFFF'];
            const esc = t => String(t == null ? '' : t)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            return `<span class="v2-news-crest" style="background:linear-gradient(135deg, ${pair[0]} 0%, ${pair[0]}dd 60%, ${pair[0]}99 100%);color:${pair[1]}">
                <img class="v2-news-crest-badge" alt="" loading="lazy"
                    src="https://resources.premierleague.com/premierleague/badges/100/t${encodeURIComponent(item.clubCode)}.png"
                    onerror="this.remove()">
                ${item.source ? `<span class="v2-news-crest-club">${esc(item.source)}</span>` : ''}
            </span>`;
        }

        function v2NewsCard(item) {
            const esc = t => String(t == null ? '' : t)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            const when = item.timestamp ? new Date(item.timestamp) : null;
            const age = when && !isNaN(when) ? v2NewsAge(Date.now() - when.getTime()) : '';
            return `<a class="v2-news-card" href="${esc(item.link)}" target="_blank" rel="noopener noreferrer">
                <span class="v2-news-thumb">${item.thumbnail && /^https?:\/\//i.test(item.thumbnail)
                    ? `<img src="${esc(item.thumbnail)}" alt="" loading="lazy"
                        onerror="this.parentElement.innerHTML = ${esc(JSON.stringify(item.clubCode != null ? v2NewsCrest(item) : v2NewsFallback(item.badge)))}">`
                    : item.clubCode != null
                        ? v2NewsCrest(item)
                        : v2NewsFallback(item.badge)}</span>
                <span class="v2-news-meta">
                    <span class="news-card-category cat-${esc(item.badge || 'external')}">${esc(item.source || '')}</span>
                    ${age ? `<span class="v2-news-age">${esc(age)}</span>` : ''}
                </span>
                <span class="v2-news-head">${esc(item.headline || '')}</span>
            </a>`;
        }

        function v2NewsAge(ms) {
            const h = ms / 3600000;
            if (h < 1) { const m = Math.max(1, Math.round(h * 60)); return `${m}m ago`; }
            if (h < 24) return `${Math.round(h)}h ago`;
            return `${Math.round(h / 24)}d ago`;
        }

        function v2RenderNewsCards() {
            const body = document.getElementById('v2NewsBody');
            if (!body) return;
            const shown = v2NewsItems.slice(0, 4);
            body.innerHTML = shown.length
                ? shown.map(v2NewsCard).join('')
                : `<div class="v2-news-empty">No news in the last day.</div>`;
        }

        /* Latest news, with the injuries in it.
         *
         * The three tabs are gone. "Your squad" matched a headline against
         * player and club names, which is a guess dressed as a filter, and
         * "Transfers" matched a word list — both of them cut a four-card panel
         * down to one or none often enough that the commonest thing they did
         * was empty it. Four cards do not need filtering; the News Hub is one
         * click away and is where filtering belongs.
         *
         * Injuries are mingled in rather than given a tab, which is what the
         * News Hub does with the same rows and the same builder — see
         * scripts/injury-feed.js. Ordered together by time, so the panel
         * answers "what happened" rather than "what happened, per source". */
        function renderNewsPreview(items, squad, injuryRows, teamsById) {
            const el = document.getElementById('v2News');
            if (!el) return;

            let merged = Array.isArray(items) ? items.slice() : [];
            if (Array.isArray(injuryRows) && injuryRows.length
                && typeof injuryStories === 'function' && typeof injuryFeedFrom === 'function') {
                try {
                    const stories = injuryStories(injuryRows, teamsById || {});
                    /* A couple, not ten. The News Hub gives injuries a section
                       of their own and caps them there; here they are competing
                       with the rest of the day's news for four slots, and a
                       panel that is entirely injuries is not a news panel. */
                    merged = merged.concat(injuryFeedFrom(stories, 2));
                } catch (e) { /* the rest of the news is still news */ }
            }
            if (!merged.length) return;

            merged.sort((a, b) => {
                const at = Date.parse(a.sortAt || a.timestamp || 0) || 0;
                const bt = Date.parse(b.sortAt || b.timestamp || 0) || 0;
                return bt - at;
            });

            v2NewsItems = merged;

            el.innerHTML = `<div class="v2-news-panel">
                <div class="v2-news-head-row">
                    <span class="v2-news-title">${typeof v2Icon === 'function' ? v2Icon('news') : ''}Latest news</span>
                    <a class="v2-news-more" href="/dashboard/news">All news <i data-lucide="arrow-right" class="icon"></i></a>
                </div>
                <div class="v2-news-grid" id="v2NewsBody"></div>
            </div>`;
            el.style.display = '';
            v2RenderNewsCards();
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        // ===== HEADLINES WIDGET =====
        function renderHeadlinesWidget(externalItems, bootTeams) {
            const widget = document.getElementById('headlinesWidget');
            const list = document.getElementById('headlinesList');
            if (!externalItems || !externalItems.length) return;

            // Build quick team lookup for matching
            const teamByName = {};
            (bootTeams || []).forEach(t => {
                teamByName[t.name.toLowerCase()] = t;
                teamByName[t.short_name.toLowerCase()] = t;
                t.name.toLowerCase().split(' ').forEach(w => {
                    if (w.length >= 4 && !['city','town','united','and','hove','albion','ham'].includes(w)) {
                        if (!teamByName[w]) teamByName[w] = t;
                    }
                });
            });
            const aliases = {'man city':'manchester city','man utd':'manchester united','spurs':'tottenham','wolves':'wolverhampton','palace':'crystal palace','forest':'nottingham forest','villa':'aston villa','bournemouth':'afc bournemouth'};
            Object.entries(aliases).forEach(([a,c]) => { if (teamByName[c]) teamByName[a] = teamByName[c]; });

            function matchTeamsHL(headline) {
                if (!headline) return [];
                const text = headline.toLowerCase();
                const matched = new Set(), results = [];
                const keys = Object.keys(teamByName).sort((a,b) => b.length - a.length);
                for (const key of keys) {
                    if (text.includes(key)) {
                        const t = teamByName[key];
                        if (!matched.has(t.id)) { matched.add(t.id); results.push(t); if (results.length >= 2) break; }
                    }
                }
                return results;
            }

            function badgeUrl(code) { return `https://resources.premierleague.com/premierleague/badges/70/t${code}.png`; }

            const top3 = externalItems.filter(i => i.headline && i.headline.trim().length >= 10).slice(0, 3);
            if (!top3.length) return;

            const escH = s => String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            // The same mark and the same palette the news cards above use.
            const newspaperSVG = V2_NEWS_MARK;
            const sourceColors = V2_NEWS_COLORS;

            function tAgo(ds) {
                if (!ds) return '';
                const diff = Date.now() - new Date(ds).getTime();
                const m = Math.floor(diff/60000);
                if (m < 1) return 'just now'; if (m < 60) return m+'m ago';
                const h = Math.floor(m/60); if (h < 24) return h+'h ago';
                return Math.floor(h/24)+'d ago';
            }

            list.innerHTML = top3.map(item => {
                const teams = matchTeamsHL(item.headline);
                const crestsHTML = teams.length ? `<div class="hl-crests">${teams.map(t=>`<img src="${badgeUrl(t.code)}" alt="${escH(t.short_name)}">`).join('')}</div>` : '';
                const sc = sourceColors[item.badge] || '#6366F1';
                const validLink = item.link && /^https?:\/\//i.test(item.link);
                const href = validLink ? escH(item.link) : '#';
                const thumbHTML = item.thumbnail
                    ? `<div class="hl-thumb"><img src="${escH(item.thumbnail)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<div class=hl-thumb-fallback style=background:${sc}>${newspaperSVG}</div>'"></div>`
                    : `<div class="hl-thumb"><div class="hl-thumb-fallback" style="background:${sc}">${newspaperSVG}</div></div>`;
                return `<a class="hl-item" href="${href}" target="_blank" rel="noopener noreferrer">
                    ${thumbHTML}
                    <div class="hl-body">
                        <div class="hl-headline">${escH(item.headline)}</div>
                        <div class="hl-meta">
                            <span class="hl-source cat-${escH(item.badge)}">${escH(item.source)}</span>
                            <span class="hl-time">${tAgo(item.timestamp)}</span>
                            ${crestsHTML}
                        </div>
                    </div>
                </a>`;
            }).join('');

            widget.classList.remove('hidden');
        }

        // ===== NEWS STRIP =====
        function renderNewsStrip(allPlayers, squad, externalItems) {
            const strip = document.getElementById('newsStrip');
            const track = document.getElementById('newsStripTrack');
            const squadIds = new Set(squad.map(p => p.id));
            const items = [];

            // Injury/status items (squad first) — skip stale loan/transfer news
            allPlayers.forEach(p => {
                if (p.news && p.news.trim()) {
                    const nl = p.news.toLowerCase();
                    if (nl.includes('loan') || nl.includes('transferred') || nl.includes('left the club')) return;
                    const chance = p.chanceNextRound != null ? ` (${p.chanceNextRound}%)` : '';
                    items.push({
                        cat: 'injury', text: `${p.name}: ${p.news}${chance}`,
                        isSquad: squadIds.has(p.id), weight: squadIds.has(p.id) ? 100 : 40
                    });
                }
            });

            // Price changes
            allPlayers.forEach(p => {
                if (p.costChangeEvent && p.costChangeEvent !== 0) {
                    const dir = p.costChangeEvent > 0 ? '\u2191' : '\u2193';
                    const abs = Math.abs(p.costChangeEvent / 10).toFixed(1);
                    items.push({
                        cat: p.costChangeEvent > 0 ? 'price-up' : 'price-down', text: `${p.name} ${dir} \u00A3${abs}m`,
                        isSquad: squadIds.has(p.id), weight: squadIds.has(p.id) ? 80 : 25
                    });
                }
            });

            // Transfer surges
            allPlayers.forEach(p => {
                const net = p.transfersIn - p.transfersOut;
                if (Math.abs(net) >= 80000) {
                    const dir = net > 0 ? 'in' : 'out';
                    items.push({
                        cat: net < 0 ? 'transfer-out' : 'transfer', text: `${p.name}: ${Math.abs(net).toLocaleString()} net ${dir}`,
                        isSquad: squadIds.has(p.id), weight: squadIds.has(p.id) ? 70 : 15
                    });
                }
            });

            items.sort((a, b) => b.weight - a.weight);
            const top = items.slice(0, 10);

            if (!top.length) { strip.classList.add('hidden'); return; }

            const contentHtml = `<span class="news-strip-content"><span class="news-strip-label">\ud83d\udcf0 NEWS</span>` +
                top.map(i => {
                    const d = document.createElement('div'); d.textContent = i.text;
                    return `<span class="news-strip-item"><span class="news-strip-dot dot-${i.cat}"></span>${d.innerHTML}</span>`;
                }).join('') + `</span>`;

            track.innerHTML = contentHtml + contentHtml;
            strip.classList.remove('hidden');

            requestAnimationFrame(() => {
                const contentEl = track.querySelector('.news-strip-content');
                if (contentEl) {
                    const w = contentEl.offsetWidth;
                    const duration = Math.max(15, w / 70);
                    track.style.animationDuration = duration + 's';
                }
            });
        }

        // ===== PRICE TICKER (stock market scrolling strip) =====
        /* ===== The strip at the top of the dashboard =====

           It was price movers and nothing else — the right thing to read on a
           Tuesday and the wrong thing at 3pm on a Saturday, when the only
           question anyone has is how their own eleven is doing.

           So it asks what part of the week it is:

             live      a match in this round is being played. Your score as it
                       stands, who has returned, and how much of your eleven is
                       still to come.
             results   every match is done but FPL has not signed the round off.
                       What you finished on, and the bonus still to be applied.
             prep      no ball is being kicked. The deadline, where you stand,
                       what needs attention, and then the market.

           Every figure comes from data this page has already fetched, and each
           one is a number somebody else published: the live score is the same
           sum the pitch shows, the ranks are FPL's own, the doubts are the
           game's availability flags. Anything not yet known is left out rather
           than estimated — a ticker is the last place to put a guess, because
           it is read at a glance and believed. */
        function tickerPhase(fixturesData, bootData, currentGW, now) {
            /* Whether a round is being played is a question this site already
               answers, in mdGameweekState() — the same call the matchday panel
               and the news feed use. Asking it again here in slightly different
               words is how two parts of one screen end up disagreeing about
               whether the football has started, so this delegates and only adds
               the one distinction matchday does not draw: between a round that
               has just ended and a week spent preparing for the next. */
            let st = null;
            try {
                if (typeof mdGameweekState === 'function') {
                    st = mdGameweekState(bootData.events, fixturesData, now);
                }
            } catch (e) { /* fall through to the fixture flags below */ }

            if (st && (st.phase === 'live' || st.phase === 'locked')) return 'live';
            if (st && (st.phase === 'preseason' || st.phase === 'season-over')) return 'prep';

            /* The round is over. FPL sets data_checked once bonus and the final
               numbers are in; until then the score is still settling and worth
               showing. After that it is history, and the week ahead matters more. */
            const done = st && st.currentGW ? st.currentGW : currentGW;
            const ev = (bootData.events || []).find(e => e.id === done);
            if (ev && ev.finished && !ev.data_checked) return 'results';
            if (!st) {
                // No matchday helper: fall back to the fixture flags directly.
                const round = (fixturesData || []).filter(f => f.event === currentGW);
                if (round.some(f => f.started && !f.finished_provisional)) return 'live';
            }
            return 'prep';
        }

        function tickerNum(n) { return Number(n).toLocaleString(); }

        /* Your eleven, as the round stands. Bench excluded and the armband
           counted, which is what the score on the pitch does — a ticker that
           disagreed with the panel below it would just look broken. */
        function tickerLiveSquad(squad, liveRows, fixtures, gw) {
            const xi = (squad || []).filter(p => p.pickPosition <= 11);
            /* "Still to play" has to mean football that has not happened yet,
               not "no row in the live feed". A player left on his club's bench
               all afternoon never appears in that feed either, and counting him
               as still to come promises points that are never arriving. So ask
               the fixtures: a player has football left only while one of his
               club's matches this round is unfinished. */
            const round = (fixtures || []).filter(f => f.event === gw);
            const toCome = tid => round.some(f =>
                (f.team_h === tid || f.team_a === tid) && !f.finished_provisional);
            let pts = 0, pending = 0;
            const returns = [];
            xi.forEach(p => {
                if (toCome(p.teamId)) pending++;
                const row = liveRows[p.id];
                if (!row) return;
                const mult = p.multiplier || 1;
                pts += (row.pts || 0) * mult;
                const bits = [];
                if (row.g) bits.push(row.g + (row.g > 1 ? ' goals' : ' goal'));
                if (row.a) bits.push(row.a + (row.a > 1 ? ' assists' : ' assist'));
                /* A clean sheet only counts as a return for the people paid
                   four points for it. For a midfielder it is worth one, and
                   billing it alongside a goal overstates what happened. */
                if (!bits.length && row.cs && row.min >= 60 && p.position <= 2) bits.push('clean sheet');
                if (bits.length) returns.push({ name: p.name, detail: bits.join(', '),
                                                pts: (row.pts || 0) * mult, isCaptain: p.isCaptain });
            });
            returns.sort((a, b) => b.pts - a.pts);
            return { pts, pending, total: xi.length, returns };
        }

        function tickerItems(ctx) {
            const esc = t => String(t == null ? '' : t)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            const out = [];
            const add = (cls, label, value) => out.push(
                `<span class="pticker-item ${cls}">
                    <span class="pticker-name">${esc(label)}</span>
                    <span class="pticker-arrow">${esc(value)}</span>
                </span><span class="pticker-sep">\u2502</span>`);

            if (ctx.phase === 'live' || ctx.phase === 'results') {
                const l = tickerLiveSquad(ctx.squad, ctx.liveRows, ctx.fixtures, ctx.currentGW);
                const final = ctx.phase === 'results';
                add('bull', `GW${ctx.currentGW} ${final ? 'FINAL' : 'LIVE'}`, `${l.pts} pts`);

                const cap = l.returns.find(r => r.isCaptain);
                if (cap) add('bull', `${cap.name} (C)`, `${cap.detail} \u00B7 ${cap.pts} pts`);
                l.returns.filter(r => !r.isCaptain).slice(0, 4)
                    .forEach(r => add('bull', r.name, `${r.detail} \u00B7 ${r.pts} pts`));
                if (!l.returns.length) add('', 'No returns yet', `${l.total - l.pending}/${l.total} played`);

                if (!final && l.pending > 0) {
                    add('', 'Still to play', `${l.pending} of your XI`);
                } else if (final) {
                    add('', 'Bonus', 'not yet final');
                }
                if (final && ctx.rankDelta) {
                    const up = ctx.rankDelta > 0;
                    add(up ? 'bull' : 'bear', 'Overall rank',
                        `${up ? '\u25B2' : '\u25BC'} ${tickerNum(Math.abs(ctx.rankDelta))}`);
                }
                return out;
            }

            // ---- prep
            if (ctx.deadlineTime) {
                const left = Date.parse(ctx.deadlineTime) - (ctx.now != null ? ctx.now : Date.now());
                if (left > 0) {
                    const h = Math.floor(left / 3600000);
                    const label = h >= 48 ? `${Math.floor(h / 24)} days`
                        : h >= 1 ? `${h}h ${Math.floor((left % 3600000) / 60000)}m`
                            : `${Math.max(1, Math.round(left / 60000))} min`;
                    add(h < 24 ? 'bear' : '', `GW${ctx.deadlineGW} deadline`, `in ${label}`);
                }
            }
            if (Number.isFinite(ctx.rank)) {
                const d = ctx.rankDelta;
                add(d > 0 ? 'bull' : d < 0 ? 'bear' : '', 'Overall rank',
                    tickerNum(ctx.rank) + (d ? ` ${d > 0 ? '\u25B2' : '\u25BC'} ${tickerNum(Math.abs(d))}` : ''));
            }
            if (ctx.leagueInfo && ctx.leagueInfo.rank) {
                const li = ctx.leagueInfo;
                const moved = li.lastRank ? li.lastRank - li.rank : 0;
                add(moved > 0 ? 'bull' : moved < 0 ? 'bear' : '', li.name,
                    `${li.rank}${moved ? ` ${moved > 0 ? '\u25B2' : '\u25BC'} ${Math.abs(moved)}` : ''}`);
            }
            if (Number.isFinite(ctx.freeTransfers)) {
                add('', 'Free transfers', String(ctx.freeTransfers));
            }
            if (Number.isFinite(ctx.bank)) add('', 'In the bank', `\u00A3${Number(ctx.bank).toFixed(1)}m`);

            /* Only the eleven, and only what the game itself flags. A doubt on
               the bench is not something to read at a glance on a Tuesday. */
            (ctx.squad || []).filter(p => p.pickPosition <= 11)
                .filter(p => p.status && p.status !== 'a')
                .slice(0, 3)
                .forEach(p => add('bear', p.name,
                    p.chanceNextRound != null ? `${p.chanceNextRound}% to play` : 'doubt'));

            return out;
        }

        function renderPriceTicker(allPlayers, squad, ctx) {
            const bar = document.getElementById('priceTickerBar');
            const track = document.getElementById('priceTickerTrack');
            if (!bar || !track) return;
            const squadIds = new Set(squad.map(p => p.id));
            const totalFpl = 11000000;
            const esc = t => String(t == null ? '' : t)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

            /* The market strip reads the game's own price meter rather than
               inferring pressure from net transfers. Transfers are the cause;
               the meter is the thing that actually decides the price, and it is
               published. Net transfers stay on as context, not as the signal.

               Older cached data files predate these fields, so if the meter is
               missing everywhere we fall back to the transfer-net view rather
               than showing an empty strip. */
            const movers = [];
            if (typeof pwMovers === 'function' && allPlayers.some(p => p.priceProgress)) {
                const m = pwMovers(allPlayers, 10, PW_TICKER_FLOOR);
                const maxLen = Math.max(m.risers.length, m.fallers.length);
                for (let i = 0; i < maxLen; i++) {
                    if (i < m.risers.length) movers.push(m.risers[i]);
                    if (i < m.fallers.length) movers.push(m.fallers[i]);
                }
            } else {
                const withPressure = allPlayers.map(p => {
                    const owners = Math.max(totalFpl * (p.ownership / 100), 1);
                    const net = p.transfersIn - p.transfersOut;
                    return { player: p, legacy: true, net: net, pressure: net / owners };
                });
                const fallers = withPressure.filter(x => x.net < -20000).sort((a, b) => a.net - b.net);
                const risers = withPressure.filter(x => x.net > 20000).sort((a, b) => b.net - a.net);
                const maxLen = Math.max(fallers.length, risers.length);
                for (let i = 0; i < maxLen; i++) {
                    if (i < risers.length) movers.push(risers[i]);
                    if (i < fallers.length) movers.push(fallers[i]);
                }
            }
            /* The phase items lead, and on a matchday they are the whole strip:
               nobody watching their captain wants a price meter scrolling past.
               Movers are the market, which is a between-rounds question. */
            const lead = (typeof tickerItems === 'function' && ctx) ? tickerItems(ctx) : [];
            const wantMovers = !ctx || ctx.phase === 'prep';
            if (!lead.length && (!wantMovers || movers.length === 0)) return;

            const moverItems = !wantMovers ? '' : movers.map(c => {
                const p = c.player;
                const rising = c.legacy ? c.net > 0 : c.dir === 'rise';
                const cls = rising ? 'bull' : 'bear';
                const arrow = rising ? '\u25B2' : '\u25BC';
                const net = (p.transfersIn || 0) - (p.transfersOut || 0);
                const netK = Math.round(Math.abs(net) / 1000);
                const squadBadge = squadIds.has(p.id) ? ' <span class="pticker-squad"></span>' : '';
                // "Due" earns a word; anything short of it only ever shows a number.
                const state = c.legacy
                    ? `${net > 0 ? '+' : '-'}${netK}k`
                    : (c.tier === 'due' ? (rising ? 'RISE DUE' : 'DROP DUE') : `${Math.round(Math.abs(c.progress))}%`);
                const tip = c.legacy ? '' : ` data-tooltip="${esc(pwDetail(c))}"`;
                return `<span class="pticker-item ${cls}${c.legacy ? '' : ' tier-' + c.tier}"${tip}>
                    <span class="pticker-name">${esc(p.name)}${squadBadge}</span>
                    <span class="pticker-price">\u00A3${p.price.toFixed(1)}m</span>
                    <span class="pticker-arrow">${arrow} ${state}</span>
                </span><span class="pticker-sep">\u2502</span>`;
            }).join('');

            const contentHtml = `<span class="price-ticker-content">${lead.join('') + moverItems}</span>`;
            track.innerHTML = contentHtml + contentHtml;
            bar.classList.remove('hidden');

            requestAnimationFrame(() => {
                const contentEl = track.querySelector('.price-ticker-content');
                if (contentEl) {
                    const w = contentEl.offsetWidth;
                    const duration = Math.max(20, w / 55);
                    track.style.animationDuration = duration + 's';
                }
            });
        }

        // ===== LOAD TICKER (main data loader) =====
        let deadlineInterval = null;
        async function loadTicker(teamId) {
            const outageToast = document.getElementById('fplOutageToast');
            if (outageToast) outageToast.classList.add('hidden');

            try {
                // Phase 1: Load basic stats and render ticker immediately
                const [bootData, fixturesData, oddsData, eventLiveData, mgrRes, historyRes] = await Promise.all([
                    fetch('/data/bootstrap-static.json?v=' + Math.floor(Date.now()/300000)).then(r => { if (!r.ok) throw new Error('Data load failed'); return r.json(); }),
                    fetch('/data/fixtures.json?v=' + Math.floor(Date.now()/300000)).then(r => r.ok ? r.json() : []),
                    // Optional, and loaded here for the same reason the squad page
                    // loads it up front: this page projects points too, and the
                    // two must not quote different numbers for the same player.
                    fetch('/data/odds.json?v=' + Math.floor(Date.now()/300000)).then(r => r.ok ? r.json() : null).catch(() => null),
                    // Per-player points for the round in progress. Optional: the
                    // matchday panel falls back to fixtures alone without it.
                    fetch('/data/event-live.json?v=' + Math.floor(Date.now()/300000)).then(r => r.ok ? r.json() : null).catch(() => null),
                    fetchWithProxy(`https://fantasy.premierleague.com/api/entry/${teamId}/`),
                    fetchWithProxy(`https://fantasy.premierleague.com/api/entry/${teamId}/history/`).catch(() => null)
                ]);

                if (typeof boSetOdds === 'function') boSetOdds(oddsData);
                const managerData = await mgrRes.json();
                // The sidebar's account block names the team from this. It is a
                // const in this function's scope, so it is handed over rather
                // than reached for.
                if (typeof v2SetTeamName === 'function') v2SetTeamName(managerData.name);
                const historyData = historyRes ? await historyRes.json().catch(() => null) : null;
                const currEvent = bootData.events.find(e => e.is_current);
                const nextEvent = bootData.events.find(e => e.is_next);
                const currentGW = currEvent ? currEvent.id : 1;

                const picksRes = await fetchWithProxy(`https://fantasy.premierleague.com/api/entry/${teamId}/event/${currentGW}/picks/`);
                let picksData = await picksRes.json();

                const teams = {};
                bootData.teams.forEach(t => { teams[t.id] = t; });

                const teamFixtures = processFixtures(fixturesData, teams);

                // Build full player data
                const allPlayers = bootData.elements.map(p => ({
                    id: p.id, code: p.code, name: p.web_name, teamId: p.team,
                    squadNumber: p.squad_number,
                    team: teams[p.team]?.short_name || 'N/A',
                    /* The badge endpoint is keyed on the club's code, which is a
                       different number from its id. Resolved here because this is
                       where the teams map is in scope. */
                    teamCode: teams[p.team]?.code ?? null,
                    position: p.element_type, price: p.now_cost / 10,
                    form: parseFloat(p.form) || 0, points: p.total_points,
                    ppg: parseFloat(p.points_per_game) || 0,
                    ownership: parseFloat(p.selected_by_percent) || 0,
                    status: p.status, news: p.news, newsAdded: p.news_added || null,
                    chanceNextRound: p.chance_of_playing_next_round,
                    costChangeEvent: p.cost_change_event || 0,
                    costChangeStart: p.cost_change_start || 0,
                    /* Official price engine: a 0->100 progress meter toward the
                       next change, the game's own forecast of it for today/+1/+2
                       days, and a lock before which the player cannot move.
                       Read by scripts/price-watch.js. */
                    priceProgress: parseFloat(p.price_change_percent) || 0,
                    priceProjection: (p.price_change_projections || []).map(x => parseFloat(x.projected_percent) || 0),
                    priceLockedUntil: p.price_change_locked_until || null,
                    minutes: p.minutes, starts: p.starts || 0,
                    goals: p.goals_scored, assists: p.assists,
                    cleanSheets: p.clean_sheets,
                    xGI: parseFloat(p.expected_goal_involvements) || 0,
                    // Fields scripts/xp-engine.js reads. Without xG/xA its per-90
                    // rates divide undefined by minutes and every projection on the
                    // dashboard comes out NaN.
                    xG: parseFloat(p.expected_goals) || 0,
                    xA: parseFloat(p.expected_assists) || 0,
                    saves: p.saves || 0,
                    bonus: p.bonus || 0,
                    defCon: p.defensive_contribution || 0,
                    defCon90: parseFloat(p.defensive_contribution_per_90) || 0,
                    yellowCards: p.yellow_cards || 0,
                    redCards: p.red_cards || 0,
                    penaltiesOrder: p.penalties_order || null,
                    epNext: parseFloat(p.ep_next) || 0,
                    transfersIn: p.transfers_in_event || 0,
                    transfersOut: p.transfers_out_event || 0,
                    fixtures: teamFixtures[p.team] || []
                }));

                const playersById = {};
                allPlayers.forEach(p => { playersById[p.id] = p; });

                /* The squad being planned, which is not the one the picks
                   endpoint answers with once a round has finished: transfers
                   already made for the next gameweek only exist in the transfer
                   log until its deadline passes. picksData stays raw below this
                   — the live score is about the round that is being played, and
                   is scored by the eleven that were submitted for it. See
                   applyPendingTransfers() in scripts/common.js. */
                const planningGW = planningGameweek(bootData, fixturesData);
                let planningPicks = picksData;
                if (planningGW > currentGW) {
                    const transfersRes = await fetchWithProxy(
                        `https://fantasy.premierleague.com/api/entry/${teamId}/transfers/`).catch(() => null);
                    const transferLog = transfersRes ? await transfersRes.json().catch(() => null) : null;
                    const applied = applyPendingTransfers(picksData, transferLog, planningGW,
                        id => (playersById[id] ? Math.round(playersById[id].price * 10) : null));
                    if (applied) {
                        planningPicks = applied.picksData;
                        console.log(`[Transfers] ${applied.moves.length} move(s) already made for GW${planningGW} applied to the squad`);
                    }
                }

                const jerseyNumbers = await loadDashboardJerseyNumbers({ bootData, picks: planningPicks.picks, playersById, teams });
                allPlayers.forEach(player => {
                    if (player.squadNumber == null && jerseyNumbers[String(player.code)] != null) {
                        player.squadNumber = jerseyNumbers[String(player.code)];
                    }
                });

                const posAvg = computePositionAverages(allPlayers, currentGW);
                // Shared with the squad and players pages — see xpBuildTeamScores
                // in scripts/xp-engine.js. The version that lived here emitted no
                // home/away splits, so the projection below fell back to the
                // unsplit figure on this page and only on this page.
                const teamAnalysis = xpBuildTeamScores(bootData.teams, fixturesData);
                // scripts/xp-engine.js reads these by name. Publishing them here is
                // what lets the dashboard project with the same model as the squad
                // page rather than inventing a second, weaker one.
                window.positionAverages = posAvg;
                window.teamAnalysis = teamAnalysis;
                window.currentGW = currentGW;
                window.isPreseason = false;
                /* computePlayerGamesPlayed is NOT published here any more. The
                   engine defines its own and counts the club's played fixtures;
                   this line assigned a worse one over the top of it — ignoring
                   the player argument entirely — so the dashboard was the one
                   page that kept the off-by-one after it was fixed. */
                // scripts/transfer-engine.js plans its window from these.
                window.allFixtures = fixturesData;
                // The recommender projects gameweek by gameweek, so it needs the
                // wider window rather than the five the strips display.
                window.teamFixtures6 = xpBuildTeamFixtures(fixturesData, teams, 8);
                // The candidate pool it searches. Local to this function otherwise,
                // which the engine cannot see.
                window.allPlayers = allPlayers;

                // Build squad from picks (merge pick-level fields)
                const squad = planningPicks.picks.map(pick => {
                    const p = playersById[pick.element];
                    if (!p) return null;
                    // sellPrice matters: the recommender budgets against what a
                    // player would actually raise, not his current list price.
                    return { ...p, isCaptain: pick.is_captain, isViceCaptain: pick.is_vice_captain,
                        multiplier: pick.multiplier, pickPosition: pick.position,
                        sellPrice: pick.selling_price != null ? pick.selling_price / 10 : p.price };
                }).filter(Boolean);

                /* What FPL says you picked, then what you have arranged since.
                 *
                 * Everything above comes off the picks endpoint, which is the
                 * squad as it stood at the last deadline. The armband and the
                 * eleven on Squad Analysis are decisions made after that, and
                 * until they were read here the dashboard went on warning about
                 * a captain the manager had already changed — with the warning
                 * linking to the page where they had changed it. The panel
                 * argued with the page it was pointing at.
                 *
                 * Applied to this local squad only. Nothing is written back:
                 * this is the dashboard reading a decision, not making one. */
                applySavedArrangement(squad, planningGW);

                // Load sensitivity preset from squad analysis settings
                const savedPreset = localStorage.getItem('fpl_active_preset') || 'balanced';
                const presetMap = {
                    aggressive: { sellSensitivity: 1.3, fixtureWeight: 1.4, formWeight: 1.2, valueWeight: 1.3, minutesThreshold: 70, premiumHarshness: 1.3 },
                    balanced:   { sellSensitivity: 1.0, fixtureWeight: 1.0, formWeight: 1.0, valueWeight: 1.0, minutesThreshold: 60, premiumHarshness: 1.0 },
                    patient:    { sellSensitivity: 0.7, fixtureWeight: 0.6, formWeight: 0.8, valueWeight: 0.8, minutesThreshold: 50, premiumHarshness: 0.7 }
                };
                const analysisSettings = presetMap[savedPreset] || presetMap.balanced;

                // Run analysis on each squad player
                const analysisResults = squad.map(p => analyzePlayerForTicker(p, posAvg, teamAnalysis, currentGW, analysisSettings));
                const flagged = analysisResults.filter((a, i) => {
                    if (a.verdict === 'sell' || a.verdict === 'monitor') return true;
                    const p = squad[i];
                    if (p && (p.status === 'i' || p.status === 'u' || p.status === 's' || p.status === 'd')) return true;
                    return false;
                });
                flagged.sort((a, b) => b.sellRating - a.sellRating);

                const bank = (planningPicks.entry_history?.bank || 0) / 10;
                const gwPoints = picksData.entry_history?.points || 0;
                const gwRank = picksData.entry_history?.rank || 0;
                const totalPointsRaw = managerData.summary_overall_points || 0;
                const rankRaw = managerData.summary_overall_rank || 0;
                const squadValue = (picksData.entry_history?.value || 0) / 10;

                // --- Rank delta from history ---
                let rankDelta = null;
                let prevRank = null;
                if (historyData && historyData.current && historyData.current.length >= 2) {
                    const entries = historyData.current;
                    prevRank = entries[entries.length - 2].overall_rank;
                    const currRank = entries[entries.length - 1].overall_rank;
                    rankDelta = prevRank - currRank; // positive = improved
                }

                // --- NEW: Cumulative average manager score ---
                /* Every gameweek FPL has published an average for, not every
                   gameweek it has finished checking. `finished` flips at the
                   round's data check, a day or more after the last whistle,
                   while average_entry_score is live from full time — so on the
                   Monday after GW3 this weighed a three-gameweek total against
                   a two-gameweek average and told every manager they were 36
                   points better off than they were. A round with no average
                   published has nothing to add here, so the score is the test. */
                const scoredEvents = bootData.events.filter(e => (e.average_entry_score || 0) > 0);
                const avgManagerTotal = scoredEvents.reduce((s, e) => s + (e.average_entry_score || 0), 0);
                const pointsDiff = totalPointsRaw - avgManagerTotal;

                // --- NEW: Deadline info from next event ---
                const deadlineTime = nextEvent ? nextEvent.deadline_time : (currEvent ? currEvent.deadline_time : null);
                const deadlineGW = nextEvent ? nextEvent.id : currentGW;

                /* starters outlives the fixture average it was introduced for:
                   the squad-health checks and the captain pick both read it. */
                const starters = squad.filter(p => p.pickPosition <= 11);

                // --- NEW: Market watch - price risk players (squad + shortlist only) ---
                const squadIds = new Set(squad.map(p => p.id));
                const shortlistIds = new Set(JSON.parse(localStorage.getItem('fpl_shortlist') || '[]'));
                const myPlayerIds = p => squadIds.has(p.id) || shortlistIds.has(p.id);
                /* Your squad and shortlist, which is the pool the market panel
                   classifies. The market-wide view is the ticker at the top of the
                   page; scripts/price-watch.js owns the classification itself, and
                   scripts/market-panel.js renders it. Split out and pre-sliced here
                   it produced two lists that were then interleaved into the
                   Transfers column, where a rise and a fall looked identical. */
                const mine = allPlayers.filter(myPlayerIds);

                // --- Squad health score (aligned with fpl-my-team-analysis.html) ---
                const paired = squad.map((p, i) => ({ sq: p, an: analysisResults[i] }));
                const starterPairs = paired.filter(x => x.sq.pickPosition <= 11);
                const benchPairs = paired.filter(x => x.sq.pickPosition >= 12);
                const starterAvg = starterPairs.length > 0 ? starterPairs.reduce((s, x) => s + (100 - x.an.sellRating), 0) / starterPairs.length : 50;
                const benchAvg = benchPairs.length > 0 ? benchPairs.reduce((s, x) => s + (100 - x.an.sellRating), 0) / benchPairs.length : 50;
                let healthScoreRaw = starterAvg * 0.80 + benchAvg * 0.20;

                // Modifiers (matching fpl-my-team-analysis.html exactly)
                const injuredStarters = starterPairs.filter(x => x.sq.status === 'i' || x.sq.status === 'u' || x.sq.status === 's');
                if (injuredStarters.length) healthScoreRaw -= injuredStarters.length * 5;
                const doubtfulStarters = starterPairs.filter(x => x.sq.status === 'd');
                if (doubtfulStarters.length) healthScoreRaw -= doubtfulStarters.length * 2;
                // Captain reliability — starters only (matches fpl-my-team-analysis)
                const capPair = starterPairs.find(x => x.sq.isCaptain);
                if (capPair) {
                    if (capPair.an.verdict === 'star') healthScoreRaw += 3;
                    else if (capPair.an.verdict === 'sell') healthScoreRaw -= 5;
                    else if (capPair.an.verdict === 'monitor') healthScoreRaw -= 2;
                }
                // Position depth: >50% of starters at a position flagged sell
                [2, 3, 4].forEach(pos => {
                    const posStarters = starterPairs.filter(x => x.sq.position === pos);
                    const posSells = posStarters.filter(x => x.an.verdict === 'sell');
                    if (posStarters.length >= 2 && posSells.length > posStarters.length / 2) healthScoreRaw -= 3;
                });
                const starCount = analysisResults.filter(a => a.verdict === 'star').length;
                if (starCount >= 3) healthScoreRaw += 2;

                const healthScore = Math.max(0, Math.min(100, Math.round(healthScoreRaw)));

                // Health deductions explanation
                const healthDeductions = [];
                const injuredCount = squad.filter(p => p.status === 'i' || p.status === 'u' || p.status === 's').length;
                const doubtfulCount = squad.filter(p => p.status === 'd').length;
                if (injuredCount > 0) healthDeductions.push({ icon: 'circle-x', text: `${injuredCount} unavailable player${injuredCount > 1 ? 's' : ''}`, color: '#EF4444' });
                if (doubtfulCount > 0) healthDeductions.push({ icon: 'alert-triangle', text: `${doubtfulCount} doubtful player${doubtfulCount > 1 ? 's' : ''}`, color: '#F59E0B' });
                const sellCount = analysisResults.filter(a => a.verdict === 'sell').length;
                if (sellCount > 0) healthDeductions.push({ icon: 'trending-down', text: `${sellCount} rated Sell`, color: '#EF4444' });
                const toughFixStarters = starters.filter(p => {
                    const f = (p.fixtures || [])[0];
                    return f && f.difficulty >= 4;
                });
                if (toughFixStarters.length >= 3) healthDeductions.push({ icon: 'calendar-x', text: `${toughFixStarters.length} starters face tough fixtures`, color: '#F59E0B' });

                /* Captain recommendation.

                   This was `form × an FDR multiplier`, and the result was stored in
                   a field called `xP` — which it was not. One gameweek into a
                   season `form` is that single gameweek's points, so the pick was
                   essentially "whoever scored most last week, adjusted for badge
                   difficulty". Worse, the pitch beside it stars the highest
                   projection from the real engine, so the two halves of the same
                   screen recommended different captains.

                   Both now read the same projection. */
                let captainRec = null;
                let bestCaptainScore = -1;
                const engineReady = typeof projectPlayerPointsDetailed === 'function'
                    && typeof xpEngineReady === 'function' && xpEngineReady();
                starters.forEach(p => {
                    if (p.status === 'i' || p.status === 'u' || p.status === 's') return;
                    const nextFix = (p.fixtures || [])[0];
                    let score;
                    if (engineReady) {
                        try { score = projectPlayerPointsDetailed(p, { fixture: nextFix || null }).total; }
                        catch (e) { score = null; }
                    }
                    if (score == null || !isFinite(score)) {
                        // Engine unavailable — fall back to the old heuristic rather
                        // than recommending nobody.
                        const fdr = nextFix ? nextFix.difficulty : 3;
                        score = p.form * ({ 1: 1.5, 2: 1.25, 3: 1.0, 4: 0.75, 5: 0.5 }[fdr] || 1.0);
                    }
                    if (score > bestCaptainScore) {
                        bestCaptainScore = score;
                        const oppName = nextFix ? `${nextFix.opponent}${nextFix.isHome ? '' : ' (A)'}` : '';
                        /* teamCode as well as teamId. v2CrestHTML resolves an id
                           through the page's `teams` map, and on this page that
                           map is function-scoped — so the badge came out as the
                           club's short name in a circle while every other mark
                           on the screen drew the real crest. The code is what
                           the badge endpoint is keyed on; pass it and there is
                           nothing to resolve. */
                        captainRec = { name: p.name, form: p.form, opponent: oppName, xP: score.toFixed(1),
                            code: p.code, teamId: p.teamId, teamCode: p.teamCode, team: p.team };
                    }
                });

                // --- Mini-league card data (free from managerData.leagues.classic) ---
                let leagueInfo = null;
                const classicLeagues = (managerData.leagues && managerData.leagues.classic) || [];
                if (teamId === DEMO_TEAM_ID) {
                    const demoLeague = classicLeagues[0];
                    if (demoLeague) leagueInfo = { id: demoLeague.id, name: demoLeague.name, rank: demoLeague.entry_rank, lastRank: demoLeague.entry_last_rank };
                } else {
                    const savedLeagueId = localStorage.getItem('fpl_league_id');
                    if (savedLeagueId) {
                        const match = classicLeagues.find(l => String(l.id) === String(savedLeagueId));
                        if (match) leagueInfo = { id: match.id, name: match.name, rank: match.entry_rank, lastRank: match.entry_last_rank };
                    }
                }

                /* Live gameweek. While matches are in play the official data leaves
                   `bonus` at zero until each fixture finishes, so a score read off
                   total_points alone is short by up to three points a player. The
                   projection is computed from the BPS table, which is exact rather
                   than estimated — validated against a settled gameweek, where it
                   reproduced all 64 awarded bonus points with no mismatches. */
                let live = null;
                let liveByIdRaw = null, liveProjBonusRaw = null;   // for the matchday panel
                if (typeof liveIsInPlay === 'function' && liveIsInPlay(fixturesData, currentGW)) {
                    try {
                        const { byId, byFixture } = await liveFetchStats(currentGW);
                        const pending = livePendingBonusFixtures(fixturesData, currentGW);
                        const projBonus = liveProjectedBonus(byFixture, pending);
                        const score = liveSquadScore(picksData.picks, byId, projBonus,
                            { activeChip: picksData.active_chip });
                        liveByIdRaw = byId; liveProjBonusRaw = projBonus;
                        live = Object.assign(score, {
                            average: currEvent ? (currEvent.average_entry_score || 0) : 0
                        });
                    } catch (e) {
                        // A live fetch failing must not take the dashboard down with
                        // it; the panel simply stays in its pre-deadline form.
                        console.warn('Live gameweek unavailable:', e.message);
                    }
                }

                /* The top of the page is rendered before the panels below it.

                   These two calls used to sit ~100 lines further down, after
                   matchday, the market panel and the attention grid — so on
                   every load the dashboard filled from the bottom up, and the
                   two things a manager looks at first were the last to arrive.
                   Nothing here was waiting on data: every input is resolved by
                   this point, `live` on the line above being the last of them.
                   It was only the order of the calls.

                   renderStatusStrip's own fallback for #heroGwBadge is written
                   for exactly this position — it fills the badge only while
                   mdInit() has not run yet, and mdInit() takes the element over
                   immediately below. */
                renderStatusStrip({
                    live,
                    teamName: managerData.name,
                    currentGW,
                    rank: rankRaw,
                    totalPoints: totalPointsRaw,
                    gwPoints,
                    gwRank,
                    bank: bank.toFixed(1),
                    squadValue,
                    rankDelta,
                    pointsDiff,
                    deadlineTime,
                    deadlineGW,
                    leagueInfo
                });
                if (leagueInfo) loadLeagueGap(leagueInfo.id, teamId, totalPointsRaw);
                /* liveByIdRaw is only fetched while matches are actually in
                   play; eventLiveData is the committed copy that survives the
                   rest of the week, which is what lets the pitch still show a
                   finished round's scores on the Thursday after it. */
                renderPitchView({ squad, analysisResults, currentGW,
                    fixtures: fixturesData, teams,
                    eventLive: eventLiveData, liveById: liveByIdRaw });

                /* This gameweek's matches, and the gameweek badge that names them.

                   Given the live endpoint's numbers when the proxy answered and
                   the committed event-live.json when it did not, so the panel
                   renders either way. From here matchday.js owns #heroGwBadge and
                   keeps it ticking — the deadline flip is arithmetic on the clock,
                   so it no longer waits for a reload or for is_current to catch up. */
                if (typeof mdInit === 'function') {
                    mdInit({
                        events: bootData.events, fixtures: fixturesData, teams,
                        squad, eventLive: eventLiveData,
                        byId: liveByIdRaw, projBonus: liveProjBonusRaw
                    });
                }

                /* The best move available, from the same recommender the squad page
                   runs. Free transfers are replayed from the manager's history —
                   without it the hit cost is wrong, and a recommendation that
                   misprices a -4 is worse than none. One extra request, and it
                   fails soft. */
                let transferRec = null;
                let freeTransfers = 1;   // hoisted: the Transfers column reports it too
                /* Also hoisted, for the readiness checks. A free transfer is only
                   waste at the cap, and a chip only expires if it is unused — so
                   both checks need the ceiling and the chip history, not just the
                   count. Defaults are the season's opening position. */
                let maxFreeTransfers = 5;
                let chips = [];
                try {
                    try {
                        const hRes = await fetchWithProxy(`https://fantasy.premierleague.com/api/entry/${teamId}/history/`);
                        const hist = await hRes.json();
                        const maxFT = (bootData.game_settings?.max_extra_free_transfers ?? 4) + 1;
                        maxFreeTransfers = maxFT;
                        chips = hist.chips || [];
                        freeTransfers = twDeriveFreeTransfers(hist.current, hist.chips, maxFT);
                    } catch (e) { /* fall back to one, the season's opening position */ }

                    if (typeof twBuildRecommendation === 'function') {
                        // Players the squad analysis has already told this manager
                        // to move on. Passed as a tie-breaker so the recommended
                        // move and the Sell rows below it stop contradicting each
                        // other on near-equal options — see TW_FLAGGED_NUDGE.
                        const priorityOutIds = new Set(
                            squad.filter((p, i) => analysisResults[i] && analysisResults[i].verdict === 'sell')
                                 .map(p => p.id));
                        transferRec = twBuildRecommendation({
                            squad,
                            bank,
                            freeTransfers,
                            priorityOutIds
                        });
                    }
                } catch (e) {
                    console.warn('Transfer recommendation unavailable:', e.message);
                }

                // Scoped to the squad and shortlist, same pool the old inline rows
                // used — the market-wide view is the ticker at the top of the page.
                if (typeof mkRenderInto === 'function') mkRenderInto(mine);

                renderReadiness({ transferRec, squad, analysisResults, captainRec,
                    freeTransfers, maxFreeTransfers, bank, chips, deadlineTime });

                renderDeskFeed();

                /* What changed since the last visit. Runs after the squad is
                   real, because every event it can produce is a fact about one
                   of these fifteen players — and it writes its snapshot on the
                   way out, so the comparison next time is against what was
                   actually on screen this time. */
                if (typeof ntRenderInto === 'function') {
                    let phase = null;
                    try {
                        if (typeof mdCtx !== 'undefined' && mdCtx && typeof mdGameweekState === 'function') {
                            phase = mdGameweekState(mdCtx.events, mdCtx.fixtures).phase;
                        }
                    } catch (e) { /* the feed is worth having without the phase */ }
                    const liveRows = (typeof eventLiveData !== 'undefined' && eventLiveData
                        && eventLiveData.event === currentGW) ? (eventLiveData.elements || {}) : {};
                    /* The injury table, for the rows about these fifteen. Fetched
                       without awaiting anything else and without blocking the
                       bell: no file, no injury events, and the rest of the feed
                       is unaffected. */
                    fetch('/data/injuries.json?v=' + Math.floor(Date.now() / 300000))
                        .then(r => (r.ok ? r.json() : null))
                        .catch(() => null)
                        .then(d => {
                            const injuries = d && Array.isArray(d.items) ? d.items : [];
                            ntRenderInto({ squad, live: liveRows, phase, gw: currentGW, injuries });
                        });
                }
                renderPriceTicker(allPlayers, squad, {
                    phase: tickerPhase(fixturesData, bootData, currentGW),
                    currentGW, deadlineGW, deadlineTime,
                    liveRows: (eventLiveData && eventLiveData.event === currentGW)
                        ? (eventLiveData.elements || {}) : {},
                    fixtures: fixturesData,
                    squad, rank: rankRaw, rankDelta, leagueInfo, freeTransfers, bank
                });

                /* The news strip and headlines widget stay off — they were
                   disabled rather than hidden so the four RSS fetches would not
                   fire for nothing. The preview at the foot of the page is what
                   those fetches are for now, and it fails soft: no feeds, no
                   section, and nothing else on the dashboard waits for it. */
                /* The injuries come from the same file the News Hub reads and
                   are folded by the same builder, so the two pages cannot
                   disagree about what an injury story is. Fetched alongside the
                   feeds rather than before them: neither waits on the other,
                   and a failure in either still leaves the other's cards. */
                Promise.all([
                    fetchExternalNews(),
                    fetch('/data/injuries.json?v=' + Math.floor(Date.now() / 300000))
                        .then(r => r.ok ? r.json() : null)
                        .then(d => (d && Array.isArray(d.items) ? d.items : []))
                        .catch(() => [])
                ]).then(([externalItems, injuryRows]) => {
                    // `teams` is already keyed by id — see its construction above.
                    renderNewsPreview(externalItems, squad, injuryRows, teams);
                }).catch(e => console.warn('News preview unavailable:', e.message));
            } catch (err) {
                console.error('Ticker load error:', err);
                const friendly = typeof friendlyFplErrorMessage === 'function'
                    ? friendlyFplErrorMessage(err)
                    : (err.message === 'HTTP 404'
                        ? "We couldn't find a team with that ID — check the number and try again, or try a demo team below."
                        : 'Something went wrong loading your team. Please try again.');
                // A 503/502/504/429 or a bare timeout is FPL's own outage, not a
                // wrong Team ID — clearing a valid ID just forces the manager to
                // retype it on every retry during a window that can run 10-30
                // minutes right after a deadline. Only a real 404 means the ID
                // itself needs fixing.
                const transient = typeof isTransientFplError === 'function' && isTransientFplError(err);
                if (!transient) {
                    clearTeamId();
                    showNavTeamInput();
                    /* Only when the id has actually been cleared. Calling this
                       on a transient failure left the page disagreeing with
                       itself: the id was deliberately kept, so sidebar-nav.js
                       drew the signed-in shell, while this stripped .has-team
                       and put the marketing page back inside it. A sidebar
                       over a hero, with a form asking for the ID still in
                       storage. */
                    if (typeof onTeamIdCleared === 'function') onTeamIdCleared();
                }
                const errEl = document.getElementById('onboardingError');
                if (errEl) { errEl.textContent = friendly; errEl.classList.remove('hidden'); }
                // onboardingError sits far down the page (below hero/welcome/how-it-works),
                // so a manager retrying from the always-visible nav widget near the top would
                // never see it there — surface it in a fixed toast too.
                if (transient) {
                    const toast = document.getElementById('fplOutageToast');
                    const toastText = document.getElementById('fplOutageToastText');
                    if (toast && toastText) {
                        toastText.textContent = friendly;
                        toast.classList.remove('hidden');
                    }
                }
            }
        }

        // ===== SCROLL REVEAL =====
        /* initScrollReveal() in common.js — it used to live here, and the
           feature pages needed the same observer. */
        initScrollReveal();

        // Enter key handlers
        document.getElementById('onboardingInput').addEventListener('keypress', e => {
            if (e.key === 'Enter') submitFromOnboarding();
        });

        // V2: load the shared sidebar partial, then check for a saved team ID.
        loadSidebarNav().then(() => {
            /* Finishing a sign-out that the page they left could not do itself.
               auth.js is not on the squad pages, so v2LogOut() sends whoever
               pressed Log out here with this flag rather than keeping a second
               copy of the cookie names in common.js. Stripped from the address
               bar at once: it is an instruction, not a place. */
            if (new URLSearchParams(location.search).get('signout') === '1') {
                history.replaceState(null, '', location.pathname);
                /* Both, and in this order. auSignOut() reads the session
                   synchronously and has the request in flight before it yields,
                   so clearing straight after it cannot cancel the revocation —
                   and it means the cookie is gone before this frame ends rather
                   than whenever the network answers. Someone who clicks Log in
                   a second later would otherwise navigate away with the old
                   session still sitting there. */
                if (typeof auSignOut === 'function') { auSignOut().catch(() => {}); }
                if (typeof auClearSession === 'function') auClearSession();
                try { sessionStorage.removeItem('easyfpl_signed_in'); } catch (e) { /* private mode */ }
                return;
            }

            const savedTeamId = getSavedTeamId();
            if (savedTeamId) { activateTeamPage(savedTeamId); return; }

            /* Nothing in this browser, but the account may know the squad —
               the case for someone who has just signed in on a second device.

               Only after a sign-in, and only once. It used to run on every
               landing-page load with an empty browser, which cannot tell "first
               time on this device" from "I just deliberately signed out" — and
               answered both by putting the squad back. That is the loop: Log
               out cleared the browser, this read the id off the still-live
               account and put it straight back. Signing in is the event this
               was always for, so signing in is what marks it, and reading the
               mark clears it. */
            let justSignedIn = false;
            try {
                justSignedIn = sessionStorage.getItem('easyfpl_signed_in') === '1';
                if (justSignedIn) sessionStorage.removeItem('easyfpl_signed_in');
            } catch (e) { /* private mode: no mark, so no adoption */ }
            if (!justSignedIn) return;

            adoptTeamIdFromAccount().then(id => { if (id) activateTeamPage(id); });
        });
