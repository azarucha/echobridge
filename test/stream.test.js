// Delaying a stream (keeping skill and Fire TV in sync)
const test = require('node:test');
const assert = require('node:assert/strict');
const stream = require('../src/stream');

test('delay is clamped and reported', () => {
  const s = stream.create('test');
  s.setDelay(250);
  assert.equal(s.status().delayMs, 250);
  s.setDelay(99999);
  assert.equal(s.status().delayMs, 3000);
  s.setDelay(-5);
  assert.equal(s.status().delayMs, 0);
  s.stop();
});
