# packages/loader

The shared language pack loader and cache manager. Every lane uses this one copy.

**What it does**

- downloads a pack only when asked, part by part (16 MiB at most), checks each part's size and SHA-256, and keeps it in the
  pack's own cache (`alef-pack-<name>-v1`);
- resumes after a break: parts already kept are skipped;
- says before a download how much it will fetch and whether anything stands in the way (too little space, the learner's own
  storage limit, "Only on Wi-Fi", a device that cannot run the pack, Shabbat-safe mode);
- picks WebGPU when the device has a real graphics adapter and falls back to WebAssembly;
- reports storage use per pack and asks the browser to keep the storage, once;
- exposes `isShabbatSafeMode()`, the one Shabbat check for every lane;
- gives workers a small request/answer host.

The full list of exports is in [`docs/CONTRACT.md`](../../docs/CONTRACT.md), section 5.

**Size.** `dist/` is 9 small ES modules, about 20 KB, 5.8 KiB gzipped. None of it is in the app's first install: the app
loads it the first time a screen needs it.

**Licence.** MIT. No model weights, no dependencies.

**Rebuild and test**

```
node scripts/build-dist.mjs                      # from the repo root: src/ -> dist/
node --test "packages/loader/tests/*.test.js"   # against src/
ALEF_TEST_DIST=1 node --test "packages/loader/tests/*.test.js"   # against dist/
```

`src/` keeps every template string on one line: the dist builder strips whole-line comments and would otherwise eat a
line that only looks like one.
