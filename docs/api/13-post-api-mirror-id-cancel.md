# `POST /api/mirror/[id]/cancel`

> **Source:** `app/api/mirror/[id]/cancel/route.ts` · **Runtime:** Node.js · **Auth:** none

## Purpose

Stops a crawl, optionally deleting everything it downloaded.

## Request

| location | name | type | default | description |
|---|---|---|---|---|
| path | `id` | `string` | — | Job id |
| query / body | `purge` | `boolean` | `false` | Delete all downloaded files |
| query / body | `keepSnapshot` | `boolean` | `false` | Mark the job `completed` instead of `cancelled` |

Query-string values win over the body for initial parsing, then an explicitly
boolean body value overrides them. A body that fails to parse is ignored
entirely.

## Behaviour

1. `400 {"error":"Job ID required"}` on an empty id.
2. Signals the cooperative control record:
   `isCancelled = true`, `purgeOnCancel = purge`, and resolves any parked
   `pausePromiseResolve` so a paused crawler can observe the cancellation.
3. `JobManager.cancelJob(id)` removes it from the background queue.
4. Any legacy `wget` child process is `SIGTERM`ed and dropped from
   `activeProcesses`.
5. Then either:
   - **purge** → `JobManager.deleteJob(id)` plus deletion of the in-memory job
     and control records; or
   - **keep** → status becomes `completed` when `keepSnapshot`, else
     `cancelled`; files stay on disk and remain previewable.

## Response — 200

Purge:

```json
{
  "success": true,
  "jobId": "lq3f8k2ab",
  "status": "deleted",
  "message": "Crawl stopped and all downloaded files have been deleted."
}
```

Keep:

```json
{
  "success": true,
  "jobId": "lq3f8k2ab",
  "status": "cancelled",
  "message": "Crawl halted. Existing snapshot preserved for preview."
}
```

## Errors

| status | body | when |
|---|---|---|
| 400 | `{"error":"Job ID required"}` | empty id |
| 500 | `{"error":"Failed to cancel job"}` | unhandled exception |

## Reimplementation notes

- `keepSnapshot: true` is the "stop, but keep what you got" path — it is how a
  partial crawl is turned into a usable mirror.
- `purge: true` is destructive and irreversible; the UI guards it with
  `CancelConfirmationModal`.
