// Live stream from AirPlay audio: shairport-sync writes raw PCM (16 bit, 44.1 kHz, stereo) to stdout,
// ffmpeg encodes it to MP3, and every connected listener (an Echo via the skill, VLC on a Fire TV) gets it.
// Without AirPlay audio the stream keeps sending silence so the Echo doesn't drop the connection.
// Every player of a room has its own stream: create(name). setDelay() holds one stream back so that
// two players (skill and Fire TV) sound in sync.
const { spawn } = require('child_process');
const config = require('./config');

const BYTES_PER_SEC = 44100 * 2 * 2;
const TICK_MS = 50;
const PREBUFFER_BYTES = Math.round(BYTES_PER_SEC * 0.15); // small buffer against dropouts
const MAX_BUFFER_BYTES = BYTES_PER_SEC * 2;              // more than 2 s (plus delay): drop the oldest audio
const MAX_DELAY_MS = 3000;
const IDLE_STOP_MS = 60000;                              // stop ffmpeg once nobody listens
const MAX_BACKLOG_BYTES = 256 * 1024;                    // ~10 s of MP3 a listener doesn't take (paused): drop it

function create(name) {
  let chunks = [];      // AirPlay PCM not yet handed to ffmpeg
  let buffered = 0;
  let draining = false; // start playing only once enough is buffered
  let ffmpeg = null;
  let feeder = null;
  let startedAt = 0;
  let written = 0;
  let idleTimer = null;
  let delayBytes = 0;   // extra delay (setDelay)
  const listeners = new Set();
  const stats = { airplayBytes: 0, silenceBytes: 0, dropped: 0, lastAudioAt: 0, level: -96, levelAt: 0 };

  // shairport-sync attenuates by the iPhone volume (flat curve, 30 dB). Undo that so the stream is always
  // at full level; loudness is set on the Echo itself.
  let gain = 1;
  function setAirplayDb(db) {
    if (db <= -100) return; // muted: nothing to compensate
    gain = 10 ** (-Math.max(-30, Math.min(0, db)) / 20);
  }

  function applyGain(buf) {
    if (gain === 1) return buf;
    const out = Buffer.allocUnsafe(buf.length - (buf.length % 2));
    for (let i = 0; i < out.length; i += 2) {
      const v = Math.round(buf.readInt16LE(i) * gain);
      out.writeInt16LE(v > 32767 ? 32767 : v < -32768 ? -32768 : v, i);
    }
    return out;
  }

  // From the AirPlay receiver: always accept, otherwise shairport-sync blocks
  function pushPcm(raw) {
    stats.airplayBytes += raw.length;
    stats.lastAudioAt = Date.now();
    if (!ffmpeg) return; // nobody listening
    const buf = applyGain(raw);
    chunks.push(buf);
    buffered += buf.length;
    while (buffered > MAX_BUFFER_BYTES + delayBytes && chunks.length > 1) {
      const old = chunks.shift();
      buffered -= old.length;
      stats.dropped += old.length;
    }
  }

  function take(bytes) {
    if (!draining && buffered >= PREBUFFER_BYTES + delayBytes) draining = true;
    const out = Buffer.alloc(bytes); // silence where there is nothing
    if (!draining) { stats.silenceBytes += bytes; return out; }
    let pos = 0;
    while (pos < bytes && chunks.length) {
      const head = chunks[0];
      const n = Math.min(head.length, bytes - pos);
      head.copy(out, pos, 0, n);
      pos += n;
      if (n === head.length) chunks.shift(); else chunks[0] = head.subarray(n);
      buffered -= n;
    }
    if (pos < bytes) draining = false; // ran empty: buffer up again
    stats.silenceBytes += bytes - pos;
    return out;
  }

  // Drop the oldest audio (to shrink the delay)
  function drop(bytes) {
    while (bytes > 0 && chunks.length) {
      const head = chunks[0];
      const n = Math.min(head.length, bytes);
      if (n === head.length) chunks.shift(); else chunks[0] = head.subarray(n);
      buffered -= n;
      bytes -= n;
    }
  }

  // Larger: insert a short silence until the buffer is fuller. Smaller: skip the oldest audio.
  function setDelay(ms) {
    const next = Math.round((BYTES_PER_SEC * Math.max(0, Math.min(MAX_DELAY_MS, Number(ms) || 0))) / 1000 / 4) * 4;
    if (next > delayBytes) draining = false;
    else drop(buffered - (PREBUFFER_BYTES + next));
    delayBytes = next;
  }

  // Peak level in dBFS, to see whether music arrives (-96 = silence, 0 = full scale)
  function level(buf) {
    let peak = 0;
    for (let i = 0; i + 1 < buf.length; i += 2) {
      const v = Math.abs(buf.readInt16LE(i));
      if (v > peak) peak = v;
    }
    return peak ? Math.round(20 * Math.log10(peak / 32768)) : -96;
  }

  function startEncoder() {
    if (ffmpeg) return;
    const child = spawn(config.ffmpegBin, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 's16le', '-ar', '44100', '-ac', '2', '-i', 'pipe:0',
      '-c:a', 'libmp3lame', '-b:a', config.streamBitrate, '-f', 'mp3', '-flush_packets', '1', 'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    ffmpeg = child;
    chunks = [];
    buffered = 0;
    draining = false;
    startedAt = Date.now();
    written = 0;
    child.stdout.on('data', (mp3) => {
      for (const res of listeners) {
        if (res.writableLength > MAX_BACKLOG_BYTES) {
          console.log(`[stream ${name}] listener stopped reading, disconnected`);
          listeners.delete(res);
          res.destroy();
        } else {
          res.write(mp3);
        }
      }
    });
    child.stderr.on('data', (d) => console.warn(`[stream ${name}] ffmpeg:`, d.toString().trim().slice(0, 200)));
    child.stdin.on('error', () => {});
    child.on('exit', () => {
      if (ffmpeg === child) stopEncoder();
    });
    // Real-time clock: write as many bytes as are due since the start
    feeder = setInterval(() => {
      const due = Math.floor(((Date.now() - startedAt) * BYTES_PER_SEC) / 1000 / 4) * 4;
      const bytes = Math.min(due - written, BYTES_PER_SEC); // after a hiccup don't catch up everything
      if (bytes <= 0) return;
      const pcm = take(bytes);
      const l = level(pcm);
      stats.level = Date.now() - (stats.levelAt || 0) > 1000 ? l : Math.max(stats.level, l);
      if (Date.now() - (stats.levelAt || 0) > 1000) stats.levelAt = Date.now();
      written = due;
      child.stdin.write(pcm);
    }, TICK_MS);
    console.log(`[stream ${name}] started`);
  }

  function stopEncoder() {
    clearInterval(feeder);
    feeder = null;
    const child = ffmpeg;
    ffmpeg = null;
    chunks = [];
    buffered = 0;
    if (child) { try { child.kill('SIGTERM'); } catch { /* already gone */ } }
    for (const res of listeners) res.end();
    listeners.clear();
    console.log(`[stream ${name}] stopped`);
  }

  // Attach an HTTP listener (Express handler)
  function serve(req, res) {
    clearTimeout(idleTimer);
    startEncoder();
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      'icy-name': 'echobridge',
    });
    listeners.add(res);
    console.log(`[stream ${name}] listener connected (${listeners.size})`);
    req.on('close', () => {
      listeners.delete(res);
      console.log(`[stream ${name}] listener disconnected (${listeners.size})`);
      if (!listeners.size) idleTimer = setTimeout(() => { if (!listeners.size) stopEncoder(); }, IDLE_STOP_MS);
    });
  }

  function status() {
    return {
      running: Boolean(ffmpeg), listeners: listeners.size, level: stats.level,
      airplayAudio: Boolean(stats.lastAudioAt && Date.now() - stats.lastAudioAt < 3000),
      bufferedMs: Math.round((buffered / BYTES_PER_SEC) * 1000), delayMs: Math.round((delayBytes / BYTES_PER_SEC) * 1000),
      droppedMb: +(stats.dropped / 1e6).toFixed(2),
    };
  }

  return {
    name, pushPcm, serve, status, stop: stopEncoder, setAirplayDb, setDelay,
  };
}

module.exports = { create };
