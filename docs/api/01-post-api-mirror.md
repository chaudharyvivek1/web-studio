# `POST /api/mirror`

> **Source:** `app/api/mirror/route.ts` · **Runtime:** Node.js · **Auth:** none
> **Role:** the single entry point that starts every capture job.

## Purpose

Accepts a target URL plus optional capture configuration, runs the full
security gauntlet, creates a job record, and dispatches one of four
execution strategies. It always returns a job `id` immediately — the crawl
itself always runs in the background.

## Request

### Body

| field | type | required | default | description |
|---|---|---|---|---|
| `url` | `string` | **yes** | — | Target address. A missing scheme is upgraded to `https://`. Trimmed; max 2048 chars. |
| `preset` | `string` | no | — | Key into `CAPTURE_PRESETS` (`lib/crawler/presets.ts`). Expands into `mode`, `scopeConfig`, `captureRules`, `limits`. |
| `mode` | `'auto' \| 'http' \| 'playwright'` | no | `'auto'` | Engine selection hint. |
| `scope` / `scopeConfig` | `object` | no | `{}` | `{ mode, maxDepth, ... }` crawl boundary rules. |
| `captureRules` | `object` | no | — | Per-asset-type toggles (`html`, `css`, `js`, `images`, `fonts`, `video`, `audio`, `documents`, `apiMetadata`, ...). |
| `limits` | `object` | no | `{}` | `{ maxPages, maxDepth, maxAssets, maxSizeGb, maxDurationMin }`. |
| `maxPages` | `number` | no | — | Shorthand for `limits.maxPages`. |
| `authProfileId` | `string` | no | — | Stored Playwright `storageState` profile to reuse. |
| `authSessionId` | `string` | no | — | In-flight manual-login session. |
| `authCrawler` | `boolean` | no | `false` | Force the authenticated Playwright crawler. |

## Validation order

The route is deliberately sequential — each check short-circuits:

1. **Parse body** → `400 {"error":"URL is required"}` if `url` is absent or not a string.
2. **Length** → `400 {"error":"URL is too long"}` above 2048 characters.
3. **Scheme repair** — prefixes `https://` when `/^https?:\/\//i` does not match.
4. **Per-IP rate limit** (`defaultRateLimiter.consume(ip)`, IP from the first
   `x-forwarded-for` hop, falling back to `127.0.0.1`) →
   `429 {"error":"Too many requests. Please retry in N seconds."}`
5. **`validateURL()`** (`lib/security/validate-url.ts`) → `400` with the
   validator's own `reason`.
6. **`new URL()`** → `400 {"error":"Invalid URL format"}`.
7. **Blocklist regex** on the hostname — `localhost`, `127.0.0.0/8`, `10/8`,
   `172.16/12`, `192.168/16`, `0.0.0.0`, `[::1]` →
   `400 {"error":"Cannot mirror local or private network addresses"}`.
8. **`dnsGuard(hostname)`** — resolves DNS and rejects any address that lands
   in a private/loopback/link-local range (DNS-rebinding defence) →
   `403 {"error":"Security check blocked: <reason>"}`.
9. **Stale-job sweep** — any in-memory job still marked `downloading` with no
   live process, no queue slot and older than 20 s is flipped to `completed`.
10. **Concurrency cap** — `MAX_CONCURRENT_JOBS = 50` →
    `429 {"error":"Server busy: N mirrors in progress. Please try again shortly."}`
11. **Redirect resolution** — a `HEAD` request with a 1500 ms `AbortController`
    timeout follows redirects to the canonical URL. Failures are swallowed
    silently so job creation is never delayed.
12. **Re-parse** the resolved URL → `400 {"error":"Invalid URL after redirect resolution"}`.

## Execution strategies

After validation the job id is minted as
`Date.now().toString(36) + Math.random().toString(36).slice(2, 7)` and the
download directory is created. `job.json` is written so state survives a
serverless cold start. Then the route branches, **in this order**:

| # | Condition | Strategy |
|---|---|---|
| 1 | URL contains `vuexy`, `pixinvent.com`, `admin-template`, `dashboards`, **or** `body.authCrawler` | `runAuthCrawler()` — Playwright login + deep harvest. Page limit is `max(limit, 1000)`, or 50000 when the request asks for "unlimited" (`0` or `>= 50000`). |
| 2 | Any of `preset`, `scope`, `scopeConfig`, `captureRules`, `authProfileId`, `authSessionId`, `mode` present | `JobManager.createJob()` — the v3 capture engine with scope/limits/presets resolved. |
| 3 | `VERCEL` or `NOW_BUILDER` set | `runNativeMirror()` — pure-Node mirror, no external binary. |
| 4 | otherwise (default) | `spawn('wget', [...])` mirror, streamed into `crawl_logs.txt`, with a 20-minute hard timeout and automatic fallback to `runNativeMirror()` on spawn error. |

### The wget invocation

```
--mirror --page-requisites --adjust-extension --convert-links --no-parent
--span-hosts --domains=<host>,www.<host> --timeout=8 --tries=1 --wait=0
--no-check-certificate --user-agent=<Chrome/132 UA>
--directory-prefix=<downloadDir> <url>
```

On `close`, the job becomes `completed` only if the download directory holds at
least one non-dotfile (excluding `job.json`); otherwise it is marked `failed`
with `wget failed to retrieve site files (exit code N)`.

## Responses

### 200 — job accepted

```json
{ "id": "lq3f8k2ab" }
```

### Errors

| status | body | when |
|---|---|---|
| 400 | `{"error":"URL is required"}` | missing/invalid `url` |
| 400 | `{"error":"URL is too long"}` | `url.length > 2048` |
| 400 | `{"error":"<reason>"}` | failed `validateURL()` |
| 400 | `{"error":"Invalid URL format"}` | unparseable URL |
| 400 | `{"error":"Cannot mirror local or private network addresses"}` | hostname matches the blocklist |
| 400 | `{"error":"Invalid URL after redirect resolution"}` | redirect produced a bad URL |
| 403 | `{"error":"Security check blocked: <reason>"}` | DNS guard rejected the host |
| 429 | `{"error":"Too many requests. Please retry in N seconds."}` | per-IP token bucket empty |
| 429 | `{"error":"Server busy: N mirrors in progress..."}` | 50 concurrent jobs |
| 500 | `{"error":"<message>"}` | unhandled exception |

## Side effects

- Creates `<downloadDir>` and writes `job.json`.
- Registers the job in the in-memory `activeJobs` map.
- May insert a row into the SQLite job table (strategy 1 and 2 only).
- Starts a background crawl that outlives the HTTP response.

## Reimplementation notes

- The response is `{ id }` only — no status field. Clients must immediately
  subscribe to `GET /api/mirror/[id]/progress` to learn anything else.
- The 20-second stale sweep in step 9 is what keeps the concurrency cap from
  permanently leaking slots after a process crash.
- Strategy precedence matters: a request with both `preset` and a `vuexy` URL
  takes the auth-crawler path, and the preset is ignored.
