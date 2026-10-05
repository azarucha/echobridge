// Talks to the Echos through Amazon's unofficial Alexa web API (alexa-remote2): opens the skill on an
// Echo ("open my sound bridge"), pauses it and sets its volume.
// First start: alexa-remote2 runs a login proxy at http://HOST_IP:LOGIN_PORT/ where you sign in to Amazon once.
const AlexaRemote = require('alexa-remote2');
const config = require('./config');
const store = require('./store');

let alexa = null;
let status = { state: 'stopped' };

// Amazon sometimes answers only after almost a minute: give up earlier so commands don't pile up
const CALL_TIMEOUT_MS = 15000;
const promisify = (fn, timeoutMs = CALL_TIMEOUT_MS) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Alexa did not answer')), timeoutMs);
  fn((err, res) => {
    clearTimeout(timer);
    if (err) reject(err); else resolve(res);
  });
});

function start() {
  stop();
  const saved = store.read('alexa.json');
  const instance = new AlexaRemote();
  alexa = instance;
  status = { state: 'starting' };

  instance.on('cookie', () => {
    if (instance.cookieData) store.write('alexa.json', instance.cookieData);
  });

  instance.init({
    cookie: saved || undefined,
    macDms: saved ? saved.macDms : undefined,
    proxyOnly: true,
    proxyOwnIp: config.hostIp,
    proxyPort: config.loginPort,
    proxyLogLevel: 'warn',
    formerDataStorePath: store.path('alexa-former-data.json'),
    amazonPage: config.amazonPage,
    acceptLanguage: config.alexaLanguage,
    alexaServiceHost: config.alexaServiceHost,
    bluetooth: false,
    notifications: false,
    useWsMqtt: false,
    usePushConnection: false,
    logger: config.debug ? (msg) => console.log('[alexa-remote]', msg) : undefined,
  }, (err) => {
    if (instance !== alexa) return;
    if (err) {
      // On the first login the library reports the proxy address as an "error" and calls the
      // same callback again once the login succeeded
      if (/Please open http/i.test(err.message)) {
        status = { state: 'need-login', url: `http://${config.hostIp}:${config.loginPort}/` };
        console.log(`[alexa] Sign in to Amazon once: open ${status.url} in a browser`);
      } else {
        status = { state: 'error', message: err.message };
        console.error('[alexa] Start failed:', err.message);
      }
      return;
    }
    if (instance.cookieData) store.write('alexa.json', instance.cookieData);
    status = { state: 'ready' };
    console.log(`[alexa] Connected, ${Object.keys(instance.serialNumbers).length} devices`);
  });
  return status;
}

function stop() {
  if (!alexa) return;
  try { alexa.stop(); } catch { /* ignore */ }
  try { alexa.stopProxyServer(); } catch { /* ignore */ }
  alexa = null;
}

function find(serial) {
  if (!alexa || status.state !== 'ready') {
    throw Object.assign(new Error('Not signed in to Amazon yet (see "echobridge status")'), { status: 503 });
  }
  const dev = alexa.find(serial);
  if (!dev) throw Object.assign(new Error(`Unknown device: ${serial}`), { status: 404 });
  return dev;
}

async function textCommand(serial, text) {
  find(serial);
  return promisify((cb) => alexa.sendSequenceCommand(serial, 'textCommand', text, cb));
}

async function pause(serial) {
  const dev = find(serial);
  try {
    return await promisify((cb) => alexa.sendCommand(serial, 'pause', null, cb));
  } catch (err) {
    // Groups and stereo pairs: send to every member
    if (!(dev.clusterMembers || []).length) throw err;
    return Promise.all(dev.clusterMembers.map((m) => promisify((cb) => alexa.sendCommand(m, 'pause', null, cb)).catch(() => null)));
  }
}

async function stopDevice(serial) {
  find(serial);
  return promisify((cb) => alexa.sendSequenceCommand(serial, 'deviceStop', null, cb));
}

async function setVolume(serial, value) {
  const dev = find(serial);
  const level = Math.max(0, Math.min(100, Math.round(value)));
  try {
    return await promisify((cb) => alexa.sendSequenceCommand(serial, 'volume', level, cb));
  } catch (err) {
    if (!(dev.clusterMembers || []).length) throw err;
    return Promise.all(dev.clusterMembers.map((m) => promisify((cb) => alexa.sendSequenceCommand(m, 'volume', level, cb)).catch(() => null)));
  }
}

async function getVolume(serial) {
  find(serial);
  const res = await promisify((cb) => alexa.getPlayerInfo(serial, cb));
  const p = (res && res.playerInfo) || {};
  return p.volume && typeof p.volume.volume === 'number' ? p.volume.volume : null;
}

function devices() {
  if (!alexa || status.state !== 'ready') return [];
  return Object.values(alexa.serialNumbers).map((d) => ({
    serial: d.serialNumber,
    name: d.accountName,
    family: d.deviceFamily,
    type: d.deviceTypeFriendlyName || d.deviceType,
    online: d.online,
    members: d.clusterMembers || [],
    memberOf: d.parentClusters || [],
  })).sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
  start, stop, textCommand, pause, stopDevice, setVolume, getVolume, devices, status: () => status,
};
