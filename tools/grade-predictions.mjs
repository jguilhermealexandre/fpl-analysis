#!/usr/bin/env node
/* What the model said, against what happened.

   Reads every sealed round in data/model-log/, joins it to the actual scores in
   data/players-data.json, and writes data/model-accuracy.json. Nothing here
   invents a number: predictions come from the archive, results come from FPL.

   RECOMPUTED FROM SCRATCH EVERY RUN

   There is no incremental state and no "already graded" marker. Reading 38
   files costs nothing, and the alternative rots: the day a metric definition
   changes, an incremental file holds old rounds measured one way and new rounds
   measured another, with nothing on its face to say so.

   THREE DECISIONS THAT DECIDE WHETHER THE NUMBERS MEAN ANYTHING

   1. Blanks are excluded. A player with no fixture is predicted zero and scores
      zero. That is arithmetic, not forecasting, and leaving blanks in pays the
      model for them — while punishing the season-average baseline, which does
      not know about blanks. Counted and reported, never scored.

   2. Populations are defined from the PREDICTION, never the result. "Starters"
      means the model gave him a start probability of 0.5 or better, not that he
      turned out to play. Defining the population by the outcome is hindsight,
      and it is the most common way an accuracy page flatters itself.

   3. Everything is reported against baselines. An MAE of 2.0 is meaningless
      alone: FPL publishes its own ep_next, and a season average costs nothing
      to compute. If the model cannot beat those it is not a model, and this
      file should be what says so.

   Usage:
     node tools/grade-predictions.mjs [--out data/model-accuracy.json] [--quiet]
*/
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './xp-engine-host.mjs';

const LOG_DIR = 'data/model-log';
const OUT = 'data/model-accuracy.json';

/* A round is only graded once FPL says its data is checked — bonus applied,
   appeals settled. Grading a live round would record a number that changes
   under it. */
const READY = e => e && e.finished === true && e.data_checked === true;

// Below this share of the round's players found in the results, something is
// wrong with the feed rather than with the model. Skip the round rather than
// publish a figure computed from a fraction of it.
const MIN_COVERAGE = 0.9;

const readJSON = (rel, fallback) => {
    try { return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')); }
    catch { return fallback; }
};
const r3 = v => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

/* ---- statistics ---------------------------------------------------------- */

export function errorStats(pairs) {
    const n = pairs.length;
    if (!n) return { n: 0, mae: null, rmse: null, bias: null };
    let abs = 0, sq = 0, signed = 0;
    for (const [pred, actual] of pairs) {
        const d = pred - actual;
        abs += Math.abs(d);
        sq += d * d;
        signed += d;
    }
    // bias is signed and in the model's favour when positive: we said more than
    // happened. It is the number the recalibration layer will read.
    return { n, mae: r3(abs / n), rmse: r3(Math.sqrt(sq / n)), bias: r3(signed / n) };
}

/* Average ranks, so ties do not invent an ordering.

   This matters more here than in most places: actual FPL scores are mostly 0s,
   1s and 2s, so a third of any round is tied. Ranking them arbitrarily would
   manufacture agreement or disagreement out of sort order. */
export function ranks(values) {
    const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const out = new Array(values.length);
    let i = 0;
    while (i < order.length) {
        let j = i;
        while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
        const avg = (i + j) / 2 + 1;
        for (let k = i; k <= j; k++) out[order[k][1]] = avg;
        i = j + 1;
    }
    return out;
}

function pearson(xs, ys) {
    const n = xs.length;
    if (n < 3) return null;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
        const dx = xs[i] - mx, dy = ys[i] - my;
        sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    const denom = Math.sqrt(sxx * syy);
    return denom > 1e-12 ? sxy / denom : null;
}

export function spearman(xs, ys) {
    if (xs.length < 3) return null;
    return r3(pearson(ranks(xs), ranks(ys)));
}

/* Where the model sits against the things it has to beat. Positive means the
   model's squared error is smaller; 0.1 is "ten per cent better than that". */
function skill(modelRmse, baseRmse) {
    if (!Number.isFinite(modelRmse) || !Number.isFinite(baseRmse) || baseRmse <= 0) return null;
    return r3((baseRmse - modelRmse) / baseRmse);
}

const BASELINES = [
    ['ep', 'FPL\'s own ep_next at the deadline'],
    ['ppg', 'the player\'s points per game so far this season'],
    ['form', 'the player\'s recent form figure']
];

function scoreOne(rows) {
    const model = errorStats(rows.map(r => [r.xp, r.actual]));
    const baselines = {};
    for (const [key] of BASELINES) {
        const usable = rows.filter(r => Number.isFinite(r[key]));
        const s = errorStats(usable.map(r => [r[key], r.actual]));
        baselines[key] = { ...s, modelBeatsBy: skill(model.rmse, s.rmse) };
    }
    return {
        ...model,
        spearman: spearman(rows.map(r => r.xp), rows.map(r => r.actual)),
        baselines
    };
}

/* Ten buckets by what was predicted, each reporting what actually happened.

   This is the shape the recalibration layer reads: if the 1.5-2.0 bucket keeps
   averaging 1.1, that is a correction waiting to be applied, and it is
   invisible in a single pooled MAE. */
function calibration(rows) {
    if (!rows.length) return [];
    const max = Math.max(...rows.map(r => r.xp));
    if (!(max > 0)) return [];
    const width = max / 10;
    const out = [];
    for (let b = 0; b < 10; b++) {
        const lo = b * width, hi = b === 9 ? Infinity : (b + 1) * width;
        const inBucket = rows.filter(r => r.xp >= lo && r.xp < hi);
        if (!inBucket.length) continue;
        out.push({
            from: r3(lo),
            to: b === 9 ? r3(max) : r3(hi),
            n: inBucket.length,
            meanPredicted: r3(inBucket.reduce((a, r) => a + r.xp, 0) / inBucket.length),
            meanActual: r3(inBucket.reduce((a, r) => a + r.actual, 0) / inBucket.length)
        });
    }
    return out;
}

/* The armband, which is the decision this model is most used for and the one
   where being averagely right is worth least.

   Reported next to the best that was available, because a captain score means
   nothing without knowing what a perfect week would have paid. */
function captaincy(rows) {
    if (rows.length < 2) return null;
    const pick = key => rows.filter(r => Number.isFinite(r[key]))
        .reduce((best, r) => (best && best[key] >= r[key] ? best : r), null);
    const ours = pick('xp');
    const theirs = pick('ep');
    const best = rows.reduce((b, r) => (b && b.actual >= r.actual ? b : r), null);

    const topN = (key, n) => rows.filter(r => Number.isFinite(r[key]))
        .slice().sort((a, b) => b[key] - a[key]).slice(0, n).map(r => r.id);
    const ourTop20 = new Set(topN('xp', 20));
    const realTop20 = topN('actual', 20);

    return {
        ourPick: ours ? { id: ours.id, predicted: ours.xp, scored: ours.actual } : null,
        epPick: theirs ? { id: theirs.id, predicted: theirs.ep, scored: theirs.actual } : null,
        bestAvailable: best ? { id: best.id, scored: best.actual } : null,
        top20Hits: realTop20.filter(id => ourTop20.has(id)).length
    };
}

/* ---- joining a round to what happened ------------------------------------ */

/* Actual points for one gameweek, per player.

   A double gameweek is two history rows with the same round, and they are
   SUMMED — the archived prediction covers both matches, so the result has to as
   well. Taking the first would grade a two-match projection against one match
   and call the model wildly over-confident twice a season. */
export function actualsFor(playersData, gw) {
    const out = new Map();
    for (const p of (playersData.players || [])) {
        let points = 0, minutes = 0, fixtures = 0;
        for (const h of (p.history || [])) {
            if (h.round !== gw) continue;
            points += h.total_points || 0;
            minutes += h.minutes || 0;
            fixtures++;
        }
        if (fixtures) out.set(p.id, { points, minutes, fixtures });
    }
    return out;
}

const POPULATIONS = [
    ['all', 'every player with a fixture', () => true],
    ['starters', 'the model gave him a start probability of 0.5 or better', r => r.pStart >= 0.5],
    ['owned', 'owned by 5% of managers or more at the deadline', r => r.sel >= 5]
];

const POSITIONS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };

/* Did the Rising Form board pick players who then scored?

   The board is a RANKING, not a points prediction, so it cannot be graded with
   RMSE. What it claims is an ordering — these players, in this order, are the
   ones worth buying — and the honest tests of an ordering are whether the
   players it named beat the ones it did not, and whether its own order
   correlates with what happened.

   The comparison pool is everyone who had a fixture and was not on the board,
   which is a harsh baseline on purpose: it includes every premium in the game.
   The board is explicitly tilted towards low ownership, so beating the field on
   raw points is not what it is trying to do and a shortfall there is not
   automatically a failure. `meanOwnership` is reported beside the points for
   exactly that reason — a board that scores the same as the field at a third of
   the ownership has done something useful, and one that scores the same at the
   same ownership has not.

   Small samples are the norm here: fifty-odd players a week, and a top ten is
   ten. Nothing below is significant on one round and the note says so. */
export function gradeRising(snapshot, actuals) {
    const board = snapshot.rising || [];
    if (!board.length) return null;

    const pointsOf = (id) => {
        const a = actuals.get(id);
        return a ? a.points : null;
    };
    const scored = board
        .map(r => ({ ...r, actual: pointsOf(r.id) }))
        .filter(r => r.actual != null);
    if (!scored.length) return { gw: snapshot.gw, skipped: 'nobody on the board had a fixture' };

    const onBoard = new Set(board.map(r => r.id));
    const rest = [];
    for (const [id, a] of actuals) if (!onBoard.has(id)) rest.push(a.points);

    const mean = (xs) => (xs.length ? xs.reduce((t, v) => t + v, 0) / xs.length : null);
    const round2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
    const returnRate = (xs) => (xs.length
        ? Math.round((xs.filter(v => v >= 6).length / xs.length) * 100) : null);

    const pts = scored.map(r => r.actual);
    const topN = (n) => scored.slice(0, n).map(r => r.actual);

    return {
        gw: snapshot.gw,
        counts: { ranked: board.length, graded: scored.length, field: rest.length },
        board: {
            meanPoints: round2(mean(pts)),
            returnRate: returnRate(pts),
            meanOwnership: round2(mean(scored.map(r => r.sel))),
            meanFdr: round2(mean(scored.map(r => r.fdrNear).filter(Number.isFinite)))
        },
        top10: { meanPoints: round2(mean(topN(10))), returnRate: returnRate(topN(10)) },
        field: {
            meanPoints: round2(mean(rest)),
            returnRate: returnRate(rest)
        },
        /* Does its own order mean anything? Spearman between board rank and
           points scored. Negative rank against points is the good direction, so
           this is signed to make positive good. */
        rankCorrelation: round2(-spearman(scored.map(r => r.rank), pts))
    };
}

export function gradeRound(snapshot, actuals) {
    const withFixture = (snapshot.players || []).filter(p => p.xp != null && p.fx && p.fx.length);
    const blanks = (snapshot.players || []).filter(p => p.fx && p.fx.length === 0).length;

    const rows = [];
    let missing = 0;
    for (const p of withFixture) {
        const a = actuals.get(p.id);
        if (!a) { missing++; continue; }
        rows.push({
            id: p.id, pos: p.pos, sel: p.sel ?? 0, pStart: p.pStart ?? 0,
            fixtures: p.fx.length,
            xp: p.xp, ep: p.ep, ppg: p.ppg, form: p.form,
            actual: a.points, minutes: a.minutes
        });
    }

    const coverage = withFixture.length ? rows.length / withFixture.length : 0;
    if (coverage < MIN_COVERAGE) {
        return { gw: snapshot.gw, skipped: `only ${rows.length} of ${withFixture.length} players found in the results` };
    }

    const populations = {};
    for (const [name, , test] of POPULATIONS) {
        const subset = rows.filter(test);
        if (subset.length) populations[name] = scoreOne(subset);
    }

    const byPosition = {};
    for (const [code, label] of Object.entries(POSITIONS)) {
        const subset = rows.filter(r => r.pos === Number(code) && r.pStart >= 0.5);
        if (subset.length) byPosition[label] = scoreOne(subset);
    }

    const starters = rows.filter(r => r.pStart >= 0.5);
    return {
        gw: snapshot.gw,
        /* Sealed or rebuilt, and never quietly mixed. A sealed round is evidence:
           the model that wrote it is the model the site was serving. A rebuilt
           one shares its inputs but not its model — see
           tools/backfill-predictions.mjs — so it belongs in a different column. */
        reconstructed: snapshot.reconstructed === true,
        sources: snapshot.sources || null,
        deadlineTime: snapshot.deadlineTime,
        takenAt: snapshot.takenAt,
        model: snapshot.model || null,
        counts: {
            graded: rows.length,
            starters: starters.length,
            blanksExcluded: blanks,
            notFoundInResults: missing,
            doubles: rows.filter(r => r.fixtures > 1).length
        },
        populations,
        byPosition,
        calibration: calibration(starters),
        captaincy: captaincy(starters),
        rising: gradeRising(snapshot, actuals),
        rows
    };
}

/* ---- the whole archive --------------------------------------------------- */

/* A round as it appears in the published file: everything except the per-player
   rows, which are the working data the pooled figures are computed from. Six
   hundred of them per round would multiply the file fifty-fold for no reader,
   and the grader recomputes them from the archive whenever they are wanted. */
function published(round) {
    const out = { ...round };
    delete out.rows;
    return out;
}

export function gradeAll({ boot, playersData, snapshots }) {
    const eventById = new Map((boot.events || []).map(e => [e.id, e]));
    const rounds = [];
    const skipped = [];

    for (const snap of snapshots.slice().sort((a, b) => a.gw - b.gw)) {
        if (!READY(eventById.get(snap.gw))) {
            skipped.push({ gw: snap.gw, why: 'the round is not finished and data-checked yet' });
            continue;
        }
        const graded = gradeRound(snap, actualsFor(playersData, snap.gw));
        if (graded.skipped) { skipped.push({ gw: graded.gw, why: graded.skipped }); continue; }
        rounds.push(graded);
    }

    /* Season to date pools the player-fixtures rather than averaging the
       rounds. Averaging would weight a blank-hit gameweek of 200 players the
       same as a full one of 600, which is not what "so far this season" means.

       Only the sealed rounds. The headline on the accuracy page claims nothing
       is computed from hindsight, and that claim survives only if a rebuilt
       round — whose model has seen the results — never reaches it. */
    const sealedRounds = rounds.filter(r => !r.reconstructed);
    const rebuiltRounds = rounds.filter(r => r.reconstructed);
    const pooled = sealedRounds.flatMap(r => r.rows);
    const overall = {};
    for (const [name, , test] of POPULATIONS) {
        const subset = pooled.filter(test);
        if (subset.length) overall[name] = scoreOne(subset);
    }
    const overallByPosition = {};
    for (const [code, label] of Object.entries(POSITIONS)) {
        const subset = pooled.filter(r => r.pos === Number(code) && r.pStart >= 0.5);
        if (subset.length) overallByPosition[label] = scoreOne(subset);
    }
    const pooledStarters = pooled.filter(r => r.pStart >= 0.5);

    /* Rising Form across the rounds that carried a board. Pooled the same way
       the xP figures are — by player-round rather than by averaging rounds — so
       a week with eight names does not count as much as a week with sixty. */
    const risingRounds = sealedRounds.map(r => r.rising).filter(r => r && !r.skipped);
    const weighted = (pick, count) => {
        let num = 0, den = 0;
        for (const r of risingRounds) {
            const v = pick(r), n = count(r);
            if (Number.isFinite(v) && n) { num += v * n; den += n; }
        }
        return den ? Math.round((num / den) * 100) / 100 : null;
    };
    const risingOverall = risingRounds.length ? {
        gameweeks: risingRounds.map(r => r.gw),
        playerRounds: risingRounds.reduce((t, r) => t + r.counts.graded, 0),
        board: {
            meanPoints: weighted(r => r.board.meanPoints, r => r.counts.graded),
            returnRate: weighted(r => r.board.returnRate, r => r.counts.graded),
            meanOwnership: weighted(r => r.board.meanOwnership, r => r.counts.graded)
        },
        field: {
            meanPoints: weighted(r => r.field.meanPoints, r => r.counts.field),
            returnRate: weighted(r => r.field.returnRate, r => r.counts.field)
        },
        rankCorrelation: weighted(r => r.rankCorrelation, r => r.counts.graded),
        note: risingRounds.length < 10
            ? `${risingRounds.length} gameweek(s) of board. Nothing here is significant yet — `
                + 'a ranking needs ten to fifteen rounds before its edge can be told from noise.'
            : 'Board against the rest of the field. The board is tilted towards low ownership, '
                + 'so read meanPoints next to meanOwnership rather than on its own.'
    } : null;

    return {
        metadata: {
            lastUpdated: null,               // stamped by the caller
            gameweeksGraded: sealedRounds.map(r => r.gw),
            gameweeksBacktested: rebuiltRounds.map(r => r.gw),
            playerFixturesGraded: pooled.length,
            skipped,
            populations: Object.fromEntries(POPULATIONS.map(([n, why]) => [n, why])),
            baselines: Object.fromEntries(BASELINES),
            note: 'What scripts/xp-engine.js predicted before each deadline, against what FPL '
                + 'recorded afterwards. Predictions come from data/model-log/, results from '
                + 'data/players-data.json. Players with no fixture are excluded: predicting zero '
                + 'for a blank is arithmetic, not forecasting. Populations are defined from the '
                + 'prediction and never from the result. Written by tools/grade-predictions.mjs.'
        },
        overall: {
            populations: overall,
            byPosition: overallByPosition,
            calibration: calibration(pooledStarters),
            rising: risingOverall
        },
        /* Rebuilt rounds, scored the same way and kept apart. Everything here
           used inputs from before its deadline, so no result leaked in — but the
           model is the current one, which has been edited since those rounds were
           played. Rising Form was rewritten with this season on screen, so its
           numbers here are optimistic by construction. Read this as "is the
           arithmetic sane", never as "the model beats the market". */
        backtest: rebuiltRounds.length ? {
            gameweeks: rebuiltRounds.map(r => r.gw),
            playerFixtures: rebuiltRounds.reduce((t, r) => t + r.rows.length, 0),
            populations: (() => {
                const pool = rebuiltRounds.flatMap(r => r.rows);
                const out = {};
                for (const [name, , test] of POPULATIONS) {
                    const subset = pool.filter(test);
                    if (subset.length) out[name] = scoreOne(subset);
                }
                return out;
            })(),
            byPosition: (() => {
                const pool = rebuiltRounds.flatMap(r => r.rows).filter(r => r.pStart >= 0.5);
                const out = {};
                for (const [code, label] of Object.entries(POSITIONS)) {
                    const subset = pool.filter(r => r.pos === Number(code));
                    if (subset.length) out[label] = scoreOne(subset);
                }
                return out;
            })(),
            calibration: calibration(rebuiltRounds.flatMap(r => r.rows).filter(r => r.pStart >= 0.5)),
            rounds: rebuiltRounds.map(published),
            note: 'Reconstructed, not sealed. Inputs are the committed data files as they stood '
                + 'before each deadline; the model is the one running today. Not evidence that the '
                + 'model works — evidence that it is arithmetically sound over real inputs.'
        } : null,
        rounds: sealedRounds.map(published)
    };
}

/* ---- cli ----------------------------------------------------------------- */

export function loadSnapshots(dir = LOG_DIR) {
    const full = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(full)) return [];
    return fs.readdirSync(full)
        .filter(f => /^gw\d+\.json$/.test(f))
        .map(f => readJSON(`${dir}/${f}`, null))
        .filter(s => s && Number.isFinite(s.gw));
}

function main() {
    const argv = process.argv.slice(2);
    const outRel = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : OUT;

    const boot = readJSON('data/bootstrap-static.json', null);
    const playersData = readJSON('data/players-data.json', null);
    if (!boot || !playersData) throw new Error('bootstrap-static.json or players-data.json is missing');

    const snapshots = loadSnapshots();
    const result = gradeAll({ boot, playersData, snapshots });
    result.metadata.lastUpdated = new Date().toISOString();

    /* A daily job whose only change is its own timestamp would commit every day
       forever and bury the days something actually moved. Rounds are graded
       once and never change afterwards, so an identical file apart from
       lastUpdated means nothing happened — leave it alone. */
    const withoutStamp = o => JSON.stringify({ ...o, metadata: { ...o.metadata, lastUpdated: null } });
    const existing = readJSON(outRel, null);
    if (existing && withoutStamp(existing) === withoutStamp(result)) {
        if (!argv.includes('--quiet')) console.log(`No change since the last run; ${outRel} left as it is.`);
        return;
    }

    const text = JSON.stringify(result, null, 1) + '\n';
    JSON.parse(text);
    fs.writeFileSync(path.join(REPO_ROOT, outRel), text);

    const g = result.metadata.gameweeksGraded;
    if (!argv.includes('--quiet')) {
        if (!g.length) {
            console.log(`Nothing graded yet — ${snapshots.length} snapshot(s) on file, none of them a finished round.`);
        } else {
            const s = result.overall.populations.starters;
            console.log(`Graded GW${g.join(', GW')} — ${result.metadata.playerFixturesGraded} player-fixtures.`);
            if (s) {
                console.log(`Starters: MAE ${s.mae}, RMSE ${s.rmse}, bias ${s.bias}, `
                    + `rank corr ${s.spearman}; vs FPL ep_next ${s.baselines.ep.modelBeatsBy}, `
                    + `vs season average ${s.baselines.ppg.modelBeatsBy}.`);
            }
        }
        console.log(`Wrote ${outRel}.`);
    }
}

if (import.meta.filename === process.argv[1]) main();
