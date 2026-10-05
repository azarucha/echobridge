// Code for the Alexa-hosted skill (developer console → Code tab → lambda/index.js).
// Forwards every request from Alexa to your echobridge and returns its answer.
// Don't edit by hand: "echobridge skill-code" prints this file with your address and relay key filled in.
const https = require('https');

const TARGET = '__PUBLIC_URL__/alexa-relay';
const RELAY_KEY = '__RELAY_KEY__';

const fallback = (text) => ({
  version: '1.0',
  response: { outputSpeech: { type: 'PlainText', text }, shouldEndSession: true },
});

exports.handler = (event) => new Promise((resolve) => {
  const body = JSON.stringify(event);
  const req = https.request(TARGET, {
    method: 'POST',
    timeout: 6000,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Relay-Key': RELAY_KEY },
  }, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { resolve(fallback('echobridge sent an unreadable answer.')); }
    });
  });
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.on('error', () => resolve(fallback('echobridge at home is not answering right now.')));
  req.end(body);
});
