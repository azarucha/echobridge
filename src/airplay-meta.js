// Events of an AirPlay receiver: shairport-sync reports title, artist, album and begin/resume/end of
// playback through a named pipe. receivers.js starts and stops the stream on the Echo with them.
// Pipe format: <item><type>hex</type><code>hex</code><length>n</length><data encoding="base64">…</data></item>
const fs = require('fs');
const net = require('net');
const { execFileSync } = require('child_process');

const BUNDLE_DELAY_MS = 400; // title fields arrive one by one, collect them briefly

const ITEM = /<item><type>([0-9a-f]{8})<\/type><code>([0-9a-f]{8})<\/code><length>(\d+)<\/length>(?:\s*<data encoding="base64">\s*([\s\S]*?)<\/data>)?\s*<\/item>/g;
const ascii = (hex) => Buffer.from(hex, 'hex').toString('latin1');

function parse(text) {
  const items = [];
  let last = 0;
  let m;
  ITEM.lastIndex = 0;
  while ((m = ITEM.exec(text))) {
    items.push({ type: ascii(m[1]), code: ascii(m[2]), data: m[4] ? Buffer.from(m[4].replace(/\s+/g, ''), 'base64') : Buffer.alloc(0) });
    last = ITEM.lastIndex;
  }
  const rest = text.slice(last);
  // Keep an incomplete tail, discard garbage before it
  const open = rest.lastIndexOf('<item>');
  return { items, rest: open >= 0 ? rest.slice(open) : '' };
}

function openPipe(path, onItem, onError) {
  try { fs.statSync(path); } catch { execFileSync('mkfifo', ['-m', '600', path]); }
  // Open read-write: the stream doesn't end when shairport-sync restarts
  const fd = fs.openSync(path, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
  let stream;
  try {
    stream = new net.Socket({ fd, readable: true, writable: false });
  } catch {
    stream = fs.createReadStream(null, { fd, autoClose: false });
  }
  let buffer = '';
  stream.setEncoding('latin1');
  stream.on('data', (chunk) => {
    const { items, rest } = parse(buffer + chunk);
    buffer = rest.length > 1e6 ? '' : rest;
    items.forEach(onItem);
  });
  stream.on('error', (err) => onError && onError(err));
}

// Turns the single items into events: { track: {title, artist, album} } and { event: 'begin' | 'resume' | 'end' }
function events(emit) {
  let bundle = {};
  let timer = null;

  function flush() {
    clearTimeout(timer);
    const b = bundle;
    bundle = {};
    if (b.title && b.artist) emit({ track: b });
  }

  return function handle({ type, code, data }) {
    if (type === 'core') {
      if (code === 'minm') bundle.title = data.toString('utf8');
      else if (code === 'asar') bundle.artist = data.toString('utf8');
      else if (code === 'asal') bundle.album = data.toString('utf8');
      else return;
      clearTimeout(timer);
      timer = setTimeout(flush, BUNDLE_DELAY_MS);
      return;
    }
    if (type !== 'ssnc') return;
    if (code === 'mdst') bundle = {};
    else if (code === 'mden') flush();
    else if (code === 'pbeg') emit({ event: 'begin' });
    else if (code === 'prsm') emit({ event: 'resume' });
    else if (code === 'pend') emit({ event: 'end' });
  };
}

module.exports = { parse, openPipe, events };
