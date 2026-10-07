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
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
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

/* Not every empty answer is a fault.

   fixtures.csv carries roughly the next two days, so for most of the week it
   holds no Premier League rows at all: bookmakers price one round at a time and
   the file only surfaces that round a day or two out. Treating it as an error
   turned about twenty-three of every twenty-eight scheduled runs red, for the
   ordinary state of a Tuesday — and a red run that means nothing is worse than
   no run at all, because it trains everyone to ignore the ones that do.

   Nothing is written either way. The site already handles a missing round:
   boMarketXGA() in scripts/odds-panel.js returns null unless every fixture in a
   round is priced, so the projection falls back to its own estimate and the
   Matchday tab simply has nothing to show.

   It stops being ordinary when a round goes by unpriced. The odds we are
   holding name the gameweek they cover, so if that gameweek is behind the one
   whose deadline has already passed, we went into a round without pricing it —
   which is a real failure and still goes red. */
/* How close to a deadline "not priced yet" stops being ordinary. The feed
   carries about two days of fixtures, so a round is normally in it well before
   this; still empty inside the window means something about the source has
   changed rather than that we are early. Chosen so at least one scheduled run
   (03/09/15/21 UTC) always lands inside it, whatever the deadline. */
const PRICING_GRACE_MS = 12 * 60 * 60 * 1000;

/* WHAT THIS RUN PRICED, ON TOP OF WHAT IS ALREADY HELD.
 *
 * This file used to be replaced outright every run, and that is why a round was
 * never once fully priced. The source carries about two days of fixtures, a
 * Premier League round runs Friday to Monday, so no single run can see all ten
 * games. Each successful run therefore threw away the fixtures the last one had
 * found: on 19 September it wrote five of ten, and five of ten is what the site
 * still had three weeks later. coverage.complete could not become true, and
 * boMarketXGA() — which refuses to blend unless a round is complete — had
 * almost certainly never returned a number in its life.
 *
 * Merged by fixtureId, with this run winning. A fixture priced again closer to
 * kick-off is better information than the same fixture priced three days out,
 * and the later run is the one holding it.
 *
 * ANYTHING ALREADY KICKED OFF IS DROPPED, and that is not housekeeping. Without
 * it the file grows without bound and, worse, keeps serving prices for games
 * that have been played — which is exactly what was on screen for the whole of
 * the September break. A price is a forecast; once the match has started it is
 * not one.
 *
 * `now` is injected so a test can place itself either side of a kick-off. */
export function mergeHeldOdds(held, fresh, now) {
    const byId = new Map();
    // Held first so that fresh overwrites it, not the other way round.
    for (const m of (held || [])) byId.set(m.fixtureId, m);
    for (const m of (fresh || [])) byId.set(m.fixtureId, m);
    return [...byId.values()]
        .filter(m => {
            const t = Date.parse(m.kickoff);
            return Number.isFinite(t) ? t > now : true;
        })
        .sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)));
}

function notPricedYet(reason, outPath) {
    let held = null, events = [];
    try {
        held = JSON.parse(fs.readFileSync(outPath, 'utf8'))?.metadata?.events?.slice(-1)[0] ?? null;
        events = (JSON.parse(fs.readFileSync('data/bootstrap-static.json', 'utf8')).events || [])
            .filter(e => e && e.id != null && e.deadline_time)
            .sort((a, b) => Date.parse(a.deadline_time) - Date.parse(b.deadline_time));
    } catch {
        /* Nothing held yet, or no bootstrap to judge against. Either way there is
           no round we can show we missed, so this stays a notice. */
    }

    const now = Date.now();
    /* NOT `is_current`. That flag names the round whose deadline passed most
       recently and keeps naming it until the next one locks — so for the whole
       window in which anyone is picking a team it is a round behind, which is
       the trap planningGameweek() in scripts/common.js exists for. Judging the
       odds by it meant the alarm could only fire AFTER a deadline, by which
       point nobody can act on the answer and the round is already lost.

       The round being planned is simply the next one still open. */
    const passed = events.filter(e => Date.parse(e.deadline_time) <= now);
    const locked = passed[passed.length - 1] || null;
    const planning = events.find(e => Date.parse(e.deadline_time) > now) || null;

    // A round locked while we were holding odds for an earlier one. Definite miss.
    if (held != null && locked && held < locked.id) {
        fail(`${reason} — the odds on file are for GW${held} and GW${locked.id} is already locked. A round went unpriced.`);
    }

    /* The round being planned is nearly locked and still has no prices. This is
       the alarm that is worth having: early enough to be acted on, late enough
       that an ordinary unpriced Tuesday never reaches it. */
    if (planning) {
        const until = Date.parse(planning.deadline_time) - now;
        if (until < PRICING_GRACE_MS) {
            fail(`${reason} — GW${planning.id} locks in ${Math.max(0, Math.round(until / 3600000))}h and still has no prices`);
        }
    }

    /* NOTHING NEW TO FETCH IS NOT A REASON TO KEEP SERVING PLAYED GAMES.
     *
     * This path used to exit without touching the file, which is how the site
     * spent the whole September break showing bookmakers' prices for five GW5
     * fixtures that had already been played. A price is a forecast; the moment
     * the match kicks off it stops being one, and that is true whether or not
     * there is anything to replace it with.
     *
     * So the held set is pruned here too. Between rounds the file empties
     * itself, which reads correctly downstream — boTeamView() returns null, the
     * market block does not render, and the card says the bookmakers have not
     * priced this fixture rather than quoting them on a finished one.
     *
     * Only ever writes when something actually went, so an ordinary unpriced
     * Tuesday still makes no commit. */
    try {
        const file = JSON.parse(fs.readFileSync(outPath, 'utf8'));
        const before = (file.matches || []).length;
        const kept = mergeHeldOdds(file.matches, [], now);
        if (kept.length !== before) {
            const events2 = [...new Set(kept.map(m => m.event))].sort((a, b) => a - b);
            file.matches = kept;
            file.metadata = Object.assign({}, file.metadata, {
                lastUpdated: new Date().toISOString(),
                matches: kept.length,
                events: events2,
                coverage: (file.metadata?.coverage || []).filter(c => events2.includes(c.event))
            });
            fs.writeFileSync(outPath, JSON.stringify(file, null, 1) + '\n');
            console.log(`Pruned ${before - kept.length} fixture(s) already kicked off; ${kept.length} still ahead.`);
        }
    } catch {
        /* No readable file to prune. Nothing held means nothing stale. */
    }

    console.log(`::notice::${reason}. Nothing new to fetch — bookmakers price one round at a time, so between rounds there is nothing to add.`);
    process.exit(0);
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
    if (!rows.length) notPricedYet(`no ${DIVISION} fixtures in fixtures.csv yet`, outPath);

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

    /* THE FLOOR IS GONE, and removing it is half the fix.
     *
     * It used to refuse to write unless this one run priced five fixtures,
     * reasoning that "a partial round is no use anyway — the projection only
     * blends the market when every fixture in the round is priced". The second
     * half of that is true and is still enforced, by coverage.complete and by
     * boMarketXGA() reading it. The first half was the trap: a round only ever
     * becomes complete by accumulating the partials, so a floor on each run's
     * own catch guaranteed the thing it was waiting for could never happen.
     *
     * It is also no longer needed as a guard. Writing cannot lose information
     * now — the merge keeps everything still in the future — so the only reason
     * left to refuse is having nothing whatsoever to contribute. */
    if (!matches.length) {
        notPricedYet(`none of the ${rows.length} ${DIVISION} rows could be priced`, outPath);
    }

    /* A quiet way for this to be wrong is for the reconstruction to stop
       agreeing with the prices it came from — a change in the CSV's column
       meaning, say, or a division renamed. The draw probability is the sensitive
       one, since it is the residual the fit never targets directly. */
    const worstDraw = Math.max(...matches.map(m => m.drawError));
    if (worstDraw > 0.08) {
        fail(`reconstruction disagrees with the market on draws by ${(worstDraw * 100).toFixed(1)}pp — the model or the feed has changed. Keeping the existing odds.`);
    }

    /* Everything still ahead of us: what was held, with this run written over
       it. See mergeHeldOdds — `matches` is this run alone and is what the
       validation above judged, `priced` is what the file will carry. */
    let held = [];
    try { held = JSON.parse(fs.readFileSync(outPath, 'utf8')).matches || []; } catch { held = []; }

    // One clock for the whole decision, so nothing straddles a kick-off.
    const now = Date.now();
    const priced = mergeHeldOdds(held, matches, now);
    const stillAhead = (m) => {
        const t = Date.parse(m.kickoff);
        return Number.isFinite(t) ? t > now : true;
    };
    const keptFromHeld = held.filter(stillAhead).length;
    const dropped = held.length - keptFromHeld;
    if (dropped) console.log(`dropped ${dropped} fixture(s) already kicked off`);
    if (priced.length > keptFromHeld) console.log(`added ${priced.length - keptFromHeld} fixture(s) not previously priced`);

    const events = [...new Set(priced.map(m => m.event))].sort((a, b) => a - b);

    /* Whether each round is priced in full.

       Consumers blend these goal expectations into their own projections, and a
       half-priced round is worse than an unpriced one: some teams would carry
       market numbers and the rest would not, so every comparison across that
       line would be measuring the difference between two estimators rather than
       between two footballers. Only this job can see how many fixtures the round
       actually holds, so only this job can answer it. */
    const coverage = events.map(event => {
        const n = priced.filter(m => m.event === event).length;
        const scheduled = fixtures.filter(f => f.event === event).length;
        return { event, priced: n, scheduled, complete: n === scheduled };
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
            matches: priced.length,
            events,
            coverage,
            /* Over everything the file holds, not just this run: it describes
               the contents rather than the fetch. The gate that can fail the job
               still judges this run's own prices — see worstDraw above. */
            worstDrawError: Math.round(Math.max(...priced.map(m => m.drawError)) * 1000) / 1000,
            model: 'independent Poisson fitted to de-vigged 1X2 and over/under 2.5'
        },
        matches: priced
    };

    fs.writeFileSync(outPath, JSON.stringify(output, null, 1) + '\n');
    console.log(`Wrote ${outPath}: ${priced.length} matches across GW${events.join(', GW')} (${matches.length} priced this run), worst draw error ${(worstDraw * 100).toFixed(1)}pp`);
    coverage.filter(c => c.complete).forEach(c => console.log(`GW${c.event} is now priced in full — consumers will blend it`));

    /* Record what the site's own model said about the same fixtures.

       Strictly a by-product: it runs after the feed is safely written, it cannot
       fail the job, and nothing on the site reads it. It exists so that in ten
       rounds there is evidence about where the model is biased, instead of an
       argument about it. */
    /* This run's prices, not the merged file. appendRound keys on
       rows[0].event and replaces that single round, so handing it a file
       spanning two gameweeks would quietly drop one of them. Calibration is a
       by-product that nothing on the site reads; it should keep measuring
       exactly what it measured before the merge existed. */
    const calibRows = calibrationSample({ metadata: output.metadata, matches }, boot, fixtures);
    if (!calibRows) {
        console.log('No calibration sample this run.');
        return;
    }
    let existingCalib = null;
    try { existingCalib = JSON.parse(fs.readFileSync(calibPath, 'utf8')); } catch { existingCalib = null; }
    const nextCalib = appendRound(existingCalib, output.metadata.lastUpdated, calibRows);
    fs.writeFileSync(calibPath, JSON.stringify(nextCalib, null, 1) + '\n');
    const stats = nextCalib.metadata.overall || summarise(calibRows);
    console.log(`Calibration: ${calibRows.length} samples, ${nextCalib.metadata.rounds} round(s) held.` +
        (stats ? ` mean market/model ${stats.meanRatio} (home ${stats.meanRatioHome}, away ${stats.meanRatioAway}); venue effect vs market ${stats.venueEffectVsMarket}x` : ''));
}

/* Only when this file is what was run.
 *
 * mergeHeldOdds is imported by tests/odds-merge.test.mjs, and an unguarded
 * main() would mean importing it fetches the live source and rewrites
 * data/odds.json — a test suite with a side effect on production data and a
 * network dependency. Same guard tools/check-service-worker.mjs uses. */
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('fetch-odds.mjs');
if (invokedDirectly) main().catch(err => fail(`odds fetch threw: ${err.message}`));
