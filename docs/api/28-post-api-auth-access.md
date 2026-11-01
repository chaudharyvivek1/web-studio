# `GET|POST|DELETE /api/auth/access`

> **Source:** `app/api/auth/access/route.ts` · **Runtime:** Node.js
> **Auth:** none (this is the login endpoint) · **Route flag:** `dynamic = 'force-dynamic'`

## Purpose

Exchanges the shared access token for a signed session cookie, reports the
current authentication state, and signs out.

This is the only endpoint reachable without a session besides `/login` and static
assets. Full model: [../04-security.md](../04-security.md).

## `GET` — report state

No parameters.

```json
{ "mode": "protected", "required": true, "authenticated": false }
```

`mode` ∈ `open` | `protected` | `misconfigured`. Used by the login screen to
decide what to render, and suitable as a deployment health check.

## `POST` — sign in

| field | type | required | description |
|---|---|---|---|
| `token` | `string` | **yes** | Must equal `WEBSTUDIO_ACCESS_TOKEN` |

Success sets:

```
Set-Cookie: webstudio_access=v1.<issuedAt>.<hmac>; Path=/; HttpOnly;
            SameSite=Strict; Max-Age=604800[; Secure]
```

The value is HMAC-SHA256 over `v1.<issuedAt>`, keyed by the token, computed with
Web Crypto. `HttpOnly` matters specifically here: a mirrored preview page shares
this origin and must not be able to read the session. `Secure` is added when
`NODE_ENV=production`.

```json
{ "success": true }
```

When no token is configured the call is a no-op success with a note:

```json
{ "success": true, "note": "Authentication is not enabled." }
```

## `DELETE` — sign out

Clears the cookie with `Max-Age=0`.

```json
{ "success": true }
```

## Errors

| status | body | when |
|---|---|---|
| 400 | `{"error":"Request body must be JSON with a token field."}` | body is not JSON |
| 400 | `{"error":"Access token is required."}` | `token` missing or empty |
| 401 | `{"error":"Invalid access token."}` | token mismatch |
| 503 | `{"error":"Server is in production mode with no WEBSTUDIO_ACCESS_TOKEN set..."}` | misconfigured deployment |

Comparison is constant-time (`timingSafeEqual`), and the failure message never
hints at how close a guess was.

## Reimplementation notes

- The token must be at least 8 characters or `getAccessToken()` treats it as
  unset — a short token would otherwise be worse than none.
- There is no lockout or backoff on repeated failures beyond the global per-IP
  rate limiter. Add one if the instance is internet-facing with a weak token.
- Sessions are stateless: signing out clears the cookie but the value remains
  valid until it expires, because there is no revocation list. Rotating
  `WEBSTUDIO_ACCESS_TOKEN` invalidates every outstanding session at once.
