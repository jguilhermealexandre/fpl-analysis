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

// ===== API PROXY =====
const WORKER_URL = 'https://fpl-proxy.jguilhermealexandre.workers.dev';

async function fetchWithProxy(url) {
    const apiPath = url.replace('https://fantasy.premierleague.com/', '');
    const res = await fetch(`${WORKER_URL}/${apiPath}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
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

// ===== SERVICE WORKER =====
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    });
}
