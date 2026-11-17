import test from 'node:test';
import assert from 'node:assert/strict';
import { unitIds, data, lib } from './helpers.js';
const { describe, lessonNote, lint, prefixParts, whoOf, NOTHING } = await lib('explain.js');

test('lint: catches what it is there to catch', () => {
  assert.deepEqual(lint('Verb pattern (binyan): pa\'al.'), []);
  assert.ok(lint('This is a binyan.').some((p) => p.includes('term without its meaning')));
  assert.ok(lint('The model predicts a noun.').includes('mentions how it was made'));
  assert.ok(lint('It is worth noting that this delves deep.').some((p) => p.startsWith('stock phrase')));
  assert.ok(lint(`${'word '.repeat(26)}.`).some((p) => p.startsWith('too long')));
  assert.ok(lint('No stop').includes('no full stop'));
  assert.ok(lint('Has undefined in it.').includes('unfilled slot'));
});

test('describe: a noun with a prefix and a hidden "the"', () => {
  const lines = describe({ l: 'מסעדה', p: 'ב', s: 'NOUN', g: 'f', n: 'sg', dt: 1 }, { he: 'מִסְעָדָה', en: 'restaurant', pos: 'noun', gender: 'f', root: 'ס־ע־ד', rootChecked: false });
  assert.deepEqual(lines.map((l) => l.id), ['form', 'prefix', 'the', 'kind', 'root']);
  assert.equal(lines[1].text, 'ב־ (“in, at or with”) is joined to the front of the word.');
  assert.equal(lines[3].text, 'Noun (a thing, person or idea): feminine, singular (one).');
  assert.equal(lines[4].label, 'Family letters');
});

test('describe: a checked root is called a root, an unchecked one is not', () => {
  const root = (checked) => describe({ s: 'VERB' }, { he: 'כָּתַב', en: 'to write', pos: 'verb', root: 'כ־ת־ב', binyan: "pa'al", rootChecked: checked }).find((l) => l.id === 'root');
  assert.equal(root(true).label, 'Root');
  assert.equal(root(false).label, 'Family letters');
  assert.match(root(false).text, /Not yet checked/);
});

test('describe: verbs say who, endings say whose, names say what kind', () => {
  assert.match(describe({ s: 'VERB', t: 'past', r: '3', g: 'f', n: 'sg' }).find((l) => l.id === 'kind').text, /past, said of “she”/);
  assert.equal(describe({ s: 'NOUN', sf: { r: '3', g: 'm', n: 'sg' } }).find((l) => l.id === 'ending').text, 'The ending means “his”.');
  assert.equal(describe({ s: 'PROPN', e: 'GPE' }).find((l) => l.id === 'name').text, 'A place name.');
  assert.equal(describe({ l: 'שלום', s: 'NOUN' }).find((l) => l.id === 'form').text, 'Worked out from the sentence, not looked up. It may be wrong.');
  assert.equal(whoOf('2', 'f', 'sg'), 'you (to a woman)');
  assert.deepEqual(prefixParts('וכשה'), ['ו', 'כש', 'ה']);
});

test('describe: a word with nothing to say gets one honest line, never an empty card', () => {
  assert.deepEqual(describe({ l: null, p: '', s: 'X' }), [{ id: 'none', label: 'Notes', text: NOTHING }]);
  assert.deepEqual(lint(NOTHING), []);
});

test('every note that the built lesson data can produce passes the copy check', async () => {
  let notes = 0;
  for (const id of unitIds()) {
    const unit = await data(`morph/${id}.js`);
    for (const [key, bucket] of Object.entries(unit.words)) for (const a of bucket) {
      const entry = a.d ? unit.entries[a.d] : null;
      for (const line of describe(a, entry)) {
        // the English of a dictionary line is the app's own gloss, copied as it is; every other line is ours
        if (!(line.id === 'form' && entry)) assert.deepEqual(lint(line.text), [], `${id} ${key}: ${line.text}`);
        assert.deepEqual(lint(`${line.label}.`), [], line.label);
        notes++;
      }
      const note = lessonNote([{ shown: key, a, entry }]);
      if (note) assert.deepEqual(lint(note.text), [], note.text);
    }
  }
  assert.ok(notes > 5000, `only ${notes} notes checked`);
});
