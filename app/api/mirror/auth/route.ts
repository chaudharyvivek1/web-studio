import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { activeJobs, Job } from '@/lib/jobStore';
import { getBaseDownloadDir } from '@/lib/resolveDir';
import { runAuthCrawler } from '@/lib/authCrawler';
import { validateURL } from '@/lib/security/validate-url';
import { dnsGuard } from '@/lib/security/dns-guard';
import { defaultRateLimiter } from '@/lib/security/rate-limit';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      loginUrl = 'https://demos.pixinvent.com/vuexy-nextjs-admin-template/demo-1/en/login',
      email = 'admin@vuexy.com',
      password = 'admin',
      targetPages = [
        'https://demos.pixinvent.com/vuexy-nextjs-admin-template/demo-1/en/dashboards/analytics',
        'https://demos.pixinvent.com/vuexy-nextjs-admin-template/demo-1/en/dashboards/crm',
        'https://demos.pixinvent.com/vuexy-nextjs-admin-template/demo-1/en/dashboards/ecommerce'
      ],
      headless = true
    } = body;

    // Same gate as POST /api/mirror. This route previously accepted any URL,
    // which made it the easiest SSRF entry point in the app.
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
    const rateStatus = defaultRateLimiter.consume(clientIp);
    if (!rateStatus.allowed) {
      return NextResponse.json(
        { error: `Too many requests. Please retry in ${rateStatus.retryAfterSeconds} seconds.` },
        { status: 429 }
      );
    }

    let candidate = loginUrl.trim();
    if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;

    const urlCheck = validateURL(candidate);
    if (!urlCheck.valid || !urlCheck.url) {
      return NextResponse.json({ error: urlCheck.reason || 'Invalid loginUrl' }, { status: 400 });
    }
    candidate = urlCheck.url;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(candidate);
    } catch {
      return NextResponse.json({ error: 'Invalid loginUrl format' }, { status: 400 });
    }

    const hostname = parsedUrl.hostname;

    const BLOCKED = [
      /^localhost$/i,
      /^127\.\d+\.\d+\.\d+$/,
      /^10\.\d+\.\d+\.\d+$/,
      /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
      /^192\.168\.\d+\.\d+$/,
      /^0\.0\.0\.0$/,
      /^\[::1?\]$/,
    ];
    if (BLOCKED.some((pattern) => pattern.test(hostname))) {
      return NextResponse.json(
        { error: 'Cannot crawl local or private network addresses' },
        { status: 400 }
      );
    }

    const dnsCheck = await dnsGuard(hostname);
    if (!dnsCheck.allowed) {
      return NextResponse.json(
        { error: `Security check blocked: ${dnsCheck.reason}` },
        { status: 403 }
      );
    }
    const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
    const downloadDir = getBaseDownloadDir(id);

    fs.mkdirSync(downloadDir, { recursive: true });

    const newJob: Job = {
      id,
      url: candidate,
      hostname,
      status: 'downloading',
      addedAt: Date.now(),
    };
    activeJobs.set(id, newJob);

    // Run crawler in background so response returns quickly
    runAuthCrawler({
      id,
      loginUrl: candidate,
      email,
      password,
      targetPages,
      downloadDir,
      headless
    }).catch(err => {
      console.error('Background Auth Crawler error:', err);
    });

    return NextResponse.json({
      success: true,
      id,
      message: 'Authenticated crawler started',
      loginUrl: candidate,
      targetPagesCount: targetPages.length
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
