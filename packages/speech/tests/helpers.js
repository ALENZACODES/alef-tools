// Tests run against src/ by default and against the built dist/ with ALEF_TEST_DIST=1 (CI runs both).
const DIST = !!process.env.ALEF_TEST_DIST;
export const BASE = new URL(DIST ? '../dist/' : '../src/', import.meta.url);
/** One module of this package, from src/ or dist/. @param {string} file */
export const mod = (file) => import(new URL(file, BASE).href);
/** The shared loader, the same way. */
export const loaderUrl = new URL(DIST ? '../../loader/dist/index.js' : '../../loader/src/index.js', import.meta.url).href;
export { sha, memoryCaches, tableFetch } from '../../loader/tests/helpers.js';
