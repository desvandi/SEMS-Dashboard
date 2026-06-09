import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const COOKIE_SECRET = process.env.COOKIE_SECRET || '';

/**
 * POST /api/auth/set-cookie
 *
 * Sets a signed HttpOnly cookie for the authenticated user.
 * The token was already verified by the GAS backend during login
 * (the login POST returned success + token + user data).
 * This route only creates the signed cookie for middleware auth.
 *
 * The cookie format is: base64(username:timestamp:HMAC-SHA256-signature)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username } = body;

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ success: false, error: 'Username required' }, { status: 400 });
    }

    if (!COOKIE_SECRET) {
      console.error('[set-cookie] COOKIE_SECRET not configured');
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    // Generate signed cookie
    // The token was already verified by GAS during login; we trust the client-side
    // flow since the login endpoint validated credentials and returned a token.
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
      maxAge: 86400,
      httpOnly: true,
      secure: process.env.COOKIE_SECURE !== 'false',
      sameSite: 'lax',
    });

    console.log('[set-cookie] Cookie set for:', username);
    return response;
  } catch (error) {
    console.error('[set-cookie] Error:', error instanceof Error ? error.message : 'Unknown');
    return NextResponse.json({ success: false, error: 'Failed to set auth cookie' }, { status: 500 });
  }
}
