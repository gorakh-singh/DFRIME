/**
 * Written for the Ear.
 *
 * Rules this file holds to, because the whole submission rests on them:
 *
 *   1. A clip is never played without its provenance visible. Every player
 *      carries CACHED, LIVE, NOT RENDERED, RENDER FAILED or STALE, and the
 *      label is drawn from the server's own view of the file, not from a flag
 *      the UI sets for itself.
 *
 *   2. Waveforms are decoded from the real audio bytes and the playhead is
 *      driven by the audio element's real currentTime. There is no idle
 *      animation anywhere in this file. If nothing is playing, nothing moves.
 *
 *   3. Nothing is scored automatically. The verdict comes from a person
 *      listening, and a verdict against the claim is recorded and displayed
 *      exactly like one for it.
 */

const $ = (sel, root = document) => root.querySelector(sel);

const icon = (name, cls = 'icon') =>
  `<svg class="${cls}" aria-hidden="true"><use href="/icons/sprite.svg#i-${name}" /></svg>`;

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const fmtDur = (ms) => (ms == null ? null : `${(ms / 1000).toFixed(2)}s`);

const fmtWhen = (iso) => {
  if (!iso) return 'unknown time';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown time';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const VERDICTS = {
  'ear-better': { label: 'Ear variant is clearer', icon: 'check-circle' },
  'no-difference': { label: 'No audible difference', icon: 'equals' },
  'naive-better': { label: 'Rewrite made it worse', icon: 'x-circle' },
};

const state = {
  data: null,
  selected: null,
  /** Live renders keyed by "fixtureId.variant", overriding the cached clip. */
  liveClips: new Map(),
};

/* ------------------------------------------------------------------ diff */

/**
 * Word level diff, so the panel can show WHY two clips differ without making
 * the reader play spot the difference. Longest common subsequence over
 * whitespace separated tokens, which is enough for strings this short.
 */
function diffTokens(a, b) {
  const A = a.split(/(\s+)/);
  const B = b.split(/(\s+)/);
  const n = A.length;
  const m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const left = [];
  const right = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      left.push({ t: A[i], same: true });
      right.push({ t: B[j], same: true });
      i += 1;
      j += 1;
    } else if (L[i + 1][j] >= L[i][j + 1]) {
      left.push({ t: A[i], same: false });
      i += 1;
    } else {
      right.push({ t: B[j], same: false });
      j += 1;
    }
  }
  while (i < n) {
    left.push({ t: A[i], same: false });
    i += 1;
  }
  while (j < m) {
    right.push({ t: B[j], same: false });
    j += 1;
  }
  const render = (parts) =>
    parts
      .map((p) =>
        p.same || /^\s+$/.test(p.t) ? esc(p.t) : `<mark>${esc(p.t)}</mark>`
      )
      .join('');
  return { naiveHtml: render(left), earHtml: render(right) };
}

/* -------------------------------------------------------------- waveform */

const peakCache = new Map();
let audioCtx = null;

/** Decodes real audio and reduces it to per-bucket peaks. Never synthesised. */
async function peaksFor(key, url, buckets = 220) {
  const cacheKey = `${key}:${buckets}`;
  if (peakCache.has(cacheKey)) return peakCache.get(cacheKey);
  const promise = (async () => {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`clip fetch failed: HTTP ${res.status}`);
    const buf = await audioCtx.decodeAudioData(await res.arrayBuffer());
    const data = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / buckets));
    const out = new Float32Array(buckets);
    let max = 0;
    for (let b = 0; b < buckets; b += 1) {
      let peak = 0;
      const start = b * step;
      const end = Math.min(data.length, start + step);
      for (let k = start; k < end; k += 1) {
        const v = Math.abs(data[k]);
        if (v > peak) peak = v;
      }
      out[b] = peak;
      if (peak > max) max = peak;
    }
    if (max > 0) for (let b = 0; b < buckets; b += 1) out[b] /= max;
    return out;
  })();
  peakCache.set(cacheKey, promise);
  return promise;
}

function drawWave(canvas, peaks, progress) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const css = getComputedStyle(document.documentElement);
  const idle = css.getPropertyValue('--wave').trim();
  const played = css.getPropertyValue('--wave-played').trim();

  const n = peaks.length;
  const gap = 1;
  const barW = Math.max(1, w / n - gap);
  const mid = h / 2;
  for (let b = 0; b < n; b += 1) {
    const x = (b / n) * w;
    // A visible floor, so silence still reads as a bar and the grouping
    // pauses in a spelled-out code are legible as gaps rather than as nothing.
    const amp = Math.max(1.5, peaks[b] * (h / 2 - 2));
    ctx.fillStyle = x / w <= progress ? played : idle;
    ctx.fillRect(x, mid - amp, barW, amp * 2);
  }
}

/* --------------------------------------------------------------- players */

/**
 * Every mounted player, tagged with the region it belongs to. Two clips playing
 * at once would just be mush, and a clip left running under a panel that no
 * longer shows it is worse than that.
 */
const allAudio = new Map();

function stopOthers(except) {
  for (const a of allAudio.keys()) {
    if (a !== except && !a.paused) a.pause();
  }
}

/** Tears down the players in one region before that region is rebuilt. */
function stopRegion(region) {
  for (const [a, r] of allAudio) {
    if (r !== region) continue;
    a.pause();
    allAudio.delete(a);
  }
}

/**
 * Wires one player. `clip` is whatever the server said about this clip, or a
 * live result. The provenance label comes from clip.kind and is not optional.
 */
function mountPlayer(host, clip, key, region = 'panel') {
  if (clip.state !== 'ready') {
    host.innerHTML = renderEmptyClip(clip);
    return;
  }

  const isLive = clip.kind === 'live';
  const meta = [];
  meta.push(
    `<span class="prov" data-kind="${isLive ? 'live' : 'cached'}">` +
      `${icon(isLive ? 'broadcast' : 'hard-drives')}${isLive ? 'Live' : 'Cached'}</span>`
  );
  meta.push(
    isLive
      ? `rendered just now, ${clip.totalMs} ms round trip`
      : `rendered ${fmtWhen(clip.renderedAt)}`
  );
  if (clip.durationMs != null) meta.push(`${fmtDur(clip.durationMs)} audio`);
  if (clip.audioSha256) meta.push(`sha ${clip.audioSha256.slice(0, 12)}`);

  host.innerHTML = `
    <div class="player">
      <div class="player-bar">
        <button class="play-btn" type="button" data-playing="false"
                aria-label="Play clip">${icon('play')}</button>
        <canvas class="wave"></canvas>
      </div>
      <div class="clip-meta">${meta
        .map((m, i) => (i === 0 ? m : `<span>${esc(m)}</span>`))
        .join('')}</div>
    </div>`;

  const btn = $('.play-btn', host);
  const canvas = $('.wave', host);
  const audio = new Audio(clip.src);
  audio.preload = 'metadata';
  allAudio.set(audio, region);

  let peaks = null;
  let raf = 0;

  const paint = () => drawWave(canvas, peaks ?? new Float32Array(1), progress());
  const progress = () =>
    audio.duration ? Math.min(1, audio.currentTime / audio.duration) : 0;

  peaksFor(key, clip.src)
    .then((p) => {
      peaks = p;
      paint();
    })
    .catch(() => {
      // A waveform we could not decode is left blank rather than faked.
      canvas.style.opacity = '0.3';
    });

  // Repaint only while audio is actually moving. Nothing loops at idle.
  const tick = () => {
    paint();
    if (!audio.paused && !audio.ended) raf = requestAnimationFrame(tick);
  };

  btn.addEventListener('click', () => {
    if (audio.paused) {
      stopOthers(audio);
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  });

  audio.addEventListener('play', () => {
    btn.dataset.playing = 'true';
    btn.innerHTML = icon('pause');
    btn.setAttribute('aria-label', 'Pause clip');
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  });
  const settle = () => {
    btn.dataset.playing = 'false';
    btn.innerHTML = icon('play');
    btn.setAttribute('aria-label', 'Play clip');
    cancelAnimationFrame(raf);
    paint();
  };
  audio.addEventListener('pause', settle);
  audio.addEventListener('ended', () => {
    audio.currentTime = 0;
    settle();
  });
  audio.addEventListener('loadedmetadata', paint);

  canvas.addEventListener('click', (ev) => {
    if (!audio.duration) return;
    const r = canvas.getBoundingClientRect();
    audio.currentTime = ((ev.clientX - r.left) / r.width) * audio.duration;
    paint();
  });

  new ResizeObserver(paint).observe(canvas);
}

function renderEmptyClip(clip) {
  if (clip.state === 'failed') {
    return `<div class="clip-empty">
      <span class="prov" data-kind="none">${icon('x-circle')}Render failed</span>
      <p style="margin-top:8px">Rime did not return audio for this string on
      ${esc(fmtWhen(clip.attemptedAt))}. No substitute clip is shown.</p>
      <p style="margin-top:6px"><code>${esc(clip.error ?? 'no detail recorded')}</code></p>
    </div>`;
  }
  if (clip.state === 'stale') {
    return `<div class="clip-empty">
      <span class="prov" data-kind="none">${icon('warning-diamond')}Stale</span>
      <p style="margin-top:8px">The fixture text changed after this clip was
      rendered, so the stored audio no longer matches the string above. It is
      withheld rather than played. Run <code>npm run generate</code>.</p>
    </div>`;
  }
  return `<div class="clip-empty">
    <span class="prov" data-kind="none">${icon('hard-drives')}Not rendered</span>
    <p style="margin-top:8px">No stored clip for this string yet. Run
    <code>npm run generate</code> with a Rime key, or press Send live below to
    hear it now.</p>
  </div>`;
}

/* ----------------------------------------------------------------- panel */

function clipFor(fixtureId, variant) {
  const key = `${fixtureId}.${variant}`;
  return state.liveClips.get(key) ?? state.data.clips[key] ?? { state: 'absent' };
}

function renderPanel() {
  stopRegion('panel');
  const f = state.data.fixtures.find((x) => x.id === state.selected);
  const host = $('#panel-host');
  if (!f) {
    host.innerHTML = '<p class="loading-note">No fixture selected.</p>';
    return;
  }

  const { naiveHtml, earHtml } = diffTokens(f.naive, f.ear);
  const techs = state.data.techniques;
  const live = state.data.provider.liveAvailable;
  const track = state.data.tracks?.[f.track] ?? {};

  const variantBlock = (variant, name, sub, html, chips) => `
    <div class="variant">
      <div class="variant-head">
        <span class="variant-name">${esc(name)}</span>
        <span class="variant-sub">${esc(sub)}</span>
      </div>
      <div class="sent-string">${html}</div>
      <div class="techniques">${chips}</div>
      <div data-clip-host="${variant}"></div>
      <div class="field-foot" style="margin-top:2px">
        <button class="btn btn-sm" data-send-live="${variant}" ${live ? '' : 'disabled'}>
          ${icon('broadcast')} Send live
        </button>
        <button class="btn btn-sm" data-edit="${variant}">
          ${icon('arrow-square-out')} Edit and send
        </button>
      </div>
    </div>`;

  const chipsFor = (list) =>
    list
      .map(
        (t) =>
          `<span class="tech-chip" title="${esc(techs[t] ?? t)}">${esc(t)}</span>`
      )
      .join('');

  host.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div class="panel-kicker">
          <span>${esc(state.data.categories[f.category] ?? f.category)}</span>
          <span>/</span>
          <span>${esc(f.id)}</span>
          <span class="voice-tag" title="Both variants below are rendered with this exact voice">
            ${icon('speaker-high')}
            ${esc(track.modelId)} / ${esc(track.speaker)} / ${esc(track.lang)}
          </span>
        </div>
        <h3>${esc(f.label)}</h3>
        <p class="panel-note">${esc(f.note)}</p>
      </div>

      ${
        f.stress
          ? `<div class="stress-banner">
               ${icon('warning-diamond')}
               <div>
                 <div class="stress-banner-title">Deliberate stress case</div>
                 <p>${esc(f.stressWhy)}</p>
               </div>
             </div>`
          : ''
      }

      <div class="compare">
        ${variantBlock(
          'naive',
          'Naive',
          'raw from the backend',
          naiveHtml,
          '<span class="tech-chip">no rewrite</span>'
        )}
        ${variantBlock(
          'ear',
          'Written for the ear',
          'same information',
          earHtml,
          chipsFor(f.technique)
        )}
      </div>

      ${
        f.translation
          ? `<div class="target-row">
               ${icon('waveform')}
               <div>
                 <div class="target-label">What it says, in English</div>
                 <div class="target-value" style="font-size:14px">${esc(
                   f.translation
                 )}</div>
               </div>
             </div>`
          : ''
      }

      <div class="target-row">
        ${icon('ear')}
        <div>
          <div class="target-label">Target pronunciation</div>
          <div class="target-value">${esc(f.target)}</div>
        </div>
      </div>

      <div class="verdict-row">
        <p class="verdict-q">
          Played both against the target. Which one actually got closer?
        </p>
        <div class="verdict-btns">
          ${Object.entries(VERDICTS)
            .map(
              ([k, v]) =>
                `<button class="btn btn-sm verdict-btn" data-verdict="${k}"
                   aria-pressed="${state.data.verdicts[f.id]?.verdict === k}">
                   ${icon(v.icon)} ${esc(v.label)}
                 </button>`
            )
            .join('')}
        </div>
      </div>
    </div>`;

  for (const variant of ['naive', 'ear']) {
    mountPlayer(
      $(`[data-clip-host="${variant}"]`, host),
      clipFor(f.id, variant),
      `${f.id}.${variant}`
    );
  }

  host.querySelectorAll('[data-verdict]').forEach((btn) => {
    btn.addEventListener('click', () => setVerdict(f.id, btn.dataset.verdict));
  });
  host.querySelectorAll('[data-send-live]').forEach((btn) => {
    btn.addEventListener('click', () => sendLive(f, btn.dataset.sendLive, btn));
  });
  host.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('#live-text').value = f[btn.dataset.edit];
      updateCounter();
      $('#live').scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('#live-text').focus();
    });
  });
}

/** Renders one fixture variant live and swaps its player over to a LIVE clip. */
async function sendLive(fixture, variant, btn) {
  const host = $(`#panel-host [data-clip-host="${variant}"]`);
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `${icon('circle-notch', 'icon spinning')} Calling Rime`;
  try {
    const res = await fetch('api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: fixture[variant], track: fixture.track }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    const clip = {
      state: 'ready',
      kind: 'live',
      src: `data:${body.contentType};base64,${body.audioBase64}`,
      durationMs: body.durationMs,
      totalMs: body.totalMs,
      audioSha256: body.audioSha256,
      renderedAt: body.renderedAt,
    };
    const key = `${fixture.id}.${variant}`;
    state.liveClips.set(key, clip);
    peakCache.delete(`${key}:220`);
    mountPlayer(host, clip, `${key}:${body.audioSha256.slice(0, 8)}`);
  } catch (err) {
    host.innerHTML = `<div class="inline-error">
      <strong>Live render failed</strong>
      <code>${esc(err.message)}</code>
    </div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

/* --------------------------------------------------------------- verdicts */

const VERDICT_KEY = 'wfte.verdicts';

/**
 * Verdicts go to the server when there is one, so they land in verdicts.json
 * and can be read back outside the browser. On a static deployment there is no
 * server, so they fall back to this viewer's own browser storage. Either way
 * they are a record of what a person heard, never a computed score.
 */
async function setVerdict(fixtureId, verdict) {
  const current = state.data.verdicts[fixtureId]?.verdict;
  const next = current === verdict ? null : verdict;

  if (!state.data.staticBuild) {
    const res = await fetch('api/verdicts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixtureId, verdict: next }),
    });
    if (!res.ok) return;
    state.data.verdicts = await res.json();
  } else {
    const v = { ...state.data.verdicts };
    if (next === null) delete v[fixtureId];
    else v[fixtureId] = { verdict: next, at: new Date().toISOString() };
    state.data.verdicts = v;
    try {
      localStorage.setItem(VERDICT_KEY, JSON.stringify(v));
    } catch {
      /* private window or blocked storage; the verdict still shows this session */
    }
  }
  renderPanel();
  renderResults();
}

function renderResults() {
  const { fixtures, verdicts, clips } = state.data;
  const counts = { 'ear-better': 0, 'no-difference': 0, 'naive-better': 0 };
  for (const f of fixtures) {
    const v = verdicts[f.id]?.verdict;
    if (v && v in counts) counts[v] += 1;
  }
  const judged = Object.values(counts).reduce((a, b) => a + b, 0);

  $('#tally').innerHTML = [
    ...Object.entries(VERDICTS).map(
      ([k, v]) => `
      <div>
        <div class="tally-n">${counts[k]}</div>
        <div class="tally-k">${icon(v.icon)} ${esc(v.label)}</div>
      </div>`
    ),
    `<div>
       <div class="tally-n">${judged} <span style="color:var(--ink-3)">/ ${fixtures.length}</span></div>
       <div class="tally-k">${icon('ear')} Fixtures listened to</div>
     </div>`,
  ].join('');

  // Duration deltas are only reportable against the measured run-to-run spread,
  // and that spread is PER TRACK. Arcana varies several times more than Mist
  // v2, so one global floor would wrongly promote Hindi noise into findings.
  const floorFor = (trackId) =>
    state.data.controls?.[trackId]?.noiseFloor?.spreadMs ?? null;

  $('#log').innerHTML = fixtures
    .map((f) => {
      const v = verdicts[f.id]?.verdict;
      const meta = VERDICTS[v];
      const n = clips[`${f.id}.naive`];
      const e = clips[`${f.id}.ear`];
      const floor = floorFor(f.track);
      let dur = 'not rendered';
      if (n?.durationMs != null && e?.durationMs != null) {
        const d = e.durationMs - n.durationMs;
        const sign = d > 0 ? '+' : '';
        const inNoise = floor != null && Math.abs(d) <= floor;
        dur =
          `${fmtDur(n.durationMs)} to ${fmtDur(e.durationMs)}, ` +
          `${sign}${(d / 1000).toFixed(2)}s` +
          (floor == null ? '' : inNoise ? ', inside noise' : '');
      }
      return `<div class="log-row">
        <span class="id">${
          f.stress ? icon('warning-diamond') : ''
        }${esc(f.id)} <span class="log-track">${esc(f.track)}</span></span>
        <span class="dur">${esc(dur)}</span>
        <span class="vd" data-set="${Boolean(meta)}">${
          meta ? `${icon(meta.icon)} ${esc(meta.label)}` : 'not yet judged'
        }</span>
      </div>`;
    })
    .join('');

  // Stated on the page, not only in the evidence file, because the durations
  // above are meaningless without it.
  const controls = state.data.controls;
  const nfEl = $('#noise-floor');
  if (nfEl) {
    if (!controls) {
      nfEl.innerHTML =
        'Noise floor not measured. Run <code class="mono">npm run generate</code>.';
    } else {
      const per = Object.entries(controls)
        .filter(([, c]) => c.noiseFloor)
        .map(
          ([id, c]) =>
            `<strong>${esc(id)}</strong> ${c.noiseFloor.spreadMs} ms over ` +
            `${c.noiseFloor.repeats} renders`
        )
        .join(', ');
      nfEl.innerHTML =
        'Rime is not deterministic. Rendering one unchanged string repeatedly ' +
        'returns different audio every time, and the spread differs by model: ' +
        `${per}. Any duration change smaller than its own track's spread is ` +
        'run-to-run variation rather than an effect of the rewrite, and is ' +
        'marked "inside noise" above.';
    }
  }

  const note = $('#result-note');
  if (judged === 0) {
    note.textContent =
      'Nothing has been judged yet. Play a pair, compare each clip against its ' +
      'target, and record what you actually heard. The log is empty until then, ' +
      'and an empty log is the honest state.';
  } else if (counts['naive-better'] > 0 || counts['no-difference'] > 0) {
    note.textContent =
      `Of ${judged} fixtures judged, ${counts['ear-better']} favoured the ` +
      `rewrite, ${counts['no-difference']} showed no audible difference, and ` +
      `${counts['naive-better']} came out worse after rewriting. The claim holds ` +
      'for the first group and fails for the rest. Both are recorded here.';
  } else {
    note.textContent =
      `All ${judged} judged fixtures favoured the rewrite. That supports the ` +
      'claim on this fixture set and this voice. It is not a general result, ' +
      'and a fixture that goes the other way will show up here unchanged.';
  }
}

/* ------------------------------------------------------------ live section */

function updateCounter() {
  const n = $('#live-text').value.length;
  const el = $('#live-counter');
  el.textContent = `${n} / 1000`;
  el.dataset.over = String(n > 1000);
}

async function renderLive() {
  const btn = $('#live-render');
  const out = $('#live-out');
  const text = $('#live-text').value;
  if (!text.trim()) {
    out.innerHTML =
      '<div class="inline-error"><strong>Nothing to send</strong>' +
      '<span>Type a string, or load one from a fixture.</span></div>';
    return;
  }
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `${icon('circle-notch', 'icon spinning')} Calling Rime`;
  stopRegion('live');
  out.innerHTML = '';
  try {
    const res = await fetch('api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, track: $('#live-track').value }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    out.innerHTML = `
      <div style="margin-top:18px">
        <div data-live-host></div>
        <div class="clip-meta" style="padding-left:0">
          <span>${esc(body.sent.modelId)} / ${esc(body.sent.speaker)} / ${esc(
            body.sent.lang
          )}</span>
          <span>${body.sampleRate ?? '?'} Hz</span>
          <span>${body.ttfbMs} ms to first byte</span>
          <span>${(body.bytes / 1024).toFixed(0)} KB</span>
        </div>
      </div>`;
    mountPlayer(
      $('[data-live-host]', out),
      {
        state: 'ready',
        kind: 'live',
        src: `data:${body.contentType};base64,${body.audioBase64}`,
        durationMs: body.durationMs,
        totalMs: body.totalMs,
        audioSha256: body.audioSha256,
        renderedAt: body.renderedAt,
      },
      `live:${body.audioSha256.slice(0, 12)}`,
      'live'
    );
  } catch (err) {
    out.innerHTML = `<div class="inline-error" style="margin-top:18px">
      <strong>Live render failed</strong>
      <code>${esc(err.message)}</code>
    </div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

/* -------------------------------------------------------------- chrome */

function renderChrome() {
  const d = state.data;
  const tracks = d.tracks ?? {};
  const active = d.fixtures.find((f) => f.id === state.selected);
  const activeTrack = tracks[active?.track] ?? Object.values(tracks)[0] ?? null;

  // The provider readout follows the selected fixture, because "Provider: Rime"
  // alone would hide that three different voices are speaking on this page.
  $('#provider-name').textContent = `Provider: ${d.provider.name}`;
  $('#provider-voice').textContent = activeTrack
    ? `${activeTrack.modelId} / ${activeTrack.speaker} / ${activeTrack.lang}`
    : 'no voice pinned';

  const rows = [];
  if (d.snapshotError) {
    rows.push(['error', d.snapshotError]);
  } else {
    rows.push(['provider', `${d.provider.name}, no fallback configured`]);
    for (const [id, t] of Object.entries(tracks)) {
      const n = d.fixtures.filter((f) => f.track === id).length;
      rows.push([id, `${t.modelId} / ${t.speaker} / ${t.lang}, ${n} fixtures`]);
    }
    rows.push(['audio', `${d.audio.accept} @ ${d.audio.samplingRate} Hz`]);
    rows.push(['catalog', `checked ${fmtWhen(d.catalog.fetchedAt)}`]);
    rows.push([
      'clips',
      d.manifest ? `generated ${fmtWhen(d.manifest.generatedAt)}` : 'none rendered yet',
    ]);
    rows.push([
      'live calls',
      d.provider.liveAvailable ? 'enabled, key present' : 'disabled, no API key',
    ]);
  }
  $('#runcard-body').innerHTML = rows
    .map(([k, val]) => `<dt>${esc(k)}</dt><dd>${esc(val)}</dd>`)
    .join('');

  // The held-constant grid describes the SELECTED fixture's track, since that
  // is the pair a reader is about to listen to.
  if (!d.snapshotError && activeTrack) {
    const c = state.data.controls?.[active?.track] ?? null;
    $('#constants').innerHTML = [
      ['track', activeTrack.label ?? active?.track],
      ['model id', activeTrack.modelId],
      ['speaker', activeTrack.speaker],
      ['language', activeTrack.lang],
      ['sampling rate', `${d.audio.samplingRate} Hz`],
      ['speed alpha', String(activeTrack.renderOptions?.speedAlpha ?? 1)],
      [
        'phonemize brackets',
        String(activeTrack.renderOptions?.phonemizeBetweenBrackets ?? false) +
          (c?.phonemeControl
            ? c.phonemeControl.engaging
              ? ', measured working'
              : ', measured inert'
            : ''),
      ],
      [
        'spell() directive',
        c?.spellControl
          ? c.spellControl.honoured
            ? 'honoured, measured'
            : 'read literally, measured'
          : 'unmeasured',
      ],
    ]
      .map(
        ([k, val]) =>
          `<div class="constant"><div class="constant-k">${esc(k)}</div>` +
          `<div class="constant-v">${esc(val)}</div></div>`
      )
      .join('');
  }

  $('#foot-provider').textContent = `Provider: ${d.provider.name}`;
  $('#foot-voice').innerHTML = Object.entries(tracks)
    .map(([id, t]) => `${esc(id)}: ${esc(t.modelId)}/${esc(t.speaker)}/${esc(t.lang)}`)
    .join('<br>');
  $('#foot-audio').textContent = `${d.audio.accept} @ ${d.audio.samplingRate} Hz`;
  $('#foot-fallback').textContent = d.provider.fallbackConfigured
    ? 'Fallback provider configured'
    : 'No fallback provider configured';

  // The rail groups by track, not by category, because the voice is the thing
  // a listener has to keep straight when comparing across groups.
  $('#rail').innerHTML = Object.entries(tracks)
    .map(([id, t]) => {
      const items = d.fixtures.filter((f) => f.track === id);
      if (!items.length) return '';
      return (
        `<div class="rail-group-label">
           <span>${esc(t.label ?? id)}</span>
           <span class="rail-voice">${esc(t.speaker)} / ${esc(t.lang)}</span>
         </div>` +
        items
          .map(
            (f) =>
              `<button class="rail-item" data-fixture="${esc(f.id)}"
                 aria-current="${f.id === state.selected}">
                 <span>${esc(f.label)}</span>
                 ${
                   f.stress
                     ? `<span class="stress-mark">${icon('warning-diamond')}</span>`
                     : ''
                 }
               </button>`
          )
          .join('')
      );
    })
    .join('');
  $('#rail')
    .querySelectorAll('[data-fixture]')
    .forEach((btn) =>
      btn.addEventListener('click', () => {
        state.selected = btn.dataset.fixture;
        history.replaceState(null, '', `#f=${btn.dataset.fixture}`);
        renderChrome();
        renderPanel();
      })
    );

  // Live section: a track picker, because the string you type has to be sent
  // to some specific voice and the page should never pick one behind your back.
  const trackSel = $('#live-track');
  if (trackSel && !trackSel.dataset.filled) {
    trackSel.innerHTML = Object.entries(tracks)
      .map(
        ([id, t]) =>
          `<option value="${esc(id)}">${esc(t.label ?? id)}: ${esc(t.modelId)} / ` +
          `${esc(t.speaker)} / ${esc(t.lang)}</option>`
      )
      .join('');
    trackSel.dataset.filled = 'true';
  }

  $('#live-presets').innerHTML = d.fixtures
    .filter((f) => f.stress)
    .flatMap((f) =>
      ['naive', 'ear'].map(
        (variant) =>
          `<button class="btn btn-sm" data-preset="${esc(f.id)}:${variant}">
             ${esc(f.track)} ${variant}
           </button>`
      )
    )
    .join('');
  $('#live-presets')
    .querySelectorAll('[data-preset]')
    .forEach((btn) =>
      btn.addEventListener('click', () => {
        const [id, variant] = btn.dataset.preset.split(':');
        const f = d.fixtures.find((x) => x.id === id);
        $('#live-text').value = f[variant];
        if (trackSel) trackSel.value = f.track;
        updateCounter();
        $('#live-text').focus();
      })
    );

  if (!d.provider.liveAvailable) {
    $('#live-render').disabled = true;
    $('#live-out').innerHTML = `<div class="inline-error" style="margin-top:18px">
      <strong>Live render is off</strong>
      <span>${esc(
        d.provider.liveDisabledReason ??
          d.snapshotError ??
          'No RIME_API_KEY in the server environment. Copy .env.example to .env, ' +
            'add a key, and restart. Nothing on this page is simulated in the ' +
            'meantime; the control is simply disabled.'
      )}</span>
    </div>`;
  }
}


/* ------------------------------------------------------------------ boot */

async function boot() {
  // Two ways this page can be served. With the Node server, /api/state is live
  // and live rendering works. On a static host there is no server, so the build
  // freezes the same shape into state.json and marks live calls unavailable
  // with a reason the page prints. Nothing is faked in either case.
  let data = null;
  try {
    const res = await fetch('api/state');
    if (res.ok) data = await res.json();
  } catch {
    /* falls through to the static copy */
  }
  if (!data) {
    try {
      const res = await fetch('state.json');
      if (res.ok) data = await res.json();
    } catch {
      /* reported below */
    }
  }
  if (!data) {
    $('#panel-host').innerHTML =
      '<p class="loading-note">Cannot load run state. Start the server with ' +
      '<code class="mono">npm start</code>, or build a static copy with ' +
      '<code class="mono">npm run build:static</code>.</p>';
    return;
  }
  state.data = data;

  if (state.data.staticBuild) {
    try {
      state.data.verdicts = JSON.parse(localStorage.getItem(VERDICT_KEY)) ?? {};
    } catch {
      state.data.verdicts = {};
    }
  }

  const fromHash = location.hash.match(/#f=([\w-]+)/)?.[1];
  const firstStress = state.data.fixtures.find((f) => f.stress)?.id;
  state.selected =
    (fromHash && state.data.fixtures.some((f) => f.id === fromHash) && fromHash) ||
    state.data.fixtures[0]?.id;

  renderChrome();
  renderPanel();
  renderResults();
  updateCounter();

  $('#live-render').addEventListener('click', renderLive);
  $('#live-text').addEventListener('input', updateCounter);

  // The hero CTA goes to the stress case specifically, not just to the section.
  document.querySelector('[data-jump-stress]')?.addEventListener('click', () => {
    if (!firstStress) return;
    state.selected = firstStress;
    location.hash = `#f=${firstStress}`;
    renderChrome();
    renderPanel();
  });
}

boot();
