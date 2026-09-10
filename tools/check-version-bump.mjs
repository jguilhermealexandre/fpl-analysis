#!/usr/bin/env node
/* Fails when a cache-busted asset changed but the version did not.
 *
 * check-versions.mjs already proves every ?v= in the markup agrees with
 * asset-version.json. That is a different question from the one that
 * actually bites: the version can be perfectly consistent and still be
 * the same number it was on the last deploy, in which case the browser
 * — and Cloudflare's edge — keep serving the bytes they already have
 * and none of the work ships.
 *
 * It happened: three commits went out under ?v=194 because only the
 * first of them bumped it. The code was right, the gate was green, and
 * three separate fixes were invisible on the live site.
 *
 * The rule is simply: if any file whose URL carries ?v= differs from
 * how it stood when the version was last changed, the version owes
 * another bump. Data files are not versioned assets and are ignored,
 * which is what keeps the hourly data-refresh commits from tripping it.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

/* Everything served with a ?v= buster: the pages themselves, and the
   scripts and stylesheets they reference that way. */
const VERSIONED = /^(scripts\/.+\.js|styles\/.+\.css|[^/]+\.html)$/;

let bumpCommit;
try {
    bumpCommit = git('log', '-1', '--format=%H', '--', 'asset-version.json');
} catch {
    console.log('… not a git checkout; nothing to compare against');
    process.exit(0);
}
if (!bumpCommit) {
    /* A shallow clone can hold the file without holding the commit that
       last changed it, and answering "nothing changed" there would be a
       silent pass on exactly the check this exists to make. */
    let shallow = false;
    try { shallow = git('rev-parse', '--is-shallow-repository') === 'true'; } catch { /* old git */ }
    if (shallow) {
        console.error('✗ shallow checkout: cannot see when asset-version.json last changed.');
        console.error('  Check out with full history (actions/checkout: fetch-depth: 0).');
        process.exit(1);
    }
    console.log('… asset-version.json has no history yet; nothing to compare against');
    process.exit(0);
}

/* A bump already sitting in the working tree, uncommitted, settles it:
   the number in everyone's cache is about to change, which is the whole
   requirement. Without this the check could only be satisfied by
   committing first, which is the wrong order to find out. */
const committedVersion = (() => {
    try { return JSON.parse(git('show', `${bumpCommit}:asset-version.json`)).version; }
    catch { return null; }
})();
const workingVersion = JSON.parse(fs.readFileSync('asset-version.json', 'utf8')).version;
if (committedVersion !== null && workingVersion !== committedVersion) {
    console.log(`✓ version bumped to v${workingVersion} (was v${committedVersion}); assets will be re-fetched`);
    process.exit(0);
}

/* The bump commit itself is the baseline, not the commit before it: the
   files it changed are exactly the ones that bump was for. */
const changed = git('diff', '--name-only', bumpCommit, '--', '.')
    .split('\n')
    .filter(Boolean)
    .filter(f => VERSIONED.test(f) && fs.existsSync(f));

if (changed.length) {
    const version = committedVersion ?? workingVersion;
    const when = git('log', '-1', '--format=%h %s', bumpCommit);
    console.error(`✗ ${changed.length} asset(s) changed since v${version} was set (${when}):\n`);
    for (const f of changed.slice(0, 20)) console.error('    ' + f);
    if (changed.length > 20) console.error(`    … and ${changed.length - 20} more`);
    console.error(`
Browsers already holding these at ?v=${version} will not re-fetch them, so
the change does not reach anyone. Bump "version" in asset-version.json,
then run: npm run stamp`);
    process.exit(1);
}

console.log('✓ no cache-busted asset has changed since the version was last bumped');
