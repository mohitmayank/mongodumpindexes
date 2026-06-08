import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { dumpIndexes } from '../src/dump.js';
import { connect } from '../src/mongo.js';

let mongod;
let client;
let db;
const DB = 'dumptest';

before(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri(DB));
  await client.connect();
  db = client.db(DB);
});

after(async () => {
  await client.close();
  await mongod.stop();
});

test('dumps user indexes, excluding the _id_ index', async () => {
  await db.collection('users').createIndex({ email: 1 }, { unique: true, name: 'email_1' });
  await db.collection('users').createIndex({ createdAt: -1 }, { name: 'createdAt_-1' });

  const dump = await dumpIndexes(mongod.getUri(DB));
  const users = dump.find((c) => c.collection === 'users');

  assert.ok(users, 'users collection present');
  const names = users.indexes.map((i) => i.name).sort();
  assert.deepEqual(names, ['createdAt_-1', 'email_1']);
  assert.ok(!names.includes('_id_'), '_id_ excluded');

  const email = users.indexes.find((i) => i.name === 'email_1');
  assert.equal(email.unique, true);
  assert.deepEqual(email.key, { email: 1 });
});

test('output carries no server-materialized fields (v/ns)', async () => {
  const dump = await dumpIndexes(mongod.getUri(DB));
  for (const { indexes } of dump) {
    for (const ix of indexes) {
      assert.ok(!('v' in ix), 'no v');
      assert.ok(!('ns' in ix), 'no ns');
    }
  }
});

test('skips system and view namespaces', async () => {
  await db.createCollection('myview', {
    viewOn: 'users',
    pipeline: [{ $match: {} }],
  });
  const dump = await dumpIndexes(mongod.getUri(DB));
  const names = dump.map((c) => c.collection);
  assert.ok(!names.includes('myview'), 'view skipped');
  assert.ok(!names.some((n) => n.startsWith('system.')), 'system skipped');
});

test('--collection filter limits output', async () => {
  await db.collection('orders').createIndex({ userId: 1 }, { name: 'userId_1' });
  const dump = await dumpIndexes(mongod.getUri(DB), { collection: ['orders'] });
  assert.equal(dump.length, 1);
  assert.equal(dump[0].collection, 'orders');
});

test('empty database dumps to []', async () => {
  const empty = await MongoMemoryServer.create();
  try {
    const dump = await dumpIndexes(empty.getUri('emptydb'));
    assert.deepEqual(dump, []);
  } finally {
    await empty.stop();
  }
});

test('connect rejects a URI without a database', async () => {
  await assert.rejects(
    () => connect('mongodb://127.0.0.1:27017'),
    /No database/,
  );
});
