// Graphics-card check, the fall back to WebAssembly, the worker host and the package shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loaderUrl } from './helpers.js';

const L = await import(loaderUrl);

test('hasGraphics: a real adapter counts, a software stand-in or none does not', async () => {
  assert.equal(await L.hasGraphics({ navigator: {} }), false);
  assert.equal(await L.hasGraphics({ navigator: { gpu: { requestAdapter: async () => null } } }), false);
  assert.equal(await L.hasGraphics({ navigator: { gpu: { requestAdapter: async () => ({ info: { description: 'Apple M2' } }) } } }), true);
  assert.equal(await L.hasGraphics({ navigator: { gpu: { requestAdapter: async () => ({ info: { description: 'SwiftShader' } }) } } }), false);
  assert.equal(await L.hasGraphics({ navigator: { gpu: { requestAdapter: async () => ({ isFallbackAdapter: true }) } } }), false);
  assert.equal(await L.hasGraphics({ force: true, navigator: { gpu: { requestAdapter: async () => ({ isFallbackAdapter: true }) } } }), true);
  assert.equal(await L.hasGraphics({ navigator: { gpu: { requestAdapter: async () => { throw new Error('denied'); } } } }), false);
});

test('WebGPU first; WebAssembly when there is no graphics card or the graphics card fails', async () => {
  const calls = [];
  const wasm = async () => { calls.push('wasm'); return 'w'; };
  assert.deepEqual(await L.runWithFallback({ gpu: true, webgpu: async () => { calls.push('gpu'); return 'g'; }, wasm }), { backend: 'webgpu', value: 'g' });
  assert.deepEqual(await L.runWithFallback({ gpu: false, webgpu: async () => 'g', wasm }), { backend: 'wasm', value: 'w' });
  let why = null;
  assert.deepEqual(await L.runWithFallback({ gpu: true, webgpu: async () => { throw new Error('lost device'); }, wasm, onFallback: (e) => { why = e.message; } }), { backend: 'wasm', value: 'w' });
  assert.equal(why, 'lost device');
  assert.deepEqual(calls, ['gpu', 'wasm', 'wasm']);
  await assert.rejects(L.runWithFallback({ gpu: false, wasm: async () => { throw new Error('no wasm'); } }), /no wasm/);
});

test('worker host: answers match their questions, errors carry their code, a crash rejects what is waiting', async () => {
  // a worker stand-in that runs serveWorker in the same thread
  class FakeWorker {
    constructor() { this.scope = { postMessage: (m) => queueMicrotask(() => this.onmessage?.({ data: m })) }; L.serveWorker({ echo: (m) => ({ text: m.text.toUpperCase() }), boom: () => { throw new L.PackError('not-downloaded', 'x'); }, hang: () => new Promise(() => {}) }, this.scope); }
    postMessage(m) { queueMicrotask(() => this.scope.onmessage({ data: m })); }
    terminate() { this.dead = true; }
  }
  let crashed = 0;
  const host = L.createWorkerHost({ url: 'x', WorkerCtor: FakeWorker, onCrash: () => crashed++ });
  const [a, b] = await Promise.all([host.ask({ type: 'echo', text: 'a' }), host.ask({ type: 'echo', text: 'b' })]);
  assert.equal(a.text, 'A'); assert.equal(b.text, 'B');
  await assert.rejects(host.ask({ type: 'boom' }), (e) => e.code === 'not-downloaded');
  await assert.rejects(host.ask({ type: 'nope' }), (e) => e.code === 'unknown-message');
  const waiting = host.ask({ type: 'hang' });
  host.stop();
  await assert.rejects(waiting, (e) => e.code === 'stopped');
  assert.equal(host.alive, false);
  const slow = L.createWorkerHost({ url: 'x', WorkerCtor: FakeWorker, timeoutMs: 5 });
  await assert.rejects(slow.ask({ type: 'hang' }), (e) => e.code === 'timeout');
  slow.stop();
  await assert.rejects(L.createWorkerHost({ url: 'x', WorkerCtor: null }).ask({ type: 'echo' }), (e) => e.code === 'no-worker', 'no Worker in this environment');
});

test('definePackage accepts the contract shape and refuses anything else', () => {
  const ok = L.definePackage({ id: 'words', version: '0.1.0', packs: ['words'], load: async () => ({}), unload: async () => {} });
  assert.ok(Object.isFrozen(ok));
  for (const bad of [{}, { id: 'Words', version: '0.1.0', packs: [], load() {}, unload() {} }, { id: 'words', version: '1', packs: [], load() {}, unload() {} }, { id: 'words', version: '0.1.0', packs: 'words', load() {}, unload() {} }, { id: 'words', version: '0.1.0', packs: [] }]) assert.throws(() => L.definePackage(bad), TypeError);
  // the loader itself has the same shape
  assert.doesNotThrow(() => L.definePackage({ id: L.id, version: L.version, packs: L.packs, load: L.load, unload: L.unload }));
});
