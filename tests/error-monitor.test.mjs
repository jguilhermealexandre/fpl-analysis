import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, browserStubs } from './helpers/load.mjs';

function boot(extra = {}) {
    const ctx = browserStubs(extra);
    loadScript('scripts/error-monitor.js', ctx);
    return ctx;
}
const throwAt = (ctx, msg, line = 1) =>
    ctx.__listeners.error[0]({ message: msg, filename: 'https://x/index.html', lineno: line, colno: 1 });

test('captures a window error', () => {
    const ctx = boot();
    throwAt(ctx, 'esc is not defined', 4480);
    const [e] = ctx.fplErrorLog();
    assert.equal(e.message, 'esc is not defined');
    assert.equal(e.line, 4480);
    assert.equal(e.source, 'index.html', 'source is trimmed to a filename');
});

test('a throwing render loop produces one record, not hundreds', () => {
    const ctx = boot();
    for (let i = 0; i < 50; i++) throwAt(ctx, 'same error', 10);
    const log = ctx.fplErrorLog();
    assert.equal(log.length, 1);
    assert.equal(log[0].count, 50);
});

test('nothing leaves the browser unless an endpoint is configured', () => {
    const sent = [];
    const ctx = boot({ navigator: { userAgent: 'x', sendBeacon: (u, b) => (sent.push(u), true) } });
    throwAt(ctx, 'boom');
    assert.equal(sent.length, 0);
});

test('with an endpoint, only the first occurrence is forwarded', () => {
    const sent = [];
    const ctx = boot({ navigator: { userAgent: 'x', sendBeacon: (u, b) => (sent.push(u), true) } });
    ctx.FPL_ERROR_ENDPOINT = 'https://collector/x';
    throwAt(ctx, 'repeated', 7);
    throwAt(ctx, 'repeated', 7);
    assert.equal(sent.length, 1);
});

test('the buffer is bounded', () => {
    const ctx = boot();
    for (let i = 0; i < 60; i++) throwAt(ctx, `distinct ${i}`, i);
    assert.ok(ctx.fplErrorLog().length <= 25);
});

test('a blocked localStorage cannot throw out of the handler', () => {
    // Private browsing and quota exhaustion both do this. Monitoring must never
    // become the error it is there to report.
    const ctx = boot();
    ctx.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    assert.doesNotThrow(() => throwAt(ctx, 'after quota'));
});

test('resource failures are classified apart from exceptions', () => {
    const ctx = boot();
    ctx.__listeners.error[0]({ target: { tagName: 'IMG', src: 'https://x/badge.png' } });
    assert.equal(ctx.fplErrorLog()[0].kind, 'resource');
});

test('CSP violations are captured', () => {
    // Blocked resources are otherwise invisible: nothing throws, the page
    // renders, and a feature is simply dead. Cloudflare Web Analytics sat
    // blocked this way after the CSP was first switched on.
    const ctx = boot();
    ctx.__listeners.securitypolicyviolation[0]({
        violatedDirective: 'script-src',
        blockedURI: 'https://static.cloudflareinsights.com/beacon.min.js',
        lineNumber: 1, columnNumber: 1
    });
    const [e] = ctx.fplErrorLog();
    assert.equal(e.kind, 'csp');
    assert.match(e.message, /script-src blocked/);
    assert.match(e.message, /cloudflareinsights/);
});
