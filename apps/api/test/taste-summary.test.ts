import assert from 'node:assert/strict';
import { test } from 'node:test';
import { favoriteDecades, genreBreakdown } from '../src/taste-summary.js';

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

test('genre breakdown returns percentages of all positive genre weights', () => {
  const tags = { 'genre:Rock': 3, 'genre:Pop': 1, 'decade:1990': 100 };
  assert.deepEqual(genreBreakdown(tags), [
    { name: 'Rock', percentage: 75 },
    { name: 'Pop', percentage: 25 },
  ]);
  assert.deepEqual(tags, { 'genre:Rock': 3, 'genre:Pop': 1, 'decade:1990': 100 });
});

test('genre breakdown sorts ties and rounds fractional shares', () => {
  assert.deepEqual(genreBreakdown({
    'genre:Jazz': 1, 'genre:Blues': 1, 'genre:Rock': 1,
  }), [
    { name: 'Blues', percentage: 33.3 },
    { name: 'Jazz', percentage: 33.3 },
    { name: 'Rock', percentage: 33.3 },
  ]);
});

test('genre breakdown ignores invalid weights and empty tags', () => {
  assert.deepEqual(genreBreakdown({
    'genre:': 3, 'genre:Rock': 0, 'genre:Pop': -2,
    'genre:Jazz': Number.NaN, 'genre:Blues': Number.POSITIVE_INFINITY,
    'decade:2000': 4,
  }), []);
  assert.deepEqual(genreBreakdown({ 'genre:Rock': 2, 'genre:Pop': Number.NaN }), [
    { name: 'Rock', percentage: 100 },
  ]);
  assert.deepEqual(genreBreakdown({}), []);
});
