import test from 'node:test';
import assert from 'node:assert/strict';
import { src } from './helpers.js';
const { stripPoints, hasPoints, hasCantillation, guardName, nameWord, NAME_SHOWN, chunks, runs } = await import(src('hebrew.js'));

test('stripPoints removes vowel points, dagesh, shin dots and cantillation, and keeps maqaf', () => {
  assert.equal(stripPoints('שָׁלוֹם'), 'שלום');
  assert.equal(stripPoints('בְּרֵאשִׁ֖ית בָּרָ֣א'), 'בראשית ברא');
  assert.equal(stripPoints('כׇּל־הָאָרֶץ'), 'כל־הארץ');
  assert.equal(hasPoints('שלום'), false);
  assert.equal(hasPoints('שָׁלוֹם'), true);
  assert.equal(hasCantillation('בְּרֵאשִׁ֖ית'), true);
  assert.equal(hasCantillation('בְּרֵאשִׁית'), false);
});

test('the divine Name is written as he + geresh, bare, pointed or with prefixes', () => {
  assert.equal(NAME_SHOWN, 'ה׳');
  assert.deepEqual(guardName('ברוך אתה יהוה אלהינו'), { text: 'ברוך אתה ה׳ אלהינו', found: true });
  assert.deepEqual(guardName('בָּרוּךְ אַתָּה יְהוָה'), { text: 'בָּרוּךְ אַתָּה ה׳', found: true });
  assert.deepEqual(guardName('הודו ליהוה כי טוב'), { text: 'הודו לה׳ כי טוב', found: true });
  assert.deepEqual(guardName('וַיהוָה'), { text: 'וה׳', found: true });
  assert.deepEqual(guardName('בָּרוּךְ אַתָּה יְיָ'), { text: 'בָּרוּךְ אַתָּה ה׳', found: true });
  assert.equal(guardName('יְהֹוָ֥ה').text, 'ה׳'); // with cantillation
});

test('text that already has he + geresh counts as holding the Name; other words do not', () => {
  assert.equal(guardName('ברוך ה׳').found, true);
  assert.equal(guardName("בעזרת ה'").found, true);
  for (const w of ['יהודה', 'יהיה', 'הויה', 'שלום', 'יהודי']) assert.equal(nameWord(w), null, w);
  assert.deepEqual(guardName('יהודה אמר שלום'), { text: 'יהודה אמר שלום', found: false });
});

test('chunks give the text back and stay under the limit', () => {
  const text = Array.from({ length: 60 }, (_, i) => `זה משפט מספר ${i} בטקסט ארוך.`).join(' ');
  const parts = chunks(text, 120);
  assert.equal(parts.join(''), text);
  assert.ok(parts.every((p) => p.length <= 120));
  assert.deepEqual(chunks('קצר'), ['קצר']);
  assert.equal(chunks('א'.repeat(1000), 300).join(''), 'א'.repeat(1000));
});

test('runs split text into words and the rest; a geresh between letters stays in the word', () => {
  assert.deepEqual(runs('שלום, עולם!').map((r) => r.text), ['שלום', ', ', 'עולם', '!']);
  assert.deepEqual(runs('ג׳ינס').filter((r) => r.word).map((r) => r.text), ['ג׳ינס']);
  assert.deepEqual(runs("צ'יפס טעים").filter((r) => r.word).map((r) => r.text), ["צ'יפס", 'טעים']);
  assert.deepEqual(runs("הוא אמר 'חג'").filter((r) => r.word).map((r) => r.text), ['הוא', 'אמר', 'חג']);
  assert.equal(runs('abc 123').some((r) => r.word), false);
});
