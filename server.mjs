#!/usr/bin/env node
/**
 * Local server. Node standard library only, no dependencies.
 *
 * It does three things:
 *
 *   1. Serves public/ as static files, including the pre-rendered clips.
 *   2. Exposes /api/state, which is everything the page needs to render itself
 *      honestly: the pinned voice, the catalog timestamp, the fixture list, and
 *      the clip manifest with each clip's real measurements.
 *   3. Proxies /api/render to Rime for live synthesis.
 *
 * The API key is read from .env into this process and never leaves it. The
 * browser talks to /api/render, which holds the key, calls Rime, and returns
 * audio bytes. Nothing key-shaped is ever sent to the client, which is why
 * there is a server here at all rather than a static page.
 */

import './src/env.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { synthesize, hasApiKey, RimeError } from './src/rime.mjs';
import { loadSnapshot, voiceForTrack, ROOT, AUDIO, ENDPOINT } from './src/voice.mjs';
import { FIXTURES, TECHNIQUES, CATEGORIES } from './src/fixtures.mjs';

const PORT = Number(process.env.PORT) || 5311;
const PUBLIC_DIR = join(ROOT, 'public');
const MANIFEST_PATH = join(PUBLIC_DIR, 'clips', 'manifest.json');
const VERDICTS_PATH = join(ROOT, 'verdicts.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wav': 'audio/wav',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/**
 * A crude ceiling on live calls. Each one spends real credit, and a runaway
 * loop in the page should not be able to drain an account. Generous enough that
 * a person clicking Render will never notice it.
 */
const RATE = { windowMs: 60_000, max: 40, hits: [] };
function rateLimited() {
  const now = Date.now();
  RATE.hits = RATE.hits.filter((t) => now - t < RATE.windowMs);
  if (RATE.hits.length >= RATE.max) return true;
  RATE.hits.push(now);
  return false;
}

const json = (res, code, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
};

async function readBody(req, limitBytes = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error('request body too large');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function readJsonFile(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Everything the page needs, assembled server side so the UI cannot invent it. */
async function buildState() {
  let snapshot = null;
  let snapshotError = null;
  try {
    snapshot = await loadSnapshot({ force: true });
  } catch (err) {
    snapshotError = err.message;
  }

  const manifest = await readJsonFile(MANIFEST_PATH, null);
  const verdicts = await readJsonFile(VERDICTS_PATH, {});

  // Clips whose text no longer matches the fixture are reported as stale rather
  // than played. A clip that does not correspond to the string shown on screen
  // is worse than no clip at all.
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const clips = {};
  for (const f of FIXTURES) {
    for (const variant of ['naive', 'ear']) {
      const key = `${f.id}.${variant}`;
      const rec = manifest?.clips?.find(
        (c) => c.fixtureId === f.id && c.variant === variant
      );
      if (!rec) {
        clips[key] = { state: 'absent' };
      } else if (rec.status !== 'ok') {
        clips[key] = {
          state: 'failed',
          error: rec.error,
          errorStatus: rec.errorStatus ?? null,
          attemptedAt: rec.attemptedAt ?? null,
        };
      } else if (rec.textSha256 !== sha(f[variant])) {
        clips[key] = {
          state: 'stale',
          renderedText: rec.text,
          renderedAt: rec.renderedAt,
        };
      } else if (!existsSync(join(PUBLIC_DIR, rec.file))) {
        clips[key] = { state: 'absent', note: 'manifest lists it, file is gone' };
      } else {
        clips[key] = {
          state: 'ready',
          src: `/${rec.file}`,
          durationMs: rec.durationMs,
          bytes: rec.bytes,
          audioSha256: rec.upstreamSha256 ?? rec.audioSha256 ?? null,
          container: rec.container ?? null,
          voice: rec.voice ?? null,
          track: rec.track ?? null,
          renderedAt: rec.renderedAt,
          ttfbMs: rec.ttfbMs,
          totalMs: rec.totalMs,
          sampleRate: rec.sampleRate,
        };
      }
    }
  }

  return {
    provider: {
      name: 'Rime',
      endpoint: ENDPOINT,
      // There is no second provider wired up. Saying so is the point: the UI
      // shows what is actually speaking, and this is what it reads.
      fallbackConfigured: false,
      keyPresent: hasApiKey(),
      liveAvailable: hasApiKey() && snapshot != null,
    },
    tracks: snapshot?.tracks ?? null,
    defaultTrack: snapshot?.defaultTrack ?? 'en-US',
    catalog: snapshot
      ? {
          fetchedAt: snapshot.fetchedAt,
          sources: snapshot.sources,
          models: snapshot.liveCatalog.models,
          languages: snapshot.liveCatalog.languages,
          voiceRecordCount: snapshot.liveCatalog.voiceRecordCount,
          speakersByTrack: Object.fromEntries(
            Object.entries(snapshot.liveCatalog.speakersByTrack ?? {}).map(
              ([k, v]) => [k, v.length]
            )
          ),
        }
      : null,
    audio: snapshot?.audio ?? AUDIO,
    snapshotError,
    manifest: manifest
      ? { generatedAt: manifest.generatedAt, partialRun: manifest.partialRun }
      : null,
    // Per track, because the spread differs enormously between models and the
    // page must not present run-to-run variation as a difference between the
    // two variants. Also carries the spell() and phoneme capability probes.
    controls: manifest?.controls ?? null,
    fixtures: FIXTURES,
    techniques: TECHNIQUES,
    categories: CATEGORIES,
    clips,
    verdicts,
  };
}

async function handleRender(req, res) {
  if (rateLimited()) {
    return json(res, 429, {
      error:
        'Live render is rate limited to 40 calls a minute in this demo, so a ' +
        'stuck page cannot drain the account. Wait a moment and try again.',
    });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return json(res, 400, { error: err.message });
  }

  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) return json(res, 400, { error: 'text is required' });

  let snapshot;
  try {
    snapshot = await loadSnapshot();
  } catch (err) {
    return json(res, 503, { error: err.message });
  }

  const trackId = body.track ?? snapshot.defaultTrack ?? 'en-US';
  let voice;
  try {
    voice = voiceForTrack(snapshot, trackId);
  } catch (err) {
    return json(res, 400, { error: err.message });
  }

  try {
    const result = await synthesize({ text, voice });
    return json(res, 200, {
      source: 'live',
      // Wrapped by the same shared path that wrote the cached clips, so a live
      // clip and a stored one are byte-comparable rather than merely similar.
      audioBase64: result.bytes.toString('base64'),
      contentType: 'audio/wav',
      upstreamContentType: result.contentType,
      container: result.container,
      bytes: result.bytes.length,
      upstreamBytes: result.upstream.length,
      durationMs: result.durationMs,
      sampleRate: result.sampleRate,
      ttfbMs: result.ttfbMs,
      totalMs: result.totalMs,
      renderedAt: result.requestedAt,
      track: trackId,
      audioSha256: createHash('sha256').update(result.upstream).digest('hex'),
      // Echoed so the page can prove the audio it is playing came from the
      // string it is showing, with the options it claims were used.
      sent: {
        text: result.sent.text,
        modelId: result.sent.modelId,
        speaker: result.sent.speaker,
        lang: result.sent.lang,
        samplingRate: result.sent.samplingRate,
        speedAlpha: result.sent.speedAlpha,
        phonemizeBetweenBrackets: result.sent.phonemizeBetweenBrackets,
      },
    });
  } catch (err) {
    const status = err instanceof RimeError && err.status ? 502 : 500;
    return json(res, status, {
      error: err.message,
      upstreamStatus: err.status ?? null,
      upstreamBody: err.body ?? null,
    });
  }
}

async function handleVerdicts(req, res) {
  if (req.method === 'GET') {
    return json(res, 200, await readJsonFile(VERDICTS_PATH, {}));
  }
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return json(res, 400, { error: err.message });
  }
  const current = await readJsonFile(VERDICTS_PATH, {});
  const id = String(body.fixtureId ?? '');
  if (!FIXTURES.some((f) => f.id === id)) {
    return json(res, 400, { error: `unknown fixture "${id}"` });
  }
  const allowed = ['ear-better', 'no-difference', 'naive-better'];
  if (body.verdict === null) {
    delete current[id];
  } else if (allowed.includes(body.verdict)) {
    current[id] = { verdict: body.verdict, at: new Date().toISOString() };
  } else {
    return json(res, 400, { error: `verdict must be one of ${allowed.join(', ')}` });
  }
  await writeFile(VERDICTS_PATH, `${JSON.stringify(current, null, 2)}\n`);
  return json(res, 200, current);
}

async function serveStatic(url, res) {
  const clean = normalize(decodeURIComponent(url.split('?')[0])).replace(
    /^(\.\.[/\\])+/,
    ''
  );
  const rel = clean === '/' || clean === '\\' ? 'index.html' : clean.replace(/^[/\\]+/, '');
  const path = join(PUBLIC_DIR, rel);
  if (!path.startsWith(PUBLIC_DIR) || !existsSync(path)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  const body = await readFile(path);
  const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': body.length,
    // Clips are content addressed by the manifest, so no-cache keeps a
    // regenerated clip from being served from a stale browser cache.
    'Cache-Control': extname(path) === '.wav' ? 'no-cache' : 'public, max-age=60',
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const url = req.url ?? '/';
    if (url === '/api/state') return json(res, 200, await buildState());
    if (url === '/api/render' && req.method === 'POST') {
      return await handleRender(req, res);
    }
    if (url === '/api/verdicts') return await handleVerdicts(req, res);
    // The two documents the page links to live at the project root, next to the
    // code they describe, rather than being copied into public/ where they
    // could drift out of sync with the versions a reader sees on the repo.
    if (url === '/README.md' || url === '/RIME_EVIDENCE.md') {
      const doc = join(ROOT, url.slice(1));
      if (existsSync(doc)) {
        const body = await readFile(doc);
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Length': body.length,
        });
        return res.end(body);
      }
    }
    return await serveStatic(url, res);
  } catch (err) {
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, async () => {
  let voiceLine = 'no catalog snapshot, run npm run catalog';
  try {
    const s = await loadSnapshot();
    voiceLine = `${s.selection.modelId} / ${s.selection.speaker} / ${s.selection.lang}`;
  } catch {
    /* reported on the page too */
  }
  const clipsReady = existsSync(MANIFEST_PATH);
  console.log('\n  Written for the Ear');
  console.log(`  http://localhost:${PORT}\n`);
  console.log(`  provider   Rime, ${voiceLine}`);
  console.log(
    `  key        ${hasApiKey() ? 'present, live render enabled' : 'missing, live render disabled'}`
  );
  console.log(
    `  clips      ${clipsReady ? 'manifest found' : 'none yet, run npm run generate'}\n`
  );
});
