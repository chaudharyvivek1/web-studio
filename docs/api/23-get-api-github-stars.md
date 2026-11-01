# `GET /api/github-stars`

> **Source:** `app/api/github-stars/route.ts` · **Runtime:** Node.js
> **Route flag:** `dynamic = 'force-dynamic'`

## Purpose

Fetches the star count for the project's own GitHub repository, to render the
navbar badge without exposing a token to the browser.

## Configuration

| env var | default | description |
|---|---|---|
| `GITHUB_REPO` | `krishsoni15/WebHarvest` | `owner/name` to query |

When the variable is unset or malformed the route returns `{"stars": null}`
rather than guessing a number.

## Request

No parameters.

## Behaviour

1. `GET https://api.github.com/repos/<owner>/<repo>` with a browser
   `User-Agent` and `Accept: application/vnd.github.v3+json`.
2. If that fails or is rate-limited, scrape `https://github.com/<owner>/<repo>`
   with a regex over the stargazers link.
3. On total failure return `{"stars": null}`.

## Response — 200

```json
{ "stars": 128 }
```

or, when nothing could be resolved:

```json
{ "stars": null }
```

## Reimplementation notes

- The dual strategy exists because unauthenticated GitHub API calls are limited
  to 60/hour per IP. The HTML scrape is the fallback.
- `stars: null` (rather than `0`) lets the UI hide the badge entirely instead
  of showing a misleading zero.
