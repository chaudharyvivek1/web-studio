# `GET /api/mirror/[id]/auth-flow`

> **Source:** `app/api/mirror/[id]/auth-flow/route.ts` · **Runtime:** Node.js
> **Auth:** none · **Route flag:** `dynamic = 'force-dynamic'`

## Purpose

Returns the detected authentication surface of a mirror: which captured pages
hold a login or sign-up form, what fields they expose, which page to land on
after authenticating, and the session contract recovered from the captured
JavaScript.

The preview route reads the same cached object to decide whether to inject the
offline auth runtime. Full behaviour:
[../07-auth-emulation.md](../07-auth-emulation.md).

## Request

| location | name | type | description |
|---|---|---|---|
| path | `id` | `string` | Job id |
| query | `refresh` | `'true'` | Ignore the cache and re-detect |

## Behaviour

1. `ensureJobExists(id)` → `404 {"error":"Job not found"}`.
2. Resolve the mirror directory → `404 {"error":"Download directory not found"}`
   when nothing has been captured yet.
3. Unless `refresh=true`, read `auth-flow.json` from the job directory and
   return it when it parses and carries a numeric `detectedAt`.
4. Otherwise run `detectAuthFlow()`, write the result to `auth-flow.json`
   (failure to write is ignored so a read-only directory still works), and
   return it.

Detection scans up to 400 HTML files (2 MB each) for password forms, then up to
250 JS/HTML files for cookie assignments, `localStorage` keys and endpoint
literals.

## Response — 200

```json
{
  "jobId": "lq3f8k2ab",
  "hostname": "example.com",
  "detectedAt": 1793526608308,
  "hasAuth": true,
  "pages": [
    {
      "path": "login.html",
      "kind": "login",
      "method": "POST",
      "action": "/api/auth/login",
      "fields": [
        { "name": "email", "type": "email", "placeholder": "Email", "required": true },
        { "name": "password", "type": "password", "placeholder": null, "required": true }
      ],
      "confidence": 0.8,
      "signals": ["1 password input(s)", "form or path contains a log-in keyword"]
    }
  ],
  "entryPage": "dashboard.html",
  "sessionCookies": ["session_token"],
  "storageKeys": ["userData", "accessToken"],
  "authEndpoints": ["/api/auth/login", "/api/auth/session"],
  "notes": []
}
```

`kind` ∈ `login` | `signup` | `reset` | `unknown`.

## Errors

| status | body | when |
|---|---|---|
| 404 | `{"error":"Job not found"}` | unknown id |
| 404 | `{"error":"Download directory not found"}` | nothing captured yet |
| 500 | `{"error":"Failed to detect auth flow"}` | unhandled exception |

## Reimplementation notes

- `hasAuth: false` is a normal, successful result — it means the mirror behaves
  as a static copy. `notes` explains why detection came up empty.
- The cache is a plain file, so it survives restarts and is shared with the
  preview route's memoised lookup.
