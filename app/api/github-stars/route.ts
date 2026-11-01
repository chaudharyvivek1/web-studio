import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Returns the star count for the project's own GitHub repository.
 *
 * Set GITHUB_REPO="owner/name" to point this at your fork. When it is unset or
 * malformed the route reports `stars: null` so the UI can hide the badge
 * instead of showing a misleading zero.
 */
const REPO = process.env.GITHUB_REPO || '';
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

export async function GET() {
  if (!REPO_PATTERN.test(REPO)) {
    return NextResponse.json({ stars: null });
  }

  // Attempt 1: the GitHub REST API (60 requests/hour per IP when unauthenticated).
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/vnd.github.v3+json',
      },
      cache: 'no-store',
    });

    if (res.ok) {
      const data = await res.json();
      if (typeof data.stargazers_count === 'number') {
        return NextResponse.json({ stars: data.stargazers_count });
      }
    }
  } catch {
    // fall through to the HTML scrape
  }

  // Attempt 2: scrape the repository page, which is not rate limited the same way.
  try {
    const pageRes = await fetch(`https://github.com/${REPO}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      cache: 'no-store',
    });

    if (pageRes.ok) {
      const html = await pageRes.text();
      const escaped = REPO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = html.match(
        new RegExp(`href="/${escaped}/stargazers"[^>]*>[\\s\\S]*?<span><strong>(\\d+)</strong></span>`, 'i')
      );
      if (match && match[1]) {
        const starCount = parseInt(match[1], 10);
        if (!Number.isNaN(starCount)) {
          return NextResponse.json({ stars: starCount });
        }
      }
    }
  } catch {
    // ignore
  }

  return NextResponse.json({ stars: null });
}

