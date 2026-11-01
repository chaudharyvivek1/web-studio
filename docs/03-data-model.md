# Data model

## On-disk layout

```
<base>/
└── <jobId>/                       base = ./tmp/downloads (dev)
    │                                    = $TMPDIR/downloads (production / serverless)
    ├── job.json                   {id,url,hostname,status,addedAt,completedAt?,error?}
    ├── crawl_logs.txt             append-only stdout+stderr of the crawl
    ├── report.json                engine report (seedUrl, stats)
    ├── manifest.json              per-resource records + health block
    ├── auth_state.json            Playwright storageState (only after auth-login)
    ├── <hostname>-mirror.zip      cached export, rebuilt on delete
    ├── <hostname>/                the actual mirror (resolveTargetDir picks this)
    │   ├── index.html
    │   ├── assets/…
    │   └── …
    ├── assets/                    fallback location, also probed by preview
    └── pages/                     fallback location, also probed by preview
```

`lib/resolveDir.ts` is the only module allowed to decide which of those
directories is "the" mirror for a job. Its priority order is:

1. Cached `job.resolvedDir`, if the job is `completed` and the directory still
   holds files.
2. Exact hostname match.
3. The `www.`-flipped variant.
4. The first subdirectory containing `index.html`.
5. Largest file count.

Names in `INTERNAL_DIRS` (`assets`, `pages`, `logs`, `analysis`,
`screenshots`, `data`, `node_modules`, `.git`, `css`, `js`, `fonts`,
`images`) are never mistaken for a hostname directory.

## In-memory job store — `lib/jobStore.ts`

```ts
interface Job {
  id: string;
  url: string;
  hostname: string;
  status: 'downloading' | 'completed' | 'failed' | 'cancelled' | 'paused';
  error?: string;
  addedAt: number;
  completedAt?: number;
  resolvedDir?: string;
  cachedOverview?: any;      // 5 s TTL
  cachedAssets?: any;        // 3 s TTL
  cachedFileTree?: any;      // 4 s TTL
  lastOverviewUpdate?: number;
  lastAssetsUpdate?: number;
  lastFilesUpdate?: number;
}

interface JobControl {
  isPaused: boolean;
  isCancelled: boolean;
  purgeOnCancel?: boolean;
  pausePromiseResolve?: (() => void) | null;
}
```

Three maps — `activeJobs`, `activeProcesses`, `activeJobControls` — are attached
to `globalThis` in development so a hot reload does not wipe running jobs. In
production they are plain module-level maps, which is why the app assumes a
single Node process (or sticky sessions).

## SQLite schema — `lib/db/schema.ts`

Five tables, all created with `CREATE TABLE IF NOT EXISTS` and WAL enabled.

### `jobs`

| column | type | notes |
|---|---|---|
| `id` | TEXT PK | job id |
| `url`, `hostname` | TEXT NOT NULL | resolved target |
| `status` | TEXT | default `queued` |
| `mode` | TEXT | default `auto` |
| `created_at` | INTEGER NOT NULL | epoch ms |
| `started_at`, `completed_at` | INTEGER | epoch ms |
| `pages_found`, `pages_downloaded` | INTEGER | default 0 |
| `assets_found`, `assets_downloaded` | INTEGER | default 0 |
| `bytes_downloaded`, `errors_count` | INTEGER | default 0 |
| `error_message` | TEXT | |
| `crawl_config` | TEXT | JSON of scope + capture rules |
| `manifest` | TEXT | JSON manifest (used by `/manifest` fallback) |
| `download_dir`, `resolved_dir` | TEXT | absolute paths |

### `pages`

`id`, `job_id` (FK, `ON DELETE CASCADE`), `url`, `canonical`, `local_path`,
`status_code`, `content_type`, `size`, `sha256`, `depth`, `discovered_from`,
`crawled_at`, `needs_browser`, `error`.

### `assets`

`id`, `job_id` (FK, cascade), `url`, `canonical`, `local_path`, `type`,
`status_code`, `content_type`, `size`, `sha256`, `discovered_from`,
`downloaded_at`, `error`.

### `crawl_errors`

`id`, `job_id` (FK, cascade), `url`, `error_type`, `status_code`, `message`,
`retries`, `created_at`.

### `auth_profiles`

`id`, `name`, `domain`, `auth_type` (`storage_state`), `storage_state` (JSON),
`created_at`, `last_used_at`.

## Manifest format — `lib/jobs/manifest.ts`

```json
{
  "jobId": "lq3f8k2ab",
  "seedUrl": "https://example.com/",
  "generatedAt": "2026-11-01T10:14:22.000Z",
  "resources": [
    {
      "url": "https://example.com/assets/app.js",
      "localPath": "example.com/assets/app.js",
      "status": 200,
      "contentType": "application/javascript",
      "size": 20481,
      "sha256": "9f2c…"
    }
  ],
  "health": {
    "score": 97,
    "grade": "A",
    "pagesCoverage": 100,
    "assetsCoverage": 100,
    "errorRate": 0.4,
    "notes": []
  }
}
```

`resources[].sha256` is what makes the manifest an audit artefact: two mirrors
taken at different times can be diffed by hash.

## Asset classification

One table, used by `/assets`, `/overview` and the progress counters:

| type | extensions |
|---|---|
| page | `.html .htm` |
| image | `.png .jpg .jpeg .gif .svg .webp .ico .avif .bmp .tiff` |
| css | `.css .scss .sass .less` |
| js | `.js .mjs .cjs` |
| font | `.woff .woff2 .ttf .otf .eot` |
| video | `.mp4 .webm .ogg .mov .avi .mkv` |
| audio | `.mp3 .wav .aac .flac .m4a` |
| document | `.pdf .ppt .pptx .doc .docx .xls .xlsx .csv .json .xml .zip .txt` |

System files are excluded from the asset library by name:
`crawl_logs.txt`, `job.json`, `report.json`, `package.json`,
`package-lock.json`, `server.js`, `serve.py`, `start.sh`, `start.bat`,
`auth_state.json`, `manifest.json`, `readme.md`.
