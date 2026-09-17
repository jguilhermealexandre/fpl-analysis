/* Deciding whether a Premier League injury row is about one of your players.

   This is the join between two feeds that name people differently, and it is
   about to carry a notification, so a wrong match is not a cosmetic fault — it
   would tell someone their defender is injured when he is not, or worse, stay
   quiet about the one who is.

   Three real hazards, all present in the committed feed:

   - The table writes "Ben White". FPL's first_name for him is "Benjamin".
     Matching on first names would miss him entirely.
   - The table lists a Julian Araujo. This feed has a Ronald Araujo, a different
     man at a different club. Surname alone would hand one man's injury to the
     other.
   - Four clubs carry two players with the same surname — two Fletchers, two
     Murphys, two Mileys, two Angulos. Inside one club the surname is not
     unique, so the club constraint alone does not finish the job.

   The rule that survives all three: the club must match, the surname must
   appear as a whole word, one survivor is a match, and several are only a match
   if the first names settle it. Everything else returns null. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { plNormaliseName, plFirstNamesAgree, plMatchInjuredPlayer }
    from '../tools/fetch-pl-injuries.mjs';

const boot = JSON.parse(fs.readFileSync(new URL('../data/bootstrap-static.json', import.meta.url), 'utf8'));
const PLAYERS = boot.elements.map(p => ({
    id: p.id, teamId: p.team, firstName: p.first_name, secondName: p.second_name, name: p.web_name
}));
const clubId = name => boot.teams.find(t => t.name === name)?.id;
const surnameOf = id => PLAYERS.find(p => p.id === id)?.secondName;

test('the rows off the real table find the right players', () => {
    for (const [row, club, expectSurname] of [
        ['Ben White', 'Arsenal', 'White'],
        ['Cristhian Mosquera', 'Arsenal', 'Mosquera'],
        ['William Saliba', 'Arsenal', 'Saliba'],
        ['Ian Maatsen', 'Aston Villa', 'Maatsen'],
        ['Amadou Onana', 'Aston Villa', 'Onana']
    ]) {
        const id = clubId(club);
        assert.ok(id != null, `${club} is not in the feed`);
        const hit = plMatchInjuredPlayer(row, id, PLAYERS);
        assert.ok(hit, `${row} matched nobody at ${club}`);
        assert.equal(surnameOf(hit.id), expectSurname);
    }
});

test('Ben is Benjamin, Alex is Alexander, A is nobody', () => {
    assert.equal(plFirstNamesAgree('Ben White', 'Benjamin'), true);
    assert.equal(plFirstNamesAgree('Alex Scott', 'Alexander'), true);
    assert.equal(plFirstNamesAgree('Alexander Isak', 'Alexander'), true);
    // One letter is an initial, not a shortening: it would agree with far too
    // many people to be evidence of anything.
    assert.equal(plFirstNamesAgree('A Onana', 'Amadou'), false);
    assert.equal(plFirstNamesAgree('Leon Goretzka', 'Amadou'), false);
});

test('two men with one surname are told apart by their clubs', () => {
    const araujo = PLAYERS.find(p => (p.secondName || '').toLowerCase() === 'araujo');
    assert.ok(araujo, 'the feed no longer has an Araujo — pick another shared surname');
    assert.ok(plMatchInjuredPlayer('Ronald Araujo', araujo.teamId, PLAYERS),
        'he matches at his own club');
    const elsewhere = boot.teams.find(t => t.id !== araujo.teamId).id;
    assert.equal(plMatchInjuredPlayer('Julian Araujo', elsewhere, PLAYERS), null,
        'a different Araujo at another club must match nobody');
});

test('a surname shared inside one club is refused rather than guessed', () => {
    // Find a club that really does carry two of the same surname.
    const byClub = new Map();
    for (const p of PLAYERS) {
        const sn = (p.secondName || '').toLowerCase().split(' ').pop();
        if (!sn) continue;
        const key = `${p.teamId}|${sn}`;
        byClub.set(key, [...(byClub.get(key) || []), p]);
    }
    const shared = [...byClub.entries()].find(([, ps]) => ps.length > 1);
    assert.ok(shared, 'no club shares a surname in this feed — the hazard is gone, not the rule');
    const [key, ps] = shared;
    const [teamId, sn] = [Number(key.split('|')[0]), key.split('|')[1]];

    assert.equal(plMatchInjuredPlayer(sn, teamId, PLAYERS), null,
        'the bare surname is ambiguous and must not resolve');
    const withFirst = plMatchInjuredPlayer(`${ps[0].firstName} ${sn}`, teamId, PLAYERS);
    assert.equal(withFirst?.id, ps[0].id, 'the first name settles it');
});

test('nothing resolves without a club', () => {
    assert.equal(plMatchInjuredPlayer('Ben White', null, PLAYERS), null);
    assert.equal(plMatchInjuredPlayer('Ben White', 9999, PLAYERS), null);
});

test('nothing resolves from nothing', () => {
    assert.equal(plMatchInjuredPlayer('', 1, PLAYERS), null);
    assert.equal(plMatchInjuredPlayer(null, 1, PLAYERS), null);
    assert.equal(plMatchInjuredPlayer('Ben White', 1, null), null);
    assert.equal(plMatchInjuredPlayer('Someone Whodoesnotexist', clubId('Arsenal'), PLAYERS), null);
});

test('accents and punctuation do not stop a match', () => {
    const squad = [{ id: 1, teamId: 7, firstName: 'Cristhian', secondName: 'Mosquera', name: 'Mosquera' }];
    assert.ok(plMatchInjuredPlayer('Cristhián Mosquera', 7, squad), 'an accent in the table');
    assert.equal(plNormaliseName("O'Brien-Smith"), 'o brien smith');
});
