# `GET /api/mirror/[id]/preview/[[...path]]`

> **Source:** `app/api/mirror/[id]/preview/[[...path]]/route.ts` · **Runtime:** Node.js
> **Auth:** none · **Size:** ~760 lines, the most complex route in the app

## Purpose

Serves a captured file for the sandboxed iframe — and is the reason the mirror
"just works" offline. Optional catch-all, so both `/preview` and
`/preview/a/b/c.html` are valid; `/preview` defaults to `index.html`.

## Request

| location | name | type | description |
|---|---|---|---|
| path | `id` | `string` | Job id |
| path | `path[]` | `string[]` | Optional path segments relative to the mirror root |
| query | `download` | `'true'` | Send as attachment instead of inline |

## File resolution — six tiers

`resolveFileOrDirectoryIndex(p)` first tries, for any candidate path:
exact file → `index.html` inside a directory → `p + '.html'` → `p + '.htm'` →
a sibling whose name matches after stripping `?`, `%3F` and `@` suffixes
(which is how wget-encoded query-string filenames are recovered).

The route then applies, in order:

| tier | strategy |
|---|---|
| 0 | Direct resolution of `<targetDir>/<segments>` |
| 1 | **Corrupt-entry guard** — if `index.html` looks like a Google/ISP 404 page (`<title>Error 404`, `404. That's an error`, `robot.png`, `af-error-container`) it is marked not-found and **unlinked** from `targetDir`, `baseDir` and root. |
| 2 | `manifest.json` first HTML resource → `<base>/pages` → recursive first-HTML in `<base>` |
| 3 | `<base>/pages/<segments>` then `<base>/assets/<segments>` |
| 4 | Scan every immediate subdirectory of `<base>`, sorted so the subdirectory matching the job hostname is tried first (handles multi-host crawls) |
| 5 | Filename-only recursive search for static extensions (`.js .css .woff2 .woff .ttf .png .jpg .jpeg .svg .json .webp .ico`) |
| 5b | **Next.js image optimiser** — for `_next/image`, `image`, `opengraph-image`, `twitter-image`, read `?url=`/`?src=`/`?img=` and `?w=`/`?width=`, then try `<base>_w<width>.{png,webp}`, the bare filename, and same-stem variants; also prefix-match against `<base>/assets/images` |
| 6 | **SPA fallback** — for extensionless/`.html` navigation requests, serve `targetDir/index.html` → `baseDir/index.html` → first HTML found anywhere |

## Security

After resolution:

```ts
if (!path.resolve(filePath).startsWith(path.resolve(baseDir))) {
  return new Response('Forbidden: Path traversal detected', { status: 403 });
}
```

`X-Frame-Options: ALLOWALL` and
`Content-Security-Policy: frame-ancestors *` are set because the content is
*meant* to be framed.

## On-demand behaviour when nothing is found

1. **Entry-page fetch** — for the root request, `job.url`,
   `https://<hostname>/` and `https://www.<hostname>/` are fetched live and
   written to `index.html`, unless the response looks like a 404 or is under
   500 characters.
2. **Live holding page** — while `status === 'downloading'`, a styled
   dark holding page with `<meta http-equiv="refresh" content="2">` is served
   instead of a 404, so the iframe shows a spinner and self-heals.
3. **On-demand asset proxy** — for static extensions, the missing file is
   fetched from `https://<hostname>/<segments>` and cached into `targetDir`.
   (`demos.pixinvent.com` is special-cased as the remote host.)

## HTML post-processing

For `.html`/`.htm` responses the body is rewritten before serving:

- `<head>` gets an injected script that:
  - seeds `__Secure-next-auth.session-token` and
    `next-auth.session-token` cookies plus `userData` / `accessToken` in
    `localStorage`;
  - patches `window.fetch` to answer `/api/auth/session` locally;
  - neutralises `history.pushState` / `replaceState` calls that target
    `/login` or `/signin` on non-auth pages;
  - intercepts `submit` events and login-button clicks, synthesising a
    session and posting `{type:'webstudio:login_submit', id, email, targetPage}`
    to the parent frame.
- `loading="lazy"` is rewritten to `loading="eager"` so assets load without
  scrolling.

## Response headers

| header | value |
|---|---|
| `Content-Type` | explicit `MIME_OVERRIDES` table first, then `mime-types` |
| `Content-Length` | buffer length |
| `X-Frame-Options` | `ALLOWALL` |
| `Content-Security-Policy` | `frame-ancestors *` |
| `Access-Control-Allow-Origin` | `*` |
| `Set-Cookie` | `webstudio_preview_id=<id>; Path=/; SameSite=Lax` |
| `Cache-Control` | `no-store` while downloading; `public, max-age=3600, must-revalidate` when completed |

The MIME override table exists because Node's `mime-types` gets `.mjs`,
`.woff2` and `.webp` wrong in ways that break ES-module and font loading.

## Errors

| status | body | when |
|---|---|---|
| 404 | `Job not found` | unknown id |
| 404 | `Download files not found` | target directory absent |
| 403 | `Forbidden: Path traversal detected` | resolved path escapes the base |
| 500 | `<message>` | unhandled exception |

## Reimplementation notes

- Order is load-bearing: the SPA fallback must come *after* the static-asset
  search, or a missing chunk would be answered with `index.html` and the
  browser would try to parse HTML as JavaScript.
- The corrupt-entry unlink is destructive on purpose — it prevents a bad
  `index.html` from permanently shadowing a good one.
