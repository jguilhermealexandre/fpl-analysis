/* Premier League news normalisation.
 *
 * The fetch itself cannot be tested here — it is the point of the thing that it
 * runs where a browser cannot. What can be pinned is the half that has actually
 * been getting it wrong: turning whatever a source answers with into one shape,
 * and refusing rows that would render as a broken card.
 *
 * The fixtures are the documented shapes of each endpoint the fetcher tries, so
 * if the Premier League changes one, the parser for it fails here rather than
 * quietly writing an empty list in CI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalise, dedupe } from '../tools/fetch-pl-news.mjs';

test('a Pulselive row becomes one article', () => {
    const out = normalise({
        title: 'Salah scores twice as Liverpool win',
        link: 'https://www.premierleague.com/en/news/4123456',
        summary: '<p>The forward took his tally to nine.</p>',
        image: 'https://resources.premierleague.com/photos/2026/09/09/hero.jpg',
        published: 1757404800000
    });
    assert.equal(out.title, 'Salah scores twice as Liverpool win');
    assert.equal(out.summary, 'The forward took his tally to nine.', 'markup is stripped, not escaped into the text');
    assert.equal(out.source, 'Premier League');
    assert.match(out.published, /^\d{4}-\d{2}-\d{2}T/, 'the date is normalised to ISO whatever came in');
});

test('a relative link is resolved against premierleague.com', () => {
    // The embedded-JSON source yields site-relative hrefs.
    assert.equal(normalise({ title: 'Some headline here', link: '/en/news/4123456' }).link,
        'https://www.premierleague.com/en/news/4123456');
});

test('http is upgraded on both the link and the picture', () => {
    // The page is served over https; a http image is blocked as mixed content.
    const out = normalise({
        title: 'A headline long enough',
        link: 'http://www.premierleague.com/en/news/1',
        image: 'http://resources.premierleague.com/a.jpg'
    });
    assert.equal(out.link, 'https://www.premierleague.com/en/news/1');
    assert.equal(out.image, 'https://resources.premierleague.com/a.jpg');
});

test('a protocol-relative image is made absolute', () => {
    assert.equal(normalise({ title: 'A headline long enough', link: 'https://x.com/a', image: '//cdn/a.jpg' }).image,
        'https://cdn/a.jpg');
});

test('a row with no title or no link is not an article', () => {
    // A headline you cannot click, or a link with nothing to click on.
    assert.equal(normalise({ link: 'https://www.premierleague.com/en/news/1' }), null);
    assert.equal(normalise({ title: 'Orphan headline' }), null);
    assert.equal(normalise(null), null);
});

test('a link that is not a URL is refused rather than rendered', () => {
    assert.equal(normalise({ title: 'A headline long enough', link: 'javascript:alert(1)' }), null);
    assert.equal(normalise({ title: 'A headline long enough', link: 'news/4123456' }), null);
});

test('an unusable image is dropped, and the article still stands', () => {
    const out = normalise({ title: 'A headline long enough', link: 'https://x.com/a', image: 'not-a-url' });
    assert.equal(out.image, null);
    assert.ok(out.title, 'the article survives its picture being unusable');
});

test('an unparseable date is dropped rather than written as Invalid Date', () => {
    assert.equal(normalise({ title: 'A headline long enough', link: 'https://x.com/a', published: 'soon' }).published, null);
});

test('entities and CDATA come through as text', () => {
    const out = normalise({
        title: '<![CDATA[Spurs &amp; Arsenal draw]]>',
        link: 'https://x.com/a',
        summary: 'It &quot;finished&quot; level'
    });
    assert.equal(out.title, 'Spurs & Arsenal draw');
    assert.equal(out.summary, 'It "finished" level');
});

test('the summary is capped so one long body cannot become the card', () => {
    const out = normalise({ title: 'A headline long enough', link: 'https://x.com/a', summary: 'word '.repeat(200) });
    assert.ok(out.summary.length <= 240);
});

test('the same story twice is one story', () => {
    // Two sources can carry the same article, and the list is concatenated.
    const items = dedupe([
        { link: 'https://www.premierleague.com/en/news/1', title: 'A' },
        { link: 'https://www.premierleague.com/en/news/2', title: 'B' },
        { link: 'https://www.premierleague.com/en/news/1', title: 'A again' }
    ]);
    assert.equal(items.length, 2);
    assert.equal(items[0].title, 'A', 'the first one wins, so source order is preserved');
});
