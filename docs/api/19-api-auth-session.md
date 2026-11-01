# `GET /api/auth/session` · `POST /api/auth/session`

> **Source:** `app/api/auth/session/route.ts` · **Runtime:** Node.js · **Auth:** none

## Purpose

A **mock** NextAuth session endpoint. It exists so that mirrored NextAuth
sites — and WebStudio's own preview iframe — can be handed a valid-looking
session without a real identity provider.

## Request

No parameters. `POST` simply calls `GET`.

## Response — 200

```json
{
  "user": {
    "name": "Vuexy Administrator",
    "email": "admin@vuexy.com",
    "image": null,
    "role": "admin"
  },
  "expires": "2099-01-01T00:00:00.000Z"
}
```

Headers:

```
Cache-Control: no-store, max-age=0
Set-Cookie: __Secure-next-auth.session-token=webstudio_mock_session_token; Path=/; SameSite=Lax
```

## Reimplementation notes

- This is a fixture, not authentication. Nothing here is validated or signed.
  If you ever put WebStudio behind real auth, replace this route — see
  `docs/04-security.md`.
- `expires` is deliberately far-future so client libraries never trigger a
  refresh.
