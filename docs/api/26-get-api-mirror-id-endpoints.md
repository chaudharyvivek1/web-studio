# `GET /api/mirror/[id]/endpoints`

> **Source:** `app/api/mirror/[id]/endpoints/route.ts` · **Runtime:** Node.js
> **Auth:** none · **Route flag:** `dynamic = 'force-dynamic'`

## Purpose

Returns every HTTP endpoint the mirrored site appears to use, merged from the
crawl manifest, the engine's recorded API catalogue, and string literals found in
captured JavaScript and HTML.

The third source surfaces routes the crawler never fetched — the ones behind a
login or behind a user action — which is what you need to rebuild the
application layer. Full behaviour:
[../08-endpoint-discovery.md](../08-endpoint-discovery.md).

## Request

| location | name | type | description |
|---|---|---|---|
| path | `id` | `string` | Job id |
| query | `refresh` | `'true'` | Bypass the 30-second in-process cache |

## Behaviour

1. `ensureJobExists(id)` → `404 {"error":"Job not found"}`.
2. Resolve the mirror directory → `404 {"error":"Download directory not found"}`.
3. Serve the cached catalogue when it is under 30 seconds old and `refresh` is
   not set.
4. Otherwise `buildEndpointCatalogue(baseDir, targetDir)`:
   - manifest `resources[]` filtered to API-like paths or JSON content types;
   - manifest `apiCatalog.endpoints[]` when the v3 engine recorded one;
   - up to 300 captured JS/HTML files (512 KB each), scanning endpoint literals
     and inferring the verb from the nearest call site within 60 characters.
5. Cache and return.

## Response — 200

```json
{
  "total": 8,
  "discoveredAt": 1793526608308,
  "endpoints": [
    {
      "method": "GET",
      "path": "/api/products",
      "source": "manifest",
      "hits": 1,
      "contentType": "application/json",
      "status": 200,
      "parameterised": false
    },
    {
      "method": "POST",
      "path": "/api/users/42/profile",
      "source": "script",
      "hits": 1,
      "sample": "assets/app.js",
      "parameterised": true
    }
  ],
  "summary": {
    "byMethod": { "GET": 5, "POST": 3 },
    "bySource": { "script": 6, "manifest": 2 },
    "apiLike": 8
  },
  "notes": []
}
```

`source` ∈ `manifest` (fetched) | `catalog` (recorded) | `script` (referenced).

## Errors

| status | body | when |
|---|---|---|
| 404 | `{"error":"Job not found"}` | unknown id |
| 404 | `{"error":"Download directory not found"}` | nothing captured yet |
| 500 | `{"error":"Failed to build endpoint catalogue"}` | unhandled exception |

## Reimplementation notes

- `total: 0` with a note is a valid result for a purely static site.
- Paths are normalised to origin-less, query-less form before grouping, so the
  same endpoint reported by two sources merges into one entry with `hits: 2`.
- `parameterised` marks template paths (`/api/users/42/profile`), which you
  should collapse to route patterns when rebuilding.
