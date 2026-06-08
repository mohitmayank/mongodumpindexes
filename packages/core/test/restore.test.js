import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { restoreIndexes } from '../src/restore.js';

let mongod;
let client;
let db;
let uri;
const DB = 'restoretest';

before(async () => {
  mongod = await MongoMemoryServer.create();
  uri = mongod.getUri(DB);
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(DB);
});

after(async () => {
  await client.close();
  await mongod.stop();
});

beforeEach(async () => {
  await db.dropDatabase();
});

const names = async (coll) => (await db.collection(coll).indexes()).map((i) => i.name).sort();

test('recreates indexes from a data array', async () => {
  const summary = await restoreIndexes(uri, [
    { collection: 'users', indexes: [{ key: { email: 1 }, name: 'email_1', unique: true }] },
  ]);
  assert.equal(summary.created, 1);
  assert.equal(summary.failed.length, 0);
  assert.deepEqual(await names('users'), ['_id_', 'email_1']);
});

test('default mode drops existing non-_id_ indexes first', async () => {
  await db.collection('users').createIndex({ stale: 1 }, { name: 'stale_1' });
  await restoreIndexes(uri, [
    { collection: 'users', indexes: [{ key: { email: 1 }, name: 'email_1' }] },
  ]);
  assert.deepEqual(await names('users'), ['_id_', 'email_1']);
});

test('drop against a missing collection is not a failure', async () => {
  const summary = await restoreIndexes(uri, [
    { collection: 'brandnew', indexes: [{ key: { a: 1 }, name: 'a_1' }] },
  ]);
  assert.equal(summary.failed.length, 0);
  assert.deepEqual(await names('brandnew'), ['_id_', 'a_1']);
});

test('keepIndexes is additive (does not drop)', async () => {
  await db.collection('users').createIndex({ keep: 1 }, { name: 'keep_1' });
  await restoreIndexes(
    uri,
    [{ collection: 'users', indexes: [{ key: { email: 1 }, name: 'email_1' }] }],
    { keepIndexes: true },
  );
  assert.deepEqual(await names('users'), ['_id_', 'email_1', 'keep_1']);
});

test('dryRun performs no writes but returns intended counts', async () => {
  const summary = await restoreIndexes(
    uri,
    [{ collection: 'users', indexes: [{ key: { email: 1 }, name: 'email_1' }] }],
    { dryRun: true },
  );
  assert.equal(summary.created, 1);
  const existing = await db.listCollections({ name: 'users' }).toArray();
  assert.equal(existing.length, 0, 'no collection created');
});

test('continue-on-error tallies a bad spec, others still created', async () => {
  const summary = await restoreIndexes(uri, [
    {
      collection: 'users',
      indexes: [
        { key: { good: 1 }, name: 'good_1' },
        { key: { bad: 1 }, name: 'bad', expireAfterSeconds: 'not-a-number' },
      ],
    },
  ]);
  assert.equal(summary.created, 1);
  assert.equal(summary.failed.length, 1);
  assert.equal(summary.failed[0].name, 'bad');
  assert.deepEqual(await names('users'), ['_id_', 'good_1']);
});

test('keep-mode re-run of an identical spec is idempotent', async () => {
  const data = [{ collection: 'users', indexes: [{ key: { email: 1 }, name: 'email_1' }] }];
  await restoreIndexes(uri, data, { keepIndexes: true });
  const second = await restoreIndexes(uri, data, { keepIndexes: true });
  assert.equal(second.failed.length, 0);
  assert.deepEqual(await names('users'), ['_id_', 'email_1']);
});

test('an _id_ entry in data is skipped, never dropped or created', async () => {
  const summary = await restoreIndexes(uri, [
    {
      collection: 'users',
      indexes: [
        { key: { _id: 1 }, name: '_id_' },
        { key: { email: 1 }, name: 'email_1' },
      ],
    },
  ]);
  assert.equal(summary.created, 1);
  assert.deepEqual(await names('users'), ['_id_', 'email_1']);
});
