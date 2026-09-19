# The prediction archive

One file per gameweek, `gw{N}.json`, holding what `scripts/xp-engine.js` projected
for that round — written before the deadline and never edited afterwards.

## Why it exists

Projections are computed in the browser at page load, from
`data/bootstrap-static.json`, which a scheduled job overwrites every fifteen
minutes. Nothing is written down anywhere else. So once a round has been played
there is no way to ask what the site predicted: form, prices, availability and
the per-90 rates have all moved on, and re-running the engine today answers a
different question about a different squad.

**This archive cannot be backfilled.** A gameweek with no file here can never be
graded, by anyone, ever. That is the whole reason the job runs hourly and writes
early rather than waiting for one perfectly-timed moment.

## The rules it keeps

- **Written only before the deadline.** Once a deadline passes, that gameweek's
  file is sealed and nothing may rewrite it. A snapshot taken after kick-off is
  not a prediction.
- **Overwritten freely before the deadline.** Several runs land inside the
  window; the last one wins, so what survives is the most informed version of
  the forecast the site actually served.
- **Read from the repo, not the FPL API.** The site serves the committed data
  files, so those are what the reader's prediction was computed from. The live
  API is fresher and would archive a forecast nobody was shown.

## What a row holds, and why

| Field | Why it is here |
|---|---|
| `xp` | The prediction being graded — straight from `projectPlayerPointsForGW` |
| `parts`, `partsTotal` | Component breakdown, so a miss can be traced to minutes, attack or clean sheets rather than just logged |
| `pStart`, `xMins` | The minutes model, which is the largest single source of error in any FPL projection |
| `status`, `chance` | Availability **as it stood at the deadline** — overwritten the moment the next round's news lands, and unrecoverable |
| `ep`, `ppg`, `form` | FPL's own numbers at the deadline. These are the free baselines: "we were 2 points out" means nothing until you know what FPL's own estimate would have scored |
| `sel` | Ownership at the deadline, for effective-ownership work later |
| `fx` | The fixtures that round — `o` opponent, `h` home, `d` difficulty. An empty list is a blank, which is a real prediction of zero |
| `model.assetVersion`, `model.commit` | Which version of the model produced this. Once the engine starts being tuned, a prediction without its model version cannot be interpreted |

## Written by

`tools/snapshot-predictions.mjs`, on the schedule in
`.github/workflows/snapshot-predictions.yml`. The engine is loaded through
`tools/xp-engine-host.mjs`, which hosts the *shipped* script rather than
reimplementing any of it — every number here came out of the same code the site
runs.

## Read by

`tools/grade-predictions.mjs`, which joins each sealed round to the results in
`data/players-data.json` and writes `data/model-accuracy.json`. It only scores a
round FPL has marked finished **and** data-checked, so bonus points and appeals
have settled and the figure cannot move afterwards.

Three of its choices are what make the output worth reading, and all three are
easy to get wrong in the flattering direction:

- **Blanks are excluded.** Predicting zero for a player with no fixture is
  arithmetic, not forecasting.
- **Populations come from the prediction, never the result.** "Starters" means
  the model said he would start — not that he turned out to.
- **Every figure is reported against baselines** (FPL's `ep_next`, season
  average, form). An MAE with nothing beside it says nothing.
