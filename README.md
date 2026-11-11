# Amazon Polly for Gladys Assistant

Unofficial [Gladys Assistant](https://gladysassistant.com) integration, not
affiliated with Amazon: a **text-to-speech provider** (manifest type `tts`)
that speaks the Gladys announcements with the voices of **Amazon Polly**,
billed to your own AWS account.

- French, English and German voices, one per language; the **standard**
  engine by default (the cheapest), neural, generative or long-form on demand;
- a monthly character limit kept in `/data`, the same text in the same voice
  replayed from memory, no retry that could be billed twice;
- an IAM user allowed only `polly:SynthesizeSpeech` (policy in the docs).

Needs Gladys 5.3.0 or later. Never tested with a real AWS account yet.

Documentation: [English](docs/en.md) · [Français](docs/fr.md).

## Development

```bash
npm install
npm test            # node --test
npm run lint
npm run format:check
npm run mutants     # mutation check of the guards (scripts/mutants.json), with memcap
npm run cover       # regenerates cover.png
```

Rules for contributors and coding assistants: [CLAUDE.md](CLAUDE.md).
Open points and decisions: [TODO.md](TODO.md).

## Credits and license

Apache-2.0 ([LICENSE](LICENSE)). Amazon Polly is reached through the AWS SDK
for JavaScript v3 (Apache-2.0): see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
