# `GET /api/mirror/[id]/progress`

> **Source:** `app/api/mirror/[id]/progress/route.ts` · **Runtime:** Node.js
> **Auth:** none · **Transport:** Server-Sent Events

## Purpose

The live telemetry channel behind the studio screen. Pushes a snapshot every
2 seconds and closes itself once the job reaches a terminal state.

## Request

### Path parameters

| name | type | description |
|---|---|---|
| `id` | `string` | Job id returned by `POST /api/mirror`. |

No query parameters. The connection is meant to be consumed with
`EventSource`.

## Behaviour

1. `ensureJobExists(id)` rehydrates the in-memory job from disk if the process
   restarted → `404 {"error":"Job not found"}` when nothing can be found.
2. The last **100 log lines** are read from `crawl_logs.txt` (tail-limited to
   64 KB, first partial line discarded).
3. Log sniffing promotes the job status before the first frame:
   `Crawl completed` / `Offline mirror bundle ready` → `completed`;
   `Fatal crawl error` / `Crawl failed` → `failed`.
4. An initial `data:` frame is written immediately.
5. If the job is already terminal the stream closes right away.
6. Otherwise a 2-second `setInterval` emits further frames until the job is
   `completed` or `failed`, or the client aborts (`req.signal`).

## Response — `200 text/event-stream`

```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
```

Each frame is an unnamed event with a JSON payload:

```json
{
  "status": "downloading",
  "error": null,
  "stats": {
    "html": 42, "css": 18, "images": 310, "fonts": 12, "js": 96,
    "totalFiles": 486, "totalSize": 18432117
  },
  "recentFiles": [ { "name": "assets/app.js", "size": 20481 } ],
  "hostname": "example.com",
  "url": "https://example.com/",
  "logs": "…last 100 log lines…"
}
```

`status` ∈ `downloading` | `paused` | `completed` | `failed` | `cancelled`.

On a lost job the stream emits a named error event and closes:

```
event: error
data: Job lost
```

## Errors

| status | body | when |
|---|---|---|
| 404 | `{"error":"Job not found"}` | unknown id, plain JSON not SSE |

## Reimplementation notes

- **Stats are cached per job for 3.5 s** in a module-level `Map`
  (`statsCache`) so a full directory walk is not repeated for every client
  and every tick. Without this the endpoint becomes the most expensive route
  in the app on large mirrors.
- **Recent files** are the 15 newest by `mtime`, flattened to `{name, size}`.
- Counting is extension-based: `.html/.htm` → html, `.css` → css,
  `.png/.jpg/.jpeg/.gif/.svg/.webp/.ico` → images,
  `.woff/.woff2/.ttf/.otf/.eot` → fonts, `.js` → js.
- Only the **tail** of the log is ever sent — never the whole file.
