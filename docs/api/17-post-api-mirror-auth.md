# `POST /api/mirror/auth`

> **Source:** `app/api/mirror/auth/route.ts` · **Runtime:** Node.js · **Auth:** none

## Purpose

A direct, configuration-light entry point to the authenticated crawler. Unlike
`POST /api/mirror`, it always uses Playwright and always starts from a login
URL.

## Request

| field | type | default |
|---|---|---|
| `loginUrl` | `string` | `https://demos.pixinvent.com/vuexy-nextjs-admin-template/demo-1/en/login` |
| `email` | `string` | `admin@vuexy.com` |
| `password` | `string` | `admin` |
| `targetPages` | `string[]` | three Vuexy demo dashboard URLs |
| `headless` | `boolean` | `true` |

Every field is optional — the route is usable with an empty body.

## Behaviour

1. `new URL(loginUrl)` → `400 {"error":"Invalid loginUrl format"}`.
2. Mints a job id, creates the download directory, registers the job.
3. Starts `runAuthCrawler()` in the background (not awaited).
4. Returns immediately.

## Response — 200

```json
{
  "success": true,
  "id": "lq3f8k2ab",
  "message": "Authenticated crawler started",
  "loginUrl": "https://example.com/login",
  "targetPagesCount": 3
}
```

## Errors

| status | body | when |
|---|---|---|
| 400 | `{"error":"Invalid loginUrl format"}` | unparseable `loginUrl` |
| 500 | `{"error":"<message>"}` | unhandled exception |

## Reimplementation notes

- This route performs **no SSRF or DNS validation** — unlike `POST /api/mirror`.
  It exists as an internal/demo convenience. Before exposing it publicly, add
  the same `validateURL` + `dnsGuard` sequence; this is flagged in
  `docs/04-security.md`.
- Note it returns `id` at the top level, not nested under a `job` key.
