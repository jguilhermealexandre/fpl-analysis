/* The activity feed.

   Everything here is a diff against what the page looked like last time, which
   makes the failure modes specific: an event that fires again on every visit, a
   first visit that invents a history it never saw, a live player producing a
   fresh entry every fifteen minutes rather than one that gets rewritten. Each
   of those reads as a working feed and is worthless. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load() {
    const ctx = {
        console,
        escHTML: (s) => String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
        localStorage: {
            _d: {},
            getItem(k) { return k in this._d ? this._d[k] : null; },
            setItem(k, v) { this._d[k] = String(v); },
            removeItem(k) { delete this._d[k]; }
        },
        // Enough of a document for the click-away listener to register.
        document: { getElementById: () => null, querySelector: () => null, addEventListener: () => {} }
    };
    ctx.window = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    const f = 'scripts/notifications.js';
    new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }).runInContext(ctx);
    return ctx;
}

const squad = [
    { id: 1, name: 'Saka', status: 'a', news: '' },
    { id: 2, name: 'Haaland', status: 'a', news: '' },
    { id: 3, name: 'Raya', status: 'a', news: '' }
];
const T0 = Date.UTC(2026, 8, 5, 12, 0);

test('a first visit invents no history', () => {
    /* There is nothing to diff against, and forty things that happened before
       you arrived is noise dressed as a record. */
    const nt = load();
    const events = nt.ntCollect({ squad, live: {}, phase: 'live', gw: 4, now: T0, prev: null });
    assert.deepEqual([...events], []);
});

test('a player picking up a knock is an event, and only once', () => {
    const nt = load();
    const before = nt.ntSnapshot(squad, {}, 'upcoming', 4);
    const hurt = squad.map(p => p.id === 1 ? { ...p, status: 'd', news: 'Knock - 75% chance' } : p);

    const first = nt.ntCollect({ squad: hurt, live: {}, phase: 'upcoming', gw: 4, now: T0, prev: before });
    assert.equal(first.length, 1);
    assert.equal(first[0].kind, 'squad-news');
    assert.equal(first[0].tone, 'bad');
    assert.match(first[0].body, /Saka is a doubt — Knock - 75% chance/);

    // Same state again: the snapshot has moved on, so nothing repeats.
    const after = nt.ntSnapshot(hurt, {}, 'upcoming', 4);
    assert.deepEqual([...nt.ntCollect({ squad: hurt, live: {}, phase: 'upcoming', gw: 4, now: T0 + 1e6, prev: after })], []);
});

test('recovering is reported as the good news it is', () => {
    const nt = load();
    const hurt = squad.map(p => p.id === 1 ? { ...p, status: 'i' } : p);
    const prev = nt.ntSnapshot(hurt, {}, 'upcoming', 4);
    const events = nt.ntCollect({ squad, live: {}, phase: 'upcoming', gw: 4, now: T0, prev });
    assert.equal(events.length, 1);
    assert.equal(events[0].tone, 'good');
    assert.match(events[0].body, /is fit again/);
});

test('a live player gets one entry that is rewritten, not a stream', () => {
    /* The alternative produces twelve rows for one good afternoon: a row at
       kickoff, one per goal, and several more as provisional bonus moves. */
    const nt = load();
    const prev = nt.ntSnapshot(squad, {}, 'live', 4);

    const atHalfTime = nt.ntCollect({
        squad, live: { 1: { pts: 6, min: 45, g: 1 } }, phase: 'live', gw: 4, now: T0, prev
    });
    assert.equal(atHalfTime.length, 1);
    assert.match(atHalfTime[0].title, /Saka — 6 points/);
    assert.match(atHalfTime[0].body, /1 goal/);

    const later = nt.ntCollect({
        squad, live: { 1: { pts: 13, min: 90, g: 2, b: 3 } }, phase: 'live', gw: 4,
        now: T0 + 3600000, prev: nt.ntSnapshot(squad, { 1: { pts: 6, min: 45, g: 1 } }, 'live', 4)
    });
    assert.equal(later[0].id, atHalfTime[0].id, 'the same event, so it replaces rather than stacks');
    assert.match(later[0].title, /13 points/);
    assert.match(later[0].body, /2 goals, 3 bonus · 90'/);

    const merged = nt.ntMerge([atHalfTime[0]], later, T0 + 3600000);
    assert.equal(merged.length, 1, 'one row in the feed, not two');
    assert.match(merged[0].title, /13 points/, 'showing the latest state');
});

test('an unchanged live line produces nothing', () => {
    // Otherwise every fifteen-minute refresh marks the whole squad unread.
    const nt = load();
    const live = { 1: { pts: 2, min: 90 }, 2: { pts: 6, min: 90, g: 1 } };
    const prev = nt.ntSnapshot(squad, live, 'live', 4);
    assert.deepEqual([...nt.ntCollect({ squad, live, phase: 'live', gw: 4, now: T0, prev })], []);
});

test('a red card is bad news however many points he has', () => {
    const nt = load();
    const prev = nt.ntSnapshot(squad, { 1: { pts: 8, min: 60, g: 1 } }, 'live', 4);
    const events = nt.ntCollect({
        squad, live: { 1: { pts: 5, min: 71, g: 1, rc: 1 } }, phase: 'live', gw: 4, now: T0, prev
    });
    assert.equal(events[0].tone, 'bad');
    assert.match(events[0].body, /red card/);
});

test('players outside your squad are ignored', () => {
    // The feed is about your fifteen; the rest of the league is a different page.
    const nt = load();
    const prev = nt.ntSnapshot(squad, {}, 'live', 4);
    const events = nt.ntCollect({
        squad, live: { 999: { pts: 20, min: 90, g: 3 } }, phase: 'live', gw: 4, now: T0, prev
    });
    assert.deepEqual([...events], []);
});

test('the gameweek turning over is an event on its own', () => {
    /* The only kind that fires when nothing about the squad changed at all,
       which is exactly when a manager wonders whether the page is working. */
    const nt = load();
    const prev = nt.ntSnapshot(squad, {}, 'upcoming', 4);
    const locked = nt.ntCollect({ squad, live: {}, phase: 'locked', gw: 4, now: T0, prev });
    assert.equal(locked.length, 1);
    assert.match(locked[0].title, /GW4 is locked/);

    const done = nt.ntCollect({
        squad, live: {}, phase: 'upcoming', gw: 4, now: T0,
        prev: nt.ntSnapshot(squad, {}, 'live', 4)
    });
    assert.match(done[0].title, /GW4 is done/);

    // Standing still is not an event.
    assert.deepEqual([...nt.ntCollect({ squad, live: {}, phase: 'locked', gw: 4, now: T0, prev: nt.ntSnapshot(squad, {}, 'locked', 4) })], []);
});

test('unread is measured against the last time the panel was opened', () => {
    const nt = load();
    const events = [
        { id: 'a', at: T0 - 1000, title: 'Old', body: '', tone: 'info' },
        { id: 'b', at: T0 + 1000, title: 'New', body: '', tone: 'good' }
    ];
    assert.equal(nt.ntUnread(events, T0), 1);
    assert.equal(nt.ntUnread(events, 0), 2, 'never opened means everything is new');
    assert.equal(nt.ntUnread(events, T0 + 5000), 0);
});

test('the log is capped by age and by count', () => {
    const nt = load();
    const old = { id: 'ancient', at: T0 - 20 * 86400000, title: 'x', body: '', tone: 'info' };
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `e${i}`, at: T0 - i * 1000, title: 'x', body: '', tone: 'info' }));
    const merged = nt.ntMerge([old], many, T0);
    assert.ok(merged.length <= 60, `capped, got ${merged.length}`);
    assert.ok(!merged.some(e => e.id === 'ancient'), 'a fortnight is the limit');
    assert.ok(merged[0].at >= merged[merged.length - 1].at, 'newest first');
});

test('a pass persists its snapshot even when it produced nothing', () => {
    /* Otherwise the second visit compares against nothing again, and the first
       real change is missed. */
    const nt = load();
    const first = nt.ntUpdate({ squad, live: {}, phase: 'upcoming', gw: 4, now: T0 });
    assert.equal(first.fresh, 0, 'nothing to say on a first visit');
    assert.ok(first.snapshot && first.snapshot.status[1] === 'a', 'but it remembers');

    const hurt = squad.map(p => p.id === 1 ? { ...p, status: 'i' } : p);
    const second = nt.ntUpdate({ squad: hurt, live: {}, phase: 'upcoming', gw: 4, now: T0 + 86400000 });
    assert.equal(second.fresh, 1, 'and catches the change next time');
    assert.equal(second.unread, 1);
});

test('opening the panel is what marks things read', () => {
    // Marking on render means a badge can be missed by blinking.
    const nt = load();
    nt.ntUpdate({ squad, live: {}, phase: 'upcoming', gw: 4, now: T0 });
    const hurt = squad.map(p => p.id === 1 ? { ...p, status: 'i' } : p);
    const after = nt.ntUpdate({ squad: hurt, live: {}, phase: 'upcoming', gw: 4, now: T0 + 1000 });
    assert.equal(after.unread, 1);

    // Re-rendering without opening leaves it unread.
    assert.equal(nt.ntUpdate({ squad: hurt, live: {}, phase: 'upcoming', gw: 4, now: T0 + 2000 }).unread, 1);

    nt.ntMarkSeen(T0 + 3000);
    assert.equal(nt.ntUpdate({ squad: hurt, live: {}, phase: 'upcoming', gw: 4, now: T0 + 4000 }).unread, 0);
});

test('the panel separates what is new from what is not', () => {
    const nt = load();
    const events = [
        { id: 'b', at: T0 + 1000, title: 'Saka — 13 points', body: '2 goals', tone: 'good', href: 'index.html' },
        { id: 'a', at: T0 - 90000000, title: 'GW3 is done', body: 'planning time', tone: 'info', href: 'index.html' }
    ];
    const html = nt.ntPanelHTML(events, T0, T0 + 2000);
    assert.match(html, /Since your last visit/);
    assert.match(html, /Earlier/);
    assert.match(html, /Saka — 13 points/);
    assert.match(html, /nt-row good/);
    assert.ok(html.indexOf('Since your last visit') < html.indexOf('Earlier'), 'new first');
});

test('an empty feed explains itself rather than showing a blank box', () => {
    const nt = load();
    const html = nt.ntPanelHTML([], 0, T0);
    assert.match(html, /Nothing yet/);
    assert.match(html, /news on your players/);
});

test('names in events are escaped', () => {
    const nt = load();
    const html = nt.ntPanelHTML([{ id: 'x', at: T0, title: '<img src=x onerror=alert(1)>', body: 'y', tone: 'info' }], 0, T0);
    assert.ok(!/<img/.test(html));
    assert.ok(html.includes('&lt;img'));
});

test('the bell only carries a badge when there is something behind it', () => {
    const nt = load();
    assert.doesNotMatch(nt.ntBellHTML(0), /nt-badge/);
    assert.match(nt.ntBellHTML(0), /Nothing new/);
    assert.match(nt.ntBellHTML(3), /nt-badge">3</);
    assert.match(nt.ntBellHTML(14), /9\+/, 'a two-digit badge would not fit and does not need to');
});

test('a finished player is not described as still having time', () => {
    // "yet" is a promise, and at ninety minutes there is nothing left to promise.
    const nt = load();
    const prev = nt.ntSnapshot(squad, {}, 'live', 4);
    const mid = nt.ntCollect({ squad, live: { 1: { pts: 1, min: 40 } }, phase: 'live', gw: 4, now: T0, prev });
    assert.match(mid[0].body, /no returns yet/);

    const full = nt.ntCollect({ squad, live: { 1: { pts: 2, min: 90 } }, phase: 'live', gw: 4, now: T0, prev });
    assert.match(full[0].body, /no returns · 90'/);
    assert.doesNotMatch(full[0].body, /yet/);

    const unused = nt.ntCollect({ squad, live: { 1: { pts: 0, min: 0 } }, phase: 'live', gw: 4, now: T0, prev });
    assert.match(unused[0].body, /yet to feature/);
});
