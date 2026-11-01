# `GET /api/auth/profiles` · `POST /api/auth/profiles`

> **Source:** `app/api/auth/profiles/route.ts` · **Runtime:** Node.js · **Auth:** none
> **Storage:** SQLite (`lib/db/client.ts`)

## Purpose

Manages saved authentication profiles — Playwright `storageState` snapshots
that can be replayed on later crawls of the same domain.

## Request — `GET` (list)

| query | type | description |
|---|---|---|
| `domain` | `string` | Optional filter |

### Response — 200

```json
{
  "profiles": [
    {
      "id": "auth_1762000000000_a1b2c",
      "name": "Client dashboard",
      "domain": "app.example.com",
      "auth_type": "storage_state",
      "created_at": "2026-11-01T09:00:00.000Z",
      "last_used_at": "2026-11-01T10:12:00.000Z"
    }
  ]
}
```

The response is deliberately **sanitised**: `storage_state` (the raw cookies
and tokens) is never returned.

## Request — `POST` (create)

| field | type | required | description |
|---|---|---|---|
| `name` | `string` | **yes** | Human label |
| `domain` | `string` | no | Defaults to `body.target_origin`, then `'example.com'` |
| `sessionJson` | `string \| object` | **yes** | Playwright `storageState` or a bare cookie array |
| `storageState` | `string \| object` | alias | Accepted instead of `sessionJson` |

`parseStorageStateJson()` normalises both accepted shapes.

### Response — 200

```json
{
  "success": true,
  "profile": {
    "id": "auth_1762000000000_a1b2c",
    "name": "Client dashboard",
    "domain": "app.example.com",
    "auth_type": "storage_state",
    "created_at": "2026-11-01T09:00:00.000Z"
  }
}
```

The id format is `auth_<epochMillis>_<5 random base36 chars>`.

## Errors

| status | body | when |
|---|---|---|
| 400 | `{"error":"Name and sessionJson (or storageState) are required"}` | missing field |
| 400 | `{"error":"Invalid session format. Expected Playwright storageState or cookie array."}` | unparseable session |
| 500 | `{"error":"Failed to list profiles"}` | GET failure |
| 500 | `{"error":"Failed to save profile"}` | POST failure |

## Reimplementation notes

- Profiles are keyed by `domain`, not by origin, so `app.example.com` and
  `example.com` are distinct.
- Storing `storage_state` verbatim means the database holds live credentials.
  Encrypt at rest before production use — see `docs/04-security.md`.
