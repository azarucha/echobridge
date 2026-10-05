// The custom Alexa skill: plays a room's live stream (stream.js) on the Echo.
// Runs on its own port, which is the only thing published to the internet (PUBLIC_URL):
//   POST /alexa-relay              requests from Amazon, forwarded by the Alexa-hosted skill (skill/lambda/index.js)
//   GET  /stream/<room>/<key>.mp3  the audio
// Setup: docs/alexa-skill.md
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('./config');
const store = require('./store');
const alexa = require('./alexa');

const log = [];
function remember(entry) {
  log.push({ at: new Date().toISOString(), ...entry });
  if (log.length > 40) log.shift();
}

// Random secrets, created on first use and kept in data/skill.json
function secretValue(name, bytes) {
  let cfg = store.read('skill.json', {});
  if (!cfg[name]) {
    cfg = { ...cfg, [name]: crypto.randomBytes(bytes).toString('base64url') };
    store.write('skill.json', cfg);
  }
  return cfg[name];
}
const streamKey = () => secretValue('streamKey', 18); // secret part of the stream URL
const relayKey = () => secretValue('relayKey', 24);   // shared with the Alexa-hosted skill

const streamUrl = (room) => `${config.publicUrl}/stream/${room}/${streamKey()}.mp3`;
// Inside the LAN, without the detour through the tunnel (for the Fire TV)
const localUrl = (room) => `http://${config.hostIp}:${config.skillPort}/stream/${room}/${streamKey()}.mp3`;

function sameSecret(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- Which Echo plays which room
// Amazon only sends a skill-specific device ID, no serial number. When launchOn() opens the skill we
// remember the room and assign it to the device ID of the next LaunchRequest.

const streams = new Map(); // stream name -> stream (stream.js), the first one is the default
const PENDING_MS = 20000;
let pending = [];          // launched rooms that haven't reported back yet

function addStream(name, s) {
  streams.set(name, s);
}

function expectLaunch(room) {
  pending = pending.filter((p) => Date.now() - p.at < PENDING_MS);
  pending.push({ room, at: Date.now() });
}

const defaultRoom = () => streams.keys().next().value || 'airplay';

function roomFor(type, deviceId) {
  const cfg = store.read('skill.json', {});
  const devices = cfg.devices || {};
  if (type === 'LaunchRequest') {
    pending = pending.filter((p) => Date.now() - p.at < PENDING_MS);
    // Two rooms launched at once: known Echos get their own room
    const mine = pending.findIndex((p) => p.room === devices[deviceId]);
    const [next] = pending.splice(mine >= 0 ? mine : 0, 1);
    if (next && deviceId) {
      if (devices[deviceId] !== next.room) store.write('skill.json', { ...cfg, devices: { ...devices, [deviceId]: next.room } });
      return next.room;
    }
    if (next) return next.room;
  }
  const known = deviceId && devices[deviceId];
  return known && streams.has(known) ? known : defaultRoom();
}

// ---------------------------------------------------------------- Responses

const HELP = config.alexaLanguage.startsWith('de')
  ? 'Wähle am iPhone per AirPlay den Raum aus, dann läuft der Ton hier.'
  : 'Choose this room as AirPlay output on your iPhone and the audio plays here.';

const reply = (directives = [], speech = null) => ({
  version: '1.0',
  response: {
    ...(speech ? { outputSpeech: { type: 'PlainText', text: speech } } : {}),
    ...(directives.length ? { directives } : {}),
    shouldEndSession: true,
  },
});

const play = (room) => reply([{
  type: 'AudioPlayer.Play',
  playBehavior: 'REPLACE_ALL',
  audioItem: {
    stream: { url: streamUrl(room), token: `airplay-${room}-${Date.now()}`, offsetInMilliseconds: 0 },
    metadata: { title: 'AirPlay', subtitle: 'echobridge' },
  },
}]);
const stop = () => reply([{ type: 'AudioPlayer.Stop' }]);

function handle(body) {
  const r = body.request || {};
  const intent = r.intent && r.intent.name;
  const device = body.context && body.context.System && body.context.System.device;
  const room = () => roomFor(r.type, device && device.deviceId);
  remember({ type: r.type, intent, error: r.error && r.error.message });
  switch (r.type) {
    case 'LaunchRequest': {
      const target = room();
      remember({ room: target });
      return play(target);
    }
    case 'IntentRequest':
      if (['AMAZON.PauseIntent', 'AMAZON.StopIntent', 'AMAZON.CancelIntent'].includes(intent)) return stop();
      if (['AMAZON.ResumeIntent', 'AMAZON.StartOverIntent', 'PlayStreamIntent'].includes(intent)) return play(room());
      if (intent === 'AMAZON.HelpIntent') return reply([], HELP);
      return reply(); // next, previous, shuffle … don't exist for a live stream
    case 'PlaybackController.PlayCommandIssued':
      return play(room());
    case 'PlaybackController.PauseCommandIssued':
      return stop();
    default:
      // AudioPlayer.PlaybackStarted/Stopped/Failed, SessionEndedRequest, System.ExceptionEncountered:
      // Amazon only wants an empty acknowledgement
      return { version: '1.0', response: {} };
  }
}

// ---------------------------------------------------------------- Server and control

function start() {
  const app = express();
  app.disable('x-powered-by');
  // Log every request (without the stream key) to see whether Amazon gets through
  app.use((req, res, next) => {
    if (!req.path.startsWith('/stream/')) remember({ hit: `${req.method} ${req.path}` });
    next();
  });
  app.post('/alexa-relay', express.json({ limit: '1mb' }), (req, res) => {
    if (!sameSecret(req.get('X-Relay-Key'), relayKey())) {
      remember({ rejected: 'wrong relay key' });
      return res.status(404).end();
    }
    const appId = req.body && req.body.context && req.body.context.System && req.body.context.System.application
      && req.body.context.System.application.applicationId;
    if (config.skillId && appId !== config.skillId) {
      remember({ rejected: 'foreign skill' });
      return res.status(400).json({ error: 'rejected' });
    }
    res.json(handle(req.body));
  });
  app.get('/stream/:room/:key.mp3', (req, res) => {
    const s = streams.get(req.params.room);
    if (!s || !sameSecret(req.params.key, streamKey())) return res.status(404).end();
    s.serve(req, res);
  });
  app.use((req, res) => res.status(404).end());
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    remember({ error: err.message, status: err.status });
    res.status(err.status || 500).json({ error: 'error' });
  });
  relayKey();
  app.listen(config.skillPort, '0.0.0.0', () => console.log(`[skill] Listening on port ${config.skillPort}${config.publicUrl ? `, public ${config.publicUrl}` : ' (PUBLIC_URL not set yet)'}`));
}

// Open the skill on an Echo, as if someone said "Alexa, open …"
async function launchOn(serial, room = defaultRoom()) {
  if (!config.publicUrl) throw new Error('PUBLIC_URL is not set');
  if (!streams.has(room)) throw Object.assign(new Error(`Unknown room: ${room}`), { status: 404 });
  remember({ launch: serial, room });
  expectLaunch(room);
  return alexa.textCommand(serial, `${config.openWord} ${config.invocation}`);
}

async function stopOn(serial) {
  remember({ stop: serial });
  return alexa.pause(serial).catch(() => alexa.stopDevice(serial));
}

// Code for the Alexa-hosted skill with this installation's address and relay key filled in
function lambdaCode() {
  if (!config.publicUrl) throw new Error('PUBLIC_URL is not set');
  return fs.readFileSync(path.join(__dirname, '..', 'skill', 'lambda', 'index.js'), 'utf8')
    .replace('__PUBLIC_URL__', config.publicUrl)
    .replace('__RELAY_KEY__', relayKey());
}

function status() {
  return {
    configured: Boolean(config.publicUrl && config.skillId), publicUrl: config.publicUrl || null, invocation: config.invocation,
    streams: Object.fromEntries([...streams].map(([room, s]) => [room, s.status()])),
    devices: Object.keys(store.read('skill.json', {}).devices || {}).length, log: log.slice(-20),
  };
}

module.exports = {
  start, launchOn, stopOn, status, addStream, expectLaunch, handle, localUrl, lambdaCode,
};
