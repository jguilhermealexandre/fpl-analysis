#!/usr/bin/env node
/* Bookmakers' prices for the upcoming Premier League round, as probabilities.

   Source is football-data.co.uk's fixtures.csv: one file, no API key, no
   account, covering the next round across a dozen European divisions. That
   matters more than it sounds — an odds API key cannot go anywhere near the
   browser on a static site, so anything requiring one has to be fetched here and
   committed, and anything free of one can be fetched here without a secret to
   leak in the first place.

   What it is not: a source of odds for GW+5. Bookmakers price a round at a time,
   so this covers the next gameweek and nothing beyond it. The site's own
   projection remains the only thing that can see further than that, and this
   feed is deliberately a second opinion on one gameweek rather than a
   replacement for it.

   Writes data/odds.json. On any failure it leaves the existing file untouched
   and exits non-zero — a stale odds panel is a small problem, an empty one that
   claims a fixture has no chance of a clean sheet is a much larger one.

   Usage: node tools/fetch-odds.mjs [--out data/odds.json] [--csv /tmp/fx.csv]
                                    [--calibration data/odds-calibration.json] */
import fs from 'node:fs';
import { deriveMatch } from './odds-model.mjs';
import { calibrationSample, appendRound, summarise } from './odds-calibration.mjs';

const FIXTURES_URL = 'https://www.football-data.co.uk/fixtures.csv';
const DIVISION = 'E0';                 // Premier League
const MIN_FIXTURES = 5;                // below this the round is not usable

/* football-data.co.uk's club names against FPL's. Only the genuine
   disagreements are listed; everything else matches on the nose. Kept explicit
   rather than fuzzy-matched, because a near-match that silently picks the wrong
   club would attach one team's clean-sheet odds to another's players. */
const TEAM_ALIASES = {
    'Man United': 'Man Utd',
    'Tottenham': 'Spurs',
    'Coventry': 'Coventry City',
    'Hull': 'Hull City',
    'Ipswich': 'Ipswich Town',
    'Sheffield United': 'Sheffield Utd',
    'Nott\'m Forest': 'Nott\'m Forest',
    'Newcastle': 'Newcastle',
    'Wolves': 'Wolves',
    'Leicester': 'Leicester',
    'West Ham': 'West Ham',
    'West Brom': 'West Brom',
    'Luton': 'Luton'
};

function parseCsv(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return [];
    const split = (line) => {
        const out = [];
        let cur = '', quoted = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') { quoted = !quoted; continue; }
            if (c === ',' && !quoted) { out.push(cur); cur = ''; continue; }
            cur += c;
        }
        out.push(cur);
        return out;
    };
    const header = split(lines[0]).map(h => h.trim());
    return lines.slice(1).map(line => {
        const cells = split(line);
        const row = {};
        header.forEach((h, i) => { row[h] = (cells[i] ?? '').trim(); });
        return row;
    });
}

/* The consensus price where there is one, a named book where there is not.

   Avg* is the average across every bookmaker in the file, which is a better
   estimate than any single book and much less prone to one stale quote. B365
   and Max are fallbacks for the rare row where the average column is blank. */
function pickOdds(row, keys) {
    for (const key of keys) {
        const v = parseFloat(row[key]);
        if (Number.isFinite(v) && v > 1) return v;
    }
    return null;
}

function fail(message) {
    console.error(`::error::${message}`);
    process.exit(1);
}

async function main() {
    const args = process.argv.slice(2);
    const outPath = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'data/odds.json';
    const csvArg = args.includes('--csv') ? args[args.indexOf('--csv') + 1] : null;
    const calibPath = args.includes('--calibration') ? args[args.indexOf('--calibration') + 1] : 'data/odds-calibration.json';

    let csv;
    if (csvArg) {
        csv = fs.readFileSync(csvArg, 'utf8');
    } else {
        const res = await fetch(FIXTURES_URL, {
            headers: { 'User-Agent': 'easyfpl-odds-bot (+https://easyfpl.com)' },
            signal: AbortSignal.timeout(30000)
        });
        if (!res.ok) fail(`fixtures.csv returned HTTP ${res.status} — keeping the existing odds`);
        csv = await res.text();
    }
    if (!csv || csv.length < 500) fail('fixtures.csv came back empty or truncated — keeping the existing odds');

    const rows = parseCsv(csv).filter(r => r.Div === DIVISION);
    if (!rows.length) fail(`no ${DIVISION} fixtures in fixtures.csv — keeping the existing odds`);

    // FPL is the authority on who is playing whom and when. Matching against it
    // gives the gameweek and the true UTC kick-off for free, instead of guessing
    // a timezone from the CSV's local time, and drops anything FPL does not
    // recognise rather than publishing a fixture the site cannot join to.
    const boot = JSON.parse(fs.readFileSync('data/bootstrap-static.json', 'utf8'));
    const fixtures = JSON.parse(fs.readFileSync('data/fixtures.json', 'utf8'));
    const teamByName = new Map(boot.teams.map(t => [t.name, t]));
    const resolve = (name) => teamByName.get(TEAM_ALIASES[name] ?? name) ?? null;

    const upcoming = fixtures.filter(f => !f.finished_provisional && f.event !== null);

    const matches = [];
    const skipped = [];
    for (const row of rows) {
        const home = resolve(row.HomeTeam), away = resolve(row.AwayTeam);
        if (!home || !away) { skipped.push(`${row.HomeTeam} v ${row.AwayTeam} (club name not in FPL)`); continue; }

        const fixture = upcoming.find(f => f.team_h === home.id && f.team_a === away.id);
        if (!fixture) { skipped.push(`${row.HomeTeam} v ${row.AwayTeam} (no upcoming FPL fixture)`); continue; }

        const derived = deriveMatch({
            homeOdds: pickOdds(row, ['AvgH', 'B365H', 'MaxH']),
            drawOdds: pickOdds(row, ['AvgD', 'B365D', 'MaxD']),
            awayOdds: pickOdds(row, ['AvgA', 'B365A', 'MaxA']),
            over25Odds: pickOdds(row, ['Avg>2.5', 'B365>2.5', 'Max>2.5']),
            under25Odds: pickOdds(row, ['Avg<2.5', 'B365<2.5', 'Max<2.5'])
        });
        if (!derived) { skipped.push(`${row.HomeTeam} v ${row.AwayTeam} (prices missing or unusable)`); continue; }

        const r3 = (v) => Math.round(v * 1000) / 1000;
        matches.push({
            fixtureId: fixture.id,
            event: fixture.event,
            kickoff: fixture.kickoff_time,
            homeId: home.id, awayId: away.id,
            home: home.short_name, away: away.short_name,
            homeName: home.name, awayName: away.name,
            lambdaHome: r3(derived.lambdaHome), lambdaAway: r3(derived.lambdaAway),
            csHome: r3(derived.csHome), csAway: r3(derived.csAway),
            winHome: r3(derived.winHome), draw: r3(derived.draw), winAway: r3(derived.winAway),
            over25: r3(derived.over25), under25: r3(derived.under25),
            bttsYes: r3(derived.bttsYes),
            scorelines: derived.scorelines.map(s => ({ h: s.h, a: s.a, p: r3(s.p) })),
            market: { home: r3(derived.market.home), draw: r3(derived.market.draw), away: r3(derived.market.away) },
            overround: r3(derived.overround.match),
            drawError: r3(derived.drawError)
        });
    }

    skipped.forEach(s => console.log(`skipped: ${s}`));
    if (matches.length < MIN_FIXTURES) {
        fail(`only ${matches.length} of ${rows.length} ${DIVISION} fixtures could be priced (need ${MIN_FIXTURES}) — keeping the existing odds`);
    }

    /* A quiet way for this to be wrong is for the reconstruction to stop
       agreeing with the prices it came from — a change in the CSV's column
       meaning, say, or a division renamed. The draw probability is the sensitive
       one, since it is the residual the fit never targets directly. */
    const worstDraw = Math.max(...matches.map(m => m.drawError));
    if (worstDraw > 0.08) {
        fail(`reconstruction disagrees with the market on draws by ${(worstDraw * 100).toFixed(1)}pp — the model or the feed has changed. Keeping the existing odds.`);
    }

    matches.sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)));
    const events = [...new Set(matches.map(m => m.event))].sort((a, b) => a - b);

    /* Whether each round is priced in full.

       Consumers blend these goal expectations into their own projections, and a
       half-priced round is worse than an unpriced one: some teams would carry
       market numbers and the rest would not, so every comparison across that
       line would be measuring the difference between two estimators rather than
       between two footballers. Only this job can see how many fixtures the round
       actually holds, so only this job can answer it. */
    const coverage = events.map(event => {
        const priced = matches.filter(m => m.event === event).length;
        const scheduled = fixtures.filter(f => f.event === event).length;
        return { event, priced, scheduled, complete: priced === scheduled };
    });
    coverage.forEach(c => {
        if (!c.complete) console.log(`GW${c.event}: ${c.priced} of ${c.scheduled} fixtures priced — consumers will not blend this round`);
    });

    const output = {
        metadata: {
            lastUpdated: new Date().toISOString(),
            source: 'football-data.co.uk',
            sourceUrl: FIXTURES_URL,
            division: DIVISION,
            matches: matches.length,
            events,
            coverage,
            worstDrawError: Math.round(worstDraw * 1000) / 1000,
            model: 'independent Poisson fitted to de-vigged 1X2 and over/under 2.5'
        },
        matches
    };

    fs.writeFileSync(outPath, JSON.stringify(output, null, 1) + '\n');
    console.log(`Wrote ${outPath}: ${matches.length} matches across GW${events.join(', GW')}, worst draw error ${(worstDraw * 100).toFixed(1)}pp`);

    /* Record what the site's own model said about the same fixtures.

       Strictly a by-product: it runs after the feed is safely written, it cannot
       fail the job, and nothing on the site reads it. It exists so that in ten
       rounds there is evidence about where the model is biased, instead of an
       argument about it. */
    const calibRows = calibrationSample(output, boot, fixtures);
    if (!calibRows) {
        console.log('No calibration sample this run.');
        return;
    }
    let existingCalib = null;
    try { existingCalib = JSON.parse(fs.readFileSync(calibPath, 'utf8')); } catch (e) { existingCalib = null; }
    const nextCalib = appendRound(existingCalib, output.metadata.lastUpdated, calibRows);
    fs.writeFileSync(calibPath, JSON.stringify(nextCalib, null, 1) + '\n');
    const stats = nextCalib.metadata.overall || summarise(calibRows);
    console.log(`Calibration: ${calibRows.length} samples, ${nextCalib.metadata.rounds} round(s) held.` +
        (stats ? ` mean market/model ${stats.meanRatio} (home ${stats.meanRatioHome}, away ${stats.meanRatioAway}); venue effect vs market ${stats.venueEffectVsMarket}x` : ''));
}

main().catch(err => fail(`odds fetch threw: ${err.message}`));
