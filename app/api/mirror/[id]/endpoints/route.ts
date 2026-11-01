import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { resolveTargetDir, ensureJobExists, getBaseDownloadDir } from '@/lib/resolveDir';
import { activeJobs } from '@/lib/jobStore';
import { buildEndpointCatalogue, EndpointCatalogue } from '@/lib/analysis/endpoints';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mirror/[id]/endpoints
 *
 * Returns every HTTP endpoint the mirrored site appears to use, merged from
 * three sources: the crawl manifest, the engine's recorded API catalogue, and
 * string literals found in captured JavaScript and HTML.
 *
 * The third source is the interesting one — it lists routes the crawler never
 * fetched because they sit behind a login or need a user action, which is what
 * you need in order to rebuild the app rather than just archive it.
 *
 * Query:
 *   refresh=true  — bypass the 30 second in-process cache
 */

interface CacheEntry {
  at: number;
  data: EndpointCatalogue;
}

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!ensureJobExists(id)) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const job = activeJobs.get(id)!;
    const baseDir = getBaseDownloadDir(id);
    const targetDir = resolveTargetDir(id, job.hostname);

    if (!fs.existsSync(targetDir)) {
      return NextResponse.json({ error: 'Download directory not found' }, { status: 404 });
    }

    const refresh = req.nextUrl.searchParams.get('refresh') === 'true';
    const hit = cache.get(id);
    if (!refresh && hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return NextResponse.json(hit.data);
    }

    const catalogue = buildEndpointCatalogue(baseDir, targetDir);
    cache.set(id, { at: Date.now(), data: catalogue });

    return NextResponse.json(catalogue);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to build endpoint catalogue' },
      { status: 500 }
    );
  }
}
