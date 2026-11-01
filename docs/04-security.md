# Security model

WebStudio fetches arbitrary URLs on behalf of a user, serves the results back,
and can hold live third-party session cookies. That combination needs to be
deliberately constrained.

This document states what is defended, what changed in the hardening pass, and
what is still open.

---

## 1. Access control

### Single-token gate

WebStudio has no user accounts — it is a single-tenant studio. The gate is one
shared secret:

```
WEBSTUDIO_ACCESS_TOKEN  →  POST /api/auth/access { token }  →  Set-Cookie: webstudio_access
```

The cookie value is `v1.<issuedAtMs>.<hmac>`:

- HMAC-SHA256 over `v1.<issuedAtMs>` keyed by the token itself, computed with
  **Web Crypto** so the same module runs in Edge middleware and Node handlers;
- `HttpOnly` — a script inside a mirrored preview page shares this origin and
  still cannot read the session;
- `SameSite=Strict`;
- `Secure` in production;
- valid for seven days, verified by age rather than server-side state.

`middleware.ts` enforces it for every path except `/login` and
`/api/auth/access`. API calls get `401` JSON; page navigations get a redirect.

### Three modes

| `WEBSTUDIO_ACCESS_TOKEN` | `NODE_ENV` | mode | behaviour |
|---|---|---|---|
| set (≥ 8 chars) | any | `protected` | gate enforced |
| unset | development | `open` | everything allowed |
| unset | production | `misconfigured` | **503 with an explanation** |

Production with no token fails closed. Set `WEBSTUDIO_ALLOW_OPEN=1` only if the
instance genuinely is not reachable by anyone else.

### What this closes

The previous gap was that every endpoint — job creation, preview, export,
profile management — was world-readable, and a job id was the only secret. Job
ids are short and time-derived, so they were guessable in bulk. Now the whole
surface requires a session.

---

## 2. CSRF

`middleware.ts` rejects any `POST`/`PUT`/`PATCH`/`DELETE` that a browser reports
as cross-site:

- `Sec-Fetch-Site: cross-site` → `403`;
- otherwise, if an `Origin` header is present, its host must equal the request
  `Host`.

Requests with neither header — `curl`, server-to-server — are allowed, which is
correct: CSRF is a browser-credential attack.

This is the client-transparent half of CSRF defence: no token has to be threaded
through every `fetch` call, and there is no per-form state to get out of sync.

---

## 3. SSRF and URL validation

Every route that accepts a URL runs the same sequence, in this order:

1. `validateURL()` — scheme must be HTTP(S), host well-formed, length capped.
2. Hostname blocklist — `localhost`, `127/8`, `10/8`, `172.16/12`, `192.168/16`,
   `0.0.0.0`, `[::1]`.
3. `dnsGuard()` — resolves the name and rejects any address that is loopback,
   private or link-local. This is the DNS-rebinding defence.
4. `redirectGuard()` — every redirect hop is re-validated, so an allowed host
   cannot bounce the crawler into a private network.
5. Per-IP token bucket, plus a global cap of 50 concurrent jobs with a 20-second
   stale sweep so crashed jobs cannot leak slots.

**Fixed:** `POST /api/mirror/auth` previously skipped all of this and accepted any
`loginUrl`, which made it the easiest SSRF entry point in the application. It now
runs steps 1–3 and the rate limiter exactly as `POST /api/mirror` does.

**Also new:** `GET /api/mirror/[id]/live/[[...path]]` re-checks the target host
against the blocklist and the DNS guard on **every** request, follows redirects
manually, re-validates each `Location`, and caps responses at 25 MB.

---

## 4. Preview and live-proxy content

The preview serves captured HTML with the target's own scripts intact — that is
the point, and it means those scripts run on this origin.

### Mitigations now in place

- The session cookie is `HttpOnly`, so mirrored scripts cannot read it.
- Mutating requests are CSRF-checked by origin, so a mirrored script cannot ride
  the session to create or delete jobs.
- The preview response sets `X-Frame-Options: ALLOWALL` and
  `frame-ancestors *` deliberately — the content is *meant* to be framed.

### Still true, and still a real risk

A mirrored page runs with your origin's privileges for anything a script can do
with credentials attached. The complete fix is to serve previews from a
**separate origin**, which is a deployment change, not a code change. Until then:

> Treat a mirrored page as untrusted code running in your app's origin. Do not
> mirror a site you do not trust into an instance that holds anything valuable.

---

## 5. Stored credentials

Authentication profiles hold live cookies and tokens for third-party sites.

**Fixed:** `storage_state` is sealed with **AES-256-GCM** before it is written and
opened on read.

- Key material: `WEBSTUDIO_SECRET`, falling back to `WEBSTUDIO_ACCESS_TOKEN`.
- Values carry an `enc:v1:` prefix, so pre-existing plaintext rows keep working
  and migrate lazily.
- With no secret configured, values are stored unencrypted and
  `isEncryptionEnabled()` reports false — the docs say so plainly rather than
  implying protection that is not there.
- Changing the secret makes previously sealed profiles unreadable; they return
  empty rather than throwing, and can simply be re-captured.

**Still open:** the profiles table has no per-user ownership. Anyone who can read
the database and reach `/api/auth/profiles` sees the metadata for every profile.

---

## 6. Mock authentication endpoints

`/api/auth/session` and `/api/auth/[...nextauth]` return a fabricated admin
session. They exist so a *mirrored* NextAuth site works offline, because such a
site calls those paths at its own root.

**Fixed:** both routes now refuse unless the request carries the
`webstudio_preview_id` cookie — the one the preview route sets. Outside a mirror
preview they return `403`, so they can no longer be used as a session source for
anything else.

They remain fixtures, not authentication: nothing is signed or verified.

---

## 7. Rate limiting and resource limits

| control | value |
|---|---|
| per-IP token bucket | `lib/security/rate-limit.ts` |
| concurrent jobs | 50, with a 20-second stale sweep |
| wget job wall clock | 20 minutes |
| live proxy response | 25 MB, then `413` |
| per-resource size | `lib/security/content-limit.ts` |
| log tail served | 1 MB / 10 000 lines |

`x-forwarded-for` is trusted for the client IP. Behind a proxy that does not set
it, every caller shares one bucket; if the app is exposed directly, the header
can be spoofed to dodge the limit.

---

## 8. Remaining gaps

| gap | detail | suggested fix |
|---|---|---|
| **Preview shares the app origin** | mirrored scripts run with this origin's privileges | serve previews from a separate origin/subdomain |
| **No per-user ownership** | one shared token, so anyone with it sees every job | add real accounts and bind jobs to them |
| **`x-forwarded-for` trusted** | rate limit can be bypassed when directly exposed | trust it only from a known proxy |
| **TLS verification disabled for wget** | `--no-check-certificate` in the mirror strategy | drop the flag and accept some failures |
| **No audit log** | nothing records who created or downloaded what | append-only job/access log |
| **Profile ownership** | profiles are global, not per-session | scope by owner once accounts exist |
| **Live proxy is an SSRF surface** | guarded, but broader than a file server | keep it behind the gate; consider disabling in production |

---

## 9. Deployment checklist

1. Set `WEBSTUDIO_ACCESS_TOKEN` — a long random value.
2. Set `WEBSTUDIO_SECRET` — separate from the access token if possible.
3. Do **not** set `WEBSTUDIO_ALLOW_OPEN`.
4. Put captured data and the database on a mounted volume
   (`WEBSTUDIO_DATA_DIR`, `WEBSTUDIO_DOWNLOAD_DIR`) so they survive redeploys.
5. Terminate TLS in front of the app; the session cookie is `Secure` in
   production and will not be sent over plain http.
6. Serve previews from a separate origin if you mirror untrusted sites.
7. Set a global disk quota — the per-job limit does not bound the sum.
8. Re-read this document after any change to `middleware.ts`.
