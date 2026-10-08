/* The globals scanner, which had been quietly wrong for months.

   Its failures do not look like failures. topLevelNames() finds declarations by
   brace depth, so a mis-lex loses every declaration after that point and
   produces a shorter list — indistinguishable from a smaller file. The only
   visible symptom was eslint.config.mjs going stale, which nothing checks. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { topLevelNames, braceBalance, stripComments, stripNoise } from '../tools/scan-globals.mjs';

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

/* ===== stripComments — comments out, every other byte kept =====

   Added with tools/check-icons.mjs, which needs to know whether a string is
   EMPTY and so cannot use stripNoise (that replaces every literal with ""). The
   hand-rolled stripper it started with lost its place on a nested template,
   which is the fault this file's header describes in mirror image — so the
   lexer grew the function instead of the caller keeping a second one. */

test('stripComments keeps string contents, unlike stripNoise', () => {
    const src = `const a = 'keep me'; /* drop me */ const b = "";`;
    const out = stripComments(src);
    assert.match(out, /'keep me'/, 'a string survives intact');
    assert.match(out, /""/, 'and an empty one is still visibly empty');
    assert.doesNotMatch(out, /drop me/);
    assert.doesNotMatch(stripNoise(src), /keep me/, 'stripNoise would have flattened it');
});

test('offsets survive, so a caller can report real line numbers', () => {
    const src = ['const a = 1;', '/* two', '   lines */', 'const b = 2;'].join('\n');
    const out = stripComments(src);
    assert.equal(out.length, src.length, 'same length');
    assert.equal(out.split('\n').length, src.split('\n').length, 'same line count');
    assert.equal(out.split('\n')[3], 'const b = 2;', 'and the same line 4');
});

test('a nested template literal does not end the outer one', () => {
    /* The fault that made the local stripper useless: scanning from a backtick
       to "the next backtick" stops inside the inner template, after which code
       reads as string and string as code — and the comment after it survived. */
    const src = 'const h = `${a ? `<i>${b}</i>` : \'\'}`; /* gone */ const z = 1;';
    const out = stripComments(src);
    assert.doesNotMatch(out, /gone/, 'the comment after a nested template is still removed');
    assert.match(out, /const z = 1;/);
});

test('a regex holding a quote does not swallow the file', () => {
    // escHTML's /'/g, the exact literal named in this file's header.
    const src = `s.replace(/'/g, '&#39;'); /* bye */ const after = 1;`;
    const out = stripComments(src);
    assert.doesNotMatch(out, /bye/);
    assert.match(out, /const after = 1;/);
    assert.match(out, /\/'\/g/, 'the regex itself is kept');
});

test('a comment inside an interpolation is deliberately kept', () => {
    /* Templates are copied whole. That is the choice check-icons.mjs needs:
       the interpolation is where the markup lives, and a dead expression
       inside one has to stay visible. */
    const out = stripComments('const h = `${/* inner */ x}`;');
    assert.match(out, /inner/);
});
