#!/usr/bin/env node
// Adds the sound line to every unit file in a folder, from the marked text the build left in each line.
//   node scripts/add_sounds.mjs dist/nikud
// The marked text (phonikud's stress, sounded-shva and prefix marks) is turned into sounds by src/phonikud.js, the same code
// the browser runs, and is then dropped from the file.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { soundLine } from '../src/phonikud.js';
import { guardName } from '../src/hebrew.js';

const dir = process.argv[2];
let lines = 0, withSounds = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'index.json')) {
  const doc = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  for (const l of doc.lines) {
    lines++;
    const marked = l._marked; delete l._marked;
    if (!marked || guardName(l.t).found) { l.ph = null; continue; }
    l.ph = soundLine(marked).phonemes || null;
    if (l.ph) withSounds++;
  }
  writeFileSync(join(dir, f), JSON.stringify(doc));
}
console.log(`sound lines: ${withSounds} of ${lines}`);
