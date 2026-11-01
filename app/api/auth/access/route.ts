import { NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_COOKIE,
  SESSION_TTL_MS,
  createSessionValue,
  getAccessToken,
  getAuthMode,
  timingSafeEqual,
  verifySessionValue,
} from '@/lib/security/app-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/access — report whether a token is required and whether the
 * caller already has a valid session. Used by the login screen.
 */
export async function GET(req: NextRequest) {
  const mode = getAuthMode();
  const token = getAccessToken();
  const cookie = req.cookies.get(ACCESS_COOKIE)?.value;

  const authenticated =
    mode === 'open' ? true : mode === 'protected' && token ? await verifySessionValue(token, cookie) : false;

  return NextResponse.json(
    { mode, required: mode !== 'open', authenticated },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

/**
 * POST /api/auth/access — exchange the access token for a signed session cookie.
 *
 * The cookie is HttpOnly and SameSite=Strict: a script running inside a mirrored
 * preview page shares this origin, so it must not be able to read the session.
 */
export async function POST(req: NextRequest) {
  const mode = getAuthMode();

  if (mode === 'open') {
    return NextResponse.json({ success: true, note: 'Authentication is not enabled.' });
  }
  if (mode === 'misconfigured') {
    return NextResponse.json(
      {
        error:
          'Server is in production mode with no WEBSTUDIO_ACCESS_TOKEN set. Set it, or set WEBSTUDIO_ALLOW_OPEN=1 to run unprotected.',
      },
      { status: 503 }
    );
  }

  const token = getAccessToken()!;

  let supplied = '';
  try {
    const body = await req.json();
    supplied = typeof body?.token === 'string' ? body.token.trim() : '';
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON with a token field.' }, { status: 400 });
  }

  if (!supplied) {
    return NextResponse.json({ error: 'Access token is required.' }, { status: 400 });
  }

  if (!timingSafeEqual(supplied, token)) {
    // Deliberately vague: do not confirm whether a token was close.
    return NextResponse.json({ error: 'Invalid access token.' }, { status: 401 });
  }

  const value = await createSessionValue(token);
  const isSecure = process.env.NODE_ENV === 'production';

  return NextResponse.json(
    { success: true },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Set-Cookie': [
          `${ACCESS_COOKIE}=${value}`,
          'Path=/',
          'HttpOnly',
          'SameSite=Strict',
          `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
          isSecure ? 'Secure' : '',
        ]
          .filter(Boolean)
          .join('; '),
      },
    }
  );
}

/** DELETE /api/auth/access — sign out. */
export async function DELETE() {
  return NextResponse.json(
    { success: true },
    {
      headers: {
        'Cache-Control': 'no-store',
        'Set-Cookie': `${ACCESS_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
      },
    }
  );
}
