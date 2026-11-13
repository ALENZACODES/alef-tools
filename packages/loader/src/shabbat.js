// @ts-check
// Shabbat-safe mode: the one check every lane uses (docs/CONTRACT.md, section 6).
// The app registers its own Shabbat and Yom Tov logic with setShabbatCheck(). Without one, the fixed rule below is used.
import { PackError } from './errors.js';

/** @type {((now:number)=>boolean)|null} */
let appCheck = null;

/** Friday 18:00 to Saturday 21:00, local time: the app's fixed owner rule. @param {number} now */
export function fixedShabbatWindow(now) {
  const d = new Date(now), day = d.getDay(), min = d.getHours() * 60 + d.getMinutes();
  return (day === 5 && min >= 18 * 60) || (day === 6 && min < 21 * 60);
}

/** The app hands over its own check (Shabbat and Yom Tov, by the learner's city when set). Pass null to clear it. */
export function setShabbatCheck(fn) { appCheck = typeof fn === 'function' ? fn : null; }

/** True on Shabbat or Yom Tov. If the app's check throws, the fixed rule answers; the wider of the two always wins. */
export function isShabbatSafeMode(now = Date.now()) {
  if (fixedShabbatWindow(now)) return true;
  if (!appCheck) return false;
  try { return !!appCheck(now); } catch { return false; }
}

/**
 * May this start now? Downloads only when the learner started them; notifications and the torch never, while the mode is on.
 * @param {'download'|'notify'|'torch'} action @param {{userStarted?:boolean, now?:number}} [opts]
 */
export function allowed(action, opts = {}) {
  if (!isShabbatSafeMode(opts.now ?? Date.now())) return true;
  return action === 'download' && opts.userStarted === true;
}

/** Throws PackError('shabbat') when `allowed` says no. */
export function requireAllowed(action, opts = {}) { if (!allowed(action, opts)) throw new PackError('shabbat', action); }
