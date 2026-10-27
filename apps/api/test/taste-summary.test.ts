import assert from 'node:assert/strict';
import { test } from 'node:test';
import { favoriteDecades } from '../src/taste-summary.js';

test('returns up to three favorite decades in weighted order', () => {
  assert.deepEqual(favoriteDecades({
    'genre:rock': 100, 'decade:1990': 2, 'decade:1980': 5,
    'decade:2010': 4, 'decade:2000': 3,
  }), [
    { decade: '1980', weight: 5 },
    { decade: '2010', weight: 4 },
    { decade: '2000', weight: 3 },
  ]);
});

test('breaks ties deterministically and leaves source unchanged', () => {
  const tags = { 'decade:2000': 2, 'decade:1980': 2 };
  assert.deepEqual(favoriteDecades(tags), [
    { decade: '1980', weight: 2 }, { decade: '2000', weight: 2 },
  ]);
  assert.deepEqual(tags, { 'decade:2000': 2, 'decade:1980': 2 });
});

test('ignores empty, non-finite and non-positive decade tags', () => {
  assert.deepEqual(favoriteDecades({
    'decade:': 2, 'decade:1970': 0, 'decade:1980': -1,
    'decade:1990': Number.NaN, 'decade:2000': Number.POSITIVE_INFINITY,
    'genre:2000': 9,
  }), []);
  assert.deepEqual(favoriteDecades({}), []);
});
