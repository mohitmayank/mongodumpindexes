import { connect } from './mongo.js';
import { normalizeIndex } from './normalize.js';

/**
 * Read all user index definitions from the database named in `uri`.
 *
 * @param {string} uri  MongoDB URI including the database.
 * @param {{ collection?: string[] }} [opts]
 * @returns {Promise<Array<{ collection: string, indexes: object[] }>>}
 */
export async function dumpIndexes(uri, opts = {}) {
  const only = opts.collection ? new Set(opts.collection) : null;
  const { client, db } = await connect(uri);
  try {
    const infos = await db.listCollections().toArray();
    const result = [];
    for (const info of infos) {
      if (info.type === 'view') continue;
      if (info.name.startsWith('system.')) continue;
      if (only && !only.has(info.name)) continue;

      const raw = await db.collection(info.name).indexes();
      const indexes = raw
        .filter((ix) => ix.name !== '_id_')
        .map(normalizeIndex);
      result.push({ collection: info.name, indexes });
    }
    return result;
  } finally {
    await client.close();
  }
}
