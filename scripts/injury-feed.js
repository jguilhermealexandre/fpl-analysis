/* ============================================
   EasyFPL — injury news, as a feed

   The Premier League publishes a club-by-club injury table and links each club
   to whatever that club last wrote. tools/fetch-pl-injuries.mjs scrapes the
   table into data/injuries.json; this turns those rows into news items.

   It lived inline in fpl-news.html, which was fine while one page showed
   injuries. The dashboard shows them too now, and the alternative to sharing
   was a second copy of the folding and the headline fallback — two
   classifiers that would answer "is this an injury story" differently the
   first time either was touched.

   Pure. No DOM, no fetch, no page state: rows in, items out. The caller owns
   the fetch and the rendering, which is why the news hub can mingle these into
   its own feed and cap them at ten while the dashboard takes the newest few.

   Prefix injury*.
   ============================================ */

/* Dated news first, then the rest.

               Sorting on sortAt alone got this wrong. sortAt falls back to
               firstSeen, which is the moment of the scrape and so newer than any
               real publication date — every undated story climbed above genuine
               news, and in one scrape 27 of them shared a single timestamp and
               came out in arbitrary order. What the club dated leads; what we
               merely saw follows. */
            function injuryOrder(a, b) {
                if (a.timestamp && b.timestamp) return new Date(b.timestamp) - new Date(a.timestamp);
                if (a.timestamp) return -1;
                if (b.timestamp) return 1;
                return new Date(b.sortAt || 0) - new Date(a.sortAt || 0);
            }

/* One story per club, newest first, capped.

               Newcastle had five articles in a single scrape and Brighton five; a
               section of ten that spends half of itself on two clubs is not a
               league-wide injury feed, which is what a reader opening it expects.
               Each club keeps its best: something it actually wrote over a row we
               can only describe from the table, and the newer of those. */
            function injuryFeedFrom(items, cap) {
                const best = new Map();
                [...items]
                    .sort((a, b) => (Number(b.fromClubArticle) - Number(a.fromClubArticle)) || injuryOrder(a, b))
                    .forEach(it => {
                        const key = it.clubId != null ? `id:${it.clubId}` : `name:${it.source || ''}`;
                        if (!best.has(key)) best.set(key, it);
                    });
                return [...best.values()].sort(injuryOrder).slice(0, cap);
            }

/* The injury table is a list of players; the news is the article behind
               them. One club update usually covers several — "Arteta's update on
               White, Mosquera and Timber" is one story about three — so rows are
               folded by the article they point at and become one card each, in the
               same shape every other card on this page uses. Deliberately no
               `player` field: buildFooter and buildTeamTagCard read that as a full
               FPL record and reach for price and ownership, which the injury table
               does not have and this page must not invent.

               Rows with no article behind them are not news and do not appear. They
               are a status table, and this page is a wire feed. */
            function injuryStories(rows, teamsById) {
                const byUrl = new Map();
                for (const r of rows) {
                    if (!r.url || !r.player) continue;
                    /* The scrape reads the club article and says whether it is
                       about who is fit. false is a match report, a confirmed
                       line-up, a press conference — the table links to whatever
                       the club last published, which is often none of our
                       business. null is an article we could not read at all, and
                       that is not a reason to throw the row away: the table's own
                       facts about the player are still true. */
                    if (r.injuryArticle === false) continue;
                    if (!byUrl.has(r.url)) byUrl.set(r.url, []);
                    byUrl.get(r.url).push(r);
                }
                const out = [];
                for (const [url, group] of byUrl) {
                    const first = group[0];
                    const club = first.club || '';
                    const who = group.map(r => r.injury ? `${r.player} (${r.injury})` : r.player).join(', ');
                    /* Two thirds of club sites refuse the fetch, so there is no
                       headline to print. "Aston Villa injury update" was the old
                       fallback and it says nothing — three of them in a row was
                       what made the section look broken. The players and what is
                       wrong with them is the one thing we do know, off the
                       Premier League's own table, so that becomes the headline
                       and the card says where it came from. */
                    const titled = !!first.articleTitle;
                    out.push({
                        category: 'injury',
                        categoryLabel: 'Injury news',
                        fromClubArticle: titled,
                        headline: titled ? first.articleTitle : who,
                        detail: titled
                            ? (club ? `${club} \u00b7 ${who}` : who)
                            : `${club ? club + ' \u00b7 ' : ''}listed on the Premier League's injury table`,
                        link: url,
                        /* The club article's own og:image, collected by the
                           scrape that already fetches the article for its
                           headline and its date. Null when the club published
                           without one, which the card answers with the crest. */
                        thumbnail: first.image || null,
                        source: club,
                        badge: null,
                        isSquad: false,
                        /* Shown only when the club actually published one. Two thirds
                           do not, and first-seen is our own observation rather than
                           the article's date — good enough to order by, not to
                           print as though the club had said it. */
                        timestamp: first.published || null,
                        sortAt: first.published || first.firstSeen || null,
                        matchedTeamIds: first.clubId != null ? [first.clubId] : [],
                        /* The club's own id and crest code. teamsById is the page's
                           team lookup; the crest library is keyed by `code`, not by
                           the id, which is the distinction that had squad news cards
                           drawing a blank rectangle before. */
                        clubId: first.clubId != null ? first.clubId : null,
                        clubCode: (first.clubId != null && teamsById[first.clubId])
                            ? teamsById[first.clubId].code : null,
                        injuredPlayers: group.map(r => r.player),
                        /* Resolved by the scrape, not here: the Worker that sends
                           the push cannot import this page's code, and two copies
                           of a name-matching rule are two rules. */
                        playerIds: group.map(r => r.playerId).filter(id => id != null),
                        sortWeight: 5
                    });
                }
                return out;
            }
