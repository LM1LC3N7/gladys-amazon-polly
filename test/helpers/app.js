// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, a scripted Polly (no network) and
// the virtual clock: nothing fires by itself, `clock.advance(ms)` moves the
// time and runs the timers due on the way.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { PollyApp } from '../../src/app.js';
import { PollyError } from '../../src/polly.js';
import { createMemoryStore } from '../../src/store.js';
import { settle, testClock } from './clock.js';

export const SELECTOR = 'amazon-polly';
// The AWS documentation's example keys: never real ones.
export const KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
export const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
export const KEY_ID_2 = 'AKIAI44QH8DHBEXAMPLE';
export const SECRET_2 = 'je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY';
export const CONFIG = { access_key_id: KEY_ID, secret_access_key: SECRET };
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
// 2026-11-11 10:00 UTC.
export const START = Date.UTC(2026, 10, 11, 10, 0, 0);

export const MP3 = Buffer.from('ID3fake-mp3-bytes');

export function memoryLogger() {
  const lines = [];
  const log = (level) => (msg) => lines.push(`${level} ${msg}`);
  return { lines, info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') };
}

/**
 * A scripted Polly factory: `answer(call)` -> `{ audio, characters }` or a
 * promise of it, or throws (a PollyError). `calls` records every request.
 */
export function fakePolly(answer = () => ({ audio: MP3, characters: null })) {
  const polly = { answer, calls: [], clients: [], destroyed: 0 };
  polly.create = (options) => {
    const client = {
      options,
      synthesize: async (request) => {
        const call = { ...request, options };
        polly.calls.push(call);
        return polly.answer(call);
      },
      destroy: () => {
        polly.destroyed += 1;
      },
    };
    polly.clients.push(client);
    return client;
  };
  return polly;
}

/** A promise that never settles unless the signal aborts it. */
export function hangUntilAbort(call) {
  return new Promise((_, reject) => {
    call.signal.addEventListener('abort', () =>
      reject(new PollyError('timeout', { code: 'timeout' })),
    );
  });
}

export async function makeApp({
  config = CONFIG,
  store = createMemoryStore(),
  polly = fakePolly(),
  clock = testClock({ start: START }),
  gladys = createFakeGladys({ selector: SELECTOR, config }),
  connect = true,
} = {}) {
  const logger = memoryLogger();
  const app = new PollyApp({
    gladys,
    store,
    createPolly: polly.create,
    logger,
    now: clock.monotonic,
    wallNow: clock.now,
    timers: clock.timers,
    userAgent: 'gladys-amazon-polly/test',
  });
  if (connect) {
    await app.start();
    await settle();
  }
  return { app, gladys, store, polly, clock, logger };
}

/** The last connection status: [connected, english message]. */
export function lastStatus(gladys) {
  const s = gladys.fake.connectionStatus;
  return s ? [s.connected, s.message?.en ?? ''] : undefined;
}

export { settle };
