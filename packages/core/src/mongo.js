import { MongoClient } from 'mongodb';

/** Thrown when the connection URI does not name a database. */
export class MissingDatabaseError extends Error {
  constructor() {
    super(
      'No database in the MongoDB URI. Include a database name, ' +
        'e.g. mongodb://localhost:27017/mydb',
    );
    this.name = 'MissingDatabaseError';
  }
}

/**
 * Extract the database name from a MongoDB connection string.
 * Returns '' when no database path is present.
 *
 * @param {string} uri
 * @returns {string}
 */
export function dbNameFromUri(uri) {
  if (typeof uri !== 'string') return '';
  const withoutScheme = uri.replace(/^mongodb(\+srv)?:\/\//i, '');
  const afterHost = withoutScheme.replace(/^[^/]*/, ''); // drop user@host:port list
  if (!afterHost.startsWith('/')) return '';
  const path = afterHost.slice(1).split('?')[0];
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * Connect to MongoDB, validating that the URI names a database.
 * Caller is responsible for `client.close()`.
 *
 * @param {string} uri
 * @returns {Promise<{ client: import('mongodb').MongoClient, db: import('mongodb').Db }>}
 */
export async function connect(uri) {
  const name = dbNameFromUri(uri);
  if (!name) throw new MissingDatabaseError();

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  return { client, db: client.db(name) };
}
