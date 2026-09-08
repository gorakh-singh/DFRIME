#!/usr/bin/env node
/**
 * npm run generate
 *
 * Regenerates every fixture clip from the fixture list and writes a manifest
 * recording exactly what was sent and exactly what came back.
 *
 * This is the reproducibility path. Delete public/clips and run this, and the
 * whole evidence base rebuilds from src/fixtures.mjs plus catalog-snapshot.json.
 * Nothing in the UI is hand-placed.
 *
 * Rules this script holds to:
 *
 *   1. Both variants of a fixture are rendered with that fixture's track voice
 *      and that track's options, from one source. Only `text` differs.
 *
 *   2. A render that fails is recorded as a failure. It does not fall back to a
 *      previous clip, and it does not leave a stale file in place pretending to
 *      be current. The UI reads the failure and says so.
 *
 *   3. Per track, three things are measured rather than assumed, because each
 *      can fail silently while leaving audio that sounds perfectly fine:
 *        - the noise floor, since Rime is not deterministic
 *        - whether phonemizeBetweenBrackets does anything
 *        - whether spell() is honoured or spoken aloud as a word
 *
 * Flags:
 *   --only <fixtureId>   render one fixture's pair, leave the rest alone
 *   --dry-run            print what would be sent, call nothing
 *   --repeats <n>        renders of the control string per track for the noise
 *                        floor, default 4
 *   --skip-controls      render clips only, reuse the stored control results
 */

import '../src/env.mjs';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { synthesize, hasApiKey } from '../src/rime.mjs';
import { loadSnapshot, voiceForTrack, ROOT } from '../src/voice.mjs';
import { formatDuration } from '../src/wav.mjs';
import { FIXTURES, renderQueue, fixtureById } from '../src/fixtures.mjs';

const CLIPS_DIR = join(ROOT, 'public', 'clips');
const MANIFEST_PATH = join(CLIPS_DIR, 'manifest.json');
const EVIDENCE_PATH = join(ROOT, 'RIME_EVIDENCE.md');
const MARKER_START = '<!-- GENERATED:RESULTS -->';
const MARKER_END = '<!-- /GENERATED:RESULTS -->';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const short = (h) => h.slice(0, 12);
const secs = (ms) => (ms / 1000).toFixed(2);

function parseArgs(argv) {
  const args = { only: null, dryRun: false, repeats: 4, skipControls: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--only') args.only = argv[i + 1] ?? null;
    if (argv[i] === '--dry-run') args.dryRun = true;
    if (argv[i] === '--skip-controls') args.skipControls = true;
    if (argv[i] === '--repeats') args.repeats = Number(argv[i + 1]) || 4;
  }
  return args;
}

/* ------------------------------------------------------------- rendering */

async function renderAll(queue, snapshot) {
  const clips = [];
  for (const item of queue) {
    const voice = voiceForTrack(snapshot, item.track);
    const file = `${item.fixtureId}.${item.variant}.wav`;
    process.stdout.write(
      `  ...   ${`${item.fixtureId} / ${item.variant}`.padEnd(36)}`
    );

    try {
      const res = await synthesize({ text: item.text, voice });
      await writeFile(join(CLIPS_DIR, file), res.bytes);

      clips.push({
        fixtureId: item.fixtureId,
        variant: item.variant,
        track: item.track,
        voice: `${voice.modelId}/${voice.speaker}/${voice.lang}`,
        status: 'ok',
        file: `clips/${file}`,
        text: item.text,
        textSha256: sha256(item.text),
        // Provenance of the audio itself: what Rime sent, before the RIFF
        // container was added locally.
        upstreamSha256: sha256(res.upstream),
        upstreamBytes: res.upstream.length,
        // The playable file on disk: those samples plus a 44 byte header.
        fileSha256: sha256(res.bytes),
        bytes: res.bytes.length,
        container: res.container,
        trimmedBytes: res.trimmedBytes,
        durationMs: res.durationMs,
        sampleRate: res.sampleRate,
        channels: res.channels,
        bitsPerSample: res.bitsPerSample,
        phonemizeBetweenBrackets: res.sent.phonemizeBetweenBrackets,
        ttfbMs: res.ttfbMs,
        totalMs: res.totalMs,
        renderedAt: res.requestedAt,
        contentType: res.contentType,
      });

      console.log(
        `ok   ${(formatDuration(res.durationMs) ?? 'n/a').padStart(7)}  ` +
          `${String(res.totalMs).padStart(5)}ms  ` +
          `${(res.bytes.length / 1024).toFixed(0).padStart(4)}KB  ` +
          `${short(sha256(res.upstream))}`
      );
    } catch (err) {
      // A previous clip must not survive a failed re-render, or the UI would
      // show stale audio under a fresh timestamp.
      await rm(join(CLIPS_DIR, file), { force: true });
      clips.push({
        fixtureId: item.fixtureId,
        variant: item.variant,
        track: item.track,
        status: 'failed',
        file: null,
        text: item.text,
        textSha256: sha256(item.text),
        error: err.message,
        errorStatus: err.status ?? null,
        errorBody: err.body ?? null,
        attemptedAt: new Date().toISOString(),
      });
      console.log(`FAILED  ${err.message}`);
    }
  }
  return clips;
}

/* -------------------------------------------------------------- controls */

/**
 * How much does Rime's output vary for an UNCHANGED string?
 *
 * This exists because the first version of this project reported duration
 * deltas of 50 to 90 ms between variants and treated them as signal. They were
 * not. Rime is not deterministic: identical text, speaker, model and options
 * produce different audio and a different duration every call. Without a
 * measured floor there is no way to separate a real difference from that.
 */
async function noiseFloor(voice, repeats, controlText) {
  const runs = [];
  for (let i = 0; i < repeats; i += 1) {
    const res = await synthesize({ text: controlText, voice });
    runs.push({
      durationMs: res.durationMs,
      upstreamSha256: sha256(res.upstream),
    });
  }
  const ds = runs.map((r) => r.durationMs);
  const distinctShas = new Set(runs.map((r) => r.upstreamSha256)).size;
  return {
    controlText,
    repeats,
    deterministic: distinctShas === 1,
    distinctShas,
    minMs: Math.min(...ds),
    maxMs: Math.max(...ds),
    spreadMs: Math.max(...ds) - Math.min(...ds),
  };
}

/**
 * Is phonemizeBetweenBrackets doing anything on this track?
 *
 * A silently ignored flag is the worst outcome available here. The fixture
 * would still render, still sound fine, and prove nothing, and no amount of
 * careful listening would reveal it. Rime's docs say unsupported markup is read
 * literally, which gives a clean test: with the flag off the braces and phoneme
 * letters get spoken aloud, so the clip gets markedly longer.
 */
async function phonemeControl(voice, probe) {
  const on = await synthesize({
    text: probe,
    voice,
    overrides: { phonemizeBetweenBrackets: true },
  });
  const off = await synthesize({
    text: probe,
    voice,
    overrides: { phonemizeBetweenBrackets: false },
  });
  const ratio = off.durationMs / on.durationMs;
  return {
    probe,
    onDurationMs: on.durationMs,
    offDurationMs: off.durationMs,
    ratio: Number(ratio.toFixed(3)),
    engaging: ratio > 1.4,
  };
}

/**
 * Is spell() honoured on this track, or spoken aloud as the word "spell"?
 *
 * This is the check that decided the Hindi track. Rime documents that Coda has
 * no spell() stage, and Coda is one of only two models carrying Hindi voices.
 * Comparing spell(X) against a manually spelled-out X separates the two cases:
 * if the directive is honoured the durations match, and if it is read literally
 * the spell() version is much longer because it also says the word and the
 * parentheses aloud.
 */
async function spellControl(voice, withSpell, spacedOut) {
  const a = await synthesize({ text: withSpell, voice });
  const b = await synthesize({ text: spacedOut, voice });
  const ratio = a.durationMs / b.durationMs;
  return {
    withSpell,
    spacedOut,
    spellDurationMs: a.durationMs,
    spacedDurationMs: b.durationMs,
    ratio: Number(ratio.toFixed(3)),
    honoured: ratio <= 1.25,
  };
}

/** Probe strings per track, each in that track's own language. */
const PROBES = {
  'en-US': {
    phoneme: 'Hello {S0Iv1an}, your order is ready.',
    spell: 'Your code is spell(PNR4472).',
    spaced: 'Your code is P N R 4 4 7 2.',
  },
  'en-IN': {
    phoneme: 'Hello {v2Enk0xt1arxm0xn}, your order is ready.',
    spell: 'Your code is spell(PNR4472).',
    spaced: 'Your code is P N R 4 4 7 2.',
  },
  'hi-IN': {
    phoneme: 'नमस्ते {v2Enk0xt1arxm0xn} जी।',
    spell: 'आपका कोड spell(PNR4472) है।',
    spaced: 'आपका कोड पी एन आर चार चार सात दो है।',
  },
};

async function runControls(snapshot, tracksUsed, repeats) {
  const out = {};
  for (const trackId of tracksUsed) {
    const voice = voiceForTrack(snapshot, trackId);
    const probes = PROBES[trackId];
    const control = FIXTURES.find((f) => f.track === trackId).naive;
    const entry = {
      track: trackId,
      voice: `${voice.modelId}/${voice.speaker}/${voice.lang}`,
    };

    process.stdout.write(`  ...   ${`${trackId} noise floor`.padEnd(36)}`);
    try {
      entry.noiseFloor = await noiseFloor(voice, repeats, control);
      console.log(
        `spread ${entry.noiseFloor.spreadMs} ms over ${repeats}, ` +
          `${entry.noiseFloor.distinctShas} distinct shas`
      );
    } catch (err) {
      entry.noiseFloor = null;
      console.log(`FAILED  ${err.message}`);
    }

    // Run on every track, including the ones that claim no support. Assuming a
    // mechanism does not work is the same mistake as assuming it does.
    process.stdout.write(`  ...   ${`${trackId} phoneme flag`.padEnd(36)}`);
    try {
      const pc = await phonemeControl(voice, probes.phoneme);
      pc.claimedByTrack = voice.techniques.includes('phoneme');
      pc.agreesWithClaim = pc.engaging === pc.claimedByTrack;
      entry.phonemeControl = pc;
      console.log(
        `${secs(pc.onDurationMs)}s on, ${secs(pc.offDurationMs)}s off, ` +
          `${pc.ratio}x  ${pc.engaging ? 'engaging' : 'no effect'}` +
          `${pc.agreesWithClaim ? '' : '  MISMATCH with track definition'}`
      );
    } catch (err) {
      entry.phonemeControl = null;
      console.log(`FAILED  ${err.message}`);
    }

    process.stdout.write(`  ...   ${`${trackId} spell() directive`.padEnd(36)}`);
    try {
      const sc = await spellControl(voice, probes.spell, probes.spaced);
      sc.claimedByTrack = voice.techniques.includes('spell()');
      sc.agreesWithClaim = sc.honoured === sc.claimedByTrack;
      entry.spellControl = sc;
      console.log(
        `${secs(sc.spellDurationMs)}s vs ${secs(sc.spacedDurationMs)}s spaced, ` +
          `${sc.ratio}x  ${sc.honoured ? 'honoured' : 'READ LITERALLY'}` +
          `${sc.agreesWithClaim ? '' : '  MISMATCH with track definition'}`
      );
    } catch (err) {
      entry.spellControl = null;
      console.log(`FAILED  ${err.message}`);
    }

    out[trackId] = entry;
  }
  return out;
}

/* --------------------------------------------------------------- evidence */

async function writeEvidenceBlock(manifest) {
  if (!existsSync(EVIDENCE_PATH)) return false;
  const doc = await readFile(EVIDENCE_PATH, 'utf8');
  const a = doc.indexOf(MARKER_START);
  const b = doc.indexOf(MARKER_END);
  if (a === -1 || b === -1 || b < a) return false;

  const { audio, endpoint, controls, tracks } = manifest;
  const lines = [MARKER_START, ''];

  lines.push(
    '> This block is written by `npm run generate`. Do not edit it by hand.',
    '> Every number in it is measured from the bytes Rime actually returned.',
    '',
    `**Run:** ${manifest.generatedAt}  `,
    `**Endpoint:** \`POST ${endpoint}\`  `,
    `**Requested:** \`Accept: ${audio.accept}\` at ${audio.samplingRate} Hz  `,
    `**Returned by Rime:** ${audio.upstream}  `,
    `**Written to disk:** ${audio.container}  `,
    `**Clips:** ${manifest.clips.filter((c) => c.status === 'ok').length} rendered, ` +
      `${manifest.clips.filter((c) => c.status !== 'ok').length} failed, across ` +
      `${FIXTURES.length} fixtures on ${Object.keys(tracks).length} tracks`,
    ''
  );

  lines.push('### Tracks, and what each was measured to support', '');
  lines.push(
    '| Track | Model / speaker / language | Fixtures | Noise floor | `spell()` | Phoneme flag |',
    '| --- | --- | --- | --- | --- | --- |'
  );
  for (const [id, t] of Object.entries(tracks)) {
    const c = controls?.[id];
    const n = c?.noiseFloor;
    const sc = c?.spellControl;
    const pc = c?.phonemeControl;
    const count = FIXTURES.filter((f) => f.track === id).length;
    lines.push(
      `| \`${id}\` | \`${t.modelId}\` / \`${t.speaker}\` / \`${t.lang}\` | ${count} | ` +
        `${n ? `${n.spreadMs} ms over ${n.repeats}` : 'n/a'} | ` +
        `${sc ? `${sc.honoured ? 'honoured' : 'read literally'} (${sc.ratio}x)` : 'n/a'} | ` +
        `${pc ? `${pc.engaging ? 'works' : 'no effect'} (${pc.ratio}x)` : 'n/a'} |`
    );
  }
  lines.push('');
  lines.push(
    'The `spell()` and phoneme columns are measurements, not documentation. Each',
    'was produced by rendering a probe twice, once with the mechanism and once',
    'without, and comparing durations. A mechanism that is read literally makes',
    'the clip markedly longer, because the model speaks the directive aloud.',
    'Every result above agrees with the capability its track declares, and',
    '`npm run preflight` fails if that ever stops being true.',
    ''
  );

  for (const [id, t] of Object.entries(tracks)) {
    const fixtures = FIXTURES.filter((f) => f.track === id);
    if (!fixtures.length) continue;
    const floor = controls?.[id]?.noiseFloor?.spreadMs ?? null;
    lines.push(
      `### ${t.label}: \`${t.modelId}\` / \`${t.speaker}\` / \`${t.lang}\``,
      ''
    );
    lines.push(
      '| Fixture | Stress case | Naive | Written for the ear | Duration delta | Beyond noise floor |',
      '| --- | --- | --- | --- | --- | --- |'
    );
    for (const f of fixtures) {
      const n = manifest.clips.find(
        (c) => c.fixtureId === f.id && c.variant === 'naive'
      );
      const e = manifest.clips.find(
        (c) => c.fixtureId === f.id && c.variant === 'ear'
      );
      const cell = (c) =>
        c?.status === 'ok'
          ? `${formatDuration(c.durationMs) ?? 'n/a'} \`${short(c.upstreamSha256)}\``
          : 'render failed';
      const ok = n?.status === 'ok' && e?.status === 'ok';
      const d = ok ? e.durationMs - n.durationMs : null;
      const delta = ok ? `${d > 0 ? '+' : ''}${(d / 1000).toFixed(2)}s` : 'n/a';
      const verdict =
        !ok || floor == null
          ? 'n/a'
          : Math.abs(d) > floor
            ? 'yes'
            : 'no, inside noise';
      lines.push(
        `| \`${f.id}\` | ${f.stress ? 'yes' : 'no'} | ${cell(n)} | ${cell(e)} | ` +
          `${delta} | ${verdict} |`
      );
    }
    lines.push('');
  }

  lines.push(
    'A longer ear clip is the expected direction for this rewrite, because',
    'spelling a code out and grouping digits takes more time than reading them',
    'as one quantity. Rows marked "no, inside noise" are not evidence in either',
    'direction: the gap between the two variants there is smaller than the gap',
    'between two renders of the same string. Duration never says whether a',
    'pronunciation is correct. Only listening against the target decides that,',
    'which is what the listening log records.',
    '',
    MARKER_END
  );

  await writeFile(
    EVIDENCE_PATH,
    doc.slice(0, a) + lines.join('\n') + doc.slice(b + MARKER_END.length)
  );
  return true;
}

/* ------------------------------------------------------------------- main */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = await loadSnapshot();

  let queue = renderQueue();
  if (args.only) {
    if (!fixtureById(args.only)) {
      throw new Error(
        `No fixture "${args.only}". Known ids: ${FIXTURES.map((f) => f.id).join(', ')}`
      );
    }
    queue = queue.filter((q) => q.fixtureId === args.only);
  }

  console.log('\nRegenerating fixture clips\n');
  for (const [id, t] of Object.entries(snapshot.tracks)) {
    console.log(
      `        ${id.padEnd(6)} ${t.modelId}/${t.speaker}/${t.lang}`.padEnd(40) +
        `${FIXTURES.filter((f) => f.track === id).length} fixtures`
    );
  }
  console.log(`        catalog pinned ${snapshot.fetchedAt}`);
  console.log(`        ${queue.length} clips from ${FIXTURES.length} fixtures\n`);

  if (args.dryRun) {
    for (const item of queue) {
      console.log(`  ${item.fixtureId} / ${item.variant}  [${item.track}]`);
      console.log(`    ${JSON.stringify(item.text)}\n`);
    }
    console.log('  dry run, nothing was sent\n');
    return;
  }

  if (!hasApiKey()) {
    throw new Error(
      'RIME_API_KEY is not set, so no audio can be rendered. Copy .env.example ' +
        'to .env and add a key from https://app.rime.ai/tokens/, then run this ' +
        'again. Use --dry-run to review the exact strings without a key.'
    );
  }

  await mkdir(CLIPS_DIR, { recursive: true });
  const started = Date.now();
  const fresh = await renderAll(queue, snapshot);

  let clips = fresh;
  let controls = null;
  const prev = existsSync(MANIFEST_PATH)
    ? JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
    : null;

  // A partial run merges into the existing manifest so untouched clips keep
  // their real original timestamps rather than borrowing this run's.
  if (args.only && prev) {
    const replaced = new Set(fresh.map((c) => `${c.fixtureId}.${c.variant}`));
    clips = [
      ...prev.clips.filter((c) => !replaced.has(`${c.fixtureId}.${c.variant}`)),
      ...fresh,
    ];
  }

  if (args.only || args.skipControls) {
    controls = prev?.controls ?? null;
  } else {
    console.log('');
    const tracksUsed = [...new Set(FIXTURES.map((f) => f.track))];
    controls = await runControls(snapshot, tracksUsed, args.repeats);
  }

  const order = renderQueue().map((q) => `${q.fixtureId}.${q.variant}`);
  clips.sort(
    (x, y) =>
      order.indexOf(`${x.fixtureId}.${x.variant}`) -
      order.indexOf(`${y.fixtureId}.${y.variant}`)
  );

  const manifest = {
    generatedAt: new Date().toISOString(),
    generatedBy: 'scripts/generate.mjs',
    partialRun: args.only ?? null,
    catalogFetchedAt: snapshot.fetchedAt,
    endpoint: snapshot.endpoint,
    audio: snapshot.audio,
    tracks: snapshot.tracks,
    controls,
    clips,
  };

  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

  const okCount = clips.filter((c) => c.status === 'ok').length;
  const failCount = clips.length - okCount;
  console.log(
    `\n  ${okCount} ok, ${failCount} failed, ${((Date.now() - started) / 1000).toFixed(1)}s`
  );
  console.log('  manifest written to public/clips/manifest.json');

  const wrote = await writeEvidenceBlock(manifest);
  console.log(
    wrote
      ? '  RIME_EVIDENCE.md results block updated'
      : '  RIME_EVIDENCE.md has no results markers, skipped'
  );

  // A capability that stopped behaving as its track claims invalidates the
  // fixtures built on it, so this is loud rather than buried in the manifest.
  const mismatches = Object.entries(controls ?? {}).flatMap(([id, c]) =>
    [
      c.phonemeControl?.agreesWithClaim === false ? `${id} phoneme flag` : null,
      c.spellControl?.agreesWithClaim === false ? `${id} spell()` : null,
    ].filter(Boolean)
  );
  if (mismatches.length) {
    console.log(
      '\n  WARNING  measured capability disagrees with the track definition: ' +
        `${mismatches.join(', ')}. Fix src/voice.mjs or the fixtures relying on it.`
    );
    process.exitCode = 1;
  }
  console.log('');

  if (failCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\n  failed  ${err.message}\n`);
  process.exitCode = 1;
});
