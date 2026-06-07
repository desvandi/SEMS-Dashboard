import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { cookies } from 'next/headers';

// P2-COOKIE-01: Read COOKIE_SECRET from environment.
// If not set, cookie signing will use empty string (dev mode).
const COOKIE_SECRET = process.env.COOKIE_SECRET || '';

const GAS_URL = process.env.GAS_SCRIPT_URL;

/**
 * POST /api/auth/set-cookie
 *
 * Fix #3: Generates a signed cookie value that the middleware can verify.
 * The cookie value is: base64(username + ":" + HMAC-SHA256(username + timestamp, secret))
 * The timestamp is also embedded in the cookie so the middleware can check freshness.
 *
 * FE-001 FIX: Requires token in body and verifies it against GAS backend.
 * FE-007 FIX: Validates CSRF token via Double Submit pattern (X-CSRF-Token header vs sems-csrf cookie).
 *
 * Request body: { username: string, token: string }
 */
export async function POST(request: NextRequest) {
  try {
    // FE-007 FIX: CSRF validation — Double Submit pattern
    const csrfHeader = request.headers.get('X-CSRF-Token');
    const csrfCookie = (await cookies()).get('sems-csrf');
    if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie.value) {
      return NextResponse.json(
        { success: false, error: 'CSRF validation failed' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const username = body?.username;

    if (!username || typeof username !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Username required' },
        { status: 400 }
      );
    }

    // FE-001 FIX: Require token in body and verify it against GAS backend
    const token = body?.token;
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Token required' },
        { status: 400 }
      );
    }

    if (!GAS_URL) {
      return NextResponse.json(
        { success: false, error: 'Backend not configured' },
        { status: 500 }
      );
    }

    const gasRes = await fetch(`${GAS_URL}?path=api/users/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
      body: JSON.stringify({ username }),
    });
    if (!gasRes.ok) {
      return NextResponse.json(
        { success: false, error: 'Authentication failed' },
        { status: 401 }
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
      // FE-009 FIX: Use COOKIE_SECURE env var for explicit control instead of NODE_ENV heuristic
      secure: process.env.COOKIE_SECURE !== 'false',
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
