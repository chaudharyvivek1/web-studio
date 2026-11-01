/**
 * WebStudio Endpoint Discovery
 *
 * Builds a catalogue of the HTTP endpoints a mirrored site actually uses, so a
 * captured copy can be turned back into a working application rather than a set
 * of static files.
 *
 * Three independent sources are merged:
 *   1. `manifest.json` resources — what the crawler actually fetched.
 *   2. The crawl's own `apiCatalog`, when the v3 engine recorded one.
 *   3. String literals in captured JavaScript and HTML — the endpoints the
 *      application *calls*, including ones that were never fetched because they
 *      need authentication or a user action.
 *
 * Source 3 is what makes this useful: it surfaces routes the crawler never
 * reached, which is exactly the "there are more APIs behind the login" case.
 */

import fs from 'fs';
import path from 'path';

export type EndpointSource = 'manifest' | 'catalog' | 'script';

export interface EndpointRecord {
  method: string;
  path: string;
  source: EndpointSource;
  /** Number of times this endpoint was seen across all sources */
  hits: number;
  contentType?: string;
  status?: number;
  /** A short literal from the source, for context in the studio */
  sample?: string;
  /** True when the path contains a variable segment such as `:id` or `{id}` */
  parameterised?: boolean;
}

export interface EndpointCatalogue {
  total: number;
  discoveredAt: number;
  endpoints: EndpointRecord[];
  summary: {
    byMethod: Record<string, number>;
    bySource: Record<string, number>;
    apiLike: number;
  };
  notes: string[];
}

const MAX_SCAN_FILES = 300;
const MAX_FILE_BYTES = 512 * 1024;

/** Extensions worth scanning for endpoint literals. */
const SCAN_EXT = /\.(js|mjs|cjs|html?|htm)$/i;

/** A path is "API-like" when it looks like a data endpoint rather than a page. */
const API_LIKE = /(^|\/)(api|rest|graphql|v\d+|rpc|trpc)(\/|$)/i;

/**
 * Verb hints. Each pattern is matched against the text immediately preceding an
 * endpoint literal, and the *nearest* match wins — a global `axios.post(...)`
 * earlier in the file must not label a later `api.get(...)` as a POST.
 */
const METHOD_HINTS: Array<{ re: RegExp; method: string }> = [
  { re: /\b(?:axios|http|client|api)\.post\s*\(|\bmethod\s*:\s*['"]POST['"]/gi, method: 'POST' },
  { re: /\b(?:axios|http|client|api)\.put\s*\(|\bmethod\s*:\s*['"]PUT['"]/gi, method: 'PUT' },
  { re: /\b(?:axios|http|client|api)\.patch\s*\(|\bmethod\s*:\s*['"]PATCH['"]/gi, method: 'PATCH' },
  { re: /\b(?:axios|http|client|api)\.delete\s*\(|\bmethod\s*:\s*['"]DELETE['"]/gi, method: 'DELETE' },
  { re: /\b(?:axios|http|client|api)\.get\s*\(|\bmethod\s*:\s*['"]GET['"]/gi, method: 'GET' },
];

/** How far back to look for a verb hint. Short enough to stay inside one statement. */
const VERB_WINDOW = 60;

function walkFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 12) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, out, depth + 1);
    else if (e.isFile()) out.push(full);
  }
}

function normalisePath(raw: string): string | null {
  let p = raw.trim();
  if (!p || p.length < 2) return null;
  if (/^(data|blob|mailto|tel|javascript):/i.test(p)) return null;
  if (p.startsWith('//')) return null;

  // Strip origin so the same endpoint groups regardless of host
  const originMatch = /^https?:\/\/[^/]+(\/.*)?$/i.exec(p);
  if (originMatch) p = originMatch[1] || '/';

  // Drop query string and fragment for grouping
  p = p.split('#')[0].split('?')[0];
  if (!p.startsWith('/')) p = `/${p}`;
  if (p === '/' || p.length > 200) return null;
  return p;
}

function isParameterised(p: string): boolean {
  return /(\/:\w+|\/\{[^}]+\}|\/\d{2,}\/|\/[0-9a-f]{16,}\/)/i.test(p);
}

/**
 * Scan one source file for endpoint literals and the HTTP verbs near them.
 */
function scanSource(src: string, relPath: string, into: Map<string, EndpointRecord>): void {
  const literalRe = /['"`](\/?(?:api|auth|rest|graphql|v\d+|rpc|trpc)\/[A-Za-z0-9._~!$&'()*+,;=:@%/{}-]{1,160})['"`]/g;

  let m: RegExpExecArray | null;
  while ((m = literalRe.exec(src))) {
    const normalised = normalisePath(m[1]);
    if (!normalised) continue;

    // Pick the verb whose call site is closest to the literal.
    const windowStart = Math.max(0, m.index - VERB_WINDOW);
    const context = src.slice(windowStart, m.index);
    let method = 'GET';
    let nearest = -1;
    for (const hint of METHOD_HINTS) {
      hint.re.lastIndex = 0;
      let hit: RegExpExecArray | null;
      while ((hit = hint.re.exec(context))) {
        const absolute = windowStart + hit.index;
        if (absolute > nearest) {
          nearest = absolute;
          method = hint.method;
        }
      }
    }

    const key = `${method} ${normalised}`;
    const existing = into.get(key);
    if (existing) {
      existing.hits += 1;
      continue;
    }

    into.set(key, {
      method,
      path: normalised,
      source: 'script',
      hits: 1,
      sample: relPath,
      parameterised: isParameterised(normalised),
    });
  }
}

/**
 * Build the endpoint catalogue for one job.
 *
 * @param baseDir   job base directory (holds `manifest.json`)
 * @param targetDir the resolved mirror directory
 */
export function buildEndpointCatalogue(baseDir: string, targetDir: string): EndpointCatalogue {
  const notes: string[] = [];
  const into = new Map<string, EndpointRecord>();

  // ---- source 1 + 2: the manifest -------------------------------------
  const manifestPath = path.join(baseDir, 'manifest.json');
  let manifest: any = null;
  try {
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    }
  } catch {
    notes.push('manifest.json exists but could not be parsed; only script literals were scanned.');
  }

  if (manifest && Array.isArray(manifest.resources)) {
    for (const r of manifest.resources) {
      if (!r || typeof r.url !== 'string') continue;
      const normalised = normalisePath(r.url);
      if (!normalised) continue;

      const looksApi = API_LIKE.test(normalised) || /json/i.test(r.contentType || '');
      if (!looksApi) continue;

      const method = (r.method || 'GET').toUpperCase();
      const key = `${method} ${normalised}`;
      if (into.has(key)) {
        into.get(key)!.hits += 1;
        continue;
      }
      into.set(key, {
        method,
        path: normalised,
        source: 'manifest',
        hits: 1,
        contentType: r.contentType,
        status: r.status,
        parameterised: isParameterised(normalised),
      });
    }
  }

  if (manifest && manifest.apiCatalog && Array.isArray(manifest.apiCatalog.endpoints)) {
    for (const e of manifest.apiCatalog.endpoints) {
      if (!e || typeof e.url !== 'string') continue;
      const normalised = normalisePath(e.url);
      if (!normalised) continue;
      const method = (e.method || 'GET').toUpperCase();
      const key = `${method} ${normalised}`;
      const existing = into.get(key);
      if (existing) {
        existing.hits += 1;
        existing.source = 'catalog';
        if (e.responsePreview) existing.sample = String(e.responsePreview).slice(0, 200);
        continue;
      }
      into.set(key, {
        method,
        path: normalised,
        source: 'catalog',
        hits: 1,
        contentType: e.contentType,
        status: e.status,
        sample: e.responsePreview ? String(e.responsePreview).slice(0, 200) : undefined,
        parameterised: isParameterised(normalised),
      });
    }
  }

  // ---- source 3: captured JavaScript and HTML -------------------------
  const allFiles: string[] = [];
  walkFiles(targetDir, allFiles);

  const scanList = allFiles.filter((f) => SCAN_EXT.test(f)).slice(0, MAX_SCAN_FILES);
  for (const file of scanList) {
    let src = '';
    try {
      const stat = fs.statSync(file);
      if (stat.size > MAX_FILE_BYTES) continue;
      src = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    scanSource(src, path.relative(targetDir, file).replace(/\\/g, '/'), into);
  }

  if (scanList.length === 0) {
    notes.push('No JavaScript or HTML was available to scan for endpoint literals.');
  }

  const endpoints = [...into.values()].sort((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    return a.method.localeCompare(b.method);
  });

  const byMethod: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let apiLike = 0;
  for (const e of endpoints) {
    byMethod[e.method] = (byMethod[e.method] || 0) + 1;
    bySource[e.source] = (bySource[e.source] || 0) + 1;
    if (API_LIKE.test(e.path)) apiLike += 1;
  }

  if (endpoints.length === 0) {
    notes.push('No endpoints were discovered. This is normal for a purely static site.');
  }

  return {
    total: endpoints.length,
    discoveredAt: Date.now(),
    endpoints,
    summary: { byMethod, bySource, apiLike },
    notes,
  };
}
