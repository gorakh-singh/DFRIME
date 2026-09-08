# Rime evidence

Hard voice problem: **pronunciation and controlled delivery.**

---

## 1. The claim

> Rewriting a string for the ear, through spacing, punctuation and phrasing, measurably improves Rime's pronunciation of names, phone numbers, addresses and reference codes compared to sending the raw string unchanged, with the model, voice and language held constant.

The claim is written to be falsifiable, and the artifact is built so that it can fail visibly. Every fixture has a recorded verdict with three possible values, one of which is that the rewrite made the audio worse. A fixture that goes that way appears in the listening log and in the tally exactly like one that goes the other way. Nothing averages it away.

## 2. Acceptance test

The claim passes for a fixture when a listener, playing both clips and comparing each against that fixture's written target pronunciation, judges the ear variant closer to the target than the naive variant.

The claim passes overall when that holds for a clear majority of the ten fixtures, **and** for both deliberate stress cases.

It fails when the ear variant is judged no better, or worse. Per fixture and in aggregate, the result is whatever the log says.

**What is deliberately not the acceptance test.** No score is computed from the audio itself. There is no automatic pass mark. A system grading its own pronunciation would be measuring its own opinion, and reporting that as evidence would be worse than reporting nothing. The measurement is a person listening, and the artifact says so on the page.

## 3. Procedure

### 3.1 Held constant

Both variants of every fixture are rendered through one code path, `synthesize()` in `src/rime.mjs`, with one options object built from `catalog-snapshot.json`. The CLI that renders stored clips and the server route that renders live clips both call it. There is no second path that could drift.

| Held constant | Value | Where it comes from |
| --- | --- | --- |
| Endpoint | `POST https://users.rime.ai/v1/rime-tts` | `src/voice.mjs` |
| Model ID | `mistv2` | policy in `src/voice.mjs`, asserted against the live catalog |
| Speaker | `summit` | first available entry of a documented preference list, taken from the live catalog |
| Language | `eng` | policy |
| Audio request | `Accept: audio/wav` | `AUDIO.accept` |
| Audio returned | headerless 16-bit LE PCM, mono (see 3.4) | measured |
| Sampling rate | `24000` Hz | `RENDER_OPTIONS` |
| `speedAlpha` | `1.0` | `RENDER_OPTIONS` |
| `reduceLatency` | `false` | `RENDER_OPTIONS` |
| `phonemizeBetweenBrackets` | `true` | `RENDER_OPTIONS` |

**The only variable is the `text` field.**

`npm run preflight` re-derives the voice from the live catalog and fails if today's answer differs from what the snapshot pinned, so a silent voice change cannot invalidate a run without being caught.

### 3.2 The two variants

Ten fixtures, defined in `src/fixtures.mjs`, covering three proper names, two phone numbers, two addresses and three reference codes. Each carries:

- **naive** the raw string a backend would emit, unchanged
- **ear** the same information rewritten using only mechanisms Rime documents for the Mist family
- **target** the plain-language pronunciation being aimed at, written by hand and shown beside the audio in the UI

The rewrites use four documented mechanisms and nothing else:

| Mechanism | What it is | Example from the set |
| --- | --- | --- |
| Normalizer formatting | Reshape the string into a pattern Rime's normalizer already recognises | `4155552671` becomes `(415) 555-2671` |
| `spell()` | Rime's only inline directive. Reads a token letter and digit at a time | `A7X4B9` becomes `spell(A7X4B9)` |
| `phonemizeBetweenBrackets` | Rime's own IPA-inspired alphabet in curly braces, Mist v1 and v2 only | `Siobhán` becomes `{S0Iv1an}` |
| Expansion and pacing | Write the abbreviation out; use commas as prosody control | `9 St Marys Ct` becomes `9 Saint Mary's Court` |

No SSML and no IPA brackets are used, because Rime's documentation states plainly that they are read literally and sound wrong.

### 3.3 Deliberate stress cases

Two fixtures are marked as stress cases in the data, banner-flagged in the UI, and listed separately in the results table below. They are two different kinds of failure, on purpose.

**`phone-raw`, an audible failure.** `Call us back at 4155552671.` Backends store phone numbers unformatted, so this is the string a naive integration actually sends. A bare run of ten digits carries none of the signature Rime's normalizer uses to recognise a phone number.

**`address-saint`, an inaudible failure.** `Your driver is waiting at 9 St Marys Ct, Mt Vernon.` Here `St` means Saint, not Street. This is the more dangerous case because the wrong reading is fluent and confident. Nothing in the audio signals a problem, so the customer writes down a plausible address and goes to the wrong place.

### 3.4 What the endpoint returns, measured

Under `Accept: audio/wav` the streaming endpoint answers `content-type: audio/wav` and `transfer-encoding: chunked`, but the body is a headerless stream of 16-bit little-endian PCM samples, not a RIFF WAVE file. The first bytes of a response are sample data.

This is recorded here because it changes how two numbers in the results table below should be read:

- **Duration** is computed from the sample count at the requested rate, not read from a header. For uncompressed PCM at a known rate that is exact, not an estimate.
- **The sha in each cell** is of the bytes Rime returned, before the local RIFF header was added. Two runs that agree on a sha produced byte-identical speech. The playable file is those bytes plus 44 bytes of header, recorded separately as `fileSha256`.

The RIFF header is added in `src/wav.mjs` on the single shared synthesis path, so cached and live clips are wrapped identically. The samples are never altered, and each manifest entry records which path it took under `container`.

### 3.5 Running it

```bash
npm run catalog     # pins the voice from Rime's live catalog
npm run generate    # renders all 20 clips, writes manifest and the block below
npm run preflight   # re-verifies the pinned combination end to end
```

`npm run generate` writes every clip to `public/clips/`, records for each one the exact text sent, a sha of that text, a sha of the audio Rime returned, the byte count, the computed duration and the round-trip timing, into `public/clips/manifest.json`. It then renders a control string four more times to measure the noise floor, and rewrites the results block below.

Delete `public/clips` and run it again and the whole evidence base rebuilds from `src/fixtures.mjs`. Nothing in the UI is hand-placed.

The rebuild is reproducible in procedure, not in bytes. See 3.6.

### 3.6 Control experiment: is the phoneme flag actually doing anything?

A silently ignored flag is the worst outcome available to this submission. Three of the ten fixtures rely on `phonemizeBetweenBrackets`. If Rime were ignoring it, those clips would still render, still sound perfectly fine, and prove nothing whatsoever, and no amount of careful listening against a target would reveal it.

Rime's documentation gives a clean test: unsupported markup is "read literally". So render one phoneme fixture's ear variant twice, changing only that flag.

| | duration |
| --- | --- |
| `phonemizeBetweenBrackets: true` | around 3.1s |
| `phonemizeBetweenBrackets: false` | around 5.4s |

With the flag off the clip is roughly **1.8x longer**, because the model is speaking the braces and the phoneme letters aloud. The flag is doing real work. The exact figures for the recorded run are in the results block below, and `npm run preflight` fails if the ratio drops under 1.4.

This check is objective and needs no listener. Note carefully what it does and does not establish: it shows the mechanism is engaged, not that `{S0Iv1an}` is the right way to say Siobhán. Only listening decides that.

### 3.7 Rime is not deterministic, and what that costs

Rendering one unchanged string four times with identical `modelId`, `speaker`, `lang` and options produces **four different audio files**. This was measured, not assumed, and the measurement runs on every full generate:

- four distinct audio shas from four identical requests
- durations spanning roughly 150 to 350 ms depending on the string

That has three consequences, all of which the artifact now accounts for:

1. **Clips are not byte-reproducible.** Re-running `npm run generate` gives new audio with new shas. The shas in the table below identify one specific run, and are useful for checking that a clip on disk is the clip the manifest describes. They are not a checksum a second run can be expected to match.
2. **Small duration deltas mean nothing.** The generated block measures the spread across repeated renders of a control string and marks every per-fixture delta as inside or outside it. On the run recorded below, four of ten fixtures fall inside the noise and are reported as carrying no information rather than as small effects.
3. **A single listening pass is a single sample.** A verdict is recorded against the clips currently on disk. Regenerating could, in principle, produce audio that a listener judges differently. Anyone relying on the result should regenerate and listen again rather than trusting one pass.

The first version of this project reported deltas of 50 to 90 ms as though they were findings. They were smaller than the variation between two renders of the same text. The noise floor exists so that mistake is visible instead of repeatable.

---

## 4. Result

<!-- GENERATED:RESULTS -->

> This block is written by `npm run generate`. Do not edit it by hand.
> Every number in it is measured from the bytes Rime actually returned.

**Run:** 2026-09-08T03:50:01.354Z  
**Endpoint:** `POST https://users.rime.ai/v1/rime-tts`  
**Requested:** `Accept: audio/wav` at 24000 Hz  
**Returned by Rime:** headerless 16-bit little-endian linear PCM, mono, chunked  
**Written to disk:** RIFF WAVE added locally around Rime’s PCM samples  
**Clips:** 34 rendered, 0 failed, across 17 fixtures on 3 tracks

### Tracks, and what each was measured to support

| Track | Model / speaker / language | Fixtures | Noise floor | `spell()` | Phoneme flag |
| --- | --- | --- | --- | --- | --- |
| `en-US` | `mistv2` / `summit` / `eng` | 10 | 220 ms over 4 | honoured (1.118x) | works (1.555x) |
| `en-IN` | `mistv2` / `ritu` / `eng` | 4 | 395 ms over 4 | honoured (1.101x) | works (1.745x) |
| `hi-IN` | `arcana` / `anaya` / `hin` | 3 | 1365 ms over 4 | honoured (1.16x) | no effect (0.983x) |

The `spell()` and phoneme columns are measurements, not documentation. Each
was produced by rendering a probe twice, once with the mechanism and once
without, and comparing durations. A mechanism that is read literally makes
the clip markedly longer, because the model speaks the directive aloud.
Every result above agrees with the capability its track declares, and
`npm run preflight` fails if that ever stops being true.

### US English: `mistv2` / `summit` / `eng`

| Fixture | Stress case | Naive | Written for the ear | Duration delta | Beyond noise floor |
| --- | --- | --- | --- | --- | --- |
| `name-doheny` | no | 3.19s `bafba693e64e` | 3.17s `07d74d46a074` | -0.02s | no, inside noise |
| `name-xochitl` | no | 2.97s `32c865656219` | 2.95s `36f566d4cb7f` | -0.02s | no, inside noise |
| `name-wojciechowski` | no | 3.47s `cdd11bb4f066` | 3.31s `509e66a14298` | -0.16s | no, inside noise |
| `phone-raw` | yes | 3.95s `7272ee93fdc0` | 4.68s `3eebc3492539` | +0.73s | yes |
| `phone-ext` | no | 7.56s `31ca81cfba89` | 7.54s `62018d55694b` | -0.02s | no, inside noise |
| `address-apt` | no | 4.53s `a248bb2b67b3` | 4.98s `f211125bd8b0` | +0.45s | yes |
| `address-saint` | yes | 3.38s `567b3da6dbb9` | 3.39s `30ecf7d5fd7a` | +0.01s | no, inside noise |
| `code-order` | no | 2.37s `a8dd4612620c` | 3.10s `25bed6744cc6` | +0.73s | yes |
| `code-po` | no | 3.18s `9168055bba7d` | 3.90s `c5c0f0ff2ebd` | +0.72s | yes |
| `code-rx` | no | 4.21s `96a82baca738` | 4.61s `393946448885` | +0.40s | yes |

### Indian English: `mistv2` / `ritu` / `eng`

| Fixture | Stress case | Naive | Written for the ear | Duration delta | Beyond noise floor |
| --- | --- | --- | --- | --- | --- |
| `in-name-krishnamurthy` | no | 3.90s `5f80bd5375a5` | 3.77s `dfbe2e6bc0d2` | -0.13s | no, inside noise |
| `in-phone-mobile` | yes | 5.40s `6b2e2bab77c2` | 5.48s `dc15216c7d10` | +0.08s | no, inside noise |
| `in-address-bengaluru` | no | 8.19s `10edf022698b` | 7.93s `bf9fd438f05b` | -0.26s | no, inside noise |
| `in-code-gstin` | no | 6.11s `d3714dfa44f5` | 7.12s `81c8baa4249e` | +1.01s | yes |

### Hindi: `arcana` / `anaya` / `hin`

| Fixture | Stress case | Naive | Written for the ear | Duration delta | Beyond noise floor |
| --- | --- | --- | --- | --- | --- |
| `hi-phone-callback` | no | 9.13s `0c21085a4824` | 8.53s `2f545cd00c47` | -0.60s | no, inside noise |
| `hi-code-booking` | no | 6.06s `8556ef39cc34` | 7.59s `34790263751c` | +1.54s | yes |
| `hi-address-delhi` | no | 9.64s `b0d771bba4b5` | 11.18s `33fb59726444` | +1.54s | yes |

A longer ear clip is the expected direction for this rewrite, because
spelling a code out and grouping digits takes more time than reading them
as one quantity. Rows marked "no, inside noise" are not evidence in either
direction: the gap between the two variants there is smaller than the gap
between two renders of the same string. Duration never says whether a
pronunciation is correct. Only listening against the target decides that,
which is what the listening log records.

<!-- /GENERATED:RESULTS -->

### 4.1 Listening log

The per-fixture verdicts are recorded through the app and stored in `verdicts.json`, which is gitignored because it belongs to whoever ran the demo rather than to the repository. The aggregate is shown at the bottom of the page, including any fixture where the rewrite did not help.

To reproduce: run the app, play both clips for each fixture, compare each against its target, and record a verdict. The tally and the log update as you go.

---

## 5. Limitations

1. **Unblinded and subjective.** The panel labels which variant is which, so a listener knows which one is supposed to win. A blind A/B with randomised presentation order would be materially stronger evidence. This is the biggest weakness in the design.

2. **No word error rate.** There is no ASR round trip scoring the audio against the target. That would be a genuine objective measure and it is the obvious next step. Duration is measured and reported, but it only confirms that the two variants rendered differently. It carries no information about whether either is correct.

3. **The phoneme strings are hypotheses.** The bracketed spellings for the three names are hand-authored from Rime's published alphabet. They are an attempt at the target, not a verified result, and any of them may be wrong. The control experiment in 3.6 shows the mechanism is engaged; it says nothing about whether these particular phonemes are the right ones. If one is wrong, the listening log is where it shows up.

4. **Ten fixtures, chosen to be hard.** This demonstrates that the class of failure is real and that the class of fix addresses it. It is not an estimate of how often the failure occurs in production traffic, and the fixture set is small enough that a single disagreement moves the aggregate noticeably.

5. **One voice, one model, one language.** Everything here is `mistv2` / `summit` / `eng`. Nothing establishes that the results carry to other speakers, to Arcana or Coda, or to other languages. The normalizer, `spell()` and phoneme support all differ by model, so they very plausibly do not.

6. **Duration deltas are not effect sizes.** A longer ear clip is the expected direction, because spelling a code out takes more time than reading it as a quantity. It is a sanity check against a measured noise floor, not a result.

7. **Output is not deterministic, so nothing here is byte-reproducible.** See 3.7. The procedure reproduces; the exact audio does not. Any claim in this document that rests on a specific clip rests on one sample of a distribution.

8. **No fallback provider.** Rime is the only speech provider. The interface says so at all times rather than implying resilience the code does not have.

## 6. Reproducibility checklist

- [x] Fixture list is data, in one file, `src/fixtures.mjs`
- [x] One script regenerates every clip from that list, `npm run generate`
- [x] Model, speaker, language and every request option are pinned in one place and applied to both variants
- [x] Voice selection is made against Rime's live catalog at build time, not from a hardcoded list, and the live list is kept in the snapshot as evidence
- [x] Every clip records the text sent, a sha of it, a sha of the audio Rime returned, a sha of the file written, byte counts, computed duration and timings
- [x] The noise floor is measured on every full run, and duration deltas below it are reported as noise rather than as results
- [x] The phoneme mechanism is verified as engaged by a control experiment, not assumed, and preflight fails if it stops engaging
- [x] A clip whose fixture text changed is detected by sha and withheld rather than played
- [x] A failed render is recorded as a failure and any stale file for it is deleted
- [x] Live and cached clips are labelled in the UI, always, from server-side state
- [x] `npm run preflight` runs 13 checks over catalog freshness, fixture integrity, clip freshness, one real round trip, and both control experiments
- [x] No API key in client code, in the repo, or in any output printed by these scripts

## 7. AI assistance

This project reflects a human effort with AI assistance. AI was used as a sounding board, a debugger for complex API issues, and to help generate frontend UI boilerplate. 

**The measurements in section 4 are completely derived from live experiments.** Every number there was produced by `npm run generate` making real requests to Rime and measuring the returned bytes. Three of the findings recorded in this document, the headerless PCM response, the non-determinism, and Coda reading `spell()` literally, came from running experiments and contradicted what had been assumed from the documentation alone.

Full disclosure in [AI_ASSISTANCE.md](AI_ASSISTANCE.md).

## 8. Sources

- Rime API reference, TTS endpoint and `Accept` values: <https://docs.rime.ai/api-reference/tts>
- Rime models and per-model feature support: <https://docs.rime.ai/docs/models>
- Rime text normalization and `spell()`: <https://docs.rime.ai/docs/text-normalization>
- Rime custom pronunciation, `phonemizeBetweenBrackets`: <https://docs.rime.ai/docs/custom-pronunciation>
- Rime phonetic alphabet: <https://docs.rime.ai/platform/rime-phonetic-alphabet>
- Live voice catalog: <https://users.rime.ai/data/voices/all-v2.json> and <https://users.rime.ai/data/voices/voice_details.json>
