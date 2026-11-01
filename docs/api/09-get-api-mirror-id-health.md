# `GET /api/mirror/[id]/health`

> **Source:** `app/api/mirror/[id]/health/route.ts` · **Runtime:** Node.js · **Auth:** none

## Purpose

Returns a single 0-100 fidelity score for the mirror.

## Request

| location | name | type | description |
|---|---|---|---|
| path | `id` | `string` | Job id |

## Behaviour

1. If `<base>/manifest.json` exists **and** contains a `health` block, return it
   untouched — the engine already scored the crawl.
2. Otherwise synthesise the inputs from the SQLite job row and score them:
   `pagesFound = pagesCaptured = pages_downloaded || 1`,
   `assetsFound = assetsCaptured = assets_downloaded || 1`,
   `errorsCount = errors_count || 0`.
3. `calculateMirrorHealth()` (`lib/analysis/health.ts`) produces the score.

## Response — 200

```json
{
  "health": {
    "score": 97,
    "grade": "A",
    "pagesCoverage": 100,
    "assetsCoverage": 100,
    "errorRate": 0.4,
    "notes": ["2 assets were retried and recovered"]
  }
}
```

## Errors

| status | body | when |
|---|---|---|
| 500 | `{"error":"Failed to get health score"}` | unhandled exception |

## Reimplementation notes

- The fallback path is always self-consistent (found == captured), so a job
  without a manifest always scores near-perfect. The meaningful score only
  exists once the engine has written `manifest.health`.
