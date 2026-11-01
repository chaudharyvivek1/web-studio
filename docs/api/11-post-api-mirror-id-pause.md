# `POST /api/mirror/[id]/pause`

> **Source:** `app/api/mirror/[id]/pause/route.ts` · **Runtime:** Node.js · **Auth:** none

## Purpose

Freezes a running crawl without discarding progress.

## Request

| location | name | type | description |
|---|---|---|---|
| path | `id` | `string` | Job id |

No body.

## Behaviour

1. `400 {"error":"Job ID required"}` when the id is empty.
2. Sets `activeJobControls.get(id).isPaused = true` (creating the control
   record if absent).
3. Sets `activeJobs.get(id).status = 'paused'`.
4. Calls `jobQueue.pause(id)` inside a `try/catch` — the queue may not be
   running for this job, which is not an error.

## Response — 200

```json
{
  "success": true,
  "jobId": "lq3f8k2ab",
  "status": "paused",
  "message": "Crawl paused. Current progress safely frozen."
}
```

## Errors

| status | body | when |
|---|---|---|
| 400 | `{"error":"Job ID required"}` | empty id |
| 500 | `{"error":"Failed to pause job"}` | unhandled exception |

## Reimplementation notes

- Pausing is cooperative. A `wget` process (strategy 4 in `POST /api/mirror`)
  ignores the flag entirely — only the queue-driven engine honours it. This is
  the single biggest behavioural inconsistency in the original and is called
  out in `docs/05-recreation-guide.md`.
