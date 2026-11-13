import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
export const PKG = new URL('../', import.meta.url);
/** Tests run against src/ by default and against the built dist/ with ALEF_TEST_DIST=1 (CI runs both). */
export const CODE = process.env.ALEF_TEST_DIST ? 'dist/' : 'src/';
/** A module of the package, from src/ or dist/. */
export const lib = (name) => import(new URL(`${CODE}${name}`, PKG).href);
export const json = (rel) => JSON.parse(readFileSync(new URL(rel, PKG), 'utf8'));
export const vocabText = () => gunzipSync(readFileSync(new URL('tests/fixtures/pack/vocab.txt.gz', PKG))).toString('utf8');
/** Unit ids that have a notes module. */
export const unitIds = () => readdirSync(new URL(`${CODE}data/morph/`, PKG)).filter((n) => n.endsWith('.js') && n !== 'units.js' && n !== 'roots.js').map((n) => n.slice(0, -3)).sort();
/** One built data module's default export. */
export const data = async (rel) => (await lib(`data/${rel}`)).default;
