import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';

const CLI = new URL('../bin/cli.js', import.meta.url).pathname;

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

let mongod;
const DB = 'clidump';

before(async () => {
  mongod = await MongoMemoryServer.create();
  const client = new MongoClient(mongod.getUri(DB));
  await client.connect();
  await client.db(DB).collection('widgets').createIndex({ sku: 1 }, { name: 'sku_1' });
  await client.close();
});

after(async () => {
  await mongod.stop();
});

test('--help exits 0 with usage', async () => {
  const { code, stdout } = await run(['--help']);
  assert.equal(code, 0);
  assert.match(stdout, /mongodumpindexes/);
});

test('a URI without a database exits 1', async () => {
  const { code, stderr } = await run(['mongodb://127.0.0.1:27017', '/tmp/none.json']);
  assert.equal(code, 1);
  assert.match(stderr, /No database/);
});

test('happy path exits 0 and writes a JSON array', async () => {
  const out = join(tmpdir(), `dumpindexes-${process.pid}.json`);
  try {
    const { code, stdout } = await run([mongod.getUri(DB), out]);
    assert.equal(code, 0);
    assert.match(stdout, /Dumped/);
    const parsed = JSON.parse(await readFile(out, 'utf8'));
    assert.ok(Array.isArray(parsed));
    assert.ok(parsed.some((c) => c.collection === 'widgets'));
  } finally {
    await rm(out, { force: true });
  }
});
