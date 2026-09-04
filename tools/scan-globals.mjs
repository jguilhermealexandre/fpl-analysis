/* Top-level declarations in a classic script, found by brace depth.
   Shared by check-globals.mjs (collision guard) and gen-eslint-globals.mjs.
   No parser and no dependencies on purpose: this runs on a bare runner.

   It is still not a parser, but it does have to be a correct lexer. Two things
   it got wrong for a long time, both silent, both losing every declaration
   after the point where they happened:

     - Regex literals were not recognised at all, so the `/'/g` in escHTML read
       as a string opening at the apostrophe and swallowed the rest of
       common.js — POSITION_CONFIG, loadFooter, initIcons and twenty-eight
       others went missing from eslint.config.mjs, and the file ended at brace
       depth 1.
     - Interpolations inside template literals were closed by the first `}`,
       whichever brace it belonged to. An arrow function or object literal
       inside a `${ }` therefore ended the interpolation early, and the raw HTML
       after it was lexed as code.

   check-globals.mjs now asserts that every unit returns to brace depth zero,
   which is the observable both faults share. */

/* Whether a `/` here opens a regex literal or divides.

   There is no way to know without the previous significant token, which is what
   every hand-written JS lexer does: nothing following a value — an identifier,
   a number, a closing `)` or `]` — can be a regex, and a `/` after an operator,
   a comma or an opening bracket must be one. Keywords are the exception that
   makes the identifier rule wrong on its own: `return /x/` and `typeof /x/` are
   regexes even though both end in [\w$]. */
const VALUE_KEYWORD = /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

function regexAllowedAfter(tail) {
    let i = tail.length - 1;
    while (i >= 0 && /\s/.test(tail[i])) i--;
    if (i < 0) return true;                       // start of unit
    const c = tail[i];
    if (c === ')' || c === ']') return false;     // (a + b) / 2, arr[i] / 2
    if (/[\w$]/.test(c)) return VALUE_KEYWORD.test(tail.slice(0, i + 1));
    return true;
}

// Index just past a regex literal starting at src[i] === '/', or -1 if what is
// there is not one after all (unterminated before the line ends, i.e. division).
function skipRegex(src, i) {
    const n = src.length;
    let j = i + 1, inClass = false;
    while (j < n) {
        const c = src[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '\n') return -1;
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) {
            j++;
            while (j < n && /[a-z]/.test(src[j])) j++;   // flags
            return j;
        }
        j++;
    }
    return -1;
}

// Index just past the quote that closes the string starting at src[i].
function skipString(src, i) {
    const n = src.length, q = src[i];
    i++;
    while (i < n && src[i] !== q) i += src[i] === '\\' ? 2 : 1;
    return i + 1;
}

/* Index just past the backtick closing the template literal at src[i].
   Mutually recursive with skipInterpolation, because a `${ }` can contain
   another template literal, and routinely does in this codebase. */
function skipTemplate(src, i) {
    const n = src.length;
    i++;
    while (i < n) {
        const c = src[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '`') return i + 1;
        if (c === '$' && src[i + 1] === '{') { i = skipInterpolation(src, i + 2); continue; }
        i++;
    }
    return i;
}

/* Index just past the `}` closing an interpolation whose `${` ended at i.
   Every construct that can hide a brace has to be skipped rather than counted:
   strings, nested templates, comments and regex literals all can. */
function skipInterpolation(src, i) {
    const n = src.length;
    let depth = 1, tail = '(';
    const push = (c) => { tail = (tail + c).slice(-24); };
    while (i < n) {
        const c = src[i], d = src[i + 1];
        if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
        if (c === '/' && d === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue; }
        if (c === '/' && regexAllowedAfter(tail)) {
            const j = skipRegex(src, i);
            if (j > 0) { i = j; push('x'); continue; }
        }
        if (c === '"' || c === "'") { i = skipString(src, i); push('x'); continue; }
        if (c === '`') { i = skipTemplate(src, i); push('x'); continue; }
        if (c === '{') { depth++; i++; push('{'); continue; }
        if (c === '}') { depth--; i++; if (depth === 0) return i; push('}'); continue; }
        push(c); i++;
    }
    return i;
}

export function stripNoise(src) {
    let out = '', i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i], d = src[i + 1];
        if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; out += ' '; continue; }
        if (c === '/' && d === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; out += ' '; continue; }
        if (c === '/' && regexAllowedAfter(out)) {
            const j = skipRegex(src, i);
            if (j > 0) { i = j; out += '""'; continue; }
        }
        if (c === '"' || c === "'") { i = skipString(src, i); out += '""'; continue; }
        if (c === '`') { i = skipTemplate(src, i); out += '""'; continue; }
        out += c; i++;
    }
    return out;
}

// Net brace depth once the whole unit has been read. Anything other than zero
// means the lexer lost its place, and every declaration past that point is
// invisible to topLevelNames().
export function braceBalance(src) {
    const s = stripNoise(src);
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '{') depth++;
        else if (s[i] === '}') depth--;
    }
    return depth;
}

export function topLevelNames(src) {
    const s = stripNoise(src);
    const names = new Set();
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '{') { depth++; continue; }
        if (c === '}') { depth = Math.max(0, depth - 1); continue; }
        if (depth !== 0) continue;
        if (i && !/[\s;]/.test(s[i - 1])) continue;
        let m = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(s.slice(i, i + 120));
        if (m) { names.add(m[1]); i += m[0].length - 1; continue; }
        m = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(s.slice(i, i + 120));
        if (m) { names.add(m[1]); i += m[0].length - 1; }
    }
    return names;
}
