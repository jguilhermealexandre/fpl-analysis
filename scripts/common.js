/* ============================================
   EasyFPL — Shared JavaScript Utilities
   ============================================ */

// ===== THEME =====
/* Dark is the default, not the OS's preference.
 *
 * This site is a dark product — the pitch, the verdict colours and the
 * fixture scale were all chosen against a dark ground — so somebody arriving
 * with a light OS was being shown the version we did not design first. The
 * toggle still works and still persists; the only thing that changed is what
 * happens before anyone has chosen. */
(function initTheme() {
    let saved = null, hasTeam = false;
    try {
        saved = localStorage.getItem('theme');
        hasTeam = !!localStorage.getItem('fpl_team_id');
    } catch (e) { /* private mode — dark is the safe default either way */ }

    /* Without a team this is the marketing shell, and that is dark, full
       stop: there is no toggle in its header to change it with. The app
       keeps the choice, because somebody reading a pitch at their desk in
       daylight is a different case from somebody looking at a landing page.
       Decided here rather than after the shell loads, so the page does not
       paint light and then correct itself. */
    const mode = !hasTeam ? 'dark'
        : ((saved === 'dark' || saved === 'light') ? saved : 'dark');
    document.documentElement.setAttribute('data-theme', mode);
})();

function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcon();
    /* Here, rather than after the view transition settles. The sidebar row
       names the mode you are in and draws a switch for it, and syncing it
       from transition.finished meant the page went dark while the row still
       said "Light mode" with the switch to the left, for the ~600ms the
       animation lasts. Both are attributes of the same fact, so they change
       on the same line — which also puts them inside the transition, so the
       row cross-fades with everything else instead of snapping afterwards. */
    v2SyncThemeRow();
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

/* The same flag lag, one level down: is this MATCH in the books?

   FPL keeps a fixture's `finished` false until the round's data check — every
   match concluded and bonus confirmed — which lands a day or more after the
   final whistle. `finished_provisional` flips at full time. GW3 2026/27 is the
   worked example: all ten matches played by Sunday 15:30, scores in, and every
   one of them still reporting `finished: false` on Monday morning.

   Anything that splits fixtures into played and upcoming has to read the faster
   flag, or a round that has already happened stays in the projection window —
   fixture strips point at a match in the books, form and xG models ignore the
   newest results, and the venue/FDR adjustments run off last weekend's opponent.
   Anything that counts games played has to look wider still, or it divides a
   season total by one and calls the result a per-game rate.

   Was page-local to fpl-teams-analysis.html, where the divide-by-a-smaller-
   number half of this was found first, while three other pages kept their own
   `!f.finished` filters. One definition now, for the same reason
   computeIsPreseason() above has one. */
function fixturePlayed(f) {
    return !!f && f.team_h_score !== null && f.team_h_score !== undefined
        && (f.finished || f.finished_provisional || f.started);
}

/* The same flag lag, one level up: which gameweek are we PLANNING for?

   `is_current` in bootstrap-static.json answers a different question — the
   round whose deadline passed most recently — and it keeps answering it for the
   days between that round's last whistle and the next deadline. Anything that
   starts a fixture horizon there is a round behind for exactly the window in
   which managers are planning. GW3 2026/27 is the worked example: all ten
   matches played by Sunday afternoon, and on the Wednesday Teams Analysis still
   opened its calendar on GW3, ranked "best upcoming five" over GW3–7, and drew
   its fixture swings by averaging GW3–5 against GW6–8 — a third of the "current"
   window being a round whose result was already on the same page.

   Derived from the clock and the fixture list instead, so no flag has to catch
   up: the last deadline that has passed names the round we are in, and once
   that round's matches are all played the answer is the next one. It changes at
   the final whistle and again at the next deadline, both without a redeploy.

   scripts/matchday.js asks a bigger version of this question —
   mdGameweekState() also reports phase, deadline and live match counts for the
   dashboard badge and match panel. This is the one number the analysis pages
   need, and it lives here because common.js is the file every page loads.

   Pure: `now` is a parameter, so any point in a season is testable. */
function planningGameweek(bootData, fixturesData, now) {
    const events = ((bootData && bootData.events) || [])
        .filter(e => e && e.id != null && e.deadline_time)
        .slice()
        .sort((a, b) => Date.parse(a.deadline_time) - Date.parse(b.deadline_time));
    if (!events.length) return 1;

    const t = now instanceof Date ? now.getTime() : (now != null ? now : Date.now());
    const passed = events.filter(e => Date.parse(e.deadline_time) <= t);
    const next = events.find(e => Date.parse(e.deadline_time) > t) || null;

    // Before the season's first deadline the round being planned is the first one.
    if (!passed.length) return next ? next.id : events[0].id;

    const current = passed[passed.length - 1];
    if (!next) return current.id;   // final round of the season; nothing follows it

    // Read the fast flag, for the reason fixturePlayed() above documents: a
    // round whose last match ended an hour ago is over whether or not FPL has
    // run its data check. Without a fixture list to consult — callers that only
    // hold bootstrap-static — the event's own slower flag is the fallback.
    const fx = (fixturesData || []).filter(f => f && f.event === current.id);
    const roundOver = fx.length
        ? fx.every(f => f.finished_provisional)
        : !!current.finished;

    return roundOver ? next.id : current.id;
}

/* ===== The squad you actually have =====

   `entry/{id}/event/{gw}/picks/` only ever answers for a round whose deadline
   has passed. So for the whole window between a round's last whistle and the
   next deadline — the window in which managers are actually working — it
   describes a team that has since been changed, and every panel built on it is
   analysing last weekend's squad. The endpoint that would know better,
   `my-team/{id}`, needs the manager's own login, which a static site cannot
   hold.

   `entry/{id}/transfers/` is public, needs no login, and stamps each move with
   the gameweek it takes effect in. So the planning squad is last round's picks
   with this window's moves replayed over them: the incoming player takes the
   outgoing one's slot, and the bank moves by exactly what FPL credited and
   charged, both of which the feed states rather than leaving to be inferred.

   Two things this deliberately does not do. It does not guess at a chip — a
   Wildcard or Free Hit played for the upcoming round is invisible until the
   deadline, and a squad of fifteen transfers replays the same either way. And
   it must only ever be called while the round being planned is AHEAD of the
   round the picks describe: once the deadline passes, FPL publishes real picks
   for that round with the transfers already in them, and replaying the same
   moves on top would apply every one of them twice.

   Returns null when there is nothing to apply, so a caller can keep the
   response it already has rather than being handed a copy of it.

   `nowCostTenths(id)` is optional and only sharpens the selling price of an
   incoming player; without it the purchase price is used, which is what FPL
   itself uses until the player's price next moves. */
/* ===== Transfers you confirmed here, but have not made on FPL =====

   The Transfer Wizard can only ever be advice: FPL has no public write API,
   so a swap agreed on this site does not exist on theirs until the manager
   makes it there too. Confirming one used to change nothing at all, which
   made the rest of the site disagree with the plan you had just settled on —
   every page still showing the player you had decided to sell.

   These moves are held in this browser, keyed to the team and the round they
   were made for, and folded into the picks every page fetches. They are the
   manager's own statement of intent, not data from anywhere, and they expire
   by themselves: a move whose outgoing player is no longer in the fetched
   squad has been made for real, so the record of it is dropped.

   The wizard shows a warning before writing any of this — see
   twOpenConfirmGuard() — because a squad that is right here and wrong on
   fantasy.premierleague.com is worse than no plan at all. */
const TW_CONFIRMED_KEY = 'easyfpl_confirmed_transfers';

function twConfirmedRead() {
    try {
        const raw = localStorage.getItem(TW_CONFIRMED_KEY);
        if (!raw) return null;
        const rec = JSON.parse(raw);
        return rec && Array.isArray(rec.moves) && rec.moves.length ? rec : null;
    } catch (e) { return null; }
}

function twConfirmedSave(teamId, gw, moves) {
    try {
        localStorage.setItem(TW_CONFIRMED_KEY, JSON.stringify({
            teamId: String(teamId), gw, at: Date.now(), moves
        }));
    } catch (e) { /* private mode; the plan simply does not persist */ }
}

function twConfirmedClear() {
    try { localStorage.removeItem(TW_CONFIRMED_KEY); } catch (e) { /* nothing to clear */ }
}

/* applyConfirmedSwaps() lived here. It folded the Transfer Wizard's saved
 * plan into a picks payload so the whole site would render the squad the
 * manager intended rather than the one they own — which is the wrong way round.
 * The plan is the wizard's business and stays there; see twPlan in
 * scripts/transfer-wizard.js. twConfirmedRead/Save/Clear above are still what
 * persists it.
 */

function applyPendingTransfers(picksData, transfers, gw, nowCostTenths) {
    if (!picksData || !Array.isArray(picksData.picks) || !picksData.picks.length) return null;

    const moves = (transfers || [])
        .filter(t => t && t.event === gw && t.element_in != null && t.element_out != null)
        // Oldest first. A player bought and then sold again before the deadline
        // is a chain, and only replaying it in order lands on who is owned now.
        .sort((a, b) => Date.parse(a.time || 0) - Date.parse(b.time || 0));
    if (!moves.length) return null;

    const picks = picksData.picks.map(p => ({ ...p }));
    const before = picks.map(p => p.element);
    const capIndex = picks.findIndex(p => p.is_captain);
    const viceIndex = picks.findIndex(p => p.is_vice_captain);

    let bankTenths = picksData.entry_history && picksData.entry_history.bank != null
        ? picksData.entry_history.bank : 0;
    const applied = [];

    moves.forEach(t => {
        const slot = picks.find(p => p.element === t.element_out);
        // A move out of a player this squad does not hold means the picks and
        // the transfer log disagree about the starting point. Skipping is the
        // only safe answer: applying it anyway would invent a squad.
        if (!slot) return;

        slot.element = t.element_in;
        slot.purchase_price = t.element_in_cost;
        slot.selling_price = sellingPriceTenths(t.element_in_cost,
            typeof nowCostTenths === 'function' ? nowCostTenths(t.element_in) : null);
        bankTenths += (t.element_out_cost || 0) - (t.element_in_cost || 0);

        // Collapse the chain rather than reporting both halves of it: a manager
        // who bought Haaland and changed their mind made one net move, not two.
        const chained = applied.find(m => m.in === t.element_out);
        if (chained) chained.in = t.element_in;
        else applied.push({ out: t.element_out, in: t.element_in, slot: slot.position });
    });

    const netMoves = applied.filter(m => m.in !== m.out);
    if (!netMoves.length) return null;

    /* FPL hands the armband to the vice-captain when the captain is sold. The
       alternative — leaving `is_captain` on the slot, so it lands on whoever
       arrived in it — would quietly captain a player the manager never chose. */
    let armband = null;
    const capSold = capIndex >= 0 && picks[capIndex].element !== before[capIndex];
    const viceSold = viceIndex >= 0 && picks[viceIndex].element !== before[viceIndex];
    if (capSold) {
        const heir = (!viceSold && viceIndex >= 0 && viceIndex !== capIndex)
            ? viceIndex
            : picks.findIndex((p, i) => i !== capIndex && p.position <= 11 && p.element === before[i]);
        if (heir >= 0) {
            picks[capIndex].is_captain = false;
            picks[capIndex].multiplier = picks[capIndex].position <= 11 ? 1 : 0;
            picks[heir].is_captain = true;
            picks[heir].is_vice_captain = false;
            picks[heir].multiplier = picks[heir].position <= 11 ? 2 : 0;
            armband = { from: before[capIndex], to: picks[heir].element };
        }
    }
    // Promoting the vice leaves the squad without one; so does selling him.
    if (!picks.some(p => p.is_vice_captain)) {
        const deputy = picks.findIndex(p => p.position <= 11 && !p.is_captain);
        if (deputy >= 0) picks[deputy].is_vice_captain = true;
    }

    return {
        gw,
        moves: netMoves,
        armband,
        picksData: {
            ...picksData,
            picks,
            /* Bank moves, team value does not: a transfer credits the bank
               exactly what it charges the squad, so `value` — which FPL defines
               as the two added together — is the one figure a transfer leaves
               alone. */
            entry_history: { ...(picksData.entry_history || {}), bank: bankTenths }
        }
    };
}

/* What a player bought at `purchaseTenths` would raise if sold again. FPL banks
   half of any rise since the purchase, rounded down, and the whole of any fall.
   Both in tenths of a million, which is how the API states prices. */
function sellingPriceTenths(purchaseTenths, nowTenths) {
    if (!(purchaseTenths > 0)) return purchaseTenths || 0;
    if (nowTenths == null || !(nowTenths > 0)) return purchaseTenths;
    return nowTenths >= purchaseTenths
        ? purchaseTenths + Math.floor((nowTenths - purchaseTenths) / 2)
        : nowTenths;
}

// ===== PLAYER PHOTOS =====
/* The club's headshot for a player, addressed the way premierleague.com
 * addresses it today.
 *
 * The path moved and the filename changed with it. What the site serves now is
 *   /premierleague25/photos/players/110x140/219168.png
 * where the older library was
 *   /premierleague/photos/players/110x140/p219168.png
 * — a season-scoped directory, and no "p" in front of the number. Reading the
 * old one is why a transferred player still wore his previous club's kit (that
 * library is no longer being reshot) and why anyone signed since it froze —
 * Cherki among them — had no photo at all.
 *
 * Both are tried, newest first, because the old library still answers for
 * players the new one has not needed to republish. A player neither can serve
 * removes the image, which uncovers the initials underneath it.
 *
 * The season segment is the one thing here with a shelf life: when the league
 * rolls to premierleague26, this constant is the only edit.
 */
const PLAYER_PHOTO_BASE = 'https://resources.premierleague.com';
const PLAYER_PHOTO_SEASON = 'premierleague25';

function playerPhotoSrc(code) {
    return `${PLAYER_PHOTO_BASE}/${PLAYER_PHOTO_SEASON}/photos/players/110x140/${code}.png`;
}

function playerPhotoLegacySrc(code) {
    return `${PLAYER_PHOTO_BASE}/premierleague/photos/players/110x140/p${code}.png`;
}

/* Renders the <img> with its own fallback chain. Inline handlers rather than a
 * listener because these cards are rebuilt by innerHTML on every render, and a
 * listener would have to be reattached each time — the CSP already allows
 * inline handlers, and the rest of the codebase uses them. */
function playerPhotoHTML(code, className) {
    if (code == null) return '';
    /* draggable="false" matters on the squad pitch: a .pcard is draggable so
       you can substitute by dragging it, and an <img> inside a draggable
       element is itself draggable by default — so grabbing a card by the
       player's face started an image drag and the substitution never began.
       The crest below opts out for the same reason. */
    /* No loading="lazy", and no class set on load.

       Both were causing the flicker you see when a list re-renders. A lazy
       image that is re-created starts unloaded however warm the cache is, so
       the browser re-runs its in-viewport check before it will even look at
       the bytes — on a 30px avatar that is all cost and no saving, since these
       are almost always on screen already. And hiding the initials from an
       onload handler means every freshly-inserted card shows initials for a
       frame and then swaps them for the face: the flash is the handler, not
       the network.

       The initials are hidden by default now and revealed by CSS only when
       there is no <img> in the avatar at all — which is the case this exists
       for, since a photo that 404s through both URLs removes itself below.
       Nothing has to fire for the common path to look right. */
    return `<img class="${className}" alt="" decoding="async" draggable="false"
        src="${playerPhotoSrc(code)}"
        data-photo-fallback="${playerPhotoLegacySrc(code)}"
        onerror="if (this.dataset.photoFallback) { this.src = this.dataset.photoFallback; delete this.dataset.photoFallback; } else { this.remove(); }">`;
}

// ===== NEWS THUMBNAILS =====
/* Pulling a picture out of an RSS item.
 *
 * The three news views each did this the same way and each got it wrong the
 * same way: `article.thumbnail || article.enclosure?.link`. Those are the two
 * fields rss2json fills in when the feed happens to use <media:thumbnail> or
 * an <enclosure>, and half the Premier League feeds use neither — the BBC and
 * the Guardian put the picture in the item body as an <img>, so most cards fell
 * back to the coloured placeholder even though the article had an image all
 * along.
 *
 * So: those two first, then the body HTML, and only then nothing.
 *
 * Two rules about rewriting what comes back. The scheme is forced to https,
 * because the page is served over https and a http:// image is blocked as
 * mixed content — a URL that would have worked, dropped for a reason nothing
 * on screen explains. And the size is left alone for everything except the
 * BBC: Guardian URLs carry an HMAC over their query string (that trailing
 * `s=`), so "improving" the width on one turns a working image into a 403.
 */
const NEWS_THUMB_SKIP = /(?:^|\/)(?:1x1|pixel|spacer|blank|transparent)\.(?:gif|png|jpg)(?:\?|$)/i;

/* Every <img> in the body, not just the first: a feed that opens its item with
   a tracking pixel would otherwise cost us the real picture two tags later. */
function newsThumbsFromHTML(html) {
    if (!html) return [];
    const out = [];
    const re = /<img[^>]+?src\s*=\s*["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(String(html))) !== null) out.push(m[1]);
    return out;
}

/* The BBC serves the same image at any width from a path segment, and the RSS
   feed asks for a 240px one that is visibly soft on a card. No signature to
   invalidate, so this is safe; nothing else is touched. */
function newsThumbUpgrade(url) {
    return url.replace(/(ichef\.bbci\.co\.uk\/[a-z]+\/[a-z]+\/)\d{2,4}(\/)/i, '$1800$2');
}

/* Anything in the item that looks like a picture, wherever it is.
 *
 * The named fields cover most feeds. The Guardian is the one that defeats them:
 * its items carry no <enclosure> and no <media:thumbnail>, only a stack of
 * <media:content> elements at different widths, and its <description> is the
 * standfirst as plain text with no <img> in it — so every field this function
 * knows the name of is empty and the card falls back to a placeholder.
 *
 * Which field a proxy folds <media:content> into is its own business and has
 * changed before, so rather than guessing another name, this walks the item and
 * takes the first string that reads as an image URL. It only runs when the
 * named fields have already come up empty, so a feed that fills them in
 * properly never reaches it. */
const NEWS_THUMB_IMAGE_URL = /^https?:\/\/[^\s"']+\.(?:jpe?g|png|webp|avif)(?:[?#][^\s"']*)?$/i;
/* Image CDNs whose URLs do not always carry a file extension. Matching the host
   is safe in a scan that is already only looking at one item's own fields. */
const NEWS_THUMB_IMAGE_HOST = /^https?:\/\/(?:i\.guim\.co\.uk|ichef\.bbci\.co\.uk|e\d\.365dm\.com|[a-z0-9-]+\.premierleague\.com|images\.[a-z0-9-]+\.[a-z]+)\//i;

function newsThumbDeepScan(value, depth) {
    if (depth > 4 || value == null) return null;
    if (typeof value === 'string') {
        const url = value.trim();
        if (NEWS_THUMB_SKIP.test(url)) return null;
        return (NEWS_THUMB_IMAGE_URL.test(url) || NEWS_THUMB_IMAGE_HOST.test(url)) ? url : null;
    }
    if (Array.isArray(value)) {
        for (const v of value) {
            const hit = newsThumbDeepScan(v, depth + 1);
            if (hit) return hit;
        }
        return null;
    }
    if (typeof value === 'object') {
        for (const v of Object.values(value)) {
            const hit = newsThumbDeepScan(v, depth + 1);
            if (hit) return hit;
        }
    }
    return null;
}

/* Which field the picture came from, per source, for the run just done.
 *
 * This exists because the answer cannot be worked out from the code. Whether a
 * given feed's image survives depends on how the RSS-to-JSON proxy maps
 * namespaced elements it is not obliged to map at all, and that is a property
 * of a live response — not something a reading of this file, or a test against
 * a hand-written fixture, can settle. So the page counts what it actually got.
 *
 * Read it in the console on the News page: newsThumbReport(). */
const newsThumbStats = Object.create(null);

function newsThumbNote(source, field) {
    if (!source) return;
    const row = newsThumbStats[source] || (newsThumbStats[source] = { total: 0, found: 0, by: Object.create(null) });
    row.total++;
    if (field !== 'none') row.found++;
    row.by[field] = (row.by[field] || 0) + 1;
}

function newsThumbReport() {
    const out = {};
    for (const [source, row] of Object.entries(newsThumbStats)) {
        out[source] = `${row.found}/${row.total} with a picture — ${
            Object.entries(row.by).map(([k, n]) => `${k}: ${n}`).join(', ')}`;
    }
    return out;
}

function newsThumbnail(article, source) {
    if (!article) return null;
    const named = [
        ['thumbnail', article.thumbnail],
        ['enclosure.link', article.enclosure && article.enclosure.link],
        ['enclosure.thumbnail', article.enclosure && article.enclosure.thumbnail],
        ['enclosure.url', article.enclosure && article.enclosure.url],
        ['image', article.image]
    ];
    for (const html of newsThumbsFromHTML(article.content)) named.push(['content img', html]);
    for (const html of newsThumbsFromHTML(article.description)) named.push(['description img', html]);

    for (const [field, raw] of named) {
        if (typeof raw !== 'string') continue;
        const url = raw.trim();
        if (!/^https?:\/\//i.test(url)) continue;
        if (NEWS_THUMB_SKIP.test(url)) continue;
        newsThumbNote(source, field);
        return newsThumbUpgrade(url.replace(/^http:\/\//i, 'https://'));
    }
    const found = newsThumbDeepScan(article, 0);
    newsThumbNote(source, found ? 'deep scan' : 'none');
    return found ? newsThumbUpgrade(found.replace(/^http:\/\//i, 'https://')) : null;
}

// ===== PLAYER IDENTITY =====
/* Face, club badge and position colour — the three marks that say who a row
 * or a card is about, drawn once here and used by the dashboard pitch, the
 * squad pitch, the draft planner, the lineup wizard and both transfer views.
 *
 * Written to be called from anywhere: the club code is looked up through the
 * page's `teams` map when there is one, and everything degrades rather than
 * throwing when there is not. The initials sit under the photo and surface
 * only when the league has published none for that player.
 */
const V2_POS_CLASS = { 1: 'gk', 2: 'def', 3: 'mid', 4: 'fwd' };

function v2TeamCode(teamId, fallbackCode) {
    if (fallbackCode != null) return fallbackCode;
    try {
        if (typeof teams !== 'undefined' && teams && teams[teamId]) return teams[teamId].code;
    } catch (e) { /* no teams map on this page */ }
    return null;
}

function v2Initials(name) {
    return String(name || '')
        .split(/[\s.'\u2019-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(w => w[0].toUpperCase())
        .join('');
}

/* The avatar on its own — a photo over its initials. */
function v2AvatarHTML(player) {
    const esc = typeof escHTML === 'function' ? escHTML : (t => String(t == null ? '' : t));
    return `<span class="v2-pid-avatar">`
        + `<b class="v2-pid-initials" aria-hidden="true">${esc(v2Initials(player && player.name))}</b>`
        + (player && player.code != null && typeof playerPhotoHTML === 'function'
            ? playerPhotoHTML(player.code, 'v2-pid-face') : '')
        + `</span>`;
}

/* The club badge, with its short name behind it for a club the badge endpoint
   does not know yet. */
function v2CrestHTML(player) {
    const esc = typeof escHTML === 'function' ? escHTML : (t => String(t == null ? '' : t));
    const code = v2TeamCode(player && player.teamId, player && player.teamCode);
    return `<span class="v2-pid-crest">`
        + `<span class="v2-pid-crest-fallback">${esc((player && player.team) || '')}</span>`
        + (code != null
            ? `<img src="https://resources.premierleague.com/premierleague/badges/50/t${code}.png"
                 alt="" loading="lazy" draggable="false" onerror="this.remove()">`
            : '')
        + `</span>`;
}

/* Both together — the shape every card and list item uses.
 *
 * `variant` picks the arrangement: nothing for a row, where the mark is small
 * and sits beside the name, or 'v2-pid-portrait' for a pitch card, where the
 * face is the subject and the crest becomes a disc on its lower corner. Same
 * markup either way; the stylesheet does the rest.
 *
 * `extra` is anything the portrait should carry on its other corner — in
 * practice a .v2-pid-num pill with the player's projection or score. It goes
 * inside the mark rather than beside it so it can be positioned against the
 * face without either of them needing a wrapper of its own. */
function v2IdentityHTML(player, variant, extra) {
    return `<span class="v2-pid${variant ? ' ' + variant : ''}">`
        + v2AvatarHTML(player) + v2CrestHTML(player) + (extra || '')
        + `</span>`;
}

/* ===== CLUB COLOURS =====
 * Keyed by the Premier League's own team code — the number in the badge URL —
 * and not by the FPL team id. The id is just alphabetical position in this
 * season's twenty, so it is reassigned every August: last season's 13 was
 * Leicester and this season's is Leeds, and a map keyed on it would quietly
 * dress one club in another's colours the day the new bootstrap lands.
 *
 * [shirt, ink] — the shirt colour and something legible on top of it. Chosen
 * for contrast against the shirt rather than for being the club's own second
 * colour, since white-on-Everton-blue is readable and Everton's white is not
 * the point.
 */
const CLUB_COLOURS = {
    1:  ['#DA291C', '#FFFFFF'],  // Man Utd
    2:  ['#1D428A', '#FFFFFF'],  // Leeds
    3:  ['#EF0107', '#FFFFFF'],  // Arsenal
    4:  ['#241F20', '#FFFFFF'],  // Newcastle
    6:  ['#132257', '#FFFFFF'],  // Spurs
    7:  ['#670E36', '#95BFE5'],  // Aston Villa
    8:  ['#034694', '#FFFFFF'],  // Chelsea
    9:  ['#5FB3E4', '#10233A'],  // Coventry
    11: ['#003399', '#FFFFFF'],  // Everton
    14: ['#C8102E', '#FFFFFF'],  // Liverpool
    17: ['#DD0000', '#FFFFFF'],  // Nott'm Forest
    31: ['#1B458F', '#FFFFFF'],  // Crystal Palace
    36: ['#0057B8', '#FFFFFF'],  // Brighton
    40: ['#3A64A3', '#FFFFFF'],  // Ipswich
    43: ['#6CABDD', '#0B1B3C'],  // Man City
    54: ['#1B1B1B', '#FFFFFF'],  // Fulham
    56: ['#EB172B', '#FFFFFF'],  // Sunderland
    88: ['#F18A00', '#1F1F1F'],  // Hull
    91: ['#DA291C', '#FFFFFF'],  // Bournemouth
    94: ['#E30613', '#FFFFFF']   // Brentford
};
const CLUB_COLOURS_FALLBACK = ['#37003C', '#FFFFFF'];   // the league's own purple

/* { shirt, ink } for a player's club, or the league purple for one we have no
   entry for — a newly promoted side is a wrong colour at worst, never an
   unreadable card. */
function clubColours(player) {
    const code = v2TeamCode(player && player.teamId, player && player.teamCode);
    const pair = (code != null && CLUB_COLOURS[code]) || CLUB_COLOURS_FALLBACK;
    return { shirt: pair[0], ink: pair[1] };
}

/* The 250px portrait. The 110x140 one every row uses is a thumbnail, and at
   the size a hero card wants it is visibly soft. Same fallback chain. */
function playerPhotoLargeHTML(code, className) {
    if (code == null) return '';
    const big = `${PLAYER_PHOTO_BASE}/${PLAYER_PHOTO_SEASON}/photos/players/250x250/${code}.png`;
    // Same reasoning as playerPhotoHTML() above.
    return `<img class="${className}" alt="" decoding="async" draggable="false"
        src="${big}"
        data-photo-fallback="${playerPhotoSrc(code)}"
        data-photo-fallback2="${playerPhotoLegacySrc(code)}"
        onerror="if (this.dataset.photoFallback) { this.src = this.dataset.photoFallback; delete this.dataset.photoFallback; } else if (this.dataset.photoFallback2) { this.src = this.dataset.photoFallback2; delete this.dataset.photoFallback2; } else { this.remove(); }">`;
}

/* The class that paints a position colour down a row's leading edge, replacing
   a GK/DEF/MID/FWD label that costs a column and says the same thing. */
function v2PosEdgeClass(position) {
    return `v2-pos-edge pos-${V2_POS_CLASS[position] || 'mid'}`;
}

/* ===== The account block and its settings =====
 *
 * Everything about "you" was scattered or missing: the notification bell was
 * in the dashboard header, so it existed on one page of thirteen; there was
 * nowhere to see which team you were signed in as except a raw id in a box;
 * and there were no settings at all. The sidebar is the one piece of furniture
 * on every page, so that is where they go.
 *
 * The settings themselves are deliberately small. What is here is what the
 * site can actually honour today — a badge, a name, the two display choices it
 * already respects — plus the plan, which is where the rest will hang.
 */
const V2_SETTINGS_KEY = 'easyfpl_settings';

/* `teamName` used to be an editable field. It is not any more — the name is
   whatever FPL calls your team — but a browser that set one is still carrying
   it, and a stored value nothing writes and everything reads is how a removed
   feature keeps working for the people who used it. It is dropped on read,
   and cleared for good the first time we see it. */
function v2Settings() {
    try {
        const raw = localStorage.getItem(V2_SETTINGS_KEY);
        const st = raw ? JSON.parse(raw) : {};
        if (st && Object.prototype.hasOwnProperty.call(st, 'teamName')) {
            delete st.teamName;
            try { localStorage.setItem(V2_SETTINGS_KEY, JSON.stringify(st)); } catch (e) { /* private mode */ }
        }
        return st;
    } catch (e) { return {}; }
}

function v2SaveSettings(patch) {
    const next = { ...v2Settings(), ...patch };
    try { localStorage.setItem(V2_SETTINGS_KEY, JSON.stringify(next)); } catch (e) { /* private mode */ }
    v2MountAccount();
    /* v2MountAccount() redraws the sidebar's avatar and nothing else, so
       removing a badge cleared it there while the big preview in the open
       Settings sheet kept showing the image that no longer exists. The sheet
       is built from this state too, so it is redrawn from it. */
    v2RefreshSettingsAvatar();
    v2RefreshHeroBadge();
    return next;
}

/* The uploaded badge on the dashboard, beside the team name.

   Called from v2MountAccount() (every page load, after the sidebar exists)
   and from v2SaveSettings() (so uploading or removing one shows immediately
   on the page you did it from). Everywhere but the dashboard the element is
   absent and this is a no-op. */
function v2RefreshHeroBadge() {
    const host = document.getElementById('heroTeamBadge');
    if (!host) return;
    const badge = v2Settings().badge;
    host.hidden = !badge;
    host.innerHTML = badge
        ? `<img src="${(typeof escHTML === 'function' ? escHTML : String)(badge)}" alt="">`
        : '';
}

function v2RefreshSettingsAvatar() {
    const host = document.getElementById('v2SetAvatar');
    if (!host) return;
    const st = v2Settings();
    const esc = typeof escHTML === 'function' ? escHTML : (t => String(t == null ? '' : t));
    host.innerHTML = st.badge
        ? `<img src="${esc(st.badge)}" alt="">`
        : `<b>${esc(v2AccountInitials(v2AccountName()))}</b>`;

    /* And "Remove" only exists while there is something to remove. Adding a
       badge is not handled here: v2UploadBadge() redraws the whole sheet
       once the file has been read, and redrawing it twice would flash. */
    const row = host.closest('.v2-set-row');
    if (!st.badge && row) row.querySelector('.v2-set-ghost[onclick*="badge: null"]')?.remove();
}

/* The badge, or the team's initials under it.

   Stored as a data URL in localStorage, which is the only place a static site
   can put it — so it is capped hard. A 5MB photo straight off a phone would
   fill the origin's whole quota and take the shortlist and the saved lineup
   down with it. */
const V2_BADGE_MAX = 120 * 1024;

function v2AccountInitials(name) {
    return String(name || 'FPL').trim().split(/\s+/).slice(0, 2)
        .map(w => w[0]).join('').toUpperCase() || 'FPL';
}

/* The team's name: what FPL calls it, else nothing pretending to be
   something. Both the sidebar block and the settings modal ask this rather
   than each working it out, which is how the modal came to show "F" for a
   team the sidebar was calling Demo Team FC. */
function v2AccountName() {
    /* Set by whichever page has loaded the manager. The squad page keeps it in
       a global; the dashboard keeps it in a const inside its own loader, which
       is invisible from here — so that page hands it over rather than this one
       reaching for a variable that may not exist. */
    if (typeof window !== 'undefined' && window.__v2TeamName) return window.__v2TeamName;
    try {
        if (typeof managerData !== 'undefined' && managerData && managerData.name) return managerData.name;
    } catch (e) { /* no manager on this page */ }
    /* What the last page that did know called it. */
    try {
        const id = localStorage.getItem('fpl_team_id');
        const remembered = id && localStorage.getItem('fpl_team_name_' + id);
        if (remembered) return remembered;
    } catch (e) { /* private mode */ }
    return 'Your team';
}

/* v2SubmitLandingId() and v2EnterWithTeam() lived here — the handler behind
 * the Team ID field in the landing bar, and the one that saved an id and
 * opened the dashboard.
 *
 * Both are gone with the field. The bar has a Log in link to /dashboard/login
 * now, which is the page scripts/dashboard-gate.js already sends people to,
 * and welcome.html does the saving. Two places asked for the same number and
 * only one of them had room to explain it.
 */

/* The theme row says which mode is on, so it has to be told when that
   changes — including by the fallback switch below it, and by another tab.
   Called on mount and from toggleThemeSmooth(). */
/* Flip the row to the mode it is about to be in, ahead of the theme
   itself. Called from toggleThemeSmooth() before the page snapshot; the
   sync below then agrees with it when the attribute catches up, so the
   two never disagree for longer than the 150ms in between. */
function v2PreflipThemeRow() {
    if (typeof document === 'undefined') return;
    const row = document.getElementById('v2ThemeRow');
    if (!row) return;
    const nextDark = document.documentElement.getAttribute('data-theme') !== 'dark';
    v2MarkThemeRow(row, nextDark);
}

/* Which mode is on. The row's words and marks are all four in the markup;
   this only says which pair is the current one, and CSS reads :hover to
   decide whether to show that pair or the other. */
function v2MarkThemeRow(row, dark) {
    row.classList.toggle('is-dark', dark);
    row.setAttribute('aria-pressed', String(dark));
    /* The visible text changes under the pointer, so the accessible name
       has to be the action rather than a copy of the label. */
    row.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
}

function v2SyncThemeRow() {
    if (typeof document === 'undefined') return;
    const row = document.getElementById('v2ThemeRow');
    if (!row) return;
    v2MarkThemeRow(row, document.documentElement.getAttribute('data-theme') === 'dark');
}

/* One place for a page to say what the team is called. */
function v2SetTeamName(name) {
    if (typeof window === 'undefined' || !name) return;
    window.__v2TeamName = name;
    /* Remembered against the team it belongs to, because only two of the
       thirteen pages fetch a manager and the other eleven were showing
       "Your team" in the sidebar next to that team's ID. Keyed by ID so
       switching teams cannot leave the old name behind, and kept apart
       from the name you may have typed in Settings, which still wins. */
    try {
        const id = localStorage.getItem('fpl_team_id');
        if (id) localStorage.setItem('fpl_team_name_' + id, name);
    } catch (e) { /* private mode: the name lives for this page only */ }
    v2MountAccount();
}

function v2MountAccount() {
    if (typeof document === 'undefined') return;
    const host = document.getElementById('v2Account');
    if (!host) return;

    let teamId = null;
    try { teamId = localStorage.getItem('fpl_team_id'); } catch (e) { /* private mode */ }
    // No team, nothing to name — the Team ID box below is the thing to use.
    host.hidden = !teamId;
    if (!teamId) return;

    const name = v2AccountName();
    const st = v2Settings();

    const avatar = document.getElementById('v2AccountAvatar');
    if (avatar) {
        avatar.innerHTML = st.badge
            ? `<img src="${st.badge}" alt="">`
            : `<b>${(typeof escHTML === 'function' ? escHTML : String)(v2AccountInitials(name))}</b>`;
    }
    const nameEl = document.getElementById('v2AccountName');
    if (nameEl) nameEl.textContent = name;
    v2RefreshHeroBadge();
    /* The name, and under it the ID — two different facts. It used to read
       "Demo Team FC" over "Demo squad · Free", which is the team named twice
       with the only new word buried at the end of the second line. */
    const subEl = document.getElementById('v2AccountSub');
    if (subEl) subEl.textContent = 'ID: ' + teamId;

    /* The plan row, from a hint, then from the account.
       See v2ApplyPlanChrome and v2SyncPlanFromAccount below. */
    v2ApplyPlanChrome(v2PlanHint());
    v2SyncPlanFromAccount();

    v2SyncThemeRow();

    /* The Team ID widget below said the same thing this block says, so two
       controls claimed to be your identity and only one of them could be acted
       on. The whole widget stands down while this is up — hiding only the
       badge inside it left an empty box holding a gap open between "Go
       premium" and the theme switch. Settings and v2ChangeTeam() bring it
       back, which is the only way in to it now. */
    document.getElementById('navTidBadge')?.classList.add('hidden');
    const widget = document.querySelector('.v2-sidebar-team-id');
    if (widget) widget.hidden = true;
}

/* ===== Which plan the menu should describe =====
 *
 * The row used to read st.plan === 'premium' out of this browser's settings,
 * and hide itself when that said yes. Two things wrong with that. It is a
 * value anyone can set in devtools, which is exactly what supabase/schema.sql
 * refuses to allow for the real one. And hiding the row means a paying reader
 * gets no acknowledgement at all — the menu looks identical to a free one,
 * minus a line.
 *
 * So what the chrome says comes from the account, not from a local flag. A
 * paying reader is acknowledged by the PRO badge beside their team name, which
 * is the acknowledgement this menu owes them; the upsell row below it is for
 * people who have not bought yet and is hidden once they have — a standing
 * "Premium" row under a PRO badge says the same thing twice, and the second
 * time in the shape of a button that sells you what you already own.
 *
 * The hint below only decides what to paint before the account answers; it
 * decides nothing else, and it cannot open anything. The gate is at the edge
 * and reads Postgres — see functions/_middleware.js. */
function v2PlanHint() {
    try { return localStorage.getItem('easyfpl_plan_hint') === 'premium'; }
    catch (e) { return false; }
}

function v2ApplyPlanChrome(premium) {
    const planEl = document.getElementById('v2AccountPlan');
    if (planEl) planEl.hidden = !premium;

    const row = document.getElementById('v2Premium');
    if (!row) return;
    row.hidden = !!premium;
    row.classList.toggle('is-member', !!premium);
    const label = row.querySelector('.v2-acct-label');
    if (label) label.textContent = premium ? 'Premium' : 'Go premium';
    row.setAttribute('data-tooltip', premium
        ? 'Your account is on Premium.'
        : 'See what Premium includes.');
}

/* Asked once per page, after the menu has already painted.
 *
 * auth.js is not on every page — on one that lacks it this does nothing and
 * the hint stands, which is the right outcome for a cosmetic label. Nothing
 * here grants access to anything. */
async function v2SyncPlanFromAccount() {
    if (typeof auFetchProfile !== 'function' || typeof auIsPremium !== 'function') return;
    let profile = null;
    try { profile = await auFetchProfile(); } catch (e) { return; }
    if (!profile) return;
    const premium = auIsPremium(profile);
    v2ApplyPlanChrome(premium);
    try { localStorage.setItem('easyfpl_plan_hint', premium ? 'premium' : 'free'); }
    catch (e) { /* private mode: the label just repaints each visit */ }
}

/* The modal. Built on demand rather than shipped in every page's markup,
   because it is a rarely-opened thing and thirteen copies of it in the HTML is
   thirteen copies to keep in step. */
function openSettingsModal(section) {
    if (typeof document === 'undefined') return;
    const esc = typeof escHTML === 'function' ? escHTML : (t => String(t == null ? '' : t));
    const st = v2Settings();
    let teamId = '';
    try { teamId = localStorage.getItem('fpl_team_id') || ''; } catch (e) { /* private mode */ }

    document.getElementById('v2SettingsModal')?.remove();
    /* Same hint as the sidebar row, and for the same reason: this dialog
       describes a plan, it does not grant one. v2SyncPlanFromAccount() has
       already corrected the hint from the account by the time anyone has
       opened a menu. */
    const premium = v2PlanHint();

    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay v2-modal v2-settings" id="v2SettingsModal" onclick="closeSettingsModal(event)">
        <div class="modal-container" role="dialog" aria-modal="true" aria-label="Settings">
            <div class="v2-set-head">
                <span class="v2-section-title">
                    <svg class="v2-sec-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.64 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z"/></svg>
                    Settings
                </span>
                <button class="modal-close" onclick="closeSettingsModal()" aria-label="Close">&times;</button>
            </div>
            <div class="v2-set-body">
                <div class="v2-set-group"${teamId ? '' : ' hidden'}>
                    <div class="v2-set-label">Your team</div>
                    <div class="v2-set-row">
                        <span class="v2-account-avatar lg" id="v2SetAvatar">${st.badge
                            ? `<img src="${st.badge}" alt="">`
                            : `<b>${esc(v2AccountInitials(v2AccountName()))}</b>`}</span>
                        <div class="v2-set-stack">
                            <!-- Shown, not edited. The name belongs to your FPL
                                 entry, so a box you can type a different one
                                 into is a box that makes this page disagree
                                 with the game. The badge is still yours. -->
                            <div class="v2-set-name" id="v2SetName">${esc(v2AccountName())}</div>
                            <div class="v2-set-inline">
                                <label class="v2-set-file">
                                    <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onchange="v2UploadBadge(this)">
                                    <span>Upload badge</span>
                                </label>
                                ${st.badge ? '<button class="v2-set-ghost" onclick="v2SaveSettings({ badge: null })">Remove</button>' : ''}
                            </div>
                            <p class="v2-set-hint">A square image works best. It is stored in this browser only — nothing is uploaded anywhere.</p>
                        </div>
                    </div>
                </div>

                <!-- Both of these are about a squad, and Pricing opens this
                     sheet from the landing page where there is not one. A
                     badge upload and a "Change ID" for an ID you have not
                     given are two groups of nothing to act on. -->
                <div class="v2-set-group"${teamId ? '' : ' hidden'}>
                    <div class="v2-set-label">Connected squad</div>
                    <div class="v2-set-row between">
                        <span class="v2-set-value">${teamId ? 'FPL team ID ' + esc(teamId) : 'No team connected yet'}</span>
                        <span class="v2-set-actions">
                            <button class="v2-set-ghost" onclick="closeSettingsModal(); v2ChangeTeam();">Change ID</button>
                            ${teamId ? '<button class="v2-set-ghost danger" onclick="v2LogOut(this)">Log out</button>' : ''}
                        </span>
                    </div>
                </div>

                <div class="v2-set-group">
                    <div class="v2-set-label">Display</div>
                    <label class="v2-set-check">
                        <input type="checkbox" ${st.compact ? 'checked' : ''} onchange="v2SaveSettings({ compact: this.checked }); v2ApplySettings();">
                        <span>Compact tables — tighter rows, more players on screen</span>
                    </label>
                    <label class="v2-set-check">
                        <input type="checkbox" ${st.hideBench === true ? 'checked' : ''} onchange="v2SaveSettings({ hideBench: this.checked }); v2ApplySettings();">
                        <span>Dim bench players in squad views</span>
                    </label>
                </div>

                <div class="v2-set-group${section === 'plan' ? ' is-target' : ''}" id="v2SetPlan">
                    <div class="v2-set-label">Plan</div>
                    <div class="v2-plan">
                        <div class="v2-plan-card${premium ? '' : ' current'}">
                            <div class="v2-plan-name">Free</div>
                            <div class="v2-plan-price">£0</div>
                            <ul class="v2-plan-list">
                                <li>Every analysis page</li>
                                <li>One squad</li>
                                <li>Data refreshed four times a day</li>
                            </ul>
                            ${premium ? '' : '<span class="v2-plan-tag">Your plan</span>'}
                        </div>
                        <div class="v2-plan-card premium${premium ? ' current' : ''}">
                            <div class="v2-plan-name">Premium</div>
                            <div class="v2-plan-price">£3<span>/month</span></div>
                            <ul class="v2-plan-list">
                                <li>Alerts on your phone before every deadline</li>
                                <li>Unlimited saved drafts and wildcards</li>
                                <li>Full season history and exports</li>
                                <li>Live data during matches</li>
                            </ul>
                            ${premium
                                ? '<span class="v2-plan-tag">Your plan</span>'
                                : '<button class="v2-plan-cta" onclick="v2StartCheckout()">Go premium</button>'}
                        </div>
                    </div>
                    <p class="v2-set-hint">Billing is not live yet — this is what it will cost when it is.</p>
                </div>
            </div>
        </div>
    </div>`);

    /* The page blurs behind it, the way the visual-analysis modal does — the
       overlay itself stays clear rather than frosting over the content. */
    document.body.classList.add('v2-blurred');

    /* And it rises into place rather than appearing. The shell already has
       the transition on it; what it did not have was a state to transition
       from, because the markup was inserted with .open already set and the
       browser has nothing to animate between one frame and the same frame.
       Inserted closed, opened on the next paint. */
    const el = document.getElementById('v2SettingsModal');
    if (el) requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('open')));

    if (section === 'plan') {
        document.getElementById('v2SetPlan')?.scrollIntoView({ block: 'nearest' });
    }
}

/* Back to the Team ID input, from wherever you asked. The account block hides
   the badge, so the page's own changeTeamIdNav() is no longer reachable by
   clicking something you can see — this is that door. */
function v2ChangeTeam() {
    const host = document.getElementById('v2Account');
    if (host) host.hidden = true;
    const widget = document.querySelector('.v2-sidebar-team-id');
    if (widget) widget.hidden = false;
    if (typeof showNavTeamInput === 'function') showNavTeamInput();
    document.getElementById('navTeamIdInput')?.focus();
}

function closeSettingsModal(event) {
    // Only the backdrop dismisses, not a click inside the panel.
    if (event && event.target !== event.currentTarget) return;
    const el = document.getElementById('v2SettingsModal');
    document.body.classList.remove('v2-blurred');
    if (!el) return;
    /* Let the same transition run backwards before the node goes. The
       fallback timer is not decoration: transitionend does not fire if the
       element is hidden or the user has reduced motion on, and without it the
       modal would stay in the DOM over the page for ever. */
    el.classList.remove('open');
    let done = false;
    const drop = () => { if (done) return; done = true; el.remove(); };
    el.addEventListener('transitionend', drop, { once: true });
    setTimeout(drop, 320);
}

/* Disconnect.
 *
 * This used to read "the Team ID is the whole of your identity here — there is
 * no account and no server-side session". That was true when it was written
 * and stopped being true the day accounts shipped, and the stale assumption is
 * exactly what produced the bug: forgetting only the Team ID left the account
 * session alive, and the landing page read the id straight back off it. Log
 * out, land on the landing page, get put back where you started, for ever.
 *
 * So both go. The id stored ON THE ACCOUNT stays — that is what carries your
 * squad to a second device, and signing back into the same account is supposed
 * to bring it with you. What must not happen is it coming back when you have
 * not signed back in.
 *
 * auth.js is only loaded on the landing and auth pages, so on a squad page
 * there is nothing here to sign out with. The alternative to the hand-off
 * below is a second copy of the cookie names in this file, and with two
 * definitions of one thing it is always the copy that rots. The landing page
 * has auth.js; it is asked to finish the job.
 *
 * The rest of your settings stay, because they are this browser's preferences
 * rather than that team's. */
async function v2LogOut(btn) {
    const canSignOut = typeof auSignOut === 'function';
    if (btn) { btn.disabled = true; btn.textContent = 'Signing out\u2026'; }

    if (canSignOut) {
        try { await auSignOut(); }
        catch (e) { if (typeof auClearSession === 'function') auClearSession(); }
    }

    /* Cleared last, not first. A squad still loading calls saveTeamId() when
       it resolves, and anything cleared before the await above would be giving
       it a window to write the id back in. */
    try {
        const id = localStorage.getItem('fpl_team_id');
        if (id) localStorage.removeItem('fpl_team_name_' + id);
        localStorage.removeItem('fpl_team_id');
        localStorage.removeItem('fpl_league_id');
        // Whose plan it was a hint about is no longer signed in here.
        localStorage.removeItem('easyfpl_plan_hint');
    } catch (e) { /* private mode: nothing was stored to remove */ }

    closeSettingsModal();
    location.href = canSignOut ? 'index.html' : 'index.html?signout=1';
}

/* Checkout is not built. Saying so is better than a button that does nothing
   and better than a button that pretends. */
function v2StartCheckout() {
    const el = document.querySelector('#v2SetPlan .v2-plan-card.premium .v2-plan-cta');
    if (el) {
        el.textContent = 'Not open yet — soon';
        el.disabled = true;
    }
}

function v2UploadBadge(input) {
    const file = input && input.files && input.files[0];
    if (!file) return;
    if (file.size > V2_BADGE_MAX) {
        const hint = input.closest('.v2-set-stack')?.querySelector('.v2-set-hint');
        if (hint) hint.textContent = `That image is ${Math.round(file.size / 1024)}KB. The limit is ${Math.round(V2_BADGE_MAX / 1024)}KB, because it is stored in this browser alongside your shortlist and saved lineups.`;
        input.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = () => {
        v2SaveSettings({ badge: String(reader.result) });
        openSettingsModal();          // redraw, so the preview and Remove appear
    };
    reader.readAsDataURL(file);
}

/* The two display choices, as classes on <html> for the stylesheets to read. */
function v2ApplySettings() {
    if (typeof document === 'undefined') return;
    const st = v2Settings();
    document.documentElement.classList.toggle('v2-compact', !!st.compact);
    document.documentElement.classList.toggle('v2-dim-bench', !!st.hideBench);
}

/* ===== "How to use this page", on every page that needs one =====
 *
 * My Team had one and nothing else did, and its button lived in a KPI strip
 * halfway down the page — so on the one page that had help you had to know
 * where to look for it, and on the other four there was nothing to look for.
 *
 * The button belongs beside the page's own title, which is the one element
 * every page has in the same place, and it is the first thing on screen. The
 * drawer it opens is the same drawer on all of them; only the content differs,
 * and each page supplies its own.
 *
 * v2MountPageHelp() puts the button in the heading and the drawer at the end
 * of <body>, so a page opts in with one call and no markup.
 */
function v2HelpButtonHTML() {
    /* A question mark, drawn as type rather than as an icon.

       It was an SVG of a ring with a small ? inside it, sitting inside a button
       that is itself a ring — so it read as a green circle with something
       indistinct in the middle, and at 14px the mark simply did not survive.
       A ? is a character; the button is the circle. */
    return '<button type="button" class="v2-page-help" onclick="openHelpOverlay()"'
        + ' aria-label="How to use this page" data-tooltip="How to use this page">?</button>';
}

/* The drawer. `sections` is [{ title, steps: [{ title, text }] }], which is
   the shape the My Team panel already reads as. */
function v2HelpOverlayHTML(heading, intro, sections) {
    const esc = typeof escHTML === 'function' ? escHTML : (t => String(t == null ? '' : t));
    const body = (sections || []).map(sec => `
        <div class="help-section-title">${esc(sec.title)}</div>
        ${(sec.steps || []).map(step => `
            <div class="help-step">
                <div>
                    <div class="help-step-title">${esc(step.title)}</div>
                    <div class="help-step-text">${step.text}</div>
                </div>
            </div>`).join('')}`).join('');

    return `<div class="detail-overlay" id="helpOverlay" onclick="closeHelpOverlay(event)">
        <div class="detail-panel help-panel">
            <div class="detail-header">
                <div class="player-name">How to use this page</div>
                <button class="detail-close" onclick="closeHelpOverlay()" aria-label="Close">&times;</button>
            </div>
            <div class="detail-body">
                <p class="help-intro">${intro}</p>
                ${body}
            </div>
        </div>
    </div>`;
}

/* Open and close. These lived in transfer-wizard.js, which only My Team loads,
   so any other page calling them got a ReferenceError. */
function openHelpOverlay() {
    const el = typeof document !== 'undefined' && document.getElementById('helpOverlay');
    if (!el) return;
    el.classList.add('show');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeHelpOverlay(event) {
    // Only dismiss on a click of the backdrop itself, not the panel inside it.
    if (event && event.target !== event.currentTarget) return;
    const el = typeof document !== 'undefined' && document.getElementById('helpOverlay');
    if (el) el.classList.remove('show');
}

function v2MountPageHelp(intro, sections) {
    if (typeof document === 'undefined') return;
    const title = document.querySelector('.page-title');
    if (title && !title.querySelector('.v2-page-help')) {
        title.insertAdjacentHTML('beforeend', v2HelpButtonHTML());
    }
    if (!document.getElementById('helpOverlay')) {
        document.body.insertAdjacentHTML('beforeend', v2HelpOverlayHTML('', intro, sections));
    }
}

/* ===== The player hero, for anything that shows one player =====
 *
 * A name over the club's colour, the portrait standing on the bottom edge, the
 * crest beside the club. It was written for the squad analysis modal and built
 * inline there, so every other player card on the site invented its own header
 * and none of them matched. This is that header, as one function, so a
 * recommendation card, a rising-form card, a route card and the players page's
 * modal are the same object at three sizes.
 *
 * `opts`:
 *   size   'full' (a modal), 'compact' (a card), 'mini' (a small card)
 *   chip   a short verdict label — "Top pick", "#4", "STAR"
 *   chipClass  a modifier for it
 *   sub    what goes under the club name, if anything
 *
 * The player needs `code` for the portrait and `teamCode`/`teamId` for the
 * crest; without either it degrades to initials and a club name rather than to
 * a hole where a face was.
 */
function v2PlayerHeroHTML(player, opts) {
    if (!player) return '';
    const o = opts || {};
    const esc = typeof escHTML === 'function' ? escHTML : (t => String(t == null ? '' : t));
    const colours = typeof clubColours === 'function'
        ? clubColours(player) : { shirt: '#37003C', ink: '#fff' };
    const code = typeof v2TeamCode === 'function'
        ? v2TeamCode(player.teamId, player.teamCode) : player.teamCode;

    /* The last word is the name people use, and it is what the hero says
       large; anything before it goes above in a lighter weight. A single-word
       name has no first line, and the layout closes up rather than leaving a
       gap where one would have been. */
    const parts = String(player.name || '').trim().split(/\s+/);
    const last = parts.length ? parts[parts.length - 1] : '';
    const first = parts.slice(0, -1).join(' ');

    const sizeClass = o.size === 'mini' ? ' is-mini' : o.size === 'full' ? '' : ' is-compact';
    const price = player.price != null ? `£${Number(player.price).toFixed(1)}m` : '';
    const own = player.ownership != null ? player.ownership
        : (player.selectedBy != null ? player.selectedBy : null);

    return `<div class="pdm-hero${sizeClass}" style="--club:${colours.shirt};--club-ink:${colours.ink};">
        <div class="pdm-hero-shape" aria-hidden="true"></div>
        <div class="pdm-hero-photo">
            ${typeof playerPhotoLargeHTML === 'function' && player.code != null
                ? playerPhotoLargeHTML(player.code, 'pdm-hero-face') : ''}
        </div>
        <div class="pdm-hero-text">
            ${first ? `<span class="pdm-hero-first">${esc(first)}</span>` : ''}
            <span class="pdm-hero-last">${esc(last)}</span>
            <span class="pdm-hero-meta">
                ${code != null ? `<img class="pdm-hero-crest" src="https://resources.premierleague.com/premierleague/badges/50/t${code}.png" alt="" draggable="false" onerror="this.remove()">` : ''}
                <span>${esc(player.team || '')}</span>
                ${o.sub ? `<em>•</em><span>${esc(o.sub)}</span>` : ''}
            </span>
        </div>
        <div class="pdm-hero-side">
            ${o.chip ? `<span class="pdm-hero-chip ${o.chipClass || ''}">${o.chip}</span>` : ''}
            ${price ? `<span class="pdm-hero-price">${price}</span>` : ''}
            ${own != null ? `<span class="pdm-hero-own">${Number(own).toFixed(1)}% owned</span>` : ''}
        </div>
    </div>`;
}

/* ===== Loose card groups become sections =====
 *
 * Several pages are built as a flat run of heading, description, content,
 * heading, description, content — with nothing drawing a boundary between one
 * group and the next except a gap. "Fixture Difficulty Ranking" has a dozen
 * manager cards under it and no box around them, so where that section ends
 * and "Full Ownership Matrix" begins is left to the reader to infer from
 * spacing.
 *
 * Rather than hand-editing fifteen sites of near-identical markup on each
 * page — and getting one of them subtly wrong — this wraps them at load.
 * Every .section-header and everything after it up to the next one becomes
 * one .v2-section, which is the same box the panels elsewhere on the site
 * draw. The markup stays as it is, and a page that later adds a section gets
 * the treatment without anyone remembering to.
 *
 * Idempotent: a header already inside a .v2-section is skipped, so calling it
 * again after a re-render costs nothing.
 */
function v2WrapSections(scope) {
    if (typeof document === 'undefined') return 0;
    const root = scope || document;
    let wrapped = 0;

    root.querySelectorAll('.section-header').forEach(head => {
        if (head.closest('.v2-section')) return;
        const parent = head.parentNode;
        if (!parent) return;

        const box = document.createElement('div');
        box.className = 'v2-section';
        parent.insertBefore(box, head);

        /* Read the next sibling BEFORE moving the current one — appending to
           the box removes it from the run, and its nextElementSibling then
           reads from inside the box rather than from the page. */
        let node = head;
        while (node) {
            const next = node.nextElementSibling;
            box.appendChild(node);
            if (!next || next.classList.contains('section-header')) break;
            node = next;
        }
        wrapped++;
    });
    return wrapped;
}

// ===== SAYING "HERE" =====
/* Three pulses of a ring around the thing you were sent to look at.
 *
 * A link from the dashboard — a fitness doubt in "Needs a look", a
 * notification naming a player — lands you on a page of fifteen rows and six
 * tabs, and the row it meant is somewhere in that. It used to answer the
 * problem by opening the player's card over the page, which is a different
 * screen rather than the one the link promised: you read the card, close it,
 * and are back to looking for the row.
 *
 * Pointing at the row instead keeps you where the work is. Three is enough to
 * catch an eye that was elsewhere while the page loaded and few enough to
 * stop before it becomes something to wait out.
 *
 * An outline rather than a box-shadow, because an outline neither takes part
 * in layout nor replaces a shadow the element already had — the same reason
 * the pitch marks a held card with one. */
const V2_FLASH_MS = 2000;

function v2FlashTarget(target, opts) {
    if (typeof document === 'undefined') return false;
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return false;
    const o = opts || {};

    if (o.scroll !== false && typeof el.scrollIntoView === 'function') {
        try { el.scrollIntoView({ behavior: 'smooth', block: o.block || 'center' }); }
        catch (e) { el.scrollIntoView(); }
    }

    /* Re-flashing the same element has to restart the animation, and removing
       the class is not enough on its own — the browser coalesces the removal
       and the re-add into no change at all. Reading a layout property between
       them forces the reflow that makes it a restart. */
    el.classList.remove('v2-flash');
    void el.offsetWidth;
    el.classList.add('v2-flash');

    clearTimeout(el._v2FlashTimer);
    el._v2FlashTimer = setTimeout(() => el.classList.remove('v2-flash'), V2_FLASH_MS);
    return true;
}

// ===== DISMISSING PANELS =====
/* Click away to close, for every overlay on the site.
 *
 * The drawers could not do this, and not by oversight: .detail-overlay is
 * pointer-events:none on purpose, so that the page behind a panel stays live
 * rather than being sealed behind a backdrop. The consequence nobody followed
 * through on is that the overlay never receives a click either — so the
 * onclick="close...(event)" handlers sitting on those elements have never once
 * fired, and the X has been the only way out.
 *
 * Listening on the document instead keeps the deliberate part (the page is
 * still usable) and fixes the rest. Closing goes through each panel's own
 * close control rather than by stripping its class here, so whatever that
 * control tears down — timers, selection state, a restored scroll position —
 * still happens. Removing the class is only the fallback for a panel that has
 * no close button.
 *
 * The listener is bound only while something is open, and only from the frame
 * after it opens, so the click that opened a panel cannot also close it.
 */
/* `.player-modal` was the players page's own player card, and it is gone: that
   page draws the shared one from scripts/player-profile.js now, which is a
   `.modal-overlay`. Its three class names are off these lists rather than left
   behind, because the lists are the site's register of what an overlay looks
   like and a name in them that matches nothing is a claim that it does. */
const OVERLAY_OPEN_SELECTORS = [
    '.detail-overlay.show',
    '.compare-modal.show',
    '.modal-overlay.open'
];

// The element that actually holds the content — a click inside it is not "outside".
const OVERLAY_CONTENT_SELECTORS = [
    '.detail-panel',
    '.compare-modal-container',
    '.modal-container'
].join(',');

const OVERLAY_CLOSE_SELECTORS = [
    '.detail-close',
    '.compare-modal-close',
    '.modal-close',
    '.drawer-close'
].join(',');

function openOverlays() {
    return [...document.querySelectorAll(OVERLAY_OPEN_SELECTORS.join(','))];
}

function dismissOverlay(overlay) {
    const closer = overlay.querySelector(OVERLAY_CLOSE_SELECTORS);
    if (closer) { closer.click(); return; }
    overlay.classList.remove('show', 'open');
}

function initOverlayDismiss() {
    if (window.__overlayDismissReady) return;
    window.__overlayDismissReady = true;

    let armed = false;

    function onDocumentPointerDown(event) {
        if (!armed) return;
        openOverlays().forEach(overlay => {
            const content = overlay.querySelector(OVERLAY_CONTENT_SELECTORS) || overlay;
            if (!content.contains(event.target)) dismissOverlay(overlay);
        });
    }

    function onKeyDown(event) {
        if (event.key !== 'Escape') return;
        const open = openOverlays();
        if (open.length) dismissOverlay(open[open.length - 1]);
    }

    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    document.addEventListener('keydown', onKeyDown);

    /* Arming is driven by the class the openers already set, so no opener has
       to be told about any of this. */
    const sync = () => {
        const any = openOverlays().length > 0;
        if (!any) { armed = false; return; }
        if (!armed) requestAnimationFrame(() => { armed = openOverlays().length > 0; });
    };

    new MutationObserver(sync).observe(document.documentElement, {
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });
    sync();
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initOverlayDismiss);
    } else {
        initOverlayDismiss();
    }
}

// ===== SECTION ICONS =====
/* One little outline icon in front of each panel heading, drawn from one
   place so the set stays a set.
 *
 * Inline SVG rather than lucide's <i data-lucide>, because these headings sit
 * inside panels that re-render on a ticker — a placeholder would need
 * createIcons() run again after every pass, and the one that got missed would
 * be an empty <i> rather than a wrong icon, which is harder to notice.
 *
 * The house style, matched to lucide so these sit beside the static
 * data-lucide icons elsewhere on the page without looking imported: 24x24
 * box, no fill, 1.8 stroke, round caps and joins, and currentColor so the
 * heading's own colour reaches the icon in both themes.
 */
const V2_ICON_PATHS = {
    // Matchday — a ball.
    ball: '<circle cx="12" cy="12" r="10"/><path d="m12 7 4.2 3.1-1.6 5H9.4l-1.6-5z"/>'
        + '<path d="M12 2v5"/><path d="m2.6 9.4 5.2.6"/><path d="m21.4 9.4-5.2.6"/>'
        + '<path d="m6.8 20.4 2.6-5.3"/><path d="m17.2 20.4-2.6-5.3"/>',
    // Prices — a line going up.
    trend: '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
    // Rivals — people.
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>'
        + '<path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    // The squad — a shirt.
    shirt: '<path d="M20.4 3.5 16 2a4 4 0 0 1-8 0L3.6 3.5a2 2 0 0 0-1.3 2.2l.6 3.5a1 1 0 0 0 1 .8H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.1a1 1 0 0 0 1-.8l.6-3.5a2 2 0 0 0-1.3-2.2z"/>',
    // What happened while you were away.
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    // Headlines.
    news: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9h4"/>'
        + '<path d="M18 6h-8"/><path d="M15 10h-5"/>',
    // The deadline.
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    // Where you rank.
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>'
        + '<path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>'
        + '<path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>'
        + '<path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    // What you have to spend.
    wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/>'
        + '<path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    // The optimiser, and anything else the model did for you.
    sparkle: '<path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/>'
        + '<path d="M12 7c0 2.8 2.2 5 5 5-2.8 0-5 2.2-5 5 0-2.8-2.2-5-5-5 2.8 0 5-2.2 5-5Z"/>',
    // A transfer you have left.
    ticket: '<path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-4Z"/>'
        + '<path d="M13 7v2"/><path d="M13 15v2"/>',
    // A chip.
    chip: '<rect x="4" y="4" width="16" height="16" rx="3"/><rect x="9" y="9" width="6" height="6" rx="1"/>'
        + '<path d="M9 2v2"/><path d="M15 2v2"/><path d="M9 20v2"/><path d="M15 20v2"/>'
        + '<path d="M2 9h2"/><path d="M2 15h2"/><path d="M20 9h2"/><path d="M20 15h2"/>',
    // How much of the gameweek has been played.
    progress: '<circle cx="12" cy="12" r="10"/><path d="M12 12V7"/><path d="M12 12h4.2"/>',
    // Looking back at a gameweek.
    report: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 15l3.5-4 3 2.5L20 7"/>',
    // The four chips, one mark each.
    crown: '<path d="M3 7l4 4 5-7 5 7 4-4-2 12H5L3 7Z"/><path d="M5 20h14"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/>',
    /* The same arc the other way. `refresh` turns clockwise, which reads as
       "do it again"; this one turns back, which is what undoing looks like. */
    revert: '<path d="M21 12a9 9 0 0 0-15-6.7L3 8"/><path d="M3 3v5h5"/>'
        + '<path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
    boost: '<path d="M12 20V6"/><path d="m6 12 6-6 6 6"/><path d="M5 3h14"/>',

    /* The squad and market tickers.
       These were emoji — , , , , , , , , , , , — which
       is twelve different drawing styles from twelve different vendors,
       rendered at whatever weight the reader's platform ships, next to a chip
       row drawn in one consistent 1.8px line. Same marks, drawn the same way. */
    cross: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    bandage: '<rect x="2.6" y="8.6" width="18.8" height="6.8" rx="3.4" transform="rotate(-45 12 12)"/><path d="M10 12h.01M14 12h.01M12 10h.01M12 14h.01"/>',
    flame: '<path d="M12 22c4 0 7-2.6 7-6.5 0-4-3-6-4.5-9.5C13 9 11 8 11 5 8 7 5 10 5 15.5 5 19.4 8 22 12 22Z"/>',
    snowflake: '<path d="M12 2v20M4.2 7 19.8 17M19.8 7 4.2 17"/><path d="m9 4 3 2 3-2M9 20l3-2 3 2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 12h.01M18 12h.01"/>',
    stopwatch: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.6 1.6"/><path d="M9 2h6"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="m6 18 12-12"/>',
    swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
    crosshair: '<circle cx="12" cy="12" r="8"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    up: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
    down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',

    /* ===== The rest of the set =====
       Everything the site used to say with an emoji. They were never a style
       choice so much as an absence of one: eighty different marks drawn by
       eighty different vendors, at whatever weight the reader's platform
       ships, sitting next to a nav and a chip row drawn in one consistent
       1.8px line. Same meanings, drawn the same way. */
    warn: '<path d="M12 3 2 20h20Z"/><path d="M12 10v5M12 18h.01"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m7 15 3-4 3 3 5-7"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
    scales: '<path d="M12 4v16M7 20h10"/><path d="m5 9 3-5 3 5a3 3 0 0 1-6 0Z"/><path d="m13 9 3-5 3 5a3 3 0 0 1-6 0Z"/>',
    shield: '<path d="M12 3 5 6v6c0 4.2 2.9 7.9 7 9 4.1-1.1 7-4.8 7-9V6Z"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.2-5.4-2.9-5.4 2.9 1-6.2L3.2 9.5l6.1-.9Z"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 10h6M9 14h6"/>',
    swords: '<path d="m4 4 9 9-3 3-9-9Z"/><path d="m20 4-9 9 3 3 9-9Z"/><path d="m8 16-4 4M16 16l4 4"/>',
    bench: '<path d="M4 10h16M6 10v9M18 10v9"/><path d="M4 6h16v4H4Z"/>',
    hand: '<path d="M8 12V5a2 2 0 0 1 4 0v6M12 11V4a2 2 0 0 1 4 0v8"/><path d="M16 9a2 2 0 0 1 4 0v5a7 7 0 0 1-7 7h-1a7 7 0 0 1-7-7v-3a2 2 0 0 1 4 0"/>',
    ruler: '<path d="m15 3 6 6L9 21l-6-6Z"/><path d="m8 10 2 2M11 7l2 2M5 13l2 2"/>',
    gloves: '<path d="M6 21V9a2 2 0 0 1 4 0V4a2 2 0 0 1 4 0v5a2 2 0 0 1 4 0v12Z"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.3.3.5.7.5 1.1h6c0-.4.2-.8.5-1.1A6 6 0 0 0 12 3Z"/>',
    brain: '<path d="M9.5 3A3.5 3.5 0 0 0 6 6.5 3 3 0 0 0 4 9.5 3 3 0 0 0 6 12a3 3 0 0 0-2 3 3 3 0 0 0 3 3 3 3 0 0 0 3 3V3Z"/><path d="M14.5 3A3.5 3.5 0 0 1 18 6.5a3 3 0 0 1 2 3 3 3 0 0 1-2 2.5 3 3 0 0 1 2 3 3 3 0 0 1-3 3 3 3 0 0 1-3 3V3Z"/>',
    coins: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    tools: '<path d="m14 6 4-4 4 4-4 4Z"/><path d="M6 22 2 18l9-9 4 4Z"/><path d="m14 10-4-4"/>',
    trash: '<path d="M4 7h16M10 4h4M9 7v12M15 7v12"/><path d="M6 7h12l-1 14H7Z"/>',
    cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12h11L21 7H6"/>',
    siren: '<path d="M6 18a6 6 0 0 1 12 0Z"/><path d="M4 21h16M12 4V2M5 7 3.5 5.5M19 7l1.5-1.5"/>',
    inbox: '<path d="M12 3v10m0 0-4-4m4 4 4-4"/><path d="M3 15h5l1 3h6l1-3h5v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    outbox: '<path d="M12 13V3m0 0-4 4m4-4 4 4"/><path d="M3 15h5l1 3h6l1-3h5v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5Z"/>',
    goal: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/>',
    card: '<rect x="6" y="3" width="12" height="18" rx="2"/>',
    sleep: '<path d="M13 4h6l-6 7h6"/><path d="M4 13h6l-6 7h6"/>',
    cap: '<path d="M2 9l10-5 10 5-10 5Z"/><path d="M6 11.5V17c0 1.7 2.7 3 6 3s6-1.3 6-3v-5.5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
    shuffle: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6M4 4l5 5"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    hospital: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M12 11v6M9 14h6"/><path d="M8 7V4h8v3"/>',
    pencil: '<path d="M4 20h4L20 8l-4-4L4 16Z"/><path d="m14 6 4 4"/>',
    medal: '<circle cx="12" cy="15" r="6"/><path d="m8 3 2.5 6M16 3l-2.5 6"/>',
    palette: '<path d="M12 3a9 9 0 0 0 0 18c1.7 0 2-1.3 1.2-2.2-.8-1 .1-2.3 1.3-2.3H17a4 4 0 0 0 4-4c0-5-4-9.5-9-9.5Z"/><circle cx="8" cy="10" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16" cy="10" r="1"/>',
    crystal: '<path d="M12 3 4 9l8 12 8-12Z"/><path d="M4 9h16M12 3v18"/>',
    flask: '<path d="M10 3v6L4 20h16l-6-11V3"/><path d="M9 3h6"/>',
    folders: '<path d="M3 8a2 2 0 0 1 2-2h3l2 2h6a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M7 6V5a2 2 0 0 1 2-2h3l2 2h4a2 2 0 0 1 2 2v1"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
    pointer: '<path d="M8 3v10l3-2 2 5 2-1-2-5h4Z"/>',
    expand: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5Z"/>',
    next: '<path d="M5 5v14l9-7Z"/><path d="M18 5v14"/>',
    /* A left-pointing arrow for going back a step. The back buttons used `up`,
       which points the wrong way for a flow that runs left to right. */
    back: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>'
};

function v2Icon(name) {
    const paths = V2_ICON_PATHS[name];
    if (!paths) return '';
    return '<svg class="v2-sec-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
        + ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + paths + '</svg>';
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

// FPL's own API goes down or rate-limits for a few minutes right after every
// gameweek deadline while it processes team updates — a manager who already
// has a saved Team ID hitting that window should see an accurate "try again
// shortly" message, not the same copy as a genuinely wrong Team ID.
// fetchWithProxy only ever throws Error('HTTP <status>') on a non-OK response,
// or a bare network/AbortError with no status at all (offline, DNS failure,
// or its own 15-second timeout) — both are read here.
function fplErrorStatus(error) {
    const match = /^HTTP (\d+)$/.exec((error && error.message) || '');
    return match ? parseInt(match[1], 10) : null;
}

// Transient: FPL's own outage/rate-limit, or the request never got an answer
// at all. Not the Team ID's fault — safe to keep it saved and let the
// manager just retry, unlike a 404 where the ID itself needs correcting.
function isTransientFplError(error) {
    const status = fplErrorStatus(error);
    return status === null || status === 502 || status === 503 || status === 504 || status === 429;
}

function friendlyFplErrorMessage(error) {
    const status = fplErrorStatus(error);
    if (status === 404) {
        return "We couldn't find a team with that ID — check the number and try again, or try a demo team below.";
    }
    if (status === 502 || status === 503 || status === 504) {
        return "FPL's own servers are being updated — this happens for a few minutes right after every gameweek deadline. Please try again shortly.";
    }
    if (status === 429) {
        return 'FPL is receiving a lot of requests right now. Please wait a moment and try again.';
    }
    if (status === null) {
        return "Couldn't reach FPL's servers — check your connection and try again.";
    }
    return 'Something went wrong loading your team. Please try again.';
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
    } else if (apiPath === 'api/entry/0/transfers/') {
        /* Read by applyPendingTransfers(). Empty is the honest answer: the demo
           squad is built fresh from the current bootstrap every load, so there
           is no earlier team for a transfer to have moved away from. */
        body = [];
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
    bootstrap: '/data/bootstrap-static.json?v=' + CACHE_BUSTER,
    fixtures:  '/data/fixtures.json?v=' + CACHE_BUSTER,
    players:   '/data/players-data.json?v=' + CACHE_BUSTER,
    teams:     '/data/teams-data.json?v=' + CACHE_BUSTER,
    eventLive: '/data/event-live.json?v=' + CACHE_BUSTER,
    lastUpdated: '/data/last-updated.json?v=' + CACHE_BUSTER,
    // Bookmakers' prices for the upcoming round, written by
    // .github/workflows/fetch-odds.yml. Optional: the Matchday panel is the
    // only reader and it degrades to a message if the file is absent.
    odds:      '/data/odds.json?v=' + CACHE_BUSTER,
    eo:        '/data/eo.json?v=' + CACHE_BUSTER
};

// ===== HTML ESCAPING =====
/* One shape for a player object, whichever page built it.

   Each page maps FPL's `element` into its own player object, and they disagreed
   on one field: three call the position `position`, fpl-league-rivals.html calls
   it `pos`. Nothing errors when they cross — `p.position` on an object that only
   has `pos` is undefined, every comparison is false, and the feature returns an
   empty list. That is how the Transfer Wizard's Favorites tab shipped empty, and
   how the League Rivals position breakdown would have reported every position as
   having no players.

   Rather than rewrite four data paths at once, this guarantees both names are
   present and equal. New mappings should call it; existing readers of either
   name keep working.

   Mutates and returns the same object: these are built in hot .map() loops over
   600+ players and cloning them buys nothing. */
function normalisePlayerShape(player) {
    if (!player || typeof player !== 'object') return player;
    if (player.position == null && player.pos != null) player.position = player.pos;
    else if (player.pos == null && player.position != null) player.pos = player.position;
    return player;
}

/* Escapes for BOTH text and attribute contexts.

   This used to be a textContent -> innerHTML round trip, which escapes & < >
   and nothing else. That is correct for text and unsafe in an attribute, and
   escHTML sits inside 78 title=, data-tooltip=, href=, src= and alt= values
   across the site. A value containing a double quote closed the attribute early
   and everything after it became markup — with 'unsafe-inline' in script-src,
   an injected onerror= or onmouseover= runs.

   The reachable sources are not hypothetical: FPL manager and team names are
   set by users and rendered on the League Rivals page, player news text comes
   from FPL, and the news feeds arrive through a third-party JSON API.

   Entity-encoding the quotes is safe in text too — the browser decodes them
   back for display. */
function escHTML(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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

/* The one place a team id is written.
 *
 * It was not: two other places set localStorage directly and skipped both the
 * check below and, now, the account. Those go through here.
 *
 * The browser copy stays whatever happens — the squad has always loaded from
 * localStorage and still does, so a reader with no account, or a failed write,
 * loses nothing. The account copy is what makes the id follow someone to
 * another browser, and it is written without waiting: nobody is watching for it,
 * and blocking the page on it would make entering an id feel slow for a benefit
 * that arrives on the next device rather than this one. */
function saveTeamId(id) {
    if (!id || !/^\d+$/.test(String(id))) return;
    localStorage.setItem('fpl_team_id', String(id));
    if (typeof auSaveTeamId === 'function') {
        try { Promise.resolve(auSaveTeamId(String(id))).catch(() => {}); } catch (e) { /* not signed in */ }
    }
}

/* The id this account carries, adopted into this browser.
 *
 * For someone signing in on a second device: the account knows the squad, this
 * browser does not. Deliberately one-way and only when the browser has nothing —
 * an id typed here is the more recent intention, and overwriting it with the
 * stored one would undo a change the reader just made. */
async function adoptTeamIdFromAccount() {
    if (typeof auFetchProfile !== 'function') return null;
    if (getSavedTeamId()) return null;
    try {
        const profile = await auFetchProfile();
        const id = profile && profile.fpl_team_id;
        if (!id || !/^\d+$/.test(String(id))) return null;
        localStorage.setItem('fpl_team_id', String(id));
        return String(id);
    } catch (e) {
        return null;
    }
}

function clearTeamId() {
    localStorage.removeItem('fpl_team_id');
}

function loadDemoTeam() {
    saveTeamId(DEMO_TEAM_ID);
    location.reload();
}

/* Is the site being shown with the demo team rather than somebody's real one?

   Demo mode is nothing more than a saved team id of DEMO_TEAM_ID, which
   fetchWithProxy answers locally instead of asking FPL. Because it lives in the
   same place every page reads its team id from, a page that has no team of its
   own — the Players Explorer, say — can still tell it is being used as a
   demonstration. The nav widget is already labelling that id DEMO on screen, so
   this never puts the page in a state the reader cannot see it is in. */
function isDemoMode() {
    return getSavedTeamId() === DEMO_TEAM_ID;
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

    /* The account block above names the team, and the name comes from data
       that arrives after the sidebar does. Re-mounting here catches it: this
       runs when a team id is set, and again on the pass that loads the
       manager. */
    if (typeof v2MountAccount === 'function') v2MountAccount();
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
/* The footer link for the page you are on.
 *
 * The footer is the site map on every page, and a map that never says "you are
 * here" is half a map. The sidebar has done this for a while; this is the same
 * idea in the one other place that lists the whole site.
 *
 * Comparing pathnames needs a normaliser because one page answers to several
 * spellings. Cloudflare Pages serves /fpl-pricing.html at /fpl-pricing, the
 * app's screens are rewrites (/dashboard/players is fpl-players-analysis.html),
 * and the dashboard home is / and /dashboard and /dashboard/. Matching on the
 * raw string marks nothing on most of the site.
 *
 * aria-current as well as the class: the colour says it to someone looking and
 * the attribute says it to someone listening.
 */
function footerPathKey(pathname) {
    let p = (pathname || '/').toLowerCase();
    p = p.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
    if (p.length > 1) p = p.replace(/\/+$/, '');
    // The dashboard home, however it was reached.
    if (p === '' || p === '/' || p === '/dashboard') return '/dashboard';
    return p;
}

function markCurrentFooterLink() {
    const footer = document.querySelector('.site-footer');
    if (!footer) return;

    const here = footerPathKey(location.pathname);
    for (const a of footer.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href');
        if (!href || href.startsWith('mailto:') || href.startsWith('#')) continue;

        let dest;
        try { dest = footerPathKey(new URL(href, location.href).pathname); }
        catch (e) { continue; }

        /* The landing page is not the dashboard even though / normalises to it
           for a signed-in reader: the footer's own home link is the marketing
           page, and marking it current on every app screen would be wrong. */
        if (dest === '/dashboard' && here === '/dashboard'
            && !location.pathname.startsWith('/dashboard')) continue;

        if (dest === here) {
            a.classList.add('is-current');
            a.setAttribute('aria-current', 'page');
        }
    }
}

function loadFooter() {
    // Stamped by tools/stamp-version.mjs. This read window.ASSET_V, which
    // nothing in the codebase ever assigned — so the footer sat on the '62'
    // fallback permanently and could not be cache-busted at all.
    fetch('/footer.html?v=357')
        .then(r => r.text())
        .then(h => {
            document.body.insertAdjacentHTML('beforeend', h);
            if (window.lucide) lucide.createIcons();
            markCurrentFooterLink();
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
    // Canonical path rather than the bare package URL, which 302s — the hash has
    // to match the bytes actually executed. integrity and crossOrigin are both
    // required: without CORS the browser cannot read the response to check it.
    s.src = 'https://unpkg.com/lucide@0.577.0/dist/umd/lucide.min.js';
    s.integrity = 'sha384-orgVf2eX2+m1zKAOIi09hD0W6GtVhoOUmqDK+sysYB2JTZ4vS86j4jm+X7a4Nnei';
    s.crossOrigin = 'anonymous';
    s.referrerPolicy = 'no-referrer';
    s.onload = resolve;
    s.onerror = resolve; // degrade gracefully
    document.head.appendChild(s);
});

/* Scroll reveal, shared.
 *
 * This lived as an inline block in index.html, which was fine while index was
 * the only page using .lp-reveal. The feature pages reuse styles/landing.css,
 * and that stylesheet parks a .lp-reveal at opacity 0 until something adds
 * .is-in — so a page with the markup and without this observer showed its
 * screenshots as empty space, permanently.
 *
 * Two class names because the two stylesheets name the state differently:
 * .lp-reveal/.is-in in landing.css, .reveal-on-scroll/.revealed in index's own
 * block. One observer drives both.
 *
 * A section already on screen when the observer is created — the first one
 * always is — gets its class on the first callback, which fires immediately,
 * so nothing above the fold waits for a scroll that may never come. And with
 * no IntersectionObserver at all, every target is revealed outright: a missing
 * animation is a far smaller failure than an invisible page.
 */
function initScrollReveal(root) {
    const scope = root || document;
    const targets = scope.querySelectorAll('.reveal-on-scroll, .lp-reveal');
    if (!targets.length) return;

    if (typeof IntersectionObserver === 'undefined') {
        targets.forEach(el => el.classList.add(
            el.classList.contains('lp-reveal') ? 'is-in' : 'revealed'));
        return;
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add(
                entry.target.classList.contains('lp-reveal') ? 'is-in' : 'revealed');
            observer.unobserve(entry.target);
        });
    }, { threshold: 0.1 });
    targets.forEach(el => observer.observe(el));
}

function initIcons() {
    _lucideReady.then(function() {
        if (typeof lucide !== 'undefined') lucide.createIcons();
    });
}
/* loadNav() and nav.html were removed with the standalone Transfer Wizard,
   the only page still on that nav. Every page now uses loadSidebarNav().
   Keeping both meant every nav change had to be made twice. */


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
    // Through saveTeamId rather than around it, so this path gets the same
    // validation and the same write to the account as every other.
    saveTeamId(val);
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

/* ===== THE CONTROL MENU =====
 *
 * One dropdown, used by every filter bar on the site. See the matching block
 * in styles/v2-design.css for why these exist: the screens had each grown
 * their own stack of control rows, and a page whose top third is chrome is a
 * page you have to scroll before you can read anything.
 *
 * A menu is one question with a fixed set of answers — weighting, sort, view
 * mode, tier. The button carries the current answer so the row still says
 * what the page is showing while the panel is shut.
 */
let v2MenuOpen = null;

/* options: [{ value, label, note, tip }]; onPick is the name of a global
   function taking the value, called as an inline handler. */
function v2MenuHTML({ key, icon, label, value, options, onPick, tip }) {
    const current = (options || []).find(o => o.value === value) || (options || [])[0] || {};
    return `<div class="v2-menu" id="v2menu-${key}">
        <button class="v2-menu-btn" onclick="v2MenuToggle('${key}', event)"
            aria-expanded="false" aria-haspopup="true"${tip ? ` data-tooltip="${escHTML(tip)}"` : ''}>
            ${icon && typeof v2Icon === 'function' ? v2Icon(icon) : ''}${label ? escHTML(label) : ''}
            <span class="v2-menu-v">${escHTML(current.label || '')}</span>
            <span class="v2-menu-caret"></span>
        </button>
        <div class="v2-menu-panel" hidden>
            <div class="v2-menu-group">
                ${label ? `<span class="v2-menu-label">${escHTML(label)}</span>` : ''}
                ${(options || []).map(o => `<button class="v2-menu-opt${o.value === current.value ? ' is-on' : ''}"
                    onclick="${onPick}('${o.value}')"${o.tip ? ` data-tooltip="${escHTML(o.tip)}"` : ''}>
                    <span>${escHTML(o.label)}${o.note ? `<span class="v2-menu-opt-note">${escHTML(o.note)}</span>` : ''}</span>
                </button>`).join('')}
            </div>
        </div>
    </div>`;
}

/* Two menu shapes, one mechanism.

   `.v2-menu` is the value picker — a label, a chosen value, a list. `.apf-menu`
   is the filter panel — a button with a count, opening groups of pills. They
   already share every rule in the stylesheet; they were opened and closed by
   two sets of selectors, so a panel built as one could not be closed by the
   other's Escape key or outside click. Both are handled here now, which is
   what let Step 2's filters become the same component the All Players bar
   uses. */
const V2_MENU_HOSTS = '.v2-menu, .apf-menu';
const V2_MENU_PANELS = '.v2-menu-panel, .apf-panel';
const V2_MENU_BTNS = '.v2-menu-btn, .apf-menu-btn';

function v2MenuToggle(key, event) {
    if (event) event.stopPropagation();
    const opening = v2MenuOpen !== key;
    v2MenuCloseAll();
    if (!opening) return;
    const host = document.getElementById(`v2menu-${key}`);
    if (!host) return;
    v2MenuOpen = key;
    const panel = host.querySelector(V2_MENU_PANELS);
    const btn = host.querySelector(V2_MENU_BTNS);
    if (panel) panel.hidden = false;
    if (btn) btn.setAttribute('aria-expanded', 'true');
    host.classList.add('is-open');
}

/* Re-opens a menu that a re-render has just rebuilt.

   A filter panel holds nine groups and you are usually setting two or three of
   them. Every pick rebuilds the pane it lives in, so without this the panel
   shut on the first click and every subsequent filter cost a reopen — which is
   the whole reason a panel was worth collapsing into in the first place. */
function v2MenuReopen(key) {
    if (!key) return;
    const host = document.getElementById(`v2menu-${key}`);
    if (!host) { v2MenuOpen = null; return; }
    v2MenuOpen = key;
    const panel = host.querySelector(V2_MENU_PANELS);
    const btn = host.querySelector(V2_MENU_BTNS);
    if (panel) panel.hidden = false;
    if (btn) btn.setAttribute('aria-expanded', 'true');
    host.classList.add('is-open');
}

/* Re-points a menu at a new value without re-rendering the markup around it.
   A page that rebuilds its whole view on every change does not need this; one
   that updates a chart in place — where re-rendering the controls would tear
   out the node the click came from — does, or the button keeps showing the
   value you just moved away from. */
function v2MenuSet(key, value) {
    const host = document.getElementById(`v2menu-${key}`);
    if (!host) return;
    let label = '';
    host.querySelectorAll('.v2-menu-opt').forEach(opt => {
        const on = opt.getAttribute('onclick') || '';
        const m = on.match(/\('([^']*)'\)/);
        const v = m ? m[1] : null;
        const hit = v === String(value);
        opt.classList.toggle('is-on', hit);
        if (hit) label = (opt.querySelector('span') || opt).firstChild?.textContent || opt.textContent.trim();
    });
    const out = host.querySelector('.v2-menu-v');
    if (out && label) out.textContent = label;
}

function v2MenuCloseAll() {
    v2MenuOpen = null;
    document.querySelectorAll(V2_MENU_HOSTS).forEach(host => {
        host.classList.remove('is-open');
        const panel = host.querySelector(V2_MENU_PANELS);
        const btn = host.querySelector(V2_MENU_BTNS);
        if (panel) panel.hidden = true;
        if (btn) btn.setAttribute('aria-expanded', 'false');
    });
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('click', (ev) => {
        if (!v2MenuOpen) return;
        /* closest() rather than contains(): picking an option usually rebuilds
           the panel it was in, so by the time this runs the clicked node has
           been replaced and the document no longer holds it. */
        if (ev.target instanceof Element && ev.target.closest(V2_MENU_HOSTS)) return;
        v2MenuCloseAll();
    });
    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && v2MenuOpen) v2MenuCloseAll();
    });
}

/* ===== FAVOURITE CLUBS =====
 *
 * The clubs a manager actually cares about — usually the one they support and
 * the two or three they own players from. Stored per browser, like the team
 * id, because it is a preference rather than anything FPL knows about.
 *
 * What it changes is order, never inclusion: a starred club's news and its
 * row in a ranking come first, and everything else still follows underneath.
 * A filter that quietly dropped the other nineteen clubs would be a different
 * feature, and a worse one.
 */
const FAV_CLUBS_KEY = 'easyfpl_fav_clubs';

function favClubsRead() {
    try {
        const raw = localStorage.getItem(FAV_CLUBS_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list.map(Number).filter(n => Number.isFinite(n)) : [];
    } catch (e) {
        // Storage unreadable (private window, blocked site data): no favourites.
        return [];
    }
}

function favClubsHas(teamId) {
    return favClubsRead().includes(Number(teamId));
}

function favClubsToggle(teamId) {
    const id = Number(teamId);
    const list = favClubsRead();
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    else list.push(id);
    try { localStorage.setItem(FAV_CLUBS_KEY, JSON.stringify(list)); } catch (e) { /* not fatal */ }
    return list.includes(id);
}

/* Starred first, everything else in the order it already had. A stable sort
   is required, not incidental: within each group the caller's ranking — by
   attack, by recency — is the whole point and must survive. */
function favClubsSort(list, teamIdOf) {
    const fav = favClubsRead();
    if (!fav.length) return list;
    return list
        .map((item, i) => ({ item, i, fav: fav.includes(Number(teamIdOf(item))) }))
        .sort((a, b) => (a.fav === b.fav ? a.i - b.i : (a.fav ? -1 : 1)))
        .map(x => x.item);
}

/* The heading of the slide-in panel every page shares.
 *
 * Five places set it and four of them reached for textContent, which printed
 * "<svg class=..." as a line of markup across the top of the panel — the icon
 * arrives as a string of SVG, and textContent's whole job is to not be
 * markup. It was found and fixed once, in the gameweek review, with a comment
 * explaining exactly this; the other four kept doing it, which is what a
 * fix applied at one call site rather than at the thing being called buys you.
 *
 * So the icon and the words are separate arguments and cannot be confused:
 * the icon is our own markup and goes in as markup, the words are escaped.
 * A caller with nothing to draw passes no icon.
 */
function v2SetPanelTitle(id, text, icon) {
    const el = typeof document !== 'undefined' && document.getElementById(id);
    if (!el) return;
    const mark = icon && typeof v2Icon === 'function' ? v2Icon(icon) : '';
    el.innerHTML = mark + (mark ? ' ' : '') + escHTML(String(text));
}

/* ===== Going to a section of a long document =====
 *
 * A table of contents on a page this tall is a navigation control, and a
 * plain #fragment link answers it by teleporting: the whole document is
 * replaced between two frames and the reader has to work out, from the text
 * alone, whether they went up or down and how far. Nothing says the page
 * moved, so nothing says which of the twelve links they pressed.
 *
 * So the page scrolls there instead, and the section says it has arrived.
 * Two separate jobs, and the second is the one that matters: a smooth scroll
 * still ends with a heading at the top of a screen that looks like every
 * other screen. The arrival mark is one pass of the accent down the
 * section's left edge, on the element the link actually names.
 *
 * The hash is still written, with replaceState rather than by letting the
 * browser jump: the address stays copyable and the Back button still leaves
 * the page rather than walking back through its own headings.
 *
 * prefers-reduced-motion turns the scroll back into a jump — the CSS drops
 * the arrival mark to a plain hold, so the destination is still marked.
 * Wired up on the pages with a rail of their own: the FAQ, methodology,
 * privacy and contact.
 */
function initAnchorScroll(selector) {
    if (typeof document === 'undefined') return;
    const links = document.querySelectorAll(selector || 'a[href^="#"]');
    if (!links.length) return;

    const calm = typeof matchMedia === 'function'
        && matchMedia('(prefers-reduced-motion: reduce)').matches;

    links.forEach(a => {
        const href = a.getAttribute('href');
        if (!href || href === '#' || href.length < 2) return;
        a.addEventListener('click', e => {
            let target = null;
            try { target = document.getElementById(decodeURIComponent(href.slice(1))); } catch (err) { return; }
            if (!target) return;             // a link to nothing stays a link to nothing
            e.preventDefault();
            const top = target.getBoundingClientRect().top + window.pageYOffset - stickyOffset();
            window.scrollTo({ top: Math.max(0, top), behavior: calm ? 'auto' : 'smooth' });
            try { history.replaceState(null, '', href); } catch (err) { /* file://, or history blocked */ }
            markArrival(target);
        });
    });
}

/* How far down the window the top of the page actually is.
 *
 * scroll-margin-top would do this in CSS, and it is set — at 24px, chosen
 * before there was a fixed header. Under a 64px bar that lands the heading
 * you asked for behind the navigation, which is the one thing this cannot
 * get wrong. Measuring the bar rather than naming its height means the
 * landing shell, the app shell and the narrow layouts each get their own
 * answer without any of them being written down twice.
 */
function stickyOffset() {
    let h = 0;
    for (const el of document.querySelectorAll('header, .v2-landing-nav, .v2-mobile-bar')) {
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
        const box = el.getBoundingClientRect();
        if (box.top > 4 || box.height === 0) continue;   // not parked at the top of the window
        h = Math.max(h, box.height);
    }
    return h + 24;
}

/* The mark itself. Restarting it on a second click of the same link is the
   whole point — the reader is already there and pressed it again, which is
   the one moment they most need the page to answer — and a class that is
   already set does not restart an animation. Removing it, forcing a reflow
   and setting it again does. */
function markArrival(el) {
    if (!el) return;
    el.classList.remove('is-arrived');
    void el.offsetWidth;
    el.classList.add('is-arrived');
    setTimeout(() => el.classList.remove('is-arrived'), 1400);
}

/* Which section of a long page you are actually reading.
 *
 * The Methodology page has a contents rail beside six thousand words, and
 * until now it was a list of links that never changed — so the rail told you
 * where you could go and nothing about where you were.
 *
 * An IntersectionObserver with a band rather than a line: the root margin
 * clips the viewport to a strip just under the fixed header, and the current
 * section is the topmost heading inside that strip. A plain "is it visible"
 * test lights up three sections at once on a tall screen, and a scroll
 * handler comparing offsets runs on every frame to answer a question that
 * changes a few times a page.
 *
 * `targets` are the headings; the links are found from their ids, so a
 * heading with no link in the rail is simply not tracked rather than an
 * error. Falls back to doing nothing at all, which leaves the rail exactly as
 * it was before this existed.
 */
function initTocSpy(opts) {
    const o = opts || {};
    const rail = document.querySelector(o.rail || '.doc-toc');
    if (!rail || typeof IntersectionObserver === 'undefined') return;

    const links = new Map();
    rail.querySelectorAll('a[href^="#"]').forEach(a => {
        const id = decodeURIComponent(a.getAttribute('href').slice(1));
        if (id) links.set(id, a);
    });
    if (!links.size) return;

    const heads = [...links.keys()]
        .map(id => document.getElementById(id))
        .filter(Boolean);
    if (!heads.length) return;

    /* Everything currently inside the band, in document order, so "topmost"
       is a lookup rather than a sort on every callback. */
    const order = new Map(heads.map((el, i) => [el.id, i]));
    const inBand = new Set();
    let current = null;

    function paint() {
        let best = null;
        for (const id of inBand) {
            if (best === null || order.get(id) < order.get(best)) best = id;
        }
        /* Nothing in the band happens between two sections and while scrolling
           up past the first one. Keeping the last choice is what makes the
           highlight stay put rather than blink off. */
        if (best === null || best === current) return;
        links.get(current)?.classList.remove('is-current');
        links.get(best).classList.add('is-current');
        current = best;
    }

    const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
            if (e.isIntersecting) inBand.add(e.target.id);
            else inBand.delete(e.target.id);
        }
        paint();
    }, {
        /* A band starting just below the header and 45% of the way down.
           Negative bottom margin is what turns the viewport into a strip. */
        rootMargin: `-${o.top || 84}px 0px -55% 0px`,
        threshold: 0
    });
    heads.forEach(el => io.observe(el));

    /* Landing on a #fragment should light the rail immediately rather than
       waiting for the first scroll. */
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash && links.has(hash)) {
        links.get(hash).classList.add('is-current');
        current = hash;
    }
}
