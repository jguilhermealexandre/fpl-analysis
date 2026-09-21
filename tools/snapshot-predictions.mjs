#!/usr/bin/env node
/* What the model said, before it could possibly know.

   THE PROBLEM THIS EXISTS FOR

   Projections are computed in the browser, at page load, from
   data/bootstrap-static.json — and that file is overwritten every fifteen
   minutes. Nothing is ever written down. So after a gameweek is played there is
   no way to ask what the site predicted: form, prices, injury flags and the
   per-90 rates have all moved on, and re-running the engine today answers a
   different question. The prediction is not stale, it is GONE.

   That makes the archive unbackfillable. Every deadline that passes without a
   snapshot is a gameweek that can never be graded, by anyone, ever. Which is
   why this job runs hourly and writes early rather than waiting for a perfect
   moment near the deadline.

   WHY IT READS THE REPO AND NOT THE FPL API

   The live API is fresher, and that is the wrong property. The site serves
   data/bootstrap-static.json, so the prediction a reader saw at the deadline
   was computed from the committed file, not from the API. Snapshotting the API
   would archive a forecast nobody was ever shown, and then grade us on it.

   WHY IT OVERWRITES

   Each run inside the window replaces the previous one, so what survives is the
   last look before the deadline — the most informed version of the prediction
   the site actually served. Once the deadline passes nothing may write to that
   gameweek again, forced or not: a snapshot taken after kick-off is not a
   prediction, and the one thing this archive has to be is honest about when it
   was made.

   Usage:
     node tools/snapshot-predictions.mjs [--within-hours 24] [--force] [--dry-run]
       --within-hours  how close to the deadline to start writing (default 24)
       --force         ignore that window; the deadline must still be in the future
       --dry-run       compute and report, write nothing
*/
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, buildProjector, projectOne, PARTS } from './xp-engine-host.mjs';
import { rankRisingForm } from './rising-form-host.mjs';

const OUT_DIR = 'data/model-log';
/* How close to a deadline this starts writing.

   Was three hours, which made the archive one bad afternoon away from a
   permanent hole: the job runs hourly, so three consecutive failed or delayed
   runs lost a gameweek that nothing can ever rebuild. Twenty-four costs nothing
   — every run inside the window overwrites the last, so the stored file is
   still the final look before the deadline — and turns three chances into
   twenty-four. */
const DEFAULT_WINDOW_H = 24;

// More than this share of players failing to project means the engine is broken,
// not that a few players are odd. Write nothing and go red.
const MAX_FAILED_SHARE = 0.02;

const readJSON = (rel, fallback) => {
    try { return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')); }
    catch { return fallback; }
};

const round = (v, dp) => (Number.isFinite(v) ? Math.round(v * 10 ** dp) / 10 ** dp : null);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/* Which gameweek to snapshot, and whether now is the moment.

   The next deadline is found by time, not by FPL's is_next flag. The flags flip
   on FPL's own schedule and have been known to lag; a deadline in the future is
   unambiguous and needs no trust. */
export function chooseSnapshot(events, now, withinMs, force) {
    const upcoming = (events || [])
        .filter(e => e && e.deadline_time && Number.isFinite(e.id))
        .map(e => ({ gw: e.id, at: Date.parse(e.deadline_time), iso: e.deadline_time }))
        .filter(e => Number.isFinite(e.at) && e.at > now)
        .sort((a, b) => a.at - b.at);

    if (!upcoming.length) return { take: false, why: 'no deadline ahead of now — season over, or the data is stale' };

    const next = upcoming[0];
    const msLeft = next.at - now;
    if (!force && msLeft > withinMs) {
        const h = (msLeft / 3600000).toFixed(1);
        return { take: false, why: `GW${next.gw} is ${h}h away; the window is ${(withinMs / 3600000).toFixed(1)}h`, ...next };
    }
    return { take: true, ...next, msLeft };
}

/* One archive row. Everything here is either the prediction itself or something
   that cannot be recovered afterwards.

   The availability fields are the reason this job exists at all: status and
   chance_of_playing are overwritten the moment the next round's news lands, and
   they are exactly what drives the minutes model — which is the single biggest
   source of error in any FPL projection. An archive without them can tell you
   that a prediction was wrong but never why.

   ep, ppg and form are FPL's own numbers at the deadline. They are the free
   baselines: "we were 2 points out" means nothing until you know what FPL's own
   estimate and a season average would have scored. They move every week, so
   they have to be caught here too. */
function buildRow(el, player, engine, gw) {
    const base = {
        id: el.id,
        pos: el.element_type,
        team: el.team,
        price: el.now_cost / 10,
        status: el.status || null,
        chance: el.chance_of_playing_next_round ?? null,
        sel: num(el.selected_by_percent),
        ep: num(el.ep_next),
        ppg: num(el.points_per_game),
        form: num(el.form)
    };

    if (!player) return { ...base, xp: null, why: 'not built by xpBuildPlayers' };

    const p = projectOne(engine, player, gw);
    const fx = p.matches.map(f => ({
        o: f.opponentId ?? f.opponent ?? null,
        h: f.isHome ? 1 : 0,
        d: f.difficulty ?? null
    }));

    const row = {
        ...base,
        fx,
        xp: round(p.total, 2),
        pStart: round(p.pStart, 3),
        xMins: round(p.expMins, 1)
    };
    // A blank has no components to report and a zero row for it would read as a
    // prediction of nothing rather than an absence of fixture.
    if (fx.length) {
        const parts = {};
        PARTS.forEach(k => { parts[k] = round(p.parts[k], 3); });
        row.parts = parts;
        row.partsTotal = round(p.partsTotal, 3);
    }
    return row;
}

function serialise(meta, rows, rising) {
    /* Metadata readable, one player per line. A snapshot is written once and
       never edited, so this is for the human who opens it in a year, not for
       diffing. Every piece goes through JSON.stringify — the file is parsed
       back before it is written, so a hand-assembled brace can never ship. */
    const head = Object.entries(meta)
        .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
        .join(',\n');
    const body = rows.map(r => `    ${JSON.stringify(r)}`).join(',\n');
    const board = (rising || []).map(r => `    ${JSON.stringify(r)}`).join(',\n');
    return `{\n${head},\n  "players": [\n${body}\n  ],\n  "rising": [\n${board}\n  ]\n}\n`;
}

export function takeSnapshot({ now = Date.now(), withinHours = DEFAULT_WINDOW_H, force = false } = {}) {
    const boot = readJSON('data/bootstrap-static.json', null);
    const fixtures = readJSON('data/fixtures.json', []);
    if (!boot) throw new Error('data/bootstrap-static.json is missing or unreadable');

    const choice = chooseSnapshot(boot.events, now, withinHours * 3600000, force);
    if (!choice.take) return { written: false, ...choice };

    const gw = choice.gw;
    const { engine, players } = buildProjector(boot, fixtures, gw);
    const byId = new Map(players.map(p => [p.id, p]));

    const rows = [];
    const failed = [];
    for (const el of boot.elements) {
        try {
            rows.push(buildRow(el, byId.get(el.id), engine, gw));
        } catch (err) {
            failed.push({ id: el.id, message: err.message });
        }
    }

    /* A handful of odd players is football; a fifth of them is a broken engine.
       The archive is worth less than nothing if it quietly fills with zeros, so
       past the threshold this writes nothing and the job goes red. */
    const share = boot.elements.length ? failed.length / boot.elements.length : 1;
    if (share > MAX_FAILED_SHARE) {
        throw new Error(`${failed.length} of ${boot.elements.length} players failed to project `
            + `(${(share * 100).toFixed(1)}%, limit ${(MAX_FAILED_SHARE * 100).toFixed(0)}%). `
            + `First: ${failed[0] ? failed[0].message : 'none'}`);
    }

    /* The parts are summed from the same calls the total comes from, so they
       have to agree. If they ever stop agreeing the two paths have diverged and
       the breakdown in this archive is measuring something the site does not
       show — worth a red job rather than a year of quiet mismatch.

       The tolerance is 0.051 and not zero because the two are rounded
       differently and always were: projectPlayerPointsForGW rounds the headline
       to one decimal, while the parts are kept at three. A player on a true
       0.75 is archived as xp 0.8 against a partsTotal of 0.75, which is a
       half-up rounding boundary rather than a disagreement. 0.05 exactly is the
       widest that gap can legitimately be, so anything past it is real. */
    const drift = rows.filter(r => r.partsTotal != null && Math.abs(r.partsTotal - r.xp) > 0.051);
    if (drift.length) {
        throw new Error(`${drift.length} players where the component breakdown disagrees with the total `
            + `(e.g. id ${drift[0].id}: parts ${drift[0].partsTotal} vs xp ${drift[0].xp})`);
    }

    /* The Rising Form board, from the same committed files and the same moment.

       Wrapped because it is the secondary artifact. The xP snapshot is the one
       that can never be rebuilt — bootstrap-static.json is overwritten every
       fifteen minutes — so losing a whole gameweek of it because the rising
       engine threw would be the worst trade available. A board that failed says
       so in the metadata and the rest of the file still lands. */
    let rising = [];
    let risingError = null;
    try {
        rising = rankRisingForm(boot, fixtures, readJSON('data/players-data.json', null) || {}, gw);
    } catch (err) {
        risingError = err.message;
    }

    const projected = rows.filter(r => r.xp != null);
    const withFixture = rows.filter(r => r.fx && r.fx.length);
    const meta = {
        gw,
        deadlineTime: choice.iso,
        takenAt: new Date(now).toISOString(),
        hoursBeforeDeadline: round(choice.msLeft / 3600000, 2),
        forced: force || undefined,
        model: {
            assetVersion: (readJSON('asset-version.json', {}) || {}).version ?? null,
            commit: process.env.GITHUB_SHA || null,
            dataUpdated: (readJSON('data/last-updated.json', {}) || {}).lastUpdated ?? null
        },
        counts: {
            elements: boot.elements.length,
            projected: projected.length,
            withFixture: withFixture.length,
            doubles: rows.filter(r => r.fx && r.fx.length > 1).length,
            blanks: rows.filter(r => r.fx && r.fx.length === 0).length,
            failed: failed.length,
            rising: rising.length
        },
        risingError: risingError || undefined,
        risingNote: 'What scripts/form-trend.js ranked as rising at this deadline, in order. '
            + 'Each row carries the terms the ranking was made of — the recent and prior '
            + 'windows, the weighted near-term FDR and the ownership — because a score with '
            + 'nothing beside it cannot be argued with afterwards. Ownership is as it stood '
            + 'at takenAt and moves within hours.',
        note: 'What scripts/xp-engine.js projected for this gameweek, recorded before the deadline '
            + 'and never edited afterwards. Written by tools/snapshot-predictions.mjs. '
            + 'Availability, ep_next, form and points_per_game are as they stood at takenAt; '
            + 'none of them can be recovered later.'
    };
    // undefined does not survive JSON, but being explicit beats relying on it.
    if (!meta.forced) delete meta.forced;
    if (!meta.risingError) delete meta.risingError;

    const text = serialise(meta, rows, rising);
    JSON.parse(text);            // never ship a file we cannot read back
    return { written: true, gw, meta, text, rows, rising };
}

function main() {
    const argv = process.argv.slice(2);
    const flag = (name) => argv.includes(name);
    const opt = (name, fallback) => {
        const i = argv.indexOf(name);
        return i >= 0 && argv[i + 1] != null ? Number(argv[i + 1]) : fallback;
    };

    const result = takeSnapshot({
        withinHours: opt('--within-hours', DEFAULT_WINDOW_H),
        force: flag('--force')
    });

    if (!result.written) {
        console.log(`No snapshot: ${result.why}`);
        return;
    }

    const { gw, meta } = result;
    const c = meta.counts;
    console.log(`GW${gw}: ${c.projected}/${c.elements} players projected, `
        + `${c.withFixture} with a fixture, ${c.doubles} doubles, ${c.blanks} blanks, `
        + `${meta.hoursBeforeDeadline}h before the deadline.`);
    console.log(meta.risingError
        ? `::warning::Rising Form board not archived: ${meta.risingError}`
        : `Rising Form: ${c.rising} players ranked.`);

    if (flag('--dry-run')) {
        const top = result.rows.filter(r => r.xp != null).sort((a, b) => b.xp - a.xp).slice(0, 5);
        console.log(`Dry run — nothing written. Top projected: ${top.map(r => `${r.id}:${r.xp}`).join(', ')}`);
        return;
    }

    /* Refusing to overwrite a sealed gameweek.

       The window check already requires a future deadline, so this can only
       trigger if a file was somehow written for a round that has since started.
       It is here because the cost of being wrong is silently replacing a real
       prediction with one made in hindsight, which would poison the archive in
       a way nothing downstream could detect. */
    const outPath = path.join(REPO_ROOT, OUT_DIR, `gw${gw}.json`);
    const existing = readJSON(`${OUT_DIR}/gw${gw}.json`, null);
    if (existing && Date.parse(existing.deadlineTime) <= Date.now()) {
        console.log(`GW${gw} is already sealed (its deadline has passed); leaving it alone.`);
        return;
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, result.text);
    console.log(`Wrote ${OUT_DIR}/gw${gw}.json (${(result.text.length / 1024).toFixed(0)} KB)`
        + `${existing ? ' — replacing an earlier look at the same round' : ''}`);
}

if (import.meta.filename === process.argv[1]) main();
