import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIndex } from '../src/normalize.js';

test('strips every server-materialized field', () => {
  const out = normalizeIndex({
    v: 2,
    key: { a: 1 },
    name: 'a_1',
    ns: 'db.coll',
    background: true,
    textIndexVersion: 3,
    '2dsphereIndexVersion': 3,
    '2dIndexVersion': 2,
    safe: null,
  });
  assert.deepEqual(out, { key: { a: 1 }, name: 'a_1' });
});

test('preserves real option fields', () => {
  const raw = {
    v: 2,
    key: { a: 1 },
    name: 'a_1',
    unique: true,
    sparse: true,
    expireAfterSeconds: 3600,
    partialFilterExpression: { a: { $gt: 5 } },
    collation: { locale: 'en' },
    hidden: true,
  };
  const out = normalizeIndex(raw);
  assert.equal(out.unique, true);
  assert.equal(out.sparse, true);
  assert.equal(out.expireAfterSeconds, 3600);
  assert.deepEqual(out.partialFilterExpression, { a: { $gt: 5 } });
  assert.deepEqual(out.collation, { locale: 'en' });
  assert.equal(out.hidden, true);
  assert.ok(!('v' in out));
});

test('reconstructs a single-field text key from weights', () => {
  const out = normalizeIndex({
    v: 2,
    key: { _fts: 'text', _ftsx: 1 },
    name: 'title_text',
    weights: { title: 1 },
    default_language: 'english',
    language_override: 'language',
    textIndexVersion: 3,
  });
  assert.deepEqual(out.key, { title: 'text' });
  assert.deepEqual(out.weights, { title: 1 });
  assert.equal(out.default_language, 'english');
  assert.ok(!('textIndexVersion' in out));
});

test('reconstructs a compound text key preserving prefix/suffix fields', () => {
  const out = normalizeIndex({
    v: 2,
    key: { a: 1, _fts: 'text', _ftsx: 1, b: -1 },
    name: 'a_1_text_b_-1',
    weights: { title: 1, body: 1 },
    textIndexVersion: 3,
  });
  assert.deepEqual(out.key, { a: 1, title: 'text', body: 'text', b: -1 });
});
