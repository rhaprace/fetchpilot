import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fetchpilot } from '../dist/index.js';

// Jitter tests
test('backoff: full jitter produces varied delays', async () => {
  const delays: number[] = [];
  const mock = async () => new Response('error', { status: 500 });
  await fetchpilot('http://example.com', {
    fetch: mock as any,
    retries: 5,
    backoff: { strategy: 'exponential', baseDelay: 100, jitter: 'full' },
    onRetry: ({ delay }) => delays.push(delay),
  });
  // With full jitter, delays should vary (not all identical)
  const allSame = delays.every(d => d === delays[0]);
  assert.equal(allSame, false, 'Full jitter should produce varied delays');
});

test('backoff: none jitter produces consistent delays', async () => {
  const delays: number[] = [];
  const mock = async () => new Response('error', { status: 500 });
  await fetchpilot('http://example.com', {
    fetch: mock as any,
    retries: 3,
    backoff: { strategy: 'fixed', baseDelay: 50, jitter: 'none' },
    onRetry: ({ delay }) => delays.push(delay),
  });
  assert.ok(delays.every(d => d === 50), 'No jitter should produce identical delays');
});

// Max delay cap
test('backoff: maxDelay caps exponential growth', async () => {
  const delays: number[] = [];
  const mock = async () => new Response('error', { status: 500 });
  await fetchpilot('http://example.com', {
    fetch: mock as any,
    retries: 10,
    backoff: { strategy: 'exponential', baseDelay: 100, maxDelay: 500, jitter: 'none' },
    onRetry: ({ delay }) => delays.push(delay),
  });
  // All delays should be <= 500ms
  assert.ok(delays.every(d => d <= 500), `Expected all delays <= 500, got ${delays}`);
  // Later delays should hit the cap
  assert.ok(delays[delays.length - 1] === 500, 'Last delay should be at maxDelay');
});

// Retry attempt counting
test('retry: exact attempt numbers passed to onRetry', async () => {
  const attempts: number[] = [];
  const mock = async () => new Response('error', { status: 500 });
  await fetchpilot('http://example.com', {
    fetch: mock as any,
    retries: 4,
    onRetry: ({ attempt }) => attempts.push(attempt),
  });
  assert.deepEqual(attempts, [1, 2, 3], 'Retry attempts should be 1, 2, 3 for 4 total attempts');
});

// Deduplication edge cases
test('dedupe: concurrent requests with different headers fetch separately', async () => {
  let count = 0;
  const mock = async () => {
    count++;
    await new Promise(r => setTimeout(r, 50));
    return new Response(JSON.stringify({ count }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const url = 'http://example.com/dedupe';
  const [res1, res2] = await Promise.all([
    fetchpilot(url, { fetch: mock as any, dedupe: true, headers: { 'X-A': '1' } }),
    fetchpilot(url, { fetch: mock as any, dedupe: true, headers: { 'X-B': '2' } }),
  ]);
  // Different headers = different cache keys = 2 requests
  assert.equal(count, 2);
});

// Cache collision prevention
test('cache: same URL different method not cached together', async () => {
  let count = 0;
  const mock = async () => {
    count++;
    return new Response(JSON.stringify({ count }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const url = 'http://example.com/cache';
  await fetchpilot(url, { fetch: mock as any, method: 'GET', cacheTTL: 200 });
  await fetchpilot(url, { fetch: mock as any, method: 'HEAD', cacheTTL: 200 });
  // Different methods should not share cache
  assert.equal(count, 2);
});

test('cache: same URL different headers share cache (cache key is method:url)', async () => {
  let count = 0;
  const mock = async () => {
    count++;
    return new Response(JSON.stringify({ count }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const url = 'http://example.com/cache2';
  await fetchpilot(url, { fetch: mock as any, cacheTTL: 200, headers: { 'Authorization': 'token1' } });
  await fetchpilot(url, { fetch: mock as any, cacheTTL: 200, headers: { 'Authorization': 'token2' } });
  // Cache key is method:url (headers not included), so both requests share cache
  assert.equal(count, 1);
});

// Stream parsing
test('parse: stream mode returns ReadableStream', async () => {
  const mock = async () => new Response('stream content', { status: 200 });
  const res = await fetchpilot('http://example.com', { fetch: mock as any, parse: 'stream' });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.ok(res.data !== null, 'Stream should not be null');
  }
});

// Non-standard HTTP methods
test('retry: PUT does not retry by default', async () => {
  let attempts = 0;
  const mock = async () => {
    attempts++;
    return new Response('error', { status: 500 });
  };
  await fetchpilot('http://example.com', {
    fetch: mock as any,
    method: 'PUT',
    retries: 3,
  });
  assert.equal(attempts, 1, 'PUT should not retry (non-idempotent)');
});

test('retry: PATCH does not retry by default', async () => {
  let attempts = 0;
  const mock = async () => {
    attempts++;
    return new Response('error', { status: 500 });
  };
  await fetchpilot('http://example.com', {
    fetch: mock as any,
    method: 'PATCH',
    retries: 3,
  });
  assert.equal(attempts, 1, 'PATCH should not retry (non-idempotent)');
});

test('retry: DELETE does not retry by default (non-idempotent)', async () => {
  let attempts = 0;
  const mock = async () => {
    attempts++;
    return new Response('error', { status: 500 });
  };
  await fetchpilot('http://example.com', {
    fetch: mock as any,
    method: 'DELETE',
    retries: 3,
  });
  assert.equal(attempts, 1, 'DELETE should not retry (treated as non-idempotent)');
});

test('retry: HEAD retries on failure (idempotent)', async () => {
  let attempts = 0;
  const mock = async () => {
    attempts++;
    return new Response('', { status: 500 });
  };
  await fetchpilot('http://example.com', {
    fetch: mock as any,
    method: 'HEAD',
    retries: 3,
  });
  assert.ok(attempts > 1, 'HEAD should retry (idempotent)');
});

test('retry: OPTIONS retries on failure (idempotent)', async () => {
  let attempts = 0;
  const mock = async () => {
    attempts++;
    return new Response('', { status: 500 });
  };
  await fetchpilot('http://example.com', {
    fetch: mock as any,
    method: 'OPTIONS',
    retries: 3,
  });
  assert.ok(attempts > 1, 'OPTIONS should retry (idempotent)');
});

// JSON response variations
test('parse: JSON array response', async () => {
  const mock = async () => new Response(JSON.stringify([1, 2, 3]), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  const res = await fetchpilot<number[]>('http://example.com', { fetch: mock as any });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.deepEqual(res.data, [1, 2, 3]);
  }
});

test('parse: JSON primitive response (number)', async () => {
  const mock = async () => new Response('42', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  const res = await fetchpilot<number>('http://example.com', { fetch: mock as any });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.data, 42);
  }
});

test('parse: JSON primitive response (string)', async () => {
  const mock = async () => new Response('"hello"', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  const res = await fetchpilot<string>('http://example.com', { fetch: mock as any });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.data, 'hello');
  }
});

test('parse: JSON null response', async () => {
  const mock = async () => new Response('null', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  const res = await fetchpilot<null>('http://example.com', { fetch: mock as any });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.data, null);
  }
});

// Query param edge cases
test('query: empty query object does not append question mark', async () => {
  let capturedUrl = '';
  const mock = async (input: any) => {
    capturedUrl = input instanceof URL ? input.toString() : (typeof input === 'string' ? input : input.url);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await fetchpilot('http://example.com/path', {
    fetch: mock as any,
    query: {},
  });
  assert.equal(capturedUrl, 'http://example.com/path', 'Empty query should not modify URL');
});

test('query: all undefined values result in no query string', async () => {
  let capturedUrl = '';
  const mock = async (input: any) => {
    capturedUrl = input instanceof URL ? input.toString() : (typeof input === 'string' ? input : input.url);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await fetchpilot('http://example.com/path', {
    fetch: mock as any,
    query: { a: undefined, b: undefined },
  });
  assert.equal(capturedUrl, 'http://example.com/path', 'All undefined should not append query string');
});

// Response headers
test('headers: successful response includes headers', async () => {
  const mock = async () => new Response(JSON.stringify({ test: true }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-custom': 'value' },
  });
  const res = await fetchpilot('http://example.com', { fetch: mock as any });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.ok(res.headers instanceof Headers);
    assert.equal(res.headers.get('x-custom'), 'value');
  }
});

test('headers: failed response includes headers', async () => {
  const mock = async () => new Response('error', {
    status: 404,
    headers: { 'x-error-id': '12345' },
  });
  const res = await fetchpilot('http://example.com', { fetch: mock as any, retries: 0 });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.ok(res.headers instanceof Headers);
    assert.equal(res.headers.get('x-error-id'), '12345');
  }
});

// Retry-After malformed values
test('retry: malformed Retry-After header ignored', async () => {
  let attempts = 0;
  const delays: number[] = [];
  const mock = async () => {
    attempts++;
    return new Response('error', {
      status: 503,
      headers: { 'retry-after': 'invalid-value' },
    });
  };
  await fetchpilot('http://example.com', {
    fetch: mock as any,
    retries: 2,
    backoff: { baseDelay: 50, jitter: 'none' },
    onRetry: ({ delay }) => delays.push(delay),
  });
  // Should fall back to baseDelay when Retry-After is invalid
  assert.ok(delays[0] >= 50, 'Should use baseDelay when Retry-After is malformed');
});

// Multiple concurrent cache hits
test('cache: multiple concurrent requests share cached result', async () => {
  let fetchCount = 0;
  const mock = async () => {
    fetchCount++;
    return new Response(JSON.stringify({ value: fetchCount }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  
  // First request populates cache
  await fetchpilot('http://example.com/shared', { fetch: mock as any, cacheTTL: 500 });
  
  // Multiple concurrent requests should all use cache
  const results = await Promise.all([
    fetchpilot('http://example.com/shared', { fetch: mock as any, cacheTTL: 500 }),
    fetchpilot('http://example.com/shared', { fetch: mock as any, cacheTTL: 500 }),
    fetchpilot('http://example.com/shared', { fetch: mock as any, cacheTTL: 500 }),
  ]);
  
  // Only 1 fetch should have occurred (the initial one)
  assert.equal(fetchCount, 1, 'Cache should serve all subsequent requests');
  assert.ok(results.every(r => r.ok), 'All requests should succeed');
});

// Network error simulation
test('error: network error produces correct error type', async () => {
  const mock = async () => {
    throw new Error('Failed to fetch');
  };
  const res = await fetchpilot('http://example.com', { fetch: mock as any, retries: 0 });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.type, 'network');
    assert.ok(res.error.message.includes('fetch'));
  }
});

// Timeout edge case
test('timeout: clears timer on successful response', async () => {
  const mock = async () => {
    await new Promise(r => setTimeout(r, 10));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const res = await fetchpilot('http://example.com', {
    fetch: mock as any,
    timeout: 100,
  });
  assert.equal(res.ok, true, 'Should succeed before timeout');
});
