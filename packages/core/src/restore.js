import { connect } from './mongo.js';

const NAMESPACE_NOT_FOUND = 26;

/**
 * Recreate index definitions (as produced by {@link dumpIndexes}) on the
 * database named in `uri`.
 *
 * @param {string} uri
 * @param {Array<{ collection: string, indexes: object[] }>} data
 * @param {{ keepIndexes?: boolean, dryRun?: boolean, collection?: string[] }} [opts]
 * @returns {Promise<{ created: number, dropped: number, failed: Array<{collection:string,name:string,error:string}> }>}
 */
export async function restoreIndexes(uri, data, opts = {}) {
  if (!Array.isArray(data)) {
    throw new TypeError('restoreIndexes: data must be an array of { collection, indexes }');
  }
  const { keepIndexes = false, dryRun = false } = opts;
  const only = opts.collection ? new Set(opts.collection) : null;
  const { client, db } = await connect(uri);
  const summary = { created: 0, dropped: 0, failed: [] };

  try {
    for (const entry of data) {
      const { collection, indexes = [] } = entry;
      if (only && !only.has(collection)) continue;
      const coll = db.collection(collection);

      if (!keepIndexes) {
        if (dryRun) {
          console.log(`[dry-run] would drop all non-_id_ indexes on ${collection}`);
          summary.dropped += 1;
        } else {
          try {
            await coll.dropIndexes();
            summary.dropped += 1;
          } catch (err) {
            // A not-yet-existent collection is normal, not a failure.
            const missing = err.code === NAMESPACE_NOT_FOUND || /ns (not found|does not exist)/i.test(err.message);
            if (!missing) {
              summary.failed.push({ collection, name: '*', error: err.message });
            }
          }
        }
      }

      for (const index of indexes) {
        if (index.name === '_id_') continue; // never recreate the _id index
        const { key, name, ...indexOpts } = index;

        if (dryRun) {
          console.log(`[dry-run] would create ${collection}:${name}`);
          summary.created += 1;
          continue;
        }
        try {
          await coll.createIndex(key, { ...indexOpts, name });
          summary.created += 1;
        } catch (err) {
          summary.failed.push({ collection, name, error: err.message });
        }
      }
    }
    return summary;
  } finally {
    await client.close();
  }
}
