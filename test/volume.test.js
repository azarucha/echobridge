// iPhone volume buttons → Echo volume (src/receivers.js): only real presses change the Echo
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'echobridge-test-volume-'));
process.env.ECHO_VOLUME_STEP = '4';
const alexa = require('../src/alexa');
const { parseRooms, _test: { onVolume, onSession, newVolumeState } } = require('../src/receivers');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PRESS = 30 / 16;

function setup(echoVolume) {
  const sent = [];
  alexa.getVolume = async () => echoVolume;
  alexa.setVolume = async (serial, value) => { sent.push([serial, value]); };
  const room = { ...parseRooms('Kitchen=G2A1')[0], streams: [], vol: newVolumeState() };
  onSession(room, 'start');
  room.vol.connectedAt = 0; // skip the grace period after connecting
  return { room, sent };
}

test('a press changes the Echo relative to its real volume', async () => {
  const { room, sent } = setup(60);
  onVolume(room, -15);              // current iPhone volume
  onVolume(room, -15 + PRESS);      // one press up
  await wait(300);
  assert.deepEqual(sent, [['G2A1', 64]]);
});

test('unknown Echo volume: no guessed level, nothing is sent', async () => {
  const { room, sent } = setup(null);
  onVolume(room, -15);
  onVolume(room, -15 + PRESS);
  await wait(300);
  assert.deepEqual(sent, []);
});

test('iOS muting on its own (pause, disconnect) does not turn the Echo down', async () => {
  const { room, sent } = setup(60);
  onVolume(room, -15);
  onVolume(room, -144);
  await wait(300);
  assert.deepEqual(sent, []);
});

test('muting from the lowest step is a real press', async () => {
  const { room, sent } = setup(10);
  onVolume(room, -30 + PRESS);
  onVolume(room, -144);
  await wait(300);
  assert.deepEqual(sent, [['G2A1', 6]]);
});

test('quick presses: one command in flight, then the latest value', async () => {
  const { room, sent } = setup(60);
  alexa.setVolume = async (serial, value) => { sent.push([serial, value]); await wait(600); };
  onVolume(room, -15);
  onVolume(room, -15 + PRESS);       // 64 is sent right away
  await wait(200);
  onVolume(room, -15 + 2 * PRESS);   // 68 waits
  await wait(200);
  onVolume(room, -15 + 3 * PRESS);   // 72 replaces 68
  await wait(900);
  assert.deepEqual(sent, [['G2A1', 64], ['G2A1', 72]]);
});

test('starting volume just before the session start: the first press counts', async () => {
  const { room, sent } = setup(24);
  onSession(room, 'end');
  onVolume(room, -24);               // the iPhone reports its volume ...
  onSession(room, 'start');          // ... and only then the session starts
  room.vol.connectedAt = Date.now() - 1500;
  onVolume(room, -24 + PRESS);       // first press
  await wait(300);
  assert.deepEqual(sent, [['G2A1', 28]]);
});

test('an old baseline from an earlier session is dropped', async () => {
  const { room, sent } = setup(24);
  onVolume(room, -24);
  room.vol.lastEventAt = Date.now() - 5000;
  onSession(room, 'start');
  room.vol.connectedAt = Date.now() - 1500;
  onVolume(room, -10);               // new iPhone volume, not a press
  await wait(300);
  assert.deepEqual(sent, []);
});

test('volume events right after connecting are not presses', async () => {
  const { room, sent } = setup(60);
  room.vol.connectedAt = Date.now();
  onVolume(room, -10);
  onVolume(room, -20);
  await wait(300);
  assert.deepEqual(sent, []);
});
