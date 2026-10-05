# Setup

Plan about 30 to 45 minutes. You'll need: an always-on Linux machine (Debian, Ubuntu, Raspberry Pi OS),
your Amazon account, a domain on Cloudflare (or another way to get a public HTTPS address) and your iPhone.

## 1. Install

```bash
git clone https://github.com/azarucha/echobridge.git && cd echobridge
sudo ./deploy/install.sh
```

The installer installs shairport-sync, avahi, ffmpeg, adb and gcc, copies echobridge to `/opt/echobridge`,
creates the `echobridge` service and a configuration at `/etc/echobridge/echobridge.env`.
Updating later: `git pull && sudo ./deploy/install.sh`.

> shairport-sync needs the `stdout` audio backend and metadata support. echobridge was tested with 5.5. If your
> distribution ships an old version without them, build shairport-sync from source
> ([instructions](https://github.com/mikebrady/shairport-sync/blob/master/BUILD.md)) with
> `--with-stdout --with-metadata --with-avahi`.

## 2. Basic configuration and Amazon sign-in

Edit `/etc/echobridge/echobridge.env`:

```ini
HOST_IP=192.168.1.10     # this machine's LAN address
AMAZON_PAGE=amazon.de    # amazon.de, amazon.co.uk or amazon.com
```

Start the service and check its state:

```bash
sudo systemctl start echobridge
sudo echobridge status
```

On the first start `status` shows `Amazon: need-login → sign in at http://192.168.1.10:3456/`. Open that page
in a browser in your network and sign in to Amazon (with two-factor authentication if enabled). The login
cookie is stored in `/var/lib/echobridge/alexa.json`; you only need to do this again if Amazon logs you out.

Now list your devices:

```bash
sudo echobridge devices
```

Note the serial numbers of the Echos you want to use (the first column).

## 3. Public address for the skill

The Echo fetches the audio stream from the internet side, and Amazon's skill servers need to reach echobridge.
echobridge's skill port (`SKILL_PORT`, default 8098) has to be reachable at an HTTPS address. Only two kinds of
requests are accepted there: skill requests carrying the secret relay key, and stream URLs carrying a secret key.

With Cloudflare Tunnel (free, no open router ports):

1. Cloudflare dashboard → Zero Trust → Networks → Tunnels → create a tunnel and install `cloudflared` on the
   machine as shown there (or use an existing tunnel).
2. Add a public hostname, e.g. `echobridge.example.com` → service `http://localhost:8098`.
3. Put it into the configuration: `PUBLIC_URL=https://echobridge.example.com`

Test: `curl -s -o /dev/null -w '%{http_code}' https://echobridge.example.com/` should print `404` (that's
echobridge answering).

## 4. The private Alexa skill

Follow **[alexa-skill.md](alexa-skill.md)**, then set `SKILL_ID` and `SKILL_INVOCATION`.

## 5. Rooms

```ini
ROOMS=Kitchen=G000000000000000;Bedroom=G000000000000001
```

Every entry becomes an AirPlay receiver with that name. Several Echos in one room: separate serials with commas;
the skill opens on all of them and the volume buttons change all of them.

Restart and check:

```bash
sudo systemctl restart echobridge
sudo echobridge status
```

On your iPhone, open Control Center → AirPlay (or the AirPlay button in any app): the rooms show up. Pick one
and play something. After 2 to 3 seconds the Echo starts playing.

## 6. Optional

- **Stereo in a Fire TV home theater** and **combined rooms**: [fire-tv.md](fire-tv.md)
- **Volume step**: `ECHO_VOLUME_STEP=4` (Echo steps per button press)
- **Problems**: [troubleshooting.md](troubleshooting.md)
