// Fire TV as a player for a room: VLC on the Fire TV plays the stream from the local network, and a Fire TV
// home theater (Fire TV + Echo speakers) spreads the Fire TV's audio in stereo across its Echo speakers.
// Through the skill, home theater speakers play only on one speaker.
// Controlled via ADB over the network (Fire TV: Developer options → ADB debugging on, VLC installed).
const { execFile } = require('child_process');
const config = require('./config');
const store = require('./store');

const VLC = 'org.videolan.vlc';

function adb(args, timeout = 10000) {
  return new Promise((resolve, reject) => {
    // adb keeps its key in $HOME/.android: use the data directory so the Fire TV recognizes us after restarts
    execFile(config.adbBin, args, { timeout, env: { ...process.env, HOME: store.path('') } }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim().slice(0, 200)));
      else resolve(String(stdout).trim());
    });
  });
}

async function connect(host) {
  if (!/^[\w.:-]+$/.test(host)) throw new Error('Invalid Fire TV address');
  const target = host.includes(':') ? host : `${host}:5555`;
  const out = await adb(['connect', target]);
  // "connected to …" or "already connected to …"; the first time the TV asks for permission
  if (!/connected to/.test(out)) throw new Error(`Fire TV not reachable: ${out}`);
  const state = await adb(['-s', target, 'get-state']).catch((err) => err.message);
  if (state !== 'device') throw new Error(`Fire TV: ${state} (confirm "Allow USB debugging" on the TV)`);
  return target;
}

// The URL only contains [A-Za-z0-9:/._-] (the stream key is base64url), so it survives the Fire TV's shell
async function play(host, url) {
  if (!/^http:\/\/[\w.:/-]+$/.test(url)) throw new Error('Invalid stream URL');
  const target = await connect(host);
  return adb(['-s', target, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW',
    '-d', url, '-t', 'audio/mpeg', '-n', `${VLC}/.StartActivity`]);
}

async function stop(host) {
  const target = await connect(host);
  return adb(['-s', target, 'shell', 'am', 'force-stop', VLC]);
}

module.exports = { play, stop, connect };
