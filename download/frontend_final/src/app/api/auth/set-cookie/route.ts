import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// P2-COOKIE-01: Require COOKIE_SECRET from environment
const COOKIE_SECRET = (() => {
  if (!process.env.COOKIE_SECRET) throw new Error('COOKIE_SECRET environment variable is required');
  return process.env.COOKIE_SECRET;
})();

/**
 * POST /api/auth/set-cookie
 *
 * Fix #3: Generates a signed cookie value that the middleware can verify.
 * The cookie value is: base64(username + ":" + HMAC-SHA256(username + timestamp, secret))
 * The timestamp is also embedded in the cookie so the middleware can check freshness.
 *
 * Request body: { username: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const username = body?.username;

    if (!username || typeof username !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Username required' },
        { status: 400 }
      );
    }

    const timestamp = Date.now().toString();
    const payload = `${username}:${timestamp}`;
    const signature = crypto
      .createHmac('sha256', COOKIE_SECRET)
      .update(payload)
      .digest('hex');

    const cookieValue = Buffer.from(`${payload}:${signature}`).toString('base64');

    const response = NextResponse.json({ success: true });
    response.cookies.set('sems-auth', cookieValue, {
      path: '/',
      maxAge: 86400, // 24 hours
      // P2-COOKIE-02: httpOnly: true (middleware can read HttpOnly cookies)
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      // P2-COOKIE-03: sameSite: 'strict' for maximum CSRF protection
      sameSite: 'strict',
    });

    return response;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to set auth cookie' },
      { status: 500 }
    );
  }
}
