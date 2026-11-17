#!/usr/bin/env node
// stdin: one string per line -> stdout: the same lines in full spelling (src/plene.js). Used by the Python builds so
// there is one implementation of the spelling rules, the one the browser runs.
import { plene } from '../src/plene.js';
let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { data += d; });
process.stdin.on('end', () => { process.stdout.write(data.split('\n').map((l) => plene(l)).join('\n')); });
