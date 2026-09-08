# Written for the Ear

**A controlled comparison of raw backend strings against strings rewritten for the ear, spoken by Rime with the model, voice and language held constant.**

Built for the DataForge x Rime hackathon. Hard voice problem selected: **pronunciation and controlled delivery**.

---

## The problem, and why voice is load-bearing

The user is an operations team running outbound automated calls: order confirmations, appointment reminders, delivery updates. Every call carries variable data pulled from a database, and that data is the entire reason for the call.

Naive text-to-speech reliably mangles exactly the class of text those calls are made of. A ten-digit phone number stored without formatting is read as a number in the billions. An uncommon surname comes out unrecognisable to the person it belongs to. An alphanumeric reference code is read as a quantity rather than as characters. `St` in an address is read as Street when it means Saint.

A customer cannot scroll back and re-read a phone call. They hang up and call a human, which is the cost the automation was bought to avoid, or they write down something plausible and wrong and act on it, which is worse. Remove the speech and there is no product, only a row in a table nobody reads.

So the failure mode that matters here is not a robotic voice. It is a fluent, confident voice saying the wrong characters.

## The claim under test

> Rewriting a string for the ear, through spacing, punctuation and phrasing, measurably improves Rime's pronunciation of names, phone numbers, addresses and reference codes compared to sending the raw string unchanged, with the model, voice and language held constant.

The app exists to let you falsify that sentence, not to assert it. Seventeen fixtures across three voice tracks, two text variants each. Both variants of a fixture are rendered through an identical model, speaker, language and request configuration, so the only thing that differs inside a pair is the characters in `text`.

Where the rewrite does not help, the app records that and says so. See [RIME_EVIDENCE.md](RIME_EVIDENCE.md).

---

## Setup

Requires **Node 20.12 or newer** (for the built-in `.env` loader). There are no dependencies to install; `node_modules` does not exist in this project.

```bash
cd rime
cp .env.example .env        # then put a real key in it
npm run catalog             # pins the voice against Rime's live catalog
npm run generate            # renders all 20 clips, writes the manifest
npm run preflight           # 13 checks, verifies the combination end to end
npm start                   # http://localhost:5311
```

Get an API key from <https://app.rime.ai/tokens/>.

`npm run catalog` needs no key. `npm run generate` and `npm run preflight` do. `npm start` runs without one, and the app degrades honestly: stored clips still play, the live render control is disabled with the reason stated on screen, and nothing is simulated to fill the gap.

### Scripts

| Command | What it does | Needs a key |
| --- | --- | --- |
| `npm run catalog` | Fetches Rime's live voice catalog, applies the selection policy, writes `catalog-snapshot.json` | no |
| `npm run generate` | Re-renders every fixture clip, measures the noise floor, writes `public/clips/manifest.json`, fills the results block in `RIME_EVIDENCE.md` | yes |
| `npm run generate -- --dry-run` | Prints the exact strings that would be sent, calls nothing | no |
| `npm run generate -- --only <fixtureId>` | Re-renders one fixture's pair, merges into the existing manifest, keeps the stored noise floor | yes |
| `npm run generate -- --repeats <n>` | Renders of the control string for the noise floor, default 4 | yes |
| `npm run preflight` | Thirteen checks over catalog freshness, fixture integrity, clip freshness, a real round trip and both control experiments | yes |
| `npm start` | Serves the app on `PORT`, default 5311 | no |

---

## Rime configuration

Everything in this table is read from `catalog-snapshot.json` at runtime and displayed in the app's header, hero card and footer. It is not typed into the page.

| | |
| --- | --- |
| **Endpoint** | `POST https://users.rime.ai/v1/rime-tts` |
| **Transport** | HTTPS, one POST per clip. The response is `transfer-encoding: chunked` and the full body is read before playback rather than played as it arrives |
| **Auth** | `Authorization: Bearer $RIME_API_KEY`, server side only |
| **Model ID** | `mistv2` |
| **Speaker** | `summit` |
| **Language** | `eng` |
| **Audio format** | Requested `Accept: audio/wav`. Returned as headerless 16-bit LE PCM, mono. RIFF header added locally, see below |
| **Sampling rate** | `24000` Hz |
| **Other options** | `speedAlpha: 1.0`, `reduceLatency: false`, `phonemizeBetweenBrackets: true` |
| **Catalog sources** | [`all-v2.json`](https://users.rime.ai/data/voices/all-v2.json), [`voice_details.json`](https://users.rime.ai/data/voices/voice_details.json) |

### Why mistv2

The rewrite needs three text-side controls at once, and only one model in Rime's catalog carries all three:

| | text normalizer | `spell()` | `phonemizeBetweenBrackets` |
| --- | --- | --- | --- |
| `coda` | yes | no | no |
| `mistv3` | yes | yes | English only |
| **`mistv2`** | **yes** | **yes** | **yes** |

Since the selected hard problem is pronunciation control, that decides it. Requests that omit `modelId` or send an unrecognised one are served by Mist v3, so the model is always sent explicitly.

### What `Accept: audio/wav` actually returns

Worth writing down, because it cost real debugging time and the first run of this project produced twenty files that were silent in a browser.

The streaming endpoint responds `content-type: audio/wav` with `transfer-encoding: chunked`, but the body is **not** a RIFF WAVE file. It is a headerless stream of 16-bit little-endian linear PCM samples at the requested rate. The first bytes of a response are sample data, not the ASCII `RIFF`.

That is a reasonable thing for a streaming endpoint to do, since a RIFF header has to declare a byte length the server does not know until it has finished speaking. It has two consequences this project handles explicitly rather than papers over:

1. **A browser will not play those bytes.** `<audio src="clip.wav">` pointed at headerless PCM is silence, with no error. The 44-byte RIFF header is built in `src/wav.mjs` and added once the full body has arrived and the length is known. The samples are never altered.
2. **Duration cannot be read from a header that is not there.** It is computed from the sample count at the known rate, which for uncompressed PCM is exact rather than an estimate.

Every clip in the manifest records `container` as either `riff-added-locally` or `riff-from-upstream`, so the distinction stays visible instead of being smoothed into "we got a wav back". Both the CLI and the live route go through the same wrapping code, so a cached clip and a live clip are byte-comparable.

Two shas are recorded per clip for the same reason: `upstreamSha256` is what Rime sent, which is the audio's real provenance, and `fileSha256` is the playable file, which is that plus 44 bytes of header.

### Checking the phoneme flag is not silently ignored

Three fixtures depend on `phonemizeBetweenBrackets`. If Rime ignored it, those clips would still render, still sound fine, and prove nothing, and listening would not reveal it. Rime's docs say unsupported markup is read literally, which gives a test: render one phoneme fixture with the flag on and off.

With the flag off the clip runs about **1.8x longer**, because the braces and phoneme letters are spoken aloud. So the flag is doing real work. `npm run generate` measures this on every full run and records it in the manifest; `npm run preflight` fails if the ratio falls below 1.4.

It shows the mechanism is engaged. It does not show that `{S0Iv1an}` is the right way to say Siobhán, which only listening can settle.

### Why the voice is not hardcoded

`npm run catalog` fetches Rime's live catalog and runs a policy: require `mistv2`, require `eng`, then take the first speaker from a documented preference list that is actually present. The full live speaker list is written into the snapshot so a reader can confirm the choice was made from a real list rather than asserted.

If `mistv2` disappears, or every preferred speaker is withdrawn, the script fails loudly. It never substitutes a different voice quietly, because a silent voice swap would break the controlled comparison while leaving the page looking fine.

`npm run preflight` re-runs the policy against the live catalog and fails if today's answer differs from what the snapshot pinned.

---

## Architecture

```
rime/
  server.mjs              Node http server. Static files, /api/state,
                          /api/render proxy, /api/verdicts
  src/
    fixtures.mjs          The ten fixtures. Both variants, target
                          pronunciation, technique, stress-case reasoning
    voice.mjs             Selection policy, held-constant render options,
                          snapshot loader
    rime.mjs              The only code that talks to Rime. One synthesize()
                          used by both the CLI and the server
    wav.mjs               RIFF header reader, for measured clip duration
    env.mjs               .env via Node's built-in loader
  scripts/
    catalog.mjs           Live catalog fetch and voice pinning
    generate.mjs          Regenerates every clip, writes the manifest and the
                          evidence results block
    preflight.mjs         Pre-submission checks
  public/
    index.html app.js styles.css
    fonts/                Geist and Geist Mono, self-hosted woff2
    icons/sprite.svg      Phosphor Icons, MIT
    clips/                Generated wav files plus manifest.json
  catalog-snapshot.json   Written by npm run catalog
  verdicts.json           Written by the listening log in the UI
```

**No dependencies.** `package.json` has empty `dependencies` and `devDependencies`. Everything is Node's standard library and browser APIs. That is deliberate: a submission arguing for inspectability should be inspectable, and there is no bundle to audit.

**One synthesis path.** `src/rime.mjs` exposes a single `synthesize()`. The CLI that renders cached clips and the server route that renders live clips both call it with the same options object. If those paths could drift, a cached clip would stop being a fair stand-in for a live one and the live-versus-cached labelling in the UI would be decoration.

**The key never reaches the browser.** It is read from `.env` into the Node process. The page posts text to `/api/render`, which holds the key, calls Rime and returns audio bytes. That is the only reason there is a server here rather than a static page.

### Live versus cached, and how the UI proves it

Every player carries a provenance label, always, with no exceptions:

| Label | Meaning |
| --- | --- |
| **Cached** | A stored wav from `npm run generate`, shown with its real render timestamp, measured duration and audio sha |
| **Live** | Rendered by Rime during this page view, shown with the real round-trip time |
| **Not rendered** | No stored clip. Nothing is played and nothing stands in for it |
| **Render failed** | Rime returned an error for this string. The error text is shown |
| **Stale** | The fixture text changed after the clip was rendered. The audio is withheld rather than played under a string it does not match |

The server computes these, not the page. On every request it hashes the current fixture text and compares it against the `textSha256` recorded when the clip was made. A clip that no longer matches its string is reported as stale and never played.

Two controls make live rendering undeniable: **Send live** on any variant re-renders that exact string through Rime and relabels the player from Cached to Live, and **Edit and send** loads the string into a textarea where you can change a character and hear what moves.

### The waveform is real

Each waveform is decoded from the actual audio with `decodeAudioData` and reduced to per-bucket peaks. The playhead is driven by the audio element's real `currentTime`. Nothing animates at idle, and there is no waveform for a clip that failed to decode. This matters beyond decoration: the digit grouping in a spelled-out code is visible as separate bursts against the naive variant's single continuous run.

---

## Third-party services and assets

| | Used for | Notes |
| --- | --- | --- |
| **Rime** | All speech synthesis | The only speech provider. Requires a key |
| **Rime public voice catalog** | Model and voice selection at build time | Public URLs, no key |
| [Geist and Geist Mono](https://vercel.com/font) | Typography | SIL Open Font License. Downloaded from Google Fonts and self-hosted in `public/fonts`. No runtime call to Google |
| [Phosphor Icons](https://phosphoricons.com) | Interface icons | MIT. 16 regular-weight glyphs vendored into one sprite |

No analytics, no CDN at runtime, no telemetry, no third-party JavaScript.

## Failure behaviour

| Situation | What happens |
| --- | --- |
| No `RIME_API_KEY` | Server starts, stored clips play, live controls are disabled with the reason on screen. Nothing is simulated |
| No `catalog-snapshot.json` | Server starts and the app shows the error with the command to fix it. Live render returns 503. Nothing guesses a voice |
| Rime returns an error during generation | That clip is recorded as `failed` with the status and body, any previous file for it is deleted, and the script exits non-zero. The UI shows the error text |
| Rime returns an error during a live render | The error and upstream status are shown in place of the player. No cached clip is substituted |
| A fixture's text is edited without regenerating | The clip is reported stale and withheld. `npm run preflight` fails on it |
| Live render is called repeatedly | Capped at 40 calls a minute per process, so a stuck page cannot drain the account |
| A clip fails to decode for the waveform | The waveform is left blank. Playback still works |

## Known limitations

1. **The listening verdict is subjective and unblinded.** The panel labels which variant is which, so a listener knows what they are supposed to hear. A blind A/B with randomised presentation would be stronger evidence. This is the single biggest weakness in the design and it is not hidden anywhere in the interface.

2. **No automatic scoring.** There is no ASR round trip scoring word error rate against the target. That would be a real objective measure and it is the obvious next step. Duration is measured and reported, but duration only confirms the two variants rendered differently. It says nothing about whether either is correct.

3. **The phoneme strings are hypotheses.** The bracketed phoneme spellings for the three names are hand-authored from Rime's published alphabet. They are an attempt at the target pronunciation, not a verified result, and one of them may well be wrong. That is what the listening log is for.

4. **Ten fixtures is a small sample, and they were chosen to be hard.** This is a demonstration that the class of failure is real and that the class of fix addresses it. It is not a measurement of how often it happens in production traffic.

5. **Rime's output is not deterministic, so nothing here is byte-reproducible.** Identical requests return different audio each time. Duration deltas are judged against a measured noise floor for that reason, and a listening verdict is one sample rather than a settled fact.

6. **One voice, one language, English only.** Results are for `mistv2` / `summit` / `eng`. Nothing here establishes that they carry to other speakers, to Arcana or Coda, or to other languages.

7. **No fallback provider.** Only Rime speaks here. The UI says so at all times rather than implying a resilience story the code does not have.

8. **Verdicts are stored in a local `verdicts.json`.** They are per-checkout, not shared, and not authenticated.

---

## Demo path, about four minutes

1. **Who and why.** Top of the page: the operations team, the variable data, and why removing the speech removes the product. The selected hard voice problem is stated on screen in the hero. (40s)
2. **The controls.** The claim, and the eight held-constant values read live from the server. (30s)
3. **The normal flow.** Pick `code-order` in the rail. Read both strings, play both clips, check each against the target pronunciation. (50s)
4. **The stress case.** `phone-raw`, marked in the rail and banner-flagged in the panel. Ten unformatted digits against the same digits in a shape Rime's normalizer recognises. Then `address-saint`, the failure that sounds fluent and is still wrong. (70s)
5. **Prove it is live.** Press **Send live** on a variant and watch the label move from Cached to Live with a fresh round-trip time. Then **Edit and send**, change a character, render again. (40s)
6. **The result.** The listening log, including any fixture where the rewrite did not help. Provider readout in the header the whole time. (30s)

## Reproducing the evidence

```bash
rm -rf public/clips/*.wav public/clips/manifest.json
npm run catalog && npm run generate && npm run preflight
```

Every number in the results block of [RIME_EVIDENCE.md](RIME_EVIDENCE.md) is written by `npm run generate` from the bytes Rime returned. None of it is typed by hand.

**The procedure reproduces, the bytes do not.** Rime is not deterministic: four renders of one unchanged string, with identical options, produce four different audio files with durations spanning 150 to 350 ms. `npm run generate` measures that spread on every full run and marks each per-fixture duration delta as inside or outside it, so a difference smaller than the model's own run-to-run variation is never reported as a finding. Expect new shas on every run.

## AI assistance

This project reflects a human effort with AI assistance. AI tools were used primarily for suggesting alternative implementations, debugging tricky API responses (like the headerless PCM stream), and generating boilerplate code for the frontend UI. The core architecture, experimental design, and all analytical measurements were human-driven.

Full details are provided in [AI_ASSISTANCE.md](AI_ASSISTANCE.md).

## Licence

MIT. Geist is under the SIL Open Font License, Phosphor Icons under MIT.
