import { NextRequest } from 'next/server';
import { resolveTargetDir, ensureJobExists } from '@/lib/resolveDir';
import { activeJobs } from '@/lib/jobStore';
import { dnsGuard } from '@/lib/security/dns-guard';

export const dynamic = 'force-dynamic';

/**
 * GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS /api/mirror/[id]/live/[[...path]]
 *
 * A live reverse proxy for the mirrored target.
 *
 * The preview route serves *captured files*. This route serves the **real
 * website**, fetched on demand, so the studio can show a page exactly as it is
 * today — including pages that were never captured and forms that actually work.
 *
 * That is what makes logging in possible: a POST to the site's own login form
 * passes straight through to the real server, the real `Set-Cookie` comes back,
 * and the visitor lands inside the real authenticated app.
 *
 * What is rewritten
 * -----------------
 * - `<base href>` is injected so relative URLs resolve through this prefix.
 * - Absolute URLs of the target host, and root-relative `src`/`href`/`action`
 *   values, are pointed at this prefix.
 * - `Set-Cookie` loses its `Domain` and `Secure` attributes and gains
 *   `Path=/api/mirror/<id>/live/`, so cookies work on a plain-http localhost.
 * - `Location` on redirects is rewritten to stay inside the proxy.
 * - `X-Frame-Options` and CSP are dropped so the page can be framed.
 * - `fetch` and `XMLHttpRequest` are patched so client-side calls to
 *   root-relative URLs also route through the proxy.
 *
 * What is not rewritten
 * ---------------------
 * - `history.pushState` navigations. A reload of an SPA route may 404.
 * - URLs built by string concatenation inside minified bundles.
 * - WebSockets.
 *
 * Security: the target host is re-checked with the DNS guard, redirects are
 * followed manually and each hop is re-validated, and responses are capped.
 */

const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
const MAX_REWRITE_BYTES = 5 * 1024 * 1024;
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);

/** Cookies owned by WebStudio itself must never be sent to the target. */
const OWN_COOKIE_PREFIXES = ['webstudio_', '__Secure-next-auth', 'next-auth.'];

function proxyPrefix(id: string): string {
  return `/api/mirror/${id}/live`;
}

function isPrivateHost(hostname: string): boolean {
  const patterns = [
    /^localhost$/i, /^127\./, /^10\./, /^192\.168\./, /^0\.0\.0\.0$/, /^\[?::1\]?$/,
    /^172\.(1[6-9]|2\d|3[01])\./,
  ];
  return patterns.some((p) => p.test(hostname));
}

/** Rewrite one `Set-Cookie` header so the browser will store it on our origin. */
function rewriteSetCookie(raw: string, id: string): string {
  const prefix = proxyPrefix(id);
  const parts = raw.split(';');
  const kept: string[] = [parts[0]];

  for (let i = 1; i < parts.length; i++) {
    const attr = parts[i].trim();
    const lower = attr.toLowerCase();

    // A Domain attribute scoped to the target host would be rejected here.
    if (lower.startsWith('domain=')) continue;
    // Secure cookies are refused over plain http, which is how localhost runs.
    if (lower === 'secure') continue;
    if (lower.startsWith('path=')) continue;
    if (lower.startsWith('samesite=')) {
      // SameSite=None requires Secure; Lax is the safe rewrite.
      kept.push('SameSite=Lax');
      continue;
    }
    kept.push(attr);
  }

  kept.push(`Path=${prefix}/`);
  return kept.join('; ');
}

/** Collect the incoming cookies that should be forwarded upstream. */
function upstreamCookies(req: NextRequest): string | null {
  const all = req.cookies.getAll();
  const kept = all.filter(
    (c) => !OWN_COOKIE_PREFIXES.some((p) => c.name.toLowerCase().startsWith(p.toLowerCase()))
  );
  if (kept.length === 0) return null;
  return kept.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Rewrite an HTML document so it renders through this proxy.
 */
function rewriteHtml(html: string, id: string, hostname: string): string {
  const prefix = proxyPrefix(id);
  let out = html;

  // Order matters. Root-relative and srcset rewriting runs FIRST, then the
  // absolute-host pass. Doing it the other way round produces
  // `/prefix/prefix/...`, because the host pass turns an absolute URL into a
  // root-relative one that the next rule then prefixes a second time.
  // Both rules also skip values that already start with the prefix.
  const prefixPath = prefix.replace(/^\//, '');
  const skip = prefixPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Root-relative attributes
  const attrRe = new RegExp(
    `(\\b(?:href|src|action|poster|data-src)\\s*=\\s*["'])\\/(?!\\/|${skip})`,
    'gi'
  );
  out = out.replace(attrRe, (_m, lead) => `${lead}${prefix}/`);

  // srcset carries comma-separated URL + descriptor pairs
  out = out.replace(/(\bsrcset\s*=\s*["'])([^"']+)(["'])/gi, (_m, lead, value, tail) => {
    const rewritten = String(value)
      .split(',')
      .map((entry: string) => {
        const trimmed = entry.trim();
        if (trimmed.startsWith(prefix)) return trimmed;
        if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return `${prefix}${trimmed}`;
        return trimmed;
      })
      .join(', ');
    return `${lead}${rewritten}${tail}`;
  });

  // Absolute URLs for the target host → proxy-relative
  const escapedHost = hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bareHost = escapedHost.replace(/^www\\\./, '');
  const hostRe = new RegExp(`(?:https?:)?//(?:www\\.)?(?:${bareHost}|${escapedHost})`, 'gi');
  out = out.replace(hostRe, prefix);

  // Base tag: makes every relative URL resolve through the proxy
  const baseTag = `<base href="${prefix}/">`;
  if (/<base\s/i.test(out)) {
    out = out.replace(/<base\b[^>]*>/i, baseTag);
  } else if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, (m) => `${m}${baseTag}`);
  } else {
    out = `${baseTag}${out}`;
  }

  // Patch client-side requests so absolute paths also route through the proxy
  const runtime = `<script>(function(){var P=${JSON.stringify(prefix)};function fix(u){return (typeof u==='string'&&u.charAt(0)==='/'&&u.charAt(1)!=='/'&&u.indexOf(P)!==0)?P+u:u;}try{var of=window.fetch;window.fetch=function(i,init){try{if(typeof i==='string'){i=fix(i);}else if(i&&i.url){var r=fix(i.url);if(r!==i.url){i=new Request(r,i);}}}catch(e){}return of.call(this,i,init);};}catch(e){}try{var oo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){try{if(typeof u==='string'){u=fix(u);}}catch(e){}var a=Array.prototype.slice.call(arguments);a[1]=u;return oo.apply(this,a);};}catch(e){}try{var os=window.open;window.open=function(u){return os.call(this,fix(u));};}catch(e){}})();</script>`;
  out = out.replace(/<head[^>]*>/i, (m) => `${m}${runtime}`);

  return out;
}

async function handle(req: NextRequest, params: Promise<{ id: string; path?: string[] }>) {
  const { id, path: segments } = await params;

  if (!ensureJobExists(id)) {
    return new Response('Job not found', { status: 404 });
  }

  const job = activeJobs.get(id)!;
  const hostname = job.hostname;

  if (!hostname || !hostname.includes('.')) {
    return new Response('Target hostname unavailable', { status: 400 });
  }
  if (isPrivateHost(hostname)) {
    return new Response('Refusing to proxy a private address', { status: 403 });
  }

  const guard = await dnsGuard(hostname);
  if (!guard.allowed) {
    return new Response(`Security check blocked: ${guard.reason}`, { status: 403 });
  }

  // Build the upstream URL. Everything after /live/ maps onto the target root.
  const tail = (segments || []).join('/');
  const search = req.nextUrl.search || '';
  const upstreamUrl = `https://${hostname}/${tail}${search}`;

  const headers = new Headers();
  for (const [name, value] of req.headers.entries()) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (lower === 'accept-encoding') continue;
    if (lower === 'cookie') continue;
    if (lower === 'referer' || lower === 'origin') continue;
    headers.set(name, value);
  }
  headers.set('accept-encoding', 'identity');
  headers.set(
    'user-agent',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36'
  );
  headers.set('referer', `https://${hostname}/`);

  const cookies = upstreamCookies(req);
  if (cookies) headers.set('cookie', cookies);

  const method = req.method.toUpperCase();
  let body: ArrayBuffer | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    try {
      const buf = await req.arrayBuffer();
      if (buf.byteLength > 0) body = buf;
    } catch {
      // no body
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: any) {
    return new Response(
      `Live fetch failed: ${err?.message || 'unknown error'}\n\nTarget: ${upstreamUrl}`,
      { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }

  // Redirects: keep the browser inside the proxy
  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get('location');
    const outHeaders = new Headers();
    if (location) {
      let rewritten = location;
      try {
        const resolved = new URL(location, upstreamUrl);
        const prefix = proxyPrefix(id);
        if (resolved.hostname.replace(/^www\./, '') === hostname.replace(/^www\./, '')) {
          rewritten = `${prefix}${resolved.pathname}${resolved.search}`;
        } else {
          rewritten = resolved.toString();
        }
      } catch {}
      outHeaders.set('location', rewritten);
    }
    upstream.headers.forEach((value, name) => {
      const lower = name.toLowerCase();
      if (lower === 'location' || HOP_BY_HOP.has(lower)) return;
      if (lower === 'set-cookie') {
        outHeaders.append('set-cookie', rewriteSetCookie(value, id));
        return;
      }
      if (lower === 'x-frame-options' || lower === 'content-security-policy') return;
      outHeaders.set(name, value);
    });
    return new Response(null, { status: upstream.status, headers: outHeaders });
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  const isHtml = contentType.toLowerCase().includes('text/html');
  const isCss = contentType.toLowerCase().includes('text/css');

  const outHeaders = new Headers();
  upstream.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower)) return;
    if (lower === 'content-encoding' || lower === 'content-length') return;
    if (lower === 'x-frame-options' || lower === 'content-security-policy') return;
    if (lower === 'content-type') return;
    if (lower === 'set-cookie') {
      outHeaders.append('set-cookie', rewriteSetCookie(value, id));
      return;
    }
    outHeaders.set(name, value);
  });
  outHeaders.set('content-type', contentType);
  outHeaders.set('x-frame-options', 'ALLOWALL');
  outHeaders.set('content-security-policy', 'frame-ancestors *');
  outHeaders.set('access-control-allow-origin', '*');

  let buffer: ArrayBuffer;
  try {
    buffer = await upstream.arrayBuffer();
  } catch {
    return new Response('Live response could not be read', { status: 502 });
  }

  if (buffer.byteLength > MAX_RESPONSE_BYTES) {
    return new Response('Live response exceeded the size limit', { status: 413 });
  }

  if ((isHtml || isCss) && buffer.byteLength <= MAX_REWRITE_BYTES) {
    let text = new TextDecoder('utf-8').decode(buffer);

    if (isHtml) {
      text = rewriteHtml(text, id, hostname);
    } else {
      const prefix = proxyPrefix(id);
      text = text.replace(/url\((['"]?)\/(?!\/)/gi, (_m, q) => `url(${q}${prefix}/`);
    }

    return new Response(text, { status: upstream.status, headers: outHeaders });
  }

  return new Response(buffer, { status: upstream.status, headers: outHeaders });
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string; path?: string[] }> }
) {
  return handle(req, context.params);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; path?: string[] }> }
) {
  return handle(req, context.params);
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string; path?: string[] }> }
) {
  return handle(req, context.params);
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; path?: string[] }> }
) {
  return handle(req, context.params);
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string; path?: string[] }> }
) {
  return handle(req, context.params);
}

export async function HEAD(
  req: NextRequest,
  context: { params: Promise<{ id: string; path?: string[] }> }
) {
  return handle(req, context.params);
}

export async function OPTIONS(
  req: NextRequest,
  context: { params: Promise<{ id: string; path?: string[] }> }
) {
  return handle(req, context.params);
}
