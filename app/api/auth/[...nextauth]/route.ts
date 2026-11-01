import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.pathname.toLowerCase();
  // These routes exist so a mirrored NextAuth site works offline. They must not
  // be reachable as a real session source, so they only answer when the request
  // originates from a mirror preview (the cookie the preview route sets).
  const previewId = req.cookies.get('webstudio_preview_id')?.value;
  if (!previewId) {
    return NextResponse.json(
      { error: 'This endpoint only responds inside a mirror preview.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } }
    );
  }


  if (url.includes('/session')) {
    return NextResponse.json({
      user: {
        name: 'Vuexy Administrator',
        email: 'admin@vuexy.com',
        image: null,
        role: 'admin',
      },
      expires: '2099-01-01T00:00:00.000Z',
    });
  }

  if (url.includes('/csrf')) {
    return NextResponse.json({
      csrfToken: 'webstudio_offline_mock_csrf_token',
    });
  }

  if (url.includes('/providers')) {
    return NextResponse.json({
      credentials: {
        id: 'credentials',
        name: 'Credentials',
        type: 'credentials',
        signinUrl: '/api/auth/signin/credentials',
        callbackUrl: '/api/auth/callback/credentials',
      },
    });
  }

  return NextResponse.json({ success: true });
}

export async function POST(req: NextRequest) {
  const url = req.nextUrl.pathname.toLowerCase();
  // These routes exist so a mirrored NextAuth site works offline. They must not
  // be reachable as a real session source, so they only answer when the request
  // originates from a mirror preview (the cookie the preview route sets).
  const previewId = req.cookies.get('webstudio_preview_id')?.value;
  if (!previewId) {
    return NextResponse.json(
      { error: 'This endpoint only responds inside a mirror preview.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } }
    );
  }


  if (url.includes('/callback') || url.includes('/signin')) {
    return NextResponse.json(
      { url: '/dashboards/analytics' },
      {
        status: 200,
        headers: {
          'Set-Cookie': '__Secure-next-auth.session-token=webstudio_mock_session_token; Path=/; SameSite=Lax',
        },
      }
    );
  }

  return GET(req);
}
