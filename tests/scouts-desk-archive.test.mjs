/* The generators have to run without a browser.

   scripts/build-articles.js requires scripts/scouts-desk.js on its own, in the
   data workflow, with no page around it — so anything the generators reach for
   that lives in common.js is a ReferenceError at build time. That is not
   hypothetical: the emoji sweep replaced one article's icon with a v2Icon()
   call, the article build threw on every run for two days, and because the
   build step comes before the commit step, players-data.json stopped being
   published at all. The data went stale for a reason that had nothing to do
   with the data.

   Nothing caught it. ESLint sees an undeclared global as legitimate here (every
   script on a page shares one scope, so the globals block declares v2Icon), CI
   does not run build-articles.js, and the workflow that does only reports an
   exit code. This is the gate: run the generators the way the builder runs
   them, and let a missing browser global fail on the pull request instead of at
   three in the morning. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sd = require('../scripts/scouts-desk.js');

const read = (name, fallback) => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name), 'utf8')); }
    catch { return fallback; }
};

test('the article generators run with no browser around them', () => {
    // Exactly what scripts/build-articles.js does, against the committed feeds.
    sd.sdSetData(read('bootstrap-static.json', null), read('fixtures.json', []),
        read('players-data.json', { players: [] }));

    let built;
    assert.doesNotThrow(() => { built = sd.sdBuildArchive(); },
        'a generator reached for something only a page defines');

    // Vacuously passing on an empty archive would hide the next one of these, so
    // tie the expectation to there being a played round to write about.
    if (sd.sdLastRound() >= 1) {
        assert.ok(built.length > 0, `GW${sd.sdLastRound()} is played but produced no articles`);
    }

    for (const a of built) {
        assert.equal(typeof a.slug, 'string');
        assert.ok(a.slug.length, 'every article needs a slug — it is the filename');
        assert.equal(typeof a.body, 'string');
        /* icon is written into the feed and through esc() into the static page,
           so markup in it arrives escaped and renders as its own source. The
           renderer picks a mark from the category — see sdArticleMark(). */
        assert.equal(typeof a.icon, 'string');
        assert.ok(!a.icon.includes('<'), `${a.slug}: icon carries markup, which esc() will show verbatim`);
    }
});
