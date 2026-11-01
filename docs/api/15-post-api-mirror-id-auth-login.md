# `POST /api/mirror/[id]/auth-login`

> **Source:** `app/api/mirror/[id]/auth-login/route.ts` · **Runtime:** Node.js
> **Auth:** none · **Requires:** Playwright + Chromium

## Purpose

Logs into a password-protected target with a real browser, persists the
resulting session, and launches an authenticated deep harvest. This is what
makes internal dashboards mirrorable.

## Request

| location | name | type | default | description |
|---|---|---|---|---|
| path | `id` | `string` | — | Existing job id (its `job.json` supplies the target URL) |
| body | `email` | `string` | auto-detected | Login identity |
| body | `password` | `string` | auto-detected | Login secret |
| body | `autoDetect` | `boolean` | `true` | Scrape credentials off the login page |

### Target URL resolution

`job.json` → `report.json` (`seedUrl`) → the in-memory job → a hard-coded
Vuexy demo URL as last resort.

### Credential auto-detection

When `autoDetect` is on, or either credential is missing, three strategies run
in order:

1. **Page text** — `email|user(name) : value` and `pass(word) : value` regexes
   over `body.innerText`.
2. **Prefilled inputs** — `input[type=email], input[name*=user], …` and
   `input[type=password]` values.
3. **Known template defaults** — for `pixinvent.com`/`vuexy` hosts:
   `admin@vuexy.com` (Next.js demo) or `admin@demo.com`, password `admin`;
   otherwise `admin@demo.com` / `admin`.

## Behaviour

1. `404 {"error":"Job not found"}` when the download directory is missing.
2. `require('playwright')` → `500 {"error":"Playwright is not installed or available on this host"}`.
3. `launchChromiumSafe()` → `500 {"error":"Chromium browser failed to launch on this container"}`.
4. A fresh context is created with a macOS Chrome 128 UA and a 1440×900
   viewport, and `navigator.webdriver` is masked via `addInitScript`.
5. Navigates to the login URL (derived with `resolveVuexyConfig` when the
   target does not already contain `/login` or `/signin`), 25 s timeout,
   then waits 2 s.
6. Fills `emailSelector` / `passSelector` and clicks `submitSelector`
   (tolerant CSS covering `button[type=submit]`, `form button`, and
   Login/Sign in text matches).
7. Polls up to 20 × 500 ms for a cookie whose name contains `session-token` or
   `session` **and** a URL that left `/login`; then waits 1.5 s more.
8. Scans for a visible error node
   (`.alert, .error, [role=alert], [class*=error], [class*=invalid], [class*=danger]`)
   whose text matches `invalid|incorrect|failed|wrong|error|not match|unauthorized`.
9. Writes `auth_state.json` (`storageState`) into the download directory.
10. Fires `runAuthCrawler()` in the background with `maxPages: 50000`.

## Response — 200

```json
{
  "success": true,
  "message": "Successfully authenticated as admin@vuexy.com. Launched authenticated deep harvest.",
  "email": "admin@vuexy.com",
  "loginUrl": "https://demos.pixinvent.com/.../en/login",
  "postLoginUrl": "https://demos.pixinvent.com/.../en/dashboards/analytics"
}
```

## Errors

| status | body | when |
|---|---|---|
| 404 | `{"error":"Job not found"}` | no download directory |
| 401 | `{"success":false,"error":"<page error or 'Invalid credentials...'>","postLoginUrl":"…"}` | error node found, or still on `/login` with no credentials |
| 500 | `{"error":"Playwright is not installed or available on this host"}` | Playwright missing |
| 500 | `{"error":"Chromium browser failed to launch on this container"}` | browser launch failed |
| 500 | `{"error":"Auto-login authentication failed"}` | unhandled exception |

## Reimplementation notes

- The success test is deliberately generous: **not** being on `/login` after
  submit is treated as success, because many dashboards redirect to a
  hash-router URL that still mentions the host.
- `auth_state.json` is the reusable artefact — feed it to
  `POST /api/auth/profiles` to create a named, permanent profile.
- A `401` here does **not** fail the job; the crawler was never started.
