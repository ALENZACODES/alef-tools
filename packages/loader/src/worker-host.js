// @ts-check
// Request and answer over a worker, so model work stays off the page. The page side is createWorkerHost; the worker side is serveWorker.
import { PackError } from './errors.js';

/**
 * @param {{url:string|URL, WorkerCtor?:any, type?:'module'|'classic', timeoutMs?:number, onCrash?:()=>void}} cfg
 */
export function createWorkerHost(cfg) {
  /** @type {any} */ let worker = null;
  let seq = 0;
  /** @type {Map<number, {resolve:(v:any)=>void, reject:(e:any)=>void, timer:any}>} */
  const waiting = new Map();
  const failAll = (code) => { for (const w of waiting.values()) { clearTimeout(w.timer); w.reject(new PackError(code)); } waiting.clear(); };

  function start() {
    if (worker) return worker;
    const Ctor = cfg.WorkerCtor || /** @type {any} */ (globalThis).Worker;
    if (!Ctor) throw new PackError('no-worker');
    worker = new Ctor(cfg.url, { type: cfg.type || 'module' });
    worker.onmessage = (event) => {
      const m = event.data || {}; const w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id); clearTimeout(w.timer);
      if (m.ok) w.resolve(m); else w.reject(new PackError(m.code || 'failed', m.error || ''));
    };
    worker.onerror = () => { failAll('worker-error'); try { worker.terminate(); } catch { /* gone */ } worker = null; cfg.onCrash?.(); };
    return worker;
  }

  return {
    /** Sends one message and resolves with the worker's answer. @param {Record<string, any>} msg @param {any[]} [transfer] */
    ask(msg, transfer = []) {
      return new Promise((resolve, reject) => {
        const id = ++seq;
        const timer = cfg.timeoutMs ? setTimeout(() => { if (waiting.delete(id)) reject(new PackError('timeout')); }, cfg.timeoutMs) : null;
        waiting.set(id, { resolve, reject, timer });
        try { start().postMessage({ ...msg, id }, transfer); } catch (e) { waiting.delete(id); clearTimeout(timer); reject(e); }
      });
    },
    get alive() { return !!worker; },
    /** Stops the worker and rejects anything still waiting. Safe to call twice. */
    stop() { try { worker?.terminate(); } catch { /* gone */ } worker = null; failAll('stopped'); },
  };
}

/**
 * Worker side: `handlers[msg.type](msg)` answers each message; what it returns is sent back with `ok: true`.
 * A thrown error is sent back with its code, never rethrown. @param {Record<string, (msg:any)=>any>} handlers @param {any} [scope]
 */
export function serveWorker(handlers, scope = /** @type {any} */ (globalThis)) {
  scope.onmessage = async (event) => {
    const m = event.data || {};
    try {
      const fn = handlers[m.type];
      if (!fn) throw new PackError('unknown-message', String(m.type));
      const { transfer = [], ...out } = (await fn(m)) || {};
      scope.postMessage({ ...out, id: m.id, ok: true }, transfer);
    } catch (e) {
      const any = /** @type {any} */ (e);
      scope.postMessage({ id: m.id, ok: false, code: any?.code || 'failed', error: String(any?.message || e) });
    }
  };
}
