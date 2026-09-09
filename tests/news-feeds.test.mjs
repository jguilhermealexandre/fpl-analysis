/* Reading a picture out of an RSS item.
 *
 * This is the half that has actually been wrong. The news page has been
 * showing coloured placeholders for every Guardian story, not because the
 * articles have no pictures but because the RSS-to-JSON proxy in front of them
 * drops the element the pictures are in. Fetching the XML directly fixes that
 * only if the reader knows where to look, so the fixtures below are the real
 * shapes of the three feeds — including the Guardian's stack of media:content
 * at four widths, which is the case that started all this.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseItem, parseFeed, widestMedia, itemImage } from '../tools/fetch-news-feeds.mjs';

const GUARDIAN = { source: 'The Guardian', badge: 'guardian' };
const BBC = { source: 'BBC Sport', badge: 'bbc' };

/* A Guardian item as it actually arrives: no enclosure, no media:thumbnail,
   a plain-text standfirst, and four media:content at different widths. */
const guardianItem = `<item>
    <title>Arsenal edge past Chelsea in a bad-tempered derby</title>
    <link>https://www.theguardian.com/football/2026/sep/09/arsenal-chelsea</link>
    <description>Mikel Arteta's side ground out a win at the Emirates.</description>
    <pubDate>Tue, 09 Sep 2026 21:30:00 GMT</pubDate>
    <media:content width="140" url="https://i.guim.co.uk/img/media/abc/140.jpg?s=sig140"/>
    <media:content width="460" url="https://i.guim.co.uk/img/media/abc/460.jpg?s=sig460"/>
    <media:content width="1000" url="https://i.guim.co.uk/img/media/abc/1000.jpg?s=sig1000"/>
    <media:content width="620" url="https://i.guim.co.uk/img/media/abc/620.jpg?s=sig620"/>
</item>`;

test('a Guardian item yields its picture, which is the bug this fixes', () => {
    const out = parseItem(guardianItem, GUARDIAN);
    assert.ok(out.image, 'the item has four pictures in it and must not come back with none');
    assert.match(out.image, /^https:\/\/i\.guim\.co\.uk\//);
});

test('the widest media:content wins, so a card is not served a 140px thumbnail', () => {
    assert.equal(widestMedia(guardianItem), 'https://i.guim.co.uk/img/media/abc/1000.jpg?s=sig1000');
});

test('the picture URL is passed through untouched, signature and all', () => {
    /* Guardian URLs carry an HMAC over the query string. "Improving" the width
       on one turns a working image into a 403, so nothing may be rewritten. */
    assert.equal(parseItem(guardianItem, GUARDIAN).image,
        'https://i.guim.co.uk/img/media/abc/1000.jpg?s=sig1000');
});

test('media:thumbnail and enclosure still work for the feeds that use them', () => {
    const bbc = `<item>
        <title>Premier League round-up: the weekend in nine minutes</title>
        <link>https://www.bbc.co.uk/sport/football/123</link>
        <media:thumbnail width="240" url="https://ichef.bbci.co.uk/news/240/x.jpg"/>
    </item>`;
    assert.equal(parseItem(bbc, BBC).image, 'https://ichef.bbci.co.uk/news/240/x.jpg');

    const sky = `<item>
        <title>Transfer window: every deal done on deadline day</title>
        <link>https://www.skysports.com/football/news/1</link>
        <enclosure url="https://e0.365dm.com/26/09/1600x900/skysports.jpg" type="image/jpeg"/>
    </item>`;
    assert.ok(parseItem(sky, { source: 'Sky Sports', badge: 'sky' }).image.includes('365dm.com'));
});

test('a video enclosure is not a picture', () => {
    const item = `<item>
        <title>Watch the goals from Saturday afternoon</title>
        <link>https://x.com/a</link>
        <media:content width="1920" url="https://x.com/clip.mp4" type="video/mp4"/>
        <media:content width="600" url="https://x.com/still.jpg" type="image/jpeg"/>
    </item>`;
    assert.equal(widestMedia(item), 'https://x.com/still.jpg',
        'the video is wider, and it is still not the card image');
});

test('a tracking pixel is skipped in favour of the real picture', () => {
    const item = `<item>
        <title>Something happened at the London Stadium</title>
        <link>https://x.com/a</link>
        <media:content width="1" url="https://x.com/1x1.gif"/>
        <description>&lt;img src="https://x.com/real.jpg"&gt;</description>
    </item>`;
    assert.equal(itemImage(item), 'https://x.com/real.jpg');
});

test('http is upgraded, since the page is served over https', () => {
    const item = `<item><title>A headline long enough to keep</title>
        <link>http://x.com/a</link>
        <enclosure url="http://x.com/p.jpg"/></item>`;
    const out = parseItem(item, BBC);
    assert.equal(out.link, 'https://x.com/a');
    assert.equal(out.image, 'https://x.com/p.jpg');
});

test('a protocol-relative picture is made absolute', () => {
    const item = `<item><title>A headline long enough to keep</title>
        <link>https://x.com/a</link><enclosure url="//cdn/p.jpg"/></item>`;
    assert.equal(parseItem(item, BBC).image, 'https://cdn/p.jpg');
});

test('an item with no title or no link is not an article', () => {
    assert.equal(parseItem('<item><link>https://x.com/a</link></item>', BBC), null);
    assert.equal(parseItem('<item><title>Orphan headline here</title></item>', BBC), null);
    assert.equal(parseItem('<item><title>Bad link</title><link>not-a-url</link></item>', BBC), null);
});

test('entities and CDATA come through as text', () => {
    const item = `<item>
        <title><![CDATA[Spurs &amp; Arsenal draw]]></title>
        <link>https://x.com/a</link>
        <description>It &quot;finished&quot; level</description>
    </item>`;
    const out = parseItem(item, BBC);
    assert.equal(out.title, 'Spurs & Arsenal draw');
    assert.equal(out.summary, 'It "finished" level');
});

test('an unparseable date is dropped rather than written as Invalid Date', () => {
    const item = `<item><title>A headline long enough to keep</title>
        <link>https://x.com/a</link><pubDate>soon</pubDate></item>`;
    assert.equal(parseItem(item, BBC).published, null);
});

test('an Atom feed is read too, where the link is an attribute', () => {
    const atom = `<feed><entry>
        <title>An Atom headline long enough</title>
        <link href="https://x.com/atom-1"/>
        <updated>2026-09-09T21:30:00Z</updated>
    </entry></feed>`;
    const items = parseFeed(atom, BBC);
    assert.equal(items.length, 1);
    assert.equal(items[0].link, 'https://x.com/atom-1');
});

test('the feed label travels with each item', () => {
    const out = parseItem(guardianItem, GUARDIAN);
    assert.equal(out.source, 'The Guardian');
    assert.equal(out.badge, 'guardian', 'the page colours the card from this');
});
