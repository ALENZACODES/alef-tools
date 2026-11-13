// Tests run against src/ by default and against the built dist/ with ALEF_TEST_DIST=1 (CI runs both).
export const base = new URL(process.env.ALEF_TEST_DIST ? '../dist/' : '../src/', import.meta.url).href;
export const mod = (name) => import(base + name);
