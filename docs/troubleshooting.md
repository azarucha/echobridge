# Troubleshooting

Start with:

```bash
sudo echobridge status
journalctl -u echobridge -f
```

## The rooms don't show up in the AirPlay menu

- `status` says `receiver NOT running`: look at the recent events for shairport-sync errors.
- avahi must run: `systemctl status avahi-daemon`.
- Firewall: allow TCP 5000 and up (one port per room) and UDP 6001 and up (100 per room) in your LAN.
- iPhone and echobridge must be in the same network (no guest Wi-Fi, no client isolation).

## Only the first room starts ("could not establish a service on port 5000")

shairport-sync 5.5 ignores the configured port in classic AirPlay mode. echobridge works around it with
`airplay/portshim.so`, which the installer builds with gcc. Check that the file exists and rerun
`sudo ./deploy/install.sh`.

## The Echo doesn't start when I pick the room

- `status` → Amazon must be `ready`. `need-login`: sign in at the shown address. `error`: try
  `sudo echobridge alexa-restart`; if Amazon changed its login, update echobridge (alexa-remote2).
- `Skill: PUBLIC_URL or SKILL_ID missing`: see [setup.md](setup.md).
- The recent events show `open skill on …` but no `LaunchRequest`: say "Alexa, open <invocation>" yourself.
  If that fails too, see the end of [alexa-skill.md](alexa-skill.md).
- A wrong invocation name makes the Echo play something else: Alexa understood the words as a music request.
  Choose one without music words.

## It plays, but silence / very quiet

- `status` → stream level `-96 dBFS` means no audio arrives from the iPhone (is something playing?).
- The Echo's own volume may be low: press the iPhone volume buttons (they change the Echo, not the stream).

## Alexa says she can't reach the skill

The Alexa-hosted code can't reach echobridge: tunnel down, `PUBLIC_URL` changed (paste `echobridge skill-code`
again), or echobridge not running. While the skill is unreachable, comment out `PUBLIC_URL` to keep receivers
from opening the skill on every AirPlay connection (otherwise Alexa resumes whatever played last).

## Audio drops or stutters

Usually network: the Echo fetches the stream through your tunnel. A wired connection for the echobridge machine
helps. `STREAM_BITRATE=128k` lowers the bandwidth.

## Video on the iPhone is out of sync

Expected: echobridge removes most of AirPlay's 2 s buffer (`audio_backend_latency_offset_in_seconds` in
`airplay/shairport-sync.conf`) to cut the music delay. AirPlay video lip sync relies on that buffer.
