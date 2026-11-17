import test from 'node:test';
import assert from 'node:assert/strict';
import { mod } from './helpers.js';
const { toMono, resample, trimSilence, splitLong, parseWav, wavToPcm, frameLevels, SAMPLE_RATE } = await mod('audio.js');

const tone = (hz, seconds, rate, amp = 0.5) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));
const rms = (x, from = 0, to = x.length) => { let s = 0; for (let i = from; i < to; i++) s += x[i] * x[i]; return Math.sqrt(s / (to - from)); };

test('toMono averages the channels', () => {
  assert.deepEqual([...toMono([Float32Array.of(1, 0), Float32Array.of(0, 1)])], [0.5, 0.5]);
  const one = Float32Array.of(0.25); assert.equal(toMono([one]), one);
});

test('resample 48 kHz to 16 kHz keeps a 440 Hz tone and its level', () => {
  const out = resample(tone(440, 1, 48000), 48000);
  assert.equal(out.length, SAMPLE_RATE);
  const want = tone(440, 1, 16000);
  let worst = 0; for (let i = 400; i < 15600; i++) worst = Math.max(worst, Math.abs(out[i] - want[i]));
  assert.ok(worst < 0.01, `worst sample error ${worst}`);
});

test('resample removes what the lower rate cannot carry', () => {
  const out = resample(tone(11000, 0.5, 48000), 48000); // above the new 8 kHz limit
  assert.ok(rms(out, 400, out.length - 400) < 0.01);
});

test('resample 44.1 kHz and 8 kHz give the right length; same rate is returned as is', () => {
  assert.equal(resample(new Float32Array(44100), 44100).length, 16000);
  assert.equal(resample(new Float32Array(8000), 8000).length, 16000);
  const x = new Float32Array(10); assert.equal(resample(x, 16000), x);
  assert.throws(() => resample(x, 0));
});

test('trimSilence finds speech between quiet parts and keeps a little room around it', () => {
  const pcm = new Float32Array(3 * SAMPLE_RATE);
  for (let i = 0; i < pcm.length; i++) pcm[i] = 0.001 * Math.sin(i); // a quiet room
  // a "word": a tone whose level rises and falls, from 1.0 s to 1.6 s
  for (let i = SAMPLE_RATE; i < 1.6 * SAMPLE_RATE; i++) pcm[i] += 0.3 * Math.sin((2 * Math.PI * 300 * i) / SAMPLE_RATE) * (0.6 + 0.4 * Math.sin((2 * Math.PI * 4 * i) / SAMPLE_RATE));
  const r = trimSilence(pcm);
  assert.equal(r.speech, true);
  assert.ok(r.start <= SAMPLE_RATE && r.start >= 0.7 * SAMPLE_RATE, `start ${r.start}`);
  assert.ok(r.end >= 1.6 * SAMPLE_RATE && r.end <= 1.9 * SAMPLE_RATE, `end ${r.end}`);
  assert.equal(r.pcm.length, r.end - r.start);
  assert.ok(r.speechMs >= 500 && r.speechMs <= 700);
});

test('trimSilence: silence, a steady hum and a single click are not speech', () => {
  assert.equal(trimSilence(new Float32Array(SAMPLE_RATE)).speech, false);
  assert.equal(trimSilence(tone(100, 2, SAMPLE_RATE, 0.05)).speech, false);
  const click = new Float32Array(SAMPLE_RATE); for (let i = 8000; i < 8100; i++) click[i] = 0.9;
  assert.equal(trimSilence(click).speech, false);
  assert.equal(trimSilence(new Float32Array(0)).speech, false);
});

test('trimSilence works on a very quiet microphone', () => {
  const pcm = new Float32Array(2 * SAMPLE_RATE);
  for (let i = 0; i < pcm.length; i++) pcm[i] = 0.00005 * Math.sin(i * 1.7);
  for (let i = 8000; i < 20000; i++) pcm[i] += 0.003 * Math.sin((2 * Math.PI * 250 * i) / SAMPLE_RATE);
  assert.equal(trimSilence(pcm).speech, true);
});

test('trimSilence keeps a take that is speech from start to end', () => {
  // level rising and falling several times a second, no quiet part
  const pcm = Float32Array.from({ length: 2 * SAMPLE_RATE }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) * (0.7 + 0.3 * Math.sin((2 * Math.PI * 5 * i) / SAMPLE_RATE)));
  const r = trimSilence(pcm);
  assert.equal(r.speech, true); assert.equal(r.pcm.length, pcm.length);
});

test('splitLong cuts at a quiet moment and loses nothing', () => {
  const pcm = tone(200, 70, SAMPLE_RATE, 0.3);
  for (let i = 25 * SAMPLE_RATE; i < 25.5 * SAMPLE_RATE; i++) pcm[i] = 0; // a pause at 25 s
  const parts = splitLong(pcm, 28);
  assert.ok(parts.every((p) => p.length <= 28 * SAMPLE_RATE));
  assert.equal(parts.reduce((a, p) => a + p.length, 0), pcm.length);
  assert.ok(Math.abs(parts[0].length / SAMPLE_RATE - 25.25) < 0.3, `first cut at ${parts[0].length / SAMPLE_RATE}`);
  assert.equal(splitLong(new Float32Array(100)).length, 1);
});

function wav16(samples, rate, channels = 1) {
  const n = samples.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2 * channels, 28); b.writeUInt16LE(2 * channels, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  samples.forEach((s, i) => b.writeInt16LE(Math.round(s * 32767), 44 + i * 2));
  return new Uint8Array(b);
}

test('parseWav reads 16-bit files, mono and stereo; wavToPcm gives 16 kHz mono', () => {
  const w = parseWav(wav16([0, 0.5, -0.5, 0.25], 8000));
  assert.equal(w.rate, 8000); assert.equal(w.channels.length, 1);
  assert.ok(Math.abs(w.channels[0][1] - 0.5) < 1e-3);
  const st = parseWav(wav16([0.5, -0.5, 0.25, -0.25], 16000, 2));
  assert.equal(st.channels.length, 2); assert.ok(Math.abs(st.channels[1][0] + 0.5) < 1e-3);
  assert.equal(wavToPcm(wav16(new Array(8000).fill(0), 8000)).length, 16000);
  assert.throws(() => parseWav(new Uint8Array(64)), /not a WAV/);
});

test('frameLevels', () => {
  const lv = frameLevels(Float32Array.of(1, 1, 0, 0, 3), 2);
  assert.deepEqual([...lv], [1, 0]);
});
