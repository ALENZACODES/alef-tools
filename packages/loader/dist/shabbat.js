import { PackError } from './errors.js';
let appCheck = null;
export function fixedShabbatWindow(now) {
 const d = new Date(now), day = d.getDay(), min = d.getHours() * 60 + d.getMinutes();
 return (day === 5 && min >= 18 * 60) || (day === 6 && min < 21 * 60);
}
export function setShabbatCheck(fn) { appCheck = typeof fn === 'function' ? fn : null; }
export function isShabbatSafeMode(now = Date.now()) {
 if (fixedShabbatWindow(now)) return true;
 if (!appCheck) return false;
 try { return !!appCheck(now); } catch { return false; }
}
export function allowed(action, opts = {}) {
 if (!isShabbatSafeMode(opts.now ?? Date.now())) return true;
 return action === 'download' && opts.userStarted === true;
}
export function requireAllowed(action, opts = {}) { if (!allowed(action, opts)) throw new PackError('shabbat', action); }
