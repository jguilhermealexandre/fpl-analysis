/* ============================================
   EasyFPL — Shared JavaScript Utilities
   ============================================ */

// ===== API PROXY =====
const WORKER_URL = 'https://fpl-proxy.jguilhermealexandre.workers.dev';

async function fetchWithProxy(url) {
    const apiPath = url.replace('https://fantasy.premierleague.com/', '');
    const res = await fetch(`${WORKER_URL}/${apiPath}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
}

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
    if (inputEl) inputEl.classList.add('hidden');
    if (badgeEl) badgeEl.classList.remove('hidden');
    if (displayEl) displayEl.textContent = teamId;
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
    fetch('footer.html')
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
    return fetch('nav.html')
        .then(r => r.text())
        .then(html => {
            document.body.insertAdjacentHTML('afterbegin', html);

            // Set active class based on current page
            const page = location.pathname.split('/').pop() || 'index.html';
            const topLink = document.querySelector(`.nav-links a.nav-link[href="${page}"]`);
            if (topLink) topLink.classList.add('active');
            const mobileLink = document.querySelector(`.mobile-nav a.mobile-nav-item[href="${page}"]`);
            if (mobileLink) mobileLink.classList.add('active');

            // Initialize Team ID widget from localStorage
            const savedId = getSavedTeamId();
            if (savedId) showNavTeamBadge(savedId);

            // Keyboard handler for Team ID input
            const navInput = document.getElementById('navTeamIdInput');
            if (navInput) {
                navInput.addEventListener('keypress', e => {
                    if (e.key === 'Enter') submitTeamIdNav();
                });
            }

            // Initialize icons in the newly injected nav
            if (window.lucide) lucide.createIcons();
        });
}
