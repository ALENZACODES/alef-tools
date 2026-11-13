import test from 'node:test';
import assert from 'node:assert/strict';
import { mod } from './helpers.js';
import { readFileSync } from 'node:fs';
const { createCorrector, distance, looksAlike, showName, hasName, rankWith, namesWith, budget } = await mod('correct.js');
const pkg = await mod('index.js');

const WORDS = ['שלום', 'תודה', 'בבקשה', 'איפה', 'השירותים', 'קפה', 'חלב', 'לחם', 'פתוח', 'סגור', 'כניסה', 'יציאה', 'רחוב', 'תחנת', 'אוטובוס', 'בית', 'ספר', 'מים', 'דג', 'דב', 'רב', 'חם', 'הם', 'מסעדה', 'מרכז', 'העיר', 'עיר', 'זהירות', 'בוקר', 'טוב', 'דלת', 'דרך', 'חדר', 'חבר'];
const fix = createCorrector(WORDS);
const LOW = { conf: 40 };           // the reader was unsure
const MID = { conf: 80 };           // fairly sure
const SURE = { conf: 95 };
const low = (text) => ({ confs: text.trim().split(/\s+/).map(() => 40) });

test('look-alike letters are a cheap edit, anything else is a full one', () => {
  assert.ok(looksAlike('ד', 'ר') && looksAlike('ה', 'ח') && looksAlike('ב', 'כ') && looksAlike('ס', 'ם') && looksAlike('ו', 'ן'));
  assert.ok(!looksAlike('ש', 'ל'));
  assert.equal(distance('סגור', 'סגוד'), 0.4);
  assert.equal(distance('שלום', 'שלם'), 0.6);
  assert.equal(distance('שלום', 'שלוש'), 1);
  assert.equal(distance('שלום', 'שלום'), 0);
  assert.equal(distance('אבגדה', 'שלום', 1), Infinity);
});

test('a word the reader was unsure of, with one close neighbour in the list, is put right', () => {
  assert.deepEqual(fix.correctToken('סגוד', LOW), { text: 'סגור', changed: true, from: 'סגוד', cost: 0.4 });
  assert.equal(fix.correctToken('פתוה', LOW).text, 'פתוח');
  assert.equal(fix.correctToken('כניסח', LOW).text, 'כניסה');
  assert.equal(fix.correctToken('אוטוכוס', LOW).text, 'אוטובוס');
  assert.equal(fix.correctToken('שלם', LOW).text, 'שלום');            // a dropped vav
  assert.equal(fix.correctToken('זחירות!', LOW).text, 'זהירות!');      // punctuation kept
});

test('how sure the reader was decides how far a word may be moved', () => {
  // sure, or no confidence given: never changed. A word missing from the list is usually just a word the list does not hold.
  assert.equal(fix.correctToken('סגוד', SURE).changed, false);
  assert.equal(fix.correctToken('סגוד').changed, false);
  assert.equal(fix.correctToken('סגוד', { conf: 88 }).changed, false);
  // fairly sure: one look-alike swap, nothing more
  assert.equal(fix.correctToken('סגוד', MID).text, 'סגור');
  assert.equal(fix.correctToken('שלם', MID).changed, false);            // would need an added letter
  assert.equal(fix.correctToken('סנוד', MID).changed, false);           // would need two swaps
  assert.equal(fix.correctToken('סנוד', LOW).text, 'סגור');
});

test('listed words, prefixed listed words, numbers, Latin and pointed text are left alone', () => {
  for (const t of ['שלום', 'והעיר', 'לבית', '12.50', 'WiFi', '₪', 'שָׁלוֹם', 'ת"א', "צ'יפס"]) assert.equal(fix.correctToken(t, LOW).changed, false, t);
});

test('a word with no close neighbour is left exactly as read', () => {
  assert.equal(fix.correctToken('פיצריה', LOW).changed, false);
  assert.equal(fix.correctToken('גלידה', LOW).changed, false);
});

test('two equally close neighbours: left alone without context, decided with it', async () => {
  assert.equal(fix.correctToken('הב', LOW).changed, false);          // nothing listed is close enough to a two-letter word
  assert.equal(fix.correctToken('חדד', LOW).text, 'חדר');
  const amb = createCorrector(['דגל', 'רגל', 'יש', 'טוב']);
  const t = amb.correctToken('ךגל', LOW);                              // ך looks like both ד and ר: two neighbours at the same cost
  assert.equal(t.changed, false); assert.equal(t.tied.length, 2);
  const text = 'יש ךגל טוב';
  const line = await amb.correctLine(text, { ...low(text), rank: (left, cands, right) => { assert.equal(left, 'יש'); assert.equal(right, 'טוב'); return cands.map((c) => (c === 'רגל' ? 2 : 1)); } });
  assert.equal(line.text, 'יש רגל טוב'); assert.equal(line.changes[0].by, 'context');
  assert.equal((await amb.correctLine(text, low(text))).text, text);
  assert.equal((await amb.correctLine(text, { ...low(text), rank: () => { throw new Error('pack gone'); } })).text, text);
});

test('names are never corrected when a name tagger says so', async () => {
  const text = 'רחוב הרצח';
  const r = await fix.correctLine(text, { ...low(text), isName: (toks, i) => i === 1 });
  assert.equal(r.text, text);
});

test('lines and boxes: spacing kept, original reading kept in raw', async () => {
  const r = await fix.correctLine('  איפח  השירותים? ', { confs: [undefined, 40, 40, undefined] });
  assert.equal(r.text, '  איפה  השירותים? '); assert.equal(r.changes.length, 1);
  const boxes = await fix.correctBoxes([{ text: 'סגוד', x: 1, y: 2, w: 3, h: 4, conf: 61 }, { text: 'פתוח', x: 9, y: 2, w: 3, h: 4, conf: 95 }, { text: 'כניסח', x: 20, y: 2, w: 3, h: 4, conf: 96 }]);
  assert.deepEqual(boxes[0], { text: 'סגור', x: 1, y: 2, w: 3, h: 4, conf: 61, raw: 'סגוד' });
  assert.equal(boxes[1].raw, undefined);
  assert.equal(boxes[2].text, 'כניסח');                                // the reader was sure: left as read
});

test('short words are barely touched', () => {
  assert.equal(budget(1), 0); assert.equal(budget(2), 0.4);
  assert.equal(fix.correctToken('א', LOW).changed, false);
});

test('the Name is written ה׳: alone, pointed, and after prefix letters', () => {
  assert.equal(showName('יהוה'), 'ה׳');
  assert.equal(showName('יְבָרֶכְךָ יְהוָה וְיִשְׁמְרֶךָ'), 'יְבָרֶכְךָ ה׳ וְיִשְׁמְרֶךָ');
  assert.equal(showName('ברוך אתה יהוה אלהינו'), 'ברוך אתה ה׳ אלהינו');
  assert.equal(showName('ליהוה'), 'לה׳'); assert.equal(showName('וַיהוָה'), 'וה׳');
  assert.equal(showName('שלום עולם'), 'שלום עולם');
  assert.equal(showName('יהודה'), 'יהודה');
  assert.ok(hasName('אֲנִי יְהוָה') && !hasName('אני והוא'));
});

test('a word that may be the Name, even misread, is never turned into another word, and the Name is never a correction', () => {
  const c = createCorrector(['יהיה', 'והיה', 'היה', 'שלום', 'ליהודה', 'יהוה']);
  for (const t of ['יהוה', 'יהןה', 'יחוה', 'יהזה', 'ליהןה', 'ויחוה']) assert.equal(c.correctToken(t, LOW).changed, false, t);
  assert.equal(c.correctToken('שלןם', LOW).text, 'שלום');
});

test('lines with vowel points are left exactly as read, and so is a page that is mostly pointed', async () => {
  const c = createCorrector(['תהלה', 'עת', 'נורא', 'שלום']);
  const line = 'נורָא תהלת עה';
  assert.equal((await c.correctLine(line, low(line))).text, line);
  const boxes = [{ text: 'נורָא', conf: 30 }, { text: 'תהלת', conf: 30 }, { text: 'עה', conf: 30 }, { text: 'בַּקֹּדֶשׁ', conf: 30 }];
  assert.deepEqual(await c.correctBoxes(boxes), boxes);
  assert.equal((await c.correctBoxes([{ text: 'שלןם', conf: 30 }, { text: 'עה', conf: 30 }]))[0].text, 'שלום');
});

test('two listed words run together are split when there is only one way to do it', async () => {
  const c = createCorrector(['אני', 'לא', 'מבין', 'אנ', 'ילא']);
  assert.equal(c.correctToken('אנילא', LOW).changed, false);           // two ways (אני+לא, אנ+ילא): left alone
  const d = createCorrector(['אני', 'לא', 'מבין']);
  const r = await d.correctLine('אנילא מבין', { confs: [80, 93] });
  assert.equal(r.text, 'אני לא מבין'); assert.equal(r.changes[0].by, 'split');
  assert.equal(d.correctToken('אנילא', SURE).changed, false);
});

test('equally close: a very common word wins over a rare one; context, when there is any, still decides first', async () => {
  const many = Array.from({ length: 1500 }, (_, i) => 'ק' + String.fromCharCode(0x5d0 + (i % 22)) + String.fromCharCode(0x5d0 + ((i / 22) | 0) % 22) + 'ש' + (i > 483 ? 'ת' : ''));
  const c = createCorrector(['אני', ...many, 'אגו']);
  const r = c.correctToken('אגי', LOW);
  assert.equal(r.text, 'אני'); assert.equal(r.byUse, true);
  const line = await c.correctLine('אגי כאן', { confs: [40, 95], rank: (l, cands) => cands.map((w) => (w === 'אגו' ? 5 : 1)) });
  assert.equal(line.text, 'אגו כאן'); assert.equal(line.changes[0].by, 'context');
  const two = createCorrector(['דגל', 'רגל']);                     // neither is far more common: left alone
  assert.equal(two.correctToken('ךגל', LOW).changed, false);
});

test('adapters for the words pack return undefined when the pack is not there', () => {
  assert.equal(rankWith(null), undefined); assert.equal(namesWith({}), undefined);
  assert.equal(typeof rankWith({ scoreCandidates: () => [] }), 'function');
});

test('package entry: contract shape, loads from a list or a URL, never fetches anything else', async () => {
  assert.equal(pkg.id, 'ocr-fix'); assert.deepEqual(pkg.packs, []);
  assert.equal(pkg.version, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  const a = await pkg.load({ lexicon: { words: WORDS.join('\n') } });
  assert.equal(a.size, WORDS.length); assert.equal(a.usesContext, false);
  assert.equal((await a.correctLine('סגוד', { confs: [40] })).text, 'סגור');
  const calls = [];
  const b = await pkg.load({ lexiconUrl: 'https://example.test/l.json', fetch: async (u) => { calls.push(u); return { ok: true, json: async () => ({ words: WORDS }) }; }, words: { scoreCandidates: (l, c) => c.map(() => 0), nameTags: (t) => t.map(() => 'O') } });
  assert.deepEqual(calls, ['https://example.test/l.json']); assert.equal(b.usesContext, true); assert.equal(b.usesNameTags, true);
  await assert.rejects(() => pkg.load({}), /lexicon/);
  await pkg.unload();
});
