# The private Alexa skill

echobridge plays audio on an Echo through a custom skill that answers with `AudioPlayer.Play`. Every user creates
their own skill. It stays in the development stage, which means it only works on your own account and costs
nothing.

The skill is **Alexa-hosted**: Amazon runs its code, and the code only forwards each request to echobridge
(`skill/lambda/index.js`). Why not point the skill directly at echobridge? In testing, Amazon never reached a
self-hosted HTTPS endpoint behind a tunnel (the request failed on Amazon's side within ~60 ms, independent of
the certificate authority), while the Alexa-hosted function reaches it without problems.

## Create the skill

1. Open the [Alexa developer console](https://developer.amazon.com/alexa/console/ask) (free account with the
   same Amazon login as your Echos) → **Create Skill**.
2. Name: anything, e.g. "echobridge". Primary locale: **the language of your Echos** (e.g. German for amazon.de).
3. Type of experience: Other → model **Custom** → hosting **Alexa-hosted (Node.js)**, region closest to you.
   Template: **Start from scratch**. Create.

## Invocation name

**Build → Invocations → Skill Invocation Name.** echobridge says "open <invocation>" to the Echo, so pick
something Alexa understands reliably:

- two or more words, lower case
- no articles at the start (German: "die tonbrücke" is rejected)
- **no music words**: "meine hausmusik" was understood as a music request and played a playlist instead
- known to work: "meine tonbrücke" (German), "my sound bridge" (English)

Save. Put the same text into `SKILL_INVOCATION`.

> The JSON editor (next step) contains an invocation name too. In testing, saving it there didn't always stick,
> so set it on the Invocations page and check it after building.

## Interaction model

**Build → Interaction Model → JSON Editor**: paste `skill/interaction-model-de-DE.json` or
`skill/interaction-model-en-US.json`, change `invocationName` to yours, **Save** and **Build skill**.

## Audio player interface

**Build → Interfaces → Audio Player: on.** Save and build again. Without it the Echo ignores `AudioPlayer.Play`.

## Code

On the machine running echobridge:

```bash
sudo echobridge skill-code
```

Copy the output. In the console: **Code** tab → `lambda/index.js` → replace everything with it → **Save** →
**Deploy**. The code contains your `PUBLIC_URL` and the secret relay key (`/var/lib/echobridge/skill.json`).
Don't commit it anywhere. If you ever change `PUBLIC_URL`, paste the code again.

## Enable testing

**Test** tab → "Skill testing is enabled in": **Development**.

## Skill ID

Back in the skill list (or Build → Endpoint): **Copy Skill ID** → `SKILL_ID=amzn1.ask.skill....` in the
configuration. echobridge rejects requests from any other skill. Restart echobridge.

## Try it

Say "Alexa, open my sound bridge" (your invocation). The Echo should start a silent stream (nothing is playing
via AirPlay yet) and `sudo echobridge status` shows a `LaunchRequest` in the recent events. Stop it with
"Alexa, stop".

If Alexa answers that it can't reach the skill: check `PUBLIC_URL`, the tunnel and that the code was deployed.
If she can't find it: testing not enabled, or another skill of yours uses the same invocation name.
