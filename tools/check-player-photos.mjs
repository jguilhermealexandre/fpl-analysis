/* Which players have a photo, and from where.
 *
 * The pitch cards show the club's own headshot, addressed by the player's
 * `code` from bootstrap-static.json. Two things about that are worth being
 * able to measure rather than argue about:
 *
 *   Coverage. A new signing has no shot published for days or weeks, and
 *   nothing in the feed says so — `has_temporary_code` reads false for every
 *   one of the 652 players in the current snapshot, so a miss is only
 *   discoverable by asking for the file.
 *
 *   Freshness. The image at a code is whatever the league last published, so
 *   a transferred player keeps his old kit until they reshoot him. No URL we
 *   can build changes that. What a URL *can* change is which library is being
 *   read, so the candidate paths below are checked side by side: if a
 *   season-scoped one answers for a player the current path misses, that is
 *   an argument for switching, and if it does not, this settles it.
 *
 * Run:  node tools/check-player-photos.mjs [--all] [--limit N]
 * By default it samples; --all walks the whole list.
 *
 * Not wired into CI. It depends on a third party being up, and a red build
 * over someone else's missing JPEG tells you nothing about the commit.
 */
import fs from 'node:fs';

const BOOT = 'data/bootstrap-static.json';
const CANDIDATES = [
    { name: 'current (110x140)', url: c => `https://resources.premierleague.com/premierleague/photos/players/110x140/p${c}.png` },
    { name: 'current (250x250)', url: c => `https://resources.premierleague.com/premierleague/photos/players/250x250/p${c}.png` },
    { name: 'season-scoped 25',  url: c => `https://resources.premierleague.com/premierleague25/photos/players/250x250/p${c}.png` }
];

const args = process.argv.slice(2);
const all = args.includes('--all');
const limitArg = args.indexOf('--limit');
const limit = limitArg >= 0 ? parseInt(args[limitArg + 1], 10) : (all ? Infinity : 60);

const boot = JSON.parse(fs.readFileSync(BOOT, 'utf8'));
const teams = Object.fromEntries(boot.teams.map(t => [t.id, t.short_name]));

// Most-owned first: a missing photo matters in proportion to how many squads
// the player actually appears in.
const players = boot.elements
    .slice()
    .sort((a, b) => parseFloat(b.selected_by_percent) - parseFloat(a.selected_by_percent))
    .slice(0, limit === Infinity ? undefined : limit);

async function head(url) {
    try {
        const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
        return res.status;
    } catch {
        return 0;   // network refused or timed out — not the same as a 404
    }
}

const missing = [];
const wins = Object.fromEntries(CANDIDATES.map(c => [c.name, 0]));
let checked = 0;

for (const p of players) {
    const results = [];
    for (const c of CANDIDATES) results.push([c.name, await head(c.url(p.code))]);
    checked++;

    for (const [name, status] of results) if (status === 200) wins[name]++;
    if (!results.some(([, status]) => status === 200)) {
        missing.push(`${p.web_name} (${teams[p.team]}, ${p.selected_by_percent}% owned, code ${p.code})`);
    }
    if (checked % 25 === 0) process.stdout.write(`  ...${checked}/${players.length}\n`);
}

console.log(`\nChecked ${checked} players, most-owned first.\n`);
console.log('Answering with a photo, by path:');
for (const [name, n] of Object.entries(wins)) {
    console.log(`  ${String(n).padStart(4)}/${checked}  ${name}`);
}

if (!missing.length) {
    console.log('\n✓ every player checked has a photo on at least one path');
} else {
    console.log(`\n${missing.length} with no photo on any path:`);
    missing.forEach(m => console.log(`  ${m}`));
    console.log('\nThese fall back to initials on the pitch cards.');
}
