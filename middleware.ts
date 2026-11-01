import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, PREVIEW_COOKIE, getAuthMode, isAuthorised } from '@/lib/security/app-auth';

/**
 * WebStudio Edge Middleware
 *
 * Three responsibilities, applied in this order:
 *
 *   1. Access gate — when `WEBSTUDIO_ACCESS_TOKEN` is set, every route except the
 *      login screen requires a signed session cookie.
 *   2. CSRF — state-changing requests must not arrive cross-site.
 *   3. Asset rewriting — a mirrored SPA emits root-relative URLs such as
 *      `/_next/static/chunks/x.js` and `/assets/logo.png`. Those would 404 against
 *      WebStudio's own origin, so they are rewritten into the preview route.
 *
 * The gate runs first: a request must be allowed before any rewriting happens.
 */

/** Paths that must stay reachable without a session. */
const PUBLIC_PATHS = ['/login', '/api/auth/access'];
const PUBLIC_PREFIXES = ['/_next/', '/favicon.ico', '/icon.png', '/apple-icon.png'];

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Reject state-changing requests that a browser says came from another site.
 *
 * This is the cheap, client-transparent half of CSRF defence: no token needs to
 * be threaded through every `fetch`. Requests from non-browser clients carry no
 * `Origin`/`Sec-Fetch-Site` and are allowed, which is correct — CSRF is a
 * browser-credential attack.
 */
function isCrossSite(req: NextRequest): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site === 'cross-site') return true;

  const origin = req.headers.get('origin');
  if (!origin) return false;

  try {
    const originHost = new URL(origin).host;
    const host = req.headers.get('host');
    return Boolean(host) && originHost !== host;
  } catch {
    return true; // an unparseable Origin is not trustworthy
  }
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // ---- 1. Access gate ---------------------------------------------------
  if (!isPublic(pathname)) {
    const mode = getAuthMode();

    if (mode === 'misconfigured') {
      // Production with no token configured: fail closed, and say why.
      return new NextResponse(
        'WebStudio is running in production without WEBSTUDIO_ACCESS_TOKEN.\n\n' +
          'Set WEBSTUDIO_ACCESS_TOKEN to a value of at least 8 characters, or set\n' +
          'WEBSTUDIO_ALLOW_OPEN=1 if this instance is genuinely not reachable by others.\n',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }
      );
    }

    if (mode === 'protected') {
      const cookie = req.cookies.get(ACCESS_COOKIE)?.value;
      const allowed = await isAuthorised(cookie);

      if (!allowed) {
        if (pathname.startsWith('/api/')) {
          return NextResponse.json(
            { error: 'Unauthorised. Sign in at /login.' },
            { status: 401, headers: { 'Cache-Control': 'no-store' } }
          );
        }
        const loginUrl = new URL('/login', req.url);
        return NextResponse.redirect(loginUrl);
      }
    }
  }

  // ---- 2. CSRF ----------------------------------------------------------
  if (MUTATING_METHODS.has(req.method) && isCrossSite(req)) {
    return NextResponse.json(
      { error: 'Cross-site request rejected.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  // ---- 3. Asset rewriting ----------------------------------------------
  // Identify the target mirror job from:
  //   a) the Referer, when the preview iframe requests a sub-resource
  //   b) the preview cookie set by the preview route
  const referer = req.headers.get('referer');
  const iframePreviewMatch = referer ? referer.match(/\/api\/mirror\/([a-zA-Z0-9]+)\/(?:preview|live)/) : null;
  const targetIdFromIframe = iframePreviewMatch ? iframePreviewMatch[1] : null;

  let targetId: string | null = targetIdFromIframe;
  if (!targetId && referer) {
    const mirrorMatch = referer.match(/\/mirror\/([a-zA-Z0-9]+)/);
    if (mirrorMatch && mirrorMatch[1]) targetId = mirrorMatch[1];
  }
  if (!targetId) {
    const cookie = req.cookies.get(PREVIEW_COOKIE);
    if (cookie && cookie.value) targetId = cookie.value;
  }

  // Relative asset paths that lost their [id] prefix:
  //   /api/mirror/assets/images/logo.png → /api/mirror/<id>/preview/assets/images/logo.png
  const apiMirrorMissingId = pathname.match(
    /^\/api\/mirror\/(assets|images|fonts|css|js|pages|media|wp-content|wp-includes)\/(.+)$/i
  );
  if (apiMirrorMissingId && targetId) {
    const assetSubpath = `${apiMirrorMissingId[1]}/${apiMirrorMissingId[2]}`;
    return NextResponse.rewrite(
      new URL(`/api/mirror/${targetId}/preview/${assetSubpath}${search}`, req.url)
    );
  }

  // Next.js assets: the studio's own, or a mirrored site's chunks.
  if (pathname.startsWith('/_next')) {
    if (targetIdFromIframe) {
      const cleanPath = pathname.startsWith('/') ? pathname.slice(1) : pathname;
      return NextResponse.rewrite(
        new URL(`/api/mirror/${targetIdFromIframe}/preview/${cleanPath}${search}`, req.url)
      );
    }
    return NextResponse.next();
  }

  // WebStudio's own routes
  if (pathname.startsWith('/api') || pathname.startsWith('/mirror') || pathname === '/') {
    return NextResponse.next();
  }

  // Any other root-relative request inside a preview belongs to the mirror
  if (targetId) {
    const cleanPath = pathname.startsWith('/') ? pathname.slice(1) : pathname;
    return NextResponse.rewrite(new URL(`/api/mirror/${targetId}/preview/${cleanPath}${search}`, req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!favicon.ico).*)'],
};
