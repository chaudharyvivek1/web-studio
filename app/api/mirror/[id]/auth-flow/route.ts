import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { resolveTargetDir, ensureJobExists, getBaseDownloadDir } from '@/lib/resolveDir';
import { activeJobs } from '@/lib/jobStore';
import { detectAuthFlow, AuthFlow } from '@/lib/authflow/detect';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mirror/[id]/auth-flow
 *
 * Returns the detected authentication surface of the mirror: which captured
 * pages hold a login or sign-up form, what fields they expose, which page to
 * land on after authenticating, and the session contract (cookie names,
 * localStorage keys, auth endpoints) recovered from the captured JavaScript.
 *
 * The result is cached to `auth-flow.json` in the job directory so the studio
 * and the preview route read the same object across restarts.
 *
 * Query:
 *   refresh=true  — ignore the cached file and re-detect
 */
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
    const cachePath = path.join(baseDir, 'auth-flow.json');

    if (!refresh) {
      try {
        if (fs.existsSync(cachePath)) {
          const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as AuthFlow;
          if (cached && typeof cached.detectedAt === 'number') {
            return NextResponse.json(cached);
          }
        }
      } catch {
        // fall through to a fresh detection
      }
    }

    const flow = detectAuthFlow(id, job.hostname, targetDir);

    try {
      fs.writeFileSync(cachePath, JSON.stringify(flow, null, 2), 'utf-8');
    } catch {
      // A read-only job directory must not fail the request
    }

    return NextResponse.json(flow);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to detect auth flow' },
      { status: 500 }
    );
  }
}
