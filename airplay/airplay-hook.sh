#!/bin/sh
# Called by shairport-sync:
#   airplay-hook.sh volume/<room> <dB>        (-30 .. 0, -144 = muted)
#   airplay-hook.sh session/<room> start|end
# Reports to echobridge (local only, with the token from the environment) without blocking shairport-sync.
[ -n "$HOOK_TOKEN" ] || exit 0
curl -s -m 2 -X POST -H "X-Hook-Token: $HOOK_TOKEN" "http://127.0.0.1:${HOOK_PORT:-8097}/hook/$1/$2" >/dev/null 2>&1 &
exit 0
