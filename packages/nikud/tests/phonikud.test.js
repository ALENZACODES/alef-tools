import test from 'node:test';
import assert from 'node:assert/strict';
import { src, ort, fakeSession } from './helpers.js';
const { wordSounds, carryMarks, soundLine, plainPointed, createPhonikud, clusters } = await import(src('phonikud.js'));
const { STRESS: S, VOCAL_SHVA: V, PREFIX: P } = await import(src('hebrew.js'));

const sounds = (w, marked) => wordSounds(w, { marked }).phonemes;

test('consonants and vowels: everyday words', () => {
  const table = { 'שָׁלוֹם': 'ʃaˈlom', 'אֲנִי': 'ʔaˈni', 'הִיא': 'hi', 'הוּא': 'hu', 'מַלְכָּה': 'malˈka', 'כָּתַב': 'kaˈtav', 'שָׂדֶה': 'saˈde', 'מוֹרֶה': 'moˈʁe',
    'תּוֹרָה': 'toˈʁa', 'יִשְׂרָאֵל': 'jisʁaˈʔel', 'עִבְרִית': 'ʔivˈʁit', 'קָפֶה': 'kaˈfe', 'פִּיצָה': 'piˈtsa', 'אִשָּׁה': 'ʔiˈʃa', 'עוֹלָם': 'ʔoˈlam', 'אוּלַי': 'ʔuˈlaj' };
  for (const [w, want] of Object.entries(table)) assert.equal(sounds(w), want, w);
});

test('stress: the marked letter wins; with no mark the last syllable is stressed', () => {
  assert.equal(sounds('סֵ' + S + 'פֶר'), 'ˈsefeʁ');
  assert.equal(sounds('סֵפֶר'), 'seˈfeʁ');
  assert.equal(sounds('בַּ' + S + 'יִת'), 'ˈbajit');
  assert.equal(sounds('לִירוּשָׁלַ' + S + 'יִם'), 'liʁuʃaˈlajim');
  assert.equal(wordSounds('סֵ' + S + 'פֶר').stress, 0);
  assert.equal(sounds('כׇּל'), 'kol', 'one syllable carries no stress sign');
});

test('shva: sounded only where the pack marked it', () => {
  assert.equal(sounds('יְ' + V + 'לָדִים', true), 'jelaˈdim');
  assert.equal(sounds('זְמַן', true), 'zman');
  assert.equal(sounds('בְּ' + V + 'רָכָה'), 'beʁaˈχa');
  assert.deepEqual(wordSounds('יְ' + V + 'לָדִים').vocalShva, [0]);
  assert.equal(sounds('לַיְלָה'), 'lajˈla');
});

test('qamats qatan is o, and is reported', () => {
  assert.equal(sounds('חׇכְמָה'), 'χoχˈma');
  assert.equal(sounds('תׇּכְנִית'), 'toχˈnit');
  assert.deepEqual(wordSounds('חׇכְמָה').qamatsQatan, [0]);
  assert.equal(sounds('צָהֳרַיִם'), 'tsahoʁaˈjim');
});

test('vowel letters, vav and yod', () => {
  assert.equal(sounds('מִצְוֹת'), 'mitsˈvot', 'vav with holam after a shva is v + o');
  assert.equal(sounds('עַכְשָׁיו'), 'ʔaχˈʃav', 'the yod of -av is silent');
  assert.equal(sounds('חַי'), 'χaj');
  assert.equal(sounds('גּוֹי'), 'ɡoj');
  assert.equal(sounds('וַו'), 'vav');
  assert.equal(sounds('בִּמְיֻוחָד'), 'bimjuˈχad', 'a bare vav after kubutz is a vowel letter');
  assert.equal(sounds('לִימּוּד'), 'liˈmud', 'a bare yod after hiriq is a vowel letter');
});

test('furtive patah and final he', () => {
  assert.equal(sounds('ר' + S + 'וּחַ'), 'ˈʁuaχ');
  assert.equal(sounds('שׁוֹמֵ' + S + 'עַ'), 'ʃoˈmea');
  assert.equal(sounds('גָּבֹהַּ'), 'ɡaˈvoah');
  assert.equal(sounds('לְ' + V + 'הַגִּ' + S + 'יעַ'), 'lehaˈɡia');
});

test('letters with geresh', () => {
  assert.equal(sounds('גִ׳ינְס'), 'dʒins');
  assert.equal(sounds('צִ׳יפְּס'), 'tʃips');
  assert.equal(clusters('ג׳')[0].geresh, true);
});

test('carryMarks keeps the book pointing and adds the pack marks; a sounded-shva mark needs a shva in the book', () => {
  const book = 'סֵפֶר', marked = 'סֶ' + S + 'פֶר';
  assert.equal(carryMarks(book, marked), 'סֵ' + S + 'פֶר');
  assert.equal(plainPointed(carryMarks(book, marked)), book);
  assert.equal(carryMarks('יַלְדָּה', 'יַ' + V + 'לְ' + V + 'דָּה'), 'יַלְ' + V + 'דָּה');
  assert.equal(carryMarks('אבג', 'דהו'), 'דהו', 'different letters: nothing is carried');
});

test('soundLine: words become sounds, punctuation stays, maqaf becomes a hyphen', () => {
  const r = soundLine('שָׁלוֹם, מָה נִשְׁמָע?');
  assert.equal(r.phonemes, 'ʃaˈlom, ma niʃˈma?');
  assert.equal(r.words.length, 3);
  assert.equal(soundLine('הַ' + P + 'בַּ' + S + 'יִת').words[0].prefix, 1);
  assert.equal(soundLine('כׇּל־הָעָם').phonemes, 'kol-haˈʔam');
});

test('the divine Name is never sounded out: no sound line, the Name shown as he + geresh, the model not asked', async () => {
  const calls = [];
  const p = createPhonikud({ ort, session: fakeSession(() => ({ nikud: 'ַ' }), { extra: true, calls }) });
  for (const line of ['ברוך אתה יהוה אלהינו', 'בָּרוּךְ אַתָּה יְהוָה', 'הודו ליהוה', 'ברוך ה׳']) {
    const r = await p.sounds(line);
    assert.equal(r.phonemes, null, line);
    assert.equal(r.name, true);
    assert.ok(!r.text.includes('יהוה') && !/יְהוָה/.test(r.text));
    assert.ok(r.text.includes('ה׳'));
  }
  assert.equal(calls.length, 0);
});

test('sounds: bare text is pointed and sounded; words that came pointed keep their points', async () => {
  const p = createPhonikud({ ort, session: fakeSession((i) => ({ nikud: 'ַ', stress: i === 0 }), { extra: true }) });
  const r = await p.sounds('סֵפֶר טוב');
  assert.equal(r.text.split(' ')[0], 'סֵפֶר');
  assert.equal(r.words[0].phonemes, 'ˈsefeʁ');
  assert.equal(r.name, false);
  assert.ok(r.phonemes && r.phonemes.startsWith('ˈsefeʁ '));
});
