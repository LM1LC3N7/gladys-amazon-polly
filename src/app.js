// -----------------------------------------------------------------------------
// The text-to-speech provider: Gladys sends a text and a language
// (onTtsSynthesize), the app picks the voice, asks Amazon Polly for an MP3 and
// answers `audio/mpeg;base64,...` within 25 s (Gladys waits 30 s).
//
// What protects the AWS bill and the account:
//   - the monthly character limit, counted before a request leaves and kept
//     in /data (a request that may have been billed stays counted);
//   - the same text in the same voice served from memory (24 h, 20 clips),
//     and asked several times at once, one request shared by all;
//   - at most 2 requests in flight, 8 waiting, the others refused;
//   - after a throttling or a server error: a pause (60 s doubled up to 1 h,
//     a Retry-After up to 6 h), kept in /data, on every path, Test included;
//   - keys refused by AWS in a region: nothing more sent with them there (8
//     bits of a salted hash in /data) until they change or the Test button succeeds.
// Time: every pause on the monotonic clock; the wall clock only for /data
// (pause end across a restart) and the calendar month of the limit (UTC).
// -----------------------------------------------------------------------------

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { languageOf, readConfig } from './config.js';
import {
  ACTIONS,
  CACHE_MAX_CHARS,
  CACHE_MAX_ENTRIES,
  CACHE_TTL_MS,
  CONFIG_RETRY_MAX_MS,
  CONFIG_RETRY_MIN_MS,
  CONFIG_WAIT_MS,
  DEADLINE_MS,
  LANGUAGES,
  MAX_IN_FLIGHT,
  MAX_TEXT,
  MAX_WAITING,
  PAUSE_MAX_MS,
  PAUSE_MIN_MS,
  RETRY_AFTER_MAX_MS,
  SAVE_BUDGET_MS,
  STORE_LOAD_BUDGET_MS,
  STORE_RETRY_MS,
} from './constants.js';
import { both, t } from './i18n.js';
import { PollyError } from './polly.js';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const credsOf = (cfg) => `${cfg.accessKeyId}\n${cfg.secretAccessKey}`;
// A refusal is tied to the keys AND the region (a key is unknown in a region
// not enabled on the account; back to another region, it is tried again).
const refusalOf = (cfg) => `${credsOf(cfg)}\n${cfg.region}`;
const monthOf = (wall) => new Date(wall).toISOString().slice(0, 7);
export const fp8 = (salt, cfg) => createHmac('sha256', salt).update(refusalOf(cfg)).digest()[0];
const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

/** Bounded wait: resolves `fallback` after `ms` if `promise` is slower. */
function within(promise, ms, timers, fallback) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = timers.setTimeout(() => resolve(fallback), Math.max(0, ms));
    }),
  ]).finally(() => timers.clearTimeout(timer));
}

/** Plain text, or SSML with the rate when it is not the default. */
export function buildRequestText(text, rate) {
  if (rate === 'medium') return { text, ssml: false };
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  return { text: `<speak><prosody rate="${rate}">${escaped}</prosody></speak>`, ssml: true };
}

/** The text cleaned: control characters become spaces, at most 2,000 characters. */
export function cleanText(text) {
  return (
    String(text ?? '')
      // eslint-disable-next-line no-control-regex -- control characters are what it removes
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
      .slice(0, MAX_TEXT)
      .trim()
  );
}

export class PollyApp {
  constructor({
    gladys,
    store,
    createPolly,
    logger = console,
    now = () => performance.now(),
    wallNow = () => Date.now(),
    timers = { setTimeout, clearTimeout },
    userAgent = 'gladys-amazon-polly',
  }) {
    Object.assign(this, { gladys, store, createPolly, logger, now, wallNow, timers, userAgent });
    this.stopped = false;
    // Configuration.
    this.config = null; // readConfig() result once read
    this.configRead = false;
    this.configLoop = null;
    this.configTimer = null;
    this.configWaiters = [];
    // /data.
    this.storeReady = false;
    this.loading = null;
    this.storeTimer = null;
    this.firstLoad = null;
    this.usage = { month: monthOf(wallNow()), used: 0 };
    this.pauseUntil = 0; // monotonic
    this.pauseStep = 0;
    this.refused = null; // { salt, fp } (persisted)
    this.refusedFull = null; // sha256 of the refused keys, this process only
    this.succeeded = null; // the keys of the last success, to drop a stale refusal
    // Requests.
    this.client = null;
    this.clientKey = null;
    this.inFlight = 0;
    this.waiting = [];
    this.controllers = new Set();
    this.cache = new Map();
    this.shared = new Map(); // cache key -> the promise of the request in flight
    this.cacheChars = 0;
    // Status.
    this.outcome = 'ready';
    this.outcomeVars = {};
    this.lastStatus = null;
  }

  /** Handlers first, then /data, then the connection. */
  async start() {
    const { gladys } = this;
    gladys.onTtsSynthesize((text, language) => this.synthesize(text, language));
    gladys.onConfigUpdated(async (raw) => this.applyConfig(raw));
    gladys.onAction(ACTIONS.TEST, async (fields) => this.test(fields));
    gladys.on('connected', () => this.onConnected());
    this.firstLoad = this.loadStore();
    await gladys.connect();
  }

  async stop() {
    this.stopped = true;
    for (const timer of [this.configTimer, this.storeTimer]) this.timers.clearTimeout(timer);
    for (const w of this.waiting.splice(0)) {
      this.timers.clearTimeout(w.timer);
      w.reject(new Error(t('stopped')));
    }
    for (const c of this.controllers) c.abort();
    for (const w of this.configWaiters.splice(0)) w();
    this.client?.destroy();
    this.client = null;
    await this.store.flush?.();
  }

  // --- Configuration -----------------------------------------------------------

  /** Every (re)connection: the configuration read again, the status published again. */
  onConnected() {
    this.lastStatus = null;
    this.refreshConfig(CONFIG_RETRY_MIN_MS);
    this.publishStatus();
  }

  /** getConfig() until it answers, 5 s doubled up to 60 s between tries, without end. */
  refreshConfig(delay) {
    if (this.configLoop || this.stopped) return;
    this.timers.clearTimeout(this.configTimer);
    this.configTimer = null;
    this.configLoop = (async () => {
      try {
        const raw = await this.gladys.getConfig();
        if (this.stopped) return;
        this.applyConfig(raw);
      } catch (err) {
        if (this.stopped) return;
        this.logger.warn(`getConfig failed (${err?.name ?? 'error'}); retry in ${delay / 1000} s`);
        this.publishStatus();
        this.configTimer = this.timers.setTimeout(() => {
          this.configTimer = null;
          this.refreshConfig(Math.min(delay * 2, CONFIG_RETRY_MAX_MS));
        }, delay);
      } finally {
        this.configLoop = null;
      }
    })();
  }

  applyConfig(raw) {
    const cfg = readConfig(raw);
    const before = this.config;
    if (
      before?.ok &&
      (!cfg.ok || credsOf(before) !== credsOf(cfg) || before.region !== cfg.region)
    ) {
      this.client?.destroy();
      this.client = null;
      this.clientKey = null;
    }
    const sameKeys = before?.ok && cfg.ok && credsOf(before) === credsOf(cfg);
    this.config = cfg;
    this.configRead = true;
    // Keys or settings changed: the last outcome no longer says anything. The
    // same keys saved again keep it (no false reason, no temporary refusal).
    if (!sameKeys || before.region !== cfg.region || before.engine !== cfg.engine) {
      this.outcome = 'ready';
      this.outcomeVars = {};
    }
    for (const w of this.configWaiters.splice(0)) w();
    this.publishStatus();
  }

  /** Waits (bounded) for the configuration and the first read of /data. */
  async ready() {
    const waits = [];
    if (!this.configRead) {
      if (!this.configLoop && !this.configTimer) this.refreshConfig(CONFIG_RETRY_MIN_MS);
      waits.push(
        within(
          new Promise((resolve) => this.configWaiters.push(resolve)),
          CONFIG_WAIT_MS,
          this.timers,
        ),
      );
    }
    if (!this.storeReady && this.firstLoad) {
      waits.push(within(this.firstLoad, STORE_LOAD_BUDGET_MS, this.timers));
    }
    await Promise.all(waits);
    if (this.stopped) throw new Error(t('stopped'));
  }

  // --- /data ------------------------------------------------------------------------

  /** One read at a time; an unreadable /data is read again every 10 s, never overwritten. */
  loadStore() {
    if (this.loading || this.storeReady || this.stopped) return this.loading;
    this.loading = (async () => {
      try {
        const data = await this.store.load();
        if (this.stopped) return;
        this.merge(data);
      } catch (err) {
        if (this.stopped) return;
        this.logger.warn(`/data unreadable (${err?.message ?? 'error'}); read again in 10 s`);
        this.storeTimer = this.timers.setTimeout(() => {
          this.storeTimer = null;
          this.loadStore();
        }, STORE_RETRY_MS);
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  /** What /data says, merged with what happened since the start (never lost). */
  merge(data) {
    const now = this.now();
    const wall = this.wallNow();
    const usage = data?.usage;
    if (
      usage &&
      typeof usage.month === 'string' &&
      usage.month === this.usage.month &&
      isInt(usage.used, 0, 1e12)
    ) {
      this.usage.used += usage.used;
    }
    const pause = data?.pause;
    if (pause && Number.isFinite(pause.until)) {
      const left = pause.until - wall;
      // A date further than the longest pause is invalid (clock jumped, foreign file).
      if (left > 0 && left <= RETRY_AFTER_MAX_MS) {
        this.pauseUntil = Math.max(this.pauseUntil, now + left);
      }
      if (isInt(pause.step, PAUSE_MIN_MS, PAUSE_MAX_MS)) {
        this.pauseStep = Math.max(this.pauseStep, pause.step);
      }
    }
    const refused = data?.refused;
    if (
      !this.refused &&
      refused &&
      typeof refused.salt === 'string' &&
      /^[0-9a-f]{32}$/.test(refused.salt) &&
      isInt(refused.fp, 0, 255)
    ) {
      // Keys that succeeded since the start lift a refusal read late.
      const lifted = this.succeeded && fp8(refused.salt, this.succeeded) === refused.fp;
      if (!lifted) this.refused = { salt: refused.salt, fp: refused.fp };
    }
    this.storeReady = true;
    this.save();
    this.publishStatus();
  }

  snapshot() {
    const left = this.pauseUntil - this.now();
    return {
      usage: { ...this.usage },
      pause:
        left > 0 || this.pauseStep
          ? { until: this.wallNow() + Math.max(0, left), step: this.pauseStep }
          : null,
      refused: this.refused ? { ...this.refused } : null,
    };
  }

  save() {
    if (!this.storeReady) return Promise.resolve();
    return this.store.save(this.snapshot()).catch((err) => {
      this.logger.warn(`/data not saved (${err?.message ?? 'error'})`);
    });
  }

  // --- Guards -------------------------------------------------------------------------

  isRefused(cfg) {
    if (this.refusedFull) return this.refusedFull === sha256(refusalOf(cfg));
    return Boolean(this.refused) && fp8(this.refused.salt, cfg) === this.refused.fp;
  }

  pausedFor() {
    return Math.max(0, this.pauseUntil - this.now());
  }

  rollMonth() {
    const month = monthOf(this.wallNow());
    if (month !== this.usage.month) this.usage = { month, used: 0 };
  }

  /** Throws the reason nothing can be sent now (the order is the status order). */
  gate(cfg, chars, lang, { allowRefused = false } = {}) {
    if (!allowRefused && this.isRefused(cfg)) throw new Error(t('refused', lang));
    const left = this.pausedFor();
    if (left > 0) throw new Error(t('paused', lang, { time: this.pauseEnd(left) }));
    this.rollMonth();
    if (this.usage.used + chars > cfg.monthlyLimit) {
      throw new Error(t('limit_reached', lang, { limit: cfg.monthlyLimit, used: this.usage.used }));
    }
  }

  pauseEnd(left) {
    return new Date(this.wallNow() + left).toISOString().slice(11, 16);
  }

  // --- Queue ----------------------------------------------------------------------------

  acquire(deadline, lang) {
    if (this.inFlight < MAX_IN_FLIGHT) {
      this.inFlight += 1;
      return Promise.resolve();
    }
    if (this.waiting.length >= MAX_WAITING) return Promise.reject(new Error(t('busy', lang)));
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      waiter.timer = this.timers.setTimeout(
        () => {
          this.waiting = this.waiting.filter((w) => w !== waiter);
          reject(new Error(t('timeout', lang)));
        },
        Math.max(0, deadline - this.now()),
      );
      this.waiting.push(waiter);
    });
  }

  release() {
    const next = this.waiting.shift();
    if (next) {
      this.timers.clearTimeout(next.timer);
      next.resolve(); // the slot passes on
    } else {
      this.inFlight -= 1;
    }
  }

  // --- Cache --------------------------------------------------------------------------

  cacheGet(key) {
    const hit = this.cache.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at > CACHE_TTL_MS) {
      this.cache.delete(key);
      this.cacheChars -= hit.audio.length;
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, hit); // most recent last
    return hit.audio;
  }

  cachePut(key, audio) {
    if (audio.length > CACHE_MAX_CHARS) return;
    const old = this.cache.get(key);
    if (old) {
      this.cache.delete(key);
      this.cacheChars -= old.audio.length;
    }
    this.cache.set(key, { audio, at: this.now() });
    this.cacheChars += audio.length;
    for (const [k, v] of this.cache) {
      if (this.cache.size <= CACHE_MAX_ENTRIES && this.cacheChars <= CACHE_MAX_CHARS) break;
      this.cache.delete(k);
      this.cacheChars -= v.audio.length;
    }
  }

  // --- Synthesis ----------------------------------------------------------------------

  /** onTtsSynthesize: the clip, or an error in the language of the request. */
  async synthesize(rawText, language) {
    const deadline = this.now() + DEADLINE_MS;
    const lang = typeof language === 'string' && language.startsWith('fr') ? 'fr' : 'en';
    await this.ready();
    const cfg = this.config;
    if (!cfg) throw new Error(t('config_unread', lang));
    if (!cfg.ok) throw new Error(t(cfg.reason, lang));
    const text = cleanText(rawText);
    if (!text) throw new Error(t('empty_text', lang));
    const voice = cfg.voices[languageOf(cfg, language)];
    const key = sha256(JSON.stringify([voice, cfg.engine, cfg.rate, text]));
    const cached = this.cacheGet(key);
    if (cached) return cached;
    // The same text in the same voice already asked (a scene announcing on
    // several speakers at once): one request, its answer or failure shared.
    const inFlight = this.shared.get(key);
    if (inFlight) return inFlight;
    const job = this.run({ text, voice, lang, deadline }).then(({ audio }) => {
      this.cachePut(key, audio);
      return audio;
    });
    this.shared.set(key, job);
    try {
      return await job;
    } finally {
      if (this.shared.get(key) === job) this.shared.delete(key);
    }
  }

  /** The Test button: a short sentence, sent even with refused keys (never during a pause). */
  async test(fields = {}) {
    const deadline = this.now() + DEADLINE_MS;
    await this.ready();
    const cfg = this.config;
    if (!cfg) throw new Error(t('config_unread'));
    if (!cfg.ok) throw new Error(t(cfg.reason));
    const wanted = typeof fields?.language === 'string' ? fields.language : '';
    const language = LANGUAGES.includes(wanted) ? wanted : cfg.defaultLanguage;
    const text =
      language === 'de'
        ? t('test_sentence_de')
        : t('test_sentence', language === 'fr' ? 'fr' : 'en');
    const voice = cfg.voices[language];
    const started = this.now();
    const { bytes } = await this.run({ text, voice, lang: 'en', deadline, allowRefused: true });
    return both('test_ok', {
      voice,
      engine: cfg.engine,
      size: Math.max(1, Math.round(bytes / 1024)),
      ms: Math.round(this.now() - started),
    });
  }

  /** Gate, queue, gate again, count, send. */
  async run({ text, voice, lang, deadline, allowRefused = false }) {
    const chars = text.length;
    this.gate(this.config, chars, lang, { allowRefused });
    await this.acquire(deadline, lang);
    try {
      if (this.stopped) throw new Error(t('stopped', lang));
      // Things may have changed while waiting: the configuration, a refusal, a pause.
      const cfg = this.config;
      if (!cfg?.ok) throw new Error(t(cfg?.reason ?? 'config_unread', lang));
      this.gate(cfg, chars, lang, { allowRefused });
      const left = deadline - this.now();
      if (left <= 0) throw new Error(t('timeout', lang));
      // Counted before it leaves, and written to /data first (1 s at most: a
      // stuck volume never holds an announcement), so a lost answer or a
      // crash right after the send does not under-count.
      this.usage.used += chars;
      await within(this.save(), SAVE_BUDGET_MS, this.timers);
      if (this.stopped) throw new Error(t('stopped', lang));
      const started = this.now();
      let result;
      try {
        result = await this.send(cfg, { text, voice }, left);
      } catch (err) {
        this.failed(err, cfg, chars);
        throw new Error(this.message(err, lang), { cause: err });
      }
      this.succeededWith(cfg, chars, result.characters);
      const kb = Math.round(result.audio.length / 1024);
      this.logger.info(
        `synthesized ${chars} characters (voice ${voice}, ${cfg.engine}, ${kb} KB, ${Math.round(this.now() - started)} ms)`,
      );
      return {
        audio: `audio/mpeg;base64,${result.audio.toString('base64')}`,
        bytes: result.audio.length,
      };
    } finally {
      this.release();
    }
  }

  clientFor(cfg) {
    const key = sha256(`${cfg.region}\n${credsOf(cfg)}`);
    if (!this.client || this.clientKey !== key) {
      this.client?.destroy();
      this.client = this.createPolly({
        region: cfg.region,
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        userAgent: this.userAgent,
      });
      this.clientKey = key;
    }
    return this.client;
  }

  async send(cfg, { text, voice }, left) {
    const controller = new AbortController();
    const timer = this.timers.setTimeout(() => controller.abort(), left);
    this.controllers.add(controller);
    try {
      const request = buildRequestText(text, cfg.rate);
      return await this.clientFor(cfg).synthesize({
        ...request,
        voice,
        engine: cfg.engine,
        signal: controller.signal,
      });
    } finally {
      this.timers.clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }

  succeededWith(cfg, chars, billed) {
    // Polly says how many characters it billed (SSML tags are free).
    if (Number.isInteger(billed) && billed >= 0 && billed <= MAX_TEXT * 2) {
      this.usage.used = Math.max(0, this.usage.used - chars + billed);
    }
    this.pauseStep = 0;
    this.pauseUntil = 0;
    this.refused = null;
    this.refusedFull = null;
    this.succeeded = {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      region: cfg.region,
    };
    this.outcome = 'working';
    this.outcomeVars = { voice: '', engine: cfg.engine };
    this.save();
    this.publishStatus();
  }

  failed(err, cfg, chars) {
    const kind = err instanceof PollyError ? err.kind : 'network';
    // Answered with an error (or never sent): not billed. A timeout or a cut
    // connection may have been billed: it stays counted.
    const answered = err instanceof PollyError && typeof err.status === 'number';
    const notSent = err instanceof PollyError && err.sent === false;
    if (answered || notSent) this.usage.used = Math.max(0, this.usage.used - chars);
    if (kind === 'refused') {
      const salt = randomBytes(16).toString('hex');
      this.refused = { salt, fp: fp8(salt, cfg) };
      this.refusedFull = sha256(refusalOf(cfg));
      this.succeeded = null;
    } else if (kind === 'throttled' || kind === 'unavailable') {
      this.pauseStep = this.pauseStep ? Math.min(this.pauseStep * 2, PAUSE_MAX_MS) : PAUSE_MIN_MS;
      const asked = Number.isFinite(err.retryAfterMs)
        ? Math.min(err.retryAfterMs, RETRY_AFTER_MAX_MS)
        : 0;
      this.pauseUntil = this.now() + Math.max(this.pauseStep, asked);
    }
    this.outcome = kind;
    this.outcomeVars = { detail: err?.detail ?? '' };
    this.logger.warn(
      `synthesis failed: ${kind}${err?.code ? ` (${err.code})` : ''}${err?.status ? ` HTTP ${err.status}` : ''}`,
    );
    this.save();
    this.publishStatus();
  }

  message(err, lang) {
    const kind = err instanceof PollyError ? err.kind : 'network';
    if (kind === 'throttled' || kind === 'unavailable') {
      return t('paused', lang, { time: this.pauseEnd(this.pausedFor()) });
    }
    return t(kind, lang, { detail: err?.detail || err?.code || '' });
  }

  // --- Status -------------------------------------------------------------------------

  status() {
    if (!this.configRead) return { ok: false, key: 'config_unread' };
    const cfg = this.config;
    if (!cfg.ok) return { ok: false, key: cfg.reason };
    if (this.isRefused(cfg)) return { ok: false, key: 'refused' };
    const left = this.pausedFor();
    if (left > 0) return { ok: false, key: 'paused', vars: { time: this.pauseEnd(left) } };
    this.rollMonth();
    if (this.usage.used >= cfg.monthlyLimit) {
      return {
        ok: false,
        key: 'limit_reached',
        vars: { limit: cfg.monthlyLimit, used: this.usage.used },
      };
    }
    // /data not read: the limit, the pause and a refusal kept there are not known.
    if (!this.storeReady && (this.outcome === 'working' || this.outcome === 'ready')) {
      return { ok: true, key: 'data_unread' };
    }
    if (this.outcome === 'working') {
      return {
        ok: true,
        key: 'working',
        vars: { voice: Object.values(cfg.voices).join(', '), engine: cfg.engine },
      };
    }
    if (this.outcome !== 'ready' && this.outcome !== 'refused') {
      return { ok: false, key: this.outcome, vars: this.outcomeVars };
    }
    return { ok: true, key: 'ready' };
  }

  /** One setConnectionStatus per change of state. */
  publishStatus() {
    if (this.stopped) return;
    const { ok, key, vars = {} } = this.status();
    const message = both(key, vars);
    const id = JSON.stringify([ok, message]);
    if (id === this.lastStatus) return;
    this.lastStatus = id;
    Promise.resolve()
      .then(() => this.gladys.setConnectionStatus(ok, message))
      .catch((err) => {
        if (this.lastStatus === id) this.lastStatus = null;
        this.logger.warn(`setConnectionStatus failed (${err?.name ?? 'error'})`);
      });
  }
}
