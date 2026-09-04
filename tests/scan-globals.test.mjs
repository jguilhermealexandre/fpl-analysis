/* The globals scanner, which had been quietly wrong for months.

   Its failures do not look like failures. topLevelNames() finds declarations by
   brace depth, so a mis-lex loses every declaration after that point and
   produces a shorter list — indistinguishable from a smaller file. The only
   visible symptom was eslint.config.mjs going stale, which nothing checks. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { topLevelNames, braceBalance } from '../tools/scan-globals.mjs';

test('a regex literal containing a quote does not swallow the file', () => {
    // escHTML in common.js is `.replace(/'/g, '&#39;')`. The apostrophe inside
    // the regex read as a string opening, ate everything to the next one, and
    // hid the twenty-five declarations that follow — POSITION_CONFIG among them.
    const src = "function escHTML(s) { return s.replace(/'/g, '&#39;'); }\nconst AFTER = 1;";
    const names = topLevelNames(src);
    assert.ok(names.has('escHTML'));
    assert.ok(names.has('AFTER'), 'declarations after a regex literal must stay visible');
    assert.equal(braceBalance(src), 0);
});

test('braces inside a regex do not move the depth', () => {
    assert.ok(topLevelNames('const r = /}{/; function f(){}').has('f'));
    assert.ok(topLevelNames('const v = /[/]{}/g; const AFTER = 1;').has('AFTER'));
});

test('division is not mistaken for a regex', () => {
    // The distinction is the previous significant token; get it wrong in this
    // direction and the lexer eats forward from a `/` that never closes.
    assert.ok(topLevelNames('const a = (b + c) / 2; function f(){}').has('f'));
    assert.ok(topLevelNames('const u = arr[0] / 2; const AFTER = 1;').has('AFTER'));
    assert.equal(braceBalance('const x = (a + b) / 2;\nconst y = c / d;'), 0);
});

test('a regex after a keyword is still a regex', () => {
    assert.ok(topLevelNames('function g(){ return /x{2}/.test(y); }\nconst AFTER = 1;').has('AFTER'));
});

test('an interpolation is closed by its own brace, not the first one', () => {
    // `${xs.map(x => { ... })}` used to end at the arrow body's `}`, which
    // terminated the template early and let the HTML after it lex as code.
    const src = 'const t = `${xs.map(x => { return x; })} </b>`;\nconst AFTER = 1;';
    assert.ok(topLevelNames(src).has('AFTER'));
    assert.equal(braceBalance(src), 0);
});

test('nested templates and regexes inside interpolations survive', () => {
    assert.ok(topLevelNames('const t = `a ${`inner ${1}`} b`;\nconst AFTER = 1;').has('AFTER'));
    assert.ok(topLevelNames("const t = `${s.replace(/'/g,'')} </i>`;\nconst AFTER = 1;").has('AFTER'));
    assert.ok(topLevelNames('const t = `${ {a:1}.a }`;\nconst AFTER = 1;').has('AFTER'));
});

test('function-local declarations are not reported as globals', () => {
    // `data` was being reported for years: a local const that the scanner
    // thought was at depth 0. Declaring it a global suppresses real typos.
    const names = topLevelNames('function h(){ const data = 1; return data; }\nconst AFTER = 1;');
    assert.ok(!names.has('data'));
    assert.ok(names.has('h'));
    assert.ok(names.has('AFTER'));
});

test('every shipped script and tool balances', () => {
    // The invariant check-globals.mjs enforces, asserted here too so a lexer
    // change is caught by `npm test` and not only by the full check.
    for (const dir of ['scripts', 'tools']) {
        for (const f of fs.readdirSync(dir)) {
            if (!/\.m?js$/.test(f)) continue;
            const depth = braceBalance(fs.readFileSync(`${dir}/${f}`, 'utf8'));
            assert.equal(depth, 0, `${dir}/${f} nets to ${depth} — the scanner lost its place`);
        }
    }
});

test('common.js still yields the declarations that went missing', () => {
    const names = topLevelNames(fs.readFileSync('scripts/common.js', 'utf8'));
    for (const n of ['escHTML', 'POSITION_CONFIG', 'loadFooter', 'initIcons', 'normalisePlayerShape']) {
        assert.ok(names.has(n), `${n} should be visible to the scanner`);
    }
});
