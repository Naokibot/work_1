import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalRequest, stableStringify } from '../dist/assets/sync/crypto.js';

test('stableStringify sorts object keys recursively', () => {
  assert.equal(stableStringify({ z: 1, a: { y: 2, b: 3 } }), '{"a":{"b":3,"y":2},"z":1}');
});

test('canonical request is deterministic', () => {
  const a = canonicalRequest('pull', '2026-08-15T00:00:00.000Z', 'nonce_x', 'pull_x', { z: 1, a: 2 });
  const b = canonicalRequest('pull', '2026-08-15T00:00:00.000Z', 'nonce_x', 'pull_x', { a: 2, z: 1 });
  assert.equal(a, b);
});
