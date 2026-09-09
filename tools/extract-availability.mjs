#!/usr/bin/env node
/* What a manager could see about availability, recovered from this repo's history.

   The backtest declares availability unreconstructable and gives every player
   status 'a'. That was true of the single end-of-season snapshot it reads —
   reading status from a file written in May tells you who was injured in May, not
   in January — and from there it concluded the data does not exist.

   It does. The data workflows have been committing data/bootstrap-static.json
   every fifteen minutes since 2026-01-02: over a thousand commits. The snapshot
   from the last commit BEFORE a gameweek's first kickoff is not the future. It is
   exactly the team news a manager had when he picked, which is the same argument
   that makes the season snapshot itself legitimate.

   That matters more than it sounds. The projection earns most of its accuracy
   separating who plays from who does not — over 2025/26 it correlates 0.318 with
   what players scored overall and only 0.181 among those who actually started —
   and availability is the one input in that dimension the harness could not see.
   Anything measured about minutes while every player is marked fit is measuring
   the harness.

   Writes a slim file rather than copies of a 2 MB feed: only the players who are
   not plain available with no set-piece duty, which is a few hundred rows a
   gameweek rather than 795.

   Usage:  node tools/extract-availability.mjs <data-dir>
           reads <data-dir>/fixtures.json, writes <data-dir>/availability.json */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/extract-availability.mjs <data-dir>'); process.exit(1); }

const fixtures = JSON.parse(fs.readFileSync(path.join(dir, 'fixtures.json'), 'utf8'));

/* A gameweek starts at its earliest kickoff. Anything committed after that is
   the future — including, on a Saturday, the rest of the same gameweek. */
const firstKickoff = {};
for (const f of fixtures) {
    if (!f.event || !f.kickoff_time) continue;
    if (!firstKickoff[f.event] || f.kickoff_time < firstKickoff[f.event]) {
        firstKickoff[f.event] = f.kickoff_time;
    }
}

const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/* How old a snapshot may be and still count as team news.

   The feed is committed every fifteen minutes, so most gameweeks resolve to a
   snapshot a few hours before kickoff. Not all: the history has gaps, and in
   2025/26 there is one between 10 January and 6 February that leaves GW22, 23
   and 24 all reading the same file — by GW24 that is three weeks old.

   Three-week-old team news is not a weaker version of the real thing, it is a
   different and wrong thing. It would rule out players who had since recovered
   and pass fit players who had since been hurt, and a backtest scored on it
   would be measuring the gap rather than the model. Those gameweeks are kept in
   the file, with their age, and left out of `covered` so nothing uses them by
   accident. */
const MAX_AGE_HOURS = 48;

const out = { covered: [], stale: [], meta: {}, gw: {} };
const gws = Object.keys(firstKickoff).map(Number).sort((a, b) => a - b);

for (const gw of gws) {
    const before = firstKickoff[gw];
    let line;
    try {
        line = git(['log', '--format=%H %cI', '-1', `--before=${before}`,
                    '--', 'data/bootstrap-static.json']).trim();
    } catch { line = ''; }
    if (!line) continue;                      // nothing committed this early yet

    const [sha, when] = line.split(' ');
    let boot;
    try { boot = JSON.parse(git(['show', `${sha}:data/bootstrap-static.json`])); }
    catch { continue; }

    /* Only the departures from "fit, no set-piece duty" are stored. A player
       absent from a gameweek's map is available with nothing special about him,
       which is the overwhelming majority and not worth writing down 795 times. */
    const rows = {};
    for (const e of boot.elements || []) {
        const row = {};
        if (e.status && e.status !== 'a') row.s = e.status;
        if (e.chance_of_playing_next_round != null) row.c = e.chance_of_playing_next_round;
        if (e.penalties_order != null) row.p = e.penalties_order;
        if (e.corners_and_indirect_freekicks_order != null) row.k = e.corners_and_indirect_freekicks_order;
        if (e.direct_freekicks_order != null) row.f = e.direct_freekicks_order;
        if (Object.keys(row).length) rows[e.id] = row;
    }

    const ageHours = (Date.parse(before) - Date.parse(when)) / 3600000;
    const fresh = ageHours <= MAX_AGE_HOURS;
    (fresh ? out.covered : out.stale).push(gw);
    out.meta[gw] = { sha: sha.slice(0, 10), committed: when, kickoff: before,
                     ageHours: Math.round(ageHours * 10) / 10, fresh, players: Object.keys(rows).length };
    out.gw[gw] = rows;
    console.log(`  GW${String(gw).padStart(2)}  ${sha.slice(0, 8)}  ${ageHours.toFixed(1).padStart(7)} h before kickoff  ` +
                `${String(Object.keys(rows).length).padStart(4)} flagged${fresh ? '' : '   STALE, excluded'}`);
}

const target = path.join(dir, 'availability.json');
fs.writeFileSync(target, JSON.stringify(out));
const kb = Math.round(fs.statSync(target).size / 1024);
console.log(`\n✓ ${out.covered.length}/${gws.length} gameweeks usable → ${target} (${kb} KB)`);
if (out.stale.length) {
    console.log(`  excluded as stale (>${MAX_AGE_HOURS}h old): GW${out.stale.join(', GW')}`);
}
const missing = gws.filter(g => !out.covered.includes(g) && !out.stale.includes(g));
if (missing.length) {
    console.log(`  no snapshot at all for GW${missing[0]}-${missing[missing.length - 1]}`);
}
console.log('  everything not covered is projected exactly as it is today, with every player fit');
