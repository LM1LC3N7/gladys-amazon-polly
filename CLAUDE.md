# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** of type `tts` (text-to-speech
provider, Gladys 5.3.0+): a Node.js service (Node 22+, ESM, no build step) in
its own sandboxed Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and to **Amazon Polly** through the official AWS SDK
(`@aws-sdk/client-polly`, Apache-2.0) with the user's own IAM keys. Gladys
sends a text (2,000 characters at most) and a language; the integration
answers an MP3 clip as `audio/mpeg;base64,...` within 25 s (Gladys waits
30 s). Unofficial: not affiliated with Amazon.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "limit"   # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run mutants                           # mutation check (scripts/mutants.json), use memcap
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: PollyApp, FileStore, createPolly
src/app.js                        PollyApp: handlers, configuration, voice choice, cache,
                                  monthly limit, queue, pause, refusal, status, Test button
src/polly.js                      the only network access: SynthesizeSpeech, error classes,
                                  bounded read of the clip, redaction
src/config.js                     the form, checked (never throws, never shows a bad value)
src/store.js                      /data/amazon-polly.json (count, pause, refusal)
src/constants.js                  voices, engines, regions, bounds, manifest keys
src/i18n.js                       runtime texts (en/fr)
gladys-assistant-integration.json manifest: type tts, config, Test action
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test: fake Gladys, scripted Polly, virtual clock;
                                  test/polly.test.js: the real AWS SDK on a local server
scripts/                          cover.png generator, mutation runner and list
```

## Rules

- **The bill is the user's.** Standard engine by default; never a retry in
  the SDK (`maxAttempts: 1`) nor in the app; the monthly limit counted
  BEFORE a request leaves (refunded only when AWS answered an error, or the
  connection never opened); the Test button respects the pause and the
  limit.
- **Never a key** (access key ID or secret) in a log, the status, an error,
  `/data` or a test fixture other than the AWS documentation examples. Polly
  error texts go through `redact`. The spoken text is never logged nor
  written to `/data` (only its length).
- **Only a refusal of the key is a refusal** (`UnrecognizedClientException`,
  `InvalidSignatureException` not expired, `InvalidClientTokenId`...): any other
  401/403 (`AccessDeniedException`, unknown codes) is a missing right, and a
  request expired by the clock is a clock problem. A refused key is never
  sent again by itself; new keys are always tried.
- **Throttling or 5xx**: a pause on the monotonic clock (60 s doubled up to
  1 h, Retry-After up to 6 h), its wall end in `/data`; the wall clock serves
  only `/data` and the calendar month (UTC) of the limit.
- **/data unreadable is not empty**: read again every 10 s, one read at a time,
  never written before it was read; a synthesis waits 2 s for it at most.
- **Config keys and the action key are forever** (`access_key_id`,
  `secret_access_key`, `region`, `engine`, `voice_fr|en|de`,
  `default_language`, `speaking_rate`, `monthly_character_limit`,
  `test_voice`): users store their values.
- **The container rootfs is read-only.** Write only under `/data`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (the SDK tests talk to a local
  server on 127.0.0.1).
