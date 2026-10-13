/* The squad numbers FPL stopped publishing.
 *
 * bootstrap-static carries a squad_number field and it is null for all 667
 * players in the current feed — the game has not filled it in for seasons.
 * The shirts this site draws therefore had the player's initials where the
 * number goes, which is honest but is not what a shirt back looks like.
 *
 * The league's own site has them, from the same Pulselive API its squad pages
 * read. Two things make the join exact rather than a name match: FPL's
 * `opta_code` is "p" plus its `code`, and Pulselive's player objects carry
 * `altIds.opta` in the same form. So a number is attached to the player it
 * belongs to, or it is not attached at all.
 *
 * Writes `squad_number` straight into data/bootstrap-static.json, which every
 * page already loads — rather than a second file every page would have to
 * fetch. Run after the bootstrap is refreshed, like attach-minutes-form.mjs.
 *
 * Run:  node tools/fetch-shirt-numbers.mjs [data/bootstrap-static.json]
 *       node tools/fetch-shirt-numbers.mjs --dry-run    report, write nothing
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRY = process.argv.includes('--dry-run');
const FILE = process.argv.slice(2).find(a => !a.startsWith('--'))
    || path.join(ROOT, 'data', 'bootstrap-static.json');

const API = 'https://footballapi.pulselive.com/football';
/* The league's own front end sends this and the API checks it. Without it
   every request comes back 403 and the run looks like an outage. */
const HEADERS = {
    Origin: 'https://www.premierleague.com',
    Referer: 'https://www.premierleague.com/',
    'User-Agent': 'easyfpl-data-bot (+https://easyfpl.com)',
    Accept: 'application/json'
};

async function getJSON(url) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await fetch(url, { headers: HEADERS });
            if (res.ok) return await res.json();
            if (res.status === 404) return null;
            console.log(`  HTTP ${res.status} (attempt ${attempt}/3) ${url}`);
        } catch (e) {
            console.log(`  ${e.message} (attempt ${attempt}/3)`);
        }
        if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1500));
    }
    return null;
}

const boot = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const teams = (boot.teams || []).filter(t => t.pulse_id != null);
if (!teams.length) {
    console.error('::error::no team carries a pulse_id, so there is nothing to join on');
    process.exit(1);
}

/* Competition 1 is the Premier League. The current season is the one the API
   lists first, which is how premierleague.com picks it too. */
const seasons = await getJSON(`${API}/competitions/1/compseasons?pageSize=100`);
const compSeason = seasons && seasons.content && seasons.content[0] && seasons.content[0].id;
if (!compSeason) {
    console.error('::error::could not read the current compseason; nothing written');
    process.exit(1);
}
console.log(`Season ${seasons.content[0].label || compSeason}`);

const byCode = new Map();
for (const team of teams) {
    const url = `${API}/teams/${team.pulse_id}/compseasons/${compSeason}/staff`
        + `?pageSize=100&compSeasons=${compSeason}&altIds=true&type=player`;
    const squad = await getJSON(url);
    const players = (squad && squad.players) || [];
    let found = 0;
    for (const p of players) {
        const opta = p.altIds && p.altIds.opta;
        const shirt = p.info && p.info.shirtNum;
        if (!opta || shirt == null) continue;
        const code = Number(String(opta).replace(/^p/i, ''));
        if (!Number.isFinite(code)) continue;
        byCode.set(code, Number(shirt));
        found++;
    }
    console.log(`  ${String(team.short_name).padEnd(4)} ${String(found).padStart(3)} number(s) of ${players.length} in the squad`);
    await new Promise(r => setTimeout(r, 250));
}

/* A run that reaches almost nobody has failed, whatever the HTTP codes said,
   and must not overwrite good numbers with nothing. */
const MIN_CLUBS = Math.ceil(teams.length * 0.75);
const clubsAnswered = new Set([...byCode.keys()].map(c =>
    (boot.elements.find(e => e.code === c) || {}).team)).size;
if (clubsAnswered < MIN_CLUBS) {
    console.error(`::error::only ${clubsAnswered} of ${teams.length} clubs returned numbers; nothing written`);
    process.exit(1);
}

let set = 0, cleared = 0, unchanged = 0;
for (const el of boot.elements) {
    const n = byCode.get(el.code);
    if (n == null) {
        /* Left exactly as found. A player the league has not numbered yet —
           a new signing, a youth call-up — keeps whatever is there rather
           than being blanked by a run that simply did not see him. */
        if (el.squad_number != null) cleared++;
        continue;
    }
    if (el.squad_number === n) unchanged++; else { el.squad_number = n; set++; }
}

console.log(`\n${set} set, ${unchanged} unchanged, ${boot.elements.length - set - unchanged} still without a number`
    + (cleared ? ` (${cleared} kept a number the league no longer lists)` : ''));

if (DRY) { console.log('--dry-run: nothing written'); process.exit(0); }
fs.writeFileSync(FILE, JSON.stringify(boot));
console.log(`Wrote ${path.relative(ROOT, FILE)}`);
