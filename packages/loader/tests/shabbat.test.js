// Shabbat-safe mode, checked by faking the clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loaderUrl, memoryCaches, tableFetch, memoryStorage, miniPack, at } from './helpers.js';

const L = await import(loaderUrl);
const FRI_NOON = at('2026-11-13T12:00:00'), FRI_EVE = at('2026-11-13T18:00:00'), SAT_DAY = at('2026-11-14T11:00:00'), SAT_2059 = at('2026-11-14T20:59:00'), SAT_NIGHT = at('2026-11-14T21:00:00');

test('the fixed rule: Friday 18:00 to Saturday 21:00, local time', () => {
  L.setShabbatCheck(null);
  assert.equal(L.isShabbatSafeMode(FRI_NOON), false);
  assert.equal(L.isShabbatSafeMode(FRI_EVE), true);
  assert.equal(L.isShabbatSafeMode(SAT_DAY), true);
  assert.equal(L.isShabbatSafeMode(SAT_2059), true);
  assert.equal(L.isShabbatSafeMode(SAT_NIGHT), false);
});

test('the app\'s own check widens the fixed rule (early candle lighting, Yom Tov) and never narrows it', () => {
  const TUE = at('2026-11-10T12:00:00');
  L.setShabbatCheck((now) => now === TUE || now === FRI_NOON);
  assert.equal(L.isShabbatSafeMode(TUE), true, 'a Yom Tov on a Tuesday');
  assert.equal(L.isShabbatSafeMode(FRI_NOON), true);
  L.setShabbatCheck(() => false);
  assert.equal(L.isShabbatSafeMode(SAT_DAY), true, 'the fixed rule still holds');
  L.setShabbatCheck(() => { throw new Error('no city'); });
  assert.equal(L.isShabbatSafeMode(TUE), false);
  assert.equal(L.isShabbatSafeMode(SAT_DAY), true);
  L.setShabbatCheck(null);
});

test('while it is on: no notification, no torch, no download unless the learner started it', () => {
  for (const now of [FRI_EVE, SAT_DAY]) {
    assert.equal(L.allowed('notify', { now }), false);
    assert.equal(L.allowed('notify', { now, userStarted: true }), false);
    assert.equal(L.allowed('torch', { now, userStarted: true }), false);
    assert.equal(L.allowed('download', { now }), false);
    assert.equal(L.allowed('download', { now, userStarted: true }), true);
  }
  for (const a of ['notify', 'torch', 'download']) assert.equal(L.allowed(a, { now: SAT_NIGHT }), true);
  assert.throws(() => L.requireAllowed('torch', { now: SAT_DAY }), (e) => e.code === 'shabbat');
});

test('a download nobody started does not begin on Shabbat and fetches nothing; the same download started by hand works', async () => {
  const { table, base } = miniPack();
  const f = tableFetch(table);
  const e = { caches: memoryCaches(), storage: memoryStorage(), navigator: {}, origin: 'https://app.example', gpu: false, fetch: f, now: SAT_DAY, bases: [base] };
  await assert.rejects(L.downloadPack('words', e), (err) => err.code === 'shabbat');
  assert.equal(f.calls.filter((c) => !c.url.endsWith('pack.json')).length, 0);
  assert.equal((await L.downloadPack('words', { ...e, userStarted: true })).ready, true);
  // on a weekday the same background call is fine
  const e2 = { ...e, caches: memoryCaches(), now: at('2026-11-10T12:00:00') };
  assert.equal((await L.downloadPack('words', e2)).ready, true);
});
