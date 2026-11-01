# `POST /api/auth/login`

> **Source:** `app/api/auth/login/route.ts` · **Runtime:** Node.js · **Auth:** none
> **Delegates to:** `lib/auth/manual-login.ts`

## Purpose

Drives the interactive "log in yourself" flow: launch a real browser, let the
operator authenticate by hand, then snapshot the session as a reusable profile.
A single route multiplexes four actions.

## Request

| field | type | required | description |
|---|---|---|---|
| `action` | `'start' \| 'status' \| 'complete' \| 'cancel'` | **yes** | Operation to perform |
| `url` | `string` | for `start` | Target site to open |
| `sessionId` | `string` | for `status`/`complete`/`cancel` | Handle from `start` |
| `profileName` | `string` | no | Name to store the captured profile under |

## Actions

| action | behaviour | response |
|---|---|---|
| `start` | `startManualLogin(url)` opens Chromium | `{success, sessionId, status:"launching"}` |
| `status` | `getManualLoginStatus(sessionId)` | `{success, session}` |
| `complete` | `completeManualLogin(sessionId, profileName)` snapshots cookies + `localStorage` | `{success, profileId}` |
| `cancel` | `cancelManualLogin(sessionId)` closes the browser | `{success, status:"cancelled"}` |

## Errors

| status | body | when |
|---|---|---|
| 400 | `{"error":"Target URL is required"}` | `start` without `url` |
| 400 | `{"error":"Session ID is required"}` | other actions without `sessionId` |
| 400 | `{"error":"Unknown action: <action>"}` | unrecognised or missing `action` |
| 404 | `{"error":"Session not found or expired"}` | `status` on a dead session |
| 500 | `{"error":"Failed to capture session"}` | `complete` failed |
| 500 | `{"error":"Manual login API error"}` | unhandled exception |

## The intended end-to-end flow

This route is designed to be driven by the landing page's **Sign in first**
control, then handed straight to a capture:

```
POST /api/auth/login  {action:"start", url}
        → { sessionId }
POST /api/auth/login  {action:"status", sessionId}     (poll every 2s)
        → { session: { status: "awaiting_login", headless: false } }
POST /api/auth/login  {action:"complete", sessionId, profileName}
        → { profileId }
POST /api/mirror      { url, authProfileId: profileId, ...config }
        → { id }                                        authenticated crawl
```

`profileName` is **required to receive a `profileId`** — `completeManualLogin`
only persists a profile when a name is supplied, and without a `profileId` the
capture has nothing to authenticate with.

The `status` payload includes `headless: boolean`. When it is `true` no browser
window could be shown, so the operator cannot sign in; the UI says so instead of
inviting a click that would store an empty session.

## Reimplementation notes

- `action` is the only required field; sending `{}` yields the
  `Unknown action: undefined` 400.
- Sessions live in memory with a TTL, so this route is not usable across a
  multi-instance deployment without sticky routing.
