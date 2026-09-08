/**
 * Rime client. No dependencies, uses global fetch.
 *
 * One function does the synthesis, and both the CLI and the server call it, so
 * a cached clip and a live clip are produced by exactly the same code path with
 * exactly the same options. That matters: if the two paths could drift, a
 * cached clip would stop being a fair stand-in for a live one, and the whole
 * live-versus-cached disclosure in the UI would be theatre.
 */

import { ENDPOINT, AUDIO, SHARED_OPTIONS } from './voice.mjs';
import { toPlayableWav } from './wav.mjs';

export class RimeError extends Error {
  constructor(message, { status = null, body = null } = {}) {
    super(message);
    this.name = 'RimeError';
    this.status = status;
    this.body = body;
  }
}

/** Reads the key from the environment. Never logged, never returned. */
export function apiKey() {
  const key = process.env.RIME_API_KEY;
  if (!key || key.trim() === '' || key.startsWith('rime_your_')) {
    throw new RimeError(
      'RIME_API_KEY is not set. Copy .env.example to .env and put a real key in ' +
        'it. Get one from https://app.rime.ai/tokens/. The key is read server ' +
        'side only and is never sent to the browser.'
    );
  }
  return key.trim();
}

export function hasApiKey() {
  try {
    apiKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Synthesize one string.
 *
 * `voice` is one track's pinned entry from catalog-snapshot.json, carrying
 * modelId, speaker, lang and that track's renderOptions. Both variants of a
 * fixture are sent with the same one, which is what makes them a controlled
 * pair. Options that do not vary by track come from SHARED_OPTIONS.
 *
 * Returns the raw audio bytes plus real measurements: time to first byte and
 * total wall time, both from performance.now() around the actual request.
 */
export async function synthesize({ text, voice, signal, overrides = {} }) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new RimeError('text is required');
  }
  if (text.length > 1000) {
    throw new RimeError(
      `text is ${text.length} characters. Rime's limit is 1000 per request.`
    );
  }
  if (!voice?.modelId || !voice?.speaker || !voice?.lang) {
    throw new RimeError('voice must carry modelId, speaker and lang');
  }

  const opts = voice.renderOptions ?? {};
  const body = {
    text,
    speaker: voice.speaker,
    modelId: voice.modelId,
    lang: voice.lang,
    samplingRate: opts.samplingRate ?? SHARED_OPTIONS.samplingRate,
    speedAlpha: opts.speedAlpha ?? SHARED_OPTIONS.speedAlpha,
    reduceLatency: opts.reduceLatency ?? SHARED_OPTIONS.reduceLatency,
    // Per track. It is true on Mist v2 and false on Arcana, where the flag was
    // measured to have no effect, so sending true there would be theatre.
    phonemizeBetweenBrackets: opts.phonemizeBetweenBrackets ?? false,
    // Overrides exist for one purpose: the control experiment that checks
    // phonemizeBetweenBrackets is engaging rather than ignored. No fixture
    // render passes them, so the held-constant guarantee is untouched.
    ...overrides,
  };

  const started = performance.now();
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
        Accept: AUDIO.accept,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof RimeError) throw err;
    throw new RimeError(`Could not reach Rime: ${err.message}`);
  }
  const ttfbMs = performance.now() - started;

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 400);
    } catch {
      /* body already consumed or empty */
    }
    throw new RimeError(`Rime returned HTTP ${res.status}`, {
      status: res.status,
      body: detail,
    });
  }

  const upstream = Buffer.from(await res.arrayBuffer());
  const totalMs = performance.now() - started;

  const contentType = res.headers.get('content-type') ?? '';
  if (upstream.length === 0) {
    throw new RimeError('Rime returned a 200 with an empty body', {
      status: 200,
      body: contentType,
    });
  }

  // Rime's streaming endpoint answers `audio/wav` but sends headerless 16-bit
  // LE PCM, which no browser will play. The container is added here, once, on
  // the single shared synthesis path, so a cached clip and a live clip are
  // wrapped identically. The samples themselves are untouched. See src/wav.mjs.
  const audio = toPlayableWav(upstream, {
    sampleRate: body.samplingRate,
  });

  return {
    // What Rime sent, byte for byte. This is the audio's provenance.
    upstream,
    // The same samples in a container a browser can decode.
    bytes: audio.bytes,
    container: audio.container,
    durationMs: audio.durationMs,
    sampleRate: audio.sampleRate,
    channels: audio.channels,
    bitsPerSample: audio.bitsPerSample,
    trimmedBytes: audio.trimmedBytes ?? 0,
    contentType,
    ttfbMs: Math.round(ttfbMs),
    totalMs: Math.round(totalMs),
    requestedAt: new Date().toISOString(),
    // Echoed back so a clip can always be traced to the exact options that
    // produced it, without trusting a caller to record them correctly.
    sent: { ...body, text },
    track: voice.track ?? null,
  };
}

/** Fetches a public catalog file. No key required, these are public URLs. */
export async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new RimeError(`GET ${url} returned HTTP ${res.status}`, {
      status: res.status,
    });
  }
  return res.json();
}
