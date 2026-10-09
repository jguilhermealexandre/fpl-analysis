/* The shared report shell, and where in the document it has to live.

   THE BUG THIS EXISTS FOR. #optReportOverlay is declared inside
   <div class="v2-main-content">, and that is exactly the element
   `body.v2-blurred` blurs. Opening it as a modal while it sat there broke three
   things at once, and only the first is visible as a blur:

     - it is a descendant of the blurred box, so it blurred itself;
     - a `filter` on an ancestor makes that ancestor the containing block for
       position:fixed children, so the overlay's `inset: 0` stopped meaning the
       viewport and started meaning the whole article — a vertically centred
       panel landed halfway down a very tall page, below the fold;
     - the same CSS rule sets pointer-events:none, so nothing inside it could be
       clicked.

   None of that is visible in the markup, in the CSS, or in a render test: it is
   a fact about which element is an ancestor of which at the moment a class is
   added. So what is asserted here is the position in the tree, which is the only
   observable the three faults share.

   A DOM is needed because reparenting is the fix. It is the smallest one that
   can be got wrong — appendChild MOVES a node that already has a parent, and a
   shim that copied instead would let the original bug pass. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

const SRC = 'scripts/pitch-snapshot.js';

class El {
    constructor(tag, cls) {
        this.tag = tag;
        this.children = [];
        this.parentNode = null;
        this.innerHTML = '';
        this._class = new Set(String(cls || '').split(/\s+/).filter(Boolean));
    }
    get classList() {
        return {
            add: (...c) => c.forEach(x => this._class.add(x)),
            remove: (...c) => c.forEach(x => this._class.delete(x)),
            contains: c => this._class.has(c),
            toggle: (c, on) => { if (on) this._class.add(c); else this._class.delete(c); }
        };
    }
    appendChild(c) {
        if (c.parentNode) c.parentNode.removeChild(c);
        c.parentNode = this;
        this.children.push(c);
        return c;
    }
    removeChild(c) {
        const i = this.children.indexOf(c);
        if (i > -1) this.children.splice(i, 1);
        c.parentNode = null;
        return c;
    }
    // Every ancestor's class names, for the containment assertions below.
    ancestorClasses() {
        const out = [];
        for (let n = this.parentNode; n; n = n.parentNode) out.push(...n._class);
        return out;
    }
}

/* The real nesting on fpl-my-team-analysis.html:
   <body> → <div class="v2-main-content"> → the overlay. */
function page() {
    const body = new El('body');
    const main = new El('div', 'v2-main-content');
    const overlay = new El('div', 'detail-overlay');
    const title = new El('div');
    const panelBody = new El('div');
    body.appendChild(main);
    main.appendChild(overlay);
    overlay.appendChild(title);
    overlay.appendChild(panelBody);

    const byId = { optReportOverlay: overlay, optReportTitle: title, optReportBody: panelBody };
    const frames = [];
    const ctx = {
        document: { body, getElementById: id => byId[id] || null },
        // Run the queued frames by hand, so a test can prove the open is not
        // lost when it is deferred.
        requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
        v2SetPanelTitle: (id, text) => { byId[id].innerHTML = text; },
        __flush: () => { while (frames.length) frames.shift()(); }
    };
    return { ctx, body, main, overlay, title, panelBody, flush: ctx.__flush };
}

const open = (ctx) => loadFunction(SRC, 'optReportShow', ctx);
const close = (ctx) => loadFunction(SRC, 'closeOptimizeReport', ctx);

test('opening as a modal lifts the overlay out of the element that gets blurred', () => {
    /* THE REGRESSION. The blur, the fixed-position containing block and the
       dead pointer events are all consequences of this one relationship. */
    const p = page();
    assert.equal(p.overlay.parentNode, p.main, 'starts inside the article');
    open(p.ctx)('Squad report', 'scales', '<p>x</p>', { modal: true });
    assert.equal(p.overlay.parentNode, p.body, 'and ends up a child of <body>');
    assert.ok(!p.overlay.ancestorClasses().includes('v2-main-content'),
        'no ancestor may be the blurred box');
});

test('the drawer is lifted out too, so no ancestor can ever do this to it', () => {
    /* It is not broken today, because nothing blurs the article while a drawer
       is open. It would break identically the day something does — or the day an
       ancestor acquires a transform, which has the same effect on position:fixed
       and none of the visual warning a blur gives. */
    const p = page();
    open(p.ctx)('Optimization report', 'chart', '<p>x</p>');
    assert.equal(p.overlay.parentNode, p.body);
});

test('the move happens once, and a second open does not touch the tree', () => {
    const p = page();
    const show = open(p.ctx);
    show('First', 'chart', '<p>1</p>', { modal: true });
    const after = p.body.children.slice();
    show('Second', 'chart', '<p>2</p>', { modal: true });
    assert.deepEqual(p.body.children, after, 'no second reparent');
    assert.equal(p.panelBody.innerHTML, '<p>2</p>');
});

test('the open survives being deferred to the next paint', () => {
    /* A re-inserted node has no previous computed style to transition from, so
       the fade is deferred by two frames on the open that moves it. If those
       frames never ran, the overlay would be in the document and invisible —
       which is a worse bug than the one being fixed. */
    const p = page();
    open(p.ctx)('Squad report', 'scales', '<p>x</p>', { modal: true });
    assert.ok(!p.overlay.classList.contains('show'), 'not yet');
    p.flush();
    assert.ok(p.overlay.classList.contains('show'), 'shown once the frames run');
});

test('a later open is immediate, because nothing moves', () => {
    const p = page();
    const show = open(p.ctx);
    show('First', 'chart', '<p>1</p>', { modal: true });
    p.flush();
    close(p.ctx)();
    show('Second', 'chart', '<p>2</p>', { modal: true });
    assert.ok(p.overlay.classList.contains('show'), 'no frame wait on the second open');
});

/* ---- which shape it opens in ---- */

test('modal and drawer are set per open, not once and remembered', () => {
    const p = page();
    const show = open(p.ctx);

    show('Squad report', 'scales', '<p>x</p>', { modal: true });
    assert.ok(p.overlay.classList.contains('as-modal'));
    assert.ok(p.body.classList.contains('v2-blurred'), 'the page behind a modal blurs');

    show('Suggested transfers', 'sparkle', '<p>y</p>');
    assert.ok(!p.overlay.classList.contains('as-modal'), 'back to a drawer');
    assert.ok(!p.body.classList.contains('v2-blurred'),
        'a drawer is read beside the page it is about, so the page stays sharp');
});

test('closing clears the blur and keeps the geometry', () => {
    /* as-modal deliberately survives the close: it carries the panel's shape, so
       stripping it here would snap a centred card back to a 520px right-hand
       drawer for the length of the fade-out. */
    const p = page();
    open(p.ctx)('Squad report', 'scales', '<p>x</p>', { modal: true });
    p.flush();
    close(p.ctx)();
    assert.ok(!p.body.classList.contains('v2-blurred'), 'the page comes back');
    assert.ok(!p.overlay.classList.contains('show'));
    assert.ok(p.overlay.classList.contains('as-modal'), 'shape stays for the fade out');
});

test('a click inside the panel does not close it', () => {
    const p = page();
    open(p.ctx)('Squad report', 'scales', '<p>x</p>', { modal: true });
    p.flush();
    close(p.ctx)({ target: p.panelBody, currentTarget: p.overlay });
    assert.ok(p.overlay.classList.contains('show'), 'only the backdrop dismisses');
    assert.ok(p.body.classList.contains('v2-blurred'));
});

test('it does nothing at all on a page with no overlay', () => {
    const ctx = {
        document: { body: new El('body'), getElementById: () => null },
        requestAnimationFrame: fn => fn(),
        v2SetPanelTitle: () => { throw new Error('must not be reached'); }
    };
    assert.doesNotThrow(() => open(ctx)('X', 'chart', '<p>x</p>', { modal: true }));
});
