import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fetchpilot } from '../dist/index.js';

// E2E tests using real HTTP endpoints
test('e2e: successful GET with JSON parsing from httpbin', async () => {
  const res = await fetchpilot<{ slideshow: any }>('https://httpbin.org/json', {
    retries: 2,
    timeout: 5000,
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.ok(res.data.slideshow);
    assert.equal(res.status, 200);
  }
});

test('e2e: retry on 500 status with idempotent method', async () => {
  let attempts = 0;
  const res = await fetchpilot('https://httpbin.org/status/500', {
    retries: 2,
    method: 'GET',
    onRetry: () => { attempts++; },
    timeout: 5000,
  });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.type, 'http');
    assert.equal(res.status, 500);
    assert.ok(attempts > 0, 'Should have retried at least once');
  }
});

test('e2e: POST with JSON body to httpbin echo', async () => {
  const payload = { name: 'fetchpilot', version: '0.1.0' };
  const res = await fetchpilot<{ json: typeof payload }>('https://httpbin.org/post', {
    method: 'POST',
    body: payload,
    timeout: 5000,
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.deepEqual(res.data.json, payload);
  }
});

test('e2e: timeout handling', async () => {
  const res = await fetchpilot('https://httpbin.org/delay/10', {
    timeout: 1000,
    retries: 0,
  });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.ok(['abort', 'timeout', 'network'].includes(res.error.type));
  }
});

test('e2e: validation hook rejects invalid data', async () => {
  const res = await fetchpilot('https://httpbin.org/json', {
    validate: (data) => {
      if (typeof data === 'object' && data && 'invalidField' in data) {
        return { ok: true };
      }
      return { ok: false, message: 'Missing required field' };
    },
    timeout: 5000,
  });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.type, 'parse');
    assert.ok(res.error.message.includes('required field'));
  }
});

test('e2e: custom headers are sent', async () => {
  const res = await fetchpilot<{ headers: Record<string, string> }>('https://httpbin.org/headers', {
    headers: { 'X-Custom-Header': 'test-value' },
    timeout: 5000,
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.data.headers['X-Custom-Header'], 'test-value');
  }
});

test('e2e: query parameters are appended', async () => {
  const res = await fetchpilot<{ args: Record<string, string> }>('https://httpbin.org/get', {
    query: { foo: 'bar', baz: 123 },
    timeout: 5000,
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.data.args.foo, 'bar');
    assert.equal(res.data.args.baz, '123');
  }
});
