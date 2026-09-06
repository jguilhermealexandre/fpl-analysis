// ============================================
// TABLES
// ============================================
// ============================================
// TABLES - Advanced Implementation
// ============================================
let tableData = {};
let tableState = {
    GK: { sort: 'pts', sortDir: 'desc', filters: {}, visibleCols: [], search: '', page: 1 },
    DEF: { sort: 'pts', sortDir: 'desc', filters: {}, visibleCols: [], search: '', page: 1 },
    MID: { sort: 'pts', sortDir: 'desc', filters: {}, visibleCols: [], search: '', page: 1 },
    FWD: { sort: 'pts', sortDir: 'desc', filters: {}, visibleCols: [], search: '', page: 1 },
    ALL: { sort: 'pts', sortDir: 'desc', filters: { teams: new Set() }, visibleCols: [], search: '', page: 1, positionFilter: 'ALL', timeframe: 'l5' }
};
const ROWS_PER_PAGE_DEFAULT = 25;
const ROWS_PER_PAGE_ALL = 50;
function getRowsPerPage(position) { return position === 'ALL' ? ROWS_PER_PAGE_ALL : ROWS_PER_PAGE_DEFAULT; }

// Compare functionality: compareList/MAX_COMPARE/toggleComparePlayer/removeFromCompare/
// clearCompare/updateCompareBar now live in scripts/compare-report.js (shared with My Team).
// onCompareCheckboxChange()/onCompareSelectionChange() below are this page's hooks into it.

// Column definitions with metadata - ALL metrics from original
const COLUMN_DEFS = {
    // Core
    player: { label: 'Player', key: 'name', sortable: true, always: true, tip: 'Player name' },
    pos: { label: 'Pos', key: 'posName', sortable: true, tip: 'Position' },
    team: { label: 'Team', key: 'team', sortable: true, tip: 'Team' },
    price: { label: 'Price', key: 'price', sortable: true, format: v => `£${v.toFixed(1)}m`, tip: 'Current price' },
    own: { label: 'Own%', key: 'selectedBy', sortable: true, format: v => v.toFixed(1) + '%', tip: 'Ownership percentage' },
    
    // Gametime
    games: { label: 'GP', key: 'l5.games', sortable: true, tip: 'Games played (L5)' },
    mins: { label: 'Mins', key: 'l5.minutes', sortable: true, tip: 'Total minutes (L5)' },
    minsG: { label: 'Mins/G', key: 'minsPerGame', sortable: true, format: v => v.toFixed(0), tip: 'Minutes per game', highlight: v => v >= 80 ? 'good' : v >= 60 ? '' : 'bad' },
    
    // Points
    pts: { label: 'Pts', key: 'l5.points', sortable: true, tip: 'Total points (L5)' },
    ptsG: { label: 'Pts/G', key: 'ptsPerGame', sortable: true, format: v => v.toFixed(1), tip: 'Points per game', highlight: v => v >= 5 ? 'good' : v >= 3 ? '' : 'bad' },
    form: { label: 'Form', key: 'form', sortable: true, format: v => v.toFixed(1), tip: 'FPL form rating', highlight: v => v >= 6 ? 'good' : v >= 4 ? '' : 'bad' },
    seasonPts: { label: 'Pts (S)', key: 'season.points', sortable: true, tip: 'Total season points' },
    seasonPtsG: { label: 'Pts/G (S)', key: 'seasonPtsPerGame', sortable: true, format: v => v.toFixed(1), tip: 'Season points per game' },
    value: { label: 'Value', key: 'valueScore', sortable: true, format: v => v.toFixed(2), tip: 'Points per million', highlight: v => v >= 0.8 ? 'good' : '' },
    
    // Goals
    goals: { label: 'G', key: 'l5.goals', sortable: true, tip: 'Goals scored (L5)' },
    xG: { label: 'xG', key: 'l5.xG', sortable: true, format: v => v.toFixed(2), tip: 'Expected goals (L5)', term: 'xG' },
    xGG: { label: 'xG/G', key: 'xgPerGame', sortable: true, format: v => v.toFixed(2), tip: 'xG per game' },
    bcm: { label: 'BCM', key: 'l5.bigChancesMissed', sortable: true, tip: 'Big chances missed (L5). Null = estimated from xG', estimated: '_bigChancesMissedEst' },
    
    // Assists/Creativity
    assists: { label: 'A', key: 'l5.assists', sortable: true, tip: 'Assists (L5)' },
    xA: { label: 'xA', key: 'l5.xA', sortable: true, format: v => v.toFixed(2), tip: 'Expected assists (L5)', term: 'xA' },
    xAG: { label: 'xA/G', key: 'xaPerGame', sortable: true, format: v => v.toFixed(2), tip: 'xA per game' },
    kp: { label: 'KP', key: 'l5.keyPasses', sortable: true, tip: 'Key passes (L5). Null = estimated from xA', estimated: '_keyPassesEst' },
    bcc: { label: 'BCC', key: 'l5.bigChancesCreated', sortable: true, tip: 'Big chances created (L5). Null = estimated from xA', estimated: '_bigChancesCreatedEst' },
    
    // Combined Expected
    xGI: { label: 'xGI', key: 'l5.xGI', sortable: true, format: v => v.toFixed(2), tip: 'Expected goal involvement (L5)', term: 'xGI' },
    xGIG: { label: 'xGI/G', key: 'xgiPerGame', sortable: true, format: v => v.toFixed(2), tip: 'xGI per game', highlight: v => v >= 0.5 ? 'good' : v >= 0.25 ? '' : 'bad' },
    
    // Defending
    cs: { label: 'CS', key: 'l5.cleanSheets', sortable: true, tip: 'Clean sheets (L5)', term: 'CS' },
    gc: { label: 'GC', key: 'l5.goalsConceded', sortable: true, tip: 'Goals conceded (L5)' },
    xGC: { label: 'xGC', key: 'l5.xGC', sortable: true, format: v => v.toFixed(2), tip: 'Expected goals conceded (L5)', term: 'xGC' },
    saves: { label: 'Saves', key: 'l5.saves', sortable: true, tip: 'Saves made (L5)' },
    penSaved: { label: 'Pen S', key: 'l5.penaltiesSaved', sortable: true, tip: 'Penalties saved (L5)' },
    
    // Bonus
    bonus: { label: 'Bonus', key: 'l5.bonus', sortable: true, tip: 'Bonus points (L5)' },
    bps: { label: 'BPS', key: 'l5.bps', sortable: true, tip: 'Bonus points system score (L5)', term: 'BPS' },
    
    // ICT Index
    ict: { label: 'ICT', key: 'l5.ict', sortable: true, format: v => v.toFixed(1), tip: 'ICT Index (L5)', term: 'ICT' },
    influence: { label: 'Infl', key: 'l5.influence', sortable: true, format: v => v.toFixed(1), tip: 'Influence score (L5)' },
    creativity: { label: 'Creat', key: 'l5.creativity', sortable: true, format: v => v.toFixed(1), tip: 'Creativity score (L5)' },
    threat: { label: 'Threat', key: 'l5.threat', sortable: true, format: v => v.toFixed(1), tip: 'Threat score (L5)' },
    
    // Fixtures
    fdr: { label: 'FDR', key: 'fdr', sortable: true, type: 'fdr', tip: 'Fixture difficulty (next 3)', term: 'FDR' },
    fixtures: { label: 'Next 3', key: 'fixtureString', sortable: false, type: 'fixtures', tip: 'Upcoming fixtures' }
};

// Per-90 forms of the defensive metrics. Derived rather than stored, so they
// follow whatever timeframe the ALL tab is currently showing.
COLUMN_DEFS.csPct = {
    label: 'CS%', sortable: true, tip: 'Share of games with a clean sheet',
    compute: p => (p.l5?.games ? ((p.l5.cleanSheets || 0) / p.l5.games) * 100 : 0),
    format: v => v.toFixed(0) + '%'
};
COLUMN_DEFS.xGC90 = {
    label: 'xGC/90', sortable: true, tip: 'Expected goals conceded per 90 minutes', term: 'xGC',
    compute: p => (p.l5?.minutes ? ((p.l5.xGC || 0) / p.l5.minutes) * 90 : 0),
    format: v => v.toFixed(2), lowerIsBetter: true
};
COLUMN_DEFS.saves90 = {
    label: 'Saves/90', sortable: true, tip: 'Saves per 90 minutes',
    compute: p => (p.l5?.minutes ? ((p.l5.saves || 0) / p.l5.minutes) * 90 : 0),
    format: v => v.toFixed(1)
};
COLUMN_DEFS.gc90 = {
    label: 'GC/90', sortable: true, tip: 'Goals conceded per 90 minutes',
    compute: p => (p.l5?.minutes ? ((p.l5.goalsConceded || 0) / p.l5.minutes) * 90 : 0),
    format: v => v.toFixed(2), lowerIsBetter: true
};

// One value accessor for rendering, sorting and the heatmap, so a column can
// never sort on one number and display another.
function colValue(p, colKey) {
    const col = COLUMN_DEFS[colKey];
    if (!col) return null;
    return col.compute ? col.compute(p) : getNestedValue(p, col.key);
}

// Column presets. 'player' is always first and always frozen.
const COLUMN_PRESETS = {
    core:      { label: '\u{1F3AF} Core', cols: ['player', 'price', 'own', 'pts', 'form', 'xGIG', 'fixtures'] },
    attacking: { label: '⚡ Attacking', cols: ['player', 'price', 'goals', 'assists', 'xGG', 'xAG', 'xGIG', 'kp', 'bcc', 'bcm', 'fixtures'] },
    defensive: { label: '\u{1F6E1}️ Defensive', cols: ['player', 'price', 'csPct', 'xGC90', 'saves90', 'gc90', 'bps', 'fixtures'] },
    all:       { label: '\u{1F4CA} All stats', cols: null }
};
const PRESET_STORAGE_KEY = 'fpl_allplayers_preset';

function applyColumnPreset(name, btn) {
    const preset = COLUMN_PRESETS[name];
    if (!preset) return;
    tableState.ALL.visibleCols = preset.cols ? [...preset.cols] : [...DEFAULT_COLS.ALL];
    tableState.ALL.page = 1;
    saveColumns(tableState.ALL.visibleCols);
    try { localStorage.setItem(PRESET_STORAGE_KEY, name); } catch (e) {}
    document.querySelectorAll('.col-preset-btn').forEach(b => b.classList.toggle('active', b.dataset.preset === name));
    const head = document.getElementById('tableHead-ALL');
    const body = document.getElementById('tableBody-ALL');
    if (head) head.innerHTML = renderTableHeader('ALL');
    if (body) body.innerHTML = renderTableBody('ALL');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Default columns per position
const DEFAULT_COLS = {
    GK: ['player', 'price', 'own', 'pts', 'ptsG', 'cs', 'saves', 'gc', 'xGC', 'bonus', 'fdr'],
    DEF: ['player', 'price', 'own', 'pts', 'ptsG', 'cs', 'gc', 'xGI', 'goals', 'assists', 'bonus', 'fdr'],
    MID: ['player', 'price', 'own', 'pts', 'ptsG', 'goals', 'assists', 'xGI', 'xG', 'xA', 'bonus', 'fdr'],
    FWD: ['player', 'price', 'own', 'pts', 'ptsG', 'goals', 'assists', 'xGI', 'xG', 'bcm', 'bonus', 'fdr'],
    ALL: ['player', 'pos', 'team', 'price', 'own', 'games', 'mins', 'minsG', 'pts', 'ptsG', 'form', 'goals', 'assists', 'xG', 'xA', 'xGI', 'xGIG', 'xGG', 'xAG', 'cs', 'gc', 'xGC', 'saves', 'bcc', 'bcm', 'kp', 'bonus', 'bps', 'ict', 'influence', 'creativity', 'threat', 'seasonPts', 'seasonPtsG', 'value', 'fdr', 'fixtures']
};

const COLS_STORAGE_KEY = 'fpl_allplayers_cols';
function loadSavedColumns() {
    try {
        const saved = localStorage.getItem(COLS_STORAGE_KEY);
        if (saved) return JSON.parse(saved);
    } catch(e) {}
    return null;
}
function saveColumns(cols) {
    try { localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(cols)); } catch(e) {}
}

// Available columns per position - FULL LIST
const AVAILABLE_COLS = {
    GK: ['player', 'team', 'price', 'own', 'games', 'mins', 'minsG', 'pts', 'ptsG', 'form', 'cs', 'saves', 'gc', 'xGC', 'penSaved', 'bonus', 'bps', 'seasonPts', 'seasonPtsG', 'value', 'fdr', 'fixtures'],
    DEF: ['player', 'team', 'price', 'own', 'games', 'mins', 'minsG', 'pts', 'ptsG', 'form', 'cs', 'gc', 'xGC', 'goals', 'assists', 'xG', 'xA', 'xGI', 'xGIG', 'bcc', 'kp', 'bonus', 'bps', 'ict', 'seasonPts', 'seasonPtsG', 'value', 'fdr', 'fixtures'],
    MID: ['player', 'team', 'price', 'own', 'games', 'mins', 'minsG', 'pts', 'ptsG', 'form', 'goals', 'assists', 'xG', 'xA', 'xGI', 'xGIG', 'xGG', 'xAG', 'bcc', 'bcm', 'kp', 'cs', 'bonus', 'bps', 'ict', 'influence', 'creativity', 'threat', 'seasonPts', 'seasonPtsG', 'value', 'fdr', 'fixtures'],
    FWD: ['player', 'team', 'price', 'own', 'games', 'mins', 'minsG', 'pts', 'ptsG', 'form', 'goals', 'assists', 'xG', 'xA', 'xGI', 'xGIG', 'xGG', 'xAG', 'bcc', 'bcm', 'kp', 'bonus', 'bps', 'ict', 'influence', 'creativity', 'threat', 'seasonPts', 'seasonPtsG', 'value', 'fdr', 'fixtures'],
    ALL: ['player', 'pos', 'team', 'price', 'own', 'games', 'mins', 'minsG', 'pts', 'ptsG', 'form', 'goals', 'assists', 'xG', 'xA', 'xGI', 'xGIG', 'xGG', 'xAG', 'cs', 'gc', 'xGC', 'saves', 'bcc', 'bcm', 'kp', 'bonus', 'bps', 'ict', 'influence', 'creativity', 'threat', 'seasonPts', 'seasonPtsG', 'value', 'fdr', 'fixtures']
};

function currentPresetName() {
    let saved = null;
    try { saved = localStorage.getItem(PRESET_STORAGE_KEY); } catch (e) {}
    return COLUMN_PRESETS[saved] ? saved : 'core';
}

function createTable(position, analyses) {
    const activePreset = currentPresetName();
    const posMap = { GK: 1, DEF: 2, MID: 3, FWD: 4 };
    const posNames = { GK: 'Goalkeepers', DEF: 'Defenders', MID: 'Midfielders', FWD: 'Forwards', ALL: 'All Players' };
    const posIcons = { GK: '<i data-lucide="hand" style="width:14px;height:14px;"></i>', DEF: '<i data-lucide="shield-check" style="width:14px;height:14px;"></i>', MID: '<i data-lucide="zap" style="width:14px;height:14px;"></i>', FWD: '<i data-lucide="crosshair" style="width:14px;height:14px;"></i>', ALL: '<i data-lucide="clipboard-list" style="width:14px;height:14px;"></i>' };
    const POSITIONS_MAP = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
    
    // Initialize state
    if (!tableState[position].visibleCols.length) {
        if (position === 'ALL') {
            // Opening on all thirty-seven columns is the reason this table needed
            // horizontal scrolling to be readable at all. Core is the default;
            // All stats is one click away.
            const saved = loadSavedColumns();
            tableState[position].visibleCols = saved ? saved : [...COLUMN_PRESETS.core.cols];
        } else {
            tableState[position].visibleCols = [...DEFAULT_COLS[position]];
        }
    }

    // Process players with computed fields
    const currentTf = (position === 'ALL') ? (tableState.ALL.timeframe || 'l5') : 'l5';
    const players = analyses
        .filter(a => {
            if (position === 'ALL') return a.l5?.games >= 1;
            return a.position === posMap[position] && a.l5?.games >= 1;
        })
        .map(p => {
            const tfStats = (position === 'ALL') ? computePlayerStats(p, currentTf) : (p.l5 || {});
            const tfGames = tfStats.games || 1;
            const seasonGames = p.season?.games || 1;
            return {
                ...p,
                l5: (position === 'ALL') ? tfStats : p.l5,
                posName: POSITIONS_MAP[p.position] || '?',
                ptsPerGame: (tfStats.points || 0) / tfGames,
                xgiPerGame: (tfStats.xGI || 0) / tfGames,
                xgPerGame: (tfStats.xG || 0) / tfGames,
                xaPerGame: (tfStats.xA || 0) / tfGames,
                minsPerGame: (tfStats.minutes || 0) / tfGames,
                seasonPtsPerGame: (p.season?.points || 0) / seasonGames,
                fdr: p.fixtures?.avgFDR3 || 3,
                fdrNext: p.fixtures?.next3 || [],
                fixtureString: p.fixtures?.fixtureString || '-',
                valueScore: ((tfStats.points || 0) / tfGames) / p.price
            };
        });

    tableData[position] = players;

    // Build column dropdown (shared between both layouts)
    const colDropdownHtml = `
        <div class="column-dropdown" id="colDropdown-${position}">
            <div class="column-dropdown-title">Show/Hide Columns</div>
            <div class="column-dropdown-actions">
                <button onclick="selectAllColumns('${position}')" class="col-action-btn">Select All</button>
                <button onclick="deselectAllColumns('${position}')" class="col-action-btn">Deselect All</button>
                <button onclick="resetColumns('${position}')" class="col-action-btn">Reset</button>
            </div>
            <div class="column-options-list">
                ${AVAILABLE_COLS[position].map(col => {
                    const def = COLUMN_DEFS[col];
                    if (!def) return '';
                    const checked = tableState[position].visibleCols.includes(col);
                    const disabled = def.always ? 'disabled' : '';
                    return `
                        <div class="column-option">
                            <input type="checkbox" id="col-${position}-${col}" ${checked ? 'checked' : ''} ${disabled}
                                onchange="toggleColumn('${position}', '${col}')">
                            <label for="col-${position}-${col}">${def.label}${def.always ? ' *' : ''}</label>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;

    // Filters panel (shared between both layouts)
    const filtersPanelHtml = `
        <div class="filters-panel" id="filtersPanel-${position}">
            <div class="filter-group">
                <div class="filter-group-label">Price Range</div>
                <div class="filter-range">
                    <input type="number" placeholder="Min" step="0.5" id="priceMin-${position}" 
                        onchange="applyRangeFilter('${position}', 'price')">
                    <span>to</span>
                    <input type="number" placeholder="Max" step="0.5" id="priceMax-${position}"
                        onchange="applyRangeFilter('${position}', 'price')">
                </div>
            </div>
            <div class="filter-group">
                <div class="filter-group-label">Ownership</div>
                <div class="filter-options">
                    <button class="filter-option" onclick="setFilter('${position}', 'ownership', 'low')">< 5% (Diff)</button>
                    <button class="filter-option" onclick="setFilter('${position}', 'ownership', 'mid')">5-15%</button>
                    <button class="filter-option" onclick="setFilter('${position}', 'ownership', 'high')">15-30%</button>
                    <button class="filter-option" onclick="setFilter('${position}', 'ownership', 'template')"> 30%+</button>
                </div>
            </div>
            <div class="filter-group">
                <div class="filter-group-label">Minutes (Last 5)</div>
                <div class="filter-options">
                    <button class="filter-option" onclick="setFilter('${position}', 'minutes', '90')">90 mins avg</button>
                    <button class="filter-option" onclick="setFilter('${position}', 'minutes', '75')">75+ mins</button>
                    <button class="filter-option" onclick="setFilter('${position}', 'minutes', '60')">60+ mins</button>
                </div>
            </div>
            <div style="margin-top: 12px;">
                <button class="action-btn" onclick="clearFilters('${position}')">Clear All Filters</button>
            </div>
        </div>
    `;

    // Compact toolbar for ALL position; classic for individual positions
    // Build team filter chips
    const teamsList = Object.values(teams).sort((a,b) => a.short_name.localeCompare(b.short_name));
    const teamChipsHtml = teamsList.map(t => `<button class="team-chip" data-team-id="${t.id}" onclick="toggleTeamFilter(${t.id}, this)">${t.short_name}</button>`).join('');

    const currentTimeframe = tableState.ALL.timeframe || 'l5';

    const toolbarHtml = position === 'ALL' ? `
        <div class="compact-toolbar" id="compactToolbar-${position}">
            <div class="compact-toolbar-row">
                <div class="position-filter-pills">
                    <button class="pos-filter-pill ${tableState.ALL.positionFilter === 'ALL' ? 'active' : ''}" onclick="setPositionFilter('ALL')">All</button>
                    <button class="pos-filter-pill pos-gk ${tableState.ALL.positionFilter === 'GK' ? 'active' : ''}" onclick="setPositionFilter('GK')">GK</button>
                    <button class="pos-filter-pill pos-def ${tableState.ALL.positionFilter === 'DEF' ? 'active' : ''}" onclick="setPositionFilter('DEF')">DEF</button>
                    <button class="pos-filter-pill pos-mid ${tableState.ALL.positionFilter === 'MID' ? 'active' : ''}" onclick="setPositionFilter('MID')">MID</button>
                    <button class="pos-filter-pill pos-fwd ${tableState.ALL.positionFilter === 'FWD' ? 'active' : ''}" onclick="setPositionFilter('FWD')">FWD</button>
                </div>
                <div class="compact-divider"></div>
                <div class="search-box compact-search">
                    <span class="search-icon"><i data-lucide="search" style="width:14px;height:14px;"></i></span>
                    <input type="text" placeholder="Search..." id="search-${position}" 
                        oninput="handleSearch('${position}', this.value)">
                </div>
                <div class="compact-divider"></div>
                <div class="filter-pills">
                    <button class="filter-pill compact-pill ${tableState[position].filters.form === 'hot' ? 'active' : ''}" 
                        onclick="quickFilter('${position}', 'form', 'hot')"><i data-lucide="flame" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> Hot</button>
                    <button class="filter-pill compact-pill ${tableState[position].filters.fixtures === 'easy' ? 'active' : ''}" 
                        onclick="quickFilter('${position}', 'fixtures', 'easy')"><i data-lucide="calendar" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> Easy</button>
                    <button class="filter-pill compact-pill ${tableState[position].filters.value === 'high' ? 'active' : ''}" 
                        onclick="quickFilter('${position}', 'value', 'high')"><i data-lucide="coins" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> Value</button>
                    <button class="filter-pill compact-pill ${tableState[position].filters.nailed === true ? 'active' : ''}" 
                        onclick="quickFilter('${position}', 'nailed', true)"><i data-lucide="lock" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> Nailed</button>
                    <button class="filter-pill compact-pill ${tableState.ALL.filters.shortlist ? 'active' : ''}" id="shortlistPill-ALL"
                        onclick="quickFilter('ALL', 'shortlist', true)"><i data-lucide="star" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> ${shortlistedPlayerIds.size > 0 ? shortlistedPlayerIds.size : ''}</button>
                    <div class="team-filter-wrapper">
                        <button class="team-filter-btn ${(tableState.ALL.filters.teams?.size > 0) ? 'active' : ''}" onclick="toggleTeamDropdown()" id="teamFilterBtn">
                            <i data-lucide="shield" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i>
                            Teams
                            ${(tableState.ALL.filters.teams?.size > 0) ? '<span class="team-count-badge">' + tableState.ALL.filters.teams.size + '</span>' : ''}
                        </button>
                        <div class="team-filter-dropdown" id="teamFilterDropdown">
                            <div class="team-filter-dropdown-header">
                                <span class="team-filter-dropdown-title">Filter by Team</span>
                                <button class="team-filter-clear" onclick="clearTeamFilter()">Clear all</button>
                            </div>
                            <div class="team-filter-grid">${teamChipsHtml}</div>
                        </div>
                    </div>
                </div>
                <div class="compact-divider"></div>
                <div class="col-preset-group" id="colPresets">
                    ${Object.entries(COLUMN_PRESETS).map(([key, pr]) =>
                        `<button class="col-preset-btn ${key === activePreset ? 'active' : ''}" data-preset="${key}"
                            onclick="applyColumnPreset('${key}', this)" title="Switch the visible columns">${pr.label}</button>`).join('')}
                </div>
                <div class="compact-divider"></div>
                <div class="timeframe-control" id="timeframeControl">
                    <button class="timeframe-btn ${currentTimeframe === 'season' ? 'active' : ''}" onclick="setTimeframe('season')">Season</button>
                    <button class="timeframe-btn ${currentTimeframe === 'l10' ? 'active' : ''}" onclick="setTimeframe('l10')">L10</button>
                    <button class="timeframe-btn ${currentTimeframe === 'l5' ? 'active' : ''}" onclick="setTimeframe('l5')">L5</button>
                    <button class="timeframe-btn ${currentTimeframe === 'l3' ? 'active' : ''}" onclick="setTimeframe('l3')">L3</button>
                </div>
                <div class="compact-spacer"></div>
                <span class="compact-count"><span id="rowCount-${position}">${players.length}</span> players</span>
                <button class="compact-icon-btn" onclick="toggleFilters('${position}')" id="filterBtn-${position}" title="Advanced Filters" aria-label="Toggle advanced filters"><i data-lucide="sliders-horizontal" style="width:14px;height:14px;"></i></button>
                <div class="column-selector">
                    <button class="compact-icon-btn" onclick="toggleColumnDropdown('${position}')" id="colBtn-${position}" title="Columns" aria-label="Toggle column visibility"><i data-lucide="bar-chart-3" style="width:14px;height:14px;"></i></button>
                    ${colDropdownHtml}
                </div>
            </div>
        </div>
        ${filtersPanelHtml}
    ` : `
        <div class="table-toolbar">
            <div class="table-toolbar-top">
                <div class="table-title-section">
                    <div class="table-icon ${position.toLowerCase()}">${posIcons[position]}</div>
                    <div>
                        <div class="table-title">${posNames[position]}</div>
                        <div class="table-count"><span id="rowCount-${position}">${players.length}</span> players</div>
                    </div>
                </div>
                <div class="table-actions">
                    <button class="action-btn" onclick="toggleFilters('${position}')" id="filterBtn-${position}">
                        <span><i data-lucide="sliders-horizontal" style="width:14px;height:14px;"></i></span> Filters
                    </button>
                    <div class="column-selector">
                        <button class="action-btn" onclick="toggleColumnDropdown('${position}')" id="colBtn-${position}">
                            <span><i data-lucide="bar-chart-3" style="width:14px;height:14px;"></i></span> Columns
                        </button>
                        ${colDropdownHtml}
                    </div>
                </div>
            </div>
            <div class="table-controls">
                <div class="search-box">
                    <span class="search-icon"><i data-lucide="search" style="width:14px;height:14px;"></i></span>
                    <input type="text" placeholder="Search players..." id="search-${position}" 
                        oninput="handleSearch('${position}', this.value)">
                </div>
                <div class="filter-pills">
                    <button class="filter-pill ${tableState[position].filters.form === 'hot' ? 'active' : ''}" 
                        onclick="quickFilter('${position}', 'form', 'hot')">
                        <span class="dot"></span> Hot Form
                    </button>
                    <button class="filter-pill ${tableState[position].filters.fixtures === 'easy' ? 'active' : ''}" 
                        onclick="quickFilter('${position}', 'fixtures', 'easy')">
                        <span class="dot"></span> Easy Fixtures
                    </button>
                    <button class="filter-pill ${tableState[position].filters.value === 'high' ? 'active' : ''}" 
                        onclick="quickFilter('${position}', 'value', 'high')">
                        <span class="dot"></span> High Value
                    </button>
                    <button class="filter-pill ${tableState[position].filters.nailed === true ? 'active' : ''}" 
                        onclick="quickFilter('${position}', 'nailed', true)">
                        <span class="dot"></span> Nailed On
                    </button>
                </div>
            </div>
            ${filtersPanelHtml}
        </div>
    `;

    return `
        <div class="table-section ${position === 'ALL' ? 'compact-mode' : ''}" id="tableSection-${position}">
            ${toolbarHtml}
            <div class="table-container">
                <table class="data-table" id="table-${position}">
                    <thead>
                        <tr id="tableHead-${position}">
                            ${renderTableHeader(position)}
                        </tr>
                    </thead>
                    <tbody id="tableBody-${position}">
                        ${renderTableBody(position)}
                    </tbody>
                </table>
            </div>
            <div class="table-footer">
                <div class="table-info">
                    Showing <span id="showingCount-${position}">${Math.min(getRowsPerPage(position), players.length)}</span> of ${players.length}
                </div>
                <div class="table-pagination" id="pagination-${position}">
                    ${renderPagination(position, players.length)}
                </div>
            </div>
        </div>
    `;
}

function renderTableHeader(position) {
    const state = tableState[position];
    // Compare and shortlist controls moved into the frozen player cell, so their
    // own columns are gone — they were costing horizontal width on every row.
    const tfLabel = position === 'ALL' ? { season: 'Season', l10: 'Last 10', l5: 'Last 5', l3: 'Last 3' }[state.timeframe || 'l5'] || 'Last 5' : 'L5';
    const cols = state.visibleCols.map(colKey => {
        const col = COLUMN_DEFS[colKey];
        if (!col) return '';
        const isSorted = state.sort === colKey;
        const sortIcon = isSorted ? (state.sortDir === 'asc' ? '↑' : '↓') : '↕';
        let tip = col.tip || col.label;
        if (position === 'ALL' && tip.includes('(L5)')) tip = tip.replace('(L5)', '(' + tfLabel + ')');
        const termAttr = col.term ? ` data-term="${col.term}"` : '';
        const frozen = colKey === 'player' ? ' col-player' : '';
        return `<th class="${isSorted ? 'sorted' : ''}${frozen}" onclick="sortTable('${position}', '${colKey}')" title="${tip}"${termAttr}>
            ${col.label}<span class="sort-icon">${sortIcon}</span>
        </th>`;
    }).join('');
    return cols + `<th class="col-actions"></th>`;
}

function renderTableBody(position) {
    const state = tableState[position];
    let players = [...(tableData[position] || [])];
    
    // Apply search
    if (state.search) {
        const q = state.search.toLowerCase();
        players = players.filter(p => p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q));
    }
    
    // Apply position filter (ALL tab only)
    if (position === 'ALL' && state.positionFilter && state.positionFilter !== 'ALL') {
        const posMap = { GK: 1, DEF: 2, MID: 3, FWD: 4 };
        const filterPosId = posMap[state.positionFilter];
        players = players.filter(p => p.position === filterPosId);
    }

    // Apply team filter (ALL tab only)
    if (position === 'ALL' && state.filters.teams?.size > 0) {
        players = players.filter(p => state.filters.teams.has(p.teamId));
    }

    // Apply shortlist filter
    if (state.filters.shortlist) {
        players = players.filter(p => shortlistedPlayerIds.has(p.id));
    }

    // Apply filters
    if (state.filters.form === 'hot') players = players.filter(p => p.form >= 5);
    if (state.filters.fixtures === 'easy') players = players.filter(p => p.fdr <= 2.5);
    if (state.filters.value === 'high') players = players.filter(p => p.valueScore >= 0.8);
    if (state.filters.nailed) players = players.filter(p => p.minsPerGame >= 75);
    if (state.filters.ownership === 'low') players = players.filter(p => p.selectedBy < 5);
    if (state.filters.ownership === 'mid') players = players.filter(p => p.selectedBy >= 5 && p.selectedBy < 15);
    if (state.filters.ownership === 'high') players = players.filter(p => p.selectedBy >= 15 && p.selectedBy < 30);
    if (state.filters.ownership === 'template') players = players.filter(p => p.selectedBy >= 30);
    if (state.filters.minutes === '90') players = players.filter(p => p.minsPerGame >= 85);
    if (state.filters.minutes === '75') players = players.filter(p => p.minsPerGame >= 75);
    if (state.filters.minutes === '60') players = players.filter(p => p.minsPerGame >= 60);
    if (state.filters.priceMin) players = players.filter(p => p.price >= state.filters.priceMin);
    if (state.filters.priceMax) players = players.filter(p => p.price <= state.filters.priceMax);
    
    // Sort
    const sortCol = COLUMN_DEFS[state.sort];
    if (sortCol) {
        players.sort((a, b) => {
            const aVal = colValue(a, state.sort);
            const bVal = colValue(b, state.sort);
            // Handle string sorting (e.g. player name, position, team)
            if (typeof aVal === 'string' && typeof bVal === 'string') {
                return state.sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            }
            return state.sortDir === 'asc' ? aVal - bVal : bVal - aVal;
        });
    }
    
    // Update count
    setTimeout(() => {
        const countEl = document.getElementById(`rowCount-${position}`);
        if (countEl) countEl.textContent = players.length;
        const showingEl = document.getElementById(`showingCount-${position}`);
        if (showingEl) showingEl.textContent = Math.min(getRowsPerPage(position) * state.page, players.length);
    }, 0);
    
    // Paginate
    const rpp = getRowsPerPage(position);
    const start = (state.page - 1) * rpp;
    const paginated = players.slice(start, start + rpp);

    // Shading is relative to the players currently in the table rather than to
    // fixed cut-offs. A threshold like "xGI/90 above 0.5 is elite" is meaningless
    // one gameweek into a season and wrong again by April; a percentile is not.
    heatScales = computeHeatScales(players, state.visibleCols);

    return paginated.map(p => renderPlayerRow(p, position)).join('');
}

// Columns worth shading: numeric, comparable across players, and meaningful.
const HEAT_COLS = new Set(['pts', 'ptsG', 'form', 'value', 'goals', 'assists', 'xG', 'xGG', 'xA', 'xAG',
    'xGI', 'xGIG', 'cs', 'csPct', 'saves', 'saves90', 'bonus', 'bps', 'ict', 'influence', 'creativity',
    'threat', 'kp', 'bcc', 'minsG', 'seasonPts', 'seasonPtsG', 'xGC', 'xGC90', 'gc', 'gc90']);

let heatScales = {};

function quantile(sorted, q) {
    if (!sorted.length) return null;
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos), rest = pos - base;
    return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

function computeHeatScales(players, cols) {
    const out = {};
    (cols || []).forEach(colKey => {
        if (!HEAT_COLS.has(colKey)) return;
        const col = COLUMN_DEFS[colKey];
        if (!col) return;
        const vals = players.map(p => colValue(p, colKey))
            .filter(v => typeof v === 'number' && Number.isFinite(v))
            .sort((a, b) => a - b);
        if (vals.length < 8) return;
        // For goals conceded and xGC the low number is the good one.
        const invert = !!col.lowerIsBetter || colKey === 'gc' || colKey === 'xGC';
        // Deliberately narrow bands. The table sorts by points descending, so the
        // first page is top-decile on most columns by construction — a p90 cut-off
        // paints nearly every cell green and stops meaning anything.
        out[colKey] = { p90: quantile(vals, 0.96), p70: quantile(vals, 0.85), p30: quantile(vals, 0.15), invert };
    });
    return out;
}

function heatClass(colKey, value, sortKey) {
    if (sortKey && colKey === sortKey) return '';
    const s = heatScales[colKey];
    if (!s || typeof value !== 'number' || !Number.isFinite(value)) return '';
    if (s.invert) {
        if (value <= s.p30) return 'stat-elite';
        if (value <= s.p70) return 'stat-good';
        if (value >= s.p90) return 'stat-low';
        return '';
    }
    if (value >= s.p90) return 'stat-elite';
    if (value >= s.p70) return 'stat-good';
    if (value <= s.p30) return 'stat-low';
    return '';
}

function renderPlayerRow(p, position) {
    const state = tableState[position];
    const isSelected = compareList.some(cp => cp.id === p.id);
    const cells = state.visibleCols.map(colKey => renderCell(p, colKey, position, isSelected)).join('');
    return `<tr class="${isSelected ? 'selected-row' : ''}" data-player-id="${p.id}">${cells}${renderActionsCell(p)}</tr>`;
}

// Quick actions, revealed on row hover. Anchored right so they do not consume
// width from the stat columns when idle.
function renderActionsCell(p) {
    return `<td class="col-actions">
        <div class="row-actions">
            <button class="row-action" title="Compare this player" onclick="event.stopPropagation(); toggleComparePlayer(${p.id})">⚖️ Compare</button>
            <button class="row-action" title="Plan a transfer for this player" onclick="event.stopPropagation(); swapFromTable(${p.id})">⚡ Swap</button>
        </div>
    </td>`;
}

// The transfer planner lives on the My Team page; hand the player over rather
// than pretending this page can complete the move.
function swapFromTable(playerId) {
    // Was a dead handoff: it stashed fpl_swap_target, which nothing has ever
    // read, and navigated to a wizard page that never looked at its query
    // string. Goes to the working planner instead.
    window.location.href = 'fpl-my-team-analysis.html#transfers';
}

function renderCell(p, colKey, position, isSelected) {
    const col = COLUMN_DEFS[colKey];
    if (!col) return '<td>-</td>';
    let value = colValue(p, colKey);

    if (colKey === 'player') {
        const posMap = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
        const posName = posMap[p.position] || '?';
        const selected = isSelected !== undefined ? isSelected : compareList.some(cp => cp.id === p.id);
        // Identity, compare and shortlist in one frozen cell. Position and team
        // live on the second line, which is why their own columns were dropped.
        return `<td class="col-player">
            <div class="pcell">
                <input type="checkbox" class="compare-checkbox" ${selected ? 'checked' : ''}
                    ${!selected && compareList.length >= 5 ? 'disabled' : ''}
                    title="Add to comparison"
                    onchange="onCompareCheckboxChange(${p.id}, '${position || 'ALL'}')">
                ${getStarHtml(p.id)}
                <div class="pcell-id clickable" onclick="openPlayerModal(${p.id}, '${posName}')">
                    <div class="pcell-name">${escHTML(p.name)}</div>
                    <div class="pcell-sub"><span class="pcell-pos pos-${posName}">${posName}</span>${escHTML(p.team)}</div>
                </div>
            </div>
        </td>`;
    }
    
    if (colKey === 'team') {
        return `<td>${escHTML(p.team)}</td>`;
    }

    if (colKey === 'pos') {
        const posColors = { GK: '#f39c12', DEF: '#27ae60', MID: '#3498db', FWD: '#e74c3c' };
        const posName = p.posName || '?';
        return `<td><span class="pos-badge" style="background:${posColors[posName] || '#888'};color:#fff;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:600;">${posName}</span></td>`;
    }
    
    if (col.type === 'fdr') {
        const fdrClass = value <= 2 ? 'fdr-1' : value <= 2.5 ? 'fdr-2' : value <= 3.5 ? 'fdr-3' : value <= 4 ? 'fdr-4' : 'fdr-5';
        return `<td><span class="fdr-badge ${fdrClass}">${(value || 0).toFixed(1)}</span></td>`;
    }
    
    if (col.type === 'fixtures') {
        const next3 = p.fdrNext || [];
        if (next3.length > 0) {
            const FDR_WORD = { 1: 'Very easy', 2: 'Easy', 3: 'Average', 4: 'Hard', 5: 'Very hard' };
            return `<td class="col-fixtures"><div class="tbl-fix-strip">
                ${next3.map(f => {
                    const d = f.difficulty || 3;
                    const band = Math.max(1, Math.min(5, Math.round(d)));
                    const opp = teams[f.opponent]?.short_name || '???';
                    return `<span class="tbl-fix fdr-${band}" title="GW${f.event || '?'}: ${f.isHome ? 'home to' : 'away at'} ${opp} — difficulty ${d} (${FDR_WORD[band]})">
                        <span class="tbl-fix-o">${escHTML(opp)}</span><small>${f.isHome ? 'H' : 'A'}</small>
                    </span>`;
                }).join('')}
            </div></td>`;
        }
        return `<td style="color: var(--text-muted);">-</td>`;
    }
    
    // Handle null/undefined values — check for estimated fallback
    if (value === null || value === undefined) {
        // If this column has an estimated field, show it with ~ prefix
        if (col.estimated) {
            const estValue = getNestedValue(p, `l5.${col.estimated}`);
            if (estValue !== null && estValue !== undefined && estValue !== 0) {
                return `<td class="stat-cell" style="color: var(--text-muted);" title="Estimated from expected stats">~${estValue}</td>`;
            }
        }
        return `<td class="stat-cell" style="color: var(--text-muted);">-</td>`;
    }
    
    const formatted = col.format ? col.format(value) : value;
    const heat = heatClass(colKey, typeof value === 'number' ? value : parseFloat(value),
        tableState[position || 'ALL'] && tableState[position || 'ALL'].sort);
    return `<td class="stat-cell ${heat}">${heat ? `<span class="stat-pill">${formatted}</span>` : formatted}</td>`;
}

function renderPagination(position, total) {
    const rpp = getRowsPerPage(position);
    const pages = Math.ceil(total / rpp);
    if (pages <= 1) return '';
    
    const state = tableState[position];
    let html = '';
    for (let i = 1; i <= Math.min(pages, 5); i++) {
        html += `<button class="page-btn ${state.page === i ? 'active' : ''}" onclick="goToPage('${position}', ${i})">${i}</button>`;
    }
    return html;
}

function getNestedValue(obj, path) {
    const val = path.split('.').reduce((o, k) => o?.[k], obj);
    if (val === null || val === undefined) return 0;
    return val;
}

// Table interactions
function sortTable(position, colKey) {
    const state = tableState[position];
    if (state.sort === colKey) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        state.sort = colKey;
        state.sortDir = 'desc';
    }
    refreshTable(position);
}

function handleSearch(position, query) {
    tableState[position].search = query;
    tableState[position].page = 1;
    refreshTable(position);
}

function quickFilter(position, type, value) {
    const state = tableState[position];
    if (state.filters[type] === value) {
        delete state.filters[type];
    } else {
        state.filters[type] = value;
    }
    state.page = 1;
    refreshTable(position);
    updateFilterButtons(position);
}

function setPositionFilter(posFilter) {
    const state = tableState.ALL;
    state.positionFilter = posFilter;
    state.page = 1;
    
    // Try to use saved cols; only change if user hasn't customised
    const saved = loadSavedColumns();
    if (saved) {
        state.visibleCols = [...saved];
    } else if (posFilter !== 'ALL' && DEFAULT_COLS[posFilter]) {
        state.visibleCols = ['player', 'pos', ...DEFAULT_COLS[posFilter].filter(c => c !== 'player')];
    } else {
        state.visibleCols = [...DEFAULT_COLS.ALL];
    }
    
    // Re-render entire table (to update column dropdown checkboxes too)
    const section = document.getElementById('section-ALL');
    if (section) {
        section.innerHTML = createTable('ALL', allAnalyses);
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
    
    // Update position filter pill active states
    document.querySelectorAll('.pos-filter-pill').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.pos-filter-pill[onclick="setPositionFilter('${posFilter}')"]`)?.classList.add('active');
}

function setFilter(position, type, value) {
    const state = tableState[position];
    if (state.filters[type] === value) {
        delete state.filters[type];
    } else {
        state.filters[type] = value;
    }
    state.page = 1;
    refreshTable(position);
}

function applyRangeFilter(position, type) {
    const min = parseFloat(document.getElementById(`${type}Min-${position}`)?.value);
    const max = parseFloat(document.getElementById(`${type}Max-${position}`)?.value);
    const state = tableState[position];
    if (!isNaN(min)) state.filters[`${type}Min`] = min;
    else delete state.filters[`${type}Min`];
    if (!isNaN(max)) state.filters[`${type}Max`] = max;
    else delete state.filters[`${type}Max`];
    state.page = 1;
    refreshTable(position);
}

function clearFilters(position) {
    if (position === 'ALL') {
        tableState[position].filters = { teams: new Set() };
    } else {
        tableState[position].filters = {};
    }
    tableState[position].search = '';
    tableState[position].page = 1;
    const searchInput = document.getElementById(`search-${position}`);
    if (searchInput) searchInput.value = '';
    refreshTable(position);
    updateFilterButtons(position);
}

// ============================================
// TEAM FILTER (ALL Players)
// ============================================
function toggleTeamDropdown() {
    const dropdown = document.getElementById('teamFilterDropdown');
    if (dropdown) {
        dropdown.classList.toggle('show');
        // Sync chip active states
        const activeTeams = tableState.ALL.filters.teams || new Set();
        dropdown.querySelectorAll('.team-chip').forEach(chip => {
            const teamId = parseInt(chip.dataset.teamId);
            chip.classList.toggle('active', activeTeams.has(teamId));
        });
    }
}

function toggleTeamFilter(teamId, btn) {
    if (!tableState.ALL.filters.teams) tableState.ALL.filters.teams = new Set();
    const teamSet = tableState.ALL.filters.teams;
    if (teamSet.has(teamId)) {
        teamSet.delete(teamId);
        btn.classList.remove('active');
    } else {
        teamSet.add(teamId);
        btn.classList.add('active');
    }
    tableState.ALL.page = 1;
    refreshTable('ALL');
    updateTeamFilterBtn();
}

function clearTeamFilter() {
    tableState.ALL.filters.teams = new Set();
    document.querySelectorAll('.team-chip').forEach(c => c.classList.remove('active'));
    tableState.ALL.page = 1;
    refreshTable('ALL');
    updateTeamFilterBtn();
}

function updateTeamFilterBtn() {
    const btn = document.getElementById('teamFilterBtn');
    if (!btn) return;
    const count = tableState.ALL.filters.teams?.size || 0;
    const icon = '<i data-lucide="shield" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i>';
    btn.className = 'team-filter-btn' + (count > 0 ? ' active' : '');
    btn.innerHTML = icon + ' Teams' + (count > 0 ? ' <span class="team-count-badge">' + count + '</span>' : '');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Close team dropdown when clicking outside
document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('teamFilterDropdown');
    if (dropdown?.classList.contains('show') && !e.target.closest('.team-filter-wrapper')) {
        dropdown.classList.remove('show');
    }
});

// ============================================
// TIMEFRAME TOGGLE (ALL Players)
// ============================================
function computePlayerStats(player, timeframe) {
    if (timeframe === 'season') return player.season || {};
    if (timeframe === 'l5') return player.l5 || {};

    // Compute from history for l10, l3
    const n = timeframe === 'l10' ? 10 : 3;
    const history = player.history || [];
    const slice = history.slice(-n);
    if (slice.length === 0) return player.l5 || {};

    const stats = {
        games: slice.filter(g => g.minutes > 0).length,
        minutes: 0, points: 0, goals: 0, assists: 0,
        xG: 0, xA: 0, xGI: 0, xGC: 0,
        cleanSheets: 0, goalsConceded: 0, saves: 0,
        bonus: 0, bps: 0, ict: 0,
        influence: 0, creativity: 0, threat: 0,
        bigChancesMissed: null, bigChancesCreated: null,
        keyPasses: null, penaltiesSaved: 0
    };

    let hasBCM = false, hasBCC = false, hasKP = false;
    slice.forEach(g => {
        stats.minutes += g.minutes || 0;
        stats.points += g.total_points || 0;
        stats.goals += g.goals_scored || 0;
        stats.assists += g.assists || 0;
        stats.xG += parseFloat(g.expected_goals) || 0;
        stats.xA += parseFloat(g.expected_assists) || 0;
        stats.xGI += parseFloat(g.expected_goal_involvements) || 0;
        stats.xGC += parseFloat(g.expected_goals_conceded) || 0;
        stats.cleanSheets += g.clean_sheets || 0;
        stats.goalsConceded += g.goals_conceded || 0;
        stats.saves += g.saves || 0;
        stats.bonus += g.bonus || 0;
        stats.bps += g.bps || 0;
        stats.ict += parseFloat(g.ict_index) || 0;
        stats.influence += parseFloat(g.influence) || 0;
        stats.creativity += parseFloat(g.creativity) || 0;
        stats.threat += parseFloat(g.threat) || 0;
        stats.penaltiesSaved += g.penalties_saved || 0;
        if (g.big_chances_missed !== undefined && g.big_chances_missed !== null) { stats.bigChancesMissed = (stats.bigChancesMissed || 0) + g.big_chances_missed; hasBCM = true; }
        if (g.big_chances_created !== undefined && g.big_chances_created !== null) { stats.bigChancesCreated = (stats.bigChancesCreated || 0) + g.big_chances_created; hasBCC = true; }
        if (g.key_passes !== undefined && g.key_passes !== null) { stats.keyPasses = (stats.keyPasses || 0) + g.key_passes; hasKP = true; }
    });
    if (!hasBCM) stats.bigChancesMissed = null;
    if (!hasBCC) stats.bigChancesCreated = null;
    if (!hasKP) stats.keyPasses = null;

    return stats;
}

function setTimeframe(tf) {
    tableState.ALL.timeframe = tf;
    tableState.ALL.page = 1;

    // Re-render whole table section (createTable remaps player stats with new timeframe)
    const section = document.getElementById('section-ALL');
    if (section) {
        section.innerHTML = createTable('ALL', allAnalyses);
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
}

function toggleColumn(position, colKey) {
    const state = tableState[position];
    const idx = state.visibleCols.indexOf(colKey);
    if (idx > -1) {
        state.visibleCols.splice(idx, 1);
    } else {
        state.visibleCols.push(colKey);
    }
    if (position === 'ALL') saveColumns(state.visibleCols);
    refreshTable(position);
}

function selectAllColumns(position) {
    const state = tableState[position];
    state.visibleCols = [...AVAILABLE_COLS[position]];
    // Update checkboxes
    AVAILABLE_COLS[position].forEach(col => {
        const checkbox = document.getElementById(`col-${position}-${col}`);
        if (checkbox) checkbox.checked = true;
    });
    if (position === 'ALL') saveColumns(state.visibleCols);
    refreshTable(position);
}

function deselectAllColumns(position) {
    const state = tableState[position];
    // Keep only the always-visible columns (like player)
    state.visibleCols = AVAILABLE_COLS[position].filter(col => COLUMN_DEFS[col]?.always);
    // Update checkboxes
    AVAILABLE_COLS[position].forEach(col => {
        const checkbox = document.getElementById(`col-${position}-${col}`);
        if (checkbox && !COLUMN_DEFS[col]?.always) checkbox.checked = false;
    });
    if (position === 'ALL') saveColumns(state.visibleCols);
    refreshTable(position);
}

function resetColumns(position) {
    const state = tableState[position];
    state.visibleCols = [...DEFAULT_COLS[position]];
    // Update checkboxes
    AVAILABLE_COLS[position].forEach(col => {
        const checkbox = document.getElementById(`col-${position}-${col}`);
        if (checkbox) checkbox.checked = DEFAULT_COLS[position].includes(col);
    });
    if (position === 'ALL') saveColumns(state.visibleCols);
    refreshTable(position);
}

function toggleFilters(position) {
    const panel = document.getElementById(`filtersPanel-${position}`);
    const btn = document.getElementById(`filterBtn-${position}`);
    panel?.classList.toggle('show');
    btn?.classList.toggle('active');
}

function toggleColumnDropdown(position) {
    const dropdown = document.getElementById(`colDropdown-${position}`);
    dropdown?.classList.toggle('show');
}

function goToPage(position, page) {
    tableState[position].page = page;
    refreshTable(position);
}

function refreshTable(position) {
    const head = document.getElementById(`tableHead-${position}`);
    const body = document.getElementById(`tableBody-${position}`);
    const pagination = document.getElementById(`pagination-${position}`);
    if (head) head.innerHTML = renderTableHeader(position);
    if (body) body.innerHTML = renderTableBody(position);
    if (pagination) pagination.innerHTML = renderPagination(position, tableData[position]?.length || 0);
    updateFilterButtons(position);
    if (typeof lucide !== 'undefined') lucide.createIcons();
    if (head && typeof annotateStatTerms === 'function') annotateStatTerms(head);
}

function updateFilterButtons(position) {
    const state = tableState[position];
    document.querySelectorAll(`#tableSection-${position} .filter-pill`).forEach(btn => {
        const text = btn.textContent.trim();
        let isActive = false;
        if (text.includes('Hot')) isActive = state.filters.form === 'hot';
        if (text.includes('Easy')) isActive = state.filters.fixtures === 'easy';
        if (text.includes('Value')) isActive = state.filters.value === 'high';
        if (text.includes('Nailed')) isActive = state.filters.nailed === true;
        if (text.includes('Shortlist') || btn.id === 'shortlistPill-ALL') isActive = !!state.filters.shortlist;
        btn.classList.toggle('active', isActive);
    });
    // Update position filter pills
    if (position === 'ALL') {
        document.querySelectorAll('.pos-filter-pill').forEach(btn => {
            const filter = btn.getAttribute('onclick')?.match(/setPositionFilter\('(\w+)'\)/)?.[1];
            btn.classList.toggle('active', filter === state.positionFilter);
        });
    }
}

// ============================================
// COMPARE FUNCTIONALITY
// ============================================
// This page's hook into the shared compare-report.js engine: resolve a
// checkbox's playerId to the already-processed row object in tableData.ALL,
// then hand off to the shared toggleComparePlayer(player).
function onCompareCheckboxChange(playerId, position) {
    const players = tableData[position] || [];
    const player = players.find(p => p.id === playerId);
    if (!player) return;
    toggleComparePlayer(player);
}

// Called by the shared engine after compareList changes — refresh the ALL
// table so checkbox/highlight state and the disabled-at-MAX_COMPARE state
// stay in sync (identical to this page's pre-refactor behavior).
function onCompareSelectionChange() {
    const body = document.getElementById('tableBody-ALL');
    if (body) body.innerHTML = renderTableBody('ALL');
}
