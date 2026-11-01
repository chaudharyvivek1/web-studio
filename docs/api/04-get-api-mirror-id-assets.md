# `GET /api/mirror/[id]/assets`

> **Source:** `app/api/mirror/[id]/assets/route.ts` · **Runtime:** Node.js · **Auth:** none

## Purpose

Feeds the **Assets** tab: a searchable media library plus the extracted brand
colour palette.

## Request

| location | name | type | description |
|---|---|---|---|
| path | `id` | `string` | Job id |
| query | `refresh` | `'true'` | Skip the cache and rescan |

## Behaviour

- **Caching:** if `cachedAssets.images` is non-empty and either the job is
  `completed` or the cache is under 3 s old, the cached payload is returned.
  In-progress jobs therefore rescan at most every 3 seconds.
- **Walking:** `resolveTargetDir()` is scanned, then the base directory too if
  it differs, de-duplicating by relative path. Dotfiles are skipped.
- **System files are excluded by name:** `crawl_logs.txt`, `job.json`,
  `report.json`, `package.json`, `package-lock.json`, `server.js`, `serve.py`,
  `start.sh`, `start.bat`, `auth_state.json`, `manifest.json`, `readme.md`.
- Each kept file is classified and given a preview URL:

| `type` | extensions |
|---|---|
| `image` | `.png .jpg .jpeg .gif .webp .ico .avif .bmp .tiff` |
| `svg` | `.svg` |
| `font` | `.woff .woff2 .ttf .otf .eot` |
| `css` | `.css .scss .sass .less` |
| `js` | `.js .mjs .cjs` |
| `video` | `.mp4 .webm .ogg .mov .avi .mkv` |
| `audio` | `.mp3 .wav .aac .flac .m4a` |
| `document` | `.pdf .ppt .pptx .doc .docx .xls .xlsx .csv .json .xml .zip .txt` |

### Colour extraction

`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` and `rgb()/rgba()` tokens are counted
across `.css`, `.html` and `.htm` files under 500 KB. Then, per colour:

1. Parse to RGBA; skip when `alpha < 0.9`.
2. Skip when the channel spread is under 24 on every axis (i.e. grey).
3. Require HSL saturation `> 0.18` and lightness in `(0.12, 0.88)`.
4. Sort surviving colours by frequency, take the top 5 distinct.
5. Top up from `#2563eb #db2777 #059669 #d97706 #7c3aed` if fewer than 5 remain.

## Response — 200

```json
{
  "colors": ["#2563eb", "#0ea5e9", "#f43f5e", "#10b981", "#7c3aed"],
  "images": [
    {
      "name": "hero.png",
      "path": "assets/images/hero.png",
      "previewUrl": "/api/mirror/lq3f8k2ab/preview/assets/images/hero.png",
      "size": "184.2 KB",
      "type": "image"
    }
  ]
}
```

`images` is capped at **2000** entries. `size` is a 1024-based human string
with one decimal.

## Errors

| status | body | when |
|---|---|---|
| 404 | `{"error":"Job not found"}` | unknown id |
| 200 | `{"colors":[],"images":[]}` | neither directory exists yet (not an error) |
| 500 | `{"error":"<message>"}` | unhandled exception |

## Reimplementation notes

- The `previewUrl` always points at the preview route, never at a static path,
  so assets resolve identically for on-disk and on-demand-fetched files.
- The grey/saturation filter is what stops a Bootstrap site from reporting
  five shades of grey as its "brand palette".
