# Deployment

## Sizing

The browser engine is the constraint. Every authenticated or JavaScript-rendered
crawl launches a full Chromium instance, and Chromium does not run comfortably in
a few hundred megabytes.

| workload | practical floor |
|---|---|
| static sites only, native mirror | 512 MB |
| HTTP crawl engine, no browser | 1 GB |
| Playwright / authenticated crawls | **2 GB** |
| several concurrent browser crawls | 4 GB+ |

`render.yaml` ships with a 1536 MB Node heap and a `starter` plan. The free tier's
512 MB is not enough for Playwright — it will be OOM-killed mid-crawl, which looks
like a mysterious `failed` job with no log tail.

```yaml
- key: NODE_OPTIONS
  value: "--max-old-space-size=1536"
```

Raising the heap without raising the instance size just moves the failure from a
clean JS error to the kernel's OOM killer.

## Node version

**Node 22 or newer.** `better-sqlite3@13` declares `engines.node >= 22`; on Node
20 it installs and then segfaults the first time the database is opened.
`render.yaml` pins `NODE_VERSION=22`.

## Installing without a C++ toolchain

Always:

```bash
npm run setup
```

which runs `npm install --ignore-scripts` and then fetches the Playwright
browsers. See [10-troubleshooting.md](10-troubleshooting.md) for why a bare
`npm install` fails.

## Persistent storage

Two directories must outlive the container:

| directory | holds | env var | default |
|---|---|---|---|
| data | `webstudio.db` (jobs, pages, assets, errors, auth profiles) | `WEBSTUDIO_DATA_DIR` | `./data` |
| downloads | every captured mirror | `WEBSTUDIO_DOWNLOAD_DIR` | `./tmp/downloads` |

Both are honoured by `lib/db/client.ts` and `lib/resolveDir.ts`. On a host with
no mounted volume they land in the container filesystem and vanish on redeploy —
which means every job id in the UI becomes a 404 and every stored auth profile
disappears.

`render.yaml` mounts a 10 GB disk at `/var/data` and points both variables at it:

```yaml
disk:
  name: webstudio-data
  mountPath: /var/data
  sizeGB: 10
```

A disk mount pins the service to a single instance. That is fine: the job store is
in-process memory plus `job.json` files, so WebStudio already assumes one Node
process. Do not scale it horizontally without moving that state somewhere shared.

## Serverless

On `VERCEL` / `NOW_BUILDER` the app switches to `lib/nativeMirror.ts` and writes
to `$TMPDIR`. Consequences worth knowing before choosing this:

- mirrors are ephemeral and vanish on redeploy;
- the `wget` strategy is unavailable unless `bin/wget` is present;
- Playwright needs `PLAYWRIGHT_BROWSERS_PATH=0` to be usable at all.

Use serverless for a demo, not for anything you expect to keep.

## Required environment

| variable | required | purpose |
|---|---|---|
| `WEBSTUDIO_ACCESS_TOKEN` | **production** | gates every route behind `/login` |
| `WEBSTUDIO_SECRET` | recommended | AES-256-GCM key for stored auth profiles |
| `WEBSTUDIO_DATA_DIR` | recommended | SQLite location on a volume |
| `WEBSTUDIO_DOWNLOAD_DIR` | recommended | mirror location on a volume |
| `PORT` | no | server port, default 3000 |
| `GITHUB_REPO` | no | `owner/name` for the navbar star badge |

In production with no `WEBSTUDIO_ACCESS_TOKEN`, the app returns **503** and says
why, rather than serving unprotected. That is deliberate.

## Health check

`GET /api/auth/access` is unauthenticated by design and returns
`{ mode, required, authenticated }`. It is the natural health-check target: a
`200` with `mode: "protected"` proves the app booted and the gate is armed.

## A deployment smoke test

Run this against the deployed URL before trusting it:

| # | step | expected |
|---|---|---|
| 1 | open `/` in a private window | redirect to `/login` |
| 2 | submit a wrong token | `401`, still on `/login` |
| 3 | submit the real token | redirect to `/`, studio loads |
| 4 | `curl -i https://host/api/mirror/x/progress` with no cookie | `401` JSON |
| 5 | capture a small static site | completes, files appear |
| 6 | restart/redeploy the service | the job id still resolves and previews |
| 7 | capture a Playwright-authenticated site | completes without OOM |
| 8 | check the volume | `webstudio.db` and the mirror directory both present |

Step 6 is the one that catches a missing volume mount. Step 7 is the one that
catches an undersized instance.
