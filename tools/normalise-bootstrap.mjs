#!/usr/bin/env node
/* Fixes what FPL calls things, once, where the data lands.
 *
 * FPL's own bootstrap names Tottenham "Spurs" — a terrace nickname, in the
 * field every page reads for a club's full name. It is the club's name that
 * belongs in a sentence like "Spurs see their schedule ease sharply", and
 * "TOT" or "Tottenham" is what that sentence should say.
 *
 * This runs after the fetch and before the commit, so every consumer is fixed
 * at once: the browser, the article builder that runs under node, and anything
 * added later that reads the file without knowing this rule exists. Patching
 * it in the renderers instead would mean finding every place a team name is
 * printed and remembering the next one.
 *
 * Keyed on the club's permanent `code`, not on its id or on the string being
 * replaced: ids are reassigned between seasons, and matching on "Spurs" would
 * silently stop working the day FPL fixes it themselves — which is the day
 * this should become a no-op rather than a surprise.
 *
 * It also puts the squad numbers back. FPL's own squad_number is null for
 * every player, and the bootstrap is replaced wholesale by every data run, so
 * numbers written into it by update-shirt-numbers.yml lasted until the next
 * live refresh — about three hours a week — and every shirt on the site went
 * back to initials for the rest. They live in data/shirt-numbers.json now,
 * keyed by the player's permanent `code`, and are laid back over each fresh
 * bootstrap here, which both data jobs already run straight after the fetch.
 *
 * Idempotent, and quiet when there is nothing to do.
 */
import fs from 'node:fs';
import path from 'node:path';

const FILE = process.argv[2] || 'data/bootstrap-static.json';
const NUMBERS_FILE = process.argv[3] || path.join(path.dirname(FILE), 'shirt-numbers.json');

/* code -> the name to print. Only clubs FPL names in a way we would not. */
const TEAM_NAMES = {
    6: 'Tottenham'      // FPL says "Spurs"
};

const boot = JSON.parse(fs.readFileSync(FILE, 'utf8'));
if (!Array.isArray(boot.teams)) {
    console.error(`::error::${FILE} has no teams array — refusing to rewrite it`);
    process.exit(1);
}

const changed = [];
for (const team of boot.teams) {
    const want = TEAM_NAMES[team.code];
    if (want && team.name !== want) {
        changed.push(`${team.name} -> ${want}`);
        team.name = want;
    }
}

/* code -> squad number. A missing file is not an error: the numbers are a
   nicety and the bootstrap is still good without them. */
let numbers = {};
try {
    numbers = JSON.parse(fs.readFileSync(NUMBERS_FILE, 'utf8'));
} catch (e) {
    console.log(`! no squad numbers read from ${NUMBERS_FILE} (${e.code || e.message})`);
}
let numbered = 0;
for (const el of boot.elements || []) {
    const n = numbers[String(el.code)];
    if (Number.isInteger(n) && el.squad_number !== n) {
        el.squad_number = n;
        numbered++;
    }
}

if (!changed.length && !numbered) {
    console.log('✓ team names and squad numbers already as we print them');
} else {
    fs.writeFileSync(FILE, JSON.stringify(boot));
    if (changed.length) console.log(`✓ renamed ${changed.length} club(s): ${changed.join(', ')}`);
    if (numbered) console.log(`✓ ${numbered} squad number(s) laid back over the bootstrap`);
}
