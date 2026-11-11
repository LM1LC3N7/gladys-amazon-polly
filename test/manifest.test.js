// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here. No version is
// pinned: only its shape and its agreement across files.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DEFAULTS, readConfig } from '../src/config.js';
import { ACTIONS, ENGINES, LANGUAGES, RATES, REGIONS, VOICES } from '../src/constants.js';
import { ALL_TEXTS } from '../src/i18n.js';

const CORE = '/home/claude/code/Gladys/server';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const field = (key) => manifest.config_schema.find((f) => f.key === key);
const values = (key) => field(key).options.map((o) => o.value);

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) yield* texts(entry, `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

test('the store basics, the version agreeing everywhere, never pinned', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'tts');
  // TTS providers arrived with Gladys 5.3.0.
  assert.equal(manifest.gladys_version, '>=5.3.0');
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(pkg.name, 'gladys-amazon-polly');
  assert.equal(lock.name, pkg.name);
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-amazon-polly:${manifest.version}`);
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/LM1LC3N7\/gladys-amazon-polly\//,
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['assistants']);
  assert.equal(manifest.keywords, undefined);
  assert.equal(manifest.countries, undefined);
  assert.equal(pkg.scripts.test, 'node --test --test-timeout=60000');
  assert.equal(pkg.license, 'Apache-2.0');
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
    '@aws-sdk/client-polly',
    '@gladysassistant/integration-sdk',
    '@smithy/node-http-handler',
  ]);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300);
    assert.match(
      docs,
      /never been tested with a real AWS account|jamais été testée avec un vrai compte AWS/,
    );
    assert.match(docs, /polly:SynthesizeSpeech/);
  }
});

test('the manifest passes the schema of the core (when the clone is here)', (t) => {
  const schemaPath = `${CORE}/lib/external-integration/manifest.schema.json`;
  if (!existsSync(schemaPath) || !existsSync(`${CORE}/node_modules/ajv`)) {
    t.skip('Gladys core clone absent');
    return;
  }
  const require = createRequire(`${CORE}/index.js`);
  const Ajv = require('ajv');
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')));
  assert.ok(validate(manifest), JSON.stringify(validate.errors));
});

test('every text is in English and French; sections within their limits', () => {
  for (const [path, entry] of texts(manifest)) {
    for (const lang of ['en', 'fr']) assert.ok(entry[lang]?.trim(), `${path} needs ${lang}`);
  }
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    for (const lang of ['en', 'fr'])
      assert.ok(section.description[lang].length <= 1000, `${section.key}.${lang}`);
    assert.ok((section.links ?? []).every((l) => l.url.startsWith('https://')));
  }
});

test('no key starts with gladys_; the secret has no default; nothing said encrypted', () => {
  const all = [...manifest.config_schema, ...manifest.actions.flatMap((a) => a.fields ?? [])];
  for (const f of all) assert.doesNotMatch(f.key, /^gladys_/);
  const secrets = manifest.config_schema.filter((f) => f.type === 'secret');
  assert.deepEqual(
    secrets.map((f) => f.key),
    ['secret_access_key'],
  );
  for (const f of secrets) {
    assert.equal(f.default, undefined);
    assert.match(
      f.description.en,
      /Kept by Gladys in its database, never shown again, sent only to Amazon Web Services/,
    );
    assert.match(f.description.fr, /Gardée par Gladys dans sa base, jamais réaffichée/);
  }
  assert.equal(field('access_key_id').default, undefined);
  for (const file of [
    'gladys-assistant-integration.json',
    'docs/en.md',
    'docs/fr.md',
    'README.md',
    'CHANGELOG.md',
    'TODO.md',
    'CLAUDE.md',
    'src/i18n.js',
  ]) {
    assert.doesNotMatch(read(file), /chiffr(é|ement)|encrypt|hachage/i, file);
  }
});

test('the config fields are the ones the code reads, with the same defaults and choices', () => {
  assert.deepEqual(
    manifest.config_schema.filter((f) => f.type !== 'section').map((f) => f.key),
    [
      'access_key_id',
      'secret_access_key',
      'region',
      'engine',
      'voice_fr',
      'voice_en',
      'voice_de',
      'default_language',
      'speaking_rate',
      'monthly_character_limit',
    ],
  );
  const config = read('src/config.js');
  for (const f of manifest.config_schema.filter((x) => x.type !== 'section')) {
    assert.ok(
      config.includes(`.${f.key}`) ||
        (f.key.startsWith('voice_') && config.includes('`voice_${lang}`')),
      f.key,
    );
    if (f.default !== undefined) assert.equal(f.default, DEFAULTS[f.key], f.key);
  }
  assert.deepEqual(values('region'), REGIONS);
  assert.deepEqual(values('engine'), ENGINES);
  assert.equal(field('engine').default, 'standard');
  assert.deepEqual(values('speaking_rate'), RATES);
  assert.deepEqual(values('default_language'), LANGUAGES);
  for (const lang of LANGUAGES) assert.deepEqual(values(`voice_${lang}`), VOICES[lang]);
  const limit = field('monthly_character_limit');
  assert.ok(
    readConfig({
      access_key_id: 'AKIAIOSFODNN7EXAMPLE',
      secret_access_key: 'x'.repeat(40),
      monthly_character_limit: limit.min,
    }).ok,
  );
  assert.ok(
    !readConfig({
      access_key_id: 'AKIAIOSFODNN7EXAMPLE',
      secret_access_key: 'x'.repeat(40),
      monthly_character_limit: limit.max + 1,
    }).ok,
  );
});

test('every select option follows the rules of the core', () => {
  const selects = [
    ...manifest.config_schema,
    ...manifest.actions.flatMap((a) => a.fields ?? []),
  ].filter((f) => f.type === 'select');
  for (const f of selects) {
    const seen = new Set();
    for (const o of f.options) {
      assert.deepEqual(Object.keys(o).sort(), ['label', 'value'], f.key);
      assert.equal(typeof o.value, 'string');
      assert.ok(!seen.has(o.value), `${f.key}: ${o.value} twice`);
      seen.add(o.value);
      for (const lang of ['en', 'fr']) {
        const label = o.label[lang];
        assert.equal(typeof label, 'string');
        assert.ok(label.length > 0 && label.trim() === label, `${f.key}.${o.value}.${lang}`);
      }
    }
    if (f.default !== undefined) assert.ok(seen.has(f.default), `${f.key} default`);
  }
});

test('the action is the one the code handles', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  assert.ok(read('src/app.js').includes('onAction(ACTIONS.TEST'));
  for (const a of manifest.actions) assert.ok(a.timeout_seconds >= 5 && a.timeout_seconds <= 120);
  // A TTS provider: no device, no command, no switch.
  for (const key of ['widgets', 'scene_actions', 'scene_triggers', 'energy_contracts'])
    assert.equal(manifest[key], undefined);
  assert.ok(!read('src/app.js').includes('onSetValue'));
});

test('every runtime text exists in both languages', () => {
  for (const [key, entry] of Object.entries(ALL_TEXTS)) {
    assert.deepEqual(Object.keys(entry).sort(), ['en', 'fr'], key);
    for (const lang of ['en', 'fr']) assert.ok(entry[lang].trim(), `${key}.${lang}`);
    const names = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(names(entry.fr), names(entry.en), key);
  }
});
