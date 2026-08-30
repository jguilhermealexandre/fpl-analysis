/* Top-level declarations in a classic script, found by brace depth.
   Shared by check-globals.mjs (collision guard) and gen-eslint-globals.mjs.
   No parser and no dependencies on purpose: this runs on a bare runner. */
export function stripNoise(src) {
    let out = '', i = 0, n = src.length;
    while (i < n) {
        const c = src[i], d = src[i + 1];
        if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; out += ' '; continue; }
        if (c === '/' && d === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; out += ' '; continue; }
        if (c === '"' || c === "'") {
            i++; while (i < n && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
            i++; out += '""'; continue;
        }
        if (c === '`') {                       // template literals, ${} nesting included
            i++; let depth = 0;
            while (i < n) {
                if (src[i] === '\\') { i += 2; continue; }
                if (src[i] === '$' && src[i + 1] === '{') { depth++; i += 2; continue; }
                if (src[i] === '}' && depth > 0) { depth--; i++; continue; }
                if (src[i] === '`' && depth === 0) break;
                i++;
            }
            i++; out += '""'; continue;
        }
        out += c; i++;
    }
    return out;
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
