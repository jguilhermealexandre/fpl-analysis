// Season Vault — private prediction-league scoring
//
// Each friend predicted the full final PL table order before the season
// started (data/predictions.json). Every load, we score that prediction
// against the REAL current table in data/bootstrap-static.json (already
// refreshed every 4h by the site's existing GitHub Action — no new data
// source needed here). Scoring: 20 points per team for an exact position
// match, minus 1 per position off (min 0), summed across 20 teams = 400 max.

const PREDICTIONS_URL = 'data/predictions.json';

// Casual/alternate labels a friend might type in a CSV, mapped to short_name.
const TEAM_ALIASES = {
    'spurs': 'TOT', 'tottenham': 'TOT', 'tottenhamhotspur': 'TOT',
    'manutd': 'MUN', 'manchesterunited': 'MUN', 'united': 'MUN',
    'mancity': 'MCI', 'manchestercity': 'MCI', 'city': 'MCI',
    'forest': 'NFO', 'nottinghamforest': 'NFO', 'nottmforest': 'NFO',
    'brighton': 'BHA', 'brightonhovealbion': 'BHA',
    'villa': 'AVL', 'astonvilla': 'AVL',
    'palace': 'CRY', 'crystalpalace': 'CRY',
    'wolves': 'WOL', 'wolverhampton': 'WOL', 'wolverhamptonwanderers': 'WOL',
    'westham': 'WHU', 'hammers': 'WHU',
    'leeds': 'LEE', 'leedsunited': 'LEE',
    'hull': 'HUL', 'hullcity': 'HUL',
    'ipswich': 'IPS', 'ipswichtown': 'IPS',
    'coventry': 'COV', 'coventrycity': 'COV',
    'sunderland': 'SUN',
    'bournemouth': 'BOU', 'afcbournemouth': 'BOU',
    'brentford': 'BRE',
    'chelsea': 'CHE',
    'arsenal': 'ARS',
    'liverpool': 'LIV',
    'newcastle': 'NEW', 'newcastleunited': 'NEW',
    'fulham': 'FUL',
    'everton': 'EVE',
};

function normalizeLabel(s) {
    return String(s).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildTeamIndex(teams) {
    const idx = {};
    teams.forEach(team => {
        idx[normalizeLabel(team.short_name)] = team;
        idx[normalizeLabel(team.name)] = team;
    });
    Object.keys(TEAM_ALIASES).forEach(alias => {
        const shortName = TEAM_ALIASES[alias];
        const team = idx[normalizeLabel(shortName)];
        if (team) idx[alias] = team;
    });
    return idx;
}

function matchTeam(label, teamIndex, unmatched) {
    const team = teamIndex[normalizeLabel(label)];
    if (!team) {
        unmatched.push(label);
        return null;
    }
    return team;
}

// Diff (0-19) -> FDR-style bucket (1 = nailed it, 5 = way off), reusing the
// site's existing --fdr-1..5 color scale instead of inventing a new one.
function diffToFdrBucket(diff) {
    if (diff <= 1) return 1;
    if (diff <= 4) return 2;
    if (diff <= 7) return 3;
    if (diff <= 11) return 4;
    return 5;
}

function scoreFriend(friend, teamIndex, isLive) {
    let total = 0;
    let perfectPicks = 0;
    const rows = [];
    const unmatched = [];

    friend.predictions.forEach((label, i) => {
        const predictedPosition = i + 1;
        const team = matchTeam(label, teamIndex, unmatched);
        if (!team) {
            rows.push({ label, unmatched: true });
            return;
        }
        if (!isLive || !team.position) {
            rows.push({ team, predictedPosition, actualPosition: null, diff: null, points: null });
            return;
        }
        const actualPosition = team.position;
        const diff = Math.abs(predictedPosition - actualPosition);
        const points = Math.max(0, 20 - diff);
        total += points;
        if (diff === 0) perfectPicks += 1;
        rows.push({ team, predictedPosition, actualPosition, diff, points, fdrBucket: diffToFdrBucket(diff) });
    });

    return { name: friend.name, total, maxPossible: 20 * 20, perfectPicks, rows, unmatched };
}

function computeCrowdRow(scoredFriends, teamIndex, isLive) {
    // Average predicted position per team across all friends, scored the
    // same way as an individual — "does the group beat any one person?"
    const teamCount = Object.keys(teamIndex).length ? null : null;
    const positionSums = {};
    const positionCounts = {};

    scoredFriends.forEach(f => {
        f.rows.forEach(r => {
            if (r.unmatched || !r.team) return;
            const id = r.team.id;
            positionSums[id] = (positionSums[id] || 0) + r.predictedPosition;
            positionCounts[id] = (positionCounts[id] || 0) + 1;
        });
    });

    const avgPredictions = Object.keys(positionSums)
        .map(id => ({ id: Number(id), avgPosition: positionSums[id] / positionCounts[id] }))
        .sort((a, b) => a.avgPosition - b.avgPosition);

    const idToTeam = {};
    scoredFriends.forEach(f => f.rows.forEach(r => { if (r.team) idToTeam[r.team.id] = r.team; }));

    let total = 0;
    let perfectPicks = 0;
    const rows = avgPredictions.map((entry, i) => {
        const predictedPosition = i + 1;
        const team = idToTeam[entry.id];
        if (!isLive || !team.position) {
            return { team, predictedPosition, actualPosition: null, diff: null, points: null };
        }
        const actualPosition = team.position;
        const diff = Math.abs(predictedPosition - actualPosition);
        const points = Math.max(0, 20 - diff);
        total += points;
        if (diff === 0) perfectPicks += 1;
        return { team, predictedPosition, actualPosition, diff, points, fdrBucket: diffToFdrBucket(diff) };
    });

    return { name: 'Crowd Wisdom', total, maxPossible: 20 * 20, perfectPicks, rows, unmatched: [], isCrowd: true };
}

function computeHardestTeams(scoredFriends) {
    const errorSums = {};
    const errorCounts = {};
    const idToTeam = {};

    scoredFriends.forEach(f => {
        f.rows.forEach(r => {
            if (r.unmatched || !r.team || r.diff === null) return;
            const id = r.team.id;
            errorSums[id] = (errorSums[id] || 0) + r.diff;
            errorCounts[id] = (errorCounts[id] || 0) + 1;
            idToTeam[id] = r.team;
        });
    });

    return Object.keys(errorSums)
        .map(id => ({ team: idToTeam[id], avgError: errorSums[id] / errorCounts[id] }))
        .sort((a, b) => b.avgError - a.avgError);
}

function teamBadge(team, size) {
    size = size || 20;
    return `<img src="https://resources.premierleague.com/premierleague/badges/50/t${team.code}.png"
        alt="" width="${size}" height="${size}" style="vertical-align:middle;border-radius:3px;"
        onerror="this.style.display='none'">`;
}

function medalFor(rank) {
    if (rank === 1) return '<i data-lucide="trophy" style="width:16px;height:16px;color:#F59E0B;"></i>';
    if (rank === 2) return '<i data-lucide="medal" style="width:16px;height:16px;color:#9CA3AF;"></i>';
    if (rank === 3) return '<i data-lucide="medal" style="width:16px;height:16px;color:#B45309;"></i>';
    return `<span class="sv-rank-num">${rank}</span>`;
}

function renderLeaderboard(scoredFriends, crowdRow, isLive) {
    const all = [...scoredFriends].sort((a, b) => b.total - a.total);
    const leaderScore = all.length ? all[0].total : 0;

    const rowsHtml = all.map((f, i) => {
        const rank = i + 1;
        const pct = isLive ? Math.round((f.total / f.maxPossible) * 100) : 0;
        const behind = isLive ? leaderScore - f.total : null;
        return `
        <div class="sv-leader-row">
            <div class="sv-leader-rank">${medalFor(rank)}</div>
            <div class="sv-leader-name">${escHTML(f.name)}</div>
            <div class="sv-leader-bar-wrap">
                <div class="sv-leader-bar" style="width:${pct}%"></div>
            </div>
            <div class="sv-leader-score">${isLive ? f.total : '—'}<span class="sv-leader-max">/${f.maxPossible}</span></div>
            <div class="sv-leader-meta">${isLive ? (rank === 1 ? 'Leader' : `-${behind} pts`) : ''}</div>
            <div class="sv-leader-perfect">${f.perfectPicks} <i data-lucide="check-circle" style="width:12px;height:12px;"></i></div>
        </div>`;
    }).join('');

    const crowdHtml = crowdRow ? `
        <div class="sv-leader-row sv-leader-row-crowd">
            <div class="sv-leader-rank"><i data-lucide="users" style="width:16px;height:16px;color:var(--color-predictions);"></i></div>
            <div class="sv-leader-name">${escHTML(crowdRow.name)}</div>
            <div class="sv-leader-bar-wrap">
                <div class="sv-leader-bar sv-leader-bar-crowd" style="width:${isLive ? Math.round((crowdRow.total / crowdRow.maxPossible) * 100) : 0}%"></div>
            </div>
            <div class="sv-leader-score">${isLive ? crowdRow.total : '—'}<span class="sv-leader-max">/${crowdRow.maxPossible}</span></div>
            <div class="sv-leader-meta">avg of all picks</div>
            <div class="sv-leader-perfect">${crowdRow.perfectPicks} <i data-lucide="check-circle" style="width:12px;height:12px;"></i></div>
        </div>` : '';

    return `<div class="sv-leaderboard">${rowsHtml}</div>${crowdHtml}`;
}

function renderRealTable(teams, isLive) {
    const sorted = [...teams].sort((a, b) => (isLive ? a.position - b.position : a.name.localeCompare(b.name)));
    const rows = sorted.map(t => `
        <tr>
            <td class="sv-pos">${isLive ? t.position : '—'}</td>
            <td class="sv-team-cell">${teamBadge(t)} ${escHTML(t.name)}</td>
            <td>${isLive ? t.played : '—'}</td>
            <td>${isLive ? t.win : '—'}</td>
            <td>${isLive ? t.draw : '—'}</td>
            <td>${isLive ? t.loss : '—'}</td>
            <td class="sv-points">${isLive ? t.points : '—'}</td>
        </tr>`).join('');

    return `
    <table class="sv-real-table">
        <thead><tr><th>Pos</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>Pts</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>`;
}

function renderHardestTeams(hardestTeams, isLive) {
    if (!isLive) return renderEmptyState('Not live yet', 'This shows up once real match results start coming in.', 'help-circle');
    const top = hardestTeams.slice(0, 5);
    if (!top.length) return renderEmptyState('No data', 'No predictions to compare yet.', 'help-circle');
    const maxErr = Math.max(...top.map(t => t.avgError), 1);
    const rows = top.map(t => `
        <div class="sv-hard-row">
            <div class="sv-hard-team">${teamBadge(t.team)} ${escHTML(t.team.name)}</div>
            <div class="sv-hard-bar-wrap"><div class="sv-hard-bar" style="width:${Math.round((t.avgError / maxErr) * 100)}%"></div></div>
            <div class="sv-hard-value">${t.avgError.toFixed(1)} avg off</div>
        </div>`).join('');
    return `<div class="sv-hard-list">${rows}</div>`;
}

function renderHeatmap(scoredFriends, teams, isLive) {
    if (!isLive) return renderEmptyState('Not live yet', 'The confidence heatmap fills in once the real table has positions.', 'grid-3x3');

    // Column order = current real table order, so the heatmap reads left-to-right as 1st -> 20th.
    const orderedTeams = [...teams].sort((a, b) => a.position - b.position);
    const idToTeam = {};
    orderedTeams.forEach(t => { idToTeam[t.id] = t; });

    const headerCells = orderedTeams.map(t => `<th title="${escHTML(t.name)}">${teamBadge(t, 18)}</th>`).join('');

    const bodyRows = scoredFriends.map(f => {
        const byTeamId = {};
        f.rows.forEach(r => { if (r.team) byTeamId[r.team.id] = r; });
        const cells = orderedTeams.map(t => {
            const r = byTeamId[t.id];
            if (!r || r.diff === null) return '<td class="sv-heat-cell fdr-3">-</td>';
            return `<td class="sv-heat-cell fdr-${r.fdrBucket}" title="${escHTML(f.name)} predicted #${r.predictedPosition}, actual #${r.actualPosition}">${r.diff}</td>`;
        }).join('');
        return `<tr><td class="sv-heat-name">${escHTML(f.name)}</td>${cells}</tr>`;
    }).join('');

    return `
    <div class="sv-heatmap-scroll">
        <table class="sv-heatmap">
            <thead><tr><th></th>${headerCells}</tr></thead>
            <tbody>${bodyRows}</tbody>
        </table>
    </div>
    <div class="sv-heatmap-legend">
        <span class="sv-heat-cell fdr-1" style="width:14px;height:14px;display:inline-block;border-radius:3px;"></span> nailed it
        <span class="sv-heat-cell fdr-3" style="width:14px;height:14px;display:inline-block;border-radius:3px;margin-left:10px;"></span> off a bit
        <span class="sv-heat-cell fdr-5" style="width:14px;height:14px;display:inline-block;border-radius:3px;margin-left:10px;"></span> way off
    </div>`;
}

async function initSeasonVault() {
    createSkeletonCards(6, 'sv-skeleton');

    try {
        const [predictions, bootstrap] = await Promise.all([
            fetch(PREDICTIONS_URL).then(r => { if (!r.ok) throw new Error('predictions unavailable'); return r.json(); }),
            DataCache.fetchJSON(DATA_URLS.bootstrap),
        ]);

        removeSkeletons('sv-skeleton');

        const isLive = !bootstrap.events.every(e => !e.finished);
        const teamIndex = buildTeamIndex(bootstrap.teams);

        const scoredFriends = predictions.friends.map(f => scoreFriend(f, teamIndex, isLive));
        const crowdRow = computeCrowdRow(scoredFriends, teamIndex, isLive);
        const hardestTeams = computeHardestTeams(scoredFriends);

        const allUnmatched = scoredFriends.flatMap(f => f.unmatched.map(label => `${f.name}: "${label}"`));

        document.getElementById('sv-notice').innerHTML = isLive ? '' :
            renderSeasonNotice(`Standings for ${escHTML(predictions.season)} aren't live yet — scores will populate automatically once real match results start coming in.`);

        if (allUnmatched.length) {
            document.getElementById('sv-warning').innerHTML = `<div class="sv-unmatched-warning">
                <i data-lucide="alert-triangle" style="width:14px;height:14px;"></i>
                Couldn't match ${allUnmatched.length} prediction(s): ${escHTML(allUnmatched.join(', '))}
            </div>`;
        }

        document.getElementById('sv-leaderboard').innerHTML = renderLeaderboard(scoredFriends, crowdRow, isLive);
        document.getElementById('sv-real-table').innerHTML = renderRealTable(bootstrap.teams, isLive);
        document.getElementById('sv-hardest').innerHTML = renderHardestTeams(hardestTeams, isLive);
        document.getElementById('sv-heatmap').innerHTML = renderHeatmap(scoredFriends, bootstrap.teams, isLive);

        initIcons();
    } catch (err) {
        console.error('Season Vault failed to load:', err);
        removeSkeletons('sv-skeleton');
        document.getElementById('sv-leaderboard').innerHTML =
            renderErrorState('Couldn’t load the vault', 'Something went wrong loading predictions or standings data.', null);
    }
}

document.addEventListener('DOMContentLoaded', initSeasonVault);
