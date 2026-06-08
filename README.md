# mongodumpindexes / mongorestoreindexes

Back up and restore **MongoDB index definitions** (not data) from the command line.
Dump every index in a database to a portable JSON file, then recreate those indexes on the
same database or a different one — handy for migrations, environment parity, and disaster
recovery.

Pure Node.js — **no `mongosh` required**.

## Install

Global (gives you both shell commands):

```bash
npm install -g mongodumpindexes mongorestoreindexes
```

Or run on demand with `npx` (no install):

```bash
npx mongodumpindexes    <uri> <file>
npx mongorestoreindexes <uri> <file>
```

## Usage

### Dump

```bash
mongodumpindexes <uri> <file> [-c, --collection <name...>]
```

```bash
# dump every collection's indexes in the "shop" database
mongodumpindexes mongodb://localhost:27017/shop indexes.json

# only specific collections
mongodumpindexes mongodb://localhost:27017/shop indexes.json -c users orders
```

The `<uri>` **must include the database name** (e.g. `…:27017/shop`). Output is a pretty-printed
JSON array.

### Restore

```bash
mongorestoreindexes <uri> <file> [-k, --keep-indexes] [-n, --dry-run] [-c, --collection <name...>]
```

```bash
# recreate indexes on a target database (drops existing non-_id_ indexes first)
mongorestoreindexes mongodb://localhost:27017/shop_copy indexes.json

# preview without touching the database
mongorestoreindexes mongodb://localhost:27017/shop_copy indexes.json --dry-run

# add missing indexes without dropping anything
mongorestoreindexes mongodb://localhost:27017/shop_copy indexes.json --keep-indexes
```

| Flag | Effect |
|---|---|
| `-k, --keep-indexes` | Don't drop existing indexes first — only add what's in the file. |
| `-n, --dry-run` | Print intended drop/create operations; make **no** changes. |
| `-c, --collection <name...>` | Restrict to specific collection name(s). |

## File format

A JSON array — one entry per collection. The automatic `_id_` index is excluded (it can't be
recreated), and server-assigned metadata (`v`, `ns`, index-version fields) is stripped so the
file feeds straight back into `createIndex`.

```json
[
  {
    "collection": "users",
    "indexes": [
      { "key": { "email": 1 }, "name": "email_1", "unique": true },
      { "key": { "createdAt": -1 }, "name": "createdAt_-1" }
    ]
  }
]
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | Hard failure — bad/unreachable URI, no database in URI, file not found, invalid JSON. |
| `2` | Ran, but one or more indexes failed to recreate (others succeeded). |

Exit `2` lets scripts distinguish "couldn't run at all" from a partial restore. On a partial
restore each failure is printed to stderr.

## Notes & scope

- **Indexes only** — this tool never touches your documents.
- The auto `_id_` index is never dumped, dropped, or recreated.
- `text` indexes are fully supported (the key is reconstructed from `weights`).
- Geospatial (`2dsphere`/`2d`) and wildcard indexes are best-effort: they are passed through but
  not specially reconstructed; if one fails it lands in the failure summary rather than aborting
  the run.
- A connection that can't be reached fails fast (~5s).

## Repository layout

npm-workspaces monorepo, plain ESM, no build step:

```
packages/
  core/      mongo-indexes-core    — shared dump/restore logic
  dump/      mongodumpindexes      — dump CLI
  restore/   mongorestoreindexes   — restore CLI
```

Run the test suite (uses `mongodb-memory-server`, no external Mongo needed):

```bash
npm install
npm test
```

## License

MIT
