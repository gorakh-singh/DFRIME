/**
 * WAV container handling.
 *
 * WHAT RIME ACTUALLY RETURNS, MEASURED
 *
 * With `Accept: audio/wav`, the streaming endpoint responds
 * `content-type: audio/wav` and `transfer-encoding: chunked`, but the body is
 * NOT a RIFF WAVE file. It is a headerless stream of 16-bit little-endian
 * linear PCM samples at the requested sampling rate. The first bytes of a
 * response are sample data, not the ASCII "RIFF".
 *
 * That is reasonable for a streaming endpoint, since a RIFF header has to
 * declare a length the server does not know until it has finished speaking.
 * It has two consequences this project has to handle rather than paper over:
 *
 *   1. A browser cannot play those bytes. `<audio src="clip.wav">` on a
 *      headerless PCM stream is silence. The 44-byte RIFF header is added
 *      here, locally, once the full body has arrived and the length is known.
 *
 *   2. Duration cannot be read from a header that does not exist. It is
 *      computed from the sample count instead, which for uncompressed PCM at a
 *      known rate is exact rather than an estimate.
 *
 * The sample data is never altered. Only the container is added, and the
 * manifest records which path each clip took so the distinction stays visible.
 */

export const PCM = {
  channels: 1,
  bitsPerSample: 16,
};

/**
 * Parses a real RIFF WAVE header. Returns null when the bytes are not RIFF,
 * which is the normal case for Rime's streaming response, so callers use the
 * null to mean "headerless PCM" rather than "something went wrong".
 */
export function readWav(bytes) {
  if (!bytes || bytes.length < 44) return null;
  if (bytes.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (bytes.toString('ascii', 8, 12) !== 'WAVE') return null;

  let offset = 12;
  let fmt = null;
  let dataBytes = null;

  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.toString('ascii', offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const bodyAt = offset + 8;

    if (chunkId === 'fmt ' && bodyAt + 16 <= bytes.length) {
      fmt = {
        audioFormat: bytes.readUInt16LE(bodyAt),
        channels: bytes.readUInt16LE(bodyAt + 2),
        sampleRate: bytes.readUInt32LE(bodyAt + 4),
        byteRate: bytes.readUInt32LE(bodyAt + 8),
        bitsPerSample: bytes.readUInt16LE(bodyAt + 14),
      };
    } else if (chunkId === 'data') {
      const declared = chunkSize;
      const remaining = bytes.length - bodyAt;
      dataBytes = declared > 0 && declared <= remaining ? declared : remaining;
      break;
    }

    offset = bodyAt + chunkSize + (chunkSize % 2);
  }

  if (!fmt || dataBytes == null || !fmt.byteRate) return null;

  return {
    ...fmt,
    dataBytes,
    durationMs: Math.round((dataBytes / fmt.byteRate) * 1000),
  };
}

/** Builds the 44-byte canonical RIFF WAVE header for a PCM payload. */
function riffHeader(dataLength, { sampleRate, channels, bitsPerSample }) {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + dataLength, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16); // PCM fmt chunk size
  h.writeUInt16LE(1, 20); // format 1 = linear PCM
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(byteRate, 28);
  h.writeUInt16LE(blockAlign, 32);
  h.writeUInt16LE(bitsPerSample, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(dataLength, 40);
  return h;
}

/**
 * Turns whatever Rime returned into bytes a browser will play, and reports the
 * exact duration.
 *
 * `container` says which happened, and it is written into the clip manifest so
 * a reader can see that the audio samples came from Rime while the RIFF wrapper
 * did not.
 */
export function toPlayableWav(bytes, { sampleRate }) {
  const riff = readWav(bytes);
  if (riff) {
    return {
      bytes,
      container: 'riff-from-upstream',
      durationMs: riff.durationMs,
      sampleRate: riff.sampleRate,
      channels: riff.channels,
      bitsPerSample: riff.bitsPerSample,
    };
  }

  const { channels, bitsPerSample } = PCM;
  const blockAlign = (channels * bitsPerSample) / 8;
  // A truncated final frame would desynchronise the stream, so trim to a whole
  // number of frames rather than emitting a header that lies about the length.
  const usable = bytes.length - (bytes.length % blockAlign);
  const payload = usable === bytes.length ? bytes : bytes.subarray(0, usable);

  return {
    bytes: Buffer.concat([
      riffHeader(payload.length, { sampleRate, channels, bitsPerSample }),
      payload,
    ]),
    container: 'riff-added-locally',
    durationMs: Math.round((payload.length / (sampleRate * blockAlign)) * 1000),
    sampleRate,
    channels,
    bitsPerSample,
    trimmedBytes: bytes.length - usable,
  };
}

/** Human-readable seconds, e.g. "2.41s". Returns null for unmeasured audio. */
export function formatDuration(durationMs) {
  if (durationMs == null) return null;
  return `${(durationMs / 1000).toFixed(2)}s`;
}
