# Push alerts

The Worker behind "Turn on alerts" on the dashboard. It stores subscriptions
and sends two things: a nudge two hours before a deadline, and news on a player
you are starting.

Everything else on this site is static and needs no server. This does, for two
unavoidable reasons: a push message has to be signed with a private key that
cannot go anywhere near a browser, and something has to be awake to send it
when nobody has the page open.

## What is not verified

`src/webpush.js` implements RFC 8291 message encryption and RFC 8292 VAPID
against Web Crypto. It has never been run against a live push service, and its
failure mode is silent — a push service returns `201 Created` for a correctly
formed request whose payload the browser cannot decrypt, and the only symptom
is a notification that never arrives.

**Run the check in step 6 before trusting it.**

## Setup

1. **Generate a VAPID key pair.** Any generator that emits base64url P-256 keys
   works. With Node and no dependencies:

   ```bash
   node -e '
   const { subtle } = require("crypto").webcrypto;
   subtle.generateKey({name:"ECDSA",namedCurve:"P-256"}, true, ["sign","verify"]).then(async k => {
     const pub = Buffer.from(await subtle.exportKey("raw", k.publicKey));
     const jwk = await subtle.exportKey("jwk", k.privateKey);
     console.log("public :", pub.toString("base64url"));
     console.log("private:", jwk.d);
   })'
   ```

   The public key is not secret — it is served at `/api/push/key` and embedded
   in every subscription. The private key is.

2. **Create the KV namespace** and put its id in `wrangler.toml`:

   ```bash
   npx wrangler kv namespace create PUSH_SUBS
   ```

3. **Set the secrets** (these never enter the repo):

   ```bash
   npx wrangler secret put VAPID_PUBLIC_KEY
   npx wrangler secret put VAPID_PRIVATE_KEY
   npx wrangler secret put VAPID_SUBJECT     # mailto:you@example.com
   ```

4. **Deploy:**

   ```bash
   cd workers/push && npx wrangler deploy
   ```

5. **Route `/api/push/*` to it.** In the Cloudflare dashboard, add a Worker
   route for `easyfpl.com/api/push/*`. The client calls a same-origin path on
   purpose: no CORS, and no key material in the page.

6. **Verify end to end.** Open the site, turn alerts on, then:

   ```bash
   # the endpoint is printed by the browser console after subscribing:
   #   navigator.serviceWorker.ready
   #     .then(r => r.pushManager.getSubscription())
   #     .then(s => console.log(s.endpoint))
   curl -X POST https://easyfpl.com/api/push/test \
     -H 'Content-Type: application/json' \
     -d '{"endpoint":"<paste>"}'
   ```

   A `{"status":201}` response with no notification on the device means the
   encryption is wrong, not the plumbing. That is the failure this step exists
   to catch.

## iPhone

The Push API only exists for a home-screen install — there is no push in a
normal Safari tab, on any iOS version. The page detects this and explains it
rather than offering a button that cannot work.

## What it deliberately does not send

The dashboard runs nine readiness checks; most need the projection engine, and
running the xP model server-side per subscriber per hour is a great deal of
machinery for a notification. Only the two triggers that can be decided from
the feeds this Worker already fetches are sent. Anything needing a projection
stays on the page, where the projection already is.

Adding more is the fastest way to lose the channel. Every alert added dilutes
the ones already there.
