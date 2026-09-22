#!/usr/bin/env node
/* Minified copies of every stylesheet and script, committed beside the source.
 *
 * This site has no bundler, on purpose: the scripts are classic files sharing
 * one global scope and the pages load them in order. Nothing here changes
 * that. The sources stay exactly as they are — heavily commented, because the
 * comments are how this codebase explains itself — and each one gets a .min
 * twin that the pages actually load.
 *
 * Committed rather than built at deploy because Cloudflare Pages serves this
 * repo directly with no build step, and adding one to ship whitespace is a
 * poor trade. `npm run build` regenerates them and `npm run check:min` fails
 * if any is stale, which is the same regenerate-and-verify shape
 * check:gen already uses for eslint.config.mjs.
 *
 * Usage:  node tools/minify.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { transform as cssTransform } from 'lightningcss';

const check = process.argv.includes('--check');

/* A .min file is generated, so it is never itself an input — without this the
   second run minifies common.min.css into common.min.min.css. */
const isSource = f => !f.includes('.min.');

const jobs = [];
for (const f of fs.readdirSync('styles').filter(f => f.endsWith('.css')).filter(isSource)) {
    jobs.push({ src: path.join('styles', f), out: path.join('styles', f.replace(/\.css$/, '.min.css')), kind: 'css' });
}
for (const f of fs.readdirSync('scripts').filter(f => f.endsWith('.js')).filter(isSource)) {
    jobs.push({ src: path.join('scripts', f), out: path.join('scripts', f.replace(/\.js$/, '.min.js')), kind: 'js' });
}

async function build(job) {
    const source = fs.readFileSync(job.src);
    if (job.kind === 'css') {
        /* targets omitted deliberately: lightningcss would otherwise downlevel
           modern syntax this site relies on — color-mix(), :has(), nesting —
           into something longer, which is the opposite of the point. */
        const { code } = cssTransform({ filename: job.src, code: source, minify: true });
        return Buffer.from(code);
    }
    /* No bundling and no renaming of top-level names. Every one of these files
       declares globals the next one and the inline onclick= handlers depend on
       by name; mangling them would break the site silently. */
    /* No keepNames. It preserves Function.prototype.name by injecting two
       top-level helpers — `var k = Object.defineProperty` and an `o` that
       calls it — into every file it touches. These scripts share one global
       scope, so that is the same two names redeclared fifty-five times, and
       an `o` at the top of the global scope is one collision away from
       shadowing something real. minifyIdentifiers:false already keeps every
       name as written, which is what was actually wanted. */
    const res = await esbuild.transform(source.toString(), {
        loader: 'js',
        minifyIdentifiers: false, minifySyntax: true, minifyWhitespace: true,
        legalComments: 'none', target: 'es2020'
    });
    return Buffer.from(res.code);
}

let stale = [], before = 0, after = 0;
for (const job of jobs) {
    const code = await build(job);
    before += fs.statSync(job.src).size;
    after += code.length;
    const current = fs.existsSync(job.out) ? fs.readFileSync(job.out) : null;
    if (!current || !current.equals(code)) {
        stale.push(job.out);
        if (!check) fs.writeFileSync(job.out, code);
    }
}

if (check) {
    if (stale.length) {
        console.error(`✗ ${stale.length} minified file(s) are stale:`);
        for (const f of stale.slice(0, 8)) console.error('    ' + f);
        if (stale.length > 8) console.error(`    …and ${stale.length - 8} more`);
        console.error('  Run: npm run build');
        process.exit(1);
    }
    console.log(`✓ all ${jobs.length} minified file(s) match their source`);
} else {
    const pct = Math.round((1 - after / before) * 100);
    console.log(`✓ minified ${jobs.length} file(s): ${Math.round(before / 1024)}KB → ${Math.round(after / 1024)}KB (${pct}% smaller)`);
}
