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

## Reimplementation notes

- `action` is the only required field; sending `{}` yields the
  `Unknown action: undefined` 400.
- Sessions live in memory with a TTL, so this route is not usable across a
  multi-instance deployment without sticky routing.
