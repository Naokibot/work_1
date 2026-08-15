import test from 'node:test';
import assert from 'node:assert/strict';
import { __ankiPackageTest } from '../dist/assets/anki/anki-package.js';

function concat(...parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function fieldString(field, value) {
  const data = new TextEncoder().encode(value);
  return concat(Uint8Array.of((field << 3) | 2, data.length), data);
}

function fieldVarint(field, value) {
  return Uint8Array.of((field << 3) | 0, value);
}

test('protobuf decoder reads Anki string and numeric config fields', () => {
  const config = concat(fieldVarint(1, 1), fieldString(3, '.card { font-size: 20px; }'), fieldVarint(9, 6));
  const decoded = __ankiPackageTest.protoDecode(config);
  assert.equal(__ankiPackageTest.protoNumber(decoded, 1), 1);
  assert.equal(__ankiPackageTest.protoString(decoded, 3), '.card { font-size: 20px; }');
  assert.equal(__ankiPackageTest.protoNumber(decoded, 9), 6);
});

test('protobuf decoder reads repeated MediaEntries messages', () => {
  const entry1 = fieldString(1, 'one.png');
  const entry2 = fieldString(1, 'two.mp3');
  const wrap = (entry) => concat(Uint8Array.of((1 << 3) | 2, entry.length), entry);
  const decoded = __ankiPackageTest.protoDecode(concat(wrap(entry1), wrap(entry2)));
  const messages = __ankiPackageTest.protoMessages(decoded, 1);
  assert.equal(messages.length, 2);
  assert.equal(__ankiPackageTest.protoString(messages[0], 1), 'one.png');
  assert.equal(__ankiPackageTest.protoString(messages[1], 1), 'two.mp3');
});
