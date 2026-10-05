// AirPlay receivers, one per room ("Kitchen", "Living room", "Everywhere"): shairport-sync receives the
// audio from the iPhone, stream.js turns it into a live stream, and the room's players play it:
//   skill            the custom Alexa skill on all Echos of the room (default)
//   skill:<serial>   the skill on this Echo only
//   firetv:<ip>      VLC on a Fire TV (firetv.js), e.g. for stereo in a Fire TV home theater
// Combine players with "+". If skill and Fire TV play together, each gets its own stream and one is delayed
// so both sound in sync (setSync, stored in data/sync.json).
// The iPhone volume buttons change the volume of the room's Echos (relative, 1 press = ECHO_VOLUME_STEP).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const express = require('express');
const config = require('./config');
const meta = require('./airplay-meta');
const store = require('./store');
const stream = require('./stream');
const skill = require('./skill');
const alexa = require('./alexa');
const firetv = require('./firetv');

const ROOT = path.join(__dirname, '..');
const CONF_TEMPLATE = path.join(ROOT, 'airplay', 'shairport-sync.conf');
const HOOK_SCRIPT = path.join(ROOT, 'airplay', 'airplay-hook.sh');
const PORT_SHIM = path.join(ROOT, 'airplay', 'portshim.so');
const HOOK_TOKEN = crypto.randomBytes(24).toString('hex'); // only shared with our own shairport-sync children

const DB_PER_PRESS = 30 / 16;      // iOS: 16 steps from -30 to 0 dB
const MAX_PRESSES_PER_EVENT = 3;   // iOS sometimes merges quick presses
const IDLE_RESET_MS = 120000;      // after a longer pause, start counting fresh
const SEND_DELAY_MS = 150;         // merge quick presses
const STREAM_STOP_MS = 60000;      // AirPlay ended: keep the stream a while in case it continues
const STREAM_RELAUNCH_MS = 600000; // after a long pause, relaunch the skill to be safe
const FIRETV_CHECK_MS = 5000;      // Fire TV: is VLC still playing while music arrives?
const FIRETV_RETRY_MS = 15000;     // restart at most this often

const log = [];
function remember(entry) {
  log.push({ at: new Date().toISOString(), ...entry });
  if (log.length > 80) log.shift();
}

// ---------------------------------------------------------------- Configuration

const slug = (name, i) => name.toLowerCase().replace(/^echo\s+/, '')
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `room${i + 1}`;

// "Kitchen=G2A1;Living room=G09R;Everywhere=G2A1,G09R"
function parseRooms(raw) {
  return String(raw || '').split(';').map((s) => s.trim()).filter(Boolean).map((entry, index) => {
    const [name, serials = ''] = entry.split('=');
    return {
      id: slug(name.trim(), index), name: name.trim(), index,
      serials: serials.split(',').map((s) => s.trim()).filter(Boolean),
    };
  });
}

// "living-room=firetv:192.168.1.50;everywhere=firetv:192.168.1.50+skill:G2A1"
function parsePlayers(raw) {
  const out = {};
  for (const entry of String(raw || '').split(';').map((x) => x.trim()).filter(Boolean)) {
    const [id, list = ''] = entry.split('=').map((x) => x.trim());
    out[id] = list.split('+').map((p) => p.trim()).filter(Boolean).map((p) => {
      const i = p.indexOf(':');
      return i < 0 ? { type: p, target: '' } : { type: p.slice(0, i).trim(), target: p.slice(i + 1).trim() };
    });
  }
  return out;
}

const syncSaved = () => store.read('sync.json', {});

function createRooms() {
  const players = parsePlayers(config.players);
  return parseRooms(config.rooms).map((cfg) => {
    const list = players[cfg.id] || [{ type: 'skill', target: '' }];
    const skills = list.filter((p) => p.type === 'skill');
    const tv = list.find((p) => p.type === 'firetv' && p.target);
    const skillStream = skills.length ? stream.create(cfg.id) : null;
    const tvStream = tv ? stream.create(skillStream ? `${cfg.id}-tv` : cfg.id) : null;
    return {
      ...cfg,
      skillTargets: skills.some((p) => !p.target) ? cfg.serials : skills.map((p) => p.target),
      skillStream,
      firetv: tv ? tv.target : null,
      tvStream,
      streams: [skillStream, tvStream].filter(Boolean),
      sync: Number(syncSaved()[cfg.id]) || 0,
      receiver: null,
      connected: false,
      vol: { baseline: null, lastEventAt: 0, pending: 0, timer: null, sent: {}, echo: {} },
      launchedAt: 0,
      stopTimer: null,
    };
  });
}

let ROOMS = [];
const roomById = (id) => ROOMS.find((r) => r.id === id);

// ---------------------------------------------------------------- Keeping skill and Fire TV in sync

// positive = skill stream that many ms later, negative = Fire TV stream later
function applySync(room) {
  if (!room.skillStream || !room.tvStream) return;
  room.skillStream.setDelay(Math.max(0, room.sync));
  room.tvStream.setDelay(Math.max(0, -room.sync));
}

function setSync(id, ms) {
  const room = roomById(id);
  if (!room || !room.skillStream || !room.tvStream) {
    throw Object.assign(new Error(`Room "${id}" doesn't play on skill and Fire TV together`), { status: 400 });
  }
  room.sync = Math.max(-3000, Math.min(3000, Math.round(Number(ms) || 0)));
  applySync(room);
  store.write('sync.json', { ...syncSaved(), [room.id]: room.sync });
  remember({ room: room.id, sync: room.sync });
  return { room: room.id, syncMs: room.sync };
}

// ---------------------------------------------------------------- Volume buttons

async function refreshEchoVolumes(room) {
  for (const serial of room.serials) {
    const volume = await alexa.getVolume(serial).catch(() => null);
    if (typeof volume === 'number') room.vol.echo[serial] = volume;
  }
}

function onVolume(room, db) {
  room.streams.forEach((st) => st.setAirplayDb(db)); // undo shairport-sync's attenuation in the stream
  const v = room.vol;
  const level = db <= -100 ? -30 : Math.max(-30, Math.min(0, db)); // -144 = muted
  const fresh = v.baseline === null || Date.now() - v.lastEventAt > IDLE_RESET_MS;
  v.lastEventAt = Date.now();
  room.connected = true;
  if (fresh) {
    // The first event after connecting is the iPhone's current volume, not a button press
    v.baseline = level;
    v.pending = 0;
    refreshEchoVolumes(room);
    return;
  }
  const raw = (level - v.baseline) / DB_PER_PRESS;
  v.baseline = level;
  if (Math.abs(raw) < 0.4) return;
  v.pending += Math.max(-MAX_PRESSES_PER_EVENT, Math.min(MAX_PRESSES_PER_EVENT, raw));
  clearTimeout(v.timer);
  // Relative per Echo: several Echos in one room keep their difference
  v.timer = setTimeout(() => {
    const steps = Math.round(v.pending * config.echoVolumeStep);
    v.pending = 0;
    if (!steps) return;
    for (const serial of room.serials) {
      const sent = v.sent[serial];
      const known = typeof v.echo[serial] === 'number' ? v.echo[serial] : 30;
      const from = sent && Date.now() - sent.at < 30000 ? sent.value : known;
      const value = Math.max(0, Math.min(100, from + steps));
      v.sent[serial] = { value, at: Date.now() };
      v.echo[serial] = value;
      remember({ room: room.id, serial, volume: value });
      alexa.setVolume(serial, value).catch((err) => remember({ room: room.id, error: err.message }));
    }
  }, SEND_DELAY_MS);
}

function onSession(room, event) {
  Object.assign(room.vol, { baseline: null, pending: 0, sent: {} });
  room.connected = event === 'start';
  remember({ room: room.id, session: event });
}

// ---------------------------------------------------------------- Starting and stopping the players

function startFiretv(room, why) {
  room.firetvStartAt = Date.now();
  remember({ room: room.id, action: `start VLC on Fire TV ${room.firetv}${why ? ` (${why})` : ''}` });
  firetv.play(room.firetv, skill.localUrl(room.tvStream.name)).catch((err) => remember({ room: room.id, error: err.message }));
}

// Switching the TV off pauses VLC on the Fire TV. If audio keeps arriving but nobody listens, restart VLC.
function watchFiretv() {
  for (const room of ROOMS) {
    if (!room.firetv || !room.launchedAt) continue;
    const st = room.tvStream.status();
    if (st.airplayAudio && st.listeners === 0 && Date.now() - (room.firetvStartAt || 0) > FIRETV_RETRY_MS) {
      startFiretv(room, 'VLC stopped');
    }
  }
}

function streamBegin(room, force) {
  clearTimeout(room.stopTimer);
  const useSkill = room.skillStream && skill.status().configured;
  if (!useSkill && !room.firetv) return;
  if (!force && Date.now() - room.launchedAt < STREAM_RELAUNCH_MS) return;
  room.launchedAt = Date.now();
  if (room.firetv) startFiretv(room);
  if (!useSkill) return;
  for (const serial of room.skillTargets) {
    remember({ room: room.id, action: `open skill on ${serial}` });
    skill.launchOn(serial, room.skillStream.name).catch((err) => remember({ room: room.id, error: err.message }));
  }
}

function streamEnd(room) {
  clearTimeout(room.stopTimer);
  room.stopTimer = setTimeout(() => {
    room.launchedAt = 0;
    if (room.firetv) {
      remember({ room: room.id, action: `stop VLC on Fire TV ${room.firetv}` });
      firetv.stop(room.firetv).catch((err) => remember({ room: room.id, error: err.message }));
    }
    if (!room.skillStream) return;
    for (const serial of room.skillTargets) {
      remember({ room: room.id, action: `pause ${serial}` });
      skill.stopOn(serial).catch(() => {});
    }
  }, STREAM_STOP_MS);
}

function onMeta(room, ev) {
  if (ev.track) {
    remember({ room: room.id, track: `${ev.track.title} – ${ev.track.artist}` });
    return;
  }
  remember({ room: room.id, event: ev.event });
  if (ev.event === 'begin') streamBegin(room, true);
  else if (ev.event === 'resume') streamBegin(room, false);
  else if (ev.event === 'end') streamEnd(room);
}

// ---------------------------------------------------------------- Receivers (shairport-sync)
// One per room with its own configuration (port, UDP ports, hooks carrying the room id).

function confFor(room) {
  const hook = HOOK_SCRIPT.replace(/"/g, '');
  const conf = fs.readFileSync(CONF_TEMPLATE, 'utf8')
    .replace(/__HOOK__ volume /, `${hook} volume/${room.id} `)
    .replace(/__HOOK__ session (start|end)/g, `${hook} session/${room.id} $1`)
    .replace(/general\s*=\s*\{/, `general = {\n  port = ${5000 + room.index};\n  udp_port_base = ${6001 + room.index * 100};\n  udp_port_range = 100;`);
  const file = store.path(`shairport-${room.id}.conf`);
  fs.writeFileSync(file, conf);
  return file;
}

function startReceiver(room) {
  if (room.receiver) return;
  if (room.index > 0 && !fs.existsSync(PORT_SHIM)) {
    remember({ room: room.id, error: 'airplay/portshim.so is missing (run the installer), only one receiver possible' });
    return;
  }
  const pipe = store.path(`metadata-${room.id}`);
  if (!room.pipeOpen) {
    try {
      meta.openPipe(pipe, meta.events((ev) => onMeta(room, ev)), (err) => remember({ room: room.id, error: err.message }));
      room.pipeOpen = true;
    } catch (err) {
      remember({ room: room.id, error: `metadata pipe: ${err.message}` });
    }
  }
  let conf;
  try {
    conf = confFor(room);
  } catch (err) {
    remember({ room: room.id, error: `configuration: ${err.message}` });
    return;
  }
  // shairport-sync 5.5 always overwrites the port with 5000 in classic AirPlay mode: from the second receiver
  // on, airplay/portshim.so (built by the installer) rewrites it to SPS_PORT
  const env = { ...process.env, HOOK_TOKEN, HOOK_PORT: String(config.hookPort) };
  if (room.index > 0) Object.assign(env, { LD_PRELOAD: PORT_SHIM, SPS_PORT: String(5000 + room.index) });
  const child = spawn(config.shairportBin, ['-c', conf, '--metadata-enable', `--metadata-pipename=${pipe}`, '-a', room.name], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Always consume the PCM, otherwise shairport-sync blocks; it's only encoded while someone listens
  child.stdout.on('data', (pcm) => room.streams.forEach((st) => st.pushPcm(pcm)));
  room.receiver = child;
  remember({ room: room.id, receiver: 'started' });
  child.stderr.on('data', (d) => {
    const text = d.toString().trim();
    if (!/D-Bus|MPRIS|realtime properties/.test(text)) remember({ room: room.id, shairport: text.slice(0, 200) });
  });
  child.on('error', (err) => remember({ room: room.id, error: `shairport-sync: ${err.message}` }));
  child.on('exit', (code, signal) => {
    if (room.receiver === child) room.receiver = null;
    room.connected = false;
    remember({ room: room.id, receiver: 'exited', code, signal });
    setTimeout(() => startReceiver(room), 5000); // crashed: restart
  });
}

// ---------------------------------------------------------------- Start

// Hooks from our shairport-sync children: local only, protected by a random token
function startHookServer() {
  const app = express();
  app.use((req, res, next) => (req.get('X-Hook-Token') === HOOK_TOKEN ? next() : res.status(403).end()));
  app.post('/hook/volume/:room/:db', (req, res) => {
    const room = roomById(req.params.room);
    const db = Number(req.params.db);
    if (room && Number.isFinite(db)) onVolume(room, db);
    res.end();
  });
  app.post('/hook/session/:room/:event', (req, res) => {
    const room = roomById(req.params.room);
    if (room) onSession(room, req.params.event);
    res.end();
  });
  return new Promise((resolve) => app.listen(config.hookPort, '127.0.0.1', resolve));
}

async function start() {
  ROOMS = createRooms();
  if (!ROOMS.length) {
    console.log('[receivers] ROOMS is empty, no AirPlay receivers');
    return;
  }
  ROOMS.forEach((room) => {
    room.streams.forEach((st) => skill.addStream(st.name, st));
    applySync(room);
  });
  await startHookServer();
  ROOMS.forEach(startReceiver);
  setInterval(watchFiretv, FIRETV_CHECK_MS).unref();
  console.log(`[receivers] AirPlay receivers: ${ROOMS.map((r) => r.name).join(', ')}`);
}

function status() {
  return ROOMS.map((r) => ({
    id: r.id, name: r.name, echos: r.serials, skill: r.skillStream ? r.skillTargets : [], firetv: r.firetv,
    syncMs: r.sync, receiver: Boolean(r.receiver), connected: r.connected,
    streams: Object.fromEntries(r.streams.map((st) => [st.name, st.status()])),
  }));
}

module.exports = {
  start, status, setSync, parseRooms, parsePlayers, log: () => log,
};
