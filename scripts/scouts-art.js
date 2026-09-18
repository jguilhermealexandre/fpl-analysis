/* ============================================
   EasyFPL — Scout's Desk artwork

   Every piece on the Desk used to open on the same coloured panel with a
   26px icon in the middle of it, which told a reader nothing about what
   they were about to read and made twenty-four articles look like one
   article printed twenty-four times.

   This draws the card instead: a kicker set large in condensed caps, the
   subject's name under it, and the player's own photograph — the way a
   broadcast graphic does it, because that is the visual language the
   subject already has.

   Two decisions worth stating.

   The palette belongs to the template, not to the club. A club-coloured
   card is a nice idea that fails in practice: the shirt colour lives in
   common.js, which the static article builder cannot load, and twenty
   clubs across nine formats is twenty palettes saying nothing about what
   kind of piece this is. A format's colour is information — red is the
   Hall of Shame, gold is the armband — and it is the same colour every
   week, which is the point.

   And a card with no subject is a designed state, not a broken one. The
   archive predates this and most evergreen pieces have no player at all,
   so a template without a face draws its kicker over the pattern and
   stands on its own.

   Loaded as a plain script in the browser and required by
   scripts/build-articles.js, so it returns strings and touches no DOM.
   ============================================ */

/* Each template is a kicker, a palette, and a shape.

   `ink` is the deep field colour, `accent` the name and the rules under
   the type, `wash` the tint of the diagonal band behind the photo. They
   are chosen so white type clears 7:1 on the field in every one. */
const SD_ART_TEMPLATES = {
    winner:  { kicker: 'Man of the Match', ink: '#0B2E1E', accent: '#F2C14E', wash: '#16452D' },
    shame:   { kicker: 'Hall of Shame',    ink: '#3A0A12', accent: '#FF6B6B', wash: '#5A1020' },
    armband: { kicker: 'The Armband',      ink: '#2A1052', accent: '#F2C14E', wash: '#3E1C74' },
    data:    { kicker: 'Under the Hood',   ink: '#07272E', accent: '#5FD3E0', wash: '#0B3B46' },
    market:  { kicker: 'On the Move',      ink: '#0A2A22', accent: '#4ADE80', wash: '#0F3C30' },
    fixture: { kicker: 'The Fixture Turn', ink: '#0A2140', accent: '#7DB6F5', wash: '#123057' },
    bargain: { kicker: 'Bargain Find',     ink: '#132B10', accent: '#A3E635', wash: '#1D3D18' },
    diff:    { kicker: 'The Differential', ink: '#2B0F38', accent: '#E879F9', wash: '#3E1650' },
    premium: { kicker: 'The Premium Call', ink: '#33230A', accent: '#FBBF24', wash: '#4A3410' },
    tactics: { kicker: 'The Playbook',     ink: '#1B1B1F', accent: '#E5E7EB', wash: '#2A2A31' },
    build:   { kicker: 'Under the Bonnet', ink: '#111827', accent: '#9CA3AF', wash: '#1F2937' }
};

/* The category a generator writes, to the template that suits it. A format
   this does not know falls through to `build`, which is the neutral one —
   grey, no promise about what the piece contains. */
const SD_ART_BY_CATEGORY = {
    'Gameweek Debrief': 'winner',
    'Hall of Shame': 'shame',
    'Captaincy Matrix': 'armband',
    'Strategy': 'armband',
    'Data Deep-Dive': 'data',
    'Market': 'market',
    'Market Watch': 'market',
    'Fixture Watch': 'fixture',
    'Bargain Gems': 'bargain',
    'Budget': 'bargain',
    'Differential Watchlist': 'diff',
    'Differentials': 'diff',
    'Premium Dilemma': 'premium',
    'Tactical': 'tactics',
    'Behind the Build': 'build'
};

function sdArtKey(category) {
    return SD_ART_BY_CATEGORY[category] || 'build';
}

function sdArtTemplate(category) {
    return SD_ART_TEMPLATES[sdArtKey(category)] || SD_ART_TEMPLATES.build;
}

/* The photo, with the same fallback chain the rest of the site uses: the
   current season's library first, then the frozen one, and if neither has
   the player the <img> removes itself and the card is the no-face variant.

   Written out here rather than calling playerPhotoLargeHTML() because that
   lives in common.js, which the static article builder does not load. */
function sdArtPhoto(code, cls) {
    if (code == null || code === '') return '';
    const base = 'https://resources.premierleague.com';
    return `<img class="${cls}" alt="" loading="lazy" decoding="async" draggable="false"`
        + ` src="${base}/premierleague25/photos/players/250x250/${code}.png"`
        + ` data-photo-fallback="${base}/premierleague25/photos/players/110x140/${code}.png"`
        + ` data-photo-fallback2="${base}/premierleague/photos/players/110x140/p${code}.png"`
        + ` onerror="if (this.dataset.photoFallback) { this.src = this.dataset.photoFallback; delete this.dataset.photoFallback; }`
        + ` else if (this.dataset.photoFallback2) { this.src = this.dataset.photoFallback2; delete this.dataset.photoFallback2; }`
        + ` else { this.closest('.sd-art')?.classList.add('is-faceless'); this.remove(); }">`;
}

function sdArtEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* The artwork for one article.

   `variant` is 'lead' (the round's featured piece, and the hero on a
   standalone article page) or 'card' (everything in the grid). Same
   template and same words at both sizes — only the type scale and whether
   the stat line survives differ, which is what keeps a grid of eight
   cards reading as a set rather than as eight posters.

   The subject is optional: `{ name, code, stat }`. Without one the card
   drops to its faceless state, which is why `is-faceless` is set here and
   not only by the photo's error handler. */
function sdArtwork(article, variant) {
    const a = article || {};
    const key = sdArtKey(a.category);
    const t = SD_ART_TEMPLATES[key] || SD_ART_TEMPLATES.build;
    const subject = a.subject || null;
    const name = subject && subject.name ? String(subject.name) : '';
    const face = subject ? sdArtPhoto(subject.code, 'sd-art-face') : '';
    const faceless = !name || !face;

    /* The kicker carries the round when there is one. "Man of the Match"
       is a claim about a particular Saturday, and the archive is a stack
       of Saturdays. */
    const kicker = a.gw != null ? `${t.kicker} · GW${a.gw}` : t.kicker;

    return `<div class="sd-art sd-art--${key}${faceless ? ' is-faceless' : ''}"`
        + ` style="--art-ink:${t.ink};--art-accent:${t.accent};--art-wash:${t.wash}"`
        + ` data-variant="${variant === 'lead' ? 'lead' : 'card'}" aria-hidden="true">`
        + `<span class="sd-art-bars"></span>`
        + (faceless ? '' : `<span class="sd-art-ghost">${sdArtPhoto(subject.code, 'sd-art-ghost-img')}</span>`)
        + `<span class="sd-art-text">`
        + `<span class="sd-art-kicker">${sdArtEsc(kicker)}</span>`
        + (name ? `<span class="sd-art-name">${sdArtEsc(name)}</span>` : '')
        + (subject && subject.stat && variant === 'lead'
            ? `<span class="sd-art-stat">${sdArtEsc(subject.stat)}</span>` : '')
        + `</span>`
        + (faceless ? '' : face)
        + `</div>`;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { sdArtwork, sdArtTemplate, sdArtKey, SD_ART_TEMPLATES, SD_ART_BY_CATEGORY };
}
