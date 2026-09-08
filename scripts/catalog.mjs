#!/usr/bin/env node
/**
 * npm run catalog
 *
 * Fetches Rime's live public voice catalog, resolves a speaker for every track
 * in src/voice.mjs, and pins the result to catalog-snapshot.json.
 *
 * No API key is needed. Both catalog files are public and, per Rime's docs,
 * update as voices ship. That is the point of doing this at build time rather
 * than hardcoding speaker ids: if a voice this project renders with is ever
 * withdrawn, this script fails loudly instead of the app rendering with a
 * silent substitute and quietly breaking the controlled comparison.
 */

import { writeFile } from 'node:fs/promises';
import { fetchJson } from '../src/rime.mjs';
import {
  CATALOG_URLS,
  SNAPSHOT_PATH,
  TRACKS,
  selectAllTracks,
  renderOptionsFor,
  AUDIO,
  ENDPOINT,
} from '../src/voice.mjs';

const ok = (s) => `  ok    ${s}`;
const info = (s) => `        ${s}`;

async function main() {
  console.log('\nRime live catalog\n');
  console.log(info(CATALOG_URLS.voicesByModel));
  console.log(info(CATALOG_URLS.voiceDetails));

  const [voicesByModel, voiceDetails] = await Promise.all([
    fetchJson(CATALOG_URLS.voicesByModel),
    fetchJson(CATALOG_URLS.voiceDetails),
  ]);

  const models = Object.keys(voicesByModel);
  console.log(ok(`${models.length} models live: ${models.join(', ')}`));
  console.log(ok(`${voiceDetails.length} voice records`));

  // Which languages exist at all. Recorded because the Hindi track's existence
  // and the absence of every other Indian language are both catalog facts, not
  // decisions made here, and a reader should be able to check that.
  const languages = {};
  for (const v of voiceDetails) languages[v.lang] = (languages[v.lang] ?? 0) + 1;
  console.log(
    ok(
      `${Object.keys(languages).length} languages: ` +
        Object.entries(languages)
          .sort((a, b) => b[1] - a[1])
          .map(([l, n]) => `${l}=${n}`)
          .join(' ')
    )
  );

  const tracks = selectAllTracks(voicesByModel, voiceDetails);

  console.log('');
  for (const [id, v] of Object.entries(tracks)) {
    console.log(
      ok(
        `${id.padEnd(6)} ${v.modelId}/${v.speaker}/${v.lang}`.padEnd(34) +
          `pref ${v.preferenceRank} of ${v.preferenceList.length}, ` +
          `${v.catalogSpeakerCount} speakers available`
      )
    );
    if (v.detail) console.log(info(`  "${v.detail.description}"`));
    console.log(info(`  techniques: ${v.techniques.join(', ')}`));
  }

  const snapshot = {
    fetchedAt: new Date().toISOString(),
    sources: CATALOG_URLS,
    endpoint: ENDPOINT,
    audio: AUDIO,
    defaultTrack: 'en-US',
    trackDefinitions: TRACKS,
    tracks: Object.fromEntries(
      Object.entries(tracks).map(([id, v]) => [
        id,
        { ...v, renderOptions: renderOptionsFor(id) },
      ])
    ),
    liveCatalog: {
      models,
      voiceRecordCount: voiceDetails.length,
      languages,
      // Kept in full so a reader can confirm each speaker was chosen from a
      // real list rather than asserted. This is the evidence for "not stale".
      speakersByTrack: Object.fromEntries(
        Object.entries(tracks).map(([id, v]) => [
          id,
          voicesByModel[v.modelId][v.lang],
        ])
      ),
      speakerCountsByModel: Object.fromEntries(
        Object.entries(voicesByModel).map(([m, langs]) => [
          m,
          Object.fromEntries(
            Object.entries(langs).map(([l, arr]) => [l, arr.length])
          ),
        ])
      ),
    },
  };

  await writeFile(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`\n${ok('catalog-snapshot.json written')}`);
  console.log(
    `\n  ${Object.keys(tracks).length} tracks pinned, ` +
      `${AUDIO.accept} @ ${AUDIO.samplingRate} Hz\n`
  );
}

main().catch((err) => {
  console.error(`\n  failed  ${err.message}\n`);
  process.exitCode = 1;
});
