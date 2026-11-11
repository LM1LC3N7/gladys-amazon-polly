// -----------------------------------------------------------------------------
// src/polly.js with the REAL AWS SDK against a local HTTP server playing
// Amazon Polly (restJson1: errors named by the x-amzn-ErrorType header): the
// request sent, the error classes, the bounds on the answer.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PollyError, classify, createPolly, redact } from '../src/polly.js';
import { KEY_ID, SECRET } from './helpers/app.js';

/** A Polly on 127.0.0.1: `handler(req, body, res)`; `requests` records each one. */
async function fakePollyServer(handler) {
  const srv = { requests: [], sockets: new Set() };
  srv.server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      srv.requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, body, res);
    });
  });
  srv.server.on('connection', (s) => {
    srv.sockets.add(s);
    s.on('close', () => srv.sockets.delete(s));
  });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  srv.url = `http://127.0.0.1:${srv.server.address().port}`;
  srv.close = () => {
    for (const s of srv.sockets) s.destroy();
    return new Promise((resolve) => srv.server.close(resolve));
  };
  return srv;
}

const awsError = (res, status, type, message, headers = {}) => {
  res.writeHead(status, {
    'content-type': 'application/json',
    'x-amzn-errortype': `${type}:http://internal.amazon.com/coral/com.amazon.coral.service/`,
    ...headers,
  });
  res.end(JSON.stringify({ message }));
};

function clientFor(srv) {
  return createPolly({
    region: 'eu-west-1',
    accessKeyId: KEY_ID,
    secretAccessKey: SECRET,
    endpoint: srv.url,
    userAgent: 'gladys-amazon-polly/0.1.0',
  });
}

const request = (signal = AbortSignal.timeout(10_000)) => ({
  text: 'Bonjour',
  ssml: false,
  voice: 'Lea',
  engine: 'standard',
  signal,
});

test('one signed SynthesizeSpeech request; the MP3 and the billed characters back', async (t) => {
  const srv = await fakePollyServer((req, body, res) => {
    res.writeHead(200, { 'content-type': 'audio/mpeg', 'x-amzn-requestcharacters': '7' });
    res.end(Buffer.from('ID3-audio'));
  });
  const polly = clientFor(srv);
  t.after(async () => {
    polly.destroy();
    await srv.close();
  });
  const out = await polly.synthesize(request());
  assert.equal(out.audio.toString(), 'ID3-audio');
  assert.equal(out.characters, 7);
  const [req] = srv.requests;
  assert.equal(req.method, 'POST');
  assert.equal(req.url, '/v1/speech');
  assert.deepEqual(JSON.parse(req.body), {
    Engine: 'standard',
    OutputFormat: 'mp3',
    Text: 'Bonjour',
    TextType: 'text',
    VoiceId: 'Lea',
  });
  // Signed with the key ID (SigV4 scope), the secret never on the wire.
  assert.match(req.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\//);
  assert.match(req.headers.authorization, /\/eu-west-1\/polly\/aws4_request/);
  assert.ok(!JSON.stringify(req).includes(SECRET));
  assert.match(req.headers['user-agent'] + req.headers['x-amz-user-agent'], /gladys-amazon-polly/);
});

test('the AWS errors, classified; only a refused key is a refusal', async (t) => {
  const answers = [
    [
      403,
      'UnrecognizedClientException',
      'The security token included in the request is invalid.',
      'refused',
    ],
    [
      403,
      'InvalidSignatureException',
      'The request signature we calculated does not match.',
      'refused',
    ],
    [
      403,
      'InvalidSignatureException',
      'Signature expired: 20261111T100000Z is now earlier than...',
      'clock',
    ],
    [
      403,
      'AccessDeniedException',
      'User is not authorized to perform: polly:SynthesizeSpeech',
      'denied',
    ],
    [403, 'SomethingNewException', 'Forbidden', 'denied'],
    [401, 'Whatever', 'Unauthorized', 'denied'],
    [400, 'ThrottlingException', 'Rate exceeded', 'throttled'],
    [429, 'TooManyRequests', 'Slow down', 'throttled'],
    [500, 'ServiceFailureException', 'Internal', 'unavailable'],
    [503, 'ServiceUnavailable', 'Unavailable', 'unavailable'],
    [
      400,
      'ValidationException',
      'This voice does not support the selected engine: neural',
      'invalid',
    ],
    [400, 'TextLengthExceededException', 'Too long', 'invalid'],
    [400, 'ValidationException', `Key ${KEY_ID} or ${SECRET} is wrong\r\nX: y`, 'invalid'],
  ];
  let i = 0;
  const srv = await fakePollyServer((req, body, res) => {
    const [status, type, message] = answers[i];
    awsError(
      res,
      status,
      type,
      message,
      type === 'ThrottlingException' ? { 'retry-after': '120' } : {},
    );
  });
  const polly = clientFor(srv);
  t.after(async () => {
    polly.destroy();
    await srv.close();
  });
  for (; i < answers.length; i += 1) {
    const [status, type, , kind] = answers[i];
    const err = await polly.synthesize(request()).then(
      () => assert.fail('resolved'),
      (e) => e,
    );
    assert.ok(err instanceof PollyError, type);
    assert.equal(err.kind, kind, `${status} ${type}`);
    assert.equal(err.status, status);
    if (type === 'ThrottlingException') assert.equal(err.retryAfterMs, 120_000);
    if (kind === 'invalid') {
      assert.ok(!err.detail.includes(KEY_ID) && !err.detail.includes(SECRET), err.detail);
      assert.ok(!/[\r\n]/.test(err.detail));
    }
    if (kind === 'invalid' && type === 'ValidationException' && i === 10) {
      assert.match(err.detail, /does not support the selected engine/);
    }
  }
  // No retry inside the SDK: one request per call (a retry may be billed twice).
  assert.equal(srv.requests.length, answers.length);
});

test('an answer too large is cut at 5 MB; not MP3 or empty is refused', async (t) => {
  let mode = 'huge';
  const srv = await fakePollyServer((req, body, res) => {
    if (mode === 'huge') {
      res.writeHead(200, { 'content-type': 'audio/mpeg' });
      const chunk = Buffer.alloc(256 * 1024, 1);
      let sent = 0;
      const pump = () => {
        while (sent < 64 * 1024 * 1024) {
          sent += chunk.length;
          if (!res.write(chunk)) return res.once('drain', pump);
        }
        res.end();
      };
      res.on('close', () => (srv.sentBeforeClose = sent));
      pump();
    } else if (mode === 'json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"not":"audio"}');
    } else {
      res.writeHead(200, { 'content-type': 'audio/mpeg' });
      res.end();
    }
  });
  const polly = clientFor(srv);
  t.after(async () => {
    polly.destroy();
    await srv.close();
  });
  let err = await polly.synthesize(request()).catch((e) => e);
  assert.equal(err.kind, 'too_large');
  // The read stopped: the server never wrote the 64 MB.
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok((srv.sentBeforeClose ?? 0) < 32 * 1024 * 1024, `${srv.sentBeforeClose}`);
  mode = 'json';
  err = await polly.synthesize(request()).catch((e) => e);
  assert.equal(err.kind, 'bad_answer');
  mode = 'empty';
  err = await polly.synthesize(request()).catch((e) => e);
  assert.equal(err.kind, 'bad_answer');
});

test('a silent Polly is aborted by the signal; a refused connection was never sent', async (t) => {
  const srv = await fakePollyServer(() => {}); // never answers
  const polly = clientFor(srv);
  t.after(async () => {
    polly.destroy();
    await srv.close();
  });
  const started = performance.now();
  const err = await polly.synthesize(request(AbortSignal.timeout(300))).catch((e) => e);
  assert.equal(err.kind, 'timeout');
  assert.ok(performance.now() - started < 5000);

  // A body that stalls after the headers is cut too.
  const stall = await fakePollyServer((req, body, res) => {
    res.writeHead(200, { 'content-type': 'audio/mpeg' });
    res.write(Buffer.from('ID3'));
  });
  const stalled = clientFor(stall);
  t.after(async () => {
    stalled.destroy();
    await stall.close();
  });
  const cut = await stalled.synthesize(request(AbortSignal.timeout(300))).catch((e) => e);
  assert.equal(cut.kind, 'timeout');

  const closed = await fakePollyServer(() => {});
  const url = closed.url;
  await closed.close();
  const refused = createPolly({
    region: 'eu-west-1',
    accessKeyId: KEY_ID,
    secretAccessKey: SECRET,
    endpoint: url,
    userAgent: 'x',
  });
  t.after(() => refused.destroy());
  const net = await refused.synthesize(request()).catch((e) => e);
  assert.equal(net.kind, 'network');
  assert.equal(net.sent, false);
});

test('classify: a cut connection is not a timeout and was sent; quoted values never shown', () => {
  const cut = classify(
    Object.assign(new Error('socket hang up'), { name: 'TimeoutError', code: 'ECONNRESET' }),
  );
  assert.equal(cut.kind, 'network');
  assert.equal(cut.sent, true);
  const reset = classify(Object.assign(new Error('reset'), { code: 'EHOSTUNREACH' }));
  assert.equal(reset.sent, false);
  // Any other error without an answer may have left: counted as sent.
  const other = classify(Object.assign(new Error('aborted'), { code: 'ECONNABORTED' }));
  assert.equal(other.kind, 'network');
  assert.equal(other.sent, true);
  const quoted = classify(
    Object.assign(new Error("1 validation error: Value 'my private text' at 'text' failed"), {
      name: 'ValidationException',
      $metadata: { httpStatusCode: 400 },
    }),
  );
  assert.equal(quoted.kind, 'invalid');
  assert.ok(!quoted.detail.includes('private'), quoted.detail);
  // An odd number of apostrophes (French text): nothing of the text either.
  const odd = classify(
    Object.assign(
      new Error("Value 'Code d'entrée 4512 de Marie' at 'text' failed to satisfy constraint"),
      { name: 'ValidationException', $metadata: { httpStatusCode: 400 } },
    ),
  );
  for (const part of ['Code', 'entrée', '4512', 'Marie', 'text']) {
    assert.ok(!odd.detail.includes(part), odd.detail);
  }
  assert.match(odd.detail, /^Value …$/);
});

test('a connection cut after the request is sent: one request, network, sent', async (t) => {
  const srv = await fakePollyServer((req) => req.socket.destroy());
  const polly = clientFor(srv);
  t.after(async () => {
    polly.destroy();
    await srv.close();
  });
  const err = await polly.synthesize(request()).catch((e) => e);
  assert.equal(err.kind, 'network');
  assert.equal(err.sent, true);
  assert.equal(srv.requests.length, 1);
});

test('redact: no key ID, no given secret, no control character, 200 characters at most', () => {
  const text = `bad AKIAIOSFODNN7EXAMPLE and ${SECRET}\r\nInjected: yes ${'x'.repeat(500)}`;
  const out = redact(text, [KEY_ID, SECRET]);
  assert.ok(!out.includes(KEY_ID) && !out.includes(SECRET));
  assert.ok(!/[\r\n]/.test(out));
  assert.equal(out.length, 200);
  // classify never puts Polly's message of a refusal in the detail.
  const err = classify(
    Object.assign(new Error(`key ${KEY_ID} unknown`), {
      name: 'UnrecognizedClientException',
      $metadata: { httpStatusCode: 403 },
    }),
  );
  assert.equal(err.kind, 'refused');
  assert.equal(err.detail, undefined);
  assert.ok(!err.message.includes(KEY_ID));
});
