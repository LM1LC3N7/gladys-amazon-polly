// -----------------------------------------------------------------------------
// The app on a REAL moving clock (sped up 20 times): an unreadable /data read
// again every 10 s (never early, a little late under load at most), a
// synthesis aborted at 25 s, nothing left running after stop.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { PollyApp } from '../src/app.js';
import { createMemoryStore } from '../src/store.js';
import { realClock, waitFor } from './helpers/clock.js';
import { CONFIG, SELECTOR, fakePolly, hangUntilAbort, memoryLogger } from './helpers/app.js';

const SPEED = 20;

test('real clock: /data read again every 10 s; a request aborted at 25 s; nothing after stop', async (t) => {
  const clock = realClock({ speed: SPEED });
  const store = createMemoryStore();
  store.unreadable = true;
  const reads = [];
  const load = store.load;
  store.load = () => {
    reads.push(clock.monotonic());
    return load();
  };
  const polly = fakePolly(hangUntilAbort);
  const gladys = createFakeGladys({ selector: SELECTOR, config: CONFIG });
  const app = new PollyApp({
    gladys,
    store,
    createPolly: polly.create,
    logger: memoryLogger(),
    now: clock.monotonic,
    wallNow: clock.now,
    timers: clock.timers,
  });
  t.after(async () => {
    await Promise.race([app.stop(), new Promise((resolve) => setTimeout(resolve, 500))]);
    clock.close();
  });
  await app.start();
  const started = clock.monotonic();
  let answeredAt;
  const ack = gladys.fake.ttsSynthesize('Hello', 'en').then((r) => {
    answeredAt = clock.monotonic();
    return r;
  });
  await waitFor(() => reads.length >= 4, '4 reads of /data', 10_000);
  const gaps = reads.slice(1).map((at, i) => at - reads[i]);
  for (const gap of gaps) assert.ok(gap >= 9_900 && gap <= 15_000, `gap ${gap}`);
  // The hanging request: aborted at 25 s (never early), well before the 30 s of Gladys.
  const result = await ack;
  const took = answeredAt - started;
  assert.equal(result.success, false);
  assert.ok(took >= 24_900 && took <= 29_000, `took ${took}`);
  assert.equal(polly.calls[0].signal.aborted, true);

  await app.stop();
  const count = reads.length;
  await new Promise((resolve) => setTimeout(resolve, 1500)); // 30 s simulated
  assert.equal(reads.length, count, 'no read after stop');
  assert.equal(clock.live, 0, 'no timer left');
});
