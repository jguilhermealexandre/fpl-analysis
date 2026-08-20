/* ============================================
   EasyFPL — V2 Sidebar Nav (design preview)
   Fetch-injects sidebar-nav.html, mirrors loadNav()'s pattern in common.js.
   Only used by *-v2.html pages — no effect on the live site.
   ============================================ */

function scheduleV2PageReveal() {
    if (window.__v2RevealScheduled) return;
    window.__v2RevealScheduled = true;

    const reveal = () => setTimeout(() => {
        document.documentElement.classList.add('v2-shell-ready');
    }, 350);

    if (document.readyState === 'complete') reveal();
    else window.addEventListener('load', reveal, { once: true });

    // Network errors must never be able to leave the page hidden.
    setTimeout(() => document.documentElement.classList.add('v2-shell-ready'), 2500);
}

scheduleV2PageReveal();

function loadSidebarNav() {
    return fetch('sidebar-nav.html')
        .then(r => r.text())
        .then(html => {
            document.body.insertAdjacentHTML('afterbegin', html);

            // Paint the injected rail once in its hidden state before revealing
            // it, so completing the fetch never produces a visible pop.
            requestAnimationFrame(() => requestAnimationFrame(() => {
                document.documentElement.classList.add('v2-sidebar-ready');
            }));

            // Mark the current page's nav item active.
            // Normalize so clean URLs (e.g. "/index-v2" on Pages) still match
            // the data-page values (which include ".html").
            let page = location.pathname.split('/').pop() || 'index-v2.html';
            if (page === '' || page === 'index-v2') page = 'index-v2.html';
            if (!page.endsWith('.html')) page += '.html';
            const activeItem = document.querySelector(`.v2-nav-item[data-page="${page}"]`);
            if (activeItem) activeItem.classList.add('active');

            // Restore Team ID widget from localStorage (same ids as nav.html)
            const savedId = getSavedTeamId();
            if (savedId) showNavTeamBadge(savedId);

            const navInput = document.getElementById('navTeamIdInput');
            if (navInput) {
                navInput.addEventListener('keypress', e => {
                    if (e.key === 'Enter') submitTeamIdNav();
                });
            }

            if (window.lucide) lucide.createIcons();

            initSidebarFlyout();
            initCalmPageExit();
        })
        .catch(error => {
            console.warn('Sidebar navigation could not be loaded:', error);
            document.documentElement.classList.add('v2-sidebar-ready');
            return null;
        });
}

function initCalmPageExit() {
    if (window.__v2CalmExitReady) return;
    window.__v2CalmExitReady = true;

    document.addEventListener('click', event => {
        const link = event.target.closest('.v2-sidebar a[href]');
        if (!link || event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (link.target && link.target !== '_self') return;

        const destination = new URL(link.href, location.href);
        if (destination.origin !== location.origin || destination.href === location.href) return;
        if (destination.hash && destination.pathname === location.pathname) return;

        event.preventDefault();
        document.documentElement.classList.add('v2-page-leaving');
        setTimeout(() => { location.href = destination.href; }, 280);
    });

    window.addEventListener('pageshow', () => {
        document.documentElement.classList.remove('v2-page-leaving');
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
