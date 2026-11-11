// -----------------------------------------------------------------------------
// Configuration: the values of the `config_schema`, checked. `readConfig`
// never throws: it returns `{ ok: true, ... }` or `{ ok: false, reason }`, the
// reason being an i18n key (an invalid value is never shown back).
// -----------------------------------------------------------------------------

import {
  DEFAULT_MONTHLY_LIMIT,
  DEFAULT_VOICES,
  ENGINES,
  LANGUAGES,
  MAX_MONTHLY_LIMIT,
  MIN_MONTHLY_LIMIT,
  RATES,
  REGIONS,
  VOICES,
} from './constants.js';

export const DEFAULTS = {
  region: 'eu-west-1',
  engine: 'standard',
  voice_fr: DEFAULT_VOICES.fr,
  voice_en: DEFAULT_VOICES.en,
  voice_de: DEFAULT_VOICES.de,
  default_language: 'en',
  speaking_rate: 'medium',
  monthly_character_limit: DEFAULT_MONTHLY_LIMIT,
};

// An AWS access key ID: upper-case letters and digits (AKIA..., 20 characters
// today; IAM allows 16 to 128).
const KEY_ID = /^[A-Z0-9]{16,128}$/;
// A secret access key: 40 characters of base64 today; no space, no control.
const SECRET = /^[A-Za-z0-9+/=]{16,128}$/;

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const pick = (value, allowed, fallback) => {
  const v = text(value);
  if (v === '') return { value: fallback };
  return allowed.includes(v) ? { value: v } : { bad: true };
};

/**
 * @param {Record<string, unknown>} raw the values from Gladys
 */
export function readConfig(raw = {}) {
  const config = raw && typeof raw === 'object' ? raw : {};
  const accessKeyId = text(config.access_key_id);
  const secretAccessKey = text(config.secret_access_key);
  if (!accessKeyId && !secretAccessKey) return { ok: false, reason: 'not_configured' };
  if (!accessKeyId) return { ok: false, reason: 'key_id_missing' };
  if (!secretAccessKey) return { ok: false, reason: 'secret_missing' };
  if (!KEY_ID.test(accessKeyId)) return { ok: false, reason: 'key_id_invalid' };
  if (!SECRET.test(secretAccessKey)) return { ok: false, reason: 'secret_invalid' };

  const region = pick(config.region, REGIONS, DEFAULTS.region);
  if (region.bad) return { ok: false, reason: 'region_invalid' };
  const engine = pick(config.engine, ENGINES, DEFAULTS.engine);
  if (engine.bad) return { ok: false, reason: 'engine_invalid' };
  const voices = {};
  for (const lang of LANGUAGES) {
    const voice = pick(config[`voice_${lang}`], VOICES[lang], DEFAULT_VOICES[lang]);
    if (voice.bad) return { ok: false, reason: 'voice_invalid' };
    voices[lang] = voice.value;
  }
  const language = pick(config.default_language, LANGUAGES, DEFAULTS.default_language);
  if (language.bad) return { ok: false, reason: 'language_invalid' };
  const rate = pick(config.speaking_rate, RATES, DEFAULTS.speaking_rate);
  if (rate.bad) return { ok: false, reason: 'rate_invalid' };

  let limit = DEFAULTS.monthly_character_limit;
  const rawLimit = config.monthly_character_limit;
  if (rawLimit !== undefined && rawLimit !== null && rawLimit !== '') {
    // Strict: '' or a decimal is not a number of characters.
    const n = typeof rawLimit === 'number' ? rawLimit : Number(text(rawLimit));
    if (
      !Number.isInteger(n) ||
      (typeof rawLimit === 'string' && !/^\d+$/.test(text(rawLimit))) ||
      n < MIN_MONTHLY_LIMIT ||
      n > MAX_MONTHLY_LIMIT
    ) {
      return { ok: false, reason: 'limit_invalid' };
    }
    limit = n;
  }

  return {
    ok: true,
    accessKeyId,
    secretAccessKey,
    region: region.value,
    engine: engine.value,
    voices,
    defaultLanguage: language.value,
    rate: rate.value,
    monthlyLimit: limit,
  };
}

/** The Gladys language of a request ('fr', 'fr-FR', 'FR' -> 'fr'); the default otherwise. */
export function languageOf(config, language) {
  const lang = typeof language === 'string' ? language.slice(0, 2).toLowerCase() : '';
  return LANGUAGES.includes(lang) ? lang : config.defaultLanguage;
}
