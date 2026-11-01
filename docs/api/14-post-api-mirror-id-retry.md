# `POST /api/mirror/[id]/retry`

> **Source:** `app/api/mirror/[id]/retry/route.ts` · **Runtime:** Node.js · **Auth:** none

## Purpose

Re-runs a failed capture as a brand-new job, preserving the original's
configuration.

## Request

| location | name | type | description |
|---|---|---|---|
| path | `id` | `string` | Id of the job to retry |

No body.

## Behaviour

1. `400 {"error":"Job ID required"}` on an empty id.
2. `JobManager.retryJob(id)` clones the stored config (url, mode, scope,
   capture rules, limits, auth profile) into a fresh job id and dispatches it.
3. `404 {"error":"Original job not found"}` when the source job cannot be read.

## Response — 200

```json
{
  "success": true,
  "newJobId": "lq9x2m1cd",
  "url": "https://example.com/",
  "status": "downloading"
}
```

## Errors

| status | body | when |
|---|---|---|
| 400 | `{"error":"Job ID required"}` | empty id |
| 404 | `{"error":"Original job not found"}` | unknown id |
| 500 | `{"error":"Failed to retry job"}` | unhandled exception |

## Reimplementation notes

- Retry never mutates the original job; the client must navigate to
  `newJobId`. This keeps the failed job's log and manifest intact for
  comparison.
