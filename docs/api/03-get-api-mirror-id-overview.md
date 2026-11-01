# `GET /api/mirror/[id]/overview`

> **Source:** `app/api/mirror/[id]/overview/route.ts` · **Runtime:** Node.js
> **Auth:** none · **Route flag:** `dynamic = 'force-dynamic'`

## Purpose

Powers the **Dash** tab: aggregate file counts, total size, detected tech
stack, brand colour palette, page inventory and the entry-page URL used by the
preview iframe.

## Request

| location | name | type | description |
|---|---|---|---|
| path | `id` | `string` | Job id |
| query | `refresh` | `'true'` | Bypass the 5-second response cache |

## Behaviour

1. `ensureJobExists(id)` → `404 {"error":"Job not found"}`.
2. If `refresh` is not set and `cachedOverview` is under 5 s old, return it
   verbatim.
3. Resolve the directory: `resolveTargetDir(id, hostname)` if it exists, else
   the base download directory → `404 {"error":"Download directory not found"}`.
4. Recursively walk, skipping dotfiles, accumulating:

| bucket | extensions |
|---|---|
| `pages` | `.html`, `.htm` |
| `images` | `.png .jpg .jpeg .gif .svg .webp .ico .avif .bmp .tiff` |
| `css` | `.css .scss .sass .less` |
| `js` | `.js .mjs .cjs` |
| `fonts` | `.woff .woff2 .ttf .otf .eot` |
| `media` | `.mp4 .webm .ogg .mov .avi .mp3 .wav .aac .flac .m4a` |
| `documents` | `.pdf .ppt .pptx .doc .docx .xls .xlsx .csv .json .xml .zip .txt` |

   Anything else still increments `totalAssets` and `files`.

5. **Tech-stack detection** reads the first available HTML document, trying in
   order: `<dir>/index.html` → the first HTML entry in `manifest.json` →
   the first `.html` found under `<base>/pages` → a recursive search of the
   base directory.
6. **Brand colours** are extracted from the discovered CSS/HTML.
7. The assembled object is cached on the job as `cachedOverview` with
   `lastOverviewUpdate`.

## Response — 200

```json
{
  "id": "lq3f8k2ab",
  "url": "https://example.com/",
  "hostname": "example.com",
  "status": "completed",
  "stats": {
    "pages": 42, "images": 310, "css": 18, "js": 96, "fonts": 12,
    "media": 0, "documents": 3, "totalAssets": 439, "files": 481,
    "size": 18432117,
    "sizeFormatted": "17.6 MB"
  },
  "techStack": ["Next.js", "React", "Tailwind CSS"],
  "colors": ["#2563eb", "#db2777", "#059669", "#d97706", "#7c3aed"],
  "pages": ["index.html", "about.html", "pricing/index.html"],
  "entryPage": "index.html",
  "previewUrl": "/api/mirror/lq3f8k2ab/preview/index.html"
}
```

Field names marked above are the stable contract consumed by
`components/mirror/OverviewTab.tsx` and `ProjectDashboardCard.tsx`.

## Errors

| status | body | when |
|---|---|---|
| 404 | `{"error":"Job not found"}` | unknown id |
| 404 | `{"error":"Download directory not found"}` | job exists, nothing on disk yet |
| 500 | `{"error":"<message>"}` | unhandled exception |

## Reimplementation notes

- The five-colour fallback (`#2563eb #db2777 #059669 #d97706 #7c3aed`) is
  appended when the target yields fewer than five vibrant colours, so the
  palette UI is never empty.
- `sizeFormatted` uses 1024-based units with two decimals.
- Because the route is `force-dynamic`, it never participates in Next.js
  static caching; the 5-second cache is the app's own.
