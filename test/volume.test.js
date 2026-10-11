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

test('volume events right after connecting are not presses', async () => {
  const { room, sent } = setup(60);
  room.vol.connectedAt = Date.now();
  onVolume(room, -10);
  onVolume(room, -20);
  await wait(300);
  assert.deepEqual(sent, []);
});
