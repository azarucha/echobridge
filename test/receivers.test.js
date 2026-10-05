// Rooms and players from ROOMS / PLAYERS (src/receivers.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = path.join(os.tmpdir(), 'echobridge-test-receivers');
const { parseRooms, parsePlayers } = require('../src/receivers');

test('name, id and serials per room', () => {
  const rooms = parseRooms('Kitchen=G2A1;  Living room = G09R ;Ganze Wohnung=G2A1, G09R;Écho Café=X');
  assert.deepEqual(rooms.map((r) => [r.id, r.name, r.serials, r.index]), [
    ['kitchen', 'Kitchen', ['G2A1'], 0],
    ['living-room', 'Living room', ['G09R'], 1],
    ['ganze-wohnung', 'Ganze Wohnung', ['G2A1', 'G09R'], 2],
    ['echo-cafe', 'Écho Café', ['X'], 3],
  ]);
});

test('German umlauts and a leading "Echo" in room ids', () => {
  assert.equal(parseRooms('Echo Küche=A')[0].id, 'kueche');
  assert.equal(parseRooms('Echo überall=A')[0].id, 'ueberall');
});

test('no serial and empty configuration', () => {
  assert.deepEqual(parseRooms('Kitchen')[0].serials, []);
  assert.deepEqual(parseRooms(''), []);
});

test('players: Fire TV, skill on one Echo, combined', () => {
  assert.deepEqual(parsePlayers('living-room=firetv:192.168.1.50; everywhere = firetv:192.168.1.50+skill:G2A1'), {
    'living-room': [{ type: 'firetv', target: '192.168.1.50' }],
    everywhere: [{ type: 'firetv', target: '192.168.1.50' }, { type: 'skill', target: 'G2A1' }],
  });
  assert.deepEqual(parsePlayers('kitchen=skill'), { kitchen: [{ type: 'skill', target: '' }] });
});
