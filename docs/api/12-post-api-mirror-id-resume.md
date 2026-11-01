# `POST /api/mirror/[id]/resume`

> **Source:** `app/api/mirror/[id]/resume/route.ts` · **Runtime:** Node.js · **Auth:** none

## Purpose

Counterpart to `pause` — clears the flag and releases a waiting crawler.

## Request

| location | name | type | description |
|---|---|---|---|
| path | `id` | `string` | Job id |

No body.

## Behaviour

1. `400 {"error":"Job ID required"}` on an empty id.
2. Clears `isPaused` and, crucially, **resolves `ctrl.pausePromiseResolve`**
   and nulls it. The engine parks on that promise while paused; resolving it is
   what actually wakes the loop.
3. Sets `activeJobs.get(id).status = 'downloading'`.
4. Calls `jobQueue.resume(id)` defensively.

## Response — 200

```json
{
  "success": true,
  "jobId": "lq3f8k2ab",
  "status": "downloading",
  "message": "Crawl resumed from last position."
}
```

## Errors

| status | body | when |
|---|---|---|
| 400 | `{"error":"Job ID required"}` | empty id |
| 500 | `{"error":"Failed to resume job"}` | unhandled exception |

## Reimplementation notes

- `resume` is idempotent: calling it on a job that was never paused simply
  flips the status back to `downloading`.
