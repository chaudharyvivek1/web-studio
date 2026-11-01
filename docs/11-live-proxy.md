# Live proxy — rendering the real site

## Two ways to look at a mirror

The studio's preview panel has two modes, and the difference matters:

| mode | source | good for | breaks when |
|---|---|---|---|
| **Snapshot** | the files the crawler captured, served by `/api/mirror/[id]/preview/...` | auditing exactly what was archived; offline use; what the ZIP will contain | the site is JavaScript-heavy and the crawl is incomplete, or a page was never captured |
| **Live** | the real site, fetched on demand through `/api/mirror/[id]/live/...` | exploring the site as it is right now; signing in; reaching pages that were never crawled | the target is down, unreachable from the server, or blocks the request |

Snapshot answers "what did I capture". Live answers "what does this site
actually do".

## Why live mode exists

A snapshot of a large application is often incomplete: a crawl that is still
running, a client-rendered shell with no data, or a page behind a login all
produce a near-empty frame. That is not a bug in the mirror — it is the honest
state of a partial capture. Live mode sidesteps it entirely by proxying the real
site, which is also what makes **logging in** possible: the POST to the site's
own login form goes to the real server, and the real session cookie comes back.

## How the proxy works

`GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS /api/mirror/[id]/live/[[...path]]`

The request path maps onto the target root, so
`/api/mirror/<id>/live/web/login` proxies `https://<hostname>/web/login`.

### Request

- Method is preserved — a form `POST` really is a `POST` upstream.
- Body is forwarded verbatim for any non-`GET`/`HEAD` method.
- End-to-end headers are forwarded; hop-by-hop headers, `Host`,
  `Content-Length`, `Accept-Encoding`, `Referer` and `Origin` are dropped and
  rebuilt (`Accept-Encoding: identity` so the body is readable for rewriting).
- Cookies are forwarded upstream, **except** WebStudio's own
  (`webstudio_*`, `__Secure-next-auth*`, `next-auth.*`).

### Response

- Body is buffered (25 MB cap) and streamed back with the upstream status.
- `Content-Encoding` and `Content-Length` are stripped, because the body is
  re-encoded after rewriting.
- `X-Frame-Options` and `Content-Security-Policy` are replaced so the page can
  be framed.
- `Set-Cookie` is rewritten for a plain-http localhost origin:
  - `Domain` is dropped — a cookie scoped to `odoo.com` is rejected here;
  - `Secure` is dropped — it would be refused over `http://localhost`;
  - `Path` becomes `/api/mirror/<id>/live/`;
  - `SameSite=None` becomes `SameSite=Lax`, because `None` requires `Secure`.
- Redirects are **not** followed (`redirect: 'manual'`). The `Location` header is
  rewritten to stay inside the proxy when it points at the target host.

### HTML rewriting

Applied to `text/html` responses under 5 MB:

1. Root-relative `href`/`src`/`action`/`poster`/`data-src` values are prefixed.
2. `srcset` entries are prefixed individually.
3. Absolute and protocol-relative URLs for the target host are replaced by the
   prefix.
4. A `<base href="/api/mirror/<id>/live/">` is injected (or an existing one
   replaced) so relative URLs resolve through the proxy.
5. A small runtime patches `window.fetch`, `XMLHttpRequest.prototype.open` and
   `window.open` so **client-side** calls to root-relative paths also route
   through the proxy — this is what keeps SPA data requests working.

**Order matters.** Steps 1–2 run *before* step 3. Doing it the other way round
turns an absolute URL into a root-relative one, which the next rule prefixes
again, producing `/prefix/prefix/...`. Both rules also skip values that already
start with the prefix, so rewriting is idempotent.

### CSS rewriting

`url(/...)` in `text/css` is prefixed the same way.

## Security

- The target hostname is re-checked against the blocklist and the DNS guard on
  every request.
- Redirects are manual and the final `Location` is re-validated.
- Responses are capped at 25 MB; anything larger returns `413`.
- The proxy is unauthenticated, like every other route. Read
  [04-security.md](04-security.md) before exposing it publicly — a live proxy is
  a much more attractive SSRF target than a file server.

## What live mode does not fix

| limitation | consequence |
|---|---|
| `history.pushState` is not rewritten | an SPA route change updates the address bar to a localhost path; reloading that path may 404 |
| URLs built by string concatenation in minified bundles | those requests go to the wrong origin and fail |
| WebSockets | not proxied |
| Third-party origins | left pointing at the real CDN, so they work but are not proxied |
| Anti-bot protection | a site that blocks datacentre IPs will block the proxy too |

These are inherent to a prefix-based reverse proxy without a full interception
layer. Snapshot mode remains the answer for anything that must work offline.

## Using it to sign in

1. Switch the preview panel to **Live**.
2. Navigate to the site's login page inside the frame — or open it directly at
   `/api/mirror/<id>/live/<login-path>`.
3. Sign in normally. The form POSTs through the proxy, the session cookie is
   stored on localhost, and the site redirects you into the authenticated area.
4. Because cookies persist for the browser session, subsequent pages keep you
   signed in.

To make a *capture* authenticated rather than just the live view, use the
**Sign in first** option on the landing page — see
[07-auth-emulation.md](07-auth-emulation.md).

## Verifying the rewrite logic

`rewriteHtml` and `rewriteSetCookie` are pure functions, so they can be tested
without a browser. Extract them and assert:

| input | expected |
|---|---|
| `href="/shop"` | `href="/api/mirror/<id>/live/shop"` |
| `src="https://www.example.com/a.js"` | `src="/api/mirror/<id>/live/a.js"` |
| `href="//www.example.com/about"` | `href="/api/mirror/<id>/live/about"` |
| `srcset="/a.png 1x, /a@2x.png 2x"` | both entries prefixed once |
| `href="https://cdn.other.com/x.woff2"` | unchanged |
| `href="#top"` | unchanged |
| rewriting the output a second time | unchanged (idempotent) |
| `Set-Cookie: s=1; Domain=.example.com; Path=/; Secure; SameSite=None` | no `Domain`, no `Secure`, `Path=/api/mirror/<id>/live/`, `SameSite=Lax` |
