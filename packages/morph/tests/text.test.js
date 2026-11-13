import test from 'node:test';
import assert from 'node:assert/strict';
import { lib } from './helpers.js';
const { plene, pleneWord, stripMarks, isPointed } = await lib('plene.js');
const { segments, words, wordKey, contextKey, forModel, isNameWord, NAME_SHOWN } = await lib('text.js');

test('plene: the rules it claims', () => {
  const pairs = { 'שֻׁלְחָן': 'שולחן', 'בֹּקֶר': 'בוקר', 'דִּבֵּר': 'דיבר', 'מִשְׁפָּט': 'משפט', 'תִּקְוָה': 'תקווה', 'רֹאשׁ': 'ראש', 'מִבַּיִת': 'מבית', 'מִלָּה': 'מילה', 'גִּבּוֹר': 'גיבור', 'לֹא': 'לא', 'כָּל': 'כל', 'שָׁלוֹם': 'שלום', 'בַּיִת': 'בית' };
  for (const [from, to] of Object.entries(pairs)) assert.equal(pleneWord(from), to, from);
});

test('plene: unpointed text and everything that is not a Hebrew word are left alone', () => {
  assert.equal(plene('שלום עולם, 12 apples'), 'שלום עולם, 12 apples');
  assert.equal(plene('אֲנִי רוֹצָה קָפֶה הָפוּךְ, בְּבַקָּשָׁה.'), 'אני רוצה קפה הפוך, בבקשה.');
  assert.equal(isPointed('שלום'), false);
  assert.equal(stripMarks('עַל־לְבָבֶךָ׃'), 'על־לבבך');
});

test('text: segments are the stretches of Hebrew, words stop at a maqaf and keep an inner gershayim', () => {
  assert.deepEqual(segments('Say שָׁלוֹם רַב! and then תּוֹדָה.').map((s) => s.text), ['שָׁלוֹם רַב!', 'תּוֹדָה.']);
  assert.deepEqual(words('עַל־לְבָבֶךָ צה״ל').map((w) => w.word), ['עַל', 'לְבָבֶךָ', 'צה״ל']);
  assert.equal(wordKey('בְּבַקָּשָׁה'), 'בבקשה');
});

test('text: the context key ignores points and spacing, and differs between sentences', () => {
  assert.equal(contextKey('אֲנִי  רוֹצָה קָפֶה'), contextKey('אני רוצה קפה'));
  assert.notEqual(contextKey('אני רוצה קפה'), contextKey('אני רוצה תה'));
});

test('text: forModel gives full spelling with each shown word located in it', () => {
  const m = forModel('וְשִׁנַּנְתָּם לְבָנֶיךָ׃ וְדִבַּרְתָּ בָּם');
  assert.equal(m.model, 'ושיננתם לבניך ודיברת בם');
  for (const w of m.words) assert.ok(m.model.slice(w.start, w.end).length > 0);
  assert.deepEqual(m.words.map((w) => m.model.slice(w.start, w.end)), ['ושיננתם', 'לבניך', 'ודיברת', 'בם']);
  assert.deepEqual(m.words.map((w) => w.key), ['ושננתם', 'לבניך', 'ודברת', 'בם']);
});

test('the divine Name: recognised pointed, unpointed and with prefixes; replaced before the model sees the text', () => {
  const name = 'יהוה';
  for (const w of [name, 'יְ' + 'הוָה', 'ל' + name, 'וּבַ' + name, NAME_SHOWN]) assert.equal(isNameWord(w), true, w);
  for (const w of ['יהודה', 'היה', 'ויהי', 'הוה']) assert.equal(isNameWord(w), false, w);
  const m = forModel(`בָּרוּךְ אַתָּה ${name} אֱלֹהֵינוּ`);
  assert.equal(m.model.includes(name), false);
  assert.equal(m.model, `ברוך אתה ${NAME_SHOWN} אלוהינו`);
  assert.equal(m.words[2].name, true);
  assert.equal(m.words[2].key, NAME_SHOWN);
});
