# `GET /api/mirror/[id]/manifest`

> **Source:** `app/api/mirror/[id]/manifest/route.ts` · **Runtime:** Node.js · **Auth:** none

## Purpose

Returns the crawl manifest — the machine-readable record of what was fetched.
This is the audit artefact referenced in the project's compliance use case.

## Request

| location | name | type | description |
|---|---|---|---|
| path | `id` | `string` | Job id |

## Resolution order

1. `<base>/manifest.json` on disk, returned verbatim when it parses.
2. The `manifest` column of the SQLite job row, `JSON.parse`d.
3. A synthesised minimal manifest assembled from the job row.

## Response — 200 (synthesised fallback)

```json
{
  "jobId": "lq3f8k2ab",
  "sourceUrl": "https://example.com/",
  "hostname": "example.com",
  "status": "completed",
  "stats": {
    "pagesDownloaded": 42,
    "assetsDownloaded": 439,
    "totalBytes": 18432117,
    "errorsCount": 2
  }
}
```

A full on-disk manifest (`lib/jobs/manifest.ts`) additionally carries
`resources[]` — each entry `{ url, localPath, status, contentType, size,
sha256 }` — plus a `health` block.

## Errors

| status | body | when |
|---|---|---|
| 404 | `{"error":"Job not found"}` | no manifest on disk and no job row |
| 500 | `{"error":"<message>"}` | unhandled exception |

## Reimplementation notes

- A malformed `manifest.json` is silently ignored and falls through to the next
  source, so a half-written file never breaks the dashboard.
