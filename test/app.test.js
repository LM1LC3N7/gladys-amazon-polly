// -----------------------------------------------------------------------------
// The provider end to end through the SDK's fake Gladys, with a scripted Polly
// and the virtual clock: voices, cache, limit, pauses, refusals, queue,
// configuration and /data failures, status, secrets.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { fp8 } from '../src/app.js';
import { PollyError } from '../src/polly.js';
import { createMemoryStore } from '../src/store.js';
import { testClock } from './helpers/clock.js';
import {
  CONFIG,
  HOUR,
  KEY_ID,
  KEY_ID_2,
  MINUTE,
  MP3,
  SECOND,
  SECRET,
  SECRET_2,
  SELECTOR,
  START,
  fakePolly,
  hangUntilAbort,
  lastStatus,
  makeApp,
  settle,
} from './helpers/app.js';

const AUDIO = `audio/mpeg;base64,${MP3.toString('base64')}`;
const refused = () => {
  throw new PollyError('refused', { status: 403, code: 'UnrecognizedClientException' });
};
const throttled = (retryAfterMs) => () => {
  throw new PollyError('throttled', { status: 400, code: 'ThrottlingException', retryAfterMs });
};

test('a text becomes an MP3 clip in the voice of the language', async () => {
  const { gladys, polly } = await makeApp({ config: { ...CONFIG, voice_en: 'Amy' } });
  const fr = await gladys.fake.ttsSynthesize('Bonjour', 'fr');
  assert.deepEqual(fr, { success: true, data: { audio: AUDIO } });
  await gladys.fake.ttsSynthesize('Hello', 'en-GB');
  await gladys.fake.ttsSynthesize('Hallo', 'DE');
  await gladys.fake.ttsSynthesize('Hola', 'es');
  await gladys.fake.ttsSynthesize('Unknown', null);
  assert.deepEqual(
    polly.calls.map((c) => [c.voice, c.engine, c.text, c.ssml]),
    [
      ['Lea', 'standard', 'Bonjour', false],
      ['Amy', 'standard', 'Hello', false],
      ['Vicki', 'standard', 'Hallo', false],
      ['Amy', 'standard', 'Hola', false],
      ['Amy', 'standard', 'Unknown', false],
    ],
  );
  // One client for the same keys and region, with the user agent of the module.
  assert.equal(polly.clients.length, 1);
  assert.deepEqual(polly.clients[0].options, {
    region: 'eu-west-1',
    accessKeyId: KEY_ID,
    secretAccessKey: SECRET,
    userAgent: 'gladys-amazon-polly/test',
  });
  assert.deepEqual(lastStatus(gladys), [
    true,
    'Amazon Polly answered (voice Lea, Amy, Vicki, standard engine).',
  ]);
});

test('the default language, the engine and the rate come from the configuration', async () => {
  const { gladys, polly } = await makeApp({
    config: { ...CONFIG, default_language: 'fr', engine: 'neural', speaking_rate: 'slow' },
  });
  await gladys.fake.ttsSynthesize('Tom & "Jerry" <b>', null);
  assert.equal(polly.calls[0].voice, 'Lea');
  assert.equal(polly.calls[0].engine, 'neural');
  assert.equal(polly.calls[0].ssml, true);
  assert.equal(
    polly.calls[0].text,
    '<speak><prosody rate="slow">Tom &amp; &quot;Jerry&quot; &lt;b&gt;</prosody></speak>',
  );
});

test('control characters become spaces, 2,000 characters at most; empty text sends nothing', async () => {
  const { gladys, polly } = await makeApp();
  await gladys.fake.ttsSynthesize(`a\u0000b\u001bc\nd${'x'.repeat(3000)}`, 'en');
  assert.equal(polly.calls[0].text.slice(0, 7), 'a b c\nd');
  assert.equal(polly.calls[0].text.length, 2000);
  const empty = await gladys.fake.ttsSynthesize(' \u0000 ', 'fr');
  assert.deepEqual(empty, { success: false, error: 'Rien à dire : le texte est vide.' });
  assert.equal(polly.calls.length, 1);
});

test('the same text in the same voice is served from memory, not billed twice', async () => {
  const { gladys, polly, app, clock } = await makeApp();
  await gladys.fake.ttsSynthesize('Door open', 'en');
  const again = await gladys.fake.ttsSynthesize('Door open', 'en');
  assert.deepEqual(again.data, { audio: AUDIO });
  assert.equal(polly.calls.length, 1);
  assert.equal(app.usage.used, 9);
  await gladys.fake.ttsSynthesize('Door open', 'fr'); // another voice
  assert.equal(polly.calls.length, 2);
  // 21 other texts: the first one is evicted (20 clips at most).
  for (let i = 0; i < 21; i += 1) await gladys.fake.ttsSynthesize(`Text ${i}`, 'en');
  await gladys.fake.ttsSynthesize('Door open', 'en');
  assert.equal(polly.calls.length, 24);
  // A day later the clip is asked again.
  await gladys.fake.ttsSynthesize('Text 20', 'en');
  assert.equal(polly.calls.length, 24);
  await clock.advance(24 * HOUR + SECOND);
  await gladys.fake.ttsSynthesize('Text 20', 'en');
  assert.equal(polly.calls.length, 25);
});

test('invalid configuration: nothing sent, the reason in the status, the value never shown', async () => {
  const cases = [
    [{ secret_access_key: SECRET }, 'The access key ID is missing'],
    [{ access_key_id: KEY_ID }, 'The secret access key is missing.'],
    [{ access_key_id: 'akia-lower\r\nX-Evil: 1', secret_access_key: SECRET }, 'not valid'],
    [{ access_key_id: KEY_ID, secret_access_key: 'bad secret\nwith-newline' }, 'not valid'],
    [{ ...CONFIG, region: 'mars-1' }, 'Unknown AWS region.'],
    [{ ...CONFIG, voice_fr: 'Joanna' }, 'Unknown voice.'],
    [{ ...CONFIG, monthly_character_limit: '12.5' }, 'whole number'],
    [{ ...CONFIG, monthly_character_limit: 999 }, 'whole number'],
    [{}, 'Enter the access key ID'],
  ];
  for (const [config, reason] of cases) {
    const { gladys, polly } = await makeApp({ config });
    const ack = await gladys.fake.ttsSynthesize('Hello', 'en');
    assert.equal(ack.success, false);
    assert.equal(polly.calls.length, 0);
    const [connected, message] = lastStatus(gladys);
    assert.equal(connected, false);
    assert.ok(message.includes(reason), message);
    for (const value of Object.values(config)) {
      if (value === SECRET || value === KEY_ID) continue;
      assert.ok(!message.includes(String(value)) && !ack.error.includes(String(value)));
    }
  }
});

test('keys refused by AWS: kept refused across a restart, a new key is tried, Test lifts it', async () => {
  const store = createMemoryStore();
  const polly = fakePolly(refused);
  const first = await makeApp({ store, polly });
  const ack = await first.gladys.fake.ttsSynthesize('Hello', 'en');
  assert.equal(ack.success, false);
  assert.match(ack.error, /AWS refused these keys/);
  await first.gladys.fake.ttsSynthesize('Hello again', 'en');
  assert.equal(polly.calls.length, 1, 'never sent again by itself');
  assert.equal(lastStatus(first.gladys)[0], false);
  // /data keeps 8 bits of a salted hash, never a key.
  const saved = JSON.stringify(store.data);
  assert.ok(!saved.includes(KEY_ID) && !saved.includes(SECRET));
  assert.match(store.data.refused.salt, /^[0-9a-f]{32}$/);
  assert.ok(Number.isInteger(store.data.refused.fp) && store.data.refused.fp <= 255);
  // Saving the same keys again changes nothing.
  await first.gladys.fake.configUpdated({ ...CONFIG });
  await first.gladys.fake.ttsSynthesize('Hello 3', 'en');
  assert.equal(polly.calls.length, 1);
  await first.app.stop();

  // Restart with the same keys: still refused, nothing sent.
  const second = await makeApp({ store, polly });
  assert.match(lastStatus(second.gladys)[1], /AWS refused these keys/);
  await second.gladys.fake.ttsSynthesize('Hello', 'en');
  assert.equal(polly.calls.length, 1);
  // The Test button sends anyway; its success lifts the refusal.
  polly.answer = () => ({ audio: MP3, characters: 48 });
  const tested = await second.gladys.fake.action('test_voice', {});
  assert.equal(tested.success, true);
  assert.match(tested.data.message.en, /voice Joanna, standard engine/);
  assert.equal(polly.calls.length, 2);
  assert.equal(store.data.refused, null);
  await second.gladys.fake.ttsSynthesize('Hello', 'en');
  assert.equal(polly.calls.length, 3);
  await second.app.stop();
});

test('new keys after a refusal are always tried', async () => {
  const polly = fakePolly(refused);
  const { gladys } = await makeApp({ polly });
  await gladys.fake.ttsSynthesize('Hello', 'en');
  polly.answer = () => ({ audio: MP3 });
  await gladys.fake.configUpdated({ access_key_id: KEY_ID_2, secret_access_key: SECRET_2 });
  const ack = await gladys.fake.ttsSynthesize('Hello', 'en');
  assert.equal(ack.success, true);
  assert.equal(polly.calls.length, 2);
  assert.equal(polly.destroyed, 1, 'the client of the old keys is closed');
  assert.equal(polly.calls[1].options.accessKeyId, KEY_ID_2);
});

test('a 403 that is not a refusal of the key (missing permission, clock) blocks nothing', async () => {
  const polly = fakePolly(() => {
    throw new PollyError('denied', { status: 403, code: 'AccessDeniedException' });
  });
  const { gladys } = await makeApp({ polly });
  const ack = await gladys.fake.ttsSynthesize('Hello', 'en');
  assert.match(ack.error, /polly:SynthesizeSpeech/);
  assert.match(lastStatus(gladys)[1], /polly:SynthesizeSpeech/);
  polly.answer = () => {
    throw new PollyError('clock', { status: 403, code: 'InvalidSignatureException' });
  };
  const skew = await gladys.fake.ttsSynthesize('Hello', 'en');
  assert.match(skew.error, /clock/);
  polly.answer = () => ({ audio: MP3 });
  assert.equal((await gladys.fake.ttsSynthesize('Hello', 'en')).success, true);
  assert.equal(polly.calls.length, 3);
  assert.equal(lastStatus(gladys)[0], true);
});

test('throttled: a pause of 60 s doubled up to 1 h on every path, Retry-After up to 6 h', async () => {
  const store = createMemoryStore();
  const polly = fakePolly(throttled());
  const { gladys, clock, app } = await makeApp({ store, polly });
  let ack = await gladys.fake.ttsSynthesize('Hello', 'en');
  assert.match(ack.error, /no request before 10:01 \(UTC\)/);
  assert.equal(lastStatus(gladys)[0], false);
  // During the pause: nothing sent, the Test button included.
  await clock.advance(59 * SECOND);
  await gladys.fake.ttsSynthesize('Hello', 'en');
  assert.equal((await gladys.fake.action('test_voice', {})).success, false);
  assert.equal(polly.calls.length, 1);
  await clock.advance(2 * SECOND);
  await gladys.fake.ttsSynthesize('Hello', 'en');
  assert.equal(polly.calls.length, 2);
  assert.equal(app.pauseStep, 2 * MINUTE);
  // Doubling stops at 1 h.
  for (let i = 0; i < 8; i += 1) {
    await clock.advance(HOUR + SECOND);
    await gladys.fake.ttsSynthesize('Hello', 'en');
  }
  assert.equal(app.pauseStep, HOUR);
  // A Retry-After longer than the step is honored, never beyond 6 h.
  polly.answer = throttled(30 * HOUR);
  await clock.advance(HOUR + SECOND);
  await gladys.fake.ttsSynthesize('Hello', 'en');
  const calls = polly.calls.length;
  await clock.advance(6 * HOUR - MINUTE);
  await gladys.fake.ttsSynthesize('Hello', 'en');
  assert.equal(polly.calls.length, calls);
  // Kept in /data (wall time and step).
  assert.ok(store.data.pause.until > clock.now());
  assert.equal(store.data.pause.step, HOUR);
  await clock.advance(2 * MINUTE);
  polly.answer = () => ({ audio: MP3 });
  ack = await gladys.fake.ttsSynthesize('Hello', 'en');
  assert.equal(ack.success, true);
  assert.equal(app.pauseStep, 0, 'a success resets the step');
  assert.equal(store.data.pause, null);
});

test('a server error pauses too; the pause survives a restart; a far future date is invalid', async () => {
  const store = createMemoryStore();
  const polly = fakePolly(() => {
    throw new PollyError('unavailable', { status: 500, code: 'ServiceFailureException' });
  });
  const clock = testClock({ start: START });
  const first = await makeApp({ store, polly, clock });
  await first.gladys.fake.ttsSynthesize('Hello', 'en');
  await first.app.stop();
  await clock.advance(30 * SECOND);
  const second = await makeApp({ store, polly, clock });
  await second.gladys.fake.ttsSynthesize('Hello', 'en');
  assert.equal(polly.calls.length, 1, 'still paused after the restart');
  await clock.advance(31 * SECOND);
  await second.gladys.fake.ttsSynthesize('Hello', 'en');
  assert.equal(polly.calls.length, 2);
  await second.app.stop();

  const far = createMemoryStore({ pause: { until: clock.now() + 7 * HOUR, step: 60_000 } });
  const third = await makeApp({ store: far, polly: fakePolly(), clock });
  assert.equal((await third.gladys.fake.ttsSynthesize('Hello', 'en')).success, true);
});

test('the monthly limit: counted before sending, refunded on an answered error, kept on a timeout', async () => {
  const store = createMemoryStore();
  const polly = fakePolly();
  const config = { ...CONFIG, monthly_character_limit: 1000 };
  const { gladys, clock, app } = await makeApp({ store, polly, config });
  let seenBefore;
  polly.answer = () => {
    seenBefore = store.data.usage?.used;
    return { audio: MP3, characters: null };
  };
  await gladys.fake.ttsSynthesize('x'.repeat(400), 'en');
  assert.equal(seenBefore, 400, 'saved before the request left');
  // Polly's billed count replaces the estimate (SSML tags are free).
  polly.answer = () => ({ audio: MP3, characters: 300 });
  await gladys.fake.ttsSynthesize('y'.repeat(350), 'en');
  assert.equal(app.usage.used, 700);
  // A 400 answer is not billed: refunded.
  polly.answer = () => {
    throw new PollyError('invalid', { status: 400, code: 'ValidationException', detail: 'bad' });
  };
  const invalid = await gladys.fake.ttsSynthesize('z'.repeat(100), 'en');
  assert.match(invalid.error, /Amazon Polly refused the request: bad/);
  assert.equal(app.usage.used, 700);
  // A timeout may have been billed: kept.
  polly.answer = hangUntilAbort;
  const pending = gladys.fake.ttsSynthesize('w'.repeat(200), 'en');
  await settle();
  assert.equal(polly.calls.length, 4);
  await clock.advance(26 * SECOND);
  assert.match((await pending).error, /did not answer in time/);
  assert.equal(app.usage.used, 900);
  // Over the limit: refused before sending.
  polly.answer = () => ({ audio: MP3 });
  const calls = polly.calls.length;
  const over = await gladys.fake.ttsSynthesize('v'.repeat(101), 'fr');
  assert.match(over.error, /limite mensuelle de 1000 caractères est atteinte \(900 envoyés/);
  assert.equal(polly.calls.length, calls);
  assert.equal((await gladys.fake.ttsSynthesize('v'.repeat(100), 'en')).success, true);
  assert.match(lastStatus(gladys)[1], /monthly limit/);
  assert.equal(store.data.usage.month, '2026-11');
  // A new month (UTC) starts from zero.
  await clock.advance(20 * 24 * HOUR);
  assert.equal((await gladys.fake.ttsSynthesize('v'.repeat(500), 'en')).success, true);
  assert.deepEqual(store.data.usage, { month: '2026-12', used: 500 });
});

test('the count survives a restart; a connection never made is refunded', async () => {
  const store = createMemoryStore({ usage: { month: '2026-11', used: 950 } });
  const polly = fakePolly(() => {
    throw new PollyError('network', { code: 'ECONNREFUSED', sent: false });
  });
  const { gladys, app } = await makeApp({
    store,
    polly,
    config: { ...CONFIG, monthly_character_limit: '1000' },
  });
  assert.equal(app.usage.used, 950);
  const ack = await gladys.fake.ttsSynthesize('x'.repeat(40), 'en');
  assert.match(ack.error, /could not be reached/);
  assert.equal(app.usage.used, 950);
  assert.equal((await gladys.fake.ttsSynthesize('x'.repeat(60), 'en')).success, false);
  assert.equal(polly.calls.length, 1);
});

test('2 requests in flight, 8 waiting, the next refused; a waiter gives up at the deadline', async () => {
  const releases = [];
  const polly = fakePolly((call) => {
    const aborted = hangUntilAbort(call);
    return Promise.race([
      aborted,
      new Promise((resolve) => releases.push(() => resolve({ audio: MP3 }))),
    ]);
  });
  const { gladys, clock } = await makeApp({ polly });
  const acks = [];
  for (let i = 0; i < 11; i += 1) acks.push(gladys.fake.ttsSynthesize(`Text ${i}`, 'en'));
  await settle();
  assert.equal(polly.calls.length, 2);
  const busy = await acks[10];
  assert.match(busy.error, /Too many announcements at once/);
  releases[0]();
  await settle();
  assert.equal(polly.calls.length, 3);
  // The others wait; at the deadline they give up, never sent.
  await clock.advance(25 * SECOND);
  const results = await Promise.all(acks.slice(0, 10));
  assert.equal(results.filter((r) => r.success).length, 1);
  assert.ok(results.slice(3).every((r) => /did not answer in time/.test(r.error)));
  assert.equal(polly.calls.length, 3);
});

test('a request that hangs is aborted at 25 s, inside the 30 s of Gladys', async () => {
  const polly = fakePolly(hangUntilAbort);
  const { gladys, clock } = await makeApp({ polly });
  const pending = gladys.fake.ttsSynthesize('Hello', 'en');
  await clock.advance(24 * SECOND);
  assert.equal(polly.calls[0].signal.aborted, false);
  await clock.advance(1 * SECOND + 1);
  assert.equal(polly.calls[0].signal.aborted, true);
  assert.equal((await pending).success, false);
});

test('getConfig failing in connected: retried 5 s, 10 s, 20 s... without end, then ready', async () => {
  const gladys = createFakeGladys({ selector: SELECTOR, config: CONFIG });
  const real = gladys.getConfig.bind(gladys);
  // The SDK reads the configuration itself while connecting (call 1); the
  // app's reads in its 'connected' listener (calls 2, 3, 4) fail.
  let calls = 0;
  const tries = [];
  const clock = testClock({ start: START });
  gladys.getConfig = async () => {
    calls += 1;
    if (calls === 1) return real();
    tries.push(clock.monotonic());
    if (calls <= 4) throw new Error('503');
    return real();
  };
  const { polly } = await makeApp({ gladys, clock, connect: true });
  assert.equal(tries.length, 1);
  assert.match(lastStatus(gladys)[1], /could not be read from Gladys yet/);
  // A synthesis meanwhile waits 3 s at most, then says why.
  const early = gladys.fake.ttsSynthesize('Hello', 'en');
  await clock.advance(3 * SECOND + 1);
  assert.match((await early).error, /configuration could not be read/);
  await clock.advance(2 * SECOND);
  assert.equal(tries.length, 2);
  await clock.advance(10 * SECOND);
  assert.equal(tries.length, 3);
  await clock.advance(20 * SECOND);
  assert.equal(tries.length, 4);
  assert.deepEqual(
    tries.slice(1).map((at, i) => Math.round((at - tries[i]) / 1000)),
    [5, 10, 20],
  );
  assert.deepEqual(lastStatus(gladys), [
    true,
    'Ready. The keys are checked by AWS at the first announcement or with the Test button.',
  ]);
  assert.equal((await gladys.fake.ttsSynthesize('Hello', 'en')).success, true);
  assert.equal(polly.calls.length, 1);
});

test('a reconnection reads the configuration again and republishes the status', async () => {
  const { gladys, polly } = await makeApp();
  await gladys.fake.ttsSynthesize('Hello', 'en');
  const statuses = gladys.fake.connectionStatuses.length;
  gladys.fake.config = { ...CONFIG, voice_en: 'Brian' };
  await gladys.disconnect();
  await gladys.connect();
  await settle();
  assert.ok(gladys.fake.connectionStatuses.length > statuses);
  await gladys.fake.ttsSynthesize('Hello', 'en');
  assert.equal(polly.calls.at(-1).voice, 'Brian');
});

test('/data unreadable: never overwritten, read again every 10 s, one read at a time, merged', async () => {
  const store = createMemoryStore({ usage: { month: '2026-11', used: 100 } });
  store.unreadable = true;
  const { gladys, clock, app } = await makeApp({ store });
  assert.equal(store.loads, 1);
  // Synthesis still works; nothing written over the unreadable file.
  assert.equal((await gladys.fake.ttsSynthesize('Hello', 'en')).success, true);
  assert.equal(store.saves, 0);
  await clock.advance(10 * SECOND);
  assert.equal(store.loads, 2);
  // A slow read: no second read while it hangs.
  store.unreadable = false;
  store.hang = true;
  await clock.advance(10 * SECOND);
  assert.equal(store.loads, 3);
  await clock.advance(30 * SECOND);
  assert.equal(store.loads, 3);
  assert.equal(app.storeReady, false);
  app.loadStore(); // asked again meanwhile: still one read
  assert.equal(store.loads, 3);
  // Readable at last: the count of before and since is merged, then saved.
  store.hang = false;
  app.loading = null; // the hung read is abandoned (test only)
  await app.loadStore();
  assert.equal(app.usage.used, 105);
  assert.deepEqual(store.data.usage, { month: '2026-11', used: 105 });
});

test('a slow /data delays the first synthesis 2 s at most; a failing save blocks nothing', async () => {
  const store = createMemoryStore();
  store.hang = true;
  const { gladys, clock } = await makeApp({ store });
  const pending = gladys.fake.ttsSynthesize('Hello', 'en');
  await clock.advance(2 * SECOND + 1);
  assert.equal((await pending).success, true);

  const failing = createMemoryStore();
  failing.failSave = true;
  const second = await makeApp({ store: failing });
  assert.equal((await second.gladys.fake.ttsSynthesize('Hello', 'en')).success, true);
  assert.ok(second.logger.lines.some((l) => l.includes('/data not saved')));
});

test('one status per change; secrets never in logs, statuses, /data or errors', async () => {
  const store = createMemoryStore();
  const polly = fakePolly(() => {
    throw new PollyError('invalid', {
      status: 400,
      code: 'ValidationException',
      detail: 'This voice does not support the selected engine: neural',
    });
  });
  const { gladys, logger } = await makeApp({ store, polly });
  const started = gladys.fake.connectionStatuses.length;
  const ack = await gladys.fake.ttsSynthesize('Hello', 'en');
  assert.match(ack.error, /does not support the selected engine/);
  await gladys.fake.ttsSynthesize('Hello 2', 'en');
  polly.answer = refused;
  await gladys.fake.ttsSynthesize('Hello 3', 'en');
  // After the start (a connection republishes the status on purpose).
  const statuses = gladys.fake.connectionStatuses.slice(started).map((s) => JSON.stringify(s));
  for (let i = 1; i < statuses.length; i += 1) assert.notEqual(statuses[i], statuses[i - 1]);
  const everything = [...logger.lines, ...statuses, JSON.stringify(store.data), ack.error].join(
    '\n',
  );
  for (const secret of [KEY_ID, SECRET, 'Hello']) {
    assert.ok(!everything.includes(secret), `${secret} leaked`);
  }
});

test('the Test button: a short sentence in the chosen voice, the outcome under the button', async () => {
  const { gladys, polly, clock } = await makeApp();
  const ack = await gladys.fake.action('test_voice', { language: 'de' });
  assert.equal(ack.success, true);
  assert.equal(polly.calls[0].voice, 'Vicki');
  assert.match(polly.calls[0].text, /Amazon Polly/);
  assert.match(ack.data.message.fr, /voix Vicki, moteur standard, 1 Ko de MP3/);
  await gladys.fake.action('test_voice', { language: 'fr' });
  assert.equal(polly.calls[1].voice, 'Lea');
  // Never cached: the button always asks Polly.
  await gladys.fake.action('test_voice', { language: 'fr' });
  assert.equal(polly.calls.length, 3);
  void clock;
});

test('stop: waiters rejected, requests aborted, no timer left', async () => {
  const polly = fakePolly(hangUntilAbort);
  const store = createMemoryStore();
  store.unreadable = true;
  const { gladys, app, clock } = await makeApp({ polly, store });
  const acks = [0, 1, 2].map((i) => gladys.fake.ttsSynthesize(`T${i}`, 'en'));
  await settle();
  await app.stop();
  const results = await Promise.all(acks);
  assert.ok(results.every((r) => r.success === false));
  assert.ok(polly.calls.every((c) => c.signal.aborted));
  assert.equal(clock.pending, 0);
  const loads = store.loads;
  await clock.advance(HOUR);
  assert.equal(store.loads, loads);
});

test('a pause in a slow /data still holds the first synthesis (read awaited 2 s at most)', async () => {
  const clock = testClock({ start: START });
  const store = createMemoryStore({ pause: { until: START + 5 * MINUTE, step: MINUTE } });
  const load = store.load;
  store.load = () =>
    new Promise((resolve) => clock.timers.setTimeout(() => resolve(load()), SECOND));
  const { gladys, polly } = await makeApp({ store, clock });
  const pending = gladys.fake.ttsSynthesize('Hello', 'en');
  await settle();
  await clock.advance(SECOND + 1);
  const ack = await pending;
  assert.match(ack.error, /no request before 10:05/);
  assert.equal(polly.calls.length, 0);
});

test('one client per region and keys: a change of keys or region makes a new one', async () => {
  const { app, polly } = await makeApp();
  const base = { ok: true, region: 'eu-west-1', accessKeyId: KEY_ID, secretAccessKey: SECRET };
  const a = app.clientFor(base);
  assert.equal(app.clientFor({ ...base }), a);
  const b = app.clientFor({ ...base, accessKeyId: KEY_ID_2, secretAccessKey: SECRET_2 });
  assert.notEqual(b, a);
  assert.equal(b.options.accessKeyId, KEY_ID_2);
  const c = app.clientFor({ ...base, region: 'us-east-1' });
  assert.equal(c.options.region, 'us-east-1');
  assert.equal(polly.destroyed, 2);
});

test('identical requests at the same time share one Polly request (a scene on 5 speakers)', async () => {
  const releases = [];
  const polly = fakePolly(
    () => new Promise((resolve) => releases.push(() => resolve({ audio: MP3, characters: null }))),
  );
  const { gladys, app } = await makeApp({ polly });
  const text = 'The door is open now';
  const acks = [0, 1, 2, 3, 4].map(() => gladys.fake.ttsSynthesize(text, 'en'));
  await settle();
  assert.equal(polly.calls.length, 1);
  releases[0]();
  const results = await Promise.all(acks);
  assert.ok(results.every((r) => r.success && r.data.audio === AUDIO));
  assert.equal(app.usage.used, 20);
  assert.equal(app.shared.size, 0);
  // A shared failure: one request, every caller told, never sent again by itself.
  polly.answer = () => {
    throw new PollyError('invalid', { status: 400, code: 'ValidationException', detail: 'x' });
  };
  const failed = await Promise.all([1, 2, 3].map(() => gladys.fake.ttsSynthesize('Other', 'en')));
  assert.ok(failed.every((r) => r.success === false && /refused the request/.test(r.error)));
  assert.equal(polly.calls.length, 2);
  assert.equal(app.shared.size, 0);
});

for (const variant of ['throttled', 'refused', 'limit']) {
  test(`the guard is checked again after the queue: ${variant}`, async () => {
    const releases = [];
    const polly = fakePolly(
      () =>
        new Promise((resolve, reject) =>
          releases.push((err) => (err ? reject(err) : resolve({ audio: MP3 }))),
        ),
    );
    const config = { ...CONFIG, monthly_character_limit: 10_000 };
    const { gladys } = await makeApp({ polly, config });
    const running = [0, 1].map((i) => gladys.fake.ttsSynthesize(`${i}`.repeat(400), 'en'));
    const waiting = [2, 3, 4].map((i) => gladys.fake.ttsSynthesize(`${i}`.repeat(300), 'en'));
    await settle();
    assert.equal(polly.calls.length, 2);
    if (variant === 'throttled') {
      releases[0](new PollyError('throttled', { status: 400, code: 'ThrottlingException' }));
    } else if (variant === 'refused') {
      releases[0](new PollyError('refused', { status: 403, code: 'UnrecognizedClientException' }));
    } else {
      await gladys.fake.configUpdated({ ...CONFIG, monthly_character_limit: 1000 });
      releases[0]();
    }
    await settle();
    releases[1]?.();
    await Promise.all(running);
    const results = await Promise.all(waiting);
    const expected = {
      throttled: /no request before/,
      refused: /AWS refused these keys/,
      limit: /monthly limit of 1000 characters is reached/,
    }[variant];
    for (const r of results) assert.match(r.error, expected);
    assert.equal(polly.calls.length, 2, 'none of the waiting requests left');
  });
}

test('each refusal draws a new salt; another month in /data is not counted', async () => {
  const store = createMemoryStore({ usage: { month: '2026-10', used: 999_000 } });
  const polly = fakePolly(refused);
  const { gladys, app } = await makeApp({ store, polly });
  assert.equal(app.usage.used, 0, 'October does not count in November');
  await gladys.fake.ttsSynthesize('Hello', 'en');
  const first = store.data.refused.salt;
  await gladys.fake.action('test_voice', {});
  assert.equal(polly.calls.length, 2);
  assert.notEqual(store.data.refused.salt, first);
});

/** Secrets that differ from SECRET only in their last 4 characters. */
function* candidates() {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const a of abc)
    for (const b of abc) for (const c of abc) yield `${SECRET.slice(0, 37)}${a}${b}${c}`;
}

test('new keys sharing the 8-bit fingerprint of refused ones are still tried (same process)', async () => {
  const store = createMemoryStore();
  const polly = fakePolly(refused);
  const { gladys } = await makeApp({ store, polly });
  await gladys.fake.ttsSynthesize('Hello', 'en');
  const { salt, fp } = store.data.refused;
  const base = { accessKeyId: KEY_ID, region: 'eu-west-1' };
  let twin;
  for (const secret of candidates()) {
    if (secret !== SECRET && fp8(salt, { ...base, secretAccessKey: secret }) === fp) {
      twin = secret;
      break;
    }
  }
  assert.ok(twin, 'a collision exists among 17,576 candidates');
  polly.answer = () => ({ audio: MP3 });
  await gladys.fake.configUpdated({ ...CONFIG, secret_access_key: twin });
  assert.equal((await gladys.fake.ttsSynthesize('Hello', 'en')).success, true);
  assert.equal(polly.calls.length, 2);
});

test('brute force: the 8-bit fingerprint points at about 1 key in 256, never at one key', () => {
  const salt = '0123456789abcdef0123456789abcdef';
  const base = { accessKeyId: KEY_ID, region: 'eu-west-1' };
  const target = fp8(salt, { ...base, secretAccessKey: SECRET });
  let n = 0;
  let matches = 0;
  for (const secret of candidates()) {
    n += 1;
    if (fp8(salt, { ...base, secretAccessKey: secret }) === target) matches += 1;
  }
  // About n / 256 = 69 secrets fit the fingerprint: it tells nothing of the key.
  assert.ok(matches > n / 256 / 2 && matches < (n / 256) * 2, `${matches} of ${n}`);
});

test('a refusal is tied to the region; a cut connection stays counted; /data unread is said', async () => {
  const store = createMemoryStore();
  store.unreadable = true;
  const polly = fakePolly(refused);
  const { gladys, app } = await makeApp({
    store,
    polly,
    config: { ...CONFIG, region: 'eu-south-2' },
  });
  assert.match(lastStatus(gladys)[1], /\/data cannot be read yet/);
  await gladys.fake.ttsSynthesize('Hello', 'en');
  await gladys.fake.configUpdated({ ...CONFIG, region: 'eu-west-1' });
  polly.answer = () => {
    throw new PollyError('network', { code: 'ECONNRESET', sent: true });
  };
  const cut = await gladys.fake.ttsSynthesize('Hello', 'en');
  assert.equal(polly.calls.length, 2, 'tried again in another region');
  assert.match(cut.error, /connection was cut/);
  assert.equal(app.usage.used, 5, 'maybe billed: kept');
});

test('the count reaches /data before the request leaves (1 s at most for a stuck volume)', async () => {
  const clock = testClock({ start: START });
  const store = createMemoryStore();
  const save = store.save;
  let delay = 500;
  store.save = (next) =>
    new Promise((resolve) => clock.timers.setTimeout(() => resolve(save(next)), delay));
  const { gladys, polly } = await makeApp({ store, clock });
  const first = gladys.fake.ttsSynthesize('Hello', 'en');
  await settle();
  assert.equal(polly.calls.length, 0, 'waits for the write');
  await clock.advance(500);
  assert.equal(polly.calls.length, 1);
  assert.equal(store.data.usage.used, 5);
  assert.equal((await first).success, true);
  // A volume that never answers holds the request 1 s, not more.
  delay = 3_600_000;
  const second = gladys.fake.ttsSynthesize('Hello again', 'en');
  await settle();
  await clock.advance(999);
  assert.equal(polly.calls.length, 1);
  await clock.advance(2);
  assert.equal(polly.calls.length, 2);
  assert.equal((await second).success, true);
});
