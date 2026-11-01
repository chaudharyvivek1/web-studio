# Project structure

```
web-studio/
├── app/                      Next.js App Router
│   ├── layout.tsx            Root layout: fonts, metadata, global click spark
│   ├── page.tsx              Landing page — URL input, presets, config dialog
│   ├── globals.css           Tailwind v4 entry + design tokens
│   ├── mirror/[id]/page.tsx  The studio: preview chassis + tab shell
│   └── api/                  All HTTP endpoints (see docs/api/)
│       ├── mirror/           Creation, auth entry, and per-job operations
│       ├── download/         ZIP export
│       ├── auth/             Manual login, mock NextAuth, profile CRUD
│       └── github-stars/     Star-count badge
│
├── components/
│   ├── landing/              Marketing + capture UI (hero, presets, FAQ, docs modal)
│   ├── capture/              Config dialog and review summary
│   ├── crawl/                Live crawl UI: header, metric cards, terminal, activity
│   ├── mirror/               Studio tabs: Overview, Pages, Assets, Files, Health,
│   │                         Network, Logs, Preview + header and dashboard card
│   ├── ui/                   Primitives: button, card, dialog, tabs, table, …
│   ├── reactbits/            Animation helpers: ClickSpark, CountUp, ShinyText, …
│   └── shared/               Cross-cutting: scroll-to-top
│
├── lib/
│   ├── crawler/              The frontier engine
│   │   ├── engine.ts         Orchestrator
│   │   ├── discovery/        html.ts · css.ts · sitemap.ts
│   │   ├── engines/          http.ts · browser.ts · detect.ts
│   │   ├── scope.ts          Boundary rules
│   │   ├── visited.ts        URL + hash dedupe
│   │   ├── queue.ts          Frontier queue
│   │   ├── concurrency.ts    Worker pool
│   │   ├── retry.ts          Backoff policy
│   │   ├── redirects.ts      Chain resolution
│   │   ├── limits.ts         Budget enforcement
│   │   ├── mode.ts           fast | balanced | browser | auto
│   │   ├── normalize.ts      URL normalisation
│   │   ├── presets.ts        quick | website | full | max_capture | authenticated
│   │   ├── policy.ts         Politeness and user-agent rules
│   │   └── playwrightHelper.ts  Safe Chromium launch
│   ├── processor/            classify · hash · rewrite · pipeline
│   ├── security/             validate-url · dns-guard · redirect-guard ·
│   │                         rate-limit · content-limit
│   ├── analysis/             api · assets · health · network · technology
│   ├── auth/                 session · manual-login · import-session
│   ├── db/                   client.ts (queries) · schema.ts (DDL)
│   ├── jobs/                 manager.ts · queue.ts · manifest.ts
│   ├── export/               zip.ts
│   ├── authCrawler.ts        Playwright login + authenticated deep harvest
│   ├── nativeMirror.ts       Pure-Node mirror for serverless hosts
│   ├── resolveDir.ts         THE directory resolver — every route uses it
│   ├── jobStore.ts           In-memory job/process/control maps
│   ├── storage/local.ts      Filesystem writes
│   ├── logoData.ts           Embedded favicon/logo data URIs
│   └── utils/                format.ts · logger.ts
│
├── bin/wget                  Static x86-64 wget, used when the host has none
├── middleware.ts             SPA asset rewrite (edge runtime)
├── scripts/crawler_auth.cjs  Standalone authenticated-crawl script
├── public/                   Static assets
├── data/                     SQLite database location (gitignored contents)
└── docs/                     This specification
```

## Rules the codebase follows

1. **`app/api/**/route.ts` is the only place that returns HTTP responses.**
   Everything else returns data or throws.
2. **`lib/resolveDir.ts` is the only module that decides where a mirror lives.**
   No route builds a filesystem path by hand.
3. **`lib/jobStore.ts` is the only in-memory job state.** Routes read it; the
   engine writes to it.
4. **`lib/db/` is the only durable job metadata.** `lib/jobStore` is a cache in
   front of it.
5. **`lib/security/` is imported, never duplicated.** A route that needs URL
   validation calls the shared validator.
6. **Analysis modules are pure.** `lib/analysis/*` takes data in and returns a
   result; it never touches the network or the request.

## Where to change things

| I want to… | touch |
|---|---|
| add an endpoint | new folder under `app/api/`, then `docs/api/` |
| change what gets captured | `lib/crawler/presets.ts` and `captureRules` handling |
| change crawl boundaries | `lib/crawler/scope.ts` |
| change retry behaviour | `lib/crawler/retry.ts` |
| change the ZIP contents | `createCompleteRunnableBundle()` in `lib/authCrawler.ts` |
| change offline preview behaviour | `app/api/mirror/[id]/preview/[[...path]]/route.ts` |
| change the brand name | `package.json`, `app/layout.tsx`, `components/ui/WebStudioLogo.tsx` |
| change the SQLite schema | `lib/db/schema.ts` (migrations are manual) |
