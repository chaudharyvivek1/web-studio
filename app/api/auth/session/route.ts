import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
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

  return NextResponse.json(
    {
      user: {
        name: 'Vuexy Administrator',
        email: 'admin@vuexy.com',
        image: null,
        role: 'admin',
      },
      expires: '2099-01-01T00:00:00.000Z',
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Set-Cookie': '__Secure-next-auth.session-token=webstudio_mock_session_token; Path=/; SameSite=Lax',
      },
    }
  );
}

export async function POST(req: NextRequest) {
  return GET(req);
}
