// echobridge: AirPlay from your iPhone to Amazon Echo speakers
const express = require('express');
const config = require('./config');
const alexa = require('./alexa');
const skill = require('./skill');
const receivers = require('./receivers');
const firetv = require('./firetv');

// Local control API for the CLI (bin/echobridge), reachable from this machine only
function startControl() {
  const app = express();
  app.disable('x-powered-by');
  const wrap = (fn) => async (req, res) => {
    try {
      const result = await fn(req);
      if (typeof result === 'string') res.type('text/plain').send(result);
      else res.json(result === undefined ? { ok: true } : result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  };
  app.get('/status', wrap(() => ({ alexa: alexa.status(), skill: skill.status(), rooms: receivers.status(), log: receivers.log().slice(-30) })));
  app.get('/devices', wrap(() => alexa.devices()));
  app.get('/skill-code', wrap(() => skill.lambdaCode()));
  app.post('/sync', wrap((req) => receivers.setSync(String(req.query.room || ''), req.query.ms)));
  app.post('/launch', wrap((req) => skill.launchOn(String(req.query.serial || ''), req.query.room ? String(req.query.room) : undefined)));
  app.post('/stop', wrap((req) => skill.stopOn(String(req.query.serial || ''))));
  app.post('/firetv/pair', wrap((req) => firetv.connect(String(req.query.host || ''))));
  app.post('/alexa/restart', wrap(() => alexa.start()));
  app.listen(config.controlPort, '127.0.0.1');
}

async function main() {
  console.log('[echobridge] starting');
  alexa.start();
  skill.start();
  startControl();
  await receivers.start();
}

process.on('SIGTERM', () => process.exit(0));
main().catch((err) => {
  console.error('[echobridge] failed to start:', err);
  process.exit(1);
});
