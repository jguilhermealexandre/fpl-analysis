#!/usr/bin/env node
/* Recent minutes, onto the file every page already loads.
 *
 * THE PROBLEM. scripts/xp-engine.js estimates whether a player will start from
 * `starts / gameweeks elapsed` — a season rate. Every week a player was injured,
 * unregistered or on the bench keeps counting against him long after he is back
 * in the side. Konsa opened 2026/27 with 0 and 11 minutes, then started three in
 * a row at ninety: the season rate says 3/5 = 0.600 and the last three say 1.000.
 * The projection used 0.600, took another 25% off for his published fitness
 * doubt, and arrived at 44 expected minutes for a defender who was about to play
 * the full match.
 *
 * WHY THIS IS A DATA PROBLEM AND NOT A MODEL ONE. The fix needs per-gameweek
 * minutes. bootstrap-static.json has no such field — `form` is points over
 * thirty days and `starts_per_90` is starts per ninety minutes played, neither
 * of which can tell a returning starter from a fading one. The per-gameweek rows
 * live in data/players-data.json, which is 2.6MB and is loaded by exactly two
 * scripts. Computing the rate inside the engine would therefore make the squad
 * page disagree with the dashboard about the same player's expected points,
 * which is a worse fault than the one being fixed.
 *
 * So the summary is attached to bootstrap-static.json instead — the file every
 * page that runs the engine already fetches. No new request anywhere, and one
 * number per player wherever it is read.
 *
 * WHAT IS STORED, AND WHAT IS NOT. The raw rows, not a weighted rate: the
 * weighting is a modelling choice and belongs in the engine beside the model it
 * feeds, where it is one constant and can be measured. This file's only job is
 * to carry the evidence across.
 *
 *   mf: { gws: [2,3,4,5], mins: [11,90,90,90], st: [0,1,1,1] }
 *
 * Most recent LAST, which is the order xpRecentStartRate() decays over. A player
 * with no history gets no `mf` at all rather than an empty one, because the
 * engine's fallback to the season rate is the correct answer for him and a
 * present-but-empty window would read as "we looked and he has not played".
 *
 * Runs after the fetch and before the commit, like tools/normalise-bootstrap.mjs
 * and for the same reason. Idempotent. Quiet when there is nothing to do.
 */
import fs from 'node:fs';

/* Five gameweeks. Long enough that one rotation does not erase a starter, short
 * enough to turn over inside the month that FPL team news actually moves in. The
 * engine decays within it, so the oldest row is worth about a tenth of the
 * newest and the exact length matters much less than having one at all. */
const WINDOW = 5;

const BOOT = process.argv[2] || 'data/bootstrap-static.json';
const DETAIL = process.argv[3] || 'data/players-data.json';

const readJSON = (file) => {
    // Missing and malformed are the same answer to the caller: there is nothing
    // to attach. Both are handled below, differently for the two files.
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return null; }
};

const boot = readJSON(BOOT);
if (!boot || !Array.isArray(boot.elements)) {
    console.error(`::error::${BOOT} has no elements array — refusing to rewrite it`);
    process.exit(1);
}

/* The detail feed is optional and this degrades rather than fails without it.
 * Its own job refuses to write a thin players-data.json (see
 * update.player-data.yml), so an absent or unreadable one here means the
 * four-hourly run has not landed yet — and the engine's season rate is exactly
 * what it used before this existed. Erroring would stop a fifteen-minute data
 * refresh over a missing nice-to-have. */
const detail = readJSON(DETAIL);
if (!detail || !Array.isArray(detail.players)) {
    console.log(`${DETAIL} is absent or has no players — leaving ${BOOT} alone.`);
    process.exit(0);
}

const history = new Map();
for (const p of detail.players) {
    if (!p || p.id == null || !Array.isArray(p.history)) continue;
    history.set(p.id, p.history);
}

let attached = 0, skipped = 0;
const windows = [];
for (const el of boot.elements) {
    const rows = (history.get(el.id) || [])
        /* A row with no round cannot be placed in the window at all. Sorted
           because the order a file arrives in is not a contract — and a double
           gameweek legitimately has two rows on the same round, which both
           count: he either started both or he did not. */
        .filter(r => r && r.round != null)
        .sort((a, b) => a.round - b.round)
        .slice(-WINDOW);

    if (!rows.length) { delete el.mf; skipped++; continue; }

    el.mf = {
        gws: rows.map(r => Number(r.round)),
        mins: rows.map(r => Number(r.minutes) || 0),
        // FPL's own starts flag, not minutes over a threshold: ninety minutes
        // off the bench in extra time is not a start, and an eleven-minute
        // cameo is not the same evidence as an eleven-minute start.
        st: rows.map(r => (r.starts ? 1 : 0))
    };
    attached++;
    windows.push(rows.length);
}

const before = fs.statSync(BOOT).size;
fs.writeFileSync(BOOT, JSON.stringify(boot));
const after = fs.statSync(BOOT).size;

const full = windows.filter(n => n === WINDOW).length;
console.log(`Attached recent minutes to ${attached} players `
    + `(${full} with a full ${WINDOW}-gameweek window, ${skipped} with no history yet). `
    + `${BOOT} ${(before / 1048576).toFixed(2)}MB -> ${(after / 1048576).toFixed(2)}MB.`);
