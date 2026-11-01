# Build guide for an AI agent

You are reading this because you are about to build, extend or repair WebStudio.
This document is written for you: it states the invariants the system depends on,
the order to build in, the contract each module must honour, and how to prove the
work is correct without a human watching.

Read [01-architecture.md](01-architecture.md) and
[02-crawl-lifecycle.md](02-crawl-lifecycle.md) first if you have not. They explain
*what* the system is; this document explains *how to build it* and *how not to
break it*.

---

## 0. Ground rules

1. **Never fabricate a result.** If a crawl, a route or a build step did not
   run, say so. A reported success that did not happen is worse than a reported
   failure.
2. **Prefer additive change.** This is a 13,000-line codebase with a crawler that
   cannot be verified by reading. New modules and new routes are cheap; rewriting
   `lib/crawler/` is expensive and will silently change behaviour.
3. **Verify with the tools you have.** Syntax-check every TypeScript file before
   claiming a change compiles. Run pure modules against fixtures. Do not claim a
   UI works because the code looks right.
4. **One source of truth per concern.** The rules in §2 are not stylistic
   preferences; violating them produces bugs that only appear under load or
   after a restart.

---

## 1. Prerequisites

| need | why |
|---|---|
| Node 22+ | `better-sqlite3@13` declares `engines.node >= 22` and will segfault on 20 |
| Playwright + Chromium | the browser engine and every authenticated crawl |
| system `wget` | the fast mirror strategy; optional but strongly preferred |
| system `zip` | much faster export than the JS fallback |

**Always install with `npm run setup`**, never a bare `npm install`.

`better-sqlite3@13` ships prebuilt binaries (`prebuilds/win32-x64.node`) but also
ships a `binding.gyp` with no declared install script, so npm automatically runs
`node-gyp rebuild` — which needs MSVC on Windows and fails everywhere it is
absent. `npm run setup` expands to
`npm install --ignore-scripts && npx playwright install chromium
chromium-headless-shell`, skipping the pointless compile and fetching the
browsers explicitly. Skipping install scripts is safe here because the only
packages that declare them (`sharp`, `unrs-resolver`) ship their binaries as
optional platform packages.

Do not "fix" a failed install by downgrading Node: `better-sqlite3@13` requires
Node 22 or newer and segfaults on 20. See
[10-troubleshooting.md](10-troubleshooting.md).

---

## 2. Invariants — break these and the app breaks

These are the load-bearing rules. Each one exists because violating it caused a
real bug.

### 2.1 Every filesystem path goes through `lib/resolveDir.ts`

`getBaseDownloadDir(id)` and `resolveTargetDir(id, hostname)` are the only
permitted way to locate a job's files. A route that builds a path itself will
disagree with the preview route about where the mirror lives, and the mirror will
render blank.

### 2.2 Every job-scoped route calls `ensureJobExists(id)` first

The in-memory job map is lost on restart and on every serverless cold start.
`ensureJobExists` rehydrates from `job.json`. Skip it and every in-flight job
becomes a 404 after a redeploy.

### 2.3 Live state lives in `lib/jobStore.ts`, durable state in `lib/db/`

`activeJobs`, `activeProcesses`, `activeJobControls` are the hot path. SQLite is
for anything that must survive a restart. Do not make SQLite the progress path;
do not treat the in-memory map as durable.

### 2.4 Security helpers are imported, never re-implemented

`validateURL`, `dnsGuard`, `redirectGuard`, `contentLimit` and the rate limiter
live in `lib/security/`. A new route that accepts a URL must run the same
sequence as `POST /api/mirror`: validate → blocklist → DNS guard → rate limit.
`POST /api/mirror/auth` is the existing counter-example and is flagged as a gap
in [04-security.md](04-security.md) — do not copy it.

### 2.5 In the preview route, resolution order is not negotiable

The six tiers exist in a specific order. In particular:

- the **SPA fallback must be last** — if it runs before the static-asset search,
  a missing JavaScript chunk is answered with `index.html` and the browser
  reports a syntax error;
- the **path-traversal guard must run after every tier** — placing it earlier
  lets a fallback escape the job directory;
- the **corrupt-entry guard** deliberately unlinks a captured ISP/Google 404 page
  saved as `index.html`, because it would otherwise shadow the real page forever.

### 2.6 The auth runtime must be injected before the legacy hydration script

Each `<head>` replacement in the preview route inserts immediately after the
opening tag, so the **last** replacement ends up **first** in the document. The
auth runtime's replacement is written after the legacy script's replacement for
exactly this reason: it must register its `submit` listener first so
`stopImmediatePropagation()` prevents the legacy handler from also firing.
Reverse the order and every login submits twice.

### 2.7 The injected client script is a `String.raw` template

`CLIENT_SCRIPT` in `lib/authflow/runtime.ts` is embedded verbatim. It must stay
ES5, single-quoted, with **no backticks and no `${`**. `__CONFIG__` is the only
substitution point. A stray backtick corrupts the generated script and the
preview fails with a parse error inside a page you cannot easily inspect.

### 2.8 The access gate runs first, in middleware

`middleware.ts` authenticates before it rewrites anything. A new route inherits
the gate automatically — do **not** add it to `PUBLIC_PATHS` unless it must work
without a session (there are exactly two: `/login` and `/api/auth/access`).

If you add a route that returns data, assume it is protected and make sure it
behaves correctly with a `401` when the cookie is missing.

### 2.9 Preview helpers live in `lib/preview/`

The preview route is an orchestrator. MIME overrides, path resolution and the
containment guard are in `lib/preview/{mime,paths,security}.ts` so they can be
tested without a server.

The containment check (`isWithinBase`) runs **once, after every resolution
tier**. Moving it inside a tier lets a later fallback escape the job directory.

### 2.10 Analysis modules are pure

`lib/analysis/*` takes data and returns a result. No network, no request object,
no filesystem writes. This is what makes them testable against fixtures — the
way the endpoint and auth detectors are verified below.

---

## 3. Build order

Each phase ends in something observable. Do not skip ahead; later phases assume
the earlier ones work.

| phase | deliverable | proof it works |
|---|---|---|
| 0 | prerequisites installed | `node -v` ≥ 22, `npx playwright --version` |
| 1 | static mirror + file server | `wget --mirror` output opens in a browser |
| 2 | `POST /api/mirror`, `GET …/progress`, `GET …/files` | a job id, an SSE stream, a file tree |
| 3 | `GET …/preview/[[...path]]` with all six tiers | a real SPA renders inside the iframe |
| 4 | `middleware.ts` asset rewrite | the SPA renders *without* manual URL fixes |
| 5 | crawl engine, scope, limits, presets | a scoped crawl respects its budget |
| 6 | pause / resume / cancel / retry | status transitions are observable |
| 7 | auth capture + emulation | the login journey completes offline |
| 8 | ZIP export with runnable bundle | `node server.js` serves the mirror |
| 9 | analysis surface (overview, assets, health, network, endpoints) | tabs populate |
| 10 | SQLite persistence | `retry` works after a restart |

[05-recreation-guide.md](05-recreation-guide.md) expands each phase with the
specific traps.

---

## 4. Module contracts

Each module's responsibility, and what it must not do.

| module | responsibility | must not |
|---|---|---|
| `lib/resolveDir.ts` | decide where a job's files are | do any I/O beyond existence checks |
| `lib/jobStore.ts` | hold live job/process/control state | touch the database |
| `lib/db/client.ts` | durable CRUD over SQLite | be on the progress hot path |
| `lib/security/validate-url.ts` | accept or reject a URL | fetch the URL |
| `lib/security/dns-guard.ts` | reject hosts resolving to private ranges | cache decisions forever |
| `lib/crawler/engine.ts` | orchestrate a frontier crawl | return HTTP responses |
| `lib/crawler/scope.ts` | decide if a URL is in scope | mutate the frontier |
| `lib/crawler/limits.ts` | enforce page/asset/byte/time budgets | throw on budget exhaustion — it must stop cleanly |
| `lib/processor/rewrite.ts` | make document URLs point at local copies | fetch anything |
| `lib/authflow/detect.ts` | find auth forms and the session contract | execute target code |
| `lib/authflow/runtime.ts` | render the injected client script | contain backticks |
| `lib/analysis/endpoints.ts` | merge three sources into one catalogue | call the network |
| `lib/analysis/health.ts` | score a mirror 0-100 | read files |
| `lib/preview/paths.ts` | resolve a request path to a file on disk | touch the request |
| `lib/preview/security.ts` | decide whether a resolved path is inside the job dir | resolve paths itself |
| `lib/security/app-auth.ts` | sign and verify the session cookie | use `node:crypto` (must run on Edge) |
| `lib/security/crypto.ts` | seal and open stored profiles | be imported by middleware (Edge) |
| `app/api/**/route.ts` | validate, delegate, respond | contain crawl logic |

---

## 5. Verifying work without a browser

You will usually be unable to run the Next.js dev server. That is not a reason to
guess. Use these three checks in order.

### 5.1 Syntax-check every TypeScript file

Bundle a parser and transform each file. `esbuild` is enough and installs in
seconds:

```bash
mkdir -p tools && cd tools
echo '{"name":"tools","private":true,"version":"1.0.0"}' > package.json
npm install esbuild
```

```js
// tools/check.mjs
import * as esbuild from 'esbuild';
import fs from 'fs'; import path from 'path';
const root = '<repo>'; const files = [];
(function walk(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})) {
  if (['node_modules','.git','.next'].includes(e.name)) continue;
  const p = path.join(d,e.name);
  if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
}})(root);
let fail = 0;
for (const f of files) {
  try { await esbuild.transform(fs.readFileSync(f,'utf8'),
        { loader: f.endsWith('.tsx') ? 'tsx' : 'ts', jsx: 'automatic', target: 'es2022' }); }
  catch (e) { fail++; console.log('FAIL', f, e.errors?.[0]?.text); }
}
console.log(`checked ${files.length} files, failures: ${fail}`);
```

**Do not** run `npm install` in the project on a memory-constrained machine; it
can OOM the npm process itself. Install only the tools you need, in a separate
directory.

### 5.2 Run the pure modules against fixtures

`lib/authflow/detect.ts` and `lib/analysis/endpoints.ts` have no Next.js
dependencies, so they bundle and run under plain Node:

```bash
npx esbuild lib/authflow/detect.ts --bundle --platform=node --format=cjs --outfile=/tmp/detect.js
node -e "console.log(require('/tmp/detect.js').detectAuthFlow('j','example.com','/tmp/mirror'))"
```

Build a fixture mirror (`login.html` with one password field, `signup.html` with
two, `dashboard.html`, an `assets/app.js` containing
`axios.post('/api/auth/login')` and `api.get('/api/users/42/profile')`) and assert:

- `login.html` → `kind: "login"`, confidence ≥ 0.8
- `signup.html` → `kind: "signup"`, confidence ≥ 0.9
- `entryPage` → `dashboard.html`
- `sessionCookies` includes the cookie name assigned in the JS
- `storageKeys` includes the `localStorage` key
- the catalogue has **both** `GET /api/auth/login` and `POST /api/auth/login`
- `/api/users/42/profile` is `GET` and `parameterised: true`

That last pair is the regression test for verb inference — see
[08-endpoint-discovery.md](08-endpoint-discovery.md).

### 5.3 Test the injected script in a fake DOM

Extract `CLIENT_SCRIPT`, `node --check` it, then evaluate it with stubs for
`window`, `document` and `localStorage`, capture the registered `submit`
listener, and drive it with fake forms. Assert:

1. sign up with a new email → account created, session set
2. sign in with the right password → session set
3. sign in with a wrong password → **no** session created
4. `signOut()` → session cleared

### 5.4 Structural checks

- Every `app/api/**/route.ts` has a document in `docs/api/`.
- Every doc's declared `**Source:**` path exists.
- No internal markdown link in `docs/` is broken.
- `package.json` and `package-lock.json` parse.

---

## 6. Failure modes and their causes

| symptom | cause | fix |
|---|---|---|
| `'next' is not recognized` | install aborted earlier | clean `node_modules`, reinstall |
| `node-gyp` / MSVC error on Windows | npm's fallback build for `better-sqlite3` | `npm run setup` (or `npm install --ignore-scripts`) |
| segfault at runtime on SQLite | Node 20 with `better-sqlite3@13` | use Node 22+ |
| preview shows a white screen | SPA asset URLs hit your origin | check `middleware.ts` referer matching |
| missing chunk returns HTML | SPA fallback ordered before static search | move the fallback last |
| mirror renders the wrong page for `/` | a captured ISP 404 saved as `index.html` | the corrupt-entry guard should unlink it |
| every job 404s after redeploy | a route skipped `ensureJobExists` | add it |
| login submits twice | auth runtime injected after the legacy script | reverse the injection order |
| everything 503s | production with no `WEBSTUDIO_ACCESS_TOKEN` | set the token, or `WEBSTUDIO_ALLOW_OPEN=1` |
| API 401s but pages load | `Secure` cookie over plain http | terminate TLS, or run in development |
| profiles unreadable after deploy | `WEBSTUDIO_SECRET` changed | keep the secret stable; re-capture |
| jobs vanish on redeploy | storage dirs not on a mounted volume | set `WEBSTUDIO_DATA_DIR` / `WEBSTUDIO_DOWNLOAD_DIR` |
| preview script syntax error | a backtick or `${` inside `CLIENT_SCRIPT` | keep it ES5 |
| pause does nothing | the `wget` strategy ignores job controls | documented limitation, not a bug to chase |
| `POST /api/mirror/auth` accepts anything | it skips URL validation | known gap, see security doc |

---

## 7. Extension recipes

### Add an endpoint

1. Create `app/api/<path>/route.ts` exporting `GET`/`POST`.
2. `ensureJobExists(id)` first; `resolveTargetDir` for any path.
3. Return `NextResponse.json(...)`; errors as `{ error: string }`.
4. Add `docs/api/NN-<slug>.md` using the same template, and a row in
   `docs/api/README.md`.

### Add a studio tab

1. Create `components/mirror/XTab.tsx` as a self-fetching client component
   taking `{ id }` so no state needs threading.
2. Import it in `app/mirror/[id]/page.tsx`, add a `TabsTrigger` and a
   `TabsContent` with `data-[state=inactive]:hidden`.
3. Handle three states explicitly: loading, error, empty.

### Add an auth heuristic

1. Add the signal to `classifyForm` in `lib/authflow/detect.ts` and adjust
   confidence.
2. Add a row to the signal table in [07-auth-emulation.md](07-auth-emulation.md).
3. Add a fixture page and an assertion to the §5.2 test set.

---

## 8. Definition of done

A change is complete only when all of these hold:

- [ ] every `.ts`/`.tsx` file passes the syntax check
- [ ] pure modules were exercised against a fixture, not just read
- [ ] new routes appear in `docs/api/README.md` with their own document
- [ ] new behaviour is described in the relevant `docs/` file
- [ ] no invariant in §2 was violated
- [ ] anything that could not be verified is stated plainly in the summary
