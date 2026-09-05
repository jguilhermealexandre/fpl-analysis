/* ============================================
   EasyFPL — Matchday

   Two things the dashboard could not say: which gameweek we are actually in,
   and what is happening in it right now.

   THE GAMEWEEK QUESTION. Every page derived the gameweek from the `is_current`
   flag in bootstrap-static.json, which is wrong twice over. It is wrong by
   meaning: between one gameweek finishing and the next deadline, `is_current`
   still names the gameweek that has already been played, so the badge read GW2
   for four days while every manager on the site was picking a GW3 team. And it
   is wrong by latency: that file is rewritten every fifteen minutes and cached
   for five more, so at the moment a deadline passes the flag can be twenty
   minutes behind the fact.

   mdGameweekState() derives it from the clock and the fixture list instead. The
   deadline is a timestamp, so "has it locked" is answerable to the second,
   without asking anyone. Which gameweek the page is about follows from that:

     before its deadline        -> the gameweek you are picking      (upcoming)
     after it, nothing kicked off yet -> the gameweek you have locked in (locked)
     matches under way          -> the gameweek being played         (live)
     all its matches finished   -> the next one you are picking       (upcoming)

   So the number changes at the deadline, and again when the last whistle of the
   round goes, and both happen without a reload.

   THE LIVE QUESTION. fixtures.json carries kick-off, scores and minutes;
   event-live.json carries every player's points for the round, both rewritten
   every fifteen minutes during match windows. That is enough to render the
   round unaided. When the live endpoint is reachable through the proxy the
   panel takes its per-player numbers instead, which are current to the second,
   and folds in projected bonus from scripts/live-gw.js — during a match the
   game publishes `bps` continuously but leaves `bonus` at zero, so a score read
   straight off total_points is short by up to three points a player.

   Prefix md*. Classic script; no DOM work happens until a render is asked for.

   DEPENDENCIES: escHTML (scripts/common.js). liveBonusForFixture and friends
   (scripts/live-gw.js) are used only if present.
   ============================================ */

        /* event-live.json abbreviates its keys to keep a file that is rewritten
           every fifteen minutes small. Same mapping as the gameweek review's,
           deliberately not shared: that file is not loaded on the dashboard, and
           importing it for one constant would drag a page's worth of squad code
           with it. */
        const MD_LIVE_KEYS = {
            pts: 'points', min: 'minutes', st: 'starts', g: 'goals', a: 'assists',
            b: 'bonus', cs: 'cleanSheets', gc: 'goalsConceded', sv: 'saves',
            ps: 'pensSaved', pm: 'pensMissed', og: 'ownGoals', yc: 'yellow',
            rc: 'red', bps: 'bps', dc: 'defCon'
        };

        let mdCtx = null;         // { events, fixtures, teams, squad, gw }
        let mdLiveById = null;    // per-player live stats, live endpoint or event-live.json
        let mdProjBonus = null;   // per-player projected bonus, pending fixtures only
        let mdTimer = null;
        let mdPollTimer = null;
        let mdLastPhase = null;

        /* ===== Gameweek state ===== */

        function mdEventsByDeadline(events) {
            return (events || [])
                .filter(e => e && e.deadline_time && e.id != null)
                .slice()
                .sort((a, b) => Date.parse(a.deadline_time) - Date.parse(b.deadline_time));
        }

        /* Which gameweek the page is about, and what is happening in it.

           Pure: the clock is a parameter so this can be tested at any point in a
           season without waiting for one. */
        function mdGameweekState(events, fixtures, now) {
            const t = now instanceof Date ? now.getTime() : (now != null ? now : Date.now());
            const evs = mdEventsByDeadline(events);
            const empty = {
                phase: 'unknown', gw: null, currentGW: null, nextGW: null,
                deadline: null, locked: false,
                fixtures: { total: 0, finished: 0, live: 0, upcoming: 0 }
            };
            if (!evs.length) return empty;

            const locked = evs.filter(e => Date.parse(e.deadline_time) <= t);
            const current = locked.length ? locked[locked.length - 1] : null;
            const next = evs.find(e => Date.parse(e.deadline_time) > t) || null;

            const fx = current ? (fixtures || []).filter(f => f.event === current.id) : [];
            // finished_provisional flips at full time; `finished` waits for the
            // game to confirm bonus, which can be a day later. A round whose last
            // match ended an hour ago is over, whatever the slower flag says.
            const finished = fx.filter(f => f.finished_provisional).length;
            const live = fx.filter(f => f.started && !f.finished_provisional).length;
            const upcoming = fx.length - finished - live;
            const counts = { total: fx.length, finished, live, upcoming };

            // Before the season's first deadline there is nothing behind us.
            if (!current) {
                return { phase: 'preseason', gw: next ? next.id : null, currentGW: null,
                    nextGW: next ? next.id : null,
                    deadline: next ? next.deadline_time : null, locked: false, fixtures: counts };
            }

            const roundDone = fx.length === 0 || finished === fx.length;
            if (!roundDone) {
                return {
                    phase: live > 0 ? 'live' : 'locked',
                    gw: current.id, currentGW: current.id,
                    nextGW: next ? next.id : null,
                    deadline: next ? next.deadline_time : null,
                    locked: true, fixtures: counts,
                    // The next thing to actually happen in this round.
                    nextKickoff: mdNextKickoff(fx, t)
                };
            }

            // The round is done. The gameweek the page is about is the next one.
            if (!next) {
                return { phase: 'season-over', gw: current.id, currentGW: current.id,
                    nextGW: null, deadline: null, locked: true, fixtures: counts };
            }
            return { phase: 'upcoming', gw: next.id, currentGW: current.id, nextGW: next.id,
                deadline: next.deadline_time, locked: false, fixtures: counts };
        }

        function mdNextKickoff(fx, t) {
            const future = (fx || [])
                .filter(f => !f.started && f.kickoff_time && Date.parse(f.kickoff_time) > t)
                .sort((a, b) => Date.parse(a.kickoff_time) - Date.parse(b.kickoff_time));
            return future.length ? future[0].kickoff_time : null;
        }

        // "2d 4h", "3h 12m", "8m 40s" — coarse far out, precise when it matters.
        function mdCountdown(iso, now) {
            if (!iso) return '';
            const diff = Date.parse(iso) - (now != null ? now : Date.now());
            if (!(diff > 0)) return '';
            const d = Math.floor(diff / 86400000);
            const h = Math.floor((diff % 86400000) / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            const s = Math.floor((diff % 60000) / 1000);
            if (d > 0) return `${d}d ${h}h`;
            if (h > 0) return `${h}h ${m}m`;
            return `${m}m ${s}s`;
        }

        /* ===== Live player stats ===== */

        // Normalise whichever source is available into one shape.
        function mdExpandLiveRow(row) {
            if (!row) return null;
            const out = {};
            // The live endpoint returns full names; event-live.json abbreviates.
            if (row.total_points !== undefined || row.minutes !== undefined) {
                out.points = row.total_points || 0; out.minutes = row.minutes || 0;
                out.goals = row.goals_scored || 0; out.assists = row.assists || 0;
                out.bonus = row.bonus || 0; out.cleanSheets = row.clean_sheets || 0;
                out.goalsConceded = row.goals_conceded || 0; out.saves = row.saves || 0;
                out.yellow = row.yellow_cards || 0; out.red = row.red_cards || 0;
                out.ownGoals = row.own_goals || 0; out.pensSaved = row.penalties_saved || 0;
                out.pensMissed = row.penalties_missed || 0; out.bps = row.bps || 0;
                out.defCon = row.defensive_contribution || 0;
                out.starts = row.starts || 0;
                return out;
            }
            Object.keys(MD_LIVE_KEYS).forEach(k => { out[MD_LIVE_KEYS[k]] = row[k] || 0; });
            return out;
        }

        function mdSetLive(opts) {
            const o = opts || {};
            if (o.byId) {
                mdLiveById = {};
                Object.keys(o.byId).forEach(id => { mdLiveById[id] = mdExpandLiveRow(o.byId[id]); });
            } else if (o.eventLive && o.eventLive.elements) {
                mdLiveById = {};
                const els = o.eventLive.elements;
                Object.keys(els).forEach(id => { mdLiveById[id] = mdExpandLiveRow(els[id]); });
            }
            if (o.projBonus) mdProjBonus = o.projBonus;
        }

        function mdPlayerLive(playerId) {
            if (!mdLiveById) return null;
            return mdLiveById[playerId] || mdLiveById[String(playerId)] || null;
        }

        /* ===== Rendering ===== */

        function mdKickoffLabel(iso) {
            if (!iso) return '';
            const d = new Date(iso);
            if (isNaN(d)) return '';
            return d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
        }

        function mdFixtureStatus(f, now) {
            const t = now != null ? now : Date.now();
            if (f.finished_provisional) return { kind: 'ft', label: f.finished ? 'FT' : 'FT*' };
            if (f.started) return { kind: 'live', label: (f.minutes != null ? f.minutes + "'" : 'LIVE') };
            const diff = f.kickoff_time ? Date.parse(f.kickoff_time) - t : null;
            if (diff != null && diff > 0 && diff < 3600000) {
                return { kind: 'soon', label: 'in ' + mdCountdown(f.kickoff_time, t) };
            }
            return { kind: 'upcoming', label: mdKickoffLabel(f.kickoff_time) };
        }

        /* One of my players inside a match.

           The icons are the things that changed the score; the number is what
           the player is on. Projected bonus is shown separately and in a lighter
           weight, because it is the one part of the figure the game has not yet
           committed to. */
        function mdPlayerChip(p, live, isLive) {
            const pts = live ? live.points : null;
            const proj = mdProjBonus ? (mdProjBonus[p.id] || mdProjBonus[String(p.id)] || 0) : 0;
            const bits = [];
            if (live) {
                for (let i = 0; i < (live.goals || 0); i++) bits.push('<i class="md-ev goal" title="Goal">⚽</i>');
                for (let i = 0; i < (live.assists || 0); i++) bits.push('<i class="md-ev assist" title="Assist">🅰</i>');
                if (live.cleanSheets) bits.push('<i class="md-ev cs" title="Clean sheet">🧤</i>');
                if (live.pensSaved) bits.push('<i class="md-ev cs" title="Penalty saved">🧤+</i>');
                if (live.red) bits.push('<i class="md-ev red" title="Red card">🟥</i>');
                else if (live.yellow) bits.push('<i class="md-ev yellow" title="Yellow card">🟨</i>');
                if (live.ownGoals) bits.push('<i class="md-ev red" title="Own goal">OG</i>');
            }
            const mult = p.multiplier != null ? p.multiplier : (p.isCaptain ? 2 : 1);
            const armband = p.isCaptain ? '<span class="md-arm c" title="Captain — points doubled">C</span>'
                : p.isViceCaptain ? '<span class="md-arm v" title="Vice-captain">V</span>' : '';
            const benched = p.pickPosition > 11;

            let tip;
            if (!live) tip = `${p.name} — yet to play`;
            else {
                const parts = [`${live.points} points`, `${live.minutes}'`];
                if (live.goals) parts.push(`${live.goals} goal${live.goals > 1 ? 's' : ''}`);
                if (live.assists) parts.push(`${live.assists} assist${live.assists > 1 ? 's' : ''}`);
                if (live.bonus) parts.push(`${live.bonus} bonus`);
                else if (proj) parts.push(`${proj} bonus projected from the BPS table`);
                if (live.bps) parts.push(`${live.bps} BPS`);
                tip = `${p.name} — ${parts.join(', ')}`;
                if (mult > 1) tip += `. Counts ${mult}x.`;
                if (benched) tip += ' On your bench.';
            }

            const shown = pts != null ? pts * (benched ? 1 : mult) : null;
            return `<span class="md-chip${benched ? ' bench' : ''}${isLive && live && live.minutes ? ' on' : ''}"
                data-tooltip="${escHTML(tip)}">
                <span class="md-chip-name">${escHTML(p.name)}</span>${armband}
                ${shown != null ? `<b class="md-chip-pts">${shown}</b>` : '<b class="md-chip-pts pending">–</b>'}
                ${proj && !live?.bonus ? `<em class="md-chip-proj" title="Projected bonus">+${proj}</em>` : ''}
                ${bits.join('')}
            </span>`;
        }

        /* The panel heading's icon. Inline because the panel re-renders on a
           ticker and a lucide placeholder would need createIcons() run again
           on every pass. */
        const MD_BALL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<circle cx="12" cy="12" r="10"/><path d="m12 7 4.2 3.1-1.6 5H9.4l-1.6-5z"/>' +
            '<path d="M12 2v5"/><path d="m2.6 9.4 5.2.6"/><path d="m21.4 9.4-5.2.6"/>' +
            '<path d="m6.8 20.4 2.6-5.3"/><path d="m17.2 20.4-2.6-5.3"/></svg>';

        /* Team crest. The squad and fixture views already load these, so the
           badge is warm in the browser cache by the time a match card renders.
           alt is empty on purpose: the short name sits beside it, and a screen
           reader announcing "Hull City crest, HUL" reads the team twice. */
        function mdCrest(team) {
            if (!team || team.code == null) return '';
            return `<img class="md-crest" width="22" height="22" loading="lazy" alt=""
                src="https://resources.premierleague.com/premierleague/badges/50/t${team.code}.png">`;
        }

        function mdMatchCard(f, now) {
            const teams = mdCtx.teams || {};
            const st = mdFixtureStatus(f, now);
            const home = teams[f.team_h] || {}, away = teams[f.team_a] || {};
            const mine = (mdCtx.squad || []).filter(p => p.teamId === f.team_h || p.teamId === f.team_a);
            const isLive = st.kind === 'live';
            const scored = f.team_h_score != null && f.team_a_score != null;

            const chips = mine.length
                ? mine
                    .sort((a, b) => (a.pickPosition || 99) - (b.pickPosition || 99))
                    .map(p => mdPlayerChip(p, mdPlayerLive(p.id), isLive)).join('')
                : '<span class="md-none">No players of yours</span>';

            const mineTotal = mine.reduce((s, p) => {
                const l = mdPlayerLive(p.id);
                if (!l) return s;
                const mult = p.pickPosition > 11 ? 1 : (p.multiplier != null ? p.multiplier : 1);
                return s + (l.points || 0) * mult;
            }, 0);

            return `<div class="md-match${isLive ? ' is-live' : ''}${st.kind === 'ft' ? ' is-done' : ''}${mine.length ? '' : ' is-dim'}">
                <div class="md-match-head">
                    <span class="md-status ${st.kind}">${isLive ? '<i class="md-dot"></i>' : ''}${escHTML(st.label)}</span>
                    ${mine.length && mdLiveById ? `<span class="md-mine-total" data-tooltip="Points your players in this match have scored so far, with the armband counted.">${mineTotal}<em>pts</em></span>` : ''}
                </div>
                <div class="md-score">
                    <span class="md-team h">${mdCrest(home)}<b>${escHTML(home.short_name || '?')}</b></span>
                    ${scored
                        ? `<span class="md-goals">${f.team_h_score}<i>–</i>${f.team_a_score}</span>`
                        : '<span class="md-goals pre">v</span>'}
                    <span class="md-team a"><b>${escHTML(away.short_name || '?')}</b>${mdCrest(away)}</span>
                </div>
                <div class="md-players">${chips}</div>
            </div>`;
        }

        function mdRenderPanel(now) {
            if (!mdCtx) return '';
            const t = now != null ? now : Date.now();
            const state = mdGameweekState(mdCtx.events, mdCtx.fixtures, t);
            const gw = state.currentGW != null && state.phase !== 'upcoming' && state.phase !== 'preseason'
                ? state.currentGW : state.gw;
            const fx = (mdCtx.fixtures || []).filter(f => f.event === gw);
            if (!fx.length) return '';

            const key = f => Date.parse(f.kickoff_time || 0) || 0;
            const live = fx.filter(f => f.started && !f.finished_provisional).sort((a, b) => key(a) - key(b));
            const soon = fx.filter(f => !f.started).sort((a, b) => key(a) - key(b));
            const done = fx.filter(f => f.finished_provisional).sort((a, b) => key(a) - key(b));

            const group = (label, list, cls) => list.length
                ? `<div class="md-group ${cls}"><div class="md-group-l">${escHTML(label)}</div>
                   <div class="md-grid">${list.map(f => mdMatchCard(f, t)).join('')}</div></div>`
                : '';

            const total = (mdCtx.squad || []).reduce((s, p) => {
                const l = mdPlayerLive(p.id);
                if (!l || p.pickPosition > 11) return s;
                return s + (l.points || 0) * (p.multiplier != null ? p.multiplier : 1);
            }, 0);

            const head = state.phase === 'live'
                ? `<span class="md-h-live"><i class="md-dot"></i>${state.fixtures.live} live now</span>`
                : state.phase === 'locked'
                    ? `<span class="md-h-note">Locked${state.nextKickoff ? ` · first kick-off ${escHTML(mdKickoffLabel(state.nextKickoff))}` : ''}</span>`
                    : state.phase === 'upcoming' && state.currentGW === gw
                        ? '<span class="md-h-note">All matches finished</span>'
                        : `<span class="md-h-note">${state.fixtures.total} matches</span>`;

            return `<div class="md-panel">
                <div class="md-head">
                    <span class="md-title">${MD_BALL_ICON}Gameweek ${gw}</span>
                    ${head}
                    ${mdLiveById ? `<span class="md-total" data-tooltip="Your starting eleven's points so far this gameweek, armband included. Bench excluded unless Bench Boost is active.">${total}<em>pts</em></span>` : ''}
                </div>
                ${group('Live', live, 'live')}
                ${group('To play', soon, 'soon')}
                ${group('Finished', done, 'done')}
            </div>`;
        }

        /* ===== The gameweek badge ===== */

        function mdBadgeHTML(state, now) {
            const cd = mdCountdown(state.deadline, now);
            if (state.phase === 'live') {
                return `GW${state.gw}<span class="md-badge-live"><i class="md-dot"></i>LIVE</span>`;
            }
            if (state.phase === 'locked') return `GW${state.gw}<span class="md-badge-sub">locked</span>`;
            if (state.phase === 'season-over') return `GW${state.gw}<span class="md-badge-sub">final</span>`;
            if (state.gw == null) return 'GW–';
            return `GW${state.gw}${cd ? `<span class="md-badge-sub">${escHTML(cd)}</span>` : ''}`;
        }

        function mdUpdateBadge() {
            const el = document.getElementById('heroGwBadge');
            if (!el || !mdCtx) return null;
            const state = mdGameweekState(mdCtx.events, mdCtx.fixtures, Date.now());
            el.innerHTML = mdBadgeHTML(state, Date.now());
            el.className = 'hero-greeting-gw' + (state.phase === 'live' ? ' is-live' : '');
            return state;
        }

        function mdRenderInto(id) {
            const el = document.getElementById(id || 'v2Matchday');
            if (!el || !mdCtx) return;
            const html = mdRenderPanel();
            el.innerHTML = html;
            el.style.display = html ? '' : 'none';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        /* Keeps the badge honest without a reload.

           The deadline flip is pure arithmetic on the clock, so a one-second tick
           handles it. The live/finished flip needs fresh fixtures, so while a
           round is under way the committed feeds are re-read every ninety
           seconds — they are rewritten every fifteen minutes during match
           windows, so this is the cheapest way to stay within a minute of them.
           Paused while the tab is hidden: nobody is reading it, and a background
           tab polling all evening is rude. */
        function mdStartTicker() {
            if (mdTimer) clearInterval(mdTimer);
            const tick = () => {
                const state = mdUpdateBadge();
                if (!state) return;
                if (state.phase !== mdLastPhase) {
                    mdLastPhase = state.phase;
                    mdRenderInto();
                }
            };
            tick();
            mdTimer = setInterval(tick, 1000);

            if (mdPollTimer) clearInterval(mdPollTimer);
            mdPollTimer = setInterval(() => {
                if (typeof document !== 'undefined' && document.hidden) return;
                const state = mdGameweekState(mdCtx.events, mdCtx.fixtures, Date.now());
                if (state.phase !== 'live' && state.phase !== 'locked') return;
                mdRefreshLive();
            }, 90000);
        }

        // Re-read the committed feeds and repaint. Failures are silent by
        // design: the panel keeps showing the last good state rather than
        // blanking because one poll timed out.
        function mdRefreshLive() {
            const bust = Math.floor(Date.now() / 60000);
            Promise.all([
                fetch(`data/fixtures.json?v=${bust}`).then(r => r.ok ? r.json() : null).catch(() => null),
                fetch(`data/event-live.json?v=${bust}`).then(r => r.ok ? r.json() : null).catch(() => null)
            ]).then(([fixtures, eventLive]) => {
                if (Array.isArray(fixtures) && fixtures.length) mdCtx.fixtures = fixtures;
                if (eventLive && eventLive.elements) mdSetLive({ eventLive });
                mdUpdateBadge();
                mdRenderInto();
            }).catch(() => {});
        }

        function mdInit(ctx) {
            if (!ctx || !ctx.events) return;
            mdCtx = {
                events: ctx.events,
                fixtures: ctx.fixtures || [],
                teams: ctx.teams || {},
                squad: ctx.squad || []
            };
            if (ctx.eventLive || ctx.byId) {
                mdSetLive({ eventLive: ctx.eventLive, byId: ctx.byId, projBonus: ctx.projBonus });
            }
            mdLastPhase = null;
            mdUpdateBadge();
            mdRenderInto();
            mdStartTicker();
        }
