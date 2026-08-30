/* ============================================
   EasyFPL — error monitoring

   There was none. A ReferenceError in a render function took the dashboard's
   whole ticker down and left a blank panel; nothing logged it anywhere durable,
   nothing told the visitor, and it surfaced only because someone pasted a
   console trace. That is the failure mode this file exists to end.

   Three jobs, in order of how much they matter:

     1. Capture   window.onerror and unhandledrejection, plus anything the code
                  reports deliberately via reportError().
     2. Retain    a small ring buffer in localStorage, so a user can say what
                  happened after the fact instead of reproducing it live.
     3. Forward   POST to an endpoint, if one is configured. None is by default,
                  and the site works exactly the same without it.

   Deliberately not a third-party SDK. Loading one costs a request on every page
   for a site whose entire JS budget is hand-managed, and it needs an account and
   a DSN this repo does not have. The sink is pluggable so that decision can be
   revisited without touching any of the capture logic.

   Loads first on every page — it has no dependencies, and anything it loads
   after is code it cannot watch.
   ============================================ */

(function () {
    'use strict';

    var STORE_KEY = 'fpl_error_log';
    var MAX_STORED = 25;          // a ring buffer, not an archive
    var MAX_PER_SESSION = 20;     // a render loop that throws must not flood
    var sent = 0;

    // Set window.FPL_ERROR_ENDPOINT before this script to forward errors.
    // Left undefined, nothing leaves the browser.
    function endpoint() {
        return typeof window.FPL_ERROR_ENDPOINT === 'string' ? window.FPL_ERROR_ENDPOINT : null;
    }

    function nowISO() { try { return new Date().toISOString(); } catch (e) { return ''; } }

    function read() {
        try { var v = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); return Array.isArray(v) ? v : []; }
        catch (e) { return []; }
    }

    function write(list) {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(-MAX_STORED))); } catch (e) { /* quota or private mode */ }
    }

    /* Two errors from the same line are one bug, and a render loop can throw the
       same one hundreds of times. Collapse on a signature rather than storing
       every occurrence. */
    function signature(e) {
        return [e.kind, e.message, e.source, e.line, e.col].join('|');
    }

    function record(entry) {
        entry.at = nowISO();
        entry.page = (location.pathname.split('/').pop() || 'index.html') + location.hash;
        var list = read();
        var sig = signature(entry);
        for (var i = list.length - 1; i >= 0; i--) {
            if (signature(list[i]) === sig) {
                list[i].count = (list[i].count || 1) + 1;
                list[i].at = entry.at;
                write(list);
                return list[i];
            }
        }
        entry.count = 1;
        list.push(entry);
        write(list);
        return entry;
    }

    function forward(entry) {
        var url = endpoint();
        if (!url || sent >= MAX_PER_SESSION) return;
        sent++;
        try {
            var body = JSON.stringify(entry);
            // sendBeacon survives the page being closed, which is exactly when a
            // fatal error tends to be followed by the user leaving.
            if (navigator.sendBeacon && navigator.sendBeacon(url, body)) return;
            fetch(url, { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'application/json' } })
                .catch(function () { /* monitoring must never itself throw */ });
        } catch (e) { /* ditto */ }
    }

    function capture(kind, message, extra) {
        var entry = {
            kind: kind,
            message: String(message == null ? 'unknown' : message).slice(0, 500),
            source: extra && extra.source ? String(extra.source).split('/').pop() : '',
            line: (extra && extra.line) || 0,
            col: (extra && extra.col) || 0,
            stack: extra && extra.stack ? String(extra.stack).slice(0, 1500) : '',
            ua: (navigator.userAgent || '').slice(0, 160)
        };
        var stored = record(entry);
        // First occurrence only: a hundred identical console lines help nobody.
        if (stored.count === 1) forward(stored);
        return stored;
    }

    window.addEventListener('error', function (ev) {
        // Resource load failures (img/script/link) arrive here with no message
        // and a target that is an element. Worth knowing, but they are not the
        // same event as a thrown exception.
        if (ev.target && ev.target !== window && ev.target.tagName) {
            capture('resource', ev.target.tagName + ' failed to load', { source: ev.target.src || ev.target.href || '' });
            return;
        }
        capture('error', ev.message, {
            source: ev.filename, line: ev.lineno, col: ev.colno,
            stack: ev.error && ev.error.stack
        });
    }, true);

    window.addEventListener('unhandledrejection', function (ev) {
        var r = ev.reason;
        capture('unhandledrejection', (r && r.message) || r, { stack: r && r.stack });
    });

    /* For code that catches an error, handles it, and still wants it recorded.
       Most of this codebase's catch blocks degrade deliberately — a failed news
       fetch should not break a page — but silent is not the same as unrecorded,
       and 17 of them currently swallow without trace. */
    window.reportError = function (err, context) {
        return capture('handled', (err && err.message) || err, {
            stack: err && err.stack,
            source: context || ''
        });
    };

    /* Support surface. A user who hits something can be asked to run
       fplErrorLog() in the console and paste the result, which beats
       "what were you doing at the time". */
    window.fplErrorLog = function () { return read(); };
    window.fplErrorLogClear = function () { write([]); return 'cleared'; };
})();
