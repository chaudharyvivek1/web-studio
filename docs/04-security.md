# Security model

WebStudio fetches arbitrary URLs on behalf of a user and serves the results
back. That is, structurally, an SSRF engine with a web UI. The mitigations
below are real, but they are also incomplete — read the gaps section before
deploying this publicly.

## What is defended

### 1. URL validation — `lib/security/validate-url.ts`

Runs before anything else. Rejects non-HTTP(S) schemes, malformed hosts, and
URLs over 2048 characters, and returns the normalised URL on success.

### 2. Hostname blocklist — in `POST /api/mirror`

```ts
/^localhost$/i
/^127\.\d+\.\d+\.\d+$/
/^10\.\d+\.\d+\.\d+$/
/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/
/^192\.168\.\d+\.\d+$/
/^0\.0\.0\.0$/
/^\[::1?\]$/
```

### 3. DNS guard — `lib/security/dns-guard.ts`

Resolves the hostname and rejects the request if *any* resolved address is
loopback, private, link-local or otherwise non-routable. This is the defence
against a public DNS name that points at `127.0.0.1` (DNS rebinding). Failure
is a `403`, deliberately distinct from the `400` blocklist so operators can
tell the two apart in logs.

### 4. Redirect guard — `lib/security/redirect-guard.ts`

Every redirect hop is re-validated with the same rules, so a permitted host
cannot bounce the crawler into a private network.

### 5. Rate limiting — `lib/security/rate-limit.ts`

A per-IP token bucket consumed at job creation. The IP is the first
`x-forwarded-for` hop, falling back to `127.0.0.1` — so **behind a proxy that
does not set the header, every caller shares one bucket**.

A second, global cap limits concurrent jobs to 50. Stale jobs older than 20 s
with no live process are swept so the cap cannot leak.

### 6. Path traversal — `preview` route

```ts
if (!path.resolve(filePath).startsWith(path.resolve(baseDir))) {
  return new Response('Forbidden: Path traversal detected', { status: 403 });
}
```

Applied after all six resolution tiers, so no fallback can escape the job
directory.

### 7. Content limits — `lib/security/content-limit.ts`

Caps individual response sizes and total job size so a hostile target cannot
exhaust disk.

### 8. Preview framing

`X-Frame-Options: ALLOWALL` and `Content-Security-Policy: frame-ancestors *`
are intentional: the content is meant to be embedded. Note this means a
mirrored page runs with its own scripts inside your origin's frame — see the
gaps.

## Known gaps

These are real. They are documented rather than hidden because anyone
maintaining this codebase needs to know them.

| gap | detail | suggested fix |
|---|---|---|
| **No authentication anywhere** | Every endpoint is public. Anyone who can reach the host can mirror anything, list every job, and download every ZIP. | Put the whole app behind an auth proxy, or add a session check in `middleware.ts`. |
| **`POST /api/mirror/auth` skips validation** | No `validateURL`, no `dnsGuard`, no blocklist. It was written as a demo convenience. | Reuse the `POST /api/mirror` validation sequence. |
| **Job id is the only secret** | Ids are `Date.now().toString(36)` + 5 random base36 chars — roughly 60 million possibilities per millisecond, and guessable in bulk by an attacker who knows roughly when a job was created. | Use a 128-bit random id, or bind jobs to a session. |
| **Mock auth routes** | `/api/auth/session` and `/api/auth/[...nextauth]` return a fabricated admin session with a far-future expiry. They are fixtures, not authentication. | Replace with real NextAuth if you need accounts. |
| **Auth profiles stored in plaintext** | `auth_profiles.storage_state` holds live cookies and tokens. | Encrypt at rest; restrict DB file permissions. |
| **Preview HTML injection** | The preview route injects a script into every HTML response that seeds cookies, patches `fetch`, and rewrites `history`. It runs in your origin. | Serve previews from a separate origin/subdomain. |
| **`wget --no-check-certificate`** | TLS verification is disabled for the mirror strategy. | Remove the flag; accept that some sites will fail. |
| **`x-forwarded-for` trusted blindly** | Rate limiting can be bypassed by spoofing the header if the app is directly exposed. | Trust the header only from a known proxy. |
| **No CSRF protection** | `POST` routes accept any origin; the preview route even sends `Access-Control-Allow-Origin: *`. | Add an origin check on state-changing routes. |

## Hardening checklist for a public deployment

1. Front the app with an authenticating reverse proxy (or add auth middleware).
2. Serve `/api/mirror/[id]/preview/*` from a **separate origin** so mirrored
   scripts cannot read your cookies.
3. Replace job ids with `crypto.randomUUID()`.
4. Drop `--no-check-certificate` from the wget arguments.
5. Reuse the full validation sequence in `/api/mirror/auth`.
6. Encrypt `auth_profiles.storage_state`.
7. Set a hard global disk quota; the per-job limit does not bound the sum.
