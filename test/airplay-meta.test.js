// Parsing the shairport-sync metadata pipe (format: src/airplay-meta.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = path.join(os.tmpdir(), 'echobridge-test-meta');
const { parse, events } = require('../src/airplay-meta');

const hex = (s) => Buffer.from(s, 'latin1').toString('hex');
const item = (type, code, value = '') => {
  const data = Buffer.from(value, 'utf8');
  const body = data.length ? `\n<data encoding="base64">\n${data.toString('base64')}</data>` : '';
  return `<item><type>${hex(type)}</type><code>${hex(code)}</code><length>${data.length}</length>${body}</item>\n`;
};

test('title, artist and events are recognized (with umlauts)', () => {
  const text = item('ssnc', 'mdst') + item('core', 'minm', 'Ohne dich') + item('core', 'asar', 'Celo & Abdi')
    + item('core', 'asal', 'Hinterhofjargon') + item('ssnc', 'mden') + item('ssnc', 'pfls');
  const { items, rest } = parse(text);
  assert.equal(rest, '');
  assert.deepEqual(items.map((i) => `${i.type}/${i.code}`), ['ssnc/mdst', 'core/minm', 'core/asar', 'core/asal', 'ssnc/mden', 'ssnc/pfls']);
  assert.equal(items[1].data.toString('utf8'), 'Ohne dich');
  assert.equal(items[2].data.toString('utf8'), 'Celo & Abdi');
});

test('an incomplete tail is kept for the next chunk', () => {
  const full = item('core', 'minm', 'Köfte');
  const { items, rest } = parse(full + full.slice(0, 40));
  assert.equal(items.length, 1);
  assert.equal(items[0].data.toString('utf8'), 'Köfte');
  const next = parse(rest + full.slice(40));
  assert.equal(next.items.length, 1);
  assert.equal(next.items[0].data.toString('utf8'), 'Köfte');
});

test('events: begin/end at once, title fields bundled', async () => {
  const got = [];
  const handle = events((ev) => got.push(ev));
  const feed = (text) => parse(text).items.forEach(handle);
  feed(item('ssnc', 'pbeg') + item('ssnc', 'mdst') + item('core', 'minm', 'Ohne dich') + item('core', 'asar', 'Celo & Abdi') + item('ssnc', 'mden'));
  feed(item('ssnc', 'mdst') + item('core', 'minm', 'Köfte') + item('ssnc', 'mden')); // no artist: no track
  feed(item('ssnc', 'prsm') + item('ssnc', 'pend'));
  assert.deepEqual(got, [
    { event: 'begin' },
    { track: { title: 'Ohne dich', artist: 'Celo & Abdi' } },
    { event: 'resume' },
    { event: 'end' },
  ]);
});
