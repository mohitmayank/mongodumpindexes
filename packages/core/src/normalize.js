// Fields that the server materializes onto an index definition and that
// `createIndex(key, options)` either rejects or assigns itself. They must be
// stripped before a dumped index can be fed back in.
const SERVER_FIELDS = new Set([
  'v',
  'ns',
  'background',
  'textIndexVersion',
  '2dsphereIndexVersion',
  '2dIndexVersion',
  'safe',
]);

/**
 * Turn a raw `collection.indexes()` entry into an object that can be passed
 * straight to `createIndex(key, options)`.
 *
 * - Strips server-materialized metadata (denylist, so unknown future option
 *   fields pass through rather than being silently dropped).
 * - Reconstructs the user-facing key for `text` indexes, whose stored key is
 *   `{ _fts: 'text', _ftsx: 1 }` with the real fields living under `weights`.
 *
 * @param {object} raw
 * @returns {object} normalized index `{ key, name, ...options }`
 */
export function normalizeIndex(raw) {
  const out = {};
  for (const [field, value] of Object.entries(raw)) {
    if (SERVER_FIELDS.has(field)) continue;
    out[field] = value;
  }

  if (out.key && (out.key._fts === 'text' || out.key._ftsx !== undefined)) {
    out.key = reconstructTextKey(out.key, out.weights);
  }

  return out;
}

// Rebuild a text index key: replace the `_fts`/`_ftsx` placeholder pair with
// one `<field>: 'text'` entry per weighted field, preserving any compound
// prefix/suffix fields in their original position.
function reconstructTextKey(key, weights) {
  const rebuilt = {};
  for (const [field, direction] of Object.entries(key)) {
    if (field === '_fts') {
      for (const weighted of Object.keys(weights || {})) {
        rebuilt[weighted] = 'text';
      }
    } else if (field === '_ftsx') {
      // placeholder partner of _fts — already handled above
      continue;
    } else {
      rebuilt[field] = direction;
    }
  }
  return rebuilt;
}
