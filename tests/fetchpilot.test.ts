import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fetchpilot } from '../dist/index.js';

test('success: parses json automatically', async () => {
  const mock = async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const res = await fetchpilot<{ ok: boolean }>('http://example.com', { fetch: mock as any });
  assert.equal(res.ok, true);
  assert.equal((res as any).data.ok, true);
});

test('retry: idempotent only and honors Retry-After', async () => {
  let count = 0;
  const mock = async () => {
    count++;
    if (count < 2) {
      return new Response('busy', { status: 429, headers: { 'retry-after': '0.1' } });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const start = Date.now();
  const res = await fetchpilot<{ ok: boolean }>('http://example.com', {
    fetch: mock as any,
    retries: 3,
    timeout: 2000,
    method: 'GET',
  });
  const elapsed = Date.now() - start;
  assert.equal(res.ok, true);
  assert.ok(elapsed >= 90);
});

test('failure: http error produces normalized error', async () => {
  const mock = async () => new Response('nope', { status: 500 });
  const res = await fetchpilot('http://example.com', { fetch: mock as any, retries: 0 });
  assert.equal(res.ok, false);
  assert.equal((res as any).error.type, 'http');
  assert.equal((res as any).status, 500);
});

test('cache: GET requests are cached for TTL', async () => {
  let count = 0;
  const mock = async () => {
    count++;
    return new Response(JSON.stringify({ count }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const url = 'http://example.com/cache';
  const first = await fetchpilot<{ count: number }>(url, { fetch: mock as any, cacheTTL: 200 });
  const second = await fetchpilot<{ count: number }>(url, { fetch: mock as any, cacheTTL: 200 });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal((first as any).data.count, 1);
  assert.equal((second as any).data.count, 1);
});

test('dedupe: concurrent GETs both resolve successfully', async () => {
  const mock = async () => {
    await new Promise((r) => setTimeout(r, 50));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const url = 'http://example.com/dedupe';
  const first = fetchpilot(url, { fetch: mock as any, dedupe: true });
  const second = fetchpilot(url, { fetch: mock as any, dedupe: true });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
});
