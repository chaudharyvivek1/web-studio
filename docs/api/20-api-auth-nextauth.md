# `GET|POST /api/auth/[...nextauth]`

> **Source:** `app/api/auth/[...nextauth]/route.ts` · **Runtime:** Node.js · **Auth:** none

## Purpose

The catch-all that satisfies every URL shape a NextAuth client library probes,
so an offline mirror never shows a broken login or a failed session check.

## Request

The sub-path is matched case-insensitively against the request pathname; there
are no query or body parameters.

## GET dispatch

| pathname contains | response |
|---|---|
| `/session` | `{user:{name,email,image,role},expires}` |
| `/csrf` | `{csrfToken:"webstudio_offline_mock_csrf_token"}` |
| `/providers` | `{credentials:{id,name,type,signinUrl,callbackUrl}}` |
| anything else | `{success:true}` |

## POST dispatch

| pathname contains | response |
|---|---|
| `/callback` or `/signin` | `{url:"/dashboards/analytics"}` + session cookie |
| anything else | delegates to `GET` |

The session cookie set on sign-in is
`__Secure-next-auth.session-token=webstudio_mock_session_token; Path=/; SameSite=Lax`.

## Response — 200 (example: `/csrf`)

```json
{ "csrfToken": "webstudio_offline_mock_csrf_token" }
```

## Reimplementation notes

- Every branch returns `200`. There is no 401 — by design, since the goal is to
  make an offline copy *not* fail its own auth probes.
- The sign-in redirect target `/dashboards/analytics` is hard-coded to the
  Vuexy demo layout; change it in one place if you target a different app.
