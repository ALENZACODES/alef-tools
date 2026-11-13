# alef-tools ⇄ ALEF integration contract

Contract version: **1** (2026-11-12). Owner: Lane 7.
Lanes 1–6 build on this file. Changes after today are additive only; a breaking
change gets a new contract version and a note at the bottom.

alef-tools holds all model code. The app (ALENZACODES/Al-Heb, a zero-dependency
static PWA) pulls in a fixed version of what is built here. Nothing runs on a
server.

## 1. Repo layout

```
packages/<name>/
  src/        ES modules, no bundler, no runtime dependencies
  scripts/    Python/Node conversion and offline builds (pinned requirements.txt)
  tests/      node --test (and pytest for Python)
  dist/       built static output: ES modules + JSON + dist.json (committed)
  package.json   name "@alef-tools/<name>", version, "alef" block (see 3)
  README.md   what it is, size, licence, how to rebuild
scripts/      shared: build-dist.mjs, check-manifest.mjs, check-budgets.mjs,
              sha256-parts.mjs, pin-revisions.mjs, release.mjs, convert-common.py
models.manifest.json (+ models.manifest.schema.json)
docs/         CONTRACT.md, LICENCES.md, sources.md, QA reports
```

Package folders: `loader` (Lane 7), `translate` (1), `speech` (2), `nikud` (3),
`morph` (4), `offline-llm` (5), `handwriting` and `ocr-fix` (6).

Branches: `claude/hf-<lane>-2026-11-12`. Until Lane 7's branch is merged, branch
from `claude/hf-loader-2026-11-12` and say so in the PR. Never force-push.

## 2. What a package exports

`packages/<name>/dist/index.js` is an ES module that exports:

```js
export const id = 'words';            // package id, same as the folder name
export const version = '0.1.0';       // same as package.json
export const packs = ['words'];       // names of the language packs it can use ([] for build-time-only packages)
export async function load(opts) {}   // returns the package's working API; resolves only when usable
export async function unload() {}     // frees workers, sessions and memory; safe to call twice
```

`load(opts)` receives:

| field | what |
|---|---|
| `opts.loader` | the shared loader module (section 5); never import a second copy |
| `opts.pack` | pack name to use, when the package has more than one |
| `opts.ortBase` | URL of the app's vendored onnxruntime-web folder (`assets/vendor/_ort/`) |
| `opts.signal` | optional `AbortSignal` |
| `opts.onProgress(have, total)` | optional, bytes |

Rules for `load`:

- It must **not** start a download. If the pack is not on the device it rejects
  with a `PackError` whose `code` is `not-downloaded`. Downloads start only from
  `loader.downloadPack(...)`, which the app calls on the learner's tap.
- Heavy work runs in a worker (`loader.createWorkerHost`), not on the page.
- WebGPU first when the device has a real adapter, WebAssembly otherwise
  (`loader.runWithFallback`). The learner is never asked which.
- No network request to anywhere except the site itself and the pack host.
- `dist/` has no runtime dependencies and needs no bundler. A package that needs
  transformers.js vendors a pinned build inside its own `dist/vendor/` and lists
  the licence in its README.

Every `dist/` carries a `dist.json` written by `scripts/build-dist.mjs`:

```json
{ "schema": "alef.dist.v1", "name": "loader", "version": "0.1.0",
  "files": [ { "path": "index.js", "bytes": 1234, "sha256": "…" } ] }
```

## 3. First-install budget

The app's first install must stay under 3.95 MiB. Vendored alef-tools files are
**never** in the first install: the app's precache builder skips
`assets/vendor/`. They are fetched the first time a screen needs them and kept
by the service worker after that.

If a lane truly needs code in the first install, it names the files in its
`package.json`:

```json
"alef": { "firstInstall": ["dist/tiny-hook.js"] }
```

`scripts/check-budgets.mjs` gzips every file named this way and fails CI when
the loader's share is over **10 KiB** or the total across all packages is over
**40 KiB**. The default, and the right answer for almost everything, is an empty
list. Code a lane adds inside Al-Heb itself (a route entry, a button) counts
too: state its gzipped bytes in the Al-Heb PR.

No model weights ever go in the first install or in git.

## 4. Language packs

A language pack is a set of files (model weights, vocabularies, small graphs)
the learner chooses to download.

### 4.1 Pack list (`alef.pack.v1`)

Each pack has one `pack.json`, served next to its parts:

```json
{
  "schema": "alef.pack.v1",
  "pack": "words",
  "version": "1",
  "files": [
    { "name": "model.int8.onnx", "bytes": 48100000, "sha256": "…",
      "parts": [
        { "path": "model.int8.onnx.p000", "bytes": 16777216, "sha256": "…" },
        { "path": "model.int8.onnx.p001", "bytes": 16777216, "sha256": "…" }
      ] },
    { "name": "encoder.gpu.onnx", "variant": "webgpu", "bytes": 120000, "sha256": "…",
      "parts": [ { "path": "encoder.gpu.onnx.p000", "bytes": 120000, "sha256": "…" } ] }
  ]
}
```

- Every part is **at most 16 MiB** (16,777,216 bytes) and carries its own size
  and SHA-256. `scripts/sha256-parts.mjs <file> --out <dir>` splits a file and
  prints the entry.
- `path` is relative to the folder that holds `pack.json`.
- `variant` is optional: `"webgpu"` files are fetched only on a device with a
  real graphics adapter, `"wasm"` files only without one, files with no variant
  always.
- `version` changes whenever any file changes. Old parts are pruned after a
  successful download of the new version.
- Strip producer, tool and author notes from every file (ONNX `producer_name`,
  `doc_string`, metadata props). `scripts/convert-common.py` has a helper.

The existing Talk translation packs keep their older list format
(`alef.talk.nmt.manifest.v1`) and their cache name. The app maps them onto the
same loader; nobody has to download them again.

### 4.2 Where packs live

Tried in this order:

1. the site itself: `assets/vendor/_packs/<pack>/pack.json` (only if a deploy
   chooses to carry a pack);
2. the static pack host: `https://alenzacodes.github.io/alef-packs/<pack>/pack.json`.

Large files never go in git history of this repo or of Al-Heb. A release of
alef-tools attaches the parts as release assets (the archive copy); the pack
host serves them to browsers. Release assets cannot be read by a browser from
another site, so the manifest `url` for anything the app fetches must point at
the pack host.

The pack host must send `Access-Control-Allow-Origin: *` (GitHub Pages does).
Only data comes from the pack host. Code always comes from the site itself.

### 4.3 Cache

One Cache Storage cache per pack: **`alef-pack-<name>-v1`**. Each kept response
has the header `x-alef-sha256`; a part counts as kept only when that header
matches the list. The shared onnxruntime-web WebAssembly lives with the Talk
packs today (`alef-talk-pack-v1`) and stays there.

Workers read parts straight from Cache Storage with `loader.readFile(...)`.

### 4.4 What the learner sees before a download

Name in plain words, what it does, the size in MB, and a Wi-Fi line on a mobile
connection. Then one tap. The loader refuses to start when:

| `PackError.code` | when |
|---|---|
| `shabbat` | Shabbat-safe mode is on and the download was not started by the learner |
| `wifi-only` | "Only on Wi-Fi" is on and the browser reports a mobile or data-saver connection |
| `too-full` | the browser reports too little free space |
| `over-limit` | the learner's own storage limit for packs would be passed |
| `cannot-run` | the pack needs a graphics adapter or more memory than the device reports |
| `no-storage` | the browser has no Cache Storage |

During a download: `fetch`, `size-mismatch`, `hash-mismatch`, `quota`,
`part-too-large`, `aborted`. A part that fails its check is not kept. Calling
download again resumes: kept parts are skipped.

## 5. The shared loader (`packages/loader`)

`import * as loader from '<vendored>/loader@<version>/index.js'`. Environment
objects (`fetch`, `caches`, `navigator`, `crypto.subtle`, storage) can all be
passed in, so everything runs under `node --test`.

| export | what |
|---|---|
| `CONTRACT`, `VERSION` | `1`, package version |
| `MAX_PART_BYTES` | 16 MiB |
| `cacheName(pack)` | `alef-pack-<pack>-v1` |
| `expandPack(list, {base, gpu})` | pack list → flat `[{name,key,url,bytes,sha256}]` |
| `fetchPackList(pack, {bases, …})` | reads `pack.json` from the first base that has it; offline, the saved copy |
| `filesState(files, {cacheName})` | `{ready, have, total, missing}` in bytes |
| `planDownload(files, opts)` | size to fetch plus the reasons it may not start (section 4.4) |
| `downloadFiles(files, opts)` | fetches missing parts, checks each, keeps them; resumable |
| `downloadPack(pack, opts)` | list + plan + download for an `alef.pack.v1` pack |
| `removePack(pack)`, `removeFiles(files, {cacheName})` | delete from the device |
| `readFile(cacheName, parts)` | joined bytes of one logical file |
| `listPacks()` | packs on the device with their bytes |
| `storageReport()` | bytes used by packs, the browser's estimate, the learner's limit |
| `getLimit()/setLimit()`, `getWifiOnly()/setWifiOnly()` | learner settings (localStorage) |
| `askPersistOnce()` | calls `navigator.storage.persist()` at most once per device |
| `hasGraphics()`, `connectionKind()`, `ramGB()`, `canRun(device)` | device checks |
| `runWithFallback({gpu, webgpu, wasm})` | tries WebGPU, falls back to WebAssembly |
| `isShabbatSafeMode(now)`, `setShabbatCheck(fn)`, `allowed(action, opts)` | section 6 |
| `createWorkerHost(opts)`, `serveWorker(handlers)` | request/answer over a worker |
| `definePackage(pkg)` | checks the shape in section 2 |
| `PackError` | `Error` with `.code` |

## 6. Shabbat-safe mode

`loader.isShabbatSafeMode(now = Date.now())` is the one check every lane uses.
The app registers its own Shabbat and Yom Tov logic at start-up with
`loader.setShabbatCheck(fn)` (candle lighting to havdalah when a city is set,
plus the fixed Friday 18:00 to Saturday 21:00 rule). Without a registered check
the loader uses the fixed rule alone.

While it is on:

- no download starts unless the learner started it (`{ userStarted: true }`);
- no notification is shown;
- the torch is never switched on;
- everything the learner starts by hand still works.

Use `loader.allowed('download' | 'notify' | 'torch', { userStarted })` before
any of the three. Do not write a second Shabbat check.

## 7. The manifest (`models.manifest.json`)

One entry per model, whatever its tier:

```json
{ "id": "dicta-il/dictabert-tiny-joint", "hubRevision": "<40-hex commit>",
  "licence": "CC-BY-4.0", "licenceUrl": "https://…", "tier": "D",
  "reason": "word taps: lemma, root hint, prefixes",
  "pack": "words",
  "files": [ { "name": "…", "bytes": 0, "sha256": "…", "url": "https://…" } ],
  "budgetBytes": 52428800,
  "device": { "webgpu": false, "minRamGB": 0 },
  "attribution": "DictaBERT-tiny-joint by Dicta (CC BY 4.0)" }
```

- `tier`: **D** on the device (opt-in pack) · **B** offline build time only ·
  **Q** internal checks only, never ships · **X** dropped.
- `hubRevision` is the full commit SHA on the Hub. Required for D and B.
  `node scripts/pin-revisions.mjs` re-reads every revision and licence tag from
  the Hub and reports drift.
- `files` lists what the app fetches (parts on the pack host) with bytes and
  SHA-256. It stays empty until the lane has converted and published the pack.
- Non-commercial or unclear licence → tier X or Q, with the reason recorded.
- CC-BY models need `attribution`; the app prints it on its credits page.
- The top-level `packs` table gives each pack its plain-words name, what it
  does, its size budget and device needs. A pack with `"published": false` is
  not offered to learners.

CI checks the file against `models.manifest.schema.json` and fails when a
pack's files add up to more than its `budgetBytes`.

## 8. How Al-Heb consumes alef-tools

- `data/alef-tools.lock.json` pins one alef-tools commit (or tag) and lists
  every vendored file with its SHA-256.
- `node tools/alef-tools/sync.mjs` reads the pinned commit, copies each
  `packages/<pkg>/dist` into `assets/vendor/_alef-tools/<pkg>@<version>/`,
  checks every SHA-256 against `dist.json`, and rewrites the lock.
  `--from <folder>` uses a local checkout instead of the network.
  `--check` verifies the vendored files against the lock without any network
  (CI runs this).
- The vendored files are committed in Al-Heb, like its other vendored code,
  because the host publishes the repo as it is.
- `src/settings/alef-tools.generated.js` (written by sync) maps package id → folder, so
  no screen hard-codes a version.
- `data/packs/catalog.json` (written by sync from the manifest's `packs` table)
  is what the Language packs page reads.
- Weights are fetched lazily on the learner's tap from the site or the pack
  host. The site's Content-Security-Policy allows `connect-src` to the pack
  host and nothing else outside the site.
- To add a lane to the app: bump the lock to a commit that has the lane's
  `dist/`, run sync, wire the feature behind a lazy import, state the gzipped
  first-install bytes.

## 9. Rules every lane obeys (John's)

1. Static hosting only. No server, no hosted inference on the learner's path.
2. Big models only offline at build time; nothing they write ships without a
   test gate and a human-review list.
3. First install under 3.95 MiB; weights lazy, size shown first, parts ≤ 16 MiB
   with SHA-256, own cache, deletable in Settings.
4. Licence and pinned revision recorded per model. Non-commercial or unclear →
   not shipped.
5. The divine Name is shown as ה׳ and never voiced or phoneme-played.
   Ask the Torah stays quote-and-cite.
6. No AI wording in anything a learner reads. Say "on this device",
   "language pack", "checked".
7. Shabbat-safe (section 6).
8. Strip metadata from media and model files. The cast is frozen. No synthetic
   voices ship.
9. Never force-push. Open PRs; John merges.
10. Never change a repo's visibility.
