/* EasyFPL push Worker.

   Stores subscriptions and sends the alerts. Deliberately the smallest thing
   that can do that: no framework, no database, one KV namespace.

   WHY THE CHECKS ARE NOT THE ONES ON THE DASHBOARD. scripts/readiness.js runs
   nine checks, and most of them need the projection engine — expected minutes,
   fixture difficulty, the recommender. Porting that here would mean running the
   xP model server-side for every subscriber every hour, which is a great deal
   of machinery for a notification.

   So this sends only what can be decided from the two feeds it already has to
   fetch: a flag on a player you are starting, and a deadline with something
   still outstanding. Those are the two triggers worth starting with anyway —
   they are the ones a manager would be glad to be interrupted for. Anything
   needing a projection stays on the page, where the projection already is.

   Routes, all under /api/push:
     GET  /key          the VAPID public key, so the page can subscribe
     POST /subscribe    { subscription, teamId, prefs }
     POST /unsubscribe  { endpoint }
     POST /resubscribe  { old, subscription }   from pushsubscriptionchange
     POST /test         { endpoint }            send one, for verifying a deploy

   The scheduled handler runs hourly and is where everything is actually sent. */

import { sendPush } from './webpush.js';

const FPL = 'https://fantasy.premierleague.com/api';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

// KV key for a subscription. The endpoint is the identity of a subscription
// and is already unique per browser install, so it is the natural key — but it
// is a URL, so it is hashed to keep KV keys short and opaque.
async function keyFor(endpoint) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
    return 'sub:' + [...new Uint8Array(digest)].slice(0, 16)
        .map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleSubscribe(request, env) {
    const { subscription, teamId, prefs } = await request.json();
    if (!subscription || !subscription.endpoint || !subscription.keys) {
        return json({ error: 'a subscription with keys is required' }, 400);
    }
    const record = {
        subscription,
        teamId: teamId ? String(teamId).replace(/\D/g, '').slice(0, 12) : null,
        prefs: prefs || {},
        created: Date.now(),
        // What has already been said, so the same news is never sent twice.
        sent: {}
    };
    await env.PUSH_SUBS.put(await keyFor(subscription.endpoint), JSON.stringify(record));
    return json({ ok: true });
}

async function handleUnsubscribe(request, env) {
    const { endpoint } = await request.json();
    if (!endpoint) return json({ error: 'endpoint required' }, 400);
    await env.PUSH_SUBS.delete(await keyFor(endpoint));
    return json({ ok: true });
}

async function handleResubscribe(request, env) {
    const { old, subscription } = await request.json();
    if (!subscription || !subscription.endpoint) return json({ error: 'subscription required' }, 400);
    // Carry the team and preferences across so a rotated endpoint does not
    // quietly become a subscription that knows nothing about its owner.
    let record = { subscription, teamId: null, prefs: {}, created: Date.now(), sent: {} };
    if (old) {
        const prevKey = await keyFor(old);
        const prev = await env.PUSH_SUBS.get(prevKey, 'json');
        if (prev) { record = { ...prev, subscription }; await env.PUSH_SUBS.delete(prevKey); }
    }
    await env.PUSH_SUBS.put(await keyFor(subscription.endpoint), JSON.stringify(record));
    return json({ ok: true });
}

const vapidFrom = (env) => ({
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT || 'mailto:hello@easyfpl.com'
});

/* One notification, unless this subscriber has already had it.

   `tag` is both the collapse key in the browser and the de-duplication key
   here: "GW4 deadline" is sent once, not once an hour for the two hours it is
   true for. */
async function sendOnce(env, key, record, tag, payload) {
    if (record.sent && record.sent[tag]) return false;
    const result = await sendPush(record.subscription, { ...payload, tag }, vapidFrom(env));
    if (result.gone) { await env.PUSH_SUBS.delete(key); return false; }
    if (result.status >= 200 && result.status < 300) {
        record.sent = record.sent || {};
        record.sent[tag] = Date.now();
        // Anything older than a fortnight is about a gameweek nobody is
        // thinking about any more.
        const cutoff = Date.now() - 14 * 86400000;
        for (const k of Object.keys(record.sent)) if (record.sent[k] < cutoff) delete record.sent[k];
        await env.PUSH_SUBS.put(key, JSON.stringify(record));
        return true;
    }
    return false;
}

async function fetchJSON(url) {
    const res = await fetch(url, { headers: { 'User-Agent': 'easyfpl-push (+https://easyfpl.com)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
}

/* The hourly pass.

   Bootstrap is fetched once for everybody, because it is the same for
   everybody. Squads are fetched per subscriber and only when there is
   something that could be said — no point pulling fifteen players to discover
   the deadline is four days away. */
async function runSchedule(env) {
    const boot = await fetchJSON(`${FPL}/bootstrap-static/`);
    const next = boot.events.find(e => e.is_next);
    const current = boot.events.find(e => e.is_current);
    const deadline = next ? new Date(next.deadline_time).getTime() : null;
    const hoursLeft = deadline ? (deadline - Date.now()) / 3600000 : null;

    // Two hours, give or take the hour this runs on.
    const deadlineSoon = hoursLeft != null && hoursLeft > 0 && hoursLeft <= 2.5;
    const flagged = new Map();
    boot.elements.forEach(p => {
        if (p.status !== 'a') flagged.set(p.id, { name: p.web_name, status: p.status, news: p.news });
    });

    let cursor, scanned = 0, sent = 0;
    do {
        const page = await env.PUSH_SUBS.list({ prefix: 'sub:', cursor });
        for (const entry of page.keys) {
            const record = await env.PUSH_SUBS.get(entry.name, 'json');
            if (!record || !record.subscription) continue;
            scanned++;
            const prefs = record.prefs || {};

            /* News on a player you are starting. Needs the squad, so it is only
               fetched for subscribers who asked for this and have told us who
               they are. */
            if (prefs['squad-news'] && record.teamId && current) {
                try {
                    const picks = await fetchJSON(`${FPL}/entry/${record.teamId}/event/${current.id}/picks/`);
                    const starters = (picks.picks || []).filter(p => p.multiplier > 0);
                    const hits = starters.map(p => flagged.get(p.element)).filter(Boolean);
                    if (hits.length) {
                        const first = hits[0];
                        const body = hits.length === 1
                            ? `${first.name}: ${first.news || 'now carrying a fitness flag'}`
                            : `${first.name} and ${hits.length - 1} other${hits.length > 2 ? 's' : ''} in your XI are flagged`;
                        // Tagged by gameweek and by who, so a new injury sends
                        // and the same one does not send again every hour.
                        const tag = `news-${current.id}-${hits.map(h => h.name).sort().join('-')}`;
                        if (await sendOnce(env, entry.name, record, tag, {
                            title: 'News on your squad', body, url: '/index.html'
                        })) sent++;
                    }
                } catch { /* one bad squad must not stop the pass */ }
            }

            // The deadline nudge, sent once per gameweek.
            if (prefs.deadline && deadlineSoon && next) {
                if (await sendOnce(env, entry.name, record, `deadline-${next.id}`, {
                    title: `GW${next.id} deadline in ${Math.max(1, Math.round(hoursLeft))}h`,
                    body: 'Last check on your lineup, captain and transfers.',
                    url: '/index.html'
                })) sent++;
            }
        }
        cursor = page.list_complete ? null : page.cursor;
    } while (cursor);

    return { scanned, sent };
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname.replace(/^\/api\/push/, '') || '/';

        if (request.method === 'GET' && path === '/key') {
            if (!env.VAPID_PUBLIC_KEY) return json({ error: 'push is not configured' }, 503);
            return json({ publicKey: env.VAPID_PUBLIC_KEY });
        }
        if (request.method === 'POST') {
            try {
                if (path === '/subscribe') return await handleSubscribe(request, env);
                if (path === '/unsubscribe') return await handleUnsubscribe(request, env);
                if (path === '/resubscribe') return await handleResubscribe(request, env);

                /* Deliberately present in production. The encryption in
                   webpush.js cannot be verified without a real subscription and
                   a real push service, so there has to be a way to prove it
                   from a live install rather than by hoping. */
                if (path === '/test') {
                    const { endpoint } = await request.json();
                    const record = await env.PUSH_SUBS.get(await keyFor(endpoint), 'json');
                    if (!record) return json({ error: 'not subscribed' }, 404);
                    const result = await sendPush(record.subscription, {
                        title: 'EasyFPL alerts are working',
                        body: 'This is the only test message you will get.',
                        tag: 'test', url: '/index.html'
                    }, vapidFrom(env));
                    return json(result);
                }
            } catch (err) {
                return json({ error: err.message }, 400);
            }
        }
        return json({ error: 'not found' }, 404);
    },

    async scheduled(event, env, ctx) {
        ctx.waitUntil(runSchedule(env).then(
            r => console.log(`push: scanned ${r.scanned}, sent ${r.sent}`),
            e => console.error('push schedule failed:', e.message)
        ));
    }
};
