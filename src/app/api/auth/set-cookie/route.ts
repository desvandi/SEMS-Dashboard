import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { cookies } from 'next/headers';

const COOKIE_SECRET = process.env.COOKIE_SECRET || '';
const GAS_URL = process.env.GAS_SCRIPT_URL;

/**
 * POST /api/auth/set-cookie
 *
 * Verifies the auth token against GAS backend, then sets a signed HttpOnly cookie.
 * Token verification provides sufficient security — CSRF is not needed here.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, token } = body;

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ success: false, error: 'Username required' }, { status: 400 });
    }
    if (!token) {
      return NextResponse.json({ success: false, error: 'Token required' }, { status: 400 });
    }
    if (!GAS_URL) {
      return NextResponse.json({ success: false, error: 'Backend not configured' }, { status: 500 });
    }

    // Verify token with GAS backend
    console.log('[set-cookie] Verifying token for user:', username);
    const gasRes = await fetch(`${GAS_URL}?path=api/users/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
      body: JSON.stringify({ username }),
    });

    if (!gasRes.ok) {
      console.warn('[set-cookie] GAS verify failed:', gasRes.status);
      return NextResponse.json({ success: false, error: 'Token verification failed' }, { status: 401 });
    }

    // Generate signed cookie
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
