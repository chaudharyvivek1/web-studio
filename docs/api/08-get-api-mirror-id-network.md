# `GET /api/mirror/[id]/network`

> **Source:** `app/api/mirror/[id]/network/route.ts` · **Runtime:** Node.js · **Auth:** none

## Purpose

Reconstructs a network-waterfall view from the manifest's `resources[]`, for
the **Network** tab.

## Request

| location | name | type | description |
|---|---|---|---|
| path | `id` | `string` | Job id |

## Behaviour

- Reads `<base>/manifest.json`; when `resources` is an array, each entry is
  mapped to `{ url, method: 'GET', status, contentType, size, isFirstParty: true }`.
- `analyzeNetworkTraffic(entries, hostname)` (`lib/analysis/network.ts`)
  computes the aggregate analysis.
- The response carries the full analysis but only the **first 100** entries.

## Response — 200

```json
{
  "analysis": {
    "totalRequests": 481,
    "totalBytes": 18432117,
    "byType": { "document": 42, "script": 96, "stylesheet": 18, "image": 310 },
    "thirdParty": [],
    "slowest": []
  },
  "entries": [
    {
      "url": "https://example.com/",
      "method": "GET",
      "status": 200,
      "contentType": "text/html",
      "size": 12704,
      "isFirstParty": true
    }
  ]
}
```

## Errors

| status | body | when |
|---|---|---|
| 500 | `{"error":"<message>"}` | unhandled exception |

Note there is **no 404**: an unknown id yields an empty `entries` array and a
zeroed analysis, because the route falls back to `hostname = 'example.com'`.

## Reimplementation notes

- Every mapped entry is hard-coded `isFirstParty: true`, so the third-party
  breakdown is only meaningful for manifests written by the v3 engine that
  supply their own flags.
