/* Pictures in the news cards.

   The three news views each read `article.thumbnail || article.enclosure.link`
   and each fell back to a coloured placeholder for the two feeds that use
   neither — the BBC and the Guardian put their image in the item body. These
   pin what is now looked at, in what order, and the two rewrites that are
   allowed: https, and the BBC's width. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

const NEWS_THUMB_SKIP = /(?:^|\/)(?:1x1|pixel|spacer|blank|transparent)\.(?:gif|png|jpg)(?:\?|$)/i;
const NEWS_THUMB_IMAGE_URL = /^https?:\/\/[^\s"']+\.(?:jpe?g|png|webp|avif)(?:[?#][^\s"']*)?$/i;
const deps = {
    newsThumbsFromHTML: loadFunction('scripts/common.js', 'newsThumbsFromHTML'),
    newsThumbUpgrade: loadFunction('scripts/common.js', 'newsThumbUpgrade'),
    NEWS_THUMB_SKIP, NEWS_THUMB_IMAGE_URL
};
deps.newsThumbDeepScan = loadFunction('scripts/common.js', 'newsThumbDeepScan', deps);
const newsThumbnail = loadFunction('scripts/common.js', 'newsThumbnail', deps);

test('the media thumbnail wins when the feed supplies one', () => {
    assert.equal(
        newsThumbnail({ thumbnail: 'https://e0.365dm.com/x.jpg', description: '<img src="https://other/y.jpg">' }),
        'https://e0.365dm.com/x.jpg');
});

test('an enclosure is the next best thing', () => {
    assert.equal(
        newsThumbnail({ thumbnail: '', enclosure: { link: 'https://cdn/pl.jpg' } }),
        'https://cdn/pl.jpg');
});

test('the body is read when neither field is filled in', () => {
    // The defect: BBC and Guardian items land here, and used to return null.
    const guardian = {
        thumbnail: '',
        enclosure: {},
        description: '<p><img src="https://i.guim.co.uk/img/media/abc/master/1.jpg?width=140&s=deadbeef" alt=""/>Some copy.</p>'
    };
    assert.equal(newsThumbnail(guardian),
        'https://i.guim.co.uk/img/media/abc/master/1.jpg?width=140&s=deadbeef',
        'and its signed query string is left exactly as it came');
});

test('content is preferred over description when both carry an image', () => {
    assert.equal(newsThumbnail({
        content: '<img src="https://a/big.jpg">',
        description: '<img src="https://a/small.jpg">'
    }), 'https://a/big.jpg');
});

test('http is rewritten to https', () => {
    // Otherwise the browser blocks it as mixed content and the card shows
    // nothing, for a reason nothing on screen explains.
    assert.equal(newsThumbnail({ thumbnail: 'http://img.example/pic.jpg' }), 'https://img.example/pic.jpg');
});

test('a BBC thumbnail is asked for at a size that is not soft on a card', () => {
    assert.equal(
        newsThumbnail({ thumbnail: 'https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/x/y.jpg' }),
        'https://ichef.bbci.co.uk/ace/standard/800/cpsprodpb/x/y.jpg');
});

test('a Guardian item is found wherever the proxy folded media:content into', () => {
    /* The feed that defeats every named field: no <enclosure>, no
       <media:thumbnail>, and a <description> that is the standfirst as plain
       text with no <img> in it. Which key the proxy puts <media:content> under
       is its own business and has changed before, so the last resort walks the
       item for anything that reads as an image URL. */
    const item = {
        title: 'Something happened at Anfield',
        link: 'https://www.theguardian.com/football/2026/sep/05/match-report',
        description: '<p>The standfirst, with no picture in it at all.</p>',
        enclosure: {},
        media: { content: [
            { url: 'https://i.guim.co.uk/img/media/abc/master/140.jpg?width=140&s=deadbeef', width: '140' },
            { url: 'https://i.guim.co.uk/img/media/abc/master/460.jpg?width=460&s=cafe', width: '460' }
        ] }
    };
    assert.equal(newsThumbnail(item),
        'https://i.guim.co.uk/img/media/abc/master/140.jpg?width=140&s=deadbeef');
});

test('the deep scan does not mistake the article link for a picture', () => {
    assert.equal(newsThumbnail({
        link: 'https://www.theguardian.com/football/2026/sep/05/report',
        description: '<p>No image.</p>'
    }), null);
});

test('a named field still wins over the deep scan', () => {
    // The scan is a last resort; a feed that fills its fields in never reaches it.
    assert.equal(newsThumbnail({
        thumbnail: 'https://cdn/named.jpg',
        media: { content: [{ url: 'https://cdn/deep.jpg' }] }
    }), 'https://cdn/named.jpg');
});

test('nothing else has its size rewritten', () => {
    const sky = 'https://e0.365dm.com/26/09/384x216/skysports-thing_123.jpg';
    assert.equal(newsThumbnail({ thumbnail: sky }), sky);
});

test('tracking pixels are not images', () => {
    assert.equal(newsThumbnail({ description: '<img src="https://t.example/1x1.gif"><img src="https://a/real.jpg">' }),
        'https://a/real.jpg');
});

test('an article with no picture anywhere returns null, not a broken src', () => {
    assert.equal(newsThumbnail({ description: '<p>Just words.</p>' }), null);
    assert.equal(newsThumbnail({}), null);
    assert.equal(newsThumbnail(null), null);
});

test('a relative or data src is not accepted', () => {
    assert.equal(newsThumbnail({ description: '<img src="/local/pic.jpg">' }), null);
    assert.equal(newsThumbnail({ thumbnail: 'data:image/gif;base64,R0lGOD' }), null);
});
