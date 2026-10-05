// All settings come from environment variables (see .env.example). systemd loads them from
// /etc/echobridge/echobridge.env, for development you can export them in your shell.
const path = require('path');

const env = (name, fallback = '') => (process.env[name] === undefined || process.env[name] === '' ? fallback : process.env[name]);
const num = (name, fallback) => Number(env(name, String(fallback)));

// Amazon region: login page, Alexa API host, language, and the word that opens a skill
const REGIONS = {
  'amazon.de': { serviceHost: 'layla.amazon.de', language: 'de-DE', openWord: 'öffne' },
  'amazon.co.uk': { serviceHost: 'alexa.amazon.co.uk', language: 'en-GB', openWord: 'open' },
  'amazon.com': { serviceHost: 'pitangui.amazon.com', language: 'en-US', openWord: 'open' },
};
const amazonPage = env('AMAZON_PAGE', 'amazon.de');
const region = REGIONS[amazonPage] || REGIONS['amazon.com'];

module.exports = {
  // Receivers: "Kitchen=<echo serial>;Living room=<serial>;Everywhere=<serial>,<serial>"
  rooms: env('ROOMS'),
  // Who plays a room, combine with "+": skill | skill:<serial> | firetv:<ip>. Default: skill on the room's Echos
  players: env('PLAYERS'),

  hostIp: env('HOST_IP', '127.0.0.1'),            // LAN address of this machine (Fire TV, Amazon login)
  dataDir: path.resolve(env('DATA_DIR', path.join(__dirname, '..', 'data'))),

  publicUrl: env('PUBLIC_URL').replace(/\/$/, ''), // https address that reaches SKILL_PORT (e.g. Cloudflare Tunnel)
  skillId: env('SKILL_ID'),                        // amzn1.ask.skill....
  invocation: env('SKILL_INVOCATION', 'my sound bridge'),

  amazonPage,
  alexaServiceHost: env('ALEXA_SERVICE_HOST', region.serviceHost),
  alexaLanguage: env('ALEXA_LANGUAGE', region.language),
  openWord: env('SKILL_OPEN_WORD', region.openWord),

  shairportBin: env('SHAIRPORT_BIN', 'shairport-sync'),
  ffmpegBin: env('FFMPEG_BIN', 'ffmpeg'),
  adbBin: env('ADB_BIN', 'adb'),

  controlPort: num('CONTROL_PORT', 8095), // local control API for the CLI, 127.0.0.1 only
  hookPort: num('HOOK_PORT', 8097),       // shairport-sync hooks, 127.0.0.1 only
  skillPort: num('SKILL_PORT', 8098),     // skill relay and audio streams, published via PUBLIC_URL
  loginPort: num('LOGIN_PORT', 3456),     // Amazon login proxy (first start only)

  streamBitrate: env('STREAM_BITRATE', '192k'),
  echoVolumeStep: num('ECHO_VOLUME_STEP', 4), // Echo volume steps per iPhone volume button press
  debug: Boolean(env('DEBUG')),
};
