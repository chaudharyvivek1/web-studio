# `GET /api/mirror/[id]/files`

> **Source:** `app/api/mirror/[id]/files/route.ts` · **Runtime:** Node.js · **Auth:** none

## Purpose

Returns the full captured directory as a nested tree for the **Files**
explorer tab.

## Request

| location | name | type | description |
|---|---|---|---|
| path | `id` | `string` | Job id |

## Behaviour

- `ensureJobExists(id)` → `404 {"error":"Job not found"}`.
- If `cachedFileTree` exists and the job is `completed` **or** the cache is
  under 4 s old, the cache is returned. There is no `refresh` escape hatch —
  completed jobs always serve the cached tree.
- Otherwise `resolveTargetDir()` is walked recursively; dotfiles are skipped.
- Children are sorted: directories before files, then `localeCompare` by name.

## Response — 200

```json
[
  {
    "name": "assets",
    "type": "directory",
    "path": "assets",
    "children": [
      { "name": "app.js", "type": "file", "path": "assets/app.js", "size": "20.0 KB" }
    ]
  },
  { "name": "index.html", "type": "file", "path": "index.html", "size": "12.4 KB" }
]
```

`size` is 1024-based with one decimal (`B`, `KB`, `MB`, `GB`).

## Errors

| status | body | when |
|---|---|---|
| 404 | `{"error":"Job not found"}` | unknown id |
| 200 | `[]` | target directory not created yet |
| 500 | `{"error":"<message>"}` | unhandled exception |

## Reimplementation notes

- The tree is built fresh on every uncached call — it is the one route with no
  incremental strategy beyond the timestamp cache, which is fine because it is
  only read while the Files tab is open.
