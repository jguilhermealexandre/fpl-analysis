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
        starts: e.starts,
        threat: sdNum(e.threat),
        creativity: sdNum(e.creativity),
        ictIndex: sdNum(e.ict_index)
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

// Words a reader actually reads: directive fences and table pipes are markup,
// not prose, so they are stripped before counting.
function sdWordCount(markdown) {
    const text = String(markdown)
        .replace(/^:::.*$/gm, ' ')
        .replace(/\{fdr:[\d.]+\}/g, ' ')
        .replace(/[|#*>`_-]/g, ' ');
    return text.split(/\s+/).filter(Boolean).length;
}

function sdReadTime(markdown) {
    return Math.max(1, Math.ceil(sdWordCount(markdown) / 200));
}

function sdTable(headers, rows) {
    return '| ' + headers.join(' | ') + ' |\n|' + headers.map(() => '---').join('|') + '|\n'
        + rows.map(r => '| ' + r.join(' | ') + ' |').join('\n') + '\n';
}

/* ---------- rich block components ----------
   These emit directive blocks rather than HTML. sdMarkdown escapes every
   character of generated content before any markup is applied, which is what
   stops a player name from a third-party feed becoming markup. Handing the
   generators raw HTML would give that guarantee up for a styling convenience,
   so instead the renderer owns the tags and the generators only supply text. */

const SD_CALLOUT_LABEL = {
    insight: "\u{1F4A1} Scout's key takeaway",
    warning: '⚠️ Risk check',
    data: '\u{1F4CA} What the data says',
    tactical: '\u{1F9E0} Tactical read'
};

function sdCallout(variant, body) {
    const v = SD_CALLOUT_LABEL[variant] ? variant : 'insight';
    return `:::callout ${v}\n${body.trim()}\n:::\n\n`;
}

// Explicit buy / hold / sell calls, one per line: verdict | subject | reason.
function sdActions(items) {
    const rows = items.filter(Boolean)
        .map(a => `${a.verdict} | ${a.subject} | ${a.reason}`).join('\n');
    return rows ? `:::actions\n${rows}\n:::\n\n` : '';
}

function sdTakeaways(points) {
    const rows = points.filter(Boolean).map(t => `- ${t}`).join('\n');
    return rows ? `:::takeaways\n${rows}\n:::\n\n` : '';
}

// A run of upcoming matches: GW | opponent (H/A) | difficulty.
function sdFixtureStrip(items) {
    const rows = items.filter(Boolean)
        .map(f => `${f.gw} | ${f.opponent} | ${f.difficulty}`).join('\n');
    return rows ? `:::fixtures\n${rows}\n:::\n\n` : '';
}

// Table-cell token for a colour-coded difficulty pill.
function sdFdrCell(value) {
    return `{fdr:${sdRound(value, 1)}}`;
}

// ---------- shared lookups ----------
const SD_CHIP_NAME = { bboost: 'Bench Boost', '3xc': 'Triple Captain', freehit: 'Free Hit', wildcard: 'Wildcard', manager: 'Assistant Manager' };

function sdEvent(gw) {
    return (sdBoot?.events || []).find(e => e.id === gw) || null;
}

function sdNextGw() {
    const next = (sdBoot?.events || []).find(e => e.is_next);
    return next ? next.id : sdLastRound() + 1;
}

function sdPlayerById(id) {
    return sdPlayers().find(p => p.id === id) || null;
}

function sdTeam(id) {
    return (sdBoot?.teams || []).find(t => t.id === id) || null;
}

// FPL's own published attack and defence ratings, home and away. Set before the
// season rather than derived from results, so they are usable in Gameweek 1
// when nothing computed from actual matches would be.
function sdStrength(teamId, side, home) {
    const t = sdTeam(teamId);
    if (!t) return null;
    return side === 'attack'
        ? (home ? t.strength_attack_home : t.strength_attack_away)
        : (home ? t.strength_defence_home : t.strength_defence_away);
}

function sdStrengthWord(value, all) {
    if (value == null || !all.length) return 'average';
    const sorted = [...all].sort((a, b) => a - b);
    const rank = sorted.filter(v => v < value).length / sorted.length;
    if (rank >= 0.8) return 'one of the strongest in the division';
    if (rank >= 0.6) return 'above average';
    if (rank <= 0.2) return 'one of the weakest in the division';
    if (rank <= 0.4) return 'below average';
    return 'around the divisional average';
}

// Every fixture a team has in the given gameweeks, with the difficulty from
// that team's point of view.
function sdTeamFixtures(teamId, gws) {
    return (sdFixtures || [])
        .filter(f => gws.includes(f.event) && (f.team_h === teamId || f.team_a === teamId))
        .map(f => {
            const home = f.team_h === teamId;
            return {
                gw: f.event,
                home,
                opponent: sdTeamName(home ? f.team_a : f.team_h),
                difficulty: home ? f.team_h_difficulty : f.team_a_difficulty
            };
        })
        .sort((a, b) => a.gw - b.gw);
}

function sdUpcomingGws(count) {
    const played = sdLastRound();
    return [...new Set((sdFixtures || []).map(f => f.event).filter(g => g && g > played))]
        .sort((a, b) => a - b).slice(0, count);
}

// ---------- generators ----------

/* 1. The Gameweek Debrief — weekly, post-gameweek.
   The round's own numbers plus the aggregates FPL publishes about the round:
   the average score, the top score, how many managers played which chip. Those
   are real figures about a completed gameweek, so they carry the article's
   length without any of it resting on a one-round trend claim. */
function sdGenGameweekDebrief() {
    const gw = sdLastRound();
    const rows = sdRoundRows(gw);
    if (!rows.length) return null;

    const ev = sdEvent(gw);
    const byPoints = [...rows].sort((a, b) => b.gwPoints - a.gwPoints);
    const hero = byPoints[0];
    const top = byPoints.slice(0, 12);

    // FPL names the round's highest-scoring player outright. If he is not in the
    // history subset, the headline below would crown the wrong man, so the claim
    // is softened rather than risked.
    const officialTop = ev && ev.top_element_info ? ev.top_element_info : null;
    const heroIsTop = !officialTop || hero.gwPoints >= officialTop.points;

    const heroLine = hero.gwGoals > 0 || hero.gwAssists > 0
        ? `${hero.gwGoals} goal${hero.gwGoals === 1 ? '' : 's'}${hero.gwAssists ? ` and ${hero.gwAssists} assist${hero.gwAssists === 1 ? '' : 's'}` : ''}`
        : `${hero.gwPoints} points without a goal or assist`;

    let md = `## The headline\n\n`;
    md += heroIsTop
        ? `**${hero.name}** was the story of Gameweek ${gw}: `
        : `**${hero.name}** led the players tracked here in Gameweek ${gw}: `;
    md += `${hero.gwPoints} points from ${heroLine} `;
    md += `${hero.gwHome ? 'at home to' : 'away at'} ${hero.gwOpponent}, in ${hero.gwMinutes} minutes. `;
    md += `He went into the round owned by ${hero.own}% of managers.\n\n`;

    // ---- takeaways ----
    const bigOwn = [...rows].filter(r => r.own >= 15).sort((a, b) => a.gwPoints - b.gwPoints);
    const blanked = bigOwn.filter(r => r.gwPoints <= 2).slice(0, 4);
    const takeaways = [
        `**${hero.name}** top-scored with ${hero.gwPoints} against ${hero.gwOpponent}.`,
        ev && ev.average_entry_score ? `The average manager scored **${ev.average_entry_score}**; the best score in the game was **${ev.highest_score}**.` : null,
        blanked.length ? `**${blanked[0].name}** (${blanked[0].own}% owned) returned ${blanked[0].gwPoints} — the round's most expensive blank.` : null
    ];

    // ---- the round in numbers ----
    if (ev && ev.average_entry_score) {
        const chips = (ev.chip_plays || []).filter(c => c.num_played > 0)
            .sort((a, b) => b.num_played - a.num_played);
        const entrants = ev.ranked_count || sdBoot?.total_players || 0;
        const capt = ev.most_captained ? sdPlayerById(ev.most_captained) : null;
        const most = ev.most_selected ? sdPlayerById(ev.most_selected) : null;

        takeaways.push(chips.length
            ? `**${chips[0].num_played.toLocaleString()}** managers played a ${SD_CHIP_NAME[chips[0].chip_name] || chips[0].chip_name}.`
            : null);

        md += sdTakeaways(takeaways);

        md += `## The round in numbers\n\n`;
        md += `These are the figures FPL publishes about the gameweek itself rather than about any one player, `;
        md += `and they set the bar every squad is measured against.\n\n`;
        const numbers = [
            ['Average score', `**${ev.average_entry_score}**`, 'What the field scored'],
            ['Highest score', `**${ev.highest_score || '—'}**`, 'The best single squad in the game'],
            ['Managers ranked', entrants ? entrants.toLocaleString() : '—', 'Squads that scored this round']
        ];
        if (capt) numbers.push(['Most captained', `**${capt.name}**`, `${capt.own}% owned, returned ${(rows.find(r => r.id === capt.id) || {}).gwPoints ?? '—'}`]);
        if (most) numbers.push(['Most selected', `**${most.name}**`, `${most.own}% owned`]);
        md += sdTable(['Metric', 'Value', 'What it means'], numbers);

        if (chips.length) {
            md += `\n### Chips played\n\n`;
            md += sdTable(['Chip', 'Managers', 'Share of the field'],
                chips.map(ch => [SD_CHIP_NAME[ch.chip_name] || ch.chip_name, `**${ch.num_played.toLocaleString()}**`,
                    entrants ? `${sdRound((ch.num_played / entrants) * 100, 1)}%` : '—']));
            md += `\n${SD_CHIP_NAME[chips[0].chip_name] || chips[0].chip_name} was the round's most-played chip. `;
            md += `A chip played in the same week as everybody else converts a good week into an average one relative to the field, `;
            md += `which is the argument for holding until your own squad is ready rather than until the template says go.\n\n`;
        }
    } else {
        md += sdTakeaways(takeaways);
    }

    // ---- top scorers ----
    md += `## Who actually scored\n\n`;
    md += sdTable(['Player', 'Team', 'Pos', 'Pts', 'Mins', 'G', 'A', 'Bonus', 'xGI', 'Owned'],
        top.map(p => [p.name, p.team, p.pos, `**${p.gwPoints}**`, p.gwMinutes, p.gwGoals, p.gwAssists, p.gwBonus, sdRound(p.gwXGI), `${p.own}%`]));

    if (blanked.length) {
        md += `\n`;
        md += sdCallout('warning',
            `The other side of the same weekend: ${blanked.map(b => `**${b.name}** (${b.own}% owned) returned ${b.gwPoints}`).join(', ')}. `
            + `Points you do not score cost exactly as much as points you do, and a blank from a widely-owned player is the one everybody feels at once.`);
    }

    // ---- scoreline vs reality ----
    const finishers = rows.filter(r => r.gwMinutes >= 45 && r.gwXG >= 0.2)
        .map(r => ({ ...r, diff: r.gwGoals - r.gwXG }))
        .sort((a, b) => b.diff - a.diff);
    const over = finishers.slice(0, 6);
    const under = [...finishers].reverse().slice(0, 6).filter(r => r.diff < -0.2);

    md += `## The scoreline against the underlying data\n\n`;
    md += `Expected goals measure the chances a player got into. Goals measure what he did with them. `;
    md += `Over one round the gap between the two is mostly noise, but it is the right place to look for the returns that have not landed yet.\n\n`;

    if (over.length) {
        md += `### Beat their chances\n\n`;
        md += sdTable(['Player', 'Team', 'Goals', 'xG', 'Difference', 'Mins'],
            over.map(p => [p.name, p.team, p.gwGoals, sdRound(p.gwXG), `**+${sdRound(p.diff)}**`, p.gwMinutes]));
    }
    if (under.length) {
        md += `\n### Created more than they took\n\n`;
        md += sdTable(['Player', 'Team', 'Goals', 'xG', 'Difference', 'Mins'],
            under.map(p => [p.name, p.team, p.gwGoals, sdRound(p.gwXG), `**${sdRound(p.diff)}**`, p.gwMinutes]));
        md += `\n**${under[0].name}** generated ${sdRound(under[0].gwXG)} expected goals and scored ${under[0].gwGoals}. `;
        md += `That is the kind of return that tends to arrive late rather than never — provided the chances keep coming.\n\n`;
    }
    md += sdCallout('data',
        `One round is one round. Everything above describes what happened in Gameweek ${gw}; none of it is a verdict on anybody's finishing. `
        + `A single game of expected-goals data has an error bar wide enough to drive a bus through. Ask again after five.`);

    // ---- defensive audit ----
    const teamGoals = {};
    (sdFixtures || []).filter(f => f.event === gw && f.team_h_score !== null).forEach(f => {
        teamGoals[f.team_h] = { for: f.team_h_score, against: f.team_a_score };
        teamGoals[f.team_a] = { for: f.team_a_score, against: f.team_h_score };
    });
    const cleanSheets = Object.entries(teamGoals).filter(([, g]) => g.against === 0)
        .map(([id]) => sdTeamName(parseInt(id, 10)));

    md += `## The defensive audit\n\n`;
    md += cleanSheets.length
        ? `${cleanSheets.length} team${cleanSheets.length === 1 ? '' : 's'} kept a clean sheet in Gameweek ${gw}: ${cleanSheets.join(', ')}. `
        : `No team kept a clean sheet in Gameweek ${gw}. `;
    md += `Clean sheets are worth four points to a defender and a goalkeeper, which makes the defensive picture worth as much attention as the attacking one.\n\n`;

    const keepers = rows.filter(r => r.pos === 'GK' && r.gwMinutes >= 60)
        .sort((a, b) => b.gwPoints - a.gwPoints).slice(0, 6);
    if (keepers.length) {
        md += `### Goalkeepers\n\n`;
        md += sdTable(['Player', 'Team', 'Price', 'Pts', 'Saves', 'Conceded', 'Owned'],
            keepers.map(p => {
                const h = (sdHistory?.players || []).find(x => x.id === p.id);
                const rec = h ? (h.history || []).find(g => g.round === gw) : null;
                return [p.name, p.team, `£${p.price.toFixed(1)}m`, `**${p.gwPoints}**`,
                    rec ? rec.saves : '—', rec ? rec.goals_conceded : '—', `${p.own}%`];
            }));
        md += `\nA goalkeeper behind a leaky defence is not automatically a bad pick: save points accumulate in exactly the weeks a clean sheet does not arrive, `;
        md += `which is why the busiest keeper in the division is often better value than the one behind the best defence.\n\n`;
    }

    const defenders = rows.filter(r => r.pos === 'DEF' && r.gwMinutes >= 60)
        .sort((a, b) => b.gwPoints - a.gwPoints).slice(0, 6);
    if (defenders.length) {
        md += `### Defenders\n\n`;
        md += sdTable(['Player', 'Team', 'Price', 'Pts', 'Bonus', 'xGI', 'Owned'],
            defenders.map(p => [p.name, p.team, `£${p.price.toFixed(1)}m`, `**${p.gwPoints}**`, p.gwBonus, sdRound(p.gwXGI), `${p.own}%`]));
        md += `\n`;
    }

    // ---- team attacking audit ----
    const scored = Object.entries(teamGoals).map(([id, g]) => ({ id: parseInt(id, 10), name: sdTeamName(parseInt(id, 10)), ...g }))
        .sort((a, b) => b.for - a.for);
    if (scored.length) {
        md += `### Attacking output by team\n\n`;
        md += sdTable(['Team', 'Scored', 'Conceded', 'Result'],
            scored.slice(0, 8).map(t => [`**${t.name}**`, t.for, t.against,
                t.for > t.against ? 'Won' : t.for === t.against ? 'Drew' : 'Lost']));
        md += `\n**${scored[0].name}** scored the most goals of the round with ${scored[0].for}. `;
        md += `Team-level attacking output is the cleanest signal available after a single round: it takes eleven players to create a goal and one to finish it, `;
        md += `and the finisher changes far more often than the creating does.\n\n`;
    }

    // ---- bonus points ----
    const bonusMen = rows.filter(r => r.gwBonus > 0).sort((a, b) => b.gwBonus - a.gwBonus || b.gwBps - a.gwBps).slice(0, 10);
    if (bonusMen.length) {
        md += `## The bonus point picture\n\n`;
        md += `Bonus is decided by the Bonus Points System, which rewards goals and assists heavily but also pays for tackles, recoveries, clean sheets and passing accuracy. `;
        md += `Over a season it is worth roughly a point a game to the players who consistently rank in it, and it is the most overlooked component of a captaincy decision.\n\n`;
        md += sdTable(['Player', 'Team', 'Pos', 'Bonus', 'BPS', 'Pts', 'Owned'],
            bonusMen.map(p => [`**${p.name}**`, p.team, p.pos, `**${p.gwBonus}**`, p.gwBps, p.gwPoints, `${p.own}%`]));
        md += `\n**${bonusMen[0].name}** took the maximum with ${bonusMen[0].gwBonus} from a BPS score of ${bonusMen[0].gwBps}. `;
        md += `Defenders and holding midfielders who accumulate BPS through defensive actions are the ones worth identifying early, `;
        md += `because that route to bonus is far more repeatable than the one that runs through scoring goals.\n\n`;
    }

    // ---- premium watch ----
    const premiums = rows.filter(r => r.price >= 9 && r.position >= 3)
        .sort((a, b) => b.own - a.own).slice(0, 6);
    if (premiums.length >= 2) {
        md += `## The premium watch\n\n`;
        md += `A premium at £10m or more is not competing with the other forwards. He is competing with the two mid-price players you could field instead, `;
        md += `and with the ${premiums[0].own}% of the field who already own the most popular of them.\n\n`;
        md += sdTable(['Player', 'Team', 'Price', 'Pts', 'Mins', 'G', 'A', 'xGI', 'Owned'],
            premiums.map(p => [p.name, p.team, `£${p.price.toFixed(1)}m`, `**${p.gwPoints}**`, p.gwMinutes, p.gwGoals, p.gwAssists, sdRound(p.gwXGI), `${p.own}%`]));
        const bestPrem = [...premiums].sort((a, b) => b.gwPoints - a.gwPoints)[0];
        const worstPrem = [...premiums].sort((a, b) => a.gwPoints - b.gwPoints)[0];
        md += `\n**${bestPrem.name}** led the bracket with ${bestPrem.gwPoints}. **${worstPrem.name}** returned ${worstPrem.gwPoints}, `;
        md += `and at £${worstPrem.price.toFixed(1)}m that is the single largest hole a squad can have in a week. `;
        md += `Not owning the most-selected premium is an active bet against ${premiums[0].own}% of the field — a legitimate one, but it should be deliberate.\n\n`;
    }

    // ---- budget gems ----
    const gems = rows.filter(r => r.price <= 5.5 && r.gwMinutes >= 60 && r.gwPoints >= 4)
        .sort((a, b) => b.gwPoints - a.gwPoints).slice(0, 8);
    if (gems.length) {
        md += `## Enablers and budget gems\n\n`;
        md += `The cheapest player who actually starts is worth more than a better player who does not. `;
        md += `An enabler's job is to cost £4.5m and play ninety minutes; everything past that is profit that funds the rest of the squad.\n\n`;
        md += sdTable(['Player', 'Team', 'Pos', 'Price', 'Pts', 'Mins', 'Owned'],
            gems.map(p => [p.name, p.team, p.pos, `£${p.price.toFixed(1)}m`, `**${p.gwPoints}**`, p.gwMinutes, `${p.own}%`]));
        md += `\n**${gems[0].name}** at £${gems[0].price.toFixed(1)}m returned ${gems[0].gwPoints} points from ${gems[0].gwMinutes} minutes, `;
        md += `on ${gems[0].own}% ownership. Enablers at that price are how squads afford two premiums without hollowing out the bench.\n\n`;
    }

    // ---- differentials of the round ----
    const diffWinners = rows.filter(r => r.own < 8 && r.gwPoints >= 6)
        .sort((a, b) => b.gwPoints - a.gwPoints).slice(0, 8);
    if (diffWinners.length) {
        md += `## The differentials who paid\n\n`;
        md += `Points from a player most of the field does not own are worth more than the same points from one they do. `;
        md += `These returned at least six while owned by under 8% of managers, which is where rank is actually won.\n\n`;
        md += sdTable(['Player', 'Team', 'Pos', 'Price', 'Pts', 'Owned', 'Mins'],
            diffWinners.map(p => [`**${p.name}**`, p.team, p.pos, `£${p.price.toFixed(1)}m`, `**${p.gwPoints}**`, `${p.own}%`, p.gwMinutes]));
        md += `\n**${diffWinners[0].name}** at ${diffWinners[0].own}% ownership returned ${diffWinners[0].gwPoints}. `;
        md += `The managers who owned him gained ground on almost the entire field in a single afternoon — that is the whole case for carrying one or two genuine differentials `;
        md += `rather than a squad indistinguishable from the template.\n\n`;
    }

    // ---- the hero, in context ----
    const heroStrip = sdTeamFixtures(hero.teamId, sdUpcomingGws(4))
        .map(f => ({ gw: `GW${f.gw}`, opponent: `${f.opponent} ${f.home ? '(H)' : '(A)'}`, difficulty: f.difficulty }));
    if (heroStrip.length) {
        md += `## Is ${hero.name} worth chasing?\n\n`;
        md += `The reflex after a haul is to buy it, and the reflex is usually wrong — you pay a risen price for a performance that has already happened. `;
        md += `The question worth asking is not what he just did but what is in front of him:\n\n`;
        md += sdFixtureStrip(heroStrip);
        const heroAvgFdr = heroStrip.reduce((s, f) => s + f.difficulty, 0) / heroStrip.length;
        md += `An average difficulty of ${sdRound(heroAvgFdr, 1)} across his next four. `;
        md += heroAvgFdr <= 2.5
            ? `That is a genuinely kind run, and it is the version of this question where chasing the haul is defensible.\n\n`
            : heroAvgFdr >= 3.6
            ? `That is a hard run, and buying into it at a raised price is how managers end up transferring the same player out three weeks later.\n\n`
            : `That is an ordinary run — not a reason to buy and not a reason to avoid, which usually means the transfer is better spent elsewhere.\n\n`;
    }

    // ---- transfer radar ----
    const buys = rows.filter(r => r.own < 12 && r.gwMinutes >= 60 && r.gwXGI >= 0.3)
        .sort((a, b) => b.gwXGI - a.gwXGI).slice(0, 2);
    const hold = rows.filter(r => r.own >= 20 && r.gwPoints <= 3 && r.gwXGI >= 0.2)
        .sort((a, b) => b.gwXGI - a.gwXGI)[0];
    const sell = rows.filter(r => r.own >= 10 && r.gwMinutes < 45)
        .sort((a, b) => a.gwMinutes - b.gwMinutes)[0];

    md += `## The early transfer radar\n\n`;
    md += `Four calls off the back of this round, with the reasoning attached so you can disagree with the reasoning rather than the conclusion.\n\n`;
    md += sdActions([
        ...buys.map(b => ({ verdict: 'buy', subject: `${b.name} (${b.team}, £${b.price.toFixed(1)}m)`,
            reason: `${sdRound(b.gwXGI)} expected involvements in ${b.gwMinutes} minutes and still only ${b.own}% owned.` })),
        hold ? { verdict: 'hold', subject: `${hold.name} (£${hold.price.toFixed(1)}m)`,
            reason: `${hold.gwPoints} points reads badly, but ${sdRound(hold.gwXGI)} expected involvements says the process was fine. Selling here sells the scoreline, not the player.` } : null,
        sell ? { verdict: 'sell', subject: `${sell.name} (£${sell.price.toFixed(1)}m)`,
            reason: sell.status !== 'a' && sell.news ? sell.news : `${sell.gwMinutes} minutes. Minutes are the one thing no projection can work around.` } : null
    ]);
    if (!buys.length) {
        md += `Nothing in this round separated itself enough on the underlying numbers to be worth a transfer on its own. `;
        md += `Sometimes the right move is none, and a saved transfer is worth more than a marginal one.\n\n`;
    }

    // ---- lookahead ----
    const nextGw = sdNextGw();
    const nextFixtures = (sdFixtures || []).filter(f => f.event === nextGw).slice(0, 10);
    if (nextFixtures.length) {
        md += `## Looking ahead to Gameweek ${nextGw}\n\n`;
        md += sdTable(['Fixture', 'Home difficulty', 'Away difficulty'],
            nextFixtures.map(f => [`${sdTeamName(f.team_h)} v ${sdTeamName(f.team_a)}`,
                sdFdrCell(f.team_h_difficulty), sdFdrCell(f.team_a_difficulty)]));
        const easiest = [...nextFixtures].sort((a, b) => Math.min(a.team_h_difficulty, a.team_a_difficulty) - Math.min(b.team_h_difficulty, b.team_a_difficulty))[0];
        const side = easiest.team_h_difficulty <= easiest.team_a_difficulty ? sdTeamName(easiest.team_h) : sdTeamName(easiest.team_a);
        md += `\n**${side}** have the kindest assignment of the round on difficulty alone. `;
        md += `That is a starting point for captaincy rather than an answer — difficulty ratings know nothing about who is injured.\n`;
    }

    return {
        id: 'gw-debrief',
        title: `Gameweek ${gw} Debrief: winners, blanks, and what the underlying numbers say`,
        category: 'Gameweek Debrief',
        icon: '📊',
        dek: `${hero.name} led Gameweek ${gw} with ${hero.gwPoints} points${ev && ev.average_entry_score ? ` against an average of ${ev.average_entry_score}` : ''}. Underneath the scoreline, the expected-goals numbers point at a different set of names.`,
        body: md,
        featured: true,
        source: `Generated from Gameweek ${gw} player history and FPL's published round summary`
    };
}

/* 2. Pre-Deadline Captain & Lineup Matrix — weekly, before the deadline.
   Forward-looking, so it does not depend on how much of the season has been
   played: the fixture list and FPL's own difficulty ratings are complete from
   day one. Effective ownership is not published by the API, so the ownership
   column is ownership and the article says so rather than inventing EO. */
function sdGenPreDeadlineCaptaincy() {
    const gw = sdNextGw();
    const fixtures = (sdFixtures || []).filter(f => f.event === gw);
    if (!fixtures.length) return null;

    const rounds = Math.max(1, sdRoundsPlayed());
    const teamFdr = {};
    fixtures.forEach(f => {
        teamFdr[f.team_h] = { opponent: sdTeamName(f.team_a), oppId: f.team_a, home: true, fdr: f.team_h_difficulty };
        teamFdr[f.team_a] = { opponent: sdTeamName(f.team_h), oppId: f.team_h, home: false, fdr: f.team_a_difficulty };
    });

    // Candidates: attacking players who start, with a fixture this round.
    const pool = sdPlayers()
        .filter(p => p.position >= 3 && p.status === 'a' && teamFdr[p.teamId] && p.minutes >= 45 * rounds)
        .map(p => ({ ...p, fx: teamFdr[p.teamId] }))
        .sort((a, b) => (b.points / rounds) - (a.points / rounds));
    if (pool.length < 4) return null;

    const template = pool.filter(p => p.own >= 15).slice(0, 8);
    const differential = pool.filter(p => p.own < 10 && p.fx.fdr <= 3).slice(0, 6);
    const lead = template[0] || pool[0];

    const ev = sdEvent(gw);
    const prevEv = sdEvent(sdLastRound());
    const lastCaptain = prevEv && prevEv.most_captained ? sdPlayerById(prevEv.most_captained) : null;

    let md = `## The armband is the biggest call you make\n\n`;
    md += `Captaincy doubles a score, which makes it worth more than most transfers. `;
    md += `A ten-point swing between two obvious picks is routine; over a season the armband decides more rank than any single buy.\n\n`;

    md += sdTakeaways([
        lead ? `**${lead.name}** is the safe pick: ${lead.own}% owned, ${lead.fx.home ? 'at home to' : 'away at'} ${lead.fx.opponent}.` : null,
        differential.length ? `**${differential[0].name}** is the differential at ${differential[0].own}% ownership.` : null,
        ev && ev.transfers_made ? `**${ev.transfers_made.toLocaleString()}** transfers have already been made ahead of the deadline.` : null,
        lastCaptain ? `Last round the field captained **${lastCaptain.name}**.` : null
    ]);

    md += `## The captaincy matrix\n\n`;
    md += `Ranked on points per gameweek so far, with the fixture attached. The difficulty rating is FPL's own.\n\n`;
    md += sdTable(['Player', 'Team', 'Price', 'Opponent', 'Pts/GW', 'Form', 'Owned', 'FDR'],
        template.map(p => [`**${p.name}**`, p.team, `£${p.price.toFixed(1)}m`,
            `${p.fx.opponent} ${p.fx.home ? '(H)' : '(A)'}`, sdRound(p.points / rounds, 1), sdRound(p.form, 1), `${p.own}%`, sdFdrCell(p.fx.fdr)]));

    if (lead) {
        const strip = sdTeamFixtures(lead.teamId, sdUpcomingGws(4))
            .map(f => ({ gw: `GW${f.gw}`, opponent: `${f.opponent} ${f.home ? '(H)' : '(A)'}`, difficulty: f.difficulty }));
        md += `\n### ${lead.name}'s next four\n\n`;
        md += sdFixtureStrip(strip);
        md += `**${lead.name}** ${lead.fx.home ? 'hosts' : 'travels to'} ${lead.fx.opponent} at a difficulty of ${lead.fx.fdr}. `;
        md += `At ${lead.own}% ownership the armband on him is close to a non-decision: captaining the same player as most of the field neither gains nor loses rank, `;
        md += `which is exactly why it is the correct default unless you have a reason to move.\n\n`;
    }

    if (differential.length) {
        md += `## The differential armband\n\n`;
        md += `Captaining off-template is a leveraged bet: it wins more rank than it should when it lands and costs more than it should when it does not. `;
        md += `These are the players with a kind fixture and an ownership low enough to make the bet worth taking.\n\n`;
        md += sdTable(['Player', 'Team', 'Price', 'Opponent', 'Pts/GW', 'Owned', 'FDR'],
            differential.map(p => [`**${p.name}**`, p.team, `£${p.price.toFixed(1)}m`,
                `${p.fx.opponent} ${p.fx.home ? '(H)' : '(A)'}`, sdRound(p.points / rounds, 1), `${p.own}%`, sdFdrCell(p.fx.fdr)]));
        md += `\n`;
        md += sdCallout('warning',
            `Effective ownership — the figure that actually decides whether a captaincy gains you rank — depends on how many managers captain a player, not just how many own him. `
            + `FPL does not publish that number, and nothing on this page estimates it. The ownership column above is ownership. Treat the gap between the two as unknown rather than small.`);
    }

    // ---- opponent defences ----
    const allDef = (sdBoot?.teams || []).flatMap(t => [t.strength_defence_home, t.strength_defence_away]).filter(Boolean);
    const shortlist = template.slice(0, 5);
    if (shortlist.length) {
        md += `## The defences they are up against\n\n`;
        md += `A captaincy pick is half about the player and half about who he is playing. FPL publishes its own defensive rating for every team, `;
        md += `home and away separately, and it is the one piece of opponent information that does not need a season's worth of results behind it.\n\n`;
        md += sdTable(['Player', 'Opponent', 'Venue', "Opponent's defence", 'Rating', 'FDR'],
            shortlist.map(p => {
                const def = sdStrength(p.fx.oppId, 'defence', !p.fx.home);
                return [`**${p.name}**`, p.fx.opponent, p.fx.home ? 'Home' : 'Away',
                    sdStrengthWord(def, allDef), def == null ? '—' : def, sdFdrCell(p.fx.fdr)];
            }));
        md += `\n`;
        shortlist.slice(0, 4).forEach(p => {
            const def = sdStrength(p.fx.oppId, 'defence', !p.fx.home);
            md += `### ${p.name} — ${p.team}, £${p.price.toFixed(1)}m\n\n`;
            md += `${p.own}% of the field own him. He ${p.fx.home ? 'hosts' : 'travels to'} ${p.fx.opponent}, `;
            md += `whose ${p.fx.home ? 'away' : 'home'} defence is ${sdStrengthWord(def, allDef)}. `;
            md += `He is averaging ${sdRound(p.points / rounds, 1)} points a gameweek so far`;
            md += p.xGI > 0 ? ` on ${sdRound(p.xGI)} expected involvements` : ``;
            md += `.\n\n`;
        });
    }

    // What the crowd did last week, and what it cost or earned them.
    if (lastCaptain) {
        const lastRows = sdRoundRows(sdLastRound());
        const capRow = lastRows.find(r => r.id === lastCaptain.id);
        const bestLast = [...lastRows].sort((a, b) => b.gwPoints - a.gwPoints)[0];
        md += `## What the field did last time\n\n`;
        md += `The most-captained player in Gameweek ${sdLastRound()} was **${lastCaptain.name}**`;
        md += capRow ? `, and he returned ${capRow.gwPoints} — ${capRow.gwPoints * 2} with the armband on.` : `.`;
        md += `\n\n`;
        if (capRow && bestLast) {
            const swing = (bestLast.gwPoints - capRow.gwPoints) * 2;
            md += swing > 0
                ? `The best available return was **${bestLast.name}** on ${bestLast.gwPoints}, so the difference between the crowd's armband and the optimal one was ${swing} points. `
                : `That was also the best return available, so the crowd's armband was the optimal one. `;
            md += `Chasing the optimal captain every week is not a strategy — nobody hits it — but the size of that gap is why the decision deserves more thought than it usually gets.\n\n`;
        }
    }

    // ---- vice-captain ----
    const vice = template.filter(p => p !== lead && p.fx.fdr <= 3)[0] || template[1];
    if (vice) {
        md += `## The vice-captaincy\n\n`;
        md += `The vice only pays out when your captain does not play, which makes it a decision most managers make carelessly and then regret twice a season. `;
        md += `The rule that matters: your vice should kick off **after** your captain wherever possible, so that a captain benched at the last minute can still be covered — `;
        md += `and he should never be a rotation risk himself, because a captain who does not play backed by a vice who also does not play is a guaranteed zero on a doubled slot.\n\n`;
        md += `**${vice.name}** (${vice.own}% owned, ${vice.fx.home ? 'home to' : 'away at'} ${vice.fx.opponent}) is the natural cover here.\n\n`;
    }

    // ---- failure modes ----
    md += `## Three ways this goes wrong\n\n`;
    md += `- **Captaining form into a wall.** A player in good touch against a strong defence away from home is a worse bet than an average player at home to a poor one. `;
    md += `Form is a weaker signal than the fixture, and it is the one that feels more compelling.\n`;
    md += `- **Chasing last week.** The player who returned fifteen last gameweek is not more likely to return this one, but he is more likely to be captained. `;
    md += `That is the mechanism by which the field collectively buys high.\n`;
    md += `- **Going differential for its own sake.** An off-template armband should be justified by the fixture, not by the ownership. `;
    md += `If the only argument for a captain is that few people own him, that is an argument for a lottery ticket.\n\n`;

    // ---- the bench call ----
    const hardFixture = pool.filter(p => p.fx.fdr >= 4 && p.own >= 10).slice(0, 3);
    const rotationRisk = sdPlayers()
        .filter(p => teamFdr[p.teamId] && p.own >= 5 && p.minutes > 0 && p.minutes < 60 * rounds && p.status === 'a')
        .sort((a, b) => a.minutes - b.minutes).slice(0, 3);

    md += `## The bench dilemma\n\n`;
    md += `Starting eleven decisions are quieter than captaincy and cost nearly as much. Two categories are worth a second look before the deadline: `;
    md += `players with a genuinely hard fixture, and players whose minutes have not been reliable.\n\n`;

    if (hardFixture.length) {
        md += `### Hard fixtures\n\n`;
        md += sdTable(['Player', 'Team', 'Opponent', 'FDR', 'Owned'],
            hardFixture.map(p => [p.name, p.team, `${p.fx.opponent} ${p.fx.home ? '(H)' : '(A)'}`, sdFdrCell(p.fx.fdr), `${p.own}%`]));
        md += `\n`;
    }
    if (rotationRisk.length) {
        md += `### Minutes not guaranteed\n\n`;
        md += sdTable(['Player', 'Team', 'Mins', 'Mins/GW', 'Owned', 'Status'],
            rotationRisk.map(p => [p.name, p.team, p.minutes, sdRound(p.minutes / rounds, 0), `${p.own}%`, p.news ? p.news.slice(0, 40) : 'Fit']));
        md += `\n`;
    }

    md += sdActions([
        lead ? { verdict: 'start', subject: `${lead.name} with the armband`, reason: `${lead.fx.opponent} ${lead.fx.home ? 'at home' : 'away'}, difficulty ${lead.fx.fdr}, ${lead.own}% owned.` } : null,
        differential[0] ? { verdict: 'watch', subject: `${differential[0].name} as the leveraged option`, reason: `${differential[0].own}% owned into a difficulty-${differential[0].fx.fdr} fixture.` } : null,
        hardFixture[0] ? { verdict: 'bench', subject: `${hardFixture[0].name}`, reason: `Difficulty ${hardFixture[0].fx.fdr} against ${hardFixture[0].fx.opponent}.` } : null,
        rotationRisk[0] ? { verdict: 'bench', subject: `${rotationRisk[0].name}`, reason: `${sdRound(rotationRisk[0].minutes / rounds, 0)} minutes a gameweek. Not a starter yet.` } : null
    ]);

    md += `> With ${rounds} gameweek${rounds === 1 ? '' : 's'} played, the points-per-gameweek column is a small sample. `;
    md += `The fixture column is not — the schedule is fixed and known, which is why it carries more weight this early in a season than form does.\n`;

    return {
        id: 'pre-deadline-captaincy',
        title: `Gameweek ${gw} Captaincy Matrix: the armband, the differentials, and the bench calls`,
        category: 'Strategy',
        icon: '👑',
        dek: `${lead ? lead.name : 'The template pick'} leads the captaincy matrix for Gameweek ${gw}${lead ? `, ${lead.fx.home ? 'at home to' : 'away at'} ${lead.fx.opponent}` : ''}. The differentials, the hard fixtures, and the players whose minutes are not safe.`,
        body: md,
        source: `Generated from the Gameweek ${gw} fixture list and current form`
    };
}

/* 3. Under the Hood — bi-weekly. Cross-sectional rather than longitudinal: it
   compares chances created against returns taken at a single point in time,
   which is a fair question to ask of a small sample as long as the copy does
   not dress the answer up as a trend. */
function sdGenUnderTheHood() {
    const rounds = Math.max(1, sdRoundsPlayed());
    const pool = sdPlayers()
        .filter(p => p.own < 10 && p.status === 'a' && p.minutes >= 45 * rounds && p.xGI > 0)
        .map(p => ({ ...p, ret: p.goals + p.assists, gap: p.xGI - (p.goals + p.assists) }))
        .sort((a, b) => b.gap - a.gap);
    if (pool.length < 3) return null;

    const waiting = pool.slice(0, 8);
    const converting = [...pool].sort((a, b) => a.gap - b.gap).slice(0, 6);
    const lead = waiting[0];

    let md = `## The gap between chances and goals\n\n`;
    md += `Expected goal involvements measure the positions a player gets into. Goals and assists measure what came of them. `;
    md += `When the first runs well ahead of the second, one of two things is true: the player has been unlucky, or he is not good enough to finish what he creates. `;
    md += `Over a long enough run it is almost always the first, which is why the gap is worth buying before it closes rather than after.\n\n`;

    md += sdTakeaways([
        `**${lead.name}** (${lead.own}% owned) has ${sdRound(lead.xGI)} expected involvements and ${lead.ret} actual.`,
        `Every player here is under 10% owned — the gap is only worth anything while the field has not noticed.`,
        `Based on ${rounds} gameweek${rounds === 1 ? '' : 's'} of data. Treat it as a watchlist, not a shopping list.`
    ]);

    md += `## Creating without converting\n\n`;
    md += sdTable(['Player', 'Team', 'Pos', 'Price', 'Owned', 'xGI', 'G+A', 'Waiting on', 'Mins'],
        waiting.map(p => [`**${p.name}**`, p.team, p.pos, `£${p.price.toFixed(1)}m`, `${p.own}%`,
            sdRound(p.xGI), p.ret, `**${sdRound(p.gap)}**`, p.minutes]));

    md += `\n### How to read this table\n\n`;
    md += `The "waiting on" column is expected involvements minus actual returns. A figure of 1.0 means a player has generated the chances for one more goal or assist than he has produced. `;
    md += `It is not a promise that the goal is coming — it is a statement that the chances are being created, which is the part of the process a player controls. `;
    md += `Finishing regresses toward the mean over a season; getting into the box does not.\n\n`;
    md += `Ownership matters here as much as the gap. A player at 30% ownership whose returns are lagging is a hold, not a buy — you already have him, and so does everybody you are competing with. `;
    md += `The same profile at 4% is a genuine edge, because you capture the correction and most of the field does not.\n\n`;

    waiting.slice(0, 5).forEach(p => {
        const strip = sdTeamFixtures(p.teamId, sdUpcomingGws(3))
            .map(f => ({ gw: `GW${f.gw}`, opponent: `${f.opponent} ${f.home ? '(H)' : '(A)'}`, difficulty: f.difficulty }));
        md += `### ${p.name} — ${p.team}, £${p.price.toFixed(1)}m, ${p.own}% owned\n\n`;
        md += `${sdRound(p.xGI)} expected involvements across ${p.minutes} minutes, with ${p.ret} to show for it. `;
        md += `His threat index sits at ${sdRound(p.threat || 0, 0)} and creativity at ${sdRound(p.creativity || 0, 0)}`;
        md += p.bonus > 0 ? `, and he has already picked up ${p.bonus} bonus point${p.bonus === 1 ? '' : 's'}` : ``;
        md += `.\n\n`;
        if (strip.length) md += sdFixtureStrip(strip);
    });

    // Position split — where the unconverted chances are concentrated.
    const byPos = ['DEF', 'MID', 'FWD'].map(pos => {
        const inPos = pool.filter(p => p.pos === pos);
        if (!inPos.length) return null;
        return { pos, n: inPos.length,
            gap: inPos.reduce((s, p) => s + p.gap, 0) / inPos.length,
            best: inPos.sort((a, b) => b.gap - a.gap)[0] };
    }).filter(Boolean);
    if (byPos.length) {
        md += `## Where the gap is concentrated\n\n`;
        md += `The same analysis by position, because the correction is worth different amounts depending on where a player lines up. `;
        md += `An unconverted chance is worth six points to a defender and four to a forward, and defenders carry clean-sheet points on top.\n\n`;
        md += sdTable(['Position', 'Players under 10% owned', 'Average gap', 'Widest gap'],
            byPos.map(x => [`**${x.pos}**`, x.n, sdRound(x.gap), `${x.best.name} (${sdRound(x.best.gap)})`]));
        md += `\n`;
    }

    if (converting.length) {
        md += `## Taking more than they create\n\n`;
        md += `The mirror image, and the more dangerous group to own. These players have converted above the rate their chances imply. `;
        md += `That is not an accusation — finishing is a real skill — but a player whose returns exceed his underlying numbers is priced on the returns, `;
        md += `and the underlying numbers are what continue.\n\n`;
        md += sdTable(['Player', 'Team', 'Price', 'Owned', 'xGI', 'G+A', 'Above expectation'],
            converting.map(p => [p.name, p.team, `£${p.price.toFixed(1)}m`, `${p.own}%`, sdRound(p.xGI), p.ret, `**+${sdRound(-p.gap)}**`]));
        md += `\n**${converting[0].name}** has returned ${sdRound(-converting[0].gap)} more than his chances imply. `;
        md += `That is not a sell signal on its own — a player who keeps getting into good positions will keep scoring even after the finishing cools — `;
        md += `but it does mean the price you are paying reflects the best case rather than the underlying case.\n\n`;
        const cStrip = sdTeamFixtures(converting[0].teamId, sdUpcomingGws(3))
            .map(f => ({ gw: `GW${f.gw}`, opponent: `${f.opponent} ${f.home ? '(H)' : '(A)'}`, difficulty: f.difficulty }));
        if (cStrip.length) md += sdFixtureStrip(cStrip);
    }

    md += `## The minutes question\n\n`;
    md += `Every name above is only worth anything if he keeps starting. A player creating chances from sixty minutes a week is a different proposition to one doing it from ninety, `;
    md += `and the low ownership that makes these players interesting is often low precisely because their place is not secure.\n\n`;
    md += sdTable(['Player', 'Team', 'Minutes', 'Mins per GW', 'Starts', 'Status'],
        waiting.slice(0, 6).map(p => [`**${p.name}**`, p.team, p.minutes, sdRound(p.minutes / rounds, 0),
            p.starts, p.status === 'a' ? 'Fit' : (p.news ? p.news.slice(0, 34) : 'Doubt')]));
    const nailed = waiting.filter(p => p.minutes / rounds >= 80);
    md += `\n${nailed.length} of these ${waiting.length} are playing 80 minutes or more a gameweek. `;
    md += `Those are the ones where the gap between chances and returns is a genuine buying opportunity; the rest are watchlist entries whose first requirement is a run in the side.\n\n`;

    md += sdCallout('data',
        `Expected goals is a model, not a measurement. It assigns every shot the conversion rate of an average player from that position, `
        + `which systematically undersells elite finishers and oversells poor ones. Read the gap as a question worth asking, not an answer.`);

    md += sdActions([
        ...waiting.slice(0, 2).map(p => ({ verdict: 'buy', subject: `${p.name} (${p.team}, £${p.price.toFixed(1)}m)`,
            reason: `${sdRound(p.gap)} expected involvements not yet converted, at ${p.own}% ownership.` })),
        converting[0] ? { verdict: 'watch', subject: `${converting[0].name} (£${converting[0].price.toFixed(1)}m)`,
            reason: `Returning ${sdRound(-converting[0].gap)} above what his chances imply. Priced on the returns.` } : null
    ]);

    return {
        id: 'under-the-hood',
        title: 'Under the Hood: the low-owned players creating chances without the returns',
        category: 'Data Deep-Dive',
        icon: '🎯',
        dek: `${lead.name} has ${sdRound(lead.xGI)} expected involvements and ${lead.ret} to show for it, on ${lead.own}% ownership. The gap between process and result is where differentials are found.`,
        body: md,
        source: `Generated from expected involvement against actual returns across ${rounds} gameweek${rounds === 1 ? '' : 's'}`
    };
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


/* 4. The Fixture Horizon — every two weeks. Entirely forward-looking, so it is
   as reliable in Gameweek 1 as in Gameweek 30: the schedule is published in
   full before a ball is kicked. */
function sdGenFixtureHorizon() {
    const gws = sdUpcomingGws(6);
    if (gws.length < 4) return null;
    const half = Math.floor(gws.length / 2);
    const teams = sdBoot?.teams || [];
    if (!teams.length) return null;

    const rows = teams.map(t => {
        const fx = sdTeamFixtures(t.id, gws);
        const avg = list => list.length ? list.reduce((s, f) => s + f.difficulty, 0) / list.length : null;
        const near = avg(fx.filter(f => gws.slice(0, half).includes(f.gw)));
        const far = avg(fx.filter(f => gws.slice(half).includes(f.gw)));
        const homes = fx.filter(f => f.home).length;
        if (near == null || far == null) return null;
        return { id: t.id, name: t.name, short: t.short_name, fx, near, far,
            swing: near - far, all: avg(fx), homes, games: fx.length };
    }).filter(Boolean);
    if (rows.length < 10) return null;

    const easing = [...rows].sort((a, b) => b.swing - a.swing).slice(0, 4);
    const hardening = [...rows].sort((a, b) => a.swing - b.swing).slice(0, 4);
    const kindest = [...rows].sort((a, b) => a.all - b.all).slice(0, 5);
    const harshest = [...rows].sort((a, b) => b.all - a.all).slice(0, 3);

    let md = `## The next six weeks\n\n`;
    md += `FPL is played in blocks, not in single weeks. The teams worth buying are rarely the ones with the best fixture on Saturday — `;
    md += `they are the ones whose schedule turns over the next month, bought before the turn rather than after it. `;
    md += `This is the run from Gameweek ${gws[0]} to Gameweek ${gws[gws.length - 1]}.\n\n`;

    md += sdTakeaways([
        `**${easing[0].name}** have the sharpest improvement: ${sdRound(easing[0].near, 1)} average difficulty becoming ${sdRound(easing[0].far, 1)}.`,
        `**${hardening[0].name}** go the other way — ${sdRound(hardening[0].near, 1)} becoming ${sdRound(hardening[0].far, 1)}.`,
        `**${kindest[0].name}** have the easiest six-week run overall at ${sdRound(kindest[0].all, 1)}.`
    ]);

    md += `## The full six-gameweek matrix\n\n`;
    md += `Every team, every fixture, coloured by FPL's own difficulty rating. Home fixtures are marked (H).\n\n`;
    const matrix = [...rows].sort((a, b) => a.all - b.all).map(t => {
        const cells = gws.map(g => {
            const f = t.fx.find(x => x.gw === g);
            return f ? `${f.opponent} ${f.home ? '(H)' : '(A)'}` : '—';
        });
        return [`**${t.short}**`, ...cells, sdFdrCell(t.all)];
    });
    md += sdTable(['Team', ...gws.map(g => `GW${g}`), 'Avg'], matrix);

    md += `\n## Schedules easing\n\n`;
    md += sdTable(['Team', `GW${gws[0]}–${gws[half - 1]}`, `GW${gws[half]}–${gws[gws.length - 1]}`, 'Swing', 'Home games'],
        easing.map(t => [`**${t.name}**`, sdFdrCell(t.near), sdFdrCell(t.far), `**−${sdRound(t.swing, 1)}**`, `${t.homes}/${t.games}`]));

    const e0 = easing[0];
    md += `\n**${e0.name}** have the sharpest turn: an average difficulty of ${sdRound(e0.near, 1)} across the first block against ${sdRound(e0.far, 1)} in the second. `;
    md += `Their run reads:\n\n`;
    md += sdFixtureStrip(e0.fx.map(f => ({ gw: `GW${f.gw}`, opponent: `${f.opponent} ${f.home ? '(H)' : '(A)'}`, difficulty: f.difficulty })));
    md += `The window to buy into a swing like that is while the hard fixtures are still being played, because that is when the price is still low `;
    md += `and the ownership has not moved.\n\n`;

    md += `## Schedules hardening\n\n`;
    md += sdTable(['Team', `GW${gws[0]}–${gws[half - 1]}`, `GW${gws[half]}–${gws[gws.length - 1]}`, 'Swing', 'Home games'],
        hardening.map(t => [`**${t.name}**`, sdFdrCell(t.near), sdFdrCell(t.far), `**+${sdRound(-t.swing, 1)}**`, `${t.homes}/${t.games}`]));

    const h0 = hardening[0];
    md += `\n**${h0.name}** go the other way:\n\n`;
    md += sdFixtureStrip(h0.fx.map(f => ({ gw: `GW${f.gw}`, opponent: `${f.opponent} ${f.home ? '(H)' : '(A)'}`, difficulty: f.difficulty })));
    md += `If you hold their assets, the exit window is now rather than in three weeks when the fixtures have turned and everybody is selling at once.\n\n`;

    md += `## Best and worst runs overall\n\n`;
    md += sdTable(['Team', 'Six-week average', 'Home games', 'Fixtures'],
        kindest.map(t => [`**${t.name}**`, sdFdrCell(t.all), `${t.homes}/${t.games}`,
            t.fx.map(f => `${f.opponent}${f.home ? '' : ' (A)'}`).join(', ')]));
    md += `\n**${kindest[0].name}** have the kindest overall run at ${sdRound(kindest[0].all, 1)}, with ${kindest[0].homes} of ${kindest[0].games} at home. `;
    md += `**${harshest[0].name}** have the hardest at ${sdRound(harshest[0].all, 1)}. `;
    md += `Home advantage is worth roughly a fifth of a goal in most models, which is small per match and considerable across six.\n\n`;

    // Schedule density: teams playing more or fewer than one game per gameweek.
    const doubles = rows.filter(t => t.games > gws.length);
    const blanks = rows.filter(t => t.games < gws.length);
    md += `## Schedule density\n\n`;
    if (doubles.length || blanks.length) {
        if (doubles.length) md += `${doubles.map(t => `**${t.name}**`).join(', ')} play more than one fixture in a gameweek in this window. `;
        if (blanks.length) md += `${blanks.map(t => `**${t.name}**`).join(', ')} have a gameweek without a fixture. `;
        md += `Both change the arithmetic considerably: a doubled asset is two chances at a return in one week, and a blank is a guaranteed zero from a starting slot.\n\n`;
    } else {
        md += `Every team plays exactly ${gws.length} fixtures across this window — no doubles, no blanks. `;
        md += `The schedule is even, so the fixture question here is purely about difficulty rather than volume.\n\n`;
    }

    md += `## Home and away\n\n`;
    md += `The same six fixtures are worth materially different amounts depending on where they are played. `;
    md += `Home advantage in the Premier League is worth somewhere around a fifth of a goal a game — small in isolation, and the difference between a good run and an ordinary one across a block.\n\n`;
    const homeHeavy = [...rows].sort((a, b) => b.homes - a.homes).slice(0, 4);
    const awayHeavy = [...rows].sort((a, b) => a.homes - b.homes).slice(0, 4);
    md += sdTable(['Team', 'Home fixtures', 'Away fixtures', 'Six-week difficulty'],
        homeHeavy.map(t => [`**${t.name}**`, t.homes, t.games - t.homes, sdFdrCell(t.all)]));
    md += `\n**${homeHeavy[0].name}** play ${homeHeavy[0].homes} of their ${homeHeavy[0].games} fixtures at home in this window. `;
    md += `At the other end, **${awayHeavy[0].name}** play only ${awayHeavy[0].homes}, which drags a schedule that looks fine on difficulty alone.\n\n`;

    md += `## The three sharpest turns\n\n`;
    easing.slice(0, 4).forEach(t => {
        md += `### ${t.name}\n\n`;
        md += `Difficulty of ${sdRound(t.near, 1)} across GW${gws[0]}–${gws[half - 1]} against ${sdRound(t.far, 1)} across GW${gws[half]}–${gws[gws.length - 1]}, `;
        md += `with ${t.homes} of ${t.games} at home.\n\n`;
        md += sdFixtureStrip(t.fx.map(f => ({ gw: `GW${f.gw}`, opponent: `${f.opponent} ${f.home ? '(H)' : '(A)'}`, difficulty: f.difficulty })));
    });

    md += sdActions([
        { verdict: 'buy', subject: `${easing[0].name} assets`, reason: `Difficulty falls from ${sdRound(easing[0].near, 1)} to ${sdRound(easing[0].far, 1)} across the window.` },
        { verdict: 'buy', subject: `${kindest[0].name} assets`, reason: `Kindest six-week run in the division at ${sdRound(kindest[0].all, 1)}, ${kindest[0].homes} of them at home.` },
        { verdict: 'sell', subject: `${hardening[0].name} assets`, reason: `Difficulty rises from ${sdRound(hardening[0].near, 1)} to ${sdRound(hardening[0].far, 1)}. Sell into the good run, not out of the bad one.` }
    ]);

    md += `## What a swing is worth by position\n\n`;
    md += `A fixture swing does not pay every position equally, which is why "buy the good fixtures" is incomplete advice.\n\n`;
    md += `- **Defenders and goalkeepers** gain the most. Clean sheets are close to binary and heavily fixture-dependent: a defender facing the weakest attacks in the division is a different asset to the same defender facing the strongest, and the four points arrive all at once.\n`;
    md += `- **Midfielders** gain least from easy fixtures and lose least from hard ones. Attacking returns are driven more by the player's own involvement than by the opponent, and the good ones create chances against anybody.\n`;
    md += `- **Forwards** sit in between, with one caveat: a poor team's forward in a good run is still a poor team's forward. Fixture swings amplify a team's attacking quality rather than substituting for it.\n\n`;
    md += `The practical version is that a defensive asset is worth buying **into** a swing and selling out of it, while a genuine premium attacker is usually worth holding through a hard run rather than transferring twice.\n\n`;

    md += sdCallout('warning',
        `Fixture difficulty is FPL's own rating, set before the season and only lightly revised. It knows nothing about injuries, form, or a manager change, `
        + `and it rates the badge rather than the team currently wearing it. Across a six-week block it is directionally right more often than not, which is the most that can be claimed for it.`);

    return {
        id: 'fixture-horizon',
        title: `The Fixture Horizon: who turns green through Gameweek ${gws[gws.length - 1]}`,
        category: 'Fixture Watch',
        icon: '📅',
        dek: `${easing[0].name} see their schedule ease sharply over the next six gameweeks while ${hardening[0].name} run into a wall. The full matrix, the swings, and where to buy before the turn.`,
        body: md,
        source: `Generated from fixture difficulty across GW${gws[0]}–GW${gws[gws.length - 1]}`
    };
}

/* 5. Market Volatility & Price Watch Digest — bi-weekly. Transfer velocity is
   published per gameweek and does not need a long season behind it, so this one
   is at full strength from the first deadline. */
function sdGenMarketDigest() {
    const players = sdPlayers();
    const total = sdBoot?.total_players || 0;
    if (!total) return null;

    const withPressure = players
        .filter(p => p.own > 0.3)
        .map(p => ({ ...p, net: p.tIn - p.tOut, owners: Math.max((p.own / 100) * total, 1) }))
        .map(p => ({ ...p, pressure: p.net / p.owners }));
    if (withPressure.length < 10) return null;

    const rising = [...withPressure].sort((a, b) => b.pressure - a.pressure).slice(0, 10);
    const falling = [...withPressure].sort((a, b) => a.pressure - b.pressure).slice(0, 10);
    const alreadyRisen = players.filter(p => p.costChange > 0).sort((a, b) => b.costChange - a.costChange).slice(0, 6);
    const alreadyFallen = players.filter(p => p.costChange < 0).sort((a, b) => a.costChange - b.costChange).slice(0, 6);
    const nextEv = sdEvent(sdNextGw());

    let md = `## How prices actually move\n\n`;
    md += `A player's price rises when enough managers buy him relative to how many already own him. `;
    md += `That last clause is what most price-watch coverage misses: a player owned by 300,000 managers needs a fraction of the buys that a player owned by four million does. `;
    md += `Raw transfer counts therefore mislead in both directions, and the useful figure is net transfers divided by the existing ownership base.\n\n`;

    md += sdTakeaways([
        `**${rising[0].name}** is under the heaviest buying pressure relative to his ownership.`,
        `**${falling[0].name}** is being sold hardest.`,
        nextEv && nextEv.transfers_made ? `**${nextEv.transfers_made.toLocaleString()}** transfers have been made ahead of the next deadline.` : null,
        alreadyRisen.length ? `**${alreadyRisen.length}** of the players tracked here have already risen this gameweek.` : null
    ]);

    md += `## Under buying pressure\n\n`;
    md += sdTable(['Player', 'Team', 'Price', 'Owned', 'Net transfers', 'Pressure'],
        rising.map(p => [`**${p.name}**`, p.team, `£${p.price.toFixed(1)}m`, `${p.own}%`,
            `**+${p.net.toLocaleString()}**`, sdRound(p.pressure * 100, 1) + '%']));
    md += `\n**${rising[0].name}** leads on pressure: ${rising[0].net.toLocaleString()} net transfers in against an ownership base of roughly ${Math.round(rising[0].owners).toLocaleString()} managers. `;
    md += `Buying before a rise is worth a tenth of a million, which is trivial on any single transfer and compounds into real squad value across a season.\n\n`;

    md += `## Being sold\n\n`;
    md += sdTable(['Player', 'Team', 'Price', 'Owned', 'Net transfers', 'Pressure'],
        falling.map(p => [`**${p.name}**`, p.team, `£${p.price.toFixed(1)}m`, `${p.own}%`,
            `**${p.net.toLocaleString()}**`, sdRound(p.pressure * 100, 1) + '%']));
    md += `\n**${falling[0].name}** is the heaviest sell. A falling price is only a problem if you intend to sell him: `;
    md += `the loss is realised at the point of transfer, not at the point of the drop, and panicking into a fall usually costs more than the fall did.\n\n`;

    if (alreadyRisen.length || alreadyFallen.length) {
        md += `## Already moved this gameweek\n\n`;
        if (alreadyRisen.length) {
            md += `### Risen\n\n`;
            md += sdTable(['Player', 'Team', 'New price', 'Change', 'Owned'],
                alreadyRisen.map(p => [p.name, p.team, `£${p.price.toFixed(1)}m`, `**+£${p.costChange.toFixed(1)}m**`, `${p.own}%`]));
        }
        if (alreadyFallen.length) {
            md += `\n### Fallen\n\n`;
            md += sdTable(['Player', 'Team', 'New price', 'Change', 'Owned'],
                alreadyFallen.map(p => [p.name, p.team, `£${p.price.toFixed(1)}m`, `**£${p.costChange.toFixed(1)}m**`, `${p.own}%`]));
        }
        md += `\n`;
    }

    md += `## The movers in detail\n\n`;
    rising.slice(0, 4).forEach(p => {
        const strip = sdTeamFixtures(p.teamId, sdUpcomingGws(3))
            .map(f => ({ gw: `GW${f.gw}`, opponent: `${f.opponent} ${f.home ? '(H)' : '(A)'}`, difficulty: f.difficulty }));
        md += `### ${p.name} — ${p.team}, £${p.price.toFixed(1)}m\n\n`;
        md += `${p.net.toLocaleString()} net transfers in against an ownership base of about ${Math.round(p.owners).toLocaleString()}. `;
        md += `He has ${p.points} points from ${p.minutes} minutes`;
        md += p.xGI > 0 ? ` on ${sdRound(p.xGI)} expected involvements` : ``;
        md += `, and the market has decided that is worth buying.\n\n`;
        if (strip.length) md += sdFixtureStrip(strip);
    });

    md += `## Squad value risk\n\n`;
    md += `Squad value is not a scoreboard. It is a constraint that decides which squads you can build later in the season, and it leaks quietly rather than dramatically. `;
    md += `The mechanism is worth stating precisely, because it is where most of the confusion lives.\n\n`;
    md += `When a player's price falls by a tenth, you lose a tenth of squad value immediately. When it rises by a tenth, you only bank half of the rise — `;
    md += `FPL charges 50% sell-on tax, rounded down. So a player bought at £7.0m who climbs to £7.4m sells for £7.2m, not £7.4m. `;
    md += `The asymmetry means falls cost you more than rises earn you, and it is why avoiding falls beats chasing rises as a strategy.\n\n`;

    md += `### The four rules that actually matter\n\n`;
    md += `- **Never make a transfer to catch a price rise.** A tenth of a million is worth roughly nothing; a wasted transfer is worth four points.\n`;
    md += `- **Never hold a player you have decided to sell.** The fall is already priced in by the time you notice it, and waiting only deepens it.\n`;
    md += `- **Buy early in the week when you are confident, late when you are not.** Information arrives across the week — press conferences, training reports. Trading a tenth for a team-news update is a good trade.\n`;
    md += `- **Ignore value entirely until the second half of the season.** It is a constraint that binds late, not a score that runs throughout.\n\n`;

    md += sdActions([
        { verdict: 'buy', subject: `${rising[0].name} (£${rising[0].price.toFixed(1)}m)`, reason: `${rising[0].net.toLocaleString()} net transfers in. If you want him, the cheap window is now.` },
        rising[1] ? { verdict: 'watch', subject: `${rising[1].name} (£${rising[1].price.toFixed(1)}m)`, reason: `${rising[1].net.toLocaleString()} net in and climbing.` } : null,
        { verdict: 'sell', subject: `${falling[0].name} (£${falling[0].price.toFixed(1)}m)`, reason: `${falling[0].net.toLocaleString()} net out. Only act if you were selling anyway — do not sell a player to save a tenth.` }
    ]);

    md += sdCallout('warning',
        `FPL does not publish its price-change thresholds, and never has. The pressure column above is a model built from net transfers against the ownership base, `
        + `not the real number, and it will be wrong at the margins. Nobody outside the game's developers knows the actual formula; anyone claiming otherwise has reverse-engineered an approximation too.`);

    return {
        id: 'market-digest',
        title: 'Market Watch: who is rising, who is being sold, and what it costs to be late',
        category: 'Market',
        icon: '📈',
        dek: `${rising[0].name} is under the heaviest buying pressure in the game and ${falling[0].name} is being sold hardest. Where the transfer market is heading before the prices catch up.`,
        body: md,
        source: `Generated from this gameweek's net transfers measured against ownership`
    };
}

/* 6. The Tactical Playbook — monthly. Built on chip usage figures FPL actually
   publishes and on the price/points distribution across the whole player pool,
   rather than on formation data, which the public API does not expose at all. */
function sdGenTacticalPlaybook() {
    const players = sdPlayers();
    const rounds = Math.max(1, sdRoundsPlayed());
    const total = sdBoot?.total_players || 0;
    if (!players.length) return null;

    // Real chip usage, summed across every gameweek that has reported.
    const chipTotals = {};
    (sdBoot?.events || []).forEach(e => (e.chip_plays || []).forEach(c => {
        chipTotals[c.chip_name] = (chipTotals[c.chip_name] || 0) + c.num_played;
    }));
    const chipRows = Object.entries(chipTotals).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);

    // Chip windows are published in bootstrap.
    const windows = (sdBoot?.chips || []).map(c => ({ name: SD_CHIP_NAME[c.name] || c.name, start: c.start_event, stop: c.stop_event }));

    let md = `## Structure beats selection\n\n`;
    md += `Most of the rank in FPL is decided by two things that have nothing to do with picking the right player in a given week: `;
    md += `how your budget is distributed across the squad, and when you play your chips. `;
    md += `Both are structural decisions, both are made rarely, and both are worth more thought than the weekly transfer that gets all the attention.\n\n`;

    md += sdTakeaways([
        chipRows.length ? `**${(chipTotals[chipRows[0][0]] || 0).toLocaleString()}** managers have played a ${SD_CHIP_NAME[chipRows[0][0]] || chipRows[0][0]} so far.` : null,
        `Points per million is the only currency that matters, and it is not evenly distributed across price brackets.`,
        `Chip windows are fixed and published — the first half's chips expire, they do not roll over.`
    ]);

    // ---- chips ----
    if (chipRows.length) {
        md += `## What the field has done with its chips\n\n`;
        md += `These are real counts published by FPL, not estimates.\n\n`;
        md += sdTable(['Chip', 'Times played', 'Share of the field'],
            chipRows.map(([name, n]) => [`**${SD_CHIP_NAME[name] || name}**`, n.toLocaleString(),
                total ? `${sdRound((n / total) * 100, 2)}%` : '—']));
        md += `\n`;
        md += sdCallout('tactical',
            `A chip played in the same gameweek as everybody else converts a good week into an average one relative to the field. `
            + `The Bench Boost that returns 18 points when 800,000 other managers also played theirs gains you almost nothing in rank. `
            + `Chips are worth most when your squad is ready for them, which is rarely the week the template says go.`);
    }

    // Per-chip strategy. Counts are real; the reasoning is the article.
    const chipPlan = [
        { key: 'bboost', heading: 'Bench Boost',
          what: `Scores your bench as well as your eleven, so it is worth exactly what your four worst players produce.`,
          how: `It is the chip most damaged by playing it on schedule. A bench of two £4.0m defenders who do not start is worth perhaps six points; a bench built deliberately over three or four weeks — four players who all start, ideally in a gameweek where some teams play twice — is worth twenty-five or more. `
             + `The chip does not create the value, the preparation does, and preparing costs transfers you have to plan for well in advance.` },
        { key: '3xc', heading: 'Triple Captain',
          what: `Trebles rather than doubles your captain, so it is worth one extra copy of whatever that player scores.`,
          how: `The expected gain is roughly the player's average return, which means it is worth far less than managers assume — a premium averaging seven returns about seven extra points on a normal week. `
             + `It is therefore a chip for a genuine outlier: a heavy favourite at home, ideally in a double gameweek, against a defence rated among the weakest in the division. Playing it on an ordinary week converts a rare resource into a routine one.` },
        { key: 'freehit', heading: 'Free Hit',
          what: `Gives you a completely different squad for one gameweek, then reverts everything.`,
          how: `Its highest use is a blank gameweek, where a normal squad might field seven players and a Free Hit squad fields eleven — that gap is worth more than any transfer strategy can recover. `
             + `Using it to chase a good set of fixtures in a full gameweek is almost always a waste, because the alternative use is worth so much more later.` },
        { key: 'wildcard', heading: 'Wildcard',
          what: `Unlimited transfers for one gameweek, permanently.`,
          how: `The mistake is playing it in response to a bad week rather than in anticipation of a fixture swing. A wildcard played to fix four problems buys you four transfers you would have made anyway over a month; `
             + `a wildcard played to pivot an entire squad onto a block of good fixtures buys you a structural advantage that compounds for six weeks.` }
    ].filter(cp => chipTotals[cp.key] !== undefined || cp.key === 'wildcard');

    if (chipPlan.length) {
        md += `## Chip by chip\n\n`;
        chipPlan.forEach(cp => {
            const played = chipTotals[cp.key] || 0;
            md += `### ${cp.heading}\n\n`;
            md += `${cp.what}`;
            md += played > 0
                ? ` **${played.toLocaleString()}** managers have played it so far${total ? `, ${sdRound((played / total) * 100, 2)}% of the field` : ''}.`
                : ` Nobody has played it yet this season.`;
            md += `\n\n${cp.how}\n\n`;
        });
    }

    if (windows.length) {
        md += `## The chip calendar\n\n`;
        md += `Each chip exists twice, once per half of the season, and the first-half version expires rather than rolling over. `;
        md += `That deadline is the single most common way managers waste a chip.\n\n`;
        md += sdTable(['Chip', 'Available from', 'Expires after'],
            windows.map(w => [`**${w.name}**`, `GW${w.start}`, `GW${w.stop}`]));
        md += `\n`;
    }

    // ---- budget distribution ----
    const bands = [
        { label: 'Budget (under £5.5m)', min: 0, max: 5.4 },
        { label: 'Mid (£5.5m–£7.4m)', min: 5.5, max: 7.4 },
        { label: 'Upper-mid (£7.5m–£9.4m)', min: 7.5, max: 9.4 },
        { label: 'Premium (£9.5m and up)', min: 9.5, max: 99 }
    ];
    const starters = players.filter(p => p.minutes >= 60 * rounds * 0.7);
    md += `## Where the value actually sits\n\n`;
    md += `Every squad is the same 100 million distributed differently. This is what each price bracket returns, `;
    md += `restricted to players who are actually starting — a bracket average that counts benchwarmers describes nothing you can buy.\n\n`;
    md += sdTable(['Price bracket', 'Starting players', 'Median points', 'Best', 'Points per £m'],
        bands.map(b => {
            const inBand = starters.filter(p => p.price >= b.min && p.price <= b.max).sort((x, y) => y.points - x.points);
            if (!inBand.length) return [b.label, '0', '—', '—', '—'];
            const median = inBand[Math.floor(inBand.length / 2)].points;
            const best = inBand[0];
            const ppm = inBand.reduce((s, p) => s + p.points / p.price, 0) / inBand.length;
            return [`**${b.label}**`, inBand.length, median, `${best.name} (${best.points})`, sdRound(ppm, 2)];
        }));

    const byPos = ['GK', 'DEF', 'MID', 'FWD'].map(pos => {
        const inPos = starters.filter(p => p.pos === pos).sort((a, b) => b.points - a.points);
        if (!inPos.length) return null;
        return { pos, n: inPos.length, best: inPos[0],
            ppm: inPos.reduce((s, p) => s + p.points / p.price, 0) / inPos.length,
            avgPrice: inPos.reduce((s, p) => s + p.price, 0) / inPos.length };
    }).filter(Boolean);

    if (byPos.length) {
        md += `\n## Value by position\n\n`;
        md += sdTable(['Position', 'Starters', 'Average price', 'Points per £m', 'Top scorer'],
            byPos.map(x => [`**${x.pos}**`, x.n, `£${sdRound(x.avgPrice, 1)}m`, sdRound(x.ppm, 2), `${x.best.name} (${x.best.points})`]));
        const bestValue = [...byPos].sort((a, b) => b.ppm - a.ppm)[0];
        md += `\n**${bestValue.pos}** currently offers the most points per million of any position at ${sdRound(bestValue.ppm, 2)}. `;
        md += `That is the argument for shape: if one position is returning more per pound than the others, the correct formation is the one that fields more of it, `;
        md += `and the transfer that matters is the one that moves budget into that bracket rather than sideways within it.\n\n`;
    }

    // The template: what the field actually owns.
    const template = players.filter(p => p.own >= 20).sort((a, b) => b.own - a.own).slice(0, 12);
    if (template.length) {
        md += `## The template\n\n`;
        md += `These are the players a fifth or more of the field owns. Every one of them is a decision you are making whether you think about it or not: `;
        md += `owning them is neutral, and not owning them is an active bet against that share of your competition every single gameweek.\n\n`;
        md += sdTable(['Player', 'Team', 'Pos', 'Price', 'Owned', 'Points'],
            template.map(p => [`**${p.name}**`, p.team, p.pos, `£${p.price.toFixed(1)}m`, `**${p.own}%**`, p.points]));
        const concentration = template.reduce((s, p) => s + p.own, 0);
        md += `\nThose ten players account for ${sdRound(concentration, 0)} percentage points of combined ownership. `;
        md += `A squad that owns all of them cannot lose ground to the field, and cannot gain any either. `;
        md += `The useful position is usually most of the template plus two or three genuine differentials — enough to move, not enough to be reckless.\n\n`;
    }

    // What a hit actually costs, priced against real per-gameweek returns.
    const avgReturn = starters.length
        ? starters.reduce((s, p) => s + p.points, 0) / starters.length / rounds : 0;
    md += `## What a hit actually costs\n\n`;
    md += `A transfer beyond your free one costs four points. That number only means something next to what a player actually returns, `;
    md += `and the starting players in this dataset are averaging ${sdRound(avgReturn, 1)} points a gameweek.\n\n`;
    md += `So a hit has to buy you roughly ${sdRound(4 / Math.max(avgReturn, 1), 1)} gameweeks' worth of an average player's output just to break even — `;
    md += `and it has to do it against the player you sold, not against nothing. The real comparison is the difference between two players over the weeks you will hold the new one, `;
    md += `which is why hits taken for a fixture swing tend to pay and hits taken to chase last week's haul tend not to.\n\n`;
    md += `- **One hit for a genuine upgrade held six weeks**: usually correct.\n`;
    md += `- **One hit to move sideways**: almost never correct.\n`;
    md += `- **Two hits in a week**: correct only when covering multiple injuries, and even then a wildcard is often the better answer.\n\n`;

    md += `## The constraint nobody designs around\n\n`;
    md += `Every squad is fifteen players: two goalkeepers, five defenders, five midfielders and three forwards, with at most three from any one club. `;
    md += `Only eleven of them score in a normal week. That means four squad slots exist purely to be legal, and how much you spend on them is one of the few genuinely free decisions in the game.\n\n`;
    md += `The second goalkeeper is the clearest example. He plays roughly never outside a Bench Boost, and every tenth of a million spent on him is a tenth not spent on a starter. `;
    md += `The same logic applies to the fifth defender and the third forward: unless you intend to rotate them, they are budget storage rather than assets.\n\n`;
    md += `The three-per-club limit binds more often than managers expect, particularly when one team's fixtures turn. `;
    md += `If a team has four players worth owning, you must choose, and the right choice is usually the one with the most secure minutes rather than the highest ceiling.\n\n`;

    md += `## Structuring the squad\n\n`;
    md += `- **One premium, budget spread elsewhere.** Frees roughly £5m across two mid-price slots. Works when the mid bracket is deep, which the table above will tell you.\n`;
    md += `- **Two premiums.** Forces genuine £4.0m players into defence. Viable only when the cheap defenders are playing ninety minutes rather than sitting on benches.\n`;
    md += `- **No premium.** Rarely correct, because the most-owned premium sets the score the whole field is measured against, and not owning him is a bet you take every single week rather than once.\n\n`;

    md += sdActions([
        chipRows.length ? { verdict: 'watch', subject: `Chip timing`, reason: `${(chipTotals[chipRows[0][0]] || 0).toLocaleString()} managers have already used their ${SD_CHIP_NAME[chipRows[0][0]] || chipRows[0][0]}. Being late is usually better than being with the crowd.` } : null,
        byPos.length ? { verdict: 'buy', subject: `Budget into ${[...byPos].sort((a, b) => b.ppm - a.ppm)[0].pos}`, reason: `Best points per million of any position right now.` } : null,
        { verdict: 'hold', subject: `Your structure`, reason: `Reshaping a squad mid-season costs points in hits. Decide the shape once and transfer within it.` }
    ]);

    md += `> With ${rounds} gameweek${rounds === 1 ? '' : 's'} played, the points-per-million figures are an early read rather than a settled one. `;
    md += `The chip counts and the chip calendar are not estimates — those are published figures and hold regardless of how much football has been played.\n`;

    return {
        id: 'tactical-playbook',
        title: 'The Tactical Playbook: chip timing, budget structure, and where the value sits',
        category: 'Tactical',
        icon: '🧠',
        dek: `${chipRows.length ? `${(chipTotals[chipRows[0][0]] || 0).toLocaleString()} managers have already played a ${SD_CHIP_NAME[chipRows[0][0]] || chipRows[0][0]}. ` : ''}The structural decisions — chips and budget distribution — decide more rank than the weekly transfer does.`,
        body: md,
        source: `Generated from published chip usage and the current price and points distribution`
    };
}

const SD_RECURRING = [
    { key: 'gw-debrief', label: 'The Gameweek Debrief', cadence: 'Weekly', gen: sdGenGameweekDebrief },
    { key: 'pre-deadline-captaincy', label: 'Captaincy Matrix', cadence: 'Weekly', gen: sdGenPreDeadlineCaptaincy },
    { key: 'under-the-hood', label: 'Under the Hood', cadence: 'Every 2 weeks', gen: sdGenUnderTheHood },
    { key: 'fixture-horizon', label: 'The Fixture Horizon', cadence: 'Every 2 weeks', gen: sdGenFixtureHorizon },
    { key: 'market-digest', label: 'Market Watch', cadence: 'Every 2 weeks', gen: sdGenMarketDigest },
    { key: 'tactical-playbook', label: 'The Tactical Playbook', cadence: 'Monthly', gen: sdGenTacticalPlaybook }
];


// ---------- markdown ----------
// A deliberately small subset: headings, bold, blockquote, tables, lists,
// paragraphs. Everything is HTML-escaped BEFORE any markup is applied, so a
// player name containing a bracket can never become markup — the content is
// generated, but it is generated from a third-party feed and treated as untrusted.
function sdMarkdown(md) {
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    // Difficulty pills are re-emitted from a parsed number, so the only thing
    // that can reach the class attribute is an integer this function chose.
    const fdrPill = s => s.replace(/\{fdr:([\d.]+)\}/g, (_, n) => {
        const v = parseFloat(n) || 0;
        const band = Math.max(1, Math.min(5, Math.round(v)));
        return `<span class="fdr-pill fdr-${band}">${v.toFixed(1)}</span>`;
    });
    const inline = s => fdrPill(esc(s)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`(.+?)`/g, '<code>$1</code>'));

    const ACTION = {
        buy:  { cls: 'action-buy',  dot: '\u{1F7E2}', word: 'BUY' },
        hold: { cls: 'action-hold', dot: '\u{1F7E1}', word: 'HOLD' },
        sell: { cls: 'action-sell', dot: '\u{1F534}', word: 'SELL' },
        start:{ cls: 'action-buy',  dot: '\u{1F7E2}', word: 'START' },
        bench:{ cls: 'action-sell', dot: '\u{1F534}', word: 'BENCH' },
        watch:{ cls: 'action-hold', dot: '\u{1F7E1}', word: 'WATCH' }
    };

    // Directive blocks. The renderer owns every tag and class here; the block
    // body only ever supplies text, which still goes through inline().
    function directive(kind, variant, body) {
        if (kind === 'callout') {
            const label = SD_CALLOUT_LABEL[variant] ? variant : 'insight';
            const paras = body.join('\n').split(/\n\s*\n/).filter(t => t.trim());
            return `<aside class="scout-callout scout-callout-${label}">`
                + `<div class="callout-header">${inline(SD_CALLOUT_LABEL[label])}</div>`
                + paras.map(t => `<p>${inline(t.replace(/\n/g, ' ').trim())}</p>`).join('')
                + `</aside>`;
        }
        if (kind === 'actions') {
            const cards = body.map(line => {
                const [verdictRaw, subject, ...rest] = line.split('|');
                const a = ACTION[(verdictRaw || '').trim().toLowerCase()];
                if (!a || !subject) return '';
                return `<div class="action-card ${a.cls}"><span class="action-dot">${a.dot}</span>`
                    + `<div><strong>${a.word}:</strong> ${inline(subject.trim())}`
                    + (rest.length ? `<span class="action-why">${inline(rest.join('|').trim())}</span>` : '')
                    + `</div></div>`;
            }).join('');
            return cards ? `<div class="article-action-grid">${cards}</div>` : '';
        }
        if (kind === 'takeaways') {
            const items = body.filter(l => /^-\s/.test(l)).map(l => `<li>${inline(l.replace(/^-\s/, ''))}</li>`).join('');
            return items ? `<aside class="article-takeaways"><div class="callout-header">\u{1F5DE}️ The short version</div><ul>${items}</ul></aside>` : '';
        }
        if (kind === 'fixtures') {
            const cells = body.map(line => {
                const [gw, opp, diff] = line.split('|').map(s => (s || '').trim());
                if (!gw || !opp) return '';
                const band = Math.max(1, Math.min(5, Math.round(parseFloat(diff) || 3)));
                return `<span class="fixture-chip-strip fdr-${band}"><small>${inline(gw)}</small>${inline(opp)}</span>`;
            }).join('');
            return cells ? `<div class="article-fixture-strip">${cells}</div>` : '';
        }
        return '';
    }

    const lines = md.split('\n');
    let html = '', i = 0;

    while (i < lines.length) {
        const line = lines[i];

        if (/^\s*$/.test(line)) { i++; continue; }

        if (/^:::/.test(line)) {
            const m = /^:::\s*([a-z]+)(?:\s+([a-z]+))?/i.exec(line);
            i++;
            const inner = [];
            while (i < lines.length && !/^:::\s*$/.test(lines[i])) { inner.push(lines[i]); i++; }
            i++; // closing fence
            if (m) html += directive(m[1].toLowerCase(), (m[2] || '').toLowerCase(), inner);
            continue;
        }

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
            html += `<div class="sd-table-wrap article-table-wrapper"><table class="sd-table article-data-table"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>`
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
        while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^[#>|]|^[-*]\s|^:::/.test(lines[i])) { para.push(lines[i]); i++; }
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
    art.words = sdWordCount(art.body);
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
                sdGenPreDeadlineCaptaincy(),
                sdGenUnderTheHood(),
                sdGenFixtureHorizon(),
                sdGenMarketDigest(),
                sdGenTacticalPlaybook(),
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
    // Staggered so no single gameweek has to carry every format at once.
    if (gw % 2 === 1) due.push({ key: 'under-the-hood', gen: sdGenUnderTheHood });
    if (gw % 2 === 0) due.push({ key: 'fixture-horizon', gen: sdGenFixtureHorizon });
    if (gw % 2 === 1) due.push({ key: 'market-digest', gen: sdGenMarketDigest });
    if (gw % 4 === 2) due.push({ key: 'tactical-playbook', gen: sdGenTacticalPlaybook });
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
        art.words = sdWordCount(art.body);
        art.readTime = sdReadTime(art.body);
        art.gw = dated ? gw : null;
        out.push(art);
    };

    if (gw > 0) {
        // Weekly: the round just played, and the deadline coming up.
        push(sdGenGameweekDebrief(), `gameweek-${gw}-debrief`, true);
        push(sdGenPreDeadlineCaptaincy(), `gameweek-${sdNextGw()}-captaincy-matrix`, true);
        // Everything else runs to its own cadence.
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
        sdSetData, sdBuildArchive, sdMarkdown, sdReadTime, sdWordCount, sdLastRound,
        sdRoundsPlayed, sdSlugify, sdRecurringDue, sdNextGw
    };
}
