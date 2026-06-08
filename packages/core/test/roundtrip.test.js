import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { dumpIndexes } from '../src/dump.js';
import { restoreIndexes } from '../src/restore.js';

let mongod;
let client;
let srcUri;
let dstUri;

before(async () => {
  mongod = await MongoMemoryServer.create();
  srcUri = mongod.getUri('src');
  dstUri = mongod.getUri('dst');
  client = new MongoClient(mongod.getUri('src'));
  await client.connect();
});

after(async () => {
  await client.close();
  await mongod.stop();
});

// Sort a dump deterministically so two dumps can be deep-compared.
function canonical(dump) {
  return dump
    .map((c) => ({
      collection: c.collection,
      indexes: [...c.indexes].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.collection.localeCompare(b.collection));
}

test('dump -> restore reproduces real-world index types', async () => {
  const src = client.db('src');

  await src.collection('items').createIndex({ a: 1 }, { name: 'a_1' });
  await src.collection('items').createIndex({ a: 1, b: -1 }, { name: 'a_1_b_-1' });
  await src.collection('items').createIndex({ sku: 1 }, { name: 'sku_1', unique: true });
  await src.collection('items').createIndex({ opt: 1 }, { name: 'opt_1', sparse: true });
  await src.collection('items').createIndex({ hush: 1 }, { name: 'hush_1', hidden: true });
  await src.collection('items').createIndex({ createdAt: 1 }, { name: 'ttl', expireAfterSeconds: 3600 });
  await src.collection('items').createIndex(
    { active: 1 },
    { name: 'partial', partialFilterExpression: { active: { $eq: true } } },
  );
  await src.collection('items').createIndex({ city: 1 }, { name: 'coll', collation: { locale: 'en' } });
  await src.collection('items').createIndex({ title: 'text' }, { name: 'title_text' });

  await src.collection('posts').createIndex(
    { heading: 'text', content: 'text' },
    { name: 'compound_text' },
  );

  const dumped = await dumpIndexes(srcUri);
  const summary = await restoreIndexes(dstUri, dumped);
  assert.equal(summary.failed.length, 0, JSON.stringify(summary.failed));

  const reDumped = await dumpIndexes(dstUri);
  assert.deepEqual(canonical(reDumped), canonical(dumped));
});
