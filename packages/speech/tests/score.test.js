import test from 'node:test';
import assert from 'node:assert/strict';
import { mod } from './helpers.js';
const { expectedUnits, scoreUtterance, isNameWord, TRADITIONS } = await mod('score.js');

// the letter table of the shipped model (imvladikon/wav2vec2-large-xlsr-53-hebrew vocab.json)
const vocab = { 'ת': 0, 'ט': 1, 'ע': 2, 'ך': 3, 'ק': 4, 'צ': 5, 'פ': 6, 'כ': 7, 'י': 8, 'ח': 9, "'": 10, 'ז': 11, 'ף': 12, 'ג': 13, 'ר': 14, 'ה': 15, 'ד': 16, 'ש': 17, 'מ': 18, 'א': 19, 'ב': 20, 'ץ': 21, 'ס': 22, 'ן': 23, 'נ': 24, 'ם': 25, 'ו': 26, 'ל': 28, '|': 27, '[UNK]': 29, '[PAD]': 30 };
const V = 31, blankId = 30;
const model = { vocab, blankId };

/** What the model would give for someone saying `said` clearly: each letter for two frames, a blank after it. */
function say(said, p = 0.94) {
  const ids = [];
  for (const ch of said) { const id = ch === ' ' ? vocab['|'] : vocab[ch]; ids.push(id, id, blankId); }
  const T = ids.length, logp = new Float32Array(T * V);
  ids.forEach((s, t) => { for (let v = 0; v < V; v++) logp[t * V + v] = Math.log(v === s ? p : (1 - p) / (V - 1)); });
  return { logp, T, V };
}
const status = (r) => r.letters.map((l) => `${l.ch}:${l.status}`).join(' ');
const byCh = (r, ch) => r.letters.find((l) => l.ch === ch);

test('a word read as written: every checked letter is right', () => {
  const r = scoreUtterance(say('שלום'), model, 'שָׁלוֹם');
  assert.equal(r.ok, true);
  assert.equal(status(r), 'ש:ok ל:ok ו:skip ם:ok');
  assert.equal(byCh(r, 'ו').why, 'vowel-letter');
  assert.deepEqual([r.checked, r.right, r.score], [3, 3, 1]);
  assert.deepEqual(r.words.map((w) => [w.checked, w.right]), [[3, 3]]);
});

test('a wrong consonant is marked, with the letter it sounded like, and its place in the text', () => {
  const text = 'שָׁלוֹם';
  const r = scoreUtterance(say('שרום'), model, text); // resh said for lamed
  const l = byCh(r, 'ל');
  assert.equal(l.status, 'check'); assert.equal(l.heard, 'ר');
  assert.equal(text[l.index], 'ל');
  assert.equal(byCh(r, 'ש').status, 'ok'); assert.equal(byCh(r, 'ם').status, 'ok');
  assert.ok(r.score < 1 && r.score > 0.6);
});

test('a missing consonant is marked with nothing heard, once the evidence passes the "no letter" bar', () => {
  // by default "no letter here" needs very strong evidence (the model itself skips letters in quick speech)
  assert.equal(byCh(scoreUtterance(say('שום'), model, 'שָׁלוֹם'), 'ל').status, 'ok');
  const r = scoreUtterance(say('שום'), model, 'שָׁלוֹם', { dropMargin: -3 });
  const l = byCh(r, 'ל');
  assert.equal(l.status, 'check'); assert.equal(l.heard, '');
});

test('letters that sound the same share credit: spelling is never marked down', () => {
  // khaf written as het, tav as tet, qof as kaf, samekh as sin, vet as vav, final forms as regular
  for (const [text, said] of [['חָכָם', 'כחם'], ['תּוֹדָה', 'טודה'], ['קוֹל', 'כול'], ['סֵפֶר', 'שפר'], ['אָבִיב', 'אויו'], ['מֶלֶךְ', 'מלכ'], ['שָׂם', 'סמ']]) {
    const r = scoreUtterance(say(said), model, text);
    assert.ok(r.letters.every((l) => l.status !== 'check'), `${text} read as ${said}: ${status(r)}`);
  }
});

test('a dot changes what counts: bet with a dot is b only; shin with its right dot is sh only', () => {
  const b = scoreUtterance(say('ויה'), model, 'בַּיָּה');
  assert.equal(byCh(b, 'ב').status, 'check');
  const sh = scoreUtterance(say('סם'), model, 'שָׁם');
  assert.equal(byCh(sh, 'ש').status, 'check');
});

test('what cannot be heard from letters is skipped with the reason, never scored', () => {
  const { units } = expectedUnits('אָדָם הוּא עַל הָהָר יִשְׂרָאֵל');
  const why = (ch, n = 0) => units.filter((u) => u.ch === ch)[n];
  assert.deepEqual([why('א').scored, why('א').why], [false, 'silent']);
  assert.deepEqual([why('ע').scored, why('ע').why], [false, 'silent']);
  assert.deepEqual([why('ו').scored, why('ו').why], [false, 'vowel-letter']); // shuruk
  assert.equal(why('י').scored, true); // yod as a consonant at the start of a word
  const unpointed = expectedUnits('שלום ביתי').units;
  assert.deepEqual(unpointed.filter((u) => u.ch === 'ו' || u.ch === 'י').map((u) => u.why), ['unpointed', 'unpointed', 'unpointed']);
  const yodVowel = expectedUnits('שִׁיר').units.find((u) => u.ch === 'י');
  assert.deepEqual([yodVowel.scored, yodVowel.why], [false, 'vowel-letter']);
});

test('the Name is never scored, whatever is said in its place, and gets no letters in the result', () => {
  for (const w of ['יְהוָה', 'יהוה', 'וַיהוָה', 'לַיהוָה', 'יְיָ', 'ה׳', "ה'"]) assert.equal(isNameWord(w), true, w);
  for (const w of ['יהודה', 'היה', 'הוא', 'יי׳ן', 'שלום']) assert.equal(isNameWord(w), false, w);
  const text = 'בָּרוּךְ יְהוָה לְעוֹלָם';
  for (const said of ['ברוך אדני לעולם', 'ברוך השם לעולם', 'ברוך לעולם']) {
    const r = scoreUtterance(say(said), model, text);
    assert.equal(r.ok, true, said);
    assert.ok(r.letters.every((l) => l.word !== 1), 'no letter of the Name is reported');
    assert.ok(r.letters.every((l) => l.status !== 'check'), `${said}: ${status(r)}`);
    assert.deepEqual([r.words[1].name, r.words[1].checked], [true, 0]);
  }
  const { units } = expectedUnits(text);
  assert.deepEqual(units.filter((u) => u.word === 1 && u.why !== 'space').map((u) => [u.accept, u.scored, u.why]), [['any', false, 'name']]);
});

test('a valid tradition reading is never marked: Ashkenazi tav without a dot read as s; Sephardi tsadi read as s', () => {
  const shabbos = say('שבס');
  assert.equal(byCh(scoreUtterance(shabbos, model, 'שַׁבָּת', { tradition: 'ashkenazi' }), 'ת').status, 'ok');
  assert.equal(byCh(scoreUtterance(shabbos, model, 'שַׁבָּת', { tradition: 'israeli' }), 'ת').status, 'check');
  // tav WITH a dot is t in every tradition
  assert.equal(byCh(scoreUtterance(say('אסה'), model, 'אַתָּה', { tradition: 'ashkenazi' }), 'ת').status, 'check');
  assert.equal(byCh(scoreUtterance(say('סדק'), model, 'צֶדֶק', { tradition: 'sephardi' }), 'צ').status, 'ok');
  assert.equal(byCh(scoreUtterance(say('סדק'), model, 'צֶדֶק', { tradition: 'israeli' }), 'צ').status, 'check');
  // and every tradition accepts the Israeli reading too
  for (const tradition of TRADITIONS) for (const [text, said] of [['שַׁבָּת', 'שבת'], ['צֶדֶק', 'צדק'], ['חָכָם', 'חכם']]) {
    const r = scoreUtterance(say(said), model, text, { tradition });
    assert.ok(r.letters.every((l) => l.status !== 'check'), `${tradition} ${text}: ${status(r)}`);
  }
  assert.equal(expectedUnits('שַׁבָּת', { tradition: 'yemenite' }).units.find((u) => u.ch === 'ת').accept.includes('ס'), false); // unknown tradition = Israeli rules
});

test('edge cases answer plainly instead of throwing', () => {
  assert.equal(scoreUtterance(say('ש'), model, '').error, 'no-text');
  assert.equal(scoreUtterance(say('ש'), model, 'hello 123').error, 'no-text');
  const tiny = { logp: new Float32Array(2 * V).fill(Math.log(1 / V)), T: 2, V };
  assert.equal(scoreUtterance(tiny, model, 'שָׁלוֹם עֲלֵיכֶם').error, 'too-short');
  const r = scoreUtterance(say('אא'), model, 'אֵא'); // nothing checkable
  assert.deepEqual([r.ok, r.checked, r.score], [true, 0, null]);
});

test('two words: the pause between them is lined up but not scored', () => {
  const r = scoreUtterance(say('בקר טוב'), model, 'בֹּקֶר טוֹב');
  assert.equal(status(r), 'ב:ok ק:ok ר:ok ט:ok ו:skip ב:ok');
  assert.deepEqual(r.words.map((w) => w.text), ['בֹּקֶר', 'טוֹב']);
  // with a margin the caller can be stricter or kinder
  assert.ok(scoreUtterance(say('בקר טוב'), model, 'בֹּקֶר טוֹב', { margin: 50 }).right < r.right);
});
