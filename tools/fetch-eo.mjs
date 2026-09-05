#!/usr/bin/env node
/* Effective ownership, by rank tier.

   Ownership answers "is he popular". It is the number the game publishes and
   the number this site has always used. It is also the wrong number, because a
   fantasy season is scored on rank rather than on points, and rank moves on the
   difference between your squad and everyone else's.

   Effective ownership is that difference. A player owned by 60% of the top 10k
   and captained by 30% of them has an EO of 90: not owning him costs you ground
   even in a week he does nothing, and owning him is worth almost nothing when
   he hauls, because almost everyone else hauled too. It is the number that
   turns "who scores most" into "what protects or attacks my position".

   FPL does not publish it and never will — publishing what the top 10k own
   would move the market it describes. So it has to be sampled.

   METHOD. Each manager's picks carry a `multiplier` per player: 0 on the bench,
   1 starting, 2 captained, 3 under a Triple Captain. Effective ownership over a
   sample is simply the mean of those multipliers, expressed as a percentage —
   which handles Bench Boost and Triple Captain correctly without special cases,
   because both are already expressed in the multiplier.

   Managers are drawn from the overall league (id 314), which is ranked, by
   walking evenly spaced pages and taking the first entries from each. Even
   spacing rather than random sampling so a re-run reproduces, and so a tier is
   never represented by one contiguous block of near-identical squads.

   Writes data/eo.json. On any failure it leaves the existing file alone and
   exits non-zero: a stale EO table is a small problem, an EO table built from
   forty managers and presented as the top 10k is a much larger one.

   Usage: node tools/fetch-eo.mjs [--out data/eo.json] [--event N]
                                  [--sample N] [--concurrency N] */
import fs from 'node:fs';

const API = 'https://fantasy.premierleague.com/api';
const OVERALL_LEAGUE = 314;
const PAGE_SIZE = 50;
const UA = 'easyfpl-eo-bot (+https://easyfpl.com)';

/* The tiers worth distinguishing. Top 1k is where the game is played at the
   sharp end and where template pressure is strongest; top 10k is the band most
   engaged managers are actually chasing. Beyond that EO converges on plain
   ownership, which the bootstrap already gives us for nothing. */
const TIERS = [
    { id: 'top1k', label: 'Top 1k', rankTo: 1000, pages: 20 },
    { id: 'top10k', label: 'Top 10k', rankTo: 10000, pages: 200 },
    /* The band most people are actually somewhere inside. Wide enough that
       effective ownership starts converging on plain ownership, which is
       exactly why it is worth showing next to the sharper tiers: the gap
       between what the top 1k own and what the top 100k own is the shape of
       the template forming. */
    { id: 'top100k', label: 'Top 100k', rankTo: 100000, pages: 2000 }
];

// Below this a tier is not published at all rather than published thin.
const MIN_SAMPLE_RATIO = 0.6;

function fail(message) {
    console.error(`::error::${message}`);
    process.exit(1);
}

const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : fallback;
};

async function getJSON(path, attempts = 3) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            const res = await fetch(`${API}${path}`, {
                headers: { 'User-Agent': UA },
                signal: AbortSignal.timeout(20000)
            });
            if (res.status === 429) throw new Error('rate limited');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (err) {
            lastErr = err;
            // Back off hard on a rate limit; the whole job is one client and
            // being impatient here is how it stops working for everyone.
            await new Promise(r => setTimeout(r, 800 * Math.pow(2, i)));
        }
    }
    throw lastErr;
}

/* Entry ids spread across a tier.

   Evenly spaced pages, first `perPage` entries from each. Walking the first N
   pages contiguously would sample only the very top of a tier, where squads are
   most alike, and report that as the whole band. */
async function sampleEntries(tier, sampleSize) {
    const perPage = Math.max(1, Math.min(PAGE_SIZE, Math.ceil(sampleSize / Math.min(tier.pages, sampleSize))));
    const pagesNeeded = Math.min(tier.pages, Math.ceil(sampleSize / perPage));
    const step = Math.max(1, Math.floor(tier.pages / pagesNeeded));

    const ids = [];
    for (let i = 0; i < pagesNeeded && ids.length < sampleSize; i++) {
        const page = 1 + i * step;
        let data;
        try {
            data = await getJSON(`/leagues-classic/${OVERALL_LEAGUE}/standings/?page_standings=${page}`);
        } catch (err) {
            console.log(`page ${page} unavailable (${err.message}) — continuing`);
            continue;
        }
        const results = (data.standings && data.standings.results) || [];
        if (!results.length) break;                       // ran off the end of the league
        for (const r of results.slice(0, perPage)) {
            if (r.rank <= tier.rankTo) ids.push(r.entry);
            if (ids.length >= sampleSize) break;
        }
    }
    return ids;
}

// A small pool rather than one-at-a-time: the whole job is a few hundred
// requests and serialising them takes long enough that the workflow times out.
async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0, failures = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            try { out[i] = await fn(items[i]); } catch { out[i] = null; failures++; }
        }
    }));
    return { out: out.filter(Boolean), failures };
}

async function tierEO(tier, event, sampleSize, concurrency) {
    const ids = await sampleEntries(tier, sampleSize);
    if (!ids.length) throw new Error(`no managers found for ${tier.label}`);

    const { out: squads, failures } = await mapLimit(ids, concurrency, async (id) => {
        const picks = await getJSON(`/entry/${id}/event/${event}/picks/`);
        return (picks && picks.picks) || null;
    });

    if (squads.length < ids.length * MIN_SAMPLE_RATIO) {
        throw new Error(`${tier.label}: only ${squads.length} of ${ids.length} squads fetched (${failures} failures)`);
    }

    /* Effective ownership is the mean multiplier. Ownership is counted
       separately because the two answer different questions — "how many people
       hold him" against "how much does he move the field" — and a card that
       shows both is the one that explains why a 60%-owned player can carry 90%
       of the risk. */
    const mult = new Map(), owned = new Map(), capt = new Map();
    for (const picks of squads) {
        for (const p of picks) {
            mult.set(p.element, (mult.get(p.element) || 0) + p.multiplier);
            owned.set(p.element, (owned.get(p.element) || 0) + 1);
            if (p.is_captain) capt.set(p.element, (capt.get(p.element) || 0) + 1);
        }
    }

    const n = squads.length;
    const r1 = v => Math.round(v * 10) / 10;
    const players = {};
    for (const [id, total] of mult) {
        players[id] = {
            eo: r1((total / n) * 100),
            own: r1(((owned.get(id) || 0) / n) * 100),
            cap: r1(((capt.get(id) || 0) / n) * 100)
        };
    }
    return { players, sampled: n, requested: ids.length };
}

async function main() {
    const outPath = arg('--out', 'data/eo.json');
    const sampleSize = parseInt(arg('--sample', '400'), 10);
    const concurrency = parseInt(arg('--concurrency', '4'), 10);

    let event = parseInt(arg('--event', ''), 10);
    if (!Number.isInteger(event)) {
        // The gameweek people are actually in. Picks exist for it once the
        // deadline has passed, which is exactly when EO becomes meaningful.
        const boot = JSON.parse(fs.readFileSync('data/bootstrap-static.json', 'utf8'));
        const current = boot.events.find(e => e.is_current);
        if (!current) fail('no current gameweek in bootstrap — nothing to sample');
        event = current.id;
    }

    console.log(`Sampling GW${event}, ${sampleSize} managers per tier, concurrency ${concurrency}`);

    const tiers = [], byPlayer = {};
    for (const tier of TIERS) {
        let result;
        try {
            result = await tierEO(tier, event, sampleSize, concurrency);
        } catch (err) {
            fail(`${tier.label} failed: ${err.message} — keeping the existing table`);
        }
        tiers.push({ id: tier.id, label: tier.label, rankTo: tier.rankTo, sampled: result.sampled });
        for (const [id, v] of Object.entries(result.players)) {
            (byPlayer[id] = byPlayer[id] || {})[tier.id] = v;
        }
        console.log(`${tier.label}: ${result.sampled} of ${result.requested} squads`);
    }

    /* Anyone at effectively zero is dropped. Six hundred players carrying three
       numbers each ships to every browser that opens the page, and a player at
       0.0% in both tiers tells a manager nothing he did not already assume. */
    const players = {};
    for (const [id, v] of Object.entries(byPlayer)) {
        if (TIERS.some(t => v[t.id] && v[t.id].eo >= 0.2)) players[id] = v;
    }

    const output = {
        metadata: {
            lastUpdated: new Date().toISOString(),
            event,
            source: `fantasy.premierleague.com league ${OVERALL_LEAGUE}`,
            method: 'mean pick multiplier over an evenly spaced sample of each tier',
            tiers,
            players: Object.keys(players).length
        },
        players
    };

    fs.writeFileSync(outPath, JSON.stringify(output) + '\n');
    const top = Object.entries(players)
        .sort((a, b) => (b[1].top10k?.eo || 0) - (a[1].top10k?.eo || 0)).slice(0, 5);
    console.log(`Wrote ${outPath}: ${Object.keys(players).length} players across ${tiers.length} tiers`);
    console.log('Highest EO in the top 10k: ' + top.map(([id, v]) => `${id} ${v.top10k?.eo}%`).join(', '));
}

main().catch(err => fail(`EO sampling threw: ${err.message}`));
