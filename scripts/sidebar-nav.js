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

function loadSidebarNav() {
    return fetch('sidebar-nav.html?v=124')
        .then(r => r.text())
        .then(html => {
            document.body.insertAdjacentHTML('afterbegin', html);

            // Mark the current page's nav item active.
            // Normalize so clean URLs (e.g. "/index" on Pages) still match
            // the data-page values (which include ".html").
            let page = location.pathname.split('/').pop() || 'index.html';
            if (page === '' || page === 'index') page = 'index.html';
            if (!page.endsWith('.html')) page += '.html';
            const activeItem = document.querySelector(`.v2-nav-item[data-page="${page}"]`);
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
            initV2PageEntrance();
        })
        .catch(error => {
            console.warn('Sidebar navigation could not be loaded:', error);
            return null;
        });
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
    if (!document.startViewTransition) {
        toggleTheme();
        window.setTimeout(() => root.classList.remove('v2-theme-transition'), 650);
        return;
    }

    const transition = document.startViewTransition(() => toggleTheme());
    transition.finished.finally(() => root.classList.remove('v2-theme-transition'));
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

    groups.forEach(group => {
        group.addEventListener('mouseenter', () => {
            clearTimeout(closeTimer);
            openTimer = setTimeout(() => openFlyout(group), 150);
        });
        group.addEventListener('mouseleave', () => {
            clearTimeout(openTimer);
            scheduleClose();
        });

        const panel = group.querySelector('.v2-flyout-panel');
        if (panel) {
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
