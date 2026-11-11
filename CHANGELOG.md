# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First version: Amazon Polly as the text-to-speech provider of Gladys (type
  `tts`, Gladys 5.3.0+), with the user's own AWS keys (IAM user allowed only
  `polly:SynthesizeSpeech`).
- One voice per language (French, English, German) and one for an unknown
  language; standard engine by default, neural, generative or long-form;
  speaking rate; AWS region.
- Cost guards: monthly character limit kept in `/data`, clips replayed from
  memory for the same text and voice, no retry, at most 2 requests at once.
- Refused keys never sent again until they change or the Test button
  succeeds; a pause after a throttling or a server error (60 s doubled up to
  1 h, `Retry-After` up to 6 h), kept across a restart.
- "Test the voice" button.
