// Shared team-name matching — used by Season Vault (scoring) and the
// predictions submission page (parsing a friend's typed/pasted team list).
// Tolerates casual names ("Spurs", "Man Utd") against the real team list
// already fetched from data/bootstrap-static.json — never hardcode teams.

const TEAM_ALIASES = {
    'spurs': 'TOT', 'tottenham': 'TOT', 'tottenhamhotspur': 'TOT',
    'manutd': 'MUN', 'manchesterunited': 'MUN', 'united': 'MUN',
    'mancity': 'MCI', 'manchestercity': 'MCI', 'city': 'MCI',
    'forest': 'NFO', 'nottinghamforest': 'NFO', 'nottmforest': 'NFO', 'nottmforrest': 'NFO', 'nottinghamforrest': 'NFO',
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
        if (unmatched) unmatched.push(label);
        return null;
    }
    return team;
}

function teamBadge(team, size) {
    size = size || 20;
    return `<img src="https://resources.premierleague.com/premierleague/badges/50/t${team.code}.png"
        alt="" width="${size}" height="${size}" style="vertical-align:middle;border-radius:3px;"
        onerror="this.style.display='none'">`;
}
