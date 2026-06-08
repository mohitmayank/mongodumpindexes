import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';

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

async function tmpJson(name, contents) {
  const path = join(tmpdir(), `restoreindexes-${process.pid}-${name}`);
  await writeFile(path, contents);
  return path;
}

let mongod;
const DB = 'clirestore';

before(async () => {
  mongod = await MongoMemoryServer.create();
});

after(async () => {
  await mongod.stop();
});

test('--help exits 0 with usage', async () => {
  const { code, stdout } = await run(['--help']);
  assert.equal(code, 0);
  assert.match(stdout, /mongorestoreindexes/);
});

test('a URI without a database exits 1', async () => {
  const file = await tmpJson('nodb.json', '[]');
  try {
    const { code, stderr } = await run(['mongodb://127.0.0.1:27017', file]);
    assert.equal(code, 1);
    assert.match(stderr, /No database/);
  } finally {
    await rm(file, { force: true });
  }
});

test('a missing file exits 1', async () => {
  const { code, stderr } = await run([mongod.getUri(DB), '/no/such/file.json']);
  assert.equal(code, 1);
  assert.match(stderr, /Error reading/);
});

test('invalid JSON exits 1', async () => {
  const file = await tmpJson('bad.json', '{ not valid');
  try {
    const { code, stderr } = await run([mongod.getUri(DB), file]);
    assert.equal(code, 1);
    assert.match(stderr, /Error reading/);
  } finally {
    await rm(file, { force: true });
  }
});

test('a failing index yields exit 2', async () => {
  const file = await tmpJson(
    'fail.json',
    JSON.stringify([
      { collection: 'c', indexes: [{ key: { a: 1 }, name: 'bad', expireAfterSeconds: 'nope' }] },
    ]),
  );
  try {
    const { code, stdout } = await run([mongod.getUri(DB), file]);
    assert.equal(code, 2);
    assert.match(stdout, /failed 1/);
  } finally {
    await rm(file, { force: true });
  }
});

test('happy path exits 0', async () => {
  const file = await tmpJson(
    'ok.json',
    JSON.stringify([{ collection: 'c', indexes: [{ key: { a: 1 }, name: 'a_1' }] }]),
  );
  try {
    const { code, stdout } = await run([mongod.getUri(DB), file]);
    assert.equal(code, 0);
    assert.match(stdout, /ensured 1/);
  } finally {
    await rm(file, { force: true });
  }
});
