# The crawl lifecycle

This is the end-to-end path a single capture takes. Every step names the file
that implements it, so the document doubles as a reading guide.

## 0. The user pastes a URL

`components/landing/URLInput.tsx` collects the address;
`components/landing/CapturePresets.tsx` offers five presets
(`quick`, `website`, `full`, `max_capture`, `authenticated`); the optional
`components/capture/CaptureConfigDialog.tsx` exposes scope, depth, limits and
per-asset capture rules. The landing page assembles a single JSON body.

## 1. Job creation — `POST /api/mirror`

Twelve sequential validation steps (see `api/01-post-api-mirror.md`), then a
strategy is chosen and the job is registered. The HTTP response is
`{ "id": "…" }` and arrives in milliseconds — nothing is awaited.

## 2. Discovery and fetch — the engine

Which engine runs depends on the strategy:

- **wget** walks links itself, honouring `--domains`, `--no-parent` and
  `--page-requisites`, converting links as it goes. Progress is inferred from
  the log file and the growing directory.
- **`CrawlEngine`** (`lib/crawler/engine.ts`) runs a real frontier:
  1. `lib/crawler/mode.ts` inspects the first response and decides
     `fast | balanced | browser | auto`.
  2. `lib/crawler/discovery/` extracts candidates three ways — `html.ts`
     (links, scripts, styles, images), `css.ts` (`url()` and `@import`), and
     `sitemap.ts` (`/sitemap.xml`, `/robots.txt`).
  3. `lib/crawler/scope.ts` filters candidates against `scopeConfig`
     (same host, same registrable domain, path prefix, depth).
  4. `lib/crawler/visited.ts` deduplicates by normalised URL and by content
     hash.
  5. `lib/crawler/queue.ts` and `lib/crawler/concurrency.ts` run a bounded
     worker pool with politeness delays.
  6. `lib/crawler/retry.ts` applies exponential backoff on 5xx, 429 and
     network errors; `lib/crawler/redirects.ts` resolves chains;
     `lib/security/redirect-guard.ts` re-checks every hop for SSRF.
  7. `lib/crawler/limits.ts` enforces `maxPages`, `maxAssets`, `maxSizeGb`
     and `maxDurationMin`, stopping cleanly rather than throwing.
- **`runAuthCrawler`** (`lib/authCrawler.ts`, the largest module at ~1.7k
  lines) drives Playwright: it logs in, waits for network idle, then walks the
  authenticated app, capturing rendered DOM rather than raw responses.

## 3. Storage

`lib/processor/pipeline.ts` takes each response through:
`classify.ts` (what kind of resource is this) → `hash.ts` (SHA-256) →
`rewrite.ts` (make every URL in the document point at its local copy) →
`lib/storage/local.ts` (write to disk under the resolved target directory).

`lib/resolveDir.ts` decides *where*: cached `resolvedDir` → exact hostname →
`www.` variant → subdirectory containing `index.html` → largest-file-count
heuristic. Every route goes through it, which is what keeps the six-tier
preview route and the ZIP exporter pointing at the same tree.

## 4. Observation — the studio

`app/mirror/[id]/page.tsx` mounts the studio. It opens one `EventSource` on
`/api/mirror/[id]/progress` and renders stats and the log tail from those
frames. The tab strip then polls the analysis endpoints:

| tab | endpoint | cadence |
|---|---|---|
| Dash | `/overview` | on mount, then on demand |
| Pages | `/overview` (page list) | on mount |
| Assets | `/assets` | on mount |
| Files | `/files` | on mount |
| Health | `/health` | on mount |
| Network | `/network` | on mount |
| Logs | `/logs` | polled alongside SSE |

The preview iframe points at `/api/mirror/[id]/preview/…`. Every sub-resource
it requests is either served from disk or, if missing, fetched live and cached
by the same route.

## 5. Completion

The job flips to `completed` when the log shows a completion marker or, for
wget, when the process exits with files on disk. `lib/jobs/manifest.ts` writes
`manifest.json` with per-resource records and a health score. From then on the
analysis endpoints serve cached values and the preview route switches to
`public, max-age=3600`.

## 6. Export — `GET /api/download/[id]`

`createCompleteRunnableBundle()` writes `server.js`, `serve.py`, `start.sh`,
`start.bat` and a generated `README.md` into the mirror, then the tree is
zipped (system `zip`, falling back to `archiver`) and streamed. The ZIP is kept
on disk so repeat downloads are free.

The bundle is the product's real output: a folder you can hand to someone who
has Node or Python and nothing else.

## Failure paths

| failure | what the user sees |
|---|---|
| DNS guard blocks the host | 403 at creation time, no job created |
| Target returns nothing | job `failed` with the wget exit code |
| Crawl stalls | wget killed at 20 minutes |
| Page missing mid-preview | live holding page (spinner) while downloading; on-demand fetch once complete |
| Corrupt `index.html` captured | detected as an ISP/Google 404 page and unlinked, then fallback tiers run |
| Process restart | `ensureJobExists()` rehydrates from `job.json` |
