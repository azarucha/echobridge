// Skill responses and which Echo gets which room's stream (src/skill.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'echobridge-test-skill-'));
process.env.PUBLIC_URL = 'https://echo.example.com';
const skill = require('../src/skill');

skill.addStream('kitchen', {});
skill.addStream('living-room', {});

const req = (request, deviceId) => ({ request, ...(deviceId ? { context: { System: { device: { deviceId } } } } : {}) });
const url = (res) => res.response.directives[0].audioItem.stream.url;

test('launch and resume play the stream, pause and stop halt it', () => {
  const launch = skill.handle(req({ type: 'LaunchRequest' }));
  const d = launch.response.directives[0];
  assert.equal(d.type, 'AudioPlayer.Play');
  assert.match(d.audioItem.stream.url, /^https:\/\/echo\.example\.com\/stream\/kitchen\/[\w-]+\.mp3$/);
  assert.equal(launch.response.shouldEndSession, true);
  assert.equal(skill.handle(req({ type: 'IntentRequest', intent: { name: 'AMAZON.ResumeIntent' } })).response.directives[0].type, 'AudioPlayer.Play');
  assert.equal(skill.handle(req({ type: 'IntentRequest', intent: { name: 'AMAZON.PauseIntent' } })).response.directives[0].type, 'AudioPlayer.Stop');
  assert.equal(skill.handle(req({ type: 'IntentRequest', intent: { name: 'AMAZON.StopIntent' } })).response.directives[0].type, 'AudioPlayer.Stop');
});

test('player events only get an empty acknowledgement', () => {
  for (const type of ['AudioPlayer.PlaybackStarted', 'AudioPlayer.PlaybackFailed', 'SessionEndedRequest']) {
    assert.deepEqual(skill.handle(req({ type })), { version: '1.0', response: {} });
  }
});

test('a launched room belongs to the Echo that reports back', () => {
  skill.expectLaunch('living-room');
  assert.ok(url(skill.handle(req({ type: 'LaunchRequest' }, 'dot-right'))).includes('/stream/living-room/'));
  // resume on the Echo or by voice: same room
  assert.ok(url(skill.handle(req({ type: 'IntentRequest', intent: { name: 'AMAZON.ResumeIntent' } }, 'dot-right'))).includes('/stream/living-room/'));
  assert.ok(url(skill.handle(req({ type: 'LaunchRequest' }, 'dot-right'))).includes('/stream/living-room/'));
  // unknown Echo without a launch from us: default room
  assert.ok(url(skill.handle(req({ type: 'LaunchRequest' }, 'stranger'))).includes('/stream/kitchen/'));
});

test('two rooms at once: known Echos get their own', () => {
  skill.expectLaunch('kitchen');
  skill.expectLaunch('living-room');
  assert.ok(url(skill.handle(req({ type: 'LaunchRequest' }, 'dot-right'))).includes('/stream/living-room/'));
  assert.ok(url(skill.handle(req({ type: 'LaunchRequest' }, 'kitchen-echo'))).includes('/stream/kitchen/'));
});

test('skill code gets the public URL and relay key filled in', () => {
  const code = skill.lambdaCode();
  assert.match(code, /const TARGET = 'https:\/\/echo\.example\.com\/alexa-relay';/);
  assert.doesNotMatch(code, /__RELAY_KEY__|__PUBLIC_URL__/);
});
