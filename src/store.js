// Small JSON store in the data directory (Amazon cookies, skill keys, device mapping, sync offsets)
const fs = require('fs');
const path = require('path');
const { dataDir } = require('./config');

fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

function read(name, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
  } catch {
    return fallback;
  }
}

function write(name, data) {
  const file = path.join(dataDir, name);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}

function remove(name) {
  try { fs.unlinkSync(path.join(dataDir, name)); } catch { /* already gone */ }
}

module.exports = { read, write, remove, path: (name) => path.join(dataDir, name) };
