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
 * Idempotent, and quiet when there is nothing to do.
 */
import fs from 'node:fs';

const FILE = process.argv[2] || 'data/bootstrap-static.json';

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

if (!changed.length) {
    console.log('✓ team names already as we print them');
} else {
    fs.writeFileSync(FILE, JSON.stringify(boot));
    console.log(`✓ renamed ${changed.length} club(s): ${changed.join(', ')}`);
}
