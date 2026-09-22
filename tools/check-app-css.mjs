#!/usr/bin/env node
/* Every page that loads v2-design.css must also carry the snippet that loads
   its other half, byte for byte.

   v2-app.css cannot be a <link>: whether a visitor needs it is a question
   about localStorage, not about the document, and it has to be answered
   before first paint or a signed-in page flashes its signed-out shell. So it
   is appended by four lines of inline script — and inline script repeated on
   31 pages is exactly the kind of thing that rots one page at a time.

   Both directions of drift are silent:

     snippet missing      a signed-in visitor gets the application markup with
                          none of the application's styles, which does not
                          error anywhere; it just looks wrong
     snippet edited       one page loads a different file, or a stale ?v=, and
                          the difference shows up on that page alone

   The snippet lives in tools/app-css-snippet.txt, which is also what
   `npm run stamp` rewrites the version into. Same shape as check:preload and
   check:versions: a second copy of something is only safe while something
   fails when the copies disagree. */
import fs from 'node:fs';

const SNIPPET = fs.readFileSync('tools/app-css-snippet.txt', 'utf8');
const problems = [];
let checked = 0;

for (const page of fs.readdirSync('.').filter(f => f.endsWith('.html')).sort()) {
    const html = fs.readFileSync(page, 'utf8');
    const link = /^([ \t]*)<link rel="stylesheet" href="\/styles\/v2-design\.min\.css\?v=\d+">\n/m.exec(html);
    const carries = html.includes('v2-app.min.css');
    if (!link) {
        if (carries) problems.push(`${page}: loads v2-app.css without loading v2-design.css`);
        continue;
    }
    /* Six pages never call loadSidebarNav(): sign in, register, reset, the
       Team ID page, Premium and the Season Vault. They are standalone screens
       with no sidebar, no account menu and no dashboard footer — measured at
       0% of v2-app.css — so a saved Team ID is the wrong question for them and
       the answer cost 56KB. Not carrying the snippet is correct here, and the
       rule is the shell rather than a list of filenames so a new page of
       either kind is judged by what it does. */
    if (!html.includes('loadSidebarNav()')) {
        if (carries) problems.push(`${page}: loads v2-app.css but never calls loadSidebarNav() — nothing on it can use the app shell`);
        continue;
    }
    checked++;
    const after = html.slice(link.index + link[0].length);
    if (!after.startsWith(SNIPPET)) {
        problems.push(after.includes('v2-app.min.css')
            ? `${page}: the v2-app.css snippet has drifted from tools/app-css-snippet.txt, or no longer sits directly under the v2-design.css link`
            : `${page}: loads v2-design.css but never loads v2-app.css — the signed-in half`);
    }
}

if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    console.error('\nThe snippet must appear verbatim, on the line after the v2-design.css link.');
    console.error('Its position is the cascade: v2-app.css is appended where the link sits.');
    process.exit(1);
}
console.log(`✓ the v2-app.css snippet is identical on all ${checked} page(s) that load v2-design.css`);
