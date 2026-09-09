/* ============================================
   EasyFPL — the player profile card

   One player, everything the site knows about him: the written verdict, the
   sell rating, key statistics, season numbers, where his projected points come
   from, the price meter and its season history, concerns and positives, the
   fixture run, his club's form and the opponents he is about to face.

   It lived in scripts/panels-and-tabs.js, which only the squad page loads, and
   that is the whole reason this file exists. The players page had a modal of
   its own showing a name, five tiles and four trend charts — not because
   anything richer was unavailable to it, but because the code that draws
   richer could not be reached from there. Both pages already build their
   players with xpBuildPlayers() and their teams with xpBuildTeamScores(), so
   the card had one page-specific dependency left, and it was the file it was
   sitting in.

   What each host page has to provide, all of them names this file reads
   directly rather than arguments:

     teams               id -> { name, short_name, code }
     teamAnalysis        xpBuildTeamScores()
     seasonStats         xpBuildSeasonStats()
     fixtureSwingData    xpBuildFixtureSwings()
     positionAverages    xpBuildPositionAverages()
     currentGW, isPreseason
     playersDetailData   players-data.json, for per-gameweek history and last
                         season's totals — optional, and the two blocks that
                         read it degrade rather than throw without it

   Optional, and picked up when present: userSettings (the squad page's
   sensitivity preset — PROFILE_DEFAULT_SETTINGS stands in otherwise),
   analysisResults (the squad's cached analyses), price-watch.js, and
   findReplacements()/openPairCompare() for the squad-only replacement table.

   Plain classic script like the rest: every function is a global, and the
   inline onclick= handlers depend on that.

   Two hooks let a page add to the card without this file knowing about it:

     pdmPageSections(player)   extra HTML, appended to the body
     pdmAfterRender(player)    called once the modal is in the DOM, for anything
                               that has to be mounted rather than rendered — the
                               players page draws its Chart.js trends there
   ============================================ */

        /* The squad page lets a manager dial how harshly a player is judged, and
           analyzePlayer() reads those weights. A page with no such control is not
           a page with no opinion — it is the balanced one, which is the preset
           the squad page itself starts on. */
        const PROFILE_DEFAULT_SETTINGS = {
            sellSensitivity: 1.0,   // multiplier for sell rating (>1 = aggressive, <1 = patient)
            fixtureWeight: 1.0,     // how much fixtures matter
            formWeight: 1.0,        // how much value fixtures carry
            valueWeight: 1.0,       // how much value-for-money matters
            minutesThreshold: 60,   // minutes per game to worry
            premiumHarshness: 1.0   // extra scrutiny on expensive players
        };

        function profileSettings() {
            return (typeof userSettings !== 'undefined' && userSettings) || PROFILE_DEFAULT_SETTINGS;
        }

        // ===== THE ANALYSIS =====
        /* Form, read honestly on a season that has barely started.

           FPL's `form` is average points over the last 30 days, so one gameweek
           in, it IS that one gameweek. Judged raw, 53% of every player who got
           on the pitch counted as "poor form" — which is not a form reading, it
           is "did not score three points once". A defender who played the full
           ninety and conceded a goal has a form of 2.0 and was charged for it,
           which is how a squad whose players had one quiet Saturday landed on a
           health score in the twenties.

           So regress it, the way every rate in the projection is regressed:
           toward what we already expect of this player, until there is a real
           sample behind it. The prior is his own points per game last season
           where that exists, and the position median where it does not. At four
           games the evidence weight reaches 1 and this returns raw form, so the
           thresholds downstream keep exactly the meaning they always had — they
           simply stop firing before anything has been demonstrated. */
        const FORM_EVIDENCE_GAMES = 4;

        let _lastSeasonById = null;
        function lastSeasonFor(playerId) {
            if (!_lastSeasonById) {
                const rows = playersDetailData && playersDetailData.players;
                // Not loaded yet: answer null WITHOUT caching, or the empty
                // answer sticks for the life of the page and the prior silently
                // reverts to the position median for everyone.
                if (!rows || !rows.length) return null;
                _lastSeasonById = {};
                rows.forEach(r => { if (r.lastSeason) _lastSeasonById[r.id] = r.lastSeason; });
            }
            return _lastSeasonById[playerId] || null;
        }

        function lastSeasonPointsPerGame(player) {
            const ls = lastSeasonFor(player.id);
            if (!ls || !ls.totalPoints) return null;
            const games = ls.starts || (ls.minutes ? ls.minutes / 90 : 0);
            // A handful of cameos is not a prior worth leaning on.
            if (games < 10) return null;
            return ls.totalPoints / games;
        }

        function regressedForm(player, posConfig, gamesPlayed) {
            const raw = isPreseason ? (player.ppg || 0) : (parseFloat(player.form) || 0);
            const prior = lastSeasonPointsPerGame(player);
            const base = prior != null ? prior : posConfig.formMedian;
            const evidence = Math.min(1, Math.max(0, gamesPlayed) / FORM_EVIDENCE_GAMES);
            return raw * evidence + base * (1 - evidence);
        }

        function analyzePlayer(player) {
            // Baseline: average player starts at 40 — dimensions push up (sell) or down (keep)
            let sellRating = 40;
            let reasons = [], concerns = [], positives = [];
            const posAvg = positionAverages[player.position] || { form: 3, ppg: 3, ppm: 15, xGIPer90: 0.3 };
            const posConfig = POSITION_CONFIG[player.position];
            // Preseason: currentGW-1 is 0 and player.form is already reset to 0.0 by FPL —
            // used as-is that's not "no data", it's a uniform false "poor form" flag on every
            // player plus an absurd minutes-per-game (last season's full total / 1). Fall back
            // to last season's real points-per-game and a starts-based games-played estimate.
            const gamesPlayed = isPreseason ? Math.max(player.starts || Math.round(player.minutes / 90), 1) : Math.max(currentGW - 1, 1);
            const minsPerGame = player.minutes / gamesPlayed;
            const effectiveForm = regressedForm(player, posConfig, gamesPlayed);
            // The raw figure is still what the card prints — it is a fact about
            // the matches played. It just no longer drives the judgement.
            const rawForm = isPreseason ? (player.ppg || 0) : (parseFloat(player.form) || 0);
            const isPremium = player.price >= 10.0;
            const isMidPremium = player.price >= 7.5;
            const isBudget = player.price <= 5.5;
            const ta = teamAnalysis[player.teamId]; // Team analysis data
            // The squad page's sensitivity preset where there is one, balanced
            // where there is not — see profileSettings() at the top of this file.
            const settings = profileSettings();

            // Asymmetric sensitivity: penalties amplified in aggressive mode, bonuses dampened (and vice-versa for patient)
            const sensAdj = (raw, ...weights) => {
                const w = weights.reduce((a, b) => a * b, 1);
                const s = raw >= 0 ? settings.sellSensitivity : (2 - settings.sellSensitivity);
                return raw * s * w;
            };

            // 1. AVAILABILITY (Critical — overrides baseline)
            // Tracked separately as well as added, because the squad health score
            // applies its own availability and form penalties and would otherwise
            // charge for both twice over.
            let availPenalty = 0, formPenaltyApplied = 0;
            if (player.status === 'i' || player.status === 'u' || player.status === 's') {
                availPenalty = sensAdj(40);
                sellRating += availPenalty;
                const statusText = player.status === 'i' ? 'Injured' : player.status === 'u' ? 'Unavailable' : 'Suspended';
                concerns.push({ type: 'critical', title: statusText, text: player.news || 'Check team news for updates' });
                reasons.push(`${statusText} — cannot play`);
            } else if (player.status === 'd') {
                const chance = player.chanceNextRound;
                const penalty = chance !== null ? Math.round((100 - chance) * 0.4) : 22;
                availPenalty = sensAdj(penalty);
                sellRating += availPenalty;
                concerns.push({ type: 'warning', title: 'Doubtful', text: `${chance !== null ? chance + '% chance' : '75% chance'} of playing. ${player.news || ''}` });
                if (penalty >= 18) reasons.push('Significant injury doubt');
            }

            // 2. FORM (Continuous — position-adjusted, asymmetric sensitivity)
            const formDelta = effectiveForm - posConfig.formMedian;
            // Linear: each 1.0 of formDelta = ~10 points; capped at ±30
            const rawFormPenalty = Math.max(-30, Math.min(30, Math.round(-formDelta * 10)));
            const formPenalty = sensAdj(rawFormPenalty, settings.formWeight);
            sellRating += formPenalty;
            formPenaltyApplied = formPenalty;

            if (formDelta <= -1.5) {
                concerns.push({ type: 'critical', title: 'Poor Form', text: `Form ${rawForm.toFixed(1)} is well below ${posConfig.short} average of ${posConfig.formMedian} — consider selling before price drops` });
                reasons.push('Form collapsed');
            } else if (formDelta <= -0.5) {
                concerns.push({ type: 'warning', title: 'Below Average Form', text: `Form ${rawForm.toFixed(1)} vs ${posConfig.short} median ${posConfig.formMedian} — monitor next 2 GWs` });
            } else if (formDelta >= 2.5) {
                positives.push({ type: 'positive', title: 'Elite Form', text: `Form ${rawForm.toFixed(1)} — top 5% of ${posConfig.short}s. Strong captain option` });
            } else if (formDelta >= 1.0) {
                positives.push({ type: 'positive', title: 'Good Form', text: `Form ${rawForm.toFixed(1)} — above ${posConfig.short} average, keep starting` });
            }

            // 3. FIXTURES (Continuous — near fixtures weighted more)
            const fixtures = player.fixtures || [];
            let avgFDR = 3;
            if (fixtures.length >= 3) {
                const weights = [3, 2.5, 2, 1.5, 1];
                let totalWeight = 0, weightedSum = 0;
                fixtures.slice(0, 5).forEach((f, i) => {
                    const w = weights[i] || 1;
                    weightedSum += f.difficulty * w;
                    totalWeight += w;
                });
                avgFDR = weightedSum / totalWeight;
            }
            // Linear: FDR 3 is neutral, each 1.0 away = ~14 points
            const rawFixPenalty = Math.max(-22, Math.min(22, Math.round((avgFDR - 3.0) * 14)));
            sellRating += sensAdj(rawFixPenalty, settings.fixtureWeight);

            if (avgFDR >= 3.8) {
                concerns.push({ type: 'warning', title: 'Tough Fixtures', text: `Weighted FDR ${avgFDR.toFixed(1)} — difficult run ahead` });
                reasons.push('Brutal fixture run');
            } else if (avgFDR <= 2.5) {
                positives.push({ type: 'positive', title: 'Great Fixtures', text: `Weighted FDR ${avgFDR.toFixed(1)} — fantastic fixture swing` });
            } else if (avgFDR <= 3.0) {
                positives.push({ type: 'positive', title: 'Decent Fixtures', text: `Weighted FDR ${avgFDR.toFixed(1)}` });
            }
            player.avgFDR = avgFDR;

            // 3b. OPPONENT QUALITY (uses team analysis attack/defence power)
            let opponentAdjustment = 0;
            if (fixtures.length >= 3 && Object.keys(teamAnalysis).length > 0) {
                const oppWeights = [3, 2.5, 2, 1.5, 1];
                let oppWeightedScore = 0, oppTotalWeight = 0;
                fixtures.slice(0, 5).forEach((f, i) => {
                    const oppTA = teamAnalysis[f.opponentId];
                    if (!oppTA) return;
                    const w = oppWeights[i] || 1;
                    if (player.position <= 2) {
                        // Defenders: opponent attack power matters (strong attack = harder to keep CS)
                        oppWeightedScore += ((oppTA.attackPower - 50) / 50) * w;
                    } else {
                        // Attackers: opponent defence power matters (strong defence = harder to score)
                        oppWeightedScore += ((oppTA.defensePower - 50) / 50) * w;
                    }
                    oppTotalWeight += w;
                });
                if (oppTotalWeight > 0) {
                    opponentAdjustment = Math.round(Math.max(-10, Math.min(12, (oppWeightedScore / oppTotalWeight) * 8)));
                    sellRating += sensAdj(opponentAdjustment, settings.fixtureWeight);

                    if (opponentAdjustment >= 5) {
                        const label = player.position <= 2 ? 'Strong Attacking Opponents' : 'Strong Defensive Opponents';
                        concerns.push({ type: 'warning', title: label, text: `Upcoming opponents have high ${player.position <= 2 ? 'attack' : 'defence'} power — harder to return points` });
                    } else if (opponentAdjustment <= -5) {
                        const label = player.position <= 2 ? 'Weak Attacking Opponents' : 'Weak Defensive Opponents';
                        positives.push({ type: 'positive', title: label, text: `Upcoming opponents are ${player.position <= 2 ? 'weak in attack' : 'leaky at the back'} — favourable matchups` });
                    }
                }
            }

            // 4. MINUTES & ROTATION (Continuous, more aggressive)
            let minsPenalty = 0;
            if (minsPerGame < 20) { minsPenalty = 35; }
            else if (minsPerGame < 60) { minsPenalty = Math.round(32 - (minsPerGame - 20) * (32 / 40)); }
            else if (minsPerGame < 75) { minsPenalty = Math.round(5 - (minsPerGame - 60) * (7 / 15)); }
            else if (minsPerGame >= 85) { minsPenalty = -6; }
            else { minsPenalty = -2; }
            sellRating += sensAdj(minsPenalty);
            player.minsPerGame = minsPerGame;

            if (minsPerGame < 45) {
                concerns.push({ type: 'critical', title: 'Rotation Risk', text: `Only ${minsPerGame.toFixed(0)} mins/game (${player.starts} starts in ${gamesPlayed} GWs) — consider benching or selling` });
                reasons.push('Not starting regularly');
            } else if (minsPerGame < 65) {
                concerns.push({ type: 'warning', title: 'Reduced Minutes', text: `${minsPerGame.toFixed(0)} mins/game — rotation risk, bench for tough fixtures` });
            } else if (minsPerGame >= 85) {
                positives.push({ type: 'positive', title: 'Nailed On', text: `${minsPerGame.toFixed(0)} mins/game — guaranteed starter, no rotation worry` });
            }

            // 5. VALUE FOR MONEY (Continuous — more aggressive, especially for premiums)
            const ppm = player.points / Math.max(player.price, 1);
            const ppmDelta = ppm - posAvg.ppm;
            const ppgDelta = player.ppg - posAvg.ppg;
            player.ppm = ppm;

            // Blend PPM and PPG deltas for a richer value signal
            const valueSignal = (ppmDelta * 0.6) + (ppgDelta * 2.5);
            let rawValuePenalty = Math.max(-15, Math.min(22, Math.round(-valueSignal)));
            if (isPremium) rawValuePenalty = Math.round(rawValuePenalty * settings.premiumHarshness * 1.5);
            else if (isMidPremium) rawValuePenalty = Math.round(rawValuePenalty * settings.premiumHarshness * 1.2);
            sellRating += sensAdj(rawValuePenalty, settings.valueWeight);

            if (isPremium && effectiveForm < posConfig.formMedian) {
                sellRating += sensAdj(5); // Extra premium penalty
                concerns.push({ type: 'critical', title: 'Premium Underperforming', text: `£${player.price.toFixed(1)}m price tag not justified (${ppm.toFixed(1)} pts/£m vs avg ${posAvg.ppm.toFixed(1)}) — sell to free up funds for better options` });
                if (!reasons.length) reasons.push('Premium not delivering');
            } else if (isMidPremium && effectiveForm < posConfig.formMedian - 0.5) {
                concerns.push({ type: 'warning', title: 'Mid-Premium Underperforming', text: `£${player.price.toFixed(1)}m with poor form — downgrade to fund upgrades elsewhere` });
            } else if (ppmDelta > 3) {
                positives.push({ type: 'positive', title: 'Great Value', text: `${ppm.toFixed(1)} pts/£m — well above ${posConfig.short} average (${posAvg.ppm.toFixed(1)})` });
            }

            // 6. xG ANALYSIS (Continuous, wider penalty range)
            if (player.position >= 3 && player.minutes >= 270) {
                const xGIPer90 = (player.xGI / player.minutes) * 90;
                const actualGI = player.goals + player.assists;
                const overperformance = actualGI - player.xGI;
                player.xGIPer90 = xGIPer90;

                // Continuous: xGI/90 below 0.30 is a concern, above 0.50 is great
                const xGPenalty = Math.max(-15, Math.min(18, Math.round((0.35 - xGIPer90) * 35)));
                sellRating += sensAdj(xGPenalty);

                if (xGIPer90 < 0.20) {
                    concerns.push({ type: 'warning', title: 'Low Underlying Stats', text: `${xGIPer90.toFixed(2)} xGI/90 — not creating enough chances` });
                } else if (xGIPer90 < 0.30) {
                    concerns.push({ type: 'info', title: 'Below Average xGI', text: `${xGIPer90.toFixed(2)} xGI/90 — mediocre output` });
                } else if (xGIPer90 >= 0.60) {
                    positives.push({ type: 'positive', title: 'Strong xGI', text: `${xGIPer90.toFixed(2)} xGI/90 — high-quality chances` });
                }

                if (overperformance > 2.0) {
                    sellRating += sensAdj(Math.round(Math.min(12, overperformance * 2.5)));
                    concerns.push({ type: 'warning', title: 'Overperforming xG', text: `${actualGI} G+A vs ${player.xGI.toFixed(1)} xGI — regression risk, consider selling high (+${overperformance.toFixed(1)})` });
                } else if (overperformance < -2.5) {
                    sellRating += sensAdj(-Math.round(Math.min(8, Math.abs(overperformance) * 1.5)));
                    positives.push({ type: 'positive', title: 'Due Returns', text: `${actualGI} G+A vs ${player.xGI.toFixed(1)} xGI — unlucky, due a haul — hold and be patient (${overperformance.toFixed(1)})` });
                }
            } else if (player.position <= 2 && player.minutes >= 270) {
                const csRate = player.cleanSheets / gamesPlayed;
                player.csRate = csRate;
                // Continuous: CS rate below 20% adds penalty, above 35% gives bonus (wider range)
                const csPenalty = Math.max(-10, Math.min(14, Math.round((0.28 - csRate) * 35)));
                sellRating += sensAdj(csPenalty);

                if (csRate >= 0.40) {
                    positives.push({ type: 'positive', title: 'CS Machine', text: `${(csRate * 100).toFixed(0)}% clean sheet rate` });
                } else if (csRate <= 0.18 && !isBudget) {
                    concerns.push({ type: 'warning', title: 'Few Clean Sheets', text: `Only ${(csRate * 100).toFixed(0)}% CS rate — poor defensive returns` });
                }
                player.xGIPer90 = player.position === 1 ? (player.saves / Math.max(player.minutes / 90, 1)) : ((player.xGI / Math.max(player.minutes, 1)) * 90);
            }

            // 7. OWNERSHIP URGENCY (more sensitive)
            if (player.ownership > 20 && sellRating > 45) {
                sellRating += 5;
                concerns.push({ type: 'info', title: 'High Ownership Risk', text: `${player.ownership.toFixed(1)}% owned — price drop risk if others sell` });
            } else if (player.ownership < 8 && sellRating < 30) {
                positives.push({ type: 'positive', title: 'Differential', text: `Only ${player.ownership.toFixed(1)}% owned — great differential pick` });
                sellRating -= 3;
            }

            // 7b. NET TRANSFERS — heavy selling = price drop risk
            const netTransfers = player.transfersIn - player.transfersOut;
            player.netTransfers = netTransfers;
            if (netTransfers < -20000) {
                sellRating += sensAdj(4);
                concerns.push({ type: 'info', title: 'Mass Selling', text: `${(netTransfers / 1000).toFixed(0)}k net transfers — sell now before price drops further` });
            }

            // 8. TEAM CONTEXT (from team analysis — attack, defence, form scoring)
            if (ta) {
                // Team form: poor team form = harder for all players to return
                const teamFormDelta = (ta.formRating - 50) / 50; // -1 to +1
                const teamFormPenalty = Math.round(teamFormDelta * -8); // bad form → +8, good form → -8
                sellRating += sensAdj(teamFormPenalty);

                if (ta.formRating < 30) {
                    concerns.push({ type: 'warning', title: 'Team in Poor Form', text: `${player.team} form rating ${ta.formRating}/100 — team struggling (W${ta.wins} D${ta.draws} L${ta.losses} last 5)` });
                    if (!reasons.length) reasons.push('Team in poor form');
                } else if (ta.formRating >= 70) {
                    positives.push({ type: 'positive', title: 'Team in Great Form', text: `${player.team} form rating ${ta.formRating}/100 — team on fire (W${ta.wins} D${ta.draws} L${ta.losses} last 5)` });
                }

                // Position-specific: attackers benefit from strong team attack
                if (player.position >= 3) {
                    const attDelta = (ta.attackPower - 50) / 50;
                    const teamAttPenalty = Math.round(attDelta * -8);
                    sellRating += sensAdj(teamAttPenalty);

                    if (ta.attackPower < 35) {
                        concerns.push({ type: 'warning', title: 'Weak Team Attack', text: `${player.team} attack power ${ta.attackPower}/100 — limited goal threat (${ta.avgGoals.toFixed(1)} goals/game)` });
                    } else if (ta.attackPower >= 65) {
                        positives.push({ type: 'positive', title: 'Strong Team Attack', text: `${player.team} attack power ${ta.attackPower}/100 — high goal output (${ta.avgGoals.toFixed(1)} goals/game)` });
                    }
                }

                // Position-specific: defenders benefit from strong team defence
                if (player.position <= 2) {
                    const defDelta = (ta.defensePower - 50) / 50;
                    const teamDefPenalty = Math.round(defDelta * -8);
                    sellRating += sensAdj(teamDefPenalty);

                    if (ta.defensePower < 35) {
                        concerns.push({ type: 'warning', title: 'Weak Team Defence', text: `${player.team} defence power ${ta.defensePower}/100 — hard to keep clean sheets (${ta.avgConceded.toFixed(1)} conceded/game)` });
                    } else if (ta.defensePower >= 65) {
                        positives.push({ type: 'positive', title: 'Strong Team Defence', text: `${player.team} defence power ${ta.defensePower}/100 — clean sheet potential (${ta.csRate > 0 ? (ta.csRate * 100).toFixed(0) + '% CS rate' : ''})` });
                    }
                }

                // Team fixture score impacts all players
                if (ta.fixtureScore < 30) {
                    sellRating += sensAdj(4, settings.fixtureWeight);
                    concerns.push({ type: 'info', title: 'Poor Team Fixture Score', text: `${player.team} fixture score ${ta.fixtureScore}/100 — tough schedule ahead` });
                } else if (ta.fixtureScore >= 70) {
                    sellRating += sensAdj(-3, settings.fixtureWeight);
                    positives.push({ type: 'positive', title: 'Great Team Fixture Score', text: `${player.team} fixture score ${ta.fixtureScore}/100 — favourable run, hold players` });
                }
            }

            sellRating = Math.max(0, Math.min(100, Math.round(sellRating)));

            // VERDICT (tighter thresholds — more active flagging)
            let verdict, verdictReason, recommendation;
            const nextFix = (player.fixtures || [])[0];
            const nextOpp = nextFix ? nextFix.opponent : '';
            const nextGW = nextFix ? nextFix.event : currentGW + 1;

            if (sellRating >= 55) {
                verdict = 'sell';
                verdictReason = reasons[0] || 'Multiple red flags — prioritize transfer';
                const priceRisk = (player.netTransfers || 0) < -10000 ? ' Price drop risk.' : '';
                recommendation = `Transfer out before GW${nextGW}.${priceRisk} ${concerns.length > 0 ? concerns[0].text : ''}`;
            } else if (sellRating >= 38) {
                verdict = 'monitor';
                verdictReason = reasons[0] || 'Some concerns — monitor closely';
                const fixNote = avgFDR <= 2.8 ? ' Fixtures improve soon — hold for now.' : avgFDR >= 3.5 ? ' Tough fixtures ahead — consider selling.' : '';
                recommendation = `Reassess after GW${nextGW}.${fixNote}`;
            } else if (sellRating <= 20 && effectiveForm >= posConfig.formMedian + 1.5 && minsPerGame >= 75) {
                verdict = 'star';
                verdictReason = positives.length > 0 ? positives[0].text : 'Top performer — team cornerstone';
                recommendation = `Captain candidate GW${nextGW}${nextOpp ? ` vs ${nextOpp}` : ''}. Lock in and don't overthink.`;
            } else {
                verdict = 'hold';
                verdictReason = positives.length > 0 ? positives[0].text : 'Performing as expected';
                recommendation = `Keep starting. Reliable performer${avgFDR <= 3.0 ? ' with decent fixtures ahead' : ''}.`;
            }

            const keyMetric = buildKeyMetrics(player, posConfig, minsPerGame, avgFDR, effectiveForm, rawForm);
            return { player, sellRating, verdict, verdictReason, recommendation, concerns, positives, keyMetric,
                availPenalty, formPenalty: formPenaltyApplied, effectiveForm, rawForm, fixtures: fixtures.slice(0, 5) };
        }

        // `form` is what gets printed; `judged` is what decides the colour. Early
        // in a season those differ: the number is real, the verdict on it is not.
        function buildKeyMetrics(player, posConfig, minsPerGame, avgFDR, judgedForm, shownForm) {
            const form = shownForm != null ? shownForm : (isPreseason ? player.ppg : player.form);
            const judged = judgedForm != null ? judgedForm : form;
            const ta = teamAnalysis[player.teamId];
            if (player.position <= 2) {
                return {
                    primary: { label: 'Form', value: form.toFixed(1), status: judged >= posConfig.formMedian + 1 ? 'good' : judged < posConfig.formMedian - 0.5 ? 'bad' : 'warning' },
                    secondary: { label: 'Def', value: ta ? ta.defensePower.toString() : '-', status: ta ? (ta.defensePower >= 60 ? 'good' : ta.defensePower < 40 ? 'bad' : 'warning') : 'neutral' },
                    tertiary: { label: 'FDR', value: avgFDR.toFixed(1), status: avgFDR <= 2.8 ? 'good' : avgFDR >= 3.5 ? 'bad' : 'warning' },
                    quaternary: { label: 'PPG', value: player.ppg.toFixed(1), status: player.ppg >= 5 ? 'good' : player.ppg < 3 ? 'bad' : 'neutral' }
                };
            } else {
                const xGIPer90 = player.xGIPer90 || (player.minutes > 0 ? (player.xGI / player.minutes) * 90 : 0);
                return {
                    primary: { label: 'Form', value: form.toFixed(1), status: judged >= posConfig.formMedian + 1.5 ? 'good' : judged < posConfig.formMedian - 0.5 ? 'bad' : 'warning' },
                    secondary: { label: 'Att', value: ta ? ta.attackPower.toString() : '-', status: ta ? (ta.attackPower >= 60 ? 'good' : ta.attackPower < 40 ? 'bad' : 'warning') : 'neutral' },
                    tertiary: { label: 'xGI/90', value: xGIPer90.toFixed(2), status: xGIPer90 >= 0.50 ? 'good' : xGIPer90 < 0.25 ? 'bad' : 'warning' },
                    quaternary: { label: 'FDR', value: avgFDR.toFixed(1), status: avgFDR <= 2.8 ? 'good' : avgFDR >= 3.5 ? 'bad' : 'warning' }
                };
            }
        }

        // ===== LEAGUE CONTEXT =====
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

        // ===== THE SECTIONS =====
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

            return `<div class="detail-section rtp-section" data-accent="routes">
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

            return `<div class="detail-section" data-accent="team" data-wide>
                <div class="detail-section-title">${v2Icon('swords')} Opponent Form \u2014 Next ${upcoming.length}</div>
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

            /* The meter, drawn. This is a percentage of a fixed scale — how far
               along a price change this player is — and it was a coloured word
               and a sentence, which is the one shape a percentage should never
               take. The bar is the reading; the words underneath say what it
               means and, for the "closing in" tier, that it is a position and
               not a forecast. */
            const meter = (pct, dir, label, detail) => {
                const width = Math.max(3, Math.min(100, Math.abs(pct)));
                return `<div class="pw-meter ${dir}">
                    <div class="pw-meter-head">
                        <span class="pw-meter-pct">${Math.round(Math.abs(pct))}<em>%</em></span>
                        <span class="pw-meter-label">${escHTML(label)}</span>
                    </div>
                    <div class="pw-meter-track"><i style="width:${width}%"></i></div>
                    <div class="pw-meter-detail">${escHTML(detail)}</div>
                </div>`;
            };

            let body;
            if (locked) {
                body = `<div class="pw-meter locked">
                    <div class="pw-meter-head"><span class="pw-meter-label">Locked</span></div>
                    <div class="pw-meter-track"><i style="width:0%"></i></div>
                    <div class="pw-meter-detail">Price changes are locked for this player right now.</div>
                </div>`;
            } else if (pw) {
                const dirWord = pw.dir === 'rise' ? 'rise' : 'fall';
                body = meter(pw.progress, pw.dir,
                    pw.tier === 'due' ? `${dirWord} due tonight` : `to a ${dirWord}`,
                    pwDetail(pw));
            } else if (mom) {
                body = meter(0, mom.rising ? 'rise' : 'fall', mom.label,
                    `Net ${mom.net > 0 ? '+' : '\u2212'}${Math.abs(mom.net).toLocaleString()} transfers this gameweek \u2014 early momentum, not yet close to a change.`);
            } else {
                body = `<div class="pw-meter flat">
                    <div class="pw-meter-head"><span class="pw-meter-pct">0<em>%</em></span><span class="pw-meter-label">stable</span></div>
                    <div class="pw-meter-track"><i style="width:3%"></i></div>
                    <div class="pw-meter-detail">No meaningful price-change signal right now.</div>
                </div>`;
            }

            return `<div class="detail-section" data-accent="price">
                <div class="detail-section-title">\ud83d\udcb7 Price Watch</div>
                ${body}
                ${renderPriceHistoryBlock(player)}
            </div>`;
        }

        /* ===== Where the price has been =====

           The meter above is entirely about tonight. It could not say whether a
           player is \u00a30.3m up on the season or \u00a30.2m down, which is the figure
           that decides what a squad can afford in February and the one thing a
           manager cannot reconstruct from anywhere else on the site.

           pwPriceHistory() in scripts/price-watch.js does the arithmetic; this
           draws it. The chart is a polyline over the gameweek prices with today
           appended, on a y-axis padded by a tenth either side so a season with a
           single move is a visible step rather than a line hugging the frame. A
           flat season is drawn flat and said in words, rather than being
           stretched to fill the box and implying movement that did not happen. */
        function renderPriceHistoryBlock(player) {
            if (typeof pwPriceHistory !== 'function') return '';
            const history = (playersDetailData?.players || []).find(p => p.id === player.id)?.history || [];
            const h = pwPriceHistory(player, history);
            if (!h) return '';

            const dir = h.netTenths > 0 ? 'up' : h.netTenths < 0 ? 'down' : 'flat';
            // "\u00a30.0m" is a worse way of saying nothing happened than saying it.
            const netTxt = h.netTenths === 0
                ? 'no change'
                : `${h.netTenths > 0 ? '+' : '\u2212'}\u00a3${Math.abs(h.net).toFixed(1)}m`;

            const W = 240, H = 46, PAD = 4;
            const tenths = h.points.map(p => p.tenths);
            const lo = Math.min.apply(null, tenths) - 1;
            const hi = Math.max.apply(null, tenths) + 1;
            const span = Math.max(1, hi - lo);
            const x = i => PAD + (h.points.length > 1 ? (i / (h.points.length - 1)) * (W - PAD * 2) : (W - PAD * 2) / 2);
            const y = t => PAD + (1 - (t - lo) / span) * (H - PAD * 2);
            const pts = h.points.map((p, i) => `${x(i).toFixed(1)},${y(p.tenths).toFixed(1)}`).join(' ');

            const label = p => p.isNow ? 'now' : p.isStart ? 'season start' : `GW${p.gw}`;
            const dots = h.points.map((p, i) =>
                `<circle cx="${x(i).toFixed(1)}" cy="${y(p.tenths).toFixed(1)}" r="${p.isNow ? 3 : 2}"
                    class="${p.isNow ? 'ph-dot-now' : 'ph-dot'}"><title>${escHTML(label(p))}: \u00a3${(p.tenths / 10).toFixed(1)}m</title></circle>`
            ).join('');

            /* Only the weeks the price actually moved. Most gameweeks it does
               not, and a row per gameweek would bury the three that matter. */
            const moves = h.moves.slice(-6).map(m => {
                const up = m.to > m.from;
                // The final step has no gameweek of its own: it happened after the
                // most recent one was played, which is what "now" means here.
                const when = m.isNow || m.gw == null ? 'now' : `GW${m.gw}`;
                return `<li class="${up ? 'up' : 'down'}"><span class="ph-move-gw">${escHTML(when)}</span>
                    <span class="ph-move-val">\u00a3${(m.from / 10).toFixed(1)} \u2192 \u00a3${(m.to / 10).toFixed(1)}</span></li>`;
            }).join('');

            return `<div class="ph-block">
                <div class="ph-head">
                    <span class="ph-title">Price this season</span>
                    <span class="ph-net ${dir}" data-tooltip="Started at \u00a3${h.start.toFixed(1)}m, worth \u00a3${h.now.toFixed(1)}m now.">${netTxt}</span>
                </div>
                <div class="ph-rail">
                    <span class="ph-end"><em>start</em>\u00a3${h.start.toFixed(1)}m</span>
                    <svg class="ph-spark ${dir}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
                        aria-label="Price from \u00a3${h.start.toFixed(1)}m at the start of the season to \u00a3${h.now.toFixed(1)}m now">
                        <polyline points="${pts}" fill="none" />
                        ${dots}
                    </svg>
                    <span class="ph-end right"><em>now</em>\u00a3${h.now.toFixed(1)}m</span>
                </div>
                ${h.moves.length
                    ? `<ul class="ph-moves">${moves}</ul>
                       <div class="ph-note">${h.rises} rise${h.rises === 1 ? '' : 's'}, ${h.falls} fall${h.falls === 1 ? '' : 's'};
                       high \u00a3${h.high.toFixed(1)}m, low \u00a3${h.low.toFixed(1)}m.</div>`
                    : `<div class="ph-note">Unchanged at \u00a3${h.now.toFixed(1)}m all season.</div>`}
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
            const cached = (typeof analysisResults !== 'undefined' && analysisResults) || [];
            const existing = cached.find(a => a.player && a.player.id === player.id);
            if (existing) return existing;
            if (!player.fixtures || !player.fixtures.length) {
                /* teamFixtures6 first, deliberately. Both pages build it with
                   xpBuildTeamFixtures(), so every entry carries the opponentId
                   the opponent model reads; the players page's own teamFixtures
                   puts a numeric id in `opponent` and has no opponentId at all,
                   which renders as "vs 12" and degrades the projection to an
                   FDR-only estimate. Same trap ARCHITECTURE.md documents. */
                player.fixtures = (typeof teamFixtures6 !== 'undefined' && teamFixtures6 && teamFixtures6[player.teamId])
                    || (typeof teamFixtures !== 'undefined' && teamFixtures && teamFixtures[player.teamId])
                    || [];
            }
            return analyzePlayer(player);
        }

        /* The player behind an id, wherever this page keeps them.

           The squad page holds fifteen analysed players in analysisResults and
           every other player in allPlayersById; the players page holds the whole
           game in xpPlayersById and nothing analysed at all. Both answers are
           the same shape — xpBuildPlayers() built them — so the only difference
           is which pool to look in, and whether the analysis is already done.

           `context` is what the card's opening sentence and verdict chip read:
           "sell candidate" is a sentence about a player you own, and a
           non-sequitur about one you are considering buying. */
        function pdmLookup(playerId) {
            const cached = (typeof analysisResults !== 'undefined' && analysisResults) || [];
            const owned = cached.find(a => a.player && a.player.id === playerId);
            if (owned) return { analysis: owned, context: 'squad' };

            const pool = (typeof xpPlayersById !== 'undefined' && xpPlayersById && xpPlayersById[playerId])
                || (typeof allPlayersById !== 'undefined' && allPlayersById && allPlayersById[playerId])
                || null;
            if (!pool) return null;
            return { analysis: getPlayerAnalysis(pool), context: 'candidate' };
        }

        // Builds a player's full analytical profile \u2014 AI report, verdict, key
        // stats, season numbers, routes to points, price watch, concerns/
        // positives, upcoming fixtures, team context (incl. fixture swing) and
        // opponent form. Shared by the modal below (renderPlayerModal, on both
        // the squad page and the players page) and the Transfer Wizard's
        // head-to-head compare, so a buy candidate gets exactly the same depth
        // as one of your own XI. `opts`:
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
                ? { star: 'STRONG', hold: 'SOLID', monitor: 'MIXED', sell: 'WEAK' }[verdict] || verdict.toUpperCase()
                : (verdict === 'star' ? 'STAR' : verdict.toUpperCase());

            let html = '';

            if (showHeader) {
                html += `<div class="pd-header">
                    <span class="position-badge ${posConfig.class}">${posConfig.short}</span>
                    <span class="pd-header-name">${player.isCaptain ? '\ud83d\udc51 ' : ''}${escHTML(player.name)}</span>
                    <span class="pd-header-meta">${escHTML(player.team)} \u00b7 \u00a3${player.price.toFixed(1)}m \u00b7 ${player.ownership.toFixed(1)}% owned</span>
                </div>`;
            }

            // ===== PLAYER =====
            html += `<div class="pd-group"><div class="pd-group-title">\ud83d\udc64 Player</div>`;

            if (showReport) {
                // Every other number on this card is season-to-date or a projection,
                // so what the player actually did in the round just played had
                // nowhere to live \u2014 you had to leave the card to find out whether
                // the man you are reading about scored on Saturday.
                const gwLine = typeof gwPlayerReportLine === 'function' && typeof gwReviewTarget === 'function'
                    ? gwPlayerReportLine(player, gwReviewTarget())
                    : '';
                html += `<div class="detail-section pd-report" data-accent="report">
                    <div class="detail-section-title">\ud83e\udde0 AI Report</div>
                    ${gwLine}
                    <div class="pd-report-text">${escHTML(buildPlayerNarrativeReport(player, analysis, context))}</div>
                </div>`;
            }

            /* The conclusion, next to the argument that reached it. The rating
               is a meter rather than "Sell Rating: 0/100" in grey text — it was
               the one number on this card you had to stop and parse, and it is
               a percentage of a fixed scale, which is what a bar is for. */
            const sellTone = sellRating >= 65 ? 'var(--verdict-sell)'
                : sellRating >= 35 ? 'var(--verdict-monitor)' : 'var(--verdict-hold)';
            html += `<div class="detail-section pd-verdict" data-accent="verdict">
                <div class="detail-section-title">${v2Icon('scales')} Verdict</div>
                <div class="pd-verdict-top">
                    <span class="pd-verdict-chip ${verdict}">${chipLabel}</span>
                </div>
                <div class="pd-verdict-why" style="margin-bottom:10px;">${escHTML(verdictReason)}</div>
                ${showRecommendation && recommendation ? `<div class="pd-verdict-rec"><strong>Do this:</strong> ${escHTML(recommendation)}</div>` : ''}
                <div class="pd-sell-rate" title="How strongly the model rates this player as a sell, out of 100.">
                    <span class="pd-sell-rate-label">Sell rating</span>
                    <span class="pd-sell-rate-bar"><i style="width:${Math.max(0, Math.min(100, sellRating))}%;background:${sellTone}"></i></span>
                    <span class="pd-sell-rate-num" style="color:${sellTone}">${sellRating}</span>
                </div>
            </div>`;

            /* Price Watch rides with the summary rather than sitting below the
               stat columns. It is the third short thing this card has to say —
               what the model thinks, what it concludes, and whether the price is
               about to move — and the three of them fit on one row. */
            html += renderPriceWatchSection(player);

            /* What he has actually returned, alongside the rates that predict it.

               Every tile above this point is either forward-looking (FDR) or a
               per-90 rate, so the plainest question anyone asks about a player \u2014
               how many has he scored? \u2014 could only be answered by scrolling past
               the whole card to Season Numbers. Position picks the two that
               matter: a defender is owned for clean sheets and a forward for
               goals, and showing all four to both is how a stat grid turns into
               a wall nobody reads. */
            const appearances = Math.max(player.starts || 0, 1);
            /* His own starts, not gameweeks elapsed. A clean sheet needs 60
               minutes, so the games he did not start were never chances at one \u2014
               dividing by the calendar punishes a player for the weeks he was
               injured and reports a rate he never had. */
            const csPct = Math.round(((player.cleanSheets || 0) / appearances) * 100);
            const goals = player.goals || 0, assists = player.assists || 0;
            const startsNote = `${player.starts || 0} start${(player.starts || 0) === 1 ? '' : 's'}`;
            /* Returns against expected is the difference between a player who is
               finishing well and one who is getting into the right places. They
               are the same number this week and different ones by October, and
               only the second kind is worth buying. Skipped while the expected
               figure is too small to divide a season on. */
            const vsExpected = (actual, expected, mark) => {
                if (!(expected > 0.5)) return `${expected.toFixed(1)} x${mark}`;
                const d = actual - expected;
                return `${expected.toFixed(1)} x${mark} \u00b7 ${Math.abs(d) < 1 ? 'about par'
                    : d > 0 ? `${d.toFixed(1)} above` : `${Math.abs(d).toFixed(1)} below`}`;
            };
            const band = (v, good, bad) => v >= good ? 'var(--verdict-hold)'
                : v <= bad ? 'var(--verdict-sell)' : 'var(--verdict-monitor)';

            let returnStats;
            if (player.position === 1) {
                const savesPer90 = player.minutes > 0 ? ((player.saves || 0) / player.minutes) * 90 : 0;
                returnStats =
                    renderDetailStat('Clean Sheets', String(player.cleanSheets || 0), csPct / 100,
                        band(csPct, 35, 19), `${csPct}% of ${startsNote} \u00b7 4 pts each`) +
                    renderDetailStat('Saves', String(player.saves || 0), Math.min((player.saves || 0) / 70, 1),
                        'var(--color-info)', `${savesPer90.toFixed(1)} per 90 \u00b7 every 3 is a point`);
            } else if (player.position === 2) {
                returnStats =
                    renderDetailStat('Clean Sheets', String(player.cleanSheets || 0), csPct / 100,
                        band(csPct, 35, 19), `${csPct}% of ${startsNote} \u00b7 4 pts each`) +
                    renderDetailStat('Goals + Assists', String(goals + assists), Math.min((goals + assists) / 8, 1),
                        (goals + assists) >= 4 ? 'var(--verdict-hold)' : 'var(--text-primary)',
                        `${goals}G ${assists}A \u00b7 a defender's goal is worth 6`);
            } else {
                const goalPts = player.position === 4 ? 4 : 5;
                returnStats =
                    renderDetailStat('Goals', String(goals), Math.min(goals / 12, 1),
                        goals >= 6 ? 'var(--verdict-hold)' : goals <= 1 ? 'var(--verdict-sell)' : 'var(--text-primary)',
                        `${vsExpected(goals, player.xG || 0, 'G')} \u00b7 ${goalPts} pts each`) +
                    renderDetailStat('Assists', String(assists), Math.min(assists / 8, 1),
                        assists >= 4 ? 'var(--verdict-hold)' : 'var(--text-primary)',
                        `${vsExpected(assists, player.xA || 0, 'A')} \u00b7 3 pts each`);
            }

            html += `<div class="detail-section" data-accent="stats">
                <div class="detail-section-title">\ud83d\udcca Key Statistics <span style="font-weight:400;color:var(--text-muted);font-size:11px;">\u2014 ${statsScopeLabel}</span></div>
                <div class="detail-stats-grid">
                    ${renderDetailStat('Form', player.form.toFixed(1), player.form / 10, player.form >= 5 ? 'var(--verdict-hold)' : player.form < 3 ? 'var(--verdict-sell)' : 'var(--verdict-monitor)', `${posConfig.short} median: ${posConfig.formMedian}`)}
                    ${renderDetailStat('Pts/Game', player.ppg.toFixed(1), player.ppg / 10, player.ppg >= 5 ? 'var(--verdict-hold)' : player.ppg < 3 ? 'var(--verdict-sell)' : 'var(--text-primary)', `Total: ${player.points} pts`)}
                    ${/* "Mins/Game" over a denominator of gameweeks elapsed, which is
                          not the same thing: a player who starts every match he is fit
                          for still reads 63 after missing four rounds injured, and 63
                          in an amber tile says "rotation risk" about someone who has
                          never been rotated. The number is the useful one — what he
                          has actually given you per week is exactly what you are
                          buying — so the label is what changes, and the context spells
                          the division out rather than leaving it to be guessed. */''}
                    ${renderDetailStat('Mins/GW', minsPerGame.toFixed(0), minsPerGame / 90, minsPerGame >= 80 ? 'var(--verdict-hold)' : minsPerGame < 60 ? 'var(--verdict-sell)' : 'var(--verdict-monitor)', `${player.minutes} mins over ${gamesPlayed} gameweeks · ${player.starts} start${player.starts === 1 ? '' : 's'}`)}
                    ${renderDetailStat('FDR', (player.avgFDR || 3).toFixed(1), 1 - ((player.avgFDR || 3) - 1) / 4, (player.avgFDR || 3) <= 2.8 ? 'var(--verdict-hold)' : (player.avgFDR || 3) >= 3.5 ? 'var(--verdict-sell)' : 'var(--text-primary)', 'Next 5 weighted avg')}
                    ${player.position >= 3 ? renderDetailStat('xGI/90', xGIPer90.toFixed(2), xGIPer90, xGIPer90 >= 0.5 ? 'var(--verdict-hold)' : xGIPer90 < 0.25 ? 'var(--verdict-sell)' : 'var(--text-primary)', 'Expected goals + assists per 90') : ''}
                    ${returnStats}
                    ${renderDetailStat('Value', (player.ppm || 0).toFixed(1) + '/\u00a3m', Math.min((player.ppm || 0) / 30, 1), 'var(--color-info)', `Sell: \u00a3${(player.sellPrice || player.price).toFixed(1)}m`)}
                </div>
            </div>`;

            html += `<div class="detail-section" data-accent="season">
                <div class="detail-section-title">\ud83d\udcc8 Season Numbers <span style="font-weight:400;color:var(--text-muted);font-size:11px;">\u2014 ${statsScopeLabel}</span></div>
                <div class="pdm-metrics">
                    ${player.position >= 3 ? `
                        <div class="metric-box"><div class="metric-label">Goals</div><div class="metric-value neutral">${player.goals}</div></div>
                        <div class="metric-box"><div class="metric-label">Assists</div><div class="metric-value neutral">${player.assists}</div></div>
                    ` : `
                        <div class="metric-box"><div class="metric-label">CS</div><div class="metric-value neutral">${player.cleanSheets}</div></div>
                        <div class="metric-box"><div class="metric-label">${player.position === 1 ? 'Saves' : 'Goals'}</div><div class="metric-value neutral">${player.position === 1 ? player.saves : player.goals}</div></div>
                    `}
                    <div class="metric-box"><div class="metric-label">Bonus</div><div class="metric-value neutral">${player.bonus}</div></div>
                    <div class="metric-box"><div class="metric-label">ICT</div><div class="metric-value neutral">${player.ictIndex.toFixed(0)}</div></div>
                    <div class="metric-box"><div class="metric-label">Ownership</div><div class="metric-value neutral">${player.ownership.toFixed(1)}%</div></div>
                    <div class="metric-box"><div class="metric-label">Net Transfers</div><div class="metric-value ${(player.netTransfers||0) > 0 ? 'good' : (player.netTransfers||0) < -5000 ? 'bad' : 'neutral'}">${(player.netTransfers||0) > 0 ? '+' : ''}${((player.netTransfers||0) / 1000).toFixed(1)}k</div></div>
                    <div class="metric-box"><div class="metric-label">EP Next</div><div class="metric-value ${player.epNext >= 5 ? 'good' : 'neutral'}">${player.epNext.toFixed(1)}</div></div>
                </div>
            </div>`;

            html += renderRoutesToPoints(player);

            if (concerns.length > 0) {
                html += `<div class="detail-section" data-accent="concerns">
                    <div class="detail-section-title">${v2Icon('warn')} Concerns (${concerns.length})</div>
                    ${concerns.map(c => `<div class="insight-item ${c.type}">
                        ${c.title ? `<div style="font-size:13px;font-weight:600;margin-bottom:4px;">${escHTML(c.title)}</div>` : ''}
                        <div class="insight-text">${escHTML(c.text)}</div>
                    </div>`).join('')}
                </div>`;
            }

            if (positives.length > 0) {
                html += `<div class="detail-section" data-accent="positives">
                    <div class="detail-section-title">${v2Icon('check')} Positives (${positives.length})</div>
                    ${positives.map(p => `<div class="insight-item positive">
                        ${p.title ? `<div style="font-size:13px;font-weight:600;margin-bottom:4px;">${escHTML(p.title)}</div>` : ''}
                        <div class="insight-text">${escHTML(p.text)}</div>
                    </div>`).join('')}
                </div>`;
            }

            if (fixtures.length > 0) {
                html += `<div class="detail-section" data-accent="fixtures" data-wide>
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
                    html += `<div class="detail-section" data-accent="swap">
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
                        html += `<div class="detail-section" data-accent="swap">
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
                /* Lead with the football, keep the rating as the bar.

                   These four tiles used to read "68", "55", "62", "71" \u2014 a
                   0-100 score with the real quantity demoted to the caption
                   underneath. Nobody knows what a defence of 55 is. Everybody
                   knows what 1.4 conceded a game is, and what W3 D1 L1 is.
                   The ratings are still here doing the job they are good at,
                   which is filling the bar and colouring it: they are
                   comparable across clubs in a way that raw goals are not.

                   Windows differ and are labelled rather than blurred: form
                   comes off the last 5, goals and clean sheets off the last 10,
                   FDR off the next 5. */
                const teamCsPct = Math.round((detailTA.csRate || 0) * 100);
                const ratingBand = (v, good, bad) => v >= good ? 'var(--verdict-hold)'
                    : v < bad ? 'var(--verdict-sell)' : 'var(--verdict-monitor)';
                const last10 = Math.min(detailTA.matchesPlayed || 0, 10);
                const last5 = Math.min(detailTA.matchesPlayed || 0, 5);
                html += `<div class="pd-group"><div class="pd-group-title">\ud83c\udfe2 Team \u2014 ${escHTML(player.team)}</div>
                <div class="detail-section" data-accent="team" data-wide>
                    <div class="detail-section-title">\ud83d\udcc9 Club form and season</div>
                    <div class="detail-stats-grid">
                        ${renderDetailStat('Goals scored', detailTA.avgGoals.toFixed(1), detailTA.attackPower / 100,
                            ratingBand(detailTA.attackPower, 60, 40),
                            `per game over the last ${last10} \u00b7 attack rated ${detailTA.attackPower}/100`)}
                        ${renderDetailStat('Clean sheets', `${teamCsPct}%`, detailTA.defensePower / 100,
                            ratingBand(detailTA.defensePower, 60, 40),
                            `${detailTA.avgConceded.toFixed(1)} conceded/game over the last ${last10} \u00b7 defence rated ${detailTA.defensePower}/100`)}
                        ${renderDetailStat('Results', `W${detailTA.wins} D${detailTA.draws} L${detailTA.losses}`, detailTA.formRating / 100,
                            ratingBand(detailTA.formRating, 60, 35),
                            `last ${last5} matches \u00b7 form rated ${detailTA.formRating}/100`)}
                        ${renderDetailStat('Fixtures', detailTA.avgFdr.toFixed(1), detailTA.fixtureScore / 100,
                            ratingBand(detailTA.fixtureScore, 60, 35),
                            `average FDR over the next 5 \u00b7 1 is easiest, 5 hardest`)}
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
                        <div class="metric-box"><div class="metric-label">Away</div><div class="metric-value neutral" style="font-size:10px;">W${detailSS.awayW}/${detailSS.awayP} \u2022 ${detailSS.awayGF}GF ${detailSS.awayGA}GA \u2022 ${detailSS.awayCS}CS</div></div>
                    </div>
                    ` : ''}
                    ${swingHtml}
                </div>
                </div>`; // end pd-group Team
            }

            // ===== OPPONENTS =====
            const oppSection = renderOpponentSection(player, fixtures);
            if (oppSection) {
                html += `<div class="pd-group"><div class="pd-group-title">${v2Icon('swords')} Opponents</div>${oppSection}</div>`;
            }

            return html;
        }

        /* ===== PLAYER MODAL =====

           The squad row used to expand in place. Everything the profile has to
           say — the report, six stat cards, season numbers, routes to points,
           the price meter, concerns, positives, fixtures, the team and the
           opponents — unrolled between two rows of the table, so the row you
           clicked was pushed off the top of the screen by its own detail and
           the thing you were comparing it against was a scroll away. Every
           section was also full width and one-per-line, which is what made it
           read as a transcript rather than a profile.

           So: a modal, over a blurred page, laid out as a sheet of cards. The
           class names are the ones initOverlayDismiss() already watches, which
           is where click-away and Escape come from.

           The hero is the Premier League's own player card: the club's shirt
           colour behind a cut-out portrait, given name light above family name
           heavy, and the badge, squad number and position on one line beneath.
           It is the one part of the card that is meant to be looked at rather
           than read. */
        let pdmPlayerId = null;

        function pdmHost() {
            let host = document.getElementById('pdmHost');
            if (!host) {
                host = document.createElement('div');
                host.id = 'pdmHost';
                document.body.appendChild(host);
            }
            return host;
        }

        /* Given name light, family name heavy — the split the PL card makes.
           web_name is the one the game itself shows, so it is what the family
           name falls back to when the full name is a single word. */
        function pdmNameParts(player) {
            const full = String(player.fullName || player.name || '').trim();
            const bits = full.split(/\s+/);
            if (bits.length < 2) return { first: '', last: full };
            return { first: bits.slice(0, -1).join(' '), last: bits[bits.length - 1] };
        }

        function pdmHeroHTML(player, analysis) {
            const { shirt, ink } = typeof clubColours === 'function'
                ? clubColours(player) : { shirt: '#37003C', ink: '#FFFFFF' };
            const { first, last } = pdmNameParts(player);
            const pos = POSITION_CONFIG[player.position] || POSITION_CONFIG[3];
            const code = typeof v2TeamCode === 'function'
                ? v2TeamCode(player.teamId, player.teamCode) : null;
            const shirtNo = player.squadNumber != null ? player.squadNumber : null;
            /* player.team is the three-letter short name, which is what a table
               column wants and not what a card does. The full one is on the
               teams map when the page has it. */
            let clubName = player.team;
            try {
                if (typeof teams !== 'undefined' && teams && teams[player.teamId] && teams[player.teamId].name) {
                    clubName = teams[player.teamId].name;
                }
            } catch (e) { /* no teams map here */ }
            const verdict = analysis && analysis.verdict;
            const chip = { star: 'STAR', hold: 'HOLD', monitor: 'WATCH', sell: 'SELL' }[verdict] || '';

            return `<div class="pdm-hero" style="--club:${shirt};--club-ink:${ink};">
                <div class="pdm-hero-shape" aria-hidden="true"></div>
                <div class="pdm-hero-photo">
                    ${typeof playerPhotoLargeHTML === 'function' ? playerPhotoLargeHTML(player.code, 'pdm-hero-face') : ''}
                </div>
                <div class="pdm-hero-text">
                    ${first ? `<span class="pdm-hero-first">${escHTML(first)}</span>` : ''}
                    <span class="pdm-hero-last">${escHTML(last)}</span>
                    <span class="pdm-hero-meta">
                        ${code != null ? `<img class="pdm-hero-crest" src="https://resources.premierleague.com/premierleague/badges/50/t${code}.png" alt="" draggable="false" onerror="this.remove()">` : ''}
                        <span>${escHTML(clubName)}</span>
                        <em>•</em>
                        ${shirtNo != null ? `<span>${shirtNo}</span>` : ''}
                        <span>${pos.name}</span>
                    </span>
                </div>
                <div class="pdm-hero-side">
                    ${chip ? `<span class="pdm-hero-chip v-${verdict}">${chip}</span>` : ''}
                    <span class="pdm-hero-price">£${player.price.toFixed(1)}m</span>
                    <span class="pdm-hero-own">${player.ownership.toFixed(1)}% owned</span>
                </div>
            </div>`;
        }

        function renderPlayerModal() {
            const host = pdmHost();
            const found = pdmPlayerId != null ? pdmLookup(pdmPlayerId) : null;
            if (!found) { host.innerHTML = ''; return; }
            const analysis = found.analysis;
            const player = analysis.player;

            /* A player you do not own has no Recommendation and no Best
               Replacement: both are squad decisions, and "transfer out before
               GW6" is not advice about someone else's midfielder. */
            const owned = found.context === 'squad';
            const extra = typeof pdmPageSections === 'function' ? (pdmPageSections(player) || '') : '';

            host.innerHTML = `<div class="modal-overlay v2-modal pdm-modal open" id="pdmModal">
                <div class="modal-container" role="dialog" aria-modal="true" aria-label="${escHTML(player.name)} profile">
                    ${pdmHeroHTML(player, analysis)}
                    <button class="modal-close pdm-close" onclick="closePlayerModal()" aria-label="Close">&times;</button>
                    <div class="pdm-body">
                        ${buildPlayerFullProfileHTML(player, analysis, {
                            header: false,
                            context: found.context,
                            recommendation: owned,
                            replacements: owned && typeof findReplacements === 'function'
                        })}
                        ${extra}
                    </div>
                </div>
            </div>`;
            pdmLayoutBands(host);
            if (typeof lucide !== 'undefined') lucide.createIcons();
            // Anything a page has to mount rather than render — the players
            // page's Chart.js trends need the canvases to be in the document.
            if (typeof pdmAfterRender === 'function') pdmAfterRender(player);
        }

        /* ===== The masonry band =====

           The three readings were grid items with explicit columns, which meant
           the positives — placed in the third column — started on the grid's
           next row, and that row's height was set by the tallest thing on it.
           So a short list of positives sat beside a column and a half of white
           space. CSS grid cannot pack that way (masonry rows are not shipped
           broadly enough to rely on), so the band is three real columns and each
           one is a stack: the blocks in it sit directly under one another.

           Which section goes in which column is fixed rather than measured. The
           two stat cards are the tall ones and take a column each; everything
           that reads as commentary — the routes, the positives, the concerns —
           stacks in the third. */
        const PDM_BANDS = [['stats'], ['season'], ['routes', 'concerns', 'positives']];

        function pdmLayoutBands(host) {
            const body = host.querySelector('.pdm-body');
            if (!body) return;
            const pick = a => body.querySelector(`.detail-section[data-accent="${a}"]`);
            const anchorEl = pick('stats') || pick('season') || pick('routes');
            if (!anchorEl || !anchorEl.parentNode) return;

            const wrap = document.createElement('div');
            wrap.className = 'pdm-bands';
            anchorEl.parentNode.insertBefore(wrap, anchorEl);

            PDM_BANDS.forEach(keys => {
                const col = document.createElement('div');
                col.className = 'pdm-col';
                keys.forEach(k => { const el = pick(k); if (el) col.appendChild(el); });
                if (col.children.length) wrap.appendChild(col);
            });
        }

        /* `position` is accepted and ignored. The players page's tables pass the
           position string they already know; it is faster to keep the call sites
           as they are than to make every one of them agree that the id is
           enough. */
        function openPlayerModal(playerId, position) {
            void position;
            pdmPlayerId = playerId;
            renderPlayerModal();
            document.body.classList.add('v2-blurred');
        }

        function closePlayerModal() {
            // Before the id is cleared, so a page tearing down a chart can still
            // see which player it belonged to.
            if (typeof pdmOnClose === 'function') pdmOnClose(pdmPlayerId);
            pdmPlayerId = null;
            const modal = document.getElementById('pdmModal');
            if (modal) modal.classList.remove('open');
            document.body.classList.remove('v2-blurred');
            /* Emptied only after the fade, so the close animates rather than
               the card vanishing mid-transition. */
            setTimeout(() => { if (pdmPlayerId == null) pdmHost().innerHTML = ''; }, 260);
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
