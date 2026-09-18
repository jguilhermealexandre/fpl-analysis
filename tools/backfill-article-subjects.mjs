#!/usr/bin/env node
/* Gives every already-published article a subject, so the archive carries the
   same generated artwork the new pieces do.

   The generators name their subject explicitly now, but the twenty-odd
   articles already in data/articles/ were written before that field existed,
   and they cannot simply be regenerated: a gameweek's debrief is a record of
   that gameweek, and re-running the generator against today's data would
   quietly rewrite history. The words stay exactly as published.

   So the subject is read back out of the words instead. Every one of these
   formats opens its dek on the player it is about — "Haaland led Gameweek 5
   with 17 points", "Semenyo has 2.4 expected involvements" — which is not a
   guess: it is the same sentence the generator built from the same player.
   The name is matched against bootstrap, longest first so "Bruno G." does not
   win a line that says "Bruno Guimaraes", and only a match that lands at a
   word boundary in the first clause counts. Anything ambiguous is left
   without a subject and gets the faceless template, which is a designed
   state rather than a failure.

   Idempotent. Run it again after a new article is published and it will skip
   everything that already has one. */
import fs from 'node:fs';

const boot = JSON.parse(fs.readFileSync('data/bootstrap-static.json', 'utf8'));

/* web_name first (that is what the generators print), then the full name for
   the handful of deks that carry one. */
const NAMES = [];
for (const e of boot.elements) {
    const stat = `\u00a3${(e.now_cost / 10).toFixed(1)}m \u00b7 ${e.total_points} pts`;
    const rec = { code: e.code, name: e.web_name, stat };
    NAMES.push({ needle: e.web_name, rec });
    const full = `${e.first_name} ${e.second_name}`.trim();
    if (full && full !== e.web_name) NAMES.push({ needle: full, rec });
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* The first sentence only. Later ones name the runner-up and the
   counter-example, and the artwork is about whoever the piece leads on.

   Split on a full stop followed by a space, not on any full stop: half a dozen
   web_names are of the form "B.Fernandes", and splitting inside one leaves the
   opening clause as the single letter "B". */
function openingSentence(dek) {
    return String(dek || '').split(/(?<=[^\s])\.\s+/)[0] || '';
}

/* The earliest name in that sentence wins, not the longest.
   "Barcola is under the heaviest buying pressure and Woltemade is being sold
   hardest" is a piece about Barcola; taking the longest match handed it to
   Woltemade, who is in it as the contrast. Ties at the same index go to the
   longer needle, which is what keeps "Bruno G." from claiming a line that
   says "Bruno Guimaraes". */
function subjectFor(article) {
    const opening = openingSentence(article.dek);
    if (!opening) return null;
    let best = null;
    for (const { needle, rec } of NAMES) {
        const m = new RegExp(`(^|[^\\p{L}\\p{N}])${esc(needle)}($|[^\\p{L}\\p{N}])`, 'u').exec(opening);
        if (!m) continue;
        const at = m.index + m[1].length;
        if (!best || at < best.at || (at === best.at && needle.length > best.len)) {
            best = { at, len: needle.length, rec };
        }
    }
    /* A name deep into the sentence is being mentioned, not written about.
       The Hall of Shame's dek reaches its subject at around 55 characters
       ("The awards nobody wants from Gameweek 4, starting with ..."), so the
       cut is past that and well short of the second clause. */
    if (!best || best.at > 80) return null;
    return { name: best.rec.name, code: best.rec.code, stat: best.rec.stat };
}

let added = 0, already = 0, none = 0;
/* index.json is the feed's own listing, not an article — it is a JSON array,
   and setting a property on one writes a file the feed can no longer read. */
const files = fs.readdirSync('data/articles')
    .filter(f => f.endsWith('.json') && f !== 'index.json');
for (const file of files) {
    const p = `data/articles/${file}`;
    const a = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!a || Array.isArray(a) || typeof a !== 'object' || !a.dek) { none++; continue; }
    if (a.subject !== undefined) { already++; continue; }
    const subject = subjectFor(a);
    if (!subject) { none++; a.subject = null; }
    else { added++; a.subject = subject; }
    fs.writeFileSync(p, JSON.stringify(a, null, 2) + '\n');
}

console.log(`✓ ${added} article(s) given a subject, ${none} left faceless, ${already} already had one (${files.length} total)`);
