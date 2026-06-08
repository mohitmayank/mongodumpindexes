# MongoDB Index Dump/Restore CLI — Design Spec

**Date:** 2026-06-08
**Status:** Approved (design gate passed)

## 1. Problem & Goal

Provide two installable CLI utilities to back up and restore MongoDB **indexes only**
(not data):

- `mongodumpindexes <uri> <file>` — read all index definitions from a DB, write them to a JSON file.
- `mongorestoreindexes <uri> <file>` — recreate those indexes on a (possibly different) DB.

Must be runnable as global shell commands (`npm i -g`) **and** via `npx mongodumpindexes` /
`npx mongorestoreindexes` directly. Pure Node — no `mongosh` dependency.

Supersedes the prior implementation: `exportMongoIndexes.sh` (mongosh shell) +
`mongoIndexRestore/` (Node restore). Both are removed; their logic is absorbed into the
shared core.

## 2. Architecture

npm **workspaces** monorepo, plain JS ESM, **no build step**. Three published packages:

```
mongodumpindexes/                  repo root (private workspace root, not published)
├── package.json                   { "private": true, "workspaces": ["packages/*"] }
├── .gitignore                     + .absolute-work/
├── README.md                      rewritten for the two commands
├── docs/plans/…                   this spec
└── packages/
    ├── core/                      mongo-indexes-core  (shared logic, published)
    │   ├── package.json
    │   ├── src/
    │   │   ├── mongo.js           connect(uri): validate DB, return {client, db}
    │   │   ├── normalize.js       normalizeIndex(): strip server fields, rebuild text key
    │   │   ├── dump.js            dumpIndexes()
    │   │   ├── restore.js         restoreIndexes()
    │   │   └── index.js           re-exports dumpIndexes, restoreIndexes, normalizeIndex
    │   └── test/
    │       ├── normalize.test.js
    │       ├── dump.test.js
    │       ├── restore.test.js
    │       └── roundtrip.test.js
    ├── dump/                      mongodumpindexes (published)
    │   ├── package.json           bin: { "mongodumpindexes": "bin/cli.js" }
    │   └── bin/cli.js
    └── restore/                   mongorestoreindexes (published)
        ├── package.json           bin: { "mongorestoreindexes": "bin/cli.js" }
        └── bin/cli.js
```

The two bin packages are **thin wrappers**: parse args with `commander`, call into
`mongo-indexes-core`, print a summary, set exit code. All real logic lives in core so it is
tested once.

### Dependencies
- `mongo-indexes-core`: `mongodb@^6`
- `mongodumpindexes`: `commander@^11`, `mongo-indexes-core@^0.1.0`
- `mongorestoreindexes`: `commander@^11`, `mongo-indexes-core@^0.1.0`
- root devDeps: `mongodb-memory-server` (integration tests)

> The bins pin core via `^0.1.0` (not `@*`, which would drift to whatever is latest at
> install time). npm workspaces symlinks the local core during dev; at publish time the
> caret range resolves to the published core. Publishing order is core → dump/restore, and a
> release bumps all three in lockstep so the range always has a satisfying published version.

## 3. Data Format

A single pretty-printed JSON **array** on disk. Each element = one collection's indexes.

```json
[
  {
    "collection": "users",
    "indexes": [
      { "key": { "email": 1 }, "name": "email_1", "unique": true },
      { "key": { "createdAt": -1 }, "name": "createdAt_-1" }
    ]
  },
  {
    "collection": "orders",
    "indexes": [
      { "key": { "userId": 1, "status": 1 }, "name": "userId_1_status_1" }
    ]
  }
]
```

- The auto `_id_` index is **always excluded** on dump (cannot be recreated).
- Each index object is the `collection.indexes()` entry, **normalized** (see §4.1) so it can be
  fed straight back into `createIndex(key, options)`. Server-materialized metadata fields are
  stripped, and `text` index keys are reconstructed.

## 4. Core API

### 4.0 Connection helper (`src/mongo.js`)
- `connect(uri) -> { client, db }`: construct `new MongoClient(uri, { serverSelectionTimeoutMS: 5000 })`,
  `await client.connect()`, resolve `db = client.db()` (DB from the URI path).
- **Validate the URI carries a DB name.** `client.db()` with no DB in the URI silently defaults
  to `test` — a footgun that could dump/wipe the wrong DB. Parse the URI; if no database path is
  present, throw a `MissingDatabaseError` → CLI exits 1 with a clear message. (Auth/TLS/replicaSet
  options ride along in the URI and are handled natively by `MongoClient`.)

### 4.1 Index normalization (`src/normalize.js`) — shared by dump
`normalizeIndex(raw) -> indexObj` makes a `collection.indexes()` entry safe to pass to
`createIndex(key, options)`:
- **Strip server-materialized fields** that `createIndex` rejects or that are server-assigned:
  `v`, `ns`, `background`, `textIndexVersion`, `2dsphereIndexVersion`, `2dIndexVersion`, `safe`.
- **Preserve** all real option fields: `unique`, `sparse`, `expireAfterSeconds`,
  `partialFilterExpression`, `collation`, `weights`, `default_language`, `language_override`,
  `wildcardProjection`, `hidden`, `bits`, `min`, `max`, `storageEngine`, etc. (denylist, not
  allowlist — unknown future fields pass through rather than being silently dropped).
- **Text-index key reconstruction:** when `key` contains `_fts: "text"` / `_ftsx`, the real
  user-facing key lives in `weights`. Rebuild `key` as `{ field: "text", … }` for each weighted
  field (preserving any non-text compound key fields), and keep `weights`. This is the one case
  where the raw `key` from `listIndexes()` is not directly re-creatable.
- Returns `{ key, name, ...preservedOptions }`. The `_id_` index is filtered out **before**
  normalization (never normalized, never emitted).

### `dumpIndexes(uri, opts) -> Promise<Array<{collection, indexes}>>`
- `opts.collection?: string[]` — restrict to these collection names.
- `connect(uri)` (validates DB).
- List collections via `db.listCollections().toArray()`; filter out `name.startsWith("system.")`
  and views (`type === "view"`); apply the optional `collection` filter.
- For each collection: `collection.indexes()`, drop the `_id_` entry, `normalizeIndex` the rest.
- Always closes the client (`finally`).

### `restoreIndexes(uri, data, opts) -> Promise<{created, dropped, failed}>`
- `data: Array<{collection, indexes}>` — already-parsed file contents (the CLI reads & parses the
  file and maps file/JSON errors to exit 1; core never touches the filesystem).
- `opts.keepIndexes?: boolean` — if false (default), drop existing non-`_id_` indexes on each
  target collection before recreating; if true, only add.
- `opts.dryRun?: boolean` — log intended drop/create ops, perform **no** writes.
- `opts.collection?: string[]` — restrict to these collection names.
- **Drop step (default mode):** call `collection.dropIndexes()` — the driver wildcard that drops
  every index **except `_id_`** in one op. Wrap in try/catch: a `NamespaceNotFound` (code 26 — the
  collection doesn't exist yet) is **normal, not a failure** (the upcoming `createIndex` will
  create the collection) → skip silently, do **not** tally in `failed`. Any other drop error →
  tally in `failed`, continue.
- **Create step:** per index, destructure `{ key, name, ...indexOpts }`, call
  `collection.createIndex(key, { ...indexOpts, name })`. **Skip any `_id_` entry** (defensive;
  dumps never contain it).
- **Continue-on-error:** wrap each create in try/catch; on failure push
  `{ collection, name, error: err.message }` to `failed` and continue.
- **Counter semantics:** `created` (= "ensured") increments per `createIndex` call that returns
  without throwing — note Mongo treats an identical existing spec as success without rebuild, so
  in **keep mode** this counts already-present indexes too. The CLI summary labels it
  `ensured C` (not `created C`) to avoid implying every one was freshly built. `dropped`
  increments per successful `dropIndexes()` call (collections, not individual indexes, since the
  wildcard drops them en masse).
- Returns `{ created: number, dropped: number, failed: Array<{collection,name,error}> }`.
- Always closes the client (`finally`).

> **Out of scope (asserted):** geospatial (`2dsphere`/`2d`) and wildcard indexes are passed
> through best-effort via the denylist normalizer but are **not** specially reconstructed or
> guaranteed; only `text` keys get reconstruction (§4.1). If a geo/wildcard index fails to
> recreate it lands in `failed` like any other — it does not abort the run.

## 5. CLI Contracts

```
mongodumpindexes <uri> <file> [-c, --collection <name...>]
  Reads indexes from the DB in <uri>, writes a JSON array to <file>.

mongorestoreindexes <uri> <file> [-k, --keep-indexes] [-n, --dry-run] [-c, --collection <name...>]
  Reads the JSON array from <file>, recreates indexes on the DB in <uri>.
```

Behavior:
- `<uri>` includes the target database, e.g. `mongodb://localhost:27017/mydb`.
- Dump prints `Dumped N collections (M indexes) -> <file>`.
- Restore prints a summary: `created C, dropped D, failed F` and lists each failure.
- Dry-run prints intended ops prefixed `[dry-run]`.

### Exit codes
| Condition | Code |
|---|---|
| Success, no failed indexes | 0 |
| Connection / bad URI / missing-DB-in-URI / file-not-found / invalid JSON / usage error | 1 |
| Run completed but ≥1 index failed (partial success) | 2 |

Exit `2` is deliberately distinct from `1` so a script can tell a hard failure (couldn't even
run — wrong URI, bad file) from a partial failure (ran, but N indexes didn't recreate). Errors
go to stderr with a human-readable message (raw stack only under a `--verbose`/`DEBUG` env).

## 6. Edge Cases

| Case | Handling |
|---|---|
| `_id_` index | Excluded on dump; skipped on restore (never dropped, never created). |
| `system.*` collections / views | Skipped on dump. |
| Empty DB / no user indexes | Dump writes `[]`; restore on `[]` is a no-op summary. |
| Index already exists on restore (keep mode) | `createIndex` is idempotent for identical spec (counts as `created`); conflicting spec → counted in `failed`, run continues → exit 2. |
| Server-materialized fields (`v`, `ns`, `background`, `textIndexVersion`, `2dsphereIndexVersion`, `2dIndexVersion`, `safe`) | Stripped by `normalizeIndex` (§4.1) so `createIndex` won't reject them. |
| `text` index | Key reconstructed from `weights` in `normalizeIndex`; `weights`/`default_language`/`language_override` preserved. |
| Collection in file missing on target, **default (drop) mode** | `dropIndexes()` throws `NamespaceNotFound` (26) — caught and ignored, **not** a failure; subsequent `createIndex` auto-creates the collection. |
| Collection in file missing on target, **keep mode** | No drop attempted; `createIndex` auto-creates the collection. |
| Invalid `--collection` name | No matching collection → that name contributes nothing; not an error. |
| File write failure (dump) | Exit 1 with message. |
| URI without a database path | `connect()` throws `MissingDatabaseError` → exit 1 (prevents silently operating on `test`). |
| Bad host / unreachable | `serverSelectionTimeoutMS: 5000` bounds the hang to ~5s, then exit 1. |

## 7. Testing (TDD)

Runner: built-in `node:test`. Integration DB: `mongodb-memory-server` (real mongod, in-memory).

Each task writes failing tests first (red), then implements (green).

**core/test/normalize.test.js** (pure unit, no DB)
- strips every denylisted field (`v`, `ns`, `background`, `textIndexVersion`,
  `2dsphereIndexVersion`, `2dIndexVersion`, `safe`)
- preserves `unique`, `sparse`, `expireAfterSeconds`, `partialFilterExpression`, `collation`,
  `hidden`, `weights`
- reconstructs a `text` key from `weights` (single-field and compound text)

**core/test/dump.test.js**
- dumps user indexes round-trip-equal to what was created
- excludes the `_id_` index
- skips `system.*` collections and views
- `--collection` filter limits output
- normalizes output (no `v`/`ns` leak)
- empty DB → `[]`
- `connect()` rejects a URI with no DB name (MissingDatabaseError)

**core/test/restore.test.js**
- recreates indexes from a data array onto a fresh DB
- default mode drops existing non-`_id_` indexes first (via `dropIndexes()`)
- drop against a not-yet-existent collection is ignored, not tallied in `failed`
- `keepIndexes:true` is additive (does not drop)
- `dryRun:true` performs no writes, returns intended counts
- continue-on-error: a bad index spec is tallied in `failed`, others still created
- never drops or creates `_id_`
- keep-mode re-run of an identical spec is idempotent (no error, counted created)

**core/test/roundtrip.test.js** — real-world index types, dump A → restore into fresh B,
assert index sets match (minus `_id_`). Cases:
- plain single-field + compound
- `unique`, `sparse`, `hidden`
- TTL (`expireAfterSeconds`)
- partial (`partialFilterExpression`)
- `collation`
- `text` (single-field and compound — the key-reconstruction path)

> Geo (`2dsphere`) / wildcard are explicitly out of scope (§4) — not in the round-trip assertions.

**CLI tests** (`dump/test`, `restore/test`) — spawn the actual `bin/cli.js` via `child_process`
and assert **exit codes** (the §5 table), not just `--help`:
- dump/restore with a bad URI → exit 1
- restore with a missing file → exit 1
- restore with invalid JSON → exit 1
- restore where ≥1 index fails → exit 2
- happy path → exit 0
- `--help` prints usage

## 8. Migration / Cleanup

- Delete `exportMongoIndexes.sh`.
- Delete `mongoIndexRestore/` (old restore project — descends into `packages/restore` +
  `packages/core`).
- Rewrite root `README.md`: install, both commands, file format, examples.
- Add `.absolute-work/` to `.gitignore`.

## 9. Decision Log

| # | Decision | Rationale |
|---|---|---|
| D1 | Pure Node driver for dump (drop mongosh) | npx-able, cross-platform, symmetric with restore |
| D2 | Pretty JSON array file format | Human-readable, diffable, single parse |
| D3 | Positional `<uri> <file>` args | Matches existing restore CLI, scriptable; URI carries DB |
| D4 | Two published packages + shared core | Lets `npx mongodumpindexes` AND `npx mongorestoreindexes` both work directly |
| D5 | npm workspaces, 3 pkgs, no build | Zero build tooling, plain ESM, core as normal dep |
| D6 | JS ESM + node:test + mongodb-memory-server | Matches existing stack, real index round-trip without external deps |
| D7 | Restore flags: --keep-indexes, --dry-run, --collection, continue-on-error | Safe, previewable, partial-failure tolerant |
| D8 | Always exclude `_id_`; normalize via denylist + text-key rebuild | `_id_` can't be recreated; server-materialized fields (`v`/`ns`/`textIndexVersion`/…) make `createIndex` throw; text keys (`_fts`/`_ftsx`) aren't directly re-creatable |
| D9 | core name `mongo-indexes-core`, board gitignored | Unscoped (no org), keep process state out of repo |
| D10 | Validate DB present in URI; `serverSelectionTimeoutMS: 5000` | `client.db()` silently defaults to `test` → wrong-DB footgun; bound connection hang |
| D11 | Exit 2 for partial failure (vs 1 for hard failure) | Scripts can distinguish "didn't run" from "ran, N indexes failed" |
| D12 | Drop via `dropIndexes()` wildcard; ignore NamespaceNotFound (26) | One atomic op that already excludes `_id_`; missing collection is normal, not a failure |
| D13 | Geo/wildcard indexes out of scope (best-effort, not guaranteed) | Reconstruction complexity; text covers the common non-trivial case; failures land in `failed` not abort |
