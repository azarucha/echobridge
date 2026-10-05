#!/usr/bin/env node
// Command line for a running echobridge (talks to the local control API on CONTROL_PORT)
const fs = require('fs');

// Same settings as the service (CONTROL_PORT etc.), if the file is readable (it's root-only: use sudo)
try {
  const file = process.env.ECHOBRIDGE_ENV || '/etc/echobridge/echobridge.env';
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
} catch { /* defaults */ }

const config = require('../src/config');

const USAGE = `Usage: echobridge <command>

  status                 Amazon login, receivers, streams and recent events
  devices                Your Alexa devices with serial numbers (for ROOMS)
  skill-code             Code for the Alexa-hosted skill, with your URL and relay key filled in
  sync <room> <ms>       Align skill and Fire TV in a combined room (positive = skill later)
  launch <serial> [room] Open the skill on an Echo by hand
  stop <serial>          Pause an Echo
  firetv-pair <ip>       Connect to a Fire TV via ADB (confirm the prompt on the TV)
  alexa-restart          Restart the Amazon connection (e.g. to sign in again)`;

async function call(method, path) {
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${config.controlPort}${path}`, { method });
  } catch {
    throw new Error(`echobridge is not running (nothing on 127.0.0.1:${config.controlPort})`);
  }
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try { message = JSON.parse(text).error; } catch { /* plain text */ }
    throw new Error(message);
  }
  return res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text;
}

function printStatus(s) {
  const a = s.alexa;
  console.log(`Amazon:  ${a.state}${a.url ? ` → sign in at ${a.url}` : ''}${a.message ? ` (${a.message})` : ''}`);
  console.log(`Skill:   ${s.skill.configured ? `configured, ${s.skill.publicUrl}` : 'PUBLIC_URL or SKILL_ID missing'}, invocation "${s.skill.invocation}", ${s.skill.devices} Echo(s) known`);
  for (const r of s.rooms) {
    const players = [...(r.skill.length ? [`skill on ${r.skill.join(', ')}`] : []), ...(r.firetv ? [`Fire TV ${r.firetv}`] : [])];
    console.log(`\n"${r.name}" (${r.id})  receiver ${r.receiver ? 'running' : 'NOT running'}${r.connected ? ', iPhone connected' : ''}`);
    console.log(`  plays on: ${players.join(' + ') || 'nothing'}${r.syncMs ? `, sync ${r.syncMs} ms` : ''}`);
    for (const [name, st] of Object.entries(r.streams)) {
      console.log(`  stream ${name}: ${st.running ? `${st.listeners} listener(s), level ${st.level} dBFS, buffer ${st.bufferedMs} ms` : 'idle'}`);
    }
  }
  if (s.log.length) {
    console.log('\nRecent events:');
    for (const e of s.log.slice(-12)) {
      const { at, ...rest } = e;
      console.log(`  ${at.slice(11, 19)} ${JSON.stringify(rest)}`);
    }
  }
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const q = encodeURIComponent;
  switch (cmd) {
    case 'status': return printStatus(await call('GET', '/status'));
    case 'devices':
      for (const d of await call('GET', '/devices')) {
        console.log(`${d.serial.padEnd(34)} ${d.name}  [${d.family}${d.members.length ? `, group of ${d.members.length}` : ''}]`);
      }
      return undefined;
    case 'skill-code': return console.log(await call('GET', '/skill-code'));
    case 'sync':
      if (!args[0] || args[1] === undefined) throw new Error('Usage: echobridge sync <room> <ms>');
      return console.log(await call('POST', `/sync?room=${q(args[0])}&ms=${q(args[1])}`));
    case 'launch':
      if (!args[0]) throw new Error('Usage: echobridge launch <serial> [room]');
      return console.log(await call('POST', `/launch?serial=${q(args[0])}${args[1] ? `&room=${q(args[1])}` : ''}`));
    case 'stop':
      if (!args[0]) throw new Error('Usage: echobridge stop <serial>');
      return console.log(await call('POST', `/stop?serial=${q(args[0])}`));
    case 'firetv-pair':
      if (!args[0]) throw new Error('Usage: echobridge firetv-pair <ip>');
      return console.log(await call('POST', `/firetv/pair?host=${q(args[0])}`));
    case 'alexa-restart': return console.log(await call('POST', '/alexa/restart'));
    default:
      console.log(USAGE);
      return process.exit(cmd ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
