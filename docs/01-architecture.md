# Architecture

## The problem

Modern sites are not documents. They are applications that ship a thin HTML
shell, then load JavaScript that builds the page in the browser. A naive
downloader fetches the shell and produces a blank screen. WebStudio exists to
produce something that *looks and behaves* like the original when opened
offline, and to prove what it captured while doing so.

## Four layers

```
┌──────────────────────────────────────────────────────────────┐
│ 1. Presentation        app/page.tsx · app/mirror/[id]/page.tsx│
│                        components/landing · components/mirror │
├──────────────────────────────────────────────────────────────┤
│ 2. Transport           app/api/**  ·  middleware.ts           │
│                        REST + SSE + binary streaming          │
├──────────────────────────────────────────────────────────────┤
│ 3. Engine              lib/crawler · lib/authCrawler ·        │
│                        lib/nativeMirror · lib/processor       │
├──────────────────────────────────────────────────────────────┤
│ 4. State               lib/jobStore (memory) · lib/db (SQLite)│
│                        filesystem mirror · lib/resolveDir     │
└──────────────────────────────────────────────────────────────┘
```

Layers only talk downward. The presentation layer never touches the filesystem;
the engine never writes HTTP responses.

## Four execution strategies

`POST /api/mirror` picks one strategy per job, and this choice is the single
most important thing to understand about the system:

| strategy | when | engine | strengths | weaknesses |
|---|---|---|---|---|
| **Auth crawler** | URL matches a known dashboard template, or `authCrawler: true` | `lib/authCrawler.ts` (Playwright) | Handles login walls, waits for hydration, captures post-login routes | Slow, memory-hungry, needs Chromium |
| **Capture engine v3** | Any of `preset`, `scope`, `scopeConfig`, `captureRules`, `mode`, `authProfileId`, `authSessionId` supplied | `lib/crawler/engine.ts` + `lib/jobs/queue.ts` | Scope rules, limits, pause/resume/cancel, per-asset capture rules, manifest + health | Most complex path; the only one that honours pause |
| **Native mirror** | Serverless (`VERCEL` / `NOW_BUILDER`) | `lib/nativeMirror.ts` (pure Node) | No external binary, works where `wget` cannot run | Less battle-tested link conversion |
| **wget mirror** | Everything else | `bin/wget` or system `wget` | Very fast, proven recursive fetcher | No JS execution, cannot be paused |

The strategies are ordered by specificity. A request carrying both a preset and
a dashboard URL takes the auth path and silently drops the preset — a real
sharp edge, documented so it is not rediscovered.

## Why the preview route is 760 lines

`/api/mirror/[id]/preview/[[...path]]` is where every offline-mirroring bug
ends up. It carries six tiers of file resolution, an on-demand network proxy, a
live holding page, HTML post-processing, and a path-traversal guard. It is
large because the alternative — a static file server — cannot answer the
question "the SPA just requested a chunk that we never downloaded, and the user
is looking at a white screen right now".

The middleware exists for the same reason: mirrored SPAs emit root-relative
asset URLs that never mention the job id, so something has to re-attach it.

## Dual persistence

- **In memory** (`lib/jobStore.ts`): `activeJobs`, `activeProcesses`,
  `activeJobControls`. Fast, and the source of truth for live progress. Pinned
  onto `globalThis` so Next.js hot reload does not lose it in development.
- **SQLite** (`lib/db/`): durable job, page, asset and error rows plus auth
  profiles. Survives restarts and is what `retry` and `manifest` read from.

Every job-scoped route calls `ensureJobExists(id)` first, which rehydrates the
in-memory record from disk (`job.json`) after a cold start. That single helper
is why the app works on a serverless host at all.

## Deliberate constraints

- **No user accounts.** There is no tenancy model; a job id is the only access
  token. See `04-security.md` for what that implies.
- **One job per id, no deduplication.** Two requests for the same URL create
  two independent mirrors.
- **Filesystem is the database for content.** Progress, stats, assets and the
  file tree are all derived by walking directories, with timestamp caches
  (3–5 s) to keep it affordable.
