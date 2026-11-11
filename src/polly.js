// -----------------------------------------------------------------------------
// Amazon Polly through the official AWS SDK (@aws-sdk/client-polly,
// Apache-2.0): one SynthesizeSpeech call, MP3 out. No retry inside the SDK
// (`maxAttempts: 1`: a retried request may be billed twice and the answer has
// to fit the Gladys deadline); HTTP/1.1 handler with its own timeouts; the
// clip read no further than 5 MB. Every failure becomes a PollyError whose
// `kind` drives the app; its message never carries a key.
// -----------------------------------------------------------------------------

import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { CONNECT_TIMEOUT_MS, DEADLINE_MS, MAX_AUDIO_BYTES } from './constants.js';

export class PollyError extends Error {
  /**
   * @param {'refused'|'denied'|'clock'|'throttled'|'unavailable'|'invalid'|'timeout'|'network'|'bad_answer'|'too_large'} kind
   */
  constructor(kind, { status, code, detail, retryAfterMs, sent = true } = {}) {
    super(`Amazon Polly: ${kind}${code ? ` (${code})` : ''}`);
    this.name = 'PollyError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.retryAfterMs = retryAfterMs;
    // false only when the request certainly never reached AWS.
    this.sent = sent;
  }
}

// The key itself was refused (unknown, deleted, deactivated, wrong secret).
const REFUSED = new Set([
  'UnrecognizedClientException',
  'InvalidClientTokenId',
  'InvalidSignatureException',
  'SignatureDoesNotMatch',
  'MissingAuthenticationToken',
]);
// A valid key without the right (IAM policy, SCP): never a refusal of the key.
const DENIED = new Set(['AccessDeniedException', 'AccessDenied', 'NotAuthorized']);
const CLOCK = new Set(['RequestExpired', 'RequestTimeTooSkewed', 'RequestInTheFuture']);
const THROTTLED = new Set([
  'ThrottlingException',
  'Throttling',
  'TooManyRequestsException',
  'RequestLimitExceeded',
  'ServiceQuotaExceededException',
  'LimitExceededException',
]);

/** Access key IDs and the given secrets removed from a text from AWS. */
export function redact(text, secrets = []) {
  let out = String(text ?? '')
    // eslint-disable-next-line no-control-regex -- control characters are what it removes
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\b(?:AKIA|ASIA|AIDA|AROA)[A-Z0-9]{12,124}\b/g, '[key]');
  for (const s of secrets) if (s) out = out.split(s).join('[key]');
  return out.slice(0, 200);
}

/** Seconds of a Retry-After header (numbers only), bounded by the caller. */
function retryAfterOf(err) {
  const raw = err?.$response?.headers?.['retry-after'];
  if (typeof raw !== 'string' || !/^\d{1,6}$/.test(raw.trim())) return undefined;
  return Number(raw.trim()) * 1000;
}

/** The PollyError of an error thrown by the SDK (or by the read of the clip). */
export function classify(err, secrets = []) {
  if (err instanceof PollyError) return err;
  const status = err?.$metadata?.httpStatusCode;
  const code = typeof err?.name === 'string' ? err.name : undefined;
  const message = typeof err?.message === 'string' ? err.message : '';
  const detail = redact(message, secrets);
  if (typeof status !== 'number') {
    if (code === 'AbortError' || code === 'TimeoutError' || err?.code === 'ETIMEDOUT') {
      return new PollyError('timeout', { code: 'timeout' });
    }
    // Not sent at all when the connection itself failed.
    const sent = !['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH'].includes(err?.code);
    return new PollyError('network', { code: err?.code ?? 'network', sent });
  }
  if (CLOCK.has(code) || (code === 'InvalidSignatureException' && /expired/i.test(message))) {
    return new PollyError('clock', { status, code });
  }
  if (REFUSED.has(code)) return new PollyError('refused', { status, code });
  if (DENIED.has(code)) return new PollyError('denied', { status, code });
  if (THROTTLED.has(code) || status === 429) {
    return new PollyError('throttled', { status, code, retryAfterMs: retryAfterOf(err) });
  }
  if (status >= 500) {
    return new PollyError('unavailable', { status, code, retryAfterMs: retryAfterOf(err) });
  }
  // Any other 401/403 is NOT a refusal of the key: a missing right.
  if (status === 401 || status === 403) return new PollyError('denied', { status, code });
  // 400: the voice, the engine, the region, the text: Polly's words, cleaned.
  return new PollyError('invalid', { status, code, detail });
}

/** Reads a Node stream to a Buffer, never past `max` bytes; `signal` aborts it. */
export async function readBounded(stream, max, signal) {
  const chunks = [];
  let size = 0;
  const onAbort = () => stream.destroy?.(new PollyError('timeout', { code: 'timeout' }));
  if (signal?.aborted) onAbort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > max) {
        stream.destroy?.();
        throw new PollyError('too_large', { code: 'too_large' });
      }
      chunks.push(chunk);
    }
  } catch (err) {
    if (err instanceof PollyError) throw err;
    if (signal?.aborted) throw new PollyError('timeout', { code: 'timeout' });
    throw new PollyError('network', { code: err?.code ?? 'stream' });
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  return Buffer.concat(chunks, size);
}

/**
 * One Polly client per (region, key): `synthesize` resolves `{ audio, characters }`.
 * @param {{ region: string, accessKeyId: string, secretAccessKey: string, endpoint?: string, userAgent: string }} options
 */
export function createPolly({ region, accessKeyId, secretAccessKey, endpoint, userAgent }) {
  const client = new PollyClient({
    region,
    ...(endpoint ? { endpoint } : {}),
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 1,
    customUserAgent: userAgent,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: CONNECT_TIMEOUT_MS,
      requestTimeout: DEADLINE_MS,
    }),
  });
  const secrets = [accessKeyId, secretAccessKey];
  return {
    /** @param {{ text: string, ssml: boolean, voice: string, engine: string, signal: AbortSignal }} request */
    async synthesize({ text, ssml, voice, engine, signal }) {
      let out;
      try {
        out = await client.send(
          new SynthesizeSpeechCommand({
            Text: text,
            TextType: ssml ? 'ssml' : 'text',
            VoiceId: voice,
            Engine: engine,
            OutputFormat: 'mp3',
          }),
          { abortSignal: signal },
        );
      } catch (err) {
        throw classify(err, secrets);
      }
      const type = String(out?.ContentType ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      if (type !== 'audio/mpeg' || !out.AudioStream) {
        out?.AudioStream?.destroy?.();
        throw new PollyError('bad_answer', { code: 'content_type' });
      }
      const audio = await readBounded(out.AudioStream, MAX_AUDIO_BYTES, signal);
      if (audio.length === 0) throw new PollyError('bad_answer', { code: 'empty' });
      const characters = Number.isInteger(out.RequestCharacters) ? out.RequestCharacters : null;
      return { audio, characters };
    },
    destroy() {
      client.destroy();
    },
  };
}
