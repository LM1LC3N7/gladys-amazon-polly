// -----------------------------------------------------------------------------
// Fixed values: the Polly voices offered per Gladys language, the engines, the
// regions, and the limits the integration holds itself to.
//
// The voice lists come from the Amazon Polly documentation ("Available voices",
// November 2026). Which engine a voice supports is NOT checked here: Polly
// answers a clear ValidationException ("This voice does not support the
// selected engine"), shown as is, and a refusal costs nothing.
// -----------------------------------------------------------------------------

/** The Gladys languages and the Polly voices offered for each (VoiceId values). */
export const VOICES = {
  fr: ['Lea', 'Celine', 'Mathieu', 'Remi', 'Isabelle', 'Chantal', 'Gabrielle', 'Liam'],
  en: [
    'Joanna',
    'Matthew',
    'Ivy',
    'Kendra',
    'Kimberly',
    'Salli',
    'Joey',
    'Justin',
    'Kevin',
    'Ruth',
    'Stephen',
    'Danielle',
    'Gregory',
    'Amy',
    'Emma',
    'Brian',
    'Arthur',
    'Nicole',
    'Russell',
    'Olivia',
    'Aria',
    'Ayanda',
    'Niamh',
    'Geraint',
    'Raveena',
  ],
  de: ['Vicki', 'Marlene', 'Hans', 'Daniel', 'Hannah', 'Sabrina'],
};

/** Voices that support the standard engine (the default engine) in every list above. */
export const DEFAULT_VOICES = { fr: 'Lea', en: 'Joanna', de: 'Vicki' };

export const LANGUAGES = Object.keys(VOICES);

/** `standard` is the default: the cheapest (see the docs for the prices). */
export const ENGINES = ['standard', 'neural', 'generative', 'long-form'];

export const RATES = ['x-slow', 'slow', 'medium', 'fast', 'x-fast'];

/** Commercial AWS regions where Amazon Polly runs (not every engine in each). */
export const REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ca-central-1',
  'sa-east-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-central-1',
  'eu-central-2',
  'eu-north-1',
  'eu-south-2',
  'af-south-1',
  'ap-south-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',
  'ap-southeast-1',
  'ap-southeast-2',
];

export const ACTIONS = { TEST: 'test_voice' };

/** The SDK caps the text at 2,000 characters; the core truncates before the relay. */
export const MAX_TEXT = 2000;
/** The clip the SDK accepts (decoded), read no further. */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
/** Gladys waits 30 s for the ack: the whole answer fits in 25 s, queue included. */
export const DEADLINE_MS = 25_000;
export const CONNECT_TIMEOUT_MS = 5_000;
/** Requests in flight at once; the others wait in a bounded queue. */
export const MAX_IN_FLIGHT = 2;
export const MAX_WAITING = 8;

/** Pause after a throttling or a server error: 60 s, doubled up to 1 h; a Retry-After up to 6 h. */
export const PAUSE_MIN_MS = 60_000;
export const PAUSE_MAX_MS = 3_600_000;
export const RETRY_AFTER_MAX_MS = 6 * 3_600_000;

/** Clips kept in memory (same text, same voice: not billed twice). */
export const CACHE_MAX_ENTRIES = 20;
export const CACHE_MAX_CHARS = 20 * 1024 * 1024;
export const CACHE_TTL_MS = 24 * 3_600_000;

/** /data read again on this timer while it cannot be read; the first read waits this long. */
export const STORE_RETRY_MS = 10_000;
export const STORE_LOAD_BUDGET_MS = 2_000;
/** getConfig() retried without end: 5 s, doubled up to 60 s. */
export const CONFIG_RETRY_MIN_MS = 5_000;
export const CONFIG_RETRY_MAX_MS = 60_000;
/** A synthesis arriving before the configuration was read waits for it this long at most. */
export const CONFIG_WAIT_MS = 3_000;

export const DEFAULT_MONTHLY_LIMIT = 1_000_000;
export const MIN_MONTHLY_LIMIT = 1_000;
export const MAX_MONTHLY_LIMIT = 100_000_000;
