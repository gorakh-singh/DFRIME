#!/usr/bin/env node
/**
 * npm run preflight
 *
 * Checks that every track's model, speaker, language and audio format still
 * work end to end, that no fixture uses a mechanism its track does not support,
 * and that nothing in the repo is claiming more than it can back up.
 *
 * Run before submitting, before recording a demo, and after any change to the
 * fixture list. It spends one real Rime request per track.
 *
 * Note on scope: this is the project's own preflight. Run the organizer's
 * preflight separately. This script does not stand in for it and does not
 * claim to.
 */

import '../src/env.mjs';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fetchJson, synthesize, hasApiKey } from '../src/rime.mjs';
import {
  loadSnapshot,
  voiceForTrack,
  selectAllTracks,
  TRACKS,
  CATALOG_URLS,
  ROOT,
  AUDIO,
} from '../src/voice.mjs';
import { FIXTURES, renderQueue, TECHNIQUES } from '../src/fixtures.mjs';

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(
    `  ${pass ? 'pass' : 'FAIL'}  ${name.padEnd(46)} ${detail ?? ''}`.trimEnd()
  );
};

async function main() {
  console.log('\nPreflight\n');

  let snapshot;
  try {
    snapshot = await loadSnapshot({ force: true });
    record('catalog-snapshot.json present', true, `pinned ${snapshot.fetchedAt}`);
  } catch (err) {
    record('catalog-snapshot.json present', false, err.message);
    return summarise();
  }

  // Every pinned voice still resolves the same way against today's catalog.
  try {
    const [byModel, details] = await Promise.all([
      fetchJson(CATALOG_URLS.voicesByModel),
      fetchJson(CATALOG_URLS.voiceDetails),
    ]);
    const live = selectAllTracks(byModel, details);
    const drifted = Object.keys(TRACKS).filter((id) => {
      const p = snapshot.tracks?.[id];
      return (
        !p ||
        p.modelId !== live[id].modelId ||
        p.speaker !== live[id].speaker ||
        p.lang !== live[id].lang
      );
    });
    record(
      'every pinned voice still current in live catalog',
      drifted.length === 0,
      drifted.length === 0
        ? Object.entries(live)
            .map(([id, v]) => `${id}=${v.speaker}`)
            .join(' ')
        : `drifted: ${drifted.join(', ')}. Run npm run catalog and npm run generate.`
    );
  } catch (err) {
    record('every pinned voice still current in live catalog', false, err.message);
  }

  // ------------------------------------------------------ fixture integrity
  const tooLong = renderQueue().filter((q) => q.text.length > 1000);
  record(
    'every variant within the 1000 char limit',
    tooLong.length === 0,
    tooLong.length === 0
      ? `${renderQueue().length} strings checked`
      : tooLong.map((q) => `${q.fixtureId}/${q.variant}`).join(', ')
  );

  const identical = FIXTURES.filter((f) => f.naive === f.ear);
  record(
    'naive and ear differ for every fixture',
    identical.length === 0,
    identical.length === 0
      ? `${FIXTURES.length} fixtures`
      : identical.map((f) => f.id).join(', ')
  );

  const noTarget = FIXTURES.filter((f) => !f.target || f.target.trim() === '');
  record(
    'every fixture has a target pronunciation',
    noTarget.length === 0,
    noTarget.length === 0 ? 'all present' : noTarget.map((f) => f.id).join(', ')
  );

  const orphaned = FIXTURES.filter((f) => !snapshot.tracks?.[f.track]);
  record(
    'every fixture belongs to a pinned track',
    orphaned.length === 0,
    orphaned.length === 0
      ? Object.keys(snapshot.tracks)
          .map((id) => `${id}=${FIXTURES.filter((f) => f.track === id).length}`)
          .join(' ')
      : orphaned.map((f) => `${f.id} wants ${f.track}`).join(', ')
  );

  // The check that keeps the Hindi track honest. A fixture using a mechanism
  // its track cannot honour would still render and still sound perfectly fine
  // while proving nothing at all.
  const illegal = [];
  for (const f of FIXTURES) {
    const allowed = snapshot.tracks?.[f.track]?.techniques ?? [];
    for (const t of f.technique) {
      if (!TECHNIQUES[t]) illegal.push(`${f.id} names unknown technique ${t}`);
      else if (!allowed.includes(t)) illegal.push(`${f.id} uses ${t} on ${f.track}`);
    }
  }
  record(
    'no fixture uses a technique its track lacks',
    illegal.length === 0,
    illegal.length === 0
      ? `${FIXTURES.length} fixtures checked against their track`
      : illegal.join('; ')
  );

  const stress = FIXTURES.filter((f) => f.stress);
  record(
    'stress cases present and explained',
    stress.length > 0 && stress.every((f) => f.stressWhy),
    stress.map((f) => f.id).join(', ') || 'none found'
  );

  // A judge who does not read Devanagari still has to be able to check these.
  const needsTranslation = FIXTURES.filter(
    (f) => snapshot.tracks?.[f.track]?.lang !== 'eng' && !f.translation
  );
  record(
    'non-English fixtures carry a translation',
    needsTranslation.length === 0,
    needsTranslation.length === 0
      ? `${FIXTURES.filter((f) => f.translation).length} translated`
      : needsTranslation.map((f) => f.id).join(', ')
  );

  if (!hasApiKey()) {
    record(
      'RIME_API_KEY set',
      false,
      'copy .env.example to .env and add a key, then run again'
    );
    return summarise();
  }
  record('RIME_API_KEY set', true, 'read from .env, server side only');

  // ------------------------------------------------- one round trip per track
  for (const trackId of Object.keys(snapshot.tracks)) {
    const voice = voiceForTrack(snapshot, trackId);
    const probe =
      voice.lang === 'hin'
        ? 'प्रीफ्लाइट जांच। कोड spell(A7X4B9)।'
        : 'Preflight check. Order code spell(A7X4B9).';
    try {
      const res = await synthesize({ text: probe, voice });
      record(
        `${trackId} renders end to end`,
        res.durationMs > 0 && res.sampleRate === AUDIO.samplingRate,
        `${voice.modelId}/${voice.speaker}/${voice.lang}, ${res.totalMs} ms, ` +
          `${res.container}, ${res.sampleRate} Hz, ` +
          `${(res.durationMs / 1000).toFixed(2)}s`
      );
    } catch (err) {
      record(`${trackId} renders end to end`, false, err.message);
    }
  }

  // -------------------------------------------- clip and control freshness
  const manifestPath = join(ROOT, 'public', 'clips', 'manifest.json');
  if (!existsSync(manifestPath)) {
    record(
      'rendered clips match the current fixture text',
      false,
      'no manifest yet, run npm run generate'
    );
    return summarise();
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const stale = [];
  for (const q of renderQueue()) {
    const clip = manifest.clips.find(
      (c) => c.fixtureId === q.fixtureId && c.variant === q.variant
    );
    if (!clip) stale.push(`${q.fixtureId}/${q.variant} missing`);
    else if (clip.textSha256 !== sha(q.text))
      stale.push(`${q.fixtureId}/${q.variant} text changed`);
    else if (clip.status === 'ok' && !existsSync(join(ROOT, 'public', clip.file)))
      stale.push(`${q.fixtureId}/${q.variant} file gone`);
  }
  record(
    'rendered clips match the current fixture text',
    stale.length === 0,
    stale.length === 0
      ? `${manifest.clips.length} clips, generated ${manifest.generatedAt}`
      : `${stale.length} stale: ${stale.slice(0, 3).join('; ')}. Run npm run generate.`
  );

  const controls = manifest.controls ?? {};
  const missingFloor = Object.keys(snapshot.tracks).filter(
    (id) => controls[id]?.noiseFloor == null
  );
  record(
    'noise floor measured for every track',
    missingFloor.length === 0,
    missingFloor.length === 0
      ? Object.entries(controls)
          .map(([id, c]) => `${id}=${c.noiseFloor.spreadMs}ms`)
          .join(' ')
      : `missing for ${missingFloor.join(', ')}, run npm run generate`
  );

  // If a mechanism silently stops working, every fixture built on it stops
  // proving anything while continuing to sound completely fine.
  const disagree = [];
  for (const [id, c] of Object.entries(controls)) {
    if (c.phonemeControl && !c.phonemeControl.agreesWithClaim)
      disagree.push(`${id} phoneme (measured ${c.phonemeControl.ratio}x)`);
    if (c.spellControl && !c.spellControl.agreesWithClaim)
      disagree.push(`${id} spell() (measured ${c.spellControl.ratio}x)`);
  }
  record(
    'measured capabilities agree with track definitions',
    disagree.length === 0,
    disagree.length === 0
      ? Object.entries(controls)
          .map(
            ([id, c]) =>
              `${id} spell=${c.spellControl?.honoured ? 'y' : 'n'} ` +
              `phon=${c.phonemeControl?.engaging ? 'y' : 'n'}`
          )
          .join(' | ')
      : disagree.join('; ')
  );

  summarise();
}

function summarise() {
  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n  ${results.length - failed.length} of ${results.length} checks passed\n`
  );
  if (failed.length) {
    console.log('  Blocking:');
    for (const f of failed) console.log(`    ${f.name}`);
    console.log('');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\n  failed  ${err.message}\n`);
  process.exitCode = 1;
});
