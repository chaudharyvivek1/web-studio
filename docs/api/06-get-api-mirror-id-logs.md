# `GET /api/mirror/[id]/logs`

> **Source:** `app/api/mirror/[id]/logs/route.ts` · **Runtime:** Node.js · **Auth:** none

## Purpose

Serves the crawl log tail for the draggable terminal, or the whole log as a
download.

## Request

| location | name | type | default | description |
|---|---|---|---|---|
| path | `id` | `string` | — | Job id |
| query | `limit` | `number` | `3000` | Lines to return, clamped to `[100, 10000]` |
| query | `download` | `'true'` | — | Return the entire log as a `text/plain` attachment |

## Behaviour

- Missing log file → `200 {"logs":"Waiting for crawl process to start..."}`.
- **Download mode** streams the whole file with
  `Content-Disposition: attachment; filename="<id>-crawl-logs.txt"`.
- Otherwise only the **last 1 MB** is read. When the file exceeds 1 MB the
  read is a positioned `fs.readSync` from `size - 1MB`, and the first partial
  line is discarded so output never starts mid-line.
- The tail is then split and the last `limit` lines returned.

## Response — 200 (JSON mode)

```json
{
  "logs": "$ wget --mirror ...\n2026-11-01 10:12:03 (1.2 MB/s) - saved 'index.html'",
  "totalLines": 4820,
  "isTruncated": true
}
```

`isTruncated` is true when the file exceeded 1 MB **or** more lines existed
than `limit`.

Response headers always include
`Cache-Control: no-cache, no-store, must-revalidate`.

## Errors

| status | body | when |
|---|---|---|
| 500 | `{"error":"<message>"}` | unhandled exception |

## Reimplementation notes

- Log reads are the cheapest way to observe a crawl; the SSE route reuses the
  same tailing technique. Keep both byte-bounded or a runaway wget log will
  blow the response budget.
