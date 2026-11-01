# `GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS /api/mirror/[id]/live/[[...path]]`

> **Source:** `app/api/mirror/[id]/live/[[...path]]/route.ts` · **Runtime:** Node.js
> **Auth:** none · **Route flag:** `dynamic = 'force-dynamic'`

## Purpose

A live reverse proxy for the mirrored target. Where
`/api/mirror/[id]/preview/...` serves *captured files*, this route serves the
**real website**, fetched on demand.

It exists so the studio can render a page exactly as it is today — including
pages that were never captured — and so that forms actually work. A `POST` to the
site's own login form reaches the real server, the real `Set-Cookie` comes back,
and the visitor ends up inside the real authenticated application.

Full behaviour: [../11-live-proxy.md](../11-live-proxy.md).

## Request

| location | name | type | description |
|---|---|---|---|
| path | `id` | `string` | Job id; supplies the target hostname |
| path | `path[]` | `string[]` | Optional segments, mapped onto the target root |
| query | — | — | Forwarded verbatim to the target |

The method is preserved, and the request body is forwarded for every non-`GET`
method, so form submissions and JSON API calls both pass through.

### Headers

Forwarded: everything end-to-end. Dropped and rebuilt: hop-by-hop headers,
`Host`, `Content-Length`, `Accept-Encoding` (forced to `identity`), `Referer`,
`Origin`, and `Cookie`.

`Cookie` is rebuilt from the incoming request, excluding WebStudio's own cookies
(`webstudio_*`, `__Secure-next-auth*`, `next-auth.*`).

## Behaviour

1. `ensureJobExists(id)` → `404` plain text.
2. Hostname must contain a dot → `400`; must not be private → `403`.
3. `dnsGuard(hostname)` → `403` with the reason when blocked.
4. Upstream request with a 30-second timeout, `redirect: 'manual'`.
5. Redirect responses (`3xx`): `Location` is rewritten into the proxy when it
   points at the target host, and the status is passed through with no body.
6. Normal responses: the body is buffered (25 MB cap → `413`), then
   `text/html` and `text/css` under 5 MB are rewritten.
7. Every `Set-Cookie` is rewritten: `Domain` and `Secure` dropped, `Path` set to
   `/api/mirror/<id>/live/`, `SameSite=None` demoted to `Lax`.
8. `X-Frame-Options: ALLOWALL` and `Content-Security-Policy: frame-ancestors *`
   are set so the page can be framed.

## Response

Whatever the target returned, with the status preserved. HTML is rewritten:
root-relative and target-host URLs are pointed at the proxy prefix, a
`<base href>` is injected, and a runtime patches `fetch` / `XMLHttpRequest` /
`window.open` so client-side calls to root-relative paths also route through the
proxy.

## Errors

| status | body | when |
|---|---|---|
| 400 | `Target hostname unavailable` | job has no usable hostname |
| 403 | `Refusing to proxy a private address` | hostname is loopback / RFC1918 |
| 403 | `Security check blocked: <reason>` | DNS guard rejected the host |
| 404 | `Job not found` | unknown id |
| 413 | `Live response exceeded the size limit` | body larger than 25 MB |
| 502 | `Live fetch failed: <message>` | upstream unreachable or timed out |

## Reimplementation notes

- Cookies are the hardest part. A cookie scoped to `Domain=.odoo.com` is
  silently discarded by the browser on a localhost origin, and a `Secure` cookie
  is discarded over plain http. Stripping both is what makes login work locally —
  and is also why live mode must not be used as a security boundary.
- Rewrite order is load-bearing: root-relative rules run before the
  absolute-host rule, or absolute URLs get prefixed twice. See the verification
  table in [../11-live-proxy.md](../11-live-proxy.md).
- This route is a far more attractive SSRF target than the file server. Read
  [../04-security.md](../04-security.md) before exposing it publicly.
