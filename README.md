# fetchpilot

A tiny, resilient fetch wrapper with retries, exponential backoff, automatic JSON parsing, typed results, and error normalization. Built for simplicity and high quality.

## Install

```powershell
npm install fetchpilot
```

## Usage

```ts
import { fetchpilot } from 'fetchpilot';

type User = { id: string; name: string };

const res = await fetchpilot<User>('/api/user', {
  retries: { attempts: 3 },
  timeout: 3000,
  validate: (d) => (d && typeof d === 'object' && 'id' in (d as any) ? { ok: true } : { ok: false, message: 'Invalid User' }),
});

if (!res.ok) {
  console.error(res.error.message);
} else {
  console.log(res.data.name);
}
```

### Examples

- Node: `examples/node-basic.mjs`
- Browser: `examples/browser-basic.html`

Run the Node example after building:

```powershell
npm run build
node examples/node-basic.mjs
```

### Customizing retries

```ts
const res = await fetchpilot('/api/data', {
  retries: {
    attempts: 5,
    retryOn: (err) => err.type === 'network' || err.type === 'timeout',
  },
  backoff: { strategy: 'exponential', baseDelay: 200, maxDelay: 5000, jitter: 'full' },
  onRetry: ({ attempt, delay, error }) => console.debug(attempt, delay, error.type),
});
```

## API

- `fetchpilot<T>(input, options?)` → `FetcherResult<T>`

### Options

- `retries`: `number | { attempts?: number; retryOn?: (error, attempt) => boolean }`
- `backoff`: `{ strategy?: 'exponential'|'fixed'; baseDelay?: number; maxDelay?: number; jitter?: 'none'|'full' }`
- `parse`: `'auto'|'json'|'text'|'stream'` (default `'auto'`)
- `timeout`: `number` (ms)
- `headers`, `query`, `body`, `signal`, `onRetry`, `fetch`

### Retry behavior

- Defaults to retrying idempotent methods only (`GET`, `HEAD`, `OPTIONS`).
- Honors `Retry-After` header (seconds or HTTP date) when provided; otherwise uses exponential backoff with jitter.

### Result

Discriminated union:

- Success: `{ ok: true; data: T; status; headers }`
- Failure: `{ ok: false; error: NormalizedError; status?; headers? }`

### Error normalization

`NormalizedError`: `{ type: 'network'|'timeout'|'abort'|'http'|'parse'|'unknown'; message; status?; cause? }`

## Notes

- Uses native `fetch`. In Node 18+, fetch is available globally. For older Node versions, pass a ponyfill via `options.fetch`.
- Minimal, dependency-free, ESM-first.
