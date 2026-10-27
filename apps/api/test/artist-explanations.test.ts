import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compatibility } from '../src/engine.js';

const base = { tracks: {}, tags: {}, negative: [], exploration: 0.5, rated: 10 };

test('match reasons name up to three shared artists in stable Turkish order', () => {
  const a = { ...base, artists: {
    'Zeki Müren': 1, 'Sezen Aksu': 1, 'Barış Manço': 1, 'Ajda Pekkan': 1,
  } };
  const b = { ...base, artists: {
    'Ajda Pekkan': 2, 'Barış Manço': 2, 'Sezen Aksu': 2, 'Zeki Müren': 2,
  } };
  const match = compatibility(a, b);
  assert.deepEqual(match.commonArtists, [
    'Ajda Pekkan', 'Barış Manço', 'Sezen Aksu', 'Zeki Müren',
  ]);
  assert(match.reasons.includes('Ortak sanatçılar: Ajda Pekkan, Barış Manço, Sezen Aksu'));
  assert.equal(match.reasons.filter(reason => reason.startsWith('Ortak sanatçılar:')).length, 1);
});

test('no artist overlap does not produce a misleading reason', () => {
  const a = { ...base, artists: { 'Ajda Pekkan': 1 } };
  const b = { ...base, artists: { Teoman: 1 } };
  const match = compatibility(a, b);
  assert.deepEqual(match.commonArtists, []);
  assert(!match.reasons.some(reason => reason.startsWith('Ortak sanatçılar:')));
  assert(match.reasons.includes('0 ortak sanatçı'));
});

test('shared artist explanations do not change match scores', () => {
  const a = { ...base, artists: { 'Ajda Pekkan': 1, 'Barış Manço': 1 } };
  const b = { ...base, artists: { 'Ajda Pekkan': 1, 'Barış Manço': 1 } };
  const match = compatibility(a, b);
  // Artist Jaccard = 1, exploration agreement = 1, other components = 0.
  assert.equal(match.musicScore, 50);
  assert.equal(match.rankingScore, 63);
});
