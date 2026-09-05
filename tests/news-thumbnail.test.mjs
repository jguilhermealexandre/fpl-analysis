/* Pictures in the news cards.

   The three news views each read `article.thumbnail || article.enclosure.link`
   and each fell back to a coloured placeholder for the two feeds that use
   neither — the BBC and the Guardian put their image in the item body. These
   pin what is now looked at, in what order, and the two rewrites that are
   allowed: https, and the BBC's width. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

const newsThumbnail = loadFunction('scripts/common.js', 'newsThumbnail', {
    newsThumbsFromHTML: loadFunction('scripts/common.js', 'newsThumbsFromHTML'),
    newsThumbUpgrade: loadFunction('scripts/common.js', 'newsThumbUpgrade'),
    NEWS_THUMB_SKIP: /(?:^|\/)(?:1x1|pixel|spacer|blank|transparent)\.(?:gif|png|jpg)(?:\?|$)/i
});

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
