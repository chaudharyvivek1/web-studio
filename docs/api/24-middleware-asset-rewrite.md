# `middleware.ts` — asset rewrite middleware

> **Source:** `middleware.ts` · **Runtime:** Edge · **Auth:** none
> **Not an API route**, but it is the fourth pillar of the request pipeline and
> is documented here because it intercepts traffic for every path.

## Purpose

A mirrored SPA still emits **root-relative** URLs — `/_next/static/chunks/x.js`,
`/assets/logo.png`, `/wp-content/uploads/…`. Those requests hit WebStudio's own
origin, not the preview route, and 404. This middleware rewrites them into
`/api/mirror/[id]/preview/<path>` so the mirrored app loads with its real
styling.

## Matcher

```ts
matcher: ['/((?!favicon.ico).*)']
```

Everything except `favicon.ico`.

## Job-id discovery (in priority order)

1. `Referer` header matching `/api/mirror/([a-zA-Z0-9]+)/preview` — the
   authoritative source when a request comes from inside the preview iframe.
2. `Referer` header matching `/mirror/([a-zA-Z0-9]+)` — the studio page itself.
3. The `webstudio_preview_id` cookie set by the preview route.

## Rewrite rules

| condition | action |
|---|---|
| `/api/mirror/(assets\|images\|fonts\|css\|js\|pages\|media\|wp-content\|wp-includes)/<rest>` **and** an id is known | rewrite to `/api/mirror/<id>/preview/<group>/<rest>` |
| `/_next/*` **and** the referer is a preview iframe | rewrite to `/api/mirror/<id>/preview/_next/*` — the mirror's own chunks |
| `/_next/*` otherwise | pass through — WebStudio's own assets |
| `/api*`, `/mirror*`, `/`, `/favicon.ico` | pass through |
| any other path **and** an id is known | rewrite to `/api/mirror/<id>/preview/<path>` |
| no id resolvable | pass through |

Query strings are preserved on every rewrite.

## Why the `/_next` split matters

Both the studio and the mirrored site use `/_next/`. The only reliable
discriminator is the `Referer`: a request whose referer is the preview route
belongs to the mirror, anything else belongs to WebStudio. Getting this wrong
in either direction breaks one of the two apps.

## Reimplementation notes

- Middleware runs on every request, so keep it allocation-light — this one is
  pure regex and a cookie read.
- If you deploy behind a proxy that strips `Referer`, fall back to the cookie;
  that is why the preview route sets `webstudio_preview_id`.
