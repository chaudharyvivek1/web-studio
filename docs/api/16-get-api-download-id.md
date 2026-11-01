# `GET /api/download/[id]`

> **Source:** `app/api/download/[id]/route.ts` · **Runtime:** Node.js · **Auth:** none

## Purpose

Streams the finished mirror as a ZIP that contains a zero-dependency server,
launcher scripts and a generated README.

## Request

| location | name | type | description |
|---|---|---|---|
| path | `id` | `string` | Job id |

## Behaviour

1. `ensureJobExists(id)` → `404 Job not found` (plain text).
2. `resolveTargetDir()` → `404 Downloaded files not found` when absent.
3. **Fast path** — if `<hostname>-mirror.zip` already exists and is non-empty,
   it is streamed immediately; nothing is regenerated.
4. Otherwise the bundle is prepared:
   - up to 50 HTML pages are enumerated;
   - the total byte size is computed;
   - `createCompleteRunnableBundle()` writes `server.js`, `serve.py`,
     `start.sh`, `start.bat` and `README.md` into the target directory.
5. Zipping uses system `zip -r -q -1` (stored, fast) with a 60 s timeout,
   excluding `.git*`, `crawl_logs.txt` and `*.zip`; the temp file is renamed
   into place only on success.
6. If system `zip` is unavailable, it falls back to the streaming `archiver`
   via `createMirrorZipStream()`.
7. The file is streamed with `Readable.toWeb()`.

## Response — 200

```
Content-Type: application/zip
Content-Disposition: attachment; filename="example.com-mirror.zip"
Content-Length: <bytes>
Cache-Control: no-cache, no-store, must-revalidate
```

## Errors

| status | body | when |
|---|---|---|
| 404 | `Job not found` | unknown id (plain text) |
| 404 | `Downloaded files not found` | nothing on disk |
| 500 | `Failed to generate snapshot archive` | both zip strategies produced nothing |
| 500 | `<message>` | unhandled exception |

## Reimplementation notes

- The pre-built ZIP is cached on disk, so a second download of the same job is
  a plain file stream — no CPU cost. Delete the `.zip` to force a rebuild.
- `-1` is zip's fastest compression level, chosen because the payload is
  mostly already-compressed images and fonts.
