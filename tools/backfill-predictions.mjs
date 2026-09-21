#!/usr/bin/env node
/* What the CURRENT model would have said, from the inputs as they stood.

   NOT A SNAPSHOT, and the difference is the whole point of this comment.

   tools/snapshot-predictions.mjs seals a prediction before a deadline and never
   touches it again: the model that wrote it is the model the site was serving,
   and the file is evidence. This is a different and weaker thing. It rebuilds
   the INPUTS from git — the committed data files are exactly what the site
   served, and every one of them exists an hour or two before each deadline —
   and then runs TODAY's engine over them.

   So there is no hindsight in the inputs. There is hindsight in the model, and
   pretending otherwise would be the most flattering lie this repo could tell:

     - The engine has been edited since those rounds were played.
     - Rising Form was rewritten THIS WEEK, with this season's data on screen.
       Its gates were chosen knowing how GW1-5 turned out. A backtest of it over
       those rounds is optimistic by construction and is not evidence that it
       works.

   Every round written here carries reconstructed: true, the grader keeps them
   out of the sealed figures, and the page labels them. They are worth having
   anyway — calibration shape, positional bias and error magnitude are all real
   and all readable from four rounds — but they answer "is the arithmetic sane",
   not "does the model beat the market".

   It refuses to overwrite a sealed snapshot. A real one always wins.

   Usage:
     node tools/backfill-predictions.mjs [--gw 3] [--dry-run] [--force]
       --gw       one gameweek only (default: every finished, data-checked round)
       --force    rewrite a reconstructed file that already exists
       --dry-run  report and write nothing
*/
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT } from './xp-engine-host.mjs';
import { rankRisingForm } from './rising-form-host.mjs';
import { buildProjector, projectOne, PARTS } from './xp-engine-host.mjs';

const OUT_DIR = 'data/model-log';
const TRACKED = ['data/bootstrap-static.json', 'data/fixtures.json', 'data/players-data.json'];

const round = (v, dp) => (Number.isFinite(v) ? Math.round(v * 10 ** dp) / 10 ** dp : null);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

const git = (args) => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/* The last commit that touched `file` strictly before `when`.

   Per file rather than per commit: fixtures.json only changes when the fixture
   list does, so the newest commit touching it can be three days older than the
   newest bootstrap. Taking one commit for all three would either drag bootstrap
   backwards or pull fixtures forward past the deadline. */
export function lastCommitBefore(file, whenMs) {
    const iso = new Date(whenMs).toISOString();
    const out = git(['log', '-1', `--before=${iso}`, '--format=%H %cI', '--', file]).trim();
    if (!out) return null;
    const [sha, at] = out.split(/\s+/);
    return { sha, at, atMs: Date.parse(at) };
}

export function fileAt(sha, file) {
    return JSON.parse(git(['show', `${sha}:${file}`]));
}

/* Which rounds can be rebuilt: finished, checked by FPL, and not already
   sealed. A sealed file is evidence and is never replaced by a reconstruction. */
export function backfillable(boot, { dir = OUT_DIR, only = null, force = false } = {}) {
    const out = [];
    for (const e of (boot.events || [])) {
        if (!e.finished || !e.data_checked) continue;
        if (only && e.id !== only) continue;
        const rel = path.join(dir, `gw${e.id}.json`);
        const abs = path.join(REPO_ROOT, rel);
        if (fs.existsSync(abs)) {
            let existing = null;
            try { existing = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { /* unreadable: leave it */ }
            if (!existing || !existing.reconstructed) {
                out.push({ gw: e.id, skip: 'a sealed snapshot already exists, and it wins' });
                continue;
            }
            if (!force) { out.push({ gw: e.id, skip: 'already reconstructed; --force to rebuild' }); continue; }
        }
        out.push({ gw: e.id, deadline: e.deadline_time, at: Date.parse(e.deadline_time) });
    }
    return out;
}

function buildRow(el, player, engine, gw) {
    const base = {
        id: el.id, pos: el.element_type, team: el.team, price: el.now_cost / 10,
        status: el.status || null, chance: el.chance_of_playing_next_round ?? null,
        sel: num(el.selected_by_percent), ep: num(el.ep_next),
        ppg: num(el.points_per_game), form: num(el.form)
    };
    if (!player) return { ...base, xp: null, why: 'not built by xpBuildPlayers' };

    const p = projectOne(engine, player, gw);
    const fx = p.matches.map(f => ({
        o: f.opponentId ?? f.opponent ?? null, h: f.isHome ? 1 : 0, d: f.difficulty ?? null
    }));
    const row = { ...base, fx, xp: round(p.total, 2), pStart: round(p.pStart, 3), xMins: round(p.expMins, 1) };
    if (fx.length) {
        const parts = {};
        PARTS.forEach(k => { parts[k] = round(p.parts[k], 3); });
        row.parts = parts;
        row.partsTotal = round(p.partsTotal, 3);
    }
    return row;
}

function serialise(meta, rows, rising) {
    const head = Object.entries(meta)
        .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
    const body = rows.map(r => `    ${JSON.stringify(r)}`).join(',\n');
    const board = (rising || []).map(r => `    ${JSON.stringify(r)}`).join(',\n');
    return `{\n${head},\n  "players": [\n${body}\n  ],\n  "rising": [\n${board}\n  ]\n}\n`;
}

export function rebuildRound(gw, deadlineMs) {
    const sources = {};
    for (const f of TRACKED) {
        const c = lastCommitBefore(f, deadlineMs);
        if (!c) throw new Error(`no commit of ${f} before GW${gw}'s deadline`);
        sources[f] = c;
    }
    const boot = fileAt(sources['data/bootstrap-static.json'].sha, 'data/bootstrap-static.json');
    const fixtures = fileAt(sources['data/fixtures.json'].sha, 'data/fixtures.json');
    const playersData = fileAt(sources['data/players-data.json'].sha, 'data/players-data.json');

    /* The round must still be ahead of the data. If the archived fixtures
       already carry this gameweek's scores then the "prediction" would be built
       from its own result, which is the one thing that must never happen. */
    const leaked = (fixtures || []).filter(f => f.event === gw && f.finished_provisional);
    if (leaked.length) {
        throw new Error(`GW${gw}: the reconstructed fixtures already contain ${leaked.length} finished `
            + 'match(es) of the round being predicted — that is hindsight, not a backtest');
    }

    const { engine, players } = buildProjector(boot, fixtures, gw);
    const byId = new Map(players.map(p => [p.id, p]));
    const rows = [];
    for (const el of boot.elements) {
        try { rows.push(buildRow(el, byId.get(el.id), engine, gw)); }
        catch { /* one odd player is football; the coverage check below catches a broken engine */ }
    }

    let rising = [];
    let risingError = null;
    try { rising = rankRisingForm(boot, fixtures, playersData, gw); }
    catch (err) { risingError = err.message; }

    const projected = rows.filter(r => r.xp != null);
    if (projected.length < boot.elements.length * 0.9) {
        throw new Error(`GW${gw}: only ${projected.length} of ${boot.elements.length} players projected`);
    }

    const meta = {
        gw,
        reconstructed: true,
        deadlineTime: new Date(deadlineMs).toISOString(),
        takenAt: null,
        rebuiltAt: new Date().toISOString(),
        sources: Object.fromEntries(Object.entries(sources).map(([f, c]) => [f, {
            commit: c.sha.slice(0, 12), at: c.at,
            hoursBeforeDeadline: round((deadlineMs - c.atMs) / 3600000, 1)
        }])),
        model: {
            assetVersion: JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'asset-version.json'), 'utf8')).version ?? null,
            commit: process.env.GITHUB_SHA || null
        },
        counts: {
            elements: boot.elements.length,
            projected: projected.length,
            withFixture: rows.filter(r => r.fx && r.fx.length).length,
            blanks: rows.filter(r => r.fx && r.fx.length === 0).length,
            rising: rising.length
        },
        risingError: risingError || undefined,
        note: 'RECONSTRUCTED, not sealed. The inputs are the committed data files as they stood '
            + 'before this deadline, so no result leaks into them — but the model is the one running '
            + 'today, not the one the site served at the time. Rising Form in particular was rewritten '
            + 'with this season on screen, so its figures here are optimistic by construction and are '
            + 'not evidence that it works. Written by tools/backfill-predictions.mjs.'
    };
    if (!meta.risingError) delete meta.risingError;

    const text = serialise(meta, rows, rising);
    JSON.parse(text);
    return { gw, meta, text, rows, rising };
}

function main() {
    const argv = process.argv.slice(2);
    const flag = (n) => argv.includes(n);
    const optNum = (n) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? Number(argv[i + 1]) : null; };

    const boot = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data/bootstrap-static.json'), 'utf8'));
    const targets = backfillable(boot, { only: optNum('--gw'), force: flag('--force') });
    if (!targets.length) { console.log('No finished, data-checked gameweek to rebuild.'); return; }

    fs.mkdirSync(path.join(REPO_ROOT, OUT_DIR), { recursive: true });
    let written = 0;
    for (const t of targets) {
        if (t.skip) { console.log(`GW${t.gw}: skipped — ${t.skip}`); continue; }
        let result;
        try { result = rebuildRound(t.gw, t.at); }
        catch (err) { console.error(`::warning::GW${t.gw} could not be rebuilt: ${err.message}`); continue; }

        const c = result.meta.counts;
        console.log(`GW${t.gw}: ${c.projected}/${c.elements} projected, ${c.rising} rising, `
            + `inputs from ${result.meta.sources['data/bootstrap-static.json'].hoursBeforeDeadline}h before the deadline.`);
        if (flag('--dry-run')) continue;
        fs.writeFileSync(path.join(REPO_ROOT, OUT_DIR, `gw${t.gw}.json`), result.text);
        written++;
    }
    console.log(flag('--dry-run') ? 'Dry run — nothing written.' : `Wrote ${written} reconstructed round(s).`);
}

if (process.argv[1] && process.argv[1].endsWith('backfill-predictions.mjs')) main();
