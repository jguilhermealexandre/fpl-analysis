/* ============================================
   EasyFPL — The Scout's Desk
   Article feed, reader, and the generators behind them.

   Every article on this page is generated from the same FPL dataset the rest
   of the site runs on — bootstrap-static, fixtures, and per-gameweek player
   history. Nothing here is written by hand and nothing is invented: the prose
   is a template, the names and numbers in it are read from the data at render
   time. That matters because these read as journalism about real players, and
   a made-up expected-goals figure attached to a real footballer is a false
   claim however it is framed.

   Where the season is too young to support a claim, the generator says so
   rather than reaching for it.
   ============================================ */

let sdArticles = [];
let sdArchived = false;
let sdBoot = null, sdFixtures = null, sdHistory = null;

// ---------- small helpers ----------
const sdNum = v => (parseFloat(v) || 0);
const sdRound = (v, n = 2) => Math.round(v * Math.pow(10, n)) / Math.pow(10, n);

function sdTeamName(id) {
    const t = (sdBoot?.teams || []).find(x => x.id === id);
    return t ? t.short_name : '???';
}

function sdPlayers() {
    return (sdBoot?.elements || []).map(e => ({
        id: e.id,
        name: e.web_name,
        team: sdTeamName(e.team),
        teamId: e.team,
        pos: ['', 'GK', 'DEF', 'MID', 'FWD'][e.element_type],
        position: e.element_type,
        price: e.now_cost / 10,
        points: e.total_points,
        minutes: e.minutes,
        goals: e.goals_scored,
        assists: e.assists,
        bonus: e.bonus,
        xG: sdNum(e.expected_goals),
        xA: sdNum(e.expected_assists),
        xGI: sdNum(e.expected_goal_involvements),
        xGC: sdNum(e.expected_goals_conceded),
        cs: e.clean_sheets,
        own: sdNum(e.selected_by_percent),
        form: sdNum(e.form),
        ppg: sdNum(e.points_per_game),
        status: e.status,
        news: e.news,
        costChange: e.cost_change_event / 10,
        tIn: e.transfers_in_event,
        tOut: e.transfers_out_event,
        starts: e.starts
    }));
}

// How many gameweeks are actually in the books. Every claim on this page is
// scaled to this — one round of football does not support a rate.
function sdRoundsPlayed() {
    const rounds = new Set();
    (sdHistory?.players || []).forEach(p => (p.history || []).forEach(h => {
        if ((h.minutes || 0) > 0) rounds.add(h.round);
    }));
    return rounds.size;
}

function sdLastRound() {
    let last = 0;
    (sdHistory?.players || []).forEach(p => (p.history || []).forEach(h => {
        if (h.round > last) last = h.round;
    }));
    return last;
}

// Per-gameweek rows for one round, joined to the player record.
function sdRoundRows(round) {
    const byId = {};
    sdPlayers().forEach(p => { byId[p.id] = p; });
    const rows = [];
    (sdHistory?.players || []).forEach(p => {
        (p.history || []).forEach(h => {
            if (h.round !== round) return;
            const base = byId[p.id];
            if (!base) return;
            rows.push({
                ...base,
                gwPoints: h.total_points,
                gwMinutes: h.minutes,
                gwGoals: h.goals_scored,
                gwAssists: h.assists,
                gwBonus: h.bonus,
                gwXG: sdNum(h.expected_goals),
                gwXA: sdNum(h.expected_assists),
                gwXGI: sdNum(h.expected_goal_involvements),
                gwCS: h.clean_sheets,
                gwOpponent: sdTeamName(h.opponent_team),
                gwHome: h.was_home,
                gwBps: h.bps
            });
        });
    });
    return rows;
}

function sdReadTime(markdown) {
    const words = markdown.split(/\s+/).length;
    return Math.max(1, Math.round(words / 200));
}

function sdTable(headers, rows) {
    return '| ' + headers.join(' | ') + ' |\n|' + headers.map(() => '---').join('|') + '|\n'
        + rows.map(r => '| ' + r.join(' | ') + ' |').join('\n') + '\n';
}

// ---------- generators ----------

function sdGenGameweekDebrief() {
    const gw = sdLastRound();
    const rows = sdRoundRows(gw);
    if (!rows.length) return null;

    const byPoints = [...rows].sort((a, b) => b.gwPoints - a.gwPoints);
    const top = byPoints.slice(0, 5);
    const hero = top[0];

    // Who beat their expected goals and who was let down by finishing. Over a
    // single round this describes that round — it is not a claim about a player's
    // underlying quality, and the copy says so.
    const finishers = rows.filter(r => r.gwMinutes >= 45 && r.gwXG >= 0.3)
        .map(r => ({ ...r, diff: r.gwGoals - r.gwXG }))
        .sort((a, b) => b.diff - a.diff);
    const overperformer = finishers[0];
    const unlucky = [...finishers].reverse()[0];

    const bigOwn = [...rows].filter(r => r.own >= 15).sort((a, b) => a.gwPoints - b.gwPoints);
    const blanked = bigOwn.filter(r => r.gwPoints <= 2).slice(0, 3);

    const heroLine = hero.gwGoals > 0 || hero.gwAssists > 0
        ? `${hero.gwGoals} goal${hero.gwGoals === 1 ? '' : 's'}${hero.gwAssists ? ` and ${hero.gwAssists} assist${hero.gwAssists === 1 ? '' : 's'}` : ''}`
        : `${hero.gwPoints} points without a goal or assist`;

    let md = `## The headline\n\n`;
    md += `**${hero.name}** was the story of Gameweek ${gw}: ${hero.gwPoints} points from ${heroLine} `;
    md += `${hero.gwHome ? 'at home to' : 'away at'} ${hero.gwOpponent}, in ${hero.gwMinutes} minutes. `;
    md += `He was owned by ${hero.own}% of managers going into the round.\n\n`;

    if (blanked.length) {
        md += `> The other side of the same weekend: ${blanked.map(b => `**${b.name}** (${b.own}% owned) returned ${b.gwPoints}`).join(', ')}. `;
        md += `Points you do not score are as expensive as points you do.\n\n`;
    }

    md += `## The top scorers\n\n`;
    md += sdTable(['Player', 'Team', 'Pos', 'Pts', 'Mins', 'G', 'A', 'xGI', 'Owned'],
        top.map(p => [p.name, p.team, p.pos, `**${p.gwPoints}**`, p.gwMinutes, p.gwGoals, p.gwAssists, sdRound(p.gwXGI), `${p.own}%`]));

    md += `\n## Data against reality\n\n`;
    if (overperformer && overperformer.diff > 0.2) {
        md += `**${overperformer.name}** scored ${overperformer.gwGoals} from ${sdRound(overperformer.gwXG)} expected goals — `;
        md += `${sdRound(overperformer.diff)} more than the chances warranted. `;
    }
    if (unlucky && unlucky.diff < -0.3) {
        md += `At the other end, **${unlucky.name}** generated ${sdRound(unlucky.gwXG)} expected goals and scored ${unlucky.gwGoals}. `;
        md += `That is the kind of return that tends to arrive late rather than never.\n\n`;
    } else {
        md += `\n\n`;
    }
    md += `> One round is one round. These are descriptions of what happened in Gameweek ${gw}, not verdicts on anybody's finishing. `;
    md += `Ask again after five.\n\n`;

    // Transfer blueprint, drawn from ownership against underlying numbers.
    const buys = rows.filter(r => r.own < 12 && r.gwMinutes >= 60 && r.gwXGI >= 0.35)
        .sort((a, b) => b.gwXGI - a.gwXGI).slice(0, 2);
    const hold = rows.filter(r => r.own >= 20 && r.gwPoints <= 3 && r.gwXGI >= 0.25)
        .sort((a, b) => b.gwXGI - a.gwXGI)[0];
    const sell = rows.filter(r => r.own >= 10 && r.gwMinutes < 45)
        .sort((a, b) => a.gwMinutes - b.gwMinutes)[0];

    md += `## The transfer blueprint\n\n`;
    if (buys.length) {
        buys.forEach(b => {
            md += `**Buy — ${b.name}** (${b.team}, £${b.price.toFixed(1)}m, ${b.own}% owned). `;
            md += `${sdRound(b.gwXGI)} expected goal involvements in ${b.gwMinutes} minutes and still under-owned.\n\n`;
        });
    } else {
        md += `**Buy —** nothing in this round separated itself enough on the underlying numbers to be worth a transfer on its own. Sometimes the right move is none.\n\n`;
    }
    if (hold) {
        md += `**Hold — ${hold.name}** (${hold.own}% owned). ${hold.gwPoints} points reads badly, but ${sdRound(hold.gwXGI)} expected involvements says the process was fine. Selling here is selling the scoreline, not the player.\n\n`;
    }
    if (sell) {
        md += `**Sell — ${sell.name}** (${sell.own}% owned). ${sell.gwMinutes} minutes. `;
        md += sell.status !== 'a' && sell.news ? `${sell.news}\n\n` : `Minutes are the one thing no model can work around.\n\n`;
    }

    const captainPool = rows.filter(r => r.own >= 15).sort((a, b) => b.gwPoints - a.gwPoints);
    if (captainPool.length >= 2) {
        md += `## The captaincy post-mortem\n\n`;
        md += `Of the widely-owned options, **${captainPool[0].name}** returned ${captainPool[0].gwPoints} and `;
        md += `**${captainPool[captainPool.length - 1].name}** returned ${captainPool[captainPool.length - 1].gwPoints}. `;
        md += `The armband was worth ${captainPool[0].gwPoints - captainPool[captainPool.length - 1].gwPoints} points of swing between the two most obvious picks alone.\n`;
    }

    return {
        id: 'gw-debrief',
        title: `Gameweek Debrief: The Winners, Losers, and Underlying Stats`,
        category: 'Gameweek Debrief',
        icon: '📰',
        dek: `${hero.name} led Gameweek ${gw} with ${hero.gwPoints} points. Underneath the scoreline, the expected-goals numbers tell a different story about who got lucky and who did not.`,
        body: md,
        featured: true,
        source: `Generated from Gameweek ${gw} player history`
    };
}

function sdGenPremiumDilemma() {
    const premiums = sdPlayers().filter(p => p.price >= 9 && p.position >= 3)
        .sort((a, b) => b.own - a.own).slice(0, 4);
    if (premiums.length < 2) return null;
    const rounds = Math.max(1, sdRoundsPlayed());

    let md = `## The problem with premiums\n\n`;
    md += `A premium forward at £15m is not competing with the other forwards. He is competing with the two mid-price players you could field instead. `;
    md += `That is the whole calculation, and it is worth doing with numbers rather than instinct.\n\n`;
    md += `## Where the money is going\n\n`;
    md += sdTable(['Player', 'Team', 'Price', 'Owned', 'Points', 'xGI', 'Mins'],
        premiums.map(p => [p.name, p.team, `£${p.price.toFixed(1)}m`, `${p.own}%`, `**${p.points}**`, sdRound(p.xGI), p.minutes]));

    const best = [...premiums].sort((a, b) => (b.points / b.price) - (a.points / a.price))[0];
    const most = premiums[0];
    md += `\nOn points per million so far, **${best.name}** leads this group at ${sdRound(best.points / best.price, 2)}. `;
    md += `**${most.name}** is the most-owned at ${most.own}%, which makes him the one you are effectively forced to have an opinion about: `;
    md += `not owning him is an active bet against ${most.own}% of the field.\n\n`;
    md += `> With ${rounds} gameweek${rounds === 1 ? '' : 's'} played, these totals are a starting position rather than a verdict. `;
    md += `Points per million on a sample this small mostly measures who has had the kinder fixture.\n\n`;
    md += `## How to structure it\n\n`;
    md += `- **One premium, spread elsewhere.** Frees roughly £5m across two mid-price slots. Works when the mid-price bracket is deep.\n`;
    md += `- **Two premiums.** Forces genuine budget players into your defence. Viable when the cheap defenders are playing 90 minutes.\n`;
    md += `- **None.** Rarely correct, because the highest-owned premium sets the template score you are measured against.\n`;

    return { id: 'premium-dilemma', title: 'The Premium Dilemma: Structuring your Heavy Hitters',
        category: 'Strategy', icon: '💎',
        dek: `${most.name} sits at ${most.own}% ownership. Owning the field's premium is a decision either way — here is what the numbers say about structuring around them.`,
        body: md, source: 'Generated from current prices, ownership and season totals' };
}

function sdGenBargainGems() {
    const rounds = Math.max(1, sdRoundsPlayed());
    const perGame = p => p.minutes / rounds;
    const defs = sdPlayers().filter(p => p.position === 2 && p.price <= 4.5 && perGame(p) >= 60)
        .sort((a, b) => b.points - a.points).slice(0, 5);
    const mids = sdPlayers().filter(p => p.position === 3 && p.price <= 5.5 && perGame(p) >= 60)
        .sort((a, b) => b.points - a.points).slice(0, 5);

    let md = `## Why enablers decide squads\n\n`;
    md += `The cheapest player who actually starts is worth more than a better player who does not. `;
    md += `An enabler's job is to be £4.0m and play 90 minutes; everything beyond that is profit.\n\n`;

    md += `## Budget defenders (£4.5m and under, starting)\n\n`;
    md += defs.length
        ? sdTable(['Player', 'Team', 'Price', 'Mins', 'Pts', 'CS', 'Owned'],
            defs.map(p => [p.name, p.team, `£${p.price.toFixed(1)}m`, p.minutes, `**${p.points}**`, p.cs, `${p.own}%`]))
        : `No defender at £4.5m or under is averaging a start yet. That is itself worth knowing — this season's budget defence is not settled.\n`;

    md += `\n## Budget midfielders (£5.5m and under, starting)\n\n`;
    md += mids.length
        ? sdTable(['Player', 'Team', 'Price', 'Mins', 'Pts', 'xGI', 'Owned'],
            mids.map(p => [p.name, p.team, `£${p.price.toFixed(1)}m`, p.minutes, `**${p.points}**`, sdRound(p.xGI), `${p.own}%`]))
        : `No midfielder at £5.5m or under is averaging a start yet.\n`;

    md += `\n> Filtered on minutes per gameweek across ${rounds} round${rounds === 1 ? '' : 's'}, not on price alone. `;
    md += `A cheap player with no minutes is not a bargain, he is a hole in your team.\n`;

    return { id: 'bargain-gems', title: 'Bargain Bin Gems: £4.0m Defenders & £4.5m Midfielders',
        category: 'Budget', icon: '💰',
        dek: `The enablers actually starting matches. Filtered on minutes played rather than price, because a cheap player who does not play is not a bargain.`,
        body: md, source: 'Generated from prices and minutes played' };
}

function sdGenUnderTheHood() {
    const rounds = Math.max(1, sdRoundsPlayed());
    // Chances created but not yet converted — the gap between process and result.
    const pool = sdPlayers().filter(p => p.minutes >= 60 * rounds * 0.6 && p.xGI >= 0.4)
        .map(p => ({ ...p, ret: p.goals + p.assists, gap: p.xGI - (p.goals + p.assists) }))
        .sort((a, b) => b.gap - a.gap).slice(0, 3);
    if (!pool.length) return null;

    let md = `## The gap between chances and goals\n\n`;
    md += `Expected goal involvements measure the chances a player gets into. Goals and assists measure what came of them. `;
    md += `When the first is well ahead of the second, one of two things is true: the player has been unlucky, or he is not good enough to finish what he creates. `;
    md += `Over a long enough run it is almost always the first.\n\n`;

    md += sdTable(['Player', 'Team', 'Price', 'xGI', 'Actual G+A', 'Shortfall', 'Owned'],
        pool.map(p => [p.name, p.team, `£${p.price.toFixed(1)}m`, sdRound(p.xGI), p.ret, `**${sdRound(p.gap)}**`, `${p.own}%`]));

    md += `\n`;
    pool.forEach(p => {
        md += `### ${p.name} — ${p.team}, £${p.price.toFixed(1)}m\n\n`;
        md += `${sdRound(p.xGI)} expected involvements from ${p.minutes} minutes, with ${p.ret} actual return${p.ret === 1 ? '' : 's'} to show for it. `;
        md += `Owned by ${p.own}% of managers.\n\n`;
    });

    md += `> Caveat worth stating plainly: this is ${rounds} gameweek${rounds === 1 ? '' : 's'} of data. `;
    md += `A shortfall this early is a reason to watch a player, not a guarantee the goals are coming.\n`;

    return { id: 'under-the-hood', title: `Under the Hood: 3 Players whose underlying xGI screams 'Buy'`,
        category: 'Data Deep-Dive', icon: '📊',
        dek: `Three players getting into good positions without the returns to show for it yet. The gap between expected and actual is where transfers are won.`,
        body: md, source: 'Generated from expected goal involvements against actual returns' };
}

function sdGenDifferentialWatchlist() {
    const rounds = Math.max(1, sdRoundsPlayed());
    const diffs = sdPlayers().filter(p => p.own < 5 && p.minutes >= 60 * rounds * 0.6 && p.xGI >= 0.3 && p.status === 'a')
        .sort((a, b) => b.xGI - a.xGI).slice(0, 5);
    if (!diffs.length) return null;

    let md = `## What a differential is for\n\n`;
    md += `A differential is not a cheap player or an obscure one. It is a player who moves you *relative to the field*. `;
    md += `If 40% of managers own someone, his double-digit haul does not gain you rank — it just stops you losing it. `;
    md += `Everything below is under 5% owned.\n\n`;

    md += sdTable(['Player', 'Team', 'Pos', 'Price', 'Owned', 'Mins', 'xGI', 'Pts'],
        diffs.map(p => [p.name, p.team, p.pos, `£${p.price.toFixed(1)}m`, `**${p.own}%**`, p.minutes, sdRound(p.xGI), p.points]));

    const lead = diffs[0];
    md += `\n**${lead.name}** heads the list: ${sdRound(lead.xGI)} expected involvements from ${lead.minutes} minutes at ${lead.own}% ownership. `;
    md += `At £${lead.price.toFixed(1)}m he is cheap enough to be a squad-filler rather than a bet you have to justify.\n\n`;
    md += `> Under-ownership is a fact about other managers, not a quality in the player. `;
    md += `Every name here is under 5% owned for a reason — the question is whether that reason is still true.\n`;

    return { id: 'differential-watchlist', title: 'The Differential Watchlist: Low-owned assets poised to haul',
        category: 'Differentials', icon: '🎯',
        dek: `Five players under 5% ownership with the underlying numbers to justify a look. Rank is won by the players other managers do not have.`,
        body: md, source: 'Generated from ownership under 5% against expected involvements' };
}

function sdGenInsideAlgorithm() {
    let md = `## What the projection actually does\n\n`;
    md += `Every projected-points figure on this site comes from one function. It is worth being specific about what it does, because "AI" is doing a lot of unearned work in most FPL tools.\n\n`;

    md += `### 1. Minutes first\n\n`;
    md += `Nothing else matters if a player does not play. The model estimates a probability of starting from minutes per appearance, then blends a starter's minutes with a substitute's cameo. `;
    md += `A player with a fitness doubt has that probability scaled by his published chance of playing.\n\n`;

    md += `### 2. Attacking returns, regressed\n\n`;
    md += `Per-90 rates from a small sample are wild — one goal in one appearance is a huge xG/90. `;
    md += `The model regresses each player's rate toward his position's average until there is roughly five full matches of evidence, then lets his own numbers stand alone.\n\n`;

    md += `### 3. Clean sheets from the defence, not the fixture alone\n\n`;
    md += `Clean-sheet probability comes from goals conceded and a defensive rating, adjusted by fixture difficulty, and is capped at both ends. `;
    md += `No defence is a certainty and none is hopeless.\n\n`;

    md += `### 4. Then the scoring rules\n\n`;
    md += sdTable(['Component', 'How it is derived'], [
        ['Appearance', 'Start probability against 2 points for 60 minutes, 1 otherwise'],
        ['Attack', 'Regressed xG and xA per 90, scaled by expected minutes and fixture'],
        ['Clean sheet', 'Clean-sheet probability by position value, scaled by start probability'],
        ['Saves', 'Saves per 90 divided by 3, for goalkeepers'],
        ['Bonus', 'Bonus per game, capped'],
        ['Conceded', 'Goals conceded against the chance of no clean sheet, as a negative']
    ]);

    md += `\n### What it deliberately does not do\n\n`;
    md += `The model uses FPL's own \`ep_next\` only as a floor while a player has little history, and only for the immediate gameweek. `;
    md += `Three gameweeks out it is ignored entirely — it is an estimate for the next match and means nothing beyond it.\n\n`;
    md += `> The projection is calibrated against FPL's published average entry score. It is a model, not a prophecy, and the numbers it produces are only as good as the sample behind them. `;
    md += `Early in a season that sample is small, which is why this site says "too early to rank" rather than inventing a ranking.\n`;

    return { id: 'inside-algorithm', title: 'Inside the Algorithm: How our FPL AI predicts points',
        category: 'Behind the Build', icon: '🔧',
        dek: `No black box. A component-by-component walkthrough of how every projected-points number on this site is produced, and what the model refuses to claim.`,
        body: md, source: 'Describes the projection model in scripts/pitch-snapshot.js' };
}

// ---------- recurring formats (the generate button) ----------

function sdGenFixtureHorizon() {
    const gws = [...new Set((sdFixtures || []).filter(f => f.event && !f.finished_provisional).map(f => f.event))].sort((a, b) => a - b).slice(0, 6);
    if (gws.length < 4) return null;
    const half = Math.floor(gws.length / 2);

    const swings = (sdBoot?.teams || []).map(t => {
        const fdrFor = list => {
            const vals = list.flatMap(g => (sdFixtures || []).filter(f => f.event === g && (f.team_h === t.id || f.team_a === t.id))
                .map(f => f.team_h === t.id ? f.team_h_difficulty : f.team_a_difficulty));
            return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
        };
        const near = fdrFor(gws.slice(0, half)), far = fdrFor(gws.slice(half));
        if (near == null || far == null) return null;
        return { name: t.name, short: t.short_name, near, far, swing: near - far };
    }).filter(Boolean);

    const easing = [...swings].sort((a, b) => b.swing - a.swing).slice(0, 2);
    const hardening = [...swings].sort((a, b) => a.swing - b.swing).slice(0, 2);

    let md = `## The next six weeks\n\n`;
    md += `FPL is played in blocks. The teams worth buying are rarely the ones with the best fixture this week — they are the ones whose schedule turns over the next month.\n\n`;
    md += `## Schedules easing\n\n`;
    md += sdTable(['Team', `GW${gws[0]}–${gws[half - 1]}`, `GW${gws[half]}–${gws[gws.length - 1]}`, 'Swing'],
        easing.map(t => [t.name, sdRound(t.near, 1), sdRound(t.far, 1), `**−${sdRound(t.swing, 1)}**`]));
    md += `\n**${easing[0].name}** have the sharpest turn: an average difficulty of ${sdRound(easing[0].near, 1)} across the first block against ${sdRound(easing[0].far, 1)} in the second. `;
    md += `Buy into that before the fixtures arrive, not after.\n\n`;
    md += `## Schedules hardening\n\n`;
    md += sdTable(['Team', `GW${gws[0]}–${gws[half - 1]}`, `GW${gws[half]}–${gws[gws.length - 1]}`, 'Swing'],
        hardening.map(t => [t.name, sdRound(t.near, 1), sdRound(t.far, 1), `**+${sdRound(-t.swing, 1)}**`]));
    md += `\n**${hardening[0].name}** go the other way. If you hold their assets, the exit window is now rather than in three weeks when everybody else is selling.\n\n`;
    md += `> Fixture difficulty is FPL's own rating. It is a blunt instrument — it knows nothing about injuries or form — but over a six-week block it is directionally right more often than not.\n`;

    return { id: 'fixture-horizon-' + Date.now(), title: `The Fixture Horizon: Who turns green through GW${gws[gws.length - 1]}`,
        category: 'Fixture Watch', icon: '📅',
        dek: `${easing[0].name} and ${easing[1].name} see their schedules ease over the next six gameweeks. ${hardening[0].name} run into a wall.`,
        body: md, source: `Generated from fixture difficulty across GW${gws[0]}–${gws[gws.length - 1]}` };
}

function sdGenDifferentialSpotlight() {
    const rounds = Math.max(1, sdRoundsPlayed());
    const pool = sdPlayers().filter(p => p.own < 5 && p.status === 'a' && p.minutes >= 45 * rounds && p.xGI > 0)
        .map(p => ({ ...p, gap: p.xGI - (p.goals + p.assists) }))
        .sort((a, b) => b.gap - a.gap).slice(0, 3);
    if (!pool.length) return null;

    let md = `## Quietly building\n\n`;
    md += `The most useful differential is not the one who just hauled — by then he is not a differential. `;
    md += `It is the one getting into the right positions with nothing yet to show for it.\n\n`;
    md += sdTable(['Player', 'Team', 'Price', 'Owned', 'xGI', 'G+A', 'Waiting on'],
        pool.map(p => [p.name, p.team, `£${p.price.toFixed(1)}m`, `**${p.own}%**`, sdRound(p.xGI), p.goals + p.assists, sdRound(p.gap)]));
    md += `\n`;
    pool.forEach(p => {
        md += `**${p.name}** (${p.team}, £${p.price.toFixed(1)}m) — ${sdRound(p.xGI)} expected involvements, ${p.goals + p.assists} actual, ${p.own}% owned.\n\n`;
    });
    md += `> ${rounds} gameweek${rounds === 1 ? '' : 's'} of evidence. Treat this as a watchlist, not a shopping list.\n`;

    return { id: 'diff-spotlight-' + Date.now(), title: 'Differential Spotlight: Under 5% and getting into positions',
        category: 'Differentials', icon: '🔍',
        dek: `${pool[0].name} leads a group of low-owned players generating chances without the returns. The gap is the opportunity.`,
        body: md, source: 'Generated from ownership and expected involvement gaps' };
}

function sdGenChipMarketWatch() {
    const players = sdPlayers();
    const total = sdBoot?.total_players || 0;
    const withPressure = players.filter(p => p.own > 0.5 && total)
        .map(p => ({ ...p, net: p.tIn - p.tOut, pressure: (p.tIn - p.tOut) / Math.max((p.own / 100) * total, 1) }));
    const rising = [...withPressure].sort((a, b) => b.pressure - a.pressure).slice(0, 5);
    const falling = [...withPressure].sort((a, b) => a.pressure - b.pressure).slice(0, 5);

    let md = `## Where the market is moving\n\n`;
    md += `Price changes follow net transfers measured against how many managers already own a player. `;
    md += `A player owned by 300,000 needs far fewer buys to rise than one owned by four million — which is why raw transfer counts mislead.\n\n`;
    md += `## Under buying pressure\n\n`;
    md += sdTable(['Player', 'Team', 'Price', 'Owned', 'Net transfers'],
        rising.map(p => [p.name, p.team, `£${p.price.toFixed(1)}m`, `${p.own}%`, `**+${p.net.toLocaleString()}**`]));
    md += `\n## Being sold\n\n`;
    md += sdTable(['Player', 'Team', 'Price', 'Owned', 'Net transfers'],
        falling.map(p => [p.name, p.team, `£${p.price.toFixed(1)}m`, `${p.own}%`, `**${p.net.toLocaleString()}**`]));
    md += `\n## On chips\n\n`;
    md += `The instinct to follow the crowd on chip timing is usually wrong for the same reason differentials work: `;
    md += `playing a Bench Boost in the same week as everyone else converts a good week into an average one, relative to the field. `;
    md += `Chips are worth most when your squad is ready for them, not when the template is.\n\n`;
    md += `> FPL does not publish its price-change thresholds. The pressure figures above are a model of them built from transfer velocity, not the real number.\n`;

    return { id: 'market-watch-' + Date.now(), title: 'Chip Strategy & Market Watch: Who is moving, and when to play',
        category: 'Market', icon: '📈',
        dek: `${rising[0].name} leads the buying. A look at where the transfer market is heading, and why following the crowd on chips costs you rank.`,
        body: md, source: 'Generated from this gameweek\'s net transfers against ownership' };
}

const SD_RECURRING = [
    { key: 'fixture-horizon', label: 'The Fixture Horizon', cadence: 'Monthly', gen: sdGenFixtureHorizon },
    { key: 'diff-spotlight', label: 'Differential Spotlight', cadence: 'Every 2 weeks', gen: sdGenDifferentialSpotlight },
    { key: 'market-watch', label: 'Chip Strategy & Market Watch', cadence: 'Every 3–4 weeks', gen: sdGenChipMarketWatch }
];

// ---------- markdown ----------
// A deliberately small subset: headings, bold, blockquote, tables, lists,
// paragraphs. Everything is HTML-escaped BEFORE any markup is applied, so a
// player name containing a bracket can never become markup — the content is
// generated, but it is generated from a third-party feed and treated as untrusted.
function sdMarkdown(md) {
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');

    const lines = md.split('\n');
    let html = '', i = 0;

    while (i < lines.length) {
        const line = lines[i];

        if (/^\s*$/.test(line)) { i++; continue; }

        if (/^###\s/.test(line)) { html += `<h3>${inline(line.replace(/^###\s/, ''))}</h3>`; i++; continue; }
        if (/^##\s/.test(line)) { html += `<h2>${inline(line.replace(/^##\s/, ''))}</h2>`; i++; continue; }

        if (/^>\s?/.test(line)) {
            let quote = [];
            while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i++; }
            html += `<blockquote>${inline(quote.join(' '))}</blockquote>`;
            continue;
        }

        // Table: a header row, a separator, then body rows.
        if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1])) {
            const cells = r => r.split('|').slice(1, -1).map(c => inline(c.trim()));
            const head = cells(line);
            i += 2;
            const body = [];
            while (i < lines.length && /^\|/.test(lines[i])) { body.push(cells(lines[i])); i++; }
            html += `<div class="sd-table-wrap"><table class="sd-table"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>`
                + `<tbody>${body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
            continue;
        }

        if (/^[-*]\s/.test(line)) {
            const items = [];
            while (i < lines.length && /^[-*]\s/.test(lines[i])) { items.push(inline(lines[i].replace(/^[-*]\s/, ''))); i++; }
            html += `<ul>${items.map(it => `<li>${it}</li>`).join('')}</ul>`;
            continue;
        }

        const para = [];
        while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^[#>|]|^[-*]\s/.test(lines[i])) { para.push(lines[i]); i++; }
        if (para.length) html += `<p>${inline(para.join(' '))}</p>`;
    }
    return html;
}

// ---------- feed + reader ----------
function sdFormatDate(d) {
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderArticlesPage() {
    const el = document.getElementById('sdFeed');
    if (!el) return;
    if (!sdArticles.length) {
        el.innerHTML = `<div class="sd-empty">No articles could be generated — the FPL data has not loaded.</div>`;
        return;
    }

    const featured = sdArticles.find(a => a.featured) || sdArticles[0];
    const rest = sdArticles.filter(a => a !== featured);

    el.innerHTML = `
        <a class="sd-featured" href="${sdPermalink(featured)}" onclick="return sdCardClick(event, '${featured.id}')">
            <div class="sd-featured-art" aria-hidden="true"><span class="sd-featured-glyph">${featured.icon}</span></div>
            <div class="sd-featured-body">
                <div class="sd-tags">
                    <span class="sd-tag primary">${escHTML(featured.category)}</span>
                    <span class="sd-read">⏱️ ${featured.readTime} min read</span>
                </div>
                <h2 class="sd-featured-title">${escHTML(featured.title)}</h2>
                <p class="sd-featured-dek">${escHTML(featured.dek)}</p>
                <div class="sd-meta">${sdFormatDate(featured.date)} · ${escHTML(featured.source)}</div>
            </div>
        </a>

        <div class="sd-grid">
            ${rest.map(a => `
                <a class="sd-card" href="${sdPermalink(a)}" onclick="return sdCardClick(event, '${a.id}')">
                    <div class="sd-card-top">
                        <span class="sd-tag">${a.icon} ${escHTML(a.category)}</span>
                        <span class="sd-read">⏱️ ${a.readTime} min</span>
                    </div>
                    <h3 class="sd-card-title">${escHTML(a.title)}</h3>
                    <p class="sd-card-dek">${escHTML(a.dek)}</p>
                    <div class="sd-meta">${sdFormatDate(a.date)}</div>
                </a>`).join('')}
        </div>`;
}

// Archived articles have a real page of their own. Live-generated ones do not,
// so they fall back to the desk itself.
function sdPermalink(a) {
    return a.slug ? `articles/${a.slug}.html` : 'fpl-scouts-desk.html';
}

// Plain click opens the reader; modified clicks and middle-click keep the
// browser's own behaviour, so the permalink still works as a link.
function sdCardClick(event, id) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return true;
    event.preventDefault();
    sdOpenArticle(id);
    return false;
}

async function sdOpenArticle(id) {
    const a = sdArticles.find(x => x.id === id);
    if (!a) return;
    // Index entries carry no body — fetch it the first time one is opened.
    if (!a.body && a.slug) {
        try {
            const full = await DataCache.fetchJSON(`data/articles/${a.slug}.json?v=${CACHE_BUSTER}`);
            a.body = full.body;
        } catch (e) {
            a.body = '_This article could not be loaded._';
        }
    }
    sdRenderArticle(a);
}

function sdRenderArticle(a) {
    document.getElementById('sdReaderBody').innerHTML = `
        <div class="sd-tags">
            <span class="sd-tag primary">${a.icon} ${escHTML(a.category)}</span>
            <span class="sd-read">⏱️ ${a.readTime} min read</span>
        </div>
        <h1 class="sd-reader-title">${escHTML(a.title)}</h1>
        <p class="sd-reader-dek">${escHTML(a.dek)}</p>
        <div class="sd-reader-meta">${sdFormatDate(a.date)} · ${escHTML(a.source)}</div>
        <div class="sd-prose">${sdMarkdown(a.body)}</div>
        <div class="sd-reader-foot">
            ${a.slug
                ? `Published from the FPL dataset as it stood that day, and unedited since. <a class="sd-permalink" href="articles/${a.slug}.html">Permanent link</a>`
                : 'Generated from the live FPL dataset when this page loaded.'}
        </div>`;
    document.getElementById('sdReader').classList.add('open');
    document.body.style.overflow = 'hidden';
    document.getElementById('sdReaderScroll').scrollTop = 0;
}

function sdCloseArticle(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('sdReader').classList.remove('open');
    document.body.style.overflow = '';
}

function sdGenerate(key) {
    const spec = SD_RECURRING.find(r => r.key === key);
    if (!spec) return;
    const art = spec.gen();
    const status = document.getElementById('sdGenStatus');
    if (!art) {
        if (status) status.textContent = `Not enough data to generate ${spec.label} yet.`;
        return;
    }
    art.readTime = sdReadTime(art.body);
    art.date = new Date();
    sdArticles.unshift(art);
    renderArticlesPage();
    if (status) status.textContent = `Published “${art.title}”.`;
    sdOpenArticle(art.id);
}

function sdToggleStudio() {
    const el = document.getElementById('sdStudio');
    if (el) el.classList.toggle('open');
}

// ---------- boot ----------
async function initScoutsDesk() {
    try {
        const [boot, fixtures, players] = await Promise.all([
            DataCache.fetchJSON(DATA_URLS.bootstrap),
            DataCache.fetchJSON(DATA_URLS.fixtures).catch(() => []),
            DataCache.fetchJSON(DATA_URLS.players).catch(() => null)
        ]);
        sdBoot = boot; sdFixtures = fixtures; sdHistory = players;

        // The archive is the record. It is written once per gameweek by
        // scripts/build-articles.js after the data refresh, so a gameweek's
        // debrief stays exactly as it was published.
        let archive = null;
        try {
            archive = await DataCache.fetchJSON(`data/articles/index.json?v=${CACHE_BUSTER}`);
        } catch (e) { /* no archive yet — fall through to generating live */ }

        if (archive && archive.length) {
            sdArticles = archive.map(a => ({ ...a, id: a.slug, date: new Date(a.date) }));
            sdArchived = true;
        } else {
            // Nothing built yet (first deploy, or the action has not run). Generate
            // in the browser so the page is never empty, but these have no permalink
            // and are replaced by the archived versions once they exist.
            const built = [
                sdGenGameweekDebrief(),
                sdGenUnderTheHood(),
                sdGenDifferentialWatchlist(),
                sdGenBargainGems(),
                sdGenPremiumDilemma(),
                sdGenInsideAlgorithm()
            ].filter(Boolean);
            const now = Date.now();
            sdArticles = built.map((a, i) => ({
                ...a,
                readTime: sdReadTime(a.body),
                date: new Date(now - i * 86400000 * 2)
            }));
            sdArchived = false;
        }

        document.getElementById('sdStudioList').innerHTML = SD_RECURRING.map(r =>
            `<button class="sd-gen-btn" onclick="sdGenerate('${r.key}')">
                <span class="sd-gen-label">${escHTML(r.label)}</span>
                <span class="sd-gen-cadence">${escHTML(r.cadence)}</span>
            </button>`).join('');

        renderArticlesPage();
        const rounds = sdRoundsPlayed();
        const note = document.getElementById('sdDataNote');
        if (note) {
            const sample = rounds <= 2
                ? `Early-season samples are small, and the articles say so where it matters.`
                : `Drawn from ${rounds} completed gameweeks of FPL data.`;
            note.textContent = sdArchived
                ? `${sdArticles.length} articles in the archive, each published once and kept as it was. ${sample}`
                : `Generated live from the current FPL data — the archive has not been built yet. ${sample}`;
        }
    } catch (e) {
        console.error('Scout\'s Desk failed to load:', e);
        const el = document.getElementById('sdFeed');
        if (el) el.innerHTML = `<div class="sd-empty">Could not load the FPL data behind these articles. Try again shortly.</div>`;
    }
}

if (typeof document !== 'undefined') {
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') sdCloseArticle();
    });
}

// ---------- archive ----------
// The same generators, run at build time instead of page load, keyed by the
// gameweek they describe. A gameweek's debrief is a permanent record of that
// gameweek — once written it is never regenerated, which is the whole point of
// having an archive rather than a live view.
function sdSetData(boot, fixtures, history) {
    sdBoot = boot; sdFixtures = fixtures; sdHistory = history;
}

function sdSlugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Which recurring formats are due this gameweek. Cadence is expressed against
// the gameweek number so a build is deterministic — running the action six
// times a day must not produce six Fixture Horizons.
function sdRecurringDue(gw) {
    const due = [];
    if (gw % 4 === 0) due.push({ key: 'fixture-horizon', gen: sdGenFixtureHorizon });
    if (gw % 2 === 0) due.push({ key: 'differential-spotlight', gen: sdGenDifferentialSpotlight });
    if (gw % 4 === 2) due.push({ key: 'market-watch', gen: sdGenChipMarketWatch });
    return due;
}

// Everything that should exist in the archive given the data currently loaded.
// The builder writes only what is missing, so this can be called repeatedly.
function sdBuildArchive() {
    const gw = sdLastRound();
    const out = [];
    const push = (art, slug, dated) => {
        if (!art) return;
        art.slug = slug;
        art.readTime = sdReadTime(art.body);
        art.gw = dated ? gw : null;
        out.push(art);
    };

    if (gw > 0) {
        push(sdGenGameweekDebrief(), `gameweek-${gw}-debrief`, true);
        push(sdGenUnderTheHood(), `gameweek-${gw}-under-the-hood`, true);
        push(sdGenDifferentialWatchlist(), `gameweek-${gw}-differential-watchlist`, true);
        push(sdGenBargainGems(), `gameweek-${gw}-bargain-gems`, true);
        push(sdGenPremiumDilemma(), `gameweek-${gw}-premium-dilemma`, true);
        sdRecurringDue(gw).forEach(r => push(r.gen(), `gameweek-${gw}-${r.key}`, true));
    }
    // No live data behind it, so it is written once and never rewritten.
    push(sdGenInsideAlgorithm(), 'inside-the-algorithm', false);
    return out;
}

// Node (the build script) requires this file; the browser and jsc load it as a
// plain script and pick the same functions up as globals.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        sdSetData, sdBuildArchive, sdMarkdown, sdReadTime, sdLastRound,
        sdRoundsPlayed, sdSlugify, sdRecurringDue
    };
}
