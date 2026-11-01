import { NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs';
import mime from 'mime-types';
import { MIME_OVERRIDES } from '@/lib/preview/mime';
import {
  escapeRegExp,
  resolveFileOrDirectoryIndex,
  findFileRecursive,
  findFirstHtmlRecursive,
} from '@/lib/preview/paths';
import { isWithinBase } from '@/lib/preview/security';
import { resolveTargetDir, ensureJobExists, getBaseDownloadDir } from '@/lib/resolveDir';
import { activeJobs } from '@/lib/jobStore';
import { detectAuthFlow, AuthFlow } from '@/lib/authflow/detect';
import { buildAuthRuntimeScript } from '@/lib/authflow/runtime';

// Explicit MIME mappings for modern web assets to guarantee proper parsing

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; path?: string[] }> }
) {
  try {
    const { id, path: pathSegments } = await params;

    // Ensure job exists (handles server restart / hot reload)
    if (!ensureJobExists(id)) {
      return new Response('Job not found', { status: 404 });
    }

    const job = activeJobs.get(id)!;
    const baseDir = getBaseDownloadDir(id);
    const targetDir = resolveTargetDir(id, job.hostname);

    if (!fs.existsSync(targetDir)) {
      return new Response('Download files not found', { status: 404 });
    }

    // Default to index.html if no path is provided
    const segments = pathSegments && pathSegments.length > 0 ? pathSegments : ['index.html'];
    const primaryPath = path.join(targetDir, ...segments);

    // Helper to resolve exact file, .html variant, or directory index

    let resolvedFilePath = resolveFileOrDirectoryIndex(primaryPath);
    let pathFound = resolvedFilePath !== null;
    let filePath = resolvedFilePath || primaryPath;

    // Detect if resolved index.html is a Google 404 or corrupted error page
    if (pathFound && (segments.length === 0 || segments.join('/') === 'index.html')) {
      try {
        const textSample = fs.readFileSync(filePath, 'utf-8').slice(0, 1500);
        if (
          textSample.includes('<title>Error 404') ||
          textSample.includes('404. That’s an error') ||
          textSample.includes('robot.png') ||
          textSample.includes('af-error-container')
        ) {
          pathFound = false;
          // Unlink the corrupted 404 error page so it cannot be mistakenly served
          try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            const rootTarget = path.join(targetDir, 'index.html');
            if (fs.existsSync(rootTarget)) fs.unlinkSync(rootTarget);
            const rootBase = path.join(baseDir, 'index.html');
            if (fs.existsSync(rootBase)) fs.unlinkSync(rootBase);
          } catch {}
        }
      } catch {}
    }

    // Fallback 1: Check manifest.json for initial entry page if index.html was requested but not found
    if (!pathFound && (segments.length === 0 || segments.join('/') === 'index.html')) {
      const manifestPath = path.join(baseDir, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          const firstPage = manifest.resources?.find((r: any) =>
            r.localPath && (r.localPath.endsWith('.html') || r.localPath.endsWith('.htm')) &&
            !r.localPath.includes('error') &&
            fs.existsSync(path.join(baseDir, r.localPath))
          );
          if (firstPage) {
            const candidate = path.join(baseDir, firstPage.localPath);
            try {
              const sample = fs.readFileSync(candidate, 'utf-8').slice(0, 1500);
              if (!sample.includes('404. That’s an error') && !sample.includes('af-error-container')) {
                filePath = candidate;
                pathFound = true;
              }
            } catch {}
          }
        } catch {}
      }

      // Check pages/ directory for any valid html file
      if (!pathFound) {
        const pagesDir = path.join(baseDir, 'pages');
        if (fs.existsSync(pagesDir)) {
          const found = findFirstHtmlRecursive(pagesDir);
          if (found) {
            filePath = found;
            pathFound = true;
          }
        }
      }

      // Check entire baseDir for any valid html file
      if (!pathFound) {
        const found = findFirstHtmlRecursive(baseDir);
        if (found) {
          filePath = found;
          pathFound = true;
        }
      }
    }

    // Fallback 2: Check inside baseDir/pages and baseDir/assets
    if (!pathFound && segments.length > 0) {
      const inPages = resolveFileOrDirectoryIndex(path.join(baseDir, 'pages', ...segments));
      if (inPages) {
        filePath = inPages;
        pathFound = true;
      } else {
        const inAssets = resolveFileOrDirectoryIndex(path.join(baseDir, 'assets', ...segments));
        if (inAssets) {
          filePath = inAssets;
          pathFound = true;
        }
      }
    }

    // Fallback 3: Search across all subdirectories in baseDir (handles multi-domain crawls like pixinvent.com vs demos.pixinvent.com)
    if (!pathFound) {
      try {
        const subdirs = fs.readdirSync(baseDir).filter(f => {
          try {
            const p = path.join(baseDir, f);
            return fs.statSync(p).isDirectory() && !f.startsWith('.');
          } catch {
            return false;
          }
        });

        const primaryDomain = job.hostname.replace('www.', '');
        const sortedSubdirs = subdirs.sort((a, b) => {
          const aMatch = a.toLowerCase().includes(primaryDomain) ? 1 : 0;
          const bMatch = b.toLowerCase().includes(primaryDomain) ? 1 : 0;
          return bMatch - aMatch;
        });

        for (const dir of sortedSubdirs) {
          const altPath = path.join(baseDir, dir, ...segments);
          const resolvedAlt = resolveFileOrDirectoryIndex(altPath);
          if (resolvedAlt) {
            filePath = resolvedAlt;
            pathFound = true;
            break;
          }
        }
      } catch {}
    }

    // Fallback 4: Direct filename search across baseDir for static assets (CSS, JS, fonts, images)
    if (!pathFound && segments.length > 0) {
      const fileName = segments[segments.length - 1].split('?')[0];
      const ext = path.extname(fileName).toLowerCase();
      if (['.js', '.css', '.woff2', '.woff', '.ttf', '.png', '.jpg', '.jpeg', '.svg', '.json', '.webp', '.ico'].includes(ext)) {
        const found = findFileRecursive(baseDir, fileName);
        if (found) {
          filePath = found;
          pathFound = true;
        }
      }
    }

    // Fallback 4b: Next.js Image Optimization route resolution in Preview
    if (!pathFound && (segments.join('/').includes('_next/image') || segments[segments.length - 1] === 'image' || segments[segments.length - 1] === 'opengraph-image' || segments[segments.length - 1] === 'twitter-image')) {
      const searchParams = req.nextUrl.searchParams;
      const innerUrl = searchParams.get('url') || searchParams.get('src') || searchParams.get('img');
      if (innerUrl) {
        try {
          const decoded = decodeURIComponent(innerUrl);
          const innerBase = path.basename(decoded.split('?')[0]);
          if (innerBase) {
            const baseWithoutExt = innerBase.replace(/\.[^.]+$/, '');
            const width = searchParams.get('w') || searchParams.get('width') || '';
            const candidates = [
              width ? `${baseWithoutExt}_w${width}.png` : '',
              width ? `${baseWithoutExt}_w${width}.webp` : '',
              innerBase,
              `${baseWithoutExt}.png`,
              `${baseWithoutExt}.webp`,
              `${baseWithoutExt}.jpg`,
              `${baseWithoutExt}.svg`,
            ].filter(Boolean);

            for (const cand of candidates) {
              const found = findFileRecursive(baseDir, cand);
              if (found) {
                filePath = found;
                pathFound = true;
                break;
              }
            }

            if (!pathFound) {
              const assetsImgDir = path.join(baseDir, 'assets', 'images');
              if (fs.existsSync(assetsImgDir)) {
                const files = fs.readdirSync(assetsImgDir);
                const matched = files.find(f => f.toLowerCase().startsWith(baseWithoutExt.toLowerCase()));
                if (matched) {
                  filePath = path.join(assetsImgDir, matched);
                  pathFound = true;
                }
              }
            }
          }
        } catch {}
      } else {
        // Dynamic routes without inner url (e.g. /opengraph-image?46961ab24f1bc43f)
        const assetsImgDir = path.join(baseDir, 'assets', 'images');
        if (fs.existsSync(assetsImgDir)) {
          const routeName = segments[segments.length - 1];
          const files = fs.readdirSync(assetsImgDir);
          const matched = files.find(f => f.toLowerCase().startsWith(routeName.toLowerCase()));
          if (matched) {
            filePath = path.join(assetsImgDir, matched);
            pathFound = true;
          }
        }
      }
    }

    // Fallback 5: Single Page Application (SPA) routing fallback
    // If an HTML navigation route is requested and no specific page exists on disk, serve the main entry html
    if (!pathFound) {
      const requestedExt = path.extname(segments[segments.length - 1] || '');
      const isImageRoute =
        segments.join('/').includes('_next/image') ||
        segments[segments.length - 1] === 'image' ||
        segments[segments.length - 1] === 'opengraph-image' ||
        segments[segments.length - 1] === 'twitter-image';

      const isRouteRequest = (!requestedExt || requestedExt === '.html' || requestedExt === '.htm') && !isImageRoute;
      if (isRouteRequest) {
        const rootIndex = path.join(targetDir, 'index.html');
        const baseIndex = path.join(baseDir, 'index.html');
        if (fs.existsSync(rootIndex)) {
          filePath = rootIndex;
          pathFound = true;
        } else if (fs.existsSync(baseIndex)) {
          filePath = baseIndex;
          pathFound = true;
        } else {
          const anyHtml = findFirstHtmlRecursive(baseDir);
          if (anyHtml) {
            filePath = anyHtml;
            pathFound = true;
          }
        }
      }
    }

    // Security: containment is checked once, after every resolution tier has run.
    if (!isWithinBase(filePath, baseDir)) {
      return new Response('Forbidden: Path traversal detected', { status: 403 });
    }

    if (!pathFound || !fs.existsSync(filePath)) {
      // Live entry page capture on-demand if index.html is requested before crawler finishes saving it
      if (segments.length === 0 || segments.join('/') === 'index.html') {
        try {
          const entryUrls = [
            job.url,
            `https://${job.hostname}/`,
            `https://www.${job.hostname.replace(/^www\./, '')}/`,
          ].filter(Boolean);

          for (const entryUrl of entryUrls) {
            try {
              const entryRes = await fetch(entryUrl as string, {
                headers: {
                  'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
                  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
                redirect: 'follow',
              });
              if (entryRes.ok) {
                const htmlText = await entryRes.text();
                const isError =
                  htmlText.includes('<title>Error 404') ||
                  htmlText.includes('404. That’s an error') ||
                  htmlText.includes('af-error-container');
                if (!isError && htmlText.length > 500) {
                  const rootIndex = path.join(targetDir, 'index.html');
                  try {
                    fs.mkdirSync(targetDir, { recursive: true });
                    fs.writeFileSync(rootIndex, htmlText, 'utf-8');
                  } catch {}
                  filePath = rootIndex;
                  pathFound = true;
                  break;
                }
              }
            } catch {}
          }
        } catch {}
      }

      // If crawling is currently in progress and still no file, return a live stream holding page instead of 404
      if (!pathFound && job.status === 'downloading') {
        const liveHoldingHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta http-equiv="refresh" content="2"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Live Capture • ${job.hostname}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #09090b;
      color: #fafafa;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
      text-align: center;
    }
    .scanner-box {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 32px 40px;
      display: flex;
      flex-direction: column;
      align-items: center;
      max-width: 420px;
    }
    .pulse-ring {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.12);
      border-top: 2px solid #ffffff;
      animation: spin 0.75s cubic-bezier(0.4, 0, 0.2, 1) infinite;
      margin-bottom: 20px;
    }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.12);
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #d4d4d8;
      margin-bottom: 12px;
    }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 8px #22c55e; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    h1 { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; margin-bottom: 8px; color: #ffffff; }
    p { font-size: 12px; color: #71717a; line-height: 1.5; font-mono; }
  </style>
</head>
<body>
  <div class="scanner-box">
    <div class="pulse-ring"></div>
    <div class="badge"><span class="dot"></span> Live Screen Stream</div>
    <h1>Capturing ${job.hostname}</h1>
    <p>Engine is actively downloading HTML DOM and assets. Screen will display automatically...</p>
  </div>
</body>
</html>`;
        return new Response(liveHoldingHtml, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          },
        });
      }

      // Dynamic On-Demand Asset Proxy & Cache (handles dynamic React / Next.js chunks, fonts, images)
      const requestedExt = path.extname(segments[segments.length - 1]?.split('?')[0] || '').toLowerCase();
      const isStaticAsset = ['.js', '.css', '.woff2', '.woff', '.ttf', '.png', '.jpg', '.jpeg', '.svg', '.json', '.webp', '.ico'].includes(requestedExt);
      
      if (isStaticAsset) {
        try {
          const remoteHost = job.hostname.includes('pixinvent') ? 'demos.pixinvent.com' : job.hostname;
          const remoteUrl = `https://${remoteHost}/${segments.join('/')}`;
          const remoteRes = await fetch(remoteUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
            },
          });
          if (remoteRes.ok) {
            const buf = Buffer.from(await remoteRes.arrayBuffer());
            const savePath = path.join(targetDir, ...segments);
            try {
              fs.mkdirSync(path.dirname(savePath), { recursive: true });
              fs.writeFileSync(savePath, buf);
            } catch {}
            
            const mimeType = remoteRes.headers.get('content-type') || MIME_OVERRIDES[requestedExt] || 'application/octet-stream';
            return new Response(buf, {
              headers: {
                'Content-Type': mimeType,
                'Cache-Control': 'public, max-age=31536000, immutable',
                'Access-Control-Allow-Origin': '*',
              },
            });
          }
        } catch {}
      }

      return new Response(`File not found: ${segments.join('/')}`, { status: 404 });
    }

    let fileBuffer = fs.readFileSync(filePath);
    const cleanExt = path.extname(filePath.split('?')[0]).toLowerCase();
    const mimeType = MIME_OVERRIDES[cleanExt] || mime.lookup(filePath.split('?')[0]) || 'application/octet-stream';

    // Intercept and adapt HTML/CSS content
    if (mimeType.startsWith('text/html') || mimeType.startsWith('text/css')) {
      let content = fileBuffer.toString('utf-8');

      // Adapt absolute domain URLs to preview route
      if (job.hostname && job.hostname.includes('.')) {
        const cleanHostname = job.hostname.toLowerCase().replace('www.', '');
        const domainRegex = new RegExp(`(?:https?:)?//(?:www\\.)?${escapeRegExp(cleanHostname)}\\/?`, 'gi');
        content = content.replace(domainRegex, `/api/mirror/${id}/preview/`);
      }

      if (mimeType.startsWith('text/html')) {
        // Adapt root-relative Next.js chunks, Vite, and assets to preview route
        content = content.replace(/(href|src|srcset)=["']\/_next\//gi, `$1="/api/mirror/${id}/preview/_next/`);
        content = content.replace(/url\((['"]?)\/_next\//gi, `url($1/api/mirror/${id}/preview/_next/`);
        content = content.replace(/(href|src|srcset)=["']\/assets\//gi, `$1="/api/mirror/${id}/preview/assets/`);
        content = content.replace(/url\((['"]?)\/assets\//gi, `url($1/api/mirror/${id}/preview/assets/`);
        
        if (!content.includes('<base')) {
          content = content.replace(/<head>/i, `<head><base href="/api/mirror/${id}/preview/">`);
        }

        // Protective stylesheet and layout stabilization
        const protectiveStyle = `
          <style>
            img, video { max-width: 100%; height: auto; }
            svg:not([width]) { max-width: 100%; }
          </style>
        `;
        content = content.replace(/<head>/i, `<head>${protectiveStyle}`);

        // Inject script to override IntersectionObserver and preserve offline hydration
        const observerOverrideScript = `
          <script>
            (function() {
              // Ensure cookie is set for asset routing
              try { document.cookie = "webstudio_preview_id=${id}; path=/; SameSite=Lax"; } catch(e) {}

              // Force eager loading for images and components
              if (window.IntersectionObserver) {
                const OriginalObserver = window.IntersectionObserver;
                window.IntersectionObserver = class extends OriginalObserver {
                  constructor(callback, options) {
                    super(callback, options);
                    this._callback = callback;
                  }
                  observe(target) {
                    super.observe(target);
                    setTimeout(() => {
                      try {
                        this._callback([{
                          target: target,
                          isIntersecting: true,
                          intersectionRatio: 1,
                          boundingClientRect: target.getBoundingClientRect(),
                          intersectionRect: target.getBoundingClientRect(),
                          rootBounds: {},
                          time: Date.now()
                        }], this);
                      } catch (e) {}
                    }, 50);
                  }
                };
              }

              // Offline Demo Session Hydration & Interactive Login Form Interception
              try {
                document.cookie = "__Secure-next-auth.session-token=webstudio_mock_session_token; path=/; SameSite=Lax";
                document.cookie = "next-auth.session-token=webstudio_mock_session_token; path=/; SameSite=Lax";

                if (!localStorage.getItem('userData')) {
                  localStorage.setItem('userData', JSON.stringify({
                    id: 1,
                    role: 'admin',
                    fullName: 'Vuexy Administrator',
                    username: 'admin',
                    email: 'admin@vuexy.com'
                  }));
                }
                if (!localStorage.getItem('accessToken')) {
                  localStorage.setItem('accessToken', 'webstudio_demo_authenticated_token');
                }
              } catch(e) {}

              // Intercept fetch for /api/auth/session
              try {
                var origFetch = window.fetch;
                window.fetch = function(input, init) {
                  var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
                  if (typeof url === 'string' && url.indexOf('/api/auth/session') !== -1) {
                    return Promise.resolve(new Response(JSON.stringify({
                      user: { name: 'Vuexy Administrator', email: 'admin@vuexy.com', image: null, role: 'admin' },
                      expires: '2099-01-01T00:00:00.000Z'
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                  }
                  return origFetch.apply(this, arguments);
                };
              } catch(e) {}

              // Prevent Next.js router from forcing redirects to /login on non-login pages
              try {
                var pathname = window.location.pathname.toLowerCase();
                var isViewingInternalPage = !pathname.includes('login') && !pathname.includes('signin') && !pathname.includes('auth');
                if (isViewingInternalPage) {
                  var origPush = window.history.pushState;
                  var origReplace = window.history.replaceState;
                  window.history.pushState = function(state, title, url) {
                    if (typeof url === 'string' && (url.toLowerCase().includes('/login') || url.toLowerCase().includes('/signin'))) {
                      console.warn('[WebStudio] Neutralized client redirect to login on previewed page:', url);
                      return;
                    }
                    return origPush.apply(this, arguments);
                  };
                  window.history.replaceState = function(state, title, url) {
                    if (typeof url === 'string' && (url.toLowerCase().includes('/login') || url.toLowerCase().includes('/signin'))) {
                      console.warn('[WebStudio] Neutralized client redirect to login on previewed page:', url);
                      return;
                    }
                    return origReplace.apply(this, arguments);
                  };
                }
              } catch(e) {}

              // Intercept login forms and buttons in offline preview
              function handleOfflineLogin(formEl) {
                try {
                  var emailInput = (formEl || document).querySelector('input[type="email"], input[name="email"], input[name="username"], input[type="text"]');
                  var userEmail = (emailInput && emailInput.value) ? emailInput.value : 'admin@vuexy.com';
                  
                  localStorage.setItem('userData', JSON.stringify({
                    id: 1,
                    role: 'admin',
                    fullName: 'Vuexy Administrator',
                    username: 'admin',
                    email: userEmail
                  }));
                  localStorage.setItem('accessToken', 'webstudio_demo_authenticated_token');
                  document.cookie = "__Secure-next-auth.session-token=webstudio_mock_session_token; path=/; SameSite=Lax";
                  document.cookie = "next-auth.session-token=webstudio_mock_session_token; path=/; SameSite=Lax";

                  window.parent.postMessage({ 
                    type: 'webstudio:login_submit', 
                    id: '${id}',
                    email: userEmail,
                    targetPage: 'en/dashboards/analytics.html' 
                  }, '*');

                  if ('${job.hostname}'.includes('pixinvent')) {
                    setTimeout(function() {
                      window.location.href = '/api/mirror/${id}/preview/demos.pixinvent.com/en/dashboards/analytics.html';
                    }, 250);
                  }
                } catch(err) {}
              }

              document.addEventListener('submit', function(e) {
                var form = e.target;
                if (form && form.querySelector('input[type="password"]')) {
                  e.preventDefault();
                  handleOfflineLogin(form);
                }
              }, true);

              document.addEventListener('click', function(e) {
                var btn = e.target && e.target.closest ? e.target.closest('button, input[type="submit"]') : null;
                if (btn) {
                  var txt = (btn.innerText || btn.value || '').toLowerCase();
                  if (txt.includes('login') || txt.includes('sign in') || btn.type === 'submit') {
                    var pwd = document.querySelector('input[type="password"]');
                    if (pwd) {
                      e.preventDefault();
                      handleOfflineLogin(btn.closest('form'));
                    }
                  }
                }
              }, true);
            })();
          </script>
        `;
        content = content.replace(/<head>/i, `<head>${observerOverrideScript}`);

        // Offline auth replay. Injected after the line above so it lands *earlier*
        // in <head>: each replace inserts immediately after <head>, so the last
        // insertion ends up first in the document. That ordering matters — the
        // runtime calls stopImmediatePropagation() on submit and must register
        // its listener before the legacy handler below.
        try {
          const flow = loadAuthFlow(id, baseDir, targetDir, job.hostname);
          if (flow && flow.hasAuth) {
            const loginPage =
              flow.pages.find((p) => p.kind === 'login')?.path || flow.pages[0]?.path || null;
            const runtime = buildAuthRuntimeScript(
              {
                jobId: id,
                previewBase: `/api/mirror/${id}/preview/`,
                entryPage: flow.entryPage,
                sessionCookies: flow.sessionCookies,
                storageKeys: flow.storageKeys,
                tokenValue: 'webstudio_offline_session',
                autoEnrol: true,
              },
              loginPage
            );
            content = content.replace(/<head>/i, `<head>${runtime}`);
          }
        } catch {
          // A failed auth injection must never break the preview.
        }
        content = content.replace(/loading=["']lazy["']/gi, 'loading="eager"');
      }

      fileBuffer = Buffer.from(content, 'utf-8');
    }

    const download = req.nextUrl.searchParams.get('download');
    const headers: Record<string, string> = {
      'Content-Type': mimeType,
      'Content-Length': fileBuffer.length.toString(),
      'X-Frame-Options': 'ALLOWALL',
      'Content-Security-Policy': "frame-ancestors *",
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      // Attach active mirror preview cookie so all sub-resource requests route seamlessly
      'Set-Cookie': `webstudio_preview_id=${id}; Path=/; SameSite=Lax`,
    };

    if (download === 'true') {
      headers['Content-Disposition'] = `attachment; filename="${path.basename(filePath.split('?')[0])}"`;
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    } else if (job.status === 'downloading') {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    } else {
      headers['Cache-Control'] = 'public, max-age=3600, must-revalidate';
    }

    return new Response(fileBuffer, { headers });
  } catch (err: any) {
    return new Response(err.message || 'Internal server error', { status: 500 });
  }
}


/** Recursively search for a file by name within a directory */

/** Recursively search for any .html or .htm file in a directory */

// ---------------------------------------------------------------------------
// Auth-flow lookup
// ---------------------------------------------------------------------------

const authFlowMemo = new Map<string, AuthFlow | null>();

/**
 * Read the auth flow for a job, preferring the cached `auth-flow.json` written
 * by `GET /api/mirror/[id]/auth-flow`.
 *
 * Detection is only run when no cache exists, and the result (including a
 * negative one) is memoised for the life of the process so a busy preview does
 * not rescan the mirror on every HTML request.
 */
function loadAuthFlow(
  id: string,
  baseDir: string,
  targetDir: string,
  hostname: string
): AuthFlow | null {
  if (authFlowMemo.has(id)) return authFlowMemo.get(id) ?? null;

  const cachePath = path.join(baseDir, 'auth-flow.json');
  try {
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as AuthFlow;
      if (cached && typeof cached.hasAuth === 'boolean') {
        authFlowMemo.set(id, cached);
        return cached;
      }
    }
  } catch {
    // fall through to detection
  }

  try {
    const flow = detectAuthFlow(id, hostname, targetDir);
    authFlowMemo.set(id, flow);
    try {
      fs.writeFileSync(cachePath, JSON.stringify(flow, null, 2), 'utf-8');
    } catch {}
    return flow;
  } catch {
    authFlowMemo.set(id, null);
    return null;
  }
}
