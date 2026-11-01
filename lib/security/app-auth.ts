/**
 * WebStudio Application Authentication
 *
 * WebStudio has no user accounts — it is a single-tenant studio. What it needs
 * is a way to stop being world-readable when it is deployed somewhere public.
 *
 * The model is a single shared access token (`WEBSTUDIO_ACCESS_TOKEN`) exchanged
 * for a signed, HttpOnly session cookie:
 *
 *   POST /api/auth/access { token }  →  Set-Cookie: webstudio_access=<signed>
 *
 * The cookie value is `v1.<issuedAtMs>.<hmac>` where the HMAC is computed with
 * Web Crypto over `v1.<issuedAtMs>`. That means:
 *   - it cannot be forged without the token;
 *   - it expires by age without server-side state;
 *   - it is HttpOnly, so a script running inside a mirrored preview page cannot
 *     read it even though the preview shares this origin.
 *
 * Deliberately implemented with Web Crypto rather than `node:crypto` so the same
 * module works in the Edge middleware and in Node route handlers.
 *
 * Three modes:
 *   open           no token configured, development — everything is allowed
 *   protected      token configured — the gate is enforced
 *   misconfigured  production with no token — refuse to serve, loudly
 */

export const ACCESS_COOKIE = 'webstudio_access';
export const PREVIEW_COOKIE = 'webstudio_preview_id';

/** How long a session stays valid. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AuthMode = 'open' | 'protected' | 'misconfigured';

export function getAccessToken(): string | null {
  const raw = process.env.WEBSTUDIO_ACCESS_TOKEN;
  if (!raw) return null;
  const token = raw.trim();
  return token.length >= 8 ? token : null;
}

export function getAuthMode(): AuthMode {
  if (getAccessToken()) return 'protected';
  // Production without a token is a misconfiguration, not an open door.
  if (process.env.NODE_ENV === 'production' && process.env.WEBSTUDIO_ALLOW_OPEN !== '1') {
    return 'misconfigured';
  }
  return 'open';
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return encodeBase64Url(new Uint8Array(signature));
}

/** Constant-time string comparison. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Build a signed session cookie value for a valid token. */
export async function createSessionValue(secret: string, now = Date.now()): Promise<string> {
  const issuedAt = String(now);
  const signature = await hmacSha256(secret, `v1.${issuedAt}`);
  return `v1.${issuedAt}.${signature}`;
}

/** Verify a session cookie value: correct signature and not expired. */
export async function verifySessionValue(
  secret: string,
  value: string | undefined | null,
  now = Date.now()
): Promise<boolean> {
  if (!value) return false;
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;

  const issuedAt = Number(parts[1]);
  if (!Number.isFinite(issuedAt)) return false;
  if (now - issuedAt > SESSION_TTL_MS) return false;
  if (issuedAt - now > 60_000) return false; // clock skew guard

  const expected = await hmacSha256(secret, `v1.${parts[1]}`);
  return timingSafeEqual(expected, parts[2]);
}

/**
 * Whether a request may proceed. Kept as one function so the middleware and any
 * route handler reach the same verdict.
 */
export async function isAuthorised(cookieValue: string | undefined | null): Promise<boolean> {
  const mode = getAuthMode();
  if (mode === 'open') return true;
  if (mode === 'misconfigured') return false;
  const token = getAccessToken();
  if (!token) return false;
  return verifySessionValue(token, cookieValue);
}
