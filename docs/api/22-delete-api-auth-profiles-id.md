# `DELETE /api/auth/profiles/[id]`

> **Source:** `app/api/auth/profiles/[id]/route.ts` · **Runtime:** Node.js · **Auth:** none

## Purpose

Removes a stored authentication profile.

## Request

| location | name | type | description |
|---|---|---|---|
| path | `id` | `string` | Profile id (`auth_<millis>_<rand>`) |

## Behaviour

1. `400 {"error":"Profile ID required"}` on an empty id.
2. `getAuthProfile(id)` → `404 {"error":"Profile not found"}` when absent.
3. `deleteAuthProfile(id)`.

Note the lookup happens **before** deletion, so a second delete returns 404
rather than silently succeeding.

## Response — 200

```json
{ "success": true, "deletedId": "auth_1762000000000_a1b2c" }
```

## Errors

| status | body | when |
|---|---|---|
| 400 | `{"error":"Profile ID required"}` | empty id |
| 404 | `{"error":"Profile not found"}` | unknown or already deleted |
| 500 | `{"error":"Failed to delete profile"}` | unhandled exception |

## Reimplementation notes

- There is no soft delete and no audit trail. If profiles are shared across a
  team, add one.
