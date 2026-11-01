# Recreation guide

How to rebuild this system from nothing, in the order that keeps it runnable at
every step. Each phase ends with something you can see working.

## Phase 0 — prerequisites

Node 20+, and for the browser engine, Playwright with Chromium. Optional but
recommended: system `zip` (much faster than the JS fallback) and `wget`.

## Phase 1 — a static file server that mirrors one site

Start with the smallest thing that is useful. Fetch a site with `wget --mirror
--page-requisites --convert-links --adjust-extension`, then serve the resulting
directory. You now have the core value proposition and a baseline to compare
every later phase against.

**Do not skip this.** Most of the complexity in the final system exists to fix
specific ways this naive approach fails; knowing those failures firsthand is
what makes the rest make sense.

## Phase 2 — job identity and the three endpoints

Add:

1. `POST /api/mirror` — mint an id, create the directory, dispatch the fetch in
   the background, return `{id}` immediately.
2. `GET /api/mirror/[id]/progress` — SSE, 2-second interval, tail the log,
   walk the directory for counters.
3. `GET /api/mirror/[id]/files` — recursive tree.

At this point you have a working product. Everything after this is fidelity and
control.

**Critical detail:** `ensureJobExists(id)` must rehydrate the job from
`job.json`. Without it, a server restart or a serverless cold start turns every
in-flight job into a 404, and you will chase that bug for a week.

## Phase 3 — the preview route

This is the hard part. Build the resolution tiers in this order and test each
against a real site:

1. Exact file, then `index.html` in a directory, then `+'.html'`.
2. `manifest.json` entry page, then `<base>/pages`, then recursive first HTML.
3. Subdirectory scan, hostname-matching subdirectory first.
4. Filename-only recursive search for static extensions.
5. SPA fallback to `index.html` — **last**, never before the static search.
6. Path-traversal guard around all of the above.

Then add, in this order: explicit MIME overrides, the live holding page for
in-progress jobs, on-demand asset fetching, and only then HTML post-processing.

**Traps:**
- `mime-types` gets `.mjs`, `.woff2` and `.webp` wrong. Hard-code them.
- A captured ISP 404 page saved as `index.html` will shadow everything. Detect
  and unlink it.
- If the SPA fallback runs before the static-asset search, missing chunks get
  served as HTML and the browser reports a syntax error in JavaScript.

## Phase 4 — the asset rewrite middleware

Once the preview works when you navigate to it directly, it will still fail
inside the iframe, because the mirrored app requests `/_next/static/...` and
`/assets/...` from *your* origin. Add the middleware: resolve the job id from
`Referer` first, then from a cookie the preview route sets, and rewrite
unmatched paths into the preview route.

The `/_next` case needs the referer check — both apps use that prefix, and only
the referer distinguishes them.

## Phase 5 — scope, limits and the real engine

Replace the naive fetcher with a frontier:

1. `discovery/` — extract candidates from HTML, CSS and sitemaps.
2. `scope.ts` — filter by host, registrable domain, path prefix, depth.
3. `visited.ts` — dedupe by normalised URL **and** content hash.
4. `concurrency.ts` + `queue.ts` — bounded worker pool with politeness delays.
5. `retry.ts` — exponential backoff on 5xx/429/network.
6. `limits.ts` — pages, assets, bytes, duration; stop cleanly.

Then wire `presets.ts` so a user can pick a budget instead of specifying twelve
fields.

## Phase 6 — control: pause, resume, cancel

Add `activeJobControls` with `isPaused`, `isCancelled` and a
`pausePromiseResolve`. The engine parks on that promise; `resume` resolves it.

**Known inconsistency to fix, not copy:** the `wget` strategy ignores these
flags entirely. If you want pause to be uniform, either drop the wget strategy
or implement it by sending `SIGSTOP`/`SIGCONT` to the child process.

## Phase 7 — authentication

Two flows:

- **Automatic** (`/api/mirror/[id]/auth-login`) — launch Chromium, detect
  credentials from page text, prefilled inputs, then known template defaults;
  fill, submit, poll for a session cookie; save `storageState`.
- **Manual** (`/api/auth/login`) — launch, let the operator log in, snapshot.

Persist snapshots as profiles (`/api/auth/profiles`) so later crawls can replay
them via `authProfileId`.

For offline preview of an authenticated SPA you also need the injected
hydration script: seed the session cookie and `localStorage`, patch `fetch` to
answer the session endpoint locally, and neutralise `history.pushState`
redirects to `/login`.

## Phase 8 — export

Write `server.js`, `serve.py`, `start.sh`, `start.bat` and a generated
`README.md` into the mirror, then zip it. Cache the ZIP on disk.

The launchers must be genuinely zero-dependency — standard library only. The
value of the bundle is that the recipient installs nothing.

## Phase 9 — analysis surface

Everything else is presentation over data you already have: overview stats,
asset library with palette extraction, health score, network waterfall,
manifest. All of it is directory walking plus extension classification, so
cache aggressively (3–5 s TTLs) or these endpoints become the bottleneck.

## Phase 10 — persistence

Move job, page, asset and error records into SQLite (`lib/db/schema.ts`) so
`retry` and `manifest` survive a restart. Keep the in-memory store as the
live-progress cache; do not try to make SQLite the hot path.

## Things to do differently

If you are rebuilding rather than maintaining, these are the changes worth
making early:

1. **Real auth and per-user job ownership.** The current model has none.
2. **`crypto.randomUUID()` job ids.** Current ids are guessable.
3. **Serve previews from a separate origin.** The injected script currently
   runs in your app's origin.
4. **One engine, not four.** Four strategies means four sets of bugs. Pick the
   frontier engine and make the others thin adapters.
5. **Stream results, not the filesystem.** Progress is inferred by walking
   directories; the engine already knows the counts and should emit them.
6. **Uniform pause/cancel.** Make every strategy honour the control record.
7. **Drop the third-party template special-cases.** `vuexy`, `pixinvent` and
   `admin-template` string matches in the job router are scaffolding for one
   demo target; generalise them into a configurable "known auth portals" list.
