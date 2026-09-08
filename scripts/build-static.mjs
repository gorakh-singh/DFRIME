#!/usr/bin/env node
/**
 * npm run build:static
 *
 * Writes public/state.json, a frozen copy of what GET /api/state would return,
 * so that public/ can be served by any static host (GitHub Pages, Netlify drop,
 * an S3 bucket) with no Node process behind it.
 *
 * WHAT A STATIC DEPLOY LOSES, STATED PLAINLY
 *
 * Live rendering. There is no server to hold the API key, so there is nothing
 * to proxy a request through, and putting the key in the page would publish it.
 * The build therefore sets liveAvailable to false and stamps a reason, and the
 * page disables the live controls and says why. It does not pretend, and it
 * does not quietly replay a cached clip in place of a live one.
 *
 * Everything else works: all fixtures, all cached clips with their real
 * provenance and timestamps, the waveforms, the targets, the measured control
 * results and the listening log, which falls back to browser storage because
 * there is no server to write verdicts.json.
 *
 * For the full artifact, including live calls, deploy to a Node host instead.
 * See DEPLOY.md.
 */

import { writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadSnapshot, ROOT, AUDIO, ENDPOINT } from '../src/voice.mjs';
import { FIXTURES, TECHNIQUES, CATEGORIES } from '../src/fixtures.mjs';

const PUBLIC_DIR = join(ROOT, 'public');
const MANIFEST_PATH = join(PUBLIC_DIR, 'clips', 'manifest.json');
const OUT = join(PUBLIC_DIR, 'state.json');

async function main() {
  const snapshot = await loadSnapshot({ force: true });

  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(
      'No clip manifest. Run `npm run generate` before building a static copy, ' +
        'or the deployed site will show "not rendered" on every fixture.'
    );
  }
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));

  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const clips = {};
  let missing = 0;
  for (const f of FIXTURES) {
    for (const variant of ['naive', 'ear']) {
      const key = `${f.id}.${variant}`;
      const rec = manifest.clips.find(
        (c) => c.fixtureId === f.id && c.variant === variant
      );
      if (!rec || rec.status !== 'ok') {
        clips[key] = { state: rec ? 'failed' : 'absent', error: rec?.error };
        missing += 1;
      } else if (rec.textSha256 !== sha(f[variant])) {
        clips[key] = { state: 'stale', renderedAt: rec.renderedAt };
        missing += 1;
      } else if (!existsSync(join(PUBLIC_DIR, rec.file))) {
        clips[key] = { state: 'absent', note: 'manifest lists it, file is gone' };
        missing += 1;
      } else {
        clips[key] = {
          state: 'ready',
          // Relative, so the site works under a project subpath such as
          // https://user.github.io/repo/ without any base-path configuration.
          src: rec.file,
          durationMs: rec.durationMs,
          bytes: rec.bytes,
          audioSha256: rec.upstreamSha256,
          container: rec.container,
          voice: rec.voice,
          track: rec.track,
          renderedAt: rec.renderedAt,
          ttfbMs: rec.ttfbMs,
          totalMs: rec.totalMs,
          sampleRate: rec.sampleRate,
        };
      }
    }
  }

  const state = {
    staticBuild: true,
    builtAt: new Date().toISOString(),
    provider: {
      name: 'Rime',
      endpoint: ENDPOINT,
      fallbackConfigured: false,
      keyPresent: false,
      liveAvailable: false,
      liveDisabledReason:
        'This is a static deployment with no server behind it, so there is ' +
        'nothing to hold the Rime API key and nothing to proxy a live call ' +
        'through. Putting the key in the page would publish it. Every clip ' +
        'below is a stored render with its real timestamp. To make live calls, ' +
        'run the project locally or deploy it to a Node host. See DEPLOY.md.',
    },
    tracks: snapshot.tracks,
    defaultTrack: snapshot.defaultTrack,
    catalog: {
      fetchedAt: snapshot.fetchedAt,
      sources: snapshot.sources,
      models: snapshot.liveCatalog.models,
      languages: snapshot.liveCatalog.languages,
      voiceRecordCount: snapshot.liveCatalog.voiceRecordCount,
    },
    audio: snapshot.audio,
    snapshotError: null,
    manifest: {
      generatedAt: manifest.generatedAt,
      partialRun: manifest.partialRun,
    },
    controls: manifest.controls,
    fixtures: FIXTURES,
    techniques: TECHNIQUES,
    categories: CATEGORIES,
    clips,
    verdicts: {},
  };

  await writeFile(OUT, `${JSON.stringify(state, null, 2)}\n`);

  console.log('\nStatic build\n');
  console.log(`  ok    public/state.json written`);
  console.log(`  ok    ${FIXTURES.length} fixtures, ${Object.keys(clips).length} clips`);
  if (missing) {
    console.log(`  warn  ${missing} clips are absent, failed or stale`);
  }
  console.log(`  note  live rendering is disabled in this build, and the page`);
  console.log(`        says so. Deploy to a Node host for live calls.`);
  console.log(`\n  Serve the public/ directory. Nothing else is needed.\n`);

  if (missing) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\n  failed  ${err.message}\n`);
  process.exitCode = 1;
});
