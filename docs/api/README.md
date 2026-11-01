# API reference

WebStudio exposes **27 HTTP endpoints** plus one edge middleware. Every route is
a Next.js App Router handler under `app/api/`, so a route's file path *is* its
URL.

Each endpoint has its own page. Every page follows the same shape: purpose,
request contract, validation order, response shape, error table, side effects,
and notes for anyone reimplementing it.

## Job-scoped endpoints (`/api/mirror/[id]/…`)

`[id]` is the short id returned by `POST /api/mirror`, e.g. `lq3f8k2ab`.

| # | Method | Path | Purpose |
|---|---|---|---|
| 01 | `POST` | `/api/mirror` | Create a job and dispatch a crawl |
| 02 | `GET` | `/api/mirror/[id]/progress` | Live SSE telemetry |
| 03 | `GET` | `/api/mirror/[id]/overview` | Dashboard summary, tech stack, palette |
| 04 | `GET` | `/api/mirror/[id]/assets` | Asset library + brand colours |
| 05 | `GET` | `/api/mirror/[id]/files` | Directory tree |
| 06 | `GET` | `/api/mirror/[id]/logs` | Log tail, or full log download |
| 07 | `GET` | `/api/mirror/[id]/manifest` | Crawl manifest |
| 08 | `GET` | `/api/mirror/[id]/network` | Network waterfall analysis |
| 09 | `GET` | `/api/mirror/[id]/health` | Fidelity score |
| 10 | `GET` | `/api/mirror/[id]/preview/[[...path]]` | Serve any captured file |
| 11 | `POST` | `/api/mirror/[id]/pause` | Freeze a crawl |
| 12 | `POST` | `/api/mirror/[id]/resume` | Unfreeze a crawl |
| 13 | `POST` | `/api/mirror/[id]/cancel` | Stop, optionally purge |
| 14 | `POST` | `/api/mirror/[id]/retry` | Re-run as a new job |
| 15 | `POST` | `/api/mirror/[id]/auth-login` | Browser login + authenticated harvest |
| 25 | `GET` | `/api/mirror/[id]/auth-flow` | Detected login/sign-up surface + session contract |
| 26 | `GET` | `/api/mirror/[id]/endpoints` | Every endpoint the site uses, including unreached ones |
| 27 | *any* | `/api/mirror/[id]/live/[[...path]]` | Live reverse proxy of the real site — forms and login work |

## Capture entry points

| # | Method | Path | Purpose |
|---|---|---|---|
| 17 | `POST` | `/api/mirror/auth` | Config-light authenticated crawl |

## Output

| # | Method | Path | Purpose |
|---|---|---|---|
| 16 | `GET` | `/api/download/[id]` | ZIP with a runnable offline bundle |

## Auth & session support

| # | Method | Path | Purpose |
|---|---|---|---|
| 18 | `POST` | `/api/auth/login` | Interactive manual login (4 actions) |
| 28 | `GET`/`POST`/`DELETE` | `/api/auth/access` | Access-token login, state check, sign-out |
| 19 | `GET`/`POST` | `/api/auth/session` | Mock NextAuth session |
| 20 | `GET`/`POST` | `/api/auth/[...nextauth]` | Mock NextAuth catch-all |
| 21 | `GET`/`POST` | `/api/auth/profiles` | List / create stored auth profiles |
| 22 | `DELETE` | `/api/auth/profiles/[id]` | Delete a profile |

## Misc

| # | Method | Path | Purpose |
|---|---|---|---|
| 23 | `GET` | `/api/github-stars` | Repo star count for the navbar |
| 24 | — | `middleware.ts` | Rewrites SPA asset requests into the preview route |

## Conventions across every endpoint

- **Errors are always JSON** `{ "error": "<message>" }` — except the three
  binary/streaming routes (`/api/download/[id]`, `/api/mirror/[id]/preview`,
  and `/api/mirror/[id]/progress`), which return plain text or SSE frames.
- **No endpoint authenticates.** WebStudio has no user accounts; see
  `docs/04-security.md`.
- **Cache headers:** live routes send `no-store`; completed mirrors send
  `public, max-age=3600, must-revalidate`.
- **Ids** are `Date.now().toString(36)` plus 5 random base36 characters, so
  they sort roughly by creation time and stay URL-safe.
- **All filesystem access** goes through `lib/resolveDir.ts`. No route builds a
  path by hand.
