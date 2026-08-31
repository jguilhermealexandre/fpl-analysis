/* Loads a classic script into a sandbox so its globals can be tested.

   Nothing here is a module — every file under scripts/ declares globals for the
   browser to share across <script> tags, so there is nothing to import. This
   evaluates one in a vm context with whatever browser or page globals the code
   under test needs, and hands the context back.

   The alternative, refactoring production code to be importable, would mean
   changing the architecture to suit the tests. This adapts the tests instead. */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');

/** Minimal browser surface. Enough for code that touches storage or the DOM
 *  incidentally; anything that really needs a DOM belongs in a browser test. */
export function browserStubs(extra = {}) {
    const store = new Map();
    const listeners = {};
    const ctx = {
        console,
        localStorage: {
            getItem: k => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: k => store.delete(k)
        },
        navigator: { userAgent: 'node-test', sendBeacon: () => true },
        location: { pathname: '/index.html', hash: '', search: '' },
        document: {
            createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }),
            getElementById: () => null,
            // Shares the listener map with window: CSP violations are the only
            // document-level event captured, so the names cannot collide.
            addEventListener: (k, f) => { (listeners[k] ||= []).push(f); }
        },
        addEventListener: (k, f) => { (listeners[k] ||= []).push(f); },
        fetch: () => Promise.resolve({ ok: false }),
        setTimeout, clearTimeout,
        __listeners: listeners,
        __store: store,
        ...extra
    };
    ctx.window = ctx;
    ctx.globalThis = ctx;
    return ctx;
}

/** Evaluate a script from the repo in a sandbox and return the context. */
export function loadScript(relPath, stubs = browserStubs()) {
    const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    const ctx = vm.createContext(stubs);
    new vm.Script(src, { filename: relPath }).runInContext(ctx);
    return ctx;
}

/** Evaluate only the inline <script> of an HTML page. Several features live
 *  there rather than in scripts/, and they are exactly the ones with no other
 *  coverage. */
export function loadInline(relPath, stubs = browserStubs()) {
    const html = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    const src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
    const ctx = vm.createContext(stubs);
    new vm.Script(src, { filename: relPath }).runInContext(ctx);
    return ctx;
}

/** Pull one top-level function out of a file and evaluate it alone.
 *  For code whose file has page-wide dependencies but whose logic is pure. */
export function loadFunction(relPath, name, stubs = {}) {
    const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    const start = src.search(new RegExp(`(?:^|\\n)\\s*(?:async\\s+)?function\\s+${name}\\s*\\(`));
    if (start < 0) throw new Error(`${name} not found in ${relPath}`);
    let i = src.indexOf('{', start), depth = 0, end = i;
    for (; end < src.length; end++) {
        if (src[end] === '{') depth++;
        else if (src[end] === '}' && --depth === 0) break;
    }
    const ctx = vm.createContext({ console, ...stubs });
    new vm.Script(`${src.slice(start, end + 1)}\n;globalThis.__fn = ${name};`, { filename: `${relPath}:${name}` }).runInContext(ctx);
    return ctx.__fn;
}
