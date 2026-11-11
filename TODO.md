# TODO

## Before announcing

- [ ] Test on a real Gladys 5.3+ with a real AWS account: the Test button,
      a "Play a notification" scene action on a Sonos or Cast speaker, a
      refused key, an IAM user without `polly:SynthesizeSpeech`, the neural
      engine with a standard-only voice (the Polly message shown).
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).
- [ ] Store fields left out of the manifest on purpose (Louis' rule):
      keywords `Amazon Polly`, `AWS`, `TTS`, `text-to-speech`, `synthèse
vocale`; no `countries` (worldwide).

## To confirm on a real account (built without one)

- [ ] The error codes Polly really answers for a deleted key, a deactivated
      key, a wrong secret (UnrecognizedClientException /
      InvalidSignatureException expected) and a missing right
      (AccessDeniedException expected).
- [ ] `x-amzn-RequestCharacters` present on the answer (the billed count; the
      text length is kept otherwise).
- [ ] The voice lists against `DescribeVoices` (not called: it needs
      `polly:DescribeVoices`, outside the minimal policy). A voice Polly does
      not know is refused by Polly with a clear message, not billed.
- [ ] The prosody rate with the generative engine (partial SSML support).
- [ ] The error a valid key gets in an opt-in region not enabled on the
      account (eu-central-2, eu-south-2, af-south-1): UnrecognizedClientException
      or InvalidClientTokenId expected, taken as a refusal in that region only.

## Later

- More languages than the three of the Gladys interface (Spanish, Italian...),
  if Gladys starts sending them.
- Lexicons (`LexiconNames`) for names Polly mispronounces.
- Optional temporary credentials (session token) or a role.

## Decisions

- **0.1.0 set by hand** in package.json, package-lock.json and the manifest
  (`docker_image` `ghcr.io/lm1lc3n7/gladys-amazon-polly:0.1.0`); the Release
  workflow takes over afterwards.
- **`gladys_version: ">=5.3.0"`**: the `tts` type arrived with Gladys 5.3.0
  (core commit 0027571e, first tag v5.3.0), not 5.1.0.
- **Official AWS SDK** (`@aws-sdk/client-polly` 3.1166.0, Apache-2.0) rather
  than a hand-made SigV4 signature; `@smithy/node-http-handler` declared
  directly because the Polly client defaults to an HTTP/2 handler (for its
  bidirectional stream), and SynthesizeSpeech is plain HTTP/1.1 with our own
  connection and request timeouts.
- **No retry anywhere** (`maxAttempts: 1`): a retried synthesis may be billed
  twice and the answer must fit the 30 s of Gladys (25 s budget).
- **The monthly limit is a local guard**, not an AWS one (Polly has no
  per-key spending cap): counted before the request leaves, refunded when
  AWS answered an error (not billed) or the connection never opened, kept on
  a timeout or a cut connection (maybe billed). The docs advise an AWS
  Budgets alert as well.
- **No call at start-up or on a schedule**: the keys are checked by the first
  announcement or the Test button (DescribeVoices would be free but needs a
  right outside the minimal policy). The status says "Ready", not
  "Connected to AWS".
- **Refused keys**: 8 bits of an HMAC-SHA-256 under a random salt in `/data`
  (never the keys; the full hash of the refused keys stays in memory only).
  After a restart, other keys collide with probability 1/256; the Test
  button, which always sends, clears it.
- **Pause**: 60 s doubled up to 1 h (inside the 60 s-6 h rule), a
  `Retry-After` honored up to 6 h; on every path, the Test button included.
- **Cache**: 20 clips, 20 MB of base64, 24 h, in memory only: a recurring
  announcement ("The door is open") is billed once a day at most. Identical
  requests at the same moment (the core runs the actions of a scene column
  in parallel, one getSpeechUrl per speaker) share the request in flight,
  its answer or its failure (review r1).
- **Refusal tied to the region** (review r1): the fingerprint covers the
  keys and the region, since an opt-in region not enabled answers like an
  unknown key.
- **/data never blocks a synthesis** (decision of the coordinator, review
  r2, to be confirmed by Louis): the count is kept
  and checked in memory before every request; the write (temporary file,
  fsync, rename, fsync of the directory) is awaited 1 s at most, then the
  request leaves anyway. /data unread, read-only or slow: the status says
  the monthly counter is not saved and the limit is only guaranteed until
  the next restart. A crash at the wrong moment may lose one request's
  count: a fraction of a cent, against a broken alarm.
- **Polly's 400 messages** are cut at the first quote (AWS quotes the values received; the private
  text may hold apostrophes, review r2), so are shown without their quoted values (AWS quotes
  the value received, which may be the private text).
- **Voices**: one select per Gladys language (fr, en, de) from the Polly
  documentation, labelled "not standard" when the voice has no standard
  engine; the engine/voice pair is not checked locally (Polly refuses it with
  a clear ValidationException, not billed).
- **No categories beyond `assistants`** (the spec of the `tts` type).
