# WebStudio

**Mirror a website, inspect it live, and hand someone a folder that runs
offline with no dependencies.**

WebStudio is a self-hostable studio for capturing complete websites — including
JavaScript-rendered single-page apps and password-protected dashboards — then
browsing the capture, auditing what was fetched, and exporting it as a
standalone bundle you can open with `node server.js` or `python3 serve.py`.

Built with Next.js 16, React 19, TypeScript, Tailwind CSS 4, SQLite and
Playwright.

---

## What it actually does

You paste a URL. WebStudio dispatches a crawl in the background and hands you a
job id in milliseconds. A studio screen opens, streams live progress and the raw
crawl log, and lets you click through:

- **Dash** — page and asset counts, total size, detected tech stack, brand palette
- **Pages** — every captured route, switchable in the live preview
- **Assets** — searchable image/CSS/JS/font library with thumbnails
- **Files** — the full directory tree
- **Health** — a 0–100 fidelity score
- **Network** — a waterfall rebuilt from the manifest
- **Logs** — the crawl log, tailed live or downloaded whole
- **Auth Flow** — the detected login/sign-up forms, their fields, and the session contract
- **Endpoints** — every HTTP endpoint the site uses, including ones the crawler never reached
- **Preview** — the mirrored site in a desktop, laptop, tablet or phone frame

If the mirrored site has a login, the offline copy **works**: a visitor can
create an account or sign in locally and be taken through into the authenticated
area. See [docs/07-auth-emulation.md](docs/07-auth-emulation.md).

When you are done, one click produces a ZIP containing the mirror plus a
zero-dependency Node server, a zero-dependency Python server, and launcher
scripts for macOS, Linux and Windows.

## Why it is not just `wget`

| problem | what WebStudio does |
|---|---|
| SPAs render a blank shell | Boots Playwright Chromium and waits for the hydrated DOM |
| Dynamic chunk paths 404 offline | Rewrites root-relative asset requests into the preview route via edge middleware |
| Login walls | Automated browser login, credential detection, reusable `storageState` profiles |
| Missing chunks break the preview | On-demand fetch-and-cache proxy inside the preview route |
| Links break offline | Link rewriting in the processor pipeline plus six tiers of path resolution |
| No idea what was captured | SHA-256 manifest with per-resource records and a health score |

## Quick start

```bash
npm run setup     # install dependencies + Chromium, no C++ toolchain needed
npm run dev
```

Open <http://localhost:3000>, paste a URL, and press capture.

> **Use `npm run setup`, not a bare `npm install`.** `better-sqlite3@13` ships
> prebuilt binaries but also ships a `binding.gyp` with no install script, so
> npm automatically tries to compile it with `node-gyp` — which fails on any
> machine without Visual Studio's C++ workload, most visibly on Windows. The
> `setup` script passes `--ignore-scripts` to skip that pointless compile.
> Full explanation: [docs/10-troubleshooting.md](docs/10-troubleshooting.md).

Production:

```bash
npm run build
npm start
```

The wget strategy uses the system `wget` on `PATH`. If the host has none — mainly
small serverless containers — an optional bundled binary can be dropped at
`bin/wget`. See [`bin/README.md`](bin/README.md) for how to add one.

## Configuration

| variable | default | purpose |
|---|---|---|
| `PORT` | `3000` | Server port |
| `GITHUB_REPO` | — | `owner/name` for the navbar star badge; the badge hides when unset |
| `PLAYWRIGHT_BROWSERS_PATH` | — | Set to `0` to vendor browsers into the project |
| `VERCEL` / `NOW_BUILDER` | — | Switches to the pure-Node mirror strategy and `$TMPDIR` storage |

Copy `.env.example` to `.env.local` to start.

## Architecture in one paragraph

Four layers, top to bottom: presentation (`app/`, `components/`), transport
(`app/api/`, `middleware.ts`), engine (`lib/crawler/`, `lib/authCrawler.ts`,
`lib/nativeMirror.ts`), and state (`lib/jobStore.ts` for live progress,
`lib/db/` for durability, the filesystem for content). `POST /api/mirror`
chooses one of four execution strategies per job — auth crawler, capture engine
v3, native mirror, or wget — and every route resolves paths through the single
module `lib/resolveDir.ts`. The full specification is in [`docs/`](docs/).

## Documentation

- [docs/README.md](docs/README.md) — documentation index
- [docs/01-architecture.md](docs/01-architecture.md) — layers and the four strategies
- [docs/02-crawl-lifecycle.md](docs/02-crawl-lifecycle.md) — URL to ZIP, step by step
- [docs/03-data-model.md](docs/03-data-model.md) — disk layout, job store, SQLite, manifest
- [docs/04-security.md](docs/04-security.md) — SSRF guards and **known gaps**
- [docs/05-recreation-guide.md](docs/05-recreation-guide.md) — rebuild it from scratch
- [docs/06-project-structure.md](docs/06-project-structure.md) — every directory
- [docs/07-auth-emulation.md](docs/07-auth-emulation.md) — cloning the login/sign-up journey
- [docs/08-endpoint-discovery.md](docs/08-endpoint-discovery.md) — finding every endpoint a site uses
- [docs/09-agent-build-guide.md](docs/09-agent-build-guide.md) — **build guide for an AI agent**
- [docs/10-troubleshooting.md](docs/10-troubleshooting.md) — install failures, native modules, preview and crawl problems
- [docs/api/](docs/api/) — one document per endpoint, 25 routes plus middleware

## Before you deploy this publicly

WebStudio has **no authentication**. Every endpoint is open, a job id is the
only access token, and preview HTML runs with scripts inside your origin. Read
[docs/04-security.md](docs/04-security.md) first — it lists nine specific gaps
with suggested fixes, and a seven-step hardening checklist.

## Repository

<https://github.com/chaudharyvivek1/web-studio>

## Licence and provenance

MIT. See [LICENSE](LICENSE).

This project is a rebranded, reorganised derivative of
[WebHarvest](https://github.com/krishsoni15/WebHarvest) by krishsoni15, used
under the MIT licence. The crawling engine, preview route, security modules and
UI were written there; this repository renames the project, centralises
configuration, documents every endpoint and module, and adds a specification.
See [NOTICE](NOTICE) for the details of what changed.

