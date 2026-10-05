# Stereo through a Fire TV home theater, and combined rooms

## The problem

In an Alexa home theater (Fire TV + two Echo speakers as left/right, optionally a subwoofer), audio from a
custom skill only plays on **one** speaker, no matter whether the skill is opened on a speaker, on the Fire TV
or on the group (the group doesn't run skills at all). Opening it on the second speaker stops the first.

Everything the **Fire TV itself** plays, however, the home theater spreads in stereo across its speakers. So
for such a room, echobridge doesn't use the skill but opens the stream in VLC on the Fire TV, using ADB over
the network. The stream comes straight from your LAN.

## Fire TV preparation (TV on, once)

1. Settings → My Fire TV → About → select the device name **7 times** until it says you're a developer.
2. My Fire TV → Developer options → **ADB debugging: on**.
3. Install **VLC** from the Appstore.
4. Give the Fire TV a **fixed IP address** in your router (DHCP reservation), otherwise echobridge loses it.
5. Pair:
   ```bash
   sudo echobridge firetv-pair 192.168.1.50
   ```
   The TV asks "Allow USB debugging?": tick **Always allow from this computer** and confirm. Run the command
   again; it should print the address.

## Configuration

Keep the room's Echo serial in `ROOMS` (the volume buttons use it; in a home theater, the other speaker
follows) and set the player:

```ini
ROOMS=Kitchen=G000000000000000;Living room=G000000000000001
PLAYERS=living-room=firetv:192.168.1.50
```

Room ids are the names in lower case with dashes. `sudo echobridge status` shows them.

Behavior:

- Works with the TV off (start AirPlay while it's off and it stays off).
- Switching the TV off **while** playing stops VLC. echobridge restarts VLC if audio keeps arriving, but the
  iPhone may end the AirPlay session itself; then just pick the room again.
- Latency is a bit higher than through the skill (the home theater delays audio to match video).

## Combined rooms ("Everywhere")

AirPlay 1 receivers can't be grouped in the iPhone menu. Add a receiver that plays on several players instead:

```ini
ROOMS=Kitchen=G000000000000000;Living room=G000000000000001;Everywhere=G000000000000000,G000000000000001
PLAYERS=living-room=firetv:192.168.1.50;everywhere=firetv:192.168.1.50+skill:G000000000000000
```

"Everywhere" plays on the Fire TV home theater and, through the skill, on the kitchen Echo. The volume buttons
change both rooms relative to their own level.

Skill and Fire TV have different delays. Align them by ear while playing on "Everywhere", standing where you
hear both rooms:

```bash
sudo echobridge sync everywhere 150    # skill (kitchen) 150 ms later
sudo echobridge sync everywhere -100   # or: Fire TV 100 ms later
```

The change applies immediately (a short silence on the delayed side) and is stored in
`/var/lib/echobridge/sync.json`. In testing, ~225 ms for the skill side fitted a Fire TV Stick 4K Max
home theater.
