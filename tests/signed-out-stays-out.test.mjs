/* Logging out has to stay logged out.

   The bug: a manager signed in with an account AND carrying a Team ID pressed
   Log out, watched the landing page appear, and was put straight back into the
   same team. Then again. Then again — with no way to reach a signed-out state
   and sign in as somebody else.

   Two independent faults produced it, and each is pinned separately below.

   1. v2LogOut() forgot the Team ID and nothing else. Its own comment said
      "there is no account and no server-side session", which was true when it
      was written and stopped being true when accounts shipped. The session
      cookie survived every log out.

   2. adoptTeamIdFromAccount() ran on EVERY landing-page load where this
      browser had no Team ID. It exists for a real case — signing in on a
      second device, where the account knows the squad and the browser does not
      — but "no Team ID in this browser" cannot tell that case from "I just
      deliberately cleared it", and it answered both by putting the squad back.

   Either fault alone is survivable. Together they are a closed loop, which is
   why both directions are asserted here: log out must end the session, and
   adoption must happen only on the load that follows a sign-in. The second
   assertion has a mirror — adoption must still be REACHABLE — because a fix
   that simply deleted it would pass a one-sided test and silently break
   signing in on a new device. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadFunction } from './helpers/load.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* v2LogOut with whatever auth surface the page it was pressed on happens to
   have. On a squad page auth.js is not loaded and auSignOut is undefined,
   which is the case that used to leak a live session. */
function runLogOut({ withAuth = true, signOutThrows = false } = {}) {
    const store = new Map([
        ['fpl_team_id', '1234567'],
        ['fpl_team_name_1234567', 'Some XI'],
        ['fpl_league_id', '999'],
        ['fpl_shortlist', '[1,2,3]']
    ]);
    const calls = { signOut: 0, clearSession: 0, closed: 0 };
    const ctx = {
        console,
        localStorage: {
            getItem: k => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: k => store.delete(k)
        },
        location: { href: '', protocol: 'https:' },
        closeSettingsModal() { calls.closed++; }
    };
    if (withAuth) {
        ctx.auSignOut = async () => {
            calls.signOut++;
            if (signOutThrows) throw new Error('offline');
            return { ok: true };
        };
        ctx.auClearSession = () => { calls.clearSession++; };
    }

    const src = read('scripts/common.js');
    const start = src.search(/\n\s*async function v2LogOut\s*\(/);
    assert.ok(start > 0, 'v2LogOut is no longer an async function declaration');
    let i = src.indexOf('{', start), depth = 0, end = i;
    for (; end < src.length; end++) {
        if (src[end] === '{') depth++;
        else if (src[end] === '}' && --depth === 0) break;
    }
    const sandbox = vm.createContext(ctx);
    new vm.Script(`${src.slice(start, end + 1)}\n;globalThis.__run = v2LogOut;`).runInContext(sandbox);
    return sandbox.__run().then(() => ({ store, calls, location: ctx.location }));
}

test('logging out forgets the team and ends the account session', async () => {
    const { store, calls } = await runLogOut();
    assert.equal(store.get('fpl_team_id'), undefined, 'the Team ID is gone');
    assert.equal(store.get('fpl_team_name_1234567'), undefined, 'and its cached name');
    assert.equal(store.get('fpl_league_id'), undefined, 'and the league it was viewing');
    assert.equal(calls.signOut, 1, 'and the account session was ended, which is the whole fix');
});

test('logging out leaves this browser its own preferences', () => {
    // The shortlist is this browser's, not that team's. Forgetting a squad is
    // not the same as wiping the machine.
    return runLogOut().then(({ store }) => {
        assert.equal(store.get('fpl_shortlist'), '[1,2,3]');
    });
});

test('a sign-out request that fails still signs you out here', async () => {
    /* auPost() calls fetch(), which rejects rather than returning a bad status,
       so an offline log out used to leave the cookie in place. Someone who
       asked to be signed out on a shared machine has to be signed out on it
       whatever the network did. */
    const { store, calls } = await runLogOut({ signOutThrows: true });
    assert.equal(store.get('fpl_team_id'), undefined, 'the team goes regardless');
    assert.equal(calls.clearSession, 1, 'and the session is cleared by hand');
});

test('a page without auth.js hands the sign-out to one that has it', async () => {
    /* auth.js is on four pages; the settings modal is on all of them. Rather
       than keep a second copy of the cookie names in common.js — two
       definitions of one thing, and it is always the copy that rots — the
       landing page is asked to finish. If this ever stops carrying the flag,
       pressing Log out on a squad page silently keeps you signed in. */
    const { location } = await runLogOut({ withAuth: false });
    assert.equal(location.href, 'index.html?signout=1');
});

/* index.html's 131KB inline block is scripts/index-page.js now — it was the
   bulk of a render-blocking document. These assertions are about that code,
   so they read it where it lives. */
test('the landing page acts on that hand-off', () => {
    const html = read('scripts/index-page.js');
    assert.ok(/signout'\) === '1'/.test(html), 'the page script reads the flag');
    const region = html.slice(html.indexOf("signout') === '1'"));
    assert.ok(region.slice(0, 400).includes('auSignOut('),
        'and actually signs out rather than only tidying the address bar');
});

test('adopting the account team cannot happen without a sign-in', () => {
    /* The loop's other half. Asserted against the source because the guard is
       a plain block on the landing page's script, and what matters is not
       what it computes but that nothing reaches the call without passing it. */
    const html = read('scripts/index-page.js');
    const calls = html.split('adoptTeamIdFromAccount(').length - 1;
    assert.equal(calls, 1, 'one call site; a second would need its own guard');

    const mark = html.indexOf('justSignedIn');
    const call = html.indexOf('adoptTeamIdFromAccount(');
    assert.ok(mark > 0 && mark < call, 'the mark is read before the call');
    assert.ok(html.slice(mark, call).includes('if (!justSignedIn) return;'),
        'and nothing gets past it unmarked');
});

test('signing in still sets the mark, so a new device still finds the squad', () => {
    /* The mirror of the test above. Deleting the adoption entirely would pass
       that one and quietly break the feature it exists for. */
    const login = read('login.html');
    assert.ok(login.includes("sessionStorage.setItem('easyfpl_signed_in', '1')"),
        'login.html marks the sign-in');
    const set = login.indexOf("sessionStorage.setItem('easyfpl_signed_in'");
    const go = login.indexOf('location.replace(auNext', set);
    assert.ok(go > set, 'before it leaves for the dashboard, not after');
});

test('the mark is read once and then gone', () => {
    const html = read('scripts/index-page.js');
    assert.ok(html.includes("sessionStorage.removeItem('easyfpl_signed_in')"),
        'a mark that survives is the every-load behaviour again, one step removed');
});

test('adoption still refuses to overwrite a team this browser already has', () => {
    // Unchanged by the fix, and worth keeping honest: an id typed here is the
    // more recent intention.
    const adopt = loadFunction('scripts/common.js', 'adoptTeamIdFromAccount', {
        localStorage: { getItem: () => '7654321', setItem() {}, removeItem() {} },
        getSavedTeamId: () => '7654321',
        auFetchProfile: async () => ({ fpl_team_id: '1111111' })
    });
    return adopt().then(id => assert.equal(id, null));
});
