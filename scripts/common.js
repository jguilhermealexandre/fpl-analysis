/* ============================================
   EasyFPL — Shared JavaScript Utilities
   ============================================ */

// ===== THEME =====
(function initTheme() {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') {
        document.documentElement.setAttribute('data-theme', saved);
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
})();

function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcon();
}

function updateThemeIcon() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.querySelectorAll('.theme-toggle').forEach(btn => {
        const sun = btn.querySelector('.icon-sun');
        const moon = btn.querySelector('.icon-moon');
        if (sun) sun.style.display = isDark ? 'none' : 'inline-block';
        if (moon) moon.style.display = isDark ? 'inline-block' : 'none';
    });
}

function getChartTheme() {
    const s = getComputedStyle(document.documentElement);
    return {
        grid: s.getPropertyValue('--chart-grid').trim() || 'rgba(0,0,0,0.05)',
        text: s.getPropertyValue('--chart-text').trim() || '#4B5563',
        tooltipBg: s.getPropertyValue('--chart-tooltip-bg').trim() || '#1F2937'
    };
}

function applyChartDefaults() {
    if (typeof Chart === 'undefined') return;
    const ct = getChartTheme();
    Chart.defaults.color = ct.text;
    Chart.defaults.scale.grid.color = ct.grid;
}

// Shared scatter-chart tooltip styling — the dark, high-contrast card (title in
// green, one line per stat, no color swatch) used across every scatter chart in
// the Players Analysis Charts tab. Pulled out here so other pages' scatter
// widgets (e.g. My Team's Visual Analysis) render tooltips of the same quality
// instead of falling back to Chart.js's plain default tooltip.
function scatterTooltipStyle() {
    return {
        backgroundColor: 'rgba(13, 17, 23, 0.95)',
        titleColor: '#4ade80',
        bodyColor: 'rgba(255,255,255,0.87)',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        padding: 12,
        displayColors: false
    };
}

// ===== SKELETON LOADING =====
function createSkeletonCards(count, container) {
    let html = '<div class="skeleton-container skeleton-grid" id="skeleton-loader">';
    for (let i = 0; i < count; i++) {
        html += `<div class="skeleton-card">
            <div class="skeleton-row">
                <div class="skeleton skeleton-circle" style="width:36px;height:36px;flex-shrink:0"></div>
                <div style="flex:1">
                    <div class="skeleton skeleton-title"></div>
                    <div class="skeleton skeleton-text" style="width:70%"></div>
                </div>
            </div>
            <div class="skeleton skeleton-text"></div>
            <div class="skeleton skeleton-text"></div>
            <div class="skeleton skeleton-text" style="width:50%"></div>
        </div>`;
    }
    html += '</div>';
    if (typeof container === 'string') container = document.getElementById(container);
    if (container) container.insertAdjacentHTML('afterbegin', html);
}

function removeSkeletons(container) {
    if (typeof container === 'string') container = document.getElementById(container);
    const el = (container || document).querySelector('.skeleton-container');
    if (el) { el.classList.add('hidden'); setTimeout(() => el.remove(), 300); }
}

// ===== STATE MESSAGES =====
function renderErrorState(title, message, retryFn) {
    return `<div class="state-message">
        <div class="state-message-icon error">
            <i data-lucide="alert-triangle" style="width:28px;height:28px;"></i>
        </div>
        <div class="state-message-title">${escHTML(title || 'Something went wrong')}</div>
        <div class="state-message-text">${escHTML(message || 'We couldn\u2019t load the data. Please try again.')}</div>
        ${retryFn ? '<button class="btn btn-primary" onclick="' + escHTML(retryFn) + '()">Try Again</button>' : ''}
    </div>`;
}

function renderEmptyState(title, message, icon) {
    return `<div class="state-message">
        <div class="state-message-icon empty">
            <i data-lucide="${escHTML(icon || 'inbox')}" style="width:28px;height:28px;"></i>
        </div>
        <div class="state-message-title">${escHTML(title || 'No data yet')}</div>
        <div class="state-message-text">${escHTML(message || 'There\u2019s nothing to show here right now.')}</div>
    </div>`;
}

// Amber "showing 2025/26 data" banner \u2014 shared across every page that falls back to
// last-season stats during preseason (originally page-local to fpl-players-analysis.html).
// `message` is caller-supplied and NOT escaped, matching the original \u2014 callers pass
// static copy, never raw user/API text, here.
function renderSeasonNotice(message) {
    return `<div class="season-notice" style="display:flex;align-items:center;gap:8px;padding:10px 14px;margin-bottom:12px;background:var(--color-warning-muted, rgba(245,158,11,0.1));border:1px solid var(--color-warning, #f59e0b);border-radius:10px;font-size:12px;color:var(--text-secondary);">
        <i data-lucide="history" style="width:14px;height:14px;flex-shrink:0;color:var(--color-warning, #f59e0b);"></i>
        <span>${message}</span>
    </div>`;
}

// Was previously `events.every(e => !e.finished)` on every page, independently
// reimplemented 3-4 times. That check stays true for days after a gameweek's
// first ball is kicked, because FPL doesn't flip an event's `finished` flag
// until every match in it has concluded AND bonus points are confirmed — so
// the site kept showing "not available until GW1" messaging (and stale
// last-season fallbacks) well after real current-season results existed.
// Considered started as soon as any fixture has actually kicked off — checked
// two ways so callers that don't have fixtures.json handy (season-vault.js
// only fetches bootstrap-static) still get the fix: fixturesData's `started`
// flag when passed, and bootData.teams' `played` counts (bootstrap-static
// updates these as soon as a team's first match is played) either way.
function computeIsPreseason(bootData, fixturesData) {
    if (!bootData || !bootData.events || !bootData.events.length) return true;
    if (Array.isArray(fixturesData) && fixturesData.some(f => f.started)) return false;
    if (Array.isArray(bootData.teams) && bootData.teams.some(t => t.played > 0)) return false;
    return bootData.events.every(e => !e.finished);
}

// ===== API PROXY =====
const WORKER_URL = 'https://fpl-proxy.jguilhermealexandre.workers.dev';
const DEMO_TEAM_ID = '0'; // reserved sentinel — real FPL entry IDs start at 1
const DEMO_LEAGUE_ID = '999999'; // reserved sentinel — showcases the mini-league card in demo mode

async function fetchWithProxy(url) {
    const apiPath = url.replace('https://fantasy.premierleague.com/', '');
    if (apiPath.startsWith(`api/entry/${DEMO_TEAM_ID}/`) || apiPath === `api/entry/${DEMO_TEAM_ID}`
        || apiPath === `api/leagues-classic/${DEMO_LEAGUE_ID}/standings/`) {
        return getDemoResponse(apiPath);
    }
    const res = await fetch(`${WORKER_URL}/${apiPath}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
}

// ===== DEMO TEAM MOCK DATA =====
let _demoBootstrapPromise = null;
let _demoSquadPromise = null;

function _getDemoBootstrap() {
    if (!_demoBootstrapPromise) {
        _demoBootstrapPromise = fetch(DATA_URLS.bootstrap)
            .then(r => { if (!r.ok) throw new Error('bootstrap unavailable'); return r.json(); });
    }
    return _demoBootstrapPromise;
}

function _buildDemoSquad() {
    if (!_demoSquadPromise) {
        _demoSquadPromise = _getDemoBootstrap().then(bootData => {
            const byPos = { 1: [], 2: [], 3: [], 4: [] };
            bootData.elements
                .filter(p => p.status === 'a')
                .forEach(p => byPos[p.element_type].push(p));
            [1, 2, 3, 4].forEach(pos => byPos[pos].sort((a, b) =>
                (b.total_points - a.total_points) || (b.now_cost - a.now_cost)));

            const gks = byPos[1].slice(0, 2);
            const defs = byPos[2].slice(0, 5);
            const mids = byPos[3].slice(0, 5);
            const fwds = byPos[4].slice(0, 3);

            // Starting XI (4-4-2): GK[0], top 4 DEF, top 4 MID, top 2 FWD
            const starters = [gks[0], ...defs.slice(0, 4), ...mids.slice(0, 4), ...fwds.slice(0, 2)];
            const bench = [gks[1], defs[4], mids[4], fwds[2]];

            const captain = [...mids.slice(0, 4), ...fwds.slice(0, 2)]
                .sort((a, b) => b.total_points - a.total_points)[0];
            const vice = starters.find(p => p.id !== captain.id && p.element_type !== 1);

            let position = 1;
            const picks = [...starters, ...bench].map(p => {
                const isStarter = starters.includes(p);
                return {
                    element: p.id,
                    position: position++,
                    multiplier: !isStarter ? 0 : (p.id === captain.id ? 2 : 1),
                    is_captain: p.id === captain.id,
                    is_vice_captain: p.id === vice.id,
                    selling_price: p.now_cost
                };
            });

            const bank = 5; // £0.5m
            const value = picks.reduce((sum, pk) => {
                const el = bootData.elements.find(e => e.id === pk.element);
                return sum + (el ? el.now_cost : 0);
            }, 0) + bank;

            return { picks, bank, value };
        }).catch(() => ({ picks: [], bank: 0, value: 0 }));
    }
    return _demoSquadPromise;
}

async function getDemoResponse(apiPath) {
    let body;

    // Preseason-honest mock data: before GW1 is played, a real manager has 0 points,
    // 0 rank, and no gameweek history — Demo Team should show the exact same "nothing
    // played yet, here's last season" state as a real team, not a fabricated GW1/GW2
    // narrative. `_buildDemoSquad()`'s player selection (sorted by total_points, which
    // are still last season's totals right now) needs no change — only the shape of
    // "how many gameweeks has this manager played" was wrong.
    if (/^api\/entry\/0\/event\/\d+\/picks\/$/.test(apiPath)) {
        const { picks, bank, value } = await _buildDemoSquad();
        body = {
            active_chip: null,
            picks,
            entry_history: { bank, points: 0, rank: null, value }
        };
    } else if (apiPath === 'api/entry/0/history/') {
        body = { current: [], past: [], chips: [] };
    } else if (apiPath === 'api/entry/0/transfers-latest/') {
        body = []; // never read by any call site
    } else if (apiPath === `api/leagues-classic/${DEMO_LEAGUE_ID}/standings/`) {
        body = {
            league: { id: DEMO_LEAGUE_ID, name: 'The Demo Legends' },
            standings: {
                results: [
                    { entry: 111, player_name: 'Alex Rival', entry_name: 'Rival FC', rank: 1, total: 145 },
                    { entry: 222, player_name: 'Sam Pundit', entry_name: 'Pundit XI', rank: 2, total: 138 },
                    { entry: 333, player_name: 'Jo Tactics', entry_name: 'Tactics United', rank: 3, total: 129 },
                    { entry: 0, player_name: 'Demo Manager', entry_name: 'Demo Team FC', rank: 4, total: 121 },
                    { entry: 444, player_name: 'Kim Wildcard', entry_name: 'Wildcard Wanderers', rank: 5, total: 112 }
                ]
            }
        };
    } else {
        body = {
            id: 0,
            player_first_name: 'Demo',
            player_last_name: 'Manager',
            name: 'Demo Team FC',
            summary_overall_points: 0,
            summary_overall_rank: null,
            summary_event_points: 0,
            leagues: {
                classic: [
                    { id: DEMO_LEAGUE_ID, name: 'The Demo Legends', entry_rank: 4, entry_last_rank: 7 }
                ]
            }
        };
    }

    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// ===== DATA CACHE (IndexedDB) =====
const DataCache = {
    DB_NAME: 'easyfpl-cache',
    STORE: 'data',
    VERSION: 1,
    TTL: 5 * 60 * 1000,

    _db: null,

    open() {
        if (this._db) return Promise.resolve(this._db);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.DB_NAME, this.VERSION);
            req.onupgradeneeded = () => req.result.createObjectStore(this.STORE);
            req.onsuccess = () => { this._db = req.result; resolve(this._db); };
            req.onerror = () => reject(req.error);
        });
    },

    async get(key) {
        try {
            const db = await this.open();
            return new Promise(resolve => {
                const tx = db.transaction(this.STORE, 'readonly');
                const req = tx.objectStore(this.STORE).get(key);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            });
        } catch { return null; }
    },

    async set(key, data) {
        try {
            const db = await this.open();
            return new Promise(resolve => {
                const tx = db.transaction(this.STORE, 'readwrite');
                tx.objectStore(this.STORE).put({ data, ts: Date.now() }, key);
                tx.oncomplete = resolve;
                tx.onerror = resolve;
            });
        } catch { /* silent */ }
    },

    async fetchJSON(url) {
        const key = url.replace(/\?v=\d+$/, '');
        try {
            const cached = await this.get(key);
            if (cached && Date.now() - cached.ts < this.TTL) {
                return cached.data;
            }
            const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            this.set(key, data);
            return data;
        } catch (err) {
            const stale = await this.get(key);
            if (stale && stale.data) return stale.data;
            throw err;
        }
    }
};

// ===== DATA URLs (with 5-min cache busting) =====
const CACHE_BUSTER = Math.floor(Date.now() / 300000);
const DATA_URLS = {
    bootstrap: 'data/bootstrap-static.json?v=' + CACHE_BUSTER,
    fixtures:  'data/fixtures.json?v=' + CACHE_BUSTER,
    players:   'data/players-data.json?v=' + CACHE_BUSTER,
    teams:     'data/teams-data.json?v=' + CACHE_BUSTER,
    lastUpdated: 'data/last-updated.json?v=' + CACHE_BUSTER
};

// ===== HTML ESCAPING =====
function escHTML(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

// ===== POSITION CONFIGURATION =====
const POSITION_CONFIG = {
    1: { name: 'Goalkeeper', short: 'GK', class: 'gk', formMedian: 3.0 },
    2: { name: 'Defender',   short: 'DEF', class: 'def', formMedian: 3.5 },
    3: { name: 'Midfielder', short: 'MID', class: 'mid', formMedian: 4.0 },
    4: { name: 'Forward',    short: 'FWD', class: 'fwd', formMedian: 4.5 }
};

// ===== TEAM ID (localStorage) =====
function getSavedTeamId() {
    const id = localStorage.getItem('fpl_team_id');
    return (id && /^\d+$/.test(id)) ? id : null;
}

function saveTeamId(id) {
    if (id && /^\d+$/.test(String(id))) {
        localStorage.setItem('fpl_team_id', String(id));
    }
}

function clearTeamId() {
    localStorage.removeItem('fpl_team_id');
}

function loadDemoTeam() {
    saveTeamId(DEMO_TEAM_ID);
    location.reload();
}

function _formatTeamIdLabel(id) {
    return id === DEMO_TEAM_ID ? 'DEMO' : id;
}

// ===== NAV TEAM ID WIDGET =====
function submitTeamIdNav() {
    const input = document.getElementById('navTeamIdInput');
    if (!input) return;
    const teamId = input.value.trim();
    if (!teamId || isNaN(teamId)) return;
    saveTeamId(teamId);
    showNavTeamBadge(teamId);
    if (typeof onTeamIdSubmitted === 'function') onTeamIdSubmitted(teamId);
}

function changeTeamIdNav() {
    clearTeamId();
    showNavTeamInput();
    if (typeof onTeamIdCleared === 'function') onTeamIdCleared();
}

function showNavTeamBadge(teamId) {
    const inputEl = document.getElementById('navTidInput');
    const badgeEl = document.getElementById('navTidBadge');
    const displayEl = document.getElementById('teamIdDisplay');
    const badgeInner = badgeEl ? badgeEl.querySelector('.nav-tid-badge') : null;
    if (inputEl) inputEl.classList.add('hidden');
    if (badgeEl) badgeEl.classList.remove('hidden');
    if (displayEl) displayEl.textContent = _formatTeamIdLabel(teamId);
    if (badgeInner) badgeInner.classList.toggle('nav-tid-badge--demo', teamId === DEMO_TEAM_ID);
}

function showNavTeamInput() {
    const inputEl = document.getElementById('navTidInput');
    const badgeEl = document.getElementById('navTidBadge');
    const input = document.getElementById('navTeamIdInput');
    if (inputEl) inputEl.classList.remove('hidden');
    if (badgeEl) badgeEl.classList.add('hidden');
    if (input) { input.value = ''; input.focus(); }
}

// ===== FOOTER LOADING =====
function loadFooter() {
    fetch('footer.html?v=23')
        .then(r => r.text())
        .then(h => {
            document.body.insertAdjacentHTML('beforeend', h);
            if (window.lucide) lucide.createIcons();
            // Always fetch data freshness
            fetch(DATA_URLS.lastUpdated)
                .then(r => r.ok ? r.json() : null)
                .then(d => {
                    if (d?.lastUpdated && window.updateDataFreshness) {
                        window.updateDataFreshness(d.lastUpdated);
                    }
                })
                .catch(() => {});
        });
}

// ===== LUCIDE ICONS INIT =====
const _lucideReady = new Promise(function(resolve) {
    if (typeof lucide !== 'undefined') { resolve(); return; }
    var s = document.createElement('script');
    s.src = 'https://unpkg.com/lucide@0.577.0';
    s.onload = resolve;
    s.onerror = resolve; // degrade gracefully
    document.head.appendChild(s);
});

function initIcons() {
    _lucideReady.then(function() {
        if (typeof lucide !== 'undefined') lucide.createIcons();
    });
}

// ===== NAV LOADING =====
function loadNav() {
    return fetch('nav.html?v=23')
        .then(r => r.text())
        .then(html => {
            document.body.insertAdjacentHTML('afterbegin', html);

            // Set active class based on current page
            const page = location.pathname.split('/').pop() || 'index.html';
            const topLink = document.querySelector(`.nav-links a.nav-link[href="${page}"]`);
            if (topLink) topLink.classList.add('active');
            // For mega menu triggers, match by data-mega attr → page prefix
            const megaMap = { 'fpl-my-team-analysis.html': 'myteam', 'fpl-players-analysis.html': 'players', 'fpl-teams-analysis.html': 'teams', 'fpl-league-rivals.html': 'rivals' };
            const megaKey = megaMap[page];
            if (megaKey) {
                const trigger = document.querySelector(`.nav-dropdown[data-mega="${megaKey}"] .nav-mega-trigger`);
                if (trigger) trigger.classList.add('active');
            }
            const mobileLink = document.querySelector(`.mobile-nav a.mobile-nav-item[href="${page}"]`);
            if (mobileLink) mobileLink.classList.add('active');

            // Initialize Team ID widget from localStorage
            const savedId = getSavedTeamId();
            if (savedId) {
                showNavTeamBadge(savedId);
                // Also sync drawer Team ID
                const drawerBadge = document.getElementById('drawerTidBadge');
                const drawerInput = document.getElementById('drawerTidInput');
                const drawerDisplay = document.getElementById('drawerTeamIdDisplay');
                if (drawerBadge && drawerInput && drawerDisplay) {
                    drawerDisplay.textContent = _formatTeamIdLabel(savedId);
                    drawerBadge.querySelector('.nav-tid-badge')?.classList.toggle('nav-tid-badge--demo', savedId === DEMO_TEAM_ID);
                    drawerBadge.classList.remove('hidden');
                    drawerInput.classList.add('hidden');
                }
            }

            // Keyboard handler for Team ID inputs
            const navInput = document.getElementById('navTeamIdInput');
            if (navInput) {
                navInput.addEventListener('keypress', e => {
                    if (e.key === 'Enter') submitTeamIdNav();
                });
            }
            const drawerInput = document.getElementById('drawerTeamIdInput');
            if (drawerInput) {
                drawerInput.addEventListener('keypress', e => {
                    if (e.key === 'Enter') submitTeamIdDrawer();
                });
            }

            // Initialize icons in the newly injected nav
            if (window.lucide) lucide.createIcons();

            // Setup mega menu interactions
            initMegaMenu();

            // Setup collapsing tab bar
            initTabAutoHide();
        });
}

// ===== MEGA MENU =====
function initMegaMenu() {
    const dropdowns = document.querySelectorAll('.nav-dropdown[data-mega]');
    const backdrop = document.querySelector('.mega-backdrop');
    let openTimer = null;
    let closeTimer = null;
    let currentOpen = null;

    function openPanel(dd) {
        clearTimeout(closeTimer);
        if (currentOpen && currentOpen !== dd) {
            currentOpen.classList.remove('open');
            const oldTrigger = currentOpen.querySelector('.nav-mega-trigger');
            if (oldTrigger) oldTrigger.setAttribute('aria-expanded', 'false');
        }
        dd.classList.add('open');
        const trigger = dd.querySelector('.nav-mega-trigger');
        if (trigger) trigger.setAttribute('aria-expanded', 'true');
        if (backdrop) backdrop.classList.add('visible');
        currentOpen = dd;
    }

    function closeAll() {
        clearTimeout(openTimer);
        clearTimeout(closeTimer);
        dropdowns.forEach(dd => {
            dd.classList.remove('open');
            const trigger = dd.querySelector('.nav-mega-trigger');
            if (trigger) trigger.setAttribute('aria-expanded', 'false');
        });
        if (backdrop) backdrop.classList.remove('visible');
        currentOpen = null;
    }

    function scheduleClose() {
        clearTimeout(openTimer);
        closeTimer = setTimeout(closeAll, 400);
    }

    dropdowns.forEach(dd => {
        // Hover: open with 150ms delay, close with 400ms delay
        dd.addEventListener('mouseenter', () => {
            clearTimeout(closeTimer);
            openTimer = setTimeout(() => openPanel(dd), 150);
        });
        dd.addEventListener('mouseleave', () => {
            clearTimeout(openTimer);
            scheduleClose();
        });

        const panel = dd.querySelector('.mega-menu-panel');
        if (panel) {
            panel.addEventListener('mouseenter', () => clearTimeout(closeTimer));
            panel.addEventListener('mouseleave', scheduleClose);
        }

        // Click trigger to toggle (for touch/keyboard)
        const trigger = dd.querySelector('.nav-mega-trigger');
        if (trigger) {
            trigger.addEventListener('click', e => {
                e.preventDefault();
                if (dd.classList.contains('open')) {
                    closeAll();
                } else {
                    openPanel(dd);
                }
            });

            // Keyboard: Escape closes, arrow keys navigate items
            trigger.addEventListener('keydown', e => {
                if (e.key === 'Escape') {
                    closeAll();
                    trigger.focus();
                }
                if (e.key === 'ArrowDown' && dd.classList.contains('open')) {
                    e.preventDefault();
                    const firstItem = panel ? panel.querySelector('.mega-item') : null;
                    if (firstItem) firstItem.focus();
                }
            });
        }

        // Keyboard nav within panel items
        if (panel) {
            panel.addEventListener('keydown', e => {
                const items = Array.from(panel.querySelectorAll('.mega-item'));
                const idx = items.indexOf(document.activeElement);
                if (e.key === 'ArrowDown' && idx < items.length - 1) {
                    e.preventDefault();
                    items[idx + 1].focus();
                } else if (e.key === 'ArrowUp' && idx > 0) {
                    e.preventDefault();
                    items[idx - 1].focus();
                } else if (e.key === 'ArrowUp' && idx === 0) {
                    e.preventDefault();
                    const trig = dd.querySelector('.nav-mega-trigger');
                    if (trig) trig.focus();
                } else if (e.key === 'Escape') {
                    closeAll();
                    const trig = dd.querySelector('.nav-mega-trigger');
                    if (trig) trig.focus();
                }
            });
        }
    });

    // Backdrop click closes
    if (backdrop) {
        backdrop.addEventListener('click', closeAll);
    }

    // Close on outside click
    document.addEventListener('click', e => {
        if (currentOpen && !e.target.closest('.nav-dropdown[data-mega]') && !e.target.closest('.mega-backdrop')) {
            closeAll();
        }
    });
}

// ===== MOBILE DRAWER =====
function toggleMobileDrawer() {
    const drawer = document.getElementById('mobileDrawer');
    const backdrop = document.getElementById('mobileDrawerBackdrop');
    if (!drawer) return;
    const isOpen = drawer.classList.contains('open');
    if (isOpen) {
        closeMobileDrawer();
    } else {
        drawer.classList.add('open');
        if (backdrop) backdrop.classList.add('open');
        document.body.style.overflow = 'hidden';
        // Focus the close button
        const closeBtn = drawer.querySelector('.drawer-close');
        if (closeBtn) closeBtn.focus();
    }
}

function closeMobileDrawer() {
    const drawer = document.getElementById('mobileDrawer');
    const backdrop = document.getElementById('mobileDrawerBackdrop');
    if (drawer) drawer.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    document.body.style.overflow = '';
}

function toggleDrawerGroup(btn) {
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!expanded));
}

function submitTeamIdDrawer() {
    const input = document.getElementById('drawerTeamIdInput');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    localStorage.setItem('fpl_team_id', val);
    // Sync to nav widget
    showNavTeamBadge(val);
    // Update drawer display
    const badge = document.getElementById('drawerTidBadge');
    const form = document.getElementById('drawerTidInput');
    const display = document.getElementById('drawerTeamIdDisplay');
    if (badge && form && display) {
        display.textContent = _formatTeamIdLabel(val);
        badge.querySelector('.nav-tid-badge')?.classList.toggle('nav-tid-badge--demo', val === DEMO_TEAM_ID);
        badge.classList.remove('hidden');
        form.classList.add('hidden');
    }
    closeMobileDrawer();
    location.reload();
}

// ===== COLLAPSING TAB BAR =====
function initTabAutoHide() {
    const tabs = document.querySelector('.tabs-container');
    if (!tabs) return;

    let lastY = window.scrollY;
    let ticking = false;
    const DELTA = 30;

    window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            const currentY = window.scrollY;
            if (currentY > lastY + DELTA && currentY > 120) {
                tabs.classList.add('tabs-hidden');
            } else if (currentY < lastY - DELTA || currentY < 60) {
                tabs.classList.remove('tabs-hidden');
            }
            lastY = currentY;
            ticking = false;
        });
    }, { passive: true });
}

// ===== JARGON DICTIONARY =====
var FPL_JARGON = {
    'xG': 'Expected Goals \u2014 the quality of scoring chances a player has had',
    'xGA': 'Expected Goals Against \u2014 the quality of chances conceded by a team',
    'xGI': 'Expected Goal Involvements \u2014 xG + xA combined',
    'xGC': 'Expected Goals Conceded \u2014 xG faced while the player is on the pitch',
    'xA': 'Expected Assists \u2014 the quality of chances created for teammates',
    'FDR': 'Fixture Difficulty Rating \u2014 how tough upcoming opponents are (1 = easy, 5 = hard)',
    'ICT': 'Influence, Creativity & Threat \u2014 the official FPL index measuring player impact',
    'BPS': 'Bonus Point System \u2014 determines which players earn bonus points each match',
    'EO': 'Effective Ownership \u2014 the % of active managers who own or captain a player',
    'VAPM': 'Value Added Per Million \u2014 points scored relative to player price',
    'ITB': 'In The Bank \u2014 remaining transfer budget',
    'CS': 'Clean Sheet \u2014 no goals conceded',
    'GW': 'Gameweek \u2014 a round of Premier League fixtures',
    'DGW': 'Double Gameweek \u2014 a gameweek where a team plays twice',
    'BGW': 'Blank Gameweek \u2014 a gameweek where a team does not play',
    'PP90': 'Points Per 90 Minutes \u2014 scoring rate normalized by playing time',
    'NPxG': 'Non-Penalty Expected Goals \u2014 xG excluding penalties',
    'xPts': 'Expected Points \u2014 projected FPL points based on fixture difficulty and form',
};

function annotateStatTerms(root) {
    if (!root) root = document;
    root.querySelectorAll('[data-term]').forEach(function(el) {
        var term = el.getAttribute('data-term');
        var tip = FPL_JARGON[term];
        if (tip && !el.getAttribute('data-tip')) {
            el.setAttribute('data-tip', tip);
            if (!el.classList.contains('stat-tip') && !el.classList.contains('stat-tip-btn')) {
                el.classList.add('stat-tip');
            }
        }
    });
    // Handle mobile tap-to-toggle for info buttons
    root.querySelectorAll('.stat-tip-btn[data-term]').forEach(function(btn) {
        if (btn._tipBound) return;
        btn._tipBound = true;
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var wasActive = btn.classList.contains('active');
            document.querySelectorAll('.stat-tip-btn.active').forEach(function(b) { b.classList.remove('active'); });
            if (!wasActive) btn.classList.add('active');
        });
    });
}

// Close toggletips on outside click
document.addEventListener('click', function() {
    document.querySelectorAll('.stat-tip-btn.active').forEach(function(b) { b.classList.remove('active'); });
});

// ===== FEATURE DISCOVERY HINTS =====
var HINTS_STORAGE_KEY = 'easyfpl_hints_seen';

function getSeenHints() {
    try {
        var raw = localStorage.getItem(HINTS_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch(e) { return {}; }
}

function markHintSeen(hintKey) {
    var seen = getSeenHints();
    seen[hintKey] = Date.now();
    try { localStorage.setItem(HINTS_STORAGE_KEY, JSON.stringify(seen)); } catch(e) {}
}

/**
 * Show a one-time pulsating hint dot on an element.
 * @param {string} targetSelector - CSS selector for the element to attach the hint to.
 * @param {string} hintKey - Unique key for this hint (stored in localStorage).
 * @param {string} message - Short tooltip message shown on hover/click.
 * @returns {boolean} true if hint was shown, false if already seen.
 */
function showFeatureHint(targetSelector, hintKey, message) {
    if (getSeenHints()[hintKey]) return false;
    var target = document.querySelector(targetSelector);
    if (!target) return false;

    // Ensure positioned parent
    var pos = getComputedStyle(target).position;
    if (pos === 'static') target.style.position = 'relative';

    var dot = document.createElement('span');
    dot.className = 'feature-hint-dot';
    dot.setAttribute('data-hint', message);
    dot.setAttribute('aria-label', message);
    dot.addEventListener('click', function(e) {
        e.stopPropagation();
        markHintSeen(hintKey);
        dot.classList.add('feature-hint-fade');
        setTimeout(function() { dot.remove(); }, 300);
    });
    target.appendChild(dot);
    return true;
}

// ===== SERVICE WORKER =====
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    });
}
