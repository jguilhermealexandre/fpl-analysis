/* Push alerts, client side.

   This is the only feature on the site that can lose a user outright, and the
   browser permission prompt is one-shot per origin: a refusal cannot be asked
   again, only undone in settings, which nobody does. So the states have to be
   exactly right — offering a button that cannot work spends that one chance,
   and reporting "on" when the subscription is gone means a manager stops
   hearing from us and cannot tell why.

   The encryption in workers/push is not covered here. It cannot be tested
   without a live push service; see that README for the check to run against a
   real deploy. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

/* A browser, assembled from the pieces this file actually touches. Each option
   turns off one capability so a state can be reached deliberately rather than
   by hoping a real browser is in it. */
function load(opts = {}) {
    const o = {
        hasSW: true, hasPush: true, hasNotification: true,
        permission: 'default', subscription: null, standalone: false,
        ua: 'Mozilla/5.0 (Macintosh)', ...opts
    };
    const calls = { subscribed: [], posted: [], unsubscribed: 0 };

    const ctx = {
        console,
        escHTML: (s) => String(s == null ? '' : s),
        atob: (b) => Buffer.from(b, 'base64').toString('binary'),
        localStorage: {
            _d: {},
            getItem(k) { return k in this._d ? this._d[k] : null; },
            setItem(k, v) { this._d[k] = String(v); },
            removeItem(k) { delete this._d[k]; }
        },
        navigator: { userAgent: o.ua },
        document: { getElementById: () => null },
        fetch: async (url, init) => {
            calls.posted.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
            if (String(url).endsWith('/key')) {
                return { ok: true, json: async () => ({ publicKey: 'BFakeKeyForTests_0123456789abcdefghijklmnopqrstuvwxyz-_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab' }) };
            }
            return { ok: true, json: async () => ({ ok: true }) };
        },
        calls
    };
    if (o.standalone) ctx.navigator.standalone = true;

    if (o.hasSW) {
        const sub = o.subscription;
        ctx.navigator.serviceWorker = {
            ready: Promise.resolve({
                pushManager: {
                    getSubscription: async () => sub,
                    subscribe: async (options) => {
                        calls.subscribed.push(options);
                        return { endpoint: 'https://push.example/abc', keys: { p256dh: 'x', auth: 'y' }, unsubscribe: async () => { calls.unsubscribed++; return true; } };
                    }
                }
            })
        };
    }

    ctx.window = ctx; ctx.globalThis = ctx;
    if (o.hasPush) ctx.PushManager = function () {};
    if (o.hasNotification) {
        ctx.Notification = function () {};
        ctx.Notification.permission = o.permission;
        ctx.Notification.requestPermission = async () => o.grant || o.permission;
    }
    ctx.matchMedia = () => ({ matches: !!o.standalone });

    vm.createContext(ctx);
    const f = 'scripts/push-alerts.js';
    new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }).runInContext(ctx);
    return ctx;
}
const evalIn = (ctx, expr) => vm.runInContext(expr, ctx);

test('an iPhone in a Safari tab is told to install, not offered a dead button', () => {
    /* The Push API exists only for a home-screen install on iOS — no version
       of Safari has it in a normal tab. Offering the button there would burn
       the one permission prompt on something that cannot work. */
    const pn = load({ hasPush: false, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' });
    return pn.pnState().then(state => {
        assert.equal(state, 'needs-install');
        const html = pn.pnRenderToggle(state);
        assert.match(html, /home screen/);
        assert.doesNotMatch(html, /<button/, 'no control that cannot do anything');
    });
});

test('the same iPhone installed to the home screen is offered alerts', async () => {
    const pn = load({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', standalone: true });
    assert.equal(await pn.pnState(), 'available');
    assert.match(pn.pnRenderToggle('available'), /Turn on alerts/);
});

test('a browser with no push support renders nothing at all', async () => {
    const pn = load({ hasPush: false, hasNotification: false });
    assert.equal(await pn.pnState(), 'unsupported');
    assert.equal(pn.pnRenderToggle('unsupported'), '', 'absent rather than apologetic');
});

test('a blocked permission is stated rather than re-prompted', async () => {
    // Asking again does nothing — the browser will not show the prompt twice —
    // so the only honest move is to say where it can be undone.
    const pn = load({ permission: 'denied' });
    assert.equal(await pn.pnState(), 'blocked');
    const html = pn.pnRenderToggle('blocked');
    assert.match(html, /blocked/);
    assert.doesNotMatch(html, /<button/);
});

test('state is read from the browser, not from what we stored', async () => {
    /* A subscription revoked in OS settings leaves our own record saying
       everything is fine, and the manager quietly stops hearing from us. */
    const pn = load({ permission: 'granted', subscription: null });
    pn.localStorage.setItem('easyfpl_push', JSON.stringify({ teamId: '123', prefs: {} }));
    assert.equal(await pn.pnState(), 'off', 'stored state does not make it on');

    const live = load({ permission: 'granted', subscription: { endpoint: 'https://push.example/abc' } });
    assert.equal(await live.pnState(), 'on');
});

test('enabling subscribes and registers the squad it is for', async () => {
    const pn = load({ permission: 'default', grant: 'granted' });
    const result = await pn.pnEnable('4089628', { deadline: true, 'squad-news': true });
    assert.equal(result.ok, true);
    assert.equal(result.state, 'on');

    assert.equal(pn.calls.subscribed.length, 1);
    assert.equal(pn.calls.subscribed[0].userVisibleOnly, true, 'required by every push service');
    /* Checked by shape rather than with instanceof: the array is constructed
       inside the vm realm, so it is not an instance of this realm's Uint8Array
       even though it is exactly the right thing. */
    const key = pn.calls.subscribed[0].applicationServerKey;
    assert.equal(key.constructor.name, 'Uint8Array', 'the key is raw bytes, not the base64 string');
    assert.ok(key.length > 0 && key.every(b => b >= 0 && b <= 255), 'and they are bytes');

    const posted = pn.calls.posted.find(c => String(c.url).endsWith('/subscribe'));
    assert.ok(posted, 'the server is told');
    assert.equal(posted.body.teamId, '4089628', 'alerts are about a specific squad, never a broadcast');
    assert.equal(posted.body.prefs.deadline, true);
});

test('a refused prompt reports why instead of failing quietly', async () => {
    const pn = load({ permission: 'default', grant: 'denied' });
    const result = await pn.pnEnable('123');
    assert.equal(result.ok, false);
    assert.equal(result.state, 'blocked');
    assert.match(result.reason, /blocked/, `explains itself: ${result.reason}`);
    assert.equal(pn.calls.subscribed.length, 0, 'and nothing was subscribed');
});

test('a dismissed prompt is not treated as a refusal', async () => {
    // Closing the prompt leaves permission at 'default' and can be asked again
    // later; reporting it as blocked would give up a chance we still have.
    const pn = load({ permission: 'default', grant: 'default' });
    const result = await pn.pnEnable('123');
    assert.equal(result.ok, false);
    assert.equal(result.state, 'available', 'still askable');
});

test('a server that will not hand over a key fails visibly', async () => {
    const pn = load({ permission: 'default', grant: 'granted' });
    pn.fetch = async (url) => String(url).endsWith('/key')
        ? { ok: false, status: 503, json: async () => ({}) }
        : { ok: true, json: async () => ({}) };
    const result = await pn.pnEnable('123');
    assert.equal(result.ok, false);
    assert.match(result.reason, /could not be set up/i);
});

test('disabling tells the server before it drops the subscription', async () => {
    /* Order matters. An endpoint we can no longer reach is one the server would
       otherwise keep pushing to forever. */
    const unsub = { endpoint: 'https://push.example/abc', unsubscribe: async () => true };
    const pn = load({ permission: 'granted', subscription: unsub });
    const result = await pn.pnDisable();
    assert.equal(result.ok, true);
    const told = pn.calls.posted.find(c => String(c.url).endsWith('/unsubscribe'));
    assert.ok(told, 'the server was told');
    assert.equal(told.body.endpoint, 'https://push.example/abc');
    assert.equal(pn.localStorage.getItem('easyfpl_push'), null, 'and the local record is cleared');
});

test('every alert offered says what it will send', async () => {
    // The channel is lost by sending things nobody asked for, so each one has
    // to be describable before it is agreed to.
    const pn = load();
    const alerts = evalIn(pn, 'PN_ALERTS');
    assert.ok(alerts.length >= 2 && alerts.length <= 5, `few and specific, got ${alerts.length}`);
    for (const a of alerts) {
        assert.ok(a.id && a.label, 'named');
        assert.ok(a.detail && a.detail.length > 25, `${a.id} explains itself: ${a.detail}`);
    }
    const defaults = pn.pnDefaultPrefs();
    assert.equal(defaults.price, false, 'the noisiest one is off until asked for');
    assert.equal(defaults.deadline, true);
});

test('the offer lists what will be sent before it is agreed to', () => {
    /* PN_ALERTS carried a label and a description from the start and neither
       ever reached the screen. This permission cannot be asked for twice, so a
       manager who cannot see what he is agreeing to is one who says no
       permanently. */
    const pn = load();
    const alerts = evalIn(pn, 'PN_ALERTS');
    const html = pn.pnRenderToggle('available');
    for (const a of alerts) {
        assert.ok(html.includes(a.label), `"${a.label}" is offered by name`);
        assert.ok(html.includes(a.detail), `and says what it sends`);
    }
    assert.match(html, /<details/, 'expandable rather than a wall of text');
    assert.match(html, /Turn on alerts/);
});

test('an alert left switched off is shown as off, not hidden', () => {
    // Hiding it would make the list a description of the feature rather than
    // of what this manager is actually getting.
    const pn = load({ permission: 'granted', subscription: { endpoint: 'https://push.example/abc' } });
    pn.localStorage.setItem('easyfpl_push', JSON.stringify({ teamId: '1', prefs: { deadline: true, 'squad-news': true, price: false } }));
    const html = pn.pnRenderToggle('on');
    assert.match(html, /pn-item off/, 'the one that is off is marked');
    assert.match(html, /Price moves on your squad/, 'and still named');
});
