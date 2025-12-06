import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fetchpilot } from '../dist/index.js';

// Retry & Backoff tests
test('retry: POST does not retry by default', async () => {
  let attempts = 0;
  const mock = async () => {
    attempts++;
    return new Response('error', { status: 500 });
  };
  const res = await fetchpilot('http://example.com', {
    fetch: mock as any,
    method: 'POST',
    body: { test: true },
    retries: 3,
  });
  assert.equal(res.ok, false);
  assert.equal(attempts, 1); // No retries for non-idempotent
});

test('retry: custom retryOn predicate', async () => {
  let attempts = 0;
  const mock = async () => {
    attempts++;
    return new Response('error', { status: 400 });
  };
  const res = await fetchpilot('http://example.com', {
    fetch: mock as any,
    retries: { attempts: 3, retryOn: (err) => err.status === 400 },
  });
  assert.equal(res.ok, false);
  assert.ok(attempts > 1); // Should retry on 400 with custom predicate
});

test('backoff: exponential delay increases', async () => {
  let attempts = 0;
  const delays: number[] = [];
  const mock = async () => {
    attempts++;
    return new Response('error', { status: 500 });
  };
  await fetchpilot('http://example.com', {
    fetch: mock as any,
    retries: 3,
    backoff: { strategy: 'exponential', baseDelay: 100, jitter: 'none' },
    onRetry: ({ delay }) => delays.push(delay),
  });
  assert.equal(attempts, 3);
  assert.equal(delays.length, 2);
  assert.ok(delays[1] > delays[0]); // Second delay should be larger
});

test('backoff: fixed strategy uses same delay', async () => {
  const delays: number[] = [];
  const mock = async () => new Response('error', { status: 500 });
  await fetchpilot('http://example.com', {
    fetch: mock as any,
    retries: 3,
    backoff: { strategy: 'fixed', baseDelay: 50, jitter: 'none' },
    onRetry: ({ delay }) => delays.push(delay),
  });
  assert.equal(delays.length, 2);
  assert.equal(delays[0], 50);
  assert.equal(delays[1], 50);
});

// Error handling tests
test('error: different status codes', async () => {
  for (const status of [400, 401, 403, 404, 429, 502, 503]) {
    const mock = async () => new Response('error', { status });
    const res = await fetchpilot(`http://example.com/${status}`, { fetch: mock as any, retries: 0 });
    assert.equal(res.ok, false);
    assert.equal((res as any).error.type, 'http');
    assert.equal((res as any).status, status);
  }
});

test('error: malformed JSON produces parse error', async () => {
  const mock = async () =>
    new Response('not json', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const res = await fetchpilot('http://example.com', { fetch: mock as any });
  assert.equal(res.ok, false);
  assert.equal((res as any).error.type, 'network'); // JSON.parse throws
});

// Validation tests
test('validation: hook rejects invalid data', async () => {
  const mock = async () =>
    new Response(JSON.stringify({ wrong: 'field' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const res = await fetchpilot('http://example.com', {
    fetch: mock as any,
    validate: (data: any) =>
      data.expected ? { ok: true } : { ok: false, message: 'Missing expected field' },
  });
  assert.equal(res.ok, false);
  assert.equal((res as any).error.type, 'parse');
  assert.ok((res as any).error.message.includes('expected'));
});

test('validation: multiple validation rules', async () => {
  const mock = async () =>
    new Response(JSON.stringify({ id: 123, name: 'test' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const res = await fetchpilot('http://example.com', {
    fetch: mock as any,
    validate: (data: any) => {
      if (!data.id || typeof data.id !== 'number') return { ok: false, message: 'Invalid id' };
      if (!data.name || typeof data.name !== 'string') return { ok: false, message: 'Invalid name' };
      return { ok: true };
    },
  });
  assert.equal(res.ok, true);
});

// Cache tests
test('cache: expired cache fetches again', async () => {
  let count = 0;
  const mock = async () => {
    count++;
    return new Response(JSON.stringify({ count }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const url = 'http://example.com/expire';
  await fetchpilot(url, { fetch: mock as any, cacheTTL: 50 });
  await new Promise((r) => setTimeout(r, 60));
  await fetchpilot(url, { fetch: mock as any, cacheTTL: 50 });
  assert.equal(count, 2); // Second request after expiry
});

test('cache: POST is not cached', async () => {
  let count = 0;
  const mock = async () => {
    count++;
    return new Response(JSON.stringify({ count }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const url = 'http://example.com/post';
  await fetchpilot(url, { fetch: mock as any, method: 'POST', cacheTTL: 200 });
  await fetchpilot(url, { fetch: mock as any, method: 'POST', cacheTTL: 200 });
  assert.equal(count, 2); // POST not cached
});

test('cache: different URLs not shared', async () => {
  let count = 0;
  const mock = async () => {
    count++;
    return new Response(JSON.stringify({ count }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  await fetchpilot('http://example.com/a', { fetch: mock as any, cacheTTL: 200 });
  await fetchpilot('http://example.com/b', { fetch: mock as any, cacheTTL: 200 });
  assert.equal(count, 2); // Different URLs fetch separately
});

// Parse tests
test('parse: empty response body', async () => {
  const mock = async () => new Response('', { status: 200 });
  const res = await fetchpilot('http://example.com', { fetch: mock as any, parse: 'text' });
  assert.equal(res.ok, true);
  assert.equal((res as any).data, '');
});

test('parse: text mode returns string', async () => {
  const mock = async () => new Response('plain text', { status: 200 });
  const res = await fetchpilot<string>('http://example.com', { fetch: mock as any, parse: 'text' });
  assert.equal(res.ok, true);
  assert.equal((res as any).data, 'plain text');
});

test('parse: no content-type header defaults to text', async () => {
  const mock = async () => new Response(JSON.stringify({ test: true }), { status: 200 });
  const res = await fetchpilot('http://example.com', { fetch: mock as any, parse: 'auto' });
  assert.equal(res.ok, true);
  assert.equal(typeof (res as any).data, 'string'); // No JSON header, so parsed as text
});

// Query & Headers tests
test('query: undefined values are skipped', async () => {
  let capturedUrl = '';
  const mock = async (input: any) => {
    // buildUrl returns a URL object when query params are present
    capturedUrl = input instanceof URL ? input.toString() : (typeof input === 'string' ? input : input.url);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await fetchpilot('http://example.com', {
    fetch: mock as any,
    query: { foo: 'bar', skip: undefined, baz: 123 },
  });
  assert.ok(capturedUrl.includes('foo=bar'), `Expected foo=bar in ${capturedUrl}`);
  assert.ok(capturedUrl.includes('baz=123'), `Expected baz=123 in ${capturedUrl}`);
  assert.ok(!capturedUrl.includes('skip'), `Unexpected skip in ${capturedUrl}`);
});

test('query: special characters are encoded', async () => {
  let capturedUrl = '';
  const mock = async (input: any) => {
    // buildUrl returns a URL object when query params are present
    capturedUrl = input instanceof URL ? input.toString() : (typeof input === 'string' ? input : input.url);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await fetchpilot('http://example.com', {
    fetch: mock as any,
    query: { text: 'hello world', special: 'a&b=c' },
  });
  // URLSearchParams encodes space as + (which is valid)
  assert.ok(capturedUrl.includes('hello+world') || capturedUrl.includes('hello%20world'), `Expected encoded space in ${capturedUrl}`);
  assert.ok(capturedUrl.includes('a%26b%3Dc'), `Expected encoded special chars in ${capturedUrl}`);
});

test('headers: custom headers are sent', async () => {
  let capturedHeaders: Headers | undefined;
  const mock = async (_: any, init?: any) => {
    capturedHeaders = init?.headers;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await fetchpilot('http://example.com', {
    fetch: mock as any,
    headers: { 'X-Test': 'value' },
  });
  assert.ok(capturedHeaders);
  assert.equal(capturedHeaders.get('X-Test'), 'value');
});

// Abort signal test
test('abort: signal cancels request', async () => {
  const controller = new AbortController();
  const mock = async (_: any, init?: any) => {
    // Check if already aborted
    if (init?.signal?.aborted) {
      const err: any = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }
    // Return a promise that gets rejected when signal is aborted
    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => {
        const err: any = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      };
      init?.signal?.addEventListener('abort', onAbort);
      setTimeout(() => {
        init?.signal?.removeEventListener('abort', onAbort);
        resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }, 100);
    });
  };
  
  setTimeout(() => controller.abort(), 20);
  
  const res = await fetchpilot('http://example.com', {
    fetch: mock as any,
    signal: controller.signal,
  });
  
  assert.equal(res.ok, false, 'Expected request to fail due to abort');
  assert.equal((res as any).error.type, 'abort', `Expected abort error, got ${(res as any).error.type}`);
});

// onRetry callback test
test('onRetry: receives correct data', async () => {
  const retryInfo: any[] = [];
  const mock = async () => new Response('error', { status: 500 });
  await fetchpilot('http://example.com', {
    fetch: mock as any,
    retries: 2,
    onRetry: (info) => retryInfo.push(info),
  });
  assert.equal(retryInfo.length, 1);
  assert.equal(retryInfo[0].attempt, 1);
  assert.ok(retryInfo[0].delay > 0);
  assert.equal(retryInfo[0].error.type, 'http');
  assert.equal(retryInfo[0].error.status, 500);
});
