# fetchpilot

A tiny, resilient fetch wrapper with retries, exponential backoff, automatic JSON parsing, typed results, and error normalization. Built for simplicity and high quality.

## Install

```powershell
npm install fetchpilot
```

**Key Capabilities**
- Robust retries with exponential backoff and jitter
- Respect for Retry-After on rate limits
- Automatic JSON parsing with an optional validation step
- Typed, discriminated results for straightforward control flow
- Normalized error format across environments
- Optional request deduplication and lightweight GET caching
- Dependency-free, ESM-first; supports browsers and Node 18+

**Installation**
- Add the package via your preferred package manager.

**Design Overview**
- Single-function client that accepts an input (URL or Request) plus options.
- Returns a clear result: either a successful payload with metadata or a normalized error with context.

**Configuration Options**
- Retries: set attempt count and define conditions via a predicate.
- Backoff: choose exponential or fixed, configure base and max delays, and jitter.
- Parsing: select auto, json, text, or stream.
- Timeout & abort: per-request timeout and AbortSignal support.
- Validation: optional hook to verify parsed data and surface parse errors.
- Fetch override: provide a custom implementation when needed.
- Cache: optional TTL for successful GET responses.
- Dedupe: share identical in-flight GET requests.

**Runtime Behavior**
- Retries apply to idempotent methods by default (GET, HEAD, OPTIONS).
- Retry-After is honored when present; otherwise backoff strategy applies.
- JSON parsing is automatic based on response content type.
- Errors are normalized and consistently typed for reliable handling.

**Result Model**
- Success: includes parsed data, status, and headers.
- Failure: includes a normalized error type and message, with optional status and headers.

**Environment Notes**
- Node 18+ includes global fetch. For older versions, supply a ponyfill via options.
- The package intentionally avoids dependencies to remain fast, small, and easy to integrate.

**Examples**
- Example scripts for Node and the browser are provided under the examples/ directory.

**Project Links**
- Refer to the homepage and repository fields in package.json for the canonical resources.

