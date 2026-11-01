# Troubleshooting

Every entry is a failure that has actually happened, with the cause and the fix.
If you hit something not listed here, the fastest diagnosis is usually to read
the module named in the error against the contract table in
[09-agent-build-guide.md](09-agent-build-guide.md).

---

## Install and setup

### `npm install` fails with `node-gyp` / "Could not find any Visual Studio installation"

**This is the most common failure and it is not your mistake.**

```
npm error path .../node_modules/better-sqlite3
npm error command failed
npm error command C:\WINDOWS\system32\cmd.exe /d /s /c node-gyp rebuild
npm error gyp ERR! find VS You need to install the latest version of Visual Studio
npm error gyp ERR! find VS including the "Desktop development with C++" workload.
```

**Cause.** `better-sqlite3@13` ships prebuilt binaries inside its tarball
(`prebuilds/win32-x64.node`, `prebuilds/linux-x64.node`, and so on) and loads
them directly from `lib/<platform>-<arch>.js`. **No compiler is needed.** But the
package also ships a `binding.gyp` and declares no `install` script, and npm's
documented behaviour is:

> If there is a `binding.gyp` file in the root of your package and you have not
> defined an `install` or `preinstall` script, npm will default the install
> command to compile using node-gyp.

So npm compiles something that does not need compiling, and fails wherever MSVC
is absent. The install then aborts before linking `next`, which is why the next
command also fails:

```
'next' is not recognized as an internal or external command
```

**Fix.**

```bash
npm run setup
```

which expands to:

```bash
npm install --ignore-scripts --no-audit --no-fund
npx playwright install chromium chromium-headless-shell
```

Or do it by hand:

```bash
npm install --ignore-scripts
npx playwright install chromium chromium-headless-shell
npm run dev
```

**Why `--ignore-scripts` is safe here.** Only three packages in the tree declare
install scripts: the project's own `postinstall` (the Playwright browser
download, which `setup` runs explicitly), `sharp`, and `unrs-resolver`. Both of
the latter ship their native binaries as optional platform packages —
`@img/sharp-win32-x64`, `@unrs/resolver-binding-win32-x64-msvc`, and equivalents
for every other platform — so their install scripts are fallbacks, not
requirements.

**If you would rather compile it properly**, install Visual Studio Build Tools
with the "Desktop development with C++" workload. It works, it is just a
multi-gigabyte download to produce a binary you already had.

### `EBUSY` / `EPERM` during install, "Failed to remove some directories"

```
npm warn cleanup Error: EPERM: operation not permitted, rmdir
  '...\node_modules\crc32-stream\node_modules\readable-stream\lib\ours'
```

A previous, interrupted install left folders locked — usually by an editor, a
terminal, an antivirus scan or a running dev server.

```powershell
# PowerShell
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
npm run setup
```

```cmd
:: cmd.exe
rmdir /s /q node_modules
npm run setup
```

If the removal still complains, close editors and terminals pointed at the
folder, stop any `next dev`, and retry. A reboot clears the rest.

### `npm run i` — "Missing script: i"

There is no `i` script. The command is `npm run setup` (or `npm install`).

### Native module crashes at runtime, or `NODE_MODULE_VERSION` mismatch

`better-sqlite3@13` declares `engines: { node: ">=22" }`. On Node 20 it installs
and then segfaults when the database is first opened.

```bash
node -v     # must be v22 or newer
```

Do not solve a broken install by downgrading Node — that trades a build error
for a runtime crash.

### Port 3000 already in use

```bash
PORT=3001 npm run dev          # macOS / Linux
$env:PORT=3001; npm run dev    # PowerShell
```

---

## Running

### The dev server starts but every job 404s

A route skipped `ensureJobExists(id)`. The in-memory job map does not survive a
restart or a serverless cold start; that helper rehydrates from `job.json`. It is
invariant 2.2 in [09-agent-build-guide.md](09-agent-build-guide.md).

### The studio loads but tabs are empty

The analysis routes derive everything by walking the mirror directory. If
`resolveTargetDir()` cannot find it, they return empty results rather than an
error. Check that `<base>/<jobId>/` actually contains files, and that no route
built its own path instead of using `lib/resolveDir.ts` (invariant 2.1).

### A crawl never finishes

- `wget` jobs are killed at 20 minutes by design.
- The queue engine stops cleanly when `limits` (`maxPages`, `maxAssets`,
  `maxSizeGb`, `maxDurationMin`) are exhausted — a stopped job is not a failed
  one; check the log tail.
- `pause` only works for the queue engine. The `wget` strategy ignores job
  controls; that is a documented limitation, not a bug to chase.

---

## Preview

### White screen inside the iframe

Almost always the asset rewrite. A mirrored SPA requests `/_next/...` or
`/assets/...` from *your* origin. `middleware.ts` rewrites those into the preview
route, resolving the job id from the `Referer` first and the
`webstudio_preview_id` cookie second. If a proxy strips `Referer`, the cookie is
the fallback — confirm it is being set by the preview route.

### A JavaScript chunk returns HTML and the console reports a syntax error

The SPA fallback is running before the static-asset search. Order the tiers as
listed in [07-auth-emulation.md](07-auth-emulation.md) and
[09-agent-build-guide.md](09-agent-build-guide.md) §2.5: the SPA fallback must be
**last**.

### The mirror shows the wrong page for `/`

A captured ISP or Google 404 page was saved as `index.html` and is shadowing the
real page. The corrupt-entry guard should detect it (`<title>Error 404`,
`404. That's an error`, `af-error-container`) and unlink it. If it persists,
delete that file by hand and reload.

### Fonts or modules fail to load with a MIME error

`mime-types` gets `.mjs`, `.woff2` and `.webp` wrong in ways that break ES
modules and font loading. The preview route has an explicit `MIME_OVERRIDES`
table for exactly this; add the extension there rather than patching callers.

### The preview is blank or half-rendered

You are looking at **Snapshot** mode — the captured files. A JavaScript-heavy
site mid-crawl, or a page the crawler never reached, renders as an empty shell.
That is the honest state of a partial capture, not a failure.

Switch the preview panel to **Live** to proxy the real site instead. If Live is
also blank, the target is unreachable from the server, blocking the request, or
exceeded the 25 MB cap — the response will say which.

### Live mode loads the page but clicking a link goes to a localhost 404

An SPA changed the URL with `history.pushState`, which is not rewritten. Reload
the page from the live root, or use Snapshot mode for offline-accurate
navigation. See [11-live-proxy.md](11-live-proxy.md).

### Live mode: I sign in but I am not signed in on the next page

Cookies. `Set-Cookie` is rewritten to drop `Domain` and `Secure` and to scope
`Path` to the proxy prefix — if the site sets its session on a *different*
subdomain, or via JavaScript with `document.cookie` on an explicit domain, the
rewrite will not catch it. Check the browser's cookie list for the localhost
origin.

### The preview shows a spinner that never resolves

That is the live holding page served while `status === 'downloading'`. If the job
is actually finished, the status never flipped — check that the completion marker
(`Crawl completed` / `Offline mirror bundle ready`) reached `crawl_logs.txt`, or
that `wget` exited with files on disk.

---

## Auth emulation

### The mirrored site opens already logged in

The legacy hydration script seeds a session at parse time. The auth runtime
clears it on `DOMContentLoaded` when no local session exists. If the site still
opens logged in, the runtime was not injected — check that
`GET /api/mirror/<id>/auth-flow` returns `hasAuth: true`.

### Login submits twice, or redirects to two different places

The auth runtime must be injected *before* the legacy hydration script in the
document. Because each `<head>` replacement inserts immediately after the opening
tag, that means its replacement line must come **after** the legacy script's line
in the source. Reversing it breaks invariant 2.6.

### The preview throws a parse error inside the page

A backtick or `${` slipped into `CLIENT_SCRIPT` in `lib/authflow/runtime.ts`.
That string is embedded verbatim inside a `String.raw` template; it must stay
ES5 with single quotes. `__CONFIG__` is the only substitution point.

### `hasAuth` is false on a site that clearly has a login

Detection is heuristic: it looks for `<form>` elements containing
`input[type="password"]`. A login built as a Web Component, or handled entirely
through an OAuth popup, will not be found. Check `notes` in the API response — it
explains which signals were missing.

### "Sign in first" opens nothing

`startManualLogin` launches headed only when a desktop session exists: `win32`
and `darwin` always count; Linux needs `DISPLAY` or `WAYLAND_DISPLAY`. If none is
present it falls back to headless, the status payload reports `headless: true`,
and the dialog warns that you cannot sign in on this host.

Fix: run WebStudio on a desktop session. On a headless server, capture the
session on a machine with a display — `POST /api/auth/profiles` accepts a
`storageState` JSON — then pass that profile's id as `authProfileId`. Setting
`WEBSTUDIO_LOGIN_HEADLESS=1` forces headless deliberately.

### "Sign in first" captures a session but the crawl is not authenticated

The profile must reach the job. Confirm the capture request includes
`authProfileId`; `JobManager.createJob` only loads the storage state when it is
present, and the engine only forces the browser path when
`options.storageState` is set.

### A wrong password is accepted

`autoEnrol` is on by default: an unknown email is enrolled on first login so the
journey completes on sites where no sign-up form was captured. That is intended.
Known emails with the wrong password are still rejected.

---

## Export and ZIP

### `GET /api/download/[id]` returns 500 "Failed to generate snapshot archive"

Both zip strategies failed. The route tries system `zip` first and falls back to
the `archiver` stream. Install `zip` (it is also much faster), and check the
server log — the two failures are reported separately.

### The exported bundle will not start

`node server.js` and `python3 serve.py` use only the standard library. If they
fail, the mirror directory is missing or empty — verify the ZIP actually contains
`index.html` at its root.

---

## Deployment

### Everything works locally, nothing works on Vercel

On `VERCEL` / `NOW_BUILDER` the app switches to the pure-Node mirror
(`lib/nativeMirror.ts`) and stores mirrors under `$TMPDIR`. Consequences:

- mirrors are ephemeral — they vanish on redeploy;
- the `wget` strategy is unavailable unless `bin/wget` is present;
- Playwright needs `PLAYWRIGHT_BROWSERS_PATH=0` to be usable at all.

For anything persistent, run it on a normal Node host with a mounted volume.

---

## Reporting a problem

Include, in this order:

1. the exact command and its full output;
2. `node -v` and `npm -v`, plus your OS;
3. whether it is install, crawl, preview, auth or export;
4. for crawl or preview issues, the relevant tail of `crawl_logs.txt`
   (`GET /api/mirror/<id>/logs`) and the job id.

Most issues resolve in one round once those four are on the table.
