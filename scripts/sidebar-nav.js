/* ============================================
   EasyFPL — Sidebar Nav
   Fetch-injects sidebar-nav.html. This is the site's only nav; the older
   nav.html and its loadNav() were retired with the standalone wizard.
   ============================================ */

// Restore the rail preference before the injected sidebar is painted.
try {
    if (localStorage.getItem('easyfpl-sidebar-collapsed') === 'true') {
        document.documentElement.classList.add('v2-sidebar-collapsed');
    }
} catch (error) {
    // Storage can be unavailable in strict/private browser contexts.
}

/* Which shell this visit gets.

   The sidebar is the signed-in one: every item in it leads to a page about
   a squad, and without a saved Team ID every one of those pages opens by
   asking for it. A first-time visitor was still shown the whole rail. So
   there are two shells now, and this is the question that picks between
   them — the same question index.html already answers before first paint
   to decide whether to draw the landing page or the dashboard. */
function v2HasTeam() {
    try { return !!localStorage.getItem('fpl_team_id'); } catch (e) { return false; }
}

function loadSidebarNav() {
    if (!v2HasTeam()) return loadLandingNav();
    document.documentElement.classList.add('v2-shell-app');
    return fetch('sidebar-nav.html?v=209')
        .then(r => r.text())
        .then(html => {
            document.body.insertAdjacentHTML('afterbegin', html);

            // Mark the current page's nav item active.
            // Normalize so clean URLs (e.g. "/index" on Pages) still match
            // the data-page values (which include ".html").
            let page = location.pathname.split('/').pop() || 'index.html';
            if (page === '' || page === 'index') page = 'index.html';
            if (!page.endsWith('.html')) page += '.html';
            let activeItem = document.querySelector(`.v2-nav-item[data-page="${page}"]`);
            /* Clean URLs that are not the filename minus .html. index.html
               rewrites its own address to /dashboard and _redirects serves
               it there, and /squad-analysis is the squad page — so on two
               pages, one of them the most visited, `page` was "dashboard.html"
               and no nav item matched. Nothing looked selected.

               These are the two 200-rewrites in _redirects. Any other alias
               falls through to the link's own href, which is where the nav
               would have taken you and so is the right thing to compare. */
            if (!activeItem) {
                const ALIASES = { '/dashboard': 'index.html', '/squad-analysis': 'fpl-my-team-analysis.html' };
                const here = location.pathname.replace(/\/+$/, '') || '/';
                const aliased = ALIASES[here];
                activeItem = aliased
                    ? document.querySelector(`.v2-nav-item[data-page="${aliased}"]`)
                    : [...document.querySelectorAll('.v2-nav-item[data-page]')].find(a => {
                        const dest = new URL(a.getAttribute('href'), location.href).pathname.replace(/\.html$/, '');
                        return dest === here || dest.replace(/\/index$/, '') === here || here === '/';
                    });
            }
            if (activeItem) activeItem.classList.add('active');

            // Restore Team ID widget from localStorage
            const savedId = getSavedTeamId();
            if (savedId) showNavTeamBadge(savedId);

            const navInput = document.getElementById('navTeamIdInput');
            if (navInput) {
                navInput.addEventListener('keypress', e => {
                    if (e.key === 'Enter') submitTeamIdNav();
                });
            }

            if (window.lucide) lucide.createIcons();

            initSidebarCollapse();
            initSidebarFlyout();
            initMobileNav();
            initV2PageEntrance();

            /* The account block and the display preferences. Both live in the
               sidebar, so both are set up the moment it exists — on every page
               rather than on the dashboard alone. */
            if (typeof v2MountAccount === 'function') v2MountAccount();
            if (typeof v2ApplySettings === 'function') v2ApplySettings();
            /* The notification centre renders into #ntCentre, which is in the
               sidebar rather than the dashboard header. The dashboard fills it
               itself, with the squad and live context the feed is diffed from;
               everywhere else ntMount() draws the same feed out of storage, so
               the bell is on every page rather than on one of thirteen. */
            if (typeof ntMount === 'function') ntMount();
        })
        .catch(error => {
            console.warn('Sidebar navigation could not be loaded:', error);
            return null;
        });
}

/* ===== The narrow-screen shell =====

   Below 1024px the sidebar is a drawer rather than furniture, so
   something has to open it. That something is built here rather than
   added to sidebar-nav.html, so it arrives on all thirteen pages with
   the sidebar itself instead of on the ones someone remembered to edit.

   The bar and the scrim exist at every width; CSS hides them above the
   breakpoint. That way there is no resize handler deciding what should
   exist — the browser decides, which it is much better at, and a phone
   rotated to landscape does not need us to notice. */
/* The landing shell: a top bar rather than a rail. */
function loadLandingNav() {
    document.documentElement.classList.add('v2-shell-landing');
    return fetch('landing-nav.html?v=209')
        .then(r => r.text())
        .then(html => {
            document.body.insertAdjacentHTML('afterbegin', html);

            let page = location.pathname.split('/').pop() || 'index.html';
            if (page === '' || page === 'index') page = 'index.html';
            if (!page.endsWith('.html')) page += '.html';
            document.querySelector(`.v2-landing-links a[data-page="${page}"]`)?.classList.add('active');

            if (window.lucide) lucide.createIcons();
            if (typeof v2ApplySettings === 'function') v2ApplySettings();
            initV2PageEntrance();

            /* Following a link should not leave the menu open over the page
               it just loaded, and an in-page #hash link loads nothing at all,
               so nothing else would ever close it. */
            document.querySelectorAll('.v2-landing-links a').forEach(a =>
                a.addEventListener('click', () => closeLandingNav()));
            document.addEventListener('keydown', e => {
                if (e.key === 'Escape') closeLandingNav();
            });
        })
        .catch(error => {
            console.warn('Landing navigation could not be loaded:', error);
            return null;
        });
}

/* Swap the landing shell for the app one, in place.

   The shell is chosen once, on load, from whether a Team ID is saved —
   which is right for every normal navigation and wrong for the one case
   where that answer changes without one: the form at the foot of the
   landing page, which converts the page into the dashboard where it
   stands. Until this existed, that left the landing header sitting over a
   dashboard with no sidebar, and only a reload put it right. */
function v2EnterAppShell() {
    if (document.querySelector('.v2-sidebar')) return Promise.resolve();
    document.documentElement.classList.remove('v2-shell-landing');
    closeLandingNav();
    document.getElementById('v2LandingNav')?.remove();
    return loadSidebarNav();
}

function toggleLandingNav() {
    document.body.classList.contains('v2-landing-open') ? closeLandingNav() : openLandingNav();
}

function openLandingNav() {
    document.body.classList.add('v2-landing-open');
    document.getElementById('v2LandingBurger')?.setAttribute('aria-expanded', 'true');
}

function closeLandingNav() {
    document.body.classList.remove('v2-landing-open');
    document.getElementById('v2LandingBurger')?.setAttribute('aria-expanded', 'false');
}

function initMobileNav() {
    if (document.querySelector('.v2-mobile-bar')) return;

    const bar = document.createElement('div');
    bar.className = 'v2-mobile-bar';
    bar.innerHTML =
        '<button type="button" class="v2-mobile-bar-btn" id="v2NavOpen" aria-label="Open navigation" aria-expanded="false" aria-controls="v2SidebarDrawer">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">'
        + '<path d="M4 7h16M4 12h16M4 17h16"/></svg></button>'
        + '<span class="v2-mobile-bar-title" id="v2MobileTitle"></span>';

    const scrim = document.createElement('button');
    scrim.type = 'button';
    scrim.className = 'v2-nav-scrim';
    scrim.id = 'v2NavScrim';
    scrim.tabIndex = -1;
    scrim.setAttribute('aria-label', 'Close navigation');

    document.body.insertAdjacentElement('afterbegin', scrim);
    document.body.insertAdjacentElement('afterbegin', bar);

    const drawer = document.querySelector('.v2-sidebar');
    if (drawer) drawer.id = drawer.id || 'v2SidebarDrawer';

    /* The bar names the page you are on, and the sidebar already holds
       that name: the active nav item's label is exactly "Dashboard",
       "My Team", "Players". Better than <title>, which is marketing copy
       ("Your UnfairAdvantage in FPL") on the page that needs it most,
       and better than the <h1>, which is often the team's name rather
       than the page's. Both stay as fallbacks, shortest first. */
    const label = document.getElementById('v2MobileTitle');
    if (label) {
        const nav = document.querySelector('.v2-sidebar .v2-nav-item.active > span');
        const h1 = document.querySelector('.v2-main-content h1, main h1');
        const fromNav = nav ? nav.textContent.trim() : '';
        const fromH1 = h1 ? h1.textContent.trim().replace(/\s+/g, ' ') : '';
        const fromTitle = (document.title || 'EasyFPL').split(/\s+[—–|-]\s+/)[0].trim();
        label.textContent = fromNav || (fromH1 && fromH1.length < 32 ? fromH1 : fromTitle);
    }

    document.getElementById('v2NavOpen')?.addEventListener('click', toggleMobileNav);
    scrim.addEventListener('click', closeMobileNav);

    /* Following a link should not leave the drawer open over the page it
       just loaded — and for an in-page #hash link no load happens at all,
       so nothing else would ever close it. */
    document.querySelectorAll('.v2-sidebar a[href]').forEach(a => {
        a.addEventListener('click', () => closeMobileNav());
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && document.body.classList.contains('v2-nav-open')) closeMobileNav();
    });
}

function toggleMobileNav() {
    if (document.body.classList.contains('v2-nav-open')) closeMobileNav();
    else openMobileNav();
}

function openMobileNav() {
    document.body.classList.add('v2-nav-open');
    document.getElementById('v2NavOpen')?.setAttribute('aria-expanded', 'true');
    document.querySelector('.v2-sidebar .v2-nav-item.active, .v2-sidebar a')?.focus?.({ preventScroll: true });
}

function closeMobileNav() {
    document.body.classList.remove('v2-nav-open');
    document.getElementById('v2NavOpen')?.setAttribute('aria-expanded', 'false');
}

function initSidebarCollapse() {
    const button = document.getElementById('v2SidebarCollapse');
    if (!button) return;

    const syncButton = () => {
        const collapsed = document.documentElement.classList.contains('v2-sidebar-collapsed');
        button.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
        button.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
        button.setAttribute('aria-expanded', String(!collapsed));
    };

    document.querySelectorAll('.v2-nav-item[data-page]').forEach(item => {
        const label = item.querySelector(':scope > span')?.textContent?.trim();
        if (label) item.title = label;
    });

    button.addEventListener('click', () => {
        document.documentElement.classList.add('v2-sidebar-resizing');
        const collapsed = document.documentElement.classList.toggle('v2-sidebar-collapsed');
        try {
            localStorage.setItem('easyfpl-sidebar-collapsed', String(collapsed));
        } catch (error) {
            // The visual toggle still works when persistence is unavailable.
        }
        syncButton();
        window.setTimeout(() => {
            document.documentElement.classList.remove('v2-sidebar-resizing');
        }, 520);
    });

    syncButton();
}

function toggleThemeSmooth() {
    const root = document.documentElement;
    if (root.classList.contains('v2-theme-transition')) return;

    root.classList.add('v2-theme-transition');
    /* The switch moves first, on the live DOM.

       startViewTransition replaces the page with a snapshot while it
       cross-fades, and a CSS transition inside a snapshot does not play —
       the element is a picture. Flipping the row inside the transition
       therefore made the knob appear already at the far end, which is what
       "flat" looked like. Flipping it here, a couple of frames before the
       snapshot is taken, lets its own 440ms travel start on the real
       element; by the time the page dissolves behind it, the switch has
       visibly moved.

       It is also the right order to feel. You pressed the switch, so the
       switch answers, and the room changes because of it. */
    v2PreflipThemeRow();

    if (!document.startViewTransition) {
        toggleTheme();
        window.setTimeout(() => root.classList.remove('v2-theme-transition'), 650);
        return;
    }

    /* Long enough to read as the switch leading, short enough that it is
       still one gesture rather than two events. */
    window.setTimeout(() => {
        const transition = document.startViewTransition(() => toggleTheme());
        transition.finished.finally(() => root.classList.remove('v2-theme-transition'));
    }, 150);
}

// One calm entrance sequence shared by every V2 page: navigation first,
// heading second, then the page's primary content blocks in visual order.
function initV2PageEntrance() {
    if (document.body.classList.contains('v2-sequence-ready')) return;

    const sidebar = document.querySelector('.v2-sidebar');
    const heading = document.querySelector('.v2-page-heading');
    if (sidebar) sidebar.classList.add('v2-enter-sidebar');
    document.querySelectorAll(
        '.v2-main-content > .tabs-container, ' +
        '.v2-main-content > .ticker-bar, ' +
        '.v2-main-content > .news-strip, ' +
        '.v2-main-content > .price-ticker-bar'
    ).forEach(bar => bar.classList.add('v2-enter-topbar'));
    if (heading) heading.classList.add('v2-enter-heading');

    const selectors = [
        '.hero-personalized > .v2-top-row',
        '.hero-personalized > .v2-attention-grid',
        '.hero-personalized > .v2-quick-actions',
        '.hero-personalized > .headlines-widget',
        /* The dashboard's own panels. Each ships display:none and is revealed
           by its renderer once its data lands, so none of them was ever in
           this list and none of them animated — they simply appeared, which
           is why the dashboard felt unlike every other page. */
        '.hero-personalized > .v2-matchday',
        '.hero-personalized > .v2-market',
        '.hero-personalized > .v2-feed',
        '.hero-personalized > .v2-news',
        'main.main-content > .v2-page-hint',
        'main.main-content > .tab-content:not(.hidden) > *',
        'main.main-content > *:not(.header-row):not(.loading-overlay):not(.tab-content):not(#content-area)',
        'main.content > *:not(.v2-page-heading):not(.skeleton-container)',
        '.hero-banner .hero-inner > *',
        '.news-page-header > .news-page-sub',
        '#content-area > *:not(.skeleton-container)',
        '#newsDisplay > *:not(.skeleton-container)',
        '.faq-container > *',
        '.how-it-works-container > *',
        '.how-it-works-content > *'
    ];
    const selectorList = selectors.join(',');

    function isEntranceBlock(element) {
        return element instanceof HTMLElement &&
            element !== heading &&
            !element.classList.contains('hidden') &&
            element.style.display !== 'none' &&
            !element.classList.contains('skeleton-container') &&
            !element.closest('.modal-overlay, .loading-overlay');
    }

    function registerBlocks(elements, late = false) {
        [...new Set(elements)].filter(isEntranceBlock).forEach((element, index) => {
            if (element.classList.contains('v2-enter-block')) return;
            element.classList.add('v2-enter-block');
            if (late) element.classList.add('v2-enter-late');
            element.style.setProperty('--v2-enter-order', Math.min(index, 7));
        });
    }

    registerBlocks(document.querySelectorAll(selectorList));

    // Start on the next painted frame so the browser always has a stable
    // initial state to animate from instead of flashing final content first.
    requestAnimationFrame(() => {
        document.body.classList.add('v2-sequence-ready');
    });

    // API-backed pages replace skeletons after the initial shell is ready.
    // Animate those real panels when they arrive, using the same visual rhythm.
    const observer = new MutationObserver(mutations => {
        const addedBlocks = [];
        mutations.forEach(mutation => {
            /* An empty panel filled by innerHTML reports its children as the
               addition; the block that should animate is the container they
               landed in. Reading the target as well as the added nodes covers
               both shapes with one rule. */
            if (mutation.target instanceof HTMLElement) {
                const host = mutation.target.closest(selectorList);
                if (host) addedBlocks.push(host);
            }
            mutation.addedNodes.forEach(node => {
                if (!(node instanceof HTMLElement)) return;
                if (node.matches(selectorList)) addedBlocks.push(node);
                addedBlocks.push(...node.querySelectorAll(selectorList));
            });
        });
        if (addedBlocks.length) registerBlocks(addedBlocks, true);
    });
    observer.observe(document.querySelector('.v2-main-content') || document.body, {
        childList: true,
        subtree: true
    });
}

// Flyout sub-nav — same hover/click-toggle pattern as the top nav's
// mega menu (initMegaMenu in common.js), repositioned to fly out
// from the right edge of each sidebar item instead of dropping down.
function initSidebarFlyout() {
    const groups = document.querySelectorAll('.v2-nav-group[data-flyout]');
    let openTimer = null;
    let closeTimer = null;
    let currentOpen = null;

    function openFlyout(group) {
        clearTimeout(closeTimer);
        if (currentOpen && currentOpen !== group) {
            currentOpen.classList.remove('open');
            const oldToggle = currentOpen.querySelector('.v2-flyout-toggle');
            if (oldToggle) oldToggle.setAttribute('aria-expanded', 'false');
        }
        group.classList.add('open');
        const toggle = group.querySelector('.v2-flyout-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'true');
        currentOpen = group;
    }

    function closeAll() {
        clearTimeout(openTimer);
        clearTimeout(closeTimer);
        groups.forEach(group => {
            group.classList.remove('open');
            const toggle = group.querySelector('.v2-flyout-toggle');
            if (toggle) toggle.setAttribute('aria-expanded', 'false');
        });
        currentOpen = null;
    }

    function scheduleClose() {
        clearTimeout(openTimer);
        closeTimer = setTimeout(closeAll, 400);
    }

    /* Hover opens the flyout, and a hover that ends closes it 400ms later.
       On a touch screen a tap emits a synthetic mouseenter and then a
       mouseleave, so tapping the chevron opened the section and the phantom
       mouseleave closed it again while you were still looking at it — the
       drawer's disclosure worked for four hundred milliseconds and then
       undid itself.

       Devices that can hover keep all of it; devices that cannot get the
       chevron, which is a real button and does not need the mouse at all. */
    const canHover = typeof window.matchMedia === 'function'
        && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    groups.forEach(group => {
        if (canHover) {
            group.addEventListener('mouseenter', () => {
                clearTimeout(closeTimer);
                openTimer = setTimeout(() => openFlyout(group), 150);
            });
            group.addEventListener('mouseleave', () => {
                clearTimeout(openTimer);
                scheduleClose();
            });
        }

        const panel = group.querySelector('.v2-flyout-panel');
        if (panel && canHover) {
            panel.addEventListener('mouseenter', () => clearTimeout(closeTimer));
            panel.addEventListener('mouseleave', scheduleClose);
        }

        // Click/tap the chevron toggles without navigating — the main
        // link's default click still navigates to the item's own page.
        const toggle = group.querySelector('.v2-flyout-toggle');
        if (toggle) {
            toggle.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                if (group.classList.contains('open')) {
                    closeAll();
                } else {
                    openFlyout(group);
                }
            });

            toggle.addEventListener('keydown', e => {
                if (e.key === 'Escape') {
                    closeAll();
                    toggle.focus();
                }
            });
        }
    });

    // Close on outside click
    document.addEventListener('click', e => {
        if (currentOpen && !e.target.closest('.v2-nav-group[data-flyout]')) {
            closeAll();
        }
    });

    // Close on Escape anywhere
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && currentOpen) closeAll();
    });
}
