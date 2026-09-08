/**
 * Voice selection, per track.
 *
 * A track is one (model, language, speaker) combination plus the set of text
 * controls that combination actually supports. Every fixture belongs to exactly
 * one track, and BOTH variants of that fixture are rendered with that track's
 * voice and options. That is what makes each pair a controlled comparison: the
 * model, speaker and language are held constant inside the pair, and only the
 * characters in `text` change.
 *
 * Tracks exist because Rime's capabilities are not uniform. Hindi is not
 * available on Mist v2, and the phoneme control this project leans on for names
 * is Mist v1 and v2 only. Pretending one voice covers everything would mean
 * either dropping Hindi or quietly shipping a Hindi fixture whose "fix" does
 * nothing.
 *
 * Speakers are chosen against Rime's LIVE public catalog, never from a list
 * pasted into this file. `scripts/catalog.mjs` fetches the catalog, runs the
 * policy below for every track, and writes catalog-snapshot.json.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');
export const SNAPSHOT_PATH = join(ROOT, 'catalog-snapshot.json');

export const CATALOG_URLS = {
  voicesByModel: 'https://users.rime.ai/data/voices/all-v2.json',
  voiceDetails: 'https://users.rime.ai/data/voices/voice_details.json',
};

export const ENDPOINT = 'https://users.rime.ai/v1/rime-tts';

/** Audio contract. Identical across every track and every render. */
export const AUDIO = {
  accept: 'audio/wav',
  extension: 'wav',
  samplingRate: 24000,
  // Measured, not assumed. Under Accept: audio/wav the streaming endpoint
  // answers content-type audio/wav but sends a headerless 16-bit LE PCM
  // stream, so the RIFF container is added locally. See src/wav.mjs.
  upstream: 'headerless 16-bit little-endian linear PCM, mono, chunked',
  container: 'RIFF WAVE added locally around Rime’s PCM samples',
};

/** Options identical across every track. Only phonemize varies, per track. */
export const SHARED_OPTIONS = {
  samplingRate: AUDIO.samplingRate,
  speedAlpha: 1.0,
  reduceLatency: false,
};

/**
 * The tracks.
 *
 * `techniques` is the set of rewrite mechanisms a fixture on this track is
 * allowed to use. These are not copied from the docs and hoped for. Each one
 * was measured against this exact model and speaker by rendering a probe with
 * the mechanism and again without it, and comparing durations. The numbers in
 * the comments are from those runs, and `npm run preflight` re-checks the two
 * that matter on every run.
 *
 * The measurement that decided the Hindi track:
 *
 *   spell() honoured?      arcana/anaya/hin  1.07x vs a manual spell-out  yes
 *                          coda/taru/hin     1.80x                        NO
 *   phoneme flag on/off?   arcana/anaya/hin  1.27x                        no effect
 *                          mistv2/ritu/eng   1.93x                        works
 *
 * Coda reading spell() literally matches Rime's own documentation, which says
 * Coda's pipeline has no spell() stage. Arcana honouring it is not documented
 * anywhere; it is only in this project because it was tested.
 */
export const TRACKS = {
  'en-US': {
    label: 'US English',
    modelId: 'mistv2',
    lang: 'eng',
    speakerPreference: ['summit', 'peak', 'talon', 'moraine', 'lagoon'],
    phonemizeBetweenBrackets: true,
    techniques: ['normalizer-format', 'spell()', 'phoneme', 'expand', 'pacing'],
    why:
      'Mist v2 is the only model carrying the text normalizer, spell() and ' +
      'phonemizeBetweenBrackets at once, which is the full toolkit for a ' +
      'pronunciation brief.',
  },
  'en-IN': {
    label: 'Indian English',
    modelId: 'mistv2',
    lang: 'eng',
    speakerPreference: ['ritu', 'rohan', 'ironwood', 'hawk'],
    phonemizeBetweenBrackets: true,
    techniques: ['normalizer-format', 'spell()', 'phoneme', 'expand', 'pacing'],
    why:
      'The common real deployment is an Indian business calling Indian ' +
      'customers with an English voice. Mist v2 carries Indian-accent English ' +
      'speakers, so this track keeps the full toolkit while changing the data ' +
      'to Indian names, mobile numbers, addresses and tax identifiers.',
  },
  'hi-IN': {
    label: 'Hindi',
    modelId: 'arcana',
    lang: 'hin',
    speakerPreference: ['anaya', 'arya', 'anil'],
    // Measured at 1.27x on/off, which is inside the noise. The flag does
    // nothing here, so it is off and no Hindi fixture may use phonemes.
    phonemizeBetweenBrackets: false,
    techniques: ['normalizer-format', 'spell()', 'expand', 'pacing'],
    why:
      'Hindi is not offered on Mist v2, so a different model is required. ' +
      'Arcana was chosen over Coda because Coda reads spell() aloud as a word ' +
      'instead of honouring it, which was measured, and spell() is the control ' +
      'that reference codes depend on. Phoneme brackets have no effect on ' +
      'Arcana, so this track has a genuinely smaller toolkit and its fixtures ' +
      'are built only from mechanisms that were verified to work.',
  },
};

export const DEFAULT_TRACK = 'en-US';

/** Request options for one track. Applied to both variants of its fixtures. */
export function renderOptionsFor(track) {
  const t = TRACKS[track];
  if (!t) throw new Error(`Unknown track "${track}"`);
  return {
    modelId: t.modelId,
    lang: t.lang,
    ...SHARED_OPTIONS,
    phonemizeBetweenBrackets: t.phonemizeBetweenBrackets,
  };
}

/** Resolves one track's speaker against a live catalog. Pure, so it is testable. */
export function selectTrackVoice(trackId, voicesByModel, voiceDetails) {
  const t = TRACKS[trackId];
  if (!t) throw new Error(`Unknown track "${trackId}"`);

  const models = Object.keys(voicesByModel);
  if (!models.includes(t.modelId)) {
    throw new Error(
      `Track "${trackId}" needs model "${t.modelId}", which Rime's live ` +
        `catalog no longer lists. Models present: ${models.join(', ')}.`
    );
  }

  const speakers = voicesByModel[t.modelId]?.[t.lang];
  if (!Array.isArray(speakers) || speakers.length === 0) {
    throw new Error(
      `Track "${trackId}": model "${t.modelId}" lists no "${t.lang}" speakers ` +
        'in the live catalog.'
    );
  }

  const speaker = t.speakerPreference.find((s) => speakers.includes(s));
  if (!speaker) {
    throw new Error(
      `Track "${trackId}": none of the preferred speakers are in the live ` +
        `catalog. Wanted one of ${t.speakerPreference.join(', ')}. ` +
        `${t.modelId}/${t.lang} currently offers ${speakers.length}, for ` +
        `example ${speakers.slice(0, 8).join(', ')}.`
    );
  }

  const detail =
    voiceDetails.find(
      (v) => v.speaker === speaker && v.modelId === t.modelId && v.lang === t.lang
    ) ?? null;

  return {
    track: trackId,
    label: t.label,
    modelId: t.modelId,
    speaker,
    lang: t.lang,
    preferenceRank: t.speakerPreference.indexOf(speaker) + 1,
    preferenceList: t.speakerPreference,
    techniques: t.techniques,
    why: t.why,
    detail,
    catalogSpeakerCount: speakers.length,
  };
}

/** Resolves every track. Fails loudly if any one of them cannot be satisfied. */
export function selectAllTracks(voicesByModel, voiceDetails) {
  const out = {};
  for (const trackId of Object.keys(TRACKS)) {
    out[trackId] = selectTrackVoice(trackId, voicesByModel, voiceDetails);
  }
  return out;
}

let cached = null;

/** Reads catalog-snapshot.json. Throws with a fix instruction if absent. */
export async function loadSnapshot({ force = false } = {}) {
  if (cached && !force) return cached;
  let raw;
  try {
    raw = await readFile(SNAPSHOT_PATH, 'utf8');
  } catch {
    throw new Error(
      'catalog-snapshot.json is missing. Run `npm run catalog` first. It fetches ' +
        'Rime’s public voice catalog and pins the model, speaker and language ' +
        'each track renders with. Nothing here guesses a voice id.'
    );
  }
  cached = JSON.parse(raw);
  return cached;
}

/** The pinned voice for a track, out of a loaded snapshot. */
export function voiceForTrack(snapshot, trackId) {
  const v = snapshot?.tracks?.[trackId];
  if (!v) {
    throw new Error(
      `catalog-snapshot.json has no voice pinned for track "${trackId}". ` +
        'Run `npm run catalog`.'
    );
  }
  return v;
}
