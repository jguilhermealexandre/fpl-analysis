/* Which classic scripts each HTML page loads, and its inline blocks.
   The whole site is one global scope per page, so "what is on this page"
   is the unit that matters for both collision checking and linting. */
import fs from 'node:fs';

export const PARTIALS = new Set(['nav.html', 'sidebar-nav.html', 'footer.html']);

export function pages(root = '.') {
    const out = {};
    for (const f of fs.readdirSync(root).sort()) {
        if (!f.endsWith('.html') || PARTIALS.has(f)) continue;
        const html = fs.readFileSync(`${root}/${f}`, 'utf8');
        /* The leading slash is optional because the site's own references are
           root-absolute — a page served at /dashboard/players resolves a bare
           "scripts/common.js" against /dashboard/ and 404s. Matching only the
           relative form made every page look as though it loaded no scripts at
           all, so the smoke test evaluated bare inline code and every page
           "failed" on the first function the missing files define. */
        const scripts = [...html.matchAll(/<script src="\/?scripts\/([\w.-]+\.js)/g)].map(m => `scripts/${m[1]}`);
        const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
        out[f] = { scripts, inline };
    }
    return out;
}
