# Auth emulation — cloning the login and sign-up journey

## The problem this solves

A mirror of a password-protected site used to stop at the door. The login form
was captured, so it rendered — but pressing *Sign in* did nothing, because the
`POST` went to an origin that no longer exists. Everything behind the wall was
either missing or reachable only by hand-editing `localStorage`.

Auth emulation closes that gap: the visitor lands on the mirrored site, can
**create an account or sign in on the offline copy itself**, and is then taken
into the authenticated area of the mirror — its pages, its layout, its client
routes.

It is a replay layer, not an authentication system. Read
[Limits and non-goals](#limits-and-non-goals) before relying on it.

## Three phases

```
detect  →  inject  →  replay
lib/authflow/detect.ts   preview route   lib/authflow/runtime.ts
```

### 1. Detect — `lib/authflow/detect.ts`

Scans the captured HTML for password forms and classifies them.

| signal | effect on classification | confidence |
|---|---|---|
| two or more password inputs | `signup` (password + confirmation) | 0.90 |
| form or path contains `sign up / register / create account / join` | `signup` | 0.80 |
| form or path contains `login / sign in / auth` | `login` | 0.80 |
| path matches an auth route but no keyword | `login` | 0.60 |
| password form with no keyword at all | `unknown` | 0.30 |
| a `name` / `first` field next to a password | promotes `login` → `signup` | +0.10 |
| page mentions forgot / reset / recover | `reset` | 0.70 |

For each form it records the method, the action, and every input
(`name`, `type`, `placeholder`, `required`).

It then derives three more things from the captured JavaScript and HTML:

- **Session contract** — cookie names assigned via `document.cookie = "x=…"`
  plus quoted identifiers containing `session|token|jwt|auth|credential`, and
  `localStorage` keys passed to `setItem`/`getItem`.
- **Auth endpoints** — string literals matching `/api/…`, `/auth/…`, `/v1/…`.
- **Entry page** — the most plausible post-login page, preferring
  `dashboard`, `home`, `app`, `admin`, `account`, `settings`, then
  `index.html`.

The whole object is cached to `auth-flow.json` in the job directory so the
preview route and the studio read the same thing, including across restarts.

### 2. Inject — the preview route

`app/api/mirror/[id]/preview/[[...path]]/route.ts` calls `loadAuthFlow()`
(memoised per job, seeded from `auth-flow.json`) and, when `hasAuth` is true,
injects the runtime script into every HTML response.

**Injection order is load-bearing.** Each `<head>` replacement inserts its
script immediately after the opening tag, so the *last* replacement ends up
*first* in the document. The auth runtime is therefore injected *after* the
legacy hydration script's replacement, which places it earlier in `<head>` and
lets it register its `submit` listener first. It then calls
`stopImmediatePropagation()`, so the legacy handler never also fires. Inject the
runtime on the wrong side of that line and both handlers run, producing two
redirects.

### 3. Replay — `lib/authflow/runtime.ts`

`buildAuthRuntimeScript(config, loginPage)` returns a self-contained IIFE. It
must stay ES5 with single quotes and no template literals, because it is
embedded verbatim inside a `String.raw` template — one backtick in the payload
corrupts the generated script. `__CONFIG__` is the single substitution point.

What it does on the page:

1. **Account store** — users live in
   `localStorage['webstudio.auth.users.<jobId>']` as
   `{ "<email>": { h, email, at } }`, where `h` is a non-cryptographic digest.
2. **Session guard** — on `DOMContentLoaded`, if
   `localStorage['webstudio.auth.session.<jobId>']` is absent, it clears the
   session the legacy script seeded. Without this the site would appear already
   logged in and the visitor would never see the login form.
3. **Submit interception** (capture phase, `stopImmediatePropagation`) — reads
   the email and password fields, decides sign-up vs sign-in from the form
   shape, then:
   - **sign up** → create the account (or sign in if it already exists);
   - **sign in** → verify the digest, or auto-enrol when `autoEnrol` is on and
     the email is unknown;
   - a wrong password shows an error toast and **does not** create a session.
4. **Session establishment** — writes every detected cookie name and
   `localStorage` key, plus the internal session record.
5. **Hand-off** — posts `{type:'webstudio:auth', id, email, mode}` to the
   parent frame, then navigates to `entryPage` after ~420 ms.
6. **Public surface** — exposes `window.WebStudioAuth` with
   `session()`, `users()` and `signOut()` so the studio (or a console) can
   inspect and reset the offline state.

## Data written into the browser

| key | contents |
|---|---|
| `localStorage['webstudio.auth.users.<jobId>']` | the offline account table |
| `localStorage['webstudio.auth.session.<jobId>']` | `{ email, name, at }` |
| each detected cookie name | `webstudio_offline_session` |
| each detected `localStorage` key | an identity object, or the token string for keys matching `token|jwt|key|secret` |

Namespacing by job id means two mirrors on the same studio origin never share
accounts.

## The studio surface

`GET /api/mirror/[id]/auth-flow` returns the detection result; the **Auth Flow**
tab renders it — forms, fields, confidence, signals, the post-login page, the
session contract and the auth endpoints — with a direct link to open any
captured form. Re-scanning uses `?refresh=true`.

## Limits and non-goals

- **Not security.** Passwords are stored in `localStorage` behind a `djb2`-style
  hash. Anyone with devtools can read or forge them. It exists so a mirrored
  demo can be walked end to end.
- **Per browser, per device.** Accounts do not sync, export or persist
  server-side, and clearing site data deletes them.
- **No server validation.** Any client-side rule the original app enforced
  (email domain, password strength, captcha) is not reproduced.
- **Detection is heuristic.** A login implemented as a Web Component with no
  `<form>`, or a site that authenticates via OAuth popup, will not be detected.
  The API then reports `hasAuth: false` and the preview falls back to the legacy
  hydration behaviour.
- **Only the journey is replayed.** The mirrored app's own data calls still hit
  dead origins unless those responses were captured. See
  [08-endpoint-discovery.md](08-endpoint-discovery.md) for what to replay next.

## Extending it: replaying the data calls too

The natural next step, and how to do it safely:

1. In the runtime, wrap `window.fetch` and `XMLHttpRequest`.
2. Map `METHOD path` to a file under `api-cache/` in the mirror.
3. Serve the captured JSON for a hit; pass through to the original (dead) URL
   otherwise so failures stay visible rather than silently faked.

Keep the cache keyed on method + normalised path so `GET /api/users/42` and
`GET /api/users/43` do not collide unless you deliberately collapse numeric
segments.

## Acceptance tests

Run these against a real mirror before trusting the feature.

| # | step | expected |
|---|---|---|
| 1 | `GET /api/mirror/<id>/auth-flow` on a site with a login form | `hasAuth: true`, at least one page with `kind: "login"` |
| 2 | open the login page in the preview | the form renders and no session exists (`window.WebStudioAuth.session()` is `null`) |
| 3 | submit with a fresh email | account appears in `WebStudioAuth.users()`, session set, redirect to `entryPage` |
| 4 | sign out, sign in with the same password | succeeds |
| 5 | sign in with a wrong password | error toast, no session created |
| 6 | reload a page inside the app | stays signed in (session record present) |
| 7 | `GET /api/mirror/<id>/auth-flow` on a purely static site | `hasAuth: false`, a note explaining why |
