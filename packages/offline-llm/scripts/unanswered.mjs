#!/usr/bin/env node
// Keep only the seed questions the app cannot answer yet, using the app's own matcher (Al-Heb src/ask/match.js).
//   node scripts/unanswered.mjs --app ../Al-Heb --in prompts/ask_seeds.json --out work/ask_seeds.todo.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = (n) => process.argv[process.argv.indexOf('--' + n) + 1];
const app = resolve(arg('app'));
const { buildIndex, buildTopics, lookup } = await import(pathToFileURL(resolve(app, 'src/ask/match.js')).href);
const bank = JSON.parse(readFileSync(resolve(app, 'data/ask/bank.json'), 'utf8'));
const topics = JSON.parse(readFileSync(resolve(app, 'data/ask/topics.json'), 'utf8'));
const c = { ix: buildIndex(bank.questions), topicIx: buildTopics(topics.topics), rw: topics.rewrite };
const seeds = JSON.parse(readFileSync(arg('in'), 'utf8'));
const todo = seeds.filter((s) => !lookup(c, s.q));
mkdirSync(dirname(arg('out')), { recursive: true });
writeFileSync(arg('out'), JSON.stringify(todo, null, 1) + '\n');
console.log(`unanswered: ${todo.length} of ${seeds.length} seed questions have no checked answer in the app yet`);
