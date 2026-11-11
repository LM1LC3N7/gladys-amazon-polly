# Amazon Polly

Gives Gladys the voices of **Amazon Polly** for its announcements (the "Play a notification" scene action) and
the voice assistant reply, with **your own AWS account**. Unofficial: not affiliated with Amazon.

This integration has never been tested with a real AWS account yet: it was built from the Amazon Polly
documentation and tested against a local imitation of the Polly API.

## What it does

Gladys sends a text (2,000 characters at most) and the language of the user. The integration picks the voice
you chose for that language (French, English or German; the "Language when unknown" voice otherwise), asks
Amazon Polly for an MP3 clip and hands it to Gladys, which plays it on your speakers.

Then, in Gladys, open **Integrations → Artificial Intelligence**, card **Voice**, and select **Amazon Polly**.

Limits of Gladys itself (not of this integration): the clip is served to speakers on your local network, and the
voice assistant reply stays in text in an HTTPS page (see the Gladys documentation).

## What it costs

Amazon Polly is billed per character sent, on your AWS account (prices on
[aws.amazon.com/polly/pricing](https://aws.amazon.com/polly/pricing/), November 2026: about 4 USD per million
characters with the **standard** engine, about 16 USD with **neural**, more with generative and long-form; new
accounts get a free allowance during their first year). The standard engine is the default.

To keep the bill under control:

- **Monthly limit** (default 1,000,000 characters): counted and written to `/data` before each request leaves (1 s at most);
  once reached, nothing more is sent until the next calendar month (UTC) or a higher limit. A request that may
  have been billed (no answer, connection cut) stays counted; a request AWS answered with an error is not.
  If `/data` cannot be read, the count starts from what was sent since the start and is merged once `/data`
  is readable again; the status says so meanwhile (the pause and a refusal kept there are not known either).
- The same text in the same voice is played again from memory (24 hours, 20 clips), not billed twice; asked
  several times at once (a scene announcing on several speakers), it makes one request whose answer all share.
- At most 2 requests at once and 8 waiting; more at the same moment are refused ("Too many announcements").
- No retry: a failed request is not sent again by the integration (a retry could be billed twice).

## Create the AWS key (minimal rights)

1. In the AWS console, **IAM → Users → Create user** (no console access).
2. Attach this policy only (it allows the synthesis, nothing else):

```json
{
  "Version": "2012-10-17",
  "Statement": [{ "Effect": "Allow", "Action": "polly:SynthesizeSpeech", "Resource": "*" }]
}
```

3. **Security credentials → Create access key** ("Application running outside AWS"). Copy the access key ID
   (`AKIA…`) and the secret access key (shown once).
4. Optionally, set an **AWS Budget** alert on your account: it is the only limit AWS enforces on its side.

## Configuration

| Field                           | What it does                                                                                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access key ID                   | The `AKIA…` identifier of the IAM user.                                                                                                                              |
| Secret access key               | Kept by Gladys in its database, never shown again, sent only to Amazon Web Services: it signs each request; only the signature travels, not the key itself.          |
| AWS region                      | Where Polly runs (default `eu-west-1`, Ireland). Not every engine exists in every region.                                                                            |
| Voice engine                    | `standard` (default, cheapest), `neural`, `generative`, `long-form`.                                                                                                 |
| French / English / German voice | The voice for each language. Voices marked "not standard" need the neural engine or a newer one: Polly refuses them with the standard engine, and the error says so. |
| Language when unknown           | The voice used when Gladys sends no language or another one.                                                                                                         |
| Speaking rate                   | Very slow to very fast (SSML `prosody`; the tags are not billed).                                                                                                    |
| Monthly limit (characters)      | 1,000 to 100,000,000; default 1,000,000.                                                                                                                             |

The **Test the voice** button asks Polly for a short sentence (about 50 billed characters) with the saved
settings and says how long it took. Nothing is played.

## When something goes wrong

The status of the Configuration screen says why:

- **AWS refused these keys** (unknown, deleted or deactivated key, wrong secret, or a region not enabled on
  the account, such as eu-south-2 or af-south-1): nothing more is sent with them in that region, even after a restart (once `/data` is read), until you enter other keys, choose another region, or the **Test** button succeeds (it sends anyway).
  `/data` keeps only 8 bits of a salted hash of the refused keys, never the keys: after a restart, other keys
  have 1 chance in 256 to look refused; the Test button then clears it.
- **Denied** (`AccessDeniedException`): the keys are valid but the IAM user lacks `polly:SynthesizeSpeech`.
  This is not a refusal of the keys: the next announcement tries again.
- **Clock**: AWS rejected the time of the request; check the clock of the Gladys host.
- **Slow down / Polly failed** (throttling, HTTP 429 or 5xx): no request for 60 s, then 2, 4… minutes up to
  1 hour if it goes on (longer when AWS asks for it with `Retry-After`, 6 hours at most); the Test button waits
  too. The pause is kept in `/data` across a restart; a success ends it.
- **Polly refused the request**: its reason is shown (for example "This voice does not support the selected
  engine"), without the values it quotes (your text could be one); nothing is billed.
- **Could not be reached, or the connection was cut**: a cut after the request left stays counted.
- **Did not answer in time**: Gladys waits 30 s; the integration gives up at 25 s.

## Privacy

The text to speak is sent to Amazon Web Services in the region you chose. The integration never writes it to
the logs or to `/data` (only its length); the clips stay in memory only.
